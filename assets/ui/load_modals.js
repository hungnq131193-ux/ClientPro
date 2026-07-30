// Load HTML partials for modals (async fetch, no sync XHR)
// Cold start inserts only the security gate required by the current local state.
// Remaining security modals warm after first paint; business modals warm at idle
// or load on demand through ModalLoader.ensure(id).
//
// ensure(id) ALWAYS resolves only after that modal's HTML is inserted (or failed).
// Never hand back a raw fetch promise from a batch that inserts later.

(function () {
  'use strict';

  if (window.ModalLoader) return;

  var root = document.getElementById('ui-modals-root');
  if (!root) {
    window.__clientpro_modals_ready = Promise.resolve(false);
    window.__clientpro_modals_all_ready = Promise.resolve(false);
    window.ModalLoader = {
      ensure: function () { return Promise.resolve(false); },
      criticalReady: function () { return window.__clientpro_modals_ready; },
      securityReady: function () { return window.__clientpro_modals_ready; },
    };
    return;
  }

  // CRITICAL cold path: exactly one mutually-exclusive primary security gate.
  // Loading only the gate implied by local activation/PIN state removes four
  // network competitors without changing checkSecurity() or any gate markup.
  var PRIMARY_SECURITY = [
    'screen-lock',
    'setup-lock-modal',
    'activation-modal',
  ];

  // These are security surfaces but never required to produce the first frame.
  var AUX_SECURITY = [
    'forgot-pin-modal',
    'biometric-setup-modal',
  ];

  var DEFERRED = [
    'add-modal',
    'asset-modal',
    'guide-modal',
    'approve-modal',
    'ref-price-modal',
    'donate-modal',
    'camera-modal',
    'backup-manager-modal',
  ];

  var SECURITY = PRIMARY_SECURITY.concat(AUX_SECURITY);
  var ALL = SECURITY.concat(DEFERRED);
  var FILE_FOR = {};
  ALL.forEach(function (id) {
    FILE_FOR[id] = 'assets/ui/modals/' + id + '.html';
  });

  var loaded = Object.create(null);
  // inflight[id] = Promise that resolves AFTER insert (or failure) — never raw fetch.
  var inflight = Object.create(null);

  // load_modals.js executes before 01_config.js, so capture the version from this
  // script's own ?v= token while document.currentScript still points at it. This
  // keeps the first security-fragment request identical to the SW precache URL.
  var loaderAssetVersion = (function () {
    try {
      var script = document.currentScript;
      if (!script) {
        var scripts = document.getElementsByTagName('script');
        for (var i = scripts.length - 1; i >= 0; i--) {
          if ((scripts[i].src || '').indexOf('assets/ui/load_modals.js') >= 0) {
            script = scripts[i];
            break;
          }
        }
      }
      var src = script && script.src ? script.src : '';
      var match = /[?&]v=([^&#]+)/.exec(src);
      return match && match[1] ? decodeURIComponent(match[1]) : '';
    } catch (e) {
      return '';
    }
  })();

  function assetVersion() {
    if (loaderAssetVersion) return loaderAssetVersion;
    try {
      if (typeof LAZY_MODULES_V !== 'undefined' && LAZY_MODULES_V) return String(LAZY_MODULES_V);
    } catch (e) { }
    try {
      if (typeof ASSET_V !== 'undefined' && ASSET_V) return String(ASSET_V);
    } catch (e) { }
    return '';
  }

  function versionedUrl(url) {
    var version = assetVersion();
    if (!version) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'v=' + encodeURIComponent(version);
  }

  function initialSecurityModalId() {
    try {
      if (localStorage.getItem('app_activated') !== 'true') return 'activation-modal';
      if (!localStorage.getItem('app_pin')) return 'setup-lock-modal';
    } catch (e) {
      // Storage unavailable: activation is the safest fail-closed surface.
      return 'activation-modal';
    }
    return 'screen-lock';
  }

  function insertHtml(html) {
    if (!html) return;
    root.insertAdjacentHTML('beforeend', html + '\n');
  }

  // Kept as a named regression contract: every deferred fragment is scanned only
  // inside its inserted subtree, never by a document-wide Lucide pass.
  function initDeferredModalIcons(id, modal) {
    if (DEFERRED.indexOf(id) < 0 || !modal) return;
    try {
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons({ root: modal });
      }
    } catch (e) { }
  }

  // Remaining security fragments arrive after bootstrap's primary-gate scan and
  // therefore need the same scoped initialization when their warm request lands.
  function initSecurityModalIcons(id, modal) {
    if (SECURITY.indexOf(id) < 0 || !modal) return;
    try {
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons({ root: modal });
      }
    } catch (e) { }
  }

  /**
   * Fetch + insert one modal. Resolves true only when #id is in the DOM
   * (or was already present). Safe to call concurrently with any warmer.
   */
  function fetchModal(id) {
    if (loaded[id] || document.getElementById(id)) {
      loaded[id] = true;
      return Promise.resolve(true);
    }
    if (inflight[id]) return inflight[id];
    var path = FILE_FOR[id];
    if (!path) return Promise.resolve(false);
    var url = versionedUrl(path);

    inflight[id] = fetch(url)
      .then(function (res) {
        if (!res.ok) {
          console.warn('[ClientPro] Failed to load modal partial:', url, 'status:', res.status);
          return '';
        }
        return res.text();
      })
      .then(function (html) {
        // Insert THIS modal immediately — do not wait for siblings in a group.
        if (!loaded[id] && !document.getElementById(id) && html) {
          insertHtml(html);
        }
        var modal = document.getElementById(id);
        if (modal) {
          loaded[id] = true;
          initSecurityModalIcons(id, modal);
          initDeferredModalIcons(id, modal);
        }
        delete inflight[id];
        return !!loaded[id];
      })
      .catch(function (e) {
        console.warn('[ClientPro] Error loading modal partial:', url, e);
        delete inflight[id];
        return false;
      });
    return inflight[id];
  }

  function loadGroup(ids) {
    var fetches = ids.map(function (id) { return fetchModal(id); });
    return Promise.all(fetches).then(function (results) {
      return results.every(Boolean);
    });
  }

  function scheduleIdle(fn) {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(function () { fn(); }, { timeout: 2500 });
    } else {
      setTimeout(fn, 1);
    }
  }

  function scheduleAfterFirstPaint(fn) {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { fn(); });
      });
    } else {
      setTimeout(fn, 32);
    }
  }

  // Two rAF callbacks are not a reliable proof of FCP when render-blocking CSS is
  // still being processed under mobile throttling. Observe the browser's actual
  // first-contentful-paint entry, then enqueue warm traffic. The fallback preserves
  // behaviour on older browsers without PerformanceObserver.
  function afterFirstContentfulPaint(fn) {
    var finished = false;
    var observer = null;
    var fallback = null;

    function run() {
      if (finished) return;
      finished = true;
      if (observer) {
        try { observer.disconnect(); } catch (e) { }
      }
      if (fallback) clearTimeout(fallback);
      scheduleAfterFirstPaint(fn);
    }

    try {
      if (typeof performance !== 'undefined'
        && typeof performance.getEntriesByName === 'function'
        && performance.getEntriesByName('first-contentful-paint').length) {
        run();
        return;
      }
      if (typeof PerformanceObserver === 'function') {
        observer = new PerformanceObserver(function (list) {
          var entries = list.getEntries();
          for (var i = 0; i < entries.length; i++) {
            if (entries[i].name === 'first-contentful-paint') {
              run();
              break;
            }
          }
        });
        observer.observe({ type: 'paint', buffered: true });
        // Fail-open for engines that expose PerformanceObserver but not paint
        // entries. This is deliberately later than the locked FCP budget.
        fallback = setTimeout(run, 2200);
        return;
      }
    } catch (e) { }

    scheduleAfterFirstPaint(fn);
  }

  function dispatchSecurityLoaded(detail) {
    try {
      document.dispatchEvent(new CustomEvent('clientpro:modals-critical-loaded', {
        detail: detail || {},
      }));
    } catch (e) { }
  }

  var initialSecurityId = initialSecurityModalId();
  var criticalPromise = fetchModal(initialSecurityId).then(function (ok) {
    if (ok) dispatchSecurityLoaded({ primary: initialSecurityId, complete: false });
    return ok;
  });

  var securityPromise = null;
  function loadRemainingSecurity() {
    if (!securityPromise) {
      securityPromise = loadGroup(SECURITY).then(function (ok) {
        dispatchSecurityLoaded({ primary: initialSecurityId, complete: true });
        return ok;
      });
    }
    return securityPromise;
  }

  var deferredPromise = null;
  function loadDeferred() {
    if (!deferredPromise) {
      deferredPromise = loadGroup(DEFERRED).then(function (ok) {
        try { document.dispatchEvent(new CustomEvent('clientpro:modals-loaded')); } catch (e) { }
        return ok;
      });
    }
    return deferredPromise;
  }

  // Security transitions (activation → PIN setup, forgot PIN, biometric) should be
  // ready before a human can act, but never compete with the measured first frame.
  criticalPromise.then(function () {
    afterFirstContentfulPaint(function () { loadRemainingSecurity(); });
  });

  // Business modals warm only after measured FCP AND during idle time.
  criticalPromise.then(function () {
    afterFirstContentfulPaint(function () {
      scheduleIdle(function () { loadDeferred(); });
    });
  });

  window.__clientpro_modals_ready = criticalPromise;
  try {
    Object.defineProperty(window, '__clientpro_modals_all_ready', {
      configurable: true,
      enumerable: true,
      get: function () {
        return Promise.all([loadRemainingSecurity(), loadDeferred()]);
      },
    });
  } catch (e) {
    window.__clientpro_modals_all_ready = {
      then: function (onFulfilled, onRejected) {
        return Promise.all([loadRemainingSecurity(), loadDeferred()]).then(onFulfilled, onRejected);
      },
      catch: function (onRejected) {
        return Promise.all([loadRemainingSecurity(), loadDeferred()]).catch(onRejected);
      },
    };
  }

  window.ModalLoader = {
    initialSecurityId: initialSecurityId,
    /** Ensure a modal DOM id is present before opening it. */
    ensure: function (id) {
      if (!id) return Promise.resolve(false);
      if (loaded[id] || document.getElementById(id)) {
        loaded[id] = true;
        return Promise.resolve(true);
      }
      if (ALL.indexOf(id) >= 0) return fetchModal(id);
      return Promise.resolve(false);
    },
    // Required gate only: bootstrap no longer waits for five security fragments.
    criticalReady: function () {
      return criticalPromise;
    },
    securityReady: function () {
      return loadRemainingSecurity();
    },
    allReady: function () {
      return Promise.all([loadRemainingSecurity(), loadDeferred()]);
    },
    /** Preload feature CSS used by camera / scanner (idempotent). */
    ensureFeatureCss: (function () {
      var cssPromise = null;
      return function () {
        if (cssPromise) return cssPromise;
        var href = versionedUrl('assets/css/features.css');
        cssPromise = new Promise(function (resolve) {
          if (document.querySelector('link[data-cp-features-css]')) {
            resolve(true);
            return;
          }
          var link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = href;
          link.setAttribute('data-cp-features-css', '1');
          link.onload = function () { resolve(true); };
          link.onerror = function () { resolve(false); };
          document.head.appendChild(link);
        });
        return cssPromise;
      };
    })(),
  };

  // Some non-delegated callbacks (notably the customer empty state) call
  // openModal() directly. Guard the function itself so every path waits for the
  // deferred Add modal before the original opener touches its DOM.
  function installOpenModalGuard() {
    var original = window.openModal;
    if (typeof original !== 'function' || original.__cpModalEnsureGuard) return false;
    function guardedOpenModal() {
      var args = arguments;
      var self = this;
      return window.ModalLoader.ensure('add-modal').then(function (ok) {
        if (!ok) return false;
        return original.apply(self, args);
      });
    }
    guardedOpenModal.__cpModalEnsureGuard = true;
    guardedOpenModal.__cpOriginal = original;
    window.openModal = guardedOpenModal;
    return true;
  }

  installOpenModalGuard();
  document.addEventListener('DOMContentLoaded', installOpenModalGuard, { once: true });
  document.addEventListener('clientpro:modals-critical-loaded', installOpenModalGuard);
  setTimeout(installOpenModalGuard, 0);
})();

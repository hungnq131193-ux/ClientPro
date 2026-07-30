// Load HTML partials for modals (async fetch, no sync XHR)
// Cold start inserts only the security gate required by the current local state.
// Remaining surfaces load on demand. Business modals may warm sequentially only
// after a successful unlock, so activation/lock first paint has no modal batch.
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
  var PRIMARY_SECURITY = [
    'screen-lock',
    'setup-lock-modal',
    'activation-modal',
  ];

  // These security surfaces are always available through ensure(id), but are not
  // speculative cold-start requests.
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
  // script's own ?v= token while document.currentScript still points at it.
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

  // Named regression contract: deferred fragments are scanned only inside the
  // inserted subtree, never by a document-wide Lucide pass.
  function initDeferredModalIcons(id, modal) {
    if (DEFERRED.indexOf(id) < 0 || !modal) return;
    try {
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons({ root: modal });
      }
    } catch (e) { }
  }

  function initSecurityModalIcons(id, modal) {
    if (SECURITY.indexOf(id) < 0 || !modal) return;
    try {
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons({ root: modal });
      }
    } catch (e) { }
  }

  function dispatchSecurityLoaded(detail) {
    try {
      document.dispatchEvent(new CustomEvent('clientpro:modals-critical-loaded', {
        detail: detail || {},
      }));
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
          if (SECURITY.indexOf(id) >= 0) {
            dispatchSecurityLoaded({ inserted: id, complete: false });
          }
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

  function scheduleIdle(fn, timeout) {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(function () { fn(); }, { timeout: timeout || 2500 });
    } else {
      setTimeout(fn, 1);
    }
  }

  // Warm one fragment per idle slice. This prevents a slow phone from parsing and
  // inserting eight modal trees in one long task.
  function warmSequential(ids, onDone) {
    var queue = ids.slice();
    function next() {
      if (!queue.length) {
        if (typeof onDone === 'function') onDone(true);
        return;
      }
      scheduleIdle(function () {
        var id = queue.shift();
        fetchModal(id).then(function () {
          // Yield both the main thread and network queue between fragments.
          setTimeout(next, 80);
        });
      }, 4000);
    }
    next();
  }

  var initialSecurityId = initialSecurityModalId();
  var criticalPromise = fetchModal(initialSecurityId).then(function (ok) {
    if (ok) dispatchSecurityLoaded({ primary: initialSecurityId, complete: false });
    return ok;
  });

  // Explicit all-security readiness remains available to callers/tests, but no
  // longer starts speculatively while activation or lock is on screen.
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

  // Explicit all-business readiness. User action paths continue to use ensure(id).
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

  // Business warming is useful only after data is unlocked. Delay it beyond the
  // unlock transition, then parse one fragment per idle slice. A direct early tap
  // still wins immediately through ensure(id) and shares the same inflight promise.
  var deferredWarmStarted = false;
  function startDeferredWarmAfterUnlock() {
    if (deferredWarmStarted) return;
    deferredWarmStarted = true;
    setTimeout(function () {
      warmSequential(DEFERRED, function () {
        try { document.dispatchEvent(new CustomEvent('clientpro:modals-loaded')); } catch (e) { }
      });
    }, 2000);
  }
  document.addEventListener('clientpro:unlocked', startDeferredWarmAfterUnlock, { once: true });

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

  // Activation's next surface is setup-lock-modal. Intercept only while that
  // fragment is absent, show immediate busy feedback, then call the unchanged
  // activation logic after insertion. This closes the fastest-tap race without a
  // speculative setup request on cold start.
  var activationEnsureInFlight = false;
  document.addEventListener('click', function (ev) {
    var target = ev.target && ev.target.closest
      ? ev.target.closest('[data-action="activateApp"]')
      : null;
    if (!target || document.getElementById('setup-lock-modal')) return;

    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (activationEnsureInFlight) return;
    activationEnsureInFlight = true;
    target.disabled = true;
    target.setAttribute('aria-busy', 'true');

    window.ModalLoader.ensure('setup-lock-modal').then(function (ok) {
      if (!ok || typeof window.activateApp !== 'function') {
        try {
          if (window.ErrorHandler) {
            window.ErrorHandler.showError('NETWORK', 'Không tải được màn hình tạo PIN. Vui lòng thử lại.');
          }
        } catch (e) { }
        return false;
      }
      return window.activateApp();
    }).catch(function (e) {
      try {
        if (window.ErrorHandler) {
          window.ErrorHandler.showError('NETWORK', 'Không tải được màn hình tạo PIN. Vui lòng thử lại.', e);
        }
      } catch (err) { }
    }).finally(function () {
      activationEnsureInFlight = false;
      target.disabled = false;
      target.removeAttribute('aria-busy');
    });
  }, true);

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

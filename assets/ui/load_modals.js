// Load HTML partials for modals (async fetch, no sync XHR)
// Cold start inserts only the security gate required by the current local state.
// Remaining security surfaces warm sequentially after FCP; business surfaces stay
// demand-loaded unless an explicit caller asks for allReady / warmBusiness.
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
      allReady: function () { return window.__clientpro_modals_all_ready; },
      warmBusiness: function () { return Promise.resolve(false); },
    };
    return;
  }

  // CRITICAL cold path: exactly one mutually-exclusive primary security gate.
  var PRIMARY_SECURITY = [
    'screen-lock',
    'setup-lock-modal',
    'activation-modal',
  ];

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
  var FILE_FOR = Object.create(null);
  ALL.forEach(function (id) {
    FILE_FOR[id] = 'assets/ui/modals/' + id + '.html';
  });

  var loaded = Object.create(null);
  // inflight[id] resolves AFTER insert (or failure), never after fetch alone.
  var inflight = Object.create(null);

  // load_modals.js executes before 01_config.js. Capture its own ?v= token while
  // document.currentScript still points at this file so the first gate request is
  // identical to the versioned service-worker precache URL.
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

  // A modal inserted after ModalA11y.init() must be observed immediately. Waiting
  // for the complete deferred batch leaves on-demand security dialogs without focus
  // handoff, Tab trapping, Escape handling, or accessible icon labels.
  function initInsertedModalLifecycle(modal) {
    if (!modal) return;
    try {
      if (window.ModalA11y && typeof window.ModalA11y.observeAll === 'function') {
        window.ModalA11y.observeAll();
      }
      if (window.ModalA11y && typeof window.ModalA11y.labelIconButtons === 'function') {
        window.ModalA11y.labelIconButtons(modal);
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

  /** Fetch + insert one modal; resolve true only when #id exists in the DOM. */
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
        if (!loaded[id] && !document.getElementById(id) && html) insertHtml(html);
        var modal = document.getElementById(id);
        if (modal) {
          loaded[id] = true;
          initSecurityModalIcons(id, modal);
          initDeferredModalIcons(id, modal);
          initInsertedModalLifecycle(modal);
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
  // inserting several modal trees in one long task.
  function warmSequential(ids, onDone) {
    var queue = ids.slice();
    var allOk = true;
    function next() {
      if (!queue.length) {
        if (typeof onDone === 'function') onDone(allOk);
        return;
      }
      scheduleIdle(function () {
        var id = queue.shift();
        fetchModal(id).then(function (ok) {
          allOk = allOk && ok;
          setTimeout(next, 80);
        });
      }, 4000);
    }
    next();
  }

  function afterFirstContentfulPaint(fn) {
    var done = false;
    var observer = null;
    var fallback = null;
    function run() {
      if (done) return;
      done = true;
      if (observer) {
        try { observer.disconnect(); } catch (e) { }
      }
      if (fallback) clearTimeout(fallback);
      scheduleIdle(fn, 3000);
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
        fallback = setTimeout(run, 2500);
        return;
      }
    } catch (e) { }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(function () { requestAnimationFrame(run); });
    } else {
      setTimeout(run, 32);
    }
  }

  var initialSecurityId = initialSecurityModalId();
  var criticalPromise = fetchModal(initialSecurityId).then(function (ok) {
    if (ok) dispatchSecurityLoaded({ primary: initialSecurityId, complete: false });
    return ok;
  });

  var securityPromise = null;
  function loadRemainingSecurity() {
    if (!securityPromise) {
      securityPromise = new Promise(function (resolve) {
        warmSequential(SECURITY, function (ok) {
          dispatchSecurityLoaded({ primary: initialSecurityId, complete: true });
          resolve(ok);
        });
      });
    }
    return securityPromise;
  }

  var deferredPromise = null;
  function loadDeferred() {
    if (!deferredPromise) {
      deferredPromise = new Promise(function (resolve) {
        warmSequential(DEFERRED, function (ok) {
          try { document.dispatchEvent(new CustomEvent('clientpro:modals-loaded')); } catch (e) { }
          resolve(ok);
        });
      });
    }
    return deferredPromise;
  }

  // Security transitions are small and may occur while the user is still locked;
  // make them available after the measured first frame without competing with FCP.
  criticalPromise.then(function () {
    afterFirstContentfulPaint(function () { loadRemainingSecurity(); });
  });

  // Business warming is opt-in only. Keeping this idle wrapper preserves a safe
  // warmer for explicit callers without extending every unlocked navigation's
  // networkidle window or adding speculative work to the app shell.
  function warmBusiness() {
    scheduleIdle(function () { loadDeferred(); });
    return loadDeferred();
  }

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
    ensure: function (id) {
      if (!id) return Promise.resolve(false);
      if (loaded[id] || document.getElementById(id)) {
        loaded[id] = true;
        return Promise.resolve(true);
      }
      if (ALL.indexOf(id) >= 0) return fetchModal(id);
      return Promise.resolve(false);
    },
    criticalReady: function () { return criticalPromise; },
    securityReady: function () { return loadRemainingSecurity(); },
    allReady: function () { return Promise.all([loadRemainingSecurity(), loadDeferred()]); },
    warmBusiness: warmBusiness,
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

  function showModalLoadError(message, error) {
    try {
      if (window.ErrorHandler) window.ErrorHandler.showError('NETWORK', message, error);
    } catch (e) { }
  }

  function setBootFailClosed(enabled) {
    try {
      if (!document.body) return;
      document.body.classList.toggle('cp-boot-ready', !enabled);
    } catch (e) { }
  }

  function installFunctionGuard(name, factory) {
    var original = window[name];
    if (typeof original !== 'function' || original.__cpLazySecurityGuard) return false;
    var guarded = factory(original);
    guarded.__cpLazySecurityGuard = true;
    guarded.__cpOriginal = original;
    window[name] = guarded;
    return true;
  }

  function installSecurityTransitionGuards() {
    // Theme changes must not remove cp-boot-ready or transient body state classes.
    installFunctionGuard('setTheme', function (original) {
      return function guardedSetTheme() {
        var body = document.body;
        var preserved = body ? Array.prototype.filter.call(body.classList, function (name) {
          return name.indexOf('theme-') !== 0;
        }) : [];
        var result = original.apply(this, arguments);
        if (body) preserved.forEach(function (name) { body.classList.add(name); });
        return result;
      };
    });

    installFunctionGuard('forgotPin', function (original) {
      return function guardedForgotPin() {
        var self = this;
        var args = arguments;
        return window.ModalLoader.ensure('forgot-pin-modal').then(function (ok) {
          if (!ok) {
            showModalLoadError('Không tải được màn hình khôi phục PIN. Vui lòng thử lại.');
            return false;
          }
          return original.apply(self, args);
        });
      };
    });

    // Recovery's success branch dereferences setup-lock-modal. Ensure it before any
    // crypto work; a failed fetch leaves the existing lock/recovery gates intact.
    installFunctionGuard('checkRecovery', function (original) {
      return function guardedCheckRecovery() {
        var self = this;
        var args = arguments;
        return window.ModalLoader.ensure('setup-lock-modal').then(function (ok) {
          if (!ok) {
            showModalLoadError('Không tải được màn hình tạo PIN mới. Vui lòng thử lại.');
            return false;
          }
          return original.apply(self, args);
        });
      };
    });

    // Legacy PIN upgrade hides the lock screen in its caller. Suppress the business
    // shell until the setup gate is inserted and visible.
    installFunctionGuard('_openForcedPinUpgrade', function (original) {
      return function guardedForcedPinUpgrade() {
        var self = this;
        var args = arguments;
        setBootFailClosed(true);
        return window.ModalLoader.ensure('setup-lock-modal').then(function (ok) {
          if (!ok) {
            showModalLoadError('Không tải được màn hình nâng cấp PIN. Vui lòng tải lại ứng dụng.');
            return false;
          }
          var result = original.apply(self, args);
          setBootFailClosed(false);
          return result;
        });
      };
    });

    // Revocation must clear keys immediately, not after a network fetch. Invoke the
    // original once under a fail-closed boot mask, ensure activation, then invoke it
    // again to reveal the now-present gate. A failed fetch never exposes the shell.
    installFunctionGuard('_revokeAndShowActivationGate', function (original) {
      return function guardedRevokeAndShowActivationGate() {
        var self = this;
        var args = arguments;
        setBootFailClosed(true);
        original.apply(self, args);
        return window.ModalLoader.ensure('activation-modal').then(function (ok) {
          if (!ok) {
            showModalLoadError('Không tải được màn hình kích hoạt. Vui lòng tải lại ứng dụng.');
            return false;
          }
          var result = original.apply(self, args);
          setBootFailClosed(false);
          return result;
        });
      };
    });
  }

  // Activation's next surface is setup-lock-modal. Intercept only while absent,
  // provide immediate busy feedback, then call unchanged activation logic.
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
        showModalLoadError('Không tải được màn hình tạo PIN. Vui lòng thử lại.');
        return false;
      }
      return window.activateApp();
    }).catch(function (e) {
      showModalLoadError('Không tải được màn hình tạo PIN. Vui lòng thử lại.', e);
    }).finally(function () {
      activationEnsureInFlight = false;
      target.disabled = false;
      target.removeAttribute('aria-busy');
    });
  }, true);

  // Some non-delegated callbacks call openModal() directly. Guard the function so
  // every path waits for Add markup before the original opener touches its DOM.
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

  function installRuntimeGuards() {
    installOpenModalGuard();
    installSecurityTransitionGuards();
  }

  installRuntimeGuards();
  document.addEventListener('DOMContentLoaded', installRuntimeGuards, { once: true });
  document.addEventListener('clientpro:modals-critical-loaded', installRuntimeGuards);
  setTimeout(installRuntimeGuards, 0);
})();

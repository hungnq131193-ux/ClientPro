// Load HTML partials for modals (async fetch, no sync XHR)
// Critical security gates load first; business modals load idle / on demand.
// Other app code can await: window.__clientpro_modals_ready (critical)
// and window.__clientpro_modals_all_ready (all). window.ModalLoader.ensure(id).
//
// ensure(id) ALWAYS resolves only after that modal's HTML is inserted (or failed).
// Never hand back a raw fetch promise from a batch that inserts later.

(function () {
  if (window.ModalLoader) return;

  var root = document.getElementById('ui-modals-root');
  if (!root) {
    window.__clientpro_modals_ready = Promise.resolve(false);
    window.__clientpro_modals_all_ready = Promise.resolve(false);
    window.ModalLoader = {
      ensure: function () { return Promise.resolve(false); },
      criticalReady: function () { return window.__clientpro_modals_ready; },
    };
    return;
  }

  // Security gates — bootstrap waits only for these (criticalReady).
  var CRITICAL = [
    'screen-lock',
    'setup-lock-modal',
    'activation-modal',
    'forgot-pin-modal',
    'biometric-setup-modal',
  ];

  // Business / feature modals — idle or ModalLoader.ensure(id).
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

  var FILE_FOR = {};
  CRITICAL.concat(DEFERRED).forEach(function (id) {
    FILE_FOR[id] = 'assets/ui/modals/' + id + '.html';
  });

  var loaded = Object.create(null);
  // inflight[id] = Promise that resolves AFTER insert (or failure) — never raw fetch.
  var inflight = Object.create(null);

  function insertHtml(html) {
    if (!html) return;
    root.insertAdjacentHTML('beforeend', html + '\n');
  }

  /**
   * Fetch + insert one modal. Resolves true only when #id is in the DOM
   * (or was already present). Safe to call concurrently with loadGroup.
   */
  function fetchModal(id) {
    if (loaded[id] || document.getElementById(id)) {
      loaded[id] = true;
      return Promise.resolve(true);
    }
    if (inflight[id]) return inflight[id];
    var url = FILE_FOR[id];
    if (!url) return Promise.resolve(false);

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
        if (document.getElementById(id)) loaded[id] = true;
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
    // Each fetchModal inserts as soon as its own response arrives, so ensure(id)
    // racing a group never resolves before that modal exists in the DOM.
    var fetches = ids.map(function (id) { return fetchModal(id); });
    return Promise.all(fetches).then(function () { return true; });
  }

  function scheduleIdle(fn) {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(function () { fn(); }, { timeout: 2500 });
    } else {
      setTimeout(fn, 1);
    }
  }

  var criticalPromise = loadGroup(CRITICAL).then(function () {
    document.dispatchEvent(new CustomEvent('clientpro:modals-critical-loaded'));
    return true;
  });

  var deferredPromise = null;
  function loadDeferred() {
    if (!deferredPromise) {
      deferredPromise = loadGroup(DEFERRED).then(function () {
        document.dispatchEvent(new CustomEvent('clientpro:modals-loaded'));
        return true;
      });
    }
    return deferredPromise;
  }

  // After critical gates are in, warm business modals on idle (not on cold-start path).
  criticalPromise.then(function () {
    scheduleIdle(function () { loadDeferred(); });
  });

  window.__clientpro_modals_ready = criticalPromise;
  // Lazy: constructing __clientpro_modals_all_ready must NOT invoke loadDeferred().
  // An eager criticalPromise.then(loadDeferred) would kick off all business-modal
  // fetches the moment the critical group settles — even if nobody awaits it —
  // competing with the DB/auth bootstrap and defeating the cold-start deferral.
  // The idle warmer above already loads them off the critical path; a real awaiter
  // reads this getter and still gets a promise that resolves once every business
  // modal is inserted.
  // ModalLoader.allReady() covers real consumers, so if defineProperty is somehow
  // unavailable we leave the property undefined rather than fall back to an eager
  // assignment (which would restart the very cold-start regression this guards).
  try {
    Object.defineProperty(window, '__clientpro_modals_all_ready', {
      configurable: true,
      enumerable: true,
      get: function () {
        return criticalPromise.then(function () { return loadDeferred(); });
      },
    });
  } catch (e) { }

  window.ModalLoader = {
    /** Ensure a modal DOM id is present before opening it. */
    ensure: function (id) {
      if (!id) return Promise.resolve(false);
      if (loaded[id] || document.getElementById(id)) {
        loaded[id] = true;
        return Promise.resolve(true);
      }
      if (CRITICAL.indexOf(id) >= 0 || DEFERRED.indexOf(id) >= 0) {
        return fetchModal(id);
      }
      return Promise.resolve(false);
    },
    criticalReady: function () {
      return criticalPromise;
    },
    allReady: function () {
      return loadDeferred();
    },
    /** Preload feature CSS used by camera / scanner (idempotent). */
    ensureFeatureCss: (function () {
      var cssPromise = null;
      return function () {
        if (cssPromise) return cssPromise;
        var href = 'assets/css/features.css';
        try {
          if (typeof LAZY_MODULES_V !== 'undefined' && LAZY_MODULES_V) {
            href += '?v=' + LAZY_MODULES_V;
          }
        } catch (e) { }
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
})();

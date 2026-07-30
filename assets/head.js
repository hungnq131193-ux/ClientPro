// ClientPro head bootstrap
// IMPORTANT: Keep console.warn available for minimal diagnostics.
// If you ever need to silence warn spam temporarily, set:
//   localStorage.setItem('CLIENTPRO_SILENCE_WARN','1')
// and reload.

(function () {
  'use strict';

  try {
    const origWarn = (console && console.warn) ? console.warn.bind(console) : function () { };
    if (!console.__clientpro_warn) console.__clientpro_warn = origWarn;
    const silence = (() => {
      try { return localStorage.getItem('CLIENTPRO_SILENCE_WARN') === '1'; } catch (e) { return false; }
    })();
    console.warn = silence ? function () { } : origWarn;
  } catch (e) {
    // Never break app boot due to console plumbing.
  }

  const SECURITY_GATE_IDS = [
    'screen-lock',
    'setup-lock-modal',
    'activation-modal',
    'forgot-pin-modal',
    'biometric-setup-modal',
  ];

  let bootReleased = false;
  let scannerOpenEpoch = 0;

  function visibleSecurityGate() {
    try {
      return SECURITY_GATE_IDS.some((id) => {
        const el = document.getElementById(id);
        return !!(el && !el.classList.contains('hidden'));
      });
    } catch (e) {
      return false;
    }
  }

  /** Keep the first contentful loader node stable across the security-gate handoff. */
  function stabilizeLoadingManager(manager) {
    if (!manager || manager.__cpStableLoaderText) return false;
    const initialText = document.getElementById('loader-text');
    if (initialText && initialText.textContent) manager._originalLoaderText = initialText.textContent;

    manager.showGlobal = function stableShowGlobal(message) {
      this._globalCount++;
      const loader = document.getElementById('loader');
      const text = document.getElementById('loader-text');
      const desired = message || 'Đang xử lý...';
      if (text && text.textContent !== desired) text.textContent = desired;
      if (loader) loader.classList.remove('hidden', 'cp-loader-parked', 'is-progress');
    };

    manager.hideGlobal = function stableHideGlobal(force) {
      if (force) this._globalCount = 0;
      else this._globalCount = Math.max(0, this._globalCount - 1);
      if (this._globalCount > 0) return;
      const loader = document.getElementById('loader');
      if (loader) {
        loader.classList.remove('is-progress');
        if (visibleSecurityGate()) {
          // Security overlays are fixed at z>=300 while loader is z=250. Parking
          // preserves one stable paint candidate without blocking or covering them.
          loader.classList.remove('hidden');
          loader.classList.add('cp-loader-parked');
        } else {
          loader.classList.remove('cp-loader-parked');
          loader.classList.add('hidden');
        }
      }
      // Never rewrite #loader-text while it is hidden/parked. The next show call
      // sets its message before exposing the global loader again.
      this._setProgressBar(null);
    };

    manager.__cpStableLoaderText = true;
    return true;
  }

  // head.js executes before 19_error_loading.js. Intercept its export so the
  // stabilized methods exist before bootstrap can call hideGlobal().
  function watchLoadingManagerExport() {
    if (window.LoadingManager) return stabilizeLoadingManager(window.LoadingManager);
    try {
      let current;
      Object.defineProperty(window, 'LoadingManager', {
        configurable: true,
        enumerable: true,
        get() { return current; },
        set(value) {
          current = value;
          stabilizeLoadingManager(current);
        },
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  function releaseBootShell(reason) {
    const body = document.body;
    if (!body) return;

    // Security-gate handoff may already have marked bootReleased. Unlock must still
    // remove the parked full-screen loader before any early return, otherwise the
    // dashboard is technically ready but remains covered by z=250 indefinitely.
    if (reason === 'unlocked') {
      const loader = document.getElementById('loader');
      if (loader) {
        loader.classList.remove('cp-loader-parked');
        loader.classList.add('hidden');
      }
    }

    if (bootReleased) {
      if (reason === 'unlocked') window.__clientproBootReadyReason = 'unlocked';
      return;
    }
    bootReleased = true;
    body.classList.add('cp-boot-ready');
    body.setAttribute('data-cp-boot-ready', '1');
    try {
      performance.mark('clientpro-boot-ready');
      window.__clientproBootReadyReason = reason || 'unknown';
    } catch (e) { }
  }

  function syncBootShell() {
    if (bootReleased) return;
    try {
      const loader = document.getElementById('loader');
      if (!loader || !visibleSecurityGate()) return;

      // hideGlobal may win the race a few milliseconds before the async gate insert.
      // Convert that hidden state to parked as soon as the gate enters the DOM so
      // Lighthouse and real users see one deterministic security handoff.
      if (loader.classList.contains('hidden')) {
        loader.classList.remove('hidden');
        loader.classList.add('cp-loader-parked');
      }
      if (loader.classList.contains('cp-loader-parked')) releaseBootShell('security-gate');
    } catch (e) { }
  }

  function scannerOpenAllowed(epoch) {
    if (epoch !== scannerOpenEpoch) return false;
    if (document.visibilityState === 'hidden') return false;
    try {
      if (typeof window.isAppUnlocked === 'function' && !window.isAppUnlocked()) return false;
    } catch (e) { return false; }
    return !visibleSecurityGate();
  }

  function scannerVersionQuery() {
    try {
      const v = window.LAZY_MODULES_V || window.ASSET_V || '';
      return v ? ('?v=' + encodeURIComponent(String(v))) : '';
    } catch (e) { return ''; }
  }

  function ensureScannerGlobal(globalName, src) {
    if (window[globalName]) return Promise.resolve(true);
    return new Promise((resolve) => {
      const existing = Array.from(document.scripts).find((s) => (s.src || '').indexOf(src) >= 0);
      if (existing) {
        existing.addEventListener('load', () => resolve(!!window[globalName]), { once: true });
        existing.addEventListener('error', () => resolve(false), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src + scannerVersionQuery();
      script.onload = () => resolve(!!window[globalName]);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  }

  // Complete every slow prerequisite outside the scanner's private session, then
  // revalidate epoch/unlock/gate immediately before the original open path.
  function installScannerOpenGuard() {
    const scanner = window.DocumentScanner;
    if (!scanner || typeof scanner.open !== 'function' || scanner.open.__cpEpochGuard) return false;
    const original = scanner.open;
    async function guardedScannerOpen() {
      const epoch = scannerOpenEpoch;
      const self = this;
      const args = arguments;
      if (!scannerOpenAllowed(epoch)) return false;

      const libs = await Promise.all([
        ensureScannerGlobal('DocumentGeometry', 'assets/document-scanner/document-geometry.js'),
        ensureScannerGlobal('DocumentImageEnhance', 'assets/document-scanner/document-image-enhance.js'),
      ]);
      if (!libs.every(Boolean) || !scannerOpenAllowed(epoch)) return false;

      if (window.ModalLoader) {
        const modalOk = await window.ModalLoader.ensure('camera-modal');
        if (!modalOk || !scannerOpenAllowed(epoch)) return false;
        const cssOk = await window.ModalLoader.ensureFeatureCss();
        if (!cssOk || !scannerOpenAllowed(epoch)) return false;
      }
      return original.apply(self, args);
    }
    guardedScannerOpen.__cpEpochGuard = true;
    guardedScannerOpen.__cpOriginal = original;
    scanner.open = guardedScannerOpen;
    return true;
  }

  function bindScannerScriptObserver() {
    installScannerOpenGuard();
    try {
      if (typeof MutationObserver === 'undefined' || !document.head) return;
      const observer = new MutationObserver((records) => {
        records.forEach((record) => {
          Array.from(record.addedNodes || []).forEach((node) => {
            if (!node || node.tagName !== 'SCRIPT') return;
            if ((node.src || '').indexOf('assets/document-scanner/document-scanner.js') < 0) return;
            node.addEventListener('load', installScannerOpenGuard, { once: true });
          });
        });
      });
      observer.observe(document.head, { childList: true });
    } catch (e) { }
  }

  function bindBootObserver() {
    stabilizeLoadingManager(window.LoadingManager);
    syncBootShell();
    installScannerOpenGuard();
    try {
      if (typeof MutationObserver === 'undefined') return;
      const loader = document.getElementById('loader');
      const root = document.getElementById('ui-modals-root');
      const observer = new MutationObserver(syncBootShell);
      if (loader) observer.observe(loader, { attributes: true, attributeFilter: ['class'] });
      if (root) observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });
    } catch (e) { }
  }

  document.addEventListener('clientpro:unlocked', function () {
    releaseBootShell('unlocked');
  });

  // Lock/revocation immediately hides business layout and invalidates camera opens.
  function closeBusinessShellForGate() {
    scannerOpenEpoch++;
    try {
      bootReleased = false;
      if (document.body) {
        document.body.classList.remove('cp-boot-ready');
        document.body.removeAttribute('data-cp-boot-ready');
      }
      const loader = document.getElementById('loader');
      if (loader && visibleSecurityGate()) {
        loader.classList.remove('hidden');
        loader.classList.add('cp-loader-parked');
      }
    } catch (e) { }
  }
  document.addEventListener('clientpro:locked', closeBusinessShellForGate);
  document.addEventListener('clientpro:security-gate-shown', closeBusinessShellForGate);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') scannerOpenEpoch++;
  });
  window.addEventListener('pagehide', function () { scannerOpenEpoch++; });

  watchLoadingManagerExport();
  bindScannerScriptObserver();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindBootObserver, { once: true });
  } else {
    bindBootObserver();
  }

  // Promote redesign stylesheet from media=print → all without blocking first paint.
  try {
    const applyRedesign = () => {
      const link = document.getElementById('cp-redesign-css');
      if (link && link.media !== 'all') link.media = 'all';
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyRedesign, { once: true });
    } else {
      applyRedesign();
    }
  } catch (e) { }
})();

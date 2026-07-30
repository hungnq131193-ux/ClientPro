// ClientPro head bootstrap
// IMPORTANT: Keep console.warn available for minimal diagnostics.
// If you ever need to silence warn spam temporarily, set:
//   localStorage.setItem('CLIENTPRO_SILENCE_WARN','1')
// and reload.

(function () {
  'use strict';

  try {
    const origWarn = (console && console.warn) ? console.warn.bind(console) : function () { };
    // Preserve original warn for later debugging.
    if (!console.__clientpro_warn) console.__clientpro_warn = origWarn;

    const silence = (() => {
      try { return localStorage.getItem('CLIENTPRO_SILENCE_WARN') === '1'; } catch (e) { return false; }
    })();

    if (silence) {
      console.warn = function () { };
    } else {
      console.warn = origWarn;
    }
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

  function releaseBootShell(reason) {
    if (bootReleased) return;
    const body = document.body;
    if (!body) return;
    bootReleased = true;
    // Keep both markers: the data attribute survives setTheme() assigning
    // body.className, while the class remains compatible with existing code/tests.
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
      // Fail closed: a hidden loader alone is not enough. At cold start there must
      // be an actual security gate in the DOM before the business shell may enter
      // layout. The unlock lifecycle is the other explicit release path.
      if (loader && loader.classList.contains('hidden') && visibleSecurityGate()) {
        releaseBootShell('security-gate');
      }
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

  // document-scanner.js owns private session state. Its public open() is wrapped
  // before first use so every slow prerequisite is completed outside that private
  // session, followed by an epoch/unlock/gate revalidation. The original function's
  // subsequent awaits are then already-resolved microtasks, so a lock task cannot
  // interleave and be overwritten by `state.seq = seq` before getUserMedia().
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

  // A completed unlock is an explicit safe release even if a custom test/client
  // hides the security gate before the loader observer sees its visible state.
  document.addEventListener('clientpro:unlocked', function () {
    releaseBootShell('unlocked');
  });

  // Lock/revocation must immediately remove the business shell from layout and
  // invalidate camera opens that are still preparing lazy resources.
  function closeBusinessShellForGate() {
    scannerOpenEpoch++;
    try {
      bootReleased = false;
      if (document.body) {
        document.body.classList.remove('cp-boot-ready');
        document.body.removeAttribute('data-cp-boot-ready');
      }
    } catch (e) { }
  }
  document.addEventListener('clientpro:locked', closeBusinessShellForGate);
  document.addEventListener('clientpro:security-gate-shown', closeBusinessShellForGate);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') scannerOpenEpoch++;
  });
  window.addEventListener('pagehide', function () { scannerOpenEpoch++; });

  bindScannerScriptObserver();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindBootObserver, { once: true });
  } else {
    bindBootObserver();
  }

  // Promote redesign stylesheet from media=print → all without blocking first paint.
  // (index.html loads it as print so it does not count as render-blocking.)
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

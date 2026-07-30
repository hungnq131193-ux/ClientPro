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

  function bindBootObserver() {
    syncBootShell();
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

  // Lock/revocation must immediately remove the business shell from layout. The
  // security modal root remains visible through the critical boot CSS.
  function closeBusinessShellForGate() {
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

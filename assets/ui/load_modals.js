// Load HTML partials for modals (async fetch, no sync XHR)
// Each modal lives at: /assets/ui/modals/<modal-id>.html
// Other app code can await: window.__clientpro_modals_ready

(function () {
  // Idempotent: keep a single in-flight promise.
  if (window.__clientpro_modals_ready) return;

  var root = document.getElementById('ui-modals-root');
  if (!root) {
    window.__clientpro_modals_ready = Promise.resolve(false);
    return;
  }

  var files = [
    'assets/ui/modals/screen-lock.html',
    'assets/ui/modals/setup-lock-modal.html',
    'assets/ui/modals/activation-modal.html',
    'assets/ui/modals/forgot-pin-modal.html',
    'assets/ui/modals/add-modal.html',
    'assets/ui/modals/asset-modal.html',
    'assets/ui/modals/guide-modal.html',
    'assets/ui/modals/approve-modal.html',
    'assets/ui/modals/ref-price-modal.html',
    'assets/ui/modals/donate-modal.html',
    'assets/ui/modals/camera-modal.html',
    'assets/ui/modals/backup-manager-modal.html',
    'assets/ui/modals/reminder-modal.html'
  ];

  async function loadAllModalsSequentially() {
    for (var i = 0; i < files.length; i++) {
      var url = files[i];
      try {
        var res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) {
          console.warn('[ClientPro] Failed to load modal partial:', url, 'status:', res.status);
          continue;
        }
        var html = await res.text();
        if (html) root.insertAdjacentHTML('beforeend', html + '\n');
      } catch (e) {
        console.warn('[ClientPro] Error loading modal partial:', url, e);
      }
    }
    document.dispatchEvent(new CustomEvent('clientpro:modals-loaded'));
    return true;
  }

  window.__clientpro_modals_ready = loadAllModalsSequentially();
})();

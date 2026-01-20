// Load HTML partials for modals (sync XHR to ensure DOM is ready before app scripts run)
// Each modal lives at: /assets/ui/modals/<modal-id>.html
// This file must be included BEFORE main app scripts in index.html.

(function () {
  if (window.__clientpro_modals_loaded) return;
  window.__clientpro_modals_loaded = true;

  var root = document.getElementById('ui-modals-root');
  if (!root) return;

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
    'assets/ui/modals/qr-modal.html',
    'assets/ui/modals/backup-manager-modal.html'
  ];

  for (var i = 0; i < files.length; i++) {
    var url = files[i];
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, false); // sync
      xhr.send(null);
      if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0) {
        root.insertAdjacentHTML('beforeend', (xhr.responseText || '') + '\n');
      } else {
        console.warn('[ClientPro] Failed to load modal partial:', url, 'status:', xhr.status);
      }
    } catch (e) {
      console.warn('[ClientPro] Error loading modal partial:', url, e);
    }
  }
})();

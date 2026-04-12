// ClientPro head bootstrap
// IMPORTANT: Keep console.warn available for minimal diagnostics.
// If you ever need to silence warn spam temporarily, set:
//   localStorage.setItem('CLIENTPRO_SILENCE_WARN','1')
// and reload.

(function () {
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
})();

// ============================================================
// LAZY LOADER - Load heavy modules on-demand for faster startup
// ============================================================
const LazyLoader = (() => {
  const loaded = new Set();
  const loading = new Map();

  function loadScript(src) {
    if (loaded.has(src)) return Promise.resolve();
    if (loading.has(src)) return loading.get(src);

    const p = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => {
        loaded.add(src);
        loading.delete(src);
        resolve();
      };
      script.onerror = () => {
        loading.delete(src);
        reject(new Error(`Failed to load: ${src}`));
      };
      document.body.appendChild(script);
    });
    loading.set(src, p);
    return p;
  }

  return {
    // Load Map module (Leaflet + 03_map.js)
    async loadMap() {
      if (loaded.has('map')) return;
      // Load Leaflet CSS
      if (!document.querySelector('link[href*="leaflet"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }
      // Load Leaflet JS then map module
      await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');
      await loadScript('./assets/03_map.js');
      loaded.add('map');
    },

    // Load Camera module (08_images_camera.js)
    async loadCamera() {
      if (loaded.has('camera')) return;
      await loadScript('./assets/08_images_camera.js');
      loaded.add('camera');
    },

    // Load Cloud Transfer module (14_cloud_transfer.js)
    async loadCloudTransfer() {
      if (loaded.has('cloud')) return;
      await loadScript('./assets/14_cloud_transfer.js');
      loaded.add('cloud');
    },

    isLoaded(name) { return loaded.has(name); }
  };
})();

// =========================================================
// ClientPro - Lazy Feature Loader (Phase 1+2: faster first load)
// - Loads heavy/optional feature modules only when needed.
// - Provides safe stubs for inline onclick handlers.
// - Does NOT change business logic; only defers module parsing.
// =========================================================

(function () {
  const _loaded = new Map();
  const _loading = new Map();

  // Use the same versioned URLs as the original index.html to preserve cache-busting behavior.
  const SRC = {
    map: 'assets/03_map.js',
    drive: 'assets/07_drive.js',
    weather: 'assets/09_backup_weather_donate.js',
    cloud: 'assets/14_cloud_transfer.js',
  };

  function _loadScriptOnce(src) {
    if (_loaded.get(src)) return Promise.resolve(true);
    if (_loading.has(src)) return _loading.get(src);

    const p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.defer = true;
      s.onload = () => {
        _loaded.set(src, true);
        resolve(true);
      };
      s.onerror = (e) => reject(e);
      document.body.appendChild(s);
    });
    _loading.set(src, p);
    return p;
  }

  async function _ensure(name) {
    const src = SRC[name];
    if (!src) throw new Error('Unknown lazy module: ' + name);
    await _loadScriptOnce(src);

    // Post-load small init hooks to preserve the behavior that used to happen on DOMContentLoaded.
    if (name === 'drive') {
      try {
        // Populate the settings input with saved URL (previously wired via DOMContentLoaded in 07_drive.js).
        if (typeof getEl === 'function' && typeof USER_SCRIPT_KEY !== 'undefined') {
          const savedUrl = localStorage.getItem(USER_SCRIPT_KEY);
          const input = getEl('user-script-url');
          if (savedUrl && input && !input.value) input.value = savedUrl;
        }
      } catch (e) {}
    }
  }

  async function _callAfterLoad(modName, fnName, args) {
    await _ensure(modName);
    const fn = window[fnName];
    if (typeof fn !== 'function' || fn.__cp_isStub) {
      throw new Error('Lazy load succeeded but handler is still missing: ' + fnName);
    }
    return fn.apply(window, args);
  }

  // Expose a tiny public API (useful for bootstrap idle warm-up)
  window.ClientProLazy = {
    ensure: _ensure,
    ensureCloud: () => _ensure('cloud'),
    ensureWeather: () => _ensure('weather'),
    ensureDrive: () => _ensure('drive'),
    ensureMap: () => _ensure('map'),
  };

  // -------------------------
  // Inline onclick stubs
  // -------------------------
  function _stub(modName, fnName) {
    const stubFn = function () {
      return _callAfterLoad(modName, fnName, arguments);
    };
    stubFn.__cp_isStub = true;
    return stubFn;
  }

  // Map screen
  if (typeof window.toggleMap !== 'function') window.toggleMap = _stub('map', 'toggleMap');
  if (typeof window.locateMe !== 'function') window.locateMe = _stub('map', 'locateMe');

  // Drive upload/config
  if (typeof window.saveScriptUrl !== 'function') window.saveScriptUrl = _stub('drive', 'saveScriptUrl');
  if (typeof window.uploadToGoogleDrive !== 'function') window.uploadToGoogleDrive = _stub('drive', 'uploadToGoogleDrive');

  // Weather + Donate
  if (typeof window.refreshWeather !== 'function') window.refreshWeather = _stub('weather', 'refreshWeather');
  if (typeof window.openDonateModal !== 'function') window.openDonateModal = _stub('weather', 'openDonateModal');
  if (typeof window.closeDonateModal !== 'function') window.closeDonateModal = _stub('weather', 'closeDonateModal');
  if (typeof window.copyDonateAccount !== 'function') window.copyDonateAccount = _stub('weather', 'copyDonateAccount');

  // Cloud Transfer: modals may call CloudTransferUI.showTab inline.
  // Provide a proxy object that lazy-loads the module, then forwards calls.
  if (!window.CloudTransferUI || typeof window.CloudTransferUI !== 'object') {
    const proxy = {
      __cp_isProxy: true,
      async showTab(tab) {
        await _ensure('cloud');
        const real = window.CloudTransferUI;
        if (real && real !== proxy && typeof real.showTab === 'function') return real.showTab(tab);
      },
      async startPolling() {
        await _ensure('cloud');
        const real = window.CloudTransferUI;
        if (real && real !== proxy && typeof real.startPolling === 'function') return real.startPolling();
      },
    };
    window.CloudTransferUI = proxy;
  }
})();

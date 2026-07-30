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

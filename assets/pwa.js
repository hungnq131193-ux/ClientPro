// ============================================================
// assets/pwa.js
// Service Worker bootstrap (stable update - avoids reload loops)
// - Registers SW
// - Requests immediate activation when a new SW is installed
// - Reloads the page once on controllerchange (one-time per session)
// ============================================================

(function () {
  "use strict";

  if (!("serviceWorker" in navigator)) return;

  // IMPORTANT (GitHub Pages / aggressive HTTP caches):
  // Register SW with a build query so browsers reliably fetch the latest sw.js.
  // Keep this in sync with sw.js VERSION.
  var SW_BUILD = 'v4.6.5_fix_save';

  function sendSkipWaiting(sw) {
    try {
      if (sw) sw.postMessage({ type: "SKIP_WAITING" });
    } catch (e) { }
  }

  // Prevent infinite reload loops: only reload once per tab/session
  function markReloaded() {
    try { sessionStorage.setItem("clientpro_sw_reloaded", "1"); } catch (e) { }
  }
  function hasReloaded() {
    try { return sessionStorage.getItem("clientpro_sw_reloaded") === "1"; } catch (e) { return false; }
  }

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js?v=" + encodeURIComponent(SW_BUILD));

      // If a new SW is already waiting, ask it to activate immediately.
      if (reg && reg.waiting) {
        sendSkipWaiting(reg.waiting);
      }

      // When a new SW is found/installed, request activation.
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed") {
            // If there's an existing controller, this is an update.
            if (navigator.serviceWorker.controller) {
              sendSkipWaiting(installing);
            }
          }
        });
      });

      // Reload once when the active controller actually changes.
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (hasReloaded()) return;
        markReloaded();
        location.reload();
      });
    } catch (err) {
      console.log("Loi Service Worker:", err);
    }
  });
})();

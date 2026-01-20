// ============================================================
// assets/pwa.js
// Service Worker bootstrap (auto-update)
// ============================================================

(function () {
  "use strict";

  if (!("serviceWorker" in navigator)) return;

  function sendSkipWaiting(reg) {
    try {
      if (reg && reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    } catch (e) {}
  }

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js");

      // Neu da co ban moi dang cho, kich hoat ngay va reload.
      if (reg.waiting && navigator.serviceWorker.controller) {
        sendSkipWaiting(reg);
        setTimeout(() => location.reload(), 150);
        return;
      }

      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          // installed + co controller => co ban moi
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            sendSkipWaiting({ waiting: nw });
            setTimeout(() => location.reload(), 150);
          }
        });
      });
    } catch (err) {
      console.log("Loi Service Worker:", err);
    }
  });
})();

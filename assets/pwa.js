// ============================================================
// assets/pwa.js
// Service Worker bootstrap (update an toàn — không tự reload)
// - Đăng ký SW với build query (chống HTTP cache dính sw.js cũ)
// - KHÔNG skipWaiting tự động, KHÔNG tự location.reload():
//   SW mới chờ theo lifecycle chuẩn. Khi phát hiện bản mới đang chờ,
//   hiện banner "Đã có bản cập nhật" — chỉ khi NGƯỜI DÙNG bấm "Cập nhật"
//   mới gửi SKIP_WAITING và reload MỘT lần sau controllerchange.
// - Lần cài SW đầu tiên không được tranh băng thông với security gate/cold paint:
//   bắt đầu sau unlock, hoặc fallback sau 15 giây nếu user ở lâu tại activation.
//   PWA đã có controller vẫn kiểm tra update ở idle sau first paint.
// ============================================================

(function () {
  "use strict";

  if (!("serviceWorker" in navigator)) return;

  // IMPORTANT (GitHub Pages / aggressive HTTP caches):
  // Register SW with a build query so browsers reliably fetch the latest sw.js.
  // Keep this in sync with sw.js VERSION.
  var SW_BUILD = 'v1.5.3';

  window.__swUpdatePending = false;

  // Người dùng đã bấm "Cập nhật" -> được phép reload 1 lần khi SW mới nhận quyền.
  var userRequestedUpdate = false;
  var didReload = false;
  var registrationStarted = false;
  var fallbackTimer = null;

  function removeUpdateBanner() {
    var b = document.getElementById("sw-update-banner");
    if (b) { try { b.remove(); } catch (e) { } }
  }

  // Banner nhỏ dưới đáy màn hình (DOM API + textContent, không inline handler — CSP an toàn).
  // z-index 280: trên modal nghiệp vụ/loader (200/250) nhưng DƯỚI màn khóa (300+)
  // — đang khóa thì không chen ngang, mở khóa xong banner mới lộ ra.
  function showUpdateBanner(reg) {
    if (document.getElementById("sw-update-banner")) return;
    if (!document.body) return;

    var banner = document.createElement("div");
    banner.id = "sw-update-banner";
    banner.setAttribute("role", "status");

    var msg = document.createElement("span");
    msg.className = "sw-update-msg";
    msg.textContent = "Đã có bản cập nhật mới.";

    var btnLater = document.createElement("button");
    btnLater.type = "button";
    btnLater.className = "sw-update-later";
    btnLater.textContent = "Để sau";
    btnLater.addEventListener("click", removeUpdateBanner);

    var btnNow = document.createElement("button");
    btnNow.type = "button";
    btnNow.className = "sw-update-now";
    btnNow.textContent = "Cập nhật";
    btnNow.addEventListener("click", function () {
      if (userRequestedUpdate) return;
      userRequestedUpdate = true;
      btnNow.disabled = true;
      btnNow.textContent = "Đang cập nhật...";
      try {
        if (reg && reg.waiting) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
          // controllerchange sẽ reload; nếu vì lý do nào đó không tới
          // (SW waiting đã biến mất giữa chừng), fallback reload sau 8s.
          setTimeout(function () {
            if (!didReload) { didReload = true; window.location.reload(); }
          }, 8000);
        } else {
          // Không còn SW chờ (đã activate ngầm) -> reload thẳng để nhận bản mới.
          didReload = true;
          window.location.reload();
        }
      } catch (e) {
        didReload = true;
        window.location.reload();
      }
    });

    banner.appendChild(msg);
    banner.appendChild(btnLater);
    banner.appendChild(btnNow);
    document.body.appendChild(banner);
  }

  async function registerServiceWorker() {
    if (registrationStarted) return;
    registrationStarted = true;
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    try {
      const reg = await navigator.serviceWorker.register("./sw.js?v=" + encodeURIComponent(SW_BUILD));

      // Bản mới đã cài xong và đang chờ -> đánh dấu + mời cập nhật, không cưỡng bức.
      if (reg && reg.waiting && navigator.serviceWorker.controller) {
        window.__swUpdatePending = true;
        showUpdateBanner(reg);
      }

      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            // Có bản cập nhật chờ sẵn; mời người dùng kích hoạt khi thuận tiện.
            window.__swUpdatePending = true;
            showUpdateBanner(reg);
          }
        });
      });

      // controllerchange: SW mới nhận quyền. Chỉ reload khi chính người dùng đã
      // bấm "Cập nhật" (và chỉ đúng 1 lần) — các trường hợp khác giữ nguyên như cũ.
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.__swUpdatePending = false;
        removeUpdateBanner();
        if (userRequestedUpdate && !didReload) {
          didReload = true;
          window.location.reload();
        }
      });
    } catch (err) {
      console.warn("Lỗi Service Worker:", err);
    }
  }

  function scheduleInstalledAppUpdateCheck() {
    var run = function () { registerServiceWorker(); };
    try {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(run, { timeout: 2500 });
      } else {
        setTimeout(run, 1);
      }
    } catch (e) {
      setTimeout(run, 1);
    }
  }

  function scheduleFirstInstall() {
    // Explicit unlock is the preferred trigger: first paint and security work are
    // complete, and the user can benefit from the offline package afterward.
    document.addEventListener('clientpro:unlocked', registerServiceWorker, { once: true });
    // Activation/setup screens may remain open for a while. Install eventually,
    // but outside Lighthouse/cold-start and without requiring user interaction.
    fallbackTimer = setTimeout(registerServiceWorker, 15000);
  }

  window.addEventListener("load", function () {
    if (navigator.serviceWorker.controller) {
      scheduleInstalledAppUpdateCheck();
    } else {
      scheduleFirstInstall();
    }
  });
})();

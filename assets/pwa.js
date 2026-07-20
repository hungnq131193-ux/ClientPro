// ============================================================
// assets/pwa.js
// Service Worker bootstrap (update an toàn — không tự reload)
// - Đăng ký SW với build query (chống HTTP cache dính sw.js cũ)
// - KHÔNG skipWaiting tự động, KHÔNG tự location.reload():
//   SW mới chờ theo lifecycle chuẩn. Khi phát hiện bản mới đang chờ,
//   hiện banner "Đã có bản cập nhật" — chỉ khi NGƯỜI DÙNG bấm "Cập nhật"
//   mới gửi SKIP_WAITING và reload MỘT lần sau controllerchange.
//   Người dùng không bao giờ mất nội dung đang nhập vì app tự reload,
//   và không bao giờ có mixed-version HTML/asset.
// ============================================================

(function () {
  "use strict";

  if (!("serviceWorker" in navigator)) return;

  // IMPORTANT (GitHub Pages / aggressive HTTP caches):
  // Register SW with a build query so browsers reliably fetch the latest sw.js.
  // Keep this in sync with sw.js VERSION.
  var SW_BUILD = 'v1.0.8';

  window.__swUpdatePending = false;

  // Người dùng đã bấm "Cập nhật" -> được phép reload 1 lần khi SW mới nhận quyền.
  var userRequestedUpdate = false;
  var didReload = false;

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

  window.addEventListener("load", async () => {
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
  });
})();

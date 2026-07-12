// ============================================================
// assets/pwa.js
// Service Worker bootstrap (update an toàn — không tự reload)
// - Đăng ký SW với build query (chống HTTP cache dính sw.js cũ)
// - KHÔNG skipWaiting chủ động, KHÔNG location.reload() khi controllerchange:
//   SW mới chờ theo lifecycle chuẩn và chỉ phục vụ ở lần mở/điều hướng tự
//   nhiên tiếp theo — người dùng không bao giờ mất nội dung đang nhập vì app
//   tự reload giữa phiên, và không bao giờ có mixed-version HTML/asset.
// - Khi phát hiện có bản mới đang chờ, chỉ đánh dấu window.__swUpdatePending
//   (UI tương lai có thể hiện nút "Cập nhật ngay" gửi message SKIP_WAITING —
//   sw.js vẫn giữ handler này).
// ============================================================

(function () {
  "use strict";

  if (!("serviceWorker" in navigator)) return;

  // IMPORTANT (GitHub Pages / aggressive HTTP caches):
  // Register SW with a build query so browsers reliably fetch the latest sw.js.
  // Keep this in sync with sw.js VERSION.
  var SW_BUILD = 'v1.0.0';

  window.__swUpdatePending = false;

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js?v=" + encodeURIComponent(SW_BUILD));

      // Bản mới đã cài xong và đang chờ -> chỉ đánh dấu, không kích hoạt cưỡng bức.
      if (reg && reg.waiting && navigator.serviceWorker.controller) {
        window.__swUpdatePending = true;
      }

      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            // Có bản cập nhật chờ sẵn; lần mở app tiếp theo sẽ dùng bản mới.
            window.__swUpdatePending = true;
          }
        });
      });

      // controllerchange chỉ còn xảy ra khi SW cũ bị gỡ/lỗi hoặc người dùng chủ
      // động kích hoạt (SKIP_WAITING). Không reload — build đang mở vẫn hoạt
      // động nhờ navigation fallback + network (static hosting bỏ qua ?v=).
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.__swUpdatePending = false;
      });
    } catch (err) {
      console.warn("Lỗi Service Worker:", err);
    }
  });
})();

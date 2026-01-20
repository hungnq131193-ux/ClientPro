// Đăng ký PWA Service Worker + tự động nhận bản mới (skip waiting + reload)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      console.log('Service Worker đã sẵn sàng!', reg);

      // Khi có SW mới
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          // installed + đã có controller => đây là update (không phải install lần đầu)
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            try {
              // Yêu cầu SW mới kích hoạt ngay
              sw.postMessage({ type: 'SKIP_WAITING' });
            } catch (e) {}
          }
        });
      });

      // Khi controller đổi sang SW mới => reload 1 lần để nhận JS/CSS mới
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        try {
          if (sessionStorage.getItem('__sw_reloaded__')) return;
          sessionStorage.setItem('__sw_reloaded__', '1');
        } catch (e) {}
        window.location.reload();
      });
    } catch (err) {
      console.log('Lỗi Service Worker:', err);
    }
  });
}

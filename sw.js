const CACHE_NAME = 'clientpro-v1.0.1'; // Đã đổi lên v2 để reset cache
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  // Nếu bạn chưa có các file ảnh này, HÃY XÓA DÒNG TƯƠNG ỨNG ĐỂ TRÁNH LỖI
  './icon-192.png', 
  // './icon-512.png',      // Tạm comment nếu chưa có
  // './apple-touch-icon.png', // Tạm comment nếu chưa có
  // './splash-screen.png',    // Tạm comment nếu chưa có
  
  // CACHE LUÔN CÁC THƯ VIỆN NGOÀI (QUAN TRỌNG)
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/lucide@latest',
  'https://unpkg.com/html5-qrcode',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js'
];

// Cài đặt
self.addEventListener('install', event => {
  self.skipWaiting(); // Kích hoạt ngay lập tức, không chờ
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Dùng return cache.addAll để bắt lỗi nếu file thiếu
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
         console.error('Lỗi khi cache files:', err);
      });
    })
  );
});

// Kích hoạt & Dọn dẹp cache cũ
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('Xóa cache cũ:', key);
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Xử lý Fetch
self.addEventListener('fetch', event => {
  const request = event.request;
  
  // Bỏ qua các request POST hoặc chrome-extension (gây lỗi)
  if (request.method !== 'GET' || !request.url.startsWith('http')) return;

  // Chiến lược: Network First cho HTML (để luôn lấy code mới)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        return response;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Chiến lược: Cache First cho tài nguyên tĩnh (JS, CSS, Ảnh)
  event.respondWith(
    caches.match(request).then(cached => {
      return cached || fetch(request).then(response => {
        // Cho phép cache cả response từ CDN (opaque/cors)
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});

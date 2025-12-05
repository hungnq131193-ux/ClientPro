// ĐỔI TÊN CACHE ĐỂ ÉP CẬP NHẬT (Ví dụ: v3 -> v4)
const CACHE_NAME = 'clientpro-cache-v6';

const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  
  // QUAN TRỌNG: Viết đúng Hoa/Thường như trên GitHub của bạn
  './Css/style.css',
  
  // Vì hiện tại chỉ có app.js chứa code, các file khác trống thì không cần cache cũng được
  // Nhưng để chắc chắn, cứ khai báo đúng đường dẫn
  './Js/config.js',
  './Js/database.js',
  './Js/drive.js',
  './Js/map.js',
  './Js/security.js',
  './Js/ui.js',
  './Js/app.js',
  
  // Thư viện bên ngoài (Font Awesome, Leaflet...)
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/lucide@latest',
  'https://unpkg.com/html5-qrcode',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js'
];

self.addEventListener('install', (event) => {
  // Ép SW mới cài đặt ngay lập tức (bỏ qua trạng thái waiting)
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('activate', (event) => {
  // Ép SW mới chiếm quyền điều khiển ngay lập tức
  event.waitUntil(self.clients.claim());
  
  // Xóa toàn bộ cache cũ
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Nếu có trong cache thì dùng, không thì tải mạng
        return response || fetch(event.request);
      })
      .catch(() => {
        // Fallback nếu mất mạng và không có cache (thường dùng cho ảnh)
        return caches.match('./icon-192.png');
      })
  );
});

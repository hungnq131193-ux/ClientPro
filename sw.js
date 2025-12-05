// Đặt tên cache version mới để trình duyệt biết cần cập nhật
const CACHE_NAME = 'clientpro-cache-v2';

// Danh sách các file cần lưu vào bộ nhớ đệm
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  
  // Cập nhật đúng đường dẫn thư mục Css (Viết hoa chữ C)
  './Css/style.css',
  
  // Cập nhật đúng đường dẫn thư mục Js (Viết hoa chữ J)
  './Js/config.js',
  './Js/database.js',
  './Js/security.js',
  './Js/drive.js',
  './Js/map.js',
  './Js/ui.js',
  './Js/app.js',
  
  // Font Awesome (nếu muốn cache luôn)
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// 1. Cài đặt Service Worker và Cache file
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
  // Ép SW mới kích hoạt ngay lập tức thay thế cái cũ
  self.skipWaiting();
});

// 2. Kích hoạt và Xóa cache cũ
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            // Xóa cache cũ đi để nạp code mới
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. Xử lý khi user mở App (Fetch strategy: Cache first, then Network)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Nếu có trong cache thì dùng luôn (nhanh)
        if (response) {
          return response;
        }
        // Nếu chưa có thì tải từ mạng
        return fetch(event.request);
      })
  );
});

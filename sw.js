// ClientPro Service Worker (runtime-first, PWA-safe)
// NOTE: Không cache cứng CDN bằng addAll để tránh lỗi cài đặt SW khi CDN thay đổi.

const VERSION = 'v3.2.0';
const STATIC_CACHE = `clientpro-static-${VERSION}`;
const RUNTIME_CACHE = `clientpro-runtime-${VERSION}`;

// App shell (same-origin) – đảm bảo đúng đường dẫn thực tế
const STATIC_ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './splash-screen.png', './assets/styles.css', './assets/head.js', './assets/pwa.js', './assets/00_globals.js', './assets/01_config.js', './assets/02_security.js', './assets/03_map.js', './assets/04_ui_common.js', './assets/05_customers.js', './assets/06_assets.js', './assets/07_drive.js', './assets/08_images_camera.js', './assets/09_backup_weather_donate.js', './assets/10_bootstrap.js', './assets/11_edge_back_swipe.js', './assets/12_backup_core.js', './assets/13_ui_select_customers.js', './assets/14_cloud_transfer.js'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Xóa cache cũ
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('clientpro-') && k !== STATIC_CACHE && k !== RUNTIME_CACHE)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

function isSameOrigin(request) {
  try {
    const url = new URL(request.url);
    return url.origin === self.location.origin;
  } catch (e) {
    return false;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    cache.put(request, res.clone());
  } catch (e) {}
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const res = await fetch(request);
    try { cache.put(request, res.clone()); } catch (e) {}
    return res;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // fallback app shell
    return caches.match('./index.html');
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((res) => {
      try { cache.put(request, res.clone()); } catch (e) {}
      return res;
    })
    .catch(() => null);
  return cached || (await fetchPromise) || caches.match('./index.html');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Navigations: ưu tiên mạng để nhận bản mới, fallback cache khi offline
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
    return;
  }

  // Same-origin static assets: cache-first
  if (isSameOrigin(req)) {
    const url = new URL(req.url);
    if (url.pathname.includes('/assets/') || url.pathname.endsWith('.png') || url.pathname.endsWith('.json') || url.pathname.endsWith('.css') || url.pathname.endsWith('.js')) {
      event.respondWith(cacheFirst(req));
      return;
    }
    // Other same-origin requests: network-first
    event.respondWith(networkFirst(req));
    return;
  }

  // Cross-origin (CDN): stale-while-revalidate
  event.respondWith(staleWhileRevalidate(req));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

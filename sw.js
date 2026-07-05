// BUILD: 2026-07-05_v1.1.0
// ClientPro Service Worker (runtime-first, PWA-safe)
// NOTE: Không cache cứng CDN bằng addAll để tránh lỗi cài đặt SW khi CDN thay đổi.

// Bump version when changing static asset list / gate behavior
const VERSION = 'v1.1.0';
const STATIC_CACHE = `clientpro-static-${VERSION}`;
// Runtime caches are split by purpose to control growth over long-term use.
const RUNTIME_SAMEORIGIN_CACHE = `clientpro-runtime-so-${VERSION}`;
const RUNTIME_CDN_CACHE = `clientpro-runtime-cdn-${VERSION}`;
const RUNTIME_TILE_CACHE = `clientpro-runtime-tile-${VERSION}`;

// Cache limits (tuned for long-term stability on mobile devices)
const LIMITS = {
  sameOrigin: { maxEntries: 220, maxAgeMs: 30 * 24 * 60 * 60 * 1000 }, // 30 days
  cdn: { maxEntries: 160, maxAgeMs: 14 * 24 * 60 * 60 * 1000 }, // 14 days
  tiles: { maxEntries: 260, maxAgeMs: 30 * 24 * 60 * 60 * 1000 }, // 30 days
};

const META_HEADER = 'sw-cache-time';

// App shell (same-origin) – phải khớp CHÍNH XÁC URL mà index.html request
// (cache.match phân biệt query string, precache URL lệch token là dead weight).
const ASSET_V = '1.1.0';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',

  // Tailwind (self-host)
  './assets/css/tailwind.clientpro.css',
  './assets/css/app.patch.css',
  `./assets/css/redesign.clientpro.css?v=${ASSET_V}`,
  `./assets/styles.css?v=${ASSET_V}`,
  `./assets/head.js?v=${ASSET_V}`,
  `./assets/pwa.js?v=${ASSET_V}`,

  `./assets/00_globals.js?v=${ASSET_V}`,
  `./assets/01_config.js?v=${ASSET_V}`,
  `./assets/02_security.js?v=${ASSET_V}`,
  `./assets/03_map.js?v=${ASSET_V}`,
  `./assets/04_ui_common.js?v=${ASSET_V}`,
  `./assets/05_customers.js?v=${ASSET_V}`,
  `./assets/06_assets.js?v=${ASSET_V}`,
  `./assets/07_drive.js?v=${ASSET_V}`,
  `./assets/08_images_camera.js?v=${ASSET_V}`,
  `./assets/09_menu.js?v=${ASSET_V}`,
  `./assets/09_backup_manager.js?v=${ASSET_V}`,
  `./assets/09_donate.js?v=${ASSET_V}`,
  `./assets/09_weather.js?v=${ASSET_V}`,
  `./assets/10_bootstrap.js?v=${ASSET_V}`,
  `./assets/11_edge_back_swipe.js?v=${ASSET_V}`,
  `./assets/12_backup_core.js?v=${ASSET_V}`,
  `./assets/13_ui_select_customers.js?v=${ASSET_V}`,
  `./assets/14_cloud_transfer.js?v=${ASSET_V}`,
  `./assets/15_auth_gate.js?v=${ASSET_V}`,
  `./assets/16_auto_backup_drive.js?v=${ASSET_V}`,
  `./assets/17_onboarding_tour.js?v=${ASSET_V}`,
  `./assets/18_biometric_unlock.js?v=${ASSET_V}`,

  './assets/ui/load_modals.js',

  './assets/ui/modals/screen-lock.html',
  './assets/ui/modals/setup-lock-modal.html',
  './assets/ui/modals/activation-modal.html',
  './assets/ui/modals/forgot-pin-modal.html',
  './assets/ui/modals/biometric-setup-modal.html',
  './assets/ui/modals/add-modal.html',
  './assets/ui/modals/asset-modal.html',
  './assets/ui/modals/guide-modal.html',
  './assets/ui/modals/approve-modal.html',
  './assets/ui/modals/ref-price-modal.html',
  './assets/ui/modals/donate-modal.html',
  './assets/ui/modals/camera-modal.html',
  './assets/ui/modals/backup-manager-modal.html',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    // cache:'reload' giúp lấy bản mới nhất, tránh dính cache HTTP cũ khi deploy lại
    const reqs = STATIC_ASSETS.map((url) => new Request(url, { cache: 'reload' }));
    await cache.addAll(reqs);
  })());
});

// Allow the page to request immediate activation of a waiting SW.
self.addEventListener('message', (event) => {
  try {
    if (event && event.data && event.data.type === 'SKIP_WAITING') {
      self.skipWaiting();
    }
  } catch (e) { }
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Enable navigation preload when available (faster navigations on supporting browsers)
    try {
      if (self.registration && self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
    } catch (e) { }

    // Xóa cache cũ
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('clientpro-') && ![
          STATIC_CACHE,
          RUNTIME_SAMEORIGIN_CACHE,
          RUNTIME_CDN_CACHE,
          RUNTIME_TILE_CACHE
        ].includes(k))
        .map((k) => caches.delete(k))
    );

    // Dọn cache runtime theo giới hạn
    await Promise.all([
      cleanupCache(RUNTIME_SAMEORIGIN_CACHE, LIMITS.sameOrigin),
      cleanupCache(RUNTIME_CDN_CACHE, LIMITS.cdn),
      cleanupCache(RUNTIME_TILE_CACHE, LIMITS.tiles),
    ]);

    await self.clients.claim();
  })());
});

function isTileRequest(url, request) {
  // Heuristic: tile servers are commonly under tile.* or */tile/*, and destination is image.
  try {
    const host = url.hostname || '';
    const path = url.pathname || '';
    const looksLikeTileHost = host.startsWith('tile.') || host.includes('.tile.') || host.includes('tiles.');
    const looksLikeTilePath = /\/(tile|tiles)\//i.test(path);
    const isImage = request.destination === 'image';
    return isImage && (looksLikeTileHost || looksLikeTilePath);
  } catch (e) {
    return false;
  }
}

function stampResponseIfPossible(response) {
  // Opaque responses (no-cors) cannot be inspected and headers cannot be modified.
  // In that case we rely on maxEntries eviction only.
  try {
    if (!response || response.type === 'opaque') return response;
    const headers = new Headers(response.headers);
    headers.set(META_HEADER, String(Date.now()));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (e) {
    return response;
  }
}

async function cleanupCache(cacheName, policy) {
  const { maxEntries, maxAgeMs } = policy || {};
  const cache = await caches.open(cacheName);

  // Enforce TTL where metadata is available.
  if (maxAgeMs && maxAgeMs > 0) {
    const keys = await cache.keys();
    const now = Date.now();
    for (const req of keys) {
      try {
        const res = await cache.match(req);
        const t = res && res.headers && res.headers.get(META_HEADER);
        if (t && (now - Number(t) > maxAgeMs)) {
          await cache.delete(req);
        }
      } catch (e) {
        // Ignore per-entry errors.
      }
    }
  }

  // Enforce max entries using insertion order (Cache.keys preserves order of insertion).
  if (maxEntries && maxEntries > 0) {
    const keys = await cache.keys();
    const overflow = keys.length - maxEntries;
    if (overflow > 0) {
      await Promise.all(keys.slice(0, overflow).map((req) => cache.delete(req)));
    }
  }
}

function isSameOrigin(request) {
  try {
    const url = new URL(request.url);
    return url.origin === self.location.origin;
  } catch (e) {
    return false;
  }
}

async function cacheFirst(event, request, cacheName, policy) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const res = await fetch(request);
  const toStore = stampResponseIfPossible(res.clone());
  try { await cache.put(request, toStore); } catch (e) { }
  if (event && event.waitUntil) event.waitUntil(cleanupCache(cacheName, policy));
  return res;
}

async function networkFirst(event, request, cacheName, policy) {
  const cache = await caches.open(cacheName);

  // If navigation preload is enabled, use it when available.
  const preload = event && event.preloadResponse ? event.preloadResponse : null;

  try {
    const preloaded = preload ? await preload : null;
    // Bypass the browser HTTP cache for navigations/app-shell updates so a deploy
    // is visible immediately instead of waiting behind an intermediate cache.
    const networkRequest = new Request(request, { cache: 'reload' });
    const res = preloaded || await fetch(networkRequest);
    const toStore = stampResponseIfPossible(res.clone());
    try { await cache.put(request, toStore); } catch (e) { }
    if (event && event.waitUntil) event.waitUntil(cleanupCache(cacheName, policy));
    return res;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return caches.match('./index.html');
  }
}

async function staleWhileRevalidate(event, request, cacheName, policy) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((res) => {
      const toStore = stampResponseIfPossible(res.clone());
      try { cache.put(request, toStore); } catch (e) { }
      if (event && event.waitUntil) event.waitUntil(cleanupCache(cacheName, policy));
      return res;
    })
    .catch(() => null);

  return cached || (await fetchPromise) || caches.match('./index.html');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET. Never interfere with POST/PUT (e.g., transfer endpoints).
  if (req.method !== 'GET') return;

  // Navigations: ưu tiên mạng để nhận bản mới, fallback cache khi offline
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(event, req, RUNTIME_SAMEORIGIN_CACHE, LIMITS.sameOrigin));
    return;
  }

  // Same-origin static assets: cache-first
  if (isSameOrigin(req)) {
    const url = new URL(req.url);
    if (
      url.pathname.includes('/assets/') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.json') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.html')
    ) {
      event.respondWith(cacheFirst(event, req, RUNTIME_SAMEORIGIN_CACHE, LIMITS.sameOrigin));
      return;
    }

    // Other same-origin requests: network-first
    event.respondWith(networkFirst(event, req, RUNTIME_SAMEORIGIN_CACHE, LIMITS.sameOrigin));
    return;
  }

  // Cross-origin (CDN/tiles): stale-while-revalidate
  try {
    const url = new URL(req.url);
    // OSRM routing API: URL chứa tọa độ nên gần như mỗi lần mỗi khác -> không cache
    // vào CDN cache (tránh đẩy các entry maplibre/lucide cần cho offline ra khỏi limit).
    // Return không respondWith = trình duyệt fetch thẳng, SW không can thiệp.
    if (url.hostname === 'router.project-osrm.org' || url.hostname === 'routing.openstreetmap.de') return;
    if (isTileRequest(url, req)) {
      event.respondWith(staleWhileRevalidate(event, req, RUNTIME_TILE_CACHE, LIMITS.tiles));
      return;
    }
  } catch (e) { }

  event.respondWith(staleWhileRevalidate(event, req, RUNTIME_CDN_CACHE, LIMITS.cdn));
});

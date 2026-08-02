// ClientPro Service Worker — offline-first cache and update lifecycle.
// Bump version when changing static assets or cache behavior.
const VERSION = 'v1.5.3';
// Cache generation identifier. Bump for every major public release.
const CACHE_EPOCH = 'genesis';
const STATIC_CACHE = `clientpro-${CACHE_EPOCH}-static-${VERSION}`;
// Runtime caches are split by purpose to control growth over long-term use.
const RUNTIME_SAMEORIGIN_CACHE = `clientpro-${CACHE_EPOCH}-runtime-so-${VERSION}`;
const RUNTIME_CDN_CACHE = `clientpro-${CACHE_EPOCH}-runtime-cdn-${VERSION}`;
const RUNTIME_TILE_CACHE = `clientpro-${CACHE_EPOCH}-runtime-tile-${VERSION}`;

// Cache limits (tuned for long-term stability on mobile devices)
const LIMITS = {
  sameOrigin: { maxEntries: 220, maxAgeMs: 30 * 24 * 60 * 60 * 1000 }, // 30 days
  cdn: { maxEntries: 160, maxAgeMs: 14 * 24 * 60 * 60 * 1000 }, // 14 days
  tiles: { maxEntries: 260, maxAgeMs: 30 * 24 * 60 * 60 * 1000 }, // 30 days
};

const META_HEADER = 'sw-cache-time';

// App shell (same-origin) – phải khớp CHÍNH XÁC URL mà index.html request
// (cache.match phân biệt query string, precache URL lệch token là dead weight).
const ASSET_V = 'STORAGE_RESILIENCE_20260802';
const CRITICAL_ASSETS = [
  './',
  './index.html',
  './manifest.json',

  // Cold-start shell: crypto, icons, CSS và code nghiệp vụ luôn phải đủ bộ.
  `./assets/vendor/lucide.min.js?v=${ASSET_V}`,
  `./assets/vendor/crypto-js.min.js?v=${ASSET_V}`,
  `./assets/css/fonts.css?v=${ASSET_V}`,
  `./assets/css/tailwind.clientpro.css?v=${ASSET_V}`,
  `./assets/css/redesign.clientpro.css?v=${ASSET_V}`,
  `./assets/styles.css?v=${ASSET_V}`,
  `./assets/head.js?v=${ASSET_V}`,
  `./assets/pwa.js?v=${ASSET_V}`,
  `./assets/ui/load_modals.js?v=${ASSET_V}`,

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
  `./assets/19_error_loading.js?v=${ASSET_V}`,

  // Năm cổng bảo mật phải có ngay ở cold start.
  `./assets/ui/modals/screen-lock.html?v=${ASSET_V}`,
  `./assets/ui/modals/setup-lock-modal.html?v=${ASSET_V}`,
  `./assets/ui/modals/activation-modal.html?v=${ASSET_V}`,
  `./assets/ui/modals/forgot-pin-modal.html?v=${ASSET_V}`,
  `./assets/ui/modals/biometric-setup-modal.html?v=${ASSET_V}`,
];

const DEFERRED_ASSETS = [
  // App identity + fonts được dùng sau khi shell đã có thể khởi động.
  './favicon.ico',
  './icon-192.png',
  './icon-512.png',
  './icon-192-maskable.png',
  './icon-512-maskable.png',
  './assets/fonts/be-vietnam-pro-400-latin.woff2',
  './assets/fonts/be-vietnam-pro-400-vietnamese.woff2',
  './assets/fonts/be-vietnam-pro-500-latin.woff2',
  './assets/fonts/be-vietnam-pro-500-vietnamese.woff2',
  './assets/fonts/be-vietnam-pro-600-latin.woff2',
  './assets/fonts/be-vietnam-pro-600-vietnamese.woff2',
  './assets/fonts/be-vietnam-pro-700-latin.woff2',
  './assets/fonts/be-vietnam-pro-700-vietnamese.woff2',
  './assets/fonts/be-vietnam-pro-800-latin.woff2',
  './assets/fonts/be-vietnam-pro-800-vietnamese.woff2',
  './assets/fonts/be-vietnam-pro-900-latin.woff2',
  './assets/fonts/be-vietnam-pro-900-vietnamese.woff2',

  // Vendor lazy-load (map + PDF Toolkit), vẫn top-up dần để hội tụ offline đầy đủ.
  `./assets/vendor/maplibre-gl.js?v=${ASSET_V}`,
  `./assets/vendor/maplibre-gl.css?v=${ASSET_V}`,
  `./assets/vendor/supercluster.min.js?v=${ASSET_V}`,
  `./assets/vendor/pdf-lib.min.js?v=${ASSET_V}`,
  `./assets/vendor/jszip.min.js?v=${ASSET_V}`,
  `./assets/vendor/pdf.min.mjs?v=${ASSET_V}`,
  `./assets/vendor/pdf.worker.min.mjs?v=${ASSET_V}`,

  `./assets/css/features.css?v=${ASSET_V}`,

  // PDF Toolkit — module độc lập (xử lý file trên thiết bị, hoạt động offline)
  `./assets/css/pdf-toolkit.css?v=${ASSET_V}`,
  `./assets/pdf-toolkit/pdf_toolkit_utils.js?v=${ASSET_V}`,
  `./assets/pdf-toolkit/pdf_toolkit_core.js?v=${ASSET_V}`,
  `./assets/pdf-toolkit/pdf_toolkit_merge.js?v=${ASSET_V}`,
  `./assets/pdf-toolkit/pdf_toolkit_pages.js?v=${ASSET_V}`,
  `./assets/pdf-toolkit/pdf_toolkit_images.js?v=${ASSET_V}`,
  `./assets/pdf-toolkit/pdf_toolkit_pdf2img.js?v=${ASSET_V}`,
  `./assets/pdf-toolkit/pdf_toolkit_compress.js?v=${ASSET_V}`,
  `./assets/pdf-toolkit/pdf_toolkit_ui.js?v=${ASSET_V}`,
  `./assets/css/dvhc-lookup.css?v=${ASSET_V}`,
  `./assets/dvhc-lookup/dvhc_utils.js?v=${ASSET_V}`,
  `./assets/dvhc-lookup/dvhc_data.js?v=${ASSET_V}`,
  `./assets/dvhc-lookup/dvhc_ui.js?v=${ASSET_V}`,
  `./assets/data/dvhc/dvhc.v1.json?v=${ASSET_V}`,

  // Document scanner (lazy at camera open; precached for offline)
  `./assets/document-scanner/document-geometry.js?v=${ASSET_V}`,
  `./assets/document-scanner/document-image-enhance.js?v=${ASSET_V}`,
  `./assets/document-scanner/document-scanner.js?v=${ASSET_V}`,
  `./assets/document-scanner/document-detector.worker.js?v=${ASSET_V}`,

  // Modal nghiệp vụ lazy-load; URL vẫn versioned để không nhận fragment cũ.
  `./assets/ui/modals/add-modal.html?v=${ASSET_V}`,
  `./assets/ui/modals/asset-modal.html?v=${ASSET_V}`,
  `./assets/ui/modals/guide-modal.html?v=${ASSET_V}`,
  `./assets/ui/modals/approve-modal.html?v=${ASSET_V}`,
  `./assets/ui/modals/ref-price-modal.html?v=${ASSET_V}`,
  `./assets/ui/modals/donate-modal.html?v=${ASSET_V}`,
  `./assets/ui/modals/camera-modal.html?v=${ASSET_V}`,
  `./assets/ui/modals/backup-manager-modal.html?v=${ASSET_V}`,
];

// Danh sách đầy đủ vẫn là nguồn chung cho activate top-up và unit test.
const STATIC_ASSETS = [...CRITICAL_ASSETS, ...DEFERRED_ASSETS];
const CRITICAL_CHUNK_SIZE = 10;
const DEFERRED_CONCURRENCY = 6;

function _precacheRequest(url) {
  return new Request(url, { cache: 'reload' });
}

async function _retryOnce(operation) {
  try {
    return await operation();
  } catch (firstError) {
    return operation();
  }
}

async function _cacheCriticalAssets(cache) {
  for (let i = 0; i < CRITICAL_ASSETS.length; i += CRITICAL_CHUNK_SIZE) {
    const requests = CRITICAL_ASSETS
      .slice(i, i + CRITICAL_CHUNK_SIZE)
      .map(_precacheRequest);
    await _retryOnce(() => cache.addAll(requests));
  }
}

async function _cacheDeferredAssets(cache, urls, phase) {
  let failed = 0;
  for (let i = 0; i < urls.length; i += DEFERRED_CONCURRENCY) {
    const batch = urls.slice(i, i + DEFERRED_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((url) => (
      _retryOnce(() => cache.add(_precacheRequest(url)))
    )));
    failed += results.filter((result) => result.status === 'rejected').length;
  }
  if (failed > 0) {
    console.warn(`[ClientPro SW] ${phase}: chưa cache được ${failed}/${urls.length} asset; tiếp tục best-effort.`);
  }
  return failed;
}

function _absoluteAssetUrl(value) {
  const raw = typeof value === 'string' ? value : value && value.url;
  try {
    const base = self.location.href || `${self.location.origin}/`;
    return new URL(raw, base).href;
  } catch (e) {
    return String(raw || '');
  }
}

async function _topUpStaticAssets(phase) {
  try {
    const cache = await caches.open(STATIC_CACHE);
    const present = new Set((await cache.keys()).map(_absoluteAssetUrl));
    const missing = STATIC_ASSETS.filter((url) => !present.has(_absoluteAssetUrl(url)));
    if (missing.length > 0) {
      await _cacheDeferredAssets(cache, missing, phase);
    }
  } catch (e) {
    console.warn(`[ClientPro SW] ${phase} bỏ qua do Cache Storage/network lỗi.`);
  }
}

// Activate chỉ chạy một lần. Trang sẽ yêu cầu top-up lại sau unlock/online; gom
// các tín hiệu đồng thời vào cùng một promise để không tải trùng cả danh sách.
let __staticTopUpInFlight = null;
function _requestStaticTopUp(phase) {
  if (!__staticTopUpInFlight) {
    const tracked = _topUpStaticAssets(phase).finally(() => {
      if (__staticTopUpInFlight === tracked) __staticTopUpInFlight = null;
    });
    __staticTopUpInFlight = tracked;
  }
  return __staticTopUpInFlight;
}

self.addEventListener('install', (event) => {
  // KHÔNG skipWaiting() ở install: SW mới chờ theo lifecycle chuẩn (đóng hết
  // tab / mở lại app) rồi mới activate — build mới được phục vụ NGUYÊN KHỐI
  // (HTML + asset cùng phiên bản), không bao giờ tự tạo mixed-version giữa
  // phiên hay reload làm mất nội dung người dùng đang nhập. Trang vẫn có thể
  // chủ động kích hoạt sớm qua message SKIP_WAITING bên dưới (hook có-đồng-thuận).
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    // Critical fail-closed theo chunk; deferred best-effort để một file lazy lỗi
    // không làm mất toàn bộ khả năng offline của phiên cài đặt.
    await _cacheCriticalAssets(cache);
    await _cacheDeferredAssets(cache, DEFERRED_ASSETS, 'install');
  })());
});

// Allow the page to request immediate activation of a waiting SW.
self.addEventListener('message', (event) => {
  try {
    if (event && event.data && event.data.type === 'SKIP_WAITING') {
      self.skipWaiting();
    } else if (event && event.data && event.data.type === 'TOP_UP_STATIC_ASSETS') {
      const pending = _requestStaticTopUp('lifecycle top-up');
      if (typeof event.waitUntil === 'function') event.waitUntil(pending);
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

    // Dọn cache ngoài allowlist
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
    // Hội tụ cache về đủ bề mặt offline sau một lần install chập chờn. Helper này
    // luôn best-effort, nên activate không thất bại chỉ vì asset lazy còn thiếu.
    // Nếu mạng vẫn lỗi, trang sẽ gọi lại sau unlock/online thay vì kẹt vĩnh viễn.
    await _requestStaticTopUp('activate top-up');
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
  // 1) Precache của ĐÚNG build này trước (exact match, kể cả query ?v=).
  //    KHÔNG dùng caches.match() không scope — trong cửa sổ upgrade nó có thể
  //    trả asset từ namespace của cache khác chưa bị activate dọn.
  try {
    const staticCache = await caches.open(STATIC_CACHE);
    const pre = await staticCache.match(request);
    if (pre) return pre;
  } catch (e) { }

  // 2) Runtime cache same-origin của build này.
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  // 3) Network — chỉ response hợp lệ (res.ok) mới được lưu vào runtime cache;
  //    không cache response lỗi (4xx/5xx) để không "đóng băng" trạng thái hỏng.
  const res = await fetch(request);
  if (res && res.ok) {
    const toStore = stampResponseIfPossible(res.clone());
    try { await cache.put(request, toStore); } catch (e) { }
  }
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
    // Chỉ cache response hợp lệ (res.ok) — giống guard trong cacheFirst. Response
    // lỗi (4xx/5xx) mà put vào cache sẽ ghi đè bản shell tốt và "đóng băng" trang
    // lỗi cho lần mở offline tiếp theo.
    if (res && res.ok) {
      const toStore = stampResponseIfPossible(res.clone());
      try { await cache.put(request, toStore); } catch (e) { }
    }
    if (event && event.waitUntil) event.waitUntil(cleanupCache(cacheName, policy));
    return res;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return caches.match('./index.html');
  }
}

// Navigations: trả cache ngay (mở app tức thì), revalidate ngầm phía sau.
// Bản deploy mới sẽ áp dụng ở lần mở tiếp theo. Revalidate dùng cache:'reload'
// để xuyên qua HTTP cache trung gian (giữ hành vi cũ của networkFirst).
async function navigationStaleWhileRevalidate(event, request, cacheName, policy) {
  const cache = await caches.open(cacheName);
  const cached =
    (await cache.match(request)) ||
    (await caches.match(request)) ||
    (await caches.match('./index.html'));

  const preload = event && event.preloadResponse ? event.preloadResponse : null;
  const revalidate = (async () => {
    const preloaded = preload ? await preload : null;
    const res = preloaded || (await fetch(new Request(request, { cache: 'reload' })));
    // Chỉ cache response hợp lệ (res.ok): một lỗi 5xx thoáng qua khi revalidate
    // nền không được ghi đè navigation cache tốt (nếu không, lần mở app tiếp
    // theo — nhất là offline — sẽ phục vụ trang lỗi thay vì app shell thật).
    if (res && res.ok) {
      const toStore = stampResponseIfPossible(res.clone());
      try { await cache.put(request, toStore); } catch (e) { }
    }
    await cleanupCache(cacheName, policy);
    return res;
  })().catch(() => null);

  if (cached) {
    if (event && event.waitUntil) event.waitUntil(revalidate);
    return cached;
  }
  return (await revalidate) || caches.match('./index.html');
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

  // Navigations: mở ngay từ cache (app shell đã precache), tải bản mới ngầm
  // phía sau — bản mới áp dụng ở lần mở kế tiếp (stale-while-revalidate).
  if (req.mode === 'navigate') {
    event.respondWith(navigationStaleWhileRevalidate(event, req, RUNTIME_SAMEORIGIN_CACHE, LIMITS.sameOrigin));
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

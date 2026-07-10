// --- MAP SYSTEM VARIABLES ---
let map = null; let markers = []; let mapResizeObserver = null;
let __mapClusterIndex = null;
let __mapFeatures = [];
let __mapClusterHandlers = null;
let __superclusterLoadPromise = null;
const MAP_CLUSTER_MIN_ZOOM = 0;
const MAP_CLUSTER_MAX_ZOOM = 16;
const MAP_CLUSTER_RADIUS = 56;
// Cache-buster lazy-load maplibre/supercluster — phải khớp ASSET_V trong sw.js (CI kiểm tra 1 nguồn duy nhất).
const MAPLIBRE_V = 'V1511_20260710';
const MAP_STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const MAP_STYLE_SAT = {
    version: 8,
    sources: {
        esri: {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            attribution: ''
        }
    },
    layers: [{ id: 'esri', type: 'raster', source: 'esri' }]
};

// --- LAZY-LOAD MAPLIBRE GL JS (only when opening Map screen) ---
// index.html must NOT load MapLibre in <head>. Map screen will load it on demand.
let __mapLibreLoadPromise = null;
function __injectOnce(tagName, attrs, id) {
    if (id && document.getElementById(id)) return document.getElementById(id);
    const el = document.createElement(tagName);
    if (id) el.id = id;
    Object.keys(attrs || {}).forEach(k => {
        if (k === 'text') el.textContent = attrs[k];
        else el.setAttribute(k, attrs[k]);
    });
    (tagName === 'link' ? document.head : document.body).appendChild(el);
    return el;
}

function __loadScript(src, id, timeoutMs) {
    return new Promise((resolve, reject) => {
        // Already loaded?
        if (window.maplibregl && window.maplibregl.Map) return resolve(true);
        const existing = id ? document.getElementById(id) : null;
        if (existing && existing.getAttribute('data-loaded') === '1') return resolve(true);

        const s = existing || __injectOnce('script', { src, defer: 'defer' }, id);
        let done = false;
        const to = setTimeout(() => {
            if (done) return;
            done = true;
            reject(new Error('MapLibre script timeout'));
        }, timeoutMs || 15000);

        s.onload = () => {
            if (done) return;
            done = true;
            clearTimeout(to);
            s.setAttribute('data-loaded', '1');
            resolve(true);
        };
        s.onerror = () => {
            if (done) return;
            done = true;
            clearTimeout(to);
            reject(new Error('MapLibre script load failed'));
        };
    });
}

function __loadCss(href, id) {
    return new Promise((resolve) => {
        const l = __injectOnce('link', { rel: 'stylesheet', href }, id);
        // CSS load events are not fully reliable cross-browser, so we resolve quickly.
        l.onload = () => resolve(true);
        l.onerror = () => resolve(false);
        setTimeout(() => resolve(true), 250);
    });
}

async function ensureMapLibreLoaded() {
    if (window.maplibregl && window.maplibregl.Map) return true;
    if (__mapLibreLoadPromise) return __mapLibreLoadPromise;

    __mapLibreLoadPromise = (async () => {
        // Self-host (maplibre-gl 4.7.1, xem assets/vendor/README.md) — không dùng CDN ngoài.
        // Query ?v= phải khớp STATIC_ASSETS trong sw.js để precache dùng lại được.
        const cssLocal = `./assets/vendor/maplibre-gl.css?v=${MAPLIBRE_V}`;
        const jsLocal = `./assets/vendor/maplibre-gl.js?v=${MAPLIBRE_V}`;

        await __loadCss(cssLocal, 'maplibre-css');
        await __loadScript(jsLocal, 'maplibre-js', 15000);

        if (!(window.maplibregl && window.maplibregl.Map)) {
            throw new Error('MapLibre GL JS not available after load');
        }
        return true;
    })();

    return __mapLibreLoadPromise.catch(err => {
        __mapLibreLoadPromise = null;
        ErrorHandler.showError('NETWORK', 'Không tải được bản đồ. Vui lòng kiểm tra mạng.', err);
        return false;
    });
}

async function ensureSuperclusterLoaded() {
    if (window.Supercluster) return true;
    if (__superclusterLoadPromise) return __superclusterLoadPromise;
    __superclusterLoadPromise = __loadScript(`./assets/vendor/supercluster.min.js?v=${MAPLIBRE_V}`, 'supercluster-js', 10000)
        .then(() => !!(window.Supercluster))
        .catch(() => false);
    return __superclusterLoadPromise;
}

// --- GPS FEATURE V1.2 (đa tầng dự phòng, tránh lỗi "Hết thời gian chờ") ---
let __gpsBusy = false;

function __gpsFillResult(position) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    // Tạo link chuẩn cho Google Maps (Search Query)
    const mapLink = `https://www.google.com/maps?q=${lat},${lng}`;

    const inputLink = getEl('asset-link');
    if (inputLink) inputLink.value = mapLink;

    const acc = Math.round(position.coords.accuracy || 0);
    ErrorHandler.showSuccess(acc > 0 ? `Đã lấy tọa độ (sai số ~${acc}m)` : "Đã lấy tọa độ thành công");
}

function __gpsGetOnce(options) {
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });
}

// Dùng watchPosition để giữ chip GPS hoạt động liên tục trong lúc dò vệ tinh —
// trên nhiều máy Android, getCurrentPosition(highAccuracy) bị timeout trong khi
// watchPosition vẫn nhận được fix. Trả về fix đầu tiên đủ tốt (<=100m),
// hoặc fix tốt nhất nhận được khi hết giờ.
function __gpsWatchFirstFix(timeoutMs) {
    return new Promise((resolve, reject) => {
        let best = null;
        let watchId = null;
        let timer = null;
        const stop = () => {
            if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
            if (timer) { clearTimeout(timer); timer = null; }
        };
        timer = setTimeout(() => {
            stop();
            if (best) resolve(best);
            else reject({ code: 3 }); // TIMEOUT
        }, timeoutMs);
        watchId = navigator.geolocation.watchPosition(
            (pos) => {
                if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos;
                if (pos.coords.accuracy <= 100) { stop(); resolve(pos); }
            },
            (err) => {
                if (err.code === err.PERMISSION_DENIED) { stop(); reject(err); }
                // Lỗi tạm thời (unavailable/timeout nội bộ): tiếp tục chờ đến hết giờ
            },
            { enableHighAccuracy: true, maximumAge: 0 }
        );
    });
}

async function getCurrentGPS() {
    if (!navigator.geolocation) {
        ErrorHandler.showError('MAP', "Thiết bị không hỗ trợ định vị GPS.");
        return;
    }
    if (window.isSecureContext === false) {
        ErrorHandler.showError('MAP', "GPS chỉ hoạt động qua kết nối HTTPS.");
        return;
    }
    if (__gpsBusy) return;
    __gpsBusy = true;

    const loaderText = getEl('loader-text');
    LoadingManager.showGlobal("Đang lấy tọa độ...");

    try {
        // Tầng 1: hỏi nhanh — chấp nhận vị trí hệ thống vừa đo trong 30s gần nhất
        try {
            __gpsFillResult(await __gpsGetOnce({ enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }));
            return;
        } catch (e1) {
            if (e1 && e1.code === 1) throw e1; // bị chặn quyền → báo ngay, không thử tiếp
        }

        // Tầng 2: giữ GPS chạy liên tục để chờ khoá vệ tinh (tối đa 15s)
        loaderText.textContent = "GPS yếu, đang dò vệ tinh...";
        try {
            __gpsFillResult(await __gpsWatchFirstFix(15000));
            return;
        } catch (e2) {
            if (e2 && e2.code === 1) throw e2;
        }

        // Tầng 3: vị trí gần đúng qua Wi-Fi/mạng di động (gần như luôn có ngay)
        loaderText.textContent = "Đang lấy vị trí gần đúng...";
        __gpsFillResult(await __gpsGetOnce({ enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 }));
    } catch (error) {
        let msg = "Lỗi GPS";
        switch (error && error.code) {
            case 1: msg = "Bạn đã chặn quyền GPS. Hãy cấp lại quyền Vị trí cho trình duyệt."; break;
            case 2: msg = "Không tìm thấy vị trí. Hãy bật Định vị (Location) của thiết bị."; break;
            case 3: msg = "Hết thời gian chờ. Hãy bật Định vị, ra nơi thoáng rồi thử lại."; break;
        }
        ErrorHandler.showError('MAP', msg, error);
    } finally {
        LoadingManager.hideGlobal(true);
        __gpsBusy = false;
    }
}

// --- SMART LOCATION PARSER V2 (Fix lệch) ---
function parseLatLngFromLink(input) {
    if (!input) return null;
    const str = input.trim();

    const regexRaw = /^(-?\d{1,3}\.\d+)[,\s]+(-?\d{1,3}\.\d+)$/;
    let match = str.match(regexRaw);
    if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };

    match = str.match(/!3d(-?\d+(\.\d+)?)!4d(-?\d+(\.\d+)?)/);
    if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[3]) };

    match = str.match(/[?&]q=(-?\d+(\.\d+)?),(-?\d+(\.\d+)?)/);
    if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[3]) };

    match = str.match(/@(-?\d+(\.\d+)?),(-?\d+(\.\d+)?)/);
    if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[3]) };

    return null;
}

function distanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --- QUÃNG ĐƯỜNG ĐƯỜNG BỘ (OSRM Table service, 1 request cho cả batch) ---
// Gọi 1 server trong OSRM_TABLE_URLS; lỗi thì thử server kế tiếp.
// Trả về JSON đã kiểm tra cấu trúc, hoặc throw.
async function __osrmFetchTable(baseUrl, coordsStr) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ROAD_DIST_TIMEOUT_MS);
    try {
        const res = await fetch(`${baseUrl}${coordsStr}?sources=0&annotations=distance`, { signal: controller.signal });
        if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
        const json = await res.json();
        if (!json || json.code !== 'Ok' || !json.distances || !Array.isArray(json.distances[0])) {
            throw new Error('OSRM response không hợp lệ');
        }
        return json;
    } finally {
        clearTimeout(timer);
    }
}

// origin: {lat,lng}; points: Array<{lat,lng}>
// Resolve: Array<{d, conf}|null> cùng độ dài points, trong đó:
//   - d:    mét đường bộ (number)
//   - conf: 'high' (điểm bám đường <= ROAD_DIST_SNAP_GOOD_M ở cả 2 đầu)
//           | 'med' (bám xa hơn nhưng vẫn <= ROAD_DIST_SNAP_MAX_M — kết quả tương đối)
//   - null: không định tuyến được hoặc kết quả không đáng tin -> caller giữ haversine
// hoặc resolve null nếu toàn bộ request thất bại -> caller giữ nguyên haversine.
// Kiểm tra chất lượng kết quả: OSRM "bám" tọa độ vào đường gần nhất KHÔNG giới hạn bán kính,
// nên nơi bản đồ thiếu đường (khu mới, ngõ nhỏ) điểm bám có thể cách tọa độ thật rất xa
// -> quãng đường sai hoàn toàn. Ta đọc khoảng cách bám (waypoint.distance) để loại các
// kết quả đó, loại kết quả ngắn hơn đường chim bay (phi lý), và loại kết quả vòng vèo
// quá tỉ lệ ROAD_DIST_MAX_DETOUR_RATIO so với chim bay (thường do bản đồ thiếu đường nối).
// Không dùng option `radiuses` của OSRM để giới hạn bán kính bám: chỉ cần 1 tọa độ không
// bám được là cả batch trả lỗi NoSegment -> mất luôn kết quả của các điểm còn lại.
// Không bao giờ reject. Tọa độ (đã giải mã) được gửi tới server OSRM công cộng,
// tương đương việc app đã gửi GPS tới Open-Meteo cho thời tiết.
async function fetchRoadDistances(origin, points) {
    const r5 = (v) => Math.round(v * 1e5) / 1e5;
    const oLat = r5(origin.lat), oLng = r5(origin.lng);
    const pts = points.map((p) => ({ lat: r5(p.lat), lng: r5(p.lng) }));

    // Dọn cache phiên bản cũ (có thể chứa quãng đường sai)
    try { (ROAD_DIST_CACHE_OLD_KEYS || []).forEach((k) => localStorage.removeItem(k)); } catch (e) { }

    let cache = {};
    try {
        cache = JSON.parse(localStorage.getItem(ROAD_DIST_CACHE_KEY)) || {};
    } catch (e) { cache = {}; }

    const now = Date.now();
    const results = new Array(pts.length).fill(undefined);
    const pending = []; // các index chưa có cache

    pts.forEach((p, i) => {
        const entry = cache[`${oLat},${oLng}|${p.lat},${p.lng}`];
        if (entry && (now - entry.t) < ROAD_DIST_CACHE_TTL) {
            // entry: {d: number|null, c?: 'high'|'med', t} — null = cặp không định tuyến được
            results[i] = (typeof entry.d === 'number')
                ? { d: entry.d, conf: entry.c === 'high' ? 'high' : 'med' }
                : null;
        } else {
            pending.push(i);
        }
    });

    if (pending.length > 0) {
        const coords = [`${oLng},${oLat}`]
            .concat(pending.map((i) => `${pts[i].lng},${pts[i].lat}`))
            .join(';');

        let json = null;
        for (let u = 0; u < OSRM_TABLE_URLS.length && !json; u++) {
            try {
                json = await __osrmFetchTable(OSRM_TABLE_URLS[u], coords);
            } catch (err) {
                console.warn(`fetchRoadDistances (${OSRM_TABLE_URLS[u]}):`, err && err.message ? err.message : err);
            }
        }

        if (!json) {
            // Không cache lỗi: nếu không có gì từ cache thì báo thất bại toàn phần
            if (pending.length === pts.length) return null;
            pending.forEach((i) => { results[i] = null; });
            return results;
        }

        const row = json.distances[0];
        const dstWps = json.destinations || [];
        const srcWp = json.sources && json.sources[0];
        const originSnap = (srcWp && typeof srcWp.distance === 'number') ? srcWp.distance : 0;

        pending.forEach((i, k) => {
            const d = row[k + 1]; // index 0 là chính origin
            let out = null;
            if (typeof d === 'number') {
                const wp = dstWps[k + 1];
                const destSnap = (wp && typeof wp.distance === 'number') ? wp.distance : 0;
                const snapWorst = Math.max(originSnap, destSnap);
                const straight = distanceMeters(oLat, oLng, pts[i].lat, pts[i].lng);
                if (snapWorst > ROAD_DIST_SNAP_MAX_M) {
                    // Điểm bám đường quá xa tọa độ thật -> quãng đường không đáng tin
                } else if (d + originSnap + destSnap + 50 < straight) {
                    // Đường bộ ngắn hơn đường chim bay (đã trừ sai số điểm bám) là phi lý
                } else if (straight >= ROAD_DIST_DETOUR_MIN_STRAIGHT_M && d > straight * ROAD_DIST_MAX_DETOUR_RATIO) {
                    // Vòng vèo phi lý so với chim bay -> thường do bản đồ thiếu đường nối
                } else {
                    out = { d: d, conf: snapWorst <= ROAD_DIST_SNAP_GOOD_M ? 'high' : 'med' };
                }
            }
            results[i] = out;
            cache[`${oLat},${oLng}|${pts[i].lat},${pts[i].lng}`] = out
                ? { d: out.d, c: out.conf, t: now }
                : { d: null, t: now };
        });

        try {
            const keys = Object.keys(cache);
            if (keys.length > ROAD_DIST_CACHE_MAX) {
                keys.sort((a, b) => (cache[a].t || 0) - (cache[b].t || 0))
                    .slice(0, keys.length - ROAD_DIST_CACHE_MAX)
                    .forEach((k) => delete cache[k]);
            }
            localStorage.setItem(ROAD_DIST_CACHE_KEY, JSON.stringify(cache));
        } catch (e) { /* quota đầy -> chạy không cache */ }
    }

    return results;
}

// parseMoneyToNumber canonical implementation is loaded from assets/10_bootstrap.js.

// --- AI-LITE CHO ẢNH TÀI LIỆU (giảm noise, nền trắng, chữ nét) ---

// --- MAP FUNCTIONS ---
async function toggleMap() {
    const mapScreen = getEl('screen-map');
    if (mapScreen.classList.contains('translate-x-full')) {
        // Slide-in first (avoid blocking animation with heavy map work)
        if (typeof slideScreenIn === 'function') slideScreenIn(mapScreen);
        else if (typeof nextFrame === 'function') nextFrame(() => mapScreen.classList.remove('translate-x-full'));
        else mapScreen.classList.remove('translate-x-full');

        // Lightweight loading overlay while MapLibre/markers are prepared
        try {
            const mc = getEl('map-container');
            if (mc && !getEl('map-loading')) {
                const ov = document.createElement('div');
                ov.id = 'map-loading';
                ov.style.position = 'absolute';
                ov.style.inset = '0';
                ov.style.display = 'flex';
                ov.style.alignItems = 'center';
                ov.style.justifyContent = 'center';
                ov.style.background = 'rgba(0,0,0,0.6)';
                ov.style.backdropFilter = 'blur(8px)';
                ov.style.zIndex = '350';
                ov.innerHTML = '<div class="glass-panel" style="padding:14px 16px;border-radius:16px;border:1px solid rgba(255,255,255,0.1);color:#fff;font-weight:700;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Đang tải bản đồ...</div>';
                // map-container is inside screen-map; ensure relative positioning
                if (mc.parentElement && getComputedStyle(mc.parentElement).position === 'static') {
                    mc.parentElement.style.position = 'relative';
                }
                mc.parentElement.appendChild(ov);
            }
        } catch (e) { }

        const ok = await ensureMapLibreLoaded();
        if (!ok) {
            try { const ov = getEl('map-loading'); if (ov) ov.remove(); } catch (e) { }
            return;
        }

        // Defer init + marker rendering until after the slide-in ends (prevents jank)
        const doInit = () => {
            try {
                if (!map) initMap(); else renderMapMarkers();
                // Fix black/blank map when container was hidden during init
                setTimeout(() => { if (map) map.resize(); }, 80);
                setTimeout(() => { if (map) map.resize(); }, 380);
            } catch (e) {
                ErrorHandler.showError('MAP', 'Lỗi khởi tạo bản đồ.', e);
            } finally {
                try { const ov = getEl('map-loading'); if (ov) ov.remove(); } catch (e) { }
            }
        };
        if (typeof afterTransition === 'function') afterTransition(mapScreen, doInit);
        else setTimeout(doInit, 360);
    } else {
        if (typeof slideScreenOut === 'function') slideScreenOut(mapScreen);
        else mapScreen.classList.add('translate-x-full');
    }
}

function initMap() {
    map = new maplibregl.Map({
        container: 'map-container',
        style: MAP_STYLE_DARK,
        center: [105.8542, 21.0285], // Default Hanoi
        zoom: 12,
        attributionControl: false
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
    map.addControl(createMapStyleControl(), 'top-right');
    observeMapResize();

    map.once('load', renderMapMarkers);
}

function observeMapResize() {
    const container = getEl('map-container');
    if (!container || typeof ResizeObserver === 'undefined') return;
    if (mapResizeObserver) mapResizeObserver.disconnect();
    mapResizeObserver = new ResizeObserver(() => { if (map) map.resize(); });
    mapResizeObserver.observe(container);
}

function destroyMap() {
    if (mapResizeObserver) {
        mapResizeObserver.disconnect();
        mapResizeObserver = null;
    }
    if (map && __mapClusterHandlers) {
        map.off('moveend', __mapClusterHandlers.move);
        map.off('zoomend', __mapClusterHandlers.zoom);
        __mapClusterHandlers = null;
    }
    markers.forEach(m => m.remove());
    markers = [];
    __mapClusterIndex = null;
    __mapFeatures = [];
    if (typeof __meMarker !== 'undefined' && __meMarker) { try { __meMarker.remove(); } catch (e) { } __meMarker = null; }
    if (map) {
        map.remove();
        map = null;
    }
}

function _clearMapMarkers() {
    markers.forEach(m => m.remove());
    markers = [];
}

function _attachMapClusterHandlers() {
    if (!map || __mapClusterHandlers) return;
    // Debounce: _paintMapClusters clear + rebuild toàn bộ marker DOM + popup —
    // pinch-zoom/pan bắn nhiều moveend/zoomend liên tiếp, chỉ repaint lần cuối.
    const handler = (typeof debounce === 'function')
        ? debounce(() => { _paintMapClusters(); }, 120)
        : () => { _paintMapClusters(); };
    __mapClusterHandlers = { move: handler, zoom: handler };
    map.on('moveend', handler);
    map.on('zoomend', handler);
}

function _createClusterMarkerEl(count) {
    const el = document.createElement('div');
    el.className = 'map-cluster-marker';
    const size = count < 10 ? 36 : count < 50 ? 42 : 48;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.textContent = String(count);
    return el;
}

function _createPointMarkerEl(isApproved) {
    const markerEl = document.createElement('div');
    markerEl.className = 'custom-div-icon';
    const markerClass = isApproved ? 'marker-approved' : 'marker-pending';
    markerEl.innerHTML = `<div class="marker-glow ${markerClass}"></div>`;
    return markerEl;
}

function _buildMapPopupCard(props) {
    const { custId, custName, assetName, assetVal, isApproved, loc, thumb } = props;
    const card = document.createElement('div');
    card.className = 'map-popup-card';
    card.dataset.custId = custId;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    const imgEl = document.createElement('img');
    imgEl.className = 'map-popup-img';
    imgEl.alt = '';
    imgEl.src = thumb;
    card.appendChild(imgEl);

    const row = document.createElement('div');
    row.className = 'flex justify-between items-start';

    const infoDiv = document.createElement('div');
    const statusSpan = document.createElement('span');
    statusSpan.className = isApproved ? 'map-tag approved' : 'map-tag pending';
    statusSpan.textContent = isApproved ? 'Đã Duyệt' : 'Thẩm định';
    infoDiv.appendChild(statusSpan);

    const nameDiv = document.createElement('div');
    nameDiv.className = 'font-bold text-sm truncate w-40';
    const safeCust = (typeof _looksEncrypted === 'function' && _looksEncrypted(custName)) ? '—' : (custName || '—');
    nameDiv.textContent = safeCust;
    infoDiv.appendChild(nameDiv);

    const assetDiv = document.createElement('div');
    assetDiv.className = 'text-[10px] text-slate-400 truncate w-40';
    const safeAsset = (typeof _looksEncrypted === 'function' && _looksEncrypted(assetName)) ? '—' : (assetName || '');
    assetDiv.textContent = safeAsset;
    infoDiv.appendChild(assetDiv);

    const safeVal = (assetVal && !(typeof _looksEncrypted === 'function' && _looksEncrypted(assetVal))) ? assetVal : '';
    if (safeVal) {
        const valDiv = document.createElement('div');
        valDiv.className = 'text-xs text-slate-300';
        valDiv.append('Định giá: ');
        const valB = document.createElement('b');
        valB.className = 'text-white';
        valB.textContent = safeVal;
        valDiv.appendChild(valB);
        infoDiv.appendChild(valDiv);
    }

    row.appendChild(infoDiv);
    const arrowDiv = document.createElement('div');
    arrowDiv.className = 'p-2 bg-indigo-500 rounded-lg text-white mt-1';
    arrowDiv.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
    row.appendChild(arrowDiv);
    card.appendChild(row);

    const directionLink = document.createElement('a');
    directionLink.className = 'block mt-2 text-center py-2 bg-white/10 rounded border border-white/10 text-[10px] font-bold text-blue-300 uppercase hover:bg-white/20';
    directionLink.target = '_blank';
    directionLink.textContent = 'Chỉ đường';
    directionLink.setAttribute('href', `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`);
    card.appendChild(directionLink);

    const popup = new maplibregl.Popup({ offset: 18, closeButton: true, className: 'clientpro-map-popup', maxWidth: '300px' }).setDOMContent(card);
    popup.on('open', () => {
        const popupEl = popup.getElement();
        const cardEl = popupEl && popupEl.querySelector('.map-popup-card[data-cust-id]');
        if (!cardEl) return;
        const openCurrentFolder = () => openMapFolder(cardEl.dataset.custId);
        cardEl.addEventListener('click', (event) => {
            if (event.target && event.target.closest('a')) return;
            openCurrentFolder();
        });
        cardEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openCurrentFolder();
            }
        });
    });
    return popup;
}

function _paintMapClusters() {
    if (!map || !__mapClusterIndex) return;
    _clearMapMarkers();
    const bounds = map.getBounds();
    const zoom = Math.max(0, Math.min(MAP_CLUSTER_MAX_ZOOM, Math.round(map.getZoom())));
    const clusters = __mapClusterIndex.getClusters(
        [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
        zoom
    );

    clusters.forEach((feat) => {
        const [lng, lat] = feat.geometry.coordinates;
        const props = feat.properties || {};

        if (props.cluster) {
            const el = _createClusterMarkerEl(props.point_count_abbreviated || props.point_count);
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const expansionZoom = Math.min(
                    __mapClusterIndex.getClusterExpansionZoom(props.cluster_id),
                    MAP_CLUSTER_MAX_ZOOM
                );
                map.easeTo({ center: [lng, lat], zoom: expansionZoom });
            });
            markers.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(map));
            return;
        }

        const marker = new maplibregl.Marker({
            element: _createPointMarkerEl(!!props.isApproved),
            anchor: 'center',
        }).setLngLat([lng, lat]).addTo(map);
        marker.setPopup(_buildMapPopupCard(props));
        markers.push(marker);
    });
}

function createMapStyleControl() {
    return {
        onAdd(mapInstance) {
            const container = document.createElement('div');
            container.className = 'maplibregl-ctrl map-style-control';
            container.innerHTML = `
                <button type="button" data-style="dark" class="active">Bản đồ tối</button>
                <button type="button" data-style="sat">Vệ tinh</button>
            `;
            container.addEventListener('click', (event) => {
                const btn = event.target.closest('button[data-style]');
                if (!btn) return;
                container.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
                mapInstance.setStyle(btn.dataset.style === 'sat' ? MAP_STYLE_SAT : MAP_STYLE_DARK);
                mapInstance.once('styledata', () => setTimeout(() => mapInstance.resize(), 50));
            });
            return container;
        },
        onRemove() { }
    };
}

// --- GIẢI MÃ + SUPERCLUSTER: mượt với >100 điểm ---
async function renderMapMarkers() {
    if (!db || !map) return;
    const scOk = await ensureSuperclusterLoaded();
    if (!scOk || !window.Supercluster) {
        ErrorHandler.showWarning('Không tải được clustering — hiển thị điểm đơn lẻ.');
    }

    _clearMapMarkers();
    __mapFeatures = [];
    __mapClusterIndex = null;

    const fallbackThumb = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iNjAiPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMzMzMiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzU1NSI+Tk8gSU1BR0U8L3RleHQ+PC9zdmc+';

    const [customers, allImages] = await Promise.all([
        new Promise((resolve) => {
            try {
                const req = db.transaction(['customers'], 'readonly').objectStore('customers').getAll();
                req.onsuccess = (e) => resolve(e.target.result || []);
                req.onerror = () => resolve([]);
            } catch (e) { resolve([]); }
        }),
        new Promise((resolve) => {
            try {
                const req = db.transaction(['images'], 'readonly').objectStore('images').getAll();
                req.onsuccess = (e) => resolve(e.target.result || []);
                req.onerror = () => resolve([]);
            } catch (e) { resolve([]); }
        }),
    ]);

    const bounds = [];
    const featureJobs = [];

    customers.forEach((cust) => {
        if (!cust || !cust.assets) return;
        featureJobs.push((async () => {
            let custName = await decryptFieldAsync(cust.name);
            if (typeof _looksEncrypted === 'function' && _looksEncrypted(custName)) custName = '';
            for (const asset of cust.assets) {
                const decryptedLink = await decryptFieldAsync(asset.link);
                if (typeof _looksEncrypted === 'function' && _looksEncrypted(decryptedLink)) continue;
                const loc = parseLatLngFromLink(decryptedLink);
                if (!loc) continue;

                let assetName = await decryptFieldAsync(asset.name);
                let assetVal = await decryptFieldAsync(asset.valuation);
                if (typeof _looksEncrypted === 'function') {
                    if (_looksEncrypted(assetName)) assetName = '';
                    if (_looksEncrypted(assetVal)) assetVal = '';
                }
                const img = allImages.find(i => i.assetId === asset.id) || allImages.find(i => i.customerId === cust.id);
                let thumb = fallbackThumb;
                if (img && img.data) {
                    const raw = (typeof decryptImageData === 'function')
                        ? await decryptImageData(img.data)
                        : await decryptFieldAsync(img.data);
                    if (typeof isSafeImageUrl === 'function' && isSafeImageUrl(raw)) thumb = raw;
                }

                const isApproved = cust.status === 'approved';
                __mapFeatures.push({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [loc.lng, loc.lat] },
                    properties: {
                        custId: cust.id,
                        custName,
                        assetName,
                        assetVal,
                        isApproved,
                        loc,
                        thumb,
                    },
                });
                bounds.push([loc.lng, loc.lat]);
            }
        })());
    });

    await Promise.all(featureJobs);

    if (window.Supercluster && __mapFeatures.length > 0) {
        __mapClusterIndex = new window.Supercluster({
            radius: MAP_CLUSTER_RADIUS,
            maxZoom: MAP_CLUSTER_MAX_ZOOM,
            minZoom: MAP_CLUSTER_MIN_ZOOM,
        });
        __mapClusterIndex.load(__mapFeatures);
        _attachMapClusterHandlers();
        _paintMapClusters();
    } else {
        // Fallback không cluster
        __mapFeatures.forEach((feat) => {
            const [lng, lat] = feat.geometry.coordinates;
            const props = feat.properties;
            const marker = new maplibregl.Marker({
                element: _createPointMarkerEl(!!props.isApproved),
                anchor: 'center',
            }).setLngLat([lng, lat]).addTo(map);
            marker.setPopup(_buildMapPopupCard(props));
            markers.push(marker);
        });
    }

    if (bounds.length > 0) {
        const boundsObj = bounds.reduce((b, coord) => b.extend(coord), new maplibregl.LngLatBounds(bounds[0], bounds[0]));
        map.fitBounds(boundsObj, { padding: 50, maxZoom: 16 });
    }
}

function openMapFolder(custId) {
    toggleMap(); // Close map
    openFolder(custId);
}

let __meMarker = null;
function locateMe() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
            if (!map) return;
            const lat = pos.coords.latitude; const lng = pos.coords.longitude;
            map.flyTo({ center: [lng, lat], zoom: 15 });
            // Tái sử dụng 1 marker duy nhất — tránh mỗi lần bấm lại chồng thêm 1 chấm xanh mới
            if (__meMarker) { try { __meMarker.remove(); } catch (e) { } __meMarker = null; }
            const meEl = document.createElement('div');
            meEl.className = 'me-marker';
            meEl.innerHTML = '<div style="width:16px;height:16px;background:#3b82f6;border-radius:50%;border:2px solid white;box-shadow:0 0 10px #3b82f6;"></div>';
            __meMarker = new maplibregl.Marker({ element: meEl, anchor: 'center' })
                .setLngLat([lng, lat])
                .addTo(map);
        }, () => ErrorHandler.showError('MAP', "Không lấy được vị trí hiện tại."));
    }
}



window.addEventListener('beforeunload', destroyMap);

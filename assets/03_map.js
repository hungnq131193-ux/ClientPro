// --- MAP SYSTEM VARIABLES ---
let map = null; let markers = []; let mapResizeObserver = null;
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
        const css1 = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
        const js1 = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
        const css2 = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css';
        const js2 = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js';

        await __loadCss(css1, 'maplibre-css');

        try {
            await __loadScript(js1, 'maplibre-js', 15000);
        } catch (e1) {
            await __loadCss(css2, 'maplibre-css-fallback');
            await __loadScript(js2, 'maplibre-js-fallback', 15000);
        }

        if (!(window.maplibregl && window.maplibregl.Map)) {
            throw new Error('MapLibre GL JS not available after load');
        }
        return true;
    })();

    return __mapLibreLoadPromise.catch(err => {
        __mapLibreLoadPromise = null;
        console.error('[Map] MapLibre load failed:', err);
        showToast('Không tải được bản đồ. Vui lòng kiểm tra mạng.');
        return false;
    });
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
    showToast(acc > 0 ? `Đã lấy tọa độ (sai số ~${acc}m)` : "Đã lấy tọa độ thành công");
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
        showToast("Thiết bị không hỗ trợ GPS");
        return;
    }
    if (window.isSecureContext === false) {
        showToast("GPS chỉ hoạt động qua HTTPS");
        return;
    }
    if (__gpsBusy) return;
    __gpsBusy = true;

    const loader = getEl('loader');
    const loaderText = getEl('loader-text');
    loader.classList.remove('hidden');
    loaderText.textContent = "Đang lấy tọa độ...";

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
        showToast(msg);
    } finally {
        loader.classList.add('hidden');
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
                console.error('[Map] init/render error:', e);
                showToast('Lỗi khởi tạo bản đồ.');
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
    markers.forEach(m => m.remove());
    markers = [];
    if (map) {
        map.remove();
        map = null;
    }
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

// --- ĐÃ SỬA: GIẢI MÃ LINK VÀ THÔNG TIN TRƯỚC KHI VẼ MAP ---
async function renderMapMarkers() {
    if (!db || !map) return;
    // Xóa marker cũ
    markers.forEach(m => m.remove());
    markers = [];

    const tx = db.transaction(['customers', 'images'], 'readonly');
    const custStore = tx.objectStore('customers');
    const imgStore = tx.objectStore('images');

    // Lấy trước toàn bộ ảnh để làm thumbnail
    const allImages = await new Promise(r => { const req = imgStore.getAll(); req.onsuccess = e => r(e.target.result || []); req.onerror = () => r([]); });

    custStore.getAll().onsuccess = (e) => {
        const customers = e.target.result || [];
        const bounds = [];

        customers.forEach(cust => {
            if (!cust.assets) return;

            // 1. GIẢI MÃ TÊN KHÁCH HÀNG (để hiện trên Popup)
            const custName = decryptText(cust.name);

            cust.assets.forEach(asset => {
                // 2. QUAN TRỌNG: GIẢI MÃ LINK TRƯỚC KHI TÁCH TỌA ĐỘ
                const decryptedLink = decryptText(asset.link);
                const loc = parseLatLngFromLink(decryptedLink);

                if (loc) {
                    // 3. GIẢI MÃ CÁC THÔNG TIN TÀI SẢN KHÁC
                    const assetName = decryptText(asset.name);
                    const assetVal = decryptText(asset.valuation);

                    // Tìm ảnh đại diện
                    const img = allImages.find(i => i.assetId === asset.id) || allImages.find(i => i.customerId === cust.id);
                    const fallbackThumb = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iNjAiPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMzMzMiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzU1NSI+Tk8gSU1BR0U8L3RleHQ+PC9zdmc+';
                    const thumb = (img && typeof isSafeImageUrl === 'function' && isSafeImageUrl(img.data)) ? img.data : fallbackThumb;

                    // Style marker theo trạng thái
                    const isApproved = cust.status === 'approved';
                    const markerClass = isApproved ? 'marker-approved' : 'marker-pending';
                    const statusTag = isApproved ? '<span class="map-tag approved">Đã Duyệt</span>' : '<span class="map-tag pending">Thẩm định</span>';

                    // Hiển thị giá trị định giá đã giải mã
                    const valStr = assetVal ? `<div class="text-xs text-slate-300">Định giá: <b class="text-white">${escapeHTML(assetVal)}</b></div>` : '';

                    const markerEl = document.createElement('div');
                    markerEl.className = 'custom-div-icon';
                    markerEl.innerHTML = `<div class="marker-glow ${markerClass}"></div>`;

                    const marker = new maplibregl.Marker({ element: markerEl, anchor: 'center' })
                        .setLngLat([loc.lng, loc.lat])
                        .addTo(map);

                    // Popup với thông tin đã giải mã
                    const safeCustId = escapeHTML(cust.id);
                    const popupContent = `
                        <div class="map-popup-card" data-cust-id="${safeCustId}" role="button" tabindex="0">
                            <img src="${escapeHTML(thumb)}" class="map-popup-img" alt="">
                            <div class="flex justify-between items-start">
                                <div>
                                    ${statusTag}
                                    <div class="font-bold text-sm truncate w-40">${escapeHTML(custName)}</div>
                                    <div class="text-[10px] text-slate-400 truncate w-40">${escapeHTML(assetName)}</div>
                                    ${valStr}
                                </div>
                                <div class="p-2 bg-indigo-500 rounded-lg text-white mt-1"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg></div>
                            </div>
                            <a href="https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}" target="_blank" class="block mt-2 text-center py-2 bg-white/10 rounded border border-white/10 text-[10px] font-bold text-blue-300 uppercase hover:bg-white/20">Chỉ đường</a>
                        </div>
                    `;
                    const popup = new maplibregl.Popup({ offset: 18, closeButton: true, className: 'clientpro-map-popup', maxWidth: '300px' }).setHTML(popupContent);
                    popup.on('open', () => {
                        const popupEl = popup.getElement();
                        const card = popupEl && popupEl.querySelector('.map-popup-card[data-cust-id]');
                        if (!card) return;
                        const openCurrentFolder = () => openMapFolder(card.dataset.custId);
                        card.addEventListener('click', (event) => {
                            if (event.target && event.target.closest('a')) return;
                            openCurrentFolder();
                        });
                        card.addEventListener('keydown', (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                openCurrentFolder();
                            }
                        });
                    });
                    marker.setPopup(popup);
                    markers.push(marker);
                    bounds.push([loc.lng, loc.lat]);
                }
            });
        });

        if (bounds.length > 0) {
            const boundsObj = bounds.reduce((b, coord) => b.extend(coord), new maplibregl.LngLatBounds(bounds[0], bounds[0]));
            map.fitBounds(boundsObj, { padding: 50, maxZoom: 16 });
        }
    };
}

function openMapFolder(custId) {
    toggleMap(); // Close map
    openFolder(custId);
}

function locateMe() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
            const lat = pos.coords.latitude; const lng = pos.coords.longitude;
            map.flyTo({ center: [lng, lat], zoom: 15 });
            const meEl = document.createElement('div');
            meEl.className = 'me-marker';
            meEl.innerHTML = '<div style="width:16px;height:16px;background:#3b82f6;border-radius:50%;border:2px solid white;box-shadow:0 0 10px #3b82f6;"></div>';
            new maplibregl.Marker({ element: meEl, anchor: 'center' })
                .setLngLat([lng, lat])
                .addTo(map);
        }, () => showToast("Không lấy được vị trí"));
    }
}



window.addEventListener('beforeunload', destroyMap);

// --- MAP SYSTEM VARIABLES ---
let map = null; let markers = [];
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

// --- LAZY-LOAD LEAFLET (only when opening Map screen) ---
// index.html must NOT load Leaflet in <head>. Map screen will load it on demand.
let __leafletLoadPromise = null;
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
        if (window.L && window.L.map) return resolve(true);
        const existing = id ? document.getElementById(id) : null;
        if (existing && existing.getAttribute('data-loaded') === '1') return resolve(true);

        const s = existing || __injectOnce('script', { src, defer: 'defer' }, id);
        let done = false;
        const to = setTimeout(() => {
            if (done) return;
            done = true;
            reject(new Error('Leaflet script timeout'));
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
            reject(new Error('Leaflet script load failed'));
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

async function ensureLeafletLoaded() {
    if (window.L && window.L.map) return true;
    if (__leafletLoadPromise) return __leafletLoadPromise;

    __leafletLoadPromise = (async () => {
        // Minimal fallback CSS to avoid "black screen" when Leaflet CSS fails to load.
        __injectOnce('style', {
            text: `
                    .leaflet-container{position:relative;outline:0;}
                    .leaflet-pane,.leaflet-tile,.leaflet-marker-icon,.leaflet-marker-shadow,.leaflet-tile-container,.leaflet-map-pane svg,.leaflet-map-pane canvas{position:absolute;left:0;top:0;}
                    .leaflet-tile-container{width:100%;height:100%;}
                    .leaflet-tile{will-change:transform;}
                    .leaflet-control{position:relative;z-index:800;}
                    .leaflet-top,.leaflet-bottom{position:absolute;z-index:1000;pointer-events:none;}
                    .leaflet-top{top:0}.leaflet-right{right:0}.leaflet-left{left:0}.leaflet-bottom{bottom:0}
                    .leaflet-control{pointer-events:auto;}
                ` }, 'leaflet-base-css');

        // Try primary CDN (unpkg), then fallback (jsdelivr)
        const css1 = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        const js1 = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        const css2 = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
        const js2 = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';

        // Load CSS (best-effort)
        await __loadCss(css1, 'leaflet-css');

        try {
            await __loadScript(js1, 'leaflet-js', 15000);
        } catch (e1) {
            // fallback css + js
            await __loadCss(css2, 'leaflet-css-fallback');
            await __loadScript(js2, 'leaflet-js-fallback', 15000);
        }

        if (!(window.L && window.L.map)) {
            throw new Error('Leaflet not available after load');
        }
        return true;
    })();

    return __leafletLoadPromise.catch(err => {
        __leafletLoadPromise = null;
        console.error('[Map] Leaflet load failed:', err);
        showToast('Không tải được bản đồ. Vui lòng kiểm tra mạng.');
        return false;
    });
}

// --- GPS FEATURE V1.1 ---
function getCurrentGPS() {
    if (!navigator.geolocation) {
        showToast("Thiết bị không hỗ trợ GPS");
        return;
    }
    getEl('loader').classList.remove('hidden');
    getEl('loader-text').textContent = "Đang lấy tọa độ...";

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            // Tạo link chuẩn cho Google Maps (Search Query)
            const mapLink = `https://www.google.com/maps?q=${lat},${lng}`;

            const inputLink = getEl('asset-link');
            inputLink.value = mapLink;

            getEl('loader').classList.add('hidden');
            showToast("Đã lấy tọa độ thành công");
        },
        (error) => {
            getEl('loader').classList.add('hidden');
            let msg = "Lỗi GPS";
            switch (error.code) {
                case error.PERMISSION_DENIED: msg = "Bạn đã chặn quyền GPS"; break;
                case error.POSITION_UNAVAILABLE: msg = "Không tìm thấy vị trí"; break;
                case error.TIMEOUT: msg = "Hết thời gian chờ"; break;
            }
            showToast(msg);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
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

function parseMoneyToNumber(str) { if (!str) return 0; return parseInt(str.toString().replace(/\D/g, '')) || 0; }

// --- AI-LITE CHO ẢNH TÀI LIỆU (giảm noise, nền trắng, chữ nét) ---
// Removed enhanceDocumentWithAI as OCR is no longer used

// --- MAP FUNCTIONS ---
async function toggleMap() {
    const mapScreen = getEl('screen-map');
    if (mapScreen.classList.contains('translate-x-full')) {
        // Slide-in first (avoid blocking animation with heavy map work)
        if (typeof nextFrame === 'function') nextFrame(() => mapScreen.classList.remove('translate-x-full'));
        else mapScreen.classList.remove('translate-x-full');

        // Lightweight loading overlay while Leaflet/markers are prepared
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

        const ok = await ensureLeafletLoaded();
        if (!ok) {
            try { const ov = getEl('map-loading'); if (ov) ov.remove(); } catch (e) { }
            return;
        }

        // Defer init + marker rendering until after the slide-in ends (prevents jank)
        const doInit = () => {
            try {
                if (!map) initMap(); else renderMapMarkers();
                // Fix black/blank map when container was hidden during init
                setTimeout(() => { if (map) map.invalidateSize(true); }, 80);
                setTimeout(() => { if (map) map.invalidateSize(true); }, 380);
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
        mapScreen.classList.add('translate-x-full');
    }
}

function initMap() {
    map = L.map('map-container', { zoomControl: false }).setView([21.0285, 105.8542], 12); // Default Hanoi

    const darkLayer = L.tileLayer(TILE_DARK, { attribution: '', maxZoom: 19 });
    const satLayer = L.tileLayer(TILE_SAT, { attribution: '', maxZoom: 19 });

    darkLayer.addTo(map);
    L.control.layers({ "Bản đồ tối": darkLayer, "Vệ tinh": satLayer }, null, { position: 'topright' }).addTo(map);

    renderMapMarkers();
}

// --- ĐÃ SỬA: GIẢI MÃ LINK VÀ THÔNG TIN TRƯỚC KHI VẼ MAP ---
async function renderMapMarkers() {
    if (!db || !map) return;
    // Xóa marker cũ
    markers.forEach(m => map.removeLayer(m));
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
                    const thumb = img ? img.data : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iNjAiPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMzMzMiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzU1NSI+Tk8gSU1BR0U8L3RleHQ+PC9zdmc+';

                    // Style marker theo trạng thái
                    const isApproved = cust.status === 'approved';
                    const markerClass = isApproved ? 'marker-approved' : 'marker-pending';
                    const statusTag = isApproved ? '<span class="map-tag approved">Đã Duyệt</span>' : '<span class="map-tag pending">Thẩm định</span>';

                    // Hiển thị giá trị định giá đã giải mã
                    const valStr = assetVal ? `<div class="text-xs text-slate-300">Định giá: <b class="text-white">${assetVal}</b></div>` : '';

                    const icon = L.divIcon({
                        className: 'custom-div-icon',
                        html: `<div class="marker-glow ${markerClass}"></div>`,
                        iconSize: [20, 20],
                        iconAnchor: [10, 10]
                    });

                    const marker = L.marker([loc.lat, loc.lng], { icon: icon }).addTo(map);

                    // Popup với thông tin đã giải mã
                    const popupContent = `
                        <div class="map-popup-card" onclick="openMapFolder('${cust.id}')">
                            <img src="${thumb}" class="map-popup-img">
                            <div class="flex justify-between items-start">
                                <div>
                                    ${statusTag}
                                    <div class="font-bold text-sm truncate w-40">${custName}</div>
                                    <div class="text-[10px] text-slate-400 truncate w-40">${assetName}</div>
                                    ${valStr}
                                </div>
                                <div class="p-2 bg-indigo-500 rounded-lg text-white mt-1"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg></div>
                            </div>
                            <a href="https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}" target="_blank" class="block mt-2 text-center py-2 bg-white/10 rounded border border-white/10 text-[10px] font-bold text-blue-300 uppercase hover:bg-white/20">Chỉ đường</a>
                        </div>
                    `;
                    marker.bindPopup(popupContent);
                    markers.push(marker);
                    bounds.push([loc.lat, loc.lng]);
                }
            });
        });

        if (bounds.length > 0) map.fitBounds(bounds, { padding: [50, 50] });
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
            map.setView([lat, lng], 15);
            L.marker([lat, lng], {
                icon: L.divIcon({ html: '<div style="width:16px;height:16px;background:#3b82f6;border-radius:50%;border:2px solid white;box-shadow:0 0 10px #3b82f6;"></div>', className: 'me-marker' })
            }).addTo(map);
        }, () => showToast("Không lấy được vị trí"));
    }
}



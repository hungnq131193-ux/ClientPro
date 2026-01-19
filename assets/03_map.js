        // --- MAP SYSTEM VARIABLES ---
        let map = null; let markers = [];
        const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
        const TILE_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

        // --- LEAFLET LAZY LOADER ---
        // Leaflet is loaded only when the Map screen is opened.
        // This reduces initial payload and improves first paint performance.
        const LEAFLET_JS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        const LEAFLET_CSS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        let _leafletLoadPromise = null;

        function ensureLeafletBaseCss() {
            // Minimal CSS so the map won't appear as a blank/black screen if CSS CDN fails.
            if (document.getElementById('leaflet-base-css')) return;
            const st = document.createElement('style');
            st.id = 'leaflet-base-css';
            st.textContent = [
                '.leaflet-pane, .leaflet-tile, .leaflet-marker-icon, .leaflet-marker-shadow, .leaflet-tile-container, .leaflet-pane > svg, .leaflet-pane > canvas {',
                '  position: absolute; left: 0; top: 0;',
                '}',
                '.leaflet-container {',
                '  overflow: hidden;',
                '  background: #0b1220;',
                '  outline: 0;',
                '  -webkit-tap-highlight-color: transparent;',
                '}',
                '.leaflet-control { position: relative; z-index: 800; }'
            ].join('\n');
            document.head.appendChild(st);
        }

        function ensureLeafletLoaded() {
            if (window.L && typeof window.L.map === 'function') return Promise.resolve();
            if (_leafletLoadPromise) return _leafletLoadPromise;

            ensureLeafletBaseCss();

            _leafletLoadPromise = new Promise((resolve, reject) => {
                const timeoutMs = 20000;
                const t = setTimeout(() => reject(new Error('Leaflet load timeout')), timeoutMs);

                // CSS
                if (!document.getElementById('leaflet-css')) {
                    const link = document.createElement('link');
                    link.id = 'leaflet-css';
                    link.rel = 'stylesheet';
                    link.href = LEAFLET_CSS_URL;
                    link.onerror = () => {
                        // CSS failure should not block JS; base CSS will still prevent black screen.
                        // We keep going.
                    };
                    document.head.appendChild(link);
                }

                // JS
                if (!document.getElementById('leaflet-js')) {
                    const s = document.createElement('script');
                    s.id = 'leaflet-js';
                    s.src = LEAFLET_JS_URL;
                    s.async = true;
                    s.onload = () => {
                        clearTimeout(t);
                        // Give the browser 1-2 frames to apply styles/layout.
                        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
                    };
                    s.onerror = () => {
                        clearTimeout(t);
                        reject(new Error('Leaflet JS load failed'));
                    };
                    document.head.appendChild(s);
                } else {
                    // JS tag exists; poll until L is available.
                    const start = Date.now();
                    const poll = () => {
                        if (window.L && typeof window.L.map === 'function') {
                            clearTimeout(t);
                            resolve();
                            return;
                        }
                        if (Date.now() - start > timeoutMs) {
                            clearTimeout(t);
                            reject(new Error('Leaflet load timeout'));
                            return;
                        }
                        setTimeout(poll, 50);
                    };
                    poll();
                }
            }).catch(err => {
                // Allow retry on next open.
                _leafletLoadPromise = null;
                throw err;
            });

            return _leafletLoadPromise;
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
                    switch(error.code) {
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
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                      Math.sin(dLng/2) * Math.sin(dLng/2);
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        }

        function parseMoneyToNumber(str) { if(!str) return 0; return parseInt(str.toString().replace(/\D/g, '')) || 0; }
        
        // --- AI-LITE CHO ẢNH TÀI LIỆU (giảm noise, nền trắng, chữ nét) ---
// Removed enhanceDocumentWithAI as OCR is no longer used

        // --- MAP FUNCTIONS ---
        async function toggleMap() {
            const mapScreen = getEl('screen-map');
            const opening = mapScreen.classList.contains('translate-x-full');

            if (!opening) {
                mapScreen.classList.add('translate-x-full');
                return;
            }

            // Make it visible first so Leaflet can measure size.
            mapScreen.classList.remove('translate-x-full');

            // Safety: ensure the container has a measurable height.
            if (mapScreen.offsetHeight < 50) mapScreen.style.height = '100vh';
            const mc = getEl('map-container');
            if (mc && mc.offsetHeight < 50) mc.style.height = '100%';

            // Load Leaflet only now.
            try {
                getEl('loader')?.classList.remove('hidden');
                const lt = getEl('loader-text');
                if (lt) lt.textContent = 'Đang tải bản đồ...';
                await ensureLeafletLoaded();
            } catch (e) {
                getEl('loader')?.classList.add('hidden');
                showToast('Không tải được bản đồ. Kiểm tra mạng hoặc thử lại.');
                // Close map to avoid a stuck black screen.
                mapScreen.classList.add('translate-x-full');
                return;
            } finally {
                getEl('loader')?.classList.add('hidden');
            }

            // Init or refresh.
            if (!map) initMap(); else renderMapMarkers();

            // Fix "black screen" caused by init while transitioning / hidden.
            if (map && typeof map.invalidateSize === 'function') {
                setTimeout(() => map.invalidateSize(true), 60);
                setTimeout(() => map.invalidateSize(true), 360);
            }
        }

        function initMap() {
            map = L.map('map-container', { zoomControl: false }).setView([21.0285, 105.8542], 12); // Default Hanoi

            // Tile sources can be blocked/unreliable depending on network/region.
            // Provide a stable fallback (OSM) and auto-switch if too many tile errors occur.
            const TILE_OSM = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

            const darkLayer = L.tileLayer(TILE_DARK, { attribution: '', maxZoom: 19, crossOrigin: true });
            const satLayer  = L.tileLayer(TILE_SAT,  { attribution: '', maxZoom: 19, crossOrigin: true });
            const osmLayer  = L.tileLayer(TILE_OSM,  { attribution: '', maxZoom: 19, crossOrigin: true });

            // Auto-fallback if primary tile source fails repeatedly.
            let tileErr = 0;
            const onTileErr = () => {
                tileErr++;
                if (tileErr === 6) {
                    try {
                        if (map && map.hasLayer(darkLayer)) map.removeLayer(darkLayer);
                        if (map && !map.hasLayer(osmLayer)) osmLayer.addTo(map);
                        showToast('Nguồn bản đồ bị lỗi. Đã chuyển sang bản đồ dự phòng.');
                    } catch (_) {}
                }
            };
            darkLayer.on('tileerror', onTileErr);
            satLayer.on('tileerror', onTileErr);

            // Start with dark layer; if it fails, fallback will replace it.
            darkLayer.addTo(map);

            L.control.layers({ "Bản đồ tối": darkLayer, "Vệ tinh": satLayer, "Bản đồ thường": osmLayer }, null, { position: 'topright' }).addTo(map);

            renderMapMarkers();

            // In case the map was created during a transition, force a reflow.
            setTimeout(() => map.invalidateSize(true), 50);
            setTimeout(() => map.invalidateSize(true), 250);
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
                        icon: L.divIcon({ html: '<div style="width:16px;height:16px;background:#3b82f6;border-radius:50%;border:2px solid white;box-shadow:0 0 10px #3b82f6;"></div>', className:'me-marker' }) 
                    }).addTo(map);
                }, () => showToast("Không lấy được vị trí"));
            }
        }


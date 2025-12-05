/**
 * MAP.JS
 * Quản lý bản đồ (Leaflet), định vị GPS và các thuật toán tính khoảng cách.
 * Phụ thuộc: config.js, security.js, database.js, Leaflet Library
 */

// --- VARIABLES ---
let map = null;
let markers = [];

// --- UTILS: PARSING & MATH ---

/**
 * Trích xuất tọa độ (lat, lng) từ link Google Maps bất kỳ
 * Hỗ trợ: Link rút gọn, link share, link tọa độ thô, link search...
 */
function parseLatLngFromLink(input) {
    if (!input) return null;
    const str = input.trim();

    // Dạng 1: Tọa độ thô "21.028, 105.85"
    const regexRaw = /^(-?\d{1,3}\.\d+)[,\s]+(-?\d{1,3}\.\d+)$/;
    let match = str.match(regexRaw);
    if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };

    // Dạng 2: Google Maps !3d... !4d...
    match = str.match(/!3d(-?\d+(\.\d+)?)!4d(-?\d+(\.\d+)?)/);
    if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[3]) };

    // Dạng 3: Link search ?q=...
    match = str.match(/[?&]q=(-?\d+(\.\d+)?),(-?\d+(\.\d+)?)/);
    if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[3]) };

    // Dạng 4: Link @...
    match = str.match(/@(-?\d+(\.\d+)?),(-?\d+(\.\d+)?)/);
    if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[3]) };

    return null;
}

/**
 * Công thức Haversine tính khoảng cách giữa 2 điểm trên mặt cầu (Trái đất)
 * @returns {number} Khoảng cách tính bằng mét
 */
function distanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Bán kính trái đất (m)
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function parseMoneyToNumber(str) { 
    if(!str) return 0; 
    return parseInt(str.toString().replace(/\D/g, '')) || 0; 
}

// --- GPS FEATURES ---

function getCurrentGPS() {
    if (!navigator.geolocation) {
        if(typeof showToast === 'function') showToast("Thiết bị không hỗ trợ GPS");
        return;
    }
    const loader = getEl('loader');
    if(loader) {
        loader.classList.remove('hidden');
        getEl('loader-text').textContent = "Đang lấy tọa độ...";
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            // Tạo link chuẩn Google Maps
            const mapLink = `https://www.google.com/maps?q=${lat},${lng}`;
            
            const inputLink = getEl('asset-link');
            if(inputLink) inputLink.value = mapLink;
            
            if(loader) loader.classList.add('hidden');
            if(typeof showToast === 'function') showToast("Đã lấy tọa độ thành công");
        },
        (error) => {
            if(loader) loader.classList.add('hidden');
            let msg = "Lỗi GPS";
            switch(error.code) {
                case error.PERMISSION_DENIED: msg = "Bạn đã chặn quyền GPS"; break;
                case error.POSITION_UNAVAILABLE: msg = "Không tìm thấy vị trí"; break;
                case error.TIMEOUT: msg = "Hết thời gian chờ"; break;
            }
            if(typeof showToast === 'function') showToast(msg);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

function locateMe() {
    if (!map) return;
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
            const lat = pos.coords.latitude; 
            const lng = pos.coords.longitude;
            map.setView([lat, lng], 15);
            
            // Vẽ marker vị trí hiện tại của tôi (chấm xanh)
            L.marker([lat, lng], { 
                icon: L.divIcon({ 
                    html: '<div style="width:16px;height:16px;background:#3b82f6;border-radius:50%;border:2px solid white;box-shadow:0 0 10px #3b82f6;"></div>', 
                    className:'me-marker' 
                }) 
            }).addTo(map);
        }, () => {
             if(typeof showToast === 'function') showToast("Không lấy được vị trí");
        });
    }
}

// --- MAP RENDERING ---

function toggleMap() {
    const mapScreen = getEl('screen-map');
    if (mapScreen.classList.contains('translate-x-full')) {
        mapScreen.classList.remove('translate-x-full');
        if (!map) initMap(); 
        else renderMapMarkers();
    } else {
        mapScreen.classList.add('translate-x-full');
    }
}

function initMap() {
    // Default center: Hà Nội
    map = L.map('map-container', { zoomControl: false }).setView([21.0285, 105.8542], 12); 
    
    const darkLayer = L.tileLayer(TILE_DARK, { attribution: '', maxZoom: 19 });
    const satLayer = L.tileLayer(TILE_SAT, { attribution: '', maxZoom: 19 });
    
    darkLayer.addTo(map);
    L.control.layers({ "Bản đồ tối": darkLayer, "Vệ tinh": satLayer }, null, { position: 'topright' }).addTo(map);

    renderMapMarkers();
}

async function renderMapMarkers() {
    if (!db || !map) return;
    
    // Xóa marker cũ
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    const tx = db.transaction(['customers', 'images'], 'readonly');
    const custStore = tx.objectStore('customers');
    const imgStore = tx.objectStore('images');

    // Lấy trước toàn bộ ảnh để làm thumbnail
    const allImages = await new Promise(r => { 
        const req = imgStore.getAll(); 
        req.onsuccess = e => r(e.target.result || []); 
        req.onerror = () => r([]); 
    });

    custStore.getAll().onsuccess = (e) => {
        const customers = e.target.result || [];
        const bounds = [];

        customers.forEach(cust => {
            if (!cust.assets) return;
            
            // 1. Giải mã tên khách hàng (cho Popup)
            const custName = decryptText(cust.name);

            cust.assets.forEach(asset => {
                // 2. Giải mã Link để lấy tọa độ
                const decryptedLink = decryptText(asset.link);
                const loc = parseLatLngFromLink(decryptedLink);
                
                if (loc) {
                    // 3. Giải mã thông tin chi tiết
                    const assetName = decryptText(asset.name);
                    const assetVal = decryptText(asset.valuation);

                    // Tìm ảnh đại diện (Ưu tiên ảnh tài sản -> ảnh khách -> ảnh default)
                    const img = allImages.find(i => i.assetId === asset.id) || allImages.find(i => i.customerId === cust.id);
                    const thumb = img ? img.data : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iNjAiPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMzMzMiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzU1NSI+Tk8gSU1BR0U8L3RleHQ+PC9zdmc+';
                    
                    // Style marker theo trạng thái
                    const isApproved = cust.status === 'approved';
                    const markerClass = isApproved ? 'marker-approved' : 'marker-pending';
                    const statusTag = isApproved ? '<span class="map-tag approved">Đã Duyệt</span>' : '<span class="map-tag pending">Thẩm định</span>';
                    const valStr = assetVal ? `<div class="text-xs text-slate-300">Định giá: <b class="text-white">${assetVal}</b></div>` : '';

                    const icon = L.divIcon({
                        className: 'custom-div-icon',
                        html: `<div class="marker-glow ${markerClass}"></div>`,
                        iconSize: [20, 20],
                        iconAnchor: [10, 10]
                    });

                    const marker = L.marker([loc.lat, loc.lng], { icon: icon }).addTo(map);
                    
                    // Popup HTML
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
                                <div class="p-2 bg-indigo-500 rounded-lg text-white mt-1">➔</div>
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

        // Tự động zoom bản đồ để thấy hết các điểm
        if (bounds.length > 0) map.fitBounds(bounds, { padding: [50, 50] });
    };
}

function openMapFolder(custId) {
    toggleMap(); // Đóng map
    // Gọi hàm mở folder (nằm ở ui.js)
    if(typeof openFolder === 'function') openFolder(custId);
}

// --- LOGIC THAM KHẢO GIÁ (REFERENCE PRICE) ---

function referenceAssetPrice(assetIndex) {
    if (!currentCustomerData) return;
    
    // 1. Lấy tài sản đang chọn (Target)
    const targetAsset = currentCustomerData.assets[assetIndex]; 
    const decryptedTargetLink = decryptText(targetAsset.link);
    const targetLoc = parseLatLngFromLink(decryptedTargetLink);

    if (!targetLoc) { 
        if(typeof showToast === 'function') showToast("TSBĐ chưa có tọa độ chuẩn."); 
        return; 
    }

    if(getEl('loader')) {
        getEl('loader').classList.remove('hidden'); 
        getEl('loader-text').textContent = "Đang tìm kiếm & so sánh...";
    }

    const tx = db.transaction(['customers'], 'readonly');
    tx.objectStore('customers').getAll().onsuccess = (e) => {
        const customers = e.target.result || []; 
        const candidates = [];

        customers.forEach(cust => { 
            if (!cust.assets) return; 
            const custName = decryptText(cust.name);

            cust.assets.forEach(asset => { 
                // Bỏ qua chính nó
                if (cust.id === currentCustomerData.id && asset.id === targetAsset.id) return; 
                
                const decryptedLink = decryptText(asset.link);
                const loc = parseLatLngFromLink(decryptedLink); 
                const val = parseMoneyToNumber(decryptText(asset.valuation)); 
                const assetName = decryptText(asset.name);

                if (loc && val > 0) { 
                    const dist = distanceMeters(targetLoc.lat, targetLoc.lng, loc.lat, loc.lng); 
                    
                    // Có thể thêm điều kiện dist < 5000 (5km) tại đây nếu muốn lọc
                    candidates.push({ 
                        customerName: custName, 
                        assetName: assetName, 
                        valuation: val, 
                        distance: dist 
                    }); 
                } 
            }); 
        });

        if(getEl('loader')) {
            getEl('loader').classList.add('hidden'); 
            getEl('loader-text').textContent = "Loading...";
        }

        if (candidates.length === 0) { 
            if(typeof showToast === 'function') showToast("Chưa có dữ liệu tham chiếu phù hợp"); 
            return; 
        }

        // Sắp xếp: Gần nhất lên đầu
        candidates.sort((a, b) => a.distance - b.distance); 
        
        // Hiển thị top 20 kết quả (Gọi hàm UI)
        if (typeof showRefModal === 'function') showRefModal(candidates.slice(0, 20));
    };
}

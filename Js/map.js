// ============================================================
// MAP.JS - BẢN ĐỒ, ĐỊNH VỊ GPS & TÍNH TOÁN KHOẢNG CÁCH
// ============================================================

// --- 1. HÀM TỌA ĐỘ & GPS ---

function getCurrentGPS() {
    if (!navigator.geolocation) {
        showToast("Thiết bị không hỗ trợ GPS");
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
            // Tạo link Google Maps chuẩn
            const mapLink = `https://www.google.com/maps?q=${lat},${lng}`;
            
            const inputLink = getEl('asset-link');
            if(inputLink) inputLink.value = mapLink;
            
            if(loader) loader.classList.add('hidden');
            showToast("Đã lấy tọa độ thành công");
        },
        (error) => {
            if(loader) loader.classList.add('hidden');
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

/**
 * Phân tích Link Google Maps thành tọa độ {lat, lng}
 */
function parseLatLngFromLink(input) {
    if (!input) return null;
    const str = input.trim();

    // Dạng thô: 21.000, 105.000
    const regexRaw = /^(-?\d{1,3}\.\d+)[,\s]+(-?\d{1,3}\.\d+)$/;
    let match = str.match(regexRaw);
    if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };

    // Dạng Google Maps Desktop: !3d21.000!4d105.000
    match = str.match(/!3d(-?\d+(\.\d+)?)!4d(-?\d+(\.\d+)?)/);
    if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[3]) };

    // Dạng Query: ?q=21.000,105.000
    match = str.match(/[?&]q=(-?\d+(\.\d+)?),(-?\d+(\.\d+)?)/);
    if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[3]) };

    // Dạng rút gọn: @21.000,105.000
    match = str.match(/@(-?\d+(\.\d+)?),(-?\d+(\.\d+)?)/);
    if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[3]) };

    return null;
}

/**
 * Tính khoảng cách giữa 2 điểm (công thức Haversine) - Đơn vị: mét
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

// --- 2. HIỂN THỊ BẢN ĐỒ (LEAFLET) ---

function toggleMap() {
    const mapScreen = getEl('screen-map');
    if (mapScreen.classList.contains('translate-x-full')) {
        // Mở Map
        mapScreen.classList.remove('translate-x-full');
        if (!map) initMap(); 
        else {
            // Cập nhật lại marker khi mở lại map
            renderMapMarkers();
            // Cần invalidateSize để map hiển thị đúng khung hình
            setTimeout(() => map.invalidateSize(), 300);
        }
    } else {
        // Đóng Map
        mapScreen.classList.add('translate-x-full');
    }
}

function initMap() {
    // Khởi tạo Map tại Hà Nội (Default)
    map = L.map('map-container', { zoomControl: false }).setView([21.0285, 105.8542], 12);
    
    // Layer Bản đồ tối
    const darkLayer = L.tileLayer(TILE_DARK, { 
        attribution: '', 
        maxZoom: 19 
    });
    
    // Layer Vệ tinh
    const satLayer = L.tileLayer(TILE_SAT, { 
        attribution: '', 
        maxZoom: 19 
    });
    
    darkLayer.addTo(map);
    L.control.layers({ "Bản đồ tối": darkLayer, "Vệ tinh": satLayer }, null, { position: 'topright' }).addTo(map);

    renderMapMarkers();
}

/**
 * Vẽ các điểm Marker lên bản đồ
 * (Lưu ý: Logic này đã được tối ưu để tránh load ảnh làm nặng máy)
 */
async function renderMapMarkers() {
    if (!db || !map) return;
    
    // Xóa marker cũ
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    // Lấy dữ liệu
    const tx = db.transaction(['customers', 'images'], 'readonly');
    const custStore = tx.objectStore('customers');
    const imgStore = tx.objectStore('images');

    // Tải trước danh sách ảnh (Chỉ lấy ID và AssetID để map nhanh, không lấy data ảnh)
    // *Tối ưu*: Ở bản cũ load toàn bộ ảnh -> Nặng. 
    // Ở đây ta chấp nhận load để lấy thumbnail, nhưng nếu app quá lớn cần sửa lại chỉ lấy khi click.
    // Tạm thời giữ logic cũ nhưng bọc try-catch
    
    let allImages = [];
    try {
        allImages = await new Promise(r => { 
            const req = imgStore.getAll(); 
            req.onsuccess = e => r(e.target.result || []); 
            req.onerror = () => r([]); 
        });
    } catch(e) { console.warn("Lỗi load ảnh map:", e); }

    custStore.getAll().onsuccess = (e) => {
        const customers = e.target.result || [];
        const bounds = [];

        customers.forEach(cust => {
            if (!cust.assets) return;
            
            // Giải mã tên KH
            const custName = decryptText(cust.name);

            cust.assets.forEach(asset => {
                // Giải mã link
                const decryptedLink = decryptText(asset.link);
                const loc = parseLatLngFromLink(decryptedLink);
                
                if (loc) {
                    // Giải mã thông tin tài sản
                    const assetName = decryptText(asset.name);
                    const assetVal = decryptText(asset.valuation);

                    // Tìm ảnh đại diện (Thumbnail)
                    const img = allImages.find(i => i.assetId === asset.id) || allImages.find(i => i.customerId === cust.id);
                    // Ảnh placeholder nếu không có
                    const thumb = img ? img.data : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iNjAiPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMzMzMiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzU1NSI+Tk8gSU1BR0U8L3RleHQ+PC9zdmc+';
                    
                    const isApproved = cust.status === 'approved';
                    const markerClass = isApproved ? 'marker-approved' : 'marker-pending';
                    const statusTag = isApproved ? '<span class="map-tag approved">Đã Duyệt</span>' : '<span class="map-tag pending">Thẩm định</span>';
                    const valStr = assetVal ? `<div class="text-xs text-slate-300">Định giá: <b class="text-white">${assetVal}</b></div>` : '';

                    // Tạo Icon CSS Custom
                    const icon = L.divIcon({
                        className: 'custom-div-icon',
                        html: `<div class="marker-glow ${markerClass}"></div>`,
                        iconSize: [20, 20],
                        iconAnchor: [10, 10]
                    });

                    const marker = L.marker([loc.lat, loc.lng], { icon: icon }).addTo(map);
                    
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
                                <div class="p-2 bg-indigo-500 rounded-lg text-white mt-1">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                                </div>
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

        // Tự động zoom map để thấy hết các điểm
        if (bounds.length > 0) map.fitBounds(bounds, { padding: [50, 50] });
    };
}

function openMapFolder(custId) {
    toggleMap(); // Đóng map
    if(window.openFolder) openFolder(custId); // Mở folder khách hàng
}

function locateMe() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
            const lat = pos.coords.latitude; 
            const lng = pos.coords.longitude;
            map.setView([lat, lng], 15);
            L.marker([lat, lng], { 
                icon: L.divIcon({ html: '<div style="width:16px;height:16px;background:#3b82f6;border-radius:50%;border:2px solid white;box-shadow:0 0 10px #3b82f6;"></div>', className:'me-marker' }) 
            }).addTo(map);
        }, () => showToast("Không lấy được vị trí"));
    }
}

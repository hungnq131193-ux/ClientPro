/* map.js - Bản đồ & GPS */

function initMap() {
    map = L.map('map-container', { zoomControl: false }).setView([21.0285, 105.8542], 12);
    const darkLayer = L.tileLayer(TILE_DARK, { attribution: '', maxZoom: 19 });
    const satLayer = L.tileLayer(TILE_SAT, { attribution: '', maxZoom: 19 });
    darkLayer.addTo(map);
    L.control.layers({ "Bản đồ tối": darkLayer, "Vệ tinh": satLayer }, null, { position: 'topright' }).addTo(map);
    renderMapMarkers();
}

function toggleMap() {
    const mapScreen = getEl('screen-map');
    if (mapScreen.classList.contains('translate-x-full')) {
        mapScreen.classList.remove('translate-x-full');
        if (!map) initMap(); else renderMapMarkers();
    } else {
        mapScreen.classList.add('translate-x-full');
    }
}

async function renderMapMarkers() {
    if (!db || !map) return;
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    const tx = db.transaction(['customers', 'images'], 'readonly');
    const custStore = tx.objectStore('customers');
    const imgStore = tx.objectStore('images');
    const allImages = await new Promise(r => { const req = imgStore.getAll(); req.onsuccess = e => r(e.target.result || []); req.onerror = () => r([]); });

    custStore.getAll().onsuccess = (e) => {
        const customers = e.target.result || [];
        const bounds = [];
        customers.forEach(cust => {
            if (!cust.assets) return;
            const custName = decryptText(cust.name);
            cust.assets.forEach(asset => {
                const decryptedLink = decryptText(asset.link);
                const loc = parseLatLngFromLink(decryptedLink);
                if (loc) {
                    const assetName = decryptText(asset.name);
                    const assetVal = decryptText(asset.valuation);
                    const img = allImages.find(i => i.assetId === asset.id) || allImages.find(i => i.customerId === cust.id);
                    const thumb = img ? img.data : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iNjAiPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMzMzMiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzU1NSI+Tk8gSU1BR0U8L3RleHQ+PC9zdmc+';
                    const isApproved = cust.status === 'approved';
                    const markerClass = isApproved ? 'marker-approved' : 'marker-pending';
                    const statusTag = isApproved ? '<span class="map-tag approved">Đã Duyệt</span>' : '<span class="map-tag pending">Thẩm định</span>';
                    const valStr = assetVal ? `<div class="text-xs text-slate-300">Định giá: <b class="text-white">${assetVal}</b></div>` : '';

                    const icon = L.divIcon({
                        className: 'custom-div-icon',
                        html: `<div class="marker-glow ${markerClass}"></div>`,
                        iconSize: [20, 20], iconAnchor: [10, 10]
                    });
                    const marker = L.marker([loc.lat, loc.lng], { icon: icon }).addTo(map);
                    const popupContent = `
                        <div class="map-popup-card" onclick="openMapFolder('${cust.id}')">
                            <img src="${thumb}" class="map-popup-img">
                            <div class="flex justify-between items-start">
                                <div>${statusTag}<div class="font-bold text-sm truncate w-40">${custName}</div><div class="text-[10px] text-slate-400 truncate w-40">${assetName}</div>${valStr}</div>
                                <div class="p-2 bg-indigo-500 rounded-lg text-white mt-1"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg></div>
                            </div>
                            <a href="https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}" target="_blank" class="block mt-2 text-center py-2 bg-white/10 rounded border border-white/10 text-[10px] font-bold text-blue-300 uppercase hover:bg-white/20">Chỉ đường</a>
                        </div>`;
                    marker.bindPopup(popupContent);
                    markers.push(marker);
                    bounds.push([loc.lat, loc.lng]);
                }
            });
        });
        if (bounds.length > 0) map.fitBounds(bounds, { padding: [50, 50] });
    };
}

function openMapFolder(custId) { toggleMap(); openFolder(custId); }
function locateMe() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
            const lat = pos.coords.latitude; const lng = pos.coords.longitude;
            map.setView([lat, lng], 15);
            L.marker([lat, lng], { icon: L.divIcon({ html: '<div style="width:16px;height:16px;background:#3b82f6;border-radius:50%;border:2px solid white;box-shadow:0 0 10px #3b82f6;"></div>', className:'me-marker' }) }).addTo(map);
        }, () => showToast("Không lấy được vị trí"));
    }
}

function getCurrentGPS() {
    if (!navigator.geolocation) { showToast("Thiết bị không hỗ trợ GPS"); return; }
    getEl('loader').classList.remove('hidden'); getEl('loader-text').textContent = "Đang lấy tọa độ...";
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude; const lng = position.coords.longitude;
            const mapLink = `https://www.google.com/maps?q=${lat},${lng}`;
            const inputLink = getEl('asset-link'); inputLink.value = mapLink;
            getEl('loader').classList.add('hidden'); showToast("Đã lấy tọa độ thành công");
        },
        (error) => {
            getEl('loader').classList.add('hidden');
            let msg = "Lỗi GPS";
            switch(error.code) { case error.PERMISSION_DENIED: msg = "Bạn đã chặn quyền GPS"; break; case error.POSITION_UNAVAILABLE: msg = "Không tìm thấy vị trí"; break; case error.TIMEOUT: msg = "Hết thời gian chờ"; break; }
            showToast(msg);
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

function parseLatLngFromLink(input) {
    if (!input) return null;
    const str = input.trim();
    let match = str.match(/^(-?\d{1,3}\.\d+)[,\s]+(-?\d{1,3}\.\d+)$/);
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
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng/2) * Math.sin(dLng/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function parseMoneyToNumber(str) { if(!str) return 0; return parseInt(str.toString().replace(/\D/g, '')) || 0; }

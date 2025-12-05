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
        function toggleMap() {
            const mapScreen = getEl('screen-map');
            if (mapScreen.classList.contains('translate-x-full')) {
                mapScreen.classList.remove('translate-x-full');
                if (!map) initMap(); else renderMapMarkers();
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
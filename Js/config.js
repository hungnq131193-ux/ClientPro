        const PIN_KEY = 'app_pin'; const SEC_KEY = 'app_sec_qa'; const THEME_KEY = 'app_theme';
        const ACTIVATED_KEY = 'app_activated';
        const EMPLOYEE_KEY  = 'app_employee_id';
        let currentPin = '';
        let currentLightboxIndex = 0;
        let currentLightboxList = [];
        let masterKey = null;
        let APP_BACKUP_SECRET = '';
            const encoder = new TextEncoder();
            const data = encoder.encode(str);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
const WEATHER_STORAGE_KEY = 'app_weather_cache_v1';
const WEATHER_CACHE_TTL = 30 * 60 * 1000; // 30 phút
const SCRIPT_KEY = 'app_script_url';
const ADMIN_SERVER_URL = "https://script.google.com/macros/s/AKfycbw0e3GftH7hDQJo12uhlPWyZI-YkFTsx-wNEs2BOG4Cklp1oNgo8ryldtWYyyKFzS6cRA/exec"; 
const USER_SCRIPT_KEY = 'app_user_script_url';
const WEATHER_CODE_TEXT = {
    0: 'Trời quang',
    1: 'Gần như quang',
    2: 'Có mây',
    3: 'Nhiều mây',
    45: 'Sương mù',
    48: 'Sương mù',
    51: 'Mưa phùn nhẹ',
    53: 'Mưa phùn',
    55: 'Mưa phùn to',
    61: 'Mưa nhẹ',
    63: 'Mưa vừa',
    65: 'Mưa to',
    71: 'Tuyết nhẹ',
    80: 'Mưa rào',
    81: 'Mưa rào vừa',
    82: 'Mưa rào to',
    95: 'Dông'
};
const DONATE_BANK_ID = 'vietinbank'; // dùng theo chuẩn VietQR Quick Link 0
const DONATE_ACCOUNT_NO = '888886838888';
const DONATE_ACCOUNT_NAME = 'NGUYEN QUOC HUNG';
const DONATE_DEFAULT_DESC = 'Ung ho tac gia ClientPro';
        let map = null; let markers = [];
        const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
        const TILE_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
                let imgStore;
    const tx = db.transaction(['customers', 'images'], 'readonly');
    const custStore = tx.objectStore('customers');
    const imgStore = tx.objectStore('images');
    const allImages = await new Promise(r => { const req = imgStore.getAll(); req.onsuccess = e => r(e.target.result || []); req.onerror = () => r([]); });
        const customers = e.target.result || [];
        const bounds = [];
            const custName = decryptText(cust.name);
                const decryptedLink = decryptText(asset.link);
                const loc = parseLatLngFromLink(decryptedLink);
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
                        iconSize: [20, 20],
                        iconAnchor: [10, 10]
                    });
                    const marker = L.marker([loc.lat, loc.lng], { icon: icon }).addTo(map);
                    const popupContent = `
    const activated = localStorage.getItem(ACTIVATED_KEY);
    const pinEnc = localStorage.getItem(PIN_KEY);
        const modal = getEl('activation-modal');
        const storedEmp = localStorage.getItem(EMPLOYEE_KEY);
        const savedEmp = localStorage.getItem(EMPLOYEE_KEY) || '';
            const query = `?action=check_status&employeeId=${encodeURIComponent(savedEmp)}&deviceInfo=${encodeURIComponent(navigator.userAgent)}`;
            const res = await fetch(ADMIN_SERVER_URL + query);
            const txt = await res.text();
            let result;
                const modal = getEl('activation-modal');
                const titleEl = document.getElementById('activation-title');
            const encMaster = localStorage.getItem(PIN_KEY);
            const hashedPin = await hashString(currentPin);
            let decrypted = '';
                const bytes = CryptoJS.AES.decrypt(String(encMaster), hashedPin);
            const input = getEl('recovery-answer').value;
            const encMaster = localStorage.getItem(SEC_KEY);
            const hashedAns = await hashString(input);
            let decrypted = '';
                const bytes = CryptoJS.AES.decrypt(String(encMaster), hashedAns);
            const keyInput = getEl('activation-key');
            const empInput = getEl('activation-employee');
            const key = keyInput ? keyInput.value.trim() : '';
            const employeeId = empInput ? empInput.value.trim() : '';
            const scriptUrl = ADMIN_SERVER_URL;
            const query = `?action=activate&key=${encodeURIComponent(key)}&employeeId=${encodeURIComponent(employeeId)}&deviceInfo=${encodeURIComponent(navigator.userAgent)}`;
                const res = await fetch(scriptUrl + query);
                let result;
const txt = await res.text(); // Đọc dữ liệu ra text 1 lần duy nhất
                    const hasOldData = !!localStorage.getItem(SEC_KEY);
                        const modal = getEl('activation-modal');
                        const encMaster = localStorage.getItem(SEC_KEY);
                        let decrypted = '';
                            const hashedAns = await hashString(employeeId);
                            const bytes = CryptoJS.AES.decrypt(String(encMaster), hashedAns);
                            const modal = getEl('activation-modal');
                            const confirmDel = confirm("Phát hiện dữ liệu của nhân viên khác. Tiếp tục sẽ XÓA SẠCH dữ liệu cũ. Đồng ý không?");
                                const modal = getEl('activation-modal');
                    let msg = 'Kích hoạt thất bại. Vui lòng kiểm tra Key của bạn.';
        let currentCustomerId = null; let currentCustomerData = null; let currentAssetId = null;
        let activeListTab = 'pending'; let isSelectionMode = false; let selectedImages = new Set();
        let isCustSelectionMode = false; let selectedCustomers = new Set();
        let captureMode = 'profile'; let stream = null; let currentImageId = null; let currentImageBase64 = null;
            const custIds = Array.from(selectedCustomers); const exportData = { customers: [], images: [] };
            const tx = db.transaction(['customers', 'images'], 'readonly'); const custStore = tx.objectStore('customers'); const imgStore = tx.objectStore('images');
            const allImages = await new Promise(r => { const req = imgStore.getAll(); req.onsuccess = e => r(e.target.result || []); req.onerror = () => r([]); });
            const blob = new Blob([JSON.stringify({v:1.0, ...exportData})], {type:'application/json'});
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `QLKH_Export_${selectedCustomers.size}_KH.json`; a.click();
    const v = getEl('camera-feed');
    const c = getEl('camera-canvas');
    const ctx = c.getContext('2d');
    const rawBase64 = c.toDataURL('image/jpeg', 1.0);
        const customers = await new Promise((resolve, reject) => {
            const tx = db.transaction(['customers'], 'readonly');
            const store = tx.objectStore('customers');
            const req = store.getAll();
            req.onsuccess = (e) => resolve(e.target.result || []);
            req.onerror = (e) => reject(e);
        });
        const cleanCustomers = customers.map((c) => {
            const cust = JSON.parse(JSON.stringify(c));
            // Giải mã các trường văn bản
            cust.name = decryptText(cust.name);
            cust.phone = decryptText(cust.phone);
            cust.cccd = decryptText(cust.cccd);
            // Loại bỏ liên kết Drive ở cấp khách hàng
            cust.driveLink = null;

            if (cust.assets && Array.isArray(cust.assets)) {
                cust.assets = cust.assets.map((a) => {
                    const asset = JSON.parse(JSON.stringify(a));
                    asset.name = decryptText(asset.name);
                    asset.link = decryptText(asset.link);
                    asset.valuation = decryptText(asset.valuation);
                    asset.loanValue = decryptText(asset.loanValue);
                    asset.area = decryptText(asset.area);
                    asset.width = decryptText(asset.width);
                    asset.onland = decryptText(asset.onland);
                    asset.year = decryptText(asset.year);
                    asset.ocrData = decryptText(asset.ocrData);
                    // Loại bỏ liên kết Drive của tài sản
                    asset.driveLink = null;
                    return asset;
                });
            }
            return cust;
        });
        const dataToExport = {
            v: 1.0,
            customers: cleanCustomers,
            images: [] // bỏ ảnh để giảm kích thước backup
        };
        const encrypted = CryptoJS.AES.encrypt(JSON.stringify(dataToExport), APP_BACKUP_SECRET).toString();
        const blob = new Blob([encrypted], {type: 'application/json'});
        const a = document.createElement('a');
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    const scriptUrl = userUrl;
    const tx = db.transaction(['images'], 'readonly');
    const store = tx.objectStore('images');
    const index = store.index('customerId');
        let allImages = e.target.result || [];
        let imagesToUpload = allImages.filter(img => !img.assetId);
        const payload = {
            // Ưu tiên đặt tên folder theo CCCD, fallback sang SĐT nếu chưa có CCCD
            folderName: `${currentCustomerData.name} - ${decryptText(currentCustomerData.cccd) || decryptText(currentCustomerData.phone)}`,
            images: imagesToUpload.map((img, idx) => ({
                name: `img_${Date.now()}_${idx}.jpg`,
                data: img.data
            }))
        };
            const response = await fetch(scriptUrl, {
                method: "POST",
                body: JSON.stringify(payload)
            });
            const result = await response.json();
                    const txDel = db.transaction(['images'], 'readwrite');
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    const scriptUrl = userUrl;
    const assetIndex = currentCustomerData.assets.findIndex(a => a.id === currentAssetId);
    const currentAsset = currentCustomerData.assets[assetIndex];
    const tx = db.transaction(['images'], 'readonly');
    const store = tx.objectStore('images');
    const index = store.index('customerId'); // Lấy tất cả ảnh của khách này trước
        let allImages = e.target.result || [];
        let imagesToUpload = allImages.filter(img => img.assetId === currentAssetId);
        const folderName = `${currentCustomerData.name} - TSBĐ: ${currentAsset.name}`;
        const payload = {
            folderName: folderName,
            images: imagesToUpload.map((img, idx) => ({
                name: `asset_img_${Date.now()}_${idx}.jpg`,
                data: img.data
            }))
        };
            const response = await fetch(scriptUrl, {
                method: "POST",
                body: JSON.stringify(payload)
            });
            const result = await response.json();
                    const txDel = db.transaction(['images'], 'readwrite');
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    const assetIndex = currentCustomerData.assets.findIndex(a => a.id === currentAssetId);
    const folderName = `${currentCustomerData.name} - TSBĐ: ${currentCustomerData.assets[assetIndex].name}`;
        const response = await fetch(userUrl, {
            method: "POST",
            body: JSON.stringify({ action: 'search', folderName: folderName })
        });
        const result = await response.json();
            const encLink = encryptText(result.url); 
            const tx = db.transaction(['customers'], 'readwrite');
            const store = tx.objectStore('customers');
                let dbRecord = e.target.result;
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    const name = currentCustomerData.name;
    const phone = decryptText(currentCustomerData.phone);
    const cccd = decryptText(currentCustomerData.cccd);
    const possibleNames = [];
    let foundUrl = null;
            const response = await fetch(userUrl, {
                method: "POST",
                body: JSON.stringify({ action: 'search', folderName: folderName })
            });
            const result = await response.json();
        const tx = db.transaction(['customers'], 'readwrite');
let currentOcrBase64 = null;
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    const scriptUrl = userUrl;
    const tx = db.transaction(['images'], 'readonly');
    const index = tx.objectStore('images').index('customerId');
        let allImages = e.target.result || [];
        let imagesToUpload = allImages.filter(img => !img.assetId);
        const payload = {
            action: 'upload',
            // Ưu tiên đặt tên folder theo CCCD, fallback sang SĐT nếu chưa có CCCD
            folderName: `${currentCustomerData.name} - ${decryptText(currentCustomerData.cccd) || decryptText(currentCustomerData.phone)}`,
            images: imagesToUpload.map((img, idx) => ({
                name: `hoso_${Date.now()}_${idx}.jpg`,
                data: img.data
            }))
        };
            const response = await fetch(scriptUrl, {
                method: "POST",
                body: JSON.stringify(payload)
            });
            const result = await response.json();
                    const txDel = db.transaction(['images'], 'readwrite');
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    const scriptUrl = userUrl;
    const tx = db.transaction(['images'], 'readonly');
    const store = tx.objectStore('images');
    const index = store.index('customerId');
        let allImages = e.target.result || [];
        let imagesToUpload = allImages.filter(img => !img.assetId);
        const payload = {
            action: 'upload', // <--- Báo cho Script biết là muốn Upload
            // Ưu tiên đặt tên folder theo CCCD, fallback sang SĐT nếu chưa có CCCD
            folderName: `${currentCustomerData.name} - ${decryptText(currentCustomerData.cccd) || decryptText(currentCustomerData.phone)}`,
            images: imagesToUpload.map((img, idx) => ({
                name: `hoso_${Date.now()}_${idx}.jpg`,
                data: img.data // Gửi cả mảng ảnh đi 1 lần
            }))
        };
            const response = await fetch(scriptUrl, {
                method: "POST",
                body: JSON.stringify(payload)
            });
            const result = await response.json();
                    const txDel = db.transaction(['images'], 'readwrite');
let html5QrCode = null; // Biến giữ camera
let isQrBusy = false;   // Biến chống click đúp
let qrMode = null;      // Biến lưu chế độ (cccd hoặc redbook)
let autoZoomInterval = null; 
    const modal = getEl('qr-modal');
    const regionId = 'qr-reader';
        const devices = await Html5Qrcode.getCameras();
        let cameraId = null;
            const backCam = devices.find(d => {
                const l = d.label.toLowerCase();
                return l.includes('back') || l.includes('rear') || l.includes('environment') || l.includes('sau');
            });
        const config = { fps: 30, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0, disableFlip: false };
                const track = html5QrCode.getRunningTrackCameraCapabilities();
                const zoomCap = track.zoomFeature();
                    let currentZoom = Math.min(2.2, zoomCap.max());
                    const modalContent = document.querySelector('#qr-modal .glass-panel');
                    const oldSlider = document.getElementById('my-zoom-slider-container');
                    const sliderDiv = document.createElement('div');
                    let direction = 1; // 1 là tăng, -1 là giảm
                    const sliderEl = document.getElementById('zoom-slider');
                    const step = 0.05; // Tốc độ trôi (càng nhỏ càng mượt)
                    const maxZ = Math.min(3.5, zoomCap.max()); // Zoom tối đa
                    const minZ = Math.max(1.5, zoomCap.min()); // Zoom tối thiểu
console.warn = function() {};

        function getEl(id) { return document.getElementById(id); }
        const DB_NAME='QLKH_Pro_V4'; let db;
        // Thêm các key cho kích hoạt thiết bị & mã nhân viên
        // ---- Security & Encryption Helpers ----
        // --- Security & Encryption Helpers (ADVANCED RECOVERY MODE) ---
        // Sử dụng masterKey cho cơ chế mã hóa toàn bộ dữ liệu và khôi phục bằng mã nhân viên.
        /**
         * Hằng số bí mật dùng để mã hóa/giải mã dữ liệu backup.
         * Cần giữ bí mật chuỗi này để đảm bảo file backup không thể đọc được nếu không có khóa.
         */

        /**
         * Compute a SHA-256 hash of the provided PIN string and return it as a hex string.
         * Uses the Web Crypto API for consistent hashing.
         * @param {string} pin
         * @returns {Promise<string>}
         */
        async function hashString(str) {
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }

        /**
         * Encrypt a text value using AES và masterKey. Nếu chưa có masterKey thì trả về nguyên bản.
         * @param {string} text
         * @returns {string}
         */

        /**
         * Decrypt một chuỗi AES bằng masterKey. Nếu chưa có masterKey hoặc giải mã thất bại thì trả lại nguyên bản.
         * @param {string} cipher
         * @returns {string}
         */

        /**
         * Sinh master key ngẫu nhiên. Master key dùng để mã hóa/giải mã toàn bộ thông tin khách hàng.
         * @returns {string}
         */

        /**
         * Giải mã toàn bộ thông tin khách hàng (bao gồm tài sản) bằng masterKey.
         * @param {Object} cust
         * @returns {Object}
         */

        /**
         * Escape HTML special characters in a string to mitigate XSS risks when inserting into innerHTML.
         * @param {string} str
         * @returns {string}
         */
        function escapeHTML(str) {
            if (str === undefined || str === null) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }
        // --- WEATHER CONFIG (Open-Meteo: không cần API key) ---
// --- CẤU HÌNH SERVER TRUNG TÂM ---
// map weathercode -> text tiếng Việt đơn giản
// --- END WEATHER CONFIG ---
        // --- DONATE CONFIG ---
// --- END DONATE CONFIG ---
        // --- MAP SYSTEM VARIABLES ---

        // --- GPS FEATURE V1.1 ---

        // --- SMART LOCATION PARSER V2 (Fix lệch) ---


        function parseMoneyToNumber(str) { if(!str) return 0; return parseInt(str.toString().replace(/\D/g, '')) || 0; }
        
        // --- AI-LITE CHO ẢNH TÀI LIỆU (giảm noise, nền trắng, chữ nét) ---
// Removed enhanceDocumentWithAI as OCR is no longer used

                if(!db.objectStoreNames.contains('images')) imgStore = db.createObjectStore('images', {keyPath:'id'});
                else imgStore = e.target.transaction.objectStore('images');
                if(!imgStore.indexNames.contains('customerId')) imgStore.createIndex('customerId', 'customerId', {unique: false});
            };
            req.onsuccess = e => { db = e.target.result; loadCustomers(); getEl('loader').classList.add('hidden'); checkSecurity(); };
            getEl('search-input').addEventListener('input', e => loadCustomers(e.target.value));
            setupSwipe();
        });

        // --- MAP FUNCTIONS ---


        // --- ĐÃ SỬA: GIẢI MÃ LINK VÀ THÔNG TIN TRƯỚC KHI VẼ MAP ---
async function renderMapMarkers() {
    if (!db || !map) return;
    // Xóa marker cũ
    markers.forEach(m => map.removeLayer(m));
    markers = [];


    // Lấy trước toàn bộ ảnh để làm thumbnail

    custStore.getAll().onsuccess = (e) => {

        customers.forEach(cust => {
            if (!cust.assets) return;
            
            // 1. GIẢI MÃ TÊN KHÁCH HÀNG (để hiện trên Popup)

            cust.assets.forEach(asset => {
                // 2. QUAN TRỌNG: GIẢI MÃ LINK TRƯỚC KHI TÁCH TỌA ĐỘ
                
                if (loc) {
                    // 3. GIẢI MÃ CÁC THÔNG TIN TÀI SẢN KHÁC

                    // Tìm ảnh đại diện
                    
                    // Style marker theo trạng thái
                    
                    // Hiển thị giá trị định giá đã giải mã


                    
                    // Popup với thông tin đã giải mã
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



        // --- EXISTING LOGIC ---
         * Kiểm tra trạng thái kích hoạt và bảo mật của ứng dụng.
         * Trình tự:
         *  1. Nếu chưa kích hoạt (không có app_activated), hiển thị modal kích hoạt.
         *  2. Nếu đã kích hoạt nhưng chưa tạo PIN, hiển thị màn hình thiết lập PIN.
         *     Mã nhân viên sẽ được điền sẵn từ localStorage để người dùng không cần nhập lại.
         *  3. Nếu đã có PIN, hiển thị màn hình khóa để nhập PIN.
         */
        // --- HÀM CHECK BẢO MẬT MỚI (MỞ KHÓA SIÊU TỐC) ---
async function checkSecurity() {
    // 1. KIỂM TRA DỮ LIỆU TRONG MÁY TRƯỚC (Cực nhanh)

    // Nếu chưa kích hoạt -> Hiện bảng kích hoạt luôn
    if (!activated) {
        if (modal) modal.classList.remove('hidden');
        return; 
    }

    // Nếu đã kích hoạt -> HIỆN MÀN HÌNH KHÓA NGAY (Không chờ Server)
    if (!pinEnc) {
        // Chưa có PIN -> Hiện bảng tạo PIN
        getEl('setup-lock-modal').classList.remove('hidden');
        // Điền sẵn mã NV nếu có
        if (storedEmp) getEl('setup-answer').value = storedEmp;
    } else {
        // Đã có PIN -> Hiện bàn phím nhập PIN ngay lập tức
        showLockScreen();
    }

    // 2. CHECK NGẦM VỚI SERVER (Background Check)
    // Phần này chạy âm thầm bên dưới, không làm đơ màn hình của bạn
    try {
        if (savedEmp) {
            
            try { result = JSON.parse(txt); } catch (e) { result = {}; }

            // Nạp Key bí mật vào RAM
            if (result.secret) {
                APP_BACKUP_SECRET = result.secret;
            }

            if (result.status === 'locked') {
                getEl('screen-lock').classList.add('hidden');
                getEl('setup-lock-modal').classList.add('hidden');
                modal.classList.remove('hidden');
                if (titleEl) titleEl.textContent = result.message || 'Tài khoản đã bị thu hồi!';
                localStorage.removeItem(ACTIVATED_KEY);
            }
        }
    } catch (err) {
        console.log("Offline mode: Tính năng Backup bảo mật tạm thời bị tắt.");
    }
}
        async function validatePin() {
            // Tính băm của PIN nhập vào
            try {
                decrypted = bytes.toString(CryptoJS.enc.Utf8);
            } catch (e) {
                decrypted = '';
            }
            if (decrypted && decrypted.startsWith('mk_')) {
                // Nếu giải mã thành công, thiết lập masterKey và mở khóa giao diện
                masterKey = decrypted;
                getEl('screen-lock').classList.add('hidden');
                // Sau khi unlock, tải lại danh sách khách hàng để giải mã dữ liệu
                loadCustomers(getEl('search-input').value);
            } else {
                setTimeout(() => {
                    alert("Sai mã PIN");
                    clearPin();
                }, 100);
            }
        }
async function checkRecovery() {
            try {
                decrypted = bytes.toString(CryptoJS.enc.Utf8);
            } catch (e) {
                decrypted = '';
            }
            if (decrypted && decrypted.startsWith('mk_')) {
                // Khôi phục masterKey và cho phép đặt lại PIN
                masterKey = decrypted;
                alert("Xác thực thành công. Tạo PIN mới.");
                closeForgotModal();
                // Ẩn màn hình khóa, mở modal thiết lập PIN mới
                getEl('screen-lock').classList.add('hidden');
                getEl('setup-lock-modal').classList.remove('hidden');
                getEl('setup-pin').value = '';
                // điền sẵn mã nhân viên để người dùng không cần gõ lại
                getEl('setup-answer').value = input;
            } else {
                alert("Mã nhân viên không khớp!");
            }
        }

        /**
         * Xử lý kích hoạt ứng dụng bằng cách gửi mã key và mã nhân viên lên server.
         * Sau khi server xác nhận thành công, lưu trạng thái kích hoạt và mã nhân viên vào localStorage rồi mở giao diện thiết lập PIN.
         */
        async function activateApp() {
            if (!key || !employeeId) {
                alert("Vui lòng nhập đầy đủ Mã kích hoạt và Mã nhân viên");
                return;
            }
            // Luôn sử dụng máy chủ quản trị trung tâm để xử lý kích hoạt
            // Tạo URL kèm tham số query để gọi Apps Script bằng phương thức GET
            try {
                // Một số Apps Script cần trả về JSON thuần. Nếu trả về text 'success', vẫn xử lý được.
                // --- ĐOẠN CODE ĐÃ SỬA ---
try {
    result = JSON.parse(txt); // Thử chuyển nó sang JSON
} catch (e) {
    result = txt; // Nếu không chuyển được thì giữ nguyên là text
}
                // Kiểm tra thành công: server có thể trả về {status:'success'} hoặc 'success'
                if ((result && result.status && String(result.status).toLowerCase() === 'success') || String(result).toLowerCase().includes('success')) {
                    // Thành công: xử lý tùy theo máy mới hay tái kích hoạt
                    if (result.secret) {
                        APP_BACKUP_SECRET = result.secret;
                        console.log("Đã nhận chìa khóa bảo mật từ Server");
                    }
                    if (!hasOldData) {
                        // Trường hợp máy mới: Lưu trạng thái kích hoạt và yêu cầu tạo PIN mới
                        localStorage.setItem(ACTIVATED_KEY, 'true');
                        localStorage.setItem(EMPLOYEE_KEY, employeeId);
                        if (modal) modal.classList.add('hidden');
                        // Hiển thị thiết lập PIN
                        getEl('setup-lock-modal').classList.remove('hidden');
                        getEl('setup-pin').value = '';
                        getEl('setup-answer').value = employeeId;
                        showToast("Kích hoạt thành công! Vui lòng tạo mã PIN.");
                    } else {
                        // Tái kích hoạt trên máy đã có dữ liệu: xác thực mã nhân viên
                        try {
                            decrypted = bytes.toString(CryptoJS.enc.Utf8);
                        } catch (e) {
                            decrypted = '';
                        }
                        if (decrypted && decrypted.startsWith('mk_')) {
                            // Đúng nhân viên cũ: giữ nguyên masterKey và dữ liệu, gia hạn thành công
                            masterKey = decrypted;
                            localStorage.setItem(ACTIVATED_KEY, 'true');
                            localStorage.setItem(EMPLOYEE_KEY, employeeId);
                            if (modal) modal.classList.add('hidden');
                            // Nếu đã có PIN, yêu cầu nhập PIN cũ để vào
                            if (localStorage.getItem(PIN_KEY)) {
                                showToast("Gia hạn thành công! Dữ liệu cũ vẫn an toàn.");
                                showLockScreen();
                            } else {
                                // Nếu vì lý do nào đó không có PIN, cho tạo mới
                                getEl('setup-lock-modal').classList.remove('hidden');
                                getEl('setup-pin').value = '';
                                getEl('setup-answer').value = employeeId;
                                showToast("Gia hạn thành công! Tạo PIN mới.");
                            }
                        } else {
                            // Nhân viên khác: cảnh báo và hỏi xác nhận để xóa dữ liệu cũ
                            if (confirmDel) {
                                try {
                                    // Xóa toàn bộ localStorage và CSDL
                                    localStorage.clear();
                                    indexedDB.deleteDatabase(DB_NAME);
                                } catch (e) {}
                                // Đặt lại masterKey và lưu trạng thái kích hoạt mới
                                masterKey = null;
                                localStorage.setItem(ACTIVATED_KEY, 'true');
                                localStorage.setItem(EMPLOYEE_KEY, employeeId);
                                if (modal) modal.classList.add('hidden');
                                // Cho phép tạo PIN mới
                                getEl('setup-lock-modal').classList.remove('hidden');
                                getEl('setup-pin').value = '';
                                getEl('setup-answer').value = employeeId;
                                showToast("Đã kích hoạt cho người dùng mới, vui lòng tạo PIN.");
                            }
                            // Nếu không đồng ý, không làm gì cả
                        }
                    }
                } else {
                    if (result && result.message) msg = result.message;
                    alert(msg);
                }
            } catch (err) {
                alert("Lỗi kết nối: " + err.message);
            }
        }


        function getZaloLink(phone) { let p = phone.replace(/[\s\.]/g, ''); if (p.startsWith('0')) p = '84' + p.substring(1); return `https://zalo.me/${p}`; }
        function showToast(msg) { const t=getEl('toast'); getEl('toast-msg').textContent=msg; t.classList.add('toast-show'); setTimeout(()=>t.classList.remove('toast-show'), 2000); }
        function formatLink(link) { if(!link) return ''; if(link.startsWith('http')) return link; return 'https://' + link; }
        
        async function backupSelectedCustomers() {
            if(selectedCustomers.size === 0) return alert("Chưa chọn KH");
            getEl('loader').classList.remove('hidden'); getEl('loader-text').textContent = "Đóng gói...";
            for(const id of custIds) { const cust = await new Promise(r => { const req = custStore.get(id); req.onsuccess = e => r(e.target.result); req.onerror = () => r(null); }); if(cust) exportData.customers.push(cust); }
            exportData.images = allImages.filter(img => custIds.includes(img.customerId));
            getEl('loader').classList.add('hidden'); toggleCustSelectionMode();
        }


        
        

        


        // --- ĐÃ SỬA: GIẢI MÃ DỮ LIỆU TRƯỚC KHI TÍNH TOÁN KHOẢNG CÁCH ---


        // --- NEW GUIDE MODAL LOGIC ---

        
        function dataURLtoBlob(dataurl) { var arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1], bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n); while(n--){ u8arr[n] = bstr.charCodeAt(n); } return new Blob([u8arr], {type:mime}); }
        async function shareSelectedImages() { 
            if(!selectedImages.size) return; getEl('loader').classList.remove('hidden'); getEl('loader-text').textContent = "Đóng gói ảnh...";
            try { const tx = db.transaction(['images'], 'readonly'); const store = tx.objectStore('images'); const filePromises = Array.from(selectedImages).map(id => { return new Promise((resolve) => { const req = store.get(id); req.onsuccess = (e) => { if(e.target.result) { const blob = dataURLtoBlob(e.target.result.data); resolve(new File([blob], `img_${Date.now()}_${Math.random().toString(36).substr(2,5)}.jpg`, {type: 'image/jpeg'})); } else resolve(null); }; req.onerror = () => resolve(null); }); });
                const files = (await Promise.all(filePromises)).filter(f => f !== null); getEl('loader').classList.add('hidden');
                if (files.length > 0) { if (navigator.canShare && navigator.canShare({ files })) { await navigator.share({ files, title: 'SmartBanking', text: 'Gửi ảnh hồ sơ' }); } else { alert("Thiết bị không hỗ trợ chia sẻ nhiều ảnh."); } } toggleSelectionMode();
            } catch (err) { getEl('loader').classList.add('hidden'); console.error(err); alert("Lỗi chia sẻ"); }
        }

        
    function compressImage(base64, cb) {
    const img = new Image();
    img.onload = () => {
        let w = img.width;
        let h = img.height;
        
        // Cho phép max ~2200px để chữ vẫn rất nét
        const maxDim = 2200;
        if (w > h && w > maxDim) {
            h = h * maxDim / w;
            w = maxDim;
        } else if (h >= w && h > maxDim) {
            w = w * maxDim / h;
            h = maxDim;
        }
        
        const cvs = document.createElement('canvas');
        cvs.width = Math.round(w);
        cvs.height = Math.round(h);
        const ctx = cvs.getContext('2d');
        
        // Filter nhẹ (không quá tay để khỏi mờ chữ)
        ctx.filter = 'contrast(1.03) brightness(1.01)';
        ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
        
        // Bắt đầu với chất lượng khá cao
        let q = 0.9;
        
        // Mục tiêu: 500–700KB
        const MAX_BYTES = 700 * 1024;
        const MIN_BYTES = 500 * 1024;
        
        function adjustAndCheck() {
            const dataUrl = cvs.toDataURL('image/jpeg', q);
            // Ước lượng size binary từ base64
            const sizeBytes = Math.floor(dataUrl.length * 0.75);
            
            // DEBUG nếu muốn xem thực tế:
            // console.log('q=', q, 'size=', (sizeBytes/1024).toFixed(0), 'KB');
            
            // Nếu > 700KB → giảm chất lượng xuống
            if (sizeBytes > MAX_BYTES && q > 0.5) {
                q -= 0.05;
                setTimeout(adjustAndCheck, 0);
                return;
            }
            
            // Nếu < 500KB mà vẫn còn room tăng chất lượng → tăng lên
            if (sizeBytes < MIN_BYTES && q < 0.96) {
                q += 0.03;
                setTimeout(adjustAndCheck, 0);
                return;
            }
            
            // Chốt ở đây: nằm trong [500, 700] hoặc hết room chỉnh
            cb(dataUrl);
        }
        
        adjustAndCheck();
    };
    
    img.onerror = () => {
        // Nếu lỗi thì trả luôn ảnh gốc để tránh treo app
        cb(base64);
    };
    
    img.src = base64;
}
        // --- BƯỚC 3: SỬA HÀM LƯU ẢNH (ĐỂ KÍCH HOẠT OCR TÀI SẢN) ---
// --- ĐÃ SỬA: FIX LỖI KHÔNG REFRESH ẢNH & BỎ TỰ ĐỘNG OCR ---
        async function tryOpenCamera(mode) { captureMode=mode; try { getEl('camera-modal').classList.remove('hidden'); stream = await navigator.mediaDevices.getUserMedia({
    video: {
        facingMode: { ideal: 'environment' },
        // Ưu tiên Full HD trở lên
        width: { min: 1280, ideal: 1920, max: 2560 },
        height: { min: 720, ideal: 1080, max: 1440 }
    }
}); getEl('camera-feed').srcObject = stream; } catch { getEl('camera-modal').classList.add('hidden'); getEl(mode==='profile'?'native-camera-profile':'native-camera-asset').click(); } }
// CHỤP ẢNH TỪ CAMERA
async function capturePhoto() {
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    
    ctx.drawImage(v, 0, 0);
    
    // Ảnh gốc chất lượng cao
    
    // Tắt camera trước khi xử lý
    closeCamera();
    
    // Bỏ qua xử lý OCR ở chế độ 'ocr' vì đã chuyển sang quét QR offline
    
    // Lưu ảnh vào DB như cũ (hồ sơ / tài sản / bìa đỏ đều dùng chung)
    await saveImageToDB(rawBase64);
}
// HÀM BACKUP MỚI (CHỈ LƯU THÔNG TIN - LOẠI BỎ ẢNH & LINK)
// ============================================================
async function backupData() { 
    if (!APP_BACKUP_SECRET) {
        alert("BẢO MẬT: Không thể xuất file khi đang Offline hoặc chưa xác thực với Server.\n\nVui lòng kết nối mạng và mở lại App để hệ thống tải khóa bảo mật.");
        return;
    }
    // Đóng menu và hiển thị loader
    toggleMenu(); 
    getEl('loader').classList.remove('hidden');
    getEl('loader-text').textContent = "Đóng gói (Bảo mật)...";
    try {
        // Đọc toàn bộ khách hàng từ IndexedDB

        // Chuẩn hoá dữ liệu: giải mã các trường cần thiết và loại bỏ driveLink

        // Đóng gói dữ liệu xuất

        // Mã hóa toàn bộ dữ liệu bằng khóa bí mật

        // Tạo file chứa dữ liệu đã mã hóa
        a.href = URL.createObjectURL(blob);
        a.download = `ClientPro_Backup_${Date.now()}.cpro`;
        a.click();

        showToast("Đã xuất file");
    } catch(err) {
        console.error(err);
        alert("Lỗi xuất file");
    } finally {
        // Ẩn loader trong mọi trường hợp
        getEl('loader').classList.add('hidden');
    }
}

function buildDonateQRUrl() {
    // Theo Quick Link VietQR: https://img.vietqr.io/image/<BANK_ID>-<ACCOUNT_NO>-<TEMPLATE>.jpg?accountName=...&addInfo=... 1
    const base = `https://img.vietqr.io/image/${DONATE_BANK_ID}-${DONATE_ACCOUNT_NO}-compact2.jpg`;
    const params = new URLSearchParams({
        accountName: DONATE_ACCOUNT_NAME,
        addInfo: DONATE_DEFAULT_DESC
    });
    return `${base}?${params.toString()}`;
}



function copyDonateAccount() {
    const acc = DONATE_ACCOUNT_NO;
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(acc)
            .then(() => {
                showToast('Đã copy số tài khoản VietinBank');
            })
            .catch(() => {
                fallbackCopyDonate(acc);
            });
    } else {
        fallbackCopyDonate(acc);
    }
}

function fallbackCopyDonate(text) {
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    try {
        document.execCommand('copy');
        showToast('Đã copy số tài khoản');
    } catch (e) {
        alert('Không copy được, vui lòng nhập tay STK: ' + text);
    }
    document.body.removeChild(input);
}

// =========== END DONATE FEATURE ===========
// ================== WEATHER (OPEN-METEO, NO KEY) ==================






        // ================== END WEATHER ==================
    // --- LOGIC UPLOAD DRIVE & CẤU HÌNH ---

// 2. Hàm Upload chính
async function uploadToGoogleDrive() {
    // Dùng Script cá nhân cho việc upload ảnh hồ sơ. Kiểm tra xem user đã cấu hình link hay chưa.
    if (!userUrl || userUrl.length < 10) {
        if (confirm("Bạn chưa cấu hình nơi lưu ảnh cá nhân! Bấm OK để vào Cài đặt nhập Link Script của bạn.")) {
            toggleMenu();
        }
        return;
    }
    
    if (!currentCustomerData) return;

    // Lấy ảnh từ Database
    getEl('loader').classList.remove('hidden');
    getEl('loader-text').textContent = "Đang kiểm tra ảnh...";
    

    index.getAll(currentCustomerId).onsuccess = async (e) => {
        // Lọc: Chỉ lấy ảnh chưa được gắn vào Asset (ảnh hồ sơ)

        if (imagesToUpload.length === 0) {
            getEl('loader').classList.add('hidden');
            return alert("Không có ảnh nào để tải lên!");
        }

        if (!confirm(`Tải lên ${imagesToUpload.length} ảnh lên Google Drive?`)) {
            getEl('loader').classList.add('hidden');
            return;
        }

        getEl('loader-text').textContent = "Đang tải lên Cloud...";

        // Chuẩn bị gói dữ liệu

        try {
            // Gửi request (no-cors để tránh lỗi trình duyệt chặn, nhưng script google phải set JSONP hoặc text)
            // Lưu ý: Fetch POST tới Google Script đôi khi cần xử lý kỹ.
            // Dùng cách gửi tiêu chuẩn:
            

            if (result.status === 'success') {
                // Lưu link và dọn dẹp
                currentCustomerData.driveLink = result.url;
                db.transaction(['customers'], 'readwrite').objectStore('customers').put(currentCustomerData);
                
                getEl('loader').classList.add('hidden');
                renderDriveStatus(result.url); // Hiển thị nút mở Drive
                
                // Hỏi xóa ảnh gốc
                if(confirm("✅ UPLOAD THÀNH CÔNG!\n\nXóa ảnh trong App để giải phóng bộ nhớ?")) {
                    imagesToUpload.forEach(img => txDel.objectStore('images').delete(img.id));
                    txDel.oncomplete = () => {
                        loadProfileImages(); // Làm mới lưới ảnh (trống trơn)
                        showToast("Đã dọn dẹp bộ nhớ");
                    };
                }
            } else {
                throw new Error(result.message);
            }
        } catch (err) {
            console.error(err);
            getEl('loader').classList.add('hidden');
            alert("Lỗi Upload: " + err.message + "\nKiểm tra lại Link Script hoặc Mạng.");
        }
    };
}

// 3. Hàm hiển thị nút mở Drive

// --- LOGIC UPLOAD DRIVE CHO TÀI SẢN (TSBĐ) ---

async function uploadAssetToDrive() {
    // Lấy link Script cá nhân
    if (!userUrl || userUrl.length < 10) {
        if (confirm("Bạn chưa cấu hình nơi lưu ảnh cá nhân! Bấm OK để vào Cài đặt nhập Link Script của bạn.")) {
            toggleMenu();
        }
        return;
    }
    
    if (!currentCustomerData || !currentAssetId) return;

    // Tìm xem đang thao tác với Tài sản nào trong mảng assets
    if (assetIndex === -1) return;

    getEl('loader').classList.remove('hidden');
    getEl('loader-text').textContent = "Đang lấy ảnh TSBĐ...";


    index.getAll(currentCustomerId).onsuccess = async (e) => {
        
        // LỌC QUAN TRỌNG: Chỉ lấy ảnh có assetId TRÙNG VỚI assetId hiện tại

        if (imagesToUpload.length === 0) {
            getEl('loader').classList.add('hidden');
            return alert("Tài sản này chưa có ảnh nào!");
        }

        if (!confirm(`Tải lên ${imagesToUpload.length} ảnh của tài sản "${currentAsset.name}" lên Drive?`)) {
            getEl('loader').classList.add('hidden');
            return;
        }

        getEl('loader-text').textContent = "Đang Upload TSBĐ...";

        // Đặt tên Folder: [Tên Khách] - [Tên Tài Sản]
        // Ví dụ: Nguyen Van A - Nhà Đất 50m2


        try {
            

            if (result.status === 'success') {
                // 1. Lưu Link vào đúng đối tượng Asset
                currentCustomerData.assets[assetIndex].driveLink = result.url;
                
                // 2. Cập nhật Database
                db.transaction(['customers'], 'readwrite').objectStore('customers').put(currentCustomerData);
                
                getEl('loader').classList.add('hidden');
                
                // 3. Cập nhật giao diện
                renderAssetDriveStatus(result.url);
                
                // 4. Hỏi xóa ảnh
                if(confirm("✅ TSBĐ ĐÃ LÊN MÂY!\n\nXóa ảnh gốc trong máy để nhẹ bộ nhớ?")) {
                    imagesToUpload.forEach(img => txDel.objectStore('images').delete(img.id));
                    txDel.oncomplete = () => {
                        loadAssetImages(currentAssetId); // Load lại lưới ảnh (trống)
                        showToast("Đã dọn dẹp ảnh TSBĐ");
                    };
                }
            } else {
                throw new Error(result.message);
            }

        } catch (err) {
            console.error(err);
            getEl('loader').classList.add('hidden');
            alert("Lỗi: " + err.message);
        }
    };
}

// 1. Cập nhật giao diện: Thêm nút Tìm kết nối cũ

// 2. Logic tìm kiếm (Sử dụng Script cá nhân USER_SCRIPT_KEY)
async function reconnectAssetDriveFolder() {
    if (!userUrl || userUrl.length < 10) {
        if (confirm("Bạn chưa cấu hình nơi lưu ảnh cá nhân! Bấm OK để vào Cài đặt nhập Link Script của bạn.")) toggleMenu();
        return;
    }
    
    if (!currentCustomerData || !currentAssetId) return;
    if (assetIndex === -1) return;

    getEl('loader').classList.remove('hidden');
    getEl('loader-text').textContent = "Đang tìm TSBĐ...";
    

    try {

        if (result.status === 'found') {
            // Mã hóa link tìm được trước khi lưu vào DB
            
            store.get(currentCustomerData.id).onsuccess = (e) => {
                if (dbRecord && dbRecord.assets && dbRecord.assets[assetIndex]) {
                    dbRecord.assets[assetIndex].driveLink = encLink;
                    store.put(dbRecord);
                }
            };
            tx.oncomplete = () => {
                currentCustomerData.assets[assetIndex].driveLink = result.url; // Cập nhật hiển thị
                getEl('loader').classList.add('hidden');
                renderAssetDriveStatus(result.url);
                showToast("Đã kết nối lại!");
            };
        } else {
            getEl('loader').classList.add('hidden');
            alert("Không tìm thấy folder: " + folderName);
        }
    } catch (err) {
        getEl('loader').classList.add('hidden');
        alert("Lỗi: " + err.message);
    }
}
// --- TÍNH NĂNG TÌM LẠI FOLDER THẤT LẠC ---
async function reconnectDriveFolder() {
    // Lấy link Script cá nhân; nếu chưa cấu hình thì nhắc người dùng cài đặt
    if (!userUrl || userUrl.length < 10) {
        if (confirm("Chưa cấu hình Script! Vào cài đặt ngay?")) toggleMenu();
        return;
    }
    // Không có dữ liệu khách hàng hiện tại thì dừng
    if (!currentCustomerData) return;

    // Hiển thị loader và cập nhật thông báo
    getEl('loader').classList.remove('hidden');
    getEl('loader-text').textContent = "Đang tìm trên Drive...";

    // Lấy thông tin tên, SĐT và CCCD sau khi giải mã (hàm decryptText sẽ trả lại nguyên bản nếu đầu vào đã giải mã)

    // Tạo danh sách tên thư mục có thể có: ưu tiên theo CCCD trước, sau đó là SĐT
    if (cccd) possibleNames.push(`${name} - ${cccd}`);
    if (phone) possibleNames.push(`${name} - ${phone}`);


    // Thử tìm lần lượt các tên trong danh sách
    for (const folderName of possibleNames) {
        try {
            getEl('loader-text').textContent = `Đang tìm: ${folderName}...`;
            if (result.status === 'found') {
                foundUrl = result.url;
                break;
            }
        } catch (e) {
            console.warn("Lỗi tìm kiếm:", e);
        }
    }

    // Nếu tìm thấy thì lưu và cập nhật giao diện, ngược lại báo lỗi
    if (foundUrl) {
        currentCustomerData.driveLink = foundUrl;
        tx.objectStore('customers').put(currentCustomerData).onsuccess = () => {
            getEl('loader').classList.add('hidden');
            renderDriveStatus(foundUrl);
            showToast("Đã kết nối lại thành công!");
        };
    } else {
        getEl('loader').classList.add('hidden');
        alert("Không tìm thấy folder nào khớp với Tên + CCCD hoặc Tên + SĐT.");
    }
}
// ============================================================
// LOGIC KẾT NỐI GOOGLE APPS SCRIPT (OCR & UPLOAD)
// ============================================================

// Link Script mặc định đã bị loại bỏ trong mô hình "Quản lý tập trung - Lưu trữ phân tán".
// Vui lòng cấu hình link Script cá nhân của bạn trong phần Cài đặt (lưu bằng USER_SCRIPT_KEY). Không dùng biến mặc định nữa.


// 1. Mở Modal OCR
// Removed OCR modal handlers and OCR execution functions as OCR is no longer used

// 4. HÀM UPLOAD ẢNH (Gửi mảng ảnh lên Google Script)
async function uploadToGoogleDrive() {
    // Sử dụng Script cá nhân của người dùng. Nếu chưa cấu hình, hướng dẫn người dùng vào Cài đặt
    if (!userUrl || userUrl.length < 10) {
        if (confirm("Bạn chưa cấu hình nơi lưu ảnh cá nhân! Bấm OK để vào Cài đặt nhập Link Script của bạn.")) {
            toggleMenu();
        }
        return;
    }
    if (!currentCustomerData) return;

    getEl('loader').classList.remove('hidden');
    getEl('loader-text').textContent = "Đang kiểm tra ảnh...";
    

    index.getAll(currentCustomerId).onsuccess = async (e) => {

        if (imagesToUpload.length === 0) {
            getEl('loader').classList.add('hidden');
            return alert("Không có ảnh nào để tải lên!");
        }

        if (!confirm(`Tải lên ${imagesToUpload.length} ảnh hồ sơ?`)) {
            getEl('loader').classList.add('hidden');
            return;
        }

        getEl('loader-text').textContent = "Đang Upload lên Drive...";

        // Đóng gói mảng ảnh

        try {
            

            if (result.status === 'success') {
                currentCustomerData.driveLink = result.url;
                db.transaction(['customers'], 'readwrite').objectStore('customers').put(currentCustomerData);
                
                getEl('loader').classList.add('hidden');
                renderDriveStatus(result.url);
                
                if(confirm("✅ Upload thành công!\nXóa ảnh trong App để giải phóng bộ nhớ?")) {
                    imagesToUpload.forEach(img => txDel.objectStore('images').delete(img.id));
                    txDel.oncomplete = () => { loadProfileImages(); };
                }
            } else {
                throw new Error(result.message);
            }
        } catch (err) {
            getEl('loader').classList.add('hidden');
            alert("Lỗi Upload: " + err.message);
        }
    };
}

// --- CẬP NHẬT REGEX THÔNG MINH (V5: BẮT DÍNH LOẠI ĐẤT & SỐ BÌA) ---


// --- CẬP NHẬT HIỂN THỊ KẾT QUẢ ---


// Removed old mobile copy functions (copyOcrResult and fallbackCopyText) as OCR features have been replaced by QR scanning. Use copyToClipboard() instead.



// --- LOGIC UPLOAD ẢNH HỒ SƠ ---
async function uploadToGoogleDrive() {
    // Lấy link Script cá nhân cho upload tài sản
    if (!userUrl || userUrl.length < 10) {
        if (confirm("Bạn chưa cấu hình nơi lưu ảnh cá nhân! Bấm OK để vào Cài đặt nhập Link Script của bạn.")) {
            toggleMenu();
        }
        return;
    }
    
    if (!currentCustomerData) return;

    // 1. Lấy ảnh từ Database
    getEl('loader').classList.remove('hidden');
    getEl('loader-text').textContent = "Đang kiểm tra ảnh...";
    

    index.getAll(currentCustomerId).onsuccess = async (e) => {
        // Lấy ảnh hồ sơ (không có assetId)

        if (imagesToUpload.length === 0) {
            getEl('loader').classList.add('hidden');
            return alert("Không có ảnh hồ sơ nào để tải lên!");
        }

        if (!confirm(`Tải lên ${imagesToUpload.length} ảnh hồ sơ?`)) {
            getEl('loader').classList.add('hidden');
            return;
        }

        getEl('loader-text').textContent = "Đang đẩy lên Google Drive...";

        // 2. Chuẩn bị gói dữ liệu

        try {
            

            if (result.status === 'success') {
                // Lưu link Folder
                currentCustomerData.driveLink = result.url;
                db.transaction(['customers'], 'readwrite').objectStore('customers').put(currentCustomerData);
                
                getEl('loader').classList.add('hidden');
                renderDriveStatus(result.url);
                
                if(confirm("✅ Đã Upload xong!\nXóa ảnh trong App để giải phóng bộ nhớ?")) {
                    imagesToUpload.forEach(img => txDel.objectStore('images').delete(img.id));
                    txDel.oncomplete = () => {
                        loadProfileImages();
                        showToast("Đã dọn dẹp bộ nhớ");
                    };
                }
            } else {
                throw new Error(result.message);
            }
        } catch (err) {
            getEl('loader').classList.add('hidden');
            alert("Lỗi Upload: " + err.message);
        }
    };
}

// --- CẬP NHẬT REGEX V7: CHIẾN THUẬT "CHẶN ĐUÔI" (FIX LỖI DÍNH DÒNG) ---

// 6. Render Kết quả
// --- 1. Hàm kích hoạt OCR từ nút bấm trong Modal Tài Sản ---
// Removed triggerAssetOcr, runAssetOcrLogic and old viewSavedOcr as OCR has been replaced by QR scanning.
// --- HÀM XEM LẠI THÔNG TIN QR (ĐÃ NÂNG CẤP GIAO DIỆN) ---

// The new implementation of viewSavedOcr is defined later in the script.
// --- BỔ SUNG CÁC HÀM BỊ THIẾU (Dán vào cuối file script) ---




// =========================================
// QR Code Scanning Logic (Offline)
// =========================================
// --- LOGIC QUÉT QR (CODE MỚI ĐÃ SỬA: FIX ĐEN MÀN HÌNH + CAM SAU) ---

// Hàm mở Modal và bật Camera


// Biến lưu vòng lặp tự động Zoom

async function closeQrScanner() {
    
    // 1. Tắt chế độ tự động Zoom ngay lập tức
    if (autoZoomInterval) {
        clearInterval(autoZoomInterval);
        autoZoomInterval = null;
    }

    if (!html5QrCode || isQrBusy) {
        modal.classList.add('hidden');
        return;
    }
    
    isQrBusy = true; 
    try {
        if (html5QrCode.isScanning) {
            await html5QrCode.stop();
        }
    } catch (err) {
        console.warn(err);
    }
    isQrBusy = false; 
    modal.classList.add('hidden');
}

// Hàm khởi động Camera thông minh (Tự tìm Cam sau)
// --- HÀM KHỞI ĐỘNG CAMERA + TÍNH NĂNG ZOOM (PHIÊN BẢN CẬP NHẬT) ---
async function startMyScanner() {
    if (!html5QrCode) html5QrCode = new Html5Qrcode(regionId);
    if (isQrBusy) return;
    isQrBusy = true;

    try {

        if (devices && devices.length) {
            cameraId = backCam ? backCam.id : devices[devices.length - 1].id;
        } else {
            alert("Lỗi Camera!"); closeQrScanner(); return;
        }

        
        await html5QrCode.start(cameraId, config,
            (decodedText) => {
                if (navigator.vibrate) navigator.vibrate(200);
                // Tắt Zoom tự động ngay khi quét được
                if (autoZoomInterval) clearInterval(autoZoomInterval);
                
                if (qrMode === 'cccd') handleCccdResult(decodedText);
                else if (qrMode === 'redbook') handleRedBookResult(decodedText);
                closeQrScanner(); 
            }, () => {} 
        );

        // --- TÍNH NĂNG "AUTO-SWEEP ZOOM" (TỰ ĐỘNG DÒ NÉT) ---
        setTimeout(() => {
            try {

                if (zoomCap.isSupported()) {
                    // 1. Khởi động ngay ở mức 2.2x (Mức vàng cho CCCD)
                    zoomCap.apply(currentZoom);

                    // 2. Vẽ thanh hiển thị trạng thái Zoom (chỉ để nhìn, không cần kéo)
                    if (oldSlider) oldSlider.remove();

                    sliderDiv.id = 'my-zoom-slider-container';
                    sliderDiv.className = "mt-4 w-full px-4 animate-fade-in text-center";
                    sliderDiv.innerHTML = `
                        <p class="text-[10px] text-emerald-400 font-bold mb-1 uppercase tracking-widest animate-pulse">
                            <i data-lucide="scan-line" class="inline w-3 h-3"></i> Đang tự động dò nét...
                        </p>
                        <input type="range" id="zoom-slider" disabled
                               min="${zoomCap.min()}" max="${zoomCap.max()}" step="0.1" value="${currentZoom}" 
                               class="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-wait">
                    `;
                    if (modalContent) modalContent.appendChild(sliderDiv);
                    if (window.lucide) lucide.createIcons();

                    // 3. Kích hoạt vòng lặp tự động (Zoom vào từ từ... rồi zoom ra)

                    if (autoZoomInterval) clearInterval(autoZoomInterval);
                    
                    autoZoomInterval = setInterval(() => {
                        // Nếu camera đã tắt thì dừng
                        if (!html5QrCode.isScanning) { clearInterval(autoZoomInterval); return; }

                        currentZoom += (step * direction);

                        // Đảo chiều nếu chạm ngưỡng
                        if (currentZoom >= maxZ || currentZoom <= minZ) {
                            direction *= -1;
                        }

                        // Áp dụng zoom
                        zoomCap.apply(currentZoom);
                        if(sliderEl) sliderEl.value = currentZoom;
                        
                    }, 50); // Cập nhật 50ms/lần (~20 khung hình/giây)
                }
            } catch (err) { console.log("No Zoom:", err); }
        }, 500);

    } catch (err) {
        console.error(err); closeQrScanner();
    }
    isQrBusy = false;
}


// Stubbed functions to override removed OCR utilities (in case leftover calls exist)

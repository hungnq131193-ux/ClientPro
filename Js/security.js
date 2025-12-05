/**
 * SECURITY.JS
 * Quản lý mã hóa, màn hình khóa, PIN và kích hoạt bản quyền.
 * Phụ thuộc: config.js, CryptoJS
 */

// --- GLOBAL SECURITY VARIABLES ---
let masterKey = null;
let APP_BACKUP_SECRET = '';
let currentPin = '';

// --- CRYPTO HELPERS (MÃ HÓA CỐT LÕI) ---

/**
 * Tạo mã băm SHA-256 (Dùng để băm PIN)
 * @param {string} str 
 * @returns {Promise<string>} Hex string
 */
async function hashString(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Mã hóa văn bản bằng AES và masterKey
 */
function encryptText(text) {
    if (!masterKey || text === undefined || text === null) return text;
    try {
        return CryptoJS.AES.encrypt(String(text), masterKey).toString();
    } catch (e) {
        return text;
    }
}

/**
 * Giải mã văn bản bằng AES và masterKey
 */
function decryptText(cipher) {
    if (!masterKey || cipher === undefined || cipher === null) return cipher;
    try {
        const bytes = CryptoJS.AES.decrypt(String(cipher), masterKey);
        const plaintext = bytes.toString(CryptoJS.enc.Utf8);
        return plaintext || cipher;
    } catch (e) {
        return cipher;
    }
}

/**
 * Sinh Master Key ngẫu nhiên cho phiên làm việc mới
 */
function generateMasterKey() {
    return 'mk_' + Date.now() + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

/**
 * Giải mã toàn bộ đối tượng khách hàng (Tên, SĐT, Tài sản...)
 * Hàm này đặt ở đây vì liên quan trực tiếp đến logic giải mã.
 */
function decryptCustomerObject(cust) {
    if (!cust) return cust;
    cust.name = decryptText(cust.name);
    cust.phone = decryptText(cust.phone);
    cust.cccd = decryptText(cust.cccd);
    
    if (cust.assets && Array.isArray(cust.assets)) {
        cust.assets.forEach(a => {
            a.name = decryptText(a.name);
            a.link = decryptText(a.link);
            a.valuation = decryptText(a.valuation);
            a.loanValue = decryptText(a.loanValue);
            a.area = decryptText(a.area);
            a.width = decryptText(a.width);
            a.onland = decryptText(a.onland);
            a.year = decryptText(a.year);
            a.ocrData = decryptText(a.ocrData);
            a.driveLink = decryptText(a.driveLink);
        });
    }
    cust.driveLink = decryptText(cust.driveLink);
    return cust;
}

// --- SECURITY FLOW & LOGIC ---

/**
 * Kiểm tra trạng thái bảo mật khi khởi động App
 */
async function checkSecurity() {
    // 1. Kiểm tra LocalStorage
    const activated = localStorage.getItem(ACTIVATED_KEY);
    const pinEnc = localStorage.getItem(PIN_KEY);

    // Chưa kích hoạt -> Hiện modal kích hoạt
    if (!activated) {
        const modal = getEl('activation-modal');
        if (modal) modal.classList.remove('hidden');
        return; 
    }

    // Đã kích hoạt nhưng chưa có PIN -> Hiện setup PIN
    if (!pinEnc) {
        getEl('setup-lock-modal').classList.remove('hidden');
        const storedEmp = localStorage.getItem(EMPLOYEE_KEY);
        if (storedEmp) getEl('setup-answer').value = storedEmp;
    } else {
        // Đã có PIN -> Hiện màn hình khóa
        showLockScreen();
    }

    // 2. Check ngầm với Server (Background)
    try {
        const savedEmp = localStorage.getItem(EMPLOYEE_KEY) || '';
        if (savedEmp) {
            const query = `?action=check_status&employeeId=${encodeURIComponent(savedEmp)}&deviceInfo=${encodeURIComponent(navigator.userAgent)}`;
            
            const res = await fetch(ADMIN_SERVER_URL + query);
            const txt = await res.text();
            let result;
            try { result = JSON.parse(txt); } catch (e) { result = {}; }

            if (result.secret) {
                APP_BACKUP_SECRET = result.secret;
            }

            if (result.status === 'locked') {
                getEl('screen-lock').classList.add('hidden');
                getEl('setup-lock-modal').classList.add('hidden');
                const modal = getEl('activation-modal');
                modal.classList.remove('hidden');
                const titleEl = document.getElementById('activation-title');
                if (titleEl) titleEl.textContent = result.message || 'Tài khoản đã bị thu hồi!';
                localStorage.removeItem(ACTIVATED_KEY);
            }
        }
    } catch (err) {
        console.log("Offline mode: Tính năng Backup bảo mật tạm thời bị tắt.");
    }
}

// --- SETUP PIN FLOW ---

function openSecuritySetup() {
    toggleMenu(); // Hàm UI
    getEl('setup-lock-modal').classList.remove('hidden');
    getEl('setup-pin').value = '';
    getEl('setup-answer').value = '';
}

function closeSetupModal() { 
    if (localStorage.getItem(PIN_KEY)) { 
        getEl('setup-lock-modal').classList.add('hidden'); 
    } else { 
        alert("Bạn cần thiết lập bảo mật!"); 
    } 
}

async function saveSecuritySetup() {
    const pin = getEl('setup-pin').value;
    let ans = getEl('setup-answer').value.trim();
    
    if (pin.length !== 4 || isNaN(pin)) return alert("Mã PIN phải là 4 số");
    
    if (!ans) {
        const storedEmp = localStorage.getItem(EMPLOYEE_KEY);
        if (storedEmp) {
            ans = storedEmp;
            getEl('setup-answer').value = storedEmp;
        } else {
            return alert("Nhập mã nhân viên");
        }
    }
    
    localStorage.setItem(EMPLOYEE_KEY, ans);

    const hashedPin = await hashString(pin);
    const hashedAns = await hashString(ans);
    
    if (!masterKey) {
        masterKey = generateMasterKey();
    }
    
    // Mã hóa masterKey bằng PIN và Mã nhân viên
    const encByPin = CryptoJS.AES.encrypt(masterKey, hashedPin).toString();
    const encByAns = CryptoJS.AES.encrypt(masterKey, hashedAns).toString();
    
    localStorage.setItem(PIN_KEY, encByPin);
    localStorage.setItem(SEC_KEY, encByAns);
    
    getEl('setup-lock-modal').classList.add('hidden');
    showToast("Đã lưu bảo mật");
}

// --- LOCK SCREEN & PIN ENTRY ---

function showLockScreen() { 
    getEl('screen-lock').classList.remove('hidden'); 
    currentPin = ''; 
    updatePinDots(); 
}

function enterPin(num) { 
    if (currentPin.length < 4) { 
        currentPin += num; 
        updatePinDots(); 
        if (currentPin.length === 4) validatePin(); 
    } 
}

function clearPin() { 
    currentPin = ''; 
    updatePinDots(); 
}

function updatePinDots() { 
    const dots = document.querySelectorAll('.pin-dot'); 
    dots.forEach((d, i) => { 
        if (i < currentPin.length) d.classList.add('filled'); 
        else d.classList.remove('filled'); 
    }); 
}

async function validatePin() {
    const encMaster = localStorage.getItem(PIN_KEY);
    const hashedPin = await hashString(currentPin);
    let decrypted = '';
    
    try {
        const bytes = CryptoJS.AES.decrypt(String(encMaster), hashedPin);
        decrypted = bytes.toString(CryptoJS.enc.Utf8);
    } catch (e) {
        decrypted = '';
    }
    
    if (decrypted && decrypted.startsWith('mk_')) {
        masterKey = decrypted;
        getEl('screen-lock').classList.add('hidden');
        // Gọi hàm load dữ liệu (Hàm này ở database.js/app.js)
        if (typeof loadCustomers === 'function') {
            loadCustomers(getEl('search-input').value);
        }
    } else {
        setTimeout(() => {
            alert("Sai mã PIN");
            clearPin();
        }, 100);
    }
}

// --- FORGOT PIN & RECOVERY ---

function forgotPin() { getEl('forgot-pin-modal').classList.remove('hidden'); }
function closeForgotModal() { getEl('forgot-pin-modal').classList.add('hidden'); }

async function checkRecovery() {
    const input = getEl('recovery-answer').value;
    const encMaster = localStorage.getItem(SEC_KEY);
    const hashedAns = await hashString(input);
    let decrypted = '';
    
    try {
        const bytes = CryptoJS.AES.decrypt(String(encMaster), hashedAns);
        decrypted = bytes.toString(CryptoJS.enc.Utf8);
    } catch (e) {
        decrypted = '';
    }
    
    if (decrypted && decrypted.startsWith('mk_')) {
        masterKey = decrypted;
        alert("Xác thực thành công. Tạo PIN mới.");
        closeForgotModal();
        getEl('screen-lock').classList.add('hidden');
        getEl('setup-lock-modal').classList.remove('hidden');
        getEl('setup-pin').value = '';
        getEl('setup-answer').value = input;
    } else {
        alert("Mã nhân viên không khớp!");
    }
}

// --- ACTIVATION LOGIC ---

async function activateApp() {
    const keyInput = getEl('activation-key');
    const empInput = getEl('activation-employee');
    const key = keyInput ? keyInput.value.trim() : '';
    const employeeId = empInput ? empInput.value.trim() : '';
    
    if (!key || !employeeId) {
        alert("Vui lòng nhập đầy đủ Mã kích hoạt và Mã nhân viên");
        return;
    }

    const query = `?action=activate&key=${encodeURIComponent(key)}&employeeId=${encodeURIComponent(employeeId)}&deviceInfo=${encodeURIComponent(navigator.userAgent)}`;
    
    try {
        const res = await fetch(ADMIN_SERVER_URL + query);
        const txt = await res.text();
        let result;
        try { result = JSON.parse(txt); } catch (e) { result = txt; }

        if ((result && result.status && String(result.status).toLowerCase() === 'success') || String(result).toLowerCase().includes('success')) {
            
            if (result.secret) APP_BACKUP_SECRET = result.secret;
            
            const hasOldData = !!localStorage.getItem(SEC_KEY);
            
            if (!hasOldData) {
                // Máy mới
                localStorage.setItem(ACTIVATED_KEY, 'true');
                localStorage.setItem(EMPLOYEE_KEY, employeeId);
                const modal = getEl('activation-modal');
                if (modal) modal.classList.add('hidden');
                
                getEl('setup-lock-modal').classList.remove('hidden');
                getEl('setup-pin').value = '';
                getEl('setup-answer').value = employeeId;
                showToast("Kích hoạt thành công! Vui lòng tạo mã PIN.");
            } else {
                // Máy cũ (Gia hạn hoặc đổi NV)
                // Logic kiểm tra xem có đúng nhân viên cũ không
                const encMaster = localStorage.getItem(SEC_KEY);
                let decrypted = '';
                try {
                    const hashedAns = await hashString(employeeId);
                    const bytes = CryptoJS.AES.decrypt(String(encMaster), hashedAns);
                    decrypted = bytes.toString(CryptoJS.enc.Utf8);
                } catch (e) { decrypted = ''; }

                if (decrypted && decrypted.startsWith('mk_')) {
                    // Đúng nhân viên cũ
                    masterKey = decrypted;
                    localStorage.setItem(ACTIVATED_KEY, 'true');
                    localStorage.setItem(EMPLOYEE_KEY, employeeId);
                    getEl('activation-modal').classList.add('hidden');
                    
                    if (localStorage.getItem(PIN_KEY)) {
                        showToast("Gia hạn thành công!");
                        showLockScreen();
                    } else {
                        getEl('setup-lock-modal').classList.remove('hidden');
                        getEl('setup-pin').value = '';
                        getEl('setup-answer').value = employeeId;
                    }
                } else {
                    // Nhân viên khác -> Xóa dữ liệu
                    if (confirm("Phát hiện dữ liệu của nhân viên khác. Tiếp tục sẽ XÓA SẠCH dữ liệu cũ. Đồng ý không?")) {
                        localStorage.clear();
                        if (typeof resetAppData === 'function') resetAppData(); // Gọi hàm reset bên database.js
                        else {
                            // Fallback nếu chưa load database.js
                            try { indexedDB.deleteDatabase(DB_NAME); } catch(e){}
                            localStorage.setItem(ACTIVATED_KEY, 'true');
                            localStorage.setItem(EMPLOYEE_KEY, employeeId);
                            window.location.reload();
                        }
                    }
                }
            }
        } else {
            let msg = 'Kích hoạt thất bại.';
            if (result && result.message) msg = result.message;
            alert(msg);
        }
    } catch (err) {
        alert("Lỗi kết nối: " + err.message);
    }
}

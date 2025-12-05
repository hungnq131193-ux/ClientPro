// ============================================================
// SECURITY.JS - XỬ LÝ BẢO MẬT, MÃ HÓA & XÁC THỰC
// ============================================================

/**
 * Tạo mã băm SHA-256 (Dùng để băm PIN và Mã nhân viên)
 */
async function hashString(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Mã hóa văn bản bằng AES và MasterKey
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
 * Giải mã văn bản AES bằng MasterKey
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
 * Sinh khóa Master Key ngẫu nhiên
 */
function generateMasterKey() {
    return 'mk_' + Date.now() + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

/**
 * Giải mã toàn bộ đối tượng khách hàng (để hiển thị lên giao diện)
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

// ============================================================
// LOGIC MÀN HÌNH KHÓA & PIN
// ============================================================

/**
 * Kiểm tra trạng thái bảo mật khi mở App
 */
async function checkSecurity() {
    // 1. Kiểm tra Offline (Local)
    const activated = localStorage.getItem(ACTIVATED_KEY);
    const pinEnc = localStorage.getItem(PIN_KEY);

    if (!activated) {
        const modal = getEl('activation-modal');
        if (modal) modal.classList.remove('hidden');
        return;
    }

    if (!pinEnc) {
        // Đã kích hoạt nhưng chưa có PIN -> Mở form tạo PIN
        getEl('setup-lock-modal').classList.remove('hidden');
        const storedEmp = localStorage.getItem(EMPLOYEE_KEY);
        if (storedEmp) getEl('setup-answer').value = storedEmp;
    } else {
        // Đã có PIN -> Hiện màn hình khóa
        showLockScreen();
    }

    // 2. Kiểm tra Online (Background) để lấy APP_BACKUP_SECRET hoặc check khóa
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
        console.log("Offline mode: Không thể đồng bộ bảo mật với Server.");
    }
}

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
        // Mở khóa thành công
        masterKey = decrypted;
        getEl('screen-lock').classList.add('hidden');
        // Load lại dữ liệu để giải mã hiển thị
        if (window.loadCustomers) loadCustomers(getEl('search-input').value);
    } else {
        setTimeout(() => {
            alert("Sai mã PIN");
            clearPin();
        }, 100);
    }
}

// ============================================================
// THIẾT LẬP PIN & KÍCH HOẠT
// ============================================================

function openSecuritySetup() {
    toggleMenu();
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

    const encByPin = CryptoJS.AES.encrypt(masterKey, hashedPin).toString();
    const encByAns = CryptoJS.AES.encrypt(masterKey, hashedAns).toString();

    localStorage.setItem(PIN_KEY, encByPin);
    localStorage.setItem(SEC_KEY, encByAns);

    getEl('setup-lock-modal').classList.add('hidden');
    showToast("Đã lưu bảo mật");
}

async function activateApp() {
    const keyInput = getEl('activation-key');
    const empInput = getEl('activation-employee');
    const key = keyInput ? keyInput.value.trim() : '';
    const employeeId = empInput ? empInput.value.trim() : '';

    if (!key || !employeeId) return alert("Nhập đủ thông tin!");

    const query = `?action=activate&key=${encodeURIComponent(key)}&employeeId=${encodeURIComponent(employeeId)}&deviceInfo=${encodeURIComponent(navigator.userAgent)}`;
    
    try {
        const res = await fetch(ADMIN_SERVER_URL + query);
        const txt = await res.text();
        let result;
        try { result = JSON.parse(txt); } catch (e) { result = { status: 'error', message: txt }; }

        if ((result.status && result.status === 'success') || String(result).includes('success')) {
            if (result.secret) APP_BACKUP_SECRET = result.secret;
            
            const hasOldData = !!localStorage.getItem(SEC_KEY);
            
            if (!hasOldData) {
                // Máy mới
                localStorage.setItem(ACTIVATED_KEY, 'true');
                localStorage.setItem(EMPLOYEE_KEY, employeeId);
                getEl('activation-modal').classList.add('hidden');
                getEl('setup-lock-modal').classList.remove('hidden');
                getEl('setup-answer').value = employeeId;
                showToast("Kích hoạt thành công!");
            } else {
                // Máy cũ -> Kiểm tra mã nhân viên
                const encMaster = localStorage.getItem(SEC_KEY);
                const hashedAns = await hashString(employeeId);
                let decrypted = '';
                try {
                    const bytes = CryptoJS.AES.decrypt(String(encMaster), hashedAns);
                    decrypted = bytes.toString(CryptoJS.enc.Utf8);
                } catch (e) {}

                if (decrypted && decrypted.startsWith('mk_')) {
                    masterKey = decrypted;
                    localStorage.setItem(ACTIVATED_KEY, 'true');
                    getEl('activation-modal').classList.add('hidden');
                    if (localStorage.getItem(PIN_KEY)) showLockScreen();
                    else getEl('setup-lock-modal').classList.remove('hidden');
                    showToast("Gia hạn thành công!");
                } else {
                    if (confirm("Dữ liệu của nhân viên khác. XÓA SẠCH để dùng mới?")) {
                        localStorage.clear();
                        indexedDB.deleteDatabase(DB_NAME);
                        masterKey = null;
                        localStorage.setItem(ACTIVATED_KEY, 'true');
                        localStorage.setItem(EMPLOYEE_KEY, employeeId);
                        location.reload();
                    }
                }
            }
        } else {
            alert(result.message || "Kích hoạt thất bại");
        }
    } catch (err) {
        alert("Lỗi kết nối: " + err.message);
    }
}

// ============================================================
// KHÔI PHỤC PIN (FORGOT PIN)
// ============================================================

function forgotPin() {
    getEl('forgot-pin-modal').classList.remove('hidden');
}

function closeForgotModal() {
    getEl('forgot-pin-modal').classList.add('hidden');
}

async function checkRecovery() {
    const input = getEl('recovery-answer').value;
    const encMaster = localStorage.getItem(SEC_KEY);
    const hashedAns = await hashString(input);
    let decrypted = '';
    
    try {
        const bytes = CryptoJS.AES.decrypt(String(encMaster), hashedAns);
        decrypted = bytes.toString(CryptoJS.enc.Utf8);
    } catch (e) {}

    if (decrypted && decrypted.startsWith('mk_')) {
        masterKey = decrypted;
        alert("Xác thực thành công. Hãy tạo PIN mới.");
        closeForgotModal();
        getEl('screen-lock').classList.add('hidden');
        getEl('setup-lock-modal').classList.remove('hidden');
        getEl('setup-pin').value = '';
        getEl('setup-answer').value = input;
    } else {
        alert("Mã nhân viên không khớp!");
    }
}

// ============================================================
// QUẢN LÝ DỮ LIỆU & RESET
// ============================================================

function resetAppData() {
    if (confirm("CẢNH BÁO: Thao tác này sẽ XÓA SẠCH mọi dữ liệu trong máy.\n\nBạn có chắc chắn không?")) {
        localStorage.clear();
        indexedDB.deleteDatabase(DB_NAME).onsuccess = () => {
            alert("Đã reset về trạng thái ban đầu.");
            window.location.reload();
        };
    }
}

function restoreData(input) {
    toggleMenu();
    const f = input.files && input.files[0];
    if (!f) return;

    if (!APP_BACKUP_SECRET) {
        alert("Lỗi: Chưa có khóa bảo mật (Offline). Vui lòng kết nối mạng để tải khóa.");
        return;
    }

    getEl('loader').classList.remove('hidden');
    getEl('loader-text').textContent = "Đang giải mã & khôi phục...";

    const r = new FileReader();
    r.onload = async (e) => {
        try {
            const encryptedContent = e.target.result;
            let decryptedStr = '';
            
            try {
                const bytes = CryptoJS.AES.decrypt(String(encryptedContent), APP_BACKUP_SECRET);
                decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
            } catch (ex) {
                decryptedStr = '';
            }

            if (!decryptedStr) throw new Error("Sai khóa bảo mật hoặc file lỗi");

            const data = JSON.parse(decryptedStr);
            const tx = db.transaction(['customers', 'images'], 'readwrite');
            const customerStore = tx.objectStore('customers');
            const imageStore = tx.objectStore('images');

            // Helper mã hóa lại bằng masterKey hiện tại
            const enc = (txt) => (txt && String(txt).trim().length > 0) ? encryptText(txt) : '';

            (data.customers || []).forEach((c) => {
                const cust = JSON.parse(JSON.stringify(c));
                cust.name = enc(cust.name);
                cust.phone = enc(cust.phone);
                cust.cccd = enc(cust.cccd);
                
                if (cust.assets) {
                    cust.assets = cust.assets.map(a => {
                        a.name = enc(a.name);
                        a.link = enc(a.link);
                        a.valuation = enc(a.valuation);
                        a.loanValue = enc(a.loanValue);
                        a.area = enc(a.area);
                        a.width = enc(a.width);
                        a.onland = enc(a.onland);
                        a.year = enc(a.year);
                        a.ocrData = enc(a.ocrData);
                        return a;
                    });
                }
                customerStore.put(cust);
            });

            (data.images || []).forEach(i => imageStore.put(i));

            tx.oncomplete = () => {
                getEl('loader').classList.add('hidden');
                alert("Khôi phục dữ liệu thành công!");
                if (window.loadCustomers) loadCustomers();
            };
            tx.onerror = () => {
                getEl('loader').classList.add('hidden');
                alert("Lỗi khi ghi Database.");
            };

        } catch (err) {
            getEl('loader').classList.add('hidden');
            alert("Khôi phục thất bại: " + err.message);
        }
    };
    r.readAsText(f);
}

        function encryptText(text) {
            if (!masterKey || text === undefined || text === null) return text;
            try {
                return CryptoJS.AES.encrypt(String(text), masterKey).toString();
            } catch (e) {
                return text;
            }
        }
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
        function generateMasterKey() {
            return 'mk_' + Date.now() + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        }
        function decryptCustomerObject(cust) {
            if (!cust) return cust;
            cust.name = decryptText(cust.name);
            cust.phone = decryptText(cust.phone);
            // Giải mã thêm trường CCCD/CMND nếu tồn tại
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
        function openSecuritySetup() {
            // Mở giao diện thiết lập bảo mật mới. Không điền sẵn mã nhân viên vì dữ liệu trong localStorage đã được mã hóa.
            toggleMenu();
            getEl('setup-lock-modal').classList.remove('hidden');
            getEl('setup-pin').value = '';
            getEl('setup-answer').value = '';
        }
        function closeSetupModal() { if (localStorage.getItem(PIN_KEY)) { getEl('setup-lock-modal').classList.add('hidden'); } else { alert("Bạn cần thiết lập bảo mật!"); } }
        async function saveSecuritySetup() {
            const pin = getEl('setup-pin').value;
            let ans = getEl('setup-answer').value.trim();
            if (pin.length !== 4 || isNaN(pin)) return alert("Mã PIN phải là 4 số");
            // Nếu người dùng không nhập mã nhân viên, lấy từ localStorage đã lưu khi kích hoạt (nếu có)
            if (!ans) {
                const storedEmp = localStorage.getItem(EMPLOYEE_KEY);
                if (storedEmp) {
                    ans = storedEmp;
                    // hiển thị lại cho người dùng biết
                    getEl('setup-answer').value = storedEmp;
                } else {
                    return alert("Nhập mã nhân viên");
                }
            }
            // Lưu lại mã nhân viên đề phòng chưa lưu lúc kích hoạt
            localStorage.setItem(EMPLOYEE_KEY, ans);
            /*
             * Thiết lập bảo mật mới:
             *  - Sinh masterKey nếu chưa tồn tại
             *  - Băm PIN và mã nhân viên bằng SHA-256
             *  - Mã hóa masterKey bằng 2 khóa băm này và lưu vào localStorage để phục vụ mở khóa hằng ngày (PIN) và khôi phục (mã nhân viên)
             */
            const hashedPin = await hashString(pin);
            const hashedAns = await hashString(ans);
            // Nếu masterKey chưa sinh (lần đầu thiết lập), tạo mới
            if (!masterKey) {
                masterKey = generateMasterKey();
            }
            // Lưu 2 phiên bản masterKey đã mã hóa: một bằng PIN để đăng nhập hằng ngày, một bằng mã nhân viên để khôi phục
            const encByPin = CryptoJS.AES.encrypt(masterKey, hashedPin).toString();
            const encByAns = CryptoJS.AES.encrypt(masterKey, hashedAns).toString();
            localStorage.setItem(PIN_KEY, encByPin);
            localStorage.setItem(SEC_KEY, encByAns);
            // Ẩn hộp thoại và thông báo
            getEl('setup-lock-modal').classList.add('hidden');
            showToast("Đã lưu bảo mật");
        }
        function showLockScreen() { getEl('screen-lock').classList.remove('hidden'); currentPin = ''; updatePinDots(); }
        function enterPin(num) { if (currentPin.length < 4) { currentPin += num; updatePinDots(); if (currentPin.length === 4) validatePin(); } }
        function clearPin() { currentPin = ''; updatePinDots(); }
        function updatePinDots() { const dots = document.querySelectorAll('.pin-dot'); dots.forEach((d, i) => { if (i < currentPin.length) d.classList.add('filled'); else d.classList.remove('filled'); }); }
        function forgotPin() { getEl('forgot-pin-modal').classList.remove('hidden'); }
        function closeForgotModal() { getEl('forgot-pin-modal').classList.add('hidden'); }
function restoreData(input) { 
    // Đóng menu và chuẩn bị loader
    toggleMenu(); 
    const f = input.files && input.files[0]; 
    if (!f) return;
    getEl('loader').classList.remove('hidden'); 
    getEl('loader-text').textContent = "Đồng bộ...";
    const r = new FileReader(); 
    r.onload = async (e) => { 
        try { 
            const encryptedContent = e.target.result;
            // Thử giải mã nội dung file bằng khóa bí mật
            let decryptedStr = '';
            try {
                const bytes = CryptoJS.AES.decrypt(String(encryptedContent), APP_BACKUP_SECRET);
                decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
            } catch(ex) {
                decryptedStr = '';
            }
            if (!decryptedStr) throw new Error("Decryption failed");

            const data = JSON.parse(decryptedStr);
            // Chuẩn bị ghi dữ liệu vào IndexedDB
            const tx = db.transaction(['customers', 'images'], 'readwrite');
            const customerStore = tx.objectStore('customers');
            const imageStore = tx.objectStore('images');

                       // --- SỬA LỖI: Hàm helper chỉ mã hóa khi có dữ liệu ---
            const enc = (txt) => (txt && String(txt).trim().length > 0) ? encryptText(txt) : '';

            // Ghi từng khách hàng, mã hóa lại các trường bằng masterKey hiện tại
            (data.customers || []).forEach((c) => {
                const cust = JSON.parse(JSON.stringify(c));
                
                // Sử dụng hàm enc thay vì encryptText trực tiếp
                cust.name = enc(cust.name);
                cust.phone = enc(cust.phone);
                cust.cccd = enc(cust.cccd);
                
                // Nếu có tài sản thì mã hóa từng trường của tài sản
                if (cust.assets && Array.isArray(cust.assets)) {
                    cust.assets = cust.assets.map((a) => {
                        const asset = JSON.parse(JSON.stringify(a));
                        
                        // Áp dụng enc cho toàn bộ các trường tài sản
                        asset.name = enc(asset.name);
                        asset.link = enc(asset.link);
                        asset.valuation = enc(asset.valuation);
                        asset.loanValue = enc(asset.loanValue);
                        asset.area = enc(asset.area);
                        asset.width = enc(asset.width);
                        asset.onland = enc(asset.onland);
                        asset.year = enc(asset.year);
                        asset.ocrData = enc(asset.ocrData);
                        
                        // Giữ driveLink theo dữ liệu backup (có thể null)
                        return asset;
                    });
                }
                customerStore.put(cust);
            });

            // Ghi ảnh nếu có trong backup (images thường trống)
            (data.images || []).forEach(i => imageStore.put(i));

            tx.oncomplete = () => { 
                getEl('loader').classList.add('hidden'); 
                alert("Đã khôi phục"); 
                loadCustomers(); 
            };
            tx.onerror = () => {
                getEl('loader').classList.add('hidden');
                alert("Lỗi khi ghi vào cơ sở dữ liệu");
            };
        } catch(err) { 
            getEl('loader').classList.add('hidden'); 
            alert("File backup không hợp lệ hoặc sai định dạng bảo mật"); 
        } 
    }; 
    r.readAsText(f); 
}
        function resetAppData() { if(confirm("XÓA SẠCH dữ liệu?")) { localStorage.clear(); indexedDB.deleteDatabase(DB_NAME).onsuccess = () => { alert("Đã reset."); window.location.reload(); }; } }
        // =============== DONATE FEATURE ===============
    // --- LOGIC UPLOAD DRIVE & CẤU HÌNH ---

function toggleDashboardDriveConfig() {
    const panel = getEl('dashboard-drive-config');
    const input = getEl('dashboard-drive-url') || getEl('user-script-url');
    if (!panel) {
        if (input) input.focus();
        return;
    }
    const willOpen = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !willOpen);
    panel.setAttribute('aria-hidden', willOpen ? 'false' : 'true');
    if (willOpen) {
        // Prefill token tại thời điểm mở panel (app đã mở khóa nên đọc được token niêm phong).
        const tokenInput = getEl('dashboard-drive-token');
        if (tokenInput && !tokenInput.value) {
            const savedToken = getUserToken();
            if (savedToken) tokenInput.value = savedToken;
        }
        if (input) setTimeout(() => input.focus(), 80);
    }
}
// Mã bảo mật (Access Token) cho Script Drive cá nhân (UserAPI).
// Server UserAPI bắt buộc token; app gửi kèm mỗi request (trong body, KHÔNG qua query URL).
//
// BẢO MẬT: token được "niêm phong" trong localStorage bằng masterKey (AES qua
// encryptText/decryptText của 02_security.js) dưới dạng:
//     'sealed.v1:' + <ciphertext>
// - Chưa mở khóa app (chưa có masterKey) -> getUserToken() trả '' (server sẽ từ chối,
//   không lộ token khi localStorage bị đọc trộm qua XSS lúc app còn khóa).
// - Token cũ dạng plaintext: tự niêm phong lại ở lần đọc đầu tiên sau khi mở khóa
//   (lazy migration, không bắt user nhập lại).
const USER_TOKEN_SEALED_PREFIX = 'sealed.v1:';

function _userTokenStorageKey() {
    return (typeof USER_TOKEN_KEY !== 'undefined') ? USER_TOKEN_KEY : 'app_user_script_token';
}

function _hasMasterKeyForToken() {
    return typeof masterKey !== 'undefined' && !!masterKey;
}

/** Niêm phong token bằng masterKey (ASYNC — AES-GCM). Không có masterKey thì trả plaintext như cũ. */
async function sealUserToken(token) {
    const t = String(token || '').trim();
    if (!t || !_hasMasterKeyForToken() || typeof encryptText !== 'function') return t;
    try {
        const ct = await encryptText(t);
        // encryptText trả lại nguyên bản khi mã hóa thất bại -> chỉ dán prefix khi thực sự đổi.
        if (typeof ct === 'string' && ct && ct !== t) return USER_TOKEN_SEALED_PREFIX + ct;
    } catch (e) { }
    return t;
}

function getUserToken() {
    const key = _userTokenStorageKey();
    const raw = (localStorage.getItem(key) || '').trim();
    if (!raw) return '';

    if (raw.startsWith(USER_TOKEN_SEALED_PREFIX)) {
        if (!_hasMasterKeyForToken() || typeof decryptText !== 'function') return '';
        const ct = raw.slice(USER_TOKEN_SEALED_PREFIX.length);
        try {
            const pt = decryptText(ct);
            // decryptText trả lại input khi giải mã thất bại (sai khóa) -> coi như không có token.
            if (typeof pt === 'string' && pt && pt !== ct) return pt.trim();
        } catch (e) { }
        return '';
    }

    // Token cũ dạng plaintext: niêm phong lại NỀN (không chặn trả về) khi masterKey sẵn sàng.
    // sealUserToken nay async (AES-GCM) nên chạy fire-and-forget, vẫn trả plaintext ngay.
    if (_hasMasterKeyForToken()) {
        (async () => {
            try {
                const sealed = await sealUserToken(raw);
                if (sealed !== raw) localStorage.setItem(key, sealed);
            } catch (e) { }
        })();
    }
    return raw;
}

async function saveScriptUrl() {
    const input = getEl('dashboard-drive-url') || getEl('user-script-url');
    const url = input ? input.value.trim() : '';
    if (!url.startsWith('https://script.google.com/')) {
        ErrorHandler.showError('VALIDATION', "Link Script không đúng định dạng. Link phải bắt đầu bằng https://script.google.com/");
        return;
    }
    const tokenInput = getEl('dashboard-drive-token');
    const token = tokenInput ? tokenInput.value.trim() : getUserToken();
    if (!token) {
        ErrorHandler.showWarning("Vui lòng nhập Mã bảo mật (Access Token) của Script cá nhân!");
        if (tokenInput) tokenInput.focus();
        return;
    }
    // Lưu link Script cá nhân và token (niêm phong AES-GCM bằng masterKey nếu app đã mở khóa)
    localStorage.setItem(USER_SCRIPT_KEY, url);
    localStorage.setItem(_userTokenStorageKey(), await sealUserToken(token));
    ErrorHandler.showSuccess("Đã lưu kết nối Drive cá nhân");
}
document.addEventListener('DOMContentLoaded', () => {
    const savedUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if(savedUrl) {
        const input = getEl('dashboard-drive-url') || getEl('user-script-url');
        if (input) input.value = savedUrl;
    }
    // KHÔNG prefill token ở đây: lúc DOMContentLoaded app còn khóa (masterKey chưa có)
    // nên token niêm phong chưa đọc được. Prefill khi mở panel (toggleDashboardDriveConfig).
});

// =============================
// Helpers (decrypt display fields, keep backward compatibility)
// =============================
// Tên hàm giữ nguyên ("CryptoJS") để tránh đổi diện rộng, nhưng nay nhận diện CẢ 2 dạng
// ciphertext: legacy CryptoJS ("U2FsdGVkX1...") và AES-GCM mới ("cpg1:..."). Trước đây chỉ
// check tiền tố legacy -> field asset.name/driveLink đã migrate sang "cpg1:" bị coi nhầm là
// plaintext, khiến chuỗi mã hóa lọt vào folderName Drive / hiển thị UI (xem _looksEncrypted
// trong 05_customers.js, cùng bug với renderAssets() ở 06_assets.js).
function _isCryptoJSCiphertext(s) {
    if (typeof _looksEncrypted === 'function') return _looksEncrypted(s);
    return typeof s === 'string' && (s.startsWith('U2FsdGVkX1') || s.startsWith('cpg1:'));
}

function _safeDecryptMaybe(s) {
    if (s == null) return '';
    const str = String(s);
    try {
        if (typeof decryptText === 'function') {
            const out = decryptText(str);
            // decryptText() fail-open: cache-miss trả nguyên ciphertext — từ chối nếu vẫn mã hóa.
            if (typeof out === 'string' && out.length > 0 && !_isCryptoJSCiphertext(out)) return out;
        }
    } catch (e) {}
    // Nếu đầu vào đã là plaintext (không phải ciphertext) thì trả nguyên.
    if (!_isCryptoJSCiphertext(str)) return str;
    return '';
}

function _displayText(s) {
    if (typeof _displayPlain === 'function') return _displayPlain(s, '');
    const out = _safeDecryptMaybe(s);
    return (out && out !== 'undefined' && out !== 'null') ? out : '';
}

function _normalizeDriveUrl(url) {
    if (!url) return '';
    const str = String(url);
    if (_isCryptoJSCiphertext(str)) {
        // Old data sometimes stored encrypted driveLink. Only render if we can decrypt to a real URL.
        const dec = _safeDecryptMaybe(str);
        if (dec && ! _isCryptoJSCiphertext(dec) && /^https?:\/\//i.test(dec)) return dec;
        return '';
    }
    return str;
}

// Legacy duplicate uploadToGoogleDrive implementation removed; canonical function is defined once below.

// 3. Hàm hiển thị nút mở Drive
function renderDriveStatus(url) {
    const area = getEl('drive-status-area');
    const btnUp = getEl('btn-upload-drive');
    
    if (!area) return;
    
    const safeUrl = _normalizeDriveUrl(url).trim();
    const hasSafeDriveUrl = typeof isSafeDriveUrl === 'function' && isSafeDriveUrl(safeUrl);
    const safeHref = hasSafeDriveUrl ? escapeHTML(safeUrl) : '';
    if (hasSafeDriveUrl) {
        // ĐÃ CÓ LINK → hiện nút Mở Drive
        area.classList.remove('hidden');
        area.innerHTML = `
      <a href="${safeHref}" target="_blank" rel="noopener noreferrer"
         class="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold
                flex items-center justify-center gap-2 shadow-lg mb-1
                animate-fade-in border border-emerald-400/30">
        <i data-lucide="external-link" class="w-5 h-5"></i> Mở Folder Ảnh
      </a>
      <p class="text-[10px] text-center text-emerald-400/70 italic mb-2">
        Đã sao lưu ảnh thành công
      </p>
    `;
        
        if (btnUp) btnUp.classList.remove('hidden'); // vẫn cho phép upload thêm
    } else {
        // CHƯA CÓ LINK → hiện nút tìm lại + nút upload
        area.classList.remove('hidden');
        area.innerHTML = `
      <button data-action="reconnectDriveFolder"
              class="w-full py-2 mb-2 bg-slate-700/50 border border-slate-600
                     rounded-lg text-xs font-medium text-slate-300
                     flex items-center justify-center gap-2 hover:bg-slate-700 transition">
        <i data-lucide="search" class="w-4 h-4"></i> Tìm kết nối cũ
      </button>
    `;
        if (btnUp) btnUp.classList.remove('hidden');
    }
    
    if (window.lucide) lucide.createIcons();
}

// --- LOGIC UPLOAD DRIVE CHO TÀI SẢN (TSBĐ) ---

async function uploadAssetToDrive() {
    // Lấy link Script cá nhân
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if (!userUrl || userUrl.length < 10) {
        if (await ErrorHandler.confirm("Bạn chưa cấu hình nơi lưu ảnh cá nhân! Bấm 'Vào Cài đặt' để nhập Link Script của bạn.", { title: "Chưa cấu hình Drive", confirmText: "Vào Cài đặt" })) {
            toggleMenu();
        }
        return;
    }
    const scriptUrl = userUrl;

    if (!currentCustomerData || !currentAssetId) return;

    // Tìm xem đang thao tác với Tài sản nào trong mảng assets
    const assetIndex = currentCustomerData.assets.findIndex(a => a.id === currentAssetId);
    if (assetIndex === -1) return;
    const currentAsset = currentCustomerData.assets[assetIndex];

    LoadingManager.showGlobal("Đang lấy ảnh TSBĐ...");

    const tx = db.transaction(['images'], 'readonly');
    const store = tx.objectStore('images');
    const index = store.index('customerId'); // Lấy tất cả ảnh của khách này trước

    index.getAll(currentCustomerId).onsuccess = async (e) => {
        let allImages = e.target.result || [];
        
        // LỌC QUAN TRỌNG: Chỉ lấy ảnh có assetId TRÙNG VỚI assetId hiện tại
        let imagesToUpload = allImages.filter(img => img.assetId === currentAssetId);

        if (imagesToUpload.length === 0) {
            LoadingManager.hideGlobal(true);
            ErrorHandler.showWarning("Tài sản này chưa có ảnh nào!");
            return;
        }

        const assetNamePlain = _displayText(currentAsset.name);
        if (!(await ErrorHandler.confirm(`Tải lên ${imagesToUpload.length} ảnh của tài sản "${assetNamePlain}" lên Drive?`, { title: "Tải ảnh lên Drive", confirmText: "Tải lên" }))) {
            LoadingManager.hideGlobal(true);
            return;
        }

        LoadingManager.showGlobal("Đang Upload TSBĐ...");

        // Đặt tên Folder: [Tên Khách] - [Tên Tài Sản]
        // Ví dụ: Nguyen Van A - Nhà Đất 50m2
        const custNamePlain = _displayText(currentCustomerData.name);
        const folderName = `${custNamePlain} - TSBĐ: ${assetNamePlain}`;

        const resolvedImages = await Promise.all(imagesToUpload.map(async (img, idx) => ({
            name: `asset_img_${Date.now()}_${idx}.jpg`,
            data: (typeof decryptImageData === 'function') ? await decryptImageData(img.data) : img.data,
        })));

        const payload = {
            token: getUserToken(),
            folderName: folderName,
            images: resolvedImages,
        };

        try {
            const response = await fetch(scriptUrl, {
                method: "POST",
                body: JSON.stringify(payload)
            });
            
            const result = await response.json();

            if (result.status === 'success') {
                // 1. Lưu Link vào đúng đối tượng Asset
                currentCustomerData.assets[assetIndex].driveLink = result.url;

                // 2. Cập nhật Database (không put() nguyên currentCustomerData vì
                //    name/phone/cccd trên object đó đã bị giải mã trong openFolder).
                //    Await kết quả ghi: KHÔNG báo thành công / hỏi xóa ảnh gốc khi ghi
                //    link thất bại (mirror pattern _doSaveAsset ở 06_assets.js).
                const ok = await new Promise((resolve) => {
                    persistCurrentCustomer((rec) => { rec.assets = currentCustomerData.assets; }, resolve);
                });

                LoadingManager.hideGlobal(true);

                if (!ok) {
                    ErrorHandler.showWarning('Ảnh đã lên Drive nhưng CHƯA lưu được link vào hồ sơ. Hãy dùng "Tìm lại link" sau.');
                    return;
                }

                // 3. Cập nhật giao diện
                renderAssetDriveStatus(result.url);
                ErrorHandler.showSuccess("Đã tải ảnh TSBĐ lên Drive");

                // 4. Hỏi xóa ảnh
                if (await ErrorHandler.confirm("TSBĐ đã lên mây thành công!\n\nXóa ảnh gốc trong máy để nhẹ bộ nhớ?", { title: "Dọn dẹp bộ nhớ", confirmText: "Xóa ảnh gốc" })) {
                    const txDel = db.transaction(['images'], 'readwrite');
                    imagesToUpload.forEach(img => txDel.objectStore('images').delete(img.id));
                    txDel.oncomplete = () => {
                        loadAssetImages(currentAssetId); // Load lại lưới ảnh (trống)
                        ErrorHandler.showSuccess("Đã dọn dẹp ảnh TSBĐ");
                    };
                }
            } else {
                throw new Error(result.message);
            }

        } catch (err) {
            LoadingManager.hideGlobal(true);
            ErrorHandler.showError('BACKUP', "Tải ảnh lên Drive thất bại. Vui lòng kiểm tra kết nối và Script cá nhân.", err);
        }
    };
}

// 1. Cập nhật giao diện: Thêm nút Tìm kết nối cũ
function renderAssetDriveStatus(url) {
    const area = getEl('asset-drive-status-area');
    const btnUp = getEl('btn-asset-upload');
    if (!area) return;
    area.classList.remove('hidden');

    const safeUrl = _normalizeDriveUrl(url).trim();
    const hasSafeDriveUrl = typeof isSafeDriveUrl === 'function' && isSafeDriveUrl(safeUrl);
    const safeHref = hasSafeDriveUrl ? escapeHTML(safeUrl) : '';
    if (hasSafeDriveUrl) {
        // Đã có link -> Hiện nút mở
        area.innerHTML = `
            <a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="w-full py-3 bg-teal-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg mb-1 animate-fade-in border border-teal-400/30">
                <i data-lucide="external-link" class="w-5 h-5"></i> Xem Folder TSBĐ
            </a>`;
        if (btnUp) btnUp.classList.remove('hidden');
    } else {
        // Chưa có link -> Hiện nút TÌM LẠI
        area.innerHTML = `
            <button data-action="reconnectAssetDriveFolder" class="w-full py-2 mb-2 bg-slate-700/50 border border-slate-600 rounded-lg text-xs font-medium text-slate-300 flex items-center justify-center gap-2 hover:bg-slate-700 transition">
                <i data-lucide="search" class="w-4 h-4"></i> Tìm kết nối cũ
            </button>`;
        if (btnUp) btnUp.classList.remove('hidden');
    }
    if(window.lucide) lucide.createIcons();
}

// 2. Logic tìm kiếm (Sử dụng Script cá nhân USER_SCRIPT_KEY)
async function reconnectAssetDriveFolder() {
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if (!userUrl || userUrl.length < 10) {
        if (await ErrorHandler.confirm("Bạn chưa cấu hình nơi lưu ảnh cá nhân! Bấm 'Vào Cài đặt' để nhập Link Script của bạn.", { title: "Chưa cấu hình Drive", confirmText: "Vào Cài đặt" })) toggleMenu();
        return;
    }

    if (!currentCustomerData || !currentAssetId) return;
    const assetIndex = currentCustomerData.assets.findIndex(a => a.id === currentAssetId);
    if (assetIndex === -1) return;

    LoadingManager.showGlobal("Đang tìm TSBĐ...");
    
    // IMPORTANT:
    // Nhiều build dùng decryptCustomerSummary() để tăng hiệu năng danh sách khách hàng.
    // Hàm này cố tình KHÔNG giải mã assets => asset.name có thể vẫn là ciphertext (U2FsdGVk...).
    // Vì vậy, khi "Tìm kết nối cũ" phải lấy tên TSBĐ theo nguồn UI (đã hiển thị plaintext)
    // hoặc giải mã best-effort, thay vì dùng trực tiếp asset.name trong bộ nhớ.
    const custNamePlain = _displayText(currentCustomerData.name);

    let assetNamePlain = '';
    // 1) Ưu tiên lấy từ UI gallery (đã decrypt để hiển thị)
    try {
        const uiName = (getEl && getEl('gallery-asset-name') ? getEl('gallery-asset-name').textContent : '') || '';
        const uiTrim = String(uiName).trim();
        if (uiTrim && !_isCryptoJSCiphertext(uiTrim)) assetNamePlain = uiTrim;
    } catch (e) {}
    // 2) Fallback: decrypt từ data hiện tại
    if (!assetNamePlain) assetNamePlain = _displayText(currentCustomerData.assets[assetIndex].name);
    // 3) Nếu vẫn là ciphertext thì không dựng folderName sai; báo rõ để tránh tìm sai.
    if (!assetNamePlain || _isCryptoJSCiphertext(assetNamePlain)) {
        LoadingManager.hideGlobal(true);
        ErrorHandler.showWarning('Không thể đọc tên TSBĐ (dữ liệu cũ đang mã hóa). Vui lòng mở Kho Ảnh TSBĐ để app tự giải mã tên, rồi thử lại.');
        return;
    }

    const folderName = `${custNamePlain} - TSBĐ: ${assetNamePlain}`;

    // Auto-migrate: nếu asset.name đang là ciphertext nhưng UI đã có plaintext, lưu ngược lại DB để lần sau ổn định.
    try {
        const rawName = currentCustomerData.assets[assetIndex].name;
        if (_isCryptoJSCiphertext(String(rawName)) && assetNamePlain) {
            const txM = db.transaction(['customers'], 'readwrite');
            const stM = txM.objectStore('customers');
            stM.get(currentCustomerData.id).onsuccess = (e) => {
                const rec = e.target.result;
                if (rec && rec.assets && rec.assets[assetIndex]) {
                    rec.assets[assetIndex].name = assetNamePlain;
                    stM.put(rec);
                }
            };
            // Auto-migrate phụ: lỗi ghi không cần chặn flow, nhưng không được nuốt im lặng.
            txM.onerror = (e) => {
                ErrorHandler.logError('reconnectAssetDriveFolder: auto-migrate asset name failed', e);
            };
        }
    } catch (e) {}

    try {
        const response = await fetch(userUrl, {
            method: "POST",
            body: JSON.stringify({ action: 'search', folderName: folderName, token: getUserToken() })
        });
        const result = await response.json();

        if (result.status === 'found') {
            // Store as plaintext going forward (older records may be encrypted; rendering handles both).
            const plainUrl = result.url;
            
            const tx = db.transaction(['customers'], 'readwrite');
            const store = tx.objectStore('customers');
            store.get(currentCustomerData.id).onsuccess = (e) => {
                let dbRecord = e.target.result;
                if (dbRecord && dbRecord.assets && dbRecord.assets[assetIndex]) {
                    dbRecord.assets[assetIndex].driveLink = plainUrl;
                    store.put(dbRecord);
                }
            };
            tx.oncomplete = () => {
                currentCustomerData.assets[assetIndex].driveLink = plainUrl; // Cập nhật hiển thị
                LoadingManager.hideGlobal(true);
                renderAssetDriveStatus(plainUrl);
                ErrorHandler.showSuccess("Đã kết nối lại folder TSBĐ!");
            };
            // Transaction lỗi: phải tắt loading (nếu không overlay treo vĩnh viễn) + báo lỗi.
            tx.onerror = (e) => {
                LoadingManager.hideGlobal(true);
                ErrorHandler.showError('STORAGE', 'Tìm thấy folder nhưng CHƯA lưu được link vào hồ sơ. Vui lòng thử lại.', e);
            };
        } else {
            LoadingManager.hideGlobal(true);
            ErrorHandler.showWarning("Không tìm thấy folder: " + folderName);
        }
    } catch (err) {
        LoadingManager.hideGlobal(true);
        ErrorHandler.showError('NETWORK', "Không kết nối được tới Script cá nhân. Vui lòng thử lại.", err);
    }
}
// --- TÍNH NĂNG TÌM LẠI FOLDER THẤT LẠC ---
async function reconnectDriveFolder() {
    // Lấy link Script cá nhân; nếu chưa cấu hình thì nhắc người dùng cài đặt
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if (!userUrl || userUrl.length < 10) {
        if (await ErrorHandler.confirm("Chưa cấu hình Script! Vào cài đặt ngay?", { title: "Chưa cấu hình Drive", confirmText: "Vào Cài đặt" })) toggleMenu();
        return;
    }
    // Không có dữ liệu khách hàng hiện tại thì dừng
    if (!currentCustomerData) return;

    // Hiển thị loader và cập nhật thông báo
    LoadingManager.showGlobal("Đang tìm trên Drive...");

    // Lấy thông tin tên, SĐT và CCCD sau khi giải mã (hàm decryptText sẽ trả lại nguyên bản nếu đầu vào đã giải mã)
    const name = _displayText(currentCustomerData.name);
    const phone = _displayText(currentCustomerData.phone);
    const cccd = _displayText(currentCustomerData.cccd);

    // Tạo danh sách tên thư mục có thể có: ưu tiên theo CCCD trước, sau đó là SĐT
    const possibleNames = [];
    if (cccd) possibleNames.push(`${name} - ${cccd}`);
    if (phone) possibleNames.push(`${name} - ${phone}`);

    let foundUrl = null;

    // Thử tìm lần lượt các tên trong danh sách
    for (const folderName of possibleNames) {
        try {
            getEl('loader-text').textContent = `Đang tìm: ${folderName}...`;
            const response = await fetch(userUrl, {
                method: "POST",
                body: JSON.stringify({ action: 'search', folderName: folderName, token: getUserToken() })
            });
            const result = await response.json();
            if (result.status === 'found') {
                foundUrl = result.url;
                break;
            }
        } catch (e) {
            ErrorHandler.logError("reconnectDriveFolder: lỗi tìm kiếm", e);
        }
    }

    // Nếu tìm thấy thì lưu và cập nhật giao diện, ngược lại báo lỗi
    if (foundUrl) {
        currentCustomerData.driveLink = foundUrl;
        persistCurrentCustomer((rec) => { rec.driveLink = foundUrl; }, (ok) => {
            LoadingManager.hideGlobal(true);
            if (!ok) {
                currentCustomerData.driveLink = null;
                ErrorHandler.showError('STORAGE', 'Tìm thấy link nhưng lưu vào hồ sơ thất bại. Vui lòng thử lại.');
                return;
            }
            renderDriveStatus(foundUrl);
            ErrorHandler.showSuccess("Đã kết nối lại thành công!");
        });
    } else {
        LoadingManager.hideGlobal(true);
        ErrorHandler.showWarning("Không tìm thấy folder nào khớp với Tên + CCCD hoặc Tên + SĐT.");
    }
}

// Legacy upload variants removed; canonical uploadToGoogleDrive is below.

// --- LOGIC UPLOAD ẢNH HỒ SƠ ---
async function uploadToGoogleDrive() {
    // Lấy link Script cá nhân cho upload tài sản
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if (!userUrl || userUrl.length < 10) {
        if (await ErrorHandler.confirm("Bạn chưa cấu hình nơi lưu ảnh cá nhân! Bấm 'Vào Cài đặt' để nhập Link Script của bạn.", { title: "Chưa cấu hình Drive", confirmText: "Vào Cài đặt" })) {
            toggleMenu();
        }
        return;
    }
    const scriptUrl = userUrl;

    if (!currentCustomerData) return;

    // 1. Lấy ảnh từ Database
    LoadingManager.showGlobal("Đang kiểm tra ảnh...");
    
    const tx = db.transaction(['images'], 'readonly');
    const store = tx.objectStore('images');
    const index = store.index('customerId');

    index.getAll(currentCustomerId).onsuccess = async (e) => {
        let allImages = e.target.result || [];
        // Lấy ảnh hồ sơ (không có assetId)
        let imagesToUpload = allImages.filter(img => !img.assetId);

        if (imagesToUpload.length === 0) {
            LoadingManager.hideGlobal(true);
            ErrorHandler.showWarning("Không có ảnh hồ sơ nào để tải lên!");
            return;
        }

        if (!(await ErrorHandler.confirm(`Tải lên ${imagesToUpload.length} ảnh hồ sơ?`, { title: "Tải ảnh lên Drive", confirmText: "Tải lên" }))) {
            LoadingManager.hideGlobal(true);
            return;
        }

        LoadingManager.showGlobal("Đang sao lưu ảnh lên Google Drive...");

        const resolvedImages = await Promise.all(imagesToUpload.map(async (img, idx) => ({
            name: `hoso_${Date.now()}_${idx}.jpg`,
            data: (typeof decryptImageData === 'function') ? await decryptImageData(img.data) : img.data,
        })));

        // 2. Chuẩn bị gói dữ liệu
        const payload = {
            action: 'upload', // <--- Báo cho Script biết là muốn Upload
            token: getUserToken(),
            // Ưu tiên đặt tên folder theo CCCD, fallback sang SĐT nếu chưa có CCCD
            folderName: `${_displayText(currentCustomerData.name)} - ${_displayText(currentCustomerData.cccd) || _displayText(currentCustomerData.phone)}`,
            images: resolvedImages,
        };

        try {
            const response = await fetch(scriptUrl, {
                method: "POST",
                body: JSON.stringify(payload)
            });
            
            const result = await response.json();

            if (result.status === 'success') {
                // Lưu link Folder (ghi an toàn, giữ nguyên ciphertext các trường khác).
                // Await kết quả ghi: KHÔNG báo thành công / hỏi xóa ảnh gốc khi ghi
                // link thất bại (mirror pattern _doSaveAsset ở 06_assets.js).
                currentCustomerData.driveLink = result.url;
                const ok = await new Promise((resolve) => {
                    persistCurrentCustomer((rec) => { rec.driveLink = result.url; }, resolve);
                });

                LoadingManager.hideGlobal(true);

                if (!ok) {
                    ErrorHandler.showWarning('Ảnh đã lên Drive nhưng CHƯA lưu được link vào hồ sơ. Hãy dùng "Tìm lại link" sau.');
                    return;
                }

                renderDriveStatus(result.url);
                ErrorHandler.showSuccess("Đã sao lưu ảnh hồ sơ lên Drive");

                if (await ErrorHandler.confirm("Đã sao lưu ảnh thành công!\nXóa ảnh trong App để giải phóng bộ nhớ?", { title: "Dọn dẹp bộ nhớ", confirmText: "Xóa ảnh gốc" })) {
                    const txDel = db.transaction(['images'], 'readwrite');
                    imagesToUpload.forEach(img => txDel.objectStore('images').delete(img.id));
                    txDel.oncomplete = () => {
                        loadProfileImages();
                        ErrorHandler.showSuccess("Đã dọn dẹp bộ nhớ");
                    };
                }
            } else {
                throw new Error(result.message);
            }
        } catch (err) {
            LoadingManager.hideGlobal(true);
            ErrorHandler.showError('BACKUP', "Tải ảnh lên Drive thất bại. Vui lòng kiểm tra kết nối và Script cá nhân.", err);
        }
    };
}

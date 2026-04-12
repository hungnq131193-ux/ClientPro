    // --- LOGIC UPLOAD DRIVE & CẤU HÌNH ---
function saveScriptUrl() {
    const url = getEl('user-script-url').value.trim();
    if (!url.startsWith('https://script.google.com/')) {
        alert("Link không đúng định dạng!");
        return;
    }
    // Lưu link Script cá nhân vào localStorage với key mới
    localStorage.setItem(USER_SCRIPT_KEY, url);
    showToast("Đã lưu kết nối Drive cá nhân");
}
document.addEventListener('DOMContentLoaded', () => {
    const savedUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if(savedUrl) getEl('user-script-url').value = savedUrl;
});

// =============================
// Helpers (decrypt display fields, keep backward compatibility)
// =============================
function _isCryptoJSCiphertext(s) {
    return typeof s === 'string' && s.startsWith('U2FsdGVkX1');
}

function _safeDecryptMaybe(s) {
    if (s == null) return '';
    const str = String(s);
    try {
        if (typeof decryptText === 'function') {
            const out = decryptText(str);
            // decryptText() in this app usually returns the input when it cannot decrypt.
            // Only accept a decrypted value if it is a non-empty string.
            if (typeof out === 'string' && out.length > 0) return out;
        }
    } catch (e) {}
    return str;
}

function _displayText(s) {
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

// 2. Hàm Upload chính
async function uploadToGoogleDrive() {
    // Dùng Script cá nhân cho việc upload ảnh hồ sơ. Kiểm tra xem user đã cấu hình link hay chưa.
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if (!userUrl || userUrl.length < 10) {
        if (confirm("Bạn chưa cấu hình nơi lưu ảnh cá nhân! Bấm OK để vào Cài đặt nhập Link Script của bạn.")) {
            toggleMenu();
        }
        return;
    }
    const scriptUrl = userUrl;
    
    if (!currentCustomerData) return;

    // Lấy ảnh từ Database
    getEl('loader').classList.remove('hidden');
    getEl('loader-text').textContent = "Đang kiểm tra ảnh...";
    
    const tx = db.transaction(['images'], 'readonly');
    const store = tx.objectStore('images');
    const index = store.index('customerId');

    index.getAll(currentCustomerId).onsuccess = async (e) => {
        let allImages = e.target.result || [];
        // Lọc: Chỉ lấy ảnh chưa được gắn vào Asset (ảnh hồ sơ)
        let imagesToUpload = allImages.filter(img => !img.assetId);

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
        const payload = {
            // Ưu tiên đặt tên folder theo CCCD, fallback sang SĐT nếu chưa có CCCD
            // NOTE: customer fields are stored encrypted at-rest in many builds, so decrypt for folder naming.
            folderName: `${_displayText(currentCustomerData.name)} - ${_displayText(currentCustomerData.cccd) || _displayText(currentCustomerData.phone)}`,
            images: imagesToUpload.map((img, idx) => ({
                name: `img_${Date.now()}_${idx}.jpg`,
                data: img.data
            }))
        };

        try {
            // Gửi request (no-cors để tránh lỗi trình duyệt chặn, nhưng script google phải set JSONP hoặc text)
            // Lưu ý: Fetch POST tới Google Script đôi khi cần xử lý kỹ.
            // Dùng cách gửi tiêu chuẩn:
            const response = await fetch(scriptUrl, {
                method: "POST",
                body: JSON.stringify(payload)
            });
            
            const result = await response.json();

            if (result.status === 'success') {
                // Lưu link và dọn dẹp
                currentCustomerData.driveLink = result.url;
                db.transaction(['customers'], 'readwrite').objectStore('customers').put(currentCustomerData);
                
                getEl('loader').classList.add('hidden');
                renderDriveStatus(result.url); // Hiển thị nút mở Drive
                
                // Hỏi xóa ảnh gốc
                if(confirm("✅ UPLOAD THÀNH CÔNG!\n\nXóa ảnh trong App để giải phóng bộ nhớ?")) {
                    const txDel = db.transaction(['images'], 'readwrite');
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
function renderDriveStatus(url) {
    const area = getEl('drive-status-area');
    const btnUp = getEl('btn-upload-drive');
    
    if (!area) return;
    
    const safeUrl = _normalizeDriveUrl(url);
    if (safeUrl && safeUrl.length > 5) {
        // ĐÃ CÓ LINK → hiện nút Mở Drive
        area.classList.remove('hidden');
        area.innerHTML = `
      <a href="${safeUrl}" target="_blank"
         class="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold
                flex items-center justify-center gap-2 shadow-lg mb-1
                animate-fade-in border border-emerald-400/30">
        <i data-lucide="external-link" class="w-5 h-5"></i> Mở Folder Ảnh
      </a>
      <p class="text-[10px] text-center text-emerald-400/70 italic mb-2">
        Đã đồng bộ lên Cloud
      </p>
    `;
        
        if (btnUp) btnUp.classList.remove('hidden'); // vẫn cho phép upload thêm
    } else {
        // CHƯA CÓ LINK → hiện nút tìm lại + nút upload
        area.classList.remove('hidden');
        area.innerHTML = `
      <button onclick="reconnectDriveFolder()"
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
        if (confirm("Bạn chưa cấu hình nơi lưu ảnh cá nhân! Bấm OK để vào Cài đặt nhập Link Script của bạn.")) {
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

    getEl('loader').classList.remove('hidden');
    getEl('loader-text').textContent = "Đang lấy ảnh TSBĐ...";

    const tx = db.transaction(['images'], 'readonly');
    const store = tx.objectStore('images');
    const index = store.index('customerId'); // Lấy tất cả ảnh của khách này trước

    index.getAll(currentCustomerId).onsuccess = async (e) => {
        let allImages = e.target.result || [];
        
        // LỌC QUAN TRỌNG: Chỉ lấy ảnh có assetId TRÙNG VỚI assetId hiện tại
        let imagesToUpload = allImages.filter(img => img.assetId === currentAssetId);

        if (imagesToUpload.length === 0) {
            getEl('loader').classList.add('hidden');
            return alert("Tài sản này chưa có ảnh nào!");
        }

        const assetNamePlain = _displayText(currentAsset.name);
        if (!confirm(`Tải lên ${imagesToUpload.length} ảnh của tài sản "${assetNamePlain}" lên Drive?`)) {
            getEl('loader').classList.add('hidden');
            return;
        }

        getEl('loader-text').textContent = "Đang Upload TSBĐ...";

        // Đặt tên Folder: [Tên Khách] - [Tên Tài Sản]
        // Ví dụ: Nguyen Van A - Nhà Đất 50m2
        const custNamePlain = _displayText(currentCustomerData.name);
        const folderName = `${custNamePlain} - TSBĐ: ${assetNamePlain}`;

        const payload = {
            folderName: folderName,
            images: imagesToUpload.map((img, idx) => ({
                name: `asset_img_${Date.now()}_${idx}.jpg`,
                data: img.data
            }))
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
                
                // 2. Cập nhật Database
                db.transaction(['customers'], 'readwrite').objectStore('customers').put(currentCustomerData);
                
                getEl('loader').classList.add('hidden');
                
                // 3. Cập nhật giao diện
                renderAssetDriveStatus(result.url);
                
                // 4. Hỏi xóa ảnh
                if(confirm("✅ TSBĐ ĐÃ LÊN MÂY!\n\nXóa ảnh gốc trong máy để nhẹ bộ nhớ?")) {
                    const txDel = db.transaction(['images'], 'readwrite');
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
function renderAssetDriveStatus(url) {
    const area = getEl('asset-drive-status-area');
    const btnUp = getEl('btn-asset-upload');
    if (!area) return;
    area.classList.remove('hidden');

    const safeUrl = _normalizeDriveUrl(url);
    if (safeUrl && safeUrl.length > 5) {
        // Đã có link -> Hiện nút mở
        area.innerHTML = `
            <a href="${safeUrl}" target="_blank" class="w-full py-3 bg-teal-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg mb-1 animate-fade-in border border-teal-400/30">
                <i data-lucide="external-link" class="w-5 h-5"></i> Xem Folder TSBĐ
            </a>`;
        if (btnUp) btnUp.classList.remove('hidden');
    } else {
        // Chưa có link -> Hiện nút TÌM LẠI
        area.innerHTML = `
            <button onclick="reconnectAssetDriveFolder()" class="w-full py-2 mb-2 bg-slate-700/50 border border-slate-600 rounded-lg text-xs font-medium text-slate-300 flex items-center justify-center gap-2 hover:bg-slate-700 transition">
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
        if (confirm("Bạn chưa cấu hình nơi lưu ảnh cá nhân! Bấm OK để vào Cài đặt nhập Link Script của bạn.")) toggleMenu();
        return;
    }
    
    if (!currentCustomerData || !currentAssetId) return;
    const assetIndex = currentCustomerData.assets.findIndex(a => a.id === currentAssetId);
    if (assetIndex === -1) return;

    getEl('loader').classList.remove('hidden');
    getEl('loader-text').textContent = "Đang tìm TSBĐ...";
    
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
        getEl('loader').classList.add('hidden');
        alert('Không thể đọc tên TSBĐ (dữ liệu cũ đang mã hóa). Vui lòng mở Kho Ảnh TSBĐ để app tự giải mã tên, rồi thử lại.');
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
        }
    } catch (e) {}

    try {
        const response = await fetch(userUrl, {
            method: "POST",
            body: JSON.stringify({ action: 'search', folderName: folderName })
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
                getEl('loader').classList.add('hidden');
                renderAssetDriveStatus(plainUrl);
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
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
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
                body: JSON.stringify({ action: 'search', folderName: folderName })
            });
            const result = await response.json();
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
        const tx = db.transaction(['customers'], 'readwrite');
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

let currentOcrBase64 = null;

// 1. Mở Modal OCR
// Removed OCR modal handlers and OCR execution functions as OCR is no longer used

// 4. HÀM UPLOAD ẢNH (Gửi mảng ảnh lên Google Script)
async function uploadToGoogleDrive() {
    // Sử dụng Script cá nhân của người dùng. Nếu chưa cấu hình, hướng dẫn người dùng vào Cài đặt
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if (!userUrl || userUrl.length < 10) {
        if (confirm("Bạn chưa cấu hình nơi lưu ảnh cá nhân! Bấm OK để vào Cài đặt nhập Link Script của bạn.")) {
            toggleMenu();
        }
        return;
    }
    const scriptUrl = userUrl;
    if (!currentCustomerData) return;

    getEl('loader').classList.remove('hidden');
    getEl('loader-text').textContent = "Đang kiểm tra ảnh...";
    
    const tx = db.transaction(['images'], 'readonly');
    const index = tx.objectStore('images').index('customerId');

    index.getAll(currentCustomerId).onsuccess = async (e) => {
        let allImages = e.target.result || [];
        let imagesToUpload = allImages.filter(img => !img.assetId);

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
        const payload = {
            action: 'upload',
            // Ưu tiên đặt tên folder theo CCCD, fallback sang SĐT nếu chưa có CCCD
            folderName: `${_displayText(currentCustomerData.name)} - ${_displayText(currentCustomerData.cccd) || _displayText(currentCustomerData.phone)}`,
            images: imagesToUpload.map((img, idx) => ({
                name: `hoso_${Date.now()}_${idx}.jpg`,
                data: img.data
            }))
        };

        try {
            const response = await fetch(scriptUrl, {
                method: "POST",
                body: JSON.stringify(payload)
            });
            
            const result = await response.json();

            if (result.status === 'success') {
                currentCustomerData.driveLink = result.url;
                db.transaction(['customers'], 'readwrite').objectStore('customers').put(currentCustomerData);
                
                getEl('loader').classList.add('hidden');
                renderDriveStatus(result.url);
                
                if(confirm("✅ Upload thành công!\nXóa ảnh trong App để giải phóng bộ nhớ?")) {
                    const txDel = db.transaction(['images'], 'readwrite');
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

function parseRedBookInfo(text) {
    // Trả về đối tượng rỗng (OCR parser đã bỏ)
    return {};
}

// --- CẬP NHẬT HIỂN THỊ KẾT QUẢ ---
function renderRedBookInfo(info) {
    const item = (label, val, icon, highlight = false) => {
        // Nếu không có dữ liệu thì hiện dòng mờ
        const content = val ? `<b class="${highlight ? 'text-emerald-400' : 'text-white'} select-all text-right">${val}</b>` : `<span class="opacity-20 text-[10px]">---</span>`;
        return `
            <div class="flex items-start justify-between border-b border-white/5 pb-2 last:border-0 gap-3">
                <span class="text-slate-400 text-xs flex items-center gap-1.5 shrink-0 mt-0.5 min-w-[90px]">
                    <i data-lucide="${icon}" class="w-3.5 h-3.5 text-slate-500"></i> ${label}
                </span>
                <span class="text-sm break-words font-medium leading-tight flex-1 text-right">${content}</span>
            </div>
        `;
    };

    return `
        <div class="space-y-3 animate-fade-in">
            ${item('Chủ sở hữu', info.chuSoHuu, 'user')}
            ${item('Số bìa đỏ', info.soPhatHanh, 'qr-code', true)}
            <div class="grid grid-cols-2 gap-4">
                ${item('Tờ bản đồ', info.toBanDo, 'map')}
                ${item('Thửa đất', info.thuaDat, 'grid')}
            </div>
            ${item('Diện tích', info.dienTich ? info.dienTich + ' m²' : '', 'maximize')}
            
            ${item('Loại đất', info.mucDich, 'sprout')}
            
            ${item('Địa chỉ', info.diaChi, 'map-pin')}
            ${item('Số vào sổ', info.soVaoSo, 'file-text')}
        </div>
        <div class="mt-3 text-[10px] text-slate-500 text-center italic">
            * Dữ liệu được trích xuất tự động từ ảnh
        </div>
    `;
}


// Removed old mobile copy functions (copyOcrResult and fallbackCopyText) as OCR features have been replaced by QR scanning. Use copyToClipboard() instead.



// --- LOGIC UPLOAD ẢNH HỒ SƠ ---
async function uploadToGoogleDrive() {
    // Lấy link Script cá nhân cho upload tài sản
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if (!userUrl || userUrl.length < 10) {
        if (confirm("Bạn chưa cấu hình nơi lưu ảnh cá nhân! Bấm OK để vào Cài đặt nhập Link Script của bạn.")) {
            toggleMenu();
        }
        return;
    }
    const scriptUrl = userUrl;
    
    if (!currentCustomerData) return;

    // 1. Lấy ảnh từ Database
    getEl('loader').classList.remove('hidden');
    getEl('loader-text').textContent = "Đang kiểm tra ảnh...";
    
    const tx = db.transaction(['images'], 'readonly');
    const store = tx.objectStore('images');
    const index = store.index('customerId');

    index.getAll(currentCustomerId).onsuccess = async (e) => {
        let allImages = e.target.result || [];
        // Lấy ảnh hồ sơ (không có assetId)
        let imagesToUpload = allImages.filter(img => !img.assetId);

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
        const payload = {
            action: 'upload', // <--- Báo cho Script biết là muốn Upload
            // Ưu tiên đặt tên folder theo CCCD, fallback sang SĐT nếu chưa có CCCD
            folderName: `${_displayText(currentCustomerData.name)} - ${_displayText(currentCustomerData.cccd) || _displayText(currentCustomerData.phone)}`,
            images: imagesToUpload.map((img, idx) => ({
                name: `hoso_${Date.now()}_${idx}.jpg`,
                data: img.data // Gửi cả mảng ảnh đi 1 lần
            }))
        };

        try {
            const response = await fetch(scriptUrl, {
                method: "POST",
                body: JSON.stringify(payload)
            });
            
            const result = await response.json();

            if (result.status === 'success') {
                // Lưu link Folder
                currentCustomerData.driveLink = result.url;
                db.transaction(['customers'], 'readwrite').objectStore('customers').put(currentCustomerData);
                
                getEl('loader').classList.add('hidden');
                renderDriveStatus(result.url);
                
                if(confirm("✅ Đã Upload xong!\nXóa ảnh trong App để giải phóng bộ nhớ?")) {
                    const txDel = db.transaction(['images'], 'readwrite');
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
function parseRedBookInfo(text) {
    if (!text) return {};
    
    // 1. Chuẩn hóa văn bản: Xóa xuống dòng, xóa dấu | bảng biểu
    const raw = text.replace(/\|/g, ' ')
                    .replace(/\r\n/g, ' ')
                    .replace(/\n/g, ' ')
                    .replace(/\s+/g, ' '); // Gộp tất cả thành 1 dòng dài duy nhất

    const get = (regex) => {
        const m = raw.match(regex);
        return m && m[1] ? m[1].trim() : '';
    };

    return {
        // [SỐ BÌA ĐỎ]: Bắt mã AA/BS...
        soPhatHanh: get(/\b([A-Z]{2}\s{0,2}[0-9]{6,9})\b/),
        
        // [DIỆN TÍCH]: Bắt số ngay sau chữ "Diện tích"
        // Chỉ lấy số và dấu phẩy/chấm, bỏ qua chữ "c)" hay ":"
        dienTich: get(/Diện tích(?:.*?)[:\s]*([0-9]+[.,][0-9]+|[0-9]+)/i),
        
        // [ĐỊA CHỈ - QUAN TRỌNG NHẤT]: 
        // Chiến thuật: Bắt từ "Địa chỉ" cho đến khi gặp từ khóa "Diện tích" hoặc "Mục đích" hoặc "c)"
        // (?=...) là cú pháp "Dừng lại trước khi gặp..."
        diaChi: get(/(?:Địa chỉ|thửa đất)(?:\s*thửa đất)?[:\s]*(.*?)(?=\s*Diện tích|\s*Mục đích|\s*Hình thức|\s*c\))/i),

        // Các thông tin phụ (để hiển thị xem thêm)
        toBanDo: get(/(?:Tờ bản đồ số|TBĐ số|bản đồ số)[:\s]*([0-9]+)/i),
        thuaDat: get(/(?:Thửa đất số|Thửa số|thửa đất số)[:\s]*([0-9\-\,]+)/i),
        mucDich: get(/(?:Mục đích sử dụng|Mục đích|Loại đất)[:\s]*([^.;]+)/i),
        chuSoHuu: get(/(?:Ông|Bà|Người sử dụng đất|Hộ ông|Hộ bà|Họ và tên)[:\s]*([A-ZĂÂÁẮẤÀẰẦẢẲẨÃẴẪẠẶẬĐEÊÉẾÈỀẺỂẼỄẸỆIÍÌỈĨỊOÔƠÓỐỚÒỒỜỎỔỞÕỖỠỌỘỢUƯÚỨÙỪỦỬŨỮỤỰYÝỲỶỸỴ\s]+)/)
    };
}

// 6. Render Kết quả
function renderRedBookInfo(info) {
    const item = (label, val, icon, highlight = false) => {
        const content = val ? `<b class="${highlight ? 'text-emerald-400' : 'text-white'} select-all">${val}</b>` : `<span class="opacity-20 text-[10px]">---</span>`;
        return `
            <div class="flex items-start justify-between border-b border-white/5 pb-2 last:border-0 gap-2">
                <span class="text-slate-400 text-xs flex items-center gap-1.5 shrink-0 mt-0.5">
                    <i data-lucide="${icon}" class="w-3.5 h-3.5 text-slate-500"></i> ${label}
                </span>
                <span class="text-sm text-right break-words font-medium leading-tight">${content}</span>
            </div>
        `;
    };

    return `
        <div class="space-y-3 animate-fade-in">
            ${item('Số phát hành', info.soPhatHanh, 'qr-code', true)}
            ${item('Số vào sổ', info.soVaoSo, 'file-text')}
            <div class="grid grid-cols-2 gap-4">
                ${item('Tờ bản đồ', info.toBanDo, 'map')}
                ${item('Thửa đất', info.thuaDat, 'grid')}
            </div>
            ${item('Diện tích', info.dienTich ? info.dienTich + ' m²' : '', 'maximize')}
            ${item('Mục đích', info.mucDich, 'sprout')}
            ${item('Địa chỉ', info.diaChi, 'map-pin')}
        </div>
    `;
}

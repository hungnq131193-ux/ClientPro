/**
 * DRIVE.JS
 * Quản lý kết nối Google Apps Script, Upload ảnh và đồng bộ trạng thái Drive.
 * Phụ thuộc: config.js, database.js, security.js
 */

// --- CONFIGURATION ---

function saveScriptUrl() {
    const url = getEl('user-script-url').value.trim();
    if (!url.startsWith('https://script.google.com/')) {
        alert("Link không đúng định dạng!");
        return;
    }
    // Lưu link Script cá nhân vào localStorage
    localStorage.setItem(USER_SCRIPT_KEY, url);
    if(typeof showToast === 'function') showToast("Đã lưu kết nối Drive cá nhân");
}

// Hàm khởi tạo, gọi khi App load (thường đặt trong DOMContentLoaded ở ui.js, nhưng để đây cho gọn logic)
function initDriveConfig() {
    const savedUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if(savedUrl && getEl('user-script-url')) {
        getEl('user-script-url').value = savedUrl;
    }
}

// --- PROFILE IMAGE UPLOAD (ẢNH HỒ SƠ) ---

async function uploadToGoogleDrive() {
    // 1. Kiểm tra cấu hình Script
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if (!userUrl || userUrl.length < 10) {
        if (confirm("Bạn chưa cấu hình nơi lưu ảnh cá nhân! Bấm OK để vào Cài đặt nhập Link Script của bạn.")) {
            if(typeof toggleMenu === 'function') toggleMenu();
        }
        return;
    }
    const scriptUrl = userUrl;
    
    if (!currentCustomerData) return;

    // 2. Chuẩn bị UI loader
    if(getEl('loader')) {
        getEl('loader').classList.remove('hidden');
        getEl('loader-text').textContent = "Đang kiểm tra ảnh...";
    }
    
    // 3. Lấy ảnh từ DB
    const tx = db.transaction(['images'], 'readonly');
    const store = tx.objectStore('images');
    const index = store.index('customerId');

    index.getAll(currentCustomerId).onsuccess = async (e) => {
        let allImages = e.target.result || [];
        // Lọc: Chỉ lấy ảnh chưa được gắn vào Asset (tức là ảnh hồ sơ)
        let imagesToUpload = allImages.filter(img => !img.assetId);

        if (imagesToUpload.length === 0) {
            getEl('loader').classList.add('hidden');
            return alert("Không có ảnh hồ sơ nào để tải lên!");
        }

        if (!confirm(`Tải lên ${imagesToUpload.length} ảnh hồ sơ lên Google Drive?`)) {
            getEl('loader').classList.add('hidden');
            return;
        }

        getEl('loader-text').textContent = "Đang tải lên Cloud...";

        // 4. Tạo Payload gửi đi
        // Tên folder: Tên KH - SĐT (hoặc CCCD)
        const folderName = `${currentCustomerData.name} - ${decryptText(currentCustomerData.cccd) || decryptText(currentCustomerData.phone)}`;
        
        const payload = {
            action: 'upload', // Báo cho Script biết là action upload
            folderName: folderName,
            images: imagesToUpload.map((img, idx) => ({
                name: `hoso_${Date.now()}_${idx}.jpg`,
                data: img.data
            }))
        };

        try {
            // 5. Gửi Request POST
            const response = await fetch(scriptUrl, {
                method: "POST",
                body: JSON.stringify(payload)
            });
            
            const result = await response.json();

            if (result.status === 'success') {
                // 6. Thành công: Lưu link và dọn dẹp
                currentCustomerData.driveLink = result.url;
                
                // Cập nhật DB
                const txUpdate = db.transaction(['customers'], 'readwrite');
                txUpdate.objectStore('customers').put(currentCustomerData);
                
                getEl('loader').classList.add('hidden');
                renderDriveStatus(result.url); // Cập nhật giao diện nút bấm
                
                // Hỏi xóa ảnh gốc để nhẹ máy
                if(confirm("✅ UPLOAD THÀNH CÔNG!\n\nXóa ảnh trong App để giải phóng bộ nhớ?")) {
                    const txDel = db.transaction(['images'], 'readwrite');
                    imagesToUpload.forEach(img => txDel.objectStore('images').delete(img.id));
                    txDel.oncomplete = () => {
                        if(typeof loadProfileImages === 'function') loadProfileImages(); // Refresh lưới ảnh
                        if(typeof showToast === 'function') showToast("Đã dọn dẹp bộ nhớ");
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

// --- ASSET IMAGE UPLOAD (ẢNH TÀI SẢN) ---

async function uploadAssetToDrive() {
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if (!userUrl || userUrl.length < 10) {
        if (confirm("Bạn chưa cấu hình nơi lưu ảnh cá nhân! Bấm OK để vào Cài đặt nhập Link Script của bạn.")) {
            if(typeof toggleMenu === 'function') toggleMenu();
        }
        return;
    }
    const scriptUrl = userUrl;
    
    if (!currentCustomerData || !currentAssetId) return;

    // Tìm asset đang thao tác
    const assetIndex = currentCustomerData.assets.findIndex(a => a.id === currentAssetId);
    if (assetIndex === -1) return;
    const currentAsset = currentCustomerData.assets[assetIndex];

    if(getEl('loader')) {
        getEl('loader').classList.remove('hidden');
        getEl('loader-text').textContent = "Đang lấy ảnh TSBĐ...";
    }

    const tx = db.transaction(['images'], 'readonly');
    const store = tx.objectStore('images');
    const index = store.index('customerId'); 

    index.getAll(currentCustomerId).onsuccess = async (e) => {
        let allImages = e.target.result || [];
        
        // LỌC QUAN TRỌNG: Chỉ lấy ảnh thuộc về assetId này
        let imagesToUpload = allImages.filter(img => img.assetId === currentAssetId);

        if (imagesToUpload.length === 0) {
            getEl('loader').classList.add('hidden');
            return alert("Tài sản này chưa có ảnh nào!");
        }

        // Giải mã tên tài sản để hiển thị trong confirm
        const assetNameDecrypted = decryptText(currentAsset.name);

        if (!confirm(`Tải lên ${imagesToUpload.length} ảnh của tài sản "${assetNameDecrypted}" lên Drive?`)) {
            getEl('loader').classList.add('hidden');
            return;
        }

        getEl('loader-text').textContent = "Đang Upload TSBĐ...";

        // Đặt tên Folder: [Tên Khách] - TSBĐ: [Tên Tài Sản]
        const folderName = `${currentCustomerData.name} - TSBĐ: ${assetNameDecrypted}`;

        const payload = {
            action: 'upload',
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
                const txUpdate = db.transaction(['customers'], 'readwrite');
                txUpdate.objectStore('customers').put(currentCustomerData);
                
                getEl('loader').classList.add('hidden');
                
                // 3. Cập nhật giao diện
                renderAssetDriveStatus(result.url);
                
                // 4. Hỏi xóa ảnh
                if(confirm("✅ TSBĐ ĐÃ LÊN MÂY!\n\nXóa ảnh gốc trong máy để nhẹ bộ nhớ?")) {
                    const txDel = db.transaction(['images'], 'readwrite');
                    imagesToUpload.forEach(img => txDel.objectStore('images').delete(img.id));
                    txDel.oncomplete = () => {
                        if(typeof loadAssetImages === 'function') loadAssetImages(currentAssetId); 
                        if(typeof showToast === 'function') showToast("Đã dọn dẹp ảnh TSBĐ");
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

// --- STATUS RENDERING & RECONNECTION LOGIC ---

// 1. Render nút trạng thái cho Hồ sơ
function renderDriveStatus(url) {
    const area = getEl('drive-status-area');
    const btnUp = getEl('btn-upload-drive');
    
    if (!area) return;
    
    if (url && url.length > 5) {
        // ĐÃ CÓ LINK → hiện nút Mở Drive
        area.classList.remove('hidden');
        area.innerHTML = `
          <a href="${url}" target="_blank"
             class="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold
                    flex items-center justify-center gap-2 shadow-lg mb-1
                    animate-fade-in border border-emerald-400/30">
            <i data-lucide="external-link" class="w-5 h-5"></i> Mở Folder Ảnh
          </a>
          <p class="text-[10px] text-center text-emerald-400/70 italic mb-2">
            Đã đồng bộ lên Cloud
          </p>
        `;
        
        if (btnUp) btnUp.classList.remove('hidden'); // Vẫn cho upload thêm
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

// 2. Render nút trạng thái cho Tài sản
function renderAssetDriveStatus(url) {
    const area = getEl('asset-drive-status-area');
    const btnUp = getEl('btn-asset-upload');
    if (!area) return;
    area.classList.remove('hidden');

    if (url && url.length > 5) {
        // Đã có link
        area.innerHTML = `
            <a href="${url}" target="_blank" class="w-full py-3 bg-teal-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg mb-1 animate-fade-in border border-teal-400/30">
                <i data-lucide="external-link" class="w-5 h-5"></i> Xem Folder TSBĐ
            </a>`;
        if (btnUp) btnUp.classList.remove('hidden');
    } else {
        // Chưa có link
        area.innerHTML = `
            <button onclick="reconnectAssetDriveFolder()" class="w-full py-2 mb-2 bg-slate-700/50 border border-slate-600 rounded-lg text-xs font-medium text-slate-300 flex items-center justify-center gap-2 hover:bg-slate-700 transition">
                <i data-lucide="search" class="w-4 h-4"></i> Tìm kết nối cũ
            </button>`;
        if (btnUp) btnUp.classList.remove('hidden');
    }
    if(window.lucide) lucide.createIcons();
}

// 3. Logic tìm lại Folder Hồ sơ
async function reconnectDriveFolder() {
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if (!userUrl || userUrl.length < 10) {
        if (confirm("Chưa cấu hình Script! Vào cài đặt ngay?")) {
            if(typeof toggleMenu === 'function') toggleMenu();
        }
        return;
    }
    
    if (!currentCustomerData) return;

    getEl('loader').classList.remove('hidden');
    getEl('loader-text').textContent = "Đang tìm trên Drive...";

    const name = currentCustomerData.name;
    const phone = decryptText(currentCustomerData.phone);
    const cccd = decryptText(currentCustomerData.cccd);

    // Tạo danh sách các tên folder khả thi
    const possibleNames = [];
    if (cccd) possibleNames.push(`${name} - ${cccd}`);
    if (phone) possibleNames.push(`${name} - ${phone}`);

    let foundUrl = null;

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

    if (foundUrl) {
        currentCustomerData.driveLink = foundUrl;
        const tx = db.transaction(['customers'], 'readwrite');
        tx.objectStore('customers').put(currentCustomerData).onsuccess = () => {
            getEl('loader').classList.add('hidden');
            renderDriveStatus(foundUrl);
            if(typeof showToast === 'function') showToast("Đã kết nối lại thành công!");
        };
    } else {
        getEl('loader').classList.add('hidden');
        alert("Không tìm thấy folder nào khớp với Tên + CCCD hoặc Tên + SĐT.");
    }
}

// 4. Logic tìm lại Folder Tài sản
async function reconnectAssetDriveFolder() {
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if (!userUrl || userUrl.length < 10) {
        if (confirm("Chưa cấu hình Script!")) {
             if(typeof toggleMenu === 'function') toggleMenu();
        }
        return;
    }
    
    if (!currentCustomerData || !currentAssetId) return;
    const assetIndex = currentCustomerData.assets.findIndex(a => a.id === currentAssetId);
    if (assetIndex === -1) return;

    getEl('loader').classList.remove('hidden');
    getEl('loader-text').textContent = "Đang tìm TSBĐ...";
    
    const assetNameDecrypted = decryptText(currentCustomerData.assets[assetIndex].name);
    const folderName = `${currentCustomerData.name} - TSBĐ: ${assetNameDecrypted}`;

    try {
        const response = await fetch(userUrl, {
            method: "POST",
            body: JSON.stringify({ action: 'search', folderName: folderName })
        });
        const result = await response.json();

        if (result.status === 'found') {
            // Mã hóa link trước khi lưu (nếu cần, nhưng thường driveLink để plain text cũng ổn vì là link công khai)
            // Trong security.js logic decryptCustomerObject có dòng decryptText(cust.driveLink), nên ta cần thống nhất.
            // Ở đây App cũ lưu plain text, hàm decryptText trả về plain text nếu không giải mã được -> OK.
            
            const tx = db.transaction(['customers'], 'readwrite');
            const store = tx.objectStore('customers');
            store.get(currentCustomerData.id).onsuccess = (e) => {
                let dbRecord = e.target.result;
                if (dbRecord && dbRecord.assets && dbRecord.assets[assetIndex]) {
                    dbRecord.assets[assetIndex].driveLink = result.url;
                    store.put(dbRecord);
                }
            };
            tx.oncomplete = () => {
                currentCustomerData.assets[assetIndex].driveLink = result.url;
                getEl('loader').classList.add('hidden');
                renderAssetDriveStatus(result.url);
                if(typeof showToast === 'function') showToast("Đã kết nối lại!");
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

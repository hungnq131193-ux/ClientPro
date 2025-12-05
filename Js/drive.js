// ============================================================
// DRIVE.JS - KẾT NỐI GOOGLE APPS SCRIPT (UPLOAD & SYNC)
// ============================================================

/**
 * Lưu link Script cá nhân của người dùng vào LocalStorage
 */
function saveScriptUrl() {
    const url = getEl('user-script-url').value.trim();
    if (!url.startsWith('https://script.google.com/')) {
        alert("Link không đúng định dạng! Phải bắt đầu bằng https://script.google.com/...");
        return;
    }
    localStorage.setItem(USER_SCRIPT_KEY, url);
    showToast("Đã lưu kết nối Drive cá nhân");
}

/**
 * Upload ảnh HỒ SƠ lên Google Drive
 */
async function uploadToGoogleDrive() {
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    
    if (!userUrl || userUrl.length < 10) {
        if (confirm("Bạn chưa cấu hình nơi lưu ảnh! Vào Cài đặt để dán Link Script ngay?")) {
            toggleMenu();
        }
        return;
    }
    
    if (!currentCustomerData) return;

    // Hiển thị Loader
    getEl('loader').classList.remove('hidden');
    getEl('loader-text').textContent = "Đang chuẩn bị ảnh...";
    
    const tx = db.transaction(['images'], 'readonly');
    const index = tx.objectStore('images').index('customerId');

    index.getAll(currentCustomerId).onsuccess = async (e) => {
        let allImages = e.target.result || [];
        // Lọc ảnh hồ sơ (không có assetId)
        let imagesToUpload = allImages.filter(img => !img.assetId);

        if (imagesToUpload.length === 0) {
            getEl('loader').classList.add('hidden');
            return alert("Không có ảnh hồ sơ nào để tải lên!");
        }

        if (!confirm(`Tải lên ${imagesToUpload.length} ảnh hồ sơ?`)) {
            getEl('loader').classList.add('hidden');
            return;
        }

        getEl('loader-text').textContent = "Đang tải lên Cloud...";

        // Chuẩn bị Payload
        const payload = {
            action: 'upload',
            folderName: `${currentCustomerData.name} - ${decryptText(currentCustomerData.cccd) || decryptText(currentCustomerData.phone)}`,
            images: imagesToUpload.map((img, idx) => ({
                name: `hoso_${Date.now()}_${idx}.jpg`,
                data: img.data
            }))
        };

        try {
            // Gửi Request POST (no-cors trick không đọc được response JSON, nên cần dùng method chuẩn)
            // Lưu ý: Apps Script phải được deploy dưới dạng Web App với quyền "Anyone"
            const response = await fetch(userUrl, {
                method: "POST",
                body: JSON.stringify(payload)
            });
            
            const result = await response.json();

            if (result.status === 'success') {
                // Lưu link Drive trả về
                currentCustomerData.driveLink = result.url;
                
                // Cập nhật DB
                const txUpdate = db.transaction(['customers'], 'readwrite');
                txUpdate.objectStore('customers').put(currentCustomerData);
                
                getEl('loader').classList.add('hidden');
                renderDriveStatus(result.url); // Hiển thị nút mở Drive
                
                // Hỏi xóa ảnh gốc để giải phóng bộ nhớ
                if(confirm("✅ UPLOAD THÀNH CÔNG!\n\nXóa ảnh trong máy để nhẹ bộ nhớ?")) {
                    const txDel = db.transaction(['images'], 'readwrite');
                    imagesToUpload.forEach(img => txDel.objectStore('images').delete(img.id));
                    txDel.oncomplete = () => {
                        loadProfileImages(); // Refresh lưới ảnh
                        showToast("Đã dọn dẹp bộ nhớ");
                    };
                }
            } else {
                throw new Error(result.message || "Lỗi không xác định từ Server");
            }
        } catch (err) {
            console.error(err);
            getEl('loader').classList.add('hidden');
            alert("Lỗi Upload: " + err.message + "\nKiểm tra lại Link Script hoặc Kết nối mạng.");
        }
    };
}

/**
 * Upload ảnh TÀI SẢN (TSBĐ) lên Google Drive
 */
async function uploadAssetToDrive() {
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    
    if (!userUrl || userUrl.length < 10) {
        if (confirm("Chưa cấu hình Script! Vào cài đặt ngay?")) toggleMenu();
        return;
    }
    
    if (!currentCustomerData || !currentAssetId) return;

    // Tìm index tài sản đang thao tác
    const assetIndex = currentCustomerData.assets.findIndex(a => a.id === currentAssetId);
    if (assetIndex === -1) return;
    const currentAsset = currentCustomerData.assets[assetIndex];

    getEl('loader').classList.remove('hidden');
    getEl('loader-text').textContent = "Đang lấy ảnh TSBĐ...";

    const tx = db.transaction(['images'], 'readonly');
    const index = tx.objectStore('images').index('customerId');

    index.getAll(currentCustomerId).onsuccess = async (e) => {
        let allImages = e.target.result || [];
        // Lọc ảnh thuộc về tài sản này
        let imagesToUpload = allImages.filter(img => img.assetId === currentAssetId);

        if (imagesToUpload.length === 0) {
            getEl('loader').classList.add('hidden');
            return alert("Tài sản này chưa có ảnh nào!");
        }

        if (!confirm(`Tải lên ${imagesToUpload.length} ảnh của "${decryptText(currentAsset.name)}"?`)) {
            getEl('loader').classList.add('hidden');
            return;
        }

        getEl('loader-text').textContent = "Đang Upload TSBĐ...";

        // Tên folder: [Tên Khách] - TSBĐ: [Tên Tài Sản]
        const folderName = `${currentCustomerData.name} - TSBĐ: ${decryptText(currentAsset.name)}`;

        const payload = {
            action: 'upload', // Cần thêm action để script phân biệt nếu cần
            folderName: folderName,
            images: imagesToUpload.map((img, idx) => ({
                name: `asset_img_${Date.now()}_${idx}.jpg`,
                data: img.data
            }))
        };

        try {
            const response = await fetch(userUrl, {
                method: "POST",
                body: JSON.stringify(payload)
            });
            
            const result = await response.json();

            if (result.status === 'success') {
                // Lưu link vào Asset
                currentCustomerData.assets[assetIndex].driveLink = result.url;
                
                // Cập nhật DB
                const txUpdate = db.transaction(['customers'], 'readwrite');
                txUpdate.objectStore('customers').put(currentCustomerData);
                
                getEl('loader').classList.add('hidden');
                renderAssetDriveStatus(result.url);
                
                if(confirm("✅ TSBĐ ĐÃ LÊN MÂY!\n\nXóa ảnh gốc trong máy?")) {
                    const txDel = db.transaction(['images'], 'readwrite');
                    imagesToUpload.forEach(img => txDel.objectStore('images').delete(img.id));
                    txDel.oncomplete = () => {
                        loadAssetImages(currentAssetId); 
                        showToast("Đã dọn dẹp ảnh TSBĐ");
                    };
                }
            } else {
                throw new Error(result.message);
            }
        } catch (err) {
            getEl('loader').classList.add('hidden');
            alert("Lỗi: " + err.message);
        }
    };
}

// --- HIỂN THỊ TRẠNG THÁI DRIVE (UI RENDERING) ---

function renderDriveStatus(url) {
    const area = getEl('drive-status-area');
    const btnUp = getEl('btn-upload-drive');
    
    if (!area) return;
    area.classList.remove('hidden');
    
    if (url && url.length > 5) {
        // Đã có link -> Hiện nút Mở
        area.innerHTML = `
            <a href="${url}" target="_blank"
                class="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold
                        flex items-center justify-center gap-2 shadow-lg mb-1
                        animate-fade-in border border-emerald-400/30">
                <i data-lucide="external-link" class="w-5 h-5"></i> Mở Folder Ảnh
            </a>
            <p class="text-[10px] text-center text-emerald-400/70 italic mb-2">Đã đồng bộ Cloud</p>`;
        if (btnUp) btnUp.classList.remove('hidden'); 
    } else {
        // Chưa có link -> Hiện nút Tìm lại
        area.innerHTML = `
            <button onclick="reconnectDriveFolder()"
                    class="w-full py-2 mb-2 bg-slate-700/50 border border-slate-600
                            rounded-lg text-xs font-medium text-slate-300
                            flex items-center justify-center gap-2 hover:bg-slate-700 transition">
                <i data-lucide="search" class="w-4 h-4"></i> Tìm kết nối cũ
            </button>`;
        if (btnUp) btnUp.classList.remove('hidden');
    }
    if (window.lucide) lucide.createIcons();
}

function renderAssetDriveStatus(url) {
    const area = getEl('asset-drive-status-area');
    const btnUp = getEl('btn-asset-upload');
    if (!area) return;
    area.classList.remove('hidden');

    if (url && url.length > 5) {
        area.innerHTML = `
            <a href="${url}" target="_blank" class="w-full py-3 bg-teal-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg mb-1 animate-fade-in border border-teal-400/30">
                <i data-lucide="external-link" class="w-5 h-5"></i> Xem Folder TSBĐ
            </a>`;
        if (btnUp) btnUp.classList.remove('hidden');
    } else {
        area.innerHTML = `
            <button onclick="reconnectAssetDriveFolder()" class="w-full py-2 mb-2 bg-slate-700/50 border border-slate-600 rounded-lg text-xs font-medium text-slate-300 flex items-center justify-center gap-2 hover:bg-slate-700 transition">
                <i data-lucide="search" class="w-4 h-4"></i> Tìm kết nối cũ
            </button>`;
        if (btnUp) btnUp.classList.remove('hidden');
    }
    if(window.lucide) lucide.createIcons();
}

// --- LOGIC TÌM LẠI FOLDER (RECONNECT) ---

async function reconnectDriveFolder() {
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if (!userUrl || userUrl.length < 10) {
        if (confirm("Chưa cấu hình Script! Vào cài đặt ngay?")) toggleMenu();
        return;
    }
    if (!currentCustomerData) return;

    getEl('loader').classList.remove('hidden');
    getEl('loader-text').textContent = "Đang tìm trên Drive...";

    const name = currentCustomerData.name;
    const phone = decryptText(currentCustomerData.phone);
    const cccd = decryptText(currentCustomerData.cccd);

    // Thử các tên folder khả thi
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
                break; // Tìm thấy thì dừng ngay
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
            showToast("Đã kết nối lại thành công!");
        };
    } else {
        getEl('loader').classList.add('hidden');
        alert("Không tìm thấy folder nào khớp trên Drive.");
    }
}

async function reconnectAssetDriveFolder() {
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if (!userUrl || userUrl.length < 10) {
        if (confirm("Chưa cấu hình Script! Vào cài đặt ngay?")) toggleMenu();
        return;
    }
    
    if (!currentCustomerData || !currentAssetId) return;
    const assetIndex = currentCustomerData.assets.findIndex(a => a.id === currentAssetId);
    if (assetIndex === -1) return;

    getEl('loader').classList.remove('hidden');
    getEl('loader-text').textContent = "Đang tìm TSBĐ...";
    
    const assetName = decryptText(currentCustomerData.assets[assetIndex].name);
    const folderName = `${currentCustomerData.name} - TSBĐ: ${assetName}`;

    try {
        const response = await fetch(userUrl, {
            method: "POST",
            body: JSON.stringify({ action: 'search', folderName: folderName })
        });
        const result = await response.json();

        if (result.status === 'found') {
            const encLink = encryptText(result.url); // Mã hóa link tìm được
            
            // Cập nhật DB
            currentCustomerData.assets[assetIndex].driveLink = encLink;
            const tx = db.transaction(['customers'], 'readwrite');
            tx.objectStore('customers').put(currentCustomerData).onsuccess = () => {
                // Cập nhật UI (dùng link chưa mã hóa để hiển thị)
                currentCustomerData.assets[assetIndex].driveLink = result.url; 
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

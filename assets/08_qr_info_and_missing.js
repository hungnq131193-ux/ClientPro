// --- 1. Hàm kích hoạt OCR từ nút bấm trong Modal Tài Sản ---
// Removed triggerAssetOcr, runAssetOcrLogic and old viewSavedOcr as OCR has been replaced by QR scanning.
// --- HÀM XEM LẠI THÔNG TIN QR (ĐÃ NÂNG CẤP GIAO DIỆN) ---
function viewSavedOcr(assetId) {
    const asset = currentCustomerData && currentCustomerData.assets
        ? currentCustomerData.assets.find(a => a.id === assetId)
        : null;
        
    if (!asset || !asset.ocrData) {
        showToast('Không có dữ liệu QR');
        return;
    }

    // 1. Giải mã dữ liệu
    const rawData = decryptText(asset.ocrData);
    
    // 2. Phân tích dữ liệu (Nếu là chuẩn QR mới có dấu gạch đứng |)
    let htmlContent = '';
    
    if (rawData.includes('|')) {
        // Mẫu: 05...|H44...|ILIS4.0|...|AQ 04258571|...
        const parts = rawData.split('|');
        const serial = parts[4] || '---';      // Số phát hành
        const system = parts[2] || '---';      // Hệ thống (ILIS...)
        const docId  = parts[1] || '---';      // Mã hồ sơ
        const time   = parts[0] || '---';      // Mã thời gian

        // Giao diện bảng đẹp
        htmlContent = `
            <div class="space-y-3 mb-4">
                <div class="bg-white/5 p-3 rounded-lg border border-white/10">
                    <p class="text-[10px] text-slate-400 uppercase font-bold mb-1">Số phát hành (Bìa đỏ)</p>
                    <p class="text-xl font-bold text-emerald-400 tracking-wider">${serial}</p>
                </div>
                
                <div class="grid grid-cols-2 gap-3">
                    <div class="bg-white/5 p-3 rounded-lg border border-white/10">
                        <p class="text-[10px] text-slate-400 uppercase font-bold mb-1">Hệ thống</p>
                        <p class="text-sm font-bold text-white">${system}</p>
                    </div>
                    <div class="bg-white/5 p-3 rounded-lg border border-white/10">
                        <p class="text-[10px] text-slate-400 uppercase font-bold mb-1">Mã khu vực</p>
                        <p class="text-sm font-bold text-white break-all">${docId}</p>
                    </div>
                </div>

                <div class="bg-white/5 p-3 rounded-lg border border-white/10">
                    <p class="text-[10px] text-slate-400 uppercase font-bold mb-1">Chuỗi định danh đầy đủ</p>
                    <p class="text-xs text-slate-300 font-mono break-all leading-relaxed">${rawData}</p>
                </div>
                
                <p class="text-[10px] text-slate-500 italic text-center mt-2">
                    * QR này chứa mã định danh điện tử, không chứa trực tiếp địa chỉ/diện tích.
                </p>
            </div>
        `;
    } else {
        // Trường hợp QR/OCR cũ hoặc dạng text thường
        htmlContent = `
            <div class="bg-white/5 p-4 rounded-xl border border-white/10 mb-4">
                <p class="text-xs text-slate-300 font-mono whitespace-pre-wrap leading-relaxed">${rawData}</p>
            </div>
        `;
    }

    // 3. Hiển thị Popup
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[300] bg-black/90 flex items-center justify-center p-6 backdrop-blur-sm animate-fade-in';
    overlay.innerHTML = `
        <div class="glass-panel w-full max-w-sm rounded-2xl p-6 shadow-2xl border border-purple-500/30">
            <h3 class="font-bold text-lg mb-4 text-purple-400 flex items-center gap-2">
                <i data-lucide="scan-barcode" class="w-5 h-5"></i> Thông tin QR Bìa đỏ
            </h3>
            
            <div class="max-h-[60vh] overflow-y-auto custom-scrollbar">
                ${htmlContent}
            </div>

            <div class="flex gap-3 mt-2">
                <button onclick="copyToClipboard('${rawData.replace(/\n/g, '\\n')}')" class="flex-1 py-3 rounded-xl font-bold bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 transition border border-purple-500/30">Copy Tất Cả</button>
                <button onclick="this.closest('.fixed').remove()" class="flex-1 py-3 rounded-xl font-bold bg-white/10 text-white hover:bg-white/20 transition">Đóng</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    if (window.lucide) lucide.createIcons();
}

// The new implementation of viewSavedOcr is defined later in the script.
// --- BỔ SUNG CÁC HÀM BỊ THIẾU (Dán vào cuối file script) ---

function closeModal() {
    getEl('add-modal').classList.add('hidden');
}

function saveCustomer() {
    const id = getEl('edit-cust-id').value;
    const name = getEl('new-name').value.trim();
    const phone = getEl('new-phone').value.trim();
    const cccd = getEl('new-cccd') ? getEl('new-cccd').value.trim() : '';
    // Mã hóa đầy đủ thông tin khách hàng trước khi lưu
    const encName = encryptText(name);
    const encPhone = encryptText(phone);
    const encCccd = encryptText(cccd);
    if (!name || !phone) return alert("Vui lòng nhập đầy đủ Tên và SĐT!");

    const tx = db.transaction(['customers'], 'readwrite');
    const store = tx.objectStore('customers');

    if (id) {
        // --- Sửa khách hàng cũ ---
        store.get(id).onsuccess = (e) => {
            const data = e.target.result;
            if (data) {
                // Cập nhật tên, SĐT và CCCD đã mã hóa
                data.name = encName;
                data.phone = encPhone;
                data.cccd = encCccd;
                store.put(data);
            }
        };
    } else {
        // --- Thêm khách hàng mới ---
        const newCust = {
            id: 'cust_' + Date.now(),
            name: encName,
            phone: encPhone,
            cccd: encCccd,
            status: 'pending',
            createdAt: Date.now(),
            assets: [],
            driveLink: null
        };
        store.add(newCust);
    }

    tx.oncomplete = () => {
        closeModal();
        loadCustomers(getEl('search-input').value); // Load lại danh sách
        
        // Nếu đang mở folder của khách này thì cập nhật header
        if (id && currentCustomerData && currentCustomerData.id === id) {
            // Cập nhật lại UI header
            getEl('folder-customer-name').textContent = name;
            getEl('folder-avatar').textContent = name.charAt(0).toUpperCase();
            currentCustomerData.name = name;
            currentCustomerData.phone = phone;
            currentCustomerData.cccd = cccd;
        }
        
        showToast(id ? "Đã cập nhật hồ sơ" : "Đã thêm khách hàng mới");
    };
    
    tx.onerror = () => {
        alert("Lỗi lưu dữ liệu! Kiểm tra lại Console.");
    };
}

function openEditCustomerModal() {
    if (!currentCustomerData) return;
    getEl('add-modal').classList.remove('hidden');
    getEl('modal-title-cust').textContent = "Cập nhật thông tin";
    getEl('btn-save-cust').textContent = "Lưu thay đổi";
    getEl('edit-cust-id').value = currentCustomerData.id;
    getEl('new-name').value = currentCustomerData.name;
    // Decrypt stored phone before displaying in the input
    getEl('new-phone').value = decryptText(currentCustomerData.phone);
    // Điền CCCD/CMND nếu có
    if (getEl('new-cccd')) {
        const decryptedCccd = decryptText(currentCustomerData.cccd);
        getEl('new-cccd').value = decryptedCccd || '';
    }
}

// =========================================
// QR Code Scanning Logic (Offline)
// =========================================

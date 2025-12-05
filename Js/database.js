        function deleteSelectedCustomers() {
            if(selectedCustomers.size === 0) return; if(!confirm(`Xóa vĩnh viễn ${selectedCustomers.size} khách hàng?`)) return;
            const tx = db.transaction(['customers', 'images'], 'readwrite'); const custStore = tx.objectStore('customers'); const imgStore = tx.objectStore('images');
            selectedCustomers.forEach(custId => { custStore.delete(custId); imgStore.index('customerId').getAllKeys(custId).onsuccess = e => { e.target.result.forEach(imgId => imgStore.delete(imgId)); }; });
            tx.oncomplete = () => { showToast("Đã xóa"); toggleCustSelectionMode(); };
        }
        function loadCustomers(query = '') {
            if (!db) return;
            const tx = db.transaction(['customers'], 'readonly');
            tx.objectStore('customers').getAll().onsuccess = (e) => {
                let list = e.target.result || [];
                // Giải mã đầy đủ từng khách hàng trước khi lọc hoặc tìm kiếm
                list.forEach(c => {
                    if (!c.assets) c.assets = [];
                    if (!c.status) c.status = 'pending';
                    decryptCustomerObject(c);
                });
                // Lọc theo tab trạng thái
                list = list.filter(c => c.status === activeListTab);
                if (query) {
                    const q = query.toLowerCase();
                    list = list.filter(c => {
                        const nameMatch = (c.name || '').toLowerCase().includes(q);
                        const phoneMatch = (c.phone || '').includes(q);
                        return nameMatch || phoneMatch;
                    });
                }
                list.sort((a, b) => b.createdAt - a.createdAt);
                renderList(list);
            };
        }
        function deleteCurrentCustomer() { 
            if(!confirm("XÁC NHẬN: Xóa toàn bộ hồ sơ khách hàng này?")) return; 
            try {
                const tx = db.transaction(['images', 'customers'], 'readwrite'); const imgStore = tx.objectStore('images'); const custStore = tx.objectStore('customers');
                if (imgStore.indexNames.contains('customerId')) { imgStore.index('customerId').getAllKeys(currentCustomerId).onsuccess = (e) => { e.target.result.forEach(key => imgStore.delete(key)); }; }
                custStore.delete(currentCustomerId); tx.oncomplete = () => { closeFolder(); showToast("Đã xóa hồ sơ"); loadCustomers(); };
            } catch (err) { window.location.reload(); }
        }
        function deleteAsset(idx) { 
            if(!confirm("Xóa tài sản này?")) return; currentCustomerData.assets.splice(idx,1); 
            db.transaction(['customers'],'readwrite').objectStore('customers').put(currentCustomerData).onsuccess = () => { showToast("Đã xóa TSBĐ"); renderAssets(); }; 
        }
        function toggleCustomerStatus() { if (currentCustomerData.status === 'pending') { getEl('approve-modal').classList.remove('hidden'); getEl('approve-limit').value = ''; } else { if(confirm("Thu hồi trạng thái?")) { currentCustomerData.status = 'pending'; updateCustomerAndReload(); } } }
        function closeApproveModal() { getEl('approve-modal').classList.add('hidden'); }
        function confirmApproval() { const l = getEl('approve-limit').value; if(!l) return alert("Nhập hạn mức!"); currentCustomerData.status='approved'; currentCustomerData.creditLimit=l; closeApproveModal(); db.transaction(['customers'], 'readwrite').objectStore('customers').put(currentCustomerData).onsuccess = () => { showToast("Đã duyệt"); renderFolderHeader(currentCustomerData); loadCustomers(getEl('search-input').value); }; }
        function updateCustomerAndReload() { db.transaction(['customers'], 'readwrite').objectStore('customers').put(currentCustomerData).onsuccess = () => { openFolder(currentCustomerData.id); loadCustomers(); }; }
        function saveAsset() { 
    // Lấy giá trị từ các ô nhập liệu
    const name = getEl('asset-name').value.trim(); 
    let link = getEl('asset-link').value.trim(); 
    
    // Helper: Chỉ mã hóa nếu có dữ liệu (tránh biến ô trống thành mã loằng ngoằng)
    const enc = (txt) => txt ? encryptText(txt) : '';

    if (!name) return alert("Nhập mô tả tài sản"); 

    // Xử lý link map
    const coords = parseLatLngFromLink(link);
    if (coords && !link.includes('http')) { 
        link = `https://www.google.com/maps?q=$${coords.lat},${coords.lng}`; 
    }

    if (!currentCustomerData.assets) currentCustomerData.assets = []; 

    // --- SỬA LỖI TẠI ĐÂY: Dùng hàm enc() đã viết ở trên ---
    const assetObj = { 
        name: enc(name), 
        link: enc(link), 
        valuation: enc(getEl('asset-val').value), 
        loanValue: enc(getEl('asset-loan').value), 
        area: enc(getEl('asset-area').value), 
        width: enc(getEl('asset-width').value), 
        onland: enc(getEl('asset-onland').value), 
        year: enc(getEl('asset-year').value),
        ocrData: enc(getEl('asset-ocr-data').value)
    };

    const index = getEl('edit-asset-index').value; 
    if (index !== "") { 
        // Cập nhật tài sản cũ
        const i = parseInt(index); 
        assetObj.id = currentCustomerData.assets[i].id; 
        assetObj.createdAt = currentCustomerData.assets[i].createdAt; 
        if(currentCustomerData.assets[i].driveLink) assetObj.driveLink = currentCustomerData.assets[i].driveLink;
        currentCustomerData.assets[i] = assetObj; 
    } else { 
        // Thêm mới
        assetObj.id = currentAssetId || ('asset_' + Date.now()); 
        assetObj.createdAt = Date.now(); 
        currentCustomerData.assets.push(assetObj); 
    } 
    
    // Lưu vào DB
    db.transaction(['customers'],'readwrite').objectStore('customers').put(currentCustomerData).onsuccess = () => { 
        closeAssetModal(); 
        renderAssets(); 
        showToast("Đã lưu TSBĐ"); 
        currentAssetId = null; 
    }; 
}
        function loadImagesFiltered(filterFn, targetId = 'content-images') {
            db.transaction(['images'], 'readonly').objectStore('images').index('customerId').getAll(currentCustomerId).onsuccess = e => {
                let imgs = e.target.result || []; imgs = imgs.filter(filterFn); imgs.sort((a,b) => b.createdAt - a.createdAt);
                if (targetId === 'content-images' && !getEl('screen-asset-gallery').classList.contains('translate-x-full')) { } else { currentLightboxList = imgs; }
                const grid = getEl(targetId); if(!grid) return; grid.innerHTML = '';
                if (imgs.length === 0) { grid.innerHTML = `<div class="col-span-3 text-center py-10 opacity-40 text-sm">Chưa có ảnh</div>`; return; }
                const svgCheck = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                imgs.forEach((img, idx) => {
                    const div = document.createElement('div'); div.className = "img-wrapper cursor-pointer transition-all active:scale-[0.98]";
                    if(isSelectionMode && selectedImages.has(img.id)) div.classList.add('selected');
                    const ringHtml = isSelectionMode ? `<div class="select-ring">${svgCheck}</div>` : '';
                    div.innerHTML = `<img src="${img.data}" class="pointer-events-none">${ringHtml}`;
                    div.onclick = () => { if(isSelectionMode) toggleImage(img.id, div); else openLightbox(img.data, img.id, idx, imgs); }; grid.appendChild(div);
                });
            };
        }
        function loadProfileImages() { loadImagesFiltered(img => !img.assetId); }
        function loadAssetImages(id) { 
            db.transaction(['images'], 'readonly').objectStore('images').index('customerId').getAll(currentCustomerId).onsuccess = e => {
                let imgs = e.target.result || []; imgs = imgs.filter(img => img.assetId === id); imgs.sort((a,b) => b.createdAt - a.createdAt); currentLightboxList = imgs; 
                const grid = getEl('asset-gallery-grid'); grid.innerHTML = '';
                if (imgs.length === 0) { grid.innerHTML = `<div class="col-span-3 text-center py-10 opacity-40 text-sm">Chưa có ảnh</div>`; return; }
                const svgCheck = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                imgs.forEach((img, idx) => {
                     const div = document.createElement('div'); div.className = "img-wrapper cursor-pointer transition-all active:scale-[0.98]";
                    if(isSelectionMode && selectedImages.has(img.id)) div.classList.add('selected');
                    const ringHtml = isSelectionMode ? `<div class="select-ring">${svgCheck}</div>` : '';
                    div.innerHTML = `<img src="${img.data}" class="pointer-events-none">${ringHtml}`;
                    div.onclick = () => { if(isSelectionMode) toggleImage(img.id, div); else openLightbox(img.data, img.id, idx, imgs); }; grid.appendChild(div);
                });
            }
        }
function saveImageToDB(rawBase64) { 
    return new Promise(async (resolve) => {
        if (!currentCustomerId) { resolve(); return; }
        
        // Kiểm tra xem đang ở modal asset không
        if (getEl('asset-modal') && !getEl('asset-modal').classList.contains('hidden')) {
            captureMode = 'asset';
        }

        getEl('loader').classList.remove('hidden'); 
        getEl('loader-text').textContent = "Xử lý ảnh...";
        
        // Không xử lý làm nét hoặc OCR nữa, sử dụng trực tiếp ảnh gốc
        const enhancedBase64 = rawBase64;

        getEl('loader-text').textContent = "Đang lưu ảnh...";
        
        // Nén và Lưu vào Database
        compressImage(enhancedBase64, (compressed) => { 
            const newImg = { 
                id: 'img_' + Date.now() + Math.random(), 
                customerId: currentCustomerId, 
                assetId: currentAssetId, 
                data: compressed, 
                createdAt: Date.now() 
            }; 
            
            db.transaction(['images'], 'readwrite').objectStore('images').add(newImg).onsuccess = () => { 
                getEl('loader').classList.add('hidden'); 
                showToast("Đã lưu ảnh"); 

                // Refresh giao diện ngay lập tức
                if (currentAssetId && !getEl('screen-asset-gallery').classList.contains('translate-x-full')) {
                    loadAssetImages(currentAssetId);
                } else if (captureMode === 'asset' && currentAssetId) {
                    loadAssetImages(currentAssetId);
                } else {
                    loadProfileImages();
                }

                resolve(); 
            }; 
        }); 
    });
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
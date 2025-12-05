/* database.js - Quản lý Dữ liệu */

function loadCustomers(query = '') {
    if (!db) return;
    const tx = db.transaction(['customers'], 'readonly');
    tx.objectStore('customers').getAll().onsuccess = (e) => {
        let list = e.target.result || [];
        list.forEach(c => {
            if (!c.assets) c.assets = [];
            if (!c.status) c.status = 'pending';
            decryptCustomerObject(c);
        });
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

function openFolder(id) {
    currentCustomerId = id;
    getEl('screen-folder').classList.remove('translate-x-full');
    const tx = db.transaction(['customers'], 'readonly');
    tx.objectStore('customers').get(id).onsuccess = (e) => {
        currentCustomerData = e.target.result;
        if (!currentCustomerData) return;
        decryptCustomerObject(currentCustomerData);
        if (!currentCustomerData.status) currentCustomerData.status = 'pending';
        if (!currentCustomerData.assets) currentCustomerData.assets = [];
        renderFolderHeader(currentCustomerData);
        if (typeof renderDriveStatus === "function") renderDriveStatus(currentCustomerData.driveLink || null);
        isSelectionMode = false; selectedImages.clear(); updateSelectionUI();
        switchTab('images'); renderAssets();
    };
}

function openAssetGallery(id, name, idx) {
    if (!id || id === 'undefined') {
        id = 'asset_' + Date.now();
        if(currentCustomerData.assets[idx]) {
            currentCustomerData.assets[idx].id = id;
            db.transaction(['customers'], 'readwrite').objectStore('customers').put(currentCustomerData);
        }
    }
    currentAssetId = id;
    getEl('screen-asset-gallery').classList.remove('translate-x-full');
    const asset = currentCustomerData.assets[idx];
    if (asset) {
        getEl('gallery-asset-name').textContent = decryptText(asset.name);
        getEl('gallery-asset-val').textContent = decryptText(asset.valuation) || '--';
        getEl('gallery-asset-loan').textContent = decryptText(asset.loanValue) || '--';
        if (typeof renderAssetDriveStatus === "function") renderAssetDriveStatus(asset.driveLink);
    } else {
        getEl('gallery-asset-name').textContent = name;
        getEl('gallery-asset-val').textContent = '--';
        getEl('gallery-asset-loan').textContent = '--';
        if (typeof renderAssetDriveStatus === "function") renderAssetDriveStatus(null);
    }
    loadAssetImages(id);
}

function saveCustomer() {
    const id = getEl('edit-cust-id').value;
    const name = getEl('new-name').value.trim();
    const phone = getEl('new-phone').value.trim();
    const cccd = getEl('new-cccd') ? getEl('new-cccd').value.trim() : '';
    const encName = encryptText(name); const encPhone = encryptText(phone); const encCccd = encryptText(cccd);
    if (!name || !phone) return alert("Vui lòng nhập đầy đủ Tên và SĐT!");

    const tx = db.transaction(['customers'], 'readwrite');
    const store = tx.objectStore('customers');
    if (id) {
        store.get(id).onsuccess = (e) => {
            const data = e.target.result;
            if (data) { data.name = encName; data.phone = encPhone; data.cccd = encCccd; store.put(data); }
        };
    } else {
        const newCust = { id: 'cust_' + Date.now(), name: encName, phone: encPhone, cccd: encCccd, status: 'pending', createdAt: Date.now(), assets: [], driveLink: null };
        store.add(newCust);
    }
    tx.oncomplete = () => {
        closeModal(); loadCustomers(getEl('search-input').value);
        if (id && currentCustomerData && currentCustomerData.id === id) {
            getEl('folder-customer-name').textContent = name;
            getEl('folder-avatar').textContent = name.charAt(0).toUpperCase();
            currentCustomerData.name = name; currentCustomerData.phone = phone; currentCustomerData.cccd = cccd;
        }
        showToast(id ? "Đã cập nhật hồ sơ" : "Đã thêm khách hàng mới");
    };
    tx.onerror = () => alert("Lỗi lưu dữ liệu!");
}

function saveAsset() {
    const name = getEl('asset-name').value.trim();
    let link = getEl('asset-link').value.trim();
    const enc = (txt) => txt ? encryptText(txt) : '';
    if (!name) return alert("Nhập mô tả tài sản");
    const coords = parseLatLngFromLink(link);
    if (coords && !link.includes('http')) link = `https://www.google.com/maps?q=$${coords.lat},${coords.lng}`;
    if (!currentCustomerData.assets) currentCustomerData.assets = [];
    const assetObj = { name: enc(name), link: enc(link), valuation: enc(getEl('asset-val').value), loanValue: enc(getEl('asset-loan').value), area: enc(getEl('asset-area').value), width: enc(getEl('asset-width').value), onland: enc(getEl('asset-onland').value), year: enc(getEl('asset-year').value), ocrData: enc(getEl('asset-ocr-data').value) };
    const index = getEl('edit-asset-index').value;
    if (index !== "") {
        const i = parseInt(index); assetObj.id = currentCustomerData.assets[i].id; assetObj.createdAt = currentCustomerData.assets[i].createdAt;
        if(currentCustomerData.assets[i].driveLink) assetObj.driveLink = currentCustomerData.assets[i].driveLink;
        currentCustomerData.assets[i] = assetObj;
    } else {
        assetObj.id = currentAssetId || ('asset_' + Date.now()); assetObj.createdAt = Date.now();
        currentCustomerData.assets.push(assetObj);
    }
    db.transaction(['customers'],'readwrite').objectStore('customers').put(currentCustomerData).onsuccess = () => { closeAssetModal(); renderAssets(); showToast("Đã lưu TSBĐ"); currentAssetId = null; };
}

function deleteCurrentCustomer() {
    if(!confirm("XÁC NHẬN: Xóa toàn bộ hồ sơ khách hàng này?")) return;
    try {
        const tx = db.transaction(['images', 'customers'], 'readwrite'); const imgStore = tx.objectStore('images'); const custStore = tx.objectStore('customers');
        if (imgStore.indexNames.contains('customerId')) { imgStore.index('customerId').getAllKeys(currentCustomerId).onsuccess = (e) => { e.target.result.forEach(key => imgStore.delete(key)); }; }
        custStore.delete(currentCustomerId); tx.oncomplete = () => { closeFolder(); showToast("Đã xóa hồ sơ"); loadCustomers(); };
    } catch (err) { window.location.reload(); }
}
function deleteAsset(idx) { if(!confirm("Xóa tài sản này?")) return; currentCustomerData.assets.splice(idx,1); db.transaction(['customers'],'readwrite').objectStore('customers').put(currentCustomerData).onsuccess = () => { showToast("Đã xóa TSBĐ"); renderAssets(); }; }
function deleteSelectedCustomers() {
    if(selectedCustomers.size === 0) return; if(!confirm(`Xóa vĩnh viễn ${selectedCustomers.size} khách hàng?`)) return;
    const tx = db.transaction(['customers', 'images'], 'readwrite'); const custStore = tx.objectStore('customers'); const imgStore = tx.objectStore('images');
    selectedCustomers.forEach(custId => { custStore.delete(custId); imgStore.index('customerId').getAllKeys(custId).onsuccess = e => { e.target.result.forEach(imgId => imgStore.delete(imgId)); }; });
    tx.oncomplete = () => { showToast("Đã xóa"); toggleCustSelectionMode(); };
}
function deleteSelectedImages() { if(!selectedImages.size) return; if(!confirm(`Xóa ${selectedImages.size} ảnh?`)) return; const tx = db.transaction(['images'], 'readwrite'); selectedImages.forEach(id => tx.objectStore('images').delete(id)); tx.oncomplete = () => { showToast("Đã xóa"); toggleSelectionMode(); }; }
function deleteOpenedImage() { if(confirm("Hủy chứng từ này?")) { db.transaction(['images'], 'readwrite').objectStore('images').delete(currentImageId).onsuccess = () => { closeLightbox(); if(currentAssetId && getEl('screen-asset-gallery').classList.contains('translate-x-full') === false) loadAssetImages(currentAssetId); else loadProfileImages(); }; } }

// --- IMAGE HANDLING ---
function saveImageToDB(rawBase64) {
    return new Promise(async (resolve) => {
        if (!currentCustomerId) { resolve(); return; }
        if (getEl('asset-modal') && !getEl('asset-modal').classList.contains('hidden')) captureMode = 'asset';
        getEl('loader').classList.remove('hidden'); getEl('loader-text').textContent = "Đang lưu ảnh...";
        compressImage(rawBase64, (compressed) => {
            const newImg = { id: 'img_' + Date.now() + Math.random(), customerId: currentCustomerId, assetId: currentAssetId, data: compressed, createdAt: Date.now() };
            db.transaction(['images'], 'readwrite').objectStore('images').add(newImg).onsuccess = () => {
                getEl('loader').classList.add('hidden'); showToast("Đã lưu ảnh");
                if (currentAssetId && !getEl('screen-asset-gallery').classList.contains('translate-x-full')) loadAssetImages(currentAssetId);
                else if (captureMode === 'asset' && currentAssetId) loadAssetImages(currentAssetId);
                else loadProfileImages();
                resolve();
            };
        });
    });
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
function compressImage(base64, cb) {
    const img = new Image();
    img.onload = () => {
        let w = img.width, h = img.height; const maxDim = 2200;
        if (w > h && w > maxDim) { h = h * maxDim / w; w = maxDim; } else if (h >= w && h > maxDim) { w = w * maxDim / h; h = maxDim; }
        const cvs = document.createElement('canvas'); cvs.width = Math.round(w); cvs.height = Math.round(h);
        const ctx = cvs.getContext('2d'); ctx.filter = 'contrast(1.03) brightness(1.01)'; ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
        let q = 0.9; const MAX_BYTES = 700 * 1024, MIN_BYTES = 500 * 1024;
        function adjustAndCheck() {
            const dataUrl = cvs.toDataURL('image/jpeg', q); const sizeBytes = Math.floor(dataUrl.length * 0.75);
            if (sizeBytes > MAX_BYTES && q > 0.5) { q -= 0.05; setTimeout(adjustAndCheck, 0); return; }
            if (sizeBytes < MIN_BYTES && q < 0.96) { q += 0.03; setTimeout(adjustAndCheck, 0); return; }
            cb(dataUrl);
        }
        adjustAndCheck();
    };
    img.onerror = () => cb(base64); img.src = base64;
}

// --- BACKUP & RESTORE ---
async function backupSelectedCustomers() {
    if(selectedCustomers.size === 0) return alert("Chưa chọn KH");
    getEl('loader').classList.remove('hidden'); getEl('loader-text').textContent = "Đóng gói...";
    const custIds = Array.from(selectedCustomers); const exportData = { customers: [], images: [] };
    const tx = db.transaction(['customers', 'images'], 'readonly'); const custStore = tx.objectStore('customers'); const imgStore = tx.objectStore('images');
    for(const id of custIds) { const cust = await new Promise(r => { const req = custStore.get(id); req.onsuccess = e => r(e.target.result); req.onerror = () => r(null); }); if(cust) exportData.customers.push(cust); }
    const allImages = await new Promise(r => { const req = imgStore.getAll(); req.onsuccess = e => r(e.target.result || []); req.onerror = () => r([]); });
    exportData.images = allImages.filter(img => custIds.includes(img.customerId));
    const blob = new Blob([JSON.stringify({v:1.0, ...exportData})], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `QLKH_Export_${selectedCustomers.size}_KH.json`; a.click();
    getEl('loader').classList.add('hidden'); toggleCustSelectionMode();
}
async function backupData() { 
    if (!APP_BACKUP_SECRET) return alert("BẢO MẬT: Không thể xuất file khi đang Offline hoặc chưa xác thực với Server.");
    toggleMenu(); getEl('loader').classList.remove('hidden'); getEl('loader-text').textContent = "Đóng gói (Bảo mật)...";
    try {
        const customers = await new Promise((r, j) => { const tx = db.transaction(['customers'], 'readonly'); const req = tx.objectStore('customers').getAll(); req.onsuccess = e => r(e.target.result||[]); req.onerror = j; });
        const cleanCustomers = customers.map((c) => {
            const cust = JSON.parse(JSON.stringify(c));
            cust.name = decryptText(cust.name); cust.phone = decryptText(cust.phone); cust.cccd = decryptText(cust.cccd); cust.driveLink = null;
            if (cust.assets && Array.isArray(cust.assets)) {
                cust.assets = cust.assets.map((a) => {
                    const asset = JSON.parse(JSON.stringify(a));
                    asset.name = decryptText(asset.name); asset.link = decryptText(asset.link); asset.valuation = decryptText(asset.valuation);
                    asset.loanValue = decryptText(asset.loanValue); asset.area = decryptText(asset.area); asset.width = decryptText(asset.width);
                    asset.onland = decryptText(asset.onland); asset.year = decryptText(asset.year); asset.ocrData = decryptText(asset.ocrData); asset.driveLink = null;
                    return asset;
                });
            } return cust;
        });
        const dataToExport = { v: 1.0, customers: cleanCustomers, images: [] };
        const encrypted = CryptoJS.AES.encrypt(JSON.stringify(dataToExport), APP_BACKUP_SECRET).toString();
        const blob = new Blob([encrypted], {type: 'application/json'});
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `ClientPro_Backup_${Date.now()}.cpro`; a.click();
        showToast("Đã xuất file");
    } catch(err) { console.error(err); alert("Lỗi xuất file"); } finally { getEl('loader').classList.add('hidden'); }
}
function restoreData(input) { 
    toggleMenu(); const f = input.files && input.files[0]; if (!f) return;
    getEl('loader').classList.remove('hidden'); getEl('loader-text').textContent = "Đồng bộ...";
    const r = new FileReader(); 
    r.onload = async (e) => { 
        try { 
            let decryptedStr = '';
            try { const bytes = CryptoJS.AES.decrypt(String(e.target.result), APP_BACKUP_SECRET); decryptedStr = bytes.toString(CryptoJS.enc.Utf8); } catch(ex) {}
            if (!decryptedStr) throw new Error("Decryption failed");
            const data = JSON.parse(decryptedStr);
            const tx = db.transaction(['customers', 'images'], 'readwrite');
            const customerStore = tx.objectStore('customers'); const imageStore = tx.objectStore('images');
            const enc = (txt) => (txt && String(txt).trim().length > 0) ? encryptText(txt) : '';
            (data.customers || []).forEach((c) => {
                const cust = JSON.parse(JSON.stringify(c));
                cust.name = enc(cust.name); cust.phone = enc(cust.phone); cust.cccd = enc(cust.cccd);
                if (cust.assets && Array.isArray(cust.assets)) {
                    cust.assets = cust.assets.map((a) => {
                        const asset = JSON.parse(JSON.stringify(a));
                        asset.name = enc(asset.name); asset.link = enc(asset.link); asset.valuation = enc(asset.valuation);
                        asset.loanValue = enc(asset.loanValue); asset.area = enc(asset.area); asset.width = enc(asset.width);
                        asset.onland = enc(asset.onland); asset.year = enc(asset.year); asset.ocrData = enc(asset.ocrData);
                        return asset;
                    });
                }
                customerStore.put(cust);
            });
            (data.images || []).forEach(i => imageStore.put(i));
            tx.oncomplete = () => { getEl('loader').classList.add('hidden'); alert("Đã khôi phục"); loadCustomers(); };
            tx.onerror = () => { getEl('loader').classList.add('hidden'); alert("Lỗi khi ghi vào cơ sở dữ liệu"); };
        } catch(err) { getEl('loader').classList.add('hidden'); alert("File backup không hợp lệ hoặc sai định dạng bảo mật"); } 
    }; r.readAsText(f); 
}
function resetAppData() { if(confirm("XÓA SẠCH dữ liệu?")) { localStorage.clear(); indexedDB.deleteDatabase(DB_NAME).onsuccess = () => { alert("Đã reset."); window.location.reload(); }; } }

// ============================================================
// DATABASE.JS - QUẢN LÝ DỮ LIỆU (INDEXEDDB)
// ============================================================

// --- 1. QUẢN LÝ KHÁCH HÀNG (CUSTOMERS) ---

/**
 * Tải danh sách khách hàng từ DB, giải mã và hiển thị
 */
function loadCustomers(query = '') {
    if (!db) return;
    const tx = db.transaction(['customers'], 'readonly');
    tx.objectStore('customers').getAll().onsuccess = (e) => {
        let list = e.target.result || [];
        
        // Giải mã dữ liệu trước khi lọc/hiển thị
        list.forEach(c => {
            if (!c.assets) c.assets = [];
            if (!c.status) c.status = 'pending';
            // Hàm này nằm trong security.js
            decryptCustomerObject(c);
        });

        // Lọc theo Tab trạng thái (Pending/Approved)
        list = list.filter(c => c.status === activeListTab);

        // Lọc theo từ khóa tìm kiếm
        if (query) {
            const q = query.toLowerCase();
            list = list.filter(c => {
                const nameMatch = (c.name || '').toLowerCase().includes(q);
                const phoneMatch = (c.phone || '').includes(q);
                return nameMatch || phoneMatch;
            });
        }

        // Sắp xếp: Mới nhất lên đầu
        list.sort((a, b) => b.createdAt - a.createdAt);
        
        // Gọi hàm Render bên ui.js
        if (window.renderList) renderList(list);
    };
}

/**
 * Lưu khách hàng (Thêm mới hoặc Cập nhật)
 */
function saveCustomer() {
    const id = getEl('edit-cust-id').value;
    const name = getEl('new-name').value.trim();
    const phone = getEl('new-phone').value.trim();
    const cccd = getEl('new-cccd') ? getEl('new-cccd').value.trim() : '';

    if (!name || !phone) return alert("Vui lòng nhập đầy đủ Tên và SĐT!");

    // Mã hóa dữ liệu trước khi lưu (security.js)
    const encName = encryptText(name);
    const encPhone = encryptText(phone);
    const encCccd = encryptText(cccd);

    const tx = db.transaction(['customers'], 'readwrite');
    const store = tx.objectStore('customers');

    if (id) {
        // Cập nhật
        store.get(id).onsuccess = (e) => {
            const data = e.target.result;
            if (data) {
                data.name = encName;
                data.phone = encPhone;
                data.cccd = encCccd;
                store.put(data);
            }
        };
    } else {
        // Thêm mới
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
        if (window.closeModal) closeModal();
        loadCustomers(getEl('search-input').value);
        
        // Nếu đang mở folder khách này thì cập nhật header
        if (id && currentCustomerData && currentCustomerData.id === id) {
            if (window.renderFolderHeader) {
                // Cập nhật lại object RAM hiện tại để UI hiển thị đúng ngay
                currentCustomerData.name = name;
                currentCustomerData.phone = phone;
                currentCustomerData.cccd = cccd;
                // UI Header
                getEl('folder-customer-name').textContent = name;
                getEl('folder-avatar').textContent = name.charAt(0).toUpperCase();
            }
        }
        showToast(id ? "Đã cập nhật hồ sơ" : "Đã thêm khách hàng mới");
    };
    
    tx.onerror = () => alert("Lỗi lưu dữ liệu!");
}

/**
 * Xóa khách hàng đang mở (Folder)
 */
function deleteCurrentCustomer() { 
    if(!confirm("XÁC NHẬN: Xóa toàn bộ hồ sơ khách hàng này?")) return; 
    
    const tx = db.transaction(['images', 'customers'], 'readwrite'); 
    const imgStore = tx.objectStore('images'); 
    const custStore = tx.objectStore('customers');
    
    // Xóa tất cả ảnh của khách
    if (imgStore.indexNames.contains('customerId')) { 
        imgStore.index('customerId').getAllKeys(currentCustomerId).onsuccess = (e) => { 
            e.target.result.forEach(key => imgStore.delete(key)); 
        }; 
    }
    
    // Xóa thông tin khách
    custStore.delete(currentCustomerId); 
    
    tx.oncomplete = () => { 
        if (window.closeFolder) closeFolder(); 
        showToast("Đã xóa hồ sơ"); 
        loadCustomers(); 
    };
}

/**
 * Xóa nhiều khách hàng đã chọn (Selection Mode)
 */
function deleteSelectedCustomers() {
    if(selectedCustomers.size === 0) return; 
    if(!confirm(`Xóa vĩnh viễn ${selectedCustomers.size} khách hàng?`)) return;
    
    const tx = db.transaction(['customers', 'images'], 'readwrite'); 
    const custStore = tx.objectStore('customers'); 
    const imgStore = tx.objectStore('images');
    
    selectedCustomers.forEach(custId => { 
        custStore.delete(custId); 
        imgStore.index('customerId').getAllKeys(custId).onsuccess = e => { 
            e.target.result.forEach(imgId => imgStore.delete(imgId)); 
        }; 
    });
    
    tx.oncomplete = () => { 
        showToast("Đã xóa"); 
        if(window.toggleCustSelectionMode) toggleCustSelectionMode(); 
    };
}

// --- 2. QUẢN LÝ TÀI SẢN (ASSETS) ---

/**
 * Lưu tài sản (Vào bên trong object Customer)
 */
function saveAsset() { 
    const name = getEl('asset-name').value.trim(); 
    let link = getEl('asset-link').value.trim(); 
    
    if (!name) return alert("Nhập mô tả tài sản"); 

    // Helper mã hóa
    const enc = (txt) => txt ? encryptText(txt) : '';

    // Xử lý link map (Hàm parseLatLngFromLink nằm ở map.js)
    if (window.parseLatLngFromLink) {
        const coords = parseLatLngFromLink(link);
        if (coords && !link.includes('http')) { 
            link = `http://googleusercontent.com/maps.google.com/?q=${coords.lat},${coords.lng}`; 
        }
    }

    if (!currentCustomerData.assets) currentCustomerData.assets = []; 

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
        // Cập nhật
        const i = parseInt(index); 
        // Giữ lại ID và ngày tạo cũ
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
        if(window.closeAssetModal) closeAssetModal(); 
        if(window.renderAssets) renderAssets(); 
        showToast("Đã lưu TSBĐ"); 
        currentAssetId = null; 
    }; 
}

function deleteAsset(idx) { 
    if(!confirm("Xóa tài sản này?")) return; 
    
    // Xóa khỏi mảng assets
    currentCustomerData.assets.splice(idx,1); 
    
    // Lưu lại DB
    db.transaction(['customers'],'readwrite').objectStore('customers').put(currentCustomerData).onsuccess = () => { 
        showToast("Đã xóa TSBĐ"); 
        if(window.renderAssets) renderAssets(); 
    }; 
}

// --- 3. QUẢN LÝ ẢNH (IMAGES) ---

/**
 * Lưu ảnh vào DB (Sau khi chụp/chọn)
 * Hàm này gọi compressImage (ở ui.js) để nén trước khi lưu
 */
function saveImageToDB(rawBase64) { 
    return new Promise(async (resolve) => {
        if (!currentCustomerId) { resolve(); return; }
        
        // Kiểm tra xem đang ở modal asset không
        if (getEl('asset-modal') && !getEl('asset-modal').classList.contains('hidden')) {
            captureMode = 'asset';
        }

        getEl('loader').classList.remove('hidden'); 
        getEl('loader-text').textContent = "Đang xử lý ảnh...";
        
        // Gọi hàm nén ảnh (Nằm bên file ui.js)
        if (window.compressImage) {
            window.compressImage(rawBase64, (compressed) => { 
                saveToStore(compressed);
            });
        } else {
            // Fallback nếu không tìm thấy hàm nén
            saveToStore(rawBase64);
        }

        function saveToStore(data) {
            const newImg = { 
                id: 'img_' + Date.now() + Math.random(), 
                customerId: currentCustomerId, 
                assetId: currentAssetId, // Nếu null -> Ảnh hồ sơ, Có ID -> Ảnh TSBĐ
                data: data, 
                createdAt: Date.now() 
            }; 
            
            db.transaction(['images'], 'readwrite').objectStore('images').add(newImg).onsuccess = () => { 
                getEl('loader').classList.add('hidden'); 
                showToast("Đã lưu ảnh"); 

                // Refresh giao diện
                if (currentAssetId && !getEl('screen-asset-gallery').classList.contains('translate-x-full')) {
                    if(window.loadAssetImages) loadAssetImages(currentAssetId);
                } else if (captureMode === 'asset' && currentAssetId) {
                    if(window.loadAssetImages) loadAssetImages(currentAssetId);
                } else {
                    if(window.loadProfileImages) loadProfileImages();
                }
                resolve(); 
            };
        }
    });
}

/**
 * Load ảnh (Generic)
 */
function loadImagesFiltered(filterFn, targetId = 'content-images') {
    if (!db) return;
    const tx = db.transaction(['images'], 'readonly');
    const store = tx.objectStore('images');
    
    store.index('customerId').getAll(currentCustomerId).onsuccess = e => {
        let imgs = e.target.result || [];
        // Lọc theo điều kiện (Hồ sơ hay Tài sản)
        imgs = imgs.filter(filterFn);
        // Sắp xếp mới nhất trước
        imgs.sort((a,b) => b.createdAt - a.createdAt);
        
        // Cập nhật danh sách Lightbox nếu không phải đang xem Gallery
        if (targetId === 'content-images' && !getEl('screen-asset-gallery').classList.contains('translate-x-full')) { 
            // Do nothing logic phức tạp
        } else { 
            currentLightboxList = imgs; 
        }
        
        // Render
        const grid = getEl(targetId); 
        if(!grid) return; 
        grid.innerHTML = '';
        
        if (imgs.length === 0) { 
            grid.innerHTML = `<div class="col-span-3 text-center py-10 opacity-40 text-sm">Chưa có ảnh</div>`; 
            return; 
        }
        
        const svgCheck = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        
        imgs.forEach((img, idx) => {
            const div = document.createElement('div'); 
            div.className = "img-wrapper cursor-pointer transition-all active:scale-[0.98]";
            
            if(isSelectionMode && selectedImages.has(img.id)) div.classList.add('selected');
            
            const ringHtml = isSelectionMode ? `<div class="select-ring">${svgCheck}</div>` : '';
            div.innerHTML = `<img src="${img.data}" class="pointer-events-none">${ringHtml}`;
            
            div.onclick = () => { 
                if(isSelectionMode) {
                    if(window.toggleImage) toggleImage(img.id, div);
                } else { 
                    // Mở Lightbox (ui.js)
                    if(window.openLightbox) openLightbox(img.data, img.id, idx, imgs); 
                } 
            }; 
            grid.appendChild(div);
        });
    };
}

function loadProfileImages() { 
    // Lọc ảnh không có assetId
    loadImagesFiltered(img => !img.assetId); 
}

function loadAssetImages(id) { 
    // Lọc ảnh có assetId trùng khớp
    db.transaction(['images'], 'readonly').objectStore('images').index('customerId').getAll(currentCustomerId).onsuccess = e => {
        let imgs = e.target.result || []; 
        imgs = imgs.filter(img => img.assetId === id); 
        imgs.sort((a,b) => b.createdAt - a.createdAt); 
        currentLightboxList = imgs; 
        
        const grid = getEl('asset-gallery-grid'); 
        if(!grid) return;
        grid.innerHTML = '';
        
        if (imgs.length === 0) { 
            grid.innerHTML = `<div class="col-span-3 text-center py-10 opacity-40 text-sm">Chưa có ảnh</div>`; 
            return; 
        }
        
        const svgCheck = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        
        imgs.forEach((img, idx) => {
                const div = document.createElement('div'); 
                div.className = "img-wrapper cursor-pointer transition-all active:scale-[0.98]";
            if(isSelectionMode && selectedImages.has(img.id)) div.classList.add('selected');
            const ringHtml = isSelectionMode ? `<div class="select-ring">${svgCheck}</div>` : '';
            div.innerHTML = `<img src="${img.data}" class="pointer-events-none">${ringHtml}`;
            div.onclick = () => { 
                if(isSelectionMode) {
                    if(window.toggleImage) toggleImage(img.id, div);
                } else { 
                    if(window.openLightbox) openLightbox(img.data, img.id, idx, imgs); 
                } 
            }; 
            grid.appendChild(div);
        });
    };
}

function deleteSelectedImages() { 
    if(!selectedImages.size) return; 
    if(!confirm(`Xóa ${selectedImages.size} ảnh?`)) return; 
    
    const tx = db.transaction(['images'], 'readwrite'); 
    selectedImages.forEach(id => tx.objectStore('images').delete(id)); 
    
    tx.oncomplete = () => { 
        showToast("Đã xóa"); 
        if(window.toggleSelectionMode) toggleSelectionMode(); 
    }; 
}

function deleteOpenedImage() { 
    if(confirm("Hủy chứng từ này?")) { 
        db.transaction(['images'], 'readwrite').objectStore('images').delete(currentImageId).onsuccess = () => { 
            if(window.closeLightbox) closeLightbox(); 
            // Refresh lại grid
            if(currentAssetId && !getEl('screen-asset-gallery').classList.contains('translate-x-full')) {
                loadAssetImages(currentAssetId); 
            } else {
                loadProfileImages(); 
            }
        }; 
    } 
}

// --- 4. TRẠNG THÁI & PHÊ DUYỆT ---

function toggleCustomerStatus() { 
    if (currentCustomerData.status === 'pending') { 
        getEl('approve-modal').classList.remove('hidden'); 
        getEl('approve-limit').value = ''; 
    } else { 
        if(confirm("Thu hồi trạng thái?")) { 
            currentCustomerData.status = 'pending'; 
            updateCustomerAndReload(); 
        } 
    } 
}

function confirmApproval() { 
    const l = getEl('approve-limit').value; 
    if(!l) return alert("Nhập hạn mức!"); 
    currentCustomerData.status = 'approved'; 
    currentCustomerData.creditLimit = l; 
    
    if(window.closeApproveModal) closeApproveModal(); 
    
    db.transaction(['customers'], 'readwrite').objectStore('customers').put(currentCustomerData).onsuccess = () => { 
        showToast("Đã duyệt"); 
        if(window.renderFolderHeader) renderFolderHeader(currentCustomerData); 
        loadCustomers(getEl('search-input').value); 
    }; 
}

function updateCustomerAndReload() { 
    db.transaction(['customers'], 'readwrite').objectStore('customers').put(currentCustomerData).onsuccess = () => { 
        if(window.openFolder) openFolder(currentCustomerData.id); 
        loadCustomers(); 
    }; 
}

// --- 5. BACKUP & EXPORT ---

async function backupSelectedCustomers() {
    if(selectedCustomers.size === 0) return alert("Chưa chọn KH");
    
    getEl('loader').classList.remove('hidden'); 
    getEl('loader-text').textContent = "Đóng gói...";
    
    const custIds = Array.from(selectedCustomers); 
    const exportData = { customers: [], images: [] };
    
    const tx = db.transaction(['customers', 'images'], 'readonly'); 
    const custStore = tx.objectStore('customers'); 
    const imgStore = tx.objectStore('images');
    
    // Lấy khách hàng
    for(const id of custIds) { 
        const cust = await new Promise(r => { 
            const req = custStore.get(id); 
            req.onsuccess = e => r(e.target.result); 
            req.onerror = () => r(null); 
        }); 
        if(cust) exportData.customers.push(cust); 
    }
    
    // Lấy ảnh
    const allImages = await new Promise(r => { 
        const req = imgStore.getAll(); 
        req.onsuccess = e => r(e.target.result || []); 
        req.onerror = () => r([]); 
    });
    exportData.images = allImages.filter(img => custIds.includes(img.customerId));
    
    // Tạo file tải về
    const blob = new Blob([JSON.stringify({v:1.0, ...exportData})], {type:'application/json'});
    const a = document.createElement('a'); 
    a.href = URL.createObjectURL(blob); 
    a.download = `QLKH_Export_${selectedCustomers.size}_KH.json`; 
    a.click();
    
    getEl('loader').classList.add('hidden'); 
    if(window.toggleCustSelectionMode) toggleCustSelectionMode();
}

/**
 * Backup toàn bộ data (Đã mã hóa)
 */
async function backupData() { 
    if (!APP_BACKUP_SECRET) {
        alert("BẢO MẬT: Không thể xuất file khi đang Offline.\nVui lòng kết nối mạng để tải khóa bảo mật.");
        return;
    }
    
    if(window.toggleMenu) toggleMenu(); 
    getEl('loader').classList.remove('hidden');
    getEl('loader-text').textContent = "Đóng gói (Bảo mật)...";
    
    try {
        const customers = await new Promise((resolve, reject) => {
            const tx = db.transaction(['customers'], 'readonly');
            const req = tx.objectStore('customers').getAll();
            req.onsuccess = (e) => resolve(e.target.result || []);
            req.onerror = (e) => reject(e);
        });

        // Chuẩn hoá dữ liệu: giải mã -> đóng gói -> mã hóa lại bằng key backup
        const cleanCustomers = customers.map((c) => {
            const cust = JSON.parse(JSON.stringify(c));
            // Giải mã
            cust.name = decryptText(cust.name);
            cust.phone = decryptText(cust.phone);
            cust.cccd = decryptText(cust.cccd);
            cust.driveLink = null; // Bỏ link drive khi backup file offline

            if (cust.assets) {
                cust.assets = cust.assets.map((a) => {
                    const asset = JSON.parse(JSON.stringify(a));
                    asset.name = decryptText(asset.name);
                    asset.link = decryptText(asset.link);
                    asset.valuation = decryptText(asset.valuation);
                    asset.loanValue = decryptText(asset.loanValue);
                    asset.area = decryptText(asset.area);
                    asset.width = decryptText(asset.width);
                    asset.onland = decryptText(asset.onland);
                    asset.year = decryptText(asset.year);
                    asset.ocrData = decryptText(asset.ocrData);
                    asset.driveLink = null;
                    return asset;
                });
            }
            return cust;
        });

        const dataToExport = {
            v: 1.0,
            customers: cleanCustomers,
            images: [] // Không backup ảnh để file nhẹ
        };

        // Mã hóa bằng APP_BACKUP_SECRET (Key từ Server)
        const encrypted = CryptoJS.AES.encrypt(JSON.stringify(dataToExport), APP_BACKUP_SECRET).toString();

        const blob = new Blob([encrypted], {type: 'application/json'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ClientPro_Backup_${Date.now()}.cpro`;
        a.click();

        showToast("Đã xuất file");
    } catch(err) {
        console.error(err);
        alert("Lỗi xuất file");
    } finally {
        getEl('loader').classList.add('hidden');
    }
}

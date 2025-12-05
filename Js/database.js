/**
 * DATABASE.JS
 * Quản lý kết nối IndexedDB, các thao tác CRUD và xử lý dữ liệu ảnh.
 * Phụ thuộc: config.js, security.js
 */

// --- GLOBAL STATE VARIABLES ---
let db; // Đối tượng CSDL
let currentCustomerId = null;
let currentCustomerData = null;
let currentAssetId = null;

// Biến trạng thái UI liên quan đến dữ liệu (cần thiết cho bộ lọc)
let activeListTab = 'pending'; 
let isSelectionMode = false;
let selectedImages = new Set();
let isCustSelectionMode = false;
let selectedCustomers = new Set();
let captureMode = 'profile'; // 'profile' hoặc 'asset'

// --- INIT DATABASE ---
function initDatabase() {
    const req = indexedDB.open(DB_NAME, 3);
    
    req.onupgradeneeded = e => { 
        db = e.target.result; 
        if(!db.objectStoreNames.contains('customers')) {
            db.createObjectStore('customers', {keyPath:'id'});
        }
        
        let imgStore;
        if(!db.objectStoreNames.contains('images')) {
            imgStore = db.createObjectStore('images', {keyPath:'id'});
        } else {
            imgStore = e.target.transaction.objectStore('images');
        }
        
        if(!imgStore.indexNames.contains('customerId')) {
            imgStore.createIndex('customerId', 'customerId', {unique: false});
        }
    };

    req.onsuccess = e => { 
        db = e.target.result; 
        // Sau khi DB sẵn sàng, tải dữ liệu và check bảo mật
        // Lưu ý: Các hàm UI (getEl, showToast...) sẽ được định nghĩa ở ui.js
        if (typeof loadCustomers === 'function') loadCustomers(); 
        if (getEl('loader')) getEl('loader').classList.add('hidden'); 
        if (typeof checkSecurity === 'function') checkSecurity(); 
    };

    req.onerror = e => {
        console.error("IndexedDB Error:", e);
        alert("Lỗi không thể mở cơ sở dữ liệu!");
    };
}

// --- CUSTOMER CRUD OPERATIONS ---

function loadCustomers(query = '') {
    if (!db) return;
    const tx = db.transaction(['customers'], 'readonly');
    tx.objectStore('customers').getAll().onsuccess = (e) => {
        let list = e.target.result || [];
        
        // Giải mã dữ liệu
        list.forEach(c => {
            if (!c.assets) c.assets = [];
            if (!c.status) c.status = 'pending';
            decryptCustomerObject(c);
        });

        // Lọc theo tab trạng thái (activeListTab định nghĩa ở đầu file)
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
        
        // Gọi hàm render UI (Sẽ có trong ui.js)
        if (typeof renderList === 'function') renderList(list);
    };
}

function saveCustomer() {
    const id = getEl('edit-cust-id').value;
    const name = getEl('new-name').value.trim();
    const phone = getEl('new-phone').value.trim();
    const cccd = getEl('new-cccd') ? getEl('new-cccd').value.trim() : '';

    // Mã hóa dữ liệu trước khi lưu
    const encName = encryptText(name);
    const encPhone = encryptText(phone);
    const encCccd = encryptText(cccd);

    if (!name || !phone) return alert("Vui lòng nhập đầy đủ Tên và SĐT!");

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
        // Tạo mới
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
        if (typeof closeModal === 'function') closeModal();
        loadCustomers(getEl('search-input').value);
        
        // Cập nhật header nếu đang mở folder khách đó
        if (id && currentCustomerData && currentCustomerData.id === id) {
            getEl('folder-customer-name').textContent = name;
            getEl('folder-avatar').textContent = name.charAt(0).toUpperCase();
            currentCustomerData.name = name; // Update bộ nhớ tạm (đã giải mã)
            currentCustomerData.phone = phone;
            currentCustomerData.cccd = cccd;
        }
        showToast(id ? "Đã cập nhật hồ sơ" : "Đã thêm khách hàng mới");
    };
    
    tx.onerror = () => alert("Lỗi lưu dữ liệu!");
}

function deleteCurrentCustomer() { 
    if(!confirm("XÁC NHẬN: Xóa toàn bộ hồ sơ khách hàng này?")) return; 
    try {
        const tx = db.transaction(['images', 'customers'], 'readwrite'); 
        const imgStore = tx.objectStore('images'); 
        const custStore = tx.objectStore('customers');
        
        // Xóa ảnh liên quan
        if (imgStore.indexNames.contains('customerId')) { 
            imgStore.index('customerId').getAllKeys(currentCustomerId).onsuccess = (e) => { 
                e.target.result.forEach(key => imgStore.delete(key)); 
            }; 
        }
        // Xóa khách hàng
        custStore.delete(currentCustomerId); 
        
        tx.oncomplete = () => { 
            if (typeof closeFolder === 'function') closeFolder(); 
            showToast("Đã xóa hồ sơ"); 
            loadCustomers(); 
        };
    } catch (err) { 
        console.error(err);
        window.location.reload(); 
    }
}

// --- ASSET CRUD OPERATIONS ---

function saveAsset() { 
    const name = getEl('asset-name').value.trim(); 
    let link = getEl('asset-link').value.trim(); 
    const enc = (txt) => txt ? encryptText(txt) : ''; // Helper mã hóa

    if (!name) return alert("Nhập mô tả tài sản"); 

    // Auto-fix link map nếu dán tọa độ thô
    if (typeof parseLatLngFromLink === 'function') {
        const coords = parseLatLngFromLink(link);
        if (coords && !link.includes('http')) { 
            link = `https://www.google.com/maps?q=${coords.lat},${coords.lng}`; 
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
        // Update
        const i = parseInt(index); 
        assetObj.id = currentCustomerData.assets[i].id; 
        assetObj.createdAt = currentCustomerData.assets[i].createdAt; 
        if(currentCustomerData.assets[i].driveLink) assetObj.driveLink = currentCustomerData.assets[i].driveLink;
        currentCustomerData.assets[i] = assetObj; 
    } else { 
        // Create new
        assetObj.id = currentAssetId || ('asset_' + Date.now()); 
        assetObj.createdAt = Date.now(); 
        currentCustomerData.assets.push(assetObj); 
    } 
    
    // Put cập nhật lại toàn bộ object khách hàng
    db.transaction(['customers'],'readwrite').objectStore('customers').put(currentCustomerData).onsuccess = () => { 
        if (typeof closeAssetModal === 'function') closeAssetModal(); 
        if (typeof renderAssets === 'function') renderAssets(); 
        showToast("Đã lưu TSBĐ"); 
        currentAssetId = null; 
    }; 
}

function deleteAsset(idx) { 
    if(!confirm("Xóa tài sản này?")) return; 
    currentCustomerData.assets.splice(idx,1); 
    db.transaction(['customers'],'readwrite').objectStore('customers').put(currentCustomerData).onsuccess = () => { 
        showToast("Đã xóa TSBĐ"); 
        if (typeof renderAssets === 'function') renderAssets(); 
    }; 
}

// --- IMAGE HANDLING & COMPRESSION ---

function compressImage(base64, cb) {
    const img = new Image();
    img.onload = () => {
        let w = img.width;
        let h = img.height;
        const maxDim = 2200; // Giới hạn kích thước để đảm bảo OCR vẫn tốt
        
        if (w > h && w > maxDim) { h = h * maxDim / w; w = maxDim; } 
        else if (h >= w && h > maxDim) { w = w * maxDim / h; h = maxDim; }
        
        const cvs = document.createElement('canvas');
        cvs.width = Math.round(w);
        cvs.height = Math.round(h);
        const ctx = cvs.getContext('2d');
        
        ctx.filter = 'contrast(1.03) brightness(1.01)'; // Tăng nhẹ độ nét
        ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
        
        // Logic giảm chất lượng thông minh để đạt target size 500-700KB
        let q = 0.9;
        const MAX_BYTES = 700 * 1024;
        const MIN_BYTES = 500 * 1024;
        
        function adjustAndCheck() {
            const dataUrl = cvs.toDataURL('image/jpeg', q);
            const sizeBytes = Math.floor(dataUrl.length * 0.75);
            
            if (sizeBytes > MAX_BYTES && q > 0.5) {
                q -= 0.05; setTimeout(adjustAndCheck, 0); return;
            }
            if (sizeBytes < MIN_BYTES && q < 0.96) {
                q += 0.03; setTimeout(adjustAndCheck, 0); return;
            }
            cb(dataUrl);
        }
        adjustAndCheck();
    };
    img.onerror = () => cb(base64); // Fallback nếu lỗi
    img.src = base64;
}

function saveImageToDB(rawBase64) { 
    return new Promise(async (resolve) => {
        if (!currentCustomerId) { resolve(); return; }
        
        // Xác định context (đang chụp cho asset hay profile)
        if (getEl('asset-modal') && !getEl('asset-modal').classList.contains('hidden')) {
            captureMode = 'asset';
        }

        if (getEl('loader')) {
            getEl('loader').classList.remove('hidden'); 
            getEl('loader-text').textContent = "Đang xử lý & Lưu ảnh...";
        }
        
        compressImage(rawBase64, (compressed) => { 
            const newImg = { 
                id: 'img_' + Date.now() + Math.random(), 
                customerId: currentCustomerId, 
                assetId: currentAssetId, // Nếu null thì là ảnh hồ sơ
                data: compressed, 
                createdAt: Date.now() 
            }; 
            
            db.transaction(['images'], 'readwrite').objectStore('images').add(newImg).onsuccess = () => { 
                if (getEl('loader')) getEl('loader').classList.add('hidden'); 
                showToast("Đã lưu ảnh"); 

                // Refresh UI tương ứng
                if (currentAssetId && !getEl('screen-asset-gallery').classList.contains('translate-x-full')) {
                    if (typeof loadAssetImages === 'function') loadAssetImages(currentAssetId);
                } else if (captureMode === 'asset' && currentAssetId) {
                    if (typeof loadAssetImages === 'function') loadAssetImages(currentAssetId);
                } else {
                    if (typeof loadProfileImages === 'function') loadProfileImages();
                }
                resolve(); 
            }; 
        }); 
    });
}

function deleteSelectedImages() { 
    if(!selectedImages.size) return; 
    if(!confirm(`Xóa ${selectedImages.size} ảnh?`)) return; 
    
    const tx = db.transaction(['images'], 'readwrite'); 
    selectedImages.forEach(id => tx.objectStore('images').delete(id)); 
    
    tx.oncomplete = () => { 
        showToast("Đã xóa"); 
        if (typeof toggleSelectionMode === 'function') toggleSelectionMode(); 
    }; 
}

// --- BACKUP & RESTORE ---

async function backupData() { 
    if (!APP_BACKUP_SECRET) {
        return alert("BẢO MẬT: Cần kết nối mạng để tải khóa bảo mật trước khi backup.");
    }
    if (typeof toggleMenu === 'function') toggleMenu(); 
    getEl('loader').classList.remove('hidden');
    getEl('loader-text').textContent = "Đóng gói (Bảo mật)...";

    try {
        const tx = db.transaction(['customers'], 'readonly');
        const customers = await new Promise((resolve, reject) => {
            const req = tx.objectStore('customers').getAll();
            req.onsuccess = (e) => resolve(e.target.result || []);
            req.onerror = (e) => reject(e);
        });

        // Chuẩn hoá dữ liệu (Decrypt -> Clean -> Encrypt All)
        const cleanCustomers = customers.map((c) => {
            const cust = JSON.parse(JSON.stringify(c));
            decryptCustomerObject(cust); // Giải mã về plain text
            cust.driveLink = null; // Bỏ link drive (riêng tư)
            
            if (cust.assets) {
                cust.assets.forEach(a => a.driveLink = null);
            }
            return cust;
        });

        const dataToExport = {
            v: 1.0,
            customers: cleanCustomers,
            images: [] // Không backup ảnh để file nhẹ
        };

        // Mã hóa file backup bằng Secret Key của Server
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

function restoreData(input) { 
    if (typeof toggleMenu === 'function') toggleMenu(); 
    const f = input.files && input.files[0]; 
    if (!f) return;

    getEl('loader').classList.remove('hidden'); 
    getEl('loader-text').textContent = "Đồng bộ...";
    
    const r = new FileReader(); 
    r.onload = async (e) => { 
        try { 
            const encryptedContent = e.target.result;
            let decryptedStr = '';
            try {
                const bytes = CryptoJS.AES.decrypt(String(encryptedContent), APP_BACKUP_SECRET);
                decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
            } catch(ex) {}

            if (!decryptedStr) throw new Error("Decryption failed");

            const data = JSON.parse(decryptedStr);
            const tx = db.transaction(['customers', 'images'], 'readwrite');
            const customerStore = tx.objectStore('customers');
            const imageStore = tx.objectStore('images');
            const enc = (txt) => (txt && String(txt).trim().length > 0) ? encryptText(txt) : '';

            (data.customers || []).forEach((c) => {
                // Mã hóa lại bằng Key hiện tại của máy này
                const cust = JSON.parse(JSON.stringify(c));
                cust.name = enc(cust.name);
                cust.phone = enc(cust.phone);
                cust.cccd = enc(cust.cccd);
                
                if (cust.assets) {
                    cust.assets.forEach(a => {
                        a.name = enc(a.name);
                        a.link = enc(a.link);
                        a.valuation = enc(a.valuation);
                        a.loanValue = enc(a.loanValue);
                        a.area = enc(a.area);
                        a.width = enc(a.width);
                        a.onland = enc(a.onland);
                        a.year = enc(a.year);
                        a.ocrData = enc(a.ocrData);
                    });
                }
                customerStore.put(cust);
            });

            tx.oncomplete = () => { 
                getEl('loader').classList.add('hidden'); 
                alert("Đã khôi phục"); 
                loadCustomers(); 
            };
        } catch(err) { 
            getEl('loader').classList.add('hidden'); 
            alert("File backup lỗi hoặc sai khóa bảo mật!"); 
        } 
    }; 
    r.readAsText(f); 
}

function resetAppData() { 
    if(confirm("XÓA SẠCH dữ liệu?")) { 
        localStorage.clear(); 
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => { alert("Đã reset."); window.location.reload(); };
        req.onerror = () => { alert("Lỗi xóa DB"); };
    } 
}

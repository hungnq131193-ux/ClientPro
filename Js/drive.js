/* drive.js - Drive API & Weather */

function saveScriptUrl() {
    const url = getEl('user-script-url').value.trim();
    if (!url.startsWith('https://script.google.com/')) { alert("Link không đúng định dạng!"); return; }
    localStorage.setItem(USER_SCRIPT_KEY, url);
    showToast("Đã lưu kết nối Drive cá nhân");
}

function initWeather() {
    const cacheRaw = localStorage.getItem(WEATHER_STORAGE_KEY);
    if (cacheRaw) {
        try { const cache = JSON.parse(cacheRaw); if (Date.now() - cache.time < WEATHER_CACHE_TTL) renderWeather(cache.data); } catch (e) { console.warn('Weather cache error', e); }
    }
    refreshWeather();
}

function refreshWeather() {
    if (!navigator.geolocation) { setWeatherText('Thiết bị không hỗ trợ GPS'); return; }
    setWeatherText('Đang lấy vị trí...');
    navigator.geolocation.getCurrentPosition(
        (pos) => { fetchWeather(pos.coords.latitude, pos.coords.longitude); },
        (err) => { setWeatherText('Không lấy được GPS'); }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 5 * 60 * 1000 }
    );
}
function setWeatherText(text) { const el = getEl('current-weather'); if (el) el.textContent = text; }
function fetchWeather(lat, lon) {
    setWeatherText('Đang tải thời tiết...');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`;
    fetch(url).then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); }).then(data => {
        try { localStorage.setItem(WEATHER_STORAGE_KEY, JSON.stringify({ time: Date.now(), data })); } catch (e) {}
        renderWeather(data);
    }).catch(err => { setWeatherText('Lỗi tải thời tiết'); });
}
function renderWeather(apiData) {
    if (!apiData || !apiData.current_weather) { setWeatherText('Không có dữ liệu'); return; }
    const cw = apiData.current_weather;
    const desc = WEATHER_CODE_TEXT[cw.weathercode] || 'Thời tiết hiện tại';
    setWeatherText(`${Math.round(cw.temperature)}°C • ${desc}`);
}

async function uploadToGoogleDrive() {
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if (!userUrl || userUrl.length < 10) { if (confirm("Bạn chưa cấu hình nơi lưu ảnh cá nhân! Bấm OK để vào Cài đặt nhập Link Script của bạn.")) toggleMenu(); return; }
    const scriptUrl = userUrl;
    if (!currentCustomerData) return;
    getEl('loader').classList.remove('hidden'); getEl('loader-text').textContent = "Đang kiểm tra ảnh...";
    const tx = db.transaction(['images'], 'readonly');
    const index = tx.objectStore('images').index('customerId');
    index.getAll(currentCustomerId).onsuccess = async (e) => {
        let allImages = e.target.result || [];
        let imagesToUpload = allImages.filter(img => !img.assetId);
        if (imagesToUpload.length === 0) { getEl('loader').classList.add('hidden'); return alert("Không có ảnh nào để tải lên!"); }
        if (!confirm(`Tải lên ${imagesToUpload.length} ảnh hồ sơ?`)) { getEl('loader').classList.add('hidden'); return; }
        getEl('loader-text').textContent = "Đang Upload lên Drive...";
        const payload = {
            action: 'upload',
            folderName: `${currentCustomerData.name} - ${decryptText(currentCustomerData.cccd) || decryptText(currentCustomerData.phone)}`,
            images: imagesToUpload.map((img, idx) => ({ name: `hoso_${Date.now()}_${idx}.jpg`, data: img.data }))
        };
        try {
            const response = await fetch(scriptUrl, { method: "POST", body: JSON.stringify(payload) });
            const result = await response.json();
            if (result.status === 'success') {
                currentCustomerData.driveLink = result.url;
                db.transaction(['customers'], 'readwrite').objectStore('customers').put(currentCustomerData);
                getEl('loader').classList.add('hidden');
                renderDriveStatus(result.url);
                if(confirm("✅ Upload thành công!\nXóa ảnh trong App để giải phóng bộ nhớ?")) {
                    const txDel = db.transaction(['images'], 'readwrite');
                    imagesToUpload.forEach(img => txDel.objectStore('images').delete(img.id));
                    txDel.oncomplete = () => { loadProfileImages(); showToast("Đã dọn dẹp bộ nhớ"); };
                }
            } else { throw new Error(result.message); }
        } catch (err) { getEl('loader').classList.add('hidden'); alert("Lỗi Upload: " + err.message); }
    };
}

async function uploadAssetToDrive() {
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if (!userUrl || userUrl.length < 10) { if (confirm("Bạn chưa cấu hình nơi lưu ảnh cá nhân! Bấm OK để vào Cài đặt nhập Link Script của bạn.")) toggleMenu(); return; }
    if (!currentCustomerData || !currentAssetId) return;
    const assetIndex = currentCustomerData.assets.findIndex(a => a.id === currentAssetId);
    if (assetIndex === -1) return;
    const currentAsset = currentCustomerData.assets[assetIndex];
    getEl('loader').classList.remove('hidden'); getEl('loader-text').textContent = "Đang lấy ảnh TSBĐ...";
    const tx = db.transaction(['images'], 'readonly');
    const index = tx.objectStore('images').index('customerId');
    index.getAll(currentCustomerId).onsuccess = async (e) => {
        let allImages = e.target.result || [];
        let imagesToUpload = allImages.filter(img => img.assetId === currentAssetId);
        if (imagesToUpload.length === 0) { getEl('loader').classList.add('hidden'); return alert("Tài sản này chưa có ảnh nào!"); }
        if (!confirm(`Tải lên ${imagesToUpload.length} ảnh của tài sản "${currentAsset.name}" lên Drive?`)) { getEl('loader').classList.add('hidden'); return; }
        getEl('loader-text').textContent = "Đang Upload TSBĐ...";
        const folderName = `${currentCustomerData.name} - TSBĐ: ${currentAsset.name}`;
        const payload = { folderName: folderName, images: imagesToUpload.map((img, idx) => ({ name: `asset_img_${Date.now()}_${idx}.jpg`, data: img.data })) };
        try {
            const response = await fetch(userUrl, { method: "POST", body: JSON.stringify(payload) });
            const result = await response.json();
            if (result.status === 'success') {
                currentCustomerData.assets[assetIndex].driveLink = result.url;
                db.transaction(['customers'], 'readwrite').objectStore('customers').put(currentCustomerData);
                getEl('loader').classList.add('hidden'); renderAssetDriveStatus(result.url);
                if(confirm("✅ TSBĐ ĐÃ LÊN MÂY!\n\nXóa ảnh gốc trong máy để nhẹ bộ nhớ?")) {
                    const txDel = db.transaction(['images'], 'readwrite');
                    imagesToUpload.forEach(img => txDel.objectStore('images').delete(img.id));
                    txDel.oncomplete = () => { loadAssetImages(currentAssetId); showToast("Đã dọn dẹp ảnh TSBĐ"); };
                }
            } else { throw new Error(result.message); }
        } catch (err) { getEl('loader').classList.add('hidden'); alert("Lỗi: " + err.message); }
    };
}

function renderDriveStatus(url) {
    const area = getEl('drive-status-area'); const btnUp = getEl('btn-upload-drive');
    if (!area) return;
    area.classList.remove('hidden');
    if (url && url.length > 5) {
        area.innerHTML = `<a href="${url}" target="_blank" class="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg mb-1 animate-fade-in border border-emerald-400/30"><i data-lucide="external-link" class="w-5 h-5"></i> Mở Folder Ảnh</a><p class="text-[10px] text-center text-emerald-400/70 italic mb-2">Đã đồng bộ lên Cloud</p>`;
        if (btnUp) btnUp.classList.remove('hidden');
    } else {
        area.innerHTML = `<button onclick="reconnectDriveFolder()" class="w-full py-2 mb-2 bg-slate-700/50 border border-slate-600 rounded-lg text-xs font-medium text-slate-300 flex items-center justify-center gap-2 hover:bg-slate-700 transition"><i data-lucide="search" class="w-4 h-4"></i> Tìm kết nối cũ</button>`;
        if (btnUp) btnUp.classList.remove('hidden');
    }
    if (window.lucide) lucide.createIcons();
}

function renderAssetDriveStatus(url) {
    const area = getEl('asset-drive-status-area'); const btnUp = getEl('btn-asset-upload');
    if (!area) return;
    area.classList.remove('hidden');
    if (url && url.length > 5) {
        area.innerHTML = `<a href="${url}" target="_blank" class="w-full py-3 bg-teal-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg mb-1 animate-fade-in border border-teal-400/30"><i data-lucide="external-link" class="w-5 h-5"></i> Xem Folder TSBĐ</a>`;
        if (btnUp) btnUp.classList.remove('hidden');
    } else {
        area.innerHTML = `<button onclick="reconnectAssetDriveFolder()" class="w-full py-2 mb-2 bg-slate-700/50 border border-slate-600 rounded-lg text-xs font-medium text-slate-300 flex items-center justify-center gap-2 hover:bg-slate-700 transition"><i data-lucide="search" class="w-4 h-4"></i> Tìm kết nối cũ</button>`;
        if (btnUp) btnUp.classList.remove('hidden');
    }
    if(window.lucide) lucide.createIcons();
}

async function reconnectDriveFolder() {
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if (!userUrl || userUrl.length < 10) { if (confirm("Chưa cấu hình Script! Vào cài đặt ngay?")) toggleMenu(); return; }
    if (!currentCustomerData) return;
    getEl('loader').classList.remove('hidden'); getEl('loader-text').textContent = "Đang tìm trên Drive...";
    const name = currentCustomerData.name;
    const phone = decryptText(currentCustomerData.phone);
    const cccd = decryptText(currentCustomerData.cccd);
    const possibleNames = [];
    if (cccd) possibleNames.push(`${name} - ${cccd}`);
    if (phone) possibleNames.push(`${name} - ${phone}`);
    let foundUrl = null;
    for (const folderName of possibleNames) {
        try {
            getEl('loader-text').textContent = `Đang tìm: ${folderName}...`;
            const response = await fetch(userUrl, { method: "POST", body: JSON.stringify({ action: 'search', folderName: folderName }) });
            const result = await response.json();
            if (result.status === 'found') { foundUrl = result.url; break; }
        } catch (e) { console.warn("Lỗi tìm kiếm:", e); }
    }
    if (foundUrl) {
        currentCustomerData.driveLink = foundUrl;
        const tx = db.transaction(['customers'], 'readwrite');
        tx.objectStore('customers').put(currentCustomerData).onsuccess = () => { getEl('loader').classList.add('hidden'); renderDriveStatus(foundUrl); showToast("Đã kết nối lại thành công!"); };
    } else { getEl('loader').classList.add('hidden'); alert("Không tìm thấy folder nào khớp với Tên + CCCD hoặc Tên + SĐT."); }
}

async function reconnectAssetDriveFolder() {
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if (!userUrl || userUrl.length < 10) { if (confirm("Bạn chưa cấu hình nơi lưu ảnh cá nhân! Bấm OK để vào Cài đặt nhập Link Script của bạn.")) toggleMenu(); return; }
    if (!currentCustomerData || !currentAssetId) return;
    const assetIndex = currentCustomerData.assets.findIndex(a => a.id === currentAssetId);
    if (assetIndex === -1) return;
    getEl('loader').classList.remove('hidden'); getEl('loader-text').textContent = "Đang tìm TSBĐ...";
    const folderName = `${currentCustomerData.name} - TSBĐ: ${currentCustomerData.assets[assetIndex].name}`;
    try {
        const response = await fetch(userUrl, { method: "POST", body: JSON.stringify({ action: 'search', folderName: folderName }) });
        const result = await response.json();
        if (result.status === 'found') {
            const encLink = encryptText(result.url); 
            const tx = db.transaction(['customers'], 'readwrite');
            const store = tx.objectStore('customers');
            store.get(currentCustomerData.id).onsuccess = (e) => {
                let dbRecord = e.target.result;
                if (dbRecord && dbRecord.assets && dbRecord.assets[assetIndex]) {
                    dbRecord.assets[assetIndex].driveLink = encLink;
                    store.put(dbRecord);
                }
            };
            tx.oncomplete = () => {
                currentCustomerData.assets[assetIndex].driveLink = result.url;
                getEl('loader').classList.add('hidden'); renderAssetDriveStatus(result.url); showToast("Đã kết nối lại!");
            };
        } else { getEl('loader').classList.add('hidden'); alert("Không tìm thấy folder: " + folderName); }
    } catch (err) { getEl('loader').classList.add('hidden'); alert("Lỗi: " + err.message); }
}

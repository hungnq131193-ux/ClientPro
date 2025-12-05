/* ui.js - Giao diện & Tương tác */

function showToast(msg) { const t=getEl('toast'); getEl('toast-msg').textContent=msg; t.classList.add('toast-show'); setTimeout(()=>t.classList.remove('toast-show'), 2000); }
function escapeHTML(str) { if (str === undefined || str === null) return ''; return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }
function getZaloLink(phone) { let p = phone.replace(/[\s\.]/g, ''); if (p.startsWith('0')) p = '84' + p.substring(1); return `https://zalo.me/${p}`; }
function formatLink(link) { if(!link) return ''; if(link.startsWith('http')) return link; return 'https://' + link; }

function setTheme(themeName) { document.body.className = themeName; localStorage.setItem(THEME_KEY, themeName); document.querySelectorAll('.theme-btn').forEach(btn => { if(btn.getAttribute('onclick').includes(themeName)) btn.classList.add('active'); else btn.classList.remove('active'); }); }
function toggleMenu() { const m=getEl('settings-menu'); const o=getEl('menu-overlay'); if(m.classList.contains('hidden')){m.classList.remove('hidden');o.classList.remove('hidden'); setTimeout(()=>{m.classList.remove('scale-95','opacity-0');},10)}else{m.classList.add('scale-95','opacity-0'); setTimeout(()=>{m.classList.add('hidden');o.classList.add('hidden');},200)} }

function switchListTab(tab) {
    activeListTab = tab; const tabPending = getEl('list-tab-pending'); const tabApproved = getEl('list-tab-approved');
    if(tab === 'pending') { tabPending.className = "flex-1 py-2.5 text-[11px] font-bold uppercase rounded-lg transition-all duration-300 bg-white/10 text-white shadow-md border border-white/10"; tabApproved.className = "flex-1 py-2.5 text-[11px] font-bold uppercase rounded-lg transition-all duration-300 text-slate-400 hover:text-white"; } 
    else { tabPending.className = "flex-1 py-2.5 text-[11px] font-bold uppercase rounded-lg transition-all duration-300 text-slate-400 hover:text-white"; tabApproved.className = "flex-1 py-2.5 text-[11px] font-bold uppercase rounded-lg transition-all duration-300 bg-emerald-500/10 text-emerald-400 shadow-md border border-emerald-500/20"; }
    loadCustomers(getEl('search-input').value);
}

function renderList(list) {
    const listEl = getEl('customer-list'); if(!listEl) return; listEl.innerHTML = '';
    if (list.length === 0) { listEl.innerHTML = `<div class="text-center py-32 opacity-40 flex flex-col items-center"><i data-lucide="inbox" class="w-16 h-16 mb-4 stroke-1"></i><p class="text-xs font-bold uppercase tracking-wider">Danh sách trống</p></div>`; lucide.createIcons(); return; }
    const svgCheck = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    list.forEach(c => {
        const isApproved = activeListTab === 'approved'; 
        const el = document.createElement('div');
        const statusColor = isApproved ? '#10b981' : '#6366f1';
        el.className = `glass-panel p-4 rounded-2xl mb-3 flex items-center gap-4 transition-all duration-200 hover:bg-white/5 active:scale-[0.98] ${isCustSelectionMode && selectedCustomers.has(c.id) ? 'selected' : ''}`;
        el.style.border = '1px solid rgba(255,255,255,0.1)';
        el.style.boxShadow = `inset 4px 0 0 0 ${statusColor}, 0 4px 10px rgba(0,0,0,0.1)`;
        el.onclick = (e) => { if(e.target.closest('.action-btn')) return; if(isCustSelectionMode) toggleCustomerSelection(c.id, el); else openFolder(c.id); };
        const limitHtml = isApproved ? `<p class="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded mt-1.5 w-fit border border-emerald-500/20 tracking-wider">HM: ${c.creditLimit || '0'}</p>` : `<p class="text-[10px] text-slate-400 mt-1 italic opacity-60">Đang thẩm định...</p>`;
        const checkIcon = isCustSelectionMode ? `<div class="select-ring">${svgCheck}</div>` : '';
        const safeName = escapeHTML(c.name || '');
        const safePhone = escapeHTML(c.phone || '');
        const safeInitial = escapeHTML((c.name || '').charAt(0).toUpperCase());
        el.innerHTML = `
            ${checkIcon}
            <div class="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-xl shrink-0 border border-white/10 shadow-inner ${isApproved ? 'bg-emerald-500/10 text-emerald-400' : 'bg-indigo-500/10 text-indigo-400'}">
                ${safeInitial}
            </div>
            <div class="flex-1 min-w-0">
                <h3 class="font-bold text-white truncate text-base mb-0.5 leading-tight">${safeName}</h3>
                <p class="text-xs text-slate-400 font-mono flex items-center gap-1.5"><i data-lucide="smartphone" class="w-3 h-3 opacity-70"></i> ${safePhone}</p>
                ${limitHtml}
            </div>
            <div class="flex gap-2.5">
                <a href="${getZaloLink(c.phone)}" target="_blank" class="action-btn glass-btn w-10 h-10 flex items-center justify-center text-blue-400 rounded-xl"><i data-lucide="message-circle" class="w-5 h-5"></i></a>
                <a href="tel:${c.phone}" class="action-btn glass-btn w-10 h-10 flex items-center justify-center text-green-400 rounded-xl"><i data-lucide="phone" class="w-5 h-5"></i></a>
            </div>`;
        listEl.appendChild(el);
    }); lucide.createIcons();
}

function renderFolderHeader(data) {
    getEl('folder-customer-name').textContent = data.name; getEl('folder-avatar').textContent = data.name.charAt(0).toUpperCase(); getEl('btn-detail-call').href = `tel:${data.phone}`; getEl('btn-detail-zalo').href = getZaloLink(data.phone); 
    const badge = getEl('detail-status-badge'); 
    if(data.status === 'approved') { badge.className = "px-4 py-2 rounded-lg text-xs font-bold border flex items-center gap-2 active:scale-95 transition-transform uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-lg shadow-emerald-500/10"; badge.innerHTML = `<i data-lucide="badge-check" class="w-3.5 h-3.5"></i> <span>${data.creditLimit}</span>`; } 
    else { badge.className = "px-4 py-2 rounded-lg text-xs font-bold border flex items-center gap-2 active:scale-95 transition-transform uppercase tracking-wider bg-indigo-500/10 text-indigo-400 border-indigo-500/20"; badge.innerHTML = `<i data-lucide="hourglass" class="w-3.5 h-3.5"></i> <span>THẨM ĐỊNH</span>`; } lucide.createIcons();
}

function renderAssets() {
    const list = getEl('content-assets'); list.innerHTML = '';
    const assets = currentCustomerData.assets || [];
    if (assets.length === 0) { list.innerHTML = `<div class="text-center py-20 text-slate-500"><i data-lucide="building" class="w-10 h-10 mx-auto mb-2 opacity-20"></i><p class="text-sm">Chưa có tài sản</p></div>`; lucide.createIcons(); return; }
    assets.forEach((asset, index) => {
        const el = document.createElement('div');
        el.className = "glass-panel p-4 rounded-xl flex flex-col gap-3 transition-transform active:scale-[0.99] mb-4";
        el.style.border = '1px solid rgba(255,255,255,0.12)';
        const decName = decryptText(asset.name) || ''; const decLink = decryptText(asset.link) || '';
        const decVal = decryptText(asset.valuation) || ''; const decLoan = decryptText(asset.loanValue) || '';
        const decArea = decryptText(asset.area) || ''; const decWidth = decryptText(asset.width) || '';
        const decYear = decryptText(asset.year) || ''; const decOnland = decryptText(asset.onland) || '';
        const safeName = escapeHTML(decName); const safeVal = escapeHTML(decVal) || '-';
        const safeLoan = escapeHTML(decLoan) || '-'; const safeArea = escapeHTML(decArea);
        const safeWidth = escapeHTML(decWidth); const safeYear = escapeHTML(decYear); const safeOnland = escapeHTML(decOnland);
        const mapLink = formatLink(decLink);
        const mapBtn = mapLink ? `<a href="${mapLink}" target="_blank" class="glass-btn flex-1 py-2.5 rounded-lg text-xs font-bold text-slate-300 flex items-center justify-center gap-1 hover:text-white"><i data-lucide="map" class="w-3 h-3"></i> Bản đồ</a>` : `<span class="glass-btn flex-1 py-2.5 rounded-lg text-xs text-slate-500 text-center cursor-not-allowed opacity-50">No Map</span>`;
        const ocrBtn = asset.ocrData ? `<button onclick="viewSavedOcr('${asset.id}')" class="glass-btn px-3 py-2.5 text-purple-300 rounded-lg text-xs font-bold flex items-center justify-center gap-1 hover:text-white"><i data-lucide="info" class="w-3 h-3"></i> Thông tin bìa</button>` : '';
        const areaInfo = safeArea ? `<span class="bg-indigo-500/10 text-indigo-300 px-2 py-1 rounded text-[10px] font-bold border border-white/10">${safeArea}m²</span>` : '';
        const widthInfo = safeWidth ? `<span class="bg-indigo-500/10 text-indigo-300 px-2 py-1 rounded text-[10px] font-bold border border-white/10">MT:${safeWidth}m</span>` : '';
        const yearInfo = safeYear ? `<span class="bg-slate-500/10 text-slate-300 px-2 py-1 rounded text-[10px] font-bold border border-white/10">Năm:${safeYear}</span>` : '';
        const onlandInfo = safeOnland ? `<div class="text-xs text-slate-400 mt-1 italic"><i data-lucide="home" class="w-3 h-3 inline mr-1"></i>${safeOnland}</div>` : '';
        el.innerHTML = `
            <div class="flex justify-between items-start mb-1"><div class="flex gap-3 items-center"><div class="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-white/10"><i data-lucide="map-pin" class="w-5 h-5"></i></div><div><h4 class="font-bold text-white text-sm line-clamp-1">${safeName}</h4><div class="flex gap-1 mt-1 flex-wrap">${areaInfo}${widthInfo}${yearInfo}</div></div></div><div class="flex gap-1"><button onclick="openEditAssetModal(${index})" class="text-blue-400 p-2 hover:bg-white/5 rounded-lg"><i data-lucide="pencil" class="w-4 h-4"></i></button><button onclick="deleteAsset(${index})" class="text-red-400 p-2 hover:bg-white/5 rounded-lg transition-transform active:scale-90"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div></div>${onlandInfo}<div class="flex justify-between text-xs text-slate-400 mb-2 bg-black/20 p-3 rounded-lg border border-white/5 mt-2"><span>ĐG: <b class="text-emerald-400 text-sm">${safeVal}</b></span><span>Vay: <b class="text-blue-400 text-sm">${safeLoan}</b></span></div><div class="flex gap-2">${mapBtn}${ocrBtn}<button onclick="referenceAssetPrice(${index})" class="glass-btn flex-1 py-2.5 text-emerald-400 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:text-white"><i data-lucide="radar" class="w-3 h-3"></i> Tham khảo</button></div><button onclick="openAssetGallery('${asset.id}', '${safeName}', ${index})" class="glass-btn w-full py-2.5 text-indigo-400 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:text-white mt-1"><i data-lucide="image" class="w-3 h-3"></i> Kho Ảnh TSBĐ</button>`;
        list.appendChild(el);
    }); lucide.createIcons();
}

function switchTab(tabName) { 
    const tabImages = getEl('tab-btn-images'); const tabAssets = getEl('tab-btn-assets'); 
    const activeClass = "glass-tab-active flex-1 py-2.5 text-xs font-bold uppercase rounded-lg transition-all";
    const inactiveClass = "glass-tab-inactive flex-1 py-2.5 text-xs font-bold uppercase rounded-lg transition-all hover:bg-white/5";
    if (tabName === 'images') { 
        tabImages.className = activeClass; tabAssets.className = inactiveClass; 
        getEl('content-images').classList.remove('hidden'); getEl('content-assets').classList.add('hidden'); 
        getEl('actions-images').classList.remove('hidden'); getEl('actions-assets').classList.add('hidden'); 
        loadProfileImages(); 
    } else { 
        tabImages.className = inactiveClass; tabAssets.className = activeClass; 
        getEl('content-images').classList.add('hidden'); getEl('content-assets').classList.remove('hidden'); 
        getEl('actions-images').classList.add('hidden'); getEl('actions-assets').classList.remove('hidden'); 
        renderAssets(); 
    } 
    isSelectionMode = false; selectedImages.clear(); updateSelectionUI(); 
}

function openModal() {
    getEl('add-modal').classList.remove('hidden');
    getEl('new-name').value = ''; getEl('new-phone').value = ''; if (getEl('new-cccd')) getEl('new-cccd').value = '';
    getEl('edit-cust-id').value = ''; getEl('modal-title-cust').textContent = "Khởi tạo hồ sơ";
    getEl('btn-save-cust').textContent = "Tạo mới"; getEl('new-name').focus();
}
function closeModal() { getEl('add-modal').classList.add('hidden'); }
function openEditCustomerModal() {
    if (!currentCustomerData) return;
    getEl('add-modal').classList.remove('hidden'); getEl('modal-title-cust').textContent = "Cập nhật thông tin";
    getEl('btn-save-cust').textContent = "Lưu thay đổi"; getEl('edit-cust-id').value = currentCustomerData.id;
    getEl('new-name').value = currentCustomerData.name; getEl('new-phone').value = decryptText(currentCustomerData.phone);
    if (getEl('new-cccd')) { getEl('new-cccd').value = decryptText(currentCustomerData.cccd) || ''; }
}
function openAssetModal() { 
    getEl('asset-modal').classList.remove('hidden'); getEl('edit-asset-index').value = ""; getEl('modal-title-asset').textContent = "Thêm TSBĐ"; getEl('btn-save-asset').textContent = "Thêm mới"; 
    getEl('asset-name').value=''; getEl('asset-link').value=''; getEl('asset-val').value=''; getEl('asset-loan').value=''; getEl('asset-area').value=''; getEl('asset-width').value=''; getEl('asset-onland').value=''; getEl('asset-year').value=''; 
}
function openEditAssetModal(index) { 
    getEl('asset-modal').classList.remove('hidden'); const asset = currentCustomerData.assets[index]; 
    getEl('edit-asset-index').value = index; getEl('modal-title-asset').textContent = "Cập nhật TSBĐ"; getEl('btn-save-asset').textContent = "Lưu thay đổi"; 
    getEl('asset-name').value = decryptText(asset.name); getEl('asset-link').value = decryptText(asset.link) || ''; getEl('asset-val').value = decryptText(asset.valuation) || ''; getEl('asset-loan').value = decryptText(asset.loanValue) || '';
    getEl('asset-area').value = decryptText(asset.area) || ''; getEl('asset-width').value = decryptText(asset.width) || ''; getEl('asset-onland').value = decryptText(asset.onland) || ''; getEl('asset-year').value = decryptText(asset.year) || '';
    getEl('asset-ocr-data').value = decryptText(asset.ocrData) || ''; currentAssetId = asset.id;
}
function closeAssetModal() { getEl('asset-modal').classList.add('hidden'); }
function openGuideModal() { getEl('guide-modal').classList.remove('hidden'); }
function closeGuideModal() { getEl('guide-modal').classList.add('hidden'); }
function openApproveModal() { getEl('approve-modal').classList.remove('hidden'); getEl('approve-limit').value = ''; }
function closeApproveModal() { getEl('approve-modal').classList.add('hidden'); }
function toggleCustomerStatus() { if (currentCustomerData.status === 'pending') { openApproveModal(); } else { if(confirm("Thu hồi trạng thái?")) { currentCustomerData.status = 'pending'; updateCustomerAndReload(); } } }
function confirmApproval() { const l = getEl('approve-limit').value; if(!l) return alert("Nhập hạn mức!"); currentCustomerData.status='approved'; currentCustomerData.creditLimit=l; closeApproveModal(); db.transaction(['customers'], 'readwrite').objectStore('customers').put(currentCustomerData).onsuccess = () => { showToast("Đã duyệt"); renderFolderHeader(currentCustomerData); loadCustomers(getEl('search-input').value); }; }
function updateCustomerAndReload() { db.transaction(['customers'], 'readwrite').objectStore('customers').put(currentCustomerData).onsuccess = () => { openFolder(currentCustomerData.id); loadCustomers(); }; }

function referenceAssetPrice(assetIndex) {
    const targetAsset = currentCustomerData.assets[assetIndex]; 
    const decryptedTargetLink = decryptText(targetAsset.link); const targetLoc = parseLatLngFromLink(decryptedTargetLink);
    if (!targetLoc) { showToast("TSBĐ chưa có tọa độ chuẩn"); return; }
    getEl('loader').classList.remove('hidden'); getEl('loader-text').textContent = "Đang tìm kiếm & so sánh...";
    const tx = db.transaction(['customers'], 'readonly');
    tx.objectStore('customers').getAll().onsuccess = (e) => {
        const customers = e.target.result || []; const candidates = [];
        customers.forEach(cust => { 
            if (!cust.assets) return; 
            const custName = decryptText(cust.name);
            cust.assets.forEach(asset => { 
                if (cust.id === currentCustomerData.id && asset.id === targetAsset.id) return; 
                const decryptedLink = decryptText(asset.link);
                const loc = parseLatLngFromLink(decryptedLink); 
                const val = parseMoneyToNumber(decryptText(asset.valuation)); 
                const assetName = decryptText(asset.name);
                if (loc && val > 0) { 
                    const dist = distanceMeters(targetLoc.lat, targetLoc.lng, loc.lat, loc.lng); 
                    candidates.push({ customerName: custName, assetName: assetName, valuation: val, distance: dist }); 
                } 
            }); 
        });
        getEl('loader').classList.add('hidden'); getEl('loader-text').textContent = "Loading...";
        if (candidates.length === 0) { showToast("Chưa có dữ liệu tham chiếu phù hợp"); return; }
        candidates.sort((a, b) => a.distance - b.distance); showRefModal(candidates.slice(0, 20));
    };
}
function showRefModal(results) {
    const modal = getEl('ref-price-modal'); const container = getEl('ref-results'); container.innerHTML = '';
    results.forEach((item, idx) => {
        const distStr = item.distance < 1000 ? `${Math.round(item.distance)} m` : `${(item.distance/1000).toFixed(2)} km`; const valStr = item.valuation.toLocaleString('vi-VN') + ' tr₫';
        const div = document.createElement('div'); div.className = "bg-white/5 border border-white/10 rounded-lg p-3";
        div.innerHTML = `<div class="flex justify-between items-center mb-1"><span class="text-xs font-bold text-emerald-400">#${idx + 1} • Cách ${distStr}</span><span class="text-sm font-bold text-white">${valStr}</span></div><h4 class="text-sm font-medium text-slate-300 truncate">${item.assetName}</h4><p class="text-[10px] text-slate-500 mt-1 uppercase">KH: ${item.customerName}</p>`;
        container.appendChild(div);
    }); modal.classList.remove('hidden');
}
function closeRefModal() { getEl('ref-price-modal').classList.add('hidden'); }

function toggleCustSelectionMode() {
    isCustSelectionMode = !isCustSelectionMode; selectedCustomers.clear();
    const bar = getEl('cust-selection-bar'); const btn = getEl('btn-cust-select');
    if(isCustSelectionMode) { bar.classList.remove('translate-y-full'); bar.classList.add('translate-y-0'); btn.classList.add('btn-active'); } 
    else { bar.classList.add('translate-y-full'); bar.classList.remove('translate-y-0'); btn.classList.remove('btn-active'); }
    getEl('cust-selection-count').textContent = '0'; loadCustomers(getEl('search-input').value);
}
function toggleCustomerSelection(id, div) {
    if(selectedCustomers.has(id)) { selectedCustomers.delete(id); div.classList.remove('selected'); } else { selectedCustomers.add(id); div.classList.add('selected'); }
    getEl('cust-selection-count').textContent = selectedCustomers.size;
}
function toggleSelectionMode() { isSelectionMode = !isSelectionMode; selectedImages.clear(); updateSelectionUI(); if(!getEl('screen-asset-gallery').classList.contains('translate-x-full')) loadAssetImages(currentAssetId); else loadProfileImages(); }
function updateSelectionUI() { const btns = [getEl('btn-select-mode'), getEl('btn-select-mode-asset')]; const bar = getEl('selection-bar'); const count = getEl('selection-count'); if(isSelectionMode) { btns.forEach(b=>{if(b) b.classList.add('btn-active')}); bar.classList.remove('translate-y-full'); bar.classList.add('translate-y-0'); } else { btns.forEach(b=>{if(b) b.classList.remove('btn-active')}); bar.classList.add('translate-y-full'); bar.classList.remove('translate-y-0'); } if(count) count.textContent = selectedImages.size; }
function toggleImage(id, div) { if(selectedImages.has(id)) { selectedImages.delete(id); div.classList.remove('selected'); } else { selectedImages.add(id); div.classList.add('selected'); } getEl('selection-count').textContent = selectedImages.size; }

function viewSavedOcr(assetId) {
    const asset = currentCustomerData && currentCustomerData.assets ? currentCustomerData.assets.find(a => a.id === assetId) : null;
    if (!asset || !asset.ocrData) { showToast('Không có dữ liệu QR'); return; }
    const rawData = decryptText(asset.ocrData);
    let htmlContent = '';
    if (rawData.includes('|')) {
        const parts = rawData.split('|'); const serial = parts[4] || '---'; const system = parts[2] || '---'; const docId = parts[1] || '---';
        htmlContent = `<div class="space-y-3 mb-4"><div class="bg-white/5 p-3 rounded-lg border border-white/10"><p class="text-[10px] text-slate-400 uppercase font-bold mb-1">Số phát hành (Bìa đỏ)</p><p class="text-xl font-bold text-emerald-400 tracking-wider">${serial}</p></div><div class="grid grid-cols-2 gap-3"><div class="bg-white/5 p-3 rounded-lg border border-white/10"><p class="text-[10px] text-slate-400 uppercase font-bold mb-1">Hệ thống</p><p class="text-sm font-bold text-white">${system}</p></div><div class="bg-white/5 p-3 rounded-lg border border-white/10"><p class="text-[10px] text-slate-400 uppercase font-bold mb-1">Mã khu vực</p><p class="text-sm font-bold text-white break-all">${docId}</p></div></div><div class="bg-white/5 p-3 rounded-lg border border-white/10"><p class="text-[10px] text-slate-400 uppercase font-bold mb-1">Chuỗi định danh đầy đủ</p><p class="text-xs text-slate-300 font-mono break-all leading-relaxed">${rawData}</p></div><p class="text-[10px] text-slate-500 italic text-center mt-2">* QR này chứa mã định danh điện tử, không chứa trực tiếp địa chỉ/diện tích.</p></div>`;
    } else {
        htmlContent = `<div class="bg-white/5 p-4 rounded-xl border border-white/10 mb-4"><p class="text-xs text-slate-300 font-mono whitespace-pre-wrap leading-relaxed">${rawData}</p></div>`;
    }
    const overlay = document.createElement('div'); overlay.className = 'fixed inset-0 z-[300] bg-black/90 flex items-center justify-center p-6 backdrop-blur-sm animate-fade-in';
    overlay.innerHTML = `<div class="glass-panel w-full max-w-sm rounded-2xl p-6 shadow-2xl border border-purple-500/30"><h3 class="font-bold text-lg mb-4 text-purple-400 flex items-center gap-2"><i data-lucide="scan-barcode" class="w-5 h-5"></i> Thông tin QR Bìa đỏ</h3><div class="max-h-[60vh] overflow-y-auto custom-scrollbar">${htmlContent}</div><div class="flex gap-3 mt-2"><button onclick="copyToClipboard('${rawData.replace(/\n/g, '\\n')}')" class="flex-1 py-3 rounded-xl font-bold bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 transition border border-purple-500/30">Copy Tất Cả</button><button onclick="this.closest('.fixed').remove()" class="flex-1 py-3 rounded-xl font-bold bg-white/10 text-white hover:bg-white/20 transition">Đóng</button></div></div>`;
    document.body.appendChild(overlay); if (window.lucide) lucide.createIcons();
}

function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => showToast("Đã copy")).catch(() => fallbackCopy(text));
    } else { fallbackCopy(text); }
}
function fallbackCopy(text) {
    const input = document.createElement('textarea'); input.value = text; document.body.appendChild(input); input.select();
    try { document.execCommand('copy'); showToast("Đã copy"); } catch (e) { alert("Không thể copy"); } document.body.removeChild(input);
}
// Donate Functions
function buildDonateQRUrl() {
    const base = `https://img.vietqr.io/image/${DONATE_BANK_ID}-${DONATE_ACCOUNT_NO}-compact2.jpg`;
    const params = new URLSearchParams({ accountName: DONATE_ACCOUNT_NAME, addInfo: DONATE_DEFAULT_DESC });
    return `${base}?${params.toString()}`;
}
function openDonateModal() { const modal = getEl('donate-modal'); const img = getEl('donate-qr-img'); if (img && !img.src) img.src = buildDonateQRUrl(); modal.classList.remove('hidden'); }
function closeDonateModal() { const modal = getEl('donate-modal'); if (modal) modal.classList.add('hidden'); }
function copyDonateAccount() { copyToClipboard(DONATE_ACCOUNT_NO); }

// Lightbox
function openLightbox(src, id, idx, list) {
    getEl('lightbox').classList.remove('hidden'); currentLightboxIndex = idx;
    if(list && list.length > 0) currentLightboxList = list; else currentLightboxList = [{id: id, data: src}];
    const imgEl = getEl('lightbox-img'); imgEl.src = src; currentImageId = id; currentImageBase64 = src; getEl('lightbox-counter').textContent = `${currentLightboxIndex + 1}/${currentLightboxList.length}`;
}
function closeLightbox() { getEl('lightbox').classList.add('hidden'); }
function navigateLightbox(dir) {
    if (currentLightboxList.length <= 1) return;
    currentLightboxIndex += dir; if (currentLightboxIndex < 0) currentLightboxIndex = currentLightboxList.length - 1; if (currentLightboxIndex >= currentLightboxList.length) currentLightboxIndex = 0;
    const imgEl = getEl('lightbox-img');
    imgEl.style.transform = dir > 0 ? 'translateX(-20px)' : 'translateX(20px)'; imgEl.style.opacity = '0';
    setTimeout(() => { imgEl.src = currentLightboxList[currentLightboxIndex].data; imgEl.style.transform = dir > 0 ? 'translateX(20px)' : 'translateX(-20px)'; setTimeout(() => { imgEl.style.transform = 'translateX(0)'; imgEl.style.opacity = '1'; currentImageId = currentLightboxList[currentLightboxIndex].id; currentImageBase64 = currentLightboxList[currentLightboxIndex].data; getEl('lightbox-counter').textContent = `${currentLightboxIndex + 1}/${currentLightboxList.length}`; }, 50); }, 150);
}

// Camera & QR Scanner
function handleFileUpload(input, mode) {
    const files = input.files; if (!files || !files.length) return;
    captureMode = mode || 'profile';
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = async (e) => { const base64 = e.target.result; await saveImageToDB(base64); };
        reader.readAsDataURL(file);
    });
    input.value = "";
}
async function tryOpenCamera(mode) {
    captureMode = mode;
    try {
        getEl('camera-modal').classList.remove('hidden');
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { min: 1280, ideal: 1920, max: 2560 }, height: { min: 720, ideal: 1080, max: 1440 } }
        });
        getEl('camera-feed').srcObject = stream;
    } catch { getEl('camera-modal').classList.add('hidden'); getEl(mode === 'profile' ? 'native-camera-profile' : 'native-camera-asset').click(); }
}
function closeCamera() { getEl('camera-modal').classList.add('hidden'); if (stream) stream.getTracks().forEach(t => t.stop()); }
async function capturePhoto() {
    const v = getEl('camera-feed'); const c = getEl('camera-canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext('2d'); ctx.drawImage(v, 0, 0);
    const rawBase64 = c.toDataURL('image/jpeg', 1.0);
    closeCamera(); await saveImageToDB(rawBase64);
}
function shareOpenedImage() { if (!currentImageBase64) return; fetch(currentImageBase64).then(res => res.blob()).then(blob => { if (navigator.canShare) navigator.share({ files: [new File([blob], "evidence.jpg", { type: "image/jpeg" })] }); }); }
function setupSwipe() {
    const lb = getEl('lightbox'); let startX = 0; let endX = 0;
    lb.addEventListener('touchstart', e => { startX = e.changedTouches[0].screenX; }, { passive: true });
    lb.addEventListener('touchend', e => { endX = e.changedTouches[0].screenX; if (startX - endX > 50) navigateLightbox(1); if (endX - startX > 50) navigateLightbox(-1); }, { passive: true });
}

// QR Logic
function openQrScanner() { qrMode = 'cccd'; document.getElementById('qr-modal').classList.remove('hidden'); startMyScanner(); }
function openRedBookScanner() { qrMode = 'redbook'; document.getElementById('qr-modal').classList.remove('hidden'); startMyScanner(); }
async function closeQrScanner() {
    const modal = getEl('qr-modal'); if (autoZoomInterval) { clearInterval(autoZoomInterval); autoZoomInterval = null; }
    if (!html5QrCode || isQrBusy) { modal.classList.add('hidden'); return; }
    isQrBusy = true; try { if (html5QrCode.isScanning) { await html5QrCode.stop(); } } catch (err) {} isQrBusy = false; modal.classList.add('hidden');
}
async function startMyScanner() {
    const regionId = 'qr-reader'; if (!html5QrCode) html5QrCode = new Html5Qrcode(regionId); if (isQrBusy) return; isQrBusy = true;
    try {
        const devices = await Html5Qrcode.getCameras(); let cameraId = null;
        if (devices && devices.length) {
            const backCam = devices.find(d => { const l = d.label.toLowerCase(); return l.includes('back') || l.includes('rear') || l.includes('environment') || l.includes('sau'); });
            cameraId = backCam ? backCam.id : devices[devices.length - 1].id;
        } else { alert("Lỗi Camera!"); closeQrScanner(); return; }
        const config = { fps: 30, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0, disableFlip: false };
        await html5QrCode.start(cameraId, config, (decodedText) => {
            if (navigator.vibrate) navigator.vibrate(200); if (autoZoomInterval) clearInterval(autoZoomInterval);
            if (qrMode === 'cccd') handleCccdResult(decodedText); else if (qrMode === 'redbook') handleRedBookResult(decodedText);
            closeQrScanner();
        }, () => {});
        // Auto Zoom logic
        setTimeout(() => {
            try {
                const track = html5QrCode.getRunningTrackCameraCapabilities(); const zoomCap = track.zoomFeature();
                if (zoomCap.isSupported()) {
                    let currentZoom = Math.min(2.2, zoomCap.max()); zoomCap.apply(currentZoom);
                    const sliderDiv = document.createElement('div'); sliderDiv.id = 'my-zoom-slider-container';
                    sliderDiv.className = "mt-4 w-full px-4 animate-fade-in text-center";
                    sliderDiv.innerHTML = `<p class="text-[10px] text-emerald-400 font-bold mb-1 uppercase tracking-widest animate-pulse"><i data-lucide="scan-line" class="inline w-3 h-3"></i> Đang tự động dò nét...</p><input type="range" id="zoom-slider" disabled min="${zoomCap.min()}" max="${zoomCap.max()}" step="0.1" value="${currentZoom}" class="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-wait">`;
                    const modalContent = document.querySelector('#qr-modal .glass-panel'); if (modalContent) modalContent.appendChild(sliderDiv);
                    if (window.lucide) lucide.createIcons();
                    let direction = 1; const step = 0.05; const maxZ = Math.min(3.5, zoomCap.max()); const minZ = Math.max(1.5, zoomCap.min());
                    if (autoZoomInterval) clearInterval(autoZoomInterval);
                    autoZoomInterval = setInterval(() => {
                        if (!html5QrCode.isScanning) { clearInterval(autoZoomInterval); return; }
                        currentZoom += (step * direction); if (currentZoom >= maxZ || currentZoom <= minZ) { direction *= -1; }
                        zoomCap.apply(currentZoom); const sliderEl = document.getElementById('zoom-slider'); if(sliderEl) sliderEl.value = currentZoom;
                    }, 50);
                }
            } catch (err) {}
        }, 500);
    } catch (err) { closeQrScanner(); } isQrBusy = false;
}
function handleCccdResult(data) {
    let idNum = '', name = '';
    try {
        if (data.includes('|')) { const parts = data.split('|'); idNum = parts[0] ? parts[0].trim() : ''; name = parts[2] ? parts[2].trim().toUpperCase() : ''; } 
        else { idNum = data.trim(); }
        if (idNum) { const cccdInput = document.getElementById('new-cccd'); if (cccdInput) cccdInput.value = idNum; }
        if (name) { const nameInput = document.getElementById('new-name'); if (nameInput) nameInput.value = name; }
    } catch (e) { const cccdInput = document.getElementById('new-cccd'); if (cccdInput) cccdInput.value = data; }
}
function handleRedBookResult(data) {
    const hiddenInput = document.getElementById('asset-ocr-data'); if (hiddenInput) hiddenInput.value = data;
    const noteInput = document.getElementById('asset-onland'); if (noteInput) noteInput.value = '';
    let redBookNum = '';
    if (data.includes('|')) { const parts = data.split('|'); if (parts[4] && parts[4].length > 4) redBookNum = parts[4].trim(); }
    if (!redBookNum) { const match = data.match(/([A-Z]{2}\s*[0-9]{6,9})/); if (match) redBookNum = match[1]; }
    const nameInput = document.getElementById('asset-name');
    if (nameInput) {
        if (redBookNum) { nameInput.value = "Bìa đỏ " + redBookNum; showToast('Đã lấy số bìa: ' + redBookNum); } 
        else { nameInput.value = "Bìa đỏ (Chưa rõ số)"; showToast('Đã quét (Không tìm thấy số bìa)'); }
    }
}
function parseRedBookInfo(text) { return {}; }
function renderRedBookInfo(info) { return ''; }

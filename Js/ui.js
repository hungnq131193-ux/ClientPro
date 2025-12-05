        function setTheme(themeName) { document.body.className = themeName; localStorage.setItem(THEME_KEY, themeName); document.querySelectorAll('.theme-btn').forEach(btn => { if(btn.getAttribute('onclick').includes(themeName)) btn.classList.add('active'); else btn.classList.remove('active'); }); }
        /**
        function setupSwipe() {
            const lb = getEl('lightbox'); let startX = 0; let endX = 0;
            lb.addEventListener('touchstart', e => { startX = e.changedTouches[0].screenX; }, {passive: true});
            lb.addEventListener('touchend', e => { endX = e.changedTouches[0].screenX; handleSwipe(); }, {passive: true});
            function handleSwipe() { if (startX - endX > 50) navigateLightbox(1); if (endX - startX > 50) navigateLightbox(-1); }
        }
        function navigateLightbox(dir) {
            if (currentLightboxList.length <= 1) return;
            currentLightboxIndex += dir; if (currentLightboxIndex < 0) currentLightboxIndex = currentLightboxList.length - 1; if (currentLightboxIndex >= currentLightboxList.length) currentLightboxIndex = 0;
            const imgEl = getEl('lightbox-img');
            imgEl.style.transform = dir > 0 ? 'translateX(-20px)' : 'translateX(20px)'; imgEl.style.opacity = '0';
            setTimeout(() => { imgEl.src = currentLightboxList[currentLightboxIndex].data; imgEl.style.transform = dir > 0 ? 'translateX(20px)' : 'translateX(-20px)'; setTimeout(() => { imgEl.style.transform = 'translateX(0)'; imgEl.style.opacity = '1'; currentImageId = currentLightboxList[currentLightboxIndex].id; currentImageBase64 = currentLightboxList[currentLightboxIndex].data; getEl('lightbox-counter').textContent = `${currentLightboxIndex + 1}/${currentLightboxList.length}`; }, 50); }, 150);
        }
        function openLightbox(src, id, idx, list) {
            getEl('lightbox').classList.remove('hidden'); currentLightboxIndex = idx;
            if(list && list.length > 0) currentLightboxList = list; else currentLightboxList = [{id: id, data: src}];
            const imgEl = getEl('lightbox-img'); imgEl.src = src; currentImageId = id; currentImageBase64 = src; getEl('lightbox-counter').textContent = `${currentLightboxIndex + 1}/${currentLightboxList.length}`;
        }
        function closeLightbox() { getEl('lightbox').classList.add('hidden'); }

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
        
        // SỬA: Dùng shadow thay cho border-l để viền full trong suốt
        const statusColor = isApproved ? '#10b981' : '#6366f1';
        el.className = `glass-panel p-4 rounded-2xl mb-3 flex items-center gap-4 transition-all duration-200 hover:bg-white/5 active:scale-[0.98] ${isCustSelectionMode && selectedCustomers.has(c.id) ? 'selected' : ''}`;
        
        // Thêm style border mờ + shadow màu bên trái
        el.style.border = '1px solid rgba(255,255,255,0.1)';
        el.style.boxShadow = `inset 4px 0 0 0 ${statusColor}, 0 4px 10px rgba(0,0,0,0.1)`;

        el.onclick = (e) => { if(e.target.closest('.action-btn')) return; if(isCustSelectionMode) toggleCustomerSelection(c.id, el); else openFolder(c.id); };
        
        const limitHtml = isApproved ? `<p class="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded mt-1.5 w-fit border border-emerald-500/20 tracking-wider">HM: ${c.creditLimit || '0'}</p>` : `<p class="text-[10px] text-slate-400 mt-1 italic opacity-60">Đang thẩm định...</p>`;
        const checkIcon = isCustSelectionMode ? `<div class="select-ring">${svgCheck}</div>` : '';
        
        // Escape dynamic values to prevent XSS
        const safeName = escapeHTML(c.name || '');
        const safePhone = escapeHTML(c.phone || '');
        const safeInitial = escapeHTML((c.name || '').charAt(0).toUpperCase());

        // SỬA: Nút Gọi/Zalo dùng class glass-btn
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
        function openModal() {
            getEl('add-modal').classList.remove('hidden');
            // Reset tất cả trường nhập thông tin khách hàng khi tạo mới
            getEl('new-name').value = '';
            getEl('new-phone').value = '';
            if (getEl('new-cccd')) getEl('new-cccd').value = '';
            getEl('edit-cust-id').value = '';
            getEl('modal-title-cust').textContent = "Khởi tạo hồ sơ";
            getEl('btn-save-cust').textContent = "Tạo mới";
            getEl('new-name').focus();
        }
        function renderFolderHeader(data) {
            getEl('folder-customer-name').textContent = data.name; getEl('folder-avatar').textContent = data.name.charAt(0).toUpperCase(); getEl('btn-detail-call').href = `tel:${data.phone}`; getEl('btn-detail-zalo').href = getZaloLink(data.phone); 
            const badge = getEl('detail-status-badge'); 
            if(data.status === 'approved') { badge.className = "px-4 py-2 rounded-lg text-xs font-bold border flex items-center gap-2 active:scale-95 transition-transform uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-lg shadow-emerald-500/10"; badge.innerHTML = `<i data-lucide="badge-check" class="w-3.5 h-3.5"></i> <span>${data.creditLimit}</span>`; } 
            else { badge.className = "px-4 py-2 rounded-lg text-xs font-bold border flex items-center gap-2 active:scale-95 transition-transform uppercase tracking-wider bg-indigo-500/10 text-indigo-400 border-indigo-500/20"; badge.innerHTML = `<i data-lucide="hourglass" class="w-3.5 h-3.5"></i> <span>THẨM ĐỊNH</span>`; } lucide.createIcons();
        }
        function openFolder(id) {
    currentCustomerId = id;
    getEl('screen-folder').classList.remove('translate-x-full');
    
    // Lấy data khách hàng
    const tx = db.transaction(['customers'], 'readonly');
        tx.objectStore('customers').get(id).onsuccess = (e) => {
            currentCustomerData = e.target.result;
            if (!currentCustomerData) return;
            // Giải mã toàn bộ dữ liệu khách hàng trước khi sử dụng
            decryptCustomerObject(currentCustomerData);
            // Sửa dữ liệu cũ nếu thiếu
            if (!currentCustomerData.status) currentCustomerData.status = 'pending';
            if (!currentCustomerData.assets) currentCustomerData.assets = [];
            // Header: tên, SĐT, trạng thái
            renderFolderHeader(currentCustomerData);
            // ⭐ Quan trọng: hiển thị lại trạng thái Drive sau khi reload / restore
            if (typeof renderDriveStatus === "function") {
                renderDriveStatus(currentCustomerData.driveLink || null);
            }
            // Reset chọn ảnh nếu có
            isSelectionMode = false;
            selectedImages.clear();
            updateSelectionUI();
            // Về tab Hồ sơ ảnh, load ảnh + TSBĐ
            switchTab('images');
            renderAssets();
        };
}
function closeFolder() { getEl('screen-folder').classList.add('translate-x-full'); currentCustomerId = null; loadCustomers(getEl('search-input').value); }
        function switchTab(tabName) { 
    const tabImages = getEl('tab-btn-images'); 
    const tabAssets = getEl('tab-btn-assets'); 
    
    // Reset classes
    const activeClass = "glass-tab-active flex-1 py-2.5 text-xs font-bold uppercase rounded-lg transition-all";
    const inactiveClass = "glass-tab-inactive flex-1 py-2.5 text-xs font-bold uppercase rounded-lg transition-all hover:bg-white/5";

    if (tabName === 'images') { 
        tabImages.className = activeClass; 
        tabAssets.className = inactiveClass; 
        getEl('content-images').classList.remove('hidden'); 
        getEl('content-assets').classList.add('hidden'); 
        getEl('actions-images').classList.remove('hidden'); 
        getEl('actions-assets').classList.add('hidden'); 
        loadProfileImages(); 
    } else { 
        tabImages.className = inactiveClass; 
        tabAssets.className = activeClass; 
        getEl('content-images').classList.add('hidden'); 
        getEl('content-assets').classList.remove('hidden'); 
        getEl('actions-images').classList.add('hidden'); 
        getEl('actions-assets').classList.remove('hidden'); 
        renderAssets(); 
    } 
    isSelectionMode = false; selectedImages.clear(); updateSelectionUI(); 
}
function referenceAssetPrice(assetIndex) {
    // 1. Lấy tài sản đang chọn
    const targetAsset = currentCustomerData.assets[assetIndex]; 
    
    // GIẢI MÃ LINK BẢN ĐỒ TRƯỚC KHI LẤY TỌA ĐỘ
    const decryptedTargetLink = decryptText(targetAsset.link);
    const targetLoc = parseLatLngFromLink(decryptedTargetLink);

    if (!targetLoc) { 
        showToast("TSBĐ chưa có tọa độ chuẩn (Link sai hoặc chưa nhập)."); 
        return; 
    }

    getEl('loader').classList.remove('hidden'); 
    getEl('loader-text').textContent = "Đang tìm kiếm & so sánh...";

    const tx = db.transaction(['customers'], 'readonly');
    tx.objectStore('customers').getAll().onsuccess = (e) => {
        const customers = e.target.result || []; 
        const candidates = [];

        customers.forEach(cust => { 
            if (!cust.assets) return; 
            
            // Giải mã tên khách hàng để hiển thị
            const custName = decryptText(cust.name);

            cust.assets.forEach(asset => { 
                // Bỏ qua chính tài sản đang so sánh
                if (cust.id === currentCustomerData.id && asset.id === targetAsset.id) return; 
                
                // GIẢI MÃ DỮ LIỆU CỦA CÁC TÀI SẢN KHÁC
                const decryptedLink = decryptText(asset.link);
                const loc = parseLatLngFromLink(decryptedLink); 
                
                // Giải mã định giá để tính toán
                const val = parseMoneyToNumber(decryptText(asset.valuation)); 
                
                // Giải mã tên tài sản để hiển thị
                const assetName = decryptText(asset.name);

                if (loc && val > 0) { 
                    const dist = distanceMeters(targetLoc.lat, targetLoc.lng, loc.lat, loc.lng); 
                    
                    // Chỉ lấy các tài sản trong bán kính 5km (hoặc tùy chỉnh)
                    // Ở đây lấy tất cả rồi sort, nhưng có thể if (dist < 5000)
                    candidates.push({ 
                        customerName: custName, 
                        assetName: assetName, 
                        valuation: val, 
                        distance: dist 
                    }); 
                } 
            }); 
        });

        getEl('loader').classList.add('hidden'); 
        getEl('loader-text').textContent = "Loading...";

        if (candidates.length === 0) { 
            showToast("Chưa có dữ liệu tham chiếu phù hợp"); 
            return; 
        }

        // Sắp xếp: Gần nhất lên đầu
        candidates.sort((a, b) => a.distance - b.distance); 
        
        // Hiển thị top 20 kết quả
        showRefModal(candidates.slice(0, 20));
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

        function renderAssets() {
    const list = getEl('content-assets');
    list.innerHTML = '';
    const assets = currentCustomerData.assets || [];
    
    if (assets.length === 0) {
        list.innerHTML = `<div class="text-center py-20 text-slate-500"><i data-lucide="building" class="w-10 h-10 mx-auto mb-2 opacity-20"></i><p class="text-sm">Chưa có tài sản</p></div>`;
        lucide.createIcons();
        return;
    }
    
    assets.forEach((asset, index) => {
        const el = document.createElement('div');
        el.className = "glass-panel p-4 rounded-xl flex flex-col gap-3 transition-transform active:scale-[0.99] mb-4";
        el.style.border = '1px solid rgba(255,255,255,0.12)';
        
        // --- GIẢI MÃ DỮ LIỆU (DECRYPT) ---
        // Nếu ô nào lưu rỗng, hàm decryptText sẽ trả về rỗng -> Không hiện chuỗi mã hóa nữa
        const decName = decryptText(asset.name) || '';
        const decLink = decryptText(asset.link) || '';
        const decVal = decryptText(asset.valuation) || '';
        const decLoan = decryptText(asset.loanValue) || '';
        const decArea = decryptText(asset.area) || '';
        const decWidth = decryptText(asset.width) || '';
        const decYear = decryptText(asset.year) || '';
        const decOnland = decryptText(asset.onland) || '';
        
        // Escape HTML để an toàn
        const safeName = escapeHTML(decName);
        const safeVal = escapeHTML(decVal) || '-';
        const safeLoan = escapeHTML(decLoan) || '-';
        const safeArea = escapeHTML(decArea);
        const safeWidth = escapeHTML(decWidth);
        const safeYear = escapeHTML(decYear);
        const safeOnland = escapeHTML(decOnland);
        
        const mapLink = formatLink(decLink);
        const mapBtn = mapLink ? `<a href="${mapLink}" target="_blank" class="glass-btn flex-1 py-2.5 rounded-lg text-xs font-bold text-slate-300 flex items-center justify-center gap-1 hover:text-white"><i data-lucide="map" class="w-3 h-3"></i> Bản đồ</a>` : `<span class="glass-btn flex-1 py-2.5 rounded-lg text-xs text-slate-500 text-center cursor-not-allowed opacity-50">No Map</span>`;
        const ocrBtn = asset.ocrData ? `<button onclick="viewSavedOcr('${asset.id}')" class="glass-btn px-3 py-2.5 text-purple-300 rounded-lg text-xs font-bold flex items-center justify-center gap-1 hover:text-white"><i data-lucide="info" class="w-3 h-3"></i> Thông tin bìa</button>` : '';
        
        const areaInfo = safeArea ? `<span class="bg-indigo-500/10 text-indigo-300 px-2 py-1 rounded text-[10px] font-bold border border-white/10">${safeArea}m²</span>` : '';
        const widthInfo = safeWidth ? `<span class="bg-indigo-500/10 text-indigo-300 px-2 py-1 rounded text-[10px] font-bold border border-white/10">MT:${safeWidth}m</span>` : '';
        const yearInfo = safeYear ? `<span class="bg-slate-500/10 text-slate-300 px-2 py-1 rounded text-[10px] font-bold border border-white/10">Năm:${safeYear}</span>` : '';
        const onlandInfo = safeOnland ? `<div class="text-xs text-slate-400 mt-1 italic"><i data-lucide="home" class="w-3 h-3 inline mr-1"></i>${safeOnland}</div>` : '';
        
        el.innerHTML = `
            <div class="flex justify-between items-start mb-1">
            <div class="flex gap-3 items-center">
                <div class="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-white/10"><i data-lucide="map-pin" class="w-5 h-5"></i></div>
                <div><h4 class="font-bold text-white text-sm line-clamp-1">${safeName}</h4><div class="flex gap-1 mt-1 flex-wrap">${areaInfo}${widthInfo}${yearInfo}</div></div>
            </div>
            <div class="flex gap-1">
                <button onclick="openEditAssetModal(${index})" class="text-blue-400 p-2 hover:bg-white/5 rounded-lg"><i data-lucide="pencil" class="w-4 h-4"></i></button>
                <button onclick="deleteAsset(${index})" class="text-red-400 p-2 hover:bg-white/5 rounded-lg transition-transform active:scale-90"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
            </div>
        </div>
        ${onlandInfo}
        <div class="flex justify-between text-xs text-slate-400 mb-2 bg-black/20 p-3 rounded-lg border border-white/5 mt-2">
            <span>ĐG: <b class="text-emerald-400 text-sm">${safeVal}</b></span>
            <span>Vay: <b class="text-blue-400 text-sm">${safeLoan}</b></span>
        </div>
        <div class="flex gap-2">
            ${mapBtn}
            ${ocrBtn}
            <button onclick="referenceAssetPrice(${index})" class="glass-btn flex-1 py-2.5 text-emerald-400 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:text-white"><i data-lucide="radar" class="w-3 h-3"></i> Tham khảo</button>
        </div>
        <button onclick="openAssetGallery('${asset.id}', '${safeName}', ${index})" class="glass-btn w-full py-2.5 text-indigo-400 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:text-white mt-1"><i data-lucide="image" class="w-3 h-3"></i> Kho Ảnh TSBĐ</button>`;
        list.appendChild(el);
    });
    lucide.createIcons();
}
        function openAssetGallery(id, name, idx) {
    // Logic tạo ID nếu chưa có (cho data cũ)
    if (!id || id === 'undefined') {
        id = 'asset_' + Date.now();
        if(currentCustomerData.assets[idx]) {
            currentCustomerData.assets[idx].id = id;
            db.transaction(['customers'], 'readwrite').objectStore('customers').put(currentCustomerData);
        }
    }
    
    currentAssetId = id;
    
    // Hiển thị màn hình Gallery
    getEl('screen-asset-gallery').classList.remove('translate-x-full');
    
    // Lấy thông tin tài sản đang chọn từ bộ nhớ (để đảm bảo chính xác nhất)
    const asset = currentCustomerData.assets[idx];
    
    if (asset) {
        // --- SỬA LỖI Ở ĐÂY: Giải mã dữ liệu trước khi hiển thị ---
        // 1. Tên tài sản (Giải mã từ object asset thay vì dùng tham số name có thể bị lỗi)
        getEl('gallery-asset-name').textContent = decryptText(asset.name);
        
        // 2. Định giá & Vay Max (Giải mã)
        getEl('gallery-asset-val').textContent = decryptText(asset.valuation) || '--';
        getEl('gallery-asset-loan').textContent = decryptText(asset.loanValue) || '--';
        
        // Kiểm tra link Drive của tài sản
        if (typeof renderAssetDriveStatus === "function") {
            renderAssetDriveStatus(asset.driveLink);
        }
    } else {
        // Fallback nếu không tìm thấy tài sản
        getEl('gallery-asset-name').textContent = name; // Dùng tạm tên truyền vào
        getEl('gallery-asset-val').textContent = '--';
        getEl('gallery-asset-loan').textContent = '--';
        if (typeof renderAssetDriveStatus === "function") renderAssetDriveStatus(null);
    }
    
    // Gọi hàm load ảnh
    loadAssetImages(id);
}
        function closeAssetGallery() { getEl('screen-asset-gallery').classList.add('translate-x-full'); currentAssetId = null; isSelectionMode = false; selectedImages.clear(); updateSelectionUI(); }
        
        function openAssetModal() { 
            getEl('asset-modal').classList.remove('hidden'); getEl('edit-asset-index').value = ""; getEl('modal-title-asset').textContent = "Thêm TSBĐ"; getEl('btn-save-asset').textContent = "Thêm mới"; 
            getEl('asset-name').value=''; getEl('asset-link').value=''; getEl('asset-val').value=''; getEl('asset-loan').value=''; getEl('asset-area').value=''; getEl('asset-width').value=''; getEl('asset-onland').value=''; getEl('asset-year').value=''; 
        }
        function openEditAssetModal(index) { 
    // Hiện modal
    getEl('asset-modal').classList.remove('hidden'); 
    
    // Lấy tài sản đang chọn
    const asset = currentCustomerData.assets[index]; 
    
    // Setup tiêu đề modal
    getEl('edit-asset-index').value = index; 
    getEl('modal-title-asset').textContent = "Cập nhật TSBĐ"; 
    getEl('btn-save-asset').textContent = "Lưu thay đổi"; 
    
    // --- QUAN TRỌNG: Giải mã dữ liệu trước khi điền vào ô input ---
    // Nếu không có decryptText, nó sẽ hiện chuỗi U2FsdGVk...
    getEl('asset-name').value = decryptText(asset.name); 
    getEl('asset-link').value = decryptText(asset.link) || ''; 
    getEl('asset-val').value = decryptText(asset.valuation) || ''; 
    getEl('asset-loan').value = decryptText(asset.loanValue) || '';
    
    getEl('asset-area').value = decryptText(asset.area) || ''; 
    getEl('asset-width').value = decryptText(asset.width) || ''; 
    getEl('asset-onland').value = decryptText(asset.onland) || ''; 
    getEl('asset-year').value = decryptText(asset.year) || '';
    
    // Giải mã cả dữ liệu OCR cũ (nếu có)
    getEl('asset-ocr-data').value = decryptText(asset.ocrData) || '';
    
    // Gán ID để xử lý ảnh đúng tài sản
    currentAssetId = asset.id;
}
        function closeAssetModal() { getEl('asset-modal').classList.add('hidden'); }
        
        function openGuideModal() { getEl('guide-modal').classList.remove('hidden'); }
        function closeGuideModal() { getEl('guide-modal').classList.add('hidden'); }
        function toggleSelectionMode() { isSelectionMode = !isSelectionMode; selectedImages.clear(); updateSelectionUI(); if(!getEl('screen-asset-gallery').classList.contains('translate-x-full')) loadAssetImages(currentAssetId); else loadProfileImages(); }
        function updateSelectionUI() { const btns = [getEl('btn-select-mode'), getEl('btn-select-mode-asset')]; const bar = getEl('selection-bar'); const count = getEl('selection-count'); if(isSelectionMode) { btns.forEach(b=>{if(b) b.classList.add('btn-active')}); bar.classList.remove('translate-y-full'); bar.classList.add('translate-y-0'); } else { btns.forEach(b=>{if(b) b.classList.remove('btn-active')}); bar.classList.add('translate-y-full'); bar.classList.remove('translate-y-0'); } if(count) count.textContent = selectedImages.size; }
        function toggleImage(id, div) { if(selectedImages.has(id)) { selectedImages.delete(id); div.classList.remove('selected'); } else { selectedImages.add(id); div.classList.add('selected'); } getEl('selection-count').textContent = selectedImages.size; }
        function deleteSelectedImages() { if(!selectedImages.size) return; if(!confirm(`Xóa ${selectedImages.size} ảnh?`)) return; const tx = db.transaction(['images'], 'readwrite'); selectedImages.forEach(id => tx.objectStore('images').delete(id)); tx.oncomplete = () => { showToast("Đã xóa"); toggleSelectionMode(); }; }
        function handleFileUpload(input, mode) {
    const files = input.files;
    if (!files || !files.length) return;
    
    // Ghi chế độ ảnh (profile = hồ sơ / asset = tài sản)
    captureMode = mode || 'profile';
    
    // Duyệt từng ảnh
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const base64 = e.target.result;
            await saveImageToDB(base64);
        };
        reader.readAsDataURL(file);
    });
    
    // Reset input để lần sau chọn lại vẫn trigger onchange
    input.value = "";
}
        function closeCamera() { getEl('camera-modal').classList.add('hidden'); if(stream) stream.getTracks().forEach(t=>t.stop()); }
        // CHỤP ẢNH TỪ CAMERA + OCR TRƯỚC KHI NÉN
        function shareOpenedImage() { if(!currentImageBase64) return; fetch(currentImageBase64).then(res => res.blob()).then(blob => { if(navigator.canShare) navigator.share({files:[new File([blob], "evidence.jpg", {type:"image/jpeg"})]}); }); }
        function deleteOpenedImage() { if(confirm("Hủy chứng từ này?")) { db.transaction(['images'], 'readwrite').objectStore('images').delete(currentImageId).onsuccess = () => { closeLightbox(); if(currentAssetId && getEl('screen-asset-gallery').classList.contains('translate-x-full') === false) loadAssetImages(currentAssetId); else loadProfileImages(); }; } }
        function toggleMenu() { const m=getEl('settings-menu'); const o=getEl('menu-overlay'); if(m.classList.contains('hidden')){m.classList.remove('hidden');o.classList.remove('hidden'); setTimeout(()=>{m.classList.remove('scale-95','opacity-0');},10)}else{m.classList.add('scale-95','opacity-0'); setTimeout(()=>{m.classList.add('hidden');o.classList.add('hidden');},200)} }
        // ============================================================
function openDonateModal() {
    const modal = getEl('donate-modal');
    const img = getEl('donate-qr-img');
    if (img && !img.src) {
        img.src = buildDonateQRUrl(); // tạo QR VietQR “xịn” đúng STK + tên
    }
    modal.classList.remove('hidden');
}
function closeDonateModal() {
    const modal = getEl('donate-modal');
    if (modal) modal.classList.add('hidden');
}
        function initWeather() {
            // hiển thị nhanh từ cache nếu có
            const cacheRaw = localStorage.getItem(WEATHER_STORAGE_KEY);
            if (cacheRaw) {
                try {
                    const cache = JSON.parse(cacheRaw);
                    if (Date.now() - cache.time < WEATHER_CACHE_TTL) {
                        renderWeather(cache.data);
                    }
                } catch (e) {
                    console.warn('Weather cache error', e);
                }
            }
            // sau đó gọi GPS để cập nhật mới
            refreshWeather();
        }
        function refreshWeather() {
            if (!navigator.geolocation) {
                setWeatherText('Thiết bị không hỗ trợ GPS');
                return;
            }

            setWeatherText('Đang lấy vị trí...');

            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const lat = pos.coords.latitude;
                    const lon = pos.coords.longitude;
                    fetchWeather(lat, lon);
                },
                (err) => {
                    console.warn('GPS weather error', err);
                    setWeatherText('Không lấy được GPS');
                },
                { enableHighAccuracy: true, timeout: 8000, maximumAge: 5 * 60 * 1000 }
            );
        }
        function setWeatherText(text) {
            const el = getEl('current-weather');
            if (el) el.textContent = text;
        }
        function fetchWeather(lat, lon) {
            setWeatherText('Đang tải thời tiết...');

            // Open-Meteo API: không cần API key
            const url =
                'https://api.open-meteo.com/v1/forecast' +
                `?latitude=${lat}` +
                `&longitude=${lon}` +
                '&current_weather=true' +
                '&timezone=auto';

            fetch(url)
                .then((res) => {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                })
                .then((data) => {
                    try {
                        localStorage.setItem(
                            WEATHER_STORAGE_KEY,
                            JSON.stringify({ time: Date.now(), data })
                        );
                    } catch (e) {
                        console.warn('Weather cache save error', e);
                    }
                    renderWeather(data);
                })
                .catch((err) => {
                    console.error('Weather fetch error', err);
                    setWeatherText('Lỗi tải thời tiết');
                });
        }
        function renderWeather(apiData) {
            if (!apiData || !apiData.current_weather) {
                setWeatherText('Không có dữ liệu');
                return;
            }

            const cw = apiData.current_weather;
            const temp = Math.round(cw.temperature); // °C
            const code = cw.weathercode;
            const desc = WEATHER_CODE_TEXT[code] || 'Thời tiết hiện tại';

            setWeatherText(`${temp}°C • ${desc}`);
        }
function parseRedBookInfo(text) {
    // Trả về đối tượng rỗng (OCR parser đã bỏ)
    return {};
}
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
function closeModal() {
    getEl('add-modal').classList.add('hidden');
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
function openQrScanner() { 
    qrMode = 'cccd'; 
    document.getElementById('qr-modal').classList.remove('hidden'); 
    startMyScanner(); 
}
function openRedBookScanner() { 
    qrMode = 'redbook'; 
    document.getElementById('qr-modal').classList.remove('hidden'); 
    startMyScanner(); 
}
function handleCccdResult(data) {
    let idNum = '';
    let name = '';
    
    try {
        // Cấu trúc CCCD Chip: 001097005097|123456789|PHAM HOANG NAM|...
        // parts[0]: Số CCCD
        // parts[1]: Số CMND cũ (Code cũ đang nhầm lấy cái này làm tên)
        // parts[2]: Họ và tên (Cần lấy cái này)

        if (data.includes('|')) {
            const parts = data.split('|');
            
            idNum = parts[0] ? parts[0].trim() : '';
            
            // SỬA Ở ĐÂY: Đổi từ parts[1] thành parts[2]
            name = parts[2] ? parts[2].trim().toUpperCase() : ''; 
        } else {
            // Trường hợp dự phòng nếu không phải QR CCCD chuẩn
            idNum = data.trim();
        }
        
        // Điền vào ô Số CCCD
        if (idNum) {
            const cccdInput = document.getElementById('new-cccd');
            if (cccdInput) cccdInput.value = idNum;
        }
        
        // Điền vào ô Tên Khách Hàng
        if (name) {
            const nameInput = document.getElementById('new-name');
            if (nameInput) nameInput.value = name;
        }

    } catch (e) {
        console.error("Lỗi phân tích QR:", e);
        // Nếu lỗi thì vẫn điền chuỗi gốc vào ô CCCD để người dùng tự sửa
        const cccdInput = document.getElementById('new-cccd');
        if (cccdInput) cccdInput.value = data;
    }
}
function handleRedBookResult(data) {
    // 1. Vẫn lưu chuỗi gốc vào ô ẨN để tính năng "Xem thông tin bìa" hoạt động
    // (Nếu không lưu dòng này, nút xem lại thông tin sẽ bị trắng trơn)
    const hiddenInput = document.getElementById('asset-ocr-data');
    if (hiddenInput) hiddenInput.value = data;

    // 2. Xóa trắng ô "Vị trí/Ghi chú" (Không điền chuỗi dài vào đây nữa theo yêu cầu)
    const noteInput = document.getElementById('asset-onland');
    if (noteInput) noteInput.value = ''; 

    // 3. Logic tách lấy "Số bìa đỏ" (AQ 04258571)
    let redBookNum = '';
    
    // ƯU TIÊN 1: Tách theo dấu gạch đứng | (Chuẩn VNeID/ILIS)
    if (data.includes('|')) {
        const parts = data.split('|');
        // Trong ví dụ bạn gửi: 05...|H44...|ILIS...|H44...|AQ 04258571|...
        // Nó nằm ở vị trí thứ 5 (tức là index 4)
        if (parts[4] && parts[4].length > 4) {
            redBookNum = parts[4].trim();
        }
    } 
    
    // ƯU TIÊN 2: Nếu cách trên trượt, dùng Regex quét tìm mẫu (2 chữ hoa + số)
    // Ví dụ: Tìm đoạn giống "AQ 04258571" hoặc "CS 123456"
    if (!redBookNum) {
        const match = data.match(/([A-Z]{2}\s*[0-9]{6,9})/);
        if (match) redBookNum = match[1];
    }

    // 4. Điền kết quả vào ô "Tên Tài Sản"
    const nameInput = document.getElementById('asset-name');
    if (nameInput) {
        if (redBookNum) {
            // Điền số bìa vào
            nameInput.value = "Bìa đỏ " + redBookNum; 
            showToast('Đã lấy số bìa: ' + redBookNum);
        } else {
            // Nếu không tìm thấy số bìa trong QR thì điền tạm chữ này
            nameInput.value = "Bìa đỏ (Chưa rõ số)";
            showToast('Đã quét (Không tìm thấy số bìa)');
        }
    }
}
function parseRedBookInfo(text) { return {}; }
function renderRedBookInfo(info) { return ''; }
(function() {
        // Capture references to original functions so we can call them later without recursion.
        const _org = {};
        [
            'openModal','closeModal','openFolder','closeFolder','openAssetGallery','closeAssetGallery',
            'openAssetModal','openEditAssetModal','closeAssetModal','showRefModal','closeRefModal',
            'toggleMap','openQrScanner','openRedBookScanner','closeQrScanner','toggleCustSelectionMode',
            'toggleSelectionMode','viewSavedOcr','openLightbox','closeLightbox','openEditCustomerModal'
        ].forEach(fn => {
            if (typeof window[fn] === 'function') {
                _org[fn] = window[fn];
            }
        });

        // Helper to push a new history state. Uses a descriptive hash to aid debugging.
        function pushState(stateObj, hash) {
            try {
                history.pushState(stateObj, null, hash);
            } catch (e) {
                // Some environments may block pushState; ignore silently.
            }
        }

        // Override functions that open UI elements to push a history entry.
        if (_org.openModal) {
            window.openModal = function() {
                _org.openModal.apply(this, arguments);
                pushState({ screen: 'add-modal' }, '#add-modal');
            };
        }
        if (_org.openEditCustomerModal) {
            window.openEditCustomerModal = function() {
                _org.openEditCustomerModal.apply(this, arguments);
                pushState({ screen: 'add-modal' }, '#edit-customer');
            };
        }
        if (_org.closeModal) {
            window.closeModal = function() {
                // When closing from UI, go back one history entry instead of closing immediately.
                history.back();
            };
        }
        if (_org.openFolder) {
            window.openFolder = function(id) {
                _org.openFolder.apply(this, arguments);
                pushState({ screen: 'screen-folder', id: id }, '#folder-' + id);
            };
        }
        if (_org.closeFolder) {
            window.closeFolder = function() {
                history.back();
            };
        }
        if (_org.openAssetGallery) {
            window.openAssetGallery = function(id, name, idx) {
                _org.openAssetGallery.apply(this, arguments);
                pushState({ screen: 'screen-asset-gallery', id: id }, '#asset-gallery-' + id);
            };
        }
        if (_org.closeAssetGallery) {
            window.closeAssetGallery = function() {
                history.back();
            };
        }
        if (_org.openAssetModal) {
            window.openAssetModal = function() {
                _org.openAssetModal.apply(this, arguments);
                pushState({ screen: 'asset-modal' }, '#asset-modal');
            };
        }
        if (_org.openEditAssetModal) {
            window.openEditAssetModal = function() {
                _org.openEditAssetModal.apply(this, arguments);
                pushState({ screen: 'asset-modal' }, '#asset-modal');
            };
        }
        if (_org.closeAssetModal) {
            window.closeAssetModal = function() {
                history.back();
            };
        }
        if (_org.showRefModal) {
            window.showRefModal = function() {
                _org.showRefModal.apply(this, arguments);
                pushState({ screen: 'ref-price-modal' }, '#ref-price-modal');
            };
        }
        if (_org.closeRefModal) {
            window.closeRefModal = function() {
                history.back();
            };
        }
        // Map toggling: open pushes a state, close triggers history.back()
        if (_org.toggleMap) {
            window.toggleMap = function() {
                const mapScreen = document.getElementById('screen-map');
                const isHidden = mapScreen && mapScreen.classList.contains('translate-x-full');
                if (isHidden) {
                    _org.toggleMap.apply(this, arguments);
                    pushState({ screen: 'screen-map' }, '#screen-map');
                } else {
                    history.back();
                }
            };
        }
        // QR scanner openings
        if (_org.openQrScanner) {
            window.openQrScanner = function() {
                _org.openQrScanner.apply(this, arguments);
                pushState({ screen: 'qr-modal' }, '#qr-scanner');
            };
        }
        if (_org.openRedBookScanner) {
            window.openRedBookScanner = function() {
                _org.openRedBookScanner.apply(this, arguments);
                pushState({ screen: 'qr-modal' }, '#qr-redbook');
            };
        }
        if (_org.closeQrScanner) {
            window.closeQrScanner = function() {
                history.back();
            };
        }
        // Customer selection bar toggle
        if (_org.toggleCustSelectionMode) {
            window.toggleCustSelectionMode = function() {
                const bar = document.getElementById('cust-selection-bar');
                const visible = bar && !bar.classList.contains('translate-y-full');
                if (!visible) {
                    // Open bar normally then push state
                    _org.toggleCustSelectionMode.apply(this, arguments);
                    pushState({ screen: 'cust-selection-bar' }, '#cust-selection-bar');
                } else {
                    // Close via history
                    history.back();
                }
            };
        }
        // Image selection bar toggle
        if (_org.toggleSelectionMode) {
            window.toggleSelectionMode = function() {
                const bar = document.getElementById('selection-bar');
                const visible = bar && !bar.classList.contains('translate-y-full');
                if (!visible) {
                    _org.toggleSelectionMode.apply(this, arguments);
                    pushState({ screen: 'selection-bar' }, '#selection-bar');
                } else {
                    history.back();
                }
            };
        }
        // Lightbox open/close
        if (_org.openLightbox) {
            window.openLightbox = function(src, id, idx, list) {
                _org.openLightbox.apply(this, arguments);
                pushState({ screen: 'lightbox', id: id }, '#lightbox');
            };
        }
        if (_org.closeLightbox) {
            window.closeLightbox = function() {
                history.back();
            };
        }
        // Dynamic QR info popup: wrap viewSavedOcr
        if (_org.viewSavedOcr) {
            window.viewSavedOcr = function(assetId) {
                _org.viewSavedOcr.apply(this, arguments);
                pushState({ screen: 'qr-info', id: assetId }, '#qrinfo-' + assetId);
                // After overlay is added to DOM, tag it and override its close button
                setTimeout(() => {
                    const overlays = document.querySelectorAll('div.fixed.inset-0');
                    overlays.forEach(overlay => {
                        if (!overlay.dataset || overlay.dataset.historyHandled) return;
                        // Identify QR info by heading content
                        if (overlay.innerHTML && overlay.innerHTML.includes('Thông tin QR')) {
                            overlay.dataset.historyHandled = 'true';
                            const buttons = overlay.querySelectorAll('button');
                            buttons.forEach(btn => {
                                const text = (btn.textContent || btn.innerText || '').trim();
                                if (text === 'Đóng') {
                                    btn.onclick = function(ev) {
                                        ev.preventDefault();
                                        history.back();
                                    };
                                }
                            });
                        }
                    });
                }, 0);
            };
        }
        // Handle back/forward navigation by closing the topmost open UI element.
        window.addEventListener('popstate', function() {
            // 1. Dynamic QR popup
            const dyn = document.querySelector('div[data-history-handled="true"]');
            if (dyn) {
                dyn.remove();
                return;
            }
            // 2. Lightbox
            const lb = document.getElementById('lightbox');
            if (lb && !lb.classList.contains('hidden')) {
                if (_org.closeLightbox) _org.closeLightbox();
                return;
            }
            // 3. QR modal
            const qrModal = document.getElementById('qr-modal');
            if (qrModal && !qrModal.classList.contains('hidden')) {
                if (_org.closeQrScanner) _org.closeQrScanner();
                return;
            }
            // 4. Asset modal
            const assetModal = document.getElementById('asset-modal');
            if (assetModal && !assetModal.classList.contains('hidden')) {
                if (_org.closeAssetModal) _org.closeAssetModal();
                return;
            }
            // 5. Reference modal
            const refModal = document.getElementById('ref-price-modal');
            if (refModal && !refModal.classList.contains('hidden')) {
                if (_org.closeRefModal) _org.closeRefModal();
                return;
            }
            // 6. Add customer modal
            const addModal = document.getElementById('add-modal');
            if (addModal && !addModal.classList.contains('hidden')) {
                if (_org.closeModal) _org.closeModal();
                return;
            }
            // 7. Customer selection bar
            const custBar = document.getElementById('cust-selection-bar');
            if (custBar && !custBar.classList.contains('translate-y-full')) {
                if (_org.toggleCustSelectionMode) _org.toggleCustSelectionMode();
                return;
            }
            // 8. Image selection bar
            const selBar = document.getElementById('selection-bar');
            if (selBar && !selBar.classList.contains('translate-y-full')) {
                if (_org.toggleSelectionMode) _org.toggleSelectionMode();
                return;
            }
            // 9. Asset gallery screen
            const ag = document.getElementById('screen-asset-gallery');
            if (ag && !ag.classList.contains('translate-x-full')) {
                if (_org.closeAssetGallery) _org.closeAssetGallery();
                return;
            }
            // 10. Folder screen
            const sf = document.getElementById('screen-folder');
            if (sf && !sf.classList.contains('translate-x-full')) {
                if (_org.closeFolder) _org.closeFolder();
                return;
            }
            // 11. Map screen
            const sm = document.getElementById('screen-map');
            if (sm && !sm.classList.contains('translate-x-full')) {
                if (_org.toggleMap) _org.toggleMap();
                return;
            }
            // If none matched, no UI is open; do nothing.
        });
    })();
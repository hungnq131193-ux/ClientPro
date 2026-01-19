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

        // Gửi dữ liệu KH đã chọn sang user khác (gói .cpb được mã hóa, không lộ dữ liệu)
        async function sendSelectedCustomersToUser() {
            if (selectedCustomers.size === 0) return alert('Chưa chọn KH');

            // Gate bảo mật: bắt buộc xin GLOBAL KDATA từ server trước khi đóng gói
            if (typeof ensureBackupSecret === 'function') {
                const sec = await ensureBackupSecret();
                // Lưu ý: APP_BACKUP_KDATA_B64U được khai báo bằng "let" ở scope global -> KHÔNG nằm trên window.
                if (!sec || !sec.ok || !APP_BACKUP_KDATA_B64U) {
                    alert(
                        `BẢO MẬT: ${sec && sec.message ? sec.message : 'Không thể lấy khóa bảo mật.'}\n\nVui lòng kết nối mạng và thử lại.`
                    );
                    return;
                }
            } else if (!APP_BACKUP_KDATA_B64U) {
                alert('BẢO MẬT: Không thể gửi khi đang Offline hoặc chưa xác thực với Server.');
                return;
            }

                // Ưu tiên AES-GCM WebCrypto (encryptBackupPayload).
                if (typeof encryptBackupPayload !== 'function') {
                    alert('Thiếu cơ chế mã hóa (WebCrypto).');
                return;
            }

            if (!window.CloudTransferUI || typeof CloudTransferUI.sendEncryptedRecord !== 'function') {
                alert('Chưa sẵn sàng chức năng gửi user (Cloud Transfer).');
                return;
            }

            _closeMenuIfOpen && _closeMenuIfOpen();
            getEl('loader').classList.remove('hidden');
            getEl('loader-text').textContent = 'Đóng gói & mã hóa...';

            try {
                const custIds = Array.from(selectedCustomers);

                // Ưu tiên dùng BackupCore (đã chuẩn hóa: bỏ ảnh, bỏ driveLink, giải mã để đóng gói)
                let exportPayload = null;
                if (window.BackupCore && typeof BackupCore.exportCustomersByIds === 'function') {
                    exportPayload = await BackupCore.exportCustomersByIds(custIds);
                } else {
                    // Fallback: lấy thô + tự giải mã cơ bản (name/phone/cccd)
                    const tx = db.transaction(['customers'], 'readonly');
                    const store = tx.objectStore('customers');
                    const out = [];
                    for (const id of custIds) {
                        // eslint-disable-next-line no-await-in-loop
                        const c = await new Promise((r) => {
                            const req = store.get(id);
                            req.onsuccess = (e) => r(e.target.result || null);
                            req.onerror = () => r(null);
                        });
                        if (c) {
                            const cust = JSON.parse(JSON.stringify(c));
                            try {
                                cust.name = decryptText(cust.name);
                                cust.phone = decryptText(cust.phone);
                                if (cust.cccd) cust.cccd = decryptText(cust.cccd);
                            } catch (e) {}
                            cust.driveLink = null;
                            out.push(cust);
                        }
                    }
                    exportPayload = { v: 1.1, customers: out, images: [] };
                }

                // Đảm bảo version
                if (!exportPayload.v) exportPayload.v = 1.1;

                const rawStr = JSON.stringify(exportPayload);
                const hashNew = (typeof hashString === 'function') ? await hashString(rawStr) : '';

                const encrypted = await encryptBackupPayload(rawStr, APP_BACKUP_KDATA_B64U, { type: 'partial_customers', count: custIds.length });

                // Sanity check: tuyệt đối không gửi plaintext JSON khách hàng
                if (!encrypted || (/("customers"\s*:)/.test(encrypted) && !/"magic"\s*:\s*"CLIENTPRO_CPB"/.test(encrypted))) {
                    throw new Error('Gói gửi không hợp lệ (có dấu hiệu chưa mã hóa).');
                }

                const deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : 'device';
                const dateStr = (typeof _formatYYYYMMDD === 'function') ? _formatYYYYMMDD(Date.now()) : String(Date.now());
                const hashShort = (hashNew || '').slice(0, 10) || String(Date.now());
                const filename = `CLIENTPRO_PARTIAL_${deviceId}_${dateStr}_${custIds.length}KH_${hashShort}.cpb`;

                const sizeBytes = new Blob([encrypted]).size;
                const rec = {
                    id: `partial_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    filename,
                    createdAt: Date.now(),
                    size: sizeBytes,
                    deviceId,
                    hash: hashNew || '',
                    encrypted,
                    meta: { type: 'partial_customers', count: custIds.length }
                };

                getEl('loader-text').textContent = 'Chọn user nhận...';
                await CloudTransferUI.sendEncryptedRecord(rec);

                showToast && showToast('Đã gửi gói khách hàng (mã hóa)');
                toggleCustSelectionMode();
            } catch (e) {
                console.error(e);
                alert(e && e.message ? e.message : 'Không thể gửi');
            } finally {
                getEl('loader').classList.add('hidden');
            }
        }
        function deleteSelectedCustomers() {
            if(selectedCustomers.size === 0) return; if(!confirm(`Xóa vĩnh viễn ${selectedCustomers.size} khách hàng?`)) return;
            const tx = db.transaction(['customers', 'images'], 'readwrite'); const custStore = tx.objectStore('customers'); const imgStore = tx.objectStore('images');
            selectedCustomers.forEach(custId => { custStore.delete(custId); imgStore.index('customerId').getAllKeys(custId).onsuccess = e => { e.target.result.forEach(imgId => imgStore.delete(imgId)); }; });
            tx.oncomplete = () => { showToast("Đã xóa"); toggleCustSelectionMode(); };
        }

        function switchListTab(tab) {
            activeListTab = tab; const tabPending = getEl('list-tab-pending'); const tabApproved = getEl('list-tab-approved');
            if(tab === 'pending') { tabPending.className = "flex-1 py-2.5 text-[11px] font-bold uppercase rounded-lg transition-all duration-300 bg-white/10 text-white shadow-md border border-white/10"; tabApproved.className = "flex-1 py-2.5 text-[11px] font-bold uppercase rounded-lg transition-all duration-300 text-slate-400 hover:text-white"; } 
            else { tabPending.className = "flex-1 py-2.5 text-[11px] font-bold uppercase rounded-lg transition-all duration-300 text-slate-400 hover:text-white"; tabApproved.className = "flex-1 py-2.5 text-[11px] font-bold uppercase rounded-lg transition-all duration-300 bg-emerald-500/10 text-emerald-400 shadow-md border border-emerald-500/20"; }
            loadCustomers(getEl('search-input').value);
        }
        function loadCustomers(query = '') {
            if (!db) return;
            const tx = db.transaction(['customers'], 'readonly');
            tx.objectStore('customers').getAll().onsuccess = (e) => {
                let list = e.target.result || [];
                // Tối ưu: chỉ giải mã trường cần thiết cho LIST để tránh giật/đơ (assets sẽ giải mã khi mở folder)
                list.forEach(c => {
                    if (!c.assets) c.assets = [];
                    if (!c.status) c.status = 'pending';
                    if (typeof decryptCustomerSummary === 'function') decryptCustomerSummary(c);
                    else decryptCustomerObject(c);
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
        function renderList(list) {
    const listEl = getEl('customer-list'); if(!listEl) return; listEl.innerHTML = '';
    if (list.length === 0) { listEl.innerHTML = `<div class="text-center py-32 opacity-40 flex flex-col items-center"><i data-lucide="inbox" class="w-16 h-16 mb-4 stroke-1"></i><p class="text-xs font-bold uppercase tracking-wider">Danh sách trống</p></div>`; lucide.createIcons(); return; }
    
    const svgCheck = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    
    const frag = document.createDocumentFragment();
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
        frag.appendChild(el);
    });
    listEl.appendChild(frag);
    lucide.createIcons();
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


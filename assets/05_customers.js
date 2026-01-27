function toggleCustSelectionMode() {
    isCustSelectionMode = !isCustSelectionMode; selectedCustomers.clear();
    const bar = getEl('cust-selection-bar'); const btn = getEl('btn-cust-select');
    if (isCustSelectionMode) { bar.classList.remove('translate-y-full'); bar.classList.add('translate-y-0'); btn.classList.add('btn-active'); }
    else { bar.classList.add('translate-y-full'); bar.classList.remove('translate-y-0'); btn.classList.remove('btn-active'); }
    getEl('cust-selection-count').textContent = '0'; loadCustomers(getEl('search-input').value);
}
function toggleCustomerSelection(id, div) {
    if (selectedCustomers.has(id)) { selectedCustomers.delete(id); div.classList.remove('selected'); } else { selectedCustomers.add(id); div.classList.add('selected'); }
    getEl('cust-selection-count').textContent = selectedCustomers.size;
}
async function backupSelectedCustomers() {
    if (selectedCustomers.size === 0) return alert("Chưa chọn KH");
    getEl('loader').classList.remove('hidden'); getEl('loader-text').textContent = "Đóng gói...";
    const custIds = Array.from(selectedCustomers); const exportData = { customers: [], images: [] };
    const tx = db.transaction(['customers', 'images'], 'readonly'); const custStore = tx.objectStore('customers'); const imgStore = tx.objectStore('images');
    for (const id of custIds) { const cust = await new Promise(r => { const req = custStore.get(id); req.onsuccess = e => r(e.target.result); req.onerror = () => r(null); }); if (cust) exportData.customers.push(cust); }
    const allImages = await new Promise(r => { const req = imgStore.getAll(); req.onsuccess = e => r(e.target.result || []); req.onerror = () => r([]); });
    exportData.images = allImages.filter(img => custIds.includes(img.customerId));
    const blob = new Blob([JSON.stringify({ v: 1.0, ...exportData })], { type: 'application/json' });
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
                    } catch (e) { }
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
    if (selectedCustomers.size === 0) return; if (!confirm(`Xóa vĩnh viễn ${selectedCustomers.size} khách hàng?`)) return;
    const tx = db.transaction(['customers', 'images'], 'readwrite'); const custStore = tx.objectStore('customers'); const imgStore = tx.objectStore('images');
    selectedCustomers.forEach(custId => { custStore.delete(custId); imgStore.index('customerId').getAllKeys(custId).onsuccess = e => { e.target.result.forEach(imgId => imgStore.delete(imgId)); }; });
    tx.oncomplete = () => { showToast("Đã xóa"); toggleCustSelectionMode(); };
}

function switchListTab(tab) {
    activeListTab = tab;
    loadCustomers(getEl('search-input').value);
}

// ============================================================
// FOLDER-BASED NAVIGATION
// ============================================================

function openCustomerList(type) {
    activeListTab = type;

    const screen = getEl('screen-customer-list');
    const dashboard = getEl('screen-dashboard');
    const titleEl = getEl('customer-list-title');

    if (!screen) return;

    // Set title based on type
    if (titleEl) {
        titleEl.textContent = type === 'approved' ? 'Khách hàng đã vay' : 'KH đang thẩm định';
    }

    // Show screen with slide animation
    screen.classList.remove('hidden');
    setTimeout(() => {
        screen.classList.remove('translate-x-full');
        if (dashboard) dashboard.style.transform = 'translateX(-30%)';
    }, 10);

    // Load customers for this type
    loadCustomers('');
    try { lucide.createIcons(); } catch (e) { }
}

function closeCustomerList() {
    const screen = getEl('screen-customer-list');
    const dashboard = getEl('screen-dashboard');

    if (!screen) return;

    screen.classList.add('translate-x-full');
    if (dashboard) dashboard.style.transform = '';

    setTimeout(() => {
        screen.classList.add('hidden');
        // Refresh folder counts when returning to home
        updateFolderCounts();
    }, 300);
}

// Update folder counts on home screen
async function updateFolderCounts() {
    if (!db) return;

    try {
        const list = await new Promise((resolve) => {
            const tx = db.transaction(['customers'], 'readonly');
            const req = tx.objectStore('customers').getAll();
            req.onsuccess = (e) => resolve(e.target.result || []);
            req.onerror = () => resolve([]);
        });

        let approvedCount = 0;
        let pendingCount = 0;

        list.forEach(c => {
            if (c && c.status === 'approved') approvedCount++;
            else pendingCount++;
        });

        const approvedEl = getEl('count-approved');
        const pendingEl = getEl('count-pending');

        if (approvedEl) approvedEl.textContent = approvedCount;
        if (pendingEl) pendingEl.textContent = pendingCount;
    } catch (e) { }
}

// =======================
// PERF: CUSTOMER LIST
// - Cache decrypt summary theo signature (tránh decrypt lặp khi search/chuyển tab)
// - Render theo batch (rAF) để tránh block UI
// - Chỉ gọi lucide.createIcons() 1 lần sau khi render xong
// =======================
const __custSummaryCache = window.__custSummaryCache || (window.__custSummaryCache = new Map());
// CryptoJS.AES.encrypt(passphrase) thường tạo ciphertext base64 bắt đầu bằng "U2FsdGVk".
// Khi app chưa unlock masterKey, decryptText() sẽ trả nguyên ciphertext.
// Nếu cache nhầm ciphertext, UI sẽ hiển thị chuỗi mã hóa ngay cả sau khi unlock.
function _looksEncrypted(v) {
    return (typeof v === 'string') && v.startsWith('U2FsdGVk');
}
function _custSig(c) {
    // Dùng ciphertext làm signature để không cần decrypt khi so sánh
    return `${c && c.id ? c.id : ''}|${c && c.name ? c.name : ''}|${c && c.phone ? c.phone : ''}|${c && c.cccd ? c.cccd : ''}|${c && c.status ? c.status : ''}|${c && c.creditLimit ? c.creditLimit : ''}`;
}

async function loadCustomers(query = '') {
    if (!db) return;
    const q = (query || '').trim();

    // Optional: hiển thị placeholder nhẹ để tránh cảm giác "đơ"
    const listEl = getEl('customer-list');
    if (listEl && !listEl.dataset.loading) {
        listEl.dataset.loading = '1';
    }

    const list = await new Promise((resolve) => {
        const tx = db.transaction(['customers'], 'readonly');
        const req = tx.objectStore('customers').getAll();
        req.onsuccess = (e) => resolve(e.target.result || []);
        req.onerror = () => resolve([]);
    });

    let out = list || [];
    // Tối ưu: chỉ giải mã trường cần thiết cho LIST (assets sẽ giải mã khi mở folder)
    const batch = 50;
    for (let i = 0; i < out.length; i++) {
        const c = out[i];
        if (!c) continue;
        if (!c.assets) c.assets = [];
        if (!c.status) c.status = 'pending';

        const sig = _custSig(c);
        const cached = __custSummaryCache.get(c.id);

        // Chỉ dùng cache khi chắc chắn đã giải mã (tránh cache ciphertext lúc chưa unlock).
        if (cached && cached.sig === sig && cached.ok === true) {
            c.name = cached.name;
            c.phone = cached.phone;
            c.cccd = cached.cccd;
        } else {
            if (typeof decryptCustomerSummary === 'function') decryptCustomerSummary(c);
            else decryptCustomerObject(c);

            const ok = !_looksEncrypted(c.name) && !_looksEncrypted(c.phone) && !_looksEncrypted(c.cccd);
            if (ok) {
                __custSummaryCache.set(c.id, { sig, name: c.name, phone: c.phone, cccd: c.cccd, ok: true });
            } else {
                // Nếu vẫn là ciphertext (chưa unlock), không cache để lần sau unlock sẽ decrypt lại.
                __custSummaryCache.delete(c.id);
            }
        }

        // yield theo batch để tránh block main-thread
        if ((i + 1) % batch === 0) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(r) : setTimeout(r, 0)));
        }
    }

    // Lọc theo tab trạng thái
    out = out.filter(c => c && c.status === activeListTab);
    if (q) {
        const qq = q.toLowerCase();
        out = out.filter(c => {
            const nameMatch = (c.name || '').toLowerCase().includes(qq);
            const phoneMatch = (c.phone || '').includes(qq);
            return nameMatch || phoneMatch;
        });
    }
    out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    renderList(out);
}

function renderList(list) {
    const listEl = getEl('customer-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    delete listEl.dataset.loading;

    if (!list || list.length === 0) {
        listEl.innerHTML = `<div class="text-center py-32 opacity-40 flex flex-col items-center"><i data-lucide="inbox" class="w-16 h-16 mb-4 stroke-1"></i><p class="text-xs font-bold uppercase tracking-wider">Danh sách trống</p></div>`;
        try { lucide.createIcons(); } catch (e) { }
        return;
    }

    const svgCheck = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

    let i = 0;
    const CHUNK = 18;

    const renderChunk = () => {
        const frag = document.createDocumentFragment();
        const end = Math.min(i + CHUNK, list.length);

        for (; i < end; i++) {
            const c = list[i];
            const isApproved = activeListTab === 'approved';
            const el = document.createElement('div');

            // Lite glass panel cho list để giảm GPU cost (blur/shadow)
            el.className = `glass-panel-lite cust-card ${isApproved ? 'cust-approved' : 'cust-pending'} p-4 rounded-2xl mb-3 flex items-center gap-4 transition-all duration-200 hover:bg-white/5 active:scale-[0.98] ${isCustSelectionMode && selectedCustomers.has(c.id) ? 'selected' : ''}`;

            el.onclick = (e) => {
                if (e.target && e.target.closest && e.target.closest('.action-btn')) return;
                if (isCustSelectionMode) toggleCustomerSelection(c.id, el);
                else openFolder(c.id);
            };

            const limitHtml = isApproved
                ? `<p class="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded mt-1.5 w-fit border border-emerald-500/20 tracking-wider">HM: ${c.creditLimit || '0'}</p>`
                : `<p class="text-[10px] text-slate-400 mt-1 italic opacity-60">Đang thẩm định...</p>`;
            const checkIcon = isCustSelectionMode ? `<div class="select-ring">${svgCheck}</div>` : '';

            // Escape dynamic values to prevent XSS
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

            frag.appendChild(el);
        }

        listEl.appendChild(frag);

        if (i < list.length) {
            requestAnimationFrame(renderChunk);
        } else {
            try { lucide.createIcons(); } catch (e) { }
        }
    };

    requestAnimationFrame(renderChunk);
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

// Open modal to edit current customer (from folder view pencil button)
function openEditCustomerModal() {
    if (!currentCustomerData) {
        alert('Không có dữ liệu khách hàng để sửa.');
        return;
    }

    getEl('add-modal').classList.remove('hidden');

    // Fill form with current customer data
    getEl('new-name').value = currentCustomerData.name || '';
    getEl('new-phone').value = currentCustomerData.phone || '';
    if (getEl('new-cccd')) getEl('new-cccd').value = currentCustomerData.cccd || '';
    getEl('edit-cust-id').value = currentCustomerData.id || '';

    // Update modal title and button
    getEl('modal-title-cust').textContent = "Chỉnh sửa hồ sơ";
    getEl('btn-save-cust').textContent = "Cập nhật";

    getEl('new-name').focus();
}

// Close customer create/edit modal (used by the X button and edge-swipe back).
// Kept intentionally lightweight to avoid side-effects on other flows.
function closeModal() {
    const m = getEl('add-modal');
    if (!m) return;
    m.classList.add('hidden');
    try { document.activeElement && document.activeElement.blur && document.activeElement.blur(); } catch (e) { }
}

// =======================
// DUPLICATE DETECTION
// Check if CCCD or Phone already exists in another customer
// =======================
async function checkDuplicateCustomer(cccd, phone, excludeId = null) {
    if (!db) return { duplicate: false };

    const cccdNorm = (cccd || '').replace(/\s+/g, '').trim();
    const phoneNorm = (phone || '').replace(/\s+/g, '').trim();

    // Skip check if both are empty
    if (!cccdNorm && !phoneNorm) return { duplicate: false };

    return new Promise((resolve) => {
        const tx = db.transaction(['customers'], 'readonly');
        const store = tx.objectStore('customers');
        const req = store.getAll();

        req.onsuccess = (e) => {
            const customers = e.target.result || [];

            for (const c of customers) {
                // Skip the customer being edited
                if (excludeId && c.id === excludeId) continue;

                // Decrypt fields for comparison
                let custCccd = '';
                let custPhone = '';
                let custName = '';

                try {
                    custCccd = (typeof decryptText === 'function' ? decryptText(c.cccd) : c.cccd) || '';
                    custPhone = (typeof decryptText === 'function' ? decryptText(c.phone) : c.phone) || '';
                    custName = (typeof decryptText === 'function' ? decryptText(c.name) : c.name) || '';
                } catch (err) {
                    // If decryption fails, use raw (might be plaintext or unreadable)
                    custCccd = c.cccd || '';
                    custPhone = c.phone || '';
                    custName = c.name || '';
                }

                // Normalize for comparison
                custCccd = custCccd.replace(/\s+/g, '').trim();
                custPhone = custPhone.replace(/\s+/g, '').trim();

                // Check CCCD match (only if input has value)
                if (cccdNorm && custCccd && cccdNorm === custCccd) {
                    resolve({
                        duplicate: true,
                        field: 'cccd',
                        existingCustomer: { id: c.id, name: custName, phone: custPhone, cccd: custCccd }
                    });
                    return;
                }

                // Check Phone match (only if input has value)
                if (phoneNorm && custPhone && phoneNorm === custPhone) {
                    resolve({
                        duplicate: true,
                        field: 'phone',
                        existingCustomer: { id: c.id, name: custName, phone: custPhone, cccd: custCccd }
                    });
                    return;
                }
            }

            resolve({ duplicate: false });
        };

        req.onerror = () => resolve({ duplicate: false });
    });
}

// Show duplicate warning UI
function showDuplicateWarning(result, onIgnore, onViewCustomer) {
    const fieldLabel = result.field === 'cccd' ? 'CCCD' : 'SĐT';
    const existing = result.existingCustomer;

    // Create warning overlay
    let overlay = getEl('dup-warning-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'dup-warning-overlay';
        overlay.className = 'fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm';
        document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
                <div class="glass-panel w-full max-w-sm rounded-2xl p-6 shadow-2xl modal-animate">
                    <div class="flex items-center gap-3 mb-4 text-amber-400">
                        <i data-lucide="alert-triangle" class="w-8 h-8"></i>
                        <h3 class="font-bold text-lg">Phát hiện trùng lặp!</h3>
                    </div>
                    <div class="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-5">
                        <p class="text-sm text-amber-200 mb-3">
                            <strong>${fieldLabel}</strong> này đã tồn tại trong hệ thống:
                        </p>
                        <div class="bg-black/20 rounded-lg p-3">
                            <p class="font-bold text-white text-base">${escapeHTML(existing.name || 'Không tên')}</p>
                            <p class="text-xs text-slate-400 mt-1">
                                <span class="inline-flex items-center gap-1"><i data-lucide="smartphone" class="w-3 h-3"></i> ${escapeHTML(existing.phone || 'N/A')}</span>
                            </p>
                            <p class="text-xs text-slate-400 mt-0.5">
                                <span class="inline-flex items-center gap-1"><i data-lucide="id-card" class="w-3 h-3"></i> ${escapeHTML(existing.cccd || 'N/A')}</span>
                            </p>
                        </div>
                    </div>
                    <div class="flex gap-3">
                        <button id="dup-btn-view" class="flex-1 py-3 rounded-xl font-bold text-sm bg-white/10 border border-white/20 text-white active:scale-[0.98] transition-transform">
                            <i data-lucide="folder-open" class="w-4 h-4 inline mr-1"></i> Xem KH
                        </button>
                        <button id="dup-btn-ignore" class="flex-1 py-3 rounded-xl font-bold text-sm text-white active:scale-[0.98] transition-transform" style="background: var(--accent-gradient);">
                            Bỏ qua & Lưu
                        </button>
                    </div>
                    <button id="dup-btn-cancel" class="w-full mt-3 py-2.5 text-sm text-slate-400 hover:text-white transition-colors">
                        Hủy
                    </button>
                </div>
            `;

    overlay.classList.remove('hidden');
    try { lucide.createIcons({ icons: { 'alert-triangle': lucide.icons['alert-triangle'], 'smartphone': lucide.icons['smartphone'], 'id-card': lucide.icons['id-card'], 'folder-open': lucide.icons['folder-open'] }, attrs: {} }); } catch (e) { try { lucide.createIcons(); } catch (e2) { } }

    // Event handlers
    getEl('dup-btn-view').onclick = () => {
        overlay.classList.add('hidden');
        onViewCustomer && onViewCustomer(existing.id);
    };

    getEl('dup-btn-ignore').onclick = () => {
        overlay.classList.add('hidden');
        onIgnore && onIgnore();
    };

    getEl('dup-btn-cancel').onclick = () => {
        overlay.classList.add('hidden');
    };
}

// Create / Update customer (called from add-modal.html: onclick="saveCustomer()")
// IMPORTANT: Must keep existing data schema and encryption behavior.
async function saveCustomer() {
    try {
        // Security gate: nếu chưa có masterKey thì không cho tạo/sửa để tránh lưu plaintext.
        if (typeof masterKey === 'undefined' || !masterKey) {
            alert('BẢO MẬT: Chưa mở khóa dữ liệu. Vui lòng đăng nhập/mở khóa trước khi tạo hồ sơ.');
            return;
        }

        const nameEl = getEl('new-name');
        const phoneEl = getEl('new-phone');
        const cccdEl = getEl('new-cccd');
        const idEl = getEl('edit-cust-id');

        const name = (nameEl && nameEl.value ? String(nameEl.value) : '').trim();
        const phone = (phoneEl && phoneEl.value ? String(phoneEl.value) : '').trim();
        const cccd = (cccdEl && cccdEl.value ? String(cccdEl.value) : '').trim();
        const editId = (idEl && idEl.value ? String(idEl.value) : '').trim();

        if (!name) {
            alert('Vui lòng nhập Tên khách hàng.');
            try { nameEl && nameEl.focus && nameEl.focus(); } catch (e) { }
            return;
        }

        // Phone có thể để trống (tùy user), nhưng nếu có thì chuẩn hóa số.
        const phoneNorm = phone.replace(/\s+/g, '');

        // =======================
        // DUPLICATE CHECK
        // =======================
        const dupResult = await checkDuplicateCustomer(cccd, phoneNorm, editId || null);

        if (dupResult.duplicate) {
            // Show warning and let user decide
            showDuplicateWarning(
                dupResult,
                // onIgnore: proceed with save anyway
                () => _doSaveCustomer(name, phoneNorm, cccd, editId),
                // onViewCustomer: close modal and open existing customer
                (existingId) => {
                    closeModal();
                    openFolder(existingId);
                }
            );
            return; // Don't proceed, wait for user decision
        }

        // No duplicate, proceed with save
        _doSaveCustomer(name, phoneNorm, cccd, editId);

    } catch (err) {
        console.error(err);
        alert('Có lỗi xảy ra khi lưu hồ sơ.');
    }
}

// Internal save function (called after duplicate check passes or user ignores warning)
function _doSaveCustomer(name, phoneNorm, cccd, editId) {
    try {
        const makeId = () => `cust_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const tx = db.transaction(['customers'], 'readwrite');
        const store = tx.objectStore('customers');

        tx.onerror = () => {
            alert('Lỗi lưu hồ sơ. Vui lòng thử lại.');
        };

        const finalize = (savedId) => {
            closeModal();
            try { showToast(editId ? 'Đã cập nhật hồ sơ' : 'Đã tạo hồ sơ'); } catch (e) { }
            // Refresh list (giữ nguyên search hiện tại nếu có)
            try { loadCustomers(getEl('search-input') ? getEl('search-input').value : ''); } catch (e) { try { loadCustomers(); } catch (e2) { } }
            // UX: tạo mới xong vào luôn folder để thao tác tiếp
            if (!editId && savedId) {
                try { openFolder(savedId); } catch (e) { }
            }
        };

        if (editId) {
            // Update existing record: giữ lại assets/status/creditLimit/driveLink/createdAt...
            const req = store.get(editId);
            req.onsuccess = (e) => {
                const old = e.target.result;
                if (!old) {
                    alert('Không tìm thấy hồ sơ để cập nhật.');
                    return;
                }

                old.name = encryptText(name);
                old.phone = encryptText(phoneNorm);
                old.cccd = encryptText(cccd);
                // Defensive defaults
                if (!old.status) old.status = 'pending';
                if (!old.assets) old.assets = [];
                if (old.creditLimit === undefined) old.creditLimit = '';
                if (old.driveLink === undefined) old.driveLink = null;

                store.put(old).onsuccess = () => finalize(editId);
            };
            req.onerror = () => alert('Lỗi đọc hồ sơ để cập nhật.');
        } else {
            // Create new record
            const newId = makeId();
            const rec = {
                id: newId,
                name: encryptText(name),
                phone: encryptText(phoneNorm),
                cccd: encryptText(cccd),
                createdAt: Date.now(),
                status: 'pending',
                creditLimit: '',
                assets: [],
                driveLink: null,
            };

            store.put(rec).onsuccess = () => finalize(newId);
        }
    } catch (err) {
        console.error(err);
        alert('Có lỗi xảy ra khi lưu hồ sơ.');
    }
}

function deleteCurrentCustomer() {
    if (!confirm("XÁC NHẬN: Xóa toàn bộ hồ sơ khách hàng này?")) return;
    try {
        const tx = db.transaction(['images', 'customers'], 'readwrite'); const imgStore = tx.objectStore('images'); const custStore = tx.objectStore('customers');
        if (imgStore.indexNames.contains('customerId')) { imgStore.index('customerId').getAllKeys(currentCustomerId).onsuccess = (e) => { e.target.result.forEach(key => imgStore.delete(key)); }; }
        custStore.delete(currentCustomerId); tx.oncomplete = () => { closeFolder(); showToast("Đã xóa hồ sơ"); loadCustomers(); };
    } catch (err) { window.location.reload(); }
}

function deleteAsset(idx) {
    if (!confirm("Xóa tài sản này?")) return; currentCustomerData.assets.splice(idx, 1);
    db.transaction(['customers'], 'readwrite').objectStore('customers').put(currentCustomerData).onsuccess = () => { showToast("Đã xóa TSBĐ"); renderAssets(); };
}

function toggleCustomerStatus() { if (currentCustomerData.status === 'pending') { getEl('approve-modal').classList.remove('hidden'); getEl('approve-limit').value = ''; } else { if (confirm("Thu hồi trạng thái?")) { currentCustomerData.status = 'pending'; updateCustomerAndReload(); } } }
function closeApproveModal() { getEl('approve-modal').classList.add('hidden'); }
function confirmApproval() { const l = getEl('approve-limit').value; if (!l) return alert("Nhập hạn mức!"); currentCustomerData.status = 'approved'; currentCustomerData.creditLimit = l; closeApproveModal(); db.transaction(['customers'], 'readwrite').objectStore('customers').put(currentCustomerData).onsuccess = () => { showToast("Đã duyệt"); renderFolderHeader(currentCustomerData); loadCustomers(getEl('search-input').value); }; }
function updateCustomerAndReload() { db.transaction(['customers'], 'readwrite').objectStore('customers').put(currentCustomerData).onsuccess = () => { openFolder(currentCustomerData.id); loadCustomers(); }; }

function renderFolderHeader(data) {
    getEl('folder-customer-name').textContent = data.name; getEl('folder-avatar').textContent = data.name.charAt(0).toUpperCase(); getEl('btn-detail-call').href = `tel:${data.phone}`; getEl('btn-detail-zalo').href = getZaloLink(data.phone);
    const badge = getEl('detail-status-badge');
    if (data.status === 'approved') { badge.className = "px-4 py-2 rounded-lg text-xs font-bold border flex items-center gap-2 active:scale-95 transition-transform uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-lg shadow-emerald-500/10"; badge.innerHTML = `<i data-lucide="badge-check" class="w-3.5 h-3.5"></i> <span>${data.creditLimit}</span>`; }
    else { badge.className = "px-4 py-2 rounded-lg text-xs font-bold border flex items-center gap-2 active:scale-95 transition-transform uppercase tracking-wider bg-indigo-500/10 text-indigo-400 border-indigo-500/20"; badge.innerHTML = `<i data-lucide="hourglass" class="w-3.5 h-3.5"></i> <span>THẨM ĐỊNH</span>`; } lucide.createIcons();
}

function openFolder(id) {
    currentCustomerId = id;
    const folderScreen = getEl('screen-folder');

    // Check if db is ready
    if (!db) {
        console.error('openFolder: db not ready');
        return;
    }

    try {
        // Fetch data FIRST, then show folder with data ready
        const tx = db.transaction(['customers'], 'readonly');
        const req = tx.objectStore('customers').get(id);

        req.onsuccess = (e) => {
            currentCustomerData = e.target.result;
            if (!currentCustomerData) {
                console.error('openFolder: customer not found:', id);
                return;
            }

            // Decrypt summary fields
            try {
                if (typeof decryptCustomerSummary === 'function') decryptCustomerSummary(currentCustomerData);
                else {
                    currentCustomerData.name = decryptText(currentCustomerData.name);
                    currentCustomerData.phone = decryptText(currentCustomerData.phone);
                    currentCustomerData.cccd = decryptText(currentCustomerData.cccd);
                }
                currentCustomerData.driveLink = decryptText(currentCustomerData.driveLink);
            } catch (err) { console.error('openFolder decrypt error:', err); }

            // Fix old data if missing fields
            if (!currentCustomerData.status) currentCustomerData.status = 'pending';
            if (!currentCustomerData.assets) currentCustomerData.assets = [];

            // Clear previous content
            const imgArea = getEl('content-images');
            const assetArea = getEl('content-assets');
            if (imgArea) { imgArea.innerHTML = ''; imgArea.scrollTop = 0; }
            if (assetArea) { assetArea.innerHTML = ''; assetArea.scrollTop = 0; }

            // Render header with ACTUAL data (not placeholder)
            renderFolderHeader(currentCustomerData);

            // Render Drive status
            if (typeof renderDriveStatus === "function") {
                renderDriveStatus(currentCustomerData.driveLink || null);
            }

            // Reset selection mode
            isSelectionMode = false;
            if (typeof selectedImages !== 'undefined') selectedImages.clear();
            if (typeof updateSelectionUI === 'function') updateSelectionUI();

            // Switch to info tab and load info data BEFORE showing folder
            switchTab('info');
            loadCustomerInfo();

            // NOW show folder slide-in (data is already populated)
            if (typeof nextFrame === 'function') nextFrame(() => folderScreen.classList.remove('translate-x-full'));
            else folderScreen.classList.remove('translate-x-full');

            // Decrypt assets in background for other tabs
            const runDecryptAssets = async () => {
                try {
                    if (typeof window.decryptCustomerAssetsAsync === 'function') {
                        await window.decryptCustomerAssetsAsync(currentCustomerData, { batchSize: 6 });
                    } else if (typeof window.decryptCustomerObjectAsync === 'function') {
                        await window.decryptCustomerObjectAsync(currentCustomerData, { batchSize: 6 });
                    }
                } catch (err) { }
            };

            if (typeof afterTransition === 'function') afterTransition(folderScreen, runDecryptAssets);
            else setTimeout(runDecryptAssets, 360);
        };

        req.onerror = (e) => {
            console.error('openFolder DB error:', e);
        };
    } catch (err) {
        console.error('openFolder exception:', err);
    }
}
function closeFolder() {
    const folderScreen = getEl('screen-folder');
    const customerListScreen = getEl('screen-customer-list');

    folderScreen.classList.add('translate-x-full');

    // Reset customer ID after animation
    if (typeof afterTransition === 'function') {
        afterTransition(folderScreen, () => {
            currentCustomerId = null;
            // Reload customer list if still visible
            if (customerListScreen && !customerListScreen.classList.contains('hidden') && !customerListScreen.classList.contains('translate-x-full')) {
                const q = (getEl('search-input') && getEl('search-input').value) || '';
                loadCustomers(q);
            }
        });
    } else {
        setTimeout(() => {
            currentCustomerId = null;
            if (customerListScreen && !customerListScreen.classList.contains('hidden') && !customerListScreen.classList.contains('translate-x-full')) {
                const q = (getEl('search-input') && getEl('search-input').value) || '';
                loadCustomers(q);
            }
        }, 360);
    }
}
function switchTab(tabName) {
    const tabInfo = getEl('tab-btn-info');
    const tabImages = getEl('tab-btn-images');
    const tabAssets = getEl('tab-btn-assets');

    const activeClass = "glass-tab-active flex-1 py-2.5 text-xs font-bold uppercase rounded-lg transition-all";
    const inactiveClass = "glass-tab-inactive flex-1 py-2.5 text-xs font-bold uppercase rounded-lg transition-all hover:bg-white/5";

    // Reset all tabs
    if (tabInfo) tabInfo.className = inactiveClass;
    if (tabImages) tabImages.className = inactiveClass;
    if (tabAssets) tabAssets.className = inactiveClass;

    // Hide all content
    const contentInfo = getEl('content-info');
    const contentImages = getEl('content-images');
    const contentAssets = getEl('content-assets');
    const actionsImages = getEl('actions-images');
    const actionsAssets = getEl('actions-assets');

    if (contentInfo) contentInfo.classList.add('hidden');
    if (contentImages) contentImages.classList.add('hidden');
    if (contentAssets) contentAssets.classList.add('hidden');
    if (actionsImages) actionsImages.classList.add('hidden');
    if (actionsAssets) actionsAssets.classList.add('hidden');

    // Show selected tab
    if (tabName === 'info') {
        if (tabInfo) tabInfo.className = activeClass;
        if (contentInfo) contentInfo.classList.remove('hidden');
        loadCustomerInfo();
    } else if (tabName === 'images') {
        if (tabImages) tabImages.className = activeClass;
        if (contentImages) contentImages.classList.remove('hidden');
        if (actionsImages) actionsImages.classList.remove('hidden');
        loadProfileImages();
    } else if (tabName === 'assets') {
        if (tabAssets) tabAssets.className = activeClass;
        if (contentAssets) contentAssets.classList.remove('hidden');
        if (actionsAssets) actionsAssets.classList.remove('hidden');
        renderAssets();
    }


    isSelectionMode = false;
    if (typeof selectedImages !== 'undefined' && selectedImages.clear) selectedImages.clear();
    if (typeof updateSelectionUI === 'function') updateSelectionUI();
}

// Load customer info into Info tab
// Uses currentCustomerData which is already decrypted in openFolder
function loadCustomerInfo() {
    // Use currentCustomerData directly - already loaded and decrypted in openFolder
    if (!currentCustomerData) return;

    const c = currentCustomerData;

    // phone, cccd, name are already decrypted by decryptCustomerSummary in openFolder
    // Only notes needs to be decrypted here
    const phone = c.phone || '--';
    const cccd = c.cccd || '--';
    const notes = decryptText(c.notes) || '';
    const createdAt = c.createdAt ? new Date(c.createdAt).toLocaleDateString('vi-VN') : '--';

    const phoneEl = getEl('info-phone');
    const cccdEl = getEl('info-cccd');
    const createdEl = getEl('info-created');
    const notesEl = getEl('info-notes');

    if (phoneEl) phoneEl.textContent = phone;
    if (cccdEl) cccdEl.textContent = cccd;
    if (createdEl) createdEl.textContent = `Tạo: ${createdAt}`;
    if (notesEl) notesEl.value = notes;

    try { lucide.createIcons(); } catch (e) { }
}

// Save customer notes
async function saveCustomerNotes() {
    if (!currentCustomerId) return;

    const notesEl = getEl('info-notes');
    const notesText = notesEl ? notesEl.value.trim() : '';

    const tx = db.transaction(['customers'], 'readwrite');
    const store = tx.objectStore('customers');
    const req = store.get(currentCustomerId);

    req.onsuccess = (e) => {
        const c = e.target.result;
        if (!c) return;

        // Encrypt notes before saving
        c.notes = encryptText(notesText);
        c.updatedAt = Date.now();

        store.put(c);
        showToast('Đã lưu ghi chú');
    };
}

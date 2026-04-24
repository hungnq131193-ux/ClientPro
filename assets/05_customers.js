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

    // Show screen with slide animation first (ưu tiên mượt animation)
    screen.classList.remove('hidden');
    setTimeout(() => {
        screen.classList.remove('translate-x-full');
        if (dashboard) dashboard.style.transform = 'translateX(-30%)';
    }, 10);

    // Defer load list sang frame sau để tránh block transition
    const kickLoad = () => loadCustomers('');
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(kickLoad));
    } else {
        setTimeout(kickLoad, 16);
    }
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
        renderHomeCustomerColumns(list);
        try { lucide.createIcons(); } catch (e) { }
    } catch (e) { }
}

function renderHomeCustomerColumns(list) {
    const approvedHost = getEl('home-list-approved');
    const pendingHost = getEl('home-list-pending');
    if (!approvedHost || !pendingHost) return;

    const approved = [];
    const pending = [];
    for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (!c) continue;
        _ensureSummaryDecrypted(c);
        if ((c.status || 'pending') === 'approved') approved.push(c);
        else pending.push(c);
    }

    const renderCol = (host, items, type) => {
        host.innerHTML = '';
        if (!items.length) {
            host.innerHTML = `<div class="home-cust-empty">Chưa có hồ sơ</div>`;
            return;
        }
        const frag = document.createDocumentFragment();
        for (let i = 0; i < items.length; i++) {
            const c = items[i];
            const name = escapeHTML((c.name && !_looksEncrypted(c.name)) ? c.name : 'Đang tải...');
            const phone = escapeHTML((c.phone && !_looksEncrypted(c.phone)) ? c.phone : '--');
            const card = document.createElement('div');
            card.className = `home-cust-item ${type}`;
            card.onclick = () => openFolder(c.id);
            card.innerHTML = `
                <div class="home-cust-name">${name}</div>
                <div class="home-cust-phone">${phone}</div>
            `;
            frag.appendChild(card);
        }
        host.appendChild(frag);
    };

    renderCol(approvedHost, approved, 'approved');
    renderCol(pendingHost, pending, 'pending');
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

function _ensureSummaryDecrypted(c) {
    if (!c) return c;
    if (!c.assets) c.assets = [];
    if (!c.status) c.status = 'pending';

    const sig = _custSig(c);
    const cached = __custSummaryCache.get(c.id);
    if (cached && cached.sig === sig && cached.ok === true) {
        c.name = cached.name;
        c.phone = cached.phone;
        c.cccd = cached.cccd;
        return c;
    }

    if (typeof decryptCustomerSummary === 'function') decryptCustomerSummary(c);
    else decryptCustomerObject(c);

    const ok = !_looksEncrypted(c.name) && !_looksEncrypted(c.phone) && !_looksEncrypted(c.cccd);
    if (ok) {
        __custSummaryCache.set(c.id, { sig, name: c.name, phone: c.phone, cccd: c.cccd, ok: true });
    } else {
        __custSummaryCache.delete(c.id);
    }
    return c;
}

async function loadCustomers(query = '') {
    if (!db) return;
    const q = (query || '').trim();
    const loadToken = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    window.__customerListLoadToken = loadToken;

    const listEl = getEl('customer-list');
    if (!listEl) return;
    listEl.dataset.loading = '1';
    listEl.dataset.token = loadToken;
    listEl.innerHTML = `<div class="text-center py-10 opacity-70 text-sm" style="color: var(--text-sub)">Đang tải danh sách khách hàng...</div>`;

    let loaded = 0;
    let rendered = 0;
    const batch = [];
    const BATCH_SIZE = q ? 30 : 18;

    const flushBatch = () => {
        if (!batch.length || window.__customerListLoadToken !== loadToken) return;
        renderList(batch.splice(0, batch.length), { append: rendered > 0, done: false });
        rendered += BATCH_SIZE;
    };

    await new Promise((resolve) => {
        const tx = db.transaction(['customers'], 'readonly');
        const req = tx.objectStore('customers').openCursor(null, 'prev');
        req.onsuccess = async (e) => {
            if (window.__customerListLoadToken !== loadToken) return resolve();
            const cursor = e.target.result;
            if (!cursor) return resolve();

            const c = cursor.value;
            if (!c || (c.status || 'pending') !== activeListTab) {
                cursor.continue();
                return;
            }

            if (q) {
                const qq = q.toLowerCase();
                _ensureSummaryDecrypted(c);
                const nameMatch = (c.name || '').toLowerCase().includes(qq);
                const phoneMatch = (c.phone || '').includes(qq);
                if (!nameMatch && !phoneMatch) {
                    cursor.continue();
                    return;
                }
            }

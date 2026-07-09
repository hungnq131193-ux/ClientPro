// Icon SVG dùng trong danh sách khách hàng — hoist ra module scope để không tạo lại chuỗi mỗi lần render
const SVG_ICONS = Object.freeze({
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    smartphone: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3 h-3 opacity-70"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"></rect><path d="M12 18h.01"></path></svg>`,
    clock: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3 h-3"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
    checkCircle: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3 h-3"><path d="M9 12l2 2 4-4"></path><circle cx="12" cy="12" r="10"></circle></svg>`,
    message: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`,
    phone: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.9 12.9 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.1 9.9a16 16 0 0 0 6 6l1.26-1.26a2 2 0 0 1 2.11-.45 12.9 12.9 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>`,
});

function setCustSelectionMode(enabled, options) {
    const opts = options || {};
    isCustSelectionMode = !!enabled;
    if (isCustSelectionMode && typeof pushSelectionHistoryLayer === 'function') pushSelectionHistoryLayer('customers');
    if (!opts.keepSelection) selectedCustomers.clear();
    if (document.body) document.body.classList.toggle('cust-selection-mode', isCustSelectionMode);
    const bar = getEl('cust-selection-bar');
    if (bar) {
        if (isCustSelectionMode) { bar.classList.remove('translate-y-full'); bar.classList.add('translate-y-0'); }
        else { bar.classList.add('translate-y-full'); bar.classList.remove('translate-y-0'); document.querySelectorAll('.cust-card.selected').forEach((el) => el.classList.remove('selected')); if (typeof clearSelectionHistoryLayer === 'function') clearSelectionHistoryLayer(); }
    }
    const count = getEl('cust-selection-count');
    if (count) count.textContent = selectedCustomers.size;
    if (!opts.skipReload) loadCustomers(getEl('search-input').value);
}
function toggleCustSelectionMode() {
    setCustSelectionMode(!isCustSelectionMode);
}
function toggleCustomerSelection(id, div) {
    if (selectedCustomers.has(id)) { selectedCustomers.delete(id); div.classList.remove('selected'); } else { selectedCustomers.add(id); div.classList.add('selected'); }
    getEl('cust-selection-count').textContent = selectedCustomers.size;
}
// Gửi dữ liệu KH đã chọn sang user khác (gói .cpb được mã hóa, không lộ dữ liệu)
async function sendSelectedCustomersToUser() {
    if (selectedCustomers.size === 0) return ErrorHandler.showError('VALIDATION', 'Vui lòng chọn ít nhất một khách hàng.');

    // Gate bảo mật: bắt buộc xin GLOBAL KDATA từ server trước khi đóng gói
    if (typeof ensureBackupSecret === 'function') {
        const sec = await ensureBackupSecret();
        // Lưu ý: APP_BACKUP_KDATA_B64U được khai báo bằng "let" ở scope global -> KHÔNG nằm trên window.
        if (!sec || !sec.ok || !APP_BACKUP_KDATA_B64U) {
            ErrorHandler.showError('AUTH', `Không lấy được khóa bảo mật: ${sec && sec.message ? sec.message : 'lỗi không xác định'}. Vui lòng kết nối mạng và thử lại.`);
            return;
        }
    } else if (!APP_BACKUP_KDATA_B64U) {
        ErrorHandler.showError('OFFLINE', 'Không thể gửi khi đang ngoại tuyến hoặc chưa xác thực với máy chủ.');
        return;
    }

    // Ưu tiên AES-GCM WebCrypto (encryptBackupPayload).
    if (typeof encryptBackupPayload !== 'function') {
        ErrorHandler.showError('AUTH', 'Thiếu cơ chế mã hóa (WebCrypto) trên thiết bị này.');
        return;
    }

    if (!window.CloudTransferUI || typeof CloudTransferUI.sendEncryptedRecord !== 'function') {
        ErrorHandler.showError('UNKNOWN', 'Chức năng gửi khách hàng chưa sẵn sàng. Vui lòng tải lại trang.');
        return;
    }

    _closeMenuIfOpen && _closeMenuIfOpen();
    LoadingManager.showGlobal('Đóng gói & mã hóa...');

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

        LoadingManager.showGlobal('Chọn người nhận...');
        await CloudTransferUI.sendEncryptedRecord(rec);

        ErrorHandler.showSuccess('Đã gửi gói khách hàng (đã mã hóa)');
        setCustSelectionMode(false);
    } catch (e) {
        ErrorHandler.showError('BACKUP', e && e.message ? e.message : 'Không thể gửi gói khách hàng.', e);
    } finally {
        LoadingManager.hideGlobal(true);
    }
}
async function deleteSelectedCustomers() {
    if (selectedCustomers.size === 0) return;
    if (!(await ErrorHandler.confirm(`Xóa vĩnh viễn ${selectedCustomers.size} khách hàng?`, { title: "Xóa khách hàng", danger: true, confirmText: "Xóa vĩnh viễn" }))) return;
    const tx = db.transaction(['customers', 'images'], 'readwrite'); const custStore = tx.objectStore('customers'); const imgStore = tx.objectStore('images');
    selectedCustomers.forEach(custId => { custStore.delete(custId); imgStore.index('customerId').getAllKeys(custId).onsuccess = e => { e.target.result.forEach(imgId => imgStore.delete(imgId)); }; });
    tx.oncomplete = () => { ErrorHandler.showSuccess("Đã xóa khách hàng đã chọn"); setCustSelectionMode(false); };
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
        titleEl.textContent = type === 'approved' ? 'Khách hàng đã vay' : (type === 'all' ? 'Tất cả khách hàng' : 'KH đang thẩm định');
    }

    // Show screen with slide animation first (ưu tiên mượt animation)
    screen.classList.remove('hidden');
    if (dashboard) dashboard.style.transform = 'translate3d(-30%, 0, 0)';
    if (typeof slideScreenIn === 'function') slideScreenIn(screen);
    else if (typeof nextFrame === 'function') nextFrame(() => screen.classList.remove('translate-x-full'));
    else setTimeout(() => screen.classList.remove('translate-x-full'), 10);

    // Load ngay danh sách (không lazy/defer) để tránh cảm giác trễ khi bấm mở màn hình.
    loadCustomers('');
    try { lucide.createIcons(); } catch (e) { }
}

function closeCustomerList() {
    const screen = getEl('screen-customer-list');
    const dashboard = getEl('screen-dashboard');

    if (!screen) return;

    if (dashboard) dashboard.style.transform = '';
    const finishClose = () => {
        screen.classList.add('hidden');
        // Refresh folder counts when returning to home
        updateFolderCounts();
    };
    if (typeof slideScreenOut === 'function') slideScreenOut(screen, finishClose);
    else {
        screen.classList.add('translate-x-full');
        setTimeout(finishClose, 300);
    }
}

// Update folder counts on home screen
// customersOpt: mảng customers đã đọc sẵn (vd từ loadCustomers) để khỏi getAll lần nữa
async function updateFolderCounts(customersOpt) {
    if (!db && !Array.isArray(customersOpt)) return;

    try {
        const list = Array.isArray(customersOpt) ? customersOpt : await new Promise((resolve) => {
            const tx = db.transaction(['customers'], 'readonly');
            const req = tx.objectStore('customers').getAll();
            req.onsuccess = (e) => resolve(e.target.result || []);
            req.onerror = () => resolve([]);
        });

        let approvedCount = 0;
        let pendingCount = 0;
        let assetCount = 0;

        list.forEach(c => {
            if (c && c.status === 'approved') approvedCount++;
            else pendingCount++;
            if (c && Array.isArray(c.assets)) assetCount += c.assets.length;
        });

        const totalEl = getEl('count-total');
        const approvedEl = getEl('count-approved');
        const pendingEl = getEl('count-pending');
        const assetsEl = getEl('count-assets');

        if (totalEl) totalEl.textContent = list.length;
        if (approvedEl) approvedEl.textContent = approvedCount;
        if (pendingEl) pendingEl.textContent = pendingCount;
        if (assetsEl) assetsEl.textContent = assetCount;
        // Chỉ scan lại icon ở đường gọi cũ (boot/đóng màn hình); đường gọi từ
        // loadCustomers chạy theo từng keystroke search nên bỏ qua cho nhẹ.
        if (!Array.isArray(customersOpt)) {
            try { lucide.createIcons(); } catch (e) { }
        }
    } catch (e) { }
}

// =======================
// PERF: CUSTOMER LIST
// - Cache decrypt summary theo signature (tránh decrypt lặp khi search/chuyển tab)
// - Render theo batch (rAF) để tránh block UI
// - Chỉ gọi lucide.createIcons() 1 lần sau khi render xong
// =======================
const __custSummaryCache = window.__custSummaryCache || (window.__custSummaryCache = new Map());
// _looksEncrypted / _displayPlain / _displayPlainAsync: nguồn duy nhất ở 00_globals.js (v1.5.8).

// Chuẩn hóa tiếng Việt cho tìm kiếm: hạ chữ + bỏ dấu (NFD) + đ->d.
// Cho phép gõ "nguyen" tìm ra "Nguyễn", "da nang" ra "Đà Nẵng".
function _normVi(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD')
        .replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
}
const _stripSpaces = (s) => String(s == null ? '' : s).replace(/\s+/g, '');
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
        // Chỉ số tìm kiếm đã chuẩn hóa (bỏ dấu / bỏ khoảng trắng) — dùng lại qua từng keystroke.
        c._nName = cached.nName; c._nPhone = cached.nPhone; c._nCccd = cached.nCccd;
        return c;
    }

    if (typeof decryptCustomerSummary === 'function') decryptCustomerSummary(c);
    else decryptCustomerObject(c);

    const ok = !_looksEncrypted(c.name) && !_looksEncrypted(c.phone) && !_looksEncrypted(c.cccd);
    if (ok) {
        const nName = _normVi(c.name), nPhone = _stripSpaces(c.phone), nCccd = _stripSpaces(c.cccd);
        __custSummaryCache.set(c.id, { sig, name: c.name, phone: c.phone, cccd: c.cccd, ok: true, nName, nPhone, nCccd });
        c._nName = nName; c._nPhone = nPhone; c._nCccd = nCccd;
    } else {
        __custSummaryCache.delete(c.id);
    }
    return c;
}

async function _ensureSummaryDecryptedAsync(c) {
    if (!c) return c;
    if (!c.assets) c.assets = [];
    if (!c.status) c.status = 'pending';

    const sig = _custSig(c);
    const cached = __custSummaryCache.get(c.id);
    if (cached && cached.sig === sig && cached.ok === true) {
        c.name = cached.name;
        c.phone = cached.phone;
        c.cccd = cached.cccd;
        c._nName = cached.nName; c._nPhone = cached.nPhone; c._nCccd = cached.nCccd;
        return c;
    }

    if (typeof decryptCustomerSummaryAsync === 'function') await decryptCustomerSummaryAsync(c);
    else if (typeof decryptFieldAsync === 'function') {
        c.name = await decryptFieldAsync(c.name);
        c.phone = await decryptFieldAsync(c.phone);
        c.cccd = await decryptFieldAsync(c.cccd);
    } else {
        _ensureSummaryDecrypted(c);
        return c;
    }

    const ok = !_looksEncrypted(c.name) && !_looksEncrypted(c.phone) && !_looksEncrypted(c.cccd);
    if (ok) {
        const nName = _normVi(c.name), nPhone = _stripSpaces(c.phone), nCccd = _stripSpaces(c.cccd);
        __custSummaryCache.set(c.id, { sig, name: c.name, phone: c.phone, cccd: c.cccd, ok: true, nName, nPhone, nCccd });
        c._nName = nName; c._nPhone = nPhone; c._nCccd = nCccd;
    } else {
        __custSummaryCache.delete(c.id);
    }
    return c;
}

async function _decryptSummariesBatch(customers) {
    if (!customers || !customers.length) return;
    await Promise.all(customers.map((c) => _ensureSummaryDecryptedAsync(c)));
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
    // Giữ DOM hiện tại trong lúc đọc IndexedDB để tránh flash trắng/stale khi chuyển màn hoặc tab nhanh.
    if (!listEl.children.length) {
        listEl.innerHTML = `<div class="text-center py-10 opacity-70 text-sm" style="color: var(--text-sub)">Đang tải danh sách khách hàng...</div>`;
    }

    const all = await new Promise((resolve) => {
        const tx = db.transaction(['customers'], 'readonly');
        const req = tx.objectStore('customers').getAll();
        req.onsuccess = (e) => resolve(e.target.result || []);
        req.onerror = () => resolve([]);
    });

    if (window.__customerListLoadToken !== loadToken) return;

    const list = [];
    for (let i = all.length - 1; i >= 0; i--) {
        const c = all[i];
        if (!c) continue;
        if (activeListTab !== 'all' && (c.status || 'pending') !== activeListTab) continue;

        if (q) {
            await _ensureSummaryDecryptedAsync(c);
            // Dùng chỉ số đã chuẩn hóa (cache) -> không tính lại mỗi keystroke.
            const qNorm = _normVi(q);
            const qDigits = _stripSpaces(q);
            const nameMatch = (c._nName || '').includes(qNorm);
            const phoneMatch = (c._nPhone || '').includes(qDigits);
            const cccdMatch = (c._nCccd || '').includes(qDigits);
            if (!nameMatch && !phoneMatch && !cccdMatch) continue;
        }

        list.push(c);
    }

    if (window.__customerListLoadToken !== loadToken) return;

    const summaryCounts = all.reduce((acc, c) => {
        if (!c) return acc;
        if ((c.status || 'pending') === 'approved') acc.approved += 1;
        else acc.pending += 1;
        return acc;
    }, { approved: 0, pending: 0 });

    // Đồng bộ luôn số liệu folder ở home từ dữ liệu vừa đọc (khỏi getAll lần nữa)
    updateFolderCounts(all);

    // Render theo chunk: chunk đầu hiện ngay, phần còn lại rải qua rAF
    // để không block main thread khi danh sách dài.
    const CHUNK_SIZE = 25;
    if (list.length <= CHUNK_SIZE) {
        await _decryptSummariesBatch(list);
        if (window.__customerListLoadToken !== loadToken) return;
        renderList(list, { append: false, done: true, summaryCounts, query: q, totalAll: all.length });
        return;
    }

    const firstChunk = list.slice(0, CHUNK_SIZE);
    await _decryptSummariesBatch(firstChunk);
    if (window.__customerListLoadToken !== loadToken) return;
    renderList(firstChunk, { append: false, done: false, summaryCounts, query: q, totalAll: all.length });
    let renderedCount = CHUNK_SIZE;
    const renderNextChunk = () => {
        // Có lượt load mới (search/đổi tab) -> bỏ các chunk còn lại của lượt cũ
        if (window.__customerListLoadToken !== loadToken) return;
        const chunk = list.slice(renderedCount, renderedCount + CHUNK_SIZE);
        _decryptSummariesBatch(chunk).then(() => {
            if (window.__customerListLoadToken !== loadToken) return;
            renderedCount += chunk.length;
            renderList(chunk, { append: true, done: renderedCount >= list.length, summaryCounts });
            if (renderedCount < list.length) requestAnimationFrame(renderNextChunk);
        });
    };
    requestAnimationFrame(renderNextChunk);
}

function renderList(list, opts = {}) {
    const append = !!opts.append;
    const done = !!opts.done;
    const summaryCounts = opts.summaryCounts || null;
    const listEl = getEl('customer-list');
    if (!listEl) return;
    if (!append) listEl.innerHTML = '';

    const approved = summaryCounts ? summaryCounts.approved : list.filter((c) => (c.status || 'pending') === 'approved').length;
    const pending = summaryCounts ? summaryCounts.pending : (list.length - approved);
    const total = approved + pending;

    // Delegation 1 lần cho nút Zalo trên toàn danh sách (thay vì listener trên từng card)
    if (!listEl.dataset.zaloDelegated) {
        listEl.dataset.zaloDelegated = '1';
        listEl.addEventListener('click', (event) => {
            const zaloBtn = event.target && event.target.closest ? event.target.closest('[data-action="zalo"]') : null;
            if (!zaloBtn || !listEl.contains(zaloBtn)) return;
            event.preventDefault();
            openZaloChat(zaloBtn.dataset.phone || '');
        });
    }

    const frag = document.createDocumentFragment();
    if (!append) {
        const summary = document.createElement('div');
        summary.className = 'customer-list-overview';
        summary.innerHTML = `
            <div class="customer-list-overview__grid">
                <div class="customer-kpi">
                    <p>Tổng hồ sơ</p>
                    <strong>${total}</strong>
                </div>
                <div class="customer-kpi approved">
                    <p>Đã vay</p>
                    <strong>${approved}</strong>
                </div>
                <div class="customer-kpi pending">
                    <p>Thẩm định</p>
                    <strong>${pending}</strong>
                </div>
            </div>
        `;
        frag.appendChild(summary);
    }

    if ((!list || list.length === 0) && !append) {
        // Giữ lại thẻ tổng quan (summary) rồi vẽ empty-state theo ngữ cảnh:
        //  - Đang tìm kiếm mà không có kết quả  → gợi ý xóa tìm kiếm.
        //  - Tab hiện tại trống nhưng vẫn có KH  → gợi ý xem tất cả.
        //  - Chưa có khách hàng nào             → gợi ý thêm mới.
        listEl.appendChild(frag);
        const query = (opts.query || '').trim();
        const totalAll = (typeof opts.totalAll === 'number') ? opts.totalAll : 0;
        if (window.LoadingManager) {
            if (query) {
                LoadingManager.showSearchEmptyState(listEl, {
                    title: 'Không tìm thấy khách hàng',
                    message: `Không có hồ sơ nào khớp với “${query}”. Thử từ khóa hoặc số điện thoại khác.`,
                    actionText: 'Xóa tìm kiếm',
                    onAction: () => { const s = getEl('search-input'); if (s) { s.value = ''; } loadCustomers(''); },
                });
            } else if (totalAll > 0) {
                LoadingManager.showEmptyState(listEl, {
                    icon: 'folder',
                    title: 'Chưa có hồ sơ ở mục này',
                    message: activeListTab === 'approved' ? 'Chưa có khách hàng nào được duyệt.' : 'Chưa có khách hàng nào ở trạng thái thẩm định.',
                    actionText: 'Xem tất cả',
                    onAction: () => { if (typeof openCustomerList === 'function') openCustomerList('all'); else { activeListTab = 'all'; loadCustomers(); } },
                });
            } else {
                LoadingManager.showEmptyState(listEl, {
                    icon: 'users',
                    title: 'Chưa có khách hàng',
                    message: 'Bắt đầu bằng cách tạo hồ sơ khách hàng đầu tiên của bạn.',
                    actionText: 'Thêm khách hàng',
                    onAction: () => { if (typeof openModal === 'function') openModal(); },
                });
            }
        }
        return;
    }
    for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const isApproved = (c.status || 'pending') === 'approved';
        const el = document.createElement('div');
        _ensureSummaryDecrypted(c);

        // Lite glass panel cho list để giảm GPU cost (blur/shadow)
        el.className = `glass-panel-lite cust-card ${isApproved ? 'cust-approved' : 'cust-pending'} ${isCustSelectionMode && selectedCustomers.has(c.id) ? 'selected' : ''}`;

        el.onclick = (e) => {
            if (e.target && e.target.closest && e.target.closest('.action-btn')) return;
            if (isCustSelectionMode) toggleCustomerSelection(c.id, el);
            else openFolder(c.id);
        };

        if (typeof bindLongPress === 'function') {
            bindLongPress(el, (event) => {
                if (event && event.cancelable) event.preventDefault();
                if (typeof clearNativeTextSelection === 'function') clearNativeTextSelection();
                if (!isCustSelectionMode) setCustSelectionMode(true, { keepSelection: true, skipReload: true });
                if (!selectedCustomers.has(c.id)) toggleCustomerSelection(c.id, el);
            }, { ignoreSelector: '.action-btn,button,a,input,textarea,select,label,[data-long-press-ignore]' });
        }

            const statusTone = isApproved ? 'Đã duyệt vay' : 'Đang thẩm định';
            const limitHtml = isApproved
                ? `<div class="flex items-center gap-1.5 mt-2">
                    <span class="customer-chip approved">
                        ${SVG_ICONS.checkCircle} HM: <span class="cl-value"></span>
                    </span>
                   </div>`
                : `<div class="flex items-center gap-1.5 mt-2">
                    <span class="customer-chip pending">
                        ${SVG_ICONS.clock} Đang thẩm định
                    </span>
                   </div>`;
            const checkIcon = isCustSelectionMode ? `<div class="select-ring">${SVG_ICONS.check}</div>` : '';

            // Fallback if data still looks encrypted
            const displayName = (c.name && !_looksEncrypted(c.name)) ? c.name : 'Đang tải...';
            const displayPhone = (c.phone && !_looksEncrypted(c.phone)) ? c.phone : '--';
            const displayInitial = displayName.charAt(0).toUpperCase();

            // Avatar styling - glow for approved
            const avatarClass = isApproved ? 'customer-avatar approved' : 'customer-avatar pending';

            // Static shell only (icons/layout); dynamic customer data is set below via textContent/setAttribute
            el.innerHTML = `
                        ${checkIcon}
                        <div class="${avatarClass} avatar-initial"></div>
                        <div class="customer-card-main">
                            <div class="customer-status-line">${statusTone}</div>
                            <h3 class="customer-name-line"></h3>
                            <p class="customer-phone-line">${SVG_ICONS.smartphone} <span class="phone-value"></span></p>
                            ${limitHtml}
                        </div>
                        <div class="customer-actions">
                            <a data-action="zalo" class="action-btn customer-action-btn zalo">${SVG_ICONS.message}</a>
                            <a data-action="call" class="action-btn customer-action-btn call">${SVG_ICONS.phone}</a>
                        </div>`;

            el.querySelector('.avatar-initial').textContent = displayInitial;
            el.querySelector('.customer-name-line').textContent = displayName;
            el.querySelector('.phone-value').textContent = displayPhone;
            const clValueEl = el.querySelector('.cl-value');
            if (clValueEl) clValueEl.textContent = c.creditLimit || '0';

            const zaloBtn = el.querySelector('[data-action="zalo"]');
            zaloBtn.setAttribute('href', getZaloLink(c.phone));
            zaloBtn.setAttribute('data-phone', c.phone || '');
            el.querySelector('[data-action="call"]').setAttribute('href', getTelLink(c.phone));

        frag.appendChild(el);
    }

    listEl.appendChild(frag);
    if (done) delete listEl.dataset.loading;
    // Tránh scan lại toàn bộ DOM mỗi batch (lucide.createIcons rất tốn khi list lớn)
    if (done) {
        try { lucide.createIcons(); } catch (e) { }
    }
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
async function openEditCustomerModal() {
    if (!currentCustomerData) {
        ErrorHandler.showError('VALIDATION', 'Không có dữ liệu khách hàng để sửa.');
        return;
    }

    getEl('add-modal').classList.remove('hidden');

    // Fill form — async decrypt + guard ciphertext (không đổ cpg1: vào ô input)
    let safeName = '', safePhone = '', safeCccd = '';
    try {
        if (typeof _displayPlainAsync === 'function') {
            [safeName, safePhone, safeCccd] = await Promise.all([
                _displayPlainAsync(currentCustomerData.name, ''),
                _displayPlainAsync(currentCustomerData.phone, ''),
                _displayPlainAsync(currentCustomerData.cccd, ''),
            ]);
        } else {
            safeName = (currentCustomerData.name && !_looksEncrypted(currentCustomerData.name)) ? currentCustomerData.name : '';
            safePhone = (currentCustomerData.phone && !_looksEncrypted(currentCustomerData.phone)) ? currentCustomerData.phone : '';
            safeCccd = (currentCustomerData.cccd && !_looksEncrypted(currentCustomerData.cccd)) ? currentCustomerData.cccd : '';
        }
    } catch (e) { }

    getEl('new-name').value = safeName;
    getEl('new-phone').value = safePhone;
    if (getEl('new-cccd')) getEl('new-cccd').value = safeCccd;
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
        overlay.className = 'fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm';
        document.body.appendChild(overlay);
    }

    overlay.textContent = '';
    const nameEl = el('p', { className: 'font-bold text-white text-base' });
    const phoneEl = el('span', {});
    const cccdEl = el('span', {});
    const panel = el('div', { className: 'glass-panel w-full max-w-sm rounded-2xl p-6 shadow-2xl modal-animate' }, [
        el('div', { className: 'flex items-center gap-3 mb-4 text-amber-400' }, [
            el('i', { dataset: { lucide: 'alert-triangle' }, className: 'w-8 h-8' }),
            el('h3', { className: 'font-bold text-lg', text: 'Phát hiện trùng lặp!' }),
        ]),
        el('div', { className: 'bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-5' }, [
            el('p', { className: 'text-sm text-amber-200 mb-3' }, [
                el('strong', { text: fieldLabel }),
                ` này đã tồn tại trong hệ thống:`,
            ]),
            el('div', { className: 'bg-black/20 rounded-lg p-3' }, [
                nameEl,
                el('p', { className: 'text-xs text-slate-400 mt-1' }, [
                    el('span', { className: 'inline-flex items-center gap-1' }, [
                        el('i', { dataset: { lucide: 'smartphone' }, className: 'w-3 h-3' }),
                        ' ',
                        phoneEl,
                    ]),
                ]),
                el('p', { className: 'text-xs text-slate-400 mt-0.5' }, [
                    el('span', { className: 'inline-flex items-center gap-1' }, [
                        el('i', { dataset: { lucide: 'id-card' }, className: 'w-3 h-3' }),
                        ' ',
                        cccdEl,
                    ]),
                ]),
            ]),
        ]),
        el('div', { className: 'flex gap-3' }, [
            el('button', { id: 'dup-btn-view', className: 'flex-1 py-3 rounded-xl font-bold text-sm bg-white/10 border border-white/20 text-white active:scale-[0.98] transition-transform' }, [
                el('i', { dataset: { lucide: 'folder-open' }, className: 'w-4 h-4 inline mr-1' }),
                ' Xem KH',
            ]),
            el('button', { id: 'dup-btn-ignore', className: 'flex-1 py-3 rounded-xl font-bold text-sm text-white active:scale-[0.98] transition-transform', style: 'background: var(--accent-gradient);', text: 'Bỏ qua & Lưu' }),
        ]),
        el('button', { id: 'dup-btn-cancel', className: 'w-full mt-3 py-2.5 text-sm text-slate-400 hover:text-white transition-colors', text: 'Hủy' }),
    ]);
    overlay.appendChild(panel);

    nameEl.textContent = (typeof _displayPlain === 'function')
        ? _displayPlain(existing.name, 'Không tên')
        : ((existing.name && !_looksEncrypted(existing.name)) ? existing.name : 'Không tên');
    phoneEl.textContent = (typeof _displayPlain === 'function')
        ? _displayPlain(existing.phone, 'N/A')
        : ((existing.phone && !_looksEncrypted(existing.phone)) ? existing.phone : 'N/A');
    cccdEl.textContent = (typeof _displayPlain === 'function')
        ? _displayPlain(existing.cccd, 'N/A')
        : ((existing.cccd && !_looksEncrypted(existing.cccd)) ? existing.cccd : 'N/A');

    overlay.classList.remove('hidden');
    // Async refresh: nếu sync decrypt miss cache, nạp thật rồi cập nhật overlay
    (async () => {
        try {
            if (typeof _displayPlainAsync !== 'function') return;
            const [n, p, c] = await Promise.all([
                _displayPlainAsync(existing.name, 'Không tên'),
                _displayPlainAsync(existing.phone, 'N/A'),
                _displayPlainAsync(existing.cccd, 'N/A'),
            ]);
            if (!getEl('dup-warning-overlay') || getEl('dup-warning-overlay').classList.contains('hidden')) return;
            nameEl.textContent = n;
            phoneEl.textContent = p;
            cccdEl.textContent = c;
        } catch (e) { }
    })();

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

// Create / Update customer (called from add-modal.html via data-action="saveCustomer")
// IMPORTANT: Must keep existing data schema and encryption behavior.
// CHỐNG DOUBLE-SUBMIT: cờ in-flight (set ĐỒNG BỘ trước await đầu tiên) + disable nút
// qua LoadingManager.showButtonLoading — chạm 2 lần trên mạng/máy chậm sẽ không tạo
// 2 hồ sơ trùng (checkDuplicateCustomer không thể thấy record chưa kịp ghi).
let __custSaveInFlight = false;
async function saveCustomer() {
    if (__custSaveInFlight) return;
    __custSaveInFlight = true;
    const saveBtn = getEl('btn-save-cust');
    try { LoadingManager.showButtonLoading(saveBtn, 'Đang lưu...'); } catch (e) { }
    const releaseSaveUi = () => {
        __custSaveInFlight = false;
        try { LoadingManager.hideButtonLoading(saveBtn); } catch (e) { }
    };
    try {
        // Safety check: ensure db is ready
        if (!db) {
            ErrorHandler.showError('STORAGE', 'Cơ sở dữ liệu chưa sẵn sàng. Vui lòng đợi giây lát và thử lại.');
            return;
        }

        // Security gate: nếu chưa có masterKey thì không cho tạo/sửa để tránh lưu plaintext.
        if (typeof masterKey === 'undefined' || !masterKey) {
            ErrorHandler.showError('AUTH', 'Chưa mở khóa dữ liệu. Vui lòng đăng nhập/mở khóa trước khi tạo hồ sơ.');
            return;
        }

        const nameEl = getEl('new-name');
        const phoneEl = getEl('new-phone');
        const cccdEl = getEl('new-cccd');
        const idEl = getEl('edit-cust-id');

        // Check if modal elements exist
        if (!nameEl) {
            ErrorHandler.showError('UNKNOWN', 'Không tìm thấy form nhập liệu. Vui lòng tải lại trang.', 'saveCustomer: Modal elements not found');
            return;
        }

        const name = (nameEl && nameEl.value ? String(nameEl.value) : '').trim();
        const phone = (phoneEl && phoneEl.value ? String(phoneEl.value) : '').trim();
        const cccd = (cccdEl && cccdEl.value ? String(cccdEl.value) : '').trim();
        const editId = (idEl && idEl.value ? String(idEl.value) : '').trim();

        if (!name) {
            ErrorHandler.showError('VALIDATION', 'Vui lòng nhập tên khách hàng.');
            try { nameEl && nameEl.focus && nameEl.focus(); } catch (e) { }
            return;
        }

        // Phone có thể để trống (tùy user), nhưng nếu có thì chuẩn hóa số.
        const phoneNorm = phone.replace(/\s+/g, '');

        // =======================
        // DUPLICATE CHECK
        // =======================
        let dupResult = { duplicate: false };
        try {
            dupResult = await checkDuplicateCustomer(cccd, phoneNorm, editId || null);
        } catch (dupErr) {
            console.warn('Duplicate check failed, proceeding anyway:', dupErr);
        }

        if (dupResult && dupResult.duplicate) {
            // Show warning and let user decide.
            // Nhả guard/nút TRƯỚC khi chờ quyết định của user (overlay cảnh báo che nút Lưu;
            // _doSaveCustomer có guard ghi riêng nên đường onIgnore vẫn chống double-submit).
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

        // No duplicate, proceed with save (await để guard giữ đến khi ghi DB xong)
        await _doSaveCustomer(name, phoneNorm, cccd, editId);

    } catch (err) {
        ErrorHandler.showError('STORAGE', 'Có lỗi xảy ra khi lưu hồ sơ. Vui lòng thử lại.', err);
    } finally {
        releaseSaveUi();
    }
}

// Internal save function (called after duplicate check passes or user ignores warning).
// ASYNC: mã hóa (AES-GCM/WebCrypto) chạy TRƯỚC khi mở transaction IndexedDB —
// không được await giữa một transaction (IDB tự commit/close khi hàng đợi microtask rỗng).
// Guard ghi riêng: bảo vệ cả đường gọi trực tiếp từ cảnh báo trùng (onIgnore).
let __custWriteInFlight = false;
async function _doSaveCustomer(name, phoneNorm, cccd, editId) {
    if (__custWriteInFlight) return;
    __custWriteInFlight = true;
    const saveBtn = getEl('btn-save-cust');
    try { LoadingManager.showButtonLoading(saveBtn, 'Đang lưu...'); } catch (e) { }
    try {
        // Safety check: ensure db is ready before attempting transaction
        if (!db) {
            ErrorHandler.showError('STORAGE', 'Cơ sở dữ liệu chưa sẵn sàng. Vui lòng thử lại sau giây lát.');
            return;
        }

        const makeId = () => `cust_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const finalize = (savedId) => {
            closeModal();
            try { ErrorHandler.showSuccess(editId ? 'Đã cập nhật hồ sơ' : 'Đã tạo hồ sơ'); } catch (e) { }
            // Refresh list (giữ nguyên search hiện tại nếu có)
            try { loadCustomers(getEl('search-input') ? getEl('search-input').value : ''); } catch (e) { try { loadCustomers(); } catch (e2) { } }
            // Nếu đang mở chi tiết hồ sơ vừa sửa, cập nhật UI ngay thay vì đợi chuyển tab/mở lại.
            if (editId && currentCustomerId === editId) {
                try { openFolder(editId); } catch (e) { }
            }
            // UX: tạo mới xong vào luôn folder để thao tác tiếp
            if (!editId && savedId) {
                try { openFolder(savedId); } catch (e) { }
            }
        };

        // 1) Mã hóa các trường TRƯỚC transaction (await an toàn ở đây).
        const encName = await encryptText(name);
        const encPhone = await encryptText(phoneNorm);
        const encCccd = await encryptText(cccd);

        if (editId) {
            // 2a) Đọc record cũ (transaction đọc riêng), giữ lại assets/status/creditLimit/driveLink/createdAt...
            const old = await new Promise((resolve, reject) => {
                const g = db.transaction(['customers'], 'readonly').objectStore('customers').get(editId);
                g.onsuccess = () => resolve(g.result);
                g.onerror = () => reject(g.error);
            });
            if (!old) {
                ErrorHandler.showError('STORAGE', 'Không tìm thấy hồ sơ để cập nhật.');
                return;
            }
            old.name = encName;
            old.phone = encPhone;
            old.cccd = encCccd;
            // Defensive defaults
            if (!old.status) old.status = 'pending';
            if (!old.assets) old.assets = [];
            if (old.creditLimit === undefined) old.creditLimit = '';
            if (old.driveLink === undefined) old.driveLink = null;

            // 3a) Ghi (await tới khi put xong để guard chống double-submit còn hiệu lực).
            await new Promise((resolve, reject) => {
                const wtx = db.transaction(['customers'], 'readwrite');
                const putReq = wtx.objectStore('customers').put(old);
                putReq.onsuccess = () => resolve();
                putReq.onerror = () => reject(putReq.error || new Error('put failed'));
                wtx.onerror = () => reject(wtx.error || new Error('tx failed'));
            });
            finalize(editId);
        } else {
            // 2b/3b) Tạo record mới (đã ở định dạng GCM -> cryptoV:2 để migration bỏ qua).
            const newId = makeId();
            const rec = {
                id: newId,
                name: encName,
                phone: encPhone,
                cccd: encCccd,
                createdAt: Date.now(),
                status: 'pending',
                creditLimit: '',
                assets: [],
                driveLink: null,
                cryptoV: 2,
            };

            await new Promise((resolve, reject) => {
                const wtx = db.transaction(['customers'], 'readwrite');
                const putReq = wtx.objectStore('customers').put(rec);
                putReq.onsuccess = () => resolve();
                putReq.onerror = () => reject(putReq.error || new Error('put failed'));
                wtx.onerror = () => reject(wtx.error || new Error('tx failed'));
            });
            finalize(newId);
        }
    } catch (err) {
        ErrorHandler.showError('STORAGE', 'Có lỗi xảy ra khi lưu hồ sơ. Vui lòng thử lại.', err);
    } finally {
        __custWriteInFlight = false;
        try { LoadingManager.hideButtonLoading(saveBtn); } catch (e) { }
    }
}

async function deleteCurrentCustomer() {
    if (!(await ErrorHandler.confirm("Xóa toàn bộ hồ sơ khách hàng này?", { title: "Xác nhận xóa hồ sơ", danger: true, confirmText: "Xóa hồ sơ" }))) return;
    try {
        const tx = db.transaction(['images', 'customers'], 'readwrite'); const imgStore = tx.objectStore('images'); const custStore = tx.objectStore('customers');
        if (imgStore.indexNames.contains('customerId')) { imgStore.index('customerId').getAllKeys(currentCustomerId).onsuccess = (e) => { e.target.result.forEach(key => imgStore.delete(key)); }; }
        custStore.delete(currentCustomerId); tx.oncomplete = () => { closeFolder(); ErrorHandler.showSuccess("Đã xóa hồ sơ"); loadCustomers(); };
    } catch (err) { window.location.reload(); }
}

async function deleteAsset(idx) {
    if (!(await ErrorHandler.confirm("Xóa tài sản bảo đảm này?", { title: "Xóa tài sản", danger: true, confirmText: "Xóa" }))) return;
    const removed = currentCustomerData.assets.splice(idx, 1)[0];
    persistCurrentCustomer((rec) => { rec.assets = currentCustomerData.assets; }, (ok) => {
        if (!ok) {
            // Ghi DB thất bại: hoàn tác in-memory để UI khớp với dữ liệu thật, KHÔNG báo thành công.
            try { currentCustomerData.assets.splice(idx, 0, removed); } catch (e) { }
            ErrorHandler.showError('STORAGE', 'Xóa tài sản thất bại — dữ liệu CHƯA thay đổi. Vui lòng thử lại.');
            renderAssets();
            return;
        }
        ErrorHandler.showSuccess("Đã xóa tài sản bảo đảm");
        renderAssets();
        // Dọn ảnh của TSBĐ vừa xóa: gallery của nó không còn truy cập được nữa,
        // nếu giữ lại sẽ thành ảnh mồ côi chiếm bộ nhớ vĩnh viễn.
        try {
            if (removed && removed.id) {
                const txImg = db.transaction(['images'], 'readwrite');
                const imgStore = txImg.objectStore('images');
                imgStore.index('customerId').getAll(currentCustomerId).onsuccess = (e) => {
                    (e.target.result || []).forEach((img) => { if (img.assetId === removed.id) imgStore.delete(img.id); });
                };
            }
        } catch (e) { }
    });
}

async function toggleCustomerStatus() { if (currentCustomerData.status === 'pending') { getEl('approve-modal').classList.remove('hidden'); getEl('approve-limit').value = ''; } else { if (await ErrorHandler.confirm("Thu hồi trạng thái đã duyệt của khách hàng này?", { title: "Thu hồi trạng thái", danger: true, confirmText: "Thu hồi" })) { currentCustomerData.status = 'pending'; updateCustomerAndReload(); } } }
function closeApproveModal() { getEl('approve-modal').classList.add('hidden'); }
function confirmApproval() {
    const l = getEl('approve-limit').value;
    if (!l) return ErrorHandler.showError('VALIDATION', "Vui lòng nhập hạn mức.");
    const prevStatus = currentCustomerData.status;
    const prevLimit = currentCustomerData.creditLimit;
    currentCustomerData.status = 'approved';
    currentCustomerData.creditLimit = l;
    closeApproveModal();
    persistCurrentCustomer((rec) => { rec.status = 'approved'; rec.creditLimit = l; }, (ok) => {
        if (!ok) {
            // Ghi DB thất bại: hoàn tác in-memory, báo lỗi thay vì báo "Đã duyệt".
            currentCustomerData.status = prevStatus;
            currentCustomerData.creditLimit = prevLimit;
            ErrorHandler.showError('STORAGE', 'Duyệt khách hàng thất bại — trạng thái CHƯA được lưu. Vui lòng thử lại.');
            return;
        }
        ErrorHandler.showSuccess("Đã duyệt khách hàng");
        renderFolderHeader(currentCustomerData);
        loadCustomers(getEl('search-input').value);
    });
}
function updateCustomerAndReload() {
    persistCurrentCustomer((rec) => { rec.status = currentCustomerData.status; rec.creditLimit = currentCustomerData.creditLimit; }, (ok) => {
        if (!ok) {
            ErrorHandler.showError('STORAGE', 'Cập nhật trạng thái thất bại — dữ liệu CHƯA được lưu. Vui lòng thử lại.');
        }
        // Reload từ DB để UI luôn khớp dữ liệu thật (kể cả khi ghi thất bại).
        openFolder(currentCustomerData.id);
        loadCustomers();
    });
}

function renderFolderHeader(data) {
    if (!data) return;
    // Guard ciphertext: sync decryptText có thể trả nguyên "cpg1:..." khi cache chưa nạp.
    // Không bao giờ hiện chuỗi mã hóa ra tiêu đề hồ sơ / avatar / link gọi.
    const name = (typeof _displayPlain === 'function')
        ? _displayPlain(data.name, 'Đang tải...')
        : ((data.name && !_looksEncrypted(data.name)) ? data.name : 'Đang tải...');
    const phone = (typeof _displayPlain === 'function')
        ? _displayPlain(data.phone, '')
        : ((data.phone && !_looksEncrypted(data.phone)) ? data.phone : '');
    const nameEl = getEl('folder-customer-name');
    const avatarEl = getEl('folder-avatar');
    if (nameEl) nameEl.textContent = name;
    if (avatarEl) avatarEl.textContent = (name && name !== 'Đang tải...') ? name.charAt(0).toUpperCase() : '?';
    const callBtn = getEl('btn-detail-call');
    const zaloBtn = getEl('btn-detail-zalo');
    if (callBtn) callBtn.href = getTelLink(phone);
    if (zaloBtn) {
        zaloBtn.href = getZaloLink(phone);
        zaloBtn.onclick = () => { openZaloChat(phone); return false; };
    }
    const badge = getEl('detail-status-badge');
    if (!badge) return;
    if (data.status === 'approved') {
        badge.className = "px-4 py-2 rounded-lg text-xs font-bold border flex items-center gap-2 active:scale-95 transition-transform uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-lg shadow-emerald-500/10";
        badge.innerHTML = `<i data-lucide="badge-check" class="w-3.5 h-3.5"></i> <span class="badge-value"></span>`;
        const bv = badge.querySelector('.badge-value');
        if (bv) bv.textContent = data.creditLimit;
    } else {
        badge.className = "px-4 py-2 rounded-lg text-xs font-bold border flex items-center gap-2 active:scale-95 transition-transform uppercase tracking-wider bg-indigo-500/10 text-indigo-400 border-indigo-500/20";
        badge.innerHTML = `<i data-lucide="hourglass" class="w-3.5 h-3.5"></i> <span>THẨM ĐỊNH</span>`;
    }
    try { lucide.createIcons(); } catch (e) { }
}

function openFolder(id) {
    currentCustomerId = id;
    const folderScreen = getEl('screen-folder');

    // Check if db is ready
    if (!db) {
        ErrorHandler.showError('STORAGE', 'Dữ liệu chưa sẵn sàng. Vui lòng thử lại sau giây lát.', 'openFolder: db not ready');
        return;
    }

    try {
        // Fetch data FIRST, then show folder with data ready
        const tx = db.transaction(['customers'], 'readonly');
        const req = tx.objectStore('customers').get(id);

        req.onsuccess = (e) => {
            currentCustomerData = e.target.result;
            if (!currentCustomerData) {
                ErrorHandler.showError('STORAGE', 'Không tìm thấy hồ sơ khách hàng.', 'openFolder: customer not found: ' + id);
                return;
            }

            // Fix old data if missing fields
            if (!currentCustomerData.status) currentCustomerData.status = 'pending';
            if (!currentCustomerData.assets) currentCustomerData.assets = [];

            // Clear previous content
            const imgArea = getEl('content-images');
            const assetArea = getEl('content-assets');
            if (imgArea) { imgArea.innerHTML = ''; imgArea.scrollTop = 0; }
            if (assetArea) { assetArea.innerHTML = ''; assetArea.scrollTop = 0; }

            // Sync best-effort decrypt for immediate header (may still be ciphertext on
            // GCM cache-miss — renderFolderHeader guards with _displayPlain).
            try {
                if (typeof decryptCustomerSummary === 'function') decryptCustomerSummary(currentCustomerData);
                else {
                    currentCustomerData.name = decryptText(currentCustomerData.name);
                    currentCustomerData.phone = decryptText(currentCustomerData.phone);
                    currentCustomerData.cccd = decryptText(currentCustomerData.cccd);
                }
                currentCustomerData.driveLink = decryptText(currentCustomerData.driveLink);
            } catch (err) { ErrorHandler.logError('openFolder decrypt error', err); }

            renderFolderHeader(currentCustomerData);

            if (typeof renderDriveStatus === "function") {
                renderDriveStatus(currentCustomerData.driveLink || null);
            }

            isSelectionMode = false;
            if (typeof selectedImages !== 'undefined') selectedImages.clear();
            if (typeof updateSelectionUI === 'function') updateSelectionUI();

            switchTab('info');

            if (typeof slideScreenIn === 'function') slideScreenIn(folderScreen);
            else if (typeof nextFrame === 'function') nextFrame(() => folderScreen.classList.remove('translate-x-full'));
            else folderScreen.classList.remove('translate-x-full');

            // Lazy decrypt (v1.5.8): prime summary + notes + TSBĐ fields, rồi re-render
            // header + tab đang mở để thay "Đang tải..." / ciphertext transient bằng plaintext.
            const runDecryptAssets = async () => {
                try {
                    // Summary async — sửa cache-miss của name/phone/cccd trên header
                    if (typeof decryptCustomerSummaryAsync === 'function') {
                        await decryptCustomerSummaryAsync(currentCustomerData);
                    } else if (typeof decryptFieldAsync === 'function') {
                        currentCustomerData.name = await decryptFieldAsync(currentCustomerData.name);
                        currentCustomerData.phone = await decryptFieldAsync(currentCustomerData.phone);
                        currentCustomerData.cccd = await decryptFieldAsync(currentCustomerData.cccd);
                    }
                    if (typeof decryptFieldAsync === 'function' && currentCustomerData.driveLink) {
                        try {
                            const dl = await decryptFieldAsync(currentCustomerData.driveLink);
                            if (dl && !_looksEncrypted(dl)) currentCustomerData.driveLink = dl;
                        } catch (e) { }
                    }
                    if (typeof decryptFieldAsync === 'function' && currentCustomerData.notes) {
                        await decryptFieldAsync(currentCustomerData.notes);
                    }
                    if (typeof window.decryptCustomerAssetsAsync === 'function') {
                        await window.decryptCustomerAssetsAsync(currentCustomerData, { batchSize: 6 });
                    }
                    // Chỉ re-render nếu vẫn đang xem đúng hồ sơ này
                    if (!currentCustomerData || currentCustomerData.id !== id) return;
                    renderFolderHeader(currentCustomerData);
                    if (typeof renderDriveStatus === "function") {
                        renderDriveStatus(currentCustomerData.driveLink || null);
                    }
                    const contentInfo = getEl('content-info');
                    const contentAssets = getEl('content-assets');
                    if (contentInfo && !contentInfo.classList.contains('hidden')) loadCustomerInfo();
                    if (contentAssets && !contentAssets.classList.contains('hidden') && typeof renderAssets === 'function') renderAssets();
                } catch (err) { }
            };

            if (typeof afterTransition === 'function') afterTransition(folderScreen, runDecryptAssets);
            else setTimeout(runDecryptAssets, 360);
        };

        req.onerror = (e) => {
            ErrorHandler.showError('STORAGE', 'Không mở được hồ sơ khách hàng.', e);
        };
    } catch (err) {
        ErrorHandler.showError('STORAGE', 'Không mở được hồ sơ khách hàng.', err);
    }
}
function closeFolder() {
    const folderScreen = getEl('screen-folder');
    const customerListScreen = getEl('screen-customer-list');

    const finishClose = () => {
            currentCustomerId = null;
            currentCustomerData = null; // Clear stale data
            // Reload customer list if still visible
            if (customerListScreen && !customerListScreen.classList.contains('hidden') && !customerListScreen.classList.contains('translate-x-full')) {
                const q = (getEl('search-input') && getEl('search-input').value) || '';
                loadCustomers(q);
            }
    };

    // Reset customer ID after animation
    if (typeof slideScreenOut === 'function') {
        slideScreenOut(folderScreen, finishClose);
    } else if (typeof afterTransition === 'function') {
        folderScreen.classList.add('translate-x-full');
        afterTransition(folderScreen, finishClose);
    } else {
        folderScreen.classList.add('translate-x-full');
        setTimeout(() => {
            finishClose();
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

    // Guard ciphertext (sync decryptText fail-open trên cache-miss)
    const phone = (typeof _displayPlain === 'function')
        ? _displayPlain(c.phone, '--')
        : ((c.phone && !_looksEncrypted(c.phone)) ? c.phone : '--');
    const cccd = (typeof _displayPlain === 'function')
        ? _displayPlain(c.cccd, '--')
        : ((c.cccd && !_looksEncrypted(c.cccd)) ? c.cccd : '--');
    const notes = (typeof _displayPlain === 'function')
        ? _displayPlain(c.notes, '')
        : (() => { const raw = decryptText(c.notes); return (raw && !_looksEncrypted(raw)) ? raw : ''; })();
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

    // Đọc record hiện tại trước (transaction đọc riêng).
    const c = await new Promise((resolve, reject) => {
        const g = db.transaction(['customers'], 'readonly').objectStore('customers').get(currentCustomerId);
        g.onsuccess = () => resolve(g.result);
        g.onerror = () => reject(g.error);
    });
    if (!c) return;

    // BẢO VỆ CHỐNG MẤT DỮ LIỆU: ô ghi chú có thể đang trống không phải vì user chủ động xóa,
    // mà vì lazy-decrypt chưa kịp nạp __fieldPlainCache lúc mở hồ sơ (xem openFolder()).
    // Nếu ô trống nhưng DB đang có ghi chú cũ, thử giải mã lại (chờ thật) trước khi chấp nhận
    // đây là "user muốn xóa" — chỉ lưu chuỗi rỗng nếu ghi chú gốc thực sự giải mã được và
    // rỗng, hoặc không thể giải mã được nữa (dữ liệu hỏng, không còn gì để mất thêm).
    if (!notesText && c.notes) {
        let existingPlain = '';
        try {
            existingPlain = (typeof decryptFieldAsync === 'function') ? await decryptFieldAsync(c.notes) : decryptText(c.notes);
        } catch (e) { }
        if (existingPlain && !_looksEncrypted(existingPlain)) {
            ErrorHandler.showError('STORAGE', 'Ghi chú chưa tải xong lúc mở hồ sơ. Vui lòng thử lưu lại (hệ thống không lưu ghi chú rỗng đè lên ghi chú cũ để tránh mất dữ liệu).');
            return;
        }
    }

    // Mã hóa TRƯỚC transaction (AES-GCM async). encryptText tự chối nếu notesText lỡ là
    // ciphertext dán nhầm (chống double-encryption) — bắt lỗi để báo rõ thay vì crash âm thầm.
    let encNotes;
    try {
        encNotes = await encryptText(notesText);
    } catch (e) {
        ErrorHandler.showError('STORAGE', 'Không thể lưu ghi chú (dữ liệu không hợp lệ). Vui lòng thử lại.', e);
        return;
    }

    c.notes = encNotes;
    c.updatedAt = Date.now();

    // Ghi (transaction thuần đồng bộ).
    const wtx = db.transaction(['customers'], 'readwrite');
    const putReq = wtx.objectStore('customers').put(c);
    putReq.onsuccess = () => {
        if (currentCustomerData && currentCustomerData.id === currentCustomerId) {
            currentCustomerData.notes = c.notes;
            currentCustomerData.updatedAt = c.updatedAt;
        }
        ErrorHandler.showSuccess('Đã lưu ghi chú');
    };
    putReq.onerror = (err) => ErrorHandler.showError('STORAGE', 'Lỗi lưu ghi chú.', err);
}

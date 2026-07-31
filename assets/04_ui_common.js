// Hyperscript-style helper để dựng khung overlay/modal bằng DOM API thay vì innerHTML.
// props: attrs thường (className, id...), "style" (object hoặc chuỗi cssText), "on" (object
// sự kiện -> handler), "dataset" (object cho data-*), "text" (textContent, đường tắt an toàn
// cho nội dung có thể chứa biến). children: string | Node | Array<string|Node|falsy>.
function el(tag, props, children) {
    const node = document.createElement(tag);
    props = props || {};
    for (const key in props) {
        if (key === 'style') {
            if (typeof props.style === 'string') node.style.cssText = props.style;
            else Object.assign(node.style, props.style);
        } else if (key === 'dataset') {
            Object.assign(node.dataset, props.dataset);
        } else if (key === 'on') {
            for (const evt in props.on) node.addEventListener(evt, props.on[evt]);
        } else if (key === 'text') {
            node.textContent = props.text;
        } else if (key === 'href' || key === 'type' || key === 'role' || key === 'for' || key.indexOf('aria-') === 0) {
            node.setAttribute(key, props[key]);
        } else {
            node[key] = props[key];
        }
    }
    const kids = Array.isArray(children) ? children : (children == null ? [] : [children]);
    for (const k of kids) {
        if (k == null || k === false) continue;
        node.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
    }
    return node;
}

function setupSwipe() {
    const lb = getEl('lightbox'); let startX = 0; let endX = 0;
    lb.addEventListener('touchstart', e => { startX = e.changedTouches[0].screenX; }, { passive: true });
    lb.addEventListener('touchend', e => { endX = e.changedTouches[0].screenX; handleSwipe(); }, { passive: true });
    function handleSwipe() { if (startX - endX > 50) navigateLightbox(1); if (endX - startX > 50) navigateLightbox(-1); }
}

function bindLongPress(el, onLongPress, options) {
    if (!el || typeof onLongPress !== 'function') return function () { };
    const opts = options || {};
    const delay = opts.delay || 500;
    const moveTolerance = opts.moveTolerance || 10;
    const ignoreSelector = opts.ignoreSelector || 'button,a,input,textarea,select,label,.action-btn,[data-long-press-ignore]';
    let timer = null;
    let startX = 0;
    let startY = 0;
    let pointerId = null;
    let fired = false;

    function clearTimer() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    }

    function reset() {
        clearTimer();
        pointerId = null;
        window.removeEventListener('scroll', cancel, true);
    }

    function cancel() {
        if (fired) return;
        reset();
    }

    function shouldIgnore(target) {
        return !!(target && target.closest && target.closest(ignoreSelector));
    }

    function suppressNextClick(event) {
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        el.removeEventListener('click', suppressNextClick, true);
    }

    function onPointerDown(event) {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (shouldIgnore(event.target)) return;
        if (typeof clearNativeTextSelection === 'function') clearNativeTextSelection();
        reset();
        fired = false;
        pointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        window.addEventListener('scroll', cancel, true);
        timer = setTimeout(() => {
            timer = null;
            fired = true;
            if (event && event.cancelable) event.preventDefault();
            if (typeof clearNativeTextSelection === 'function') clearNativeTextSelection();
            el.addEventListener('click', suppressNextClick, true);
            try { if (navigator.vibrate) navigator.vibrate(10); } catch (e) { }
            onLongPress(event);
            if (typeof clearNativeTextSelection === 'function') clearNativeTextSelection();
        }, delay);
    }

    function onPointerMove(event) {
        if (pointerId !== event.pointerId || !timer) return;
        const dx = Math.abs(event.clientX - startX);
        const dy = Math.abs(event.clientY - startY);
        if (dx > moveTolerance || dy > moveTolerance) cancel();
    }

    function onPointerEnd(event) {
        if (pointerId !== null && pointerId !== event.pointerId) return;
        reset();
    }

    function onContextMenu(event) {
        const target = event.target;
        const allowed = typeof isEditableTarget === 'function' && isEditableTarget(target);
        const control = target && target.closest && target.closest('a[href],button,[role="button"],[onclick],.action-btn,[data-long-press-ignore]');
        if (!allowed && !control) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof clearNativeTextSelection === 'function') clearNativeTextSelection();
        }
    }

    el.addEventListener('pointerdown', onPointerDown, { passive: false });
    el.addEventListener('pointermove', onPointerMove, { passive: true });
    el.addEventListener('pointerup', onPointerEnd, { passive: true });
    el.addEventListener('pointercancel', onPointerEnd, { passive: true });
    el.addEventListener('contextmenu', onContextMenu);

    return function unbindLongPress() {
        reset();
        el.removeEventListener('pointerdown', onPointerDown);
        el.removeEventListener('pointermove', onPointerMove);
        el.removeEventListener('pointerup', onPointerEnd);
        el.removeEventListener('pointercancel', onPointerEnd);
        el.removeEventListener('contextmenu', onContextMenu);
        el.removeEventListener('click', suppressNextClick, true);
    };
}

function navigateLightbox(dir) {
    if (currentLightboxList.length <= 1) return;
    currentLightboxIndex += dir;
    if (currentLightboxIndex < 0) currentLightboxIndex = currentLightboxList.length - 1;
    if (currentLightboxIndex >= currentLightboxList.length) currentLightboxIndex = 0;
    const item = currentLightboxList[currentLightboxIndex];
    // Ưu tiên _displayData (đã giải mã khi load gallery); tuyệt đối không gán ciphertext vào src
    let src = (item && (item._displayData || item.data)) || '';
    if (typeof _looksEncrypted === 'function' && _looksEncrypted(src)) src = '';
    if (typeof isSafeImageUrl === 'function' && src && !isSafeImageUrl(src)) src = '';
    const imgEl = getEl('lightbox-img');
    imgEl.style.transform = dir > 0 ? 'translateX(-20px)' : 'translateX(20px)';
    imgEl.style.opacity = '0';
    setTimeout(() => {
        imgEl.src = src;
        imgEl.style.transform = dir > 0 ? 'translateX(20px)' : 'translateX(-20px)';
        setTimeout(() => {
            imgEl.style.transform = 'translateX(0)';
            imgEl.style.opacity = '1';
            currentImageId = item && item.id;
            currentImageBase64 = src;
            getEl('lightbox-counter').textContent = `${currentLightboxIndex + 1}/${currentLightboxList.length}`;
            // Nếu chưa có _displayData (ảnh mã hóa chưa resolve), giải mã nền rồi cập nhật
            if ((!src || src === item.data) && item && item.data && typeof resolveImageData === 'function'
                && typeof _looksEncrypted === 'function' && _looksEncrypted(item.data)) {
                const idxAtStart = currentLightboxIndex;
                resolveImageData(item).then((resolved) => {
                    if (!resolved || currentLightboxIndex !== idxAtStart) return;
                    item._displayData = resolved;
                    imgEl.src = resolved;
                    currentImageBase64 = resolved;
                }).catch(() => { });
            }
        }, 50);
    }, 150);
}
function openLightbox(src, id, idx, list) {
    getEl('lightbox').classList.remove('hidden');
    currentLightboxIndex = idx;
    if (list && list.length > 0) currentLightboxList = list;
    else currentLightboxList = [{ id: id, data: src, _displayData: src }];
    const imgEl = getEl('lightbox-img');
    let safeSrc = src || '';
    if (typeof _looksEncrypted === 'function' && _looksEncrypted(safeSrc)) safeSrc = '';
    if (typeof isSafeImageUrl === 'function' && safeSrc && !isSafeImageUrl(safeSrc)) safeSrc = '';
    imgEl.src = safeSrc;
    currentImageId = id;
    currentImageBase64 = safeSrc;
    getEl('lightbox-counter').textContent = `${currentLightboxIndex + 1}/${currentLightboxList.length}`;
}
// Đóng lightbox phải BỎ tham chiếu ảnh plaintext: ảnh sau nén vẫn cỡ 500–700 KB,
// giữ nguyên trong <img>.src + currentImageBase64 sau khi ẩn overlay là data URL
// đã giải mã nằm lại RAM vô thời hạn. openLightbox luôn gán lại src + list nên
// việc gỡ ở đây không phá điều hướng vuốt.
function closeLightbox() {
    const box = getEl('lightbox');
    if (box) box.classList.add('hidden');
    try {
        const imgEl = getEl('lightbox-img');
        if (imgEl) imgEl.removeAttribute('src');
    } catch (e) { }
    currentImageBase64 = null;
}

// Wipe every rendered customer field from #screen-folder once the profile screen has
// finished sliding off-screen (close or post-delete). The screen is only transform-
// hidden, never removed, so without this the name/phone/CCCD/notes/limit/assets and
// call-Zalo links would linger in the DOM. Pure DOM cleanup — does not touch
// IndexedDB, crypto, or the record shape; openFolder re-renders everything on reopen.
function clearCustomerFolderView() {
    try {
        const nameEl = getEl('folder-customer-name'); if (nameEl) nameEl.textContent = '';
        const avatarEl = getEl('folder-avatar'); if (avatarEl) avatarEl.textContent = '?';
        const phoneEl = getEl('info-phone'); if (phoneEl) phoneEl.textContent = '--';
        const cccdEl = getEl('info-cccd'); if (cccdEl) cccdEl.textContent = '--';
        const createdEl = getEl('info-created'); if (createdEl) createdEl.textContent = '';
        const notesEl = getEl('info-notes'); if (notesEl) notesEl.value = '';
        const badge = getEl('detail-status-badge');
        if (badge) { badge.textContent = ''; badge.removeAttribute('class'); }
        const callBtn = getEl('btn-detail-call');
        if (callBtn) callBtn.href = (typeof getTelLink === 'function') ? getTelLink('') : '#';
        const zaloBtn = getEl('btn-detail-zalo');
        if (zaloBtn) { zaloBtn.href = (typeof getZaloLink === 'function') ? getZaloLink('') : '#'; zaloBtn.onclick = null; }
        const imgArea = getEl('content-images'); if (imgArea) { imgArea.innerHTML = ''; imgArea.scrollTop = 0; }
        const assetArea = getEl('content-assets'); if (assetArea) { assetArea.innerHTML = ''; assetArea.scrollTop = 0; }
        const driveArea = getEl('drive-status-area');
        if (driveArea) { driveArea.innerHTML = ''; driveArea.classList.add('hidden'); }
        // Notes edit mode is DOM state on #info-notes; reset it so a half-finished edit of
        // the closed profile cannot leak into the next one (mirrors exitNotesEditMode).
        const notesEdit = getEl('info-notes'); if (notesEdit) notesEdit.readOnly = true;
        const editBtn = getEl('btn-edit-notes'); if (editBtn) editBtn.classList.remove('hidden');
        const saveBtn = getEl('btn-save-notes'); if (saveBtn) saveBtn.classList.add('hidden');
        // Invalidate any in-flight work still keyed to the closed profile: the openFolder
        // lazy-decrypt (guarded by window.__openFolderSeq) and the asset-gallery image load
        // (guarded by currentAssetId). Without this, a decrypt/gallery job from the profile
        // just closed could repaint the folder after it was scrubbed.
        try { window.__openFolderSeq = (window.__openFolderSeq || 0) + 1; } catch (e) { }
        if (typeof currentAssetId !== 'undefined') currentAssetId = null;
        if (typeof selectedImages !== 'undefined' && selectedImages && typeof selectedImages.clear === 'function') selectedImages.clear();
        if (typeof isSelectionMode !== 'undefined') isSelectionMode = false;
        if (typeof updateSelectionUI === 'function') updateSelectionUI();
    } catch (e) { }
}
// closeFolder (05_customers.js) nulls currentCustomerId/Data and slides the folder out;
// this scrubs the rendered DOM once that slide completes. For deletes, closeFolder runs
// only after the IndexedDB transaction commits, so the DOM is cleared only when durable.
// Guard on the folder still being off-screen: if a new profile was opened in the same
// tick the scrub must not wipe it (belt-and-suspenders — the slide layer already keeps
// the background inert until the close settles, so no re-open can race in mid-animation).
document.addEventListener('clientpro:screen-slid-out', (ev) => {
    try {
        if (!ev || !ev.detail || ev.detail.id !== 'screen-folder') return;
        const folder = getEl('screen-folder');
        if (folder && !folder.classList.contains('translate-x-full')) return; // đã mở lại
        clearCustomerFolderView();
    } catch (e) { }
});

let currentCustomerId = null; let currentCustomerData = null; let currentAssetId = null;

// =======================
// SAFE PERSIST (chống lưu plaintext)
// openFolder() giải mã name/phone/cccd/driveLink TRỰC TIẾP trên currentCustomerData,
// nên tuyệt đối không put() nguyên object đó vào DB — sẽ ghi đè ciphertext bằng
// plaintext và làm mất mã hóa dữ liệu ở IndexedDB.
// Helper này đọc lại bản ghi gốc (còn nguyên ciphertext) rồi chỉ áp các thay đổi
// cần thiết qua hàm mutate(rec). Đồng thời "chữa" các bản ghi đã lỡ bị lưu
// plaintext bởi bản cũ (mã hóa lại name/phone/cccd nếu phát hiện chưa mã hóa).
// =======================
function persistCurrentCustomer(mutate, onDone) {
    try {
        if (!db || !currentCustomerData || !currentCustomerData.id) {
            if (typeof onDone === 'function') onDone(false);
            return;
        }
        const id = currentCustomerData.id;
        const tx = db.transaction(['customers'], 'readwrite');
        const store = tx.objectStore('customers');
        let ok = false;
        // onDone gọi đúng MỘT lần: request error bubble lên tx.onerror rồi tx tự
        // abort bắn tiếp onabort — không có guard thì onDone chạy hai lần.
        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            if (typeof onDone === 'function') onDone(result);
        };
        store.get(id).onsuccess = (e) => {
            const rec = e.target.result;
            if (!rec) return;
            try { if (typeof mutate === 'function') mutate(rec); } catch (err) { if (window.ErrorHandler) ErrorHandler.logError('persistCurrentCustomer mutate error', err); return; }
            // Lưu ý: KHÔNG "heal" mã hóa ở đây nữa. encryptText() giờ BẤT ĐỒNG BỘ (AES-GCM)
            // nên không thể chạy trong transaction; ngoài ra check cũ sẽ mã hóa NHẦM giá trị
            // "cpg1:" (double-encrypt). Các luồng ghi (saveCustomer/saveAsset/notes) đã mã hóa
            // trường nhạy cảm TRƯỚC khi persist; migration lo phần dữ liệu CryptoJS cũ.
            store.put(rec);
            ok = true;
        };
        tx.oncomplete = () => finish(ok);
        tx.onerror = () => finish(false);
        // Abort không kèm request error (quota, versionchange...) chỉ bắn onabort —
        // thiếu nó onDone không bao giờ chạy, caller (saveAsset qua __assetSaveInFlight...)
        // kẹt guard vĩnh viễn tới khi reload app.
        tx.onabort = () => finish(false);
    } catch (err) {
        if (window.ErrorHandler) ErrorHandler.logError('persistCurrentCustomer error', err);
        if (typeof onDone === 'function') onDone(false);
    }
}
let activeListTab = 'pending'; let isSelectionMode = false; let selectedImages = new Set();
let isCustSelectionMode = false; let selectedCustomers = new Set();
let captureMode = 'profile'; let stream = null; let currentImageId = null; let currentImageBase64 = null;

function clearNativeTextSelection() {
    try {
        const sel = window.getSelection && window.getSelection();
        if (sel && sel.removeAllRanges) sel.removeAllRanges();
    } catch (e) { }
}

function isEditableTarget(target) {
    if (!target) return false;
    const el = target.nodeType === 1 ? target : target.parentElement;
    return !!(el && el.closest && el.closest('input,textarea,select,[contenteditable="true"],.allow-text-select'));
}

let __selectionHistoryActive = false;
function pushSelectionHistoryLayer(type) {
    if (__selectionHistoryActive) return;
    try {
        history.pushState({ clientProSelectionLayer: true, type: type || 'selection' }, document.title, location.href);
        __selectionHistoryActive = true;
    } catch (e) { }
}
function clearSelectionHistoryLayer() {
    if (!__selectionHistoryActive) return;
    __selectionHistoryActive = false;
    // Pop the history entry pushed when selection mode started (e.g. user tapped
    // "Cancel" instead of swiping back), so it doesn't linger as a phantom step
    // that a later Dashboard back-swipe has to burn through before it exits.
    if (window.__edgeBackSwipe && typeof window.__edgeBackSwipe.consumeTrackedHistoryStep === 'function') {
        window.__edgeBackSwipe.consumeTrackedHistoryStep();
    }
}

function isAnySelectionModeActive() {
    return !!((typeof isCustSelectionMode !== 'undefined' && (isCustSelectionMode || (selectedCustomers && selectedCustomers.size))) ||
        (typeof isSelectionMode !== 'undefined' && (isSelectionMode || (selectedImages && selectedImages.size))));
}

function cancelCustomerSelectionMode() {
    if (typeof selectedCustomers !== 'undefined' && selectedCustomers && selectedCustomers.clear) selectedCustomers.clear();
    if (typeof isCustSelectionMode !== 'undefined') isCustSelectionMode = false;
    document.querySelectorAll('.cust-card.selected, .customer-card.selected, .customer-row.selected').forEach((el) => el.classList.remove('selected'));
    const bar = document.getElementById('cust-selection-bar');
    if (bar) { bar.classList.add('translate-y-full'); bar.classList.remove('translate-y-0'); }
    const count = document.getElementById('cust-selection-count');
    if (count) count.textContent = '0';
}

function cancelImageSelectionMode() {
    if (typeof selectedImages !== 'undefined' && selectedImages && selectedImages.clear) selectedImages.clear();
    if (typeof isSelectionMode !== 'undefined') isSelectionMode = false;
    document.querySelectorAll('.img-wrapper.selected, .image-card.selected, .gallery-item.selected, .asset-gallery-item.selected').forEach((el) => {
        el.classList.remove('selected');
        const ring = el.querySelector('.select-ring');
        if (ring) ring.remove();
    });
    if (typeof updateSelectionUI === 'function') updateSelectionUI();
}

function cancelAllSelectionModes() {
    cancelCustomerSelectionMode();
    cancelImageSelectionMode();
    document.querySelectorAll('.selected, .selecting, .active-selection').forEach((el) => el.classList.remove('selected', 'selecting', 'active-selection'));
    document.body && document.body.classList.remove('selection-mode', 'cust-selection-mode', 'image-selection-mode', 'active-selection');
    clearNativeTextSelection();
    clearSelectionHistoryLayer();
}

function handleAppBack() {
    if (isAnySelectionModeActive()) {
        cancelAllSelectionModes();
        return true;
    }
    return false;
}


function normalizePhoneForLink(phone) {
    let p = String(phone || '').replace(/[^0-9+]/g, '');
    if (p.startsWith('+')) p = p.substring(1);
    if (p.startsWith('0')) p = '84' + p.substring(1);
    return p;
}
function getZaloLink(phone) {
    const p = normalizePhoneForLink(phone);
    return p ? `https://zalo.me/${p}` : '#';
}
function isMobileDevice() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
}
function isIOSDevice() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
}
function isStandaloneDisplay() {
    return window.navigator.standalone === true
        || !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}
function getTelLink(phone) {
    const p = normalizePhoneForLink(phone);
    return p ? `tel:+${p}` : '#';
}
function openZaloChat(phone) {
    const p = normalizePhoneForLink(phone);
    const fallback = getZaloLink(phone);
    if (!p || fallback === '#') {
        showToast('Chưa có số điện thoại để mở Zalo');
        return;
    }

    // Mọi thiết bị di động (iOS lẫn Android, mọi trình duyệt): dùng thẳng
    // Universal Link/App Link https://zalo.me/<phone>. Custom scheme
    // (zalo://, intent://…scheme=zalo…) luôn bị trình duyệt chặn lại bằng
    // hộp thoại xác nhận "Mở bằng Zalo?" trước khi chuyển app — Universal
    // Link/App Link mở thẳng app không qua hộp thoại nào, và tự rơi về
    // trang zalo.me nếu máy chưa cài Zalo, nên không cần dò app đã mở hay
    // chưa bằng timer nữa.
    if (isMobileDevice()) {
        // Riêng iOS chạy PWA standalone (Add to Home Screen): app sống trong
        // WKWebView không có hook Universal Link, location.href sẽ tải hẳn
        // trang zalo.me bên trong webview thay vì chuyển app. window.open
        // thoát ra Safari thật — nơi Universal Link chuyển app ngay; nếu
        // popup bị chặn thì rơi về location.href như cũ.
        if (isIOSDevice() && isStandaloneDisplay()) {
            const win = window.open(fallback, '_blank', 'noopener');
            if (!win) window.location.href = fallback;
            return;
        }
        window.location.href = fallback;
        return;
    }

    // Desktop: mở web zalo.me
    const win = window.open(fallback, '_blank', 'noopener');
    if (!win) window.location.href = fallback;
}
// Fallback tối giản — 19_error_loading.js override bằng AppToast ngay sau khi nạp.
// (Markup #toast legacy đã gỡ khỏi index.html; hàm này chỉ còn là lưới an toàn.)
function showToast(msg) { try { console.log('[toast]', msg); } catch (e) { } }
function formatLink(link) {
  if (!link) return '';
  const raw = String(link).trim();
  if (!raw || /^(javascript|data|vbscript):/i.test(raw)) return '';
  const candidate = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.href;
  } catch (e) {
    return '';
  }
}

// ============================================================
// CAMERA WRAPPER — ensure modal + document-scanner before open
// ============================================================

let __docScanLoadPromise = null;
/** Bumped to cancel in-flight tryOpenCamera after lock / hide / newer tap. */
let __cameraOpenAttemptSeq = 0;
const __cameraSecurityGateIds = [
    'screen-lock',
    'activation-modal',
    'setup-lock-modal',
    'forgot-pin-modal',
    'biometric-setup-modal',
];
let __cameraSecurityGateObserver = null;

function __invalidatePendingCameraOpen() {
    __cameraOpenAttemptSeq++;
}

/**
 * Security code exposes lock / activation through the real gate DOM, not a
 * synthetic "clientpro:locked" event. Observe those gates once they are loaded
 * and publish one lifecycle event that camera/scanner cleanup can trust.
 */
function __bindCameraSecurityGateObserver() {
    if (__cameraSecurityGateObserver) {
        __cameraSecurityGateObserver.disconnect();
        __cameraSecurityGateObserver = null;
    }
    const gates = __cameraSecurityGateIds
        .map((id) => document.getElementById(id))
        .filter(Boolean);
    if (!gates.length || typeof MutationObserver === 'undefined') return;

    const wasVisible = new Map();
    const gateShown = (gate) => {
        __invalidatePendingCameraOpen();
        document.dispatchEvent(new CustomEvent('clientpro:security-gate-shown', {
            detail: { id: gate.id },
        }));
    };
    // Symmetric to gateShown. A gate can be opened from the menu on an already-unlocked
    // session (setup-lock / biometric-setup); opening it parked the loader + cleared
    // data-cp-boot-ready (head.js closeBusinessShellForGate), and closing it never
    // dispatches clientpro:unlocked. Publish one lifecycle event so head.js can restore
    // the business shell (UI layer only). Also scrub the gate's own PIN / employee-code
    // inputs so no recovery secret lingers in the DOM after it is dismissed.
    const gateHidden = (gate) => {
        try {
            if (gate.id === 'setup-lock-modal' || gate.id === 'biometric-setup-modal') {
                gate.querySelectorAll('input').forEach((input) => { input.value = ''; });
                const note = gate.querySelector('#setup-pin-note');
                if (note) { note.classList.add('hidden'); note.textContent = ''; }
            }
        } catch (e) { }
        document.dispatchEvent(new CustomEvent('clientpro:security-gate-hidden', {
            detail: { id: gate.id },
        }));
    };

    gates.forEach((gate) => {
        const visible = !gate.classList.contains('hidden');
        wasVisible.set(gate, visible);
        if (visible) gateShown(gate);
    });

    __cameraSecurityGateObserver = new MutationObserver((records) => {
        records.forEach((record) => {
            const gate = record.target;
            const visible = !gate.classList.contains('hidden');
            if (visible && !wasVisible.get(gate)) gateShown(gate);
            else if (!visible && wasVisible.get(gate)) gateHidden(gate);
            wasVisible.set(gate, visible);
        });
    });
    gates.forEach((gate) => {
        __cameraSecurityGateObserver.observe(gate, {
            attributes: true,
            attributeFilter: ['class'],
        });
    });
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') __invalidatePendingCameraOpen();
});
document.addEventListener('clientpro:modals-critical-loaded', __bindCameraSecurityGateObserver);
document.addEventListener('clientpro:locked', __invalidatePendingCameraOpen);
window.addEventListener('pagehide', __invalidatePendingCameraOpen);
__bindCameraSecurityGateObserver();

function __cameraOpenStillAllowed(attempt) {
    if (attempt !== __cameraOpenAttemptSeq) return false;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
    if (typeof isAppUnlocked === 'function' && !isAppUnlocked()) return false;
    try {
        for (const id of __cameraSecurityGateIds) {
            const gate = document.getElementById(id);
            if (gate && !gate.classList.contains('hidden')) return false;
        }
    } catch (e) { }
    return true;
}

function __ensureDocumentScanner() {
    if (window.DocumentScanner) return Promise.resolve(true);
    if (__docScanLoadPromise) return __docScanLoadPromise;
    const v = (typeof LAZY_MODULES_V !== 'undefined' && LAZY_MODULES_V) ? LAZY_MODULES_V : '';
    const vq = v ? `?v=${v}` : '';
    __docScanLoadPromise = (async () => {
        if (window.ModalLoader) {
            try { await window.ModalLoader.ensureFeatureCss(); } catch (e) { }
            try { await window.ModalLoader.ensure('camera-modal'); } catch (e) { }
        }
        const load = (src) => new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src + vq;
            s.onload = () => resolve(true);
            s.onerror = () => reject(new Error('script ' + src));
            document.head.appendChild(s);
        });
        await load('assets/document-scanner/document-geometry.js');
        await load('assets/document-scanner/document-image-enhance.js');
        await load('assets/document-scanner/document-scanner.js');
        return !!window.DocumentScanner;
    })().catch((err) => {
        __docScanLoadPromise = null;
        try {
            ErrorHandler.showError('NETWORK', 'Không tải được máy quét giấy tờ. Thử lại.', err);
        } catch (e) { }
        return false;
    });
    return __docScanLoadPromise;
}

// Camera: Gọi trực tiếp camera function (sau khi nạp scanner lần đầu)
async function tryOpenCamera(mode) {
    // Chụp token trước khi nạp; lock/hide/tap mới bump token — không mở sau màn khóa.
    const attempt = ++__cameraOpenAttemptSeq;
    try {
        const btn = document.querySelector(`[data-action="tryOpenCamera"][data-arg="${mode}"]`) ||
            document.querySelector('[data-action="tryOpenCamera"]');
        if (btn && window.LoadingManager && !window.DocumentScanner) {
            try { LoadingManager.showButtonLoading(btn); } catch (e) { }
        }
        try {
            await __ensureDocumentScanner();
        } finally {
            if (btn && window.LoadingManager) {
                try { LoadingManager.hideButtonLoading(btn); } catch (e) { }
            }
        }
        if (!__cameraOpenStillAllowed(attempt)) return;
        if (typeof window._tryOpenCameraReal === 'function') {
            window._tryOpenCameraReal(mode);
        } else {
            ErrorHandler.showWarning('Camera chưa sẵn sàng');
        }
    } catch (e) {
        ErrorHandler.showError('CAMERA', undefined, e);
    }
}

// ============================================================
// ModalA11y — Accessibility cho MỌI modal mà KHÔNG phải sửa từng open/close.
// Modal trong app là overlay `.fixed.inset-0 ... hidden`; toggle class `hidden`.
// Ta quan sát thay đổi class để: gắn role=dialog + aria-modal + aria-labelledby,
// bẫy focus (Tab/Shift-Tab vòng trong modal), Esc = bấm nút đóng, và khôi phục
// focus về phần tử trước đó khi đóng. Tôn trọng CSP (không inline handler).
// ============================================================
const ModalA11y = (function () {
    const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    // Chỉ cô lập a11y tree cho cổng bảo mật — KHÔNG áp inert cho mọi business
    // modal (thiếu modal stack; confirm `.cp-confirm-overlay` không do ModalA11y
    // quản lý; inert chung dễ restore sớm / mất trap / focus lệch).
    const SECURITY_GATE_IDS = {
        'activation-modal': 1,
        'screen-lock': 1,
        'setup-lock-modal': 1,
        'forgot-pin-modal': 1,
        'biometric-setup-modal': 1,
    };
    let activeModal = null;
    let lastFocused = null;
    let isolationTouches = null; // [{ el, hadInert, ariaHidden }] khi security gate mở

    // #loader is a full-screen boot/loading surface (.fixed.inset-0) but NOT a
    // dialog: it has no focusable controls and head.js "parks" it visible behind a
    // security gate on lock. Treating it as a modal makes its class toggles run
    // activate()/deactivate(), which would release a security gate's background
    // isolation the moment the loader re-parks. Exclude it from the modal lifecycle
    // entirely (it is already isolation-exempt).
    function isModalOverlay(el) {
        return el instanceof HTMLElement && el.id !== 'loader'
            && el.classList.contains('fixed') && el.classList.contains('inset-0');
    }
    function isOverlay(el) { return isModalOverlay(el); }
    function isVisible(el) { return !!el && !el.classList.contains('hidden'); }
    function isSecurityGate(el) { return !!(el && el.id && SECURITY_GATE_IDS[el.id]); }
    function overlays() { return Array.from(document.querySelectorAll('.fixed.inset-0')).filter(isModalOverlay); }
    function topVisible() {
        const vis = overlays().filter(isVisible);
        return vis.length ? vis[vis.length - 1] : null;
    }
    function topVisibleSecurityGate() {
        const vis = overlays().filter((el) => isVisible(el) && isSecurityGate(el));
        return vis.length ? vis[vis.length - 1] : null;
    }
    function focusables(modal) {
        return Array.from(modal.querySelectorAll(FOCUSABLE))
            .filter((e) => e.type !== 'hidden' && e.getClientRects().length > 0);
    }
    // Đặt inert + aria-hidden lên mọi sibling trên đường modal → body (không
    // đụng chính modal). Lưu giá trị cũ để restore đúng.
    // Loại trừ: toast live region + confirm overlay + loader — chúng phải vẫn
    // hoạt động cho gate hiện tại (vd báo lỗi kích hoạt / sai PIN).
    const ISOLATION_EXEMPT_IDS = {
        'app-toast-container': 1,  // role=status live region — không inert
        'loader': 1,               // global loader có thể dùng trong gate
    };
    function isIsolationExempt(el) {
        if (!el || !el.id) return el && el.classList && el.classList.contains('cp-confirm-overlay');
        if (ISOLATION_EXEMPT_IDS[el.id]) return true;
        if (el.classList && el.classList.contains('cp-confirm-overlay')) return true;
        return false;
    }
    function isolateBackground(modal) {
        releaseIsolation();
        const touches = [];
        let node = modal;
        while (node && node !== document.body) {
            const parent = node.parentElement;
            if (!parent) break;
            Array.from(parent.children).forEach((sibling) => {
                if (sibling === node || !(sibling instanceof HTMLElement)) return;
                if (isIsolationExempt(sibling)) return;
                touches.push({
                    el: sibling,
                    hadInert: !!sibling.inert,
                    ariaHidden: sibling.getAttribute('aria-hidden'),
                });
                try { sibling.inert = true; } catch (e) { }
                sibling.setAttribute('aria-hidden', 'true');
            });
            node = parent;
        }
        isolationTouches = touches;
    }
    function releaseIsolation() {
        if (!isolationTouches) return;
        for (let i = isolationTouches.length - 1; i >= 0; i--) {
            const t = isolationTouches[i];
            const el = t.el;
            if (!el) continue;
            try { el.inert = t.hadInert; } catch (e) { }
            if (t.ariaHidden === null) el.removeAttribute('aria-hidden');
            else el.setAttribute('aria-hidden', t.ariaHidden);
        }
        isolationTouches = null;
    }
    function activate(modal, opts) {
        opts = opts || {};
        if (activeModal === modal) return;
        // Handoff giữa các security gate (vd đóng forgot-pin còn screen-lock):
        // GIỮ lastFocused gốc — không ghi đè bằng control trong modal vừa ẩn.
        const handOff = !!opts.handOff
            || (!!activeModal && isSecurityGate(activeModal) && isSecurityGate(modal));
        if (activeModal && activeModal !== modal) {
            // Đổi overlay: nhả isolation cũ (không trả focus — sẽ focus modal mới).
            releaseIsolation();
        }
        if (!handOff) {
            lastFocused = document.activeElement;
        }
        activeModal = modal;
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        const heading = modal.querySelector('h1[id],h2[id],h3[id]');
        if (heading) modal.setAttribute('aria-labelledby', heading.id);
        // Nút đóng icon-only -> gắn nhãn cho screen reader nếu thiếu.
        // Chỉ gắn cho control THỰC (button/a/[role]) — tránh aria-label trên
        // <div> backdrop (vi phạm aria-prohibited-attr; div không có accessible name).
        modal.querySelectorAll('[data-action^="close"]').forEach((b) => {
            const isControl = b.tagName === 'BUTTON' || b.tagName === 'A' || b.hasAttribute('role');
            if (isControl && !b.getAttribute('aria-label')) b.setAttribute('aria-label', 'Đóng');
        });
        // 1) Focus vào modal TRƯỚC — rồi mới inert nền (tránh Chrome chặn
        //    aria-hidden trên ancestor đang chứa focus).
        const firstInput = modal.querySelector('input:not([type=hidden]),textarea,select');
        const target = (firstInput && firstInput.getClientRects().length) ? firstInput : focusables(modal)[0];
        if (target) { try { target.focus(); } catch (e) { } }
        // 2) Chỉ security gate mới cô lập accessibility tree của dashboard.
        if (isSecurityGate(modal)) isolateBackground(modal);
    }
    function deactivate() {
        releaseIsolation();
        const nextGate = topVisibleSecurityGate();
        // Không gán activeModal = null trước handoff: nếu null hóa trước,
        // activate(next) sẽ tưởng đây là mở mới và ghi đè lastFocused bằng
        // phần tử đang focus trong gate vừa ẩn.
        if (nextGate && nextGate !== activeModal) {
            activate(nextGate, { handOff: true });
            return;
        }
        activeModal = null;
        const focusBack = lastFocused;
        lastFocused = null;
        // Chỉ trả focus nếu phần tử còn trong document và còn focusable
        // (không nằm trong overlay đã ẩn).
        if (focusBack && typeof focusBack.focus === 'function'
            && document.contains(focusBack)
            && !focusBack.closest('.fixed.inset-0.hidden')) {
            try { focusBack.focus(); } catch (e) { }
        }
    }
    function onKeydown(e) {
        const modal = (activeModal && isVisible(activeModal)) ? activeModal : topVisible();
        if (!modal) return;
        if (e.key === 'Escape') {
            const closeBtn = modal.querySelector('[data-action^="close"]');
            if (closeBtn) { e.preventDefault(); closeBtn.click(); }
            return;
        }
        if (e.key !== 'Tab') return;
        const f = focusables(modal);
        if (!f.length) { e.preventDefault(); return; }
        const first = f[0], last = f[f.length - 1];
        if (!modal.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    function observe(el) {
        if (!el.__a11yObserved) {
            el.__a11yObserved = true;
            _mo.observe(el, { attributes: true, attributeFilter: ['class'] });
            if (isVisible(el)) activate(el);
        }
    }
    const _mo = new MutationObserver((muts) => {
        for (const m of muts) {
            const el = m.target;
            if (!isOverlay(el)) continue;
            if (isVisible(el)) activate(el);
            else if (activeModal === el) deactivate();
        }
    });
    function observeAll() { overlays().forEach(observe); }

    // Nhãn cho nút icon-only (không có chữ hiển thị) -> screen reader đọc được.
    const ACTION_LABELS = {
        toggleMenu: 'Mở menu', locateMe: 'Định vị vị trí của tôi', closeFolder: 'Đóng hồ sơ',
        refreshWeather: 'Làm mới thời tiết', toggleCustSelectionMode: 'Chọn nhiều khách hàng',
        toggleSelectionMode: 'Chọn nhiều ảnh', toggleMap: 'Mở bản đồ', closeAssetGallery: 'Đóng thư viện ảnh',
        deleteCurrentCustomer: 'Xóa hồ sơ', backToList: 'Quay lại danh sách', goBack: 'Quay lại',
        openModal: 'Thêm khách hàng mới', closeModal: 'Đóng', closeLightbox: 'Đóng ảnh',
        navigateLightbox: 'Ảnh khác', shareSelectedImages: 'Chia sẻ ảnh đã chọn',
        deleteSelectedImages: 'Xóa ảnh đã chọn', deleteOpenedImage: 'Xóa ảnh này',
        openEditCustomerModal: 'Sửa hồ sơ', tryOpenCamera: 'Chụp ảnh',
    };
    // Dự phòng theo icon Lucide -> đảm bảo KHÔNG nút icon-only nào thiếu tên (WCAG button-name).
    const ICON_LABELS = {
        'x': 'Đóng', 'arrow-left': 'Quay lại', 'chevron-left': 'Quay lại', 'trash-2': 'Xóa',
        'trash': 'Xóa', 'save': 'Lưu', 'camera': 'Chụp ảnh', 'search': 'Tìm kiếm', 'plus': 'Thêm',
        'edit': 'Sửa', 'edit-2': 'Sửa', 'edit-3': 'Sửa', 'share-2': 'Chia sẻ', 'map': 'Bản đồ',
        'menu': 'Menu', 'settings': 'Cài đặt', 'check': 'Xác nhận', 'refresh-cw': 'Làm mới',
    };
    function labelIconButtons(root) {
        (root || document).querySelectorAll('button[data-action],a[data-action],[role="button"][data-action]').forEach((btn) => {
            if (btn.getAttribute('aria-label')) return;
            if ((btn.textContent || '').trim().length > 0) return; // đã có chữ hiển thị
            let label = ACTION_LABELS[btn.dataset.action];
            if (!label) {
                const icon = btn.querySelector('[data-lucide]');
                if (icon) label = ICON_LABELS[icon.getAttribute('data-lucide')];
            }
            if (label) btn.setAttribute('aria-label', label);
        });
    }

    function init() {
        document.addEventListener('keydown', onKeydown, true);
        observeAll();
        labelIconButtons(document);
        // Modal nạp bất đồng bộ (ui/load_modals.js) -> quan sát + gắn nhãn lại sau khi có DOM.
        document.addEventListener('clientpro:modals-loaded', () => { observeAll(); labelIconButtons(document); });
    }
    return { init, observeAll, labelIconButtons };
})();
window.ModalA11y = ModalA11y;

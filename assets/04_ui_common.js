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
    currentLightboxIndex += dir; if (currentLightboxIndex < 0) currentLightboxIndex = currentLightboxList.length - 1; if (currentLightboxIndex >= currentLightboxList.length) currentLightboxIndex = 0;
    const imgEl = getEl('lightbox-img');
    imgEl.style.transform = dir > 0 ? 'translateX(-20px)' : 'translateX(20px)'; imgEl.style.opacity = '0';
    setTimeout(() => { imgEl.src = currentLightboxList[currentLightboxIndex].data; imgEl.style.transform = dir > 0 ? 'translateX(20px)' : 'translateX(-20px)'; setTimeout(() => { imgEl.style.transform = 'translateX(0)'; imgEl.style.opacity = '1'; currentImageId = currentLightboxList[currentLightboxIndex].id; currentImageBase64 = currentLightboxList[currentLightboxIndex].data; getEl('lightbox-counter').textContent = `${currentLightboxIndex + 1}/${currentLightboxList.length}`; }, 50); }, 150);
}
function openLightbox(src, id, idx, list) {
    getEl('lightbox').classList.remove('hidden'); currentLightboxIndex = idx;
    if (list && list.length > 0) currentLightboxList = list; else currentLightboxList = [{ id: id, data: src }];
    const imgEl = getEl('lightbox-img'); imgEl.src = src; currentImageId = id; currentImageBase64 = src; getEl('lightbox-counter').textContent = `${currentLightboxIndex + 1}/${currentLightboxList.length}`;
}
function closeLightbox() { getEl('lightbox').classList.add('hidden'); }

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
        store.get(id).onsuccess = (e) => {
            const rec = e.target.result;
            if (!rec) return;
            try { if (typeof mutate === 'function') mutate(rec); } catch (err) { if (window.ErrorHandler) ErrorHandler.logError('persistCurrentCustomer mutate error', err); return; }
            // Healing: bản cũ có thể đã lưu plaintext — mã hóa lại các trường nhạy cảm.
            try {
                if (typeof masterKey !== 'undefined' && masterKey && typeof encryptText === 'function') {
                    ['name', 'phone', 'cccd'].forEach((k) => {
                        const v = rec[k];
                        if (v && typeof v === 'string' && !v.startsWith('U2FsdGVkX1')) rec[k] = encryptText(v);
                    });
                }
            } catch (err) { }
            store.put(rec);
            ok = true;
        };
        tx.oncomplete = () => { if (typeof onDone === 'function') onDone(ok); };
        tx.onerror = () => { if (typeof onDone === 'function') onDone(false); };
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
    const app = document.getElementById('app');
    if (app) app.classList.remove('selection-mode', 'cust-selection-mode', 'image-selection-mode', 'active-selection');
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
        window.location.href = fallback;
        return;
    }

    // Desktop: mở web zalo.me
    const win = window.open(fallback, '_blank', 'noopener');
    if (!win) window.location.href = fallback;
}
function showToast(msg) { const t = getEl('toast'); getEl('toast-msg').textContent = msg; t.classList.add('toast-show'); setTimeout(() => t.classList.remove('toast-show'), 2000); }
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
// CAMERA WRAPPER (直接 gọi không cần lazy load)
// ============================================================

// Camera: Gọi trực tiếp camera function
function tryOpenCamera(mode) {
    try {
        // Call actual tryOpenCamera from 08_images_camera.js
        if (typeof window._tryOpenCameraReal === 'function') {
            window._tryOpenCameraReal(mode);
        } else {
            ErrorHandler.showWarning('Camera chưa sẵn sàng');
        }
    } catch (e) {
        ErrorHandler.showError('CAMERA', undefined, e);
    }
}

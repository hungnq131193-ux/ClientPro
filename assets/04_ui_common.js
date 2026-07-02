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
function clearSelectionHistoryLayer() { __selectionHistoryActive = false; }

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
function getZaloDeepLink(phone) {
    const p = normalizePhoneForLink(phone);
    return p ? `zalo://conversation?phone=${encodeURIComponent(p)}` : '#';
}
function isMobileDevice() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
}
function getTelLink(phone) {
    const p = normalizePhoneForLink(phone);
    return p ? `tel:+${p}` : '#';
}
function isAndroidDevice() {
    return /Android/i.test(navigator.userAgent || '');
}
function isIOSDevice() {
    const ua = navigator.userAgent || '';
    // iPadOS mới báo UA là "Macintosh" nên phải kiểm tra thêm cảm ứng
    return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1);
}
function openZaloChat(phone) {
    const p = normalizePhoneForLink(phone);
    const fallback = getZaloLink(phone);
    const deep = getZaloDeepLink(phone);
    if (!p || fallback === '#' || deep === '#') {
        showToast('Chưa có số điện thoại để mở Zalo');
        return;
    }

    // ANDROID: dùng intent URL — Chrome/WebView sẽ mở thẳng app Zalo
    // (package com.zing.zalo). Nếu máy CHƯA cài Zalo, trình duyệt tự chuyển
    // sang browser_fallback_url. Không dùng timer nên không còn tình trạng
    // app đã mở mà trang vẫn nhảy sang zalo.me web.
    if (isAndroidDevice()) {
        window.location.href =
            'intent://conversation?phone=' + encodeURIComponent(p) +
            '#Intent;scheme=zalo;package=com.zing.zalo;' +
            'S.browser_fallback_url=' + encodeURIComponent(fallback) + ';end';
        return;
    }

    // iOS: mở bằng scheme zalo://. Chỉ fallback sang zalo.me khi chắc chắn
    // app không mở: chờ lâu hơn (2.5s vì iOS có hộp thoại "Mở bằng Zalo?"),
    // bắt thêm blur/pagehide, và nếu timer bị "đóng băng" (đã chuyển sang
    // app rồi quay lại) thì bỏ qua fallback.
    if (isIOSDevice()) {
        let didLeavePage = false;
        const markLeft = () => { didLeavePage = true; };
        document.addEventListener('visibilitychange', markLeft, { once: true });
        window.addEventListener('pagehide', markLeft, { once: true });
        window.addEventListener('blur', markLeft, { once: true });
        const startedAt = Date.now();
        setTimeout(() => {
            const timerWasFrozen = (Date.now() - startedAt) > 3200;
            if (didLeavePage || document.hidden || timerWasFrozen) return;
            window.location.href = fallback;
        }, 2500);
        window.location.href = deep;
        return;
    }

    // Điện thoại khác (hiếm) vẫn thử deep link trước
    if (isMobileDevice()) {
        window.location.href = deep;
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
            showToast('Camera chưa sẵn sàng');
        }
    } catch (e) {
        console.error('tryOpenCamera error:', e);
        showToast('Không mở được camera');
    }
}

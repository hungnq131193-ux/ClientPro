function setupSwipe() {
    const lb = getEl('lightbox'); let startX = 0; let endX = 0;
    lb.addEventListener('touchstart', e => { startX = e.changedTouches[0].screenX; }, { passive: true });
    lb.addEventListener('touchend', e => { endX = e.changedTouches[0].screenX; handleSwipe(); }, { passive: true });
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
    if (list && list.length > 0) currentLightboxList = list; else currentLightboxList = [{ id: id, data: src }];
    const imgEl = getEl('lightbox-img'); imgEl.src = src; currentImageId = id; currentImageBase64 = src; getEl('lightbox-counter').textContent = `${currentLightboxIndex + 1}/${currentLightboxList.length}`;
}
function closeLightbox() { getEl('lightbox').classList.add('hidden'); }

let currentCustomerId = null; let currentCustomerData = null; let currentAssetId = null;
let activeListTab = 'pending'; let isSelectionMode = false; let selectedImages = new Set();
let isCustSelectionMode = false; let selectedCustomers = new Set();
let captureMode = 'profile'; let stream = null; let currentImageId = null; let currentImageBase64 = null;

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
function openZaloChat(phone) {
    const p = normalizePhoneForLink(phone);
    const fallback = getZaloLink(phone);
    const deep = getZaloDeepLink(phone);
    if (!p || fallback === '#' || deep === '#') {
        showToast('Chưa có số điện thoại để mở Zalo');
        return;
    }

    // Trên điện thoại ưu tiên mở app Zalo bằng deep link. Nếu thiết bị không
    // bắt được scheme (chưa cài Zalo / trình duyệt chặn), tự chuyển sang
    // zalo.me để nút vẫn có phản hồi thay vì "bấm không thấy gì".
    if (isMobileDevice()) {
        let didLeavePage = false;
        const markLeft = () => { didLeavePage = true; };
        document.addEventListener('visibilitychange', markLeft, { once: true });
        window.addEventListener('pagehide', markLeft, { once: true });
        setTimeout(() => {
            if (!didLeavePage && !document.hidden) window.location.href = fallback;
        }, 1200);
        window.location.href = deep;
        return;
    }

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

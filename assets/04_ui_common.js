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

function getZaloLink(phone) { let p = phone.replace(/[\s\.]/g, ''); if (p.startsWith('0')) p = '84' + p.substring(1); return `https://zalo.me/${p}`; }
function showToast(msg) { const t = getEl('toast'); getEl('toast-msg').textContent = msg; t.classList.add('toast-show'); setTimeout(() => t.classList.remove('toast-show'), 2000); }
function formatLink(link) { if (!link) return ''; if (link.startsWith('http')) return link; return 'https://' + link; }

// ============================================================
// LAZY LOADING WRAPPER (Camera only - other modules load normally)
// ============================================================

// Camera: Lazy load then call tryOpenCamera
async function tryOpenCamera(mode) {
    try {
        if (typeof LazyLoader !== 'undefined' && !LazyLoader.isLoaded('camera')) {
            getEl('loader').classList.remove('hidden');
            getEl('loader-text').textContent = 'Đang tải camera...';
            await LazyLoader.loadCamera();
            getEl('loader').classList.add('hidden');
        }
        // Call actual tryOpenCamera from 08_images_camera.js
        if (typeof window._tryOpenCameraReal === 'function') {
            window._tryOpenCameraReal(mode);
        }
    } catch (e) {
        getEl('loader').classList.add('hidden');
        showToast('Không tải được camera');
    }
}

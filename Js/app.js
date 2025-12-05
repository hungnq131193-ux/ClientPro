/* app.js - Khởi động ứng dụng */

document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    const setAppHeight = () => document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
    window.addEventListener('resize', setAppHeight); setAppHeight();
    
    let savedTheme = localStorage.getItem(THEME_KEY);
    const validThemes = ['theme-midnight', 'theme-sunset', 'theme-ocean', 'theme-mint', 'theme-royal'];
    if (!validThemes.includes(savedTheme)) savedTheme = 'theme-midnight';
    setTheme(savedTheme);

    initWeather();
    
    const savedUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if(savedUrl) getEl('user-script-url').value = savedUrl;

    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = e => { 
        db = e.target.result; 
        if(!db.objectStoreNames.contains('customers')) db.createObjectStore('customers', {keyPath:'id'});
        let imgStore;
        if(!db.objectStoreNames.contains('images')) imgStore = db.createObjectStore('images', {keyPath:'id'});
        else imgStore = e.target.transaction.objectStore('images');
        if(!imgStore.indexNames.contains('customerId')) imgStore.createIndex('customerId', 'customerId', {unique: false});
    };
    req.onsuccess = e => { db = e.target.result; loadCustomers(); getEl('loader').classList.add('hidden'); checkSecurity(); };
    getEl('search-input').addEventListener('input', e => loadCustomers(e.target.value));
    setupSwipe();
});

// Service Worker Registration
function showUpdateToast() {
    const toast = document.getElementById('toast'); const msg = document.getElementById('toast-msg');
    if (toast && msg) {
        msg.textContent = "Đang cập nhật phiên bản mới..."; toast.classList.add('toast-show');
        if ('caches' in window) { caches.keys().then((names) => { names.forEach(name => caches.delete(name)); }); }
        setTimeout(() => { window.location.reload(true); }, 2000);
    }
}
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            reg.update();
            reg.addEventListener('updatefound', () => {
                newWorker = reg.installing;
                newWorker.addEventListener('statechange', () => { if (newWorker.state === 'installed' && navigator.serviceWorker.controller) { showUpdateToast(); } });
            });
        });
        let refreshing;
        navigator.serviceWorker.addEventListener('controllerchange', () => { if (refreshing) return; window.location.reload(); refreshing = true; });
    });
}

// History API Hack (Support Back Button)
(function() {
    const _org = {};
    ['openModal','closeModal','openFolder','closeFolder','openAssetGallery','closeAssetGallery','openAssetModal','openEditAssetModal','closeAssetModal','showRefModal','closeRefModal','toggleMap','openQrScanner','openRedBookScanner','closeQrScanner','toggleCustSelectionMode','toggleSelectionMode','viewSavedOcr','openLightbox','closeLightbox','openEditCustomerModal'].forEach(fn => { if (typeof window[fn] === 'function') { _org[fn] = window[fn]; } });
    function pushState(stateObj, hash) { try { history.pushState(stateObj, null, hash); } catch (e) {} }
    if (_org.openModal) window.openModal = function() { _org.openModal.apply(this, arguments); pushState({ screen: 'add-modal' }, '#add-modal'); };
    if (_org.openEditCustomerModal) window.openEditCustomerModal = function() { _org.openEditCustomerModal.apply(this, arguments); pushState({ screen: 'add-modal' }, '#edit-customer'); };
    if (_org.closeModal) window.closeModal = function() { history.back(); };
    if (_org.openFolder) window.openFolder = function(id) { _org.openFolder.apply(this, arguments); pushState({ screen: 'screen-folder', id: id }, '#folder-' + id); };
    if (_org.closeFolder) window.closeFolder = function() { history.back(); };
    if (_org.openAssetGallery) window.openAssetGallery = function(id, name, idx) { _org.openAssetGallery.apply(this, arguments); pushState({ screen: 'screen-asset-gallery', id: id }, '#asset-gallery-' + id); };
    if (_org.closeAssetGallery) window.closeAssetGallery = function() { history.back(); };
    if (_org.openAssetModal) window.openAssetModal = function() { _org.openAssetModal.apply(this, arguments); pushState({ screen: 'asset-modal' }, '#asset-modal'); };
    if (_org.openEditAssetModal) window.openEditAssetModal = function() { _org.openEditAssetModal.apply(this, arguments); pushState({ screen: 'asset-modal' }, '#asset-modal'); };
    if (_org.closeAssetModal) window.closeAssetModal = function() { history.back(); };
    if (_org.showRefModal) window.showRefModal = function() { _org.showRefModal.apply(this, arguments); pushState({ screen: 'ref-price-modal' }, '#ref-price-modal'); };
    if (_org.closeRefModal) window.closeRefModal = function() { history.back(); };
    if (_org.toggleMap) window.toggleMap = function() { const mapScreen = document.getElementById('screen-map'); const isHidden = mapScreen && mapScreen.classList.contains('translate-x-full'); if (isHidden) { _org.toggleMap.apply(this, arguments); pushState({ screen: 'screen-map' }, '#screen-map'); } else { history.back(); } };
    if (_org.openQrScanner) window.openQrScanner = function() { _org.openQrScanner.apply(this, arguments); pushState({ screen: 'qr-modal' }, '#qr-scanner'); };
    if (_org.openRedBookScanner) window.openRedBookScanner = function() { _org.openRedBookScanner.apply(this, arguments); pushState({ screen: 'qr-modal' }, '#qr-redbook'); };
    if (_org.closeQrScanner) window.closeQrScanner = function() { history.back(); };
    if (_org.toggleCustSelectionMode) window.toggleCustSelectionMode = function() { const bar = document.getElementById('cust-selection-bar'); const visible = bar && !bar.classList.contains('translate-y-full'); if (!visible) { _org.toggleCustSelectionMode.apply(this, arguments); pushState({ screen: 'cust-selection-bar' }, '#cust-selection-bar'); } else { history.back(); } };
    if (_org.toggleSelectionMode) window.toggleSelectionMode = function() { const bar = document.getElementById('selection-bar'); const visible = bar && !bar.classList.contains('translate-y-full'); if (!visible) { _org.toggleSelectionMode.apply(this, arguments); pushState({ screen: 'selection-bar' }, '#selection-bar'); } else { history.back(); } };
    if (_org.openLightbox) window.openLightbox = function(src, id, idx, list) { _org.openLightbox.apply(this, arguments); pushState({ screen: 'lightbox', id: id }, '#lightbox'); };
    if (_org.closeLightbox) window.closeLightbox = function() { history.back(); };
    if (_org.viewSavedOcr) window.viewSavedOcr = function(assetId) { _org.viewSavedOcr.apply(this, arguments); pushState({ screen: 'qr-info', id: assetId }, '#qrinfo-' + assetId); setTimeout(() => { const overlays = document.querySelectorAll('div.fixed.inset-0'); overlays.forEach(overlay => { if (!overlay.dataset || overlay.dataset.historyHandled) return; if (overlay.innerHTML && overlay.innerHTML.includes('Thông tin QR')) { overlay.dataset.historyHandled = 'true'; const buttons = overlay.querySelectorAll('button'); buttons.forEach(btn => { const text = (btn.textContent || btn.innerText || '').trim(); if (text === 'Đóng') { btn.onclick = function(ev) { ev.preventDefault(); history.back(); }; } }); } }); }, 0); };
    window.addEventListener('popstate', function() {
        const dyn = document.querySelector('div[data-history-handled="true"]'); if (dyn) { dyn.remove(); return; }
        const lb = document.getElementById('lightbox'); if (lb && !lb.classList.contains('hidden')) { if (_org.closeLightbox) _org.closeLightbox(); return; }
        const qrModal = document.getElementById('qr-modal'); if (qrModal && !qrModal.classList.contains('hidden')) { if (_org.closeQrScanner) _org.closeQrScanner(); return; }
        const assetModal = document.getElementById('asset-modal'); if (assetModal && !assetModal.classList.contains('hidden')) { if (_org.closeAssetModal) _org.closeAssetModal(); return; }
        const refModal = document.getElementById('ref-price-modal'); if (refModal && !refModal.classList.contains('hidden')) { if (_org.closeRefModal) _org.closeRefModal(); return; }
        const addModal = document.getElementById('add-modal'); if (addModal && !addModal.classList.contains('hidden')) { if (_org.closeModal) _org.closeModal(); return; }
        const custBar = document.getElementById('cust-selection-bar'); if (custBar && !custBar.classList.contains('translate-y-full')) { if (_org.toggleCustSelectionMode) _org.toggleCustSelectionMode(); return; }
        const selBar = document.getElementById('selection-bar'); if (selBar && !selBar.classList.contains('translate-y-full')) { if (_org.toggleSelectionMode) _org.toggleSelectionMode(); return; }
        const ag = document.getElementById('screen-asset-gallery'); if (ag && !ag.classList.contains('translate-x-full')) { if (_org.closeAssetGallery) _org.closeAssetGallery(); return; }
        const sf = document.getElementById('screen-folder'); if (sf && !sf.classList.contains('translate-x-full')) { if (_org.closeFolder) _org.closeFolder(); return; }
        const sm = document.getElementById('screen-map'); if (sm && !sm.classList.contains('translate-x-full')) { if (_org.toggleMap) _org.toggleMap(); return; }
    });
})();

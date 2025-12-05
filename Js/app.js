/**
 * APP.JS (BOOTSTRAP)
 * Điểm khởi chạy của ứng dụng.
 * Khởi tạo Database, Sự kiện và Xử lý nút Back (History API).
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Init UI Frameworks
    if (window.lucide) lucide.createIcons();
    
    // 2. Mobile Viewport Fix
    const setAppHeight = () => document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
    window.addEventListener('resize', setAppHeight); 
    setAppHeight();

    // 3. Load Theme
    let savedTheme = localStorage.getItem(THEME_KEY);
    const validThemes = VALID_THEMES || ['theme-midnight'];
    if (!validThemes.includes(savedTheme)) savedTheme = 'theme-midnight';
    setTheme(savedTheme);

    // 4. Init Weather & Drive Config
    if(typeof initWeather === 'function') initWeather();
    if(typeof initDriveConfig === 'function') initDriveConfig();

    // 5. Init Database (Core)
    // Database init sẽ tự gọi loadCustomers() và checkSecurity() khi sẵn sàng
    if(typeof initDatabase === 'function') initDatabase();

    // 6. Setup Global Events
    const searchInput = getEl('search-input');
    if(searchInput) searchInput.addEventListener('input', e => loadCustomers(e.target.value));
    
    if(typeof setupSwipe === 'function') setupSwipe();

    // 7. MONKEY PATCH: History API for Mobile Back Button
    // Giúp nút Back trên điện thoại đóng Modal thay vì thoát App
    (function() {
        const _org = {};
        [
            'openModal','closeModal','openFolder','closeFolder','openAssetGallery','closeAssetGallery',
            'openAssetModal','openEditAssetModal','closeAssetModal','showRefModal','closeRefModal',
            'toggleMap','openQrScanner','openRedBookScanner','closeQrScanner','toggleCustSelectionMode',
            'toggleSelectionMode','viewSavedOcr','openLightbox','closeLightbox','openEditCustomerModal'
        ].forEach(fn => {
            if (typeof window[fn] === 'function') _org[fn] = window[fn];
        });

        function pushState(stateObj, hash) {
            try { history.pushState(stateObj, null, hash); } catch (e) {}
        }

        // Override Open Functions to Push State
        if (_org.openFolder) window.openFolder = function(id) { _org.openFolder.apply(this, arguments); pushState({ screen: 'folder' }, '#folder'); };
        if (_org.openAssetGallery) window.openAssetGallery = function() { _org.openAssetGallery.apply(this, arguments); pushState({ screen: 'gallery' }, '#gallery'); };
        if (_org.toggleMap) window.toggleMap = function() {
            const mapScreen = document.getElementById('screen-map');
            if (mapScreen && mapScreen.classList.contains('translate-x-full')) {
                _org.toggleMap.apply(this, arguments); pushState({ screen: 'map' }, '#map');
            } else history.back();
        };
        // ... (Các override khác tương tự, giữ logic gọn cho các modal chính)
        if (_org.openModal) window.openModal = function() { _org.openModal.apply(this, arguments); pushState({ screen: 'modal' }, '#add-modal'); };
        if (_org.openLightbox) window.openLightbox = function() { _org.openLightbox.apply(this, arguments); pushState({ screen: 'lightbox' }, '#lightbox'); };

        // Handle Popstate (Back Button)
        window.addEventListener('popstate', function() {
            // Priority Closing Logic
            if(getEl('lightbox') && !getEl('lightbox').classList.contains('hidden')) { if(_org.closeLightbox) _org.closeLightbox(); return; }
            if(getEl('qr-modal') && !getEl('qr-modal').classList.contains('hidden')) { if(_org.closeQrScanner) _org.closeQrScanner(); return; }
            if(getEl('asset-modal') && !getEl('asset-modal').classList.contains('hidden')) { if(_org.closeAssetModal) _org.closeAssetModal(); return; }
            if(getEl('ref-price-modal') && !getEl('ref-price-modal').classList.contains('hidden')) { if(_org.closeRefModal) _org.closeRefModal(); return; }
            if(getEl('add-modal') && !getEl('add-modal').classList.contains('hidden')) { if(_org.closeModal) _org.closeModal(); return; }
            
            if(getEl('screen-asset-gallery') && !getEl('screen-asset-gallery').classList.contains('translate-x-full')) { if(_org.closeAssetGallery) _org.closeAssetGallery(); return; }
            if(getEl('screen-folder') && !getEl('screen-folder').classList.contains('translate-x-full')) { if(_org.closeFolder) _org.closeFolder(); return; }
            if(getEl('screen-map') && !getEl('screen-map').classList.contains('translate-x-full')) { if(_org.toggleMap) _org.toggleMap(); return; }
        });
    })();
});

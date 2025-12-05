document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    const setAppHeight = () => document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
    window.addEventListener('resize', setAppHeight);
    setAppHeight();

    // Load Theme
    let savedTheme = localStorage.getItem(THEME_KEY);
    const validThemes = ['theme-midnight', 'theme-sunset', 'theme-ocean', 'theme-mint', 'theme-royal'];
    if (!validThemes.includes(savedTheme)) {
        savedTheme = 'theme-midnight';
    }
    if (window.setTheme) setTheme(savedTheme);

    // Init Weather
    if (window.initWeather) initWeather();

    // Load Script URL
    const savedUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if (savedUrl && getEl('user-script-url')) getEl('user-script-url').value = savedUrl;

    // Init Database
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = e => {
        db = e.target.result;
        if (!db.objectStoreNames.contains('customers')) db.createObjectStore('customers', { keyPath: 'id' });
        let imgStore;
        if (!db.objectStoreNames.contains('images')) imgStore = db.createObjectStore('images', { keyPath: 'id' });
        else imgStore = e.target.transaction.objectStore('images');
        if (!imgStore.indexNames.contains('customerId')) imgStore.createIndex('customerId', 'customerId', { unique: false });
    };
    req.onsuccess = e => {
        db = e.target.result;
        if (window.loadCustomers) loadCustomers();
        getEl('loader').classList.add('hidden');
        if (window.checkSecurity) checkSecurity();
    };

    // Event Listeners
    if(getEl('search-input')) getEl('search-input').addEventListener('input', e => loadCustomers(e.target.value));
    if(window.setupSwipe) setupSwipe();
});

// --- Service Worker Registration ---
let newWorker;
function showUpdateToast() {
    const toast = document.getElementById('toast');
    const msg = document.getElementById('toast-msg');
    if (toast && msg) {
        msg.textContent = "Đang cập nhật phiên bản mới...";
        toast.classList.add('toast-show');
        if ('caches' in window) {
            caches.keys().then((names) => {
                names.forEach(name => caches.delete(name));
            });
        }
        setTimeout(() => {
            window.location.reload(true);
        }, 2000);
    }
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            reg.update();
            reg.addEventListener('updatefound', () => {
                newWorker = reg.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        showUpdateToast();
                    }
                });
            });
        });
        let refreshing;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            window.location.reload();
            refreshing = true;
        });
    });
}

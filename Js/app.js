// ============================================================
// APP.JS - KHỞI ĐỘNG ỨNG DỤNG & SERVICE WORKER
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    // 1. Tạo icon SVG
    if(window.lucide) lucide.createIcons();

    // 2. Fix chiều cao trên Mobile (tránh thanh địa chỉ che mất nút)
    const setAppHeight = () => document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
    window.addEventListener('resize', setAppHeight);
    setAppHeight();

    // 3. Khôi phục giao diện (Theme) đã lưu
    let savedTheme = localStorage.getItem(THEME_KEY);
    const validThemes = ['theme-midnight', 'theme-sunset', 'theme-ocean', 'theme-mint', 'theme-royal'];
    
    // Nếu theme cũ không hợp lệ, reset về mặc định
    if (!validThemes.includes(savedTheme)) {
        savedTheme = 'theme-midnight';
    }
    if (window.setTheme) setTheme(savedTheme);

    // 4. Khởi động Widget Thời tiết
    if (window.initWeather) initWeather();

    // 5. Khôi phục Link Script cá nhân (nếu có)
    const savedUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if (savedUrl && getEl('user-script-url')) {
        getEl('user-script-url').value = savedUrl;
    }

    // 6. MỞ KẾT NỐI DATABASE (INDEXEDDB)
    const req = indexedDB.open(DB_NAME, 3);

    // Xử lý khi tạo mới hoặc nâng cấp DB
    req.onupgradeneeded = e => {
        db = e.target.result;
        // Tạo bảng Customers (Khách hàng)
        if (!db.objectStoreNames.contains('customers')) {
            db.createObjectStore('customers', { keyPath: 'id' });
        }
        
        // Tạo bảng Images (Ảnh)
        let imgStore;
        if (!db.objectStoreNames.contains('images')) {
            imgStore = db.createObjectStore('images', { keyPath: 'id' });
        } else {
            imgStore = e.target.transaction.objectStore('images');
        }
        
        // Tạo Index để tìm ảnh theo CustomerId nhanh hơn
        if (!imgStore.indexNames.contains('customerId')) {
            imgStore.createIndex('customerId', 'customerId', { unique: false });
        }
    };

    // Xử lý khi mở DB thành công
    req.onsuccess = e => {
        db = e.target.result;
        
        // Tắt màn hình loading
        const loader = getEl('loader');
        if(loader) loader.classList.add('hidden');

        // Load danh sách khách hàng
        if (window.loadCustomers) loadCustomers();
        
        // Kiểm tra bảo mật (PIN/Kích hoạt)
        if (window.checkSecurity) checkSecurity();
    };

    req.onerror = e => {
        console.error("Lỗi mở Database:", e);
        alert("Không thể truy cập dữ liệu trong máy. Vui lòng tải lại trang.");
    };

    // 7. Gắn sự kiện tìm kiếm (Search)
    const searchInput = getEl('search-input');
    if(searchInput) {
        searchInput.addEventListener('input', (e) => {
            if(window.loadCustomers) loadCustomers(e.target.value);
        });
    }

    // 8. Kích hoạt tính năng vuốt (Swipe) xem ảnh
    if(window.setupSwipe) setupSwipe();
});

// ============================================================
// SERVICE WORKER (PWA - CHẠY OFFLINE)
// ============================================================

let newWorker;

function showUpdateToast() {
    const toast = getEl('toast');
    const msg = getEl('toast-msg');
    
    if (toast && msg) {
        msg.textContent = "Đang cập nhật phiên bản mới...";
        toast.classList.add('toast-show');
        
        // Xóa cache cũ để tránh xung đột
        if ('caches' in window) {
            caches.keys().then((names) => {
                names.forEach(name => caches.delete(name));
            });
        }
        
        // Reload sau 2 giây để áp dụng bản mới
        setTimeout(() => {
            window.location.reload(true);
        }, 2000);
    }
}

// Đăng ký Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            // Kiểm tra cập nhật ngay khi mở
            reg.update();

            // Nếu phát hiện bản mới đang tải về
            reg.addEventListener('updatefound', () => {
                newWorker = reg.installing;
                newWorker.addEventListener('statechange', () => {
                    // Tải xong và chờ kích hoạt
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        showUpdateToast();
                    }
                });
            });
        });

        // Nếu Service Worker thay đổi (đã update xong), reload trang
        let refreshing;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            window.location.reload();
            refreshing = true;
        });
    });
}

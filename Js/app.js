        document.addEventListener('DOMContentLoaded', () => {
            lucide.createIcons();
            const setAppHeight = () => document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
            window.addEventListener('resize', setAppHeight); setAppHeight();
let savedTheme = localStorage.getItem(THEME_KEY);
// Danh sách các theme hợp lệ hiện tại
const validThemes = ['theme-midnight', 'theme-sunset', 'theme-ocean', 'theme-mint', 'theme-royal'];

// Nếu theme trong bộ nhớ không nằm trong danh sách mới (do code cũ), ép về Midnight
if (!validThemes.includes(savedTheme)) {
    savedTheme = 'theme-midnight';
}

setTheme(savedTheme);

            setTheme(savedTheme);
// 🌤 Khởi động thời tiết
initWeather();
            
            const req = indexedDB.open(DB_NAME, 3);
            req.onupgradeneeded = e => { 
                db = e.target.result; 
                if(!db.objectStoreNames.contains('customers')) db.createObjectStore('customers', {keyPath:'id'});
document.addEventListener('DOMContentLoaded', () => {
    const savedUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if(savedUrl) getEl('user-script-url').value = savedUrl;
});
let newWorker;

    function showUpdateToast() {
        const toast = document.getElementById('toast');
        const msg = document.getElementById('toast-msg');
        if (toast && msg) {
            msg.textContent = "Đang cập nhật phiên bản mới...";
            toast.classList.add('toast-show');
            
            // Xóa cache cũ để tránh xung đột
            if ('caches' in window) {
                caches.keys().then((names) => {
                    names.forEach(name => caches.delete(name));
                });
            }
            
            // Reload sau 2 giây
            setTimeout(() => {
                window.location.reload(true);
            }, 2000);
        }
    }

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').then(reg => {
                
                // 1. Kiểm tra updates ngay lập tức
                reg.update();

                // 2. Nếu tìm thấy bản mới đang cài đặt
                reg.addEventListener('updatefound', () => {
                    newWorker = reg.installing;
                    newWorker.addEventListener('statechange', () => {
                        // Nếu cài xong và đang chờ kích hoạt
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            showUpdateToast();
                        }
                    });
                });
            });

            // 3. Nếu phát hiện controller thay đổi (nghĩa là đã update xong) thì reload trang
            let refreshing;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (refreshing) return;
                window.location.reload();
                refreshing = true;
            });
        });
    }
    <script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js');
    });
  }
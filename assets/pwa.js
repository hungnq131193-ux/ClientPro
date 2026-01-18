    // Đăng ký PWA Service Worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => console.log('Service Worker đã sẵn sàng!', reg))
                .catch(err => console.log('Lỗi Service Worker:', err));
        });
    }

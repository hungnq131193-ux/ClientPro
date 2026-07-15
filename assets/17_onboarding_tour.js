// =======================
// ONBOARDING TOUR
// Show interactive tour for first-time users
// UI classes (.tour-*) định nghĩa trong assets/styles.css — z-index contract:
// overlay 1000, spotlight 1001, card 1002.
// =======================

(function () {
    const TOUR_KEY = 'clientpro_onboarding_done';
    const TOUR_VERSION = 4; // Increment to show tour again after major updates

    // Tour steps configuration.
    // Mọi target phải là phần tử VISIBLE trên Dashboard sau unlock — không spotlight
    // phần tử nằm trong màn hình đang ẩn (positionStep fallback về center nếu thiếu).
    const tourSteps = [
        {
            target: null, // Welcome screen - no target
            icon: '👋',
            title: 'Chào mừng đến ClientPro!',
            content: 'Ứng dụng quản lý khách hàng chuyên nghiệp dành cho cán bộ tín dụng. Cùng xem nhanh các tính năng chính nhé!',
            position: 'center'
        },
        {
            target: 'button[data-action="openCustomerList"][data-arg="pending"]',
            icon: '🔍',
            title: 'Danh sách & tìm kiếm',
            content: 'Chạm vào ô này để mở danh sách khách hàng, rồi dùng ô tìm kiếm ở đầu danh sách để tìm theo tên, SĐT, CCCD...',
            position: 'bottom'
        },
        {
            target: '#btn-quick-add',
            icon: '➕',
            title: 'Thêm khách hàng mới',
            content: 'Nhấn nút này để tạo hồ sơ khách hàng mới.',
            position: 'top-left'
        },
        {
            target: '#btn-quick-map',
            icon: '🗺️',
            title: 'Xem bản đồ',
            content: 'Xem vị trí tất cả khách hàng trên bản đồ.',
            position: 'top-left'
        },
        {
            target: 'button[data-action="openBackupManager"]',
            icon: '💾',
            title: 'Sao lưu & khôi phục',
            content: 'Sao lưu dữ liệu lên Drive hoặc xuất file, và khôi phục khi cần.',
            position: 'top-left'
        },
        {
            target: '#btn-open-menu',
            icon: '⚙️',
            title: 'Cài đặt',
            content: 'Đổi giao diện, bảo mật PIN / sinh trắc học và ủng hộ.',
            position: 'bottom-left'
        },
        {
            target: 'button[data-action="toggleDashboardDriveConfig"]',
            icon: '☁️',
            title: 'Cài đặt Google Drive',
            content: 'Cấu hình Google Drive để lưu ảnh hồ sơ của bạn.',
            position: 'top-left'
        },
        {
            target: null,
            icon: '🎉',
            title: 'Sẵn sàng!',
            content: 'Bạn đã sẵn sàng sử dụng ClientPro. Chúc bạn làm việc hiệu quả!',
            position: 'center'
        }
    ];

    let currentStep = 0;
    let overlay = null;
    let card = null;
    let spotlight = null;
    let resizeHandler = null;
    let resizeTimer = null;

    // Check if tour should be shown
    function shouldShowTour() {
        try {
            const done = localStorage.getItem(TOUR_KEY);
            if (!done) return true;
            const parsed = JSON.parse(done);
            return parsed.version < TOUR_VERSION;
        } catch (e) {
            return true;
        }
    }

    // Mark tour as completed
    function markTourComplete() {
        try {
            localStorage.setItem(TOUR_KEY, JSON.stringify({ version: TOUR_VERSION, completedAt: Date.now() }));
        } catch (e) { }
    }

    // Create tour UI elements
    function createTourUI() {
        overlay = el('div', { id: 'tour-overlay', className: 'tour-overlay' });
        spotlight = el('div', { id: 'tour-spotlight', className: 'tour-spotlight', 'aria-hidden': 'true' });
        card = el('div', { id: 'tour-tooltip', className: 'tour-card', role: 'dialog', 'aria-modal': 'true' });

        document.body.appendChild(overlay);
        document.body.appendChild(spotlight);
        document.body.appendChild(card);

        // Reposition khi xoay màn hình / đổi kích thước (debounce nhẹ)
        resizeHandler = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => { if (overlay) positionStep(); }, 150);
        };
        window.addEventListener('resize', resizeHandler);

        // Fade in
        requestAnimationFrame(() => {
            overlay.classList.add('is-visible');
        });
    }

    // Remove tour UI
    function removeTourUI() {
        if (resizeHandler) {
            window.removeEventListener('resize', resizeHandler);
            clearTimeout(resizeTimer);
            resizeHandler = null;
        }
        if (overlay) overlay.classList.remove('is-visible');
        if (spotlight) spotlight.classList.remove('is-on');
        if (card) card.style.opacity = '0';
        setTimeout(() => {
            overlay && overlay.remove();
            spotlight && spotlight.remove();
            card && card.remove();
            overlay = spotlight = card = null;
        }, 350);
    }

    // Position spotlight + card for current step
    function positionStep() {
        const stepData = tourSteps[currentStep];
        const isCenter = !stepData.target || stepData.position === 'center';
        let target = isCenter ? null : document.querySelector(stepData.target);

        // Target đang ẩn (nằm trong màn hình chưa mở) hoặc ngoài viewport
        // -> không có gì để spotlight, fallback về card center.
        if (target) {
            const r = target.getBoundingClientRect();
            if (r.width < 4 || r.height < 4 || r.bottom <= 0 || r.top >= window.innerHeight) target = null;
        }

        if (!target) {
            // Center on screen (welcome/finish, hoặc fallback khi thiếu target)
            overlay.classList.add('is-dim');
            spotlight.classList.remove('is-on');
            card.classList.add('tour-card--center');
            card.style.top = '';
            card.style.left = '';
            return;
        }

        overlay.classList.remove('is-dim');
        card.classList.remove('tour-card--center');

        const rect = target.getBoundingClientRect();
        const padding = 8;

        // Position spotlight around target (scrim đến từ box-shadow của spotlight)
        spotlight.style.top = (rect.top - padding) + 'px';
        spotlight.style.left = (rect.left - padding) + 'px';
        spotlight.style.width = (rect.width + padding * 2) + 'px';
        spotlight.style.height = (rect.height + padding * 2) + 'px';
        spotlight.classList.add('is-on');

        // Đo kích thước thật của card (nội dung đã render) thay vì hằng số cứng
        const cardWidth = card.offsetWidth || 300;
        const cardHeight = card.offsetHeight || 180;
        const gap = 14;
        let top, left;

        switch (stepData.position) {
            case 'bottom':
                top = rect.bottom + gap;
                left = rect.left + rect.width / 2 - cardWidth / 2;
                break;
            case 'top':
                top = rect.top - cardHeight - gap;
                left = rect.left + rect.width / 2 - cardWidth / 2;
                break;
            case 'top-left':
                top = rect.top - cardHeight - gap;
                left = rect.left - cardWidth + rect.width;
                break;
            case 'bottom-left':
                top = rect.bottom + gap;
                left = rect.left - cardWidth + rect.width;
                break;
            default:
                top = rect.bottom + gap;
                left = rect.left;
        }

        // Keep card in viewport
        left = Math.max(16, Math.min(left, window.innerWidth - cardWidth - 16));
        top = Math.max(16, Math.min(top, window.innerHeight - cardHeight - 16));

        card.style.top = top + 'px';
        card.style.left = left + 'px';
    }

    // Render current step
    function renderStep() {
        const step = tourSteps[currentStep];
        const isFirst = currentStep === 0;
        const isLast = currentStep === tourSteps.length - 1;
        const total = tourSteps.length;

        card.textContent = '';
        card.setAttribute('aria-label', 'Hướng dẫn sử dụng — bước ' + (currentStep + 1) + '/' + total);

        const titleEl = el('h3', { className: 'tour-title' });
        const contentEl = el('p', { className: 'tour-text' });
        const progressPct = Math.round(((currentStep + 1) / total) * 100);
        const dots = tourSteps.map((_, i) =>
            el('span', { className: 'tour-dot' + (i === currentStep ? ' is-active' : '') })
        );

        card.appendChild(el('button', { id: 'tour-skip', type: 'button', className: 'tour-skip', text: 'Bỏ qua' }));
        card.appendChild(el('div', { className: 'tour-head' }, [
            el('div', { className: 'tour-badge', 'aria-hidden': 'true', text: step.icon }),
            el('span', { className: 'tour-step-chip', text: 'Bước ' + (currentStep + 1) + '/' + total }),
        ]));
        card.appendChild(titleEl);
        card.appendChild(contentEl);
        card.appendChild(el('div', { className: 'tour-progress', 'aria-hidden': 'true' }, [
            el('div', { className: 'tour-progress-fill', style: { width: progressPct + '%' } }),
        ]));
        card.appendChild(el('div', { className: 'tour-footer' }, [
            el('div', { className: 'tour-dots', 'aria-hidden': 'true' }, dots),
            el('div', { className: 'tour-actions' }, [
                !isFirst && el('button', { id: 'tour-prev', type: 'button', className: 'tour-btn tour-btn--ghost', text: '← Trước' }),
                el('button', { id: 'tour-next', type: 'button', className: 'tour-btn tour-btn--primary', text: isLast ? 'Bắt đầu ✓' : 'Tiếp →' }),
            ]),
        ]));
        titleEl.textContent = step.title;
        contentEl.textContent = step.content;

        positionStep();

        // Replay hiệu ứng vào của card cho mỗi bước
        card.classList.remove('tour-card--in');
        void card.offsetWidth;
        card.classList.add('tour-card--in');

        // Event handlers
        const nextBtn = card.querySelector('#tour-next');
        const prevBtn = card.querySelector('#tour-prev');
        const skipBtn = card.querySelector('#tour-skip');

        nextBtn.onclick = () => {
            if (isLast) {
                endTour();
            } else {
                currentStep++;
                renderStep();
            }
        };

        if (prevBtn) {
            prevBtn.onclick = () => {
                currentStep--;
                renderStep();
            };
        }

        skipBtn.onclick = endTour;
    }

    // End tour
    function endTour() {
        markTourComplete();
        removeTourUI();
    }

    // Start tour
    function startTour() {
        currentStep = 0;
        createTourUI();
        renderStep();
    }

    // Auto-start tour after app loads (if first time) - MUST wait for PIN unlock
    function checkAndStartTour() {
        // Wait for customer list to exist (app loaded)
        if (!document.querySelector('#customer-list')) {
            setTimeout(checkAndStartTour, 500);
            return;
        }

        // CRITICAL: Wait until user has unlocked the app
        // masterKey is set only after successful PIN entry
        if (typeof masterKey === 'undefined' || !masterKey) {
            // Not unlocked yet, keep checking
            setTimeout(checkAndStartTour, 1000);
            return;
        }

        // Also check if lock screen is visible
        const lockScreen = document.getElementById('screen-lock');
        const activationModal = document.getElementById('activation-modal');
        const setupModal = document.getElementById('setup-lock-modal');

        if (lockScreen && !lockScreen.classList.contains('hidden')) {
            setTimeout(checkAndStartTour, 1000);
            return;
        }
        if (activationModal && !activationModal.classList.contains('hidden')) {
            setTimeout(checkAndStartTour, 1000);
            return;
        }
        if (setupModal && !setupModal.classList.contains('hidden')) {
            setTimeout(checkAndStartTour, 1000);
            return;
        }

        // App is unlocked, check if tour should show
        setTimeout(() => {
            if (shouldShowTour()) {
                startTour();
            }
        }, 800);
    }

    // Initialize after DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            // Delay start to ensure security modules are loaded
            setTimeout(checkAndStartTour, 2000);
        });
    } else {
        setTimeout(checkAndStartTour, 2000);
    }
})();

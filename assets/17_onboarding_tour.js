// =======================
// ONBOARDING TOUR
// Tour hướng dẫn nhanh Dashboard cho người dùng LẦN ĐẦU + mở lại thủ công.
// UI classes (.tour-*) định nghĩa trong assets/styles.css — z-index contract:
// overlay 1000, spotlight 1001, card 1002.
//
// An toàn (xem CLAUDE.md · mục Tour / onboarding):
//   - Chỉ tự mở với user MỚI (khóa localStorage riêng), không ép user cũ xem lại.
//   - Không tạo/sửa dữ liệu, không đụng IndexedDB/crypto, không đổi z-index toàn
//     cục, không dùng innerHTML với dữ liệu động, không native alert/confirm.
//   - Bước thiếu selector -> BỎ QUA an toàn (không crash, không treo).
//   - Cleanup đầy đủ khi Skip / Finish / đóng / APP LOCK / đổi kích thước.
//   - Không đẩy history entry -> back/edge-back không để lại entry ma.
// =======================

(function () {
    const TOUR_KEY = 'clientpro_onboarding_done';
    // Giữ nguyên version để KHÔNG ép user đã hoàn tất phải xem lại sau cập nhật.
    const TOUR_VERSION = 4;

    // Cấu hình các bước. `target === null` => bước center (chào mừng / kết thúc /
    // nhắc mở lại). Bước có `target` mà không tìm thấy phần tử VISIBLE trên
    // Dashboard sẽ bị BỎ QUA (không spotlight phần tử ẩn).
    const tourSteps = [
        {
            target: null,
            icon: '👋',
            title: 'Chào mừng đến ClientPro!',
            content: 'Ứng dụng quản lý khách hàng và tài sản bảo đảm ngay trên điện thoại. Cùng xem nhanh các khu vực chính.',
            position: 'center'
        },
        {
            target: null,
            icon: '🔒',
            title: 'Dữ liệu nằm trên máy bạn',
            content: 'Toàn bộ dữ liệu lưu cục bộ và được mã hóa trên thiết bị. App chạy được cả khi không có mạng; chỉ kết nối Drive khi bạn chủ động sao lưu.',
            position: 'center'
        },
        {
            target: 'button[data-action="openCustomerList"][data-arg="approved"]',
            icon: '📊',
            title: 'Số liệu tổng quan',
            content: 'Dashboard hiển thị nhanh tổng khách hàng, tài sản bảo đảm và số hồ sơ theo trạng thái. Chạm vào một ô để mở đúng danh sách đó.',
            position: 'bottom'
        },
        {
            target: 'button[data-action="openCustomerList"][data-arg="pending"]',
            icon: '🔍',
            title: 'Danh sách & tìm kiếm',
            content: 'Mở danh sách khách hàng rồi dùng ô tìm kiếm ở đầu danh sách để tìm theo tên, SĐT hoặc CCCD.',
            position: 'bottom'
        },
        {
            target: '#btn-quick-add',
            icon: '➕',
            title: 'Thêm khách hàng',
            content: 'Tạo hồ sơ khách hàng mới. Trong hồ sơ, bạn thêm được tài sản bảo đảm, ảnh và ghi chú.',
            position: 'top'
        },
        {
            target: '#btn-quick-map',
            icon: '🗺️',
            title: 'Bản đồ & khoảng cách',
            content: 'Xem vị trí khách hàng trên bản đồ và tính khoảng cách tuyến đường tới tài sản.',
            position: 'top'
        },
        {
            target: '#btn-quick-pdf',
            icon: '📄',
            title: 'Bộ công cụ PDF',
            content: 'Ghép, tách, sắp xếp trang, chuyển ảnh↔PDF và nén PDF — xử lý hoàn toàn trên máy, không tải file lên đâu.',
            position: 'top'
        },
        {
            target: 'button[data-action="openBackupManager"]',
            icon: '💾',
            title: 'Sao lưu & khôi phục',
            content: 'Sao lưu dữ liệu ra file hoặc lên Drive, và khôi phục khi cần. Hãy sao lưu định kỳ.',
            position: 'top'
        },
        {
            target: 'button[data-action="toggleDashboardDriveConfig"]',
            icon: '☁️',
            title: 'Kết nối Google Drive',
            content: 'Cấu hình Drive cá nhân (tùy chọn) để lưu ảnh hồ sơ và bản backup của bạn.',
            position: 'top-left'
        },
        {
            target: '#btn-open-menu',
            icon: '⚙️',
            title: 'Cài đặt & giao diện',
            content: 'Đổi giao diện, thiết lập bảo mật PIN / sinh trắc học và các mục khác nằm trong Menu.',
            position: 'bottom-left'
        },
        {
            target: null,
            icon: '🎉',
            title: 'Sẵn sàng!',
            content: 'Bạn đã sẵn sàng dùng ClientPro. Muốn xem lại hướng dẫn này, vào Menu ⚙️ → “Xem lại hướng dẫn”.',
            position: 'center'
        }
    ];

    let currentStep = 0;
    let navDir = 1;               // hướng điều hướng để bỏ qua bước thiếu selector
    let active = false;           // tour đang hiển thị?
    let overlay = null;
    let card = null;
    let spotlight = null;
    let resizeHandler = null;
    let resizeTimer = null;
    let keyHandler = null;
    let lockObserver = null;

    // --- Trạng thái user mới / đã hoàn tất --------------------------------------
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

    function markTourComplete() {
        try {
            localStorage.setItem(TOUR_KEY, JSON.stringify({ version: TOUR_VERSION, completedAt: Date.now() }));
        } catch (e) { }
    }

    // --- Kích thước vùng nhìn thấy (ưu tiên visualViewport để tôn trọng thanh
    //     trình duyệt / safe-area trên di động) ------------------------------------
    function vw() { return (window.visualViewport && window.visualViewport.width) || window.innerWidth; }
    function vh() { return (window.visualViewport && window.visualViewport.height) || window.innerHeight; }

    // Trả về: null = bước center; false = target thiếu/ẩn (bỏ qua); phần tử = spotlight.
    function resolveTarget(step) {
        if (!step || !step.target) return null;
        const t = document.querySelector(step.target);
        if (!t) return false;
        const r = t.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || r.bottom <= 0 || r.top >= vh()) return false;
        return t;
    }

    // --- Dựng / gỡ UI -----------------------------------------------------------
    function createTourUI() {
        overlay = el('div', { id: 'tour-overlay', className: 'tour-overlay' });
        spotlight = el('div', { id: 'tour-spotlight', className: 'tour-spotlight', 'aria-hidden': 'true' });
        card = el('div', { id: 'tour-tooltip', className: 'tour-card', role: 'dialog', 'aria-modal': 'true' });

        document.body.appendChild(overlay);
        document.body.appendChild(spotlight);
        document.body.appendChild(card);

        resizeHandler = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => { if (overlay) positionStep(); }, 150);
        };
        window.addEventListener('resize', resizeHandler);
        if (window.visualViewport) window.visualViewport.addEventListener('resize', resizeHandler);

        // Escape = bỏ qua tour (giống nút Bỏ qua).
        keyHandler = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); endTour(); } };
        document.addEventListener('keydown', keyHandler);

        // Đóng tour khi app bị khóa (màn khóa hiện) — không đánh dấu hoàn tất,
        // không tự mở lại sau unlock.
        watchLock();

        requestAnimationFrame(() => { overlay && overlay.classList.add('is-visible'); });
    }

    function watchLock() {
        try {
            const lock = document.getElementById('screen-lock');
            if (!lock || typeof MutationObserver === 'undefined') return;
            lockObserver = new MutationObserver(() => {
                if (active && lock && !lock.classList.contains('hidden')) removeTourUI();
            });
            lockObserver.observe(lock, { attributes: true, attributeFilter: ['class'] });
        } catch (e) { }
    }

    // Gỡ toàn bộ UI + listener + observer + timer. Không đánh dấu hoàn tất.
    function removeTourUI() {
        active = false;
        if (resizeHandler) {
            window.removeEventListener('resize', resizeHandler);
            if (window.visualViewport) window.visualViewport.removeEventListener('resize', resizeHandler);
            clearTimeout(resizeTimer);
            resizeHandler = null;
        }
        if (keyHandler) {
            document.removeEventListener('keydown', keyHandler);
            keyHandler = null;
        }
        if (lockObserver) {
            try { lockObserver.disconnect(); } catch (e) { }
            lockObserver = null;
        }
        if (overlay) overlay.classList.remove('is-visible');
        if (spotlight) spotlight.classList.remove('is-on');
        if (card) card.style.opacity = '0';
        const o = overlay, s = spotlight, c = card;
        overlay = spotlight = card = null;
        setTimeout(() => {
            o && o.remove();
            s && s.remove();
            c && c.remove();
        }, 350);
    }

    // --- Định vị spotlight + card cho bước hiện tại ------------------------------
    function positionStep() {
        if (!overlay || !card || !spotlight) return;
        const step = tourSteps[currentStep];
        const target = resolveTarget(step);

        if (!target) {
            // Bước center (target === null) hoặc target thiếu -> card ở giữa.
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

        spotlight.style.top = (rect.top - padding) + 'px';
        spotlight.style.left = (rect.left - padding) + 'px';
        spotlight.style.width = (rect.width + padding * 2) + 'px';
        spotlight.style.height = (rect.height + padding * 2) + 'px';
        spotlight.classList.add('is-on');

        const cardWidth = card.offsetWidth || 300;
        const cardHeight = card.offsetHeight || 180;
        const gap = 14;
        let top, left;

        switch (step.position) {
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

        // Giữ card trong vùng nhìn thấy (margin 16px, tôn trọng safe-area).
        left = Math.max(16, Math.min(left, vw() - cardWidth - 16));
        top = Math.max(16, Math.min(top, vh() - cardHeight - 16));

        card.style.top = top + 'px';
        card.style.left = left + 'px';
    }

    // --- Render bước, tự bỏ qua bước thiếu selector theo hướng điều hướng --------
    function renderStep() {
        if (!card) return;
        let guard = 0;
        while (guard++ <= tourSteps.length) {
            const step = tourSteps[currentStep];
            if (resolveTarget(step) !== false) { paintStep(step); return; }
            // Bước có target nhưng thiếu/ẩn -> bỏ qua theo hướng điều hướng.
            const nextIdx = currentStep + navDir;
            if (nextIdx >= tourSteps.length) { endTour(); return; }
            if (nextIdx < 0) { currentStep = 0; navDir = 1; continue; }
            currentStep = nextIdx;
        }
        // Trường hợp cực đoan: không có bước nào hiển thị được -> đóng an toàn.
        endTour();
    }

    function paintStep(step) {
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

        // Replay hiệu ứng vào của card cho mỗi bước.
        card.classList.remove('tour-card--in');
        void card.offsetWidth;
        card.classList.add('tour-card--in');

        const nextBtn = card.querySelector('#tour-next');
        const prevBtn = card.querySelector('#tour-prev');
        const skipBtn = card.querySelector('#tour-skip');

        nextBtn.onclick = () => {
            navDir = 1;
            if (isLast) { endTour(); return; }
            currentStep++;
            renderStep();
        };
        if (prevBtn) {
            prevBtn.onclick = () => {
                navDir = -1;
                if (currentStep > 0) currentStep--;
                renderStep();
            };
        }
        skipBtn.onclick = endTour;
    }

    // Skip / Finish: đánh dấu hoàn tất rồi gỡ UI.
    function endTour() {
        markTourComplete();
        removeTourUI();
    }

    function startTour() {
        if (active) return;
        active = true;
        currentStep = 0;
        navDir = 1;
        createTourUI();
        renderStep();
    }

    // Mở lại thủ công từ Menu: đóng menu trước rồi bắt đầu, bất kể đã hoàn tất.
    function replayTour() {
        try { if (typeof _closeMenuIfOpen === 'function') _closeMenuIfOpen(); } catch (e) { }
        setTimeout(() => { startTour(); }, 260);
    }

    // Tự mở cho user mới sau khi app đã load & unlock (chờ PIN).
    function checkAndStartTour() {
        if (!document.querySelector('#customer-list')) {
            setTimeout(checkAndStartTour, 500);
            return;
        }
        // Chờ tới khi đã mở khóa (masterKey chỉ có sau khi nhập PIN đúng).
        if (typeof masterKey === 'undefined' || !masterKey) {
            setTimeout(checkAndStartTour, 1000);
            return;
        }
        const lockScreen = document.getElementById('screen-lock');
        const activationModal = document.getElementById('activation-modal');
        const setupModal = document.getElementById('setup-lock-modal');
        if (lockScreen && !lockScreen.classList.contains('hidden')) { setTimeout(checkAndStartTour, 1000); return; }
        if (activationModal && !activationModal.classList.contains('hidden')) { setTimeout(checkAndStartTour, 1000); return; }
        if (setupModal && !setupModal.classList.contains('hidden')) { setTimeout(checkAndStartTour, 1000); return; }

        setTimeout(() => { if (shouldShowTour()) startTour(); }, 800);
    }

    // Public API (mở lại thủ công qua data-action="OnboardingTour.replay").
    window.OnboardingTour = { start: startTour, replay: replayTour };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { setTimeout(checkAndStartTour, 2000); });
    } else {
        setTimeout(checkAndStartTour, 2000);
    }
})();

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
//   - Bước thiếu selector (KHÔNG tồn tại) hoặc ẩn (không có layout) -> BỎ QUA an
//     toàn. Bước có target THẬT nhưng nằm NGOÀI viewport (dưới fold trên máy thấp)
//     -> vẫn hiển thị nội dung bằng card ở giữa, KHÔNG bao giờ bỏ qua.
//   - Không tự mở khi màn khóa / kích hoạt / thiết lập đang hiện, hoặc chưa unlock.
//   - Singleton tuyệt đối: đúng một bộ #tour-overlay / #tour-spotlight /
//     #tour-tooltip khi active; 0 node + 0 timer + 0 observer khi cleanup xong.
//   - Cleanup đầy đủ khi Skip / Finish / đóng / APP LOCK / đổi kích thước.
//   - Không đẩy history entry -> back/edge-back không để lại entry ma.
// =======================

(function () {
    const TOUR_KEY = 'clientpro_onboarding_done';
    // Version của NỘI DUNG tour. Bump version KHÔNG ép user đã hoàn tất xem lại:
    // shouldShowTour() chỉ tự phát lại cho máy pre-release có marker bên dưới.
    const TOUR_VERSION = 5;
    // Marker pre-release đặt TAY (devtools) trên đúng máy/tài khoản kiểm thử nội bộ.
    // Chỉ những máy đó mới tự xem lại tour sau khi nội dung đổi.
    const TOUR_PRERELEASE_KEY = 'clientpro_onboarding_prerelease';
    const TOUR_PRERELEASE_ON = '1';

    // Cấu hình các bước. `target === null` => bước center (chào mừng / kết thúc /
    // nhắc mở lại). Bước có `target`:
    //   - selector KHÔNG tồn tại / element ẩn (không layout) -> BỎ QUA.
    //   - element THẬT nhưng ngoài viewport -> hiển thị card center (không spotlight).
    //   - element THẬT & trong viewport -> spotlight + card cạnh target.
    const tourSteps = [
        {
            target: null,
            icon: '👋',
            title: 'Chào mừng đến ClientPro',
            content: 'Quản lý khách hàng, tài sản bảo đảm và hồ sơ ngay trên điện thoại. Tour này chỉ giới thiệu giao diện, không tạo hay thay đổi dữ liệu.',
            position: 'center'
        },
        {
            target: null,
            icon: '🔐',
            title: 'Riêng tư, cục bộ và có mã hóa',
            content: 'Dữ liệu nghiệp vụ nằm trên thiết bị và được mã hóa khi lưu. Hãy nhớ PIN, bảo vệ mã nhân viên và duy trì bản sao lưu định kỳ.',
            position: 'center'
        },
        {
            target: 'button[data-action="refreshWeather"]',
            icon: '🌤️',
            title: 'Thời tiết trên Dashboard',
            content: 'Chạm vào thẻ thời tiết để cập nhật. ClientPro chỉ lưu nhiệt độ và trạng thái hiển thị, không lưu tọa độ GPS trong cache thời tiết.',
            position: 'bottom-left'
        },
        {
            target: 'button[data-action="openCustomerList"][data-arg="approved"]',
            icon: '📊',
            title: 'Tổng quan và danh sách khách hàng',
            content: 'Các ô tổng quan cho biết số khách hàng, tài sản và trạng thái hồ sơ. Chạm ô trạng thái để mở danh sách, tìm kiếm và sắp xếp.',
            position: 'bottom'
        },
        {
            target: '#btn-quick-add',
            icon: '➕',
            title: 'Tạo và quản lý hồ sơ',
            content: 'Thêm khách hàng tại đây. Trong hồ sơ có thông tin liên hệ, ghi chú, ảnh và tài sản bảo đảm; nhấn giữ thẻ khách hàng hoặc ảnh để chọn nhiều.',
            position: 'top'
        },
        {
            target: '#btn-quick-map',
            icon: '🗺️',
            title: 'Bản đồ và khoảng cách đường bộ',
            content: 'Xem vị trí tài sản trên MapLibre và tính quãng đường thực tế bằng OSRM. Kết quả được kiểm tra điểm bám để hạn chế khoảng cách bất hợp lý.',
            position: 'top'
        },
        {
            target: '#btn-quick-pdf',
            icon: '📄',
            title: 'Bộ công cụ PDF & ĐVHC',
            content: 'PDF Toolkit xử lý file ngay trên thiết bị; nút bên cạnh dùng để tra cứu đơn vị hành chính cũ và mới. Cả hai được nạp khi mở và dùng được offline sau khi đã cache.',
            position: 'top'
        },
        {
            target: 'button[data-action="openBackupManager"]',
            icon: '💾',
            title: 'Sao lưu & khôi phục',
            content: 'Tạo file backup mã hóa, lưu lên Drive hoặc khôi phục khi cần. Chỉ thực hiện khi app đang mở khóa và đã xác thực quyền với máy chủ.',
            position: 'top'
        },
        {
            target: 'button[data-action="toggleDashboardDriveConfig"]',
            icon: '☁️',
            title: 'Kết nối Google Drive',
            content: 'Nhập link Google Apps Script cá nhân và mã bảo mật để lưu ảnh, backup và dùng tự động sao lưu. Token được niêm phong bằng khóa của app.',
            position: 'top-left'
        },
        {
            target: '#btn-open-menu',
            icon: '⚙️',
            title: 'Giao diện và bảo mật',
            content: 'Menu cho phép đổi chủ đề, thiết lập PIN hoặc sinh trắc học, xem lại hướng dẫn và mở mục ủng hộ. Các thao tác backup/Drive chính nằm ngay trên Dashboard.',
            position: 'bottom-left'
        },
        {
            target: null,
            icon: '✅',
            title: 'Quy trình dùng an toàn',
            content: 'Bắt đầu bằng việc tạo khách hàng, bổ sung tài sản và ảnh, sau đó cấu hình Drive và tạo một bản backup thử. Có thể xem lại tour tại Menu → Xem lại hướng dẫn.',
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
    let replayTimer = null;       // timer chờ trước khi replay từ Menu
    let teardownTimer = null;     // timer xóa node sau fade-out (350ms)
    let autoStartTimer = null;    // một chuỗi retry duy nhất cho auto-tour của user mới

    // --- Trạng thái user mới / đã hoàn tất --------------------------------------
    /** Máy kiểm thử nội bộ (marker đặt tay) — chỉ nơi này mới tự xem lại tour mới. */
    function isPrereleaseTester() {
        try {
            return localStorage.getItem(TOUR_PRERELEASE_KEY) === TOUR_PRERELEASE_ON;
        } catch (e) {
            return false;
        }
    }

    /**
     * Chỉ tự mở tour cho user THẬT SỰ mới. User đã hoàn tất một version trước KHÔNG bị
     * ép xem lại khi nội dung tour đổi (bump TOUR_VERSION) — họ vẫn mở lại được thủ công
     * từ Menu. Riêng máy pre-release có marker thì tự phát lại để kiểm thử nội dung mới.
     */
    function shouldShowTour() {
        try {
            const done = localStorage.getItem(TOUR_KEY);
            if (!done) return true;
            const parsed = JSON.parse(done);
            // Record hỏng / thiếu version -> coi như chưa từng xem.
            if (!parsed || typeof parsed.version !== 'number') return true;
            if (parsed.version >= TOUR_VERSION) return false;
            return isPrereleaseTester();
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

    // --- Cổng an toàn: KHÔNG dựng tour khi app chưa mở khóa hoặc màn khóa / kích
    //     hoạt / thiết lập đang hiện. Dùng chung ở checkAndStartTour, replayTour và
    //     startTour để không nhân bản điều kiện. -----------------------------------
    function _screenVisible(id) {
        const n = document.getElementById(id);
        return !!(n && !n.classList.contains('hidden'));
    }

    function isTourBlocked() {
        // Chưa mở khóa (masterKey chỉ có sau khi nhập PIN đúng) -> chặn.
        try {
            if (typeof isAppUnlocked === 'function') {
                if (!isAppUnlocked()) return true;
            } else if (typeof masterKey === 'undefined' || !masterKey) {
                return true;
            }
        } catch (e) {
            return true;
        }
        // Bất kỳ màn chặn nào đang hiển thị -> chặn.
        return _screenVisible('screen-lock') ||
            _screenVisible('activation-modal') ||
            _screenVisible('setup-lock-modal');
    }

    // --- Phân loại trạng thái target của một bước --------------------------------
    // Trả về { kind, element }:
    //   center    : bước không có target (welcome / finish) -> card center.
    //   missing   : selector KHÔNG tìm thấy -> được phép bỏ qua.
    //   hidden    : element tồn tại nhưng không có layout / kích thước không hợp lệ
    //               (display:none, chưa render) -> được phép bỏ qua.
    //   offscreen : element THẬT, có layout hợp lệ nhưng nằm ngoài viewport
    //               -> KHÔNG bỏ qua; hiển thị card center (không spotlight tọa độ ảo).
    //   visible   : element THẬT & nằm trong viewport -> spotlight + card cạnh target.
    function resolveTarget(step) {
        if (!step || !step.target) return { kind: 'center', element: null };
        const t = document.querySelector(step.target);
        if (!t) return { kind: 'missing', element: null };
        const rects = t.getClientRects();
        const r = t.getBoundingClientRect();
        const hasLayout = rects.length > 0 && r.width >= 4 && r.height >= 4;
        if (!hasLayout) return { kind: 'hidden', element: null };
        const onScreen = r.bottom > 0 && r.top < vh() && r.right > 0 && r.left < vw();
        if (!onScreen) return { kind: 'offscreen', element: t };
        return { kind: 'visible', element: t };
    }

    // Bước có được BỎ QUA khi điều hướng không? Chỉ missing/hidden mới bỏ qua.
    function _isSkippable(state) {
        return state.kind === 'missing' || state.kind === 'hidden';
    }

    // --- Dựng / gỡ UI -----------------------------------------------------------
    // Xóa mọi node tour còn sót (kể cả của phiên đang fade-out) + hủy timer teardown
    // để KHÔNG tồn tại hai bộ node cùng ID. Đồng bộ, gọi ngay trước khi dựng mới.
    function purgeTourNodes() {
        if (teardownTimer) { clearTimeout(teardownTimer); teardownTimer = null; }
        const stale = document.querySelectorAll('#tour-overlay, #tour-spotlight, #tour-tooltip');
        stale.forEach((n) => { try { n.remove(); } catch (e) { } });
        overlay = spotlight = card = null;
    }

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
        // không tự mở lại sau unlock. Kiểm tra NGAY trạng thái hiện tại trước khi
        // chỉ dựa vào MutationObserver (observer chỉ bắt mutation về SAU).
        watchLock();

        requestAnimationFrame(() => { overlay && overlay.classList.add('is-visible'); });
    }

    function watchLock() {
        try {
            const lock = document.getElementById('screen-lock');
            // Màn khóa đã hiện sẵn -> hủy tour ngay, không chờ mutation.
            if (lock && !lock.classList.contains('hidden')) { removeTourUI(); return; }
            if (!lock || typeof MutationObserver === 'undefined') return;
            lockObserver = new MutationObserver(() => {
                if (active && lock && !lock.classList.contains('hidden')) removeTourUI();
            });
            lockObserver.observe(lock, { attributes: true, attributeFilter: ['class'] });
        } catch (e) { }
    }

    // Gỡ toàn bộ UI + listener + observer + timer. Idempotent (gọi nhiều lần an
    // toàn). Không đánh dấu hoàn tất. Timer teardown chỉ xóa ĐÚNG node đã capture
    // của phiên này -> không bao giờ xóa nhầm node của phiên tour mới.
    function removeTourUI() {
        active = false;
        if (resizeHandler) {
            window.removeEventListener('resize', resizeHandler);
            if (window.visualViewport) window.visualViewport.removeEventListener('resize', resizeHandler);
            clearTimeout(resizeTimer);
            resizeTimer = null;
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
        // Hủy replay đang chờ (nếu có) — không để tour tự dựng lại sau teardown.
        if (replayTimer) { clearTimeout(replayTimer); replayTimer = null; }

        const o = overlay, s = spotlight, c = card;
        overlay = spotlight = card = null;
        // Không còn node -> đã cleanup xong (idempotent): không đụng teardownTimer
        // đang giữ node THẬT của lần gọi trước.
        if (!o && !s && !c) return;

        if (o) o.classList.remove('is-visible');
        if (s) s.classList.remove('is-on');
        if (c) c.style.opacity = '0';
        const t = setTimeout(() => {
            o && o.remove();
            s && s.remove();
            c && c.remove();
            if (teardownTimer === t) teardownTimer = null;
        }, 350);
        teardownTimer = t;
    }

    // --- Định vị spotlight + card cho bước hiện tại ------------------------------
    // `state` (tùy chọn) là kết quả resolveTarget đã tính ở renderStep; khi thiếu
    // (vd. gọi từ resize) sẽ tính lại theo currentStep.
    function positionStep(state) {
        if (!overlay || !card || !spotlight) return;
        const step = tourSteps[currentStep];
        const st = state || resolveTarget(step);
        // Chỉ spotlight khi target THẬT & trong viewport. center/offscreen/(missing
        // trong tình huống race) -> card ở giữa, không spotlight tọa độ ngoài màn hình.
        const target = (st && st.kind === 'visible') ? st.element : null;

        if (!target) {
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

    // --- Render bước, tự bỏ qua bước thiếu/ẩn selector theo hướng điều hướng ------
    function renderStep() {
        if (!card) return;
        let guard = 0;
        while (guard++ <= tourSteps.length) {
            const step = tourSteps[currentStep];
            const state = resolveTarget(step);
            if (!_isSkippable(state)) { paintStep(step, state); return; }
            // Bước có target nhưng thiếu/ẩn -> bỏ qua theo hướng điều hướng.
            const nextIdx = currentStep + navDir;
            if (nextIdx >= tourSteps.length) { endTour(); return; }
            if (nextIdx < 0) { currentStep = 0; navDir = 1; continue; }
            currentStep = nextIdx;
        }
        // Trường hợp cực đoan: không có bước nào hiển thị được -> đóng an toàn.
        endTour();
    }

    function paintStep(step, state) {
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

        positionStep(state);

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

    // Dựng tour. Idempotent + phòng thủ:
    //   - Bị chặn (chưa unlock / màn khóa...) -> return false, không dựng.
    //   - Đang active & DOM còn hợp lệ -> no-op (không dựng thêm bộ node).
    //   - Còn node cũ (teardown chưa xong) -> purge đồng bộ trước khi dựng.
    function startTour() {
        if (isTourBlocked()) return false;
        // Manual start/replay thắng auto-start đang chờ; không để callback tự chạy lại.
        if (autoStartTimer) { clearTimeout(autoStartTimer); autoStartTimer = null; }
        if (active && overlay && document.body.contains(overlay)) return true;
        purgeTourNodes();          // xóa mọi node/tour cũ + hủy teardownTimer
        active = true;
        currentStep = 0;
        navDir = 1;
        createTourUI();
        renderStep();
        return true;
    }

    // Mở lại thủ công từ Menu: đóng menu trước rồi bắt đầu, bất kể đã hoàn tất.
    // Chống double-tap / gọi liên tiếp: chỉ giữ MỘT replayTimer. Kiểm tra bị chặn
    // cả lúc lên lịch VÀ lúc timer chạy (app có thể khóa trong khoảng chờ).
    function replayTour() {
        if (replayTimer) { clearTimeout(replayTimer); replayTimer = null; }
        try { if (typeof _closeMenuIfOpen === 'function') _closeMenuIfOpen(); } catch (e) { }
        if (isTourBlocked()) return;   // đã khóa/không sẵn sàng -> không queue mở sau unlock
        replayTimer = setTimeout(() => {
            replayTimer = null;
            if (isTourBlocked()) return;   // khóa xen vào trong lúc chờ -> hủy
            startTour();
        }, 260);
    }

    // Chỉ giữ một chuỗi kiểm tra auto-tour. Nếu app khóa đúng lúc delay 800ms chạy,
    // lịch kiểm tra được nối lại sau 1 giây thay vì mất vĩnh viễn đến lần reload.
    function scheduleAutoStartCheck(delay) {
        if (autoStartTimer) clearTimeout(autoStartTimer);
        autoStartTimer = setTimeout(() => {
            autoStartTimer = null;
            checkAndStartTour();
        }, delay);
    }

    // Tự mở cho user mới sau khi app đã load & unlock (chờ PIN).
    function checkAndStartTour() {
        // User đã hoàn tất trong lúc chờ (ví dụ manual replay + Skip) -> dừng hẳn.
        if (!shouldShowTour()) return;
        if (!document.querySelector('#customer-list')) {
            scheduleAutoStartCheck(500);
            return;
        }
        // Chưa mở khóa / còn màn chặn -> chờ tiếp.
        if (isTourBlocked()) {
            scheduleAutoStartCheck(1000);
            return;
        }
        autoStartTimer = setTimeout(() => {
            autoStartTimer = null;
            if (!shouldShowTour()) return;
            if (isTourBlocked()) {
                // App có thể auto-lock / chuyển nền trong cửa sổ 800ms. Tiếp tục
                // retry cho user mới, nhưng không tự mở lại một tour đã từng active.
                scheduleAutoStartCheck(1000);
                return;
            }
            startTour();
        }, 800);
    }

    // Public API (mở lại thủ công qua data-action="OnboardingTour.replay").
    window.OnboardingTour = { start: startTour, replay: replayTour };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { scheduleAutoStartCheck(2000); });
    } else {
        scheduleAutoStartCheck(2000);
    }
})();

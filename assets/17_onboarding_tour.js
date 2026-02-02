// =======================
// ONBOARDING TOUR
// Show interactive tour for first-time users
// =======================

(function () {
    const TOUR_KEY = 'clientpro_onboarding_done';
    const TOUR_VERSION = 1; // Increment to show tour again after major updates

    // Tour steps configuration
    const tourSteps = [
        {
            target: null, // Welcome screen - no target
            title: '👋 Chào mừng đến ClientPro!',
            content: 'Ứng dụng quản lý khách hàng chuyên nghiệp dành cho cán bộ tín dụng.',
            position: 'center'
        },
        {
            target: '#search-input',
            title: '🔍 Tìm kiếm nhanh',
            content: 'Gõ tên hoặc số điện thoại để tìm khách hàng ngay lập tức.',
            position: 'bottom'
        },
        {
            target: 'button[onclick="openModal()"]',
            title: '➕ Thêm khách hàng mới',
            content: 'Nhấn nút này để tạo hồ sơ khách hàng mới.',
            position: 'top-left'
        },
        {
            target: 'button[onclick="toggleMap()"]',
            title: '🗺️ Xem bản đồ',
            content: 'Xem vị trí tất cả khách hàng trên bản đồ.',
            position: 'top-left'
        },
        {
            target: 'button[onclick="toggleMenu()"]',
            title: '⚙️ Cài đặt',
            content: 'Đổi giao diện, sao lưu dữ liệu, kết nối Google Drive.',
            position: 'bottom-left'
        },
        {
            target: null,
            title: '🎉 Sẵn sàng!',
            content: 'Bạn đã sẵn sàng sử dụng ClientPro. Chúc bạn làm việc hiệu quả!',
            position: 'center'
        }
    ];

    let currentStep = 0;
    let overlay = null;
    let tooltip = null;
    let spotlight = null;

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
        // Overlay
        overlay = document.createElement('div');
        overlay.id = 'tour-overlay';
        overlay.className = 'fixed inset-0 z-[1000] transition-opacity duration-300';
        overlay.style.cssText = 'background: rgba(0,0,0,0.85); opacity: 0;';

        // Spotlight (hole in overlay)
        spotlight = document.createElement('div');
        spotlight.id = 'tour-spotlight';
        spotlight.style.cssText = `
            position: fixed;
            z-index: 1001;
            border-radius: 16px;
            box-shadow: 0 0 0 9999px rgba(0,0,0,0.85);
            transition: all 0.3s ease;
            pointer-events: none;
        `;

        // Tooltip
        tooltip = document.createElement('div');
        tooltip.id = 'tour-tooltip';
        tooltip.className = 'fixed z-[1002] glass-panel rounded-2xl p-5 shadow-2xl max-w-xs';
        tooltip.style.cssText = `
            opacity: 0;
            transform: scale(0.9);
            transition: all 0.3s ease;
        `;

        document.body.appendChild(overlay);
        document.body.appendChild(spotlight);
        document.body.appendChild(tooltip);

        // Fade in
        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
        });
    }

    // Remove tour UI
    function removeTourUI() {
        overlay.style.opacity = '0';
        tooltip.style.opacity = '0';
        setTimeout(() => {
            overlay && overlay.remove();
            spotlight && spotlight.remove();
            tooltip && tooltip.remove();
        }, 300);
    }

    // Position tooltip relative to target
    function positionTooltip(step) {
        const stepData = tourSteps[step];

        if (!stepData.target || stepData.position === 'center') {
            // Center on screen
            spotlight.style.cssText = 'display: none;';
            tooltip.style.cssText = `
                position: fixed;
                z-index: 1002;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%) scale(1);
                opacity: 1;
                transition: all 0.3s ease;
            `;
            return;
        }

        const target = document.querySelector(stepData.target);
        if (!target) {
            // Fallback to center if target not found
            positionTooltip({ ...stepData, target: null, position: 'center' });
            return;
        }

        const rect = target.getBoundingClientRect();
        const padding = 8;

        // Position spotlight around target
        spotlight.style.cssText = `
            position: fixed;
            z-index: 1001;
            top: ${rect.top - padding}px;
            left: ${rect.left - padding}px;
            width: ${rect.width + padding * 2}px;
            height: ${rect.height + padding * 2}px;
            border-radius: 16px;
            box-shadow: 0 0 0 9999px rgba(0,0,0,0.85);
            transition: all 0.3s ease;
            pointer-events: none;
        `;

        // Position tooltip
        let top, left;
        const tooltipWidth = 280;
        const tooltipHeight = 150;

        switch (stepData.position) {
            case 'bottom':
                top = rect.bottom + 16;
                left = rect.left + rect.width / 2 - tooltipWidth / 2;
                break;
            case 'top':
                top = rect.top - tooltipHeight - 16;
                left = rect.left + rect.width / 2 - tooltipWidth / 2;
                break;
            case 'top-left':
                top = rect.top - tooltipHeight - 16;
                left = rect.left - tooltipWidth + rect.width;
                break;
            case 'bottom-left':
                top = rect.bottom + 16;
                left = rect.left - tooltipWidth + rect.width;
                break;
            default:
                top = rect.bottom + 16;
                left = rect.left;
        }

        // Keep tooltip in viewport
        left = Math.max(16, Math.min(left, window.innerWidth - tooltipWidth - 16));
        top = Math.max(16, Math.min(top, window.innerHeight - tooltipHeight - 16));

        tooltip.style.cssText = `
            position: fixed;
            z-index: 1002;
            top: ${top}px;
            left: ${left}px;
            width: ${tooltipWidth}px;
            opacity: 1;
            transform: scale(1);
            transition: all 0.3s ease;
        `;
    }

    // Render current step
    function renderStep() {
        const step = tourSteps[currentStep];
        const isFirst = currentStep === 0;
        const isLast = currentStep === tourSteps.length - 1;

        tooltip.innerHTML = `
            <h3 class="font-bold text-lg mb-2 text-white">${step.title}</h3>
            <p class="text-sm text-slate-300 mb-4">${step.content}</p>
            <div class="flex items-center justify-between">
                <div class="flex gap-1">
                    ${tourSteps.map((_, i) => `
                        <div class="w-2 h-2 rounded-full transition-colors ${i === currentStep ? 'bg-blue-400' : 'bg-white/20'}"></div>
                    `).join('')}
                </div>
                <div class="flex gap-2">
                    ${!isFirst ? `
                        <button id="tour-prev" class="px-3 py-1.5 text-xs font-bold text-slate-400 hover:text-white transition">
                            ← Trước
                        </button>
                    ` : `
                        <button id="tour-skip" class="px-3 py-1.5 text-xs font-bold text-slate-400 hover:text-white transition">
                            Bỏ qua
                        </button>
                    `}
                    <button id="tour-next" class="px-4 py-1.5 text-xs font-bold text-white rounded-lg transition active:scale-95" style="background: var(--accent-gradient);">
                        ${isLast ? 'Bắt đầu!' : 'Tiếp →'}
                    </button>
                </div>
            </div>
        `;

        positionTooltip(currentStep);

        // Event handlers
        const nextBtn = tooltip.querySelector('#tour-next');
        const prevBtn = tooltip.querySelector('#tour-prev');
        const skipBtn = tooltip.querySelector('#tour-skip');

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

        if (skipBtn) {
            skipBtn.onclick = endTour;
        }
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

    // Public API
    window.OnboardingTour = {
        start: startTour,
        reset: () => {
            localStorage.removeItem(TOUR_KEY);
            console.log('✅ Onboarding tour reset. Refresh to see tour again.');
        }
    };

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

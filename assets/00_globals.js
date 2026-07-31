        function getEl(id) { return document.getElementById(id); }
        // Debounce helper to avoid heavy work on every keystroke / rapid events.
        // Hàm trả về có .cancel() để hủy lần gọi đang chờ (vd: reset ô tìm kiếm).
        function debounce(fn, wait = 150) {
          let t;
          function debounced(...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), wait);
          }
          debounced.cancel = () => { clearTimeout(t); t = undefined; };
          return debounced;
        }

        // =======================
        // GLOBAL RESTORE MUTEX
        // Mọi luồng restore (file .cpb, app backup nội bộ, Drive, inbox cloud) đều
        // funnel qua _restoreFromEncryptedContent -> BackupCore.restoreAllTransactional.
        // Mutex dùng chung này ngăn HAI nguồn restore chạy đồng thời (last-writer-wins
        // / trộn dữ liệu). Cờ per-source (__restoreInFlight/__acceptRestoreInFlight)
        // vẫn giữ để chống double-tap trong cùng một nguồn.
        // =======================
        window.__globalRestoreInFlight = false;
        window.acquireGlobalRestore = function () {
          if (window.__globalRestoreInFlight) return false;
          window.__globalRestoreInFlight = true;
          return true;
        };
        window.releaseGlobalRestore = function () {
          window.__globalRestoreInFlight = false;
        };

        // =======================
        // DISPLAY / CIPHERTEXT GUARDS (v1.5.8)
        // decryptText() fail-open: cache-miss với "cpg1:" trả nguyên ciphertext.
        // Mọi chỗ textContent / .value / img.src PHẢI qua helper này — không hard-code
        // tiền tố cục bộ. Nguồn duy nhất cho nhận diện ciphertext (cả legacy + GCM).
        // =======================
        function _looksEncrypted(v) {
          return (typeof v === 'string') && (v.startsWith('U2FsdGVk') || v.startsWith('cpg1:'));
        }
        /** Đồng bộ: decryptText + chặn ciphertext. Trả fallback nếu chưa giải mã được. */
        function _displayPlain(v, fallback) {
          const fb = (fallback === undefined) ? '' : fallback;
          if (v == null || v === '') return fb;
          let s = String(v);
          if (typeof decryptText === 'function') {
            try {
              const out = decryptText(s);
              if (out != null && out !== '') s = String(out);
            } catch (e) { /* keep s */ }
          }
          if (_looksEncrypted(s) || s === 'undefined' || s === 'null') return fb;
          return s;
        }
        /** Async: chờ decryptFieldAsync rồi chặn ciphertext. */
        async function _displayPlainAsync(v, fallback) {
          const fb = (fallback === undefined) ? '' : fallback;
          if (v == null || v === '') return fb;
          let s = String(v);
          try {
            if (typeof decryptFieldAsync === 'function') s = String(await decryptFieldAsync(s) || '');
            else if (typeof decryptText === 'function') s = String(decryptText(s) || '');
          } catch (e) { return fb; }
          if (_looksEncrypted(s) || s === 'undefined' || s === 'null') return fb;
          return s;
        }
        const DB_NAME='QLKH_Pro_V4'; let db;
        const PIN_KEY = 'app_pin'; const SEC_KEY = 'app_sec_qa'; const THEME_KEY = 'app_theme';
        // Thêm các key cho kích hoạt thiết bị & mã nhân viên
        const ACTIVATED_KEY = 'app_activated';
        const EMPLOYEE_KEY  = 'app_employee_id';
        let currentPin = '';
        let currentLightboxIndex = 0;
        let currentLightboxList = [];

        // =======================
        // SHARED PURE HELPERS
        // Nguồn duy nhất — thay cho các bản sao từng nằm rải rác ở 09/14/16.
        // =======================
        function getEmployeeId() {
          // Sau unlock, mã NV nằm trong RAM (__employeeIdPlain, 02_security.js);
          // plaintext localStorage chỉ còn ở cửa sổ kích hoạt → tạo PIN / máy legacy.
          try {
            if (typeof __employeeIdPlain !== 'undefined' && __employeeIdPlain) {
              return String(__employeeIdPlain).trim();
            }
          } catch (e) {}
          return (localStorage.getItem(typeof EMPLOYEE_KEY !== 'undefined' ? EMPLOYEE_KEY : 'app_employee_id') || '').trim();
        }

        function getDeviceIdSafe() {
          try {
            return (typeof getDeviceId === 'function') ? getDeviceId() : (localStorage.getItem('app_device_unique_id') || '');
          } catch (e) {
            return localStorage.getItem('app_device_unique_id') || '';
          }
        }

        function formatDateTime(ts) {
          const d = new Date(ts);
          const dd = String(d.getDate()).padStart(2, "0");
          const mm = String(d.getMonth() + 1).padStart(2, "0");
          const yy = d.getFullYear();
          const hh = String(d.getHours()).padStart(2, "0");
          const mi = String(d.getMinutes()).padStart(2, "0");
          return `${dd}/${mm}/${yy} ${hh}:${mi}`;
        }

        function formatBytes(bytes) {
          if (!bytes && bytes !== 0) return "-";
          const units = ["B", "KB", "MB", "GB"];
          let v = bytes;
          let i = 0;
          while (v >= 1024 && i < units.length - 1) {
            v /= 1024;
            i += 1;
          }
          return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
        }

        // =======================
        // LAZY MODULES (PDF Toolkit / Tra cứu ĐVHC)
        // Hai tool phụ (~158 KB JS + 20 KB CSS) KHÔNG nạp lúc boot; ensure()
        // inject đúng thứ tự khi người dùng mở lần đầu (mẫu ensureMapLibreLoaded,
        // 03_map.js). URL kèm ?v=LAZY_MODULES_V (01_config.js — CI check-policy +
        // tests/pwa.test.js giữ = ASSET_V) nên request rơi trúng precache của
        // Service Worker: offline vẫn mở được tool.
        // =======================
        const LAZY_MODULE_DEFS = {
          pdf: {
            ready: () => !!(window.PdfToolkit && window.PdfToolkit.open),
            css: ['./assets/css/pdf-toolkit.css'],
            scripts: [
              './assets/pdf-toolkit/pdf_toolkit_utils.js',
              './assets/pdf-toolkit/pdf_toolkit_core.js',
              './assets/pdf-toolkit/pdf_toolkit_merge.js',
              './assets/pdf-toolkit/pdf_toolkit_pages.js',
              './assets/pdf-toolkit/pdf_toolkit_images.js',
              './assets/pdf-toolkit/pdf_toolkit_pdf2img.js',
              './assets/pdf-toolkit/pdf_toolkit_compress.js',
              './assets/pdf-toolkit/pdf_toolkit_ui.js',
            ],
          },
          dvhc: {
            ready: () => !!(window.DvhcLookup && window.DvhcLookup.open),
            css: ['./assets/css/dvhc-lookup.css'],
            scripts: [
              './assets/dvhc-lookup/dvhc_utils.js',
              './assets/dvhc-lookup/dvhc_data.js',
              './assets/dvhc-lookup/dvhc_ui.js',
            ],
          },
        };
        const __lazyModulePromises = {};

        function __lazyInjectCss(href) {
          return new Promise((resolve) => {
            if (document.querySelector(`link[href="${href}"]`)) return resolve(true);
            const l = document.createElement('link');
            l.rel = 'stylesheet';
            l.href = href;
            l.onload = () => resolve(true);
            l.onerror = () => resolve(false);
            document.head.appendChild(l);
            // CSS load event không đáng tin 100% cross-browser -> resolve nhanh.
            setTimeout(() => resolve(true), 250);
          });
        }

        function __lazyInjectScript(src, timeoutMs) {
          return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[src="${src}"]`);
            if (existing && existing.getAttribute('data-loaded') === '1') return resolve(true);
            const s = existing || document.createElement('script');
            if (!existing) { s.src = src; document.body.appendChild(s); }
            let done = false;
            const to = setTimeout(() => {
              if (done) return; done = true;
              reject(new Error(`Lazy module script timeout: ${src}`));
            }, timeoutMs || 15000);
            s.onload = () => {
              if (done) return; done = true;
              clearTimeout(to);
              s.setAttribute('data-loaded', '1');
              resolve(true);
            };
            s.onerror = () => {
              if (done) return; done = true;
              clearTimeout(to);
              reject(new Error(`Lazy module script load failed: ${src}`));
            };
          });
        }

        window.LazyModules = {
          /** Nạp module 'pdf' | 'dvhc' đúng một lần. Trả true khi sẵn sàng. */
          async ensure(name) {
            const def = LAZY_MODULE_DEFS[name];
            if (!def) return false;
            if (def.ready()) return true;
            if (__lazyModulePromises[name]) return __lazyModulePromises[name];
            __lazyModulePromises[name] = (async () => {
              const v = (typeof LAZY_MODULES_V !== 'undefined' && LAZY_MODULES_V) ? LAZY_MODULES_V : '';
              const vq = v ? `?v=${v}` : '';
              // Script inject động không có document.currentScript.src đáng tin —
              // truyền version tường minh cho assetVersion() của các module.
              window.__CLIENTPRO_LAZY_V = v;
              for (const href of def.css) await __lazyInjectCss(href + vq);
              // Tuần tự để giữ đúng thứ tự phụ thuộc (utils -> core -> ... -> ui).
              for (const src of def.scripts) await __lazyInjectScript(src + vq);
              if (!def.ready()) throw new Error(`Lazy module ${name} not ready after load`);
              return true;
            })();
            return __lazyModulePromises[name].catch((err) => {
              __lazyModulePromises[name] = null;
              try {
                ErrorHandler.showError('NETWORK', 'Không tải được công cụ. Vui lòng kiểm tra mạng và thử lại.', err);
              } catch (e) {}
              return false;
            });
          },
        };

        // Mở tool sau khi ensure xong + spinner trên nút quick action trong lúc tải.
        async function __openLazyModule(name, btnId, open) {
          const btn = document.getElementById(btnId);
          const needLoad = !LAZY_MODULE_DEFS[name].ready();
          if (needLoad && btn && window.LoadingManager) {
            try { LoadingManager.showButtonLoading(btn); } catch (e) {}
          }
          try {
            if (await window.LazyModules.ensure(name)) open();
          } finally {
            if (needLoad && btn && window.LoadingManager) {
              try { LoadingManager.hideButtonLoading(btn); } catch (e) {}
            }
          }
        }

        // =======================
        // UI PERF HELPERS
        // =======================
        // Standard slide transition for app screens is defined by the CSS rule
        // `.app-container.transition-transform` + `--screen-slide-ms` (assets/styles.css).
        // UI_SLIDE_MS mirrors that duration — keep both in sync when changing it.
        // Avoid doing heavy work (IndexedDB getAll, decrypt, DOM render) during the animation
        // to prevent jank and visual "flash" of stale screen content.
        const UI_SLIDE_MS = 240;

        function nextFrame(fn) {
          try { requestAnimationFrame(() => requestAnimationFrame(fn)); }
          catch (e) { setTimeout(fn, 0); }
        }

        // Security gates own background isolation while open (ModalA11y in 04_ui_common.js).
        // Keep the id set here in sync with that helper's SECURITY_GATE_IDS.
        const SCREEN_A11Y_GATE_IDS = [
          'screen-lock', 'activation-modal', 'setup-lock-modal',
          'forgot-pin-modal', 'biometric-setup-modal',
        ];

        // Off-screen / covered slide screens must leave the accessibility tree. Screens
        // are shown or hidden purely by the slide transform (translate-x-full) — never
        // display:none (see the Screen slide contract) — so a screen-reader and DOM
        // locators would otherwise see every screen's controls at once. inert +
        // aria-hidden isolate all but the topmost on-screen .app-container. The top
        // screen is the on-screen container with the highest stacking (z-index, then
        // DOM order); it stays interactive, everything else is inert.
        function syncScreenA11y() {
          try {
            // While a security gate is open, ModalA11y owns inert/aria-hidden isolation;
            // do not fight it (it records and later restores each sibling's prior state).
            for (const id of SCREEN_A11Y_GATE_IDS) {
              const g = document.getElementById(id);
              if (g && !g.classList.contains('hidden')) return;
            }
            const screens = document.querySelectorAll('.app-container');
            if (!screens.length) return;
            let top = null;
            let topScore = -Infinity;
            screens.forEach((s, i) => {
              if (s.classList.contains('translate-x-full')) return; // off-screen
              let z = 0;
              try { z = parseInt(getComputedStyle(s).zIndex, 10); } catch (e) {}
              if (!Number.isFinite(z)) z = 0;
              const score = z * 100000 + i; // z-index first, DOM order as tiebreak
              if (score >= topScore) { topScore = score; top = s; }
            });
            if (!top) return; // dashboard is never translate-x-full, so this is defensive
            screens.forEach((s) => {
              const active = s === top;
              try { s.inert = !active; } catch (e) {}
              s.setAttribute('aria-hidden', active ? 'false' : 'true');
            });
          } catch (e) {}
        }

        function slideScreenIn(el) {
          if (!el) return;
          el.classList.add('is-sliding');
          nextFrame(() => {
            el.classList.remove('translate-x-full');
            syncScreenA11y();
            afterTransition(el, () => { el.classList.remove('is-sliding'); syncScreenA11y(); });
          });
        }

        function slideScreenOut(el, cb) {
          if (!el) {
            if (typeof cb === 'function') cb();
            return;
          }
          const screenId = el.id || '';
          el.classList.add('is-sliding');
          el.classList.add('translate-x-full');
          // Take the closing screen out of the a11y tree immediately, but DO NOT run the
          // full topmost sweep yet: that would un-inert the screen underneath while the old
          // one is still sliding, letting a fast tap open a new profile whose state the
          // close callback then nulls. The background stays inert for the whole animation;
          // the real topmost screen is re-activated only in afterTransition, after cb + the
          // scrub have run.
          try { el.inert = true; el.setAttribute('aria-hidden', 'true'); } catch (e) {}
          afterTransition(el, () => {
            el.classList.remove('is-sliding');
            if (typeof cb === 'function') cb();
            // One lifecycle event when a screen has finished sliding off-screen, so an
            // owning module can scrub its rendered content (e.g. clearing a closed
            // customer profile's DOM). Fires after the transition — same timing as cb.
            try { document.dispatchEvent(new CustomEvent('clientpro:screen-slid-out', { detail: { id: screenId } })); } catch (e) {}
            // Re-activate the real topmost screen only now — the background becomes
            // interactive after the close has fully settled, never mid-animation.
            syncScreenA11y();
          });
        }

        // Set the initial isolation once the dashboard is revealed, and again whenever a
        // security gate closes on an unlocked session (ModalA11y restores the gate's own
        // isolation; this reasserts the topmost-screen state for the slide layer).
        // clientpro:unlocked is dispatched by completeUnlockDataLoad *before* validatePin
        // hides #screen-lock, so a synchronous sync here would still see the lock gate and
        // bail. Defer it one turn so the off-screen static screens are isolated once the
        // gate is truly gone. security-gate-hidden already fires after the modal is hidden.
        function deferScreenA11y() {
          try { setTimeout(syncScreenA11y, 0); } catch (e) { syncScreenA11y(); }
        }
        try {
          document.addEventListener('clientpro:unlocked', deferScreenA11y);
          document.addEventListener('clientpro:security-gate-hidden', syncScreenA11y);
        } catch (e) {}

        function afterTransition(el, cb, ms = UI_SLIDE_MS) {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            try { el && el.removeEventListener('transitionend', onEnd); } catch (e) {}
            try { cb && cb(); } catch (e) {}
          };
          const onEnd = (ev) => {
            if (el && ev && ev.target !== el) return;
            finish();
          };
          try { el && el.addEventListener('transitionend', onEnd, { once: true }); } catch (e) {}
          setTimeout(finish, (ms || 0) + 60);
        }

        // =======================
        // GLOBAL data-action DELEGATION
        // Thay thế cho onclick="..."/onchange="..." inline (yêu cầu để bỏ 'unsafe-inline'
        // khỏi script-src trong CSP). Quy ước:
        //   - Phần tử tĩnh: data-action="tenHam" [data-arg="thamSoChuoi"]
        //   - Namespace: data-action="DriveBackup.performNow"
        //   - onchange trên <input type=file>: handler nhận chính input (tương đương `this` cũ)
        // Không dùng window[name]() generic để tránh gọi nhầm hàm ngoài ý muốn — khai báo
        // tường minh từng action trong 2 bảng dưới đây.
        // =======================
        (function () {
          async function withModal(id, fn) {
            try {
              if (window.ModalLoader && typeof window.ModalLoader.ensure === 'function') {
                await window.ModalLoader.ensure(id);
              }
            } catch (e) { }
            return fn();
          }

          const CLICK_ACTIONS = {
            // --- 0 tham số ---
            toggleMenu: () => toggleMenu(),
            toggleMap: () => toggleMap(),
            openModal: () => withModal('add-modal', () => openModal()),
            closeBackupManager: () => closeBackupManager(),
            uploadToGoogleDrive: () => uploadToGoogleDrive(),
            uploadAssetToDrive: () => uploadAssetToDrive(),
            toggleSelectionMode: () => toggleSelectionMode(),
            toggleDashboardDriveConfig: () => toggleDashboardDriveConfig(),
            toggleCustomerStatus: () => withModal('approve-modal', () => toggleCustomerStatus()),
            toggleCustSelectionMode: () => toggleCustSelectionMode(),
            shareSelectedImages: () => shareSelectedImages(),
            shareOpenedImage: () => shareOpenedImage(),
            sendSelectedCustomersToUser: () => sendSelectedCustomersToUser(),
            saveSecuritySetup: () => saveSecuritySetup(),
            saveScriptUrl: () => saveScriptUrl(),
            saveCustomerNotes: () => saveCustomerNotes(),
            enterNotesEditMode: () => enterNotesEditMode(),
            saveCustomer: () => saveCustomer(),
            saveAsset: () => saveAsset(),
            refreshWeather: () => refreshWeather(),
            openSecuritySetup: () => withModal('setup-lock-modal', () => openSecuritySetup()),
            openGuideModal: () => withModal('guide-modal', () => openGuideModal()),
            openEditCustomerModal: () => withModal('add-modal', () => openEditCustomerModal()),
            openDonateModal: () => withModal('donate-modal', () => openDonateModal()),
            openBackupManager: () => withModal('backup-manager-modal', () => openBackupManager()),
            openAssetModal: () => withModal('asset-modal', () => openAssetModal()),
            locateMe: () => locateMe(),
            getCurrentGPS: () => getCurrentGPS(),
            forgotPin: () => withModal('forgot-pin-modal', () => forgotPin()),
            deleteSelectedImages: () => deleteSelectedImages(),
            deleteSelectedCustomers: () => deleteSelectedCustomers(),
            deleteOpenedImage: () => deleteOpenedImage(),
            deleteCurrentCustomer: () => deleteCurrentCustomer(),
            createBackupFileNow: () => createBackupFileNow(),
            copyDonateAccount: () => copyDonateAccount(),
            confirmApproval: () => confirmApproval(),
            closeSetupModal: () => closeSetupModal(),
            closeRefModal: () => closeRefModal(),
            closeModal: () => closeModal(),
            closeLightbox: () => closeLightbox(),
            closeGuideModal: () => closeGuideModal(),
            closeForgotModal: () => closeForgotModal(),
            closeFolder: () => closeFolder(),
            closeDonateModal: () => closeDonateModal(),
            closeCustomerList: () => closeCustomerList(),
            closeCamera: () => closeCamera(),
            closeAssetModal: () => closeAssetModal(),
            closeAssetGallery: () => closeAssetGallery(),
            closeApproveModal: () => closeApproveModal(),
            backspacePin: () => backspacePin(),
            checkRecovery: () => checkRecovery(),
            capturePhoto: () => capturePhoto(),
            toggleCameraScanMode: () => toggleCameraScanMode(),
            activateApp: () => activateApp(),
            reconnectDriveFolder: () => reconnectDriveFolder(),
            reconnectAssetDriveFolder: () => reconnectAssetDriveFolder(),

            // --- 1 tham số literal, lấy từ data-arg ---
            setTheme: (el) => setTheme(el.dataset.arg),
            openCustomerList: (el) => openCustomerList(el.dataset.arg),
            // <select> sort danh sách KH: giá trị lấy từ .value; click thuần (mở dropdown)
            // cũng dispatch tới đây nhưng setCustomerSort no-op khi giá trị không đổi.
            setCustomerSort: (el) => setCustomerSort(el.value),
            switchTab: (el) => switchTab(el.dataset.arg),
            tryOpenCamera: (el) => tryOpenCamera(el.dataset.arg),
            enterPin: (el) => enterPin(Number(el.dataset.arg)),
            navigateLightbox: (el) => navigateLightbox(Number(el.dataset.arg)),

            // --- namespace ---
            'DriveBackup.performNow': () => DriveBackup.performNow(),
            'CloudTransferUI.showTab': (el) => CloudTransferUI.showTab(el.dataset.arg),
            'BiometricUnlock.openSetup': () => withModal('biometric-setup-modal', () => BiometricUnlock.openSetup()),
            'BiometricUnlock.closeSetup': () => BiometricUnlock.closeSetup(),
            'BiometricUnlock.confirmEnable': () => BiometricUnlock.confirmEnable(),
            'BiometricUnlock.requestDisable': () => BiometricUnlock.requestDisable(),
            'BiometricUnlock.tryUnlock': () => BiometricUnlock.tryUnlock(),

            // PDF Toolkit — điểm mở duy nhất từ Dashboard (module độc lập,
            // LAZY-LOAD khi mở lần đầu — xem LazyModules phía trên).
            'PdfToolkit.open': () => __openLazyModule('pdf', 'btn-quick-pdf', () => window.PdfToolkit.open()),

            // Tra cứu sáp nhập ĐVHC — điểm mở duy nhất từ lưới Thao tác nhanh trên
            // Dashboard (module độc lập, LAZY-LOAD khi mở lần đầu).
            'DvhcLookup.open': () => __openLazyModule('dvhc', 'btn-quick-dvhc', () => window.DvhcLookup.open()),

            // Onboarding — mở lại tour hướng dẫn thủ công từ Menu.
            'OnboardingTour.replay': () => { if (window.OnboardingTour) window.OnboardingTour.replay(); },
          };

          const CHANGE_ACTIONS = {
            handleFileUpload: (el) => handleFileUpload(el, el.dataset.arg),
            restoreData: (el) => restoreData(el),
            setCustomerSort: (el) => setCustomerSort(el.value),
          };

          function dispatch(map, ev) {
            const target = ev.target.closest && ev.target.closest('[data-action]');
            if (!target) return;
            const name = target.dataset.action;
            const handler = map[name];
            if (!handler) {
              console.warn('[data-action] Không tìm thấy handler cho:', name, target);
              return;
            }
            try { handler(target, ev); }
            catch (e) {
              if (window.ErrorHandler) {
                ErrorHandler.logError('[data-action] Lỗi khi chạy ' + name, e);
                ErrorHandler.showError('UNKNOWN', undefined, e);
              } else { console.error('[data-action] Lỗi khi chạy', name, e); }
            }
          }

          document.addEventListener('click', (ev) => dispatch(CLICK_ACTIONS, ev));
          document.addEventListener('change', (ev) => dispatch(CHANGE_ACTIONS, ev));
        })();

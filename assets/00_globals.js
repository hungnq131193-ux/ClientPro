        function getEl(id) { return document.getElementById(id); }
        // Debounce helper to avoid heavy work on every keystroke / rapid events
        function debounce(fn, wait = 150) {
          let t;
          return function debounced(...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), wait);
          };
        }

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
        // UI PERF HELPERS
        // =======================
        // Standard slide transition in this app uses: transition-transform duration-300
        // Avoid doing heavy work (IndexedDB getAll, decrypt, DOM render) during the animation
        // to prevent jank and visual "flash" of stale screen content.
        const UI_SLIDE_MS = 300;

        function nextFrame(fn) {
          try { requestAnimationFrame(() => requestAnimationFrame(fn)); }
          catch (e) { setTimeout(fn, 0); }
        }

        function slideScreenIn(el) {
          if (!el) return;
          el.classList.add('is-sliding');
          nextFrame(() => {
            el.classList.remove('translate-x-full');
            afterTransition(el, () => el.classList.remove('is-sliding'));
          });
        }

        function slideScreenOut(el, cb) {
          if (!el) {
            if (typeof cb === 'function') cb();
            return;
          }
          el.classList.add('is-sliding');
          el.classList.add('translate-x-full');
          afterTransition(el, () => {
            el.classList.remove('is-sliding');
            if (typeof cb === 'function') cb();
          });
        }

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
          const CLICK_ACTIONS = {
            // --- 0 tham số ---
            toggleMenu: () => toggleMenu(),
            toggleMap: () => toggleMap(),
            openModal: () => openModal(),
            closeBackupManager: () => closeBackupManager(),
            uploadToGoogleDrive: () => uploadToGoogleDrive(),
            uploadAssetToDrive: () => uploadAssetToDrive(),
            toggleSelectionMode: () => toggleSelectionMode(),
            toggleDashboardDriveConfig: () => toggleDashboardDriveConfig(),
            toggleCustomerStatus: () => toggleCustomerStatus(),
            toggleCustSelectionMode: () => toggleCustSelectionMode(),
            shareSelectedImages: () => shareSelectedImages(),
            shareOpenedImage: () => shareOpenedImage(),
            sendSelectedCustomersToUser: () => sendSelectedCustomersToUser(),
            saveSecuritySetup: () => saveSecuritySetup(),
            saveScriptUrl: () => saveScriptUrl(),
            saveCustomerNotes: () => saveCustomerNotes(),
            saveCustomer: () => saveCustomer(),
            saveAsset: () => saveAsset(),
            refreshWeather: () => refreshWeather(),
            openSecuritySetup: () => openSecuritySetup(),
            openGuideModal: () => openGuideModal(),
            openEditCustomerModal: () => openEditCustomerModal(),
            openDonateModal: () => openDonateModal(),
            openBackupManager: () => openBackupManager(),
            openAssetModal: () => openAssetModal(),
            locateMe: () => locateMe(),
            getCurrentGPS: () => getCurrentGPS(),
            forgotPin: () => forgotPin(),
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
            clearPin: () => clearPin(),
            checkRecovery: () => checkRecovery(),
            capturePhoto: () => capturePhoto(),
            activateApp: () => activateApp(),
            reconnectDriveFolder: () => reconnectDriveFolder(),
            reconnectAssetDriveFolder: () => reconnectAssetDriveFolder(),

            // --- 1 tham số literal, lấy từ data-arg ---
            setTheme: (el) => setTheme(el.dataset.arg),
            openCustomerList: (el) => openCustomerList(el.dataset.arg),
            switchTab: (el) => switchTab(el.dataset.arg),
            tryOpenCamera: (el) => tryOpenCamera(el.dataset.arg),
            enterPin: (el) => enterPin(Number(el.dataset.arg)),
            navigateLightbox: (el) => navigateLightbox(Number(el.dataset.arg)),

            // --- namespace ---
            'DriveBackup.performNow': () => DriveBackup.performNow(),
            'CloudTransferUI.showTab': (el) => CloudTransferUI.showTab(el.dataset.arg),
            'BiometricUnlock.openSetup': () => BiometricUnlock.openSetup(),
            'BiometricUnlock.closeSetup': () => BiometricUnlock.closeSetup(),
            'BiometricUnlock.confirmEnable': () => BiometricUnlock.confirmEnable(),
            'BiometricUnlock.requestDisable': () => BiometricUnlock.requestDisable(),
            'BiometricUnlock.tryUnlock': () => BiometricUnlock.tryUnlock(),
          };

          const CHANGE_ACTIONS = {
            handleFileUpload: (el) => handleFileUpload(el, el.dataset.arg),
            restoreData: (el) => restoreData(el),
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

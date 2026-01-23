/**
 * 16_auto_backup_drive.js
 * Auto Backup to Google Drive via Admin GAS
 * 
 * Features:
 * - Auto backup daily when app opens (if > 24h since last backup)
 * - Upload encrypted backup to Admin GAS Drive folder
 * - Keep only 3 latest backups per user
 * - List/restore backups from Drive
 */

(function () {
    'use strict';

    // ============================================================
    // CONFIG
    // ============================================================
    const LAST_AUTO_BACKUP_KEY = 'CLIENTPRO_LAST_AUTO_BACKUP';
    const AUTO_BACKUP_ENABLED_KEY = 'CLIENTPRO_AUTO_BACKUP_ENABLED';
    const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

    // ============================================================
    // HELPERS
    // ============================================================
    function getAdminServerUrl() {
        return typeof ADMIN_SERVER_URL !== 'undefined' ? ADMIN_SERVER_URL : '';
    }

    function getEmployeeId() {
        // Use EMPLOYEE_KEY if defined, fallback to 'app_employee_id'
        const key = (typeof EMPLOYEE_KEY !== 'undefined') ? EMPLOYEE_KEY : 'app_employee_id';
        return (localStorage.getItem(key) || '').trim();
    }

    function getDeviceIdSafe() {
        // Use getDeviceId() function if available
        if (typeof getDeviceId === 'function') {
            try { return getDeviceId(); } catch (e) { }
        }
        // Fallback to localStorage
        return (localStorage.getItem('app_device_unique_id') || '').trim();
    }

    function isAutoBackupEnabled() {
        const val = localStorage.getItem(AUTO_BACKUP_ENABLED_KEY);
        // Default: enabled
        return val !== 'false';
    }

    function setAutoBackupEnabled(enabled) {
        localStorage.setItem(AUTO_BACKUP_ENABLED_KEY, enabled ? 'true' : 'false');
    }

    function getLastAutoBackupTime() {
        const ts = localStorage.getItem(LAST_AUTO_BACKUP_KEY);
        return ts ? parseInt(ts, 10) : 0;
    }

    function setLastAutoBackupTime(ts) {
        localStorage.setItem(LAST_AUTO_BACKUP_KEY, String(ts || Date.now()));
    }

    // ============================================================
    // AUTO BACKUP CHECK
    // ============================================================
    async function checkAndAutoBackupDaily() {
        // Skip if disabled
        if (!isAutoBackupEnabled()) {
            console.log('[AutoBackup] Disabled by user');
            return;
        }

        // Skip if no server URL
        const serverUrl = getAdminServerUrl();
        if (!serverUrl) {
            console.log('[AutoBackup] No admin server URL');
            return;
        }

        // Skip if not authenticated
        const emp = getEmployeeId();
        const dev = getDeviceIdSafe();
        if (!emp || !dev) {
            console.log('[AutoBackup] Not authenticated');
            return;
        }

        // Skip if backup secret not ready
        if (!APP_BACKUP_KDATA_B64U) {
            console.log('[AutoBackup] Backup secret not ready');
            return;
        }

        // Check last backup time
        const lastBackup = getLastAutoBackupTime();
        const now = Date.now();
        const elapsed = now - lastBackup;

        if (elapsed < AUTO_BACKUP_INTERVAL_MS) {
            const hoursLeft = Math.round((AUTO_BACKUP_INTERVAL_MS - elapsed) / 3600000);
            console.log(`[AutoBackup] Next backup in ~${hoursLeft}h`);
            return;
        }

        // Perform auto backup
        console.log('[AutoBackup] Starting daily backup...');
        await performAutoBackup();
    }

    async function performAutoBackup() {
        try {
            // Wait for DB to be ready
            if (typeof db === 'undefined' || !db) {
                console.warn('[AutoBackup] DB not ready');
                return;
            }

            // Get all customers
            const customers = await new Promise((resolve, reject) => {
                const tx = db.transaction(['customers'], 'readonly');
                const store = tx.objectStore('customers');
                const req = store.getAll();
                req.onsuccess = (e) => resolve(e.target.result || []);
                req.onerror = (e) => reject(e);
            });

            if (!customers.length) {
                console.log('[AutoBackup] No customers to backup');
                setLastAutoBackupTime(Date.now());
                return;
            }

            // Prepare backup data (decrypt for export)
            const cleanCustomers = customers.map((c) => {
                const cust = JSON.parse(JSON.stringify(c));
                if (typeof decryptText === 'function') {
                    cust.name = decryptText(cust.name);
                    cust.phone = decryptText(cust.phone);
                    cust.cccd = decryptText(cust.cccd);
                }
                cust.driveLink = null;

                if (cust.assets && Array.isArray(cust.assets)) {
                    cust.assets = cust.assets.map((a) => {
                        const asset = JSON.parse(JSON.stringify(a));
                        if (typeof decryptText === 'function') {
                            asset.name = decryptText(asset.name);
                            asset.link = decryptText(asset.link);
                            asset.valuation = decryptText(asset.valuation);
                            asset.loanValue = decryptText(asset.loanValue);
                            asset.area = decryptText(asset.area);
                            asset.width = decryptText(asset.width);
                            asset.onland = decryptText(asset.onland);
                            asset.year = decryptText(asset.year);
                            asset.ocrData = decryptText(asset.ocrData);
                        }
                        asset.driveLink = null;
                        return asset;
                    });
                }
                return cust;
            });

            const dataToExport = {
                v: 1.1,
                customers: cleanCustomers,
                images: [],
                autoBackup: true,
                createdAt: new Date().toISOString()
            };

            const rawStr = JSON.stringify(dataToExport);

            // Encrypt backup
            if (typeof encryptBackupPayload !== 'function') {
                console.error('[AutoBackup] Missing encryptBackupPayload');
                return;
            }

            const encrypted = await encryptBackupPayload(rawStr, APP_BACKUP_KDATA_B64U, { type: 'auto_backup' });

            // Upload to admin GAS
            await uploadAutoBackupToServer(encrypted);

            // Mark backup time
            setLastAutoBackupTime(Date.now());
            console.log('[AutoBackup] Completed successfully');

        } catch (err) {
            console.error('[AutoBackup] Error:', err);
        }
    }

    async function uploadAutoBackupToServer(encryptedContent) {
        const serverUrl = getAdminServerUrl();
        const emp = getEmployeeId();
        const dev = getDeviceIdSafe();

        const payload = {
            action: 'auto_backup',
            employeeId: emp,
            deviceId: dev,
            encrypted: encryptedContent
        };

        const response = await fetch(serverUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.status !== 'success') {
            throw new Error(result.message || 'Upload failed');
        }

        console.log('[AutoBackup] Uploaded:', result.filename);
        return result;
    }

    // ============================================================
    // LIST BACKUPS FROM DRIVE
    // ============================================================
    async function listMyDriveBackups() {
        const serverUrl = getAdminServerUrl();
        const emp = getEmployeeId();
        const dev = getDeviceIdSafe();

        if (!serverUrl || !emp || !dev) {
            throw new Error('Not authenticated');
        }

        const payload = {
            action: 'list_my_backups',
            employeeId: emp,
            deviceId: dev
        };

        const response = await fetch(serverUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.status !== 'success') {
            throw new Error(result.message || 'List failed');
        }

        return result.backups || [];
    }

    // ============================================================
    // RESTORE FROM DRIVE BACKUP
    // ============================================================
    async function downloadDriveBackup(fileId) {
        const serverUrl = getAdminServerUrl();
        const emp = getEmployeeId();
        const dev = getDeviceIdSafe();

        const payload = {
            action: 'download_my_backup',
            employeeId: emp,
            deviceId: dev,
            fileId: fileId
        };

        const response = await fetch(serverUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.status !== 'success') {
            throw new Error(result.message || 'Download failed');
        }

        return result;
    }

    async function restoreFromDriveBackup(fileId) {
        // Ensure backup secret
        if (typeof ensureBackupSecret === 'function') {
            const sec = await ensureBackupSecret();
            if (!sec || !sec.ok || !APP_BACKUP_KDATA_B64U) {
                alert('Không thể lấy khóa bảo mật. Vui lòng kết nối mạng và thử lại.');
                return false;
            }
        }

        const loader = typeof getEl === 'function' ? getEl('loader') : document.getElementById('loader');
        const loaderText = typeof getEl === 'function' ? getEl('loader-text') : document.getElementById('loader-text');

        if (loader) loader.classList.remove('hidden');
        if (loaderText) loaderText.textContent = 'Đang tải backup từ Drive...';

        try {
            const result = await downloadDriveBackup(fileId);
            const encryptedContent = result.encrypted || result.content;

            if (!encryptedContent) {
                throw new Error('Empty backup content');
            }

            if (loaderText) loaderText.textContent = 'Đang giải mã...';

            // Decrypt using existing function
            if (typeof _restoreFromEncryptedContent === 'function') {
                await _restoreFromEncryptedContent(encryptedContent);
            } else {
                throw new Error('Missing restore function');
            }

            if (loader) loader.classList.add('hidden');
            if (typeof showToast === 'function') showToast('Đã khôi phục từ Drive');
            if (typeof loadCustomers === 'function') loadCustomers();

            return true;

        } catch (err) {
            console.error('[RestoreDrive] Error:', err);
            if (loader) loader.classList.add('hidden');
            alert('Lỗi restore: ' + err.message);
            return false;
        }
    }

    // ============================================================
    // DELETE DRIVE BACKUP
    // ============================================================
    async function deleteDriveBackup(fileId) {
        const serverUrl = getAdminServerUrl();
        const emp = getEmployeeId();
        const dev = getDeviceIdSafe();

        const payload = {
            action: 'delete_my_backup',
            employeeId: emp,
            deviceId: dev,
            fileId: fileId
        };

        const response = await fetch(serverUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.status !== 'success') {
            throw new Error(result.message || 'Delete failed');
        }

        return true;
    }

    // ============================================================
    // UI: RENDER DRIVE BACKUPS LIST
    // ============================================================
    async function renderDriveBackupsList(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = '<p class="text-center text-sm opacity-60">Đang tải...</p>';

        try {
            const backups = await listMyDriveBackups();

            if (!backups.length) {
                container.innerHTML = '<p class="text-center text-sm opacity-60">Chưa có backup trên Drive</p>';
                return;
            }

            const formatDate = (iso) => {
                const d = new Date(iso);
                return d.toLocaleDateString('vi-VN') + ' ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            };

            const formatSize = (bytes) => {
                if (bytes < 1024) return bytes + ' B';
                if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
                return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
            };

            container.innerHTML = backups.map((b) => `
        <div class="p-4 rounded-xl border mb-3" style="border-color: var(--border-panel); background: rgba(255,255,255,0.03);">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm font-bold truncate" style="color: var(--text-main)">
                <i data-lucide="cloud" class="w-4 h-4 inline-block mr-1 text-blue-400"></i>
                ${escapeHTML(b.filename || 'Backup')}
              </div>
              <div class="text-[11px] mt-1 opacity-70" style="color: var(--text-sub)">
                ${formatDate(b.createdAt)} • ${formatSize(b.size || 0)}
              </div>
            </div>
            <div class="flex gap-2 flex-shrink-0">
              <button class="px-3 py-2 rounded-xl text-xs font-bold" 
                      style="background: rgba(16,185,129,0.15); color: #34d399;"
                      onclick="DriveBackup.restore('${b.id}')">
                Restore
              </button>
              <button class="px-3 py-2 rounded-xl text-xs font-bold" 
                      style="background: rgba(239,68,68,0.15); color: #f87171;"
                      onclick="DriveBackup.delete('${b.id}')">
                Xóa
              </button>
            </div>
          </div>
        </div>
      `).join('');

            if (window.lucide) lucide.createIcons();

        } catch (err) {
            console.error('[DriveBackups] Error:', err);
            container.innerHTML = `<p class="text-center text-sm text-red-400">${err.message}</p>`;
        }
    }

    // ============================================================
    // GLOBAL API
    // ============================================================
    window.DriveBackup = {
        // Auto backup
        checkDaily: checkAndAutoBackupDaily,
        performNow: performAutoBackup,

        // Settings
        isEnabled: isAutoBackupEnabled,
        setEnabled: setAutoBackupEnabled,

        // List & Restore
        list: listMyDriveBackups,
        restore: async (fileId) => {
            if (!confirm('Khôi phục dữ liệu từ backup này trên Drive?')) return;
            await restoreFromDriveBackup(fileId);
        },
        delete: async (fileId) => {
            if (!confirm('Xóa backup này trên Drive?')) return;
            try {
                await deleteDriveBackup(fileId);
                if (typeof showToast === 'function') showToast('Đã xóa backup');
                // Refresh list if container exists
                const container = document.getElementById('drive-backup-list');
                if (container) renderDriveBackupsList('drive-backup-list');
            } catch (err) {
                alert('Lỗi xóa: ' + err.message);
            }
        },

        // UI
        renderList: renderDriveBackupsList,
        showTab: showDriveBackupTab
    };

    // ============================================================
    // TAB SWITCHING
    // ============================================================
    function showDriveBackupTab() {
        // Hide other panes
        const localPane = document.getElementById('local-backup-pane');
        const inboxPane = document.getElementById('inbox-backup-pane');
        const drivePane = document.getElementById('drive-backup-pane');

        if (localPane) localPane.classList.add('hidden');
        if (inboxPane) inboxPane.classList.add('hidden');
        if (drivePane) drivePane.classList.remove('hidden');

        // Update tab buttons
        const tabLocal = document.getElementById('bkTabLocal');
        const tabInbox = document.getElementById('bkTabInbox');
        const tabDrive = document.getElementById('bkTabDrive');

        if (tabLocal) tabLocal.style.background = 'rgba(255,255,255,0.04)';
        if (tabInbox) tabInbox.style.background = 'rgba(255,255,255,0.04)';
        if (tabDrive) tabDrive.style.background = 'rgba(59,130,246,0.2)';

        // Load drive backups
        renderDriveBackupsList('drive-backup-list');
    }

    // Expose showDriveBackupTab globally for onclick
    window.showDriveBackupTab = showDriveBackupTab;

    // Helper
    function escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

})();

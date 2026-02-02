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
    const DRIVE_BACKUPS_CACHE_KEY = 'CLIENTPRO_DRIVE_BACKUPS_CACHE';
    const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes cache
    const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

    // ============================================================
    // HELPERS
    // ============================================================
    function getUserScriptUrl() {
        // Use USER_SCRIPT_KEY for user's personal GAS (backup goes to their Drive)
        const key = (typeof USER_SCRIPT_KEY !== 'undefined') ? USER_SCRIPT_KEY : 'app_user_script_url';
        return (localStorage.getItem(key) || '').trim();
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
        if (!isAutoBackupEnabled()) return;

        // Skip if no user script URL
        const serverUrl = getUserScriptUrl();
        if (!serverUrl) return;

        // Skip if not authenticated
        const emp = getEmployeeId();
        const dev = getDeviceIdSafe();
        if (!emp || !dev) return;

        if (!APP_BACKUP_KDATA_B64U) return;

        // Check last backup time
        const lastBackup = getLastAutoBackupTime();
        const now = Date.now();
        const elapsed = now - lastBackup;

        if (elapsed < AUTO_BACKUP_INTERVAL_MS) return;

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

        } catch (err) {
            console.error('[AutoBackup] Error:', err);
        }
    }

    async function uploadAutoBackupToServer(encryptedContent) {
        const serverUrl = getUserScriptUrl();
        const emp = getEmployeeId();
        const dev = getDeviceIdSafe();
        const filename = `BACKUP_${emp}_${dev}_${Date.now()}.cpb`;

        const payload = {
            action: 'backup',
            encrypted: encryptedContent,
            filename: filename
        };

        // Use JSON.stringify like 07_drive.js (proven to work)
        const response = await fetch(serverUrl, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.status !== 'success') {
            throw new Error(result.message || 'Upload failed');
        }

        // Optimistic UI: add to cache immediately
        if (result.fileId && result.filename) {
            const cached = readBackupsCache_();
            const newBackup = {
                id: result.fileId,
                filename: result.filename,
                createdAt: result.createdAt || new Date().toISOString(),
                size: encryptedContent.length
            };
            const backups = cached && cached.backups ? [newBackup, ...cached.backups] : [newBackup];
            writeBackupsCache_(backups);

            // Re-render if Drive tab is visible
            const container = document.getElementById('drive-backup-list');
            if (container) renderBackupsHTML_(backups, container);
        }

        return result;
    }

    // ============================================================
    // LIST BACKUPS FROM DRIVE (with cache)
    // ============================================================
    function readBackupsCache_() {
        try {
            const raw = localStorage.getItem(DRIVE_BACKUPS_CACHE_KEY);
            if (!raw) return null;
            const obj = JSON.parse(raw);
            if (!obj || !Array.isArray(obj.backups)) return null;
            return obj;
        } catch (e) { return null; }
    }

    function writeBackupsCache_(backups) {
        try {
            localStorage.setItem(DRIVE_BACKUPS_CACHE_KEY, JSON.stringify({
                ts: Date.now(),
                backups: backups || []
            }));
        } catch (e) { }
    }

    async function listMyDriveBackups(opts) {
        const o = opts || {};
        const serverUrl = getUserScriptUrl();

        // Return cached data if fresh and allowed
        const cached = readBackupsCache_();
        const cacheFresh = cached && (Date.now() - (cached.ts || 0) < CACHE_TTL_MS);
        if (o.allowCached && cacheFresh && cached.backups.length) {
            return cached.backups;
        }

        if (!serverUrl) {
            throw new Error('User script URL not configured');
        }

        // Use GET with URL params for GAS CORS compatibility
        const url = `${serverUrl}?action=list_backups`;
        const response = await fetch(url, { method: 'GET' });
        const result = await response.json();

        if (result.status !== 'success') {
            throw new Error(result.message || 'List failed');
        }

        const backups = result.backups || [];
        writeBackupsCache_(backups);
        return backups;
    }

    // ============================================================
    // RESTORE FROM DRIVE BACKUP
    // ============================================================
    async function downloadDriveBackup(fileId) {
        const serverUrl = getUserScriptUrl();

        // Use GET with URL params for GAS CORS compatibility
        const url = `${serverUrl}?action=download_backup&fileId=${encodeURIComponent(fileId)}`;
        const response = await fetch(url, { method: 'GET' });
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
        const serverUrl = getUserScriptUrl();

        const payload = {
            action: 'delete_backup',
            fileId: fileId
        };

        // Use JSON.stringify like 07_drive.js
        const response = await fetch(serverUrl, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.status !== 'success') {
            throw new Error(result.message || 'Delete failed');
        }

        return true;
    }

    // ============================================================
    // UI: RENDER DRIVE BACKUPS LIST (cache-first for speed)
    // ============================================================
    function renderBackupsHTML_(backups, container) {
        if (!backups || !backups.length) {
            container.innerHTML = '<p class="text-center text-sm opacity-60 py-4">Chưa có backup trên Drive</p>';
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
    }

    async function renderDriveBackupsList(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // 1. Show cached data immediately (instant UI)
        const cached = readBackupsCache_();
        if (cached && cached.backups && cached.backups.length) {
            renderBackupsHTML_(cached.backups, container);
        } else {
            container.innerHTML = '<p class="text-center text-sm opacity-60">Đang tải...</p>';
        }

        // 2. Fetch fresh data in background
        try {
            const backups = await listMyDriveBackups();
            renderBackupsHTML_(backups, container);
        } catch (err) {
            console.error('[DriveBackups] Error:', err);
            // Only show error if no cached data was shown
            if (!cached || !cached.backups || !cached.backups.length) {
                container.innerHTML = `<p class="text-center text-sm text-red-400">${err.message}</p>`;
            }
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
                // Optimistic UI: remove from cache immediately
                const cached = readBackupsCache_();
                if (cached && cached.backups) {
                    cached.backups = cached.backups.filter(b => b.id !== fileId);
                    writeBackupsCache_(cached.backups);
                    // Re-render immediately with updated cache
                    const container = document.getElementById('drive-backup-list');
                    if (container) renderBackupsHTML_(cached.backups, container);
                }

                // Delete on server (in background)
                await deleteDriveBackup(fileId);
                if (typeof showToast === 'function') showToast('Đã xóa backup');
            } catch (err) {
                alert('Lỗi xóa: ' + err.message);
                // Refresh from server on error
                const container = document.getElementById('drive-backup-list');
                if (container) renderDriveBackupsList('drive-backup-list');
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

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
    const MAX_DRIVE_BACKUPS = 3;
    let manualBackupInProgress = false;
    // In-flight guard cho đường auto: chặn hai lần kiểm tra chạy chồng nhau
    // (timer bootstrap + sự kiện unlock + visibilitychange có thể trùng thời điểm).
    let autoBackupCheckInProgress = false;

    // ============================================================
    // HELPERS
    // ============================================================
    function getUserScriptUrl() {
        // Use USER_SCRIPT_KEY for user's personal GAS (backup goes to their Drive)
        const key = (typeof USER_SCRIPT_KEY !== 'undefined') ? USER_SCRIPT_KEY : 'app_user_script_url';
        return (localStorage.getItem(key) || '').trim();
    }

    // getEmployeeId() dùng chung từ 00_globals.js

    function getUserTokenSafe() {
        // Access Token cho UserAPI (Script Drive cá nhân). Server bắt buộc token.
        if (typeof getUserToken === 'function') {
            try { return getUserToken(); } catch (e) { }
        }
        const key = (typeof USER_TOKEN_KEY !== 'undefined') ? USER_TOKEN_KEY : 'app_user_script_token';
        const raw = (localStorage.getItem(key) || '').trim();
        // Token đã niêm phong bằng masterKey (xem 07_drive.js): fallback này không giải mã
        // được thì trả rỗng, KHÔNG gửi ciphertext lên server như token.
        if (raw.indexOf('sealed.v1:') === 0) return '';
        return raw;
    }

    // getDeviceIdSafe() dùng chung từ 00_globals.js

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

    function setDriveBackupStatus(message, tone) {
        const el = document.getElementById('drive-backup-status');
        if (!el) return;
        el.textContent = message || '';
        el.className = 'drive-backup-status ' + (tone || 'muted');
    }

    function setManualBackupButtonLoading(isLoading) {
        const btn = document.getElementById('btn-drive-backup-now');
        if (!btn) return;
        btn.disabled = !!isLoading;
        btn.setAttribute('aria-busy', isLoading ? 'true' : 'false');
        btn.innerHTML = isLoading
            ? '<span class="inline-block w-3 h-3 mr-1 rounded-full border-2 border-current border-t-transparent animate-spin align-[-2px]"></span>Đang sao lưu…'
            : '<i data-lucide="upload-cloud" class="w-3 h-3 inline-block mr-1"></i>Sao lưu ngay';
        try { if (!isLoading && window.lucide) lucide.createIcons(); } catch (e) { }
    }

    async function performManualBackupNow() {
        if (manualBackupInProgress) return false;
        // Không chạy đồng thời với auto-backup check (tránh tạo backup Drive trùng).
        if (autoBackupCheckInProgress) return false;
        manualBackupInProgress = true;
        setManualBackupButtonLoading(true);
        setDriveBackupStatus('Đã nhận lệnh. Đang xác thực và đóng gói backup…', 'working');
        try { if (window.ErrorHandler) ErrorHandler.showInfo('Đang backup lên Drive…'); } catch (e) { }
        try {
            await performAutoBackup();
            setDriveBackupStatus('Backup thành công. Danh sách đang được cập nhật.', 'success');
            try { if (window.ErrorHandler) ErrorHandler.showSuccess('Backup Drive thành công'); } catch (e) { }
            await renderDriveBackupsList('drive-backup-list');
            return true;
        } catch (err) {
            const msg = err && err.message ? err.message : 'Backup Drive thất bại';
            setDriveBackupStatus(msg, 'error');
            try { if (window.ErrorHandler) ErrorHandler.showError('BACKUP', msg, err); } catch (e) { }
            return false;
        } finally {
            manualBackupInProgress = false;
            setManualBackupButtonLoading(false);
        }
    }

    // ============================================================
    // AUTO BACKUP CHECK
    // ============================================================
    async function checkAndAutoBackupDaily() {
        // Idempotent + single-flight: gọi bao nhiêu lần cũng chỉ một kiểm tra chạy;
        // throttle 24h (LAST_AUTO_BACKUP) bảo đảm tối đa một backup/ngày.
        if (autoBackupCheckInProgress) return;
        // Không chạy đồng thời với backup thủ công (tránh tạo backup Drive trùng).
        if (manualBackupInProgress) return;
        autoBackupCheckInProgress = true;
        try {
            await _checkAndAutoBackupDailyInner();
        } finally {
            autoBackupCheckInProgress = false;
        }
    }

    async function _checkAndAutoBackupDailyInner() {
        // Skip if disabled
        if (!isAutoBackupEnabled()) return;

        // Skip if no user script URL
        const serverUrl = getUserScriptUrl();
        if (!serverUrl) return;

        // Skip if not authenticated
        const emp = getEmployeeId();
        const dev = getDeviceIdSafe();
        if (!emp || !dev) return;

        if (typeof isAppUnlocked === 'function' && !isAppUnlocked()) {
            console.warn('[AutoBackup] Skip: app is not unlocked.');
            return;
        }
        if (typeof masterKey === 'undefined' || !masterKey) {
            console.warn('[AutoBackup] Skip: missing masterKey.');
            return;
        }
        if (typeof ensureBackupSecret !== 'function') {
            console.warn('[AutoBackup] Skip: missing ensureBackupSecret.');
            return;
        }
        const sec = await ensureBackupSecret();
        if (!sec || !sec.ok || !APP_BACKUP_KDATA_B64U) {
            console.warn('[AutoBackup] Skip: backup secret is unavailable.', sec && sec.message ? sec.message : '');
            return;
        }

        // Check last backup time
        const lastBackup = getLastAutoBackupTime();
        const now = Date.now();
        const elapsed = now - lastBackup;

        if (elapsed < AUTO_BACKUP_INTERVAL_MS) return;

        try {
            await performAutoBackup();
        } catch (err) {
            console.warn('[AutoBackup] Daily backup failed:', err && err.message ? err.message : err);
        }
    }

    async function performAutoBackup() {
        try {
            if ((typeof isAppUnlocked === 'function' && !isAppUnlocked()) || typeof masterKey === 'undefined' || !masterKey) {
                try { if (window.ErrorHandler) ErrorHandler.showWarning('Vui lòng mở khóa dữ liệu trước khi sao lưu.'); } catch (e) { }
                throw new Error('Vui lòng mở khóa dữ liệu trước khi sao lưu.');
            }
            if (typeof ensureBackupSecret !== 'function') {
                console.warn('[AutoBackup] Stopped: missing ensureBackupSecret.');
                throw new Error('Thiếu cơ chế xác thực backup.');
            }
            const sec = await ensureBackupSecret();
            if (!sec || !sec.ok || !APP_BACKUP_KDATA_B64U) {
                console.warn('[AutoBackup] Stopped: backup secret unavailable.', sec && sec.message ? sec.message : '');
                throw new Error(sec && sec.message ? sec.message : 'Không thể lấy khóa bảo mật backup.');
            }
            if (typeof decryptText !== 'function') {
                console.warn('[AutoBackup] Stopped: decryptText unavailable.');
                throw new Error('Thiếu cơ chế giải mã dữ liệu.');
            }
            // Wait for DB to be ready
            if (typeof db === 'undefined' || !db) {
                console.warn('[AutoBackup] DB not ready');
                throw new Error('Cơ sở dữ liệu chưa sẵn sàng.');
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

            // Chuẩn hoá qua BackupCore (nguồn logic duy nhất ở 12_backup_core.js): giải mã
            // name/phone/cccd/notes + tài sản, bỏ driveLink. Khối cũ BỎ SÓT 'notes' nên notes
            // giữ nguyên ciphertext rồi bị mã hóa lại lần nữa lúc restore (double-encrypt, hỏng
            // notes). Dùng chung normalizer để auto-backup nhất quán với backup thủ công (09).
            if (!window.BackupCore || typeof BackupCore.normalizeCustomerForExport !== 'function') {
                throw new Error('BackupCore chưa sẵn sàng.');
            }
            // normalizeCustomerForExport ASYNC từ v1.6.0 (decrypt thật, không fail-open
            // trả ciphertext khi cache lạnh) — phải await từng customer.
            const cleanCustomers = await Promise.all(
                customers.map((c) => BackupCore.normalizeCustomerForExport(c))
            );

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
                ErrorHandler.logError('[AutoBackup] Missing encryptBackupPayload');
                throw new Error('Thiếu cơ chế mã hóa backup.');
            }

            const encrypted = await encryptBackupPayload(rawStr, APP_BACKUP_KDATA_B64U, { type: 'auto_backup' });

            // Upload to admin GAS
            await uploadAutoBackupToServer(encrypted);

            // Mark backup time
            setLastAutoBackupTime(Date.now());

        } catch (err) {
            ErrorHandler.logError('[AutoBackup] Error', err);
            throw err;
        }
    }

    async function uploadAutoBackupToServer(encryptedContent) {
        const serverUrl = getUserScriptUrl();
        const emp = getEmployeeId();
        const dev = getDeviceIdSafe();
        const filename = `BACKUP_${emp}_${dev}_${Date.now()}.cpb`;

        const payload = {
            action: 'backup',
            token: getUserTokenSafe(),
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

        // Keep retention policy in sync with Drive: only keep latest 3 backups.
        await enforceDriveBackupRetention_();

        return result;
    }

    async function enforceDriveBackupRetention_() {
        const backups = await listMyDriveBackups({ allowCached: false });
        if (!Array.isArray(backups) || backups.length <= MAX_DRIVE_BACKUPS) return;

        const sorted = [...backups].sort((a, b) => {
            const bTs = Date.parse((b && b.createdAt) || '') || 0;
            const aTs = Date.parse((a && a.createdAt) || '') || 0;
            return bTs - aTs;
        });

        const toDelete = sorted.slice(MAX_DRIVE_BACKUPS);
        for (const item of toDelete) {
            if (item && item.id) {
                await deleteDriveBackup(item.id);
            }
        }

        const kept = sorted.slice(0, MAX_DRIVE_BACKUPS);
        writeBackupsCache_(kept);
        const container = document.getElementById('drive-backup-list');
        if (container) renderBackupsHTML_(kept, container);
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

        // POST với token trong body (không đưa token vào query URL để tránh lộ qua
        // log/history). Cùng pattern POST-JSON đã dùng ổn định với GAS ở uploadAutoBackupToServer.
        const response = await fetch(serverUrl, {
            method: 'POST',
            body: JSON.stringify({ action: 'list_backups', token: getUserTokenSafe() })
        });
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

        // POST với token trong body (không đưa token vào query URL để tránh lộ qua
        // log/history).
        const response = await fetch(serverUrl, {
            method: 'POST',
            body: JSON.stringify({ action: 'download_backup', fileId: String(fileId), token: getUserTokenSafe() })
        });
        const result = await response.json();

        if (result.status !== 'success') {
            throw new Error(result.message || 'Download failed');
        }

        return result;
    }

    async function restoreFromDriveBackup(fileId) {
        if (typeof requireUnlockedForRestore === 'function' && !requireUnlockedForRestore()) return false;
        if ((typeof isAppUnlocked === 'function' && !isAppUnlocked()) || typeof masterKey === 'undefined' || !masterKey) {
            ErrorHandler.showWarning('Vui lòng mở khóa dữ liệu trước khi khôi phục.');
            return false;
        }

        // Ensure backup secret
        if (typeof ensureBackupSecret === 'function') {
            const sec = await ensureBackupSecret();
            if (!sec || !sec.ok || !APP_BACKUP_KDATA_B64U) {
                ErrorHandler.showError('NETWORK', 'Không thể lấy khóa bảo mật. Vui lòng kết nối mạng và thử lại.');
                return false;
            }
        }

        closeBackupManager();
        LoadingManager.showGlobal('Đang tải backup từ Drive...');

        try {
            const result = await downloadDriveBackup(fileId);
            const encryptedContent = result.encrypted || result.content;

            if (!encryptedContent) {
                throw new Error('Empty backup content');
            }

            LoadingManager.showGlobal('Đang giải mã...');

            // Decrypt using existing function
            if (typeof _restoreFromEncryptedContent === 'function') {
                await _restoreFromEncryptedContent(encryptedContent);
            } else {
                throw new Error('Missing restore function');
            }

            LoadingManager.hideGlobal(true);
            ErrorHandler.showSuccess('Đã khôi phục từ Drive');
            if (typeof loadCustomers === 'function') loadCustomers();

            return true;

        } catch (err) {
            LoadingManager.hideGlobal(true);
            ErrorHandler.showError('BACKUP', 'Khôi phục từ Drive thất bại. Vui lòng thử lại.', err);
            return false;
        }
    }

    async function sendDriveBackupToUser(fileId, fallbackName) {
        if (!window.CloudTransferUI || typeof window.CloudTransferUI.sendEncryptedRecord !== 'function') {
            throw new Error('Chưa sẵn sàng chức năng gửi user');
        }
        const result = await downloadDriveBackup(fileId);
        const encryptedContent = result.encrypted || result.content;
        if (!encryptedContent) throw new Error('Backup Drive rỗng');

        const ts = Date.now();
        const record = {
            id: `drive_${ts}_${Math.random().toString(36).slice(2, 8)}`,
            filename: fallbackName || result.filename || `CLIENTPRO_DRIVE_${ts}.cpb`,
            createdAt: ts,
            size: new Blob([encryptedContent]).size,
            hash: String(result.hash || ''),
            encrypted: encryptedContent,
            meta: { type: 'drive_backup', sourceFileId: fileId }
        };
        await CloudTransferUI.sendEncryptedRecord(record);
    }

    // ============================================================
    // DELETE DRIVE BACKUP
    // ============================================================
    async function deleteDriveBackup(fileId) {
        const serverUrl = getUserScriptUrl();

        const payload = {
            action: 'delete_backup',
            token: getUserTokenSafe(),
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

        container.textContent = '';
        backups.forEach((b) => {
            const card = document.createElement('div');
            card.className = 'backup-list-card mb-3';

            const row = document.createElement('div');
            row.className = 'backup-list-row';

            const info = document.createElement('div');
            info.className = 'backup-list-info';
            const title = document.createElement('div');
            title.className = 'text-sm font-bold truncate';
            title.style.color = 'var(--text-main)';
            const icon = document.createElement('i');
            icon.setAttribute('data-lucide', 'cloud');
            icon.className = 'w-4 h-4 inline-block mr-1 text-blue-400';
            title.append(icon, document.createTextNode(b.filename || 'Backup'));
            const meta = document.createElement('div');
            meta.className = 'text-[11px] mt-1 opacity-70';
            meta.style.color = 'var(--text-sub)';
            meta.textContent = `${formatDate(b.createdAt)} • ${formatSize(b.size || 0)}`;
            info.append(title, meta);

            const actions = document.createElement('div');
            actions.className = 'backup-list-actions';
            const addButton = (label, style, handler) => {
                const btn = document.createElement('button');
                btn.className = 'backup-list-action';
                btn.style.cssText = style;
                btn.textContent = label;
                btn.addEventListener('click', handler);
                actions.appendChild(btn);
            };
            addButton('Restore', 'background: rgba(16,185,129,0.15); color: #34d399;', () => DriveBackup.restore(b.id));
            addButton('Gửi', 'background: rgba(99,102,241,0.16); color: #a5b4fc; border: 1px solid rgba(99,102,241,0.25);', () => DriveBackup.send(b.id, b.filename || 'Backup'));
            addButton('Xóa', 'background: rgba(239,68,68,0.15); color: #f87171;', () => DriveBackup.delete(b.id));

            row.append(info, actions);
            card.appendChild(row);
            container.appendChild(card);
        });

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
            ErrorHandler.logError('[DriveBackups] Error', err);
            // Only show error state if no cached data was shown
            if (!cached || !cached.backups || !cached.backups.length) {
                LoadingManager.showErrorState(container, {
                    title: 'Không tải được backup Drive',
                    message: ErrorHandler.isOffline() ? 'Bạn đang ngoại tuyến. Kết nối mạng rồi thử lại.' : (err.message || 'Vui lòng kiểm tra kết nối và thử lại.'),
                    actionText: 'Thử lại',
                    onAction: () => renderDriveBackupsList('drive-backup-list'),
                });
            }
        }
    }

    // ============================================================
    // B2: RE-CHECK SAU UNLOCK / KHI APP HIỆN LẠI
    // Timer 15s trong bootstrap chạy khi app thường còn khóa -> checkDaily bị
    // skip và cả phiên không backup. Đăng ký MỘT LẦN (module IIFE chạy một lần):
    // - 'clientpro:unlocked' (02_security.js phát sau completeUnlockDataLoad):
    //   kiểm tra lại ~3s sau unlock (nhường UI load xong).
    // - visibilitychange -> visible: kiểm tra bù khi app quay lại foreground.
    // Idempotent nhờ single-flight guard + throttle 24h; không tạo listener trùng.
    // ============================================================
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('clientpro:unlocked', function () {
            setTimeout(function () {
                try { checkAndAutoBackupDaily(); } catch (e) { }
            }, 3000);
        });
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) return;
            try { checkAndAutoBackupDaily(); } catch (e) { }
        });
    }

    // ============================================================
    // GLOBAL API
    // ============================================================
    window.DriveBackup = {
        // Auto backup
        checkDaily: checkAndAutoBackupDaily,
        performNow: performManualBackupNow,
        performAuto: performAutoBackup,

        // Settings
        isEnabled: isAutoBackupEnabled,
        setEnabled: setAutoBackupEnabled,

        // List & Restore
        list: listMyDriveBackups,
        restore: async (fileId) => {
            if (!(await ErrorHandler.confirm('Khôi phục dữ liệu từ backup này trên Drive?', { title: 'Khôi phục từ Drive', confirmText: 'Khôi phục' }))) return;
            await restoreFromDriveBackup(fileId);
        },
        send: async (fileId, name) => {
            try {
                await sendDriveBackupToUser(fileId, name);
                ErrorHandler.showSuccess('Đã gửi backup Drive');
            } catch (err) {
                ErrorHandler.showError('BACKUP', err && err.message ? err.message : 'Không thể gửi backup Drive', err);
            }
        },
        delete: async (fileId) => {
            if (!(await ErrorHandler.confirm('Xóa backup này trên Drive?', { title: 'Xóa backup Drive', danger: true, confirmText: 'Xóa' }))) return;
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
                ErrorHandler.showSuccess('Đã xóa backup');
            } catch (err) {
                ErrorHandler.showError('BACKUP', 'Xóa backup Drive thất bại: ' + (err.message || ''), err);
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

})();

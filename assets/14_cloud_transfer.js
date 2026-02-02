/*
 * 14_cloud_transfer.js
 * Cloud Transfer Backup (Google Apps Script as server)
 *
 * This module adds a "send backup to other user" channel while keeping the existing
 * local backup/export/import logic intact.
 *
 * GAS expected API contract (WebApp):
 * - GET  ?action=list_users&employeeId=...&deviceId=...&deviceInfo=...
 *      -> { ok:true, users:[{deviceId, employeeId, name}] }
 * - POST action=upload_backup
 *      body: { employeeId, deviceId, toEmployeeId, cipher_b64, filename, size, hash, createdAt, expiresAt }
 *      -> { status:'success', transferId, expiresAt, ... }
 * - GET  ?action=list_inbox&employeeId=...&deviceId=...&deviceInfo=...
 *      -> { status:'success', inbox:[{transferId, fromEmployeeId, filename, size, createdAt, expiresAt, ...}] }
 * - GET  ?action=download_backup&employeeId=...&deviceId=...&transferId=...
 *      -> { status:'success', cipher_b64, filename, ... }
 * - POST action=delete_backup
 *      body: { employeeId, deviceId, transferId }
 *      -> { status:'success' }
 *
 * Note: Server must enforce auth (same logic as check_status/activate).
 */

(function () {
  const TTL_HOURS = 24;
  const POLL_INTERVAL_MS = 30 * 1000;
  const MAX_SEND_BYTES = 350 * 1024; // safety limit for single-request payloads

  // Performance caches (UX only, no behavior changes):
  // - Cache list_users for a short TTL to make "Chọn user" open instantly.
  // - Cache auth check for a short TTL to avoid duplicated ensureBackupSecret calls
  //   when user is doing send/receive operations back-to-back.
  const USERS_CACHE_KEY = 'clientpro_ct_users_cache_v1';
  const USERS_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
  // NOTE: Do not relax security gates for backup/restore. We only use caching for
  // non-sensitive UX (e.g., list_users). Backup/restore still re-checks the server.

  const LS_LAST_INBOX_HASH = 'clientpro_inbox_last_seen_hash';
  const LS_PENDING_NOTICE = 'clientpro_inbox_pending_notice';

  function now() { return Date.now(); }

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

  function serverUrl() {
    return (typeof ADMIN_SERVER_URL !== 'undefined' && ADMIN_SERVER_URL) ? ADMIN_SERVER_URL : '';
  }

  async function ensureAuthOrThrow(opts) {
    const o = opts || {};
    // requireSecret=true means we MUST call server check_status (via ensureBackupSecret)
    // every time for backup/restore flows.
    const requireSecret = (o.requireSecret !== false);
    if (requireSecret && typeof ensureBackupSecret === 'function') {
      const sec = await ensureBackupSecret();
      if (!sec || !sec.ok || !APP_BACKUP_KDATA_B64U) {
        throw new Error(sec && sec.message ? sec.message : 'Không thể xác thực');
      }
    }
    const emp = getEmployeeId();
    if (!emp) throw new Error('Chưa có mã nhân viên');
    if (!serverUrl()) throw new Error('Chưa cấu hình server');
    return true;
  }

  function _readUsersCache() {
    try {
      const raw = localStorage.getItem(USERS_CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !Array.isArray(obj.users) || !obj.ts) return null;
      return obj;
    } catch (e) {
      return null;
    }
  }

  function _writeUsersCache(users) {
    try {
      localStorage.setItem(USERS_CACHE_KEY, JSON.stringify({ ts: now(), users: users || [] }));
    } catch (e) {}
  }

  async function fetchTextWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs || 20000);
    try {
      const res = await fetch(url, { ...(options || {}), signal: controller.signal });
      const txt = await res.text();
      return { ok: res.ok, status: res.status, text: txt };
    } finally {
      clearTimeout(t);
    }
  }

  async function fetchJSON(url, options) {
    const out = await fetchTextWithTimeout(url, options, 25000);
    let json = null;
    try { json = JSON.parse(out.text); } catch (e) { json = null; }
    if (!out.ok) {
      const msg = (json && (json.message || json.error)) ? (json.message || json.error) : (out.text || 'Request failed');
      throw new Error(msg);
    }
    if (json && typeof json === 'object') return json;
    // fallback: server returned plain text
    if (typeof out.text === 'string' && out.text.trim()) {
      return { ok: true, text: out.text };
    }
    return { ok: false, message: 'Server response invalid' };
  }

  // GAS-safe POST helper:
  // Use application/x-www-form-urlencoded so Apps Script can read e.parameter.action reliably.
  function _toFormBody(obj) {
    const p = new URLSearchParams();
    Object.keys(obj || {}).forEach((k) => {
      const v = obj[k];
      if (v === undefined || v === null) return;
      p.append(k, String(v));
    });
    return p.toString();
  }

  function esc(s) {
    if (typeof escapeHTML === 'function') return escapeHTML(s);
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDateTime(ts) {
    if (typeof _formatDateTime === 'function') return _formatDateTime(ts);
    const d = new Date(ts);
    return d.toLocaleString();
  }

  function formatBytes(bytes) {
    if (typeof _formatBytes === 'function') return _formatBytes(bytes);
    const units = ['B', 'KB', 'MB', 'GB'];
    let v = bytes || 0;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
  }

  async function listUsers(opts) {
    const o = opts || {};

    // Fast-path: return cached users if fresh.
    const cached = _readUsersCache();
    const cacheFresh = cached && (now() - Number(cached.ts || 0) < USERS_CACHE_TTL_MS);
    if (cacheFresh && Array.isArray(cached.users) && cached.users.length) {
      // If we allow stale, skip auth check for UI speed (data is not sensitive).
      if (o.allowCached === true) return cached.users;
      // If not explicitly allowing cache-only, still return cache, then optionally refresh.
      if (o.preferCache === true) return cached.users;
    }

    // Only authenticate when we actually fetch from server.
    // For list_users, we do a lightweight auth (no need to fetch secret).
    await ensureAuthOrThrow({ requireSecret: false });

    const emp = encodeURIComponent(getEmployeeId());
    const dev = encodeURIComponent(getDeviceIdSafe());
    const info = encodeURIComponent(navigator.userAgent || '');
    const url = `${serverUrl()}?action=list_users&employeeId=${emp}&deviceId=${dev}&deviceInfo=${info}`;
    const res = await fetchJSON(url, { method: 'GET' });
    const users = (res && Array.isArray(res.users)) ? res.users
      : (res && res.ok && res.data && Array.isArray(res.data.users)) ? res.data.users
      : null;
    if (users) {
      _writeUsersCache(users);
      return users;
    }
    throw new Error(res && res.message ? res.message : 'Không lấy được danh sách user');
  }

  async function prefetchUsers() {
    try {
      // If cache already fresh, do nothing.
      const cached = _readUsersCache();
      if (cached && (now() - Number(cached.ts || 0) < USERS_CACHE_TTL_MS)) return true;
      await listUsers();
      return true;
    } catch (e) {
      return false;
    }
  }

  async function pickUserOverlay() {
    // Show overlay quickly using cached data when possible, then refresh in background.
    let users = [];
    try {
      users = await listUsers({ allowCached: true });
    } catch (e) {
      users = [];
    }

    const selfDev = getDeviceIdSafe();
    const selfEmp = getEmployeeId();

    function filterSelf(arr) {
      return (arr || []).filter(u => {
        if (!u) return false;
        if (selfEmp && u.employeeId && String(u.employeeId).trim().toUpperCase() === String(selfEmp).trim().toUpperCase()) return false;
        if (u.deviceId && String(u.deviceId).trim() === String(selfDev).trim()) return false;
        return true;
      });
    }

    let filtered = filterSelf(users);

    // If cache is empty/stale, retry once with a live fetch before giving up.
    if (!filtered.length) {
      try {
        const live = await listUsers();
        filtered = filterSelf(live);
        users = live;
      } catch (e) {
        // ignore
      }
    }

    if (!filtered.length) {
      alert('Không có user nào khác trong hệ thống.');
      return null;
    }

    return await new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'fixed inset-0 z-[10060] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4';

      overlay.innerHTML = `
        <div class="glass-panel w-full max-w-md rounded-2xl border border-white/10 overflow-hidden">
          <div class="px-4 py-3 flex items-center justify-between border-b border-white/10">
            <div>
              <div class="text-base font-extrabold" style="color: var(--text-main)">Chọn user để gửi</div>
              <div class="text-[11px] opacity-70" style="color: var(--text-sub)">Chỉ user được cấp quyền mới nhận và restore được.</div>
            </div>
            <button class="p-2 rounded-xl hover:bg-white/10" data-act="close" style="color: var(--text-main)">
              <i data-lucide="x" class="w-5 h-5"></i>
            </button>
          </div>
          <div class="p-4 space-y-3">
            <input id="ctUserSearch" placeholder="Tìm theo tên hoặc mã..." class="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm" style="color: var(--text-main)" />
            <div id="ctUserList" class="max-h-[56vh] overflow-auto space-y-2 pr-1 custom-scrollbar"></div>
            <button class="w-full py-3 rounded-xl font-bold bg-white/5 border border-white/10" data-act="cancel" style="color: var(--text-main)">Hủy</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);
      if (window.lucide) lucide.createIcons();

      const listEl = overlay.querySelector('#ctUserList');
      const searchEl = overlay.querySelector('#ctUserSearch');

      // Local in-memory list (can be refreshed without recreating DOM)
      let _users = filtered.slice();

      // Render list efficiently
      function draw(items) {
        const frag = document.createDocumentFragment();
        for (const u of (items || [])) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'w-full text-left p-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition flex items-center gap-3';
          const empVal = esc(u.employeeId || '');
          btn.setAttribute('data-emp', empVal);
          const name = esc(u.name || u.displayName || u.employeeId || '---');
          const dev = esc(u.deviceId || u.deviceIdHint || '');
          btn.innerHTML = `
            <div class="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-300 font-black">U</div>
            <div class="flex-1 min-w-0">
              <div class="font-bold truncate" style="color: var(--text-main)">${name}</div>
              <div class="text-[11px] opacity-70 truncate" style="color: var(--text-sub)">${empVal ? ('Mã: ' + empVal) : ''} ${dev ? ('• ' + dev) : ''}</div>
            </div>
          `;
          frag.appendChild(btn);
        }
        listEl.innerHTML = '';
        listEl.appendChild(frag);
      }

      function filterUsers() {
        const q = String(searchEl.value || '').trim().toLowerCase();
        if (!q) return _users;
        return _users.filter(u => {
          const name = String(u.name || u.displayName || '').toLowerCase();
          const emp = String(u.employeeId || '').toLowerCase();
          const dev = String(u.deviceId || u.deviceIdHint || '').toLowerCase();
          return name.includes(q) || emp.includes(q) || dev.includes(q);
        });
      }

      function close(result) {
        overlay.remove();
        resolve(result);
      }

      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
      overlay.querySelector('[data-act="close"]').addEventListener('click', () => close(null));
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => close(null));

      // Debounce search for very large user lists
      let _searchTimer = null;
      searchEl.addEventListener('input', () => {
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(() => draw(filterUsers()), 120);
      });

      // Click handler (event delegation)
      listEl.addEventListener('click', (ev) => {
        const btn = ev.target && ev.target.closest ? ev.target.closest('button[data-emp]') : null;
        if (!btn) return;
        const emp = btn.getAttribute('data-emp') || '';
        const u = _users.find(x => String(x.employeeId) === String(emp));
        close(u || null);
      });

      draw(_users);

      // Background refresh from server (if cache is stale) without blocking UI.
      setTimeout(async () => {
        try {
          const latest = await listUsers();
          const selfDev2 = getDeviceIdSafe();
          const selfEmp2 = getEmployeeId();
          const latestFiltered = (latest || []).filter(u => {
            if (!u) return false;
            if (selfEmp2 && u.employeeId && String(u.employeeId).trim().toUpperCase() === String(selfEmp2).trim().toUpperCase()) return false;
            if (u.deviceId && String(u.deviceId).trim() === String(selfDev2).trim()) return false;
            return true;
          });
          if (latestFiltered.length && (latestFiltered.length !== _users.length || String((latestFiltered[0] || {}).employeeId || '') !== String((_users[0] || {}).employeeId || ''))) {
            _users = latestFiltered;
            draw(filterUsers());
          }
        } catch (e) {
          // ignore
        }
      }, 50);
    });
  }

  // =========================
  // FIXED: POST form-urlencoded (GAS safe)
  // =========================
  async function uploadBackupToUser(targetUser, backupRec) {
    await ensureAuthOrThrow();
    if (!targetUser || !targetUser.employeeId) throw new Error('Thiếu user đích');
    if (!backupRec || !backupRec.encrypted) throw new Error('Thiếu dữ liệu backup');

    // Normalize cipher payload:
    // - Some environments may provide a DataURL (data:...;base64,....)
    // - Server expects cipher_b64 (but it may actually be JSON envelope ciphertext)
    let cipherPayload = String(backupRec.encrypted || '').trim();
    if (cipherPayload.startsWith('data:')) {
      const idx = cipherPayload.indexOf('base64,');
      if (idx !== -1) cipherPayload = cipherPayload.slice(idx + 'base64,'.length).trim();
    }

    if (backupRec.size && backupRec.size > MAX_SEND_BYTES) {
      throw new Error('Backup quá lớn để gửi trực tiếp. Hãy Xuất file .cpb và gửi qua Zalo/Email.');
    }

    const payload = {
      action: 'upload_backup',
      employeeId: getEmployeeId(),
      deviceId: getDeviceIdSafe(),
      toEmployeeId: String(targetUser.employeeId || '').trim(),
      filename: backupRec.filename || `CLIENTPRO_BK_${Date.now()}.cpb`,
      cipher_b64: cipherPayload,
      size: Number(backupRec.size || 0),
      hash: String(backupRec.hash || ''),
      createdAt: Number(backupRec.createdAt || now()),
      expiresAt: now() + TTL_HOURS * 60 * 60 * 1000,
    };

    // MUST be form-urlencoded so GAS reads e.parameter.action and fields safely.
    const res = await fetchJSON(serverUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: _toFormBody(payload),
    });

    if (res && (res.status === 'success' || res.ok === true) && (res.transferId || (res.data && res.data.transferId))) {
      return res.transferId || (res.data ? res.data.transferId : null);
    }
    if (res && (res.status === 'success' || res.ok === true)) return true;
    throw new Error(res && res.message ? res.message : 'Không gửi được bản ghi');
  }

  async function listInbox() {
    await ensureAuthOrThrow();
    const emp = encodeURIComponent(getEmployeeId());
    const dev = encodeURIComponent(getDeviceIdSafe());
    const info = encodeURIComponent(navigator.userAgent || '');
    const url = `${serverUrl()}?action=list_inbox&employeeId=${emp}&deviceId=${dev}&deviceInfo=${info}`;
    const res = await fetchJSON(url, { method: 'GET' });
    // Support both legacy {items:[...]} and new {inbox:[...]}
    const items = (res && Array.isArray(res.inbox)) ? res.inbox
      : (res && Array.isArray(res.items)) ? res.items
      : (res && res.data && Array.isArray(res.data.inbox)) ? res.data.inbox
      : (res && res.data && Array.isArray(res.data.items)) ? res.data.items
      : [];
    return items;
  }

  async function downloadInboxItem(transferId) {
    await ensureAuthOrThrow();
    const emp = encodeURIComponent(getEmployeeId());
    const dev = encodeURIComponent(getDeviceIdSafe());
    const url = `${serverUrl()}?action=download_backup&employeeId=${emp}&deviceId=${dev}&transferId=${encodeURIComponent(String(transferId))}`;
    const res = await fetchJSON(url, { method: 'GET' });
    const cipher = (res && (res.cipher_b64 || res.encrypted))
      ? (res.cipher_b64 || res.encrypted)
      : (res && res.data && (res.data.cipher_b64 || res.data.encrypted))
        ? (res.data.cipher_b64 || res.data.encrypted)
        : '';
    if (!cipher) throw new Error('Không tải được nội dung bản ghi');
    return { encrypted: cipher, meta: res.meta || (res.data ? res.data.meta : null) || null };
  }

  // FIXED: delete also form-urlencoded (consistent, GAS safe)
  async function deleteInboxItem(transferId) {
    await ensureAuthOrThrow();
    const body = {
      action: 'delete_backup',
      employeeId: getEmployeeId(),
      deviceId: getDeviceIdSafe(),
      transferId: String(transferId),
    };
    try {
      await fetchJSON(serverUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: _toFormBody(body),
      });
      return true;
    } catch (e) {
      // ignore: server may not support delete yet
      return false;
    }
  }

  function setInboxBadge(n) {
    const badge = document.getElementById('inbox-badge');
    if (!badge) return;
    if (n && n > 0) {
      badge.textContent = String(n);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
      badge.textContent = '0';
    }
  }

  function setTabUI(tab) {
    const localBtn = document.getElementById('bkTabLocal');
    const inboxBtn = document.getElementById('bkTabInbox');
    const localPane = document.getElementById('local-backup-pane');
    const inboxPane = document.getElementById('inbox-backup-pane');

    if (localBtn) localBtn.style.background = (tab === 'local') ? 'rgba(59,130,246,0.18)' : 'rgba(255,255,255,0.04)';
    if (inboxBtn) inboxBtn.style.background = (tab === 'inbox') ? 'rgba(59,130,246,0.18)' : 'rgba(255,255,255,0.04)';

    if (localPane) localPane.classList.toggle('hidden', tab !== 'local');
    if (inboxPane) inboxPane.classList.toggle('hidden', tab !== 'inbox');
  }

  async function renderInboxUI(items) {
    const listEl = document.getElementById('inbox-list');
    const emptyEl = document.getElementById('inbox-empty');
    if (!listEl || !emptyEl) return;

    const list = Array.isArray(items) ? items.slice() : [];
    list.sort((a, b) => (Number(b.createdAt || 0) - Number(a.createdAt || 0)));

    if (!list.length) {
      listEl.innerHTML = '';
      emptyEl.classList.remove('hidden');
      return;
    }
    emptyEl.classList.add('hidden');

    listEl.innerHTML = list.map((it) => {
      const fromName = esc(it.fromName || it.fromEmployeeId || it.fromDeviceId || 'User');
      const fname = esc(it.filename || 'backup');
      const created = formatDateTime(Number(it.createdAt || now()));
      const size = formatBytes(Number(it.size || 0));
      return `
        <div class="p-4 rounded-2xl border" style="border-color: var(--border-panel); background: rgba(255,255,255,0.03);">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm font-bold truncate" style="color: var(--text-main)">${fname}</div>
              <div class="text-[11px] mt-1 opacity-70" style="color: var(--text-sub)">Từ: <span class="font-bold" style="color:#60a5fa">${fromName}</span> • ${created} • ${size}</div>
            </div>
            <div class="flex gap-2 flex-shrink-0">
              <button class="px-3 py-2 rounded-xl text-xs font-bold" style="background: rgba(16,185,129,0.15); color: #34d399;" onclick="CloudTransferUI.acceptAndRestore('${esc(it.transferId || it.backupId || it.id || '')}')">Nhận & Restore</button>
              <button class="px-3 py-2 rounded-xl text-xs font-bold" style="background: rgba(239,68,68,0.15); color: #f87171;" onclick="CloudTransferUI.dismiss('${esc(it.transferId || it.backupId || it.id || '')}')">Bỏ qua</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function hashInboxIds(items) {
    try {
      const ids = (items || []).map(x => String(x.transferId || x.backupId || x.id || '')).filter(Boolean).sort();
      return ids.join('|');
    } catch (e) {
      return '';
    }
  }

  async function pollInboxAndNotify() {
    // silent poll: no modal popups, only toast & badge updates
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const emp = getEmployeeId();
      if (!emp) return;
      if (!serverUrl()) return;

      // lightweight: do not call ensureBackupSecret every poll (avoid spamming server)
      const items = await listInbox();
      setInboxBadge(items.length);

      const h = hashInboxIds(items);
      const prev = localStorage.getItem(LS_LAST_INBOX_HASH) || '';
      if (h && h !== prev) {
        localStorage.setItem(LS_LAST_INBOX_HASH, h);

        // pick the newest for notification text
        const newest = items.slice().sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0];
        if (newest) {
          localStorage.setItem(LS_PENDING_NOTICE, JSON.stringify({
            transferId: newest.transferId || newest.backupId || newest.id || '',
            fromName: newest.fromName || newest.fromEmployeeId || newest.fromDeviceId || 'User',
            filename: newest.filename || '',
          }));

          if (typeof showToast === 'function') {
            showToast(`Bạn đã nhận được bản ghi từ ${newest.fromName || newest.fromEmployeeId || newest.fromDeviceId || 'user'}`);
          }

          // If backup manager modal is open, refresh inbox list in place
          try {
            const modal = document.getElementById('backup-manager-modal');
            if (modal && !modal.classList.contains('hidden')) {
              const tab = CloudTransferUI._currentTab || 'local';
              if (tab === 'inbox') {
                await CloudTransferUI.renderInbox();
              }
            }
          } catch (e) {}

          // Show actionable notification overlay (required by user)
          try {
            CloudTransferUI.showReceiveNotice();
          } catch (e) {}
        }
      }
    } catch (e) {
      // silent
    }
  }

  function buildReceiveNotice(payload) {
    const fromName = esc(payload.fromName || 'user');
    const filename = esc(payload.filename || 'backup');
    const transferId = esc(payload.transferId || payload.backupId || '');

    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[10080] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4';
    overlay.innerHTML = `
      <div class="glass-panel w-full max-w-md rounded-2xl p-5 border border-white/10 shadow-2xl">
        <div class="flex items-start gap-3">
          <div class="w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-300">
            <i data-lucide="inbox" class="w-6 h-6"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-extrabold" style="color: var(--text-main)">Bạn đã nhận được bản ghi từ <span style="color:#60a5fa">${fromName}</span></div>
            <div class="text-[11px] opacity-70 mt-1" style="color: var(--text-sub)">Tệp: ${filename}. Bấm “Nhận & Restore” để nhập dữ liệu.</div>
          </div>
        </div>
        <div class="flex gap-3 mt-4">
          <button type="button" class="flex-1 py-3 rounded-xl font-extrabold" style="background: rgba(16,185,129,0.20); color: #34d399; border: 1px solid rgba(16,185,129,0.35)" data-act="accept">Nhận & Restore</button>
          <button type="button" class="flex-1 py-3 rounded-xl font-bold" style="background: rgba(255,255,255,0.06); color: var(--text-main); border: 1px solid rgba(255,255,255,0.12)" data-act="later">Để sau</button>
        </div>
      </div>
    `;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    overlay.querySelector('[data-act="later"]').addEventListener('click', () => overlay.remove());
    overlay.querySelector('[data-act="accept"]').addEventListener('click', async () => {
      try {
        overlay.remove();
        await CloudTransferUI.acceptAndRestore(transferId);
      } catch (err) {
        alert(err && err.message ? err.message : 'Không thể restore');
      }
    });

    return overlay;
  }

  async function acceptAndRestoreById(transferId) {
    if (!transferId) throw new Error('Thiếu mã bản ghi');

    // Confirm and show loader
    if (!confirm('Nhận và Restore bản ghi này?')) return;

    const loader = document.getElementById('loader');
    const loaderText = document.getElementById('loader-text');

    if (loader) loader.classList.remove('hidden');
    if (loaderText) loaderText.textContent = 'Xác thực bảo mật...';

    // Strong gate: call ensureBackupSecret before download+decrypt
    await ensureAuthOrThrow();

    if (loaderText) loaderText.textContent = 'Đang tải bản ghi...';
    const dl = await downloadInboxItem(transferId);

    if (loaderText) loaderText.textContent = 'Đang restore...';

    // Reuse existing restore flow
    if (typeof _restoreFromEncryptedContent === 'function') {
      await _restoreFromEncryptedContent(dl.encrypted);
    } else {
      throw new Error('Thiếu hàm restore (_restoreFromEncryptedContent)');
    }

    // Best-effort delete on server (still auto-delete in 24h)
    await deleteInboxItem(transferId);

    // Clear pending notice if it matches
    try {
      const p = localStorage.getItem(LS_PENDING_NOTICE);
      if (p) {
        const obj = JSON.parse(p);
        if (obj && String(obj.transferId || obj.backupId) === String(transferId)) {
          localStorage.removeItem(LS_PENDING_NOTICE);
        }
      }
    } catch (e) {}

    // Refresh UI
    try {
      if (typeof renderBackupList === 'function') await renderBackupList();
      await CloudTransferUI.renderInbox();
    } catch (e) {}

    if (typeof showToast === 'function') showToast('Đã nhận và restore');

    if (loader) loader.classList.add('hidden');
  }

  async function dismissItem(transferId) {
    if (!transferId) return;
    if (!confirm('Bỏ qua bản ghi này? (Có thể tự xóa sau 24h)')) return;
    await deleteInboxItem(transferId);
    await CloudTransferUI.renderInbox();
  }

  // Public UI API
  const CloudTransferUI = {
    _currentTab: 'local',

    // Warm up caches so the "Chọn user" modal appears instantly.
    // Safe to call anytime; it will no-op if cache is fresh.
    prefetchUsers() {
      try { prefetchUsers(); } catch (e) {}
    },

    showTab(tab) {
      const t = (tab === 'inbox') ? 'inbox' : 'local';
      this._currentTab = t;
      setTabUI(t);
      if (t === 'local') {
        if (typeof renderBackupList === 'function') renderBackupList();
      } else {
        this.renderInbox();
      }
    },

    async renderInbox() {
      try {
        const items = await listInbox();
        setInboxBadge(items.length);
        await renderInboxUI(items);
      } catch (e) {
        const listEl = document.getElementById('inbox-list');
        const emptyEl = document.getElementById('inbox-empty');
        if (listEl) listEl.innerHTML = '';
        if (emptyEl) {
          emptyEl.classList.remove('hidden');
          emptyEl.textContent = (e && e.message) ? e.message : 'Không tải được inbox.';
        }
      }
    },

    async sendBackupFromApp(backupId) {
      const all = (typeof _idbGetAllBackups === 'function') ? await _idbGetAllBackups() : [];
      const rec = all.find(x => String(x.id) === String(backupId));
      if (!rec) {
        alert('Không tìm thấy backup');
        return;
      }

      try {
        const u = await pickUserOverlay();
        if (!u) return;

        const ok = confirm(`Gửi backup này cho user:\n\n${u.name || u.displayName || u.employeeId || u.deviceId}\n\nTiếp tục?`);
        if (!ok) return;

        const loader = document.getElementById('loader');
        const loaderText = document.getElementById('loader-text');
        if (loader) loader.classList.remove('hidden');
        if (loaderText) loaderText.textContent = 'Đang gửi bản ghi...';

        await uploadBackupToUser(u, rec);

        if (loader) loader.classList.add('hidden');
        if (typeof showToast === 'function') showToast('Đã gửi bản ghi');
      } catch (err) {
        const msg = err && err.message ? err.message : String(err || 'Không gửi được');
        alert(msg);
        try {
          const loader = document.getElementById('loader');
          if (loader) loader.classList.add('hidden');
        } catch (e) {}
      }
    },

    // Send an encrypted record that is not necessarily stored in local backup manager.
    // record must contain { encrypted, filename?, size?, hash?, createdAt? }
    async sendEncryptedRecord(record) {
      if (!record || !record.encrypted) {
        alert('Thiếu dữ liệu để gửi');
        return;
      }

      // Hard guard: never allow sending plaintext JSON by mistake
      try {
        const s = String(record.encrypted || '');
        if (!s || s.length < 16) throw new Error('Cipher rỗng');
        // Cho phép envelope JSON (magic CLIENTPRO_CPB), nhưng chặn plaintext khách hàng
        const looksLikeJson = /\{\s*"/.test(s);
        const isEnvelope = looksLikeJson && /"magic"\s*:\s*"CLIENTPRO_CPB"/.test(s);
        const leaksCustomers = /"customers"\s*:/.test(s);
        if ((looksLikeJson && !isEnvelope) || (leaksCustomers && !isEnvelope)) {
          throw new Error('Gói gửi có dấu hiệu chưa mã hóa. Đã chặn để tránh lộ dữ liệu.');
        }
      } catch (e) {
        alert(e && e.message ? e.message : 'Gói gửi không hợp lệ');
        return;
      }

      try {
        const u = await pickUserOverlay();
        if (!u) return;

        const label = record.meta && record.meta.type === 'partial_customers'
          ? `(${record.meta.count || ''} KH)`
          : '';

        const ok = confirm(`Gửi gói dữ liệu này cho user:\n\n${u.name || u.displayName || u.employeeId || u.deviceId} ${label}\n\nTệp: ${record.filename || 'backup.cpb'}\n\nTiếp tục?`);
        if (!ok) return;

        const loader = document.getElementById('loader');
        const loaderText = document.getElementById('loader-text');
        if (loader) loader.classList.remove('hidden');
        if (loaderText) loaderText.textContent = 'Đang gửi bản ghi...';

        await uploadBackupToUser(u, record);

        if (loader) loader.classList.add('hidden');
        if (typeof showToast === 'function') showToast('Đã gửi bản ghi');
      } catch (err) {
        const msg = err && err.message ? err.message : String(err || 'Không gửi được');
        alert(msg);
        try {
          const loader = document.getElementById('loader');
          if (loader) loader.classList.add('hidden');
        } catch (e) {}
      }
    },

    async acceptAndRestore(backupId) {
      try {
        await acceptAndRestoreById(backupId);
      } finally {
        try {
          const loader = document.getElementById('loader');
          if (loader) loader.classList.add('hidden');
        } catch (e) {}
      }
    },

    async dismiss(backupId) {
      try {
        await dismissItem(backupId);
      } catch (e) {
        alert(e && e.message ? e.message : 'Không thể bỏ qua');
      }
    },

    showReceiveNotice() {
      let payload = null;
      try {
        const raw = localStorage.getItem(LS_PENDING_NOTICE);
        if (raw) payload = JSON.parse(raw);
      } catch (e) { payload = null; }

      if (!payload || !(payload.transferId || payload.backupId)) return;

      // avoid stacking multiple overlays
      if (document.getElementById('cloud-recv-notice')) return;

      const overlay = buildReceiveNotice(payload);
      overlay.id = 'cloud-recv-notice';
      document.body.appendChild(overlay);
      if (window.lucide) lucide.createIcons();
    },

    startPolling() {
      // Start only once
      if (this._pollStarted) return;
      this._pollStarted = true;

      // initial poll after a short delay (let DB/init complete)
      setTimeout(() => { pollInboxAndNotify(); }, 3500);

      setInterval(() => {
        // only poll when tab visible (reduce noise)
        try {
          if (document.hidden) return;
        } catch (e) {}
        pollInboxAndNotify();
      }, POLL_INTERVAL_MS);
    }
  };

  // Preload user list (non-blocking) to make "Send" flow instant.
  CloudTransferUI.prefetchUsers = prefetchUsers;

  // Expose
  window.CloudTransferUI = CloudTransferUI;
})();

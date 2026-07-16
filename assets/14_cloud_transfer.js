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
  // Idempotency BỀN VỮNG cho inbox restore: các transferId đã restore thành công.
  // Set RAM (__restoredInboxIds) mất khi reload; nếu restore OK nhưng xóa remote
  // thất bại, sau reload người dùng bấm lại sẽ restore lần hai và ghi đè chỉnh sửa.
  // Persist ID ở đây (cap FIFO) để chống restore đúp qua reload.
  const LS_CONSUMED_TRANSFER_IDS = 'clientpro_inbox_consumed_ids';
  const CONSUMED_IDS_CAP = 200;

  function _readConsumedTransferIds() {
    try {
      const raw = localStorage.getItem(LS_CONSUMED_TRANSFER_IDS);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.map(String) : [];
    } catch (e) { return []; }
  }
  function _isConsumedTransferId(id) {
    return _readConsumedTransferIds().indexOf(String(id)) !== -1;
  }
  function _markConsumedTransferId(id) {
    try {
      const key = String(id);
      const list = _readConsumedTransferIds();
      if (list.indexOf(key) !== -1) return;
      list.push(key);
      while (list.length > CONSUMED_IDS_CAP) list.shift();
      localStorage.setItem(LS_CONSUMED_TRANSFER_IDS, JSON.stringify(list));
    } catch (e) {}
  }

  function now() { return Date.now(); }

  // getEmployeeId() và getDeviceIdSafe() dùng chung từ 00_globals.js

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

  // formatDateTime() và formatBytes() dùng chung từ 00_globals.js

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
    throw new Error(res && res.message ? res.message : 'Không lấy được danh sách đồng nghiệp');
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
      ErrorHandler.showWarning('Không có đồng nghiệp nào khác trong hệ thống.');
      return null;
    }

    return await new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4';

      overlay.appendChild(el('div', { className: 'glass-panel w-full max-w-md rounded-2xl border border-white/10 overflow-hidden' }, [
        el('div', { className: 'px-4 py-3 flex items-center justify-between border-b border-white/10' }, [
          el('div', {}, [
            el('div', { className: 'text-base font-extrabold', style: 'color: var(--text-main)', text: 'Chọn đồng nghiệp để gửi' }),
            el('div', { className: 'text-[11px] opacity-70', style: 'color: var(--text-sub)', text: 'Chỉ đồng nghiệp được cấp quyền mới nhận và khôi phục được.' }),
          ]),
          el('button', { className: 'p-2 rounded-xl hover:bg-white/10', dataset: { act: 'close' }, style: 'color: var(--text-main)' }, [
            el('i', { dataset: { lucide: 'x' }, className: 'w-5 h-5' }),
          ]),
        ]),
        el('div', { className: 'p-4 space-y-3' }, [
          el('input', { id: 'ctUserSearch', placeholder: 'Tìm theo tên hoặc mã...', className: 'w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm', style: 'color: var(--text-main)' }),
          el('div', { id: 'ctUserList', className: 'max-h-[56vh] overflow-auto space-y-2 pr-1 custom-scrollbar' }),
          el('button', { className: 'w-full py-3 rounded-xl font-bold bg-white/5 border border-white/10', dataset: { act: 'cancel' }, style: 'color: var(--text-main)', text: 'Hủy' }),
        ]),
      ]));

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
          const empVal = u.employeeId || '';
          btn.setAttribute('data-emp', empVal);
          const name = u.name || u.displayName || u.employeeId || '---';
          const dev = u.deviceId || u.deviceIdHint || '';

          const avatar = document.createElement('div');
          avatar.className = 'w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-300 font-black';
          avatar.textContent = 'U';

          const info = document.createElement('div');
          info.className = 'flex-1 min-w-0';
          const nameDiv = document.createElement('div');
          nameDiv.className = 'font-bold truncate';
          nameDiv.style.color = 'var(--text-main)';
          nameDiv.textContent = name;
          const metaDiv = document.createElement('div');
          metaDiv.className = 'text-[11px] opacity-70 truncate';
          metaDiv.style.color = 'var(--text-sub)';
          if (empVal) metaDiv.append(`Mã: ${empVal}`);
          if (dev) metaDiv.append(`${empVal ? ' ' : ''}• ${dev}`);
          info.append(nameDiv, metaDiv);

          btn.append(avatar, info);
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
    if (!targetUser || !targetUser.employeeId) throw new Error('Thiếu đồng nghiệp nhận');
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

    // BẢO MẬT (khóa theo từng user): bản ghi local được mã hóa bằng khóa CÁ NHÂN của
    // người gửi — người nhận không có khóa đó nên không giải mã được. Vì vậy phải giải mã
    // bằng khóa cá nhân rồi MÃ LẠI bằng "khóa chuyển" của người nhận (label "transfer" phía
    // server), để chỉ đúng người nhận đọc được và không lộ backup cá nhân của họ.
    if (typeof ensureTransferKey !== 'function' || typeof decryptBackupPayload !== 'function' || typeof encryptBackupPayload !== 'function') {
      throw new Error('Thiếu cơ chế mã hóa để gửi an toàn.');
    }
    let plaintext = '';
    let reMeta = null;
    try {
      const dec = await decryptBackupPayload(cipherPayload, APP_BACKUP_KDATA_B64U);
      plaintext = dec && dec.plaintext ? dec.plaintext : '';
      reMeta = dec && dec.envelope ? dec.envelope.meta : null;
    } catch (e) {
      plaintext = '';
    }
    if (!plaintext) throw new Error('Không giải mã được backup để gửi (khóa cá nhân không khớp).');

    const transferKey = await ensureTransferKey(targetUser.employeeId);
    cipherPayload = await encryptBackupPayload(plaintext, transferKey, reMeta || { type: 'transfer' });

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
    const drivePane = document.getElementById('drive-backup-pane');
    const driveBtn = document.getElementById('bkTabDrive');

    if (localBtn) localBtn.style.background = (tab === 'local') ? 'rgba(59,130,246,0.18)' : 'rgba(255,255,255,0.04)';
    if (inboxBtn) inboxBtn.style.background = (tab === 'inbox') ? 'rgba(59,130,246,0.18)' : 'rgba(255,255,255,0.04)';
    if (driveBtn) driveBtn.style.background = 'rgba(255,255,255,0.04)';

    if (localPane) localPane.classList.toggle('hidden', tab !== 'local');
    if (inboxPane) inboxPane.classList.toggle('hidden', tab !== 'inbox');
    if (drivePane) drivePane.classList.remove('hidden');
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

    listEl.textContent = '';
    list.forEach((it) => {
      const fromName = it.fromName || it.fromEmployeeId || it.fromDeviceId || 'Đồng nghiệp';
      const fname = it.filename || 'backup';
      const created = formatDateTime(Number(it.createdAt || now()));
      const size = formatBytes(Number(it.size || 0));
      const id = String(it.transferId || it.backupId || it.id || '');

      const card = document.createElement('div');
      card.className = 'p-4 rounded-2xl border';
      card.style.borderColor = 'var(--border-panel)';
      card.style.background = 'rgba(255,255,255,0.03)';

      const row = document.createElement('div');
      row.className = 'flex items-start justify-between gap-3';

      const info = document.createElement('div');
      info.className = 'min-w-0';
      const title = document.createElement('div');
      title.className = 'text-sm font-bold truncate';
      title.style.color = 'var(--text-main)';
      title.textContent = fname;
      const meta = document.createElement('div');
      meta.className = 'text-[11px] mt-1 opacity-70';
      meta.style.color = 'var(--text-sub)';
      meta.append(document.createTextNode('Từ: '));
      const sender = document.createElement('span');
      sender.className = 'font-bold';
      sender.style.color = '#60a5fa';
      sender.textContent = fromName;
      meta.append(sender, document.createTextNode(` • ${created} • ${size}`));
      info.append(title, meta);

      const actions = document.createElement('div');
      actions.className = 'flex gap-2 flex-shrink-0';
      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'px-3 py-2 rounded-xl text-xs font-bold';
      acceptBtn.style.cssText = 'background: rgba(16,185,129,0.15); color: #34d399;';
      acceptBtn.textContent = 'Nhận & Khôi phục';
      acceptBtn.addEventListener('click', () => CloudTransferUI.acceptAndRestore(id));
      const dismissBtn = document.createElement('button');
      dismissBtn.className = 'px-3 py-2 rounded-xl text-xs font-bold';
      dismissBtn.style.cssText = 'background: rgba(239,68,68,0.15); color: #f87171;';
      dismissBtn.textContent = 'Bỏ qua';
      dismissBtn.addEventListener('click', () => CloudTransferUI.dismiss(id));
      actions.append(acceptBtn, dismissBtn);

      row.append(info, actions);
      card.appendChild(row);
      listEl.appendChild(card);
    });
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
            fromName: newest.fromName || newest.fromEmployeeId || newest.fromDeviceId || 'Đồng nghiệp',
            filename: newest.filename || '',
          }));

          if (typeof showToast === 'function') {
            showToast(`Bạn đã nhận được bản ghi từ ${newest.fromName || newest.fromEmployeeId || newest.fromDeviceId || 'đồng nghiệp'}`);
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
    const fromName = payload.fromName || 'đồng nghiệp';
    const filename = payload.filename || 'backup';
    const transferId = payload.transferId || payload.backupId || '';

    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4';
    const fromEl = el('span', { style: 'color:#60a5fa' });
    const fileEl = el('span', {});
    overlay.appendChild(el('div', { className: 'glass-panel w-full max-w-md rounded-2xl p-5 border border-white/10 shadow-2xl' }, [
      el('div', { className: 'flex items-start gap-3' }, [
        el('div', { className: 'w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-300' }, [
          el('i', { dataset: { lucide: 'inbox' }, className: 'w-6 h-6' }),
        ]),
        el('div', { className: 'flex-1 min-w-0' }, [
          el('div', { className: 'font-extrabold', style: 'color: var(--text-main)' }, ['Bạn đã nhận được bản ghi từ ', fromEl]),
          el('div', { className: 'text-[11px] opacity-70 mt-1', style: 'color: var(--text-sub)' }, ['File: ', fileEl, '. Bấm “Nhận & Khôi phục” để nhập dữ liệu.']),
        ]),
      ]),
      el('div', { className: 'flex gap-3 mt-4' }, [
        el('button', { type: 'button', className: 'flex-1 py-3 rounded-xl font-extrabold', style: 'background: rgba(16,185,129,0.20); color: #34d399; border: 1px solid rgba(16,185,129,0.35)', dataset: { act: 'accept' }, text: 'Nhận & Khôi phục' }),
        el('button', { type: 'button', className: 'flex-1 py-3 rounded-xl font-bold', style: 'background: rgba(255,255,255,0.06); color: var(--text-main); border: 1px solid rgba(255,255,255,0.12)', dataset: { act: 'later' }, text: 'Để sau' }),
      ]),
    ]));
    fromEl.textContent = fromName;
    fileEl.textContent = filename;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    overlay.querySelector('[data-act="later"]').addEventListener('click', () => overlay.remove());
    overlay.querySelector('[data-act="accept"]').addEventListener('click', async () => {
      try {
        overlay.remove();
        await CloudTransferUI.acceptAndRestore(transferId);
      } catch (err) {
        ErrorHandler.showError('BACKUP', err && err.message ? err.message : 'Không thể khôi phục bản ghi.', err);
      }
    });

    return overlay;
  }

  // In-flight guard cho inbox restore: double-tap "Nhận & Khôi phục" chỉ được tạo
  // đúng MỘT download/restore/delete. Cùng semantics với __restoreInFlight của
  // 09_backup_manager nhưng tách cờ riêng (lifecycle khác nhau).
  let __acceptRestoreInFlight = false;
  // ID đã restore thành công trong phiên: nếu restore OK nhưng xóa remote thất bại,
  // lần retry cleanup KHÔNG được restore dữ liệu thêm lần nữa.
  const __restoredInboxIds = new Set();

  async function acceptAndRestoreById(transferId) {
    if (!transferId) throw new Error('Thiếu mã bản ghi');
    if (__acceptRestoreInFlight) return;
    // Đặt cờ TRƯỚC lần await đầu tiên; nhả trong finally trên mọi nhánh.
    __acceptRestoreInFlight = true;
    try {
      if (typeof requireUnlockedForRestore === 'function' && !requireUnlockedForRestore()) return;
      if ((typeof isAppUnlocked === 'function' && !isAppUnlocked()) || typeof masterKey === 'undefined' || !masterKey) {
        ErrorHandler.showWarning('Vui lòng mở khóa dữ liệu trước khi khôi phục.');
        return;
      }

      // Confirm and show loader
      if (!(await ErrorHandler.confirm('Nhận và khôi phục bản ghi này?', { title: 'Nhận dữ liệu', confirmText: 'Nhận & Khôi phục' }))) return;

      // Đóng Backup Manager TRƯỚC khi hiện loader (flow này còn được gọi từ tab
      // "Nhận từ user" trong modal) — giữ thứ tự đóng modal của flow (UX đúng).
      if (typeof closeBackupManager === 'function') closeBackupManager();

      const loader = document.getElementById('loader');
      const loaderText = document.getElementById('loader-text');

      if (loader) loader.classList.remove('hidden');
      if (loaderText) loaderText.textContent = 'Xác thực bảo mật...';

      // Strong gate: call ensureBackupSecret before download+decrypt
      await ensureAuthOrThrow();

      const idKey = String(transferId);
      // Đã restore rồi (trong phiên HOẶC ở phiên trước — bền vững qua reload):
      // bỏ qua download+restore, chỉ chạy phần "thử xóa remote" bên dưới. Tách bạch
      // "restore" khỏi "thử xóa lại" -> không bao giờ restore đúp qua reload.
      if (!__restoredInboxIds.has(idKey) && !_isConsumedTransferId(idKey)) {
        if (loaderText) loaderText.textContent = 'Đang tải bản ghi...';
        const dl = await downloadInboxItem(transferId);

        if (loaderText) loaderText.textContent = 'Đang khôi phục...';

        // Bản nhận được mã hóa bằng "khóa chuyển" của CHÍNH MÌNH (không phải khóa cá nhân),
        // nên phải lấy transfer key của mình để giải mã.
        if (typeof ensureTransferKey !== 'function') throw new Error('Thiếu cơ chế khóa chuyển');
        const inboxKey = await ensureTransferKey();

        // Reuse existing restore flow. Lỗi ở đây throw ra ngoài → KHÔNG xóa remote.
        if (typeof _restoreFromEncryptedContent === 'function') {
          await _restoreFromEncryptedContent(dl.encrypted, inboxKey);
        } else {
          throw new Error('Thiếu cơ chế khôi phục (_restoreFromEncryptedContent)');
        }
        // Đánh dấu consumed (RAM + BỀN VỮNG) NGAY sau khi restore OK, TRƯỚC khi thử
        // xóa remote — nếu xóa remote fail rồi reload, lần bấm sau sẽ không restore lại.
        __restoredInboxIds.add(idKey);
        _markConsumedTransferId(idKey);
      }

      // Xóa remote CHỈ sau khi restore đã thành công (bây giờ hoặc lần trước).
      // Vẫn best-effort (server tự xóa sau 24h) nhưng phải báo cho người dùng biết.
      const remoteDeleted = await deleteInboxItem(transferId);
      if (remoteDeleted === false) {
        ErrorHandler.showWarning('Đã khôi phục nhưng chưa xóa được bản ghi trên server (sẽ tự xóa sau 24h).');
      }

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

      ErrorHandler.showSuccess('Đã nhận và khôi phục dữ liệu');

      if (loader) loader.classList.add('hidden');
    } finally {
      __acceptRestoreInFlight = false;
    }
  }

  async function dismissItem(transferId) {
    if (!transferId) return;
    if (!(await ErrorHandler.confirm('Bỏ qua bản ghi này? (Có thể tự xóa sau 24h)', { title: 'Bỏ qua bản ghi', confirmText: 'Bỏ qua' }))) return;
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
        ErrorHandler.logError('renderInbox failed', e);
        const listEl = document.getElementById('inbox-list');
        const emptyEl = document.getElementById('inbox-empty');
        if (emptyEl) emptyEl.classList.add('hidden');
        if (listEl) {
          listEl.innerHTML = '';
          LoadingManager.showErrorState(listEl, {
            title: 'Không tải được hộp thư',
            message: ErrorHandler.isOffline() ? 'Bạn đang ngoại tuyến. Kết nối mạng rồi thử lại.' : ((e && e.message) ? e.message : 'Vui lòng thử lại sau.'),
            actionText: 'Thử lại',
            onAction: () => CloudTransferUI.renderInbox(),
          });
        }
      }
    },

    async sendBackupFromApp(backupId) {
      const all = (typeof _idbGetAllBackups === 'function') ? await _idbGetAllBackups() : [];
      const rec = all.find(x => String(x.id) === String(backupId));
      if (!rec) {
        ErrorHandler.showWarning('Không tìm thấy bản sao lưu');
        return;
      }

      try {
        const u = await pickUserOverlay();
        if (!u) return;

        const ok = await ErrorHandler.confirm(`Gửi bản sao lưu này cho đồng nghiệp:\n\n${u.name || u.displayName || u.employeeId || u.deviceId}\n\nTiếp tục?`, { title: 'Gửi bản ghi', confirmText: 'Gửi' });
        if (!ok) return;

        LoadingManager.showGlobal('Đang gửi bản ghi...');

        await uploadBackupToUser(u, rec);

        LoadingManager.hideGlobal(true);
        ErrorHandler.showSuccess('Đã gửi bản ghi');
      } catch (err) {
        LoadingManager.hideGlobal(true);
        const msg = err && err.message ? err.message : String(err || 'Không gửi được');
        ErrorHandler.showError('NETWORK', msg, err);
      }
    },

    // Send an encrypted record that is not necessarily stored in local backup manager.
    // record must contain { encrypted, filename?, size?, hash?, createdAt? }
    async sendEncryptedRecord(record) {
      if (!record || !record.encrypted) {
        ErrorHandler.showWarning('Thiếu dữ liệu để gửi');
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
        ErrorHandler.showError('VALIDATION', e && e.message ? e.message : 'Gói gửi không hợp lệ', e);
        return;
      }

      try {
        const u = await pickUserOverlay();
        if (!u) return;

        const label = record.meta && record.meta.type === 'partial_customers'
          ? `(${record.meta.count || ''} KH)`
          : '';

        const ok = await ErrorHandler.confirm(`Gửi gói dữ liệu này cho đồng nghiệp:\n\n${u.name || u.displayName || u.employeeId || u.deviceId} ${label}\n\nFile: ${record.filename || 'backup.cpb'}\n\nTiếp tục?`, { title: 'Gửi gói dữ liệu', confirmText: 'Gửi' });
        if (!ok) return;

        LoadingManager.showGlobal('Đang gửi bản ghi...');

        await uploadBackupToUser(u, record);

        LoadingManager.hideGlobal(true);
        ErrorHandler.showSuccess('Đã gửi bản ghi');
      } catch (err) {
        LoadingManager.hideGlobal(true);
        const msg = err && err.message ? err.message : String(err || 'Không gửi được');
        ErrorHandler.showError('NETWORK', msg, err);
      }
    },

    async acceptAndRestore(backupId) {
      try {
        await acceptAndRestoreById(backupId);
      } catch (err) {
        // Đồng bộ với nút "Nhận & Khôi phục" của buildReceiveNotice: lỗi (mạng,
        // thiếu transfer key, decrypt hỏng...) phải hiện cho người dùng, không
        // được nuốt im lặng thành unhandled rejection.
        ErrorHandler.showError('BACKUP', err && err.message ? err.message : 'Không thể khôi phục bản ghi.', err);
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
        ErrorHandler.showError('NETWORK', e && e.message ? e.message : 'Không thể bỏ qua bản ghi.', e);
      }
    },

    showReceiveNotice() {
      // Không hiện thông báo nhận dữ liệu khi app đang khóa — overlay ở lớp business
      // modal (200) nằm DƯỚI màn khóa (300), nhưng tránh mọi khả năng lộ tên người
      // gửi/file trên màn khóa và không dựng DOM thừa khi chưa mở khóa.
      if (typeof isAppUnlocked === 'function' && !isAppUnlocked()) return;
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
      setTimeout(() => {
        // Không poll mạng/hiện toast khi app còn khóa (cùng guard với interval bên dưới).
        try { if (typeof isAppUnlocked === 'function' && !isAppUnlocked()) return; } catch (e) {}
        pollInboxAndNotify();
      }, 3500);

      setInterval(() => {
        // only poll when tab visible (reduce noise)
        try {
          if (document.hidden) return;
          // không poll mạng khi app đang khóa (tiết kiệm mạng/pin; kết quả cũng
          // không dùng được khi chưa mở khóa) — cùng guard isAppUnlocked ở nơi khác
          if (typeof isAppUnlocked === 'function' && !isAppUnlocked()) return;
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

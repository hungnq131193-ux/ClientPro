/*
 * 12_backup_core.js
 * BackupCore: lớp lõi backup/restore (adapter) cho các luồng sao lưu/gửi dữ liệu .
 *
 * Export:
 * - Returns plaintext fields (name/phone/cccd/assets...).
 * - Strips driveLink fields.
 * - Excludes images by default (consistent with current backupData()).
 *
 * Restore:
 * - Transactional: single IndexedDB transaction; aborts on failure.
 * - Upserts records (does not clear existing data), matching current restore-from-file behavior.
 */
(function () {
  function assertDeps() {
    if (typeof db === 'undefined' || !db) throw new Error('DB chưa sẵn sàng');
    if (typeof decryptText !== 'function' || typeof encryptText !== 'function') {
      throw new Error('Thiếu hàm mã hóa/giải mã');
    }
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj || {}));
  }

  // ASYNC decrypt THẬT (decryptFieldAsync) — KHÔNG dùng decryptText đồng bộ ở đây:
  // decryptText fail-open khi cache lạnh (trả nguyên "cpg1:...") — đúng cho hiển thị UI
  // nhưng SAI cho export: ciphertext lọt vào backup, lúc restore encryptText từ chối
  // (guard chống double-encryption) -> field bị xóa trắng vĩnh viễn.
  async function safeDecryptAsync(v) {
    try {
      if (typeof decryptFieldAsync === 'function') return await decryptFieldAsync(v);
      return decryptText(v);
    } catch (e) {
      return v || '';
    }
  }

  async function safeEncrypt(v) {
    let t = (v === null || typeof v === 'undefined') ? '' : String(v);
    // Backward-compat backup CŨ (trước v1.6.0) từng lọt ciphertext vào field export:
    // thử giải mã thật trước — restore trên cùng thiết bị/khóa đã export sẽ khôi phục
    // đúng plaintext gốc. Nếu vẫn không giải mã được (khác khóa / dữ liệu hỏng) ->
    // rule R3: giữ nguyên ciphertext gốc, KHÔNG ghi đè rỗng.
    if (_looksEncrypted(t)) {
      try {
        const plain = (typeof decryptFieldAsync === 'function')
          ? await decryptFieldAsync(t) : decryptText(t);
        if (plain && !_looksEncrypted(String(plain))) t = String(plain);
        else return t;
      } catch (e) {
        return t;
      }
    }
    if (!t.trim()) return '';
    // FAIL-CLOSED: encryptText() fail-open trả NGUYÊN plaintext khi masterKey mất
    // (vd auto-lock ẩn app >15s giữa lúc normalize backup lớn). Nếu để nguyên,
    // record sẽ được ghi plaintext nhưng gắn cryptoV=2 -> reader tưởng đã mã hóa.
    // Bắt buộc kết quả PHẢI là ciphertext; nếu không -> throw để HỦY TOÀN BỘ restore
    // (normalize chạy trước khi mở transaction nên chưa record nào bị ghi).
    const enc = await encryptText(t);
    if (!_looksEncrypted(enc)) throw new Error('RESTORE_ENCRYPT_FAILED');
    return enc;
  }

  async function normalizeCustomerForExport(c) {
    const cust = deepClone(c);
    [cust.name, cust.phone, cust.cccd, cust.notes] = await Promise.all([
      safeDecryptAsync(cust.name),
      safeDecryptAsync(cust.phone),
      safeDecryptAsync(cust.cccd),
      safeDecryptAsync(cust.notes)
    ]);
    // v1.0.0: creditLimit mã hóa at rest -> export plaintext (backup không được chứa
    // ciphertext). Number legacy coerce sang string; rỗng giữ nguyên.
    if (cust.creditLimit !== undefined && cust.creditLimit !== null && cust.creditLimit !== '') {
      cust.creditLimit = await safeDecryptAsync(String(cust.creditLimit));
    }
    cust.driveLink = null;

    if (cust.assets && Array.isArray(cust.assets)) {
      cust.assets = await Promise.all(cust.assets.map(async (a) => {
        const asset = deepClone(a);
        const fields = ['name', 'link', 'valuation', 'loanValue', 'area', 'width', 'onland', 'year'];
        const vals = await Promise.all(fields.map((f) => safeDecryptAsync(asset[f])));
        fields.forEach((f, i) => { asset[f] = vals[i]; });
        asset.driveLink = null;
        return asset;
      }));
    }

    return cust;
  }

  // ASYNC: mã hóa lại (AES-GCM) toàn bộ trường -> record ở định dạng mới (cryptoV:2).
  async function normalizeCustomerForRestore(c) {
    const cust = deepClone(c);
    cust.name = await safeEncrypt(cust.name);
    cust.phone = await safeEncrypt(cust.phone);
    cust.cccd = await safeEncrypt(cust.cccd);
    cust.notes = await safeEncrypt(cust.notes);
    // v1.0.0: creditLimit mã hóa at rest. safeEncrypt xử lý cả plaintext trong
    // backup cũ (kể cả number) lẫn ciphertext lọt vào backup (rule R3 giữ nguyên
    // khi không giải mã được — không ghi đè rỗng).
    if (cust.creditLimit !== undefined && cust.creditLimit !== null && cust.creditLimit !== '') {
      cust.creditLimit = await safeEncrypt(String(cust.creditLimit));
    }

    if (cust.assets && Array.isArray(cust.assets)) {
      const out = [];
      for (const a of cust.assets) {
        const asset = deepClone(a);
        asset.name = await safeEncrypt(asset.name);
        asset.link = await safeEncrypt(asset.link);
        asset.valuation = await safeEncrypt(asset.valuation);
        asset.loanValue = await safeEncrypt(asset.loanValue);
        asset.area = await safeEncrypt(asset.area);
        asset.width = await safeEncrypt(asset.width);
        asset.onland = await safeEncrypt(asset.onland);
        asset.year = await safeEncrypt(asset.year);
        out.push(asset);
      }
      cust.assets = out;
    }

    cust.cryptoV = 2; // vừa mã hóa AES-GCM -> migration bỏ qua
    return cust;
  }

  function waitTx(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('TX_FAILED'));
      tx.onabort = () => reject(tx.error || new Error('TX_ABORTED'));
    });
  }

  async function _getAllCustomersRaw() {
    assertDeps();
    return await new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(['customers'], 'readonly');
        const store = tx.objectStore('customers');
        const req = store.getAll();
        req.onsuccess = (e) => resolve(e.target.result || []);
        req.onerror = () => reject(req.error || new Error('READ_FAILED'));
      } catch (e) {
        reject(e);
      }
    });
  }

  async function _getCustomersByIdsRaw(ids) {
    assertDeps();
    const safeIds = Array.isArray(ids) ? ids : [];
    const tx = db.transaction(['customers'], 'readonly');
    const store = tx.objectStore('customers');

    const out = [];
    for (const id of safeIds) {
      // eslint-disable-next-line no-await-in-loop
      const c = await new Promise((resolve) => {
        try {
          const req = store.get(id);
          req.onsuccess = (e) => resolve(e.target.result || null);
          req.onerror = () => resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
      if (c) out.push(c);
    }

    return out;
  }

  async function exportAll() {
    const customers = await _getAllCustomersRaw();
    return {
      v: 1.1,
      customers: await Promise.all(customers.map((c) => normalizeCustomerForExport(c))),
      images: []
    };
  }

  async function exportCustomersByIds(customerIds) {
    const customers = await _getCustomersByIdsRaw(customerIds);
    return {
      v: 1.1,
      customers: await Promise.all(customers.map((c) => normalizeCustomerForExport(c))),
      images: []
    };
  }

  async function _restoreTransactional(payload) {
    assertDeps();
    if (!payload || !Array.isArray(payload.customers)) throw new Error('Payload restore không hợp lệ');
    // Fail-closed: app phải đang mở khóa để re-encrypt được. Nếu đã bị lock (mất
    // masterKey) thì hủy ngay — không để safeEncrypt fail-open ghi plaintext.
    if (typeof isAppUnlocked === 'function' && !isAppUnlocked()) throw new Error('APP_LOCKED');

    // Mã hóa lại TẤT CẢ customer TRƯỚC khi mở transaction (safeEncrypt/AES-GCM async —
    // không được await giữa một transaction IndexedDB).
    const normalizedCustomers = [];
    for (const c of (payload.customers || [])) normalizedCustomers.push(await normalizeCustomerForRestore(c));

    const tx = db.transaction(['customers', 'images'], 'readwrite');
    const customerStore = tx.objectStore('customers');
    const imageStore = tx.objectStore('images');

    normalizedCustomers.forEach((c) => customerStore.put(c));
    (payload.images || []).forEach((i) => imageStore.put(i));

    await waitTx(tx);

    // Nạp lại cache field cho dữ liệu vừa khôi phục (để decryptText đọc đồng bộ ngay).
    try { if (typeof primeFieldCache === 'function') await primeFieldCache(); } catch (e) {}
    try { if (typeof runImageCryptoMigrationIfNeeded === 'function') await runImageCryptoMigrationIfNeeded(); } catch (e) {}
    return true;
  }

  async function restoreAllTransactional(payload) {
    return await _restoreTransactional(payload);
  }

  async function restoreCustomersTransactional(payload) {
    return await _restoreTransactional(payload);
  }

  window.BackupCore = {
    exportAll,
    exportCustomersByIds,
    restoreAllTransactional,
    restoreCustomersTransactional,
    // Per-customer normalizers (dùng lại ở luồng có shape đóng gói riêng, vd auto-backup 16)
    normalizeCustomerForExport,
    normalizeCustomerForRestore
  };
})();

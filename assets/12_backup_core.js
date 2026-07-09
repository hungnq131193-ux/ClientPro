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

  function safeDecrypt(v) {
    try {
      return decryptText(v);
    } catch (e) {
      return v || '';
    }
  }

  async function safeEncrypt(v) {
    const t = (v === null || typeof v === 'undefined') ? '' : String(v);
    if (!t.trim()) return '';
    try {
      return await encryptText(t);
    } catch (e) {
      return '';
    }
  }

  function normalizeCustomerForExport(c) {
    const cust = deepClone(c);
    cust.name = safeDecrypt(cust.name);
    cust.phone = safeDecrypt(cust.phone);
    cust.cccd = safeDecrypt(cust.cccd);
    cust.notes = safeDecrypt(cust.notes);
    cust.driveLink = null;

    if (cust.assets && Array.isArray(cust.assets)) {
      cust.assets = cust.assets.map((a) => {
        const asset = deepClone(a);
        asset.name = safeDecrypt(asset.name);
        asset.link = safeDecrypt(asset.link);
        asset.valuation = safeDecrypt(asset.valuation);
        asset.loanValue = safeDecrypt(asset.loanValue);
        asset.area = safeDecrypt(asset.area);
        asset.width = safeDecrypt(asset.width);
        asset.onland = safeDecrypt(asset.onland);
        asset.year = safeDecrypt(asset.year);
        asset.driveLink = null;
        return asset;
      });
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
      customers: customers.map(normalizeCustomerForExport),
      images: []
    };
  }

  async function exportCustomersByIds(customerIds) {
    const customers = await _getCustomersByIdsRaw(customerIds);
    return {
      v: 1.1,
      customers: customers.map(normalizeCustomerForExport),
      images: []
    };
  }

  async function _restoreTransactional(payload) {
    assertDeps();
    if (!payload || !Array.isArray(payload.customers)) throw new Error('Payload restore không hợp lệ');

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

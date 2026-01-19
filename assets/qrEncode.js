/**
 * qrEncode.js
 *
 * Create QR Transfer frames from current app data.
 * - Uses the SAME security gate as file backup: ensureBackupSecret() -> APP_BACKUP_SECRET
 * - Encrypts exported JSON with CryptoJS AES (same as backupData())
 * - Chunks ciphertext into multiple QR frames
 */

(function () {
  async function _readAllCustomers() {
    return await new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(['customers'], 'readonly');
        const store = tx.objectStore('customers');
        const req = store.getAll();
        req.onsuccess = (e) => resolve(e.target.result || []);
        req.onerror = (e) => reject(e);
      } catch (err) {
        reject(err);
      }
    });
  }

  function _cleanCustomerForBackup(c) {
    const cust = JSON.parse(JSON.stringify(c || {}));

    // Decrypt PII + asset fields (same intent as backupData())
    if (typeof decryptText === 'function') {
      cust.name = decryptText(cust.name);
      cust.phone = decryptText(cust.phone);
      cust.cccd = decryptText(cust.cccd);
    }

    cust.driveLink = null;

    if (cust.assets && Array.isArray(cust.assets)) {
      cust.assets = cust.assets.map((a) => {
        const asset = JSON.parse(JSON.stringify(a || {}));
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
  }

  async function _exportAll() {
    const customers = await _readAllCustomers();
    const cleanCustomers = customers.map(_cleanCustomerForBackup);
    return { v: 1.1, customers: cleanCustomers, images: [] };
  }

  async function _exportCustomersByIds(customerIds) {
    const idSet = new Set((customerIds || []).map(String));
    const customers = await _readAllCustomers();
    const picked = customers.filter((c) => idSet.has(String(c.id)));
    const cleanCustomers = picked.map(_cleanCustomerForBackup);
    return { v: 1.1, customers: cleanCustomers, images: [] };
  }

  async function _ensureSecretOrThrow() {
    const hasSecret = () => {
      try {
        // top-level `let APP_BACKUP_SECRET` is a global binding but may not be a window property
        if (typeof APP_BACKUP_SECRET !== 'undefined' && APP_BACKUP_SECRET) return true;
      } catch (e) {}
      return !!(window && window.APP_BACKUP_SECRET);
    };

    if (typeof ensureBackupSecret === 'function') {
      const sec = await ensureBackupSecret();
      if (!sec || !sec.ok || !hasSecret()) {
        throw new Error((sec && sec.message) ? sec.message : 'Không thể lấy khóa bảo mật');
      }
      return;
    }
    if (!hasSecret()) {
      throw new Error('Không thể backup QR khi đang Offline hoặc chưa xác thực với Server');
    }
  }

  window.QRTransferEncode = {
    /**
     * Create QR frames.
     * @param {Object} opts
     * @param {string} opts.scope - 'all' | 'customers'
     * @param {string[]} [opts.customerIds]
     * @returns {Promise<Object[]|null>} frames or null (fallback handled)
     */
    async create({ scope = 'all', customerIds = [] }) {
      await _ensureSecretOrThrow();

      // Single-QR policy: Only allow generating exactly 1 QR frame.
      // If the encrypted payload is too large, we fallback to the existing file-backup flow.
      // Rationale: QR capacity is limited and high-density QR becomes unreliable on mobile.
      const SINGLE_QR_MAX_CHARS = 1200;

      const createdAt = Date.now();
      let exportData;
      if (scope === 'customers') {
        exportData = await _exportCustomersByIds(customerIds);
      } else {
        exportData = await _exportAll();
      }

      const rawStr = JSON.stringify(exportData);
      if (typeof CryptoJS === 'undefined' || !CryptoJS.AES) {
        throw new Error('Thiếu CryptoJS');
      }
      const secret = (function(){
        try { if (typeof APP_BACKUP_SECRET !== 'undefined' && APP_BACKUP_SECRET) return APP_BACKUP_SECRET; } catch(e) {}
        return window.APP_BACKUP_SECRET || '';
      })();
      const ciphertext = CryptoJS.AES.encrypt(rawStr, secret).toString();

      const frames = window.QRTransferCrypto.chunkCiphertext({
        ciphertext,
        scope,
        createdAt,
        maxChars: SINGLE_QR_MAX_CHARS
      });

      // Enforce exactly one QR. If data exceeds single QR, ask user to use partial-customer QR or file backup.
      if (frames.length > 1) {
        try {
          alert('Dữ liệu quá lớn để gói trong 1 QR. Vui lòng chọn "Backup 1 phần khách hàng" (ít dữ liệu hơn) hoặc dùng Backup file như hiện tại.');
          if (typeof backupData === 'function') await backupData();
        } catch (e) {}
        return null;
      }

      // If too many frames, fallback to normal file backup.
      // (Users can still share .cpb which is already encrypted.)
      if (frames.length > 20) {
        try {
          alert('Dữ liệu quá lớn để chuyển qua QR. App sẽ chuyển sang cơ chế backup file như hiện tại.');
          if (typeof backupData === 'function') await backupData();
        } catch (e) {}
        return null;
      }

      return frames;
    }
  };
})();

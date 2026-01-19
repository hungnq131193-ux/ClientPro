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
    if (typeof ensureBackupSecret === 'function') {
      const sec = await ensureBackupSecret();
      if (!sec || !sec.ok || !window.APP_BACKUP_SECRET) {
        throw new Error((sec && sec.message) ? sec.message : 'Không thể lấy khóa bảo mật');
      }
      return;
    }
    if (!window.APP_BACKUP_SECRET) {
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
      const ciphertext = CryptoJS.AES.encrypt(rawStr, window.APP_BACKUP_SECRET).toString();

      const frames = window.QRTransferCrypto.chunkCiphertext({
        ciphertext,
        scope,
        createdAt
      });

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

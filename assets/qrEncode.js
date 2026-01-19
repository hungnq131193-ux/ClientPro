/*
 * qrEncode.js
 * Creates encrypted QR backup payload (all or selected customers)
 */
(function () {
  window.QRTransferEncode = {
    async create({ scope = 'all', customerIds = [], maxQrText } = {}) {
      await ensureBackupSecret();

      let data;
      if (scope === 'customers') {
        data = await BackupCore.exportCustomersByIds(customerIds);
      } else {
        data = await BackupCore.exportAll();
      }

      const payload = {
        scope,
        createdAt: Date.now(),
        data
      };

      const cipherText = QRTransferCrypto.encryptPayload(payload);
      const chunks = QRTransferCrypto.chunkCipherText(cipherText, {
        scope,
        createdAt: payload.createdAt,
        maxQrText
      });

      return chunks;
    }
  };
})();

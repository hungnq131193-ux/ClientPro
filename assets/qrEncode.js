
window.QRTransferEncode = {
  async create({ scope = 'all', customerIds = [] }) {
    await ensureBackupSecret();
    let data;
    if (scope === 'customers') {
      data = await BackupCore.exportCustomersByIds(customerIds);
    } else {
      data = await BackupCore.exportAll();
    }
    return QRTransferCrypto.encryptAndChunk({
      scope,
      createdAt: Date.now(),
      data
    });
  }
};

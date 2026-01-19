/*
 * qrDecode.js
 * Collects QR chunks, decrypts with APP_BACKUP_SECRET, then restores transactionally.
 */
(function () {
  const buffer = {};

  function addChunk(chunk) {
    const id = chunk.transfer_id;
    if (!buffer[id]) buffer[id] = [];

    // de-dup by index
    if (!buffer[id].some(c => c.index === chunk.index)) {
      buffer[id].push(chunk);
    }
    return buffer[id];
  }

  async function finalize(id, total) {
    await ensureBackupSecret();
    const list = (buffer[id] || []).sort((a, b) => a.index - b.index);
    if (list.length !== total) {
      throw new Error('Chưa đủ phần QR (' + list.length + '/' + total + ')');
    }

    const cipherText = list.map(c => c.data).join('');
    const payload = QRTransferCrypto.decryptPayload(cipherText);

    if (payload.scope === 'customers') {
      await BackupCore.restoreCustomersTransactional(payload.data);
    } else {
      await BackupCore.restoreAllTransactional(payload.data);
    }

    delete buffer[id];
    return true;
  }

  window.QRTransferDecode = {
    buffer,
    async input(chunk) {
      if (!chunk || !chunk.transfer_id || !chunk.index || !chunk.total || !chunk.data) {
        throw new Error('Chunk QR không hợp lệ');
      }
      const list = addChunk(chunk);
      if (list.length === chunk.total) {
        await finalize(chunk.transfer_id, chunk.total);
        alert('QR restore thành công');
      }
    }
  };
})();

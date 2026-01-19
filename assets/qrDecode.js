/*
 * qrDecode.js
 * Collects QR chunks, decrypts with APP_BACKUP_SECRET, then restores transactionally.
 */
(function () {
  const buffer = {};
  let onProgressCb = null;

  function addChunk(chunk) {
    const id = chunk.transfer_id;
    if (!buffer[id]) buffer[id] = [];

    // de-dup by index
    if (!buffer[id].some(c => c.index === chunk.index)) {
      buffer[id].push(chunk);
    }
    const list = buffer[id];
    if (typeof onProgressCb === 'function') {
      try {
        onProgressCb({ transfer_id: id, received: list.length, total: chunk.total, lastIndex: chunk.index });
      } catch (e) {}
    }
    return list;
  }

  async function finalize(id, total) {
    const sec = await ensureBackupSecret();
    if (!sec || sec.ok === false) {
      throw new Error((sec && sec.message) ? sec.message : 'Không nhận được khóa bảo mật từ server.');
    }
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
    onProgress(cb) {
      onProgressCb = (typeof cb === 'function') ? cb : null;
    },
    clear(transferId) {
      if (transferId) {
        delete buffer[transferId];
      } else {
        Object.keys(buffer).forEach(k => delete buffer[k]);
      }
    },
    getProgress(transferId) {
      const list = buffer[transferId] || [];
      const total = (list[0] && list[0].total) ? list[0].total : 0;
      return { received: list.length, total };
    },
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

/**
 * qrDecode.js
 *
 * Collect QR frames -> reassemble ciphertext -> security gate -> restore.
 * Restore uses the same logic as file restore: _restoreFromEncryptedContent(ciphertext).
 */

(function () {
  const buffers = Object.create(null);

  async function _ensureSecretOrThrow() {
    if (typeof ensureBackupSecret === 'function') {
      const sec = await ensureBackupSecret();
      if (!sec || !sec.ok || !window.APP_BACKUP_SECRET) {
        throw new Error((sec && sec.message) ? sec.message : 'Không thể lấy khóa bảo mật');
      }
      return;
    }
    if (!window.APP_BACKUP_SECRET) {
      throw new Error('Không thể Restore QR khi đang Offline hoặc chưa xác thực với Server');
    }
  }

  function _normalizeFrame(frame) {
    if (!frame || typeof frame !== 'object') return null;
    if (!frame.transfer_id || !frame.total || !frame.index) return null;
    return {
      transfer_id: String(frame.transfer_id),
      total: Number(frame.total) || 0,
      index: Number(frame.index) || 0,
      data: String(frame.data || ''),
      scope: frame.scope || 'all',
      createdAt: frame.createdAt || Date.now()
    };
  }

  window.QRTransferDecode = {
    async input(frame) {
      const chunk = _normalizeFrame(frame);
      if (!chunk) return;

      const id = chunk.transfer_id;
      if (!buffers[id]) buffers[id] = [];

      // Avoid duplicates
      if (buffers[id].some((x) => x.index === chunk.index)) return;

      buffers[id].push(chunk);

      if (buffers[id].length === chunk.total) {
        // Security gate (must be ONLINE and valid)
        await _ensureSecretOrThrow();

        const ciphertext = buffers[id]
          .sort((a, b) => a.index - b.index)
          .map((c) => c.data)
          .join('');

        delete buffers[id];

        if (typeof _restoreFromEncryptedContent !== 'function') {
          throw new Error('Thiếu hàm _restoreFromEncryptedContent()');
        }

        // Restore (merge/upsert). For partial customer backups, payload only contains selected customers.
        await _restoreFromEncryptedContent(ciphertext);
        alert('QR restore thành công');
        if (typeof loadCustomers === 'function') {
          try { loadCustomers(); } catch (e) {}
        }
      }
    }
  };
})();

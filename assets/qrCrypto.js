/**
 * qrCrypto.js
 *
 * QR Transfer: chunking helper.
 *
 * IMPORTANT:
 * - Payload content is ALWAYS ciphertext (encrypted string).
 * - Each QR frame contains only metadata + ciphertext slice.
 */

(function () {
  const DEFAULT_MAX_CHARS = 1200; // safer than pushing QR capacity too hard

  function makeTransferId() {
    return String(Date.now()) + '_' + Math.random().toString(36).slice(2, 10);
  }

  window.QRTransferCrypto = {
    /**
     * Chunk a ciphertext string into QR frames.
     * @param {Object} opts
     * @param {string} opts.ciphertext
     * @param {string} opts.scope - 'all' | 'customers'
     * @param {number} opts.createdAt
     * @param {number} [opts.maxChars]
     */
    chunkCiphertext({ ciphertext, scope, createdAt, maxChars }) {
      const max = Number(maxChars) > 0 ? Number(maxChars) : DEFAULT_MAX_CHARS;
      const id = makeTransferId();

      const total = Math.ceil((ciphertext || '').length / max) || 1;
      const frames = [];
      let i = 0;
      let idx = 1;

      while (i < (ciphertext || '').length) {
        frames.push({
          v: 1,
          transfer_id: id,
          createdAt: createdAt || Date.now(),
          scope: scope || 'all',
          index: idx,
          total,
          data: ciphertext.slice(i, i + max)
        });
        i += max;
        idx += 1;
      }

      // Edge case: empty ciphertext should still produce one frame
      if (frames.length === 0) {
        frames.push({
          v: 1,
          transfer_id: id,
          createdAt: createdAt || Date.now(),
          scope: scope || 'all',
          index: 1,
          total: 1,
          data: ''
        });
      }

      return frames;
    }
  };
})();

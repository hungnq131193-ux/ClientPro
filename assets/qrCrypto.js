/*
 * qrCrypto.js
 * QR Transfer Backup crypto + chunking
 *
 * Uses CryptoJS.AES with APP_BACKUP_SECRET (same model as existing file backup/restore).
 * QR content is ciphertext only.
 */
(function () {
  const DEFAULT_MAX_QR_TEXT = 2400; // conservative for scanning stability from screen
  const META_OVERHEAD = 220;        // wrapper JSON overhead estimate

  function assertDeps() {
    if (typeof CryptoJS === 'undefined') {
      throw new Error('Thiếu CryptoJS');
    }
    if (typeof APP_BACKUP_SECRET === 'undefined' || !APP_BACKUP_SECRET) {
      throw new Error('Không thể lấy khóa bảo mật');
    }
  }

  function makeTransferId() {
    const rnd = Math.random().toString(16).slice(2, 10);
    return Date.now() + '_' + rnd;
  }

  function encryptPayload(payload) {
    assertDeps();
    const raw = JSON.stringify(payload);
    return CryptoJS.AES.encrypt(raw, APP_BACKUP_SECRET).toString();
  }

  function decryptPayload(cipherText) {
    assertDeps();
    const bytes = CryptoJS.AES.decrypt(String(cipherText), APP_BACKUP_SECRET);
    const raw = bytes.toString(CryptoJS.enc.Utf8);
    if (!raw) throw new Error('Giải mã thất bại');
    return JSON.parse(raw);
  }

  function chunkCipherText(cipherText, meta) {
    const maxQrText = (meta && meta.maxQrText) || DEFAULT_MAX_QR_TEXT;
    const transfer_id = (meta && meta.transfer_id) || makeTransferId();
    const createdAt = (meta && meta.createdAt) || Date.now();
    const scope = (meta && meta.scope) || 'all';

    // Keep some headroom for JSON wrapper
    let chunkSize = Math.max(800, maxQrText - META_OVERHEAD);
    const total = Math.ceil(cipherText.length / chunkSize) || 1;

    const out = [];
    for (let i = 0; i < total; i++) {
      const start = i * chunkSize;
      const part = cipherText.slice(start, start + chunkSize);
      out.push({
        v: 1,
        transfer_id,
        index: i + 1,
        total,
        algo: 'AES',
        scope,
        createdAt,
        data: part
      });
    }
    return out;
  }

  window.QRTransferCrypto = {
    encryptPayload,
    decryptPayload,
    chunkCipherText,
    DEFAULT_MAX_QR_TEXT
  };
})();

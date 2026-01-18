/*
QR Transfer Backup - Encoder

Responsibilities:
- Build backup payload (small/medium) based on existing backup logic
- Compress + AES-GCM encrypt (QRTransferCrypto)
- Chunk into QR frames with transfer_id and chunk index
- Decide fallback to file backup when payload too large
*/

(function () {
  'use strict';

  const Encoder = {};

  const PREFIX = 'CPQR1';
  // Conservative chunk size for scanning reliability.
  // The value counts characters in the final QR text (metadata + ciphertext chunk).
  const MAX_QR_TEXT_LEN = 900;
  const MAX_TOTAL_FRAMES = 35;

  function _getBackupSecret() {
    try {
      return (typeof APP_BACKUP_SECRET !== 'undefined' && APP_BACKUP_SECRET)
        ? APP_BACKUP_SECRET
        : (window.APP_BACKUP_SECRET || '');
    } catch (e) {
      return window.APP_BACKUP_SECRET || '';
    }
  }

  function _nowId() {
    return (
      't_' +
      Date.now().toString(36) +
      '_' +
      Math.random().toString(36).slice(2, 10)
    );
  }

  async function _getAllCustomers() {
    return await new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(['customers'], 'readonly');
        const store = tx.objectStore('customers');
        const req = store.getAll();
        req.onsuccess = (e) => resolve(e.target.result || []);
        req.onerror = (e) => reject(e);
      } catch (e) {
        reject(e);
      }
    });
  }

  function _cleanCustomer(c) {
    const cust = JSON.parse(JSON.stringify(c));

    // Mirror existing backupData(): decrypt fields + remove drive links
    cust.name = decryptText(cust.name);
    cust.phone = decryptText(cust.phone);
    cust.cccd = decryptText(cust.cccd);
    cust.driveLink = null;

    if (cust.assets && Array.isArray(cust.assets)) {
      cust.assets = cust.assets.map((a) => {
        const asset = JSON.parse(JSON.stringify(a));
        asset.name = decryptText(asset.name);
        asset.link = decryptText(asset.link);
        asset.valuation = decryptText(asset.valuation);
        asset.loanValue = decryptText(asset.loanValue);
        asset.area = decryptText(asset.area);
        asset.width = decryptText(asset.width);
        asset.onland = decryptText(asset.onland);
        asset.year = decryptText(asset.year);
        asset.ocrData = decryptText(asset.ocrData);
        asset.driveLink = null;
        return asset;
      });
    }

    return cust;
  }

  function _applySizeMode(cleanCustomers, mode) {
    if (mode === 'small') {
      // Small: omit assets entirely to minimize payload
      return cleanCustomers.map((c) => {
        const x = JSON.parse(JSON.stringify(c));
        x.assets = [];
        // Keep only commonly used primitives. Do not guess other schema.
        return x;
      });
    }
    // medium (default): include full customer object already cleaned
    return cleanCustomers;
  }

  async function buildBackupPayload(mode) {
    const customers = await _getAllCustomers();
    const cleanCustomers = customers.map(_cleanCustomer);
    const sizedCustomers = _applySizeMode(cleanCustomers, mode);

    return {
      v: 1.1,
      kind: 'qr_transfer',
      mode: mode || 'medium',
      createdAt: Date.now(),
      customers: sizedCustomers,
      images: [],
    };
  }

  function _splitString(str, maxLen) {
    const out = [];
    for (let i = 0; i < str.length; i += maxLen) {
      out.push(str.slice(i, i + maxLen));
    }
    return out;
  }

  function _makeFrameText(meta, ctChunk) {
    // Format: CPQR1|transferId|idx/total|salt|iv|ctchunk
    return [
      PREFIX,
      meta.transferId,
      meta.idx + '/' + meta.total,
      meta.salt,
      meta.iv,
      ctChunk,
    ].join('|');
  }

  async function encodeQrTransfer(mode) {
    // Gate by server check + secret fetch (current project logic)
    const secretNow = _getBackupSecret();
    if (typeof ensureBackupSecret === 'function') {
      const sec = await ensureBackupSecret();
      const secret = _getBackupSecret();
      if (!sec || !sec.ok || !secret) {
        return {
          ok: false,
          reason:
            (sec && sec.message) ||
            'Không thể xác thực bảo mật để tạo QR Backup.',
        };
      }
    } else {
      if (!secretNow) {
        return {
          ok: false,
          reason: 'Không có khóa bảo mật (APP_BACKUP_SECRET).',
        };
      }
    }

    const payload = await buildBackupPayload(mode || 'medium');
    const rawStr = JSON.stringify(payload);

    // Compress (best-effort) then encrypt
    const rawU8 = new TextEncoder().encode(rawStr);
    const compressed = await window.QRTransferCrypto.gzipCompress(rawU8);
    const enc = await window.QRTransferCrypto.encryptAesGcm(compressed, _getBackupSecret());

    // Ciphertext to split (ct only). salt/iv are constant.
    const overhead =
      // PREFIX|transfer|idx/total|salt|iv|  (approx worst case)
      PREFIX.length + 1 + 30 + 1 + 10 + 1 + enc.salt.length + 1 + enc.iv.length + 1;

    const maxCtPerFrame = Math.max(200, MAX_QR_TEXT_LEN - overhead);
    const chunks = _splitString(enc.ct, maxCtPerFrame);

    if (chunks.length > MAX_TOTAL_FRAMES) {
      return {
        ok: false,
        fallbackToFile: true,
        reason:
          'Dữ liệu quá lớn cho QR Transfer (vượt ngưỡng an toàn). Vui lòng dùng Backup file như hiện tại.',
      };
    }

    const transferId = _nowId();
    const total = chunks.length;

    const frames = chunks.map((ctChunk, i) => {
      const meta = {
        transferId,
        idx: i + 1,
        total,
        salt: enc.salt,
        iv: enc.iv,
      };
      return {
        transferId,
        idx: i + 1,
        total,
        text: _makeFrameText(meta, ctChunk),
      };
    });

    return {
      ok: true,
      transferId,
      total,
      mode: payload.mode,
      approxBytes: compressed.length,
      frames,
    };
  }

  Encoder.PREFIX = PREFIX;
  Encoder.encodeQrTransfer = encodeQrTransfer;
  Encoder.buildBackupPayload = buildBackupPayload;

  // Convenience wrapper for UI
  Encoder.buildFrames = async function ({ size } = {}) {
    const res = await encodeQrTransfer(size || 'medium');
    if (!res || !res.ok) return res;
    const info = `Transfer ID: ${res.transferId} • ${res.total} frame • chế độ: ${res.mode}`;
    return Object.assign({}, res, { info });
  };

  window.QRTransferEncode = Encoder;
})();

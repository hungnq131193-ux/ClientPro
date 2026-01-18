/*
QR Transfer Backup - Decoder

Responsibilities:
- Parse CPQR1 frames
- Collect chunks per transfer_id (in-memory, per session)
- After complete: call ensureBackupSecret() then decrypt+decompress
- Preview payload summary
- Transactional restore with rollback (single IDB transaction)

This module is isolated and does not alter existing .cpb restore flow.
*/

(function () {
  'use strict';

  const Decode = {};

  const PREFIX = 'CPQR1';

  function _getBackupSecret() {
    try {
      return (typeof APP_BACKUP_SECRET !== 'undefined' && APP_BACKUP_SECRET)
        ? APP_BACKUP_SECRET
        : (window.APP_BACKUP_SECRET || '');
    } catch (e) {
      return window.APP_BACKUP_SECRET || '';
    }
  }

  const state = {
    current: null, // {transferId, total, received: Map<idx,string>, meta, createdAt}
  };

  function _now() { return Date.now(); }

  function _reset(reason) {
    state.current = null;
    if (reason) {
      try { console.log('[QRTransferDecode] reset:', reason); } catch (e) {}
    }
  }

  function parseFrame(text) {
    if (!text || typeof text !== 'string') return null;
    // Format: CPQR1|<transfer_id>|<i>/<total>|<salt>|<iv>|<ctChunk>
    const parts = text.split('|');
    if (parts.length < 6) return null;
    if (parts[0] !== PREFIX) return null;

    const transferId = parts[1] || '';
    const frac = parts[2] || '';
    const m = frac.match(/^(\d+)\/(\d+)$/);
    if (!m) return null;
    const idx = parseInt(m[1], 10);
    const total = parseInt(m[2], 10);
    if (!Number.isFinite(idx) || !Number.isFinite(total) || idx < 1 || total < 1 || idx > total) return null;

    const salt = parts[3] || '';
    const iv = parts[4] || '';
    const ctChunk = parts.slice(5).join('|') || '';
    if (!transferId || !salt || !iv || !ctChunk) return null;

    return { transferId, idx, total, salt, iv, ctChunk };
  }

  function acceptFrame(frame) {
    if (!frame) return { ok: false, message: 'FRAME_INVALID' };

    // If switching transfer_id, reset
    if (!state.current || state.current.transferId !== frame.transferId) {
      state.current = {
        transferId: frame.transferId,
        total: frame.total,
        received: new Map(),
        meta: { salt: frame.salt, iv: frame.iv },
        createdAt: _now(),
      };
    }

    // Basic consistency
    if (state.current.total !== frame.total) {
      return { ok: false, message: 'FRAME_MISMATCH_TOTAL' };
    }
    if (state.current.meta.salt !== frame.salt || state.current.meta.iv !== frame.iv) {
      return { ok: false, message: 'FRAME_MISMATCH_META' };
    }

    // Store chunk
    state.current.received.set(frame.idx, frame.ctChunk);

    return { ok: true, progress: getProgress() };
  }

  function getProgress() {
    if (!state.current) return { transferId: '', total: 0, got: 0, missing: [] };
    const total = state.current.total;
    const got = state.current.received.size;
    const missing = [];
    for (let i = 1; i <= total; i++) {
      if (!state.current.received.has(i)) missing.push(i);
    }
    return { transferId: state.current.transferId, total, got, missing };
  }

  async function reconstructCiphertext() {
    if (!state.current) throw new Error('NO_SESSION');
    const { total, received } = state.current;
    const parts = [];
    for (let i = 1; i <= total; i++) {
      const c = received.get(i);
      if (!c) throw new Error('MISSING_' + i);
      parts.push(c);
    }
    return parts.join('');
  }

  function buildPreview(data) {
    const customers = Array.isArray(data.customers) ? data.customers : [];
    const total = customers.length;
    const withAssets = customers.filter(c => c && Array.isArray(c.assets) && c.assets.length > 0).length;
    const sample = customers.slice(0, 5).map(c => {
      const name = c && c.name ? String(c.name) : '(không tên)';
      const phone = c && c.phone ? String(c.phone) : '';
      return phone ? `${name} • ${phone}` : name;
    });
    return { totalCustomers: total, customersWithAssets: withAssets, sample };
  }

  async function restoreTransactional(data) {
    if (typeof db === 'undefined' || !db) throw new Error('DB_NOT_READY');

    // Prepare encrypted objects following existing restore logic
    const enc = (txt) => (txt && String(txt).trim().length > 0 ? encryptText(txt) : '');

    const customers = (data.customers || []).map((c) => {
      const cust = JSON.parse(JSON.stringify(c || {}));
      cust.name = enc(cust.name);
      cust.phone = enc(cust.phone);
      cust.cccd = enc(cust.cccd);
      cust.driveLink = null;

      if (cust.assets && Array.isArray(cust.assets)) {
        cust.assets = cust.assets.map((a) => {
          const asset = JSON.parse(JSON.stringify(a || {}));
          asset.name = enc(asset.name);
          asset.link = enc(asset.link);
          asset.valuation = enc(asset.valuation);
          asset.loanValue = enc(asset.loanValue);
          asset.area = enc(asset.area);
          asset.width = enc(asset.width);
          asset.onland = enc(asset.onland);
          asset.year = enc(asset.year);
          asset.ocrData = enc(asset.ocrData);
          asset.driveLink = null;
          return asset;
        });
      }
      return cust;
    });

    const images = Array.isArray(data.images) ? data.images : [];

    // Single transaction => rollback if any error
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['customers', 'images'], 'readwrite');
      const customerStore = tx.objectStore('customers');
      const imageStore = tx.objectStore('images');

      // Clear first (inside the transaction)
      customerStore.clear();
      imageStore.clear();

      for (const c of customers) customerStore.put(c);
      for (const i of images) imageStore.put(i);

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(new Error('DB_WRITE_FAILED'));
      tx.onabort = () => reject(new Error('DB_WRITE_ABORTED'));
    });
  }

  async function finalizeAndDecrypt() {
    if (!state.current) throw new Error('NO_SESSION');

    // Mandatory server check (key/device) right before decrypt/preview/restore
    if (typeof ensureBackupSecret === 'function') {
      const sec = await ensureBackupSecret();
      const secret = _getBackupSecret();
      if (!sec || !sec.ok || !secret) {
        throw new Error('SECURITY_FAILED');
      }
    } else {
      throw new Error('SECURITY_API_MISSING');
    }

    const ct = await reconstructCiphertext();
    const encObj = {
      salt: state.current.meta.salt,
      iv: state.current.meta.iv,
      ct,
    };

    const ptU8 = await window.QRTransferCrypto.decryptAesGcm(encObj, _getBackupSecret());
    const rawU8 = await window.QRTransferCrypto.gzipDecompress(ptU8);
    const jsonStr = new TextDecoder().decode(rawU8);

    let data;
    try {
      data = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error('JSON_INVALID');
    }

    return { data, preview: buildPreview(data) };
  }

  async function handleScanText(text) {
    const frame = parseFrame(text);
    const r = acceptFrame(frame);
    if (!r.ok) return r;

    // Notify UI
    if (window.QRTransferUI && typeof window.QRTransferUI.onReceiveProgress === 'function') {
      window.QRTransferUI.onReceiveProgress(r.progress);
    }

    // Auto-finalize when complete
    if (r.progress.got === r.progress.total) {
      try {
        const out = await finalizeAndDecrypt();
        if (window.QRTransferUI && typeof window.QRTransferUI.onReceiveComplete === 'function') {
          window.QRTransferUI.onReceiveComplete(out);
        }
        return { ok: true, complete: true, preview: out.preview };
      } catch (e) {
        if (window.QRTransferUI && typeof window.QRTransferUI.onReceiveError === 'function') {
          window.QRTransferUI.onReceiveError(e);
        }
        return { ok: false, message: String(e && e.message ? e.message : e) };
      }
    }

    return r;
  }

  // Compatibility with scanner file
  window.handleBackupTransferQrResult = function (decodedText) {
    handleScanText(decodedText);
  };

  Decode.parseFrame = parseFrame;
  Decode.acceptFrame = acceptFrame;
  Decode.getProgress = getProgress;
  Decode.reset = _reset;
  Decode.finalizeAndDecrypt = finalizeAndDecrypt;
  Decode.restoreTransactional = restoreTransactional;
  Decode.handleScanText = handleScanText;

  window.QRTransferDecode = Decode;
})();

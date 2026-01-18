/*
QR Transfer Backup - Crypto helper (isolated module)

- Compression: gzip via CompressionStream/DecompressionStream when available
- Encryption: AES-GCM via WebCrypto
- KDF: PBKDF2(SHA-256) from APP_BACKUP_SECRET with random salt

This module is used only by QR transfer, and is intentionally isolated.
*/

(function () {
  'use strict';

  const QRCRYPTO = {};

  function u8FromArrayBuffer(buf) {
    return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  }

  function concatU8(chunks) {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }

  function randBytes(n) {
    const b = new Uint8Array(n);
    crypto.getRandomValues(b);
    return b;
  }

  function b64urlEncode(u8a) {
    let s = '';
    const bytes = u8FromArrayBuffer(u8a);
    const len = bytes.length;
    for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[i]);
    const b64 = btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    return b64;
  }

  function b64urlDecodeToU8(b64url) {
    const b64 = String(b64url).replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 ? 4 - (b64.length % 4) : 0;
    const padded = b64 + '='.repeat(pad);
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function gzipCompress(u8a) {
    if (typeof CompressionStream === 'undefined') return u8FromArrayBuffer(u8a);
    const cs = new CompressionStream('gzip');
    const w = cs.writable.getWriter();
    await w.write(u8FromArrayBuffer(u8a));
    await w.close();
    const resp = new Response(cs.readable);
    const ab = await resp.arrayBuffer();
    return new Uint8Array(ab);
  }

  async function gzipDecompress(u8a) {
    if (typeof DecompressionStream === 'undefined') return u8FromArrayBuffer(u8a);
    const ds = new DecompressionStream('gzip');
    const w = ds.writable.getWriter();
    await w.write(u8FromArrayBuffer(u8a));
    await w.close();
    const resp = new Response(ds.readable);
    const ab = await resp.arrayBuffer();
    return new Uint8Array(ab);
  }

  async function deriveAesGcmKey(secret, saltU8) {
    const enc = new TextEncoder();
    const secretBytes = enc.encode(String(secret || ''));
    if (!secretBytes.length) throw new Error('NO_SECRET');

    const baseKey = await crypto.subtle.importKey(
      'raw',
      secretBytes,
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: u8FromArrayBuffer(saltU8),
        iterations: 120000,
        hash: 'SHA-256',
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptAesGcm(plaintextU8, secret) {
    const salt = randBytes(16);
    const iv = randBytes(12);
    const key = await deriveAesGcmKey(secret, salt);
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      u8FromArrayBuffer(plaintextU8)
    );
    return {
      salt: b64urlEncode(salt),
      iv: b64urlEncode(iv),
      ct: b64urlEncode(new Uint8Array(ct)),
    };
  }

  async function decryptAesGcm(encObj, secret) {
    const salt = b64urlDecodeToU8(encObj.salt);
    const iv = b64urlDecodeToU8(encObj.iv);
    const ct = b64urlDecodeToU8(encObj.ct);
    const key = await deriveAesGcmKey(secret, salt);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ct
    );
    return new Uint8Array(pt);
  }

  QRCRYPTO.b64urlEncode = b64urlEncode;
  QRCRYPTO.b64urlDecodeToU8 = b64urlDecodeToU8;
  QRCRYPTO.concatU8 = concatU8;
  QRCRYPTO.gzipCompress = gzipCompress;
  QRCRYPTO.gzipDecompress = gzipDecompress;
  QRCRYPTO.encryptAesGcm = encryptAesGcm;
  QRCRYPTO.decryptAesGcm = decryptAesGcm;

  window.QRTransferCrypto = QRCRYPTO;
})();

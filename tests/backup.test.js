'use strict';

// ============================================================================
// backup.test.js — Ưu tiên #1: BACKUP/RESTORE không mất & không corrupt dữ liệu.
// Kiểm chứng envelope .cpb (AES-256-GCM WebCrypto) trong assets/02_security.js:
//   encryptBackupPayload -> decryptBackupPayload phải roundtrip chính xác,
//   phát hiện giả mạo (GCM tag + checksum SHA-256), và từ chối sai khóa.
// Đây là tầng bảo vệ file backup toàn bộ dữ liệu khách hàng/tài sản.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSecurity, randomKdataB64u } = require('./helpers/load-security');

// Ảnh giả lập (data URL) để kiểm tra backup KHÔNG làm hỏng payload lớn/nhị phân.
function fakeImageDataUrl(kb) {
  const chunk = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let body = '';
  while (body.length < kb * 1024) body += chunk;
  return 'data:image/jpeg;base64,' + body.slice(0, kb * 1024);
}

test('backup: roundtrip toàn bộ payload khách hàng + tài sản + ghi chú + ảnh', async () => {
  const { api } = loadSecurity();
  const kdata = randomKdataB64u();

  const snapshot = {
    version: '1.4.3',
    customers: [
      {
        id: 'c1',
        name: 'Nguyễn Văn A',
        phone: '0987654321',
        cccd: '001234567890',
        notes: 'Khách VIP — hạn mức 2.5 tỷ 💰',
        status: 'approved',
        assets: [
          {
            id: 'a1',
            name: 'Nhà đất 120m² mặt tiền',
            valuation: '5000000000',
            loanValue: '3500000000',
            area: '120',
            width: '5',
            onland: '80',
            year: '2019',
          },
        ],
        images: [fakeImageDataUrl(8)],
      },
    ],
  };
  const plaintext = JSON.stringify(snapshot);

  const cpb = await api.encryptBackupPayload(plaintext, kdata, { type: 'full_backup' });
  const restored = await api.decryptBackupPayload(cpb, kdata);

  assert.equal(restored.plaintext, plaintext, 'Backup roundtrip phải khớp từng byte');
  assert.deepEqual(JSON.parse(restored.plaintext), snapshot, 'Cấu trúc dữ liệu phải nguyên vẹn');
});

test('backup: envelope có đúng magic/alg/checksum, ciphertext không lộ plaintext', async () => {
  const { api } = loadSecurity();
  const kdata = randomKdataB64u();
  const plaintext = JSON.stringify({ customers: [{ name: 'Bí mật khách hàng' }] });

  const cpb = await api.encryptBackupPayload(plaintext, kdata);
  const env = JSON.parse(cpb);

  assert.equal(env.magic, 'CLIENTPRO_CPB');
  assert.equal(env.alg, 'A256GCM');
  assert.equal(env.v, 2);
  assert.ok(env.iv && env.ct, 'Phải có IV và ciphertext');
  assert.ok(env.cs && env.cs.length === 64, 'Checksum SHA-256 hex 64 ký tự');
  assert.ok(!cpb.includes('Bí mật khách hàng'), 'Ciphertext không được lộ plaintext');
});

test('backup: SAI khóa KDATA -> DECRYPT_FAILED (không trả dữ liệu sai)', async () => {
  const { api } = loadSecurity();
  const goodKey = randomKdataB64u();
  const wrongKey = randomKdataB64u();
  const cpb = await api.encryptBackupPayload('dữ liệu quan trọng', goodKey);

  await assert.rejects(
    () => api.decryptBackupPayload(cpb, wrongKey),
    /DECRYPT_FAILED/,
    'Sai khóa phải ném lỗi, tuyệt đối không trả plaintext'
  );
});

test('backup: GIẢ MẠO ciphertext bị GCM phát hiện (anti-tamper)', async () => {
  const { api } = loadSecurity();
  const kdata = randomKdataB64u();
  const cpb = await api.encryptBackupPayload('số dư: 1.000.000.000', kdata);
  const env = JSON.parse(cpb);

  // Lật vài byte trong ciphertext.
  const ctBuf = Buffer.from(env.ct, 'base64');
  ctBuf[0] ^= 0xff;
  ctBuf[ctBuf.length - 1] ^= 0xff;
  env.ct = ctBuf.toString('base64');

  await assert.rejects(
    () => api.decryptBackupPayload(JSON.stringify(env), kdata),
    /DECRYPT_FAILED/,
    'Ciphertext bị sửa phải bị GCM auth tag chặn'
  );
});

test('backup: thiếu khóa khi restore -> MISSING_BACKUP_KDATA', async () => {
  const { api } = loadSecurity();
  const kdata = randomKdataB64u();
  const cpb = await api.encryptBackupPayload('x', kdata);

  await assert.rejects(
    () => api.decryptBackupPayload(cpb, ''),
    /MISSING_BACKUP_KDATA/
  );
});

test('backup: nội dung rỗng khi restore -> EMPTY_CIPHER', async () => {
  const { api } = loadSecurity();
  await assert.rejects(() => api.decryptBackupPayload('', randomKdataB64u()), /EMPTY_CIPHER/);
});

test('backup: KDATA sai độ dài (không phải 32 byte) -> KDATA_INVALID_LEN', async () => {
  const { api } = loadSecurity();
  const shortKey = Buffer.from(new Uint8Array(16)).toString('base64url'); // chỉ 16 byte
  await assert.rejects(
    () => api.encryptBackupPayload('x', shortKey),
    /KDATA_INVALID_LEN/
  );
});

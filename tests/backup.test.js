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
const { loadSecurity, loadBackupCore, randomKdataB64u, makeFakeDb } = require('./helpers/load-security');

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

// ============================================================================
// v1.6.0 Bug 1 — Export/restore khi cache LẠNH (BackupCore, 12_backup_core.js):
// export phải decrypt THẬT (không fail-open trả ciphertext), restore backup cũ
// đã lỗi phải khôi phục được plaintext thay vì xóa trắng field.
// ============================================================================

test('backup-core: export khi cache LẠNH vẫn ra plaintext (không lọt cpg1: vào backup)', async () => {
  const { api, ctx } = loadSecurity();
  const BackupCore = loadBackupCore(ctx);
  await api.setMasterKey(api.generateMasterKey());

  const cust = {
    id: 'c1',
    name: await api.encryptText('Nguyễn Văn A'),
    phone: await api.encryptText('0987654321'),
    cccd: await api.encryptText('001234567890'),
    notes: await api.encryptText('Khách VIP — hạn mức 2.5 tỷ'),
    assets: [{
      id: 'a1',
      name: await api.encryptText('Nhà đất 120m²'),
      valuation: await api.encryptText('5000000000'),
      loanValue: await api.encryptText('3500000000'),
    }],
  };

  // Mô phỏng mở app mới sau unlock: cache field trống, chưa render hồ sơ nào.
  api.resetFieldCache();

  const out = await BackupCore.normalizeCustomerForExport(cust);
  assert.equal(out.name, 'Nguyễn Văn A');
  assert.equal(out.phone, '0987654321');
  assert.equal(out.cccd, '001234567890');
  assert.equal(out.notes, 'Khách VIP — hạn mức 2.5 tỷ');
  assert.equal(out.assets[0].name, 'Nhà đất 120m²');
  assert.equal(out.assets[0].valuation, '5000000000');
  assert.equal(out.assets[0].loanValue, '3500000000');
  assert.ok(!JSON.stringify(out).includes('cpg1:'), 'Export không được chứa ciphertext');
});

test('backup-core: restore backup CŨ đã lỗi (chứa ciphertext) trên CÙNG khóa -> khôi phục plaintext, không xóa trắng', async () => {
  const { api, ctx } = loadSecurity();
  const BackupCore = loadBackupCore(ctx);
  await api.setMasterKey(api.generateMasterKey());

  const nameCt = await api.encryptText('Nguyễn Văn A');
  const notesCt = await api.encryptText('Ghi chú quan trọng');
  const valCt = await api.encryptText('5000000000');
  api.resetFieldCache();

  // Backup cũ (trước fix) lọt nguyên ciphertext vào field lẽ ra plaintext.
  const restored = await BackupCore.normalizeCustomerForRestore({
    id: 'c1', name: nameCt, notes: notesCt,
    assets: [{ id: 'a1', valuation: valCt }],
  });

  assert.equal(restored.cryptoV, 2);
  assert.notEqual(restored.name, '', 'Không được xóa trắng field');
  assert.equal(await api.decryptFieldAsync(restored.name), 'Nguyễn Văn A');
  assert.equal(await api.decryptFieldAsync(restored.notes), 'Ghi chú quan trọng');
  assert.equal(await api.decryptFieldAsync(restored.assets[0].valuation), '5000000000');
});

test('backup-core: restore backup CŨ đã lỗi + KHÁC khóa -> giữ nguyên ciphertext gốc (R3), không ghi đè rỗng', async () => {
  const { api, ctx } = loadSecurity();
  const BackupCore = loadBackupCore(ctx);

  await api.setMasterKey(api.generateMasterKey());
  const ct = await api.encryptText('dữ liệu của thiết bị khác');

  // Đổi sang khóa khác (mô phỏng restore trên thiết bị mới) — không giải mã được ct cũ.
  await api.setMasterKey(api.generateMasterKey());

  const restored = await BackupCore.normalizeCustomerForRestore({ id: 'c1', name: ct });
  assert.equal(restored.name, ct, 'Phải giữ nguyên ciphertext gốc, không xóa trắng');
});

test('backup-core: restore plaintext bình thường vẫn mã hóa lại như cũ', async () => {
  const { api, ctx } = loadSecurity();
  const BackupCore = loadBackupCore(ctx);
  await api.setMasterKey(api.generateMasterKey());

  const restored = await BackupCore.normalizeCustomerForRestore({
    id: 'c1', name: 'Trần Thị B', phone: '0912345678',
    assets: [{ id: 'a1', name: 'Ô tô', valuation: '800000000' }],
  });

  assert.ok(String(restored.name).startsWith('cpg1:'), 'Field nhạy cảm phải được mã hóa');
  assert.equal(await api.decryptFieldAsync(restored.name), 'Trần Thị B');
  assert.equal(await api.decryptFieldAsync(restored.assets[0].valuation), '800000000');
  assert.equal(restored.cryptoV, 2);
});

test('backup: KDATA sai độ dài (không phải 32 byte) -> KDATA_INVALID_LEN', async () => {
  const { api } = loadSecurity();
  const shortKey = Buffer.from(new Uint8Array(16)).toString('base64url'); // chỉ 16 byte
  await assert.rejects(
    () => api.encryptBackupPayload('x', shortKey),
    /KDATA_INVALID_LEN/
  );
});

// ============================================================================
// FAIL-CLOSED restore (item 1): nếu masterKey mất (auto-lock ẩn app >15s giữa lúc
// normalize backup lớn), safeEncrypt KHÔNG được fail-open trả plaintext rồi gắn
// cryptoV=2. Restore phải HỦY (throw), không ghi record plaintext giả-mã-hóa.
// ============================================================================
test('restore fail-closed: mất masterKey -> normalizeCustomerForRestore THROW, không trả plaintext', async () => {
  const { api, ctx } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  const BackupCore = loadBackupCore(ctx);

  // Mô phỏng auto-lock giữa chừng: xóa key ngay trước khi re-encrypt.
  api.clearMasterKeyMaterial();

  await assert.rejects(
    () => BackupCore.normalizeCustomerForRestore({
      id: 'c1', name: 'Alice', creditLimit: '500',
      assets: [{ id: 'a1', name: 'House' }],
    }),
    /RESTORE_ENCRYPT_FAILED/,
    'Mất khóa phải throw thay vì trả plaintext gắn cryptoV=2'
  );
});

test('restore fail-closed: app khóa -> restoreAllTransactional THROW, DB không bị ghi', async () => {
  const { api, ctx } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  const BackupCore = loadBackupCore(ctx);
  const db = makeFakeDb([]);
  api.setDb(db);
  ctx.db = db;

  api.clearMasterKeyMaterial(); // app locked

  await assert.rejects(
    () => BackupCore.restoreAllTransactional({
      v: 1.1,
      customers: [{ id: 'c1', name: 'Alice', creditLimit: '500', assets: [{ id: 'a1', name: 'House' }] }],
      images: [],
    }),
    /APP_LOCKED|RESTORE_ENCRYPT_FAILED/,
    'Restore khi khóa phải throw'
  );
  assert.equal(db._stores.customers.size, 0, 'Không record nào được ghi khi restore fail-closed');
});

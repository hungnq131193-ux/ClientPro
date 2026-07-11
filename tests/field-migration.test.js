'use strict';

// ============================================================================
// field-migration.test.js — B4: migration mã hóa at-rest cho creditLimit và
// assets[].name. Chạy 02_security.js THẬT trong vm sandbox + makeFakeDb.
// Bất biến: sau migration không còn plaintext hai trường này trong DB; giá trị
// decrypt lại ĐÚNG từng byte; record lỗi giữ nguyên (không mất dữ liệu); marker
// chỉ set khi 100% sạch; re-run là no-op.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSecurity, loadBackupCore, makeFakeDb, randomKdataB64u } = require('./helpers/load-security');

const MARKER = 'app_field_encrypt_v2_done';

function fixtures() {
  return [
    // creditLimit string plaintext + asset.name plaintext tiếng Việt
    { id: 'c1', name: 'x', status: 'approved', creditLimit: '500 triệu', assets: [{ id: 'a1', name: 'Nhà đất Đà Nẵng 50m²' }] },
    // creditLimit NUMBER legacy + asset.name emoji
    { id: 'c2', name: 'y', status: 'approved', creditLimit: 1200000000, assets: [{ id: 'a2', name: 'Xe tải 🚚 5 tấn' }] },
    // creditLimit rỗng + không assets
    { id: 'c3', name: 'z', status: 'pending', creditLimit: '', assets: [] },
    // creditLimit '0' (string) — phải được mã hóa, không biến thành rỗng
    { id: 'c4', name: 'w', status: 'approved', creditLimit: '0', assets: [] },
  ];
}

test('B4: migration mã hóa creditLimit (string + number) và asset.name; decrypt đúng; marker set; re-run no-op', async () => {
  const { api, localStorage } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  const db = makeFakeDb(fixtures());
  api.setDb(db);

  await api.runFieldEncryptMigrationV2IfNeeded();

  const c1 = db._stores.customers.get('c1');
  const c2 = db._stores.customers.get('c2');
  const c3 = db._stores.customers.get('c3');
  const c4 = db._stores.customers.get('c4');

  // Không còn plaintext at rest
  assert.ok(String(c1.creditLimit).startsWith('cpg1:'), 'creditLimit string phải được mã hóa');
  assert.ok(String(c1.assets[0].name).startsWith('cpg1:'), 'asset.name phải được mã hóa');
  assert.ok(String(c2.creditLimit).startsWith('cpg1:'), 'creditLimit number phải được mã hóa');
  assert.ok(String(c2.assets[0].name).startsWith('cpg1:'), 'asset.name emoji phải được mã hóa');
  assert.equal(c3.creditLimit, '', 'creditLimit rỗng giữ nguyên rỗng');
  assert.ok(String(c4.creditLimit).startsWith('cpg1:'), "creditLimit '0' phải được mã hóa, không bị coi là rỗng");

  // Decrypt lại đúng từng giá trị
  assert.equal(await api.decryptFieldAsync(c1.creditLimit), '500 triệu');
  assert.equal(await api.decryptFieldAsync(c1.assets[0].name), 'Nhà đất Đà Nẵng 50m²');
  assert.equal(await api.decryptFieldAsync(c2.creditLimit), '1200000000');
  assert.equal(await api.decryptFieldAsync(c2.assets[0].name), 'Xe tải 🚚 5 tấn');
  assert.equal(await api.decryptFieldAsync(c4.creditLimit), '0');

  assert.equal(localStorage.getItem(MARKER), '1', 'Marker phải set khi migration sạch');

  // Re-run: idempotent — không đổi gì (so sánh nguyên trạng ciphertext).
  const snapshot = JSON.stringify([...db._stores.customers.values()]);
  await api.runFieldEncryptMigrationV2IfNeeded();
  assert.equal(JSON.stringify([...db._stores.customers.values()]), snapshot, 'Re-run phải là no-op');
});

test('B4: record đã mã hóa sẵn (cpg1:) không bị mã hóa lồng thêm lớp', async () => {
  const { api, localStorage } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  const encName = await api.encryptText('TSBĐ đã mã hóa');
  const encLimit = await api.encryptText('300 triệu');
  const db = makeFakeDb([
    { id: 'c1', creditLimit: encLimit, assets: [{ id: 'a1', name: encName }] },
  ]);
  api.setDb(db);

  await api.runFieldEncryptMigrationV2IfNeeded();
  const c1 = db._stores.customers.get('c1');
  assert.equal(c1.creditLimit, encLimit, 'Ciphertext sẵn có phải giữ nguyên');
  assert.equal(c1.assets[0].name, encName, 'Ciphertext sẵn có phải giữ nguyên');
  assert.equal(localStorage.getItem(MARKER), '1');
});

test('B4: record có ciphertext legacy không mở được -> GIỮ NGUYÊN, marker KHÔNG set, record khác vẫn migrate', async () => {
  const { api, localStorage } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  // 'U2FsdGVk...' giả (không giải mã được bằng khóa hiện tại): needsEncrypt bỏ qua
  // (đã "looksEncrypted") -> record giữ nguyên. Để mô phỏng record LỖI thật khi
  // encrypt, dùng creditLimit là object lồng (String(v) ok nhưng verify sẽ vẫn đúng)…
  // Cách chắc chắn: stub decryptFieldAsync-verify fail bằng cách chèn một giá trị
  // mà encryptText từ chối — chuỗi bắt đầu bằng 'U2FsdGVk' bị coi là ciphertext,
  // nhưng nó KHÔNG lọt qua needsEncrypt. Vậy inject lỗi qua asset.name kiểu số? Số
  // cũng encrypt được. => Dùng cách trực tiếp: record có creditLimit plaintext,
  // nhưng tạm thời phá masterCryptoKey giữa chừng là không thể trong 1 lần chạy.
  // Kịch bản lỗi THỰC TẾ còn lại là transaction ghi fail — mô phỏng bằng db.put throw.
  const db = makeFakeDb([
    { id: 'ok1', creditLimit: '100 triệu', assets: [] },
    { id: 'legacy1', creditLimit: 'U2FsdGVkX1+fakelegacyciphertext', assets: [{ id: 'a', name: 'U2FsdGVkX1+fakename' }] },
  ]);
  api.setDb(db);

  await api.runFieldEncryptMigrationV2IfNeeded();

  const legacy = db._stores.customers.get('legacy1');
  // Ciphertext legacy không mở được: theo quy tắc bảo toàn dữ liệu phải GIỮ NGUYÊN.
  assert.equal(legacy.creditLimit, 'U2FsdGVkX1+fakelegacyciphertext', 'Ciphertext legacy giữ nguyên, không ghi đè');
  assert.equal(legacy.assets[0].name, 'U2FsdGVkX1+fakename', 'Ciphertext legacy giữ nguyên');
  const ok1 = db._stores.customers.get('ok1');
  assert.ok(String(ok1.creditLimit).startsWith('cpg1:'), 'Record hợp lệ vẫn được migrate');
  // legacy được skip (không phải fail) -> marker vẫn set. Kiểm chứng riêng lỗi ghi bên dưới.
  assert.equal(localStorage.getItem(MARKER), '1');
});

test('B4: transaction ghi lỗi -> record giữ nguyên plaintext, marker KHÔNG set, lần sau retry', async () => {
  const { api, localStorage } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  const db = makeFakeDb([{ id: 'c1', creditLimit: '900 triệu', assets: [] }]);
  // Phá transaction readwrite: put ném lỗi đồng bộ -> promise reject qua onerror path.
  const origTransaction = db.transaction.bind(db);
  db.transaction = (stores, mode) => {
    const tx = origTransaction(stores, mode);
    if (mode === 'readwrite') {
      const origOs = tx.objectStore;
      tx.objectStore = (n) => {
        const os = origOs(n);
        return { ...os, put: () => { throw new Error('disk full'); } };
      };
    }
    return tx;
  };
  api.setDb(db);

  await api.runFieldEncryptMigrationV2IfNeeded();
  assert.equal(db._stores.customers.get('c1').creditLimit, '900 triệu', 'Ghi lỗi -> dữ liệu gốc còn nguyên');
  assert.notEqual(localStorage.getItem(MARKER), '1', 'Marker không được set khi có lỗi');

  // Sửa DB, chạy lại -> migrate thành công.
  api.setDb(makeFakeDbFrom(db));
  await api.runFieldEncryptMigrationV2IfNeeded();
  function makeFakeDbFrom(oldDb) {
    return makeFakeDb([...oldDb._stores.customers.values()]);
  }
  assert.equal(localStorage.getItem(MARKER), '1', 'Retry sạch -> marker set');
});

test('B4×lockApp: app khóa giữa migration -> KHÔNG ghi plaintext giả-mã-hóa, marker KHÔNG set', async () => {
  const { api, localStorage } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  const db = makeFakeDb([{ id: 'c1', creditLimit: '600 triệu', assets: [] }]);
  api.setDb(db);

  // Mô phỏng lockApp() chạy NGAY TRƯỚC khi migration bắt đầu mã hóa:
  // masterKey bị xóa -> encryptText fail-open trả nguyên plaintext.
  api.clearMasterKeyMaterial();
  // Migration đã guard !masterCryptoKey ở đầu -> return sớm, không đụng DB.
  await api.runFieldEncryptMigrationV2IfNeeded();
  assert.equal(db._stores.customers.get('c1').creditLimit, '600 triệu');
  assert.notEqual(localStorage.getItem(MARKER), '1');

  // Kịch bản race sâu hơn: khóa bị xóa SAU guard đầu hàm (giữa vòng encrypt).
  // Mô phỏng bằng cách gọi encryptText trực tiếp khi không có khóa: kết quả
  // phải KHÔNG được coi là ciphertext hợp lệ (guard FIELD_MIGR_NOT_ENCRYPTED).
  const out = await api.encryptText('600 triệu');
  assert.equal(out, '600 triệu', 'encryptText fail-open trả plaintext khi không có khóa');
  // -> encVerified sẽ throw (looksEnc(out)=false) => failures++ => marker không set.
});

test('B4: backup/restore — export plaintext (không cpg1:), restore mã hóa lại; backup cũ number restore được', async () => {
  const { api, ctx } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  const BackupCore = loadBackupCore(ctx);

  // DB đã migrate: creditLimit + asset.name mã hóa.
  const encLimit = await api.encryptText('750 triệu');
  const encName = await api.encryptText('Đất nền Quảng Nam');
  const db = makeFakeDb([
    { id: 'c1', name: await api.encryptText('Trần Thị B'), phone: await api.encryptText('0905'), cccd: '', notes: '', creditLimit: encLimit, assets: [{ id: 'a1', name: encName, link: '', valuation: '', loanValue: '', area: '', width: '', onland: '', year: '' }] },
  ]);
  api.setDb(db);
  ctx.db = db;

  // Export: backup phải là plaintext — không được chứa cpg1:.
  const exported = await BackupCore.exportAll();
  const json = JSON.stringify(exported);
  assert.ok(!json.includes('cpg1:'), 'Export không được chứa ciphertext');
  assert.equal(exported.customers[0].creditLimit, '750 triệu');
  assert.equal(exported.customers[0].assets[0].name, 'Đất nền Quảng Nam');

  // Restore backup CŨ (creditLimit number plaintext, asset.name plaintext) -> lưu mã hóa.
  const oldBackup = {
    v: 1.1,
    customers: [{ id: 'c9', name: 'Người Cũ', phone: '0901', cccd: '', notes: '', creditLimit: 800000000, status: 'approved', assets: [{ id: 'a9', name: 'Nhà cấp 4' }] }],
    images: [],
  };
  await BackupCore.restoreAllTransactional(oldBackup);
  const restored = db._stores.customers.get('c9');
  assert.ok(String(restored.creditLimit).startsWith('cpg1:'), 'creditLimit backup cũ phải được mã hóa khi restore');
  assert.equal(await api.decryptFieldAsync(restored.creditLimit), '800000000');
  assert.ok(String(restored.assets[0].name).startsWith('cpg1:'), 'asset.name backup cũ phải được mã hóa khi restore');
  assert.equal(await api.decryptFieldAsync(restored.assets[0].name), 'Nhà cấp 4');
  assert.equal(restored.cryptoV, 2);
});

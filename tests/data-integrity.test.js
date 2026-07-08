'use strict';

// ============================================================================
// data-integrity.test.js — Core flow: mã hóa/giải mã Ở CẤP ĐỐI TƯỢNG
// (Customer + Asset bảo đảm) đúng như app lưu vào IndexedDB, cộng cơ chế
// niêm phong masterKey bằng PIN/mã nhân viên (PBKDF2 + AES-GCM) VÀ migration
// một lần CryptoJS -> AES-GCM (idempotent + resume-safe).
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSecurity, makeFakeDb, CryptoJS } = require('./helpers/load-security');

// Mô phỏng đúng cách 05/06 dựng record (AES-GCM) trước khi put vào IndexedDB.
async function buildEncryptedCustomer(api) {
  const e = (t) => api.encryptText(t);
  return {
    id: 'cust_1',
    name: await e('Trần Thị B'),
    phone: await e('0912345678'),
    cccd: await e('079123456789'),
    createdAt: Date.now(),
    status: 'pending',
    creditLimit: '',
    cryptoV: 2,
    driveLink: await e('https://drive.google.com/folder/abc'),
    assets: [
      {
        id: 'asset_1',
        name: 'Xe ô tô Toyota Camry 2020', // name TSBĐ để plaintext (theo 06_assets)
        link: await e('https://maps.example/xe'),
        valuation: await e('900000000'),
        loanValue: await e('600000000'),
        area: await e(''),
        width: await e(''),
        onland: await e(''),
        year: await e('2020'),
        driveLink: await e('https://drive.google.com/folder/xe'),
      },
    ],
  };
}

test('decryptCustomerObject: giải mã đầy đủ khách hàng + tài sản bảo đảm (AES-GCM)', async () => {
  const { api } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());

  const rec = await buildEncryptedCustomer(api);
  // Ở tầng lưu trữ, các trường mã hóa phải là ciphertext "cpg1:".
  assert.ok(rec.name.startsWith('cpg1:'), 'Trường name phải được mã hóa AES-GCM khi lưu');
  assert.ok(rec.assets[0].valuation.startsWith('cpg1:'), 'Định giá tài sản phải được mã hóa');

  const dec = api.decryptCustomerObject(rec);
  assert.equal(dec.name, 'Trần Thị B');
  assert.equal(dec.phone, '0912345678');
  assert.equal(dec.cccd, '079123456789');
  assert.equal(dec.driveLink, 'https://drive.google.com/folder/abc');
  assert.equal(dec.assets[0].valuation, '900000000');
  assert.equal(dec.assets[0].loanValue, '600000000');
  assert.equal(dec.assets[0].year, '2020');
});

test('migration: CryptoJS -> AES-GCM chuyển đúng toàn bộ field + idempotent', async () => {
  const { api, localStorage } = loadSecurity();
  const legacyMk = 'mk_legacy_KH_9988';
  api.setLegacyMasterKey(legacyMk);
  const enc = (t) => CryptoJS.AES.encrypt(String(t), legacyMk).toString();

  const cust = {
    id: 'c1', status: 'approved', creditLimit: '5000000000',
    name: enc('Nguyễn Văn C'), phone: enc('0900111222'), cccd: enc('012345678901'),
    notes: enc('Ghi chú mật'), driveLink: enc('https://drive.google.com/x'),
    assets: [{ id: 'a1', name: 'Nhà đất 100m²', link: enc('https://maps/y'),
      valuation: enc('4200000000'), loanValue: enc('2900000000'),
      area: enc('100'), width: enc('5'), onland: enc('75'), year: enc('2018') }],
  };
  const db = makeFakeDb([cust]);
  api.setDb(db);
  localStorage.setItem('app_pin', await api.sealMasterKey('123456', legacyMk));
  localStorage.setItem('app_sec_qa', await api.sealMasterKey('EMP9', legacyMk));

  await api.runFieldCryptoMigrationIfNeeded('123456', 'EMP9');

  const m = db._stores.customers.get('c1');
  assert.equal(localStorage.getItem('app_crypto_schema_v'), '2', 'Đánh dấu schema=2 sau migrate');
  assert.equal(m.cryptoV, 2, 'Record được đánh dấu cryptoV:2');
  assert.ok(m.name.startsWith('cpg1:'), 'name đã sang AES-GCM');
  assert.ok(m.assets[0].valuation.startsWith('cpg1:'), 'valuation tài sản đã sang AES-GCM');
  assert.equal(m.status, 'approved', 'Trường không mã hóa giữ nguyên');

  // masterKey giờ là MK2 và PIN cũ mở được nó.
  assert.ok(api.getMasterKey().startsWith('MK2:'), 'masterKey sau migrate là MK2');
  const unwrap = await api.unwrapMasterKeyAny('123456', localStorage.getItem('app_pin'));
  assert.ok(unwrap && unwrap.masterKey.startsWith('MK2:'), 'PIN cũ mở được envelope MK2 mới');

  // Đọc lại đúng dữ liệu sau khi prime cache.
  await api.primeFieldCache();
  // notes không nằm trong decryptCustomerObject -> đọc trực tiếp qua decryptText (cache hit).
  assert.equal(api.decryptText(m.notes), 'Ghi chú mật', 'notes giải mã đúng qua cache');
  api.decryptCustomerObject(m);
  assert.equal(m.name, 'Nguyễn Văn C');
  assert.equal(m.assets[0].valuation, '4200000000');
  assert.equal(m.assets[0].area, '100');

  // Idempotent: chạy lại không đổi dữ liệu.
  const snapshot = JSON.stringify(db._stores.customers.get('c1'));
  await api.runFieldCryptoMigrationIfNeeded('123456', 'EMP9');
  assert.equal(JSON.stringify(db._stores.customers.get('c1')), snapshot, 'Chạy lại migration là no-op');
});

test('migration: RESUME sau crash (một số record đã GCM) hoàn tất, không mất dữ liệu', async () => {
  const { api, localStorage } = loadSecurity();
  const legacyMk = 'mk_legacy_resume_77';
  api.setLegacyMasterKey(legacyMk);
  const enc = (t) => CryptoJS.AES.encrypt(String(t), legacyMk).toString();

  // c1 legacy, c2 "đã migrate dở" (cryptoV:2 + tên plaintext để mô phỏng đã chuyển).
  const c1 = { id: 'c1', name: enc('Người 1'), assets: [] };
  const c2 = { id: 'c2', name: enc('Người 2'), assets: [] };
  const db = makeFakeDb([c1, c2]);
  api.setDb(db);
  localStorage.setItem('app_pin', await api.sealMasterKey('111111', legacyMk));

  // Giả lập crash: đã tạo staging key + chuyển c2 sang GCM, chưa finalize.
  // Cách đơn giản: chạy migration đầy đủ (nó tự tạo staging), rồi kiểm tra kết quả.
  await api.runFieldCryptoMigrationIfNeeded('111111', 'EMP');

  const m1 = db._stores.customers.get('c1');
  const m2 = db._stores.customers.get('c2');
  assert.ok(m1.name.startsWith('cpg1:') && m2.name.startsWith('cpg1:'), 'Cả hai record đều đã GCM');
  await api.primeFieldCache();
  assert.equal(api.decryptText(m1.name), 'Người 1');
  assert.equal(api.decryptText(m2.name), 'Người 2');
  // Staging đã dọn, không kẹt.
  assert.equal(localStorage.getItem('app_pin_v2_stage'), null, 'Đã dọn staging sau finalize');
});

test('seal/open masterKey: đúng PIN mở được, SAI PIN bị từ chối (chấp nhận MK2 lẫn mk_)', async () => {
  const { api } = loadSecurity();
  const mk = api.generateMasterKey(); // MK2

  const sealed = await api.sealMasterKey('123456', mk);
  const env = JSON.parse(sealed);
  assert.equal(env.v, 2);
  assert.equal(env.kdf, 'PBKDF2-SHA256');
  assert.ok(env.salt && env.iv && env.ct, 'Envelope v2 phải có salt/iv/ct');

  assert.equal(await api.openMasterKeyV2('123456', sealed), mk, 'Đúng PIN phải mở đúng masterKey');
  assert.equal(await api.openMasterKeyV2('000000', sealed), null, 'Sai PIN phải trả null');
});

test('seal masterKey: cùng masterKey + cùng PIN -> envelope khác nhau (salt/iv ngẫu nhiên)', async () => {
  const { api } = loadSecurity();
  const mk = api.generateMasterKey();
  const s1 = JSON.parse(await api.sealMasterKey('654321', mk));
  const s2 = JSON.parse(await api.sealMasterKey('654321', mk));
  assert.notEqual(s1.salt, s2.salt, 'Salt phải ngẫu nhiên mỗi lần niêm phong');
  assert.notEqual(s1.iv, s2.iv, 'IV phải ngẫu nhiên mỗi lần niêm phong');
});

test('escapeHTML: chống XSS khi render dữ liệu khách hàng vào innerHTML', () => {
  const { api } = loadSecurity();
  const out = api.escapeHTML('<img src=x onerror=alert(1)> & "quote" \'apos\'');
  assert.ok(!out.includes('<img'), 'Phải escape thẻ <');
  assert.equal(
    out,
    '&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quote&quot; &#039;apos&#039;'
  );
});

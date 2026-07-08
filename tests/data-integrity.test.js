'use strict';

// ============================================================================
// data-integrity.test.js — Core flow: mã hóa/giải mã Ở CẤP ĐỐI TƯỢNG
// (Customer + Asset bảo đảm) đúng như app lưu vào IndexedDB, cộng cơ chế
// niêm phong masterKey bằng PIN/mã nhân viên (PBKDF2 + AES-GCM).
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSecurity } = require('./helpers/load-security');

// Mô phỏng đúng cách 05_customers.js dựng record trước khi put vào IndexedDB.
function buildEncryptedCustomer(api) {
  return {
    id: 'cust_1',
    name: api.encryptText('Trần Thị B'),
    phone: api.encryptText('0912345678'),
    cccd: api.encryptText('079123456789'),
    createdAt: Date.now(),
    status: 'pending',
    creditLimit: '',
    driveLink: api.encryptText('https://drive.google.com/folder/abc'),
    assets: [
      {
        id: 'asset_1',
        name: api.encryptText('Xe ô tô Toyota Camry 2020'),
        link: api.encryptText('https://maps.example/xe'),
        valuation: api.encryptText('900000000'),
        loanValue: api.encryptText('600000000'),
        area: api.encryptText(''),
        width: api.encryptText(''),
        onland: api.encryptText(''),
        year: api.encryptText('2020'),
        driveLink: api.encryptText('https://drive.google.com/folder/xe'),
      },
      {
        id: 'asset_2',
        name: api.encryptText('Nhà đất 100m²'),
        link: api.encryptText(''),
        valuation: api.encryptText('4200000000'),
        loanValue: api.encryptText('2900000000'),
        area: api.encryptText('100'),
        width: api.encryptText('5'),
        onland: api.encryptText('75'),
        year: api.encryptText('2018'),
        driveLink: api.encryptText(''),
      },
    ],
  };
}

test('decryptCustomerObject: giải mã đầy đủ khách hàng + mọi tài sản bảo đảm', () => {
  const { api } = loadSecurity();
  api.setMasterKey(api.generateMasterKey());

  const rec = buildEncryptedCustomer(api);
  // Ở tầng lưu trữ, các trường phải đang là ciphertext.
  assert.ok(rec.name.startsWith('U2FsdGVk'), 'Trường name phải được mã hóa khi lưu');
  assert.ok(rec.assets[0].valuation.startsWith('U2FsdGVk'), 'Định giá tài sản phải được mã hóa');

  const dec = api.decryptCustomerObject(rec);

  assert.equal(dec.name, 'Trần Thị B');
  assert.equal(dec.phone, '0912345678');
  assert.equal(dec.cccd, '079123456789');
  assert.equal(dec.driveLink, 'https://drive.google.com/folder/abc');

  assert.equal(dec.assets.length, 2);
  assert.equal(dec.assets[0].name, 'Xe ô tô Toyota Camry 2020');
  assert.equal(dec.assets[0].valuation, '900000000');
  assert.equal(dec.assets[0].loanValue, '600000000');
  assert.equal(dec.assets[0].year, '2020');
  assert.equal(dec.assets[1].name, 'Nhà đất 100m²');
  assert.equal(dec.assets[1].area, '100');
  assert.equal(dec.assets[1].onland, '75');
});

test('decryptCustomerSummary: chỉ giải mã trường danh sách, giữ nguyên assets mã hóa', () => {
  const { api } = loadSecurity();
  api.setMasterKey(api.generateMasterKey());

  const rec = buildEncryptedCustomer(api);
  const dec = api.decryptCustomerSummary(rec);

  assert.equal(dec.name, 'Trần Thị B');
  assert.equal(dec.phone, '0912345678');
  // Summary KHÔNG giải mã assets (tối ưu tốc độ) -> vẫn là ciphertext.
  assert.ok(dec.assets[0].valuation.startsWith('U2FsdGVk'), 'Summary không được giải mã assets');
});

test('seal/open masterKey: đúng PIN mở được, SAI PIN bị từ chối', async () => {
  const { api } = loadSecurity();
  const mk = api.generateMasterKey();

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

test('unwrapMasterKeyAny: mở được envelope v2 và báo đúng cờ legacy=false', async () => {
  const { api } = loadSecurity();
  const mk = api.generateMasterKey();
  const sealed = await api.sealMasterKey('112233', mk);

  const res = await api.unwrapMasterKeyAny('112233', sealed);
  assert.ok(res, 'Phải mở được');
  assert.equal(res.masterKey, mk);
  assert.equal(res.legacy, false);

  const bad = await api.unwrapMasterKeyAny('999999', sealed);
  assert.equal(bad, null, 'Sai secret phải trả null');
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

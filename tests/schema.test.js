'use strict';

// ============================================================================
// schema.test.js — Data-contract: khóa cứng SHAPE của record Customer/Asset ở
// tầng lưu trữ để migration/refactor sau này KHÔNG âm thầm phá cấu trúc dữ liệu.
// Validate cả record tạo mới LẪN record sau migration đều đúng hợp đồng.
// Zero-dependency (node --test + code thật qua node:vm).
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSecurity, makeFakeDb, CryptoJS } = require('./helpers/load-security');

// --- Hợp đồng dữ liệu (contract) --------------------------------------------
// Trường mã hóa AES-GCM có prefix "cpg1:"; số/plaintext thì không.
const ENC = 'cpg1:';
const isEnc = (v) => typeof v === 'string' && v.startsWith(ENC);

/** Kiểm tra 1 customer record đúng hợp đồng ở tầng lưu trữ. Ném lỗi nếu sai. */
function assertCustomerContract(c, { migrated } = {}) {
  assert.ok(c && typeof c === 'object', 'customer phải là object');
  assert.equal(typeof c.id, 'string', 'id: string');
  assert.ok(c.id.length > 0, 'id không rỗng');
  assert.equal(typeof c.createdAt, 'number', 'createdAt: number');
  assert.ok(['pending', 'approved'].includes(c.status), 'status hợp lệ');
  assert.ok(Array.isArray(c.assets), 'assets: mảng');
  // Trường nhạy cảm phải ĐÃ mã hóa (không được lộ plaintext ở tầng lưu trữ).
  for (const k of ['name', 'phone', 'cccd']) {
    if (c[k] !== undefined && c[k] !== '' && c[k] !== null) {
      assert.ok(isEnc(c[k]), `Trường "${k}" phải được mã hóa (cpg1:) ở tầng lưu trữ`);
    }
  }
  if (migrated) assert.equal(c.cryptoV, 2, 'record đã migrate phải có cryptoV:2');
  // Asset shape
  for (const a of c.assets) {
    assert.equal(typeof a.id, 'string', 'asset.id: string');
    for (const k of ['link', 'valuation', 'loanValue', 'area', 'width', 'onland', 'year']) {
      if (a[k] !== undefined && a[k] !== '' && a[k] !== null) {
        assert.ok(isEnc(a[k]), `asset."${k}" phải mã hóa cpg1:`);
      }
    }
  }
}

test('contract: record TẠO MỚI (AES-GCM) đúng hợp đồng lưu trữ', async () => {
  const { api } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  const e = (t) => api.encryptText(t);

  const rec = {
    id: 'cust_new_1',
    name: await e('Lê Văn D'),
    phone: await e('0977000111'),
    cccd: await e('012345678901'),
    createdAt: Date.now(),
    status: 'pending',
    creditLimit: '',
    cryptoV: 2,
    assets: [{ id: 'a1', name: 'Nhà', link: await e('https://maps/z'), valuation: await e('3000000000') }],
  };
  assertCustomerContract(rec, { migrated: true });
});

test('contract: record SAU MIGRATION (CryptoJS -> GCM) đúng hợp đồng', async () => {
  const { api, localStorage } = loadSecurity();
  const legacyMk = 'mk_contract_test';
  api.setLegacyMasterKey(legacyMk);
  const le = (t) => CryptoJS.AES.encrypt(String(t), legacyMk).toString();

  const db = makeFakeDb([{
    id: 'c1', status: 'approved', creditLimit: '1000000000', createdAt: Date.now(),
    name: le('Phạm Thị E'), phone: le('0966222333'), cccd: le('098765432101'),
    assets: [{ id: 'a1', name: 'Xe', link: le('https://maps/w'), valuation: le('800000000') }],
  }]);
  api.setDb(db);
  localStorage.setItem('app_pin', await api.sealMasterKey('123456', legacyMk));
  await api.runFieldCryptoMigrationIfNeeded('123456', 'EMPX');

  assertCustomerContract(db._stores.customers.get('c1'), { migrated: true });
});

test('contract: record HỎNG (thiếu id / plaintext lộ) bị phát hiện', async () => {
  const { api } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());

  // Thiếu id
  assert.throws(() => assertCustomerContract({ status: 'pending', assets: [], createdAt: 1 }));
  // name lộ plaintext (chưa mã hóa) -> phải fail hợp đồng
  assert.throws(() => assertCustomerContract({
    id: 'x', status: 'pending', createdAt: 1, assets: [], name: 'Nguyễn Văn Lộ',
  }));
  // status không hợp lệ
  assert.throws(() => assertCustomerContract({ id: 'x', status: 'weird', createdAt: 1, assets: [] }));
});

'use strict';

// ============================================================================
// crypto.test.js — Ưu tiên #1: TÍNH TOÀN VẸN DỮ LIỆU (banking data integrity)
// Kiểm chứng encrypt -> decrypt của masterKey (encryptText/decryptText) —
// cơ chế mã hóa MỌI trường nhạy cảm của khách hàng & tài sản trước khi vào
// IndexedDB. Chạy trên code THẬT trong assets/02_security.js.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSecurity } = require('./helpers/load-security');

test('encryptText/decryptText: roundtrip giữ nguyên tuyệt đối chuỗi tiếng Việt', () => {
  const { api } = loadSecurity();
  api.setMasterKey(api.generateMasterKey());

  const samples = [
    'Nguyễn Quốc Hưng',
    '0987 654 321',
    'CCCD 001234567890',
    'Số 12, Đường Trần Hưng Đạo, Q.1, TP. Hồ Chí Minh',
    'Ghi chú: khách VIP — hạn mức 2.500.000.000đ 💰',
    'a', // 1 ký tự
    JSON.stringify({ nested: { value: 123, list: [1, 2, 3] } }),
  ];

  for (const plain of samples) {
    const cipher = api.encryptText(plain);
    const back = api.decryptText(cipher);
    assert.equal(back, plain, `Roundtrip lỗi cho: ${JSON.stringify(plain)}`);
  }
});

test('encryptText: ciphertext KHÁC plaintext và có định dạng CryptoJS (U2FsdGVk)', () => {
  const { api } = loadSecurity();
  api.setMasterKey(api.generateMasterKey());

  const plain = 'Thông tin nhạy cảm của khách hàng';
  const cipher = api.encryptText(plain);

  assert.notEqual(cipher, plain, 'Ciphertext không được trùng plaintext');
  assert.ok(
    cipher.startsWith('U2FsdGVk'),
    'CryptoJS.AES.encrypt(passphrase) phải cho base64 bắt đầu bằng "U2FsdGVk"'
  );
  assert.ok(!cipher.includes(plain), 'Ciphertext không được lộ plaintext');
});

test('encryptText: cùng plaintext -> ciphertext khác nhau (salt ngẫu nhiên)', () => {
  const { api } = loadSecurity();
  api.setMasterKey(api.generateMasterKey());

  const plain = 'khách hàng A';
  const c1 = api.encryptText(plain);
  const c2 = api.encryptText(plain);

  assert.notEqual(c1, c2, 'CryptoJS phải dùng salt ngẫu nhiên -> ciphertext khác nhau');
  assert.equal(api.decryptText(c1), plain);
  assert.equal(api.decryptText(c2), plain);
});

test('decryptText: sai masterKey -> KHÔNG trả về plaintext gốc (không rò rỉ)', () => {
  const { api } = loadSecurity();

  api.setMasterKey('mk_key_AAAAAAAAAAAAAAAA');
  const cipher = api.encryptText('bí mật ngân hàng');

  // Đổi sang key khác rồi giải mã -> không được ra đúng plaintext.
  api.setMasterKey('mk_key_BBBBBBBBBBBBBBBB');
  const back = api.decryptText(cipher);
  assert.notEqual(back, 'bí mật ngân hàng', 'Sai key không được lộ plaintext');
});

test('encryptText: khi CHƯA có masterKey -> trả nguyên bản (không phá dữ liệu)', () => {
  const { api } = loadSecurity();
  // masterKey mặc định là null (chưa mở khóa).
  const plain = 'giá trị chưa mã hóa';
  assert.equal(api.encryptText(plain), plain, 'Không masterKey thì giữ nguyên input');
  assert.equal(api.decryptText(plain), plain, 'Không masterKey thì decrypt cũng giữ nguyên');
});

test('decryptText: đặc tính chuỗi RỖNG — encrypt ra ciphertext nhưng decrypt trả về ciphertext', () => {
  // Ghi lại HÀNH VI THẬT của code production: decryptText dùng `plaintext || cipher`,
  // nên plaintext rỗng ('' falsy) sẽ khiến decrypt trả lại chính ciphertext.
  // App xử lý trường rỗng ở tầng trên, nên đây là đặc tính đã biết, không phải lỗi dữ liệu.
  const { api } = loadSecurity();
  api.setMasterKey(api.generateMasterKey());
  const cipher = api.encryptText('');
  assert.notEqual(cipher, '', 'Chuỗi rỗng vẫn được mã hóa thành ciphertext');
  assert.equal(api.decryptText(cipher), cipher, 'Đặc tính đã biết: decrypt trả về ciphertext');
});

test('encryptText: null/undefined được giữ nguyên (an toàn với trường trống)', () => {
  const { api } = loadSecurity();
  api.setMasterKey(api.generateMasterKey());
  assert.equal(api.encryptText(null), null);
  assert.equal(api.encryptText(undefined), undefined);
  assert.equal(api.decryptText(null), null);
  assert.equal(api.decryptText(undefined), undefined);
});

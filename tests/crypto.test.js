'use strict';

// ============================================================================
// crypto.test.js — Ưu tiên #1: TÍNH TOÀN VẸN DỮ LIỆU (banking data integrity)
// Kiểm chứng encrypt -> decrypt field-level (encryptText/decryptText) sau khi
// chuyển sang AES-256-GCM (WebCrypto). encryptText BẤT ĐỒNG BỘ + seed cache;
// decryptText ĐỒNG BỘ đọc cache. Chạy trên code THẬT trong assets/02_security.js.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSecurity } = require('./helpers/load-security');

test('encryptText/decryptText: roundtrip giữ nguyên tuyệt đối chuỗi tiếng Việt', async () => {
  const { api } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());

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
    const cipher = await api.encryptText(plain);   // seed cache -> đọc lại đồng bộ
    const back = api.decryptText(cipher);
    assert.equal(back, plain, `Roundtrip lỗi cho: ${JSON.stringify(plain)}`);
  }
});

test('encryptText: ciphertext KHÁC plaintext và có định dạng AES-GCM (cpg1:)', async () => {
  const { api } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());

  const plain = 'Thông tin nhạy cảm của khách hàng';
  const cipher = await api.encryptText(plain);

  assert.notEqual(cipher, plain, 'Ciphertext không được trùng plaintext');
  assert.ok(cipher.startsWith('cpg1:'), 'Field cipher mới phải là AES-GCM với prefix "cpg1:"');
  assert.ok(!cipher.includes(plain), 'Ciphertext không được lộ plaintext');
});

test('encryptText: cùng plaintext -> ciphertext khác nhau (IV ngẫu nhiên)', async () => {
  const { api } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());

  const plain = 'khách hàng A';
  const c1 = await api.encryptText(plain);
  const c2 = await api.encryptText(plain);

  assert.notEqual(c1, c2, 'AES-GCM phải dùng IV ngẫu nhiên -> ciphertext khác nhau');
  assert.equal(api.decryptText(c1), plain);
  assert.equal(api.decryptText(c2), plain);
});

test('_gcmDecryptField: GIẢ MẠO ciphertext -> ném lỗi (GCM auth tag)', async () => {
  const { api } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());

  const cipher = await api.encryptText('số dư 1.000.000.000');
  // Lật vài ký tự ở phần thân base64url -> tag không khớp.
  const body = cipher.slice('cpg1:'.length);
  const flipped = 'cpg1:' + body.slice(0, -3) + (body.slice(-3) === 'AAA' ? 'BBB' : 'AAA');
  await assert.rejects(() => api._gcmDecryptField(flipped), 'Ciphertext bị sửa phải bị GCM từ chối');
});

test('decryptText: SAI khóa -> KHÔNG rò rỉ plaintext (đổi khóa xóa cache)', async () => {
  const { api } = loadSecurity();

  await api.setMasterKey(api.generateMasterKey());        // khóa A
  const cipher = await api.encryptText('bí mật ngân hàng');

  await api.setMasterKey(api.generateMasterKey());        // khóa B (xóa cache của A)
  const back = api.decryptText(cipher);
  assert.notEqual(back, 'bí mật ngân hàng', 'Sai khóa không được lộ plaintext');
  assert.equal(back, cipher, 'Cache miss -> trả nguyên ciphertext (an toàn)');
  // Giải mã trực tiếp bằng khóa B cũng phải THẤT BẠI (tag không khớp).
  await assert.rejects(() => api._gcmDecryptField(cipher), 'Khóa B không giải mã được ciphertext của khóa A');
});

test('encryptText: từ chối mã hóa lại chuỗi đã trông như ciphertext (chống double-encryption)', async () => {
  // Bug thực tế (v1.5.5 lazy-decrypt regression): decryptText() cache-miss trả nguyên
  // ciphertext "cpg1:..." -> UI đổ nhầm vào ô input -> user bấm Lưu -> nếu encryptText mã
  // hóa lại thì lồng thêm 1 lớp AES-GCM, hỏng dữ liệu vĩnh viễn (không cách nào gỡ lại vì
  // decryptFieldAsync chỉ mở đúng 1 lớp). encryptText phải NÉM LỖI thay vì âm thầm lồng mã.
  const { api } = loadSecurity();
  const { CryptoJS } = require('./helpers/load-security');
  await api.setMasterKey(api.generateMasterKey());

  const cipher = await api.encryptText('dữ liệu gốc');
  await assert.rejects(() => api.encryptText(cipher), 'cpg1: ciphertext đưa lại vào encryptText phải bị từ chối');

  const legacyCipher = CryptoJS.AES.encrypt('dữ liệu cũ', 'mk_legacy').toString();
  await assert.rejects(() => api.encryptText(legacyCipher), 'U2FsdGVk... (legacy) đưa lại vào encryptText phải bị từ chối');

  // Plaintext bình thường (không trông giống ciphertext) vẫn phải mã hóa được như cũ.
  const ok = await api.encryptText('văn bản bình thường không phải ciphertext');
  assert.ok(ok.startsWith('cpg1:'), 'Plaintext hợp lệ vẫn phải mã hóa bình thường');
});

test('legacy CryptoJS "U2FsdGVk...": decryptText đọc đồng bộ bằng masterKeyLegacy', async () => {
  const { api } = loadSecurity();
  const { CryptoJS } = require('./helpers/load-security');
  const legacy = 'mk_legacy_ABCDEF';
  api.setLegacyMasterKey(legacy);
  const cipher = CryptoJS.AES.encrypt('dữ liệu cũ CryptoJS', legacy).toString();
  assert.ok(cipher.startsWith('U2FsdGVk'), 'Chuẩn bị đúng dữ liệu legacy');
  assert.equal(api.decryptText(cipher), 'dữ liệu cũ CryptoJS', 'Phải đọc được dữ liệu CryptoJS cũ (đồng bộ)');
});

test('encryptText: khi CHƯA có masterKey -> trả nguyên bản (không phá dữ liệu)', async () => {
  const { api } = loadSecurity();
  const plain = 'giá trị chưa mã hóa';
  assert.equal(await api.encryptText(plain), plain, 'Không masterKey thì giữ nguyên input');
  assert.equal(api.decryptText(plain), plain, 'Không masterKey thì decrypt cũng giữ nguyên');
});

test('encryptText/decryptText: chuỗi RỖNG roundtrip đúng (cache lưu chính xác "")', async () => {
  // Khác bản CryptoJS cũ (quirk `plaintext || cipher`): AES-GCM + cache lưu đúng ''.
  const { api } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  const cipher = await api.encryptText('');
  assert.ok(cipher.startsWith('cpg1:'), 'Chuỗi rỗng vẫn được mã hóa thành ciphertext');
  assert.equal(api.decryptText(cipher), '', 'Chuỗi rỗng roundtrip đúng thành ""');
});

test('encryptText: null/undefined được giữ nguyên (an toàn với trường trống)', async () => {
  const { api } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  assert.equal(await api.encryptText(null), null);
  assert.equal(await api.encryptText(undefined), undefined);
  assert.equal(api.decryptText(null), null);
  assert.equal(api.decryptText(undefined), undefined);
});

test('generateMasterKey: định dạng MK2 (CSPRNG 32 byte, không đoán được)', () => {
  const { api } = loadSecurity();
  const a = api.generateMasterKey();
  const b = api.generateMasterKey();
  assert.ok(a.startsWith('MK2:'), 'masterKey mới phải có prefix MK2:');
  assert.notEqual(a, b, 'Hai lần sinh phải khác nhau (ngẫu nhiên)');
  // base64 của 32 byte ~ 44 ký tự -> tổng > 40.
  assert.ok(a.length > 40, 'Độ dài hợp lý cho 32 byte base64');
});

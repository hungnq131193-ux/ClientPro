'use strict';

// ============================================================================
// dvhc-utils.test.js — Unit test cho HÀM THUẦN của tool Tra cứu sáp nhập ĐVHC
// + kiểm tra toàn vẹn dữ liệu assets/data/dvhc/dvhc.v1.json.
// Nạp assets/dvhc-lookup/dvhc_utils.js trực tiếp (UMD guard -> module.exports).
// Zero-dependency: node --test.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const U = require(path.resolve(__dirname, '..', 'assets', 'dvhc-lookup', 'dvhc_utils.js'));

const DATA_PATH = path.resolve(__dirname, '..', 'assets', 'data', 'dvhc', 'dvhc.v1.json');
const DATA = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
const INDEX = U.buildIndex(DATA);

// --------------------------- Chuẩn hoá chuỗi -------------------------------
test('stripDiacritics: bỏ dấu tiếng Việt, đổi đ->d', () => {
  assert.equal(U.stripDiacritics('Hoà Bình'), 'Hoa Binh');
  assert.equal(U.stripDiacritics('Đắk Lắk'), 'Dak Lak');
  assert.equal(U.stripDiacritics('Thừa Thiên Huế'), 'Thua Thien Hue');
});

test('normalizeName: thường hoá + gộp khoảng trắng + bỏ dấu câu', () => {
  assert.equal(U.normalizeName('  Phường   An Hội   Tây '), 'phuong an hoi tay');
  assert.equal(U.normalizeName('TP. Hồ Chí Minh'), 'tp ho chi minh');
  assert.equal(U.normalizeName(null), '');
});

test('stripUnitPrefix: bỏ tiền tố loại đơn vị theo cấp', () => {
  assert.equal(U.stripUnitPrefix('xa cao phong', 'ward'), 'cao phong');
  assert.equal(U.stripUnitPrefix('phuong 12', 'ward'), '12');
  assert.equal(U.stripUnitPrefix('thi tran mai chau', 'ward'), 'mai chau');
  assert.equal(U.stripUnitPrefix('quan go vap', 'district'), 'go vap');
  assert.equal(U.stripUnitPrefix('tinh hoa binh', 'province'), 'hoa binh');
  // Không có tiền tố -> giữ nguyên
  assert.equal(U.stripUnitPrefix('cao phong', 'ward'), 'cao phong');
});

// --------------------------- Toàn vẹn dữ liệu ------------------------------
test('dữ liệu: đúng số lượng 34 tỉnh mới / 63 tỉnh cũ', () => {
  assert.equal(DATA.provinces.length, 34);
  assert.equal(DATA.oldProvinces.length, 63);
  assert.ok(DATA.wards.length > 3000, 'phải có > 3000 xã mới');
  assert.ok(DATA.map.length > 10000, 'phải có > 10000 dòng đối chiếu');
});

test('dữ liệu: buildIndex không lỗi, phủ đủ mọi dòng map', () => {
  assert.ok(!INDEX.error, INDEX.error);
  assert.equal(INDEX.records.length, DATA.map.length);
});

test('dữ liệu: mọi chỉ mục trong map đều hợp lệ', () => {
  for (const [oW, dIdx, wIdx] of DATA.map) {
    assert.ok(DATA.oldDistricts[dIdx], 'dIdx hợp lệ');
    assert.ok(DATA.wards[wIdx], 'wIdx hợp lệ');
    const opIdx = DATA.oldDistricts[dIdx][1];
    assert.ok(DATA.oldProvinces[opIdx], 'opIdx hợp lệ');
    const pIdx = DATA.oldProvinces[opIdx][1];
    assert.ok(DATA.provinces[pIdx], 'pIdx hợp lệ');
  }
});

test('dữ liệu: mỗi tỉnh mới đều có ít nhất 1 xã, mã xã không trùng', () => {
  const perProvince = new Array(DATA.provinces.length).fill(0);
  const codes = new Set();
  for (const [code, name, pIdx] of DATA.wards) {
    assert.ok(code && name, 'xã có mã + tên');
    assert.ok(!codes.has(code), 'mã xã trùng: ' + code);
    codes.add(code);
    perProvince[pIdx] += 1;
  }
  perProvince.forEach((n, i) => {
    assert.ok(n > 0, 'tỉnh không có xã: ' + DATA.provinces[i][1]);
  });
});

// Nguồn có ~140 dòng lặp y hệt một cặp (đơn vị cũ → xã mới); build script lọc
// trùng. Còn sót thì tra xuôi hiện thẻ trùng, tra ngược đếm sai số đơn vị cũ.
test('dữ liệu: không có dòng đối chiếu trùng lặp', () => {
  const seen = new Set();
  const dups = [];
  for (const [oW, dIdx, wIdx] of DATA.map) {
    const key = oW + '|' + dIdx + '|' + wIdx;
    if (seen.has(key)) {
      if (dups.length < 5) dups.push(oW + ' → ' + DATA.wards[wIdx][1]);
    }
    seen.add(key);
  }
  assert.equal(dups.length, 0, 'dòng trùng: ' + dups.join(', '));
  assert.equal(seen.size, DATA.map.length);
});

test('dữ liệu: meta.counts.mappings khớp số dòng map thật', () => {
  assert.equal(DATA.meta.counts.mappings, DATA.map.length);
});

// --------------------------- Tra xuôi (cũ -> mới) --------------------------
test('searchOld: tìm không dấu "phuong 12, go vap" ra Phường An Hội Tây', () => {
  const rs = U.searchOld(INDEX, 'phuong 12, go vap', 10);
  assert.ok(rs.length >= 1);
  assert.equal(rs[0].nW, 'Phường An Hội Tây');
  assert.equal(rs[0].nP, 'Thành phố Hồ Chí Minh');
});

test('searchOld: có dấu + tiền tố đầy đủ vẫn khớp', () => {
  const rs = U.searchOld(INDEX, 'Phường 12, Quận Gò Vấp, Thành phố Hồ Chí Minh', 10);
  assert.ok(rs.length >= 1);
  assert.equal(rs[0].oD, 'Quận Gò Vấp');
});

test('searchOld: huyện đảo đặc khu (không có xã cũ) tra được theo tên', () => {
  const rs = U.searchOld(INDEX, 'con dao', 10);
  assert.ok(rs.some((r) => r.nW === 'Đặc khu Côn Đảo'), 'phải thấy Đặc khu Côn Đảo');
});

test('searchOld: chuỗi rỗng/lạ không crash, trả mảng rỗng', () => {
  assert.deepEqual(U.searchOld(INDEX, '', 10), []);
  assert.deepEqual(U.searchOld(INDEX, '   ,,, ', 10), []);
  assert.deepEqual(U.searchOld(null, 'abc', 10), []);
});

test('searchOld: giới hạn kết quả theo limit', () => {
  const rs = U.searchOld(INDEX, 'xa', 5);
  assert.ok(rs.length <= 5);
});

// --------------------------- Tra ngược (mới -> cũ) -------------------------
test('reverseLookup: xã mới gồm nhiều đơn vị cũ', () => {
  const hits = U.listWardsOfProvince(INDEX, findProvinceIdx('Thành phố Hồ Chí Minh'), 'an hoi tay', 10);
  assert.equal(hits.length, 1);
  const olds = U.reverseLookup(INDEX, hits[0].wIdx);
  assert.ok(olds.length >= 2, 'An Hội Tây phải gộp từ >= 2 phường cũ');
  assert.ok(olds.every((r) => r.oD === 'Quận Gò Vấp'));
});

test('listWardsOfProvince: lọc theo query, giới hạn limit', () => {
  const pIdx = findProvinceIdx('Thành phố Hà Nội');
  const all = U.listWardsOfProvince(INDEX, pIdx, '', 1000);
  assert.ok(all.length > 50, 'Hà Nội phải có nhiều xã/phường');
  const filtered = U.listWardsOfProvince(INDEX, pIdx, 'ba dinh', 10);
  assert.ok(filtered.some((w) => w.name === 'Phường Ba Đình'));
});

// --------------------------- Chuyển địa chỉ --------------------------------
test('convertAddress: địa chỉ đầy đủ 4 phần giữ phần chi tiết', () => {
  const r = U.convertAddress(INDEX, 'Số 5 ngõ 20, Phường 12, Quận Gò Vấp, TP. Hồ Chí Minh');
  assert.ok(r.ok, r.error);
  assert.equal(r.newAddress, 'Số 5 ngõ 20, Phường An Hội Tây, Thành phố Hồ Chí Minh');
});

test('convertAddress: 3 phần (xã, huyện, tỉnh) không có chi tiết', () => {
  const r = U.convertAddress(INDEX, 'Phường 12, Quận Gò Vấp, Thành phố Hồ Chí Minh');
  assert.ok(r.ok, r.error);
  assert.equal(r.newAddress, 'Phường An Hội Tây, Thành phố Hồ Chí Minh');
});

test('convertAddress: không nhận diện được -> lỗi tiếng Việt, không crash', () => {
  const r = U.convertAddress(INDEX, 'Xã Không Tồn Tại, Huyện Hư Cấu, Tỉnh Ảo');
  assert.equal(r.ok, false);
  assert.ok(r.error && r.error.length > 0);
  assert.equal(U.convertAddress(INDEX, '').ok, false);
  assert.equal(U.convertAddress(INDEX, 'chỉ một phần').ok, false);
});

test('convertAddress: xã trùng tên ở nhiều nơi -> cần huyện/tỉnh để khớp', () => {
  // "Phường 12" tồn tại ở nhiều tỉnh cũ; thiếu huyện/tỉnh phải trả nhiều match
  // hoặc lỗi chứ không tự bịa 1 đáp án duy nhất sai.
  const r = U.convertAddress(INDEX, 'Phường 12, Quận Gò Vấp');
  assert.ok(r.ok, r.error);
  assert.ok(r.newAddress, 'đủ huyện thì xác định duy nhất');
});

// --------------------------- Gói thôn/TDP ----------------------------------
test('validatePack: gói hợp lệ', () => {
  const v = U.validatePack({
    schema: 'dvhc-pack@1',
    province: 'Phú Thọ',
    version: '2026-07',
    source: 'QĐ 123/QĐ-UBND',
    mappings: [
      { xa: 'Xã Cao Phong', cu: 'Xóm Đồng Mới', moi: 'Xóm Trung Hoà' },
      { xa: 'Xã Cao Phong', cu: 'Xóm Bãi Bệ', moi: 'Xóm Trung Hoà' },
    ],
  });
  assert.ok(v.ok, v.error);
  assert.equal(v.pack.mappings.length, 2);
});

test('validatePack: từ chối schema sai / thiếu trường / rỗng', () => {
  assert.equal(U.validatePack(null).ok, false);
  assert.equal(U.validatePack({}).ok, false);
  assert.equal(U.validatePack({ schema: 'dvhc-pack@1' }).ok, false);
  assert.equal(U.validatePack({ schema: 'dvhc-pack@1', province: 'X', mappings: [] }).ok, false);
  assert.equal(
    U.validatePack({ schema: 'dvhc-pack@1', province: 'X', mappings: [{ xa: '', cu: 'a', moi: 'b' }] }).ok,
    false
  );
});

test('packLookup: tra theo tên xã mới, không phân biệt dấu/tiền tố', () => {
  const v = U.validatePack({
    schema: 'dvhc-pack@1',
    province: 'Phú Thọ',
    mappings: [{ xa: 'Xã Cao Phong', cu: 'Xóm Đồng Mới', moi: 'Xóm Trung Hoà' }],
  });
  assert.ok(v.ok);
  assert.equal(U.packLookup(v.pack, 'xa cao phong').length, 1);
  assert.equal(U.packLookup(v.pack, 'Cao Phong').length, 1);
  assert.equal(U.packLookup(v.pack, 'Xã Khác').length, 0);
});

test('buildPackIndex: gom theo tên xã đã chuẩn hoá + tên tỉnh chuẩn hoá sẵn', () => {
  const v = U.validatePack({
    schema: 'dvhc-pack@1',
    province: 'Tỉnh Phú Thọ',
    mappings: [
      { xa: 'Xã Cao Phong', cu: 'Xóm Đồng Mới', moi: 'Xóm Trung Hoà' },
      { xa: 'Cao Phong', cu: 'Xóm Bãi Bệ', moi: 'Xóm Trung Hoà' },
      { xa: 'Phường Việt Trì', cu: 'TDP 1', moi: 'TDP Tân Dân' },
    ],
  });
  assert.ok(v.ok);
  const idx = U.buildPackIndex(v.pack);
  assert.equal(idx.province, 'phu tho', 'tên tỉnh đã bỏ tiền tố + bỏ dấu');
  // Hai cách viết cùng một xã phải gộp chung một khoá.
  assert.equal(idx.byWard.get('cao phong').length, 2);
  assert.equal(idx.byWard.size, 2);
});

test('packLookupFromIndex: tra không phân biệt dấu/tiền tố, khớp packLookup', () => {
  const v = U.validatePack({
    schema: 'dvhc-pack@1',
    province: 'Phú Thọ',
    mappings: [{ xa: 'Xã Cao Phong', cu: 'Xóm Đồng Mới', moi: 'Xóm Trung Hoà' }],
  });
  assert.ok(v.ok);
  const idx = U.buildPackIndex(v.pack);
  for (const q of ['xa cao phong', 'Cao Phong', 'Xã Cao Phong', 'Xã Khác', '']) {
    assert.deepEqual(
      U.packLookupFromIndex(idx, q),
      U.packLookup(v.pack, q),
      'khác kết quả với truy vấn: ' + q
    );
  }
  assert.equal(U.packLookupFromIndex(idx, 'cao phong').length, 1);
  assert.equal(U.packLookupFromIndex(idx, 'Xã Khác').length, 0);
  // Gói rỗng/không hợp lệ: không ném lỗi.
  assert.deepEqual(U.packLookupFromIndex(null, 'Cao Phong'), []);
  assert.deepEqual(U.buildPackIndex(null).byWard.size, 0);
});

// --------------------------- Helper ----------------------------------------
function findProvinceIdx(name) {
  const i = DATA.provinces.findIndex((p) => p[1] === name);
  assert.ok(i >= 0, 'không thấy tỉnh ' + name);
  return i;
}

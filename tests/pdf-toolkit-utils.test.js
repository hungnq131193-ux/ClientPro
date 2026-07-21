'use strict';

// ============================================================================
// pdf-toolkit-utils.test.js — Unit test cho HÀM THUẦN của PDF Toolkit.
// Nạp assets/pdf-toolkit/pdf_toolkit_utils.js trực tiếp (UMD guard -> module.exports).
// Zero-dependency: node --test.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const U = require(path.resolve(__dirname, '..', 'assets', 'pdf-toolkit', 'pdf_toolkit_utils.js'));

// --------------------------- parsePageRange --------------------------------
test('parsePageRange: khoảng đơn giản 1-5', () => {
  assert.deepEqual(U.parsePageRange('1-5', 10).pages, [1, 2, 3, 4, 5]);
});

test('parsePageRange: danh sách 1,3,7', () => {
  assert.deepEqual(U.parsePageRange('1,3,7', 10).pages, [1, 3, 7]);
});

test('parsePageRange: hỗn hợp 1-3,8,10-12 + khoảng trắng', () => {
  assert.deepEqual(U.parsePageRange(' 1-3, 8 ,10-12 ', 12).pages, [1, 2, 3, 8, 10, 11, 12]);
});

test('parsePageRange: loại trùng khi nhập lặp', () => {
  assert.deepEqual(U.parsePageRange('1,1,2,2-3,3', 5).pages, [1, 2, 3]);
});

test('parsePageRange: từ chối số 0', () => {
  const r = U.parsePageRange('0', 5);
  assert.equal(r.pages.length, 0);
  assert.ok(r.error);
});

test('parsePageRange: từ chối số âm (chuỗi lạ)', () => {
  const r = U.parsePageRange('-3', 5);
  assert.equal(r.pages.length, 0);
  assert.ok(r.error);
});

test('parsePageRange: từ chối vượt tổng số trang', () => {
  const r = U.parsePageRange('4-9', 5);
  assert.equal(r.pages.length, 0);
  assert.match(r.error, /vượt quá/);
});

test('parsePageRange: từ chối khoảng đảo ngược 5-3', () => {
  const r = U.parsePageRange('5-3', 10);
  assert.equal(r.pages.length, 0);
  assert.ok(r.error);
});

test('parsePageRange: chuỗi rỗng => lỗi, không crash', () => {
  const r = U.parsePageRange('   ', 5);
  assert.equal(r.pages.length, 0);
  assert.ok(r.error);
});

test('parsePageRange: chuỗi bất thường không crash', () => {
  for (const s of ['abc', '1-', '-', ',', '1,,2', '1--2', '9'.repeat(400), null, undefined, {}, []]) {
    const r = U.parsePageRange(s, 5);
    assert.ok(r && Array.isArray(r.pages));
    if (r.pages.length) assert.ok(r.error === null);
  }
});

test('parsePageRange: total không hợp lệ => lỗi', () => {
  assert.ok(U.parsePageRange('1', 0).error);
  assert.ok(U.parsePageRange('1', -1).error);
});

// --------------------------- dedupePages -----------------------------------
test('dedupePages: giữ thứ tự lần đầu xuất hiện', () => {
  assert.deepEqual(U.dedupePages([3, 1, 3, 2, 1]), [3, 1, 2]);
  assert.deepEqual(U.dedupePages('x'), []);
});

// --------------------------- safeFileName ----------------------------------
test('safeFileName: thêm .pdf khi thiếu', () => {
  assert.equal(U.safeFileName('bao cao', 'pdf'), 'bao cao.pdf');
});

test('safeFileName: không nhân đôi đuôi', () => {
  assert.equal(U.safeFileName('bao-cao.pdf', 'pdf'), 'bao-cao.pdf');
  assert.equal(U.safeFileName('bao-cao.PDF', '.pdf'), 'bao-cao.pdf');
});

test('safeFileName: loại đường dẫn giả', () => {
  assert.equal(U.safeFileName('../../etc/passwd', 'pdf'), 'passwd.pdf');
  assert.equal(U.safeFileName('a/b/c', 'zip'), 'c.zip');
});

test('safeFileName: loại ký tự cấm', () => {
  const out = U.safeFileName('a<b>c:"d"|e?f*g', 'pdf');
  assert.ok(!/[<>:"|?*]/.test(out));
  assert.ok(out.endsWith('.pdf'));
});

test('safeFileName: chuỗi rỗng -> tên mặc định', () => {
  assert.equal(U.safeFileName('   ', 'pdf', 'ket-qua'), 'ket-qua.pdf');
  assert.equal(U.safeFileName('', 'pdf'), 'tai-lieu.pdf');
});

test('safeFileName: giữ Unicode tiếng Việt', () => {
  assert.equal(U.safeFileName('tài liệu đã ghép', 'pdf'), 'tài liệu đã ghép.pdf');
});

// --------------------------- detectFileKind (signature) --------------------
test('detectFileKind: nhận PDF qua %PDF-', () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
  assert.equal(U.detectFileKind(bytes), 'pdf');
  assert.ok(U.isPdfBytes(bytes));
});

test('detectFileKind: nhận JPEG/PNG/WebP', () => {
  assert.equal(U.detectFileKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'jpeg');
  assert.equal(U.detectFileKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(U.detectFileKind(webp), 'webp');
});

test('detectFileKind: rác => null, không nhận nhầm', () => {
  assert.equal(U.detectFileKind(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), null);
  assert.equal(U.detectFileKind(new Uint8Array([])), null);
  assert.equal(U.detectFileKind(null), null);
});

test('imageMimeToKind: map MIME', () => {
  assert.equal(U.imageMimeToKind('image/jpeg'), 'jpeg');
  assert.equal(U.imageMimeToKind('image/PNG'), 'png');
  assert.equal(U.imageMimeToKind('image/gif'), null);
  assert.equal(U.imageMimeToKind(''), null);
});

// --------------------------- rotation --------------------------------------
test('normalizeRotation / rotateBy: chuẩn hóa 0/90/180/270', () => {
  assert.equal(U.normalizeRotation(0), 0);
  assert.equal(U.normalizeRotation(-90), 270);
  assert.equal(U.normalizeRotation(450), 90);
  assert.equal(U.rotateBy(270, 90), 0);
  assert.equal(U.rotateBy(0, -90), 270);
});

// --------------------------- moveItem (reorder) ----------------------------
test('moveItem: đổi chỗ, không đột biến mảng gốc', () => {
  const a = ['a', 'b', 'c'];
  assert.deepEqual(U.moveItem(a, 2, -1), ['a', 'c', 'b']);
  assert.deepEqual(U.moveItem(a, 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(a, ['a', 'b', 'c']); // gốc không đổi
  // Biên: không vượt mảng.
  assert.deepEqual(U.moveItem(a, 0, -1), ['a', 'b', 'c']);
  assert.deepEqual(U.moveItem(a, 2, 1), ['a', 'b', 'c']);
});

// --------------------------- undo stack ------------------------------------
test('createUndoStack: push/pop + giới hạn', () => {
  const s = U.createUndoStack(2);
  assert.equal(s.canUndo(), false);
  s.push({ v: 1 });
  s.push({ v: 2 });
  s.push({ v: 3 }); // đẩy v:1 ra
  assert.equal(s.size, 2);
  assert.deepEqual(s.pop(), { v: 3 });
  assert.deepEqual(s.pop(), { v: 2 });
  assert.equal(s.canUndo(), false);
  assert.equal(s.pop(), null);
});

test('createUndoStack: snapshot là bản sao (không tham chiếu)', () => {
  const s = U.createUndoStack(5);
  const obj = { list: [1, 2] };
  s.push(obj);
  obj.list.push(3);
  assert.deepEqual(s.pop(), { list: [1, 2] });
});

// --------------------------- cancellation token ----------------------------
test('createCancelToken: cancel + throwIfCancelled + onCancel', () => {
  const t = U.createCancelToken();
  let fired = 0;
  t.onCancel(() => fired++);
  assert.equal(t.cancelled, false);
  assert.doesNotThrow(() => t.throwIfCancelled());
  t.cancel();
  assert.equal(t.cancelled, true);
  assert.equal(fired, 1);
  assert.throws(() => t.throwIfCancelled(), (e) => U.isCancel(e));
  t.cancel(); // idempotent
  assert.equal(fired, 1);
  // onCancel sau khi đã cancel: chạy ngay.
  let late = 0; t.onCancel(() => late++);
  assert.equal(late, 1);
});

// --------------------------- compression / resolution presets --------------
test('compressionPreset: 3 mức hợp lệ', () => {
  assert.ok(U.compressionPreset('high').scale >= U.compressionPreset('balanced').scale);
  assert.ok(U.compressionPreset('balanced').scale >= U.compressionPreset('small').scale);
  assert.ok(U.compressionPreset('high').quality > U.compressionPreset('small').quality);
  // fallback
  assert.equal(U.compressionPreset('xyz').label, U.compressionPreset('balanced').label);
});

test('renderResolutionPreset: tiết kiệm < cân bằng < rõ nét', () => {
  assert.ok(U.renderResolutionPreset('save').scale < U.renderResolutionPreset('balanced').scale);
  assert.ok(U.renderResolutionPreset('balanced').scale < U.renderResolutionPreset('sharp').scale);
});

// --------------------------- imageOutputName -------------------------------
test('imageOutputName: mẫu [base]_trang_001.jpg, pad theo tổng', () => {
  assert.equal(U.imageOutputName('hoa-don', 1, 'jpg', 5), 'hoa-don_trang_001.jpg');
  assert.equal(U.imageOutputName('hoa-don', 12, 'png', 200), 'hoa-don_trang_012.png');
  assert.equal(U.imageOutputName('a.pdf', 2, 'jpeg', 3), 'a_trang_002.jpg');
});

// --------------------------- computeReduction ------------------------------
test('computeReduction: tính đúng % và cờ notSmaller', () => {
  const r = U.computeReduction(1000, 400);
  assert.equal(r.savedBytes, 600);
  assert.equal(Math.round(r.percent), 60);
  assert.equal(r.notSmaller, false);
});

test('computeReduction: file to hơn/gần bằng => notSmaller', () => {
  assert.equal(U.computeReduction(1000, 1000).notSmaller, true);
  assert.equal(U.computeReduction(1000, 1200).notSmaller, true);
  assert.equal(U.computeReduction(1000, 985).notSmaller, true); // giảm 1.5% < 3%
});

// --------------------------- margin preset ---------------------------------
test('marginPreset: none/small/medium', () => {
  assert.equal(U.marginPreset('none'), 0);
  assert.ok(U.marginPreset('small') > 0);
  assert.ok(U.marginPreset('medium') > U.marginPreset('small'));
});

// ==========================================================================
// REGRESSION — lỗi từ review PR #122
// ==========================================================================

// [Bug: Utils lacks MSG references] MSG phải nằm trong utils (U.MSG) với đủ khóa
// mà các tool tham chiếu — nếu thiếu, tool hiển thị lỗi trống / crash.
test('regression MSG: U.MSG tồn tại với đủ khóa tool dùng', () => {
  assert.ok(U.MSG && typeof U.MSG === 'object', 'U.MSG phải là object');
  for (const k of ['invalidPdf', 'empty', 'password', 'tooBig', 'memory', 'outputFail', 'badImage', 'imageTooLarge']) {
    assert.equal(typeof U.MSG[k], 'string', 'thiếu MSG.' + k);
    assert.ok(U.MSG[k].length > 0, 'MSG.' + k + ' rỗng');
  }
});

// [Bug: PDF size limits not enforced] checkFileSize áp hard/warn theo giới hạn.
test('regression checkFileSize: ok/warn/hard theo ngưỡng', () => {
  const L = U.PDF_TOOLKIT_LIMITS;
  assert.deepEqual(U.checkFileSize(1024).level, 'ok');
  assert.equal(U.checkFileSize(L.warnTotalBytes + 1).level, 'warn');
  assert.equal(U.checkFileSize(L.warnTotalBytes + 1).ok, true);
  const hard = U.checkFileSize(L.hardTotalBytes + 1);
  assert.equal(hard.ok, false);
  assert.equal(hard.level, 'hard');
  assert.equal(hard.error, U.MSG.tooBig);
  // Biên chính xác: đúng bằng ngưỡng hard vẫn ok.
  assert.equal(U.checkFileSize(L.hardTotalBytes).ok, true);
});

// [Bug: Null canvas blob not handled] blobOrThrow ném lỗi thân thiện khi null.
test('regression blobOrThrow: trả blob hợp lệ, ném friendly khi null', () => {
  const b = { size: 1 };
  assert.equal(U.blobOrThrow(b), b);
  assert.throws(() => U.blobOrThrow(null), (e) => e && e.friendly === U.MSG.memory);
  assert.throws(() => U.blobOrThrow(undefined), (e) => e && typeof e.friendly === 'string');
});

// [Bug: Split export ignores range order] orderPagesBySelection giữ đúng thứ tự nhập.
test('regression orderPagesBySelection: giữ thứ tự người dùng, bỏ ngoài phạm vi', () => {
  const pages = [{ srcIndex: 0 }, { srcIndex: 1 }, { srcIndex: 2 }, { srcIndex: 3 }];
  // "5,2,8" trên tài liệu 4 trang -> chỉ trang 2 hợp lệ.
  assert.deepEqual(U.orderPagesBySelection(pages, [5, 2, 8]), [{ srcIndex: 1 }]);
  // "3,1" -> ĐÚNG thứ tự 3 rồi 1 (không phải 1,3).
  const out = U.orderPagesBySelection(pages, [3, 1]);
  assert.deepEqual(out.map((p) => p.srcIndex), [2, 0]);
  // input bất thường không crash.
  assert.deepEqual(U.orderPagesBySelection(null, [1]), []);
  assert.deepEqual(U.orderPagesBySelection(pages, null), []);
});

'use strict';

// ============================================================================
// image-save-fail-closed.test.js — saveImageToDB() phải FAIL-CLOSED trước khi
// ghi vào IndexedDB, và handleFileUpload() phải khóa đối tượng đích trước khi
// đọc file.
//
// Vì sao cần: encryptImageData() (02_security.js) là fail-open — mất masterKey
// thì nó TRẢ NGUYÊN data URL plaintext, không ném lỗi. Tầng crypto cố ý giữ như
// vậy cho migration/callers khác, nên trách nhiệm từ chối plaintext nằm ở caller
// ghi DB. Nếu caller cứ ghi, ảnh plaintext nằm lại vĩnh viễn trong store images
// (không migration nào quét lại vì bản ghi đã mang imgCryptoV=1).
//
// Bài test thứ hai: FileReader đọc bất đồng bộ. Trước đây saveImageToDB tự đọc
// currentCustomerId/currentAssetId SAU khi file đọc xong, nên người dùng đổi hồ
// sơ giữa chừng là ảnh gắn nhầm khách hàng.
//
// Chạy 08_images_camera.js THẬT trong vm sandbox (tests/helpers/load-images.js).
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadImages, GCM_PREFIX } = require('./helpers/load-images');

const RAW = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAplaintext';

test('mã hóa trả về plaintext (fail-open): KHÔNG ghi gì vào IndexedDB', async () => {
  const app = loadImages({ encryptMode: 'plain' });

  await app.saveImageToDB(RAW);

  assert.equal(app.added.length, 0,
    'Ảnh plaintext không được phép vào store images');
  assert.ok(app.errors.length > 0, 'Phải báo cho người dùng biết ảnh chưa lưu');
});

test('mã hóa ném lỗi: KHÔNG ghi gì vào IndexedDB', async () => {
  const app = loadImages({ encryptMode: 'throw' });

  await app.saveImageToDB(RAW);

  assert.equal(app.added.length, 0, 'Lỗi mã hóa không được nuốt rồi ghi tiếp');
  assert.ok(app.errors.length > 0, 'Phải báo lỗi thay vì im lặng');
});

test('không có hàm encryptImageData: KHÔNG ghi gì vào IndexedDB', async () => {
  const app = loadImages({ encryptMode: 'absent' });

  await app.saveImageToDB(RAW);

  assert.equal(app.added.length, 0,
    'Thiếu tầng mã hóa thì phải từ chối ghi, không rơi về plaintext');
});

test('phiên đã khóa giữa chừng: KHÔNG ghi dù mã hóa trả ciphertext', async () => {
  // Auto-lock có thể nổ giữa nén ảnh và mã hóa; ciphertext của phiên đã chết
  // không được phép đi tiếp vào transaction.
  const app = loadImages({ encryptMode: 'gcm', unlocked: false });

  await app.saveImageToDB(RAW);

  assert.equal(app.added.length, 0, 'Phiên đã khóa thì không ghi ảnh');
});

test('mã hóa thành công: ghi bản ghi ciphertext kèm imgCryptoV = 1', async () => {
  const app = loadImages({ encryptMode: 'gcm' });

  await app.saveImageToDB(RAW);

  assert.equal(app.added.length, 1, 'Đường thành công phải ghi đúng một bản ghi');
  const rec = app.added[0];
  assert.ok(String(rec.data).startsWith(GCM_PREFIX),
    'Trường data phải là ciphertext, không phải data URL');
  assert.equal(rec.imgCryptoV, 1, 'Bản ghi mã hóa phải mang imgCryptoV = 1');
  assert.equal(rec.customerId, 'c1');
});

test('saveImageToDB nhận opts: ghi theo hồ sơ được truyền vào, không đọc global', async () => {
  const app = loadImages({ encryptMode: 'gcm', customerId: 'c-moi' });

  // Người dùng đã sang hồ sơ "c-moi", nhưng ảnh này được chọn khi còn ở "c-cu".
  await app.saveImageToDB(RAW, { customerId: 'c-cu', assetId: 'a-cu', captureMode: 'asset' });

  assert.equal(app.added.length, 1);
  assert.equal(app.added[0].customerId, 'c-cu',
    'Ảnh phải thuộc hồ sơ tại thời điểm chọn file, không phải hồ sơ đang mở');
  assert.equal(app.added[0].assetId, 'a-cu');
});

test('handleFileUpload: đổi hồ sơ giữa lúc đọc file, ảnh vẫn thuộc hồ sơ ban đầu', async () => {
  const app = loadImages({ encryptMode: 'gcm', customerId: 'c-ban-dau' });
  const input = { files: [{ _data: RAW }], value: 'x' };

  app.handleFileUpload(input, 'profile');
  // Người dùng chuyển hồ sơ NGAY sau khi bấm chọn file, trong lúc FileReader còn
  // đang đọc — trước đây đủ để ảnh rơi sang hồ sơ mới.
  app.ctx.currentCustomerId = 'c-khac';

  await new Promise((r) => setTimeout(r, 30));

  assert.equal(app.added.length, 1, 'Ảnh phải được lưu');
  assert.equal(app.added[0].customerId, 'c-ban-dau',
    'Ảnh phải gắn hồ sơ tại thời điểm chọn file');
  assert.equal(input.value, '', 'Input file phải được reset để lần sau vẫn trigger onchange');
});

test('handleFileUpload: chưa mở hồ sơ nào thì không đọc file, không ghi', async () => {
  const app = loadImages({ encryptMode: 'gcm', customerId: null });
  const input = { files: [{ _data: RAW }], value: 'x' };

  app.handleFileUpload(input, 'profile');
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(app.added.length, 0);
  assert.ok(app.errors.length > 0, 'Phải cảnh báo thay vì im lặng bỏ qua');
});

test('_mapPool: giữ đúng thứ tự kết quả và không vượt giới hạn đồng thời', async () => {
  const app = loadImages({ encryptMode: 'gcm' });
  const items = [1, 2, 3, 4, 5, 6, 7];
  let inFlight = 0;
  let peak = 0;

  const out = await app.ctx._mapPool(items, 3, async (n) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight -= 1;
    return n * 10;
  });

  assert.deepEqual(out, [10, 20, 30, 40, 50, 60, 70], 'Thứ tự kết quả phải theo đầu vào');
  assert.ok(peak <= 3, `Đồng thời tối đa phải <= 3, đo được ${peak}`);
});

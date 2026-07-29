'use strict';

// ============================================================================
// drive-upload-results.test.js — Upload ảnh lên Drive: KHÔNG báo "thất bại" khi
// thực ra không biết kết quả.
//
// Bug gốc: GAS (handleUploadImages_) tạo file TRƯỚC khi response về tới máy.
// Client gọi response.json() trần và ép mọi thứ không-khớp-hoàn-hảo về "thất
// bại toàn bộ", nên mạng rớt giữa chừng / body HTML / files[] lệch số lượng đều
// hiện toast "Tải ảnh lên Drive thất bại" dù ảnh đã nằm trên Drive.
//
// Test chạy code THẬT trong sandbox (tests/helpers/load-drive.js), khẳng định
// 4 phán quyết và bất biến an toàn: chỉ OK/PARTIAL mới trả về ảnh được phép xóa.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDrive, makeResponse, GCM_PREFIX } = require('./helpers/load-drive.js');

const imgs = (n) => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, data: `${GCM_PREFIX}pixel${i}` }));
const okFile = (i) => ({ name: `f${i}`, id: `drive-${i}`, url: 'https://drive.google.com/f' });
const badFile = (i) => ({ name: `f${i}`, error: 'Loi xu ly anh' });
// Mảng do sandbox vm tạo nằm khác realm -> so sánh theo id, không deepStrictEqual object.
const ids = (arr) => Array.from(arr || [], (x) => x.id);

// ---------------------------------------------------------------------------
// _classifyUploadResult — đọc response JSON của GAS
// ---------------------------------------------------------------------------

test('OK: files[] khớp số lượng và mọi entry có id -> xóa được toàn bộ ảnh gốc', () => {
  const { classify, VERDICT } = loadDrive();
  const list = imgs(3);
  const out = classify(
    { status: 'success', failed: 0, url: 'https://drive.google.com/folder', files: [okFile(0), okFile(1), okFile(2)] },
    list
  );
  assert.equal(out.verdict, VERDICT.OK);
  assert.deepEqual(ids(out.succeeded), ids(list));
  assert.equal(out.failedCount, 0);
  assert.equal(out.url, 'https://drive.google.com/folder');
});

test('PARTIAL: chỉ những ảnh có files[i].id mới được phép xóa', () => {
  const { classify, VERDICT } = loadDrive();
  const list = imgs(3);
  const out = classify(
    { status: 'partial', failed: 1, url: 'https://drive.google.com/folder', files: [okFile(0), badFile(1), okFile(2)] },
    list
  );
  assert.equal(out.verdict, VERDICT.PARTIAL);
  assert.deepEqual(ids(out.succeeded), ['i0', 'i2']);
  assert.equal(out.failedCount, 1);
});

test('REJECTED: server liệt kê rõ TỪNG ảnh đều lỗi -> thất bại thật, không xóa gì', () => {
  const { classify, VERDICT } = loadDrive();
  const out = classify({ status: 'error', failed: 2, files: [badFile(0), badFile(1)] }, imgs(2));
  assert.equal(out.verdict, VERDICT.REJECTED);
  assert.deepEqual(ids(out.succeeded), []);
  assert.equal(out.uploadedCount, 0);
});

test('REJECTED: Unauthorized / lỗi server không kèm files[] -> thất bại thật', () => {
  const { classify, VERDICT } = loadDrive();
  const out = classify({ status: 'error', message: 'Unauthorized' }, imgs(2));
  assert.equal(out.verdict, VERDICT.REJECTED);
  assert.equal(out.message, 'Unauthorized');
  assert.deepEqual(ids(out.succeeded), []);
});

test('REGRESSION — UNCONFIRMED: files[] lệch số lượng nhưng có id là ảnh ĐÃ lên Drive', () => {
  // Đây chính là ca bug: bản cũ (_splitUploadResults) trả null -> caller throw
  // -> toast "Tải ảnh lên Drive thất bại" dù files[].id chứng minh có file thật.
  const { classify, VERDICT } = loadDrive();
  const out = classify(
    { status: 'partial', failed: 1, url: 'https://drive.google.com/folder', files: [okFile(0), okFile(1)] },
    imgs(3)
  );
  assert.equal(out.verdict, VERDICT.UNCONFIRMED, 'có files[].id thì không được coi là thất bại');
  assert.equal(out.uploadedCount, 2);
  assert.deepEqual(ids(out.succeeded), [], 'không map được index -> tuyệt đối không xóa ảnh gốc nào');
  assert.equal(out.url, 'https://drive.google.com/folder', 'vẫn giữ link folder để lưu vào hồ sơ');
});

test('REGRESSION — files[] khớp số lượng nhưng entry không có cả id lẫn error -> UNCONFIRMED', () => {
  // Deployment GAS cũ/lạ có thể trả entry trống. "Không ảnh nào có id" KHÔNG
  // đồng nghĩa "server từ chối" — báo thất bại ở đây là đúng cái false-negative
  // mà thay đổi này sinh ra để dập.
  const { classify, VERDICT } = loadDrive();
  const out = classify({ status: 'partial', files: [{ name: 'f0' }, { name: 'f1' }] }, imgs(2));
  assert.equal(out.verdict, VERDICT.UNCONFIRMED);
  assert.deepEqual(ids(out.succeeded), []);

  // Ngược lại: TỪNG entry mang .error, hoặc status 'error' -> vẫn REJECTED.
  assert.equal(
    classify({ status: 'partial', files: [badFile(0), badFile(1)] }, imgs(2)).verdict,
    VERDICT.REJECTED
  );
  assert.equal(
    classify({ status: 'error', files: [{ name: 'f0' }, { name: 'f1' }] }, imgs(2)).verdict,
    VERDICT.REJECTED
  );
});

test('UNCONFIRMED: status lạ / success kèm failed>0 mà không có files[] -> không kết luận', () => {
  const { classify, VERDICT } = loadDrive();
  assert.equal(classify({ status: 'success', failed: 2 }, imgs(3)).verdict, VERDICT.UNCONFIRMED);
  assert.equal(classify({ status: 'weird' }, imgs(3)).verdict, VERDICT.UNCONFIRMED);
  assert.equal(classify({ status: 'partial', files: [] }, imgs(3)).verdict, VERDICT.UNCONFIRMED);
  assert.equal(classify(null, imgs(3)).verdict, VERDICT.UNCONFIRMED);
});

test('Tương thích server v3 cũ: success trần, không files[] -> vẫn coi là OK', () => {
  const { classify, VERDICT } = loadDrive();
  const list = imgs(2);
  const out = classify({ status: 'success', url: 'https://drive.google.com/folder' }, list);
  assert.equal(out.verdict, VERDICT.OK);
  assert.deepEqual(ids(out.succeeded), ids(list));
});

test('BẤT BIẾN: chỉ OK/PARTIAL mới trả về ảnh được phép xóa', () => {
  const { classify, VERDICT } = loadDrive();
  const list = imgs(3);
  const responses = [
    { status: 'error' },
    { status: 'error', files: [badFile(0), badFile(1), badFile(2)] },
    { status: 'partial', files: [okFile(0)] },
    { status: 'success', failed: 1 },
    { status: 'weird' },
    null,
    'not-json-object',
  ];
  for (const r of responses) {
    const out = classify(r, list);
    if (out.verdict === VERDICT.OK || out.verdict === VERDICT.PARTIAL) continue;
    assert.deepEqual(ids(out.succeeded), [], `verdict ${out.verdict} không được đề xuất xóa ảnh nào`);
  }
});

// ---------------------------------------------------------------------------
// _postDriveUpload / _runDriveImageUpload — tầng mạng
// ---------------------------------------------------------------------------

test('REGRESSION — fetch reject (mạng rớt) là UNCONFIRMED, KHÔNG phải thất bại', async () => {
  // GAS có thể đã nhận request và tạo file xong trước khi kết nối đứt.
  const { runUpload, VERDICT } = loadDrive();
  const out = await runUpload('https://script.google.com/x', {}, imgs(2));
  assert.equal(out.verdict, VERDICT.UNCONFIRMED);
  assert.equal(out.transport, 'network');
  assert.deepEqual(ids(out.succeeded), []);
  assert.equal(out.failedCount, 2);
});

test('REGRESSION — body là HTML (trang đăng nhập GAS) là UNCONFIRMED', async () => {
  const { runUpload, VERDICT } = loadDrive({
    fetchImpl: async () => makeResponse({ body: '<!DOCTYPE html><html>Sign in</html>' }),
  });
  const out = await runUpload('https://script.google.com/x', {}, imgs(2));
  assert.equal(out.verdict, VERDICT.UNCONFIRMED);
  assert.equal(out.transport, 'parse');
});

test('body rỗng hoặc đứt giữa chừng là UNCONFIRMED', async () => {
  const empty = loadDrive({ fetchImpl: async () => makeResponse({ body: '' }) });
  assert.equal((await empty.runUpload('u', {}, imgs(1))).verdict, empty.VERDICT.UNCONFIRMED);

  const cut = loadDrive({ fetchImpl: async () => makeResponse({ textThrows: true }) });
  const out = await cut.runUpload('u', {}, imgs(1));
  assert.equal(out.verdict, cut.VERDICT.UNCONFIRMED);
  assert.equal(out.transport, 'body');
});

test('response JSON hợp lệ đi tới đúng phán quyết của _classifyUploadResult', async () => {
  const list = imgs(2);
  const { runUpload, VERDICT, fetchCalls } = loadDrive({
    fetchImpl: async () => makeResponse({
      body: JSON.stringify({ status: 'success', url: 'https://drive.google.com/f', files: [okFile(0), okFile(1)] }),
    }),
  });
  const out = await runUpload('https://script.google.com/x', { images: [] }, list);
  assert.equal(out.verdict, VERDICT.OK);
  assert.deepEqual(ids(out.succeeded), ids(list));
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].init.method, 'POST');
});

test('lỗi HTTP kèm JSON lỗi hợp lệ vẫn là REJECTED (server trả lời được)', async () => {
  const { runUpload, VERDICT } = loadDrive({
    fetchImpl: async () => makeResponse({
      ok: false, status: 500, body: JSON.stringify({ status: 'error', message: 'Loi Server' }),
    }),
  });
  const out = await runUpload('u', {}, imgs(1));
  assert.equal(out.verdict, VERDICT.REJECTED);
  assert.equal(out.message, 'Loi Server');
});

// ---------------------------------------------------------------------------
// _resolveImagesForUpload — chặn ciphertext TRƯỚC khi gửi request
// ---------------------------------------------------------------------------

test('giải mã được: payload là plaintext, tên file đánh số theo đúng thứ tự', async () => {
  const { resolveImages } = loadDrive();
  const out = await resolveImages(imgs(2), 'hoso');
  assert.equal(out.length, 2);
  assert.deepEqual(Array.from(out, (x) => x.data), ['pixel0', 'pixel1']);
  assert.ok(Array.from(out).every((x) => /^hoso_\d+_\d\.jpg$/.test(x.name)));
});

test('REGRESSION — decryptImageData fail-open (mất masterKey) -> DỪNG, không gửi ciphertext', async () => {
  const { resolveImages, fetchCalls } = loadDrive({ decryptMode: 'stuck' });
  assert.equal(await resolveImages(imgs(2), 'hoso'), null,
    'ciphertext lọt payload -> GAS tạo folder rồi báo lỗi từng ảnh (user thấy folder mà app báo hỏng)');
  assert.equal(fetchCalls.length, 0, 'không được gửi request nào');
});

test('auto-lock giữa chừng (isAppUnlocked=false) -> DỪNG trước khi gửi', async () => {
  const { resolveImages } = loadDrive({ unlocked: false });
  assert.equal(await resolveImages(imgs(2), 'asset_img'), null);
});

test('ảnh rỗng/không phải chuỗi -> DỪNG', async () => {
  const { resolveImages } = loadDrive();
  assert.equal(await resolveImages([{ id: 'x', data: '' }], 'hoso'), null);
  assert.equal(await resolveImages([{ id: 'x', data: null }], 'hoso'), null);
});

// ---------------------------------------------------------------------------
// Tích hợp: chạy TRỌN uploadToGoogleDrive / uploadAssetToDrive trong sandbox
// (getAll -> giải mã -> POST -> phán quyết -> ghi link -> hỏi xóa ảnh gốc)
// ---------------------------------------------------------------------------

const dbImgs = (n, assetId) =>
  Array.from({ length: n }, (_, i) => ({ id: `db${i}`, customerId: 'c1', assetId: assetId || undefined, data: `${GCM_PREFIX}pixel${i}` }));
const kinds = (toasts, kind) => toasts.filter((t) => t.kind === kind).map((t) => t.msg);

test('luồng đầy đủ — OK: lưu link vào DB, hiện thành công, xóa đúng ảnh đã lên Drive', async () => {
  const h = loadDrive({
    images: dbImgs(2),
    fetchImpl: async () => makeResponse({
      body: JSON.stringify({ status: 'success', url: 'https://drive.google.com/folder', files: [okFile(0), okFile(1)] }),
    }),
  });
  await h.runUploadFlow('profile');
  assert.equal(h.record.driveLink, 'https://drive.google.com/folder', 'link phải được ghi vào DB');
  assert.equal(h.ctx.currentCustomerData.driveLink, 'https://drive.google.com/folder');
  assert.deepEqual(h.deleted, ['db0', 'db1']);
  assert.equal(kinds(h.toasts, 'error').length, 0);
});

test('luồng đầy đủ — PARTIAL: chỉ xóa ảnh có files[i].id, ảnh lỗi ở lại máy', async () => {
  const h = loadDrive({
    images: dbImgs(3),
    fetchImpl: async () => makeResponse({
      body: JSON.stringify({ status: 'partial', failed: 1, url: 'https://drive.google.com/folder', files: [okFile(0), badFile(1), okFile(2)] }),
    }),
  });
  await h.runUploadFlow('profile');
  assert.deepEqual(h.deleted, ['db0', 'db2'], 'ảnh lỗi db1 phải được giữ nguyên');
  assert.equal(kinds(h.toasts, 'error').length, 0);
});

test('REGRESSION — luồng đầy đủ, mạng rớt: không toast thất bại, không xóa ảnh nào', async () => {
  const h = loadDrive({ images: dbImgs(2) }); // fetch mặc định ném lỗi mạng
  await h.runUploadFlow('profile');
  assert.deepEqual(h.deleted, [], 'chưa biết ảnh đã lên hay chưa -> giữ nguyên toàn bộ');
  assert.equal(kinds(h.toasts, 'error').length, 0, 'không được hiện toast "thất bại"');
  const warn = kinds(h.toasts, 'warning').join('\n');
  assert.ok(/Tìm kết nối cũ/.test(warn), 'phải hướng dẫn kiểm tra thư mục trên Drive');
});

test('luồng đầy đủ — REJECTED: hiện toast thất bại kèm message của server, không xóa ảnh', async () => {
  const h = loadDrive({
    images: dbImgs(2),
    fetchImpl: async () => makeResponse({ body: JSON.stringify({ status: 'error', message: 'Unauthorized' }) }),
  });
  await h.runUploadFlow('profile');
  assert.deepEqual(h.deleted, []);
  const errs = kinds(h.toasts, 'error');
  assert.equal(errs.length, 1);
  assert.ok(errs[0].includes('Unauthorized'));
});

test('luồng đầy đủ — ghi link thất bại: cảnh báo "chưa lưu được link", không xóa ảnh', async () => {
  const h = loadDrive({
    images: dbImgs(2),
    persistOk: false,
    fetchImpl: async () => makeResponse({
      body: JSON.stringify({ status: 'success', url: 'https://drive.google.com/folder', files: [okFile(0), okFile(1)] }),
    }),
  });
  await h.runUploadFlow('profile');
  assert.deepEqual(h.deleted, [], 'chưa lưu được link thì không hỏi xóa ảnh gốc');
  assert.equal(h.ctx.currentCustomerData.driveLink, '', 'RAM không được mang link mà DB chưa commit');
  assert.ok(kinds(h.toasts, 'warning').join('\n').includes('CHƯA lưu được link'));
});

test('REGRESSION — lỗi SAU khi Drive đã nhận ảnh không bị báo thành "tải ảnh thất bại"', async () => {
  const h = loadDrive({
    images: dbImgs(2),
    fetchImpl: async () => makeResponse({
      body: JSON.stringify({ status: 'success', url: 'https://drive.google.com/folder', files: [okFile(0), okFile(1)] }),
    }),
  });
  // renderDriveStatus chạy SAU khi Drive đã nhận ảnh: lỗi ở đây là lỗi hiển thị.
  h.ctx.renderDriveStatus = () => { throw new Error('DOM hỏng'); };
  await h.runUploadFlow('profile');
  assert.equal(kinds(h.toasts, 'error').length, 0, 'reachedDrive=true thì không được báo upload thất bại');
  assert.ok(kinds(h.toasts, 'warning').join('\n').includes('đã lên Drive'));
  assert.deepEqual(h.deleted, []);
});

test('REGRESSION — auto-lock trước khi gửi: không request nào rời máy, không xóa ảnh', async () => {
  const h = loadDrive({ images: dbImgs(2), decryptMode: 'stuck' });
  await h.runUploadFlow('profile');
  assert.equal(h.fetchCalls.length, 0);
  assert.deepEqual(h.deleted, []);
  assert.equal(kinds(h.toasts, 'error').length, 0);
});

test('luồng đầy đủ (tài sản) — UNCONFIRMED có url: lưu link nhưng giữ nguyên ảnh gốc', async () => {
  const h = loadDrive({
    assetId: 'a1',
    images: dbImgs(3, 'a1'),
    fetchImpl: async () => makeResponse({
      // files[] lệch số lượng nhưng có id -> đã có file trên Drive.
      body: JSON.stringify({ status: 'partial', url: 'https://drive.google.com/folder', files: [okFile(0), okFile(1)] }),
    }),
  });
  await h.runUploadFlow('asset');
  assert.deepEqual(h.deleted, [], 'không map được index -> không xóa ảnh nào');
  assert.equal(h.ctx.currentCustomerData.assets[0].driveLink, 'https://drive.google.com/folder');
  assert.equal(kinds(h.toasts, 'error').length, 0);
  assert.ok(kinds(h.toasts, 'warning').join('\n').includes('2/3'));
});

test('REGRESSION — UI thường trú sau UNCONFIRMED không được nói "Đã tải ảnh lên Drive"', async () => {
  // Toast cảnh báo biến mất sau vài giây; dòng chú thích trong hồ sơ thì ở lại.
  const h = loadDrive({
    images: dbImgs(3),
    fetchImpl: async () => makeResponse({
      body: JSON.stringify({ status: 'partial', url: 'https://drive.google.com/folder', files: [okFile(0), okFile(1)] }),
    }),
  });
  await h.runUploadFlow('profile');
  const html = h.renderedHtml('drive-status-area');
  assert.ok(html.includes('Mở thư mục ảnh'), 'vẫn cho mở thư mục đã có trên Drive');
  assert.ok(!html.includes('Đã tải ảnh lên Drive'), 'không được khẳng định upload đã xong');
  assert.ok(html.includes('Chưa xác nhận đủ ảnh'), 'phải nói rõ là chưa xác nhận');
});

test('UI thường trú sau OK vẫn là trạng thái hoàn tất như cũ', async () => {
  const h = loadDrive({
    images: dbImgs(2),
    fetchImpl: async () => makeResponse({
      body: JSON.stringify({ status: 'success', url: 'https://drive.google.com/folder', files: [okFile(0), okFile(1)] }),
    }),
  });
  await h.runUploadFlow('profile');
  const html = h.renderedHtml('drive-status-area');
  assert.ok(html.includes('Đã tải ảnh lên Drive'));
  assert.ok(!html.includes('Chưa xác nhận đủ ảnh'));
});

test('REGRESSION — UI tài sản sau UNCONFIRMED cũng phải mang chú thích chưa xác nhận', async () => {
  const h = loadDrive({
    assetId: 'a1',
    images: dbImgs(3, 'a1'),
    fetchImpl: async () => makeResponse({
      body: JSON.stringify({ status: 'partial', url: 'https://drive.google.com/folder', files: [okFile(0), okFile(1)] }),
    }),
  });
  await h.runUploadFlow('asset');
  const html = h.renderedHtml('asset-drive-status-area');
  assert.ok(html.includes('Xem thư mục tài sản'));
  assert.ok(html.includes('Chưa xác nhận đủ ảnh'));
});

test('luồng đầy đủ (tài sản) — ghi link hỏng thì RAM trả về link cũ', async () => {
  const h = loadDrive({
    assetId: 'a1',
    images: dbImgs(2, 'a1'),
    persistOk: false,
    fetchImpl: async () => makeResponse({
      body: JSON.stringify({ status: 'success', url: 'https://drive.google.com/new', files: [okFile(0), okFile(1)] }),
    }),
  });
  h.ctx.currentCustomerData.assets[0].driveLink = 'https://drive.google.com/old';
  await h.runUploadFlow('asset');
  assert.equal(h.ctx.currentCustomerData.assets[0].driveLink, 'https://drive.google.com/old',
    'ghi DB hỏng -> RAM không được giữ link mới');
  assert.deepEqual(h.deleted, []);
});

test('luồng đầy đủ — url rỗng không được xóa link đang có trong hồ sơ', async () => {
  const h = loadDrive({
    images: dbImgs(1),
    fetchImpl: async () => makeResponse({ body: JSON.stringify({ status: 'success', files: [okFile(0)] }) }),
  });
  h.ctx.currentCustomerData.driveLink = 'https://drive.google.com/cu';
  await h.runUploadFlow('profile');
  assert.equal(h.ctx.currentCustomerData.driveLink, 'https://drive.google.com/cu',
    'response không kèm url -> giữ nguyên link cũ, không gán đè rỗng');
  assert.deepEqual(h.deleted, [], 'không lưu được link thì không hỏi xóa ảnh gốc');
});

// ---------------------------------------------------------------------------
// Thông báo cho người dùng
// ---------------------------------------------------------------------------

test('thông báo UNCONFIRMED không khẳng định thất bại và chỉ đúng việc cần làm', () => {
  const { unconfirmedMessage } = loadDrive();
  const noInfo = unconfirmedMessage({ uploadedCount: null }, 3);
  assert.ok(!/thất bại/i.test(noInfo), 'không được nói "thất bại" khi chưa biết kết quả');
  assert.ok(/Tìm kết nối cũ/.test(noInfo), 'phải hướng dẫn kiểm tra bằng "Tìm kết nối cũ"');
  assert.ok(/giữ nguyên/.test(noInfo), 'phải nói rõ ảnh gốc còn nguyên trong máy');

  const partial = unconfirmedMessage({ uploadedCount: 2 }, 3);
  assert.ok(partial.includes('2/3'), 'biết số ảnh Drive đã nhận thì phải nói ra');
  assert.ok(!/thất bại/i.test(partial));
});

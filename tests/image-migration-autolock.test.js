'use strict';

// ============================================================================
// image-migration-autolock.test.js — runImageCryptoMigrationIfNeeded() phải
// fail-closed khi mất masterKey giữa chừng.
//
// encryptImageData() fail-open: không có masterKey thì trả NGUYÊN data URL
// plaintext. Auto-lock nổ giữa vòng lặp migration mà không có chốt chặn thì ảnh
// còn lại bị ghi plaintext kèm imgCryptoV=1, rồi marker toàn cục
// app_image_crypto_schema_v=1 được set -> mọi lần mở khóa sau bỏ qua migration
// và ảnh nằm plaintext trong IndexedDB vĩnh viễn.
//
// Chạy 02_security.js THẬT trong vm sandbox (tests/helpers/load-security.js).
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSecurity, makeFakeDb } = require('./helpers/load-security');

const IMG_SCHEMA_KEY = 'app_image_crypto_schema_v';
const GCM_PREFIX = 'cpg1:';
const PLAIN_1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg1111';
const PLAIN_2 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAA2222';

/** db giả + hook chạy ngay khi lần put ĐẦU TIÊN được phát (mô phỏng auto-lock). */
function dbWithHookOnFirstPut(images, onFirstPut) {
  const db = makeFakeDb([], images);
  const origTransaction = db.transaction.bind(db);
  let puts = 0;
  db.transaction = function (...args) {
    const tx = origTransaction(...args);
    const origObjectStore = tx.objectStore.bind(tx);
    tx.objectStore = (name) => {
      const store = origObjectStore(name);
      const origPut = store.put.bind(store);
      store.put = (v) => {
        puts += 1;
        if (puts === 1) onFirstPut();
        return origPut(v);
      };
      return store;
    };
    return tx;
  };
  return db;
}

test('mất masterKey giữa migration: ảnh còn lại KHÔNG bị ghi plaintext, marker KHÔNG set', async () => {
  const { api, localStorage } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());

  const img1 = { id: 'i1', customerId: 'c1', data: PLAIN_1 };
  const img2 = { id: 'i2', customerId: 'c1', data: PLAIN_2 };
  // Auto-lock nổ ngay sau khi ảnh đầu được ghi -> ảnh thứ hai mã hóa khi đã mất key.
  const db = dbWithHookOnFirstPut([img1, img2], () => api.clearMasterKeyMaterial());
  api.setDb(db);

  await api.runImageCryptoMigrationIfNeeded();

  const stored1 = db._stores.images.get('i1');
  const stored2 = db._stores.images.get('i2');

  assert.ok(stored1.data.startsWith(GCM_PREFIX), 'Ảnh đầu (mã hóa trước khi mất key) phải là ciphertext');
  assert.equal(stored1.imgCryptoV, 1);

  assert.equal(stored2.data, PLAIN_2, 'Ảnh thứ hai phải giữ NGUYÊN, không bị ghi đè');
  assert.notEqual(stored2.imgCryptoV, 1, 'Không được đánh dấu đã mã hóa khi thực tế vẫn plaintext');
  assert.ok(!String(stored2.data).startsWith(GCM_PREFIX));

  assert.equal(localStorage.getItem(IMG_SCHEMA_KEY), null,
    'Còn ảnh chưa mã hóa thì marker phải để trống cho lần mở khóa sau retry');
});

test('resume: mở khóa lại xong migration phần còn lại rồi mới set marker', async () => {
  const { api, localStorage } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());

  const img1 = { id: 'i1', data: PLAIN_1 };
  const img2 = { id: 'i2', data: PLAIN_2 };
  const db = dbWithHookOnFirstPut([img1, img2], () => api.clearMasterKeyMaterial());
  api.setDb(db);
  await api.runImageCryptoMigrationIfNeeded();
  assert.equal(localStorage.getItem(IMG_SCHEMA_KEY), null);

  // Lần mở khóa sau: key mới, db không còn hook -> chạy nốt ảnh thứ hai.
  await api.setMasterKey(api.generateMasterKey());
  api.setDb(makeFakeDbFrom(db));
  await api.runImageCryptoMigrationIfNeeded();

  assert.equal(localStorage.getItem(IMG_SCHEMA_KEY), '1', 'Sạch hết thì mới set marker');
});

/** Dựng db giả mới từ nội dung store hiện tại (bỏ hook auto-lock). */
function makeFakeDbFrom(db) {
  return makeFakeDb([], [...db._stores.images.values()]);
}

test('lỗi đọc IndexedDB KHÔNG được coi là "không có ảnh" rồi set marker', async () => {
  const { api, localStorage } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());

  api.setDb({
    objectStoreNames: { contains: () => true },
    transaction: () => { throw new Error('IDB read failed'); },
  });

  await api.runImageCryptoMigrationIfNeeded();

  assert.equal(localStorage.getItem(IMG_SCHEMA_KEY), null,
    'Đọc lỗi -> hoãn migration, không set marker (nếu set thì ảnh plaintext mất cơ hội mã hóa vĩnh viễn)');
});

test('đường bình thường: mọi ảnh mã hóa xong -> set marker', async () => {
  const { api, localStorage } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());

  const db = makeFakeDb([], [{ id: 'i1', data: PLAIN_1 }, { id: 'i2', data: PLAIN_2 }]);
  api.setDb(db);

  await api.runImageCryptoMigrationIfNeeded();

  for (const im of db._stores.images.values()) {
    assert.ok(im.data.startsWith(GCM_PREFIX), `Ảnh ${im.id} phải là ciphertext`);
    assert.equal(im.imgCryptoV, 1);
  }
  assert.equal(localStorage.getItem(IMG_SCHEMA_KEY), '1');
  // Giải mã lại phải ra đúng ảnh gốc (không mất dữ liệu).
  assert.equal(await api.decryptImageData(db._stores.images.get('i1').data), PLAIN_1);
});

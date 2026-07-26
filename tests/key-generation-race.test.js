'use strict';

// ============================================================================
// key-generation-race.test.js — khóa/thu hồi phải vô hiệu hóa công việc crypto
// đang bay.
//
// clearMasterKeyMaterial() chỉ xóa tham chiếu hiện tại; nó KHÔNG hủy được các
// promise đang chạy. Không có "thế hệ khóa" thì:
//   - _installMasterKey() gán masterCryptoKey SAU await importKey -> hồi sinh
//     khóa cho phiên vừa bị khóa/thu hồi;
//   - decryptFieldAsync() ghi plaintext trở lại __fieldPlainCache trong .then().
//
// Chạy 02_security.js THẬT trong vm sandbox (tests/helpers/load-security.js).
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSecurity } = require('./helpers/load-security');

test('khóa xen giữa importKey: KHÔNG hồi sinh masterCryptoKey', async () => {
  const { api, ctx } = loadSecurity();

  // Chặn ngay trong importKey để mô phỏng auto-lock/thu hồi rơi đúng khe await.
  const realImportKey = ctx.crypto.subtle.importKey.bind(ctx.crypto.subtle);
  let armed = true;
  ctx.crypto = {
    ...ctx.crypto,
    subtle: {
      ...ctx.crypto.subtle,
      importKey: async (...args) => {
        const key = await realImportKey(...args);
        if (armed) { armed = false; api.clearMasterKeyMaterial(); }
        return key;
      },
      encrypt: ctx.crypto.subtle.encrypt.bind(ctx.crypto.subtle),
      decrypt: ctx.crypto.subtle.decrypt.bind(ctx.crypto.subtle),
      deriveBits: ctx.crypto.subtle.deriveBits.bind(ctx.crypto.subtle),
    },
    getRandomValues: ctx.crypto.getRandomValues.bind(ctx.crypto),
  };

  await api.setMasterKey(api.generateMasterKey());

  const st = api.getState();
  assert.equal(st.mk, null, 'masterKey phải ở trạng thái đã xóa');
  assert.equal(st.hasGcmKey, false,
    'masterCryptoKey KHÔNG được gán sau khi phiên đã bị khóa giữa lúc importKey');
  assert.equal(api.isAppUnlocked(), false);
});

test('khóa xen giữa giải mã field: plaintext KHÔNG quay lại cache', async () => {
  const { api } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());

  const cipher = await api.encryptText('Nguyễn Văn A');
  api.resetFieldCache();

  // Bắt đầu giải mã rồi khóa NGAY, trước khi promise hoàn tất.
  const pending = api.decryptFieldAsync(cipher);
  api.clearMasterKeyMaterial();
  await pending.catch(() => {});
  // Nhả thêm vài microtask để .then() của decryptFieldAsync chắc chắn đã chạy.
  await Promise.resolve();
  await Promise.resolve();

  // decryptText đọc thẳng __fieldPlainCache: có hit nghĩa là plaintext đã bị nạp
  // lại vào cache của phiên đã khóa.
  assert.equal(api.decryptText(cipher), cipher,
    'Cache phải rỗng sau khi khóa — không được nạp lại plaintext từ promise cũ');
});

test('mở khóa lại bình thường vẫn hoạt động (thế hệ mới không tự chặn mình)', async () => {
  const { api } = loadSecurity();
  const mk = api.generateMasterKey();
  await api.setMasterKey(mk);
  const cipher = await api.encryptText('123456789');

  api.clearMasterKeyMaterial();
  assert.equal(api.isAppUnlocked(), false);

  await api.setMasterKey(mk);
  assert.equal(api.isAppUnlocked(), true, 'Cài lại khóa phải thành công');
  assert.equal(api.getState().hasGcmKey, true);
  assert.equal(await api.decryptFieldAsync(cipher), '123456789', 'Giải mã lại phải đúng');
});

test('mã NV không quay lại RAM nếu phiên bị thu hồi giữa seal migration', async () => {
  const { api, localStorage } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  localStorage.setItem('app_employee_id', 'NV001');

  // Thu hồi ngay khi migration còn đang seal (giữa các await).
  const running = api.runEmployeeIdSealMigrationIfNeeded();
  api.revokeUnlockedSession();
  await running;

  assert.equal(api.getEmployeeIdRam(), null,
    'Mã NV (secret khôi phục masterKey) không được nạp vào RAM của phiên đã thu hồi');
});

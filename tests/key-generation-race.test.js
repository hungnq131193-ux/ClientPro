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

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

/**
 * Giữ lại từng lần crypto.subtle.decrypt SAU khi đã giải mã thật: test tự quyết
 * định thời điểm promise của decryptFieldAsync hoàn tất, nên mô phỏng được
 * lock/revoke rơi đúng giữa await mà không cần stub cả tầng crypto.
 * @returns {Array<{promise: Promise, resolve: Function}>} cổng theo thứ tự gọi
 */
function hookDecryptGates(ctx) {
  const realSubtle = ctx.crypto.subtle;
  const realDecrypt = realSubtle.decrypt.bind(realSubtle);
  const gates = [];
  ctx.crypto = {
    getRandomValues: ctx.crypto.getRandomValues.bind(ctx.crypto),
    subtle: {
      importKey: realSubtle.importKey.bind(realSubtle),
      encrypt: realSubtle.encrypt.bind(realSubtle),
      deriveKey: realSubtle.deriveKey.bind(realSubtle),
      digest: realSubtle.digest.bind(realSubtle),
      decrypt: async (...args) => {
        const out = await realDecrypt(...args);
        const gate = deferred();
        gates.push(gate);
        await gate.promise;
        return out;
      },
    },
  };
  return gates;
}

async function waitFor(cond, label) {
  for (let i = 0; i < 500; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error(`Hết thời gian chờ: ${label}`);
}

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

  // FAIL-CLOSED: cài khóa cho một phiên đã chết phải BÁO LỖI, không im lặng trả về —
  // caller (saveSecuritySetup/checkRecovery) không được phép tưởng khóa đã cài rồi
  // niêm phong PIN_KEY/SEC_KEY bằng masterKey rỗng.
  await assert.rejects(
    api.setMasterKey(api.generateMasterKey()),
    /STALE_KEY_GENERATION/,
    '_installMasterKey phải throw khi thế hệ khóa đổi giữa lúc importKey'
  );

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

test('thế hệ đổi giữa lúc giải mã: caller nhận CIPHERTEXT, không phải plaintext', async () => {
  // Trả plaintext cho caller của phiên cũ là đủ để rò: _ensureSummaryDecryptedAsync
  // (05_customers.js) sẽ ghi giá trị đó vào __custSummaryCache mà
  // clearMasterKeyMaterial() vừa dọn. Đường render đã chặn ciphertext bằng
  // _looksEncrypted nên trả nguyên ciphertext là an toàn.
  const { api, ctx } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  const cipher = await api.encryptText('Nguyễn Văn A');
  api.resetFieldCache();

  const gates = hookDecryptGates(ctx);
  const pending = api.decryptFieldAsync(cipher);
  await waitFor(() => gates.length >= 1, 'decrypt chưa được gọi');

  api.clearMasterKeyMaterial(); // auto-lock / thu hồi rơi giữa await
  gates[0].resolve();

  assert.equal(await pending, cipher,
    'Phiên đã chết thì caller phải nhận ciphertext, không được nhận plaintext');
  assert.equal(api.fieldCacheSize(), 0, 'Không nạp plaintext trở lại field cache');
});

test('promise cũ hoàn tất KHÔNG xóa pending entry của phiên mở khóa mới', async () => {
  const { api, ctx } = loadSecurity();
  const mk = api.generateMasterKey();
  await api.setMasterKey(mk);
  const cipher = await api.encryptText('0912345678');
  api.resetFieldCache();

  const gates = hookDecryptGates(ctx);
  const oldPending = api.decryptFieldAsync(cipher);
  await waitFor(() => gates.length >= 1, 'decrypt phiên cũ chưa được gọi');

  // Khóa rồi mở khóa lại bằng CHÍNH khóa đó -> ciphertext vẫn giải mã được.
  api.clearMasterKeyMaterial();
  await api.setMasterKey(mk);

  // Phiên mới tạo pending riêng cho cùng ciphertext.
  const newPending = api.decryptFieldAsync(cipher);
  const newEntry = api.getPendingDecrypt(cipher);
  assert.ok(newEntry, 'Phiên mới phải sở hữu pending entry');
  await waitFor(() => gates.length >= 2, 'decrypt phiên mới chưa được gọi');

  gates[0].resolve();
  assert.equal(await oldPending, cipher, 'Promise cũ vẫn trả ciphertext');
  assert.equal(api.getPendingDecrypt(cipher), newEntry,
    'Promise cũ hoàn tất không được xóa entry của phiên mới (mất dedupe)');

  gates[1].resolve();
  assert.equal(await newPending, '0912345678', 'Phiên mới giải mã bình thường');
  assert.equal(api.hasPendingDecrypt(cipher), false,
    'Promise hiện hành hoàn tất thì tự dọn entry của chính nó');
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

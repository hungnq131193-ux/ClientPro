'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSecurity } = require('./helpers/load-security');

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

// Giữ từng crypto.subtle.decrypt sau khi WebCrypto đã giải mã thật để đặt
// lock/revoke chính xác vào khe await mà không stub toàn bộ tầng crypto.
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

test('khóa xen giữa giải mã field: plaintext KHÔNG quay lại cache', async () => {
  const { api } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());

  const cipher = await api.encryptText('Nguyễn Văn A');
  api.resetFieldCache();

  const pending = api.decryptFieldAsync(cipher);
  api.clearMasterKeyMaterial();
  await pending.catch(() => {});
  await Promise.resolve();
  await Promise.resolve();

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
  const { api, ctx } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  const cipher = await api.encryptText('Nguyễn Văn A');
  api.resetFieldCache();

  const gates = hookDecryptGates(ctx);
  const pending = api.decryptFieldAsync(cipher);
  await waitFor(() => gates.length >= 1, 'decrypt chưa được gọi');

  api.clearMasterKeyMaterial();
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

  api.clearMasterKeyMaterial();
  await api.setMasterKey(mk);

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

  const running = api.runEmployeeIdSealMigrationIfNeeded();
  api.revokeUnlockedSession();
  await running;

  assert.equal(api.getEmployeeIdRam(), null,
    'Mã NV (secret khôi phục masterKey) không được nạp vào RAM của phiên đã thu hồi');
});

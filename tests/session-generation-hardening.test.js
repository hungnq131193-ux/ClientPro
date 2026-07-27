'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSecurity, makeFakeDb } = require('./helpers/load-security');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function waitFor(cond, label) {
  for (let i = 0; i < 500; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error(`Hết thời gian chờ: ${label}`);
}

function wrapCrypto(ctx, overrides) {
  const subtle = ctx.crypto.subtle;
  ctx.crypto = {
    getRandomValues: ctx.crypto.getRandomValues.bind(ctx.crypto),
    subtle: {
      importKey: subtle.importKey.bind(subtle),
      encrypt: subtle.encrypt.bind(subtle),
      decrypt: subtle.decrypt.bind(subtle),
      deriveKey: subtle.deriveKey.bind(subtle),
      deriveBits: subtle.deriveBits ? subtle.deriveBits.bind(subtle) : undefined,
      digest: subtle.digest.bind(subtle),
      ...overrides,
    },
  };
}

test('auto-lock giữa encrypt: không trả ciphertext và không hồi sinh plaintext cache', async () => {
  const { api, ctx } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  const started = deferred();
  const release = deferred();
  const realEncrypt = ctx.crypto.subtle.encrypt.bind(ctx.crypto.subtle);
  wrapCrypto(ctx, {
    encrypt: async (...args) => {
      const out = await realEncrypt(...args);
      started.resolve();
      await release.promise;
      return out;
    },
  });

  const pending = api._gcmEncryptField('bí mật đang mã hóa');
  await started.promise;
  api.clearMasterKeyMaterial();
  release.resolve();
  await assert.rejects(pending, /STALE_KEY_GENERATION/);
  assert.equal(api.fieldCacheSize(), 0);
  assert.equal(api.isAppUnlocked(), false);
});

test('summary Promise.all không gán nửa plaintext khi lock xen giữa các field', async () => {
  const { api, ctx } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  const original = {
    name: await api.encryptText('Nguyễn Văn A'),
    phone: await api.encryptText('0912345678'),
    cccd: await api.encryptText('001234567890'),
  };
  api.resetFieldCache();

  const realDecrypt = ctx.crypto.subtle.decrypt.bind(ctx.crypto.subtle);
  const gates = [];
  wrapCrypto(ctx, {
    decrypt: async (...args) => {
      const out = await realDecrypt(...args);
      const gate = deferred();
      gates.push(gate);
      await gate.promise;
      return out;
    },
  });

  const customer = { ...original };
  const running = api.decryptCustomerSummaryAsync(customer);
  await waitFor(() => gates.length === 3, 'ba field chưa bắt đầu giải mã');
  gates[0].resolve();
  await Promise.resolve(); await Promise.resolve();
  api.clearMasterKeyMaterial();
  gates[1].resolve(); gates[2].resolve();
  await running;

  assert.deepEqual(customer, original, 'không field nào được gán plaintext khi generation đã đổi');
  assert.equal(api.fieldCacheSize(), 0);
});

test('ensureBackupSecret bỏ response success nếu app khóa trong lúc chờ mạng', async () => {
  const { api, ctx, localStorage } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  api.setEmployeeIdRam('NV001');
  localStorage.setItem('app_activated', 'true');
  ctx.ADMIN_SERVER_URL = 'https://gas.test';
  const started = deferred();
  const release = deferred();
  ctx.fetch = async () => {
    started.resolve();
    return { text: async () => { await release.promise; return JSON.stringify({ status: 'success', kdata_b64u: 'A'.repeat(43) }); } };
  };

  const pending = api.ensureBackupSecret();
  await started.promise;
  api.clearMasterKeyMaterial();
  release.resolve();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(api.getKdataRam(), '');
});

test('check_status cũ không thu hồi phiên mới sau khi generation thay đổi', async () => {
  const { api, ctx, localStorage } = loadSecurity();
  const mk = api.generateMasterKey();
  await api.setMasterKey(mk);
  api.setEmployeeIdRam('NV001');
  localStorage.setItem('app_activated', 'true');
  ctx.ADMIN_SERVER_URL = 'https://gas.test';
  const started = deferred();
  const release = deferred();
  ctx.fetch = async () => {
    started.resolve();
    return { text: async () => { await release.promise; return JSON.stringify({ status: 'locked', message: 'old response' }); } };
  };

  const oldRequest = api.runServerStatusCheck();
  await started.promise;
  api.clearMasterKeyMaterial();
  await api.setMasterKey(mk);
  api.setEmployeeIdRam('NV001');
  release.resolve();
  await oldRequest;

  assert.equal(localStorage.getItem('app_activated'), 'true');
  assert.equal(api.isAppUnlocked(), true);
});

test('legacy migration: lỗi getAllKeys không swap PIN/schema và giữ stage để resume', async () => {
  const { api, localStorage } = loadSecurity();
  api.setLegacyMasterKey('mk_legacy_test');
  localStorage.setItem('app_pin', 'legacy-pin-envelope');
  api.setDb({
    transaction() {
      return {
        objectStore() {
          return {
            getAllKeys() {
              const req = { onsuccess: null, onerror: null, error: null };
              Promise.resolve().then(() => {
                req.error = new Error('IDB read failed');
                if (req.onerror) req.onerror({ target: req });
              });
              return req;
            },
          };
        },
      };
    },
  });

  await assert.rejects(() => api.runFieldCryptoMigrationIfNeeded('1234', 'NV001'), /IDB read failed|LEGACY_MIGR_KEYS_READ_ERROR/);
  assert.equal(localStorage.getItem('app_pin'), 'legacy-pin-envelope');
  assert.equal(localStorage.getItem('app_crypto_schema_v'), null);
  assert.ok(localStorage.getItem('app_pin_v2_stage'), 'stage phải còn để retry');
});

test('legacy migration: token Drive hỏng không finalize và không ghi đè token', async () => {
  const { api, localStorage } = loadSecurity();
  api.setLegacyMasterKey('mk_legacy_test');
  api.setDb(makeFakeDb([], []));
  localStorage.setItem('app_pin', 'legacy-pin-envelope');
  const broken = 'sealed.v1:U2FsdGVkBROKEN';
  localStorage.setItem('app_user_script_token', broken);

  await assert.rejects(() => api.runFieldCryptoMigrationIfNeeded('1234', 'NV001'), /DRIVE_TOKEN_LEGACY_DECRYPT_FAILED/);
  assert.equal(localStorage.getItem('app_pin'), 'legacy-pin-envelope');
  assert.equal(localStorage.getItem('app_crypto_schema_v'), null);
  assert.equal(localStorage.getItem('app_user_script_token'), broken);
});

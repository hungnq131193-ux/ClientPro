'use strict';

// Regressions for the security hardening after PR #132/#133.
// Tests run the real assets/02_security.js inside the shared VM harness.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSecurity, makeFakeDb } = require('./helpers/load-security');

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

async function waitFor(cond, label) {
  for (let i = 0; i < 500; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error(`Hết thời gian chờ: ${label}`);
}

function gateCrypto(ctx, method) {
  const real = ctx.crypto.subtle;
  const realMethod = real[method].bind(real);
  const gates = [];
  ctx.crypto = {
    getRandomValues: ctx.crypto.getRandomValues.bind(ctx.crypto),
    subtle: {
      importKey: real.importKey.bind(real),
      encrypt: method === 'encrypt' ? async (...args) => {
        const out = await realMethod(...args);
        const gate = deferred(); gates.push(gate); await gate.promise; return out;
      } : real.encrypt.bind(real),
      decrypt: method === 'decrypt' ? async (...args) => {
        const out = await realMethod(...args);
        const gate = deferred(); gates.push(gate); await gate.promise; return out;
      } : real.decrypt.bind(real),
      deriveKey: real.deriveKey.bind(real),
      deriveBits: real.deriveBits ? real.deriveBits.bind(real) : undefined,
      digest: real.digest.bind(real),
    },
  };
  return gates;
}

function failingKeysDb() {
  return {
    transaction() {
      return {
        objectStore() {
          return {
            getAllKeys() {
              const req = { error: new Error('IDB read failed'), onsuccess: null, onerror: null };
              Promise.resolve().then(() => { if (req.onerror) req.onerror({ target: req }); });
              return req;
            },
          };
        },
      };
    },
  };
}

function prepareLegacy(api, localStorage, db) {
  api.setLegacyMasterKey('mk_legacy_test_key');
  api.setDb(db);
  localStorage.setItem('app_pin', 'legacy-pin-envelope');
  localStorage.setItem('app_sec_qa', 'legacy-sec-envelope');
}

test('auto-lock giữa _gcmEncryptField: không trả ciphertext cũ và không nạp plaintext lại cache', async () => {
  const { api, ctx } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  const gates = gateCrypto(ctx, 'encrypt');

  const pending = api._gcmEncryptField('bí mật');
  await waitFor(() => gates.length === 1, 'encrypt gate');
  api.clearMasterKeyMaterial();
  gates[0].resolve();

  await assert.rejects(pending, /STALE_KEY_GENERATION/);
  assert.equal(api.fieldCacheSize(), 0);
  assert.equal(api.isAppUnlocked(), false);
});

test('auto-lock giữa _gcmDecryptField: caller trực tiếp không nhận plaintext', async () => {
  const { api, ctx } = loadSecurity();
  const mk = api.generateMasterKey();
  await api.setMasterKey(mk);
  const cipher = await api.encryptText('0912345678');
  api.resetFieldCache();
  const gates = gateCrypto(ctx, 'decrypt');

  const pending = api._gcmDecryptField(cipher);
  await waitFor(() => gates.length === 1, 'decrypt gate');
  api.clearMasterKeyMaterial();
  gates[0].resolve();

  await assert.rejects(pending, /STALE_KEY_GENERATION/);
  assert.equal(api.fieldCacheSize(), 0);
});

test('legacy migration: lỗi getAllKeys không được coi là store rỗng hoặc swap envelope', async () => {
  const { api, localStorage } = loadSecurity();
  prepareLegacy(api, localStorage, failingKeysDb());

  await assert.rejects(
    api.runFieldCryptoMigrationIfNeeded('1234', 'NV001'),
    /IDB read failed|FIELD_CRYPTO_KEYS_READ_ERROR/
  );
  assert.equal(localStorage.getItem('app_crypto_schema_v'), null);
  assert.equal(localStorage.getItem('app_pin'), 'legacy-pin-envelope');
  assert.equal(localStorage.getItem('app_sec_qa'), 'legacy-sec-envelope');
  assert.ok(localStorage.getItem('app_pin_v2_stage'), 'stage phải giữ lại để resume');
});

test('legacy migration: auto-lock giữa importKey không hồi sinh masterKey hoặc finalize schema', async () => {
  const { api, localStorage, ctx } = loadSecurity();
  prepareLegacy(api, localStorage, makeFakeDb([], []));

  const real = ctx.crypto.subtle;
  const realImport = real.importKey.bind(real);
  let armed = true;
  ctx.crypto = {
    getRandomValues: ctx.crypto.getRandomValues.bind(ctx.crypto),
    subtle: {
      importKey: async (...args) => {
        const out = await realImport(...args);
        const alg = args[2];
        if (armed && args[0] === 'raw' && alg && alg.name === 'AES-GCM') {
          armed = false;
          api.clearMasterKeyMaterial();
        }
        return out;
      },
      encrypt: real.encrypt.bind(real),
      decrypt: real.decrypt.bind(real),
      deriveKey: real.deriveKey.bind(real),
      deriveBits: real.deriveBits ? real.deriveBits.bind(real) : undefined,
      digest: real.digest.bind(real),
    },
  };

  await assert.rejects(
    api.runFieldCryptoMigrationIfNeeded('1234', 'NV001'),
    /FIELD_CRYPTO_MIGRATION_STALE_SESSION/
  );
  assert.equal(api.isAppUnlocked(), false);
  assert.equal(api.getState().hasGcmKey, false);
  assert.equal(localStorage.getItem('app_crypto_schema_v'), null);
  assert.equal(localStorage.getItem('app_pin'), 'legacy-pin-envelope');
});

test('legacy Drive token lỗi: migration dừng trước khi đổi PIN/SEC envelope', async () => {
  const { api, localStorage } = loadSecurity();
  prepareLegacy(api, localStorage, makeFakeDb([], []));
  localStorage.setItem('app_user_script_token', 'sealed.v1:U2FsdGVkINVALID');

  await assert.rejects(
    api.runFieldCryptoMigrationIfNeeded('1234', 'NV001'),
    /DRIVE_TOKEN_LEGACY_DECRYPT_FAILED/
  );
  assert.equal(localStorage.getItem('app_crypto_schema_v'), null);
  assert.equal(localStorage.getItem('app_pin'), 'legacy-pin-envelope');
  assert.equal(localStorage.getItem('app_sec_qa'), 'legacy-sec-envelope');
});

test('issue_kdata báo khóa: ensureBackupSecret thu hồi phiên và xóa activation', async () => {
  const { api, localStorage, ctx } = loadSecurity();
  localStorage.setItem('app_activated', '1');
  await api.setMasterKey(api.generateMasterKey());
  api.setEmployeeIdRam('NV001');
  api.setKdataRam('plaintext-kdata');
  ctx.ADMIN_SERVER_URL = 'https://example.invalid/gas';
  ctx.fetch = async () => ({
    text: async () => JSON.stringify({ status: 'error', message: 'ISSUE_KDATA FAIL: tai khoan bi khoa' }),
  });

  const result = await api.ensureBackupSecret();
  assert.equal(result.ok, false);
  assert.equal(api.isAppUnlocked(), false);
  assert.equal(api.getKdataRam(), '');
  assert.equal(localStorage.getItem('app_activated'), null);
});

test('lock/revoke xóa transfer-key cache khỏi RAM', async () => {
  const { api, ctx } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  api.setEmployeeIdRam('NV001');
  ctx.ADMIN_SERVER_URL = 'https://example.invalid/gas';
  ctx.fetch = async () => ({
    text: async () => JSON.stringify({ status: 'success', kdata_b64u: 'A'.repeat(43) }),
  });

  await api.ensureTransferKey('NV002');
  assert.equal(api.transferKeyCacheSize(), 1);
  api.clearMasterKeyMaterial();
  assert.equal(api.transferKeyCacheSize(), 0);
});

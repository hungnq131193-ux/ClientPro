'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSecurity, makeFakeDb, CryptoJS } = require('./helpers/load-security');

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

/**
 * Dựng một ciphertext legacy của KHÓA KHÁC, chọn đúng mẫu mà giải bằng khóa sai sẽ
 * trả "" mà KHÔNG ném — tức ca nguy hiểm nhất mà guard sigBytes sinh ra để bắt.
 *
 * Giải sai khóa cho ra rác ngẫu nhiên nên kết quả KHÔNG tất định (đo thực tế: ~87%
 * ra "", ~12% ném "Malformed UTF-8 data", ~0.6% ra chuỗi rác khác rỗng). Chốt cứng
 * một mẫu sinh ngẫu nhiên làm test flaky theo salt/IV; ở đây ta LỌC lấy đúng mẫu cần.
 */
function foreignCiphertextDecodingToEmpty(wrongKey) {
  for (let i = 0; i < 500; i++) {
    const ct = CryptoJS.AES.encrypt('dữ liệu của khóa khác', 'mk_khac_hoan_toan').toString();
    try {
      if (CryptoJS.AES.decrypt(ct, wrongKey).toString(CryptoJS.enc.Utf8) === '') return ct;
    } catch (e) { /* rác là UTF-8 hỏng -> lấy mẫu khác */ }
  }
  throw new Error('Không dựng được ciphertext ngoại lai giải ra rỗng');
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

// Token Drive hỏng là recoverable (user nhập lại) — không được chặn vĩnh viễn việc
// hoàn tất migration mã hoá: ném ở đây thì mọi lần mở khoá đều ném lại, SCHEMA_KEY
// không bao giờ thành "2" và PIN_KEY kẹt ở envelope legacy.
test('legacy migration: token Drive hỏng không chặn finalize và không ghi đè token', async () => {
  const { api, localStorage } = loadSecurity();
  api.setLegacyMasterKey('mk_legacy_test');
  api.setDb(makeFakeDb([], []));
  localStorage.setItem('app_pin', 'legacy-pin-envelope');
  // Ciphertext ĐÚNG ĐỊNH DẠNG nhưng của khóa khác. Không dùng chuỗi base64 cụt kiểu
  // 'U2FsdGVkBROKEN': block không căn hàng khiến CryptoJS đọc quá mảng words và nhặt
  // phải residue của các thao tác trước trong cùng tiến trình -> kết quả đổi theo thứ
  // tự test (đo được ~4% ra khác rỗng) và làm CI đỏ ngẫu nhiên.
  const broken = 'sealed.v1:' + foreignCiphertextDecodingToEmpty('mk_legacy_test');
  localStorage.setItem('app_user_script_token', broken);

  await api.runFieldCryptoMigrationIfNeeded('1234', 'NV001');
  assert.equal(localStorage.getItem('app_crypto_schema_v'), '2');
  assert.notEqual(localStorage.getItem('app_pin'), 'legacy-pin-envelope');
  assert.ok(localStorage.getItem('app_pin'), 'PIN_KEY phải được swap sang envelope MK2');
  assert.equal(localStorage.getItem('app_pin_v2_stage'), null, 'stage phải được dọn sau finalize');
  assert.equal(localStorage.getItem('app_user_script_token'), broken, 'token hỏng giữ nguyên, không ghi đè/xoá');
});

// Ghi token thất bại (quota/storage lỗi) VẪN phải fail-closed: khác hẳn ca token không
// giải mã được ở trên — ở đây migration đã tạo được ciphertext mới nhưng không persist nổi.
test('legacy migration: ghi token Drive thất bại vẫn chặn finalize', async () => {
  const { api, localStorage } = loadSecurity();
  api.setLegacyMasterKey('mk_legacy_test');
  api.setDb(makeFakeDb([], []));
  localStorage.setItem('app_pin', 'legacy-pin-envelope');
  localStorage.setItem('app_user_script_token', 'sealed.v1:' + CryptoJS.AES.encrypt('tok-secret', 'mk_legacy_test').toString());

  const realSet = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (k, v) => { if (k === 'app_user_script_token') return; return realSet(k, v); };
  try {
    await assert.rejects(() => api.runFieldCryptoMigrationIfNeeded('1234', 'NV001'), /DRIVE_TOKEN_MIGR_WRITE_FAILED/);
  } finally {
    localStorage.setItem = realSet;
  }
  assert.equal(localStorage.getItem('app_pin'), 'legacy-pin-envelope');
  assert.equal(localStorage.getItem('app_crypto_schema_v'), null);
  assert.ok(localStorage.getItem('app_pin_v2_stage'), 'stage phải còn để retry');
});

// ---------------------------------------------------------------------------
// Codex #134: migration legacy dở dang không được để đường re-seal xoá khóa legacy
// ---------------------------------------------------------------------------

// _installMasterKey(mkStr) cài MK2 làm khóa phiên NGAY đầu migration. Nếu migration
// hỏng giữa chừng, saveSecuritySetup() (nâng cấp PIN bắt buộc sau validatePin) sẽ
// niêm phong MK2 vào PIN_KEY/SEC_KEY -> khóa legacy biến mất -> lần mở app sau nhánh
// resume-after-swap set SCHEMA="2" và mọi record U2FsdGVk… còn lại chết vĩnh viễn.
test('migration legacy hỏng: chặn re-seal PIN/SEC bằng MK2 (giữ khóa legacy)', async () => {
  const { api, localStorage } = loadSecurity();
  api.setLegacyMasterKey('mk_legacy_test');
  localStorage.setItem('app_pin', 'legacy-pin-envelope');
  localStorage.setItem('app_sec_qa', 'legacy-sec-envelope');
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

  await assert.rejects(() => api.runFieldCryptoMigrationIfNeeded('123456', 'NV001'));

  // Trạng thái nguy hiểm có thật: khóa phiên đã là MK2 trong khi PIN/SEC còn legacy.
  assert.ok(String(api.getMasterKey()).startsWith('MK2:'), 'migration đã cài MK2 làm khóa phiên');
  assert.equal(api.isLegacyMigrationUnfinished(), true, 'cờ chặn re-seal phải bật');

  // Đường phá dữ liệu: saveSecuritySetup phải từ chối, không đụng PIN_KEY/SEC_KEY.
  await api.saveSecuritySetup();
  assert.equal(localStorage.getItem('app_pin'), 'legacy-pin-envelope');
  assert.equal(localStorage.getItem('app_sec_qa'), 'legacy-sec-envelope');
  assert.equal(localStorage.getItem('app_crypto_schema_v'), null);
  assert.ok(localStorage.getItem('app_pin_v2_stage'), 'stage phải còn để resume');
});

test('migration legacy xong: cờ chặn re-seal được gỡ', async () => {
  const { api, localStorage } = loadSecurity();
  api.setLegacyMasterKey('mk_legacy_test');
  api.setDb(makeFakeDb([], []));
  localStorage.setItem('app_pin', 'legacy-pin-envelope');

  await api.runFieldCryptoMigrationIfNeeded('123456', 'NV001');
  assert.equal(localStorage.getItem('app_crypto_schema_v'), '2');
  assert.equal(api.isLegacyMigrationUnfinished(), false);
});

// ---------------------------------------------------------------------------
// Codex #134: "" là plaintext hợp lệ trong migration legacy
// ---------------------------------------------------------------------------

// encryptText() mã hóa cả chuỗi rỗng (chỉ bỏ qua undefined/null), nên build cũ đã ghi
// U2FsdGVk…("") cho phone/cccd/notes để trống — rất phổ biến. Coi "" là hỏng thì
// migration abort ở MỌI lần mở khóa.
test('migration legacy: field mã hóa chuỗi rỗng không làm hỏng migration', async () => {
  const { api, localStorage } = loadSecurity();
  const LK = 'mk_legacy_test';
  const db = makeFakeDb([{
    id: 'c1',
    name: CryptoJS.AES.encrypt('Nguyễn Văn A', LK).toString(),
    phone: CryptoJS.AES.encrypt('', LK).toString(),
    notes: CryptoJS.AES.encrypt('', LK).toString(),
    assets: [],
  }], []);
  api.setLegacyMasterKey(LK);
  api.setDb(db);
  localStorage.setItem('app_pin', 'legacy-pin-envelope');

  await api.runFieldCryptoMigrationIfNeeded('123456', 'NV001');

  assert.equal(localStorage.getItem('app_crypto_schema_v'), '2');
  const rec = db._stores.customers.get('c1');
  assert.equal(rec.cryptoV, 2);
  assert.equal(await api.decryptFieldAsync(rec.name), 'Nguyễn Văn A');
  assert.equal(await api.decryptFieldAsync(rec.phone), '', 'chuỗi rỗng giữ nguyên là rỗng');
  assert.equal(await api.decryptFieldAsync(rec.notes), '');
});

// CryptoJS KHÔNG ném khi sai khóa/ciphertext hỏng — nó trả WordArray sigBytes ÂM và
// toString(Utf8) ra "" y hệt plaintext rỗng thật. Nhận "" ở đây là ghi rỗng ĐÈ lên dữ
// liệu thật, nên chốt chặn phải dựa vào sigBytes chứ không dựa vào exception.

test('migration legacy: ciphertext hỏng thật vẫn fail-closed', async () => {
  const { api, localStorage } = loadSecurity();
  const LK = 'mk_legacy_test';
  const foreign = foreignCiphertextDecodingToEmpty(LK);
  const db = makeFakeDb([{ id: 'c1', name: foreign, assets: [] }], []);
  api.setLegacyMasterKey(LK);
  api.setDb(db);
  localStorage.setItem('app_pin', 'legacy-pin-envelope');

  await assert.rejects(
    () => api.runFieldCryptoMigrationIfNeeded('123456', 'NV001'),
    /LEGACY_FIELD_DECRYPT_FAILED/
  );
  assert.equal(localStorage.getItem('app_crypto_schema_v'), null);
  assert.equal(localStorage.getItem('app_pin'), 'legacy-pin-envelope');
});

// ---------------------------------------------------------------------------
// Codex #134: thu hồi quyền trong backup phải dựng UI chặn
// ---------------------------------------------------------------------------

/** DOM stub tối thiểu: đủ để quan sát classList của lock/setup/activation. */
function installRevocationDom(ctx) {
  const mk = (hidden) => {
    const cls = new Set(hidden ? ['hidden'] : []);
    return {
      classList: {
        add: (c) => cls.add(c),
        remove: (c) => cls.delete(c),
        contains: (c) => cls.has(c),
      },
    };
  };
  const els = {
    'screen-lock': mk(false),
    'setup-lock-modal': mk(false),
    'activation-modal': mk(true),
    'activation-title': { textContent: '' },
  };
  ctx.getEl = (id) => els[id] || null;
  ctx.document.getElementById = (id) => els[id] || null;
  return els;
}

test('ensureBackupSecret nhận locked: xóa khóa VÀ dựng UI chặn', async () => {
  const { api, ctx, localStorage } = loadSecurity();
  const els = installRevocationDom(ctx);
  ctx.ADMIN_SERVER_URL = 'https://example.invalid/gas';
  localStorage.setItem('app_activated', 'true');
  localStorage.setItem('app_employee_id', 'NV001');
  await api.setMasterKey(api.generateMasterKey());
  ctx.fetch = async () => ({ text: async () => JSON.stringify({ status: 'locked', message: 'Tài khoản đã bị thu hồi.' }) });

  const res = await api.ensureBackupSecret();

  assert.equal(res.ok, false);
  assert.equal(api.isAppUnlocked(), false, 'khóa phải bị xóa khỏi RAM');
  assert.equal(localStorage.getItem('app_activated'), null);
  // Không được để dashboard + plaintext đã render sống tiếp sau khi phiên bị thu hồi.
  assert.equal(els['activation-modal'].classList.contains('hidden'), false, 'modal kích hoạt phải hiện');
  assert.equal(els['screen-lock'].classList.contains('hidden'), true);
  assert.equal(els['setup-lock-modal'].classList.contains('hidden'), true);
  assert.match(els['activation-title'].textContent, /thu hồi/i);
});

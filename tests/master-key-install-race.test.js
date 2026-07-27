'use strict';

// ============================================================================
// master-key-install-race.test.js
//
// _installMasterKey() dựng AES-GCM CryptoKey qua `await crypto.subtle.importKey`.
// Auto-lock (60s ẩn tab), lockApp() hay revokeUnlockedSession() có thể rơi ĐÚNG vào
// khe await đó. Trước đây hàm im lặng `return`: caller tưởng khóa đã cài và chạy tiếp
// với masterKey = null.
//
// Hậu quả nặng nhất KHÔNG phải rò rỉ mà là MẤT DỮ LIỆU: sealMasterKey(pin, null) tạo
// envelope hợp lệ chứa chuỗi "null" và ghi đè PIN_KEY/SEC_KEY — bản duy nhất mở được
// dữ liệu trên máy. Từ nay _installMasterKey THROW STALE_KEY_GENERATION và mọi caller
// phải dừng TRƯỚC khi ghi envelope / chạy pipeline unlock / đổi UI.
//
// Test chạy CHÍNH XÁC code production (vm sandbox, xem helpers/load-security.js) và
// chặn importKey bằng deferred để đặt lock vào đúng khe await — không phụ thuộc timing.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSecurity, CryptoJS } = require('./helpers/load-security');

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

/**
 * Bọc crypto.subtle.importKey: lần import THỨ N (mặc định lần đầu) dừng lại sau khi
 * WebCrypto trả key thật, để test chạy `interrupt()` rồi mới cho hàm chạy tiếp.
 * PBKDF2 (sealMasterKey/openMasterKeyV2) cũng gọi importKey nên phải chọn đúng lần
 * import khóa AES-GCM: nhận diện qua thuật toán "AES-GCM".
 */
function armStaleImport(ctx, interrupt) {
  const subtle = ctx.crypto.subtle;
  const realImportKey = subtle.importKey.bind(subtle);
  const gate = { started: deferred(), release: deferred(), fired: false };
  ctx.crypto = {
    getRandomValues: ctx.crypto.getRandomValues.bind(ctx.crypto),
    subtle: {
      importKey: async (fmt, data, algo, ...rest) => {
        const key = await realImportKey(fmt, data, algo, ...rest);
        const name = (algo && (algo.name || algo)) || '';
        if (!gate.fired && String(name) === 'AES-GCM') {
          gate.fired = true;
          gate.started.resolve();
          await gate.release.promise;
          interrupt();
        }
        return key;
      },
      encrypt: subtle.encrypt.bind(subtle),
      decrypt: subtle.decrypt.bind(subtle),
      deriveKey: subtle.deriveKey ? subtle.deriveKey.bind(subtle) : undefined,
      deriveBits: subtle.deriveBits ? subtle.deriveBits.bind(subtle) : undefined,
      digest: subtle.digest.bind(subtle),
    },
  };
  return gate;
}

/** Chạy `fn()` và cho phép khóa app rơi đúng vào khe await importKey bên trong. */
async function runWithLockDuringImport(api, ctx, fn) {
  const gate = armStaleImport(ctx, () => api.clearMasterKeyMaterial());
  const running = fn();
  await gate.started.promise;
  gate.release.resolve();
  return running;
}

// ---------------------------------------------------------------------------
// 1. Bản thân _installMasterKey
// ---------------------------------------------------------------------------

test('_installMasterKey THROW khi thế hệ khóa đổi giữa importKey (không im lặng)', async () => {
  const { api, ctx } = loadSecurity();
  const mk = api.generateMasterKey();

  const pending = runWithLockDuringImport(api, ctx, () => api._installMasterKey(mk));
  await assert.rejects(pending, /STALE_KEY_GENERATION/);

  const st = api.getState();
  assert.equal(st.mk, null, 'masterKey phải giữ trạng thái đã xóa');
  assert.equal(st.hasGcmKey, false, 'masterCryptoKey không được hồi sinh');
  assert.equal(api.isAppUnlocked(), false);
});

test('_isStaleKeyInstall nhận đúng lỗi stale và bỏ qua lỗi khác', () => {
  const { api } = loadSecurity();
  assert.equal(api._isStaleKeyInstall(new Error('STALE_KEY_GENERATION')), true);
  assert.equal(api._isStaleKeyInstall(new Error('QuotaExceededError')), false);
  assert.equal(api._isStaleKeyInstall(null), false);
});

// ---------------------------------------------------------------------------
// 2. saveSecuritySetup — đường mất dữ liệu nặng nhất
// ---------------------------------------------------------------------------

test('saveSecuritySetup: khóa app giữa importKey -> KHÔNG ghi đè PIN_KEY/SEC_KEY', async () => {
  const { api, ctx, localStorage, dom } = loadSecurity({ dom: true });

  // Máy đã có envelope thật của một masterKey đang dùng — đây là thứ tuyệt đối
  // không được ghi đè bằng envelope của masterKey rỗng.
  const existingMk = api.generateMasterKey();
  await api.setMasterKey(existingMk);
  const pinEnvelopeBefore = await api.sealMasterKey('111111', existingMk);
  const secEnvelopeBefore = await api.sealMasterKey('NV001', existingMk);
  localStorage.setItem('app_pin', pinEnvelopeBefore);
  localStorage.setItem('app_sec_qa', secEnvelopeBefore);
  api.clearMasterKeyMaterial();
  // Người dùng mở khóa lại rồi vào màn "đặt lại PIN": masterKey đã nằm trong phiên.
  await api.setMasterKey(existingMk);

  dom.getEl('setup-pin').value = '222222';
  dom.getEl('setup-answer').value = 'NV001';

  await runWithLockDuringImport(api, ctx, () => api.saveSecuritySetup());

  assert.equal(localStorage.getItem('app_pin'), pinEnvelopeBefore,
    'PIN_KEY phải giữ nguyên envelope cũ — ghi đè là mất dữ liệu vĩnh viễn');
  assert.equal(localStorage.getItem('app_sec_qa'), secEnvelopeBefore,
    'SEC_KEY phải giữ nguyên envelope cũ');
  assert.equal(localStorage.getItem('app_employee_id'), null,
    'không được ghi mã NV plaintext khi phiên đã chết');
  assert.equal(localStorage.getItem('app_employee_id_sealed_v1'), null,
    'không seal được mã NV khi không có khóa -> không ghi gì');
  assert.equal(dom.isHidden('setup-lock-modal'), false,
    'modal thiết lập phải còn mở để người dùng thử lại');
  assert.equal(api.getEmployeeIdRam(), null,
    'mã NV (secret khôi phục) không được nạp lại vào RAM của phiên đã bị dọn');
  assert.equal(api.isAppUnlocked(), false);
});

test('saveSecuritySetup: phiên không có khóa mà máy đã có envelope -> TỪ CHỐI, không sinh khóa mới', async () => {
  const { api, localStorage, dom } = loadSecurity({ dom: true });

  const existingMk = api.generateMasterKey();
  await api.setMasterKey(existingMk);
  const pinEnvelopeBefore = await api.sealMasterKey('111111', existingMk);
  const secEnvelopeBefore = await api.sealMasterKey('NV001', existingMk);
  localStorage.setItem('app_pin', pinEnvelopeBefore);
  localStorage.setItem('app_sec_qa', secEnvelopeBefore);
  // App khóa nhưng modal thiết lập vẫn còn mở (auto-lock rơi vào lúc người dùng đang gõ).
  api.clearMasterKeyMaterial();

  dom.getEl('setup-pin').value = '222222';
  dom.getEl('setup-answer').value = 'NV001';

  await api.saveSecuritySetup();

  assert.equal(localStorage.getItem('app_pin'), pinEnvelopeBefore,
    'không được sinh masterKey mới rồi niêm phong đè PIN_KEY');
  assert.equal(localStorage.getItem('app_sec_qa'), secEnvelopeBefore);
  assert.equal(api.getMasterKey(), null, 'không được tự sinh khóa cho phiên đã chết');
  // Envelope cũ vẫn mở được bằng PIN cũ -> dữ liệu còn nguyên.
  assert.equal(await api.openMasterKeyV2('111111', localStorage.getItem('app_pin')), existingMk);
});

test('saveSecuritySetup: phiên còn sống -> vẫn niêm phong PIN_KEY/SEC_KEY như cũ', async () => {
  const { api, localStorage, dom } = loadSecurity({ dom: true });
  dom.getEl('setup-pin').value = '123456';
  dom.getEl('setup-answer').value = 'NV009';

  await api.saveSecuritySetup();

  const pinEnv = localStorage.getItem('app_pin');
  const secEnv = localStorage.getItem('app_sec_qa');
  assert.ok(pinEnv && secEnv, 'đường bình thường vẫn phải ghi đủ hai envelope');
  const fromPin = await api.openMasterKeyV2('123456', pinEnv);
  const fromSec = await api.openMasterKeyV2('NV009', secEnv);
  assert.equal(fromPin, api.getMasterKey(), 'PIN mở đúng masterKey của phiên');
  assert.equal(fromSec, fromPin, 'PIN_KEY và SEC_KEY phải niêm phong CÙNG một masterKey');
  assert.notEqual(fromPin, 'null');
  assert.equal(dom.isHidden('setup-lock-modal'), true, 'thành công thì đóng modal');
});

// ---------------------------------------------------------------------------
// 3. checkRecovery — cửa khôi phục bằng mã nhân viên
// ---------------------------------------------------------------------------

test('checkRecovery: khóa app giữa importKey -> giữ màn khóa, không mở modal đặt PIN mới', async () => {
  const { api, ctx, localStorage, dom } = loadSecurity({ dom: true });

  const existingMk = api.generateMasterKey();
  await api.setMasterKey(existingMk);
  const secEnvelopeBefore = await api.sealMasterKey('NV777', existingMk);
  localStorage.setItem('app_sec_qa', secEnvelopeBefore);
  api.clearMasterKeyMaterial();

  dom.getEl('recovery-answer').value = 'NV777';
  // Màn khóa đang hiện (app khóa) — trạng thái xuất phát thật.
  dom.getEl('screen-lock').classList.remove('hidden');

  await runWithLockDuringImport(api, ctx, () => api.checkRecovery());

  assert.equal(localStorage.getItem('app_sec_qa'), secEnvelopeBefore, 'SEC_KEY giữ nguyên');
  assert.equal(dom.isHidden('screen-lock'), false, 'màn khóa KHÔNG được ẩn');
  assert.equal(dom.isHidden('setup-lock-modal'), false,
    'modal đặt PIN mới chưa từng được mở (nếu mở, saveSecuritySetup sẽ sinh khóa mới và đè envelope)');
  assert.equal(dom.isHidden('forgot-pin-modal'), false, 'modal khôi phục còn mở để thử lại');
  assert.equal(localStorage.getItem('app_employee_id_sealed_v1'), null);
  assert.equal(api.isAppUnlocked(), false);
});

test('checkRecovery: khóa app SAU khi cài khóa (lúc seal mã NV) -> vẫn không mở modal đặt PIN mới', async () => {
  const { api, ctx, localStorage, dom } = loadSecurity({ dom: true });

  const existingMk = api.generateMasterKey();
  await api.setMasterKey(existingMk);
  localStorage.setItem('app_sec_qa', await api.sealMasterKey('NV777', existingMk));
  api.clearMasterKeyMaterial();

  dom.getEl('recovery-answer').value = 'NV777';
  dom.getEl('screen-lock').classList.remove('hidden');

  // Lần này chặn ở encrypt (bên trong _writeSealedEmployeeId), tức là SAU khi
  // _installMasterKey đã thành công — khe await thứ hai của checkRecovery.
  const subtle = ctx.crypto.subtle;
  const realEncrypt = subtle.encrypt.bind(subtle);
  let fired = false;
  ctx.crypto = {
    getRandomValues: ctx.crypto.getRandomValues.bind(ctx.crypto),
    subtle: {
      importKey: subtle.importKey.bind(subtle),
      decrypt: subtle.decrypt.bind(subtle),
      deriveKey: subtle.deriveKey ? subtle.deriveKey.bind(subtle) : undefined,
      deriveBits: subtle.deriveBits ? subtle.deriveBits.bind(subtle) : undefined,
      digest: subtle.digest.bind(subtle),
      encrypt: async (...args) => {
        const out = await realEncrypt(...args);
        if (!fired) { fired = true; api.clearMasterKeyMaterial(); }
        return out;
      },
    },
  };

  await api.checkRecovery();

  assert.equal(fired, true, 'test phải thực sự chen được vào khe seal mã NV');
  assert.equal(dom.isHidden('screen-lock'), false, 'màn khóa KHÔNG được ẩn');
  assert.equal(dom.isHidden('setup-lock-modal'), false,
    'không mở modal đặt PIN mới cho phiên đã chết');
  assert.equal(api.getEmployeeIdRam(), null,
    'mã NV không được nạp lại vào RAM đã dọn');
  assert.equal(api.isAppUnlocked(), false);
});

// ---------------------------------------------------------------------------
// 4. activateApp — gia hạn trên máy đã có dữ liệu
// ---------------------------------------------------------------------------

test('activateApp (gia hạn): khóa app giữa importKey -> không re-seal SEC_KEY, không mở setup', async () => {
  const { api, ctx, localStorage, dom } = loadSecurity({ dom: true });

  const existingMk = api.generateMasterKey();
  await api.setMasterKey(existingMk);
  // SEC_KEY định dạng legacy -> kích hoạt lại sẽ muốn nâng cấp lên v2 (đường ghi đè).
  // Envelope legacy niêm phong bằng SHA-256(secret), không phải secret trần.
  const secLegacyBefore = CryptoJS.AES.encrypt(existingMk, await api.hashString('NV555')).toString();
  localStorage.setItem('app_sec_qa', secLegacyBefore);
  localStorage.setItem('app_pin', await api.sealMasterKey('111111', existingMk));
  api.clearMasterKeyMaterial();

  ctx.ADMIN_SERVER_URL = 'https://gas.test';
  ctx.fetch = async () => ({ text: async () => JSON.stringify({ status: 'success' }) });
  dom.getEl('activation-key').value = 'KEY-123';
  dom.getEl('activation-employee').value = 'NV555';

  await runWithLockDuringImport(api, ctx, () => api.activateApp());

  assert.equal(localStorage.getItem('app_sec_qa'), secLegacyBefore,
    'SEC_KEY legacy phải giữ nguyên — ghi đè bằng khóa rỗng là mất đường khôi phục');
  assert.equal(localStorage.getItem('app_employee_id_sealed_v1'), null);
  assert.equal(api.getEmployeeIdRam(), null,
    'mã NV không được nạp lại vào RAM của phiên đã chết');
  assert.equal(dom.isHidden('setup-lock-modal'), false, 'không mở modal đặt PIN mới');
  assert.equal(api.isAppUnlocked(), false);
});

test('activateApp (gia hạn): khóa app lúc seal SEC_KEY v2 -> dừng, không nạp mã NV vào RAM', async () => {
  const { api, ctx, localStorage, dom } = loadSecurity({ dom: true });

  const existingMk = api.generateMasterKey();
  await api.setMasterKey(existingMk);
  // Envelope legacy niêm phong bằng SHA-256(secret), không phải secret trần.
  const secLegacyBefore = CryptoJS.AES.encrypt(existingMk, await api.hashString('NV555')).toString();
  localStorage.setItem('app_sec_qa', secLegacyBefore);
  localStorage.setItem('app_pin', await api.sealMasterKey('111111', existingMk));
  api.clearMasterKeyMaterial();

  ctx.ADMIN_SERVER_URL = 'https://gas.test';
  ctx.fetch = async () => ({ text: async () => JSON.stringify({ status: 'success' }) });
  dom.getEl('activation-key').value = 'KEY-123';
  dom.getEl('activation-employee').value = 'NV555';

  // Chặn ở deriveBits (PBKDF2 bên trong sealMasterKey) — tức SAU khi _installMasterKey
  // đã thành công. Trước bản vá, nhánh này chỉ bỏ lệnh ghi envelope rồi vẫn chạy tiếp
  // gán __employeeIdPlain cho một phiên đã bị dọn.
  const subtle = ctx.crypto.subtle;
  const realDeriveBits = subtle.deriveBits ? subtle.deriveBits.bind(subtle) : null;
  const realDeriveKey = subtle.deriveKey ? subtle.deriveKey.bind(subtle) : null;
  let fired = false;
  const trip = () => { if (!fired) { fired = true; api.clearMasterKeyMaterial(); } };
  ctx.crypto = {
    getRandomValues: ctx.crypto.getRandomValues.bind(ctx.crypto),
    subtle: {
      importKey: subtle.importKey.bind(subtle),
      encrypt: subtle.encrypt.bind(subtle),
      decrypt: subtle.decrypt.bind(subtle),
      digest: subtle.digest.bind(subtle),
      deriveBits: realDeriveBits && (async (...a) => { const o = await realDeriveBits(...a); trip(); return o; }),
      deriveKey: realDeriveKey && (async (...a) => { const o = await realDeriveKey(...a); trip(); return o; }),
    },
  };

  await api.activateApp();

  assert.equal(fired, true, 'test phải chen được vào khe seal SEC_KEY');
  assert.equal(localStorage.getItem('app_sec_qa'), secLegacyBefore, 'SEC_KEY giữ nguyên');
  assert.equal(api.getEmployeeIdRam(), null,
    'mã NV (secret khôi phục) không được sống qua phiên đã khóa');
  assert.equal(dom.isHidden('setup-lock-modal'), false);
  assert.equal(api.isAppUnlocked(), false);
});

// ---------------------------------------------------------------------------
// 5. validatePin — PIN ĐÚNG nhưng phiên chết giữa chừng
// ---------------------------------------------------------------------------

test('validatePin: PIN đúng + khóa app giữa importKey -> không mở khóa, keypad dùng lại được', async () => {
  const { api, ctx, localStorage, dom } = loadSecurity({ dom: true });

  const existingMk = api.generateMasterKey();
  await api.setMasterKey(existingMk);
  localStorage.setItem('app_pin', await api.sealMasterKey('654321', existingMk));
  api.clearMasterKeyMaterial();

  dom.getEl('screen-lock').classList.remove('hidden');
  const failsBefore = api.getPinFailures().fails;

  api.setCurrentPin('654321');
  await runWithLockDuringImport(api, ctx, () => api.validatePin());

  assert.equal(dom.isHidden('screen-lock'), false,
    'màn khóa phải ở nguyên — ẩn nó là vào dashboard với masterKey rỗng');
  assert.equal(api.isAppUnlocked(), false);
  assert.equal(dom.getEl('pin-keypad').classList.contains('keypad-disabled'), false,
    'keypad phải được bật lại để người dùng nhập PIN lại');
  assert.equal(api.getCurrentPin(), '', 'không giữ PIN trong RAM sau khi bỏ dở');
  assert.equal(api.getPinFailures().fails, failsBefore,
    'PIN nhập ĐÚNG: không được tính là lần sai (tránh khóa oan người dùng)');
  assert.equal(dom.isHidden('setup-lock-modal'), false,
    'không mở prompt nâng cấp PIN khi phiên đã chết');
  // Dừng NGAY tại chỗ cài khóa, không đi tiếp vào completeUnlockDataLoad: pipeline đó
  // chạy migration + prime cache dưới masterKey rỗng. Dấu vết duy nhất quan sát được
  // là _setUnlockLoading(true) bỏ class 'hidden' của panel "Đang tải dữ liệu...".
  const loadingPanelShown = dom.getEl('pin-unlock-loading')._log
    .some(([op, cls]) => op === 'remove' && cls === 'hidden');
  assert.equal(loadingPanelShown, false,
    'không được chạy pipeline unlock khi cài khóa thất bại');
});

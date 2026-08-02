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

test('saveSecuritySetup: QuotaExceededError ở lệnh envelope thứ hai rollback đủ và báo STORAGE', async () => {
  const { api, ctx, localStorage, dom } = loadSecurity({ dom: true });

  const existingMk = api.generateMasterKey();
  await api.setMasterKey(existingMk);
  const pinEnvelopeBefore = await api.sealMasterKey('111111', existingMk);
  const secEnvelopeBefore = await api.sealMasterKey('NV001', existingMk);
  localStorage.setItem('app_pin', pinEnvelopeBefore);
  localStorage.setItem('app_sec_qa', secEnvelopeBefore);

  dom.getEl('setup-pin').value = '222222';
  dom.getEl('setup-answer').value = 'NV001';
  dom.getEl('setup-lock-modal').classList.remove('hidden');

  const shownErrors = [];
  ctx.ErrorHandler.showError = (...args) => { shownErrors.push(args); };
  let unlockedEvents = 0;
  ctx.document.dispatchEvent = (event) => {
    if (event && event.type === 'clientpro:unlocked') unlockedEvents++;
    return true;
  };

  const realSetItem = localStorage.setItem;
  let envelopeWrites = 0;
  localStorage.setItem = (key, value) => {
    if (key === 'app_pin' || key === 'app_sec_qa') {
      envelopeWrites++;
      if (envelopeWrites === 2) {
        const error = new Error('quota full');
        error.name = 'QuotaExceededError';
        throw error;
      }
    }
    realSetItem(key, value);
  };

  await api.saveSecuritySetup();

  assert.equal(localStorage.getItem('app_pin'), pinEnvelopeBefore,
    'PIN_KEY phải quay về đúng snapshot cũ');
  assert.equal(localStorage.getItem('app_sec_qa'), secEnvelopeBefore,
    'SEC_KEY phải quay về đúng snapshot cũ');
  assert.ok(shownErrors.some(([category]) => category === 'STORAGE'),
    'Người dùng phải thấy lỗi STORAGE thay vì rejection im lặng');
  assert.equal(dom.isHidden('setup-lock-modal'), false,
    'Ghi thất bại phải giữ modal thiết lập mở');
  assert.equal(dom.getEl('setup-save-btn').disabled, false,
    'Khối finally phải bật lại nút Lưu');
  assert.equal(unlockedEvents, 0,
    'Không được chạy pipeline/phát clientpro:unlocked khi commit thất bại');
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

test('activateApp (gia hạn): server thu hồi giữa chừng -> GIỮ cổng kích hoạt, không hạ xuống màn khóa', async () => {
  const { api, ctx, localStorage, dom } = loadSecurity({ dom: true });

  const existingMk = api.generateMasterKey();
  await api.setMasterKey(existingMk);
  localStorage.setItem('app_sec_qa', await api.sealMasterKey('NV555', existingMk));
  localStorage.setItem('app_pin', await api.sealMasterKey('111111', existingMk));
  api.clearMasterKeyMaterial();

  ctx.ADMIN_SERVER_URL = 'https://gas.test';
  // activate -> success; issue_kdata (ensureBackupSecret) -> locked, tức server vừa
  // thu hồi quyền. _revokeAndShowActivationGate() xóa app_activated và dựng cổng
  // kích hoạt; đường bỏ dở của activateApp KHÔNG được ẩn cổng đó rồi hiện màn khóa —
  // validatePin() không kiểm app_activated nên PIN đúng sẽ mở thẳng dashboard.
  ctx.fetch = async (url, opts) => {
    const body = (opts && opts.body) || '';
    const isKdata = String(url).includes('issue_kdata') || String(body).includes('issue_kdata');
    return {
      text: async () => JSON.stringify(isKdata
        ? { status: 'locked', message: 'Tài khoản đã bị thu hồi.' }
        : { status: 'success' }),
    };
  };
  dom.getEl('activation-key').value = 'KEY-123';
  dom.getEl('activation-employee').value = 'NV555';
  dom.getEl('activation-modal').classList.remove('hidden');

  await api.activateApp();

  assert.equal(localStorage.getItem('app_activated'), null,
    'thu hồi phải xóa marker kích hoạt');
  assert.equal(dom.isHidden('activation-modal'), false,
    'cổng kích hoạt phải còn hiện — đây là lệnh thu hồi, không phải auto-lock');
  assert.equal(dom.isHidden('screen-lock'), true,
    'không được hạ thu hồi xuống thành màn khóa (PIN đúng sẽ vào thẳng dashboard)');
  assert.equal(api.isAppUnlocked(), false);
  assert.equal(api.getEmployeeIdRam(), null);
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

// ---------------------------------------------------------------------------
// 6. Hai lượt mở khóa chồng nhau
//
// Auto-lock nổ giữa pipeline unlock -> người dùng nhập PIN lại ngay. Lượt CŨ tỉnh
// dậy sau khi lượt MỚI đã cài khóa: isAppUnlocked() lúc đó trả true (của lượt mới),
// nên nếu chỉ dựa vào nó thì lượt cũ sẽ ẩn màn khóa GIỮA CHỪNG pipeline của lượt
// mới — và còn áp cả prompt nâng cấp PIN dựa trên kết quả `res` đã cũ.
// ---------------------------------------------------------------------------

/**
 * "Cổng" đặt vào window.__dbReady — await ĐẦU TIÊN của completeUnlockDataLoad.
 * Là một thenable: `then` được gọi đúng lúc pipeline chạm tới nó, nên test biết
 * CHẮC CHẮN lượt unlock đã vào pipeline rồi mới đi bước tiếp theo (không đoán bằng
 * số microtask — PBKDF2 mất thời gian thật và số nhịp await không tất định).
 */
function pipelineGate() {
  const entered = deferred();
  const release = deferred();
  return {
    entered: entered.promise,
    release,
    thenable: {
      then: (resolve, reject) => {
        entered.resolve();
        release.promise.then(resolve, reject);
      },
    },
  };
}

test('validatePin: lượt cũ tỉnh dậy sau lượt mới -> KHÔNG ẩn màn khóa của lượt mới', async () => {
  const { api, ctx, localStorage, dom } = loadSecurity({ dom: true });

  const mk = api.generateMasterKey();
  await api.setMasterKey(mk);
  localStorage.setItem('app_pin', await api.sealMasterKey('654321', mk));
  api.clearMasterKeyMaterial();
  dom.getEl('screen-lock').classList.remove('hidden');

  const gate1 = pipelineGate();
  ctx.window.__dbReady = gate1.thenable;
  api.setCurrentPin('654321');
  const firstUnlock = api.validatePin();
  await gate1.entered;   // lượt 1 đã cài khóa và đang ở trong pipeline

  // Auto-lock nổ giữa pipeline của lượt 1.
  api.clearMasterKeyMaterial();

  // Người dùng nhập PIN lại ngay -> lượt 2 cài khóa và vào pipeline (còn đang chạy).
  const gate2 = pipelineGate();
  ctx.window.__dbReady = gate2.thenable;
  api.setCurrentPin('654321');
  const secondUnlock = api.validatePin();
  await gate2.entered;

  // Lượt 1 tỉnh dậy: phiên hiện tại là của lượt 2, nó phải im lặng rút lui.
  gate1.release.resolve();
  await firstUnlock;

  assert.equal(api.isAppUnlocked(), true, 'phiên của lượt 2 vẫn sống');
  assert.equal(dom.isHidden('screen-lock'), false,
    'lượt cũ KHÔNG được ẩn màn khóa khi pipeline của lượt mới còn đang chạy');
  assert.equal(dom.isHidden('setup-lock-modal'), false,
    'lượt cũ không được áp prompt nâng cấp PIN dựa trên kết quả đã cũ');

  // Lượt 2 hoàn tất -> nó mới là bên được ẩn màn khóa.
  gate2.release.resolve();
  await secondUnlock;
  assert.equal(dom.isHidden('screen-lock'), true, 'lượt sở hữu phiên mở khóa bình thường');
});

test('validatePin: lượt cũ không ẩn màn khóa trong KHE await importKey của lượt mới', async () => {
  const { api, ctx, localStorage, dom } = loadSecurity({ dom: true });

  const mk = api.generateMasterKey();
  await api.setMasterKey(mk);
  localStorage.setItem('app_pin', await api.sealMasterKey('654321', mk));
  api.clearMasterKeyMaterial();
  dom.getEl('screen-lock').classList.remove('hidden');

  const gate1 = pipelineGate();
  ctx.window.__dbReady = gate1.thenable;
  api.setCurrentPin('654321');
  const firstUnlock = api.validatePin();
  await gate1.entered;

  api.clearMasterKeyMaterial();   // auto-lock giữa pipeline lượt 1

  // Lượt 2: dừng ĐÚNG BÊN TRONG _installMasterKey — masterKey đã được gán (nên
  // isAppUnlocked() true) nhưng masterCryptoKey còn rỗng và pipeline chưa khởi động.
  // Đây là khe mà vé phải được nhận TRƯỚC await, nếu không lượt 1 sẽ tưởng mình
  // vẫn đang giữ vé của một phiên "đã mở khóa".
  const subtle = ctx.crypto.subtle;
  const realImportKey = subtle.importKey.bind(subtle);
  const inInstall = deferred();
  const holdInstall = deferred();
  let held = false;
  ctx.crypto = {
    getRandomValues: ctx.crypto.getRandomValues.bind(ctx.crypto),
    subtle: {
      encrypt: subtle.encrypt.bind(subtle),
      decrypt: subtle.decrypt.bind(subtle),
      digest: subtle.digest.bind(subtle),
      deriveKey: subtle.deriveKey ? subtle.deriveKey.bind(subtle) : undefined,
      deriveBits: subtle.deriveBits ? subtle.deriveBits.bind(subtle) : undefined,
      importKey: async (fmt, data, algo, ...rest) => {
        const name = (algo && (algo.name || algo)) || '';
        if (!held && String(name) === 'AES-GCM') {
          held = true;
          inInstall.resolve();
          await holdInstall.promise;
        }
        return realImportKey(fmt, data, algo, ...rest);
      },
    },
  };

  api.setCurrentPin('654321');
  const secondUnlock = api.validatePin();
  await inInstall.promise;

  assert.equal(api.isAppUnlocked(), true, 'tiền đề: masterKey đã gán, khóa phái sinh chưa dựng');
  assert.equal(api.getState().hasGcmKey, false, 'tiền đề: masterCryptoKey còn rỗng');

  // Lượt 1 tỉnh dậy ĐÚNG trong khe này.
  gate1.release.resolve();
  await firstUnlock;

  assert.equal(dom.isHidden('screen-lock'), false,
    'lượt cũ không được ẩn màn khóa khi lượt mới còn đang dựng khóa');

  holdInstall.resolve();
  ctx.window.__dbReady = null;
  await secondUnlock;
  assert.equal(dom.isHidden('screen-lock'), true, 'lượt mới hoàn tất thì mới ẩn màn khóa');
});

/**
 * DB giả cho migration legacy, CHẶN đúng ở lần getAllKeys đầu tiên.
 * Đây là điểm duy nhất đặt được auto-lock vào GIỮA runFieldCryptoMigrationIfNeeded —
 * sau khi migration đã cố ý cài MK2 (bump generation) nhưng trước khi nó xong.
 */
function gatedLegacyDb() {
  const entered = deferred();
  const release = deferred();
  let gated = false;
  const store = new Map();
  const db = {
    objectStoreNames: { contains: () => true },
    transaction() {
      const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
      tx.objectStore = () => ({
        getAllKeys() {
          const r = { onsuccess: null, onerror: null, result: undefined, error: null };
          if (!gated) {
            gated = true;
            entered.resolve();
            release.promise.then(() => {
              r.result = [];
              if (r.onsuccess) r.onsuccess({ target: r });
              if (tx.oncomplete) tx.oncomplete({ target: tx });
            });
          } else {
            Promise.resolve().then(() => {
              r.result = [];
              if (r.onsuccess) r.onsuccess({ target: r });
              if (tx.oncomplete) tx.oncomplete({ target: tx });
            });
          }
          return r;
        },
        getAll() {
          const r = { onsuccess: null, onerror: null, result: [], error: null };
          Promise.resolve().then(() => {
            if (r.onsuccess) r.onsuccess({ target: r });
            if (tx.oncomplete) tx.oncomplete({ target: tx });
          });
          return r;
        },
        get: (k) => {
          const r = { onsuccess: null, onerror: null, result: store.get(k), error: null };
          Promise.resolve().then(() => { if (r.onsuccess) r.onsuccess({ target: r }); if (tx.oncomplete) tx.oncomplete({ target: tx }); });
          return r;
        },
        put: (v) => {
          const r = { onsuccess: null, onerror: null, result: v && v.id, error: null };
          store.set(v && v.id, v);
          Promise.resolve().then(() => { if (r.onsuccess) r.onsuccess({ target: r }); if (tx.oncomplete) tx.oncomplete({ target: tx }); });
          return r;
        },
        delete: () => {
          const r = { onsuccess: null, onerror: null, result: undefined, error: null };
          Promise.resolve().then(() => { if (r.onsuccess) r.onsuccess({ target: r }); if (tx.oncomplete) tx.oncomplete({ target: tx }); });
          return r;
        },
      });
      return tx;
    },
  };
  return { db, entered: entered.promise, release };
}

test('completeUnlockDataLoad: pipeline cũ không "mượn" phiên của lượt mới sau migration legacy', async () => {
  const { api, ctx, localStorage } = loadSecurity({ dom: true });

  let dispatched = 0;
  ctx.document.dispatchEvent = (ev) => { if (ev && ev.type === 'clientpro:unlocked') dispatched++; return true; };
  ctx.CustomEvent = class { constructor(type) { this.type = type; } };

  // Máy LEGACY: migration sẽ cố ý cài MK2 và bump generation — đúng lý do pipeline
  // phải NHẬN generation mới ngay sau migration, và cũng là khe mà một lượt mở khóa
  // mới có thể bị "mượn" phiên.
  const gate = gatedLegacyDb();
  api.setDb(gate.db);
  api.setLegacyMasterKey('mk_legacy_test');
  localStorage.setItem('app_pin', 'legacy-pin-envelope');

  const attempt1 = api.bumpUnlockAttempt();
  const pipeline1 = api.completeUnlockDataLoad('123456', 'NV001', attempt1);
  await gate.entered;   // đang ở GIỮA runFieldCryptoMigrationIfNeeded

  // Auto-lock, rồi một lượt mở khóa MỚI lấy vé và cài khóa của nó.
  api.clearMasterKeyMaterial();
  api.bumpUnlockAttempt();
  await api.setMasterKey(api.generateMasterKey());

  gate.release.resolve();
  await pipeline1;

  assert.equal(api.isAppUnlocked(), true, 'tiền đề: phiên của lượt MỚI đang sống');
  assert.equal(dispatched, 0,
    'pipeline của lượt cũ KHÔNG được phát clientpro:unlocked cho phiên của lượt mới');
});

// ---------------------------------------------------------------------------
// 7. UI loading/keypad là DOM DÙNG CHUNG
//
// _setUnlockLoading(true) ẩn #pin-keypad và hiện #pin-unlock-loading. Hai lượt mở
// khóa chồng nhau dùng CHUNG các node đó, nên lượt đã bị tiếp quản không được dọn —
// mà lượt đang giữ vé thì bắt buộc phải dọn, kể cả khi nó bỏ dở.
// ---------------------------------------------------------------------------

/** true nếu element từng bị bỏ class 'hidden' (tức được hiện ra) trong lịch sử. */
function everUnhidden(dom, id) {
  return dom.getEl(id)._log.some(([op, cls]) => op === 'remove' && cls === 'hidden');
}

test('completeUnlockDataLoad: lượt cũ KHÔNG dọn spinner/keypad của lượt đang chạy', async () => {
  const { api, ctx, dom } = loadSecurity({ dom: true });

  const gate1 = pipelineGate();
  ctx.window.__dbReady = gate1.thenable;
  const attempt1 = api.bumpUnlockAttempt();
  await api.setMasterKey(api.generateMasterKey());
  const pipeline1 = api.completeUnlockDataLoad('123456', 'NV001', attempt1);
  await gate1.entered;

  // Lượt 1 đã bật spinner (ẩn keypad) — trạng thái xuất phát.
  assert.equal(dom.isHidden('pin-keypad'), true, 'tiền đề: pipeline đang chạy nên keypad ẩn');
  assert.equal(dom.isHidden('pin-unlock-loading'), false, 'tiền đề: spinner đang hiện');

  // Lượt 2 tiếp quản và cũng đang chạy pipeline của nó.
  api.clearMasterKeyMaterial();
  const gate2 = pipelineGate();
  ctx.window.__dbReady = gate2.thenable;
  const attempt2 = api.bumpUnlockAttempt();
  await api.setMasterKey(api.generateMasterKey());
  const pipeline2 = api.completeUnlockDataLoad('123456', 'NV001', attempt2);
  await gate2.entered;

  // Lượt 1 tỉnh dậy và kết thúc: KHÔNG được đụng UI của lượt 2.
  gate1.release.resolve();
  await pipeline1;

  assert.equal(dom.isHidden('pin-keypad'), true,
    'lượt cũ không được trả keypad về khi pipeline của lượt mới còn chạy');
  assert.equal(dom.isHidden('pin-unlock-loading'), false,
    'spinner của lượt đang chạy phải còn nguyên');

  // Lượt 2 xong -> nó mới là bên dọn UI.
  gate2.release.resolve();
  await pipeline2;
  assert.equal(dom.isHidden('pin-keypad'), false, 'lượt sở hữu vé dọn UI khi xong');
  assert.equal(dom.isHidden('pin-unlock-loading'), true);
});

test('validatePin: chủ vé bỏ dở vẫn trả keypad về (không kẹt spinner)', async () => {
  const { api, ctx, localStorage, dom } = loadSecurity({ dom: true });

  const mk = api.generateMasterKey();
  await api.setMasterKey(mk);
  localStorage.setItem('app_pin', await api.sealMasterKey('654321', mk));
  api.clearMasterKeyMaterial();
  dom.getEl('screen-lock').classList.remove('hidden');

  // Lượt 1 vào pipeline -> spinner bật, keypad ẩn.
  const gate1 = pipelineGate();
  ctx.window.__dbReady = gate1.thenable;
  const attempt1 = api.bumpUnlockAttempt();
  await api.setMasterKey(mk);
  const pipeline1 = api.completeUnlockDataLoad('654321', '', attempt1);
  await gate1.entered;
  assert.equal(dom.isHidden('pin-keypad'), true, 'tiền đề: keypad đang ẩn vì pipeline chạy');

  // Auto-lock, người dùng nhập PIN lại, nhưng lượt 2 chết ngay trong _installMasterKey.
  api.clearMasterKeyMaterial();
  api.setCurrentPin('654321');
  await runWithLockDuringImport(api, ctx, () => api.validatePin());

  gate1.release.resolve();
  await pipeline1;

  // Người dùng phải nhập lại PIN được: keypad hiện, spinner tắt.
  assert.equal(dom.isHidden('pin-keypad'), false,
    'chủ vé bỏ dở phải trả keypad về — nếu không màn khóa kẹt, không nhập PIN được');
  assert.equal(dom.isHidden('pin-unlock-loading'), true, 'spinner phải tắt');
  assert.equal(api.isAppUnlocked(), false);
});

test('showLockScreen: luôn hiện màn khóa ở trạng thái nhập được PIN', async () => {
  const { api, dom } = loadSecurity({ dom: true });

  // Giả lập một pipeline unlock đang chạy dở rồi app bị khóa.
  const gate = pipelineGate();
  const attempt = api.bumpUnlockAttempt();
  await api.setMasterKey(api.generateMasterKey());
  const pipeline = api.completeUnlockDataLoad('123456', 'NV001', attempt);
  await Promise.resolve();
  api.setCurrentPin('12');

  api.showLockScreen();

  assert.equal(dom.isHidden('screen-lock'), false);
  assert.equal(dom.isHidden('pin-keypad'), false, 'keypad phải hiện — không thì không nhập được PIN');
  assert.equal(dom.isHidden('pin-unlock-loading'), true, 'spinner không được treo lại trên màn khóa');
  assert.equal(api.getCurrentPin(), '', 'màn khóa reset PIN đang gõ dở');
  assert.ok(everUnhidden(dom, 'pin-keypad'), 'keypad thực sự được hiện lại chứ không phải chưa từng ẩn');
  gate.release.resolve();
  await pipeline;
});

test('saveSecuritySetup: lượt Lưu cũ không đóng modal/báo thành công thay lượt mới', async () => {
  const { api, ctx, dom } = loadSecurity({ dom: true });

  let onPinChanged = 0;
  ctx.window.BiometricUnlock = { onPinChanged: () => { onPinChanged++; } };
  let successToasts = 0;
  ctx.ErrorHandler.showSuccess = () => { successToasts++; };
  ctx.window.ErrorHandler = ctx.ErrorHandler;

  dom.getEl('setup-pin').value = '123456';
  dom.getEl('setup-answer').value = 'NV001';
  dom.getEl('setup-lock-modal').classList.remove('hidden');

  // Lần bấm Lưu thứ nhất: chạy tới pipeline rồi dừng ở đó.
  const gate1 = pipelineGate();
  ctx.window.__dbReady = gate1.thenable;
  const save1 = api.saveSecuritySetup();
  await gate1.entered;

  // Hệ quả GHI XUỐNG ĐĨA phải xong ngay sau lệnh ghi envelope, không chờ cuối hàm:
  // PIN trên đĩa đã đổi nên enrollment sinh trắc học cũ (mã hóa PIN cũ) phải bị hủy
  // ngay, kể cả khi phiên chết trong pipeline dài phía sau.
  assert.equal(onPinChanged, 1,
    'hủy enrollment sinh trắc học phải gắn với lệnh ghi envelope, không gắn với UI cuối hàm');

  // Nút Lưu đã được bật lại trong `finally` của phần niêm phong -> người dùng bấm lần 2.
  assert.equal(dom.getEl('setup-save-btn').disabled, false,
    'tiền đề: nút Lưu đã bật lại nên bấm lần 2 là có thật');
  const gate2 = pipelineGate();
  ctx.window.__dbReady = gate2.thenable;
  dom.getEl('setup-pin').value = '123456';
  dom.getEl('setup-answer').value = 'NV001';
  const save2 = api.saveSecuritySetup();
  await gate2.entered;

  // Lượt 1 tỉnh dậy: đã là lượt cũ, không được đụng UI.
  gate1.release.resolve();
  await save1;

  assert.equal(dom.isHidden('setup-lock-modal'), false,
    'lượt cũ không được đóng modal thiết lập khi lượt mới còn đang chạy');
  assert.equal(successToasts, 0, 'lượt cũ không được báo thành công');

  // Lượt 2 hoàn tất -> nó mới là bên đóng modal và báo thành công.
  gate2.release.resolve();
  await save2;
  assert.equal(dom.isHidden('setup-lock-modal'), true, 'lượt hiện hành đóng modal khi xong');
  assert.equal(successToasts, 1);
  assert.equal(onPinChanged, 2,
    'mỗi lần ghi envelope là một lần PIN đổi trên đĩa -> mỗi lần đều phải hủy enrollment');
});

test('saveSecuritySetup: phiên chết trong pipeline -> PIN đã lưu thì enrollment sinh trắc học vẫn bị hủy', async () => {
  const { api, ctx, localStorage, dom } = loadSecurity({ dom: true });

  let onPinChanged = 0;
  ctx.window.BiometricUnlock = { onPinChanged: () => { onPinChanged++; } };
  localStorage.setItem('app_biometric_env_v1', 'enrollment-theo-PIN-cu');

  dom.getEl('setup-pin').value = '123456';
  dom.getEl('setup-answer').value = 'NV001';
  dom.getEl('setup-lock-modal').classList.remove('hidden');

  const gate = pipelineGate();
  ctx.window.__dbReady = gate.thenable;
  const save = api.saveSecuritySetup();
  await gate.entered;

  // Envelope đã ghi; auto-lock/thu hồi nổ ngay sau đó, trước khi pipeline xong.
  const pinEnvelope = localStorage.getItem('app_pin');
  assert.ok(pinEnvelope, 'tiền đề: PIN mới đã được lưu xuống đĩa');
  api.clearMasterKeyMaterial();

  gate.release.resolve();
  await save;

  assert.equal(localStorage.getItem('app_pin'), pinEnvelope, 'PIN mới vẫn nằm trên đĩa');
  assert.equal(onPinChanged, 1,
    'PIN trên đĩa đã đổi thì enrollment sinh trắc học PHẢI bị hủy — nếu không, mở khóa '
    + 'sinh trắc học sau đó mở ra PIN CŨ và hỏng im lặng');
  // UI vẫn bị gác đúng: phiên đã chết thì không báo thành công.
  assert.equal(dom.isHidden('setup-lock-modal'), false);
});

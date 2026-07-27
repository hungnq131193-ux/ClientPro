'use strict';

// ============================================================================
// revocation-clears-session.test.js — thu hồi quyền phải xóa vật liệu khóa RAM.
//
// Từ 1.4.0, check_status (runServerStatusCheck) và AuthGate.preflight() chạy CẢ
// SAU khi mở khóa, vì máy đã seal mã NV không có identity lúc boot. Nếu hai
// đường thu hồi chỉ xóa app_activated và dựng UI chặn thì masterKey, KDATA, mã NV
// và cache plaintext vẫn sống trong RAM tới khi đóng tab, và tác vụ nền đang chạy
// vẫn dùng được khóa của phiên vừa bị thu hồi.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSecurity } = require('./helpers/load-security');
const { loadAuthGate, jsonResponse } = require('./helpers/load-auth-gate');

const ACTIVATED_KEY = 'app_activated';
const COOLDOWN_KEY = 'app_auth_gate_cooldown_until';
const EMP = 'NV001';
const LOCKED_ISSUE_KDATA = { status: 'error', message: 'ISSUE_KDATA FAIL: tai khoan bi khoa' };

test('check_status trả locked sau unlock -> xóa masterKey khỏi RAM', async () => {
  const { api, localStorage, ctx } = loadSecurity();
  localStorage.setItem(ACTIVATED_KEY, '1');
  localStorage.setItem('app_employee_id', EMP);
  await api.setMasterKey(api.generateMasterKey());
  assert.equal(api.isAppUnlocked(), true, 'Tiền đề: đang mở khóa');

  ctx.ADMIN_SERVER_URL = 'https://example.invalid/gas';
  ctx.fetch = async () => ({ text: async () => JSON.stringify({ status: 'locked', message: 'Đã thu hồi' }) });

  await api.runServerStatusCheck();

  assert.equal(api.isAppUnlocked(), false, 'Phiên bị thu hồi phải hết mở khóa');
  assert.equal(api.getMasterKey(), null, 'masterKey phải bị xóa khỏi RAM');
  assert.equal(api.getKdataRam(), '', 'KDATA plaintext phải bị xóa');
  assert.equal(api.getEmployeeIdRam(), null, 'Mã NV trong RAM phải bị xóa');
});

test('check_status trả success -> KHÔNG đụng tới phiên đang mở khóa', async () => {
  const { api, localStorage, ctx } = loadSecurity();
  localStorage.setItem(ACTIVATED_KEY, '1');
  localStorage.setItem('app_employee_id', EMP);
  await api.setMasterKey(api.generateMasterKey());

  ctx.ADMIN_SERVER_URL = 'https://example.invalid/gas';
  ctx.fetch = async () => ({ text: async () => JSON.stringify({ status: 'success' }) });

  await api.runServerStatusCheck();

  assert.equal(api.isAppUnlocked(), true, 'Tài khoản bình thường không được bị khóa oan');
});

test('revokeUnlockedSession xóa sạch vật liệu khóa kể cả khi không còn PIN_KEY', async () => {
  // Bẫy thật: nút "Thoát và kích hoạt lại" xóa PIN_KEY trước, mà lockApp() return
  // sớm khi thiếu PIN_KEY -> phải dùng revokeUnlockedSession, không dùng lockApp.
  const { api, localStorage } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  localStorage.removeItem('app_pin');

  api.lockApp();
  assert.equal(api.isAppUnlocked(), true, 'Tiền đề: lockApp bất lực khi không còn PIN_KEY');

  api.revokeUnlockedSession();
  assert.equal(api.isAppUnlocked(), false, 'revokeUnlockedSession phải xóa được vật liệu khóa');
});

test('AuthGate: đủ strike -> gọi revokeUnlockedSession trước khi xóa activation', async () => {
  const { AuthGate, localStorage, ctx, setFetch } = loadAuthGate();
  localStorage.setItem(ACTIVATED_KEY, '1');
  ctx.__employeeIdPlain = EMP;

  let revokedBeforeActivationCleared = null;
  ctx.revokeUnlockedSession = () => {
    revokedBeforeActivationCleared = localStorage.getItem(ACTIVATED_KEY) !== null;
  };

  setFetch(jsonResponse(LOCKED_ISSUE_KDATA));
  assert.equal(await AuthGate.preflight(), true, 'Strike #1 chưa chặn');
  assert.equal(revokedBeforeActivationCleared, null, 'Chưa đủ strike thì chưa thu hồi phiên');

  localStorage.removeItem(COOLDOWN_KEY);
  setFetch(jsonResponse(LOCKED_ISSUE_KDATA));
  assert.equal(await AuthGate.preflight(), false, 'Strike #2 -> chặn');

  assert.equal(revokedBeforeActivationCleared, true,
    'Phải thu hồi phiên (xóa key RAM) TRƯỚC khi xóa app_activated');
  assert.equal(localStorage.getItem(ACTIVATED_KEY), null);
});

test('AuthGate: nút "Thoát và kích hoạt lại" thu hồi phiên trước khi xóa PIN', () => {
  const gate = loadAuthGate();
  gate.localStorage.setItem(ACTIVATED_KEY, '1');
  gate.localStorage.setItem('app_pin', 'enc');

  let pinStillPresentWhenRevoked = null;
  gate.ctx.revokeUnlockedSession = () => {
    pinStillPresentWhenRevoked = gate.localStorage.getItem('app_pin') !== null;
  };
  gate.ctx.PIN_KEY = 'app_pin';

  // _ensureGateUI dựng overlay + gắn handler; bắt handler click của nút reset.
  const handlers = [];
  gate.ctx.document.createElement = () => ({
    style: {},
    classList: { add() {}, remove() {}, contains: () => false },
    textContent: '',
    appendChild() {},
    addEventListener: (type, fn) => { if (type === 'click') handlers.push(fn); },
  });

  gate.AuthGate.block('Thiết bị bị thu hồi');
  assert.ok(handlers.length >= 1, 'Overlay phải gắn handler cho nút reset');
  handlers[0](); // nút đầu tiên = "Thoát và kích hoạt lại"

  assert.equal(pinStillPresentWhenRevoked, true,
    'Phải gọi revokeUnlockedSession TRƯỚC khi xóa PIN_KEY (lockApp return sớm khi mất PIN_KEY)');
});

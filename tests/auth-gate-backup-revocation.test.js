'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const AUTH_GATE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'assets', '15_auth_gate.js'),
  'utf8'
);

function makeHarness(originalEnsure, initialUnlocked = true) {
  const store = new Map([['app_activated', '1']]);
  const localStorage = {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  const overlay = { style: { display: 'none' } };
  const message = { textContent: '' };
  const title = { textContent: '' };
  const elements = {
    'auth-gate-overlay': overlay,
    'auth-gate-message': message,
    'auth-gate-title': title,
  };
  let unlocked = initialUnlocked;
  const ctx = {
    console,
    JSON,
    Math,
    Date,
    Promise,
    String,
    Number,
    Boolean,
    Object,
    Array,
    Error,
    localStorage,
    navigator: { onLine: true, userAgent: 'node-test', clipboard: { writeText: async () => {} } },
    document: {
      getElementById: (id) => elements[id] || null,
      addEventListener() {},
      createElement: () => ({
        style: {},
        classList: { add() {}, remove() {} },
        appendChild() {},
        addEventListener() {},
        select() {},
      }),
      body: { appendChild() {}, removeChild() {} },
      execCommand() {},
    },
    ACTIVATED_KEY: 'app_activated',
    EMPLOYEE_KEY: 'app_employee_id',
    PIN_KEY: 'app_pin',
    ADMIN_SERVER_URL: 'https://example.invalid/gas',
    __employeeIdPlain: null,
    getDeviceId: () => 'DEVICE-TEST-1',
    fetch: async () => { throw new Error('fetch không được gọi'); },
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout() {},
    isAppUnlocked: () => unlocked,
    ensureBackupSecret: null,
    window: {},
  };
  ctx.ensureBackupSecret = (...args) => originalEnsure({
    args,
    localStorage,
    setUnlocked: (value) => { unlocked = !!value; },
  });
  ctx.window.ensureBackupSecret = ctx.ensureBackupSecret;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(AUTH_GATE_SRC, ctx, { filename: 'assets/15_auth_gate.js' });
  return { ctx, overlay, message, localStorage };
}

test('issue_kdata thu hồi phiên đang mở thì AuthGate phủ UI ngay', async () => {
  const { ctx, overlay, message } = makeHarness(async ({ localStorage, setUnlocked }) => {
    setUnlocked(false);
    localStorage.removeItem('app_activated');
    return { ok: false, message: 'Tài khoản đã bị thu hồi.' };
  });

  const result = await ctx.ensureBackupSecret();
  assert.equal(result.ok, false);
  assert.equal(overlay.style.display, 'flex');
  assert.equal(message.textContent, 'Tài khoản đã bị thu hồi.');
});

test('lỗi backup thông thường không xóa activation thì không chặn Dashboard', async () => {
  const { ctx, overlay } = makeHarness(async () => ({
    ok: false,
    message: 'Không thể kết nối server để lấy khóa KDATA.',
  }));

  const result = await ctx.ensureBackupSecret();
  assert.equal(result.ok, false);
  assert.equal(overlay.style.display, 'none');
});

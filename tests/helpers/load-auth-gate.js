'use strict';

// ============================================================================
// load-auth-gate.js — Nạp assets/15_auth_gate.js NGUYÊN BẢN vào sandbox Node
// (không sửa 1 dòng code nghiệp vụ) để test bộ đếm strike thu hồi quyền THẬT.
//
// Cùng khuôn với tests/helpers/load-security.js: 15_auth_gate.js viết theo kiểu
// IIFE "browser globals" (không export) nên ta dựng đủ global nó chạm tới rồi
// runInContext, sau đó lấy window.AuthGate mà chính module tự expose — không
// cần epilogue.
//
// Zero-dependency: chỉ node:vm + node:fs.
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

/** localStorage giả lập tối thiểu (giống load-security.js). */
function makeLocalStorage() {
  const store = Object.create(null);
  return {
    _store: store,
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
}

/**
 * document giả lập: đủ cho addEventListener lúc load và cho _ensureGateUI()
 * dựng overlay khi bị chặn. getElementById luôn trả null -> _block() bỏ qua
 * phần cập nhật DOM (đã có guard `if (overlay)`), không crash.
 */
function makeDocument() {
  const listeners = Object.create(null);
  const makeEl = () => ({
    style: {},
    classList: { add() {}, remove() {}, contains: () => false },
    textContent: '',
    appendChild() {},
    addEventListener() {},
  });
  return {
    _listeners: listeners,
    body: { appendChild() {} },
    createElement: makeEl,
    getElementById: () => null,
    addEventListener(type, fn) {
      (listeners[type] || (listeners[type] = [])).push(fn);
    },
    /** Kích hoạt listener đã đăng ký (vd 'clientpro:unlocked'). */
    _emit(type) {
      for (const fn of listeners[type] || []) fn();
    },
  };
}

/**
 * Nạp 15_auth_gate.js và trả về sandbox test.
 * @param {object} [opts]
 * @param {string} [opts.adminUrl] - ADMIN_SERVER_URL (mặc định URL giả).
 * @returns {{ AuthGate: object, localStorage: object, document: object, ctx: object,
 *            setFetch: (fn: Function) => void, setEmployeeIdRam: (v: string) => void }}
 */
function loadAuthGate(opts) {
  const options = opts || {};
  const localStorage = makeLocalStorage();
  const document = makeDocument();

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
    document,
    navigator: { onLine: true, userAgent: 'node-test' },
    window: {},
    // Hằng bình thường ở 00_globals.js / 01_config.js — chỉ cấp đúng phần
    // 15_auth_gate.js tham chiếu khi chạy.
    ACTIVATED_KEY: 'app_activated',
    EMPLOYEE_KEY: 'app_employee_id',
    ADMIN_SERVER_URL: options.adminUrl || 'https://example.invalid/gas',
    // Mã NV trong RAM sau unlock (nguồn thật: biến module của 02_security.js).
    __employeeIdPlain: null,
    getDeviceId: () => 'DEVICE-TEST-1',
    fetch: async () => { throw new Error('fetch chưa được cấu hình trong test'); },
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout: () => {},
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  const src = fs.readFileSync(
    path.join(ROOT, 'assets', '15_auth_gate.js'),
    'utf8'
  );
  vm.runInContext(src, ctx, { filename: 'assets/15_auth_gate.js' });

  return {
    AuthGate: ctx.window.AuthGate,
    localStorage,
    document,
    ctx,
    /** Bơm phản hồi GAS: fn() -> string body. */
    setFetch: (fn) => { ctx.fetch = fn; },
    /** Giả lập mã NV đã nạp RAM sau unlock (máy đã seal, không còn plaintext). */
    setEmployeeIdRam: (v) => { ctx.__employeeIdPlain = v; },
  };
}

/** Helper: phản hồi JSON của Admin GAS. */
function jsonResponse(obj) {
  return async () => ({ text: async () => JSON.stringify(obj) });
}

module.exports = { loadAuthGate, jsonResponse };

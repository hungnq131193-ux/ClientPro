'use strict';

// ============================================================================
// error-detail.test.js — ErrorHandler._detailToString: nhánh stringify object
// bất kỳ phải redact key nhạy cảm + cắt string dài, để app_error_log
// (localStorage, plaintext) không bao giờ chứa dữ liệu KH đã giải mã.
// Nạp assets/19_error_loading.js NGUYÊN BẢN vào vm sandbox (mẫu load-security).
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadErrorHandler() {
  const noop = () => {};
  const fakeStorage = {
    _store: Object.create(null),
    getItem(k) { return k in this._store ? this._store[k] : null; },
    setItem(k, v) { this._store[k] = String(v); },
    removeItem(k) { delete this._store[k]; },
  };
  const fakeEl = () => ({
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    style: {}, dataset: {}, setAttribute: noop, getAttribute: () => null,
    appendChild: noop, removeChild: noop, remove: noop, addEventListener: noop,
    querySelector: () => null, querySelectorAll: () => [],
    textContent: '', disabled: false,
  });
  const documentStub = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: fakeEl,
    body: fakeEl(),
    addEventListener: noop,
    dispatchEvent: noop,
  };
  const ctx = {
    console: { error: noop, warn: noop, log: noop },
    localStorage: fakeStorage,
    document: documentStub,
    window: {},
    navigator: { onLine: true, vibrate: noop },
    getEl: () => null,
    setTimeout: () => 0,
    clearTimeout: noop,
    Date, JSON, String, Number, Boolean, Object, Array, Error, Promise, Math, RegExp,
  };
  ctx.window.addEventListener = noop;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(ROOT, 'assets', '19_error_loading.js'), 'utf8');
  vm.runInContext(src, ctx, { filename: 'assets/19_error_loading.js' });
  return ctx.window.ErrorHandler;
}

test('Error object: giữ name/message/stack như cũ', () => {
  const EH = loadErrorHandler();
  const e = new Error('boom');
  const out = EH._detailToString(e);
  assert.ok(out.startsWith('Error: boom'), `phải giữ dạng Error: message (nhận: ${out.slice(0, 40)})`);
});

test('string / null: passthrough', () => {
  const EH = loadErrorHandler();
  assert.equal(EH._detailToString('plain text'), 'plain text');
  assert.equal(EH._detailToString(null), '');
});

test('object chứa field nhạy cảm: bị redact toàn bộ', () => {
  const EH = loadErrorHandler();
  const out = EH._detailToString({
    id: 42,
    name: 'Nguyễn Văn A',
    phone: '0912345678',
    cccd: '012345678901',
    creditLimit: '5000000000',
    notes: 'hồ sơ nhạy cảm',
    lat: 21.028, lng: 105.804,
    kdata_b64u: 'AAAA',
    status: 'approved',
  });
  for (const leak of ['Nguyễn Văn A', '0912345678', '012345678901', 'hồ sơ nhạy cảm', '21.028', '105.804', 'AAAA']) {
    assert.ok(!out.includes(leak), `giá trị nhạy cảm bị lộ trong log: ${leak}`);
  }
  assert.ok(out.includes('[redacted]'), 'key nhạy cảm phải thành [redacted]');
  assert.ok(out.includes('42'), 'field vô hại (id) vẫn giữ để định vị lỗi');
  assert.ok(out.includes('approved'), 'field vô hại (status) vẫn giữ');
});

test('string dài trong object: cắt còn 80 ký tự + tổng ≤ 600', () => {
  const EH = loadErrorHandler();
  const long = 'x'.repeat(500);
  const out = EH._detailToString({ info: long, extra: long, more: long });
  assert.ok(!out.includes('x'.repeat(100)), 'string dài phải bị cắt (≤80)');
  assert.ok(out.length <= 600, `tổng phải ≤ 600 (nhận ${out.length})`);
});

test('detail.message vẫn được ưu tiên như hành vi cũ', () => {
  const EH = loadErrorHandler();
  assert.equal(EH._detailToString({ message: 'tx failed', name: 'BỊ LỘ?' }), 'tx failed');
});

'use strict';

// ============================================================================
// unlock-autolock-race.test.js — auto-lock nổ GIỮA unlock pipeline.
//
// validatePin() cài masterKey TRƯỚC khi chạy completeUnlockDataLoad() (migration
// + prime cache + load dữ liệu). Từ thời điểm đó isAppUnlocked() đã true nên
// auto-lock (_onAppHiddenForAutoLock, 60s ẩn) đủ điều kiện gọi lockApp() và xóa
// key ngay giữa pipeline. Khi pipeline cũ chạy nốt, nó không được:
//   - phát clientpro:unlocked (đánh thức auto-backup/preflight cho một phiên đã chết)
//   - để validatePin ẩn màn hình khóa (vào app với masterKey=null, bỏ qua PIN)
//
// Chạy 02_security.js THẬT trong vm sandbox (tests/helpers/load-security.js).
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadSecurity } = require('./helpers/load-security');

/** Sandbox có dispatchEvent + CustomEvent để bắt sự kiện (mẫu kdata-cache.test.js). */
function withEventCapture() {
  const s = loadSecurity();
  const events = [];
  s.ctx.document.dispatchEvent = (e) => { events.push(e.type); return true; };
  s.ctx.document.addEventListener = () => {};
  s.ctx.CustomEvent = class CustomEvent { constructor(type) { this.type = type; } };
  return { ...s, events };
}

test('mất key giữa pipeline: KHÔNG phát clientpro:unlocked', async () => {
  const { api, ctx, events } = withEventCapture();
  await api.setMasterKey(api.generateMasterKey());

  // Auto-lock nổ ở await đầu tiên của pipeline (window.__dbReady).
  ctx.window.__dbReady = Promise.resolve().then(() => { api.clearMasterKeyMaterial(); });

  await api.completeUnlockDataLoad();

  assert.equal(api.isAppUnlocked(), false, 'Phiên phải vẫn ở trạng thái khóa');
  assert.ok(!events.includes('clientpro:unlocked'),
    'Phiên đã bị khóa giữa chừng thì không được báo "vừa mở khóa xong"');
});

test('phiên còn nguyên: vẫn phát clientpro:unlocked như cũ', async () => {
  const { api, ctx, events } = withEventCapture();
  await api.setMasterKey(api.generateMasterKey());
  ctx.window.__dbReady = Promise.resolve();

  await api.completeUnlockDataLoad();

  assert.equal(api.isAppUnlocked(), true);
  assert.ok(events.includes('clientpro:unlocked'), 'Unlock bình thường phải phát sự kiện');
});

test('validatePin không được ẩn màn hình khóa mà không kiểm lại phiên', () => {
  // validatePin đụng DOM thật (#screen-lock, keypad) nên canh bằng đọc source:
  // giữa await completeUnlockDataLoad(...) và lệnh ẩn screen-lock phải có chốt
  // isAppUnlocked(). Thiếu chốt = mở app với masterKey=null.
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'assets', '02_security.js'),
    'utf8'
  );
  const start = src.indexOf('await completeUnlockDataLoad(pinForMigration, empForMigration);');
  assert.ok(start > 0, 'Không tìm thấy lời gọi completeUnlockDataLoad trong validatePin');
  const hideAt = src.indexOf('getEl("screen-lock").classList.add("hidden")', start);
  assert.ok(hideAt > start, 'Không tìm thấy lệnh ẩn screen-lock sau pipeline unlock');

  const between = src.slice(start, hideAt);
  assert.ok(/isAppUnlocked\(\)/.test(between),
    'validatePin: phải kiểm isAppUnlocked() sau pipeline trước khi ẩn màn hình khóa');
});

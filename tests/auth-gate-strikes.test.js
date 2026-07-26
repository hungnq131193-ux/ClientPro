'use strict';

// ============================================================================
// auth-gate-strikes.test.js — Bộ đếm strike thu hồi quyền (15_auth_gate.js).
//
// Bất biến: chỉ verdict THẬT từ server mới được xóa app_auth_gate_lock_strikes.
// Kết quả `skipped` (chưa có mã NV lúc boot trên máy đã seal mã NV, offline,
// TTL, cooldown, lỗi mạng) là "hoãn kiểm tra", KHÔNG phải "đã kiểm tra và
// sạch" — nếu xóa strike ở đó thì mỗi lần mở lại app reset bộ đếm và ngưỡng
// 2-strike không bao giờ tới, tức thiết bị bị khóa không bao giờ bị chặn.
//
// Chạy 15_auth_gate.js THẬT trong vm sandbox (tests/helpers/load-auth-gate.js).
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAuthGate, jsonResponse } = require('./helpers/load-auth-gate');

const ACTIVATED_KEY = 'app_activated';
const STRIKES_KEY = 'app_auth_gate_lock_strikes';
const COOLDOWN_KEY = 'app_auth_gate_cooldown_until';
const LAST_OK_KEY = 'app_auth_gate_last_ok_ts';
const EMP = 'NV001';

// GAS AdminAPI v12: issue_kdata trả status:'error' + message không dấu khi khóa.
const LOCKED_RESPONSE = { status: 'error', message: 'ISSUE_KDATA FAIL: tai khoan bi khoa' };

function strikeCount(localStorage) {
  const raw = localStorage.getItem(STRIKES_KEY);
  if (!raw) return 0;
  return Number(JSON.parse(raw).count || 0);
}

test('skipped (máy đã seal mã NV, còn khóa lúc boot) KHÔNG xóa strike', async () => {
  const { AuthGate, localStorage, setFetch } = loadAuthGate();
  localStorage.setItem(ACTIVATED_KEY, '1');
  // Đã có 1 strike từ lần check thật trước đó.
  localStorage.setItem(STRIKES_KEY, JSON.stringify({ firstTs: Date.now(), count: 1 }));
  // Không có mã NV: RAM trống + localStorage trống -> _checkByIssueKdata skip.
  setFetch(async () => { throw new Error('không được gọi server khi thiếu mã NV'); });

  const ok = await AuthGate.preflight();

  assert.equal(ok, true, 'Thiếu identity thì không chặn UI');
  assert.equal(strikeCount(localStorage), 1, 'Strike phải được giữ nguyên, không bị xóa');
});

test('offline KHÔNG xóa strike', async () => {
  const { AuthGate, localStorage, ctx } = loadAuthGate();
  localStorage.setItem(ACTIVATED_KEY, '1');
  localStorage.setItem(STRIKES_KEY, JSON.stringify({ firstTs: Date.now(), count: 1 }));
  ctx.__employeeIdPlain = EMP;
  ctx.navigator.onLine = false;

  const ok = await AuthGate.preflight();

  assert.equal(ok, true);
  assert.equal(strikeCount(localStorage), 1, 'Offline là hoãn kiểm tra, không phải verdict sạch');
});

test('server báo khóa qua 2 lần mở app (có boot skipped ở giữa) -> chặn + thu hồi', async () => {
  const { AuthGate, localStorage, ctx, setFetch } = loadAuthGate();
  localStorage.setItem(ACTIVATED_KEY, '1');

  // --- Phiên 1: unlock xong, RAM có mã NV -> check thật, server báo khóa.
  ctx.__employeeIdPlain = EMP;
  setFetch(jsonResponse(LOCKED_RESPONSE));
  const ok1 = await AuthGate.preflight();
  assert.equal(ok1, true, 'Strike #1 chưa đủ ngưỡng -> chưa chặn');
  assert.equal(strikeCount(localStorage), 1);

  // --- Boot phiên 2: app còn khóa, máy đã seal nên chưa có mã NV -> skipped.
  ctx.__employeeIdPlain = null;
  setFetch(async () => { throw new Error('không được gọi server khi thiếu mã NV'); });
  await AuthGate.preflight();
  assert.equal(strikeCount(localStorage), 1, 'Boot skipped không được reset bộ đếm');

  // --- Phiên 2 sau unlock: check thật lần nữa (cooldown 5 phút đã qua).
  localStorage.removeItem(COOLDOWN_KEY);
  ctx.__employeeIdPlain = EMP;
  setFetch(jsonResponse(LOCKED_RESPONSE));
  const ok2 = await AuthGate.preflight();

  assert.equal(ok2, false, 'Đủ 2 strike -> preflight phải chặn');
  assert.equal(localStorage.getItem(ACTIVATED_KEY), null, 'Đủ strike -> thu hồi kích hoạt local');
});

test('server trả success -> xóa strike (không chặn oan thiết bị hợp lệ)', async () => {
  const { AuthGate, localStorage, ctx, setFetch } = loadAuthGate();
  localStorage.setItem(ACTIVATED_KEY, '1');
  localStorage.setItem(STRIKES_KEY, JSON.stringify({ firstTs: Date.now(), count: 1 }));
  ctx.__employeeIdPlain = EMP;
  setFetch(jsonResponse({ status: 'success', kdata_b64u: 'AAAA' }));

  const ok = await AuthGate.preflight();

  assert.equal(ok, true);
  assert.equal(localStorage.getItem(STRIKES_KEY), null, 'Verdict OK thật -> phải xóa strike');
  assert.ok(localStorage.getItem(LAST_OK_KEY), 'Đánh dấu TTL 24h sau lần check OK');
});

test('sai thiết bị 2 lần liên tiếp -> chặn (cùng đường với locked)', async () => {
  const { AuthGate, localStorage, ctx, setFetch } = loadAuthGate();
  localStorage.setItem(ACTIVATED_KEY, '1');
  ctx.__employeeIdPlain = EMP;
  const deviceErr = jsonResponse({ status: 'error', message: 'ISSUE_KDATA FAIL: sai thiet bi' });

  setFetch(deviceErr);
  assert.equal(await AuthGate.preflight(), true);
  assert.equal(strikeCount(localStorage), 1);

  localStorage.removeItem(COOLDOWN_KEY);
  setFetch(deviceErr);
  assert.equal(await AuthGate.preflight(), false, 'Strike #2 -> chặn');
});

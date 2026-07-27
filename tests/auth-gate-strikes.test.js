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

// ============================================================================
// Codex #134: single-flight của preflight() phải gắn với thế hệ khóa.
//
// Máy legacy còn mã NV plaintext: boot phát issue_kdata lúc app CÒN KHÓA. Nếu
// response về sau khi unlock, _checkByIssueKdata thấy generation đã đổi và bỏ kết
// quả (stale). Listener clientpro:unlocked gọi preflight() — nếu nó tái dùng
// _inflight cũ thì chỉ await đúng kết quả rỗng đó và KHÔNG BAO GIỜ phát lần check
// thật, tức verdict device/KDATA bị bỏ suốt phiên.
// ============================================================================

test('preflight sau unlock phát request mới thay vì await request stale của boot', async () => {
  const { AuthGate, localStorage, setFetch, setEmployeeIdRam, bumpKeyGeneration } = loadAuthGate();
  localStorage.setItem(ACTIVATED_KEY, 'true');
  localStorage.setItem('app_employee_id', 'NV001'); // máy legacy: mã NV còn plaintext

  let calls = 0;
  let releaseBoot;
  const bootReleased = new Promise((r) => { releaseBoot = r; });
  setFetch(async () => {
    calls += 1;
    if (calls === 1) {
      await bootReleased; // request của boot còn đang bay khi unlock xảy ra
      return { text: async () => JSON.stringify({ status: 'success', kdata_b64u: 'A'.repeat(43) }) };
    }
    return { text: async () => JSON.stringify({ status: 'success', kdata_b64u: 'B'.repeat(43) }) };
  });

  const boot = AuthGate.preflight();          // phát lúc còn khóa, chưa await
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1, 'boot đã phát request');

  bumpKeyGeneration();                        // unlock: _installMasterKey tăng generation
  setEmployeeIdRam('NV001');
  // KHÔNG await thẳng: nếu single-flight lại tái dùng request boot (bug), await ở đây
  // khoá cứng vào bootReleased -> test treo thay vì báo lỗi. Đo bằng số fetch đã phát.
  const afterUnlock = AuthGate.preflight();   // listener clientpro:unlocked
  await new Promise((r) => setImmediate(r));

  assert.equal(calls, 2, 'phải phát request MỚI sau unlock, không await cái stale');

  releaseBoot();
  await Promise.all([boot, afterUnlock]);
});

test('preflight trong cùng thế hệ khóa vẫn single-flight (không spam GAS)', async () => {
  const { AuthGate, localStorage, setFetch } = loadAuthGate();
  localStorage.setItem(ACTIVATED_KEY, 'true');
  localStorage.setItem('app_employee_id', 'NV001');

  let calls = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  setFetch(async () => {
    calls += 1;
    await gate;
    return { text: async () => JSON.stringify({ status: 'success', kdata_b64u: 'A'.repeat(43) }) };
  });

  const a = AuthGate.preflight();
  await new Promise((r) => setImmediate(r));
  const b = AuthGate.preflight();
  release();
  await Promise.all([a, b]);
  assert.equal(calls, 1, 'hai lời gọi cùng thế hệ chỉ được đi 1 request');
});

// Cooldown là "khóa mềm" 5 phút. Nếu request của phiên CŨ (phát lúc còn khóa) reject
// sau khi unlock rồi vẫn ghi cooldown, thì preflight sau unlock — dù đã phát request
// mới đúng generation — lại trả {skipped: cooldown} và verdict device/KDATA bị bỏ suốt
// phiên. Tức là cooldown vô hiệu hóa chính fix single-flight theo generation.
test('lỗi mạng của request stale không đặt cooldown chặn check sau unlock', async () => {
  const { AuthGate, localStorage, setFetch, setEmployeeIdRam, bumpKeyGeneration } = loadAuthGate();
  localStorage.setItem(ACTIVATED_KEY, 'true');
  localStorage.setItem('app_employee_id', 'NV001'); // máy legacy: mã NV còn plaintext

  let calls = 0;
  let failBoot;
  const bootFails = new Promise((_, rej) => { failBoot = rej; });
  setFetch(async () => {
    calls += 1;
    if (calls === 1) {
      await bootFails; // request boot chỉ reject SAU khi unlock đã xảy ra
      return null;
    }
    return { text: async () => JSON.stringify({ status: 'success', kdata_b64u: 'B'.repeat(43) }) };
  });

  const boot = AuthGate.preflight();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);

  bumpKeyGeneration();                 // unlock
  setEmployeeIdRam('NV001');
  failBoot(new Error('network down')); // request cũ mới reject
  await boot;

  assert.equal(localStorage.getItem('app_auth_gate_cooldown_until'), null,
    'request stale không được ghi cooldown cho phiên mới');

  // Và lần check thật sau unlock vẫn phải đi được (không bị cooldown chặn).
  assert.equal(await AuthGate.preflight(), true);
  assert.equal(calls, 2, 'preflight sau unlock phải phát được request thật');
});

// Đối chứng: lỗi mạng của CHÍNH phiên hiện tại vẫn phải đặt cooldown (chống spam GAS).
test('lỗi mạng của phiên hiện tại vẫn đặt cooldown', async () => {
  const { AuthGate, localStorage, setFetch } = loadAuthGate();
  localStorage.setItem(ACTIVATED_KEY, 'true');
  localStorage.setItem('app_employee_id', 'NV001');
  setFetch(async () => { throw new Error('network down'); });

  assert.equal(await AuthGate.preflight(), true, 'lỗi mạng không được chặn UI');
  assert.ok(localStorage.getItem('app_auth_gate_cooldown_until'),
    'lỗi mạng của phiên hiện tại phải đặt cooldown');
});

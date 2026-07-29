// Accessibility (P3): axe-core quét màn hình đầu tiên + kiểm tra viewport cho phép zoom.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { loadSecurity } = require('../tests/helpers/load-security');

const PIN = '123456';
let PIN_ENVELOPE;
test.beforeAll(async () => {
  const { api } = loadSecurity();
  PIN_ENVELOPE = await api.sealMasterKey(PIN, api.generateMasterKey());
});

test('viewport CHO PHÉP pinch-zoom (không user-scalable=no / maximum-scale)', async ({ page }) => {
  await page.goto('/index.html');
  const content = await page.getAttribute('meta[name="viewport"]', 'content');
  expect(content).not.toMatch(/user-scalable\s*=\s*no/i);
  expect(content).not.toMatch(/maximum-scale/i);
});

test('axe: màn hình cổng bảo mật không có vi phạm CRITICAL', async ({ page }) => {
  // Chặn reload-once của pwa.js (controllerchange) để axe không mất execution context.
  await page.addInitScript(() => {
    const orig = sessionStorage.getItem.bind(sessionStorage);
    sessionStorage.getItem = (k) => (k && k.indexOf('clientpro_sw_reloaded_') === 0) ? '1' : orig(k);
  });
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600); // chờ modal động (load_modals) nạp xong

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const critical = results.violations.filter((v) => v.impact === 'critical');
  const serious = results.violations.filter((v) => v.impact === 'serious');
  // Log 'serious' để theo dõi (vd contrast) nhưng chỉ CHẶN ở mức 'critical'.
  if (serious.length) console.log('a11y serious (không chặn):', serious.map((v) => `${v.id} x${v.nodes.length}`).join(', '));
  const summary = critical.map((v) => `${v.id} x${v.nodes.length}`).join('\n');
  expect(critical, 'Vi phạm a11y CRITICAL:\n' + summary).toEqual([]);
});

test('security gate: screen-lock cô lập accessibility tree của dashboard', async ({ page }) => {
  await page.addInitScript((env) => {
    localStorage.setItem('app_activated', 'true');
    localStorage.setItem('app_employee_id', 'TEST');
    localStorage.setItem('app_pin', env);
    localStorage.setItem('app_crypto_schema_v', '2');
    localStorage.setItem('clientpro_onboarding_done', JSON.stringify({ version: 5, completedAt: Date.now() }));
    const o = sessionStorage.getItem.bind(sessionStorage);
    sessionStorage.getItem = (k) => (k && k.indexOf('clientpro_sw_reloaded_') === 0) ? '1' : o(k);
  }, PIN_ENVELOPE);
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#screen-lock', { state: 'visible', timeout: 10_000 });

  const locked = await page.evaluate(() => {
    const dash = document.getElementById('screen-dashboard');
    const lock = document.getElementById('screen-lock');
    return {
      dashInert: !!(dash && dash.inert),
      dashAriaHidden: dash ? dash.getAttribute('aria-hidden') : null,
      lockInert: !!(lock && lock.inert),
      focusInLock: !!(lock && lock.contains(document.activeElement)),
    };
  });
  expect(locked.dashInert || locked.dashAriaHidden === 'true', 'Dashboard phải inert/aria-hidden khi lock mở').toBeTruthy();
  expect(locked.lockInert, 'Chính #screen-lock không được inert').toBeFalsy();
  expect(locked.focusInLock, 'Focus phải nằm trong #screen-lock').toBeTruthy();

  for (const d of PIN) await page.click(`[data-action="enterPin"][data-arg="${d}"]`);
  await page.waitForSelector('#screen-lock', { state: 'hidden', timeout: 10_000 });

  const unlocked = await page.evaluate(() => {
    const dash = document.getElementById('screen-dashboard');
    return {
      dashInert: !!(dash && dash.inert),
      dashAriaHidden: dash ? dash.getAttribute('aria-hidden') : null,
    };
  });
  expect(unlocked.dashInert, 'Sau unlock dashboard không còn inert').toBeFalsy();
  expect(unlocked.dashAriaHidden === 'true', 'Sau unlock dashboard không còn aria-hidden=true').toBeFalsy();
});

test('security gate: activation-modal cô lập accessibility tree', async ({ page }) => {
  // Thiết bị chưa kích hoạt -> AuthGate hiện activation-modal.
  await page.addInitScript(() => {
    const o = sessionStorage.getItem.bind(sessionStorage);
    sessionStorage.getItem = (k) => (k && k.indexOf('clientpro_sw_reloaded_') === 0) ? '1' : o(k);
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#activation-modal', { state: 'visible', timeout: 15_000 });

  const state = await page.evaluate(() => {
    const dash = document.getElementById('screen-dashboard');
    const act = document.getElementById('activation-modal');
    return {
      dashInert: !!(dash && dash.inert),
      dashAriaHidden: dash ? dash.getAttribute('aria-hidden') : null,
      actInert: !!(act && act.inert),
      focusInAct: !!(act && act.contains(document.activeElement)),
    };
  });
  expect(state.dashInert || state.dashAriaHidden === 'true').toBeTruthy();
  expect(state.actInert).toBeFalsy();
  expect(state.focusInAct).toBeTruthy();
});

// Handoff lock → forgot-pin → lock → unlock phải GIỮ focus anchor gốc (dashboard),
// không ghi đè lastFocused bằng control trong modal vừa ẩn.
test('security gate: lock → forgot-pin → lock → unlock giữ focus anchor', async ({ page }) => {
  await page.addInitScript((env) => {
    localStorage.setItem('app_activated', 'true');
    localStorage.setItem('app_employee_id', 'TEST');
    localStorage.setItem('app_pin', env);
    localStorage.setItem('app_crypto_schema_v', '2');
    localStorage.setItem('clientpro_onboarding_done', JSON.stringify({ version: 5, completedAt: Date.now() }));
    const o = sessionStorage.getItem.bind(sessionStorage);
    sessionStorage.getItem = (k) => (k && k.indexOf('clientpro_sw_reloaded_') === 0) ? '1' : o(k);
  }, PIN_ENVELOPE);
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#screen-lock', { state: 'visible', timeout: 10_000 });
  for (const d of PIN) await page.click(`[data-action="enterPin"][data-arg="${d}"]`);
  await page.waitForSelector('#screen-lock', { state: 'hidden', timeout: 10_000 });

  // Anchor focus trên dashboard trước khi khóa.
  await page.click('#btn-quick-add');
  await page.waitForSelector('#add-modal', { state: 'visible' });
  await page.click('#add-modal [data-action="closeModal"], #add-modal [data-action^="close"]');
  await page.waitForSelector('#add-modal', { state: 'hidden', timeout: 10_000 });
  await page.focus('#btn-quick-add');
  await expect(page.locator('#btn-quick-add')).toBeFocused();

  await page.evaluate(() => { if (typeof lockApp === 'function') lockApp(); });
  await page.waitForSelector('#screen-lock', { state: 'visible', timeout: 10_000 });
  await page.waitForFunction(() => {
    const lock = document.getElementById('screen-lock');
    return lock && !lock.classList.contains('hidden') && lock.contains(document.activeElement);
  }, null, { timeout: 5_000 });

  // Mở forgot-pin phía trên lock.
  await page.click('#screen-lock [data-action="forgotPin"]');
  await page.waitForSelector('#forgot-pin-modal', { state: 'visible', timeout: 10_000 });
  const mid = await page.evaluate(() => {
    const forgot = document.getElementById('forgot-pin-modal');
    const lock = document.getElementById('screen-lock');
    const dash = document.getElementById('screen-dashboard');
    return {
      focusInForgot: !!(forgot && forgot.contains(document.activeElement)),
      lockStillOpen: !!(lock && !lock.classList.contains('hidden')),
      dashIsolated: !!(dash && (dash.inert || dash.getAttribute('aria-hidden') === 'true')),
    };
  });
  expect(mid.focusInForgot, 'Focus phải vào forgot-pin khi mở').toBeTruthy();
  expect(mid.lockStillOpen, 'screen-lock vẫn mở phía dưới').toBeTruthy();
  expect(mid.dashIsolated, 'Dashboard vẫn bị cô lập').toBeTruthy();

  // Đóng forgot-pin → handoff về screen-lock, focus trong lock (không kẹt ở forgot ẩn).
  await page.click('#forgot-pin-modal [data-action="closeForgotModal"]');
  await page.waitForSelector('#forgot-pin-modal', { state: 'hidden', timeout: 10_000 });
  await page.waitForSelector('#screen-lock', { state: 'visible' });
  const afterForgot = await page.evaluate(() => {
    const forgot = document.getElementById('forgot-pin-modal');
    const lock = document.getElementById('screen-lock');
    const ae = document.activeElement;
    return {
      focusInLock: !!(lock && lock.contains(ae)),
      focusInForgot: !!(forgot && forgot.contains(ae)),
      focusTag: ae ? ae.tagName : null,
      focusId: ae ? ae.id : null,
    };
  });
  expect(afterForgot.focusInForgot, 'Focus không được kẹt trong forgot-pin đã ẩn').toBeFalsy();
  expect(afterForgot.focusInLock, 'Sau đóng forgot-pin, focus phải trong screen-lock').toBeTruthy();

  // Unlock → trả focus về anchor dashboard (#btn-quick-add), không về body/hidden.
  for (const d of PIN) await page.click(`[data-action="enterPin"][data-arg="${d}"]`);
  await page.waitForSelector('#screen-lock', { state: 'hidden', timeout: 10_000 });
  await expect(page.locator('#btn-quick-add')).toBeFocused({ timeout: 5_000 });
  const finalState = await page.evaluate(() => {
    const dash = document.getElementById('screen-dashboard');
    const lock = document.getElementById('screen-lock');
    const forgot = document.getElementById('forgot-pin-modal');
    return {
      dashInert: !!(dash && dash.inert),
      focusInLock: !!(lock && lock.contains(document.activeElement)),
      focusInForgot: !!(forgot && forgot.contains(document.activeElement)),
    };
  });
  expect(finalState.dashInert).toBeFalsy();
  expect(finalState.focusInLock).toBeFalsy();
  expect(finalState.focusInForgot).toBeFalsy();
});

// UX hardening 1.1.0: axe trên màn hình chính (sau mở khóa) + modal thêm khách hàng.
// Gate ở mức CRITICAL (log SERIOUS) — đồng bộ quy ước sẵn có của repo.
test('axe: màn hình chính + modal thêm khách hàng không có vi phạm CRITICAL', async ({ page }) => {
  await page.addInitScript((env) => {
    localStorage.setItem('app_activated', 'true');
    localStorage.setItem('app_employee_id', 'TEST');
    localStorage.setItem('app_pin', env);
    localStorage.setItem('app_crypto_schema_v', '2');
    localStorage.setItem('clientpro_onboarding_done', JSON.stringify({ version: 5, completedAt: Date.now() }));
    const o = sessionStorage.getItem.bind(sessionStorage);
    sessionStorage.getItem = (k) => (k && k.indexOf('clientpro_sw_reloaded_') === 0) ? '1' : o(k);
  }, PIN_ENVELOPE);
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-lock', { state: 'visible', timeout: 10_000 });
  for (const d of PIN) await page.click(`[data-action="enterPin"][data-arg="${d}"]`);
  await page.waitForSelector('#screen-lock', { state: 'hidden', timeout: 10_000 });

  const scan = async (label) => {
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const critical = res.violations.filter((v) => v.impact === 'critical');
    const serious = res.violations.filter((v) => v.impact === 'serious');
    if (serious.length) console.log(`a11y serious [${label}] (không chặn):`, serious.map((v) => `${v.id} x${v.nodes.length}`).join(', '));
    expect(critical, `Vi phạm a11y CRITICAL [${label}]:\n` + critical.map((v) => `${v.id} x${v.nodes.length}`).join('\n')).toEqual([]);
  };

  await scan('dashboard');
  await page.click('#btn-quick-add');
  await page.waitForSelector('#add-modal', { state: 'visible' });
  await scan('add-modal');
});

// Mở rộng phủ axe: danh sách khách hàng + hồ sơ (nơi có nhiều nút icon-only),
// và 2 tool lazy-load (PDF Toolkit / Tra cứu ĐVHC). Cùng quy ước gate CRITICAL.
test('axe: danh sách KH + hồ sơ + PDF Toolkit + Tra cứu ĐVHC không có vi phạm CRITICAL', async ({ page }) => {
  await page.addInitScript((env) => {
    localStorage.setItem('app_activated', 'true');
    localStorage.setItem('app_employee_id', 'TEST');
    localStorage.setItem('app_pin', env);
    localStorage.setItem('app_crypto_schema_v', '2');
    localStorage.setItem('clientpro_onboarding_done', JSON.stringify({ version: 5, completedAt: Date.now() }));
    const o = sessionStorage.getItem.bind(sessionStorage);
    sessionStorage.getItem = (k) => (k && k.indexOf('clientpro_sw_reloaded_') === 0) ? '1' : o(k);
  }, PIN_ENVELOPE);
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-lock', { state: 'visible', timeout: 10_000 });
  for (const d of PIN) await page.click(`[data-action="enterPin"][data-arg="${d}"]`);
  await page.waitForSelector('#screen-lock', { state: 'hidden', timeout: 10_000 });

  const scan = async (label) => {
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const critical = res.violations.filter((v) => v.impact === 'critical');
    const serious = res.violations.filter((v) => v.impact === 'serious');
    if (serious.length) console.log(`a11y serious [${label}] (không chặn):`, serious.map((v) => `${v.id} x${v.nodes.length}`).join(', '));
    expect(critical, `Vi phạm a11y CRITICAL [${label}]:\n` + critical.map((v) => `${v.id} x${v.nodes.length}`).join('\n')).toEqual([]);
  };

  // Tạo 1 KH qua UI để danh sách/hồ sơ có nội dung thật (card + nút zalo/call).
  await page.click('#btn-quick-add');
  await page.waitForSelector('#add-modal', { state: 'visible' });
  await page.fill('#new-name', 'KH Kiểm Thử A11y');
  await page.fill('#new-phone', '0900000011');
  await page.click('[data-action="saveCustomer"]');
  await page.waitForSelector('#add-modal', { state: 'hidden', timeout: 10_000 });

  // App tự mở hồ sơ KH mới -> quét hồ sơ.
  await page.waitForFunction(
    () => !document.getElementById('screen-folder').classList.contains('translate-x-full'),
    undefined, { timeout: 10_000 }
  );
  await scan('folder-detail');
  await page.click('#screen-folder [data-action="closeFolder"]');
  await page.waitForFunction(
    () => document.getElementById('screen-folder').classList.contains('translate-x-full'),
    undefined, { timeout: 10_000 }
  );

  // Danh sách khách hàng.
  await page.click('[data-action="openCustomerList"][data-arg="pending"]');
  await page.waitForSelector('#screen-customer-list', { state: 'visible' });
  await expect(page.locator('.cust-card')).toHaveCount(1, { timeout: 10_000 });
  await scan('customer-list');
  await page.click('#screen-customer-list [data-action="closeCustomerList"]');

  // PDF Toolkit (lazy-load lần đầu -> chờ screen do module tạo).
  await page.click('#btn-quick-pdf');
  await page.waitForSelector('#screen-pdf-toolkit', { state: 'visible', timeout: 15_000 });
  await scan('pdf-toolkit');
  await page.click('#screen-pdf-toolkit .pdftk-back-btn');

  // Tra cứu ĐVHC (lazy-load).
  await page.click('#btn-quick-dvhc');
  await page.waitForSelector('#screen-dvhc-lookup', { state: 'visible', timeout: 15_000 });
  await scan('dvhc-lookup');
});

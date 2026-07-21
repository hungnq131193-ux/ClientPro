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

// UX hardening 1.1.0: axe trên màn hình chính (sau mở khóa) + modal thêm khách hàng.
// Gate ở mức CRITICAL (log SERIOUS) — đồng bộ quy ước sẵn có của repo.
test('axe: màn hình chính + modal thêm khách hàng không có vi phạm CRITICAL', async ({ page }) => {
  await page.addInitScript((env) => {
    localStorage.setItem('app_activated', 'true');
    localStorage.setItem('app_employee_id', 'TEST');
    localStorage.setItem('app_pin', env);
    localStorage.setItem('app_crypto_schema_v', '2');
    localStorage.setItem('clientpro_onboarding_done', JSON.stringify({ version: 4, completedAt: Date.now() }));
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

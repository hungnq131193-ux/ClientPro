// Accessibility (P3): axe-core quét màn hình đầu tiên + kiểm tra viewport cho phép zoom.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

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

// Smoke: app tải được, không lỗi console nghiêm trọng, Service Worker đăng ký,
// và cổng vào bảo mật (activation hoặc lock screen) xuất hiện — offline-first PWA.
const { test, expect } = require('@playwright/test');

test('app tải + không lỗi JS chưa bắt + Service Worker + cổng bảo mật', async ({ page }) => {
  // Chỉ CHẶN ở lỗi JS chưa bắt (pageerror = bug thật). console.error do mạng nền
  // (GAS/thời tiết) thất bại trong môi trường test là nhiễu -> chỉ log, không chặn.
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto('/index.html');
  await expect(page).toHaveTitle(/ClientPro|Quản Lý/i);

  // Service Worker đăng ký được (PWA offline-first).
  const swReady = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return !!reg || (await navigator.serviceWorker.ready.then(() => true).catch(() => false));
  });
  expect(swReady).toBeTruthy();

  // Cổng bảo mật: activation-modal hoặc screen-lock phải hiển thị (không lọt thẳng vào data).
  const gateVisible = await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return !!el && !el.classList.contains('hidden'); };
    return vis('activation-modal') || vis('screen-lock') || vis('setup-lock-modal');
  });
  expect(gateVisible).toBeTruthy();

  if (consoleErrors.length) console.log('console.error (không chặn):', consoleErrors.slice(0, 5).join(' | '));
  // Không có ngoại lệ JS chưa bắt (bug thật).
  expect(pageErrors, 'Uncaught JS errors: ' + pageErrors.join(' | ')).toEqual([]);
});

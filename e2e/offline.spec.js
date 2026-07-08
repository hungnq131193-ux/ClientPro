// Offline-first: sau khi Service Worker precache xong, ngắt mạng -> app shell vẫn mở.
const { test, expect } = require('@playwright/test');

test('offline: app shell vẫn tải sau khi SW precache (ngắt mạng)', async ({ page, context }) => {
  // Chặn reload-once của pwa.js (controllerchange) để evaluate không mất context.
  await page.addInitScript(() => {
    const o = sessionStorage.getItem.bind(sessionStorage);
    sessionStorage.getItem = (k) => (k && k.indexOf('clientpro_sw_reloaded_') === 0) ? '1' : o(k);
  });
  await page.goto('/index.html');
  // Chờ SW active + precache (controller sẵn sàng).
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    // Cho SW thời gian precache shell.
    await new Promise((r) => setTimeout(r, 1500));
  });

  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' });

  // App SHELL phục vụ từ cache offline: title đúng + JS nền (00_globals) chạy được
  // + khung DOM (#ui-modals-root) có mặt -> chứng minh index.html + module precache OK.
  await expect(page).toHaveTitle(/ClientPro|Quản Lý/i);
  const shellOk = await page.evaluate(() => {
    return typeof window.getEl === 'function' && !!document.getElementById('ui-modals-root');
  });
  expect(shellOk, 'App shell phải tải được từ cache khi offline').toBeTruthy();
  await context.setOffline(false);
});

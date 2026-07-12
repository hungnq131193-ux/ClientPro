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

// A2: asset phải được phục vụ TỪ STATIC_CACHE (precache đúng build), không phụ
// thuộc HTTP cache hay runtime cache.
//
// LƯU Ý: Playwright không mô phỏng offline được cho fetch() bên trong Service
// Worker (setOffline/route không áp lên SW target), nên "offline thật" không
// kiểm được ở đây — phép thử phân định là MARKER: ghi đè một entry trong
// STATIC_CACHE rồi fetch từ page; nếu cacheFirst đọc precache trước (code mới)
// sẽ nhận MARKER; nếu bỏ qua precache (lỗi A2 cũ) sẽ nhận nội dung từ mạng.
// Kịch bản offline-toàn-app từ precache được kiểm bổ sung ở tests/sw-routing.test.js
// (vm sandbox, network stub throw 'offline' thật sự).
test('A2: cacheFirst phục vụ asset từ STATIC_CACHE (marker test, runtime rỗng)', async ({ page, context }) => {
  await page.addInitScript(() => {
    const o = sessionStorage.getItem.bind(sessionStorage);
    sessionStorage.getItem = (k) => (k && k.indexOf('clientpro_sw_reloaded_') === 0) ? '1' : o(k);
  });
  await page.goto('/index.html');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    await new Promise((r) => setTimeout(r, 1500));
  });

  const res = await page.evaluate(async () => {
    const keys = await caches.keys();
    const staticName = keys.find((k) => k.includes('static'));
    if (!staticName) return { error: 'no static cache: ' + keys.join(',') };

    // Xóa sạch runtime cache -> chỉ còn precache.
    await Promise.all(keys.filter((k) => k.includes('runtime')).map((k) => caches.delete(k)));

    const st = await caches.open(staticName);
    const reqs = await st.keys();
    const target = reqs.find((r) => r.url.includes('/assets/') && r.url.includes('.js?v='));
    if (!target) return { error: 'no precached js asset' };

    // Ghi đè entry precache bằng MARKER.
    await st.put(target, new Response('/*CLIENTPRO_STATIC_MARKER*/', {
      status: 200, headers: { 'Content-Type': 'text/javascript' },
    }));

    const r = await fetch(target.url, { cache: 'no-store' });
    const body = await r.text();

    // Sau khi fetch, runtime cache KHÔNG được chứa bản sao thừa từ mạng.
    const rtName = (await caches.keys()).find((k) => k.includes('runtime-so'));
    let rtHasCopy = false;
    if (rtName) {
      const rt = await caches.open(rtName);
      rtHasCopy = !!(await rt.match(target.url));
    }
    return { url: target.url, marker: body.includes('CLIENTPRO_STATIC_MARKER'), rtHasCopy };
  });

  expect(res.error).toBeUndefined();
  expect(res.marker, `cacheFirst phải trả asset từ STATIC_CACHE (${res.url})`).toBeTruthy();
  expect(res.rtHasCopy, 'Precache hit không được ghi bản sao vào runtime cache').toBeFalsy();
});

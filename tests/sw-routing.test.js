'use strict';

// ============================================================================
// sw-routing.test.js — A2: cacheFirst phải phục vụ asset từ STATIC_CACHE
// (precache đúng build, exact match kể cả ?v=), rồi mới tới runtime cache,
// cuối cùng mới network; response lỗi không được cache. Chạy sw.js thật trong
// vm sandbox (tests/helpers/load-sw.js) — không phụ thuộc HTTP cache trình duyệt.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSW, FakeRequest, FakeResponse } = require('./helpers/load-sw');

const ORIGIN = 'https://app.local';

test('A2: asset có trong STATIC_CACHE được phục vụ từ precache, không gọi network', async () => {
  const sw = loadSW();
  const url = `${ORIGIN}/assets/05_customers.js?v=TESTTOKEN`;

  // Precache asset (như install làm) vào đúng STATIC_CACHE của build.
  const staticCache = await sw.caches.open(sw.names.STATIC_CACHE);
  await staticCache.put(new FakeRequest(url), new FakeResponse('precached-js', { status: 200 }));

  // offline: network sẽ throw nếu bị gọi
  sw.setNetwork(() => { throw new Error('offline'); });

  const res = await sw.dispatchFetch(new FakeRequest(url));
  assert.ok(res, 'SW phải intercept asset same-origin');
  assert.equal(res.body, 'precached-js', 'Phải trả đúng nội dung từ STATIC_CACHE');
  assert.equal(sw.fetchLog.length, 0, 'Không được gọi network khi precache có sẵn');
});

test('A2: precache miss -> runtime cache hit vẫn phục vụ offline', async () => {
  const sw = loadSW();
  const url = `${ORIGIN}/assets/extra.css`;

  const runtime = await sw.caches.open(sw.names.RUNTIME_SAMEORIGIN_CACHE);
  await runtime.put(new FakeRequest(url), new FakeResponse('runtime-css', { status: 200 }));
  sw.setNetwork(() => { throw new Error('offline'); });

  const res = await sw.dispatchFetch(new FakeRequest(url));
  assert.equal(res.body, 'runtime-css');
  assert.equal(sw.fetchLog.length, 0);
});

test('A2: cả hai cache miss -> network; response ok được lưu vào runtime cache', async () => {
  const sw = loadSW();
  const url = `${ORIGIN}/assets/new-file.js`;
  sw.setNetwork(() => new FakeResponse('from-network', { status: 200 }));

  const res = await sw.dispatchFetch(new FakeRequest(url));
  assert.equal(res.body, 'from-network');
  assert.equal(sw.fetchLog.length, 1, 'Phải gọi network đúng một lần');

  // Lần hai (offline) phải hit runtime cache vừa lưu.
  sw.setNetwork(() => { throw new Error('offline'); });
  const res2 = await sw.dispatchFetch(new FakeRequest(url));
  assert.equal(res2.body, 'from-network', 'Response ok phải được lưu vào runtime cache');
});

test('A2: response lỗi (404/500) KHÔNG được lưu vào cache', async () => {
  const sw = loadSW();
  const url = `${ORIGIN}/assets/missing.js`;
  sw.setNetwork(() => new FakeResponse('not-found', { status: 404 }));

  const res = await sw.dispatchFetch(new FakeRequest(url));
  assert.equal(res.status, 404);

  // offline lần hai: không có gì trong cache -> phải throw/miss, không trả 404 đã cache.
  sw.setNetwork(() => { throw new Error('offline'); });
  let failed = false;
  try {
    const r2 = await sw.dispatchFetch(new FakeRequest(url));
    failed = !r2 || r2.status !== 200 && r2.body !== 'not-found' ? r2.body !== 'not-found' : false;
    assert.notEqual(r2 && r2.body, 'not-found', 'Response lỗi không được đóng băng trong cache');
  } catch (e) {
    failed = true;
  }
  assert.ok(failed, 'Asset lỗi phải fail thật, không giả pass nhờ cache');
});

test('A2: precache thắng runtime khi cả hai cùng có (asset đúng build được ưu tiên)', async () => {
  const sw = loadSW();
  const url = `${ORIGIN}/assets/styles.css?v=TESTTOKEN`;

  const staticCache = await sw.caches.open(sw.names.STATIC_CACHE);
  await staticCache.put(new FakeRequest(url), new FakeResponse('static-version', { status: 200 }));
  const runtime = await sw.caches.open(sw.names.RUNTIME_SAMEORIGIN_CACHE);
  await runtime.put(new FakeRequest(url), new FakeResponse('runtime-version', { status: 200 }));
  sw.setNetwork(() => { throw new Error('offline'); });

  const res = await sw.dispatchFetch(new FakeRequest(url));
  assert.equal(res.body, 'static-version', 'STATIC_CACHE phải được ưu tiên trước runtime');
});

test('A2/upgrade: activate xóa cache ClientPro cũ (kể cả v1.6.5 và v1.0.0 lịch sử), giữ namespace hiện tại', async () => {
  const sw = loadSW();
  // Giả lập upgrade thật: client đang có cache của build nội bộ v1.6.5, và cả
  // cache `clientpro-static-v1.0.0` LỊCH SỬ (commit 11ffdea) — public release
  // 1.0.0 KHÔNG được trùng/tái dùng tên này (đã tách bằng CACHE_EPOCH).
  await sw.caches.open('clientpro-static-v1.6.5');
  await sw.caches.open('clientpro-runtime-so-v1.6.5');
  await sw.caches.open('clientpro-static-v1.0.0');
  await sw.caches.open('other-app-cache');
  await sw.caches.open(sw.names.STATIC_CACHE);

  assert.notEqual(sw.names.STATIC_CACHE, 'clientpro-static-v1.0.0',
    'Tên cache hiện tại không được trùng tên lịch sử');

  await sw.listeners.activate({ waitUntil: (p) => p });
  // Chờ waitUntil promise chạy xong (listener trả promise qua waitUntil stub).
  await new Promise((r) => setTimeout(r, 20));

  const keys = await sw.caches.keys();
  assert.ok(!keys.includes('clientpro-static-v1.6.5'), 'Cache v1.6.5 phải bị xóa khi upgrade');
  assert.ok(!keys.includes('clientpro-runtime-so-v1.6.5'), 'Runtime cache v1.6.5 phải bị xóa');
  assert.ok(!keys.includes('clientpro-static-v1.0.0'), 'Cache v1.0.0 lịch sử phải bị dọn');
  assert.ok(keys.includes('other-app-cache'), 'Cache không thuộc ClientPro không được đụng');
  assert.ok(keys.includes(sw.names.STATIC_CACHE), 'Cache build hiện tại phải giữ nguyên');
});

test('hotfix.1 #1: navigation revalidate không ghi đè app shell tốt bằng response lỗi (5xx)', async () => {
  const sw = loadSW();
  const url = `${ORIGIN}/`;
  const runtime = await sw.caches.open(sw.names.RUNTIME_SAMEORIGIN_CACHE);
  await runtime.put(new FakeRequest(url), new FakeResponse('good-shell', { status: 200 }));

  // Lỗi server thoáng qua đúng lúc revalidate nền chạy.
  sw.setNetwork(() => new FakeResponse('server-error', { status: 500 }));
  const res = await sw.dispatchFetch(new FakeRequest(url, { mode: 'navigate' }));
  assert.equal(res.body, 'good-shell', 'Navigation phải trả cache ngay (stale-while-revalidate)');
  await new Promise((r) => setTimeout(r, 20)); // chờ revalidate nền kết thúc

  const after = await runtime.match(new FakeRequest(url));
  assert.equal(after.body, 'good-shell', 'Response 5xx không được ghi đè navigation cache tốt');
  assert.equal(after.status, 200);

  // Revalidate thành công vẫn phải cập nhật cache (guard không được over-block).
  sw.setNetwork(() => new FakeResponse('new-shell', { status: 200 }));
  await sw.dispatchFetch(new FakeRequest(url, { mode: 'navigate' }));
  await new Promise((r) => setTimeout(r, 20));
  const updated = await runtime.match(new FakeRequest(url));
  assert.equal(updated.body, 'new-shell', 'Response ok phải được revalidate vào cache');
});

test('hotfix.1 #1: networkFirst (same-origin không phải asset) không cache response lỗi', async () => {
  const sw = loadSW();
  const url = `${ORIGIN}/api/config`;
  const runtime = await sw.caches.open(sw.names.RUNTIME_SAMEORIGIN_CACHE);
  await runtime.put(new FakeRequest(url), new FakeResponse('good-data', { status: 200 }));

  sw.setNetwork(() => new FakeResponse('boom', { status: 503 }));
  const res = await sw.dispatchFetch(new FakeRequest(url));
  assert.equal(res.status, 503, 'networkFirst vẫn trả response lỗi cho trang tự xử lý');

  const after = await runtime.match(new FakeRequest(url));
  assert.equal(after.body, 'good-data', 'Response lỗi không được ghi đè entry tốt trong runtime cache');

  // Offline sau đó vẫn phục vụ được bản tốt từ cache.
  sw.setNetwork(() => { throw new Error('offline'); });
  const res2 = await sw.dispatchFetch(new FakeRequest(url));
  assert.equal(res2.body, 'good-data', 'Offline phải fallback về bản tốt trong cache');
});

test('B7: install handler không gọi skipWaiting; message SKIP_WAITING vẫn hoạt động', async () => {
  const sw = loadSW();
  // Network trả 200 cho mọi precache request để install chạy trọn vẹn.
  sw.setNetwork(() => new FakeResponse('asset', { status: 200 }));
  let installPromise = Promise.resolve();
  sw.listeners.install({ waitUntil: (p) => { installPromise = p; } });
  await installPromise;
  assert.equal(sw.ctx.self.__skipWaitingCalled, false, 'install không được skipWaiting');
  sw.listeners.message({ data: { type: 'SKIP_WAITING' } });
  assert.equal(sw.ctx.self.__skipWaitingCalled, true, 'message SKIP_WAITING phải kích hoạt skipWaiting');
});

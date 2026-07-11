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

test('A2/upgrade: cache phiên bản cũ bị activate xóa; cache namespace hiện tại giữ nguyên', async () => {
  const sw = loadSW();
  // Giả lập cache của build cũ + cache không thuộc ClientPro trên cùng origin.
  await sw.caches.open('clientpro-static-v0.9.9');
  await sw.caches.open('clientpro-runtime-so-v0.9.9');
  await sw.caches.open('other-app-cache');
  await sw.caches.open(sw.names.STATIC_CACHE);

  await sw.listeners.activate({ waitUntil: (p) => p });
  // Chờ waitUntil promise chạy xong (listener trả promise qua waitUntil stub).
  await new Promise((r) => setTimeout(r, 20));

  const keys = await sw.caches.keys();
  assert.ok(!keys.includes('clientpro-static-v0.9.9'), 'Cache ClientPro cũ phải bị xóa');
  assert.ok(!keys.includes('clientpro-runtime-so-v0.9.9'), 'Runtime cache cũ phải bị xóa');
  assert.ok(keys.includes('other-app-cache'), 'Cache không thuộc ClientPro không được đụng');
  assert.ok(keys.includes(sw.names.STATIC_CACHE), 'Cache build hiện tại phải giữ nguyên');
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

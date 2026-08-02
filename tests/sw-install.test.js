'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSW, FakeRequest, FakeResponse } = require('./helpers/load-sw');

function requestUrl(request) {
  return typeof request === 'string' ? request : request.url;
}

async function cachedUrls(sw) {
  const cache = await sw.caches.open(sw.names.STATIC_CACHE);
  return new Set((await cache.keys()).map((request) => request.url));
}

test('SW install: mạng ổn định cache đủ toàn bộ STATIC_ASSETS', async () => {
  const sw = loadSW();
  sw.setNetwork(() => new FakeResponse('asset', { status: 200 }));

  await sw.dispatchInstall();

  const cached = await cachedUrls(sw);
  assert.equal(cached.size, sw.staticAssets.length, 'STATIC_CACHE phải đủ đúng danh sách asset');
  for (const url of sw.staticAssets) {
    assert.ok(cached.has(url), `Install còn thiếu ${url}`);
  }
});

test('SW install: asset deferred lỗi không chặn activate và critical vẫn đủ', async () => {
  const sw = loadSW();
  const failing = sw.deferredAssets.find((url) => url.includes('/vendor/pdf-lib.min.js'));
  assert.ok(failing, 'Test cần tìm thấy pdf-lib trong DEFERRED_ASSETS');
  sw.setNetwork((request) => {
    if (requestUrl(request) === failing) throw new Error('deferred offline');
    return new FakeResponse('asset', { status: 200 });
  });

  await sw.dispatchInstall();

  const cached = await cachedUrls(sw);
  assert.equal(cached.has(failing), false, 'Asset deferred lỗi không được giả vờ đã cache');
  for (const url of sw.criticalAssets) {
    assert.ok(cached.has(url), `Critical asset phải còn đủ khi deferred lỗi: ${url}`);
  }
});

test('SW install: asset critical lỗi sau retry làm install reject', async () => {
  const sw = loadSW();
  const failing = sw.criticalAssets.find((url) => url.includes('/assets/02_security.js'));
  assert.ok(failing, '02_security.js phải thuộc CRITICAL_ASSETS');
  sw.setNetwork((request) => {
    if (requestUrl(request) === failing) throw new Error('critical offline');
    return new FakeResponse('asset', { status: 200 });
  });

  await assert.rejects(sw.dispatchInstall(), /critical offline/);
  assert.equal(sw.fetchLog.filter((url) => url === failing).length, 2,
    'Critical chunk phải retry đúng một lần');
});

test('SW install: asset lỗi lần đầu được retry và cache thành công', async () => {
  const sw = loadSW();
  const flaky = sw.deferredAssets.find((url) => url.includes('/vendor/pdf-lib.min.js'));
  let attempts = 0;
  sw.setNetwork((request) => {
    if (requestUrl(request) === flaky && ++attempts === 1) throw new Error('temporary network error');
    return new FakeResponse('asset', { status: 200 });
  });

  await sw.dispatchInstall();

  const cached = await cachedUrls(sw);
  assert.ok(cached.has(flaky), 'Retry thành công phải đưa asset vào STATIC_CACHE');
  assert.equal(sw.fetchLog.filter((url) => url === flaky).length, 2,
    'Asset chập chờn phải được fetch đúng hai lần');
});

test('SW activate: top-up lại asset deferred còn thiếu trong STATIC_CACHE', async () => {
  const sw = loadSW();
  const missing = sw.deferredAssets.find((url) => url.includes('/vendor/pdf-lib.min.js'));
  sw.setNetwork(() => new FakeResponse('asset', { status: 200 }));
  await sw.dispatchInstall();

  const cache = await sw.caches.open(sw.names.STATIC_CACHE);
  await cache.delete(new FakeRequest(missing));
  sw.fetchLog.length = 0;

  await sw.dispatchActivate();

  assert.ok(await cache.match(new FakeRequest(missing)), 'Activate phải nạp bù asset còn thiếu');
  assert.equal(sw.fetchLog.filter((url) => url === missing).length, 1,
    'Top-up chỉ fetch mục thực sự còn thiếu');
});

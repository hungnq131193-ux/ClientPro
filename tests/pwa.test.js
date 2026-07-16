'use strict';

// ============================================================================
// pwa.test.js — Ưu tiên #3: PWA & Offline. Kiểm tra tĩnh (không cần trình duyệt)
// rằng Service Worker & manifest đủ điều kiện hoạt động offline-first:
//   - đăng ký install/activate/fetch + skipWaiting
//   - precache đủ shell + toàn bộ module JS nghiệp vụ + vendor sống còn
//   - phiên bản đồng bộ (bổ trợ cho check version-sync trong ci.yml)
// Phân tích văn bản nguồn, KHÔNG import asset -> không đụng versioning.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// Bỏ comment (// và /* */) để assertion không match chữ trong chú thích.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('sw.js: đủ vòng đời install/activate/fetch; KHÔNG skipWaiting ở install (B7)', () => {
  const sw = read('sw.js');
  for (const ev of ['install', 'activate', 'fetch']) {
    assert.ok(
      new RegExp(`addEventListener\\(['"]${ev}['"]`).test(sw),
      `Service Worker phải lắng nghe sự kiện "${ev}"`
    );
  }
  // B7: install KHÔNG được kích hoạt cưỡng bức — SW mới chờ lifecycle chuẩn.
  const installBlock = stripComments(sw.slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('message'")));
  assert.ok(installBlock.length > 0, 'Không cắt được install block');
  assert.ok(!/skipWaiting\s*\(\)/.test(installBlock), 'install handler không được gọi skipWaiting()');
  // Nhưng vẫn giữ hook kích hoạt có-đồng-thuận qua message.
  assert.ok(/SKIP_WAITING/.test(sw), 'Phải hỗ trợ message SKIP_WAITING');
  assert.ok(/caches\.open/.test(sw), 'Phải dùng Cache Storage API');
});

test('pwa.js: cập nhật CHỈ khi người dùng đồng ý — banner mời + reload 1 lần, không auto (B7)', () => {
  const pwa = stripComments(read('assets/pwa.js'));
  assert.ok(/__swUpdatePending/.test(pwa), 'Phải đánh dấu bản cập nhật đang chờ');
  // Hook có-đồng-thuận: nút "Cập nhật" gửi SKIP_WAITING (sw.js giữ handler này).
  assert.ok(/postMessage\(\s*\{\s*type:\s*["']SKIP_WAITING/.test(pwa), 'Nút Cập nhật phải gửi message SKIP_WAITING');
  // Reload bắt buộc nằm sau cờ đồng ý của người dùng + guard chống lặp:
  // controllerchange tự nhiên (không bấm nút) tuyệt đối không reload.
  assert.ok(/userRequestedUpdate\s*&&\s*!didReload/.test(pwa), 'Chỉ reload khi user đã bấm Cập nhật, và đúng 1 lần');
  assert.ok(/userRequestedUpdate\s*=\s*false/.test(pwa), 'Cờ đồng ý phải khởi tạo false');
  // Trang không được gọi skipWaiting() trực tiếp (chỉ qua message có-đồng-thuận).
  assert.ok(!/\.skipWaiting\s*\(/.test(pwa), 'Trang không được gọi skipWaiting() trực tiếp');
});

test('sw.js: precache đủ shell + TẤT CẢ module JS nghiệp vụ (offline không thiếu file)', () => {
  const sw = read('sw.js');

  // Mọi file assets/NN_*.js phải nằm trong precache -> offline không vỡ app.
  const moduleFiles = fs
    .readdirSync(path.join(ROOT, 'assets'))
    .filter((f) => /^\d\d_.*\.js$/.test(f));
  assert.ok(moduleFiles.length >= 20, 'Kỳ vọng >= 20 module đánh số trong assets/');

  for (const f of moduleFiles) {
    assert.ok(sw.includes(`./assets/${f}?v=`), `Precache thiếu module: assets/${f}`);
  }

  // Vendor sống còn cho crypto + bản đồ cũng phải được precache.
  for (const dep of ['vendor/crypto-js.min.js', 'vendor/maplibre-gl.js', 'vendor/supercluster.min.js', 'vendor/lucide.min.js']) {
    assert.ok(sw.includes(`./assets/${dep}?v=`), `Precache thiếu vendor: ${dep}`);
  }
});

test('sw.js + manifest + package.json: phiên bản semver đồng bộ (nguồn duy nhất: package.json)', () => {
  const sw = read('sw.js');
  const manifest = JSON.parse(read('manifest.json'));
  const pkg = JSON.parse(read('package.json'));

  const swVer = (sw.match(/VERSION\s*=\s*'v?([0-9A-Za-z.-]+)'/) || [])[1];
  assert.ok(swVer, 'Không đọc được VERSION trong sw.js');
  assert.equal(swVer, pkg.version, 'sw.js VERSION phải khớp package.json version (source of truth)');
  assert.equal(manifest.version, pkg.version, 'manifest.json version phải khớp package.json version');
});

test('sw.js: CACHE_EPOCH tách namespace cache theo bản phát hành', () => {
  const sw = read('sw.js');
  const epoch = (sw.match(/CACHE_EPOCH\s*=\s*'([^']+)'/) || [])[1];
  assert.ok(epoch, 'sw.js phải có CACHE_EPOCH');

  const ver = (sw.match(/VERSION\s*=\s*'(v?[0-9A-Za-z.-]+)'/) || [])[1];
  assert.ok(ver, 'Không đọc được VERSION trong sw.js');
  const tmpl = (sw.match(/STATIC_CACHE\s*=\s*`([^`]+)`/) || [])[1];
  assert.ok(tmpl, 'Không đọc được template STATIC_CACHE');
  assert.ok(tmpl.includes('${CACHE_EPOCH}'), 'Tên cache phải chứa CACHE_EPOCH');
  const staticName = tmpl.replace('${CACHE_EPOCH}', epoch).replace('${VERSION}', ver);

  assert.ok(staticName.includes(epoch), 'Tên cache phải chứa cache epoch hiện tại');
  assert.ok(staticName.startsWith('clientpro-'), 'Giữ prefix clientpro- để activate cleanup nhận diện');

  // Cả 4 cache đều phải nằm trong namespace epoch.
  for (const key of ['RUNTIME_SAMEORIGIN_CACHE', 'RUNTIME_CDN_CACHE', 'RUNTIME_TILE_CACHE']) {
    const t = (sw.match(new RegExp(`${key}\\s*=\\s*\`([^\`]+)\``)) || [])[1];
    assert.ok(t && t.includes('${CACHE_EPOCH}'), `${key} phải chứa CACHE_EPOCH`);
  }
});

test('sw.js: ASSET_V (cache-buster) khớp mọi ?v= trong index.html', () => {
  const sw = read('sw.js');
  const index = read('index.html');

  const assetV = (sw.match(/ASSET_V\s*=\s*'([^']+)'/) || [])[1];
  assert.ok(assetV, 'Không đọc được ASSET_V trong sw.js');

  const tokens = [...index.matchAll(/\?v=([A-Za-z0-9._-]+)/g)].map((m) => m[1]);
  assert.ok(tokens.length > 0, 'index.html phải có cache-buster ?v=');
  const unique = [...new Set(tokens)];
  assert.deepEqual(unique, [assetV], `Mọi ?v= trong index.html phải bằng ASSET_V (${assetV})`);
});

test('manifest.json: đủ trường tối thiểu để cài đặt PWA', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.ok(m.name || m.short_name, 'Manifest cần name/short_name');
  assert.ok(Array.isArray(m.icons) && m.icons.length > 0, 'Manifest cần icons');
  assert.ok(m.start_url, 'Manifest cần start_url');
  assert.ok(m.display, 'Manifest cần display mode');
});

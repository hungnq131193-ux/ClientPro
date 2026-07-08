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

test('sw.js: đăng ký đủ vòng đời install/activate/fetch + skipWaiting', () => {
  const sw = read('sw.js');
  for (const ev of ['install', 'activate', 'fetch']) {
    assert.ok(
      new RegExp(`addEventListener\\(['"]${ev}['"]`).test(sw),
      `Service Worker phải lắng nghe sự kiện "${ev}"`
    );
  }
  assert.ok(/skipWaiting\(\)/.test(sw), 'Phải gọi skipWaiting() để kích hoạt bản mới ngay');
  assert.ok(/SKIP_WAITING/.test(sw), 'Phải hỗ trợ message SKIP_WAITING');
  assert.ok(/caches\.open/.test(sw), 'Phải dùng Cache Storage API');
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
  for (const dep of ['vendor/crypto-js.min.js', 'vendor/maplibre-gl.js', 'vendor/lucide.min.js']) {
    assert.ok(sw.includes(`./assets/${dep}?v=`), `Precache thiếu vendor: ${dep}`);
  }
});

test('sw.js + manifest: phiên bản semver đồng bộ (bổ trợ check của CI)', () => {
  const sw = read('sw.js');
  const manifest = JSON.parse(read('manifest.json'));

  const swVer = (sw.match(/VERSION\s*=\s*'v?([0-9.]+)'/) || [])[1];
  assert.ok(swVer, 'Không đọc được VERSION trong sw.js');
  assert.equal(swVer, manifest.version, 'sw.js VERSION phải khớp manifest.json version');
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

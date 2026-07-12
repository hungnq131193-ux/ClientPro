#!/usr/bin/env node
// ============================================================================
// scripts/sync-version.mjs — Single source of truth cho phiên bản ClientPro.
//
// Nguồn:
//   - Semver app  : `version` trong package.json          (vd "1.4.3")
//   - Cache-buster : `ASSET_V` trong sw.js (chuỗi tự do)   (vd "REFUI_20260709")
//
// Ghi/verify semver + ASSET_V ra mọi nơi khác để KHÔNG bao giờ lệch:
//   manifest.json .version · sw.js VERSION · assets/pwa.js SW_BUILD ·
//   README.md (badge + phần "Quản lý phiên bản").
//
// Dùng:
//   node scripts/sync-version.mjs          # ghi (đồng bộ mọi file theo nguồn)
//   node scripts/sync-version.mjs --check  # chỉ kiểm tra, lệch => exit 1 (CI)
//
// Zero-dependency (chỉ node: builtins). KHÔNG đụng cơ chế ?v= trong index.html
// hay MAPLIBRE_V — phần đó đã được job version-sync trong ci.yml kiểm riêng.
// ============================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// --- Đọc nguồn ---------------------------------------------------------------
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const SEM = String(pkg.version || '');
// Chấp nhận cả hậu tố kiểu pre-release/hotfix (vd "1.0.0-hotfix.1") — core vẫn
// phải là X.Y.Z; hậu tố chỉ gồm [0-9A-Za-z.-] để an toàn cho tên cache/URL badge.
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/.test(SEM)) die(`package.json "version" không phải semver hợp lệ: "${SEM}"`);

const swSrc = readFileSync(join(ROOT, 'sw.js'), 'utf8');
const assetVMatch = swSrc.match(/ASSET_V\s*=\s*'([^']+)'/);
if (!assetVMatch) die('Không tìm thấy ASSET_V trong sw.js');
const ASSET_V = assetVMatch[1];

// --- Quy tắc đồng bộ ---------------------------------------------------------
// re bắt đúng 3 nhóm: (prefix)(giá-trị-hiện-tại)(suffix). `mid` là giá trị đúng.
const rules = [
  { file: 'manifest.json', label: 'manifest.version',      mid: SEM,        re: /("version"\s*:\s*")([^"]+)(")/ },
  { file: 'sw.js',         label: 'sw.VERSION',            mid: `v${SEM}`,  re: /(VERSION\s*=\s*')(v?[0-9A-Za-z.-]+)(')/ },
  { file: 'assets/pwa.js', label: 'pwa.SW_BUILD',          mid: `v${SEM}`,  re: /(SW_BUILD\s*=\s*')(v?[0-9A-Za-z.-]+)(')/ },
  // shields.io: dấu "-" trong text badge phải escape thành "--".
  { file: 'README.md',     label: 'README badge',          mid: SEM.replace(/-/g, '--'), re: /(badge\/version-)(.+?)(-blue\.svg)/ },
  { file: 'README.md',     label: 'README semver hiện tại', mid: SEM,       re: /(Phiên bản app \(semver\)\*\* — hiện tại \*\*`)([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)(`\*\*)/ },
  { file: 'README.md',     label: 'README ASSET_V',        mid: ASSET_V,    re: /(cache-buster asset[^\n]*?hiện tại \*\*`)([^`]+)(`)/ },
];

// --- Áp dụng -----------------------------------------------------------------
const cache = new Map(); // file -> nội dung (làm việc trên bản trong bộ nhớ)
const read = (f) => {
  if (!cache.has(f)) cache.set(f, readFileSync(join(ROOT, f), 'utf8'));
  return cache.get(f);
};

const drift = [];   // {label, current, expected}
const changed = new Set();

for (const r of rules) {
  const src = read(r.file);
  const m = src.match(r.re);
  if (!m) die(`Neo không khớp cho "${r.label}" trong ${r.file} — regex cần cập nhật.`);
  const current = m[2];
  if (current === r.mid) continue;
  drift.push({ label: r.label, file: r.file, current, expected: r.mid });
  if (!CHECK) {
    cache.set(r.file, src.replace(r.re, (_full, p, _old, s) => p + r.mid + s));
    changed.add(r.file);
  }
}

console.log(`Nguồn: package.json version=${SEM} · sw.js ASSET_V=${ASSET_V}`);

if (CHECK) {
  if (drift.length) {
    console.error('✗ Phát hiện lệch phiên bản:');
    for (const d of drift) console.error(`   - ${d.label} (${d.file}): "${d.current}" ≠ mong đợi "${d.expected}"`);
    console.error('   → chạy `npm run sync:version` để đồng bộ.');
    process.exit(1);
  }
  console.log('✓ Phiên bản đồng bộ ở mọi nơi.');
} else {
  for (const f of changed) writeFileSync(join(ROOT, f), cache.get(f));
  if (changed.size) {
    console.log(`✓ Đã đồng bộ ${drift.length} chỗ trong ${changed.size} file:`);
    for (const d of drift) console.log(`   - ${d.label} (${d.file}): "${d.current}" → "${d.expected}"`);
  } else {
    console.log('✓ Không có gì để đổi — đã đồng bộ sẵn.');
  }
}

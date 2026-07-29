#!/usr/bin/env node
// Kiểm tra chính sách repo (chạy được cả local lẫn CI — CI gọi đúng script này
// thay vì bash inline, để dev bắt lỗi trước khi push):
//   1. Không còn debug scaffold trong assets/11_edge_back_swipe.js.
//   2. Cache-buster đồng bộ: sw.js ASSET_V = mọi ?v= trong index.html
//      = MAPLIBRE_V (assets/03_map.js) = LAZY_MODULES_V (assets/01_config.js, nếu có).
//   3. Không tham chiếu CDN ngoài (app self-host toàn bộ script/style/font).
// Thoát mã != 0 khi vi phạm. Không sửa gì — chỉ đọc.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const errors = [];

// --- 1. Debug scaffold trong edge back-swipe ---
{
  const src = read('assets/11_edge_back_swipe.js');
  const re = /DEBUG_MODE|clientpro_edgeback_debug_log|clientpro-edgeback-debug|dbg\(/;
  if (re.test(src)) {
    errors.push('assets/11_edge_back_swipe.js: phát hiện debug scaffold — phải gỡ trước khi merge.');
  }
}

// --- 2. Cache-buster đồng bộ ---
{
  const swMatch = read('sw.js').match(/ASSET_V\s*=\s*'([^']+)'/);
  if (!swMatch) {
    errors.push('sw.js: không tìm thấy ASSET_V.');
  } else {
    const ASSET_V = swMatch[1];
    const tokens = [...new Set([...read('index.html').matchAll(/\?v=([A-Za-z0-9._-]+)/g)].map((m) => m[1]))];
    if (tokens.length !== 1 || tokens[0] !== ASSET_V) {
      errors.push(`index.html: mọi ?v= phải đồng nhất và bằng ASSET_V (${ASSET_V}). Tìm thấy: ${tokens.join(', ') || '(không có)'}`);
    }
    const mapMatch = read('assets/03_map.js').match(/MAPLIBRE_V\s*=\s*'([^']+)'/);
    if (!mapMatch || mapMatch[1] !== ASSET_V) {
      errors.push(`assets/03_map.js: MAPLIBRE_V (${mapMatch ? mapMatch[1] : 'không có'}) phải bằng ASSET_V (${ASSET_V}).`);
    }
    // LAZY_MODULES_V là tùy chọn (chỉ tồn tại khi có module lazy-load).
    const lazyMatch = read('assets/01_config.js').match(/LAZY_MODULES_V\s*=\s*'([^']+)'/);
    if (lazyMatch && lazyMatch[1] !== ASSET_V) {
      errors.push(`assets/01_config.js: LAZY_MODULES_V (${lazyMatch[1]}) phải bằng ASSET_V (${ASSET_V}).`);
    }
    if (errors.length === 0) console.log(`✅ Cache-buster đồng bộ: ${ASSET_V}`);
  }
}

// --- 3. Không CDN ngoài ---
{
  const CDN_RE = /unpkg\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com/;
  const targets = ['index.html', 'vercel.json'];
  for (const dir of ['assets', 'assets/css']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (/\.(js|css)$/.test(f)) targets.push(`${dir}/${f}`);
    }
  }
  for (const t of targets) {
    const lines = read(t).split('\n');
    lines.forEach((line, i) => {
      if (CDN_RE.test(line)) errors.push(`${t}:${i + 1}: tham chiếu CDN ngoài — app phải self-host toàn bộ script/style/font.`);
    });
  }
}

// --- 4. Vendor inventory: mỗi file trong assets/vendor/ phải có SHA-256
//     trên CÙNG một dòng inventory với tên file (không chấp nhận hash/file lệch dòng).
{
  const vendorDir = path.join(ROOT, 'assets/vendor');
  const readmeLines = read('assets/vendor/README.md').split(/\r?\n/);
  const files = fs.readdirSync(vendorDir).filter((f) => f !== 'README.md' && !f.startsWith('.'));
  for (const f of files) {
    const fileRe = new RegExp('`' + f.replace(/\./g, '\\.') + '`');
    const buf = fs.readFileSync(path.join(vendorDir, f));
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const hashRe = new RegExp(hash, 'i');
    const matchingLine = readmeLines.find((line) => fileRe.test(line) && hashRe.test(line));
    if (!matchingLine) {
      const hasName = readmeLines.some((line) => fileRe.test(line));
      if (!hasName) {
        errors.push(`assets/vendor/README.md: thiếu inventory cho ${f}`);
      } else {
        errors.push(`assets/vendor/README.md: SHA-256 của ${f} phải nằm cùng dòng với tên file (expected ${hash})`);
      }
    }
  }
  if (!errors.some((e) => e.includes('assets/vendor'))) {
    console.log(`✅ Vendor inventory: ${files.length} file có SHA-256 khớp trên cùng dòng`);
  }
}

if (errors.length) {
  for (const e of errors) console.error(`❌ ${e}`);
  process.exit(1);
}
console.log('✅ check-policy: đạt toàn bộ.');

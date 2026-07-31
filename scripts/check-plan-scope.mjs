#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const BASE = process.env.CLIENTPRO_PLAN_BASE || 'c4264af48aa81a27b1ddf8fdb745efdec2d558d3';
const errors = [];

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function at(ref, file) {
  return git(['show', `${ref}:${file}`]);
}

function current(file) {
  return at('HEAD', file);
}

function same(label, left, right) {
  if (left !== right) errors.push(label);
}

function stripWhitespaceEnd(text) {
  return text.replace(/[ \t]+$/gm, '').trimEnd() + '\n';
}

function section(text, start, end) {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`Cannot locate protected section: ${start} … ${end}`);
  return text.slice(a, b + end.length);
}

function functionSpan(text, name) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = re.exec(text);
  if (!match) throw new Error(`Cannot locate function ${name}`);
  const open = text.indexOf('{', match.index);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return { start: match.index, open, end: i + 1 };
    }
  }
  throw new Error(`Cannot close function ${name}`);
}

function withoutFunction(text, name) {
  const span = functionSpan(text, name);
  return text.slice(0, span.start) + `/* protected adapter:${name} */` + text.slice(span.end);
}

const changed = git(['diff', '--name-only', `${BASE}...HEAD`])
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);

const fullyAllowed = new Set([
  '.github/workflows/ci.yml',
  'CLAUDE.md',
  'README.md',
  'index.html',
  'lighthouserc.json',
  'manifest.json',
  'package.json',
  'sw.js',
  'vercel.json',
  'assets/00_globals.js',
  'assets/01_config.js',
  'assets/04_ui_common.js',
  'assets/08_images_camera.js',
  'assets/10_bootstrap.js',
  'assets/head.js',
  'assets/pwa.js',
  'assets/styles.css',
  'assets/css/app.patch.css',
  'assets/css/features.css',
  'assets/css/fonts.css',
  'assets/fonts/README.md',
  'assets/ui/load_modals.js',
  'assets/ui/modals/camera-modal.html',
  'assets/vendor/README.md',
]);
const allowedPrefixes = [
  'assets/document-scanner/',
  'docs/perf/',
  'e2e/',
  'scripts/',
  'tests/',
];
const narrowExceptions = new Set([
  'assets/02_security.js',
  'assets/03_map.js',
  'assets/05_customers.js',
  'assets/06_assets.js',
  'assets/11_edge_back_swipe.js',
  'assets/19_error_loading.js',
]);

for (const file of changed) {
  if (fullyAllowed.has(file) || narrowExceptions.has(file) || allowedPrefixes.some((prefix) => file.startsWith(prefix))) continue;
  errors.push(`Diff ngoài allowlist của plan: ${file}`);
}

// Entire forbidden subsystems must remain byte-for-byte unchanged.
for (const file of [
  'assets/07_drive.js',
  'assets/09_backup_manager.js',
  'assets/12_backup_core.js',
  'assets/14_cloud_transfer.js',
  'assets/16_auto_backup_drive.js',
]) {
  if (changed.includes(file)) errors.push(`Module cấm thay đổi có diff: ${file}`);
}
for (const prefix of ['assets/pdf-toolkit/', 'assets/dvhc-lookup/', 'assets/data/dvhc/']) {
  const hit = changed.find((file) => file.startsWith(prefix));
  if (hit) errors.push(`Khu vực cấm thay đổi có diff: ${hit}`);
}

// 02_security.js: the only approved adapter is a lock lifecycle notification;
// after removing that exact adapter, the file must equal the locked baseline.
{
  const base = at(BASE, 'assets/02_security.js');
  let now = current('assets/02_security.js');
  now = now.replace(/\n  const hadSession = !!\(masterKey \|\| masterCryptoKey\);/, '');
  now = now.replace(/\n  \/\/ Báo phiên đã khóa[\s\S]*?\n  if \(hadSession\) \{\n    try \{ document\.dispatchEvent\(new CustomEvent\("clientpro:locked"\)\); \} catch \(e\) \{\}\n  \}/, '');
  same('02_security.js có thay đổi ngoài lifecycle hook đã duyệt', stripWhitespaceEnd(base), stripWhitespaceEnd(now));
}

// 19_error_loading.js (shared LoadingManager/ErrorHandler/confirm infra): the only
// approved change is the confirm-overlay dedup — remove the replaced confirm's overlay
// synchronously so two .cp-confirm-overlay never coexist. After stripping that exact
// block the file must equal the locked baseline.
{
  const base = at(BASE, 'assets/19_error_loading.js');
  let now = current('assets/19_error_loading.js');
  now = now.replace(/\n        \/\/ Confirm cũ bị thay ngay[\s\S]*?2 \.cp-confirm-overlay\./, '');
  now = now.replace('_activeConfirmClose(false, true)', '_activeConfirmClose(false)');
  now = now.replace('function cleanup(result, immediate) {', 'function cleanup(result) {');
  now = now.replace(/\n        \/\/ Bị confirm khác thay thế[\s\S]*?else afterEnd\(overlay, \(\) => \{ try \{ overlay\.remove\(\); \} catch \(e\) \{\} \}\);/,
    "\n        afterEnd(overlay, () => { try { overlay.remove(); } catch (e) {} });");
  same('19_error_loading.js có thay đổi ngoài confirm-overlay dedup', stripWhitespaceEnd(base), stripWhitespaceEnd(now));
}

// Map may only receive the release cache/version token.
{
  const normalize = (text) => text.replace(/const MAPLIBRE_V = '[^']+';/, "const MAPLIBRE_V = '<VERSION>'; ");
  same('03_map.js có thay đổi ngoài MAPLIBRE_V', stripWhitespaceEnd(normalize(at(BASE, 'assets/03_map.js'))), stripWhitespaceEnd(normalize(current('assets/03_map.js'))));
}

// Customer adapter: every byte outside openModal stays locked. Inside openModal,
// remove only the lazy-fragment prologue and map the modal variable back to the
// original DOM expression before comparing the business form initialization.
{
  const base = at(BASE, 'assets/05_customers.js');
  const now = current('assets/05_customers.js');
  same(
    '05_customers.js có thay đổi ngoài openModal adapter',
    stripWhitespaceEnd(withoutFunction(base, 'openModal')),
    stripWhitespaceEnd(withoutFunction(now, 'openModal')),
  );

  const baseSpan = functionSpan(base, 'openModal');
  const nowSpan = functionSpan(now, 'openModal');
  const baseFn = base.slice(baseSpan.start, baseSpan.end);
  let nowFn = now.slice(nowSpan.start, nowSpan.end);
  const businessAnchor = '    // Vô hiệu hóa lượt decrypt sửa-hồ-sơ còn treo';
  const businessAt = nowFn.indexOf(businessAnchor);
  if (businessAt < 0) {
    errors.push('05_customers.js openModal thiếu phần business initialization gốc');
  } else {
    nowFn = 'function openModal() {\n' + nowFn.slice(businessAt);
    nowFn = nowFn.replace("    modal.classList.remove('hidden');", "    getEl('add-modal').classList.remove('hidden');");
    same('05_customers.js openModal thay đổi ngoài lazy-modal prologue', stripWhitespaceEnd(baseFn), stripWhitespaceEnd(nowFn));
  }
  if (!/ModalLoader\.ensure\('add-modal'\)/.test(now.slice(nowSpan.start, nowSpan.end))) {
    errors.push('05_customers.js openModal phải await ModalLoader.ensure(add-modal)');
  }
}

// Asset adapters: ensure deferred modal DOM exists before the existing handlers.
{
  const base = at(BASE, 'assets/06_assets.js');
  let now = current('assets/06_assets.js');
  now = now.replace('async function referenceAssetPrice(assetIndex) {', 'function referenceAssetPrice(assetIndex) {');
  now = now.replace(/\n  \/\/ Modal nghiệp vụ lazy — ensure trước khi đụng DOM[\s\S]*?\n  \}\n  \/\/ 1\. Lấy tài sản đang chọn/, '\n  // 1. Lấy tài sản đang chọn');
  now = now.replace(/    if \(editBtn\) editBtn\.addEventListener\("click", async \(\) => \{[\s\S]*?\n    \}\);\n    const deleteBtn/, '    if (editBtn) editBtn.addEventListener("click", () => openEditAssetModal(index));\n    const deleteBtn');
  now = now.replace(/    if \(referenceBtn\) referenceBtn\.addEventListener\("click", async \(\) => \{[\s\S]*?\n    \}\);\n    const galleryBtn/, '    if (referenceBtn) referenceBtn.addEventListener("click", () => referenceAssetPrice(index));\n    const galleryBtn');
  now = now.replace(/async function openEditAssetModal\(index\) \{\n  \/\/ Modal nghiệp vụ lazy[\s\S]*?\n  \/\/ Hiện modal\n  const modal = getEl\("asset-modal"\);\n  if \(!modal\) return;\n  modal\.classList\.remove\("hidden"\);/, 'async function openEditAssetModal(index) {\n  // Hiện modal\n  getEl("asset-modal").classList.remove("hidden");');
  same('06_assets.js có thay đổi ngoài lazy-modal adapters', stripWhitespaceEnd(base), stripWhitespaceEnd(now));
}

// Navigation exception is limited to registering doc-scan-review with the existing
// back cascade/history list. Removing those lines must restore the baseline file.
{
  const base = at(BASE, 'assets/11_edge_back_swipe.js');
  let now = current('assets/11_edge_back_swipe.js');
  now = now.replace(/\n    if \(isVisibleModal\('doc-scan-review'\)\) \{[\s\S]*?\n    \}\n    if \(isVisibleModal\('camera-modal'\)\)/, "\n    if (isVisibleModal('camera-modal'))");
  now = now.replace("'doc-scan-review', 'camera-modal'", "'camera-modal'");
  same('11_edge_back_swipe.js có thay đổi ngoài scanner back adapter', stripWhitespaceEnd(base), stripWhitespaceEnd(now));
}

// DB open/schema/migration block is protected byte-for-byte.
{
  const start = 'const req = indexedDB.open(DB_NAME, 5);';
  const end = 'req.onsuccess = (e) => {';
  same('IndexedDB schema/open block đã thay đổi', section(at(BASE, 'assets/10_bootstrap.js'), start, end), section(current('assets/10_bootstrap.js'), start, end));
}

// Encryption through image transaction handlers must remain byte-for-byte
// untouched. The document compression profile is introduced before this marker
// and passed after the callback, so it cannot alter the protected data path.
{
  const start = 'let storedData = compressed;';
  const end = 'imgTx.onabort = imgTxFail;';
  same('Khối encryptImageData → image transaction đã thay đổi', section(at(BASE, 'assets/08_images_camera.js'), start, end), section(current('assets/08_images_camera.js'), start, end));
}

if (errors.length) {
  errors.forEach((error) => console.error(`❌ ${error}`));
  process.exit(1);
}

console.log(`✅ Plan scope: ${changed.length} file nằm trong allowlist; crypto/IDB/backup/Drive/business data flow được bảo vệ.`);

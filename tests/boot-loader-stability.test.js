'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function fnBody(src, name) {
  const match = src.match(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  assert.ok(match, `Không tìm thấy function ${name}`);
  const open = src.indexOf('{', match.index);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  assert.fail(`Không cắt được function ${name}`);
}

test('boot loader: giữ contentful paint thật, park sau gate và không rewrite khi ẩn', () => {
  const css = read('assets/css/fonts.css');
  const head = read('assets/head.js');

  assert.match(css, /#loader-text\s*\{[\s\S]*font-family:\s*system-ui/,
    'loader text phải còn hiển thị bằng system font để browser có FCP thật');
  assert.doesNotMatch(css, /body:not\(\[data-cp-boot-ready="1"\]\)\s+#loader-text[\s\S]*clip:\s*rect/,
    'không được visually-hide loader text — Lighthouse sẽ báo NO_FCP');

  const stabilize = fnBody(head, 'stabilizeLoadingManager');
  assert.match(stabilize, /text\.textContent\s*!==\s*desired/,
    'chỉ thay loader copy khi thông điệp thực sự đổi');
  assert.match(stabilize, /manager\.hideGlobal\s*=\s*function stableHideGlobal/,
    'hideGlobal phải được ổn định trước bootstrap');
  assert.match(stabilize, /visibleSecurityGate\(\)[\s\S]*classList\.add\('cp-loader-parked'\)/,
    'security gate phải park loader thay vì xóa LCP candidate');
  const hideStart = stabilize.indexOf('manager.hideGlobal');
  const hidePart = stabilize.slice(hideStart);
  assert.doesNotMatch(hidePart, /textContent\s*=/,
    'hideGlobal không được thay textContent của node đã ẩn/parked');

  const sync = fnBody(head, 'syncBootShell');
  assert.match(sync, /classList\.contains\('hidden'\)[\s\S]*classList\.remove\('hidden'\)[\s\S]*classList\.add\('cp-loader-parked'\)/,
    'observer phải đóng race hide trước khi security fragment được chèn');
  assert.match(sync, /cp-loader-parked[\s\S]*releaseBootShell\('security-gate'\)/,
    'chỉ release boot sau khi loader đã parked ổn định');
  assert.match(head, /watchLoadingManagerExport\(\)/,
    'head.js phải intercept export LoadingManager trước bootstrap');
});

test('boot/theme: release marker bền qua body.className và bị thu hồi khi khóa', () => {
  const head = read('assets/head.js');
  const css = read('assets/css/fonts.css');
  const release = fnBody(head, 'releaseBootShell');
  const close = fnBody(head, 'closeBusinessShellForGate');

  assert.match(release, /setAttribute\('data-cp-boot-ready',\s*'1'\)/);
  assert.match(release, /reason\s*===\s*'unlocked'[\s\S]*classList\.add\('hidden'\)/,
    'unlock phải gỡ loader parked trước khi lộ business shell');
  assert.match(close, /removeAttribute\('data-cp-boot-ready'\)/);
  assert.match(css, /body:not\(\[data-cp-boot-ready="1"\]\)/,
    'critical CSS phải dựa vào marker không bị setTheme xóa');
});

test('lazy security transitions: đảm bảo DOM đích trước khi hàm cũ dereference', () => {
  const load = read('assets/ui/load_modals.js');
  for (const [fn, modal] of [
    ['forgotPin', 'forgot-pin-modal'],
    ['checkRecovery', 'setup-lock-modal'],
    ['_openForcedPinUpgrade', 'setup-lock-modal'],
    ['_revokeAndShowActivationGate', 'activation-modal'],
  ]) {
    const pattern = new RegExp(`installFunctionGuard\\('${fn}'[\\s\\S]*?ModalLoader\\.ensure\\('${modal}'\\)`);
    assert.match(load, pattern, `${fn} phải ensure ${modal}`);
  }
  assert.match(load, /initInsertedModalLifecycle\(modal\)/,
    'modal chèn theo nhu cầu phải đăng ký lại focus trap/a11y');
});

test('scanner open: mọi prerequisite async đều revalidate epoch/unlock trước camera', () => {
  const head = read('assets/head.js');
  const guarded = fnBody(head, 'installScannerOpenGuard');
  const close = fnBody(head, 'closeBusinessShellForGate');

  assert.match(guarded, /await Promise\.all\([\s\S]*scannerOpenAllowed\(epoch\)/,
    'phải revalidate sau khi nạp geometry/enhance');
  assert.match(guarded, /await window\.ModalLoader\.ensure\('camera-modal'\)[\s\S]*scannerOpenAllowed\(epoch\)/,
    'phải revalidate sau khi nạp camera modal');
  assert.match(guarded, /await window\.ModalLoader\.ensureFeatureCss\(\)[\s\S]*scannerOpenAllowed\(epoch\)/,
    'phải revalidate sau khi nạp scanner CSS');
  assert.match(close, /scannerOpenEpoch\+\+/,
    'lock/security gate phải hủy open đang chờ');
  assert.match(head, /visibilityState\s*===\s*'hidden'[\s\S]*scannerOpenEpoch\+\+/,
    'ẩn trang phải hủy open đang chờ');
});

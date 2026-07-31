'use strict';

// Structural tripwires for the v1.5.2 security-gate / slide-a11y / folder-scrub patch.
// The logic lives entirely in the plan's allowed UI-shell files (head.js, 00_globals.js,
// 04_ui_common.js) — never in the locked crypto/business modules — so a future refactor
// cannot silently reintroduce the loader hang, drop screen isolation, or leave customer
// data in the DOM. Behavioral proof lives in e2e/security-settings.spec.js + e2e/crud.spec.js.

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

test('loader hang: đóng security gate trên phiên đã mở khóa phải phục hồi business shell', () => {
  const head = read('assets/head.js');
  const restore = fnBody(head, 'restoreBusinessShellAfterGate');

  assert.match(restore, /isAppUnlocked\(\)\)\s*return/,
    'chỉ phục hồi khi phiên thực sự đã mở khóa (lock/revoke giữ isAppUnlocked=false)');
  assert.match(restore, /visibleSecurityGate\(\)\)\s*return/,
    'không phục hồi khi vẫn còn một security gate đang mở');
  assert.match(restore, /classList\.remove\('cp-loader-parked'\)[\s\S]*classList\.add\('hidden'\)/,
    'phải gỡ loader parked và ẩn nó trước khi lộ dashboard');
  assert.match(restore, /releaseBootShell\('gate-closed'\)/,
    'phải đặt lại data-cp-boot-ready qua releaseBootShell');
  assert.doesNotMatch(restore, /new CustomEvent\(["']clientpro:unlocked/,
    'phục hồi KHÔNG được phát clientpro:unlocked (không chạy lại unlock lifecycle/auto-backup)');
  assert.match(head, /addEventListener\('clientpro:security-gate-hidden',\s*restoreBusinessShellAfterGate\)/,
    'head.js phải lắng nghe clientpro:security-gate-hidden');
});

test('security gate observer: phát security-gate-hidden và dọn input khi cổng ẩn', () => {
  const ui = read('assets/04_ui_common.js');
  // Bộ quan sát cổng bảo mật (đã publish security-gate-shown) phải phát cả biến cố ẩn.
  assert.match(ui, /new CustomEvent\('clientpro:security-gate-hidden'/,
    '04_ui_common phải phát clientpro:security-gate-hidden khi cổng ẩn');
  assert.match(ui, /!visible && wasVisible\.get\(gate\)\)\s*gateHidden\(gate\)/,
    'observer phải nhận diện chuyển visible→hidden');

  // gateHidden là arrow const — lấy vùng lân cận để kiểm tra hành vi dọn input.
  const a = ui.indexOf('const gateHidden');
  assert.ok(a > -1, 'phải có gateHidden');
  const region = ui.slice(a, a + 900);
  assert.match(region, /setup-lock-modal'\s*\|\|\s*gate\.id === 'biometric-setup-modal'/,
    'chỉ dọn input cho setup-lock / biometric-setup');
  assert.match(region, /querySelectorAll\('input'\)[\s\S]*value = ''/,
    'phải xoá giá trị input (PIN mới / mã nhân viên) khi cổng ẩn');
});

test('slide a11y: syncScreenA11y cô lập mọi screen trừ screen trên cùng', () => {
  const globals = read('assets/00_globals.js');
  const sync = fnBody(globals, 'syncScreenA11y');

  assert.match(sync, /!g\.classList\.contains\('hidden'\)\)\s*return/,
    'security gate mở thì nhường ModalA11y — không đụng inert/aria-hidden');
  assert.match(sync, /classList\.contains\('translate-x-full'\)/,
    'screen ngoài khung nhận biết bằng translate-x-full (không display:none)');
  assert.match(sync, /\.inert = !active/,
    'chỉ screen trên cùng được tương tác; còn lại inert');
  assert.match(sync, /setAttribute\('aria-hidden',\s*active \? 'false' : 'true'\)/,
    'screen nền/ngoài khung phải aria-hidden=true');

  const slideIn = fnBody(globals, 'slideScreenIn');
  const slideOut = fnBody(globals, 'slideScreenOut');
  assert.match(slideIn, /syncScreenA11y\(\)/, 'slideScreenIn phải đồng bộ a11y');
  assert.match(slideOut, /syncScreenA11y\(\)/, 'slideScreenOut phải đồng bộ a11y');
  for (const [name, body] of [['slideScreenIn', slideIn], ['slideScreenOut', slideOut]]) {
    assert.doesNotMatch(body, /display\s*:\s*none/, `${name} không được dùng display:none`);
    assert.doesNotMatch(body, /classList\.(add|remove)\('hidden'\)/,
      `${name} không được toggle class hidden quanh slide`);
  }
  assert.match(globals, /const UI_SLIDE_MS = 240;/, 'thời gian slide 240ms giữ nguyên');
});

test('folder scrub: clearCustomerFolderView dọn mọi field và chạy khi screen-folder trượt ra', () => {
  const globals = read('assets/00_globals.js');
  const ui = read('assets/04_ui_common.js');

  // 00_globals phát biến cố khi một screen trượt hẳn ra ngoài.
  const slideOut = fnBody(globals, 'slideScreenOut');
  assert.match(slideOut, /new CustomEvent\('clientpro:screen-slid-out'/,
    'slideScreenOut phải phát clientpro:screen-slid-out sau transition');

  const clear = fnBody(ui, 'clearCustomerFolderView');
  for (const id of ['folder-customer-name', 'info-phone', 'info-cccd', 'info-notes',
                    'content-images', 'content-assets', 'btn-detail-call', 'btn-detail-zalo']) {
    assert.ok(clear.includes(id), `clearCustomerFolderView phải dọn #${id}`);
  }
  assert.match(ui, /clientpro:screen-slid-out'[\s\S]*screen-folder'[\s\S]*clearCustomerFolderView\(\)/,
    'phải scrub #screen-folder khi nó trượt ra');
});

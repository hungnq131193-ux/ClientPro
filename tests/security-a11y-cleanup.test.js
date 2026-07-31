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
  assert.match(slideOut, /syncScreenA11y\(\)/, 'slideScreenOut vẫn phải sync ở cuối animation');
  for (const [name, body] of [['slideScreenIn', slideIn], ['slideScreenOut', slideOut]]) {
    assert.doesNotMatch(body, /display\s*:\s*none/, `${name} không được dùng display:none`);
    assert.doesNotMatch(body, /classList\.(add|remove)\('hidden'\)/,
      `${name} không được toggle class hidden quanh slide`);
  }
  assert.match(globals, /const UI_SLIDE_MS = 240;/, 'thời gian slide 240ms giữ nguyên');
});

test('slide race: slideScreenOut giữ nền inert tới khi animation kết thúc', () => {
  const globals = read('assets/00_globals.js');
  const slideOut = fnBody(globals, 'slideScreenOut');
  const head = slideOut.slice(0, slideOut.indexOf('afterTransition('));
  // Un-inert nền (syncScreenA11y quét topmost) chỉ được chạy trong afterTransition —
  // KHÔNG ở đầu, nếu không nền nhận tương tác khi màn cũ vẫn đang trượt (race đóng/mở nhanh).
  assert.doesNotMatch(head, /syncScreenA11y\(\)/,
    'slideScreenOut không được un-inert màn nền trước khi animation kết thúc');
  assert.match(head, /\.inert = true/,
    'màn hình đang đóng phải rời a11y tree ngay khi bắt đầu trượt (không đợi hết animation)');
  // Un-inert nền phải nằm SAU cb (finishClose null state) trong afterTransition.
  const afterIdx = slideOut.indexOf('afterTransition(');
  const cbIdx = slideOut.indexOf('cb()', afterIdx);
  const syncIdx = slideOut.indexOf('syncScreenA11y()', afterIdx);
  assert.ok(cbIdx > -1 && syncIdx > cbIdx,
    'nền chỉ interactive lại SAU khi cb (finishClose) chạy xong');
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
  // Vô hiệu hoá công việc còn treo theo hồ sơ đã đóng + reset trạng thái sửa ghi chú.
  assert.match(clear, /__openFolderSeq = \(window\.__openFolderSeq \|\| 0\) \+ 1/,
    'phải bump __openFolderSeq để huỷ lazy-decrypt openFolder còn treo');
  assert.match(clear, /currentAssetId = null/,
    'phải null currentAssetId để huỷ tải ảnh gallery của hồ sơ cũ');
  assert.match(clear, /readOnly = true/, 'phải thoát chế độ sửa ghi chú (info-notes readOnly)');
  assert.match(clear, /btn-edit-notes'[\s\S]*btn-save-notes/,
    'phải khôi phục nút Sửa/Lưu ghi chú về trạng thái xem');

  assert.match(ui, /clientpro:screen-slid-out'[\s\S]*screen-folder'[\s\S]*clearCustomerFolderView\(\)/,
    'phải scrub #screen-folder khi nó trượt ra');
  assert.match(ui, /screen-folder'[\s\S]*translate-x-full'\)\)\s*return/,
    'scrub phải bỏ qua nếu hồ sơ đã được mở lại (chống race đóng/mở nhanh)');
});

test('confirm: thay confirm cũ gỡ overlay NGAY qua cleanup (không 2 .cp-confirm-overlay, không treo)', () => {
  const err = read('assets/19_error_loading.js');
  const body = fnBody(err, 'ClientProConfirm');
  // Vẫn đóng confirm cũ qua cleanup chính thức (resolve promise) — nhưng với cờ immediate
  // để gỡ overlay đồng bộ, không đợi afterEnd (tránh cửa sổ 2 overlay). KHÔNG dùng
  // querySelectorAll(...).remove() trần (tripwire B5 trong regressions.test.js).
  assert.match(body, /_activeConfirmClose\(false,\s*true\)/,
    'confirm bị thay phải đóng qua cleanup với cờ immediate');
  assert.match(body, /function cleanup\(result,\s*immediate\)/,
    'cleanup phải nhận cờ immediate');
  assert.match(body, /if \(immediate\) \{ try \{ overlay\.remove\(\); \} catch \(e\) \{\} \}\s*\n\s*else afterEnd/,
    'immediate -> remove ngay; ngược lại -> animate-out qua afterEnd');
  assert.doesNotMatch(body, /querySelectorAll\(['"]\.cp-confirm-overlay['"]\)[\s\S]{0,80}\.remove\(\)/,
    'không được remove() overlay ngoài cleanup (tripwire B5)');
});

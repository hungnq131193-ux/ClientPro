'use strict';

// ============================================================================
// regressions.test.js — Tripwire tĩnh cho các fix v1.0.0 (A1, B1, B2, B5, B6, B8, B9).
// Các hành vi này chỉ kiểm chứng đầy đủ được bằng E2E/manual (touch, file picker),
// nên ở tầng unit ta khóa CẤU TRÚC code chống regress: phân tích văn bản nguồn,
// KHÔNG import asset (cùng pattern với pwa.test.js).
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Cắt thân một function khai báo dạng `function name(...) { ... }` (đếm ngoặc).
function fnBody(src, name) {
  const startRe = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = src.match(startRe);
  assert.ok(m, `Không tìm thấy function ${name}`);
  let i = src.indexOf('{', m.index);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  assert.fail(`Không cắt được thân function ${name}`);
}

test('B5: confirm mới phải đóng confirm cũ qua cleanup chính thức (không remove() trần)', () => {
  const src = read('assets/19_error_loading.js');
  assert.ok(src.includes('_activeConfirmClose'), 'Phải có tham chiếu cleanup của confirm đang mở');
  const body = fnBody(src, 'ClientProConfirm');
  assert.ok(/_activeConfirmClose\s*\(false\)/.test(body), 'Confirm bị thay thế phải resolve(false) qua cleanup');
  assert.ok(!/querySelectorAll\(['"]\.cp-confirm-overlay['"]\)[\s\S]{0,80}\.remove\(\)/.test(body),
    'Không được chỉ remove() overlay cũ — Promise sẽ treo vĩnh viễn');
});

test('B1: restoreData phải reset input.value vô điều kiện trước mọi nhánh', () => {
  const src = read('assets/09_backup_manager.js');
  const body = fnBody(src, 'restoreData');
  const resetIdx = body.search(/input\.value\s*=\s*["']{2}/);
  assert.ok(resetIdx >= 0, 'restoreData phải reset input.value = ""');
  const guardIdx = body.indexOf('__restoreInFlight');
  assert.ok(resetIdx < guardIdx, 'Reset input.value phải đứng TRƯỚC guard in-flight (phủ cả nhánh đang bận)');
});

test('B6: acceptAndRestoreById phải có in-flight guard đặt trước await đầu tiên + nhả trong finally', () => {
  const src = read('assets/14_cloud_transfer.js');
  const body = fnBody(src, 'acceptAndRestoreById');
  assert.ok(body.includes('__acceptRestoreInFlight'), 'Thiếu in-flight guard');
  const setIdx = body.search(/__acceptRestoreInFlight\s*=\s*true/);
  // Chỉ match `await <biểu thức>` thật (không match chữ "await" trong comment tiếng Việt)
  const firstAwait = body.search(/\bawait\s+[A-Za-z_(]/);
  assert.ok(setIdx >= 0 && setIdx < firstAwait, 'Cờ phải được đặt TRƯỚC lần await đầu tiên');
  assert.ok(/finally\s*\{[\s\S]*__acceptRestoreInFlight\s*=\s*false/.test(body), 'Cờ phải được nhả trong finally');
  assert.ok(body.includes('__restoredInboxIds'), 'Retry cleanup không được restore lần hai (cần tập ID đã restore)');
  // Xóa remote phải nằm SAU restore thành công
  const restoreIdx = body.indexOf('_restoreFromEncryptedContent');
  const deleteIdx = body.indexOf('deleteInboxItem');
  assert.ok(restoreIdx >= 0 && deleteIdx > restoreIdx, 'deleteInboxItem phải chạy sau restore');
});

test('B8: các nhánh xóa phải promisify transaction (onerror/onabort) và không reload để che lỗi', () => {
  const cust = read('assets/05_customers.js');
  const img = read('assets/08_images_camera.js');

  for (const [src, fn] of [
    [cust, 'deleteCurrentCustomer'],
    [cust, 'deleteSelectedCustomers'],
    [img, 'deleteSelectedImages'],
    [img, 'deleteOpenedImage'],
  ]) {
    const body = fnBody(src, fn);
    assert.ok(/await\s+__(cust|img)TxDone\(/.test(body), `${fn}: phải await txDone (oncomplete/onerror/onabort)`);
    assert.ok(!/location\.reload/.test(body), `${fn}: không được reload để xử lý lỗi`);
    assert.ok(/catch/.test(body) && /ErrorHandler\.showError/.test(body), `${fn}: lỗi phải được báo qua ErrorHandler`);
    assert.ok(/finally\s*\{[\s\S]*InFlight\s*=\s*false/.test(body), `${fn}: in-flight flag phải nhả trong finally`);
  }

  // Helper txDone phải xử lý đủ 3 sự kiện
  for (const [src, helper] of [[cust, '__custTxDone'], [img, '__imgTxDone']]) {
    const body = fnBody(src, helper);
    for (const ev of ['oncomplete', 'onerror', 'onabort']) {
      assert.ok(body.includes(ev), `${helper}: thiếu ${ev}`);
    }
  }
});

test('A1: onStart (touchstart) không được preventDefault — chỉ claim gesture trong onMove', () => {
  const src = read('assets/11_edge_back_swipe.js');
  const start = fnBody(src, 'onStart');
  // Chỉ bắt LỜI GỌI thật `<x>.preventDefault(` — không bắt chữ trong comment.
  assert.ok(!/\.\s*preventDefault\s*\(/.test(start),
    'touchstart chỉ ghi nhận candidate; preventDefault sớm giết synthetic click ở dải mép');
  const move = fnBody(src, 'onMove');
  assert.ok(/horizontal\s*&&\s*e\.cancelable[\s\S]{0,40}preventDefault/.test(move),
    'preventDefault chỉ sau khi gesture được claim (horizontal) và event cancelable');
  assert.ok(/cp-swipe-noselect/.test(move), 'Khi claim phải chặn text selection');
  const end = fnBody(src, 'onEnd');
  assert.ok(/clearSwipeNoselect/.test(end), 'onEnd phải gỡ chặn text selection');
});

test('B9: openCustomerList phải xóa ô tìm kiếm và hủy debounce đang chờ', () => {
  const cust = read('assets/05_customers.js');
  const body = fnBody(cust, 'openCustomerList');
  assert.ok(/search-input/.test(body) && /\.value\s*=\s*''/.test(body), 'Phải reset #search-input');
  assert.ok(/__searchDebounced[\s\S]{0,120}\.cancel\(\)/.test(body), 'Phải hủy debounce đang chờ');

  const globals = read('assets/00_globals.js');
  assert.ok(/debounced\.cancel\s*=/.test(globals), 'debounce() phải có .cancel()');
});

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

test('item 7: overlay cloud không dùng z-index >1000 (chỉ onboarding được phép >=1000)', () => {
  for (const p of ['assets/14_cloud_transfer.js', 'assets/13_ui_select_customers.js']) {
    const src = read(p);
    assert.ok(!/z-\[\s*(?:[1-9]\d{3,})\s*\]/.test(src),
      `${p}: overlay không được dùng z-index >=1000 (phá layering contract §9)`);
  }
});

test('item 6: _restoreFromEncryptedContent phải qua mutex restore toàn cục (acquire/release)', () => {
  const src = read('assets/09_backup_manager.js');
  const body = fnBody(src, '_restoreFromEncryptedContent');
  assert.ok(/acquireGlobalRestore\s*\(/.test(body), 'Phải acquire mutex restore toàn cục');
  assert.ok(/finally\s*\{[\s\S]*releaseGlobalRestore\s*\(/.test(body), 'Phải release mutex trong finally');

  const globals = read('assets/00_globals.js');
  assert.ok(/acquireGlobalRestore\s*=/.test(globals) && /releaseGlobalRestore\s*=/.test(globals),
    '00_globals.js phải định nghĩa mutex restore toàn cục');
});

test('item 2: inbox restore có tập ID consumed BỀN VỮNG (idempotent qua reload)', () => {
  const src = read('assets/14_cloud_transfer.js');
  assert.ok(/clientpro_inbox_consumed_ids/.test(src), 'Phải có key localStorage cho ID đã consumed');
  const body = fnBody(src, 'acceptAndRestoreById');
  assert.ok(/_isConsumedTransferId\s*\(/.test(body), 'Phải kiểm tra consumed set bền vững trước khi restore');
  assert.ok(/_markConsumedTransferId\s*\(/.test(body), 'Phải đánh dấu consumed sau restore thành công');
  // Đánh dấu consumed phải nằm TRƯỚC khi thử xóa remote (tách restore khỏi cleanup).
  const markIdx = body.indexOf('_markConsumedTransferId');
  const deleteIdx = body.indexOf('deleteInboxItem');
  assert.ok(markIdx >= 0 && deleteIdx > markIdx, 'Đánh dấu consumed phải trước deleteInboxItem');
});

test('item 5: saveSecuritySetup đi qua pipeline unlock duy nhất (completeUnlockDataLoad)', () => {
  const src = read('assets/02_security.js');
  const body = fnBody(src, 'saveSecuritySetup');
  assert.ok(/completeUnlockDataLoad\s*\(/.test(body),
    'saveSecuritySetup phải gọi completeUnlockDataLoad (gồm migration v2 + flush KDATA + dispatch unlocked)');
});

// ---------------------------------------------------------------------------
// Tripwire cho các fix v1.0.0-hotfix.1 (#1 nằm ở sw-routing.test.js — functional).
// ---------------------------------------------------------------------------

test('hotfix.1 #2: referenceAssetPrice có seq guard cho lần render đầu; closeRefModal hủy kết quả chờ', () => {
  const src = read('assets/06_assets.js');
  const ref = fnBody(src, 'referenceAssetPrice');
  assert.ok(/const seq\s*=\s*\+\+__refPriceSeq/.test(ref), 'Phải snapshot seq ngay khi mở tham khảo giá');
  assert.ok(/seq\s*!==\s*__refPriceSeq/.test(ref), 'Callback phải kiểm seq trước khi ghi DOM/mở modal');
  const close = fnBody(src, 'closeRefModal');
  assert.ok(/__refPriceSeq\+\+/.test(close), 'Đóng modal phải tăng seq để hủy kết quả về muộn');
});

test('hotfix.1 #3/#6: transaction ghi phải wire đủ onabort (guard không được treo vĩnh viễn)', () => {
  // 09_backup_manager: _idbPutBackup/_idbDeleteBackup (giữ __backupInFlight sống)
  const bm = read('assets/09_backup_manager.js');
  for (const fn of ['_idbPutBackup', '_idbDeleteBackup']) {
    const body = fnBody(bm, fn);
    for (const ev of ['oncomplete', 'onerror', 'onabort']) {
      assert.ok(body.includes(ev), `${fn}: thiếu ${ev}`);
    }
  }

  // 05_customers: _doSaveCustomer — CẢ HAI nhánh ghi (update + create)
  const cust = read('assets/05_customers.js');
  const save = fnBody(cust, '_doSaveCustomer');
  const abortCount = (save.match(/wtx\.onabort/g) || []).length;
  assert.equal(abortCount, 2, '_doSaveCustomer: cả hai transaction ghi phải có wtx.onabort');

  // 04_ui_common: persistCurrentCustomer — onDone phải chạy trên mọi kết cục,
  // và chỉ đúng MỘT lần (error bubble rồi abort không được gọi đôi).
  const ui = read('assets/04_ui_common.js');
  const persist = fnBody(ui, 'persistCurrentCustomer');
  for (const ev of ['oncomplete', 'onerror', 'onabort']) {
    assert.ok(persist.includes(ev), `persistCurrentCustomer: thiếu ${ev}`);
  }
  assert.ok(/settled/.test(persist), 'persistCurrentCustomer: onDone phải được chốt gọi một lần (settled guard)');
});

test('hotfix.1 #4: export backup fail-closed khi mất masterKey giữa chừng (không ghi ciphertext vào backup)', () => {
  const src = read('assets/12_backup_core.js');
  const norm = fnBody(src, 'normalizeCustomerForExport');
  const count = (norm.match(/_assertUnlockedForExport\s*\(\)/g) || []).length;
  assert.ok(count >= 2, 'normalizeCustomerForExport phải kiểm unlock TRƯỚC và SAU chuỗi decrypt');
  for (const fn of ['exportAll', 'exportCustomersByIds']) {
    const body = fnBody(src, fn);
    assert.ok(/_assertUnlockedForExport\s*\(\)/.test(body), `${fn}: thiếu check fail-closed`);
  }
});

test('hotfix.1 #5: CloudTransferUI.acceptAndRestore báo lỗi qua ErrorHandler (không nuốt im lặng)', () => {
  const src = read('assets/14_cloud_transfer.js');
  const m = src.match(/async acceptAndRestore\(backupId\)\s*\{[\s\S]*?\n    \},/);
  assert.ok(m, 'Không tìm thấy CloudTransferUI.acceptAndRestore');
  assert.ok(/catch\s*\([A-Za-z_$][\w$]*\)\s*\{[\s\S]*ErrorHandler\.showError/.test(m[0]),
    'acceptAndRestore phải catch và báo lỗi qua ErrorHandler.showError');
});

// ---------------------------------------------------------------------------
// Tripwire cho các fix v1.0.0-hotfix.2 — hai lớp lỗi hotfix.1 đã sửa nơi khác
// nhưng bỏ sót: (1) encryptText fail-open ghi plaintext vào field mã hóa at rest,
// (2) transaction ghi thiếu onabort (promise/loader treo vĩnh viễn).
// ---------------------------------------------------------------------------

test('hotfix.2 #1: _doSaveAsset không được ghi plaintext khi mất masterKey (gate + post-check enc)', () => {
  const src = read('assets/06_assets.js');
  const body = fnBody(src, '_doSaveAsset');
  // Gate đầu hàm: chưa mở khóa thì chặn ngay (mirror saveCustomer).
  assert.ok(/!masterKey/.test(body) && /ErrorHandler\.showError\(\s*'AUTH'/.test(body),
    '_doSaveAsset: thiếu security gate !masterKey (encryptText fail-open sẽ ghi plaintext)');
  // Post-check trong enc(): lock GIỮA chuỗi await -> encryptText trả plaintext -> phải throw.
  assert.ok(/_looksEncrypted\s*\(\s*out\s*\)/.test(body) && /ENCRYPT_UNAVAILABLE/.test(body),
    '_doSaveAsset/enc: thiếu post-check _looksEncrypted + throw ENCRYPT_UNAVAILABLE (mirror _encryptCreditLimitForWrite)');
});

test('hotfix.2 #2: closeAssetModal phải hủy lượt decrypt đang treo của openEditAssetModal', () => {
  const src = read('assets/06_assets.js');
  const body = fnBody(src, 'closeAssetModal');
  assert.ok(/__editAssetModalSeq/.test(body),
    'closeAssetModal: phải bump __editAssetModalSeq — tail decrypt cũ sẽ set lại currentAssetId sau khi đóng');
  assert.ok(/edit-asset-index/.test(body),
    'closeAssetModal: phải reset edit-asset-index (guard thứ hai của openEditAssetModal)');
});

test('hotfix.2 #3: saveCustomerNotes — post-check plaintext + tx đủ oncomplete/onerror/onabort + success sau commit', () => {
  const src = read('assets/05_customers.js');
  const body = fnBody(src, 'saveCustomerNotes');
  assert.ok(/_looksEncrypted\s*\(\s*encNotes\s*\)/.test(body),
    'saveCustomerNotes: thiếu post-check _looksEncrypted(encNotes) — encryptText fail-open sẽ ghi plaintext notes');
  for (const ev of ['wtx.oncomplete', 'wtx.onerror', 'wtx.onabort']) {
    assert.ok(body.includes(ev), `saveCustomerNotes: thiếu ${ev}`);
  }
  // Success UI (exitNotesEditMode + toast) phải nằm trong oncomplete, không phải put onsuccess.
  const okIdx = body.indexOf('wtx.oncomplete');
  const exitIdx = body.indexOf('exitNotesEditMode', body.indexOf('encNotes'));
  assert.ok(okIdx >= 0 && exitIdx > okIdx, 'saveCustomerNotes: success UI phải chạy SAU commit (trong oncomplete)');
  assert.ok(/notesTxSettled/.test(body), 'saveCustomerNotes: cần settled guard (error bubble rồi abort bắn đôi)');
});

test('hotfix.2 #4/#5: transaction ghi trong 07_drive.js phải wire onabort', () => {
  const src = read('assets/07_drive.js');
  for (const fn of ['reconnectAssetDriveFolder', '_deleteSucceededUploadsOnly']) {
    const body = fnBody(src, fn);
    assert.ok(/\bonabort\b/.test(body), `${fn}: thiếu onabort — abort không kèm request error sẽ treo loader/im lặng`);
  }
});

test('hotfix.2 #6: uploadToGoogleDrive dựng folder name từ decrypt async THẬT (không dùng _displayText đồng bộ)', () => {
  const src = read('assets/07_drive.js');
  const body = fnBody(src, 'uploadToGoogleDrive');
  assert.ok(/_displayPlainAsync/.test(body),
    'uploadToGoogleDrive: folderName phải qua _displayPlainAsync (decrypt thật, §13)');
  assert.ok(/_looksEncrypted\s*\(/.test(body) && /return;/.test(body),
    'uploadToGoogleDrive: decrypt fail phải dừng + báo lỗi, không upload folder tên rác');
  assert.ok(!/folderName:\s*`\$\{_displayText\(/.test(body),
    'uploadToGoogleDrive: không được dựng folderName trực tiếp từ _displayText đồng bộ');
});

test('hotfix.2 #7: saveImageToDB — transaction lưu ảnh đủ oncomplete/onerror/onabort', () => {
  const src = read('assets/08_images_camera.js');
  const body = fnBody(src, 'saveImageToDB');
  for (const ev of ['oncomplete', 'onerror', 'onabort']) {
    assert.ok(body.includes(ev), `saveImageToDB: thiếu ${ev} — loader "Đang lưu ảnh..." sẽ treo vĩnh viễn`);
  }
  assert.ok(/imgTxSettled/.test(body), 'saveImageToDB: cần settled guard (error bubble rồi abort bắn đôi)');
});

test('hotfix.2 #8: put-wrapper trong 2 migration của 02_security.js phải reject cả onabort', () => {
  const src = read('assets/02_security.js');
  for (const fn of ['runImageCryptoMigrationIfNeeded', 'runFieldCryptoMigrationIfNeeded']) {
    const body = fnBody(src, fn);
    assert.ok(/\bonabort\b/.test(body), `${fn}: thiếu onabort — migration treo giữa unlock flow khi tx abort`);
  }
});

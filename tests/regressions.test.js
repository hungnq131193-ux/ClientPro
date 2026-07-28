'use strict';

// ============================================================================
// regressions.test.js — Tripwire tĩnh cho các các bất biến quan trọng (A1, B1, B2, B5, B6, B8, B9).
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
// Tripwire cho các các bất biến quan trọng-nhóm ổn định A (#1 nằm ở sw-routing.test.js — functional).
// ---------------------------------------------------------------------------

test('nhóm ổn định A #2: referenceAssetPrice có seq guard cho lần render đầu; closeRefModal hủy kết quả chờ', () => {
  const src = read('assets/06_assets.js');
  const ref = fnBody(src, 'referenceAssetPrice');
  assert.ok(/const seq\s*=\s*\+\+__refPriceSeq/.test(ref), 'Phải snapshot seq ngay khi mở tham khảo giá');
  assert.ok(/seq\s*!==\s*__refPriceSeq/.test(ref), 'Callback phải kiểm seq trước khi ghi DOM/mở modal');
  const close = fnBody(src, 'closeRefModal');
  assert.ok(/__refPriceSeq\+\+/.test(close), 'Đóng modal phải tăng seq để hủy kết quả về muộn');
});

test('nhóm ổn định A #3/#6: transaction ghi phải wire đủ onabort (guard không được treo vĩnh viễn)', () => {
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

test('nhóm ổn định A #4: export backup fail-closed khi mất masterKey giữa chừng (không ghi ciphertext vào backup)', () => {
  const src = read('assets/12_backup_core.js');
  const norm = fnBody(src, 'normalizeCustomerForExport');
  const count = (norm.match(/_assertUnlockedForExport\s*\(\)/g) || []).length;
  assert.ok(count >= 2, 'normalizeCustomerForExport phải kiểm unlock TRƯỚC và SAU chuỗi decrypt');
  for (const fn of ['exportAll', 'exportCustomersByIds']) {
    const body = fnBody(src, fn);
    assert.ok(/_assertUnlockedForExport\s*\(\)/.test(body), `${fn}: thiếu check fail-closed`);
  }
});

test('nhóm ổn định A #5: CloudTransferUI.acceptAndRestore báo lỗi qua ErrorHandler (không nuốt im lặng)', () => {
  const src = read('assets/14_cloud_transfer.js');
  const m = src.match(/async acceptAndRestore\(backupId\)\s*\{[\s\S]*?\n    \},/);
  assert.ok(m, 'Không tìm thấy CloudTransferUI.acceptAndRestore');
  assert.ok(/catch\s*\([A-Za-z_$][\w$]*\)\s*\{[\s\S]*ErrorHandler\.showError/.test(m[0]),
    'acceptAndRestore phải catch và báo lỗi qua ErrorHandler.showError');
});

// ---------------------------------------------------------------------------
// Tripwire cho các các bất biến quan trọng-nhóm ổn định B — hai lớp lỗi nhóm ổn định A đã sửa nơi khác
// nhưng bỏ sót: (1) encryptText fail-open ghi plaintext vào field mã hóa at rest,
// (2) transaction ghi thiếu onabort (promise/loader treo vĩnh viễn).
// ---------------------------------------------------------------------------

test('nhóm ổn định B #1: _doSaveAsset không được ghi plaintext khi mất masterKey (gate + post-check enc)', () => {
  const src = read('assets/06_assets.js');
  const body = fnBody(src, '_doSaveAsset');
  // Gate đầu hàm: chưa mở khóa thì chặn ngay (mirror saveCustomer).
  assert.ok(/!masterKey/.test(body) && /ErrorHandler\.showError\(\s*'AUTH'/.test(body),
    '_doSaveAsset: thiếu security gate !masterKey (encryptText fail-open sẽ ghi plaintext)');
  // Post-check trong enc(): lock GIỮA chuỗi await -> encryptText trả plaintext -> phải throw.
  assert.ok(/_looksEncrypted\s*\(\s*out\s*\)/.test(body) && /ENCRYPT_UNAVAILABLE/.test(body),
    '_doSaveAsset/enc: thiếu post-check _looksEncrypted + throw ENCRYPT_UNAVAILABLE (mirror _encryptCreditLimitForWrite)');
});

test('nhóm ổn định B #2: closeAssetModal phải hủy lượt decrypt đang treo của openEditAssetModal', () => {
  const src = read('assets/06_assets.js');
  const body = fnBody(src, 'closeAssetModal');
  assert.ok(/__editAssetModalSeq/.test(body),
    'closeAssetModal: phải bump __editAssetModalSeq — tail decrypt cũ sẽ set lại currentAssetId sau khi đóng');
  assert.ok(/edit-asset-index/.test(body),
    'closeAssetModal: phải reset edit-asset-index (guard thứ hai của openEditAssetModal)');
});

test('nhóm ổn định B #3: saveCustomerNotes — post-check plaintext + tx đủ oncomplete/onerror/onabort + success sau commit', () => {
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

test('nhóm ổn định B #4/#5: transaction ghi trong 07_drive.js phải wire onabort', () => {
  const src = read('assets/07_drive.js');
  for (const fn of ['reconnectAssetDriveFolder', '_deleteSucceededUploadsOnly']) {
    const body = fnBody(src, fn);
    assert.ok(/\bonabort\b/.test(body), `${fn}: thiếu onabort — abort không kèm request error sẽ treo loader/im lặng`);
  }
});

test('nhóm ổn định B #6: uploadToGoogleDrive dựng folder name từ decrypt async THẬT (không dùng _displayText đồng bộ)', () => {
  const src = read('assets/07_drive.js');
  const body = fnBody(src, 'uploadToGoogleDrive');
  assert.ok(/_displayPlainAsync/.test(body),
    'uploadToGoogleDrive: folderName phải qua _displayPlainAsync (decrypt thật, §13)');
  assert.ok(/_looksEncrypted\s*\(/.test(body) && /return;/.test(body),
    'uploadToGoogleDrive: decrypt fail phải dừng + báo lỗi, không upload folder tên rác');
  assert.ok(!/folderName:\s*`\$\{_displayText\(/.test(body),
    'uploadToGoogleDrive: không được dựng folderName trực tiếp từ _displayText đồng bộ');
});

test('nhóm ổn định B #7: saveImageToDB — transaction lưu ảnh đủ oncomplete/onerror/onabort', () => {
  const src = read('assets/08_images_camera.js');
  const body = fnBody(src, 'saveImageToDB');
  for (const ev of ['oncomplete', 'onerror', 'onabort']) {
    assert.ok(body.includes(ev), `saveImageToDB: thiếu ${ev} — loader "Đang lưu ảnh..." sẽ treo vĩnh viễn`);
  }
  assert.ok(/imgTxSettled/.test(body), 'saveImageToDB: cần settled guard (error bubble rồi abort bắn đôi)');
});

test('ảnh: saveImageToDB phải fail-closed — chặn plaintext TRƯỚC khi mở transaction ghi', () => {
  const src = read('assets/08_images_camera.js');
  const body = fnBody(src, 'saveImageToDB');

  // encryptImageData fail-open ở tầng crypto (trả nguyên data URL khi mất
  // masterKey). Caller ghi DB phải tự xác nhận kết quả là ciphertext.
  const looksIdx = body.indexOf('_looksEncrypted');
  const addIdx = body.search(/objectStore\(\s*["']images["']\s*\)\s*\.add\(/);
  assert.ok(looksIdx !== -1,
    'saveImageToDB: thiếu kiểm tra _looksEncrypted — ảnh plaintext sẽ vào IndexedDB khi mã hóa fail-open');
  assert.ok(addIdx !== -1, 'saveImageToDB: không tìm thấy lệnh add() vào store images');
  assert.ok(looksIdx < addIdx,
    'saveImageToDB: kiểm tra ciphertext phải nằm TRƯỚC objectStore("images").add(...)');

  assert.ok(/isAppUnlocked/.test(body),
    'saveImageToDB: phải kiểm tra session còn mở khóa sau await mã hóa (auto-lock giữa chừng)');

  // Nhánh mã hóa hỏng phải dừng hẳn, không rơi xuống đường ghi.
  assert.ok(/showError\(/.test(body) && /return;/.test(body),
    'saveImageToDB: mã hóa fail phải báo lỗi + return sớm, không ghi tiếp');

  // Không hard-code tiền tố ciphertext (dùng helper chung — xem "Ciphertext rules").
  assert.ok(!/startsWith\(\s*['"]cpg1:['"]\s*\)/.test(body),
    'saveImageToDB: không hard-code prefix cpg1: cho imgCryptoV — dùng _looksEncrypted');
});

test('ảnh: handleFileUpload phải snapshot hồ sơ đích TRƯỚC khi đọc file', () => {
  const src = read('assets/08_images_camera.js');
  const body = fnBody(src, 'handleFileUpload');

  // FileReader đọc bất đồng bộ: đọc global sau đó thì user kịp đổi hồ sơ và ảnh
  // gắn nhầm đối tượng.
  assert.ok(/const\s+uploadCustomerId\s*=\s*currentCustomerId/.test(body),
    'handleFileUpload: phải snapshot currentCustomerId vào biến cục bộ ngay đầu hàm');
  assert.ok(/const\s+uploadAssetId\s*=\s*currentAssetId/.test(body),
    'handleFileUpload: phải snapshot currentAssetId vào biến cục bộ ngay đầu hàm');
  assert.ok(/saveImageToDB\([^)]*,\s*\{[\s\S]*customerId:\s*uploadCustomerId/.test(body),
    'handleFileUpload: phải truyền id đã snapshot xuống saveImageToDB qua opts');
  assert.ok(!/new FileReader\(/.test(body) && !/\.readAsDataURL\(/.test(body),
    'handleFileUpload: không mở FileReader trực tiếp — đi qua _readFileAsDataURL để giữ hàng đợi có giới hạn');

  // Helper đọc file không được tự quyết định đối tượng đích.
  const readerBody = fnBody(src, '_readFileAsDataURL');
  assert.ok(!/currentCustomerId|currentAssetId/.test(readerBody),
    '_readFileAsDataURL: không được đọc global đối tượng đích');
});

test('ảnh: gallery giải mã qua pool có giới hạn, không Promise.all toàn bộ', () => {
  const src = read('assets/08_images_camera.js');
  for (const fn of ['loadImagesFiltered', 'loadAssetImages']) {
    const body = fnBody(src, fn);
    assert.ok(/_mapPool\(\s*imgs\s*,/.test(body),
      `${fn}: phải giải mã ảnh qua _mapPool (giới hạn đồng thời), không bung hết cùng lúc`);
    assert.ok(!/Promise\.all\(\s*imgs\.map\(/.test(body),
      `${fn}: Promise.all(imgs.map(...)) làm đỉnh RAM/CPU dựng đứng trên máy yếu`);
  }
});

test('ảnh: vòng chỉnh chất lượng của compressImage phải có trần lặp', () => {
  const src = read('assets/08_images_camera.js');
  const body = fnBody(src, 'adjustAndCheck');
  // Bước giảm 0.05 / bước tăng 0.03 có thể dao động quanh dải mục tiêu mãi mãi.
  assert.ok(/MAX_STEPS|steps\s*>/.test(body),
    'adjustAndCheck: thiếu trần số vòng — ảnh biên có thể lặp setTimeout vô hạn');
  assert.ok(/lastDir/.test(body),
    'adjustAndCheck: thiếu phát hiện đảo chiều tăng/giảm quality');
});

test('map: renderMapMarkers phải có render seq + chỉ mục ảnh thay cho find lồng nhau', () => {
  const src = read('assets/03_map.js');
  const body = fnBody(src, 'renderMapMarkers');

  assert.ok(/__mapRenderSeq/.test(body),
    'renderMapMarkers: thiếu token chống 2 lượt render chồng nhau (shared __mapFeatures)');
  assert.ok(/if\s*\(!alive\(\)\)\s*return/.test(body),
    'renderMapMarkers: phải bỏ dở sau await khi có lượt render mới hơn');
  assert.ok(/__mapFeatures\s*=\s*features/.test(body),
    'renderMapMarkers: feature gom vào mảng cục bộ, chỉ công bố khi lượt render còn hiệu lực');

  // O(assets × images) khi máy có nhiều ảnh.
  assert.ok(!/allImages\.find\(\s*\w+\s*=>/.test(body),
    'renderMapMarkers: không quét allImages.find(...) cho từng TSBĐ — dùng chỉ mục Map');
  assert.ok(/imgByAssetId/.test(body) && /imgByCustomerId/.test(body),
    'renderMapMarkers: thiếu chỉ mục ảnh theo assetId/customerId');
  assert.ok(/_mapJobPool\(/.test(body),
    'renderMapMarkers: job giải mã phải chạy qua pool có giới hạn');
});

test('ĐVHC: refreshIcons phải scope lucide.createIcons theo root màn hình', () => {
  const src = read('assets/dvhc-lookup/dvhc_ui.js');
  const body = fnBody(src, 'refreshIcons');
  assert.ok(/createIcons\(\s*\{\s*root/.test(body),
    'refreshIcons: createIcons phải nhận { root } — unscoped chỉ dành cho boot (10_bootstrap.js)');
  assert.ok(/screen-dvhc-lookup/.test(body),
    'refreshIcons: cần fallback root #screen-dvhc-lookup khi screenEl chưa dựng');
});

test('nhóm ổn định B #8: put-wrapper trong 2 migration của 02_security.js phải reject cả onabort', () => {
  const src = read('assets/02_security.js');
  for (const fn of ['runImageCryptoMigrationIfNeeded', 'runFieldCryptoMigrationIfNeeded']) {
    const body = fnBody(src, fn);
    assert.ok(/\bonabort\b/.test(body), `${fn}: thiếu onabort — migration treo giữa unlock flow khi tx abort`);
  }
});

test('privacy: cache quãng đường (toạ độ GPS TSBĐ) phải seal, không ghi JSON plaintext', () => {
  const map = read('assets/03_map.js');
  const body = fnBody(map, 'fetchRoadDistances');
  assert.ok(!/localStorage\.setItem\(\s*ROAD_DIST_CACHE_KEY\s*,\s*JSON\.stringify/.test(body),
    'fetchRoadDistances: không được ghi cache plaintext trực tiếp — phải qua _writeRoadDistCacheSealed');
  assert.ok(/_writeRoadDistCacheSealed\(/.test(body), 'fetchRoadDistances: phải ghi qua helper seal');
  assert.ok(/_readRoadDistCacheAsync\(/.test(body), 'fetchRoadDistances: phải đọc qua helper unseal');
  const writeBody = fnBody(map, '_writeRoadDistCacheSealed');
  assert.ok(/_gcmEncryptField\(/.test(writeBody), '_writeRoadDistCacheSealed: phải seal AES-GCM (cpg1:)');

  const config = read('assets/01_config.js');
  assert.ok(/ROAD_DIST_CACHE_KEY\s*=\s*'app_road_dist_cache_v4'/.test(config),
    'Cache seal phải dùng key v4 (v3 là plaintext)');
  assert.ok(/ROAD_DIST_CACHE_OLD_KEYS\s*=\s*\[[^\]]*'app_road_dist_cache_v3'/.test(config),
    'v3 plaintext phải nằm trong OLD_KEYS để được dọn');
});

test('revocation: preflight chỉ xóa strike khi có verdict THẬT từ server', () => {
  const src = read('assets/15_auth_gate.js');
  const body = fnBody(src, 'preflight');
  // Nhánh "ok" đầu tiên gộp cả kết quả skipped (thiếu mã NV lúc boot trên máy đã
  // seal, offline, TTL, cooldown, lỗi mạng). Reset vô điều kiện ở đó = mỗi lần mở
  // app xóa bộ đếm -> ngưỡng 2-strike không bao giờ tới, máy bị khóa không bị chặn.
  assert.ok(/if\s*\(\s*r\s*&&\s*r\.ok\s*&&\s*!r\.skipped[^)]*\)\s*_resetLockStrikes\(\)/.test(body),
    'preflight: _resetLockStrikes phải được gate bằng !r.skipped (verdict thật)');
  assert.ok(!/if\s*\(\s*!r\s*\|\|\s*r\.ok\s*\)\s*\{\s*_resetLockStrikes\(\);/.test(body),
    'preflight: không được reset strike vô điều kiện trên nhánh ok/skipped');
});

test('revocation: check_status chạy lại sau unlock (máy đã seal mã NV không có identity lúc boot)', () => {
  const sec = read('assets/02_security.js');
  assert.ok(/(?:async\s+)?function\s+runServerStatusCheck\s*\(/.test(sec),
    '02_security.js: check_status phải tách thành runServerStatusCheck() để gọi lại được');
  const checkBody = fnBody(sec, 'checkSecurity');
  assert.ok(/runServerStatusCheck\(/.test(checkBody),
    'checkSecurity: vẫn phải chạy check ngầm lúc boot (máy legacy / cửa sổ kích hoạt)');
  assert.ok(!/action=check_status/.test(checkBody),
    'checkSecurity: không được inline lại check_status — dùng runServerStatusCheck()');

  const gate = read('assets/15_auth_gate.js');
  const listener = gate.slice(gate.indexOf('clientpro:unlocked'));
  assert.ok(/runServerStatusCheck\(/.test(listener),
    '15_auth_gate.js: listener clientpro:unlocked phải chạy bù check_status');
});

test('privacy: users-cache cloud transfer (PII NV khác) không persist — RAM-only', () => {
  const src = read('assets/14_cloud_transfer.js');
  assert.ok(!/localStorage\.setItem\(\s*USERS_CACHE_KEY/.test(src),
    'Không được ghi users-cache xuống localStorage');
  assert.ok(/localStorage\.removeItem\(\s*USERS_CACHE_KEY\s*\)/.test(src),
    'Phải dọn key persist cũ clientpro_ct_users_cache_v1');
  assert.ok(/_usersCacheRam/.test(src), 'Cache phải nằm trong RAM (_usersCacheRam)');
});

// ============================================================================
// Codex PR #136: guard liveness phải là lệnh CUỐI trước khi ghi plaintext.
//
// Lớp lỗi lặp lại 3 vòng review: kiểm generation/unlock một lần rồi `await` tiếp,
// sau đó vẫn ghi plaintext vào cache RAM — auto-lock/thu hồi lọt đúng vào khe đó và
// clearMasterKeyMaterial() bị nạp lại plaintext ngay sau khi vừa dọn.
//
// _ensureSummaryDecryptedAsync là đường nóng nhất (chạy cho từng thẻ khách hàng khi
// render danh sách) nên khoá cấu trúc ở đây. Không nạp 05_customers.js được ở tầng
// unit (1814 dòng, phụ thuộc DOM) -> phân tích văn bản nguồn như các tripwire trên.
// ============================================================================

test('liveness guard phải nằm ngay trước mỗi lệnh ghi cache summary (không await xen giữa)', () => {
  const body = fnBody(read('assets/05_customers.js'), '_ensureSummaryDecryptedAsync');

  // Guard được gom thành closure alive() — nếu ai đó bỏ closure đi thì tripwire này
  // phải đổ để buộc rà lại toàn bộ hàm chứ không im lặng bỏ qua.
  assert.ok(/const\s+alive\s*=\s*\(\)\s*=>/.test(body),
    '_ensureSummaryDecryptedAsync phải khai báo closure alive() dùng lại sau mỗi await');

  const writes = ['_applySummaryCacheEntry(', '_storeSummaryCacheEntry('];
  for (const w of writes) {
    let from = 0;
    let seen = 0;
    for (;;) {
      const at = body.indexOf(w, from);
      if (at === -1) break;
      seen++;
      from = at + w.length;

      const before = body.slice(0, at);
      const lastGuard = before.lastIndexOf('alive()');
      assert.ok(lastGuard !== -1, `Phải có alive() trước lệnh ghi ${w}`);
      const between = before.slice(lastGuard);
      assert.ok(!/\bawait\b/.test(between),
        `Có await giữa alive() và ${w} — khe cho auto-lock nạp lại plaintext vào cache`);
    }
    assert.ok(seen > 0, `Không tìm thấy lệnh ghi ${w} trong _ensureSummaryDecryptedAsync`);
  }
});

test('lỗi mạng của phiên cũ không được đặt cooldown cho phiên mới', () => {
  const body = fnBody(read('assets/15_auth_gate.js'), '_checkByIssueKdata');
  // Cooldown là "khoá mềm" 5 phút: đặt nó từ một request đã stale khiến preflight
  // sau unlock trả {skipped:cooldown} và bỏ luôn verdict device/KDATA của cả phiên.
  const WRITE = 'localStorage.setItem(AUTH_GATE_COOLDOWN_UNTIL';
  let from = 0;
  let seen = 0;
  for (;;) {
    const at = body.indexOf(WRITE, from);
    if (at === -1) break;
    seen++;
    from = at + WRITE.length;
    assert.ok(/requestStillCurrent\(\)/.test(body.slice(0, at)),
      'Mọi lệnh ghi cooldown phải nằm SAU một kiểm tra requestStillCurrent()');
  }
  assert.ok(seen > 0, 'Phải còn cơ chế cooldown');
});

// ============================================================================
// PR #136 (P1): _installMasterKey() phải FAIL-CLOSED.
//
// Hàm dựng AES-GCM key qua `await crypto.subtle.importKey`. Auto-lock/thu hồi rơi vào
// khe await đó mà hàm chỉ `return` im lặng thì caller chạy tiếp với masterKey = null:
// sealMasterKey(pin, null) tạo envelope hợp lệ chứa chuỗi "null" và GHI ĐÈ PIN_KEY/
// SEC_KEY — bản duy nhất mở được dữ liệu trên máy. Hành vi được test thật ở
// tests/master-key-install-race.test.js; ở đây khóa CẤU TRÚC để không ai lặng lẽ
// gỡ throw hoặc thêm caller mới không bắt lỗi.
// ============================================================================

test('_installMasterKey phải throw (không return im lặng) khi thế hệ khóa đổi', () => {
  const body = fnBody(read('assets/02_security.js'), '_installMasterKey');
  const at = body.indexOf('gen !== __keyGeneration');
  assert.ok(at !== -1, '_installMasterKey phải còn kiểm tra thế hệ khóa quanh await importKey');
  const branch = body.slice(at, at + 400);
  assert.ok(/throw\s+new\s+Error\(\s*["']STALE_KEY_GENERATION["']\s*\)/.test(branch),
    'Nhánh stale phải THROW STALE_KEY_GENERATION');
  assert.ok(!/\breturn\s*;/.test(branch.slice(0, branch.indexOf('throw'))),
    'Không được return im lặng trước khi throw — caller sẽ tưởng khóa đã cài');
});

test('mọi caller của _installMasterKey phải bắt lỗi cài khóa', () => {
  const src = read('assets/02_security.js');
  const CALL = 'await _installMasterKey(';
  let from = 0;
  let seen = 0;
  for (;;) {
    const at = src.indexOf(CALL, from);
    if (at === -1) break;
    seen++;
    from = at + CALL.length;
    // Cửa sổ ngay trước lời gọi phải mở một khối try (kèm catch phía sau), hoặc lời
    // gọi nằm trong một hàm migration tự throw tiếp (đường đó do
    // completeUnlockDataLoad bắt) — nhận diện bằng kiểm tra generation ngay sau.
    const before = src.slice(Math.max(0, at - 200), at);
    const after = src.slice(at, at + 400);
    const wrappedInTry = /\btry\s*\{[^}]*$/.test(before) && /\}\s*catch\s*\(/.test(after);
    const rethrowsRightAfter = /_legacyMigrationAlive\([\s\S]{0,120}throw\s+new\s+Error/.test(after);
    assert.ok(wrappedInTry || rethrowsRightAfter,
      `Lời gọi _installMasterKey tại offset ${at} không được bảo vệ bằng try/catch`);
  }
  assert.ok(seen >= 4, `Phải còn đủ các caller _installMasterKey (thấy ${seen})`);
});

test('saveSecuritySetup: mọi lệnh ghi PIN_KEY/SEC_KEY phải sau một kiểm tra phiên còn sống', () => {
  const body = fnBody(read('assets/02_security.js'), 'saveSecuritySetup');
  for (const key of ['localStorage.setItem(PIN_KEY', 'localStorage.setItem(SEC_KEY']) {
    let from = 0;
    let seen = 0;
    for (;;) {
      const at = body.indexOf(key, from);
      if (at === -1) break;
      seen++;
      from = at + key.length;
      const before = body.slice(0, at);
      const lastGuard = before.lastIndexOf('setupKeyAlive()');
      assert.ok(lastGuard !== -1, `Phải kiểm tra setupKeyAlive() trước ${key}`);
      assert.ok(!/\bawait\s+[A-Za-z_(]/.test(before.slice(lastGuard)),
        `Có await giữa setupKeyAlive() và ${key} — khe cho auto-lock ghi đè envelope`);
    }
    assert.ok(seen > 0, `Không tìm thấy lệnh ghi ${key}`);
  }
  // Envelope phải niêm phong biến cục bộ đã chốt, không đọc lại global sau await.
  assert.ok(/sealMasterKey\(pin,\s*mkForSetup\)/.test(body) && /sealMasterKey\(ans,\s*mkForSetup\)/.test(body),
    'Phải seal bằng masterKey đã chốt (mkForSetup), không đọc lại biến global sau await');
});

// ============================================================================
// PR #136 (P2): bump TOUR_VERSION KHÔNG được ép user đã hoàn tất xem lại tour.
// ============================================================================

test('shouldShowTour: user đã hoàn tất version cũ chỉ tự xem lại khi có marker pre-release', () => {
  const src = read('assets/17_onboarding_tour.js');
  const body = fnBody(src, 'shouldShowTour');
  assert.ok(/isPrereleaseTester\(\)/.test(body),
    'shouldShowTour phải gate việc phát lại sau khi bump version bằng marker pre-release');
  assert.ok(/parsed\.version\s*>=\s*TOUR_VERSION[\s\S]{0,40}return\s+false/.test(body),
    'Đã hoàn tất version hiện tại -> return false');
  // Đường "version cũ" tuyệt đối không được trả true vô điều kiện.
  assert.ok(!/return\s+parsed\.version\s*<\s*TOUR_VERSION/.test(body),
    'Không được quay lại so sánh version trần (ép toàn bộ user v cũ xem lại)');
  const marker = fnBody(src, 'isPrereleaseTester');
  assert.ok(/TOUR_PRERELEASE_KEY/.test(marker) && /localStorage\.getItem/.test(marker),
    'Marker pre-release phải đọc từ localStorage bằng khóa riêng, rõ ràng');
});

test('activateApp (gia hạn): ghi SEC_KEY và nạp mã NV vào RAM phải sau một kiểm tra phiên còn sống', () => {
  const body = fnBody(read('assets/02_security.js'), 'activateApp');
  // Kiểm tra stale ở đây phải DỪNG hẳn (return), không chỉ bỏ qua một lệnh ghi rồi
  // chạy tiếp — chạy tiếp là nạp lại mã NV (secret khôi phục) vào RAM phiên đã khóa.
  const targets = ['localStorage.setItem(SEC_KEY', '__employeeIdPlain = employeeId'];
  for (const t of targets) {
    const at = body.indexOf(t);
    assert.ok(at !== -1, `Không tìm thấy ${t} trong activateApp`);
    const before = body.slice(0, at);
    const lastGuard = before.lastIndexOf('abortActivationIfStale()');
    assert.ok(lastGuard !== -1, `Phải kiểm tra abortActivationIfStale() trước ${t}`);
    const between = before.slice(lastGuard);
    assert.ok(/\breturn\b/.test(between), `Kiểm tra stale trước ${t} phải return, không chỉ bỏ qua lệnh ghi`);
    assert.ok(!/\bawait\s+[A-Za-z_(]/.test(between), `Có await giữa kiểm tra stale và ${t}`);
  }
});

test('activateApp: đường bỏ dở không được ẩn cổng kích hoạt khi ACTIVATED_KEY đã bị thu hồi', () => {
  const body = fnBody(read('assets/02_security.js'), 'activateApp');
  // _revokeAndShowActivationGate() (thu hồi từ server) cũng đổi thế hệ khóa nhưng đã
  // dựng ĐÚNG cổng kích hoạt. Ẩn cổng đó rồi showLockScreen() là hạ thu hồi xuống
  // auto-lock thường — validatePin() không kiểm ACTIVATED_KEY nên PIN đúng vào thẳng.
  const ui = body.slice(body.indexOf('const stopActivationUi'));
  assert.ok(ui.startsWith('const stopActivationUi'), 'activateApp phải gom UI bỏ dở vào stopActivationUi()');
  const hideAt = ui.indexOf('classList.add("hidden")');
  assert.ok(hideAt !== -1, 'stopActivationUi phải có nhánh ẩn modal kích hoạt');
  assert.ok(/localStorage\.getItem\(ACTIVATED_KEY\)[\s\S]{0,200}return;/.test(ui.slice(0, hideAt)),
    'Phải kiểm ACTIVATED_KEY và return TRƯỚC khi ẩn modal kích hoạt / hiện màn khóa');
});

test('acceptKdata: chỉ được dọn KDATA của chính request (biến RAM dùng chung)', () => {
  const body = fnBody(read('assets/02_security.js'), 'ensureBackupSecret');
  const at = body.indexOf('APP_BACKUP_KDATA_B64U = ""');
  assert.ok(at !== -1, 'ensureBackupSecret phải còn nhánh dọn KDATA khi phiên chết');
  // Xóa trắng biến dùng chung sẽ cướp KDATA mà một ensureBackupSecret() MỚI vừa cài
  // trong lúc _writeCachedKdata await WebCrypto — phiên mới trả ok:true còn
  // backup/restore ngay sau đó thấy rỗng.
  const line = body.slice(body.lastIndexOf('\n', at), at + 30);
  assert.ok(/APP_BACKUP_KDATA_B64U === kdata/.test(line),
    'Lệnh dọn phải có identity-check APP_BACKUP_KDATA_B64U === kdata');
});

test('tour: observer đóng tour phải nghe MỌI màn chặn, không chỉ #screen-lock', () => {
  const body = fnBody(read('assets/17_onboarding_tour.js'), 'watchLock');
  // Thu hồi quyền (_revokeAndShowActivationGate) giữ #screen-lock ẩn và chỉ hiện
  // #activation-modal (z-index 305) — tour ở 1000+ sẽ đè lên cổng kích hoạt.
  for (const id of ['screen-lock', 'activation-modal', 'setup-lock-modal']) {
    assert.ok(body.includes(`'${id}'`), `Observer phải theo dõi #${id}`);
  }
  assert.ok(/isTourBlocked\(\)/.test(body),
    'Điều kiện đóng tour phải dùng chung isTourBlocked(), không nhân bản danh sách màn chặn');
});

test('validatePin: ẩn màn khóa phải buộc đúng lượt mở khóa, không chỉ isAppUnlocked()', () => {
  const body = fnBody(read('assets/02_security.js'), 'validatePin');
  const hideAt = body.indexOf('getEl("screen-lock").classList.add("hidden")');
  assert.ok(hideAt !== -1, 'validatePin phải còn lệnh ẩn màn khóa');
  const before = body.slice(0, hideAt);
  // isAppUnlocked() thôi thì chưa đủ: sau auto-lock, người dùng nhập PIN lại ngay và
  // lượt CŨ tỉnh dậy sẽ thấy khóa của lượt MỚI -> ẩn màn khóa giữa chừng pipeline
  // của lượt mới. Không dùng __keyGeneration được: migration legacy cố ý bump nó.
  assert.ok(/myUnlockAttempt\s*!==\s*__unlockAttemptSeq[\s\S]{0,20}return/.test(before),
    'Phải kiểm myUnlockAttempt === __unlockAttemptSeq (và return) trước khi ẩn màn khóa');
  // Vé phải nhận TRƯỚC await cài khóa: _installMasterKey gán masterKey rồi mới await
  // importKey, nên trong khe đó isAppUnlocked() đã true còn vé thì chưa đổi -> lượt cũ
  // tưởng mình vẫn sở hữu phiên.
  const claimAt = before.indexOf('++__unlockAttemptSeq');
  const installAt = before.indexOf('await _installMasterKey(');
  assert.ok(claimAt !== -1 && installAt !== -1, 'validatePin phải nhận vé và cài khóa');
  assert.ok(claimAt < installAt, 'Vé phải được nhận TRƯỚC await _installMasterKey');
  assert.ok(!/\bawait\s+[A-Za-z_(]/.test(before.slice(before.lastIndexOf('__unlockAttemptSeq'))),
    'Không được có await giữa kiểm tra lượt và lệnh ẩn màn khóa');
});

test('checkRecovery / saveSecuritySetup: nhận vé lượt mở khóa trước await cài khóa', () => {
  const src = read('assets/02_security.js');
  for (const fn of ['checkRecovery', 'saveSecuritySetup']) {
    const body = fnBody(src, fn);
    const claimMatch = /(\+\+__unlockAttemptSeq|__unlockAttemptSeq\+\+)/.exec(body);
    const claimAt = claimMatch ? claimMatch.index : -1;
    const installAt = body.indexOf('await _installMasterKey(');
    assert.ok(claimAt !== -1, `${fn} phải nhận vé lượt mở khóa`);
    assert.ok(installAt !== -1, `${fn} phải cài khóa qua _installMasterKey`);
    assert.ok(claimAt < installAt,
      `${fn}: vé phải nhận TRƯỚC await _installMasterKey (khe gán masterKey chưa có khóa phái sinh)`);
  }
});

test('completeUnlockDataLoad: chỉ nhận generation của migration khi vé lượt mở khóa còn hiệu lực', () => {
  const src = read('assets/02_security.js');
  const body = fnBody(src, 'completeUnlockDataLoad');
  assert.ok(/attemptCurrent\(\)/.test(body),
    'Pipeline phải biết vé lượt mở khóa (attemptCurrent)');
  assert.ok(/const\s+alive\s*=\s*\(\)\s*=>[^;]*attemptCurrent\(\)/.test(body),
    'alive() phải gồm cả kiểm vé: isAppUnlocked()+generation không phân biệt được lượt mới');
  const adoptAt = body.indexOf('pipelineGeneration = __keyGeneration', body.indexOf('runFieldCryptoMigrationIfNeeded'));
  assert.ok(adoptAt !== -1, 'Phải còn bước nhận generation mới sau migration legacy');
  const before = body.slice(0, adoptAt);
  const guardAt = before.lastIndexOf('attemptCurrent()');
  assert.ok(guardAt !== -1 && /return/.test(before.slice(guardAt)),
    'Phải kiểm vé (và return) TRƯỚC khi nhận generation của migration');
  // Caller thật phải truyền vé xuống, nếu không guard thành vô nghĩa.
  for (const fn of ['validatePin', 'saveSecuritySetup']) {
    assert.ok(/completeUnlockDataLoad\([^)]*myUnlockAttempt\)/.test(fnBody(src, fn)),
      `${fn} phải truyền vé lượt mở khóa xuống completeUnlockDataLoad`);
  }
});

test('UI loading/keypad dùng chung: chỉ chủ vé hiện hành được dọn', () => {
  const src = read('assets/02_security.js');

  // completeUnlockDataLoad: không được dọn vô điều kiện trong finally — lượt đã bị
  // tiếp quản mà dọn là trả keypad về giữa pipeline của lượt mới.
  const pipeline = fnBody(src, 'completeUnlockDataLoad');
  assert.ok(!/_setUnlockLoading\(false\)/.test(pipeline),
    'Pipeline phải nhả UI qua _releaseUnlockLoading (có kiểm vé), không gọi _setUnlockLoading(false) trần');
  assert.ok(/_releaseUnlockLoading\(unlockAttempt\)/.test(pipeline),
    'finally phải nhả UI theo vé của chính lượt này');

  // Helper phải thực sự kiểm vé, nếu không nó chỉ là bí danh của _setUnlockLoading.
  const release = fnBody(src, '_releaseUnlockLoading');
  assert.ok(/unlockAttempt\s*===\s*__unlockAttemptSeq/.test(release),
    '_releaseUnlockLoading phải so vé với __unlockAttemptSeq');

  // Màn khóa luôn phải hiện ra ở trạng thái nhập được PIN: _setUnlockLoading(true)
  // của một pipeline bị cắt ngang đã ẩn keypad và pipeline đó không còn quyền tự dọn.
  const lockScreen = fnBody(src, 'showLockScreen');
  assert.ok(/_setUnlockLoading\(false\)/.test(lockScreen),
    'showLockScreen phải dọn UI loading — nếu không màn khóa hiện mà không có keypad');

  // Mọi đường bỏ dở SAU khi đã nhận vé đều phải nhả UI dùng chung.
  for (const fn of ['validatePin', 'checkRecovery', 'saveSecuritySetup']) {
    assert.ok(/_releaseUnlockLoading\(/.test(fnBody(src, fn)),
      `${fn} phải nhả UI loading trên đường bỏ dở sau khi đã nhận vé`);
  }
});

test('saveSecuritySetup: đóng modal / báo thành công phải sau chốt vé cuối pipeline', () => {
  const body = fnBody(read('assets/02_security.js'), 'saveSecuritySetup');
  // `finally` của phần niêm phong bật lại nút Lưu TRƯỚC pipeline dài, nên người dùng
  // bấm Lưu lần nữa được: lượt sau nhận vé mới. Lượt cũ mà đóng modal + báo thành công
  // là phơi UI nền trong lúc lượt mới còn cài khóa/migrate/tải dữ liệu.
  const at = body.indexOf('getEl("setup-lock-modal").classList.add("hidden")');
  assert.ok(at !== -1, 'saveSecuritySetup phải còn lệnh đóng modal thiết lập');
  const before = body.slice(0, at);
  const guardAt = before.lastIndexOf('myUnlockAttempt !== __unlockAttemptSeq');
  assert.ok(guardAt !== -1, 'Phải kiểm vé trước khi đóng modal / báo thành công');
  assert.ok(/return/.test(before.slice(guardAt, guardAt + 80)), 'Chốt vé phải return');
  assert.ok(!/\bawait\s+[A-Za-z_(]/.test(before.slice(guardAt)),
    'Không được có await giữa chốt vé và các lệnh đổi UI cuối');

  // Chốt vé CHỈ được gác UI. Hệ quả đã ghi xuống đĩa phải xong ngay sau lệnh ghi
  // envelope: PIN mới đã lưu mà enrollment sinh trắc học còn mở ra PIN CŨ thì mở khóa
  // sinh trắc học hỏng im lặng dù đổi PIN đã thành công.
  const bioAt = body.indexOf('onPinChanged()');
  assert.ok(bioAt !== -1, 'saveSecuritySetup phải hủy enrollment sinh trắc học khi đổi PIN');
  const secWriteAt = body.indexOf('localStorage.setItem(SEC_KEY');
  assert.ok(secWriteAt !== -1 && bioAt > secWriteAt,
    'onPinChanged phải nằm SAU lệnh ghi envelope');
  assert.ok(bioAt < guardAt,
    'onPinChanged phải nằm TRƯỚC chốt vé — nó gắn với lệnh ghi đĩa, không gắn với UI');
});

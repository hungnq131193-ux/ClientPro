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
  // Chấp nhận cờ immediate tùy chọn: _activeConfirmClose(false) hoặc (false, true) —
  // cả hai vẫn resolve(false) qua cleanup (không remove() trần làm treo promise).
  assert.ok(/_activeConfirmClose\s*\(false\b/.test(body), 'Confirm bị thay thế phải resolve(false) qua cleanup');
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

test('edge back: review giấy tờ đóng qua DocumentScanner trước camera/screen và được track history', () => {
  const src = read('assets/11_edge_back_swipe.js');
  const back = fnBody(src, 'runBackAction');
  const reviewIdx = back.indexOf("isVisibleModal('doc-scan-review')");
  const cameraIdx = back.indexOf("isVisibleModal('camera-modal')");
  const folderIdx = back.indexOf("isVisibleSlide('screen-folder')");
  assert.ok(reviewIdx >= 0 && cameraIdx > reviewIdx && folderIdx > reviewIdx,
    'doc-scan-review phải được ưu tiên đóng trước camera và screen bên dưới');
  assert.ok(/DocumentScanner\.close\(\)/.test(back.slice(reviewIdx, cameraIdx)),
    'back ở review phải đi qua DocumentScanner.close để dọn stream/worker/plaintext');

  const trackedStart = src.indexOf('const TRACKED_MODAL_IDS');
  const trackedEnd = src.indexOf('];', trackedStart);
  assert.ok(trackedStart >= 0 && trackedEnd > trackedStart);
  assert.ok(src.slice(trackedStart, trackedEnd).includes("'doc-scan-review'"),
    'doc-scan-review phải tham gia history depth tracking');
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

test('assets: nút động phải ensure modal trước khi gọi handler trực tiếp', () => {
  const src = read('assets/06_assets.js');
  const render = fnBody(src, 'renderAssets');
  const ensureAsset = render.indexOf('ModalLoader.ensure("asset-modal")');
  const openEdit = render.indexOf('openEditAssetModal(index)');
  const ensureRef = render.indexOf('ModalLoader.ensure("ref-price-modal")');
  const openRef = render.indexOf('referenceAssetPrice(index)');
  assert.ok(ensureAsset >= 0 && openEdit > ensureAsset,
    'nút Sửa phải await ensure asset-modal trước openEditAssetModal');
  assert.ok(ensureRef >= 0 && openRef > ensureRef,
    'nút Tham khảo giá phải await ensure ref-price-modal trước referenceAssetPrice');
  assert.ok(/await\s+window\.ModalLoader\.ensure\("asset-modal"\)/.test(render)
    && /await\s+window\.ModalLoader\.ensure\("ref-price-modal"\)/.test(render),
  'hai dynamic handler phải chờ ensure hoàn tất, không chạy song song với fetch modal');
  assert.ok(/if\s*\(!getEl\("asset-modal"\)\)/.test(render)
    && /if\s*\(!getEl\("ref-price-modal"\)\)/.test(render),
  'ensure thất bại phải dừng trước khi handler dereference modal');
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

test('drive: upload ảnh KHÔNG được coi lỗi mạng/parse là "thất bại" (false-negative)', () => {
  // GAS tạo file TRƯỚC khi response về tới máy: response.json() trần biến mọi
  // lỗi mạng/body-lạ SAU thời điểm đó thành toast "Tải ảnh lên Drive thất bại"
  // dù ảnh đã nằm trên Drive. Hành vi đầy đủ có test riêng
  // (tests/drive-upload-results.test.js); đây là tripwire cấu trúc.
  const src = read('assets/07_drive.js');

  const post = fnBody(src, '_postDriveUpload');
  assert.ok(/response\.text\s*\(/.test(post) && /JSON\.parse\s*\(/.test(post),
    '_postDriveUpload: phải đọc body bằng text() rồi JSON.parse để phân biệt lỗi parse với lỗi server');
  assert.ok(!/response\.json\s*\(/.test(post),
    '_postDriveUpload: response.json() trần gộp lỗi mạng/HTML vào "thất bại"');
  assert.ok(/unconfirmed:\s*true/.test(post),
    '_postDriveUpload: lỗi mạng/parse phải thành UNCONFIRMED, không phải throw');

  const resolve = fnBody(src, '_resolveImagesForUpload');
  assert.ok(/isAppUnlocked/.test(resolve) && /_looksEncrypted/.test(resolve),
    '_resolveImagesForUpload: decryptImageData fail-open — phải chặn ciphertext + auto-lock TRƯỚC khi gửi');

  for (const fn of ['uploadToGoogleDrive', 'uploadAssetToDrive']) {
    const body = fnBody(src, fn);
    assert.ok(!/response\.json\s*\(/.test(body), `${fn}: không được gọi response.json() trần`);
    assert.ok(!/\bawait\s+fetch\s*\(/.test(body),
      `${fn}: phải đi qua _runDriveImageUpload (phân loại phán quyết), không fetch trực tiếp`);

    const resolveIdx = body.indexOf('_resolveImagesForUpload');
    const runIdx = body.indexOf('_runDriveImageUpload');
    assert.ok(resolveIdx >= 0 && runIdx > resolveIdx,
      `${fn}: phải giải mã + kiểm chứng ảnh TRƯỚC khi gửi request`);

    // Chỉ OK/PARTIAL mới được xóa ảnh gốc: nhánh UNCONFIRMED phải return trước đó.
    const unconfIdx = body.indexOf('DRIVE_UPLOAD_UNCONFIRMED');
    const delIdx = body.indexOf('_deleteSucceededUploadsOnly');
    assert.ok(unconfIdx >= 0, `${fn}: thiếu nhánh UNCONFIRMED — mọi kết quả không rõ sẽ bị báo thất bại`);
    assert.ok(delIdx > unconfIdx,
      `${fn}: xóa ảnh gốc phải nằm SAU nhánh UNCONFIRMED (không xóa khi chưa chắc ảnh đã lên Drive)`);
    assert.ok(/outcome\.succeeded/.test(body),
      `${fn}: chỉ được xóa những ảnh đối chiếu được files[i].id (outcome.succeeded)`);
    assert.ok(/reachedDrive/.test(body),
      `${fn}: lỗi SAU khi Drive đã nhận ảnh không được báo thành "tải ảnh thất bại"`);

    // UI thường trú ở lại sau khi toast biến mất -> nhánh UNCONFIRMED phải render
    // trạng thái "chưa xác nhận", không phải trạng thái hoàn tất.
    const renderIdx = body.indexOf('DRIVE_STATUS_UNCONFIRMED');
    assert.ok(renderIdx > unconfIdx && renderIdx < delIdx,
      `${fn}: nhánh UNCONFIRMED phải render trạng thái chưa xác nhận (DRIVE_STATUS_UNCONFIRMED)`);
  }

  // Trạng thái hoàn tất chỉ được nói "Đã tải ảnh lên Drive" khi KHÔNG unconfirmed.
  const render = fnBody(src, 'renderDriveStatus');
  assert.ok(/unconfirmed\s*\?/.test(render) && /Đã tải ảnh lên Drive/.test(render),
    'renderDriveStatus: chú thích hoàn tất phải phụ thuộc cờ unconfirmed');
});

test('auto backup Drive: upload không rõ kết quả phải dò xác nhận trước khi kết luận (chống "1 lúc 3 file")', () => {
  // GAS handleCreateBackup_ tạo file TRƯỚC khi response về tới máy: coi mọi
  // response mất/HTML là "thất bại" thì mốc 24h + hash không được ghi và mỗi lần
  // unlock/visibilitychange tải lên một file mới. Hành vi đầy đủ có test riêng
  // (tests/auto-backup-duplicate.test.js); đây là tripwire cấu trúc.
  const src = read('assets/16_auto_backup_drive.js');

  const up = fnBody(src, 'uploadAutoBackupToServer');
  assert.ok(/response\.text\s*\(/.test(up) && /JSON\.parse\s*\(/.test(up),
    'uploadAutoBackupToServer: phải đọc body bằng text() rồi JSON.parse trong try (phân biệt lỗi parse với lỗi server)');
  assert.ok(!/response\.json\s*\(/.test(up),
    'uploadAutoBackupToServer: response.json() trần biến upload-thành-công-nhưng-mất-response thành thất-bại -> sinh bản trùng');

  // UNCONFIRMED phải dò xác nhận bằng probe CÓ THỬ LẠI trước khi chốt mốc 24h.
  const probeIdx = up.indexOf('_probeUploadedBackupWithRetry_');
  const markerIdx = up.indexOf('setLastAutoBackupTime');
  assert.ok(probeIdx >= 0 && markerIdx > probeIdx,
    'uploadAutoBackupToServer: phải dò xác nhận file đã lên Drive chưa (probe) trước khi kết luận');
  assert.ok(!/_probeUploadedBackupByName_/.test(up),
    'uploadAutoBackupToServer: không gọi probe một-lần trực tiếp — "chưa có" ở lần dò đầu chưa phải kết luận');

  // REJECTED chỉ dành cho verdict phát TRƯỚC khi GAS tạo file. Catch tổng của
  // handleRequest_ ('Loi Server...') có thể phát SAU folder.createFile
  // (trimBackups_ ném lỗi) — coi nó là REJECTED sẽ bỏ probe và tạo bản trùng
  // ở lần kiểm tra kế tiếp.
  const rejectGateIdx = up.indexOf('_isPreWriteReject_');
  assert.ok(rejectGateIdx >= 0 && rejectGateIdx < probeIdx,
    'uploadAutoBackupToServer: nhánh REJECTED phải được chặn bằng danh sách message pre-write đã biết');
  const rejectList = src.match(/PRE_WRITE_REJECT_MESSAGES\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(rejectList, 'Thiếu danh sách PRE_WRITE_REJECT_MESSAGES');
  assert.ok(!/Loi Server/.test(rejectList[1]),
    'Message catch tổng của GAS có thể phát SAU khi file đã tạo — không được nằm trong danh sách REJECTED chắc chắn');

  // Write-ahead journal phải có TRƯỚC fetch: page có thể chết giữa request và
  // không bao giờ chạy catch/finally; ghi pending sau lỗi là quá muộn.
  assert.ok(/confirmed:\s*false/.test(up) && /filename:\s*filename/.test(up),
    'uploadAutoBackupToServer: phải ghi pending confirmed:false + filename');
  const pendingIdx = up.indexOf('writeLastUploadHash_');
  const fetchIdx = up.indexOf('fetch(');
  assert.ok(pendingIdx >= 0 && fetchIdx > pendingIdx,
    'uploadAutoBackupToServer: phải journal pending TRƯỚC khi request backup rời client');
  assert.ok(!/getEmployeeId\s*\(/.test(up),
    'uploadAutoBackupToServer: filename lưu trong localStorage không được chứa mã nhân viên (bí mật khôi phục master key)');
  const perf = fnBody(src, 'performAutoBackup');
  assert.ok(/last\.confirmed/.test(perf) && /_probeUploadedBackupWithRetry_/.test(perf),
    'performAutoBackup: pending chưa xác nhận phải dò lại filename, không nhích mốc 24h ngay');
  assert.ok(/if\s*\(\s*dedupeWindowMs\s*>\s*0\s*\)\s*return/.test(perf),
    'performAutoBackup: reconcile pending cùng hash chỉ được return ở đường auto; manual phải tiếp tục tạo bản mới');
  assert.ok(/AUTO_BACKUP_PENDING_SETTLE_MS/.test(src) && /isPendingUploadSettled_/.test(perf),
    'performAutoBackup: snapshot rỗng chỉ được xoá pending sau cửa sổ settle có giới hạn');
  assert.ok(/!pendingProbe\.answered\s*\|\|\s*!isPendingUploadSettled_\(last\)/.test(perf),
    'performAutoBackup: mất mạng hoặc snapshot rỗng trước deadline phải giữ pending');

  const probe = fnBody(src, '_probeUploadedBackupByName_');
  assert.ok(/list_backups/.test(probe) && /\.filename\s*===\s*filename/.test(probe),
    '_probeUploadedBackupByName_: phải hỏi list_backups và khớp ĐÚNG tên file vừa gửi (tên duy nhất mỗi lần thử)');

  // list_backups KHÔNG giữ script lock GAS (WRITE_ACTIONS_USER_) nên có thể trả
  // "chưa có" trong khi handleCreateBackup_ của execution gốc còn đang chạy —
  // probe phải thử lại theo lịch trễ; lần dò cuối vẫn chỉ là snapshot và caller
  // phải giữ pending cho tới deadline settle.
  const retry = fnBody(src, '_probeUploadedBackupWithRetry_');
  assert.ok(/_probeUploadedBackupByName_/.test(retry) && /UPLOAD_PROBE_RETRY_DELAYS_MS/.test(retry),
    '_probeUploadedBackupWithRetry_: phải lặp qua lịch trễ và gọi probe một-lần bên trong');
  assert.ok(/last\.answered\s*&&\s*last\.result/.test(retry),
    '_probeUploadedBackupWithRetry_: thấy file thì trả thành công ngay; vắng mặt trả về caller để áp deadline settle');

  // Tên file gửi đi phải qua cùng luật sanitize với handleCreateBackup_ (GAS):
  // mã NV có thể chứa '/' '\' — nếu không chuẩn hoá trước khi gửi, probe khớp
  // đúng-tên sẽ không thấy file GAS đã lưu dưới tên đã sanitize.
  assert.ok(/_sanitizeBackupFilename_/.test(up),
    'uploadAutoBackupToServer: phải chuẩn hoá tên file trước khi gửi và trước khi probe');
  const sanitize = fnBody(src, '_sanitizeBackupFilename_');
  assert.ok(/replace\s*\(/.test(sanitize) && /'_'/.test(sanitize) && /\.cpb/.test(sanitize),
    '_sanitizeBackupFilename_: phải thay ký tự đường dẫn/điều khiển và ép đuôi .cpb giống GAS');
  // Cùng character-class với gas/UserDriveAPI.gs handleCreateBackup_ — lệch luật
  // là nguồn probe miss và sinh bản trùng.
  const gas = read('gas/UserDriveAPI.gs');
  const classRe = /\[\\\/\\\\\\r\\n\\t\\x00-\\x1F\]/;
  assert.ok(classRe.test(sanitize) && classRe.test(gas),
    '_sanitizeBackupFilename_ phải dùng đúng character-class của handleCreateBackup_ ([\\/\\\\\\r\\n\\t\\x00-\\x1F])');
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

  // Các vòng sau chạy qua setTimeout => NGOÀI try/catch của img.onload. toDataURL
  // ném lỗi ở đó mà không ai gọi cb thì Promise của saveImageToDB treo vĩnh viễn.
  assert.ok(/try\s*\{[\s\S]{0,200}toDataURL/.test(body),
    'adjustAndCheck: toDataURL phải nằm trong try/catch riêng, không dựa vào try/catch của img.onload');
  assert.ok(/catch[\s\S]{0,220}cb\(base64\)/.test(body),
    'adjustAndCheck: nhánh catch phải gọi cb(base64) để không treo loader');
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

  // Pool vẫn rút tiếp hàng đợi sau khi một job thoát: không chốt ở ĐẦU mỗi job thì
  // lượt render đã bị thay thế vẫn giải mã hết số khách hàng còn lại.
  assert.ok(/_mapJobPool\([^)]*async \(cust\) => \{\s*(?:\/\/[^\n]*\n\s*)*if \(!alive\(\)\) return;/.test(body),
    'renderMapMarkers: mỗi job phải bỏ ngay ở đầu khi lượt render không còn hiệu lực');
});

test('ĐVHC: refreshIcons phải scope lucide.createIcons theo root màn hình', () => {
  const src = read('assets/dvhc-lookup/dvhc_ui.js');
  const body = fnBody(src, 'refreshIcons');
  assert.ok(/createIcons\(\s*\{\s*root/.test(body),
    'refreshIcons: createIcons phải nhận { root }');
  assert.ok(/screen-dvhc-lookup/.test(body),
    'refreshIcons: cần fallback root #screen-dvhc-lookup khi screenEl chưa dựng');
});

test('boot: lucide.createIcons lúc bootstrap phải scope theo root (không quét cả document)', () => {
  const boot = read('assets/10_bootstrap.js');
  assert.ok(/createIcons\(\s*\{\s*root/.test(boot),
    '10_bootstrap.js: createIcons phải nhận { root } cho gate/dashboard');
  assert.ok(!/window\.lucide\.createIcons\(\s*\)/.test(boot.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')),
    '10_bootstrap.js: không còn createIcons() không scope trên đường boot chính');
});

test('IndexedDB: chỉ xin persistent storage sau unlock và sau khi persisted() trả false', () => {
  const boot = read('assets/10_bootstrap.js');
  const body = fnBody(boot, 'requestPersistentStorage');
  const persistedAt = body.indexOf('storage.persisted()');
  const persistAt = body.indexOf('storage.persist()');
  assert.ok(persistedAt !== -1 && persistAt > persistedAt,
    'Phải await persisted() trước khi gọi persist()');
  assert.ok(/if\s*\(await storage\.persisted\(\)\)\s*return/.test(body),
    'Đã persistent thì phải thoát, không xin lại');

  const listenerStart = boot.indexOf('document.addEventListener("clientpro:unlocked"');
  const bootStart = boot.indexOf('document.addEventListener("DOMContentLoaded"');
  assert.ok(listenerStart !== -1 && listenerStart < bootStart,
    'Phải đăng ký request persistent storage trên clientpro:unlocked');
  const listener = boot.slice(listenerStart, bootStart);
  assert.ok(/requestPersistentStorage\(\)/.test(listener) && /once:\s*true/.test(listener),
    'Listener unlock phải gọi helper đúng một lần mỗi page load');
  assert.ok(!/requestPersistentStorage\(\)/.test(boot.slice(bootStart)),
    'Không được gọi request persistent storage trực tiếp trong boot');
});

test('data-action dispatch bắt cả rejection của handler async', () => {
  const globals = read('assets/00_globals.js');
  const body = fnBody(globals, 'dispatch');
  assert.ok(/const result\s*=\s*handler\(target, ev\)/.test(body),
    'dispatch phải giữ kết quả handler để nhận diện thenable');
  assert.ok(/typeof result\.then\s*===\s*['"]function['"]/.test(body)
    && /Promise\.resolve\(result\)\.catch/.test(body),
  'dispatch phải gắn catch cho rejection bất đồng bộ');
  const report = fnBody(globals, 'reportDispatchError');
  assert.ok(/ErrorHandler\.logError/.test(report) && /ErrorHandler\.showError\(['"]UNKNOWN['"]/.test(report),
    'Lỗi async phải đi qua đúng ErrorHandler như lỗi đồng bộ');
});

test('modals: critical security gates load trước; business modals không chặn boot', () => {
  const load = read('assets/ui/load_modals.js');
  assert.ok(/ModalLoader/.test(load), 'load_modals.js phải expose ModalLoader');
  assert.ok(/CRITICAL/.test(load) && /DEFERRED/.test(load), 'phải tách CRITICAL vs DEFERRED');
  assert.ok(/activation-modal/.test(load) && /camera-modal/.test(load));
  const boot = read('assets/10_bootstrap.js');
  assert.ok(/criticalReady|__clientpro_modals_ready/.test(boot),
    'bootstrap chỉ chờ criticalReady / __clientpro_modals_ready');
  assert.ok(!/__clientpro_modals_all_ready/.test(boot),
    'bootstrap không được chờ allReady (business modals)');
});

test('camera: compressionProfile document chỉ đổi nén — encrypt + transaction giữ fail-closed', () => {
  const src = read('assets/08_images_camera.js');
  const body = fnBody(src, 'saveImageToDB');
  assert.ok(/compressionProfile/.test(body), 'saveImageToDB phải đọc compressionProfile từ opts');
  assert.ok(
    /compressImage\(\s*enhancedBase64\s*,\s*async\s*\([^)]*\)\s*=>[\s\S]*?,\s*compressionProfile\s*\)/.test(body)
      || /compressImage\([^;]+compressionProfile\s*\)/.test(body),
    'compressImage phải nhận compressionProfile làm đối số thứ 3'
  );
  assert.ok(/encryptImageData\(compressed\)/.test(body), 'vẫn mã hóa compressed trước khi ghi');
  assert.ok(/_looksEncrypted\(storedData\)/.test(body), 'fail-closed ciphertext check giữ nguyên');
  assert.ok(/imgTx\.oncomplete/.test(body) && /imgTx\.onerror/.test(body) && /imgTx\.onabort/.test(body));
});

test('modals: ensure(id) chèn HTML trước khi resolve — không trả raw fetch của group', () => {
  const load = read('assets/ui/load_modals.js');
  assert.ok(/function fetchModal\(/.test(load), 'phải có fetchModal');
  // ensure phải gọi fetchModal (insert-then-resolve), không trả Promise.all group.
  const ensureBody = load.slice(load.indexOf('ensure: function'));
  assert.ok(/return fetchModal\(id\)/.test(ensureBody), 'ensure phải await fetchModal(id)');
  assert.ok(/Insert THIS modal immediately|insertHtml\(html\)/.test(load),
    'fetchModal phải insert ngay khi response về');
  // loadGroup không được gán inflight = raw fetch text-only.
  assert.ok(!/inflight\[id\]\s*=\s*fetch\(url\)\s*\n\s*\.then\(function \(res\)/.test(load)
    || /insertHtml/.test(load.slice(load.indexOf('function fetchModal'))),
    'inflight phải gắn với đường insert');
  // all_ready must NOT eagerly call loadDeferred via criticalPromise.then(loadDeferred).
  assert.ok(!/__clientpro_modals_all_ready\s*=\s*criticalPromise\.then/.test(load),
    '__clientpro_modals_all_ready không được criticalPromise.then(loadDeferred) — phá idle defer');
  assert.ok(/scheduleIdle\(function \(\) \{ loadDeferred\(\); \}\)/.test(load),
    'business modals chỉ warm qua idle callback');
});

test('modals: fragment deferred được khởi tạo Lucide theo đúng modal vừa chèn', () => {
  const load = read('assets/ui/load_modals.js');
  const fetchBody = fnBody(load, 'fetchModal');
  const iconBody = fnBody(load, 'initDeferredModalIcons');

  assert.ok(/DEFERRED\.indexOf\(id\)\s*<\s*0/.test(iconBody),
    'không quét lại critical gates trên cold-start');
  assert.ok(/window\.lucide\.createIcons\(\s*\{\s*root:\s*modal\s*\}\s*\)/.test(iconBody),
    'modal deferred phải được scan icon theo chính subtree vừa chèn');
  assert.ok(!/window\.lucide\.createIcons\(\s*\)/.test(iconBody),
    'không được gọi Lucide không scope');
  const insertIdx = fetchBody.indexOf('insertHtml(html)');
  const iconIdx = fetchBody.indexOf('initDeferredModalIcons(id, modal)');
  assert.ok(insertIdx >= 0 && iconIdx > insertIdx,
    'khởi tạo icon phải chạy sau khi fragment đã được chèn vào DOM');
});

test('modals: fetch + SW precache cùng ?v=ASSET_V (không stale camera-modal khi upgrade SW)', () => {
  const load = read('assets/ui/load_modals.js');
  assert.ok(/function versionedUrl\(/.test(load) && /versionedUrl\(path\)/.test(fnBody(load, 'fetchModal')),
    'fetchModal phải request fragment qua versionedUrl');
  assert.ok(/LAZY_MODULES_V|ASSET_V/.test(fnBody(load, 'assetVersion')),
    'version lấy từ LAZY_MODULES_V/ASSET_V');

  const sw = read('sw.js');
  const assetV = (sw.match(/ASSET_V\s*=\s*'([^']+)'/) || [])[1];
  assert.ok(assetV, 'phải đọc được ASSET_V');
  for (const id of [
    'camera-modal', 'add-modal', 'asset-modal', 'screen-lock', 'backup-manager-modal',
  ]) {
    assert.ok(sw.includes(`./assets/ui/modals/${id}.html?v=\${ASSET_V}`)
      || sw.includes(`./assets/ui/modals/${id}.html?v=${assetV}`),
      `precache phải version ${id}.html để khớp fetch`);
  }
  assert.ok(!/^\s*'\.\/assets\/ui\/modals\/camera-modal\.html',?\s*$/m.test(sw),
    'không còn precache camera-modal không version');
});

test('khách hàng trống: openModal tự ensure add-modal trước mọi DOM access', () => {
  const cust = read('assets/05_customers.js');
  const body = fnBody(cust, 'openModal');
  const firstLookup = body.indexOf("getEl('add-modal')");
  const ensureIdx = body.indexOf("ModalLoader.ensure('add-modal')");
  const secondLookup = body.indexOf("getEl('add-modal')", firstLookup + 1);
  const openIdx = body.indexOf("modal.classList.remove('hidden')");

  assert.ok(firstLookup >= 0 && ensureIdx > firstLookup,
    'openModal phải kiểm tra fragment trước khi gọi loader');
  assert.ok(secondLookup > ensureIdx,
    'openModal phải lấy lại fragment sau khi await loader');
  assert.ok(openIdx > secondLookup,
    'không được dereference modal trước khi ensure hoàn tất');
  assert.ok(/if\s*\(\s*!modal\s*\)\s*return/.test(body),
    'fetch lỗi phải fail closed thay vì dereference null');
});

test('camera open: hủy sau lazy-load nếu khóa/ẩn; photo-mode revalidate sau await', () => {
  const ui = read('assets/04_ui_common.js');
  assert.ok(/__cameraOpenAttemptSeq/.test(ui) && /__cameraOpenStillAllowed/.test(ui),
    'tryOpenCamera phải có token hủy sau await lazy-load');
  const tryBody = fnBody(ui, 'tryOpenCamera');
  assert.ok(/__cameraOpenStillAllowed\(attempt\)/.test(tryBody),
    'sau ensureDocumentScanner phải chặn mở nếu attempt hết hiệu lực');
  assert.ok(/visibilitychange/.test(ui)
    && /clientpro:security-gate-shown/.test(ui)
    && /MutationObserver/.test(fnBody(ui, '__bindCameraSecurityGateObserver')),
  'ẩn trang và security gate thật phải invalidate pending camera open');

  const scan = read('assets/document-scanner/document-scanner.js');
  const photo = fnBody(scan, 'capturePhotoMode');
  assert.ok(/captureSeq/.test(photo) && /isAppUnlocked/.test(photo),
    'capturePhotoMode phải re-check session/unlock sau takeHighResBitmap');
  assert.ok(/Math\.max\(\s*cw\s*\/\s*w\s*,\s*ch\s*\/\s*h\s*\)/.test(fnBody(scan, 'drawOverlay')),
    'drawOverlay phải map theo object-cover (max scale), không sx/sy độc lập');
});

test('document-scanner: review layout sau khi unhide; still-fail bỏ preview corners; session gate', () => {
  const scan = read('assets/document-scanner/document-scanner.js');
  const openReview = fnBody(scan, 'openReview');
  const ensureReview = fnBody(scan, 'ensureReviewDom');
  const unhideIdx = openReview.search(/classList\.remove\(\s*['"]hidden['"]\s*\)/);
  const layoutIdx = openReview.search(/layoutReviewHandles\s*\(/);
  assert.ok(unhideIdx >= 0 && layoutIdx >= 0 && unhideIdx < layoutIdx,
    'openReview phải bỏ hidden TRƯỚC layoutReviewHandles');
  assert.ok(/className\s*=\s*['"]fixed inset-0 hidden['"]/.test(ensureReview),
    'review động phải theo overlay contract .fixed.inset-0 của ModalA11y');
  assert.ok(/data-action['"]\s*,\s*['"]closeCamera['"]/.test(ensureReview),
    'nút Đóng phải dùng close action để Escape đi qua cleanup scanner đầy đủ');
  assert.ok(/ModalA11y\.observeAll\(\)/.test(ensureReview),
    'review tạo sau bootstrap phải đăng ký lại với ModalA11y');

  const capture = fnBody(scan, 'captureDocument');
  assert.ok(/stillCorners/.test(capture), 'captureDocument phải redetect trên ảnh tĩnh');
  assert.ok(/captureSeq\s*!==\s*state\.seq/.test(capture), 'phải chặn session cũ sau await');
  assert.ok(/isAppUnlocked/.test(capture), 'phải re-check unlocked trước openReview');
  // Preview corners không được giữ khi still fail — chỉ stillCorners hoặc inset thủ công.
  assert.ok(!/corners\s*=\s*Geom\.scaleCorners\(\s*state\.lastCorners/.test(capture),
    'không scale preview corners làm crop khi còn đường still-detect');

  const cleanup = fnBody(scan, 'cleanupAll');
  assert.ok(/state\.seq\s*=/.test(cleanup), 'cleanupAll phải bump seq để hủy capture đang bay');

  // openSession chờ ensureLibs/ModalLoader; cleanupAll giữa chừng bump state.seq. Phải
  // phát hiện điều đó TRƯỚC khi khôi phục state/getUserMedia, nếu không camera mở sau màn khóa.
  const openSess = fnBody(scan, 'openSession');
  assert.ok(/seqAtEntry\s*=\s*state\.seq/.test(openSess),
    'openSession phải chụp seq baseline trước các await');
  const seqGuardIdx = openSess.search(/state\.seq\s*!==\s*seqAtEntry/);
  const gumIdx = openSess.search(/getUserMedia\s*\(/);
  assert.ok(seqGuardIdx >= 0 && gumIdx >= 0 && seqGuardIdx < gumIdx,
    'openSession phải re-check seq (phát hiện cleanupAll) TRƯỚC getUserMedia');
  assert.ok(/isAppUnlocked/.test(openSess.slice(0, gumIdx)),
    'openSession phải re-check unlocked trước getUserMedia');
  // Token phiên phải đơn điệu từ một nguồn (nextSessionToken), KHÔNG gán seq ngoài
  // (vd __cameraOpenSeq của caller) — nếu không token có thể trùng phiên đã bỏ.
  assert.ok(/nextSessionToken\(\)/.test(openSess) && /state\.seq\s*=\s*mySeq\b/.test(openSess),
    'openSession phải mint token từ nextSessionToken(), không gán counter ngoài');
  assert.ok(!/state\.seq\s*=\s*seq\b/.test(openSess),
    'openSession không được gán state.seq từ tham số seq bên ngoài');
  assert.ok(/state\.seq\s*=\s*nextSessionToken\(\)/.test(cleanup),
    'cleanupAll phải bump seq qua nextSessionToken() (cùng nguồn đơn điệu)');

  assert.ok(/sharpOk/.test(scan) && /HINTS\.blurry/.test(scan),
    'frame mờ phải gắn sharpOk=false và chặn auto-capture');
  assert.ok(/abandonCapture|captureSeq === state\.seq\)\s*state\.busy\s*=\s*false/.test(capture),
    'early-abort sau await phải nhả busy nếu vẫn là chủ session');
});

test('document-scanner: không gửi frame lên mạng; cleanup khi khóa/ẩn trang', () => {
  const scan = read('assets/document-scanner/document-scanner.js');
  assert.ok(!/fetch\s*\(/.test(scan.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')),
    'document-scanner.js không được fetch mạng');
  assert.ok(/terminate\(/.test(scan), 'phải terminate worker khi cleanup');
  assert.ok(/pagehide/.test(scan) && /visibilitychange/.test(scan)
    && /clientpro:security-gate-shown/.test(scan),
  'cleanup khi ẩn trang / security gate thật được hiện');
  assert.ok(/Worker\(/.test(scan), 'detector chạy bằng Worker');
});

test('document-scanner: preview detect single-flight và cleanup xóa plaintext review', () => {
  const scan = read('assets/document-scanner/document-scanner.js');
  const request = fnBody(scan, 'requestDetect');
  const inFlightGuard = request.indexOf('state.previewDetectInFlight');
  const sample = request.indexOf('samplePreviewFrame()');
  const arm = request.indexOf('state.previewDetectInFlight = true');
  const post = request.indexOf('worker.postMessage');
  assert.ok(inFlightGuard >= 0 && sample > inFlightGuard,
    'phải chặn trước khi sample frame mới nếu Worker còn một preview đang chạy');
  assert.ok(arm >= 0 && post > arm,
    'phải arm single-flight gate trước khi postMessage');

  const receive = fnBody(scan, 'onWorkerMessage');
  assert.ok(/msg\.id\s*===\s*state\.previewDetectId/.test(receive)
    && /state\.previewDetectInFlight\s*=\s*false/.test(receive),
  'chỉ response đúng request mới được nhả preview gate');
  const cleanup = fnBody(scan, 'cleanupAll');
  assert.ok(/state\.previewDetectInFlight\s*=\s*false/.test(cleanup),
    'cleanup session phải nhả preview gate');

  const close = fnBody(scan, 'closeReview');
  assert.ok(/imageData\.data\.fill\(0\)/.test(close),
    'closeReview phải zero JS plaintext image buffer');
  assert.ok(/canvas\.width\s*=\s*0/.test(close) && /canvas\.height\s*=\s*0/.test(close),
    'closeReview phải giải phóng canvas backing store');
  assert.ok(/while\s*\(handles\.firstChild\)\s*handles\.removeChild/.test(close),
    'closeReview phải gỡ corner handles');
});

test('document-scanner: still capture giới hạn bộ nhớ — cap 2400px, không nhân đôi buffer full-res', () => {
  const scan = read('assets/document-scanner/document-scanner.js');
  const toId = fnBody(scan, 'bitmapToImageData');
  assert.ok(/STILL_MAX_LONG_SIDE\s*=\s*2400/.test(toId),
    'bitmapToImageData phải cap long side 2400 (khớp compress/warp document)');
  assert.ok(/drawImage\(\s*bitmap\s*,\s*0\s*,\s*0\s*,\s*w\s*,\s*h\s*\)/.test(toId),
    'phải scale trực tiếp từ bitmap, không giữ full-res rồi mới crop');

  const redetect = fnBody(scan, 'redetectOnStill');
  assert.ok(/sourceCanvas/.test(redetect) && /drawImage\(\s*sourceCanvas/.test(redetect),
    'redetectOnStill phải downscale từ canvas sẵn có, không dựng temp full-res mặc định');

  const open = fnBody(scan, 'openReview');
  assert.ok(/var\s+owned\s*=/.test(open) && /data:\s*owned/.test(open),
    'openReview phải giữ một buffer RGBA owned — không clone lần 2 vào state.review');
  assert.ok(!/new Uint8ClampedArray\(\s*imageData\.data\s*\)[\s\S]*new Uint8ClampedArray\(\s*imageData\.data\s*\)/.test(open),
    'openReview không được clone imageData.data hai lần');

  const capture = fnBody(scan, 'captureDocument');
  assert.ok(/redetectOnStill\(\s*pack\.imageData\s*,\s*pack\.canvas\s*\)/.test(capture),
    'captureDocument phải truyền pack.canvas vào redetectOnStill');
});

test('camera/scanner: lifecycle khóa dựa trên security gate + clientpro:locked', () => {
  const ui = read('assets/04_ui_common.js');
  const bind = fnBody(ui, '__bindCameraSecurityGateObserver');
  for (const id of [
    'screen-lock',
    'activation-modal',
    'setup-lock-modal',
    'forgot-pin-modal',
    'biometric-setup-modal',
  ]) {
    assert.ok(ui.includes(`'${id}'`), `camera gate observer thiếu #${id}`);
  }
  assert.ok(/new CustomEvent\('clientpro:security-gate-shown'/.test(bind),
    'gate observer phải phát lifecycle event thật');
  assert.ok(/addEventListener\(\s*['"]clientpro:locked['"]/.test(ui),
    'pending camera-open cũng lắng nghe clientpro:locked (clearMasterKeyMaterial phát khi có session)');
  const scan = read('assets/document-scanner/document-scanner.js');
  assert.ok(/addEventListener\(\s*['"]clientpro:security-gate-shown['"][\s\S]{0,100}cleanupAll/.test(scan),
    'scanner phải cleanup khi lifecycle security gate được phát');
  assert.ok(/addEventListener\(\s*['"]clientpro:locked['"][\s\S]{0,100}cleanupAll/.test(scan),
    'scanner cũng cleanup trên clientpro:locked (trước khi gate paint)');
});

test('document-scanner: overlay map qua object-cover; photo-mode re-check session sau await', () => {
  const scan = read('assets/document-scanner/document-scanner.js');
  const draw = fnBody(scan, 'drawOverlay');
  assert.ok(/Math\.max\(\s*cw\s*\/\s*w\s*,\s*ch\s*\/\s*h\s*\)/.test(draw),
    'drawOverlay phải dùng object-cover scale max(cw/w, ch/h), không kéo giãn x/y riêng');
  assert.ok(!/var\s+sx\s*=\s*cw\s*\/\s*w\s*,\s*sy\s*=\s*ch\s*\/\s*h/.test(draw),
    'drawOverlay không được nhân độc lập cw/w và ch/h');

  const photo = fnBody(scan, 'capturePhotoMode');
  assert.ok(/captureSeq\s*=\s*state\.seq/.test(photo),
    'capturePhotoMode phải chụp captureSeq trước await');
  assert.ok(/captureSeq\s*!==\s*state\.seq/.test(photo),
    'capturePhotoMode phải re-check session sau await bitmap trước khi dựng frame/lưu');
  assert.ok(/isAppUnlocked/.test(photo),
    'capturePhotoMode phải re-check unlocked sau await');
});

test('lock lifecycle: clearMasterKeyMaterial phát clientpro:locked khi vừa có session', () => {
  const sec = read('assets/02_security.js');
  const body = fnBody(sec, 'clearMasterKeyMaterial');
  assert.ok(/hadSession/.test(body) && /clientpro:locked/.test(body),
    'clearMasterKeyMaterial phải dispatch clientpro:locked khi vừa xóa session thật');
});

test('camera: tryOpenCamera hủy nếu app khóa/ẩn trong lúc lazy-load scanner', () => {
  const ui = read('assets/04_ui_common.js');
  const body = fnBody(ui, 'tryOpenCamera');
  assert.ok(/__cameraOpenAttemptSeq/.test(body) || /\+\+__cameraOpenAttemptSeq/.test(body),
    'tryOpenCamera phải chụp attempt seq trước khi nạp scanner');
  assert.ok(/__cameraOpenStillAllowed\(attempt\)/.test(body),
    'sau lazy-load phải gọi __cameraOpenStillAllowed trước khi mở');
  const still = fnBody(ui, '__cameraOpenStillAllowed');
  assert.ok(/isAppUnlocked\(\)/.test(still) && /visibilityState\s*===\s*['"]hidden['"]/.test(still),
    '__cameraOpenStillAllowed phải kiểm tra khóa/ẩn');
  const openIdx = body.search(/_tryOpenCameraReal\(/);
  const guardIdx = body.search(/__cameraOpenStillAllowed\(attempt\)/);
  assert.ok(guardIdx >= 0 && openIdx >= 0 && guardIdx < openIdx,
    'phải chặn attempt cũ TRƯỚC khi gọi _tryOpenCameraReal');
});

test('modals: __clientpro_modals_all_ready lazy — không eager gọi loadDeferred lúc init', () => {
  const load = read('assets/ui/load_modals.js');
  // Không được có eager `criticalPromise.then(...loadDeferred...)` gán thẳng vào
  // window.__clientpro_modals_all_ready (ngoài getter) — nó sẽ nạp 8 modal nghiệp
  // vụ ngay khi critical settle, tranh chấp cold-start.
  assert.ok(/Object\.defineProperty\(\s*window\s*,\s*['"]__clientpro_modals_all_ready['"]/.test(load),
    '__clientpro_modals_all_ready phải là getter lazy (Object.defineProperty)');
  assert.ok(!/window\.__clientpro_modals_all_ready\s*=\s*criticalPromise\.then/.test(load),
    'không được gán eager criticalPromise.then(loadDeferred) vào window.__clientpro_modals_all_ready');
  // Idle warmer vẫn phải còn để hâm nóng ngoài đường cold-start.
  assert.ok(/scheduleIdle\(function\s*\(\)\s*\{\s*loadDeferred\(\);?\s*\}\)/.test(load),
    'phải giữ idle warmer gọi loadDeferred ngoài critical path');
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

test('saveSecuritySetup: commit security state sau guard, rollback cả envelope + identity', () => {
  const src = read('assets/02_security.js');
  const body = fnBody(src, 'saveSecuritySetup');
  const commitCall = '_commitSecuritySetupState(pinEnvelope, secEnvelope, employeeEnvelope)';
  const commitAt = body.indexOf(commitCall);
  assert.ok(commitAt !== -1, 'saveSecuritySetup phải commit envelope và identity qua một helper đồng bộ');
  const beforeCommit = body.slice(0, commitAt);
  const lastGuard = beforeCommit.lastIndexOf('setupKeyAlive()');
  assert.ok(lastGuard !== -1, 'Phải kiểm tra setupKeyAlive() trước commit security state');
  assert.ok(!/\bawait\s+[A-Za-z_(]/.test(beforeCommit.slice(lastGuard)),
    'Không được có await giữa setupKeyAlive() và _commitSecuritySetupState');

  const commitBranchEnd = body.indexOf('// Chỉ đổi identity RAM', commitAt);
  const commitBranch = body.slice(commitAt, commitBranchEnd);
  assert.ok(/catch\s*\(e\)/.test(commitBranch), 'Commit security state phải có nhánh catch');
  assert.ok(/_restoreEnvelopeSnapshot\(PIN_KEY, prevPin\)/.test(commitBranch)
    && /_restoreEnvelopeSnapshot\(SEC_KEY, prevSec\)/.test(commitBranch),
  'Lỗi commit phải rollback cả PIN_KEY và SEC_KEY về snapshot');
  assert.ok(/_restoreEnvelopeSnapshot\(EMPLOYEE_SEALED_KEY, prevEmployeeSealed\)/.test(commitBranch)
    && /_restoreEnvelopeSnapshot\(EMPLOYEE_KEY, prevEmployeePlain\)/.test(commitBranch)
    && /__employeeIdPlain\s*=\s*prevEmployeeRam/.test(commitBranch)
    && /__fieldPlainCache\.delete\(employeeEnvelope\)/.test(commitBranch),
  'Lỗi commit phải rollback sealed/plaintext/RAM identity và dọn prepared cache đi cùng SEC snapshot');
  assert.ok(/ErrorHandler\.showError\(['"]STORAGE['"]/.test(commitBranch),
    'Lỗi commit phải hiện thông báo STORAGE cho người dùng');
  assert.ok(/_releaseUnlockLoading\(myUnlockAttempt\)[\s\S]*return;/.test(commitBranch),
    'Lỗi commit phải nhả UI và dừng trước biometric/pipeline unlock');

  const verified = fnBody(src, '_setItemVerified');
  const setAt = verified.indexOf('localStorage.setItem(key, value)');
  const readAt = verified.indexOf('localStorage.getItem(key)');
  assert.ok(setAt !== -1 && readAt > setAt,
    '_setItemVerified phải đọc lại giá trị sau khi ghi');
  assert.ok(/ENVELOPE_WRITE_FAILED/.test(verified), 'Ghi/lệch read-back phải fail-closed');

  const pair = fnBody(src, '_commitEnvelopePair');
  const secAt = pair.indexOf('_setItemVerified(SEC_KEY, secEnvelope)');
  const pinAt = pair.indexOf('_setItemVerified(PIN_KEY, pinEnvelope)');
  const secVerifyAt = pair.lastIndexOf('localStorage.getItem(SEC_KEY)');
  assert.ok(secAt !== -1 && pinAt > secAt && secVerifyAt > pinAt,
    '_commitEnvelopePair phải ghi SEC trước PIN rồi verify lại SEC');

  const securityCommit = fnBody(src, '_commitSecuritySetupState');
  const employeeAt = securityCommit.indexOf('_setItemVerified(EMPLOYEE_SEALED_KEY, employeeEnvelope)');
  const pairAt = securityCommit.indexOf('_commitEnvelopePair(pinEnvelope, secEnvelope)');
  const removePlainAt = securityCommit.indexOf('_removeItemVerified(EMPLOYEE_KEY)');
  assert.ok(employeeAt !== -1 && pairAt > employeeAt && removePlainAt > pairAt,
    'Security commit phải verify sealed employee, commit SEC/PIN, rồi mới xóa plaintext');

  const employeeSeal = fnBody(src, '_sealEmployeeIdForCommit');
  assert.ok(!/localStorage\.(?:setItem|removeItem)/.test(employeeSeal),
    'Bước seal employee trước guard chỉ được dựng trong RAM, không mutation storage');
  const employeeWrite = fnBody(src, '_writeSealedEmployeeId');
  const employeeSealAt = employeeWrite.indexOf('await _sealEmployeeIdForCommit(emp)');
  const employeeGuardAt = employeeWrite.indexOf('if (!writeKeyAlive())', employeeSealAt);
  const employeeWriteAt = employeeWrite.indexOf('_setItemVerified(EMPLOYEE_SEALED_KEY, sealed)');
  assert.ok(/writeGeneration\s*=\s*__keyGeneration/.test(employeeWrite)
    && /writeCryptoKey\s*=\s*masterCryptoKey/.test(employeeWrite),
  '_writeSealedEmployeeId phải chụp generation + CryptoKey trước await');
  assert.ok(employeeSealAt !== -1 && employeeGuardAt > employeeSealAt && employeeWriteAt > employeeGuardAt,
    '_writeSealedEmployeeId phải kiểm lại generation/key sau verify, ngay trước lệnh ghi');
  const employeeRamAt = body.indexOf('__employeeIdPlain = ans');
  assert.ok(employeeRamAt > commitAt,
    'Chỉ được đổi employee identity trong RAM sau khi commit storage thành công');

  const storageMessage = fnBody(src, '_securitySetupStorageMessage');
  assert.ok(/_isQuotaExceededStorageError/.test(storageMessage) && /quyền lưu trữ|riêng tư/.test(storageMessage),
    'Thông báo storage phải phân biệt quota với lỗi quyền/read-back khác');

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
  const envelopeCommitAt = body.indexOf('_commitSecuritySetupState(pinEnvelope, secEnvelope, employeeEnvelope)');
  assert.ok(envelopeCommitAt !== -1 && bioAt > envelopeCommitAt,
    'onPinChanged phải nằm SAU lệnh ghi envelope');
  assert.ok(bioAt < guardAt,
    'onPinChanged phải nằm TRƯỚC chốt vé — nó gắn với lệnh ghi đĩa, không gắn với UI');
});

test('PDF runTask: finally không được hạ trạng thái dùng chung khi phiên đã bị thay', () => {
  const src = read('assets/pdf-toolkit/pdf_toolkit_ui.js');
  // runTask là async method trong object literal (makeToolContext) — fnBody không bắt được.
  const m = src.match(/async\s+runTask\s*\(/);
  assert.ok(m, 'Không tìm thấy runTask trong pdf_toolkit_ui.js');
  const i = src.indexOf('{', m.index);
  let depth = 0;
  let end = -1;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  assert.ok(end > i, 'Không cắt được thân runTask');
  const body = src.slice(i, end + 1);
  const fin = body.slice(body.lastIndexOf('finally'));
  // session.busy là state RIÊNG của phiên cũ — nhả vô điều kiện là đúng.
  assert.ok(/session\.busy\s*=\s*false/.test(fin), 'finally phải nhả busy của phiên');
  // aria-busy / data-task-state / progress sheet là DOM DÙNG CHUNG giữa các phiên:
  // tác vụ cũ về muộn (sau khi người dùng đã mở tool/tác vụ mới) mà hạ chúng là
  // báo idle + aria-busy=false giữa chừng tác vụ mới — tín hiệu UI/a11y/E2E sai.
  const guardAt = fin.indexOf('session.isActive()');
  assert.ok(guardAt !== -1, 'finally phải kiểm session.isActive() trước khi chạm DOM dùng chung');
  const setAt = fin.indexOf('setTaskState(false)');
  const doneAt = fin.indexOf('progress.done()');
  assert.ok(setAt > guardAt && doneAt > guardAt,
    'setTaskState(false) và progress.done() phải nằm SAU guard session.isActive()');
});

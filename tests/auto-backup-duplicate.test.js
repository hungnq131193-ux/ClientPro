'use strict';

// ============================================================================
// auto-backup-duplicate.test.js — Auto backup lên Drive KHÔNG được tạo hai bản
// cho cùng một lượt.
//
// Bốn đường sinh trùng đã sửa trong assets/16_auto_backup_drive.js:
//   1. Mốc throttle 24h (CLIENTPRO_LAST_AUTO_BACKUP) chỉ được ghi SAU khi dọn
//      retention; retention gọi mạng nên chỉ cần nó lỗi là cả lượt ném lỗi, mốc
//      không nhích, và lần kiểm tra kế tiếp tạo tiếp bản thứ hai.
//   2. Cờ chống chạy chồng là biến RAM -> chết theo lần tải trang: reload/PWA bị
//      thu hồi giữa lúc tải lên, hoặc app mở ở hai ngữ cảnh, đều chạy lại từ đầu.
//   3. Không có dấu vân tay nội dung: lượt chạy lại với payload y hệt vẫn tạo file
//      mới (backup trong máy đã có anti-spam theo hash từ trước).
//   4. Upload "không rõ kết quả" (GAS tạo file TRƯỚC khi response về tới máy,
//      rồi mạng làm mất response / trả HTML) bị coi là thất bại: mốc 24h + hash
//      không được ghi, mỗi lần unlock/visibilitychange lại tải lên một file nữa
//      — đây là nguồn gốc thực tế của "1 lúc 3 file". Giờ phán quyết
//      OK/REJECTED/UNCONFIRMED + dò xác nhận bằng list_backups theo đúng tên file.
//      Probe phải THỬ LẠI theo lịch trễ: list_backups không giữ script lock GAS
//      nên lần dò đầu có thể thấy "chưa có" trong khi execution gốc còn đang
//      tạo file. Kể cả lần dò cuối chỉ là snapshot: client phải journal pending
//      TRƯỚC fetch và chỉ coi vắng mặt là terminal sau cửa sổ settle 10 phút.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAutoBackup, makeLockManager, makeLocalStorage, makeGasResponse } = require('./helpers/load-auto-backup');

const DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_SETTLE_MS = 10 * 60 * 1000;

/** Đếm số lần thực sự tạo file backup trong một mảng request dùng chung. */
function countBackups(requests) {
  return requests.filter((r) => r.action === 'backup').length;
}

test('auto backup: một lượt chạy chỉ tạo đúng một file trên Drive', async () => {
  const h = loadAutoBackup();

  await h.DriveBackup.checkDaily();

  assert.equal(h.backupCallCount(), 1, 'Lần đầu phải tạo đúng 1 bản sao lưu');
  assert.ok(
    h.localStorage.getItem('CLIENTPRO_LAST_AUTO_BACKUP'),
    'Phải ghi mốc throttle 24h sau khi tải lên thành công'
  );
});

test('auto backup: throttle 24h chặn lượt kiểm tra kế tiếp (unlock + visibilitychange)', async () => {
  const h = loadAutoBackup();

  await h.DriveBackup.checkDaily();
  // Các nguồn kích hoạt khác trong cùng phiên: sự kiện unlock và app quay lại
  // foreground đều gọi checkDaily().
  await h.document._emit('clientpro:unlocked');
  h.advance(30 * 1000);
  await h.document._emit('visibilitychange');
  await h.DriveBackup.checkDaily();

  assert.equal(h.backupCallCount(), 1, 'Trong 24h chỉ được tồn tại đúng 1 lần tạo file');
});

test('auto backup: retention lỗi KHÔNG làm mốc 24h bị bỏ trống (nguồn sinh bản thứ hai)', async () => {
  const h = loadAutoBackup();

  // GAS tạo file OK nhưng list_backups (bước dọn retention) lỗi mạng.
  h.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    h.requests.push(body);
    if (body.action === 'backup') {
      return makeGasResponse({
        status: 'success',
        fileId: 'file_x',
        filename: body.filename,
        createdAt: new Date().toISOString(),
      });
    }
    throw new Error('network down');
  });

  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 1, 'File vẫn phải được tạo dù retention lỗi');
  assert.ok(
    h.localStorage.getItem('CLIENTPRO_LAST_AUTO_BACKUP'),
    'Mốc 24h phải được ghi ngay khi Drive nhận file, không đợi retention'
  );

  // App quay lại foreground vài giây sau: trước khi sửa, đây chính là lúc bản
  // thứ hai được tạo.
  h.advance(5 * 1000);
  await h.document._emit('visibilitychange');
  assert.equal(h.backupCallCount(), 1, 'Không được tạo bản thứ hai sau khi retention lỗi');
});

test('auto backup: khóa bền sống sót qua reload (ngữ cảnh mới không tạo bản trùng)', async () => {
  const h = loadAutoBackup();

  // Giả lập một lượt bị giết giữa chừng: khóa còn trong localStorage, mốc 24h
  // chưa kịp ghi (tab bị đóng băng ngay trước khi tải lên xong).
  h.localStorage.setItem('CLIENTPRO_AUTO_BACKUP_CLAIM', String(h.now()));

  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 0, 'Khóa bền phải chặn lượt chạy chồng sau reload');

  // Khóa tự hết hạn (5 phút) để không kẹt vĩnh viễn nếu lượt trước chết thật.
  h.advance(6 * 60 * 1000);
  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 1, 'Sau khi khóa hết hạn phải sao lưu lại được');
  assert.equal(
    h.localStorage.getItem('CLIENTPRO_AUTO_BACKUP_CLAIM'),
    null,
    'Khóa phải được nhả sau khi lượt chạy kết thúc'
  );
});

test('auto backup: phải ghi pending TRƯỚC khi gửi để PWA bị thu hồi giữa request vẫn không tạo bản thứ hai', async () => {
  const sharedStorage = makeLocalStorage();
  const requests = [];
  const first = loadAutoBackup({ localStorage: sharedStorage, requests });

  let markUploadStarted;
  const uploadStarted = new Promise((resolve) => { markUploadStarted = resolve; });
  first.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    requests.push(body);
    if (body.action === 'backup') {
      markUploadStarted();
      // Request đã rời client nhưng ngữ cảnh bị thu hồi trước khi nhận response:
      // promise cố ý không settle để mô phỏng page chết giữa fetch.
      return await new Promise(() => {});
    }
    return makeGasResponse({ status: 'success', backups: [] });
  });

  void first.DriveBackup.checkDaily();
  await uploadStarted;

  const pending = JSON.parse(sharedStorage.getItem('CLIENTPRO_LAST_DRIVE_BACKUP_HASH') || 'null');
  assert.ok(
    pending && pending.confirmed === false && pending.filename,
    'Tên file + hash phải được journal bền trước fetch, không chờ fetch/probe thất bại'
  );

  // Ngữ cảnh mới mở sau khi claim 5 phút đã hết, nhưng vẫn còn trong cửa sổ
  // server có thể xử lý request cũ. list_backups tạm thời chưa thấy file:
  // tuyệt đối không được gửi request backup thứ hai.
  const second = loadAutoBackup({
    localStorage: sharedStorage,
    requests,
    now: first.now() + 6 * 60 * 1000,
  });
  second.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    requests.push(body);
    if (body.action === 'backup') {
      return makeGasResponse({
        status: 'success',
        fileId: 'duplicate',
        filename: body.filename,
        createdAt: new Date().toISOString(),
      });
    }
    if (body.action === 'list_backups') {
      return makeGasResponse({ status: 'success', backups: [] });
    }
    return makeGasResponse({ status: 'success' });
  });

  await second.DriveBackup.checkDaily();
  assert.equal(
    countBackups(requests),
    1,
    'Reload sau khi request cũ rời client phải giữ pending và không tải tên mới'
  );
});

test('auto backup: pending journal không được chứa mã nhân viên dùng khôi phục master key', async () => {
  const h = loadAutoBackup();
  const employeeSecret = 'MASTER-RECOVERY-SECRET-42';
  h.ctx.getEmployeeId = () => employeeSecret;
  h.ctx.getDeviceIdSafe = () => 'DEVICE/LEGACY\\1';

  h.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    h.requests.push(body);
    if (body.action === 'backup') throw new Error('network dropped');
    if (body.action === 'list_backups') throw new Error('still offline');
    return makeGasResponse({ status: 'success' });
  });

  await h.DriveBackup.checkDaily();

  const sent = h.requests.find((r) => r.action === 'backup');
  const pendingRaw = h.localStorage.getItem('CLIENTPRO_LAST_DRIVE_BACKUP_HASH') || '';
  const pending = JSON.parse(pendingRaw || 'null');
  assert.ok(sent && pending && pending.confirmed === false);
  assert.equal(pending.filename, sent.filename, 'Journal phải giữ đúng opaque filename đã gửi');
  assert.ok(!sent.filename.includes(employeeSecret), 'Request filename không được lộ mã nhân viên');
  assert.ok(!pendingRaw.includes(employeeSecret), 'localStorage journal không được lộ mã nhân viên');
  assert.ok(sent.filename.includes('DEVICE_LEGACY_1'), 'Vẫn giữ device id đã sanitize để phân biệt nguồn backup');
});

test('auto backup: mất mốc 24h vẫn không tạo bản trùng nhờ dấu vân tay nội dung', async () => {
  const h = loadAutoBackup();

  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 1);

  // Lớp phòng thủ cuối: giả sử mốc 24h mất (localStorage bị dọn một phần, hoặc một
  // lượt cũ nào đó không kịp ghi). Dữ liệu không đổi -> KHÔNG được tạo file thứ hai.
  h.localStorage.removeItem('CLIENTPRO_LAST_AUTO_BACKUP');
  h.advance(10 * 60 * 1000);
  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 1, 'Payload y hệt trong cửa sổ 6h thì không tải lên lần nữa');
  assert.equal(
    h.localStorage.getItem('CLIENTPRO_LAST_AUTO_BACKUP'),
    String(h.now()),
    'Vẫn phải nhích lại mốc để không kiểm tra lặp mỗi lần vào app'
  );

  // Dữ liệu đổi -> hash đổi -> sao lưu lại bình thường (không được chặn nhầm).
  h.ctx.window.BackupCore.normalizeCustomerForExport = async (c) => ({ id: c.id, name: c.name + ' (đã sửa)' });
  h.localStorage.removeItem('CLIENTPRO_LAST_AUTO_BACKUP');
  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 2, 'Dữ liệu thay đổi thì phải tạo bản mới');
});

test('auto backup: qua 24h vẫn tạo bản mới theo lịch (dedupe không chặn nhịp hằng ngày)', async () => {
  const h = loadAutoBackup();

  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 1);

  h.advance(DAY_MS + 60 * 1000);
  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 2, 'Cửa sổ chống trùng 6h phải ngắn hơn nhịp 24h');
});

test('backup thủ công: không bị dedupe theo nội dung, vẫn tạo bản mới', async () => {
  const h = loadAutoBackup();

  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 1);

  // Người dùng bấm nút "Sao lưu lên Drive" ngay sau đó: payload y hệt nhưng đây
  // là ý định tường minh -> phải tạo bản mới.
  const ok = await h.DriveBackup.performNow();
  assert.equal(ok, true, 'Backup thủ công phải chạy thành công');
  assert.equal(h.backupCallCount(), 2, 'Backup thủ công không bị chặn bởi dedupe');
});

test('backup thủ công: không được bỏ qua pending chưa settle để tải một tên mới', async () => {
  const h = loadAutoBackup();
  let pendingFilename = '';

  h.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    h.requests.push(body);
    if (body.action === 'backup') {
      pendingFilename = body.filename;
      throw new Error('network dropped');
    }
    if (body.action === 'list_backups') {
      return makeGasResponse({ status: 'success', backups: [] });
    }
    return makeGasResponse({ status: 'success' });
  });

  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 1);
  assert.ok(pendingFilename);

  h.advance(5 * 60 * 1000);
  const ok = await h.DriveBackup.performNow();

  assert.equal(ok, false, 'Manual phải báo chưa xác nhận, không báo thành công giả');
  assert.equal(h.backupCallCount(), 1, 'Manual không được tạo tên mới khi request cũ chưa settle');
  const pending = JSON.parse(h.localStorage.getItem('CLIENTPRO_LAST_DRIVE_BACKUP_HASH') || 'null');
  assert.equal(pending && pending.filename, pendingFilename, 'Manual phải giữ nguyên journal của request cũ');
});

test('backup thủ công: sau khi xác nhận pending cũ đã có file vẫn phải tạo bản manual mới', async () => {
  const h = loadAutoBackup();
  let pendingFilename = '';

  h.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    h.requests.push(body);
    if (body.action === 'backup') {
      pendingFilename = body.filename;
      throw new Error('network dropped');
    }
    if (body.action === 'list_backups') throw new Error('still offline');
    return makeGasResponse({ status: 'success' });
  });

  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 1);
  assert.ok(pendingFilename);

  h.advance(5 * 60 * 1000);
  h.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    h.requests.push(body);
    if (body.action === 'list_backups') {
      return makeGasResponse({
        status: 'success',
        backups: [{ id: 'pending_file', filename: pendingFilename, size: 10, createdAt: new Date().toISOString() }],
      });
    }
    if (body.action === 'backup') {
      return makeGasResponse({
        status: 'success',
        fileId: 'manual_file',
        filename: body.filename,
        createdAt: new Date().toISOString(),
      });
    }
    return makeGasResponse({ status: 'success' });
  });

  const ok = await h.DriveBackup.performNow();

  assert.equal(ok, true);
  assert.equal(h.backupCallCount(), 2, 'Manual phải tạo file mới sau khi đã reconcile pending cũ');
  const sentNames = h.requests.filter((r) => r.action === 'backup').map((r) => r.filename);
  assert.notEqual(sentNames[1], pendingFilename, 'Bản manual mới phải là một lượt upload riêng');
});

// ---------------------------------------------------------------------------
// ĐỒNG THỜI GIỮA CÁC NGỮ CẢNH — khóa localStorage KHÔNG làm được việc này.
// `acquireAutoBackupClaim_()` là cặp đọc-rồi-ghi; localStorage chỉ bảo đảm từng
// thao tác đơn lẻ đồng bộ, không có compare-and-set cho cả cặp, nên hai tab đều
// có thể đọc thấy khóa trống trước khi bên nào kịp setItem. Loại trừ lẫn nhau
// thật do Web Locks đảm nhiệm; các test dưới đây canh giữ đúng điểm đó.
// ---------------------------------------------------------------------------

test('hai ngữ cảnh cùng origin cùng tới hạn: Web Locks giữ cho chỉ một bản được tạo', async () => {
  const shared = {
    localStorage: makeLocalStorage(),
    lockManager: makeLockManager(),
    requests: [],
  };
  const tabA = loadAutoBackup(shared);
  const tabB = loadAutoBackup(shared);

  // Dựng lại ĐÚNG cửa sổ đua của khóa localStorage: tab A đã đọc thấy khóa trống
  // và sắp ghi, tab B chen vào đọc trước khi giá trị của A kịp nằm trong store.
  // Đây không phải bóp méo localStorage — từng thao tác vẫn đồng bộ; test chỉ chọn
  // điểm xen kẽ mà hai ngữ cảnh thật (hai tiến trình) hoàn toàn có thể rơi vào,
  // vì đọc-rồi-ghi không phải một phép compare-and-set nguyên tử.
  const rawSetItem = shared.localStorage.setItem.bind(shared.localStorage);
  let runB = null;
  shared.localStorage.setItem = (key, value) => {
    if (key === 'CLIENTPRO_AUTO_BACKUP_CLAIM' && !runB) {
      // Phần chạy đồng bộ của tab B (gồm cả lần đọc khóa của nó) diễn ra ngay đây.
      runB = tabB.DriveBackup.checkDaily();
    }
    rawSetItem(key, value);
  };

  // Giữ tab B lại ngay trước lệnh tải lên cho tới khi tab A cũng tới đó. Nếu để
  // một tab chạy trọn vẹn trước, nó kịp ghi hash và lớp dấu vân tay nội dung sẽ
  // che mất việc CẢ HAI đã lọt qua khóa — che một lỗi vẫn còn nguyên. Thứ tự này
  // (cả hai đọc hash trước khi bên nào ghi) là thứ tự hai tiến trình thật rơi vào
  // khi cùng tới hạn: hash chỉ là lớp phòng thủ phụ thuộc thời điểm, không phải
  // loại trừ lẫn nhau.
  let tabAReachedUpload;
  const bothAtUpload = new Promise((resolve) => { tabAReachedUpload = resolve; });

  const defaultFetchB = tabB.ctx.fetch;
  tabB.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    if (body.action === 'backup') await bothAtUpload;
    return await defaultFetchB(url, init);
  });

  const defaultFetchA = tabA.ctx.fetch;
  tabA.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    if (body.action === 'backup') tabAReachedUpload();
    return await defaultFetchA(url, init);
  });

  await tabA.DriveBackup.checkDaily();
  await runB;

  assert.equal(
    countBackups(shared.requests),
    1,
    'Hai ngữ cảnh xen kẽ trong cửa sổ đọc-ghi vẫn chỉ được tạo một file'
  );

  // Khóa đã nhả hết: lượt sau vẫn phải chạy được (không kẹt vĩnh viễn).
  assert.equal(shared.lockManager._held.size, 0, 'Web Lock phải được nhả sau khi xong');
  assert.equal(
    shared.localStorage.getItem('CLIENTPRO_AUTO_BACKUP_CLAIM'),
    null,
    'Khóa bền cũng phải được nhả'
  );
});

test('Web Locks lỗi/không dùng được: vẫn sao lưu đúng một lần qua nhánh dự phòng', async () => {
  const h = loadAutoBackup({
    lockManager: {
      request: async () => { throw new Error('SecurityError'); },
    },
  });

  await h.DriveBackup.checkDaily();

  assert.equal(h.backupCallCount(), 1, 'Không có Web Locks thì vẫn phải sao lưu được');
  assert.equal(
    h.localStorage.getItem('CLIENTPRO_AUTO_BACKUP_CLAIM'),
    null,
    'Nhánh dự phòng cũng phải nhả khóa bền'
  );
});

test('backup thủ công cũng đi qua Web Locks: bị chặn khi tab khác đang giữ khóa', async () => {
  const lockManager = makeLockManager();
  const h = loadAutoBackup({ lockManager });

  // Một ngữ cảnh khác đang giữ khóa (không phải khóa bền — khóa Web Locks).
  lockManager._held.add('clientpro-auto-backup');

  const ok = await h.DriveBackup.performNow();
  assert.equal(ok, false, 'Không chạy song song với ngữ cảnh đang sao lưu');
  assert.equal(h.backupCallCount(), 0);
});

test('backup thủ công: bị chặn khi một lượt auto đang giữ khóa bền', async () => {
  const h = loadAutoBackup();

  h.localStorage.setItem('CLIENTPRO_AUTO_BACKUP_CLAIM', String(h.now()));

  const ok = await h.DriveBackup.performNow();
  assert.equal(ok, false, 'Không chạy song song với lượt auto đang dở');
  assert.equal(h.backupCallCount(), 0);
});

// ---------------------------------------------------------------------------
// UPLOAD KHÔNG RÕ KẾT QUẢ (UNCONFIRMED) — nguồn gốc thực tế của "1 lúc 3 file".
// GAS handleCreateBackup_ tạo file TRƯỚC khi response quay về máy, nên một
// response bị mất / body rỗng / HTML lỗi KHÔNG có nghĩa là upload thất bại.
// Trước khi sửa: mốc 24h + hash không được ghi, mỗi lần unlock/visibilitychange
// lại tải lên một file nữa. Các test dưới đây canh giữ phán quyết
// OK / REJECTED / UNCONFIRMED và bước dò xác nhận bằng list_backups.
// ---------------------------------------------------------------------------

test('auto backup: response mất nhưng file ĐÃ lên Drive -> dò xác nhận, chốt mốc, không tạo thêm file', async () => {
  const h = loadAutoBackup();

  // GAS đã tạo file (đúng tên client gửi) nhưng response không quay về được;
  // list_backups vẫn trả lời được và cho thấy file đó.
  h.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    h.requests.push(body);
    if (body.action === 'backup') throw new Error('network dropped');
    if (body.action === 'list_backups') {
      const created = h.requests
        .filter((r) => r.action === 'backup')
        .map((r) => ({ id: 'file_confirmed', filename: r.filename, size: 10, createdAt: new Date().toISOString() }));
      return makeGasResponse({ status: 'success', backups: created });
    }
    return makeGasResponse({ status: 'success' });
  });

  await h.DriveBackup.checkDaily();

  assert.equal(h.backupCallCount(), 1, 'Chỉ một request tạo file được gửi đi');
  assert.ok(
    h.localStorage.getItem('CLIENTPRO_LAST_AUTO_BACKUP'),
    'Mốc 24h phải được chốt sau khi probe xác nhận file đã nằm trên Drive'
  );
  assert.ok(
    h.localStorage.getItem('CLIENTPRO_LAST_DRIVE_BACKUP_HASH'),
    'Fingerprint cũng phải được ghi sau khi xác nhận'
  );

  // Đây chính là các nguồn kích hoạt từng tạo thêm file trước khi sửa:
  // sự kiện unlock (+3s) và app quay lại foreground.
  h.advance(30 * 1000);
  await h.document._emit('clientpro:unlocked');
  await h.document._emit('visibilitychange');
  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 1, 'Không được tạo thêm bản nào sau một upload đã dò xác nhận');
});

test('auto backup: body không phải JSON (GAS trả HTML) -> probe xác nhận rồi vẫn chốt mốc', async () => {
  const h = loadAutoBackup();

  h.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    h.requests.push(body);
    if (body.action === 'backup') {
      // GAS/Google trả trang HTML (đăng nhập, lỗi triển khai) thay vì JSON —
      // response.json() trần ở code cũ ném lỗi ở đây và mốc 24h bị bỏ trống.
      return { text: async () => '<html>Sign in</html>' };
    }
    if (body.action === 'list_backups') {
      const created = h.requests
        .filter((r) => r.action === 'backup')
        .map((r) => ({ id: 'file_html', filename: r.filename, size: 1, createdAt: new Date().toISOString() }));
      return makeGasResponse({ status: 'success', backups: created });
    }
    return makeGasResponse({ status: 'success' });
  });

  await h.DriveBackup.checkDaily();

  assert.equal(h.backupCallCount(), 1);
  assert.ok(
    h.localStorage.getItem('CLIENTPRO_LAST_AUTO_BACKUP'),
    'Upload được probe xác nhận phải chốt mốc 24h dù response gốc không phải JSON'
  );
});

test('auto backup: mất mạng hoàn toàn -> chỉ tải lại sau khi pending qua thời hạn settle và Drive vẫn trống', async () => {
  const h = loadAutoBackup();
  const originalFetch = h.ctx.fetch;

  // Cả upload lẫn probe đều không tới được server (mất mạng hoàn toàn).
  // Request có thể chưa bao giờ tới GAS — ghi hash "thành công" rồi để dedupe
  // nhích mốc 24h chính là bug Codex P1 chỉ ra.
  h.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    h.requests.push(body);
    throw new Error('offline');
  });

  await h.DriveBackup.checkDaily();

  assert.equal(h.backupCallCount(), 1, 'Chỉ một lần thử upload');
  assert.equal(
    h.localStorage.getItem('CLIENTPRO_LAST_AUTO_BACKUP'),
    null,
    'Chưa xác nhận được file thì KHÔNG chốt mốc 24h'
  );
  const pendingRaw = h.localStorage.getItem('CLIENTPRO_LAST_DRIVE_BACKUP_HASH');
  assert.ok(pendingRaw, 'Phải ghi bản ghi pending để lần sau dò lại');
  const pending = JSON.parse(pendingRaw);
  assert.equal(pending.confirmed, false, 'Pending phải đánh dấu confirmed:false');
  assert.ok(pending.filename, 'Pending phải giữ đúng tên file đã gửi để dò lại');

  // Mạng quay lại sớm, Drive đang trống: đây vẫn chỉ là snapshot không đồng bộ
  // với request tạo file cũ, nên phải giữ pending và chưa được tải tên mới.
  h.setFetch(originalFetch);
  h.advance(5 * 60 * 1000);
  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 1, 'Snapshot trống trước thời hạn settle không được xóa pending rồi tải lại');
  const stillPending = JSON.parse(h.localStorage.getItem('CLIENTPRO_LAST_DRIVE_BACKUP_HASH') || 'null');
  assert.ok(stillPending && stillPending.confirmed === false, 'Pending phải còn nguyên sau snapshot trống sớm');

  // Sau trần xử lý của request cũ, một probe có trả lời và vẫn vắng mặt mới là
  // terminal state: request cũ không tạo file, giờ mới được tải lại.
  h.advance(PENDING_SETTLE_MS - 5 * 60 * 1000 + 1);
  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 2, 'Drive vẫn trống sau thời hạn settle -> phải tải lên lại, không nuốt backup 24h');
  assert.ok(h.localStorage.getItem('CLIENTPRO_LAST_AUTO_BACKUP'), 'Sau upload thành công phải chốt mốc 24h');
  const after = JSON.parse(h.localStorage.getItem('CLIENTPRO_LAST_DRIVE_BACKUP_HASH') || 'null');
  assert.ok(after && after.confirmed !== false, 'Hash sau thành công phải là confirmed');
});

test('auto backup: mất mạng hoàn toàn -> online lại mà file ĐÃ có trên Drive thì chốt thành công, không tải trùng', async () => {
  const h = loadAutoBackup();
  let pendingFilename = '';

  h.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    h.requests.push(body);
    if (body.action === 'backup') {
      pendingFilename = body.filename;
      throw new Error('offline');
    }
    throw new Error('offline');
  });

  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 1);
  assert.ok(pendingFilename);

  // Online lại: Drive đã có đúng file (request cũ thực ra đã tới GAS).
  h.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    h.requests.push(body);
    if (body.action === 'backup') {
      throw new Error('không được tải lại khi pending đã có file trên Drive');
    }
    if (body.action === 'list_backups') {
      return makeGasResponse({
        status: 'success',
        backups: [{ id: 'file_pending', filename: pendingFilename, size: 10, createdAt: new Date().toISOString() }],
      });
    }
    return makeGasResponse({ status: 'success' });
  });
  h.advance(5 * 60 * 1000);
  await h.DriveBackup.checkDaily();

  assert.equal(h.backupCallCount(), 1, 'File pending đã có trên Drive -> không tạo bản thứ hai');
  assert.ok(h.localStorage.getItem('CLIENTPRO_LAST_AUTO_BACKUP'), 'Phải chốt mốc 24h sau khi probe xác nhận pending');
  const after = JSON.parse(h.localStorage.getItem('CLIENTPRO_LAST_DRIVE_BACKUP_HASH') || 'null');
  assert.ok(after && after.confirmed !== false, 'Pending phải được nâng thành confirmed');
});

test('auto backup: probe vẫn "chưa thấy file" trước thời hạn settle -> giữ PENDING; chỉ tải lại sau deadline', async () => {
  // Codex P1: list_backups KHÔNG nằm trong WRITE_ACTIONS_USER_ nên không chia sẻ
  // script lock của handleCreateBackup_. Một lần dò trả "chưa thấy" — kể cả lần
  // dò CUỐI — vẫn KHÔNG chứng minh được file chưa/không được tạo: execution gốc có
  // thể còn xếp hàng. Vì vậy vắng mặt ở probe cuối không được coi là "thất bại
  // thật" (quên tên file rồi tải tên khác -> sinh bản trùng); phải giữ pending và
  // để lần kiểm tra sau dò lại đúng tên trước khi quyết định tải lại.
  const h = loadAutoBackup();
  const originalFetch = h.ctx.fetch;

  // Upload không tới được server; probe trả lời rõ ràng ở MỌI lần dò: chưa thấy file.
  h.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    h.requests.push(body);
    if (body.action === 'backup') throw new Error('network dropped');
    if (body.action === 'list_backups') return makeGasResponse({ status: 'success', backups: [] });
    return makeGasResponse({ status: 'success' });
  });

  await h.DriveBackup.checkDaily();

  assert.equal(h.backupCallCount(), 1);
  assert.ok(
    h.requests.filter((r) => r.action === 'list_backups').length >= 2,
    'Phải dò lại theo lịch trễ trước khi kết luận'
  );
  assert.equal(
    h.localStorage.getItem('CLIENTPRO_LAST_AUTO_BACKUP'),
    null,
    'Chưa xác nhận được file thì KHÔNG chốt mốc 24h'
  );
  const pending = JSON.parse(h.localStorage.getItem('CLIENTPRO_LAST_DRIVE_BACKUP_HASH') || 'null');
  assert.ok(pending && pending.confirmed === false && pending.filename,
    'Vắng mặt ở probe cuối phải giữ PENDING (confirmed:false + filename), không kết luận thất bại rồi quên tên file');

  // Lần kiểm tra ngay sau đó vẫn chỉ nhận snapshot rỗng: request cũ có thể còn
  // xếp hàng/chạy, nên phải giữ pending và tuyệt đối không gửi tên mới.
  h.setFetch(originalFetch);
  h.advance(5 * 60 * 1000);
  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 1, 'Pending chưa settle không được bị xóa bởi snapshot rỗng lặp lại');

  // Qua thời hạn settle, Drive vẫn trống và probe trả lời được: request cũ đã có
  // terminal state, có thể xoá pending rồi tải lại.
  h.advance(PENDING_SETTLE_MS - 5 * 60 * 1000 + 1);
  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 2, 'Pending đã settle và Drive vẫn trống -> phải thử lại');
  assert.ok(h.localStorage.getItem('CLIENTPRO_LAST_AUTO_BACKUP'));
  const after = JSON.parse(h.localStorage.getItem('CLIENTPRO_LAST_DRIVE_BACKUP_HASH') || 'null');
  assert.ok(after && after.confirmed !== false, 'Sau upload thành công hash phải là confirmed');
});

test('auto backup: snapshot rỗng lặp lại không xóa pending; file xuất hiện muộn vẫn được xác nhận, không tải trùng', async () => {
  const h = loadAutoBackup();
  let pendingFilename = '';

  h.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    h.requests.push(body);
    if (body.action === 'backup') {
      pendingFilename = body.filename;
      throw new Error('network dropped');
    }
    if (body.action === 'list_backups') {
      return makeGasResponse({ status: 'success', backups: [] });
    }
    return makeGasResponse({ status: 'success' });
  });

  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 1);

  // Trigger kế tiếp vẫn chưa thấy file. Đây chính là finding Codex mới nhất:
  // code cũ xóa pending tại đây rồi gửi request thứ hai.
  h.advance(5 * 60 * 1000);
  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 1, 'Snapshot rỗng lần hai không được tạo request backup mới');
  const stillPending = JSON.parse(h.localStorage.getItem('CLIENTPRO_LAST_DRIVE_BACKUP_HASH') || 'null');
  assert.equal(stillPending && stillPending.filename, pendingFilename, 'Phải giữ đúng tên request gốc để tiếp tục dò');

  // Request gốc hoàn tất muộn nhưng vẫn trước deadline: lần sau phải tìm thấy
  // đúng file đã journal và nâng pending thành confirmed.
  h.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    h.requests.push(body);
    if (body.action === 'backup') throw new Error('không được tải request thứ hai');
    if (body.action === 'list_backups') {
      return makeGasResponse({
        status: 'success',
        backups: [{ id: 'file_late_after_miss', filename: pendingFilename, size: 10, createdAt: new Date().toISOString() }],
      });
    }
    return makeGasResponse({ status: 'success' });
  });
  h.advance(60 * 1000);
  await h.DriveBackup.checkDaily();

  assert.equal(h.backupCallCount(), 1, 'File gốc xuất hiện muộn phải được xác nhận mà không tạo bản trùng');
  assert.ok(h.localStorage.getItem('CLIENTPRO_LAST_AUTO_BACKUP'));
  const confirmed = JSON.parse(h.localStorage.getItem('CLIENTPRO_LAST_DRIVE_BACKUP_HASH') || 'null');
  assert.ok(confirmed && confirmed.confirmed !== false, 'Pending phải được nâng thành confirmed');
});

test('auto backup: pending mà file gốc XUẤT HIỆN MUỘN (execution còn xếp hàng) -> lần sau dò thấy, không tải trùng', async () => {
  // Đây chính là mối nguy Codex P1 nêu: probe cuối "chưa thấy" nhưng execution gốc
  // vẫn đang xếp hàng và tạo file NGAY SAU đó. Nếu coi vắng mặt là thất bại thật thì
  // lần kiểm tra kế tiếp tải lên một tên khác -> hai file cho một lượt. Giữ pending
  // rồi dò lại đúng tên phải bắt được file muộn này.
  const h = loadAutoBackup();
  let pendingFilename = '';

  h.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    h.requests.push(body);
    if (body.action === 'backup') { pendingFilename = body.filename; throw new Error('network dropped'); }
    if (body.action === 'list_backups') return makeGasResponse({ status: 'success', backups: [] });
    return makeGasResponse({ status: 'success' });
  });

  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 1);
  assert.ok(pendingFilename);
  const pending = JSON.parse(h.localStorage.getItem('CLIENTPRO_LAST_DRIVE_BACKUP_HASH') || 'null');
  assert.ok(pending && pending.confirmed === false, 'Phải giữ pending sau probe cuối vắng mặt');

  // Lần kiểm tra sau: file gốc (xếp hàng) đã xuất hiện trên Drive.
  h.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    h.requests.push(body);
    if (body.action === 'backup') throw new Error('không được tải lại khi file gốc đã xuất hiện muộn');
    if (body.action === 'list_backups') {
      return makeGasResponse({
        status: 'success',
        backups: [{ id: 'file_late', filename: pendingFilename, size: 10, createdAt: new Date().toISOString() }],
      });
    }
    return makeGasResponse({ status: 'success' });
  });
  h.advance(7 * 60 * 60 * 1000); // > cửa sổ dedupe 6h: pending vẫn phải được đối soát
  await h.DriveBackup.checkDaily();

  assert.equal(h.backupCallCount(), 1, 'File gốc xuất hiện muộn -> KHÔNG tạo bản thứ hai');
  assert.ok(h.localStorage.getItem('CLIENTPRO_LAST_AUTO_BACKUP'), 'Dò thấy file muộn -> chốt mốc 24h');
  const after = JSON.parse(h.localStorage.getItem('CLIENTPRO_LAST_DRIVE_BACKUP_HASH') || 'null');
  assert.ok(after && after.confirmed !== false, 'Pending phải được nâng thành confirmed');
});

test('auto backup: fetch reject nhưng GAS còn đang xử lý (file xuất hiện muộn) -> probe thử lại bắt được, không kết luận sớm', async () => {
  const h = loadAutoBackup();

  // Đúng race trong review: upload reject trong khi execution gốc vẫn chạy
  // (backup giữ script lock, list_backups thì không). Lần dò đầu thấy "chưa có"
  // hoàn toàn hợp lệ; file xuất hiện ở lần dò sau.
  let listCalls = 0;
  h.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    h.requests.push(body);
    if (body.action === 'backup') throw new Error('network dropped mid-flight');
    if (body.action === 'list_backups') {
      listCalls++;
      if (listCalls === 1) return makeGasResponse({ status: 'success', backups: [] });
      const created = h.requests
        .filter((r) => r.action === 'backup')
        .map((r) => ({ id: 'file_late', filename: r.filename, size: 10, createdAt: new Date().toISOString() }));
      return makeGasResponse({ status: 'success', backups: created });
    }
    return makeGasResponse({ status: 'success' });
  });

  await h.DriveBackup.checkDaily();

  assert.equal(h.backupCallCount(), 1, 'Chỉ một request tạo file được gửi đi');
  assert.ok(listCalls >= 2, 'Probe phải thử lại sau lần dò đầu "chưa có"');
  assert.ok(
    h.localStorage.getItem('CLIENTPRO_LAST_AUTO_BACKUP'),
    'Lần dò sau thấy file -> phải chốt mốc 24h như một upload thành công'
  );
  assert.ok(
    h.localStorage.getItem('CLIENTPRO_LAST_DRIVE_BACKUP_HASH'),
    'Fingerprint cũng phải được ghi'
  );

  // Trước khi sửa, "chưa có" ở lần dò đầu bị coi là thất bại thật -> các trigger
  // sau upload lại và file gốc xuất hiện muộn tạo thành bản trùng.
  h.advance(30 * 1000);
  await h.document._emit('clientpro:unlocked');
  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 1, 'Không được tạo thêm bản nào — file gốc đã được xác nhận');
});

test('auto backup: lần dò cuối không trả lời được -> coi là chưa xác nhận (ghi fingerprint), không kết luận thất bại', async () => {
  const h = loadAutoBackup();

  // Lần dò đầu "chưa có" (execution gốc có thể còn chạy), các lần dò sau mất
  // mạng: vắng mặt chưa được xác nhận ở lần dò cuối -> không được coi là thất
  // bại thật (nếu coi là thất bại, lần kiểm tra sau tải lại và có thể trùng).
  let listCalls = 0;
  h.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    h.requests.push(body);
    if (body.action === 'backup') throw new Error('network dropped');
    if (body.action === 'list_backups') {
      listCalls++;
      if (listCalls === 1) return makeGasResponse({ status: 'success', backups: [] });
      throw new Error('offline again');
    }
    return makeGasResponse({ status: 'success' });
  });

  await h.DriveBackup.checkDaily();

  assert.equal(h.backupCallCount(), 1);
  assert.ok(listCalls >= 2, 'Phải dò tới hết lịch thử lại');
  assert.equal(
    h.localStorage.getItem('CLIENTPRO_LAST_AUTO_BACKUP'),
    null,
    'Chưa xác nhận được thì không chốt mốc 24h'
  );
  const pending = JSON.parse(h.localStorage.getItem('CLIENTPRO_LAST_DRIVE_BACKUP_HASH') || 'null');
  assert.ok(pending && pending.confirmed === false && pending.filename,
    'Nhánh chưa-xác-nhận phải ghi pending confirmed:false + filename (không phải hash thành công)');
});

test('auto backup: GAS lỗi SAU khi đã tạo file (trimBackups_ ném) -> status error lạ phải đi đường probe, không tạo trùng', async () => {
  const h = loadAutoBackup();

  // gas/UserDriveAPI.gs: handleCreateBackup_ đã folder.createFile xong,
  // trimBackups_ ném lỗi -> catch tổng trả status:'error' "Loi Server..."
  // dù file ĐANG nằm trên Drive. Coi message này là REJECTED (chưa có file,
  // thử lại an toàn) chính là nguồn tạo bản trùng ở lần kiểm tra kế tiếp.
  h.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    h.requests.push(body);
    if (body.action === 'backup') {
      return makeGasResponse({ status: 'error', message: 'Loi Server. Vui long thu lai.' });
    }
    if (body.action === 'list_backups') {
      const created = h.requests
        .filter((r) => r.action === 'backup')
        .map((r) => ({ id: 'file_trim_err', filename: r.filename, size: 10, createdAt: new Date().toISOString() }));
      return makeGasResponse({ status: 'success', backups: created });
    }
    return makeGasResponse({ status: 'success' });
  });

  await h.DriveBackup.checkDaily();

  assert.equal(h.backupCallCount(), 1, 'Chỉ một request tạo file được gửi đi');
  assert.ok(
    h.requests.filter((r) => r.action === 'list_backups').length >= 1,
    'status:error với message KHÔNG thuộc nhóm pre-write phải được dò probe'
  );
  assert.ok(
    h.localStorage.getItem('CLIENTPRO_LAST_AUTO_BACKUP'),
    'Probe thấy file -> phải chốt mốc 24h như một upload thành công'
  );

  // Các trigger sau không được tạo thêm bản nào.
  h.advance(30 * 1000);
  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 1, 'Không tạo bản trùng sau lỗi trim hậu-createFile');
});

test('auto backup: status error lạ + probe chưa thấy file -> giữ PENDING tới deadline rồi mới thử lại', async () => {
  // status:'error' với message KHÔNG thuộc nhóm pre-write có thể phát SAU khi file
  // đã tạo (trimBackups_ ném) HOẶC trước khi tạo file. list_backups không giữ lock
  // nên "chưa thấy" ở probe cuối vẫn không phải bằng chứng chắc chắn chưa có file
  // (Codex P1). Giữ pending, dò lại ở lần sau; Drive vẫn trống thì mới tải lại.
  const h = loadAutoBackup();
  const originalFetch = h.ctx.fetch;

  h.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    h.requests.push(body);
    if (body.action === 'backup') {
      return makeGasResponse({ status: 'error', message: 'Loi Server. Vui long thu lai.' });
    }
    if (body.action === 'list_backups') return makeGasResponse({ status: 'success', backups: [] });
    return makeGasResponse({ status: 'success' });
  });

  await h.DriveBackup.checkDaily();

  assert.equal(h.backupCallCount(), 1);
  assert.ok(
    h.requests.filter((r) => r.action === 'list_backups').length >= 1,
    'status:error với message KHÔNG thuộc nhóm pre-write phải đi đường probe'
  );
  assert.equal(h.localStorage.getItem('CLIENTPRO_LAST_AUTO_BACKUP'), null, 'Chưa xác nhận được thì không chốt mốc 24h');
  const pending = JSON.parse(h.localStorage.getItem('CLIENTPRO_LAST_DRIVE_BACKUP_HASH') || 'null');
  assert.ok(pending && pending.confirmed === false && pending.filename,
    'Probe cuối chưa thấy file -> giữ PENDING, không kết luận thất bại rồi quên tên file');

  // Snapshot trống sớm không phải terminal state: giữ pending, chưa tải lại.
  h.setFetch(originalFetch);
  h.advance(5 * 60 * 1000);
  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 1, 'Không được xóa pending theo snapshot rỗng trước deadline');

  // Qua deadline mà Drive vẫn trống -> request cũ đã settle, thử lại an toàn.
  h.advance(PENDING_SETTLE_MS - 5 * 60 * 1000 + 1);
  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 2, 'Pending đã settle và Drive vẫn trống -> phải thử lại');
  assert.ok(h.localStorage.getItem('CLIENTPRO_LAST_AUTO_BACKUP'));
});

test('auto backup: device ID chứa / hoặc \\ -> tên file opaque đã sanitize khớp probe', async () => {
  // Codex P2: handleCreateBackup_ thay '/' '\' bằng '_' trước khi tạo file.
  // Nếu client gửi tên thô rồi probe khớp đúng-tên thô, sẽ không bao giờ thấy
  // file đã sanitize trên Drive -> kết luận vắng mặt -> lần sau tạo trùng.
  const h = loadAutoBackup();
  h.ctx.getEmployeeId = () => 'MASTER-RECOVERY-SECRET-42';
  h.ctx.getDeviceIdSafe = () => 'DEVICE/TEST\\1';

  // Mô phỏng đúng luật GAS: lưu file dưới tên ĐÃ sanitize; response upload mất.
  const gasSanitize = (name) => {
    let s = String(name || '').trim().replace(/[\/\\\r\n\t\x00-\x1F]/g, '_');
    if (!/\.cpb$/i.test(s)) s = (s.replace(/\.[a-z0-9]+$/i, '') || 'BACKUP') + '.cpb';
    return s;
  };

  h.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    h.requests.push(body);
    if (body.action === 'backup') {
      // Client phải đã gửi tên đã sanitize — nếu còn '/' '\' thì bug.
      assert.equal(body.filename, gasSanitize(body.filename),
        'Client phải gửi tên đã chuẩn hoá (không còn ký tự đường dẫn)');
      assert.ok(!/[\/\\]/.test(body.filename), 'Tên file gửi đi không được còn / hoặc \\');
      throw new Error('network dropped');
    }
    if (body.action === 'list_backups') {
      // Drive chỉ có file dưới tên đã sanitize (đúng hành vi GAS).
      const created = h.requests
        .filter((r) => r.action === 'backup')
        .map((r) => ({
          id: 'file_sanitized',
          filename: gasSanitize(r.filename),
          size: 10,
          createdAt: new Date().toISOString(),
        }));
      return makeGasResponse({ status: 'success', backups: created });
    }
    return makeGasResponse({ status: 'success' });
  });

  await h.DriveBackup.checkDaily();

  assert.equal(h.backupCallCount(), 1);
  const sent = h.requests.find((r) => r.action === 'backup');
  assert.ok(sent && sent.filename.includes('DEVICE_TEST_1'),
    'Tên gửi đi phải giữ device id đã thay / và \\ bằng _ (got: ' + (sent && sent.filename) + ')');
  assert.ok(!sent.filename.includes('MASTER-RECOVERY-SECRET-42'),
    'Tên opaque không được chứa mã nhân viên dùng khôi phục master key');
  assert.ok(
    h.localStorage.getItem('CLIENTPRO_LAST_AUTO_BACKUP'),
    'Probe khớp tên đã sanitize phải thấy file và chốt mốc 24h'
  );

  h.advance(30 * 1000);
  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 1, 'Không tạo bản trùng vì device ID có ký tự đường dẫn');
});

test('auto backup: server từ chối rõ ràng (REJECTED pre-write) -> không dò probe, không chốt mốc, lần sau thử lại', async () => {
  const h = loadAutoBackup();
  const originalFetch = h.ctx.fetch;

  h.setFetch(async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    h.requests.push(body);
    if (body.action === 'backup') return makeGasResponse({ status: 'error', message: 'Unauthorized' });
    return makeGasResponse({ status: 'success', backups: [] });
  });

  await h.DriveBackup.checkDaily();

  assert.equal(h.backupCallCount(), 1);
  assert.equal(
    h.requests.filter((r) => r.action === 'list_backups').length,
    0,
    'Verdict pre-write (Unauthorized) là câu trả lời dứt khoát: không cần dò probe'
  );
  assert.equal(h.localStorage.getItem('CLIENTPRO_LAST_AUTO_BACKUP'), null);
  assert.equal(h.localStorage.getItem('CLIENTPRO_LAST_DRIVE_BACKUP_HASH'), null);

  // Sau khi nguyên nhân bị từ chối được khắc phục (vd nhập lại token), lần kiểm
  // tra kế tiếp phải sao lưu được — REJECTED không được khóa nhịp sao lưu.
  h.setFetch(originalFetch);
  h.advance(5 * 60 * 1000);
  await h.DriveBackup.checkDaily();
  assert.equal(h.backupCallCount(), 2, 'REJECTED xong vẫn phải thử lại được ở lần sau');
  assert.ok(h.localStorage.getItem('CLIENTPRO_LAST_AUTO_BACKUP'));
});

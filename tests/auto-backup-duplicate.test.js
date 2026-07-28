'use strict';

// ============================================================================
// auto-backup-duplicate.test.js — Auto backup lên Drive KHÔNG được tạo hai bản
// cho cùng một lượt.
//
// Ba đường sinh trùng đã sửa trong assets/16_auto_backup_drive.js:
//   1. Mốc throttle 24h (CLIENTPRO_LAST_AUTO_BACKUP) chỉ được ghi SAU khi dọn
//      retention; retention gọi mạng nên chỉ cần nó lỗi là cả lượt ném lỗi, mốc
//      không nhích, và lần kiểm tra kế tiếp tạo tiếp bản thứ hai.
//   2. Cờ chống chạy chồng là biến RAM -> chết theo lần tải trang: reload/PWA bị
//      thu hồi giữa lúc tải lên, hoặc app mở ở hai ngữ cảnh, đều chạy lại từ đầu.
//   3. Không có dấu vân tay nội dung: lượt chạy lại với payload y hệt vẫn tạo file
//      mới (backup trong máy đã có anti-spam theo hash từ trước).
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAutoBackup } = require('./helpers/load-auto-backup');

const DAY_MS = 24 * 60 * 60 * 1000;

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
      return {
        json: async () => ({
          status: 'success',
          fileId: 'file_x',
          filename: body.filename,
          createdAt: new Date().toISOString(),
        }),
      };
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

test('backup thủ công: bị chặn khi một lượt auto đang giữ khóa bền', async () => {
  const h = loadAutoBackup();

  h.localStorage.setItem('CLIENTPRO_AUTO_BACKUP_CLAIM', String(h.now()));

  const ok = await h.DriveBackup.performNow();
  assert.equal(ok, false, 'Không chạy song song với lượt auto đang dở');
  assert.equal(h.backupCallCount(), 0);
});

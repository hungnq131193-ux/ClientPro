// =========================================================
// CLIENTPRO USER GAS - PERSONAL DRIVE
// v2 - Hardening, backward-compatible with v1 clients
// Chức năng: Upload ảnh + Backup/Restore lên Drive cá nhân
//
// TƯƠNG THÍCH NGƯỢC (QUAN TRỌNG):
//   - Giữ NGUYÊN mọi action, alias field, và response mà app đang đọc
//     (đặc biệt: field 'url' + 'folderUrl' khi upload/search; 'encrypted' khi download).
//   - ACCESS_TOKEN mặc định RỖNG -> KHÔNG bật kiểm tra token, nên user cũ chạy y như v1.
//     Chỉ khi bạn tự đặt token (và cấu hình app gửi kèm) thì mới bật lớp bảo vệ này.
//
// QUYỀN RIÊNG TƯ ẢNH (THAY ĐỔI CHÍNH v2_private):
//   - Ảnh upload giờ được đặt PRIVATE (chỉ chủ sở hữu tài khoản Google của GAS xem được),
//     KHÔNG còn ANYONE_WITH_LINK. Muốn xem ảnh phải mở folder bằng tài khoản Google có quyền
//     (mặc định là chính tài khoản deploy GAS này). Đây là mô hình "private Drive folder +
//     mở bằng tài khoản có quyền", tránh rò rỉ khi link bị log/backup/gửi nhầm/copy.
//   - Response KHÔNG còn trả 'directLink' (link 'uc?export=view' trông như công khai, dễ rò rỉ
//     và không còn render cho người ngoài khi file đã private). App không đọc field này.
//   - Chạy MỘT LẦN hàm revokePublicSharing() sau khi deploy để bỏ công khai TOÀN BỘ ảnh cũ
//     đã lỡ được đặt ANYONE_WITH_LINK ở các bản trước.
//
// THAY ĐỔI KHÁC SO VỚI v1:
//   1. (Tùy chọn) ACCESS_TOKEN gate: chặn người lạ gọi URL nếu bạn bật.
//   2. Giới hạn kích thước ảnh/backup để tránh nhồi Drive.
//   3. download_backup/delete_backup chỉ thao tác trong đúng folder BACKUP của app
//      (không cho dùng URL này để đọc/xóa file bất kỳ trong Drive qua fileId tùy ý).
//   4. Không lộ exception thô ra client; log lại bằng Logger.
//   5. Lock cho các thao tác GHI để tránh trùng lặp/tranh chấp folder.
// =========================================================
const BUILD_TAG = 'CLIENTPRO_USER_GAS_2026-07-04_v2_private';

// =======================
// CONFIG - Folder names
// =======================
const IMAGES_FOLDER = 'CLIENTPRO_IMAGES';
const BACKUP_FOLDER = 'CLIENTPRO_BACKUPS';
const BACKUP_KEEP_LAST = 5; // Giữ 5 bản backup gần nhất

// ScriptProperties keys
const PROP_IMAGES_FOLDER_ID = 'CLIENTPRO_IMAGES_FOLDER_ID';
const PROP_BACKUP_FOLDER_ID = 'CLIENTPRO_BACKUP_FOLDER_ID';

// --- SECURITY / LIMITS (tùy chọn) ---
// Nếu đặt chuỗi bí mật vào đây (vd 'clp_9f3...'), server sẽ TỪ CHỐI request thiếu
// tham số 'token' khớp. Để RỖNG '' nghĩa là TẮT (tương thích 100% với app v1 hiện tại).
const ACCESS_TOKEN = '';
// Giới hạn để tránh lạm dụng Drive. (base64 dài hơn dữ liệu gốc ~33%.)
const MAX_IMAGE_B64_LEN = 12 * 1024 * 1024;    // ~9MB ảnh gốc / ảnh
const MAX_IMAGES_PER_REQ = 30;
const MAX_BACKUP_B64_LEN = 40 * 1024 * 1024;   // ~30MB / backup
// Chống ghi trùng nhờ khóa cho action ghi.
const WRITE_ACTIONS_USER_ = { upload: 1, backup: 1, delete_backup: 1 };

// =========================================================
// WEB APP ENTRY
// =========================================================
function doGet(e) { return handleRequest_(e); }
function doPost(e) { return handleRequest_(e); }

function handleRequest_(e) {
  let data = {};
  let action = '';
  try {
    data = parseRequestData_(e);
    action = String(data.action || '').trim().toLowerCase();

    // Auto-detect action based on payload if action is empty (GIỮ NGUYÊN như v1)
    if (!action) {
      if (data.images && Array.isArray(data.images)) action = 'upload';
      else if (data.folderName && !data.encrypted) action = 'search';
      else if (data.encrypted || data.content || data.backup) action = 'backup';
      else if (data.fileId && !data.encrypted) action = 'download_backup';
    }
  } catch (errParse) {
    Logger.log('parse error: ' + errParse);
    return outputJSON_({ status: 'error', message: 'Yeu cau khong hop le', build: BUILD_TAG });
  }

  // ping/debug không cần token để dễ kiểm tra kết nối.
  if (action === 'ping') {
    return outputJSON_({ status: 'success', message: 'User GAS Connected', build: BUILD_TAG });
  }
  if (action === 'debug_echo') {
    // Không trả lại nội dung nhạy cảm (ảnh/backup) trong echo.
    const safe = {};
    for (const k in data) {
      if (k === 'images' || k === 'encrypted' || k === 'content' || k === 'backup') { safe[k] = '[omitted]'; continue; }
      safe[k] = data[k];
    }
    return outputJSON_({ status: 'success', build: BUILD_TAG, data: safe, action_received: action });
  }

  // (Tùy chọn) kiểm tra token nếu đã cấu hình ACCESS_TOKEN.
  if (ACCESS_TOKEN) {
    const tok = String(data.token || data.access_token || '').trim();
    if (tok !== ACCESS_TOKEN) {
      return outputJSON_({ status: 'error', message: 'Unauthorized', build: BUILD_TAG });
    }
  }

  const needLock = !!WRITE_ACTIONS_USER_[action];
  let lock = null;
  if (needLock) {
    lock = LockService.getScriptLock();
    try { lock.waitLock(10000); } catch (eLock) {
      return outputJSON_({ status: 'error', message: 'May chu ban, thu lai sau', build: BUILD_TAG });
    }
  }

  try {
    // ===== IMAGE UPLOAD =====
    if (action === 'upload' || action === 'upload_image' || action === 'upload_images') {
      return handleUploadImages_(data);
    }
    if (action === 'search' || action === 'search_folder') {
      return handleSearchFolder_(data);
    }

    // ===== BACKUP / RESTORE =====
    if (action === 'backup' || action === 'create_backup' || action === 'upload_backup') {
      return handleCreateBackup_(data);
    }
    if (action === 'list_backups') {
      return handleListBackups_(data);
    }
    if (action === 'download_backup' || action === 'restore') {
      return handleDownloadBackup_(data);
    }
    if (action === 'delete_backup') {
      return handleDeleteBackup_(data);
    }

    return outputJSON_({ status: 'error', message: 'Action khong hop le: ' + action, build: BUILD_TAG });
  } catch (err) {
    Logger.log('handleRequest_ error [' + action + ']: ' + String(err) + '\n' + (err && err.stack ? err.stack : ''));
    return outputJSON_({ status: 'error', message: 'Loi Server. Vui long thu lai.', build: BUILD_TAG });
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (e2) { } }
  }
}

// =========================================================
// FOLDER HELPERS
// =========================================================
function getOrCreateFolder_(folderName, propKey) {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty(propKey);

  if (existingId) {
    try {
      const folder = DriveApp.getFolderById(existingId);
      if (folder) return folder;
    } catch (e) { }
  }

  const folders = DriveApp.getFoldersByName(folderName);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
  props.setProperty(propKey, folder.getId());
  return folder;
}

function getImagesFolder_() {
  return getOrCreateFolder_(IMAGES_FOLDER, PROP_IMAGES_FOLDER_ID);
}

function getBackupFolder_() {
  return getOrCreateFolder_(BACKUP_FOLDER, PROP_BACKUP_FOLDER_ID);
}

// Kiểm tra 1 file có nằm trong folder BACKUP của app không (chặn đọc/xóa file tùy ý).
function isFileInBackupFolder_(file) {
  try {
    const backupFolderId = getBackupFolder_().getId();
    const parents = file.getParents();
    while (parents.hasNext()) {
      if (parents.next().getId() === backupFolderId) return true;
    }
  } catch (e) { }
  return false;
}

// Làm sạch tên folder do client gửi (tránh ký tự lạ, giữ tương thích tên cũ).
function sanitizeFolderName_(name) {
  let s = String(name || '').trim();
  // Loại bỏ ký tự điều khiển và vài ký tự nguy hiểm cho tên file/đường dẫn.
  s = s.replace(/[\/\\\r\n\t\x00-\x1F]/g, ' ').trim();
  if (s.length > 120) s = s.substring(0, 120);
  return s;
}

// =========================================================
// IMAGE UPLOAD - Hồ sơ khách hàng / Tài sản
// =========================================================
function handleUploadImages_(data) {
  const folderName = sanitizeFolderName_(data.folderName || data.folder || '');
  const images = data.images; // Array of {name, base64/data, mimeType}

  if (!folderName) {
    return outputJSON_({ status: 'error', message: 'Thieu ten folder', build: BUILD_TAG });
  }
  if (!images || !Array.isArray(images) || images.length === 0) {
    return outputJSON_({ status: 'error', message: 'Khong co anh de upload', build: BUILD_TAG });
  }
  if (images.length > MAX_IMAGES_PER_REQ) {
    return outputJSON_({ status: 'error', message: 'Qua nhieu anh trong 1 lan (toi da ' + MAX_IMAGES_PER_REQ + ')', build: BUILD_TAG });
  }

  const parentFolder = getImagesFolder_();

  let subFolder;
  const subFolders = parentFolder.getFoldersByName(folderName);
  if (subFolders.hasNext()) subFolder = subFolders.next();
  else subFolder = parentFolder.createFolder(folderName);

  const results = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const imageData = img && (img.data || img.base64);
    if (!img || !imageData) continue;

    try {
      const name = String(img.name || ('image_' + Date.now() + '_' + i + '.jpg')).trim();
      const mimeType = String(img.mimeType || 'image/jpeg');

      let base64Data = String(imageData);
      if (base64Data.indexOf(',') !== -1) base64Data = base64Data.split(',')[1];

      if (base64Data.length > MAX_IMAGE_B64_LEN) {
        results.push({ name: name, error: 'Anh qua lon' });
        continue;
      }

      const bytes = Utilities.base64Decode(base64Data);
      const blob = Utilities.newBlob(bytes, mimeType, name);

      const file = subFolder.createFile(blob);
      // RIÊNG TƯ: KHÔNG đặt ANYONE_WITH_LINK. Đặt PRIVATE tường minh (phòng khi Drive có
      // default sharing khác), chỉ chủ sở hữu xem được. Ảnh nằm trong folder cá nhân, mở bằng
      // tài khoản Google có quyền.
      try { file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (eShare) { }

      results.push({
        name: name,
        id: file.getId(),
        url: file.getUrl()
      });
    } catch (e) {
      results.push({ name: (img && img.name) || 'unknown', error: 'Loi xu ly anh' });
      Logger.log('upload image error: ' + e);
    }
  }

  return outputJSON_({
    status: 'success',
    message: 'Uploaded ' + results.filter(function (r) { return r.id; }).length + ' images',
    folderId: subFolder.getId(),
    // GIỮ NGUYÊN: app đọc result.url sau khi upload ảnh
    url: subFolder.getUrl(),
    folderUrl: subFolder.getUrl(),
    files: results,
    build: BUILD_TAG
  });
}

function handleSearchFolder_(data) {
  const folderName = sanitizeFolderName_(data.folderName || data.folder || '');
  if (!folderName) {
    return outputJSON_({ status: 'error', message: 'Thieu ten folder', build: BUILD_TAG });
  }

  const parentFolder = getImagesFolder_();
  const subFolders = parentFolder.getFoldersByName(folderName);

  if (!subFolders.hasNext()) {
    return outputJSON_({ status: 'not_found', message: 'Khong tim thay folder', build: BUILD_TAG });
  }

  const folder = subFolders.next();
  const files = folder.getFiles();
  const fileList = [];

  while (files.hasNext()) {
    const f = files.next();
    fileList.push({
      name: f.getName(),
      id: f.getId(),
      url: f.getUrl(),
      mimeType: f.getMimeType(),
      size: f.getSize()
    });
  }

  return outputJSON_({
    status: 'found',
    url: folder.getUrl(),
    folderId: folder.getId(),
    folderUrl: folder.getUrl(),
    files: fileList,
    build: BUILD_TAG
  });
}

// =========================================================
// BACKUP / RESTORE - Lưu trữ backup trên Drive cá nhân
// =========================================================
function handleCreateBackup_(data) {
  const content = String(data.encrypted || data.content || data.backup || '');
  let filename = String(data.filename || ('BACKUP_' + formatTimestamp_() + '.cpb')).trim();

  if (!content) {
    return outputJSON_({ status: 'error', message: 'Khong co noi dung backup', build: BUILD_TAG });
  }
  if (content.length > MAX_BACKUP_B64_LEN) {
    return outputJSON_({ status: 'error', message: 'Backup qua lon', build: BUILD_TAG });
  }
  // Ép đuôi .cpb, loại ký tự đường dẫn trong tên.
  filename = filename.replace(/[\/\\\r\n\t\x00-\x1F]/g, '_');
  if (!/\.cpb$/i.test(filename)) filename = (filename.replace(/\.[a-z0-9]+$/i, '') || 'BACKUP') + '.cpb';

  const folder = getBackupFolder_();
  const blob = Utilities.newBlob(content, 'text/plain;charset=utf-8', filename);
  const file = folder.createFile(blob);

  trimBackups_(folder, BACKUP_KEEP_LAST);

  return outputJSON_({
    status: 'success',
    message: 'Backup created',
    fileId: file.getId(),
    filename: filename,
    createdAt: new Date().toISOString(),
    build: BUILD_TAG
  });
}

function handleListBackups_(data) {
  const folder = getBackupFolder_();
  const files = folder.getFiles();
  const list = [];

  while (files.hasNext()) {
    const f = files.next();
    const name = f.getName();
    if (!name.endsWith('.cpb')) continue;

    list.push({
      id: f.getId(),
      filename: name,
      size: f.getSize(),
      createdAt: f.getDateCreated().toISOString()
    });
  }

  list.sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
  return outputJSON_({ status: 'success', backups: list, build: BUILD_TAG });
}

function handleDownloadBackup_(data) {
  const fileId = String(data.fileId || data.id || '').trim();
  if (!fileId) {
    return outputJSON_({ status: 'error', message: 'Thieu fileId', build: BUILD_TAG });
  }

  try {
    const file = DriveApp.getFileById(fileId);
    // Chặn dùng URL này để đọc file tùy ý ngoài folder backup của app.
    if (!isFileInBackupFolder_(file)) {
      return outputJSON_({ status: 'error', message: 'Khong co quyen doc file nay', build: BUILD_TAG });
    }
    const content = file.getBlob().getDataAsString('UTF-8');

    return outputJSON_({
      status: 'success',
      filename: file.getName(),
      encrypted: content,
      size: file.getSize(),
      createdAt: file.getDateCreated().toISOString(),
      build: BUILD_TAG
    });
  } catch (e) {
    Logger.log('download_backup error: ' + e);
    return outputJSON_({ status: 'error', message: 'Khong tim thay file', build: BUILD_TAG });
  }
}

function handleDeleteBackup_(data) {
  const fileId = String(data.fileId || data.id || '').trim();
  if (!fileId) {
    return outputJSON_({ status: 'error', message: 'Thieu fileId', build: BUILD_TAG });
  }

  try {
    const file = DriveApp.getFileById(fileId);
    if (!isFileInBackupFolder_(file)) {
      return outputJSON_({ status: 'error', message: 'Khong co quyen xoa file nay', build: BUILD_TAG });
    }
    file.setTrashed(true);
    return outputJSON_({ status: 'success', message: 'Da xoa', build: BUILD_TAG });
  } catch (e) {
    Logger.log('delete_backup error: ' + e);
    return outputJSON_({ status: 'error', message: 'Khong the xoa', build: BUILD_TAG });
  }
}

// =========================================================
// HELPERS
// =========================================================
function parseRequestData_(e) {
  let data = {};

  if (e && e.parameter) {
    for (var k in e.parameter) data[k] = e.parameter[k];
  }

  if (e && e.postData && e.postData.contents) {
    try {
      var jsonData = JSON.parse(e.postData.contents);
      for (var k2 in jsonData) data[k2] = jsonData[k2];
    } catch (err) {
      // Try form-urlencoded
      try {
        var params = e.postData.contents.split('&');
        for (var i = 0; i < params.length; i++) {
          var eqIndex = params[i].indexOf('=');
          if (eqIndex > 0) {
            var key = params[i].substring(0, eqIndex);
            var val = params[i].substring(eqIndex + 1);
            data[decodeURIComponent(key)] = decodeURIComponent(val.replace(/\+/g, ' '));
          }
        }
      } catch (e2) { }
    }
  }

  return data;
}

function outputJSON_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function formatTimestamp_() {
  return Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyyMMdd_HHmmss');
}

function trimBackups_(folder, keepN) {
  const files = folder.getFiles();
  const list = [];

  while (files.hasNext()) {
    const f = files.next();
    if (!f.getName().endsWith('.cpb')) continue;
    list.push({ file: f, created: f.getDateCreated().getTime() });
  }

  if (list.length <= keepN) return;

  list.sort(function (a, b) { return b.created - a.created; });
  for (var i = keepN; i < list.length; i++) {
    list[i].file.setTrashed(true);
  }
}

// =========================================================
// SETUP - Chạy 1 lần sau khi deploy
// =========================================================
function setupFolders() {
  getImagesFolder_();
  getBackupFolder_();
  Logger.log('Folders created: ' + IMAGES_FOLDER + ', ' + BACKUP_FOLDER);
}

// =========================================================
// MAINTENANCE - Thu hồi quyền công khai của ẢNH CŨ (chạy 1 lần)
// ---------------------------------------------------------
// Các bản trước đặt ANYONE_WITH_LINK cho từng file ảnh. Sau khi deploy bản này,
// mở Apps Script editor -> chọn hàm revokePublicSharing -> Run một lần để bỏ công khai
// toàn bộ ảnh đã upload trước đó trong CLIENTPRO_IMAGES (kể cả trong mọi subfolder).
// An toàn để chạy lại nhiều lần (idempotent).
// =========================================================
function revokePublicSharing() {
  const root = getImagesFolder_();
  const stats = { files: 0, revoked: 0, errors: 0 };
  revokeFolderTree_(root, stats);
  Logger.log('revokePublicSharing done. Files seen: ' + stats.files +
    ', set PRIVATE: ' + stats.revoked + ', errors: ' + stats.errors);
  return stats;
}

// Duyệt đệ quy 1 folder: đặt PRIVATE cho mọi file, rồi đi vào từng subfolder.
function revokeFolderTree_(folder, stats) {
  try {
    const files = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      stats.files++;
      try {
        f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
        stats.revoked++;
      } catch (eFile) {
        stats.errors++;
        Logger.log('revoke file error [' + f.getId() + ']: ' + eFile);
      }
    }
  } catch (eList) {
    Logger.log('revoke list files error: ' + eList);
  }

  try {
    const subs = folder.getFolders();
    while (subs.hasNext()) {
      revokeFolderTree_(subs.next(), stats);
    }
  } catch (eSub) {
    Logger.log('revoke list subfolders error: ' + eSub);
  }
}

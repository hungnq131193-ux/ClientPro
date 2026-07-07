// =========================================================
// CLIENTPRO USER GAS - PERSONAL DRIVE
// v3 - BẮT BUỘC Access Token (fail-closed)
// Chức năng: Upload ảnh + Backup/Restore lên Drive cá nhân
//
// THAY ĐỔI BẢO MẬT CHÍNH SO VỚI v2:
//   - ACCESS_TOKEN KHÔNG còn mặc định "mở". Server nay BẮT BUỘC token cho MỌI action
//     (trừ 'ping' để test kết nối). Thiếu/sai token -> 'Unauthorized'.
//   - Token đọc từ Script Properties (KHÔNG hardcode). Chạy setupToken() một lần để
//     sinh token ngẫu nhiên mạnh, rồi dán token đó vào ô "Mã bảo mật" trong app.
//   - FAIL-CLOSED: nếu CHƯA cấu hình token thì TỪ CHỐI tất cả (không rơi về chế độ mở).
//   - So khớp token bằng hàm hằng-thời-gian (constantTimeEquals_) tránh rò rỉ qua timing.
//
// GIỮ NGUYÊN so với v2 (tương thích app):
//   - Mọi action, alias field, và response mà app đang đọc (url/folderUrl/encrypted...).
//   - Ảnh PRIVATE, download/delete chỉ trong folder BACKUP của app, giới hạn kích thước,
//     lock cho action ghi, không lộ exception thô.
//
// SETUP SAU KHI DÁN CODE:
//   1. Chạy setupToken() một lần -> xem Logs (Ctrl+Enter) để copy token.
//   2. Dán token vào app: Cài đặt Google Drive -> ô "Mã bảo mật (Access Token)".
//   3. (Tùy chọn, lần đầu) chạy setupFolders() và revokePublicSharing() như v2.
// =========================================================
const BUILD_TAG = 'CLIENTPRO_USER_GAS_2026-07-04_v3_token';

// =======================
// CONFIG - Folder names
// =======================
const IMAGES_FOLDER = 'CLIENTPRO_IMAGES';
const BACKUP_FOLDER = 'CLIENTPRO_BACKUPS';
const BACKUP_KEEP_LAST = 5; // Giữ 5 bản backup gần nhất

// ScriptProperties keys
const PROP_IMAGES_FOLDER_ID = 'CLIENTPRO_IMAGES_FOLDER_ID';
const PROP_BACKUP_FOLDER_ID = 'CLIENTPRO_BACKUP_FOLDER_ID';
const PROP_ACCESS_TOKEN = 'CLIENTPRO_USER_ACCESS_TOKEN';

// --- SECURITY / LIMITS ---
// (Tùy chọn) Có thể hardcode token vào đây thay vì Script Properties. Để RỖNG để dùng
// token sinh bởi setupToken() (khuyến nghị). Dù đặt cách nào, token vẫn BẮT BUỘC.
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

  // ping không cần token để test kết nối (không lộ dữ liệu).
  if (action === 'ping') {
    return outputJSON_({ status: 'success', message: 'User GAS Connected', build: BUILD_TAG });
  }

  // BẮT BUỘC token (fail-closed) cho mọi action còn lại.
  const configuredToken = getAccessToken_();
  if (!configuredToken) {
    Logger.log('ACCESS_TOKEN chua cau hinh. Chay setupToken() mot lan.');
    return outputJSON_({ status: 'error', message: 'Server chua cau hinh bao mat (ACCESS_TOKEN). Lien he admin.', build: BUILD_TAG });
  }
  const providedToken = String(data.token || data.access_token || '').trim();
  if (!constantTimeEquals_(providedToken, configuredToken)) {
    return outputJSON_({ status: 'error', message: 'Unauthorized', build: BUILD_TAG });
  }

  // debug_echo (đã qua cửa token). Không trả nội dung nhạy cảm.
  if (action === 'debug_echo') {
    const safe = {};
    for (const k in data) {
      if (k === 'images' || k === 'encrypted' || k === 'content' || k === 'backup' || k === 'token' || k === 'access_token') { safe[k] = '[omitted]'; continue; }
      safe[k] = data[k];
    }
    return outputJSON_({ status: 'success', build: BUILD_TAG, data: safe, action_received: action });
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
// TOKEN HELPERS
// =========================================================
// Token cấu hình: ưu tiên Script Properties, fallback hằng ACCESS_TOKEN nếu bạn hardcode.
function getAccessToken_() {
  let t = '';
  try { t = PropertiesService.getScriptProperties().getProperty(PROP_ACCESS_TOKEN) || ''; } catch (e) { t = ''; }
  t = String(t || '').trim();
  if (!t) t = String(ACCESS_TOKEN || '').trim();
  return t;
}

// So khớp chuỗi hằng-thời-gian: duyệt hết, không thoát sớm theo nội dung.
function constantTimeEquals_(a, b) {
  a = String(a == null ? '' : a);
  b = String(b == null ? '' : b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  return diff === 0;
}

// Chạy 1 lần: sinh token ngẫu nhiên mạnh và lưu vào Script Properties.
// Mở Executions/Logs để copy token rồi dán vào app.
function setupToken() {
  const props = PropertiesService.getScriptProperties();
  let tok = props.getProperty(PROP_ACCESS_TOKEN);
  if (!tok) {
    tok = 'clp_' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty(PROP_ACCESS_TOKEN, tok);
  }
  Logger.log('ACCESS TOKEN (dan vao o "Ma bao mat" trong app):\n' + tok);
  return tok;
}

// Đặt lại token mới (thu hồi token cũ). Sau khi chạy phải cập nhật lại token trong app.
function resetToken() {
  const props = PropertiesService.getScriptProperties();
  const tok = 'clp_' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  props.setProperty(PROP_ACCESS_TOKEN, tok);
  Logger.log('ACCESS TOKEN MOI (cap nhat lai trong app):\n' + tok);
  return tok;
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

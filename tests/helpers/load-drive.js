'use strict';

// ============================================================================
// load-drive.js — Nạp assets/07_drive.js NGUYÊN BẢN vào sandbox Node (không sửa
// một dòng code nghiệp vụ) để test hành vi THẬT của tầng phân loại kết quả
// upload Drive: _resolveImagesForUpload / _postDriveUpload /
// _classifyUploadResult / _runDriveImageUpload.
//
// Cùng khuôn với tests/helpers/load-images.js và load-auto-backup.js: module
// viết kiểu "browser globals" nên ta dựng đủ global nó chạm tới rồi
// runInContext. Các hàm khai báo ở top-level nằm sẵn trên context sau khi chạy;
// riêng `const` top-level KHÔNG thành thuộc tính của context nên ta chạy thêm
// một epilogue để lộ giá trị các hằng phán quyết ra ngoài.
//
// Phụ thuộc ngoài file được stub theo ĐÚNG ngữ nghĩa production:
//  - decryptImageData (02_security.js) FAIL-OPEN: mất masterKey thì trả nguyên
//    ciphertext. Test dựa vào đúng tính chất này.
//  - _looksEncrypted (00_globals.js) là nguồn nhận diện ciphertext duy nhất.
//
// Zero-dependency: chỉ node:vm + node:fs.
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const GCM_PREFIX = 'cpg1:';

/** Response giả tối thiểu (fetch trả về): ok/status + text() một lần. */
function makeResponse({ body = '', ok = true, status = 200, textThrows = false } = {}) {
  return {
    ok,
    status,
    async text() {
      if (textThrows) throw new Error('body đứt giữa chừng');
      return body;
    },
    async json() {
      return JSON.parse(body);
    },
  };
}

/** Deferred nhỏ: test await được thời điểm callback getAll (async) chạy xong. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

/**
 * IndexedDB giả cho store 'images': index('customerId').getAll trả ảnh dựng sẵn,
 * và ghi lại MỌI id bị delete để test chứng minh "không xóa ảnh nào" chứ không
 * chỉ "không báo thành công".
 */
function makeFakeImagesDb(images, deleted, uploadDone) {
  return {
    transaction() {
      const tx = {
        objectStore() {
          return {
            delete(id) { deleted.push(id); return {}; },
            index() {
              return {
                getAll() {
                  const req = {};
                  setImmediate(() => {
                    if (typeof req.onsuccess !== 'function') return;
                    // Handler là async: giữ promise của nó để test await được
                    // trọn vẹn luồng upload.
                    uploadDone.resolve(
                      Promise.resolve(req.onsuccess({ target: { result: images } }))
                        .catch((e) => { throw e; })
                    );
                  });
                  return req;
                },
              };
            },
          };
        },
      };
      setImmediate(() => { if (typeof tx.oncomplete === 'function') tx.oncomplete(); });
      return tx;
    },
  };
}

/**
 * Nạp 07_drive.js và trả về sandbox test.
 *
 * @param {object}   [opts]
 * @param {boolean}  [opts.unlocked=true]     - isAppUnlocked() trả về gì.
 * @param {string}   [opts.decryptMode='gcm'] - 'gcm'    : giải mã thật (bỏ tiền tố),
 *                                              'stuck'  : fail-open, trả nguyên ciphertext,
 *                                              'absent' : decryptImageData không tồn tại.
 * @param {Function} [opts.fetchImpl]         - fetch giả (mặc định: ném lỗi mạng).
 * @param {Array}    [opts.images=[]]         - ảnh trong IndexedDB của khách hiện tại.
 * @param {boolean}  [opts.persistOk=true]    - persistCurrentCustomer thành công hay không.
 * @param {boolean}  [opts.confirm=true]      - người dùng bấm đồng ý ở mọi confirm.
 * @param {string}   [opts.assetId=null]      - currentAssetId (đường tài sản).
 */
function loadDrive(opts) {
  const options = opts || {};
  const fetchCalls = [];
  const deleted = [];
  const toasts = [];
  const uploadDone = deferred();
  const images = options.images || [];

  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Math, Date, Promise, String, Number, Boolean, Object, Array, Error, Map, Set,
    setTimeout: (fn) => { if (typeof fn === 'function') setImmediate(fn); return 0; },
    clearTimeout: () => {},

    document: {
      addEventListener() {},
      getElementById: () => null,
    },
    localStorage: {
      _data: new Map(),
      getItem(k) { return this._data.has(k) ? this._data.get(k) : null; },
      setItem(k, v) { this._data.set(k, String(v)); },
      removeItem(k) { this._data.delete(k); },
    },
    fetch: async (url, init) => {
      fetchCalls.push({ url, init });
      if (typeof options.fetchImpl === 'function') return options.fetchImpl(url, init);
      throw new Error('Network request failed');
    },

    // --- 01_config.js ---
    USER_SCRIPT_KEY: 'app_user_script_url',
    USER_TOKEN_KEY: 'app_user_script_token',

    // --- 00_globals.js ---
    getEl: () => null,
    _looksEncrypted: (v) =>
      typeof v === 'string' && (v.startsWith('U2FsdGVk') || v.startsWith(GCM_PREFIX)),
    _displayPlain: (v) => v,
    _displayPlainAsync: async (v) => v,
    escapeHTML: (s) => String(s),
    isSafeDriveUrl: (u) => typeof u === 'string' && u.startsWith('https://'),

    // --- 02_security.js ---
    masterKey: 'k',
    isAppUnlocked: () => (options.unlocked === undefined ? true : !!options.unlocked),
    encryptText: async (v) => GCM_PREFIX + v,
    decryptText: (v) => v,
    // FAIL-OPEN đúng như production: mất masterKey thì trả nguyên ciphertext.
    decryptImageData: async (v) => {
      const mode = options.decryptMode || 'gcm';
      if (mode === 'stuck') return v;
      return (typeof v === 'string' && v.startsWith(GCM_PREFIX)) ? v.slice(GCM_PREFIX.length) : v;
    },

    // --- 19_error_loading.js ---
    ErrorHandler: {
      logError() {},
      showError(code, msg, tech) { toasts.push({ kind: 'error', code, msg, tech }); },
      showSuccess(msg) { toasts.push({ kind: 'success', msg }); },
      showWarning(msg) { toasts.push({ kind: 'warning', msg }); },
      confirm: async () => (options.confirm === undefined ? true : !!options.confirm),
    },
    LoadingManager: { showGlobal() {}, hideGlobal() {}, showButtonLoading() {}, hideButtonLoading() {} },

    // --- 04_ui_common.js / 05_customers.js: trạng thái hồ sơ đang mở ---
    currentCustomerId: 'c1',
    currentAssetId: options.assetId === undefined ? null : options.assetId,
    currentCustomerData: {
      id: 'c1',
      name: 'Nguyen Van A',
      phone: '0900000000',
      cccd: '012345678901',
      driveLink: '',
      assets: [{ id: 'a1', name: 'Nha dat 50m2', driveLink: '' }],
    },
    persistCurrentCustomer(mutate, cb) {
      const ok = options.persistOk === undefined ? true : !!options.persistOk;
      if (ok && typeof mutate === 'function') mutate(ctxRecord);
      setImmediate(() => cb(ok));
    },
    loadProfileImages() {},
    loadAssetImages() {},
  };

  // Bản ghi "trong DB" mà persistCurrentCustomer ghi vào — test đối chiếu link
  // đã thực sự được lưu hay chưa.
  const ctxRecord = { id: 'c1', driveLink: '', assets: null };
  ctx.db = makeFakeImagesDb(images, deleted, uploadDone);

  if ((options.decryptMode || 'gcm') === 'absent') delete ctx.decryptImageData;

  ctx.globalThis = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);

  const src = fs.readFileSync(path.join(ROOT, 'assets', '07_drive.js'), 'utf8');
  vm.runInContext(src, ctx, { filename: 'assets/07_drive.js' });

  // `const` top-level sống trong global lexical scope của context, không thành
  // thuộc tính của ctx — lộ ra qua epilogue để test đối chiếu bằng hằng THẬT.
  vm.runInContext(
    'globalThis.__VERDICT = { OK: DRIVE_UPLOAD_OK, PARTIAL: DRIVE_UPLOAD_PARTIAL,' +
    ' UNCONFIRMED: DRIVE_UPLOAD_UNCONFIRMED, REJECTED: DRIVE_UPLOAD_REJECTED };',
    ctx
  );

  // Link Script cá nhân đã cấu hình — nếu thiếu, 2 hàm upload dừng ở bước hỏi
  // cấu hình và không chạm tới tầng phán quyết.
  ctx.localStorage.setItem(ctx.USER_SCRIPT_KEY, 'https://script.google.com/macros/s/abc/exec');

  return {
    ctx,
    VERDICT: ctx.__VERDICT,
    fetchCalls,
    /** id ảnh gốc đã bị xóa khỏi IndexedDB. */
    deleted,
    /** Toast đã hiện cho người dùng (kind: error | warning | success). */
    toasts,
    /** Bản ghi khách hàng "trong DB" sau persistCurrentCustomer. */
    record: ctxRecord,
    /** Chạy trọn một lượt upload (callback getAll là async). */
    async runUploadFlow(which) {
      if (which === 'asset') ctx.uploadAssetToDrive();
      else ctx.uploadToGoogleDrive();
      await uploadDone.promise;
    },
    resolveImages: (...a) => ctx._resolveImagesForUpload(...a),
    postUpload: (...a) => ctx._postDriveUpload(...a),
    classify: (...a) => ctx._classifyUploadResult(...a),
    runUpload: (...a) => ctx._runDriveImageUpload(...a),
    unconfirmedMessage: (...a) => ctx._unconfirmedUploadMessage(...a),
  };
}

module.exports = { loadDrive, makeResponse, GCM_PREFIX };

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

/**
 * Nạp 07_drive.js và trả về sandbox test.
 *
 * @param {object}   [opts]
 * @param {boolean}  [opts.unlocked=true]     - isAppUnlocked() trả về gì.
 * @param {string}   [opts.decryptMode='gcm'] - 'gcm'    : giải mã thật (bỏ tiền tố),
 *                                              'stuck'  : fail-open, trả nguyên ciphertext,
 *                                              'absent' : decryptImageData không tồn tại.
 * @param {Function} [opts.fetchImpl]         - fetch giả (mặc định: ném lỗi mạng).
 */
function loadDrive(opts) {
  const options = opts || {};
  const fetchCalls = [];

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
      logError() {}, showError() {}, showSuccess() {}, showWarning() {},
      confirm: async () => true,
    },
    LoadingManager: { showGlobal() {}, hideGlobal() {}, showButtonLoading() {}, hideButtonLoading() {} },
  };

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

  return {
    ctx,
    VERDICT: ctx.__VERDICT,
    fetchCalls,
    resolveImages: (...a) => ctx._resolveImagesForUpload(...a),
    postUpload: (...a) => ctx._postDriveUpload(...a),
    classify: (...a) => ctx._classifyUploadResult(...a),
    runUpload: (...a) => ctx._runDriveImageUpload(...a),
    unconfirmedMessage: (...a) => ctx._unconfirmedUploadMessage(...a),
  };
}

module.exports = { loadDrive, makeResponse, GCM_PREFIX };

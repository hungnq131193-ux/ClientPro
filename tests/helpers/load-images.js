'use strict';

// ============================================================================
// load-images.js — Nạp assets/08_images_camera.js NGUYÊN BẢN vào sandbox Node
// (không sửa một dòng code nghiệp vụ) để test hành vi THẬT của saveImageToDB /
// handleFileUpload.
//
// Cùng khuôn với tests/helpers/load-auto-backup.js: module viết kiểu "browser
// globals" nên ta dựng đủ global nó chạm tới rồi runInContext. File này khai báo
// hàm ở phạm vi top-level (không IIFE, không export) nên các hàm nằm sẵn trên
// context sau khi chạy — không cần epilogue.
//
// Các phụ thuộc bên ngoài file được stub theo ĐÚNG ngữ nghĩa production:
//  - encryptImageData (02_security.js) FAIL-OPEN: mất masterKey thì trả nguyên
//    data URL plaintext. Test dựa vào đúng tính chất này.
//  - _looksEncrypted (00_globals.js) là nguồn nhận diện ciphertext duy nhất.
//
// Zero-dependency: chỉ node:vm + node:fs.
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const GCM_PREFIX = 'cpg1:';

// Chuỗi data URL giả có kích thước rơi ĐÚNG vào dải mục tiêu 500–700 KB của
// compressImage, để vòng chỉnh chất lượng chốt ngay vòng đầu (test tất định).
const FAKE_JPEG_LEN = 800000; // -> sizeBytes ~ 600 KB

/** Element giả tối thiểu: đủ cho classList / textContent / dataset mà file dùng. */
function makeEl(id) {
  const classes = new Set(['hidden', 'translate-x-full']);
  return {
    width: 0,
    height: 0,
    getContext: () => ({ filter: '', drawImage() {} }),
    toDataURL: () => 'data:image/jpeg;base64,' + 'A'.repeat(FAKE_JPEG_LEN),
    id,
    textContent: '',
    dataset: {},
    innerHTML: '',
    style: {},
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !classes.has(c) : !!force;
        if (on) classes.add(c); else classes.delete(c);
        return on;
      },
    },
    appendChild() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
}

/**
 * IndexedDB giả: ghi lại MỌI bản ghi được add vào store 'images' để test chứng
 * minh "không có gì được ghi" chứ không chỉ "không báo thành công".
 */
function makeFakeImagesDb(added) {
  return {
    transaction() {
      const tx = {
        objectStore() {
          return {
            add(rec) {
              added.push(rec);
              return {};
            },
            // Đường refresh gallery sau khi lưu (loadProfileImages) đọc qua index.
            index() {
              return {
                getAll() {
                  const req = {};
                  setImmediate(() => {
                    if (typeof req.onsuccess === 'function') {
                      req.onsuccess({ target: { result: [] } });
                    }
                  });
                  return req;
                },
              };
            },
          };
        },
      };
      // Transaction commit ở tick sau, giống IndexedDB thật.
      setImmediate(() => { if (typeof tx.oncomplete === 'function') tx.oncomplete(); });
      return tx;
    },
  };
}

/**
 * Nạp 08_images_camera.js và trả về sandbox test.
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.unlocked=true]        - isAppUnlocked() trả về gì.
 * @param {string}  [opts.encryptMode='gcm']    - 'gcm'   : mã hóa thật (thêm tiền tố),
 *                                                'plain' : fail-open trả nguyên input,
 *                                                'throw' : ném lỗi,
 *                                                'absent': encryptImageData không tồn tại.
 * @param {string}  [opts.customerId='c1']      - currentCustomerId ban đầu.
 * @param {string}  [opts.assetId=null]         - currentAssetId ban đầu.
 */
function loadImages(opts) {
  const options = opts || {};
  const added = [];
  const errors = [];
  const els = new Map();

  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Math, Date, Promise, String, Number, Boolean, Object, Array, Error,
    Map, Set, ArrayBuffer, Uint8Array,
    setTimeout: (fn) => { if (typeof fn === 'function') setImmediate(fn); return 0; },
    clearTimeout: () => {},
    setImmediate,
    requestAnimationFrame: (fn) => { setImmediate(fn); return 0; },
    document: {
      getElementById: (id) => {
        if (!els.has(id)) els.set(id, makeEl(id));
        return els.get(id);
      },
      createElement: () => makeEl('created'),
      createDocumentFragment: () => makeEl('frag'),
      addEventListener() {},
      body: makeEl('body'),
      querySelectorAll: () => [],
    },
    window: { addEventListener() {} },
    navigator: {},
    // <img> giả: gán .src thì onload nổ ở tick sau, đủ cho compressImage chạy
    // thật (canvas giả ở makeEl trả về data URL nằm trong dải mục tiêu).
    Image: class FakeImage {
      constructor() { this.width = 1200; this.height = 900; this._src = ''; }
      set src(v) { this._src = v; setImmediate(() => { if (this.onload) this.onload(); }); }
      get src() { return this._src; }
    },
    FileReader: class FakeFileReader {
      readAsDataURL(file) {
        setImmediate(() => {
          if (this.onload) this.onload({ target: { result: file && file._data } });
        });
      }
    },

    // --- 00_globals.js ---
    getEl: (id) => ctx.document.getElementById(id),
    _looksEncrypted: (v) =>
      typeof v === 'string' && (v.startsWith('U2FsdGVk') || v.startsWith(GCM_PREFIX)),

    // --- 02_security.js ---
    isAppUnlocked: () => (options.unlocked === undefined ? true : !!options.unlocked),
    // FAIL-OPEN đúng như production: không có masterKey thì trả nguyên plaintext.
    encryptImageData: async (data) => {
      const mode = options.encryptMode || 'gcm';
      if (mode === 'throw') throw new Error('WebCrypto lỗi giả lập');
      if (mode === 'plain') return data;
      return GCM_PREFIX + data;
    },
    decryptImageData: async (v) =>
      (typeof v === 'string' && v.startsWith(GCM_PREFIX) ? v.slice(GCM_PREFIX.length) : v),
    decryptFieldAsync: async (v) => v,

    // --- 19_error_loading.js ---
    ErrorHandler: {
      logError() {},
      showError(code, msg, tech) { errors.push({ code, msg, tech }); },
      showSuccess() {},
      showWarning(msg) { errors.push({ code: 'WARN', msg }); },
      confirm: async () => true,
    },
    LoadingManager: {
      showGlobal() {}, hideGlobal() {}, showEmptyState() {},
    },

    // --- 04_ui_common.js: trạng thái đối tượng đang mở ---
    currentCustomerId: options.customerId === undefined ? 'c1' : options.customerId,
    currentAssetId: options.assetId === undefined ? null : options.assetId,
    currentLightboxList: [],
    currentImageId: null,
    currentImageBase64: null,
    captureMode: 'profile',
    isSelectionMode: false,
    selectedImages: new Set(),
    stream: null,
    openLightbox() {},
    bindLongPress() {},
    isSafeImageUrl: () => true,

    // --- 10_bootstrap.js ---
    db: makeFakeImagesDb(added),
  };

  if ((options.encryptMode || 'gcm') === 'absent') delete ctx.encryptImageData;

  ctx.globalThis = ctx;
  ctx.window.ErrorHandler = ctx.ErrorHandler;
  vm.createContext(ctx);

  const src = fs.readFileSync(path.join(ROOT, 'assets', '08_images_camera.js'), 'utf8');
  vm.runInContext(src, ctx, { filename: 'assets/08_images_camera.js' });

  return {
    ctx,
    /** Bản ghi thực sự được add vào store 'images'. */
    added,
    /** Lỗi/cảnh báo đã hiện cho người dùng. */
    errors,
    saveImageToDB: (...args) => ctx.saveImageToDB(...args),
    handleFileUpload: (...args) => ctx.handleFileUpload(...args),
  };
}

module.exports = { loadImages, GCM_PREFIX };

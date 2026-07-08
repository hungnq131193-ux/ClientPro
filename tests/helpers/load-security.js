'use strict';

// ============================================================================
// load-security.js — Nạp assets/02_security.js NGUYÊN BẢN vào một sandbox Node
// (không sửa 1 dòng code nghiệp vụ nào) để test các hàm crypto THẬT của app.
//
// Vì sao dùng vm thay vì require trực tiếp?
//  - 02_security.js viết theo kiểu "browser globals" (không export), phụ thuộc
//    CryptoJS + WebCrypto + localStorage + vài biến cấu hình.
//  - Ta dựng một sandbox có đủ các global đó rồi runInContext để chạy CHÍNH XÁC
//    code production. `masterKey` là `let` ở phạm vi file nên ta nối thêm một
//    "epilogue" vào cùng script để phơi ra setter/getter và các hàm cần test.
//
// Zero-dependency: chỉ dùng node:vm, node:crypto (WebCrypto) và crypto-js.min.js
// có sẵn trong assets/vendor/. Không cần npm install, không phá versioning.
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const CryptoJS = require(path.join(ROOT, 'assets', 'vendor', 'crypto-js.min.js'));

/** localStorage giả lập tối thiểu, đủ cho các hàm trong 02_security.js. */
function makeLocalStorage() {
  const store = Object.create(null);
  return {
    _store: store,
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
}

/**
 * Nạp 02_security.js và trả về API test.
 * @returns {{ api: object, localStorage: object, ctx: object }}
 */
function loadSecurity() {
  const localStorage = makeLocalStorage();

  // Stub tối thiểu cho các global chỉ được dùng KHI GỌI (không phải lúc load).
  const noop = () => {};
  const errorHandlerStub = {
    showError: noop, showSuccess: noop, showWarning: noop, showInfo: noop,
    confirm: async () => false, logError: noop,
  };

  const ctx = {
    CryptoJS,
    crypto: webcrypto,
    console,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Uint32Array,
    ArrayBuffer,
    Error,
    Number,
    String,
    Boolean,
    Object,
    Array,
    JSON,
    Math,
    Date,
    Promise,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    localStorage,
    navigator: { onLine: true, userAgent: 'node-test' },
    // Cấu hình bình thường nằm ở 00_globals.js / 01_config.js — chỉ cung cấp
    // đúng những hằng mà 02_security.js tham chiếu khi chạy.
    ADMIN_SERVER_URL: '',
    PIN_KEY: 'app_pin',
    SEC_KEY: 'app_sec_qa',
    THEME_KEY: 'app_theme',
    EMPLOYEE_KEY: 'app_employee_id',
    ACTIVATED_KEY: 'app_activated',
    DB_NAME: 'QLKH_Pro_V4',
    getEl: () => null,
    document: { getElementById: () => null, body: {}, querySelectorAll: () => [] },
    ErrorHandler: errorHandlerStub,
    window: { ErrorHandler: errorHandlerStub },
    setInterval: () => 0,
    clearInterval: noop,
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
    fetch: async () => { throw new Error('network disabled in tests'); },
  };
  ctx.window.location = { href: 'https://client-pro-beryl.vercel.app/' };
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  const src = fs.readFileSync(
    path.join(ROOT, 'assets', '02_security.js'),
    'utf8'
  );

  // Epilogue chạy trong CÙNG phạm vi từ vựng với `let masterKey`, nên đọc/ghi
  // được masterKey và tham chiếu mọi hàm/hằng khai báo ở đầu file.
  const epilogue = `
    globalThis.__api = {
      setMasterKey: (k) => { masterKey = k; },
      getMasterKey: () => masterKey,
      encryptText,
      decryptText,
      generateMasterKey,
      encryptBackupPayload,
      decryptBackupPayload,
      sealMasterKey,
      openMasterKeyV2,
      openMasterKeyLegacy,
      unwrapMasterKeyAny,
      decryptCustomerObject,
      decryptCustomerSummary,
      hashString,
      escapeHTML,
      isSafeImageUrl,
      isSafeDriveUrl,
      parseV2Envelope,
    };
  `;

  vm.runInContext(src + '\n' + epilogue, ctx, { filename: 'assets/02_security.js' });
  return { api: ctx.__api, localStorage, ctx };
}

/** base64url 32 byte ngẫu nhiên — mô phỏng KDATA do GAS cấp cho backup. */
function randomKdataB64u() {
  return Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}

module.exports = { loadSecurity, randomKdataB64u, CryptoJS };

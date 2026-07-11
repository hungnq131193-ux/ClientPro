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
    USER_TOKEN_KEY: 'app_user_script_token',
    DB_NAME: 'QLKH_Pro_V4',
    db: null,                 // gán qua api.setDb(makeFakeDb(...)) khi test migration/prime
    queueMicrotask: (fn) => Promise.resolve().then(fn),
    getEl: () => null,
    document: { getElementById: () => null, body: {}, querySelector: () => null, querySelectorAll: () => [] },
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
      // Cài masterKey mới (MK2) — ASYNC (dựng AES-GCM CryptoKey qua _installMasterKey).
      setMasterKey: async (k) => { await _installMasterKey(k); },
      // Cài masterKey legacy "mk_..." (đọc/migrate dữ liệu CryptoJS cũ).
      setLegacyMasterKey: (k) => { masterKey = k; masterKeyLegacy = k; masterCryptoKey = null; masterKeyBytes = null; },
      getMasterKey: () => masterKey,
      getState: () => ({ mk: masterKey, legacy: masterKeyLegacy, hasGcmKey: !!masterCryptoKey }),
      setDb: (d) => { db = d; },
      getDb: () => db,
      encryptText,               // ASYNC nay (AES-GCM)
      decryptText,               // đồng bộ (đọc cache / legacy CryptoJS)
      decryptFieldAsync,
      encryptImageData,
      decryptImageData,
      runImageCryptoMigrationIfNeeded,
      generateMasterKey,
      _installMasterKey,
      clearMasterKeyMaterial,
      lockApp,
      isAppUnlocked,
      _gcmEncryptField,
      _gcmDecryptField,
      primeFieldCache,
      resetFieldCache: () => __fieldPlainCache.clear(),
      runFieldCryptoMigrationIfNeeded,
      _reencryptRecord,
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
      // B4: migration mã hóa creditLimit + asset.name
      runFieldEncryptMigrationV2IfNeeded,
      // B3: sealed KDATA cache
      _readCachedKdataAsync,
      _writeCachedKdata,
      _flushPendingKdataCache,
      getKdataRam: () => APP_BACKUP_KDATA_B64U,
      setKdataRam: (v) => { APP_BACKUP_KDATA_B64U = v; },
      getPendingKdata: () => __pendingKdataCache,
      ensureBackupSecret,
      completeUnlockDataLoad,
    };
  `;

  vm.runInContext(src + '\n' + epilogue, ctx, { filename: 'assets/02_security.js' });
  return { api: ctx.__api, localStorage, ctx };
}

/**
 * Nạp assets/12_backup_core.js NGUYÊN BẢN vào CÙNG sandbox đã loadSecurity()
 * (dùng chung masterKey + __fieldPlainCache thật) — trả về window.BackupCore.
 * 12_backup_core.js tham chiếu _looksEncrypted (nguồn thật ở 00_globals.js —
 * file DOM-heavy không nạp được vào vm) nên sandbox cấp bản sao 2 dòng tương đương.
 * @param {object} ctx - ctx trả về từ loadSecurity()
 */
function loadBackupCore(ctx) {
  if (typeof ctx._looksEncrypted !== 'function') {
    ctx._looksEncrypted = (v) => (typeof v === 'string') && (v.startsWith('U2FsdGVk') || v.startsWith('cpg1:'));
  }
  const src = fs.readFileSync(path.join(ROOT, 'assets', '12_backup_core.js'), 'utf8');
  vm.runInContext(src, ctx, { filename: 'assets/12_backup_core.js' });
  return ctx.window.BackupCore;
}

/** base64url 32 byte ngẫu nhiên — mô phỏng KDATA do GAS cấp cho backup. */
function randomKdataB64u() {
  return Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}

/**
 * IndexedDB in-memory tối thiểu (zero-dependency) đủ cho migration + primeFieldCache:
 * hỗ trợ transaction().objectStore(name).get/getAll/getAllKeys/put/delete.
 * Callback request kích hoạt qua microtask (sau khi caller gán onsuccess/onerror).
 */
function makeFakeDb(customers = [], images = []) {
  const stores = { customers: new Map(), images: new Map() };
  for (const c of customers) stores.customers.set(c.id, c);
  for (const im of images) stores.images.set(im.id, im);

  return {
    _stores: stores,
    objectStoreNames: { contains: (n) => n in stores },
    // Mỗi transaction() trả một tx object hỗ trợ oncomplete/onerror/onabort
    // (như IDB thật): oncomplete bắn qua microtask khi mọi request đã settle;
    // request lỗi -> tx.onerror. Additive — test cũ chỉ dùng request.onsuccess
    // vẫn chạy nguyên.
    transaction: function transaction() {
      const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
      let pending = 0;
      let failed = false;
      let finished = false;
      function settle() {
        if (finished || pending > 0) return;
        // Chờ thêm 1 microtask: callback onsuccess có thể enqueue request mới
        // (pattern getAllKeys().onsuccess -> delete từng key giữ tx sống).
        Promise.resolve().then(() => {
          if (finished || pending > 0) return;
          finished = true;
          if (failed) { if (tx.onerror) tx.onerror({ target: tx }); }
          else if (tx.oncomplete) tx.oncomplete({ target: tx });
        });
      }
      function makeReq(compute) {
        const r = { onsuccess: null, onerror: null, result: undefined, error: null };
        pending++;
        Promise.resolve().then(() => {
          try {
            r.result = compute();        // real IDB đặt cả request.result LẪN event.target.result
            if (r.onsuccess) r.onsuccess({ target: r });
          } catch (e) {
            r.error = e;
            tx.error = e;
            failed = true;
            if (r.onerror) r.onerror({ target: r });
          } finally {
            pending--;
            settle();
          }
        });
        return r;
      }
      function objectStore(name) {
        const m = stores[name];
        return {
          get: (k) => makeReq(() => m.get(k)),
          getAll: () => makeReq(() => [...m.values()]),
          getAllKeys: () => makeReq(() => [...m.keys()]),
          put: (v) => makeReq(() => { m.set(v.id, v); return v.id; }),
          delete: (k) => makeReq(() => { m.delete(k); return undefined; }),
        };
      }
      tx.objectStore = objectStore;
      // Transaction rỗng (không request nào) vẫn complete như IDB thật.
      Promise.resolve().then(settle);
      return tx;
    },
  };
}

module.exports = { loadSecurity, loadBackupCore, randomKdataB64u, makeFakeDb, CryptoJS };

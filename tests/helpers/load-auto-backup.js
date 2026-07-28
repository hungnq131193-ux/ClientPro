'use strict';

// ============================================================================
// load-auto-backup.js — Nạp assets/16_auto_backup_drive.js NGUYÊN BẢN vào sandbox
// Node (không sửa một dòng code nghiệp vụ) để test chống-trùng bản sao lưu THẬT.
//
// Cùng khuôn với tests/helpers/load-auth-gate.js: module viết kiểu IIFE "browser
// globals" nên ta dựng đủ global nó chạm tới rồi runInContext, sau đó lấy
// window.DriveBackup mà chính module tự expose.
//
// Zero-dependency: chỉ node:vm + node:fs (+ crypto của Node cho hashString).
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nodeCrypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');

/** localStorage giả lập tối thiểu (giống load-security.js / load-auth-gate.js). */
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

/** document giả lập: chỉ cần addEventListener lúc load + getElementById -> null. */
function makeDocument() {
  const listeners = Object.create(null);
  return {
    _listeners: listeners,
    hidden: false,
    getElementById: () => null,
    addEventListener(type, fn) {
      (listeners[type] || (listeners[type] = [])).push(fn);
    },
    /** Kích hoạt listener đã đăng ký (vd 'clientpro:unlocked', 'visibilitychange'). */
    _emit(type) {
      const out = [];
      for (const fn of listeners[type] || []) out.push(fn());
      return Promise.all(out);
    },
  };
}

/**
 * IndexedDB giả lập: chỉ đủ cho `db.transaction(['customers'],'readonly').getAll()`
 * mà performAutoBackup() dùng.
 */
function makeFakeCustomerDb(customers) {
  return {
    transaction() {
      return {
        objectStore() {
          return {
            getAll() {
              const req = {};
              setImmediate(() => {
                if (typeof req.onsuccess === 'function') {
                  req.onsuccess({ target: { result: customers.slice() } });
                }
              });
              return req;
            },
          };
        },
      };
    },
  };
}

/**
 * LockManager giả lập theo đúng ngữ nghĩa Web Locks mà module dựa vào:
 * một tên khóa chỉ có một chủ tại một thời điểm; `ifAvailable: true` gọi callback
 * với `null` thay vì xếp hàng. Dùng chung một instance = "cùng origin".
 */
function makeLockManager() {
  const held = new Set();
  return {
    _held: held,
    async request(name, opts, cb) {
      const callback = typeof opts === 'function' ? opts : cb;
      const ifAvailable = typeof opts === 'object' && opts && opts.ifAvailable;
      if (held.has(name)) {
        if (ifAvailable) return await callback(null);
        throw new Error('Khóa đang bị giữ và test không mô phỏng chế độ xếp hàng');
      }
      held.add(name);
      try {
        return await callback({ name, mode: 'exclusive' });
      } finally {
        held.delete(name);
      }
    },
  };
}

/**
 * Nạp 16_auto_backup_drive.js và trả về sandbox test.
 *
 * @param {object} [opts]
 * @param {Array}  [opts.customers]    - bản ghi khách hàng giả lập trong IndexedDB.
 * @param {number} [opts.now]          - mốc thời gian khởi điểm cho Date.now() giả lập.
 * @param {object} [opts.localStorage] - dùng chung localStorage với ngữ cảnh khác
 *                                       (mô phỏng hai tab cùng origin).
 * @param {object} [opts.lockManager]  - `navigator.locks` dùng chung. Bỏ trống thì
 *                                       ngữ cảnh KHÔNG có Web Locks (nhánh dự phòng).
 * @param {Array}  [opts.requests]     - mảng ghi log request dùng chung.
 */
function loadAutoBackup(opts) {
  const options = opts || {};
  const localStorage = options.localStorage || makeLocalStorage();
  const document = makeDocument();

  // Đồng hồ điều khiển được: test cần tua tới/lui quanh throttle 24h & TTL khóa.
  let nowMs = typeof options.now === 'number' ? options.now : 1750000000000;
  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(nowMs); else super(...args);
    }
    static now() { return nowMs; }
  }

  /** Lịch sử request gửi tới GAS (để đếm số lần tạo file backup). */
  const requests = options.requests || [];

  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    JSON,
    Math,
    Date: FakeDate,
    Promise,
    String,
    Number,
    Boolean,
    Object,
    Array,
    Error,
    localStorage,
    document,
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout: () => {},
    window: {},
    // Có lockManager = trình duyệt hỗ trợ Web Locks. Bỏ trống = nhánh dự phòng.
    navigator: options.lockManager
      ? { onLine: true, locks: options.lockManager }
      : { onLine: true },

    // --- hằng/hàm bình thường đến từ 00_globals.js / 01_config.js ---
    USER_SCRIPT_KEY: 'app_user_script_url',
    USER_TOKEN_KEY: 'app_user_script_token',
    getEmployeeId: () => 'NV001',
    getDeviceIdSafe: () => 'DEVICE-TEST-1',
    getUserToken: () => 'user-token',

    // --- trạng thái phiên (02_security.js) ---
    isAppUnlocked: () => true,
    masterKey: 'master-key-test',
    APP_BACKUP_KDATA_B64U: 'kdata-test',
    ensureBackupSecret: async () => ({ ok: true }),
    decryptText: (v) => v,
    encryptBackupPayload: async (raw) => 'ENC:' + raw,
    hashString: async (str) =>
      nodeCrypto.createHash('sha256').update(String(str), 'utf8').digest('hex'),

    // --- IndexedDB (10_bootstrap.js) ---
    db: makeFakeCustomerDb(options.customers || [{ id: 'c1', name: 'A' }]),

    // --- hạ tầng dùng chung (19_error_loading.js) ---
    ErrorHandler: { logError() {}, showError() {}, showInfo() {}, showSuccess() {}, showWarning() {} },
    LoadingManager: { showGlobal() {}, hideGlobal() {}, showErrorState() {} },
  };

  // BackupCore (12_backup_core.js): chỉ cần normalizer trả về bản ghi "sạch".
  ctx.window.BackupCore = {
    normalizeCustomerForExport: async (c) => ({ id: c.id, name: c.name }),
  };
  ctx.BackupCore = ctx.window.BackupCore;
  ctx.window.ErrorHandler = ctx.ErrorHandler;

  // fetch giả lập GAS UserDriveAPI: ghi lại mọi action, trả lời đúng shape thật.
  ctx.fetch = async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    requests.push(body);
    if (body.action === 'backup') {
      return {
        json: async () => ({
          status: 'success',
          fileId: 'file_' + requests.length,
          filename: body.filename,
          createdAt: new FakeDate().toISOString(),
        }),
      };
    }
    if (body.action === 'list_backups') {
      return { json: async () => ({ status: 'success', backups: [] }) };
    }
    return { json: async () => ({ status: 'success' }) };
  };

  ctx.globalThis = ctx;
  vm.createContext(ctx);

  const src = fs.readFileSync(
    path.join(ROOT, 'assets', '16_auto_backup_drive.js'),
    'utf8'
  );
  vm.runInContext(src, ctx, { filename: 'assets/16_auto_backup_drive.js' });

  localStorage.setItem('app_user_script_url', 'https://example.invalid/user-gas');

  return {
    DriveBackup: ctx.window.DriveBackup,
    localStorage,
    document,
    ctx,
    requests,
    /** Số lần đã thực sự tạo file backup trên Drive. */
    backupCallCount: () => requests.filter((r) => r.action === 'backup').length,
    /** Tua đồng hồ giả lập. */
    advance: (ms) => { nowMs += ms; },
    now: () => nowMs,
    /** Thay fetch (ví dụ để ép list_backups lỗi). */
    setFetch: (fn) => { ctx.fetch = fn; },
  };
}

module.exports = { loadAutoBackup, makeLockManager, makeLocalStorage };

// --- Security & Encryption Helpers ---
// Sử dụng masterKey cho cơ chế mã hóa toàn bộ dữ liệu và khôi phục bằng mã nhân viên.
// masterKey là chuỗi "sentinel" (mọi check !!masterKey/isAppUnlocked giữ nguyên):
//   - Mới (v2): "MK2:" + base64(32 byte CSPRNG)  -> field cipher = AES-256-GCM (WebCrypto).
//   - Cũ (legacy): "mk_..."                        -> field cipher = CryptoJS.AES (chỉ để migrate/đọc).
let masterKey = null;
let masterKeyBytes = null;    // Uint8Array(32) thô (chỉ tồn tại khi đã mở khóa, zero khi lock)
let masterCryptoKey = null;   // CryptoKey AES-GCM non-extractable, dùng cho encrypt/decrypt field
let masterKeyLegacy = null;   // passphrase CryptoJS "mk_..." — chỉ set khi cần migrate/đọc dữ liệu cũ
// Legacy secret (passphrase) chỉ để đọc backup .cpb định dạng cũ.
// Backup mới dùng global KDATA do GAS cấp (base64url, no padding) làm AES-GCM key.
let APP_BACKUP_SECRET = "";
let APP_BACKUP_KDATA_B64U = "";
// v1 (legacy): {ts, kdata_b64u PLAINTEXT, identity} — CHỈ đọc để migrate, không ghi mới.
const BACKUP_KDATA_CACHE_KEY = "app_backup_kdata_cache_v1";
// v2 (sealed): {ts, identity, sealed: "cpg1:..."} — KDATA được niêm phong AES-GCM
// dưới masterKey. KHÔNG BAO GIỜ persist KDATA plaintext vào browser storage.
const BACKUP_KDATA_CACHE_KEY_V2 = "app_backup_kdata_cache_v2";
const BACKUP_KDATA_CACHE_TTL_MS = 30 * 60 * 1000; // 30 phút
// KDATA nhận được khi app còn khóa (vd AuthGate preflight) chờ seal trong RAM;
// _flushPendingKdataCache() ghi xuống sau khi unlock. Bị xóa khi lockApp().
let __pendingKdataCache = null;

function _backupAuthIdentity(employeeId, deviceId) {
  const scopeUrl = (typeof ADMIN_SERVER_URL !== "undefined" && ADMIN_SERVER_URL) ? String(ADMIN_SERVER_URL) : "";
  return `${employeeId || ""}::${deviceId || ""}::${scopeUrl}`;
}

function _parseKdataEnvelope(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

/**
 * Đọc KDATA cache. Async vì phải unseal bằng masterKey (AES-GCM).
 * - Ưu tiên v2 (sealed): TTL + identity + unseal; hỏng/expired khi ĐÃ mở khóa -> xóa an toàn.
 *   Khi CÒN khóa: trả null nhưng KHÔNG xóa (không phá giá trị tốt chỉ vì chưa có key).
 * - v1 (plaintext legacy): chỉ đọc để migrate — seal -> ghi v2 -> ĐỌC LẠI XÁC MINH ->
 *   mới xóa v1. Migration idempotent; v1 hỏng/hết hạn bị loại bỏ an toàn.
 * - Pending RAM (nhận lúc còn khóa) được dùng làm nguồn cuối.
 */
async function _readCachedKdataAsync(employeeId, deviceId) {
  const identity = _backupAuthIdentity(employeeId, deviceId);
  const now = Date.now();

  // 1) v2 sealed
  try {
    const rawV2 = localStorage.getItem(BACKUP_KDATA_CACHE_KEY_V2);
    if (rawV2) {
      const p = _parseKdataEnvelope(rawV2);
      const ts = p ? Number(p.ts || 0) : 0;
      const sealed = p && p.sealed ? String(p.sealed) : "";
      const pid = p && p.identity ? String(p.identity) : "";
      const structOk = !!(p && ts && sealed && pid);
      const fresh = structOk && (now - ts <= BACKUP_KDATA_CACHE_TTL_MS) && pid === identity;
      if (!structOk) {
        // JSON/cấu trúc hỏng: vô dụng với mọi khóa -> xóa an toàn.
        try { localStorage.removeItem(BACKUP_KDATA_CACHE_KEY_V2); } catch (e) {}
      } else if (fresh) {
        if (masterCryptoKey && sealed.startsWith(GCM_PREFIX)) {
          try {
            const kdata = await _gcmDecryptField(sealed);
            if (kdata) return { ts, kdata_b64u: kdata };
          } catch (e) {
            // Đã mở khóa mà không unseal được (sai khóa/tamper) -> giá trị chết, xóa.
            try { localStorage.removeItem(BACKUP_KDATA_CACHE_KEY_V2); } catch (e2) {}
          }
        }
        // Còn khóa: chưa unseal được nhưng KHÔNG xóa — trả null, thử lại sau unlock.
      }
      // Hết hạn/khác identity: để nguyên (ghi mới sẽ overwrite), trả null.
    }
  } catch (e) {}

  // 2) v1 legacy plaintext -> migrate sang v2 (chỉ khi đã có masterKey)
  try {
    const rawV1 = localStorage.getItem(BACKUP_KDATA_CACHE_KEY);
    if (rawV1) {
      const p = _parseKdataEnvelope(rawV1);
      const ts = p ? Number(p.ts || 0) : 0;
      const kdata = p && p.kdata_b64u ? String(p.kdata_b64u) : "";
      const pid = p && p.identity ? String(p.identity) : "";
      const valid = !!(p && ts && kdata && pid) && pid === identity && (now - ts <= BACKUP_KDATA_CACHE_TTL_MS);
      if (!valid) {
        // Hỏng cấu trúc hoặc hết hạn: plaintext vô giá trị -> loại bỏ an toàn.
        // (identity khác giữ nguyên — có thể thuộc cấu hình khác đang migrate dở.)
        if (!p || !ts || !kdata || !pid || (now - ts > BACKUP_KDATA_CACHE_TTL_MS)) {
          try { localStorage.removeItem(BACKUP_KDATA_CACHE_KEY); } catch (e) {}
        }
      } else if (masterCryptoKey) {
        // Seal -> ghi v2 -> đọc lại xác minh -> CHỈ KHI ĐÓ mới xóa v1.
        const migrated = await _writeCachedKdata(employeeId, deviceId, kdata, ts);
        if (migrated) {
          try { localStorage.removeItem(BACKUP_KDATA_CACHE_KEY); } catch (e) {}
        }
        return { ts, kdata_b64u: kdata };
      } else {
        // Còn khóa: dùng được giá trị legacy (chưa migrate được thì giữ nguyên v1).
        return { ts, kdata_b64u: kdata };
      }
    }
  } catch (e) {}

  // 3) pending RAM (nhận lúc còn khóa trong phiên này)
  if (__pendingKdataCache
    && __pendingKdataCache.identity === identity
    && (now - __pendingKdataCache.ts <= BACKUP_KDATA_CACHE_TTL_MS)) {
    return { ts: __pendingKdataCache.ts, kdata_b64u: __pendingKdataCache.kdata_b64u };
  }

  return null;
}

/**
 * Ghi KDATA cache. KHÔNG BAO GIỜ ghi plaintext xuống storage:
 * - Đã mở khóa: seal AES-GCM dưới masterKey -> ghi v2 -> đọc lại xác minh.
 * - Còn khóa: giữ trong RAM (__pendingKdataCache), flush sau unlock.
 * Trả về true nếu đã persist + xác minh thành công.
 */
async function _writeCachedKdata(employeeId, deviceId, kdata_b64u, tsOverride) {
  const kdata = String(kdata_b64u || "");
  if (!kdata) return false;
  const identity = _backupAuthIdentity(employeeId, deviceId);
  const ts = tsOverride || Date.now();

  if (!masterCryptoKey) {
    __pendingKdataCache = { identity, kdata_b64u: kdata, ts };
    return false;
  }

  try {
    const sealed = await _gcmEncryptField(kdata);
    localStorage.setItem(
      BACKUP_KDATA_CACHE_KEY_V2,
      JSON.stringify({ ts, identity, sealed })
    );
    // Đọc lại + unseal xác minh trước khi coi là thành công (an toàn dữ liệu).
    const back = _parseKdataEnvelope(localStorage.getItem(BACKUP_KDATA_CACHE_KEY_V2) || "");
    if (!back || String(back.sealed || "") !== sealed) return false;
    const verify = await _gcmDecryptField(String(back.sealed));
    return verify === kdata;
  } catch (e) {
    return false;
  }
}

/** Flush KDATA đang chờ trong RAM xuống sealed cache sau khi unlock. Idempotent. */
async function _flushPendingKdataCache() {
  if (!__pendingKdataCache || !masterCryptoKey) return;
  const pending = __pendingKdataCache;
  if (Date.now() - pending.ts > BACKUP_KDATA_CACHE_TTL_MS) {
    __pendingKdataCache = null;
    return;
  }
  try {
    const sealed = await _gcmEncryptField(pending.kdata_b64u);
    localStorage.setItem(
      BACKUP_KDATA_CACHE_KEY_V2,
      JSON.stringify({ ts: pending.ts, identity: pending.identity, sealed })
    );
  } catch (e) {}
  __pendingKdataCache = null;
}

/** Compute a SHA-256 hash of a string and return it as a hex string (Web Crypto API). */
async function hashString(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}


// ============================================================
// Backup Crypto (AES-256-GCM via WebCrypto)
// - Mục tiêu: ciphertext có xác thực (anti-tamper) + envelope có header/version.
// - Tương thích ngược: vẫn đọc được .cpb dạng cũ (CryptoJS.AES(passphrase)).
// ============================================================
function _b64EncodeBytes(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function _b64DecodeToBytes(b64) {
  const bin = atob(String(b64 || ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// base64url (RFC 4648) -> Uint8Array
function _b64uDecodeToBytes(b64u) {
  let s = String(b64u || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad === 2) s += "==";
  else if (pad === 3) s += "=";
  else if (pad === 1) throw new Error("INVALID_B64U");
  return _b64DecodeToBytes(s);
}

// New: import AES-GCM key from global KDATA (32 bytes raw)
async function _deriveAesGcmKeyFromKdataB64u(kdata_b64u) {
  const raw = _b64uDecodeToBytes(kdata_b64u);
  if (!raw || raw.length !== 32) throw new Error("KDATA_INVALID_LEN");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptBackupPayload(plaintext, kdata_b64u, meta = null) {
  if (!kdata_b64u) throw new Error("MISSING_BACKUP_KDATA");
  const key = await _deriveAesGcmKeyFromKdataB64u(kdata_b64u);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ptBytes = enc.encode(String(plaintext || ""));
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, ptBytes);
  const ctBytes = new Uint8Array(ctBuf);
  const checksum = (typeof hashString === "function") ? await hashString(String(plaintext || "")) : "";

  const envelope = {
    magic: "CLIENTPRO_CPB",
    v: 2,
    alg: "A256GCM",
    iv: _b64EncodeBytes(iv),
    ct: _b64EncodeBytes(ctBytes),
    cs: checksum,
    ts: Date.now(),
    meta: meta || null,
  };
  return JSON.stringify(envelope);
}

async function decryptBackupPayload(content, kdata_b64u) {
  const s = String(content || "").trim();
  if (!s) throw new Error("EMPTY_CIPHER");

  // New format: JSON envelope
  if (s.startsWith("{") && s.includes('"magic"')) {
    let env = null;
    try { env = JSON.parse(s); } catch (e) { env = null; }
    if (env && env.magic === "CLIENTPRO_CPB" && env.alg === "A256GCM" && env.iv && env.ct) {
      if (!kdata_b64u) throw new Error("MISSING_BACKUP_KDATA");
      const key = await _deriveAesGcmKeyFromKdataB64u(kdata_b64u);
      const iv = _b64DecodeToBytes(env.iv);
      const ct = _b64DecodeToBytes(env.ct);
      let ptBuf;
      try {
        ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
      } catch (e) {
        throw new Error("DECRYPT_FAILED");
      }
      const dec = new TextDecoder();
      const plaintext = dec.decode(ptBuf);
      if (env.cs && typeof hashString === "function") {
        const cs2 = await hashString(plaintext);
        if (cs2 !== env.cs) throw new Error("CHECKSUM_MISMATCH");
      }
      return { plaintext, envelope: env };
    }
  }

  // Legacy format: CryptoJS.AES(passphrase) - only works if you still provide the legacy secret.
  if (typeof CryptoJS !== "undefined" && CryptoJS.AES && APP_BACKUP_SECRET) {
    try {
      const bytes = CryptoJS.AES.decrypt(String(s), String(APP_BACKUP_SECRET));
      const plaintext = bytes.toString(CryptoJS.enc.Utf8);
      if (plaintext) return { plaintext, envelope: { magic: "LEGACY_CJS", v: 1 } };
    } catch (e) { }
  }

  throw new Error("UNSUPPORTED_CPB_FORMAT");
}

function getDeviceId() {
  const STORAGE_KEY = "app_device_unique_id";
  let deviceId = localStorage.getItem(STORAGE_KEY);
  if (!deviceId) {
    deviceId = "dev_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    localStorage.setItem(STORAGE_KEY, deviceId);
  }
  return deviceId;
}

// ============================================================
// Field-level cipher — AES-256-GCM (WebCrypto), có auth tag.
// Định dạng envelope chuỗi gọn:  "cpg1:" + base64url( iv[12] ‖ ciphertext+tag )
// Phân biệt 3 trạng thái giá trị:
//   (a) "cpg1:..."   -> AES-GCM mới (đọc qua cache đồng bộ, xem __fieldPlainCache)
//   (b) "U2FsdGVk..." -> legacy CryptoJS.AES (giải mã đồng bộ bằng masterKeyLegacy)
//   (c) còn lại       -> plaintext, trả nguyên
// ============================================================
const GCM_PREFIX = "cpg1:";

/** Cache giải mã field: ciphertext "cpg1:..." -> plaintext. Khóa duy nhất do IV
 *  ngẫu nhiên nên không bao giờ alias/stale. decryptText() đọc cache ĐỒNG BỘ;
 *  cache miss -> decryptFieldAsync() giải mã lazy khi render (không bulk prime). */
const __fieldPlainCache = new Map();
const __fieldDecryptPending = new Map();

function _b64uEncodeBytes(bytes) {
  return _b64EncodeBytes(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Mã hóa 1 field bằng AES-GCM (async). Seed luôn cache để đọc lại đồng bộ ngay trong phiên. */
async function _gcmEncryptField(plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, masterCryptoKey, new TextEncoder().encode(String(plain)));
  const ct = new Uint8Array(ctBuf);
  const buf = new Uint8Array(iv.length + ct.length);
  buf.set(iv, 0); buf.set(ct, iv.length);
  const out = GCM_PREFIX + _b64uEncodeBytes(buf);
  __fieldPlainCache.set(out, String(plain));
  return out;
}

/** Giải mã 1 field AES-GCM (async). Ném lỗi nếu bị giả mạo/sai khóa (GCM tag). */
async function _gcmDecryptField(s) {
  const raw = _b64uDecodeToBytes(String(s).slice(GCM_PREFIX.length));
  const ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.subarray(0, 12) }, masterCryptoKey, raw.subarray(12));
  return new TextDecoder().decode(ptBuf);
}

/**
 * Encrypt a text value. BẤT ĐỒNG BỘ (WebCrypto). Trả về "cpg1:..." khi đã mở khóa
 * bằng key v2; trong cửa sổ migration (chỉ có masterKeyLegacy) tạm dùng CryptoJS.
 * Gọi ở các điểm GHI (saveCustomer/saveAsset/notes/restore/token) — phải `await`
 * và mã hóa TRƯỚC khi mở transaction IndexedDB (không await giữa transaction).
 */
async function encryptText(text) {
  if (!masterKey || text === undefined || text === null) return text;
  const s = String(text);
  // Chống double-encryption: nếu chuỗi truyền vào ĐÃ trông như 1 envelope ciphertext
  // (cpg1:... hoặc U2FsdGVk... của legacy), từ chối mã hóa lại. Trường hợp này xảy ra khi
  // 1 field lazy-decrypt bị cache-miss lúc render (decryptText trả nguyên ciphertext), UI
  // vô tình đổ ciphertext đó vào ô input, rồi user bấm Lưu — nếu mã hóa tiếp sẽ lồng thêm
  // 1 lớp AES-GCM ngoài ciphertext cũ, làm dữ liệu hỏng VĨNH VIỄN (không cách nào gỡ lại vì
  // decryptFieldAsync chỉ mở đúng 1 lớp). Ném lỗi để caller dừng lưu thay vì âm thầm phá dữ liệu.
  if (s.startsWith(GCM_PREFIX) || s.startsWith("U2FsdGVk")) {
    throw new Error("encryptText: từ chối mã hóa chuỗi đã trông như ciphertext (chống double-encryption)");
  }
  if (masterCryptoKey) return _gcmEncryptField(text);
  try {
    return CryptoJS.AES.encrypt(String(text), masterKeyLegacy || masterKey).toString(); // chỉ pre-migration
  } catch (e) {
    return text;
  }
}

/**
 * Giải mã 1 field AES-GCM lazy (async). Dedupe concurrent decrypt cùng ciphertext.
 * Legacy CryptoJS + plaintext passthrough giữ đồng bộ qua decryptText().
 */
async function decryptFieldAsync(cipher) {
  if (cipher === undefined || cipher === null) return cipher;
  const s = String(cipher);
  if (!s.startsWith(GCM_PREFIX)) return decryptText(s);
  const hit = __fieldPlainCache.get(s);
  if (hit !== undefined) return hit;
  let pending = __fieldDecryptPending.get(s);
  if (!pending) {
    pending = _gcmDecryptField(s).then((pt) => {
      __fieldPlainCache.set(s, pt);
      __fieldDecryptPending.delete(s);
      return pt;
    }).catch(() => {
      __fieldDecryptPending.delete(s);
      return s;
    });
    __fieldDecryptPending.set(s, pending);
  }
  return pending;
}

/** * Decrypt một field. ĐỒNG BỘ (đọc cache cho cpg1:, CryptoJS cho legacy). Nếu chưa
 * mở khóa / cache chưa nạp / giải mã thất bại thì trả nguyên bản. * @param {string} cipher * @returns {string} */
function decryptText(cipher) {
  if (cipher === undefined || cipher === null) return cipher;
  const s = String(cipher);
  if (s.startsWith(GCM_PREFIX)) {
    const hit = __fieldPlainCache.get(s);
    return hit !== undefined ? hit : cipher; // miss -> lazy decrypt qua decryptFieldAsync khi render
  }
  if (s.startsWith("U2FsdGVk")) {
    const k = masterKeyLegacy || (masterKey && masterKey.startsWith("mk_") ? masterKey : null);
    if (!k) return cipher;
    try {
      const plaintext = CryptoJS.AES.decrypt(s, k).toString(CryptoJS.enc.Utf8);
      return plaintext || cipher;
    } catch (e) {
      return cipher;
    }
  }
  return cipher; // plaintext passthrough
}

/** * Sinh master key ngẫu nhiên MẠNH bằng CSPRNG: "MK2:" + base64(32 byte). * @returns {string} */
function generateMasterKey() {
  return "MK2:" + _b64EncodeBytes(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Cài masterKey vào phiên: set sentinel + dựng key phái sinh. Thay cho `masterKey = ...` trực tiếp.
 * - "MK2:..." -> import AES-GCM CryptoKey (non-extractable) sẵn cho encrypt/decrypt field.
 * - "mk_..."  -> giữ làm masterKeyLegacy để đọc dữ liệu cũ + kích hoạt migration.
 */
async function _installMasterKey(mkStr) {
  // Đổi khóa -> cache plaintext của khóa cũ không còn hợp lệ (chống rò rỉ chéo khóa).
  __fieldPlainCache.clear();
  masterKey = mkStr;
  if (mkStr && mkStr.startsWith("MK2:")) {
    masterKeyBytes = _b64DecodeToBytes(mkStr.slice(4));
    masterCryptoKey = await crypto.subtle.importKey("raw", masterKeyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    masterKeyLegacy = null;
  } else {
    masterKeyLegacy = mkStr || null;
    masterKeyBytes = null;
    masterCryptoKey = null;
  }
}

/** Xóa mọi vết khóa + plaintext khỏi RAM khi khóa app / ẩn tab (giới hạn tuổi thọ). */
function clearMasterKeyMaterial() {
  if (masterKeyBytes) { try { masterKeyBytes.fill(0); } catch (e) {} }
  masterKey = null; masterKeyBytes = null; masterCryptoKey = null; masterKeyLegacy = null;
  // KDATA plaintext cũng là secret trong RAM -> xóa khi khóa (sealed v2 trong
  // localStorage giữ nguyên vì đã là ciphertext).
  APP_BACKUP_KDATA_B64U = "";
  __pendingKdataCache = null;
  __fieldPlainCache.clear();
  __fieldDecryptPending.clear();
}

/**
 * Khóa app: xóa key khỏi RAM + hiện màn hình PIN. Mở khóa lại đi qua validatePin()
 * (completeUnlockDataLoad idempotent nên chạy lần 2 an toàn).
 */
function lockApp() {
  if (!isAppUnlocked()) return;
  // Chưa thiết lập PIN (đang setup/kích hoạt) -> không có gì để khóa về, tránh nhốt người dùng.
  if (!localStorage.getItem(PIN_KEY)) return;
  clearMasterKeyMaterial();
  currentPin = "";
  try { showLockScreen(); } catch (e) {}
}

/**
 * Prime tối thiểu sau unlock: chỉ token Drive (getUserToken đồng bộ).
 * Field KH/TSBĐ giải mã lazy qua decryptFieldAsync khi render.
 */
async function primeFieldCache() {
  if (!masterCryptoKey) return;
  try {
    const tkKey = (typeof USER_TOKEN_KEY !== "undefined") ? USER_TOKEN_KEY : "app_user_script_token";
    const rawTk = (localStorage.getItem(tkKey) || "").trim();
    if (rawTk.startsWith("sealed.v1:")) {
      const inner = rawTk.slice("sealed.v1:".length);
      if (inner.startsWith(GCM_PREFIX) && !__fieldPlainCache.has(inner)) {
        try { __fieldPlainCache.set(inner, await _gcmDecryptField(inner)); } catch (e) {}
      }
    }
  } catch (e) {}
}

// ============================================================
// Image at-rest encryption (field `data` trong store images)
// ============================================================
const IMG_SCHEMA_KEY = "app_image_crypto_schema_v";

function _isPlainImageDataUrl(s) {
  return typeof s === "string" && /^data:image\/[a-z0-9.+-]+;base64,/i.test(s);
}

async function encryptImageData(dataUrl) {
  if (!dataUrl || !masterKey) return dataUrl;
  if (String(dataUrl).startsWith(GCM_PREFIX)) return dataUrl;
  if (!_isPlainImageDataUrl(dataUrl)) return dataUrl;
  return encryptText(dataUrl);
}

async function decryptImageData(cipher) {
  if (!cipher) return cipher;
  const s = String(cipher);
  if (s.startsWith(GCM_PREFIX)) return decryptFieldAsync(s);
  if (_isPlainImageDataUrl(s)) return s;
  return decryptText(s);
}

async function runImageCryptoMigrationIfNeeded() {
  if (localStorage.getItem(IMG_SCHEMA_KEY) === "1") return;
  if (!masterCryptoKey || typeof db === "undefined" || !db) return;
  const all = await new Promise((resolve) => {
    try {
      const req = db.transaction(["images"], "readonly").objectStore("images").getAll();
      req.onsuccess = (e) => resolve(e.target.result || []);
      req.onerror = () => resolve([]);
    } catch (e) { resolve([]); }
  });
  for (const img of all) {
    if (!img || img.imgCryptoV === 1) continue;
    if (!_isPlainImageDataUrl(img.data)) continue;
    const enc = await encryptImageData(img.data);
    await new Promise((resolve, reject) => {
      img.data = enc;
      img.imgCryptoV = 1;
      const p = db.transaction(["images"], "readwrite").objectStore("images").put(img);
      p.onsuccess = () => resolve();
      p.onerror = () => reject(p.error);
    });
  }
  localStorage.setItem(IMG_SCHEMA_KEY, "1");
}

// ============================================================
// Migration v1.0.0: mã hóa at-rest cho creditLimit (customer) và assets[].name —
// hai trường trước đây chủ đích lưu plaintext. Idempotent + bảo toàn dữ liệu:
// encrypt -> đọc lại xác minh -> mới đưa vào batch ghi; record lỗi GIỮ NGUYÊN
// (không ghi đè, không dừng cả migration); marker chỉ set khi 100% sạch —
// lần unlock sau tự retry phần còn lại. Chỉ chạy sau unlock (cần masterCryptoKey).
// ============================================================
const FIELD_ENCRYPT_V2_KEY = "app_field_encrypt_v2_done";

async function runFieldEncryptMigrationV2IfNeeded() {
  if (localStorage.getItem(FIELD_ENCRYPT_V2_KEY) === "1") return;
  if (!masterCryptoKey || typeof db === "undefined" || !db) return;

  const looksEnc = (v) => (typeof _looksEncrypted === "function")
    ? _looksEncrypted(v)
    : (typeof v === "string" && (v.startsWith("U2FsdGVk") || v.startsWith(GCM_PREFIX)));
  const needsEncrypt = (v) => (typeof v === "number") || (typeof v === "string" && v !== "" && !looksEnc(v));

  // Mã hóa + xác minh NGOÀI transaction (không await giữa transaction IndexedDB).
  const encVerified = async (v) => {
    const s = String(v);
    const enc = await encryptText(s); // throw nếu input giống ciphertext (chống double-encrypt)
    const back = await decryptFieldAsync(enc);
    if (back !== s) throw new Error("FIELD_MIGR_VERIFY_MISMATCH");
    return enc;
  };

  const all = await new Promise((resolve) => {
    try {
      const req = db.transaction(["customers"], "readonly").objectStore("customers").getAll();
      req.onsuccess = (e) => resolve(e.target.result || []);
      req.onerror = () => resolve([]);
    } catch (e) { resolve([]); }
  });

  let failures = 0;
  const updated = [];
  for (const c of all) {
    if (!c || !c.id) continue;
    try {
      const next = JSON.parse(JSON.stringify(c));
      let changed = false;
      if (needsEncrypt(next.creditLimit)) { next.creditLimit = await encVerified(next.creditLimit); changed = true; }
      if (Array.isArray(next.assets)) {
        for (const a of next.assets) {
          if (a && needsEncrypt(a.name)) { a.name = await encVerified(a.name); changed = true; }
        }
      }
      if (changed) updated.push(next);
    } catch (e) {
      failures++;
    }
  }

  if (updated.length) {
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["customers"], "readwrite");
        const store = tx.objectStore("customers");
        updated.forEach((c) => store.put(c));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("FIELD_MIGR_TX_ERROR"));
        tx.onabort = () => reject(tx.error || new Error("FIELD_MIGR_TX_ABORT"));
      });
    } catch (e) {
      failures++;
    }
  }

  if (failures === 0) {
    localStorage.setItem(FIELD_ENCRYPT_V2_KEY, "1");
  } else {
    try {
      ErrorHandler.showWarning(`Mã hóa bổ sung chưa hoàn tất cho ${failures} bản ghi — sẽ tự thử lại ở lần mở khóa sau.`);
    } catch (e) {}
  }
}

function _setUnlockLoading(on, msg) {
  const panel = getEl("pin-unlock-loading");
  const keypad = getEl("pin-keypad");
  const display = getEl("pin-display");
  const forgot = document.querySelector("#screen-lock [data-action=\"forgotPin\"]");
  if (panel) panel.classList.toggle("hidden", !on);
  if (keypad) keypad.classList.toggle("hidden", !!on);
  if (display) display.classList.toggle("hidden", !!on);
  if (forgot) forgot.classList.toggle("hidden", !!on);
  if (on && msg) {
    const t = panel && panel.querySelector("[data-unlock-msg]");
    if (t) t.textContent = msg;
  }
}

/** Sau khi xác thực PIN: migration + lazy prime + loadCustomers — giữ lock đến khi xong. */
async function completeUnlockDataLoad(pinForMigration, empForMigration) {
  _setUnlockLoading(true, "Đang tải dữ liệu...");
  try {
    try { if (window.__dbReady) await window.__dbReady; } catch (e) {}
    try {
      await runFieldCryptoMigrationIfNeeded(pinForMigration, empForMigration);
    } catch (e) {
      try { ErrorHandler.logError("crypto-migration", e); } catch (_) {}
    }
    try {
      await runImageCryptoMigrationIfNeeded();
    } catch (e) {
      try { ErrorHandler.logError("image-crypto-migration", e); } catch (_) {}
    }
    try {
      await runFieldEncryptMigrationV2IfNeeded();
    } catch (e) {
      try { ErrorHandler.logError("field-encrypt-migration-v2", e); } catch (_) {}
    }
    await primeFieldCache();
    // Seal KDATA nhận được lúc còn khóa (AuthGate preflight) TRƯỚC khi phát
    // sự kiện unlocked — auto-backup nghe sự kiện sẽ thấy cache sẵn, không
    // phải xin lại KDATA từ GAS.
    try { await _flushPendingKdataCache(); } catch (e) {}
    if (typeof loadCustomers === "function") {
      await loadCustomers((getEl("search-input") && getEl("search-input").value) || "");
    }
  } finally {
    _setUnlockLoading(false);
  }
  // B2: báo cho các module (auto-backup Drive...) biết app vừa mở khóa xong.
  // Guard đầy đủ vì test harness (tests/helpers/load-security.js) stub document
  // không có dispatchEvent/CustomEvent. Dispatch lặp lại vô hại (listener idempotent).
  try {
    if (typeof document !== "undefined"
      && typeof document.dispatchEvent === "function"
      && typeof CustomEvent === "function") {
      document.dispatchEvent(new CustomEvent("clientpro:unlocked"));
    }
  } catch (e) {}
}

// ============================================================
// Migration một lần: CryptoJS(masterKey cũ "mk_...") -> AES-256-GCM (masterKey mới "MK2:").
// Idempotent + resume-safe. Bất biến: envelope PIN chỉ swap sang MK2 khi 100% record
// đã GCM; tới lúc đó legacy key vẫn mở được từ PIN_KEY gốc -> không bao giờ kẹt/mất.
// ============================================================
const SCHEMA_KEY = "app_crypto_schema_v";   // '2' = đã migrate
const PIN_STAGE = "app_pin_v2_stage";       // niêm phong MK2 tạm dưới PIN (resume không đúc lại key)
const SEC_STAGE = "app_sec_v2_stage";       // niêm phong MK2 tạm dưới mã nhân viên

function _getAllCustomerKeys() {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(["customers"], "readonly").objectStore("customers").getAllKeys();
      req.onsuccess = (e) => resolve(e.target.result || []);
      req.onerror = () => resolve([]);
    } catch (e) { resolve([]); }
  });
}

/** Re-encrypt mọi field CryptoJS-legacy của 1 record sang AES-GCM (masterCryptoKey mới). */
async function _reencryptRecord(c) {
  const decLegacy = (v) => (typeof v === "string" && v.startsWith("U2FsdGVk"))
    ? (CryptoJS.AES.decrypt(v, masterKeyLegacy).toString(CryptoJS.enc.Utf8) || "") : v;
  const conv = async (v) => (typeof v === "string" && v.startsWith("U2FsdGVk")) ? await _gcmEncryptField(decLegacy(v)) : v;
  for (const k of ["name", "phone", "cccd", "notes", "creditLimit", "driveLink"]) if (c[k] !== undefined) c[k] = await conv(c[k]);
  if (Array.isArray(c.assets)) for (const a of c.assets) {
    for (const k of ["name", "link", "valuation", "loanValue", "area", "width", "onland", "year", "driveLink"]) if (a[k] !== undefined) a[k] = await conv(a[k]);
  }
  c.cryptoV = 2;
}

/** Re-encrypt token Drive (07_drive 'sealed.v1:') trong lúc còn masterKeyLegacy. */
async function _migrateDriveToken() {
  try {
    const tkKey = (typeof USER_TOKEN_KEY !== "undefined") ? USER_TOKEN_KEY : "app_user_script_token";
    const raw = (localStorage.getItem(tkKey) || "").trim();
    if (!raw.startsWith("sealed.v1:")) return;         // plaintext/empty -> getUserToken reseal sau
    const inner = raw.slice("sealed.v1:".length);
    if (inner.startsWith(GCM_PREFIX)) return;           // đã GCM
    if (!inner.startsWith("U2FsdGVk")) return;
    const pt = CryptoJS.AES.decrypt(inner, masterKeyLegacy).toString(CryptoJS.enc.Utf8);
    if (pt) localStorage.setItem(tkKey, "sealed.v1:" + await _gcmEncryptField(pt));
  } catch (e) {}
}

/**
 * Chạy migration nếu cần (gọi sau _installMasterKey, TRƯỚC primeFieldCache).
 * @param {string} pin secret mở khóa hằng ngày (để niêm phong MK2 mới)
 * @param {string} employeeId mã nhân viên (để niêm phong MK2 dưới SEC_KEY)
 */
async function runFieldCryptoMigrationIfNeeded(pin, employeeId) {
  if (typeof db === "undefined" || !db) return;
  if (localStorage.getItem(SCHEMA_KEY) === "2") return;

  // Resume-after-swap: envelope đã MK2 (crash trước khi set cờ) -> chỉ finalize.
  if (!masterKeyLegacy && masterCryptoKey) {
    localStorage.setItem(SCHEMA_KEY, "2");
    localStorage.removeItem(PIN_STAGE); localStorage.removeItem(SEC_STAGE);
    return;
  }
  if (!masterKeyLegacy) return; // cài mới hoàn toàn v2, không có gì để migrate

  // 1) Đúc/khôi phục newMk (resume tái dùng staged key -> không orphan dữ liệu GCM đã ghi).
  let mkStr = null;
  const staged = localStorage.getItem(PIN_STAGE);
  if (staged) mkStr = await openMasterKeyV2(pin, staged);
  if (!mkStr) {
    mkStr = generateMasterKey();
    localStorage.setItem(PIN_STAGE, await sealMasterKey(pin, mkStr));
    if (employeeId) localStorage.setItem(SEC_STAGE, await sealMasterKey(employeeId, mkStr));
  }

  // 2) Cài GCM key để GHI; GIỮ masterKeyLegacy để ĐỌC dữ liệu cũ.
  masterKeyBytes = _b64DecodeToBytes(mkStr.slice(4));
  masterCryptoKey = await crypto.subtle.importKey("raw", masterKeyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);

  // 3) Từng record: ĐỌC (tx1) -> re-encrypt (await crypto NGOÀI transaction) -> GHI (tx2, thuần sync).
  //    Không await WebCrypto giữa 1 transaction (IDB tự commit/close). Mỗi record 1 tx ghi -> atomic + resume-safe.
  for (const id of await _getAllCustomerKeys()) {
    const c = await new Promise((resolve, reject) => {
      const g = db.transaction(["customers"], "readonly").objectStore("customers").get(id);
      g.onsuccess = () => resolve(g.result);
      g.onerror = () => reject(g.error);
    });
    if (!c || c.cryptoV === 2) continue;   // idempotent: đã GCM thì bỏ qua (resume sau crash)
    await _reencryptRecord(c);
    await new Promise((resolve, reject) => {
      const p = db.transaction(["customers"], "readwrite").objectStore("customers").put(c);
      p.onsuccess = () => resolve();
      p.onerror = () => reject(p.error);
    });
  }
  await _migrateDriveToken();

  // 4) FINALIZE — swap envelope TRƯỚC (loop đã 100%), set cờ SAU CÙNG.
  localStorage.setItem(PIN_KEY, localStorage.getItem(PIN_STAGE));
  if (localStorage.getItem(SEC_STAGE)) localStorage.setItem(SEC_KEY, localStorage.getItem(SEC_STAGE));
  localStorage.setItem(SCHEMA_KEY, "2");
  localStorage.removeItem(PIN_STAGE); localStorage.removeItem(SEC_STAGE);
  masterKey = mkStr; masterKeyLegacy = null;
}

// ============================================================
// PIN Envelope v2 (PBKDF2-SHA-256 + AES-256-GCM via WebCrypto)
// - masterKey được "niêm phong" bằng PIN 6 số / mã nhân viên với KDF chậm + salt
//   ngẫu nhiên (chống brute-force offline, khác hẳn SHA-256 đơn của bản cũ).
// - GCM auth tag tự xác thực: sai PIN => decrypt throw, không cần oracle "mk_".
// - Định dạng legacy (CryptoJS.AES với SHA-256(pin), PIN 4 số) vẫn đọc được
//   để người dùng cũ mở khóa lần cuối rồi bắt buộc nâng cấp lên PIN 6 số.
// ============================================================
const PIN_ENVELOPE_V = 2;
const PBKDF2_ITER_DEFAULT = 150000; // ~100-300ms trên Android tầm trung; lưu trong envelope nên đổi sau không cần migration
const PIN_LENGTH = 6;
const LEGACY_PIN_LENGTH = 4;

function parseV2Envelope(raw) {
  const s = String(raw || "").trim();
  if (!s.startsWith("{")) return null;
  try {
    const env = JSON.parse(s);
    if (env && env.v === PIN_ENVELOPE_V && env.alg === "A256GCM" && env.salt && env.iv && env.ct) return env;
  } catch (e) { }
  return null;
}

function isLegacyEnvelope(raw) {
  return !!raw && !parseV2Envelope(raw);
}

/** Số ký tự PIN đang áp dụng: 4 nếu còn envelope legacy, 6 với envelope v2/thiết lập mới. */
function getPinLength() {
  return isLegacyEnvelope(localStorage.getItem(PIN_KEY)) ? LEGACY_PIN_LENGTH : PIN_LENGTH;
}

async function _deriveEnvelopeKey(secret, saltBytes, iter) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode(String(secret)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: iter },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Niêm phong masterKey bằng secret (PIN/mã nhân viên) -> chuỗi JSON envelope v2. */
async function sealMasterKey(secret, masterKeyStr, iter = PBKDF2_ITER_DEFAULT) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await _deriveEnvelopeKey(secret, salt, iter);
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(String(masterKeyStr)));
  return JSON.stringify({
    v: PIN_ENVELOPE_V,
    alg: "A256GCM",
    kdf: "PBKDF2-SHA256",
    iter,
    salt: _b64EncodeBytes(salt),
    iv: _b64EncodeBytes(iv),
    ct: _b64EncodeBytes(new Uint8Array(ctBuf)),
  });
}

/** Mở envelope v2. Trả về masterKey hoặc null (sai secret => GCM throw => null). */
async function openMasterKeyV2(secret, rawStored) {
  const env = parseV2Envelope(rawStored);
  if (!env) return null;
  try {
    const key = await _deriveEnvelopeKey(secret, _b64DecodeToBytes(env.salt), Number(env.iter) || PBKDF2_ITER_DEFAULT);
    const ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: _b64DecodeToBytes(env.iv) }, key, _b64DecodeToBytes(env.ct));
    const mk = new TextDecoder().decode(ptBuf);
    return _isValidMasterKeyString(mk) ? mk : null;
  } catch (e) {
    return null;
  }
}

/** masterKey hợp lệ: định dạng mới "MK2:" hoặc legacy "mk_" (tương thích ngược). */
function _isValidMasterKeyString(mk) {
  return !!mk && (mk.startsWith("MK2:") || mk.startsWith("mk_"));
}

/** Mở envelope legacy (CryptoJS.AES với passphrase = SHA-256(secret)). */
async function openMasterKeyLegacy(secret, rawStored) {
  if (!rawStored) return null;
  try {
    const hashed = await hashString(String(secret));
    const bytes = CryptoJS.AES.decrypt(String(rawStored), hashed);
    const mk = bytes.toString(CryptoJS.enc.Utf8);
    return _isValidMasterKeyString(mk) ? mk : null;
  } catch (e) {
    return null;
  }
}

/** Mở khóa với cả 2 định dạng. Trả về { masterKey, legacy } hoặc null. */
async function unwrapMasterKeyAny(secret, rawStored) {
  if (!rawStored) return null;
  if (parseV2Envelope(rawStored)) {
    const mk = await openMasterKeyV2(secret, rawStored);
    return mk ? { masterKey: mk, legacy: false } : null;
  }
  const mk = await openMasterKeyLegacy(secret, rawStored);
  return mk ? { masterKey: mk, legacy: true } : null;
}

// ---- Chống brute-force: đếm lần sai + khóa lũy tiến, sống sót qua reload ----
// Attacker xóa được localStorage thì cũng dump được ciphertext để attack offline;
// phòng tuyến tầng đó là PBKDF2 — lockout chỉ chặn đoán online trên máy nạn nhân.
const PIN_LOCKOUT_KEY = "app_pin_lockout_v1";
const PIN_MAX_FREE_FAILS = 5;
const PIN_LOCK_BASE_MS = 30 * 1000;
const PIN_LOCK_MAX_MS = 30 * 60 * 1000;
let _pinChecking = false;
let _lockoutTimer = null;

function _readLockout() {
  try {
    const st = JSON.parse(localStorage.getItem(PIN_LOCKOUT_KEY));
    if (st && typeof st === "object") return { fails: Number(st.fails) || 0, until: Number(st.until) || 0 };
  } catch (e) { }
  return { fails: 0, until: 0 };
}

function getLockoutRemainingMs() {
  return Math.max(0, _readLockout().until - Date.now());
}

function resetPinFailures() {
  try { localStorage.removeItem(PIN_LOCKOUT_KEY); } catch (e) { }
  _updateLockMessage("");
}

function registerPinFailure() {
  const st = _readLockout();
  st.fails += 1;
  if (st.fails >= PIN_MAX_FREE_FAILS) {
    const lockMs = Math.min(PIN_LOCK_BASE_MS * Math.pow(2, st.fails - PIN_MAX_FREE_FAILS), PIN_LOCK_MAX_MS);
    st.until = Date.now() + lockMs;
  }
  try { localStorage.setItem(PIN_LOCKOUT_KEY, JSON.stringify(st)); } catch (e) { }
  return st;
}

function _updateLockMessage(text) {
  const el = getEl("pin-lockout-msg");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("hidden", !text);
}

function _setKeypadDisabled(disabled) {
  const pad = getEl("pin-keypad");
  if (pad) pad.classList.toggle("keypad-disabled", !!disabled);
}

function updateLockoutUI() {
  if (_lockoutTimer) { clearInterval(_lockoutTimer); _lockoutTimer = null; }
  if (getLockoutRemainingMs() > 0) {
    _setKeypadDisabled(true);
    const tick = () => {
      const ms = getLockoutRemainingMs();
      if (ms <= 0) {
        clearInterval(_lockoutTimer);
        _lockoutTimer = null;
        _setKeypadDisabled(false);
        _updateLockMessage("");
        return;
      }
      _updateLockMessage(`Sai quá nhiều lần. Thử lại sau ${Math.ceil(ms / 1000)} giây`);
    };
    tick();
    _lockoutTimer = setInterval(tick, 1000);
    return;
  }
  _setKeypadDisabled(false);
  const st = _readLockout();
  if (st.fails > 0 && st.fails < PIN_MAX_FREE_FAILS) {
    _updateLockMessage(`Sai mã PIN (còn ${PIN_MAX_FREE_FAILS - st.fails} lần thử)`);
  } else {
    _updateLockMessage("");
  }
}

function _shakePinDots() {
  const display = getEl("pin-display");
  if (!display) return;
  display.classList.remove("pin-shake");
  void display.offsetWidth;
  display.classList.add("pin-shake");
}

/** * Giải mã toàn bộ thông tin khách hàng (bao gồm tài sản) bằng masterKey. * @param {Object} cust * @returns {Object} */
function decryptCustomerObject(cust) {
  if (!cust) return cust;
  cust.name = decryptText(cust.name);
  cust.phone = decryptText(cust.phone);
  // Giải mã thêm trường CCCD/CMND nếu tồn tại
  cust.cccd = decryptText(cust.cccd);
  // v1.0.0: creditLimit mã hóa at rest — chỉ decrypt khi là string
  // (record rất cũ có thể lưu number plaintext, giữ nguyên để migration xử lý).
  if (typeof cust.creditLimit === "string" && cust.creditLimit) {
    cust.creditLimit = decryptText(cust.creditLimit);
  }
  if (cust.assets && Array.isArray(cust.assets)) {
    cust.assets.forEach((a) => {
      a.name = decryptText(a.name);
      a.link = decryptText(a.link);
      a.valuation = decryptText(a.valuation);
      a.loanValue = decryptText(a.loanValue);
      a.area = decryptText(a.area);
      a.width = decryptText(a.width);
      a.onland = decryptText(a.onland);
      a.year = decryptText(a.year);
      a.driveLink = decryptText(a.driveLink);
    });
  }
  cust.driveLink = decryptText(cust.driveLink);
  return cust;
}

/**
 * Giải mã tối thiểu để hiển thị danh sách (nhanh hơn đáng kể với dữ liệu lớn).
 * Không giải mã assets để tránh giật/đơ khi tìm kiếm hoặc chuyển tab.
 * @param {Object} cust
 * @returns {Object}
 */
function decryptCustomerSummary(cust) {
  if (!cust) return cust;
  cust.name = decryptText(cust.name);
  cust.phone = decryptText(cust.phone);
  cust.cccd = decryptText(cust.cccd);
  // driveLink không cần cho list, chỉ giữ nguyên để dùng khi mở folder
  return cust;
}

/** Giải mã summary async (lazy) — dùng khi render danh sách / tìm kiếm. */
async function decryptCustomerSummaryAsync(cust) {
  if (!cust) return cust;
  const [name, phone, cccd] = await Promise.all([
    decryptFieldAsync(cust.name),
    decryptFieldAsync(cust.phone),
    decryptFieldAsync(cust.cccd),
  ]);
  cust.name = name;
  cust.phone = phone;
  cust.cccd = cccd;
  return cust;
}

/** * Escape HTML special characters in a string to mitigate XSS risks when inserting into innerHTML. * @param {string} str * @returns {string} */
function escapeHTML(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isAppUnlocked() {
  return typeof masterKey !== "undefined" && !!masterKey;
}

function requireUnlockedForBackup() {
  if (!isAppUnlocked()) {
    try { ErrorHandler.showWarning("Vui lòng mở khóa dữ liệu trước khi sao lưu."); } catch (e) { }
    return false;
  }
  return true;
}

function requireUnlockedForRestore() {
  if (!isAppUnlocked()) {
    try { ErrorHandler.showWarning("Vui lòng mở khóa dữ liệu trước khi khôi phục."); } catch (e) { }
    return false;
  }
  return true;
}

function isSafeImageUrl(url) {
  if (!url) return false;
  const s = String(url).trim();
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(s)) return true;
  try {
    const u = new URL(s, window.location.href);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    return h === "drive.google.com" || h === "lh3.googleusercontent.com" || h.endsWith(".googleusercontent.com");
  } catch (e) { return false; }
}

function isSafeDriveUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(String(url).trim(), window.location.href);
    return u.protocol === "https:" && u.hostname.toLowerCase() === "drive.google.com";
  } catch (e) { return false; }
}

function setTheme(themeName) {
  document.body.className = themeName;
  localStorage.setItem(THEME_KEY, themeName);
  document.querySelectorAll(".theme-btn-sm").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.arg === themeName);
  });
}
/** * Kiểm tra trạng thái kích hoạt và bảo mật của ứng dụng. * Trình tự: * 1. Nếu chưa kích hoạt (không có app_activated), hiển thị modal kích hoạt. * 2. Nếu đã kích hoạt nhưng chưa tạo PIN, hiển thị màn hình thiết lập PIN. * Mã nhân viên sẽ được điền sẵn từ localStorage để người dùng không cần nhập lại. * 3. Nếu đã có PIN, hiển thị màn hình khóa để nhập PIN. */
// --- HÀM CHECK BẢO MẬT MỚI (MỞ KHÓA SIÊU TỐC) ---
async function checkSecurity() {
  // 1. KIỂM TRA DỮ LIỆU TRONG MÁY TRƯỚC (Cực nhanh)
  const activated = localStorage.getItem(ACTIVATED_KEY);
  const pinEnc = localStorage.getItem(PIN_KEY);

  // Nếu chưa kích hoạt -> Hiện bảng kích hoạt luôn
  if (!activated) {
    const modal = getEl("activation-modal");
    if (modal) modal.classList.remove("hidden");
    return;
  }

  // Nếu đã kích hoạt -> HIỆN MÀN HÌNH KHÓA NGAY (Không chờ Server)
  if (!pinEnc) {
    // Chưa có PIN -> Hiện bảng tạo PIN
    getEl("setup-lock-modal").classList.remove("hidden");
    // Điền sẵn mã NV nếu có
    const storedEmp = localStorage.getItem(EMPLOYEE_KEY);
    if (storedEmp) getEl("setup-answer").value = storedEmp;
  } else {
    // Đã có PIN -> Hiện bàn phím nhập PIN ngay lập tức
    showLockScreen();
  }

  // 2. CHECK NGẦM VỚI SERVER (Background Check)
  // Phần này chạy âm thầm bên dưới, không làm đơ màn hình của bạn
  try {
    const savedEmp = localStorage.getItem(EMPLOYEE_KEY) || "";
    if (savedEmp) {
      // Theo bản index trước đó chạy ổn: check_status chỉ cần employeeId + deviceInfo
      const query = `?action=check_status&employeeId=${encodeURIComponent(savedEmp)}&deviceInfo=${encodeURIComponent(navigator.userAgent)}`;

      const res = await fetch(ADMIN_SERVER_URL + query);
      const txt = await res.text();
      let result;
      try {
        result = JSON.parse(txt);
      } catch (e) {
        result = txt;
      }

      const status =
        result && typeof result === "object" && result.status
          ? String(result.status).toLowerCase()
          : typeof result === "string" &&
            result.toLowerCase().includes("locked")
            ? "locked"
            : "";
      const msg =
        result && typeof result === "object" && result.message
          ? result.message
          : "";
      if (status === "locked") {
        getEl("screen-lock").classList.add("hidden");
        getEl("setup-lock-modal").classList.add("hidden");
        const modal = getEl("activation-modal");
        modal.classList.remove("hidden");
        const titleEl = document.getElementById("activation-title");
        if (titleEl) titleEl.textContent = msg || "Tài khoản đã bị thu hồi!";
        localStorage.removeItem(ACTIVATED_KEY);
      }
    }
  } catch (err) {
    // Offline: bỏ qua check ngầm với server, app vẫn hoạt động bình thường
  }
}

/**
 * BẢO MẬT BACKUP V2:
 * - Không nhận "secret" cố định từ server nữa.
 * - Mỗi lần Backup/Restore sẽ:
 *   (1) issue_kdata (POST/GET fallback): nhận GLOBAL KDATA (base64url) để derive AES-GCM key
 * Nếu không nhận được kdata_b64u => coi như không đủ quyền backup/restore.
 */
// Helper dùng chung: xác thực & lấy GLOBAL KDATA trước khi backup/khôi phục.
// Trả về true nếu đã có khóa; nếu không thì hiện alert lý do và trả về false.
// Gom logic từng lặp lại nguyên khối ở backupData()/restoreData()/restoreBackupFromApp().
async function requireBackupSecretOrAlert() {
  if (typeof ensureBackupSecret === "function") {
    const sec = await ensureBackupSecret();
    if (!sec || !sec.ok || !APP_BACKUP_KDATA_B64U) {
      ErrorHandler.showError('AUTH', `Bảo mật: ${sec && sec.message ? sec.message : "Không thể lấy khóa bảo mật."} Vui lòng kết nối mạng và thử lại.`);
      return false;
    }
    return true;
  }
  if (!APP_BACKUP_KDATA_B64U) {
    ErrorHandler.showError('AUTH', "Bảo mật: Không thể backup khi đang ngoại tuyến hoặc chưa xác thực với máy chủ. Vui lòng kết nối mạng và mở lại App.");
    return false;
  }
  return true;
}

async function ensureBackupSecret() {
  const employeeId = localStorage.getItem(EMPLOYEE_KEY) || "";
  if (!employeeId) return { ok: false, message: "Chưa có mã nhân viên." };

  const deviceId = (typeof getDeviceId === "function") ? getDeviceId() : (localStorage.getItem("app_device_unique_id") || "");
  const cached = await _readCachedKdataAsync(employeeId, deviceId);
  if (cached && cached.kdata_b64u) APP_BACKUP_KDATA_B64U = cached.kdata_b64u;

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    if (APP_BACKUP_KDATA_B64U) {
      return { ok: true, source: "cache", message: "Đang offline, dùng khóa KDATA đã lưu tạm." };
    }
    return { ok: false, message: "Thiết bị đang Offline và chưa có khóa KDATA tạm." };
  }

  try {
    // issue_kdata: Ưu tiên POST (nếu GAS cho phép), fallback sang GET.
    // Không check_status định kỳ ở client để tránh chặn app khi mạng/GAS dao động.
    // Lưu ý: nhiều WebApp GAS có thể gặp redirect/CORS với POST JSON trên một số trình duyệt/PWA.
    let kdTxt = "";
    let kd = null;

    // 2a) Try POST JSON
    try {
      const kdRes = await fetch(ADMIN_SERVER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "issue_kdata", employeeId, deviceId }),
      });
      kdTxt = await kdRes.text();
      try { kd = JSON.parse(kdTxt); } catch (e) { kd = null; }
      if (kd && kd.status === "success" && kd.kdata_b64u) {
        APP_BACKUP_KDATA_B64U = String(kd.kdata_b64u);
        _writeCachedKdata(employeeId, deviceId, APP_BACKUP_KDATA_B64U);
        return { ok: true };
      }
    } catch (e) {
      // ignore -> fallback GET
    }

    // 2b) Fallback GET querystring
    try {
      const kdUrl = `${ADMIN_SERVER_URL}?action=issue_kdata&employeeId=${encodeURIComponent(employeeId)}&deviceId=${encodeURIComponent(deviceId)}`;
      const kdRes2 = await fetch(kdUrl);
      kdTxt = await kdRes2.text();
      try { kd = JSON.parse(kdTxt); } catch (e) { kd = null; }
      if (kd && kd.status === "success" && kd.kdata_b64u) {
        APP_BACKUP_KDATA_B64U = String(kd.kdata_b64u);
        _writeCachedKdata(employeeId, deviceId, APP_BACKUP_KDATA_B64U);
        return { ok: true };
      }
    } catch (e) {
      // ignore
    }

    const kdStatus = (kd && typeof kd === "object" && kd.status) ? String(kd.status).toLowerCase() : "";
    const kdMsg = (kd && typeof kd === "object" && kd.message) ? String(kd.message) : "";

    // Rate-limit của issue_kdata (GAS giới hạn 30s/lần) là giới hạn tần suất, KHÔNG phải
    // từ chối quyền -> dùng khóa đã cache (vd AuthGate.preflight vừa lấy lúc mở app).
    if (/rate.?limited/i.test(kdMsg) && APP_BACKUP_KDATA_B64U) {
      return { ok: true, source: "cache", message: "Server đang giới hạn tần suất, dùng khóa KDATA đã lưu tạm." };
    }

    // Trường hợp server trả về denial rõ ràng thì KHÔNG dùng cache để vượt quyền.
    if (kdStatus === "locked") {
      try { localStorage.removeItem(ACTIVATED_KEY); } catch (e) {}
      return { ok: false, message: kdMsg || "Tài khoản đã bị thu hồi." };
    }
    if (kdStatus === "error" || kdMsg) {
      if (/device|thiết bị|không khớp/i.test(kdMsg)) {
        return { ok: false, message: "Thiết bị chưa được cấp quyền backup (Device ID không khớp)." };
      }
      if (/kích hoạt|activate|inactive|chưa/i.test(kdMsg)) {
        return { ok: false, message: "Tài khoản chưa được kích hoạt quyền backup." };
      }
      if (kdStatus === "error") return { ok: false, message: kdMsg || "Không đủ quyền lấy khóa KDATA." };
      if (kdMsg) return { ok: false, message: kdMsg };
    }

    // Chỉ fallback cache khi lỗi mơ hồ (network/CORS/parse/HTML lỗi), không phải denial rõ ràng.
    if (APP_BACKUP_KDATA_B64U) {
      return { ok: true, source: "cache", message: "Không lấy được KDATA mới, đang dùng khóa tạm đã lưu." };
    }
    return { ok: false, message: "Không lấy được khóa KDATA từ server." };
  } catch (e) {
    if (APP_BACKUP_KDATA_B64U) {
      return { ok: true, source: "cache", message: "Lỗi kết nối tạm thời, đang dùng khóa KDATA đã lưu." };
    }
    return { ok: false, message: "Không thể kết nối server để lấy khóa KDATA." };
  }
}
// Transfer key cache (in-memory, ngắn hạn) cho luồng gửi/nhận backup giữa các user.
const _transferKeyCache = {};
const TRANSFER_KEY_TTL_MS = 10 * 60 * 1000;

/**
 * Lấy "khóa chuyển" (transfer key) từ AdminAPI để mã hóa/giải mã backup gửi giữa các user.
 * - targetEmployeeId có giá trị => khóa hộp thư của NGƯỜI NHẬN (luồng gửi).
 * - Không truyền => khóa hộp thư của CHÍNH MÌNH (luồng nhận).
 * Khóa này derive theo label "transfer" phía server, KHÁC khóa cá nhân ("personal"),
 * nên biết transfer key của người nhận cũng không giải mã được backup cá nhân của họ.
 * @param {string} [targetEmployeeId]
 * @returns {Promise<string>} base64url 32 byte
 */
async function ensureTransferKey(targetEmployeeId) {
  const employeeId = localStorage.getItem(EMPLOYEE_KEY) || "";
  if (!employeeId) throw new Error("Chưa có mã nhân viên.");
  const deviceId = (typeof getDeviceId === "function") ? getDeviceId() : (localStorage.getItem("app_device_unique_id") || "");
  const target = String(targetEmployeeId || "").trim();
  const cacheKey = target || "_self";

  const cached = _transferKeyCache[cacheKey];
  if (cached && cached.key && (Date.now() - cached.ts) < TRANSFER_KEY_TTL_MS) {
    return cached.key;
  }

  const parseKey = (txt) => {
    let js = null;
    try { js = JSON.parse(txt); } catch (e) { js = null; }
    if (js && js.status === "success" && js.kdata_b64u) return String(js.kdata_b64u);
    return null;
  };

  // Ưu tiên POST JSON, fallback GET querystring (giống ensureBackupSecret).
  let key = null;
  try {
    const body = { action: "issue_transfer_key", employeeId, deviceId };
    if (target) body.toEmployeeId = target;
    const res = await fetch(ADMIN_SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    key = parseKey(await res.text());
  } catch (e) { /* fallback GET */ }

  if (!key) {
    let url = `${ADMIN_SERVER_URL}?action=issue_transfer_key&employeeId=${encodeURIComponent(employeeId)}&deviceId=${encodeURIComponent(deviceId)}`;
    if (target) url += `&toEmployeeId=${encodeURIComponent(target)}`;
    try {
      const res2 = await fetch(url);
      key = parseKey(await res2.text());
    } catch (e) { /* ignore */ }
  }

  if (!key) throw new Error("Không lấy được khóa chuyển (transfer key) từ server.");
  _transferKeyCache[cacheKey] = { key, ts: Date.now() };
  return key;
}

function openSecuritySetup() {
  // Mở giao diện thiết lập bảo mật mới. Không điền sẵn mã nhân viên vì dữ liệu trong localStorage đã được mã hóa.
  toggleMenu();
  getEl("setup-lock-modal").classList.remove("hidden");
  getEl("setup-pin").value = "";
  getEl("setup-answer").value = "";
}
function closeSetupModal() {
  // Chỉ cho đóng khi đã có PIN v2 — người dùng legacy bắt buộc hoàn tất nâng cấp 6 số.
  if (parseV2Envelope(localStorage.getItem(PIN_KEY))) {
    getEl("setup-lock-modal").classList.add("hidden");
    const note = getEl("setup-pin-note");
    if (note) note.classList.add("hidden");
  } else {
    ErrorHandler.showWarning("Bạn cần tạo mã PIN 6 số để hoàn tất nâng cấp bảo mật!");
  }
}
async function saveSecuritySetup() {
  const pin = getEl("setup-pin").value;
  let ans = getEl("setup-answer").value.trim();
  if (!/^\d{6}$/.test(pin)) { ErrorHandler.showError('VALIDATION', "Mã PIN phải là 6 số"); return; }
  // Nếu người dùng không nhập mã nhân viên, lấy từ localStorage đã lưu khi kích hoạt (nếu có)
  if (!ans) {
    const storedEmp = localStorage.getItem(EMPLOYEE_KEY);
    if (storedEmp) {
      ans = storedEmp;
      // hiển thị lại cho người dùng biết
      getEl("setup-answer").value = storedEmp;
    } else {
      ErrorHandler.showError('VALIDATION', "Vui lòng nhập mã nhân viên"); return;
    }
  }
  // Lưu lại mã nhân viên đề phòng chưa lưu lúc kích hoạt
  localStorage.setItem(EMPLOYEE_KEY, ans);
  /* * Thiết lập bảo mật v2: * - Sinh masterKey nếu chưa tồn tại * - Niêm phong masterKey bằng PBKDF2 + AES-GCM với 2 secret: PIN 6 số (mở khóa hằng ngày) và mã nhân viên (khôi phục) */
  // Nếu masterKey chưa sinh (lần đầu thiết lập), tạo mới bằng CSPRNG (MK2)
  if (!masterKey) {
    masterKey = generateMasterKey();
  }
  // Dựng key GCM cho phiên (fresh install), hoặc giữ nguyên nếu đã cài từ unlock/recovery.
  await _installMasterKey(masterKey);
  const btn = getEl("setup-save-btn");
  const btnLabel = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Đang mã hóa..."; }
  try {
    localStorage.setItem(PIN_KEY, await sealMasterKey(pin, masterKey));
    localStorage.setItem(SEC_KEY, await sealMasterKey(ans, masterKey));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
  }
  resetPinFailures();
  // Gate bảo mật có thể hiện trước khi IndexedDB mở xong — chờ db để migration
  // không bị bỏ qua vì `!db`.
  try { if (window.__dbReady) await window.__dbReady; } catch (e) { }
  // Đảm bảo dữ liệu ở định dạng AES-GCM mới nhất (idempotent):
  // - Fresh install (MK2, không legacy) -> chỉ đánh dấu schema='2'.
  // - Sau khôi phục mà dữ liệu còn CryptoJS -> migrate ngay dưới PIN vừa đặt.
  try {
    await runFieldCryptoMigrationIfNeeded(pin, ans);
  } catch (e) {
    try { ErrorHandler.logError("crypto-migration", e); } catch (_) {}
  }
  try {
    await runImageCryptoMigrationIfNeeded();
  } catch (e) {
    try { ErrorHandler.logError("image-crypto-migration", e); } catch (_) {}
  }
  await primeFieldCache();
  if (typeof loadCustomers === "function") {
    await loadCustomers("");
  }
  // PIN vừa đổi: enrollment sinh trắc học cũ (nếu có) mã hóa PIN cũ nên không còn hợp lệ.
  try { if (window.BiometricUnlock) window.BiometricUnlock.onPinChanged(); } catch (e) { }
  // Ẩn hộp thoại và thông báo
  const note = getEl("setup-pin-note");
  if (note) note.classList.add("hidden");
  getEl("setup-lock-modal").classList.add("hidden");
  ErrorHandler.showSuccess("Đã lưu thiết lập bảo mật");
}
function showLockScreen() {
  getEl("screen-lock").classList.remove("hidden");
  const pinLen = getPinLength();
  const display = getEl("pin-display");
  if (display) display.innerHTML = '<div class="pin-dot"></div>'.repeat(pinLen);
  const subtitle = getEl("pin-subtitle");
  if (subtitle) subtitle.textContent = `Nhập mã PIN ${pinLen} số để truy cập`;
  currentPin = "";
  updatePinDots();
  updateLockoutUI();
}
function enterPin(num) {
  if (_pinChecking || getLockoutRemainingMs() > 0) {
    updateLockoutUI();
    return;
  }
  const pinLen = getPinLength();
  if (currentPin.length < pinLen) {
    currentPin += num;
    updatePinDots();
    if (currentPin.length === pinLen) validatePin();
  }
}
function clearPin() {
  currentPin = "";
  updatePinDots();
}
function updatePinDots() {
  const dots = document.querySelectorAll(".pin-dot");
  dots.forEach((d, i) => {
    if (i < currentPin.length) d.classList.add("filled");
    else d.classList.remove("filled");
  });
}
async function validatePin() {
  if (getLockoutRemainingMs() > 0) {
    updateLockoutUI();
    clearPin();
    return;
  }
  const encMaster = localStorage.getItem(PIN_KEY);
  _pinChecking = true;
  _setKeypadDisabled(true);
  let res = null;
  try {
    res = await unwrapMasterKeyAny(currentPin, encMaster);
  } finally {
    _pinChecking = false;
  }
  if (res && res.masterKey) {
    // Giải mã thành công: cài masterKey (dựng key GCM) — giữ lock đến khi load xong dữ liệu
    await _installMasterKey(res.masterKey);
    const pinForMigration = currentPin;
    const empForMigration = (localStorage.getItem(EMPLOYEE_KEY) || "").trim();
    currentPin = ""; // không giữ PIN trong bộ nhớ lâu hơn cần thiết
    resetPinFailures();
    _setKeypadDisabled(false);
    await completeUnlockDataLoad(pinForMigration, empForMigration);
    getEl("screen-lock").classList.add("hidden");
    // PIN cũ 4 số: bắt buộc tạo PIN 6 số mới (masterKey giữ nguyên, dữ liệu không đổi)
    if (res.legacy) _openForcedPinUpgrade();
  } else {
    registerPinFailure();
    _shakePinDots();
    clearPin();
    updateLockoutUI();
  }
}

function _openForcedPinUpgrade() {
  const modal = getEl("setup-lock-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  getEl("setup-pin").value = "";
  const storedEmp = localStorage.getItem(EMPLOYEE_KEY);
  if (storedEmp) getEl("setup-answer").value = storedEmp;
  const note = getEl("setup-pin-note");
  if (note) {
    note.textContent = "Nâng cấp bảo mật: vui lòng tạo mã PIN mới gồm 6 số. Dữ liệu của bạn được giữ nguyên.";
    note.classList.remove("hidden");
  }
}
function forgotPin() {
  getEl("forgot-pin-modal").classList.remove("hidden");
}
function closeForgotModal() {
  getEl("forgot-pin-modal").classList.add("hidden");
}
async function checkRecovery() {
  const input = getEl("recovery-answer").value.trim();
  const encMaster = localStorage.getItem(SEC_KEY);
  if (getLockoutRemainingMs() > 0) {
    ErrorHandler.showWarning("Sai quá nhiều lần. Vui lòng chờ hết thời gian khóa rồi thử lại.");
    return;
  }
  // Chấp nhận cả SEC_KEY legacy lẫn v2; input untrimmed cũ vẫn khớp vì setup luôn trim
  const res = await unwrapMasterKeyAny(input, encMaster);
  if (res && res.masterKey) {
    // Khôi phục masterKey (cài key GCM/legacy) và cho phép đặt lại PIN 6 số.
    // Migration (nếu dữ liệu còn CryptoJS) sẽ chạy trong saveSecuritySetup dưới PIN mới.
    await _installMasterKey(res.masterKey);
    resetPinFailures();
    ErrorHandler.showSuccess("Xác thực thành công. Vui lòng tạo PIN mới.");
    closeForgotModal();
    // Ẩn màn hình khóa, mở modal thiết lập PIN mới
    getEl("screen-lock").classList.add("hidden");
    getEl("setup-lock-modal").classList.remove("hidden");
    getEl("setup-pin").value = "";
    // điền sẵn mã nhân viên để người dùng không cần gõ lại
    getEl("setup-answer").value = input;
  } else {
    // Cửa khôi phục cũng có thể bị đoán mò -> dùng chung bộ đếm lockout với PIN
    registerPinFailure();
    updateLockoutUI();
    ErrorHandler.showError('AUTH', "Mã nhân viên không khớp!");
  }
}

/** Xử lý kích hoạt ứng dụng bằng cách gửi mã key và mã nhân viên lên server. */
async function activateApp() {
  const keyInput = getEl("activation-key");
  const empInput = getEl("activation-employee");
  const key = keyInput ? keyInput.value.trim() : "";
  const employeeId = empInput ? empInput.value.trim() : "";

  if (!key || !employeeId) {
    ErrorHandler.showError('VALIDATION', "Vui lòng nhập đầy đủ Mã kích hoạt và Mã nhân viên");
    return;
  }

  const deviceId = getDeviceId();
  const scriptUrl = ADMIN_SERVER_URL;
  const query = `?action=activate&key=${encodeURIComponent(key)}&employeeId=${encodeURIComponent(employeeId)}&deviceId=${encodeURIComponent(deviceId)}&deviceInfo=${encodeURIComponent(navigator.userAgent)}`;

  try {
    const res = await fetch(scriptUrl + query);
    let result;
    const txt = await res.text();
    try {
      result = JSON.parse(txt); // Thử chuyển nó sang JSON
    } catch (e) {
      result = txt; // Nếu không chuyển được thì giữ nguyên là text
    }
    // Kiểm tra thành công: server có thể trả về {status:'success'} hoặc 'success'
    if (
      (result &&
        result.status &&
        String(result.status).toLowerCase() === "success") ||
      String(result).toLowerCase().includes("success")
    ) {
      // Thành công: xử lý tùy theo máy mới hay tái kích hoạt.
      // Server không trả secret khi kích hoạt; backup/restore tự lấy KDATA qua ensureBackupSecret().
      const hasOldData = !!localStorage.getItem(SEC_KEY);
      if (!hasOldData) {
        // Trường hợp máy mới: Lưu trạng thái kích hoạt và yêu cầu tạo PIN mới
        localStorage.setItem(ACTIVATED_KEY, "true");
        localStorage.setItem(EMPLOYEE_KEY, employeeId);
        // Prefetch KDATA sớm để user mới dùng backup/restore được ngay.
        try { await ensureBackupSecret(); } catch (e) { }
        const modal = getEl("activation-modal");
        if (modal) modal.classList.add("hidden");
        // Hiển thị thiết lập PIN
        getEl("setup-lock-modal").classList.remove("hidden");
        getEl("setup-pin").value = "";
        getEl("setup-answer").value = employeeId;
        ErrorHandler.showSuccess("Kích hoạt thành công! Vui lòng tạo mã PIN.");
      } else {
        // Tái kích hoạt trên máy đã có dữ liệu: xác thực mã nhân viên (nhận cả định dạng cũ và v2)
        const encMaster = localStorage.getItem(SEC_KEY);
        const recovered = await unwrapMasterKeyAny(employeeId, encMaster);
        if (recovered && recovered.masterKey) {
          // Đúng nhân viên cũ: cài masterKey (key GCM/legacy), giữ nguyên dữ liệu
          await _installMasterKey(recovered.masterKey);
          // Nhân tiện nâng cấp SEC_KEY lên v2 nếu còn định dạng cũ
          if (recovered.legacy) {
            try { localStorage.setItem(SEC_KEY, await sealMasterKey(employeeId, masterKey)); } catch (e) { }
          }
          localStorage.setItem(ACTIVATED_KEY, "true");
          localStorage.setItem(EMPLOYEE_KEY, employeeId);
          try { await ensureBackupSecret(); } catch (e) { }
          const modal = getEl("activation-modal");
          if (modal) modal.classList.add("hidden");
          // Nếu đã có PIN, yêu cầu nhập PIN cũ để vào
          if (localStorage.getItem(PIN_KEY)) {
            ErrorHandler.showSuccess("Gia hạn thành công! Dữ liệu cũ vẫn an toàn.");
            showLockScreen();
          } else {
            // Nếu vì lý do nào đó không có PIN, cho tạo mới
            getEl("setup-lock-modal").classList.remove("hidden");
            getEl("setup-pin").value = "";
            getEl("setup-answer").value = employeeId;
            ErrorHandler.showSuccess("Gia hạn thành công! Vui lòng tạo PIN mới.");
          }
        } else {
          // Nhân viên khác: cảnh báo và hỏi xác nhận để xóa dữ liệu cũ
          const confirmDel = await ErrorHandler.confirm(
            "Phát hiện dữ liệu của nhân viên khác. Tiếp tục sẽ XÓA SẠCH dữ liệu cũ trên thiết bị này. Bạn có chắc chắn?",
            { title: "Xóa dữ liệu cũ?", danger: true, confirmText: "Xóa & Kích hoạt" }
          );
          if (confirmDel) {
            try {
              // Xóa toàn bộ localStorage và CSDL
              localStorage.clear();
              indexedDB.deleteDatabase(DB_NAME);
            } catch (e) { }
            // Đặt lại toàn bộ vật liệu khóa và lưu trạng thái kích hoạt mới
            clearMasterKeyMaterial();
            localStorage.setItem(ACTIVATED_KEY, "true");
            localStorage.setItem(EMPLOYEE_KEY, employeeId);
            try { await ensureBackupSecret(); } catch (e) { }
            const modal = getEl("activation-modal");
            if (modal) modal.classList.add("hidden");
            // Cho phép tạo PIN mới
            getEl("setup-lock-modal").classList.remove("hidden");
            getEl("setup-pin").value = "";
            getEl("setup-answer").value = employeeId;
            ErrorHandler.showSuccess("Đã kích hoạt cho người dùng mới, vui lòng tạo PIN.");
          }
          // Nếu không đồng ý, không làm gì cả
        }
      }
    } else {
      let msg = "Kích hoạt thất bại. Vui lòng kiểm tra Key của bạn.";
      if (result && result.message) msg = result.message;
      ErrorHandler.showError('AUTH', msg);
    }
  } catch (err) {
    ErrorHandler.showError('NETWORK', "Lỗi kết nối khi kích hoạt. Vui lòng kiểm tra mạng và thử lại.", err);
  }
}

// ============================================================
// Tự khóa khi ẩn app (vuốt về màn hình chính / chuyển app).
// Ẩn quá AUTO_LOCK_HIDDEN_MS thì lockApp(): timer best-effort chạy lúc nền,
// kèm kiểm tra bù khi hiện lại (timer nền có thể bị trình duyệt throttle).
// Trễ 15s để không khóa oan các thao tác làm trang tạm "hidden" trên mobile
// (file picker nhập .cpb, share sheet, cấp quyền GPS, chuyển app nhanh).
// ============================================================
const AUTO_LOCK_HIDDEN_MS = 15000;
let _autoLockHiddenAt = 0;
let _autoLockTimer = null;
let _autoLockedWhileHidden = false;

function _onAppHiddenForAutoLock() {
  if (!isAppUnlocked() || !localStorage.getItem(PIN_KEY)) return;
  _autoLockHiddenAt = Date.now();
  if (_autoLockTimer) clearTimeout(_autoLockTimer);
  _autoLockTimer = setTimeout(() => {
    _autoLockTimer = null;
    // Re-check: người dùng có thể đã quay lại trước khi timer nổ.
    if (document.hidden && isAppUnlocked()) {
      lockApp();
      _autoLockedWhileHidden = true;
    }
  }, AUTO_LOCK_HIDDEN_MS);
}

function _onAppVisibleForAutoLock() {
  if (_autoLockTimer) { clearTimeout(_autoLockTimer); _autoLockTimer = null; }
  const hiddenAt = _autoLockHiddenAt;
  _autoLockHiddenAt = 0;
  // Bù cho timer bị throttle lúc nền: ẩn đủ lâu mà vẫn chưa khóa thì khóa ngay.
  if (hiddenAt > 0 && Date.now() - hiddenAt >= AUTO_LOCK_HIDDEN_MS && isAppUnlocked()) {
    lockApp();
  }
  // Khóa xảy ra lúc app còn ẩn: MutationObserver của sinh trắc học đã chạy khi
  // hasFocus()=false nên chưa auto-prompt; nudge lại khi hiện.
  if (_autoLockedWhileHidden) {
    _autoLockedWhileHidden = false;
    try { if (window.BiometricUnlock) window.BiometricUnlock.tryUnlock(true); } catch (e) {}
  }
}

// Guard: test harness (tests/helpers/load-security.js) stub document không có addEventListener.
try {
  if (typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) _onAppHiddenForAutoLock();
      else _onAppVisibleForAutoLock();
    });
    // bfcache restore không phát visibilitychange trên mọi trình duyệt.
    window.addEventListener("pageshow", () => { if (!document.hidden) _onAppVisibleForAutoLock(); });
  }
} catch (e) {}

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
// "Thế hệ khóa": tăng mỗi lần cài (_installMasterKey) hoặc xóa
// (clearMasterKeyMaterial) masterKey. Công việc crypto bất đồng bộ phải chụp lại
// thế hệ lúc bắt đầu và chỉ ghi kết quả vào RAM nếu thế hệ chưa đổi — nếu không,
// một phiên vừa bị khóa/thu hồi sẽ nhận lại key hoặc plaintext ngay sau khi xóa.
let __keyGeneration = 0;
// Số thứ tự "lượt mở khóa": mỗi lần người dùng khởi động một phiên mới (validatePin,
// checkRecovery, saveSecuritySetup) mở đúng một lượt. KHÔNG dùng __keyGeneration cho
// việc này: migration legacy bên trong pipeline unlock cố ý cài khóa mới và bump
// generation, nên so generation sẽ nhầm "chính mình" thành "đã bị tiếp quản". Lượt cũ
// tỉnh dậy sau một lượt mới phải im lặng rút lui, không được đổi UI của lượt mới.
let __unlockAttemptSeq = 0;
// Migration legacy CryptoJS→GCM đã cài MK2 làm khóa phiên nhưng CHƯA finalize:
// PIN_KEY/SEC_KEY vẫn niêm phong khóa legacy, và các record U2FsdGVk… còn lại chỉ
// đọc được bằng khóa legacy đó. Niêm phong lại PIN/SEC bằng masterKey hiện tại
// (= MK2) trong cửa sổ này sẽ VỨT BỎ khóa legacy vĩnh viễn -> lần mở app sau nhánh
// resume-after-swap thấy PIN_KEY là envelope v2, set SCHEMA_KEY="2" và các record
// legacy còn lại không bao giờ giải mã được nữa. Cờ này chặn mọi đường re-seal
// (nâng cấp PIN bắt buộc, saveSecuritySetup) cho tới khi migration hoàn tất.
let __legacyMigrationUnfinished = false;
// Mã nhân viên là secret khôi phục masterKey (SEC_KEY được niêm phong dưới nó)
// nên KHÔNG được persist plaintext lâu dài — plaintext nằm cạnh envelope là
// bypass PIN cho bất kỳ ai đọc được localStorage. Bản plaintext EMPLOYEE_KEY
// chỉ tồn tại trong cửa sổ kích hoạt → tạo PIN (chưa có masterKey) và trên
// thiết bị cũ chưa migrate; lần mở khóa đầu tiên seal vào EMPLOYEE_SEALED_KEY
// rồi xóa plaintext (runEmployeeIdSealMigrationIfNeeded).
const EMPLOYEE_SEALED_KEY = "app_employee_id_sealed_v1";
let __employeeIdPlain = null; // RAM sau unlock — xóa trong clearMasterKeyMaterial()

/** Nguồn mã NV hợp nhất: RAM (sau unlock) → plaintext (cửa sổ kích hoạt / legacy). */
function _resolveEmployeeId() {
  if (__employeeIdPlain) return String(__employeeIdPlain).trim();
  try { return (localStorage.getItem(EMPLOYEE_KEY) || "").trim(); } catch (e) { return ""; }
}

/** Seal mã NV dưới masterKey → ghi → đọc lại xác minh (mẫu _writeCachedKdata). */
async function _writeSealedEmployeeId(emp) {
  const val = String(emp || "").trim();
  if (!val || !masterCryptoKey) return false;
  try {
    const sealed = await _gcmEncryptField(val);
    localStorage.setItem(EMPLOYEE_SEALED_KEY, sealed);
    const back = localStorage.getItem(EMPLOYEE_SEALED_KEY) || "";
    if (back !== sealed) return false;
    return (await _gcmDecryptField(back)) === val;
  } catch (e) {
    return false;
  }
}

/** Đọc mã NV sealed. Đã mở khóa mà unseal fail (sai khóa/tamper) → xóa key chết. */
async function _readSealedEmployeeIdAsync() {
  try {
    const sealed = localStorage.getItem(EMPLOYEE_SEALED_KEY) || "";
    if (!sealed) return "";
    if (!masterCryptoKey || !sealed.startsWith(GCM_PREFIX)) return "";
    try {
      return String((await _gcmDecryptField(sealed)) || "").trim();
    } catch (e) {
      try { localStorage.removeItem(EMPLOYEE_SEALED_KEY); } catch (e2) {}
      return "";
    }
  } catch (e) { return ""; }
}

/**
 * Migration một lần sau unlock: seal EMPLOYEE_KEY plaintext dưới masterKey rồi
 * XÓA bản plaintext (chỉ xóa sau khi ghi + xác minh thành công). Idempotent —
 * máy đã migrate chỉ nạp sealed vào RAM.
 */
async function runEmployeeIdSealMigrationIfNeeded() {
  if (!masterCryptoKey) return;
  // Mã NV là secret khôi phục masterKey -> cũng phải theo thế hệ khóa: khóa/thu hồi
  // xen giữa các await dưới đây thì không được nạp lại nó vào RAM.
  const gen = __keyGeneration;
  let plain = "";
  try { plain = (localStorage.getItem(EMPLOYEE_KEY) || "").trim(); } catch (e) {}
  if (plain) {
    if (await _writeSealedEmployeeId(plain)) {
      try { localStorage.removeItem(EMPLOYEE_KEY); } catch (e) {}
    }
    if (gen !== __keyGeneration) return;
    __employeeIdPlain = plain;
    return;
  }
  if (!__employeeIdPlain) {
    const sealedPlain = await _readSealedEmployeeIdAsync();
    if (gen !== __keyGeneration) return;
    __employeeIdPlain = sealedPlain;
  }
  // RAM có (vừa nhập tay ở setup/recovery dưới key legacy) mà sealed chưa ghi
  // được trước đó -> ghi bù ngay khi đã có key GCM.
  if (__employeeIdPlain && !localStorage.getItem(EMPLOYEE_SEALED_KEY)) {
    try { await _writeSealedEmployeeId(__employeeIdPlain); } catch (e) {}
  }
}

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
            const gen = __keyGeneration;
            const key = masterCryptoKey;
            const kdata = await _gcmDecryptField(sealed);
            // Auto-lock/thu hồi xen giữa await: bỏ kết quả, nhưng KHÔNG xóa cache tốt
            // chỉ vì phiên hiện tại đã mất khóa trước khi Promise hoàn tất.
            if (gen !== __keyGeneration || key !== masterCryptoKey || !masterKey) return null;
            if (kdata) {
              // Đã có v2 sealed dùng được -> v1 plaintext legacy (nếu còn) là rủi ro
              // thuần, dọn NGAY (độc lập với việc migrate v1). Vá B3: v1 không được
              // tồn tại vô thời hạn sau khi người dùng đã có cache v2 hợp lệ.
              try { if (localStorage.getItem(BACKUP_KDATA_CACHE_KEY)) localStorage.removeItem(BACKUP_KDATA_CACHE_KEY); } catch (e3) {}
              return { ts, kdata_b64u: kdata };
            }
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

  const gen = __keyGeneration;
  const key = masterCryptoKey;
  try {
    const sealed = await _gcmEncryptField(kdata);
    if (gen !== __keyGeneration || key !== masterCryptoKey || !masterKey) return false;
    localStorage.setItem(
      BACKUP_KDATA_CACHE_KEY_V2,
      JSON.stringify({ ts, identity, sealed })
    );
    // Đọc lại + unseal xác minh trước khi coi là thành công (an toàn dữ liệu).
    const back = _parseKdataEnvelope(localStorage.getItem(BACKUP_KDATA_CACHE_KEY_V2) || "");
    if (!back || String(back.sealed || "") !== sealed) return false;
    const verify = await _gcmDecryptField(String(back.sealed));
    if (gen !== __keyGeneration || key !== masterCryptoKey || !masterKey) return false;
    return verify === kdata;
  } catch (e) {
    return false;
  }
}

/** Flush KDATA đang chờ trong RAM xuống sealed cache sau khi unlock. Idempotent. */
async function _flushPendingKdataCache() {
  if (!__pendingKdataCache || !masterCryptoKey) return;
  const pending = __pendingKdataCache;
  const gen = __keyGeneration;
  const key = masterCryptoKey;
  if (Date.now() - pending.ts > BACKUP_KDATA_CACHE_TTL_MS) {
    if (__pendingKdataCache === pending) __pendingKdataCache = null;
    return;
  }
  try {
    const sealed = await _gcmEncryptField(pending.kdata_b64u);
    if (gen !== __keyGeneration || key !== masterCryptoKey || !masterKey) return;
    localStorage.setItem(
      BACKUP_KDATA_CACHE_KEY_V2,
      JSON.stringify({ ts: pending.ts, identity: pending.identity, sealed })
    );
    // Chỉ nhả ĐÚNG pending đã persist; request mới có thể đã thay thế trong lúc await.
    if (__pendingKdataCache === pending) __pendingKdataCache = null;
  } catch (e) {}
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

/**
 * Mã hóa 1 field bằng AES-GCM (async). Seed cache chỉ khi phiên khóa vẫn còn hiệu lực.
 *
 * WebCrypto không thể bị hủy sau khi đã bắt đầu. Vì vậy phải chụp cả generation và
 * CryptoKey trước await; nếu auto-lock/thu hồi/đổi khóa xảy ra giữa chừng thì ném
 * STALE_KEY_GENERATION, không trả ciphertext cho caller và tuyệt đối không nạp lại
 * plaintext vào cache của phiên đã chết.
 */
async function _gcmEncryptField(plain) {
  const gen = __keyGeneration;
  const key = masterCryptoKey;
  if (!key) throw new Error("MASTER_KEY_UNAVAILABLE");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(String(plain)));
  if (gen !== __keyGeneration || key !== masterCryptoKey || !masterKey) {
    throw new Error("STALE_KEY_GENERATION");
  }
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
    const gen = __keyGeneration;
    let ownPromise;
    ownPromise = _gcmDecryptField(s).then((pt) => {
      // Khóa/thu hồi xảy ra giữa lúc giải mã: KHÔNG nạp plaintext trở lại cache
      // của phiên vừa bị xóa, và cũng không trả plaintext cho caller — caller cũ
      // (vd _ensureSummaryDecryptedAsync, 05_customers.js) sẽ ghi tiếp giá trị đó
      // vào __custSummaryCache/__custSearchBlobCache mà clearMasterKeyMaterial()
      // vừa dọn sạch. Trả nguyên ciphertext: mọi đường render đã chặn ciphertext
      // bằng _looksEncrypted và hiện placeholder.
      if (gen !== __keyGeneration) return s;
      __fieldPlainCache.set(s, pt);
      return pt;
    }).catch(() => s).finally(() => {
      // Chỉ dọn entry pending CỦA CHÍNH MÌNH: phiên mở khóa mới có thể đã tạo
      // pending khác cho cùng ciphertext, xóa nhầm nó là bỏ dedupe và để lại một
      // promise không ai theo dõi.
      if (__fieldDecryptPending.get(s) === ownPromise) __fieldDecryptPending.delete(s);
    });
    pending = ownPromise;
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
 *
 * FAIL-CLOSED: nếu thế hệ khóa đổi giữa lúc importKey đang await (auto-lock 60s,
 * lockApp, revokeUnlockedSession, hoặc một _installMasterKey khác), hàm THROW
 * STALE_KEY_GENERATION thay vì return im lặng. Trả về bình thường sẽ khiến caller
 * tưởng khóa đã cài và chạy tiếp với masterKey=null — đường nguy hiểm nhất là
 * saveSecuritySetup/checkRecovery seal PIN_KEY/SEC_KEY bằng "null", ghi đè envelope
 * DUY NHẤT mở được dữ liệu. Mọi caller phải bắt lỗi và dừng TRƯỚC khi ghi envelope,
 * chạy pipeline unlock hoặc đổi UI (xem CLAUDE.md · Unlock lifecycle).
 */
async function _installMasterKey(mkStr) {
  // Mở một "thế hệ khóa" mới: mọi công việc bất đồng bộ bắt đầu từ thế hệ trước
  // (import key, giải mã field, prime cache) không được ghi kết quả vào RAM nữa.
  const gen = ++__keyGeneration;
  // Đổi khóa -> cache plaintext của khóa cũ không còn hợp lệ (chống rò rỉ chéo khóa).
  __fieldPlainCache.clear();
  masterKey = mkStr;
  if (mkStr && mkStr.startsWith("MK2:")) {
    const bytes = _b64DecodeToBytes(mkStr.slice(4));
    const key = await crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    // lockApp()/revokeUnlockedSession() xảy ra GIỮA await importKey: gán tiếp là
    // hồi sinh khóa cho một phiên đã bị khóa/thu hồi. Bỏ kết quả, xóa bytes vừa dựng.
    // KHÔNG chạm masterKey/masterCryptoKey: phiên mới (hoặc clearMasterKeyMaterial)
    // đã sở hữu chúng, ghi đè ở đây là phá đúng phiên đang hợp lệ.
    if (gen !== __keyGeneration) {
      try { bytes.fill(0); } catch (e) {}
      throw new Error("STALE_KEY_GENERATION");
    }
    masterKeyBytes = bytes;
    masterCryptoKey = key;
    masterKeyLegacy = null;
  } else {
    masterKeyLegacy = mkStr || null;
    masterKeyBytes = null;
    masterCryptoKey = null;
  }
}

/** Nhận diện lỗi "thế hệ khóa đã đổi giữa chừng" ở phía caller. */
function _isStaleKeyInstall(e) {
  return !!e && String((e && e.message) || e) === "STALE_KEY_GENERATION";
}

/** Xóa mọi vết khóa + plaintext khỏi RAM khi khóa app / ẩn tab (giới hạn tuổi thọ). */
function clearMasterKeyMaterial() {
  // Đóng thế hệ khóa hiện tại TRƯỚC khi xóa: mọi promise crypto đang bay (import
  // key, giải mã field, prime cache) thấy thế hệ đã đổi và bỏ kết quả thay vì ghi
  // ngược key/plaintext vào RAM của phiên vừa bị khóa/thu hồi.
  __keyGeneration++;
  if (masterKeyBytes) { try { masterKeyBytes.fill(0); } catch (e) {} }
  masterKey = null; masterKeyBytes = null; masterCryptoKey = null; masterKeyLegacy = null;
  // Phiên kết thúc -> không còn cửa sổ "MK2 đã cài nhưng PIN/SEC còn legacy".
  // Lần unlock sau sẽ tự bật lại cờ nếu migration vẫn dở dang.
  __legacyMigrationUnfinished = false;
  // KDATA plaintext cũng là secret trong RAM -> xóa khi khóa (sealed v2 trong
  // localStorage giữ nguyên vì đã là ciphertext).
  APP_BACKUP_SECRET = "";
  APP_BACKUP_KDATA_B64U = "";
  __pendingKdataCache = null;
  // Transfer key là secret RAM gắn với đúng phiên/identity — không được sống qua lock/revoke.
  try { Object.keys(_transferKeyCache).forEach((k) => { delete _transferKeyCache[k]; }); } catch (e) {}
  // Mã NV plaintext trong RAM cũng là secret khôi phục -> xóa cùng lúc với khóa.
  __employeeIdPlain = null;
  __fieldPlainCache.clear();
  __fieldDecryptPending.clear();
  // Cache plaintext của danh sách KH (summary + blob tìm kiếm, 05_customers.js)
  // cũng là secret trong RAM -> xóa cùng lúc với __fieldPlainCache khi khóa.
  try { if (window.__custSummaryCache) window.__custSummaryCache.clear(); } catch (e) {}
  try { if (window.__custSearchBlobCache) window.__custSearchBlobCache.clear(); } catch (e) {}
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
 * Thu hồi phiên đang mở khóa: xóa NGAY toàn bộ vật liệu khóa trong RAM
 * (masterKey, KDATA, mã NV, cache plaintext) khi server báo tài khoản bị khóa /
 * sai thiết bị.
 *
 * KHÔNG dùng lockApp() cho việc này: các đường thu hồi xóa PIN_KEY, mà lockApp()
 * return sớm khi không còn PIN_KEY -> gọi sau đó là vô tác dụng. Vì vậy phải gọi
 * hàm này TRƯỚC khi xóa ACTIVATED_KEY/PIN_KEY.
 */
function revokeUnlockedSession() {
  try { clearMasterKeyMaterial(); } catch (e) {}
  currentPin = "";
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
        const gen = __keyGeneration;
        // Khóa xen giữa await -> không nạp token plaintext vào cache đã bị xóa.
        try {
          const pt = await _gcmDecryptField(inner);
          if (gen === __keyGeneration) __fieldPlainCache.set(inner, pt);
        } catch (e) {}
      }
    }
  } catch (e) {}
}

// ============================================================
// Image at-rest encryption (field `data` trong store images)
// ============================================================
const IMG_SCHEMA_KEY = "app_image_crypto_schema_v";
// Giá trị marker "hoàn tất". "1" là của bản cũ và KHÔNG còn tin được: bản đó set
// marker kể cả khi auto-lock làm ảnh bị ghi plaintext kèm imgCryptoV=1. Máy đang
// dừng ở "1" phải được quét lại đúng một lượt để cứu số ảnh đó -> mốc hoàn tất
// mới là "2". Đừng hạ ngưỡng này về "1".
const IMG_SCHEMA_DONE = "2";

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
  if (localStorage.getItem(IMG_SCHEMA_KEY) === IMG_SCHEMA_DONE) return;
  if (!masterCryptoKey || typeof db === "undefined" || !db) return;

  const looksEnc = (v) => (typeof _looksEncrypted === "function")
    ? _looksEncrypted(v)
    : (typeof v === "string" && (v.startsWith("U2FsdGVk") || v.startsWith(GCM_PREFIX)));

  // Quét theo KEY rồi đọc từng bản ghi thay vì getAll(): ảnh là data URL nặng,
  // getAll() nạp cả store vào RAM một lúc — lượt quét lại này chạy trên MỌI máy
  // (kể cả máy đã ở marker "1") nên không được phình bộ nhớ trên máy nhiều ảnh.
  //
  // Đọc lỗi KHÔNG được coi là "không có ảnh nào": coi rỗng thì failures=0 và
  // marker set sai -> ảnh plaintext không bao giờ được migrate nữa (cùng lý do
  // đã xử lý ở runFieldEncryptMigrationV2IfNeeded).
  let keys;
  try {
    keys = await new Promise((resolve, reject) => {
      try {
        const req = db.transaction(["images"], "readonly").objectStore("images").getAllKeys();
        req.onsuccess = (e) => resolve(e.target.result || []);
        req.onerror = () => reject(req.error || new Error("IMG_MIGR_READ_ERROR"));
      } catch (e) { reject(e); }
    });
  } catch (e) {
    return; // không set marker -> lần mở khóa sau tự thử lại
  }

  let failures = 0;
  for (const key of keys) {
    try {
      const img = await new Promise((resolve, reject) => {
        try {
          const req = db.transaction(["images"], "readonly").objectStore("images").get(key);
          req.onsuccess = (e) => resolve(e.target.result);
          req.onerror = () => reject(req.error || new Error("IMG_MIGR_GET_ERROR"));
        } catch (e) { reject(e); }
      });
      // KHÔNG tin cờ imgCryptoV: bản cũ có thể đã đóng dấu 1 lên ảnh vẫn còn
      // plaintext (race auto-lock). Quyết định theo DỮ LIỆU THẬT.
      if (!img || !_isPlainImageDataUrl(img.data)) continue;
      const enc = await encryptImageData(img.data);
      // Race lockApp giữa migration: masterKey bị xóa -> encryptImageData trả
      // NGUYÊN data URL plaintext (fail-open). Không chốt chặn thì ảnh plaintext
      // bị ghi kèm imgCryptoV=1 và marker toàn cục set sai -> ảnh nằm plaintext
      // trong IndexedDB vĩnh viễn. Bắt buộc kết quả phải là ciphertext.
      if (!looksEnc(enc)) throw new Error("IMG_MIGR_NOT_ENCRYPTED");
      await new Promise((resolve, reject) => {
        img.data = enc;
        img.imgCryptoV = 1;
        // Resolve trên oncomplete (không phải put onsuccess) + reject cả onabort:
        // tx có thể abort KHÔNG kèm request error — thiếu onabort là promise treo
        // vĩnh viễn giữa unlock flow (mirror __imgTxDone, 08_images_camera.js).
        const tx = db.transaction(["images"], "readwrite");
        tx.objectStore("images").put(img);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Transaction error"));
        tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
      });
    } catch (e) {
      failures++;
    }
  }

  if (failures === 0) {
    localStorage.setItem(IMG_SCHEMA_KEY, IMG_SCHEMA_DONE);
  } else {
    try {
      ErrorHandler.showWarning(`Mã hóa ảnh chưa hoàn tất cho ${failures} ảnh — sẽ tự thử lại ở lần mở khóa sau.`);
    } catch (e) {}
  }
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
    // Race lockApp giữa migration: masterKey bị xóa -> encryptText trả NGUYÊN
    // plaintext (fail-open) và verify plaintext==plaintext vẫn "pass" -> record
    // sẽ bị ghi plaintext + marker set sai. Bắt buộc kết quả phải là ciphertext.
    if (!looksEnc(enc)) throw new Error("FIELD_MIGR_NOT_ENCRYPTED");
    const back = await decryptFieldAsync(enc);
    if (back !== s) throw new Error("FIELD_MIGR_VERIFY_MISMATCH");
    return enc;
  };

  // Đọc lỗi IndexedDB KHÔNG được coi là "danh sách rỗng" -> nếu coi rỗng thì
  // failures=0 và marker sẽ set sai, bỏ lỡ migrate vĩnh viễn. Reject để return
  // sớm mà KHÔNG set marker (lần unlock sau tự retry).
  let all;
  try {
    all = await new Promise((resolve, reject) => {
      try {
        const req = db.transaction(["customers"], "readonly").objectStore("customers").getAll();
        req.onsuccess = (e) => resolve(e.target.result || []);
        req.onerror = () => reject(req.error || new Error("FIELD_MIGR_READ_ERROR"));
      } catch (e) { reject(e); }
    });
  } catch (e) {
    try { ErrorHandler.showWarning("Mã hóa bổ sung tạm hoãn do lỗi đọc dữ liệu — sẽ tự thử lại ở lần mở khóa sau."); } catch (e2) {}
    return;
  }

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

/**
 * Nhả UI loading/keypad DÙNG CHUNG khi một lượt mở khóa bỏ dở.
 * Chỉ chủ vé hiện hành mới được dọn: lượt đã bị tiếp quản mà dọn spinner là bôi xóa
 * trạng thái của lượt đang chạy (người dùng tưởng xong và mở thêm lượt chồng nữa).
 */
function _releaseUnlockLoading(unlockAttempt) {
  if (unlockAttempt === undefined || unlockAttempt === __unlockAttemptSeq) {
    _setUnlockLoading(false);
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

/**
 * Sau khi xác thực PIN: migration + lazy prime + loadCustomers — giữ lock đến khi xong.
 * @param {number} [unlockAttempt] vé lượt mở khóa của caller (__unlockAttemptSeq).
 *   Bắt buộc trên mọi đường unlock thật: pipeline chỉ được chạy tiếp khi lượt của nó
 *   vẫn là lượt hiện hành. Thiếu vé (test/gọi nội bộ) thì chỉ còn kiểm generation.
 */
async function completeUnlockDataLoad(pinForMigration, empForMigration, unlockAttempt) {
  _setUnlockLoading(true, "Đang tải dữ liệu...");
  let pipelineGeneration = __keyGeneration;
  // Vé còn hiệu lực? isAppUnlocked() + generation KHÔNG đủ: một lượt mở khóa mới có
  // thể vừa gán masterKey nhưng chưa dựng xong khóa phái sinh, và pipeline cũ sẽ
  // "mượn" đúng phiên đó để chạy tiếp rồi phát clientpro:unlocked thay cho nó.
  const attemptCurrent = () => unlockAttempt === undefined || unlockAttempt === __unlockAttemptSeq;
  const alive = () => isAppUnlocked() && pipelineGeneration === __keyGeneration && attemptCurrent();
  try {
    try { if (window.__dbReady) await window.__dbReady; } catch (e) {}
    if (!alive()) return;
    try {
      await runFieldCryptoMigrationIfNeeded(pinForMigration, empForMigration, unlockAttempt);
    } catch (e) {
      try { ErrorHandler.logError("crypto-migration", e); } catch (_) {}
    }
    if (!isAppUnlocked()) return;
    // Legacy -> MK2 migration cài một key generation mới có chủ đích, nên ở đây phải
    // NHẬN generation mới. Chỉ nhận khi vé còn của lượt này: nếu một lượt mở khóa mới
    // đã tiếp quản, generation hiện tại là của NÓ — nhận vào là pipeline cũ chiếm
    // phiên mới, tải dữ liệu và phát clientpro:unlocked trước khi lượt mới sẵn sàng.
    if (!attemptCurrent()) return;
    pipelineGeneration = __keyGeneration;
    try {
      await runImageCryptoMigrationIfNeeded();
    } catch (e) {
      try { ErrorHandler.logError("image-crypto-migration", e); } catch (_) {}
    }
    if (!alive()) return;
    try {
      await runFieldEncryptMigrationV2IfNeeded();
    } catch (e) {
      try { ErrorHandler.logError("field-encrypt-migration-v2", e); } catch (_) {}
    }
    if (!alive()) return;
    // Mã NV: seal bản plaintext còn sót (máy legacy / vừa kích hoạt) rồi nạp RAM.
    try { await runEmployeeIdSealMigrationIfNeeded(); } catch (e) {}
    if (!alive()) return;
    await primeFieldCache();
    if (!alive()) return;
    try {
      if (typeof primeCustomerSummaryCache === "function") await primeCustomerSummaryCache();
    } catch (e) {}
    if (!alive()) return;
    try { await _flushPendingKdataCache(); } catch (e) {}
    if (!alive()) return;
    if (typeof loadCustomers === "function") {
      await loadCustomers((getEl("search-input") && getEl("search-input").value) || "");
    }
  } finally {
    // UI loading/keypad là DOM dùng chung. Lượt đã bị tiếp quản không được dọn nó:
    // lượt mới có thể còn đang import khóa / chạy migration, dọn ở đây là trả keypad
    // về giữa chừng và mở đường cho một lượt unlock chồng nữa. Chủ vé mới tự dọn
    // (qua finally của chính nó, hoặc _releaseUnlockLoading khi nó bỏ dở).
    _releaseUnlockLoading(unlockAttempt);
  }
  if (!alive()) return;
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

function _legacyMigrationAlive(gen, unlockAttempt) {
  const attemptCurrent = unlockAttempt === undefined || unlockAttempt === __unlockAttemptSeq;
  return attemptCurrent && gen === __keyGeneration && !!masterKey && !!masterCryptoKey;
}

function _getAllCustomerKeys() {
  return new Promise((resolve, reject) => {
    try {
      const req = db.transaction(["customers"], "readonly").objectStore("customers").getAllKeys();
      req.onsuccess = (e) => resolve(e.target.result || []);
      req.onerror = () => reject(req.error || new Error("LEGACY_MIGR_KEYS_READ_ERROR"));
    } catch (e) { reject(e); }
  });
}

/** Re-encrypt mọi field CryptoJS-legacy của 1 record sang AES-GCM. */
async function _reencryptRecord(c, legacyKey, migrationGen, unlockAttempt) {
  const decLegacy = (v) => {
    if (!(typeof v === "string" && v.startsWith("U2FsdGVk"))) return v;
    if (!_legacyMigrationAlive(migrationGen, unlockAttempt)) throw new Error("STALE_KEY_GENERATION");
    // "" LÀ plaintext hợp lệ: encryptText() mã hóa cả chuỗi rỗng (chỉ bỏ qua
    // undefined/null), nên build cũ đã ghi U2FsdGVk…("") cho phone/cccd/notes để
    // trống. Coi "" là hỏng thì migration abort ở MỌI lần mở khóa trên phần lớn
    // máy legacy.
    //
    // Nhưng CryptoJS KHÔNG ném khi sai khóa/ciphertext hỏng: nó gỡ padding rác,
    // trả WordArray có sigBytes ÂM và toString(Utf8) cũng ra "". Nhận "" ở ca đó
    // là ghi rỗng ĐÈ LÊN dữ liệu thật. Phân biệt bằng sigBytes: === 0 là rỗng thật,
    // khác 0 mà ra "" là hỏng -> fail-closed, giữ nguyên record cũ.
    let wa;
    try { wa = CryptoJS.AES.decrypt(v, legacyKey); }
    catch (e) { throw new Error("LEGACY_FIELD_DECRYPT_FAILED"); }
    if (!wa || typeof wa.sigBytes !== "number" || wa.sigBytes < 0) {
      throw new Error("LEGACY_FIELD_DECRYPT_FAILED");
    }
    let pt;
    try { pt = wa.toString(CryptoJS.enc.Utf8); }
    catch (e) { throw new Error("LEGACY_FIELD_DECRYPT_FAILED"); }
    if (!pt && wa.sigBytes !== 0) throw new Error("LEGACY_FIELD_DECRYPT_FAILED");
    return pt;
  };
  const conv = async (v) => {
    if (!(typeof v === "string" && v.startsWith("U2FsdGVk"))) return v;
    const enc = await _gcmEncryptField(decLegacy(v));
    if (!_legacyMigrationAlive(migrationGen, unlockAttempt)) throw new Error("STALE_KEY_GENERATION");
    return enc;
  };
  for (const k of ["name", "phone", "cccd", "notes", "creditLimit", "driveLink"]) {
    if (c[k] !== undefined) c[k] = await conv(c[k]);
  }
  if (Array.isArray(c.assets)) for (const a of c.assets) {
    for (const k of ["name", "link", "valuation", "loanValue", "area", "width", "onland", "year", "driveLink"]) {
      if (a[k] !== undefined) a[k] = await conv(a[k]);
    }
  }
  if (!_legacyMigrationAlive(migrationGen, unlockAttempt)) throw new Error("STALE_KEY_GENERATION");
  c.cryptoV = 2;
}

/** Re-encrypt token Drive (07_drive 'sealed.v1:') trong lúc còn legacyKey. */
async function _migrateDriveToken(legacyKey, migrationGen, unlockAttempt) {
  const tkKey = (typeof USER_TOKEN_KEY !== "undefined") ? USER_TOKEN_KEY : "app_user_script_token";
  const raw = (localStorage.getItem(tkKey) || "").trim();
  if (!raw.startsWith("sealed.v1:")) return true; // plaintext/empty -> getUserToken reseal sau
  const inner = raw.slice("sealed.v1:".length);
  if (inner.startsWith(GCM_PREFIX)) return true;
  if (!inner.startsWith("U2FsdGVk")) return true;
  // CryptoJS ném khi ciphertext hỏng (không chỉ trả rỗng) -> bắt cả hai kiểu thất bại.
  let pt = "";
  try { pt = CryptoJS.AES.decrypt(inner, legacyKey).toString(CryptoJS.enc.Utf8); } catch (e) { pt = ""; }
  // Token legacy không mở được bằng legacyKey thì sau này cũng không mở được (finalize
  // xoá masterKeyLegacy). Chặn cứng migration vì nó là đánh đổi sai: token là thứ user
  // nhập lại được, còn migration mã hoá bị treo vĩnh viễn thì không — mọi lần mở khoá
  // sẽ ném lại ở đây, SCHEMA_KEY không bao giờ thành "2" và PIN_KEY kẹt ở envelope
  // legacy. Bỏ qua token (KHÔNG ghi đè, KHÔNG xoá) và cho migration đi tiếp:
  // getUserToken() (07_drive.js) đã trả "" cho 'sealed.v1:' không giải mã được, nên
  // panel cấu hình Drive sẽ xin token mới và niêm phong lại đúng chuẩn GCM.
  if (!pt) return true;
  const enc = await _gcmEncryptField(pt);
  if (!_legacyMigrationAlive(migrationGen, unlockAttempt)) throw new Error("STALE_KEY_GENERATION");
  const next = "sealed.v1:" + enc;
  localStorage.setItem(tkKey, next);
  if ((localStorage.getItem(tkKey) || "") !== next) throw new Error("DRIVE_TOKEN_MIGR_WRITE_FAILED");
  return true;
}

/**
 * Chạy migration legacy nếu cần. Mọi lỗi đọc IDB, token hoặc đổi generation đều
 * dừng trước bước swap PIN/SEC/schema; stage được giữ nguyên để lần unlock sau resume.
 */
async function runFieldCryptoMigrationIfNeeded(pin, employeeId, unlockAttempt) {
  if (typeof db === "undefined" || !db) return;
  if (localStorage.getItem(SCHEMA_KEY) === "2") return;
  const attemptCurrent = () => unlockAttempt === undefined || unlockAttempt === __unlockAttemptSeq;
  if (!attemptCurrent()) return;

  if (!masterKeyLegacy && masterCryptoKey) {
    if (!attemptCurrent()) return;
    if (parseV2Envelope(localStorage.getItem(PIN_KEY))) {
      localStorage.setItem(SCHEMA_KEY, "2");
      localStorage.removeItem(PIN_STAGE); localStorage.removeItem(SEC_STAGE);
      __legacyMigrationUnfinished = false;
    }
    return;
  }
  if (!masterKeyLegacy) return;

  const legacyKey = masterKeyLegacy;
  let mkStr = null;
  const staged = localStorage.getItem(PIN_STAGE);
  if (staged) {
    mkStr = await openMasterKeyV2(pin, staged);
    if (!attemptCurrent()) return;
  }
  if (!mkStr) {
    mkStr = generateMasterKey();
    const pinStage = await sealMasterKey(pin, mkStr);
    if (!attemptCurrent()) return;
    localStorage.setItem(PIN_STAGE, pinStage);
    if (employeeId) {
      const secStage = await sealMasterKey(employeeId, mkStr);
      if (!attemptCurrent()) return;
      localStorage.setItem(SEC_STAGE, secStage);
    }
  }

  if (!attemptCurrent()) return;
  await _installMasterKey(mkStr);
  const migrationGen = __keyGeneration;
  if (!_legacyMigrationAlive(migrationGen, unlockAttempt) || masterKey !== mkStr) {
    throw new Error("LEGACY_MIGR_KEY_INSTALL_ABORTED");
  }
  masterKeyLegacy = legacyKey;
  __legacyMigrationUnfinished = true;

  const ids = await _getAllCustomerKeys();
  if (!_legacyMigrationAlive(migrationGen, unlockAttempt)) throw new Error("STALE_KEY_GENERATION");
  for (const id of ids) {
    if (!_legacyMigrationAlive(migrationGen, unlockAttempt)) throw new Error("STALE_KEY_GENERATION");
    const c = await new Promise((resolve, reject) => {
      try {
        const g = db.transaction(["customers"], "readonly").objectStore("customers").get(id);
        g.onsuccess = () => resolve(g.result);
        g.onerror = () => reject(g.error || new Error("LEGACY_MIGR_RECORD_READ_ERROR"));
      } catch (e) { reject(e); }
    });
    if (!_legacyMigrationAlive(migrationGen, unlockAttempt)) throw new Error("STALE_KEY_GENERATION");
    if (!c || c.cryptoV === 2) continue;
    await _reencryptRecord(c, legacyKey, migrationGen, unlockAttempt);
    if (!_legacyMigrationAlive(migrationGen, unlockAttempt)) throw new Error("STALE_KEY_GENERATION");
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["customers"], "readwrite");
      tx.objectStore("customers").put(c);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("LEGACY_MIGR_TX_ERROR"));
      tx.onabort = () => reject(tx.error || new Error("LEGACY_MIGR_TX_ABORT"));
    });
    if (!_legacyMigrationAlive(migrationGen, unlockAttempt)) throw new Error("STALE_KEY_GENERATION");
  }

  await _migrateDriveToken(legacyKey, migrationGen, unlockAttempt);
  if (!_legacyMigrationAlive(migrationGen, unlockAttempt)) throw new Error("STALE_KEY_GENERATION");

  const pinStage = localStorage.getItem(PIN_STAGE);
  if (!pinStage || !parseV2Envelope(pinStage)) throw new Error("LEGACY_MIGR_PIN_STAGE_MISSING");
  if (!_legacyMigrationAlive(migrationGen, unlockAttempt)) throw new Error("STALE_KEY_GENERATION");
  localStorage.setItem(PIN_KEY, pinStage);
  const secStage = localStorage.getItem(SEC_STAGE);
  if (secStage) localStorage.setItem(SEC_KEY, secStage);
  localStorage.setItem(SCHEMA_KEY, "2");
  localStorage.removeItem(PIN_STAGE); localStorage.removeItem(SEC_STAGE);
  masterKeyLegacy = null;
  __legacyMigrationUnfinished = false;
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
  // Rung máy kèm rung hình — chuẩn lock screen mobile (19_error_loading.js nạp sau,
  // nhưng validatePin chỉ chạy lúc runtime nên Haptics đã sẵn sàng; vẫn guard typeof).
  if (typeof Haptics !== "undefined" && Haptics.error) Haptics.error();
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
  const gen = __keyGeneration;
  const original = { name: cust.name, phone: cust.phone, cccd: cust.cccd };
  const [name, phone, cccd] = await Promise.all([
    decryptFieldAsync(original.name),
    decryptFieldAsync(original.phone),
    decryptFieldAsync(original.cccd),
  ]);
  // Một field có thể hoàn tất ngay trước auto-lock còn field khác hoàn tất sau đó.
  // Chỉ gán kết quả theo nhóm khi TOÀN BỘ Promise.all vẫn thuộc cùng phiên khóa.
  if (gen !== __keyGeneration || !isAppUnlocked()) return cust;
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

// Màu status bar / PWA chrome khớp nền từng theme (mặc định giữ #005b9f của brand).
const THEME_META_COLORS = {
  "theme-vietinbank": "#005b9f",
  "theme-midnight": "#0a1628",
  "theme-ocean": "#041826",
  "theme-aurora": "#071627",
};

function setTheme(themeName) {
  document.body.className = themeName;
  localStorage.setItem(THEME_KEY, themeName);
  document.querySelectorAll(".theme-btn-sm").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.arg === themeName);
  });
  const meta = document.getElementById("meta-theme-color");
  if (meta) meta.setAttribute("content", THEME_META_COLORS[themeName] || "#005b9f");
}
// Check ngầm check_status đã chạy tới nơi (nhận + parse được phản hồi) trong
// phiên này. Lỗi mạng/offline KHÔNG set cờ để lần sau còn thử lại.
/**
 * Thu hồi quyền: xóa vật liệu khóa RỒI dựng UI chặn. Mọi đường thu hồi phải đi qua
 * đây — xóa masterKey mà để nguyên dashboard là phiên "khóa bên trong, mở bên ngoài":
 * plaintext khách hàng đã render vẫn nằm trên màn hình và mọi thao tác tiếp theo chạy
 * với masterKey === null.
 * @param {string} msg thông điệp từ server (hiển thị trên modal kích hoạt)
 */
function _revokeAndShowActivationGate(msg) {
  revokeUnlockedSession();
  const lock = getEl("screen-lock"); if (lock) lock.classList.add("hidden");
  const setup = getEl("setup-lock-modal"); if (setup) setup.classList.add("hidden");
  const modal = getEl("activation-modal"); if (modal) modal.classList.remove("hidden");
  const titleEl = (typeof document !== "undefined" && document.getElementById)
    ? document.getElementById("activation-title") : null;
  if (titleEl) titleEl.textContent = msg || "Tài khoản đã bị thu hồi!";
  try { localStorage.removeItem(ACTIVATED_KEY); } catch (e) {}
}

let __serverStatusChecked = false;

/**
 * Check ngầm với Admin GAS (action=check_status): server báo "locked" thì thu hồi
 * kích hoạt local và bắt user kích hoạt lại. Không chặn UI, nuốt lỗi mạng.
 *
 * Tách khỏi checkSecurity() vì máy đã seal mã NV không còn identity lúc boot
 * (app còn khóa) -> check này bị bỏ qua; 15_auth_gate.js gọi lại sau
 * clientpro:unlocked khi RAM đã có mã NV. Cờ __serverStatusChecked chống gọi lặp.
 */
async function runServerStatusCheck() {
  if (__serverStatusChecked) return;
  try {
    if (!localStorage.getItem(ACTIVATED_KEY)) return;
  } catch (e) {
    return;
  }
  try {
    const savedEmp = _resolveEmployeeId();
    if (!savedEmp) return;
    const requestGeneration = __keyGeneration;
    const requestWasUnlocked = isAppUnlocked();
    const query = `?action=check_status&employeeId=${encodeURIComponent(savedEmp)}&deviceInfo=${encodeURIComponent(navigator.userAgent)}`;

    const res = await fetch(ADMIN_SERVER_URL + query);
    const txt = await res.text();
    let result;
    try { result = JSON.parse(txt); } catch (e) { result = txt; }

    // Response của identity/phiên cũ không được thu hồi một lần kích hoạt mới.
    if (!localStorage.getItem(ACTIVATED_KEY)) return;
    if (_resolveEmployeeId() !== savedEmp) return;
    if (requestGeneration !== __keyGeneration) return;
    if (requestWasUnlocked && !isAppUnlocked()) return;
    __serverStatusChecked = true;

    const status = result && typeof result === "object" && result.status
      ? String(result.status).toLowerCase()
      : typeof result === "string" && result.toLowerCase().includes("locked") ? "locked" : "";
    const msg = result && typeof result === "object" && result.message ? result.message : "";
    if (status === "locked") _revokeAndShowActivationGate(msg);
  } catch (err) {
    // Offline: bỏ qua check ngầm với server, app vẫn hoạt động bình thường
  }
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
    // Điền sẵn mã NV nếu có (plaintext chỉ còn trong cửa sổ kích hoạt → tạo PIN)
    const storedEmp = _resolveEmployeeId();
    if (storedEmp) getEl("setup-answer").value = storedEmp;
  } else {
    // Đã có PIN -> Hiện bàn phím nhập PIN ngay lập tức
    showLockScreen();
  }

  // 2. CHECK NGẦM VỚI SERVER (Background Check)
  // Phần này chạy âm thầm bên dưới, không làm đơ màn hình của bạn.
  // Máy đã seal mã NV chưa có identity lúc này -> hàm return sớm và được gọi
  // lại sau clientpro:unlocked (15_auth_gate.js).
  await runServerStatusCheck();
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
    ErrorHandler.showError('AUTH', "Bảo mật: Không thể sao lưu khi đang ngoại tuyến hoặc chưa xác thực với máy chủ. Vui lòng kết nối mạng và mở lại ứng dụng.");
    return false;
  }
  return true;
}

async function ensureBackupSecret() {
  if (!isAppUnlocked()) return { ok: false, message: "Vui lòng mở khóa dữ liệu trước khi sao lưu/khôi phục." };
  const requestGeneration = __keyGeneration;
  const employeeId = _resolveEmployeeId();
  if (!employeeId) return { ok: false, message: "Chưa có mã nhân viên." };
  const sessionAlive = () => requestGeneration === __keyGeneration
    && isAppUnlocked() && _resolveEmployeeId() === employeeId;

  const deviceId = (typeof getDeviceId === "function") ? getDeviceId() : (localStorage.getItem("app_device_unique_id") || "");
  const cached = await _readCachedKdataAsync(employeeId, deviceId);
  if (!sessionAlive()) return { ok: false, message: "Phiên đã khóa hoặc thay đổi. Vui lòng mở khóa và thử lại." };
  if (cached && cached.kdata_b64u) APP_BACKUP_KDATA_B64U = cached.kdata_b64u;

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    if (APP_BACKUP_KDATA_B64U) return { ok: true, source: "cache", message: "Đang offline, dùng khóa KDATA đã lưu tạm." };
    return { ok: false, message: "Thiết bị đang Offline và chưa có khóa KDATA tạm." };
  }

  const acceptKdata = async (value) => {
    if (!sessionAlive()) return false;
    const kdata = String(value || "");
    if (!kdata) return false;
    APP_BACKUP_KDATA_B64U = kdata;
    await _writeCachedKdata(employeeId, deviceId, kdata);
    if (!sessionAlive()) {
      // Chỉ dọn ĐÚNG giá trị của request này. Trong lúc _writeCachedKdata await
      // WebCrypto, người dùng có thể khóa rồi mở lại và một ensureBackupSecret() MỚI
      // đã cài KDATA hợp lệ của nó vào cùng biến RAM; xóa trắng ở đây là cướp khóa
      // của phiên mới — nó vừa trả ok:true còn backup/restore ngay sau đó thấy rỗng.
      // (Cùng nguyên tắc identity-check với __fieldDecryptPending.)
      if (APP_BACKUP_KDATA_B64U === kdata) APP_BACKUP_KDATA_B64U = "";
      return false;
    }
    return true;
  };

  try {
    let kdTxt = "";
    let kd = null;
    try {
      const kdRes = await fetch(ADMIN_SERVER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "issue_kdata", employeeId, deviceId }),
      });
      kdTxt = await kdRes.text();
      if (!sessionAlive()) return { ok: false, message: "Phiên đã khóa hoặc thay đổi. Vui lòng thử lại." };
      try { kd = JSON.parse(kdTxt); } catch (e) { kd = null; }
      if (kd && kd.status === "success" && kd.kdata_b64u) {
        return (await acceptKdata(kd.kdata_b64u)) ? { ok: true } : { ok: false, message: "Phiên đã thay đổi." };
      }
    } catch (e) { /* fallback GET */ }

    try {
      const kdUrl = `${ADMIN_SERVER_URL}?action=issue_kdata&employeeId=${encodeURIComponent(employeeId)}&deviceId=${encodeURIComponent(deviceId)}`;
      const kdRes2 = await fetch(kdUrl);
      kdTxt = await kdRes2.text();
      if (!sessionAlive()) return { ok: false, message: "Phiên đã khóa hoặc thay đổi. Vui lòng thử lại." };
      try { kd = JSON.parse(kdTxt); } catch (e) { kd = null; }
      if (kd && kd.status === "success" && kd.kdata_b64u) {
        return (await acceptKdata(kd.kdata_b64u)) ? { ok: true } : { ok: false, message: "Phiên đã thay đổi." };
      }
    } catch (e) { /* ignore */ }

    if (!sessionAlive()) return { ok: false, message: "Phiên đã khóa hoặc thay đổi. Vui lòng thử lại." };
    const kdStatus = (kd && typeof kd === "object" && kd.status) ? String(kd.status).toLowerCase() : "";
    const kdMsg = (kd && typeof kd === "object" && kd.message) ? String(kd.message) : "";
    if (/rate.?limited/i.test(kdMsg) && APP_BACKUP_KDATA_B64U) {
      return { ok: true, source: "cache", message: "Server đang giới hạn tần suất, dùng khóa KDATA đã lưu tạm." };
    }
    if (kdStatus === "locked") {
      // Không chỉ xóa khóa: phải dựng luôn UI chặn như runServerStatusCheck, nếu không
      // dashboard + plaintext đã render vẫn hiển thị trong khi phiên đã bị thu hồi.
      _revokeAndShowActivationGate(kdMsg);
      return { ok: false, message: kdMsg || "Tài khoản đã bị thu hồi." };
    }
    if (kdStatus === "error" || kdMsg) {
      if (/device|thiết bị|không khớp/i.test(kdMsg)) return { ok: false, message: "Thiết bị chưa được cấp quyền backup (Device ID không khớp)." };
      if (/kích hoạt|activate|inactive|chưa/i.test(kdMsg)) return { ok: false, message: "Tài khoản chưa được kích hoạt quyền backup." };
      if (kdStatus === "error") return { ok: false, message: kdMsg || "Không đủ quyền lấy khóa KDATA." };
      if (kdMsg) return { ok: false, message: kdMsg };
    }
    if (APP_BACKUP_KDATA_B64U) return { ok: true, source: "cache", message: "Không lấy được KDATA mới, đang dùng khóa tạm đã lưu." };
    return { ok: false, message: "Không lấy được khóa KDATA từ server." };
  } catch (e) {
    if (sessionAlive() && APP_BACKUP_KDATA_B64U) return { ok: true, source: "cache", message: "Lỗi kết nối tạm thời, đang dùng khóa KDATA đã lưu." };
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
  if (!isAppUnlocked()) throw new Error("Vui lòng mở khóa dữ liệu trước khi gửi/nhận.");
  const requestGeneration = __keyGeneration;
  const employeeId = _resolveEmployeeId();
  if (!employeeId) throw new Error("Chưa có mã nhân viên.");
  const sessionAlive = () => requestGeneration === __keyGeneration
    && isAppUnlocked() && _resolveEmployeeId() === employeeId;
  const deviceId = (typeof getDeviceId === "function") ? getDeviceId() : (localStorage.getItem("app_device_unique_id") || "");
  const target = String(targetEmployeeId || "").trim();
  const cacheKey = target || "_self";

  const cached = _transferKeyCache[cacheKey];
  if (cached && cached.key && (Date.now() - cached.ts) < TRANSFER_KEY_TTL_MS) return cached.key;

  const parseKey = (txt) => {
    let js = null;
    try { js = JSON.parse(txt); } catch (e) { js = null; }
    if (js && js.status === "success" && js.kdata_b64u) return String(js.kdata_b64u);
    return null;
  };

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
  if (!sessionAlive()) throw new Error("Phiên đã khóa hoặc thay đổi. Vui lòng thử lại.");

  if (!key) {
    let url = `${ADMIN_SERVER_URL}?action=issue_transfer_key&employeeId=${encodeURIComponent(employeeId)}&deviceId=${encodeURIComponent(deviceId)}`;
    if (target) url += `&toEmployeeId=${encodeURIComponent(target)}`;
    try {
      const res2 = await fetch(url);
      key = parseKey(await res2.text());
    } catch (e) { /* ignore */ }
  }
  if (!sessionAlive()) throw new Error("Phiên đã khóa hoặc thay đổi. Vui lòng thử lại.");
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
  // Chốt chặn TRƯỚC mọi thao tác khóa: trong cửa sổ migration legacy chưa finalize,
  // masterKey là MK2 còn PIN_KEY/SEC_KEY vẫn niêm phong khóa legacy. Niêm phong lại
  // bằng masterKey hiện tại sẽ xóa vĩnh viễn bản duy nhất đọc được dữ liệu legacy
  // còn lại (_installMasterKey ngay dưới cũng xóa masterKeyLegacy trong RAM).
  if (__legacyMigrationUnfinished) {
    ErrorHandler.showError('STORAGE', 'Dữ liệu cũ chưa nâng cấp mã hóa xong. Vui lòng mở lại ứng dụng để hoàn tất rồi đặt lại mã PIN.');
    return;
  }
  const pin = getEl("setup-pin").value;
  let ans = getEl("setup-answer").value.trim();
  if (!/^\d{6}$/.test(pin)) { ErrorHandler.showError('VALIDATION', "Mã PIN phải là 6 số"); return; }
  // Nếu người dùng không nhập mã nhân viên, lấy từ RAM (sau unlock) hoặc
  // plaintext tạm của cửa sổ kích hoạt (nếu có)
  if (!ans) {
    const storedEmp = _resolveEmployeeId();
    if (storedEmp) {
      ans = storedEmp;
      // hiển thị lại cho người dùng biết
      getEl("setup-answer").value = storedEmp;
    } else {
      ErrorHandler.showError('VALIDATION', "Vui lòng nhập mã nhân viên"); return;
    }
  }
  /* * Thiết lập bảo mật v2: * - Sinh masterKey nếu chưa tồn tại * - Niêm phong masterKey bằng PBKDF2 + AES-GCM với 2 secret: PIN 6 số (mở khóa hằng ngày) và mã nhân viên (khôi phục) */
  // CHỐT CHẶN CUỐI chống mất dữ liệu: sinh masterKey MỚI chỉ hợp lệ khi máy chưa có
  // envelope nào. Nếu PIN_KEY/SEC_KEY đã tồn tại mà phiên lại không có masterKey thì
  // đường vào đây là sai (auto-lock rơi giữa unlock/khôi phục, hoặc modal thiết lập
  // mở trên phiên đã chết) — seal khóa mới sẽ đè envelope duy nhất mở được dữ liệu.
  // Mọi đường hợp lệ (thiết lập lần đầu, nâng cấp PIN 4->6, sau checkRecovery, sau
  // tái kích hoạt) đều đã có masterKey trong phiên.
  if (!masterKey && (localStorage.getItem(PIN_KEY) || localStorage.getItem(SEC_KEY))) {
    ErrorHandler.showError('AUTH', "Phiên đã kết thúc. Vui lòng mở khóa bằng PIN (hoặc dùng Quên PIN) rồi đặt lại mã PIN.");
    return;
  }
  // Nếu masterKey chưa sinh (lần đầu thiết lập), tạo mới bằng CSPRNG (MK2)
  if (!masterKey) {
    masterKey = generateMasterKey();
  }
  // Chốt khóa sẽ được niêm phong NGAY BÂY GIỜ. Mọi lệnh seal bên dưới dùng biến cục
  // bộ này, không đọc lại global sau await: auto-lock có thể đã đặt masterKey=null và
  // sealMasterKey(pin, null) ghi đè PIN_KEY bằng envelope chứa chuỗi "null".
  const mkForSetup = masterKey;
  // Thiết lập/đặt lại PIN cũng mở một lượt phiên mới: nhận vé TRƯỚC khi cài khóa
  // (xem __unlockAttemptSeq) để lượt validatePin cũ còn treo trong pipeline rút lui
  // ngay, kể cả trong khe await của importKey.
  const myUnlockAttempt = ++__unlockAttemptSeq;
  // Dựng key GCM cho phiên (fresh install), hoặc giữ nguyên nếu đã cài từ unlock/recovery.
  try {
    await _installMasterKey(mkForSetup);
  } catch (e) {
    // Phiên đã bị khóa/thu hồi giữa lúc dựng khóa: DỪNG trước mọi lệnh ghi envelope.
    // Modal thiết lập giữ nguyên để người dùng mở khóa lại rồi thử lại.
    try { ErrorHandler.logError("setup-install-key", e); } catch (_) {}
    if (_isStaleKeyInstall(e)) {
      ErrorHandler.showError('AUTH', "Phiên đã kết thúc trong lúc thiết lập. Vui lòng mở khóa lại rồi lưu thiết lập.");
    } else {
      ErrorHandler.showError('STORAGE', "Không dựng được khóa bảo mật. Vui lòng thử lại.");
    }
    _releaseUnlockLoading(myUnlockAttempt);
    return;
  }
  const setupGeneration = __keyGeneration;
  // Phiên còn đúng khóa vừa cài? PHẢI kiểm lại ngay trước MỖI lệnh ghi envelope —
  // giữa _installMasterKey và hai lệnh seal còn một await (_writeSealedEmployeeId).
  const setupKeyAlive = () => setupGeneration === __keyGeneration && masterKey === mkForSetup;
  // Mã NV: seal dưới masterKey TRƯỚC, chỉ nạp lại vào RAM sau khi chắc phiên còn sống —
  // mã NV là secret khôi phục, gán nó sau khi clearMasterKeyMaterial() vừa dọn RAM là
  // hồi sinh secret cho một phiên đã khóa/thu hồi.
  let sealedEmp = false;
  try {
    sealedEmp = await _writeSealedEmployeeId(ans);
  } catch (e) {}
  if (!setupKeyAlive()) {
    ErrorHandler.showError('AUTH', "Phiên đã kết thúc trong lúc thiết lập. Vui lòng mở khóa lại rồi lưu thiết lập.");
    _releaseUnlockLoading(myUnlockAttempt);
    return;
  }
  __employeeIdPlain = ans;
  if (sealedEmp) localStorage.removeItem(EMPLOYEE_KEY);
  const btn = getEl("setup-save-btn");
  const btnLabel = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Đang mã hóa..."; }
  try {
    const pinEnvelope = await sealMasterKey(pin, mkForSetup);
    const secEnvelope = await sealMasterKey(ans, mkForSetup);
    // Kiểm LẦN CUỐI sau await sealMasterKey: hai envelope đã dựng xong trong RAM,
    // chỉ ghi khi phiên vẫn là phiên đã sinh ra chúng. Ghi một nửa cũng không được:
    // PIN_KEY và SEC_KEY phải luôn niêm phong CÙNG một masterKey.
    if (!setupKeyAlive()) {
      ErrorHandler.showError('AUTH', "Phiên đã kết thúc trong lúc thiết lập. Vui lòng mở khóa lại rồi lưu thiết lập.");
      _releaseUnlockLoading(myUnlockAttempt);
      return;
    }
    localStorage.setItem(PIN_KEY, pinEnvelope);
    localStorage.setItem(SEC_KEY, secEnvelope);
    // PIN đã đổi TRÊN ĐĨA -> enrollment sinh trắc học cũ (mã hóa PIN cũ) hết hợp lệ
    // ngay tại đây. Phải hủy ngay sau lệnh ghi envelope, KHÔNG gắn vào chốt vé/UI ở
    // cuối hàm: nếu phiên chết giữa pipeline dài phía dưới thì PIN mới vẫn đã lưu,
    // mà app_biometric_env_v1 lại còn mở ra PIN CŨ — mở khóa sinh trắc học sẽ hỏng
    // im lặng và người dùng phải nhập tay dù đổi PIN đã thành công.
    // onPinChanged() chỉ là disable(), idempotent, không phụ thuộc trạng thái phiên.
    try { if (window.BiometricUnlock) window.BiometricUnlock.onPinChanged(); } catch (e) { }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
  }
  resetPinFailures();
  // Gom mọi đường unlock về MỘT pipeline duy nhất (completeUnlockDataLoad):
  // chờ __dbReady, chạy CẢ 3 migration (gồm field-encrypt v2 — vá B4), primeFieldCache,
  // FLUSH KDATA pending (seal — vá B3), loadCustomers, và DISPATCH clientpro:unlocked
  // (vá B2: auto-backup nghe được ngay trong phiên thiết lập/khôi phục đầu tiên).
  // Trước đây đoạn này tự làm thủ công và bỏ sót v2-migration/flush-KDATA/dispatch.
  try {
    await completeUnlockDataLoad(pin, ans, myUnlockAttempt);
  } catch (e) {
    try { ErrorHandler.logError("setup-unlock-pipeline", e); } catch (_) {}
  }
  // Khối `finally` của phần niêm phong đã bật lại nút Lưu TRƯỚC pipeline dài này, nên
  // người dùng có thể bấm Lưu lần nữa: lượt sau nhận vé mới, lượt này thành cũ. Đóng
  // modal + báo thành công ở đây là phơi UI nền ra trong lúc lượt mới còn đang cài
  // khóa / migrate / tải dữ liệu. Chốt này CHỈ gác phần UI — mọi hệ quả đã ghi xuống
  // đĩa (envelope, hủy enrollment sinh trắc học) đã xong ngay sau lệnh ghi ở trên.
  if (!isAppUnlocked() || myUnlockAttempt !== __unlockAttemptSeq) return;
  // Ẩn hộp thoại và thông báo
  const note = getEl("setup-pin-note");
  if (note) note.classList.add("hidden");
  getEl("setup-lock-modal").classList.add("hidden");
  ErrorHandler.showSuccess("Đã lưu thiết lập bảo mật");
}
function showLockScreen() {
  // Màn khóa phải LUÔN hiện ra ở trạng thái nhập được PIN. _setUnlockLoading(true)
  // của một pipeline unlock đã ẩn keypad; nếu pipeline đó bị khóa/thu hồi cắt ngang
  // và không còn giữ vé, nó sẽ không tự dọn -> màn khóa hiện với spinner treo và
  // không có bàn phím. Mọi đường gọi showLockScreen() đều đã xóa vật liệu khóa nên
  // dọn ở đây không đụng vào lượt nào còn hợp lệ.
  _setUnlockLoading(false);
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
    window.Haptics?.light();
    if (currentPin.length === pinLen) validatePin();
  }
}
function backspacePin() {
  if (_pinChecking || getLockoutRemainingMs() > 0) {
    updateLockoutUI();
    return;
  }
  if (currentPin.length > 0) {
    currentPin = currentPin.slice(0, -1);
    updatePinDots();
    window.Haptics?.light();
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
  // Nhận vé + chụp PIN TRƯỚC await đầu tiên. Biometric có thể gọi validatePin()
  // trực tiếp trong khi lượt cũ đang chạy, nên keypad-disabled không ngăn được
  // lượt mới. Lượt mới phải tiếp quản ngay từ lúc bắt đầu giải mã envelope.
  const myUnlockAttempt = ++__unlockAttemptSeq;
  const pinAttempt = currentPin;
  // Lượt mới tiếp quản cổng PIN: mọi vật liệu khóa đang sống thuộc lượt/phiên
  // trước. Vô hiệu hóa đồng bộ trước await unwrap để pipeline cũ dừng ngay và
  // PIN sai của lượt mới không thể để khóa cũ sống phía sau màn hình khóa.
  if (masterKey || masterCryptoKey || masterKeyLegacy || masterKeyBytes) {
    clearMasterKeyMaterial();
  }
  const encMaster = localStorage.getItem(PIN_KEY);
  _pinChecking = true;
  _setKeypadDisabled(true);
  let res = null;
  try {
    res = await unwrapMasterKeyAny(pinAttempt, encMaster);
  } finally {
    // Lượt cũ hoàn tất PBKDF2 sau lượt mới không được mở lại đường nhập PIN.
    if (myUnlockAttempt === __unlockAttemptSeq) _pinChecking = false;
  }
  // Một lượt mới đã bắt đầu trong lúc unwrap: lượt này không còn quyền cài khóa,
  // ghi nhận PIN sai hay thay đổi bất kỳ trạng thái UI/RAM dùng chung nào.
  if (myUnlockAttempt !== __unlockAttemptSeq) return;
  if (res && res.masterKey) {
    // Giải mã thành công: cài masterKey (dựng key GCM) — giữ lock đến khi load xong dữ liệu.
    try {
      await _installMasterKey(res.masterKey);
    } catch (e) {
      // Auto-lock / thu hồi / lượt cài khóa mới xen vào giữa importKey.
      try { ErrorHandler.logError("unlock-install-key", e); } catch (_) {}
      if (myUnlockAttempt === __unlockAttemptSeq) {
        currentPin = "";
        updatePinDots();
        _setKeypadDisabled(false);
      }
      _releaseUnlockLoading(myUnlockAttempt);
      return;
    }
    // Lượt mới có thể bắt đầu khi lượt này đang importKey mà chưa đổi key generation.
    // Chặn trước mọi cleanup để không xóa PIN/keypad của lượt mới đang unwrap.
    const installedGeneration = __keyGeneration;
    const installedCryptoKey = masterCryptoKey;
    if (myUnlockAttempt !== __unlockAttemptSeq) {
      if (__keyGeneration === installedGeneration
        && masterKey === res.masterKey
        && masterCryptoKey === installedCryptoKey) {
        clearMasterKeyMaterial();
      }
      return;
    }
    const pinForMigration = pinAttempt;
    // Máy legacy chưa migrate vẫn còn plaintext; máy đã migrate trả "" (migration
    // legacy khi đó là no-op nên không cần mã NV).
    const empForMigration = _resolveEmployeeId();
    currentPin = ""; // chỉ chủ vé được xóa PIN dùng chung khỏi RAM
    resetPinFailures();
    _setKeypadDisabled(false);
    await completeUnlockDataLoad(pinForMigration, empForMigration, myUnlockAttempt);
    // Auto-lock / thu hồi có thể đã nổ giữa pipeline dài phía trên.
    if (!isAppUnlocked()) return;
    // Chỉ lượt đang sở hữu phiên mới được ẩn màn khóa hoặc mở prompt nâng cấp PIN.
    if (myUnlockAttempt !== __unlockAttemptSeq) return;
    getEl("screen-lock").classList.add("hidden");
    // PIN cũ 4 số: bắt buộc tạo PIN 6 số mới, nhưng chỉ sau khi migration hoàn tất.
    if (res.legacy && !__legacyMigrationUnfinished) _openForcedPinUpgrade();
  } else {
    registerPinFailure();
    _shakePinDots();
    clearPin();
    updateLockoutUI();
    _releaseUnlockLoading(myUnlockAttempt);
  }
}

function _openForcedPinUpgrade() {
  const modal = getEl("setup-lock-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  getEl("setup-pin").value = "";
  const storedEmp = _resolveEmployeeId();
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
    // Nhận vé TRƯỚC khi cài khóa (xem __unlockAttemptSeq): _installMasterKey gán
    // masterKey rồi mới await importKey, khe đó isAppUnlocked() đã true.
    const myRecoveryAttempt = ++__unlockAttemptSeq;
    // Khôi phục masterKey (cài key GCM/legacy) và cho phép đặt lại PIN 6 số.
    // Migration (nếu dữ liệu còn CryptoJS) sẽ chạy trong saveSecuritySetup dưới PIN mới.
    try {
      await _installMasterKey(res.masterKey);
    } catch (e) {
      // Phiên chết giữa importKey: KHÔNG mở modal đặt PIN mới. saveSecuritySetup khi
      // đó thấy masterKey rỗng sẽ sinh masterKey MỚI và niêm phong đè PIN_KEY/SEC_KEY
      // — dữ liệu cũ mất vĩnh viễn. Giữ nguyên màn khóa + modal khôi phục để thử lại.
      try { ErrorHandler.logError("recovery-install-key", e); } catch (_) {}
      ErrorHandler.showError('AUTH', "Phiên đã kết thúc trong lúc khôi phục. Vui lòng thử lại.");
      _releaseUnlockLoading(myRecoveryAttempt);
      return;
    }
    const recoveryGeneration = __keyGeneration;
    const recoveredKey = res.masterKey;
    // Mã NV vừa xác thực đúng: seal trước (không persist plaintext), nạp RAM sau khi
    // chắc phiên còn sống — mã NV là secret khôi phục.
    try { await _writeSealedEmployeeId(input); } catch (e) {}
    // Auto-lock có thể rơi vào khe await ngay trên. Mở modal đặt PIN mới cho một phiên
    // đã chết là đường mất dữ liệu: saveSecuritySetup thấy masterKey rỗng sẽ sinh khóa
    // MỚI và niêm phong đè PIN_KEY/SEC_KEY.
    if (recoveryGeneration !== __keyGeneration || masterKey !== recoveredKey) {
      ErrorHandler.showError('AUTH', "Phiên đã kết thúc trong lúc khôi phục. Vui lòng thử lại.");
      _releaseUnlockLoading(myRecoveryAttempt);
      return;
    }
    __employeeIdPlain = input;
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
          const mkForActivation = recovered.masterKey;
          // UI khi phải bỏ dở gia hạn. KHÔNG được dùng khi ACTIVATED_KEY đã bị xóa:
          // thu hồi từ server (_revokeAndShowActivationGate, gọi từ ensureBackupSecret /
          // runServerStatusCheck) cũng làm thế hệ khóa đổi, nhưng nó đã dựng ĐÚNG cổng
          // kích hoạt. Ẩn cổng đó rồi hiện màn khóa là hạ một lệnh thu hồi xuống thành
          // auto-lock thường — validatePin() không kiểm ACTIVATED_KEY nên PIN đúng sẽ
          // mở thẳng dashboard của một máy vừa bị thu hồi quyền.
          const stopActivationUi = () => {
            let stillActivated = false;
            try { stillActivated = !!localStorage.getItem(ACTIVATED_KEY); } catch (e) {}
            if (!stillActivated) return;   // giữ nguyên cổng kích hoạt do thu hồi dựng
            const modalStale = getEl("activation-modal");
            if (modalStale) modalStale.classList.add("hidden");
            ErrorHandler.showError('AUTH', "Phiên đã kết thúc trong lúc gia hạn. Vui lòng mở lại ứng dụng.");
            showLockScreen();
          };
          try {
            await _installMasterKey(mkForActivation);
          } catch (e) {
            // Phiên chết giữa importKey: KHÔNG re-seal SEC_KEY (sealMasterKey với
            // masterKey rỗng ghi đè envelope khôi phục duy nhất) và KHÔNG mở modal đặt
            // PIN mới. Dữ liệu + envelope giữ nguyên; người dùng mở lại app để vào bằng PIN.
            try { ErrorHandler.logError("activate-install-key", e); } catch (_) {}
            stopActivationUi();
            return;
          }
          const activationGeneration = __keyGeneration;
          // Phiên còn đúng khóa vừa cài? Gọi lại sau MỖI await bên dưới.
          const activationKeyAlive = () =>
            activationGeneration === __keyGeneration && masterKey === mkForActivation;
          // Dừng gia hạn khi phiên chết giữa chừng: mã NV là secret khôi phục, gán
          // __employeeIdPlain sau khi clearMasterKeyMaterial() vừa dọn là để nó sống
          // suốt phiên đã khóa (lockApp() sau đó return sớm vì app đã khóa rồi).
          const abortActivationIfStale = () => {
            if (activationKeyAlive()) return false;
            stopActivationUi();
            return true;
          };
          // Nhân tiện nâng cấp SEC_KEY lên v2 nếu còn định dạng cũ
          if (recovered.legacy) {
            let secEnvelope = null;
            try { secEnvelope = await sealMasterKey(employeeId, mkForActivation); } catch (e) { }
            // Kiểm sau await: chỉ ghi khi vẫn đúng phiên/khóa vừa cài.
            if (abortActivationIfStale()) return;
            if (secEnvelope) {
              try { localStorage.setItem(SEC_KEY, secEnvelope); } catch (e) { }
            }
          }
          localStorage.setItem(ACTIVATED_KEY, "true");
          // masterKey đã cài -> không persist plaintext: giữ RAM + seal, dọn bản cũ.
          let sealedEmp = false;
          try { sealedEmp = await _writeSealedEmployeeId(employeeId); } catch (e) {}
          if (abortActivationIfStale()) return;
          __employeeIdPlain = employeeId;
          if (sealedEmp) { try { localStorage.removeItem(EMPLOYEE_KEY); } catch (e) {} }
          try { await ensureBackupSecret(); } catch (e) { }
          if (abortActivationIfStale()) return;
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
// Trễ 60s để không khóa oan các thao tác làm trang tạm "hidden" trên mobile
// (file picker nhập .cpb, share sheet, cấp quyền GPS, chuyển app nhanh).
// ============================================================
const AUTO_LOCK_HIDDEN_MS = 60000;
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

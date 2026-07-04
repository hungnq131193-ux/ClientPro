// --- Security & Encryption Helpers ---
// Sử dụng masterKey cho cơ chế mã hóa toàn bộ dữ liệu và khôi phục bằng mã nhân viên.
let masterKey = null;
// Legacy secret (passphrase) chỉ để đọc backup .cpb định dạng cũ.
// Backup mới dùng global KDATA do GAS cấp (base64url, no padding) làm AES-GCM key.
let APP_BACKUP_SECRET = "";
let APP_BACKUP_KDATA_B64U = "";
const BACKUP_KDATA_CACHE_KEY = "app_backup_kdata_cache_v1";
const BACKUP_KDATA_CACHE_TTL_MS = 30 * 60 * 1000; // 30 phút

function _backupAuthIdentity(employeeId, deviceId) {
  const scopeUrl = (typeof ADMIN_SERVER_URL !== "undefined" && ADMIN_SERVER_URL) ? String(ADMIN_SERVER_URL) : "";
  return `${employeeId || ""}::${deviceId || ""}::${scopeUrl}`;
}

function _readCachedKdata(employeeId, deviceId) {
  try {
    const raw = localStorage.getItem(BACKUP_KDATA_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const ts = Number(parsed.ts || 0);
    const kdata = parsed.kdata_b64u ? String(parsed.kdata_b64u) : "";
    const identity = parsed.identity ? String(parsed.identity) : "";
    if (!ts || !kdata || !identity) return null;
    if (Date.now() - ts > BACKUP_KDATA_CACHE_TTL_MS) return null;
    if (identity !== _backupAuthIdentity(employeeId, deviceId)) return null;
    return { ts, kdata_b64u: kdata };
  } catch (e) {
    return null;
  }
}

function _writeCachedKdata(employeeId, deviceId, kdata_b64u) {
  try {
    localStorage.setItem(
      BACKUP_KDATA_CACHE_KEY,
      JSON.stringify({
        ts: Date.now(),
        kdata_b64u: String(kdata_b64u || ""),
        identity: _backupAuthIdentity(employeeId, deviceId),
      })
    );
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

// Legacy: derive AES-GCM key from passphrase (old backup format)
async function _deriveAesGcmKeyFromSecret(secret) {
  const enc = new TextEncoder();
  const material = enc.encode(String(secret || ""));
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
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

/** Encrypt a text value using AES và masterKey. */

function encryptText(text) {
  if (!masterKey || text === undefined || text === null) return text;
  try {
    return CryptoJS.AES.encrypt(String(text), masterKey).toString();
  } catch (e) {
    return text;
  }
}

/** * Decrypt một chuỗi AES bằng masterKey. Nếu chưa có masterKey hoặc giải mã thất bại thì trả lại nguyên bản. * @param {string} cipher * @returns {string} */
function decryptText(cipher) {
  if (!masterKey || cipher === undefined || cipher === null) return cipher;
  try {
    const bytes = CryptoJS.AES.decrypt(String(cipher), masterKey);
    const plaintext = bytes.toString(CryptoJS.enc.Utf8);
    return plaintext || cipher;
  } catch (e) {
    return cipher;
  }
}

/** * Sinh master key ngẫu nhiên. Master key dùng để mã hóa/giải mã toàn bộ thông tin khách hàng. * @returns {string} */
function generateMasterKey() {
  return (
    "mk_" +
    Date.now() +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
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
    return mk && mk.startsWith("mk_") ? mk : null;
  } catch (e) {
    return null;
  }
}

/** Mở envelope legacy (CryptoJS.AES với passphrase = SHA-256(secret)). */
async function openMasterKeyLegacy(secret, rawStored) {
  if (!rawStored) return null;
  try {
    const hashed = await hashString(String(secret));
    const bytes = CryptoJS.AES.decrypt(String(rawStored), hashed);
    const mk = bytes.toString(CryptoJS.enc.Utf8);
    return mk && mk.startsWith("mk_") ? mk : null;
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
    const msg = "Vui lòng mở khóa dữ liệu trước khi sao lưu.";
    try { showToast(msg); } catch (e) { }
    try { console.warn("[Backup] Blocked: masterKey is not available; app is not unlocked."); } catch (e) { }
    alert(msg);
    return false;
  }
  return true;
}

function requireUnlockedForRestore() {
  if (!isAppUnlocked()) {
    const msg = "Vui lòng mở khóa dữ liệu trước khi khôi phục.";
    try { showToast(msg); } catch (e) { }
    try { console.warn("[Restore] Blocked: masterKey is not available; app is not unlocked."); } catch (e) { }
    alert(msg);
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
  document.querySelectorAll(".theme-btn").forEach((btn) => {
    if (btn.getAttribute("onclick").includes(themeName))
      btn.classList.add("active");
    else btn.classList.remove("active");
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
async function ensureBackupSecret() {
  const employeeId = localStorage.getItem(EMPLOYEE_KEY) || "";
  if (!employeeId) return { ok: false, message: "Chưa có mã nhân viên." };

  const deviceId = (typeof getDeviceId === "function") ? getDeviceId() : (localStorage.getItem("app_device_unique_id") || "");
  const cached = _readCachedKdata(employeeId, deviceId);
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
    alert("Bạn cần tạo mã PIN 6 số để hoàn tất nâng cấp bảo mật!");
  }
}
async function saveSecuritySetup() {
  const pin = getEl("setup-pin").value;
  let ans = getEl("setup-answer").value.trim();
  if (!/^\d{6}$/.test(pin)) return alert("Mã PIN phải là 6 số");
  // Nếu người dùng không nhập mã nhân viên, lấy từ localStorage đã lưu khi kích hoạt (nếu có)
  if (!ans) {
    const storedEmp = localStorage.getItem(EMPLOYEE_KEY);
    if (storedEmp) {
      ans = storedEmp;
      // hiển thị lại cho người dùng biết
      getEl("setup-answer").value = storedEmp;
    } else {
      return alert("Nhập mã nhân viên");
    }
  }
  // Lưu lại mã nhân viên đề phòng chưa lưu lúc kích hoạt
  localStorage.setItem(EMPLOYEE_KEY, ans);
  /* * Thiết lập bảo mật v2: * - Sinh masterKey nếu chưa tồn tại * - Niêm phong masterKey bằng PBKDF2 + AES-GCM với 2 secret: PIN 6 số (mở khóa hằng ngày) và mã nhân viên (khôi phục) */
  // Nếu masterKey chưa sinh (lần đầu thiết lập), tạo mới
  if (!masterKey) {
    masterKey = generateMasterKey();
  }
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
  // PIN vừa đổi: enrollment sinh trắc học cũ (nếu có) mã hóa PIN cũ nên không còn hợp lệ.
  try { if (window.BiometricUnlock) window.BiometricUnlock.onPinChanged(); } catch (e) { }
  // Ẩn hộp thoại và thông báo
  const note = getEl("setup-pin-note");
  if (note) note.classList.add("hidden");
  getEl("setup-lock-modal").classList.add("hidden");
  showToast("Đã lưu bảo mật");
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
    // Giải mã thành công: thiết lập masterKey và mở khóa giao diện
    masterKey = res.masterKey;
    currentPin = ""; // không giữ PIN trong bộ nhớ lâu hơn cần thiết
    resetPinFailures();
    _setKeypadDisabled(false);
    getEl("screen-lock").classList.add("hidden");
    // Sau khi unlock, tải lại danh sách khách hàng để giải mã dữ liệu
    loadCustomers(getEl("search-input").value);
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
    alert("Sai quá nhiều lần. Vui lòng chờ hết thời gian khóa rồi thử lại.");
    return;
  }
  // Chấp nhận cả SEC_KEY legacy lẫn v2; input untrimmed cũ vẫn khớp vì setup luôn trim
  const res = await unwrapMasterKeyAny(input, encMaster);
  if (res && res.masterKey) {
    // Khôi phục masterKey và cho phép đặt lại PIN 6 số
    masterKey = res.masterKey;
    resetPinFailures();
    alert("Xác thực thành công. Tạo PIN mới.");
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
    alert("Mã nhân viên không khớp!");
  }
}

/** Xử lý kích hoạt ứng dụng bằng cách gửi mã key và mã nhân viên lên server. */
async function activateApp() {
  const keyInput = getEl("activation-key");
  const empInput = getEl("activation-employee");
  const key = keyInput ? keyInput.value.trim() : "";
  const employeeId = empInput ? empInput.value.trim() : "";

  if (!key || !employeeId) {
    alert("Vui lòng nhập đầy đủ Mã kích hoạt và Mã nhân viên");
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
        showToast("Kích hoạt thành công! Vui lòng tạo mã PIN.");
      } else {
        // Tái kích hoạt trên máy đã có dữ liệu: xác thực mã nhân viên (nhận cả định dạng cũ và v2)
        const encMaster = localStorage.getItem(SEC_KEY);
        const recovered = await unwrapMasterKeyAny(employeeId, encMaster);
        if (recovered && recovered.masterKey) {
          // Đúng nhân viên cũ: giữ nguyên masterKey và dữ liệu, gia hạn thành công
          masterKey = recovered.masterKey;
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
            showToast("Gia hạn thành công! Dữ liệu cũ vẫn an toàn.");
            showLockScreen();
          } else {
            // Nếu vì lý do nào đó không có PIN, cho tạo mới
            getEl("setup-lock-modal").classList.remove("hidden");
            getEl("setup-pin").value = "";
            getEl("setup-answer").value = employeeId;
            showToast("Gia hạn thành công! Tạo PIN mới.");
          }
        } else {
          // Nhân viên khác: cảnh báo và hỏi xác nhận để xóa dữ liệu cũ
          const confirmDel = confirm(
            "Phát hiện dữ liệu của nhân viên khác. Tiếp tục sẽ XÓA SẠCH dữ liệu cũ. Đồng ý không?"
          );
          if (confirmDel) {
            try {
              // Xóa toàn bộ localStorage và CSDL
              localStorage.clear();
              indexedDB.deleteDatabase(DB_NAME);
            } catch (e) { }
            // Đặt lại masterKey và lưu trạng thái kích hoạt mới
            masterKey = null;
            localStorage.setItem(ACTIVATED_KEY, "true");
            localStorage.setItem(EMPLOYEE_KEY, employeeId);
            try { await ensureBackupSecret(); } catch (e) { }
            const modal = getEl("activation-modal");
            if (modal) modal.classList.add("hidden");
            // Cho phép tạo PIN mới
            getEl("setup-lock-modal").classList.remove("hidden");
            getEl("setup-pin").value = "";
            getEl("setup-answer").value = employeeId;
            showToast("Đã kích hoạt cho người dùng mới, vui lòng tạo PIN.");
          }
          // Nếu không đồng ý, không làm gì cả
        }
      }
    } else {
      let msg = "Kích hoạt thất bại. Vui lòng kiểm tra Key của bạn.";
      if (result && result.message) msg = result.message;
      alert(msg);
    }
  } catch (err) {
    alert("Lỗi kết nối: " + err.message);
  }
}

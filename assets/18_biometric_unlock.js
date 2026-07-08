// ============================================================
// 18_biometric_unlock.js
// Mở khóa nhanh bằng Face ID / vân tay (WebAuthn PRF extension).
// Tính năng BỔ SUNG, hoàn toàn tách biệt với luồng PIN sẵn có trong
// 02_security.js: chỉ dùng sinh trắc học để giải mã ra đúng mã PIN đã
// lưu (được PRF của thiết bị bảo vệ), rồi gọi lại validatePin() hiện có.
// Nếu thiết bị/trình duyệt không hỗ trợ PRF, tính năng tự ẩn — KHÔNG
// hạ cấp xuống phương án lưu trữ kém an toàn hơn.
// ============================================================

(function () {
  "use strict";

  const ENV_KEY = "app_biometric_env_v1";
  const RP_NAME = "ClientPro";
  const HKDF_INFO = "clientpro-biometric-pin-wrap-v1";
  const CHALLENGE_LEN = 32;
  const HKDF_SALT = new Uint8Array(16); // cố định: PRF output đã ngẫu nhiên, info mới là phần tách domain

  let _availableCache = null;
  let _autoTried = false;
  let _unlockInFlight = false;
  let _unlockIsAuto = false;   // lượt đang chạy là auto-prompt (không có thao tác user)
  let _unlockAbort = null;     // AbortController của lượt get() đang chạy
  let _unlockPromise = null;

  function _rand(len) {
    return crypto.getRandomValues(new Uint8Array(len));
  }

  function _bufToB64(buf) {
    return _b64EncodeBytes(new Uint8Array(buf));
  }

  function _b64ToBuf(b64) {
    return _b64DecodeToBytes(b64).buffer;
  }

  async function isAvailable() {
    if (_availableCache !== null) return _availableCache;
    try {
      if (
        !window.PublicKeyCredential ||
        typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== "function"
      ) {
        _availableCache = false;
      } else {
        _availableCache = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      }
    } catch (e) {
      _availableCache = false;
    }
    return _availableCache;
  }

  function isEnrolled() {
    try {
      return !!localStorage.getItem(ENV_KEY);
    } catch (e) {
      return false;
    }
  }

  async function _deriveKeyFromPrf(prfBytes) {
    const base = await crypto.subtle.importKey("raw", prfBytes, "HKDF", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: new TextEncoder().encode(HKDF_INFO) },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  /** Đăng ký mở khóa sinh trắc học. Yêu cầu đúng mã PIN hiện tại để xác nhận quyền sở hữu. */
  async function enable(pinPlaintext) {
    const encMaster = (typeof PIN_KEY !== "undefined") ? localStorage.getItem(PIN_KEY) : null;
    let check = null;
    try {
      check = await unwrapMasterKeyAny(pinPlaintext, encMaster);
    } catch (e) {
      check = null;
    }
    if (!check || !check.masterKey) {
      return { ok: false, message: "Mã PIN không đúng." };
    }

    if (!(await isAvailable())) {
      return { ok: false, message: "Thiết bị này không hỗ trợ mở khóa sinh trắc học." };
    }

    const prfSalt = _rand(32);
    let cred;
    try {
      cred = await navigator.credentials.create({
        publicKey: {
          rp: { name: RP_NAME },
          user: {
            // ID cố định: đăng ký lại sẽ ghi đè passkey cũ của app trên thiết bị
            // thay vì tích thêm passkey rác trong iCloud Keychain / Google Password Manager.
            id: new TextEncoder().encode("clientpro-local-user"),
            name: "clientpro-user",
            displayName: "ClientPro",
          },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 }, // ES256
            { type: "public-key", alg: -257 }, // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            // Android (Google Password Manager) chỉ hỗ trợ PRF với passkey discoverable;
            // thiếu residentKey:"required" thì prf.enabled trả về false trên Chrome Android.
            residentKey: "required",
            requireResidentKey: true,
            userVerification: "required",
          },
          // Eval PRF ngay tại create(): Safari/iOS 18 (và Chrome mới) trả kết quả luôn,
          // chỉ cần 1 lần Face ID / vân tay — tránh lượt get() thứ 2 vốn hay bị iOS
          // chặn vì user gesture đã bị create() tiêu mất.
          extensions: { prf: { eval: { first: prfSalt } } },
          challenge: _rand(CHALLENGE_LEN),
          timeout: 60000,
        },
      });
    } catch (e) {
      console.warn("[BiometricUnlock] create() lỗi:", e && e.name, e);
      return { ok: false, message: "Đăng ký sinh trắc học đã bị hủy hoặc gặp lỗi." };
    }
    if (!cred) return { ok: false, message: "Không thể đăng ký sinh trắc học." };

    const credId = cred.rawId;

    let ext = {};
    try {
      ext = cred.getClientExtensionResults() || {};
    } catch (e) {
      ext = {};
    }

    let prfFirst = ext.prf && ext.prf.results && ext.prf.results.first;

    if (!prfFirst) {
      // enabled === false là từ chối tường minh; enabled thiếu/không chuẩn (một số bản
      // Safari) thì vẫn thử get() bên dưới thay vì kết luận vội "không hỗ trợ".
      if (ext.prf && ext.prf.enabled === false) {
        return {
          ok: false,
          message: "Trình duyệt/thiết bị này chưa hỗ trợ mở khóa sinh trắc học an toàn.",
        };
      }

      // Chrome Android (bản cũ) chỉ báo prf.enabled tại create(), phải thêm một lượt
      // get() mới lấy được giá trị PRF thật.
      let assertion;
      try {
        assertion = await navigator.credentials.get({
          publicKey: {
            challenge: _rand(CHALLENGE_LEN),
            allowCredentials: [{ id: credId, type: "public-key" }],
            userVerification: "required",
            extensions: { prf: { eval: { first: prfSalt } } },
            timeout: 60000,
          },
        });
      } catch (e) {
        console.warn("[BiometricUnlock] get() xác nhận lỗi:", e && e.name, e);
        return { ok: false, message: "Xác nhận sinh trắc học lần 2 thất bại. Vui lòng thử lại." };
      }

      let assertExt = {};
      try {
        assertExt = (assertion && assertion.getClientExtensionResults()) || {};
      } catch (e) {
        assertExt = {};
      }
      prfFirst = assertExt.prf && assertExt.prf.results && assertExt.prf.results.first;
      if (!prfFirst) {
        return {
          ok: false,
          message: "Trình duyệt/thiết bị này chưa hỗ trợ mở khóa sinh trắc học an toàn.",
        };
      }
    }

    try {
      const key = await _deriveKeyFromPrf(new Uint8Array(prfFirst));
      const iv = _rand(12);
      const ctBuf = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode(String(pinPlaintext))
      );
      const env = {
        v: 1,
        credId: _bufToB64(credId),
        prfSalt: _bufToB64(prfSalt),
        iv: _bufToB64(iv),
        ct: _bufToB64(ctBuf),
      };
      localStorage.setItem(ENV_KEY, JSON.stringify(env));
    } catch (e) {
      return { ok: false, message: "Lỗi khi lưu thông tin sinh trắc học." };
    }

    return { ok: true };
  }

  function disable() {
    try {
      localStorage.removeItem(ENV_KEY);
    } catch (e) { }
  }

  /** Gọi khi PIN vừa được đổi (saveSecuritySetup): envelope cũ mã hóa PIN cũ nên phải xóa. */
  function onPinChanged() {
    disable();
  }

  /**
   * Thử mở khóa bằng sinh trắc học. auto=true là lượt tự động khi hiện màn khóa
   * (mọi lỗi im lặng, fallback bàn phím PIN); không có auto là do user bấm nút
   * (lỗi sẽ báo toast, và được quyền hủy lượt auto đang treo để chạy ngay).
   */
  async function tryUnlock(auto) {
    const isAuto = auto === true;
    if (!isEnrolled()) return false;

    // Chặn 2 lời gọi WebAuthn chồng nhau (auto-prompt khi hiện màn khóa + user bấm nút):
    // lời gọi thứ 2 sẽ ném "A request is already pending" và nuốt mất lượt bấm.
    if (_unlockInFlight) {
      // Lượt auto có thể treo tới 60s (iOS hay để pending khi thiếu user gesture).
      // User chủ động bấm nút thì hủy lượt auto rồi chạy lượt mới thay vì nuốt cú bấm.
      if (!isAuto && _unlockIsAuto && _unlockAbort) {
        try { _unlockAbort.abort(); } catch (e) { }
        try { await _unlockPromise; } catch (e) { }
        if (_unlockInFlight) return false;
      } else {
        return false;
      }
    }

    _unlockInFlight = true;
    _unlockIsAuto = isAuto;
    _unlockAbort = (typeof AbortController === "function") ? new AbortController() : null;
    _unlockPromise = _tryUnlockInner(isAuto, _unlockAbort ? _unlockAbort.signal : undefined);
    try {
      return await _unlockPromise;
    } finally {
      _unlockInFlight = false;
      _unlockAbort = null;
      _unlockPromise = null;
    }
  }

  function _toast(msg) {
    try {
      // Các thông điệp của module này đều mang tính cảnh báo (sinh trắc học không
      // hợp lệ / xác thực thất bại) -> dùng toast cảnh báo thay vì "success".
      if (window.ErrorHandler) window.ErrorHandler.showWarning(msg);
      else if (typeof showToast === "function") showToast(msg);
    } catch (e) { }
  }

  /** Envelope hỏng/PIN đã đổi: tự tắt tính năng để user bật lại, thay vì kẹt im lặng mãi. */
  function _selfHeal() {
    disable();
    const btn = document.querySelector("[data-biometric-btn]");
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
    _toast("Sinh trắc học không còn hợp lệ, vui lòng nhập PIN và bật lại trong menu.");
  }

  async function _tryUnlockInner(isAuto, signal) {
    let env = null;
    try {
      env = JSON.parse(localStorage.getItem(ENV_KEY));
    } catch (e) {
      env = null;
    }
    if (!env || !env.credId || !env.prfSalt || !env.iv || !env.ct) return false;

    let assertion;
    try {
      assertion = await navigator.credentials.get({
        publicKey: {
          challenge: _rand(CHALLENGE_LEN),
          allowCredentials: [{ id: _b64ToBuf(env.credId), type: "public-key" }],
          userVerification: "required",
          extensions: { prf: { eval: { first: _b64ToBuf(env.prfSalt) } } },
          timeout: 60000,
        },
        signal: signal,
      });
    } catch (e) {
      // user hủy / NotAllowedError / iOS chặn vì thiếu user gesture -> fallback PIN
      console.warn("[BiometricUnlock] get() mở khóa lỗi:", e && e.name, e);
      // AbortError = bị lượt bấm tay chủ động hủy, không phải lỗi thật.
      if (!isAuto && !(e && e.name === "AbortError")) {
        _toast("Không xác thực được sinh trắc học. Vui lòng nhập mã PIN.");
      }
      return false;
    }

    let ext = {};
    try {
      ext = (assertion && assertion.getClientExtensionResults()) || {};
    } catch (e) {
      ext = {};
    }
    const prfFirst = ext.prf && ext.prf.results && ext.prf.results.first;
    if (!prfFirst) {
      // Xác thực OK nhưng trình duyệt không trả PRF: envelope này không bao giờ
      // giải mã được trên môi trường hiện tại -> tự tắt để user bật lại.
      _selfHeal();
      return false;
    }

    let pin = "";
    try {
      const key = await _deriveKeyFromPrf(new Uint8Array(prfFirst));
      const ptBuf = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(_b64ToBuf(env.iv)) },
        key,
        _b64ToBuf(env.ct)
      );
      pin = new TextDecoder().decode(ptBuf);
    } catch (e) {
      // PIN đã đổi ở nơi khác hoặc PRF lệch giữa lúc đăng ký và lúc mở khóa:
      // envelope vô dụng vĩnh viễn -> tự tắt + báo user bật lại, tránh "kẹt im lặng".
      _selfHeal();
      return false;
    }
    if (!pin) {
      _selfHeal();
      return false;
    }

    // QUAN TRỌNG: gán biến toàn cục TRẦN (không phải window.currentPin) — currentPin và
    // masterKey là khai báo `let` cấp top-level trong script cổ điển (00_globals.js /
    // 02_security.js), không phải property của window. Gán bằng identifier trần trong
    // cùng global scope để validatePin() đọc đúng biến nó đóng closure.
    try {
      currentPin = pin;
      if (typeof updatePinDots === "function") updatePinDots();
      if (typeof validatePin === "function") await validatePin();
    } catch (e) {
      return false;
    }
    return true;
  }

  // ------------------------------------------------------------
  // UI: nút trên màn hình khóa + modal thiết lập trong menu
  // ------------------------------------------------------------

  function _ensureUnlockButton(screenLockEl) {
    if (!screenLockEl || screenLockEl.querySelector("[data-biometric-btn]")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-biometric-btn", "1");
    btn.setAttribute("data-action", "BiometricUnlock.tryUnlock");
    btn.className = "flex flex-col items-center gap-1 mb-6 relative z-10";
    btn.style.color = "var(--text-main)";

    const iconWrap = document.createElement("span");
    iconWrap.className = "w-14 h-14 rounded-full flex items-center justify-center";
    iconWrap.style.background = "rgba(255,255,255,0.08)";
    const icon = document.createElement("i");
    icon.setAttribute("data-lucide", "fingerprint");
    icon.className = "w-6 h-6"; // w-7/h-7 không có trong bản build tailwind.clientpro.css
    iconWrap.appendChild(icon);

    const label = document.createElement("span");
    label.className = "text-xs font-bold opacity-80";
    label.textContent = "Mở khóa sinh trắc học";

    btn.appendChild(iconWrap);
    btn.appendChild(label);

    const pinDisplay = screenLockEl.querySelector("#pin-display");
    if (pinDisplay && pinDisplay.parentNode) {
      pinDisplay.parentNode.insertBefore(btn, pinDisplay);
    } else {
      screenLockEl.appendChild(btn);
    }
    try {
      if (window.lucide && typeof lucide.createIcons === "function") lucide.createIcons();
    } catch (e) { }
  }

  async function _onLockScreenShown() {
    const screenLockEl = (typeof getEl === "function") ? getEl("screen-lock") : document.getElementById("screen-lock");
    if (!screenLockEl) return;
    if (!isEnrolled()) return;
    if (!(await isAvailable())) return;

    _ensureUnlockButton(screenLockEl);

    if (!_autoTried && document.hasFocus()) {
      _autoTried = true;
      tryUnlock(true);
    }
  }

  function _initObserver() {
    const screenLockEl = (typeof getEl === "function") ? getEl("screen-lock") : document.getElementById("screen-lock");
    if (!screenLockEl) return;

    const observer = new MutationObserver(() => {
      const hidden = screenLockEl.classList.contains("hidden");
      if (!hidden) {
        _onLockScreenShown();
      } else {
        _autoTried = false;
      }
    });
    observer.observe(screenLockEl, { attributes: true, attributeFilter: ["class"] });

    if (!screenLockEl.classList.contains("hidden")) _onLockScreenShown();
  }

  async function _refreshMenuButtonVisibility() {
    const btn = document.getElementById("menu-biometric-btn");
    if (!btn) return;
    const ok = await isAvailable();
    btn.classList.toggle("hidden", !ok);
  }

  function _refreshSetupModalUI() {
    const enrolled = isEnrolled();
    const enrollBlock = document.getElementById("biometric-enroll-block");
    const enabledBlock = document.getElementById("biometric-enabled-block");
    if (enrollBlock) enrollBlock.classList.toggle("hidden", enrolled);
    if (enabledBlock) enabledBlock.classList.toggle("hidden", !enrolled);
    const pinInput = document.getElementById("biometric-confirm-pin");
    if (pinInput) pinInput.value = "";
  }

  function openSetup() {
    const modal = document.getElementById("biometric-setup-modal");
    if (!modal) return;
    // Đóng menu trước khi mở modal (giống openSecuritySetup trong 02_security.js).
    try {
      if (typeof _closeMenuIfOpen === "function") _closeMenuIfOpen();
    } catch (e) { }
    _refreshSetupModalUI();
    modal.classList.remove("hidden");
  }

  function closeSetup() {
    const modal = document.getElementById("biometric-setup-modal");
    if (modal) modal.classList.add("hidden");
  }

  async function confirmEnable() {
    const pinInput = document.getElementById("biometric-confirm-pin");
    const pin = pinInput ? pinInput.value.trim() : "";
    if (!/^\d{4,6}$/.test(pin)) {
      ErrorHandler.showError('VALIDATION', "Vui lòng nhập đúng mã PIN hiện tại.");
      return;
    }

    const btn = document.getElementById("biometric-enable-btn");
    const label = btn ? btn.textContent : "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Đang xác thực...";
    }

    const res = await enable(pin);

    if (btn) {
      btn.disabled = false;
      btn.textContent = label;
    }

    if (res && res.ok) {
      ErrorHandler.showSuccess("Đã bật mở khóa sinh trắc học.");
      _refreshSetupModalUI();
    } else {
      ErrorHandler.showError('AUTH', (res && res.message) || "Không thể bật mở khóa sinh trắc học.");
    }
  }

  function requestDisable() {
    disable();
    ErrorHandler.showSuccess("Đã tắt mở khóa sinh trắc học.");
    _refreshSetupModalUI();
  }

  async function _boot() {
    try {
      if (window.__clientpro_modals_ready && typeof window.__clientpro_modals_ready.then === "function") {
        await window.__clientpro_modals_ready;
      }
    } catch (e) { }
    _initObserver();
    _refreshMenuButtonVisibility();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _boot);
  } else {
    _boot();
  }

  window.BiometricUnlock = {
    isAvailable,
    isEnrolled,
    enable,
    disable,
    onPinChanged,
    tryUnlock,
    openSetup,
    closeSetup,
    confirmEnable,
    requestDisable,
  };
})();

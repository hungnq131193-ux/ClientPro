// ============================================================
// 15_auth_gate.js
// Auth Gate: kiểm tra quyền khi mở app (kể cả user cũ)
// - Nếu bị khóa / sai thiết bị / chưa kích hoạt => chặn truy cập
// - Nếu offline hoặc lỗi mạng => không chặn UI (chỉ hạn chế Backup/Restore như logic hiện có)
// ============================================================

(function () {
  "use strict";

  const AUTH_GATE_LAST_OK_TS = "app_auth_gate_last_ok_ts";
  const AUTH_GATE_LAST_MSG = "app_auth_gate_last_msg";
  const AUTH_GATE_COOLDOWN_UNTIL = "app_auth_gate_cooldown_until";
  const AUTH_GATE_LOCK_STRIKES = "app_auth_gate_lock_strikes";

  // TTL 24h: giảm tải GAS/Sheet khi nhiều người mở app.
  // Lưu ý: Backup/Restore vẫn kiểm tra realtime theo ensureBackupSecret() như logic hiện có.
  const AUTH_TTL_MS = 24 * 60 * 60 * 1000;
  const AUTH_COOLDOWN_MS = 5 * 60 * 1000;
  const AUTH_LOCK_STRIKE_WINDOW_MS = 6 * 60 * 60 * 1000;
  const AUTH_LOCK_STRIKES_REQUIRED = 2;

  // Single-flight để tránh gọi GAS trùng trong cùng một phiên mở app.
  // Chỉ hợp lệ TRONG CÙNG một thế hệ khóa: request phát lúc app còn khóa sẽ bị
  // _checkByIssueKdata bỏ (requestStillCurrent -> stale) khi unlock đổi generation.
  // Tái dùng nó cho lời gọi sau unlock đồng nghĩa await một kết quả rỗng và bỏ luôn
  // lần check thật của cả phiên -> phải phát request mới khi generation đã đổi.
  let _inflight = null;
  let _inflightGen = null;

  function _safeText(x) {
    try {
      return String(x == null ? "" : x);
    } catch (e) {
      return "";
    }
  }

  function _parseMaybeJson(txt) {
    const s = _safeText(txt).trim();
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  }

  function _ensureGateUI() {
    if (document.getElementById("auth-gate-overlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "auth-gate-overlay";
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "99999";
    overlay.style.display = "none";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.padding = "16px";
    overlay.style.background = "rgba(0,0,0,0.65)";

    const card = document.createElement("div");
    card.style.maxWidth = "520px";
    card.style.width = "100%";
    card.style.borderRadius = "18px";
    card.style.padding = "18px";
    card.style.boxShadow = "0 20px 60px rgba(0,0,0,0.35)";
    // Theo token theme (fallback tối cũ khi token chưa nạp) — hết lạc tông trên theme sáng.
    card.style.background = "var(--bg-panel, #111827)";
    card.style.color = "var(--text-main, #fff)";
    card.style.border = "1px solid var(--border-panel, rgba(255,255,255,0.12))";
    card.style.backdropFilter = "blur(14px)";

    const title = document.createElement("div");
    title.id = "auth-gate-title";
    title.textContent = "Quyền truy cập bị chặn";
    title.style.fontSize = "18px";
    title.style.fontWeight = "700";
    title.style.marginBottom = "10px";

    const msg = document.createElement("div");
    msg.id = "auth-gate-message";
    msg.textContent = "Thiết bị của bạn không còn quyền sử dụng.";
    msg.style.fontSize = "14px";
    msg.style.opacity = "0.95";
    msg.style.lineHeight = "1.45";

    const hint = document.createElement("div");
    hint.id = "auth-gate-hint";
    hint.style.marginTop = "10px";
    hint.style.fontSize = "12px";
    hint.style.opacity = "0.8";
    hint.textContent = "Vui lòng liên hệ Admin để kích hoạt lại.";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "10px";
    actions.style.marginTop = "14px";

    const btnReset = document.createElement("button");
    btnReset.id = "auth-gate-reset";
    btnReset.textContent = "Thoát và kích hoạt lại";
    btnReset.style.flex = "1";
    btnReset.style.padding = "12px 12px";
    btnReset.style.borderRadius = "12px";
    btnReset.style.border = "0";
    btnReset.style.cursor = "pointer";
    btnReset.style.background = "var(--accent-gradient, var(--accent, #2563eb))";
    btnReset.style.color = "#fff";
    btnReset.style.fontWeight = "700";

    const btnCopy = document.createElement("button");
    btnCopy.id = "auth-gate-copy";
    btnCopy.textContent = "Sao chép thông báo";
    btnCopy.style.flex = "1";
    btnCopy.style.padding = "12px 12px";
    btnCopy.style.borderRadius = "12px";
    btnCopy.style.border = "1px solid var(--border-panel, rgba(255,255,255,0.2))";
    btnCopy.style.cursor = "pointer";
    btnCopy.style.background = "transparent";
    btnCopy.style.color = "var(--text-main, #fff)";
    btnCopy.style.fontWeight = "600";

    actions.appendChild(btnReset);
    actions.appendChild(btnCopy);
    card.appendChild(title);
    card.appendChild(msg);
    card.appendChild(hint);
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    btnReset.addEventListener("click", () => {
      try {
        // Xóa vật liệu khóa RAM TRƯỚC khi bỏ PIN_KEY: lockApp() return sớm khi
        // không còn PIN_KEY nên gọi sau đó là vô tác dụng.
        if (typeof revokeUnlockedSession === "function") revokeUnlockedSession();
      } catch (e) {}
      try {
        // Thu hồi kích hoạt để buộc user phải activate lại.
        if (typeof ACTIVATED_KEY !== "undefined") localStorage.removeItem(ACTIVATED_KEY);
        if (typeof PIN_KEY !== "undefined") localStorage.removeItem(PIN_KEY);
        // PIN bị thu hồi thì envelope sinh trắc học (mã hóa PIN cũ) cũng phải bỏ
        if (window.BiometricUnlock) window.BiometricUnlock.disable();
        // Không xóa dữ liệu khách hàng (IndexedDB) để tránh mất dữ liệu.
      } catch (e) {}
      try {
        // Mở modal activation nếu tồn tại
        const actModal = document.getElementById("activation-modal");
        if (actModal) actModal.classList.remove("hidden");
      } catch (e) {}
      // Ẩn overlay để user thao tác nhập key
      try {
        overlay.style.display = "none";
      } catch (e) {}
    });

    btnCopy.addEventListener("click", async () => {
      const t = _safeText(document.getElementById("auth-gate-message")?.textContent);
      try {
        await navigator.clipboard.writeText(t);
      } catch (e) {
        try {
          const ta = document.createElement("textarea");
          ta.value = t;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        } catch (e2) {}
      }
    });
  }

  function _block(message) {
    _ensureGateUI();

    const overlay = document.getElementById("auth-gate-overlay");
    const msgEl = document.getElementById("auth-gate-message");
    const titleEl = document.getElementById("auth-gate-title");

    if (titleEl) titleEl.textContent = "Quyền truy cập bị chặn";
    if (msgEl) msgEl.textContent = message || "Thiết bị của bạn không còn quyền sử dụng.";
    if (overlay) overlay.style.display = "flex";

    try {
      localStorage.setItem(AUTH_GATE_LAST_MSG, _safeText(message));
    } catch (e) {}
  }

  async function _checkByIssueKdata() {
    // Điều kiện tối thiểu để check
    const activated = (typeof ACTIVATED_KEY !== "undefined") ? localStorage.getItem(ACTIVATED_KEY) : null;
    // RAM trước (sau unlock — máy đã migrate không còn plaintext), fallback plaintext
    // (cửa sổ kích hoạt / máy legacy). Cùng nguồn với _resolveEmployeeId (02_security.js).
    let employeeId = "";
    try {
      if (typeof __employeeIdPlain !== "undefined" && __employeeIdPlain) {
        employeeId = String(__employeeIdPlain).trim();
      }
    } catch (e) {}
    if (!employeeId) {
      employeeId = (typeof EMPLOYEE_KEY !== "undefined") ? (localStorage.getItem(EMPLOYEE_KEY) || "") : "";
    }
    if (!activated || !employeeId) return { ok: true, skipped: true };
    const requestGeneration = (typeof __keyGeneration !== "undefined") ? __keyGeneration : null;
    const requestWasUnlocked = (typeof isAppUnlocked === "function") ? isAppUnlocked() : false;
    const requestStillCurrent = () => {
      try {
        if (!localStorage.getItem(ACTIVATED_KEY)) return false;
        let currentEmployeeId = "";
        if (typeof __employeeIdPlain !== "undefined" && __employeeIdPlain) currentEmployeeId = String(__employeeIdPlain).trim();
        if (!currentEmployeeId) currentEmployeeId = (localStorage.getItem(EMPLOYEE_KEY) || "").trim();
        if (currentEmployeeId !== employeeId) return false;
        if (requestGeneration !== null && requestGeneration !== __keyGeneration) return false;
        if (requestWasUnlocked && typeof isAppUnlocked === "function" && !isAppUnlocked()) return false;
        return true;
      } catch (e) { return false; }
    };

    // Nếu không có GAS URL thì không thể check
    if (typeof ADMIN_SERVER_URL === "undefined" || !ADMIN_SERVER_URL) return { ok: true, skipped: true };

    // Nếu offline thì không chặn (giữ UX). Backup/restore đã tự chặn theo ensureBackupSecret().
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return { ok: true, skipped: true, offline: true };
    }

    // TTL: nếu đã OK trong 24h thì bỏ qua check để giảm tải.
    try {
      const lastOk = parseInt(localStorage.getItem(AUTH_GATE_LAST_OK_TS) || "0", 10) || 0;
      if (lastOk && (Date.now() - lastOk) < AUTH_TTL_MS) {
        return { ok: true, skipped: true, ttl: true };
      }
    } catch (e) {}

    // Cooldown nếu trước đó GAS lỗi/timeout: tránh spam retry.
    try {
      const until = parseInt(localStorage.getItem(AUTH_GATE_COOLDOWN_UNTIL) || "0", 10) || 0;
      if (until && Date.now() < until) {
        return { ok: true, skipped: true, cooldown: true };
      }
    } catch (e) {}

    const deviceId = (typeof getDeviceId === "function") ? getDeviceId() : (localStorage.getItem("app_device_unique_id") || "");
    const url = `${ADMIN_SERVER_URL}?action=issue_kdata&employeeId=${encodeURIComponent(employeeId)}&deviceId=${encodeURIComponent(deviceId)}&_t=${Date.now()}`;

    let txt = "";
    try {
      const res = await fetch(url, { method: "GET", cache: "no-store" });
      txt = await res.text();
    } catch (e) {
      // Lỗi mạng/timeout: không chặn UI nhưng đặt cooldown để không spam.
      try {
        localStorage.setItem(AUTH_GATE_COOLDOWN_UNTIL, String(Date.now() + AUTH_COOLDOWN_MS));
      } catch (e2) {}
      return { ok: true, skipped: true, neterr: true };
    }
    const js = _parseMaybeJson(txt);
    // Response của phiên/identity cũ không được ghi KDATA hoặc tạo strike cho phiên mới.
    if (!requestStillCurrent()) return { ok: true, skipped: true, stale: true };

    // Contract ưu tiên JSON: {status:'success'|'error'|'locked', message, kdata_b64u}
    if (js && typeof js === "object") {
      const st = _safeText(js.status).toLowerCase();
      const msg = _safeText(js.message);
      if (st === "success") {
        // Cache KDATA để backup/restore dùng nhanh (không thay đổi logic ensureBackupSecret).
        try {
          if (js.kdata_b64u && typeof APP_BACKUP_KDATA_B64U !== "undefined") {
            APP_BACKUP_KDATA_B64U = _safeText(js.kdata_b64u);
          }
        } catch (e) {}
        // Ghi cache KDATA chung (02_security.js) để ensureBackupSecret() dùng lại ngay,
        // tránh đụng rate-limit 30s của issue_kdata phía GAS khi user backup ngay sau khi mở app.
        try {
          if (js.kdata_b64u && typeof _writeCachedKdata === "function") {
            _writeCachedKdata(employeeId, deviceId, _safeText(js.kdata_b64u));
          }
        } catch (e) {}
        try {
          localStorage.setItem(AUTH_GATE_LAST_OK_TS, String(Date.now()));
        } catch (e) {}
        return { ok: true };
      }
      if (st === "locked") return { ok: false, reason: "locked", message: msg || "Tài khoản đã bị khóa." };
      if (st === "error") {
        // Admin GAS v12: issue_kdata KHÔNG trả status:'locked' — khóa/sai thiết bị đều về
        // status:'error' + message tiếng Việt không dấu ("ISSUE_KDATA FAIL: ..."), nên phải
        // phân loại theo message thì gate mới chặn được.
        const lowMsg = msg.toLowerCase();
        if (/bi khoa|bị khóa/.test(lowMsg)) {
          return { ok: false, reason: "locked", message: "Tài khoản của bạn đã bị khóa." };
        }
        if (/sai thiet bi|khong khop|device id/.test(lowMsg)) {
          return { ok: false, reason: "device", message: "Sai thiết bị (Device ID không khớp)." };
        }
        // "chua kich hoat" / "chua gan thiet bi" / rate-limited / lỗi chung: soft-fail,
        // không chặn UI (backup/restore vẫn tự giới hạn qua ensureBackupSecret).
        try {
          localStorage.setItem(AUTH_GATE_COOLDOWN_UNTIL, String(Date.now() + AUTH_COOLDOWN_MS));
        } catch (e) {}
        return { ok: true, skipped: true, softError: true, message: msg || "" };
      }

      // Unknown status -> không chặn, chỉ coi như không xác định
      return { ok: true, unknown: true };
    }

    // Fallback text parsing (defensive)
    const low = _safeText(txt).toLowerCase();
    if (low.includes("locked") || low.includes("khoa")) {
      return { ok: false, reason: "locked", message: "Tài khoản của bạn đã bị khóa." };
    }
    if (low.includes("sai thiet bi") || low.includes("device") || low.includes("khong khop")) {
      return { ok: false, reason: "device", message: "Sai thiết bị (Device ID không khớp)." };
    }
    if (low.includes("chua kich hoat") || low.includes("chưa kích hoạt")) {
      return { ok: false, reason: "inactive", message: "Tài khoản chưa kích hoạt." };
    }
    return { ok: true };
  }

  function _registerLockStrike() {
    try {
      const now = Date.now();
      const raw = localStorage.getItem(AUTH_GATE_LOCK_STRIKES) || "";
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        data = null;
      }
      const firstTs = data && Number(data.firstTs || 0) ? Number(data.firstTs) : now;
      const count = data && Number(data.count || 0) ? Number(data.count) : 0;
      const inWindow = now - firstTs <= AUTH_LOCK_STRIKE_WINDOW_MS;
      const next = {
        firstTs: inWindow ? firstTs : now,
        count: inWindow ? count + 1 : 1,
      };
      localStorage.setItem(AUTH_GATE_LOCK_STRIKES, JSON.stringify(next));
      return next.count >= AUTH_LOCK_STRIKES_REQUIRED;
    } catch (e) {
      return false; // fail-open để tránh khóa oan khi localStorage bị lỗi tạm
    }
  }

  function _resetLockStrikes() {
    try {
      localStorage.removeItem(AUTH_GATE_LOCK_STRIKES);
    } catch (e) {}
  }

  async function preflight() {
    const curGen = (typeof __keyGeneration !== "undefined") ? __keyGeneration : null;
    try {
      if (_inflight && _inflightGen === curGen) return await _inflight;
      _inflightGen = curGen;
      const run = (async () => {
        const r = await _checkByIssueKdata();
        if (!r || r.ok) {
          // CHỈ xóa strike khi server thật sự trả verdict OK. Kết quả `skipped`
          // (chưa có mã NV lúc boot trên máy đã seal, thiếu ADMIN_SERVER_URL,
          // offline, TTL, cooldown, lỗi mạng, softError) và `unknown` KHÔNG
          // chứng minh thiết bị còn quyền — đó là "hoãn kiểm tra", không phải
          // "đã kiểm tra và sạch". Xóa strike ở đó khiến mỗi lần mở lại app
          // reset bộ đếm, nên lần check thật sau unlock mãi mãi chỉ đạt strike
          // #1 và ngưỡng AUTH_LOCK_STRIKES_REQUIRED không bao giờ tới.
          if (r && r.ok && !r.skipped && !r.unknown) _resetLockStrikes();
          return true;
        }

        // Chỉ chặn cứng + thu hồi khi server báo LOCKED / SAI THIẾT BỊ liên tiếp nhiều lần
        // (2 strike trong 6h) — tránh chặn oan vì lỗi thoáng qua phía server.
        if (r.reason === "locked" || r.reason === "device") {
          const shouldBlock = _registerLockStrike();
          if (!shouldBlock) {
            try {
              localStorage.setItem(AUTH_GATE_COOLDOWN_UNTIL, String(Date.now() + AUTH_COOLDOWN_MS));
            } catch (e) {}
            return true;
          }
          // Đủ strike: thu hồi kích hoạt local và chặn UI (nút "Thoát và kích hoạt lại"
          // trên overlay sẽ mở activation-modal để user activate + bind lại thiết bị).
          // preflight cũng chạy SAU unlock (listener bên dưới) nên phải xóa vật liệu
          // khóa trong RAM trước, không để phiên vừa bị thu hồi còn masterKey/KDATA.
          try {
            if (typeof revokeUnlockedSession === "function") revokeUnlockedSession();
          } catch (e) {}
          try {
            if (typeof ACTIVATED_KEY !== "undefined") localStorage.removeItem(ACTIVATED_KEY);
          } catch (e) {}
          _block(r.message || "Thiết bị của bạn không còn quyền sử dụng.");
          return false;
        }

        // Các lý do khác (chưa kích hoạt, chưa gắn thiết bị...): soft-fail, không chặn UI.
        _resetLockStrikes();
        return true;
      })();
      _inflight = run;
      const ok = await run;
      // Chỉ dọn slot của CHÍNH mình: một preflight thế hệ mới có thể đã thay chỗ
      // trong lúc await, xóa vô điều kiện là hủy single-flight của lời gọi đó.
      if (_inflight === run) { _inflight = null; _inflightGen = null; }
      return ok;
    } catch (e) {
      if (_inflightGen === curGen) { _inflight = null; _inflightGen = null; }
      // Lỗi mạng/parse: không chặn UI
      return true;
    }
  }

  // Máy đã migrate không còn plaintext mã NV lúc boot -> chạy lại preflight ngay
  // sau khi mở khóa (RAM đã có mã NV). TTL 24h + cooldown trong _checkByIssueKdata
  // tự chống gọi lặp; fire-and-forget như lời gọi lúc boot (10_bootstrap.js).
  try {
    document.addEventListener("clientpro:unlocked", () => {
      try { preflight(); } catch (e) {}
      // check_status trong checkSecurity() cũng bị bỏ qua lúc boot vì cùng lý do
      // (chưa có mã NV). Chạy bù ở đây để giữ đường thu hồi TỨC THÌ (server báo
      // locked -> thu hồi app_activated ngay lần đầu), thay vì chỉ còn đường
      // 2-strike của preflight. Cờ __serverStatusChecked chống gọi lặp.
      try {
        if (typeof runServerStatusCheck === "function") runServerStatusCheck();
      } catch (e) {}
    });
  } catch (e) {}

  // Expose
  window.AuthGate = {
    preflight,
    block: _block,
  };
})();

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

  // TTL 24h: giảm tải GAS/Sheet khi nhiều người mở app.
  // Lưu ý: Backup/Restore vẫn kiểm tra realtime theo ensureBackupSecret() như logic hiện có.
  const AUTH_TTL_MS = 24 * 60 * 60 * 1000;
  const AUTH_COOLDOWN_MS = 5 * 60 * 1000;

  // Single-flight để tránh gọi GAS trùng trong cùng một phiên mở app.
  let _inflight = null;

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
    card.style.background = "#111827";
    card.style.color = "#fff";

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
    btnReset.style.background = "#2563eb";
    btnReset.style.color = "#fff";
    btnReset.style.fontWeight = "700";

    const btnCopy = document.createElement("button");
    btnCopy.id = "auth-gate-copy";
    btnCopy.textContent = "Sao chép thông báo";
    btnCopy.style.flex = "1";
    btnCopy.style.padding = "12px 12px";
    btnCopy.style.borderRadius = "12px";
    btnCopy.style.border = "1px solid rgba(255,255,255,0.2)";
    btnCopy.style.cursor = "pointer";
    btnCopy.style.background = "transparent";
    btnCopy.style.color = "#fff";
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
        // Thu hồi kích hoạt để buộc user phải activate lại.
        if (typeof ACTIVATED_KEY !== "undefined") localStorage.removeItem(ACTIVATED_KEY);
        if (typeof PIN_KEY !== "undefined") localStorage.removeItem(PIN_KEY);
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
    const employeeId = (typeof EMPLOYEE_KEY !== "undefined") ? (localStorage.getItem(EMPLOYEE_KEY) || "") : "";
    if (!activated || !employeeId) return { ok: true, skipped: true };

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
        try {
          localStorage.setItem(AUTH_GATE_LAST_OK_TS, String(Date.now()));
        } catch (e) {}
        return { ok: true };
      }
      if (st === "locked") return { ok: false, reason: "locked", message: msg || "Tài khoản đã bị khóa." };
      if (st === "error") return { ok: false, reason: "error", message: msg || "Không đủ quyền sử dụng." };

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

  async function preflight() {
    try {
      if (_inflight) return await _inflight;
      _inflight = (async () => {
        const r = await _checkByIssueKdata();
        if (!r || r.ok) return true;

        // Thu hồi kích hoạt ở client để lần sau bắt buộc activate lại
        try {
          if (typeof ACTIVATED_KEY !== "undefined") localStorage.removeItem(ACTIVATED_KEY);
        } catch (e) {}

        _block(r.message || "Thiết bị của bạn không còn quyền sử dụng.");
        return false;
      })();
      const ok = await _inflight;
      _inflight = null;
      return ok;
    } catch (e) {
      _inflight = null;
      // Lỗi mạng/parse: không chặn UI
      return true;
    }
  }

  // Expose
  window.AuthGate = {
    preflight,
    block: _block,
  };
})();

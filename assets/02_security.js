// ---- Security & Encryption Helpers ----
// --- Security & Encryption Helpers (ADVANCED RECOVERY MODE) ---
// Sử dụng masterKey cho cơ chế mã hóa toàn bộ dữ liệu và khôi phục bằng mã nhân viên.
let masterKey = null;
/** * Hằng số bí mật dùng để mã hóa/giải mã dữ liệu backup. * Cần giữ bí mật chuỗi này để đảm bảo file backup không thể đọc được nếu không có khóa. */
let APP_BACKUP_SECRET = "";

/** * Compute a SHA-256 hash of the provided PIN string and return it as a hex string. * Uses the Web Crypto API for consistent hashing. * @param {string} pin * @returns {Promise<string>} */
async function hashString(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** * Encrypt a text value using AES và masterKey. Nếu chưa có masterKey thì trả về nguyên bản. * @param {string} text * @returns {string} */
// --- THÊM ĐOẠN NÀY ---
function getDeviceId() {
  const STORAGE_KEY = "app_device_unique_id";
  let deviceId = localStorage.getItem(STORAGE_KEY);
  // Nếu chưa có ID (máy mới), tạo ID ngẫu nhiên và lưu lại
  if (!deviceId) {
    deviceId =
      "dev_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    localStorage.setItem(STORAGE_KEY, deviceId);
  }
  return deviceId;
}
// ---------------------

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
      a.ocrData = decryptText(a.ocrData);
      a.driveLink = decryptText(a.driveLink);
    });
  }
  cust.driveLink = decryptText(cust.driveLink);
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
// --- EXISTING LOGIC ---
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
      const query = `?action=check_status&employeeId=${encodeURIComponent( savedEmp )}&deviceInfo=${encodeURIComponent(navigator.userAgent)}`;

      const res = await fetch(ADMIN_SERVER_URL + query);
      const txt = await res.text();
      let result;
      try {
        result = JSON.parse(txt);
      } catch (e) {
        result = txt;
      }

      // Nạp Key bí mật vào RAM
      // Nạp Key bí mật vào RAM (hỗ trợ cả trường hợp server trả về text)
      if (result && typeof result === "object" && result.secret) {
        APP_BACKUP_SECRET = result.secret;
      } else if (typeof result === "string") {
        const m = result.match(
          /"secret"\s*:\s*"([^"]+)"|secret\s*[:=]\s*([A-Za-z0-9_\-\.]+)/i
        );
        const secret = m ? m[1] || m[2] : "";
        if (secret) APP_BACKUP_SECRET = secret;
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
    console.log("Offline mode: Tính năng Backup bảo mật tạm thời bị tắt.");
  }
}

/** * BẢO MẬT BACKUP V1 (Phương án 1): * Mỗi lần người dùng bấm Backup/Restore, gọi lại server để: * - xác thực trạng thái key/device hiện tại * - nhận lại APP_BACKUP_SECRET (khóa mã hóa file backup) * Nếu không nhận được secret thì coi như không đủ quyền backup/restore. */
async function ensureBackupSecret() {
  const employeeId = localStorage.getItem(EMPLOYEE_KEY) || "";
  if (!employeeId) {
    return { ok: false, message: "Chưa có mã nhân viên." };
  }

  // Nếu offline thì không thể xin secret
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, message: "Thiết bị đang Offline." };
  }

  try {
    // Đồng bộ hoàn toàn với bản index(7) chạy ổn:
    // check_status chỉ gửi employeeId + deviceInfo, không gửi deviceId
    const query = `?action=check_status&employeeId=${encodeURIComponent( employeeId )}&deviceInfo=${encodeURIComponent(navigator.userAgent)}`;

    // Không truyền options để tránh khác biệt hành vi cache/redirect trên một số WebView/PWA
    const res = await fetch(ADMIN_SERVER_URL + query);
    const txt = await res.text();

    // Hỗ trợ cả 2 trường hợp Apps Script trả về JSON hoặc plain text
    let result;
    try {
      result = JSON.parse(txt);
    } catch (e) {
      result = txt;
    }

    // Nếu bị thu hồi quyền -> thu hồi kích hoạt ngay
    const statusStr =
      result && typeof result === "object" && result.status
        ? String(result.status).toLowerCase()
        : typeof result === "string" && result.toLowerCase().includes("locked")
        ? "locked"
        : "";
    if (statusStr === "locked") {
      try {
        localStorage.removeItem(ACTIVATED_KEY);
      } catch (e) {}
      const modal = getEl("activation-modal");
      if (modal) modal.classList.remove("hidden");
      const titleEl = document.getElementById("activation-title");
      if (titleEl)
        titleEl.textContent =
          (result && typeof result === "object" && result.message
            ? result.message
            : "Tài khoản đã bị thu hồi!");
      return {
        ok: false,
        message:
          (result && typeof result === "object" && result.message
            ? result.message
            : "Tài khoản đã bị thu hồi."),
      };
    }

    // Nhận secret (tương thích nhiều kiểu trả về)
    let secret = "";
    if (result && typeof result === "object") {
      secret =
        result.secret ||
        (result.data && result.data.secret) ||
        (result.payload && result.payload.secret) ||
        result.backupSecret ||
        result.key ||
        "";
    } else if (typeof result === "string") {
      const m = result.match(
        /"secret"\s*:\s*"([^"]+)"|secret\s*[:=]\s*([A-Za-z0-9_\-\.]+)/i
      );
      secret = m ? m[1] || m[2] : "";
    }

    if (secret) {
      APP_BACKUP_SECRET = secret;
      return { ok: true };
    }

    // Log để chẩn đoán (không ảnh hưởng UI)
    try {
      console.log(
        "[ensureBackupSecret] Server response (no secret):",
        txt && txt.length > 300 ? txt.slice(0, 300) + "..." : txt
      );
    } catch (e) {}

    return { ok: false, message: "Không nhận được khóa bảo mật từ server." };
  } catch (e) {
    return {
      ok: false,
      message: "Không thể kết nối server để lấy khóa bảo mật.",
    };
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
  if (localStorage.getItem(PIN_KEY)) {
    getEl("setup-lock-modal").classList.add("hidden");
  } else {
    alert("Bạn cần thiết lập bảo mật!");
  }
}
async function saveSecuritySetup() {
  const pin = getEl("setup-pin").value;
  let ans = getEl("setup-answer").value.trim();
  if (pin.length !== 4 || isNaN(pin)) return alert("Mã PIN phải là 4 số");
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
  /* * Thiết lập bảo mật mới: * - Sinh masterKey nếu chưa tồn tại * - Băm PIN và mã nhân viên bằng SHA-256 * - Mã hóa masterKey bằng 2 khóa băm này và lưu vào localStorage để phục vụ mở khóa hằng ngày (PIN) và khôi phục (mã nhân viên) */
  const hashedPin = await hashString(pin);
  const hashedAns = await hashString(ans);
  // Nếu masterKey chưa sinh (lần đầu thiết lập), tạo mới
  if (!masterKey) {
    masterKey = generateMasterKey();
  }
  // Lưu 2 phiên bản masterKey đã mã hóa: một bằng PIN để đăng nhập hằng ngày, một bằng mã nhân viên để khôi phục
  const encByPin = CryptoJS.AES.encrypt(masterKey, hashedPin).toString();
  const encByAns = CryptoJS.AES.encrypt(masterKey, hashedAns).toString();
  localStorage.setItem(PIN_KEY, encByPin);
  localStorage.setItem(SEC_KEY, encByAns);
  // Ẩn hộp thoại và thông báo
  getEl("setup-lock-modal").classList.add("hidden");
  showToast("Đã lưu bảo mật");
}
function showLockScreen() {
  getEl("screen-lock").classList.remove("hidden");
  currentPin = "";
  updatePinDots();
}
function enterPin(num) {
  if (currentPin.length < 4) {
    currentPin += num;
    updatePinDots();
    if (currentPin.length === 4) validatePin();
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
  const encMaster = localStorage.getItem(PIN_KEY);
  // Tính băm của PIN nhập vào
  const hashedPin = await hashString(currentPin);
  let decrypted = "";
  try {
    const bytes = CryptoJS.AES.decrypt(String(encMaster), hashedPin);
    decrypted = bytes.toString(CryptoJS.enc.Utf8);
  } catch (e) {
    decrypted = "";
  }
  if (decrypted && decrypted.startsWith("mk_")) {
    // Nếu giải mã thành công, thiết lập masterKey và mở khóa giao diện
    masterKey = decrypted;
    getEl("screen-lock").classList.add("hidden");
    // Sau khi unlock, tải lại danh sách khách hàng để giải mã dữ liệu
    loadCustomers(getEl("search-input").value);
  } else {
    setTimeout(() => {
      alert("Sai mã PIN");
      clearPin();
    }, 100);
  }
}
function forgotPin() {
  getEl("forgot-pin-modal").classList.remove("hidden");
}
function closeForgotModal() {
  getEl("forgot-pin-modal").classList.add("hidden");
}
async function checkRecovery() {
  const input = getEl("recovery-answer").value;
  const encMaster = localStorage.getItem(SEC_KEY);
  const hashedAns = await hashString(input);
  let decrypted = "";
  try {
    const bytes = CryptoJS.AES.decrypt(String(encMaster), hashedAns);
    decrypted = bytes.toString(CryptoJS.enc.Utf8);
  } catch (e) {
    decrypted = "";
  }
  if (decrypted && decrypted.startsWith("mk_")) {
    // Khôi phục masterKey và cho phép đặt lại PIN
    masterKey = decrypted;
    alert("Xác thực thành công. Tạo PIN mới.");
    closeForgotModal();
    // Ẩn màn hình khóa, mở modal thiết lập PIN mới
    getEl("screen-lock").classList.add("hidden");
    getEl("setup-lock-modal").classList.remove("hidden");
    getEl("setup-pin").value = "";
    // điền sẵn mã nhân viên để người dùng không cần gõ lại
    getEl("setup-answer").value = input;
  } else {
    alert("Mã nhân viên không khớp!");
  }
}

/** * Xử lý kích hoạt ứng dụng bằng cách gửi mã key và mã nhân viên lên server. * Sau khi server xác nhận thành công, lưu trạng thái kích hoạt và mã nhân viên vào localStorage rồi mở giao diện thiết lập PIN. */
// Tìm hàm activateApp cũ và thay thế phần đầu bằng đoạn code sau:

async function activateApp() {
  const keyInput = getEl("activation-key");
  const empInput = getEl("activation-employee");
  const key = keyInput ? keyInput.value.trim() : "";
  const employeeId = empInput ? empInput.value.trim() : "";

  if (!key || !employeeId) {
    alert("Vui lòng nhập đầy đủ Mã kích hoạt và Mã nhân viên");
    return;
  }

  // --- BẮT ĐẦU THAY ĐỔI TỪ ĐÂY ---

  // 1. Gọi hàm lấy ID thiết bị vừa viết ở bước trên
  const deviceId = getDeviceId();

  const scriptUrl = ADMIN_SERVER_URL;

  // 2. Sửa dòng query cũ (XÓA DÒNG CŨ ĐI)
  // Dòng cũ: const query = `?action=activate&key=${encodeURIComponent(key)}&employeeId=${encodeURIComponent(employeeId)}&deviceInfo=${encodeURIComponent(navigator.userAgent)}`;

  // 3. THAY BẰNG DÒNG MỚI (Có thêm &deviceId=...)
  const query = `?action=activate&key=${encodeURIComponent( key )}&employeeId=${encodeURIComponent(employeeId)}&deviceId=${encodeURIComponent( deviceId )}&deviceInfo=${encodeURIComponent(navigator.userAgent)}`;

  // --- KẾT THÚC THAY ĐỔI ---

  try {
    const res = await fetch(scriptUrl + query);
    // ... (Phần code xử lý kết quả bên dưới giữ nguyên không cần sửa) ...
    let result;
    // --- ĐOẠN CODE ĐÃ SỬA ---
    const txt = await res.text(); // Đọc dữ liệu ra text 1 lần duy nhất
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
      // Thành công: xử lý tùy theo máy mới hay tái kích hoạt
      if (result.secret) {
        APP_BACKUP_SECRET = result.secret;
        console.log("Đã nhận chìa khóa bảo mật từ Server");
      }
      const hasOldData = !!localStorage.getItem(SEC_KEY);
      if (!hasOldData) {
        // Trường hợp máy mới: Lưu trạng thái kích hoạt và yêu cầu tạo PIN mới
        localStorage.setItem(ACTIVATED_KEY, "true");
        localStorage.setItem(EMPLOYEE_KEY, employeeId);
        const modal = getEl("activation-modal");
        if (modal) modal.classList.add("hidden");
        // Hiển thị thiết lập PIN
        getEl("setup-lock-modal").classList.remove("hidden");
        getEl("setup-pin").value = "";
        getEl("setup-answer").value = employeeId;
        showToast("Kích hoạt thành công! Vui lòng tạo mã PIN.");
      } else {
        // Tái kích hoạt trên máy đã có dữ liệu: xác thực mã nhân viên
        const encMaster = localStorage.getItem(SEC_KEY);
        let decrypted = "";
        try {
          const hashedAns = await hashString(employeeId);
          const bytes = CryptoJS.AES.decrypt(String(encMaster), hashedAns);
          decrypted = bytes.toString(CryptoJS.enc.Utf8);
        } catch (e) {
          decrypted = "";
        }
        if (decrypted && decrypted.startsWith("mk_")) {
          // Đúng nhân viên cũ: giữ nguyên masterKey và dữ liệu, gia hạn thành công
          masterKey = decrypted;
          localStorage.setItem(ACTIVATED_KEY, "true");
          localStorage.setItem(EMPLOYEE_KEY, employeeId);
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
            } catch (e) {}
            // Đặt lại masterKey và lưu trạng thái kích hoạt mới
            masterKey = null;
            localStorage.setItem(ACTIVATED_KEY, "true");
            localStorage.setItem(EMPLOYEE_KEY, employeeId);
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

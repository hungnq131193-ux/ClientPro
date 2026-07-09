
function updateDashboardDateTicker() {
  // Populate the light-theme hero date line (safe no-op if the element is absent).
  try {
    const el = document.getElementById("dash-hero-date");
    if (!el) return;
    const now = new Date();
    const weekdays = [
      "Chủ Nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7",
    ];
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    el.textContent = `Hôm nay là ${weekdays[now.getDay()]}, ${dd}/${mm}/${now.getFullYear()}`;
  } catch (e) { }
}

function parseMoneyToNumber(str) {
  if (!str) return 0;
  return parseInt(str.toString().replace(/\D/g, "")) || 0;
}

document.addEventListener("DOMContentLoaded", async () => {
  // Ensure modal partials are present before any UX/security flows attempt to open them.
  // (load_modals.js is async; this await keeps behavior consistent with the previous sync XHR.)
  try {
    if (window.__clientpro_modals_ready && typeof window.__clientpro_modals_ready.then === "function") {
      // Safety timeout: never block boot forever if a partial fails to load.
      await Promise.race([
        window.__clientpro_modals_ready,
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    }
  } catch (e) {
    console.warn("[ClientPro] Modals preload warning:", e);
  }
  // Khởi tạo tầng chuẩn hóa lỗi & loading (module 19). An toàn nếu thiếu file.
  try { if (window.LoadingManager && typeof window.LoadingManager.init === "function") window.LoadingManager.init(); } catch (e) { }
  // Global error handling: bắt window.onerror + unhandledrejection ngay từ đầu để
  // ghi log cục bộ và báo lỗi thân thiện cho user khi có sự cố ngoài dự kiến.
  try { if (window.ErrorHandler && typeof window.ErrorHandler.installGlobalHandlers === "function") window.ErrorHandler.installGlobalHandlers(); } catch (e) { }
  // Accessibility cho modal (focus trap + aria-modal + Esc). An toàn nếu thiếu.
  try { if (window.ModalA11y && typeof window.ModalA11y.init === "function") window.ModalA11y.init(); } catch (e) { }

  // BẢO MẬT: hiện cổng xác thực (PIN/kích hoạt) TRƯỚC khi ẩn loader để dashboard
  // không bao giờ lộ thoáng qua trên máy chậm. Phần hiển thị gate của checkSecurity()
  // chạy đồng bộ trước await đầu tiên và không cần db (chỉ đọc localStorage + DOM).
  let securityGateShown = false;
  try {
    checkSecurity();
  } catch (e) { }
  try {
    securityGateShown = ["screen-lock", "setup-lock-modal", "activation-modal"].some((id) => {
      const el = getEl(id);
      return el && !el.classList.contains("hidden");
    });
  } catch (e) { }

  // UX: ẩn loader sớm để tránh cảm giác "treo" khi thiết bị/network chậm.
  // Dữ liệu sẽ render dần khi IndexedDB trả về. CHỈ ẩn khi gate đã hiện —
  // nếu modal partials chưa nạp được thì giữ loader che dashboard, retry ở onsuccess.
  try {
    const ld = getEl && getEl("loader");
    if (ld && securityGateShown) ld.classList.add("hidden");
  } catch (e) { }

  // Không để lỗi CDN (lucide chưa tải được) chặn toàn bộ boot — nếu throw ở đây,
  // IndexedDB không bao giờ được mở và app đứng im.
  try { lucide.createIcons(); } catch (e) { }
  const setAppHeight = () =>
    document.documentElement.style.setProperty(
      "--app-height",
      `${window.innerHeight}px`
    );
  window.addEventListener("resize", setAppHeight);
  setAppHeight();
  let savedTheme = localStorage.getItem(THEME_KEY);
  // Danh sách 4 theme hợp lệ (1 sáng + 3 sắc xanh ngân hàng)
  const validThemes = [
    "theme-vietinbank",
    "theme-midnight",
    "theme-ocean",
    "theme-aurora",
  ];

  // Nếu theme trong bộ nhớ không nằm trong danh sách mới (do code cũ), ép về VietinBank Light
  if (!validThemes.includes(savedTheme)) {
    savedTheme = "theme-vietinbank";
  }

  setTheme(savedTheme);
  updateDashboardDateTicker();
  // 🌤 Khởi động thời tiết
  initWeather();

  // Vì gate hiện trước khi DB mở xong, luồng mở khóa (validatePin) await promise này
  // để migration/primeFieldCache/loadCustomers không chạy khi db còn undefined.
  let dbReadyResolve;
  window.__dbReady = new Promise((resolve) => { dbReadyResolve = resolve; });

  const req = indexedDB.open(DB_NAME, 5);
  req.onupgradeneeded = (e) => {
    db = e.target.result;

    // Customers
    if (!db.objectStoreNames.contains("customers")) {
      db.createObjectStore("customers", { keyPath: "id" });
    }

    // Images
    let imgStore;
    if (!db.objectStoreNames.contains("images")) {
      imgStore = db.createObjectStore("images", { keyPath: "id" });
    } else {
      imgStore = e.target.transaction.objectStore("images");
    }
    if (!imgStore.indexNames.contains("customerId")) {
      imgStore.createIndex("customerId", "customerId", { unique: false });
    }

    // In-app Backup Manager (encrypted backups stored in IndexedDB)
    let bkStore;
    if (!db.objectStoreNames.contains("backups")) {
      bkStore = db.createObjectStore("backups", { keyPath: "id" });
    } else {
      bkStore = e.target.transaction.objectStore("backups");
    }
    if (!bkStore.indexNames.contains("createdAt")) {
      bkStore.createIndex("createdAt", "createdAt", { unique: false });
    }
    if (!bkStore.indexNames.contains("hash")) {
      bkStore.createIndex("hash", "hash", { unique: false });
    }
    if (!bkStore.indexNames.contains("deviceId")) {
      bkStore.createIndex("deviceId", "deviceId", { unique: false });
    }
  };
  req.onsuccess = (e) => {
    db = e.target.result;
    // Update folder counts on home screen instead of loading customer list directly
    if (typeof updateFolderCounts === 'function') {
      updateFolderCounts();
    }
    // Fallback hiếm: nếu gate chưa hiện được lúc DOMContentLoaded (modal partials
    // nạp chậm/timeout) thì thử lại ở đây trước khi ẩn loader.
    if (!securityGateShown) {
      try { checkSecurity(); } catch (err) { }
    }
    getEl("loader").classList.add("hidden");
    if (dbReadyResolve) dbReadyResolve();

    // Auth gate: kiểm tra ngầm quyền + thiết bị với Admin GAS (issue_kdata, TTL 24h).
    // Fire-and-forget: offline/lỗi mạng không chặn UI, chỉ chặn khi server xác nhận
    // tài khoản bị khóa hoặc sai thiết bị (xem 15_auth_gate.js).
    try {
      if (window.AuthGate && typeof window.AuthGate.preflight === "function") {
        window.AuthGate.preflight();
      }
    } catch (err) { }

    // Cloud transfer inbox polling (notify when other users send backups)
    try {
      if (window.CloudTransferUI && typeof window.CloudTransferUI.startPolling === 'function') {
        window.CloudTransferUI.startPolling();
      }
    } catch (err) { }

    // Auto backup to Drive (daily check)
    try {
      if (window.DriveBackup && typeof window.DriveBackup.checkDaily === 'function') {
        // Delay to avoid blocking UI on startup
        setTimeout(() => { window.DriveBackup.checkDaily(); }, 15000);
      }
    } catch (err) { }
  };
  req.onerror = () => {
    // DB mở thất bại: vẫn resolve để luồng mở khóa không treo — các hàm sau unlock
    // đều có guard !db riêng.
    try { if (window.ErrorHandler) ErrorHandler.logError('indexedDB.open failed', req.error); } catch (e) { }
    if (dbReadyResolve) dbReadyResolve();
  };
  // Debounce search to avoid decrypt + render on every single keystroke (mượt hơn với danh sách lớn)
  const onSearchInput = (e) => loadCustomers(e.target.value);
  getEl("search-input").addEventListener("input", (typeof debounce === 'function') ? debounce(onSearchInput, 180) : onSearchInput);
  setupSwipe();
});

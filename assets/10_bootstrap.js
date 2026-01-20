function parseMoneyToNumber(str) {
  if (!str) return 0;
  return parseInt(str.toString().replace(/\D/g, "")) || 0;
}

// --- AI-LITE CHO ẢNH TÀI LIỆU (giảm noise, nền trắng, chữ nét) ---
// Removed enhanceDocumentWithAI as OCR is no longer used

document.addEventListener("DOMContentLoaded", () => {
  // UX: ẩn loader sớm để tránh cảm giác "treo" khi thiết bị/network chậm.
  // Dữ liệu sẽ render dần khi IndexedDB trả về.
  try {
    const ld = getEl && getEl("loader");
    if (ld) ld.classList.add("hidden");
  } catch (e) {}

  lucide.createIcons();
  const setAppHeight = () =>
    document.documentElement.style.setProperty(
      "--app-height",
      `${window.innerHeight}px`
    );
  window.addEventListener("resize", setAppHeight);
  setAppHeight();
  let savedTheme = localStorage.getItem(THEME_KEY);
  // Danh sách các theme hợp lệ hiện tại
  const validThemes = [
    "theme-midnight",
    "theme-sunset",
    "theme-ocean",
    "theme-mint",
    "theme-royal",
    // Expanded theme library (must match CSS + theme buttons)
    "theme-aurora",
    "theme-graphite",
    "theme-violet",
    "theme-emerald",
    "theme-sakura",
    "theme-solar",
    "theme-mono",
  ];

  // Nếu theme trong bộ nhớ không nằm trong danh sách mới (do code cũ), ép về Midnight
  if (!validThemes.includes(savedTheme)) {
    savedTheme = "theme-midnight";
  }

  setTheme(savedTheme);

  setTheme(savedTheme);
  // 🌤 Khởi động thời tiết
  initWeather();

  const req = indexedDB.open(DB_NAME, 4);
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
    loadCustomers();
    getEl("loader").classList.add("hidden");
    checkSecurity();

    // Cloud transfer inbox polling (notify when other users send backups)
    try {
      if (window.CloudTransferUI && typeof window.CloudTransferUI.startPolling === 'function') {
        window.CloudTransferUI.startPolling();
      }
    } catch (err) {}
  };
  // Debounce search to avoid decrypt + render on every single keystroke (mượt hơn với danh sách lớn)
  const onSearchInput = (e) => loadCustomers(e.target.value);
  getEl("search-input").addEventListener("input", (typeof debounce === 'function') ? debounce(onSearchInput, 180) : onSearchInput);
  setupSwipe();
});

function parseMoneyToNumber(str) {
  if (!str) return 0;
  return parseInt(str.toString().replace(/\D/g, "")) || 0;
}

// --- AI-LITE CHO ẢNH TÀI LIỆU (giảm noise, nền trắng, chữ nét) ---
// Removed enhanceDocumentWithAI as OCR is no longer used

document.addEventListener("DOMContentLoaded", () => {
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

  const req = indexedDB.open(DB_NAME, 3);
  req.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("customers"))
      db.createObjectStore("customers", { keyPath: "id" });
    let imgStore;
    if (!db.objectStoreNames.contains("images"))
      imgStore = db.createObjectStore("images", { keyPath: "id" });
    else imgStore = e.target.transaction.objectStore("images");
    if (!imgStore.indexNames.contains("customerId"))
      imgStore.createIndex("customerId", "customerId", { unique: false });
  };
  req.onsuccess = (e) => {
    db = e.target.result;
    loadCustomers();
    getEl("loader").classList.add("hidden");
    checkSecurity();
  };
  getEl("search-input").addEventListener("input", (e) =>
    loadCustomers(e.target.value)
  );
  setupSwipe();
});

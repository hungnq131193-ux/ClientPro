function toggleMenu() {
  const m = getEl("settings-menu");
  const o = getEl("menu-overlay");
  if (m.classList.contains("hidden")) {
    m.classList.remove("hidden");
    o.classList.remove("hidden");
    setTimeout(() => {
      m.classList.remove("scale-95", "opacity-0");
    }, 10);
  } else {
    m.classList.add("scale-95", "opacity-0");
    setTimeout(() => {
      m.classList.add("hidden");
      o.classList.add("hidden");
    }, 200);
  }
}

function _closeMenuIfOpen() {
  try {
    const m = getEl("settings-menu");
    if (m && !m.classList.contains("hidden")) toggleMenu();
  } catch (e) { }
}

// ============================================================
// BACKUP MANAGER (Lưu backup ngay trong app)
// ============================================================
const BACKUP_STORE = "backups";
const LAST_BACKUP_HASH_KEY = "clientpro_last_backup_hash";

function _formatYYYYMMDD(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function _formatDateTime(ts) {
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${mi}`;
}

function _formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

async function _idbGetAllBackups() {
  return await new Promise((resolve) => {
    try {
      const tx = db.transaction([BACKUP_STORE], "readonly");
      const store = tx.objectStore(BACKUP_STORE);
      const req = store.getAll();
      req.onsuccess = (e) => resolve(e.target.result || []);
      req.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
}

async function _idbPutBackup(rec) {
  return await new Promise((resolve, reject) => {
    const tx = db.transaction([BACKUP_STORE], "readwrite");
    tx.objectStore(BACKUP_STORE).put(rec);
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e);
  });
}

async function _idbDeleteBackup(id) {
  return await new Promise((resolve, reject) => {
    const tx = db.transaction([BACKUP_STORE], "readwrite");
    tx.objectStore(BACKUP_STORE).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e);
  });
}

async function openBackupManager() {
  _closeMenuIfOpen();
  const modal = getEl("backup-manager-modal");
  if (modal) modal.classList.remove("hidden");

  // Prefetch cloud-transfer user list for faster "Gửi" flow (non-blocking)
  try {
    if (window.CloudTransferUI && typeof window.CloudTransferUI.prefetchUsers === 'function') {
      window.CloudTransferUI.prefetchUsers();
    }
  } catch (e) { }

  await renderBackupList();
  if (window.lucide) lucide.createIcons();
}

function closeBackupManager() {
  const modal = getEl("backup-manager-modal");
  if (modal) modal.classList.add("hidden");
}

async function renderBackupList() {
  const listEl = getEl("backup-list");
  const emptyEl = getEl("backup-empty");
  if (!listEl || !emptyEl) return;

  const all = await _idbGetAllBackups();
  all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (!all.length) {
    listEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  listEl.innerHTML = all
    .map((b) => {
      const fname = escapeHTML(b.filename || "");
      const created = _formatDateTime(b.createdAt || Date.now());
      const size = _formatBytes(b.size || 0);
      return `
      <div class="p-4 rounded-2xl border" style="border-color: var(--border-panel); background: rgba(255,255,255,0.03);">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-sm font-bold truncate" style="color: var(--text-main)">${fname}</div>
            <div class="text-[11px] mt-1 opacity-70" style="color: var(--text-sub)">Ngày tạo: ${created} • Dung lượng: ${size}</div>
          </div>
          <div class="flex gap-2 flex-shrink-0 flex-wrap justify-end">
            <button class="px-3 py-2 rounded-xl text-xs font-bold" style="background: rgba(16,185,129,0.15); color: #34d399;" onclick="restoreBackupFromApp('${b.id}')">Restore</button>
            <button class="px-3 py-2 rounded-xl text-xs font-bold" style="background: rgba(59,130,246,0.15); color: #60a5fa;" onclick="exportBackupFromApp('${b.id}')">Xuất file</button>
            <button class="px-3 py-2 rounded-xl text-xs font-bold" style="background: rgba(99,102,241,0.16); color: #a5b4fc; border: 1px solid rgba(99,102,241,0.25);" onclick="CloudTransferUI.sendBackupFromApp('${b.id}')">Gửi</button>
            <button class="px-3 py-2 rounded-xl text-xs font-bold" style="background: rgba(239,68,68,0.15); color: #f87171;" onclick="deleteBackupFromApp('${b.id}')">Xóa</button>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

async function deleteBackupFromApp(id) {
  if (!confirm("Xóa bản backup này?")) return;
  try {
    await _idbDeleteBackup(id);
    showToast("Đã xóa backup");
    await renderBackupList();
  } catch (e) {
    alert("Không thể xóa backup");
  }
}

async function exportBackupFromApp(id) {
  const all = await _idbGetAllBackups();
  const rec = all.find((x) => x.id === id);
  if (!rec) return;
  const blob = new Blob([rec.encrypted || ""], { type: "application/octet-stream" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = rec.filename || `CLIENTPRO_BK_${Date.now()}.cpb`;
  a.click();
  showToast("Đã xuất file .cpb");
}

async function restoreBackupFromApp(id) {
  // Phương án 1: mỗi lần Restore sẽ verify lại và xin secret từ server
  if (typeof ensureBackupSecret === "function") {
    const sec = await ensureBackupSecret();
    if (!sec || !sec.ok || !APP_BACKUP_KDATA_B64U) {
      alert(
        `BẢO MẬT: ${sec && sec.message ? sec.message : "Không thể lấy khóa bảo mật."}\n\nVui lòng kết nối mạng và thử lại.`
      );
      return;
    }
  }

  const all = await _idbGetAllBackups();
  const rec = all.find((x) => x.id === id);
  if (!rec || !rec.encrypted) return;

  if (!confirm(`Khôi phục dữ liệu từ backup:\n\n${rec.filename}\n\nTiếp tục?`)) return;

  getEl("loader").classList.remove("hidden");
  getEl("loader-text").textContent = "Đồng bộ...";

  try {
    await _restoreFromEncryptedContent(rec.encrypted);
    showToast("Đã khôi phục");
    closeBackupManager();
    loadCustomers();
  } catch (e) {
    console.error(e);
    alert("Không thể khôi phục backup");
  } finally {
    getEl("loader").classList.add("hidden");
  }
}

async function _restoreFromEncryptedContent(encryptedContent) {
  // Giải mã (AES-GCM envelope v2 + tương thích legacy CryptoJS v1)
  let decryptedStr = "";
  try {
    if (typeof decryptBackupPayload === 'function') {
      const out = await decryptBackupPayload(String(encryptedContent || ''), APP_BACKUP_KDATA_B64U);
      decryptedStr = out && out.plaintext ? out.plaintext : '';
    }
  } catch (e) {
    decryptedStr = '';
  }

  if (!decryptedStr) throw new Error('Decryption failed');

  const data = JSON.parse(decryptedStr);

  // Ghi vào DB
  const tx = db.transaction(["customers", "images"], "readwrite");
  const customerStore = tx.objectStore("customers");
  const imageStore = tx.objectStore("images");

  const enc = (txt) => (txt && String(txt).trim().length > 0 ? encryptText(txt) : "");

  (data.customers || []).forEach((c) => {
    const cust = JSON.parse(JSON.stringify(c));
    cust.name = enc(cust.name);
    cust.phone = enc(cust.phone);
    cust.cccd = enc(cust.cccd);
    cust.notes = enc(cust.notes);

    if (cust.assets && Array.isArray(cust.assets)) {
      cust.assets = cust.assets.map((a) => {
        const asset = JSON.parse(JSON.stringify(a));
        asset.name = enc(asset.name);
        asset.link = enc(asset.link);
        asset.valuation = enc(asset.valuation);
        asset.loanValue = enc(asset.loanValue);
        asset.area = enc(asset.area);
        asset.width = enc(asset.width);
        asset.onland = enc(asset.onland);
        asset.year = enc(asset.year);
        asset.ocrData = enc(asset.ocrData);
        return asset;
      });
    }
    customerStore.put(cust);
  });

  (data.images || []).forEach((i) => imageStore.put(i));

  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(new Error("DB_WRITE_FAILED"));
  });
}


// ============================================================
// HÀM BACKUP MỚI (CHỈ LƯU THÔNG TIN - LOẠI BỎ ẢNH & LINK)
// ============================================================
async function backupData() {
  // Phương án 1: mỗi lần bấm Backup sẽ verify lại và xin secret từ server
  if (typeof ensureBackupSecret === "function") {
    const sec = await ensureBackupSecret();
    if (!sec || !sec.ok || !APP_BACKUP_KDATA_B64U) {
      alert(
        `BẢO MẬT: ${sec && sec.message ? sec.message : "Không thể lấy khóa bảo mật."}\n\nVui lòng kết nối mạng và thử lại.`
      );
      return;
    }
  } else if (!APP_BACKUP_KDATA_B64U) {
    alert(
      "BẢO MẬT: Không thể backup khi đang Offline hoặc chưa xác thực với Server.\n\nVui lòng kết nối mạng và mở lại App để hệ thống tải khóa bảo mật."
    );
    return;
  }

  // Đóng menu nếu đang mở
  _closeMenuIfOpen();

  getEl("loader").classList.remove("hidden");
  getEl("loader-text").textContent = "Đóng gói (Bảo mật)...";

  try {
    // Đọc toàn bộ khách hàng từ IndexedDB
    const customers = await new Promise((resolve, reject) => {
      const tx = db.transaction(["customers"], "readonly");
      const store = tx.objectStore("customers");
      const req = store.getAll();
      req.onsuccess = (e) => resolve(e.target.result || []);
      req.onerror = (e) => reject(e);
    });

    // Chuẩn hoá dữ liệu: giải mã các trường cần thiết và loại bỏ driveLink
    const cleanCustomers = customers.map((c) => {
      const cust = JSON.parse(JSON.stringify(c));
      cust.name = decryptText(cust.name);
      cust.phone = decryptText(cust.phone);
      cust.cccd = decryptText(cust.cccd);
      cust.notes = decryptText(cust.notes);
      cust.driveLink = null;

      if (cust.assets && Array.isArray(cust.assets)) {
        cust.assets = cust.assets.map((a) => {
          const asset = JSON.parse(JSON.stringify(a));
          asset.name = decryptText(asset.name);
          asset.link = decryptText(asset.link);
          asset.valuation = decryptText(asset.valuation);
          asset.loanValue = decryptText(asset.loanValue);
          asset.area = decryptText(asset.area);
          asset.width = decryptText(asset.width);
          asset.onland = decryptText(asset.onland);
          asset.year = decryptText(asset.year);
          asset.ocrData = decryptText(asset.ocrData);
          asset.driveLink = null;
          return asset;
        });
      }
      return cust;
    });

    const dataToExport = {
      v: 1.1,
      customers: cleanCustomers,
      images: [],
    };

    // Anti-spam backup: hash dữ liệu, nếu không đổi thì bỏ qua
    const rawStr = JSON.stringify(dataToExport);
    const hashNew = typeof hashString === "function" ? await hashString(rawStr) : "";
    const hashOld = localStorage.getItem(LAST_BACKUP_HASH_KEY) || "";
    if (hashNew && hashOld && hashNew === hashOld) {
      showToast("Dữ liệu chưa thay đổi. Bỏ qua backup.");
      return;
    }

    // Mã hóa toàn bộ dữ liệu bằng AES-256-GCM (có xác thực anti-tamper)
    if (typeof encryptBackupPayload !== 'function') {
      throw new Error('Thiếu cơ chế mã hóa WebCrypto');
    }
    const encrypted = await encryptBackupPayload(rawStr, APP_BACKUP_KDATA_B64U, { type: 'full_backup' });

    // Chuẩn hóa tên file
    const deviceId = typeof getDeviceId === "function" ? getDeviceId() : "device";
    const dateStr = _formatYYYYMMDD(Date.now());
    const hashShort = (hashNew || "").slice(0, 12) || String(Date.now());
    const filename = `CLIENTPRO_BK_${deviceId}_${dateStr}_${hashShort}.cpb`;

    const sizeBytes = new Blob([encrypted]).size;
    const rec = {
      id: String(Date.now()) + "_" + Math.random().toString(36).slice(2, 8),
      filename,
      createdAt: Date.now(),
      size: sizeBytes,
      deviceId,
      hash: hashNew || "",
      encrypted,
    };

    // Lưu backup vào IndexedDB
    await _idbPutBackup(rec);

    // Lưu hash để so sánh lần sau
    if (hashNew) localStorage.setItem(LAST_BACKUP_HASH_KEY, hashNew);

    showToast("Đã tạo backup trong app");

    // Nếu đang mở màn quản lý backup -> refresh list
    try {
      const modal = getEl("backup-manager-modal");
      if (modal && !modal.classList.contains("hidden")) {
        await renderBackupList();
      }
    } catch (e) { }
  } catch (err) {
    console.error(err);
    alert("Lỗi tạo backup");
  } finally {
    getEl("loader").classList.add("hidden");
  }
}

async function restoreData(input) {
  // Đóng menu nếu đang mở (tránh lỗi khi gọi từ Backup Manager Modal)
  _closeMenuIfOpen();
  const f = input.files && input.files[0];
  if (!f) return;
  getEl("loader").classList.remove("hidden");
  getEl("loader-text").textContent = "Xác thực bảo mật...";

  // Phương án 1: mỗi lần bấm Restore sẽ verify lại và xin secret từ server
  if (typeof ensureBackupSecret === "function") {
    const sec = await ensureBackupSecret();
    if (!sec || !sec.ok || !APP_BACKUP_KDATA_B64U) {
      getEl("loader").classList.add("hidden");
      alert(
        `BẢO MẬT: ${sec && sec.message ? sec.message : "Không thể lấy khóa bảo mật."}\n\nVui lòng kết nối mạng và thử lại.`
      );
      return;
    }
  }

  getEl("loader-text").textContent = "Đồng bộ...";
  const r = new FileReader();
  r.onload = async (e) => {
    try {
      const encryptedContent = e.target.result;
      await _restoreFromEncryptedContent(encryptedContent);
      getEl("loader").classList.add("hidden");
      alert("Đã khôi phục");
      loadCustomers();
    } catch (err) {
      getEl("loader").classList.add("hidden");
      alert("File backup không hợp lệ hoặc sai định dạng bảo mật");
    }
  };
  r.readAsText(f);
}
function resetAppData() {
  if (confirm("XÓA SẠCH dữ liệu?")) {
    localStorage.clear();
    indexedDB.deleteDatabase(DB_NAME).onsuccess = () => {
      alert("Đã reset.");
      window.location.reload();
    };
  }
}
// =============== DONATE FEATURE ===============

function buildDonateQRUrl() {
  // Theo Quick Link VietQR: https://img.vietqr.io/image/<BANK_ID>-<ACCOUNT_NO>-<TEMPLATE>.jpg?accountName=...&addInfo=... 1
  const base = `https://img.vietqr.io/image/${DONATE_BANK_ID}-${DONATE_ACCOUNT_NO}-compact2.jpg`;
  const params = new URLSearchParams({
    accountName: DONATE_ACCOUNT_NAME,
    addInfo: DONATE_DEFAULT_DESC,
  });
  return `${base}?${params.toString()}`;
}

function openDonateModal() {
  const modal = getEl("donate-modal");
  const img = getEl("donate-qr-img");
  if (img && !img.src) {
    img.src = buildDonateQRUrl(); // tạo QR VietQR “xịn” đúng STK + tên
  }
  modal.classList.remove("hidden");
}

function closeDonateModal() {
  const modal = getEl("donate-modal");
  if (modal) modal.classList.add("hidden");
}

function copyDonateAccount() {
  const acc = DONATE_ACCOUNT_NO;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(acc)
      .then(() => {
        showToast("Đã copy số tài khoản VietinBank");
      })
      .catch(() => {
        fallbackCopyDonate(acc);
      });
  } else {
    fallbackCopyDonate(acc);
  }
}

function fallbackCopyDonate(text) {
  const input = document.createElement("input");
  input.value = text;
  document.body.appendChild(input);
  input.select();
  try {
    document.execCommand("copy");
    showToast("Đã copy số tài khoản");
  } catch (e) {
    alert("Không copy được, vui lòng nhập tay STK: " + text);
  }
  document.body.removeChild(input);
}

// =========== END DONATE FEATURE ===========
// ================== WEATHER (OPEN-METEO, NO KEY) ==================

function initWeather() {
  // hiển thị nhanh từ cache nếu có
  const cacheRaw = localStorage.getItem(WEATHER_STORAGE_KEY);
  if (cacheRaw) {
    try {
      const cache = JSON.parse(cacheRaw);
      if (Date.now() - cache.time < WEATHER_CACHE_TTL) {
        renderWeather(cache.data);
      }
    } catch (e) {
      console.warn("Weather cache error", e);
    }
  }
  // sau đó gọi GPS để cập nhật mới
  refreshWeather();
}

function refreshWeather() {
  if (!navigator.geolocation) {
    setWeatherText("Thiết bị không hỗ trợ GPS");
    return;
  }

  setWeatherText("Đang lấy vị trí...");

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      fetchWeather(lat, lon);
    },
    (err) => {
      console.warn("GPS weather error", err);
      setWeatherText("Không lấy được GPS");
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 5 * 60 * 1000 }
  );
}

function setWeatherText(text) {
  const el = getEl("current-weather");
  if (el) el.textContent = text;
}

function fetchWeather(lat, lon) {
  setWeatherText("Đang tải thời tiết...");

  // Open-Meteo API: không cần API key
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lat}` +
    `&longitude=${lon}` +
    "&current_weather=true" +
    "&timezone=auto";

  fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then((data) => {
      try {
        localStorage.setItem(
          WEATHER_STORAGE_KEY,
          JSON.stringify({ time: Date.now(), data })
        );
      } catch (e) {
        console.warn("Weather cache save error", e);
      }
      renderWeather(data);
    })
    .catch((err) => {
      console.error("Weather fetch error", err);
      setWeatherText("Lỗi tải thời tiết");
    });
}

function renderWeather(apiData) {
  if (!apiData || !apiData.current_weather) {
    setWeatherText("Không có dữ liệu");
    return;
  }

  const cw = apiData.current_weather;
  const temp = Math.round(cw.temperature); // °C
  const code = cw.weathercode;
  const desc = WEATHER_CODE_TEXT[code] || "Thời tiết hiện tại";

  setWeatherText(`${temp}°C • ${desc}`);
}

// ================== END WEATHER ==================

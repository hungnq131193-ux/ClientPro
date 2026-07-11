// ============================================================
// BACKUP MANAGER (Lưu backup ngay trong app)
// ============================================================
const BACKUP_STORE = "backups";
const LAST_BACKUP_HASH_KEY = "clientpro_last_backup_hash";

// Chống double-submit (mirror pattern manualBackupInProgress ở 16_auto_backup_drive.js):
// requireBackupSecretOrAlert() gọi mạng trước khi có loading overlay che nút,
// double-tap trong khoảng đó tạo 2 backup trùng / 2 restore chạy song song.
let __backupInFlight = false;
let __restoreInFlight = false;

function _formatYYYYMMDD(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
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

  if (window.CloudTransferUI && typeof window.CloudTransferUI.showTab === 'function') {
    window.CloudTransferUI.showTab('local');
  } else {
    await renderBackupList();
  }

  // Drive backups are now displayed inside the Google Drive section, so load
  // them immediately without switching away from the local/inbox pane.
  try {
    if (window.DriveBackup && typeof window.DriveBackup.renderList === 'function') {
      window.DriveBackup.renderList('drive-backup-list');
    }
  } catch (e) { }

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

  listEl.textContent = "";
  all.forEach((b) => {
    const card = document.createElement("div");
    card.className = "backup-list-card";

    const row = document.createElement("div");
    row.className = "backup-list-row";

    const info = document.createElement("div");
    info.className = "backup-list-info";
    const title = document.createElement("div");
    title.className = "text-sm font-bold truncate";
    title.style.color = "var(--text-main)";
    title.textContent = b.filename || "";
    const meta = document.createElement("div");
    meta.className = "text-[11px] mt-1 opacity-70";
    meta.style.color = "var(--text-sub)";
    meta.textContent = `Ngày tạo: ${formatDateTime(b.createdAt || Date.now())} • Dung lượng: ${formatBytes(b.size || 0)}`;
    info.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "backup-list-actions";
    const addButton = (label, style, handler) => {
      const btn = document.createElement("button");
      btn.className = "backup-list-action";
      btn.setAttribute("style", style);
      btn.textContent = label;
      btn.addEventListener("click", handler);
      actions.appendChild(btn);
    };
    addButton("Khôi phục", "background: rgba(16,185,129,0.15); color: #34d399;", () => restoreBackupFromApp(b.id));
    addButton("Xuất file", "background: rgba(59,130,246,0.15); color: #60a5fa;", () => exportBackupFromApp(b.id));
    addButton("Gửi", "background: rgba(99,102,241,0.16); color: #a5b4fc; border: 1px solid rgba(99,102,241,0.25);", () => CloudTransferUI.sendBackupFromApp(b.id));
    addButton("Xóa", "background: rgba(239,68,68,0.15); color: #f87171;", () => deleteBackupFromApp(b.id));

    row.append(info, actions);
    card.appendChild(row);
    listEl.appendChild(card);
  });
}

async function deleteBackupFromApp(id) {
  if (!(await ErrorHandler.confirm("Xóa bản backup này?", { title: "Xóa backup", danger: true, confirmText: "Xóa" }))) return;
  try {
    await _idbDeleteBackup(id);
    ErrorHandler.showSuccess("Đã xóa backup");
    await renderBackupList();
  } catch (e) {
    ErrorHandler.showError('STORAGE', "Không thể xóa backup này.", e);
  }
}

async function exportBackupFromApp(id) {
  if (typeof requireUnlockedForBackup === "function" && !requireUnlockedForBackup()) return;
  const all = await _idbGetAllBackups();
  const rec = all.find((x) => x.id === id);
  if (!rec) return;
  const blob = new Blob([rec.encrypted || ""], { type: "application/octet-stream" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = rec.filename || `CLIENTPRO_BK_${Date.now()}.cpb`;
  a.click();
  ErrorHandler.showSuccess("Đã xuất file .cpb");
}

async function createBackupFileNow() {
  try {
    if (typeof requireUnlockedForBackup === "function" && !requireUnlockedForBackup()) return;
    await backupData();
    const all = await _idbGetAllBackups();
    all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const latest = all[0];
    if (!latest) {
      ErrorHandler.showWarning("Chưa có dữ liệu backup để xuất file.");
      return;
    }
    await exportBackupFromApp(latest.id);
    await renderBackupList();
  } catch (e) {
    ErrorHandler.showError('BACKUP', "Không thể tạo file backup lúc này.", e);
  }
}

async function restoreBackupFromApp(id) {
  if (__restoreInFlight) return;
  __restoreInFlight = true;
  try {
    await _doRestoreBackupFromApp(id);
  } finally {
    __restoreInFlight = false;
  }
}

async function _doRestoreBackupFromApp(id) {
  if (typeof requireUnlockedForRestore === "function" && !requireUnlockedForRestore()) return;
  if ((typeof isAppUnlocked === "function" && !isAppUnlocked()) || typeof masterKey === "undefined" || !masterKey) {
    ErrorHandler.showWarning("Vui lòng mở khóa dữ liệu trước khi khôi phục.");
    return;
  }

  // Phương án 1: mỗi lần Restore sẽ verify lại và xin secret từ server
  if (!(await requireBackupSecretOrAlert())) return;

  const all = await _idbGetAllBackups();
  const rec = all.find((x) => x.id === id);
  if (!rec || !rec.encrypted) return;

  if (!(await ErrorHandler.confirm(`Khôi phục dữ liệu từ backup:\n\n${rec.filename}\n\nTiếp tục?`, { title: "Khôi phục dữ liệu", confirmText: "Khôi phục" }))) return;

  closeBackupManager();
  LoadingManager.showGlobal("Đồng bộ...");

  try {
    await _restoreFromEncryptedContent(rec.encrypted);
    ErrorHandler.showSuccess("Đã khôi phục dữ liệu");
    closeBackupManager();
    loadCustomers();
  } catch (e) {
    ErrorHandler.showError('BACKUP', "Không thể khôi phục backup này.", e);
  } finally {
    LoadingManager.hideGlobal(true);
  }
}

async function _restoreFromEncryptedContent(encryptedContent, keyOverrideB64u) {
  if (typeof requireUnlockedForRestore === "function" && !requireUnlockedForRestore()) throw new Error("App locked");
  if ((typeof isAppUnlocked === "function" && !isAppUnlocked()) || typeof masterKey === "undefined" || !masterKey) {
    ErrorHandler.showWarning("Vui lòng mở khóa dữ liệu trước khi khôi phục.");
    throw new Error("App locked");
  }

  // Khóa giải mã: mặc định khóa cá nhân; cho phép override (vd transfer key khi nhận
  // backup từ user khác — bản mã được mã hóa bằng khóa hộp thư của người nhận).
  const decKey = keyOverrideB64u || APP_BACKUP_KDATA_B64U;

  // Giải mã (AES-GCM envelope v2 + tương thích legacy CryptoJS v1)
  let decryptedStr = "";
  try {
    if (typeof decryptBackupPayload === 'function') {
      const out = await decryptBackupPayload(String(encryptedContent || ''), decKey);
      decryptedStr = out && out.plaintext ? out.plaintext : '';
    }
  } catch (e) {
    decryptedStr = '';
  }

  if (!decryptedStr) throw new Error('Decryption failed');

  const data = JSON.parse(decryptedStr);

  // Ghi vào DB qua BackupCore: mã hóa lại các trường (name/phone/cccd/notes + tài sản)
  // và upsert customers/images trong 1 transaction. Nguồn logic duy nhất ở 12_backup_core.js.
  await BackupCore.restoreAllTransactional(data);
}


// ============================================================
// HÀM BACKUP MỚI (CHỈ LƯU THÔNG TIN - LOẠI BỎ ẢNH & LINK)
// ============================================================
async function backupData() {
  if (__backupInFlight) return;
  __backupInFlight = true;
  try {
    await _doBackupData();
  } finally {
    __backupInFlight = false;
  }
}

async function _doBackupData() {
  if (typeof requireUnlockedForBackup === "function" && !requireUnlockedForBackup()) return;
  if (typeof decryptText !== "function" || typeof masterKey === "undefined" || !masterKey) {
    ErrorHandler.showWarning("Vui lòng mở khóa dữ liệu trước khi sao lưu.");
    return;
  }
  // Phương án 1: mỗi lần bấm Backup sẽ verify lại và xin secret từ server
  if (!(await requireBackupSecretOrAlert())) return;

  // Đóng menu nếu đang mở
  _closeMenuIfOpen();

  // Khi Backup Manager đang mở (vd bấm "Tạo & xuất file"), KHÔNG dùng global
  // loader: #loader cùng z-index với modal nên bị che → app trông như treo.
  // Giữ modal mở để danh sách backup được refresh ngay khi xong.
  const bmModal = getEl("backup-manager-modal");
  const useGlobalLoader = !bmModal || bmModal.classList.contains("hidden");
  if (useGlobalLoader) LoadingManager.showGlobal("Đóng gói (Bảo mật)...");

  try {
    // Đọc + chuẩn hoá qua BackupCore: giải mã name/phone/cccd/notes + tài sản, bỏ driveLink,
    // loại ảnh. Trả về shape { v:1.1, customers:[...], images:[] } — nguồn logic duy nhất ở 12.
    const dataToExport = await BackupCore.exportAll();

    // Anti-spam backup: hash dữ liệu, nếu không đổi thì bỏ qua
    const rawStr = JSON.stringify(dataToExport);
    const hashNew = typeof hashString === "function" ? await hashString(rawStr) : "";
    const hashOld = localStorage.getItem(LAST_BACKUP_HASH_KEY) || "";
    if (hashNew && hashOld && hashNew === hashOld) {
      ErrorHandler.showInfo("Dữ liệu chưa thay đổi. Bỏ qua backup.");
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

    ErrorHandler.showSuccess("Đã tạo backup trong app");

    // Nếu đang mở màn quản lý backup -> refresh list
    try {
      const modal = getEl("backup-manager-modal");
      if (modal && !modal.classList.contains("hidden")) {
        await renderBackupList();
      }
    } catch (e) { }
  } catch (err) {
    ErrorHandler.showError('BACKUP', "Không tạo được bản sao lưu. Vui lòng thử lại.", err);
  } finally {
    if (useGlobalLoader) LoadingManager.hideGlobal(true);
  }
}

async function restoreData(input) {
  // Lấy File hiện tại rồi reset input NGAY, vô điều kiện — phủ mọi nhánh
  // (đang bận, app khóa, file lỗi, restore thất bại, exception, thành công).
  // Không reset thì chọn lại đúng file cũ sẽ không bắn change event → nút chết.
  const f = input && input.files && input.files[0];
  try { if (input) input.value = ""; } catch (e) { }
  if (__restoreInFlight) return;
  __restoreInFlight = true;
  // FileReader hoàn tất trong callback async — cờ chỉ được giữ qua khỏi hàm này
  // khi reader đã thực sự khởi động (callback của reader sẽ tự nhả);
  // mọi đường thoát sớm / exception trước đó → finally nhả ngay.
  let readerStarted = false;
  try {
    if (typeof requireUnlockedForRestore === "function" && !requireUnlockedForRestore()) return;
    if ((typeof isAppUnlocked === "function" && !isAppUnlocked()) || typeof masterKey === "undefined" || !masterKey) {
      ErrorHandler.showWarning("Vui lòng mở khóa dữ liệu trước khi khôi phục.");
      return;
    }

    // Đóng menu nếu đang mở (tránh lỗi khi gọi từ Backup Manager Modal)
    _closeMenuIfOpen();
    if (!f) return;
    // Đóng Backup Manager TRƯỚC global loader — cùng lớp lỗi đã vá ở
    // _doRestoreBackupFromApp (v1.6.1) và restoreFromDriveBackup (v1.6.2):
    // #loader cùng z-index với modal nên bị che, app trông như treo.
    closeBackupManager();
    LoadingManager.showGlobal("Xác thực bảo mật...");

    // Phương án 1: mỗi lần bấm Restore sẽ verify lại và xin secret từ server
    if (!(await requireBackupSecretOrAlert())) { LoadingManager.hideGlobal(true); return; }

    LoadingManager.showGlobal("Đồng bộ...");
    const r = new FileReader();
    r.onload = async (e) => {
      try {
        const encryptedContent = e.target.result;
        await _restoreFromEncryptedContent(encryptedContent);
        LoadingManager.hideGlobal(true);
        ErrorHandler.showSuccess("Đã khôi phục dữ liệu");
        loadCustomers();
      } catch (err) {
        LoadingManager.hideGlobal(true);
        ErrorHandler.showError('BACKUP', "File backup không hợp lệ hoặc sai định dạng bảo mật.", err);
      } finally {
        __restoreInFlight = false;
      }
    };
    r.onerror = (e) => {
      LoadingManager.hideGlobal(true);
      ErrorHandler.showError('STORAGE', "Không đọc được file backup.", e);
      __restoreInFlight = false;
    };
    r.readAsText(f);
    readerStarted = true;
  } finally {
    if (!readerStarted) __restoreInFlight = false;
  }
}

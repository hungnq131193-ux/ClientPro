// ============================================================
// 07_drive.js
// Google Drive integration via USER-provided Google Apps Script URL
//
// Goals
// - Folder name must be PLAINTEXT (human-readable) to allow reliable search/reconnect.
// - driveLink is stored as PLAINTEXT going forward.
// - Backward compatible rendering: if old records stored driveLink encrypted,
//   the UI will still render correctly when masterKey is available.
// ============================================================

// ------------------------------
// Small helpers (no external deps)
// ------------------------------

function _driveTrim(s) {
  return String(s === undefined || s === null ? "" : s).trim();
}

function _driveLooksLikeUrl(s) {
  const v = _driveTrim(s);
  return /^https?:\/\//i.test(v);
}

function _driveLooksLikeCryptoJSCipher(s) {
  // CryptoJS AES ciphertext usually starts with "U2FsdGVkX1" (Salted__ in base64)
  const v = _driveTrim(s);
  return v.startsWith("U2FsdGVkX1");
}

function _driveNormalizeUrl(maybeUrlOrCipher) {
  // 1) If already URL => use
  if (_driveLooksLikeUrl(maybeUrlOrCipher)) return _driveTrim(maybeUrlOrCipher);

  // 2) Try decryptText if available (backward compatibility)
  let dec = maybeUrlOrCipher;
  try {
    if (typeof decryptText === "function") dec = decryptText(maybeUrlOrCipher);
  } catch (e) {
    dec = maybeUrlOrCipher;
  }
  if (_driveLooksLikeUrl(dec)) return _driveTrim(dec);

  // 3) If it's ciphertext or not a URL => treat as missing
  if (_driveLooksLikeCryptoJSCipher(dec)) return null;
  return null;
}

function _driveSafeDecrypt(val) {
  // decryptText is designed to return original input on failure
  try {
    return typeof decryptText === "function" ? decryptText(val) : val;
  } catch (e) {
    return val;
  }
}

function _driveCustomerDisplayName(cust) {
  if (!cust) return "";
  return _driveTrim(_driveSafeDecrypt(cust.name));
}

function _driveCustomerIdTail(cust) {
  // Prefer CCCD, fallback phone
  if (!cust) return "";
  const cccd = _driveTrim(_driveSafeDecrypt(cust.cccd));
  if (cccd) return cccd;
  const phone = _driveTrim(_driveSafeDecrypt(cust.phone));
  return phone;
}

function _driveBuildProfileFolderName(cust) {
  const name = _driveCustomerDisplayName(cust);
  const tail = _driveCustomerIdTail(cust);
  // If tail missing, keep folder still readable
  return tail ? `${name} - ${tail}` : `${name}`;
}

function _driveBuildAssetFolderName(cust, asset) {
  const custName = _driveCustomerDisplayName(cust);
  const assetName = _driveTrim(_driveSafeDecrypt(asset && asset.name));
  // Standardize prefix to be stable
  return `${custName} - TSBD: ${assetName}`;
}

async function _drivePost(scriptUrl, payload) {
  const resp = await fetch(scriptUrl, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  // GAS scripts should respond JSON
  return await resp.json();
}

// ------------------------------
// Settings: store user Apps Script URL
// ------------------------------

function saveScriptUrl() {
  const url = _driveTrim(getEl("user-script-url").value);
  if (!url.startsWith("https://script.google.com/")) {
    alert("Link không đúng định dạng!");
    return;
  }
  localStorage.setItem(USER_SCRIPT_KEY, url);
  showToast("Đã lưu kết nối Drive cá nhân");
}

document.addEventListener("DOMContentLoaded", () => {
  const savedUrl = localStorage.getItem(USER_SCRIPT_KEY);
  if (savedUrl) {
    const el = getEl("user-script-url");
    if (el) el.value = savedUrl;
  }
});

function _requireUserScriptUrlOrOpenSettings() {
  const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
  if (!userUrl || userUrl.length < 10) {
    if (
      confirm(
        "Bạn chưa cấu hình nơi lưu ảnh cá nhân! Bấm OK để vào Cài đặt nhập Link Script của bạn."
      )
    ) {
      toggleMenu();
    }
    return null;
  }
  return userUrl;
}

// ------------------------------
// Profile photos: Upload
// ------------------------------

async function uploadToGoogleDrive() {
  const scriptUrl = _requireUserScriptUrlOrOpenSettings();
  if (!scriptUrl) return;
  if (!currentCustomerData) return;

  getEl("loader").classList.remove("hidden");
  getEl("loader-text").textContent = "Đang kiểm tra ảnh...";

  const tx = db.transaction(["images"], "readonly");
  const store = tx.objectStore("images");
  const index = store.index("customerId");

  index.getAll(currentCustomerId).onsuccess = async (e) => {
    const allImages = e.target.result || [];
    const imagesToUpload = allImages.filter((img) => !img.assetId);

    if (imagesToUpload.length === 0) {
      getEl("loader").classList.add("hidden");
      return alert("Không có ảnh hồ sơ nào để tải lên!");
    }

    if (!confirm(`Tải lên ${imagesToUpload.length} ảnh hồ sơ?`)) {
      getEl("loader").classList.add("hidden");
      return;
    }

    getEl("loader-text").textContent = "Đang đẩy lên Google Drive...";

    const folderName = _driveBuildProfileFolderName(currentCustomerData);

    const payload = {
      action: "upload",
      folderName,
      images: imagesToUpload.map((img, idx) => ({
        name: `hoso_${Date.now()}_${idx}.jpg`,
        data: img.data,
      })),
    };

    try {
      const result = await _drivePost(scriptUrl, payload);

      if (result && result.status === "success") {
        // Store plaintext URL (new behavior)
        currentCustomerData.driveLink = result.url;
        db.transaction(["customers"], "readwrite")
          .objectStore("customers")
          .put(currentCustomerData);

        getEl("loader").classList.add("hidden");
        renderDriveStatus(result.url);

        if (
          confirm(
            "✅ Đã Upload xong!\nXóa ảnh trong App để giải phóng bộ nhớ?"
          )
        ) {
          const txDel = db.transaction(["images"], "readwrite");
          imagesToUpload.forEach((img) => txDel.objectStore("images").delete(img.id));
          txDel.oncomplete = () => {
            if (typeof loadProfileImages === "function") loadProfileImages();
            showToast("Đã dọn dẹp bộ nhớ");
          };
        }
      } else {
        throw new Error((result && result.message) || "UPLOAD_FAILED");
      }
    } catch (err) {
      console.error(err);
      getEl("loader").classList.add("hidden");
      alert("Lỗi Upload: " + (err && err.message ? err.message : String(err)));
    }
  };
}

// ------------------------------
// Profile photos: Render status + Reconnect/search
// ------------------------------

function renderDriveStatus(urlOrCipher) {
  const area = getEl("drive-status-area");
  const btnUp = getEl("btn-upload-drive");
  if (!area) return;

  const url = _driveNormalizeUrl(urlOrCipher);
  area.classList.remove("hidden");

  if (url) {
    area.innerHTML = `
      <a href="${url}" target="_blank"
         class="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold
                flex items-center justify-center gap-2 shadow-lg mb-1
                animate-fade-in border border-emerald-400/30">
        <i data-lucide="external-link" class="w-5 h-5"></i> Mở Folder Ảnh
      </a>
      <p class="text-[10px] text-center text-emerald-400/70 italic mb-2">
        Đã đồng bộ lên Cloud
      </p>
    `;
    if (btnUp) btnUp.classList.remove("hidden");
  } else {
    area.innerHTML = `
      <button onclick="reconnectDriveFolder()"
              class="w-full py-2 mb-2 bg-slate-700/50 border border-slate-600
                     rounded-lg text-xs font-medium text-slate-300
                     flex items-center justify-center gap-2 hover:bg-slate-700 transition">
        <i data-lucide="search" class="w-4 h-4"></i> Tìm kết nối cũ
      </button>
    `;
    if (btnUp) btnUp.classList.remove("hidden");
  }

  if (window.lucide) lucide.createIcons();
}

async function reconnectDriveFolder() {
  const scriptUrl = _requireUserScriptUrlOrOpenSettings();
  if (!scriptUrl) return;
  if (!currentCustomerData) return;

  getEl("loader").classList.remove("hidden");
  getEl("loader-text").textContent = "Đang tìm trên Drive...";

  const name = _driveCustomerDisplayName(currentCustomerData);
  const phone = _driveTrim(_driveSafeDecrypt(currentCustomerData.phone));
  const cccd = _driveTrim(_driveSafeDecrypt(currentCustomerData.cccd));

  const possibleNames = [];
  if (cccd) possibleNames.push(`${name} - ${cccd}`);
  if (phone) possibleNames.push(`${name} - ${phone}`);
  if (!possibleNames.length && name) possibleNames.push(name);

  let foundUrl = null;
  let tried = 0;

  for (const folderName of possibleNames) {
    tried++;
    try {
      getEl("loader-text").textContent = `Đang tìm: ${folderName}...`;
      const result = await _drivePost(scriptUrl, {
        action: "search",
        folderName,
      });
      if (result && result.status === "found" && result.url) {
        foundUrl = result.url;
        break;
      }
    } catch (e) {
      console.warn("Drive search error:", e);
    }
  }

  if (foundUrl) {
    // Store plaintext URL (new behavior)
    currentCustomerData.driveLink = foundUrl;
    const tx = db.transaction(["customers"], "readwrite");
    tx.objectStore("customers").put(currentCustomerData).onsuccess = () => {
      getEl("loader").classList.add("hidden");
      renderDriveStatus(foundUrl);
      showToast("Đã kết nối lại thành công!");
    };
  } else {
    getEl("loader").classList.add("hidden");
    if (tried === 0) {
      alert("Không có đủ thông tin để tìm folder (thiếu Tên/CCCD/SĐT).");
    } else {
      alert("Không tìm thấy folder nào khớp với Tên + CCCD hoặc Tên + SĐT.");
    }
  }
}

// ------------------------------
// Asset photos: Upload
// ------------------------------

async function uploadAssetToDrive() {
  const scriptUrl = _requireUserScriptUrlOrOpenSettings();
  if (!scriptUrl) return;
  if (!currentCustomerData || !currentAssetId) return;

  const assetIndex = (currentCustomerData.assets || []).findIndex(
    (a) => a.id === currentAssetId
  );
  if (assetIndex === -1) return;
  const currentAsset = currentCustomerData.assets[assetIndex];

  getEl("loader").classList.remove("hidden");
  getEl("loader-text").textContent = "Đang lấy ảnh TSBĐ...";

  const tx = db.transaction(["images"], "readonly");
  const store = tx.objectStore("images");
  const index = store.index("customerId");

  index.getAll(currentCustomerId).onsuccess = async (e) => {
    const allImages = e.target.result || [];
    const imagesToUpload = allImages.filter((img) => img.assetId === currentAssetId);

    if (imagesToUpload.length === 0) {
      getEl("loader").classList.add("hidden");
      return alert("Tài sản này chưa có ảnh nào!");
    }

    const assetNameReadable = _driveTrim(_driveSafeDecrypt(currentAsset.name));
    if (
      !confirm(
        `Tải lên ${imagesToUpload.length} ảnh của tài sản "${assetNameReadable}" lên Drive?`
      )
    ) {
      getEl("loader").classList.add("hidden");
      return;
    }

    getEl("loader-text").textContent = "Đang Upload TSBĐ...";

    const folderName = _driveBuildAssetFolderName(currentCustomerData, currentAsset);

    const payload = {
      action: "upload",
      folderName,
      images: imagesToUpload.map((img, idx) => ({
        name: `asset_img_${Date.now()}_${idx}.jpg`,
        data: img.data,
      })),
    };

    try {
      const result = await _drivePost(scriptUrl, payload);

      if (result && result.status === "success") {
        // Store plaintext URL (new behavior)
        currentCustomerData.assets[assetIndex].driveLink = result.url;
        db.transaction(["customers"], "readwrite")
          .objectStore("customers")
          .put(currentCustomerData);

        getEl("loader").classList.add("hidden");
        renderAssetDriveStatus(result.url);

        if (
          confirm(
            "✅ TSBĐ ĐÃ LÊN MÂY!\n\nXóa ảnh gốc trong máy để nhẹ bộ nhớ?"
          )
        ) {
          const txDel = db.transaction(["images"], "readwrite");
          imagesToUpload.forEach((img) => txDel.objectStore("images").delete(img.id));
          txDel.oncomplete = () => {
            if (typeof loadAssetImages === "function") loadAssetImages(currentAssetId);
            showToast("Đã dọn dẹp ảnh TSBĐ");
          };
        }
      } else {
        throw new Error((result && result.message) || "UPLOAD_FAILED");
      }
    } catch (err) {
      console.error(err);
      getEl("loader").classList.add("hidden");
      alert("Lỗi: " + (err && err.message ? err.message : String(err)));
    }
  };
}

// ------------------------------
// Asset photos: Render status + Reconnect/search
// ------------------------------

function renderAssetDriveStatus(urlOrCipher) {
  const area = getEl("asset-drive-status-area");
  const btnUp = getEl("btn-asset-upload");
  if (!area) return;
  area.classList.remove("hidden");

  const url = _driveNormalizeUrl(urlOrCipher);

  if (url) {
    area.innerHTML = `
      <a href="${url}" target="_blank"
         class="w-full py-3 bg-teal-600 text-white rounded-xl font-bold
                flex items-center justify-center gap-2 shadow-lg mb-1
                animate-fade-in border border-teal-400/30">
        <i data-lucide="external-link" class="w-5 h-5"></i> Xem Folder TSBĐ
      </a>
    `;
    if (btnUp) btnUp.classList.remove("hidden");
  } else {
    area.innerHTML = `
      <button onclick="reconnectAssetDriveFolder()"
              class="w-full py-2 mb-2 bg-slate-700/50 border border-slate-600
                     rounded-lg text-xs font-medium text-slate-300
                     flex items-center justify-center gap-2 hover:bg-slate-700 transition">
        <i data-lucide="search" class="w-4 h-4"></i> Tìm kết nối cũ
      </button>
    `;
    if (btnUp) btnUp.classList.remove("hidden");
  }

  if (window.lucide) lucide.createIcons();
}

async function reconnectAssetDriveFolder() {
  const scriptUrl = _requireUserScriptUrlOrOpenSettings();
  if (!scriptUrl) return;
  if (!currentCustomerData || !currentAssetId) return;

  const assetIndex = (currentCustomerData.assets || []).findIndex(
    (a) => a.id === currentAssetId
  );
  if (assetIndex === -1) return;
  const asset = currentCustomerData.assets[assetIndex];

  getEl("loader").classList.remove("hidden");
  getEl("loader-text").textContent = "Đang tìm TSBĐ...";

  const folderName = _driveBuildAssetFolderName(currentCustomerData, asset);

  try {
    const result = await _drivePost(scriptUrl, {
      action: "search",
      folderName,
    });

    if (result && result.status === "found" && result.url) {
      // Store plaintext URL (new behavior)
      const tx = db.transaction(["customers"], "readwrite");
      const store = tx.objectStore("customers");

      store.get(currentCustomerData.id).onsuccess = (e) => {
        const dbRecord = e.target.result;
        if (dbRecord && dbRecord.assets && dbRecord.assets[assetIndex]) {
          dbRecord.assets[assetIndex].driveLink = result.url;
          store.put(dbRecord);
        }
      };

      tx.oncomplete = () => {
        // Update in-memory
        currentCustomerData.assets[assetIndex].driveLink = result.url;
        getEl("loader").classList.add("hidden");
        renderAssetDriveStatus(result.url);
        showToast("Đã kết nối lại!");
      };
    } else {
      getEl("loader").classList.add("hidden");
      alert("Không tìm thấy folder: " + folderName);
    }
  } catch (err) {
    console.error(err);
    getEl("loader").classList.add("hidden");
    alert("Lỗi: " + (err && err.message ? err.message : String(err)));
  }
}

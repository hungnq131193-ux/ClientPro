// --- ĐÃ SỬA: GIẢI MÃ DỮ LIỆU TRƯỚC KHI TÍNH TOÁN KHOẢNG CÁCH ---
function referenceAssetPrice(assetIndex) {
  // 1. Lấy tài sản đang chọn
  const targetAsset = currentCustomerData.assets[assetIndex];

  // GIẢI MÃ LINK BẢN ĐỒ TRƯỚC KHI LẤY TỌA ĐỘ
  const decryptedTargetLink = decryptText(targetAsset.link);
  const targetLoc = parseLatLngFromLink(decryptedTargetLink);

  if (!targetLoc) {
    showToast("TSBĐ chưa có tọa độ chuẩn (Link sai hoặc chưa nhập).");
    return;
  }

  getEl("loader").classList.remove("hidden");
  getEl("loader-text").textContent = "Đang tìm kiếm & so sánh...";

  const tx = db.transaction(["customers"], "readonly");
  tx.objectStore("customers").getAll().onsuccess = (e) => {
    const customers = e.target.result || [];
    const candidates = [];

    customers.forEach((cust) => {
      if (!cust.assets) return;

      // Giải mã tên khách hàng để hiển thị
      const custName = decryptText(cust.name);

      cust.assets.forEach((asset) => {
        // Bỏ qua chính tài sản đang so sánh
        if (cust.id === currentCustomerData.id && asset.id === targetAsset.id)
          return;

        // GIẢI MÃ DỮ LIỆU CỦA CÁC TÀI SẢN KHÁC
        const decryptedLink = decryptText(asset.link);
        const loc = parseLatLngFromLink(decryptedLink);

        // Giải mã định giá để tính toán
        const val = parseMoneyToNumber(decryptText(asset.valuation));

        // Giải mã tên tài sản để hiển thị
        const assetName = decryptText(asset.name) || asset.name || "";

        if (loc && val > 0) {
          const dist = distanceMeters(
            targetLoc.lat,
            targetLoc.lng,
            loc.lat,
            loc.lng
          );

          // Chỉ lấy các tài sản trong bán kính 5km (hoặc tùy chỉnh)
          // Ở đây lấy tất cả rồi sort, nhưng có thể if (dist < 5000)
          // Giải mã diện tích và mặt tiền
          const assetArea = decryptText(asset.area) || "";
          const assetWidth = decryptText(asset.width) || "";

          candidates.push({
            customerName: custName,
            assetName: assetName,
            valuation: val,
            distance: dist,
            area: assetArea,
            width: assetWidth,
          });
        }
      });
    });

    getEl("loader").classList.add("hidden");
    getEl("loader-text").textContent = "Loading...";

    if (candidates.length === 0) {
      showToast("Chưa có dữ liệu tham chiếu phù hợp");
      return;
    }

    // Sắp xếp: Gần nhất lên đầu
    candidates.sort((a, b) => a.distance - b.distance);

    // Hiển thị top 20 kết quả
    showRefModal(candidates.slice(0, 20));
  };
}

function showRefModal(results) {
  const modal = getEl("ref-price-modal");
  const container = getEl("ref-results");
  container.innerHTML = "";
  results.forEach((item, idx) => {
    const distStr =
      item.distance < 1000
        ? `${Math.round(item.distance)} m`
        : `${(item.distance / 1000).toFixed(2)} km`;
    const valStr = item.valuation.toLocaleString("vi-VN") + " tr₫";

    // Badge diện tích và mặt tiền
    const areaBadge = item.area
      ? `<span class="bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded text-[10px] font-bold">${escapeHTML(item.area)}m²</span>`
      : '';
    const widthBadge = item.width
      ? `<span class="bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded text-[10px] font-bold">MT:${escapeHTML(item.width)}m</span>`
      : '';
    const badges = (areaBadge || widthBadge) ? `<div class="flex gap-1 mt-1">${areaBadge}${widthBadge}</div>` : '';

    const div = document.createElement("div");
    div.className = "bg-white/5 border border-white/10 rounded-lg p-3";
    div.innerHTML = `
      <div class="flex justify-between items-center mb-1">
        <span class="text-xs font-bold text-emerald-400">#${idx + 1} • Cách ${distStr}</span>
        <span class="text-sm font-bold text-white">${valStr}</span>
      </div>
      <h4 class="text-sm font-medium text-slate-300 truncate">${item.assetName}</h4>
      ${badges}
      <p class="text-[10px] text-slate-500 mt-1 uppercase">KH: ${item.customerName}</p>`;
    container.appendChild(div);
  });
  modal.classList.remove("hidden");
}
function closeRefModal() {
  getEl("ref-price-modal").classList.add("hidden");
}

function renderAssets() {
  const list = getEl("content-assets");
  list.innerHTML = "";
  const assets = currentCustomerData.assets || [];

  // Try to fully unwrap old/double-encrypted labels (best-effort).
  // Some historical records could be encrypted more than once during migrations.
  function _deepDecryptLabel(v) {
    if (v === undefined || v === null) return "";
    let s = String(v);
    for (let i = 0; i < 3; i++) {
      if (!s.startsWith("U2FsdGVkX1")) break;
      try {
        if (typeof decryptText !== "function") break;
        const out = decryptText(s);
        if (!out || out === s) break;
        s = String(out);
      } catch (e) {
        break;
      }
    }
    return s;
  }

  // MIGRATION (backward compatibility):
  // Older app builds stored asset.name as CryptoJS ciphertext (starts with "U2FsdGVkX1").
  // This breaks Drive folder reconnect for TSBĐ because the folderName becomes encrypted.
  // We opportunistically migrate asset.name -> plaintext when we can decrypt it.
  let _needSaveMigration = false;

  if (assets.length === 0) {
    list.innerHTML = `<div class="text-center py-20 text-slate-500"><i data-lucide="building" class="w-10 h-10 mx-auto mb-2 opacity-20"></i><p class="text-sm">Chưa có tài sản</p></div>`;
    lucide.createIcons();
    return;
  }

  assets.forEach((asset, index) => {
    const el = document.createElement("div");
    el.className =
      "glass-panel p-4 rounded-xl flex flex-col gap-3 transition-transform active:scale-[0.99] mb-4";
    el.style.border = "1px solid rgba(255,255,255,0.12)";

    // --- GIẢI MÃ DỮ LIỆU (DECRYPT) ---
    // Nếu ô nào lưu rỗng, hàm decryptText sẽ trả về rỗng -> Không hiện chuỗi mã hóa nữa
    const decName = _deepDecryptLabel(asset.name) || asset.name || "";

    // If name is still ciphertext but decryptText() produced a readable plaintext, persist it.
    // This is safe because asset.name is a display label (not used in cryptographic logic).
    try {
      if (typeof asset.name === "string" && asset.name.startsWith("U2FsdGVkX1")) {
        const dd = _deepDecryptLabel(asset.name);
        if (dd && dd !== asset.name && !String(dd).startsWith("U2FsdGVkX1")) {
          asset.name = decName;
          _needSaveMigration = true;
        }
      }
    } catch (e) { }
    const decLink = decryptText(asset.link) || "";
    const decVal = decryptText(asset.valuation) || "";
    const decLoan = decryptText(asset.loanValue) || "";
    const decArea = decryptText(asset.area) || "";
    const decWidth = decryptText(asset.width) || "";
    const decYear = decryptText(asset.year) || "";
    const decOnland = decryptText(asset.onland) || "";

    // Escape HTML để an toàn
    const safeName = escapeHTML(decName);
    const safeVal = escapeHTML(decVal) || "-";
    const safeLoan = escapeHTML(decLoan) || "-";
    const safeArea = escapeHTML(decArea);
    const safeWidth = escapeHTML(decWidth);
    const safeYear = escapeHTML(decYear);
    const safeOnland = escapeHTML(decOnland);

    const mapLink = formatLink(decLink);
    const mapBtn = mapLink
      ? `<a href="${mapLink}" target="_blank" class="glass-btn flex-1 py-2.5 rounded-lg text-xs font-bold text-slate-300 flex items-center justify-center gap-1 hover:text-white"><i data-lucide="map" class="w-3 h-3"></i> Bản đồ</a>`
      : `<span class="glass-btn flex-1 py-2.5 rounded-lg text-xs text-slate-500 text-center cursor-not-allowed opacity-50">No Map</span>`;
    const ocrBtn = asset.ocrData
      ? `<button onclick="viewSavedOcr('${asset.id}')" class="glass-btn px-3 py-2.5 text-purple-300 rounded-lg text-xs font-bold flex items-center justify-center gap-1 hover:text-white"><i data-lucide="info" class="w-3 h-3"></i> Thông tin bìa</button>`
      : "";

    const areaInfo = safeArea
      ? `<span class="bg-indigo-500/10 text-indigo-300 px-2 py-1 rounded text-[10px] font-bold border border-white/10">${safeArea}m²</span>`
      : "";
    const widthInfo = safeWidth
      ? `<span class="bg-indigo-500/10 text-indigo-300 px-2 py-1 rounded text-[10px] font-bold border border-white/10">MT:${safeWidth}m</span>`
      : "";
    const yearInfo = safeYear
      ? `<span class="bg-slate-500/10 text-slate-300 px-2 py-1 rounded text-[10px] font-bold border border-white/10">Năm:${safeYear}</span>`
      : "";
    const onlandInfo = safeOnland
      ? `<div class="text-xs text-slate-400 mt-1 italic"><i data-lucide="home" class="w-3 h-3 inline mr-1"></i>${safeOnland}</div>`
      : "";

    el.innerHTML = ` <div class="flex justify-between items-start mb-1"> <div class="flex gap-3 items-center"> <div class="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-white/10"><i data-lucide="map-pin" class="w-5 h-5"></i></div> <div><h4 class="font-bold text-white text-sm line-clamp-1">${safeName}</h4><div class="flex gap-1 mt-1 flex-wrap">${areaInfo}${widthInfo}${yearInfo}</div></div> </div> <div class="flex gap-1"> <button onclick="openEditAssetModal(${index})" class="text-blue-400 p-2 hover:bg-white/5 rounded-lg"><i data-lucide="pencil" class="w-4 h-4"></i></button> <button onclick="deleteAsset(${index})" class="text-red-400 p-2 hover:bg-white/5 rounded-lg transition-transform active:scale-90"><i data-lucide="trash-2" class="w-4 h-4"></i></button> </div> </div> ${onlandInfo} <div class="flex justify-between text-xs text-slate-400 mb-2 bg-black/20 p-3 rounded-lg border border-white/5 mt-2"> <span>ĐG: <b class="text-emerald-400 text-sm">${safeVal}</b></span> <span>Vay: <b class="text-blue-400 text-sm">${safeLoan}</b></span> </div> <div class="flex gap-2"> ${mapBtn} ${ocrBtn} <button onclick="referenceAssetPrice(${index})" class="glass-btn flex-1 py-2.5 text-emerald-400 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:text-white"><i data-lucide="radar" class="w-3 h-3"></i> Tham khảo</button> </div> <button onclick="openAssetGallery('${asset.id}', '${safeName}', ${index})" class="glass-btn w-full py-2.5 text-indigo-400 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:text-white mt-1"><i data-lucide="image" class="w-3 h-3"></i> Kho Ảnh TSBĐ</button>`;
    list.appendChild(el);
  });
  lucide.createIcons();

  // Persist migration once per render to avoid many DB writes.
  if (_needSaveMigration) {
    try {
      // Debounce lightly so UI remains smooth.
      clearTimeout(window.__assetNameMigrationTimer);
      window.__assetNameMigrationTimer = setTimeout(() => {
        try {
          db.transaction(["customers"], "readwrite")
            .objectStore("customers")
            .put(currentCustomerData);
        } catch (e) { }
      }, 80);
    } catch (e) { }
  }
}
function openAssetGallery(id, name, idx) {
  // Logic tạo ID nếu chưa có (cho data cũ)
  if (!id || id === "undefined") {
    id = "asset_" + Date.now();
    if (currentCustomerData.assets[idx]) {
      currentCustomerData.assets[idx].id = id;
      db.transaction(["customers"], "readwrite")
        .objectStore("customers")
        .put(currentCustomerData);
    }
  }

  currentAssetId = id;

  // Hiển thị màn hình Gallery
  getEl("screen-asset-gallery").classList.remove("translate-x-full");

  // Lấy thông tin tài sản đang chọn từ bộ nhớ (để đảm bảo chính xác nhất)
  const asset = currentCustomerData.assets[idx];

  if (asset) {
    // --- SỬA LỖI Ở ĐÂY: Giải mã dữ liệu trước khi hiển thị ---
    // 1. Tên tài sản (Giải mã từ object asset thay vì dùng tham số name có thể bị lỗi)
    getEl("gallery-asset-name").textContent =
      decryptText(asset.name) || asset.name || "";

    // 2. Định giá & Vay Max (Giải mã)
    getEl("gallery-asset-val").textContent =
      decryptText(asset.valuation) || "--";
    getEl("gallery-asset-loan").textContent =
      decryptText(asset.loanValue) || "--";

    // Kiểm tra link Drive của tài sản
    if (typeof renderAssetDriveStatus === "function") {
      renderAssetDriveStatus(asset.driveLink);
    }
  } else {
    // Fallback nếu không tìm thấy tài sản
    getEl("gallery-asset-name").textContent = name; // Dùng tạm tên truyền vào
    getEl("gallery-asset-val").textContent = "--";
    getEl("gallery-asset-loan").textContent = "--";
    if (typeof renderAssetDriveStatus === "function")
      renderAssetDriveStatus(null);
  }

  // Gọi hàm load ảnh
  loadAssetImages(id);
}

function closeAssetGallery() {
  getEl("screen-asset-gallery").classList.add("translate-x-full");
  currentAssetId = null;
  isSelectionMode = false;
  selectedImages.clear();
  updateSelectionUI();
}

function openAssetModal() {
  getEl("asset-modal").classList.remove("hidden");
  getEl("edit-asset-index").value = "";
  getEl("modal-title-asset").textContent = "Thêm TSBĐ";
  getEl("btn-save-asset").textContent = "Thêm mới";
  getEl("asset-name").value = "";
  getEl("asset-link").value = "";
  getEl("asset-val").value = "";
  getEl("asset-loan").value = "";
  getEl("asset-area").value = "";
  getEl("asset-width").value = "";
  getEl("asset-onland").value = "";
  getEl("asset-year").value = "";
}
function openEditAssetModal(index) {
  // Hiện modal
  getEl("asset-modal").classList.remove("hidden");

  // Lấy tài sản đang chọn
  const asset = currentCustomerData.assets[index];

  // Setup tiêu đề modal
  getEl("edit-asset-index").value = index;
  getEl("modal-title-asset").textContent = "Cập nhật TSBĐ";
  getEl("btn-save-asset").textContent = "Lưu thay đổi";

  // --- QUAN TRỌNG: Giải mã dữ liệu trước khi điền vào ô input ---
  // Nếu không có decryptText, nó sẽ hiện chuỗi U2FsdGVk...
  getEl("asset-name").value = decryptText(asset.name) || asset.name || "";
  getEl("asset-link").value = decryptText(asset.link) || "";
  getEl("asset-val").value = decryptText(asset.valuation) || "";
  getEl("asset-loan").value = decryptText(asset.loanValue) || "";

  getEl("asset-area").value = decryptText(asset.area) || "";
  getEl("asset-width").value = decryptText(asset.width) || "";
  getEl("asset-onland").value = decryptText(asset.onland) || "";
  getEl("asset-year").value = decryptText(asset.year) || "";

  // Giải mã cả dữ liệu OCR cũ (nếu có)
  getEl("asset-ocr-data").value = decryptText(asset.ocrData) || "";

  // Gán ID để xử lý ảnh đúng tài sản
  currentAssetId = asset.id;
}
function closeAssetModal() {
  getEl("asset-modal").classList.add("hidden");
}

function saveAsset() {
  // Lấy giá trị từ các ô nhập liệu
  const name = getEl("asset-name").value.trim();
  let link = getEl("asset-link").value.trim();

  // Helper:
  // - Chỉ mã hóa nếu có dữ liệu (tránh biến ô trống thành mã loằng ngoằng)
  // - Không mã hóa trường 'name' của TSBĐ nữa để:
  //   + tránh hiện chuỗi U2FsdGVk... ở các luồng UI/Drive
  //   + đảm bảo tính năng "tìm lại link" search folder theo plaintext
  // Các trường khác vẫn giữ cơ chế mã hóa như cũ để không ảnh hưởng chức năng.
  const enc = (txt) => (txt ? encryptText(txt) : "");

  if (!name) return alert("Nhập mô tả tài sản");

  // Xử lý link map
  const coords = parseLatLngFromLink(link);
  if (coords && !link.includes("http")) {
    link = `https://www.google.com/maps?q=${coords.lat},${coords.lng}`;
  }

  if (!currentCustomerData.assets) currentCustomerData.assets = [];

  // --- FIX: KHÔNG MÃ HÓA TÊN TSBĐ (name) ---
  // Tương thích dữ liệu cũ:
  // - dữ liệu cũ: asset.name là ciphertext -> các chỗ render vẫn gọi decryptText(asset.name)
  // - dữ liệu mới: asset.name là plaintext -> decryptText() sẽ fallback (hoặc trả nguyên bản) và UI vẫn hiển thị đúng
  const assetObj = {
    name: name,
    link: enc(link),
    valuation: enc(getEl("asset-val").value),
    loanValue: enc(getEl("asset-loan").value),
    area: enc(getEl("asset-area").value),
    width: enc(getEl("asset-width").value),
    onland: enc(getEl("asset-onland").value),
    year: enc(getEl("asset-year").value),
    ocrData: enc(getEl("asset-ocr-data").value),
  };

  const index = getEl("edit-asset-index").value;
  if (index !== "") {
    // Cập nhật tài sản cũ
    const i = parseInt(index);
    assetObj.id = currentCustomerData.assets[i].id;
    assetObj.createdAt = currentCustomerData.assets[i].createdAt;
    if (currentCustomerData.assets[i].driveLink)
      assetObj.driveLink = currentCustomerData.assets[i].driveLink;
    currentCustomerData.assets[i] = assetObj;
  } else {
    // Thêm mới
    assetObj.id = currentAssetId || "asset_" + Date.now();
    assetObj.createdAt = Date.now();
    currentCustomerData.assets.push(assetObj);
  }

  // Lưu vào DB
  db
    .transaction(["customers"], "readwrite")
    .objectStore("customers")
    .put(currentCustomerData).onsuccess = () => {
      closeAssetModal();
      renderAssets();
      showToast("Đã lưu TSBĐ");
      currentAssetId = null;
    };
}
// --- NEW GUIDE MODAL LOGIC ---
function openGuideModal() {
  getEl("guide-modal").classList.remove("hidden");
}
function closeGuideModal() {
  getEl("guide-modal").classList.add("hidden");
}


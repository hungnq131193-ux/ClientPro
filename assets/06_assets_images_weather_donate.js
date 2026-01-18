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
        const assetName = decryptText(asset.name);

        if (loc && val > 0) {
          const dist = distanceMeters(
            targetLoc.lat,
            targetLoc.lng,
            loc.lat,
            loc.lng
          );

          // Chỉ lấy các tài sản trong bán kính 5km (hoặc tùy chỉnh)
          // Ở đây lấy tất cả rồi sort, nhưng có thể if (dist < 5000)
          candidates.push({
            customerName: custName,
            assetName: assetName,
            valuation: val,
            distance: dist,
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
    const div = document.createElement("div");
    div.className = "bg-white/5 border border-white/10 rounded-lg p-3";
    div.innerHTML = `<div class="flex justify-between items-center mb-1"><span class="text-xs font-bold text-emerald-400">#${ idx + 1 } • Cách ${distStr}</span><span class="text-sm font-bold text-white">${valStr}</span></div><h4 class="text-sm font-medium text-slate-300 truncate">${ item.assetName }</h4><p class="text-[10px] text-slate-500 mt-1 uppercase">KH: ${ item.customerName }</p>`;
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
    const decName = decryptText(asset.name) || "";
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
    getEl("gallery-asset-name").textContent = decryptText(asset.name);

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
  getEl("asset-name").value = decryptText(asset.name);
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

  // Helper: Chỉ mã hóa nếu có dữ liệu (tránh biến ô trống thành mã loằng ngoằng)
  const enc = (txt) => (txt ? encryptText(txt) : "");

  if (!name) return alert("Nhập mô tả tài sản");

  // Xử lý link map
  const coords = parseLatLngFromLink(link);
  if (coords && !link.includes("http")) {
    link = `https://www.google.com/maps?q=$${coords.lat},${coords.lng}`;
  }

  if (!currentCustomerData.assets) currentCustomerData.assets = [];

  // --- SỬA LỖI TẠI ĐÂY: Dùng hàm enc() đã viết ở trên ---
  const assetObj = {
    name: enc(name),
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

function toggleSelectionMode() {
  isSelectionMode = !isSelectionMode;
  selectedImages.clear();
  updateSelectionUI();
  if (!getEl("screen-asset-gallery").classList.contains("translate-x-full"))
    loadAssetImages(currentAssetId);
  else loadProfileImages();
}
function updateSelectionUI() {
  const btns = [getEl("btn-select-mode"), getEl("btn-select-mode-asset")];
  const bar = getEl("selection-bar");
  const count = getEl("selection-count");
  if (isSelectionMode) {
    btns.forEach((b) => {
      if (b) b.classList.add("btn-active");
    });
    bar.classList.remove("translate-y-full");
    bar.classList.add("translate-y-0");
  } else {
    btns.forEach((b) => {
      if (b) b.classList.remove("btn-active");
    });
    bar.classList.add("translate-y-full");
    bar.classList.remove("translate-y-0");
  }
  if (count) count.textContent = selectedImages.size;
}

function toggleImage(id, div) {
  if (selectedImages.has(id)) {
    selectedImages.delete(id);
    div.classList.remove("selected");
  } else {
    selectedImages.add(id);
    div.classList.add("selected");
  }
  getEl("selection-count").textContent = selectedImages.size;
}
function deleteSelectedImages() {
  if (!selectedImages.size) return;
  if (!confirm(`Xóa ${selectedImages.size} ảnh?`)) return;
  const tx = db.transaction(["images"], "readwrite");
  selectedImages.forEach((id) => tx.objectStore("images").delete(id));
  tx.oncomplete = () => {
    showToast("Đã xóa");
    toggleSelectionMode();
  };
}
function dataURLtoBlob(dataurl) {
  var arr = dataurl.split(","),
    mime = arr[0].match(/:(.*?);/)[1],
    bstr = atob(arr[1]),
    n = bstr.length,
    u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}
async function shareSelectedImages() {
  if (!selectedImages.size) return;
  getEl("loader").classList.remove("hidden");
  getEl("loader-text").textContent = "Đóng gói ảnh...";
  try {
    const tx = db.transaction(["images"], "readonly");
    const store = tx.objectStore("images");
    const filePromises = Array.from(selectedImages).map((id) => {
      return new Promise((resolve) => {
        const req = store.get(id);
        req.onsuccess = (e) => {
          if (e.target.result) {
            const blob = dataURLtoBlob(e.target.result.data);
            resolve(
              new File(
                [blob],
                `img_${Date.now()}_${Math.random() .toString(36) .substr(2, 5)}.jpg`,
                { type: "image/jpeg" }
              )
            );
          } else resolve(null);
        };
        req.onerror = () => resolve(null);
      });
    });
    const files = (await Promise.all(filePromises)).filter((f) => f !== null);
    getEl("loader").classList.add("hidden");
    if (files.length > 0) {
      if (navigator.canShare && navigator.canShare({ files })) {
        await navigator.share({
          files,
          title: "SmartBanking",
          text: "Gửi ảnh hồ sơ",
        });
      } else {
        alert("Thiết bị không hỗ trợ chia sẻ nhiều ảnh.");
      }
    }
    toggleSelectionMode();
  } catch (err) {
    getEl("loader").classList.add("hidden");
    console.error(err);
    alert("Lỗi chia sẻ");
  }
}

function loadImagesFiltered(filterFn, targetId = "content-images") {
  db
    .transaction(["images"], "readonly")
    .objectStore("images")
    .index("customerId")
    .getAll(currentCustomerId).onsuccess = (e) => {
    let imgs = e.target.result || [];
    imgs = imgs.filter(filterFn);
    imgs.sort((a, b) => b.createdAt - a.createdAt);
    if (
      targetId === "content-images" &&
      !getEl("screen-asset-gallery").classList.contains("translate-x-full")
    ) {
    } else {
      currentLightboxList = imgs;
    }
    const grid = getEl(targetId);
    if (!grid) return;
    grid.innerHTML = "";
    if (imgs.length === 0) {
      grid.innerHTML = `<div class="col-span-3 text-center py-10 opacity-40 text-sm">Chưa có ảnh</div>`;
      return;
    }
    const svgCheck = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    imgs.forEach((img, idx) => {
      const div = document.createElement("div");
      div.className =
        "img-wrapper cursor-pointer transition-all active:scale-[0.98]";
      if (isSelectionMode && selectedImages.has(img.id))
        div.classList.add("selected");
      const ringHtml = isSelectionMode
        ? `<div class="select-ring">${svgCheck}</div>`
        : "";
      div.innerHTML = `<img src="${img.data}" class="pointer-events-none">${ringHtml}`;
      div.onclick = () => {
        if (isSelectionMode) toggleImage(img.id, div);
        else openLightbox(img.data, img.id, idx, imgs);
      };
      grid.appendChild(div);
    });
  };
}
function loadProfileImages() {
  loadImagesFiltered((img) => !img.assetId);
}
function loadAssetImages(id) {
  db
    .transaction(["images"], "readonly")
    .objectStore("images")
    .index("customerId")
    .getAll(currentCustomerId).onsuccess = (e) => {
    let imgs = e.target.result || [];
    imgs = imgs.filter((img) => img.assetId === id);
    imgs.sort((a, b) => b.createdAt - a.createdAt);
    currentLightboxList = imgs;
    const grid = getEl("asset-gallery-grid");
    grid.innerHTML = "";
    if (imgs.length === 0) {
      grid.innerHTML = `<div class="col-span-3 text-center py-10 opacity-40 text-sm">Chưa có ảnh</div>`;
      return;
    }
    const svgCheck = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    imgs.forEach((img, idx) => {
      const div = document.createElement("div");
      div.className =
        "img-wrapper cursor-pointer transition-all active:scale-[0.98]";
      if (isSelectionMode && selectedImages.has(img.id))
        div.classList.add("selected");
      const ringHtml = isSelectionMode
        ? `<div class="select-ring">${svgCheck}</div>`
        : "";
      div.innerHTML = `<img src="${img.data}" class="pointer-events-none">${ringHtml}`;
      div.onclick = () => {
        if (isSelectionMode) toggleImage(img.id, div);
        else openLightbox(img.data, img.id, idx, imgs);
      };
      grid.appendChild(div);
    });
  };
}

function compressImage(base64, cb) {
  const img = new Image();
  img.onload = () => {
    let w = img.width;
    let h = img.height;

    // Cho phép max ~2200px để chữ vẫn rất nét
    const maxDim = 2200;
    if (w > h && w > maxDim) {
      h = (h * maxDim) / w;
      w = maxDim;
    } else if (h >= w && h > maxDim) {
      w = (w * maxDim) / h;
      h = maxDim;
    }

    const cvs = document.createElement("canvas");
    cvs.width = Math.round(w);
    cvs.height = Math.round(h);
    const ctx = cvs.getContext("2d");

    // Filter nhẹ (không quá tay để khỏi mờ chữ)
    ctx.filter = "contrast(1.03) brightness(1.01)";
    ctx.drawImage(img, 0, 0, cvs.width, cvs.height);

    // Bắt đầu với chất lượng khá cao
    let q = 0.9;

    // Mục tiêu: 500–700KB
    const MAX_BYTES = 700 * 1024;
    const MIN_BYTES = 500 * 1024;

    function adjustAndCheck() {
      const dataUrl = cvs.toDataURL("image/jpeg", q);
      // Ước lượng size binary từ base64
      const sizeBytes = Math.floor(dataUrl.length * 0.75);

      // DEBUG nếu muốn xem thực tế:
      // console.log('q=', q, 'size=', (sizeBytes/1024).toFixed(0), 'KB');

      // Nếu > 700KB → giảm chất lượng xuống
      if (sizeBytes > MAX_BYTES && q > 0.5) {
        q -= 0.05;
        setTimeout(adjustAndCheck, 0);
        return;
      }

      // Nếu < 500KB mà vẫn còn room tăng chất lượng → tăng lên
      if (sizeBytes < MIN_BYTES && q < 0.96) {
        q += 0.03;
        setTimeout(adjustAndCheck, 0);
        return;
      }

      // Chốt ở đây: nằm trong [500, 700] hoặc hết room chỉnh
      cb(dataUrl);
    }

    adjustAndCheck();
  };

  img.onerror = () => {
    // Nếu lỗi thì trả luôn ảnh gốc để tránh treo app
    cb(base64);
  };

  img.src = base64;
}
// --- BƯỚC 3: SỬA HÀM LƯU ẢNH (ĐỂ KÍCH HOẠT OCR TÀI SẢN) ---
// --- ĐÃ SỬA: FIX LỖI KHÔNG REFRESH ẢNH & BỎ TỰ ĐỘNG OCR ---
function saveImageToDB(rawBase64) {
  return new Promise(async (resolve) => {
    if (!currentCustomerId) {
      resolve();
      return;
    }

    // Kiểm tra xem đang ở modal asset không
    if (
      getEl("asset-modal") &&
      !getEl("asset-modal").classList.contains("hidden")
    ) {
      captureMode = "asset";
    }

    getEl("loader").classList.remove("hidden");
    getEl("loader-text").textContent = "Xử lý ảnh...";

    // Không xử lý làm nét hoặc OCR nữa, sử dụng trực tiếp ảnh gốc
    const enhancedBase64 = rawBase64;

    getEl("loader-text").textContent = "Đang lưu ảnh...";

    // Nén và Lưu vào Database
    compressImage(enhancedBase64, (compressed) => {
      const newImg = {
        id: "img_" + Date.now() + Math.random(),
        customerId: currentCustomerId,
        assetId: currentAssetId,
        data: compressed,
        createdAt: Date.now(),
      };

      db
        .transaction(["images"], "readwrite")
        .objectStore("images")
        .add(newImg).onsuccess = () => {
        getEl("loader").classList.add("hidden");
        showToast("Đã lưu ảnh");

        // Refresh giao diện ngay lập tức
        if (
          currentAssetId &&
          !getEl("screen-asset-gallery").classList.contains("translate-x-full")
        ) {
          loadAssetImages(currentAssetId);
        } else if (captureMode === "asset" && currentAssetId) {
          loadAssetImages(currentAssetId);
        } else {
          loadProfileImages();
        }

        resolve();
      };
    });
  });
}
function handleFileUpload(input, mode) {
  const files = input.files;
  if (!files || !files.length) return;

  // Ghi chế độ ảnh (profile = hồ sơ / asset = tài sản)
  captureMode = mode || "profile";

  // Duyệt từng ảnh
  Array.from(files).forEach((file) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result;
      await saveImageToDB(base64);
    };
    reader.readAsDataURL(file);
  });

  // Reset input để lần sau chọn lại vẫn trigger onchange
  input.value = "";
}
async function tryOpenCamera(mode) {
  captureMode = mode;
  try {
    getEl("camera-modal").classList.remove("hidden");
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        // Ưu tiên Full HD trở lên
        width: { min: 1280, ideal: 1920, max: 2560 },
        height: { min: 720, ideal: 1080, max: 1440 },
      },
    });
    getEl("camera-feed").srcObject = stream;
  } catch {
    getEl("camera-modal").classList.add("hidden");
    getEl(
      mode === "profile" ? "native-camera-profile" : "native-camera-asset"
    ).click();
  }
}
function closeCamera() {
  getEl("camera-modal").classList.add("hidden");
  if (stream) stream.getTracks().forEach((t) => t.stop());
}
// CHỤP ẢNH TỪ CAMERA + OCR TRƯỚC KHI NÉN
// CHỤP ẢNH TỪ CAMERA
async function capturePhoto() {
  const v = getEl("camera-feed");
  const c = getEl("camera-canvas");
  c.width = v.videoWidth;
  c.height = v.videoHeight;

  const ctx = c.getContext("2d");
  ctx.drawImage(v, 0, 0);

  // Ảnh gốc chất lượng cao
  const rawBase64 = c.toDataURL("image/jpeg", 1.0);

  // Tắt camera trước khi xử lý
  closeCamera();

  // Bỏ qua xử lý OCR ở chế độ 'ocr' vì đã chuyển sang quét QR offline

  // Lưu ảnh vào DB như cũ (hồ sơ / tài sản / bìa đỏ đều dùng chung)
  await saveImageToDB(rawBase64);
}
function shareOpenedImage() {
  if (!currentImageBase64) return;
  fetch(currentImageBase64)
    .then((res) => res.blob())
    .then((blob) => {
      if (navigator.canShare)
        navigator.share({
          files: [new File([blob], "evidence.jpg", { type: "image/jpeg" })],
        });
    });
}
function deleteOpenedImage() {
  if (confirm("Hủy chứng từ này?")) {
    db
      .transaction(["images"], "readwrite")
      .objectStore("images")
      .delete(currentImageId).onsuccess = () => {
      closeLightbox();
      if (
        currentAssetId &&
        getEl("screen-asset-gallery").classList.contains("translate-x-full") ===
          false
      )
        loadAssetImages(currentAssetId);
      else loadProfileImages();
    };
  }
}
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
  } catch (e) {}
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
          <div class="flex gap-2 flex-shrink-0">
            <button class="px-3 py-2 rounded-xl text-xs font-bold" style="background: rgba(16,185,129,0.15); color: #34d399;" onclick="restoreBackupFromApp('${b.id}')">Restore</button>
            <button class="px-3 py-2 rounded-xl text-xs font-bold" style="background: rgba(59,130,246,0.15); color: #60a5fa;" onclick="exportBackupFromApp('${b.id}')">Xuất file</button>
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
    if (!sec || !sec.ok || !APP_BACKUP_SECRET) {
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
  // Giải mã
  let decryptedStr = "";
  try {
    const bytes = CryptoJS.AES.decrypt(String(encryptedContent), APP_BACKUP_SECRET);
    decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
  } catch (e) {
    decryptedStr = "";
  }
  if (!decryptedStr) throw new Error("Decryption failed");

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
    if (!sec || !sec.ok || !APP_BACKUP_SECRET) {
      alert(
        `BẢO MẬT: ${sec && sec.message ? sec.message : "Không thể lấy khóa bảo mật."}\n\nVui lòng kết nối mạng và thử lại.`
      );
      return;
    }
  } else if (!APP_BACKUP_SECRET) {
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

    // Mã hóa toàn bộ dữ liệu bằng khóa bí mật
    const encrypted = CryptoJS.AES.encrypt(rawStr, APP_BACKUP_SECRET).toString();

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
    } catch (e) {}
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
    if (!sec || !sec.ok || !APP_BACKUP_SECRET) {
      getEl("loader").classList.add("hidden");
      alert(
        `BẢO MẬT: ${ sec && sec.message ? sec.message : "Không thể lấy khóa bảo mật." }\n\nVui lòng kết nối mạng và thử lại.`
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

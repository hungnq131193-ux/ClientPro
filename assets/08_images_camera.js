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

  const galScreen = getEl("screen-asset-gallery");

  // Prevent flash of stale gallery content during slide-in
  try {
    getEl("gallery-asset-name").textContent = "Đang tải...";
    getEl("gallery-asset-val").textContent = "--";
    getEl("gallery-asset-loan").textContent = "--";
    const grid = getEl("asset-gallery-grid");
    if (grid) {
      grid.innerHTML = "";
      grid.scrollTop = 0;
    }
  } catch (e) { }

  // Hiển thị màn hình Gallery (slide-in on next frame for smoother compositing)
  if (typeof nextFrame === "function") nextFrame(() => galScreen.classList.remove("translate-x-full"));
  else galScreen.classList.remove("translate-x-full");

  // Lấy thông tin tài sản đang chọn từ bộ nhớ (để đảm bảo chính xác nhất)
  const asset = currentCustomerData.assets[idx];

  if (asset) {
    // --- PERF: ưu tiên cache __dec nếu đã được chuẩn bị (tránh decrypt lặp) ---
    const d = asset.__dec || {};
    getEl("gallery-asset-name").textContent = (d.name !== undefined ? d.name : decryptText(asset.name)) || "";
    getEl("gallery-asset-val").textContent = (d.valuation !== undefined ? d.valuation : decryptText(asset.valuation)) || "--";
    getEl("gallery-asset-loan").textContent = (d.loanValue !== undefined ? d.loanValue : decryptText(asset.loanValue)) || "--";

    // Kiểm tra link Drive của tài sản
    if (typeof renderAssetDriveStatus === "function") {
      renderAssetDriveStatus(d.driveLink !== undefined ? d.driveLink : asset.driveLink);
    }
  } else {
    // Fallback nếu không tìm thấy tài sản
    getEl("gallery-asset-name").textContent = name; // Dùng tạm tên truyền vào
    getEl("gallery-asset-val").textContent = "--";
    getEl("gallery-asset-loan").textContent = "--";
    if (typeof renderAssetDriveStatus === "function")
      renderAssetDriveStatus(null);
  }

  // Gọi hàm load ảnh: defer until after slide-in to avoid jank
  if (typeof afterTransition === "function") {
    afterTransition(galScreen, () => loadAssetImages(id));
  } else {
    setTimeout(() => loadAssetImages(id), 360);
  }
}

function closeAssetGallery() {
  getEl("screen-asset-gallery").classList.add("translate-x-full");
  currentAssetId = null;
  isSelectionMode = false;
  selectedImages.clear();
  updateSelectionUI();
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

// =======================
// PERF: Lazy decode base64 images
// - Giảm spike khi mở tab ảnh/kho ảnh (tránh decode hàng loạt trên main-thread)
// - Vẫn giữ nguyên chức năng chọn/zoom/lightbox
// =======================
let __lazyImgObserver;
function _ensureLazyImgObserver() {
  if (__lazyImgObserver) return __lazyImgObserver;
  if (typeof IntersectionObserver !== 'function') return null;

  __lazyImgObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const img = en.target;
        const src = img && img.dataset ? img.dataset.src : null;
        if (src && !img.src) {
          img.src = src;
        }
        try { __lazyImgObserver.unobserve(img); } catch (e) { }
      });
    },
    { root: null, rootMargin: '200px 0px', threshold: 0.01 }
  );

  return __lazyImgObserver;
}

function _attachLazySrc(imgEl, dataUrl) {
  const obs = _ensureLazyImgObserver();
  if (imgEl) {
    imgEl.loading = 'lazy';
    imgEl.decoding = 'async';
  }
  if (!obs) {
    // Fallback: set src ngay (trình duyệt cũ)
    if (imgEl) imgEl.src = dataUrl;
    return;
  }
  if (imgEl) {
    imgEl.dataset.src = dataUrl;
    try { obs.observe(imgEl); } catch (e) { imgEl.src = dataUrl; }
  }
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
                `img_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.jpg`,
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

      let i = 0;
      const CHUNK = 24;
      const renderChunk = () => {
        const frag = document.createDocumentFragment();
        const end = Math.min(i + CHUNK, imgs.length);
        for (; i < end; i++) {
          const img = imgs[i];
          const div = document.createElement("div");
          div.className = "img-wrapper cursor-pointer transition-all active:scale-[0.98]";
          if (isSelectionMode && selectedImages.has(img.id)) div.classList.add("selected");

          const imgEl = document.createElement('img');
          imgEl.className = 'pointer-events-none';
          _attachLazySrc(imgEl, img.data);

          div.appendChild(imgEl);

          if (isSelectionMode) {
            const ring = document.createElement('div');
            ring.className = 'select-ring';
            ring.innerHTML = svgCheck;
            div.appendChild(ring);
          }

          const idx = i;
          div.onclick = () => {
            if (isSelectionMode) toggleImage(img.id, div);
            else openLightbox(img.data, img.id, idx, imgs);
          };
          frag.appendChild(div);
        }
        grid.appendChild(frag);
        if (i < imgs.length) requestAnimationFrame(renderChunk);
      };

      requestAnimationFrame(renderChunk);
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

      let i = 0;
      const CHUNK = 24;
      const renderChunk = () => {
        const frag = document.createDocumentFragment();
        const end = Math.min(i + CHUNK, imgs.length);
        for (; i < end; i++) {
          const img = imgs[i];
          const div = document.createElement("div");
          div.className = "img-wrapper cursor-pointer transition-all active:scale-[0.98]";
          if (isSelectionMode && selectedImages.has(img.id)) div.classList.add("selected");

          const imgEl = document.createElement('img');
          imgEl.className = 'pointer-events-none';
          _attachLazySrc(imgEl, img.data);
          div.appendChild(imgEl);

          if (isSelectionMode) {
            const ring = document.createElement('div');
            ring.className = 'select-ring';
            ring.innerHTML = svgCheck;
            div.appendChild(ring);
          }

          const idx = i;
          div.onclick = () => {
            if (isSelectionMode) toggleImage(img.id, div);
            else openLightbox(img.data, img.id, idx, imgs);
          };

          frag.appendChild(div);
        }
        grid.appendChild(frag);
        if (i < imgs.length) requestAnimationFrame(renderChunk);
      };
      requestAnimationFrame(renderChunk);
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
// Renamed to _tryOpenCameraReal for lazy loading wrapper
async function _tryOpenCameraReal(mode) {
  captureMode = mode;
  try {
    getEl("camera-modal").classList.remove("hidden");
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
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
// CHỤP ẢNH TỪ CAMERA
async function capturePhoto() {
  const v = getEl("camera-feed");
  const c = getEl("camera-canvas");
  c.width = v.videoWidth;
  c.height = v.videoHeight;

  const ctx = c.getContext("2d");
  ctx.drawImage(v, 0, 0);

  const rawBase64 = c.toDataURL("image/jpeg", 1.0);
  closeCamera();
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

// Export for lazy loading wrapper
window._tryOpenCameraReal = _tryOpenCameraReal;

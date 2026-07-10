function openAssetGallery(id, name, idx) {
  // Logic tạo ID nếu chưa có (cho data cũ)
  if (!id || id === "undefined") {
    id = "asset_" + Date.now();
    if (currentCustomerData.assets[idx]) {
      currentCustomerData.assets[idx].id = id;
      persistCurrentCustomer((rec) => { rec.assets = currentCustomerData.assets; }, (ok) => {
        if (!ok && window.ErrorHandler) ErrorHandler.logError('openAssetGallery: không lưu được id TSBĐ mới sinh', { assetId: id });
      });
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
  if (typeof slideScreenIn === "function") slideScreenIn(galScreen);
  else if (typeof nextFrame === "function") nextFrame(() => galScreen.classList.remove("translate-x-full"));
  else galScreen.classList.remove("translate-x-full");

  // Lấy thông tin tài sản đang chọn từ bộ nhớ (để đảm bảo chính xác nhất)
  const asset = currentCustomerData.assets[idx];
  const openedAssetId = id;

  const applyGalleryHeader = (n, v, l) => {
    // Chỉ cập nhật nếu vẫn đang xem đúng gallery này
    if (currentAssetId !== openedAssetId) return;
    getEl("gallery-asset-name").textContent = n || "";
    getEl("gallery-asset-val").textContent = v || "--";
    getEl("gallery-asset-loan").textContent = l || "--";
  };

  if (asset) {
    // Sync best-effort (guard ciphertext) rồi async refresh
    const _p = (x, fb) => (typeof _displayPlain === 'function') ? _displayPlain(x, fb) : (decryptText(x) || fb || '');
    applyGalleryHeader(_p(asset.name, 'Đang tải...'), _p(asset.valuation, '--'), _p(asset.loanValue, '--'));

    if (typeof renderAssetDriveStatus === "function") {
      const dl = (typeof _displayPlain === 'function') ? _displayPlain(asset.driveLink, '') : (asset.driveLink || '');
      renderAssetDriveStatus(dl || null);
    }

    // Async: chờ giải mã thật (lazy decrypt cache-miss)
    (async () => {
      try {
        const _pa = (typeof _displayPlainAsync === 'function')
          ? _displayPlainAsync
          : async (x, fb) => _p(x, fb);
        const [n, v, l] = await Promise.all([
          _pa(asset.name, ''),
          _pa(asset.valuation, '--'),
          _pa(asset.loanValue, '--'),
        ]);
        applyGalleryHeader(n || (typeof _displayPlain === 'function' ? _displayPlain(name, '') : (name || '')), v, l);
      } catch (e) { }
    })();
  } else {
    // Fallback nếu không tìm thấy tài sản — vẫn guard ciphertext trên name param
    const safeName = (typeof _displayPlain === 'function') ? _displayPlain(name, '') : ((name && typeof _looksEncrypted === 'function' && _looksEncrypted(name)) ? '' : (name || ''));
    applyGalleryHeader(safeName, '--', '--');
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
  const galScreen = getEl("screen-asset-gallery");
  if (typeof slideScreenOut === "function") slideScreenOut(galScreen);
  else galScreen.classList.add("translate-x-full");
  currentAssetId = null;
  if (typeof cancelImageSelectionMode === 'function') cancelImageSelectionMode();
  else { isSelectionMode = false; selectedImages.clear(); }
  updateSelectionUI();
}


function setImageSelectionMode(enabled, options) {
  const opts = options || {};
  isSelectionMode = !!enabled;
  if (isSelectionMode && typeof pushSelectionHistoryLayer === 'function') pushSelectionHistoryLayer('images');
  if (!opts.keepSelection) selectedImages.clear();
  if (document.body) document.body.classList.toggle('image-selection-mode', isSelectionMode);
  if (!isSelectionMode) { document.querySelectorAll('.img-wrapper.selected').forEach((el) => { el.classList.remove('selected'); const ring = el.querySelector('.select-ring'); if (ring) ring.remove(); }); if (typeof clearSelectionHistoryLayer === 'function') clearSelectionHistoryLayer(); }
  updateSelectionUI();
  if (!opts.skipReload) {
    if (!getEl("screen-asset-gallery").classList.contains("translate-x-full"))
      loadAssetImages(currentAssetId);
    else loadProfileImages();
  }
}
function toggleSelectionMode() {
  setImageSelectionMode(!isSelectionMode);
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
  const svgCheck = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  if (selectedImages.has(id)) {
    selectedImages.delete(id);
    div.classList.remove("selected");
    const ring = div.querySelector('.select-ring');
    if (ring) ring.remove();
  } else {
    selectedImages.add(id);
    div.classList.add("selected");
    if (!div.querySelector('.select-ring')) {
      const ring = document.createElement('div');
      ring.className = 'select-ring';
      ring.innerHTML = svgCheck;
      div.appendChild(ring);
    }
  }
  getEl("selection-count").textContent = selectedImages.size;
}
async function deleteSelectedImages() {
  if (!selectedImages.size) return;
  if (!(await ErrorHandler.confirm(`Xóa ${selectedImages.size} ảnh đã chọn?`, { title: "Xóa ảnh", danger: true, confirmText: "Xóa" }))) return;
  const tx = db.transaction(["images"], "readwrite");
  selectedImages.forEach((id) => tx.objectStore("images").delete(id));
  tx.oncomplete = () => {
    ErrorHandler.showSuccess("Đã xóa ảnh đã chọn");
    setImageSelectionMode(false);
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
  // Không bao giờ gán ciphertext / URL không an toàn vào <img src>
  if (typeof _looksEncrypted === 'function' && _looksEncrypted(dataUrl)) return;
  if (typeof isSafeImageUrl === 'function' && dataUrl && !isSafeImageUrl(dataUrl)) return;
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

/** Giải mã img.data (plaintext hoặc cpg1:/U2FsdGVk) trước khi hiển thị/chia sẻ. */
async function resolveImageData(imgOrData) {
  const raw = (imgOrData && typeof imgOrData === 'object') ? imgOrData.data : imgOrData;
  if (!raw) return '';
  let out = '';
  try {
    if (typeof decryptImageData === 'function') out = await decryptImageData(raw);
    else if (typeof decryptFieldAsync === 'function' && typeof _looksEncrypted === 'function' && _looksEncrypted(String(raw))) {
      out = await decryptFieldAsync(raw);
    } else if (typeof decryptFieldAsync === 'function' && String(raw).startsWith('cpg1:')) {
      out = await decryptFieldAsync(raw);
    } else {
      out = (typeof decryptText === 'function') ? decryptText(raw) : raw;
    }
  } catch (e) { return ''; }
  if (!out) return '';
  if (typeof _looksEncrypted === 'function' && _looksEncrypted(out)) return '';
  if (typeof isSafeImageUrl === 'function' && !isSafeImageUrl(out)) return '';
  return out;
}
async function shareSelectedImages() {
  if (!selectedImages.size) return;
  LoadingManager.showGlobal("Đóng gói ảnh...");
  try {
    const tx = db.transaction(["images"], "readonly");
    const store = tx.objectStore("images");
    const filePromises = Array.from(selectedImages).map((id) => {
      return new Promise((resolve) => {
        const req = store.get(id);
        req.onsuccess = async (e) => {
          if (e.target.result) {
            const dataUrl = await resolveImageData(e.target.result);
            const blob = dataURLtoBlob(dataUrl);
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
    LoadingManager.hideGlobal(true);
    if (files.length > 0) {
      if (navigator.canShare && navigator.canShare({ files })) {
        await navigator.share({
          files,
          title: "SmartBanking",
          text: "Gửi ảnh hồ sơ",
        });
      } else {
        ErrorHandler.showError('UNKNOWN', "Thiết bị không hỗ trợ chia sẻ nhiều ảnh.");
      }
    }
    setImageSelectionMode(false);
  } catch (err) {
    LoadingManager.hideGlobal(true);
    // Người dùng bấm Hủy hộp thoại chia sẻ (AbortError) không phải lỗi thật.
    if (err && err.name === 'AbortError') return;
    ErrorHandler.showError('UNKNOWN', "Không chia sẻ được ảnh. Vui lòng thử lại.", err);
  }
}

function loadImagesFiltered(filterFn, targetId = "content-images") {
  db
    .transaction(["images"], "readonly")
    .objectStore("images")
    .index("customerId")
    .getAll(currentCustomerId).onsuccess = async (e) => {
      let imgs = e.target.result || [];
      imgs = imgs.filter(filterFn);
      imgs.sort((a, b) => b.createdAt - a.createdAt);
      const resolved = await Promise.all(imgs.map(async (img) => ({
        ...img,
        _displayData: await resolveImageData(img),
      })));
      imgs = resolved;
      if (
        targetId === "content-images" &&
        !getEl("screen-asset-gallery").classList.contains("translate-x-full")
      ) {
      } else {
        currentLightboxList = imgs;
      }
      const grid = getEl(targetId);
      if (!grid) return;
      // Token chống render chồng: khi lưu nhiều ảnh liên tiếp, mỗi ảnh lưu xong lại
      // gọi refresh — nếu 2 lượt render chunk chạy song song sẽ append trùng ảnh.
      const renderToken = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      grid.dataset.renderToken = renderToken;
      grid.innerHTML = "";
      if (imgs.length === 0) {
        grid.innerHTML = `<div class="col-span-3 text-center py-10 opacity-40 text-sm">Chưa có ảnh</div>`;
        return;
      }

      const svgCheck = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

      let i = 0;
      const CHUNK = 24;
      const renderChunk = () => {
        if (grid.dataset.renderToken !== renderToken) return; // có lượt render mới hơn
        const frag = document.createDocumentFragment();
        const end = Math.min(i + CHUNK, imgs.length);
        for (; i < end; i++) {
          const img = imgs[i];
          const div = document.createElement("div");
          div.className = "img-wrapper cursor-pointer transition-all active:scale-[0.98]";
          if (isSelectionMode && selectedImages.has(img.id)) div.classList.add("selected");

          const imgEl = document.createElement('img');
          imgEl.className = 'pointer-events-none';
          _attachLazySrc(imgEl, img._displayData || img.data);

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
            else openLightbox(img._displayData || img.data, img.id, idx, imgs);
          };
          if (typeof bindLongPress === 'function') {
            bindLongPress(div, (event) => {
              if (event && event.cancelable) event.preventDefault();
              if (typeof clearNativeTextSelection === 'function') clearNativeTextSelection();
              if (!isSelectionMode) setImageSelectionMode(true, { keepSelection: true, skipReload: true });
              if (!selectedImages.has(img.id)) toggleImage(img.id, div);
            });
          }
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
    .getAll(currentCustomerId).onsuccess = async (e) => {
      let imgs = e.target.result || [];
      imgs = imgs.filter((img) => img.assetId === id);
      imgs.sort((a, b) => b.createdAt - a.createdAt);
      const resolved = await Promise.all(imgs.map(async (img) => ({
        ...img,
        _displayData: await resolveImageData(img),
      })));
      imgs = resolved;
      currentLightboxList = imgs;
      const grid = getEl("asset-gallery-grid");
      // Token chống render chồng (xem loadImagesFiltered)
      const renderToken = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      grid.dataset.renderToken = renderToken;
      grid.innerHTML = "";
      if (imgs.length === 0) {
        grid.innerHTML = `<div class="col-span-3 text-center py-10 opacity-40 text-sm">Chưa có ảnh</div>`;
        return;
      }

      const svgCheck = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

      let i = 0;
      const CHUNK = 24;
      const renderChunk = () => {
        if (grid.dataset.renderToken !== renderToken) return; // có lượt render mới hơn
        const frag = document.createDocumentFragment();
        const end = Math.min(i + CHUNK, imgs.length);
        for (; i < end; i++) {
          const img = imgs[i];
          const div = document.createElement("div");
          div.className = "img-wrapper cursor-pointer transition-all active:scale-[0.98]";
          if (isSelectionMode && selectedImages.has(img.id)) div.classList.add("selected");

          const imgEl = document.createElement('img');
          imgEl.className = 'pointer-events-none';
          _attachLazySrc(imgEl, img._displayData || img.data);
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
            else openLightbox(img._displayData || img.data, img.id, idx, imgs);
          };
          if (typeof bindLongPress === 'function') {
            bindLongPress(div, (event) => {
              if (event && event.cancelable) event.preventDefault();
              if (typeof clearNativeTextSelection === 'function') clearNativeTextSelection();
              if (!isSelectionMode) setImageSelectionMode(true, { keepSelection: true, skipReload: true });
              if (!selectedImages.has(img.id)) toggleImage(img.id, div);
            });
          }

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
// --- ĐÃ SỬA: FIX LỖI KHÔNG REFRESH ẢNH ---
function saveImageToDB(rawBase64) {
  return new Promise(async (resolve) => {
    // SNAPSHOT đối tượng đích NGAY LÚC BẮT ĐẦU: chuỗi nén ảnh (nhiều vòng
    // setTimeout chỉnh chất lượng) + await mã hóa phía dưới có thể kéo dài —
    // nếu đọc global currentCustomerId/currentAssetId SAU đó, user kịp chuyển
    // hồ sơ/TSBĐ làm ảnh bị gán nhầm đối tượng mới. Ảnh luôn ghi vào đúng
    // đối tượng tại thời điểm chụp.
    const askedCustomerId = currentCustomerId;
    const askedAssetId = currentAssetId;
    if (!askedCustomerId) {
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
    const askedCaptureMode = captureMode;

    LoadingManager.showGlobal("Xử lý ảnh...");

    // Sử dụng trực tiếp ảnh gốc
    const enhancedBase64 = rawBase64;

    getEl("loader-text").textContent = "Đang lưu ảnh...";

    // Nén và Lưu vào Database (mã hóa at-rest trước khi ghi)
    compressImage(enhancedBase64, async (compressed) => {
      let storedData = compressed;
      try {
        if (typeof encryptImageData === 'function') {
          storedData = await encryptImageData(compressed);
        }
      } catch (e) {
        try { ErrorHandler.logError('encryptImageData', e); } catch (_) {}
      }
      const newImg = {
        id: "img_" + Date.now() + Math.random(),
        customerId: askedCustomerId,
        assetId: askedAssetId,
        data: storedData,
        imgCryptoV: (typeof storedData === 'string' && storedData.startsWith('cpg1:')) ? 1 : undefined,
        createdAt: Date.now(),
      };

      const addReq = db
        .transaction(["images"], "readwrite")
        .objectStore("images")
        .add(newImg);

      addReq.onsuccess = () => {
        LoadingManager.hideGlobal(true);
        ErrorHandler.showSuccess("Đã lưu ảnh");

        // Refresh giao diện CHỈ khi user vẫn đang ở đúng đối tượng ban đầu
        // (đã chuyển đi nơi khác thì không đụng grid đang xem).
        if (currentCustomerId === askedCustomerId) {
          const galleryOpen = !getEl("screen-asset-gallery").classList.contains("translate-x-full");
          if (askedAssetId && currentAssetId === askedAssetId && (galleryOpen || askedCaptureMode === "asset")) {
            loadAssetImages(askedAssetId);
          } else if (!askedAssetId) {
            loadProfileImages();
          }
        }

        resolve();
      };

      // Lỗi ghi IDB (quota/constraint) hiếm nhưng có thật: không có onerror thì
      // loader "Đang lưu ảnh..." treo vĩnh viễn (hideGlobal chỉ nằm trong onsuccess).
      addReq.onerror = () => {
        LoadingManager.hideGlobal(true);
        ErrorHandler.showError('STORAGE', 'Không lưu được ảnh vào máy. Kiểm tra dung lượng bộ nhớ rồi thử lại.', addReq.error);
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
// Dừng hẳn stream camera hiện tại (tắt đèn camera, giải phóng pin) + gỡ khỏi <video>.
function _stopCameraStream() {
  if (stream) {
    try { stream.getTracks().forEach((t) => t.stop()); } catch (e) { }
    stream = null;
  }
  try {
    const v = getEl("camera-feed");
    if (v) v.srcObject = null;
  } catch (e) { }
}

// Renamed to _tryOpenCameraReal for lazy loading wrapper
// Token chống race khi double-tap nút camera: stream cũ luôn bị stop trước khi
// stream mới được gán, và stream về "muộn" (modal đã đóng / có request mới hơn)
// bị dừng ngay thay vì chạy ngầm.
let __cameraOpenSeq = 0;
async function _tryOpenCameraReal(mode) {
  captureMode = mode;
  const seq = ++__cameraOpenSeq;
  try {
    getEl("camera-modal").classList.remove("hidden");
    _stopCameraStream();
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { min: 1280, ideal: 1920, max: 2560 },
        height: { min: 720, ideal: 1080, max: 1440 },
      },
    });
    if (seq !== __cameraOpenSeq || getEl("camera-modal").classList.contains("hidden")) {
      // Đã có request mới hơn hoặc user đóng camera trong lúc chờ cấp quyền.
      try { newStream.getTracks().forEach((t) => t.stop()); } catch (e) { }
      return;
    }
    stream = newStream;
    getEl("camera-feed").srcObject = newStream;
  } catch {
    if (seq !== __cameraOpenSeq) return;
    getEl("camera-modal").classList.add("hidden");
    getEl(
      mode === "profile" ? "native-camera-profile" : "native-camera-asset"
    ).click();
  }
}
function closeCamera() {
  const m = getEl("camera-modal");
  if (m) m.classList.add("hidden");
  _stopCameraStream();
}

// RIÊNG TƯ + PIN: camera không được chạy ngầm khi app bị che/khóa máy/chuyển tab.
// closeCamera() an toàn khi gọi lặp (no-op nếu không có stream).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") closeCamera();
});
window.addEventListener("pagehide", () => closeCamera());
// CHỤP ẢNH TỪ CAMERA
async function capturePhoto() {
  // finally đảm bảo camera luôn tắt kể cả khi drawImage/toDataURL/save ném lỗi
  // (video chưa sẵn sàng...) — không để track chạy ngầm, đèn camera sáng mãi.
  try {
    const v = getEl("camera-feed");
    const c = getEl("camera-canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;

    const ctx = c.getContext("2d");
    ctx.drawImage(v, 0, 0);

    const rawBase64 = c.toDataURL("image/jpeg", 1.0);
    closeCamera();
    await saveImageToDB(rawBase64);
  } finally {
    closeCamera(); // no-op nếu đã đóng ở nhánh thành công
  }
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
async function deleteOpenedImage() {
  if (!(await ErrorHandler.confirm("Hủy chứng từ này?", { title: "Xóa chứng từ", danger: true, confirmText: "Xóa" }))) return;
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

// Export for lazy loading wrapper
window._tryOpenCameraReal = _tryOpenCameraReal;

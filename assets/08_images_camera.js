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
  const bar = getEl("selection-bar");
  const count = getEl("selection-count");
  if (isSelectionMode) {
    bar.classList.remove("translate-y-full");
    bar.classList.add("translate-y-0");
  } else {
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
// Promisify một IndexedDB transaction: resolve khi complete, reject khi error/abort.
// Bắt buộc dùng cho các thao tác destructive để lỗi transaction không bị im lặng.
function __imgTxDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Transaction error"));
    tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
  });
}

let __deleteImagesInFlight = false;
async function deleteSelectedImages() {
  if (__deleteImagesInFlight) return;
  if (!selectedImages.size) return;
  if (!(await ErrorHandler.confirm(`Xóa ${selectedImages.size} ảnh đã chọn?`, { title: "Xóa ảnh", danger: true, confirmText: "Xóa" }))) return;
  if (__deleteImagesInFlight) return;
  __deleteImagesInFlight = true;
  try {
    // Snapshot ID trước khi mở transaction. Một transaction duy nhất: all-or-nothing.
    const ids = Array.from(selectedImages);
    const tx = db.transaction(["images"], "readwrite");
    ids.forEach((id) => tx.objectStore("images").delete(id));
    await __imgTxDone(tx);
    ErrorHandler.showSuccess("Đã xóa ảnh đã chọn");
    setImageSelectionMode(false);
  } catch (err) {
    ErrorHandler.showError('STORAGE', 'Xóa ảnh thất bại — dữ liệu CHƯA thay đổi. Vui lòng thử lại.', err);
  } finally {
    __deleteImagesInFlight = false;
  }
}
// Trả null (KHÔNG throw) khi input rỗng/không phải data URL hợp lệ — caller phải
// kiểm null. Trước đây ''.split(',')[0].match(...) trả null -> null[1] throw
// TypeError bên trong async callback không ai catch -> Promise chia sẻ ảnh treo.
function dataURLtoBlob(dataurl) {
  try {
    if (!dataurl || typeof dataurl !== 'string') return null;
    var arr = dataurl.split(",");
    var mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch || arr.length < 2) return null;
    var mime = mimeMatch[1],
      bstr = atob(arr[1]),
      n = bstr.length,
      u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  } catch (e) {
    return null;
  }
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
        // Async callback của IDB không ai await/catch được Promise của nó — mọi
        // throw bên trong (ảnh rỗng/hỏng, decrypt fail) phải tự catch để LUÔN
        // resolve, nếu không Promise.all treo vĩnh viễn -> loader không bao giờ tắt.
        req.onsuccess = async (e) => {
          try {
            if (!e.target.result) { resolve(null); return; }
            const dataUrl = await resolveImageData(e.target.result);
            const blob = dataURLtoBlob(dataUrl);
            if (!blob) { resolve(null); return; } // ảnh hỏng/không giải mã được -> bỏ qua
            resolve(
              new File(
                [blob],
                `img_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.jpg`,
                { type: "image/jpeg" }
              )
            );
          } catch (err) {
            try { ErrorHandler.logError('shareSelectedImages: ảnh lỗi', err); } catch (_) {}
            resolve(null);
          }
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
    } else {
      // Tất cả ảnh chọn đều hỏng/không giải mã được — báo rõ thay vì im lặng.
      ErrorHandler.showError('UNKNOWN', "Không đọc được ảnh đã chọn (ảnh hỏng hoặc chưa giải mã được). Vui lòng thử lại.");
    }
    setImageSelectionMode(false);
  } catch (err) {
    LoadingManager.hideGlobal(true);
    // Người dùng bấm Hủy hộp thoại chia sẻ (AbortError) không phải lỗi thật.
    if (err && err.name === 'AbortError') return;
    ErrorHandler.showError('UNKNOWN', "Không chia sẻ được ảnh. Vui lòng thử lại.", err);
  }
}

// Map bất đồng bộ có GIỚI HẠN đồng thời. Promise.all(imgs.map(...)) giải mã toàn
// bộ ảnh cùng lúc: một hồ sơ vài chục ảnh làm đỉnh RAM/CPU dựng đứng trên Android
// (mỗi job giữ ciphertext + plaintext data URL trong RAM). Giữ nguyên thứ tự kết
// quả theo index đầu vào.
async function _mapPool(items, limit, mapper) {
  const out = new Array(items.length);
  let next = 0;
  const workerCount = Math.min(Math.max(1, limit | 0), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await mapper(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function loadImagesFiltered(filterFn, targetId = "content-images") {
  // Token chống hiện nhầm ảnh khi user chuyển hồ sơ/TSBĐ trong lúc decrypt
  // (mirror __openFolderSeq ở 05_customers.js). Dùng chung 1 counter với
  // loadAssetImages — 2 hàm không chạy đồng thời cho cùng grid. renderToken
  // phía dưới chỉ chống 2 lượt render CÙNG đối tượng đè nhau, không chống
  // việc đã chuyển sang đối tượng KHÁC trước khi decrypt xong.
  const loadSeq = (window.__galleryLoadSeq = (window.__galleryLoadSeq || 0) + 1);
  const askedCustomerId = currentCustomerId;
  db
    .transaction(["images"], "readonly")
    .objectStore("images")
    .index("customerId")
    .getAll(askedCustomerId).onsuccess = async (e) => {
      let imgs = e.target.result || [];
      imgs = imgs.filter(filterFn);
      imgs.sort((a, b) => b.createdAt - a.createdAt);
      const resolved = await _mapPool(imgs, 4, async (img) => ({
        ...img,
        _displayData: await resolveImageData(img),
      }));
      // Sau decrypt: có lượt load mới hơn / user đã sang hồ sơ khác -> bỏ,
      // không ghi đè grid + lightbox list của đối tượng đang xem.
      if (loadSeq !== window.__galleryLoadSeq || currentCustomerId !== askedCustomerId) return;
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
        // Empty state chuẩn .cp-state (icon + tiêu đề + gợi ý) thay cho dòng text mờ
        if (window.LoadingManager && LoadingManager.showEmptyState) {
          LoadingManager.showEmptyState(grid, {
            icon: 'camera',
            title: 'Chưa có ảnh',
            message: 'Bấm nút "Chụp" hoặc biểu tượng tải lên bên dưới để thêm ảnh.',
          });
        } else {
          grid.innerHTML = `<div class="col-span-3 text-center py-10 opacity-60 text-sm">Chưa có ảnh</div>`;
        }
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
  // Token chống hiện nhầm gallery khi user mở TSBĐ khác trong lúc decrypt
  // (xem loadImagesFiltered — dùng chung counter __galleryLoadSeq).
  const loadSeq = (window.__galleryLoadSeq = (window.__galleryLoadSeq || 0) + 1);
  const askedCustomerId = currentCustomerId;
  db
    .transaction(["images"], "readonly")
    .objectStore("images")
    .index("customerId")
    .getAll(askedCustomerId).onsuccess = async (e) => {
      let imgs = e.target.result || [];
      imgs = imgs.filter((img) => img.assetId === id);
      imgs.sort((a, b) => b.createdAt - a.createdAt);
      const resolved = await _mapPool(imgs, 4, async (img) => ({
        ...img,
        _displayData: await resolveImageData(img),
      }));
      // Sau decrypt: có lượt load mới hơn / user đã sang nơi khác -> bỏ.
      if (loadSeq !== window.__galleryLoadSeq || currentCustomerId !== askedCustomerId) return;
      imgs = resolved;
      currentLightboxList = imgs;
      const grid = getEl("asset-gallery-grid");
      // Token chống render chồng (xem loadImagesFiltered)
      const renderToken = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      grid.dataset.renderToken = renderToken;
      grid.innerHTML = "";
      if (imgs.length === 0) {
        // Empty state chuẩn .cp-state (icon + tiêu đề + gợi ý) thay cho dòng text mờ
        if (window.LoadingManager && LoadingManager.showEmptyState) {
          LoadingManager.showEmptyState(grid, {
            icon: 'camera',
            title: 'Chưa có ảnh',
            message: 'Bấm nút "Chụp" hoặc biểu tượng tải lên bên dưới để thêm ảnh.',
          });
        } else {
          grid.innerHTML = `<div class="col-span-3 text-center py-10 opacity-60 text-sm">Chưa có ảnh</div>`;
        }
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
    try {
      _compressLoaded(img, base64, cb);
    } catch (e) {
      // Canvas throw (tainted / hết bộ nhớ) không được để Promise của
      // saveImageToDB treo mãi: trả ảnh gốc y như nhánh img.onerror.
      try { ErrorHandler.logError('compressImage', e); } catch (_) { }
      cb(base64);
    }
  };

  img.onerror = () => {
    // Nếu lỗi thì trả luôn ảnh gốc để tránh treo app
    cb(base64);
  };

  img.src = base64;
}

function _compressLoaded(img, base64, cb) {
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

  // Bước giảm (0.05) và bước tăng (0.03) không chia hết cho nhau: với ảnh mà
  // không mức quality nào rơi vào [500, 700] KB, vòng cũ dao động quanh band
  // qua setTimeout mãi mãi. Hai chốt chặn: trần số vòng, và phát hiện đảo chiều
  // (vừa tăng rồi lại đòi giảm ⇒ đã kẹp sát band, chốt luôn).
  const MAX_STEPS = 24;
  let steps = 0;
  let lastDir = 0; // -1 = vừa giảm quality, +1 = vừa tăng

  function adjustAndCheck() {
    const dataUrl = cvs.toDataURL("image/jpeg", q);
    // Ước lượng size binary từ base64
    const sizeBytes = Math.floor(dataUrl.length * 0.75);

    if (++steps > MAX_STEPS) {
      cb(dataUrl);
      return;
    }

    // Nếu > 700KB → giảm chất lượng xuống
    if (sizeBytes > MAX_BYTES) {
      // Hết room giảm, hoặc vòng trước vừa TĂNG (dao động) → chốt bản này.
      if (q <= 0.5 || lastDir === 1) {
        cb(dataUrl);
        return;
      }
      q -= 0.05;
      lastDir = -1;
      setTimeout(adjustAndCheck, 0);
      return;
    }

    // Nếu < 500KB mà vẫn còn room tăng chất lượng → tăng lên
    if (sizeBytes < MIN_BYTES && q < 0.96) {
      q += 0.03;
      lastDir = 1;
      setTimeout(adjustAndCheck, 0);
      return;
    }

    // Chốt ở đây: nằm trong [500, 700] hoặc hết room chỉnh
    cb(dataUrl);
  }

  adjustAndCheck();
}
// --- ĐÃ SỬA: FIX LỖI KHÔNG REFRESH ẢNH ---
// opts (tùy chọn) = { customerId, assetId, captureMode }: đường upload file đọc
// FileReader bất đồng bộ nên phải snapshot đối tượng đích TRƯỚC khi đọc file và
// truyền xuống đây (xem handleFileUpload). Không truyền opts => giữ hành vi cũ:
// snapshot global ngay đầu hàm (đường camera).
function saveImageToDB(rawBase64, opts) {
  return new Promise(async (resolve) => {
    // SNAPSHOT đối tượng đích NGAY LÚC BẮT ĐẦU: chuỗi nén ảnh (nhiều vòng
    // setTimeout chỉnh chất lượng) + await mã hóa phía dưới có thể kéo dài —
    // nếu đọc global currentCustomerId/currentAssetId SAU đó, user kịp chuyển
    // hồ sơ/TSBĐ làm ảnh bị gán nhầm đối tượng mới. Ảnh luôn ghi vào đúng
    // đối tượng tại thời điểm chụp.
    const hasOpts = !!opts && Object.prototype.hasOwnProperty.call(opts, "customerId");
    const askedCustomerId = hasOpts ? opts.customerId : currentCustomerId;
    const askedAssetId = hasOpts ? opts.assetId : currentAssetId;
    if (!askedCustomerId) {
      resolve();
      return;
    }

    if (!hasOpts) {
      // Kiểm tra xem đang ở modal asset không
      if (
        getEl("asset-modal") &&
        !getEl("asset-modal").classList.contains("hidden")
      ) {
        captureMode = "asset";
      }
    }
    const askedCaptureMode = hasOpts ? (opts.captureMode || captureMode) : captureMode;

    LoadingManager.showGlobal("Xử lý ảnh...");

    // Sử dụng trực tiếp ảnh gốc
    const enhancedBase64 = rawBase64;

    getEl("loader-text").textContent = "Đang lưu ảnh...";

    // Nén và Lưu vào Database (mã hóa at-rest trước khi ghi)
    compressImage(enhancedBase64, async (compressed) => {
      // FAIL-CLOSED trước khi mở transaction: encryptImageData (02_security.js) là
      // fail-open ở tầng crypto — mất masterKey thì nó TRẢ NGUYÊN data URL. Nuốt lỗi
      // rồi ghi tiếp như trước = ảnh plaintext nằm vĩnh viễn trong IndexedDB. Caller
      // ghi DB chịu trách nhiệm từ chối plaintext; tầng crypto giữ nguyên fail-open
      // cho migration/callers khác.
      const failClosed = (err) => {
        LoadingManager.hideGlobal(true);
        ErrorHandler.showError(
          'STORAGE',
          'Không mã hóa được ảnh — chưa lưu. Mở khóa lại rồi thử.',
          err || null
        );
        resolve();
      };

      let storedData = compressed;
      try {
        if (typeof encryptImageData !== 'function') {
          failClosed(null);
          return;
        }
        storedData = await encryptImageData(compressed);
      } catch (e) {
        try { ErrorHandler.logError('encryptImageData', e); } catch (_) {}
        failClosed(e);
        return;
      }

      // Session còn mở khóa? (auto-lock có thể rơi vào giữa nén + mã hóa)
      const unlocked = (typeof isAppUnlocked !== 'function') || isAppUnlocked();
      // Kết quả có thật sự là ciphertext? Dùng helper chung — không hard-code prefix.
      const looksEnc = (typeof _looksEncrypted === 'function') && _looksEncrypted(storedData);
      if (!unlocked || !looksEnc) {
        failClosed(null);
        return;
      }

      const newImg = {
        id: "img_" + Date.now() + Math.random(),
        customerId: askedCustomerId,
        assetId: askedAssetId,
        data: storedData,
        imgCryptoV: 1,
        createdAt: Date.now(),
      };

      const imgTx = db.transaction(["images"], "readwrite");
      imgTx.objectStore("images").add(newImg);

      // Success UI chỉ sau COMMIT (oncomplete) — add onsuccess chưa bảo đảm đã ghi.
      // onabort bắt buộc: tx có thể abort KHÔNG kèm request error (quota, versionchange),
      // khi đó onerror không bắn — loader "Đang lưu ảnh..." treo vĩnh viễn và Promise
      // của saveImageToDB không bao giờ resolve. Settled guard: request error bubble lên
      // tx.onerror rồi abort bắn tiếp onabort — hai sự kiện cho một thất bại, chốt một lần.
      let imgTxSettled = false;
      imgTx.oncomplete = () => {
        if (imgTxSettled) return;
        imgTxSettled = true;
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

      // Lỗi ghi IDB (quota/constraint) hiếm nhưng có thật: không có onerror/onabort thì
      // loader "Đang lưu ảnh..." treo vĩnh viễn (hideGlobal chỉ nằm trong oncomplete).
      const imgTxFail = () => {
        if (imgTxSettled) return;
        imgTxSettled = true;
        LoadingManager.hideGlobal(true);
        ErrorHandler.showError('STORAGE', 'Không lưu được ảnh vào máy. Kiểm tra dung lượng bộ nhớ rồi thử lại.', imgTx.error);
        resolve();
      };
      imgTx.onerror = imgTxFail;
      imgTx.onabort = imgTxFail;
    });
  });
}
function _readFileAsDataURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target && e.target.result);
    reader.onerror = () => resolve(null);
    try { reader.readAsDataURL(file); } catch (e) { resolve(null); }
  });
}

function handleFileUpload(input, mode) {
  const files = input.files;
  if (!files || !files.length) return;

  // SNAPSHOT đối tượng đích NGAY LÚC CHỌN FILE, TRƯỚC readAsDataURL: FileReader
  // đọc bất đồng bộ, nếu để saveImageToDB tự đọc global sau đó thì user kịp
  // chuyển hồ sơ/TSBĐ giữa chừng và ảnh bị gán nhầm đối tượng mới.
  const uploadCustomerId = currentCustomerId;
  const uploadAssetId = currentAssetId;
  const uploadMode = mode || "profile";

  // Ghi chế độ ảnh (profile = hồ sơ / asset = tài sản)
  captureMode = uploadMode;

  const list = Array.from(files);
  // Reset input để lần sau chọn lại vẫn trigger onchange
  input.value = "";

  if (!uploadCustomerId) {
    try { ErrorHandler.showWarning("Chưa mở hồ sơ khách hàng nên chưa lưu được ảnh."); } catch (e) { }
    return;
  }

  // Hàng đợi TUẦN TỰ: mỗi ảnh là FileReader + compress (nhiều vòng canvas) +
  // mã hóa. Bắn cả chục lượt song song như trước làm máy yếu giật và tranh nhau
  // loader/gallery refresh dùng chung. Pool 1 giữ loader + toast đúng thứ tự.
  _mapPool(list, 1, async (file) => {
    const base64 = await _readFileAsDataURL(file);
    if (!base64) return;
    await saveImageToDB(base64, {
      customerId: uploadCustomerId,
      assetId: uploadAssetId,
      captureMode: uploadMode,
    });
  });
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
let __deleteOpenedImageInFlight = false;
async function deleteOpenedImage() {
  if (__deleteOpenedImageInFlight) return;
  // Snapshot ID trước confirm — không đọc lại global sau await.
  const imageId = currentImageId;
  if (!imageId) return;
  if (!(await ErrorHandler.confirm("Xóa ảnh này?", { title: "Xóa ảnh", danger: true, confirmText: "Xóa" }))) return;
  if (__deleteOpenedImageInFlight) return;
  __deleteOpenedImageInFlight = true;
  try {
    const tx = db.transaction(["images"], "readwrite");
    tx.objectStore("images").delete(imageId);
    await __imgTxDone(tx);
    // Chỉ đóng lightbox + refresh gallery SAU khi transaction commit.
    closeLightbox();
    if (
      currentAssetId &&
      getEl("screen-asset-gallery").classList.contains("translate-x-full") ===
      false
    )
      loadAssetImages(currentAssetId);
    else loadProfileImages();
  } catch (err) {
    ErrorHandler.showError('STORAGE', 'Xóa ảnh thất bại — dữ liệu CHƯA thay đổi. Vui lòng thử lại.', err);
  } finally {
    __deleteOpenedImageInFlight = false;
  }
}

// Export for lazy loading wrapper
window._tryOpenCameraReal = _tryOpenCameraReal;

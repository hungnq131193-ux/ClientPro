// assets/pdf-toolkit/pdf_toolkit_core.js
// ============================================================================
// PDF Toolkit — LÕI (runtime, phụ thuộc trình duyệt nhưng KHÔNG đụng DOM app cũ).
//
// Trách nhiệm:
//   - Lazy-load vendor self-host (pdf-lib, pdf.js + worker, JSZip) đúng MỘT lần,
//     chống concurrent load, báo lỗi tải asset.
//   - Object URL registry (revoke toàn bộ khi đóng/cleanup).
//   - Canvas cleanup, tải file, Web Share, đóng gói ZIP.
//   - Trừu tượng đọc/validate PDF & ảnh (signature + MIME + mật khẩu + hỏng).
//
// Tất cả gom vào namespace NỘI BỘ window.__PdfTK (không phải API public).
// KHÔNG log nội dung file / tên file ra console hay ErrorHandler.
// ============================================================================
(function () {
  'use strict';

  const U = window.PdfToolkitUtils;
  // Cache-buster: đọc từ chính thẻ script để mọi asset toolkit cùng version.
  function assetVersion() {
    try {
      const cur = document.currentScript && document.currentScript.src;
      const m = (cur || '').match(/[?&]v=([^&]+)/);
      if (m) return m[1];
    } catch (e) {}
    return '';
  }
  const ASSET_V = assetVersion();
  const VQ = ASSET_V ? ('?v=' + ASSET_V) : '';
  const VENDOR = './assets/vendor/';
  // URL tuyệt đối theo BASE của tài liệu. Bắt buộc cho dynamic import() và worker:
  // import() phân giải theo URL của SCRIPT gọi (assets/pdf-toolkit/) chứ không
  // theo base tài liệu, nên đường dẫn tương đối sẽ sai. Dùng document.baseURI.
  function abs(rel) {
    try { return new URL(rel, document.baseURI).href; } catch (e) { return rel; }
  }

  // ----------------------------------------------------------------------
  // LAZY LOADER — vendor tải khi mở toolkit lần đầu, không lúc khởi động app.
  // ----------------------------------------------------------------------
  let _loadPromise = null;
  const vendor = { PDFLib: null, JSZip: null, pdfjsLib: null };

  function loadClassicScript(file) {
    return new Promise((resolve, reject) => {
      const url = VENDOR + file + VQ;
      const existing = document.querySelector('script[data-pdftk="' + file + '"]');
      if (existing && existing.getAttribute('data-loaded') === '1') return resolve();
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('asset')), { once: true });
        return;
      }
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.setAttribute('data-pdftk', file);
      s.addEventListener('load', () => { s.setAttribute('data-loaded', '1'); resolve(); }, { once: true });
      s.addEventListener('error', () => reject(new Error('asset')), { once: true });
      document.head.appendChild(s);
    });
  }

  async function loadPdfJs() {
    // ESM: dynamic import same-origin (CSP script-src 'self' cho phép).
    // URL tuyệt đối theo base tài liệu (xem abs()).
    const mod = await import(abs(VENDOR + 'pdf.min.mjs' + VQ));
    const lib = mod && (mod.getDocument ? mod : (mod.default || mod));
    if (!lib || !lib.getDocument) throw new Error('asset');
    // Worker local (worker-src 'self' blob: cho phép module worker same-origin).
    try {
      lib.GlobalWorkerOptions.workerSrc = abs(VENDOR + 'pdf.worker.min.mjs' + VQ);
    } catch (e) {}
    return lib;
  }

  // Tải toàn bộ vendor cần thiết. Chống concurrent: dùng chung một promise.
  function ensureVendor() {
    if (vendor.PDFLib && vendor.JSZip && vendor.pdfjsLib) return Promise.resolve(vendor);
    if (_loadPromise) return _loadPromise;
    _loadPromise = (async () => {
      await Promise.all([
        loadClassicScript('pdf-lib.min.js').then(() => { vendor.PDFLib = window.PDFLib; }),
        loadClassicScript('jszip.min.js').then(() => { vendor.JSZip = window.JSZip; }),
        loadPdfJs().then((lib) => { vendor.pdfjsLib = lib; }),
      ]);
      if (!vendor.PDFLib || !vendor.JSZip || !vendor.pdfjsLib) throw new Error('asset');
      return vendor;
    })();
    _loadPromise.catch(() => { _loadPromise = null; }); // cho phép thử lại nếu tải fail
    return _loadPromise;
  }

  // ----------------------------------------------------------------------
  // OBJECT URL REGISTRY — revoke toàn bộ khi cleanup để không rò rỉ bộ nhớ.
  // ----------------------------------------------------------------------
  const _objectUrls = new Set();
  function createObjectURL(blob) {
    const url = URL.createObjectURL(blob);
    _objectUrls.add(url);
    return url;
  }
  function revokeObjectURL(url) {
    if (!url) return;
    try { URL.revokeObjectURL(url); } catch (e) {}
    _objectUrls.delete(url);
  }
  function revokeAllObjectURLs() {
    for (const url of _objectUrls) { try { URL.revokeObjectURL(url); } catch (e) {} }
    _objectUrls.clear();
  }

  // ----------------------------------------------------------------------
  // CANVAS CLEANUP — giải phóng canvas lớn (đặt width/height = 0).
  // ----------------------------------------------------------------------
  function releaseCanvas(canvas) {
    if (!canvas) return;
    try {
      const ctx = canvas.getContext && canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    } catch (e) {}
    try { canvas.width = 0; canvas.height = 0; } catch (e) {}
  }

  // ----------------------------------------------------------------------
  // ĐỌC FILE -> Uint8Array (không giữ tham chiếu ngoài phạm vi gọi).
  // ----------------------------------------------------------------------
  async function readFileBytes(file) {
    const buf = await file.arrayBuffer();
    return new Uint8Array(buf);
  }
  // Bản sao để đưa cho pdf.js (nó có thể detach/transfer buffer gốc).
  function copyBytes(u8) { return u8 ? u8.slice(0) : u8; }

  // ----------------------------------------------------------------------
  // VALIDATE PDF: signature + rỗng + mật khẩu + hỏng. Không tin đuôi file.
  //   Trả { ok, bytes, error }. error là chuỗi tiếng Việt (không kèm tên file).
  // ----------------------------------------------------------------------
  const MSG = {
    invalidPdf: 'File PDF không hợp lệ hoặc đã bị hỏng.',
    empty: 'File rỗng, không có dữ liệu.',
    password: 'File PDF được bảo vệ bằng mật khẩu và chưa được hỗ trợ.',
    tooBig: 'File quá lớn để xử lý an toàn trên thiết bị này.',
    memory: 'Thiết bị không đủ bộ nhớ để xử lý tài liệu này. Hãy thử chia nhỏ file hoặc giảm số trang.',
    outputFail: 'Không thể tạo file kết quả. Dữ liệu gốc không bị thay đổi.',
    badImage: 'Ảnh không hợp lệ hoặc đã bị hỏng.',
    imageTooLarge: 'Ảnh có độ phân giải quá lớn để xử lý.',
  };

  async function validatePdfFile(file) {
    try {
      if (!file || file.size === 0) return { ok: false, error: MSG.empty };
      const bytes = await readFileBytes(file);
      if (!bytes || bytes.length === 0) return { ok: false, error: MSG.empty };
      if (!U.isPdfBytes(bytes)) return { ok: false, error: MSG.invalidPdf };
      return { ok: true, bytes: bytes, error: null };
    } catch (e) {
      return { ok: false, error: MSG.invalidPdf };
    }
  }

  // Nhận diện lỗi mật khẩu từ pdf.js / pdf-lib.
  function isPasswordError(err) {
    if (!err) return false;
    const name = (err.name || '') + '';
    const msg = (err.message || '') + '';
    return name === 'PasswordException' || /password|encrypt/i.test(msg) || err.code === 1 || err.code === 2;
  }

  // ----------------------------------------------------------------------
  // ĐỌC METADATA PDF (số trang + phát hiện mật khẩu) qua pdf-lib.
  //   Không raster hóa. Trả { pages, error }.
  // ----------------------------------------------------------------------
  async function readPdfMeta(bytes) {
    await ensureVendor();
    try {
      const doc = await vendor.PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
      return { pages: doc.getPageCount(), error: null };
    } catch (e) {
      if (isPasswordError(e) || (e && /encrypted/i.test(String(e.message || e)))) {
        return { pages: 0, error: MSG.password };
      }
      return { pages: 0, error: MSG.invalidPdf };
    }
  }

  // Nạp PDFDocument (pdf-lib) để ghép/tách/xoay/sắp xếp.
  async function loadPdfLibDoc(bytes) {
    await ensureVendor();
    try {
      return await vendor.PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
    } catch (e) {
      if (isPasswordError(e) || /encrypted/i.test(String(e && e.message))) { const err = new Error(MSG.password); err.friendly = MSG.password; throw err; }
      const err = new Error(MSG.invalidPdf); err.friendly = MSG.invalidPdf; throw err;
    }
  }

  // Nạp document pdf.js để render thumbnail / PDF->ảnh.
  //   Trả loadingTask+doc; caller PHẢI gọi doc.destroy() khi xong.
  async function loadPdfJsDoc(bytes) {
    await ensureVendor();
    const task = vendor.pdfjsLib.getDocument({
      data: copyBytes(bytes),
      // Không tải tài nguyên chuẩn từ mạng — mọi thứ phải local/offline.
      isEvalSupported: false,
      disableAutoFetch: true,
      disableStream: true,
    });
    // Không cấp onPassword -> file có mật khẩu sẽ reject với PasswordException.
    try {
      const doc = await task.promise;
      return doc;
    } catch (e) {
      try { task.destroy(); } catch (_) {}
      if (isPasswordError(e)) { const err = new Error(MSG.password); err.friendly = MSG.password; throw err; }
      const err = new Error(MSG.invalidPdf); err.friendly = MSG.invalidPdf; throw err;
    }
  }

  // ----------------------------------------------------------------------
  // TẢI FILE KẾT QUẢ (Blob) — <a download>, revoke sau khi click.
  // ----------------------------------------------------------------------
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'tai-lieu';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      // Revoke trễ một nhịp để trình duyệt kịp bắt đầu tải.
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 1500);
    }
  }

  // ----------------------------------------------------------------------
  // WEB SHARE (chia sẻ file) — chỉ khi trình duyệt hỗ trợ chia sẻ file.
  // ----------------------------------------------------------------------
  function canShareFiles() {
    try {
      if (!navigator.canShare || !navigator.share) return false;
      const probe = new File([new Uint8Array([1])], 'probe.pdf', { type: 'application/pdf' });
      return navigator.canShare({ files: [probe] });
    } catch (e) { return false; }
  }
  async function shareFile(blob, filename, title) {
    try {
      const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      if (!navigator.canShare || !navigator.canShare({ files: [file] })) return false;
      await navigator.share({ files: [file], title: title || filename });
      return true;
    } catch (e) {
      // Người dùng hủy chia sẻ (AbortError) => không coi là lỗi.
      return false;
    }
  }

  // ----------------------------------------------------------------------
  // ĐÓNG GÓI ZIP nhiều file kết quả.
  //   entries: [{ name, blob }]. Trả Blob (application/zip).
  // ----------------------------------------------------------------------
  async function makeZip(entries, onProgress, cancelToken) {
    await ensureVendor();
    const zip = new vendor.JSZip();
    const usedNames = new Set();
    for (const e of entries) {
      if (cancelToken) cancelToken.throwIfCancelled();
      let name = e.name || 'file';
      // Chống trùng tên trong zip.
      let unique = name; let i = 2;
      while (usedNames.has(unique)) {
        const dot = name.lastIndexOf('.');
        unique = dot > 0 ? (name.slice(0, dot) + '-' + i + name.slice(dot)) : (name + '-' + i);
        i++;
      }
      usedNames.add(unique);
      const buf = await e.blob.arrayBuffer();
      zip.file(unique, buf);
    }
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      (meta) => { if (typeof onProgress === 'function') onProgress(meta.percent / 100); });
  }

  // ----------------------------------------------------------------------
  // YIELD về event loop giữa các bước nặng (giữ UI phản hồi, tránh treo).
  // ----------------------------------------------------------------------
  function yieldToEventLoop() {
    return new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0));
      else setTimeout(resolve, 0);
    });
  }

  // ----------------------------------------------------------------------
  // Đăng ký tool (mỗi module tool tự gọi). UI đọc registry khi render.
  // ----------------------------------------------------------------------
  const _tools = [];
  function registerTool(def) { if (def && def.id) _tools.push(def); }
  function getTools() { return _tools.slice(); }

  window.__PdfTK = {
    U,
    MSG,
    VENDOR, VQ,
    ensureVendor,
    vendor,
    createObjectURL, revokeObjectURL, revokeAllObjectURLs,
    releaseCanvas,
    readFileBytes, copyBytes,
    validatePdfFile, isPasswordError,
    readPdfMeta, loadPdfLibDoc, loadPdfJsDoc,
    downloadBlob, canShareFiles, shareFile,
    makeZip,
    yieldToEventLoop,
    registerTool, getTools,
  };
})();

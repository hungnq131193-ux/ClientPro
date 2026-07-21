// assets/pdf-toolkit/pdf_toolkit_utils.js
// ============================================================================
// PDF Toolkit — HÀM THUẦN (pure helpers), KHÔNG phụ thuộc DOM / vendor.
// Tách riêng để unit-test được trong Node (node --test) mà không cần trình duyệt.
//
// Toàn bộ hàm ở đây:
//   - Không side-effect ra ngoài (trừ closure state của undo-stack / cancel-token).
//   - Không log nội dung file, không đụng IndexedDB/localStorage.
//   - Thông báo lỗi tiếng Việt, không bao giờ throw với chuỗi bất thường.
//
// Phơi ra:
//   - Trình duyệt : window.PdfToolkitUtils
//   - Node (test) : module.exports  (guard typeof module — vô hại trên trình duyệt)
// ============================================================================
(function (root, factory) {
  'use strict';
  const api = factory();
  // Trình duyệt: gắn vào namespace phụ (không phải window.PdfToolkit "public").
  if (root) root.PdfToolkitUtils = api;
  // Node test harness.
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // ----------------------------------------------------------------------
  // GIỚI HẠN & CẢNH BÁO tập trung (điều chỉnh sau khi kiểm thử thực tế).
  // ----------------------------------------------------------------------
  const PDF_TOOLKIT_LIMITS = {
    maxFiles: 30,
    warnTotalBytes: 30 * 1024 * 1024,   // 30 MB — cảnh báo
    hardTotalBytes: 100 * 1024 * 1024,  // 100 MB — chặn
    warnPages: 150,
    hardPages: 500,
    maxImagePixels: 24000000,           // 24 MP mỗi ảnh
  };

  // ----------------------------------------------------------------------
  // Định dạng dung lượng (bản thuần, không phụ thuộc formatBytes toàn cục).
  // ----------------------------------------------------------------------
  function formatBytes(bytes) {
    const n = Number(bytes);
    if (!isFinite(n) || n < 0) return '—';
    if (n === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
    return v.toFixed(i === 0 ? 0 : (v >= 100 ? 0 : (v >= 10 ? 1 : 2))) + ' ' + units[i];
  }

  // ----------------------------------------------------------------------
  // PARSER KHOẢNG TRANG
  //   Ví dụ hợp lệ: "1-5", "1,3,7", " 1-3, 8 ,10-12"
  //   Trả về { pages: number[] (1-based, đã dedupe, theo thứ tự nhập), error }
  //   Quy tắc:
  //     - Loại mọi khoảng trắng.
  //     - Không chấp nhận 0, số âm, số vượt totalPages.
  //     - Khoảng a-b yêu cầu a<=b (đảo ngược => lỗi).
  //     - Chuỗi rỗng / token lạ => lỗi tiếng Việt.
  //     - Không crash với chuỗi bất thường.
  // ----------------------------------------------------------------------
  const ERR_RANGE = 'Khoảng trang không hợp lệ.';

  function parsePageRange(input, totalPages) {
    const total = Number(totalPages);
    if (!Number.isInteger(total) || total < 1) {
      return { pages: [], error: 'Tài liệu chưa có trang nào.' };
    }
    const raw = String(input == null ? '' : input).replace(/\s+/g, '');
    if (!raw) return { pages: [], error: 'Vui lòng nhập khoảng trang cần trích xuất.' };
    // Chỉ cho phép chữ số, dấu phẩy và gạch nối.
    if (!/^[0-9,\-]+$/.test(raw)) return { pages: [], error: ERR_RANGE };

    const seen = new Set();
    const pages = [];
    const tokens = raw.split(',');
    for (const token of tokens) {
      if (token === '') return { pages: [], error: ERR_RANGE };
      if (token.indexOf('-') === -1) {
        // Số đơn.
        if (!/^[0-9]+$/.test(token)) return { pages: [], error: ERR_RANGE };
        const n = Number(token);
        if (!Number.isInteger(n) || n < 1) return { pages: [], error: 'Số trang phải từ 1 trở lên.' };
        if (n > total) return { pages: [], error: 'Trang ' + n + ' vượt quá tổng số trang (' + total + ').' };
        if (!seen.has(n)) { seen.add(n); pages.push(n); }
        continue;
      }
      // Khoảng a-b.
      const m = token.match(/^([0-9]+)-([0-9]+)$/);
      if (!m) return { pages: [], error: ERR_RANGE };
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (a < 1 || b < 1) return { pages: [], error: 'Số trang phải từ 1 trở lên.' };
      if (a > b) return { pages: [], error: 'Khoảng trang phải theo thứ tự tăng dần (ví dụ 3-8).' };
      if (b > total) return { pages: [], error: 'Trang ' + b + ' vượt quá tổng số trang (' + total + ').' };
      for (let n = a; n <= b; n++) {
        if (!seen.has(n)) { seen.add(n); pages.push(n); }
      }
    }
    if (!pages.length) return { pages: [], error: ERR_RANGE };
    return { pages: pages, error: null };
  }

  // Bỏ trùng, giữ thứ tự xuất hiện đầu tiên.
  function dedupePages(arr) {
    const seen = new Set();
    const out = [];
    for (const x of (Array.isArray(arr) ? arr : [])) {
      const n = Number(x);
      if (!Number.isFinite(n)) continue;
      if (!seen.has(n)) { seen.add(n); out.push(n); }
    }
    return out;
  }

  // ----------------------------------------------------------------------
  // TÊN FILE AN TOÀN
  //   - Loại ký tự không hợp lệ / điều khiển / đường dẫn giả (../, /, \).
  //   - Không cho chuỗi rỗng => dùng tên mặc định.
  //   - Tự thêm đuôi (.pdf/.zip...) đúng MỘT lần (không nhân đôi).
  // ----------------------------------------------------------------------
  function safeFileName(name, ext, fallback) {
    let base = String(name == null ? '' : name);
    // Loại đường dẫn: chỉ giữ phần sau dấu / hoặc \.
    base = base.replace(/^.*[\\/]/, '');
    // Loại ký tự điều khiển và ký tự cấm trên FS phổ biến.
    base = base.replace(/[\x00-\x1f\x7f]/g, '');
    base = base.replace(/[<>:"/\\|?*]/g, ' ');
    // Gộp khoảng trắng, cắt đầu/cuối, bỏ dấu chấm/space thừa ở hai đầu.
    base = base.replace(/\s+/g, ' ').trim().replace(/^[.\s]+|[.\s]+$/g, '');

    let dotExt = '';
    if (ext) dotExt = ext.charAt(0) === '.' ? ext.toLowerCase() : ('.' + ext.toLowerCase());

    // Nếu base đã kết thúc bằng đúng đuôi cần dùng thì bỏ đi để không nhân đôi.
    if (dotExt && base.toLowerCase().endsWith(dotExt)) {
      base = base.slice(0, base.length - dotExt.length).replace(/[.\s]+$/g, '');
    }
    if (!base) base = String(fallback || 'tai-lieu');
    // Giới hạn độ dài hợp lý.
    if (base.length > 120) base = base.slice(0, 120).trim();
    return base + dotExt;
  }

  // ----------------------------------------------------------------------
  // NHẬN DIỆN ĐỊNH DẠNG QUA FILE SIGNATURE (magic bytes) — không tin đuôi file.
  //   bytes: Uint8Array (hoặc mảng số). Trả 'pdf'|'jpeg'|'png'|'webp'|null.
  // ----------------------------------------------------------------------
  function _at(bytes, i) { return bytes && i < bytes.length ? (bytes[i] & 0xff) : -1; }

  function detectFileKind(bytes) {
    if (!bytes || bytes.length < 4) return null;
    // PDF: cho phép tối đa vài byte rác/BOM ở đầu, tìm "%PDF-" trong 1KB đầu.
    const scan = Math.min(bytes.length, 1024);
    for (let i = 0; i <= scan - 5; i++) {
      if (_at(bytes, i) === 0x25 && _at(bytes, i + 1) === 0x50 &&
          _at(bytes, i + 2) === 0x44 && _at(bytes, i + 3) === 0x46 &&
          _at(bytes, i + 4) === 0x2d) {
        // Chỉ chấp nhận nếu ở ngay đầu (offset nhỏ) — tránh nhận nhầm PDF nhúng.
        if (i <= 16) return 'pdf';
      }
    }
    // JPEG: FF D8 FF
    if (_at(bytes, 0) === 0xff && _at(bytes, 1) === 0xd8 && _at(bytes, 2) === 0xff) return 'jpeg';
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (_at(bytes, 0) === 0x89 && _at(bytes, 1) === 0x50 && _at(bytes, 2) === 0x4e &&
        _at(bytes, 3) === 0x47 && _at(bytes, 4) === 0x0d && _at(bytes, 5) === 0x0a &&
        _at(bytes, 6) === 0x1a && _at(bytes, 7) === 0x0a) return 'png';
    // WEBP: "RIFF"...."WEBP"
    if (_at(bytes, 0) === 0x52 && _at(bytes, 1) === 0x49 && _at(bytes, 2) === 0x46 && _at(bytes, 3) === 0x46 &&
        _at(bytes, 8) === 0x57 && _at(bytes, 9) === 0x45 && _at(bytes, 10) === 0x42 && _at(bytes, 11) === 0x50) return 'webp';
    return null;
  }

  function isPdfBytes(bytes) { return detectFileKind(bytes) === 'pdf'; }
  function isImageKind(kind) { return kind === 'jpeg' || kind === 'png' || kind === 'webp'; }

  // MIME hợp lệ cho ảnh đầu vào.
  const IMAGE_MIME = { 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
  function imageMimeToKind(mime) {
    if (!mime) return null;
    return IMAGE_MIME[String(mime).toLowerCase()] || null;
  }

  // ----------------------------------------------------------------------
  // XOAY TRANG — chuẩn hóa về 0/90/180/270.
  // ----------------------------------------------------------------------
  function normalizeRotation(deg) {
    let d = Number(deg) || 0;
    d = ((d % 360) + 360) % 360;
    // Ép về bội số 90 gần nhất.
    return (Math.round(d / 90) * 90) % 360;
  }
  function rotateBy(current, delta) {
    return normalizeRotation(normalizeRotation(current) + normalizeRotation(delta));
  }

  // ----------------------------------------------------------------------
  // DI CHUYỂN PHẦN TỬ trong mảng (reorder) — trả mảng MỚI, không đột biến.
  //   dir < 0: lên; dir > 0: xuống.
  // ----------------------------------------------------------------------
  function moveItem(list, index, dir) {
    const arr = Array.isArray(list) ? list.slice() : [];
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= arr.length) return arr;
    const j = i + (dir < 0 ? -1 : 1);
    if (j < 0 || j >= arr.length) return arr;
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    return arr;
  }

  // ----------------------------------------------------------------------
  // UNDO STACK giới hạn — lưu snapshot (deep clone qua JSON).
  // ----------------------------------------------------------------------
  function createUndoStack(limit) {
    const max = Number(limit) > 0 ? Number(limit) : 20;
    let stack = [];
    return {
      push(snapshot) {
        try { stack.push(JSON.parse(JSON.stringify(snapshot))); }
        catch (e) { return; }
        if (stack.length > max) stack.shift();
      },
      pop() { return stack.length ? stack.pop() : null; },
      get size() { return stack.length; },
      canUndo() { return stack.length > 0; },
      clear() { stack = []; },
    };
  }

  // ----------------------------------------------------------------------
  // CANCELLATION TOKEN — dùng chung cho mọi tác vụ dài.
  // ----------------------------------------------------------------------
  function createCancelToken() {
    let cancelled = false;
    const listeners = [];
    return {
      get cancelled() { return cancelled; },
      cancel() {
        if (cancelled) return;
        cancelled = true;
        for (const fn of listeners.splice(0)) { try { fn(); } catch (e) {} }
      },
      onCancel(fn) { if (typeof fn === 'function') { if (cancelled) fn(); else listeners.push(fn); } },
      throwIfCancelled() { if (cancelled) { const e = new Error('CANCELLED'); e.code = 'CANCELLED'; throw e; } },
    };
  }
  function isCancel(err) { return !!(err && (err.code === 'CANCELLED' || err.message === 'CANCELLED')); }

  // ----------------------------------------------------------------------
  // PRESET NÉN / CHẤT LƯỢNG.
  //   Chế độ B (nén scan): render trang -> ảnh JPEG. Trả {scale, quality}.
  //   PDF->ảnh (độ phân giải): 'save'|'balanced'|'sharp'.
  // ----------------------------------------------------------------------
  function compressionPreset(level) {
    switch (String(level)) {
      case 'high': return { scale: 2.0, quality: 0.82, label: 'Chất lượng cao' };
      case 'small': return { scale: 1.0, quality: 0.5, label: 'Dung lượng nhỏ' };
      case 'balanced':
      default: return { scale: 1.5, quality: 0.68, label: 'Cân bằng' };
    }
  }
  function renderResolutionPreset(level) {
    switch (String(level)) {
      case 'save': return { scale: 1.0, label: 'Tiết kiệm' };
      case 'sharp': return { scale: 2.5, label: 'Rõ nét' };
      case 'balanced':
      default: return { scale: 1.6, label: 'Cân bằng' };
    }
  }

  // ----------------------------------------------------------------------
  // TÊN ẢNH ĐẦU RA cho PDF->ảnh: "[base]_trang_001.jpg" (pad theo tổng số trang).
  // ----------------------------------------------------------------------
  function imageOutputName(base, pageNum, ext, totalPages) {
    const safeBase = safeFileName(base || 'tai-lieu', '').replace(/\.(pdf|zip)$/i, '') || 'tai-lieu';
    const total = Number(totalPages) > 0 ? Number(totalPages) : 1;
    const width = Math.max(3, String(total).length);
    const num = String(Math.max(1, Number(pageNum) || 1)).padStart(width, '0');
    let dotExt = ext ? (ext.charAt(0) === '.' ? ext.toLowerCase() : '.' + ext.toLowerCase()) : '.jpg';
    if (dotExt === '.jpeg') dotExt = '.jpg';
    return safeBase + '_trang_' + num + dotExt;
  }

  // ----------------------------------------------------------------------
  // SO SÁNH DUNG LƯỢNG sau nén — không báo sai kết quả.
  //   Trả { savedBytes, percent, notSmaller } — notSmaller nếu giảm < 3%.
  // ----------------------------------------------------------------------
  function computeReduction(originalBytes, resultBytes) {
    const o = Math.max(0, Number(originalBytes) || 0);
    const r = Math.max(0, Number(resultBytes) || 0);
    const saved = o - r;
    const percent = o > 0 ? (saved / o) * 100 : 0;
    return {
      originalBytes: o,
      resultBytes: r,
      savedBytes: saved,
      percent: percent,
      // "Không giảm đáng kể" khi tiết kiệm dưới 3% hoặc file to hơn/bằng.
      notSmaller: saved <= 0 || percent < 3,
    };
  }

  // ----------------------------------------------------------------------
  // PAGE SIZE / MARGIN preset cho Ảnh->PDF (đơn vị điểm PDF: 1pt = 1/72 inch).
  // ----------------------------------------------------------------------
  const A4 = { width: 595.28, height: 841.89 };
  function marginPreset(name) {
    switch (String(name)) {
      case 'none': return 0;
      case 'small': return 18;   // ~6.35mm
      case 'medium': return 40;  // ~14mm
      default: return 0;
    }
  }

  return {
    PDF_TOOLKIT_LIMITS,
    formatBytes,
    parsePageRange,
    dedupePages,
    safeFileName,
    detectFileKind,
    isPdfBytes,
    isImageKind,
    imageMimeToKind,
    normalizeRotation,
    rotateBy,
    moveItem,
    createUndoStack,
    createCancelToken,
    isCancel,
    compressionPreset,
    renderResolutionPreset,
    imageOutputName,
    computeReduction,
    marginPreset,
    A4,
  };
});

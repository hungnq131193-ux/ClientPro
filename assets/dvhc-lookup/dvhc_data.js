// assets/dvhc-lookup/dvhc_data.js
// ============================================================================
// DVHC Lookup — NẠP DỮ LIỆU + GÓI THÔN/TDP.
//
// - Dữ liệu chính: assets/data/dvhc/dvhc.v1.json, fetch same-origin MỘT lần
//   (lazy, khi người dùng mở tool) và cache promise; Service Worker precache
//   nên hoạt động cả khi offline. KHÔNG gọi bất kỳ API ngoài nào.
// - Gói thôn/tổ dân phố theo tỉnh (đợt sắp xếp 2026): người dùng tự nạp file
//   JSON (schema "dvhc-pack@1", xem dvhc_utils.js). Gói lưu localStorage key
//   `clientpro_dvhc_pack` — CHỈ dữ liệu hành chính công khai, không dữ liệu
//   khách hàng, không thông tin nhạy cảm.
//
// Namespace NỘI BỘ: window.__DvhcData (không phải public API).
// ============================================================================
(function () {
  'use strict';

  const U = window.DvhcUtils;

  // Cache-buster: ưu tiên version do LazyModules truyền (script inject động
  // không có document.currentScript đáng tin), fallback đọc từ thẻ script.
  function assetVersion() {
    try {
      if (window.__CLIENTPRO_LAZY_V) return String(window.__CLIENTPRO_LAZY_V);
    } catch (e) {}
    try {
      const cur = document.currentScript && document.currentScript.src;
      const m = (cur || '').match(/[?&]v=([^&]+)/);
      if (m) return m[1];
    } catch (e) {}
    return '';
  }
  const VQ = (function () {
    const v = assetVersion();
    return v ? ('?v=' + v) : '';
  })();

  const DATA_URL = './assets/data/dvhc/dvhc.v1.json';
  const PACK_STORAGE_KEY = 'clientpro_dvhc_pack';

  let _indexPromise = null;

  // Nạp + dựng chỉ mục (một lần). Trả Promise<index>; throw Error tiếng Việt.
  function loadIndex() {
    if (_indexPromise) return _indexPromise;
    _indexPromise = (async () => {
      let res;
      try {
        res = await fetch(DATA_URL + VQ);
      } catch (e) {
        throw new Error('Không tải được dữ liệu tra cứu. Kiểm tra kết nối rồi thử lại.');
      }
      if (!res || !res.ok) {
        throw new Error('Không tải được dữ liệu tra cứu (' + (res ? res.status : '?') + ').');
      }
      let json;
      try {
        json = await res.json();
      } catch (e) {
        throw new Error('Dữ liệu tra cứu bị hỏng. Hãy cập nhật ứng dụng.');
      }
      const index = U.buildIndex(json);
      if (index.error) throw new Error(index.error);
      return index;
    })();
    // Cho phép thử lại nếu lần nạp đầu thất bại (mất mạng trước khi SW cache).
    _indexPromise.catch(() => { _indexPromise = null; });
    return _indexPromise;
  }

  // ----------------------------------------------------------------------
  // Gói thôn/TDP trong localStorage (một gói duy nhất — theo tỉnh người dùng).
  // ----------------------------------------------------------------------
  // Gói được phép tới 4 MB / 50.000 dòng và MỖI thẻ kết quả đều hỏi gói —
  // parse + validate lại chuỗi thô cho từng thẻ sẽ treo main thread sau mỗi
  // lần gõ. Cache theo chính chuỗi thô: đọc localStorage vẫn rẻ, còn phần đắt
  // (JSON.parse + validate + dựng chỉ mục) chỉ chạy khi gói thật sự đổi —
  // kể cả khi gói bị thay ở tab/phiên khác.
  let _cache = null; // { raw, pack, index }

  function _ensureCache() {
    let raw = null;
    try {
      raw = localStorage.getItem(PACK_STORAGE_KEY);
    } catch (e) {
      _cache = null;
      return null;
    }
    if (!raw) {
      _cache = null;
      return null;
    }
    if (_cache && _cache.raw === raw) return _cache;
    try {
      const v = U.validatePack(JSON.parse(raw));
      if (!v.ok) { _cache = null; return null; }
      _cache = { raw, pack: v.pack, index: U.buildPackIndex(v.pack) };
      return _cache;
    } catch (e) {
      _cache = null;
      return null;
    }
  }

  function getPack() {
    const c = _ensureCache();
    return c ? c.pack : null;
  }

  // Chỉ mục tra thôn/TDP theo tên xã mới (O(1)) — dùng cho đường nóng render.
  function getPackIndex() {
    const c = _ensureCache();
    return c ? c.index : null;
  }

  // Lưu gói đã validate. Trả { ok } | { ok:false, error }.
  function setPack(pack) {
    try {
      localStorage.setItem(PACK_STORAGE_KEY, JSON.stringify(pack));
      _cache = null;
      return { ok: true };
    } catch (e) {
      _cache = null;
      return { ok: false, error: 'Không lưu được gói (bộ nhớ đầy?). Hãy dùng gói nhỏ hơn.' };
    }
  }

  function clearPack() {
    _cache = null;
    try { localStorage.removeItem(PACK_STORAGE_KEY); } catch (e) {}
  }

  // Đọc + validate một File JSON người dùng chọn. Trả Promise<{ok, pack?, error?}>.
  const PACK_MAX_BYTES = 4 * 1024 * 1024;
  function readPackFile(file) {
    return new Promise((resolve) => {
      if (!file) return resolve({ ok: false, error: 'Chưa chọn file.' });
      if (file.size > PACK_MAX_BYTES) {
        return resolve({ ok: false, error: 'File gói quá lớn (tối đa 4 MB).' });
      }
      const reader = new FileReader();
      reader.onerror = () => resolve({ ok: false, error: 'Không đọc được file.' });
      reader.onload = () => {
        try {
          const v = U.validatePack(JSON.parse(String(reader.result)));
          resolve(v.ok ? { ok: true, pack: v.pack } : { ok: false, error: v.error });
        } catch (e) {
          resolve({ ok: false, error: 'File không phải JSON hợp lệ.' });
        }
      };
      reader.readAsText(file);
    });
  }

  window.__DvhcData = { loadIndex, getPack, getPackIndex, setPack, clearPack, readPackFile, PACK_STORAGE_KEY };
})();

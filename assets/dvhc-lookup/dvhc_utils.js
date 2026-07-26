// assets/dvhc-lookup/dvhc_utils.js
// ============================================================================
// DVHC Lookup — HÀM THUẦN (pure helpers), KHÔNG phụ thuộc DOM / network.
// Tách riêng để unit-test được trong Node (node --test) mà không cần trình duyệt.
//
// Toàn bộ hàm ở đây:
//   - Không side-effect, không đụng IndexedDB/localStorage/fetch.
//   - Làm việc trên dữ liệu đã nạp (schema xem assets/data/dvhc/README.md).
//   - Thông báo lỗi tiếng Việt, không crash với chuỗi bất thường.
//
// Phơi ra:
//   - Trình duyệt : window.DvhcUtils
//   - Node (test) : module.exports  (guard typeof module — vô hại trên trình duyệt)
// ============================================================================
(function (root, factory) {
  'use strict';
  const api = factory();
  if (root) root.DvhcUtils = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // ----------------------------------------------------------------------
  // Chuẩn hoá chuỗi tiếng Việt: bỏ dấu, thường hoá, gộp khoảng trắng.
  // ----------------------------------------------------------------------
  function stripDiacritics(input) {
    const s = String(input == null ? '' : input);
    return s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D');
  }

  function normalizeName(input) {
    return stripDiacritics(input)
      .toLowerCase()
      .replace(/[.,;:/\\]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Bỏ tiền tố loại đơn vị (đã chuẩn hoá không dấu) để so khớp lõi tên.
  //   level: 'ward' | 'district' | 'province'
  const UNIT_PREFIXES = {
    ward: ['xa', 'phuong', 'thi tran', 'dac khu', 'x.', 'p.', 'tt.'],
    district: ['quan', 'huyen', 'thi xa', 'thanh pho', 'q.', 'h.', 'tx.', 'tp.', 'tp'],
    province: ['tinh', 'thanh pho', 't.', 'tp.', 'tp'],
  };

  function stripUnitPrefix(normalized, level) {
    const prefixes = UNIT_PREFIXES[level] || [];
    let s = String(normalized == null ? '' : normalized).trim();
    for (const p of prefixes) {
      if (s === p) return '';
      if (s.startsWith(p + ' ')) return s.slice(p.length + 1).trim();
    }
    return s;
  }

  // ----------------------------------------------------------------------
  // Dựng chỉ mục tra cứu từ dữ liệu dvhc.v1.json (đã parse).
  // Trả về { data, records, wardRecords, oldProvinceList, error }.
  //   records[i] tương ứng data.map[i]:
  //     { oW, oD, oP, wIdx, pIdx, nW, nWCode, nP, k (chuỗi tìm kiếm chuẩn hoá) }
  // ----------------------------------------------------------------------
  function buildIndex(data) {
    if (!data || !Array.isArray(data.map) || !Array.isArray(data.wards) ||
        !Array.isArray(data.oldDistricts) || !Array.isArray(data.oldProvinces) ||
        !Array.isArray(data.provinces)) {
      return { error: 'Dữ liệu tra cứu không hợp lệ hoặc bị hỏng.' };
    }
    const records = [];
    const wardRecords = new Map(); // wIdx -> [recIdx,...] (tra ngược)
    for (let i = 0; i < data.map.length; i++) {
      const row = data.map[i];
      if (!Array.isArray(row) || row.length < 3) continue;
      const oW = String(row[0] || '');
      const dEntry = data.oldDistricts[row[1]];
      const wEntry = data.wards[row[2]];
      if (!dEntry || !wEntry) continue;
      const opEntry = data.oldProvinces[dEntry[1]];
      const pEntry = opEntry ? data.provinces[opEntry[1]] : null;
      if (!opEntry || !pEntry) continue;
      const rec = {
        oW,
        oD: dEntry[0],
        oP: opEntry[0],
        wIdx: row[2],
        pIdx: opEntry[1],
        nW: wEntry[1],
        nWCode: wEntry[0],
        nP: pEntry[1],
      };
      rec.kW = stripUnitPrefix(normalizeName(oW), 'ward');
      rec.kD = stripUnitPrefix(normalizeName(rec.oD), 'district');
      rec.kP = stripUnitPrefix(normalizeName(rec.oP), 'province');
      rec.k = normalizeName(oW + ' ' + rec.oD + ' ' + rec.oP);
      records.push(rec);
      const list = wardRecords.get(rec.wIdx);
      if (list) list.push(rec);
      else wardRecords.set(rec.wIdx, [rec]);
    }
    if (!records.length) return { error: 'Dữ liệu tra cứu rỗng.' };
    return { data, records, wardRecords };
  }

  // ----------------------------------------------------------------------
  // Tra xuôi: gõ tên xã/huyện/tỉnh CŨ (tự do, có thể phân tách bằng dấu phẩy).
  // Trả về mảng record (tối đa `limit`), xếp hạng khớp tốt trước.
  // ----------------------------------------------------------------------
  function searchOld(index, query, limit) {
    const max = limit > 0 ? limit : 30;
    if (!index || !index.records) return [];
    const q = normalizeName(query);
    if (!q) return [];
    // Tách phần theo dấu phẩy: "xã cũ, huyện cũ, tỉnh cũ"
    const parts = String(query).split(',').map((p) => normalizeName(p)).filter(Boolean);
    const first = parts.length ? parts[0] : q;
    const firstCore = stripUnitPrefix(first, 'ward');
    const rest = parts.slice(1).map((p) => ({
      d: stripUnitPrefix(p, 'district'),
      p: stripUnitPrefix(p, 'province'),
    }));
    const scored = [];
    for (const rec of index.records) {
      let score = 0;
      if (firstCore && rec.kW === firstCore) score = 400;
      else if (firstCore && rec.kW.startsWith(firstCore)) score = 300;
      else if (firstCore && rec.kW.includes(firstCore)) score = 200;
      else if (rec.k.includes(first)) score = 100;
      if (!score) continue;
      // Các phần sau dấu phẩy phải khớp huyện/tỉnh (lọc dần).
      let ok = true;
      for (const r of rest) {
        const matchD = r.d && (rec.kD.includes(r.d));
        const matchP = r.p && (rec.kP.includes(r.p));
        if (!matchD && !matchP) { ok = false; break; }
        score += 20;
      }
      if (!ok) continue;
      // Ưu tiên tên ngắn (khớp trọn vẹn hơn).
      score -= Math.min(rec.kW.length, 50) / 100;
      scored.push([score, rec]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    return scored.slice(0, max).map((s) => s[1]);
  }

  // ----------------------------------------------------------------------
  // Tra ngược: danh sách xã mới của 1 tỉnh mới (lọc theo query tuỳ chọn).
  // ----------------------------------------------------------------------
  function listWardsOfProvince(index, pIdx, query, limit) {
    if (!index || !index.data) return [];
    const max = limit > 0 ? limit : 400;
    const q = stripUnitPrefix(normalizeName(query || ''), 'ward');
    const out = [];
    const wards = index.data.wards;
    for (let wIdx = 0; wIdx < wards.length; wIdx++) {
      const w = wards[wIdx];
      if (w[2] !== pIdx) continue;
      if (q) {
        const core = stripUnitPrefix(normalizeName(w[1]), 'ward');
        if (!core.includes(q)) continue;
      }
      out.push({ wIdx, code: w[0], name: w[1] });
      if (out.length >= max) break;
    }
    return out;
  }

  // Tra ngược: các đơn vị cũ hợp thành 1 xã mới.
  function reverseLookup(index, wIdx) {
    if (!index || !index.wardRecords) return [];
    return index.wardRecords.get(wIdx) || [];
  }

  // ----------------------------------------------------------------------
  // Chuyển 1 dòng địa chỉ cũ → mới.
  // Nhận diện các thành phần ĐVHC ở CUỐI chuỗi (ngăn bằng dấu phẩy):
  //   "<chi tiết>, <xã cũ>, <huyện cũ>, <tỉnh cũ>"
  // Trả về:
  //   { ok:true, matches:[rec,...], prefix, newAddress } khi tìm được
  //   { ok:false, error } khi không nhận diện được
  // newAddress chỉ dựng khi khớp duy nhất 1 xã mới.
  // ----------------------------------------------------------------------
  function convertAddress(index, line) {
    const raw = String(line == null ? '' : line).trim();
    if (!raw) return { ok: false, error: 'Hãy nhập một dòng địa chỉ.' };
    if (!index || !index.records) return { ok: false, error: 'Dữ liệu tra cứu chưa sẵn sàng.' };
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) {
      return { ok: false, error: 'Địa chỉ cần các thành phần ngăn bằng dấu phẩy, ví dụ: "Thôn 3, Xã Cao Phong, Huyện Cao Phong, Tỉnh Hoà Bình".' };
    }
    // Thử lần lượt: 3 thành phần cuối (xã, huyện, tỉnh) → 2 thành phần cuối.
    for (const take of [3, 2]) {
      if (parts.length < take) continue;
      const tail = parts.slice(-take);
      const wardQ = stripUnitPrefix(normalizeName(tail[0]), 'ward');
      if (!wardQ) continue;
      const filters = tail.slice(1).map((t) => ({
        d: stripUnitPrefix(normalizeName(t), 'district'),
        p: stripUnitPrefix(normalizeName(t), 'province'),
      }));
      const matches = [];
      for (const rec of index.records) {
        if (rec.kW !== wardQ) continue;
        let ok = true;
        for (const f of filters) {
          if (!(f.d && rec.kD === f.d) && !(f.p && rec.kP === f.p)) { ok = false; break; }
        }
        if (ok) matches.push(rec);
      }
      if (matches.length) {
        const prefix = parts.slice(0, parts.length - take).join(', ');
        const uniqueWards = new Set(matches.map((m) => m.wIdx));
        let newAddress = null;
        if (uniqueWards.size === 1) {
          const m = matches[0];
          newAddress = (prefix ? prefix + ', ' : '') + m.nW + ', ' + m.nP;
        }
        return { ok: true, matches, prefix, newAddress };
      }
    }
    return { ok: false, error: 'Không nhận diện được xã/huyện/tỉnh cũ trong địa chỉ. Thử tra theo tên xã ở ô tìm kiếm.' };
  }

  // ----------------------------------------------------------------------
  // Định dạng hiển thị.
  // ----------------------------------------------------------------------
  function formatOldUnit(rec) {
    if (!rec) return '';
    const w = rec.oW ? rec.oW + ', ' : '';
    return w + rec.oD + ', ' + rec.oP;
  }

  function formatNewUnit(rec) {
    if (!rec) return '';
    return rec.nW + ', ' + rec.nP;
  }

  // ----------------------------------------------------------------------
  // Gói dữ liệu thôn/tổ dân phố theo tỉnh (người dùng tự nạp file JSON).
  // Schema gói (v1):
  // {
  //   "schema": "dvhc-pack@1",
  //   "province": "<tên tỉnh mới>",
  //   "version": "<chuỗi phiên bản>",
  //   "source": "<căn cứ: số quyết định của UBND tỉnh>",
  //   "mappings": [ { "xa": "<tên xã mới>", "cu": "<thôn/TDP cũ>", "moi": "<thôn/TDP mới>" }, ... ]
  // }
  // ----------------------------------------------------------------------
  const PACK_MAX_MAPPINGS = 50000;

  function validatePack(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { ok: false, error: 'File gói không đúng định dạng JSON object.' };
    }
    if (obj.schema !== 'dvhc-pack@1') {
      return { ok: false, error: 'Gói không đúng schema "dvhc-pack@1".' };
    }
    if (typeof obj.province !== 'string' || !obj.province.trim()) {
      return { ok: false, error: 'Gói thiếu tên tỉnh ("province").' };
    }
    if (!Array.isArray(obj.mappings) || !obj.mappings.length) {
      return { ok: false, error: 'Gói không có dòng đối chiếu nào ("mappings").' };
    }
    if (obj.mappings.length > PACK_MAX_MAPPINGS) {
      return { ok: false, error: 'Gói quá lớn (tối đa ' + PACK_MAX_MAPPINGS + ' dòng).' };
    }
    const clean = [];
    for (const m of obj.mappings) {
      if (!m || typeof m !== 'object') continue;
      const xa = typeof m.xa === 'string' ? m.xa.trim() : '';
      const cu = typeof m.cu === 'string' ? m.cu.trim() : '';
      const moi = typeof m.moi === 'string' ? m.moi.trim() : '';
      if (!xa || !cu || !moi) continue;
      clean.push({ xa, cu, moi });
    }
    if (!clean.length) {
      return { ok: false, error: 'Không có dòng đối chiếu hợp lệ nào (cần đủ "xa", "cu", "moi").' };
    }
    return {
      ok: true,
      pack: {
        schema: 'dvhc-pack@1',
        province: obj.province.trim(),
        version: typeof obj.version === 'string' ? obj.version.trim() : '',
        source: typeof obj.source === 'string' ? obj.source.trim() : '',
        mappings: clean,
      },
    };
  }

  // Dựng chỉ mục gói MỘT lần: gói được phép tới 50.000 dòng, mà mỗi thẻ kết
  // quả đều cần tra thôn/TDP — quét tuyến tính + chuẩn hoá lại từng dòng cho
  // mỗi thẻ sẽ treo UI trên điện thoại. Chuẩn hoá sẵn ở đây, tra O(1) sau đó.
  // Trả { province, byWard: Map<key, [dòng,...]> } — province là tên tỉnh của
  // gói đã chuẩn hoá sẵn để UI khỏi normalize lại mỗi thẻ.
  function buildPackIndex(pack) {
    const byWard = new Map();
    if (!pack || !Array.isArray(pack.mappings)) return { province: '', byWard };
    for (const m of pack.mappings) {
      if (!m) continue;
      const key = stripUnitPrefix(normalizeName(m.xa), 'ward');
      if (!key) continue;
      const list = byWard.get(key);
      if (list) list.push(m);
      else byWard.set(key, [m]);
    }
    return {
      province: stripUnitPrefix(normalizeName(pack.province || ''), 'province'),
      byWard,
    };
  }

  // Tra thôn/TDP theo tên xã mới trên chỉ mục đã dựng (chuẩn hoá không dấu).
  function packLookupFromIndex(index, newWardName) {
    if (!index || !(index.byWard instanceof Map)) return [];
    const key = stripUnitPrefix(normalizeName(newWardName), 'ward');
    if (!key) return [];
    return index.byWard.get(key) || [];
  }

  // Tra trực tiếp trên gói (tiện cho lời gọi lẻ/test). Đường nóng của UI dùng
  // buildPackIndex + packLookupFromIndex với chỉ mục đã cache.
  function packLookup(pack, newWardName) {
    return packLookupFromIndex(buildPackIndex(pack), newWardName);
  }

  return {
    stripDiacritics,
    normalizeName,
    stripUnitPrefix,
    buildIndex,
    searchOld,
    listWardsOfProvince,
    reverseLookup,
    convertAddress,
    formatOldUnit,
    formatNewUnit,
    validatePack,
    buildPackIndex,
    packLookupFromIndex,
    packLookup,
    PACK_MAX_MAPPINGS,
  };
});

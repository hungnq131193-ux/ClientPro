// --- ĐÃ SỬA: GIẢI MÃ DỮ LIỆU TRƯỚC KHI TÍNH TOÁN KHOẢNG CÁCH ---
// Guard cho phần khoảng cách đường bộ: seq chống response cũ đè modal của tài sản khác,
// khóa in-flight theo "chữ ký" request (origin + danh sách điểm) — bấm lại cùng một tài sản
// khi request chưa xong thì không gửi request mới mà "chuyển giao" seq cho request đang chạy
// (để kết quả về vẫn được áp cho lần mở mới nhất), còn mở tham khảo cho TÀI SẢN KHÁC vẫn
// được chạy bình thường.
let __refPriceSeq = 0;
let __refRoadInFlight = null; // { key, seq } của request đường bộ đang chạy

function referenceAssetPrice(assetIndex) {
  // 1. Lấy tài sản đang chọn
  const targetAsset = currentCustomerData.assets[assetIndex];

  // GIẢI MÃ LINK BẢN ĐỒ TRƯỚC KHI LẤY TỌA ĐỘ (guard ciphertext)
  const decryptedTargetLink = (typeof _displayPlain === 'function')
    ? _displayPlain(targetAsset.link, '')
    : (decryptText(targetAsset.link) || '');
  const targetLoc = parseLatLngFromLink(decryptedTargetLink);

  if (!targetLoc) {
    ErrorHandler.showError('VALIDATION', "Tài sản chưa có tọa độ chuẩn (link bản đồ sai hoặc chưa nhập).");
    return;
  }

  // Seq guard cho CẢ lần render đầu (không chỉ bước OSRM): trong lúc chờ decrypt
  // hàng loạt, user có thể đóng modal hoặc mở tham khảo cho tài sản khác — callback
  // cũ về muộn không được phép ghi đè #ref-results / mở lại modal với dữ liệu sai.
  const seq = ++__refPriceSeq;

  LoadingManager.showGlobal("Đang tìm kiếm & so sánh...");

  const tx = db.transaction(["customers"], "readonly");
  tx.objectStore("customers").getAll().onsuccess = async (e) => {
    const customers = e.target.result || [];
    const candidates = [];
    const _plain = (v) => (typeof _displayPlain === 'function')
      ? _displayPlain(v, '')
      : ((typeof decryptText === 'function') ? (decryptText(v) || '') : String(v || ''));

    // v1.5.8: nạp cache field cho TẤT CẢ KH (không chỉ hồ sơ đang mở) trước khi so sánh,
    // tránh hiện ciphertext trong modal tham khảo khi lazy-decrypt chưa từng chạm record khác.
    if (typeof decryptFieldAsync === 'function') {
      const primeJobs = [];
      customers.forEach((cust) => {
        if (!cust) return;
        if (cust.name) primeJobs.push(decryptFieldAsync(cust.name).catch(() => { }));
        (cust.assets || []).forEach((asset) => {
          ['name', 'link', 'valuation', 'area', 'width'].forEach((f) => {
            if (asset && asset[f]) primeJobs.push(decryptFieldAsync(asset[f]).catch(() => { }));
          });
        });
      });
      // Giới hạn concurrency nhẹ: chờ tất cả (số field thường < vài trăm)
      try { await Promise.all(primeJobs); } catch (err) { }
    }

    // Kết quả cũ (đã đóng modal / đã mở tham khảo cho tài sản khác) -> bỏ,
    // chỉ nhả đúng phần loader của lời gọi này (refcount, không force).
    if (seq !== __refPriceSeq) {
      LoadingManager.hideGlobal();
      return;
    }

    customers.forEach((cust) => {
      if (!cust.assets) return;

      const custName = _plain(cust.name);

      cust.assets.forEach((asset) => {
        if (cust.id === currentCustomerData.id && asset.id === targetAsset.id)
          return;

        const decryptedLink = _plain(asset.link);
        if (!decryptedLink || (typeof _looksEncrypted === 'function' && _looksEncrypted(decryptedLink))) return;
        const loc = parseLatLngFromLink(decryptedLink);

        const val = parseMoneyToNumber(_plain(asset.valuation));
        const assetName = _plain(asset.name);

        if (loc && val > 0) {
          const dist = distanceMeters(
            targetLoc.lat,
            targetLoc.lng,
            loc.lat,
            loc.lng
          );

          const assetArea = _plain(asset.area);
          const assetWidth = _plain(asset.width);

          candidates.push({
            customerName: custName,
            assetName: assetName,
            valuation: val,
            distance: dist,
            straight: dist,
            lat: loc.lat,
            lng: loc.lng,
            area: assetArea,
            width: assetWidth,
          });
        }
      });
    });

    LoadingManager.hideGlobal(true);

    if (candidates.length === 0) {
      ErrorHandler.showInfo("Chưa có dữ liệu tham chiếu phù hợp");
      return;
    }

    candidates.sort((a, b) => a.distance - b.distance);

    const top = candidates.slice(0, 30);
    showRefModal(top.slice(0, 20));

    enhanceRefWithRoadDistances(targetLoc, top, seq);
  };
}

async function enhanceRefWithRoadDistances(targetLoc, results, seq) {
  if (typeof fetchRoadDistances !== "function") return;
  const reqKey =
    `${targetLoc.lat},${targetLoc.lng}|` +
    results.map((r) => `${r.lat},${r.lng}`).join(";");
  if (__refRoadInFlight && __refRoadInFlight.key === reqKey) {
    // Cùng tài sản, request đang chạy: chuyển giao seq để kết quả về
    // vẫn được áp cho lần mở modal mới nhất (bản cũ bỏ luôn -> kẹt ở chim bay)
    __refRoadInFlight.seq = seq;
    return;
  }
  const flight = { key: reqKey, seq: seq };
  __refRoadInFlight = flight;

  let dists = null;
  try {
    dists = await fetchRoadDistances(targetLoc, results);
  } catch (e) {
    dists = null; // fetchRoadDistances không reject, nhưng phòng hờ
  } finally {
    if (__refRoadInFlight === flight) __refRoadInFlight = null;
  }

  // Modal đã đóng hoặc user đã mở tham khảo cho tài sản khác -> bỏ kết quả
  if (flight.seq !== __refPriceSeq) return;
  const modal = getEl("ref-price-modal");
  if (!modal || modal.classList.contains("hidden")) return;

  // Thất bại toàn phần -> giữ nguyên haversine
  if (!dists) return;

  results.forEach((item, i) => {
    const r = dists[i];
    if (r && typeof r.d === "number") {
      item.distance = r.d; // sort/hiển thị theo đường bộ khi có
    } else {
      item.distance = item.straight; // giữ haversine làm khóa sort
    }
  });
  results.sort((a, b) => a.distance - b.distance);
  showRefModal(results.slice(0, 20));
}

function showRefModal(results) {
  const modal = getEl("ref-price-modal");
  const container = getEl("ref-results");
  container.innerHTML = "";
  const fmtDist = (m) =>
    m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
  results.forEach((item, idx) => {
    const distStr = fmtDist(item.distance);
    const valStr = item.valuation.toLocaleString("vi-VN") + " trđ";
    const assetName = item.assetName || "";
    const customerName = item.customerName || "";
    const area = item.area || "";
    const width = item.width || "";

    // Badge diện tích và mặt tiền (khung tĩnh; giá trị số được gán qua textContent bên dưới)
    const areaBadge = area
      ? `<span class="bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded text-[10px] font-bold ref-area"></span>`
      : '';
    const widthBadge = width
      ? `<span class="bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded text-[10px] font-bold ref-width"></span>`
      : '';
    const badges = (areaBadge || widthBadge) ? `<div class="flex gap-1 mt-1">${areaBadge}${widthBadge}</div>` : '';

    const div = document.createElement("div");
    div.className = "bg-white/5 border border-white/10 rounded-lg p-3";
    div.innerHTML = `
      <div class="flex justify-between items-center mb-1">
        <span class="text-xs font-bold text-emerald-400">#${idx + 1} • Cách ${distStr}</span>
        <span class="text-sm font-bold text-white">${valStr}</span>
      </div>
      <h4 class="text-sm font-medium text-slate-300 truncate ref-asset-name"></h4>
      ${badges}
      <p class="text-[10px] text-slate-500 mt-1 uppercase">KH: <span class="ref-cust-name"></span></p>`;
    div.querySelector('.ref-asset-name').textContent = assetName;
    div.querySelector('.ref-cust-name').textContent = customerName;
    const areaEl = div.querySelector('.ref-area');
    if (areaEl) areaEl.textContent = `${area}m²`;
    const widthEl = div.querySelector('.ref-width');
    if (widthEl) widthEl.textContent = `MT:${width}m`;
    container.appendChild(div);
  });
  modal.classList.remove("hidden");
}
function closeRefModal() {
  // Đóng modal -> vô hiệu hóa mọi kết quả đang chờ (render đầu lẫn OSRM).
  __refPriceSeq++;
  getEl("ref-price-modal").classList.add("hidden");
}

function renderAssets() {
  const list = getEl("content-assets");
  list.innerHTML = "";
  const assets = currentCustomerData.assets || [];

  // Try to fully unwrap old/double-encrypted labels (best-effort).
  // Some historical records could be encrypted more than once during migrations.
  // v1.0.0: asset.name ĐÃ mã hóa at rest cho ghi mới (xem enc() trong _doSaveAsset).
  // Bản ghi cũ có thể là plaintext hoặc ciphertext legacy, và migration GCM
  // (_reencryptRecord trong 02_security.js) chuyển ciphertext legacy đó sang "cpg1:" —
  // phải dùng decryptText() (hiểu cả 2 dạng) thay vì chỉ strip tiền tố "U2FsdGVkX1",
  // nếu không name sẽ hiện nguyên ciphertext "cpg1:..." sau khi migrate (bug v1.5.6).
  function _deepDecryptLabel(v) {
    if (v === undefined || v === null) return "";
    let s = String(v);
    for (let i = 0; i < 3; i++) {
      if (typeof decryptText !== "function" || typeof _looksEncrypted !== "function" || !_looksEncrypted(s)) break;
      try {
        const out = decryptText(s);
        if (!out || out === s) break;
        s = String(out);
      } catch (e) {
        break;
      }
    }
    return s;
  }

  if (assets.length === 0) {
    // Empty state chuẩn .cp-state (đồng bộ với danh sách KH / kho ảnh)
    if (window.LoadingManager && LoadingManager.showEmptyState) {
      list.innerHTML = "";
      LoadingManager.showEmptyState(list, {
        icon: 'building',
        title: 'Chưa có tài sản bảo đảm',
        message: 'Bấm "Thêm TSBĐ Mới" bên dưới để tạo tài sản đầu tiên cho khách hàng này.',
      });
    } else {
      list.innerHTML = `<div class="text-center py-20 text-slate-500"><i data-lucide="building" class="w-10 h-10 mx-auto mb-2 opacity-40"></i><p class="text-sm">Chưa có tài sản</p></div>`;
      lucide.createIcons();
    }
    return;
  }

  assets.forEach((asset, index) => {
    const el = document.createElement("div");
    el.className =
      "glass-panel p-4 rounded-xl flex flex-col gap-3 transition-transform active:scale-[0.99] mb-4";
    el.style.border = "1px solid rgba(255,255,255,0.12)";

    // --- GIẢI MÃ DỮ LIỆU (DECRYPT) + GUARD CIPHERTEXT (v1.5.8) ---
    // decryptText fail-open trên cache-miss → phải lọc bằng _displayPlain trước khi textContent.
    const decName = (typeof _displayPlain === 'function')
      ? _displayPlain(_deepDecryptLabel(asset.name) || asset.name, 'Đang tải...')
      : (_deepDecryptLabel(asset.name) || '');
    const _plain = (v, fb) => (typeof _displayPlain === 'function') ? _displayPlain(v, fb) : (decryptText(v) || fb || '');

    // v1.0.0: asset.name mã hóa at rest — KHÔNG còn migration ngược về plaintext
    // (trước đây renderAssets ghi plaintext trở lại DB). Cold-cache hiển thị
    // fallback rồi decrypt async cập nhật tại chỗ (xem cuối vòng lặp).
    const decLink = _plain(asset.link, '');
    const decVal = _plain(asset.valuation, '');
    const decLoan = _plain(asset.loanValue, '');
    const decArea = _plain(asset.area, '');
    const decWidth = _plain(asset.width, '');
    const decYear = _plain(asset.year, '');
    const decOnland = _plain(asset.onland, '');

    const mapLink = formatLink(decLink);
    const mapBtn = mapLink
      ? `<a data-map-link target="_blank" class="glass-btn flex-1 py-2.5 rounded-lg text-xs font-bold text-slate-300 flex items-center justify-center gap-1 hover:text-white"><i data-lucide="map" class="w-3 h-3"></i> Bản đồ</a>`
      : `<span class="glass-btn flex-1 py-2.5 rounded-lg text-xs text-slate-500 text-center cursor-not-allowed opacity-50">Chưa có tọa độ</span>`;

    // Khung tĩnh (icon/badge rỗng); giá trị tài sản được gán qua textContent bên dưới để tránh chèn qua innerHTML
    const areaInfo = decArea
      ? `<span class="bg-indigo-500/10 text-indigo-300 px-2 py-1 rounded text-[10px] font-bold border border-white/10 asset-area"></span>`
      : "";
    const widthInfo = decWidth
      ? `<span class="bg-indigo-500/10 text-indigo-300 px-2 py-1 rounded text-[10px] font-bold border border-white/10 asset-width"></span>`
      : "";
    const yearInfo = decYear
      ? `<span class="bg-slate-500/10 text-slate-300 px-2 py-1 rounded text-[10px] font-bold border border-white/10 asset-year"></span>`
      : "";
    const onlandInfo = decOnland
      ? `<div class="text-xs text-slate-400 mt-1 italic"><i data-lucide="home" class="w-3 h-3 inline mr-1"></i><span class="asset-onland"></span></div>`
      : "";

    el.innerHTML = ` <div class="flex justify-between items-start mb-1"> <div class="flex gap-3 items-center"> <div class="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-white/10"><i data-lucide="map-pin" class="w-5 h-5"></i></div> <div><h4 class="font-bold text-white text-sm line-clamp-1 asset-name"></h4><div class="flex gap-1 mt-1 flex-wrap">${areaInfo}${widthInfo}${yearInfo}</div></div> </div> <div class="flex gap-1"> <button data-asset-action="edit" class="text-blue-400 p-2 hover:bg-white/5 rounded-lg"><i data-lucide="pencil" class="w-4 h-4"></i></button> <button data-asset-action="delete" class="text-red-400 p-2 hover:bg-white/5 rounded-lg transition-transform active:scale-90"><i data-lucide="trash-2" class="w-4 h-4"></i></button> </div> </div> ${onlandInfo} <div class="flex justify-between text-xs text-slate-400 mb-2 bg-black/20 p-3 rounded-lg border border-white/5 mt-2"> <span>ĐG: <b class="text-emerald-400 text-sm asset-val"></b></span> <span>Vay: <b class="text-blue-400 text-sm asset-loan"></b></span> </div> <div class="flex gap-2"> ${mapBtn} <button data-asset-action="reference" class="glass-btn flex-1 py-2.5 text-emerald-400 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:text-white"><i data-lucide="radar" class="w-3 h-3"></i> Tham khảo</button> </div> <button data-asset-action="gallery" class="glass-btn w-full py-2.5 text-indigo-400 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:text-white mt-1"><i data-lucide="image" class="w-3 h-3"></i> Kho Ảnh TSBĐ</button>`;

    const nameEl = el.querySelector('.asset-name');
    nameEl.textContent = decName;
    // Cold-cache: decName là fallback 'Đang tải...' -> decrypt async rồi cập nhật tại chỗ.
    if (typeof _looksEncrypted === 'function' && _looksEncrypted(asset.name)
      && typeof _displayPlainAsync === 'function') {
      _displayPlainAsync(asset.name, decName).then((v) => { nameEl.textContent = v; }).catch(() => { });
    }
    el.querySelector('.asset-val').textContent = decVal || "-";
    el.querySelector('.asset-loan').textContent = decLoan || "-";
    const areaEl = el.querySelector('.asset-area');
    if (areaEl) areaEl.textContent = `${decArea}m²`;
    const widthEl = el.querySelector('.asset-width');
    if (widthEl) widthEl.textContent = `MT:${decWidth}m`;
    const yearEl = el.querySelector('.asset-year');
    if (yearEl) yearEl.textContent = `Năm:${decYear}`;
    const onlandEl = el.querySelector('.asset-onland');
    if (onlandEl) onlandEl.textContent = decOnland;
    const mapAnchor = el.querySelector('[data-map-link]');
    if (mapAnchor) mapAnchor.setAttribute('href', mapLink);

    const editBtn = el.querySelector('[data-asset-action="edit"]');
    if (editBtn) editBtn.addEventListener("click", () => openEditAssetModal(index));
    const deleteBtn = el.querySelector('[data-asset-action="delete"]');
    if (deleteBtn) deleteBtn.addEventListener("click", () => deleteAsset(index));
    const referenceBtn = el.querySelector('[data-asset-action="reference"]');
    if (referenceBtn) referenceBtn.addEventListener("click", () => referenceAssetPrice(index));
    const galleryBtn = el.querySelector('[data-asset-action="gallery"]');
    if (galleryBtn) galleryBtn.addEventListener("click", () => openAssetGallery(asset.id, decName, index));
    list.appendChild(el);
  });
  lucide.createIcons();
}
// Legacy asset gallery functions removed; canonical implementations live in assets/08_images_camera.js.

function openAssetModal() {
  // Vô hiệu hóa lượt decrypt sửa-TSBĐ còn treo (nếu có) + gỡ khóa nút Lưu,
  // tránh lượt cũ đè nhãn/trạng thái nút sau khi đã chuyển sang chế độ thêm mới.
  window.__editAssetModalSeq = (window.__editAssetModalSeq || 0) + 1;
  try { LoadingManager.hideButtonLoading(getEl("btn-save-asset")); } catch (e) { }
  getEl("asset-modal").classList.remove("hidden");
  // Tránh dùng nhầm currentAssetId còn sót lại từ lần Sửa/Hủy TSBĐ trước đó
  // (nếu không reset, TSBĐ mới tạo có thể bị gán trùng id với TSBĐ cũ -> lẫn ảnh giữa 2 tài sản).
  currentAssetId = null;
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
async function openEditAssetModal(index) {
  // Hiện modal
  getEl("asset-modal").classList.remove("hidden");

  // Lấy tài sản đang chọn — SNAPSHOT trước await, không đọc lại currentCustomerData
  // sống sau khi decrypt xong.
  const asset = currentCustomerData.assets[index];

  // Setup tiêu đề modal
  getEl("edit-asset-index").value = index;
  getEl("modal-title-asset").textContent = "Cập nhật TSBĐ";
  getEl("btn-save-asset").textContent = "Lưu thay đổi";

  // Reset form NGAY (openAssetModal có reset, hàm này trước đây không): trong lúc
  // chờ decrypt, form không được hiện dữ liệu sót của TSBĐ mở lần trước — bấm Lưu
  // lúc đó sẽ ghi nhầm dữ liệu cũ vào TSBĐ đang mở.
  ["asset-name", "asset-link", "asset-val", "asset-loan", "asset-area", "asset-width", "asset-onland", "asset-year"]
    .forEach((fid) => { const el = getEl(fid); if (el) el.value = ""; });

  // Khóa nút Lưu trong lúc chờ decrypt; chỉ lượt mở MỚI NHẤT được mở khóa nút
  // (không có nguy cơ 2 lượt tranh nhau bật/tắt).
  const editSeq = (window.__editAssetModalSeq = (window.__editAssetModalSeq || 0) + 1);
  const saveBtn = getEl("btn-save-asset");
  try { LoadingManager.showButtonLoading(saveBtn, "Đang tải..."); } catch (e) { }

  // --- QUAN TRỌNG: Giải mã dữ liệu trước khi điền vào ô input ---
  // Dùng decryptFieldAsync (chờ giải mã thật, không phụ thuộc __fieldPlainCache đã nạp sẵn
  // hay chưa — với lazy decrypt, cache có thể chưa có field này). decryptText đồng bộ chỉ dùng
  // làm fallback nếu decryptFieldAsync không tồn tại.
  const dec = (typeof decryptFieldAsync === "function")
    ? decryptFieldAsync
    : (v) => Promise.resolve(decryptText(v));

  let name = "", link = "", val = "", loan = "", area = "", width = "", onland = "", year = "";
  try {
    [name, link, val, loan, area, width, onland, year] = await Promise.all([
      dec(asset.name), dec(asset.link), dec(asset.valuation), dec(asset.loanValue),
      dec(asset.area), dec(asset.width), dec(asset.onland), dec(asset.year),
    ]);
  } catch (e) { }

  // Chỉ lượt mở MỚI NHẤT được điền form + mở khóa nút (lượt cũ không đụng nút —
  // lượt mới hơn / openAssetModal đã tự lo trạng thái nút).
  if (editSeq !== window.__editAssetModalSeq) return;
  try { LoadingManager.hideButtonLoading(saveBtn, "Lưu thay đổi"); } catch (e) { }

  // Nếu user đóng modal / mở TSBĐ khác trong lúc chờ giải mã thì bỏ qua (giữ guard cũ).
  if (getEl("edit-asset-index").value !== String(index)) return;

  // Bảo vệ: nếu sau khi cố giải mã vẫn còn dạng ciphertext (khóa sai / dữ liệu hỏng), để ô
  // TRỐNG thay vì hiện chuỗi mã hóa — và tuyệt đối không cho _doSaveAsset mã hóa lại chuỗi đó
  // (xem encAssetField trong _doSaveAsset, giữ nguyên ciphertext gốc khi ô để trống).
  // name: đã giải mã ở trên để điền form; nếu vẫn còn ciphertext (khóa sai) → cùng guard để trống.
  getEl("asset-name").value = (name && !_looksEncrypted(name)) ? name : "";
  getEl("asset-link").value = (link && !_looksEncrypted(link)) ? link : "";
  getEl("asset-val").value = (val && !_looksEncrypted(val)) ? val : "";
  getEl("asset-loan").value = (loan && !_looksEncrypted(loan)) ? loan : "";
  getEl("asset-area").value = (area && !_looksEncrypted(area)) ? area : "";
  getEl("asset-width").value = (width && !_looksEncrypted(width)) ? width : "";
  getEl("asset-onland").value = (onland && !_looksEncrypted(onland)) ? onland : "";
  getEl("asset-year").value = (year && !_looksEncrypted(year)) ? year : "";

  // Gán ID để xử lý ảnh đúng tài sản
  currentAssetId = asset.id;
}

/**
 * Giải mã trước (prime __fieldPlainCache) toàn bộ field TSBĐ của 1 khách hàng, theo batch.
 * Chỉ nạp cache, KHÔNG tự render — caller quyết định re-render tab nào đang mở sau khi xong
 * (xem openFolder() trong 05_customers.js). Đây là phần còn thiếu của "lazy decrypt" (v1.5.5):
 * trước đây renderAssets()/openEditAssetModal() gọi decryptText() đồng bộ nhưng không có gì
 * nạp cache cho field TSBĐ -> luôn hiện ciphertext ở lần mở đầu tiên sau unlock.
 */
window.decryptCustomerAssetsAsync = async function decryptCustomerAssetsAsync(customer, opts) {
  if (!customer || !Array.isArray(customer.assets) || typeof decryptFieldAsync !== "function") return;
  const batchSize = (opts && opts.batchSize) || 6;
  // v1.0.0: "name" mã hóa at rest như các field khác (bản ghi rất cũ có thể còn
  // plaintext trước khi migration chạy — decryptFieldAsync chấp nhận cả hai).
  const fields = ["name", "link", "valuation", "loanValue", "area", "width", "onland", "year"];
  for (let i = 0; i < customer.assets.length; i += batchSize) {
    const batch = customer.assets.slice(i, i + batchSize);
    await Promise.all(batch.map((asset) => Promise.all(fields.map((f) => {
      const v = asset && asset[f];
      return (v !== undefined && v !== null) ? dec_safely(v) : Promise.resolve();
    }))));
  }
  function dec_safely(v) {
    return decryptFieldAsync(v).catch(() => { });
  }
};
function closeAssetModal() {
  // Vô hiệu hóa lượt decrypt openEditAssetModal còn treo: không bump seq thì tail của
  // lượt cũ vẫn qua được cả 2 guard (seq + edit-asset-index) và set LẠI currentAssetId
  // sau khi modal đã đóng — phá đúng cái reset bên dưới (ảnh chụp sau bị gán nhầm assetId).
  window.__editAssetModalSeq = (window.__editAssetModalSeq || 0) + 1;
  getEl("edit-asset-index").value = "";
  getEl("asset-modal").classList.add("hidden");
  // Hủy sửa TSBĐ -> không còn "đang thao tác" trên tài sản đó nữa, tránh ảnh chụp
  // sau đó (vd. ở tab Hình ảnh hồ sơ) bị gán nhầm assetId của tài sản vừa hủy sửa.
  currentAssetId = null;
}

// CHỐNG DOUBLE-SUBMIT: cờ in-flight + disable nút Lưu (LoadingManager.showButtonLoading).
// Chạm 2 lần trên máy chậm sẽ không push 2 tài sản trùng vào currentCustomerData.assets.
let __assetSaveInFlight = false;
async function saveAsset() {
  if (__assetSaveInFlight) return;
  __assetSaveInFlight = true;
  const saveBtn = getEl("btn-save-asset");
  try { LoadingManager.showButtonLoading(saveBtn, "Đang lưu..."); } catch (e) { }
  try {
    await _doSaveAsset();
  } catch (err) {
    ErrorHandler.showError('STORAGE', 'Có lỗi xảy ra khi lưu tài sản. Vui lòng thử lại.', err);
  } finally {
    __assetSaveInFlight = false;
    try { LoadingManager.hideButtonLoading(saveBtn); } catch (e) { }
  }
}

async function _doSaveAsset() {
  // Security gate: chưa có masterKey (chưa mở khóa / vừa bị auto-lock) thì không cho lưu
  // — encryptText fail-open trả nguyên plaintext, thiếu gate này là ghi plaintext vào DB
  // (mirror gate trong saveCustomer, 05_customers.js).
  if (typeof masterKey === 'undefined' || !masterKey) {
    return ErrorHandler.showError('AUTH', 'Chưa mở khóa dữ liệu. Vui lòng mở khóa trước khi lưu tài sản.');
  }

  // Lấy giá trị từ các ô nhập liệu
  const name = getEl("asset-name").value.trim();
  let link = getEl("asset-link").value.trim();

  if (!name) return ErrorHandler.showError('VALIDATION', 'Vui lòng nhập mô tả tài sản.');

  const index = getEl("edit-asset-index").value;
  const prev = (index !== "") ? currentCustomerData.assets[parseInt(index)] : null;

  // Helper (ASYNC vì AES-GCM/WebCrypto bất đồng bộ):
  // - Chỉ mã hóa nếu có dữ liệu (tránh biến ô trống thành mã loằng ngoằng)
  // - BẢO VỆ CHỐNG MẤT DỮ LIỆU: nếu ô đang trống NHƯNG trường gốc (prev) vẫn còn ciphertext
  //   chưa giải mã được (khóa sai / dữ liệu hỏng / cache lazy-decrypt chưa kịp nạp khi mở modal),
  //   GIỮ NGUYÊN ciphertext gốc thay vì ghi đè bằng chuỗi rỗng — tránh xóa mất dữ liệu mà user
  //   chưa từng thực sự thấy được. Chỉ áp dụng khi field KHÔNG đổi (ô trống), field có nội dung
  //   mới thì mã hóa bình thường (encryptText tự chặn double-encryption nếu lỡ dán ciphertext).
  const enc = async (txt, origField) => {
    const v = (txt || "").trim();
    if (!v) {
      if (origField && _looksEncrypted(decryptText(origField))) return origField;
      return "";
    }
    const out = await encryptText(v);
    // encryptText fail-open khi app bị khóa GIỮA chuỗi await (auto-lock 15s khi ẩn app):
    // trả nguyên plaintext. Không được ghi plaintext xuống DB — throw để saveAsset()
    // báo lỗi qua ErrorHandler và dừng (mirror _encryptCreditLimitForWrite, 05_customers.js).
    if (typeof _looksEncrypted === 'function' && !_looksEncrypted(out)) {
      throw new Error('ENCRYPT_UNAVAILABLE');
    }
    return out;
  };

  // Xử lý link map
  const coords = parseLatLngFromLink(link);
  if (coords && !link.includes("http")) {
    link = `https://www.google.com/maps?q=${coords.lat},${coords.lng}`;
  }

  if (!currentCustomerData.assets) currentCustomerData.assets = [];

  // v1.0.0: tên TSBĐ mã hóa at rest như mọi field khác (đảo quyết định
  // "KHÔNG MÃ HÓA TÊN TSBĐ" cũ). Đường đọc chấp nhận cả plaintext legacy lẫn
  // ciphertext; Drive folder name decrypt async trước khi ghép (07_drive.js).
  // Mã hóa TRƯỚC khi persist (persistCurrentCustomer mở transaction, không await bên trong).
  const assetObj = {
    name: await enc(name, prev && prev.name),
    link: await enc(link, prev && prev.link),
    valuation: await enc(getEl("asset-val").value, prev && prev.valuation),
    loanValue: await enc(getEl("asset-loan").value, prev && prev.loanValue),
    area: await enc(getEl("asset-area").value, prev && prev.area),
    width: await enc(getEl("asset-width").value, prev && prev.width),
    onland: await enc(getEl("asset-onland").value, prev && prev.onland),
    year: await enc(getEl("asset-year").value, prev && prev.year),
  };

  // Snapshot để hoàn tác in-memory nếu ghi DB thất bại (tránh UI lệch với DB).
  let undoMutation = null;
  if (index !== "") {
    // Cập nhật tài sản cũ
    const i = parseInt(index);
    assetObj.id = prev.id;
    assetObj.createdAt = prev.createdAt;
    if (prev.driveLink) assetObj.driveLink = prev.driveLink;
    currentCustomerData.assets[i] = assetObj;
    undoMutation = () => { currentCustomerData.assets[i] = prev; };
  } else {
    // Thêm mới
    assetObj.id = currentAssetId || "asset_" + Date.now();
    assetObj.createdAt = Date.now();
    currentCustomerData.assets.push(assetObj);
    undoMutation = () => {
      const pos = currentCustomerData.assets.indexOf(assetObj);
      if (pos >= 0) currentCustomerData.assets.splice(pos, 1);
    };
  }

  // Lưu vào DB (chỉ ghi mảng assets; không put() nguyên currentCustomerData
  // vì name/phone/cccd trên object đó đã bị giải mã trong openFolder).
  // Await kết quả để: (1) guard chống double-submit giữ đến khi ghi xong,
  // (2) KHÔNG báo "thành công" khi ghi DB thất bại (persistCurrentCustomer trả ok=false).
  const ok = await new Promise((resolve) => {
    persistCurrentCustomer((rec) => { rec.assets = currentCustomerData.assets; }, resolve);
  });
  if (!ok) {
    try { if (undoMutation) undoMutation(); } catch (e) { }
    ErrorHandler.showError('STORAGE', 'Lưu tài sản thất bại — dữ liệu CHƯA được ghi. Vui lòng thử lại.');
    return;
  }
  closeAssetModal();
  renderAssets();
  ErrorHandler.showSuccess("Đã lưu tài sản bảo đảm");
  currentAssetId = null;
}
// --- NEW GUIDE MODAL LOGIC ---
function openGuideModal() {
  getEl("guide-modal").classList.remove("hidden");
}
function closeGuideModal() {
  getEl("guide-modal").classList.add("hidden");
}


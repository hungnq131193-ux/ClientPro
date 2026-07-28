# Plan cho Opus 5 — Fix bug ảnh/map + mượt hơn + cleanup an toàn + bump 1.4.4

> **Baseline:** `main` @ `8007c0c`, semver `1.4.3`, `ASSET_V = AUTOBACKUP_DEDUPE_20260728`.  
> **Mục tiêu sau PR:** `1.4.4`, `ASSET_V = IMAGE_MAP_PERF_20260728` (hoặc ngày thực thi).  
> **Số dòng** dưới đây đúng tại baseline trên. Opus **phải đọc lại hàm bằng tên** trước khi edit; nếu lệch dòng thì neo theo **tên hàm**, không theo số dòng cứng.  
> **Tham chiếu code trong CLAUDE.md / PR description:** luôn dùng `file + function`, không hard-code line number.

---

## 0. Hợp đồng an toàn (đọc trước khi đụng code)

### 0.1 Được phép đụng

| Khu vực | File |
|---|---|
| Ảnh / camera / gallery | `assets/08_images_camera.js` |
| Lightbox close | `assets/04_ui_common.js` (`closeLightbox`) |
| Map markers | `assets/03_map.js` (`renderMapMarkers` + helpers mới cục bộ) |
| ĐVHC icons | `assets/dvhc-lookup/dvhc_ui.js` (`refreshIcons`) |
| Docs hygiene | `README.md`, `tests/README.md`, `.gitignore` |
| Canonical map | `CLAUDE.md` (chỉ mục Images / Map / DVHC / UI / Versioning / Definition of Done) |
| Version | `package.json`, `sw.js` (`ASSET_V` + sync), mọi `?v=`, `MAPLIBRE_V`, `LAZY_MODULES_V` |
| Tests mới / mở rộng tripwire | `tests/regressions.test.js` + **1 file unit mới** (xem §5) |

### 0.2 CẤM tuyệt đối

- Không đụng: activation, PIN/unlock lifecycle, `02_security.js` crypto schema, IndexedDB schema/version, backup format, Drive/GAS endpoints, CSP, SW **caching strategy**, theme, weather, donate, onboarding tour logic, PDF Toolkit limits/logic.
- **Không** đổi `encryptImageData` từ fail-open → fail-closed ở tầng crypto (migration / callers khác phụ thuộc). Fix nằm ở **caller ghi DB** (`saveImageToDB`).
- **Không** hard-code prefix `cpg1:` trong code mới — dùng `_looksEncrypted` / helpers có sẵn.
- **Không** xóa bất kỳ file trong `tests/` hiện có (279 tests đều substantive).
- **Không** xóa `assets/vendor/*`, icons, CSS, modal HTML, `scripts/*`, `gas/*`.
- **Không** virtualize toàn bộ customer list, **không** bỏ MapLibre/PDF khỏi SW precache (offline contract).
- **Không** merge PR; **không** commit secrets.

### 0.3 Cleanup: thực tế audit

Audit baseline **không tìm thấy** file production / test thừa an toàn để xóa. Cleanup = **docs drift + ignore hygiene**, không “dọn bừa”. Nếu Opus thấy candidate xóa khác → chứng minh unreferenced bằng `rg` rồi mới xóa; khi nghi ngờ thì **giữ**.

---

## 1. Thứ tự thực thi (bắt buộc tuần tự)

```
A. Branch từ main mới nhất
B. Phase 1 — P1 correctness (ảnh plaintext + gắn nhầm hồ sơ)
C. Phase 2 — P2 smoothness (compress loop, gallery concurrency, lightbox RAM, map token+index, ĐVHC lucide)
D. Phase 3 — Tests + tripwires
E. Phase 4 — Docs cleanup (README / tests/README / .gitignore) — không xóa test/code production
F. Phase 5 — CLAUDE.md cập nhật tuần tự khớp code mới
G. Phase 6 — Bump version đầy đủ 1.4.4 + ASSET_V mới
H. Phase 7 — Verify (syntax, policy, unit, e2e) rồi mới coi Done
```

Mỗi phase: commit riêng, message rõ. Không gộp version bump vào commit fix logic.

Suggested branch: `cursor/image-map-perf-cleanup-6024` (hoặc theo template cloud agent hiện hành).

---

## 2. Phase 1 — P1 correctness (ảnh)

### 2.1 `saveImageToDB` — fail-closed trước khi ghi IndexedDB

**File:** `assets/08_images_camera.js`  
**Hàm:** `saveImageToDB` (baseline ~L584–675)

#### Hiện trạng (bug)

Trong callback `compressImage(..., async (compressed) => { ... })` (~L615–634):

```js
let storedData = compressed;
try {
  if (typeof encryptImageData === 'function') {
    storedData = await encryptImageData(compressed);
  }
} catch (e) {
  try { ErrorHandler.logError('encryptImageData', e); } catch (_) {}
}
const newImg = { ..., data: storedData, imgCryptoV: storedData.startsWith('cpg1:') ? 1 : undefined, ... };
// rồi add vào IDB
```

- `encryptImageData` (`02_security.js`) **fail-open** khi `!masterKey` → trả nguyên data URL.
- `catch` nuốt lỗi → vẫn ghi plaintext.
- Hard-code `startsWith('cpg1:')` cho `imgCryptoV` cũng vi phạm ciphertext-prefix rule.

#### Sửa (thay khối encrypt + guard, giữ nguyên snapshot / tx handlers)

Sau `await encryptImageData` (và cả khi hàm không tồn tại), **trước** khi tạo `newImg`:

1. Nếu `typeof encryptImageData !== 'function'` → fail (không ghi).
2. Nếu `typeof isAppUnlocked === 'function' && !isAppUnlocked()` → fail (không ghi).
3. Nếu `typeof _looksEncrypted === 'function' ? !_looksEncrypted(storedData) : true` → fail (không ghi plaintext).
4. Fail path: `LoadingManager.hideGlobal(true)` + `ErrorHandler.showError('STORAGE'|phù hợp, message thân thiện, err)` + `resolve()` — **không** mở transaction.
5. Success path: giữ `imgTx` / `oncomplete` / `onerror` / `onabort` / `imgTxSettled` như hiện tại (tripwire B #7 trong `tests/regressions.test.js` **phải vẫn pass**).
6. `imgCryptoV`: đặt `1` khi `_looksEncrypted(storedData)` (hoặc tương đương helper), **không** so sánh literal `cpg1:`.

#### Không xóa

- Comment snapshot `askedCustomerId` / `askedAssetId` (~L586–605) — giữ nguyên ý nghĩa.
- Toàn bộ nhánh refresh gallery sau `oncomplete`.

#### Pseudo-diff mục tiêu

```diff
 compressImage(enhancedBase64, async (compressed) => {
   let storedData = compressed;
   try {
     if (typeof encryptImageData === 'function') {
       storedData = await encryptImageData(compressed);
     }
+    const unlocked = (typeof isAppUnlocked !== 'function') || isAppUnlocked();
+    const looksEnc = (typeof _looksEncrypted === 'function') && _looksEncrypted(storedData);
+    if (typeof encryptImageData !== 'function' || !unlocked || !looksEnc) {
+      LoadingManager.hideGlobal(true);
+      ErrorHandler.showError('STORAGE', 'Không mã hóa được ảnh — chưa lưu. Mở khóa lại rồi thử.', null);
+      resolve();
+      return;
+    }
   } catch (e) {
-    try { ErrorHandler.logError('encryptImageData', e); } catch (_) {}
+    try { ErrorHandler.logError('encryptImageData', e); } catch (_) {}
+    LoadingManager.hideGlobal(true);
+    ErrorHandler.showError('STORAGE', 'Không mã hóa được ảnh — chưa lưu. Mở khóa lại rồi thử.', e);
+    resolve();
+    return;
   }
   const newImg = {
     ...
-    imgCryptoV: (typeof storedData === 'string' && storedData.startsWith('cpg1:')) ? 1 : undefined,
+    imgCryptoV: 1,
     ...
   };
```

(Nếu muốn phân biệt legacy CryptoJS image — hiện pipeline chỉ sinh GCM — `imgCryptoV: 1` khi looks encrypted là đủ.)

---

### 2.2 `handleFileUpload` — snapshot id **trước** FileReader

**File:** `assets/08_images_camera.js`  
**Hàm:** `handleFileUpload` (baseline ~L676–695)

#### Hiện trạng (bug)

```js
Array.from(files).forEach((file) => {
  const reader = new FileReader();
  reader.onload = async (e) => {
    await saveImageToDB(e.target.result); // snapshot nằm TRONG saveImageToDB → trễ
  };
  reader.readAsDataURL(file);
});
```

#### Sửa

1. Ngay đầu hàm (sau validate `files`): snapshot  
   `const uploadCustomerId = currentCustomerId;`  
   `const uploadAssetId = currentAssetId;`  
   `const uploadMode = mode || "profile";`  
   rồi `captureMode = uploadMode`.
2. Đổi chữ ký: `saveImageToDB(rawBase64, opts)` với `opts = { customerId, assetId, captureMode }` **optional**.
3. Trong `saveImageToDB`: nếu `opts` có id thì dùng opts; không thì giữ behavior cũ (`currentCustomerId` snapshot đầu hàm) — camera path không vỡ.
4. Trong `reader.onload`: gọi  
   `saveImageToDB(base64, { customerId: uploadCustomerId, assetId: uploadAssetId, captureMode: uploadMode })`.
5. Nếu `!uploadCustomerId` lúc chọn file → toast/warning và return sớm (không đọc file).
6. **Giới hạn concurrency upload (mượt):** thay `forEach` fire-all bằng hàng đợi tuần tự hoặc pool 2 (xem §3.2 helper). Không mở 10 FileReader + compress + encrypt cùng lúc.

#### Không đụng

- Reset `input.value = ""` — giữ.
- Camera `capturePhoto` path — chỉ truyền thêm opts nếu cần; mặc định không đổi.

---

## 3. Phase 2 — P2 smoothness

### 3.1 `compressImage` — chặn dao động quality vô hạn

**File:** `assets/08_images_camera.js`  
**Hàm:** `compressImage` (baseline ~L518–582)

#### Hiện trạng

`adjustAndCheck` (~L550–571): `q -= 0.05` / `q += 0.03` qua `setTimeout` không có max iteration. JPEG có thể nhảy quanh 500–700 KB.

#### Sửa (trong `adjustAndCheck`)

1. Thêm `let steps = 0;` ngoài closure; mỗi lần vào `adjustAndCheck`: `if (++steps > 24) { cb(dataUrl); return; }`.
2. Khi giảm quality: nếu `sizeBytes > MAX_BYTES && q <= 0.5` → `cb(dataUrl)` ngay (đã hết room — logic cũ gần đúng nhưng gộp rõ).
3. Khi tăng quality: nếu vừa tăng rồi vòng sau lại giảm (detect oscillation: lưu `lastDir`), dừng và `cb` bản gần mục tiêu nhất.
4. Bọc `img.onload` body bằng try/catch → `cb(base64)` fallback (tránh Promise ngoài `saveImageToDB` treo nếu canvas throw).

#### Không đổi

- `maxDim = 2200`, band 500–700 KB, filter contrast/brightness — giữ (tránh đổi chất lượng ảnh hàng loạt).

---

### 3.2 Gallery decrypt có giới hạn concurrency

**File:** `assets/08_images_camera.js`  
**Hàm:** `loadImagesFiltered` (~L325–425), `loadAssetImages` (~L429–…)

#### Hiện trạng

```js
const resolved = await Promise.all(imgs.map(async (img) => ({
  ...img,
  _displayData: await resolveImageData(img),
})));
```

Decrypt **toàn bộ** song song → đỉnh RAM/CPU cao trên Android.

#### Sửa

1. Thêm helper cục bộ (cùng file, không global mới trừ khi cần test):

```js
async function _mapPool(items, limit, mapper) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) || 0 }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await mapper(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
```

2. Thay `Promise.all(imgs.map(...))` bằng `_mapPool(imgs, 4, async (img) => ({ ...img, _displayData: await resolveImageData(img) }))` ở **cả** `loadImagesFiltered` và `loadAssetImages`.
3. Giữ nguyên `__galleryLoadSeq` / `askedCustomerId` checks sau await.
4. Giữ chunk DOM `CHUNK = 24` + `requestAnimationFrame` — không đụng.

#### Không làm (scope creep)

- Không virtualize gallery grid.
- Không đổi schema ảnh / index IDB.

---

### 3.3 `closeLightbox` — giải phóng tham chiếu plaintext lớn

**File:** `assets/04_ui_common.js`  
**Hàm:** `closeLightbox` (baseline ~L192, one-liner)

#### Hiện trạng

```js
function closeLightbox() { getEl('lightbox').classList.add('hidden'); }
```

`currentImageBase64`, `currentLightboxList`, `<img id=...>` src vẫn giữ data URL lớn.

#### Sửa

```js
function closeLightbox() {
  const box = getEl('lightbox');
  if (box) box.classList.add('hidden');
  try {
    const img = getEl('lightbox-img'); // VERIFY real id in index.html / modal before use
    if (img) img.removeAttribute('src');
  } catch (_) {}
  currentImageBase64 = null;
  // Không bắt buộc clear currentLightboxList nếu swipe-reopen cần — ưu tiên clear base64 + img src.
  // Nếu clear list: đảm bảo openLightbox luôn truyền list lại (đang có).
}
```

**Bắt buộc:** `rg` id lightbox image trong `index.html` / modals trước khi clear `src`. Nếu id khác (`#lightbox img`) thì dùng selector đúng — không đoán.

#### Không đụng

- `openLightbox` / swipe navigation logic ngoài việc vẫn hoạt động sau clear.

---

### 3.4 Map — render token + index ảnh + concurrency

**File:** `assets/03_map.js`  
**Hàm:** `renderMapMarkers` (baseline ~L706–814)

#### Hiện trạng (rủi ro)

- Reset shared `__mapFeatures` không có seq → 2 lần mở map chồng nhau.
- `allImages.find` × 2 mỗi asset → O(assets × images).
- `Promise.all(featureJobs)` không giới hạn; mỗi job decrypt name/link/val + optional image.

#### Sửa từng bước

1. **Render seq** (module-level cạnh `__mapFeatures`):

```js
let __mapRenderSeq = 0;
// trong renderMapMarkers:
const seq = ++__mapRenderSeq;
```

Sau mỗi `await` lớn (`ensureSuperclusterLoaded`, `Promise.all` customers/images, `Promise.all(featureJobs)`):  
`if (seq !== __mapRenderSeq) return;`  
Trước khi `_paintMapClusters` / `fitBounds`: check lại.

2. **Index ảnh** sau khi có `allImages`:

```js
const byAssetId = new Map();
const byCustomerId = new Map(); // first image only, mirror old fallback
for (const im of allImages) {
  if (im.assetId && !byAssetId.has(im.assetId)) byAssetId.set(im.assetId, im);
  if (im.customerId && !byCustomerId.has(im.customerId)) byCustomerId.set(im.customerId, im);
}
// thay find:
const img = byAssetId.get(asset.id) || byCustomerId.get(cust.id);
```

3. **Concurrency:** đừng `Promise.all` mọi customer. Pool limit 3–4 customer jobs (reuse pattern `_mapPool` — copy helper local vào `03_map.js` **hoặc** nếu muốn DRY tối thiểu, giữ 2 bản local; **không** kéo dependency chéo module).

4. **Thumbnail:** giữ decrypt ảnh cho marker (popup cần), nhưng pool giới hạn đã giảm peak. Không đổi popup DOM builder trừ khi bắt buộc.

5. **Không** đổi OSRM / road-distance seal / clustering radius constants.

#### Không xóa

- Fallback Supercluster warning, `fallbackThumb` SVG, `_clearMapMarkers`.

---

### 3.5 ĐVHC — scope Lucide

**File:** `assets/dvhc-lookup/dvhc_ui.js`  
**Hàm:** `refreshIcons` (baseline ~L41–44)

#### Hiện trạng

```js
function refreshIcons() {
  try { if (window.lucide && lucide.createIcons) lucide.createIcons(); }
  catch (e) {}
}
```

Unscoped → recreate mọi icon document khi gõ search.

#### Sửa

```js
function refreshIcons() {
  try {
    if (window.lucide && lucide.createIcons) {
      lucide.createIcons({ root: screenEl || document.getElementById('screen-dvhc-lookup') || undefined });
    }
  } catch (e) {}
}
```

Nếu `screenEl` chưa build: fallback `#screen-dvhc-lookup`. Không đổi z-index / history / lock observer.

---

### 3.6 CSS `will-change` — chỉnh **thận trọng**, có thể bỏ qua nếu rủi ro

**File:** `assets/styles.css`

Baseline:
- `.glass-header` ~L473 `will-change: transform;`
- menu / modal rules ~L503, L537, L636

**Khuyến nghị Opus:**  
Chỉ bỏ `will-change` **vĩnh viễn** trên `.app-container` nếu vẫn còn (đã có perf commit `53e694c`). **Không** đụng `.glass-header` blur trừ khi đo được jank — header không slide full-screen.  
→ Phase này **optional**; ưu tiên §3.1–3.5. Nếu không chắc → **skip**.

---

## 4. Phase 3 — Tests (bắt buộc trước bump)

### 4.1 Mở rộng tripwire hiện có — **không xóa** test cũ

**File:** `tests/regressions.test.js`  
Test hiện tại ~L275–282 (`saveImageToDB` oncomplete/onerror/onabort) — **giữ nguyên**.

**Thêm** test mới ngay sau đó:

1. `saveImageToDB` body phải chứa `_looksEncrypted` (hoặc check ciphertext) **trước** `objectStore("images").add` / `.add(newImg)`.
2. `saveImageToDB` body **không** còn `startsWith('cpg1:')` cho imgCryptoV.
3. Fail path: có `return` sớm / `showError` khi không mã hóa được (regex structural).
4. `handleFileUpload` body snapshot `currentCustomerId` (hoặc biến `uploadCustomerId`) **trước** `readAsDataURL`.
5. `renderMapMarkers` có `__mapRenderSeq` (hoặc tên seq tương đương) + check sau await.
6. `dvhc_ui.js` `refreshIcons` chứa `createIcons({ root:`.

### 4.2 Unit test hành vi (file mới)

**Tạo:** `tests/image-save-fail-closed.test.js`  
Pattern: mirror `tests/image-migration-autolock.test.js` / `tests/helpers/load-security.js` nếu cần crypto; hoặc sandbox nhẹ load đoạn helper.

Minimum cases:
1. Khi `encryptImageData` trả plaintext / throw → **không** gọi IDB `add` với data URL.
2. Khi encrypt trả ciphertext looks-encrypted → `add` được gọi.
3. (Optional) pool helper nếu export testable.

**Không** xóa `tests/image-migration-autolock.test.js`.

### 4.3 E2E

- Không bắt buộc spec mới nếu unit + tripwire đủ.
- Chạy full `npm run test:e2e` ở Phase 7.
- Nếu đụng lightbox DOM id sai → e2e/smoke/crud sẽ bắt.

---

## 5. Phase 4 — Cleanup an toàn (docs only)

### 5.1 Được sửa

| File | Việc |
|---|---|
| `.gitignore` | Thêm dòng `.agent-fetch-links.md` (hygiene test cấm track; chưa ignore). |
| `README.md` ~L145 | Đổi `Font self-host (Be Vietnam Pro, Inter)` → chỉ `Be Vietnam Pro`. |
| `README.md` Drive section ~L47–49 | Sửa câu “không tự động gửi”: auto-backup Drive **có** chạy khi user đã cấu hình (xem `16_auto_backup_drive.js`) — diễn đạt đúng opt-in config + daily auto. |
| `README.md` tree ~L137 | Thêm `scripts/check-policy.mjs`. |
| `README.md` docs line ~L150 | `docs/` = terminology + screenshot **policy** (không còn ảnh lớn trong repo). |
| `tests/README.md` ~L24 | Node `>=22` (khớp `package.json` engines). |
| `tests/README.md` bảng | Bổ sung các file test còn thiếu so với `tests/*.test.js` hiện có (liệt kê đủ; không xóa dòng cũ). |

### 5.2 Cấm xóa

- Mọi `tests/*.test.js`, `e2e/*.spec.js`
- `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`
- Toàn bộ `assets/css/*`, `assets/vendor/*`, `assets/ui/modals/*`
- `docs/screenshots/README.md`
- `formatBytes` trùng PDF vs globals (lazy-load isolation — cố ý)
- `showToast` fallback trong `04_ui_common.js`

### 5.3 Nếu “thấy code chết”

Chỉ xóa khi:
1. `rg` toàn repo 0 reference, **và**
2. Không phải public `window.*` / `data-action` / SW precache / script order, **và**
3. Ghi rõ trong PR body.

Mặc định audit: **không có candidate xóa production.**

---

## 6. Phase 5 — Viết lại / cập nhật `CLAUDE.md` tuần tự

Không viết changelog dài. Cập nhật **invariants + entry points** cho khớp code mới. Giữ progressive-disclosure; không line numbers; không secrets.

### 6.1 Mục **Images / camera** (thay/bổ sung Core invariants)

Thêm / chỉnh thành:

- `saveImageToDB` **fail-closed**: sau `encryptImageData` phải `_looksEncrypted(storedData)` và session còn unlock trước khi mở transaction ghi `images`; lỗi mã hóa → không ghi, báo user, `resolve` (không treo loader).
- `encryptImageData` vẫn fail-open ở tầng crypto khi `!masterKey` (giữ cho migration); **caller ghi DB** chịu trách nhiệm từ chối plaintext.
- `handleFileUpload` snapshot `customerId`/`assetId`/`captureMode` **trước** `FileReader`; truyền vào `saveImageToDB(raw, opts)`.
- Gallery decrypt qua pool concurrency giới hạn (không `Promise.all` unbounded trên mọi ảnh).
- `closeLightbox` gỡ `src` lightbox + clear `currentImageBase64` (không giữ data URL lớn sau khi đóng).
- Required tests: thêm `tests/image-save-fail-closed.test.js` + tripwires `regressions.test.js`.

### 6.2 Mục **MapLibre / OSRM**

Thêm invariant:

- `renderMapMarkers` dùng render sequence token; bỏ dở nếu seq lệch sau await.
- Index ảnh theo `assetId`/`customerId` (Map) — không `allImages.find` lồng trong vòng asset.
- Feature decrypt jobs bounded concurrency.

### 6.3 Mục **DVHC Lookup**

Trong Core invariants / UI:

- `refreshIcons()` phải `lucide.createIcons({ root: screenEl | #screen-dvhc-lookup })` — cấm unscoped trên render path.

### 6.4 Mục **UI architecture** (Lucide)

Nhắc lại: mọi render path (kể cả ĐVHC) scope `root`; unscoped chỉ boot (`10_bootstrap.js`).

### 6.5 Mục **Versioning / Release**

Sau bump, mô tả vẫn đúng quy trình; không cần ghi số version cứng trong CLAUDE trừ chỗ nói “đọc `package.json`”.

### 6.6 Mục **Directory structure** nếu có

Nếu thêm `docs/plans/` — có thể ghi một dòng `docs/plans/` (plan nội bộ) **hoặc** xóa file plan này khỏi repo trước release nếu team không muốn track plans.  
**Quyết định mặc định:** giữ plan trong PR lần này; Opus có thể **xóa** `docs/plans/2026-07-28-opus5-image-map-perf-cleanup.md` ở commit cuối **sau khi** hoàn thành (plan đã nằm trong PR body), để repo không phình docs tạm — optional.

### 6.7 Không viết lại toàn bộ CLAUDE.md từ đầu

Chỉ patch các section trên + bất kỳ chỗ nào mô tả mâu thuẫn với code sau fix. Đọc section liên quan, sửa cho đúng, dừng.

---

## 7. Phase 6 — Bump version đầy đủ → `1.4.4`

### 7.1 Semver + ASSET_V

1. `package.json` → `"version": "1.4.4"`
2. `sw.js` → `ASSET_V = 'IMAGE_MAP_PERF_20260728'` (đổi tag nếu ngày khác)
3. Chạy: `npm run sync:version`
4. Chạy: `npm run check:version`
5. **Tay** đồng bộ mọi `?v=` trong `index.html` = ASSET_V mới
6. `assets/03_map.js` → `MAPLIBRE_V` = ASSET_V
7. `assets/01_config.js` → `LAZY_MODULES_V` = ASSET_V
8. Confirm `manifest.json` version, `assets/pwa.js` `SW_BUILD`, `README` badge/version text đã sync
9. `node scripts/check-policy.mjs`

### 7.2 Không bump

- IndexedDB schema version (giữ 5)
- Crypto schema / `IMG_SCHEMA_DONE` / field encrypt markers
- `TOUR_VERSION`
- Backup format version

---

## 8. Phase 7 — Verify (Definition of Done)

Chạy tuần tự, tất cả phải xanh:

```bash
npm test
node --check sw.js
find assets -name '*.js' -print0 | xargs -0 -n1 node --check
node scripts/check-policy.mjs
npm run check:version
npm run test:e2e
```

Checklist thủ công trước khi nhờ review:

- [ ] Tripwire B #7 `saveImageToDB` oncomplete/onerror/onabort vẫn pass
- [ ] Không còn ghi ảnh khi encrypt fail / locked
- [ ] Upload nhiều ảnh rồi đổi hồ sơ giữa chừng → ảnh vẫn thuộc hồ sơ lúc chọn
- [ ] Mở map 2 lần nhanh không nhân đôi marker
- [ ] ĐVHC search không scan Lucide toàn app (devtools optional)
- [ ] Đóng lightbox không giữ preview lớn (Memory optional)
- [ ] CLAUDE.md khớp invariants mới
- [ ] Diff không đụng `02_security.js` crypto core / backup / activation
- [ ] PR mở **draft**, không merge

---

## 9. Phân commit gợi ý

1. `fix(images): fail-closed saveImageToDB + snapshot id trước FileReader`
2. `perf(images): pool decrypt gallery + giới hạn compress loop`
3. `fix(ui): clear lightbox plaintext refs on close`
4. `perf(map): render seq + image index + bounded jobs`
5. `perf(dvhc): scope lucide.createIcons to screen root`
6. `test: image save fail-closed + regression tripwires`
7. `docs: README/tests README/.gitignore hygiene; CLAUDE.md invariants`
8. `chore(release): bump 1.4.4 ASSET_V IMAGE_MAP_PERF_20260728`

---

## 10. Out of scope (ghi rõ để Opus không làm)

| Ý tưởng | Lý do bỏ |
|---|---|
| Virtualize customer list | Phức tạp a11y; chunk 25 đã đủ cho hầu hết CB |
| Bỏ PDF/MapLibre khỏi SW precache | Phá offline toolkit |
| Đổi Lighthouse threshold | Không liên quan correctness lần này |
| Refactor globals → ES modules | Ngoài kiến trúc zero-build |
| Đổi `encryptImageData` fail-closed global | Phá migration / callers |
| Xóa regression tests “trùng” | Không trùng — mỗi file cover race khác |
| Touch auto-backup / unlock / auth gate | Vừa harden xong trên 1.4.3 |

---

## 11. Tiêu chí chấp nhận (cho reviewer / user)

1. Không còn đường `saveImageToDB` ghi data URL plaintext khi mất khóa / encrypt lỗi.  
2. Upload file không gắn nhầm KH/TSBĐ khi đổi hồ sơ giữa lúc đọc file.  
3. Gallery/map đỡ đỉnh CPU/RAM trên máy yếu (bounded concurrency + map index).  
4. ĐVHC không `createIcons()` unscoped.  
5. Repo sạch docs drift; **không** mất test/regression.  
6. `CLAUDE.md` mô tả đúng hành vi mới.  
7. Version `1.4.4` + ASSET_V đồng bộ toàn bộ; CI xanh.

---

## 12. Prompt ngắn để dán cho Opus 5

```text
Thực hiện đúng docs/plans/2026-07-28-opus5-image-map-perf-cleanup.md trên repo ClientPro.
Đọc toàn bộ CLAUDE.md trước. Baseline 1.4.3.
Chỉ làm Phase 1→7 trong plan; cấm đụng crypto core/backup/activation/SW strategy.
Không xóa test hiện có. Cleanup chỉ docs/.gitignore như §5.
Sau khi xong: bump 1.4.4 + ASSET_V IMAGE_MAP_PERF_*, sync version đầy đủ, chạy npm test + check-policy + test:e2e.
Commit theo §9. Mở PR draft, không merge.
Neo edit theo tên hàm; số dòng trong plan chỉ là gợi ý baseline 8007c0c.
```

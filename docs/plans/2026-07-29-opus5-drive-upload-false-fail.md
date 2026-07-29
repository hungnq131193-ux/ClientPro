# Plan cho Opus 5 — Fix báo lỗi giả khi upload ảnh Drive đã thành công + bump 1.4.5

> **Baseline:** `main` @ `4fd357f`, semver `1.4.4`, `ASSET_V = IMAGE_MAP_PERF_20260728`.  
> **Mục tiêu sau PR:** `1.4.5`, `ASSET_V = DRIVE_UPLOAD_STATUS_20260729` (hoặc ngày thực thi).  
> **Số dòng** dưới đây đúng tại baseline trên. Opus **phải đọc lại hàm bằng tên** trước khi edit; nếu lệch dòng thì neo theo **tên hàm**, không theo số dòng cứng.  
> **Tham chiếu code trong CLAUDE.md / PR description:** luôn dùng `file + function`, không hard-code line number.

---

## 0. Triệu chứng (user report)

Khi bấm tải ảnh hồ sơ / ảnh tài sản lên Google Drive:

1. Ảnh **đã xuất hiện trên Drive** (folder + file thật).
2. App vẫn toast **「Tải ảnh lên Drive thất bại…」**.
3. Lỗi **thi thoảng** (không phải mọi lần) — thường khi nhiều ảnh, mạng mobile yếu, hoặc tab bị ẩn giữa lúc upload.

Đây là **false-negative phía client**: server/GAS đã ghi Drive xong, nhưng client không phân loại được phản hồi / ném catch chung và báo thất bại tuyệt đối.

---

## 1. Root cause (đã đối chiếu code)

### 1.1 Luồng hiện tại (entry points)

| Entry | File | Hàm |
|---|---|---|
| Upload ảnh hồ sơ | `assets/07_drive.js` | `uploadToGoogleDrive` |
| Upload ảnh tài sản | `assets/07_drive.js` | `uploadAssetToDrive` |
| Phân loại kết quả từng ảnh | `assets/07_drive.js` | `_splitUploadResults` |
| Server upload | `gas/UserDriveAPI.gs` | `handleUploadImages_` (v4) |

Cả hai client path cùng pattern:

```text
decryptImageData(all) → fetch(POST JSON tới User GAS)
  → response.json()
  → _splitUploadResults(result, imagesToUpload)
       ├─ split truthy → persist driveLink → success/partial toast → hỏi xóa ảnh gốc
       └─ split null   → throw → catch → ErrorHandler.showError('BACKUP', "Tải ảnh lên Drive thất bại…")
  (mọi exception khác cũng rơi cùng catch trên)
```

### 1.2 Nguyên nhân chính A — Network/parse sau khi Drive đã nhận file (khớp “thi thoảng”)

Trong `uploadToGoogleDrive` / `uploadAssetToDrive`:

```js
const response = await fetch(scriptUrl, { method: "POST", body: JSON.stringify(payload) });
const result = await response.json();
```

- Payload ảnh = data URL base64 → **lớn**, GAS xử lý tuần tự từng ảnh (`handleUploadImages_` tạo file Drive trong vòng `for`).
- Trên Android Chrome (PWA standalone), khi:
  - mạng chập chờn / timeout trình duyệt,
  - user ẩn tab → OS suspend network socket,
  - GAS redirect `/exec` → googleusercontent trả body rỗng / HTML lỗi thoáng qua,
  - `response.json()` gặp body không phải JSON,
  → `fetch` hoặc `response.json()` **ném exception**.
- **Lúc này file có thể đã nằm trên Drive** (server chạy xong hoặc gần xong trước khi response về client).
- Catch hiện tại **luôn** nói thất bại tuyệt đối — không phân biệt “server từ chối” vs “không nhận được xác nhận”.

Đây là nguyên nhân **#1** khớp triệu chứng: Drive có ảnh, app báo fail, thi thoảng.

### 1.3 Nguyên nhân chính B — `_splitUploadResults` fail-closed quá cứng → coi thành công/partial thành thất bại toàn bộ

Hàm `_splitUploadResults` (baseline ~L230–242):

```js
function _splitUploadResults(result, imagesToUpload) {
    if (!result || (result.status !== 'success' && result.status !== 'partial')) return null;
    const files = Array.isArray(result.files) ? result.files : null;
    if (files && files.length === imagesToUpload.length) {
        const succeeded = imagesToUpload.filter((img, i) => files[i] && files[i].id && !files[i].error);
        if (succeeded.length === 0) return null;
        return { succeeded, failedCount: imagesToUpload.length - succeeded.length };
    }
    if (result.status === 'success' && !(Number(result.failed) > 0)) {
        return { succeeded: imagesToUpload.slice(), failedCount: 0 };
    }
    return null; // ← NGUY HIỂM
}
```

Các ca trả `null` dù Drive đã có file:

| Ca | Điều kiện | Hệ quả |
|---|---|---|
| B1 | `status === 'partial'` nhưng `files.length !== imagesToUpload.length` (GAS cũ / body JSON cụt / client lệch) | `return null` → toast thất bại toàn bộ, trong khi `files[].id` vẫn có |
| B2 | `status === 'success'` kèm `failed > 0` (server v3/v4 lệch) và files length không khớp | `return null` |
| B3 | `status` lạ / thiếu nhưng `result.url` + một số `files[].id` có | `return null` |

GAS v4 (`handleUploadImages_`) **đã** trả `files` 1:1 và `status` thật — nhưng client vẫn có nhánh “không chắc → null → thất bại tuyệt đối”, trong khi an toàn hơn là: **có `id` thì coi ảnh đó đã lên**, chỉ fail-closed việc **xóa ảnh gốc** (không xóa khi không chắc), chứ không được nói “upload thất bại” khi đã thấy `id`/`url`.

### 1.4 Nguyên nhân phụ C — Không validate plaintext sau `decryptImageData` (auto-lock giữa chừng)

Cả hai upload path:

```js
data: (typeof decryptImageData === 'function') ? await decryptImageData(img.data) : img.data,
```

- Không kiểm tra kết quả là data URL ảnh plaintext.
- Auto-lock giữa `Promise.all(decrypt…)`: `decryptFieldAsync` / `decryptImageData` với generation stale trả **ciphertext** (theo invariant `02_security.js`) — **không throw**.
- Client vẫn POST ciphertext lên GAS → `Utilities.base64Decode` lỗi từng ảnh → `status: 'error'` / partial; folder `CLIENTPRO_IMAGES/...` **vẫn được tạo** trước vòng upload.
- User mở Drive thấy folder (và có thể vài ảnh đã decrypt kịp) → tưởng “đã lên”, app báo thất bại.

### 1.5 Nguyên nhân phụ D — Catch chung nuốt cả lỗi sau khi upload OK

Sau `_splitUploadResults` truthy, mọi throw từ `persistCurrentCustomer` (ngoài nhánh `ok===false` đã có message đúng), `renderDriveStatus` / `renderAssetDriveStatus`, hoặc `ErrorHandler.confirm`… đều rơi vào:

```js
ErrorHandler.showError('BACKUP', "Tải ảnh lên Drive thất bại…", err);
```

→ User nghe “upload thất bại” dù Drive đã có file + có khi link đã lưu.  
(Nhánh `ok === false` đã đúng: *「Ảnh đã lên Drive nhưng CHƯA lưu được link…」* — giữ nguyên.)

### 1.6 Không phải nguyên nhân (để Opus khỏi “sửa nhầm”)

| Nghi ngờ | Kết luận |
|---|---|
| Service Worker nuốt POST | `sw.js` chỉ handle GET — POST GAS không bị SW đụng |
| Thiếu `action:'upload'` ở asset upload | GAS auto-detect `data.images` → `upload` (giữ nguyên) |
| Token seal / `getUserToken` cache | `primeFieldCache` đã prime token sau unlock; thiếu token → Unauthorized **trước** khi tạo file — không khớp “Drive đã có ảnh” |
| Đổi endpoint / CSP / crypto schema | Không liên quan false-negative này |
| Auto-backup (`16_auto_backup_drive.js`) | Flow khác (backup `.cpb`); **out of scope** lần này |

### 1.7 Tóm tắt chẩn đoán một câu

**App báo thất bại vì client (1) coi mọi lỗi mạng/parse sau POST là “upload fail”, và (2) `_splitUploadResults` trả `null` dù response/Drive đã có file — trong khi GAS thường đã tạo folder/file trước khi client nhận được JSON sạch.**

---

## 2. Hợp đồng an toàn (đọc trước khi đụng code)

### 2.1 Được phép đụng

| Khu vực | File |
|---|---|
| Upload ảnh Drive (client) | `assets/07_drive.js` — chỉ các hàm liệt kê ở §3 |
| Tests / tripwire | `tests/drive-upload-results.test.js` (**mới**), `tests/regressions.test.js` (thêm tripwire nhỏ) |
| Canonical map | `CLAUDE.md` — mục **Google Drive integration** (invariants upload status) |
| Version bump đầy đủ | `package.json`, `sw.js` (`ASSET_V` + `VERSION` qua sync), mọi `?v=` `index.html`, `MAPLIBRE_V`, `LAZY_MODULES_V`, `manifest.json`, `assets/pwa.js`, `README.md` |

### 2.2 CẤM tuyệt đối

- **Không** đụng: activation, PIN/unlock lifecycle, `02_security.js`, IndexedDB schema/version, backup format, auto-backup (`16_auto_backup_drive.js`), cloud transfer, CSP, SW **caching strategy**, theme, weather, donate, onboarding, PDF Toolkit, DVHC, map, images camera save path.
- **Không** đổi URL endpoint GAS, ACCESS_TOKEN protocol, field names `url` / `folderUrl` / `files` / `failed` / `status` mà app đang đọc.
- **Không** bắt buộc user redeploy GAS để fix client false-negative (fix phải tương thích GAS v3 **và** v4 đang document trong comment `_splitUploadResults`).
- **Không** sửa `gas/UserDriveAPI.gs` trong PR này trừ khi phát hiện bug protocol mới **chặn** fix client — mặc định **không sửa GAS**.
- **Không** hard-code prefix `cpg1:` — dùng `_looksEncrypted` / kiểm tra `data:image/…;base64,`.
- **Không** xóa test hiện có; **không** merge PR; **không** commit secrets.
- **Không** dùng `innerHTML` với data động mới; không thêm CDN; không `alert`/`confirm` native.

### 2.3 Nguyên tắc UX sau fix

1. Có bằng chứng ảnh đã lên (`files[i].id` hoặc `status==='success'` không `failed`) → **không** được toast “thất bại” tuyệt đối.
2. Không chắc (mạng/parse) → toast **cảnh báo** kiểu: chưa nhận được xác nhận; hãy mở Drive / dùng 「Tìm kết nối cũ」; **không** xóa ảnh gốc.
3. Server từ chối rõ (`status==='error'`, Unauthorized, validation) → mới được báo thất bại thật.
4. Chỉ xóa ảnh gốc khi `_splitUploadResults` (hoặc equivalent) chỉ ra đúng subset đã có `id`.

---

## 3. Thứ tự thực thi (bắt buộc tuần tự)

```
A. Branch từ main mới nhất
B. Phase 1 — Helper thuần: parse response + harden _splitUploadResults + validate ảnh plaintext
C. Phase 2 — Gắn helper vào uploadToGoogleDrive + uploadAssetToDrive (phân loại lỗi / message)
D. Phase 3 — Unit tests + tripwires regressions
E. Phase 4 — CLAUDE.md (mục Google Drive integration)
F. Phase 5 — Bump version đầy đủ 1.4.5 + ASSET_V mới
G. Phase 6 — Verify (syntax, policy, unit, e2e) rồi mới Done
```

Mỗi phase: commit riêng. **Không** gộp version bump vào commit fix logic.

Suggested branch: `cursor/drive-upload-false-fail-b819` (hoặc template cloud agent hiện hành).

---

## 4. Phase 1 — Helper trong `assets/07_drive.js`

Giữ helpers **cùng file** (không tạo module mới, không đổi script order). Đặt ngay trên `_splitUploadResults` (cùng cụm upload).

### 4.1 `_isPlainImageDataUrlForUpload(s)` (helper cục bộ)

```js
function _isPlainImageDataUrlForUpload(s) {
  return typeof s === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(s);
}
```

- Không import từ `02_security.js` (function đó không global).
- Không hard-code `cpg1:`.

### 4.2 `_resolveImagesForDriveUpload(imagesToUpload, namePrefix)`

Thay khối `Promise.all(imagesToUpload.map(... decryptImageData ...))` trùng ở cả hai upload path.

Yêu cầu:

1. `await decryptImageData` từng ảnh (giữ thứ tự index).
2. Sau mỗi ảnh (hoặc sau cả batch, trước `fetch`):
   - Nếu `typeof isAppUnlocked === 'function' && !isAppUnlocked()` → throw error có `code: 'SESSION_LOCKED'` (hoặc message ổn định để classify).
   - Nếu data không `_isPlainImageDataUrlForUpload` **hoặc** `_looksEncrypted(data)` → throw `code: 'IMAGE_DECRYPT_FAILED'` — **không POST**.
3. Trả `{ name: `${namePrefix}_${Date.now()}_${idx}.jpg`, data }` như hiện tại (`asset_img_` / `hoso_`).

Mục tiêu: chặn nguyên nhân C **trước** khi tạo folder/file rác trên Drive.

### 4.3 `_parseUserDriveJsonResponse(response)` 

```js
async function _parseUserDriveJsonResponse(response) {
  // 1) Đọc text trước (không json() trực tiếp)
  // 2) Trim; nếu rỗng → error kind 'EMPTY_BODY'
  // 3) JSON.parse try/catch → kind 'BAD_JSON' kèm snippet ngắn (không log raw ảnh)
  // 4) Trả object đã parse; không throw vì !response.ok nếu body đã là JSON có status
  //    (GAS đôi khi non-2xx + JSON; ưu tiên đọc status trong body)
}
```

Caller quyết định theo `result.status`.

### 4.4 Harden `_splitUploadResults(result, imagesToUpload)`

Giữ tên hàm + semantics “chỉ liệt kê ảnh chắc chắn lên để xóa gốc”. Đổi nhánh fail:

**Trước (bug):** length mismatch / partial → `null` (caller = thất bại toàn bộ).

**Sau:**

1. Nếu `!result` → `null`.
2. Nếu có `Array.isArray(result.files)`:
   - Với mỗi index `i < min(files.length, imagesToUpload.length)`: thành công khi `files[i] && files[i].id && !files[i].error`.
   - Nếu `succeeded.length > 0` → `{ succeeded, failedCount: imagesToUpload.length - succeeded.length }` **kể cả** khi `files.length !== imagesToUpload.length` hoặc `status === 'partial'|'success'`.
   - Nếu `succeeded.length === 0` và `status` không phải success/partial tin được → `null`.
3. Fallback cũ (server không có `files` / length lệch hoàn toàn):  
   `status === 'success' && !(Number(result.failed) > 0)` → mọi ảnh succeeded (GAS v3).
4. **Mới — bằng chứng folder:** nếu vẫn chưa có succeeded nhưng `result.url` (hoặc `folderUrl`) là string `http` **và** `status === 'success'` → coi mọi ảnh succeeded (giữ hành vi v3).  
   Nếu `status === 'partial'` + có `url` nhưng không map được file → trả `{ succeeded: [], failedCount: imagesToUpload.length, uncertain: true }` **hoặc** để caller dùng nhánh “có url nhưng không chắc ảnh nào” — **quan trọng:** caller **không** xóa ảnh gốc, **không** nói thất bại tuyệt đối; dùng warning + gợi ý Tìm lại link.
5. Chỉ `null` khi không có bằng chứng nào (`status === 'error'` / Unauthorized / không url / không id).

API trả về đề xuất (giữ backward compatible tối thiểu):

```ts
{ succeeded: Image[], failedCount: number, uncertain?: boolean }
// null = thất bại thật / không có bằng chứng lên Drive
```

### 4.5 `_classifyDriveUploadFailure(err, result)` (optional nhỏ)

Trả `'REJECTED' | 'UNCONFIRMED' | 'SESSION' | 'DECRYPT'` để chọn toast:

| Kind | Toast | Type |
|---|---|---|
| REJECTED | Thất bại (server từ chối / 0 file) | `showError` |
| UNCONFIRMED | Không nhận được xác nhận — kiểm tra Drive / Tìm kết nối cũ; ảnh gốc còn trên máy | `showWarning` |
| SESSION | App đã khóa giữa chừng — mở khóa rồi tải lại | `showWarning` |
| DECRYPT | Không giải mã được ảnh — chưa gửi lên Drive | `showWarning` |

---

## 5. Phase 2 — Gắn vào hai hàm upload (chỉ `07_drive.js`)

### 5.1 `uploadToGoogleDrive`

**Hàm:** `uploadToGoogleDrive`  
**Đổi gì:**

1. Thay `Promise.all(...decrypt...)` bằng `_resolveImagesForDriveUpload(imagesToUpload, 'hoso')`.
2. Thay `response.json()` bằng `_parseUserDriveJsonResponse(response)`.
3. `_splitUploadResults`:
   - truthy + `succeeded.length > 0` → giữ flow persist link + success/partial + hỏi xóa **chỉ** `succeeded` (như hiện tại).
   - truthy + `uncertain` / `succeeded.length === 0` nhưng có `result.url` → persist link nếu có url; **warning** (không success); **không** hỏi xóa ảnh gốc.
   - `null` + `result && result.status === 'error'` → thất bại thật (`showError`), message từ `result.message` nếu an toàn.
4. `catch`:
   - Phân loại bằng `_classifyDriveUploadFailure` / `ErrorHandler.classify`.
   - Network / `EMPTY_BODY` / `BAD_JSON` / `Failed to fetch` / timeout → **UNCONFIRMED** (`showWarning`), **không** `showError('BACKUP', '…thất bại')`.
   - SESSION / DECRYPT → message đúng §4.5.
   - Chỉ REJECTED mới dùng wording thất bại.
5. Giữ nguyên: confirm trước upload, folderName qua `_displayPlainAsync`, `persistCurrentCustomer` await + message “đã lên nhưng chưa lưu link”, `_deleteSucceededUploadsOnly`.

### 5.2 `uploadAssetToDrive`

Mirror **cùng** thay đổi như §5.1 (prefix `asset_img`, `persist` vào `assets[assetIndex].driveLink`, `renderAssetDriveStatus`, `loadAssetImages`).

Không copy-paste lệch message: dùng chung helper classify.

### 5.3 Không đổi

- `reconnectDriveFolder` / `reconnectAssetDriveFolder` / `saveScriptUrl` / token seal / `renderDriveStatus` HTML tĩnh hiện có (trừ khi cần gọi lại sau persist — đã có).
- `gas/UserDriveAPI.gs`
- Nút `data-action` / `00_globals.js` (đã wire sẵn)

### 5.4 Pseudo-diff định hướng (hoso path)

```diff
- const resolvedImages = await Promise.all(imagesToUpload.map(async (img, idx) => ({
-   name: `hoso_${Date.now()}_${idx}.jpg`,
-   data: (typeof decryptImageData === 'function') ? await decryptImageData(img.data) : img.data,
- })));
+ const resolvedImages = await _resolveImagesForDriveUpload(imagesToUpload, 'hoso');

  try {
    const response = await fetch(scriptUrl, { method: "POST", body: JSON.stringify(payload) });
-   const result = await response.json();
+   const result = await _parseUserDriveJsonResponse(response);
    const split = _splitUploadResults(result, imagesToUpload);
    if (split && split.succeeded.length > 0) {
      // ... persist + success/partial + delete confirm (như cũ)
    } else if (split && split.uncertain && result && result.url) {
+     // persist link best-effort; showWarning; KHÔNG xóa ảnh gốc
    } else if (result && result.status === 'error') {
+     throw Object.assign(new Error(result.message || 'REJECTED'), { code: 'REJECTED' });
    } else {
-     throw new Error(result && result.message ? result.message : 'Tải ảnh lên Drive thất bại');
+     throw Object.assign(new Error('UNCONFIRMED'), { code: 'UNCONFIRMED' });
    }
  } catch (err) {
    LoadingManager.hideGlobal(true);
-   ErrorHandler.showError('BACKUP', "Tải ảnh lên Drive thất bại...", err);
+   // classify → showWarning UNCONFIRMED/SESSION/DECRYPT hoặc showError REJECTED
  }
```

---

## 6. Phase 3 — Tests

### 6.1 Unit mới: `tests/drive-upload-results.test.js`

Vì app không export ES module, **mirror pattern** test pure bằng cách:

- **Cách A (ưu tiên):** extract logic thuần vào các hàm đã có trong `07_drive.js` và **duplicate minimal pure copy** trong test file *hoặc* `vm`/`fs.readFileSync` + `new Function` lấy body hàm (như `tests/regressions.test.js` `fnBody`) rồi eval trong sandbox;  
- **Cách B:** copy thuật toán `_splitUploadResults` mới vào test dưới tên `splitUploadResultsForTest` và thêm tripwire regressions bắt buộc source `07_drive.js` chứa các nhánh mới (string match).

**Minimum cases cho `_splitUploadResults`:**

1. `success` + `files` 1:1 đủ `id` → mọi ảnh succeeded, `failedCount=0`.
2. `partial` + một entry `error` → chỉ ảnh có `id` trong succeeded.
3. `partial` + `files.length !== images.length` nhưng có ít nhất một `id` → **không** `null`; succeeded = các ảnh map được; failedCount > 0.
4. `success` không có `files`, `failed` không > 0 → mọi ảnh succeeded (v3).
5. `error` không `id` → `null`.
6. (Nếu implement uncertain) `partial` + `url` không map file → không `null` tuyệt đối kiểu “xóa hết”; uncertain / succeeded rỗng + caller không xóa.

**Minimum cases parse (nếu test được):**

7. Body JSON hợp lệ → object.
8. Body rỗng / HTML → kind EMPTY_BODY / BAD_JSON (không throw nuốt thành “upload fail” string cũ).

### 6.2 Tripwire `tests/regressions.test.js`

Thêm 1–2 test structural (không chạy browser):

- `uploadToGoogleDrive` / `uploadAssetToDrive` **không** còn gọi `response.json()` trực tiếp (phải qua helper parse text).
- Source chứa nhánh UNCONFIRMED / warning khi không confirm được (string ổn định Opus chọn — ghi rõ trong test).
- Vẫn giữ tripwire B #6 folderName `_displayPlainAsync` (không phá).

### 6.3 E2E

- Không bắt buộc spec mới (Drive/GAS thật không có trong CI).
- Chạy full `npm run test:e2e` ở Phase 6 để đảm bảo không regress smoke/crud.

---

## 7. Phase 4 — `CLAUDE.md`

Chỉ patch mục **Google Drive integration** (Core invariants). Không viết changelog dài.

Thêm invariants (diễn đạt ngắn):

- Sau POST upload ảnh, client **không** được báo thất bại tuyệt đối khi mạng/parse lỗi: phải phân biệt UNCONFIRMED (gợi ý mở Drive / Tìm kết nối cũ, không xóa ảnh gốc) vs REJECTED (server `status=error`).
- `_splitUploadResults` map theo index; nếu `files.length` lệch vẫn nhận các entry có `id`; chỉ fail-closed việc **xóa ảnh gốc**, không fail-closed toast khi đã có bằng chứng lên Drive.
- Trước POST: mọi `decryptImageData` phải ra data URL plaintext; session vẫn unlock — không gửi ciphertext lên GAS.
- Required tests: `tests/drive-upload-results.test.js` + tripwire regressions.

**Must not affect** giữ nguyên: crypto schema, backup format, GAS endpoints.

---

## 8. Phase 5 — Bump version đầy đủ → `1.4.5`

### 8.1 Semver + ASSET_V

1. `package.json` → `"version": "1.4.5"`
2. `sw.js` → `ASSET_V = 'DRIVE_UPLOAD_STATUS_20260729'` (đổi ngày nếu thực thi ngày khác)
3. `npm run sync:version`
4. `npm run check:version`
5. **Tay** đồng bộ mọi `?v=` trong `index.html` = ASSET_V mới
6. `assets/03_map.js` → `MAPLIBRE_V` = ASSET_V
7. `assets/01_config.js` → `LAZY_MODULES_V` = ASSET_V
8. Confirm `manifest.json` version, `assets/pwa.js` `SW_BUILD`, badge/version trong `README.md`
9. `node scripts/check-policy.mjs`

### 8.2 Không bump

- IndexedDB schema version (giữ 5)
- Crypto schema / `IMG_SCHEMA_DONE` / field markers
- `TOUR_VERSION`
- Backup format version
- `BUILD_TAG` trong `gas/UserDriveAPI.gs` (không sửa GAS)

---

## 9. Phase 6 — Verify (Definition of Done)

```bash
npm test
node --check sw.js
find assets -name '*.js' -print0 | xargs -0 -n1 node --check
node scripts/check-policy.mjs
npm run check:version
npm run test:e2e
```

Checklist:

- [ ] Upload nhiều ảnh + mạng chậm: nếu Drive có file, app **không** còn toast thất bại tuyệt đối (UNCONFIRMED/partial/success đúng)
- [ ] Auto-lock giữa decrypt: **không** POST ciphertext; warning SESSION/DECRYPT
- [ ] Partial thật: chỉ xóa ảnh có `id`; ảnh lỗi giữ lại
- [ ] Persist link fail: vẫn message “đã lên Drive nhưng chưa lưu link”
- [ ] Tripwire B #6 folderName vẫn pass
- [ ] Diff **chỉ** `07_drive.js` + tests + CLAUDE.md + version files (+ optional xóa plan doc)
- [ ] Không đụng `02_security.js` / `16_auto_backup_drive.js` / `gas/*` / SW strategy
- [ ] PR draft, không merge

---

## 10. Phân commit gợi ý

1. `fix(drive): harden split upload results + parse GAS response an toàn`
2. `fix(drive): validate plaintext ảnh + phân loại UNCONFIRMED vs REJECTED khi upload`
3. `test: drive upload results + regression tripwires`
4. `docs(claude): invariants trạng thái upload ảnh Drive`
5. `chore(release): bump 1.4.5 ASSET_V DRIVE_UPLOAD_STATUS_20260729`

Optional cuối: xóa `docs/plans/2026-07-29-opus5-drive-upload-false-fail.md` khỏi tree nếu team không muốn giữ plan (plan đã nằm trong PR body) — giống optional của plan 1.4.4.

---

## 11. Out of scope

| Ý tưởng | Lý do bỏ |
|---|---|
| Sửa `16_auto_backup_drive.js` cùng pattern `response.json()` | Flow backup khác; tránh đụng invariant auto-backup vừa harden ở 1.4.3 |
| Đổi `UserDriveAPI.gs` / bắt user redeploy | Client fix phải chạy với GAS v3/v4 hiện có |
| Upload chunked / resume / multipart | Kiến trúc lớn, ngoài triage false-negative |
| Đổi CSP hoặc proxy GAS | Không cần |
| Refactor toàn bộ Drive thành class/module | Ngoài zero-build globals architecture |
| Touch unlock / image save / map | Không liên quan |

---

## 12. Tiêu chí chấp nhận

1. Không còn đường catch mạng/parse nào gắn cứng 「Tải ảnh lên Drive thất bại」 khi không chứng minh được server từ chối.  
2. `_splitUploadResults` không `null`-hóa khi đã có ít nhất một `files[i].id`.  
3. Không POST ảnh còn ciphertext / khi session đã khóa.  
4. Ảnh gốc chỉ xóa khi chắc `id`.  
5. Unit + tripwire xanh; e2e không regress.  
6. `CLAUDE.md` khớp invariant mới.  
7. Version **`1.4.5`** + `ASSET_V` đồng bộ toàn bộ (`check:version` + `check-policy`).

---

## 13. Prompt ngắn để dán cho Opus 5

```text
Thực hiện đúng docs/plans/2026-07-29-opus5-drive-upload-false-fail.md trên repo ClientPro.
Đọc toàn bộ CLAUDE.md trước. Baseline 1.4.4 @ 4fd357f.
Bug: upload ảnh Drive đã thành công (file có trên Drive) nhưng app thi thoảng báo thất bại.
Root cause: (A) fetch/response.json lỗi sau khi GAS đã ghi file; (B) _splitUploadResults return null dù đã có files[].id; (C) không validate plaintext sau decryptImageData trước POST.
Chỉ sửa assets/07_drive.js (+ tests + CLAUDE.md Drive section + bump 1.4.5).
CẤM đụng 02_security, gas/*, 16_auto_backup_drive, activation/unlock, SW strategy, CSP, IndexedDB schema.
Làm Phase 1→6; commit theo §10; bump version đầy đủ ASSET_V DRIVE_UPLOAD_STATUS_*; sync mọi ?v=/MAPLIBRE_V/LAZY_MODULES_V; npm test + check-policy + test:e2e.
Mở PR draft, không merge. Neo theo tên hàm.
```

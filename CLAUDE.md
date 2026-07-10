# CLAUDE.md — Single Source of Truth của ClientPro

> **Đọc hết file này trước khi phân tích/sửa code.** Nó đủ để làm hầu hết task (debug, feature, refactor) mà **không cần đọc từng file `.js`** — chỉ mở code gốc khi cần verify chi tiết cụ thể. Sau thay đổi lớn (module mới, đổi architecture/security/PWA/API), **PHẢI cập nhật file này** trong cùng commit (xem §9).

## 1. Tổng quan & Triết lý

**ClientPro** = PWA tĩnh thuần (vanilla JS ES6+, không framework, không build step) quản lý **khách hàng (KH)** + **tài sản bảo đảm (TSBĐ)**, tối ưu mobile. Không backend; dữ liệu lưu cục bộ (IndexedDB) và **mã hóa**; mở khóa bằng PIN hoặc WebAuthn PRF (Face ID/vân tay); offline-first qua Service Worker; deploy static trên Vercel với CSP nghiêm ngặt.

- **Phiên bản**: 1.5.9 — nguồn duy nhất `package.json`, đồng bộ bằng `npm run sync:version` (§7).
- **License**: Proprietary — All Rights Reserved (tác giả Nguyễn Quốc Hưng). Demo: https://client-pro-beryl.vercel.app

**Triết lý** (soi mọi thay đổi vào đây):
1. **Privacy/local-first**: không gửi dữ liệu đi đâu trừ khi user chủ động backup lên Google Drive **cá nhân của họ**. Không telemetry, không account trung tâm.
2. **Self-contained**: chạy từ static server bất kỳ (`python3 -m http.server` / `npx serve`), zero-dependency runtime, không build.
3. **Mobile gesture first**: slide transition mượt, edge back-swipe custom, camera tích hợp.
4. **Bản đồ miễn phí mà chính xác**: MapLibre self-host + OSRM public router + cache + validation nghiêm ngặt.
5. **No framework**: vanilla JS + numbered modules + data-action delegation (bắt buộc do CSP `script-src 'self'`, không `unsafe-inline`).
6. **Versioning discipline**: CI fail nếu version lệch (§7).

## 2. Tech stack & Ràng buộc tuyệt đối

| Thành phần | Công nghệ |
|---|---|
| Frontend | Vanilla JS ES6+, HTML5, CSS3; Tailwind static build + `redesign.clientpro.css` |
| Bản đồ | MapLibre GL (self-host) + OSRM public + supercluster (self-host) |
| Mã hóa | WebCrypto AES-256-GCM (field, envelope `cpg1:`) + PBKDF2; CryptoJS self-host chỉ để đọc dữ liệu legacy |
| Icon / Font | Lucide self-host / Inter + Be Vietnam Pro (woff2 self-host, đủ tiếng Việt) |
| Biometric | WebAuthn PRF extension |
| Cloud | Google Drive + 2 Google Apps Script trong `gas/` (§6.9) |
| Weather / Donate | Open-Meteo (không key) / VietQR (Vietinbank 888886838888 - NGUYEN QUOC HUNG) |
| Storage | IndexedDB `QLKH_Pro_V4` + localStorage |
| Hosting | Vercel static, header trong `vercel.json` (§8) |

**Ràng buộc tuyệt đối (không được vi phạm)**:
- **Không CDN**: lib mới tải minified về `assets/vendor/` (font về `assets/fonts/`), cập nhật `index.html` + CSP. CI chặn unpkg/jsdelivr/cdnjs/Google Fonts.
- **Không inline handler**: mọi UI interaction dùng `data-action`, khai báo trong bảng `CLICK_ACTIONS`/`CHANGE_ACTIONS` ở `00_globals.js` (§3).
- **API/domain mới** → cập nhật `connect-src`/`img-src` trong `vercel.json`.
- **Version sync** đúng quy trình §7 — CI fail nếu lệch.
- **Encrypt trước khi lưu** mọi field nhạy cảm; không bao giờ bypass auth gate; tuân thủ quy tắc field cipher R1–R5 (§5).
- **Không `alert()`/`confirm()`/`console.error` thô** — dùng tầng `19_error_loading.js` (§6.7).

## 3. Kiến trúc SPA & Module

**Màn hình** (`index.html`, toggle bằng class `translate-x-full` + `hidden`): `#screen-dashboard`, `#screen-customer-list`, `#screen-map`, `#screen-folder` (chi tiết KH: tabs info/images/assets), `#screen-asset-gallery`, `#lightbox`. Animation: `slideScreenIn(el)` / `slideScreenOut(el, cb)` / `afterTransition(el, cb)` (`UI_SLIDE_MS = 300`) — **tránh việc nặng** (decrypt list lớn, render map) trong 300ms transition để tránh jank.

**Load order** (`<script defer>` trong `index.html`, số nhỏ = nền tảng):
```
ui/load_modals → 00_globals → 01_config → 02_security → 12_backup_core
→ 13_ui_select_customers → 15_auth_gate → 03_map → 04_ui_common
→ 19_error_loading (ngay sau 04, trước mọi module nghiệp vụ)
→ 05_customers → 06_assets → 08_images_camera
→ 09_menu / 09_backup_manager / 09_donate / 09_weather (cùng priority)
→ 07_drive → 14_cloud_transfer → 16_auto_backup_drive
→ 17_onboarding_tour → 18_biometric_unlock → 10_bootstrap
→ 11_edge_back_swipe → pwa.js
```
Module mới: chọn số hợp lý, thêm `<script defer src="./assets/NN_x.js?v=ASSET_V">` đúng vị trí dependency, thêm vào precache `sw.js`, cập nhật CLAUDE.md.

**Data-action delegation** (`00_globals.js`): `data-action="saveCustomer"` → gọi `saveCustomer()`; `data-arg` → tham số (`setTheme(el.dataset.arg)`); namespace hỗ trợ (`data-action="DriveBackup.performNow"`). Bảng `CLICK_ACTIONS`/`CHANGE_ACTIONS` là nguồn duy nhất — handler mới **bắt buộc** khai báo vào đây.

## 4. Data model & Storage

**IndexedDB `QLKH_Pro_V4`** — stores: `customers`, `assets`, `images`, `notes`.
- Field nhạy cảm mã hóa AES-256-GCM envelope `"cpg1:..."` **trước khi** `put`. Dữ liệu legacy CryptoJS `"U2FsdGVk..."` vẫn đọc được, migrate dần; record đã GCM mang marker `cryptoV: 2`.
- **Customer**: `id, name, phone, address, lat, lng, status, approved, notes, images[], assets[], createdAt, updatedAt, employeeId?`
- **Asset (TSBĐ)**: `id, customerId, name, type, value/priceRef, description, link, valuation, loanValue, area, width, onland, year, lat/lng, images, status, createdAt`. `asset.name` theo thiết kế **không mã hóa ở lần ghi mới**, nhưng bản ghi cũ có thể còn ciphertext do migration (→ quy tắc R4 §5).
- Ảnh: dataURL, **mã hóa at-rest** `cpg1:` (từ v1.5.5, migration resume-safe khi mở khóa — `08_images_camera.js`).

**localStorage**: `PIN_KEY`/`SEC_KEY` (envelope niêm phong masterKey), `ACTIVATED_KEY`, `EMPLOYEE_KEY`, `app_theme`, `USER_SCRIPT_KEY`/`USER_TOKEN_KEY` (GAS cá nhân), `app_crypto_schema_v` (cờ migration), `app_error_log` (ring buffer), cache weather + road-distance.

**Data flow chuẩn**: form → `await encryptText()` (trước transaction) → IndexedDB `put` → kiểm tra kết quả ghi → refresh UI.

## 5. Bảo mật & Field Cipher (02_security, 15_auth_gate, 18_biometric_unlock)

**masterKey** (sentinel string để mọi check `!!masterKey`/`isAppUnlocked()` giữ nguyên):
- Mới: `"MK2:" + base64(32B crypto.getRandomValues)` → phái sinh `masterCryptoKey` (AES-GCM CryptoKey **non-extractable**) + `masterKeyBytes`. `generateMasterKey()` = CSPRNG MK2.
- Legacy: `"mk_..."` → giữ ở `masterKeyLegacy` để đọc CryptoJS cũ + kích hoạt migration.
- `_installMasterKey(mkStr)` (async) cài khóa vào phiên — gọi sau **mọi** unwrap thành công; xóa `__fieldPlainCache` khi đổi khóa. `clearMasterKeyMaterial()` xóa sạch khi wipe.

**API field cipher**:
- `encryptText(text)` — **ASYNC** → `"cpg1:" + base64url(iv[12] ‖ ct+tag)`, tự seed cache. **THROW nếu input đã trông như ciphertext** (guard chống double-encryption — lưới an toàn cuối cùng cho MỌI caller) → luôn bọc `try/catch`. Mã hóa **TRƯỚC** khi mở transaction IDB (await giữa transaction làm IDB tự commit).
- `decryptText(cipher)` — **SYNC**, 3 nhánh: `cpg1:` → đọc `__fieldPlainCache`; `U2FsdGVk…` → CryptoJS legacy (`masterKeyLegacy`); còn lại → passthrough. **Cache-miss `cpg1:` fail-open: trả nguyên ciphertext** (không throw, không blank).
- `decryptFieldAsync(cipher)` — async, giải mã thật (WebCrypto) + seed cache, dedupe concurrent qua `__fieldDecryptPending`. **Cách DUY NHẤT đảm bảo resolve 1 field** — dùng ở mọi chỗ cần plaintext chắc chắn trước khi hiển thị/điền input.
- `primeFieldCache()` — từ v1.5.5 **lazy**: chỉ decrypt token Drive sau unlock; field KH/TSBĐ prime theo nhu cầu khi render (`openFolder()` → `decryptFieldAsync(notes)` + `window.decryptCustomerAssetsAsync`).

**QUY TẮC FIELD CIPHER (bắt buộc — đúc từ chuỗi bug thật v1.5.5→1.5.8 từng làm hỏng dữ liệu / lộ ciphertext ra UI)**:
- **R1 — Ghi**: `await encryptText(...)` trong `try/catch`, mã hóa trước transaction.
- **R2 — Hiển thị/populate**: dùng `_displayPlain(v, fallback)` (sync) hoặc `_displayPlainAsync(v, fallback)` (async) — hoặc tự kiểm `_looksEncrypted(v)` — trước khi `textContent`/set `.value`/`img.src`. Cache-miss = "chưa sẵn sàng": không render ciphertext ra UI, không re-encrypt field đó khi lưu. Helper nằm ở `00_globals.js` (nguồn duy nhất từ v1.5.8).
- **R3 — Input editable**: `await decryptFieldAsync` từng field **kể cả `asset.name`** trước khi điền; vẫn encrypted sau khi cố giải mã → để trống. Khi lưu: ô trống nhưng field gốc còn ciphertext → **giữ nguyên ciphertext gốc**, không ghi đè rỗng (đã áp dụng ở `_doSaveAsset`, `saveCustomerNotes`, `openEditCustomerModal`).
- **R4 — Nhận diện ciphertext**: KHÔNG tự viết check hard-code 1 tiền tố — luôn dùng `_looksEncrypted()` làm nguồn duy nhất, kể cả cho field "theo thiết kế không mã hóa" như `asset.name`, vì migration có thể đã re-encrypt bất kỳ field legacy nào sang `cpg1:` (bug thật v1.5.7 ở `_deepDecryptLabel`/06 và `_isCryptoJSCiphertext`/07).
- **R5 — Field mã hóa mới**: đảm bảo nơi NẠP cache (`decryptFieldAsync` hoặc tương đương) tồn tại và thực sự được gọi trước khi component render — đừng giả định `primeFieldCache()` lo (bug thật v1.5.5: `decryptCustomerAssetsAsync` từng là dead code → TSBĐ hiện `cpg1:...` sau unlock). Sau khi prime xong phải **re-render** mọi chỗ đã hiện placeholder (header hồ sơ, gallery, tab info/assets) — không chỉ tab đang mở.

**Migration một lần** `runFieldCryptoMigrationIfNeeded(pin, employeeId)`: cờ `localStorage['app_crypto_schema_v']='2'` + marker `cryptoV:2` per-record. **KHÔNG** gắn vào `indexedDB.open` version (onupgradeneeded chạy trước unlock). Quy trình: đúc MK2 mới → niêm phong tạm `app_pin_v2_stage`/`app_sec_v2_stage` → re-encrypt từng record (đọc tx1 → crypto → ghi tx2, atomic) → **chỉ khi 100% xong** mới swap `PIN_KEY`/`SEC_KEY` sang MK2 rồi set schema='2'. Resume-safe qua mọi điểm crash; legacy key vẫn mở được từ `PIN_KEY` gốc tới lúc swap. Chạy trong `validatePin` (unlock hằng ngày) và `saveSecuritySetup` (idempotent) — cả hai `await window.__dbReady` trước (§6.6).

**Niêm phong & unlock**:
- `sealMasterKey`/`openMasterKeyV2`: PBKDF2-SHA256 150k iter (iter lưu trong envelope → nâng được không cần migration, khuyến nghị ≥310k khi cần) + AES-GCM. Sanity-check chấp nhận cả `MK2:` lẫn `mk_`.
- **WebAuthn PRF** (18): PRF bọc **PIN** (không bọc masterKey) rồi gọi `validatePin()` → PIN không đổi ⇒ biometric không cần re-seal sau migration, tự mở envelope MK2 mới.
- PIN + câu hỏi bảo mật (`PIN_KEY`, `SEC_KEY`); flow `forgotPin` + `checkRecovery`. Activation thiết bị bằng mã nhân viên (`ACTIVATED_KEY`, `EMPLOYEE_KEY`).
- **Flow mở app**: activation → auth gate (15, PIN/biometric) → `_installMasterKey` → migration nếu cần → `primeFieldCache` → dashboard.

**Backup `.cpb` độc lập khóa thiết bị**: payload chứa field **plaintext** bọc trong KDATA-GCM (khóa do GAS cấp) → đổi masterKey **vô hình** với backup; restore re-encrypt bằng khóa thiết bị hiện tại (`normalizeCustomerForRestore` async, đặt `cryptoV:2`, gọi lại `primeFieldCache`).

**Threat model**: XSS → khi mở khóa, `__fieldPlainCache` + `masterCryptoKey` trong RAM (giảm thiểu: CSP `script-src 'self'`, `escapeHTML`/`isSafe*Url`, render `textContent`, key non-extractable — giới hạn cố hữu local-first). Dump localStorage → chỉ lấy envelope, brute PIN 6 số offline: PBKDF2 là phòng tuyến. Giả mạo ciphertext → GCM tag từ chối, `decryptText` trả nguyên ciphertext thay vì plaintext giả.

## 6. Module Reference

### 6.1 Nền tảng — 00_globals.js, 01_config.js
**00**: `getEl(id)`, `debounce(fn, 150)`, `formatDateTime`, `formatBytes`, `getEmployeeId()`, `getDeviceIdSafe()`; slide screen system (§3); global state `currentPin`, `currentLightboxIndex/List`; bảng delegation `CLICK_ACTIONS`/`CHANGE_ACTIONS`.
- **Display/ciphertext guards (v1.5.8, nguồn duy nhất)**: `_looksEncrypted(v)` nhận diện cả `cpg1:` lẫn `U2FsdGVk`; `_displayPlain(v, fallback)` = sync decryptText + chặn ciphertext (trả fallback nếu chưa giải mã được); `_displayPlainAsync(v, fallback)` = chờ `decryptFieldAsync` rồi chặn. **Mọi** chỗ `textContent` / `.value` / `img.src` / folderName Drive phải qua helper này — không hard-code tiền tố cục bộ.
**01** (single source of constants):
- OSRM: router ưu tiên `https://routing.openstreetmap.de/routed-car/table/v1/driving/` (FOSSGIS, dữ liệu cập nhật tốt), fallback `https://router.project-osrm.org/table/v1/driving/`. Cache `ROAD_DIST_CACHE_KEY='app_road_dist_cache_v3'` TTL 7 ngày, max 600 entries (tự xóa cache v1/v2 cũ). Timeout 8s.
- Validation: `ROAD_DIST_SNAP_MAX_M=150`, `ROAD_DIST_SNAP_GOOD_M=50`, `ROAD_DIST_MAX_DETOUR_RATIO=8`, `ROAD_DIST_DETOUR_MIN_STRAIGHT_M=120`.
- `WEATHER_CODE_TEXT` (map mã → tiếng Việt), cache weather 15 phút. VietQR. `ADMIN_SERVER_URL`, `USER_SCRIPT_KEY`, `USER_TOKEN_KEY`.

### 6.2 Bản đồ — 03_map.js
MapLibre lazy-load (`MAPLIBRE_V` **phải = `ASSET_V`**), markers KH/TSBĐ theo lat/lng, clustering supercluster khi >100 điểm. `locateMe()`, `getCurrentGPS()` (Geolocation, đã whitelist trong Permissions-Policy/CSP). Popup card + feature properties: sau `decryptFieldAsync` vẫn guard `_looksEncrypted` (fail-open có thể trả ciphertext) trước khi `textContent`; link map bỏ qua nếu vẫn mã hóa; thumb ảnh qua `isSafeImageUrl`.
**Road distance** (core feature): 2 tọa độ → OSRM Table API `/table/v1/driving/` (OSRM tự snap điểm vào đường gần nhất) → **post-snap validation** (đây là kiểm tra CHẤT LƯỢNG snap sau khi OSRM xong, không phải pre-filter): cả 2 điểm snap ≤150m (snap >150m = điểm nằm xa đường → kết quả kém tin cậy → loại); ≤50m = tin cậy cao; detour: đường bộ > 8× straight-line (khi straight ≥120m) → bất thường → dùng straight-line. Pass → cache 7 ngày; fail/timeout 8s → fallback router 2 → straight-line. OSRM **không cache trong SW** (dynamic). Mục tiêu: khoảng cách đường thực tế chính xác cao, hoàn toàn miễn phí, reliable.

### 6.3 UI chung — 04_ui_common.js
- `openModal()`/`closeModal()`; modal HTML tách file trong `modals/`, nạp runtime bởi `assets/ui/load_modals.js`.
- `persistCurrentCustomer(mutate, onDone)` trả `onDone(ok)` — **MỌI caller phải kiểm `ok`**: `ok=false` → hoàn tác mutation in-memory (undo/revert) + `ErrorHandler.showError('STORAGE',...)`; **không bao giờ** toast thành công trước khi transaction commit.
- **Lightbox** (`navigateLightbox`/`openLightbox`): ưu tiên `item._displayData` (đã giải mã khi load gallery); tuyệt đối không gán ciphertext vào `img.src`; nếu còn mã hóa thì `resolveImageData` nền rồi cập nhật. Guard `isSafeImageUrl` trước khi set src.
- **ModalA11y** (init ở 10): tự quan sát mọi overlay `.fixed.inset-0` toggle `hidden` → gắn `role="dialog"` + `aria-modal` + `aria-labelledby`, focus trap (Tab/Shift-Tab vòng trong modal), Esc = bấm nút `[data-action^="close"]`, khôi phục focus khi đóng — tự động cho mọi modal, KHÔNG sửa từng open/close. `labelIconButtons()` gắn `aria-label` cho nút icon-only theo `ACTION_LABELS`/`ICON_LABELS`.
- **Z-index tiers (v1.5.8)**: modal nghiệp vụ (add/asset/approve/camera/backup/ref-price/dup-warning) = `z-[200]`; menu = `z-[70]`; guide = `z-[80]`; map FAB = `z-[400]`; loader/toast = `z-[500]`; picker = `z-[10050]`. Không để modal dưới map FAB. **Bắt buộc** khai báo utility mới trong `assets/styles.css` + `assets/css/tailwind.clientpro.css` (Tailwind static — class không có sẵn sẽ không có `z-index` → modal mất stacking, dashboard chặn click; bug CI E2E thật khi thêm `z-[200]`/`z-[80]` mà quên CSS).

### 6.4 KH & TSBĐ — 05_customers.js, 06_assets.js, 13_ui_select_customers.js
**05**: CRUD (`saveCustomer`, `deleteCurrentCustomer`, `toggleCustomerStatus`); tìm kiếm **không dấu** `_normVi()` (lowercase + bỏ dấu NFD + đ→d) khớp tên + CCCD + SĐT (bỏ khoảng trắng), chỉ số `nName/nPhone/nCccd` cache trong `__custSummaryCache` (không tính lại mỗi keystroke). **Cố ý KHÔNG** dùng virtual list / viewport marker culling (over-engineering ở quy mô vài trăm KH; rAF chunk-render 25 + decrypt cache đủ mượt). `saveCustomerNotes()` có guard R3. `renderFolderHeader` dùng `_displayPlain` (không hiện `cpg1:`). `openFolder()`: sync best-effort rồi slide-in; nền `decryptCustomerSummaryAsync` + notes + TSBĐ (R5) rồi **re-render header + Drive status + tab info/assets**. `openEditCustomerModal` async + `_displayPlainAsync`. Duplicate warning overlay cũng guard + async refresh. Approval: `confirmApproval()`, `closeApproveModal()`.
**06**: CRUD TSBĐ gắn customer, hỗ trợ `priceRef` (tham khảo giá), lat/lng hiển thị trên map. `window.decryptCustomerAssetsAsync(customer, {batchSize})`: prime cache mọi field TSBĐ **kể cả `name`** theo batch (chỉ nạp cache, không render — caller quyết định). `renderAssets()` mọi field qua `_displayPlain`. `openEditAssetModal(index)` **async** — decrypt **cả `name`** + guard R3. `_doSaveAsset()` guard R3. `_deepDecryptLabel()` dùng `_looksEncrypted` (R4). `referenceAssetPrice`: prime cache field của **tất cả** KH trước khi so sánh (không chỉ hồ sơ đang mở), rồi `_displayPlain` trước khi đưa vào modal.
**13**: selection mode — `toggleCustSelectionMode()`, `sendSelectedCustomersToUser()`, `deleteSelectedCustomers()`; picker `loadCustomersForPick` dùng `decryptCustomerSummaryAsync` + `_displayPlain` (không sync `decryptCustomerObject` trần).

**Chống double-submit** (pattern bắt buộc cho mọi luồng ghi có nút submit): cờ in-flight (`__custSaveInFlight`/`__custWriteInFlight`, `__assetSaveInFlight`) set **đồng bộ trước await đầu tiên** + `LoadingManager.showButtonLoading(btn, 'Đang lưu...')` disable nút, nhả trong `finally` sau khi transaction ghi xong (các put IDB bọc Promise + await).

### 6.5 Camera & ảnh — 08_images_camera.js
`capturePhoto()` (getUserMedia), `tryOpenCamera(data-arg)` (context KH/TSBĐ). **Vòng đời stream (bắt buộc giữ)**: `_stopCameraStream()` dừng mọi track + gỡ `srcObject`; `closeCamera()` gọi nó (an toàn khi gọi lặp); listener `visibilitychange:hidden` + `pagehide` tự `closeCamera()` (camera không chạy ngầm khi khóa máy/chuyển app); token `__cameraOpenSeq` — stream cũ bị stop trước khi mở mới, stream về "muộn" (double-tap/đã đóng modal) bị stop ngay. `openAssetGallery`: header sync `_displayPlain` rồi async `_displayPlainAsync` refresh. `resolveImageData` / `_attachLazySrc`: giải mã cả `cpg1:` lẫn legacy, **từ chối** gán ciphertext / URL không qua `isSafeImageUrl` vào `<img src>`. Lightbox: `navigateLightbox()` ưu tiên `_displayData` (§6.3). `shareSelectedImages()`, `deleteSelectedImages()`, `deleteOpenedImage()`. Ảnh mã hóa at-rest + migration resume-safe (§4).

### 6.6 Bootstrap — 10_bootstrap.js, 11_edge_back_swipe.js, 17_onboarding_tour.js
**10**: init IndexedDB, restore theme, load data, init map, register PWA, `LoadingManager.init()`, `installGlobalHandlers()`, ModalA11y init. **Gate trước loader**: `checkSecurity()` chạy ngay trong DOMContentLoaded (sau khi modal partials ready; phần hiển thị gate đồng bộ, không cần db) **trước khi** ẩn `#loader` → dashboard không bao giờ lộ thoáng qua; loader chỉ ẩn sớm khi 1 trong 3 gate (`screen-lock`/`setup-lock-modal`/`activation-modal`) đã hiện, nếu không (partials lỗi/timeout) → giữ loader, retry `checkSecurity()` trong `indexedDB.open onsuccess`. Expose **`window.__dbReady`** (Promise, resolve ở onsuccess/onerror) — `validatePin()`/`saveSecuritySetup()` await nó trước migration/`primeFieldCache`/`loadCustomers`.
**11**: edge back-swipe gesture custom cho mobile. **17**: onboarding tour cho người dùng mới.

### 6.7 Error & Loading chuẩn hóa — 19_error_loading.js
Nạp ngay sau 04, trước module nghiệp vụ. Export global `ErrorHandler`, `LoadingManager`, `AppToast` + alias `showError/showSuccess/showWarning/startLoading/stopLoading`. Mọi element tạo bằng DOM API, icon inline SVG (CSP-safe, không lệ thuộc lucide re-render).
- **AppToast**: toast xếp chồng 4 loại (`success/error/warning/info`), tự đóng (error 6s, warning 5s, khác ~3.5s; `duration:0` = không tự đóng), chạm để đóng. `showToast(msg[, type])` cũ route qua đây (mặc định success) — ~60 call cũ vẫn chạy.
- **ErrorHandler**: `ERROR_CODES` = `NETWORK/OFFLINE/TIMEOUT/VALIDATION/AUTH/STORAGE/MAP/BACKUP/CAMERA/UNKNOWN` (mỗi mã: userMessage hiện cho user + technicalMessage console + type màu; **mã mới → chỉ cần thêm vào bảng**). `showError(code, customMsg?, technicalDetail?)` — gọi `NETWORK` khi thật sự offline (`navigator.onLine===false`) tự chuyển `OFFLINE`; detail chỉ console, tự `logError`. `classify(err)` đoán mã (`AbortError`→TIMEOUT, `NotAllowedError`→CAMERA, `QuotaExceededError`→STORAGE…). `wrapAsync(fn, {loading, errorCode, errorMessage, successMessage, rethrow})` — tự bật/tắt loading + catch + showError. **`confirm(msg, {title, confirmText, cancelText, danger, icon})` → Promise\<boolean\>** thay hoàn toàn `confirm()` gốc (alias `window.showConfirm`; Esc=hủy, Enter=đồng ý, chạm nền=hủy; `danger:true` = nút đỏ cho xóa) — call site dùng `await` (đổi hàm gọi sang async nếu cần). `logError(msg, detail)` → ring buffer `localStorage['app_error_log']` (50 bản `{t,m,d}`); `getErrorLog()`/`clearErrorLog()`. `installGlobalHandlers()` (gọi 1 lần ở 10): `window.onerror` + `unhandledrejection` → logError + 1 toast thân thiện (tiết lưu 5s, classify); bỏ qua lỗi tải resource (chỉ log). `isOffline()`.
- **LoadingManager** (tái dùng `#loader` sẵn có, đếm ref chống chồng chéo): `showGlobal(msg)`/`hideGlobal(force)` (`force=true` reset cứng ref-count, dùng ở `finally`), `showProgress(msg, percent)`, `showButtonLoading(btn, text)`/`hideButtonLoading(btn, restoreText?)` (spinner + tự disable + aria-busy + phục hồi HTML gốc), `showSkeleton(container, count)`/`hideSkeleton`, empty/error state: `showEmptyState(container, {icon, title, message, actionText, onAction})` / `showSearchEmptyState` / `showErrorState` / `clearState` (icon từ `STATE_ICON_PATHS`: inbox/search/users/error/folder; dùng ở 05 — phân biệt "chưa có KH"/"không có kết quả"/"tab trống", 14, 16).
- CSS đi kèm cuối `redesign.clientpro.css` (`.app-toast*`, `.btn-loading/.btn-spinner`, `.skeleton*`, `.global-progress-*`, `.cp-confirm-*`, `.cp-state*`), tôn trọng prefers-reduced-motion + safe-area.
- **Toàn codebase đã migrate** sang tầng này (không còn alert/confirm/console.error thô, trừ log dev nội bộ của 19 và 1 fallback có guard ở 00). Luồng mới: `showError('MÃ', 'msg cụ thể', err)`, `await ErrorHandler.confirm(...)`, `LoadingManager`, `showSuccess(...)`; lỗi chỉ cần log → `logError(...)`.

### 6.8 Backup & Cloud — 12, 07, 16, 09_backup_manager (Drive Backup) vs 14 (Cloud Transfer)
Hai hệ thống **khác nhau**, cả hai "user-controlled cloud" (không backend trung tâm nắm dữ liệu; Admin script chỉ trung chuyển ciphertext, không tự giải mã được):
- **Drive Backup** = backup/restore **toàn bộ app** dưới dạng 1 file `.cpb` mã hóa → Google Drive **cá nhân** của user. `createBackupFileNow()` (12) → `uploadToGoogleDrive()`/`uploadAssetToDrive()` (07). Auto backup định kỳ: 16 + `DriveBackup.performNow`; manual backup/restore + reconnect folder: 09_backup_manager. Dùng khi: backup toàn bộ / chuyển sang thiết bị mới. Backend: `gas/UserDriveAPI.gs` (mỗi user tự deploy).
- **Cloud Transfer** = gửi/sync **một phần dữ liệu** (thường KH đã chọn qua selection mode, đã encrypt) giữa các thiết bị qua GAS endpoint `ADMIN_SERVER_URL` (14). Không tạo file `.cpb`, gửi data trực tiếp. Backend: `gas/AdminAPI.gs` (tác giả deploy 1 lần, URL cố định).
- `_isCryptoJSCiphertext()` (07) dùng `_looksEncrypted()` (R4). `_safeDecryptMaybe` / `_displayText` (v1.5.8): sau `decryptText` **từ chối** nếu vẫn `_looksEncrypted` (trước đây fail-open trả ciphertext → lộ vào folderName / loader "Đang tìm: cpg1:…").

### 6.9 GAS backend — `gas/` (nguồn tham khảo, deploy thủ công qua Apps Script editor; KHÔNG thuộc build tĩnh/CI)
Khung chung cả 2 file: `doGet`/`doPost` → `handleRequest_()`, response qua `outputJSON_()` (JSON kèm field `build`), `LockService` chỉ cho action **ghi**, exception không lộ ra client (chỉ `Logger.log`).

**AdminAPI.gs** (v13, `BUILD_TAG` chứa `_v13_ADMIN`) — tác giả deploy **1 lần**, URL hardcode ở `ADMIN_SERVER_URL`. Google Sheet `SHEET_ID` (tab `Keys`: cột A-F = Key|Status|EmployeeId|DeviceInfo|Date|DeviceId; tab `Transfers` tự tạo; cache Keys 20s trong CacheService):
- Licensing: `activate` (kích hoạt key + bind deviceId, chống brute-force 8 lần sai/10 phút/employeeId), `check_status`. `validateActiveUser_(data)` gate mọi action nhạy cảm: status `used`/`active` **và** deviceId gửi lên khớp deviceId đã bind (chưa bind → từ chối).
- Cấp khóa per-user (không khóa dùng chung): `issue_kdata` = `HMAC_SHA256(MASTER_SECRET, "personal:"+employeeId)` (cho Drive Backup); `issue_transfer_key` = `HMAC(..., "transfer:"+targetEmployeeId)` (cho Cloud Transfer; label khác → không giải mã chéo). MASTER_SECRET trong Script Properties (`setupMasterSecret()`).
- Transfer P2P: `list_users`, `upload_backup` (ghi Sheet `Transfers` + file Drive folder `CLIENTPRO_TRANSFERS`, TTL 24h, giữ max 30 bản, id `T<timestamp>_<rand>`), `list_inbox`, `download_backup` (chỉ người nhận đọc được; hết hạn → tự xóa + đánh dấu `expired`), `delete_backup`. Trigger `cleanupExpiredTransfers` mỗi giờ. `ALLOW_DEBUG_ECHO=false`. Setup 1 lần: `setupStorage()`, `setupTriggers()`.

**UserDriveAPI.gs** (v3, `BUILD_TAG` chứa `_v3_token`) — **mỗi user tự deploy** trên Google account của họ; URL + token dán vào Cài đặt trong app (→ `USER_SCRIPT_KEY`/`USER_TOKEN_KEY`). Độc lập hoàn toàn với Sheet Admin:
- Ảnh: `upload`/`upload_images` → `CLIENTPRO_IMAGES/<folderName>/`, ép `DriveApp.Access.PRIVATE` (không share công khai); `search_folder` list ảnh theo folder.
- Backup `.cpb` (blob client đã mã hóa sẵn — script không giải mã được): `backup`/`create_backup` (`CLIENTPRO_BACKUPS/*.cpb`, tự trim giữ 5 bản mới nhất), `list_backups`, `download_backup`/`restore`, `delete_backup` — 2 action cuối validate `isFileInBackupFolder_` (chặn dùng id lộ/đoán để đọc file Drive bất kỳ).
- Auth **fail-closed**: token bắt buộc mọi action trừ `ping` (server chưa `setupToken()` → từ chối tất cả); so khớp `constantTimeEquals_()` (chống timing attack); token sinh ngẫu nhiên mạnh, lưu Script Properties. Limit: ≤30 ảnh/request, ảnh base64 ≤~12MB (~9MB gốc), backup base64 ≤~40MB (~30MB gốc). Setup: `setupToken()` (bắt buộc), tùy chọn `setupFolders()`; `revokePublicSharing()` = migrate 1 lần gỡ share công khai của bản trước v3 (idempotent).

**Khi sửa GAS**: giữ nguyên mọi action/alias field/response mà `07_drive.js` + `14_cloud_transfer.js` đang đọc (đặc biệt `url`/`folderUrl`/`encrypted`/`kdata_b64u`/`cipher_b64`) — hợp đồng ngầm client↔script. Deploy lại → cập nhật `ADMIN_SERVER_URL` (Admin) hoặc hướng dẫn user tự cập nhật (User).

### 6.10 UI/UX khác — themes, CSS pitfall, weather, menu, donate
- **4 themes**: Sáng (mặc định) + 3 tối (Xanh Đêm, Đại Dương, Thiên Thanh) — CSS variables + `setTheme()`, chung lớp `redesign.clientpro.css`, chỉ khác `--accent-gradient`.
- **Cạm bẫy CSS specificity (bug thật v1.5.6)**: `redesign.clientpro.css` dùng ID selector re-skin đè Tailwind utility class trên cùng element — ID (0,1,0,0) LUÔN thắng class (0,0,1,0) dù không `!important`. Rule `#screen-lock { position: relative }` từng đè mất `position: fixed` của `.fixed` → màn khóa PIN co theo nội dung, lộ dashboard phía dưới (lỗ hổng riêng tư). **Quy tắc**: rule ID cho overlay/modal `fixed inset-0` KHÔNG set lại `position` hay layout property mà Tailwind class đảm nhiệm — chỉ đè màu sắc/hiệu ứng (nếu buộc phải: `position: fixed !important`).
- Accessibility: viewport cho phép pinch-zoom (đã bỏ `user-scalable=no`); `:focus-visible` outline cho bàn phím; `@media (prefers-reduced-motion)` cắt animation toàn cục (cuối redesign css); ModalA11y (§6.3).
- `09_weather.js`: `refreshWeather()`, Open-Meteo + cache 15'. `09_menu.js`: `toggleMenu()`, settings (theme/security/donate/biometric). `09_donate.js`: `openDonateModal()`, `copyDonateAccount()`, VietQR Quick Link.

## 7. PWA & Versioning (kỷ luật nghiêm ngặt — CI enforce)

**Hai định danh độc lập, mỗi loại 1 nguồn duy nhất**:
- **A. Semver app** — nguồn `package.json → version`. **KHÔNG sửa tay** các file đích. Đổi package.json rồi `npm run sync:version` (`scripts/sync-version.mjs`, zero-dep) tự ghi ra: `manifest.json version`, `sw.js VERSION='v<sem>'`, `assets/pwa.js SW_BUILD='v<sem>'`, README.md (badge + mục "Quản lý phiên bản").
- **B. Cache-buster asset** — nguồn `ASSET_V` trong `sw.js` (chuỗi tự do, hiện `CRYPTOFIX2_20260709`), đổi tay khi thay asset. Phải đồng nhất với: **mọi** query `?v=` trong `index.html` và `MAPLIBRE_V` trong `assets/03_map.js`.
- CI (`.github/workflows/ci.yml`, job `static-checks`) check cả hai: bước `sync-version.mjs --check` (semver + README) + bước version-sync (`?v=`/`MAPLIBRE_V`) + chặn CDN. Trước commit: `npm run check:version`.

**sw.js**: precache toàn bộ shell + vendor + fonts + mọi module JS + modal HTML (**module mới → thêm vào precache list**). Runtime: same-origin cacheFirst/networkFirst; map tiles stale-while-revalidate 30 ngày (cache riêng); **OSRM không cache**; navigation SWR (user thấy bản mới ở lần mở tiếp theo); `skipWaiting` + message `SKIP_WAITING` để activate ngay. `assets/pwa.js`: đăng ký SW + xử lý update.

## 8. Security headers (vercel.json)

CSP: `script-src 'self'`; `style-src 'self' 'unsafe-inline'` (chỉ inline style cho theme); `font-src 'self' data:`; `img-src`/`connect-src` whitelist (GAS, Google Drive, Open-Meteo, OSRM routers, map tiles Carto/ArcGIS, VietQR); `upgrade-insecure-requests`, `manifest-src`, `form-action`, `frame-src 'none'`. Kèm: `Permissions-Policy: camera=(self), geolocation=(self)`; HSTS; COOP; CORP; `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`. **API/domain mới → cập nhật CSP tương ứng, không hardcode domain lung tung.**

## 9. Quy trình thêm feature & cập nhật CLAUDE.md

1. Tạo `assets/NN_ten.js` (số theo dependency) → thêm `<script defer ... ?v=ASSET_V>` đúng vị trí `index.html` → thêm vào precache `sw.js`.
2. Handler mới → khai báo `CLICK_ACTIONS`/`CHANGE_ACTIONS`; UI mới chỉ dùng `data-action`.
3. External API mới → CSP `vercel.json`.
4. Field nhạy cảm mới → tuân thủ R1–R5 (§5) + thêm test crypto (§10).
5. Bump version đúng loại (§7).
6. **Cập nhật CLAUDE.md**: thay đổi module/data-flow/hằng số/pattern → §4–6; architecture/load-order/UI pattern → §3; lib/API/constraint → §2; workflow/version → §7–9. Tự kiểm: *"AI khác đọc CLAUDE.md có hiểu tính năng mới mà không cần đọc code không?"*
7. Test kỹ: local server + offline + PWA install + map routing + encryption + backup flow. Commit → CI xanh → deploy.

**Pre-commit**:
```bash
python3 -m json.tool manifest.json vercel.json
node --check sw.js
find assets -name '*.js' -print0 | xargs -0 -n1 node --check
node --test 'tests/**/*.test.js'
npm run check:version
```

## 10. Automated Testing (`tests/`, `e2e/`) — ưu tiên data integrity

**Ràng buộc**: app shipped **zero-dependency, zero-build** — bộ `tests/` chạy bằng `node --test` (Node ≥20, CI dùng 22) + `node:crypto` (WebCrypto) + crypto-js self-host, **không** cần `npm install`. `package.json` devDependencies (`@playwright/test`, `@axe-core/playwright`, `@lhci/cli`) **CHỈ** cho job CI `e2e`; `node_modules/`/`package-lock.json` không commit (.gitignore). `tests/` + `e2e/` nằm **ngoài `assets/`** → không bump version, không đụng cache-buster/precache/version-sync — đây là lý do đặt ở root.

**Test CODE THẬT, không reimplement**: `tests/helpers/load-security.js` nạp nguyên bản `02_security.js` vào sandbox `node:vm` (cấp CryptoJS + WebCrypto + localStorage giả lập + `makeFakeDb()` IndexedDB in-memory + `randomKdataB64u()`), nối epilogue cùng phạm vi từ vựng phơi hàm production: `encryptText`, `decryptText`, `encryptBackupPayload`, `decryptBackupPayload`, `sealMasterKey`, `openMasterKeyV2`, `unwrapMasterKeyAny`, `decryptCustomerObject`, `setMasterKey` (async), `setLegacyMasterKey`, `primeFieldCache`, `runFieldCryptoMigrationIfNeeded`, `_gcmEncrypt/DecryptField`, `setDb`… **Refactor `02_security.js` đổi tên/chữ ký các hàm này → PHẢI cập nhật epilogue.**

| File | Phạm vi |
|---|---|
| `tests/crypto.test.js` | GCM `cpg1:` roundtrip tiếng Việt, IV ngẫu nhiên, tamper rejection (GCM tag), sai khóa không rò rỉ, đọc legacy CryptoJS, chuỗi rỗng, MK2 CSPRNG, chống double-encryption |
| `tests/backup.test.js` | Envelope `.cpb` AES-256-GCM: roundtrip payload đầy đủ, checksum SHA-256, chống giả mạo, từ chối sai/thiếu khóa, KDATA sai độ dài |
| `tests/data-integrity.test.js` | Decrypt object Customer/Asset, migration CryptoJS→GCM idempotent + resume-safe (makeFakeDb), niêm phong masterKey bằng PIN (nhận MK2/mk_), escapeHTML |
| `tests/pwa.test.js` | Tĩnh sw.js/manifest: lifecycle install/activate/fetch + skipWaiting, precache đủ mọi `NN_*.js` + vendor sống còn, version sync |
| `tests/schema.test.js` | Data-contract: khóa cứng SHAPE record Customer/Asset tầng lưu trữ (field nhạy cảm phải `cpg1:`, `cryptoV:2`), validate record mới + sau migration, bắt record hỏng |
| `e2e/smoke·a11y·offline·crud.spec.js` | App tải + SW đăng ký + gate hiện, không lỗi JS; axe quét (chặn `critical`, log `serious`); offline-first từ SW cache; seed activation+PIN → unlock → tạo KH → verify IDB lưu `cpg1:` + `cryptoV:2` trong Chromium thật |

Chạy: `node --test 'tests/**/*.test.js'` (zero-dep, TAP) · `npm install && npm run test:e2e` / `npm run test:lh` (CI-only; `playwright.config.js` tự dùng Chromium sẵn ở `/opt/pw-browsers` nếu có). `lighthouserc.json` gate accessibility ≥0.9 (error), perf/best-practices chỉ warning; report `.lighthouseci/` không upload public. CI: 3 job song song `static-checks` + `tests` + `e2e`; xem kết quả trên tab Checks của PR. **Hàm crypto/luồng dữ liệu mới → thêm test roundtrip + tamper + sai khóa; flow UI quan trọng → thêm spec e2e.** Test không cần chạm version.

## 11. Trạng thái hiện tại (2026-07-10)

- **v1.5.9**, `ASSET_V = PERFFIX_20260710`.
- **Recent (v1.5.9 — Perf + bugfix)**: chống double-submit backup/restore nội bộ (`__backupInFlight`/`__restoreInFlight`, 09_backup_manager — mirror pattern 16); toast thành công upload Drive chỉ hiện khi `persistCurrentCustomer` trả `ok` (07, mirror `_doSaveAsset`/06; `!ok` → không hỏi xóa ảnh gốc); `capturePhoto` bọc try/finally đảm bảo `closeCamera()` chạy kể cả khi chụp lỗi (08); thêm `tx.onerror` cho 2 transaction `reconnectAssetDriveFolder` (07 — hết treo loading / nuốt lỗi im lặng); load-token `window.__openFolderSeq` chống race double-tap 2 hồ sơ (05, `openFolder`); debounce 120ms cho search picker KH (13) + map cluster repaint `moveend`/`zoomend` (03); polling cloud-transfer skip khi app khóa qua `isAppUnlocked()` (14).
- **v1.5.8 — Display integrity**: audit toàn app sau lazy-decrypt; vá mọi đường hiển thị còn sót ciphertext. Helper chung `_looksEncrypted` / `_displayPlain` / `_displayPlainAsync` chuyển về `00_globals.js`. Fix: `renderFolderHeader` + `openFolder` async refresh header; `openEditAssetModal` decrypt `name`; `renderAssets`/`referenceAssetPrice`/`openAssetGallery`/`loadCustomerInfo`/`openEditCustomerModal`/picker/dup-warning/map popup/Drive `_safeDecryptMaybe` đều guard; lightbox dùng `_displayData` + `isSafeImageUrl`; z-index modal chuẩn hóa `z-[200]` (+ thêm utility `.z-[80]`/`.z-[200]` vào CSS static — thiếu class → modal mất stacking, E2E `saveCustomer` bị dashboard chặn click). Quy tắc R2/R5 §5 cập nhật tương ứng.
- Các đợt nâng cấp lớn đã hoàn tất: **P1** single-source versioning + siết CSP; **P2** Security Core AES-256-GCM + masterKey CSPRNG + migration resume-safe; **P3** accessibility (ModalA11y, pinch-zoom, reduced-motion); **P4** tìm kiếm không dấu + index cache; **P5** test suite zero-dep + E2E/axe/Lighthouse CI; chuẩn hóa error/loading toàn codebase (§6.7); reliability v1.5.4; v1.5.5 (clustering, lazy decrypt, ảnh at-rest); v1.5.6–1.5.8 (chuỗi fix field cipher + display integrity — quy tắc **R1–R5 §5**, cạm bẫy CSS **§6.10**).
- Khi làm việc: giữ triết lý không-backend/local-first, không phình vendor không cần thiết, ưu tiên UX mobile mượt (animation/gesture/camera).

---
*Tài liệu sống — cập nhật cùng mỗi thay đổi lớn. Last updated: 2026-07-10 (ICT). Phiên bản skill: 2.2 (v1.5.9 perf + bugfix).*

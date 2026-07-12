# CLAUDE.md — ClientPro engineering guide

> Đọc file này trước khi sửa code. `index.html` và mã nguồn vẫn là nguồn xác thực cuối cùng khi cần kiểm tra chi tiết. Không ghi số dòng trong tài liệu này — tìm theo file + symbol.

## 1. Tổng quan

ClientPro là PWA mobile-first quản lý khách hàng và tài sản bảo đảm (TSBĐ), nền tảng chính là Android Chrome/standalone. Vanilla JavaScript, HTML, CSS thuần; không framework, không bước build, không backend ứng dụng riêng. Dữ liệu nghiệp vụ nằm trên thiết bị, được mã hóa, hoạt động offline qua Service Worker và chỉ rời thiết bị khi người dùng chủ động dùng Google Drive/Google Apps Script.

- Phiên bản public: `1.0.0-hotfix.2` (nguồn semver duy nhất: `package.json`; `sync-version.mjs` chấp nhận hậu tố dạng `-hotfix.N`)
- Cache-buster asset: `V100_20260711` (nguồn: `ASSET_V` trong `sw.js`)
- Cache epoch: `e2` (`CACHE_EPOCH` trong `sw.js` — xem mục 8)
- Demo: https://client-pro-beryl.vercel.app
- Database: IndexedDB `QLKH_Pro_V4`, schema version `5`
- Runtime dependency: toàn bộ thư viện, font, icon self-host trong `assets/`
- Deploy: static hosting; cấu hình Vercel và CSP trong `vercel.json`

## 2. Quy tắc bắt buộc

1. Không làm mất, làm trắng, double-encrypt hoặc hiển thị ciphertext của dữ liệu người dùng. Không thay dữ liệu không giải mã được bằng `""`/`0`/`null` rồi ghi ngược vào database.
2. Không bỏ qua activation, PIN/biometric gate, `masterKey` hoặc kiểm tra server của backup/restore.
3. Không thêm CDN, inline event handler hoặc nới CSP. UI tĩnh dùng `data-action`; dữ liệu động ưu tiên DOM API và `textContent`.
4. Không `await` WebCrypto hay tác vụ bất đồng bộ ở giữa một IndexedDB transaction. Chuẩn bị dữ liệu trước, sau đó mở transaction và ghi đồng bộ.
5. Không đọc global state sống sau một chuỗi `await`; dùng snapshot và sequence token khi kết quả có thể trở nên cũ.
6. Dùng `ErrorHandler`, `LoadingManager` và `ModalA11y`; không `alert()`/`confirm()` thô; không đổi z-index toàn cục cho lỗi cục bộ (xem layering contract mục 9).
7. Mọi thao tác destructive (xóa, restore) phải: có in-flight guard, promisify transaction (`oncomplete`/`onerror`/`onabort`), chỉ cập nhật UI sau khi commit, báo lỗi qua `ErrorHandler` — **không bao giờ** `location.reload()` để che lỗi hoặc nuốt transaction error.
8. Không persist KDATA plaintext vào bất kỳ browser storage nào (localStorage/sessionStorage/IndexedDB/Cache Storage).
9. `package.json` là nguồn semver duy nhất. Sau khi đổi version: `npm run sync:version` rồi `npm run check:version`.
10. Thay đổi hẹp phải giữ diff hẹp. Không refactor hoặc sửa hành vi ngoài phạm vi task.

## 3. Kiến trúc runtime

### App shell và storage

- `index.html` chứa SPA shell, các screen và thứ tự script.
- `assets/ui/load_modals.js` nạp HTML fragment trong `assets/ui/modals/`; bootstrap chờ `window.__clientpro_modals_ready` với timeout an toàn.
- IndexedDB ba store:
  - `customers`: record khách hàng; `assets` (mảng TSBĐ) và `notes` nằm trong record.
  - `images`: ảnh theo `customerId`, có thể có `assetId`.
  - `backups`: bản `.cpb` mã hóa của Backup Manager; index `createdAt`, `hash`, `deviceId`.
- `localStorage` chỉ giữ cấu hình, envelope khóa, trạng thái activation, URL/token GAS đã niêm phong, marker migration và cache nhỏ đã niêm phong. Không plaintext master key, không plaintext KDATA.

### Thứ tự load module

Tên `NN_*.js` biểu thị tầng phụ thuộc; trình duyệt KHÔNG tự sắp theo số. Tất cả script dùng `defer`; thứ tự trong `index.html` là nguồn duy nhất:

```text
ui/load_modals
→ 00_globals → 01_config → 02_security → 12_backup_core
→ 13_ui_select_customers → 15_auth_gate
→ 03_map → 04_ui_common → 19_error_loading
→ 05_customers → 06_assets → 08_images_camera
→ 09_menu → 09_backup_manager → 09_donate → 09_weather
→ 07_drive → 14_cloud_transfer → 16_auto_backup_drive
→ 17_onboarding_tour → 18_biometric_unlock
→ 10_bootstrap → 11_edge_back_swipe → pwa.js
```

`19_error_loading.js` cố ý load sớm hơn các module nghiệp vụ dù mang số 19. Các file số 09 là feature cùng tầng, không phụ thuộc lẫn nhau.

### Vai trò file chính

| File | Trách nhiệm |
|---|---|
| `assets/00_globals.js` | Helper chung (`getEl`, `debounce` có `.cancel()`, `_looksEncrypted`, `_displayPlain`, `_displayPlainAsync`), state toàn cục, screen transition, bảng `CLICK_ACTIONS`/`CHANGE_ACTIONS` |
| `assets/01_config.js` | URL GAS, weather, donate, OSRM và hằng số dùng chung |
| `assets/02_security.js` | Master key, field/image cipher, PIN envelope, migration (GCM + field-encrypt v2), KDATA sealed cache, backup envelope, security gate, tự khóa khi ẩn app, sự kiện `clientpro:unlocked` |
| `assets/12_backup_core.js` | Nguồn chuẩn hóa duy nhất cho export/restore; decrypt thật khi export, re-encrypt khi restore |
| `assets/15_auth_gate.js` | Preflight quyền thiết bị/tài khoản với Admin GAS |
| `assets/03_map.js` | MapLibre, marker/cluster, OSRM, GPS |
| `assets/04_ui_common.js` | State hồ sơ đang mở, modal/screen/tab, UI dùng chung |
| `assets/19_error_loading.js` | ErrorHandler, toast, `ClientProConfirm`, LoadingManager, ModalA11y |
| `assets/05_customers.js` | Danh sách, tìm kiếm, CRUD, chi tiết KH, duyệt hạn mức, ghi chú |
| `assets/06_assets.js` | CRUD TSBĐ, tham khảo giá |
| `assets/08_images_camera.js` | Camera, ảnh mã hóa, gallery, lightbox, chia sẻ, chọn nhiều |
| `assets/09_backup_manager.js` | Backup nội bộ, export/import `.cpb`, restore, UI Backup Manager |
| `assets/07_drive.js` | Cấu hình GAS cá nhân, upload ảnh lên Drive |
| `assets/14_cloud_transfer.js` | Gửi/nhận backup giữa user bằng transfer key riêng người nhận |
| `assets/16_auto_backup_drive.js` | Backup Drive thủ công/hằng ngày, danh sách, restore, retention |
| `assets/18_biometric_unlock.js` | WebAuthn PRF; bảo vệ PIN rồi tái sử dụng `validatePin()` |
| `assets/10_bootstrap.js` | DOM ready, mở/nâng cấp IndexedDB, boot security/UI, background task |
| `assets/11_edge_back_swipe.js` | Edge-swipe Back (state machine — mục 10), history depth tracking |
| `sw.js`, `assets/pwa.js` | Precache/offline, runtime cache, đăng ký + cập nhật SW (mục 8) |
| `gas/AdminAPI.gs` | Activation, KDATA, transfer, quyền trung tâm |
| `gas/UserDriveAPI.gs` | Drive cá nhân: ảnh và file backup |

## 4. Lifecycle: bootstrap → gate → unlock → lock

1. **Bootstrap** (`10_bootstrap.js`): DOM ready → mở IndexedDB (`window.__dbReady`) → boot security/UI → background task (weather, inbox polling, timer 15s gọi `DriveBackup.checkDaily()`).
2. **AuthGate** (`15_auth_gate.js`): preflight quyền với Admin GAS. **Fail-open**: offline/timeout/phản hồi mơ hồ KHÔNG khóa UI; chỉ locked/sai thiết bị lặp đủ strike mới chặn cứng. Fail-open này không nới backup/restore — các luồng đó vẫn bắt buộc unlock + `masterKey` + KDATA qua `ensureBackupSecret()`.
3. **Unlock**: `validatePin()` → `_installMasterKey()` (import AES-256-GCM CryptoKey non-extractable, chỉ trong RAM) → `completeUnlockDataLoad()`: chạy các migration (GCM, image, field-encrypt v2) → `primeFieldCache()` → flush KDATA pending (mục 6) → load danh sách → **dispatch `clientpro:unlocked`** (CustomEvent trên `document`; guard đầy đủ cho test harness). Biometric tái dùng `validatePin()` nên cùng đi qua điểm này.
4. **Lock**: ẩn app (chuyển app/về màn hình chính) quá **15 giây** → `lockApp()`: `clearMasterKeyMaterial()` (zero key bytes, xóa `masterKey/masterCryptoKey`, `APP_BACKUP_KDATA_B64U`, KDATA pending, field cache) → `showLockScreen()`. Chi tiết giữ nguyên: trễ 15s là chủ đích (file picker/share sheet/GPS làm trang tạm hidden); cơ chế kép timer nền + kiểm tra bù khi visible/`pageshow`; no-op khi chưa unlock hoặc chưa có `PIN_KEY`; nudge `BiometricUnlock.tryUnlock(true)` nếu khóa xảy ra lúc nền; listener có guard cho test harness.

**Hệ quả cho MỌI luồng ghi:** auto-lock có thể xảy ra GIỮA một chuỗi `await` (user ẩn app trong lúc flow lưu đang chạy). Sau lock, `encryptText()` fail-open trả nguyên plaintext — mọi điểm ghi field mã hóa at rest phải có post-check `_looksEncrypted` (mục 5).

## 5. Mô hình mã hóa

### Khóa và envelope

- Master key mới: `MK2:` + 32 byte ngẫu nhiên → AES-256-GCM CryptoKey non-extractable, chỉ trong RAM.
- Niêm phong trong `PIN_KEY`/`SEC_KEY` bằng PBKDF2-SHA256 + AES-GCM. PIN 6 số. WebAuthn PRF bảo vệ PIN, không bọc trực tiếp master key.
- Field mới: envelope `cpg1:` + base64url(`iv[12] || ciphertext || tag`). Ảnh data URL mã hóa at rest.
- Legacy `U2FsdGVk...` (CryptoJS) chỉ để đọc/migrate. Migration sang `cpg1:` idempotent, resume-safe.

### Trường bắt buộc mã hóa at rest

- Customer: `name`, `phone`, `cccd`, `notes`, `creditLimit`, `driveLink`.
- Asset: `name`, `link`, `valuation`, `loanValue`, `area`, `width`, `onland`, `year`, `driveLink`.

`creditLimit` và `asset.name` được mã hóa từ v1.0.0 (trước đó chủ đích plaintext). Migration một lần `runFieldEncryptMigrationV2IfNeeded()` (`02_security.js`, marker `app_field_encrypt_v2_done`) chạy sau unlock: encrypt → **đọc lại xác minh** (kể cả xác minh kết quả THẬT SỰ là ciphertext — chống race lockApp giữa migration) → batch put một transaction; record lỗi giữ nguyên; marker chỉ set khi 100% sạch (lần unlock sau tự retry).

### Pattern GHI bắt buộc (hotfix.2 phủ đủ mọi điểm ghi)

Mọi điểm ghi field mã hóa at rest phải: `await encryptText()` TRƯỚC khi mở transaction, rồi **post-check `_looksEncrypted(out)`** — `encryptText()` fail-open trả nguyên plaintext khi mất `masterKey` (auto-lock giữa chừng). Post-check fail → throw/báo lỗi và dừng, KHÔNG BAO GIỜ ghi plaintext im lặng. Ba điểm ghi hiện hành, dùng làm mẫu khi thêm điểm mới:

- `_encryptCreditLimitForWrite()` (`05_customers.js`) — throw `ENCRYPT_UNAVAILABLE`; giá trị rỗng/đã-là-ciphertext cho qua nguyên trạng.
- Helper `enc()` trong `_doSaveAsset` (`06_assets.js`) — post-check + throw `ENCRYPT_UNAVAILABLE` (hotfix.2); `_doSaveAsset` còn có gate `!masterKey` ngay đầu hàm (mirror `saveCustomer`).
- `saveCustomerNotes()` (`05_customers.js`) — post-check `_looksEncrypted(encNotes)`, notes rỗng cho qua (hotfix.2); mọi đường fail giữ nguyên edit mode để user không mất text vừa gõ.

### Cold cache và fail-open của `decryptText()`

`decryptText()` đồng bộ: cache hit trả plaintext; cold cache/sai khóa trả **nguyên ciphertext** (fail-open về giá trị trả về, không phải bảo đảm đã giải mã). Quy tắc:

1. **Ghi:** `await encryptText(plaintext)` trong `try/catch`, xong trước khi mở transaction. `encryptText()` từ chối chuỗi đã giống ciphertext (chống double-encrypt) và **fail-open trả nguyên plaintext khi không có khóa** — code ghi DB phải post-check bằng `_looksEncrypted` (pattern ở trên).
2. **Cần plaintext chắc chắn** (export backup, so trùng, điền form, Drive folder name): `await decryptFieldAsync(value)`.
3. **Hiển thị:** `_displayPlain()` / `_displayPlainAsync()`; kết quả vẫn mã hóa → render fallback (`'Đang tải...'`, `'•••'`), không render ciphertext. Pattern chuẩn cho field mã hóa trong list: render fallback đồng bộ + `_displayPlainAsync().then()` cập nhật tại chỗ.
4. **Nhận diện:** chỉ dùng `_looksEncrypted()`; không hard-code tiền tố, không giả định field nào luôn plaintext.
5. **Không giải mã được:** giữ ciphertext gốc. Không ghi đè rỗng, không mã hóa lồng. **Không còn** bất kỳ migration ngược ciphertext→plaintext nào (đã gỡ khỏi `renderAssets` và `07_drive.js`).

`primeFieldCache()` chỉ nạp token Drive; field KH/TSBĐ lazy-decrypt khi cần — không giả định cache nóng sau unlock.

## 6. KDATA (khóa backup)

- KDATA do Admin GAS cấp (`ensureBackupSecret()`), scope theo employee ID + device ID + Admin URL, TTL cache 30 phút, bản plaintext chỉ trong RAM (`APP_BACKUP_KDATA_B64U`) và bị xóa khi lock.
- **Sealed cache v2** — key `app_backup_kdata_cache_v2` = `{ts, identity, sealed}` với `sealed = cpg1:...` (AES-GCM dưới master key). `_writeCachedKdata()` ghi xong **đọc lại xác minh**; khi app còn khóa (AuthGate preflight) giữ `__pendingKdataCache` trong RAM, `_flushPendingKdataCache()` seal sau unlock **trước khi** dispatch `clientpro:unlocked`.
- **Migration legacy** — key v1 `app_backup_kdata_cache_v1` (plaintext, phiên bản cũ): chỉ đọc để migrate; seal → ghi v2 → xác minh → mới xóa v1; v1/v2 hỏng hoặc hết hạn bị loại bỏ an toàn; sealed bằng khóa khác chỉ bị dọn khi ĐÃ unlock (còn khóa thì giữ nguyên — không phá giá trị tốt).
- Không log KDATA. Không dùng PIN trực tiếp làm khóa mã hóa.

## 7. Backup / Restore

### Các loại
1. **Backup nội bộ** (Backup Manager): `BackupCore.exportAll()` decrypt thật (`decryptFieldAsync`) mọi field (gồm `creditLimit`, tên TSBĐ), bỏ driveLink + ảnh → JSON + hash → `encryptBackupPayload()` AES-256-GCM bằng KDATA → lưu store `backups`. Payload không phụ thuộc master key thiết bị.
2. **File `.cpb`** export/import.
3. **Drive** (`16_auto_backup_drive.js`): cùng `BackupCore.normalizeCustomerForExport()`, mã hóa KDATA, upload GAS cá nhân; thủ công + tự động hằng ngày, giữ 3 bản.
4. **Cloud Transfer** (`14_cloud_transfer.js`): re-encrypt bằng transfer key người nhận, inbox 24h.

Mọi luồng export (1–4) đi qua `BackupCore.normalizeCustomerForExport()` — hàm này **fail-closed**: `_assertUnlockedForExport()` kiểm `isAppUnlocked()` trước và sau chuỗi decrypt của từng customer, throw `APP_LOCKED` nếu app bị khóa giữa chừng (auto-lock ẩn app 15s). Lý do: `safeDecryptAsync` không bao giờ reject — mất khóa thì trả nguyên ciphertext, và ciphertext lọt vào field plaintext của backup sẽ mất dữ liệu vĩnh viễn khi restore trên thiết bị khác. `exportAll()`/`exportCustomersByIds()` cũng kiểm ngay đầu hàm. Caller (09/16/05) đã có try/catch + ErrorHandler nên lỗi hiện ra thật, không im lặng.

### Restore
- Kiểm tra unlock/masterKey + KDATA → confirm → decrypt payload → `BackupCore.restoreAllTransactional()`: re-encrypt TOÀN BỘ field (gồm `creditLimit` — `safeEncrypt` coerce number của backup cũ) **trước** transaction → upsert một transaction → refresh cache/migration/UI.
- Restore là upsert, không xóa database hiện có. `safeEncrypt` rule R3: ciphertext trong backup cũ không giải mã được → giữ nguyên, không ghi đè rỗng.
- **In-flight guard bắt buộc**: `__restoreInFlight`/`__backupInFlight` (module 09), `__acceptRestoreInFlight` + `__restoredInboxIds` (module 14 — retry cleanup remote không restore lần hai; restore fail không xóa remote), `manualBackupInProgress` + `autoBackupCheckInProgress` (module 16). Cờ đặt trước await đầu tiên, nhả trong `finally`; callback async (FileReader) giữ cờ tới khi callback kết thúc.
- `restoreData(input)`: reset `input.value` **vô điều kiện ngay đầu hàm** (chọn lại cùng file phải bắn change event).
- Backup cũ (mọi phiên bản trước) restore được trên v1.0.0; format mới restore được trên chính nó. Data integrity: so số record/ID/quan hệ/giá trị trước-sau (xem `tests/backup.test.js`, `tests/field-migration.test.js`, `tests/data-integrity.test.js`).

### Auto-backup Drive (B2)
Ba đường kích hoạt, đều idempotent: timer 15s ở bootstrap (cold start đã unlock) + listener `clientpro:unlocked` (+3s) + `visibilitychange`→visible. Single-flight `autoBackupCheckInProgress`; throttle 24h qua `CLIENTPRO_LAST_AUTO_BACKUP` — mốc này **chỉ được ghi sau khi upload thành công** (offline/lỗi Drive không cập nhật giả). Điều kiện: unlock + masterKey + Drive đã cấu hình + không có backup khác đang chạy.

## 8. Service Worker và cập nhật phiên bản

### Cache namespace
```js
const VERSION = 'v1.0.0-hotfix.2';  // sync-version.mjs quản (semver + hậu tố hotfix hợp lệ)
const CACHE_EPOCH = 'e2';           // thế hệ cache, tách khỏi semver
const STATIC_CACHE = `clientpro-${CACHE_EPOCH}-static-${VERSION}`;  // + 3 runtime cache cùng dạng
```
`CACHE_EPOCH` tồn tại vì repo từng dùng tên `clientpro-static-v1.0.0` trong lịch sử; public release quay về semver 1.0.0 nên phải ở namespace mới. **Bump epoch bất cứ khi nào semver có nguy cơ trùng một tên cache đã từng tồn tại; không bao giờ tái sử dụng tên lịch sử.** Activate cleanup xóa mọi cache `clientpro-*` ngoài allowlist 4 tên hiện hành (không đụng cache khác trên cùng origin).

### Chiến lược fetch
- Navigation: stale-while-revalidate + fallback `caches.match('./index.html')`. Bước revalidate nền chỉ ghi cache khi `res.ok` — một lỗi 5xx thoáng qua không được phép ghi đè app shell tốt (nếu không, lần mở offline tiếp theo sẽ "đóng băng" trang lỗi).
- Asset same-origin (`cacheFirst`): **(1) STATIC_CACHE exact match (kể cả `?v=`) → (2) runtime same-origin → (3) network** — chỉ `res.ok` mới được lưu runtime; KHÔNG dùng `caches.match()` không scope (tránh hit cache phiên bản cũ trong cửa sổ upgrade). Offline không phụ thuộc HTTP cache.
- Same-origin khác: network-first, cũng chỉ cache `res.ok`. Tiles/CDN: SWR vào cache riêng — **không** thêm guard `res.ok` ở đây: response cross-origin thường opaque (status 0), guard sẽ vô hiệu hóa cache ngoài ý muốn. OSRM: không intercept.

### Cập nhật (không force-reload)
- `install` KHÔNG `skipWaiting()`; trang KHÔNG gửi `SKIP_WAITING` chủ động và KHÔNG `location.reload()` ở `controllerchange` — SW mới chờ lifecycle chuẩn, build mới phục vụ **nguyên khối** ở lần mở tiếp theo. Trang chỉ set `window.__swUpdatePending` (UI "Cập nhật ngay" tương lai có thể postMessage `SKIP_WAITING` — handler này vẫn giữ trong `sw.js`).
- Mixed-version window (SW mới activate khi trang cũ còn mở — chỉ xảy ra ngoài luồng của ta): HTML cũ xin `?v=OLD` → precache mới miss → network vẫn trả đúng file (static hosting bỏ qua `?v=`); offline lúc đó chỉ còn navigation fallback. Chấp nhận được.
- Đổi `ASSET_V` phải đồng bộ mọi `?v=` trong `index.html` + `MAPLIBRE_V` trong `assets/03_map.js` (CI kiểm 3 nơi + token phải unique). Không đổi asset tag trong patch bị giới hạn phạm vi.

## 9. Z-index layering contract

Nguồn contract: comment trong `assets/styles.css` (trên rule `#loader`). Mọi lớp mới phải đặt theo bảng, không chèn tùy tiện:

| z | Lớp |
|---|---|
| 60/70 | menu overlay / settings menu |
| 120 | donate modal |
| 200 | business modal (backup-manager, asset, add, approve, ref-price, camera) |
| **250** | `#loader` — global loader, TRÊN mọi business modal |
| 300 | guide modal, `#screen-lock` (màn khóa không bao giờ bị loader che) |
| 305/310 | activation modal / setup-lock modal |
| 400/500 | `#toast` / `#app-toast-container` |
| 600 | `.cp-confirm-overlay` (confirm luôn bấm được trên loader) |
| 1000+ | onboarding tour |

- Loader không còn phụ thuộc workaround "đóng modal trước loader", nhưng các flow restore vẫn giữ lệnh đóng Backup Manager trước loader vì đó là UX đúng (sau restore về danh sách). Loader ẩn bằng `.hidden` (display:none) — không chặn touch.
- `LoadingManager.showGlobal()`/`hideGlobal(true)` refcounted; đừng tự bật/tắt `#loader` bằng classList ở code mới.
- `#loader` trong `index.html` KHÔNG mang class z-index; giá trị do `styles.css` quyết định (ID selector luôn thắng utility class — đừng lặp lại lỗi `z-[500]` cũ).

## 10. Edge swipe, long-press, History và Back

`assets/11_edge_back_swipe.js` — state machine 3 trạng thái:

1. **CANDIDATE** (`onStart`, touchstart): chạm trong dải `EDGE_PX=28` hai mép, không thuộc `shouldIgnoreTarget` (input/button/a[href]/maplibre/lightbox...) → chỉ ghi nhận sx/sy/st + bind touchmove. **TUYỆT ĐỐI KHÔNG `preventDefault()` ở touchstart** — sẽ giết synthetic click và biến dải mép thành vùng chết (bug A1 cũ).
2. **CLAIMED** (`onMove`): di chuyển ≥ `MIN_INTENT_PX=16` + hướng vào trong màn hình + ngang thắng dọc (`DIRECTION_RATIO=1.2`) → claim: `preventDefault()` (nếu `cancelable`) mỗi move + class `cp-swipe-noselect` chặn text selection. Không đạt → reject, gesture trong suốt (tap/long-press/scroll dọc đi qua nguyên vẹn).
3. **FIRE** (`onEnd`): đủ `TRIGGER_PX=80`, lệch dọc ≤ `MAX_OFF_AXIS_PX=70`, trong `MAX_GESTURE_MS=800` → `runBackAction()` + cooldown 450ms; gỡ noselect ở touchend/touchcancel.

`runBackAction()` đi theo priority list (đóng camera/lightbox/selection/modal/panel/screen theo đúng thứ tự); history depth tracking push đúng MỘT entry mỗi screen/modal mở (MutationObserver + pushState), popstate dedupe 600ms — không duplicate Back. Không thêm scaffold `DEBUG_MODE`/`dbg(` (CI grep chặn).

## 11. Confirm / modal / loader

- `ClientProConfirm` (qua `ErrorHandler.confirm`/`window.showConfirm`): mỗi Promise resolve đúng một lần; confirm mới thay confirm cũ → confirm cũ được đóng qua `_activeConfirmClose(false)` (resolve(false) + gỡ keydown listener + reset `_confirmOpen`) — **không bao giờ** chỉ `remove()` overlay (Promise treo sẽ kẹt vĩnh viễn mọi in-flight flag của caller đang await).
- Mọi caller `await confirm(...)`: đặt in-flight flag sau confirm, hoặc nếu đặt trước thì phải nhả trong `finally`.
- Back/edge-swipe đóng confirm qua Escape dispatch của `genericCloseTopOverlayOrPanel()` — hoạt động nhờ confirm có `role="dialog"`/`aria-modal`.

## 12. Pattern chống race condition

### Snapshot + sequence token
Hàm async phụ thuộc `currentCustomerId`/`currentAssetId`/record đang edit/tab/modal: snapshot trước `await`, bỏ kết quả cũ sau `await`:

```js
const askedId = currentCustomerId;
const seq = (window.__featureSeq = (window.__featureSeq || 0) + 1);
const result = await loadSomething(askedId);
if (seq !== window.__featureSeq || currentCustomerId !== askedId) return;
render(result);
```

Đang dùng: `__openFolderSeq`, `__galleryLoadSeq`, `__editCustModalSeq`, `__editAssetModalSeq`, `__cameraOpenSeq`, `__refPriceSeq` (guard CẢ lần render đầu của modal tham khảo giá lẫn bước OSRM; `closeRefModal()` tăng seq để hủy kết quả về muộn), `__customerListLoadToken`. **Đóng/reset modal → tăng sequence** — kể cả `closeAssetModal()` (hotfix.2: bump `__editAssetModalSeq` + reset `edit-asset-index`; nếu không, tail decrypt của `openEditAssetModal` qua được cả 2 guard và set LẠI `currentAssetId` sau khi đóng → ảnh chụp sau bị gán nhầm assetId). Form edit: reset field + khóa nút Lưu ngay, chỉ token mới nhất điền form.

### Single-flight và transaction
- Cờ hiện có: `__backupInFlight`, `__restoreInFlight`, `__acceptRestoreInFlight`, `manualBackupInProgress`, `autoBackupCheckInProgress`, `__custWriteInFlight`, `__assetSaveInFlight`, `__deleteCustomerInFlight`, `__deleteSelectedCustInFlight`, `__deleteImagesInFlight`, `__deleteOpenedImageInFlight`, `__gpsBusy`.
- IndexedDB: đọc ở transaction riêng → xử lý async bên ngoài → mở transaction ghi. Promisify bằng helper `__custTxDone`/`__imgTxDone`/`waitTx` (xử lý đủ `oncomplete`/`onerror`/`onabort`); promise resolve/reject trên mọi nhánh. Batch delete = một transaction (all-or-nothing).
- **Mọi** promise/callback bọc transaction ghi — kể cả ngoài luồng destructive — phải wire cả `onabort`: transaction có thể abort mà KHÔNG có request error đi trước (quota, versionchange...), khi đó `onerror` không bắn; thiếu `onabort` là promise treo và in-flight guard/loader kẹt vĩnh viễn tới khi reload. Đã wire đủ tại: `_doSaveCustomer`, `persistCurrentCustomer`, `_idbPutBackup`/`_idbDeleteBackup` (hotfix.1); `saveCustomerNotes`, `saveImageToDB`, `reconnectAssetDriveFolder`, `_deleteSucceededUploadsOnly`, 2 put-wrapper migration trong `02_security.js` (hotfix.2). Callback kiểu `onDone`/báo lỗi phải chốt gọi đúng MỘT lần (settled guard) — request error bubble lên `tx.onerror` rồi tx abort bắn tiếp `onabort`: hai sự kiện cho một thất bại. Ngoại lệ duy nhất được chấp nhận: cleanup ảnh mồ côi best-effort sau xóa TSBĐ (`deleteAsset`, `05_customers.js`) — fire-and-forget có chủ đích.
- Success UI (toast, đổi mode, cập nhật view model trong RAM) chỉ chạy trong `oncomplete` — put/add `onsuccess` chưa bảo đảm dữ liệu đã commit (quy tắc #7 áp dụng cho CẢ luồng ghi thường).
- Tìm kiếm: `openCustomerList()` xóa `#search-input` + `window.__searchDebounced.cancel()` trước `loadCustomers('')` — danh sách và ô tìm kiếm luôn cùng một query.

## 13. UI, CSP

- Interaction tĩnh: `data-action` + whitelist `CLICK_ACTIONS`/`CHANGE_ACTIONS` (`00_globals.js`).
- Dữ liệu người dùng/server vào DOM bằng `textContent`, DOM builder, URL guard (`isSafeImageUrl`, `isSafeDriveUrl`).
- `script-src 'self'`; không inline script/handler. `style-src` còn `'unsafe-inline'` cho theme hiện hữu.
- Screen transition 300ms; tránh decrypt/render nặng trong animation.
- Drive folder name (`07_drive.js`): dựng từ decrypt async THẬT (`_displayPlainAsync`); không giải mã được → dừng + báo lỗi, không bao giờ đưa ciphertext/rỗng vào tên folder. Áp dụng ở `reconnectAssetDriveFolder`, `uploadAssetToDrive` lẫn `uploadToGoogleDrive` (hotfix.2 vá chỗ cuối).

## 14. MapLibre / OSRM

- MapLibre GL + supercluster self-host, lazy-load khi mở màn bản đồ (`MAPLIBRE_V` phải bằng `ASSET_V`).
- Khoảng cách: OSRM đường bộ (host trong `01_config.js`, SW không intercept) + haversine dự phòng; tham khảo giá prime decrypt async trước khi đọc field.
- Canvas map nằm trong ignore-list của edge-swipe (gesture bản đồ không bị tranh chấp).

## 15. Lệnh chạy / test / build

```bash
python3 -m http.server 8080          # chạy local (không cần build)
npm test                             # unit (node --test, không cần npm install)
npm run check:version                # kiểm semver + anchors
node --check sw.js
find assets -name '*.js' -print0 | xargs -0 -n1 node --check
python3 -m json.tool manifest.json vercel.json
npm install && npm run test:e2e      # Playwright (Pixel 5 mặc định)
```

Test chính:
- `tests/crypto.test.js` — field cipher, tamper, legacy, master key, `lockApp`.
- `tests/kdata-cache.test.js` — KDATA sealed v2, pending RAM, migration v1→v2, lifecycle lock, sự kiện unlocked.
- `tests/field-migration.test.js` — migration mã hóa `creditLimit`/`asset.name`, idempotent, race lockApp, backup round-trip.
- `tests/backup.test.js` — `.cpb`, cold-cache export/restore, integrity.
- `tests/sw-routing.test.js` + `tests/helpers/load-sw.js` — cacheFirst precache-first, không cache response lỗi (cả cacheFirst, networkFirst lẫn navigation revalidate), activate dọn cache cũ (kể cả tên lịch sử), install không skipWaiting.
- `tests/pwa.test.js` — precache đủ module, version sync (đọc `package.json`), CACHE_EPOCH không trùng tên lịch sử, pwa.js không force-reload.
- `tests/regressions.test.js` — tripwire tĩnh A1/B1/B5/B6/B8/B9 + hotfix.1 #2–#6 (seq guard tham khảo giá, onabort, export fail-closed, báo lỗi inbox restore) + hotfix.2 #1–#8 (gate + post-check `enc()` của `_doSaveAsset`, seq `closeAssetModal`, `saveCustomerNotes` post-check + tx đủ 3 event + success-sau-commit, onabort ở 07/08, folder name upload qua decrypt async, onabort put-wrapper migration).
- `tests/data-integrity.test.js`, `tests/schema.test.js` — migration và data contract.
- `e2e/` — smoke, crud (gồm B4/B8/B9), confirm (B5), edge-swipe (A1), layering (A3), offline + marker precache (A2), autolock, a11y.

Test harness: `tests/helpers/load-security.js` nạp `02_security.js` nguyên bản vào `node:vm` (stub localStorage/webcrypto/document tối thiểu; `makeFakeDb` hỗ trợ cả request callbacks lẫn `tx.oncomplete/onerror/onabort`). Không thêm npm dependency cho test.

## 16. Checklist trước release

1. Full gate xanh: syntax + JSON + `npm test` + `check:version` + `npx playwright test`.
2. Đổi semver ở `package.json` → `sync:version` → `check:version`; nếu đổi `ASSET_V` → thay mọi `?v=` trong `index.html` + `MAPLIBRE_V`.
3. Nếu semver mới có nguy cơ trùng tên cache lịch sử → bump `CACHE_EPOCH`.
4. Kiểm upgrade: cache phiên bản cũ bị activate dọn (unit `sw-routing`), offline boot từ precache với runtime cache rỗng.
5. Migration test trên dữ liệu mô phỏng phiên bản cũ (creditLimit number, asset.name plaintext, KDATA v1).
6. README anchors (badge/semver/ASSET_V) còn khớp regex trong `scripts/sync-version.mjs`.

## 17. Những điều agent tuyệt đối không được làm

- Xóa IndexedDB/localStorage/cache tổng quát để "sửa" migration hoặc lỗi.
- Dùng decrypt đồng bộ (`decryptText`) cho dữ liệu bắt buộc plaintext khi cold-cache (export, so trùng, form, folder name).
- Ghi field mã hóa at rest bằng kết quả `encryptText()` mà KHÔNG post-check `_looksEncrypted` (fail-open sẽ ghi plaintext khi mất masterKey giữa chừng).
- Mở transaction ghi mà không wire đủ `oncomplete`/`onerror`/`onabort` (trừ cleanup best-effort đã ghi nhận ở mục 12); báo success UI trước khi transaction commit.
- Nuốt transaction error / báo thành công giả / `location.reload()` để che exception.
- Persist KDATA hoặc bất kỳ secret plaintext nào vào browser storage.
- Ghi plaintext vào field thuộc danh sách mã hóa at rest (mục 5), kể cả "tạm thời".
- `preventDefault()` ở touchstart trong edge-swipe.
- Force `skipWaiting`/`location.reload()` khi SW update; bump version SW mà không kiểm tra cache upgrade + đồng bộ `?v=`.
- Đổi contract GAS (`gas/*.gs`) khi không thật sự bắt buộc.
- Thêm CDN/inline handler/nới CSP; thêm npm dependency khi code hiện tại giải quyết được.
- Sửa test để chấp nhận hành vi sai; test phải kiểm hành vi thực tế.

## 18. Trạng thái hiện tại

- `v1.0.0-hotfix.2` (2026-07-12) — sửa 7 bug từ đợt rà soát toàn dự án; tất cả thuộc đúng 2 lớp lỗi hotfix.1 đã sửa nơi khác nhưng bỏ sót vị trí: **(lớp 1)** `encryptText()` fail-open ghi plaintext vào field mã hóa at rest, **(lớp 2)** transaction ghi thiếu `onabort`. Không bug nào bị test cũ bắt được; đã thêm tripwire hotfix.2 #1–#8 vào `tests/regressions.test.js`:
  1. `06_assets.js` `_doSaveAsset`: gate `!masterKey` đầu hàm + post-check `_looksEncrypted` trong helper `enc()` (throw `ENCRYPT_UNAVAILABLE`) — lock giữa chừng flow lưu không còn ghi plaintext 8 field TSBĐ (mục 5).
  2. `05_customers.js` `saveCustomerNotes`: post-check `_looksEncrypted(encNotes)` (notes rỗng cho qua); transaction wire đủ `oncomplete`/`onerror`/`onabort` + settled guard; success UI (toast, `exitNotesEditMode`, cập nhật `currentCustomerData`) chuyển vào `oncomplete` — hết ghi plaintext notes, hết "Đã lưu" giả trước commit (mục 5, 12).
  3. `06_assets.js` `closeAssetModal`: bump `__editAssetModalSeq` + reset `edit-asset-index` — tail decrypt của `openEditAssetModal` không còn set lại `currentAssetId` sau khi đóng modal; ảnh chụp sau hết bị gán nhầm assetId (mục 12).
  4. `07_drive.js` `reconnectAssetDriveFolder`: transaction lưu driveLink wire `onabort` (+settled guard) — loader "Đang tìm TSBĐ..." không còn treo vĩnh viễn khi tx abort không kèm request error (mục 12).
  5. `07_drive.js` `uploadToGoogleDrive`: folder name dựng bằng `_displayPlainAsync` (decrypt thật) + guard dừng và báo lỗi khi không giải mã được — không còn upload folder tên rác " - " (mục 13).
  6. `08_images_camera.js` `saveImageToDB`: capture transaction, success chuyển vào `oncomplete`, wire `onerror`/`onabort` + settled guard — loader "Đang lưu ảnh..." không còn treo, Promise luôn resolve (mục 12).
  7. `07_drive.js` `_deleteSucceededUploadsOnly` + 2 put-wrapper migration trong `02_security.js` (`runImageCryptoMigrationIfNeeded`, `runFieldCryptoMigrationIfNeeded`): wire `onabort` (migration còn chuyển resolve từ put `onsuccess` sang `oncomplete`) — hết nuốt lỗi im lặng / promise treo giữa unlock flow (mục 12).
  Ghi nhận không sửa (chấp nhận có chủ đích): cleanup ảnh mồ côi sau xóa TSBĐ là best-effort fire-and-forget; `data-action="zalo"/"call"` hoạt động qua href/listener riêng (chỉ console.warn từ dispatcher); onboarding tour z-1000 nằm trên màn khóa là edge UX không lộ dữ liệu (masterKey đã bị xóa). Cache namespace: `clientpro-e2-*-v1.0.0-hotfix.2` (tên mới, chưa từng tồn tại → không bump epoch). `ASSET_V` giữ nguyên (precache install dùng `cache:'reload'` nên asset vẫn tươi).
- `v1.0.0-hotfix.1` (2026-07-12) — sửa 6 bug từ đợt audit tay sau public release: (1) `sw.js` `networkFirst()` + revalidate của navigation chỉ cache khi `res.ok` — lỗi 5xx thoáng qua không ghi đè app shell tốt; (2) `06_assets.js` seq guard CẢ lần render đầu modal tham khảo giá, `closeRefModal()` tăng `__refPriceSeq`; (3) `05_customers.js` `_doSaveCustomer` (2 transaction ghi) + `04_ui_common.js` `persistCurrentCustomer` (kèm settled guard cho `onDone`) wire `onabort`; (4) `12_backup_core.js` export fail-closed — `_assertUnlockedForExport()`; (5) `14_cloud_transfer.js` `acceptAndRestore` catch + `ErrorHandler.showError`; (6) `09_backup_manager.js` `_idbPutBackup`/`_idbDeleteBackup` wire `onabort`. Tooling version (`sync-version.mjs`, ci.yml, `pwa.test.js`) chấp nhận hậu tố hotfix; badge README tự escape `-` thành `--` theo chuẩn shields.io.
- `v1.0.0` (public release, 2026-07-11) — sửa 12 lỗi A1–A3/B1–B9: edge-swipe state machine không còn vùng chết mép màn hình (A1); cacheFirst dùng precache đúng build, offline không phụ thuộc HTTP cache (A2); layering contract, loader 250 trên business modal (A3); reset file input `.cpb` (B1); auto-backup re-check sau unlock qua `clientpro:unlocked` (B2); KDATA sealed v2 (B3); mã hóa at-rest `creditLimit` + `asset.name` kèm migration verify-per-record (B4); confirm lifecycle không treo Promise (B5); in-flight guard inbox restore (B6); SW update không force-reload (B7); delete promisify transaction + báo lỗi thật (B8); search/list đồng bộ (B9). Cache namespace mới `clientpro-e2-*-v1.0.0` (epoch tách semver, không trùng cache lịch sử). Tính năng giữ nguyên từ bản nội bộ 1.6.x: tự khóa khi ẩn app 15s, biometric, cloud transfer, auto-backup Drive, onboarding tour.
- Mốc tài liệu: 2026-07-12 (ICT).

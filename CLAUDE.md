# CLAUDE.md — ClientPro engineering guide

> Đọc file này trước khi sửa code. `index.html` và mã nguồn vẫn là nguồn xác thực cuối cùng khi cần kiểm tra chi tiết.

## 1. Tổng quan

ClientPro là PWA mobile-first quản lý khách hàng và tài sản bảo đảm. Ứng dụng dùng vanilla JavaScript, HTML và CSS thuần; không framework, không bước build và không backend ứng dụng riêng. Dữ liệu nghiệp vụ nằm trên thiết bị, được mã hóa, hoạt động offline qua Service Worker và chỉ rời thiết bị khi người dùng chủ động dùng Google Drive/Google Apps Script.

- Phiên bản: `1.6.4`
- Cache-buster asset: `V164_20260711`
- Demo: https://client-pro-beryl.vercel.app
- Database: IndexedDB `QLKH_Pro_V4`, schema version `5`
- Runtime dependency: toàn bộ thư viện, font và icon được self-host trong `assets/`
- Deploy: static hosting; cấu hình Vercel và CSP trong `vercel.json`

## 2. Quy tắc bắt buộc

1. Không làm mất, làm trắng, double-encrypt hoặc hiển thị ciphertext của dữ liệu người dùng.
2. Không bỏ qua activation, PIN/biometric gate, `masterKey` hoặc kiểm tra server của backup/restore.
3. Không thêm CDN, inline event handler hoặc nới CSP. UI tĩnh dùng `data-action`; dữ liệu động ưu tiên DOM API và `textContent`.
4. Không `await` WebCrypto hay tác vụ bất đồng bộ ở giữa một IndexedDB transaction. Chuẩn bị dữ liệu trước, sau đó mở transaction và ghi đồng bộ.
5. Không đọc global state sống sau một chuỗi `await`; phải dùng snapshot và sequence token khi kết quả có thể trở nên cũ.
6. Dùng `ErrorHandler`, `LoadingManager` và `ModalA11y`; không thêm `alert()`/`confirm()` thô hay thay z-index toàn cục cho lỗi cục bộ.
7. `package.json` là nguồn semver duy nhất. Sau khi đổi version, chạy `npm run sync:version` và `npm run check:version`.
8. Thay đổi hẹp phải giữ diff hẹp. Không refactor hoặc sửa hành vi ngoài phạm vi task.

## 3. Kiến trúc runtime

### App shell và storage

- `index.html` chứa SPA shell, các screen và thứ tự script.
- `assets/ui/load_modals.js` nạp HTML fragment trong `assets/ui/modals/`; bootstrap chờ `window.__clientpro_modals_ready` với timeout an toàn.
- IndexedDB có ba store:
  - `customers`: record khách hàng; `assets` và `notes` nằm trong record khách hàng.
  - `images`: ảnh theo `customerId`, có thể có `assetId`.
  - `backups`: bản `.cpb` mã hóa trong Backup Manager, có index `createdAt`, `hash`, `deviceId`.
- `localStorage` chỉ giữ cấu hình, envelope khóa, trạng thái activation, URL/token GAS đã niêm phong và các cache nhỏ. Không lưu plaintext master key.

### Module đánh số và thứ tự load

Tên `NN_*.js` biểu thị tầng phụ thuộc, không có nghĩa trình duyệt tự sắp xếp theo số. Tất cả script dùng `defer`; thứ tự trong `index.html` là nguồn duy nhất:

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

`19_error_loading.js` cố ý load sớm hơn các module nghiệp vụ dù mang số 19. Các file số 09 là các feature cùng tầng, không phải một chuỗi phụ thuộc lẫn nhau.

### Vai trò các file chính

| File | Trách nhiệm |
|---|---|
| `assets/00_globals.js` | Helper chung, state toàn cục, screen transition, guard hiển thị ciphertext, bảng `CLICK_ACTIONS`/`CHANGE_ACTIONS` |
| `assets/01_config.js` | URL GAS, weather, donate, OSRM và các hằng số dùng chung |
| `assets/02_security.js` | Master key, field/image cipher, PIN envelope, migration, backup envelope và security gate cục bộ |
| `assets/12_backup_core.js` | Nguồn chuẩn hóa duy nhất cho export/restore; decrypt thật khi export, re-encrypt khi restore |
| `assets/15_auth_gate.js` | Preflight quyền thiết bị/tài khoản với Admin GAS |
| `assets/03_map.js` | MapLibre, marker/cluster và khoảng cách đường OSRM |
| `assets/04_ui_common.js` | State hồ sơ đang mở, modal/screen/tab và UI dùng chung |
| `assets/19_error_loading.js` | Error, toast, confirm, button/global loading và modal accessibility |
| `assets/05_customers.js` | Danh sách, tìm kiếm, CRUD, chi tiết khách hàng và ghi chú |
| `assets/06_assets.js` | CRUD tài sản bảo đảm và tham khảo giá |
| `assets/08_images_camera.js` | Camera, ảnh mã hóa, gallery, lightbox, chia sẻ và chọn nhiều |
| `assets/09_backup_manager.js` | Backup nội bộ, export/import `.cpb`, restore và UI Backup Manager |
| `assets/07_drive.js` | Cấu hình GAS cá nhân và upload ảnh lên Drive |
| `assets/14_cloud_transfer.js` | Gửi/nhận backup giữa user bằng khóa chuyển riêng người nhận |
| `assets/16_auto_backup_drive.js` | Backup Drive thủ công/hằng ngày, danh sách, restore và retention |
| `assets/18_biometric_unlock.js` | WebAuthn PRF; bảo vệ PIN rồi tái sử dụng `validatePin()` |
| `assets/10_bootstrap.js` | DOM ready, mở/nâng cấp IndexedDB, boot security/UI và khởi động background task |
| `sw.js`, `assets/pwa.js` | Precache/offline, runtime cache, đăng ký và cập nhật Service Worker |
| `gas/AdminAPI.gs` | Activation, KDATA, transfer và quyền trung tâm |
| `gas/UserDriveAPI.gs` | Drive cá nhân: ảnh và file backup |

## 4. Mô hình bảo mật và encryption

### Khóa và envelope

- Master key mới có dạng `MK2:` + 32 byte ngẫu nhiên. Khi unlock, `_installMasterKey()` import thành AES-256-GCM `CryptoKey` non-extractable và chỉ giữ trong RAM.
- Master key được niêm phong trong `PIN_KEY`/`SEC_KEY` bằng PBKDF2-SHA256 + AES-GCM. PIN hiện tại dài 6 số.
- WebAuthn PRF bảo vệ PIN, không thay thế luồng `validatePin()` và không bọc trực tiếp master key.
- Dữ liệu legacy `U2FsdGVk...` dùng CryptoJS chỉ để đọc/migrate. Migration sang `cpg1:` là idempotent và resume-safe: stage khóa mới, migrate từng record, chỉ swap envelope sau khi hoàn tất.
- Field mới dùng envelope `cpg1:` + base64url(`iv[12] || ciphertext || tag`). Ảnh data URL cũng được mã hóa at rest.

### Cold cache và fail-open

`decryptText()` là API đồng bộ để phục vụ code cũ. Với `cpg1:`:

- cache hit: trả plaintext;
- cold cache/cache miss/sai khóa: trả nguyên ciphertext.

Đây là fail-open về **giá trị trả về**, không phải bảo đảm đã giải mã. Vì vậy tuyệt đối không dùng `decryptText()` khi bắt buộc có plaintext, như export backup, so trùng, điền form edit hoặc xử lý trước khi ghi.

Quy tắc field cipher:

1. **Ghi:** `await encryptText(plaintext)` trong `try/catch`, hoàn tất trước khi mở IndexedDB transaction. `encryptText()` từ chối chuỗi đã giống ciphertext.
2. **Cần plaintext chắc chắn:** dùng `await decryptFieldAsync(value)`. Hàm này dedupe các lần decrypt đồng thời và seed cache.
3. **Hiển thị:** dùng `_displayPlain()` hoặc `_displayPlainAsync()`; nếu kết quả vẫn mã hóa thì render fallback, không render ciphertext.
4. **Nhận diện:** chỉ dùng `_looksEncrypted()`; không tự hard-code riêng `cpg1:` hay giả định field nào luôn plaintext.
5. **Không giải mã được:** giữ ciphertext gốc. Không ghi đè rỗng và không mã hóa lồng thêm một lớp.

`primeFieldCache()` chỉ nạp tối thiểu token Drive. Field khách hàng/tài sản được lazy-decrypt khi cần; code không được giả định toàn bộ cache đã nóng sau unlock.

### Fail-open của Auth Gate

`assets/15_auth_gate.js` không khóa UI khi offline, timeout, lỗi mạng hoặc phản hồi server không chắc chắn. Chỉ trạng thái locked/sai thiết bị lặp đủ strike mới chặn cứng. Đây là quyết định tránh khóa oan; nó không nới backup/restore: các luồng đó vẫn bắt buộc app đã unlock, có `masterKey` và lấy/kiểm tra KDATA qua `ensureBackupSecret()`.

## 5. Luồng backup/restore

### Backup nội bộ

```text
unlock + masterKey
→ requireBackupSecretOrAlert() lấy KDATA theo employee/device
→ BackupCore.exportAll()
→ decryptFieldAsync() các field, bỏ driveLink và ảnh
→ JSON + hash
→ encryptBackupPayload() AES-256-GCM bằng KDATA
→ lưu record mã hóa vào store backups
```

KDATA cache 30 phút và được scope theo employee ID, device ID và Admin GAS URL. Backup không phụ thuộc master key của thiết bị để giải mã file: payload bên trong là plaintext đã được bọc bằng KDATA; khi restore, dữ liệu được mã hóa lại bằng master key đang mở trên thiết bị đích.

### Restore nội bộ

```text
kiểm tra unlock/masterKey + KDATA
→ đọc record backup
→ người dùng xác nhận
→ closeBackupManager()
→ LoadingManager.showGlobal("Đồng bộ...")
→ decryptBackupPayload() + JSON.parse()
→ BackupCore.restoreAllTransactional()
→ re-encrypt toàn bộ field trước transaction
→ upsert customers/images trong một transaction
→ refresh cache/migration/UI
```

Restore là upsert, không xóa sạch database hiện tại. `safeEncrypt()` trong BackupCore cố giải mã ciphertext lọt vào backup cũ; nếu không thể thì giữ nguyên ciphertext theo quy tắc bảo toàn dữ liệu.

Restore trong máy (v1.6.1), restore Google Drive (v1.6.2), nhập file `.cpb` và nhận/khôi phục inbox (v1.6.3) đều phải đóng Backup Manager **trước** global loader để loader không bị business modal che. Lệnh `closeBackupManager()` sau restore trong máy thành công vẫn được giữ và là no-op an toàn. Riêng backup trong máy khi Backup Manager đang mở (v1.6.3) thì **bỏ** global loader (cùng z-index nên bị che) và giữ modal mở để danh sách backup được refresh. Không sửa z-index toàn cục hoặc `LoadingManager` cho trường hợp này.

### Drive và Cloud Transfer

- `16_auto_backup_drive.js` dùng cùng `BackupCore.normalizeCustomerForExport()`, mã hóa bằng KDATA rồi upload qua GAS cá nhân. Có backup thủ công, kiểm tra hằng ngày và giữ tối đa 3 bản Drive theo client hiện tại.
- Restore Drive tải ciphertext rồi tái sử dụng `_restoreFromEncryptedContent()`.
- Cloud Transfer giải mã backup bằng khóa cá nhân người gửi, mã hóa lại bằng transfer key của người nhận, lưu inbox tối đa 24 giờ rồi người nhận restore bằng khóa chuyển của chính họ.

## 6. Pattern chống race condition

### Snapshot + sequence token

Mọi hàm async phụ thuộc `currentCustomerId`, `currentAssetId`, record đang edit, tab hoặc modal phải snapshot trước `await` và bỏ kết quả cũ sau `await`:

```js
const askedId = currentCustomerId;
const seq = (window.__featureSeq = (window.__featureSeq || 0) + 1);
const result = await loadSomething(askedId);
if (seq !== window.__featureSeq || currentCustomerId !== askedId) return;
render(result);
```

Các pattern đang có: `__openFolderSeq`, `__galleryLoadSeq`, `__editCustModalSeq`, `__editAssetModalSeq`, `__cameraOpenSeq` và `__refPriceSeq`. Khi đóng/reset modal, tăng sequence để vô hiệu hóa công việc cũ. Với form edit, reset field và khóa nút Lưu ngay; chỉ token mới nhất được điền form và mở khóa nút.

### Single-flight và transaction

- Dùng cờ như `__backupInFlight`, `__restoreInFlight`, `_inflight` hoặc `manualBackupInProgress` để chặn double-submit.
- Snapshot ID/record trước thao tác nén ảnh, crypto, network hoặc confirm dài; không đọc lại global sau đó để quyết định nơi ghi.
- Với IndexedDB: đọc ở transaction riêng, xử lý async bên ngoài, rồi mở transaction ghi. Luôn xử lý `onerror`/`onabort`; promise phải resolve/reject trên mọi nhánh.
- Callback async như `FileReader.onload` phải giữ cờ in-flight đến khi callback kết thúc, không nhả khi hàm bao ngoài vừa return.

## 7. UI, CSP và loading

- Interaction tĩnh khai báo bằng `data-action` và whitelist trong `CLICK_ACTIONS`/`CHANGE_ACTIONS` của `00_globals.js`.
- Dữ liệu người dùng/server đi vào DOM bằng `textContent`, DOM builder và URL guard (`isSafeImageUrl`, `isSafeDriveUrl`).
- `script-src 'self'`; không thêm inline script/handler. `style-src` hiện còn `'unsafe-inline'` cho style/theme hiện hữu.
- Screen transition chuẩn dài 300 ms; tránh decrypt/render nặng trong animation.
- Global loading dùng `LoadingManager.showGlobal()`/`hideGlobal(true)`. Nếu business modal che loader trong một flow cụ thể, điều chỉnh thứ tự đóng modal của flow đó; không thay z-index chung.

## 8. Versioning, PWA và kiểm tra

Semver:

```bash
# sửa package.json
npm run sync:version
npm run check:version
```

Script đồng bộ semver sang `manifest.json`, `sw.js`, `assets/pwa.js` và các neo version trong `README.md`.

`ASSET_V` trong `sw.js` là cache-buster độc lập. Khi một task yêu cầu đổi asset tag, phải đồng bộ toàn bộ `?v=` trong `index.html` và `MAPLIBRE_V` trong `assets/03_map.js`; CI kiểm tra ba nơi này. Không tự ý đổi asset tag trong một patch bị giới hạn phạm vi.

Kiểm tra tối thiểu:

```bash
python3 -m json.tool manifest.json vercel.json
node --check sw.js
find assets -name '*.js' -print0 | xargs -0 -n1 node --check
node --test 'tests/**/*.test.js'
npm run check:version
```

Test chính:

- `tests/crypto.test.js`: field cipher, tamper, legacy, master key.
- `tests/backup.test.js`: `.cpb`, cold-cache export/restore và integrity.
- `tests/data-integrity.test.js`, `tests/schema.test.js`: migration và data contract.
- `tests/pwa.test.js`: Service Worker, precache và version.
- `e2e/`: smoke, CRUD, offline và accessibility bằng Playwright.

## 9. Trạng thái hiện tại

- `v1.6.4` — GPS trong form TSBĐ bỏ global loader (bị `#asset-modal` che do `#loader` z-index 200): dùng `LoadingManager.showButtonLoading()` trên nút GPS + message trạng thái qua placeholder `#asset-link` (khôi phục trong `finally`); `confirmEnable()` sinh trắc học bọc `enable(pin)` trong `try/catch/finally` để nút không kẹt "Đang xác thực..." khi throw; `.customer-name-line` đổi `display:flex` → `display:block` để `text-overflow:ellipsis` hiện "..." với tên dài.
- `v1.6.3` — đóng Backup Manager trước loader khi nhập `.cpb` (`restoreData`) và nhận/khôi phục inbox (`acceptAndRestoreById`); backup trong máy bỏ global loader khi modal đang mở; guide tọa độ lên `z-[300]` (trên form TSBĐ) và sửa copy "nút Đỏ"; overlay cảnh báo trùng SĐT/CCCD lên `z-[300]`; danh sách KH thay card cũ bằng "Đang tải..." khi đổi tab/tìm kiếm; tắt loader trước overlay chọn người nhận khi gửi KH; thêm `?v=` cho Tailwind + app.patch.css; Việt hóa copy (Khôi phục, Đang tải..., Ủng hộ, Lên Drive, Chưa có tọa độ, Sao lưu ngay, KHÔNG CÓ ẢNH).
- `v1.6.2` — restore Google Drive đóng `#backup-manager-modal` ngay trước khi gọi global loader trong `restoreFromDriveBackup(fileId)`.
- `v1.6.1` — restore backup trong máy đóng `#backup-manager-modal` ngay trước khi gọi global loader trong `_doRestoreBackupFromApp(id)`. Không đổi z-index hoặc `LoadingManager`.
- `v1.6.0` — BackupCore export đã dùng async decrypt thật để tránh ciphertext `cpg1:` lọt vào backup khi cold cache; restore bảo toàn ciphertext cũ không giải mã được. Các flow async quan trọng đã áp dụng snapshot + sequence token/single-flight.
- Mốc tài liệu: 2026-07-11 (ICT).

# CLAUDE.md — Sổ tay kỹ thuật ClientPro

> Đọc file này trước khi sửa code. Mục tiêu: quét một lượt là hiểu toàn bộ dự án,
> chỉ mở file code khi cần đào sâu. Mã nguồn và `index.html` là nguồn xác thực
> cuối cùng — luôn tham chiếu bằng **file + tên hàm**, không dùng số dòng cứng.

## 1. ClientPro là gì

- PWA **mobile-first** quản lý **khách hàng** và **tài sản bảo đảm**, tối ưu cho
  Android Chrome ở chế độ standalone.
- **Offline-first, privacy-first**: dữ liệu nghiệp vụ nằm trong IndexedDB trên
  thiết bị; field nhạy cảm mã hóa bằng WebCrypto.
- **Vanilla JavaScript + HTML + CSS**, zero-dependency lúc runtime, **không build
  step**. Dependency và font đều self-host. Deploy static (Vercel).

## 2. Sự thật cốt lõi (tra cứu nhanh, khỏi grep)

| Hạng mục | Giá trị hiện tại | Nguồn xác thực |
|---|---|---|
| Tên phát hành (release) | `Genesis` | tên phát hành công khai; không còn hiển thị trong UI app |
| Phiên bản app (semver) | `1.0.6` | `package.json` (single source of truth — số kỹ thuật nội bộ, không hiển thị cho người dùng) |
| Cache-buster asset | `UXREFINE_20260716` | `ASSET_V` trong `sw.js` |
| Cache epoch | `genesis` | `CACHE_EPOCH` trong `sw.js` |
| Tên cache SW | `clientpro-genesis-{static,runtime-so,runtime-cdn,runtime-tile}-<ver>` | `sw.js` |
| Database | `QLKH_Pro_V4`, schema **version 5** | `assets/10_bootstrap.js` (`indexedDB.open`) |
| Object stores | `customers`, `images`, `backups` (đều `keyPath: "id"`) | `assets/10_bootstrap.js` |
| Thứ tự thực thi module | xem §4 | `index.html` |
| Header bảo mật / CSP | — | `vercel.json` |

`ASSET_V` phải khớp **mọi** `?v=` trong `index.html`. Sau khi đổi version, chạy
`npm run sync:version` để đồng bộ manifest, SW, PWA và README (§7).

## 3. Bản đồ module — file nào lo việc gì

Mỗi file dưới `assets/` là một tầng nghiệp vụ. Cần sửa gì thì mở đúng file đó.

| File | Trách nhiệm |
|---|---|
| `00_globals.js` | Helper toàn cục (`getEl`, `debounce`), tên DB, biến chia sẻ |
| `01_config.js` | Cấu hình weather (Open-Meteo), `ADMIN_SERVER_URL`, key localStorage |
| `02_security.js` | Mã hóa field AES-256-GCM (WebCrypto), masterKey/PIN/PBKDF2, migrate CryptoJS legacy |
| `03_map.js` | MapLibre GL, gom cụm bằng Supercluster, khoảng cách đường bộ qua OSRM |
| `04_ui_common.js` | Helper dựng DOM an toàn `el()`, khung overlay/modal |
| `05_customers.js` | CRUD khách hàng, render danh sách, icon SVG |
| `06_assets.js` | CRUD tài sản bảo đảm, giá tham khảo / khoảng cách (seq + in-flight guard) |
| `07_drive.js` | Upload Google Drive và cấu hình user script |
| `08_images_camera.js` | Chụp / lưu / xem / chọn ảnh theo `customerId`/`assetId` |
| `09_menu.js` | Menu cài đặt |
| `09_backup_manager.js` | Backup ngay trong app (store `backups`), chống double-submit |
| `09_donate.js` | QR ủng hộ (VietQR) |
| `09_weather.js` | Thời tiết (Open-Meteo, không cần API key) |
| `10_bootstrap.js` | Mở IndexedDB (schema v5, tạo store), khởi động app, date ticker |
| `11_edge_back_swipe.js` | Vuốt cạnh kiểu Android để back, đóng overlay |
| `12_backup_core.js` | Lõi backup/restore: normalize, export (decrypt async), restore (re-encrypt) |
| `13_ui_select_customers.js` | UI chọn khách hàng cho backup/transfer một phần |
| `14_cloud_transfer.js` | Gửi backup cho user khác qua Google Apps Script |
| `15_auth_gate.js` | Cổng kiểm quyền khi mở app (khóa / sai thiết bị / chưa kích hoạt) |
| `16_auto_backup_drive.js` | Auto backup hằng ngày lên Drive qua Admin GAS (giữ 3 bản mới nhất) |
| `17_onboarding_tour.js` | Tour hướng dẫn cho lần dùng đầu |
| `18_biometric_unlock.js` | Mở khóa Face ID / vân tay qua WebAuthn PRF (bổ trợ PIN, không hạ cấp) |
| `19_error_loading.js` | `ErrorHandler` + `LoadingManager` chuẩn hóa (nguồn duy nhất) |
| `pwa.js` | Đăng ký Service Worker, luồng cập nhật PWA |

Tài nguyên đi kèm:

- `assets/ui/modals/*.html` — 14 fragment modal, nạp qua `assets/ui/load_modals.js`.
- `assets/vendor/` — dependency self-host: `crypto-js`, `lucide`, `maplibre-gl(.js/.css)`, `supercluster`.
- `assets/fonts/` — Be Vietnam Pro + Inter (woff2, bộ latin + vietnamese).
- `assets/styles.css` + `assets/css/{fonts,tailwind.clientpro,app.patch,redesign.clientpro}.css`.
- `gas/AdminAPI.gs` — kích hoạt thiết bị, cấp KDATA, điều phối cloud transfer.
- `gas/UserDriveAPI.gs` — Drive cá nhân của user cho ảnh và backup.

## 4. Thứ tự thực thi module

Thứ tự script trong `index.html` là thứ tự thực thi chính thức:

```
ui/load_modals → 00_globals → 01_config → 02_security → 12_backup_core →
13_ui_select_customers → 15_auth_gate → 03_map → 04_ui_common → 19_error_loading →
05_customers → 06_assets → 08_images_camera → 09_menu → 09_backup_manager →
09_donate → 09_weather → 07_drive → 14_cloud_transfer → 16_auto_backup_drive →
17_onboarding_tour → 18_biometric_unlock → 10_bootstrap → 11_edge_back_swipe → pwa.js
```

## 5. Kiến trúc & luồng chính

### Mã hóa field (`02_security.js`)
- Field khách hàng mã hóa: `name`, `phone`, `cccd`, `notes`, `creditLimit`, `driveLink`.
- Field tài sản mã hóa: `name`, `link`, `valuation`, `loanValue`, `area`, `width`,
  `onland`, `year`, `driveLink`.
- Ghi field mã hóa: **luôn** `_looksEncrypted(out)` trước khi vào transaction.
- Cần plaintext chắc chắn: `await decryptFieldAsync(value)`.
- Render: `_displayPlain` / `_displayPlainAsync`; ciphertext phải hiển thị
  placeholder, **không bao giờ** lộ ra UI. Không hard-code prefix mã hóa.

### Unlock / lock
- Unlock hợp lệ đi qua `validatePin` → `_installMasterKey` → `completeUnlockDataLoad`
  (chạy migration, prime cache, flush KDATA pending, tải dữ liệu, phát
  `clientpro:unlocked`).
- `lockApp` phải xóa master key, `CryptoKey`, KDATA trong RAM, pending secret và
  plaintext cache **trước khi** hiện màn khóa. Tác vụ async phải tính đến auto-lock
  chen giữa hai lần `await`.

### Backup / restore (`12_backup_core.js`, `09_backup_manager.js`, `14_cloud_transfer.js`, `16_auto_backup_drive.js`)
- Backup chỉ chạy khi app đã unlock và có KDATA hợp lệ.
- Export: decrypt async, **dừng** nếu còn ciphertext.
- Restore: encrypt lại bằng khóa thiết bị đích, **dừng** nếu encrypt thất bại.
- Mọi entry point restore đi qua **mutex toàn cục**. Inbox restore phải idempotent
  và chỉ xóa remote sau khi restore thành công.
- `localStorage` chỉ giữ cấu hình, envelope, marker và cache đã niêm phong —
  không bao giờ plaintext master key hay KDATA.

### Async & IndexedDB
- Snapshot ID/state trước chuỗi `await`.
- Không `await` WebCrypto hay I/O **ở giữa** một transaction.
- Xác nhận commit bằng `tx.oncomplete`, không phải `request.onsuccess`. Transaction
  ghi phải xử lý `oncomplete`, `onerror`, `onabort`; UI thành công chỉ chạy sau commit.
- Dùng sequence token cho kết quả về muộn (đóng modal tăng token); single-flight
  flag luôn nhả trong `finally`; dùng settled guard khi `onerror`/`onabort` có thể
  cùng xảy ra.

### Layering (z-index)
| Lớp | z-index |
|---|---:|
| Nội dung | 0–50 |
| Menu / map / gallery / camera | 50–100 |
| Modal nghiệp vụ | 200 |
| Global loader | 250 |
| Lock / activation | 300–350 |
| Toast | 400–500 |
| Confirm | 600 |
| Onboarding | 1000 |

Không sửa z-index toàn cục cho một flow cục bộ. Edge swipe chỉ claim sau khi xác
định đúng hướng kéo.

## 6. Quy tắc bắt buộc

1. Không làm mất, làm trắng, double-encrypt hoặc hiển thị ciphertext của dữ liệu người dùng.
2. Không ghi fallback rỗng vào database khi giải mã thất bại.
3. Không bỏ qua activation, PIN/biometric gate, masterKey hoặc kiểm tra backup/restore.
4. Không thêm CDN, inline event handler hoặc nới CSP.
5. Đưa dữ liệu động vào DOM bằng `textContent`, DOM API và URL guard.
6. Không `await` WebCrypto hay I/O ở giữa một IndexedDB transaction.
7. Transaction ghi phải xử lý `oncomplete`, `onerror`, `onabort`; UI thành công chỉ chạy sau commit.
8. Xóa/restore phải có in-flight guard và không dùng `location.reload()` để che lỗi.
9. Không persist plaintext master key hoặc KDATA.
10. Dùng `ErrorHandler`, `LoadingManager` và `ModalA11y` (`19_error_loading.js`).
11. Sau khi đổi version, chạy `npm run sync:version` và `npm run check:version`.

## 7. PWA & cache

- `package.json` là nguồn semver duy nhất.
- `scripts/sync-version.mjs` đồng bộ manifest, service worker, đăng ký PWA và README.
- `ASSET_V` phải khớp mọi `?v=` trong `index.html` (và `MAPLIBRE_V`).
- Service Worker precache app shell + dependency self-host; `install` không kích hoạt
  cưỡng bức; `activate` chỉ giữ allowlist cache hiện tại.

## 8. Kiểm tra bắt buộc

```
npm test
npm run check:version
node --check sw.js
find assets -name '*.js' -print0 | xargs -0 -n1 node --check
npm run test:e2e
```

Trước release: xác nhận version và `ASSET_V` đồng bộ, JSON hợp lệ, test pass, không
có secret trong diff, cache name duy nhất và tài liệu mô tả đúng code hiện tại.

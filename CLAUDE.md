# CLAUDE.md — ClientPro engineering guide

Đọc file này trước khi sửa code. Mã nguồn và index.html là nguồn xác thực cuối cùng. Dùng file và symbol thay cho số dòng.

## Tổng quan

ClientPro 2.0.0 là PWA mobile-first quản lý khách hàng và tài sản bảo đảm, tối ưu cho Android Chrome và standalone.

- Nguồn phiên bản: package.json
- Cache-buster: ASSET_V trong sw.js
- Cache epoch: CACHE_EPOCH trong sw.js
- Database: IndexedDB QLKH_Pro_V4, schema version 5
- Runtime: vanilla JavaScript, HTML, CSS; dependency và font self-host
- Deploy: static hosting; Vercel headers/CSP trong vercel.json

## Quy tắc bắt buộc

1. Không làm mất, làm trắng, double-encrypt hoặc hiển thị ciphertext của dữ liệu người dùng.
2. Không ghi fallback rỗng vào database khi giải mã thất bại.
3. Không bỏ qua activation, PIN/biometric gate, masterKey hoặc kiểm tra backup/restore.
4. Không thêm CDN, inline event handler hoặc nới CSP.
5. Dữ liệu động vào DOM bằng textContent, DOM API và URL guard.
6. Không await WebCrypto hay I/O ở giữa IndexedDB transaction.
7. Transaction ghi phải xử lý oncomplete, onerror và onabort; UI thành công chỉ chạy sau commit.
8. Xóa/restore phải có in-flight guard và không dùng location.reload() để che lỗi.
9. Không persist plaintext master key hoặc KDATA.
10. Dùng ErrorHandler, LoadingManager và ModalA11y.
11. Sau khi đổi version, chạy npm run sync:version và npm run check:version.

## Thứ tự module

ui/load_modals → 00_globals → 01_config → 02_security → 12_backup_core → 13_ui_select_customers → 15_auth_gate → 03_map → 04_ui_common → 19_error_loading → 05_customers → 06_assets → 08_images_camera → 09_menu → 09_backup_manager → 09_donate → 09_weather → 07_drive → 14_cloud_transfer → 16_auto_backup_drive → 17_onboarding_tour → 18_biometric_unlock → 10_bootstrap → 11_edge_back_swipe → pwa.js

Thứ tự script trong index.html là thứ tự thực thi chính thức.

## Storage

- customers: khách hàng, notes và mảng assets.
- images: ảnh theo customerId, có thể gắn assetId.
- backups: backup mã hóa và metadata.
- localStorage chỉ giữ cấu hình, envelope, marker và cache đã niêm phong.

## Mã hóa

- Customer: name, phone, cccd, notes, creditLimit, driveLink.
- Asset: name, link, valuation, loanValue, area, width, onland, year, driveLink.
- Mọi luồng ghi field mã hóa phải kiểm _looksEncrypted(out) trước transaction.
- Dữ liệu cần plaintext chắc chắn dùng await decryptFieldAsync(value).
- Render dùng _displayPlain hoặc _displayPlainAsync; ciphertext phải hiển thị placeholder.
- Không hard-code prefix mã hóa.

## Unlock và lock

Unlock hợp lệ đi qua validatePin, _installMasterKey và completeUnlockDataLoad. Pipeline chạy migration, prime cache, flush KDATA pending, tải dữ liệu và phát clientpro:unlocked.

lockApp phải xóa master key, CryptoKey, KDATA RAM, pending secret và plaintext cache trước khi hiện màn khóa. Tác vụ async phải tính đến auto-lock giữa hai lần await.

## Backup và restore

- assets/12_backup_core.js chịu trách nhiệm normalize, export và restore.
- Backup chỉ chạy khi app đã unlock và có KDATA hợp lệ.
- Export phải decrypt async và dừng nếu còn ciphertext.
- Restore phải encrypt lại bằng khóa thiết bị đích và dừng nếu encrypt thất bại.
- Mọi entry point restore đi qua mutex toàn cục.
- Inbox restore phải idempotent và chỉ xóa remote sau restore thành công.

## Async và IndexedDB

- Snapshot ID/state trước chuỗi await.
- Dùng sequence token cho kết quả có thể về muộn; đóng modal phải tăng token.
- Single-flight flag luôn nhả trong finally.
- Dùng tx.oncomplete thay request.onsuccess để xác nhận commit.
- Dùng settled guard khi onerror và onabort có thể cùng xảy ra.

## Layering

| Lớp | z-index |
|---|---:|
| Nội dung | 0–50 |
| Menu/map/gallery/camera | 50–100 |
| Modal nghiệp vụ | 200 |
| Global loader | 250 |
| Lock/activation | 300–350 |
| Toast | 400–500 |
| Confirm | 600 |
| Onboarding | 1000 |

Không sửa z-index toàn cục cho một flow cục bộ. Edge swipe chỉ claim sau khi xác định đúng hướng kéo.

## PWA và cache

- package.json là nguồn semver.
- scripts/sync-version.mjs đồng bộ manifest, service worker, PWA registration và README.
- ASSET_V phải khớp mọi ?v= trong index.html và MAPLIBRE_V.
- Service Worker precache app shell và dependency self-host.
- Install không kích hoạt cưỡng bức; activate chỉ giữ allowlist cache hiện tại.

## Kiểm tra bắt buộc

    npm test
    npm run check:version
    node --check sw.js
    find assets -name '*.js' -print0 | xargs -0 -n1 node --check
    npm run test:e2e

Trước release, xác nhận version và ASSET_V đồng bộ, JSON hợp lệ, test pass, không có secret trong diff, cache name duy nhất và tài liệu mô tả đúng code hiện tại.

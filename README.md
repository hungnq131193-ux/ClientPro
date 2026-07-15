# ClientPro

[![CI](https://github.com/hungnq131193-ux/ClientPro/actions/workflows/ci.yml/badge.svg)](https://github.com/hungnq131193-ux/ClientPro/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-1.0.3-blue.svg)](manifest.json)
[![PWA](https://img.shields.io/badge/PWA-ready-5A0FC8.svg)](manifest.json)

**Demo:** https://client-pro-beryl.vercel.app

**ClientPro Genesis** là PWA mobile-first quản lý **khách hàng** và **tài sản bảo đảm** trên điện thoại. Ứng dụng hoạt động offline, lưu toàn bộ dữ liệu nghiệp vụ **cục bộ trên thiết bị**, và chỉ kết nối Google Drive / Google Apps Script cho các tác vụ do người dùng chủ động thực hiện (backup, chuyển dữ liệu).

Ứng dụng viết bằng vanilla JavaScript, **zero-dependency lúc runtime, không build step** — mở thẳng bằng static server là chạy.

## Tính năng

- Quản lý khách hàng: trạng thái hồ sơ, ghi chú, hạn mức tín dụng.
- Quản lý tài sản bảo đảm: định giá, mức vay, diện tích, hiện trạng, tọa độ.
- Ảnh: chụp, lưu, xem, chọn, chia sẻ và tải lên Google Drive.
- Bản đồ MapLibre GL: gom cụm điểm (Supercluster) và khoảng cách đường bộ (OSRM).
- Backup Manager, file backup mã hóa, backup lên Drive và Cloud Transfer giữa các user.
- PWA standalone: app shell offline, khóa PIN, sinh trắc học (Face ID / vân tay) và tự khóa.

## Bảo mật và dữ liệu

- Dữ liệu nghiệp vụ lưu trong IndexedDB (`QLKH_Pro_V4`) trên thiết bị.
- Field nhạy cảm và ảnh mã hóa **AES-256-GCM** qua WebCrypto.
- Master key được niêm phong bằng PIN với **PBKDF2-SHA256**, chỉ tồn tại trong RAM khi mở khóa.
- KDATA phục vụ backup chỉ lưu ở dạng niêm phong; không persist plaintext key.
- Thư viện và font đều **self-host**; CSP giới hạn script về cùng nguồn (`vercel.json`).
- Xóa dữ liệu trang web sẽ xóa IndexedDB — hãy duy trì backup định kỳ.

## Công nghệ

| Phần | Công nghệ |
|---|---|
| Frontend | Vanilla JavaScript, HTML5, CSS3 |
| Storage | IndexedDB, localStorage |
| Encryption | WebCrypto AES-256-GCM, PBKDF2-SHA256 |
| Biometrics | WebAuthn PRF |
| Map | MapLibre GL, Supercluster, OSRM |
| PWA | Service Worker, Web App Manifest |
| Cloud | Google Drive, Google Apps Script |
| Hosting | Vercel static |
| Tests | Node test runner, Playwright, axe, Lighthouse CI |

## Cấu trúc thư mục

```
index.html                app shell + thứ tự load module (nguồn xác thực)
sw.js                     Service Worker: precache, ASSET_V, CACHE_EPOCH
manifest.json             Web App Manifest
assets/00…19_*.js, pwa.js module nghiệp vụ theo tầng phụ thuộc
assets/ui/modals/         14 HTML fragment của modal (nạp qua ui/load_modals.js)
assets/vendor/            dependency self-host (crypto-js, lucide, maplibre, supercluster)
assets/fonts/             font self-host (Be Vietnam Pro, Inter)
assets/styles.css, css/   CSS ứng dụng
scripts/sync-version.mjs  đồng bộ version & ASSET_V ra manifest/SW/README
gas/                      Admin GAS + User Drive GAS
tests/                    unit test (node --test)
e2e/                      Playwright + axe (a11y, offline, CRUD, edge-swipe…)
.github/workflows/ci.yml  CI: validate JSON, node --check, chạy test
CLAUDE.md                 sổ tay kỹ thuật & quy tắc an toàn
```

## Chạy local

    git clone https://github.com/hungnq131193-ux/ClientPro.git
    cd ClientPro
    python3 -m http.server 8080

Mở http://localhost:8080. Service Worker, WebCrypto và camera cần HTTPS hoặc localhost.

## Kiểm tra

    npm test
    npm run check:version
    node --check sw.js
    find assets -name '*.js' -print0 | xargs -0 -n1 node --check

E2E:

    npm install
    npm run test:e2e

## Deploy

Repository là static site và có thể import trực tiếp vào Vercel, không cần build command. Header bảo mật và CSP nằm trong `vercel.json`.

## Google Apps Script và Drive

- `gas/AdminAPI.gs`: kích hoạt thiết bị, cấp KDATA và điều phối chuyển dữ liệu.
- `gas/UserDriveAPI.gs`: kết nối Drive cá nhân để lưu ảnh và backup.
- Không commit token hoặc secret vào repository.

## Quản lý phiên bản

- **Tên phát hành** — **Genesis**. Đây là tên phát hành công khai của ClientPro.
- **Phiên bản app (semver)** — hiện tại **`1.0.3`**. Số kỹ thuật nội bộ giữ cho tooling đồng bộ và tương thích, không hiển thị cho người dùng. Nguồn duy nhất: `package.json`.
- **cache-buster asset** — hiện tại **`UXLIST_20260715`**. Nguồn: `ASSET_V` trong `sw.js`.

Sau khi thay đổi phiên bản, đồng bộ ra mọi nơi (manifest, SW, PWA, README):

    npm run sync:version
    npm run check:version

## Cài PWA trên Android

1. Mở demo bằng Chrome.
2. Chọn **Thêm vào Màn hình chính** hoặc **Cài đặt ứng dụng**.
3. Mở ClientPro từ icon trên màn hình chính.

## Ủng hộ

Trong app, mở **Menu → Ủng hộ** để quét mã QR.

## License

Proprietary — All Rights Reserved. Xem `LICENSE`.

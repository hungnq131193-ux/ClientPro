# ClientPro

[![CI](https://github.com/hungnq131193-ux/ClientPro/actions/workflows/ci.yml/badge.svg)](https://github.com/hungnq131193-ux/ClientPro/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](manifest.json)
[![PWA](https://img.shields.io/badge/PWA-ready-5A0FC8.svg)](manifest.json)

**Demo:** https://client-pro-beryl.vercel.app

ClientPro là PWA mobile-first quản lý khách hàng và tài sản bảo đảm trên điện thoại. Ứng dụng hoạt động offline, lưu dữ liệu nghiệp vụ trên thiết bị và kết nối Google Drive/Google Apps Script cho các tác vụ do người dùng chủ động thực hiện.

## Tính năng

- Quản lý khách hàng, trạng thái hồ sơ, ghi chú và hạn mức tín dụng.
- Quản lý tài sản bảo đảm, định giá, mức vay, hiện trạng và tọa độ.
- Chụp, lưu, xem, chọn, chia sẻ và tải ảnh lên Google Drive.
- Bản đồ MapLibre GL, gom cụm điểm và khoảng cách đường bộ qua OSRM.
- Backup Manager, file backup mã hóa .cpb, Drive backup và Cloud Transfer.
- PWA standalone, app shell offline, PIN, sinh trắc học và tự khóa.

## Bảo mật và dữ liệu

- Dữ liệu nghiệp vụ lưu trong IndexedDB trên thiết bị.
- Field nhạy cảm và ảnh dùng AES-256-GCM qua WebCrypto.
- Master key được niêm phong bằng PIN với PBKDF2-SHA256 và chỉ tồn tại trong RAM khi mở khóa.
- KDATA cho backup chỉ lưu ở dạng niêm phong.
- Thư viện và font được self-host; CSP giới hạn script về cùng nguồn.
- Xóa dữ liệu trang web sẽ xóa IndexedDB; hãy duy trì backup định kỳ.

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

## Cấu trúc

- index.html: app shell và thứ tự load module.
- assets/00…19_*.js: module nghiệp vụ theo tầng phụ thuộc.
- assets/ui/modals/: HTML fragment của modal.
- assets/vendor/ và assets/fonts/: dependency self-host.
- gas/: Admin GAS và User Drive GAS.
- tests/ và e2e/: kiểm tra tự động.
- CLAUDE.md: hướng dẫn kỹ thuật và quy tắc an toàn.

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

Repository là static site và có thể import trực tiếp vào Vercel, không cần build command. Header bảo mật và CSP nằm trong vercel.json.

## Google Apps Script và Drive

- gas/AdminAPI.gs: kích hoạt thiết bị, cấp KDATA và điều phối chuyển dữ liệu.
- gas/UserDriveAPI.gs: kết nối Drive cá nhân để lưu ảnh và backup.
- Không commit token hoặc secret vào repository.

## Quản lý phiên bản

- **Phiên bản app (semver)** — hiện tại **`2.0.0`**. Nguồn duy nhất: package.json.
- **cache-buster asset** — hiện tại **`V200_20260712`**. Nguồn: ASSET_V trong sw.js.

Sau khi thay đổi phiên bản:

    npm run sync:version
    npm run check:version

## Cài PWA trên Android

1. Mở demo bằng Chrome.
2. Chọn Thêm vào Màn hình chính hoặc Cài đặt ứng dụng.
3. Mở ClientPro từ icon trên màn hình chính.

## Ủng hộ

Trong app, mở Menu → Ủng hộ để quét mã QR.

## License

Proprietary — All Rights Reserved. Xem LICENSE.

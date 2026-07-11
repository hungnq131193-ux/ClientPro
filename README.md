# ClientPro

[![CI](https://github.com/hungnq131193-ux/ClientPro/actions/workflows/ci.yml/badge.svg)](https://github.com/hungnq131193-ux/ClientPro/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-1.6.3-blue.svg)](manifest.json)
[![PWA](https://img.shields.io/badge/PWA-ready-5A0FC8.svg)](manifest.json)
[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red.svg)](LICENSE)

**Demo:** https://client-pro-beryl.vercel.app

ClientPro là PWA mobile-first để quản lý khách hàng và tài sản bảo đảm. Ứng dụng dùng vanilla JavaScript, lưu dữ liệu mã hóa trên thiết bị, hoạt động offline và hỗ trợ backup mã hóa qua Google Drive/Google Apps Script.

## Tính năng chính

- Quản lý khách hàng, tài sản bảo đảm, ghi chú và ảnh.
- AES-256-GCM cho dữ liệu cục bộ; mở khóa bằng PIN hoặc WebAuthn PRF.
- Backup/restore `.cpb`, backup Drive và chuyển backup giữa user.
- MapLibre + OSRM để hiển thị bản đồ và khoảng cách đường bộ.
- PWA cài được, offline-first, camera, gallery và thao tác mobile.
- CSP chặt, thư viện/font self-host, không dùng CDN runtime.

## Tech stack

| Phần | Công nghệ |
|---|---|
| Frontend | Vanilla JavaScript ES6+, HTML5, CSS3 |
| Storage | IndexedDB + localStorage |
| Encryption | WebCrypto AES-256-GCM, PBKDF2-SHA256; CryptoJS chỉ cho legacy |
| Biometrics | WebAuthn PRF |
| Map | MapLibre GL + supercluster + OSRM |
| PWA | Service Worker + Web App Manifest |
| Cloud | Google Drive + Google Apps Script |
| Hosting | Vercel static |
| Tests | Node test runner, Playwright, axe, Lighthouse CI |

## Cấu trúc

```text
index.html                  App shell và thứ tự load module
assets/00…19_*.js           Module vanilla JS đánh số theo tầng phụ thuộc
assets/ui/modals/           HTML fragment của modal
assets/vendor/, fonts/      Dependency self-host
assets/12_backup_core.js    Chuẩn hóa export/restore
assets/09_backup_manager.js Backup Manager và restore `.cpb`
sw.js, assets/pwa.js        Offline cache và cập nhật PWA
gas/                        Admin GAS và User Drive GAS
tests/, e2e/                Test unit/integration và trình duyệt
CLAUDE.md                   Kiến trúc, quy tắc security và pattern async
```

Thứ tự thực thi nằm trong `index.html`; số file chỉ mô tả tầng phụ thuộc. Xem [`CLAUDE.md`](CLAUDE.md) trước khi sửa code liên quan encryption, backup/restore hoặc async state.

## Quick start

Không cần build hoặc cài dependency để chạy app:

```bash
git clone https://github.com/hungnq131193-ux/ClientPro.git
cd ClientPro
python3 -m http.server 8080
```

Mở `http://localhost:8080`. Service Worker, WebCrypto và camera cần HTTPS hoặc localhost trong môi trường hỗ trợ.

## Kiểm tra

Unit/integration test dùng Node built-in runner và không cần `npm install`:

```bash
npm test
npm run check:version
node --check sw.js
find assets -name '*.js' -print0 | xargs -0 -n1 node --check
```

E2E cần cài dev dependencies:

```bash
npm install
npm run test:e2e
```

GitHub Actions chạy static checks, crypto/data-integrity tests, Playwright, axe và Lighthouse.

## Phiên bản

- **Phiên bản app (semver)** — hiện tại **`1.6.3`**. Nguồn duy nhất: `package.json`.
- **cache-buster asset** — hiện tại **`V160_20260710`**. Nguồn: `ASSET_V` trong `sw.js`.

Sau khi đổi semver:

```bash
npm run sync:version
npm run check:version
```

## Bản sửa v1.6.2

Khi restore backup Google Drive từ Trung tâm Backup, modal được đóng ngay trước khi hiện global loader. Loader không còn bị modal che; không thay đổi z-index, `LoadingManager` hoặc logic restore khác.

## License

Proprietary — All Rights Reserved. Xem [`LICENSE`](LICENSE).

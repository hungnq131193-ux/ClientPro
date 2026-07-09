# ClientPro

[![CI](https://github.com/hungnq131193-ux/ClientPro/actions/workflows/ci.yml/badge.svg)](https://github.com/hungnq131193-ux/ClientPro/actions/workflows/ci.yml)
[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-ready-5A0FC8.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-1.5.8-blue.svg)](manifest.json)

> **Live demo:** https://client-pro-beryl.vercel.app

**ClientPro** là PWA tĩnh thuần (vanilla JavaScript ES6+, không framework, không build step) quản lý **khách hàng** và **tài sản bảo đảm**, tối ưu cho di động. Không có backend — toàn bộ dữ liệu lưu cục bộ trên thiết bị và **mã hóa AES-256-GCM**, mở khóa bằng PIN hoặc Face ID/vân tay (WebAuthn PRF), hoạt động offline hoàn toàn nhờ Service Worker.

## Dành cho AI Assistant

**Đọc toàn bộ [`CLAUDE.md`](CLAUDE.md) trước khi phân tích/sửa code.** Đó là single source of truth về kiến trúc, mô hình dữ liệu, quy ước code, quy tắc mã hóa và quy trình versioning — đủ chi tiết để làm hầu hết task mà không cần đọc từng file `.js`. README này chỉ là tổng quan cho người dùng.

## Tính năng

- 👥 **Khách hàng & tài sản bảo đảm** — CRUD, tìm kiếm không dấu (tên/CCCD/SĐT), lọc, ảnh, ghi chú, chọn nhiều & thao tác hàng loạt, luồng phê duyệt, tham khảo giá tài sản.
- 🔒 **Bảo mật cục bộ** — kích hoạt thiết bị, PIN + câu hỏi bảo mật, sinh trắc học WebAuthn; mã hóa dữ liệu AES-256-GCM (WebCrypto) ngay trên thiết bị; UI không bao giờ hiện chuỗi mã hóa (`cpg1:` / legacy) ra màn hình.
- ☁️ **Sao lưu & chuyển dữ liệu** — backup mã hóa `.cpb` (tự động/thủ công) lên Google Drive **cá nhân**; Cloud Transfer gửi/nhận dữ liệu giữa các thiết bị qua Google Apps Script (khóa cấp riêng từng user).
- 🗺️ **Bản đồ & khoảng cách đường thực tế** — MapLibre GL self-host + OSRM, có validation snap + cache + fallback cho kết quả chính xác mà hoàn toàn miễn phí; marker clustering.
- 📱 **PWA & mobile-first** — cài lên màn hình chính, offline, camera trong app, lightbox, edge back-swipe, chuyển màn hình mượt.
- 🎨 **4 giao diện** — Sáng (mặc định) + 3 nền tối: Xanh Đêm, Đại Dương, Thiên Thanh (chung `redesign.clientpro.css`, khác `--accent-gradient`).
- 🌤️ **Tiện ích** — thời tiết Open-Meteo, onboarding tour, ủng hộ tác giả qua VietQR.

## Công nghệ

| Thành phần | Công nghệ |
|---|---|
| Frontend | Vanilla JS (ES6+), HTML, CSS — Tailwind static build + lớp redesign |
| Mã hóa | WebCrypto AES-256-GCM + PBKDF2; CryptoJS (self-host) chỉ đọc dữ liệu cũ |
| Bản đồ | MapLibre GL JS + supercluster (self-host) + OSRM public router |
| Icon / Font | Lucide (self-host) / Inter + Be Vietnam Pro (woff2 self-host) |
| Sinh trắc học | WebAuthn PRF extension |
| Cloud | Google Drive + Google Apps Script (nguồn trong `gas/`) |
| Hosting | Vercel static (`vercel.json`: CSP + security headers) |

**100% self-hosted** — không CDN nào cho script/style/font (tất cả trong `assets/vendor/`, `assets/fonts/`); CI chặn nếu vi phạm.

## Cấu trúc thư mục

```text
.
├── index.html                # App shell (SPA + load order module đánh số)
├── manifest.json / sw.js     # PWA + Service Worker (precache, offline)
├── vercel.json               # CSP + security headers
├── CLAUDE.md                 # Tài liệu kiến trúc toàn diện (đọc trước khi code)
├── assets/
│   ├── 00…19_*.js            # Module JS đánh số theo thứ tự load
│   ├── pwa.js / css/ / vendor/ / fonts/
│   └── ui/                   # load_modals.js + modals/ (HTML fragments)
├── gas/                      # Google Apps Script (deploy thủ công, ngoài build/CI)
├── tests/                    # Test zero-dependency (node --test)
├── e2e/                      # Playwright E2E (devDeps CI-only)
└── scripts/sync-version.mjs  # Đồng bộ phiên bản 1 nguồn
```

## Chạy cục bộ

Không cần cài dependency hay build. Service Worker yêu cầu origin HTTP/HTTPS:

```bash
python3 -m http.server 8000   # hoặc: npx serve .
```

Mở `http://localhost:8000/`.

## Quản lý phiên bản

Hai định danh độc lập, mỗi loại một nguồn duy nhất:

**1. Phiên bản app (semver)** — hiện tại **`1.5.8`**. Nguồn: `package.json` → `version`. Sửa ở đó rồi chạy:

```bash
npm run sync:version      # ghi semver ra manifest.json, sw.js, pwa.js, README
npm run check:version     # chỉ kiểm tra (CI dùng, lệch => fail)
```

**2. Tag cache-buster asset** — hiện tại **`DISPLAYFIX_20260709`**. Nguồn: `ASSET_V` trong `sw.js`; phải đồng nhất với mọi query `?v=` trong `index.html` và `MAPLIBRE_V` trong `assets/03_map.js`. Đổi tay khi thay asset.

CI kiểm tra cả hai — không sửa tay các file đích của semver.

## Kiểm tra & CI

```bash
python3 -m json.tool manifest.json vercel.json
node --check sw.js
find assets -name '*.js' -print0 | xargs -0 -n1 node --check
node --test 'tests/**/*.test.js'   # test crypto & data integrity, zero-dep
```

GitHub Actions ([`ci.yml`](.github/workflows/ci.yml)) chạy 3 job trên mỗi push/PR: **static-checks** (JSON/JS hợp lệ, version sync 2 loại, chặn CDN ngoài), **tests** (`node --test`, không cần `npm install`), **e2e** (Playwright + axe a11y + Lighthouse — devDeps chỉ cài trên CI).

## Triển khai

Deploy static trên Vercel. `vercel.json` áp CSP nghiêm ngặt (`script-src 'self'`, whitelist `img-src`/`connect-src` cho GAS/OSRM/Open-Meteo/map tiles/VietQR), `Permissions-Policy` (chỉ camera + geolocation từ origin), HSTS, nosniff… Thêm API mới → cập nhật CSP; không thêm CDN ngoài.

## Giấy phép

**Độc quyền — All Rights Reserved** ([LICENSE](LICENSE)). Không sao chép, phân phối hoặc chỉnh sửa khi chưa có sự cho phép bằng văn bản của tác giả.

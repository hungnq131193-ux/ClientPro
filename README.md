# ClientPro

[![CI](https://github.com/hungnq131193-ux/ClientPro/actions/workflows/ci.yml/badge.svg)](https://github.com/hungnq131193-ux/ClientPro/actions/workflows/ci.yml)
[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-ready-5A0FC8.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-1.5.3-blue.svg)](manifest.json)

> **Live demo:** https://client-pro-beryl.vercel.app

## Dành cho AI Assistant (Claude, Grok…)

Trước khi phân tích, debug, đề xuất thay đổi hay implement tính năng cho ClientPro, **bạn BẮT BUỘC phải đọc toàn bộ file [`CLAUDE.md`](CLAUDE.md) ở root** — đó là "single source of truth" về kiến trúc, mô hình dữ liệu, quy ước code và triết lý dự án. File đó được viết đủ chi tiết để bạn làm được **hầu hết task mà không cần đọc từng file `.js`**.

Khi làm việc, hãy suy nghĩ theo các nguyên tắc cốt lõi và tuân thủ nghiêm ngặt:

- **Privacy-first & local-first** — toàn bộ dữ liệu lưu **cục bộ và mã hóa** trên thiết bị; không backend trung tâm, không telemetry.
- **Self-hosted 100%** — không thêm CDN. Thư viện mới phải tải về `assets/vendor/`, font về `assets/fonts/`.
- **CSP nghiêm ngặt** — `script-src 'self'`, không inline handler. Mọi tương tác dùng `data-action="..."` (khai báo trong bảng `CLICK_ACTIONS`/`CHANGE_ACTIONS` ở `00_globals.js`). Thêm API mới → cập nhật `connect-src`/`img-src` trong `vercel.json`.
- **Versioning discipline** — thay đổi asset/PWA phải bump version đồng bộ (xem [Quản lý phiên bản](#quản-lý-phiên-bản)); CI sẽ fail nếu lệch.
- **Cập nhật `CLAUDE.md`** sau mỗi thay đổi lớn (module mới, đổi architecture/security/API) để giữ tài liệu đồng bộ.

**ClientPro** là ứng dụng web/PWA quản lý **khách hàng** và **tài sản bảo đảm**, tối ưu cho trải nghiệm di động. Đây là ứng dụng tĩnh thuần (vanilla JavaScript ES6+, không build step), chạy trực tiếp từ `index.html`, có Service Worker hỗ trợ cài đặt như app và dùng ngoại tuyến.

## Tính năng

- 👥 **Quản lý khách hàng & tài sản** — danh sách, tìm kiếm, lọc theo trạng thái, ảnh đính kèm, ghi chú; chọn nhiều & thao tác hàng loạt; luồng phê duyệt (approval).
- 💰 **Tài sản bảo đảm** — gắn tài sản theo khách hàng, kèm loại, mô tả, **tham khảo giá** (valuation) và vị trí bản đồ.
- 📱 **PWA đầy đủ** — manifest, icon, Service Worker (precache + runtime cache, offline), cài đặt lên màn hình chính.
- 🔒 **Bảo mật cục bộ** — kích hoạt thiết bị, khóa PIN + câu hỏi bảo mật, mở khóa bằng Face ID / vân tay (WebAuthn PRF), mã hóa toàn bộ dữ liệu với CryptoJS.
- ☁️ **Sao lưu & chuyển dữ liệu** — sao lưu mã hóa `.cpb`, tự động backup lên Google Drive **cá nhân**; Cloud Transfer gửi/nhận dữ liệu giữa các thiết bị qua Google Apps Script (khóa mã hóa cấp riêng cho từng user).
- 🗺️ **Bản đồ & khoảng cách đường thực tế** — MapLibre GL hiển thị vị trí; tính khoảng cách đường đi qua OSRM với **validation snap + fallback** để cho kết quả chính xác cao mà vẫn miễn phí.
- 📷 **Camera & lightbox** — chụp ảnh trực tiếp trong app, xem ảnh phóng to, chia sẻ/xóa.
- 🎨 **4 giao diện** — 1 nền sáng + 3 nền tối sắc xanh (Sáng, Xanh Đêm, Đại Dương, Thiên Thanh).
- 🌤️ **Tiện ích** — thời tiết (Open-Meteo), tour hướng dẫn người dùng mới, ủng hộ tác giả qua VietQR.
- 👆 **Tối ưu mobile** — điều hướng bằng cử chỉ, edge back-swipe custom, chuyển màn hình mượt.

## Công nghệ

| Thành phần | Công nghệ |
|---|---|
| Frontend | Vanilla JavaScript (ES6+), HTML, CSS |
| CSS | Tailwind CSS (bản build tĩnh self-hosted) + lớp redesign |
| Bản đồ & Routing | [MapLibre GL JS](https://maplibre.org/) (self-host) + OSRM public router |
| Icon | [Lucide](https://lucide.dev/) (self-host trong `assets/vendor/`) |
| Mã hóa | [CryptoJS](https://cryptojs.gitbook.io/) (self-host trong `assets/vendor/`) |
| Font | Inter + Be Vietnam Pro (self-host trong `assets/fonts/`) |
| Sinh trắc học | WebAuthn (PRF extension) |
| Thời tiết | Open-Meteo (không cần API key) |
| Sao lưu / chuyển dữ liệu | Google Drive + Google Apps Script (nguồn trong `gas/`) |
| Hosting | Vercel (static, cấu hình trong `vercel.json`) |

## Cấu trúc thư mục

```text
.
├── index.html                   # App shell chính (SPA + load order module)
├── manifest.json                # Cấu hình PWA
├── sw.js                        # Service Worker (precache + runtime cache)
├── vercel.json                  # Header bảo mật (CSP, Permissions-Policy…)
├── CLAUDE.md                    # Tài liệu kiến trúc toàn diện (đọc trước khi code)
├── LICENSE                      # Giấy phép độc quyền (All Rights Reserved)
├── assets/
│   ├── 00_globals.js …          # Các module JS đánh số theo thứ tự load
│   ├── pwa.js                   # Đăng ký/cập nhật Service Worker
│   ├── css/                     # Tailwind build tĩnh + lớp redesign + fonts.css + CSS vá
│   ├── vendor/                  # Thư viện self-host (lucide, crypto-js, maplibre-gl)
│   ├── fonts/                   # Font woff2 self-host (Inter, Be Vietnam Pro)
│   └── ui/
│       ├── load_modals.js       # Loader nạp modal động
│       └── modals/              # Các modal HTML tách file
├── gas/                         # Nguồn Google Apps Script (deploy thủ công, không thuộc build tĩnh/CI)
│   ├── AdminAPI.gs              # Auth/licensing, cấp khóa mã hóa, Cloud Transfer P2P
│   └── UserDriveAPI.gs          # Upload ảnh + Backup/Restore lên Drive cá nhân từng user
└── .github/workflows/ci.yml     # CI kiểm tra tĩnh
```

## Giao diện

ClientPro có **4 giao diện** (1 nền sáng + 3 nền tối sắc xanh):

| Giao diện | Mô tả |
|---|---|
| Sáng | Nền sáng, thẻ trắng — giao diện mặc định |
| Xanh Đêm | Nền tối sắc xanh đậm |
| Đại Dương | Nền tối sắc lam biển sâu |
| Thiên Thanh | Nền tối sắc xanh trời tươi |

Ba giao diện tối dùng chung lớp thiết kế trong `assets/css/redesign.clientpro.css`,
chỉ khác gradient nhấn (`--accent-gradient`).

## Chạy cục bộ

Không cần cài đặt dependency hay build. Do Service Worker yêu cầu origin HTTP/HTTPS, hãy chạy qua một static server thay vì mở file trực tiếp:

```bash
# Dùng Python
python3 -m http.server 8000

# Hoặc dùng Node.js
npx serve .
```

Sau đó mở `http://localhost:8000/`.

## Quản lý phiên bản

Dự án dùng **hai loại định danh phiên bản độc lập** — cần phân biệt rõ khi bump:

**1. Phiên bản app (semver)** — hiện tại **`1.5.3`**. **Nguồn duy nhất (single source of truth) là `package.json` → `version`.** Sửa ở đó rồi chạy:

```bash
npm run sync:version      # ghi semver + ASSET_V ra mọi nơi khác
npm run check:version     # chỉ kiểm tra (CI dùng lệnh này, lệch => fail)
```

`scripts/sync-version.mjs` (zero-dependency) tự đồng bộ semver tới **3 nơi** — `version` trong `manifest.json`, `VERSION` (`v<sem>`) trong `sw.js`, `SW_BUILD` (`v<sem>`) trong `assets/pwa.js` — **và** cả badge + phần này trong `README.md`. Không sửa tay từng file nữa.

**2. Tag cache-buster asset (chuỗi tự do)** — hiện tại **`SECGCM_20260708`**, thường đặt theo mốc ngày/đợt redesign. Nguồn là `ASSET_V` trong `sw.js`; phải **đồng nhất** tại:

- `ASSET_V` trong `sw.js` (nguồn — `sync:version` đọc từ đây và cập nhật README).
- **Mọi** query `?v=` của asset trong `index.html` (CSS, JS, vendor) — tất cả phải là một giá trị duy nhất và bằng `ASSET_V`.
- `MAPLIBRE_V` trong `assets/03_map.js` (MapLibre được lazy-load với cache-buster riêng).

> Khi thay đổi asset được cache hoặc logic PWA, bump loại phù hợp để người dùng nhận bản mới. CI kiểm tra **cả hai loại** (xem mục [CI](#ci)): bước `sync-version.mjs --check` bắt lệch semver/README, bước version-sync bắt lệch `?v=`/`MAPLIBRE_V`.

## Kiểm tra tĩnh trước khi commit

```bash
python3 -m json.tool manifest.json > /dev/null
python3 -m json.tool vercel.json  > /dev/null
node --check sw.js
find assets -name '*.js' -print0 | xargs -0 -n1 node --check
```

## CI

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) chạy trên mỗi push vào `main` và mỗi pull request, gồm các bước:

- ✅ Kiểm tra `manifest.json` và `vercel.json` là JSON hợp lệ.
- ✅ Kiểm tra cú pháp toàn bộ file JavaScript (`sw.js` và `assets/**/*.js`).
- ✅ Đảm bảo scaffold debug của `assets/11_edge_back_swipe.js` không xuất hiện trở lại.
- ✅ Kiểm tra **phiên bản semver đồng bộ** giữa `manifest.json`, `sw.js` (`VERSION`) và `assets/pwa.js` (`SW_BUILD`).
- ✅ Kiểm tra **tag cache-buster đồng bộ**: `ASSET_V` (trong `sw.js`) = mọi query `?v=` trong `index.html` = `MAPLIBRE_V` (trong `assets/03_map.js`).
- ✅ Chặn mọi tham chiếu **CDN ngoài** (unpkg, jsdelivr, cdnjs, Google Fonts) — app phải self-host toàn bộ script/style/font.

## Triển khai

App được deploy dạng static trên Vercel. File `vercel.json` cấu hình các header bảo mật cho mọi response:

- `Content-Security-Policy` — `script-src`/`style-src`/`font-src` chỉ cho phép `'self'`
  (toàn bộ thư viện và font đã self-host, không còn CDN ngoài); `img-src`/`connect-src`
  giới hạn về danh sách API tin cậy (GAS, tiles bản đồ, OSRM, Open-Meteo, VietQR…).
- `Permissions-Policy` — chỉ cho phép camera và geolocation từ chính origin.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.

Khi thêm API mới, cần cập nhật CSP trong `vercel.json` tương ứng. KHÔNG thêm CDN
script/style/font ngoài — tải thư viện về `assets/vendor/` (xem `assets/vendor/README.md`);
CI sẽ chặn nếu phát hiện tham chiếu CDN.

## Giấy phép

Phần mềm được phát hành theo **giấy phép độc quyền — All Rights Reserved**. Xem chi
tiết trong [LICENSE](LICENSE). Không sao chép, phân phối hoặc chỉnh sửa khi chưa có
sự cho phép bằng văn bản của tác giả.
</content>
</invoke>

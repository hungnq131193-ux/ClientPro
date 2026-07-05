# ClientPro

[![CI](https://github.com/hungnq131193-ux/ClientPro/actions/workflows/ci.yml/badge.svg)](https://github.com/hungnq131193-ux/ClientPro/actions/workflows/ci.yml)
[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-ready-5A0FC8.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)](manifest.json)

**ClientPro** là ứng dụng web/PWA quản lý khách hàng và tài sản bảo đảm, tối ưu cho trải nghiệm di động. Đây là ứng dụng tĩnh thuần (vanilla JavaScript, không cần build step), chạy trực tiếp từ `index.html`, có Service Worker hỗ trợ cài đặt như app và sử dụng ngoại tuyến. Toàn bộ dữ liệu được **lưu cục bộ và mã hóa trên thiết bị**.

## Tính năng

- 👥 **Quản lý khách hàng & tài sản** — danh sách, tìm kiếm, phân loại trạng thái, hình ảnh đính kèm, ghi chú.
- 📱 **PWA đầy đủ** — manifest, icon, Service Worker (precache + runtime cache, offline), cài đặt lên màn hình chính.
- 🔒 **Bảo mật cục bộ** — kích hoạt thiết bị, khóa PIN, mở khóa bằng Face ID / vân tay (WebAuthn PRF), mã hóa dữ liệu với CryptoJS.
- ☁️ **Sao lưu & khôi phục** — sao lưu mã hóa (`.cpb`) trong máy, tự động sao lưu lên Google Drive cá nhân, chuyển dữ liệu giữa các thiết bị qua cloud.
- 🗺️ **Bản đồ** — hiển thị vị trí khách hàng/tài sản bằng MapLibre GL, tính khoảng cách đường đi qua OSRM.
- 📷 **Camera & lightbox** — chụp ảnh trực tiếp trong app, xem ảnh phóng to.
- 🎨 **4 giao diện** — 1 nền sáng + 3 nền tối sắc xanh (Sáng, Xanh Đêm, Đại Dương, Thiên Thanh).
- 🌤️ **Tiện ích** — thời tiết (Open-Meteo), tour hướng dẫn người dùng mới, ủng hộ tác giả qua VietQR.
- 👆 **Tối ưu mobile** — điều hướng bằng cử chỉ, xử lý edge back-swipe, chuyển màn hình mượt.

## Công nghệ

| Thành phần | Công nghệ |
|---|---|
| Frontend | Vanilla JavaScript (ES6+), HTML, CSS |
| CSS | Tailwind CSS (bản build tĩnh self-hosted) + lớp redesign |
| Bản đồ | [MapLibre GL JS](https://maplibre.org/) |
| Icon | [Lucide](https://lucide.dev/) |
| Mã hóa | [CryptoJS](https://cryptojs.gitbook.io/) |
| Sinh trắc học | WebAuthn (PRF extension) |
| Sao lưu cloud | Google Drive + Google Apps Script |
| Hosting | Vercel (static, cấu hình trong `vercel.json`) |

## Cấu trúc thư mục

```text
.
├── index.html                   # App shell chính
├── manifest.json                # Cấu hình PWA
├── sw.js                        # Service Worker (precache + runtime cache)
├── vercel.json                  # Header bảo mật (CSP, Permissions-Policy…)
├── LICENSE                      # Giấy phép độc quyền (All Rights Reserved)
├── assets/
│   ├── 00_globals.js …          # Các module JS đánh số theo thứ tự load
│   ├── pwa.js                   # Đăng ký/cập nhật Service Worker
│   ├── head.js                  # Script chạy sớm trong <head>
│   ├── styles.css               # CSS chính (gồm 4 theme giao diện)
│   ├── css/                     # Tailwind build tĩnh + lớp redesign + CSS vá
│   └── ui/
│       ├── load_modals.js       # Loader nạp modal động
│       └── modals/              # Các modal HTML tách file
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

Phiên bản hiện tại: **1.1.0**. Khi thay đổi asset được cache hoặc logic PWA, **bump version đồng bộ ở tất cả các nơi** để người dùng nhận bản mới. Chuỗi phiên bản phải khớp nhau tại:

- `version` trong `manifest.json` — ví dụ `1.1.0`.
- `VERSION` trong `sw.js` — ví dụ `v1.1.0`.
- `ASSET_V` trong `sw.js` — ví dụ `1.1.0` (phải **trùng khít** query `?v=` trong `index.html`).
- `SW_BUILD` trong `assets/pwa.js` — ví dụ `v1.1.0`.
- Query cache-buster `?v=1.1.0` cho mọi asset trong `index.html`.

> CI sẽ tự động kiểm tra tính đồng bộ này (xem mục [CI](#ci)).

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
- ✅ Kiểm tra **phiên bản đồng bộ** giữa `manifest.json`, `sw.js` (`VERSION`, `ASSET_V`),
  `assets/pwa.js` (`SW_BUILD`) và query `?v=` trong `index.html`.

## Triển khai

App được deploy dạng static trên Vercel. File `vercel.json` cấu hình các header bảo mật cho mọi response:

- `Content-Security-Policy` — giới hạn nguồn script/style/ảnh/kết nối về danh sách CDN và API tin cậy.
- `Permissions-Policy` — chỉ cho phép camera và geolocation từ chính origin.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.

Khi thêm CDN hoặc API mới, cần cập nhật CSP trong `vercel.json` tương ứng.

## Giấy phép

Phần mềm được phát hành theo **giấy phép độc quyền — All Rights Reserved**. Xem chi
tiết trong [LICENSE](LICENSE). Không sao chép, phân phối hoặc chỉnh sửa khi chưa có
sự cho phép bằng văn bản của tác giả.

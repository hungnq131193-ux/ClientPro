# ClientPro

[![CI](https://github.com/hungnq131193-ux/ClientPro/actions/workflows/ci.yml/badge.svg)](https://github.com/hungnq131193-ux/ClientPro/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-ready-5A0FC8.svg)](manifest.json)

**ClientPro** là ứng dụng web/PWA quản lý khách hàng và tài sản, tối ưu cho trải nghiệm di động. Đây là ứng dụng tĩnh thuần (vanilla JavaScript, không cần build step), chạy trực tiếp từ `index.html`, có Service Worker hỗ trợ cài đặt như app và sử dụng ngoại tuyến. Toàn bộ dữ liệu được lưu cục bộ trên thiết bị.

## Tính năng

- 👥 **Quản lý khách hàng & tài sản** — danh sách, tìm kiếm, phân loại, hình ảnh đính kèm.
- 📱 **PWA đầy đủ** — manifest, icon, Service Worker (runtime cache, offline), cài đặt lên màn hình chính.
- 🔒 **Bảo mật cục bộ** — khóa màn hình bằng PIN, mở khóa bằng Face ID / vân tay (WebAuthn PRF), mã hóa dữ liệu với CryptoJS.
- ☁️ **Sao lưu & khôi phục** — sao lưu thủ công, tự động sao lưu lên Google Drive, chuyển dữ liệu giữa các thiết bị qua cloud.
- 🗺️ **Bản đồ** — hiển thị vị trí khách hàng/tài sản bằng MapLibre GL, chỉ đường qua OSRM.
- 📷 **Camera & lightbox** — chụp ảnh trực tiếp trong app, xem ảnh phóng to.
- 🌤️ **Tiện ích** — thời tiết (Open-Meteo), tour hướng dẫn người dùng mới.
- 👆 **Tối ưu mobile** — điều hướng bằng cử chỉ, xử lý edge back-swipe, chuyển màn hình mượt.

## Công nghệ

| Thành phần | Công nghệ |
|---|---|
| Frontend | Vanilla JavaScript (ES6+), HTML, CSS |
| CSS | Tailwind CSS (bản build tĩnh self-hosted) |
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
├── assets/
│   ├── 00_globals.js …          # Các module JS đánh số theo thứ tự load
│   ├── pwa.js                   # Đăng ký/cập nhật Service Worker
│   ├── head.js                  # Script chạy sớm trong <head>
│   ├── styles.css               # CSS chính
│   ├── css/                     # Tailwind build tĩnh + CSS vá
│   └── ui/
│       ├── load_modals.js       # Loader nạp modal động
│       └── modals/              # Các modal HTML tách file
└── .github/workflows/ci.yml     # CI kiểm tra tĩnh
```

## Chạy cục bộ

Không cần cài đặt dependency hay build. Do Service Worker yêu cầu origin HTTP/HTTPS, hãy chạy qua một static server thay vì mở file trực tiếp:

```bash
# Dùng Python
python3 -m http.server 8000

# Hoặc dùng Node.js
npx serve .
```

Sau đó mở `http://localhost:8000/`.

## Quy trình phát triển

1. Chỉnh sửa trực tiếp `index.html`, `sw.js`, `manifest.json` hoặc các file trong `assets/`.
2. Khi thay đổi asset được cache hoặc logic PWA, **bump version đồng bộ** để người dùng nhận bản mới:
   - `VERSION` trong `sw.js`;
   - `SW_BUILD` trong `assets/pwa.js`;
   - query cache-buster (`?v=...`) tương ứng trong `index.html` nếu cần ép trình duyệt tải file mới.
3. Kiểm tra tĩnh trước khi commit:

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

## Triển khai

App được deploy dạng static trên Vercel. File `vercel.json` cấu hình các header bảo mật cho mọi response:

- `Content-Security-Policy` — giới hạn nguồn script/style/ảnh/kết nối về danh sách CDN và API tin cậy.
- `Permissions-Policy` — chỉ cho phép camera và geolocation từ chính origin.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.

Khi thêm CDN hoặc API mới, cần cập nhật CSP trong `vercel.json` tương ứng.

## Đóng góp

1. Fork repo và tạo branch mới từ `main`.
2. Thực hiện thay đổi, chạy các bước kiểm tra tĩnh ở trên.
3. Mở pull request với mô tả rõ ràng về thay đổi.

## Giấy phép

Dự án được phát hành theo giấy phép [MIT](LICENSE).

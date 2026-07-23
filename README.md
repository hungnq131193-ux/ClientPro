# ClientPro

[![CI](https://github.com/hungnq131193-ux/ClientPro/actions/workflows/ci.yml/badge.svg)](https://github.com/hungnq131193-ux/ClientPro/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-1.3.3-blue.svg)](manifest.json)
[![PWA](https://img.shields.io/badge/PWA-ready-5A0FC8.svg)](manifest.json)

**Demo:** https://client-pro-beryl.vercel.app

**ClientPro** là ứng dụng web tiến bộ (PWA) **mobile-first** giúp cán bộ tín dụng
quản lý **khách hàng** và **tài sản bảo đảm** ngay trên điện thoại. Ứng dụng chạy
**offline**, lưu toàn bộ dữ liệu nghiệp vụ **cục bộ trên thiết bị**, và chỉ kết
nối Google Drive / Google Apps Script cho những tác vụ do người dùng chủ động
thực hiện (backup, chuyển dữ liệu).

Ứng dụng viết bằng **vanilla JavaScript**, **zero-dependency lúc runtime, không
build step** — mở bằng một static server là chạy được.

## Mục tiêu

Cho người dùng một công cụ nhanh, riêng tư, dùng được cả khi mất mạng để ghi và
tra cứu hồ sơ khách hàng cùng tài sản bảo đảm: thông tin hồ sơ, ghi chú, hạn mức,
định giá, ảnh, vị trí bản đồ, khoảng cách đường bộ, bộ công cụ PDF trên thiết bị
và sao lưu/khôi phục có mã hóa.

## Đối tượng sử dụng

Cán bộ tín dụng / quan hệ khách hàng dùng trên điện thoại cá nhân. Mỗi thiết bị là
một người dùng: một lần kích hoạt, một mã PIN, dữ liệu cục bộ. Đây không phải hệ
thống nhiều người dùng trên máy chủ và không thay thế bất kỳ hệ thống lõi ngân
hàng nào.

## Chức năng hiện có

### Quản lý khách hàng
- Tạo, xem, sửa, xóa hồ sơ khách hàng.
- Trạng thái hồ sơ (đã vay / đang thẩm định), ghi chú, hạn mức tín dụng.
- Tìm kiếm nhanh theo tên, số điện thoại, CCCD ngay đầu danh sách.

### Quản lý tài sản bảo đảm
- Định giá, mức vay, diện tích, chiều rộng, hiện trạng, năm, tọa độ.
- Giá tham khảo và khoảng cách theo tài sản.

### Hồ sơ ảnh & kho ảnh
- Chụp, lưu, xem, chọn, chia sẻ ảnh gắn theo khách hàng / tài sản.
- Ảnh được mã hóa khi lưu trên thiết bị.

### Google Drive (tùy chọn)
- Kết nối Drive cá nhân của người dùng để lưu ảnh hồ sơ và bản backup.
- Chỉ hoạt động khi người dùng chủ động cấu hình; không tự động gửi dữ liệu.

### Bản đồ & khoảng cách tuyến đường
- Bản đồ MapLibre GL, gom cụm điểm bằng Supercluster.
- Khoảng cách đường bộ tính qua OSRM.

### Backup / khôi phục
- Backup Manager ngay trong app, file backup có mã hóa, backup lên Drive.
- Cloud Transfer: gửi một bản backup cho người dùng khác qua Google Apps Script.
- Khôi phục an toàn: dữ liệu được mã hóa lại bằng khóa của thiết bị đích.

### Bộ công cụ PDF (PDF Toolkit)
Sáu công cụ, **xử lý hoàn toàn trên thiết bị**, dùng được offline, **không tải file
lên bất kỳ đâu**:

1. **Ghép PDF** — nối nhiều file PDF thành một.
2. **Tách PDF** — trích xuất trang theo khoảng hoặc theo lựa chọn.
3. **Sắp xếp trang** — đổi thứ tự, xoay, xóa trang.
4. **Ảnh thành PDF** — gộp ảnh JPG/PNG/WebP thành PDF.
5. **PDF thành ảnh** — xuất trang PDF ra ảnh PNG/JPEG.
6. **Nén PDF** — giảm dung lượng file PDF.

**Giới hạn xử lý trên thiết bị** (bảo vệ bộ nhớ điện thoại):
- Tối đa **30 file** mỗi thao tác.
- Tổng dung lượng: **cảnh báo ở 30 MB, chặn ở 100 MB**.
- Số trang: **cảnh báo ở 150 trang, chặn ở 500 trang**.
- Mỗi ảnh tối đa **24 MP**.

### Offline / PWA
- App shell chạy offline nhờ Service Worker precache.
- Cài như ứng dụng standalone, khóa PIN, mở khóa sinh trắc học (Face ID / vân
  tay) và tự khóa khi ẩn app.

### Hướng dẫn cho người dùng mới
- Tour giới thiệu nhanh Dashboard hiện tự động mở ở lần đầu sử dụng.
- Có thể **mở lại thủ công** bất cứ lúc nào trong **Menu → Xem lại hướng dẫn**.

## Bảo mật và quyền riêng tư

- Dữ liệu nghiệp vụ lưu trong IndexedDB (`QLKH_Pro_V4`) trên thiết bị.
- Field nhạy cảm và ảnh được mã hóa **AES-256-GCM** qua WebCrypto.
- Master key được niêm phong bằng PIN với **PBKDF2-SHA256**, chỉ tồn tại trong
  RAM khi mở khóa.
- KDATA phục vụ backup chỉ lưu ở dạng niêm phong; không lưu plaintext master key
  hay KDATA.
- Thư viện và font đều **self-host**; CSP giới hạn script về cùng nguồn
  (`vercel.json`).
- Xóa dữ liệu trang web sẽ xóa IndexedDB — hãy duy trì backup định kỳ.

> Lưu ý: không phần mềm nào bảo mật tuyệt đối. ClientPro thiết kế theo hướng
> privacy-first, nhưng người dùng vẫn cần giữ thiết bị an toàn và sao lưu thường
> xuyên.

## Công nghệ

| Phần | Công nghệ |
|---|---|
| Frontend | Vanilla JavaScript, HTML5, CSS3 |
| Storage | IndexedDB, localStorage |
| Mã hóa | WebCrypto AES-256-GCM, PBKDF2-SHA256 |
| Sinh trắc học | WebAuthn PRF |
| Bản đồ | MapLibre GL, Supercluster, OSRM |
| PDF | pdf-lib, pdf.js, JSZip (self-host, lazy-load) |
| PWA | Service Worker, Web App Manifest |
| Cloud (tùy chọn) | Google Drive, Google Apps Script |
| Hosting | Vercel static |
| Kiểm thử | Node test runner, Playwright, axe, Lighthouse CI |

## Cấu trúc thư mục (tổng quan)

```
index.html                App shell + thứ tự load module (nguồn xác thực) + tag ?v=
sw.js                     Service Worker: precache, VERSION, ASSET_V, CACHE_EPOCH
manifest.json             Web App Manifest
vercel.json               Header bảo mật + CSP
package.json              Nguồn semver duy nhất + script test/CI
scripts/sync-version.mjs  Đồng bộ version & ASSET_V ra manifest/SW/PWA/README
assets/00…19_*.js, pwa.js Module nghiệp vụ theo tầng phụ thuộc
assets/pdf-toolkit/       Bộ công cụ PDF (utils/core/ui + các tool)
assets/ui/modals/         HTML fragment của modal (nạp qua ui/load_modals.js)
assets/vendor/            Dependency self-host
assets/fonts/             Font self-host (Be Vietnam Pro, Inter)
assets/styles.css, css/   CSS ứng dụng
gas/                      Admin GAS + User Drive GAS
tests/                    Unit test (node --test)
e2e/                      Playwright + axe
docs/screenshots/         Quy tắc lưu ảnh review; không commit bộ ảnh hàng loạt
.github/workflows/ci.yml  CI
CLAUDE.md                 Sổ tay kỹ thuật & quy tắc an toàn cho agent
AGENTS.md                 Chỉ dẫn agent đọc CLAUDE.md trước
```

## Yêu cầu môi trường

- Trình duyệt hiện đại hỗ trợ Service Worker, WebCrypto, IndexedDB (chạy trên
  HTTPS hoặc `localhost`).
- Để chạy local hoặc chạy test: Python 3 (static server) và Node.js 22.

## Cài đặt & chạy cục bộ

```bash
git clone https://github.com/hungnq131193-ux/ClientPro.git
cd ClientPro
python3 -m http.server 8080     # hoặc: npm run serve
```

Mở http://localhost:8080. Service Worker, WebCrypto và camera cần HTTPS hoặc
`localhost`.

> Ứng dụng không cần `npm install` để chạy — chỉ cần khi muốn chạy bộ e2e
> (Playwright). Toàn bộ dependency runtime đã self-host trong `assets/vendor/`.

## Kiểm thử

Cài công cụ test (chỉ dùng cho CI/e2e, không ảnh hưởng app shipped):

```bash
npm install
```

Unit test + kiểm tra version + kiểm tra cú pháp:

```bash
npm test
npm run check:version
node --check sw.js
find assets -name '*.js' -print0 | xargs -0 -n1 node --check
```

E2E (Playwright + axe):

```bash
npm run test:e2e
```

## Deploy

Repository là static site và có thể import trực tiếp vào Vercel, **không cần build
command**. Header bảo mật và CSP nằm trong `vercel.json`.

## Google Apps Script và Drive

- `gas/AdminAPI.gs`: kích hoạt thiết bị, cấp KDATA và điều phối chuyển dữ liệu.
- `gas/UserDriveAPI.gs`: kết nối Drive cá nhân để lưu ảnh và backup.
- **Không commit token hoặc secret** vào repository.

## Quản lý phiên bản

- **Tên phát hành** — **Genesis** (tên phát hành công khai, không hiển thị trong
  UI app).
- **Phiên bản app (semver)** — hiện tại **`1.3.3`**. Số kỹ thuật nội bộ giữ cho
  tooling đồng bộ và tương thích, không hiển thị cho người dùng. Nguồn duy nhất:
  `package.json`.
- **cache-buster asset** — hiện tại **`CODE_CLEANUP_20260723`**. Nguồn: `ASSET_V`
  trong `sw.js`.

Sau khi thay đổi phiên bản, đồng bộ ra mọi nơi (manifest, SW, PWA, README):

```bash
npm run sync:version
npm run check:version
```

Ngoài ra, mọi `?v=` trong `index.html` và `MAPLIBRE_V` trong `assets/03_map.js`
phải bằng `ASSET_V` (CI kiểm tra riêng).

## Cài PWA trên Android

1. Mở demo bằng Chrome.
2. Chọn **Thêm vào Màn hình chính** hoặc **Cài đặt ứng dụng**.
3. Mở ClientPro từ icon trên màn hình chính.

## Sử dụng cơ bản

1. Kích hoạt thiết bị và đặt mã PIN ở lần đầu.
2. Xem tour hướng dẫn nhanh (tự mở lần đầu; mở lại ở **Menu → Xem lại hướng dẫn**).
3. Từ Dashboard: xem số liệu tổng quan, thêm khách hàng, mở danh sách & tìm kiếm.
4. Mở hồ sơ khách hàng để thêm tài sản bảo đảm, ảnh và ghi chú.
5. Dùng bản đồ để xem vị trí và khoảng cách; dùng bộ công cụ PDF khi cần.
6. Sao lưu định kỳ qua **Sao lưu & khôi phục**.

## Đóng góp

- Đọc `CLAUDE.md` trước khi sửa code — đó là sổ tay kiến trúc và quy tắc an toàn.
- Giữ ứng dụng zero-dependency lúc runtime, không thêm CDN, không thêm inline
  handler, không nới CSP.
- **Không commit secret, token hay API key.**
- Chạy đầy đủ test và `npm run check:version` trước khi mở Pull Request.

## Xử lý sự cố thường gặp

- **App không cập nhật sau khi deploy:** đóng hẳn app/tab rồi mở lại để Service
  Worker nạp phiên bản mới; kiểm tra version đã đồng bộ (`npm run check:version`).
- **Mất dữ liệu sau khi xóa dữ liệu trang web:** IndexedDB bị xóa cùng site data
  — khôi phục từ bản backup gần nhất.
- **Bản đồ/khoảng cách không tải:** cần mạng cho tile bản đồ và OSRM; kiểm tra
  kết nối.
- **Camera/PWA không hoạt động:** cần chạy trên HTTPS hoặc `localhost`.

## License

Proprietary — All Rights Reserved. Xem `LICENSE`.

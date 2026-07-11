# ClientPro

[![CI](https://github.com/hungnq131193-ux/ClientPro/actions/workflows/ci.yml/badge.svg)](https://github.com/hungnq131193-ux/ClientPro/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](manifest.json)
[![PWA](https://img.shields.io/badge/PWA-ready-5A0FC8.svg)](manifest.json)
[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red.svg)](LICENSE)

**Demo:** https://client-pro-beryl.vercel.app

ClientPro là PWA mobile-first để quản lý khách hàng và tài sản bảo đảm (TSBĐ), tối ưu cho Android Chrome và chế độ standalone. Ứng dụng viết bằng vanilla JavaScript — không framework, không bước build, không backend riêng. Dữ liệu nghiệp vụ nằm trên thiết bị, được mã hóa, hoạt động offline và chỉ rời thiết bị khi bạn chủ động dùng Google Drive/Google Apps Script.

## Dành cho ai

Cán bộ tín dụng, thẩm định hoặc bất kỳ ai cần quản lý hồ sơ khách hàng kèm tài sản bảo đảm ngay trên điện thoại: chụp ảnh hiện trạng, lưu tọa độ, tham khảo giá quanh vị trí, sao lưu và chia sẻ hồ sơ an toàn giữa các đồng nghiệp.

## Tính năng

### Quản lý khách hàng
- Danh sách theo trạng thái (đang thẩm định / đã vay), tìm kiếm tiếng Việt không dấu, gọi điện/Zalo một chạm.
- Hồ sơ chi tiết: thông tin, ghi chú, hạn mức tín dụng (duyệt/thu hồi), chọn nhiều để xóa hoặc gửi cho user khác.

### Tài sản bảo đảm
- CRUD tài sản với mô tả, định giá, mức vay, diện tích, mặt tiền, năm, tài sản trên đất và tọa độ (link Google Maps hoặc GPS trực tiếp).
- Tham khảo giá: tìm các TSBĐ khác quanh vị trí, khoảng cách theo đường bộ (OSRM) hoặc đường chim bay.

### Ảnh và Google Drive
- Chụp ảnh trong app hoặc chọn từ máy; ảnh được mã hóa trước khi lưu; gallery, lightbox, chia sẻ, chọn nhiều.
- Tải ảnh hồ sơ/TSBĐ lên Google Drive cá nhân qua Google Apps Script của chính bạn; dọn ảnh gốc sau khi upload để tiết kiệm bộ nhớ.

### Bản đồ
- MapLibre GL self-host + cluster marker; hai kiểu nền (tối/vệ tinh); khoảng cách tuyến đường qua OSRM.

### Offline / PWA
- Cài được lên màn hình chính; toàn bộ app shell, module, font và thư viện được precache — mở được hoàn toàn offline, không phụ thuộc HTTP cache của trình duyệt.
- Cập nhật phiên bản an toàn: bản mới tự áp dụng ở lần mở app tiếp theo, **không bao giờ tự reload giữa phiên** làm mất nội dung đang nhập.

### Backup / Restore
- Backup nội bộ mã hóa (danh sách trong Backup Manager), xuất/nhập file `.cpb`.
- Backup Google Drive thủ công + tự động hằng ngày (giữ tối đa 3 bản), khôi phục từ danh sách Drive.
- Cloud Transfer: gửi hồ sơ/backup cho user khác qua hộp thư mã hóa riêng người nhận (tự hết hạn sau 24 giờ).

## Bảo mật và quyền riêng tư

- Dữ liệu lưu trong IndexedDB **trên thiết bị của bạn**; các trường nghiệp vụ (tên, SĐT, CCCD, ghi chú, hạn mức, thông tin TSBĐ) và ảnh được mã hóa AES-256-GCM (WebCrypto) bằng master key ngẫu nhiên 32 byte.
- Master key được niêm phong bằng PIN 6 số (PBKDF2-SHA256 + AES-GCM) và chỉ tồn tại trong RAM khi app mở khóa; hỗ trợ mở khóa sinh trắc học (WebAuthn PRF).
- Tự khóa khi ẩn app quá 15 giây: xóa khóa và cache dữ liệu khỏi RAM, yêu cầu PIN/sinh trắc học khi mở lại.
- Khóa backup (KDATA) do máy chủ quản trị cấp **không lưu plaintext** trong trình duyệt — chỉ lưu bản đã niêm phong bằng master key.
- CSP `script-src 'self'`, toàn bộ thư viện/font self-host, không CDN runtime.
- Lưu ý trung thực: không hệ thống nào an toàn tuyệt đối. Ai có PIN của bạn sẽ mở được dữ liệu; hãy giữ PIN cẩn thận và sao lưu định kỳ.

## Lưu ý an toàn dữ liệu khi backup/restore

- Backup `.cpb` được mã hóa bằng KDATA (không phụ thuộc master key của máy), vì vậy **cần mạng và tài khoản được cấp quyền** khi tạo/khôi phục backup.
- Restore là **upsert** (ghi đè theo ID, không xóa dữ liệu hiện có) và mọi trường được mã hóa lại bằng khóa của thiết bị đích.
- Backup tạo từ các phiên bản cũ (kể cả hạn mức lưu dạng số) vẫn khôi phục được trên v1.0.0.
- Xóa app / xóa dữ liệu trang web sẽ xóa toàn bộ IndexedDB — hãy chắc chắn đã có backup trước.

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

## Cài PWA trên Android

1. Mở https://client-pro-beryl.vercel.app bằng Chrome.
2. Menu ⋮ → **Thêm vào Màn hình chính** (hoặc banner "Cài đặt ứng dụng").
3. Mở app từ icon — chạy standalone, hoạt động offline sau lần tải đầu.

## Chạy local

Không cần build hoặc cài dependency để chạy app:

```bash
git clone https://github.com/hungnq131193-ux/ClientPro.git
cd ClientPro
python3 -m http.server 8080
```

Mở `http://localhost:8080`. Service Worker, WebCrypto và camera cần HTTPS hoặc localhost.

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

## Deploy (Vercel)

Repo là static site thuần — import vào Vercel là chạy, không cần build command. Header bảo mật và CSP nằm trong `vercel.json`. Deploy tĩnh nơi khác cũng được, miễn phục vụ đúng cây file và HTTPS.

## Cấu hình Google Apps Script / Drive

- **Admin GAS** (`gas/AdminAPI.gs`): kích hoạt thiết bị, cấp KDATA cho backup và điều phối chuyển hồ sơ giữa user. URL cấu hình trong `assets/01_config.js`.
- **User Drive GAS** (`gas/UserDriveAPI.gs`): mỗi người dùng tự deploy về Drive của mình để lưu ảnh và file backup cá nhân; dán URL + token vào phần cài đặt trong app.
- Không commit token/secret vào repo; token trong app được niêm phong bằng master key trước khi lưu.

## Phiên bản

- **Phiên bản app (semver)** — hiện tại **`1.0.0`**. Nguồn duy nhất: `package.json`.
- **cache-buster asset** — hiện tại **`V100_20260711`**. Nguồn: `ASSET_V` trong `sw.js`.

Sau khi đổi semver:

```bash
npm run sync:version
npm run check:version
```

## Có gì mới v1.0.0 (bản phát hành công khai đầu tiên)

- Tap ở hai mép màn hình hoạt động như tap ở giữa (hết "vùng chết" 28px); vuốt mép để Back vẫn giữ nguyên.
- Offline chạy hoàn toàn bằng precache của đúng phiên bản — không còn phụ thuộc HTTP cache.
- Cập nhật phiên bản không tự reload giữa phiên — không mất nội dung đang nhập.
- Loader toàn cục không còn bị modal che (chuẩn hóa lớp hiển thị).
- Hạn mức tín dụng và tên TSBĐ được mã hóa khi lưu (dữ liệu cũ tự nâng cấp an toàn sau khi mở khóa).
- Khóa backup KDATA chỉ lưu dạng niêm phong; xóa sạch khỏi RAM khi khóa app.
- Auto-backup Drive chạy đúng cả khi mở khóa muộn; mỗi thao tác xóa/khôi phục chỉ chạy một lần; lỗi được báo rõ ràng thay vì im lặng.
- Chọn lại đúng file `.cpb` vừa chọn vẫn hoạt động; ô tìm kiếm và danh sách luôn đồng bộ.

## Ủng hộ (Donate)

Nếu ClientPro hữu ích với bạn, có thể ủng hộ tác giả ngay trong app: **Menu → Ủng hộ** (quét mã QR).

## License

Proprietary — All Rights Reserved. Xem [`LICENSE`](LICENSE).

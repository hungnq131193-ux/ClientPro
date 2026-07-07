# CLAUDE.md — Skill & Kiến thức Toàn diện cho Claude về Dự án ClientPro

> **QUY TẮC BẮT BUỘC CHO CLAUDE / AI ASSISTANT**
>
> Trước khi đọc bất kỳ file code nào, trước khi phân tích, debug, đề xuất thay đổi hay implement tính năng mới cho ClientPro, **bạn BẮT BUỘC phải đọc toàn bộ file CLAUDE.md này** (từ đầu đến cuối). 
> Đây là "skill document" chính thức của dự án, chứa triết lý, kiến trúc, quy ước code, mô hình dữ liệu và hướng dẫn tương tác.
>
> Sau khi thực hiện thay đổi lớn (thêm module, sửa architecture, thay đổi security, cập nhật PWA, thêm API), **bạn PHẢI chủ động đề xuất cập nhật file CLAUDE.md** để giữ đồng bộ. User sẽ review và commit cùng thay đổi code.
>
> **MỤC TIÊU CỦA FILE NÀY (RẤT QUAN TRỌNG)**: 
> Sau khi đọc toàn bộ CLAUDE.md này, AI phải có đủ kiến thức để thực hiện **hầu hết các task** (phân tích, debug, implement feature, refactor, thêm module) **mà KHÔNG CẦN đọc trực tiếp từng file code .js** trong repo (chỉ cần tham khảo code gốc khi cần chi tiết cực sâu hoặc verify một dòng cụ thể). 
> File này đóng vai trò "single source of truth" về kiến trúc, quy ước, data flow và mental model của toàn bộ dự án.

---

## 1. Tổng quan Dự án & Triết lý Cốt lõi

**ClientPro** là ứng dụng **PWA tĩnh thuần (vanilla JavaScript ES6+)** quản lý **khách hàng** và **tài sản bảo đảm (collateral assets)**, được tối ưu cực mạnh cho trải nghiệm di động. 

- Không có backend server.
- Toàn bộ dữ liệu lưu **cục bộ trên thiết bị** và **mã hóa** bằng CryptoJS.
- Hỗ trợ **WebAuthn biometric** (Face ID / vân tay) + PIN để mở khóa.
- **Offline-first** thực sự nhờ Service Worker.
- **Self-hosted 100%**: Không dùng CDN nào cho script, style, font, icon. Tất cả nằm trong `assets/vendor/` và `assets/fonts/`.
- Triển khai static trên **Vercel** với CSP cực kỳ nghiêm ngặt.

### Triết lý phát triển (rất quan trọng khi suy nghĩ thay đổi)
1. **Privacy by Design & Local-first**: Dữ liệu không bao giờ gửi lên server trừ khi user chủ động backup lên Google Drive **cá nhân** của họ. Không có telemetry, không có account trung tâm.
2. **Self-contained & Portable**: App chạy được ngay từ USB, không cần install dependency, không build step. Chỉ cần static server (python -m http.server hoặc npx serve).
3. **Mobile Gesture First**: Slide transition mượt, edge back-swipe custom, camera tích hợp, lightbox đẹp.
4. **Accurate Free Mapping**: Sử dụng MapLibre GL (self-host) + OSRM public router với **cache thông minh + validation nghiêm ngặt** để cho kết quả khoảng cách đường thực tế chính xác cao, dù dùng hoàn toàn miễn phí.
5. **No Framework, Maximum Control**: Vanilla JS + numbered modules + data-action delegation (để tuân thủ CSP `script-src 'self'` không có `unsafe-inline`).
6. **Versioning Discipline**: PWA cache busting đòi hỏi đồng bộ version ở nhiều nơi. CI sẽ fail nếu vi phạm.

**Phiên bản hiện tại**: `1.4.1` (manifest + sw.js VERSION)

**License**: Proprietary – All Rights Reserved. Chỉ tác giả (Nguyễn Quốc Hưng) được phép sử dụng và sửa đổi.

**Live Demo**: https://client-pro-beryl.vercel.app

---

## 2. Tech Stack & Ràng buộc Kỹ thuật

| Thành phần          | Công nghệ                                      | Ghi chú quan trọng |
|---------------------|------------------------------------------------|--------------------|
| Frontend            | Vanilla JS (ES6+), HTML5, CSS3                 | Không framework, không bundler |
| Styling             | Tailwind CSS (static build) + redesign layer   | 4 themes: Sáng + Xanh Đêm, Đại Dương, Thiên Thanh |
| Bản đồ & Routing    | MapLibre GL JS (self-host) + OSRM              | Public routers + cache + validation snap 150m |
| Mã hóa              | CryptoJS (self-host)                           | Encrypt toàn bộ dữ liệu trước khi lưu IndexedDB |
| Icon                | Lucide (self-host)                             | - |
| Font                | Inter + Be Vietnam Pro (self-host woff2)       | Hỗ trợ đầy đủ tiếng Việt |
| Biometric           | WebAuthn PRF extension                         | Face ID / vân tay mở khóa an toàn |
| Cloud Backup/Sync   | Google Drive + Google Apps Script (GAS)        | Backup .cpb mã hóa, transfer dữ liệu giữa thiết bị |
| Weather             | Open-Meteo (không cần key)                     | Cache 15 phút, mô tả tiếng Việt |
| Donate              | VietQR Quick Link                              | vietinbank 888886838888 - NGUYEN QUOC HUNG |
| Hosting & Security  | Vercel + vercel.json (CSP + Permissions-Policy)| Rất strict, chỉ 'self' cho script/style/font |
| PWA                 | Custom Service Worker (sw.js)                  | Precache + stale-while-revalidate + tile cache riêng |
| Storage             | IndexedDB (`QLKH_Pro_V4`) + localStorage       | Dữ liệu khách hàng, tài sản, ảnh, notes... |

**Các ràng buộc tuyệt đối (không được vi phạm)**:
- **Không thêm CDN**: Bất kỳ thư viện mới nào cũng phải tải về `assets/vendor/` (minified) và cập nhật `index.html` + `vercel.json` CSP nếu cần.
- **Không inline event handler**: Mọi button/interaction phải dùng `data-action="handlerName"` hoặc namespace. Xem cách triển khai delegation trong `00_globals.js`.
- **CSP nghiêm ngặt**: Khi thêm domain API mới → phải cập nhật `connect-src` / `img-src` trong `vercel.json`.
- **Version sync**: Xem mục 6.1.

---

## 3. Kiến trúc Ứng dụng (SPA + Module System)

### 3.1 Cấu trúc màn hình (index.html)
App là SPA thuần với nhiều `<div id="screen-xxx">` được toggle bằng CSS class `translate-x-full` + `hidden`.

Các màn hình chính:
- `#screen-dashboard` — Trang chủ, stats, quick actions, folder view.
- `#screen-customer-list` — Danh sách khách hàng + search + filter.
- `#screen-map` — Bản đồ MapLibre + markers + tính khoảng cách.
- `#screen-folder` — Chi tiết khách hàng (tabs: info, images, assets).
- `#screen-asset-gallery` — Gallery ảnh tài sản.
- `#lightbox` — Xem ảnh phóng to + navigation.

**Animation**: Sử dụng `slideScreenIn(el)` / `slideScreenOut(el, cb)` từ `00_globals.js` + `afterTransition`. Tránh làm việc nặng (decrypt, render list lớn) trong lúc animation 300ms để tránh jank.

### 3.2 Hệ thống Module & Load Order (rất quan trọng)
Tất cả script được load bằng `<script defer>` trong `index.html` theo thứ tự dependency rõ ràng (numbered files).

**Thứ tự load hiện tại (index.html)**:
1. `assets/ui/load_modals.js`
2. `assets/00_globals.js` — Globals, helpers, data-action delegation
3. `assets/01_config.js` — Constants (OSRM, weather, donate, cache keys, snap thresholds)
4. `assets/02_security.js`
5. `assets/12_backup_core.js`
6. `assets/13_ui_select_customers.js`
7. `assets/15_auth_gate.js`
8. `assets/03_map.js`
9. `assets/04_ui_common.js`
10. `assets/05_customers.js`
11. `assets/06_assets.js`
12. `assets/08_images_camera.js`
13-16. Các `09_*.js` (menu, backup_manager, donate, weather)
17. `assets/07_drive.js`
18. `assets/14_cloud_transfer.js`
19. `assets/16_auto_backup_drive.js`
20. `assets/17_onboarding_tour.js`
21. `assets/18_biometric_unlock.js`
22. `assets/10_bootstrap.js`
23. `assets/11_edge_back_swipe.js`
24. `assets/pwa.js`

**Quy ước đặt tên**:
- `00_` đến `18_`: Module nghiệp vụ, số càng nhỏ càng nền tảng.
- Nhiều file `09_*.js` vì chúng ở cùng mức priority (feature modules).
- Khi thêm module mới: Chọn số hợp lý, cập nhật load order trong `index.html`, cập nhật CLAUDE.md.

### 3.3 Data-action Delegation (00_globals.js)
Để tuân thủ CSP (`script-src 'self'` không có `unsafe-inline`), toàn bộ click/change được delegate qua `data-action`.

**Quy ước**:
- `data-action="saveCustomer"` → gọi hàm `saveCustomer()`
- `data-action="setTheme"` + `data-arg="dark-ocean"` → `setTheme(el.dataset.arg)`
- Namespace: `data-action="DriveBackup.performNow"`

Bảng `CLICK_ACTIONS` và `CHANGE_ACTIONS` trong `00_globals.js` là nguồn duy nhất. Khi thêm handler mới → phải khai báo vào bảng này.

---

## 4. Kiến thức Chi tiết về Codebase (Đủ để làm việc mà ít cần đọc file gốc)

Mục tiêu của section này là cung cấp **mental model + chi tiết thực tế** đủ sâu để AI có thể suy luận và viết code chính xác mà không cần mở từng file .js mỗi lần.

### 4.1 Data Model & Storage (Rất quan trọng)

**IndexedDB** (`DB_NAME = 'QLKH_Pro_V4'`):
- Bảng chính: `customers`, `assets`, `images` (hoặc metadata ảnh), `notes`.
- Mỗi object được **mã hóa bằng CryptoJS** trước khi `put` vào DB (thường dùng AES hoặc tương đương với key từ PIN/biometric).
- **Customer object** (điển hình):
  - `id`, `name`, `phone`, `address`, `lat`, `lng`, `status` (active/inactive/approved?), `approved` (boolean hoặc trạng thái phê duyệt), `notes` (string hoặc array), `images` (array metadata hoặc dataURL), `assets` (array id tài sản liên kết), `createdAt`, `updatedAt`, `employeeId`?
- **Asset (tài sản bảo đảm) object**:
  - `id`, `customerId`, `type` (nhà đất, xe, máy móc...), `value` / `priceRef` (giá trị / tham khảo giá — tính năng mới), `description`, `lat/lng`, `images`, `status`, `createdAt`.
- Ảnh: Thường lưu metadata + dataURL (hoặc blob sau khi capture từ camera) trong DB hoặc separate store. Được mã hóa cùng lúc với record cha.
- LocalStorage: `app_pin` (hashed?), `app_sec_qa`, `app_theme`, `app_activated`, `app_employee_id`, `app_user_script_url` (GAS), cache weather, cache road distance.

**Quy ước**: Luôn encrypt trước khi lưu, decrypt khi đọc. Không bao giờ lưu plaintext sensitive data.

### 4.2 Nền tảng & Helpers (00_globals.js + 01_config.js)

**00_globals.js** — Nền tảng của toàn bộ app:
- DOM helper: `getEl(id)` = `document.getElementById(id)`
- `debounce(fn, wait = 150)` — dùng cho search, input realtime.
- Format: `formatDateTime(ts)`, `formatBytes(bytes)`
- Device/User: `getEmployeeId()`, `getDeviceIdSafe()`
- **Slide Screen System** (quan trọng cho UX mobile):
  - `UI_SLIDE_MS = 300`
  - `slideScreenIn(el)`, `slideScreenOut(el, cb)`, `afterTransition(el, cb)`
  - Tránh làm việc nặng (decrypt large list, render map) trong lúc transition để tránh jank.
- **Global State**: `currentPin`, `currentLightboxIndex`, `currentLightboxList`
- **Data-action Delegation** (core pattern để giữ CSP an toàn):
  - Tất cả click/change đi qua bảng `CLICK_ACTIONS` và `CHANGE_ACTIONS` trong file này.
  - Ví dụ: `data-action="saveCustomer"` → gọi `saveCustomer()`
  - `data-action="setTheme" data-arg="dark-night"` → `setTheme("dark-night")`
  - Namespace hỗ trợ: `data-action="DriveBackup.performNow"`
  - **Khi thêm UI mới → BẮT BUỘC khai báo handler vào bảng CLICK_ACTIONS**, không dùng inline `onclick`.

**01_config.js** — Single source of constants:
- **OSRM Road Distance** (tính năng then chốt):
  - Routers (ưu tiên): `https://routing.openstreetmap.de/routed-car/table/v1/driving/` (FOSSGIS, cập nhật tốt) + fallback `https://router.project-osrm.org/table/v1/driving/`
  - Cache: `ROAD_DIST_CACHE_KEY = 'app_road_dist_cache_v3'`, TTL = 7 ngày, max 600 entries. Tự động xóa cache cũ v1/v2.
  - **Validation nghiêm ngặt** (từ v1.4.0, siết chặt để tăng độ chính xác):
    - `ROAD_DIST_SNAP_MAX_M = 150` (chỉ chấp nhận nếu cả 2 điểm snap ≤ 150m so với đường thực tế)
    - `ROAD_DIST_SNAP_GOOD_M = 50` (mức tin cậy cao)
    - `ROAD_DIST_MAX_DETOUR_RATIO = 8` (nếu đường bộ dài hơn straight-line > 8 lần → loại, dùng straight-line thay thế)
    - `ROAD_DIST_DETOUR_MIN_STRAIGHT_M = 120`
  - Timeout: 8 giây. Nếu fail → fallback sang router thứ 2 hoặc straight-line.
- Weather (Open-Meteo): `WEATHER_CODE_TEXT` map sang tiếng Việt, cache 15 phút.
- Donate VietQR: Vietinbank 888886838888 - NGUYEN QUOC HUNG
- GAS: `ADMIN_SERVER_URL` + `USER_SCRIPT_KEY`, `USER_TOKEN_KEY` cho cloud transfer.

### 4.3 Bảo mật & Authentication Flow (02_security.js, 15_auth_gate.js, 18_biometric_unlock.js)

- **Encryption**: Toàn bộ record (customer, asset, image metadata, notes) được encrypt bằng CryptoJS trước khi lưu IndexedDB. Key thường derive từ PIN hoặc từ WebAuthn PRF (rất mạnh).
- **WebAuthn PRF** (18_biometric_unlock.js): Sử dụng extension PRF để tạo high-entropy key từ Face ID / vân tay credential. Key này dùng để encrypt/decrypt data. Rất an toàn, không lưu key trên server.
- **PIN + Security Question**: `PIN_KEY`, `SEC_KEY` trong localStorage. Có flow `forgotPin` + `checkRecovery`.
- **Activation & Employee**: `ACTIVATED_KEY`, `EMPLOYEE_KEY`. App có thể yêu cầu "kích hoạt thiết bị" với mã nhân viên.
- **Auth Gate** (15_auth_gate.js): Kiểm soát toàn bộ app. Hiển thị lock screen, yêu cầu PIN/biometric trước khi vào dashboard. Có `enterPin`, `clearPin`, `saveSecuritySetup`.
- Flow điển hình mở app: Check activation → Auth gate (PIN/biometric) → Decrypt data → Load dashboard.

**Quy tắc**: Không bao giờ bypass auth gate. Mọi thay đổi sensitive phải qua encrypt.

### 4.4 Quản lý Khách hàng & Tài sản (05_customers.js + 06_assets.js + 13_ui_select_customers.js)

- **05_customers.js**: 
  - CRUD: `saveCustomer()`, `deleteCurrentCustomer()`, `toggleCustomerStatus()`
  - Search, filter theo status/approved.
  - Notes: `saveCustomerNotes()`
  - Selection mode (kết hợp 13_ui_select_customers.js): `toggleCustSelectionMode()`, `sendSelectedCustomersToUser()`, `deleteSelectedCustomers()`
- **06_assets.js**:
  - CRUD tài sản bảo đảm gắn với customer.
  - Hỗ trợ `priceRef` / "tham khảo giá" (tính năng UI mới gần đây — gọn UI cho valuation).
  - Gắn location (lat/lng) để hiển thị trên map.
- **Approval workflow**: `confirmApproval()`, `closeApproveModal()` — dùng cho tính năng "approved customers" (có thể export hoặc gửi danh sách đã duyệt).
- **Selection & Bulk**: Dùng cho gửi dữ liệu qua cloud transfer hoặc approve hàng loạt.

**Data flow điển hình**: User nhập form → `saveCustomer()` → encrypt object → IndexedDB put → refresh list UI.

### 4.5 Bản đồ & Tính khoảng cách đường thực tế (03_map.js)

- MapLibre GL JS self-hosted, lazy load khi vào màn hình map.
- Markers cho customer + asset (dùng lat/lng từ DB).
- **Core feature — Road Distance**:
  1. Lấy 2 tọa độ (customer/asset hoặc current GPS + điểm đến).
  2. Gọi OSRM `/table/v1/driving/` (ưu tiên routing.openstreetmap.de).
  3. Nhận kết quả → validate:
     - Kiểm tra snap distance ≤ 150m.
     - Kiểm tra detour ratio.
  4. Nếu pass → cache kết quả (7 ngày) → hiển thị khoảng cách thực tế.
  5. Nếu fail validation hoặc timeout → fallback sang router thứ 2 hoặc tính straight-line.
- `locateMe()`, `getCurrentGPS()` — dùng Geolocation API (đã whitelist trong Permissions-Policy).
- Cache giúp giảm gọi API lặp lại và tăng tốc UX.

**Mục tiêu thiết kế**: Độ chính xác cao cho "khoảng cách đường thực tế" mà vẫn hoàn toàn miễn phí và reliable.

### 4.6 Camera, Ảnh & Lightbox (08_images_camera.js)

- `capturePhoto()` → `getUserMedia` (camera) → chụp → lưu vào record customer/asset (thường dưới dạng dataURL + encrypt metadata).
- `tryOpenCamera(data-arg)` — mở camera theo context (customer hay asset).
- Lightbox: `currentLightboxList`, `currentLightboxIndex`, `navigateLightbox()`, `closeLightbox()`, share/delete.
- `shareSelectedImages()`, `deleteSelectedImages()`, `deleteOpenedImage()`.
- Tích hợp chặt với folder view và asset gallery.

### 4.7 Backup, Restore & Cloud Sync (12_backup_core.js, 07_drive.js, 14_cloud_transfer.js, 16_auto_backup_drive.js, 09_backup_manager.js)

- **Local .cpb backup** (12_backup_core.js): `createBackupFileNow()` → export toàn bộ DB đã encrypt thành file `.cpb` (có thể download).
- **Google Drive**:
  - `uploadToGoogleDrive()`, `uploadAssetToDrive()`
  - Auto backup: `16_auto_backup_drive.js` + `DriveBackup.performNow`
  - Reconnect folder: `reconnectDriveFolder()`, `reconnectAssetDriveFolder()`
  - Cấu hình script URL trong settings.
- **Cloud Transfer** (14_cloud_transfer.js): Gửi dữ liệu (encrypted) giữa các thiết bị qua Google Apps Script endpoint (`ADMIN_SERVER_URL`). Dùng cho sync hoặc chuyển dữ liệu an toàn.
- Backup Manager modal: `openBackupManager()`, `closeBackupManager()`.

**Triết lý**: User hoàn toàn kiểm soát backup. App chỉ hỗ trợ, không ép buộc cloud.

### 4.8 PWA, Service Worker & Versioning (sw.js, pwa.js, manifest.json)

- **Versioning Discipline** (rất nghiêm ngặt):
  - `manifest.json` → `"version": "1.4.1"`
  - `sw.js` → `VERSION = 'v1.4.1'`, `ASSET_V = 'REFUI_20260707'`
  - `assets/pwa.js` → `SW_BUILD`
  - Tất cả asset link trong `index.html` có `?v=REFUI_20260707` (cache busting)
- **sw.js behavior**:
  - Precache toàn bộ shell + vendor + fonts + tất cả JS modules + một số modal HTML.
  - Runtime: same-origin cacheFirst/networkFirst, map tiles stale-while-revalidate (30 ngày), OSRM **không cache** (vì dynamic).
  - Update: `staleWhileRevalidate` cho navigation → user thấy bản mới ở lần mở app tiếp theo.
  - `skipWaiting` + message `SKIP_WAITING` để activate ngay.
- `assets/pwa.js`: Đăng ký Service Worker, xử lý update.

**Quy tắc**: Mọi thay đổi asset hoặc PWA logic → phải bump version đúng 5 nơi + CI sẽ check.

### 4.9 UI/UX, Modals, Gestures & Tiện ích

- **Themes** (4 themes): Sáng (mặc định) + 3 tối (Xanh Đêm, Đại Dương, Thiên Thanh). Dùng CSS variables + `setTheme()`, `redesign.clientpro.css`.
- **Dynamic Modals**: `assets/ui/load_modals.js` + folder `modals/` (HTML fragments được load runtime). Helpers: `openModal()`, `closeModal()`, `openGuideModal()`, `openDonateModal()`, v.v.
- **Edge Back Swipe** (11_edge_back_swipe.js): Custom gesture cho mobile (không dùng native).
- **Onboarding**: `17_onboarding_tour.js` — tour hướng dẫn người dùng mới.
- **Weather**: `09_weather.js` + `refreshWeather()` — Open-Meteo + cache.
- **Menu & Settings**: `09_menu.js`, `toggleMenu()`, settings có theme picker, security, donate, biometric toggle.
- **Donate**: `09_donate.js`, `openDonateModal()`, `copyDonateAccount()`, VietQR.

### 4.10 Bootstrap & Khởi động (10_bootstrap.js)

- Chạy sau khi các module nền tảng load xong.
- Khởi tạo DB (IndexedDB), restore theme, check auth gate, load initial data (customers/assets), init map nếu cần, register PWA.
- Thứ tự init rất quan trọng (đã sắp xếp qua load order trong index.html).

---

**Tóm lại section 4**: Với những chi tiết trên, AI có thể:
- Biết chính xác file nào chịu trách nhiệm phần nào.
- Hiểu data flow từ UI → encrypt → DB → refresh UI.
- Biết các hằng số quan trọng và validation rules của OSRM.
- Tuân thủ đúng pattern (data-action, versioning, self-host, CSP).
- Implement tính năng mới mà không cần đọc lại toàn bộ code.

Chỉ cần mở file gốc khi muốn copy-paste một đoạn logic phức tạp hoặc verify implementation hiện tại.

---

## 5. Security Headers & CSP (vercel.json)

File `vercel.json` áp dụng header cho toàn bộ route:

- `Content-Security-Policy`: 
  - `script-src 'self'`, `style-src 'self' 'unsafe-inline'` (chỉ inline style cho theme), `font-src 'self' data:`
  - `img-src` và `connect-src` chỉ cho phép danh sách domain tin cậy (Google Drive, Open-Meteo, OSRM routers, map tiles Carto/ArcGIS, VietQR, GAS...).
- `Permissions-Policy`: Chỉ cho phép `camera=(self)`, `geolocation=(self)`.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.

**Khi thêm API mới** → phải cập nhật CSP tương ứng, không được hardcode domain lung tung.

---

## 6. Quy trình Làm việc & Quy ước Code (BẮT BUỘC TUÂN THỦ)

### 6.1 Version Bump (khi thay đổi PWA assets hoặc logic quan trọng)
Phải đồng bộ **đúng 5 nơi**:
1. `"version": "1.4.1"` trong `manifest.json`
2. `VERSION = 'v1.4.1'` trong `sw.js`
3. `ASSET_V = 'REFUI_20260707'` trong `sw.js` (thường đổi thành ngày mới hoặc semantic)
4. `SW_BUILD` trong `assets/pwa.js`
5. Tất cả query string `?v=...` và `?v=REFUI_...` trong `index.html` (CSS, JS, vendor scripts)

CI (`.github/workflows/ci.yml`) sẽ kiểm tra tự động và fail nếu không khớp.

### 6.2 Thêm tính năng / Module mới
1. Tạo file `assets/NN_ten_chuc_nang.js` (chọn số load order hợp lý).
2. Thêm `<script defer src="./assets/NN_....js?v=...">` vào đúng vị trí trong `index.html`.
3. Khai báo handler vào bảng `CLICK_ACTIONS` trong `00_globals.js` (nếu là action mới).
4. Sử dụng **chỉ** `data-action="..."` trên mọi phần tử UI mới.
5. Nếu dùng external API → cập nhật CSP trong `vercel.json`.
6. **Cập nhật CLAUDE.md** (thêm mô tả module, thay đổi architecture, quy ước mới).
7. Test kỹ: local server + offline mode + PWA install + map routing accuracy + encryption flow.
8. Commit → CI xanh → deploy.

### 6.3 Self-hosting Rule
Bất kỳ thư viện JS/CSS/font nào mới → tải minified về `assets/vendor/` hoặc `assets/fonts/`, **không** để tham chiếu https://unpkg.com hay cdn khác. Cập nhật `index.html` và CSP nếu cần.

### 6.4 Kiểm tra trước commit
```bash
python3 -m json.tool manifest.json vercel.json
node --check sw.js
find assets -name '*.js' -print0 | xargs -0 -n1 node --check
```
CI cũng chạy các check này.

---

## 7. Hướng dẫn Tương tác với Claude (dành cho User)

**Prompt khuyến nghị khi làm việc với Claude**:
```
Hãy đóng vai expert developer chuyên sâu về dự án ClientPro. 
Trước khi trả lời bất kỳ câu hỏi nào liên quan đến code, architecture, feature hay bug, bạn **bắt buộc phải đọc kỹ toàn bộ file CLAUDE.md** ở root repository. 
Sau đó hãy suy nghĩ theo triết lý privacy-first, self-hosted, vanilla, mobile-first và tuân thủ nghiêm ngặt các quy ước (data-action delegation, versioning, CSP, update skill document).
```

Khi dự án có thay đổi lớn, yêu cầu Claude:  
`"Sau khi implement xong, hãy cập nhật file CLAUDE.md để phản ánh chính xác thay đổi mới."`

---

## 8. Trạng thái Hiện tại & Ghi chú Quan trọng (cập nhật 2026-07-07)

- **Phiên bản**: 1.4.1 (ASSET_V: REFUI_20260707)
- **Recent change**: Gọn UI cho tính năng "tham khảo giá" (asset price reference / valuation).
- **Điểm mạnh hiện tại**:
  - Hệ thống OSRM + cache + validation chặt → khoảng cách đường thực tế khá chính xác dù dùng free public router.
  - Bảo mật biometric WebAuthn PRF + CryptoJS + local-only.
  - PWA mượt, offline tốt, self-contained hoàn toàn.
  - Code tổ chức rõ ràng theo numbered modules + delegation.
- **Lưu ý khi làm việc**:
  - Giữ nguyên triết lý "không backend", "tất cả local + user-controlled cloud backup".
  - Không làm tăng kích thước vendor không cần thiết.
  - Ưu tiên UX mobile mượt (animation, gesture, camera).

---

**File CLAUDE.md này là tài liệu sống của dự án.**  
Hãy giữ nó chính xác, cập nhật và dễ hiểu để bất kỳ AI nào (Claude, Grok, v.v.) khi đọc dự án đều có thể làm việc hiệu quả, nhất quán với tầm nhìn của tác giả.

*Last updated: 2026-07-07 20:17 (ICT) bởi Grok — Enhanced module details để AI có thể làm việc hiệu quả mà ít cần đọc file code gốc*  
*Phiên bản skill: 1.1*

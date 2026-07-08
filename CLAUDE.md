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

**Phiên bản hiện tại**: `1.4.3` (manifest + sw.js VERSION)

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
| Cloud Backup/Sync   | Google Drive + Google Apps Script (GAS)        | 2 script độc lập trong `gas/` (nguồn tham khảo, deploy thủ công qua Apps Script editor — không thuộc build tĩnh/CI). Chi tiết: §4.11 |
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
9b. `assets/19_error_loading.js` — Chuẩn hóa error & loading (ErrorHandler / LoadingManager / AppToast). Nạp ngay sau 04 để các module nghiệp vụ phía sau dùng được.
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
- **Core feature — Road Distance (khoảng cách đường thực tế)**:

  **Cơ chế hoạt động**:
  1. Lấy 2 tọa độ (ví dụ: vị trí khách hàng + vị trí tài sản, hoặc GPS hiện tại + điểm đến).
  2. Gọi OSRM Table API `/table/v1/driving/` (ưu tiên server `routing.openstreetmap.de/routed-car` vì dữ liệu cập nhật tốt).
  3. OSRM sẽ **snap** (kéo) 2 điểm vào mạng lưới đường gần nhất và tính khoảng cách thực tế theo đường.
  4. **Validation sau khi snap** (rất quan trọng, được siết chặt từ v1.4.0):
     - `ROAD_DIST_SNAP_MAX_M = 150`: Nếu khoảng cách từ điểm gốc đến điểm snapped > 150m → kết quả bị coi là kém tin cậy (điểm nằm quá xa đường thực tế) → loại bỏ hoặc fallback.
     - `ROAD_DIST_SNAP_GOOD_M = 50`: Nếu cả 2 điểm snap ≤ 50m → mức tin cậy cao.
     - `ROAD_DIST_MAX_DETOUR_RATIO = 8` + `ROAD_DIST_DETOUR_MIN_STRAIGHT_M = 120`: So sánh khoảng cách đường bộ với straight-line distance. Nếu đường bộ dài hơn quá 8 lần (và straight-line đủ lớn) → coi là bất thường → dùng straight-line thay thế.
  5. Nếu pass validation → lưu vào cache (7 ngày, max 600 entries) → hiển thị kết quả.
  6. Nếu fail (timeout 8s, snap quá xa, hoặc detour ratio quá lớn) → fallback sang router thứ 2 (`router.project-osrm.org`) hoặc tính straight-line distance.

  **Giải thích rõ về Snapping tolerance 150m**:
  - Đây **không phải** chỉ đơn giản "nếu marker nằm trong 150m từ road network thì snap".
  - Đây là **post-snapping validation**: OSRM đã snap xong → app kiểm tra chất lượng của việc snap đó. Nếu snapped point cách vị trí gốc quá 150m → nghĩa là điểm gốc nằm ở vị trí khó snap (xa đường, vùng nông thôn thưa đường...), kết quả routing có thể không chính xác → bị loại.
  - Mục tiêu: Đảm bảo kết quả khoảng cách đường thực tế mà OSRM trả về là **đáng tin cậy**, không phải chỉ snap cho có.

- `locateMe()`, `getCurrentGPS()` — dùng Geolocation API (đã whitelist trong Permissions-Policy và CSP).
- Cache giúp giảm gọi API lặp lại, tăng tốc UX và giảm rate limit của public router.

**Mục tiêu thiết kế**: Cung cấp khoảng cách đường thực tế **chính xác cao** cho nhu cầu thực tế (thẩm định tài sản, đi thực địa...) mà vẫn hoàn toàn miễn phí, không cần API key, và reliable nhờ validation + cache + fallback.

### 4.6 Camera, Ảnh & Lightbox (08_images_camera.js)

- `capturePhoto()` → `getUserMedia` (camera) → chụp → lưu vào record customer/asset (thường dưới dạng dataURL + encrypt metadata).
- `tryOpenCamera(data-arg)` — mở camera theo context (customer hay asset).
- Lightbox: `currentLightboxList`, `currentLightboxIndex`, `navigateLightbox()`, `closeLightbox()`, share/delete.
- `shareSelectedImages()`, `deleteSelectedImages()`, `deleteOpenedImage()`.
- Tích hợp chặt với folder view và asset gallery.

### 4.7 Backup, Restore & Cloud Sync (12_backup_core.js, 07_drive.js, 14_cloud_transfer.js, 16_auto_backup_drive.js, 09_backup_manager.js)

**Phân biệt rõ 2 hệ thống backup/sync**:

- **Drive Backup (Backup file .cpb lên Google Drive cá nhân)**:
  - Mục đích: Backup & restore **toàn bộ dữ liệu** của app dưới dạng một file `.cpb` đã mã hóa.
  - Quy trình: `createBackupFileNow()` (12_backup_core.js) → tạo file `.cpb` → `uploadToGoogleDrive()` / `uploadAssetToDrive()` (07_drive.js) → upload lên Google Drive **cá nhân** của user.
  - Hỗ trợ: Auto backup định kỳ (`16_auto_backup_drive.js` + `DriveBackup.performNow`), manual backup/restore, reconnect folder nếu thay đổi Drive.
  - Ưu điểm: User hoàn toàn sở hữu file backup trên Drive cá nhân, dễ khôi phục toàn bộ app trên thiết bị mới.
  - Dùng khi: Muốn backup toàn bộ, hoặc chuyển dữ liệu sang thiết bị khác bằng cách download file .cpb rồi restore.

- **Cloud Transfer (Gửi dữ liệu qua GAS endpoint)**:
  - Mục đích: **Gửi / sync / chuyển** một phần hoặc toàn bộ dữ liệu (thường là danh sách khách hàng đã chọn) giữa **các thiết bị khác nhau** của cùng user một cách nhanh chóng, không cần download/upload file thủ công.
  - Quy trình: Sử dụng selection mode → `sendSelectedCustomersToUser()` hoặc tương tự → dữ liệu (đã encrypt) được gửi qua **Google Apps Script endpoint** (`ADMIN_SERVER_URL` trong 01_config.js). User cần cấu hình `USER_SCRIPT_KEY` và `USER_TOKEN_KEY` trong settings.
  - Ưu điểm: Nhanh, tiện cho việc sync dữ liệu giữa điện thoại và máy tính, hoặc gửi danh sách khách hàng đã duyệt cho người khác (nếu có quyền).
  - Khác biệt lớn so với Drive Backup: Không tạo file .cpb, mà gửi data trực tiếp qua server GAS (có authentication qua script URL + token mà user tự quản lý).

**Tóm lại sự khác biệt**:
- **Drive Backup** = Backup toàn bộ app thành file `.cpb` → lưu trên Google Drive cá nhân (dùng để restore toàn bộ). Backend: `gas/UserDriveAPI.gs` (mỗi user tự deploy).
- **Cloud Transfer** = Gửi dữ liệu (khách hàng, tài sản...) qua GAS endpoint để sync giữa các thiết bị (không qua file .cpb). Backend: `gas/AdminAPI.gs` (tác giả deploy 1 lần, URL cố định).

Cả hai đều tôn trọng triết lý "user-controlled cloud" — không có backend trung tâm của tác giả nắm giữ dữ liệu (Admin script chỉ trung chuyển ciphertext, không tự giải mã được). Chi tiết implementation 2 script GAS: xem §4.11.

**Triết lý**: User hoàn toàn kiểm soát backup. App chỉ hỗ trợ, không ép buộc cloud.

### 4.8 PWA, Service Worker & Versioning (sw.js, pwa.js, manifest.json)

- **Versioning Discipline** (rất nghiêm ngặt):
  - `manifest.json` → `"version": "1.4.3"`
  - `sw.js` → `VERSION = 'v1.4.3'`, `ASSET_V = 'REFUI_20260709'`
  - `assets/pwa.js` → `SW_BUILD`
  - Tất cả asset link trong `index.html` có `?v=REFUI_20260709` (cache busting)
  - `assets/03_map.js` → `MAPLIBRE_V` (lazy-load maplibre) **cũng phải bằng ASSET_V** (CI kiểm tra).
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

### 4.11 GAS Backend (`gas/`) — AdminAPI.gs & UserDriveAPI.gs

Nguồn của 2 Google Apps Script web app đứng sau mục 4.7, lưu trong `gas/` **chỉ để tham khảo/version control** — mỗi file được deploy thủ công qua Apps Script editor (Extensions → Apps Script → dán code → Deploy → Web app), **không** thuộc build tĩnh, không chạy CI, không self-host được (Google chạy trên server của họ). Cả hai dùng chung khung sườn: `doGet`/`doPost` → `handleRequest_()`, response luôn qua `outputJSON_()` (JSON kèm field `build` để debug version), `LockService.getScriptLock()` chỉ cho action **ghi**, lỗi exception không lộ ra client (chỉ `Logger.log`).

**`gas/AdminAPI.gs`** (v13, `BUILD_TAG` chứa `_v13_ADMIN`) — tác giả deploy **một lần duy nhất**, URL cố định hardcode ở `ADMIN_SERVER_URL` trong `assets/01_config.js`. Đọc/ghi Google Sheet `SHEET_ID` (tab `Keys`: cột A-F = Key|Status|EmployeeId|DeviceInfo|Date|DeviceId; tab `Transfers` tự tạo). Chức năng:
- **Licensing/activate**: `activate` (kích hoạt key + bind `deviceId` vào Sheet, chống brute-force 8 lần sai/10 phút/employeeId), `check_status`.
- **Auth gate cho mọi action nhạy cảm**: `validateActiveUser_(data)` — bắt buộc employeeId có status `used`/`active` **và** `deviceId` gửi lên khớp `deviceId` đã bind lúc activate. Chưa bind máy → từ chối (chặn chiếm quyền bằng employeeId hợp lệ nhưng chưa activate).
- **Cấp khóa mã hóa per-user** (v13, không còn khóa dùng chung): `issue_kdata` → khóa cá nhân `HMAC_SHA256(MASTER_SECRET, "personal:"+employeeId)` dùng cho Drive Backup của chính user (MASTER_SECRET nằm trong Script Properties, sinh bằng `setupMasterSecret()`). `issue_transfer_key` → khóa hộp thư `HMAC_SHA256(MASTER_SECRET, "transfer:"+targetEmployeeId)` dùng cho Cloud Transfer (label khác "personal" nên không giải mã chéo được).
- **Cloud Transfer P2P**: `list_users`, `upload_backup` (ghi Sheet `Transfers` + file Drive folder `CLIENTPRO_TRANSFERS`, TTL 24h, giữ tối đa 30 bản, `transferId` dạng `T<timestamp>_<rand>`), `list_inbox`, `download_backup` (chỉ người nhận đọc được, hết hạn thì tự xóa + đánh dấu `expired`), `delete_backup`. Cleanup tự động mỗi giờ qua trigger `cleanupExpiredTransfers` (đăng ký 1 lần bằng `setupTriggers()`).
- Cache Keys sheet trong `CacheService` 20s để giảm đọc Sheet; `debug_echo` mặc định **tắt** (`ALLOW_DEBUG_ECHO = false`).
- Setup 1 lần sau deploy: `setupStorage()` (Transfers sheet + folder + MASTER_SECRET), `setupTriggers()`.

**`gas/UserDriveAPI.gs`** (v3, `BUILD_TAG` chứa `_v3_token`) — **mỗi user tự deploy trên Google account của họ**, dán URL + token vào Cài đặt Google Drive trong app (lưu ở `localStorage[USER_SCRIPT_KEY]` / `localStorage[USER_TOKEN_KEY]`, xem §01_config.js). Không đụng tới Sheet của Admin, hoàn toàn độc lập trên Drive cá nhân từng người. Chức năng:
- **Upload ảnh**: `upload`/`upload_images` — lưu vào `CLIENTPRO_IMAGES/<folderName>/`, ép `DriveApp.Access.PRIVATE` (không share công khai); `search_folder` để list ảnh theo folder khách hàng/tài sản.
- **Backup/Restore** (`.cpb`, dữ liệu client đã mã hóa sẵn — script chỉ lưu blob, không tự giải mã được): `backup`/`create_backup` (ghi `CLIENTPRO_BACKUPS/*.cpb`, tự trim giữ 5 bản mới nhất), `list_backups`, `download_backup`/`restore`, `delete_backup`. Hai action cuối validate fileId thực sự nằm trong folder `CLIENTPRO_BACKUPS` (`isFileInBackupFolder_`) trước khi đọc/xóa — chặn dùng id lộ/đoán để đọc file Drive bất kỳ.
- **Auth fail-closed**: token bắt buộc cho MỌI action trừ `ping` (nếu server chưa từng chạy `setupToken()` thì từ chối tất cả thay vì mở cửa). So khớp token bằng `constantTimeEquals_()` (hằng thời gian, tránh timing attack). Token sinh ngẫu nhiên mạnh bởi `setupToken()`/`resetToken()`, lưu Script Properties (không hardcode).
- Giới hạn chống lạm dụng: ≤30 ảnh/request, ảnh base64 ≤ ~12MB (~9MB gốc), backup base64 ≤ ~40MB (~30MB gốc).
- Setup 1 lần sau deploy: `setupToken()` (bắt buộc trước khi dùng), tùy chọn `setupFolders()`; `revokePublicSharing()` là tiện ích migrate 1 lần để gỡ share công khai của ảnh upload bởi bản trước v3 (idempotent, chạy lại an toàn).

**Khi sửa 2 file này**: giữ nguyên mọi action/alias field/response mà `assets/07_drive.js` và `assets/14_cloud_transfer.js` đang đọc (đặc biệt `url`/`folderUrl`/`encrypted`/`kdata_b64u`/`cipher_b64`) — đây là hợp đồng ngầm giữa client và 2 script. Sau khi deploy lại trên Google, cập nhật URL mới vào `ADMIN_SERVER_URL` (AdminAPI) hoặc hướng dẫn user tự cập nhật (UserDriveAPI).

### 4.12 Chuẩn hóa Error & Loading (`assets/19_error_loading.js`)

Tầng dùng chung để (1) báo lỗi thân thiện tiếng Việt có gợi ý hành động, phân loại rõ ràng, và (2) hiển thị trạng thái loading nhất quán. Nạp **ngay sau `04_ui_common.js`** (index.html) và **trước** các module nghiệp vụ (05, 06, 08…), khởi tạo trong `10_bootstrap.js` (`LoadingManager.init()`). Precache trong `sw.js`. Không thêm CDN, không inline handler — mọi element tạo bằng DOM API, icon là inline SVG tự vẽ (không lệ thuộc lucide re-render), tuân thủ CSP.

Export ra global: `window.ErrorHandler`, `window.LoadingManager`, `window.AppToast`, cùng alias tiện dụng `showError/showSuccess/showWarning/startLoading/stopLoading`.

- **AppToast** — toast xếp chồng 4 loại (`success`/`error`/`warning`/`info`), chạm để đóng, tự đóng theo loại (error 6s, warning 5s, còn lại ~3.5s), container `#app-toast-container` tự tạo. `show(msg, type, {duration, icon})`. Lỗi nghiêm trọng có thể đặt `duration:0` để không tự đóng.
- **`showToast(msg[, type])` cũ** được **route qua AppToast** (mặc định `success` để giữ cảm giác quen thuộc) → ~60 lời gọi cũ vẫn chạy, không phải sửa hàng loạt.
- **ErrorHandler**:
  - `ERROR_CODES`: `NETWORK`, `OFFLINE`, `TIMEOUT`, `VALIDATION`, `AUTH`, `STORAGE`, `MAP`, `BACKUP`, `CAMERA`, `UNKNOWN` — mỗi mã có `userMessage` (hiện cho user) + `technicalMessage` (console) + `type` (màu toast). **Thêm mã mới chỉ cần cập nhật bảng này.**
  - `showError(codeOrMessage, customMessage?, technicalDetail?)`: nếu gọi `NETWORK` khi thật sự offline (`navigator.onLine === false`) → tự chuyển sang thông điệp `OFFLINE` (phân biệt rõ mất mạng thật vs ngoại tuyến). `technicalDetail` chỉ `console.error`, không lộ ra user.
  - `showSuccess/showWarning/showInfo`, `isOffline()`, `classify(err)` (đoán mã từ `err.name`/message: `AbortError`→TIMEOUT, `NotAllowedError`…→CAMERA, `QuotaExceededError`→STORAGE…).
  - `wrapAsync(fn, {loading, errorCode, errorMessage, successMessage, rethrow})`: bọc async — tự bật/tắt loading (`'global'` hoặc `{type:'button', el}`), tự catch + `showError` phân loại.
  - `confirm(message, {title, confirmText, cancelText, danger, icon})` → **Promise<boolean>** — hộp thoại xác nhận **thay hoàn toàn `confirm()` gốc** (CSP-safe, DOM API, không inline handler). `danger:true` cho nút đỏ (xóa). Alias toàn cục `window.showConfirm(msg, opts)`. Bàn phím: Esc = hủy, Enter = đồng ý; chạm nền tối = hủy. **Dùng `await`** ở call site (đổi hàm gọi sang `async` nếu cần).
  - **Ghi log lỗi cục bộ**: `logError(message, detail)` đẩy vào ring buffer `localStorage['app_error_log']` (giữ 50 bản gần nhất, mỗi bản `{t, m, d}`), vẫn `console.error` cho lập trình viên nhưng **không** lộ chi tiết cho user. `getErrorLog()` / `clearErrorLog()` để đọc/xóa khi debug. `showError(...)` tự gọi `logError` (không cần log tay).
  - **Global error handling**: `installGlobalHandlers()` (gọi 1 lần ở `10_bootstrap.js`) gắn `window.onerror` + `unhandledrejection` → ghi `logError` + báo 1 toast thân thiện (tiết lưu 5s, phân loại qua `classify`). Bỏ qua lỗi tải tài nguyên (img/script) — chỉ log.
- **LoadingManager** (tái sử dụng `#loader` sẵn có, đếm ref chống chồng chéo):
  - `showGlobal(msg)` / `hideGlobal(force)` — overlay toàn màn hình; `hideGlobal(true)` reset cứng ref-count (dùng ở `finally`).
  - `showProgress(msg, percent)` — thanh tiến trình `%` trong overlay (vd "Đang sao lưu… 67%").
  - `showButtonLoading(btn, text)` / `hideButtonLoading(btn, restoreText?)` — spinner trên nút + tự `disable` + `aria-busy`, phục hồi HTML gốc.
  - `showSkeleton(container, count)` / `hideSkeleton(container)` — skeleton card cho danh sách.
  - **Empty / Error state**: `showEmptyState(container, spec)` / `showSearchEmptyState(...)` / `showErrorState(...)` / `clearState(container)`. `spec = {icon, title, message, actionText, onAction}` — vẽ trạng thái trống/không kết quả/lỗi với 1 nút hành động (dùng `addEventListener`, không inline). Icon lấy từ `STATE_ICON_PATHS` (inbox/search/users/error/folder). Ví dụ dùng: danh sách KH (`05_customers.js` phân biệt "chưa có KH" vs "không có kết quả tìm kiếm" vs "tab trống"), hộp thư Cloud Transfer (`14_cloud_transfer.js`), danh sách backup Drive (`16_auto_backup_drive.js`).

**CSS** đi kèm ở cuối `assets/css/redesign.clientpro.css` (`.app-toast*`, `.btn-loading/.btn-spinner`, `.skeleton*`, `.global-progress-*`, `.cp-confirm-*` cho hộp thoại xác nhận, `.cp-state*` cho empty/error state), tôn trọng `prefers-reduced-motion`, an toàn safe-area.

**Đã refactor sang tầng này — nay phủ TOÀN BỘ codebase** (không đổi logic nghiệp vụ, chỉ chuẩn hóa báo lỗi/loading/xác nhận): `05_customers.js`, `06_assets.js`, `03_map.js`, `08_images_camera.js`, `18_biometric_unlock.js`, **`02_security.js` (activate/PIN/recovery), `07_drive.js` + `09_backup_manager.js` + `12/16_backup*` + `14_cloud_transfer.js` (toàn bộ luồng Backup/Drive/Cloud Transfer), `13_ui_select_customers.js`, `09_donate.js`, `09_weather.js`, `04_ui_common.js`, `00_globals.js`**. **Không còn `alert()` / `confirm()` / `console.error` thô** trong codebase (trừ log dev nội bộ của chính module 19 và 1 fallback có guard `if (window.ErrorHandler)` ở `00_globals.js`).

**Khi thêm luồng/async mới**: ưu tiên `ErrorHandler.showError('MÃ', 'thông điệp cụ thể', err)` cho lỗi, `await ErrorHandler.confirm(...)` thay cho `confirm()`, `LoadingManager` cho loading, `ErrorHandler.showSuccess(...)` cho thành công — **tuyệt đối không** dùng `alert()` / `confirm()` / `console.error` thô. Lỗi nội bộ chỉ cần log thì dùng `ErrorHandler.logError(...)`. Cần mã lỗi mới → thêm vào `ERROR_CODES`.

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
Phải đồng bộ **đúng 6 nơi**:
1. `"version": "1.4.3"` trong `manifest.json`
2. `VERSION = 'v1.4.3'` trong `sw.js`
3. `ASSET_V = 'REFUI_20260709'` trong `sw.js` (thường đổi thành ngày mới hoặc semantic)
4. `SW_BUILD` trong `assets/pwa.js`
5. Tất cả query string `?v=...` và `?v=REFUI_...` trong `index.html` (CSS, JS, vendor scripts) — phải **đồng nhất** và bằng `ASSET_V`.
6. `MAPLIBRE_V` trong `assets/03_map.js` (lazy-load maplibre) — phải bằng `ASSET_V`.

CI (`.github/workflows/ci.yml`) sẽ kiểm tra tự động và fail nếu không khớp.

### 6.2 Thêm tính năng / Module mới + Cập nhật CLAUDE.md (QUAN TRỌNG)

**Quy trình code**:
1. Tạo file `assets/NN_ten_chuc_nang.js` (chọn số load order hợp lý, thường theo nhóm chức năng).
2. Thêm `<script defer src="./assets/NN_....js?v=...">` vào đúng vị trí trong `index.html` (theo dependency).
3. Khai báo handler vào bảng `CLICK_ACTIONS` / `CHANGE_ACTIONS` trong `00_globals.js` (nếu có action mới).
4. Sử dụng **chỉ** `data-action="..."` trên mọi phần tử UI mới (không inline handler).
5. Nếu dùng external API mới → cập nhật CSP trong `vercel.json` (connect-src / img-src).
6. **Cập nhật CLAUDE.md** theo checklist bên dưới.
7. Test kỹ: local server + offline + PWA install + map routing + encryption + backup flow.
8. Commit → CI xanh → deploy.

**Checklist cập nhật CLAUDE.md khi implement feature mới** (bắt buộc):

- **Section 4 (Kiến thức chi tiết)** — **BẮT BUỘC**:
  - Thêm mô tả module mới vào bảng hoặc subsection tương ứng (ví dụ: nếu là module 19_xxx.js thì thêm vào cuối section 4).
  - Cập nhật data flow nếu có thay đổi (encrypt → DB → UI).
  - Bổ sung hằng số mới (nếu có) vào 01_config.js mô tả.
  - Cập nhật phần liên quan (ví dụ: nếu thêm tính năng mới cho asset → cập nhật 4.4; nếu thêm API → cập nhật 4.5 hoặc 4.7).

- **Section 3 (Kiến trúc & Module System)**:
  - Cập nhật danh sách load order trong 3.2 nếu thêm module mới.
  - Cập nhật mô tả data-action delegation nếu có pattern mới.

- **Section 2 (Tech Stack & Ràng buộc)**:
  - Thêm vào bảng nếu dùng công nghệ/lib mới.
  - Cập nhật "Các ràng buộc tuyệt đối" nếu có quy tắc mới.

- **Section 6 (Quy trình)**:
  - Cập nhật checklist hoặc ví dụ nếu workflow thay đổi.
  - Cập nhật Version Bump (6.1) nếu tính năng ảnh hưởng PWA/versioning.

- **Section 1 (Tổng quan & Triết lý)**:
  - Chỉ cập nhật nếu thay đổi lớn về triết lý (rất hiếm).

**Nguyên tắc đơn giản**:
- Mọi thay đổi về **module, data flow, hằng số, pattern code** → cập nhật **Section 4** trước tiên.
- Thay đổi **architecture, load order, UI pattern** → cập nhật Section 3.
- Thay đổi **lib, API, constraint** → cập nhật Section 2.
- Sau khi update xong, tự kiểm tra: "Nếu một AI khác đọc CLAUDE.md này, liệu nó có hiểu được tính năng mới mà tôi vừa thêm mà không cần đọc code không?"

Mục tiêu: Giữ CLAUDE.md luôn là **single source of truth** về toàn bộ dự án.

### 6.3 Self-hosting Rule
Bất kỳ thư viện JS/CSS/font nào mới → tải minified về `assets/vendor/` hoặc `assets/fonts/`, **không** để tham chiếu https://unpkg.com hay cdn khác. Cập nhật `index.html` và CSP nếu cần.

### 6.4 Kiểm tra trước commit
```bash
python3 -m json.tool manifest.json vercel.json
node --check sw.js
find assets -name '*.js' -print0 | xargs -0 -n1 node --check
node --test 'tests/**/*.test.js'   # bộ test tự động (crypto & data integrity) — xem §9
```
CI cũng chạy các check này (2 job song song trong `.github/workflows/ci.yml`: `static-checks` + `tests`).

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

## 9. Automated Testing (`tests/`) — Ưu tiên Data Integrity

Bộ test tự động, **ưu tiên cao nhất cho tính toàn vẹn dữ liệu (banking data integrity)**, chạy chủ yếu trên **GitHub Actions** để người dùng chỉ-dùng-điện-thoại xem được kết quả ✅/❌ ngay trên GitHub mà không phải test tay.

### 9.1 Triết lý & Ràng buộc (quan trọng với versioning)
- **Zero-dependency, zero-build, KHÔNG đụng versioning**: test chạy bằng **test runner tích hợp của Node** (`node --test`, cần Node ≥ 20; CI dùng Node 22) + `node:crypto` (WebCrypto) + `assets/vendor/crypto-js.min.js` đã self-host. **Không** `npm install`, **không** `node_modules`, **không** thêm CDN, **không** thêm `package.json`.
- **Nằm NGOÀI `assets/`** (thư mục `tests/` ở root) → **không** cần bump version, **không** cần cache-buster (`ASSET_V`), **không** ảnh hưởng precache Service Worker hay job version-sync trong CI. Đây là lý do đặt test ở `tests/` thay vì `assets/`.
- **Test CODE THẬT, không reimplement**: `tests/helpers/load-security.js` nạp **nguyên bản** `assets/02_security.js` vào sandbox `node:vm` (cấp CryptoJS + WebCrypto + `localStorage` giả lập + vài hằng cấu hình), rồi nối một "epilogue" cùng phạm vi từ vựng để phơi ra các hàm production (`encryptText`, `decryptText`, `encryptBackupPayload`, `decryptBackupPayload`, `sealMasterKey`, `openMasterKeyV2`, `unwrapMasterKeyAny`, `decryptCustomerObject`, …) và setter cho `masterKey`. **Khi refactor `02_security.js`, nếu đổi tên/chữ ký các hàm này phải cập nhật epilogue trong helper.**

### 9.2 Cấu trúc & phạm vi
| File | Phạm vi |
|------|---------|
| `tests/helpers/load-security.js` | Loader `vm` nạp `02_security.js` + `randomKdataB64u()`. |
| `tests/crypto.test.js` | `encryptText`/`decryptText`: roundtrip tiếng Việt, salt ngẫu nhiên, sai key không rò rỉ, đặc tính chuỗi rỗng (biết trước: `decryptText` dùng `plaintext \|\| cipher`). |
| `tests/backup.test.js` | Envelope `.cpb` AES-256-GCM: roundtrip payload (KH+tài sản+ghi chú+ảnh), checksum SHA-256, chống giả mạo (GCM tag), từ chối sai khóa / thiếu khóa / KDATA sai độ dài. |
| `tests/data-integrity.test.js` | Giải mã cấp đối tượng Customer + Asset bảo đảm (đúng schema `05_customers.js`), niêm phong masterKey bằng PIN (PBKDF2+AES-GCM), `escapeHTML`. |
| `tests/pwa.test.js` | Kiểm tra tĩnh `sw.js`/`manifest.json`: vòng đời install/activate/fetch + skipWaiting, precache đủ **mọi** module `assets/NN_*.js` + vendor sống còn, đồng bộ version (bổ trợ job version-sync). |

### 9.3 Chạy & xem kết quả
- Local: `node --test 'tests/**/*.test.js'` (output TAP: mỗi `ok N - <tên>` là 1 phép kiểm).
- CI: job **"Automated tests (crypto & data integrity)"** trong `ci.yml` (song song với `static-checks`). Trên điện thoại: mở PR → tab **Checks** → chạm job để đọc log.
- **Khi thêm hàm crypto/luồng dữ liệu mới** → thêm test tương ứng vào `tests/` (ưu tiên roundtrip + chống giả mạo + từ chối sai khóa). Không cần chạm version.

---

## 8. Trạng thái Hiện tại & Ghi chú Quan trọng (cập nhật 2026-07-08)

- **Phiên bản**: 1.4.3 (ASSET_V: REFUI_20260709) — **không đổi** khi thêm testing (test nằm ngoài `assets/`).
- **Recent change (2026-07-08b)**: **Thêm Automated Testing** (`tests/`, xem §9) ưu tiên data-integrity. Zero-dependency (`node --test` + WebCrypto + crypto-js self-host), test **code thật** của `02_security.js` qua `node:vm`, **không** thêm asset/CDN/`package.json` nên **không** phá versioning. Thêm job `tests` vào `ci.yml` (song song `static-checks`).
- **Recent change**: **Hoàn tất migration error & loading toàn ứng dụng** — mở rộng `assets/19_error_loading.js` (thêm `ErrorHandler.confirm()` thay `confirm()` gốc, `logError()` + ring buffer, `installGlobalHandlers()` bắt `window.onerror`/`unhandledrejection`, và empty/error-state renderer trong `LoadingManager`), gắn global error handling ở `10_bootstrap.js`, refactor nốt toàn bộ module còn lại (Backup/Drive/Cloud Transfer, Security/Auth, và các module nhỏ). **Không còn `alert()` / `confirm()` / `console.error` thô** trong codebase. Xem §4.12.
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

*Last updated: 2026-07-08 (ICT) — Thêm §9 Automated Testing (thư mục `tests/`, ưu tiên data integrity): zero-dependency `node --test` + `node:vm` nạp code thật `02_security.js`, thêm job `tests` vào `ci.yml`, cập nhật §6.4. Không đụng versioning (test ngoài `assets/`).*  
*Phiên bản skill: 1.4*

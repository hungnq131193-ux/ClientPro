# Prompt Termux / Claude — Sửa hướng dẫn cấu hình GAS user (Drive)

> Dán toàn bộ khối `PROMPT` bên dưới vào Claude Code trên Termux (đứng trong thư mục gốc repo ClientPro).

---

## PROMPT

```
Bạn là Claude Code đang sửa dự án ClientPro (PWA vanilla JS, offline-first).
Đọc CLAUDE.md trước khi sửa. Không thêm CDN, không nới CSP, không location.reload().

## Bug

User mới chưa cấu hình GAS cá nhân (USER_SCRIPT_KEY / Link Script Drive).
Khi bấm upload/tìm folder Drive, app hiện confirm:
  title: "Chưa cấu hình Drive"
  message: "... Vào cài đặt ..."
  confirmText: "Vào Cài đặt"
và nếu đồng ý thì gọi toggleMenu() → mở modal "Cài Đặt".

Nhưng cấu hình GAS user ĐÃ BỊ GỠ khỏi menu Cài đặt và chuyển sang Dashboard:
  index.html → section "Thao tác nhanh" → nút "Cài đặt Google Drive"
  data-action="toggleDashboardDriveConfig"
  panel #dashboard-drive-config (input #dashboard-drive-url + #dashboard-drive-token)
  logic lưu: saveScriptUrl() trong assets/07_drive.js

Cần sửa copy + hành vi nút confirm để đưa user đúng chỗ cấu hình GAS trên Dashboard.

## Bước 1 — ĐỌC (chỉ đọc, hiểu trước khi sửa)

1. CLAUDE.md — quy tắc dự án, bảng version, module map
2. assets/07_drive.js — TOÀN BỘ, tập trung:
   - toggleDashboardDriveConfig()
   - saveScriptUrl()
   - mọi chỗ ErrorHandler.confirm chứa "Vào Cài đặt" / "Vào cài đặt" / "Chưa cấu hình Script"
     (hiện có khoảng 4 chỗ: uploadAssetToDrive, reconnectAssetDriveFolder,
      reconnectDriveFolder, uploadToGoogleDrive) — sau confirm đều gọi toggleMenu()
3. index.html — khối #screen-dashboard, nút toggleDashboardDriveConfig,
   panel #dashboard-drive-config (nhãn "Cài đặt Google Drive", "Link GAS cá nhân")
4. assets/09_menu.js — xác nhận menu Cài đặt KHÔNG còn form GAS/script URL
5. assets/00_globals.js — data-action map: toggleDashboardDriveConfig, saveScriptUrl, toggleMenu
6. assets/05_customers.js — closeFolder(), closeCustomerList() (để biết cách về Dashboard
   khi user đang ở hồ sơ / danh sách KH)
7. assets/17_onboarding_tour.js — bước target '#btn-open-menu' còn nói
   "Đổi giao diện, sao lưu dữ liệu, kết nối Google Drive" → SAI (Drive không còn trong menu)
8. assets/01_config.js — USER_SCRIPT_KEY / USER_TOKEN_KEY (chỉ tham chiếu, không đổi key)
9. package.json, sw.js (ASSET_V, VERSION), scripts/sync-version.mjs — quy trình bump version

Grep xác nhận không sót chuỗi cũ:
  rg -n "Vào Cài đặt|Vào cài đặt|Chưa cấu hình Script|Chưa cấu hình Drive|toggleMenu\(\)" assets/

## Bước 2 — SỬA

### File chính: assets/07_drive.js

A) Thêm helper điều hướng (đặt gần toggleDashboardDriveConfig), ví dụ:

  function openDashboardDriveConfigGuide() {
    // 1. Đóng menu Cài đặt nếu đang mở (đừng mở menu)
    // 2. Nếu đang ở screen-folder → closeFolder()
    // 3. Nếu đang ở screen-customer-list (không hidden / không translate-x-full)
    //    → closeCustomerList() để về Dashboard
    // 4. Mở panel Drive trên Dashboard:
    //    - lấy #dashboard-drive-config
    //    - CHỈ gọi toggleDashboardDriveConfig() khi panel đang hidden
    //      (tránh toggle đóng panel nếu đã mở)
    //    - nếu panel không tồn tại: ErrorHandler.showWarning hướng dẫn
    //      "Dashboard → Cài đặt Google Drive"
  }

  Không await giữa IndexedDB. Không persist plaintext. Chỉ điều hướng UI.

B) Thay TẤT CẢ 4 khối confirm thiếu cấu hình Script:

  CŨ:
    ErrorHandler.confirm("... Vào Cài đặt ...", {
      title: "Chưa cấu hình Drive",
      confirmText: "Vào Cài đặt"
    }) → rồi toggleMenu()

  MỚI (copy tiếng Việt ngắn, rõ):
    title: "Chưa cấu hình Drive"
    message gợi ý đúng chỗ, ví dụ:
      "Bạn chưa cấu hình Link GAS cá nhân. Vào Dashboard → Cài đặt Google Drive để nhập Link Script và Access Token?"
      (có thể rút gọn tương đương; thống nhất 1 message cho cả 4 chỗ, trừ khi chỗ reconnect
       muốn ngắn hơn — vẫn phải chỉ Dashboard, không nói "Cài đặt" kiểu menu)
    confirmText: "Cài đặt Drive"   // KHÔNG dùng "Vào Cài đặt"
    on confirm true → gọi openDashboardDriveConfigGuide()  // KHÔNG gọi toggleMenu()

C) Không đổi logic upload/reconnect khi ĐÃ có userUrl hợp lệ.
D) Không đổi saveScriptUrl / seal token / USER_SCRIPT_KEY.

### File phụ (bắt buộc vì copy sai): assets/17_onboarding_tour.js

- Bước đang target '#btn-open-menu' với content nhắc "kết nối Google Drive":
  → bỏ phần Drive khỏi content menu Cài đặt.
- Thêm (hoặc thay) một bước tour trỏ đúng nút Drive trên Dashboard:
  target: 'button[data-action="toggleDashboardDriveConfig"]'
    (hoặc selector ổn định tương đương trong index.html)
  title/content: hướng dẫn cấu hình Link GAS / Google Drive trên Dashboard.
- Nếu đổi nội dung tour đáng kể: tăng TOUR_VERSION lên +1 để user cũ thấy lại bước mới.
- Giữ z-index onboarding (1000) — không đụng layering toàn cục.

### Không sửa (trừ khi bắt buộc vì version sync)

- assets/09_menu.js (không thêm lại form GAS vào menu)
- gas/*.gs
- CSP / vercel.json
- Không hard-code số dòng trong comment

## Bước 3 — BUMP VERSION ĐẦY ĐỦ

Đây là UX fix → bump PATCH semver.

1. package.json: "version" 1.0.0 → 1.0.1
2. sw.js: đổi ASSET_V mới, ví dụ 'GENESIS_20260714' → 'FIXDRIVE_20260714'
   (chuỗi mới, khác hẳn giá trị cũ — bắt buộc để bust cache PWA)
3. index.html: thay MỌI ?v= cũ bằng ASSET_V mới (khớp từng ký tự với sw.js ASSET_V).
   Giữ MAPLIBRE_V nếu có rule riêng; phần asset app phải cùng ASSET_V.
4. CLAUDE.md bảng §2: cập nhật semver + ASSET_V cho khớp thực tế.
5. Chạy:
     npm run sync:version
   → đồng bộ manifest.json, sw.js VERSION, assets/pwa.js SW_BUILD, README.md
6. Chạy:
     npm run check:version
   → phải pass

## Bước 4 — KIỂM TRA BẮT BUỘC

  npm test
  npm run check:version
  node --check sw.js
  find assets -name '*.js' -print0 | xargs -0 -n1 node --check

Grep sau sửa phải sạch hướng dẫn cũ:
  rg -n "Vào Cài đặt|Vào cài đặt ngay" assets/
  → không còn trong luồng Drive thiếu cấu hình
  rg -n "toggleMenu\(\)" assets/07_drive.js
  → không còn sau các confirm thiếu Script

Nếu có test e2e/unit đụng chuỗi cũ hoặc menu Drive: cập nhật cho khớp.

## Done criteria

- [ ] Confirm thiếu GAS trỏ Dashboard → Cài đặt Google Drive (không mở menu Cài đặt)
- [ ] Nút confirm mở/focus panel #dashboard-drive-config (sau khi về Dashboard nếu cần)
- [ ] Onboarding không còn bảo Drive nằm trong menu Cài đặt
- [ ] Semver 1.0.1 + ASSET_V mới đồng bộ mọi chỗ (check:version pass)
- [ ] node --check + npm test pass
- [ ] Commit message rõ: fix UX hướng dẫn cấu hình GAS Drive về Dashboard + bump 1.0.1

Bắt đầu bằng đọc file theo Bước 1, rồi mới sửa. Không ước lượng thời gian — làm xong checklist.
```

---

## Ghi chú nhanh cho người chạy prompt

| Hạng mục | Giá trị hiện tại (trước fix) |
|---|---|
| Semver | `1.0.0` (`package.json`) |
| ASSET_V | `GENESIS_20260714` (`sw.js`) |
| File bug | `assets/07_drive.js` (~4 confirm → `toggleMenu()`) |
| Chỗ cấu hình đúng | Dashboard → **Cài đặt Google Drive** (`toggleDashboardDriveConfig`) |
| Tour sai | `assets/17_onboarding_tour.js` bước `#btn-open-menu` |

Chạy trong Termux (ví dụ):

```bash
cd ~/path/to/ClientPro
claude   # dán PROMPT ở trên
```

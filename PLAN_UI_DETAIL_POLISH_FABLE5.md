# Plan: Chau chuốt UI chi tiết toàn app (đợt sau 1.0.4)

**Dành cho:** Claude Fable 5  
**Repo:** ClientPro (vanilla JS PWA, zero build step)  
**Đọc trước:** `CLAUDE.md` (bắt buộc)  
**Base branch:** `main`  
**Version hiện tại:** `1.0.4` / `ASSET_V=UIPOLISH_20260716`  
**Target sau khi xong:** bump semver đầy đủ → **`1.0.5`** + `ASSET_V` mới (vd `UIPOLISH2_20260716`)

**Screenshot tham chiếu (đã có sẵn):** `docs/screenshots/ui-polish-1.0.4/`  
**Bối cảnh:** Đợt 1.0.4 đã xong P0–P2 contrast/theme remap. Đợt này chau chuốt **chi tiết nhỏ** còn sót — cảm giác “app ngân hàng hoàn thiện”, không đụng logic nghiệp vụ.

---

## 0. Mục tiêu & ràng buộc cứng

### Mục tiêu
Sau khi trải nghiệm như người dùng khó tính trên Android Chrome standalone, còn các ma sát sau (không chấp nhận được ở sản phẩm 1.x):

1. Toast đè header / ô tìm kiếm / thời tiết (screenshot dashboard + list)
2. Touch target nhỏ hơn 44px (đóng modal, gọi/Zalo, theme swatch, backup chip hẹp)
3. Safe-area notch / home indicator chưa áp cho map, camera, lightbox, thanh hành động hồ sơ
4. Focus input nền đen cứng (`rgba(0,0,0,0.4)`) phá form theme sáng
5. Copy lẫn Anh/Việt + jargon kỹ thuật (`Backup`, `restore`, `masterKey`, `GAS`, `Access Token`, `(Map)`)
6. Backup sheet trên máy hẹp (~360px) thu chữ xuống 9px / nút 31px — gần như không bấm được
7. Badge trạng thái hồ sơ hiện trần `500` thay vì `500 trđ` / ngữ cảnh rõ
8. Tab Thông tin còn dải bottom bar trống; quick-action 4 cột chữ 10.5px lệch baseline
9. Hai hệ toast khác nhau; confirm/empty CTA dùng `#2563eb` lệch brand
10. Emoji / UPPERCASE / radius / skeleton / scrollbar còn “demo Tailwind” chứ chưa banking polish

### Ràng buộc — KHÔNG được phá
- **Không** đổi schema IndexedDB, field mã hóa, thuật toán crypto, PIN/biometric gate, AuthGate.
- **Không** đổi luồng backup/restore/Drive/transfer (chỉ copy + CSS + HTML trình bày).
- **Không** `await` WebCrypto/I/O giữa IndexedDB transaction.
- **Không** nới CSP, không thêm CDN, không inline `onclick` mới (giữ `data-action`).
- **Không** `location.reload()` để che lỗi.
- **Không** persist plaintext master key / KDATA.
- Mọi thay đổi ưu tiên **CSS + HTML copy**. Chỉ đụng JS khi:
  - chuỗi hiển thị thuần túy (label badge, empty-state text, toast message tiếng Việt), **hoặc**
  - class/attribute trình bày (thêm `hidden` khi dock trống, `aria-label`, `min-height` class).
- Không đổi selector/`data-action` mà e2e đang phụ thuộc trừ khi cập nhật e2e tương ứng.
- Giữ 4 theme (`vietinbank` / `midnight` / `ocean` / `aurora`); không regress theme tối khi remap sáng.

### File được phép đụng (ưu tiên)
| File | Việc |
|---|---|
| `assets/css/redesign.clientpro.css` | Lớp polish cuối (ưu tiên thêm rule mới ở cuối file) |
| `assets/styles.css` | Sửa token/focus/safe-area/backup media query / radius |
| `assets/css/app.patch.css` | Chỉ nếu cần utility nhỏ |
| `index.html` | Copy Drive labels, class dock, safe-area class, toast |
| `assets/ui/modals/*.html` | Copy tiếng Việt, nút đóng 44px, QR fallback markup |
| `assets/05_customers.js` / `06_assets.js` / `08_images_camera.js` / `19_error_loading.js` | **Chỉ** chuỗi UI / class hiển thị nếu bắt buộc |
| `package.json` + `sw.js` `ASSET_V` + `index.html` `?v=` | Bump version cuối đợt |
| `CLAUDE.md` / `README.md` | Đồng bộ sau `npm run sync:version` |

### File cấm đụng (trừ copy UI bắt buộc)
`02_security.js`, `12_backup_core.js`, `14_cloud_transfer.js`, `15_auth_gate.js`, `16_auto_backup_drive.js`, `18_biometric_unlock.js`, `gas/*`, schema bootstrap, logic decrypt/encrypt.

---

## 1. Phản hồi người dùng khó tính (tóm tắt cảm giác)

> “App đã đẹp hơn 1.0.4 nhưng vẫn chưa ‘xong’. Toast che nút. Backup trên máy nhỏ chữ như chú thích pháp lý. Map/camera đụng tai thỏ. Form focus thành vệt đen. Chữ Backup/GAS/masterKey như màn hình debug. Nút X nhỏ, gọi/Zalo nhỏ. Tab Thông tin có thanh trắng chết dưới chân. Badge hồ sơ ghi `500` không đơn vị. Quick action 4 cột chữ bé lệch dòng. Hai kiểu toast. Confirm xanh Tailwind chứ không xanh VietinBank.”

Mỗi workstream dưới đây gắn với cảm giác đó + file cụ thể + acceptance.

---

## 2. Workstream A — Safe-area & vùng chạm (P0)

**Mục tiêu:** Không còn control nằm dưới notch / home indicator; mọi nút đóng / hành động chính ≥ 44×44.

### A1. Map controls
**File:** `assets/css/redesign.clientpro.css` (hoặc cuối `styles.css`)

```css
#screen-map [data-action="toggleMap"] {
  top: calc(1rem + var(--sat, 0px)) !important;
  left: calc(1rem + var(--sal, 0px)) !important;
}
#screen-map [data-action="locateMe"] {
  bottom: calc(2rem + var(--sab, 0px)) !important;
  right: calc(1.5rem + var(--sar, 0px)) !important;
}
#screen-map .maplibregl-ctrl-top-right {
  top: calc(0.5rem + var(--sat, 0px));
  right: calc(0.5rem + var(--sar, 0px));
}
#screen-map .maplibregl-ctrl-bottom-left {
  bottom: calc(0.5rem + var(--sab, 0px));
  left: calc(0.5rem + var(--sal, 0px));
}
#screen-map .maplibregl-ctrl-group button {
  min-width: 44px !important;
  min-height: 44px !important;
}
```

### A2. Camera modal
**File:** `assets/ui/modals/camera-modal.html` + CSS  
- Close: `top: calc(2rem + var(--sat))`, hit ≥ 44px  
- Shutter wrap: `bottom: calc(2.5rem + var(--sab))`

### A3. Lightbox
**File:** `index.html` `#lightbox`  
- Counter + action row: `bottom: calc(3rem + var(--sab))` (tránh chồng nhau — counter trái, actions phải)  
- Nav: `left/right: calc(1rem + var(--sal/--sar))`

### A4. Bottom action docks hồ sơ / gallery
**File:** CSS

```css
#screen-folder .glass-panel.border-t,
#screen-asset-gallery .glass-panel.border-t {
  padding-bottom: calc(1rem + var(--sab, 0px)) !important;
}
```

### A5. Hit target chuẩn 44px
Áp cho:
- Mọi nút đóng modal (`[data-action^="close"]` trong modal, backup X, donate, guide, biometric, setup-lock, add-modal…)
- Pencil edit hồ sơ / ghi chú
- `.customer-action-btn` → `44×44` (icon ~20px), radius 12
- `.theme-btn-sm` → `min-height: 44px; aspect-ratio: 1; max-height: none`
- `.settings-btn` → `min-height: 44px; font-size: 13px; padding: 12px`
- Tour `.tour-skip` / `.tour-btn` → `min-height: 44px`

**Acceptance:** Trên máy có notch (hoặc DevTools safe-area), map/camera/lightbox/dock không đụng system UI; không còn nút chính < 44px.

---

## 3. Workstream B — Toast, focus, brand color (P0)

### B1. Toast không che navigation
**File:** `assets/css/redesign.clientpro.css` `#app-toast-container`  
Hiện: `top: calc(4.25rem + var(--sat))` — screenshot cho thấy vẫn đè search / logo.

**Fix đề xuất:**
- Đặt `top: calc(var(--sat, 0px) + 6.75rem)` trên màn có toolbar 2 hàng (list), hoặc
- Giới hạn `max-width: min(88vw, 320px)` + không phủ hàng nút back (cân nhắc `pointer-events` đã có)
- Weather pill: thống nhất `max-width` HTML (`160px`) với redesign (`216px`) → chọn `min(42vw, 180px)`; nền `rgba(255,255,255,.16)` + chữ trắng đủ contrast mọi theme

### B2. Thống nhất toast
**File:** `index.html` `#toast` + CSS  
Hai voice: pill glass `#toast` vs card `.app-toast`.  
**Fix:** Style `#toast` khớp `.app-toast` (radius 14, border-left accent, cùng top), hoặc ẩn `#toast` nếu đã migrate hết sang `ErrorHandler` — **chỉ CSS**, không đổi API toast trừ khi confirm không còn caller.

### B3. `input:focus` token-based
**File:** `assets/styles.css` ~dòng `input:focus`

**Hiện (sai):**
```css
input:focus {
  background: rgba(0, 0, 0, 0.4) !important;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
}
```

**Đổi thành:**
```css
input:focus, textarea:focus, select:focus {
  border-color: var(--accent) !important;
  background: var(--input-bg, var(--bg-panel)) !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
}
```
- Bỏ indigo khỏi `#search-input:focus` / `.glass-panel.selected` / `.glass-panel-lite.selected` → dùng `var(--accent)`.
- Light theme đã có override từng modal — giữ tương thích, không double-fight.

### B4. Confirm / empty CTA = brand
**File:** `redesign.clientpro.css`  
`.cp-confirm-ok`, `.cp-state-action`: `#2563eb` → `var(--accent)` hoặc `var(--accent-gradient)`.

### B5. Map style active (dark)
`.map-style-control button.active` indigo → `color-mix(..., var(--accent) 35%, transparent)`.

**Acceptance:** Focus form sáng không còn nền đen; toast không che back/search; confirm xanh brand.

---

## 4. Workstream C — Backup sheet mobile + copy Việt (P0)

### C1. Media query ≤420px — sàn chạm & chữ
**File:** `assets/styles.css` `@media (max-width: 420px)` (~2237+)

**Hiện:** `.backup-action-card { min-height: 31px; font-size: 9px }` — không chấp nhận.

**Đổi sàn cứng:**
| Selector | min-height | font-size |
|---|---|---|
| `.backup-action-card`, `.backup-mini-tab` | ≥ 44px | ≥ 12px |
| `.backup-drive-btn` | ≥ 48px | ≥ 13px |
| `.backup-kicker` | — | ≥ 10px (uppercase OK) |
| `.backup-pill` | — | ≥ 11px |

Giữ density bằng giảm padding section / gap, **không** bằng cách thu chữ dưới 12px cho control.

### C2. Copy Việt hóa (HTML only)
**File:** `assets/ui/modals/backup-manager-modal.html`

| Hiện | Đổi thành |
|---|---|
| `Trung tâm Backup` | `Trung tâm sao lưu` |
| `... restore và xuất/nhập...` | `... khôi phục và xuất/nhập...` |
| `Backup lên Drive` | `Sao lưu lên Drive` |
| `Nhận từ user` | `Nhận từ đồng nghiệp` |
| `... trong inbox.` | `... trong hộp thư đến.` |
| Warning `Backup/restore bị chặn khi app chưa unlock hoặc thiếu masterKey...` | `Sao lưu và khôi phục chỉ hoạt động khi đã mở khóa ứng dụng. Không chia sẻ file sao lưu với người khác.` |

Giữ tên định dạng `.cpb` / pattern file kỹ thuật (cần cho support).

### C3. Drive config labels
**File:** `index.html`

| Hiện | Đổi |
|---|---|
| `Link GAS cá nhân` | `Link Script cá nhân` |
| `Mã bảo mật (Access Token)` | `Mã bảo mật` |

**Acceptance:** Máy 360px bấm được mọi nút backup; không còn `masterKey` / `unlock` / `Backup` tiếng Anh trên UI người dùng.

---

## 5. Workstream D — Dashboard / List / Folder polish (P1)

### D1. Quick actions 2×2 trên hẹp
**File:** CSS `#folder-view .quick-action-grid`

```css
@media (max-width: 390px) {
  #folder-view .quick-action-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }
  #folder-view .quick-action-btn strong {
    font-size: 12px !important;
  }
}
```
Tuỳ chọn rút nhãn HTML: `Sao lưu`, `Drive` (giữ `aria-label` / title đầy đủ nếu rút).

### D2. Selection bar light theme
**File:** CSS

```css
body.theme-vietinbank #cust-selection-bar [data-action="sendSelectedCustomersToUser"] {
  background: rgba(0, 91, 159, 0.08) !important;
  color: #005b9f !important;
  border-color: rgba(0, 91, 159, 0.22) !important;
}
body.theme-vietinbank #selection-bar .text-blue-400,
body.theme-vietinbank #cust-selection-count {
  color: #005b9f !important;
}
```

### D3. Folder info — ẩn dock trống
**File:** `index.html` + JS nhỏ **hoặc** CSS  
`#screen-folder .glass-panel.border-t` luôn hiện → dải trắng chết trên tab Thông tin (screenshot).

**Cách an toàn (ưu tiên CSS/HTML):**
- Thêm class `folder-actions-dock` + khi `#actions-images` và `#actions-assets` đều `hidden`, parent cũng `hidden`.
- Nếu cần JS: chỉ toggle class trên dock trong `switchTab` — **không** đổi logic tab/data.

### D4. Badge trạng thái `500` → có đơn vị
**File:** chỗ render `#detail-status-badge` (thường `05_customers.js`)  
Chỉ sửa **chuỗi hiển thị**: nếu đang show số hạn mức trần, thêm ` trđ` (thống nhất với list chip). Không đổi field lưu DB.

### D5. Inactive tabs dark themes
Mở rộng rule inactive tab contrast (đang chỉ `theme-vietinbank`) sang midnight/ocean/aurora: `rgba(255,255,255,0.86)`.

### D6. Asset modal
**File:** `asset-modal.html`  
- `Vị trí / Tọa độ (Map)` → `Vị trí / Tọa độ`  
- Placeholder thiếu khoảng trắng → `VD: Số bìa...`  
- Thêm nút X góc trên (44px) khớp `add-modal` (cùng `data-action` đóng hiện có)  
- Grid 3 cột valuation: trên ≤390px stack 1 cột hoặc 2+1

### D7. Approve / guide / donate / ref-price accent
Thay emerald/pink/Tailwind-dark utilities bằng token `--accent` / `--bg-panel` / `--text-main` (HTML class + CSS remap). Donate giữ icon heart nhưng khung xanh brand.

### D8. Donate QR fallback
**File:** `donate-modal.html`  
Wrapper min-height + text fallback: `Không tải được mã QR — dùng Sao chép STK`. `object-fit: contain; background: #fff` cho ảnh.

**Acceptance:** Dashboard/list/folder không còn “thanh chết”, badge có đơn vị, quick-action đọc được trên iPhone SE-class.

---

## 6. Workstream E — Micro-polish toàn cục (P2)

Làm sau khi A–D xanh. Có thể gộp 1 commit riêng nếu diff lớn.

| # | Việc | File gợi ý |
|---|---|---|
| E1 | Bỏ emoji `👋` ở `.dash-hi`; donate bỏ `☕` nếu còn | `index.html`, donate modal |
| E2 | Token radius: `--radius-sm:12px; --radius-md:16px; --radius-lg:22px` áp card/chip/modal | `styles.css` + redesign |
| E3 | Tab / CTA bỏ `uppercase` → sentence case (`Thông tin`, `Hồ sơ ảnh`, `Tài sản`, `Lưu hồ sơ`) | `index.html`, modals |
| E4 | Skeleton default dùng `var(--bg-panel)` / border token (tránh flash tối trên sáng) | redesign |
| E5 | Scrollbar thumb: `color-mix(in srgb, var(--text-sub) 35%, transparent)` | styles |
| E6 | Keypad thống nhất 66px (bỏ conflict 72 vs 66) | styles + redesign |
| E7 | Placeholder opacity 0.5 → 0.72 | styles |
| E8 | Xóa CSS chết `.dashboard-date-ticker` nếu không còn DOM | styles |
| E9 | Lock screen copy hardcode màu sáng (`#e8f1fb` / `#8fa8c4`) — tránh FOUC `var(--text-main)` khi theme sáng | `screen-lock.html` |
| E10 | `prefers-reduced-motion` đã có — giữ; không thêm animation mới ồn | — |

---

## 7. Thứ tự thực thi đề xuất

1. **A** (safe-area + 44px) — rủi ro thấp, giá trị cao  
2. **B** (toast/focus/brand) — sửa “cảm giác hỏng” ngay  
3. **C** (backup mobile + copy) — screenshot backup đã lộ jargon  
4. **D** (dashboard/list/folder)  
5. **E** (micro)  
6. **Version bump đầy đủ** (mục 8)  
7. Test + screenshot 4 theme

Không parallel hóa A+C nếu conflict CSS media query — làm tuần tự, commit nhỏ theo workstream.

---

## 8. Bump version đầy đủ (bắt buộc khi xong)

1. `package.json` → `"version": "1.0.5"`  
2. `sw.js` → `ASSET_V = 'UIPOLISH2_20260716'` (hoặc ngày thực tế)  
3. Đổi **mọi** `?v=` trong `index.html` (+ `MAPLIBRE_V` nếu cùng cache-buster policy) khớp `ASSET_V`  
4. Chạy:
   ```bash
   npm run sync:version
   npm run check:version
   ```
5. Cập nhật bảng CLAUDE.md (semver + ASSET_V) nếu sync chưa cover  
6. Kiểm tra:
   ```bash
   npm test
   node --check sw.js
   find assets -name '*.js' -print0 | xargs -0 -n1 node --check
   npm run test:e2e
   ```
7. Chụp lại screenshot đại diện 4 theme → `docs/screenshots/ui-polish-1.0.5/` (dashboard, list, backup, folder info, map, 1 modal)

### Checklist acceptance tổng
- [ ] Không còn control map/camera/lightbox/dock đụng safe-area  
- [ ] Không còn nút đóng / gọi / Zalo / theme / settings / backup chip < 44px trên mobile  
- [ ] Focus input theme sáng không nền đen  
- [ ] Toast không che back / search / settings  
- [ ] Backup ≤420px: chữ ≥12px, control ≥44px  
- [ ] Không còn `masterKey` / `unlock` / `Backup` / `Access Token` / `(Map)` trên UI user  
- [ ] Tab Thông tin không còn thanh trắng trống  
- [ ] Badge hạn mức có `trđ`  
- [ ] Confirm/empty/selection/map-active dùng accent brand  
- [ ] 4 theme không regress (đặc biệt 3 theme tối)  
- [ ] `npm test` + `check:version` + e2e pass  
- [ ] Version `1.0.5` + ASSET_V đồng bộ mọi nơi  

---

## 9. Commit message gợi ý

```
UI polish chi tiết (safe-area, 44px, focus, copy Việt, backup mobile) + bump v1.0.5

Workstream A–E theo PLAN_UI_DETAIL_POLISH_FABLE5.md.
Chỉ CSS/HTML/copy trình bày — không đổi logic nghiệp vụ.
ASSET_V=UIPOLISH2_20260716.
```

---

## 10. Ngoài phạm vi (không làm đợt này)

- Đổi thuật toán backup / auto-lock / WebAuthn / crypto  
- Thêm CDN font/icon  
- Redesign lại toàn bộ information architecture  
- Dark-mode mới / theme thứ 5  
- i18n framework  
- Sửa map tile load failure (mạng/CSP) — chỉ polish chrome nếu map trống  

Nếu phát hiện bug logic khi chạm UI: **ghi chú trong PR**, không “sửa luôn” ngoài phạm vi trừ khi blocker hiển thị (ví dụ ciphertext lộ — dừng và báo).

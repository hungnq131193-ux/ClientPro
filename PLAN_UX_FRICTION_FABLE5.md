# Plan: Khắc phục ma sát UX danh sách & onboarding

**Dành cho:** Claude Fable 5  
**Repo:** ClientPro (vanilla JS PWA, zero build step)  
**Đọc trước:** `CLAUDE.md` (bắt buộc)  
**Base branch:** `main`  
**Version hiện tại:** `1.0.2` / `ASSET_V=ONBOARD_20260715`  
**Target sau khi xong:** bump semver đầy đủ → **`1.0.3`** + `ASSET_V` mới (vd `UXLIST_20260715`)

---

## 0. Mục tiêu & ràng buộc cứng

### Mục tiêu
Sửa 5 điểm khó chịu người dùng (không mở rộng scope sang auto-lock / Drive / backup đa kênh):

1. Tour sai chỗ (Cài đặt nói backup; spotlight tìm kiếm trỏ màn ẩn)
2. Tìm kiếm yếu (chỉ tên/SĐT/CCCD; không sort; không tìm ghi chú/TSBĐ/địa chỉ)
3. Chọn nhiều gần như bí mật (chỉ long-press)
4. Sau unlock nhấp nháy `Đang tải...` / `•••`
5. Thuật ngữ loạn (`đã vay` / `đã duyệt` / `thẩm định`; `HM` / `Trđ` / `TRĐ`)

### Ràng buộc — KHÔNG được phá
- Không đổi schema IndexedDB, không đổi field mã hóa, không đổi thuật toán crypto.
- Không bỏ `_looksEncrypted` / `_displayPlain` / `_displayPlainAsync` — **không bao giờ** render ciphertext.
- Không `await` WebCrypto/I/O giữa IndexedDB transaction.
- Không nới CSP, không thêm CDN, không inline handler mới nếu tránh được (giữ `data-action`).
- Không đụng `lockApp` / `AUTO_LOCK_HIDDEN_MS` / AuthGate / BackupCore / Drive GAS trong đợt này.
- Long-press chọn nhiều **vẫn giữ** (chỉ bổ sung nút “Chọn”, không thay thế).
- App vẫn chạy offline cho CRUD KH; search mở rộng chỉ dùng dữ liệu đã decrypt trong RAM/cache.
- Mọi thay đổi UI copy phải thống nhất tiếng Việt; không lẫn EN.

### Nguyên tắc an toàn dữ liệu
- Search trên field mã hóa: **chỉ** sau khi đã có plaintext qua cache/`decrypt*Async`. Không ghi plaintext mới vào IndexedDB.
- Nếu decrypt thất bại: bỏ qua field đó trong match, **không** fallback rỗng vào DB.
- Prime cache sau unlock chỉ nạp vào `__fieldPlainCache` / `__custSummaryCache` trong RAM — biến mất khi `lockApp`.

---

## 1. Workstream A — Sửa tour cho khớp Dashboard

**File chính:** `assets/17_onboarding_tour.js`  
**Phụ:** không cần đụng CSS trừ khi thêm step mới cần selector mới.

### Việc cần làm
1. Tăng `TOUR_VERSION` từ `3` → `4` (user cũ sẽ thấy tour lại một lần — chấp nhận được vì nội dung lệch).
2. **Xóa hoặc thay** bước `target: '#search-input'` (nằm trong `#screen-customer-list` đang `hidden` / `translate-x-full` → spotlight fallback center).
3. Thêm/sửa các bước chỉ spotlight phần tử **visible trên Dashboard** sau unlock:
   - Giữ: welcome, `#btn-quick-add`, `#btn-quick-map`, Drive config, sẵn sàng.
   - **Sửa bước Cài đặt** (`#btn-open-menu`): copy mới, **không** nói “sao lưu và khôi phục”.  
     Ví dụ: *“Đổi giao diện, bảo mật PIN / sinh trắc học và ủng hộ.”*
   - **Thêm bước** spotlight nút Sao lưu trên Dashboard:  
     `button[data-action="openBackupManager"]`  
     Title: `Sao lưu & khôi phục`  
     Content: *“Sao lưu dữ liệu lên Drive hoặc xuất file, và khôi phục khi cần.”*
   - **Thay bước tìm kiếm** bằng một trong hai (chọn A):
     - **A (khuyến nghị):** Spotlight ô “Khách hàng đang thẩm định” / “đã vay” + nói *“Mở danh sách rồi dùng ô tìm kiếm ở đầu danh sách.”*  
       Target: `button[data-action="openCustomerList"][data-arg="pending"]` (hoặc `approved`).
     - **B:** Bỏ hẳn bước tìm kiếm khỏi tour (ít hơn nhưng mất discoverability).
4. Cập nhật copy bước Drive: tránh “Link Script” thuần kỹ thuật nếu có thể — *“Cấu hình Google Drive để lưu ảnh hồ sơ của bạn.”* (không đổi chức năng `toggleDashboardDriveConfig`).
5. Đảm bảo `positionStep()` vẫn fallback an toàn nếu target thiếu; không mở màn list giữa tour (tránh side-effect navigation).

### Không làm
- Không tự `openCustomerList()` trong tour (phức tạp back-stack, dễ kẹt overlay z-index 1000).
- Không đổi z-index tour.

### Kiểm tra tay
- Máy mới / xóa `localStorage.clientpro_onboarding_done` → tour chạy, mọi spotlight khoanh đúng nút visible.
- Bước Cài đặt không còn nhắc backup.
- Có bước riêng cho “Sao lưu & khôi phục”.

---

## 2. Workstream B — Tìm kiếm + sort danh sách KH

**File chính:** `assets/05_customers.js` (`loadCustomers`, `_ensureSummaryDecrypted*`, `renderList`, `__custSummaryCache`)  
**Phụ UI:** `index.html` (toolbar `#search-input` + chỗ thêm sort), CSS tối thiểu trong `assets/css/app.patch.css` hoặc `redesign.clientpro.css` nếu cần.

### 2.1 Mở rộng search (giữ performance)

Hiện tại match chỉ:

```js
nameMatch / phoneMatch / cccdMatch
```

**Mở rộng plaintext sau decrypt (lazy, có cache):**

| Field | Nguồn | Chuẩn hóa |
|---|---|---|
| `notes` | customer encrypted field | `_normVi` |
| `creditLimit` | customer | `_stripSpaces` / chuỗi số |
| asset `name` | `c.assets[]` | `_normVi` |
| asset `onland` (địa chỉ/hiện trạng) | `c.assets[]` | `_normVi` |
| (tuỳ chọn nhẹ) asset `area` / `width` | số dạng chuỗi | `_stripSpaces` |

**Cách làm an toàn:**
1. Mở rộng `__custSummaryCache` entry: thêm `nNotes`, `nAssets` (chuỗi gộp đã `_normVi` của name+onland các TSBĐ), cập nhật `_custSig` để gồm notes + signature assets (dùng ciphertext/length/id — **không** plaintext trong sig nếu có thể; hoặc hash ciphertext fields).
2. Trong `_ensureSummaryDecryptedAsync`: sau khi decrypt summary hiện tại, nếu query cần sâu hơn **hoặc** luôn prime khi cache miss:
   - `notes = await decryptFieldAsync(c.notes)` (chỉ khi field tồn tại)
   - Với mỗi asset: decrypt `name`, `onland` (dùng `decryptFieldAsync`, không sync fail-open)
   - Build `c._nNotes`, `c._nAssetsBlob` rồi lưu cache `ok: true`
3. Trong `loadCustomers` khi `q` khác rỗng:

```js
const notesMatch = (c._nNotes || '').includes(qNorm);
const assetsMatch = (c._nAssetsBlob || '').includes(qNorm);
// giữ name/phone/cccd như cũ
if (!(nameMatch || phoneMatch || cccdMatch || notesMatch || assetsMatch)) continue;
```

4. Placeholder `#search-input`: đổi thành  
   `Tìm tên, SĐT, CCCD, ghi chú, TSBĐ...`
5. Empty-state message khi không khớp: cập nhật gợi ý từ khóa cho khớp khả năng mới.

**Performance:**
- Không decrypt toàn bộ DB trên mỗi keystroke nếu cache hit (`sig` khớp).
- Khi không có `q`, **không bắt buộc** decrypt notes/assets (giữ như hiện tại — chỉ summary name/phone/cccd lúc render).
- Khi có `q`: decrypt sâu per-customer như vòng lặp hiện tại (đã `await` từng cái) — OK; có thể `Promise.all` theo batch nhỏ nếu cần, nhưng giữ loadToken cancel.

### 2.2 Sort

Thêm sort đơn giản trên toolbar list (không multi-filter phức tạp):

- UI: nút/select cạnh search, vd `data-action="setCustomerSort"` với các giá trị:
  - `recent` (mặc định) — thứ tự như hiện tại (duyệt `all` từ cuối → đầu ≈ mới hơn nếu id/time tăng)
  - `name-asc` — A→Z theo `_nName`
  - `name-desc` — Z→A
  - `status` — pending trước hoặc approved trước (chọn một; khuyến nghị: trong tab `all`, pending trước để ưu tiên việc đang làm)

- State: biến module `customerListSort = 'recent'` (hoặc `sessionStorage` key nhẹ — **không** bắt buộc persist).
- Áp sort **sau** filter, **trước** `renderList`.
- Copy nhãn UI tiếng Việt: `Mới nhất` / `Tên A–Z` / `Tên Z–A`.

### Không làm
- Không full-text index riêng trong IndexedDB.
- Không tìm trong ảnh / driveLink.
- Không đổi API `openCustomerList`.

### Kiểm tra
- Tìm theo một phần ghi chú / tên TSBĐ / `onland` ra đúng KH.
- Gõ không dấu vẫn match (`_normVi`).
- Ciphertext không bao giờ hiện trong list khi search.
- Sort đổi thứ tự; search + sort kết hợp đúng.
- Debounce search hiện có (`10_bootstrap.js`) không bị phá.

---

## 3. Workstream C — Nút “Chọn” (discoverability)

**File:** `index.html` (toolbar `#screen-customer-list`), `assets/05_customers.js`, `assets/00_globals.js` (data-action map nếu thiếu).

### Việc cần làm
1. Thêm nút trên toolbar list (cạnh search hoặc hàng dưới title):

```html
<button type="button" data-action="toggleCustSelectionMode"
  id="btn-cust-select" ... aria-pressed="false">
  Chọn
</button>
```

2. `toggleCustSelectionMode` đã tồn tại — wire qua `data-action` (kiểm tra `00_globals.js` action map; bổ sung nếu thiếu giống các action khác).
3. Khi `isCustSelectionMode === true`:
   - Đổi nhãn nút → `Xong` (hoặc ẩn nút vì đã có X trên `cust-selection-bar` — khuyến nghị: đồng bộ label `Chọn` ↔ `Xong`).
   - `aria-pressed="true"`.
4. Giữ long-press như cũ (`bindLongPress` → `setCustSelectionMode(true, …)`).
5. Khi đóng list (`closeCustomerList`) đã `setCustSelectionMode(false)` — xác nhận vẫn chạy.
6. (Tuỳ chọn nhỏ) Toast lần đầu: *“Chạm từng hồ sơ để chọn, hoặc giữ lâu trên một hồ sơ.”* — chỉ nếu đã có pattern tip; **không bắt buộc**.

### Không làm
- Không đổi hành vi Gửi/Xóa / CloudTransfer.
- Không bắt buộc selection mode cho ảnh trong đợt này (scope KH list thôi), trừ khi copy/pattern sẵn sàng mirror 5 phút.

### Kiểm tra
- Bấm “Chọn” → hiện `cust-selection-bar`, card có select-ring.
- Bấm “Xong” / X trên bar → thoát mode, selection clear.
- Long-press vẫn vào mode.
- Edge-swipe back vẫn thoát selection layer nếu đang có history layer.

---

## 4. Workstream D — Giảm nhấp nháy `Đang tải...` / `•••` sau unlock

**File chính:** `assets/02_security.js` (`primeFieldCache`, `completeUnlockDataLoad`)  
**Phụ:** `assets/05_customers.js` (render fallback), có thể `06_assets.js` nếu cùng pattern trên list TSBĐ trong folder.

### Vấn đề gốc
- `primeFieldCache()` hiện **chỉ** prime token Drive sealed — comment ghi rõ field KH lazy.
- `completeUnlockDataLoad` gọi `loadCustomers` rồi mới tắt loader; nhưng render vẫn có thể paint `Đang tải...` rồi `_displayPlainAsync` cập nhật → nhấp nháy hạn mức `•••`.

### Hướng sửa (an toàn, không hạ bảo mật)

**Bước D1 — Prime summary cache trước lần `loadCustomers` đầu sau unlock**

Trong `completeUnlockDataLoad`, sau migrations + `primeFieldCache()` hiện tại:

1. Thêm `primeCustomerSummaryCache()` (đặt ở `05_customers.js` hoặc cạnh `primeFieldCache`):
   - `getAll` customers (readonly tx — **không** await crypto trong tx; đọc xong rồi mới decrypt).
   - `await Promise.all` decrypt summary (name/phone/cccd/creditLimit) + ghi `__custSummaryCache` / `__fieldPlainCache`.
   - Giới hạn concurrency nếu list rất lớn (vd batch 20) để không block UI quá lâu; loader unlock vẫn đang hiện nên UX chấp nhận thêm ~vài trăm ms.
2. Gọi prime **trước** `loadCustomers` trong `completeUnlockDataLoad`.
3. `loadCustomers` lúc đó cache hit → render plaintext ngay, không `Đang tải...`.

**Bước D2 — Fallback UI khi vẫn miss (hiếm)**
- Giữ placeholder nhưng thống nhất: dùng cùng một chuỗi (vd khoảng trống hẹp / skeleton CSS) thay vì xen kẽ `Đang tải...` và `•••` trên cùng card.
- **Không** hiện ciphertext; miss → placeholder trung tính (`—`) rồi async fill.

**Bước D3 — creditLimit**
- Đưa `creditLimit` vào `_ensureSummaryDecryptedAsync` + cache (`nLimit` / plain limit) để chip `HM` không còn `•••` sau unlock đã prime.

### Không làm
- Không persist plaintext ra `localStorage`.
- Không bỏ lazy decrypt cho màn chi tiết nặng (notes dài / ảnh) — chỉ prime **summary list fields**.
- Không gọi prime khi app đang khóa.

### Kiểm tra
- Unlock → list (nếu đang mở) hoặc mở list ngay: tên/SĐT/hạn mức hiện plaintext **không** flash `Đang tải...`/`•••` (trừ máy cực chậm / list rất lớn — lúc đó chỉ thấy loader unlock lâu hơn một chút).
- `lockApp` xóa cache như hiện tại; unlock lại vẫn đúng.
- Regression: migration vẫn chạy trước prime.

---

## 5. Workstream E — Thống nhất thuật ngữ & đơn vị

**Quy ước copy chuẩn (chốt một lần, áp mọi chỗ UI user-facing):**

| Khái niệm | Copy chuẩn | Không dùng nữa trên UI |
|---|---|---|
| Status `approved` | **Đã vay** | “Đã duyệt vay”, “Đã Duyệt”, “được duyệt” (trừ toast hành động duyệt) |
| Status `pending` | **Đang thẩm định** | “Thẩm định” đứng một mình trên chip nếu gây ngắn quá tối nghĩa — chip dùng đủ “Đang thẩm định” |
| Hạn mức tín dụng | **Hạn mức** (sau số ghi **triệu đồng** lần đầu trong modal) | `HM:` |
| Đơn vị tiền | **triệu đồng** đầy đủ trên label form; chỗ hẹp dùng **trđ** (một kiểu viết) | `TRĐ`, `Trđ`, `tr₫` lẫn lộn |

**Toast hành động** có thể giữ động từ: *“Đã duyệt khách hàng”* (verb) — khác với **nhãn trạng thái** “Đã vay”.

### File cần quét & sửa copy
- `index.html` — overview home (đã gần đúng: “Khách hàng đã vay” / “đang thẩm định”)
- `assets/05_customers.js` — `openCustomerList` title, KPI `Đã vay`/`Thẩm định`, `statusTone`, chip `HM:`, empty-state “được duyệt”
- `assets/03_map.js` — popup `Đã Duyệt` / `Thẩm định` → `Đã vay` / `Đang thẩm định`
- `assets/ui/modals/approve-modal.html` — placeholder `Nhập hạn mức (TRĐ)` → `Nhập hạn mức (triệu đồng)`
- `assets/ui/modals/asset-modal.html` — `Định giá (Trđ)` / `Vay Max (Trđ)` → `Định giá (triệu đồng)` / `Vay tối đa (triệu đồng)`
- `assets/06_assets.js` — `tr₫` trong chuỗi khoảng cách/giá → ` trđ` hoặc ` triệu` cho khớp

### Không làm
- Không đổi giá trị status trong DB (`approved` / `pending`).
- Không đổi ý nghĩa số (vẫn là triệu đồng như nghiệp vụ hiện tại).

---

## 6. Thứ tự triển khai đề xuất

Làm theo thứ tự để dễ review / rollback:

1. **E** (terminology) — diff copy thuần, rủi ro thấp  
2. **A** (tour) — độc lập  
3. **C** (nút Chọn) — độc lập  
4. **D** (prime cache) — đụng unlock path; test kỹ  
5. **B** (search + sort) — đụng list/cache; test kỹ sau D (vì dùng chung cache)

Commit nhỏ theo workstream; hoặc 1–2 commit rõ ràng nếu agent single-shot.

---

## 7. Version bump đầy đủ (bắt buộc trước khi coi là xong)

Sau khi code + test pass:

1. `package.json` → `"version": "1.0.3"`
2. `sw.js` → đổi `ASSET_V` sang token mới, vd `UXLIST_YYYYMMDD` (ngày làm việc thực tế)
3. Đồng bộ **mọi** `?v=` trong `index.html` (và `MAPLIBRE_V` nếu có) cho khớp `ASSET_V`
4. Chạy:

```bash
npm run sync:version
npm run check:version
```

5. Cập nhật `CLAUDE.md` bảng sự thật cốt lõi (semver + ASSET_V) nếu bảng đó liệt kê số cụ thể
6. Không đổi `CACHE_EPOCH` (`genesis`) trừ khi có lý do cache-bust epoch (không cần đợt này)

---

## 8. Checklist kiểm tra bắt buộc

```bash
npm test
npm run check:version
node --check sw.js
find assets -name '*.js' -print0 | xargs -0 -n1 node --check
npm run test:e2e
```

### Kiểm tra tay / e2e bổ sung nếu thiếu coverage
- [ ] Tour `TOUR_VERSION=4`: spotlight đúng nút Dashboard; Cài đặt không nói backup; có bước Sao lưu
- [ ] Search notes / tên TSBĐ / onland
- [ ] Sort A–Z hoạt động với search
- [ ] Nút Chọn ↔ selection bar ↔ long-press
- [ ] Unlock → mở list: không flash `Đang tải...`/`•••` trên tên & hạn mức (máy có vài hồ sơ mẫu)
- [ ] Copy status/đơn vị thống nhất home / list / map / modal
- [ ] Lock → unlock lại; CRUD thêm/sửa/xóa KH vẫn OK
- [ ] Offline: mở list + search trên data local vẫn được
- [ ] Không lộ ciphertext; không secret trong diff

### Regression đặc biệt
- `completeUnlockDataLoad` vẫn migration → prime → loadCustomers → `clientpro:unlocked`
- `setCustSelectionMode` + cloud send/delete không regress
- Empty states list vẫn đúng 3 nhánh (search / tab trống / chưa có KH)

---

## 9. Định nghĩa “xong”

- 5 workstream A–E đã merge hành vi đúng mô tả trên
- Version **1.0.3** + `ASSET_V` mới đồng bộ (`sync:version` + `check:version` xanh)
- `npm test` + `npm run test:e2e` xanh (hoặc e2e fail chỉ vì môi trường — ghi rõ; ưu tiên xanh)
- PR mô tả: liệt kê copy chuẩn status/đơn vị + ghi chú tour version 4
- **Không** kèm fix auto-lock / Drive GAS / backup merge copy trong PR này

---

## 10. Gợi ý prompt khởi động cho Fable 5

```
Đọc CLAUDE.md và PLAN_UX_FRICTION_FABLE5.md. Implement toàn bộ workstream A–E
theo đúng thứ tự §6, tôn trọng ràng buộc §0. Không đụng auto-lock/Drive/backup core.
Sau khi test pass, bump version đầy đủ lên 1.0.3 + ASSET_V mới theo §7.
Commit, push, cập nhật PR.
```

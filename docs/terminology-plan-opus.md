# Plan chuẩn hóa từ ngữ UI — cho Opus 4.8

> Agent thực thi: **Opus 4.8**. Scope: **chỉ chuỗi hiển thị cho người dùng**.  
> Không đổi tên hàm/biến/store/localStorage/CSP/logic bảo mật.  
> Tham chiếu glossary: `docs/terminology.md` (cập nhật kèm plan này).

---

## 0. Giải thích nhanh: “ảnh đã lên mây” là gì?

Đây **không** phải tính năng riêng. Là **copy slang** trong confirm sau khi upload ảnh lên Google Drive thành công, hỏi người dùng có xóa ảnh gốc trong máy không.

Vị trí thật trong code (`assets/07_drive.js`):

| Flow | Chuỗi hiện tại (sai chuẩn) |
|---|---|
| Upload ảnh **tài sản bảo đảm** | `TSBĐ đã lên mây thành công!…` / `ảnh ĐÃ lên mây khỏi máy…` |
| Upload ảnh **hồ sơ** | `Đã sao lưu ảnh thành công!…` / `ảnh ĐÃ lên mây khỏi App…` |

Cùng một hành động, chỗ khác đã viết đúng hơn: `Đã tải ảnh … lên Drive`, nút `Lên Drive`, confirm `Tải ảnh lên Drive`.  
→ **Chuẩn:** luôn dùng **Drive** / **tải lên Drive**. **Cấm** `lên mây`, `mây`, `Upload` (tiếng Anh) trong UI.

---

## 1. Quyết định đã chốt (không hỏi lại)

| # | Quyết định | Canonical |
|---|---|---|
| 1 | TSBĐ | UI dùng **tài sản bảo đảm**. Nút hẹp: **Thêm tài sản** / **Ảnh tài sản**. Không còn `TSBĐ` trong chuỗi UI. |
| 2 | Dashboard count | `Tổng hồ sơ` → **`Tổng khách hàng`** (aria-label tương ứng). |
| 3 | Cloud transfer người nhận | **`đồng nghiệp`**. Cấm `user` trong UI. |
| 4 | Cấu hình Drive | Label: **`Link kết nối Drive cá nhân`**. Placeholder mã: **`Dán mã bảo mật từ link kết nối`**. Giữ tên riêng **Google Drive**. |
| 5 | Nút upload ảnh | Giữ ngắn **`Lên Drive`** (Drive = tên riêng, đủ chỗ). Toast/confirm/loading: **`tải lên Drive`**. |
| 6 | Ảnh | Luôn **ảnh** / **ảnh hồ sơ** / **ảnh tài sản bảo đảm**. Cấm `chứng từ` cho ảnh. |
| 7 | File | Dùng **file** (không `Tệp`). |
| 8 | Tone | Lịch sự, ngắn, xưng `bạn`. Bỏ cảm thán/`nhé!` ở onboarding nếu dễ sửa. Donate: `anh/chị` → **`bạn`**. |
| 9 | Viết hoa | Chỉ viết hoa chữ đầu cụm + tên riêng (`Google Drive`, `Face ID`, `VietQR`). |

### Pattern toast / nút

- Toast OK: `Đã {động từ} {đối tượng}` — vd. `Đã tải ảnh lên Drive`, `Đã xóa ảnh gốc`.
- Nút tạo/sửa: `Tạo mới` / `Lưu thay đổi` / `Hủy`.
- Loading: `Đang tải ảnh lên Drive…` (không `Đang Upload…`).

---

## 2. Phạm vi & ngoài phạm vi

**Trong scope (sửa copy):**
- `index.html`
- `assets/ui/modals/*.html`
- Chuỗi UI trong: `05_customers.js`, `06_assets.js`, `07_drive.js`, `08_images_camera.js`, `09_backup_manager.js`, `09_donate.js`, `14_cloud_transfer.js`, `16_auto_backup_drive.js`, `02_security.js`, `15_auth_gate.js`, `17_onboarding_tour.js`, `18_biometric_unlock.js`
- Cập nhật `docs/terminology.md` nếu lệch plan

**Ngoài scope:**
- Tên hàm (`uploadToGoogleDrive`, `closeFolder`, …), ID DOM, `data-action`
- Comment kỹ thuật nội bộ (có thể để `TSBĐ` trong comment)
- `folderName` gửi lên Drive API: **được phép** đổi prefix hiển thị folder từ `TSBĐ:` → `Tài sản:` vì user thấy trên Drive — làm cùng PR
- Test assert logic (không đổi). Nếu e2e/assert **chuỗi UI** cũ → cập nhật cho khớp
- Không bump semver / `ASSET_V` trừ khi repo rule bắt buộc khi đụng `index.html` query (copy-only thường không cần)

---

## 3. Checklist theo file (before → after)

### 3.1 P0 — Drive / “lên mây” / Folder / Upload (`07_drive.js` + `index.html`)

| Before | After |
|---|---|
| `Lên Drive` (nút) | **giữ** `Lên Drive` |
| `Đang lấy ảnh TSBĐ...` | `Đang lấy ảnh tài sản…` |
| `Đang Upload TSBĐ...` | `Đang tải ảnh lên Drive…` |
| `Đang tìm TSBĐ...` | `Đang tìm thư mục tài sản…` |
| `Không thể đọc tên TSBĐ/khách hàng…` | `Không thể đọc tên tài sản/khách hàng…` |
| `Đã tải … ảnh TSBĐ lên Drive` | `Đã tải … ảnh tài sản lên Drive` |
| `TSBĐ đã lên mây thành công!\n\nXóa ảnh gốc…` | `Đã tải ảnh tài sản lên Drive.\n\nXóa ảnh gốc trong máy để giảm dung lượng?` |
| `Xóa N ảnh ĐÃ lên mây khỏi máy…` | `Xóa N ảnh đã tải lên Drive khỏi máy để giảm dung lượng?\n(…ảnh lỗi giữ nguyên)` |
| `Xóa N ảnh ĐÃ lên mây khỏi App…` | `Xóa N ảnh đã tải lên Drive khỏi ứng dụng…` |
| `Đã sao lưu ảnh thành công!\nXóa ảnh trong App…` | `Đã tải ảnh hồ sơ lên Drive.\nXóa ảnh gốc trong ứng dụng để giảm dung lượng?` |
| `Đã dọn dẹp ảnh TSBĐ` | `Đã xóa ảnh gốc của tài sản` |
| `Đã dọn dẹp bộ nhớ` | `Đã xóa ảnh gốc` |
| `Mở Folder Ảnh` | `Mở thư mục ảnh` |
| `Xem Folder TSBĐ` | `Xem thư mục tài sản` |
| `Đã kết nối lại folder TSBĐ!` | `Đã kết nối lại thư mục tài sản` |
| `Không tìm thấy folder: …` | `Không tìm thấy thư mục: …` |
| `Không tìm thấy folder nào khớp…` | `Không tìm thấy thư mục nào khớp…` |
| `Vào Dashboard → Cài đặt Google Drive…` | `Vào màn hình chính → Cài đặt Google Drive…` |
| `Link Script` / `Script cá nhân` (UI) | `Link kết nối Drive cá nhân` (theo ngữ cảnh) |
| `folderName = … - TSBĐ: …` | `… - Tài sản: …` |

Cũng đồng bộ toast hồ sơ: đang lẫn `Đã sao lưu ảnh hồ sơ lên Drive` vs `Đã tải ảnh…` → thống nhất **`Đã tải ảnh hồ sơ lên Drive`**.

### 3.2 P0 — KH / TSBĐ trên shell (`index.html`, `06_assets.js`, modals)

| Before | After |
|---|---|
| `Danh sách KH` | `Danh sách khách hàng` |
| `Tổng hồ sơ` / aria `Tổng số hồ sơ` | `Tổng khách hàng` / `Tổng số khách hàng` |
| `Thêm TSBĐ Mới` | `Thêm tài sản` |
| `Chi tiết TSBĐ` | `Chi tiết tài sản` |
| Modal title `Thêm TSBĐ` / `Cập nhật TSBĐ` | `Thêm tài sản bảo đảm` / `Cập nhật tài sản bảo đảm` |
| Empty: `Bấm "Thêm TSBĐ Mới"…` | `Bấm "Thêm tài sản"…` |
| `Kho Ảnh TSBĐ` | `Kho ảnh tài sản` |
| Card label `ĐG:` | `Định giá:` |

Nút lưu tài sản: HTML mặc định `Lưu` → khi create/edit JS đã có `Thêm mới`/`Lưu thay đổi` — đổi `Thêm mới` → **`Tạo mới`** cho khớp khách hàng.

### 3.3 P0 — Cloud transfer `user` (`14_cloud_transfer.js`)

| Before | After |
|---|---|
| `Không lấy được danh sách user` | `Không lấy được danh sách đồng nghiệp` |
| `Không có user nào khác…` | `Không có đồng nghiệp nào khác…` |
| `Chọn user để gửi` | `Chọn đồng nghiệp để gửi` |
| `Chỉ user được cấp quyền…` | `Chỉ đồng nghiệp được cấp quyền mới nhận và khôi phục được.` |
| `Gửi backup này cho user:` | `Gửi bản sao lưu này cho đồng nghiệp:` |
| `Gửi gói dữ liệu này cho user:` | `Gửi gói dữ liệu này cho đồng nghiệp:` |
| `Tệp:` | `File:` |
| fallback tên `'user'` trong toast | `'đồng nghiệp'` |
| `Nhận từ user` (nếu còn) | `Nhận từ đồng nghiệp` |
| Mọi `restore` lộ UI | `khôi phục` |

### 3.4 P0 — Kích hoạt / App / Dashboard (`activation-modal.html`, `02_security.js`, `16_auto_backup_drive.js`)

| Before | After |
|---|---|
| `Kích hoạt Thiết bị` | `Kích hoạt thiết bị` |
| `Mã kích hoạt (Key)` | `Mã kích hoạt` |
| `Nhập Mã Key...` | `Nhập mã kích hoạt...` |
| `mở lại App` | `mở lại ứng dụng` |
| `Sẵn sàng sao lưu khi app đã mở khóa` | `…khi ứng dụng đã mở khóa` |
| `Mở Dashboard → "Cài đặt Google Drive"…` (error string) | `màn hình chính → …` |
| `Tải backup lên Drive thất bại` | `Tải bản sao lưu lên Drive thất bại` |
| `danh sách backup trên Drive` (nếu lộ UI) | `danh sách bản sao lưu trên Drive` |

### 3.5 P1 — Khách / hồ sơ / nút lưu (`05_customers.js`, `add-modal.html`)

Giữ phân biệt:
- Entity / list / count: **khách hàng**
- Thao tác trên bản ghi: **hồ sơ** (`Khởi tạo hồ sơ`, `Chỉnh sửa hồ sơ`, `Đã tạo hồ sơ`, `Xóa hồ sơ`)

Đổi cho đồng nút:
- `btn-save-cust` create: `Tạo mới` (đã có)
- edit: `Cập nhật` → **`Lưu thay đổi`**
- HTML mặc định `Lưu hồ sơ` → **`Tạo mới`** (trùng create)

### 3.6 P1 — Ảnh / chứng từ (`08_images_camera.js`)

| Before | After |
|---|---|
| `Hủy chứng từ này?` | `Xóa ảnh này?` |
| title `Xóa chứng từ` | `Xóa ảnh` |
| `Xóa chứng từ thất bại…` | `Xóa ảnh thất bại…` |

### 3.7 P1 — Cấu hình Drive trên dashboard (`index.html`)

| Before | After |
|---|---|
| `Link Script cá nhân` | `Link kết nối Drive cá nhân` |
| `Dán token từ Script cá nhân` | `Dán mã bảo mật từ link kết nối` |
| Warning `Mã bảo mật của Script cá nhân` | `Mã bảo mật của link kết nối Drive` |

### 3.8 P2 — Tone (`17_onboarding_tour.js`, `donate-modal.html`)

| Before | After |
|---|---|
| `…Cùng xem nhanh các tính năng chính nhé!` | `…Cùng xem nhanh các tính năng chính.` |
| `Nếu ClientPro giúp anh/chị…` | `Nếu ClientPro giúp bạn…` |

Loading kỹ thuật trong backup (tuỳ chỉnh nhẹ nếu chạm file):
- `Đóng gói (Bảo mật)...` → `Đang mã hóa bản sao lưu…`
- `Đồng bộ...` → `Đang khôi phục…`

### 3.9 Loading / empty còn sót — quét cuối

Sau khi sửa theo bảng, chạy:

```bash
rg -n 'TSBĐ|Danh sách KH|lên mây|Folder|Upload |Dashboard|\\bApp\\b|\\buser\\b|Mã Key|\\(Key\\)|chứng từ|token từ|Link Script|Tệp:' \
  index.html assets/ui assets/*.js --glob '!assets/vendor/**'
```

Loại trừ false-positive: comment, tên hàm, `userAgent`, `USER_SCRIPT_KEY`, class CSS. Mọi **chuỗi UI** còn lại phải sạch.

---

## 4. Thứ tự thực thi (Opus)

1. Đọc `CLAUDE.md` + `docs/terminology.md` + plan này.
2. Tạo branch `cursor/terminology-normalize-9dc1` từ `main` (hoặc nhánh base hiện tại).
3. Sửa **P0 Drive/lên mây** (`07_drive.js`, nút/status liên quan) trước — đây là điểm user vừa hỏi.
4. Sửa P0 còn lại (KH/TSBĐ shell, cloud transfer, activation).
5. Sửa P1 (hồ sơ/nút lưu, chứng từ, label Drive config).
6. Sửa P2 (tone).
7. Quét `rg` như §3.9; sửa sót.
8. Cập nhật `docs/terminology.md`: đánh dấu status **applied**, bỏ “quyết định còn mở”.
9. Chạy kiểm tra:
   ```bash
   npm test
   node --check sw.js
   find assets -name '*.js' -print0 | xargs -0 -n1 node --check
   npm run check:version
   ```
   E2E nếu môi trường sẵn: `npm run test:e2e` (ưu tiên smoke/crud nếu full nặng).
10. Commit message rõ: `copy: chuẩn hóa từ ngữ UI (bỏ lên mây/TSBĐ/user/Folder…)`.
11. Push + mở/cập nhật PR; mô tả liệt kê nhóm P0–P2 đã làm.

---

## 5. Acceptance criteria

- [ ] Không còn `lên mây` / `mây` trong chuỗi UI.
- [ ] Không còn `TSBĐ` / `Danh sách KH` trong chuỗi UI.
- [ ] Không còn `user`/`Folder`/`Upload`/`Dashboard`/`App`/`Mã Key`/`token` trong copy người dùng (trừ tên riêng Google Drive / Face ID / VietQR và URL `script.google.com` trong message validation).
- [ ] Upload ảnh: confirm dọn máy dùng `đã tải lên Drive` + `ứng dụng`/`máy`, không slang.
- [ ] Toast upload tài sản vs hồ sơ cùng pattern `Đã tải ảnh … lên Drive`.
- [ ] `npm test` + `node --check` pass.
- [ ] Không đụng logic mã hóa / IndexedDB / mutex restore.

---

## 6. Rủi ro cần tránh

- Đừng `replace_all` mù `user` → sẽ phá `userAgent`, `list_users`, biến JS.
- Đừng đổi `closeFolder` / id `screen-folder` / class.
- Đừng Việt hóa tên riêng: Google Drive, Face ID, VietQR, CCCD.
- Folder name trên Drive đổi `TSBĐ:` → `Tài sản:` có thể làm **“Tìm kết nối cũ”** khó khớp folder cũ đặt tên `TSBĐ:`.  
  **Bắt buộc:** khi search (`reconnectAssetDriveFolder` / `reconnectDriveFolder`), thử **cả hai** pattern tên (`Tài sản:` và legacy `TSBĐ:`) nếu logic đang build một `folderName` duy nhất.

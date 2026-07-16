# Plan chuẩn hóa từ ngữ UI — Opus 4.8 (copy-paste replacements)

> **Cách làm:** chỉ mở đúng file trong bảng dưới, tìm `OLD` (chuỗi khớp exact), thay bằng `NEW`.  
> **Không** cần đọc toàn bộ module để hiểu nghiệp vụ.  
> **Không** đổi tên hàm/biến/id DOM/`data-action`/comment kỹ thuật (trừ khi bảng bảo sửa).  
> `×N` = số lần xuất hiện trong file; dùng replace_all **chỉ** khi ghi `×N` và OLD không đụng code khác.

Branch đề xuất: `cursor/terminology-normalize-9dc1`  
Glossary: `docs/terminology.md`

---

## Quy tắc an toàn

1. Chỉ sửa **chuỗi UI** trong bảng. Không `replace_all` từ ngắn như `user`, `App`, `Folder`, `TSBĐ` toàn file.
2. Bỏ qua comment `// ...` trừ khi bảng chỉ rõ.
3. Giữ nguyên: `Google Drive`, `Face ID`, `VietQR`, `CCCD`, URL `script.google.com`.
4. Nút ngắn `Lên Drive` **giữ nguyên** (không đổi).
5. Sau khi sửa xong chạy checklist §Verify.

---

## FILE 1 — `index.html` (7 chỗ)

| Dòng ~ | OLD (exact) | NEW |
|---:|---|---|
| 231 | `aria-label="Tổng số hồ sơ"` | `aria-label="Tổng số khách hàng"` |
| 234 | `<span>Tổng hồ sơ</span>` | `<span>Tổng khách hàng</span>` |
| 277 | `Link Script cá nhân` | `Link kết nối Drive cá nhân` |
| 283 | `Dán token từ Script cá nhân` | `Dán mã bảo mật từ link kết nối` |
| 303 | `Danh sách KH` | `Danh sách khách hàng` |
| 497 | `Thêm TSBĐ Mới` | `Thêm tài sản` |
| 511 | `Chi tiết TSBĐ` | `Chi tiết tài sản` |

Không đụng: nút `Lên Drive` (L478, L535), id `dashboard-*`, class CSS.

---

## FILE 2 — `assets/ui/modals/add-modal.html` (1 chỗ)

| Dòng ~ | OLD | NEW |
|---:|---|---|
| 24 | `>Lưu hồ sơ</button>` | `>Tạo mới</button>` |

---

## FILE 3 — `assets/ui/modals/asset-modal.html` (1 chỗ)

| Dòng ~ | OLD | NEW |
|---:|---|---|
| 4 | `>Thêm TSBĐ</span>` | `>Thêm tài sản bảo đảm</span>` |

(Nút HTML `Lưu` giữ; JS sẽ đổi nhãn khi mở modal.)

---

## FILE 4 — `assets/ui/modals/activation-modal.html` (3 chỗ)

| Dòng ~ | OLD | NEW |
|---:|---|---|
| 3 | `Kích hoạt Thiết bị` | `Kích hoạt thiết bị` |
| 6 | `Mã kích hoạt (Key)` | `Mã kích hoạt` |
| 7 | `Nhập Mã Key...` | `Nhập mã kích hoạt...` |

---

## FILE 5 — `assets/ui/modals/backup-manager-modal.html` (1 chỗ)

| Dòng ~ | OLD | NEW |
|---:|---|---|
| 28 | `Sẵn sàng sao lưu khi app đã mở khóa.` | `Sẵn sàng sao lưu khi ứng dụng đã mở khóa.` |

---

## FILE 6 — `assets/ui/modals/donate-modal.html` (2 chỗ)

| Dòng ~ | OLD | NEW |
|---:|---|---|
| 15 | `Nếu ClientPro giúp anh/chị tối ưu công việc` | `Nếu ClientPro giúp bạn tối ưu công việc` |
| 45 | `Mở app ngân hàng` | `Mở ứng dụng ngân hàng` |

---

## FILE 7 — `assets/05_customers.js` (3 chỗ)

| Dòng ~ | OLD | NEW |
|---:|---|---|
| 200 | `'KH đang thẩm định'` | `'Khách hàng đang thẩm định'` |
| 652 | `<p>Tổng hồ sơ</p>` | `<p>Tổng khách hàng</p>` |
| 854 | `getEl('btn-save-cust').textContent = "Cập nhật"` | `getEl('btn-save-cust').textContent = "Lưu thay đổi"` |

Giữ nguyên: `"Khởi tạo hồ sơ"`, `"Chỉnh sửa hồ sơ"`, `"Tạo mới"`, toast `Đã tạo/cập nhật/xóa hồ sơ`.

---

## FILE 8 — `assets/06_assets.js` (6 chỗ)

| Dòng ~ | OLD | NEW |
|---:|---|---|
| 249 | `Bấm "Thêm TSBĐ Mới" bên dưới để tạo tài sản đầu tiên cho khách hàng này.` | `Bấm "Thêm tài sản" bên dưới để tạo tài sản đầu tiên cho khách hàng này.` |
| 301 | `>ĐG: <b` | `>Định giá: <b` |
| 301 | `Kho Ảnh TSBĐ` | `Kho ảnh tài sản` |
| 347 | `getEl("modal-title-asset").textContent = "Thêm TSBĐ"` | `getEl("modal-title-asset").textContent = "Thêm tài sản bảo đảm"` |
| 348 | `getEl("btn-save-asset").textContent = "Thêm mới"` | `getEl("btn-save-asset").textContent = "Tạo mới"` |
| 368 | `getEl("modal-title-asset").textContent = "Cập nhật TSBĐ"` | `getEl("modal-title-asset").textContent = "Cập nhật tài sản bảo đảm"` |

Giữ: toast `Đã lưu tài sản bảo đảm`. Comment có `TSBĐ` → **không sửa**.

---

## FILE 9 — `assets/07_drive.js` (ưu tiên — gồm “lên mây”)

### 9A. Thay chuỗi UI (làm lần lượt; `×N` = replace_all trong file này)

| Dòng ~ | × | OLD | NEW |
|---:|---:|---|---|
| 128 | 1 | `Link Script không đúng định dạng` | `Link kết nối Drive không đúng định dạng` |
| 134 | 1 | `Vui lòng nhập Mã bảo mật của Script cá nhân!` | `Vui lòng nhập mã bảo mật của link kết nối Drive!` |
| 258 | 1 | `Mở Folder Ảnh` | `Mở thư mục ảnh` |
| 289,449,606 | **3** | `Vào Dashboard → Cài đặt Google Drive để nhập Link Script của bạn.` | `Vào màn hình chính → Cài đặt Google Drive để nhập link kết nối Drive của bạn.` |
| 303 | 1 | `Đang lấy ảnh TSBĐ...` | `Đang lấy ảnh tài sản…` |
| 331 | 1 | `Không thể đọc tên TSBĐ/khách hàng (dữ liệu chưa giải mã được). Vui lòng thử lại.` | `Không thể đọc tên tài sản/khách hàng (dữ liệu chưa giải mã được). Vui lòng thử lại.` |
| 339 | 1 | `Đang Upload TSBĐ...` | `Đang tải ảnh lên Drive…` |
| 343,485 | **2** | `` `${custNamePlain} - TSBĐ: ${assetNamePlain}` `` | `` `${custNamePlain} - Tài sản: ${assetNamePlain}` `` |
| 391 | 1 | `` `Đã tải ${succeededImgs.length}/${imagesToUpload.length} ảnh TSBĐ lên Drive — ${split.failedCount} ảnh lỗi vẫn còn trong máy, hãy thử tải lại sau.` `` | `` `Đã tải ${succeededImgs.length}/${imagesToUpload.length} ảnh tài sản lên Drive — ${split.failedCount} ảnh lỗi vẫn còn trong máy, hãy thử tải lại sau.` `` |
| 393 | 1 | `Đã tải ảnh TSBĐ lên Drive` | `Đã tải ảnh tài sản lên Drive` |
| 398 | 1 | `` `Xóa ${succeededImgs.length} ảnh ĐÃ lên mây khỏi máy để nhẹ bộ nhớ?\n(${split.failedCount} ảnh lỗi sẽ được giữ nguyên)` `` | `` `Xóa ${succeededImgs.length} ảnh đã tải lên Drive khỏi máy để giảm dung lượng?\n(${split.failedCount} ảnh lỗi sẽ được giữ nguyên)` `` |
| 399 | 1 | `"TSBĐ đã lên mây thành công!\n\nXóa ảnh gốc trong máy để nhẹ bộ nhớ?"` | `"Đã tải ảnh tài sản lên Drive.\n\nXóa ảnh gốc trong máy để giảm dung lượng?"` |
| 403 | 1 | `Đã dọn dẹp ảnh TSBĐ` | `Đã xóa ảnh gốc của tài sản` |
| 412,724 | **2** | `kiểm tra kết nối và Script cá nhân` | `kiểm tra kết nối và link kết nối Drive` |
| 431 | 1 | `Xem Folder TSBĐ` | `Xem thư mục tài sản` |
| 457 | 1 | `Đang tìm TSBĐ...` | `Đang tìm thư mục tài sản…` |
| 481 | 1 | `Không thể đọc tên TSBĐ/khách hàng (dữ liệu chưa giải mã được). Vui lòng thử lại sau khi mở khóa.` | `Không thể đọc tên tài sản/khách hàng (dữ liệu chưa giải mã được). Vui lòng thử lại sau khi mở khóa.` |
| 512 | 1 | `Đã kết nối lại folder TSBĐ!` | `Đã kết nối lại thư mục tài sản` |
| 516 | 1 | (nếu còn) `Đang tìm TSBĐ...` | `Đang tìm thư mục tài sản…` |
| 523 | 1 | `Tìm thấy folder nhưng CHƯA lưu được link vào hồ sơ` | `Tìm thấy thư mục nhưng CHƯA lưu được link vào hồ sơ` |
| 529 | 1 | `Không tìm thấy folder: ` | `Không tìm thấy thư mục: ` |
| 533 | 1 | `Không kết nối được tới Script cá nhân` | `Không kết nối được tới link kết nối Drive` |
| 541 | 1 | `Chưa cấu hình Script! Vào Dashboard → Cài đặt Google Drive ngay?` | `Chưa cấu hình Drive! Vào màn hình chính → Cài đặt Google Drive ngay?` |
| 595 | 1 | `Không tìm thấy folder nào khớp` | `Không tìm thấy thư mục nào khớp` |
| 704 | 1 | `` `Đã sao lưu ${succeededImgs.length}/${imagesToUpload.length} ảnh hồ sơ` `` | `` `Đã tải ${succeededImgs.length}/${imagesToUpload.length} ảnh hồ sơ` `` |
| 706 | 1 | `Đã sao lưu ảnh hồ sơ lên Drive` | `Đã tải ảnh hồ sơ lên Drive` |
| 711 | 1 | `` `Xóa ${succeededImgs.length} ảnh ĐÃ lên mây khỏi App để giải phóng bộ nhớ?\n(${split.failedCount} ảnh lỗi sẽ được giữ nguyên)` `` | `` `Xóa ${succeededImgs.length} ảnh đã tải lên Drive khỏi ứng dụng để giảm dung lượng?\n(${split.failedCount} ảnh lỗi sẽ được giữ nguyên)` `` |
| 712 | 1 | `"Đã sao lưu ảnh thành công!\nXóa ảnh trong App để giải phóng bộ nhớ?"` | `"Đã tải ảnh hồ sơ lên Drive.\nXóa ảnh gốc trong ứng dụng để giảm dung lượng?"` |
| 716 | 1 | `Đã dọn dẹp bộ nhớ` | `Đã xóa ảnh gốc` |

### 9B. Logic bắt buộc — search folder legacy `TSBĐ:` (chỉ trong `reconnectAssetDriveFolder`)

Sau khi đổi `folderName` sang `Tài sản:`, **phải** thử thêm tên legacy khi search, nếu không “Tìm kết nối cũ” gãy với folder cũ trên Drive.

Trong `reconnectAssetDriveFolder` (~L485–L493), **thay khối** đang search 1 `folderName` bằng logic tương đương:

```js
const folderNames = [
  `${custNamePlain} - Tài sản: ${assetNamePlain}`,
  `${custNamePlain} - TSBĐ: ${assetNamePlain}`, // legacy
];
let result = null;
for (const folderName of folderNames) {
  const response = await fetch(userUrl, {
    method: "POST",
    body: JSON.stringify({ action: 'search', folderName, token: getUserToken() })
  });
  const json = await response.json();
  if (json && json.status === 'found') { result = json; break; }
}
if (!result || result.status !== 'found') {
  // giữ nhánh "không tìm thấy" hiện có (dùng folderNames[0] trong message)
}
```

Giữ nguyên phần persist `driveLink` / `renderAssetDriveStatus` sau khi `found`.  
**Không** đổi tên hàm `reconnectAssetDriveFolder` / `reconnectDriveFolder`.

Upload mới (`uploadAssetToDrive`) chỉ tạo folder với `Tài sản:` — đúng.

---

## FILE 10 — `assets/08_images_camera.js` (3 chỗ, cùng vùng L797–814)

| Dòng ~ | OLD | NEW |
|---:|---|---|
| 797 | `Hủy chứng từ này?` | `Xóa ảnh này?` |
| 797 | `title: "Xóa chứng từ"` | `title: "Xóa ảnh"` |
| 814 | `Xóa chứng từ thất bại` | `Xóa ảnh thất bại` |

---

## FILE 11 — `assets/14_cloud_transfer.js` (chuỗi UI “user”)

| Dòng ~ | × | OLD | NEW |
|---:|---:|---|---|
| 183 | 1 | `Không lấy được danh sách user` | `Không lấy được danh sách đồng nghiệp` |
| 233 | 1 | `Không có user nào khác trong hệ thống.` | `Không có đồng nghiệp nào khác trong hệ thống.` |
| 244 | 1 | `Chọn user để gửi` | `Chọn đồng nghiệp để gửi` |
| 245 | 1 | `Chỉ user được cấp quyền mới nhận và restore được.` | `Chỉ đồng nghiệp được cấp quyền mới nhận và khôi phục được.` |
| 532,614 | **2** | `\|\| 'User'` | `\|\| 'Đồng nghiệp'` |
| 619,645 | **2** | `\|\| 'user'` | `\|\| 'đồng nghiệp'` |
| 660 | 1 | `['Tệp: '` | `['File: '` |
| 845 | 1 | `Gửi backup này cho user:` | `Gửi bản sao lưu này cho đồng nghiệp:` |
| 893 | 1 | `Gửi gói dữ liệu này cho user:` | `Gửi gói dữ liệu này cho đồng nghiệp:` |
| 893 | 1 | `\n\nTệp: ` | `\n\nFile: ` |

**Cấm** replace `user` toàn file (sẽ phá `userAgent`, `list_users`, biến `_users`, cache key…).

---

## FILE 12 — `assets/02_security.js` (1 chỗ)

| Dòng ~ | OLD | NEW |
|---:|---|---|
| 1207 | `mở lại App.` | `mở lại ứng dụng.` |

(Chỉ substring trong chuỗi `ErrorHandler.showError` đó.)

---

## FILE 13 — `assets/09_backup_manager.js` (3 chỗ)

| Dòng ~ | × | OLD | NEW |
|---:|---:|---|---|
| 307 | 1 | `"Đóng gói (Bảo mật)..."` | `"Đang mã hóa bản sao lưu…"` |
| 217,399 | **2** | `"Đồng bộ..."` | `"Đang khôi phục…"` |

---

## FILE 14 — `assets/16_auto_backup_drive.js` (3 chỗ)

| Dòng ~ | OLD | NEW |
|---:|---|---|
| 283 | `Tải backup lên Drive thất bại. Vui lòng thử lại.` | `Tải bản sao lưu lên Drive thất bại. Vui lòng thử lại.` |
| 366 | `Mở Dashboard → "Cài đặt Google Drive" để nhập Link Script và Mã bảo mật.` | `Vào màn hình chính → "Cài đặt Google Drive" để nhập link kết nối và mã bảo mật.` |
| 378 | `Không lấy được danh sách backup trên Drive.` | `Không lấy được danh sách bản sao lưu trên Drive.` |

---

## FILE 15 — `assets/17_onboarding_tour.js` (1 chỗ)

| Dòng ~ | OLD | NEW |
|---:|---|---|
| 20 | `Cùng xem nhanh các tính năng chính nhé!` | `Cùng xem nhanh các tính năng chính.` |

---

## FILE 16 — `docs/terminology.md`

Đổi trạng thái đầu file thành: **applied** (sau khi copy đã sửa).  
Không cần đọc code app.

---

## Không sửa các file sau (trừ khi verify bắt buộc)

| File | Lý do |
|---|---|
| `assets/00_globals.js`, `03_map.js`, `04_ui_common.js`, `10–13`, `15`, `18`, `19`, `pwa.js`, `head.js` | Không có chuỗi UI trong bảng (chỉ comment/`userAgent`/id) |
| `assets/vendor/**` | Third-party |
| `gas/**`, `sw.js`, `tests/**` | Ngoài scope copy UI; chỉ sửa test nếu assert đúng chuỗi UI cũ bị fail |
| Comment HTML `guide-modal.html` có chữ TSBĐ | Comment, không hiện UI |

---

## Thứ tự commit gợi ý

1. Commit 1: FILE 9 (`07_drive.js`) — “lên mây” + Drive copy + legacy search  
2. Commit 2: FILE 1–8, 10 (shell + modals + KH/TSBĐ/ảnh)  
3. Commit 3: FILE 11–15 (transfer, security, backup loading, onboarding)  
4. Commit 4: docs status + verify

Hoặc 1 commit duy nhất cũng được nếu diff gọn.

---

## §Verify (bắt buộc trước khi coi xong)

```bash
# 1) Không còn slang / viết tắt UI
rg -n 'lên mây|TSBĐ|Danh sách KH|Mở Folder|Xem Folder|Đang Upload|Mã Key|\(Key\)|chứng từ|Chọn user|cho user:|danh sách user|user nào khác|Link Script|token từ Script|anh/chị|Tổng hồ sơ|KH đang thẩm định' \
  index.html assets/ui assets/05_customers.js assets/06_assets.js assets/07_drive.js \
  assets/08_images_camera.js assets/14_cloud_transfer.js assets/02_security.js \
  assets/09_backup_manager.js assets/16_auto_backup_drive.js assets/17_onboarding_tour.js

# 2) Syntax + unit
npm test
node --check sw.js
find assets -name '*.js' -print0 | xargs -0 -n1 node --check
npm run check:version
```

**Pass khi:**
- Lệnh `rg` ở (1) **không** còn hit trong chuỗi UI (comment/`userAgent`/tên hàm thì bỏ qua bằng mắt).
- `reconnectAssetDriveFolder` search được cả `Tài sản:` và legacy `TSBĐ:`.
- Unit/syntax xanh.

---

## Acceptance (checklist PR)

- [ ] Không còn `lên mây` trong UI
- [ ] Không còn `TSBĐ` / `Danh sách KH` / `KH đang thẩm định` trong UI
- [ ] Không còn `user`/`Folder`/`Upload`/`Dashboard`/`App`/`Key`/`token` trong **copy người dùng** (trừ tên riêng + URL)
- [ ] Confirm dọn ảnh dùng `đã tải lên Drive` + `ứng dụng`/`máy`
- [ ] Legacy folder search còn hoạt động
- [ ] Không đổi logic mã hóa / IndexedDB / mutex

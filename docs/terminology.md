# Chuẩn từ ngữ UI — ClientPro

> Tài liệu glossary và inventory bất nhất. Chỉ áp dụng cho **chuỗi hiển thị cho người dùng**
> (nhãn, nút, toast, confirm, empty state, placeholder, aria-label). Không đổi tên biến /
> hàm / store IndexedDB / localStorage key.

**Trạng thái:** audit + plan sẵn sàng thực thi (`docs/terminology-plan-opus.md`).  
**Giọng điệu mục tiêu:** lịch sự, ngắn, ít cảm thán; xưng `bạn`; tránh tiếng Anh kỹ thuật / slang trong UI.

### Phát hiện bổ sung: “ảnh đã lên mây”

Không phải tính năng riêng — là **slang** trong confirm dọn ảnh sau upload Google Drive
(`assets/07_drive.js`: `TSBĐ đã lên mây thành công`, `ảnh ĐÃ lên mây khỏi máy/App`).
Chuẩn: **đã tải lên Drive**. Cấm `lên mây`.

---

## 1. Glossary chuẩn (canonical)

| Khái niệm | Dùng | Không dùng trong UI |
|---|---|---|
| Entity khách | **khách hàng** | `KH`, `user` (khi chỉ khách) |
| Bản ghi khách | **hồ sơ khách hàng** (hoặc **hồ sơ** khi đã rõ ngữ cảnh) | lẫn `khách hàng`/`hồ sơ` cùng một nhãn |
| Tài sản | **tài sản bảo đảm** | `TSBĐ` (trừ chỗ cực hẹp + đã giải thích) |
| Sao lưu | **sao lưu**, **bản sao lưu**, **file sao lưu** | `backup`, `Backup`, `Drive backup` |
| Khôi phục | **khôi phục**, **nhận và khôi phục** (inbox) | `restore`, `Restore` |
| Người nhận transfer | **đồng nghiệp** / **người nhận** | `user`, `User` |
| Dịch vụ Drive | **Google Drive** (lần đầu trong ngữ cảnh); **Drive** khi đã rõ | `Folder`, `Upload` (dùng **thư mục**, **tải lên**) |
| Script Drive | **link Apps Script cá nhân** | `Link Script`, `Script` đơn độc |
| Mã bảo mật Drive | **mã bảo mật** | `token`, `Token` trong placeholder |
| PIN | **mã PIN** | `PIN` đơn độc ở đầu câu dài; không gọi là mật khẩu |
| Kích hoạt | **mã kích hoạt** | `Mã Key`, `(Key)` |
| Ứng dụng | **ứng dụng** | `App` trong câu tiếng Việt |
| Màn chính | **màn hình chính** | `Dashboard` trong câu tiếng Việt |
| Ảnh | **ảnh** (hồ sơ / tài sản bảo đảm) | `chứng từ` (trừ khi nghiệp vụ thật sự cần) |
| File | **file** (giữ thống nhất với `.cpb`) | lẫn `Tệp` / `file` cùng flow |
| Xóa | **xóa** / **xóa vĩnh viễn** (destructive) | `xoá`, `Hủy chứng từ` cho ảnh |
| Khóa | **khóa** / **mở khóa** | `khoá` / `mở khoá` |

### Mẫu nút theo trạng thái

| Hành động | Nhãn chuẩn |
|---|---|
| Tạo mới | `Tạo mới` |
| Lưu chỉnh sửa | `Lưu thay đổi` |
| Hủy | `Hủy` |
| Xác nhận | `Xác nhận` |
| Xóa | `Xóa` / `Xóa vĩnh viễn` (khi không hoàn tác) |
| Khôi phục | `Khôi phục` |
| Tải lên Drive | `Tải lên` |

### Toast thành công

Pattern: `Đã {động từ} {đối tượng}` — ví dụ `Đã lưu khách hàng`, `Đã xóa tài sản bảo đảm`, `Đã khôi phục dữ liệu`.

---

## 2. Inventory bất nhất (cần chuẩn hóa)

### P0 — Rút gọn / tiếng Anh lộ ra UI

| Hiện tại | Đề xuất | File chính |
|---|---|---|
| `Danh sách KH` | `Danh sách khách hàng` | `index.html` |
| `Thêm TSBĐ Mới`, `Chi tiết TSBĐ`, `Thêm TSBĐ`, `Cập nhật TSBĐ`, `Kho Ảnh TSBĐ` | dùng đủ `tài sản bảo đảm` / `ảnh tài sản bảo đảm` | `index.html`, `asset-modal.html`, `06_assets.js`, `08_images_camera.js` |
| `Đang Upload TSBĐ...`, `ảnh TSBĐ`, `folder TSBĐ`, `Xem Folder TSBĐ`, `Mở Folder Ảnh` | `Đang tải lên…`, `ảnh tài sản bảo đảm`, `thư mục…` | `07_drive.js` |
| `Vào Dashboard → …`, `mở lại App` | `màn hình chính`, `ứng dụng` | `07_drive.js`, `02_security.js` |
| `Chọn user để gửi`, `Không có user nào khác`, `gửi … cho user` | `đồng nghiệp` / `người nhận` | `14_cloud_transfer.js` |
| `Mã kích hoạt (Key)`, `Nhập Mã Key...` | `Mã kích hoạt`, `Nhập mã kích hoạt...` | `activation-modal.html` |
| placeholder `Dán token từ Script cá nhân` | `Dán mã bảo mật từ Apps Script cá nhân` | `index.html` |
| `Link Script cá nhân` | `Link Apps Script cá nhân` | `index.html`, `07_drive.js` |
| `Sẵn sàng sao lưu khi app đã mở khóa` | `…khi ứng dụng đã mở khóa` | `backup-manager-modal.html` |

### P1 — Cùng khái niệm, nhiều từ

| Nhóm | Biến thể | Chuẩn đề xuất |
|---|---|---|
| Khách / hồ sơ | `Tổng hồ sơ` vs `Khách hàng đã vay`; modal `Thông tin khách hàng` vs `Khởi tạo hồ sơ` / `Lưu hồ sơ` / `Đã xóa hồ sơ` | Entity: **khách hàng**. Record: **hồ sơ**. Tiêu đề list/dashboard ưu tiên **khách hàng**; thao tác lưu/xóa bản ghi dùng **hồ sơ** nhất quán. |
| Tài sản | Toast `Đã lưu tài sản bảo đảm` nhưng nút/title vẫn `TSBĐ` | Một từ: **tài sản bảo đảm** |
| Transfer | `bản sao lưu` / `bản ghi` / `gói dữ liệu` / `backup` / `Tệp` | **bản sao lưu** (payload), **file sao lưu** (`.cpb`), **hộp thư nhận** (inbox) |
| Ảnh | empty `ảnh` vs confirm lightbox `Hủy chứng từ này?` / `Xóa chứng từ` | **ảnh** |
| Nút lưu KH | mặc định HTML `Lưu hồ sơ` → JS đổi `Tạo mới` / `Cập nhật` | `Tạo mới` / `Lưu thay đổi` |
| Nút lưu TSBĐ | HTML `Lưu` → JS `Thêm mới` / `Lưu thay đổi` | đồng bộ với KH |

### P2 — Tone / viết hoa / chi tiết nhỏ

| Vấn đề | Ví dụ | Hướng xử lý |
|---|---|---|
| Tone thân mật lệch | onboarding `…nhé!`; donate `anh/chị` | Giữ lịch sự trung tính; donate có thể giữ lịch sự riêng nếu cố ý |
| Viết hoa lung tung | `Kích hoạt Thiết bị`, `Kho Ảnh TSBĐ`, `Thêm TSBĐ Mới` | Title case nhẹ: chỉ viết hoa chữ đầu cụm / tên riêng |
| Abbreviation nội bộ trên card | `ĐG:` trên card tài sản | `Định giá:` hoặc icon+tooltip |
| `file` vs `Tệp` | backup modal vs cloud transfer | Chọn **file** |

---

## 3. Phạm vi file khi áp dụng

| Nhóm | File |
|---|---|
| KH / hồ sơ | `index.html`, `05_customers.js`, `13_ui_select_customers.js`, `add-modal.html`, `manifest.json` (nếu cần) |
| Tài sản bảo đảm | `index.html`, `asset-modal.html`, `guide-modal.html`, `06_assets.js`, `07_drive.js`, `08_images_camera.js` |
| Sao lưu / Drive / transfer | `backup-manager-modal.html`, `09_backup_manager.js`, `14_cloud_transfer.js`, `16_auto_backup_drive.js`, `07_drive.js`, `index.html` |
| Bảo mật / PIN / kích hoạt / sinh trắc | `setup-lock-modal.html`, `screen-lock.html`, `forgot-pin-modal.html`, `activation-modal.html`, `biometric-setup-modal.html`, `02_security.js`, `15_auth_gate.js`, `18_biometric_unlock.js` |
| Toast / confirm chung | call-site ở các file trên + `19_error_loading.js` (nếu có chuỗi mặc định) |

**Không đụng:** tên hàm (`closeFolder`, `openBackupManager`), object store, cache SW, comment kỹ thuật, test helper — trừ khi test assert đúng chuỗi UI cũ thì cập nhật theo.

---

## 4. Thứ tự áp dụng đề xuất

1. P0 viết tắt + tiếng Anh lộ UI (`KH`, `TSBĐ`, `user`, `Folder`, `Dashboard`, `App`, `Key`, `token`).
2. P1 thống nhất khách/hồ sơ và nút lưu.
3. P2 tone + viết hoa + `ĐG` / `file`–`Tệp`.
4. Chạy `npm test` + e2e liên quan copy (nếu có assert chuỗi).

---

## 5. Quyết định đã chốt (xem plan Opus)

1. Nút hẹp: `Thêm tài sản` / `Kho ảnh tài sản` — không còn `TSBĐ` trong UI.
2. `Tổng hồ sơ` → `Tổng khách hàng`.
3. Cloud transfer: `đồng nghiệp`.
4. Cấu hình Drive: `Link kết nối Drive cá nhân` (không `Script`/`token` trong placeholder).
5. Nút upload ngắn giữ `Lên Drive`; toast/confirm dùng `tải lên Drive` — cấm `lên mây`.

Plan thực thi chi tiết (before/after + acceptance): **`docs/terminology-plan-opus.md`**.

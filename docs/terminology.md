# Glossary từ ngữ UI — ClientPro

> Nguồn chuẩn hóa cho **chuỗi hiển thị cho người dùng**. Áp dụng cho `index.html`,
> `assets/ui/modals/*.html` và chuỗi UI trong `assets/*.js`. **Không** áp dụng cho
> tên hàm/biến/store/localStorage/CSP/logic bảo mật hay comment kỹ thuật.
>
> Trạng thái: **applied** (đợt chuẩn hóa từ ngữ, 2026-07).

## Bảng canonical

| Ngữ cảnh | Dùng | Không dùng |
|---|---|---|
| Tài sản bảo đảm | `tài sản bảo đảm`; nút hẹp: `Thêm tài sản`, `Ảnh tài sản`, `Kho ảnh tài sản`, `Chi tiết tài sản` | `TSBĐ` (trong chuỗi UI) |
| Đếm tổng khách hàng (dashboard/list) | `Tổng khách hàng` / aria `Tổng số khách hàng` | `Tổng hồ sơ` |
| Danh sách khách hàng | `Danh sách khách hàng` | `Danh sách KH` |
| Người nhận cloud transfer | `đồng nghiệp` | `user` |
| Google Drive | giữ tên riêng `Google Drive`; kết nối cá nhân: `Link kết nối Drive cá nhân`; mã: `Dán mã bảo mật từ link kết nối` | `Link Script`, `Script cá nhân`, `token` |
| Tải ảnh lên Drive | nút ngắn `Lên Drive`; toast/confirm/loading: `tải lên Drive`, `Đang tải ảnh lên Drive…`, `Đã tải ảnh … lên Drive` | `lên mây`, `mây`, `Upload` |
| Thư mục Drive | `thư mục` (VD `Mở thư mục ảnh`, `Xem thư mục tài sản`) | `Folder` |
| Ảnh | `ảnh`, `ảnh hồ sơ`, `ảnh tài sản bảo đảm` | `chứng từ` (cho ảnh) |
| File | `file` | `Tệp` |
| Màn hình chính | `màn hình chính` | `Dashboard` (trong chuỗi UI) |
| Ứng dụng | `ứng dụng` | `App` (trong chuỗi UI) |
| Kích hoạt | `Kích hoạt thiết bị`, `Mã kích hoạt`, `Nhập mã kích hoạt...` | `Kích hoạt Thiết bị`, `Mã kích hoạt (Key)`, `Nhập Mã Key...` |
| Prefix thư mục Drive | `Tài sản: ` (tìm kiếm vẫn thử cả legacy `TSBĐ: `) | — |

## Pattern

- Toast OK: `Đã {động từ} {đối tượng}` — vd. `Đã tải ảnh lên Drive`, `Đã xóa ảnh gốc`.
- Nút tạo/sửa: `Tạo mới` / `Lưu thay đổi` / `Hủy`.
- Loading: `Đang tải ảnh lên Drive…`, `Đang mã hóa bản sao lưu…`, `Đang khôi phục…`.
- Tone: lịch sự, ngắn, xưng `bạn`. Không cảm thán thừa (`nhé!`). Không `anh/chị`.
- Viết hoa: chỉ chữ đầu cụm + tên riêng (`Google Drive`, `Face ID`, `VietQR`, `CCCD`).

## Giữ nguyên (không Việt hóa / không đổi)

- Tên riêng: `Google Drive`, `Face ID`, `VietQR`, `CCCD`.
- URL trong message validation: `https://script.google.com/`.
- Tên hàm/ID/biến/`data-action` (`uploadToGoogleDrive`, `reconnectAssetDriveFolder`,
  `closeFolder`, `user-script-url`, `list_users`…), comment kỹ thuật.

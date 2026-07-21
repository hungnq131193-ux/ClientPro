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

## Bổ sung UX/UI hardening 1.1.0 (2026-07)

| Ngữ cảnh | Dùng | Không dùng |
|---|---|---|
| Card tài sản — cho vay | `Cho vay:` | `Vay:` |
| Card tài sản — mặt tiền | `Mặt tiền: {n} m` | `MT:{n}m` |
| Card tài sản — năm xây dựng | `Xây dựng: {năm}` | `Năm:{năm}` |
| Nút ảnh trên card tài sản | `Ảnh tài sản` | `Kho ảnh tài sản` (trên card) |
| Nút tham khảo trên card | `Tham khảo giá` | `Tham khảo` |
| Modal tham khảo | tiêu đề `Tham khảo giá tài sản`; dòng khách hàng `Khách hàng:`; badge `Diện tích: {n} m²`, `Mặt tiền: {n} m` | `KH:`, `{n}m²`, `MT:{n}m` |
| Khoảng cách (tham khảo giá) | đang tính: `Đang tính khoảng cách đường bộ…`; có kết quả: `Cách {d} theo đường bộ`; thất bại: `Chưa tính được khoảng cách đường bộ` | hiển thị khoảng cách đường chim bay (Haversine) như kết quả |
| Fallback giá trị trống | `—` (em dash) | `-`, `--`, `•••`, `Đang tải...` (khi không thực sự tải) |
| Form khách hàng — tiêu đề | thêm: `Thêm khách hàng`; sửa: `Cập nhật khách hàng` | `Thông tin khách hàng`, `Khởi tạo hồ sơ`, `Chỉnh sửa hồ sơ` |
| Trường bắt buộc / tùy chọn | helper `· Bắt buộc` / `· Không bắt buộc` | (chỉ dựa placeholder) |
| Form tài sản — nhãn | `Tên / mô tả tài sản`, `Giá trị cho vay (triệu đồng)`, `Năm xây dựng`, `Địa chỉ / công trình trên đất`, `Tọa độ tài sản`, `Diện tích (m²)`, `Mặt tiền (m)` | `Mô tả chính`, `Vay tối đa`, `Xây dựng`, `Vị trí + Ghi chú thêm`, `Vị trí / Tọa độ` |
| Modal phê duyệt | visible label `Hạn mức được phê duyệt`; helper `Đơn vị: triệu đồng` | (chỉ placeholder) |
| Trung tâm sao lưu — segmented | `Trong máy` / `Được gửi đến` | `Xem danh sách` / `Nhận từ đồng nghiệp` |
| Trung tâm sao lưu — hành động file | `Nhập file sao lưu`, `Tạo và xuất file` | `Nhập file .cpb`, `Tạo & xuất file` |
| Mẫu tên file kỹ thuật | không hiện trên giao diện chính (đưa vào `title`) | dòng `CLIENTPRO_BK_{DEVICEID}_…` thường trực |
| Bảo mật | `Thiết lập bảo mật`, `Mã nhân viên dùng để khôi phục`, `Lưu và kích hoạt` | `Thiết lập Bảo Mật`, `Mã nhân viên (Để khôi phục)`, `Lưu & kích hoạt` |
| Khôi phục truy cập | `Nhập mã nhân viên đã dùng khi thiết lập bảo mật.` | `…để xác thực danh tính.` |
| Hướng dẫn tọa độ | `Cách lấy tọa độ`, `sao chép tọa độ` | `Cách lấy Tọa độ chuẩn`, `copy dãy số tọa độ` |
| Dấu ba chấm (loading/tiếp diễn) | `…` (ký tự ellipsis) | `...` (ba dấu chấm) |

## Giữ nguyên (không Việt hóa / không đổi)

- Tên riêng: `Google Drive`, `Face ID`, `VietQR`, `CCCD`.
- URL trong message validation: `https://script.google.com/`.
- Tên hàm/ID/biến/`data-action` (`uploadToGoogleDrive`, `reconnectAssetDriveFolder`,
  `closeFolder`, `user-script-url`, `list_users`…), comment kỹ thuật.

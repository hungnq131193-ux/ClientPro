# Hướng dẫn sử dụng ClientPro

> Phiên bản: **1.1.0** · Ứng dụng web/PWA quản lý khách hàng & tài sản bảo đảm.
> Toàn bộ dữ liệu được **lưu cục bộ và mã hóa trên thiết bị** của bạn.

Tài liệu này hướng dẫn chi tiết từng chức năng của ClientPro theo đúng luồng thao
tác trong ứng dụng, dành cho người dùng cuối.

---

## Mục lục

1. [Tổng quan](#1-tổng-quan)
2. [Cài đặt ứng dụng (PWA)](#2-cài-đặt-ứng-dụng-pwa)
3. [Kích hoạt thiết bị](#3-kích-hoạt-thiết-bị)
4. [Thiết lập & mở khóa bảo mật](#4-thiết-lập--mở-khóa-bảo-mật)
5. [Màn hình chính (Dashboard)](#5-màn-hình-chính-dashboard)
6. [Quản lý khách hàng](#6-quản-lý-khách-hàng)
7. [Hồ sơ khách hàng & tài sản bảo đảm](#7-hồ-sơ-khách-hàng--tài-sản-bảo-đảm)
8. [Ảnh & Camera](#8-ảnh--camera)
9. [Bản đồ & chỉ đường](#9-bản-đồ--chỉ-đường)
10. [Sao lưu, khôi phục & chuyển máy](#10-sao-lưu-khôi-phục--chuyển-máy)
11. [Giao diện (Themes)](#11-giao-diện-themes)
12. [Tiện ích khác](#12-tiện-ích-khác)
13. [Câu hỏi thường gặp](#13-câu-hỏi-thường-gặp)

---

## 1. Tổng quan

ClientPro giúp cán bộ tín dụng/kinh doanh quản lý danh sách khách hàng và tài sản
bảo đảm (TSBĐ) ngay trên điện thoại, kể cả khi **ngoại tuyến (offline)**.

Điểm nổi bật:

- **Riêng tư tuyệt đối**: dữ liệu nằm trong máy, được mã hóa; không có máy chủ
  trung tâm lưu hồ sơ khách hàng.
- **PWA cài như app**: chạy toàn màn hình, có icon ngoài màn hình chính, dùng
  được khi mất mạng.
- **Bảo mật nhiều lớp**: kích hoạt thiết bị → khóa PIN → mở khóa Face ID / vân tay.
- **Sao lưu linh hoạt**: sao lưu mã hóa vào máy, tự động lên Google Drive cá nhân,
  hoặc chuyển dữ liệu giữa hai thiết bị.

---

## 2. Cài đặt ứng dụng (PWA)

1. Mở đường dẫn ứng dụng bằng trình duyệt (khuyến nghị **Chrome** trên Android,
   **Safari** trên iPhone).
2. Chọn **Thêm vào màn hình chính** / **Cài đặt ứng dụng**:
   - Android/Chrome: menu ⋮ → *Thêm vào Màn hình chính* (hoặc *Cài đặt ứng dụng*).
   - iPhone/Safari: nút **Chia sẻ** → *Thêm vào MH chính*.
3. Mở ClientPro từ icon vừa tạo. Từ lần sau, app chạy toàn màn hình và dùng được
   khi không có mạng.

> 💡 Nên mở app qua địa chỉ **https** (hoặc `localhost`) để Service Worker hoạt
> động, giúp app chạy offline và cập nhật mượt.

---

## 3. Kích hoạt thiết bị

Lần đầu mở app, màn hình **Kích hoạt Thiết bị** xuất hiện:

1. Nhập **Mã kích hoạt (Key)** do quản trị cấp.
2. Nhập **Mã nhân viên** của bạn.
3. Nhấn **Kích hoạt**.

Sau khi kích hoạt thành công, thiết bị được gắn (bind) với tài khoản của bạn. Việc
này giúp khóa quyền sử dụng và bảo mật cho các thao tác sao lưu về sau.

> ⚠️ Nếu báo lỗi kích hoạt/thiết bị, hãy kiểm tra kết nối mạng và mã nhập vào; liên
> hệ quản trị nếu thiết bị bị khóa.

---

## 4. Thiết lập & mở khóa bảo mật

### 4.1. Tạo mã PIN

Sau khi kích hoạt, app yêu cầu **tạo mã PIN** để bảo vệ dữ liệu. Nhập PIN và xác
nhận lại. Từ lần sau, mỗi khi mở app bạn cần nhập PIN để mở khóa.

### 4.2. Mở khóa bằng Face ID / vân tay (tùy chọn)

1. Vào **Cài đặt** (nút menu góc phải) → **Mở khóa sinh trắc học**.
2. Nhập **mã PIN hiện tại** để xác nhận → **Xác nhận & Bật**.
3. Từ lần sau, màn hình khóa cho phép mở nhanh bằng khuôn mặt/vân tay của thiết bị.

Có thể **Tắt mở khóa sinh trắc học** trong cùng mục này bất cứ lúc nào.

> Tính năng dùng chuẩn **WebAuthn (PRF)** của thiết bị; dữ liệu sinh trắc học không
> rời khỏi máy.

### 4.3. Quên PIN

Ở màn hình khóa, chọn **Quên PIN** → cửa sổ **Khôi phục quyền truy cập** để xác
minh và đặt lại. Lưu ý: đặt lại quyền truy cập có thể yêu cầu khôi phục dữ liệu từ
bản sao lưu.

---

## 5. Màn hình chính (Dashboard)

Sau khi mở khóa, bạn vào Dashboard gồm:

- **Lời chào & ngày giờ**, kèm **thời tiết** hiện tại (bấm để làm mới).
- **Tổng quan số liệu**: tổng số khách hàng, số hồ sơ **đã duyệt**, số hồ sơ
  **chờ duyệt**.
- **Thao tác nhanh**:
  - **Bản đồ** — mở bản đồ vị trí khách hàng/tài sản.
  - **Sao lưu & khôi phục** — mở Trung tâm Backup.
  - **Cài đặt Google Drive** — nhập *Link GAS cá nhân* và *Mã bảo mật (Access
    Token)* để bật tự động sao lưu lên Drive riêng.
- **Nút Cài đặt** (góc trên phải): chọn giao diện, Bảo mật, Mở khóa sinh trắc học,
  Ủng hộ tác giả…

---

## 6. Quản lý khách hàng

### 6.1. Xem & tìm kiếm

- Danh sách khách hàng hiển thị avatar, tên, số điện thoại và trạng thái (đã
  duyệt/chờ) qua viền màu.
- Dùng **ô tìm kiếm** trên đầu danh sách để lọc nhanh theo tên/số điện thoại.

### 6.2. Thêm khách hàng

1. Nhấn nút **Thêm** (dấu +).
2. Điền **Tên khách hàng**, **Số điện thoại**, **CCCD/CMND**.
3. Nhấn **Lưu Hồ Sơ**.

### 6.3. Gọi điện / nhắn Zalo

Trên mỗi thẻ khách hàng có nút **Gọi** và **Zalo** để liên hệ nhanh.

### 6.4. Chọn nhiều & thao tác hàng loạt

- Giữ (nhấn lâu) hoặc bật chế độ chọn để **chọn nhiều khách hàng**.
- Thanh công cụ hiện lên cho phép **Gửi** (chuyển hồ sơ cho người dùng khác) hoặc
  **Xóa** các khách hàng đã chọn.

---

## 7. Hồ sơ khách hàng & tài sản bảo đảm

Chạm vào một khách hàng để mở **hồ sơ chi tiết**, gồm các tab:

### 7.1. Thông tin

Xem/sửa thông tin khách hàng, **ghi chú**, và đổi **trạng thái** hồ sơ (chờ ⇄ đã
duyệt) qua nút duyệt.

### 7.2. Tài sản bảo đảm (TSBĐ)

Nhấn **Thêm TSBĐ** để mở biểu mẫu tài sản:

- **Mô tả chính**
- **Định giá (Trđ)** và **Vay Max (Trđ)**
- **Diện tích**, **Mặt tiền**, **Xây dựng**
- **Vị trí + Ghi chú thêm**
- **Vị trí / Tọa độ (Map)** — gắn tọa độ để hiển thị trên bản đồ

Nhấn **Lưu** để lưu tài sản, hoặc **Hủy** để bỏ.

#### Lấy tọa độ chuẩn

- Nhấn nút **định vị (màu đỏ)** để tự lấy vị trí hiện tại của bạn.
- Nếu không đứng tại tài sản: mở **Google Maps**, ghim vị trí, copy dãy số tọa độ
  rồi dán vào ô Tọa độ.

#### Tham khảo giá

Trong tài sản có mục **Tham khảo giá** để tra cứu/ước lượng giá khu vực, hỗ trợ
định giá nhanh.

---

## 8. Ảnh & Camera

- Trong hồ sơ/tài sản, nhấn nút **Chụp ảnh** để mở camera ngay trong app và lưu ảnh
  đính kèm.
- Chạm vào ảnh để **xem phóng to (lightbox)**.
- Bật chế độ chọn ảnh để **Gửi** (chia sẻ) hoặc **Xóa** nhiều ảnh cùng lúc.
- Có thể **tải ảnh lên Google Drive** khi đã cấu hình Drive cá nhân.

---

## 9. Bản đồ & chỉ đường

- Từ Dashboard, mở **Bản đồ** để xem vị trí khách hàng/tài sản trên nền
  **MapLibre GL**.
- App tính **khoảng cách đường đi** qua dịch vụ **OSRM**; nếu không có đường phù
  hợp, app giữ khoảng cách đường chim bay để tránh số liệu sai.
- Chạm marker để xem thông tin và mở chỉ đường.

---

## 10. Sao lưu, khôi phục & chuyển máy

Mở **Trung tâm Backup** (từ Dashboard → *Sao lưu & khôi phục*). Bản sao lưu được
**mã hóa** và có định dạng `.cpb`.

### 10.1. Sao lưu lên Google Drive (tự động)

1. Vào **Cài đặt Google Drive** ở Dashboard, nhập **Link GAS cá nhân** và **Mã bảo
   mật (Access Token)**.
2. Trong Trung tâm Backup, dùng **Backup lên Drive**. App giữ **3 bản mới nhất**.
3. App có thể **tự động sao lưu** khi đủ điều kiện (đã mở khóa, có cấu hình Drive).

### 10.2. Sao lưu trong máy

- **Xem danh sách** các bản sao lưu đang lưu trên thiết bị và khôi phục khi cần.
- **Tạo & xuất file** `.cpb` để giữ bản dự phòng ngoài app.
- **Nhập file .cpb** để khôi phục từ file đã lưu.

### 10.3. Chuyển dữ liệu giữa hai thiết bị

- Dùng **Gửi** (ở danh sách khách hàng) để chuyển hồ sơ cho người dùng khác qua
  cloud, và **Nhận từ user** trong Trung tâm Backup để tiếp nhận.

> ⚠️ **Không chia sẻ file backup** cho người khác: file chứa dữ liệu khách hàng đã
> mã hóa theo tài khoản của bạn.

---

## 11. Giao diện (Themes)

Vào **Cài đặt → Giao diện**. ClientPro có **4 giao diện** theo tông ngân hàng
VietinBank:

| Giao diện | Mô tả |
|---|---|
| **Sáng (VietinBank)** | Nền sáng, thẻ trắng, header xanh — mặc định, dễ đọc. |
| **Xanh Đêm** | Nền tối xanh VietinBank đậm. |
| **Đại Dương** | Nền tối sắc lam biển sâu. |
| **Thiên Thanh** | Nền tối sắc xanh trời tươi. |

Giao diện đã chọn được ghi nhớ cho những lần mở sau.

---

## 12. Tiện ích khác

- **Thời tiết**: hiển thị thời tiết khu vực (nguồn Open-Meteo, không cần API key).
- **Tour hướng dẫn**: lần đầu dùng, app có tour giới thiệu nhanh các khu vực chính.
- **Ủng hộ tác giả**: mục **Donate** tạo mã VietQR để chuyển khoản ủng hộ.
- **Cử chỉ vuốt**: hỗ trợ vuốt cạnh để quay lại (edge back-swipe) mượt trên mobile.

---

## 13. Câu hỏi thường gặp

**Dữ liệu của tôi có được gửi lên máy chủ không?**
Không. Hồ sơ khách hàng lưu cục bộ và mã hóa trong máy. Chỉ khi bạn chủ động sao
lưu lên **Google Drive cá nhân** của mình thì bản mã hóa mới rời thiết bị.

**Mất máy/đổi máy thì sao?**
Hãy đảm bảo đã **sao lưu** (Drive hoặc file `.cpb`). Trên máy mới: kích hoạt, tạo
PIN, rồi **khôi phục** từ bản sao lưu.

**Quên PIN có lấy lại được dữ liệu không?**
Dùng **Quên PIN** để khôi phục quyền truy cập; nếu cần, khôi phục dữ liệu từ bản
sao lưu gần nhất. Vì vậy hãy sao lưu thường xuyên.

**App không cập nhật giao diện mới?**
Đóng hẳn app và mở lại để Service Worker nạp bản mới. Nếu vẫn chưa thấy, xóa cache
trình duyệt cho trang rồi mở lại.

---

*Cần hỗ trợ thêm? Xem [README](../README.md) hoặc liên hệ tác giả qua kho mã nguồn
chính thức.*

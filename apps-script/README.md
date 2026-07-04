# Apps Script (GAS) — Backend cá nhân của ClientPro

Thư mục này chứa mã Google Apps Script (GAS) mà **mỗi người dùng tự deploy vào Drive
của mình**. App PWA (`../index.html`) chỉ gọi tới URL `/exec` của các GAS này qua HTTP;
mã GAS không chạy trong repo mà chạy trên `script.google.com`.

## Files

- `UserAPI_v2.gs` — GAS cá nhân: upload ảnh hồ sơ khách hàng / tài sản và backup/restore
  lên Drive **của chính người dùng**. URL `/exec` được dán trong app ở mục Cài đặt Drive
  (lưu ở `localStorage` key `app_user_script_url`).

## Mô hình riêng tư ảnh (v2_private)

- Ảnh upload được đặt **PRIVATE** — chỉ tài khoản Google chủ sở hữu (tài khoản deploy GAS)
  xem được. **Không còn** `ANYONE_WITH_LINK`.
- Muốn xem ảnh: mở "Folder Ảnh" bằng tài khoản Google có quyền (mặc định là chính tài khoản
  chủ sở hữu). Nếu cần chia sẻ cho người khác, tự share folder trong giao diện Google Drive.
- Response upload/search **không còn** trả `directLink` (link `uc?export=view` trông như công
  khai, dễ rò rỉ và không còn dùng được cho người ngoài khi file đã private). App chỉ đọc
  `status` + `url` (URL folder) nên không bị ảnh hưởng.

## Deploy

1. Mở project Apps Script hiện có của bạn (project đang chứa bản `UserAPI` cũ).
2. Dán toàn bộ nội dung `UserAPI_v2.gs` vào, ghi đè bản cũ.
3. **Deploy lại cùng một deployment** (Manage deployments → chỉnh bản hiện tại → Deploy) để
   giữ nguyên URL `/exec` đã lưu trong app. Nếu tạo deployment mới, phải dán URL mới vào app.

## Chạy MỘT LẦN: thu hồi công khai ảnh cũ

Các bản trước đã đặt ảnh ở chế độ công khai. Sau khi deploy bản mới:

1. Trong Apps Script editor, chọn hàm **`revokePublicSharing`** ở thanh chọn hàm.
2. Nhấn **Run** (cấp quyền nếu được hỏi).
3. Xem **Executions / Logs**: sẽ báo số file đã seen / set PRIVATE / errors.

Hàm này duyệt đệ quy toàn bộ `CLIENTPRO_IMAGES` (kể cả subfolder), đặt mọi file về PRIVATE.
An toàn để chạy lại nhiều lần.

## Kiểm tra nhanh sau deploy

1. Upload thử 1 ảnh từ app → app vẫn hiện nút **"Mở Folder Ảnh"** và chủ sở hữu mở folder được.
2. Lấy link `https://drive.google.com/uc?export=view&id=<ID_ẢNH_VỪA_UPLOAD>`, mở ở **cửa sổ ẩn
   danh / không đăng nhập** → phải thấy tường yêu cầu quyền của Google (không xem được ảnh).
   Đó là bằng chứng rò rỉ đã được bịt.

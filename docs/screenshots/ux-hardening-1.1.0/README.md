# Screenshot matrix — UX/UI hardening 1.1.0

Bộ ảnh đối chiếu **before/after** cho đợt UX/UI hardening (1.0.9 → 1.1.0).

- `before/` — chụp từ commit baseline `a1a6d0d` (phiên bản 1.0.9).
- `after/` — chụp từ nhánh `claude/ux-hardening-clientpro-1-1-0-14i9kz` (1.1.0).

## Quy tắc đặt tên

```
<viewport>-<theme>-<screen>.png
```

- **viewport**: `360x800`, `393x851` (Pixel 5), `412x915`, `1280x800`.
- **theme**: `vietinbank` (sáng), `midnight` (navy), `ocean` (teal), `aurora` (indigo).
- **screen**: `lock`, `dashboard`, `menu`, `backup-center`, `add-modal`, `profile`,
  `asset-modal`, `asset-card`, `ref-price`, `approve-modal`, `customer-list`,
  `customer-list-search`.

Mỗi thư mục: 4 theme × 4 viewport × 12 màn = **192 ảnh**.

## Điểm đối chiếu nổi bật (before → after)

- **customer-list**: gỡ nút "Chọn" khỏi toolbar (nhấn giữ vẫn chọn nhiều) + chỉ dẫn nhấn-giữ.
- **backup-center**: 3 khu vực rõ + segmented control "Trong máy / Được gửi đến"; ẩn mẫu tên file kỹ thuật.
- **asset-card**: copy chuẩn ("Mặt tiền: n m", "Xây dựng", "Cho vay", "Ảnh tài sản"); nhãn nút sửa/xóa.
- **add-modal / asset-modal / approve-modal**: nút Hủy, label/đơn vị rõ, helper, contrast đạt chuẩn.
- **theme**: 4 theme phân biệt rõ (sáng / navy / teal / indigo), không còn "chỉ đổi gradient".

Tất cả màn mục tiêu ở cả 4 theme đạt **axe 0 critical, 0 serious** (WCAG 2 A/AA).

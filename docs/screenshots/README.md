# Screenshot artifacts

Không commit các bộ ảnh before/after hàng loạt do agent hoặc Playwright sinh ra vào repository.

- Ảnh dùng để review một Pull Request nên đính kèm trực tiếp vào PR hoặc lưu trong artifact của GitHub Actions.
- `playwright-report/`, `test-results/` và ảnh chụp tự động chỉ là đầu ra kiểm thử cục bộ/CI.
- Thư mục sinh tự động phải dùng tên như `before`, `after`, `actual`, `expected`, `diff`, `generated` hoặc `review-artifacts`; các đường dẫn này bị `.gitignore` chặn.
- Ảnh tài liệu lâu dài vẫn được phép lưu theo chủ đề, ví dụ `docs/screenshots/guide/onboarding.png`.
- Test hygiene cảnh báo nếu một mục tài liệu chứa quá 24 ảnh, nhằm ngăn ma trận ảnh hàng loạt quay lại mà không có thay đổi chính sách có chủ đích.

Quy tắc này giữ lịch sử Git gọn, tránh phình repository và không ảnh hưởng mã nguồn/runtime của ClientPro.

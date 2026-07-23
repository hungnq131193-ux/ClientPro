# Screenshot artifacts

Không commit các bộ ảnh before/after hàng loạt do agent hoặc Playwright sinh ra vào repository.

- Ảnh dùng để review một Pull Request nên đính kèm trực tiếp vào PR hoặc lưu trong artifact của GitHub Actions.
- `playwright-report/`, `test-results/` và ảnh chụp tự động chỉ là đầu ra kiểm thử cục bộ/CI.
- Chỉ commit ảnh khi đó là tài nguyên lâu dài được ứng dụng hoặc tài liệu hiện hành tham chiếu trực tiếp.

Quy tắc này giữ lịch sử Git gọn, tránh phình repository và không ảnh hưởng mã nguồn/runtime của ClientPro.

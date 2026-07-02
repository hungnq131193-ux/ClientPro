# ClientPro

ClientPro là ứng dụng web/PWA quản lý khách hàng và tài sản, tối ưu cho trải nghiệm di động. Dự án hiện là ứng dụng tĩnh chạy trực tiếp bằng `index.html`, có Service Worker để hỗ trợ cài đặt PWA và dùng ngoại tuyến.

## Tính năng chính

- Quản lý danh sách khách hàng, tài sản và hình ảnh liên quan.
- Giao diện PWA có manifest, icon và Service Worker.
- Hỗ trợ khóa màn hình/PIN, modal kích hoạt và các luồng bảo mật cục bộ.
- Hỗ trợ sao lưu/khôi phục, chuyển dữ liệu qua cloud/Drive và tự động sao lưu.
- Tối ưu thao tác mobile như camera, lightbox, bản đồ và edge back-swipe.

## Cấu trúc thư mục

```text
.
├── index.html                  # App shell chính
├── manifest.json               # Cấu hình PWA
├── sw.js                       # Service Worker/cache runtime
├── assets/                     # JavaScript, CSS và UI partials
│   ├── ui/modals/              # Modal HTML được load động
│   └── css/                    # CSS bổ sung/self-hosted Tailwind
└── .github/workflows/ci.yml    # CI kiểm tra tĩnh
```

## Chạy cục bộ

Do Service Worker cần origin HTTP/HTTPS, hãy chạy bằng một static server thay vì mở file trực tiếp:

```bash
python3 -m http.server 8000
```

Sau đó mở `http://localhost:8000/`.

## Quy trình phát triển

1. Chỉnh sửa file trong `assets/`, `index.html`, `manifest.json` hoặc `sw.js`.
2. Khi thay đổi asset được cache hoặc logic PWA, bump đồng bộ:
   - `VERSION` trong `sw.js`.
   - `SW_BUILD` trong `assets/pwa.js`.
   - query cache-buster tương ứng trong `index.html` nếu cần ép trình duyệt tải file mới.
3. Kiểm tra tĩnh trước khi commit:

```bash
python3 -m json.tool manifest.json >/dev/null
node --check sw.js
node --check assets/pwa.js
node --check assets/11_edge_back_swipe.js
```

## CI

GitHub Actions chạy trên mỗi push/pull request để kiểm tra:

- JSON manifest hợp lệ.
- Cú pháp JavaScript quan trọng (`sw.js`, `assets/pwa.js`, các file `assets/*.js`).
- Không tái xuất hiện scaffold debug của `11_edge_back_swipe.js`.

## License

Dự án được phát hành theo giấy phép MIT. Xem [LICENSE](LICENSE).

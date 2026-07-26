# Automated Tests — ClientPro

Bộ test tự động ưu tiên **tính toàn vẹn dữ liệu (banking data integrity)**, chạy chủ yếu
trên **GitHub Actions** để người dùng chỉ cần xem dấu ✅/❌ trên GitHub (không phải test tay
trên điện thoại).

## Triết lý & Ràng buộc

- **Zero-dependency, zero-build**: chạy bằng test runner tích hợp của Node (`node --test`) +
  `node:crypto` (WebCrypto) + `assets/vendor/crypto-js.min.js` đã self-host. **Không** cần
  `npm install`, **không** có `node_modules`, **không** thêm CDN.
- **Không đụng versioning**: test nằm ngoài `assets/`, nên **không** cần bump version hay
  cache-buster (`ASSET_V`). Job version-sync trong `ci.yml` không bị ảnh hưởng.
- **Test code THẬT**: `tests/helpers/load-security.js` nạp NGUYÊN BẢN `assets/02_security.js`
  vào một sandbox `node:vm` (cung cấp CryptoJS/WebCrypto/localStorage giả lập) rồi chạy chính
  các hàm production — không sao chép, không reimplement.

## Chạy local (nếu có máy tính)

```bash
node --test 'tests/**/*.test.js'
```

Yêu cầu Node.js >= 20 (CI dùng Node 22).

## Nội dung

| File | Phạm vi |
|------|---------|
| `crypto.test.js` | `encryptText`/`decryptText` — mã hóa mọi trường KH/tài sản (roundtrip, salt ngẫu nhiên, sai key không rò rỉ). |
| `backup.test.js` | Envelope `.cpb` AES-256-GCM: roundtrip, checksum, chống giả mạo (GCM tag), từ chối sai khóa. |
| `data-integrity.test.js` | Giải mã cấp đối tượng Customer + Asset bảo đảm; niêm phong masterKey bằng PIN (PBKDF2 + AES-GCM); escapeHTML. |
| `field-migration.test.js` | Migration mã hóa at-rest cho `creditLimit` và `assets[].name` — chạy `02_security.js` thật trong vm sandbox. |
| `schema.test.js` | Data-contract: khóa cứng SHAPE record Customer/Asset ở tầng lưu trữ. |
| `kdata-cache.test.js` | KDATA không bao giờ plaintext trong persistent storage; cache niêm phong AES-GCM dưới masterKey. |
| `pwa.test.js` | Kiểm tra tĩnh Service Worker/manifest: vòng đời, precache đủ module, đồng bộ version. |
| `sw-routing.test.js` | Chiến lược cacheFirst của SW: STATIC_CACHE trước (exact match kể cả `?v=`), rồi runtime cache. |
| `regressions.test.js` | Tripwire tĩnh cho các bất biến quan trọng chỉ kiểm chứng đầy đủ được bằng E2E/manual. |
| `menu.test.js` | Hành vi mở/đóng menu (`09_menu.js` chạy trong vm sandbox). |
| `repository-hygiene.test.js` | Chính sách ảnh chụp màn hình trong repo (thư mục sinh tự động, giới hạn ảnh durable mỗi mục). |
| `pdf-toolkit-utils.test.js` | Hàm thuần của PDF Toolkit (`pdf_toolkit_utils.js`): limits, parse range, tên file, chia trang. |
| `dvhc-utils.test.js` | Hàm thuần của tool Tra cứu ĐVHC + toàn vẹn dữ liệu `assets/data/dvhc/dvhc.v1.json` (gồm chống dòng trùng). |

## Xem kết quả trên điện thoại

1. Mở PR trên GitHub app/web → tab **Checks** (hoặc phần status ở cuối PR).
2. Job **"Automated tests (crypto & data integrity)"** hiện ✅ (đạt) hoặc ❌ (lỗi).
3. Chạm vào job để xem log TAP — mỗi dòng `ok N - <tên test>` là một phép kiểm.

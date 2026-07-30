# Vendor inventory (self-host, không dùng CDN ngoài)

Đây là **vendor inventory** cho các thư viện đóng gói trong `assets/vendor/` —
không phải SBOM đầy đủ (CycloneDX/SPDX). Runtime app vẫn zero-dependency
(`package.json` không khai báo `dependencies`); các file dưới đây được commit
trực tiếp và precache bởi Service Worker.

Khi nâng cấp: tải tarball từ registry.npmjs.org, thay file tương ứng, cập nhật
bảng + SHA-256 bên dưới, bump cache-buster (`ASSET_V` trong `sw.js` + `?v=` trong
`index.html` / `03_map.js` / `01_config.js`). `scripts/check-policy.mjs` xác nhận
mọi file trong thư mục này đều có dòng inventory.

| File | Package | Phiên bản | License | Nguồn (npm tarball / path) | SHA-256 |
|---|---|---|---|---|---|
| `lucide.min.js` | `lucide` | 1.23.0 | ISC | https://registry.npmjs.org/lucide/-/lucide-1.23.0.tgz → `dist/umd/lucide.min.js` | `55f43fd2b5553fdb2c1cb5a5940444f55c94a2fec8a72d678bd4a69350f72cd1` |
| `crypto-js.min.js` | `crypto-js` | 4.1.1 | MIT | https://registry.npmjs.org/crypto-js/-/crypto-js-4.1.1.tgz → bundle `crypto-js.js` minify bằng terser | `5399b5c022fda62a87d465c8686c9f810ad413a9c6c7956af70adece2cb93abc` |
| `maplibre-gl.js` | `maplibre-gl` | 4.7.1 | BSD-3-Clause | https://registry.npmjs.org/maplibre-gl/-/maplibre-gl-4.7.1.tgz → `dist/maplibre-gl.js` | `be9633c4d870e26fb37f1cfe5c5a77181667114003ea16207ac7850d8da8add1` |
| `maplibre-gl.css` | `maplibre-gl` | 4.7.1 | BSD-3-Clause | https://registry.npmjs.org/maplibre-gl/-/maplibre-gl-4.7.1.tgz → `dist/maplibre-gl.css` | `576b085fdd9487a65a19215328c1e086c07ce5bf6da09b666b3806d3d008dae9` |
| `supercluster.min.js` | `supercluster` | 8.0.1 | ISC | https://registry.npmjs.org/supercluster/-/supercluster-8.0.1.tgz → `dist/supercluster.min.js` | `5981fb396427d9050ae430a350d3e6175b33acd6bb1523713fa457b5ca3411d4` |
| `pdf-lib.min.js` | `pdf-lib` | 1.17.1 | MIT | https://registry.npmjs.org/pdf-lib/-/pdf-lib-1.17.1.tgz → `dist/pdf-lib.min.js` | `0f9a5cad07941f0826586c94e089d89b918c46e5c17cf2d5a3c6f666e3bc694f` |
| `pdf.min.mjs` | `pdfjs-dist` | 4.2.67 | Apache-2.0 | https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-4.2.67.tgz → `build/pdf.min.mjs` | `c3caae2cf1fe9d6e25588d0d239d02454422778ed5897314981496a4656eab82` |
| `pdf.worker.min.mjs` | `pdfjs-dist` | 4.2.67 | Apache-2.0 | https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-4.2.67.tgz → `build/pdf.worker.min.mjs` | `ee61de6dd3effd826b7083739409e50bae43c2e41a896f27ea8dd2d77e2f349b` |
| `jszip.min.js` | `jszip` | 3.10.1 | MIT/GPLv3 | https://registry.npmjs.org/jszip/-/jszip-3.10.1.tgz → `dist/jszip.min.js` | `acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e` |

PDF Toolkit (`pdf-lib`, `pdf.js`, `jszip`) được **lazy-load lúc runtime** khi mở /
xử lý file trong Bộ công cụ PDF — không tải lúc boot app. Các file vẫn nằm trong
`STATIC_ASSETS` precache của Service Worker để dùng offline ngay sau khi cài.
`pdf.js` worker trỏ tới `pdf.worker.min.mjs` cục bộ (không gọi mạng để tải worker).

Font tự host tại `../fonts/` (Be Vietnam Pro — SIL OFL 1.1, subset latin/vietnamese,
khai báo trong `../css/fonts.css`). Inventory + SHA-256: `../fonts/README.md`.
Cold-start chỉ preload 2 file weight 400 (latin + vietnamese); các weight còn lại
tải theo `unicode-range` khi UI cần. Không có official variable font cho family này.

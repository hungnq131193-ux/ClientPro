# Vendor (self-host, không dùng CDN ngoài)

| File | Nguồn | Phiên bản | License |
|---|---|---|---|
| `lucide.min.js` | npm `lucide` (dist/umd) | 1.23.0 | ISC |
| `crypto-js.min.js` | npm `crypto-js` (bundle `crypto-js.js`, minify bằng terser) | 4.1.1 | MIT |
| `maplibre-gl.js` / `maplibre-gl.css` | npm `maplibre-gl` (dist) | 4.7.1 | BSD-3-Clause |
| `supercluster.min.js` | npm `supercluster` (dist) | 8.0.1 | ISC |
| `pdf-lib.min.js` | npm `pdf-lib` (dist/pdf-lib.min.js) | 1.17.1 | MIT |
| `pdf.min.mjs` / `pdf.worker.min.mjs` | npm `pdfjs-dist` (build, ESM) | 4.2.67 | Apache-2.0 |
| `jszip.min.js` | npm `jszip` (dist/jszip.min.js) | 3.10.1 | MIT/GPLv3 |

PDF Toolkit (`pdf-lib`, `pdf.js`, `jszip`) chỉ **lazy-load lúc runtime** khi mở Bộ công cụ
PDF lần đầu — KHÔNG tải lúc khởi động app. `pdf.js` worker trỏ tới `pdf.worker.min.mjs`
cục bộ (không gọi mạng để tải worker). Sau lần tải đầu, Service Worker cache để dùng offline.

Font tự host tại `../fonts/` (Inter, Be Vietnam Pro — SIL OFL 1.1, subset latin/latin-ext/vietnamese,
khai báo trong `../css/fonts.css`).

Khi nâng cấp: tải tarball từ registry.npmjs.org, thay file tương ứng, bump cache-buster
(`ASSET_V` trong `sw.js` + `?v=` trong `index.html`/`03_map.js`).

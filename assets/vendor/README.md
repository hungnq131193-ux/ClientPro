# Vendor (self-host, không dùng CDN ngoài)

| File | Nguồn | Phiên bản | License |
|---|---|---|---|
| `lucide.min.js` | npm `lucide` (dist/umd) | 1.23.0 | ISC |
| `crypto-js.min.js` | npm `crypto-js` (bundle `crypto-js.js`, minify bằng terser) | 4.1.1 | MIT |
| `maplibre-gl.js` / `maplibre-gl.css` | npm `maplibre-gl` (dist) | 4.7.1 | BSD-3-Clause |
| `supercluster.min.js` | npm `supercluster` (dist) | 8.0.1 | ISC |

Font tự host tại `../fonts/` (Inter, Be Vietnam Pro — SIL OFL 1.1, subset latin/latin-ext/vietnamese,
khai báo trong `../css/fonts.css`).

Khi nâng cấp: tải tarball từ registry.npmjs.org, thay file tương ứng, bump cache-buster
(`ASSET_V` trong `sw.js` + `?v=` trong `index.html`/`03_map.js`).

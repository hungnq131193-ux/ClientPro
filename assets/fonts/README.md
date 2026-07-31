# Fonts inventory — Be Vietnam Pro (SIL OFL 1.1)

Self-hosted under `assets/fonts/`. Declared in `assets/css/fonts.css`.
Source: Google Fonts / [Be Vietnam Pro](https://github.com/google/fonts/tree/main/ofl/bevietnampro).

**No official variable font** exists for Be Vietnam Pro (confirmed against Google
Fonts METADATA and CSS API `wght@400..900`). Cold-start therefore preloads **two**
static WOFF2 files (400 latin + 400 vietnamese). Remaining weights (500–900) stay
self-hosted with `unicode-range` so the browser fetches them only when used —
same family and typography, fewer critical requests.

| File | SHA-256 |
|------|---------|
| `be-vietnam-pro-400-latin.woff2` | `03d1b589cff172e1a670b3573e731d3380bc326f80cf83b0d3504e3188e2e074` |
| `be-vietnam-pro-400-vietnamese.woff2` | `dc085e2fba3414e5c5bf1e6172f921a9f81c5859946a4ed3d63c1e470d96a9e2` |
| `be-vietnam-pro-500-latin.woff2` | `b621f77d35f777023aa11ca524462d511b4b28a813adbc0e9d15a10fc61dfe4e` |
| `be-vietnam-pro-500-vietnamese.woff2` | `86341610cbe907eecf461c9159c168d5efb52bb1a33963813a08f520555d8e66` |
| `be-vietnam-pro-600-latin.woff2` | `9503dec2a7c532c8331e9600bcafea287a4fd208573b8668d85ab8d8de1863c7` |
| `be-vietnam-pro-600-vietnamese.woff2` | `97658c6f9a384f29a3005c3d96e2a0d1c810192cf68979071c290f5a377a9f99` |
| `be-vietnam-pro-700-latin.woff2` | `a193dd87699bd2e18ddf72dc271493ea82a23dad9f5c334d9f2a257b1e05fc30` |
| `be-vietnam-pro-700-vietnamese.woff2` | `4f58af2d1c3e28a9ba14c51c82db2751d78344b75bdcb34de24a1031ebe59da6` |
| `be-vietnam-pro-800-latin.woff2` | `7c5d0871188c09339a6eb46948420ed9b11f3d06ea3ff1c5d1cf41b06a3504e7` |
| `be-vietnam-pro-800-vietnamese.woff2` | `26b241d1d5f489c8a65c1a3c4cdcdb48dd114a9ed7e0c0180182191f087cbe96` |
| `be-vietnam-pro-900-latin.woff2` | `b7437222bf15d6be4394c13ec31188e1bf8b9be13e6c38dc4c18ad14511b4888` |
| `be-vietnam-pro-900-vietnamese.woff2` | `70b8feb4c47c137c77ba65d3ef73d5eeda852af1d7ce26f307d7853983948795` |

Do not load fonts from Google/CDN. Weight range in UI remains 400–900.

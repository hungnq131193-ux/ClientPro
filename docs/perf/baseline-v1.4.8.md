# Performance baseline — ClientPro v1.4.8 (c4264af)

Locked baseline before UX / cold-start / document-scanner upgrade.
Measured on Lighthouse mobile (local Python static server; production CDN/compression differs).

## Scores (median)

| Metric | Baseline |
|--------|----------|
| Performance | ~68 / 100 |
| FCP | ~3.0 s |
| LCP | ~10.7 s |
| TBT | 55–100 ms |
| CLS | ~0 |

Accessibility and Best Practices remain the release gates (target 100).

## Bottleneck diagnosis

Not main-thread JS cost. Cold start / first paint:

- Bootstrap waits up to 3 s for **all 13** modal partials (`load_modals.js` + `10_bootstrap.js`).
- **5** render-blocking stylesheets.
- **12** Be Vietnam Pro WOFF2 files; **4** preloaded.
- Unscoped `lucide.createIcons()` at boot.
- ~60 network requests on cold load.

Camera (`08_images_camera.js`): full-frame `drawImage`, no edge detect / perspective, max 2200 px, JPEG quality can fall to 0.5.

## Out of scope (must not change)

Security / crypto / IndexedDB schema / backup / Drive / GAS / customers / assets / map / PDF / ĐVHC / CSP / endpoints. `encryptImageData` → image write transaction in `saveImageToDB` stays intact.

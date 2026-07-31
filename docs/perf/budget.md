# Performance budget — ClientPro ≥ 1.5.0

Gates for the UX / cold-start / document-scanner release. Local Lighthouse (Python
server) and Vercel Preview are measured separately; production compression/cache
are stronger on Preview.

## Lighthouse mobile CI (median of runs)

| Metric | Gate |
|--------|------|
| Performance median | ≥ 85 |
| Performance floor (any run) | ≥ 80 |
| Vercel Preview target | ≥ 90 |
| FCP | ≤ 1.8 s |
| LCP | ≤ 2.8 s |
| TBT | ≤ 150 ms |
| CLS | ≤ 0.02 |
| Accessibility | 100 |
| Best Practices | 100 |

## Resource budget (cold load, first paint path)

| Budget | Gate |
|--------|------|
| Initial requests (security gate / first paint) | ≤ 40 |
| Cold-load transfer (compressed, first paint path) | ≤ 1 MB |
| Render-blocking stylesheets | ≤ 3 |
| Font preloads | 2 (latin + vietnamese primary) |

## Camera / document scanner (device)

| Budget | Gate |
|--------|------|
| Preview FPS | ≥ 25 |
| Detector rate | 6–8 / s |
| Camera long task on main thread | ≤ 50 ms |
| Post-capture process (mid-range Android) | ≤ 1.5 s |
| Auto-detect (well-lit fixture set) | ≥ 95% |
| Auto-detect (device matrix) | ≥ 90% |
| False auto-capture | < 2% |
| Crop into document edge | 0 accepted samples |
| Extra margin per edge | ≲ 2% |
| Offline | Scanner open + process fully offline |

## Regression

Existing unit + E2E suites must stay green. Forbidden modules (crypto, IDB schema,
backup, Drive, GAS, business CRUD, map, PDF, ĐVHC, CSP) must have empty git diff
except version/cache sync strings at release.

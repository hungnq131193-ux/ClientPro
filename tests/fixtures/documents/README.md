# Document scanner fixtures (synthetic)

Synthetic document-like images for detector unit tests. **No real IDs, contracts, or PII.**

| File | Scenario |
|------|----------|
| `doc-quad-light.png` | Light bg, dark rectangle (clear quad) |
| `doc-quad-dark.png` | Dark bg, light rectangle |
| `doc-quad-tilted.png` | Perspective-ish tilted quad |
| `doc-partial-edge.png` | Quad touching image border (should reject auto-capture) |
| `doc-low-contrast.png` | Low contrast rectangle |
| `blank.png` | No document |

Regenerate: `python3 scripts/gen-docscan-fixtures.py` (optional helper).

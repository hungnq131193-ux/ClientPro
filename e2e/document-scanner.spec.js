// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Document scanner / camera modal — smoke only (no real MediaStream in CI).
 * Verifies lazy modal markup + mode toggle affordances after ensuring ModalLoader.
 */

test.describe('document scanner UI', () => {
  test('camera modal partial exposes scan mode controls', async ({ page }) => {
    await page.goto('/index.html');
    // Inject modal HTML the same way ModalLoader would (offline / no activation).
    const html = await page.evaluate(async () => {
      const res = await fetch('assets/ui/modals/camera-modal.html');
      return res.text();
    });
    expect(html).toContain('cp-cam-mode-toggle');
    expect(html).toContain('cp-scan-hint');
    expect(html).toContain('cp-scan-overlay');
    expect(html).toContain('data-action="capturePhoto"');
    expect(html).toContain('data-action="toggleCameraScanMode"');
  });

  test('features.css and scanner modules are reachable (offline precache surface)', async ({ page }) => {
    await page.goto('/index.html');
    for (const url of [
      'assets/css/features.css',
      'assets/document-scanner/document-geometry.js',
      'assets/document-scanner/document-image-enhance.js',
      'assets/document-scanner/document-scanner.js',
      'assets/document-scanner/document-detector.worker.js',
    ]) {
      const res = await page.request.get(url);
      expect(res.ok(), url).toBeTruthy();
    }
  });

  test('geometry module loads and orders corners', async ({ page }) => {
    await page.goto('/index.html');
    await page.addScriptTag({ url: 'assets/document-scanner/document-geometry.js' });
    const ordered = await page.evaluate(() => {
      const pts = [
        { x: 10, y: 80 },
        { x: 90, y: 10 },
        { x: 20, y: 10 },
        { x: 80, y: 90 },
      ];
      return window.DocumentGeometry.orderCorners(pts);
    });
    expect(ordered[0].x).toBe(20);
    expect(ordered[0].y).toBe(10);
  });
});

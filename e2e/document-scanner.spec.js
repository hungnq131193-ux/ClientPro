// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Document scanner / camera modal — no real MediaStream in CI.
 * Verifies lazy assets plus security/back/cleanup lifecycle around the review UI.
 */

const SECURITY_GATE_IDS = [
  'screen-lock',
  'activation-modal',
  'setup-lock-modal',
  'forgot-pin-modal',
  'biometric-setup-modal',
];

async function hideSecurityGates(page) {
  await page.waitForFunction((ids) => ids.every((id) => document.getElementById(id)), SECURITY_GATE_IDS);
  await page.evaluate((ids) => {
    ids.forEach((id) => document.getElementById(id).classList.add('hidden'));
  }, SECURITY_GATE_IDS);
  // Let the camera gate observer consume all hide mutations before a test
  // deliberately shows one of the gates again.
  await page.waitForTimeout(50);
}

async function loadScanner(page) {
  if (await page.evaluate(() => !!window.DocumentScanner)) return;
  for (const url of [
    'assets/document-scanner/document-geometry.js',
    'assets/document-scanner/document-image-enhance.js',
    'assets/document-scanner/document-scanner.js',
  ]) {
    await page.addScriptTag({ url });
  }
}

async function seedReviewDom(page) {
  await page.evaluate(() => {
    const old = document.getElementById('doc-scan-review');
    if (old) old.remove();
    const review = document.createElement('div');
    review.id = 'doc-scan-review';
    const canvas = document.createElement('canvas');
    canvas.id = 'cp-review-canvas';
    canvas.width = 120;
    canvas.height = 80;
    canvas.style.width = '120px';
    canvas.style.height = '80px';
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#123456';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const handles = document.createElement('div');
    handles.id = 'cp-review-corners';
    handles.appendChild(document.createElement('button'));
    review.appendChild(canvas);
    review.appendChild(handles);
    (document.getElementById('ui-modals-root') || document.body).appendChild(review);
  });
}

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

  test('close clears review canvas backing store and corner handles', async ({ page }) => {
    await page.goto('/index.html');
    await hideSecurityGates(page);
    await loadScanner(page);
    await seedReviewDom(page);

    await page.evaluate(() => window.DocumentScanner.close());

    await expect(page.locator('#doc-scan-review')).toBeHidden();
    const cleared = await page.evaluate(() => {
      const canvas = document.getElementById('cp-review-canvas');
      return {
        width: canvas.width,
        height: canvas.height,
        cssWidth: canvas.style.width,
        cssHeight: canvas.style.height,
        handles: document.getElementById('cp-review-corners').childElementCount,
      };
    });
    expect(cleared).toEqual({
      width: 0,
      height: 0,
      cssWidth: '',
      cssHeight: '',
      handles: 0,
    });
  });

  test('showing a real security gate immediately cleans scanner review', async ({ page }) => {
    await page.goto('/index.html');
    await hideSecurityGates(page);
    await loadScanner(page);
    await seedReviewDom(page);

    await page.evaluate(() => {
      document.getElementById('activation-modal').classList.remove('hidden');
    });

    await expect.poll(() => page.evaluate(() => {
      const canvas = document.getElementById('cp-review-canvas');
      const review = document.getElementById('doc-scan-review');
      return {
        hidden: review.classList.contains('hidden'),
        width: canvas.width,
        height: canvas.height,
      };
    })).toEqual({ hidden: true, width: 0, height: 0 });
  });

  test('back closes document review through scanner cleanup before underlying screen', async ({ page }) => {
    await page.goto('/index.html');
    await hideSecurityGates(page);
    await page.waitForFunction(() => !!window.__edgeBackSwipe);
    await seedReviewDom(page);

    const result = await page.evaluate(() => {
      const folder = document.getElementById('screen-folder');
      folder.classList.remove('translate-x-full');
      let closeCalls = 0;
      window.DocumentScanner = {
        close() {
          closeCalls++;
          document.getElementById('doc-scan-review').classList.add('hidden');
        },
      };
      const handled = window.__edgeBackSwipe.runBackAction();
      return {
        handled,
        closeCalls,
        reviewHidden: document.getElementById('doc-scan-review').classList.contains('hidden'),
        folderStillOpen: !folder.classList.contains('translate-x-full'),
      };
    });

    expect(result).toEqual({
      handled: true,
      closeCalls: 1,
      reviewHidden: true,
      folderStillOpen: true,
    });
  });

  test('review dialog receives focus, traps Tab, and Escape runs scanner cleanup', async ({ page }) => {
    await page.goto('/index.html');
    await hideSecurityGates(page);
    await loadScanner(page);
    await page.waitForFunction(() => !!window.ModalA11y);

    await page.evaluate(() => {
      const old = document.getElementById('doc-scan-review');
      if (old) old.remove();

      const review = document.createElement('div');
      review.id = 'doc-scan-review';
      review.className = 'fixed inset-0 hidden';
      review.setAttribute('role', 'dialog');
      review.setAttribute('aria-modal', 'true');
      review.setAttribute('aria-label', 'Xem lại ảnh giấy tờ');

      const actions = document.createElement('div');
      actions.className = 'cp-review-actions';
      [
        ['retake', 'Chụp lại'],
        ['rotate', 'Xoay 90°'],
        ['closeCamera', 'Đóng'],
        ['save', 'Lưu'],
      ].forEach(([action, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        if (action === 'closeCamera') button.dataset.action = action;
        else button.dataset.docscanAction = action;
        actions.appendChild(button);
      });
      review.appendChild(actions);
      (document.getElementById('ui-modals-root') || document.body).appendChild(review);

      window.ModalA11y.observeAll();
      document.getElementById('btn-quick-add').focus();
      review.classList.remove('hidden');
    });

    const buttons = page.locator('#doc-scan-review button');
    await expect(buttons.first()).toBeFocused();
    await buttons.last().focus();
    await page.keyboard.press('Tab');
    await expect(buttons.first()).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('#doc-scan-review')).toBeHidden();
    await expect(page.locator('#btn-quick-add')).toBeFocused();
  });
});

// @ts-check
const { test, expect } = require('@playwright/test');

test('document scanner shell and production worker execute from service-worker cache while offline', async ({ page, context }) => {
  // Keep the business-modal idle warmer dormant so camera-modal must be retrieved
  // through ModalLoader.ensure() after the browser is already offline.
  await page.addInitScript(() => {
    const nativeTimeout = window.setTimeout.bind(window);
    window.requestIdleCallback = (callback, options) => {
      if (options && options.timeout === 2500) return 4242;
      return nativeTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 0);
    };
    window.cancelIdleCallback = (id) => {
      if (id !== 4242) window.clearTimeout(id);
    };
  });

  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => 'serviceWorker' in navigator);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 5000);
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }
  });

  // A reload gives the active worker an unambiguous controlled navigation and
  // exercises the same offline app-shell path used by an installed PWA.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await expect(page.locator('#camera-modal')).toHaveCount(0);

  await context.setOffline(true);

  const result = await page.evaluate(async () => {
    const loaderScript = Array.from(document.scripts)
      .find((script) => (script.src || '').includes('assets/ui/load_modals.js'));
    const match = loaderScript && /[?&]v=([^&#]+)/.exec(loaderScript.src);
    const version = match && match[1] ? decodeURIComponent(match[1]) : '';
    const suffix = version ? `?v=${encodeURIComponent(version)}` : '';

    const modalOk = await window.ModalLoader.ensure('camera-modal');
    const cssOk = await window.ModalLoader.ensureFeatureCss();

    async function loadScript(src) {
      if (Array.from(document.scripts).some((script) => (script.src || '').includes(src))) return true;
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src + suffix;
        script.onload = () => resolve(true);
        script.onerror = () => reject(new Error(`offline script failed: ${src}`));
        document.head.appendChild(script);
      });
    }

    await loadScript('assets/document-scanner/document-geometry.js');
    await loadScript('assets/document-scanner/document-image-enhance.js');
    await loadScript('assets/document-scanner/document-scanner.js');

    const detected = await new Promise((resolve, reject) => {
      const worker = new Worker(`assets/document-scanner/document-detector.worker.js${suffix}`);
      const width = 320;
      const height = 240;
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const inside = x >= 35 && x <= 284 && y >= 25 && y <= 214;
          const value = inside ? 25 : 235;
          data[i] = value;
          data[i + 1] = value;
          data[i + 2] = value;
          data[i + 3] = 255;
        }
      }
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error('offline detector timeout'));
      }, 5000);
      worker.onmessage = (event) => {
        if (!event.data || event.data.type !== 'detect-result') return;
        clearTimeout(timer);
        worker.terminate();
        resolve(event.data);
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        worker.terminate();
        reject(new Error(event.message || 'offline worker error'));
      };
      worker.postMessage({
        type: 'detect',
        id: 1,
        imageData: { width, height, data },
      });
    });

    const cacheHit = version
      ? !!(await caches.match(`./assets/document-scanner/document-detector.worker.js?v=${encodeURIComponent(version)}`))
      : false;

    return {
      modalOk,
      cssOk,
      modalPresent: !!document.getElementById('camera-modal'),
      featureCssPresent: !!document.querySelector('link[data-cp-features-css]'),
      scannerLoaded: !!window.DocumentScanner,
      workerOk: !!detected.ok,
      workerCorners: detected.corners && detected.corners.length,
      cacheHit,
      controlled: !!navigator.serviceWorker.controller,
    };
  });

  expect(result).toEqual({
    modalOk: true,
    cssOk: true,
    modalPresent: true,
    featureCssPresent: true,
    scannerLoaded: true,
    workerOk: true,
    workerCorners: 4,
    cacheHit: true,
    controlled: true,
  });
});

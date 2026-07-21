// Regression for PR #123: auto-tour must retry after a temporary lock during
// its final 800ms delay instead of disappearing until the next full reload.
const { test, expect } = require('@playwright/test');
const { loadSecurity } = require('../tests/helpers/load-security');

const PIN = '123456';
let PIN_ENVELOPE;

test.beforeAll(async () => {
  const { api } = loadSecurity();
  const mk = api.generateMasterKey();
  PIN_ENVELOPE = await api.sealMasterKey(PIN, mk);
});

async function seedNewUserAndUnlock(page) {
  await page.addInitScript(([env]) => {
    localStorage.setItem('app_activated', 'true');
    localStorage.setItem('app_employee_id', 'TEST');
    localStorage.setItem('app_pin', env);
    localStorage.setItem('app_crypto_schema_v', '2');
    localStorage.removeItem('clientpro_onboarding_done');

    const originalGet = sessionStorage.getItem.bind(sessionStorage);
    sessionStorage.getItem = (key) =>
      (key && key.indexOf('clientpro_sw_reloaded_') === 0) ? '1' : originalGet(key);

    // Observe only the onboarding callback: its 800ms function references
    // shouldShowTour. All timers still delegate unchanged to the native API.
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.__tourAutoDelayScheduled = false;
    window.setTimeout = function (fn, delay, ...args) {
      try {
        if (delay === 800 && typeof fn === 'function' &&
            String(fn).includes('shouldShowTour')) {
          window.__tourAutoDelayScheduled = true;
        }
      } catch (e) {}
      return nativeSetTimeout(fn, delay, ...args);
    };
  }, [PIN_ENVELOPE]);

  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-lock', { state: 'visible', timeout: 10_000 });
  for (const digit of PIN) {
    await page.click(`[data-action="enterPin"][data-arg="${digit}"]`);
  }
  await page.waitForSelector('#screen-lock', { state: 'hidden', timeout: 10_000 });
}

test('auto-tour retries after app locks during the final 800ms delay', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await seedNewUserAndUnlock(page);

  // Wait until checkAndStartTour has passed its readiness checks and scheduled
  // the exact 800ms final delay that previously could be lost.
  await page.waitForFunction(
    () => window.__tourAutoDelayScheduled === true,
    null,
    { timeout: 10_000 }
  );

  // Lock before that 800ms callback fires. The callback must detect the block
  // and schedule another readiness check rather than terminating permanently.
  await page.evaluate(() => lockApp());
  await page.waitForSelector('#screen-lock', { state: 'visible', timeout: 8_000 });
  await page.waitForTimeout(1_000);

  await expect(page.locator('#tour-overlay')).toHaveCount(0);
  await expect(page.locator('#tour-tooltip')).toHaveCount(0);

  // Once unlocked, the retry chain should resume and show the first-run tour
  // without requiring a page reload or manual Menu replay.
  for (const digit of PIN) {
    await page.click(`[data-action="enterPin"][data-arg="${digit}"]`);
  }
  await page.waitForSelector('#screen-lock', { state: 'hidden', timeout: 10_000 });
  await page.waitForSelector('#tour-tooltip', { state: 'visible', timeout: 6_000 });
  await expect(page.locator('.tour-step-chip')).toHaveText('Bước 1/11');
  expect(errors, 'Auto-tour retry must not throw an uncaught exception').toEqual([]);

  await page.click('#tour-skip');
  await expect(page.locator('#tour-overlay')).toHaveCount(0, { timeout: 4_000 });
});

// E2E tự khóa khi ẩn app (v1.6.5): mô phỏng visibilitychange trong Chromium thật.
// Ẩn < 15s -> không khóa; ẩn >= 15s (tua Date.now ở nhánh kiểm tra bù khi hiện lại)
// -> #screen-lock hiện lại và mở khóa lại bằng PIN vẫn hoạt động bình thường.
const { test, expect } = require('@playwright/test');
const { loadSecurity } = require('../tests/helpers/load-security');

const PIN = '123456';
let PIN_ENVELOPE;

test.beforeAll(async () => {
  const { api } = loadSecurity();
  const mk = api.generateMasterKey();
  PIN_ENVELOPE = await api.sealMasterKey(PIN, mk);
});

async function unlockWithPin(page) {
  await page.waitForSelector('#screen-lock', { state: 'visible', timeout: 10_000 });
  for (const d of PIN) await page.click(`[data-action="enterPin"][data-arg="${d}"]`);
  await page.waitForSelector('#screen-lock', { state: 'hidden', timeout: 10_000 });
}

// Giả lập app bị ẩn/hiện: override document.hidden rồi phát visibilitychange.
async function setHidden(page, hidden) {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test('ẩn app < 15s -> KHÔNG khóa; ẩn >= 15s -> khóa và mở lại được bằng PIN', async ({ page }) => {
  await page.addInitScript((env) => {
    localStorage.setItem('app_activated', 'true');
    localStorage.setItem('app_employee_id', 'TEST');
    localStorage.setItem('app_pin', env);
    localStorage.setItem('app_crypto_schema_v', '2');
    const o = sessionStorage.getItem.bind(sessionStorage);
    sessionStorage.getItem = (k) => (k && k.indexOf('clientpro_sw_reloaded_') === 0) ? '1' : o(k);
  }, PIN_ENVELOPE);

  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await unlockWithPin(page);

  // 1) Ẩn rồi hiện lại ngay (< 15s): không được khóa (file picker/share/GPS/chuyển app nhanh).
  await setHidden(page, true);
  await setHidden(page, false);
  await expect(page.locator('#screen-lock')).toBeHidden();
  expect(await page.evaluate(() => isAppUnlocked())).toBe(true);

  // 2) Ẩn >= 15s: tua Date.now +16s để đi vào nhánh kiểm tra bù lúc hiện lại
  //    (timer nền bị throttle là tình huống thật trên mobile).
  await setHidden(page, true);
  await page.evaluate(() => {
    const real = Date.now.bind(Date);
    Date.now = () => real() + 16_000;
  });
  await setHidden(page, false);

  await expect(page.locator('#screen-lock')).toBeVisible();
  expect(await page.evaluate(() => isAppUnlocked())).toBe(false);

  // 3) Mở khóa lại bằng PIN: app hoạt động bình thường (list render lại, cipher chạy).
  for (const d of PIN) await page.click(`[data-action="enterPin"][data-arg="${d}"]`);
  await page.waitForSelector('#screen-lock', { state: 'hidden', timeout: 10_000 });
  const after = await page.evaluate(async () => {
    const enc = await encryptText('kiểm tra sau mở khóa lại');
    return {
      unlocked: isAppUnlocked(),
      listRendered: document.getElementById('customer-list').children.length > 0,
      cipherOk: String(enc).startsWith('cpg1:') && decryptText(enc) === 'kiểm tra sau mở khóa lại',
    };
  });
  expect(after).toEqual({ unlocked: true, listRendered: true, cipherOk: true });
});

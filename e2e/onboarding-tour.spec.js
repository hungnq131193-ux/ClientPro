// E2E cho tour hướng dẫn (assets/17_onboarding_tour.js).
// Kiểm chứng HÀNH VI THẬT: user mới thấy tour, user cũ không bị ép, điều hướng,
// skip/finish, mở lại thủ công, bỏ qua bước thiếu selector, cleanup khi app lock,
// hoạt động offline, không rò overlay, và KHÔNG đụng dữ liệu/IndexedDB/crypto.
const { test, expect } = require('@playwright/test');
const { loadSecurity } = require('../tests/helpers/load-security');

const PIN = '123456';
const TOUR_KEY = 'clientpro_onboarding_done';
let PIN_ENVELOPE;

test.beforeAll(async () => {
  const { api } = loadSecurity();
  const mk = api.generateMasterKey();
  PIN_ENVELOPE = await api.sealMasterKey(PIN, mk);
});

// Seed trạng thái đã kích hoạt + PIN; tùy chọn đánh dấu tour đã hoàn tất (user cũ).
async function seedAndUnlock(page, { markDone = false, errors = null } = {}) {
  if (errors) page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(([env, done, key]) => {
    localStorage.setItem('app_activated', 'true');
    localStorage.setItem('app_employee_id', 'TEST');
    localStorage.setItem('app_pin', env);
    localStorage.setItem('app_crypto_schema_v', '2');
    if (done) localStorage.setItem(key, JSON.stringify({ version: 4, completedAt: Date.now() }));
    const o = sessionStorage.getItem.bind(sessionStorage);
    sessionStorage.getItem = (k) => (k && k.indexOf('clientpro_sw_reloaded_') === 0) ? '1' : o(k);
  }, [PIN_ENVELOPE, markDone, TOUR_KEY]);

  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-lock', { state: 'visible', timeout: 10_000 });
  for (const d of PIN) await page.click(`[data-action="enterPin"][data-arg="${d}"]`);
  await page.waitForSelector('#screen-lock', { state: 'hidden', timeout: 10_000 });
}

const TOOLTIP = '#tour-tooltip';
const OVERLAY = '#tour-overlay';

test('user MỚI thấy tour sau khi mở khóa; điều hướng Next/Back đúng bước', async ({ page }) => {
  const errors = [];
  await seedAndUnlock(page, { errors });

  // Tour tự hiện (auto-start có delay ~2.8s).
  await page.waitForSelector(TOOLTIP, { state: 'visible', timeout: 15_000 });
  await expect(page.locator('.tour-step-chip')).toHaveText('Bước 1/11');
  await expect(page.locator('#tour-prev')).toHaveCount(0); // bước đầu không có nút Trước

  // Next -> bước 2.
  await page.click('#tour-next');
  await expect(page.locator('.tour-step-chip')).toHaveText('Bước 2/11');

  // Back -> bước 1.
  await page.click('#tour-prev');
  await expect(page.locator('.tour-step-chip')).toHaveText('Bước 1/11');

  expect(errors, 'Tour không được ném uncaught exception').toEqual([]);
});

test('Skip đóng tour, dọn overlay và lưu trạng thái hoàn tất', async ({ page }) => {
  await seedAndUnlock(page);
  await page.waitForSelector(TOOLTIP, { state: 'visible', timeout: 15_000 });

  await page.click('#tour-skip');
  await expect(page.locator(OVERLAY)).toHaveCount(0, { timeout: 4_000 });
  await expect(page.locator(TOOLTIP)).toHaveCount(0);

  // Trạng thái hoàn tất được lưu.
  const done = await page.evaluate((k) => localStorage.getItem(k), TOUR_KEY);
  expect(done).toBeTruthy();
  expect(JSON.parse(done).version).toBe(4);
});

test('Finish đóng tour, lưu hoàn tất; reload KHÔNG tự hiện lại', async ({ page }) => {
  await seedAndUnlock(page);
  await page.waitForSelector(TOOLTIP, { state: 'visible', timeout: 15_000 });

  // Bấm Tiếp cho tới bước cuối rồi Finish.
  for (let i = 0; i < 20; i++) {
    const label = await page.locator('#tour-next').innerText();
    await page.click('#tour-next');
    if (label.includes('Bắt đầu')) break;
    await page.waitForTimeout(120);
  }
  await expect(page.locator(OVERLAY)).toHaveCount(0, { timeout: 4_000 });
  const done = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), TOUR_KEY);
  expect(done && done.version).toBe(4);

  // Reload: user đã hoàn tất -> không tự hiện lại.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-lock', { state: 'visible', timeout: 10_000 });
  for (const d of PIN) await page.click(`[data-action="enterPin"][data-arg="${d}"]`);
  await page.waitForSelector('#screen-lock', { state: 'hidden', timeout: 10_000 });
  await page.waitForTimeout(4_000);
  await expect(page.locator(OVERLAY)).toHaveCount(0);
});

test('user CŨ (đã hoàn tất) không bị tự động hiện tour', async ({ page }) => {
  await seedAndUnlock(page, { markDone: true });
  // Chờ quá cửa sổ auto-start.
  await page.waitForTimeout(4_500);
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  await expect(page.locator(TOOLTIP)).toHaveCount(0);
});

test('Mở lại tour thủ công từ Menu; không phá trạng thái user cũ', async ({ page }) => {
  await seedAndUnlock(page, { markDone: true });
  await page.waitForTimeout(3_000); // chắc chắn không auto-start
  await expect(page.locator(OVERLAY)).toHaveCount(0);

  // Mở menu rồi bấm "Xem lại hướng dẫn".
  await page.click('#btn-open-menu');
  await page.click('[data-action="OnboardingTour.replay"]');
  await page.waitForSelector(TOOLTIP, { state: 'visible', timeout: 8_000 });
  await expect(page.locator('.tour-step-chip')).toHaveText('Bước 1/11');

  // Đóng lại -> trạng thái hoàn tất vẫn còn (không biến user cũ thành user mới).
  await page.click('#tour-skip');
  await expect(page.locator(OVERLAY)).toHaveCount(0, { timeout: 4_000 });
  const done = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), TOUR_KEY);
  expect(done && done.version).toBe(4);
});

test('Thiếu selector: tour bỏ qua an toàn, không crash, không rò overlay', async ({ page }) => {
  const errors = [];
  await seedAndUnlock(page, { errors });
  await page.waitForSelector(TOOLTIP, { state: 'visible', timeout: 15_000 });

  // Gỡ một target ở giữa (nút PDF) để mô phỏng selector thiếu.
  await page.evaluate(() => { const b = document.getElementById('btn-quick-pdf'); if (b) b.remove(); });

  // Đi hết tour tới cuối: bước PDF phải được bỏ qua, không dừng/không lỗi.
  for (let i = 0; i < 20; i++) {
    const label = await page.locator('#tour-next').innerText();
    await page.click('#tour-next');
    if (label.includes('Bắt đầu')) break;
    await page.waitForTimeout(120);
  }
  await expect(page.locator(OVERLAY)).toHaveCount(0, { timeout: 4_000 });
  expect(errors, 'Thiếu selector không được gây exception').toEqual([]);
});

test('App lock khi tour mở: tour đóng, overlay dọn, không tự mở lại sau unlock', async ({ page }) => {
  await seedAndUnlock(page);
  await page.waitForSelector(TOOLTIP, { state: 'visible', timeout: 15_000 });

  // Khóa app -> observer màn khóa phải dọn tour.
  await page.evaluate(() => lockApp());
  await page.waitForSelector('#screen-lock', { state: 'visible', timeout: 8_000 });
  await expect(page.locator(OVERLAY)).toHaveCount(0, { timeout: 4_000 });
  await expect(page.locator(TOOLTIP)).toHaveCount(0);

  // Mở khóa lại -> tour KHÔNG tự mở lại.
  for (const d of PIN) await page.click(`[data-action="enterPin"][data-arg="${d}"]`);
  await page.waitForSelector('#screen-lock', { state: 'hidden', timeout: 10_000 });
  await page.waitForTimeout(3_500);
  await expect(page.locator(OVERLAY)).toHaveCount(0);
});

test('Viewport điện thoại nhỏ: tooltip không vượt khỏi màn hình', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await seedAndUnlock(page);
  await page.waitForSelector(TOOLTIP, { state: 'visible', timeout: 15_000 });

  // Duyệt vài bước (gồm bước có spotlight) và kiểm tra card nằm trong viewport.
  for (let i = 0; i < 4; i++) {
    const box = await page.locator(TOOLTIP).boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(321);
    expect(box.y + box.height).toBeLessThanOrEqual(569);
    await page.click('#tour-next');
    await page.waitForTimeout(150);
  }
});

test('Tour KHÔNG tạo/đổi dữ liệu khách hàng và không rò DOM sau cleanup', async ({ page }) => {
  await seedAndUnlock(page);
  await page.waitForSelector(TOOLTIP, { state: 'visible', timeout: 15_000 });
  await page.click('#tour-skip');
  await expect(page.locator(OVERLAY)).toHaveCount(0, { timeout: 4_000 });

  // Không còn bất kỳ node tour nào.
  const leftovers = await page.evaluate(() =>
    document.querySelectorAll('#tour-overlay, #tour-tooltip, #tour-spotlight').length);
  expect(leftovers).toBe(0);

  // IndexedDB khách hàng vẫn trống (tour không tạo dữ liệu mẫu).
  const total = await page.evaluate(async () => new Promise((r) => {
    try {
      const rq = db.transaction(['customers']).objectStore('customers').count();
      rq.onsuccess = (e) => r(e.target.result);
      rq.onerror = () => r(-1);
    } catch (e) { r(-2); }
  }));
  expect(total).toBe(0);
});

test('Offline: mở lại tour vẫn hoạt động sau khi asset đã cache', async ({ page, context }) => {
  await seedAndUnlock(page, { markDone: true });
  await page.waitForTimeout(2_500);

  // Ngắt mạng — toàn bộ JS/CSS tour đã nạp trong trang, replay phải chạy được.
  await context.setOffline(true);
  await page.click('#btn-open-menu');
  await page.click('[data-action="OnboardingTour.replay"]');
  await page.waitForSelector(TOOLTIP, { state: 'visible', timeout: 8_000 });
  await expect(page.locator('.tour-step-chip')).toHaveText('Bước 1/11');
  await page.click('#tour-skip');
  await expect(page.locator(OVERLAY)).toHaveCount(0, { timeout: 4_000 });
  await context.setOffline(false);
});

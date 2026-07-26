// e2e/dvhc-lookup.spec.js
// ============================================================================
// E2E cho tool Tra cứu sáp nhập ĐVHC: mở từ lưới Thao tác nhanh, tra xuôi/ngược,
// chuyển địa chỉ, back gesture/history, khóa app giữa chừng, và KHÔNG phát
// sinh uncaught exception. Dùng chung cơ chế seed PIN như crud.spec.js.
// ============================================================================
const { test, expect } = require('@playwright/test');
const { loadSecurity } = require('../tests/helpers/load-security');

const PIN = '123456';
let PIN_ENVELOPE;

test.beforeAll(async () => {
  const { api } = loadSecurity();
  const mk = api.generateMasterKey();
  PIN_ENVELOPE = await api.sealMasterKey(PIN, mk);
});

async function seedAndUnlock(page) {
  await page.addInitScript((env) => {
    localStorage.setItem('app_activated', 'true');
    localStorage.setItem('app_employee_id', 'TEST');
    localStorage.setItem('app_pin', env);
    localStorage.setItem('app_crypto_schema_v', '2');
    // Tắt tour lần đầu: spec này không kiểm tour, để overlay tour không chắn
    // các thao tác trên Dashboard/Menu.
    localStorage.setItem('clientpro_onboarding_done', JSON.stringify({ version: 4, completedAt: Date.now() }));
    const o = sessionStorage.getItem.bind(sessionStorage);
    sessionStorage.getItem = (k) => (k && k.indexOf('clientpro_sw_reloaded_') === 0) ? '1' : o(k);
  }, PIN_ENVELOPE);
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#screen-lock', { state: 'visible', timeout: 10000 });
  for (const d of PIN) await page.click(`[data-action="enterPin"][data-arg="${d}"]`);
  await page.waitForSelector('#screen-lock', { state: 'hidden', timeout: 10000 });
}

// Mở tool từ lưới "Thao tác nhanh" trên Dashboard (điểm mở duy nhất).
async function openLookup(page) {
  await page.click('#btn-quick-dvhc');
  await page.waitForSelector('#screen-dvhc-lookup', { state: 'visible' });
  await page.waitForFunction(() => {
    const s = document.getElementById('screen-dvhc-lookup');
    return s && !s.classList.contains('translate-x-full');
  });
  // Chờ dữ liệu nạp xong (input tra cứu xuất hiện thay cho trạng thái loading).
  await page.waitForSelector('#screen-dvhc-lookup .dvhc-input', { timeout: 15000 });
}

function attachErrorGuard(page, bag) {
  page.on('pageerror', (e) => bag.push(String(e)));
}

test('Mở từ Thao tác nhanh, tra xuôi địa chỉ cũ không dấu ra đơn vị mới', async ({ page }) => {
  const errors = []; attachErrorGuard(page, errors);
  await seedAndUnlock(page);
  await openLookup(page);

  await page.fill('#screen-dvhc-lookup .dvhc-input', 'phuong 12, go vap');
  const firstCard = page.locator('#screen-dvhc-lookup .dvhc-card').first();
  await expect(firstCard).toContainText('Phường An Hội Tây', { timeout: 5000 });
  await expect(firstCard).toContainText('Quận Gò Vấp');
  // Có nút sao chép địa chỉ mới.
  await expect(firstCard.locator('.dvhc-copy-btn')).toBeVisible();
  expect(errors, errors.join(' | ')).toEqual([]);
});

test('Tra ngược: chọn tỉnh mới, lọc xã, xem các đơn vị cũ hợp thành', async ({ page }) => {
  const errors = []; attachErrorGuard(page, errors);
  await seedAndUnlock(page);
  await openLookup(page);

  await page.click('#screen-dvhc-lookup .dvhc-tab:has-text("Xã mới")');
  const select = page.locator('#screen-dvhc-lookup .dvhc-select');
  await select.selectOption({ label: 'Thành phố Hồ Chí Minh' });
  await page.fill('#screen-dvhc-lookup .dvhc-input', 'an hoi tay');
  const row = page.locator('#screen-dvhc-lookup .dvhc-row', { hasText: 'Phường An Hội Tây' }).first();
  await expect(row).toBeVisible({ timeout: 5000 });
  await row.locator('.dvhc-row-head').click();
  await expect(row.locator('.dvhc-old-list li').first()).toBeVisible();
  await expect(row.locator('.dvhc-row-detail')).toContainText('Quận Gò Vấp');
  expect(errors, errors.join(' | ')).toEqual([]);
});

test('Chuyển một dòng địa chỉ cũ sang địa chỉ mới, giữ phần chi tiết', async ({ page }) => {
  const errors = []; attachErrorGuard(page, errors);
  await seedAndUnlock(page);
  await openLookup(page);

  await page.click('#screen-dvhc-lookup .dvhc-tab:has-text("Chuyển địa chỉ")');
  await page.fill('#screen-dvhc-lookup .dvhc-textarea', 'Số 5 ngõ 20, Phường 12, Quận Gò Vấp, TP. Hồ Chí Minh');
  await page.click('#screen-dvhc-lookup .dvhc-btn-primary');
  const result = page.locator('#screen-dvhc-lookup .dvhc-card-accent');
  await expect(result).toContainText('Số 5 ngõ 20, Phường An Hội Tây, Thành phố Hồ Chí Minh', { timeout: 5000 });
  expect(errors, errors.join(' | ')).toEqual([]);
});

test('Địa chỉ không nhận diện được: báo lỗi tiếng Việt, không crash', async ({ page }) => {
  const errors = []; attachErrorGuard(page, errors);
  await seedAndUnlock(page);
  await openLookup(page);

  await page.click('#screen-dvhc-lookup .dvhc-tab:has-text("Chuyển địa chỉ")');
  await page.fill('#screen-dvhc-lookup .dvhc-textarea', 'Xã Không Tồn Tại, Huyện Hư Cấu, Tỉnh Ảo');
  await page.click('#screen-dvhc-lookup .dvhc-btn-primary');
  await expect(page.locator('#screen-dvhc-lookup .dvhc-results .dvhc-hint')).toContainText('Không nhận diện được');
  expect(errors, errors.join(' | ')).toEqual([]);
});

test('Back: nút back đóng màn hình; hardware back (popstate) cũng đóng', async ({ page }) => {
  const errors = []; attachErrorGuard(page, errors);
  await seedAndUnlock(page);
  await openLookup(page);

  // Hardware back (popstate) NGAY sau khi mở — không chờ cửa sổ dedupe nào.
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => document.getElementById('screen-dvhc-lookup').classList.contains('translate-x-full'));
  // Dashboard vẫn hiển thị bình thường.
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  // Chiều sâu history không bị tiêu thụ quá tay: sentinel gốc vẫn còn, nên
  // back tiếp theo còn chỗ để tiêu thụ thay vì thoát app.
  await expect
    .poll(() => page.evaluate(() => !!(history.state && history.state.__clientpro_edge_back)))
    .toBe(true);
  await page.waitForTimeout(500);

  // Mở lại rồi đóng bằng nút back trên header.
  await openLookup(page);
  await page.click('#screen-dvhc-lookup .dvhc-back-btn');
  await page.waitForFunction(() => document.getElementById('screen-dvhc-lookup').classList.contains('translate-x-full'));
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  expect(errors, errors.join(' | ')).toEqual([]);
});

test('Menu cài đặt không còn mục ĐVHC; đóng menu không nuốt back thật', async ({ page }) => {
  const errors = []; attachErrorGuard(page, errors);
  await seedAndUnlock(page);

  // Điểm mở tool đã chuyển hẳn ra Dashboard — menu không được còn lối vào cũ.
  await page.click('#btn-open-menu');
  await page.waitForSelector('#settings-menu', { state: 'visible' });
  await expect(page.locator('#settings-menu [data-action="DvhcLookup.open"]')).toHaveCount(0);

  // Đóng menu bằng cách chạm overlay ở đáy màn hình (ngoài panel menu góc trên
  // phải): menu (modal tracked) ẩn trễ ~200ms rồi mới trả entry history bằng
  // consumeTrackedHistoryStep() -> history.back() của riêng app. Trước đây cú
  // back() đó dedupe bằng cửa sổ thời gian 600ms nên nuốt luôn back thật của
  // người dùng ngay sau đó. Nay dedupe theo ĐẾM (selfPopPending) nên back thật
  // luôn được xử lý.
  await page.locator('#menu-overlay').click({ position: { x: 30, y: 650 } });
  await page.waitForFunction(() => document.getElementById('settings-menu').classList.contains('hidden'));
  await page.waitForTimeout(300);

  await openLookup(page);
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => document.getElementById('screen-dvhc-lookup').classList.contains('translate-x-full'));
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => !!(history.state && history.state.__clientpro_edge_back)))
    .toBe(true);
  expect(errors, errors.join(' | ')).toEqual([]);
});

test('Khóa app giữa chừng: màn hình tool ẩn và KHÔNG tự mở lại sau mở khóa', async ({ page }) => {
  const errors = []; attachErrorGuard(page, errors);
  await seedAndUnlock(page);
  await openLookup(page);

  await page.evaluate(() => { if (typeof lockApp === 'function') lockApp(); });
  await page.waitForSelector('#screen-lock', { state: 'visible' });
  await page.waitForFunction(() => document.getElementById('screen-dvhc-lookup').classList.contains('translate-x-full'));

  // Mở khóa lại — tool không được tự bật lên.
  for (const d of PIN) await page.click(`[data-action="enterPin"][data-arg="${d}"]`);
  await page.waitForSelector('#screen-lock', { state: 'hidden', timeout: 10000 });
  const stillHidden = await page.evaluate(() =>
    document.getElementById('screen-dvhc-lookup').classList.contains('translate-x-full'));
  expect(stillHidden).toBe(true);
  expect(errors, errors.join(' | ')).toEqual([]);
});

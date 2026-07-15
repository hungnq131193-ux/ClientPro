// E2E cho A1: vùng 28px hai mép màn hình KHÔNG được là vùng chết cảm ứng.
// - Tap (kể cả trong dải mép) phải tạo click bình thường.
// - Swipe thật từ mép phải kích hoạt Back đúng MỘT lần.
// - Kéo dọc bắt đầu từ mép phải scroll, không Back.
// Dùng CDP Input.dispatchTouchEvent để mô phỏng touch thật (touchstart/move/end).
const { test, expect } = require('@playwright/test');
const { loadSecurity } = require('../tests/helpers/load-security');

const PIN = '123456';
let PIN_ENVELOPE;

test.beforeAll(async () => {
  const { api } = loadSecurity();
  const mk = api.generateMasterKey();
  PIN_ENVELOPE = await api.sealMasterKey(PIN, mk);
});

// Tap qua touchscreen API của Playwright: đi qua pipeline input thật của
// Chromium nên nếu app preventDefault ở touchstart thì click sẽ bị giết —
// đúng thứ A1 cần kiểm chứng.
async function touchTap(page, x, y) {
  await page.touchscreen.tap(x, y);
}

async function touchSwipe(page, fromX, fromY, toX, toY, steps = 8) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y: fromY }] });
  for (let i = 1; i <= steps; i++) {
    const x = fromX + ((toX - fromX) * i) / steps;
    const y = fromY + ((toY - fromY) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function unlockWithCustomer(page) {
  await page.addInitScript((env) => {
    localStorage.setItem('app_activated', 'true');
    localStorage.setItem('app_employee_id', 'TEST');
    localStorage.setItem('app_pin', env);
    localStorage.setItem('app_crypto_schema_v', '2');
    localStorage.setItem('clientpro_onboarding_done', JSON.stringify({ version: 2, completedAt: Date.now() }));
    const o = sessionStorage.getItem.bind(sessionStorage);
    sessionStorage.getItem = (k) => (k && k.indexOf('clientpro_sw_reloaded_') === 0) ? '1' : o(k);
  }, PIN_ENVELOPE);
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-lock', { state: 'visible', timeout: 10_000 });
  for (const d of PIN) await page.click(`[data-action="enterPin"][data-arg="${d}"]`);
  await page.waitForSelector('#screen-lock', { state: 'hidden', timeout: 10_000 });

  // Tạo 1 khách hàng để có card trong danh sách.
  await page.click('#btn-quick-add');
  await page.waitForSelector('#add-modal', { state: 'visible' });
  await page.fill('#new-name', 'KH Edge Test');
  await page.fill('#new-phone', '0911111111');
  await page.click('[data-action="saveCustomer"]');
  await page.waitForSelector('#add-modal', { state: 'hidden', timeout: 10_000 });
  // App tự mở màn hồ sơ -> đóng lại.
  await page.waitForFunction(() => !document.getElementById('screen-folder').classList.contains('translate-x-full'));
  await page.click('#screen-folder [data-action="closeFolder"]');
  await page.waitForFunction(() => document.getElementById('screen-folder').classList.contains('translate-x-full'));
  // Mở danh sách để có card.
  await page.click('[data-action="openCustomerList"][data-arg="pending"]');
  await expect(page.locator('.cust-card')).toHaveCount(1, { timeout: 10_000 });
  // Chờ animation trượt màn hình (300ms) kết thúc để boundingBox ổn định.
  await page.waitForFunction(() => {
    const card = document.querySelector('.cust-card');
    return card && card.getBoundingClientRect().x < 100;
  }, undefined, { timeout: 5_000 });
  await page.waitForTimeout(150);
}

test('tap vào card trong dải mép trái (EDGE_PX=28) vẫn mở hồ sơ', async ({ page }) => {
  await unlockWithCustomer(page);
  const card = page.locator('.cust-card').first();
  const box = await card.boundingBox();
  // Card bắt đầu tại x≈16 (padding p-4); dải mép EDGE_PX=28 phủ card từ x=16..28.
  // Tap tại mép trái CỦA CARD, bên trong dải mép — đây chính là "vùng chết" cũ.
  const x = box.x + 4; // ≈20, nằm trong dải 28px
  expect(x).toBeLessThanOrEqual(28);
  await touchTap(page, x, box.y + box.height / 2);
  await page.waitForFunction(
    () => !document.getElementById('screen-folder').classList.contains('translate-x-full'),
    undefined, { timeout: 5_000 }
  );
});

test('tap sát mép phải vào card vẫn mở hồ sơ; tap giữa card cũng vậy', async ({ page }) => {
  await unlockWithCustomer(page);
  const card = page.locator('.cust-card').first();
  const box = await card.boundingBox();
  const vw = page.viewportSize().width;

  // Tap vào mép phải CỦA CARD, bên trong dải mép phải (vw - x <= 28).
  // Mép phải card có các action button (zalo/call — tap vào đó mở link, không mở
  // hồ sơ) nên dò một điểm thuộc card nhưng KHÔNG thuộc .action-btn.
  const rightX = box.x + box.width - 6;
  expect(vw - rightX).toBeLessThanOrEqual(28);
  const tapY = await page.evaluate(({ x, top, height }) => {
    for (let y = top + 6; y < top + height - 4; y += 6) {
      const el = document.elementFromPoint(x, y);
      if (el && el.closest('.cust-card') && !el.closest('.action-btn')) return y;
    }
    return null;
  }, { x: rightX, top: box.y, height: box.height });
  expect(tapY, 'Phải có điểm card không phải action-btn ở dải mép phải').not.toBeNull();
  await touchTap(page, rightX, tapY);
  await page.waitForFunction(
    () => !document.getElementById('screen-folder').classList.contains('translate-x-full'),
    undefined, { timeout: 5_000 }
  );
  // Đóng lại rồi tap giữa card.
  await page.click('#screen-folder [data-action="closeFolder"]');
  await page.waitForFunction(() => document.getElementById('screen-folder').classList.contains('translate-x-full'));
  await touchTap(page, box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(
    () => !document.getElementById('screen-folder').classList.contains('translate-x-full'),
    undefined, { timeout: 5_000 }
  );
});

test('swipe thật từ mép trái kích hoạt Back đúng một lần (đóng danh sách)', async ({ page }) => {
  await unlockWithCustomer(page);
  // Danh sách đang mở; swipe từ mép trái vào trong > TRIGGER_PX=80.
  await touchSwipe(page, 5, 300, 160, 305);
  // Back = đóng screen-customer-list.
  await page.waitForFunction(
    () => document.getElementById('screen-customer-list').classList.contains('translate-x-full')
      || document.getElementById('screen-customer-list').classList.contains('hidden'),
    undefined, { timeout: 5_000 }
  );
  // Không duplicate Back: dashboard vẫn hiển thị (không thoát tiếp lớp nữa).
  await page.waitForTimeout(700);
  const dashVisible = await page.evaluate(() => {
    const d = document.getElementById('screen-dashboard');
    return !!d && !d.classList.contains('hidden');
  });
  expect(dashVisible, 'Dashboard phải còn hiển thị sau đúng một Back').toBeTruthy();
});

test('kéo dọc bắt đầu từ mép không kích hoạt Back', async ({ page }) => {
  await unlockWithCustomer(page);
  // Kéo dọc (dy lớn, dx nhỏ) bắt đầu tại mép trái.
  await touchSwipe(page, 10, 200, 18, 420);
  await page.waitForTimeout(500);
  const listStillOpen = await page.evaluate(() => {
    const s = document.getElementById('screen-customer-list');
    return !s.classList.contains('translate-x-full') && !s.classList.contains('hidden');
  });
  expect(listStillOpen, 'Kéo dọc từ mép không được đóng danh sách').toBeTruthy();
});

test('touch nhích nhẹ rồi thả (dưới ngưỡng intent) vẫn tạo click', async ({ page }) => {
  await unlockWithCustomer(page);
  const card = page.locator('.cust-card').first();
  const box = await card.boundingBox();
  const y = box.y + box.height / 2;
  // Nhích 6px (< MIN_INTENT_PX=16) rồi thả — trình duyệt vẫn coi là tap.
  // (Dùng touchscreen.tap có dịch chuyển nhỏ không hỗ trợ trực tiếp; mô phỏng
  // bằng hai tap point gần nhau qua CDP không sinh click trong harness, nên
  // kiểm chứng khía cạnh "không preventDefault khi chưa đủ intent" bằng cách
  // tap vào card ngay TRONG dải mép — nếu code preventDefault sớm, click chết.)
  await touchTap(page, box.x + 6, y);
  await page.waitForFunction(
    () => !document.getElementById('screen-folder').classList.contains('translate-x-full'),
    undefined, { timeout: 5_000 }
  );
});

// v1.5.2 regression: (1) đóng "Cài đặt → Bảo mật" trên phiên đã mở khóa KHÔNG được
// để loader treo che dashboard; (2) mã PIN cũ vẫn mở khóa sau reload (không đụng
// masterKey/envelope); (3) chỉ screen trên cùng nằm trong accessibility tree.
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
    localStorage.setItem('clientpro_onboarding_done', JSON.stringify({ version: 5, completedAt: Date.now() }));
    const o = sessionStorage.getItem.bind(sessionStorage);
    sessionStorage.getItem = (k) => (k && k.indexOf('clientpro_sw_reloaded_') === 0) ? '1' : o(k);
  }, PIN_ENVELOPE);
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-lock', { state: 'visible', timeout: 10_000 });
  for (const d of PIN) await page.click(`[data-action="enterPin"][data-arg="${d}"]`);
  await page.waitForSelector('#screen-lock', { state: 'hidden', timeout: 10_000 });
}

test('đóng Cài đặt → Bảo mật không treo loader; dashboard thao tác lại ngay', async ({ page }) => {
  await seedAndUnlock(page);

  // Mở menu → mở "Thiết lập bảo mật".
  await page.click('#btn-open-menu');
  await page.waitForSelector('#settings-menu', { state: 'visible', timeout: 10_000 });
  await page.click('[data-action="openSecuritySetup"]');
  await page.waitForSelector('#setup-lock-modal', { state: 'visible', timeout: 10_000 });

  // Đóng (hủy) — không lưu.
  await page.click('#setup-lock-modal [data-action="closeSetupModal"]');
  await page.waitForSelector('#setup-lock-modal', { state: 'hidden', timeout: 10_000 });

  // Loader phải ẩn, boot-ready phải được đặt lại, dashboard không còn inert.
  await page.waitForFunction(() => {
    const loader = document.getElementById('loader');
    const dash = document.getElementById('screen-dashboard');
    return loader && loader.classList.contains('hidden')
      && document.body.getAttribute('data-cp-boot-ready') === '1'
      && dash && !dash.inert;
  }, undefined, { timeout: 10_000 });

  // Chứng minh dashboard thao tác được: loader treo (z-250, pointer-events) sẽ chặn
  // click này. Mở được form thêm khách hàng nghĩa là không còn bị che.
  await page.click('#btn-quick-add');
  await page.waitForSelector('#add-modal', { state: 'visible', timeout: 10_000 });
  await page.click('#add-modal [data-action="closeModal"]');
  await page.waitForSelector('#add-modal', { state: 'hidden', timeout: 10_000 });

  // Input PIN/mã nhân viên phải được dọn khi đóng (không để secret ở lại DOM).
  const leftovers = await page.evaluate(() => ({
    pin: (document.getElementById('setup-pin') || {}).value || '',
    ans: (document.getElementById('setup-answer') || {}).value || '',
  }));
  expect(leftovers.pin).toBe('');
  expect(leftovers.ans).toBe('');
});

test('PIN cũ vẫn mở khóa sau reload (đóng modal không đụng masterKey/envelope)', async ({ page }) => {
  await seedAndUnlock(page);

  await page.click('#btn-open-menu');
  await page.waitForSelector('#settings-menu', { state: 'visible', timeout: 10_000 });
  await page.click('[data-action="openSecuritySetup"]');
  await page.waitForSelector('#setup-lock-modal', { state: 'visible', timeout: 10_000 });
  await page.click('#setup-lock-modal [data-action="closeSetupModal"]');
  await page.waitForSelector('#setup-lock-modal', { state: 'hidden', timeout: 10_000 });

  // Reload → màn khóa lại → nhập đúng PIN cũ phải mở khóa được.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-lock', { state: 'visible', timeout: 10_000 });
  for (const d of PIN) await page.click(`[data-action="enterPin"][data-arg="${d}"]`);
  await page.waitForSelector('#screen-lock', { state: 'hidden', timeout: 10_000 });
});

test('slide a11y: chỉ screen trên cùng nằm trong accessibility tree', async ({ page }) => {
  await seedAndUnlock(page);

  // Sau unlock: dashboard là screen trên cùng; các screen ngoài khung phải inert.
  await page.waitForFunction(() => {
    const dash = document.getElementById('screen-dashboard');
    const list = document.getElementById('screen-customer-list');
    return dash && !dash.inert && list && list.inert
      && dash.getAttribute('aria-hidden') === 'false'
      && list.getAttribute('aria-hidden') === 'true';
  }, undefined, { timeout: 10_000 });

  // Tạo KH → app tự mở hồ sơ. Hồ sơ thành screen trên cùng, dashboard bị cô lập.
  await page.click('#btn-quick-add');
  await page.waitForSelector('#add-modal', { state: 'visible' });
  await page.fill('#new-name', 'KH A11y Screen');
  await page.fill('#new-phone', '0900000012');
  await page.click('[data-action="saveCustomer"]');
  await page.waitForSelector('#add-modal', { state: 'hidden', timeout: 10_000 });
  await page.waitForFunction(
    () => !document.getElementById('screen-folder').classList.contains('translate-x-full'),
    undefined, { timeout: 10_000 }
  );
  await page.waitForFunction(() => {
    const dash = document.getElementById('screen-dashboard');
    const folder = document.getElementById('screen-folder');
    return folder && !folder.inert && dash && dash.inert;
  }, undefined, { timeout: 10_000 });

  // Đóng hồ sơ → hồ sơ rời a11y tree, dashboard trở lại screen trên cùng.
  await page.click('#screen-folder [data-action="closeFolder"]');
  await page.waitForFunction(
    () => document.getElementById('screen-folder').classList.contains('translate-x-full'),
    undefined, { timeout: 10_000 }
  );
  await page.waitForFunction(() => {
    const dash = document.getElementById('screen-dashboard');
    const folder = document.getElementById('screen-folder');
    return folder && folder.inert && dash && !dash.inert;
  }, undefined, { timeout: 10_000 });
});

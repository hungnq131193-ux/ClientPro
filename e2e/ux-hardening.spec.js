// UX/UI hardening 1.1.0 — kiểm chứng các thay đổi TRÌNH BÀY (không đụng nghiệp vụ):
// toolbar danh sách bỏ nút "Chọn" nhưng long-press vẫn vào selection mode; nút
// gọi/Zalo có accessible name; form có nút Hủy; modal phê duyệt có visible label;
// Trung tâm sao lưu phân biệt tab/hành động; bàn phím PIN không có nút trống focus.
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
    localStorage.setItem('clientpro_onboarding_done', JSON.stringify({ version: 4, completedAt: Date.now() }));
    const o = sessionStorage.getItem.bind(sessionStorage);
    sessionStorage.getItem = (k) => (k && k.indexOf('clientpro_sw_reloaded_') === 0) ? '1' : o(k);
  }, PIN_ENVELOPE);
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-lock', { state: 'visible', timeout: 10_000 });
  for (const d of PIN) await page.click(`[data-action="enterPin"][data-arg="${d}"]`);
  await page.waitForSelector('#screen-lock', { state: 'hidden', timeout: 10_000 });
}

async function createCustomer(page, name, phone) {
  await page.click('#btn-quick-add');
  await page.waitForSelector('#add-modal', { state: 'visible' });
  await page.fill('#new-name', name);
  if (phone) await page.fill('#new-phone', phone);
  await page.click('[data-action="saveCustomer"]');
  await page.waitForSelector('#add-modal', { state: 'hidden', timeout: 10_000 });
  // App mở màn hồ sơ KH mới -> đóng về dashboard.
  await page.waitForFunction(
    () => !document.getElementById('screen-folder').classList.contains('translate-x-full'),
    undefined, { timeout: 10_000 }
  );
  await page.click('#screen-folder [data-action="closeFolder"]');
  await page.waitForFunction(
    () => document.getElementById('screen-folder').classList.contains('translate-x-full'),
    undefined, { timeout: 10_000 }
  );
}

// ---------- Danh sách khách hàng ----------
test('danh sách: không còn nút Chọn trên toolbar; long-press vào selection mode; gọi/Zalo có nhãn', async ({ page }) => {
  await seedAndUnlock(page);
  await createCustomer(page, 'Khách UX Hardening', '0912345678');

  await page.click('[data-action="openCustomerList"][data-arg="pending"]');
  await page.waitForSelector('#screen-customer-list', { state: 'visible' });
  await expect(page.locator('.cust-card')).toHaveCount(1, { timeout: 10_000 });

  // Không còn nút "#btn-cust-select" hiển thị.
  await expect(page.locator('#btn-cust-select')).toHaveCount(0);
  // Có chỉ dẫn nhấn-giữ.
  await expect(page.locator('#customer-list-hint')).toBeVisible();

  // Nút gọi/Zalo có accessible name kèm tên khách hàng.
  const call = page.locator('.cust-card [data-action="call"]').first();
  const zalo = page.locator('.cust-card [data-action="zalo"]').first();
  await expect(call).toHaveAttribute('aria-label', /Gọi cho/);
  await expect(zalo).toHaveAttribute('aria-label', /Zalo cho/);

  // Long-press card -> vào selection mode (không cần nút Chọn).
  // bindLongPress dùng pointer event + setTimeout thật (500ms) -> phát pointerdown
  // đúng chuẩn rồi chờ quá ngưỡng.
  const card = page.locator('.cust-card').first();
  await card.evaluate((el) => {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch',
      button: 0, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2,
    }));
  });
  await page.waitForTimeout(650); // > delay 500ms của bindLongPress

  await expect.poll(
    () => page.evaluate(() => document.body.classList.contains('cust-selection-mode')),
    { timeout: 5_000 }
  ).toBe(true);
  // Selection bar hiện ra (bỏ translate-y-full).
  await expect.poll(
    () => page.evaluate(() => {
      const b = document.getElementById('cust-selection-bar');
      return b ? !b.classList.contains('translate-y-full') : false;
    }),
    { timeout: 5_000 }
  ).toBe(true);
});

// ---------- Form ----------
test('form khách hàng: nút Hủy chỉ đóng modal, không tạo record', async ({ page }) => {
  await seedAndUnlock(page);
  await page.click('#btn-quick-add');
  await page.waitForSelector('#add-modal', { state: 'visible' });

  // Có visible label + helper "Bắt buộc"/"Không bắt buộc".
  await expect(page.locator('#add-modal label[for="new-name"]')).toContainText('Bắt buộc');
  await page.fill('#new-name', 'KHÔNG ĐƯỢC LƯU');

  // Nút Hủy dùng data-action="closeModal".
  const cancel = page.locator('#add-modal [data-action="closeModal"]').last();
  await cancel.click();
  await page.waitForSelector('#add-modal', { state: 'hidden', timeout: 10_000 });

  const total = await page.evaluate(async () => new Promise((r) => {
    const rq = db.transaction(['customers']).objectStore('customers').count();
    rq.onsuccess = (e) => r(e.target.result);
    rq.onerror = () => r(-1);
  }));
  expect(total, 'Hủy không được tạo khách hàng').toBe(0);
});

test('modal phê duyệt: có visible label + helper đơn vị', async ({ page }) => {
  await seedAndUnlock(page);
  await createCustomer(page, 'KH Phê Duyệt', '0900000001');
  await page.click('[data-action="openCustomerList"][data-arg="pending"]');
  await page.waitForSelector('#screen-customer-list', { state: 'visible' });
  await page.click('.cust-card');
  await page.waitForFunction(
    () => !document.getElementById('screen-folder').classList.contains('translate-x-full'),
    undefined, { timeout: 10_000 }
  );
  // Mở modal phê duyệt qua toggle trạng thái (KH đang thẩm định).
  await page.click('#detail-status-badge[data-action="toggleCustomerStatus"]');
  await page.waitForSelector('#approve-modal', { state: 'visible', timeout: 10_000 });
  await expect(page.locator('#approve-modal label[for="approve-limit"]')).toBeVisible();
  await expect(page.locator('#approve-modal label[for="approve-limit"]')).toContainText('Hạn mức được phê duyệt');
});

// ---------- Trung tâm sao lưu ----------
test('backup center: 2 pane Trong máy / Được gửi đến chuyển đúng; hành động không phải tab', async ({ page }) => {
  await seedAndUnlock(page);
  await page.click('[data-action="openBackupManager"]');
  await page.waitForSelector('#backup-manager-modal', { state: 'visible', timeout: 10_000 });

  // data-action cũ vẫn tồn tại.
  await expect(page.locator('#bkTabLocal[data-action="CloudTransferUI.showTab"][data-arg="local"]')).toHaveCount(1);
  await expect(page.locator('#bkTabInbox[data-action="CloudTransferUI.showTab"][data-arg="inbox"]')).toHaveCount(1);
  await expect(page.locator('[data-action="createBackupFileNow"]')).toHaveCount(1);
  await expect(page.locator('#restore-input-2[data-action="restoreData"]')).toHaveCount(1);

  // Copy segmented control.
  await expect(page.locator('#bkTabLocal')).toContainText('Trong máy');
  await expect(page.locator('#bkTabInbox')).toContainText('Được gửi đến');

  // Không hiển thị mẫu tên file kỹ thuật ở giao diện chính (đưa vào title).
  const bodyText = await page.locator('#backup-manager-modal').innerText();
  expect(bodyText).not.toContain('CLIENTPRO_BK_{DEVICEID}');

  // Chuyển pane: mặc định local hiện; chọn inbox -> inbox pane hiện, local ẩn.
  await page.click('#bkTabInbox');
  await expect.poll(() => page.evaluate(() => document.getElementById('inbox-backup-pane').classList.contains('hidden'))).toBe(false);
  await expect.poll(() => page.evaluate(() => document.getElementById('local-backup-pane').classList.contains('hidden'))).toBe(true);
  await page.click('#bkTabLocal');
  await expect.poll(() => page.evaluate(() => document.getElementById('local-backup-pane').classList.contains('hidden'))).toBe(false);
});

// ---------- Tham khảo giá: khoảng cách đường bộ (không lộ đường chim bay) ----------
test('tham khảo giá: pending/success/failed hiển thị đúng, không lộ khoảng cách chim bay', async ({ page }) => {
  await page.addInitScript(() => {
    const o = sessionStorage.getItem.bind(sessionStorage);
    sessionStorage.getItem = (k) => (k && k.indexOf('clientpro_sw_reloaded_') === 0) ? '1' : o(k);
  });
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#ref-price-modal', { state: 'attached', timeout: 10_000 });

  const sample = [{ valuation: 1000, assetName: 'Tài sản A', customerName: 'Khách C', area: 120, width: 5, distance: 3250, straight: 3250 }];

  // pending: đang tính, KHÔNG có "Cách ... theo đường bộ".
  await page.evaluate((r) => showRefModal(r, { road: 'pending' }), sample);
  let txt = await page.locator('#ref-results').innerText();
  expect(txt).toContain('Đang tính khoảng cách đường bộ');
  expect(txt).not.toContain('theo đường bộ');
  expect(txt).not.toMatch(/Cách\s+[\d.,]+\s*(m|km)/);

  // success: có "theo đường bộ" + số km (dấu phẩy vi-VN).
  await page.evaluate((r) => showRefModal(r.map((x) => ({ ...x, roadOk: true })), { road: 'done' }), sample);
  txt = await page.locator('#ref-results').innerText();
  expect(txt).toContain('theo đường bộ');
  expect(txt).toContain('3,25 km');

  // failed: báo chưa tính được, không lộ số chim bay.
  await page.evaluate((r) => showRefModal(r, { road: 'failed' }), sample);
  txt = await page.locator('#ref-results').innerText();
  expect(txt).toContain('Chưa tính được khoảng cách đường bộ');
  expect(txt).not.toMatch(/Cách\s+[\d.,]+\s*(m|km)/);

  // Copy D4: "Khách hàng:" thay cho "KH:".
  expect(txt).toContain('Khách hàng:');
  expect(txt).not.toContain('KH:');
});

// ---------- Bàn phím PIN ----------
test('PIN: không có nút trống nhận focus; nút xóa có accessible name', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('app_activated', 'true');
    localStorage.setItem('app_employee_id', 'TEST');
    const o = sessionStorage.getItem.bind(sessionStorage);
    sessionStorage.getItem = (k) => (k && k.indexOf('clientpro_sw_reloaded_') === 0) ? '1' : o(k);
  });
  await page.addInitScript((env) => { localStorage.setItem('app_pin', env); localStorage.setItem('app_crypto_schema_v', '2'); }, PIN_ENVELOPE);
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-lock', { state: 'visible', timeout: 10_000 });

  // Bàn phím có đúng 11 nút bấm (10 số + xóa); ô trống là <div>, không phải button.
  await expect(page.locator('#pin-keypad button')).toHaveCount(11);
  await expect(page.locator('#pin-keypad .keypad-spacer')).toHaveCount(1);
  const spacerTag = await page.locator('#pin-keypad .keypad-spacer').evaluate((el) => el.tagName.toLowerCase());
  expect(spacerTag).not.toBe('button');

  // Nút xóa có accessible name.
  await expect(page.locator('#pin-keypad [data-action="backspacePin"]')).toHaveAttribute('aria-label', /Xóa/);
});

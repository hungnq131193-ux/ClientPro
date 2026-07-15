// End-to-end kịch bản thật (P2 + P3): seed trạng thái đã kích hoạt + PIN envelope,
// mở khóa bằng PIN qua bàn phím, tạo khách hàng, rồi KIỂM CHỨNG trong IndexedDB rằng
// dữ liệu được mã hóa AES-GCM ("cpg1:") và giải mã lại đúng — chứng minh toàn bộ
// đường ống mã hóa chạy trong TRÌNH DUYỆT thật, không chỉ trong node test.
const { test, expect } = require('@playwright/test');
const { loadSecurity } = require('../tests/helpers/load-security');

const PIN = '123456';
let PIN_ENVELOPE;

test.beforeAll(async () => {
  // Sinh envelope v2 THẬT (PBKDF2 + AES-GCM) niêm phong masterKey MK2 dưới PIN.
  const { api } = loadSecurity();
  const mk = api.generateMasterKey();
  PIN_ENVELOPE = await api.sealMasterKey(PIN, mk);
});

test('mở khóa PIN + tạo khách hàng -> IndexedDB lưu AES-GCM và giải mã đúng', async ({ page }) => {
  await page.addInitScript((env) => {
    localStorage.setItem('app_activated', 'true');
    localStorage.setItem('app_employee_id', 'TEST');
    localStorage.setItem('app_pin', env);
    localStorage.setItem('app_crypto_schema_v', '2'); // dữ liệu mới -> bỏ qua migration
    // Chặn reload-once của SW để test ổn định.
    const o = sessionStorage.getItem.bind(sessionStorage);
    sessionStorage.getItem = (k) => (k && k.indexOf('clientpro_sw_reloaded_') === 0) ? '1' : o(k);
  }, PIN_ENVELOPE);

  await page.goto('/index.html', { waitUntil: 'networkidle' });

  // Màn khóa hiển thị -> nhập PIN 6 số qua bàn phím.
  await page.waitForSelector('#screen-lock', { state: 'visible', timeout: 10_000 });
  for (const d of PIN) await page.click(`[data-action="enterPin"][data-arg="${d}"]`);

  // Mở khóa thành công -> màn khóa ẩn.
  await page.waitForSelector('#screen-lock', { state: 'hidden', timeout: 10_000 });

  // Tạo khách hàng qua UI.
  await page.click('#btn-quick-add');
  await page.waitForSelector('#add-modal', { state: 'visible' });
  await page.fill('#new-name', 'Nguyễn Văn E2E');
  await page.fill('#new-phone', '0912345678');
  await page.click('[data-action="saveCustomer"]');
  await page.waitForSelector('#add-modal', { state: 'hidden', timeout: 10_000 });

  // Kiểm chứng ở tầng lưu trữ: name mã hóa cpg1:, cryptoV:2, và giải mã lại đúng.
  const res = await page.evaluate(async () => {
    const all = await new Promise((r) => {
      const rq = db.transaction(['customers']).objectStore('customers').getAll();
      rq.onsuccess = (e) => r(e.target.result || []);
      rq.onerror = () => r([]);
    });
    const c = all.find((x) => decryptText(x.name) === 'Nguyễn Văn E2E');
    return {
      total: all.length,
      found: !!c,
      encrypted: c ? String(c.name).startsWith('cpg1:') : false,
      cryptoV: c ? c.cryptoV : null,
      phone: c ? decryptText(c.phone) : null,
    };
  });

  expect(res.found, 'Phải tìm thấy khách hàng vừa tạo').toBeTruthy();
  expect(res.encrypted, 'Tên phải được mã hóa AES-GCM (cpg1:) ở tầng lưu trữ').toBeTruthy();
  expect(res.cryptoV).toBe(2);
  expect(res.phone).toBe('0912345678');
});

// B9 + B8: search reset khi mở lại danh sách; xóa hồ sơ không reload trang và
// báo đúng kết quả.
test('B9/B8: mở lại danh sách reset tìm kiếm; xóa KH không reload, danh sách cập nhật', async ({ page }) => {
  await page.addInitScript((env) => {
    localStorage.setItem('app_activated', 'true');
    localStorage.setItem('app_employee_id', 'TEST');
    localStorage.setItem('app_pin', env);
    localStorage.setItem('app_crypto_schema_v', '2');
    // Tắt onboarding tour để tooltip z-[1002] không che các nút cần bấm.
    localStorage.setItem('clientpro_onboarding_done', JSON.stringify({ version: 2, completedAt: Date.now() }));
    const o = sessionStorage.getItem.bind(sessionStorage);
    sessionStorage.getItem = (k) => (k && k.indexOf('clientpro_sw_reloaded_') === 0) ? '1' : o(k);
  }, PIN_ENVELOPE);

  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-lock', { state: 'visible', timeout: 10_000 });
  for (const d of PIN) await page.click(`[data-action="enterPin"][data-arg="${d}"]`);
  await page.waitForSelector('#screen-lock', { state: 'hidden', timeout: 10_000 });

  // Tạo một khách hàng để có dữ liệu trong danh sách.
  await page.click('#btn-quick-add');
  await page.waitForSelector('#add-modal', { state: 'visible' });
  await page.fill('#new-name', 'KH Kiểm Thử B9');
  await page.fill('#new-phone', '0900000009');
  await page.click('[data-action="saveCustomer"]');
  await page.waitForSelector('#add-modal', { state: 'hidden', timeout: 10_000 });

  // Sau khi tạo, app tự mở màn hồ sơ của KH mới -> đóng lại để về dashboard.
  await page.waitForFunction(
    () => !document.getElementById('screen-folder').classList.contains('translate-x-full'),
    undefined, { timeout: 10_000 }
  );
  await page.click('#screen-folder [data-action="closeFolder"]');
  await page.waitForFunction(
    () => document.getElementById('screen-folder').classList.contains('translate-x-full'),
    undefined, { timeout: 10_000 }
  );

  // Mở danh sách "đang thẩm định", tìm chuỗi không khớp -> danh sách rỗng.
  await page.click('[data-action="openCustomerList"][data-arg="pending"]');
  await page.waitForSelector('#screen-customer-list', { state: 'visible' });
  await expect(page.locator('.cust-card')).toHaveCount(1, { timeout: 10_000 });
  await page.fill('#search-input', 'zzz-khong-khop');
  await expect(page.locator('.cust-card')).toHaveCount(0, { timeout: 10_000 });

  // Đóng rồi mở lại NGAY (trước cả khi debounce kịp chạy thêm) -> ô tìm kiếm phải
  // rỗng và danh sách hiển thị đầy đủ, không bị callback search cũ ghi đè.
  await page.click('[data-action="closeCustomerList"]');
  await page.click('[data-action="openCustomerList"][data-arg="pending"]');
  await expect(page.locator('#search-input')).toHaveValue('');
  await expect(page.locator('.cust-card')).toHaveCount(1, { timeout: 10_000 });
  // Chờ quá cửa sổ debounce (180ms) để chắc chắn không còn callback cũ ghi đè.
  await page.waitForTimeout(400);
  await expect(page.locator('.cust-card')).toHaveCount(1);

  // B8: xóa hồ sơ qua confirm — không được reload trang, item biến mất sau commit.
  // Marker trên window: reload thật sẽ xóa marker (history.pushState của
  // edge-back-swipe làm framenavigated bắn nhầm nên không dùng được).
  await page.evaluate(() => { window.__noReloadMarker = true; });
  await page.click('.cust-card');
  // #screen-folder ẩn bằng translate-x-full (không phải display:none) -> chờ class biến mất.
  await page.waitForFunction(
    () => !document.getElementById('screen-folder').classList.contains('translate-x-full'),
    undefined, { timeout: 10_000 }
  );
  await page.click('[data-action="deleteCurrentCustomer"]');
  await page.waitForSelector('.cp-confirm-overlay', { state: 'visible' });
  await page.click('.cp-confirm-overlay .cp-confirm-ok');
  await expect(page.locator('.cust-card')).toHaveCount(0, { timeout: 10_000 });
  const markerAlive = await page.evaluate(() => window.__noReloadMarker === true);
  expect(markerAlive, 'Xóa hồ sơ không được reload trang').toBeTruthy();

  // Database thật sự trống.
  const total = await page.evaluate(async () => new Promise((r) => {
    const rq = db.transaction(['customers']).objectStore('customers').count();
    rq.onsuccess = (e) => r(e.target.result);
    rq.onerror = () => r(-1);
  }));
  expect(total).toBe(0);
});

// B4: duyệt hạn mức qua UI -> IndexedDB lưu creditLimit mã hóa (cpg1:) nhưng
// badge hiển thị plaintext; thêm TSBĐ -> asset.name mã hóa at rest.
test('B4: creditLimit + asset.name mã hóa at rest, UI hiển thị plaintext', async ({ page }) => {
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

  // Tạo khách hàng -> app tự mở màn hồ sơ.
  await page.click('#btn-quick-add');
  await page.waitForSelector('#add-modal', { state: 'visible' });
  await page.fill('#new-name', 'KH B4 Test');
  await page.fill('#new-phone', '0904444444');
  await page.click('[data-action="saveCustomer"]');
  await page.waitForSelector('#add-modal', { state: 'hidden', timeout: 10_000 });
  await page.waitForFunction(() => !document.getElementById('screen-folder').classList.contains('translate-x-full'));

  // Duyệt hạn mức qua UI.
  await page.click('[data-action="toggleCustomerStatus"]');
  await page.waitForSelector('#approve-modal', { state: 'visible' });
  await page.fill('#approve-limit', '500 triệu');
  await page.click('[data-action="confirmApproval"]');
  await page.waitForSelector('#approve-modal', { state: 'hidden', timeout: 10_000 });

  // Badge hiển thị plaintext hạn mức.
  await expect(page.locator('#detail-status-badge .badge-value')).toHaveText('500 triệu', { timeout: 10_000 });

  // Thêm một TSBĐ (nút nằm trong tab TSBĐ).
  await page.click('#tab-btn-assets');
  await page.click('[data-action="openAssetModal"]');
  await page.waitForSelector('#asset-modal', { state: 'visible' });
  await page.fill('#asset-name', 'Nhà đất B4 50m²');
  await page.click('#btn-save-asset');
  await page.waitForSelector('#asset-modal', { state: 'hidden', timeout: 10_000 });

  // Tầng lưu trữ: creditLimit + asset.name phải là ciphertext cpg1:, decrypt lại đúng.
  const res = await page.evaluate(async () => {
    const all = await new Promise((r) => {
      const rq = db.transaction(['customers']).objectStore('customers').getAll();
      rq.onsuccess = (e) => r(e.target.result || []);
      rq.onerror = () => r([]);
    });
    const c = all[0];
    return {
      limitEncrypted: String(c.creditLimit).startsWith('cpg1:'),
      limitPlain: await decryptFieldAsync(c.creditLimit),
      assetNameEncrypted: c.assets && c.assets[0] ? String(c.assets[0].name).startsWith('cpg1:') : null,
      assetNamePlain: c.assets && c.assets[0] ? await decryptFieldAsync(c.assets[0].name) : null,
    };
  });
  expect(res.limitEncrypted, 'creditLimit phải mã hóa at rest').toBeTruthy();
  expect(res.limitPlain).toBe('500 triệu');
  expect(res.assetNameEncrypted, 'asset.name phải mã hóa at rest').toBeTruthy();
  expect(res.assetNamePlain).toBe('Nhà đất B4 50m²');

  // UI danh sách TSBĐ hiển thị plaintext (không ciphertext, không kẹt fallback).
  await expect(page.locator('#content-assets .asset-name').first()).toHaveText('Nhà đất B4 50m²');
});

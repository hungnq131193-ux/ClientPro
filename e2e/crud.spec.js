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

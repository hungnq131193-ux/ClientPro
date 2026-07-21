// e2e/pdf-toolkit.spec.js
// ============================================================================
// E2E cho PDF Toolkit: mở từ Dashboard, 6 công cụ, xử lý trên thiết bị, back
// gesture, khóa app giữa chừng, offline, và KHÔNG phát sinh uncaught exception.
// Dùng chung cơ chế seed PIN như crud.spec.js.
// ============================================================================
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { loadSecurity } = require('../tests/helpers/load-security');

const PIN = '123456';
let PIN_ENVELOPE;

const FIX = (f) => path.resolve(__dirname, 'fixtures', f);

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
    const o = sessionStorage.getItem.bind(sessionStorage);
    sessionStorage.getItem = (k) => (k && k.indexOf('clientpro_sw_reloaded_') === 0) ? '1' : o(k);
  }, PIN_ENVELOPE);
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#screen-lock', { state: 'visible', timeout: 10000 });
  for (const d of PIN) await page.click(`[data-action="enterPin"][data-arg="${d}"]`);
  await page.waitForSelector('#screen-lock', { state: 'hidden', timeout: 10000 });
}

async function openToolkit(page) {
  await page.click('#btn-quick-pdf');
  await page.waitForSelector('#screen-pdf-toolkit', { state: 'visible' });
  await page.waitForFunction(() => {
    const s = document.getElementById('screen-pdf-toolkit');
    return s && !s.classList.contains('translate-x-full');
  });
}

async function openTool(page, name) {
  await page.click(`.pdftk-tool-card:has-text("${name}")`);
  await page.waitForFunction(() => {
    const tv = document.querySelector('#screen-pdf-toolkit .pdftk-tool-view');
    return tv && tv.style.display !== 'none' && tv.children.length > 0;
  });
}

function attachErrorGuard(page, bag) {
  page.on('pageerror', (e) => bag.push(String(e)));
}

// Bấm nút xuất -> chờ panel kết quả -> bấm "Tải xuống" -> trả bytes đầu file.
// (Xuất chỉ tạo panel kết quả; tải file là hành động thứ hai.)
async function grabDownloadHead(page, exportSelector) {
  await page.click(exportSelector);
  await page.waitForSelector('#screen-pdf-toolkit .pdftk-result', { timeout: 25000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#screen-pdf-toolkit .pdftk-result button:has-text("Tải")'),
  ]);
  const p = await download.path();
  return fs.readFileSync(p);
}

test('Mở PDF Toolkit từ Dashboard rồi quay lại', async ({ page }) => {
  const errors = []; attachErrorGuard(page, errors);
  await seedAndUnlock(page);
  await openToolkit(page);
  await expect(page.locator('.pdftk-tool-grid .pdftk-tool-card')).toHaveCount(6);
  // Quay lại Dashboard bằng nút back.
  await page.click('#screen-pdf-toolkit .pdftk-back-btn');
  await page.waitForFunction(() => document.getElementById('screen-pdf-toolkit').classList.contains('translate-x-full'));
  expect(errors, errors.join(' | ')).toEqual([]);
});

test('Ghép hai PDF + đổi thứ tự -> file %PDF hợp lệ', async ({ page }) => {
  const errors = []; attachErrorGuard(page, errors);
  await seedAndUnlock(page);
  await openToolkit(page);
  await openTool(page, 'Ghép PDF');
  await page.locator('#screen-pdf-toolkit input[type=file]').setInputFiles([FIX('sample-3p.pdf'), FIX('sample-1p.pdf')]);
  // Chờ đọc metadata (2 dòng file, không lỗi).
  await page.waitForFunction(() => document.querySelectorAll('#screen-pdf-toolkit .pdftk-file-row').length === 2);
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('#screen-pdf-toolkit .pdftk-file-meta');
    return rows.length === 2 && Array.from(rows).every((r) => /trang/.test(r.textContent));
  }, null, { timeout: 20000 });
  // Đổi thứ tự: đưa file thứ 2 lên trên.
  await page.click('#screen-pdf-toolkit .pdftk-file-row:nth-child(2) [aria-label="Lên"]');
  const firstName = await page.locator('#screen-pdf-toolkit .pdftk-file-row:nth-child(1) .pdftk-file-name').textContent();
  expect(firstName).toContain('sample-1p');
  // Ghép + tải.
  const buf = await grabDownloadHead(page, '#screen-pdf-toolkit .pdftk-tool-view button:has-text("Ghép")');
  expect(buf.slice(0, 5).toString('latin1')).toBe('%PDF-');
  expect(errors, errors.join(' | ')).toEqual([]);
});

test('Tách PDF: chọn trang qua thumbnail -> %PDF', async ({ page }) => {
  const errors = []; attachErrorGuard(page, errors);
  await seedAndUnlock(page);
  await openToolkit(page);
  await openTool(page, 'Tách PDF');
  await page.locator('#screen-pdf-toolkit input[type=file]').setInputFiles(FIX('sample-3p.pdf'));
  await page.waitForFunction(() => document.querySelectorAll('#screen-pdf-toolkit .pdftk-page-cell').length === 3, null, { timeout: 20000 });
  // Chọn trang 1 và 3 qua thumbnail.
  await page.click('#screen-pdf-toolkit .pdftk-page-cell:nth-child(1)');
  await page.click('#screen-pdf-toolkit .pdftk-page-cell:nth-child(3)');
  await expect(page.locator('#screen-pdf-toolkit .pdftk-page-cell.is-selected')).toHaveCount(2);
  const buf = await grabDownloadHead(page, '#screen-pdf-toolkit .pdftk-tool-view button:has-text("Xuất 1 file PDF")');
  expect(buf.slice(0, 5).toString('latin1')).toBe('%PDF-');
  expect(errors, errors.join(' | ')).toEqual([]);
});

test('Sắp xếp trang: xoay, xóa, hoàn tác, đặt lại, xuất -> %PDF', async ({ page }) => {
  const errors = []; attachErrorGuard(page, errors);
  await seedAndUnlock(page);
  await openToolkit(page);
  await openTool(page, 'Sắp xếp trang');
  await page.locator('#screen-pdf-toolkit input[type=file]').setInputFiles(FIX('sample-3p.pdf'));
  await page.waitForFunction(() => document.querySelectorAll('#screen-pdf-toolkit .pdftk-page-cell').length === 3, null, { timeout: 20000 });
  // Xoay phải trang 1.
  await page.click('#screen-pdf-toolkit .pdftk-page-cell:nth-child(1) [aria-label="Sang phải"]');
  // Xóa trang 2.
  await page.click('#screen-pdf-toolkit .pdftk-page-cell:nth-child(2) [aria-label="Xóa"]');
  await expect(page.locator('#screen-pdf-toolkit .pdftk-page-cell')).toHaveCount(2);
  // Hoàn tác -> trở lại 3 trang.
  await page.click('#screen-pdf-toolkit .pdftk-tool-view button:has-text("Hoàn tác")');
  await expect(page.locator('#screen-pdf-toolkit .pdftk-page-cell')).toHaveCount(3);
  // Đặt lại (confirm).
  await page.click('#screen-pdf-toolkit .pdftk-tool-view button:has-text("Đặt lại")');
  await page.click('.cp-confirm-ok');
  await expect(page.locator('#screen-pdf-toolkit .pdftk-page-cell')).toHaveCount(3);
  const buf = await grabDownloadHead(page, '#screen-pdf-toolkit .pdftk-tool-view button:has-text("Xuất PDF mới")');
  expect(buf.slice(0, 5).toString('latin1')).toBe('%PDF-');
  expect(errors, errors.join(' | ')).toEqual([]);
});

test('Ảnh thành PDF -> %PDF', async ({ page }) => {
  const errors = []; attachErrorGuard(page, errors);
  await seedAndUnlock(page);
  await openToolkit(page);
  await openTool(page, 'Ảnh thành PDF');
  await page.locator('#screen-pdf-toolkit input[type=file]').setInputFiles([FIX('sample.png'), FIX('sample.png')]);
  await page.waitForFunction(() => document.querySelectorAll('#screen-pdf-toolkit .pdftk-thumb-cell').length === 2, null, { timeout: 20000 });
  const buf = await grabDownloadHead(page, '#screen-pdf-toolkit .pdftk-tool-view button:has-text("Xuất PDF")');
  expect(buf.slice(0, 5).toString('latin1')).toBe('%PDF-');
  expect(errors, errors.join(' | ')).toEqual([]);
});

test('PDF thành ảnh (1 trang) -> ảnh hợp lệ', async ({ page }) => {
  const errors = []; attachErrorGuard(page, errors);
  await seedAndUnlock(page);
  await openToolkit(page);
  await openTool(page, 'PDF thành ảnh');
  await page.locator('#screen-pdf-toolkit input[type=file]').setInputFiles(FIX('sample-3p.pdf'));
  await page.waitForFunction(() => /trang/.test((document.querySelector('#screen-pdf-toolkit .pdftk-doc-info') || {}).textContent || ''), null, { timeout: 20000 });
  // Chỉ xuất trang 1 (một ảnh, không ZIP).
  await page.locator('#screen-pdf-toolkit .pdftk-input').first().fill('1');
  const buf = await grabDownloadHead(page, '#screen-pdf-toolkit .pdftk-tool-view button:has-text("Xuất ảnh")');
  const head = buf.slice(0, 3).toString('hex');
  expect(head.startsWith('ffd8ff') || buf.slice(0, 4).toString('hex') === '89504e47').toBeTruthy();
  expect(errors, errors.join(' | ')).toEqual([]);
});

test('Nén PDF (chế độ tối ưu) -> hiển thị so sánh dung lượng', async ({ page }) => {
  const errors = []; attachErrorGuard(page, errors);
  await seedAndUnlock(page);
  await openToolkit(page);
  await openTool(page, 'Nén PDF');
  await page.locator('#screen-pdf-toolkit input[type=file]').setInputFiles(FIX('sample-3p.pdf'));
  await page.waitForFunction(() => /trang/.test((document.querySelector('#screen-pdf-toolkit .pdftk-doc-info') || {}).textContent || ''), null, { timeout: 20000 });
  await page.click('#screen-pdf-toolkit .pdftk-tool-view button:has-text("Nén PDF")');
  await page.waitForSelector('#screen-pdf-toolkit .pdftk-compare', { timeout: 20000 });
  await expect(page.locator('#screen-pdf-toolkit .pdftk-compare-row')).toHaveCount(3);
  expect(errors, errors.join(' | ')).toEqual([]);
});

test('Back gesture đóng đúng lớp; khóa app reset toolkit', async ({ page }) => {
  const errors = []; attachErrorGuard(page, errors);
  await seedAndUnlock(page);
  await openToolkit(page);
  await openTool(page, 'Ghép PDF');
  // Back (popstate) khi đang ở trong tool -> quay về lưới tool, màn hình vẫn mở.
  await page.evaluate(() => window.pdfToolkitHandleBack());
  await page.waitForFunction(() => {
    const tv = document.querySelector('#screen-pdf-toolkit .pdftk-tool-view');
    return tv && tv.style.display === 'none';
  });
  await expect(page.locator('#screen-pdf-toolkit')).not.toHaveClass(/translate-x-full/);
  // Back lần nữa -> đóng màn hình.
  await page.evaluate(() => window.pdfToolkitHandleBack());
  await page.waitForFunction(() => document.getElementById('screen-pdf-toolkit').classList.contains('translate-x-full'));

  // Mở lại rồi khóa app -> toolkit phải reset (ẩn).
  await openToolkit(page);
  await openTool(page, 'Ghép PDF');
  await page.evaluate(() => { if (typeof lockApp === 'function') lockApp(); });
  await page.waitForFunction(() => document.getElementById('screen-pdf-toolkit').classList.contains('translate-x-full'));
  await page.waitForSelector('#screen-lock', { state: 'visible' });
  expect(errors, errors.join(' | ')).toEqual([]);
});

test('Offline: mở lại app rồi ghép PDF vẫn hoạt động', async ({ page, context }) => {
  const errors = []; attachErrorGuard(page, errors);
  await seedAndUnlock(page);
  // Mở toolkit một lần để nạp + cache vendor.
  await openToolkit(page);
  await openTool(page, 'Ghép PDF');
  await page.locator('#screen-pdf-toolkit input[type=file]').setInputFiles([FIX('sample-3p.pdf'), FIX('sample-1p.pdf')]);
  await page.waitForFunction(() => document.querySelectorAll('#screen-pdf-toolkit .pdftk-file-row').length === 2, null, { timeout: 20000 });
  // Vendor đã nạp (fetch qua mạng -> vào runtime cache) trước khi ngắt mạng.
  await page.waitForFunction(() => !!(window.__PdfTK && window.__PdfTK.vendor && window.__PdfTK.vendor.pdfjsLib), null, { timeout: 20000 });
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
  // Chờ SW thực sự cache xong app shell + module + vendor PDF (khớp bất kể ?v=).
  await page.waitForFunction(async () => {
    if (!('caches' in window)) return false;
    const need = [
      './index.html',
      './assets/pdf-toolkit/pdf_toolkit_ui.js',
      './assets/pdf-toolkit/pdf_toolkit_core.js',
      './assets/vendor/pdf-lib.min.js',
      './assets/vendor/jszip.min.js',
      './assets/vendor/pdf.min.mjs',
      './assets/vendor/pdf.worker.min.mjs',
    ];
    const keys = await caches.keys();
    for (const rel of need) {
      const url = new URL(rel, location.href).href;
      let found = false;
      for (const k of keys) {
        const c = await caches.open(k);
        if (await c.match(url, { ignoreSearch: true })) { found = true; break; }
      }
      if (!found) return false;
    }
    return true;
  }, null, { timeout: 30000 });

  // Ngắt mạng và tải lại.
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#screen-lock', { state: 'visible', timeout: 10000 });
  for (const d of PIN) await page.click(`[data-action="enterPin"][data-arg="${d}"]`);
  await page.waitForSelector('#screen-lock', { state: 'hidden', timeout: 10000 });

  await openToolkit(page);
  await openTool(page, 'Ghép PDF');
  await page.locator('#screen-pdf-toolkit input[type=file]').setInputFiles([FIX('sample-3p.pdf'), FIX('sample-1p.pdf')]);
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('#screen-pdf-toolkit .pdftk-file-meta');
    return rows.length === 2 && Array.from(rows).every((r) => /trang/.test(r.textContent));
  }, null, { timeout: 20000 });
  const buf = await grabDownloadHead(page, '#screen-pdf-toolkit .pdftk-tool-view button:has-text("Ghép")');
  expect(buf.slice(0, 5).toString('latin1')).toBe('%PDF-');
  await context.setOffline(false);
  expect(errors, errors.join(' | ')).toEqual([]);
});

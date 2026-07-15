// E2E cho A3: layering contract — #loader (z=250) phải phủ TRÊN business modal
// (z=200); màn khóa (z=300) và confirm (z=600) phải nằm TRÊN loader; loader ẩn
// không được chặn touch.
const { test, expect } = require('@playwright/test');
const { loadSecurity } = require('../tests/helpers/load-security');

const PIN = '123456';
let PIN_ENVELOPE;

test.beforeAll(async () => {
  const { api } = loadSecurity();
  const mk = api.generateMasterKey();
  PIN_ENVELOPE = await api.sealMasterKey(PIN, mk);
});

async function unlock(page) {
  await page.addInitScript((env) => {
    localStorage.setItem('app_activated', 'true');
    localStorage.setItem('app_employee_id', 'TEST');
    localStorage.setItem('app_pin', env);
    localStorage.setItem('app_crypto_schema_v', '2');
    localStorage.setItem('clientpro_onboarding_done', JSON.stringify({ version: 3, completedAt: Date.now() }));
    const o = sessionStorage.getItem.bind(sessionStorage);
    sessionStorage.getItem = (k) => (k && k.indexOf('clientpro_sw_reloaded_') === 0) ? '1' : o(k);
  }, PIN_ENVELOPE);
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-lock', { state: 'visible', timeout: 10_000 });
  for (const d of PIN) await page.click(`[data-action="enterPin"][data-arg="${d}"]`);
  await page.waitForSelector('#screen-lock', { state: 'hidden', timeout: 10_000 });
}

test('loader phủ trên business modal đang mở (Backup Manager)', async ({ page }) => {
  await unlock(page);
  const res = await page.evaluate(() => {
    // Mở Backup Manager modal rồi bật global loader.
    const modal = document.getElementById('backup-manager-modal');
    if (!modal) return { error: 'no modal element' };
    modal.classList.remove('hidden');
    LoadingManager.showGlobal('Test loader');
    const vw = window.innerWidth, vh = window.innerHeight;
    const topEl = document.elementFromPoint(vw / 2, vh / 2);
    const loader = document.getElementById('loader');
    const inLoader = !!(topEl && loader.contains(topEl));
    const zLoader = parseInt(getComputedStyle(loader).zIndex, 10);
    const zModal = parseInt(getComputedStyle(modal).zIndex, 10);
    LoadingManager.hideGlobal(true);
    modal.classList.add('hidden');
    return { inLoader, zLoader, zModal };
  });
  expect(res.error).toBeUndefined();
  expect(res.zLoader, 'z-index loader phải lớn hơn business modal').toBeGreaterThan(res.zModal);
  expect(res.inLoader, 'elementFromPoint giữa màn hình phải thuộc #loader').toBeTruthy();
});

test('màn khóa và confirm nằm trên loader; loader ẩn không chặn touch', async ({ page }) => {
  await unlock(page);
  const res = await page.evaluate(async () => {
    const out = {};
    const loader = document.getElementById('loader');
    const lock = document.getElementById('screen-lock');
    out.zLoader = parseInt(getComputedStyle(loader).zIndex, 10);
    // screen-lock đang hidden — đọc z-index qua class z-[300] bằng cách hiện tạm.
    lock.classList.remove('hidden');
    out.zLock = parseInt(getComputedStyle(lock).zIndex, 10);
    lock.classList.add('hidden');

    // Confirm phải trên loader.
    LoadingManager.showGlobal('Test');
    const p = window.showConfirm('Layer test?', { title: 'L' });
    await new Promise((r) => setTimeout(r, 350));
    const overlay = document.querySelector('.cp-confirm-overlay');
    out.zConfirm = overlay ? parseInt(getComputedStyle(overlay).zIndex, 10) : -1;
    const okBtn = overlay && overlay.querySelector('.cp-confirm-ok');
    const okBox = okBtn && okBtn.getBoundingClientRect();
    const topAtOk = okBox && document.elementFromPoint(okBox.x + okBox.width / 2, okBox.y + okBox.height / 2);
    out.confirmClickable = !!(topAtOk && (topAtOk === okBtn || okBtn.contains(topAtOk)));
    if (okBtn) okBtn.click();
    await p;
    LoadingManager.hideGlobal(true);

    // Loader ẩn không chặn touch: elementFromPoint không được trả về loader.
    const topEl = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    out.hiddenLoaderBlocks = !!(topEl && loader.contains(topEl));
    return out;
  });
  expect(res.zLock, 'Màn khóa phải trên loader').toBeGreaterThan(res.zLoader);
  expect(res.zConfirm, 'Confirm phải trên loader').toBeGreaterThan(res.zLoader);
  expect(res.confirmClickable, 'Nút confirm phải bấm được khi loader đang bật').toBeTruthy();
  expect(res.hiddenLoaderBlocks, 'Loader ẩn không được chặn touch').toBeFalsy();
});

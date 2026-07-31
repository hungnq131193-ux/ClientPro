// E2E cho B5: ClientProConfirm — confirm mới thay confirm cũ thì Promise cũ phải
// resolve(false) (không treo), chỉ còn MỘT overlay, và Escape/nút vẫn hoạt động.
// Không cần mở khóa: hộp thoại confirm thuộc tầng 19_error_loading, chạy được
// ngay trên màn hình đầu.
const { test, expect } = require('@playwright/test');

test('confirm chồng confirm: promise cũ resolve(false), chỉ một overlay, Escape hoạt động', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof window.showConfirm === 'function');

  const result = await page.evaluate(async () => {
    const out = {};
    // Mở confirm 1 rồi confirm 2 gần như đồng thời.
    const p1 = window.showConfirm('Confirm 1?', { title: 'C1' });
    const p2 = window.showConfirm('Confirm 2?', { title: 'C2' });

    // Promise 1 phải resolve NGAY (false) khi bị confirm 2 thay thế — race với timeout.
    out.p1 = await Promise.race([
      p1.then((v) => ({ resolved: true, value: v })),
      new Promise((r) => setTimeout(() => r({ resolved: false }), 1500)),
    ]);
    // Overlay cũ được gỡ sau animation (afterEnd fallback 400ms) -> chờ rồi mới đếm.
    await new Promise((r) => setTimeout(r, 600));
    out.overlayCount = document.querySelectorAll('.cp-confirm-overlay').length;

    // Escape phải đóng confirm 2 (cancel) — chứng minh listener của confirm 1 không
    // còn chặn/capture sự kiện.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    out.p2 = await Promise.race([
      p2.then((v) => ({ resolved: true, value: v })),
      new Promise((r) => setTimeout(() => r({ resolved: false }), 1500)),
    ]);

    // Sau khi cancel, confirm tiếp theo vẫn dùng được bình thường (bấm nút Đồng ý).
    // Mở NGAY (không chờ afterEnd 400ms) — đây là race Escape→confirm mới.
    const p3 = window.showConfirm('Confirm 3?', { title: 'C3' });
    out.overlayCountAfterEscapeOpen = document.querySelectorAll('.cp-confirm-overlay').length;
    await new Promise((r) => setTimeout(r, 50));
    // Luôn bấm nút của overlay CUỐI (mới nhất) — không querySelector nút của orphan cũ.
    const overlays = document.querySelectorAll('.cp-confirm-overlay');
    const ok = overlays.length
      ? overlays[overlays.length - 1].querySelector('.cp-confirm-ok')
      : null;
    if (ok) ok.click();
    out.p3 = await Promise.race([
      p3.then((v) => ({ resolved: true, value: v })),
      new Promise((r) => setTimeout(() => r({ resolved: false }), 1500)),
    ]);
    return out;
  });

  expect(result.p1, 'Confirm bị thay thế phải resolve ngay').toEqual({ resolved: true, value: false });
  expect(result.overlayCount, 'Chỉ được còn một overlay confirm').toBe(1);
  expect(result.p2, 'Escape phải cancel confirm đang mở').toEqual({ resolved: true, value: false });
  expect(result.overlayCountAfterEscapeOpen, 'Escape rồi mở confirm mới: chỉ 1 overlay').toBe(1);
  expect(result.p3, 'Confirm sau đó vẫn hoạt động (Đồng ý)').toEqual({ resolved: true, value: true });
});

// Regression: confirm cũ được gỡ ĐỒNG BỘ khi bị thay — KHÔNG có cửa sổ animation nào
// tồn tại 2 .cp-confirm-overlay (trợ năng / thao tác chọn nhầm hộp cũ).
test('confirm chồng confirm: không bao giờ có 2 overlay cùng lúc (đo NGAY, không chờ)', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof window.showConfirm === 'function');

  const counts = await page.evaluate(async () => {
    const seen = [];
    window.showConfirm('A?', { title: 'A' });
    // Đo NGAY sau khi mở confirm thứ 2, không chờ animation thoát của confirm 1.
    window.showConfirm('B?', { title: 'B' });
    seen.push(document.querySelectorAll('.cp-confirm-overlay').length);
    window.showConfirm('C?', { title: 'C' });
    seen.push(document.querySelectorAll('.cp-confirm-overlay').length);
    // Sau một frame vẫn phải là 1.
    await new Promise((r) => requestAnimationFrame(() => r()));
    seen.push(document.querySelectorAll('.cp-confirm-overlay').length);
    return seen;
  });

  for (const c of counts) {
    expect(c, 'Không được tồn tại 2 .cp-confirm-overlay cùng lúc').toBe(1);
  }
});

// Regression: Escape/Hủy xóa _activeConfirmClose ngay nhưng overlay còn ~400ms
// animate-out. Confirm mở ngay sau đó phải gỡ orphan — không 2 overlay, nút Đồng ý
// của hộp MỚI resolve được (không click nhầm nút hộp cũ đã settled).
test('Escape rồi mở confirm mới ngay: chỉ 1 overlay, Đồng ý resolve', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof window.showConfirm === 'function');

  const result = await page.evaluate(async () => {
    const out = {};
    const p1 = window.showConfirm('Escape me?', { title: 'E1' });
    await new Promise((r) => setTimeout(r, 50));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    out.p1 = await Promise.race([
      p1.then((v) => ({ resolved: true, value: v })),
      new Promise((r) => setTimeout(() => r({ resolved: false }), 1500)),
    ]);

    // Mở NGAY — trong cửa sổ afterEnd 400ms của overlay cũ.
    const p2 = window.showConfirm('After Escape?', { title: 'E2' });
    out.overlayCountImmediate = document.querySelectorAll('.cp-confirm-overlay').length;
    out.titles = Array.from(document.querySelectorAll('.cp-confirm-overlay .cp-confirm-title'))
      .map((el) => el.textContent);

    await new Promise((r) => setTimeout(r, 50));
    const overlays = document.querySelectorAll('.cp-confirm-overlay');
    const ok = overlays.length
      ? overlays[overlays.length - 1].querySelector('.cp-confirm-ok')
      : null;
    if (ok) ok.click();
    out.p2 = await Promise.race([
      p2.then((v) => ({ resolved: true, value: v })),
      new Promise((r) => setTimeout(() => r({ resolved: false }), 1500)),
    ]);
    return out;
  });

  expect(result.p1, 'Escape phải cancel confirm').toEqual({ resolved: true, value: false });
  expect(result.overlayCountImmediate, 'Sau Escape→mở mới chỉ còn 1 overlay').toBe(1);
  expect(result.titles, 'Chỉ title của confirm mới').toEqual(['E2']);
  expect(result.p2, 'Đồng ý trên confirm mới phải resolve(true)').toEqual({ resolved: true, value: true });
});

// Cùng race nhưng đóng bằng nút Hủy (không phải Escape).
test('Hủy rồi mở confirm mới ngay: chỉ 1 overlay, Đồng ý resolve', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof window.showConfirm === 'function');

  const result = await page.evaluate(async () => {
    const out = {};
    const p1 = window.showConfirm('Cancel me?', { title: 'H1' });
    await new Promise((r) => setTimeout(r, 50));
    const cancel = document.querySelector('.cp-confirm-overlay .cp-confirm-cancel');
    if (cancel) cancel.click();
    out.p1 = await Promise.race([
      p1.then((v) => ({ resolved: true, value: v })),
      new Promise((r) => setTimeout(() => r({ resolved: false }), 1500)),
    ]);

    const p2 = window.showConfirm('After Hủy?', { title: 'H2' });
    out.overlayCountImmediate = document.querySelectorAll('.cp-confirm-overlay').length;

    await new Promise((r) => setTimeout(r, 50));
    const overlays = document.querySelectorAll('.cp-confirm-overlay');
    const ok = overlays.length
      ? overlays[overlays.length - 1].querySelector('.cp-confirm-ok')
      : null;
    if (ok) ok.click();
    out.p2 = await Promise.race([
      p2.then((v) => ({ resolved: true, value: v })),
      new Promise((r) => setTimeout(() => r({ resolved: false }), 1500)),
    ]);
    return out;
  });

  expect(result.p1, 'Hủy phải cancel confirm').toEqual({ resolved: true, value: false });
  expect(result.overlayCountImmediate, 'Sau Hủy→mở mới chỉ còn 1 overlay').toBe(1);
  expect(result.p2, 'Đồng ý trên confirm mới phải resolve(true)').toEqual({ resolved: true, value: true });
});

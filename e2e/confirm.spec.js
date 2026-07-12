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
    const p3 = window.showConfirm('Confirm 3?', { title: 'C3' });
    await new Promise((r) => setTimeout(r, 350)); // chờ animation gắn nút
    const ok = document.querySelector('.cp-confirm-overlay .cp-confirm-ok');
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
  expect(result.p3, 'Confirm sau đó vẫn hoạt động (Đồng ý)').toEqual({ resolved: true, value: true });
});

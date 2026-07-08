// @ts-check
// Playwright config — CI-only E2E (KHÔNG ảnh hưởng app shipped, vẫn zero-dep runtime).
// Chromium đã cài sẵn trong môi trường (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers);
// không tải browser mới. Serve tĩnh bằng python http.server (app là static thuần).
const { defineConfig, devices } = require('@playwright/test');
const fs = require('node:fs');

const PORT = 8080;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Dùng Chromium cài sẵn của môi trường nếu có (tránh phụ thuộc revision của Playwright);
// trên CI (GitHub Actions) để trống -> `npx playwright install chromium` cung cấp.
function preinstalledChromium() {
  try {
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
    const dir = fs.readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
    if (!dir) return undefined;
    const bin = `${base}/${dir}/chrome-linux/chrome`;
    return fs.existsSync(bin) ? bin : undefined;
  } catch (e) { return undefined; }
}
const CHROMIUM = preinstalledChromium();

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Mặc định mobile-first (app tối ưu di động).
    ...devices['Pixel 5'],
    launchOptions: CHROMIUM ? { executablePath: CHROMIUM } : {},
  },
  webServer: {
    command: 'python3 -m http.server ' + PORT,
    url: BASE_URL + '/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});

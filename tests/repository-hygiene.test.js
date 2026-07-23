const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCREENSHOT_IMAGE_RE = /\.(?:avif|gif|jpe?g|png|webp)$/i;
const GENERATED_SCREENSHOT_DIRS = new Set([
  'actual',
  'after',
  'before',
  'diff',
  'diffs',
  'expected',
  'generated',
  'review-artifacts',
]);
const MAX_DURABLE_SCREENSHOTS_PER_SECTION = 24;

function getTrackedFiles(t) {
  try {
    return execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\0').filter(Boolean);
  } catch (error) {
    t.skip('Cần checkout Git để kiểm tra danh sách file được track.');
    return [];
  }
}

function isGeneratedScreenshotArtifact(file) {
  if (!file.startsWith('docs/screenshots/')) return false;
  const segments = file.slice('docs/screenshots/'.length).split('/');
  return segments.slice(0, -1).some((segment) => GENERATED_SCREENSHOT_DIRS.has(segment));
}

function gitIgnores(samplePath) {
  try {
    execFileSync('git', ['-C', ROOT, 'check-ignore', '--no-index', '-q', samplePath], {
      stdio: 'ignore',
    });
    return true;
  } catch (error) {
    if (error && error.status === 1) return false;
    throw error;
  }
}

test('repository does not track generated or temporary artifacts', (t) => {
  const files = getTrackedFiles(t);
  if (!files.length) return;

  const forbiddenPrefixes = [
    'node_modules/',
    'test-results/',
    'playwright-report/',
    '.lighthouseci/',
    'coverage/',
    '.nyc_output/',
  ];
  const forbiddenBasenames = new Set([
    '.DS_Store',
    'Thumbs.db',
    '.agent-fetch-links.md',
  ]);
  const temporarySuffix = /(?:\.log|\.tmp|\.temp|\.bak|\.orig|~)$/i;

  const violations = files.filter((file) =>
    forbiddenPrefixes.some((prefix) => file.startsWith(prefix)) ||
    forbiddenBasenames.has(path.basename(file)) ||
    temporarySuffix.test(file) ||
    isGeneratedScreenshotArtifact(file)
  );

  assert.deepEqual(violations, [], `File rác đang được Git theo dõi:\n${violations.join('\n')}`);

  const screenshotCounts = new Map();
  for (const file of files) {
    if (!file.startsWith('docs/screenshots/') || !SCREENSHOT_IMAGE_RE.test(file)) continue;
    const section = file.slice('docs/screenshots/'.length).split('/')[0];
    screenshotCounts.set(section, (screenshotCounts.get(section) || 0) + 1);
  }
  const bulkSections = [...screenshotCounts.entries()]
    .filter(([, count]) => count > MAX_DURABLE_SCREENSHOTS_PER_SECTION)
    .map(([section, count]) => `docs/screenshots/${section}/ (${count} ảnh)`);

  assert.deepEqual(
    bulkSections,
    [],
    `Phát hiện thư mục ảnh hàng loạt; hãy lưu ở PR/CI artifact hoặc cập nhật chính sách có chủ đích:\n${bulkSections.join('\n')}`
  );
});

test('.gitignore blocks generated screenshot matrices but allows durable documentation images', () => {
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  const configuredRules = new Set(
    ignore.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
  );
  const requiredRules = [
    'node_modules/',
    'package-lock.json',
    'test-results/',
    'playwright-report/',
    '.lighthouseci/',
    'coverage/',
    '.nyc_output/',
    '*.log',
    '*.tmp',
    '*.temp',
    '*.bak',
    '*.orig',
    '*~',
    '.DS_Store',
    'Thumbs.db',
    'docs/screenshots/**/before/',
    'docs/screenshots/**/after/',
    'docs/screenshots/**/actual/',
    'docs/screenshots/**/expected/',
    'docs/screenshots/**/diff/',
    'docs/screenshots/**/diffs/',
    'docs/screenshots/**/generated/',
    'docs/screenshots/**/review-artifacts/',
  ];

  for (const rule of requiredRules) {
    assert.ok(configuredRules.has(rule), `Thiếu rule .gitignore: ${rule}`);
  }

  assert.equal(
    gitIgnores('docs/screenshots/ux-hardening-2.0/before/dashboard.png'),
    true,
    'Ảnh before/after sinh tự động phải bị ignore'
  );
  assert.equal(
    gitIgnores('docs/screenshots/run-42/generated/dashboard.png'),
    true,
    'Ảnh generated phải bị ignore'
  );
  assert.equal(
    gitIgnores('docs/screenshots/guide/onboarding.png'),
    false,
    'Ảnh tài liệu lâu dài phải add bằng Git bình thường, không cần force-add'
  );
});

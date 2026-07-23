const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

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
    'docs/screenshots/ux-hardening-1.1.0/',
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
    temporarySuffix.test(file)
  );

  assert.deepEqual(violations, [], `File rác đang được Git theo dõi:\n${violations.join('\n')}`);
});

test('.gitignore protects common local and agent-generated artifacts', () => {
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
    'docs/screenshots/*/',
  ];

  for (const rule of requiredRules) {
    assert.ok(configuredRules.has(rule), `Thiếu rule .gitignore: ${rule}`);
  }
});

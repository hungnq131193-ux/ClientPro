'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Source-level guard complements the async runtime regressions: UI setup/recovery
// must stop before hiding security screens whenever a lock generation changes.
const src = fs.readFileSync(path.join(__dirname, '..', 'assets', '02_security.js'), 'utf8');

test('security setup and recovery keep lock screen closed when key generation changes', () => {
  assert.match(src, /const setupGen = __keyGeneration;/);
  assert.match(src, /if \(setupGen !== __keyGeneration \|\| !isAppUnlocked\(\)\) return;/);
  assert.match(src, /const recoveryGen = __keyGeneration;/);
  assert.match(src, /if \(recoveryGen !== __keyGeneration \|\| !isAppUnlocked\(\)\) return;/);
});

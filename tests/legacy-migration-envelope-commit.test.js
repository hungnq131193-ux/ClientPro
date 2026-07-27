'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSecurity } = require('./helpers/load-security');

function emptyCustomerDb() {
  return {
    transaction() {
      return {
        objectStore() {
          return {
            getAllKeys() {
              const req = { onsuccess: null, onerror: null, result: [] };
              Promise.resolve().then(() => {
                if (req.onsuccess) req.onsuccess({ target: req });
              });
              return req;
            },
          };
        },
      };
    },
  };
}

test('resume PIN_STAGE thiếu SEC_STAGE phải dựng lại recovery cùng master key', async () => {
  const { api, localStorage } = loadSecurity();
  const legacyKey = 'mk_legacy_recovery_resume';
  const nextKey = api.generateMasterKey();
  const pin = '654321';
  const employeeId = 'NV001';
  api.setLegacyMasterKey(legacyKey);
  api.setDb(emptyCustomerDb());
  localStorage.setItem('app_pin', 'legacy-pin-envelope');
  localStorage.setItem('app_sec_qa', 'legacy-sec-envelope');
  const pinStage = await api.sealMasterKey(pin, nextKey);
  localStorage.setItem('app_pin_v2_stage', pinStage);

  await api.runFieldCryptoMigrationIfNeeded(pin, employeeId);

  assert.equal(localStorage.getItem('app_crypto_schema_v'), '2');
  assert.equal(localStorage.getItem('app_pin'), pinStage);
  const sec = localStorage.getItem('app_sec_qa');
  assert.ok(api.parseV2Envelope(sec), 'recovery envelope phải là v2');
  assert.equal(await api.openMasterKeyV2(employeeId, sec), nextKey,
    'recovery phải mở đúng key đã stage cho PIN');
  assert.equal(localStorage.getItem('app_pin_v2_stage'), null);
  assert.equal(localStorage.getItem('app_sec_v2_stage'), null);
});

test('SEC_KEY write lỗi không được chuyển PIN_KEY và phải giữ cả stage để retry', async () => {
  const { api, localStorage } = loadSecurity();
  const legacyKey = 'mk_legacy_commit_order';
  const oldPin = 'legacy-pin-envelope';
  const oldSec = 'legacy-sec-envelope';
  api.setLegacyMasterKey(legacyKey);
  api.setDb(emptyCustomerDb());
  localStorage.setItem('app_pin', oldPin);
  localStorage.setItem('app_sec_qa', oldSec);

  const originalSet = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (key, value) => {
    if (key === 'app_sec_qa') throw new Error('simulated quota failure');
    return originalSet(key, value);
  };

  await assert.rejects(
    api.runFieldCryptoMigrationIfNeeded('654321', 'NV001'),
    /simulated quota failure/
  );

  assert.equal(localStorage.getItem('app_pin'), oldPin,
    'PIN_KEY phải còn legacy khi recovery chưa commit được');
  assert.equal(localStorage.getItem('app_sec_qa'), oldSec);
  assert.ok(localStorage.getItem('app_pin_v2_stage'), 'PIN stage phải giữ để retry');
  assert.ok(localStorage.getItem('app_sec_v2_stage'), 'SEC stage phải giữ để retry');
  assert.equal(localStorage.getItem('app_crypto_schema_v'), null);
});

test('tripwire: recovery commit đứng trước PIN và stage chỉ xóa sau xác minh', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets', '02_security.js'), 'utf8');
  const start = source.indexOf('async function runFieldCryptoMigrationIfNeeded(');
  const end = source.indexOf('\n// ============================================================\n// PIN Envelope v2', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);
  const secWrite = body.lastIndexOf('localStorage.setItem(SEC_KEY, secStage)');
  const pinWrite = body.lastIndexOf('localStorage.setItem(PIN_KEY, pinStage)');
  const secVerify = body.indexOf('localStorage.getItem(SEC_KEY)', secWrite + 1);
  const schemaWrite = body.lastIndexOf('localStorage.setItem(SCHEMA_KEY, "2")');
  const removeStages = body.lastIndexOf('localStorage.removeItem(PIN_STAGE)');
  assert.ok(secWrite >= 0 && secVerify > secWrite && secVerify < pinWrite,
    'SEC_KEY phải ghi và đọc lại trước PIN_KEY');
  assert.ok(schemaWrite > pinWrite && removeStages > schemaWrite,
    'chỉ xóa stage sau khi hai envelope và schema đã commit');
  assert.match(body, /if \(!recoveryId\) throw new Error\("LEGACY_MIGR_EMPLOYEE_ID_MISSING"\)/);
  assert.match(body, /stagedRecovery !== mkStr[\s\S]*?sealMasterKey\(recoveryId, mkStr\)/,
    'SEC_STAGE thiếu hoặc lệch phải được dựng lại từ recovery identity');
});

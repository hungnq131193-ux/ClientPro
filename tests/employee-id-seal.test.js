'use strict';

// ============================================================================
// employee-id-seal.test.js — Mã nhân viên là secret khôi phục masterKey (SEC_KEY
// niêm phong dưới nó) nên KHÔNG được persist plaintext lâu dài: sau unlock,
// plaintext EMPLOYEE_KEY được seal AES-GCM (app_employee_id_sealed_v1) rồi XÓA;
// bản dùng runtime nằm trong RAM và bị xóa khi lock. Chạy 02_security.js THẬT
// trong vm sandbox.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSecurity } = require('./helpers/load-security');

const PLAIN_KEY = 'app_employee_id';
const SEALED_KEY = 'app_employee_id_sealed_v1';
const SEC_KEY = 'app_sec_qa';
const EMP = 'NV001';

test('migration: seal plaintext -> xóa plaintext, RAM + sealed đọc lại đúng', async () => {
  const { api, localStorage } = loadSecurity();
  localStorage.setItem(PLAIN_KEY, EMP);

  await api.setMasterKey(api.generateMasterKey());
  await api.runEmployeeIdSealMigrationIfNeeded();

  assert.equal(localStorage.getItem(PLAIN_KEY), null, 'Plaintext phải bị xóa sau khi seal');
  const sealed = localStorage.getItem(SEALED_KEY);
  assert.ok(sealed && sealed.startsWith('cpg1:'), 'Sealed phải là ciphertext cpg1:');
  assert.ok(!sealed.includes(EMP), 'Sealed không được chứa mã NV plaintext');
  assert.equal(api.getEmployeeIdRam(), EMP, 'RAM phải có mã NV sau migration');
  assert.equal(api._resolveEmployeeId(), EMP);
  assert.equal(await api._readSealedEmployeeIdAsync(), EMP, 'Unseal phải trả đúng mã NV');
});

test('migration idempotent: chạy lần 2 không đổi trạng thái', async () => {
  const { api, localStorage } = loadSecurity();
  localStorage.setItem(PLAIN_KEY, EMP);
  await api.setMasterKey(api.generateMasterKey());
  await api.runEmployeeIdSealMigrationIfNeeded();
  const sealedFirst = localStorage.getItem(SEALED_KEY);

  await api.runEmployeeIdSealMigrationIfNeeded();
  assert.equal(localStorage.getItem(PLAIN_KEY), null);
  assert.ok(localStorage.getItem(SEALED_KEY), 'Sealed vẫn tồn tại');
  assert.equal(api.getEmployeeIdRam(), EMP);
  // Nội dung có thể reseal (IV mới) nhưng luôn unseal về đúng giá trị.
  assert.equal(await api._readSealedEmployeeIdAsync(), EMP, `sealed hợp lệ (trước: ${sealedFirst ? 'có' : 'không'})`);
});

test('recovery: sau migration, mã NV gõ tay vẫn mở được SEC_KEY envelope', async () => {
  const { api, localStorage } = loadSecurity();
  const mk = api.generateMasterKey();
  await api.setMasterKey(mk);
  // Setup như saveSecuritySetup: SEC_KEY niêm phong masterKey dưới mã NV.
  localStorage.setItem(SEC_KEY, await api.sealMasterKey(EMP, mk));
  localStorage.setItem(PLAIN_KEY, EMP);
  await api.runEmployeeIdSealMigrationIfNeeded();
  assert.equal(localStorage.getItem(PLAIN_KEY), null);

  // Máy khóa (mất RAM) -> người dùng quên PIN, gõ tay mã NV (checkRecovery).
  api.clearMasterKeyMaterial();
  const res = await api.unwrapMasterKeyAny(EMP, localStorage.getItem(SEC_KEY));
  assert.ok(res && res.masterKey === mk, 'Recovery bằng mã NV gõ tay phải mở được masterKey');
});

test('lock: clearMasterKeyMaterial xóa mã NV khỏi RAM', async () => {
  const { api, localStorage } = loadSecurity();
  localStorage.setItem(PLAIN_KEY, EMP);
  await api.setMasterKey(api.generateMasterKey());
  await api.runEmployeeIdSealMigrationIfNeeded();
  assert.equal(api.getEmployeeIdRam(), EMP);

  api.clearMasterKeyMaterial();
  assert.equal(api.getEmployeeIdRam(), null, 'RAM phải bị xóa khi lock');
  assert.equal(api._resolveEmployeeId(), '', 'Sau lock + migration, không còn nguồn plaintext');
  // Sealed vẫn nằm nguyên (ciphertext) — mở khóa lại sẽ nạp về RAM.
  assert.ok(localStorage.getItem(SEALED_KEY));
});

test('unlock lại: nạp RAM từ sealed (không cần plaintext)', async () => {
  const { api, localStorage } = loadSecurity();
  localStorage.setItem(PLAIN_KEY, EMP);
  const mk = api.generateMasterKey();
  await api.setMasterKey(mk);
  await api.runEmployeeIdSealMigrationIfNeeded();
  api.clearMasterKeyMaterial();

  await api.setMasterKey(mk); // unlock lại cùng masterKey
  await api.runEmployeeIdSealMigrationIfNeeded();
  assert.equal(api.getEmployeeIdRam(), EMP, 'RAM phải được nạp lại từ sealed');
});

test('sealed hỏng/tamper: không crash, key chết bị dọn', async () => {
  const { api, localStorage } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  localStorage.setItem(SEALED_KEY, 'cpg1:not-a-real-ciphertext');

  const out = await api._readSealedEmployeeIdAsync();
  assert.equal(out, '', 'Sealed hỏng phải trả rỗng');
  assert.equal(localStorage.getItem(SEALED_KEY), null, 'Key chết phải bị xóa');
});

test('sai khóa (wipe + masterKey mới): sealed cũ bị dọn, không rò giá trị', async () => {
  const { api, localStorage } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  assert.ok(await api._writeSealedEmployeeId(EMP));

  api.clearMasterKeyMaterial();
  await api.setMasterKey(api.generateMasterKey()); // key khác (thiết bị wipe/re-setup)
  const out = await api._readSealedEmployeeIdAsync();
  assert.equal(out, '', 'Không unseal được bằng key khác');
  assert.equal(localStorage.getItem(SEALED_KEY), null, 'Sealed dưới key cũ bị dọn');
});

test('ghi bù: RAM có (nhập tay) mà chưa có sealed -> migration ghi sealed', async () => {
  const { api, localStorage } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  api.setEmployeeIdRam(EMP); // như checkRecovery/saveSecuritySetup dưới key legacy trước đó

  await api.runEmployeeIdSealMigrationIfNeeded();
  const sealed = localStorage.getItem(SEALED_KEY);
  assert.ok(sealed && sealed.startsWith('cpg1:'), 'Phải ghi bù sealed từ RAM');
  assert.equal(await api._readSealedEmployeeIdAsync(), EMP);
});

test('còn khóa: migration là no-op, không đụng plaintext', async () => {
  const { api, localStorage } = loadSecurity();
  localStorage.setItem(PLAIN_KEY, EMP);
  await api.runEmployeeIdSealMigrationIfNeeded(); // chưa có masterCryptoKey
  assert.equal(localStorage.getItem(PLAIN_KEY), EMP, 'Còn khóa thì giữ nguyên plaintext (legacy)');
  assert.equal(localStorage.getItem(SEALED_KEY), null);
});

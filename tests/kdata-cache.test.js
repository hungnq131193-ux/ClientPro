'use strict';

// ============================================================================
// kdata-cache.test.js — B3: KDATA không bao giờ nằm plaintext trong persistent
// storage. Cache v2 niêm phong AES-GCM dưới masterKey; nhận KDATA lúc còn khóa
// thì giữ RAM chờ seal; migrate v1 (plaintext legacy) -> v2 có xác minh; lock
// xóa sạch RAM. Chạy 02_security.js THẬT trong vm sandbox.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSecurity, randomKdataB64u } = require('./helpers/load-security');

const V1 = 'app_backup_kdata_cache_v1';
const V2 = 'app_backup_kdata_cache_v2';
const EMP = 'NV01';
const DEV = 'DEV01';

function identity(ctx) {
  return `${EMP}::${DEV}::${ctx.ADMIN_SERVER_URL || ''}`;
}

// Quét TOÀN BỘ localStorage: không giá trị nào được chứa KDATA plaintext.
function assertNoPlaintextInStorage(localStorage, kdata) {
  for (const [k, v] of Object.entries(localStorage._store)) {
    assert.ok(!String(v).includes(kdata), `KDATA plaintext bị lộ trong localStorage["${k}"]`);
  }
}

test('B3: ghi KDATA khi CÒN KHÓA -> không đụng localStorage, giữ pending RAM', async () => {
  const { api, localStorage, ctx } = loadSecurity();
  const kdata = randomKdataB64u();

  const persisted = await api._writeCachedKdata(EMP, DEV, kdata);
  assert.equal(persisted, false, 'Chưa unlock thì không được persist');
  assert.equal(localStorage.getItem(V2), null, 'Không được ghi v2 khi còn khóa');
  assert.equal(localStorage.getItem(V1), null, 'Không bao giờ ghi v1 mới');
  assertNoPlaintextInStorage(localStorage, kdata);

  const pending = api.getPendingKdata();
  assert.ok(pending && pending.kdata_b64u === kdata, 'KDATA phải chờ trong RAM');
  assert.equal(pending.identity, identity(ctx));
});

test('B3: unlock -> flush pending thành sealed v2 (cpg1:), unseal lại đúng', async () => {
  const { api, localStorage } = loadSecurity();
  const kdata = randomKdataB64u();
  await api._writeCachedKdata(EMP, DEV, kdata); // còn khóa -> pending

  await api.setMasterKey(api.generateMasterKey());
  await api._flushPendingKdataCache();

  assert.equal(api.getPendingKdata(), null, 'Pending phải được xóa sau flush');
  const raw = localStorage.getItem(V2);
  assert.ok(raw, 'Phải có sealed v2 sau flush');
  const env = JSON.parse(raw);
  assert.ok(String(env.sealed).startsWith('cpg1:'), 'Giá trị lưu phải là ciphertext cpg1:');
  assertNoPlaintextInStorage(localStorage, kdata);

  const read = await api._readCachedKdataAsync(EMP, DEV);
  assert.ok(read && read.kdata_b64u === kdata, 'Unseal phải trả lại đúng KDATA');
});

test('B3: ghi khi ĐÃ mở khóa -> sealed v2 + read-back verify; đọc lại đúng', async () => {
  const { api, localStorage } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  const kdata = randomKdataB64u();

  const persisted = await api._writeCachedKdata(EMP, DEV, kdata);
  assert.equal(persisted, true, 'Ghi + xác minh phải thành công');
  assertNoPlaintextInStorage(localStorage, kdata);

  const read = await api._readCachedKdataAsync(EMP, DEV);
  assert.equal(read.kdata_b64u, kdata);
});

test('B3: migration v1 plaintext -> v2 sealed, CHỈ xóa v1 sau khi xác minh', async () => {
  const { api, localStorage, ctx } = loadSecurity();
  const kdata = randomKdataB64u();
  localStorage.setItem(V1, JSON.stringify({ ts: Date.now(), kdata_b64u: kdata, identity: identity(ctx) }));

  await api.setMasterKey(api.generateMasterKey());
  const read = await api._readCachedKdataAsync(EMP, DEV);
  assert.equal(read.kdata_b64u, kdata, 'Migration vẫn phải trả được KDATA');

  assert.equal(localStorage.getItem(V1), null, 'v1 plaintext phải bị xóa sau migration thành công');
  const env = JSON.parse(localStorage.getItem(V2));
  assert.ok(String(env.sealed).startsWith('cpg1:'));
  assertNoPlaintextInStorage(localStorage, kdata);

  // Idempotent: đọc lần hai vẫn đúng, không lỗi.
  const read2 = await api._readCachedKdataAsync(EMP, DEV);
  assert.equal(read2.kdata_b64u, kdata);
});

test('B3: v1 khi CÒN KHÓA -> vẫn đọc được (chưa migrate) và KHÔNG bị xóa', async () => {
  const { api, localStorage, ctx } = loadSecurity();
  const kdata = randomKdataB64u();
  localStorage.setItem(V1, JSON.stringify({ ts: Date.now(), kdata_b64u: kdata, identity: identity(ctx) }));

  const read = await api._readCachedKdataAsync(EMP, DEV);
  assert.equal(read.kdata_b64u, kdata, 'Còn khóa vẫn đọc legacy để không mất chức năng');
  assert.ok(localStorage.getItem(V1), 'Không được xóa v1 trước khi có bản thay thế');
});

test('B3: v1 hết hạn TTL -> bị loại bỏ an toàn, không migrate', async () => {
  const { api, localStorage, ctx } = loadSecurity();
  const kdata = randomKdataB64u();
  localStorage.setItem(V1, JSON.stringify({ ts: Date.now() - 31 * 60 * 1000, kdata_b64u: kdata, identity: identity(ctx) }));
  await api.setMasterKey(api.generateMasterKey());

  const read = await api._readCachedKdataAsync(EMP, DEV);
  assert.equal(read, null, 'KDATA hết hạn không được dùng');
  assert.equal(localStorage.getItem(V1), null, 'v1 hết hạn phải bị xóa');
  assert.equal(localStorage.getItem(V2), null, 'Không được migrate giá trị hết hạn');
});

test('B3: v2 hỏng (JSON rác) -> loại bỏ an toàn, không throw', async () => {
  const { api, localStorage } = loadSecurity();
  localStorage.setItem(V2, '{not-json!!');
  await api.setMasterKey(api.generateMasterKey());
  const read = await api._readCachedKdataAsync(EMP, DEV);
  assert.equal(read, null);
  assert.equal(localStorage.getItem(V2), null, 'v2 hỏng phải bị dọn');
});

test('B3: v2 sealed bằng KHÓA KHÁC -> unlocked thì discard; locked thì GIỮ NGUYÊN', async () => {
  // Seal bằng khóa A
  const first = loadSecurity();
  await first.api.setMasterKey(first.api.generateMasterKey());
  const kdata = randomKdataB64u();
  await first.api._writeCachedKdata(EMP, DEV, kdata);
  const sealedRaw = first.localStorage.getItem(V2);

  // Sandbox mới (khóa B) — còn khóa: đọc trả null nhưng KHÔNG xóa.
  const second = loadSecurity();
  second.localStorage.setItem(V2, sealedRaw);
  let read = await second.api._readCachedKdataAsync(EMP, DEV);
  assert.equal(read, null, 'Còn khóa: không unseal được');
  assert.ok(second.localStorage.getItem(V2), 'Còn khóa: không được xóa giá trị tốt');

  // Mở khóa bằng khóa B (khác khóa A): unseal fail -> giá trị chết -> xóa.
  await second.api.setMasterKey(second.api.generateMasterKey());
  read = await second.api._readCachedKdataAsync(EMP, DEV);
  assert.equal(read, null);
  assert.equal(second.localStorage.getItem(V2), null, 'Sai khóa khi đã unlock: sealed chết phải bị dọn');
});

test('B3: lockApp/clearMasterKeyMaterial xóa KDATA RAM + pending; sealed v2 giữ nguyên', async () => {
  const { api, localStorage } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  const kdata = randomKdataB64u();
  await api._writeCachedKdata(EMP, DEV, kdata);
  api.setKdataRam(kdata);

  api.clearMasterKeyMaterial();
  assert.equal(api.getKdataRam(), '', 'APP_BACKUP_KDATA_B64U phải bị xóa khỏi RAM khi khóa');
  assert.equal(api.getPendingKdata(), null, 'Pending phải bị xóa khi khóa');
  assert.ok(localStorage.getItem(V2), 'Sealed v2 (ciphertext) được phép giữ lại');
});

test('B3+B2: ensureBackupSecret offline dùng sealed cache sau unlock (không cần mạng)', async () => {
  const { api, localStorage, ctx } = loadSecurity();
  localStorage.setItem('app_employee_id', EMP);
  localStorage.setItem('app_device_unique_id', DEV);
  ctx.navigator.onLine = false;

  await api.setMasterKey(api.generateMasterKey());
  const kdata = randomKdataB64u();
  await api._writeCachedKdata(EMP, DEV, kdata);
  api.setKdataRam(''); // giả lập app vừa mở lại, RAM trống

  const res = await api.ensureBackupSecret();
  assert.equal(res.ok, true, 'Offline + sealed cache hợp lệ phải dùng được: ' + (res.message || ''));
  assert.equal(api.getKdataRam(), kdata, 'KDATA phải được unseal vào RAM');
});

test('B2: completeUnlockDataLoad phát clientpro:unlocked (có document.dispatchEvent) và không throw khi harness thiếu', async () => {
  // 1) Harness mặc định: document stub KHÔNG có dispatchEvent -> không được throw.
  const plain = loadSecurity();
  await plain.api.setMasterKey(plain.api.generateMasterKey());
  await plain.api.completeUnlockDataLoad();

  // 2) Sandbox có dispatchEvent + CustomEvent -> phải phát đúng sự kiện.
  const rich = loadSecurity();
  const events = [];
  rich.ctx.document.dispatchEvent = (e) => { events.push(e.type); return true; };
  rich.ctx.document.addEventListener = () => {};
  rich.ctx.CustomEvent = class CustomEvent { constructor(type) { this.type = type; } };
  await rich.api.setMasterKey(rich.api.generateMasterKey());
  await rich.api.completeUnlockDataLoad();
  assert.ok(events.includes('clientpro:unlocked'), 'Phải dispatch clientpro:unlocked sau unlock');
});

test('B3 (item 3): v1 plaintext + v2 sealed cùng tồn tại sau unlock -> v1 bị dọn NGAY (độc lập v2)', async () => {
  const { api, localStorage, ctx } = loadSecurity();
  await api.setMasterKey(api.generateMasterKey());
  const kdata = randomKdataB64u();
  // v2 sealed hợp lệ (đã unlock).
  await api._writeCachedKdata(EMP, DEV, kdata);
  assert.ok(localStorage.getItem(V2), 'Phải có v2 sealed');
  // Leftover v1 plaintext legacy cùng identity (kịch bản người nâng cấp từ bản cũ).
  localStorage.setItem(V1, JSON.stringify({ ts: Date.now(), kdata_b64u: kdata, identity: identity(ctx) }));

  const read = await api._readCachedKdataAsync(EMP, DEV);
  assert.equal(read.kdata_b64u, kdata, 'v2 vẫn dùng được');
  assert.equal(localStorage.getItem(V1), null, 'v1 plaintext phải bị dọn ngay khi đã có v2 hợp lệ');
  assertNoPlaintextInStorage(localStorage, kdata);
});

test('B3 (item 8): _flushPendingKdataCache khi setItem lỗi (quota) -> GIỮ pending, không mất KDATA', async () => {
  const { api, localStorage } = loadSecurity();
  const kdata = randomKdataB64u();
  await api._writeCachedKdata(EMP, DEV, kdata); // còn khóa -> pending RAM (không đụng storage)
  await api.setMasterKey(api.generateMasterKey());

  const origSet = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  try {
    await api._flushPendingKdataCache();
  } finally {
    localStorage.setItem = origSet;
  }

  const pending = api.getPendingKdata();
  assert.ok(pending && pending.kdata_b64u === kdata, 'setItem lỗi -> pending phải được giữ để thử lại lần sau');
  assert.equal(localStorage.getItem(V2), null, 'v2 không được ghi khi setItem lỗi');
});

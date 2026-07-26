'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function loadGuard(decryptImpl) {
  const storage = new Map();
  const ctx = {
    console,
    Map,
    Promise,
    Date,
    JSON,
    String,
    Number,
    encodeURIComponent,
    GCM_PREFIX: 'cpg1:',
    __keyGeneration: 1,
    __fieldPlainCache: new Map(),
    __fieldDecryptPending: new Map(),
    _gcmDecryptField: decryptImpl,
    decryptText: (s) => s,
    decryptFieldAsync: async (s) => s,
    localStorage: {
      getItem: (k) => storage.has(k) ? storage.get(k) : null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    navigator: { onLine: true, clipboard: { writeText: async () => {} } },
    document: {
      addEventListener() {},
      getElementById() { return null; },
      createElement() { return {}; },
      body: { appendChild() {}, removeChild() {} },
      execCommand() {},
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'assets', '15_auth_gate.js'),
    'utf8'
  );
  vm.runInContext(src, ctx, { filename: 'assets/15_auth_gate.js' });
  return ctx;
}

test('promise giải mã thuộc generation cũ trả ciphertext, không phát tán plaintext', async () => {
  const d = deferred();
  const ctx = loadGuard(() => d.promise);
  const cipher = 'cpg1:old-session';

  const pending = ctx.decryptFieldAsync(cipher);
  ctx.__keyGeneration += 1; // auto-lock/revoke
  ctx.__fieldPlainCache.clear();
  ctx.__fieldDecryptPending.clear();
  d.resolve('Nguyễn Văn A');

  assert.equal(await pending, cipher,
    'Caller của phiên cũ phải nhận ciphertext thay vì plaintext sau khi generation đổi');
  assert.equal(ctx.__fieldPlainCache.size, 0,
    'Không được nạp plaintext trở lại field cache sau lock/revoke');
});

test('promise cũ không xóa pending promise của phiên mở khóa mới', async () => {
  const oldD = deferred();
  const newD = deferred();
  let call = 0;
  const ctx = loadGuard(() => (++call === 1 ? oldD.promise : newD.promise));
  const cipher = 'cpg1:same-field';

  const oldPending = ctx.decryptFieldAsync(cipher);
  ctx.__keyGeneration += 1;
  ctx.__fieldPlainCache.clear();
  ctx.__fieldDecryptPending.clear();

  const newPending = ctx.decryptFieldAsync(cipher);
  const newOwnedPending = ctx.__fieldDecryptPending.get(cipher);
  assert.ok(newOwnedPending && typeof newOwnedPending.then === 'function',
    'Phiên mới phải sở hữu pending entry');

  oldD.resolve('plaintext-old');
  assert.equal(await oldPending, cipher);
  assert.equal(ctx.__fieldDecryptPending.get(cipher), newOwnedPending,
    'Promise cũ hoàn tất không được xóa pending của phiên mới');

  newD.resolve('plaintext-new');
  assert.equal(await newPending, 'plaintext-new');
  assert.equal(ctx.__fieldPlainCache.get(cipher), 'plaintext-new');
  assert.equal(ctx.__fieldDecryptPending.has(cipher), false,
    'Promise hiện hành hoàn tất phải tự dọn pending entry của chính nó');
});

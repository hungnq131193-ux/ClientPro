'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSecurity } = require('./helpers/load-security');

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

async function waitFor(promise, label) {
  let timer;
  try {
    await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Hết thời gian chờ: ${label}`)), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test('lượt validatePin cũ không được mở keypad hoặc xóa PIN của lượt mới đang import khóa', async () => {
  const { api, localStorage, ctx, dom } = loadSecurity({ dom: true });
  const pin = '654321';
  const mk = api.generateMasterKey();

  await api.setMasterKey(mk);
  localStorage.setItem('app_pin', await api.sealMasterKey(pin, mk));
  api.clearMasterKeyMaterial();
  dom.getEl('screen-lock').classList.remove('hidden');

  const originalCrypto = ctx.crypto;
  const originalSubtle = originalCrypto.subtle;
  const entered = [deferred(), deferred()];
  const release = [deferred(), deferred()];
  let installCount = 0;

  ctx.crypto = {
    getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto),
    subtle: new Proxy(originalSubtle, {
      get(target, prop) {
        if (prop === 'importKey') {
          return async (...args) => {
            const algorithm = args[2];
            const name = String((algorithm && algorithm.name) || algorithm || '');
            if (name === 'AES-GCM' && installCount < 2) {
              const index = installCount++;
              entered[index].resolve();
              await release[index].promise;
            }
            return target.importKey(...args);
          };
        }
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
  };

  api.setCurrentPin(pin);
  const first = api.validatePin();
  await waitFor(entered[0].promise, 'lượt cũ vào importKey');

  api.setCurrentPin(pin);
  const second = api.validatePin();
  await waitFor(entered[1].promise, 'lượt mới vào importKey');

  const keypad = dom.getEl('pin-keypad');
  assert.equal(keypad.classList.contains('keypad-disabled'), true,
    'lượt mới đang import khóa phải giữ keypad bị vô hiệu hóa');

  release[0].resolve();
  await first;

  assert.equal(keypad.classList.contains('keypad-disabled'), true,
    'catch của lượt cũ không được bật lại keypad dùng chung');
  assert.equal(api.getCurrentPin(), pin,
    'catch của lượt cũ không được xóa PIN mà lượt mới còn cần cho pipeline');

  release[1].resolve();
  await second;

  assert.equal(keypad.classList.contains('keypad-disabled'), false,
    'lượt hiện hành hoàn tất thì tự trả keypad về trạng thái nhập được');
  assert.equal(api.getCurrentPin(), '', 'lượt hiện hành phải tự xóa PIN khỏi RAM');
});

test('lượt mới nhận vé trước khi PBKDF2 unwrap: lượt cũ không được xóa PIN migration', async () => {
  const { api, localStorage, ctx, dom } = loadSecurity({ dom: true });
  const pin = '654321';
  const mk = api.generateMasterKey();

  await api.setMasterKey(mk);
  localStorage.setItem('app_pin', await api.sealMasterKey(pin, mk));
  api.clearMasterKeyMaterial();
  dom.getEl('screen-lock').classList.remove('hidden');

  const originalCrypto = ctx.crypto;
  const subtle = originalCrypto.subtle;
  const firstInstallEntered = deferred();
  const releaseFirstInstall = deferred();
  const secondUnwrapEntered = deferred();
  const releaseSecondUnwrap = deferred();
  let aesInstallCount = 0;
  let pbkdf2DeriveCount = 0;

  ctx.crypto = {
    getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto),
    subtle: new Proxy(subtle, {
      get(target, prop) {
        if (prop === 'deriveKey') {
          return async (...args) => {
            const algorithm = args[0];
            const name = String((algorithm && algorithm.name) || algorithm || '');
            if (name === 'PBKDF2') {
              pbkdf2DeriveCount++;
              if (pbkdf2DeriveCount === 2) {
                secondUnwrapEntered.resolve();
                await releaseSecondUnwrap.promise;
              }
            }
            return target.deriveKey(...args);
          };
        }
        if (prop === 'importKey') {
          return async (...args) => {
            const algorithm = args[2];
            const name = String((algorithm && algorithm.name) || algorithm || '');
            if (name === 'AES-GCM') {
              aesInstallCount++;
              if (aesInstallCount === 1) {
                firstInstallEntered.resolve();
                await releaseFirstInstall.promise;
              }
            }
            return target.importKey(...args);
          };
        }
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
  };

  api.setCurrentPin(pin);
  const first = api.validatePin();
  await waitFor(firstInstallEntered.promise, 'lượt cũ vào cài khóa');

  api.setCurrentPin(pin);
  const second = api.validatePin();
  await waitFor(secondUnwrapEntered.promise, 'lượt mới vào PBKDF2');

  const keypad = dom.getEl('pin-keypad');
  assert.equal(keypad.classList.contains('keypad-disabled'), true,
    'lượt mới đang unwrap phải giữ keypad bị vô hiệu hóa');

  releaseFirstInstall.resolve();
  await first;

  assert.equal(api.getCurrentPin(), pin,
    'lượt cũ không được xóa PIN đã được lượt mới chụp cho migration');
  assert.equal(keypad.classList.contains('keypad-disabled'), true,
    'lượt cũ không được mở keypad khi lượt mới còn đang unwrap');
  assert.equal(dom.isHidden('screen-lock'), false,
    'lượt cũ không được mở dashboard thay lượt mới');

  releaseSecondUnwrap.resolve();
  await second;

  assert.equal(api.getCurrentPin(), '', 'chủ vé tự xóa PIN sau khi đã chụp bản cục bộ');
  assert.equal(keypad.classList.contains('keypad-disabled'), false,
    'chủ vé hoàn tất thì trả keypad về trạng thái nhập được');
  assert.equal(dom.isHidden('screen-lock'), true,
    'lượt mới hoàn tất đầy đủ thì mới mở dashboard');
});

test('lượt cũ mất vé sau importKey phải xóa khóa của chính nó khi lượt mới nhập sai PIN', async () => {
  const { api, localStorage, ctx, dom } = loadSecurity({ dom: true });
  const correctPin = '654321';
  const wrongPin = '111111';
  const mk = api.generateMasterKey();

  await api.setMasterKey(mk);
  localStorage.setItem('app_pin', await api.sealMasterKey(correctPin, mk));
  api.clearMasterKeyMaterial();
  dom.getEl('screen-lock').classList.remove('hidden');
  const failuresBefore = api.getPinFailures().fails;

  const originalCrypto = ctx.crypto;
  const subtle = originalCrypto.subtle;
  const firstInstallEntered = deferred();
  const releaseFirstInstall = deferred();
  const secondUnwrapEntered = deferred();
  const releaseSecondUnwrap = deferred();
  let aesInstallCount = 0;
  let pbkdf2DeriveCount = 0;

  ctx.crypto = {
    getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto),
    subtle: new Proxy(subtle, {
      get(target, prop) {
        if (prop === 'deriveKey') {
return async (...args) => {
  const algorithm = args[0];
  const name = String((algorithm && algorithm.name) || algorithm || '');
  if (name === 'PBKDF2') {
    pbkdf2DeriveCount++;
    if (pbkdf2DeriveCount === 2) {
      secondUnwrapEntered.resolve();
      await releaseSecondUnwrap.promise;
    }
  }
  return target.deriveKey(...args);
};
        }
        if (prop === 'importKey') {
return async (...args) => {
  const algorithm = args[2];
  const name = String((algorithm && algorithm.name) || algorithm || '');
  if (name === 'AES-GCM') {
    aesInstallCount++;
    if (aesInstallCount === 1) {
      firstInstallEntered.resolve();
      await releaseFirstInstall.promise;
    }
  }
  return target.importKey(...args);
};
        }
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
  };

  api.setCurrentPin(correctPin);
  const first = api.validatePin();
  await waitFor(firstInstallEntered.promise, 'lượt đúng PIN vào cài khóa');

  api.setCurrentPin(wrongPin);
  const second = api.validatePin();
  await waitFor(secondUnwrapEntered.promise, 'lượt sai PIN vào PBKDF2');

  releaseFirstInstall.resolve();
  await first;

  assert.equal(api.isAppUnlocked(), false,
    'lượt cũ mất vé phải xóa masterKey vừa cài, không để phiên mở khóa phía sau màn PIN');
  assert.equal(api.getState().hasGcmKey, false,
    'khóa GCM của lượt cũ phải bị vô hiệu hóa cùng masterKey');
  assert.equal(dom.isHidden('screen-lock'), false,
    'màn khóa phải tiếp tục chặn trong khi lượt mới chưa xác thực xong');
  assert.equal(api.getCurrentPin(), wrongPin,
    'lượt cũ không được xóa PIN của lượt mới đang unwrap');

  releaseSecondUnwrap.resolve();
  await second;

  assert.equal(api.getPinFailures().fails, failuresBefore + 1,
    'lượt mới sai PIN vẫn phải được ghi nhận đúng một lần');
  assert.equal(api.isAppUnlocked(), false,
    'sau PIN sai không được còn vật liệu khóa từ lượt cũ');
  assert.equal(api.getState().hasGcmKey, false);
  assert.equal(dom.isHidden('screen-lock'), false);
});

test('tripwire: validatePin nhận vé và chụp PIN trước unwrap, cleanup chỉ thuộc chủ vé', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'assets', '02_security.js'),
    'utf8'
  );
  const start = source.indexOf('async function validatePin()');
  const end = source.indexOf('\nfunction _openForcedPinUpgrade()', start);
  assert.ok(start >= 0 && end > start, 'phải tìm thấy thân validatePin');

  const body = source.slice(start, end);
  const ticket = body.indexOf('const myUnlockAttempt = ++__unlockAttemptSeq;');
  const snapshot = body.indexOf('const pinAttempt = currentPin;');
  const unwrap = body.indexOf('await unwrapMasterKeyAny(pinAttempt, encMaster)');
  const install = body.indexOf('await _installMasterKey(res.masterKey)', unwrap);
  assert.ok(ticket >= 0 && snapshot > ticket && unwrap > snapshot,
    'vé và PIN cục bộ phải được chụp trước await unwrap đầu tiên');

  assert.match(body,
    /finally\s*\{[\s\S]*?if\s*\(myUnlockAttempt\s*===\s*__unlockAttemptSeq\)\s*_pinChecking\s*=\s*false;[\s\S]*?\}/,
    'lượt cũ không được hạ cờ kiểm tra PIN của lượt mới');

  const preInstallGuard = body.indexOf('if (myUnlockAttempt !== __unlockAttemptSeq) return;', unwrap);
  assert.ok(preInstallGuard > unwrap && preInstallGuard < install,
    'phải dừng lượt stale sau unwrap và trước khi cài khóa');

  const installedGeneration = body.indexOf('const installedGeneration = __keyGeneration;', install);
  const installedCryptoKey = body.indexOf('const installedCryptoKey = masterCryptoKey;', installedGeneration);
  const postInstallGuard = body.indexOf('if (myUnlockAttempt !== __unlockAttemptSeq) {', installedCryptoKey);
  const migrationPin = body.indexOf('const pinForMigration = pinAttempt;', postInstallGuard);
  const clearSharedPin = body.indexOf('currentPin = "";', migrationPin);
  assert.ok(installedGeneration > install && installedCryptoKey > installedGeneration
      && postInstallGuard > installedCryptoKey && migrationPin > postInstallGuard
      && clearSharedPin > migrationPin,
    'sau importKey phải chụp identity khóa, kiểm vé lại và migration chỉ dùng PIN snapshot');

  const staleInstallBlock = body.slice(postInstallGuard, migrationPin);
  assert.match(staleInstallBlock,
    /__keyGeneration === installedGeneration[\s\S]*?masterKey === res\.masterKey[\s\S]*?masterCryptoKey === installedCryptoKey[\s\S]*?clearMasterKeyMaterial\(\);[\s\S]*?return;/,
    'lượt mất vé phải chỉ xóa đúng generation/key mà chính nó vừa cài');

  const catchStart = body.indexOf('} catch (e) {', install);
  const catchReturn = body.indexOf('\n        return;', catchStart);
  const catchBody = body.slice(catchStart, catchReturn);
  assert.match(catchBody,
    /if\s*\(myUnlockAttempt\s*===\s*__unlockAttemptSeq\)\s*\{[\s\S]*?currentPin\s*=\s*"";[\s\S]*?_setKeypadDisabled\(false\);[\s\S]*?\}/,
    'catch cài khóa chỉ được reset PIN/keypad khi còn sở hữu vé');
});

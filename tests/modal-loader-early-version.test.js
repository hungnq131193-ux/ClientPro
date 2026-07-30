const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('modal loader versions the single required gate before 01_config.js executes', async () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'assets', 'ui', 'load_modals.js'),
    'utf8',
  );

  const requestedUrls = [];
  const appendedNodes = [];
  const loaderScript = {
    src: 'https://clientpro.test/assets/ui/load_modals.js?v=EARLY_VERSION',
  };
  const root = { insertAdjacentHTML() {} };

  const document = {
    currentScript: loaderScript,
    head: {
      appendChild(node) {
        appendedNodes.push(node);
        if (typeof node.onload === 'function') node.onload();
      },
    },
    getElementById(id) {
      return id === 'ui-modals-root' ? root : null;
    },
    getElementsByTagName(tag) {
      return tag === 'script' ? [loaderScript] : [];
    },
    querySelector() {
      return null;
    },
    createElement(tag) {
      return {
        tagName: String(tag).toUpperCase(),
        setAttribute(name, value) {
          this[name] = value;
        },
      };
    },
    addEventListener() {},
    dispatchEvent() {},
  };

  const context = {
    window: {},
    document,
    localStorage: {
      getItem(key) {
        if (key === 'app_activated') return 'true';
        if (key === 'app_pin') return 'sealed-pin';
        return null;
      },
    },
    fetch(url) {
      requestedUrls.push(String(url));
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(''),
      });
    },
    console,
    CustomEvent: function CustomEvent() {},
    // Do not run post-paint warmers in this cold-path assertion.
    requestAnimationFrame() { return 1; },
    requestIdleCallback() { return 1; },
    setTimeout,
    clearTimeout,
    Promise,
    encodeURIComponent,
    decodeURIComponent,
  };

  vm.runInNewContext(source, context, { filename: 'load_modals.js' });

  // Only the gate implied by local state enters the synchronous cold-load queue.
  assert.deepEqual(requestedUrls, [
    'assets/ui/modals/screen-lock.html?v=EARLY_VERSION',
  ]);
  assert.equal(context.window.ModalLoader.initialSecurityId, 'screen-lock');

  // Every remaining security surface still uses the loader script's version even
  // though 01_config.js has not defined LAZY_MODULES_V yet.
  for (const id of [
    'setup-lock-modal',
    'activation-modal',
    'forgot-pin-modal',
    'biometric-setup-modal',
  ]) {
    await context.window.ModalLoader.ensure(id);
  }
  assert.equal(requestedUrls.length, 5);
  for (const url of requestedUrls) {
    assert.match(url, /assets\/ui\/modals\/.+\.html\?v=EARLY_VERSION$/);
  }

  // Business fragments and feature CSS share the same early version source.
  await context.window.ModalLoader.ensure('camera-modal');
  assert.equal(
    requestedUrls.at(-1),
    'assets/ui/modals/camera-modal.html?v=EARLY_VERSION',
  );

  await context.window.ModalLoader.ensureFeatureCss();
  assert.equal(appendedNodes.length, 1);
  assert.equal(appendedNodes[0].href, 'assets/css/features.css?v=EARLY_VERSION');
});

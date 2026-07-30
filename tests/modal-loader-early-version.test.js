const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('modal loader versions critical requests before 01_config.js executes', async () => {
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
    fetch(url) {
      requestedUrls.push(String(url));
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(''),
      });
    },
    console,
    CustomEvent: function CustomEvent() {},
    requestIdleCallback() {},
    setTimeout,
    clearTimeout,
    Promise,
    encodeURIComponent,
    decodeURIComponent,
  };

  vm.runInNewContext(source, context, { filename: 'load_modals.js' });

  // The loader starts the five critical security requests synchronously, before
  // 01_config.js has had a chance to define LAZY_MODULES_V.
  assert.equal(requestedUrls.length, 5);
  for (const url of requestedUrls) {
    assert.match(url, /assets\/ui\/modals\/.+\.html\?v=EARLY_VERSION$/);
  }

  await context.window.ModalLoader.ensureFeatureCss();
  assert.equal(appendedNodes.length, 1);
  assert.equal(appendedNodes[0].href, 'assets/css/features.css?v=EARLY_VERSION');
});

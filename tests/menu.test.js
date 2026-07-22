const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('assets/09_menu.js', 'utf8');

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name),
  };
}

function loadMenu(elements) {
  const context = vm.createContext({
    getEl: (id) => elements[id] || null,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(source, context, { filename: 'assets/09_menu.js' });
  return context;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('toggleMenu is a safe no-op when optional menu DOM is missing', () => {
  const menu = loadMenu({});
  assert.doesNotThrow(() => menu.toggleMenu());
  assert.doesNotThrow(() => menu._closeMenuIfOpen());
});

test('rapid close then reopen cannot be hidden by a stale close timer', async () => {
  const elements = {
    'settings-menu': { classList: classList(['hidden', 'scale-95', 'opacity-0']) },
    'menu-overlay': { classList: classList(['hidden']) },
  };
  const menu = loadMenu(elements);

  menu.toggleMenu();
  await sleep(20);
  assert.equal(elements['settings-menu'].classList.contains('hidden'), false);
  assert.equal(elements['menu-overlay'].classList.contains('hidden'), false);

  menu.toggleMenu();
  await sleep(20);
  menu.toggleMenu();
  await sleep(230);

  assert.equal(elements['settings-menu'].classList.contains('hidden'), false);
  assert.equal(elements['settings-menu'].classList.contains('opacity-0'), false);
  assert.equal(elements['menu-overlay'].classList.contains('hidden'), false);
});

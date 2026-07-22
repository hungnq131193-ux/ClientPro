let __menuOpen = null;
let __menuAnimationTimer = null;

function _clearMenuAnimationTimer() {
  if (__menuAnimationTimer !== null) {
    clearTimeout(__menuAnimationTimer);
    __menuAnimationTimer = null;
  }
}

function toggleMenu() {
  const m = getEl("settings-menu");
  const o = getEl("menu-overlay");
  if (!m || !o) return;

  if (__menuOpen === null) __menuOpen = !m.classList.contains("hidden");
  __menuOpen = !__menuOpen;
  _clearMenuAnimationTimer();

  if (__menuOpen) {
    m.classList.remove("hidden");
    o.classList.remove("hidden");
    __menuAnimationTimer = setTimeout(() => {
      __menuAnimationTimer = null;
      if (__menuOpen) m.classList.remove("scale-95", "opacity-0");
    }, 10);
  } else {
    m.classList.add("scale-95", "opacity-0");
    __menuAnimationTimer = setTimeout(() => {
      __menuAnimationTimer = null;
      if (!__menuOpen) {
        m.classList.add("hidden");
        o.classList.add("hidden");
      }
    }, 200);
  }
}

function _closeMenuIfOpen() {
  try {
    const m = getEl("settings-menu");
    if (!m) return;
    const isOpen = __menuOpen === null ? !m.classList.contains("hidden") : __menuOpen;
    if (isOpen) toggleMenu();
  } catch (e) { }
}

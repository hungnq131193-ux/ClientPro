let __menuOpen = null;
let __menuClosing = false;
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
  if (!m || !o || __menuClosing) return;

  if (__menuOpen === null) __menuOpen = !m.classList.contains("hidden");
  _clearMenuAnimationTimer();

  if (!__menuOpen) {
    __menuOpen = true;
    m.classList.remove("hidden");
    o.classList.remove("hidden");
    // Chờ browser commit frame hết display:none rồi mới gỡ class ẩn để transition
    // chạy chắc chắn. Ưu tiên nextFrame (00_globals, double-rAF) thay cho
    // setTimeout(10); giữ fallback setTimeout cho môi trường không có rAF (unit test vm).
    const reveal = () => {
      if (__menuOpen) m.classList.remove("scale-95", "opacity-0");
    };
    if (typeof nextFrame === 'function') {
      nextFrame(reveal);
    } else {
      __menuAnimationTimer = setTimeout(() => {
        __menuAnimationTimer = null;
        reveal();
      }, 10);
    }
    return;
  }

  __menuOpen = false;
  __menuClosing = true;
  m.classList.add("scale-95", "opacity-0");
  __menuAnimationTimer = setTimeout(() => {
    __menuAnimationTimer = null;
    m.classList.add("hidden");
    o.classList.add("hidden");
    __menuClosing = false;
  }, 200);
}

function _closeMenuIfOpen() {
  try {
    const m = getEl("settings-menu");
    if (!m || __menuClosing) return;
    const isOpen = __menuOpen === null ? !m.classList.contains("hidden") : __menuOpen;
    if (isOpen) toggleMenu();
  } catch (e) { }
}

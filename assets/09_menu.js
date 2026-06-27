function toggleMenu() {
  const m = getEl("settings-menu");
  const o = getEl("menu-overlay");
  if (m.classList.contains("hidden")) {
    m.classList.remove("hidden");
    o.classList.remove("hidden");
    setTimeout(() => {
      m.classList.remove("scale-95", "opacity-0");
    }, 10);
  } else {
    m.classList.add("scale-95", "opacity-0");
    setTimeout(() => {
      m.classList.add("hidden");
      o.classList.add("hidden");
    }, 200);
  }
}

function _closeMenuIfOpen() {
  try {
    const m = getEl("settings-menu");
    if (m && !m.classList.contains("hidden")) toggleMenu();
  } catch (e) { }
}


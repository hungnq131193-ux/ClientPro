/*
  Edge back-swipe (Android-like) for Chrome Android
  - Left edge swipe right  => BACK
  - Right edge swipe left  => BACK
  - Prevents browser back as much as possible (history sentinel + preventDefault)
  - Closes overlays/panels even if IDs differ via generic fallback.

  Additive only: does not modify existing app logic.
*/
(function () {
  'use strict';

  // Reduce Chrome Android native back-swipe visual flash.
  // Keep this local to the module (no global CSS edits).
  function applyNavGuards() {
    try {
      if (document.getElementById('clientpro-edgeback-guards')) return;
      const st = document.createElement('style');
      st.id = 'clientpro-edgeback-guards';
      st.textContent = [
        'html,body{overscroll-behavior-x:none;}',
        // Prefer vertical pan; we handle horizontal edge-swipe ourselves.
        'body{touch-action:pan-y;}'
      ].join('');
      document.head.appendChild(st);
    } catch (_) { }
  }

  // --- Gesture tuning ---
  const EDGE_PX = 28;            // touch must start within left/right edge band
  const TRIGGER_PX = 80;         // minimum horizontal travel to trigger
  const MAX_OFF_AXIS_PX = 70;    // max vertical drift allowed
  const MIN_INTENT_PX = 16;      // movement before locking intent (higher = fewer false locks on scroll)
  const DIRECTION_RATIO = 1.2;   // dx must exceed dy by this ratio to be considered horizontal intent
  const MAX_GESTURE_MS = 800;    // gesture time limit
  const COOLDOWN_MS = 450;       // prevent double-trigger

  const get = (id) => (typeof window.getEl === 'function' ? window.getEl(id) : document.getElementById(id));
  const hasClass = (el, cls) => !!(el && el.classList && el.classList.contains(cls));
  const isHidden = (el) => !el || hasClass(el, 'hidden') || el.getAttribute('aria-hidden') === 'true';
  const isSlideHidden = (el) => !el || hasClass(el, 'translate-x-full');
  const isVisibleModal = (id) => !isHidden(get(id));
  const isVisibleSlide = (id) => !isSlideHidden(get(id));

  function callIfFn(name) {
    const fn = window[name];
    if (typeof fn === 'function') {
      fn();
      return true;
    }
    return false;
  }

  function shouldIgnoreTarget(t) {
    if (!t) return false;
    const el = t.closest
      ? t.closest([
          'input',
          'textarea',
          'select',
          '[contenteditable="true"]',
          '.no-edge-back',
          '[data-edge-back="ignore"]',
          // Any real button/link/clickable control (this app uses inline
          // onclick="" handlers extensively, e.g. header back-arrow icons
          // that happen to sit right inside the edge band). A tap there
          // should always go to its own handler, never be swallowed by our
          // gesture tracking/preventDefault.
          'button',
          'a[href]',
          '[role="button"]',
          '[onclick]',
          // Lightbox has its own full-width left/right swipe to navigate images
          // (see setupSwipe() in 04_ui_common.js). Starting an edge-back gesture
          // there would fight with image navigation, so let the lightbox own it.
          '#lightbox',
          // MapLibre canvas handles its own pan/pinch/rotate touch gestures.
          '.maplibregl-canvas, .maplibregl-canvas-container, .maplibregl-map'
        ].join(', '))
      : null;
    return !!el;
  }

  // -------- Generic fallback: close the top-most overlay/dialog/panel --------
  function isElementVisible(el) {
    if (!el) return false;
    if (el === document.body || el === document.documentElement) return false;
    const st = window.getComputedStyle(el);
    if (!st) return false;
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const rect = el.getBoundingClientRect();
    if (!rect || rect.width < 2 || rect.height < 2) return false;
    return true;
  }

  function zIndexOf(el) {
    const st = window.getComputedStyle(el);
    const z = st ? st.zIndex : 'auto';
    const n = Number(z);
    return Number.isFinite(n) ? n : 0;
  }

  function findTopOverlayCandidate() {
    // Common patterns for modals/overlays/panels
    const selectors = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      '.modal',
      '.dialog',
      '.overlay',
      '.backdrop',
      '.sheet',
      '.drawer',
      '.bottom-sheet',
      '[data-modal]',
      '[data-overlay]',
      '[data-dialog]'
    ].join(',');

    const list = Array.from(document.querySelectorAll(selectors))
      .filter(isElementVisible);

    if (!list.length) return null;

    // choose highest z-index, tie-breaker by DOM order (later tends to be on top)
    list.sort((a, b) => {
      const dz = zIndexOf(a) - zIndexOf(b);
      if (dz !== 0) return dz;
      return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    });

    return list[list.length - 1] || null;
  }

  function tryClickCloseIn(el) {
    if (!el) return false;
    const closeSelectors = [
      '[data-close]',
      '[data-dismiss]',
      '[data-action="close"]',
      '[aria-label="Close"]',
      '[aria-label="close"]',
      '.close',
      '.btn-close',
      '.modal-close',
      '.dialog-close',
      '.overlay-close'
    ].join(',');

    const btn = el.querySelector(closeSelectors);
    if (btn && isElementVisible(btn)) {
      btn.click();
      return true;
    }
    return false;
  }

  function tryEscapeClose() {
    // Many libraries close modal on Escape.
    const ev = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true });
    document.dispatchEvent(ev);
  }

  function genericCloseTopOverlayOrPanel() {
    const top = findTopOverlayCandidate();
    if (!top) return false;

    // try standard close buttons first
    if (tryClickCloseIn(top)) return true;

    // try escape-driven close
    tryEscapeClose();

    // if still visible, last resort: force-hide (non-destructive in most SPA)
    // only apply if it looks like a modal/overlay element
    if (isElementVisible(top)) {
      top.classList.add('hidden');
      top.setAttribute('aria-hidden', 'true');
      return true;
    }
    return true;
  }

  // -------- App-specific back action: keep your existing priority logic --------
  function runBackAction() {
    // Prevent dismissing security/activation overlays if present
    if (isVisibleModal('screen-lock') || isVisibleModal('activation-modal') || isVisibleModal('setup-lock-modal')) {
      return false;
    }

    // Known overlays (keep your current mapping)
    if (isVisibleModal('camera-modal')) {
      return callIfFn('closeCamera') || (get('camera-modal').classList.add('hidden'), true);
    }
    if (isVisibleModal('lightbox')) {
      return callIfFn('closeLightbox') || (get('lightbox').classList.add('hidden'), true);
    }

    // Common modals
    if (isVisibleModal('approve-modal')) {
      return callIfFn('closeApproveModal') || (get('approve-modal').classList.add('hidden'), true);
    }
    if (isVisibleModal('ref-price-modal')) {
      return callIfFn('closeRefModal') || (get('ref-price-modal').classList.add('hidden'), true);
    }
    if (isVisibleModal('guide-modal')) {
      return callIfFn('closeGuideModal') || (get('guide-modal').classList.add('hidden'), true);
    }
    if (isVisibleModal('donate-modal')) {
      return callIfFn('closeDonateModal') || (get('donate-modal').classList.add('hidden'), true);
    }
    if (isVisibleModal('asset-modal')) {
      return callIfFn('closeAssetModal') || (get('asset-modal').classList.add('hidden'), true);
    }
    if (isVisibleModal('add-modal')) {
      return callIfFn('closeModal') || (get('add-modal').classList.add('hidden'), true);
    }
    if (isVisibleModal('forgot-pin-modal')) {
      return callIfFn('closeForgotModal') || (get('forgot-pin-modal').classList.add('hidden'), true);
    }
    if (isVisibleModal('backup-manager-modal')) {
      return callIfFn('closeBackupManagerModal') || (get('backup-manager-modal').classList.add('hidden'), true);
    }

    // Settings/hamburger dropdown (menu-overlay + settings-menu). Not a modal or
    // slide-panel, so it needs its own check; toggleMenu() closes it either way.
    if (isVisibleModal('settings-menu')) {
      return callIfFn('toggleMenu') || (get('settings-menu').classList.add('hidden'), true);
    }

    // Slide panels (order matters: most nested first)
    if (isVisibleSlide('screen-asset-gallery')) {
      return callIfFn('closeAssetGallery') || (get('screen-asset-gallery').classList.add('translate-x-full'), true);
    }
    if (isVisibleSlide('screen-map')) {
      return callIfFn('toggleMap') || (get('screen-map').classList.add('translate-x-full'), true);
    }
    // screen-folder is nested inside screen-customer-list, so close it first
    if (isVisibleSlide('screen-folder')) {
      return callIfFn('closeFolder') || (get('screen-folder').classList.add('translate-x-full'), true);
    }
    if (isVisibleSlide('screen-customer-list')) {
      return callIfFn('closeCustomerList') || (get('screen-customer-list').classList.add('translate-x-full'), true);
    }


    // Fallback: close any top-most overlay/panel even if IDs differ
    return genericCloseTopOverlayOrPanel();
  }

  // -------- Gesture handling (both edges) --------
  let tracking = false;
  let decided = false;
  let horizontal = false;
  let fromLeftEdge = false;
  let fromRightEdge = false;
  let sx = 0;
  let sy = 0;
  let st = 0;
  let cooldownUntil = 0;
  let lastTouchBackAt = 0;          // timestamp of last touch-driven runBackAction()
  const POPSTATE_DEDUPE_MS = 600;   // if popstate fires this soon after, treat as the same physical gesture
  const SENTINEL_STATE = { __clientpro_edge_back: 1 };
  let suppressDepthPush = false;    // true while we're closing something, so that doesn't get miscounted as an "open"

  // PERF: Chỉ gắn touchmove (passive:false) khi thật sự bắt đầu edge-swipe.
  // Tránh ảnh hưởng scroll performance toàn app.
  let __moveBound = false;
  function bindMove() {
    if (__moveBound) return;
    __moveBound = true;
    document.addEventListener('touchmove', onMove, { passive: false });
  }
  function unbindMove() {
    if (!__moveBound) return;
    __moveBound = false;
    // capture must match; passive flag is ignored for remove in most browsers but keep capture explicit
    document.removeEventListener('touchmove', onMove, { capture: false });
  }

  function onStart(e) {
    if (Date.now() < cooldownUntil) return;
    if (!e.changedTouches || e.changedTouches.length !== 1) return;

    const t = e.changedTouches[0];
    const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);

    fromLeftEdge = t.clientX <= EDGE_PX;
    fromRightEdge = (vw - t.clientX) <= EDGE_PX;

    if (!fromLeftEdge && !fromRightEdge) return;
    if (shouldIgnoreTarget(e.target)) return;

    // Claim gesture early to reduce browser "back"
    if (e.cancelable) e.preventDefault();

    tracking = true;
    decided = false;
    horizontal = false;
    sx = t.clientX;
    sy = t.clientY;
    st = Date.now();

    // Gắn touchmove only during active gesture
    bindMove();
  }

  function onMove(e) {
    if (!tracking) return;
    if (!e.changedTouches || e.changedTouches.length !== 1) return;

    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;

    if (!decided) {
      if (Math.abs(dx) < MIN_INTENT_PX && Math.abs(dy) < MIN_INTENT_PX) return;
      decided = true;

      // left edge: must go right; right edge: must go left.
      // Require dx to clearly dominate dy (not just barely exceed it) so a
      // slightly-diagonal vertical scroll near the edge isn't mistaken for back-swipe.
      const horizontalDominant = Math.abs(dx) > Math.abs(dy) * DIRECTION_RATIO;
      if (fromLeftEdge && dx > 0 && horizontalDominant) horizontal = true;
      else if (fromRightEdge && dx < 0 && horizontalDominant) horizontal = true;
      else {
        tracking = false;
        unbindMove();
        return;
      }
    }

    if (horizontal && e.cancelable) e.preventDefault();
  }

  function onEnd(e) {
    if (!tracking) return;
    tracking = false;
    unbindMove();
    if (!horizontal) return;
    if (!e.changedTouches || e.changedTouches.length !== 1) return; // multi-touch (e.g. pinch) already cleaned up above

    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    const dt = Date.now() - st;

    const passTime = dt <= MAX_GESTURE_MS;
    const passAxis = Math.abs(dy) <= MAX_OFF_AXIS_PX;

    const passDistance =
      (fromLeftEdge && dx >= TRIGGER_PX) ||
      (fromRightEdge && dx <= -TRIGGER_PX);

    if (passTime && passAxis && passDistance) {
      suppressDepthPush = true;
      const ok = runBackAction();
      lastTouchBackAt = Date.now();
      if (ok) cooldownUntil = Date.now() + COOLDOWN_MS;
      requestAnimationFrame(function () { suppressDepthPush = false; });
    }
  }

  function init() {
    applyNavGuards();

    document.addEventListener('touchstart', onStart, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', function () { tracking = false; unbindMove(); }, { passive: true });

    // -------- Real depth tracking (replaces the old "sentinel loop") --------
    // Chrome collapses/ignores repeated history.pushState() calls that keep
    // reusing the same URL with throwaway state objects — that's exactly what
    // a "sentinel loop" is, so on current Chrome it stops reliably trapping
    // back navigation after a while (reported: 2nd back exits the app even
    // without fast repeated swipes). The fix: push exactly ONE history entry
    // per screen/modal that actually opens, so each back gesture consumes
    // exactly one real, legitimate navigation step — matching how Chrome
    // expects an SPA's history to behave, so it doesn't get collapsed.
    const TRACKED_MODAL_IDS = [
      'camera-modal', 'lightbox', 'approve-modal', 'ref-price-modal',
      'guide-modal', 'donate-modal', 'asset-modal', 'add-modal',
      'forgot-pin-modal', 'backup-manager-modal', 'settings-menu'
    ];
    const TRACKED_SLIDE_IDS = [
      'screen-asset-gallery', 'screen-map', 'screen-folder', 'screen-customer-list'
    ];
    const lastVisible = new Map();
    TRACKED_MODAL_IDS.forEach((id) => lastVisible.set(id, isVisibleModal(id)));
    TRACKED_SLIDE_IDS.forEach((id) => lastVisible.set(id, isVisibleSlide(id)));

    let scanQueued = false;
    function scanForOpens() {
      scanQueued = false;
      let opened = false;
      TRACKED_MODAL_IDS.forEach((id) => {
        const now = isVisibleModal(id);
        if (now && !lastVisible.get(id)) opened = true;
        lastVisible.set(id, now);
      });
      TRACKED_SLIDE_IDS.forEach((id) => {
        const now = isVisibleSlide(id);
        if (now && !lastVisible.get(id)) opened = true;
        lastVisible.set(id, now);
      });
      // A screen/modal just opened by a normal tap (not by our own back
      // handling) — record exactly one real history step for it.
      if (opened && !suppressDepthPush) {
        try {
          history.pushState(SENTINEL_STATE, document.title, location.href);
        } catch (_) { }
      }
    }

    try {
      const mo = new MutationObserver(function () {
        if (scanQueued) return;
        scanQueued = true;
        // Batch rapid class mutations (animation classes toggle alongside
        // hidden/translate-x-full) into a single check per frame.
        requestAnimationFrame(scanForOpens);
      });
      mo.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
    } catch (_) { }

    // Baseline: a single entry so the very first back gesture (from the
    // dashboard root, nothing open) has something safe to consume instead of
    // instantly exiting on a stray gesture. Beyond that, depth is earned
    // entirely by real screen/modal opens above.
    try {
      if (!history.state || !history.state.__clientpro_edge_back) {
        history.pushState(SENTINEL_STATE, document.title, location.href);
      }
      window.addEventListener('popstate', function (ev) {
        const justHandledByTouch = (Date.now() - lastTouchBackAt) < POPSTATE_DEDUPE_MS;
        // Closing a screen changes classes too; don't let that close also
        // count as a fresh "open" in the very same tick.
        suppressDepthPush = true;
        if (!justHandledByTouch) {
          runBackAction();
        }
        requestAnimationFrame(function () { suppressDepthPush = false; });
      });
    } catch (_) { }

  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.__edgeBackSwipe = { runBackAction };
})();

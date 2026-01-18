/*
  Edge back-swipe (Android-like)
  - Swipe from left edge -> trigger app "back" behavior.
  - Additive only: no existing logic is modified.
*/
(function () {
  'use strict';

  // --- Gesture tuning ---
  const EDGE_PX = 24;            // touch must start within this left-edge band
  const TRIGGER_PX = 90;         // minimum horizontal travel to trigger
  const MAX_OFF_AXIS_PX = 60;    // maximum vertical drift allowed
  const MIN_INTENT_PX = 10;      // movement before locking intent
  const COOLDOWN_MS = 500;       // prevent double-trigger

  const get = (id) => (typeof window.getEl === 'function' ? window.getEl(id) : document.getElementById(id));
  const hasClass = (el, cls) => !!(el && el.classList && el.classList.contains(cls));
  const isHidden = (el) => !el || hasClass(el, 'hidden');
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

  function runBackAction() {
    // Do not allow gesture to dismiss security/activation overlays.
    if (isVisibleModal('screen-lock') || isVisibleModal('activation-modal') || isVisibleModal('setup-lock-modal')) {
      return false;
    }

    // High-priority overlays
    if (isVisibleModal('qr-modal')) {
      return callIfFn('closeQrScanner') || (get('qr-modal').classList.add('hidden'), true);
    }
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

    // Slide screens (panels)
    if (isVisibleSlide('screen-asset-gallery')) {
      return callIfFn('closeAssetGallery') || (get('screen-asset-gallery').classList.add('translate-x-full'), true);
    }
    if (isVisibleSlide('screen-map')) {
      return callIfFn('toggleMap') || (get('screen-map').classList.add('translate-x-full'), true);
    }
    if (isVisibleSlide('screen-folder')) {
      return callIfFn('closeFolder') || (get('screen-folder').classList.add('translate-x-full'), true);
    }

    // Fallback: browser history (if used)
    if (window.history && window.history.length > 1) {
      window.history.back();
      return true;
    }

    return false;
  }

  function shouldIgnoreTarget(t) {
    if (!t) return false;
    const el = t.closest
      ? t.closest('input, textarea, select, [contenteditable="true"], .no-edge-back, [data-edge-back="ignore"]')
      : null;
    return !!el;
  }

  let tracking = false;
  let decided = false;
  let horizontal = false;
  let sx = 0;
  let sy = 0;
  let st = 0;
  let cooldownUntil = 0;

  function onStart(e) {
    if (Date.now() < cooldownUntil) return;
    if (!e.changedTouches || e.changedTouches.length !== 1) return;

    const t = e.changedTouches[0];
    if (t.clientX > EDGE_PX) return;
    if (shouldIgnoreTarget(e.target)) return;

    tracking = true;
    decided = false;
    horizontal = false;
    sx = t.clientX;
    sy = t.clientY;
    st = Date.now();
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

      if (dx > 0 && Math.abs(dx) > Math.abs(dy)) {
        horizontal = true;
      } else {
        tracking = false;
        return;
      }
    }

    if (horizontal && e.cancelable) {
      e.preventDefault();
    }
  }

  function onEnd(e) {
    if (!tracking) return;
    tracking = false;
    if (!horizontal) return;
    if (!e.changedTouches || e.changedTouches.length !== 1) return;

    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    const dt = Date.now() - st;

    if (dx >= TRIGGER_PX && Math.abs(dy) <= MAX_OFF_AXIS_PX && dt <= 700) {
      const ok = runBackAction();
      if (ok) cooldownUntil = Date.now() + COOLDOWN_MS;
    }
  }

  function init() {
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', function () { tracking = false; }, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Optional debug hook
  window.__edgeBackSwipe = { runBackAction };
})();

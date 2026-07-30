/**
 * document-scanner.js — camera document scan session (detect → crop → enhance → review).
 * Does not touch encryptImageData / IDB write path; hands a JPEG data URL to saveImageToDB.
 */
(function () {
  'use strict';

  var Geom = null;
  var Enhance = null;

  var HINTS = {
    needCorners: 'Đưa đủ 4 góc giấy tờ vào khung',
    closer: 'Đưa gần hơn',
    dark: 'Thiếu sáng',
    bright: 'Ảnh bị cháy sáng',
    hold: 'Giữ yên',
    blurry: 'Ảnh chưa đủ nét',
    ready: 'Sẵn sàng chụp',
    processing: 'Đang xử lý giấy tờ…',
  };

  var state = {
    mode: 'document', // 'document' | 'photo'
    active: false,
    worker: null,
    detectId: 0,
    lastCorners: null,
    stableSince: 0,
    history: [],
    frameHandle: null,
    rafTimer: null,
    stream: null,
    track: null,
    seq: 0,
    snapshot: null, // { customerId, assetId, captureMode }
    busy: false,
    review: null, // { dataUrl, corners, width, height, objectUrl }
  };

  function assetV() {
    try {
      if (typeof LAZY_MODULES_V !== 'undefined' && LAZY_MODULES_V) return LAZY_MODULES_V;
    } catch (e) { }
    return '';
  }

  function scriptBase() {
    var v = assetV();
    return 'assets/document-scanner/';
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src + (assetV() ? ('?v=' + assetV()) : '');
      s.onload = function () { resolve(true); };
      s.onerror = function () { reject(new Error('load failed: ' + src)); };
      document.head.appendChild(s);
    });
  }

  async function ensureLibs() {
    if (!window.DocumentGeometry) await loadScript(scriptBase() + 'document-geometry.js');
    if (!window.DocumentImageEnhance) await loadScript(scriptBase() + 'document-image-enhance.js');
    Geom = window.DocumentGeometry;
    Enhance = window.DocumentImageEnhance;
  }

  function ensureWorker() {
    if (state.worker) return state.worker;
    var url = scriptBase() + 'document-detector.worker.js';
    if (assetV()) url += '?v=' + assetV();
    state.worker = new Worker(url);
    state.worker.onmessage = onWorkerMessage;
    return state.worker;
  }

  function setHint(text) {
    var el = document.getElementById('cp-scan-hint');
    if (el) el.textContent = text || '';
  }

  function setModeUi() {
    var btn = document.getElementById('cp-cam-mode-toggle');
    var modal = document.getElementById('camera-modal');
    if (btn) {
      btn.textContent = state.mode === 'document' ? 'Ảnh thường' : 'Quét giấy tờ';
      btn.setAttribute('aria-pressed', state.mode === 'document' ? 'true' : 'false');
    }
    if (modal) {
      modal.classList.toggle('cp-scan-mode', state.mode === 'document');
    }
    var overlay = document.getElementById('cp-scan-overlay');
    if (overlay) overlay.classList.toggle('hidden', state.mode !== 'document');
    var hint = document.getElementById('cp-scan-hint');
    if (hint) hint.classList.toggle('hidden', state.mode !== 'document');
  }

  function toggleMode() {
    state.mode = state.mode === 'document' ? 'photo' : 'document';
    state.history = [];
    state.lastCorners = null;
    state.stableSince = 0;
    setModeUi();
    if (state.mode === 'document') setHint(HINTS.needCorners);
  }

  function drawOverlay(corners, w, h) {
    var canvas = document.getElementById('cp-scan-overlay-canvas');
    var video = document.getElementById('camera-feed');
    if (!canvas || !video) return;
    var cw = video.clientWidth || video.videoWidth || w;
    var ch = video.clientHeight || video.videoHeight || h;
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    if (!corners || corners.length !== 4 || !w || !h) return;
    // <video class="object-cover"> scales the landscape source UNIFORMLY and crops
    // the overflow — on portrait phones cw/w and ch/h differ. Stretching x/y
    // independently makes the outline diverge from the document; map through the
    // same cover transform: scale = max(cw/w, ch/h), then center crop offset.
    var scale = Math.max(cw / w, ch / h);
    var offsetX = (cw - w * scale) / 2;
    var offsetY = (ch - h * scale) / 2;
    function mapPoint(p) {
      return { x: offsetX + p.x * scale, y: offsetY + p.y * scale };
    }
    var mapped = corners.map(mapPoint);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.95)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(mapped[0].x, mapped[0].y);
    for (var i = 1; i < 4; i++) ctx.lineTo(mapped[i].x, mapped[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.85)';
    for (i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(mapped[i].x, mapped[i].y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function onWorkerMessage(ev) {
    var msg = ev.data || {};
    if (msg.type !== 'detect-result' || msg.id !== state.detectId) return;
    if (!state.active || state.mode !== 'document' || state.busy) return;
    var meta = state.detectMeta && state.detectMeta[msg.id];
    if (state.detectMeta) delete state.detectMeta[msg.id];
    if (!msg.ok || !msg.corners) {
      state.history = [];
      state.lastCorners = null;
      state.stableSince = 0;
      drawOverlay(null, msg.width, msg.height);
      setHint(HINTS.needCorners);
      return;
    }
    var corners = msg.corners;
    if (msg.edgeTouch) {
      setHint(HINTS.needCorners);
      drawOverlay(corners, msg.width, msg.height);
      state.stableSince = 0;
      return;
    }
    if (msg.areaRatio < 0.22) {
      setHint(HINTS.closer);
      drawOverlay(corners, msg.width, msg.height);
      state.stableSince = 0;
      return;
    }
    drawOverlay(corners, msg.width, msg.height);
    // Blurry preview: keep overlay for guidance, but never advance stability / auto-capture.
    if (meta && meta.sharpOk === false) {
      setHint(HINTS.blurry);
      state.stableSince = 0;
      state.lastCorners = corners;
      return;
    }
    var now = Date.now();
    if (state.lastCorners && Geom) {
      var drift = Geom.cornerDrift(state.lastCorners, corners, msg.width, msg.height);
      if (drift < 0.02) {
        if (!state.stableSince) state.stableSince = now;
      } else {
        state.stableSince = now;
      }
    } else {
      state.stableSince = now;
    }
    state.lastCorners = corners;
    state.history.push({ t: now, corners: corners, w: msg.width, h: msg.height });
    if (state.history.length > 10) state.history.shift();

    var stableMs = state.stableSince ? (now - state.stableSince) : 0;
    if (stableMs >= 800 && stableMs <= 5000) {
      setHint(HINTS.ready);
      if (!state.busy) captureDocument({ auto: true });
    } else if (stableMs >= 700) {
      setHint(HINTS.hold);
    } else {
      setHint(HINTS.hold);
    }
  }

  function samplePreviewFrame() {
    var video = document.getElementById('camera-feed');
    if (!video || !video.videoWidth) return null;
    var vw = video.videoWidth, vh = video.videoHeight;
    var longSide = Math.max(vw, vh);
    var target = 704;
    var scale = Math.min(1, target / longSide);
    var w = Math.max(32, Math.round(vw * scale));
    var h = Math.max(32, Math.round(vh * scale));
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    return { imageData: ctx.getImageData(0, 0, w, h), width: w, height: h, videoW: vw, videoH: vh };
  }

  function requestDetect() {
    if (!state.active || state.mode !== 'document' || state.busy) return;
    var sample = samplePreviewFrame();
    if (!sample) return;
    // Quick lighting check on main thread (cheap downsample already)
    var sharpOk = true;
    if (Enhance) {
      var light = Enhance.lightingStats(sample.imageData);
      if (light.tooDark) { setHint(HINTS.dark); return; }
      if (light.tooBright) { setHint(HINTS.bright); return; }
      var sharp = Enhance.sharpnessScore(sample.imageData);
      if (sharp < 18) {
        setHint(HINTS.blurry);
        sharpOk = false;
        // Still run detection for overlay guidance, but block auto-capture.
      }
    }
    var worker = ensureWorker();
    var id = ++state.detectId;
    if (!state.detectMeta) state.detectMeta = Object.create(null);
    state.detectMeta[id] = { sharpOk: sharpOk };
    worker.postMessage({
      type: 'detect',
      id: id,
      imageData: {
        width: sample.imageData.width,
        height: sample.imageData.height,
        data: sample.imageData.data,
      },
    });
  }

  function loopDetect() {
    if (!state.active) return;
    var video = document.getElementById('camera-feed');
    if (state.mode === 'document') requestDetect();
    if (video && typeof video.requestVideoFrameCallback === 'function') {
      // Throttle: schedule next detect ~every 3–4 frames via timeout gate
      state.frameHandle = video.requestVideoFrameCallback(function () {
        state.rafTimer = setTimeout(loopDetect, 140);
      });
    } else {
      state.rafTimer = setTimeout(loopDetect, 280);
    }
  }

  function stopLoop() {
    var video = document.getElementById('camera-feed');
    if (video && state.frameHandle != null && typeof video.cancelVideoFrameCallback === 'function') {
      try { video.cancelVideoFrameCallback(state.frameHandle); } catch (e) { }
    }
    state.frameHandle = null;
    if (state.rafTimer) { clearTimeout(state.rafTimer); state.rafTimer = null; }
  }

  function applyTrackConstraints(track) {
    if (!track || typeof track.getCapabilities !== 'function') return;
    var caps;
    try { caps = track.getCapabilities() || {}; } catch (e) { return; }
    var advanced = {};
    try {
      if (caps.focusMode && caps.focusMode.indexOf('continuous') >= 0) {
        advanced.focusMode = 'continuous';
      }
      if (typeof caps.zoom === 'object' && caps.zoom.max > caps.zoom.min) {
        // leave default zoom
      }
      if (Object.keys(advanced).length) {
        track.applyConstraints({ advanced: [advanced] }).catch(function () { });
      }
    } catch (e) { }
  }

  async function openSession(mode, seq) {
    await ensureLibs();
    if (window.ModalLoader) {
      await window.ModalLoader.ensure('camera-modal');
      await window.ModalLoader.ensureFeatureCss();
    }
    state.seq = seq;
    state.active = true;
    state.busy = false;
    state.mode = 'document';
    state.history = [];
    state.lastCorners = null;
    state.stableSince = 0;
    state.snapshot = {
      customerId: typeof currentCustomerId !== 'undefined' ? currentCustomerId : null,
      assetId: typeof currentAssetId !== 'undefined' ? currentAssetId : null,
      captureMode: mode || (typeof captureMode !== 'undefined' ? captureMode : 'profile'),
    };
    if (typeof captureMode !== 'undefined') captureMode = state.snapshot.captureMode;

    var modal = document.getElementById('camera-modal');
    if (modal) modal.classList.remove('hidden');
    setModeUi();
    setHint(HINTS.needCorners);

    // Stop previous stream
    cleanupStreamOnly();

    var stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
        audio: false,
      });
    } catch (e) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      } catch (e2) {
        if (modal) modal.classList.add('hidden');
        state.active = false;
        throw e2;
      }
    }
    if (seq !== state.seq || !state.active || (modal && modal.classList.contains('hidden'))) {
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { }
      return;
    }
    if (typeof isAppUnlocked === 'function' && !isAppUnlocked()) {
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { }
      cleanupAll();
      return;
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { }
      cleanupAll();
      return;
    }
    state.stream = stream;
    state.track = stream.getVideoTracks()[0] || null;
    applyTrackConstraints(state.track);
    var feed = document.getElementById('camera-feed');
    if (feed) feed.srcObject = stream;
    // Sync global stream used by legacy closeCamera
    try { if (typeof stream !== 'undefined') { /* legacy var */ } } catch (e) { }
    try { window.__cpCameraStream = stream; } catch (e) { }
    loopDetect();
  }

  function cleanupStreamOnly() {
    if (state.stream) {
      try { state.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { }
      state.stream = null;
      state.track = null;
    }
    try {
      var v = document.getElementById('camera-feed');
      if (v) v.srcObject = null;
    } catch (e) { }
    try { window.__cpCameraStream = null; } catch (e) { }
  }

  function terminateWorker() {
    if (state.worker) {
      try { state.worker.terminate(); } catch (e) { }
      state.worker = null;
    }
  }

  function closeReview() {
    var rev = document.getElementById('doc-scan-review');
    if (rev) rev.classList.add('hidden');
    if (state.review && state.review.objectUrl) {
      try { URL.revokeObjectURL(state.review.objectUrl); } catch (e) { }
    }
    state.review = null;
  }

  function cleanupAll() {
    // Invalidate any in-flight captureDocument awaits (takePhoto / redetect).
    state.seq = (state.seq || 0) + 1;
    state.active = false;
    state.busy = false;
    state.detectMeta = Object.create(null);
    stopLoop();
    cleanupStreamOnly();
    terminateWorker();
    closeReview();
    state.history = [];
    state.lastCorners = null;
    var modal = document.getElementById('camera-modal');
    if (modal) modal.classList.add('hidden');
    drawOverlay(null, 1, 1);
  }

  async function takeHighResBitmap() {
    var track = state.track;
    if (track && typeof ImageCapture !== 'undefined') {
      try {
        var ic = new ImageCapture(track);
        if (typeof ic.takePhoto === 'function') {
          var blob = await ic.takePhoto();
          return await createImageBitmap(blob);
        }
      } catch (e) { /* fall through */ }
    }
    var video = document.getElementById('camera-feed');
    if (!video || !video.videoWidth) throw new Error('NO_VIDEO');
    return await createImageBitmap(video);
  }

  function bitmapToImageData(bitmap) {
    var c = document.createElement('canvas');
    c.width = bitmap.width; c.height = bitmap.height;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    return { canvas: c, ctx: ctx, imageData: ctx.getImageData(0, 0, c.width, c.height) };
  }

  function imageDataToJpegDataUrl(imageData, quality) {
    var c = document.createElement('canvas');
    c.width = imageData.width; c.height = imageData.height;
    c.getContext('2d').putImageData(
      new ImageData(imageData.data, imageData.width, imageData.height),
      0, 0
    );
    return c.toDataURL('image/jpeg', quality == null ? 0.92 : quality);
  }

  async function redetectOnStill(imageData) {
    return new Promise(function (resolve) {
      var worker = ensureWorker();
      var id = ++state.detectId;
      var longSide = Math.max(imageData.width, imageData.height);
      var target = 768;
      var scale = Math.min(1, target / longSide);
      var w = Math.round(imageData.width * scale);
      var h = Math.round(imageData.height * scale);
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var ctx = c.getContext('2d', { willReadFrequently: true });
      var tmp = document.createElement('canvas');
      tmp.width = imageData.width; tmp.height = imageData.height;
      tmp.getContext('2d').putImageData(new ImageData(imageData.data, imageData.width, imageData.height), 0, 0);
      ctx.drawImage(tmp, 0, 0, w, h);
      var small = ctx.getImageData(0, 0, w, h);
      function onMsg(ev) {
        var msg = ev.data || {};
        if (msg.type !== 'detect-result' || msg.id !== id) return;
        worker.removeEventListener('message', onMsg);
        if (!msg.ok || !msg.corners) { resolve(null); return; }
        resolve(Geom.scaleCorners(msg.corners, w, h, imageData.width, imageData.height));
      }
      worker.addEventListener('message', onMsg);
      worker.postMessage({ type: 'detect', id: id, imageData: { width: w, height: h, data: small.data } });
      setTimeout(function () { worker.removeEventListener('message', onMsg); resolve(null); }, 2500);
    });
  }

  async function captureDocument(opts) {
    if (state.busy || !state.active) return;
    if (typeof isAppUnlocked === 'function' && !isAppUnlocked()) {
      cleanupAll();
      return;
    }
    var captureSeq = state.seq;
    state.busy = true;
    setHint(HINTS.processing);
    stopLoop();
    function abandonCapture() {
      // Early-abort after await must not leave busy stuck if cleanupAll did not run
      // (e.g. seq advanced by a newer openSession that already set busy=false — still safe).
      if (captureSeq === state.seq) state.busy = false;
    }
    try {
      var bitmap = await takeHighResBitmap();
      // Session may have been closed/locked during takePhoto / bitmap work.
      if (captureSeq !== state.seq || !state.active) {
        try { bitmap && bitmap.close && bitmap.close(); } catch (e) { }
        abandonCapture();
        return;
      }
      if (typeof isAppUnlocked === 'function' && !isAppUnlocked()) {
        try { bitmap && bitmap.close && bitmap.close(); } catch (e) { }
        cleanupAll();
        return;
      }
      var pack = bitmapToImageData(bitmap);
      try { bitmap.close && bitmap.close(); } catch (e) { }

      // Preview corners are only a hint — still must re-detect on the high-res image.
      // If still detection fails, discard preview coords (different aspect → guessed crop).
      var stillCorners = await redetectOnStill(pack.imageData);
      if (captureSeq !== state.seq || !state.active) {
        abandonCapture();
        return;
      }
      if (typeof isAppUnlocked === 'function' && !isAppUnlocked()) {
        cleanupAll();
        return;
      }

      var corners;
      if (stillCorners) {
        corners = Geom.expandQuad(stillCorners, pack.imageData.width, pack.imageData.height, 0.01);
      } else {
        // Manual review inset — never scale preview corners onto a mismatched still.
        corners = [
          { x: pack.imageData.width * 0.08, y: pack.imageData.height * 0.08 },
          { x: pack.imageData.width * 0.92, y: pack.imageData.height * 0.08 },
          { x: pack.imageData.width * 0.92, y: pack.imageData.height * 0.92 },
          { x: pack.imageData.width * 0.08, y: pack.imageData.height * 0.92 },
        ];
      }

      // Pause camera UI → review
      cleanupStreamOnly();
      var modal = document.getElementById('camera-modal');
      if (modal) modal.classList.add('hidden');

      if (captureSeq !== state.seq || !state.active) {
        abandonCapture();
        return;
      }
      if (typeof isAppUnlocked === 'function' && !isAppUnlocked()) {
        cleanupAll();
        return;
      }
      openReview(pack.imageData, corners, opts && opts.auto);
    } catch (e) {
      try { ErrorHandler.showError('CAMERA', 'Không chụp được giấy tờ. Thử lại.', e); } catch (err) { }
      state.busy = false;
      if (state.active && captureSeq === state.seq) loopDetect();
    }
  }

  function openReview(imageData, corners, fromAuto) {
    ensureReviewDom();
    var rev = document.getElementById('doc-scan-review');
    var imgCanvas = document.getElementById('cp-review-canvas');
    imgCanvas.width = imageData.width;
    imgCanvas.height = imageData.height;
    imgCanvas.getContext('2d').putImageData(
      new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height),
      0, 0
    );
    state.review = {
      imageData: {
        width: imageData.width,
        height: imageData.height,
        data: new Uint8ClampedArray(imageData.data),
      },
      corners: corners.map(function (p) { return { x: p.x, y: p.y }; }),
      rotation: 0,
      fromAuto: !!fromAuto,
    };
    // Must unhide BEFORE measuring layout — hidden (display:none) yields 0×0 rect.
    rev.classList.remove('hidden');
    layoutReviewHandles();
    try {
      requestAnimationFrame(function () {
        if (state.review) layoutReviewHandles();
      });
    } catch (e) { }
    state.busy = false;
  }

  function ensureReviewDom() {
    if (document.getElementById('doc-scan-review')) return;
    var root = document.getElementById('ui-modals-root') || document.body;
    var wrap = document.createElement('div');
    wrap.id = 'doc-scan-review';
    wrap.className = 'hidden';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Xem lại ảnh giấy tờ');

    var stage = document.createElement('div');
    stage.className = 'cp-review-stage';
    var canvas = document.createElement('canvas');
    canvas.id = 'cp-review-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    var corners = document.createElement('div');
    corners.className = 'cp-review-corners';
    corners.id = 'cp-review-corners';
    stage.appendChild(canvas);
    stage.appendChild(corners);

    var actions = document.createElement('div');
    actions.className = 'cp-review-actions';
    function mkBtn(action, label, primary) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-docscan-action', action);
      b.textContent = label;
      if (primary) b.className = 'cp-primary';
      return b;
    }
    actions.appendChild(mkBtn('retake', 'Chụp lại'));
    actions.appendChild(mkBtn('rotate', 'Xoay 90°'));
    actions.appendChild(mkBtn('cancel', 'Đóng'));
    actions.appendChild(mkBtn('save', 'Lưu', true));

    wrap.appendChild(stage);
    wrap.appendChild(actions);
    root.appendChild(wrap);
    wrap.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-docscan-action]');
      if (!btn) return;
      var act = btn.getAttribute('data-docscan-action');
      if (act === 'retake') retake();
      else if (act === 'rotate') rotateReview();
      else if (act === 'cancel') { cleanupAll(); }
      else if (act === 'save') saveReview();
    });
  }

  function layoutReviewHandles() {
    var box = document.getElementById('cp-review-corners');
    var canvas = document.getElementById('cp-review-canvas');
    var stage = box && box.parentElement;
    if (!box || !canvas || !state.review) return;
    while (box.firstChild) box.removeChild(box.firstChild);
    var rect = stage.getBoundingClientRect();
    var cw = canvas.width, ch = canvas.height;
    var scale = Math.min(rect.width / cw, rect.height / ch);
    var dispW = cw * scale, dispH = ch * scale;
    var offX = (rect.width - dispW) / 2, offY = (rect.height - dispH) / 2;
    canvas.style.width = dispW + 'px';
    canvas.style.height = dispH + 'px';
    state.review._layout = { scale: scale, offX: offX, offY: offY, dispW: dispW, dispH: dispH };

    state.review.corners.forEach(function (p, idx) {
      var h = document.createElement('button');
      h.type = 'button';
      h.className = 'cp-review-handle';
      h.setAttribute('aria-label', 'Góc ' + (idx + 1));
      h.style.left = (offX + p.x * scale) + 'px';
      h.style.top = (offY + p.y * scale) + 'px';
      bindHandleDrag(h, idx);
      box.appendChild(h);
    });
  }

  function bindHandleDrag(el, idx) {
    var dragging = false;
    function move(clientX, clientY) {
      if (!state.review || !state.review._layout) return;
      var stage = document.getElementById('cp-review-corners').parentElement.getBoundingClientRect();
      var L = state.review._layout;
      var x = (clientX - stage.left - L.offX) / L.scale;
      var y = (clientY - stage.top - L.offY) / L.scale;
      x = Geom.clamp(x, 0, state.review.imageData.width - 1);
      y = Geom.clamp(y, 0, state.review.imageData.height - 1);
      state.review.corners[idx] = { x: x, y: y };
      el.style.left = (L.offX + x * L.scale) + 'px';
      el.style.top = (L.offY + y * L.scale) + 'px';
    }
    el.addEventListener('pointerdown', function (ev) {
      dragging = true;
      el.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    el.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      move(ev.clientX, ev.clientY);
    });
    el.addEventListener('pointerup', function () { dragging = false; });
    el.addEventListener('pointercancel', function () { dragging = false; });
  }

  function rotateReview() {
    if (!state.review) return;
    var src = state.review.imageData;
    var w = src.width, h = src.height;
    var out = new Uint8ClampedArray(w * h * 4);
    // 90° CW
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var si = (y * w + x) * 4;
        var dx = h - 1 - y, dy = x;
        var di = (dy * h + dx) * 4;
        out[di] = src.data[si]; out[di + 1] = src.data[si + 1]; out[di + 2] = src.data[si + 2]; out[di + 3] = 255;
      }
    }
    var corners = state.review.corners.map(function (p) {
      return { x: h - 1 - p.y, y: p.x };
    });
    state.review.imageData = { width: h, height: w, data: out };
    state.review.corners = Geom.orderCorners(corners) || corners;
    var canvas = document.getElementById('cp-review-canvas');
    canvas.width = h; canvas.height = w;
    canvas.getContext('2d').putImageData(new ImageData(out, h, w), 0, 0);
    layoutReviewHandles();
  }

  async function retake() {
    closeReview();
    state.busy = false;
    var mode = state.snapshot && state.snapshot.captureMode;
    var seq = ++state.seq;
    try {
      await openSession(mode, seq);
    } catch (e) {
      try {
        var fallback = document.getElementById(mode === 'profile' ? 'native-camera-profile' : 'native-camera-asset');
        if (fallback) fallback.click();
      } catch (err) { }
    }
  }

  async function saveReview() {
    if (!state.review) return;
    if (typeof isAppUnlocked === 'function' && !isAppUnlocked()) {
      cleanupAll();
      return;
    }
    state.busy = true;
    try {
      var warped = Geom.warpPerspective(state.review.imageData, state.review.corners, 2400);
      if (!warped) throw new Error('WARP_FAILED');
      var enhanced = Enhance.enhanceDocument(warped);
      var dataUrl = imageDataToJpegDataUrl(enhanced, 0.94);
      var snap = state.snapshot || {};
      closeReview();
      cleanupAll();
      await saveImageToDB(dataUrl, {
        customerId: snap.customerId,
        assetId: snap.assetId,
        captureMode: snap.captureMode,
        compressionProfile: 'document',
      });
    } catch (e) {
      try { ErrorHandler.showError('CAMERA', 'Không xử lý được ảnh giấy tờ.', e); } catch (err) { }
      state.busy = false;
    }
  }

  async function capturePhotoMode() {
    // Legacy full-frame capture path — same session gates as captureDocument.
    if (state.busy || !state.active) return;
    if (typeof isAppUnlocked === 'function' && !isAppUnlocked()) {
      cleanupAll();
      return;
    }
    var captureSeq = state.seq;
    state.busy = true;
    try {
      var bitmap = await takeHighResBitmap();
      // Auto-lock / pagehide / close may have run cleanupAll() during takePhoto:
      // do not rebuild a plaintext frame or show save/error UI behind the lock.
      if (captureSeq !== state.seq || !state.active) {
        try { bitmap && bitmap.close && bitmap.close(); } catch (e) { }
        if (captureSeq === state.seq) state.busy = false;
        return;
      }
      if (typeof isAppUnlocked === 'function' && !isAppUnlocked()) {
        try { bitmap && bitmap.close && bitmap.close(); } catch (e) { }
        cleanupAll();
        return;
      }
      var pack = bitmapToImageData(bitmap);
      try { bitmap.close && bitmap.close(); } catch (e) { }
      if (captureSeq !== state.seq || !state.active) {
        if (captureSeq === state.seq) state.busy = false;
        return;
      }
      var dataUrl = pack.canvas.toDataURL('image/jpeg', 1.0);
      var snap = state.snapshot || {};
      cleanupAll();
      await saveImageToDB(dataUrl, {
        customerId: snap.customerId,
        assetId: snap.assetId,
        captureMode: snap.captureMode,
      });
    } catch (e) {
      cleanupAll();
      try { ErrorHandler.showError('CAMERA', undefined, e); } catch (err) { }
    }
  }

  function onShutter() {
    if (state.mode === 'document') captureDocument({ auto: false });
    else capturePhotoMode();
  }

  // Public API
  window.DocumentScanner = {
    open: openSession,
    close: cleanupAll,
    toggleMode: toggleMode,
    capture: onShutter,
    isActive: function () { return state.active; },
    getMode: function () { return state.mode; },
  };

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') cleanupAll();
  });
  window.addEventListener('pagehide', function () { cleanupAll(); });
  document.addEventListener('clientpro:locked', function () { cleanupAll(); });
})();

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = (() => {
  try { return require('canvas'); } catch { return {}; }
})();

const ROOT = path.resolve(__dirname, '..');
const Geom = require(path.join(ROOT, 'assets/document-scanner/document-geometry.js'));
const Enhance = require(path.join(ROOT, 'assets/document-scanner/document-image-enhance.js'));

test('DocumentGeometry: orderCorners TL-TR-BR-BL', () => {
  const pts = [
    { x: 10, y: 80 },
    { x: 90, y: 10 },
    { x: 20, y: 10 },
    { x: 80, y: 90 },
  ];
  const o = Geom.orderCorners(pts);
  assert.ok(o);
  assert.equal(o[0].x, 20);
  assert.equal(o[0].y, 10);
  assert.equal(o[1].x, 90);
  assert.equal(o[1].y, 10);
  assert.ok(o[2].y >= o[0].y);
  assert.ok(o[3].y >= o[0].y);
});

test('DocumentGeometry: scoreQuad accepts clear rectangle, rejects tiny', () => {
  const good = [
    { x: 80, y: 60 },
    { x: 560, y: 60 },
    { x: 560, y: 420 },
    { x: 80, y: 420 },
  ];
  const scored = Geom.scoreQuad(good, 640, 480);
  assert.ok(scored);
  assert.ok(scored.score > 0.4);
  assert.equal(scored.edgeTouch, false);

  const tiny = [
    { x: 300, y: 220 },
    { x: 340, y: 220 },
    { x: 340, y: 260 },
    { x: 300, y: 260 },
  ];
  assert.equal(Geom.scoreQuad(tiny, 640, 480), null);
});

test('DocumentGeometry: expandQuad adds outward margin and clamps', () => {
  const q = [
    { x: 100, y: 100 },
    { x: 500, y: 100 },
    { x: 500, y: 400 },
    { x: 100, y: 400 },
  ];
  const ex = Geom.expandQuad(q, 640, 480, 0.01);
  assert.ok(ex[0].x < q[0].x);
  assert.ok(ex[0].y < q[0].y);
  assert.ok(ex[2].x > q[2].x);
  const edge = Geom.expandQuad([
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
  ], 200, 200, 0.5);
  assert.equal(edge[0].x, 0);
  assert.equal(edge[0].y, 0);
});

test('DocumentGeometry: cornerDrift and scaleCorners', () => {
  const a = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const b = [{ x: 1, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const d = Geom.cornerDrift(a, b, 100, 100);
  assert.ok(d < 0.02);
  const scaled = Geom.scaleCorners(a, 100, 100, 200, 200);
  assert.equal(scaled[2].x, 200);
  assert.equal(scaled[2].y, 200);
});

test('DocumentGeometry: warpPerspective produces flat rectangle', () => {
  const w = 40, h = 30;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inside = x >= 5 && x <= 34 && y >= 5 && y <= 24;
      data[i] = data[i + 1] = data[i + 2] = inside ? 20 : 220;
      data[i + 3] = 255;
    }
  }
  const corners = [
    { x: 5, y: 5 }, { x: 34, y: 5 }, { x: 34, y: 24 }, { x: 5, y: 24 },
  ];
  const out = Geom.warpPerspective({ width: w, height: h, data }, corners, 200);
  assert.ok(out);
  assert.ok(out.width >= 20);
  assert.ok(out.height >= 10);
  // Center pixel should be dark (document)
  const cx = Math.floor(out.width / 2), cy = Math.floor(out.height / 2);
  const g = out.data[(cy * out.width + cx) * 4];
  assert.ok(g < 80, 'warped center should be dark');
});

test('DocumentImageEnhance: sharpness and lighting on solid vs edgey', () => {
  const blank = { width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4) };
  for (let i = 0; i < blank.data.length; i += 4) {
    blank.data[i] = blank.data[i + 1] = blank.data[i + 2] = 180;
    blank.data[i + 3] = 255;
  }
  const sharpBlank = Enhance.sharpnessScore(blank);
  const edgey = { width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4) };
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      const v = ((x + y) % 2) ? 0 : 255;
      edgey.data[i] = edgey.data[i + 1] = edgey.data[i + 2] = v;
      edgey.data[i + 3] = 255;
    }
  }
  assert.ok(Enhance.sharpnessScore(edgey) > sharpBlank);
  const light = Enhance.lightingStats(blank);
  assert.ok(light.mean > 100);
  assert.equal(light.tooDark, false);
});

test('DocumentImageEnhance: enhanceDocument returns same size, no throw', () => {
  const w = 24, h = 24;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 60; data[i + 1] = 70; data[i + 2] = 90; data[i + 3] = 255;
  }
  const out = Enhance.enhanceDocument({ width: w, height: h, data });
  assert.equal(out.width, w);
  assert.equal(out.height, h);
  assert.equal(out.data.length, data.length);
});

test('fixtures: synthetic document PNGs exist and are valid', () => {
  const dir = path.join(ROOT, 'tests/fixtures/documents');
  for (const name of [
    'doc-quad-light.png',
    'doc-quad-dark.png',
    'doc-quad-tilted.png',
    'doc-partial-edge.png',
    'doc-low-contrast.png',
    'blank.png',
  ]) {
    const buf = fs.readFileSync(path.join(dir, name));
    assert.equal(buf[0], 0x89);
    assert.equal(buf[1], 0x50);
    assert.equal(buf[2], 0x4e);
    assert.equal(buf[3], 0x47);
  }
});

// Optional canvas-based detector smoke when node-canvas is present.
test('detector smoke on fixture (optional canvas)', async (t) => {
  if (!createCanvas || !loadImage) {
    t.skip('node-canvas not installed');
    return;
  }
  const img = await loadImage(path.join(ROOT, 'tests/fixtures/documents/doc-quad-light.png'));
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, img.width, img.height);
  // Inline a minimal detect using geometry score on known quad (fixture geometry)
  const known = [
    { x: 80, y: 60 }, { x: 560, y: 60 }, { x: 560, y: 420 }, { x: 80, y: 420 },
  ];
  const scored = Geom.scoreQuad(known, img.width, img.height);
  assert.ok(scored);
  assert.ok(imageData.data.length > 0);
});

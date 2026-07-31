'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(ROOT, 'tests/fixtures/documents');
const Detector = require(path.join(ROOT, 'assets/document-scanner/document-detector.worker.js'));

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Minimal PNG decoder for deterministic 8-bit, non-interlaced fixtures. */
function decodePng(filePath) {
  const input = fs.readFileSync(filePath);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(input.subarray(0, 8).equals(signature), `${path.basename(filePath)}: invalid PNG signature`);

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = -1;
  const idat = [];

  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset);
    const type = input.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    assert.ok(dataEnd + 4 <= input.length, `${path.basename(filePath)}: truncated ${type}`);
    const data = input.subarray(dataStart, dataEnd);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  assert.ok(width > 0 && height > 0, `${path.basename(filePath)}: missing IHDR`);
  assert.equal(bitDepth, 8, `${path.basename(filePath)}: fixtures must be 8-bit`);
  assert.equal(interlace, 0, `${path.basename(filePath)}: fixtures must be non-interlaced`);

  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 })[colorType];
  assert.ok(channels, `${path.basename(filePath)}: unsupported PNG color type ${colorType}`);

  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  assert.equal(inflated.length, height * (stride + 1), `${path.basename(filePath)}: unexpected scanline length`);

  const raw = Buffer.alloc(height * stride);
  let source = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[source++];
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const byte = inflated[source++];
      const left = x >= channels ? raw[rowStart + x - channels] : 0;
      const up = y > 0 ? raw[prevStart + x] : 0;
      const upLeft = (y > 0 && x >= channels) ? raw[prevStart + x - channels] : 0;
      let value;
      if (filter === 0) value = byte;
      else if (filter === 1) value = (byte + left) & 255;
      else if (filter === 2) value = (byte + up) & 255;
      else if (filter === 3) value = (byte + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) value = (byte + paeth(left, up, upLeft)) & 255;
      else assert.fail(`${path.basename(filePath)}: unsupported PNG filter ${filter}`);
      raw[rowStart + x] = value;
    }
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const src = pixel * channels;
    const dst = pixel * 4;
    if (colorType === 6) {
      rgba[dst] = raw[src];
      rgba[dst + 1] = raw[src + 1];
      rgba[dst + 2] = raw[src + 2];
      rgba[dst + 3] = raw[src + 3];
    } else if (colorType === 2) {
      rgba[dst] = raw[src];
      rgba[dst + 1] = raw[src + 1];
      rgba[dst + 2] = raw[src + 2];
      rgba[dst + 3] = 255;
    } else if (colorType === 4) {
      rgba[dst] = raw[src];
      rgba[dst + 1] = raw[src];
      rgba[dst + 2] = raw[src];
      rgba[dst + 3] = raw[src + 1];
    } else {
      rgba[dst] = raw[src];
      rgba[dst + 1] = raw[src];
      rgba[dst + 2] = raw[src];
      rgba[dst + 3] = 255;
    }
  }

  return { width, height, data: rgba };
}

function fixture(name) {
  return decodePng(path.join(FIXTURES, name));
}

function pointInConvexQuad(x, y, corners) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (Math.abs(cross) < 1e-6) continue;
    const current = cross > 0 ? 1 : -1;
    if (!sign) sign = current;
    else if (sign !== current) return false;
  }
  return true;
}

function setRgb(image, x, y, value, tint = 0) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const i = (Math.round(y) * image.width + Math.round(x)) * 4;
  image.data[i] = Math.max(0, Math.min(255, value + tint));
  image.data[i + 1] = Math.max(0, Math.min(255, value));
  image.data[i + 2] = Math.max(0, Math.min(255, value - tint));
  image.data[i + 3] = 255;
}

function paintQuad(image, corners, value, tint = 0, gradient = 0) {
  const minX = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x))));
  const maxX = Math.min(image.width - 1, Math.ceil(Math.max(...corners.map((p) => p.x))));
  const minY = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y))));
  const maxY = Math.min(image.height - 1, Math.ceil(Math.max(...corners.map((p) => p.y))));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!pointInConvexQuad(x + 0.5, y + 0.5, corners)) continue;
      const shade = gradient * ((x - minX) / Math.max(1, maxX - minX) - 0.5);
      setRgb(image, x, y, value + shade, tint);
    }
  }
}

function drawLine(image, from, to, value, width = 1, tint = 0) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y)));
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    for (let oy = -width; oy <= width; oy++) {
      for (let ox = -width; ox <= width; ox++) {
        if (ox * ox + oy * oy <= width * width) setRgb(image, x + ox, y + oy, value, tint);
      }
    }
  }
}

function quadPoint(corners, u, v) {
  const top = {
    x: corners[0].x + (corners[1].x - corners[0].x) * u,
    y: corners[0].y + (corners[1].y - corners[0].y) * u,
  };
  const bottom = {
    x: corners[3].x + (corners[2].x - corners[3].x) * u,
    y: corners[3].y + (corners[2].y - corners[3].y) * u,
  };
  return {
    x: top.x + (bottom.x - top.x) * v,
    y: top.y + (bottom.y - top.y) * v,
  };
}

function syntheticScene({
  width = 640,
  height = 480,
  corners,
  background = 92,
  paper = 218,
  noise = 12,
  shadow = true,
  connector = false,
  tint = 4,
}) {
  const image = {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const texture =
        (((x * 17 + y * 31 + ((x * y) % 29)) % (noise * 2 + 1)) - noise) +
        Math.sin(x * 0.07 + y * 0.011) * noise * 0.35;
      const lighting = 18 * (x / width) + 9 * (y / height);
      setRgb(image, x, y, background + texture + lighting, tint);
    }
  }
  if (shadow) {
    paintQuad(
      image,
      corners.map((p) => ({ x: p.x + 11, y: p.y + 13 })),
      Math.max(20, background - 28),
      tint,
      6
    );
  }
  paintQuad(image, corners, paper, 0, -14);

  // Projected text/table lines exercise the common failure mode where internal
  // high-contrast rectangles compete with the softer outer paper boundary.
  for (let row = 0; row < 12; row++) {
    const v = 0.14 + row * 0.055;
    const right = row % 4 === 0 ? 0.72 : 0.86;
    drawLine(image, quadPoint(corners, 0.13, v), quadPoint(corners, right, v), 66, 1);
  }
  for (const u of [0.12, 0.5, 0.88]) {
    drawLine(image, quadPoint(corners, u, 0.78), quadPoint(corners, u, 0.91), 88, 1);
  }
  drawLine(image, quadPoint(corners, 0.12, 0.78), quadPoint(corners, 0.88, 0.78), 88, 1);
  drawLine(image, quadPoint(corners, 0.12, 0.91), quadPoint(corners, 0.88, 0.91), 88, 1);

  if (connector) {
    // A desk seam touching the page used to merge with its edge and replace
    // the top-left crop corner with a point on the camera frame.
    drawLine(image, { x: 0, y: 28 }, corners[0], background - 24, 2, tint);
  }
  return image;
}

function maxCornerError(result, expected) {
  assert.ok(result, 'detector returned no quadrilateral');
  assert.equal(result.corners.length, 4);
  return Math.max(...result.corners.map((corner, index) => (
    Math.hypot(corner.x - expected[index].x, corner.y - expected[index].y)
  )));
}

test('production detector finds every well-lit synthetic document fixture', () => {
  const names = [
    'doc-quad-light.png',
    'doc-quad-dark.png',
    'doc-quad-tilted.png',
  ];
  let accepted = 0;
  for (const name of names) {
    const image = fixture(name);
    const result = Detector.detectQuad(image);
    assert.ok(result, `${name}: detector returned no quadrilateral`);
    assert.equal(result.edgeTouch, false, `${name}: accepted document must not touch frame edge`);
    assert.ok(result.areaRatio >= 0.22, `${name}: detected area is too small`);
    assert.equal(result.corners.length, 4, `${name}: expected exactly four ordered corners`);
    accepted++;
  }
  assert.ok(accepted / names.length >= 0.95, 'well-lit fixture auto-detect must be >=95%');
});

test('production detector does not false-auto-capture blank or edge-touch fixtures', () => {
  const blank = Detector.detectQuad(fixture('blank.png'));
  assert.equal(blank, null, 'blank fixture must not produce a document');

  const partial = Detector.detectQuad(fixture('doc-partial-edge.png'));
  assert.ok(!partial || partial.edgeTouch, 'edge-touch fixture may be outlined but must never be auto-accepted');

  const falseAccepts = [blank, partial].filter((result) => result && !result.edgeTouch).length;
  assert.equal(falseAccepts, 0, 'negative fixture false auto-capture rate must be 0%');
});

test('low-contrast fixture is processed by the real detector without guessed crop', () => {
  const image = fixture('doc-low-contrast.png');
  const result = Detector.detectQuad(image);
  if (result) {
    assert.equal(result.corners.length, 4);
    assert.ok(result.areaRatio > 0);
  }
  // A null result is a valid manual-corner fallback. The important invariant is
  // that production detectQuad ran and did not substitute preview coordinates.
  assert.ok(result === null || typeof result.score === 'number');
});

test('production detector keeps crop corners accurate with texture, shadow, text and a connected desk seam', () => {
  const corners = [
    { x: 118, y: 66 },
    { x: 532, y: 91 },
    { x: 562, y: 407 },
    { x: 86, y: 389 },
  ];
  const image = syntheticScene({ corners, connector: true, noise: 15 });
  const result = Detector.detectQuad(image);
  assert.equal(result.edgeTouch, false);
  assert.ok(result.score >= 0.62, `unexpected confidence ${result.score}`);
  assert.ok(maxCornerError(result, corners) <= 10, JSON.stringify(result.corners));
});

test('production detector finds a narrow receipt instead of its internal table', () => {
  const corners = [
    { x: 228, y: 42 },
    { x: 416, y: 58 },
    { x: 402, y: 447 },
    { x: 207, y: 431 },
  ];
  const image = syntheticScene({
    corners,
    background: 70,
    paper: 225,
    noise: 18,
    shadow: true,
  });
  const result = Detector.detectQuad(image);
  assert.equal(result.edgeTouch, false);
  assert.ok(result.areaRatio >= 0.20);
  assert.ok(maxCornerError(result, corners) <= 10, JSON.stringify(result.corners));
});

test('production detector treats a clipped sheet as guidance-only', () => {
  const corners = [
    { x: 3, y: 28 },
    { x: 632, y: 35 },
    { x: 636, y: 451 },
    { x: 2, y: 445 },
  ];
  const image = syntheticScene({ corners, background: 42, paper: 205, noise: 8, shadow: false });
  const result = Detector.detectQuad(image);
  assert.ok(!result || result.edgeTouch, 'clipped page must never be auto-capture eligible');
});

test('connected-component extraction is bounded on a dense edge plane', () => {
  const width = 704;
  const height = 528;
  const dense = new Uint8Array(width * height);
  dense.fill(255);
  const components = Detector.findComponents(dense, width, height);
  assert.equal(components.length, 1);
  assert.ok(components[0].points.length <= height * 2);
});

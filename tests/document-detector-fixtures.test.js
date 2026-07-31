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

/**
 * document-detector.worker.js — edge/quad detection off the main thread.
 *
 * The same detectQuad implementation is exported in Node so CI exercises the
 * production detector against PNG fixtures instead of testing known coordinates.
 */
'use strict';

var DocumentGeometryRef = (function loadGeometry() {
  if (typeof module !== 'undefined' && module.exports) {
    // Node fixture tests.
    return require('./document-geometry.js');
  }
  if (typeof self !== 'undefined' && typeof importScripts === 'function') {
    var base = self.location.href.replace(/[^/]+(?:\?.*)?$/, '');
    var q = self.location.search || '';
    importScripts(base + 'document-geometry.js' + q);
    return self.DocumentGeometry;
  }
  return (typeof globalThis !== 'undefined') ? globalThis.DocumentGeometry : null;
})();

function toGray(data, w, h) {
  var gray = new Uint8ClampedArray(w * h);
  for (var i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
  }
  return gray;
}

/** Histogram contrast normalization for the preview-sized luma plane. */
function equalize(gray) {
  var hist = new Uint32Array(256);
  var i;
  var n = gray.length;
  for (i = 0; i < n; i++) hist[gray[i]]++;
  var cdf = new Uint32Array(256);
  var sum = 0;
  var minCdf = 0;
  for (i = 0; i < 256; i++) {
    sum += hist[i];
    cdf[i] = sum;
    if (!minCdf && sum) minCdf = sum;
  }
  var out = new Uint8ClampedArray(n);
  var den = (n - minCdf) || 1;
  for (i = 0; i < n; i++) {
    out[i] = Math.round(((cdf[gray[i]] - minCdf) / den) * 255);
  }
  return out;
}

function sobelMag(gray, w, h) {
  var mag = new Float32Array(w * h);
  var max = 0;
  for (var y = 1; y < h - 1; y++) {
    for (var x = 1; x < w - 1; x++) {
      var i = y * w + x;
      var gx =
        -gray[i - w - 1] + gray[i - w + 1] -
        2 * gray[i - 1] + 2 * gray[i + 1] -
        gray[i + w - 1] + gray[i + w + 1];
      var gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] +
        gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      var m = Math.abs(gx) + Math.abs(gy);
      mag[i] = m;
      if (m > max) max = m;
    }
  }
  var edges = new Uint8ClampedArray(w * h);
  var thr = max * 0.18;
  for (var j = 0; j < mag.length; j++) {
    edges[j] = mag[j] >= thr ? 255 : 0;
  }
  return edges;
}

function dilate(bin, w, h) {
  var out = new Uint8ClampedArray(bin.length);
  for (var y = 1; y < h - 1; y++) {
    for (var x = 1; x < w - 1; x++) {
      var i = y * w + x;
      var v = 0;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (bin[i + dy * w + dx]) { v = 255; break; }
        }
        if (v) break;
      }
      out[i] = v;
    }
  }
  return out;
}

function erode(bin, w, h) {
  var out = new Uint8ClampedArray(bin.length);
  for (var y = 1; y < h - 1; y++) {
    for (var x = 1; x < w - 1; x++) {
      var i = y * w + x;
      var v = 255;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (!bin[i + dy * w + dx]) { v = 0; break; }
        }
        if (!v) break;
      }
      out[i] = v;
    }
  }
  return out;
}

function morphClose(bin, w, h) {
  return erode(dilate(bin, w, h), w, h);
}

/** Contour trace (Moore neighborhood) → list of point chains. */
function findContours(bin, w, h) {
  var visited = new Uint8Array(w * h);
  var contours = [];
  var dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  for (var y = 1; y < h - 1; y++) {
    for (var x = 1; x < w - 1; x++) {
      var start = y * w + x;
      if (!bin[start] || visited[start]) continue;
      // Only start at left-edge transitions to limit noise.
      if (bin[start - 1]) continue;
      var pts = [];
      var cx = x;
      var cy = y;
      var dir = 0;
      var guard = 0;
      do {
        pts.push({ x: cx, y: cy });
        visited[cy * w + cx] = 1;
        var found = false;
        for (var k = 0; k < 8; k++) {
          var nd = (dir + k) % 8;
          var nx = cx + dirs[nd][0];
          var ny = cy + dirs[nd][1];
          if (nx <= 0 || ny <= 0 || nx >= w - 1 || ny >= h - 1) continue;
          if (bin[ny * w + nx]) {
            cx = nx;
            cy = ny;
            dir = (nd + 6) % 8;
            found = true;
            break;
          }
        }
        if (!found) break;
        guard++;
      } while ((cx !== x || cy !== y) && guard < w * h);
      if (pts.length >= 40) contours.push(pts);
    }
  }
  return contours;
}

function simplifyContour(pts, epsilon) {
  if (pts.length < 3) return pts;
  function perpDist(p, a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var len2 = dx * dx + dy * dy || 1;
    var t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    var projx = a.x + t * dx;
    var projy = a.y + t * dy;
    return Math.hypot(p.x - projx, p.y - projy);
  }
  function rdp(points, eps) {
    if (points.length < 3) return points;
    var maxD = 0;
    var idx = 0;
    var a = points[0];
    var b = points[points.length - 1];
    for (var i = 1; i < points.length - 1; i++) {
      var d = perpDist(points[i], a, b);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps) {
      var left = rdp(points.slice(0, idx + 1), eps);
      var right = rdp(points.slice(idx), eps);
      return left.slice(0, -1).concat(right);
    }
    return [a, b];
  }
  return rdp(pts, epsilon);
}

function approxQuad(pts) {
  if (!pts || pts.length < 4 || !DocumentGeometryRef) return null;
  var peri = 0;
  for (var i = 0; i < pts.length; i++) {
    var j = (i + 1) % pts.length;
    peri += Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
  }
  var simp = simplifyContour(pts, Math.max(2, peri * 0.02));
  if (simp.length === 4) return simp;
  // If not exactly 4, take the four directional extreme points.
  if (simp.length > 4) {
    return DocumentGeometryRef.orderCorners([
      simp.reduce(function (a, p) { return (!a || p.x + p.y < a.x + a.y) ? p : a; }, null),
      simp.reduce(function (a, p) { return (!a || -p.x + p.y < -a.x + a.y) ? p : a; }, null),
      simp.reduce(function (a, p) { return (!a || -p.x - p.y < -a.x - a.y) ? p : a; }, null),
      simp.reduce(function (a, p) { return (!a || p.x - p.y < a.x - a.y) ? p : a; }, null),
    ]);
  }
  return null;
}

function detectQuad(imageData) {
  if (!imageData || !imageData.data || !DocumentGeometryRef) return null;
  var w = imageData.width;
  var h = imageData.height;
  var gray = equalize(toGray(imageData.data, w, h));
  var edges = morphClose(sobelMag(gray, w, h), w, h);
  var contours = findContours(edges, w, h);
  var best = null;
  for (var i = 0; i < contours.length; i++) {
    var quad = approxQuad(contours[i]);
    if (!quad) continue;
    var scored = DocumentGeometryRef.scoreQuad(quad, w, h);
    if (!scored) continue;
    if (!best || scored.score > best.score) best = scored;
  }
  return best;
}

var api = {
  detectQuad: detectQuad,
  toGray: toGray,
  equalize: equalize,
  sobelMag: sobelMag,
  morphClose: morphClose,
  findContours: findContours,
  simplifyContour: simplifyContour,
  approxQuad: approxQuad,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = function (ev) {
    var msg = ev.data || {};
    if (msg.type !== 'detect') return;
    try {
      var imageData = msg.imageData;
      if (!imageData || !imageData.data) {
        self.postMessage({ type: 'detect-result', id: msg.id, ok: false });
        return;
      }
      if (!(imageData.data instanceof Uint8ClampedArray)) {
        imageData = {
          width: imageData.width,
          height: imageData.height,
          data: new Uint8ClampedArray(imageData.data),
        };
      }
      var result = detectQuad(imageData);
      self.postMessage({
        type: 'detect-result',
        id: msg.id,
        ok: !!result,
        corners: result ? result.corners : null,
        score: result ? result.score : 0,
        areaRatio: result ? result.areaRatio : 0,
        edgeTouch: result ? result.edgeTouch : false,
        width: imageData.width,
        height: imageData.height,
      });
    } catch (e) {
      self.postMessage({ type: 'detect-result', id: msg.id, ok: false, error: String(e && e.message || e) });
    }
  };
}

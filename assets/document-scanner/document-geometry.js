/**
 * document-geometry.js — pure helpers for document quad detection / warp.
 * No DOM. Safe for Worker and Node unit tests.
 */
(function (root) {
  'use strict';

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function dist(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Order corners TL → TR → BR → BL. */
  function orderCorners(pts) {
    if (!pts || pts.length !== 4) return null;
    var sorted = pts.slice().sort(function (a, b) { return a.y - b.y; });
    var top = sorted.slice(0, 2).sort(function (a, b) { return a.x - b.x; });
    var bot = sorted.slice(2, 4).sort(function (a, b) { return a.x - b.x; });
    return [top[0], top[1], bot[1], bot[0]];
  }

  function polygonArea(pts) {
    var a = 0;
    for (var i = 0; i < pts.length; i++) {
      var j = (i + 1) % pts.length;
      a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return Math.abs(a) / 2;
  }

  function isConvexQuad(pts) {
    if (!pts || pts.length !== 4) return false;
    var sign = 0;
    for (var i = 0; i < 4; i++) {
      var a = pts[i], b = pts[(i + 1) % 4], c = pts[(i + 2) % 4];
      var cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (cross === 0) continue;
      var s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (sign !== s) return false;
    }
    return sign !== 0;
  }

  function angleAt(a, b, c) {
    var abx = a.x - b.x, aby = a.y - b.y;
    var cbx = c.x - b.x, cby = c.y - b.y;
    var den = Math.sqrt(abx * abx + aby * aby) * Math.sqrt(cbx * cbx + cby * cby);
    if (den < 1e-6) return 0;
    var cos = clamp((abx * cbx + aby * cby) / den, -1, 1);
    return Math.acos(cos);
  }

  /**
   * Score a candidate quadrilateral in image space.
   * Higher is better. Returns null if rejected.
   */
  function scoreQuad(pts, imgW, imgH) {
    var ordered = orderCorners(pts);
    if (!ordered || !isConvexQuad(ordered)) return null;
    var area = polygonArea(ordered);
    var frame = imgW * imgH;
    if (frame <= 0) return null;
    var areaRatio = area / frame;
    if (areaRatio < 0.12 || areaRatio > 0.92) return null;

    var rectScore = 0;
    for (var i = 0; i < 4; i++) {
      var ang = angleAt(ordered[i], ordered[(i + 1) % 4], ordered[(i + 2) % 4]);
      rectScore += 1 - Math.abs(ang - Math.PI / 2) / (Math.PI / 2);
    }
    rectScore /= 4;
    if (rectScore < 0.35) return null;

    var margin = 0;
    var edgeTouch = false;
    var pad = Math.max(2, Math.min(imgW, imgH) * 0.01);
    for (var k = 0; k < 4; k++) {
      var p = ordered[k];
      if (p.x <= pad || p.y <= pad || p.x >= imgW - pad || p.y >= imgH - pad) edgeTouch = true;
      margin += Math.min(p.x, p.y, imgW - p.x, imgH - p.y);
    }
    margin /= 4;

    var score = areaRatio * 0.45 + rectScore * 0.45 + clamp(margin / (Math.min(imgW, imgH) * 0.1), 0, 1) * 0.1;
    return { corners: ordered, score: score, areaRatio: areaRatio, edgeTouch: edgeTouch };
  }

  /** Expand quad outward by ratio (e.g. 0.01) then clamp to image bounds. */
  function expandQuad(corners, imgW, imgH, ratio) {
    var cx = 0, cy = 0, i;
    for (i = 0; i < 4; i++) { cx += corners[i].x; cy += corners[i].y; }
    cx /= 4; cy /= 4;
    var out = [];
    for (i = 0; i < 4; i++) {
      var dx = corners[i].x - cx, dy = corners[i].y - cy;
      out.push({
        x: clamp(cx + dx * (1 + ratio), 0, imgW - 1),
        y: clamp(cy + dy * (1 + ratio), 0, imgH - 1),
      });
    }
    return out;
  }

  /** Max corner drift as fraction of min(imgW, imgH). */
  function cornerDrift(a, b, imgW, imgH) {
    if (!a || !b || a.length !== 4 || b.length !== 4) return 1;
    var scale = Math.min(imgW, imgH) || 1;
    var max = 0;
    for (var i = 0; i < 4; i++) {
      max = Math.max(max, dist(a[i], b[i]) / scale);
    }
    return max;
  }

  /**
   * Solve 8x8 for perspective matrix mapping src quad → dst rectangle.
   * Returns 3x3 row-major homography (h33 = 1).
   */
  function getPerspectiveTransform(src, dst) {
    // dst defaults to axis-aligned rect sized by side lengths
    if (!dst) {
      var w = Math.max(dist(src[0], src[1]), dist(src[3], src[2]));
      var h = Math.max(dist(src[0], src[3]), dist(src[1], src[2]));
      dst = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
    }
    var A = [];
    var b = [];
    for (var i = 0; i < 4; i++) {
      var x = src[i].x, y = src[i].y, u = dst[i].x, v = dst[i].y;
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
      b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
      b.push(v);
    }
    var h = solveLinear8(A, b);
    if (!h) return null;
    h.push(1);
    return { matrix: h, width: dist(dst[0], dst[1]), height: dist(dst[0], dst[3]) };
  }

  function solveLinear8(A, b) {
    // Gaussian elimination with partial pivoting
    var n = 8;
    var M = [];
    var i, j, k;
    for (i = 0; i < n; i++) {
      M[i] = A[i].slice();
      M[i].push(b[i]);
    }
    for (i = 0; i < n; i++) {
      var piv = i;
      for (k = i + 1; k < n; k++) {
        if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
      }
      if (Math.abs(M[piv][i]) < 1e-10) return null;
      var tmp = M[i]; M[i] = M[piv]; M[piv] = tmp;
      var div = M[i][i];
      for (j = i; j <= n; j++) M[i][j] /= div;
      for (k = 0; k < n; k++) {
        if (k === i) continue;
        var f = M[k][i];
        for (j = i; j <= n; j++) M[k][j] -= f * M[i][j];
      }
    }
    var x = [];
    for (i = 0; i < n; i++) x[i] = M[i][n];
    return x;
  }

  function applyHomography(h, x, y) {
    var X = h[0] * x + h[1] * y + h[2];
    var Y = h[3] * x + h[4] * y + h[5];
    var W = h[6] * x + h[7] * y + h[8];
    if (Math.abs(W) < 1e-9) return { x: x, y: y };
    return { x: X / W, y: Y / W };
  }

  /** Inverse map for sampling: dst → src using inverse of h. */
  function invertHomography(h) {
    var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7], i = h[8];
    var A = e * i - f * hh, B = c * hh - b * i, C = b * f - c * e;
    var D = f * g - d * i, E = a * i - c * g, F = c * d - a * f;
    var G = d * hh - e * g, H = b * g - a * hh, I = a * e - b * d;
    var det = a * A + b * D + c * G;
    if (Math.abs(det) < 1e-12) return null;
    return [A / det, B / det, C / det, D / det, E / det, F / det, G / det, H / det, I / det];
  }

  /**
   * Warp RGBA ImageData from src corners to a flat rectangle.
   * Returns { width, height, data: Uint8ClampedArray }.
   */
  function warpPerspective(imageData, corners, maxSide) {
    var ordered = orderCorners(corners);
    if (!ordered) return null;
    var w0 = dist(ordered[0], ordered[1]);
    var w1 = dist(ordered[3], ordered[2]);
    var h0 = dist(ordered[0], ordered[3]);
    var h1 = dist(ordered[1], ordered[2]);
    var outW = Math.max(w0, w1);
    var outH = Math.max(h0, h1);
    var cap = maxSide || 2400;
    var scale = Math.min(1, cap / Math.max(outW, outH));
    outW = Math.max(32, Math.round(outW * scale));
    outH = Math.max(32, Math.round(outH * scale));
    var dst = [
      { x: 0, y: 0 },
      { x: outW - 1, y: 0 },
      { x: outW - 1, y: outH - 1 },
      { x: 0, y: outH - 1 },
    ];
    var xf = getPerspectiveTransform(ordered, dst);
    if (!xf) return null;
    var inv = invertHomography(xf.matrix);
    if (!inv) return null;
    var sw = imageData.width, sh = imageData.height;
    var src = imageData.data;
    var out = new Uint8ClampedArray(outW * outH * 4);
    for (var y = 0; y < outH; y++) {
      for (var x = 0; x < outW; x++) {
        var p = applyHomography(inv, x, y);
        var sx = p.x, sy = p.y;
        var o = (y * outW + x) * 4;
        if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) {
          out[o] = out[o + 1] = out[o + 2] = 255;
          out[o + 3] = 255;
          continue;
        }
        var x0 = Math.floor(sx), y0 = Math.floor(sy);
        var dx = sx - x0, dy = sy - y0;
        var i00 = (y0 * sw + x0) * 4;
        var i10 = i00 + 4;
        var i01 = i00 + sw * 4;
        var i11 = i01 + 4;
        for (var c = 0; c < 3; c++) {
          var v =
            src[i00 + c] * (1 - dx) * (1 - dy) +
            src[i10 + c] * dx * (1 - dy) +
            src[i01 + c] * (1 - dx) * dy +
            src[i11 + c] * dx * dy;
          out[o + c] = v | 0;
        }
        out[o + 3] = 255;
      }
    }
    return { width: outW, height: outH, data: out };
  }

  /** Scale corners from one resolution to another. */
  function scaleCorners(corners, fromW, fromH, toW, toH) {
    if (!corners) return null;
    var sx = toW / fromW, sy = toH / fromH;
    return corners.map(function (p) {
      return { x: p.x * sx, y: p.y * sy };
    });
  }

  var api = {
    clamp: clamp,
    dist: dist,
    orderCorners: orderCorners,
    polygonArea: polygonArea,
    isConvexQuad: isConvexQuad,
    scoreQuad: scoreQuad,
    expandQuad: expandQuad,
    cornerDrift: cornerDrift,
    getPerspectiveTransform: getPerspectiveTransform,
    invertHomography: invertHomography,
    applyHomography: applyHomography,
    warpPerspective: warpPerspective,
    scaleCorners: scaleCorners,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.DocumentGeometry = api;
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : globalThis);

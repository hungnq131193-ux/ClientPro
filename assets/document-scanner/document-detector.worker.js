/**
 * document-detector.worker.js — bounded, multi-pass document quad detection.
 *
 * The detector deliberately stays dependency-free: loading OpenCV.js for one
 * feature would add several megabytes to the offline shell and a large WASM/JS
 * heap on mid-range phones. The pipeline mirrors the proven classical CV shape
 * (blur → Canny-style edges → connected contours → polygon approximation), then
 * refines every side against the source gradient before returning crop corners.
 *
 * The same detectQuad implementation is exported in Node so CI exercises the
 * production detector against deterministic fixtures.
 */
'use strict';

var DocumentGeometryRef = (function loadGeometry() {
  if (typeof module !== 'undefined' && module.exports) {
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

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function toGray(data, w, h) {
  var gray = new Uint8ClampedArray(w * h);
  for (var i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
  }
  return gray;
}

/** Histogram equalization used only as a low-contrast fallback pass. */
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

/** Separable 3×3 Gaussian blur ([1 2 1]²), with clamped borders. */
function gaussianBlur(gray, w, h) {
  var tmp = new Uint16Array(gray.length);
  var out = new Uint8ClampedArray(gray.length);
  var x;
  var y;
  for (y = 0; y < h; y++) {
    var row = y * w;
    for (x = 0; x < w; x++) {
      var xl = x > 0 ? x - 1 : 0;
      var xr = x + 1 < w ? x + 1 : w - 1;
      tmp[row + x] = gray[row + xl] + 2 * gray[row + x] + gray[row + xr];
    }
  }
  for (y = 0; y < h; y++) {
    var yu = y > 0 ? y - 1 : 0;
    var yd = y + 1 < h ? y + 1 : h - 1;
    for (x = 0; x < w; x++) {
      out[y * w + x] = (
        tmp[yu * w + x] + 2 * tmp[y * w + x] + tmp[yd * w + x]
      ) >> 4;
    }
  }
  return out;
}

/**
 * Sobel gradient plus inexpensive non-maximum suppression.
 * Magnitudes are L1 (0..2040), which is sufficient for threshold ordering.
 */
function gradientField(gray, w, h) {
  var gx = new Int16Array(w * h);
  var gy = new Int16Array(w * h);
  var mag = new Uint16Array(w * h);
  var nms = new Uint16Array(w * h);
  var max = 0;
  var x;
  var y;
  var i;

  for (y = 1; y < h - 1; y++) {
    for (x = 1; x < w - 1; x++) {
      i = y * w + x;
      var dx =
        -gray[i - w - 1] + gray[i - w + 1] -
        2 * gray[i - 1] + 2 * gray[i + 1] -
        gray[i + w - 1] + gray[i + w + 1];
      var dy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] +
        gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      var m = Math.abs(dx) + Math.abs(dy);
      gx[i] = dx;
      gy[i] = dy;
      mag[i] = m;
      if (m > max) max = m;
    }
  }

  var hist = new Uint32Array(2041);
  var count = 0;
  for (y = 1; y < h - 1; y++) {
    for (x = 1; x < w - 1; x++) {
      i = y * w + x;
      var current = mag[i];
      if (!current) continue;
      var ax = Math.abs(gx[i]);
      var ay = Math.abs(gy[i]);
      var a;
      var b;
      if (ay * 5 <= ax * 2) {
        a = mag[i - 1];
        b = mag[i + 1];
      } else if (ax * 5 <= ay * 2) {
        a = mag[i - w];
        b = mag[i + w];
      } else if (gx[i] * gy[i] > 0) {
        a = mag[i - w - 1];
        b = mag[i + w + 1];
      } else {
        a = mag[i - w + 1];
        b = mag[i + w - 1];
      }
      if (current >= a && current >= b) {
        nms[i] = current;
        hist[Math.min(2040, current)]++;
        count++;
      }
    }
  }

  return {
    gray: gray,
    gx: gx,
    gy: gy,
    mag: mag,
    nms: nms,
    hist: hist,
    count: count,
    max: max,
  };
}

function histogramQuantile(hist, count, q) {
  if (!count) return 0;
  var target = Math.max(1, Math.round(count * q));
  var seen = 0;
  for (var i = 0; i < hist.length; i++) {
    seen += hist[i];
    if (seen >= target) return i;
  }
  return hist.length - 1;
}

/** Canny-style dual threshold and 8-neighbour hysteresis. */
function hysteresisEdges(field, w, h, quantile) {
  if (!field || !field.count || field.max < 10) {
    return { edges: new Uint8Array(w * h), high: 0, low: 0 };
  }
  // A percentile alone collapses on wood grain/textured desks because most
  // local maxima are tiny. Keep a fraction of the strongest source edge so the
  // desk does not become one giant connected "contour".
  var high = Math.max(
    16,
    histogramQuantile(field.hist, field.count, quantile),
    Math.round(field.max * 0.10)
  );
  high = Math.min(high, field.max);
  var low = Math.max(6, Math.round(high * 0.38));
  var state = new Uint8Array(w * h);
  var stack = new Int32Array(w * h);
  var top = 0;
  var i;

  for (i = 0; i < field.nms.length; i++) {
    var m = field.nms[i];
    if (m >= high) {
      state[i] = 2;
      stack[top++] = i;
    } else if (m >= low) {
      state[i] = 1;
    }
  }

  var edges = new Uint8Array(w * h);
  while (top) {
    var idx = stack[--top];
    if (edges[idx]) continue;
    edges[idx] = 255;
    var y = (idx / w) | 0;
    var x = idx - y * w;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var nx = x + dx;
        var ny = y + dy;
        if (nx <= 0 || ny <= 0 || nx >= w - 1 || ny >= h - 1) continue;
        var ni = ny * w + nx;
        if (state[ni] && !edges[ni]) stack[top++] = ni;
      }
    }
  }
  return { edges: edges, high: high, low: low };
}

function dilate(bin, w, h) {
  var out = new Uint8Array(bin.length);
  for (var y = 1; y < h - 1; y++) {
    for (var x = 1; x < w - 1; x++) {
      var i = y * w + x;
      if (
        bin[i] || bin[i - 1] || bin[i + 1] || bin[i - w] || bin[i + w] ||
        bin[i - w - 1] || bin[i - w + 1] || bin[i + w - 1] || bin[i + w + 1]
      ) out[i] = 255;
    }
  }
  return out;
}

function erode(bin, w, h) {
  var out = new Uint8Array(bin.length);
  for (var y = 1; y < h - 1; y++) {
    for (var x = 1; x < w - 1; x++) {
      var i = y * w + x;
      if (
        bin[i] && bin[i - 1] && bin[i + 1] && bin[i - w] && bin[i + w] &&
        bin[i - w - 1] && bin[i - w + 1] && bin[i + w - 1] && bin[i + w + 1]
      ) out[i] = 255;
    }
  }
  return out;
}

/**
 * Close small breaks and leave one pixel of dilation. This makes the four paper
 * sides one component without the unbounded contour walk used by the old code.
 */
function morphClose(bin, w, h) {
  return erode(dilate(dilate(bin, w, h), w, h), w, h);
}

/**
 * Linear-time connected components. Each pixel is enqueued at most once.
 *
 * Only the left/right extreme per touched row is retained; those points preserve
 * the component's convex hull while bounding polygon work to at most 2×height.
 */
function findComponents(bin, w, h) {
  var visited = new Uint8Array(bin.length);
  var queue = new Int32Array(bin.length);
  var rowMin = new Int32Array(h);
  var rowMax = new Int32Array(h);
  var rowStamp = new Int32Array(h);
  var stamp = 0;
  var components = [];
  var minPixels = Math.max(36, Math.round(Math.min(w, h) * 0.16));
  var frame = w * h;

  for (var start = 0; start < bin.length; start++) {
    if (!bin[start] || visited[start]) continue;
    stamp++;
    var head = 0;
    var tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    var count = 0;
    var minX = w;
    var minY = h;
    var maxX = 0;
    var maxY = 0;
    var touchedRows = [];

    while (head < tail) {
      var idx = queue[head++];
      var y = (idx / w) | 0;
      var x = idx - y * w;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (rowStamp[y] !== stamp) {
        rowStamp[y] = stamp;
        rowMin[y] = x;
        rowMax[y] = x;
        touchedRows.push(y);
      } else {
        if (x < rowMin[y]) rowMin[y] = x;
        if (x > rowMax[y]) rowMax[y] = x;
      }

      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          var nx = x + dx;
          var ny = y + dy;
          if (nx <= 0 || ny <= 0 || nx >= w - 1 || ny >= h - 1) continue;
          var ni = ny * w + nx;
          if (bin[ni] && !visited[ni]) {
            visited[ni] = 1;
            queue[tail++] = ni;
          }
        }
      }
    }

    var bw = maxX - minX + 1;
    var bh = maxY - minY + 1;
    var bboxArea = bw * bh;
    if (
      count < minPixels ||
      bw < w * 0.12 ||
      bh < h * 0.12 ||
      bboxArea < frame * 0.055
    ) continue;

    touchedRows.sort(function (a, b) { return a - b; });
    var points = [];
    for (var r = 0; r < touchedRows.length; r++) {
      var ry = touchedRows[r];
      points.push({ x: rowMin[ry], y: ry });
      if (rowMax[ry] !== rowMin[ry]) points.push({ x: rowMax[ry], y: ry });
    }
    components.push({
      points: points,
      count: count,
      bboxArea: bboxArea,
      bounds: { minX: minX, minY: minY, maxX: maxX, maxY: maxY },
    });
  }

  components.sort(function (a, b) { return b.bboxArea - a.bboxArea; });
  if (components.length > 24) components.length = 24;
  return components;
}

/** Backwards-compatible name for Node diagnostics. */
function findContours(bin, w, h) {
  return findComponents(bin, w, h).map(function (component) {
    return component.points;
  });
}

function otsuThreshold(gray) {
  var hist = new Uint32Array(256);
  var sum = 0;
  for (var i = 0; i < gray.length; i++) {
    hist[gray[i]]++;
    sum += gray[i];
  }
  var total = gray.length || 1;
  var backgroundWeight = 0;
  var backgroundSum = 0;
  var bestVariance = -1;
  var best = 127;
  for (var value = 0; value < 256; value++) {
    backgroundWeight += hist[value];
    if (!backgroundWeight) continue;
    var foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += value * hist[value];
    var backgroundMean = backgroundSum / backgroundWeight;
    var foregroundMean = (sum - backgroundSum) / foregroundWeight;
    var delta = backgroundMean - foregroundMean;
    var variance = backgroundWeight * foregroundWeight * delta * delta;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = value;
    }
  }
  return best;
}

function thresholdMask(gray, threshold, bright) {
  var out = new Uint8Array(gray.length);
  for (var i = 0; i < gray.length; i++) {
    if (bright ? gray[i] >= threshold : gray[i] <= threshold) out[i] = 255;
  }
  return out;
}

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function convexHull(points) {
  if (!points || points.length < 4) return points ? points.slice() : [];
  var sorted = points.slice().sort(function (a, b) {
    return a.x === b.x ? a.y - b.y : a.x - b.x;
  });
  var unique = [];
  for (var i = 0; i < sorted.length; i++) {
    if (!i || sorted[i].x !== sorted[i - 1].x || sorted[i].y !== sorted[i - 1].y) {
      unique.push(sorted[i]);
    }
  }
  if (unique.length < 4) return unique;
  var lower = [];
  for (i = 0; i < unique.length; i++) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], unique[i]) <= 0) {
      lower.pop();
    }
    lower.push(unique[i]);
  }
  var upper = [];
  for (i = unique.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], unique[i]) <= 0) {
      upper.pop();
    }
    upper.push(unique[i]);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function pointLineDistance(p, a, b) {
  var dx = b.x - a.x;
  var dy = b.y - a.y;
  var len2 = dx * dx + dy * dy || 1;
  var t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  var px = a.x + t * dx;
  var py = a.y + t * dy;
  return Math.hypot(p.x - px, p.y - py);
}

function simplifyContour(points, epsilon) {
  if (!points || points.length < 3) return points ? points.slice() : [];
  var maxD = 0;
  var idx = 0;
  var first = points[0];
  var last = points[points.length - 1];
  for (var i = 1; i < points.length - 1; i++) {
    var d = pointLineDistance(points[i], first, last);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > epsilon) {
    var left = simplifyContour(points.slice(0, idx + 1), epsilon);
    var right = simplifyContour(points.slice(idx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

/** RDP for a closed convex ring, split across its left/right extremes. */
function simplifyClosedHull(hull, epsilon) {
  if (!hull || hull.length <= 4) return hull ? hull.slice() : [];
  var left = 0;
  var right = 0;
  for (var i = 1; i < hull.length; i++) {
    if (hull[i].x < hull[left].x || (hull[i].x === hull[left].x && hull[i].y < hull[left].y)) left = i;
    if (hull[i].x > hull[right].x || (hull[i].x === hull[right].x && hull[i].y > hull[right].y)) right = i;
  }
  function ringPath(from, to) {
    var out = [hull[from]];
    var at = from;
    while (at !== to) {
      at = (at + 1) % hull.length;
      out.push(hull[at]);
    }
    return out;
  }
  var a = simplifyContour(ringPath(left, right), epsilon);
  var b = simplifyContour(ringPath(right, left), epsilon);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

function quadKey(corners) {
  var ordered = DocumentGeometryRef.orderCorners(corners);
  if (!ordered) return '';
  return ordered.map(function (p) {
    return Math.round(p.x / 3) + ':' + Math.round(p.y / 3);
  }).join('|');
}

function addQuad(out, seen, corners) {
  var ordered = DocumentGeometryRef.orderCorners(corners);
  if (!ordered) return;
  var key = quadKey(ordered);
  if (!key || seen[key]) return;
  seen[key] = true;
  out.push(ordered);
}

function enumerateFour(vertices, hullArea, out, seen) {
  var n = vertices.length;
  if (n < 4 || n > 9) return;
  for (var a = 0; a < n - 3; a++) {
    for (var b = a + 1; b < n - 2; b++) {
      for (var c = b + 1; c < n - 1; c++) {
        for (var d = c + 1; d < n; d++) {
          var q = [vertices[a], vertices[b], vertices[c], vertices[d]];
          var area = DocumentGeometryRef.polygonArea(q);
          if (hullArea && area / hullArea < 0.72) continue;
          addQuad(out, seen, q);
        }
      }
    }
  }
}

function directionalQuad(points) {
  if (!points || points.length < 4) return null;
  var tl = null;
  var tr = null;
  var br = null;
  var bl = null;
  for (var i = 0; i < points.length; i++) {
    var p = points[i];
    if (!tl || p.x + p.y < tl.x + tl.y) tl = p;
    if (!br || p.x + p.y > br.x + br.y) br = p;
    if (!tr || p.x - p.y > tr.x - tr.y) tr = p;
    if (!bl || p.x - p.y < bl.x - bl.y) bl = p;
  }
  var q = [tl, tr, br, bl];
  for (i = 0; i < 4; i++) {
    for (var j = i + 1; j < 4; j++) {
      if (q[i].x === q[j].x && q[i].y === q[j].y) return null;
    }
  }
  return q;
}

function componentQuads(component) {
  var hull = convexHull(component.points);
  if (!hull || hull.length < 4) return { hull: hull, quads: [] };
  var hullArea = DocumentGeometryRef.polygonArea(hull);
  var perimeter = 0;
  for (var i = 0; i < hull.length; i++) {
    perimeter += Math.hypot(
      hull[i].x - hull[(i + 1) % hull.length].x,
      hull[i].y - hull[(i + 1) % hull.length].y
    );
  }
  var out = [];
  var seen = Object.create(null);
  var epsRatios = [0.006, 0.01, 0.016, 0.024, 0.036, 0.052];
  for (i = 0; i < epsRatios.length; i++) {
    var simp = simplifyClosedHull(hull, Math.max(1.5, perimeter * epsRatios[i]));
    if (simp.length === 4) addQuad(out, seen, simp);
    else if (simp.length >= 5 && simp.length <= 9) enumerateFour(simp, hullArea, out, seen);
  }
  var extreme = directionalQuad(hull);
  if (extreme) addQuad(out, seen, extreme);
  return { hull: hull, hullArea: hullArea, quads: out };
}

/** Compatibility helper: approximate one contour to its strongest quad. */
function approxQuad(points) {
  if (!points || points.length < 4 || !DocumentGeometryRef) return null;
  var result = componentQuads({ points: points });
  var best = null;
  for (var i = 0; i < result.quads.length; i++) {
    var area = DocumentGeometryRef.polygonArea(result.quads[i]);
    if (!best || area > best.area) best = { area: area, corners: result.quads[i] };
  }
  return best ? best.corners : null;
}

function fitSide(a, b, field, w, h) {
  var dx = b.x - a.x;
  var dy = b.y - a.y;
  var len = Math.hypot(dx, dy);
  if (len < 12) return null;
  var ux = dx / len;
  var uy = dy / len;
  var nx = -uy;
  var ny = ux;
  var radius = clamp(Math.round(Math.min(w, h) * 0.018), 4, 12);
  var samples = clamp(Math.round(len / 5), 18, 140);
  var points = [];

  for (var s = 1; s < samples - 1; s++) {
    var t = s / (samples - 1);
    var cx = a.x + dx * t;
    var cy = a.y + dy * t;
    var best = null;
    for (var off = -radius; off <= radius; off++) {
      var x = Math.round(cx + nx * off);
      var y = Math.round(cy + ny * off);
      if (x <= 1 || y <= 1 || x >= w - 2 || y >= h - 2) continue;
      var idx = y * w + x;
      var m = field.mag[idx];
      if (!m) continue;
      var gradLen = Math.hypot(field.gx[idx], field.gy[idx]) || 1;
      var alignment = Math.abs((field.gx[idx] * nx + field.gy[idx] * ny) / gradLen);
      if (alignment < 0.32) continue;
      var value = m * (0.35 + 0.65 * alignment) - Math.abs(off) * field.high * 0.018;
      if (!best || value > best.value) {
        best = { x: x, y: y, value: value, weight: Math.max(1, m * alignment * alignment) };
      }
    }
    if (best && best.value >= field.high * 0.28) points.push(best);
  }

  if (points.length < Math.max(7, Math.round(samples * 0.28))) return null;
  var sumW = 0;
  var mx = 0;
  var my = 0;
  for (var i = 0; i < points.length; i++) {
    var weight = Math.min(points[i].weight, field.high * 5);
    sumW += weight;
    mx += points[i].x * weight;
    my += points[i].y * weight;
  }
  if (!sumW) return null;
  mx /= sumW;
  my /= sumW;
  var sxx = 0;
  var syy = 0;
  var sxy = 0;
  for (i = 0; i < points.length; i++) {
    weight = Math.min(points[i].weight, field.high * 5);
    var px = points[i].x - mx;
    var py = points[i].y - my;
    sxx += weight * px * px;
    syy += weight * py * py;
    sxy += weight * px * py;
  }
  var angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  var lx = Math.cos(angle);
  var ly = Math.sin(angle);
  var alignmentWithSide = Math.abs(lx * ux + ly * uy);
  if (alignmentWithSide < 0.88) return null;
  if (lx * ux + ly * uy < 0) {
    lx = -lx;
    ly = -ly;
  }
  return { x: mx, y: my, dx: lx, dy: ly };
}

function intersectLines(a, b) {
  var den = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(den) < 1e-5) return null;
  var qx = b.x - a.x;
  var qy = b.y - a.y;
  var t = (qx * b.dy - qy * b.dx) / den;
  return { x: a.x + t * a.dx, y: a.y + t * a.dy };
}

/** Fit four boundary lines and intersect them for sub-contour corner accuracy. */
function refineQuad(corners, field, w, h) {
  var ordered = DocumentGeometryRef.orderCorners(corners);
  if (!ordered) return null;
  var lines = [];
  for (var i = 0; i < 4; i++) {
    var line = fitSide(ordered[i], ordered[(i + 1) % 4], field, w, h);
    if (!line) return ordered;
    lines.push(line);
  }
  var refined = [
    intersectLines(lines[3], lines[0]),
    intersectLines(lines[0], lines[1]),
    intersectLines(lines[1], lines[2]),
    intersectLines(lines[2], lines[3]),
  ];
  if (refined.some(function (p) { return !p || !Number.isFinite(p.x) || !Number.isFinite(p.y); })) return ordered;
  refined = DocumentGeometryRef.orderCorners(refined);
  if (!refined) return ordered;
  var maxDrift = Math.min(w, h) * 0.085;
  for (i = 0; i < 4; i++) {
    if (
      refined[i].x < -2 || refined[i].y < -2 ||
      refined[i].x > w + 1 || refined[i].y > h + 1 ||
      Math.hypot(refined[i].x - ordered[i].x, refined[i].y - ordered[i].y) > maxDrift
    ) return ordered;
  }
  var before = DocumentGeometryRef.polygonArea(ordered) || 1;
  var after = DocumentGeometryRef.polygonArea(refined);
  if (after / before < 0.72 || after / before > 1.32) return ordered;
  return refined;
}

function sampleGray(gray, w, h, x, y) {
  x = clamp(Math.round(x), 0, w - 1);
  y = clamp(Math.round(y), 0, h - 1);
  return gray[y * w + x];
}

/**
 * Measure whether every proposed side is actually supported by a similarly
 * oriented source-image gradient, plus inside/outside boundary contrast.
 */
function edgeEvidence(corners, field, gray, w, h) {
  var sideScores = [];
  var sideSupports = [];
  var search = clamp(Math.round(Math.min(w, h) * 0.009), 3, 7);
  var contrastOffset = search + 2;

  for (var side = 0; side < 4; side++) {
    var a = corners[side];
    var b = corners[(side + 1) % 4];
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var len = Math.hypot(dx, dy);
    if (len < 12) return null;
    var nx = -dy / len;
    var ny = dx / len;
    var samples = clamp(Math.round(len / 5), 16, 120);
    var supported = 0;
    var strength = 0;
    var contrast = 0;
    var used = 0;

    for (var s = 1; s < samples - 1; s++) {
      var t = s / (samples - 1);
      var cx = a.x + dx * t;
      var cy = a.y + dy * t;
      var bestM = 0;
      var bestAlign = 0;
      for (var off = -search; off <= search; off++) {
        var x = Math.round(cx + nx * off);
        var y = Math.round(cy + ny * off);
        if (x <= 1 || y <= 1 || x >= w - 2 || y >= h - 2) continue;
        var idx = y * w + x;
        var m = field.mag[idx];
        if (!m) continue;
        var gradLen = Math.hypot(field.gx[idx], field.gy[idx]) || 1;
        var align = Math.abs((field.gx[idx] * nx + field.gy[idx] * ny) / gradLen);
        if (m * align > bestM * bestAlign) {
          bestM = m;
          bestAlign = align;
        }
      }
      if (bestM >= field.high * 0.42 && bestAlign >= 0.28) supported++;
      strength += clamp((bestM * bestAlign) / (field.high * 1.6 || 1), 0, 1);
      var inside = sampleGray(gray, w, h, cx + nx * contrastOffset, cy + ny * contrastOffset);
      var outside = sampleGray(gray, w, h, cx - nx * contrastOffset, cy - ny * contrastOffset);
      contrast += Math.abs(inside - outside);
      used++;
    }
    if (!used) return null;
    var supportRatio = supported / used;
    var strengthRatio = strength / used;
    var contrastRatio = clamp((contrast / used) / 42, 0, 1);
    sideSupports.push(supportRatio);
    sideScores.push(supportRatio * 0.55 + strengthRatio * 0.30 + contrastRatio * 0.15);
  }

  var minSide = Math.min.apply(Math, sideScores);
  var avg = sideScores.reduce(function (sum, value) { return sum + value; }, 0) / 4;
  var avgSupport = sideSupports.reduce(function (sum, value) { return sum + value; }, 0) / 4;
  return {
    score: avg * 0.68 + minSide * 0.32,
    minSide: minSide,
    avgSupport: avgSupport,
  };
}

function scoreCandidate(corners, field, gray, w, h, hullArea) {
  var refined = refineQuad(corners, field, w, h);
  var scored = DocumentGeometryRef.scoreQuad(refined, w, h);
  if (!scored) return null;
  var evidence = edgeEvidence(scored.corners, field, gray, w, h);
  if (!evidence || evidence.minSide < 0.16 || evidence.avgSupport < 0.27) return null;
  var coverage = hullArea
    ? clamp(DocumentGeometryRef.polygonArea(scored.corners) / hullArea, 0, 1)
    : 1;
  var confidence = scored.score * 0.48 + evidence.score * 0.42 + coverage * 0.10;
  if (scored.edgeTouch) confidence -= 0.035;
  return {
    corners: scored.corners,
    score: confidence,
    geometryScore: scored.score,
    edgeScore: evidence.score,
    areaRatio: scored.areaRatio,
    edgeTouch: scored.edgeTouch,
  };
}

function isBetterResult(candidate, current) {
  if (!candidate) return false;
  if (!current) return true;
  if (candidate.edgeTouch !== current.edgeTouch) {
    if (candidate.edgeTouch) return false;
    // Prefer a complete interior page unless it is materially weaker than a
    // strong frame-touch outline (often an internal table/panel on a clipped
    // sheet). Frame-touch is still guidance-only at the capture layer.
    return candidate.score + 0.10 >= current.score;
  }
  return candidate.score > current.score;
}

function detectWithField(field, gray, w, h, quantile, currentBest) {
  var thresholded = hysteresisEdges(field, w, h, quantile);
  if (!thresholded.high) return currentBest;
  var workField = {
    gray: field.gray,
    gx: field.gx,
    gy: field.gy,
    mag: field.mag,
    high: thresholded.high,
    low: thresholded.low,
  };
  var closed = morphClose(thresholded.edges, w, h);
  var components = findComponents(closed, w, h);
  var best = currentBest;

  for (var i = 0; i < components.length; i++) {
    var candidates = componentQuads(components[i]);
    for (var j = 0; j < candidates.quads.length; j++) {
      var result = scoreCandidate(
        candidates.quads[j],
        workField,
        gray,
        w,
        h,
        candidates.hullArea
      );
      if (isBetterResult(result, best)) best = result;
    }
  }
  return best;
}

/**
 * Region fallback for a paper edge joined to desk grain. Edge components can
 * contain an outlier branch whose convex hull replaces a real corner. Otsu
 * bright/dark regions isolate the page body and then pass through the same
 * gradient refinement/evidence gate; no guessed rectangle is accepted.
 */
function detectWithRegionMask(mask, field, gray, w, h, currentBest) {
  var thresholded = hysteresisEdges(field, w, h, 0.82);
  if (!thresholded.high) return currentBest;
  var workField = {
    gray: field.gray,
    gx: field.gx,
    gy: field.gy,
    mag: field.mag,
    high: thresholded.high,
    low: thresholded.low,
  };
  // Close one-pixel pinholes without expanding the region boundary.
  var cleaned = erode(dilate(mask, w, h), w, h);
  var components = findComponents(cleaned, w, h);
  var best = currentBest;
  for (var i = 0; i < components.length; i++) {
    var candidates = componentQuads(components[i]);
    for (var j = 0; j < candidates.quads.length; j++) {
      var result = scoreCandidate(
        candidates.quads[j],
        workField,
        gray,
        w,
        h,
        candidates.hullArea
      );
      if (isBetterResult(result, best)) best = result;
    }
  }
  return best;
}

function detectQuad(imageData) {
  if (!imageData || !imageData.data || !DocumentGeometryRef) return null;
  var w = imageData.width | 0;
  var h = imageData.height | 0;
  if (w < 32 || h < 32 || imageData.data.length < w * h * 4) return null;

  var gray = toGray(imageData.data, w, h);
  var blurred = gaussianBlur(gray, w, h);
  var field = gradientField(blurred, w, h);
  var best = null;

  // High threshold avoids text/texture; the second pass reconnects soft paper edges.
  best = detectWithField(field, blurred, w, h, 0.86, best);
  best = detectWithField(field, blurred, w, h, 0.76, best);

  // The bright-region pass is cheap insurance against a drop shadow becoming
  // the crop boundary; most field documents are lighter than their surface.
  var otsu = otsuThreshold(blurred);
  best = detectWithRegionMask(
    thresholdMask(blurred, otsu, true),
    field,
    blurred,
    w,
    h,
    best
  );
  if (!best || best.edgeTouch || best.score < 0.72) {
    best = detectWithRegionMask(
      thresholdMask(blurred, otsu, false),
      field,
      blurred,
      w,
      h,
      best
    );
  }

  // Only pay for equalization when the ordinary passes are not confidently done.
  if (!best || best.score < 0.70) {
    var equalized = gaussianBlur(equalize(gray), w, h);
    var equalizedField = gradientField(equalized, w, h);
    best = detectWithField(equalizedField, equalized, w, h, 0.84, best);
  }

  return best;
}

var api = {
  detectQuad: detectQuad,
  toGray: toGray,
  equalize: equalize,
  gaussianBlur: gaussianBlur,
  gradientField: gradientField,
  hysteresisEdges: hysteresisEdges,
  morphClose: morphClose,
  findComponents: findComponents,
  findContours: findContours,
  otsuThreshold: otsuThreshold,
  thresholdMask: thresholdMask,
  convexHull: convexHull,
  simplifyContour: simplifyContour,
  simplifyClosedHull: simplifyClosedHull,
  approxQuad: approxQuad,
  refineQuad: refineQuad,
  edgeEvidence: edgeEvidence,
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
        geometryScore: result ? result.geometryScore : 0,
        edgeScore: result ? result.edgeScore : 0,
        areaRatio: result ? result.areaRatio : 0,
        edgeTouch: result ? result.edgeTouch : false,
        width: imageData.width,
        height: imageData.height,
      });
    } catch (e) {
      self.postMessage({
        type: 'detect-result',
        id: msg.id,
        ok: false,
        error: String(e && e.message || e),
      });
    }
  };
}

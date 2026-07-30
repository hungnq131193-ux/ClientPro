/**
 * document-image-enhance.js — light enhance for document scans (no B&W threshold).
 * Pure ImageData in/out. Safe for Worker and Node tests.
 */
(function (root) {
  'use strict';

  function grayAt(data, i) {
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  /** Laplacian variance sharpness proxy on a downscaled luma plane. */
  function sharpnessScore(imageData) {
    var w = imageData.width, h = imageData.height, data = imageData.data;
    var step = Math.max(1, Math.floor(Math.min(w, h) / 160));
    var sw = Math.floor(w / step), sh = Math.floor(h / step);
    if (sw < 3 || sh < 3) return 0;
    var gray = new Float32Array(sw * sh);
    var y, x, sx, sy, i;
    for (y = 0; y < sh; y++) {
      for (x = 0; x < sw; x++) {
        sx = Math.min(w - 1, x * step);
        sy = Math.min(h - 1, y * step);
        i = (sy * w + sx) * 4;
        gray[y * sw + x] = grayAt(data, i);
      }
    }
    var sum = 0, sum2 = 0, n = 0, lap;
    for (y = 1; y < sh - 1; y++) {
      for (x = 1; x < sw - 1; x++) {
        i = y * sw + x;
        lap = gray[i - sw] + gray[i + sw] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
        sum += lap;
        sum2 += lap * lap;
        n++;
      }
    }
    if (!n) return 0;
    var mean = sum / n;
    return (sum2 / n) - mean * mean;
  }

  /** Brightness / highlight / glare heuristics on document region. */
  function lightingStats(imageData) {
    var data = imageData.data, n = data.length / 4;
    var sum = 0, dark = 0, bright = 0, i, g;
    var step = Math.max(1, Math.floor(n / 8000));
    var count = 0;
    for (i = 0; i < data.length; i += 4 * step) {
      g = grayAt(data, i);
      sum += g;
      if (g < 40) dark++;
      if (g > 245) bright++;
      count++;
    }
    var mean = count ? sum / count : 0;
    return {
      mean: mean,
      darkRatio: count ? dark / count : 0,
      brightRatio: count ? bright / count : 0,
      tooDark: mean < 55 || (dark / count) > 0.45,
      tooBright: mean > 210 || (bright / count) > 0.25,
    };
  }

  function enhanceDocument(imageData) {
    var w = imageData.width, h = imageData.height;
    var src = imageData.data;
    var out = new Uint8ClampedArray(src.length);
    var i, r, g, b, y, gray, nr, ng, nb;

    // Gray-world white balance (light)
    var sumR = 0, sumG = 0, sumB = 0, n = w * h;
    for (i = 0; i < src.length; i += 4) {
      sumR += src[i]; sumG += src[i + 1]; sumB += src[i + 2];
    }
    var avgR = sumR / n, avgG = sumG / n, avgB = sumB / n;
    var avg = (avgR + avgG + avgB) / 3;
    var sR = avg / (avgR || 1), sG = avg / (avgG || 1), sB = avg / (avgB || 1);
    sR = 0.65 * sR + 0.35; sG = 0.65 * sG + 0.35; sB = 0.65 * sB + 0.35;

    // Pass 1: WB + mild local contrast via unsharp on luma
    var luma = new Float32Array(n);
    for (i = 0; i < n; i++) {
      r = Math.min(255, src[i * 4] * sR);
      g = Math.min(255, src[i * 4 + 1] * sG);
      b = Math.min(255, src[i * 4 + 2] * sB);
      out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 255;
      luma[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    // Box blur 3x3 for unsharp (bounded)
    var blur = new Float32Array(n);
    for (y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var idx = y * w + x;
        blur[idx] = (
          luma[idx - w - 1] + luma[idx - w] + luma[idx - w + 1] +
          luma[idx - 1] + luma[idx] + luma[idx + 1] +
          luma[idx + w - 1] + luma[idx + w] + luma[idx + w + 1]
        ) / 9;
      }
    }
    var amount = 0.35;
    for (i = 0; i < n; i++) {
      gray = luma[i];
      var sharp = gray + amount * (gray - (blur[i] || gray));
      var delta = sharp - gray;
      // mild denoise: shrink tiny deltas
      if (Math.abs(delta) < 1.5) delta = 0;
      nr = out[i * 4] + delta;
      ng = out[i * 4 + 1] + delta;
      nb = out[i * 4 + 2] + delta;
      // gentle contrast around mid
      nr = (nr - 128) * 1.06 + 128;
      ng = (ng - 128) * 1.06 + 128;
      nb = (nb - 128) * 1.06 + 128;
      out[i * 4] = Math.max(0, Math.min(255, nr));
      out[i * 4 + 1] = Math.max(0, Math.min(255, ng));
      out[i * 4 + 2] = Math.max(0, Math.min(255, nb));
    }
    return { width: w, height: h, data: out };
  }

  var api = {
    sharpnessScore: sharpnessScore,
    lightingStats: lightingStats,
    enhanceDocument: enhanceDocument,
    grayAt: grayAt,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DocumentImageEnhance = api;
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : globalThis);

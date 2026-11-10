/*!
 * Pattern analyzer for the Fluted Hero configurator.
 * Reads an image in the browser and returns Fluted Hero settings that resemble it:
 * rib layout, angle, spacing and rhythm, a six-color palette, and a small brightness map.
 * The image is never uploaded anywhere.
 */
(function (global) {
  'use strict';

  var W_ANALYSIS = 640, H_ANALYSIS = 360;   // the design is 16:9, so images are center-cropped to that
  var MAP_W = 48, MAP_H = 27;
  var STOPS = [0, 0.25, 0.5, 0.7, 0.86, 1];  // where each palette color sits on the Fluted Hero color ramp
  var DESIGN_W = 1920;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hex(r, g, b) {
    return '#' + [r, g, b].map(function (v) {
      v = Math.round(clamp(v, 0, 255));
      return (v < 16 ? '0' : '') + v.toString(16);
    }).join('').toUpperCase();
  }
  function roundTo(v, step) { return Math.round(v / step) * step; }

  /* ---------- colors and brightness map ---------- */
  function colorsAndLight(id) {
    var d = id.data, W = id.width, H = id.height, n = W * H;
    var lum = new Uint8Array(n), hist = new Float64Array(256), i;
    for (i = 0; i < n; i++) {
      var o = i * 4;
      lum[i] = Math.round(0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]);
      hist[lum[i]]++;
    }
    // Rank of each brightness level, 0..1. Using ranks keeps the map and the palette consistent.
    var cdf = new Float64Array(256), run = 0;
    for (i = 0; i < 256; i++) { cdf[i] = (run + hist[i] / 2) / n; run += hist[i]; }

    var totals = STOPS.map(function () { return [0, 0, 0, 0]; });
    var map = new Uint8Array(MAP_W * MAP_H), sum = new Float64Array(MAP_W * MAP_H), cnt = new Float64Array(MAP_W * MAP_H);
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var k = y * W + x, rank = cdf[lum[k]], p = k * 4;
        for (var s = 0; s < STOPS.length; s++) {
          if (Math.abs(rank - STOPS[s]) <= 0.05) {
            totals[s][0] += d[p]; totals[s][1] += d[p + 1]; totals[s][2] += d[p + 2]; totals[s][3]++;
          }
        }
        var c = Math.min(MAP_H - 1, Math.floor(y * MAP_H / H)) * MAP_W + Math.min(MAP_W - 1, Math.floor(x * MAP_W / W));
        sum[c] += rank; cnt[c]++;
      }
    }
    for (i = 0; i < map.length; i++) map[i] = Math.round(255 * (cnt[i] ? sum[i] / cnt[i] : 0));

    // A stop with no pixels near it (images with few distinct tones) borrows from its neighbor.
    var colors = new Array(STOPS.length), last = null;
    for (i = 0; i < STOPS.length; i++) {
      if (totals[i][3]) last = totals[i];
      colors[i] = last;
    }
    for (i = STOPS.length - 1; i >= 0; i--) {
      if (colors[i]) last = colors[i];
      else colors[i] = last;
    }
    colors = colors.map(function (t) {
      return t ? hex(t[0] / t[3], t[1] / t[3], t[2] / t[3]) : '#000000';
    });

    var bin = '';
    for (i = 0; i < map.length; i++) bin += String.fromCharCode(map[i]);
    return { colors: colors, lightMap: MAP_W + 'x' + MAP_H + ':' + btoa(bin) };
  }

  /* ---------- edges ---------- */
  function edgesOf(id) {
    var d = id.data, W = id.width, H = id.height, g = new Float32Array(W * H), i;
    for (i = 0; i < W * H; i++) g[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
    var xs = [], ys = [], c2s = [], s2s = [], ws = [];
    for (var y = 1; y < H - 1; y++) {
      for (var x = 1; x < W - 1; x++) {
        var k = y * W + x;
        var gx = g[k - W + 1] + 2 * g[k + 1] + g[k + W + 1] - g[k - W - 1] - 2 * g[k - 1] - g[k + W - 1];
        var gy = g[k + W - 1] + 2 * g[k + W] + g[k + W + 1] - g[k - W - 1] - 2 * g[k - W] - g[k - W + 1];
        var m2 = gx * gx + gy * gy;
        if (m2 < 576) continue;   // ignores smooth shading and compression noise
        xs.push(x); ys.push(y);
        c2s.push((gx * gx - gy * gy) / m2);
        s2s.push(2 * gx * gy / m2);
        ws.push(Math.sqrt(m2));
      }
    }
    return { gray: g, x: xs, y: ys, c2: c2s, s2: s2s, w: ws, count: xs.length };
  }

  function coherence(e) {
    var C = 0, S = 0, T = 0;
    for (var i = 0; i < e.count; i++) { C += e.w[i] * e.c2[i]; S += e.w[i] * e.s2[i]; T += e.w[i]; }
    return { value: T ? Math.sqrt(C * C + S * S) / T : 0, theta: 0.5 * Math.atan2(S, C) };
  }

  /* ---------- rings and rays: find the point the edges organize around ---------- */
  function radial(e, W, H) {
    var step = Math.max(1, Math.floor(e.count / 3000));
    function score(cx, cy) {
      var A = 0, T = 0;
      for (var i = 0; i < e.count; i += step) {
        var rx = e.x[i] - cx, ry = e.y[i] - cy, r2 = rx * rx + ry * ry;
        if (r2 < 16) continue;
        A += e.w[i] * (e.c2[i] * (rx * rx - ry * ry) / r2 + e.s2[i] * 2 * rx * ry / r2);
        T += e.w[i];
      }
      return T ? A / T : 0;
    }
    function search(sign) {
      var best = { s: -2, x: W / 2, y: H / 2 };
      var nx = 16, ny = 9, i, j, s;
      for (j = 0; j <= ny; j++) for (i = 0; i <= nx; i++) {
        s = sign * score(i * W / nx, j * H / ny);
        if (s > best.s) best = { s: s, x: i * W / nx, y: j * H / ny };
      }
      var span = W / nx;
      for (var round = 0; round < 3; round++) {
        var cx = best.x, cy = best.y;
        for (j = -2; j <= 2; j++) for (i = -2; i <= 2; i++) {
          s = sign * score(cx + i * span / 2, cy + j * span / 2);
          if (s > best.s) best = { s: s, x: cx + i * span / 2, y: cy + j * span / 2 };
        }
        span /= 3;
      }
      return best;
    }
    return { rings: search(1), rays: search(-1) };
  }

  /* ---------- wave and zigzag: does rib direction swing back and forth along the ribs? ---------- */
  function swing(e, W, H, theta) {
    var cs = Math.cos(theta), sn = Math.sin(theta);
    var N = 64, tx = -sn, ty = cs;
    var corners = [0, tx * W, ty * H, tx * W + ty * H];
    var lo = Math.min.apply(null, corners), hi = Math.max.apply(null, corners), L = Math.max(1, hi - lo);
    var C = new Float64Array(N), S = new Float64Array(N), i;
    var c2 = Math.cos(2 * theta), s2 = Math.sin(2 * theta);
    for (i = 0; i < e.count; i++) {
      var b = Math.min(N - 1, Math.floor(((e.x[i] * tx + e.y[i] * ty) - lo) / L * N));
      // edge orientation measured relative to theta
      C[b] += e.w[i] * (e.c2[i] * c2 + e.s2[i] * s2);
      S[b] += e.w[i] * (e.s2[i] * c2 - e.c2[i] * s2);
    }
    var slope = new Float64Array(N), mean = 0;
    for (i = 0; i < N; i++) {
      slope[i] = (C[i] || S[i]) ? clamp(Math.tan(0.5 * Math.atan2(S[i], C[i])), -3, 3) : 0;
      mean += slope[i] / N;
    }
    var energy = 0;
    for (i = 0; i < N; i++) { slope[i] -= mean; energy += slope[i] * slope[i]; }

    function amp(k) {
      var re = 0, im = 0;
      for (var j = 0; j < N; j++) {
        var a = 2 * Math.PI * k * (j + 0.5) / N;
        re += slope[j] * Math.cos(a); im += slope[j] * Math.sin(a);
      }
      return 2 * Math.sqrt(re * re + im * im) / N;
    }
    var bestK = 0, bestA = 0;
    for (var k = 1; k <= 14; k++) { var a = amp(k); if (a > bestA) { bestA = a; bestK = k; } }
    if (!bestK || !energy) return null;
    var third = bestK * 3 <= 30 ? amp(bestK * 3) : 0;
    var captured = (bestA * bestA + third * third) * N / 2 / energy;
    var zig = third / bestA > 0.18;
    // offset of a rib along its length, used to straighten ribs before measuring their spacing
    var offs = new Float64Array(N), run = 0, avg = 0;
    for (i = 0; i < N; i++) { run += slope[i] * L / N; offs[i] = run; avg += run / N; }
    for (i = 0; i < N; i++) offs[i] -= avg;
    return {
      strength: bestA, captured: captured, cycles: bestK, zig: zig, lo: lo, L: L, offs: offs, N: N, tx: tx, ty: ty,
      bend: zig ? (bestA * Math.PI / 4) * L / (4 * bestK) : bestA * L / (2 * Math.PI * bestK)
    };
  }

  /* ---------- do edges fall into two distinct directions? ---------- */
  function directionPeaks(e) {
    var B = 36, h = new Float64Array(B), i, T = 0;
    for (i = 0; i < e.count; i++) {
      var a = 0.5 * Math.atan2(e.s2[i], e.c2[i]);
      if (a < 0) a += Math.PI;
      h[Math.min(B - 1, Math.floor(a / Math.PI * B))] += e.w[i];
      T += e.w[i];
    }
    function massAround(b) {
      var m = 0;
      for (var j = -2; j <= 2; j++) m += h[(b + j + B) % B];
      return m;
    }
    var p1 = 0, m1 = -1;
    for (i = 0; i < B; i++) { var m = massAround(i); if (m > m1) { m1 = m; p1 = i; } }
    var p2 = 0, m2 = -1;
    for (i = 0; i < B; i++) {
      var sep = Math.abs(i - p1); sep = Math.min(sep, B - sep);
      if (sep < 9) continue;   // at least 45 degrees apart
      var mm = massAround(i);
      if (mm > m2) { m2 = mm; p2 = i; }
    }
    var angle = function (b) { return (b + 0.5) / B * Math.PI; };
    return { a1: angle(p1), a2: angle(p2), share1: T ? m1 / T : 0, share2: T ? m2 / T : 0 };
  }

  /* ---------- spacing ---------- */
  function detrend(p) {
    var N = p.length, win = Math.max(8, Math.floor(N / 6)), pre = new Float64Array(N + 1), out = new Float64Array(N), i;
    for (i = 0; i < N; i++) pre[i + 1] = pre[i] + p[i];
    for (i = 0; i < N; i++) {
      var a = Math.max(0, i - win), b = Math.min(N, i + win + 1);
      out[i] = p[i] - (pre[b] - pre[a]) / (b - a);
    }
    return out;
  }
  function period(p, minLag, maxLag, info) {
    var N = p.length, ac = new Float64Array(maxLag + 2), e0 = 0, i, lag;
    for (i = 0; i < N; i++) e0 += p[i] * p[i];
    if (!e0) return null;
    for (lag = minLag - 1; lag <= maxLag + 1; lag++) {
      var s = 0;
      for (i = 0; i + lag < N; i++) s += p[i] * p[i + lag];
      ac[lag] = s / (N - lag) * N / e0;
    }
    var best = 0;
    for (lag = minLag; lag <= maxLag; lag++) {
      if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1] && ac[lag] > best) best = ac[lag];
    }
    if (info) info.strength = best;
    if (best < 0.2) return null;
    for (lag = minLag; lag <= maxLag; lag++) {
      if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1] && ac[lag] >= best * 0.85) {
        // parabolic refinement gives sub-bin accuracy
        var a = ac[lag - 1], b = ac[lag], c = ac[lag + 1], den = a - 2 * b + c;
        return lag + (den ? clamp(0.5 * (a - c) / den, -0.5, 0.5) : 0);
      }
    }
    return null;
  }
  // Splits one repeat of the profile at its dark seams and returns the widths, as bins.
  function ribsInCycle(p, T) {
    var M = Math.max(3, Math.round(T)), sum = new Float64Array(M), cnt = new Float64Array(M), i;
    for (i = 0; i < p.length; i++) {
      var b = Math.floor(((i % T) / T) * M) % M;
      sum[b] += p[i]; cnt[b]++;
    }
    var c = new Float64Array(M), lo = Infinity, hi = -Infinity;
    for (i = 0; i < M; i++) { c[i] = cnt[i] ? sum[i] / cnt[i] : 0; lo = Math.min(lo, c[i]); hi = Math.max(hi, c[i]); }
    var range = hi - lo;
    if (!range) return [T];
    var seams = [];
    for (i = 0; i < M; i++) {
      var prev = c[(i - 1 + M) % M], next = c[(i + 1) % M];
      if (c[i] <= prev && c[i] < next && c[i] < lo + range * 0.45) seams.push(i);
    }
    // merge seams that are really one wide dip
    function brightBetween(a, b) {
      for (var j = a; j <= b; j++) if (c[j % M] > lo + range * 0.55) return true;
      return false;
    }
    var kept = [];
    seams.forEach(function (s) { if (!kept.length || brightBetween(kept[kept.length - 1], s)) kept.push(s); });
    if (kept.length > 1 && !brightBetween(kept[kept.length - 1], kept[0] + M)) kept.pop();
    seams = kept;
    if (seams.length < 2) return [T];
    return seams.map(function (s, n) {
      var next = n + 1 < seams.length ? seams[n + 1] : seams[0] + M;
      return (next - s) * T / M;
    });
  }
  // Turns widths into { ribWidth, ribRhythm } in design pixels.
  function spacing(widths, designPerBin) {
    widths = widths.slice(0, 8);
    var min = Math.min.apply(null, widths), max = Math.max.apply(null, widths);
    var ribWidth, rhythm;
    if (widths.length === 1 || max / min < 1.2) {
      ribWidth = widths.reduce(function (a, b) { return a + b; }, 0) / widths.length * designPerBin;
      rhythm = [1];
    } else {
      rhythm = widths.map(function (w) {
        var r = w / min, whole = Math.round(r);
        return clamp(Math.abs(r - whole) <= 0.3 ? whole : roundTo(r, 0.5), 0.5, 6);
      });
      var total = widths.reduce(function (a, b) { return a + b; }, 0);
      ribWidth = total / rhythm.reduce(function (a, b) { return a + b; }, 0) * designPerBin;
    }
    return { ribWidth: Math.round(clamp(ribWidth, 8, 160)), ribRhythm: rhythm };
  }
  function accumulate(gray, W, H, N, binOf) {
    var sum = new Float64Array(N), cnt = new Float64Array(N), i;
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var b = binOf(x, y);
      if (b < 0 || b >= N) continue;
      sum[b] += gray[y * W + x]; cnt[b]++;
    }
    var out = new Float64Array(N), last = 0;
    for (i = 0; i < N; i++) { if (cnt[i]) last = sum[i] / cnt[i]; out[i] = last; }
    return detrend(out);
  }
  function linearSpacing(e, W, H, theta, sw) {
    var cs = Math.cos(theta), sn = Math.sin(theta);
    var corners = [0, cs * W, sn * H, cs * W + sn * H];
    var lo = Math.min.apply(null, corners), hi = Math.max.apply(null, corners);
    var extra = sw ? Math.ceil(sw.bend * 2) : 0;
    var N = Math.ceil(hi - lo) + extra * 2 + 1;
    var p = accumulate(e.gray, W, H, N, function (x, y) {
      var v = x * cs + y * sn - lo + extra;
      if (sw) {
        var at = clamp(((x * sw.tx + y * sw.ty) - sw.lo) / sw.L * sw.N - 0.5, 0, sw.N - 1);
        var b = Math.floor(at), b2 = Math.min(sw.N - 1, b + 1);
        v += sw.offs[b] + (sw.offs[b2] - sw.offs[b]) * (at - b);
      }
      return Math.round(v);
    });
    var T = period(p, 3, Math.floor(N / 3));
    return T ? spacing(ribsInCycle(p, T), DESIGN_W / W) : null;
  }

  /* ---------- grid: is the image periodic along two perpendicular directions? ---------- */
  function gridAngle(gray, W, H) {
    function strengthAt(theta) {
      var cs = Math.cos(theta), sn = Math.sin(theta);
      var corners = [0, cs * W, sn * H, cs * W + sn * H];
      var lo = Math.min.apply(null, corners), hi = Math.max.apply(null, corners);
      var N = Math.ceil(hi - lo) + 1, sum = new Float64Array(N), cnt = new Float64Array(N), i;
      for (var y = 0; y < H; y += 2) for (var x = 0; x < W; x += 2) {
        var b = Math.round(x * cs + y * sn - lo);
        sum[b] += gray[y * W + x]; cnt[b]++;
      }
      var raw = new Float64Array(N), last = 0;
      for (i = 0; i < N; i++) { if (cnt[i]) last = sum[i] / cnt[i]; raw[i] = last; }
      var p = detrend(raw), e = 0;
      // trims the sparse corners of a diagonal projection
      var edge = Math.floor(N * 0.12), q = p.subarray(edge, N - edge);
      for (i = 0; i < q.length; i++) e += q[i] * q[i];
      var rms = Math.sqrt(e / q.length);
      if (rms < 5) return { strength: 0, rms: rms };   // nothing periodic worth trusting along this axis
      var info = { strength: 0, rms: rms };
      period(q, 3, Math.floor(q.length / 3), info);
      return info;
    }
    var best = null;
    for (var d = 0; d < 90; d += 2) {
      var t = d * Math.PI / 180, a = strengthAt(t);
      if (a.strength < 0.4) continue;
      var c = strengthAt(t + Math.PI / 2);
      if (c.strength < 0.4) continue;
      // Ribs seen side-on leave only faint aliasing, so both axes must carry similar contrast.
      if (Math.min(a.rms, c.rms) / Math.max(a.rms, c.rms) < 0.5) continue;
      var s = Math.min(a.strength, c.strength);
      if (!best || s > best.s) best = { s: s, theta: t };
    }
    return best ? best.theta : null;
  }

  /* ---------- classification ---------- */
  function inspect(id) {
    var W = id.width, H = id.height;
    var result = colorsAndLight(id);
    var settings = {
      pattern: 'lines', patternAngle: 0, patternBend: 60, patternWaves: 2,
      patternCenterX: 0.5, patternCenterY: 0.5, ribRhythm: [1], ribWidth: 25
    };
    var out = { colors: result.colors, lightMap: result.lightMap, settings: settings, detected: null };
    var e = edgesOf(id);
    if (e.count < W * H * 0.015) return out;   // no clear structure: colors and light only

    var coh = coherence(e), rad = radial(e, W, H), peaks = directionPeaks(e);
    function deg(t) {
      var d = t * 180 / Math.PI;
      while (d > 90) d -= 180;
      while (d <= -90) d += 180;
      return Math.round(d);
    }
    function useCenter(c) {
      settings.patternCenterX = Math.round(clamp(c.x / W, 0, 1) * 100) / 100;
      settings.patternCenterY = Math.round(clamp(c.y / H, 0, 1) * 100) / 100;
    }
    function applySpacing(s) { if (s) { settings.ribWidth = s.ribWidth; settings.ribRhythm = s.ribRhythm; out.spaced = true; } }

    if (rad.rings.s > 0.6 && rad.rings.s > coh.value + 0.08 && rad.rings.s >= rad.rays.s) {
      settings.pattern = 'rings'; settings.patternBend = 0; settings.patternWaves = 6;
      useCenter(rad.rings);
      var Rmax = Math.ceil(Math.max(
        Math.hypot(rad.rings.x, rad.rings.y), Math.hypot(W - rad.rings.x, rad.rings.y),
        Math.hypot(rad.rings.x, H - rad.rings.y), Math.hypot(W - rad.rings.x, H - rad.rings.y))) + 1;
      var rp = accumulate(e.gray, W, H, Rmax, function (x, y) { return Math.round(Math.hypot(x - rad.rings.x, y - rad.rings.y)); });
      var rT = period(rp, 3, Math.floor(Rmax / 3));
      if (rT) applySpacing(spacing(ribsInCycle(rp, rT), DESIGN_W / W));
      out.detected = 'rings';
      return out;
    }
    if (rad.rays.s > 0.6 && rad.rays.s > coh.value + 0.08) {
      settings.pattern = 'rays';
      useCenter(rad.rays);
      var A = 1440;
      var ap = accumulate(e.gray, W, H, A, function (x, y) {
        var dx = x - rad.rays.x, dy = y - rad.rays.y;
        if (dx * dx + dy * dy < 400) return -1;   // spokes blur together at the hub
        var t = Math.atan2(dy, dx) / (2 * Math.PI);
        return Math.floor((t < 0 ? t + 1 : t) * A) % A;
      });
      var aT = period(ap, 3, 240);
      if (aT) {
        // the engine sizes ribs so they measure ribWidth at a quarter of the design width from the center
        applySpacing(spacing(ribsInCycle(ap, aT), 2 * Math.PI * 0.25 * DESIGN_W / A));
      }
      out.detected = 'rays';
      return out;
    }

    // Edges split into two directions: a steep zigzag, whose axis lies midway between them.
    var twoDirections = peaks.share2 >= peaks.share1 * 0.45 && peaks.share1 + peaks.share2 >= 0.6;
    var mid = (peaks.a1 + peaks.a2) / 2;
    var axes = coh.value >= 0.3 || !twoDirections ? [coh.theta] : [];
    if (twoDirections) axes.push(mid, mid + Math.PI / 2);
    var bestSwing = null, bestAxis = coh.theta;
    axes.forEach(function (t) {
      var s = swing(e, W, H, t);
      if (s && s.strength >= 0.07 && s.captured >= 0.4 && (!bestSwing || s.captured > bestSwing.captured + 0.03)) { bestSwing = s; bestAxis = t; }
    });
    // A clear back-and-forth swing along the ribs outranks the grid test, which diagonal ribs can fool.
    var swingReps = bestSwing ? bestSwing.cycles / bestSwing.L * H : 0;
    var clearSwing = bestSwing && bestSwing.captured >= 0.5 && swingReps >= 1 && bestSwing.bend * DESIGN_W / W <= 240;
    var gridTheta = clearSwing ? null : gridAngle(e.gray, W, H);
    if (gridTheta !== null) {
      var other = gridTheta + Math.PI / 2;
      var first = Math.abs(deg(gridTheta)) <= Math.abs(deg(other)) ? gridTheta : other;
      settings.pattern = 'grid';
      settings.patternAngle = deg(first);
      applySpacing(linearSpacing(e, W, H, first, null));
      out.detected = 'grid';
      return out;
    }

    if (bestSwing) {
      settings.pattern = bestSwing.zig ? 'zigzag' : 'wave';
      settings.patternAngle = deg(bestAxis);
      settings.patternBend = Math.round(clamp(bestSwing.bend * DESIGN_W / W, 0, 240));
      settings.patternWaves = clamp(roundTo(bestSwing.cycles / bestSwing.L * H, 0.5), 0.5, 12);
      applySpacing(linearSpacing(e, W, H, bestAxis, bestSwing));
      out.detected = settings.pattern;
      return out;
    }
    if (coh.value >= 0.35) {
      settings.pattern = 'lines';
      settings.patternAngle = deg(coh.theta);
      applySpacing(linearSpacing(e, W, H, coh.theta, null));
      out.detected = 'lines';
    }
    return out;
  }

  // A layout only counts when it clearly repeats. Ordinary pictures have edges too, and a single
  // circle or a few shapes must not be mistaken for ribs.
  var MAX_REPEAT = 320;   // design px, so at least six repeats across the width
  function analyze(id) {
    var out = inspect(id), s = out.settings;
    var total = s.ribWidth * s.ribRhythm.reduce(function (a, b) { return a + b; }, 0);
    if (out.detected && (!out.spaced || total > MAX_REPEAT)) {
      out.detected = null;
      out.settings = {
        pattern: 'lines', patternAngle: 0, patternBend: 60, patternWaves: 2,
        patternCenterX: 0.5, patternCenterY: 0.5, ribRhythm: [1], ribWidth: 25
      };
    }
    delete out.spaced;
    return out;
  }

  // Center-crops any image to the 16:9 design and analyzes it.
  function fromImage(img) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) throw new Error('Image has no size');
    var scale = Math.max(W_ANALYSIS / iw, H_ANALYSIS / ih);
    var cw = W_ANALYSIS / scale, ch = H_ANALYSIS / scale;
    var c = document.createElement('canvas');
    c.width = W_ANALYSIS; c.height = H_ANALYSIS;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W_ANALYSIS, H_ANALYSIS);
    ctx.drawImage(img, (iw - cw) / 2, (ih - ch) / 2, cw, ch, 0, 0, W_ANALYSIS, H_ANALYSIS);
    return analyze(ctx.getImageData(0, 0, W_ANALYSIS, H_ANALYSIS));
  }

  // Center-crops to 16:9 and returns a JPEG data URI. With maxChars, lowers quality and size until it fits.
  function exportImage(img, width, quality, maxChars) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var scale = Math.min(iw / 16, ih / 9), cw = 16 * scale, ch = 9 * scale;
    var c = document.createElement('canvas'), ctx = c.getContext('2d');
    for (;;) {
      c.width = width; c.height = Math.round(width * 9 / 16);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (iw - cw) / 2, (ih - ch) / 2, cw, ch, 0, 0, c.width, c.height);
      var url = c.toDataURL('image/jpeg', quality);
      if (!maxChars || url.length <= maxChars || width <= 64) return url;
      if (quality > 0.35) quality -= 0.1; else width = Math.round(width * 0.8);
    }
  }

  // The whole image, uncropped, at up to maxSide px on its long side (never upscaled). Used by exact mode,
  // where the hero shows the picture itself, so it keeps as much detail as possible.
  function exportFull(img, maxSide, quality) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var k = Math.min(1, maxSide / Math.max(iw, ih));
    var c = document.createElement('canvas'), ctx = c.getContext('2d');
    c.width = Math.max(1, Math.round(iw * k)); c.height = Math.max(1, Math.round(ih * k));
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  }

  global.FlutedAnalyzer = { analyze: analyze, fromImage: fromImage, exportImage: exportImage, exportFull: exportFull };
})(typeof window !== 'undefined' ? window : this);

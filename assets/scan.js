/* Paper detection and perspective correction, no external libraries.
   Corners are stored normalized (0..1) in the ORIGINAL image's coordinates: [tl, tr, br, bl]. */
(function () {
  'use strict';

  function grayOf(img, max) {
    const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
    const k = Math.min(1, max / Math.max(sw, sh)), w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', {willReadFrequently: true}); x.drawImage(img, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h), sat = new Float32Array(w * h);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      g[j] = .299 * r + .587 * gg + .114 * b;
      sat[j] = Math.max(r, gg, b) - Math.min(r, gg, b);
    }
    return {g, sat, w, h};
  }

  function blur(a, w, h, rad) {
    const t = new Float32Array(a.length), o = new Float32Array(a.length), n = rad * 2 + 1;
    for (let y = 0; y < h; y++) {
      let s = 0; for (let x = -rad; x <= rad; x++) s += a[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        t[y * w + x] = s / n;
        s += a[y * w + Math.min(w - 1, x + rad + 1)] - a[y * w + Math.max(0, x - rad)];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0; for (let y = -rad; y <= rad; y++) s += t[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        o[y * w + x] = s / n;
        s += t[Math.min(h - 1, y + rad + 1) * w + x] - t[Math.max(0, y - rad) * w + x];
      }
    }
    return o;
  }

  function otsu(a) {
    const hist = new Float64Array(256);
    for (let i = 0; i < a.length; i++) hist[Math.max(0, Math.min(255, a[i] | 0))]++;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sB = 0, wB = 0, best = 0, th = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue; const wF = a.length - wB; if (!wF) break;
      sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; th = t; }
    }
    return th;
  }

  /* Largest 4-connected component of mask; returns pixel index list. */
  function largest(mask, w, h) {
    const lab = new Int32Array(w * h), q = new Int32Array(w * h);
    let bestN = 0, bestL = 0, L = 0;
    for (let s = 0; s < mask.length; s++) {
      if (!mask[s] || lab[s]) continue;
      L++; let qh = 0, qt = 0; q[qt++] = s; lab[s] = L;
      while (qh < qt) {
        const p = q[qh++], x = p % w, y = (p / w) | 0;
        if (x > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = L; q[qt++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = L; q[qt++] = p + 1; }
        if (y > 0 && mask[p - w] && !lab[p - w]) { lab[p - w] = L; q[qt++] = p - w; }
        if (y < h - 1 && mask[p + w] && !lab[p + w]) { lab[p + w] = L; q[qt++] = p + w; }
      }
      if (qt > bestN) { bestN = qt; bestL = L; }
    }
    return {lab, L: bestL, n: bestN};
  }

  const area = q => {
    let s = 0; for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; s += a.x * b.y - b.x * a.y; }
    return Math.abs(s) / 2;
  };
  const convex = q => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
      const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(z) < 1e-9) return false;
      if (!sign) sign = Math.sign(z); else if (Math.sign(z) !== sign) return false;
    }
    return true;
  };

  /* Returns normalized quad or null when no clear sheet is found (e.g. the page already fills the photo). */
  function detect(img) {
    const {g, sat, w, h} = grayOf(img, 420);
    // paper = bright and low-saturation
    const score = new Float32Array(g.length);
    for (let i = 0; i < g.length; i++) score[i] = g[i] - sat[i] * .6;
    const b = blur(score, w, h, 3), t = otsu(b);
    const mask = new Uint8Array(g.length);
    for (let i = 0; i < b.length; i++) mask[i] = b[i] > t ? 1 : 0;
    const {lab, L, n} = largest(mask, w, h);
    if (n < w * h * .15) return null;
    // close holes by using row extents of the component
    let tl, tr, br, bl, sMin = 1e9, sMax = -1e9, dMin = 1e9, dMax = -1e9, touch = 0;
    for (let y = 0; y < h; y++) {
      let x0 = -1, x1 = -1;
      for (let x = 0; x < w; x++) if (lab[y * w + x] === L) { if (x0 < 0) x0 = x; x1 = x; }
      if (x0 < 0) continue;
      for (const x of [x0, x1]) {
        const s = x + y, d = x - y;
        if (s < sMin) { sMin = s; tl = {x, y}; }
        if (s > sMax) { sMax = s; br = {x, y}; }
        if (d > dMax) { dMax = d; tr = {x, y}; }
        if (d < dMin) { dMin = d; bl = {x, y}; }
      }
      if (x0 <= 1) touch++; if (x1 >= w - 2) touch++;
    }
    const quad = [tl, tr, br, bl].map(p => ({x: (p.x + .5) / w, y: (p.y + .5) / h}));
    const a = area(quad);
    if (!convex(quad) || a < .18) return null;
    // sheet fills the photo already: nothing useful to crop
    if (a > .93 || touch > h * 1.2) return null;
    // pull corners 0.4% inwards so the table edge does not show
    const cx = quad.reduce((s, p) => s + p.x, 0) / 4, cy = quad.reduce((s, p) => s + p.y, 0) / 4;
    return quad.map(p => ({x: p.x + (cx - p.x) * .008, y: p.y + (cy - p.y) * .008}));
  }

  /* Projective map from the unit square to quad (pixel coords). */
  function squareToQuad(q) {
    const [p0, p1, p2, p3] = q;
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
    const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
    let g = 0, hh = 0;
    const det = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(det) > 1e-12) { g = (dx3 * dy2 - dx2 * dy3) / det; hh = (dx1 * dy3 - dx3 * dy1) / det; }
    return {a: p1.x - p0.x + g * p1.x, b: p3.x - p0.x + hh * p3.x, c: p0.x, d: p1.y - p0.y + g * p1.y, e: p3.y - p0.y + hh * p3.y, f: p0.y, g, h: hh};
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  /* Warp img by normalized quad into an upright canvas whose long side is <= max. */
  function warp(img, quad, max) {
    const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
    const P = quad.map(p => ({x: p.x * sw, y: p.y * sh}));
    let W = Math.max(dist(P[0], P[1]), dist(P[3], P[2])), H = Math.max(dist(P[0], P[3]), dist(P[1], P[2]));
    const k = Math.min(1, max / Math.max(W, H)); W = Math.max(8, Math.round(W * k)); H = Math.max(8, Math.round(H * k));
    // sample from a source copy limited to a sensible resolution
    const sk = Math.min(1, (max * 1.25) / Math.max(sw, sh)), cw = Math.round(sw * sk), ch = Math.round(sh * sk);
    const sc = document.createElement('canvas'); sc.width = cw; sc.height = ch;
    const sx = sc.getContext('2d', {willReadFrequently: true}); sx.drawImage(img, 0, 0, cw, ch);
    const src = sx.getImageData(0, 0, cw, ch).data;
    const M = squareToQuad(P.map(p => ({x: p.x * sk, y: p.y * sk})));
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const ox = out.getContext('2d'), od = ox.createImageData(W, H), o = od.data;
    for (let y = 0; y < H; y++) {
      const v = (y + .5) / H;
      for (let x = 0; x < W; x++) {
        const u = (x + .5) / W, den = M.g * u + M.h * v + 1;
        let X = (M.a * u + M.b * v + M.c) / den - .5, Y = (M.d * u + M.e * v + M.f) / den - .5;
        if (X < 0) X = 0; else if (X > cw - 1.001) X = cw - 1.001;
        if (Y < 0) Y = 0; else if (Y > ch - 1.001) Y = ch - 1.001;
        const x0 = X | 0, y0 = Y | 0, fx = X - x0, fy = Y - y0, i0 = (y0 * cw + x0) * 4, i1 = i0 + cw * 4, oi = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) {
          const top = src[i0 + c] + (src[i0 + 4 + c] - src[i0 + c]) * fx, bot = src[i1 + c] + (src[i1 + 4 + c] - src[i1 + c]) * fx;
          o[oi + c] = top + (bot - top) * fy;
        }
        o[oi + 3] = 255;
      }
    }
    ox.putImageData(od, 0, 0);
    return out;
  }

  window.Scan = {detect, warp, otsu, blur};
})();

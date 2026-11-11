/* Handwritten page numbers: a circled number at the top of the page ("(25)") or a heading such as "lecture 25".
   Ink is split into strokes, the circle is found as a closed ring, and each digit inside it is read by a small
   neural net (assets/hand-model.js, trained on handwritten digits). No server, runs in the page. */
(function () {
  'use strict';

  /* ---------- the digit net ---------- */
  let nets = null;
  function decode(W) {
    const n = {};
    for (const k in W) {
      const bin = atob(W[k].d), a = new Float32Array(bin.length), s = W[k].s;
      for (let i = 0; i < bin.length; i++) { const b = bin.charCodeAt(i); a[i] = (b > 127 ? b - 256 : b) * s; }
      n[k] = a;
    }
    return n;
  }
  /* HAND_W holds one or more nets; their answers are averaged */
  function getNet() {
    if (nets) return nets;
    const W = window.HAND_W; if (!W) return null;
    nets = (Array.isArray(W) ? W : [W]).map(decode);
    return nets;
  }
  function conv(x, C, S, w, b, F) {
    const o = new Float32Array(F * S * S);
    for (let y = 0; y < S; y++) for (let xx = 0; xx < S; xx++) {
      const base = (y * S + xx);
      for (let f = 0; f < F; f++) o[f * S * S + base] = b[f];
      for (let c = 0; c < C; c++) for (let i = 0; i < 5; i++) {
        const yy = y + i - 2; if (yy < 0 || yy >= S) continue;
        for (let j = 0; j < 5; j++) {
          const xj = xx + j - 2; if (xj < 0 || xj >= S) continue;
          const v = x[c * S * S + yy * S + xj]; if (!v) continue;
          const wi = ((c * 5 + i) * 5 + j) * F;
          for (let f = 0; f < F; f++) o[f * S * S + base] += v * w[wi + f];
        }
      }
    }
    return o;
  }
  function reluPool(x, F, S) {
    const H = S / 2, o = new Float32Array(F * H * H);
    for (let f = 0; f < F; f++) for (let y = 0; y < H; y++) for (let xx = 0; xx < H; xx++) {
      const i = f * S * S + y * 2 * S + xx * 2;
      o[f * H * H + y * H + xx] = Math.max(0, x[i], x[i + 1], x[i + S], x[i + S + 1]);
    }
    return o;
  }
  /* img: Float32Array(784), ink = 1. Returns probabilities for 0-9. */
  function forward(N, img) {
    let h = reluPool(conv(img, 1, 28, N.c1, N.b1, 12), 12, 28);
    h = reluPool(conv(h, 12, 14, N.c2, N.b2, 24), 24, 14);
    const z = new Float32Array(64);
    for (let o = 0; o < 64; o++) { let s = N.g1[o]; for (let i = 0; i < h.length; i++) s += h[i] * N.f1[i * 64 + o]; z[o] = Math.max(0, s); }
    const lg = new Float32Array(10); let mx = -1e9;
    for (let o = 0; o < 10; o++) { let s = N.g2[o]; for (let i = 0; i < 64; i++) s += z[i] * N.f2[i * 10 + o]; lg[o] = s; mx = Math.max(mx, s); }
    let sum = 0; for (let o = 0; o < 10; o++) { lg[o] = Math.exp(lg[o] - mx); sum += lg[o]; }
    for (let o = 0; o < 10; o++) lg[o] /= sum;
    return lg;
  }
  /* the first net's 64 hidden features of a glyph (used to tell upright writing from upside-down) */
  function features(img) {
    const N = getNet(); if (!N) return null; const n = N[0];
    let h = reluPool(conv(img, 1, 28, n.c1, n.b1, 12), 12, 28);
    h = reluPool(conv(h, 12, 14, n.c2, n.b2, 24), 24, 14);
    const z = new Float32Array(64);
    for (let o = 0; o < 64; o++) { let s = n.g1[o]; for (let i = 0; i < h.length; i++) s += h[i] * n.f1[i * 64 + o]; z[o] = Math.max(0, s); }
    return z;
  }
  function classify(img) {
    const Ns = getNet(); if (!Ns) return null;
    const p = new Float32Array(10);
    for (const N of Ns) { const q = forward(N, img); for (let o = 0; o < 10; o++) p[o] += q[o] / Ns.length; }
    return p;
  }

  /* ---------- ink map ---------- */
  function inkMap(src, region, width) {
    const sx = region.x * src.width, sy = region.y * src.height, sw = region.w * src.width, sh = region.h * src.height;
    const k = width / sw, w = Math.round(width), h = Math.max(1, Math.round(sh * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', {willReadFrequently: true}); x.imageSmoothingQuality = 'high';
    x.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = Math.min(d[i], d[i + 1], d[i + 2]) * .5 + (.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]) * .5;
    const m = window.Scan.blur(g, w, h, Math.round(w * .012)), ink = new Uint8Array(w * h);
    // contrast floor from the page itself so paper texture is not ink
    const s = Float32Array.from(g).sort(), paper = s[Math.floor(s.length * .6)], dark = s[Math.floor(s.length * .01)];
    const th = Math.max(10, (paper - dark) * .12);
    for (let i = 0; i < g.length; i++) ink[i] = g[i] < m[i] - th ? 1 : 0;
    removeLines(ink, w, h);
    return {ink, w, h, k, region};
  }
  /* Ruled lines (often dashed after thresholding): thin horizontal ink that keeps going across a wide stretch of
     the page. A ring's flat top is thin too, but short, so it survives. Strokes that cross a line are kept. */
  function removeLines(ink, w, h) {
    const thin = new Uint8Array(w * h), T = Math.max(4, Math.round(w * .0036));
    for (let x = 0; x < w; x++) {
      let y = 0;
      while (y < h) {
        if (!ink[y * w + x]) { y++; continue; }
        let e = y; while (e < h && ink[e * w + x]) e++;
        if (e - y <= T) for (let k = y; k < e; k++) thin[k * w + x] = 1;
        y = e;
      }
    }
    // allow a slight slant: a line may wander a couple of rows over the window
    const band = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = 0; for (let d = -2; d <= 2 && !v; d++) { const yy = y + d; if (yy >= 0 && yy < h) v = thin[yy * w + x]; }
      band[y * w + x] = v;
    }
    const W = Math.round(w * .25), half = W >> 1, need = W * .35;
    for (let y = 0; y < h; y++) {
      let s = 0; const row = y * w;
      for (let x = 0; x < Math.min(w, half); x++) s += band[row + x];
      for (let x = 0; x < w; x++) {
        if (x + half < w) s += band[row + x + half];
        if (x - half - 1 >= 0) s -= band[row + x - half - 1];
        if (thin[row + x] && s > need) ink[row + x] = 0;
      }
    }
  }
  function components(ink, w, h) {
    const lab = new Int32Array(w * h), comps = [], st = [];
    for (let s = 0; s < ink.length; s++) {
      if (!ink[s] || lab[s]) continue;
      const id = comps.length + 1, px = []; let x0 = w, y0 = h, x1 = 0, y1 = 0;
      lab[s] = id; st.push(s);
      while (st.length) {
        const p = st.pop(), x = p % w, y = (p / w) | 0; px.push(p);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx; if (ink[q] && !lab[q]) { lab[q] = id; st.push(q); }
        }
      }
      comps.push({id, px, x0, y0, x1, y1, bw: x1 - x0 + 1, bh: y1 - y0 + 1, n: px.length});
    }
    return {lab, comps};
  }

  /* ---------- one glyph -> 28x28 like the training digits ---------- */
  function glyphImage(pxs, w) {
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (const p of pxs) { const x = p % w, y = (p / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const gw = x1 - x0 + 1, gh = y1 - y0 + 1, pad = 4, Gw = gw + pad * 2, Gh = gh + pad * 2;
    let m = new Uint8Array(Gw * Gh);
    for (const p of pxs) m[((p / w | 0) - y0 + pad) * Gw + (p % w) - x0 + pad] = 1;
    // stroke width estimate, then thicken so strokes look like the training digits (~2.6px of a 20px digit)
    let area = 0, edge = 0;
    for (let y = 1; y < Gh - 1; y++) for (let x = 1; x < Gw - 1; x++) {
      const i = y * Gw + x; if (!m[i]) continue; area++;
      if (!m[i - 1] || !m[i + 1] || !m[i - Gw] || !m[i + Gw]) edge++;
    }
    const t = edge ? Math.max(1, 2 * area / edge) : 1, s = 20 / Math.max(gw, gh);
    let r = Math.round((2.6 / s - t) / 2);
    while (r-- > 0) {
      const o = new Uint8Array(m.length);
      for (let y = 1; y < Gh - 1; y++) for (let x = 1; x < Gw - 1; x++) {
        const i = y * Gw + x; o[i] = m[i] | m[i - 1] | m[i + 1] | m[i - Gw] | m[i + Gw];
      }
      m = o;
    }
    // area-average down to fit 20x20, then centre by mass in 28x28
    const tw = Math.max(1, Math.round(gw * s)), th = Math.max(1, Math.round(gh * s)), small = new Float32Array(tw * th);
    // each source pixel covers an s-by-s square of the target; spread its area over the cells it overlaps
    for (let y = 0; y < Gh; y++) for (let x = 0; x < Gw; x++) {
      if (!m[y * Gw + x]) continue;
      const a0 = Math.max(0, (x - pad) * s), a1 = Math.min(tw, (x - pad + 1) * s), b0 = Math.max(0, (y - pad) * s), b1 = Math.min(th, (y - pad + 1) * s);
      if (a1 <= a0 || b1 <= b0) continue;
      for (let ty = Math.floor(b0); ty < b1; ty++) {
        const fy = Math.min(b1, ty + 1) - Math.max(b0, ty); if (fy <= 0) continue;
        for (let tx = Math.floor(a0); tx < a1; tx++) {
          const fx = Math.min(a1, tx + 1) - Math.max(a0, tx); if (fx > 0) small[ty * tw + tx] += fx * fy;
        }
      }
    }
    let mx = 0, my = 0, ms = 0;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { const v = Math.min(1, small[y * tw + x] * 1.15); small[y * tw + x] = v; mx += x * v; my += y * v; ms += v; }
    const ox = Math.round(14 - (ms ? mx / ms : tw / 2) - .5), oy = Math.round(14 - (ms ? my / ms : th / 2) - .5), img = new Float32Array(784);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const X = x + ox, Y = y + oy; if (X < 0 || Y < 0 || X > 27 || Y > 27) continue; img[Y * 28 + X] = small[y * tw + x];
    }
    return img;
  }
  function readGlyph(pxs, w) {
    const p = classify(glyphImage(pxs, w)); if (!p) return null;
    let d = 0; for (let i = 1; i < 10; i++) if (p[i] > p[d]) d = i;
    return {d, p: p[d], probs: p};
  }

  /* group stroke components into glyphs (a "4" or "5" is often two strokes) and read them left to right */
  function readGroup(cs, w, align) {
    if (!cs.length) return null;
    const maxH = Math.max(...cs.map(c => c.bh));
    const keep = cs.filter(c => c.bh >= maxH * .3 || c.bw >= maxH * .45).sort((a, b) => a.x0 - b.x0);
    const glyphs = [];
    for (const c of keep) {
      const g = glyphs[glyphs.length - 1];
      if (g && Math.min(g.x1, c.x1) - Math.max(g.x0, c.x0) > Math.min(g.x1 - g.x0, c.bw) * .45) {
        g.x0 = Math.min(g.x0, c.x0); g.x1 = Math.max(g.x1, c.x1); g.y0 = Math.min(g.y0, c.y0); g.y1 = Math.max(g.y1, c.y1); g.px = g.px.concat(c.px);
      } else glyphs.push({x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, px: c.px.slice()});
    }
    // digits of one number sit on one line: a mark well above or below the main digit is something else
    if (align && glyphs.length > 1) {
      const m = glyphs.reduce((a, b) => (b.y1 - b.y0 > a.y1 - a.y0 ? b : a));
      for (let i = glyphs.length - 1; i >= 0; i--) {
        const g = glyphs[i]; if (g === m) continue;
        const ov = Math.min(g.y1, m.y1) - Math.max(g.y0, m.y0);
        if (ov < Math.min(g.y1 - g.y0, m.y1 - m.y0) * align) glyphs.splice(i, 1);
      }
    }
    if (!glyphs.length || glyphs.length > 3) return null;
    let s = '', conf = 1, fill = 0;
    for (const g of glyphs) {
      const r = readGlyph(g.px, w); if (!r) return null; s += r.d; conf = Math.min(conf, r.p); g.r = r;
      const gw = g.x1 - g.x0 + 1, gh = g.y1 - g.y0 + 1; if (gw > gh * .6) fill = Math.max(fill, g.px.length / (gw * gh));
    }
    if (s[0] === '0' && s.length > 1) return null;
    // a scribbled-over number is a dense blob of ink
    return {v: +s, conf, glyphs, scribbled: fill > .58};
  }

  /* Like readGroup, but a glyph much wider than tall may be two digits written touching: try splitting it at
     the thinnest column near its middle and keep whichever reading the net trusts more. */
  function readBest(cs, w, align) {
    const base = readGroup(cs, w, align); if (!base) return null;
    const qual = g => Math.pow(g.glyphs.reduce((s, x) => s * x.r.p, 1), 1 / g.glyphs.length);
    base.q = qual(base);
    let best = base;
    base.glyphs.forEach((gl, k) => {
      const gw = gl.x1 - gl.x0 + 1, gh = gl.y1 - gl.y0 + 1;
      if (gw < gh * 1.6 || base.glyphs.length >= 3) return;
      const col = new Float32Array(gw); for (const p of gl.px) col[p % w - gl.x0]++;
      let sx = -1, mn = 1e9; for (let x = Math.round(gw * .3); x <= Math.round(gw * .7); x++) if (col[x] < mn) { mn = col[x]; sx = x; }
      if (sx < 0) return;
      const L = gl.px.filter(p => p % w - gl.x0 < sx), R = gl.px.filter(p => p % w - gl.x0 >= sx);
      const gs = new Set(gl.px), parts = [...cs.filter(c => !c.px.some(p => gs.has(p))), ...piecesOf(L, w), ...piecesOf(R, w)];
      const alt = readGroup(parts, w, align);
      if (alt && alt.glyphs.length === base.glyphs.length + 1) { alt.q = qual(alt) - .08; if (alt.q > best.q) best = alt; }
    });
    return best;
  }

  /* Choosing between the readings of the different cuts: the value most of them agree on. */
  function pickRead(reads, topQ) {
    const votes = new Map();
    for (const x of reads) votes.set(x.v, (votes.get(x.v) || 0) + x.q * x.q);
    const bestV = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return reads.filter(x => x.v === bestV).sort((a, b) => b.q - a.q)[0];
  }

  /* ---------- circled numbers ---------- */
  /* connected pieces of an arbitrary pixel list (used to split the ink inside a ring into digits) */
  function piecesOf(pxs, w) {
    const set = new Map(); for (const p of pxs) set.set(p, 0);
    const out = [];
    for (const s of pxs) {
      if (set.get(s)) continue;
      const id = out.length + 1, px = [], st = [s]; set.set(s, id); let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      while (st.length) {
        const p = st.pop(), x = p % w, y = (p / w) | 0; px.push(p);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const q = p + dy * w + dx; if (set.get(q) === 0) { set.set(q, id); st.push(q); }
        }
      }
      out.push({px, x0, y0, x1, y1, bw: x1 - x0 + 1, bh: y1 - y0 + 1, n: px.length});
    }
    return out;
  }
  /* A ring is ink spread all around an ellipse, with ink (the number) in its middle. Hand-drawn rings are often
     broken or touch the digits, so this does not rely on the ring being one closed stroke. */
  function rings(map, comps) {
    const {w} = map, out = [], keys = new Set();
    const near = (b, o, m) => o.x0 <= b.x1 + m && o.x1 >= b.x0 - m && o.y0 <= b.y1 + m && o.y1 >= b.y0 - m;
    const test = (g, b) => {
      const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1, key = b.x0 + ',' + b.y0 + ',' + b.x1 + ',' + b.y1;
      if (keys.has(key)) return; keys.add(key);
      if (bw < w * .036 || bw > w * .26 || bh < w * .026 || bh > w * .13) return;
      const asp = bw / bh; if (asp < .9 || asp > 2.8) return;
      const members = [...g, ...comps.filter(o => !g.has(o) && o.x0 >= b.x0 && o.x1 <= b.x1 && o.y0 >= b.y0 && o.y1 <= b.y1)];
      const pxs = []; for (const o of members) for (const p of o.px) pxs.push(p);
      if (pxs.length / (bw * bh) > .4) return;
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, ra = bw / 2, rb = bh / 2, S = 24, sect = new Uint8Array(S), inside = [];
      let band = 0, ix0 = 1e9, ix1 = -1, iy0 = 1e9, iy1 = -1;
      for (const p of pxs) {
        const x = p % w, y = (p / w) | 0, dx = (x - cx) / ra, dy = (y - cy) / rb, r = Math.hypot(dx, dy);
        if (r >= .7) { band++; sect[Math.min(S - 1, Math.floor((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * S))] = 1; }
        else { inside.push(p); ix0 = Math.min(ix0, x); ix1 = Math.max(ix1, x); iy0 = Math.min(iy0, y); iy1 = Math.max(iy1, y); }
      }
      // a ring clipped by the page edge: judge it only on the part that is inside the picture
      let inS = 0, hit = 0;
      for (let q = 0; q < S; q++) {
        const t = (q + .5) / S * 2 * Math.PI - Math.PI, ex = cx + Math.cos(t) * ra, ey = cy + Math.sin(t) * rb;
        if (ex < 1 || ey < 1 || ex > w - 2 || ey > map.h - 2) continue;
        inS++; hit += sect[q];
      }
      if (inS < S * .6) return;
      const cover = hit / inS;
      if (cover < .7 || band < pxs.length * .3 || inside.length < 15) return;
      // the number fills a good part of the ring's middle
      if (iy1 - iy0 < bh * .3 || ix1 - ix0 < bw * .15) return;
      // page numbers sit in the top margin; rings lower down are exercise numbers or graphs,
      // and rings at the side edges are spiral holes
      if (cy > map.h * .5 || b.x0 < w * .03 || b.x1 > w * .97) return;
      const crossed = inside.length / (Math.PI * ra * rb * .49) > .3;
      // strokes that run around the ring are the ring; the rest are the digits, kept whole.
      // Where a digit touches the ring, the part of the ring stroke well inside is kept as digit ink.
      const rad = p => Math.hypot((p % w - cx) / ra, ((p / w | 0) - cy) / rb);
      const keep = [], ringPx = [];
      for (const o of members) {
        const sc = new Uint8Array(S); let bn = 0;
        for (const p of o.px) {
          const dx = (p % w - cx) / ra, dy = ((p / w | 0) - cy) / rb;
          if (Math.hypot(dx, dy) >= .7) { bn++; sc[Math.min(S - 1, Math.floor((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * S))] = 1; }
        }
        const oc = sc.reduce((s, v) => s + v, 0) / S;
        if (oc >= .3 || (bn > o.n * .6 && oc >= .15)) ringPx.push(o); else keep.push(o);
      }
      // Where a digit touches the ring, part of the ring stroke is digit ink. How much is hard to tell
      // (rings are uneven and often overlap where they close), so several cuts are tried and the net decides.
      const Q = 48, outer = new Float32Array(Q), ang = p => Math.min(Q - 1, Math.floor((Math.atan2(((p / w | 0) - cy) / rb, (p % w - cx) / ra) + Math.PI) / (2 * Math.PI) * Q));
      let rn = 0; for (const o of ringPx) { rn += o.n; for (const p of o.px) { const q = ang(p), r = rad(p); if (r > outer[q]) outer[q] = r; } }
      const t = Math.min(.3, 1.6 * (rn / (Math.PI * (ra + rb))) / Math.min(ra, rb));
      const peel1 = p => { const q = ang(p); return rad(p) < Math.min(outer[q] > .7 ? outer[q] - t : .62, .85); };
      // second peel: where the ring overlaps itself (it is often closed with a second pass), take the next layer too
      const outer2 = new Float32Array(Q);
      for (const o of ringPx) for (const p of o.px) if (peel1(p)) { const q = ang(p), r = rad(p); if (r > outer2[q]) outer2[q] = r; }
      const peel2 = p => { if (!peel1(p)) return false; const q = ang(p); return !(outer2[q] > .74 && rad(p) > outer2[q] - t); };
      const cuts = [peel1, peel2, p => rad(p) < .5, p => rad(p) < .6, p => rad(p) < .68, p => rad(p) < .78];
      // a digit stroke can also run into the ring's inner edge; optionally trim what lies out near the ring
      const trims = [null, .8];
      // a leftover strip of the ring itself: far out and running along the ring for a good stretch
      const arcLike = q => {
        const rs = q.px.map(rad).sort((a, b) => a - b), sec = new Set(q.px.map(ang));
        return (rs[rs.length >> 1] > .64 && sec.size >= 5) || rs[rs.length >> 1] > .7;
      };
      const sets = [];
      for (const cut of cuts) for (const tr of trims) {
        const set = [];
        for (const o of keep) {
          if (!tr) { if (!arcLike(o)) set.push(o); continue; }
          const px = o.px.filter(p => rad(p) < tr); if (px.length > 10) for (const q of piecesOf(px, w)) if (q.n > 10 && !arcLike(q)) set.push(q);
        }
        for (const o of ringPx) { const att = o.px.filter(cut); if (att.length > 15) for (const q of piecesOf(att, w)) if (q.n > 10 && !arcLike(q)) set.push(q); }
        if (set.length) sets.push(set);
      }
      const digits = sets[0] || [];
      out.push({box: {...b}, bw, bh, inside, digits, sets, crossed, cover});
    };
    for (const c of comps) {
      if (c.bw < w * .02 || c.bh < w * .018 || c.bw > w * .26 || c.bh > w * .13 || c.n < w * .02) continue;
      const g = new Set([c]), b = {x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1};
      test(g, b);
      // broken rings come in pieces: also try the stroke together with everything touching it
      for (let it = 0; it < 3; it++) {
        let grew = false;
        for (const o of comps) {
          if (g.has(o) || o.bw > w * .26 || o.bh > w * .13 || !near(b, o, 3)) continue;
          g.add(o); grew = true; b.x0 = Math.min(b.x0, o.x0); b.y0 = Math.min(b.y0, o.y0); b.x1 = Math.max(b.x1, o.x1); b.y1 = Math.max(b.y1, o.y1);
        }
        if (!grew) break;
      }
      if (g.size > 1) test(g, b);
    }
    // overlapping finds of the same ring: keep the most complete one
    out.sort((a, b) => b.cover - a.cover || b.bw * b.bh - a.bw * a.bh);
    return out.filter((r, i) => !out.slice(0, i).some(o => near(o.box, r.box, -Math.min(r.bw, r.bh) * .3)));
  }

  /* ---------- "lecture 25" style headings: the tall marks that end a line of writing ---------- */
  function headings(map, comps) {
    const {w} = map, out = [];
    const cs = comps.filter(c => c.bh >= w * .008 && c.bh <= w * .07 && c.bw <= w * .16 && c.n >= 8).sort((a, b) => a.x0 - b.x0);
    const used = new Set();
    for (const s of cs) {
      if (used.has(s)) continue;
      const line = [s]; used.add(s);
      let last = s;
      for (;;) {
        // follow the line's own band (bottom of the small letters), choosing the closest next mark
        const bot = line.map(c => c.y1).sort((a, b) => a - b)[line.length >> 1], ref = Math.max(...line.map(c => c.bh).sort((a, b) => a - b).slice(0, Math.ceil(line.length / 2)), w * .02);
        let nx = null, best = 1e9;
        for (const o of cs) {
          if (used.has(o) || o.x0 <= last.x0) continue;
          const gap = o.x0 - last.x1, dy = Math.abs(o.y1 - bot);
          if (gap > ref * 2.2 || dy > ref * .8) continue;
          const cost = Math.max(0, gap) + dy * 2; if (cost < best) { best = cost; nx = o; }
        }
        if (!nx) break; line.push(nx); used.add(nx); last = nx;
      }
      if (line.length < 4 || line[line.length - 1].x1 - line[0].x0 < w * .09) continue;
      // digits stand about as tall as the tall letters (l, t); words joined into one wide mark are left out
      const narrow = line.filter(c => c.bw <= c.bh * 1.4), mx = Math.max(...narrow.map(c => c.bh), 0);
      const talls = narrow.filter(c => c.bh >= mx * .7).map(c => c.bh).sort((a, b) => a - b), H = talls[talls.length >> 1] || mx;
      const xh = H * .5;
      const tail = [];
      for (let i = line.length - 1; i >= 0 && tail.length < 3; i--) {
        const c = line[i];
        if (c.bh < H * .55 || c.bw > c.bh * 1.4) break;
        tail.unshift(c);
      }
      // a digit joined to the last letter ("e2"): split off the tall right end of that letter
      const prev = line[line.length - tail.length - 1];
      if (prev && tail.length < 2) {
        const cols = new Map();
        for (const p of prev.px) { const x = p % w, y = (p / w) | 0, e = cols.get(x); if (!e) cols.set(x, [y, y]); else { e[0] = Math.min(e[0], y); e[1] = Math.max(e[1], y); } }
        let sx = prev.x1; while (sx > prev.x0 && cols.has(sx - 1) && cols.get(sx - 1)[1] - cols.get(sx - 1)[0] >= H * .55) sx--;
        const rw = prev.x1 - sx + 1;
        if (rw >= xh * .35 && sx - prev.x0 >= xh * .5) {
          const px = prev.px.filter(p => p % w >= sx); let y0 = 1e9, y1 = -1; for (const p of px) { const y = (p / w) | 0; y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
          if (y1 - y0 + 1 >= H * .55) tail.unshift({px, x0: sx, x1: prev.x1, y0, y1, bw: rw, bh: y1 - y0 + 1, n: px.length, split: true});
        }
      }
      if (!tail.length || tail.length > 3 || line.length - tail.length < 2) continue;
      if (Math.max(...tail.map(t => t.y1)) > map.h * .55) continue;
      out.push({line, tail});
    }
    return out;
  }

  /* ---------- a number written on its own in the top margin ("12", no circle) ---------- */
  function lones(map, comps, taken) {
    const {w, h} = map, out = [];
    const ok = c => c.n >= 8 && c.bh >= w * .008 && c.bh <= w * .06 && c.bw <= w * .08 && c.x0 > w * .07 && c.x1 < w * .93 && !taken.has(c);
    const cs = comps.filter(ok).sort((a, b) => a.x0 - b.x0), used = new Set();
    // writing-sized marks only: the paper edge or a cover across the top is not "something written nearby"
    const others = comps.filter(c => c.n >= 8 && (c.bw > 3 || c.bh > 3) && c.bw <= w * .15 && c.bh <= w * .1);
    for (const s of cs) {
      if (used.has(s)) continue;
      const g = [s]; used.add(s); let b = {x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1};
      for (;;) {
        const gh = b.y1 - b.y0 + 1;
        const nx = cs.find(o => !used.has(o) && o.x0 <= b.x1 + gh * 1.5 && o.x1 >= b.x0 - gh * .3 && Math.min(o.y1, b.y1) - Math.max(o.y0, b.y0) > -gh * .3);
        if (!nx) break;
        const nb = {x0: Math.min(b.x0, nx.x0), y0: Math.min(b.y0, nx.y0), x1: Math.max(b.x1, nx.x1), y1: Math.max(b.y1, nx.y1)};
        // a number is a short row of digits: stop before the group runs into other writing
        if (nb.y1 - nb.y0 > s.bh * 1.7 || nb.x1 - nb.x0 > s.bh * 4) break;
        g.push(nx); used.add(nx); b = nb;
      }
      const gw = b.x1 - b.x0 + 1, gh = b.y1 - b.y0 + 1;
      if (gw > gh * 3.2 || (b.y0 + b.y1) / 2 > h * .55 || gh < w * .013) continue;
      // alone: nothing else written close by on the same line
      const gs = new Set(g), near = others.some(o => !gs.has(o) && !taken.has(o) && Math.max(o.bw, o.bh) >= gh * .35 &&
        o.x0 < b.x1 + gh * 2.5 && o.x1 > b.x0 - gh * 2.5 && o.y0 < b.y1 + gh * .8 && o.y1 > b.y0 - gh * .8);
      if (near) continue;
      out.push({g, box: b, gh});
    }
    return out;
  }

  /* Reads the top of a page. Returns [{v, conf, box, kind}] best first; box normalized to src. */
  function readTop(src) {
    if (!getNet()) return [];
    const region = {x: 0, y: 0, w: 1, h: Math.min(.24, (src.width / src.height) * .3)};
    const map = inkMap(src, region, 1400), {comps} = components(map.ink, map.w, map.h);
    const toBox = (x0, y0, x1, y1) => ({x0: x0 / map.w, y0: region.y + (y0 / map.h) * region.h, x1: (x1 + 1) / map.w, y1: region.y + ((y1 + 1) / map.h) * region.h});
    const res = [];
    const rl = rings(map, comps);
    // two numbers side by side: the one crossed out is the one with clearly more ink in it
    for (const r of rl) r.dens = r.inside.length / (Math.PI * r.bw * r.bh / 4 * .49) + .02 * (r.sets[0] || []).length;
    for (const r of rl) if (r.dens > .24 && rl.some(o => o !== r && o.dens * 1.2 <= r.dens)) r.crossed = true;
    for (const r of rl) {
      // among readings the net is about equally sure of, the one using the least ink has the fewest ring leftovers
      const reads = [];
      for (const set of r.sets) { const x = readBest(set, map.w, .3); if (x && x.v) { x.ink = x.glyphs.reduce((s, q) => s + q.px.length, 0); reads.push(x); } }
      if (!reads.length) continue;
      const topQ = Math.max(...reads.map(x => x.q));
      const g = pickRead(reads, topQ);
      if (g.scribbled) r.crossed = true;
      const big = r.bh / map.w, high = 1 - r.box.y0 / map.h;
      const score = g.conf * (r.crossed ? .25 : 1) + (r.crossed ? 0 : .5) + Math.min(.3, big * 4) + high * .2;
      // other plausible readings, for the cross-page check
      const opts = new Set([g.v]);
      for (const x of reads) if (x.q >= Math.min(topQ - .3, .5)) opts.add(x.v);
      if (String(g.v).length === 3) { const t = String(g.v); opts.add(+t.slice(1)); opts.add(+t.slice(0, 2)); }
      const agree = reads.filter(x => x.v === g.v).length / reads.length;
      res.push({v: g.v, conf: g.conf, agree, score, kind: 'circle', crossed: r.crossed, opts: [...opts].filter(v => v > 0), box: toBox(r.box.x0, r.box.y0, r.box.x1, r.box.y1)});
    }
    // strokes that belong to a ring are not candidates for a lone number
    const taken = new Set();
    for (const r of rl) for (const c of comps) if (c.x0 >= r.box.x0 && c.x1 <= r.box.x1 && c.y0 >= r.box.y0 && c.y1 <= r.box.y1) taken.add(c);
    for (const ln of lones(map, comps, taken)) {
      const g = readBest(ln.g, map.w); if (!g || !g.v || g.glyphs.length > 3) continue;
      const b = ln.box;
      res.push({v: g.v, conf: g.conf, agree: 1, score: g.q + .45 - (g.glyphs.length === 1 ? .1 : 0), kind: 'lone', opts: [g.v], box: toBox(b.x0, b.y0, b.x1, b.y1)});
    }
    for (const hd of headings(map, comps)) {
      // where the word ends and the number starts is not always clear ("lecture26"): keep the readings of the
      // last 1, 2 and 3 marks; two digits is the default, and the cross-page check may pick another
      const opts = [];
      for (let k = 1; k <= hd.tail.length; k++) {
        const part = hd.tail.slice(hd.tail.length - k), g = readGroup(part, map.w);
        if (g && g.v && g.glyphs.length === k) opts.push({v: g.v, conf: g.conf, part});
      }
      if (!opts.length) continue;
      const pick = opts.find(o => o.part.length === 2 && o.conf >= .5) || opts[0];
      const a = pick.part[0], b = pick.part[pick.part.length - 1];
      res.push({v: pick.v, conf: pick.conf, score: pick.conf * .9 + Math.min(.15, hd.line.length * .015), kind: 'heading', opts: opts.map(o => o.v),
        box: toBox(a.x0, Math.min(...pick.part.map(t => t.y0)), b.x1, Math.max(...pick.part.map(t => t.y1)))});
    }
    return res.sort((a, b) => b.score - a.score);
  }

  /* ---------- which way up is the photo? ---------- */
  /* Notebook ruled lines run across the page, so strong horizontal edges mean upright (or upside down) and
     strong vertical ones mean the photo is sideways. Which of the two ways is decided by the writing itself:
     a small classifier, trained on notebook handwriting, scores each written mark as upright or flipped using the
     digit net's features; one mark says little, but a page has a hundred or more and their vote is reliable. */
  const OW = [0.2941,0,-0.1974,0.1652,0,0.0993,0.1586,-0.1918,0.1325,-0.1733,0.0383,-0.0025,0,-0.0228,0.0682,0,0.0943,0.097,-0.2739,-0.213,0.0413,-0.0122,-0.2232,0,-0.0476,0.1381,0,-0.0641,0.438,-0.0557,0.168,0.2429,0.0499,0.1521,0.3619,-0.2528,0.1987,-0.4473,0.6049,0.0272,0.0088,-0.7454,0.2824,-0.1924,0.2914,-0.4674,0,-0.1139,0.1276,-0.0463,0.2699,-0.1681,0,0.2861,-0.1721,0,-0.0044,0,-0.055,-0.228,-0.1175,-0.0423,0.0294,-0.1805,-0.2108,0.0689], OMU = [1.4716,0,0.8297,0.8537,0,0.5994,1.048,1.2991,0.3266,0.6749,0.8485,1.4523,0,1.0284,2.695,0,2.37,0.6527,2.3113,0.2304,0.5813,0.7867,0.3406,0,1.0599,0.1625,0,0.5782,2.3103,0.7985,0.8704,0.661,0.8897,0.2242,0.97,1.1439,1.5317,2.2581,2.7772,1.0539,0.6624,3.1278,1.6701,1.1211,0.8385,0.6185,0,0.9978,1.9134,0.6827,0.2355,0.378,0,0.1462,1.2829,0,1.1315,0,0.7922,1.367,1.3461,1.837,1.2819,0.5506,-0.4938,0], OSD = [1.9748,1,1.4922,1.4184,1,1.1408,1.7435,1.6789,0.9443,1.302,1.749,2.4149,1,1.6285,2.2991,1,2.5728,1.3325,2.1718,0.7248,1.1984,1.5096,1.0272,1,1.487,0.6358,1,1.3288,3.0762,1.6146,1.5344,1.2969,1.6939,0.5827,1.888,1.5622,2.1136,2.3878,2.3996,1.7037,1.3069,2.8629,1.7886,1.7261,1.2755,1.3952,1,1.395,1.9105,1.339,0.6798,0.9448,1,0.4989,2.4011,1,1.558,1,1.3206,1.8651,1.4915,1.9939,2.3391,1.5672,0.6,1];
  function lineDir(src) {
    const k = 360 / Math.max(src.width, src.height), w = Math.max(8, Math.round(src.width * k)), h = Math.max(8, Math.round(src.height * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', {willReadFrequently: true}); x.drawImage(src, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2];
    let H = 0, V = 0;
    for (let y = Math.round(h * .1); y < h * .9; y++) for (let xx = Math.round(w * .1); xx < w * .9; xx++) {
      const i = y * w + xx, ax = Math.abs(g[i + 1] - g[i - 1]), ay = Math.abs(g[i + w] - g[i - w]);
      if (Math.max(ax, ay) < 12) continue;
      if (ay > ax * 2.5) H++; else if (ax > ay * 2.5) V++;
    }
    return H / (V + 1);
  }
  function turn(img, q) { // rotate a 28x28 glyph by q quarter turns clockwise
    const o = new Float32Array(784);
    for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) {
      const v = img[y * 28 + x]; if (!v) continue;
      const X = q === 1 ? 27 - y : q === 2 ? 27 - x : q === 3 ? y : x, Y = q === 1 ? x : q === 2 ? 27 - y : q === 3 ? 27 - x : y;
      o[Y * 28 + X] = v;
    }
    return o;
  }
  /* mean "upright" score of the writing after turning the page q quarter turns clockwise */
  function uprightScores(src) {
    // the short side is always 900px, so a sideways photo is read at the same scale as an upright one
    const map = inkMap(src, {x: 0, y: 0, w: 1, h: 1}, 900 * Math.max(1, src.width / src.height)), {comps} = components(map.ink, map.w, map.h), w = map.w, H = map.h;
    const S = Math.min(w, H), land = w > H;
    let cs = comps.filter(c => {
      const a = Math.max(c.bw, c.bh), b = Math.min(c.bw, c.bh);
      return a >= S * .015 && a <= S * .08 && c.n >= 15 && b > 2 && (land
        ? c.y0 > H * .05 && c.y1 < H * .95 && c.x0 > w * .03 && c.x1 < w * .97
        : c.x0 > w * .05 && c.x1 < w * .95 && c.y0 > H * .03 && c.y1 < H * .97);
    });
    if (cs.length > 110) { const st = cs.length / 110; cs = cs.filter((c, i) => Math.floor(i % st) === 0); }
    if (cs.length < 20) return null;
    const sum = [0, 0, 0, 0];
    for (const c of cs) {
      const g = glyphImage(c.px, w);
      for (let q = 0; q < 4; q++) {
        const t = q ? turn(g, q) : g, f = features(t), sideways = q % 2 === 1;
        // aspect of the glyph as it would stand after the turn
        const asp = Math.log(sideways ? c.bh / c.bw : c.bw / c.bh);
        let z = 0;
        for (let j = 0; j < 64; j++) z += OW[j] * (f[j] - OMU[j]) / OSD[j];
        z += OW[64] * (asp - OMU[64]) / OSD[64] + OW[65];
        sum[q] += z;
      }
    }
    const out = sum.map(v => v / cs.length); out.n = cs.length;
    return out;
  }
  /* Clockwise turn (0, 90, 180, 270) that makes the page upright; 0 when unsure. */
  function orient(src) {
    if (!getNet()) return 0;
    const dir = lineDir(src);
    if (dir > .6 && dir < 1.2) return 0;
    if (dir <= .6) {
      // turn it a quarter first so the ruled lines lie across, then it is the same up-or-down question
      const c = document.createElement('canvas'); c.width = src.height; c.height = src.width;
      const x = c.getContext('2d'); x.translate(c.width / 2, c.height / 2); x.rotate(Math.PI / 2); x.drawImage(src, -src.width / 2, -src.height / 2);
      const s = uprightScores(c); if (!s) return 0;
      if (Math.abs(s[0] - s[2]) < .08) return 0;
      return s[0] > s[2] ? 90 : 270;
    }
    const s = uprightScores(src); if (!s) return 0;
    // lines run across: only turn it over when plenty of writing clearly says it is upside down,
    // and not when a page number already reads cleanly at the top the way it is
    if (s.n < 45 || s[2] - s[0] <= .3) return 0;
    const top = readTop(src).filter(c => !c.crossed)[0];
    if (top && top.conf >= .85 && top.kind !== 'heading') return 0;
    return 180;
  }

  let loading = null;
  function load() {
    if (window.HAND_W) return Promise.resolve();
    if (!loading) loading = new Promise((res, rej) => {
      const sc = document.createElement('script'); sc.src = 'assets/hand-model.js'; sc.onload = res; sc.onerror = () => { loading = null; rej(new Error('model')); };
      document.head.append(sc);
    });
    return loading;
  }

  window.Hand = {load, readTop, orient, classify, features, _lineDir: lineDir, _upright: uprightScores, _inkMap: inkMap, _components: components, _rings: rings, _pieces: piecesOf, _headings: headings, _lones: lones, _glyph: glyphImage};
})();

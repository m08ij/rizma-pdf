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
  function readGroup(cs, w) {
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
  function readBest(cs, w) {
    const base = readGroup(cs, w); if (!base) return null;
    const qual = g => Math.pow(g.glyphs.reduce((s, x) => s * x.r.p, 1), 1 / g.glyphs.length) - (g.scribbled ? .5 : 0);
    base.q = qual(base);
    let best = base;
    base.glyphs.forEach((gl, k) => {
      const gw = gl.x1 - gl.x0 + 1, gh = gl.y1 - gl.y0 + 1;
      if (gw < gh * 1.05 || base.glyphs.length >= 3) return;
      const col = new Float32Array(gw); for (const p of gl.px) col[p % w - gl.x0]++;
      let sx = -1, mn = 1e9; for (let x = Math.round(gw * .3); x <= Math.round(gw * .7); x++) if (col[x] < mn) { mn = col[x]; sx = x; }
      if (sx < 0) return;
      const L = gl.px.filter(p => p % w - gl.x0 < sx), R = gl.px.filter(p => p % w - gl.x0 >= sx);
      const gs = new Set(gl.px), parts = [...cs.filter(c => !c.px.some(p => gs.has(p))), ...piecesOf(L, w), ...piecesOf(R, w)];
      const alt = readGroup(parts, w);
      if (alt && alt.glyphs.length === base.glyphs.length + 1) { alt.q = qual(alt) - .03; if (alt.q > best.q) best = alt; }
    });
    return best;
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
      if (bw < w * .045 || bw > w * .26 || bh < w * .028 || bh > w * .13) return;
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
      const cover = sect.reduce((s, v) => s + v, 0) / S;
      if (cover < .7 || band < pxs.length * .3 || inside.length < 15) return;
      // the number fills a good part of the ring's middle
      if (iy1 - iy0 < bh * .3 || ix1 - ix0 < bw * .15) return;
      // page numbers sit in the top margin; rings lower down are exercise numbers or graphs
      if (cy > map.h * .5) return;
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
        return rs[rs.length >> 1] > .64 && sec.size >= 5;
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
      for (const set of r.sets) { const x = readBest(set, map.w); if (x && x.v) { x.ink = x.glyphs.reduce((s, q) => s + q.px.length, 0); reads.push(x); } }
      if (!reads.length) continue;
      const topQ = Math.max(...reads.map(x => x.q));
      const g = reads.filter(x => x.q >= topQ - .06).sort((a, b) => a.ink - b.ink)[0];
      if (g.scribbled) r.crossed = true;
      const big = r.bh / map.w, high = 1 - r.box.y0 / map.h;
      const score = g.conf * (r.crossed ? .25 : 1) + (r.crossed ? 0 : .5) + Math.min(.3, big * 4) + high * .2;
      // other plausible readings, for the cross-page check
      const opts = new Set([g.v]);
      for (const x of reads) if (x.q >= topQ - .3) opts.add(x.v);
      if (String(g.v).length === 3) { const t = String(g.v); opts.add(+t.slice(1)); opts.add(+t.slice(0, 2)); }
      const agree = reads.filter(x => x.v === g.v).length / reads.length;
      res.push({v: g.v, conf: g.conf, agree, score, kind: 'circle', crossed: r.crossed, opts: [...opts].filter(v => v > 0), box: toBox(r.box.x0, r.box.y0, r.box.x1, r.box.y1)});
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

  let loading = null;
  function load() {
    if (window.HAND_W) return Promise.resolve();
    if (!loading) loading = new Promise((res, rej) => {
      const sc = document.createElement('script'); sc.src = 'assets/hand-model.js'; sc.onload = res; sc.onerror = () => { loading = null; rej(new Error('model')); };
      document.head.append(sc);
    });
    return loading;
  }

  window.Hand = {load, readTop, classify, _inkMap: inkMap, _components: components, _rings: rings, _pieces: piecesOf, _headings: headings, _glyph: glyphImage};
})();

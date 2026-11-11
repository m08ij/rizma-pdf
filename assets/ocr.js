/* Page-number reading and searchable-PDF text layers.
   Latin digits: Tesseract (eng) on enlarged zones, several contrast variants, votes combined.
   Eastern Arabic digits (٠-٩): a small template matcher on connected components. */
(function () {
  'use strict';
  const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const AR = '٠١٢٣٤٥٦٧٨٩';
  const toLatin = s => s.replace(/[٠-٩]/g, d => AR.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  let digitWorker = null, textWorker = null, loading = null;

  function loadTess() {
    if (window.Tesseract) return Promise.resolve();
    if (!loading) loading = new Promise((res, rej) => { const s = document.createElement('script'); s.src = TESS; s.onload = res; s.onerror = () => { loading = null; rej(new Error('load')); }; document.head.append(s); });
    return loading;
  }
  async function getDigitWorker(onProg) {
    if (digitWorker) return digitWorker;
    await loadTess();
    digitWorker = await Tesseract.createWorker('eng', 1, {logger: m => onProg && m.progress != null && onProg(m)});
    await digitWorker.setParameters({tessedit_pageseg_mode: '11', preserve_interword_spaces: '1'});
    return digitWorker;
  }
  async function getTextWorker(onProg) {
    if (textWorker) return textWorker;
    await loadTess();
    textWorker = await Tesseract.createWorker(['ara', 'eng'], 1, {logger: m => onProg && m.progress != null && onProg(m)});
    await textWorker.setParameters({tessedit_pageseg_mode: '3'});
    return textWorker;
  }

  /* ---------- image helpers ---------- */
  function crop(src, r, scale) {
    const sx = Math.round(r.x * src.width), sy = Math.round(r.y * src.height), sw = Math.max(1, Math.round(r.w * src.width)), sh = Math.max(1, Math.round(r.h * src.height));
    const c = document.createElement('canvas'); c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
    const x = c.getContext('2d', {willReadFrequently: true}); x.imageSmoothingQuality = 'high';
    x.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }
  function grayData(c) {
    const x = c.getContext('2d', {willReadFrequently: true}), d = x.getImageData(0, 0, c.width, c.height), p = d.data, g = new Float32Array(c.width * c.height);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = .299 * p[i] + .587 * p[i + 1] + .114 * p[i + 2];
    return {x, d, g};
  }
  /* variant: 'stretch' = percentile levels; 'bin' = local-mean binarization (handles shadows and faint pencil) */
  function variant(c, kind) {
    const o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
    const ox = o.getContext('2d', {willReadFrequently: true}); ox.drawImage(c, 0, 0);
    const {x, d, g} = grayData(o), p = d.data, w = o.width, h = o.height;
    if (kind === 'stretch') {
      const s = Float32Array.from(g).sort(), lo = s[Math.floor(s.length * .02)], hi = s[Math.floor(s.length * .7)];
      const k = 255 / Math.max(20, hi - lo);
      for (let j = 0, i = 0; j < g.length; j++, i += 4) { const v = Math.max(0, Math.min(255, (g[j] - lo) * k)); p[i] = p[i + 1] = p[i + 2] = v; }
    } else {
      const m = window.Scan.blur(g, w, h, Math.max(6, Math.round(Math.min(w, h) / 12)));
      for (let j = 0, i = 0; j < g.length; j++, i += 4) { const v = g[j] < m[j] - 14 ? 0 : 255; p[i] = p[i + 1] = p[i + 2] = v; }
    }
    x.putImageData(d, 0, 0);
    return o;
  }

  /* ---------- Eastern Arabic digit templates ---------- */
  const N = 32;
  let templates = null;
  function norm(bits, bw, bh, box) {
    const v = new Float32Array(N * N), {x0, y0, x1, y1} = box, w = x1 - x0 + 1, h = y1 - y0 + 1, s = Math.max(w, h);
    const ox = (s - w) / 2, oy = (s - h) / 2;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!bits[y * bw + x]) continue;
      const nx = Math.min(N - 1, ((x - x0 + ox) / s * N) | 0), ny = Math.min(N - 1, ((y - y0 + oy) / s * N) | 0);
      v[ny * N + nx] = 1;
    }
    // soften so near-misses still correlate
    const o = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let s2 = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < N && xx >= 0 && xx < N) s2 += v[yy * N + xx] * (dx || dy ? .3 : 1); }
      o[y * N + x] = s2;
    }
    let len = 0; for (const q of o) len += q * q; len = Math.sqrt(len) || 1;
    for (let i = 0; i < o.length; i++) o[i] /= len;
    return {v: o, ar: w / h};
  }
  /* Top 45% of a glyph, stretched to a fine 40x16 grid: where ٢ and ٣ actually differ. */
  const TW = 40, TH = 16;
  function topVec(bits, bw, box) {
    const {x0, y0, x1, y1} = box, w = x1 - x0 + 1, h = Math.max(1, Math.round((y1 - y0 + 1) * .45));
    const v = new Float32Array(TW * TH);
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x <= x1; x++) {
      if (!bits[y * bw + x]) continue;
      v[Math.min(TH - 1, ((y - y0) / h * TH) | 0) * TW + Math.min(TW - 1, ((x - x0) / w * TW) | 0)] = 1;
    }
    const o = new Float32Array(TW * TH);
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
      let s = 0; for (let d = -1; d <= 1; d++) { const xx = x + d; if (xx >= 0 && xx < TW) s += v[y * TW + xx] * (d ? .4 : 1); }
      o[y * TW + x] = s;
    }
    let len = 0; for (const q of o) len += q * q; len = Math.sqrt(len) || 1;
    for (let i = 0; i < o.length; i++) o[i] /= len;
    return o;
  }
  function twoOrThree(bits, bw, box) {
    const tv = topVec(bits, bw, box), best = {2: 0, 3: 0};
    for (const t of buildTemplates()) {
      if (!t.top) continue;
      let s = 0; for (let i = 0; i < tv.length; i++) s += tv[i] * t.top[i];
      if (s > best[t.d]) best[t.d] = s;
    }
    return {d: best[3] > best[2] ? 3 : 2, margin: Math.abs(best[3] - best[2])};
  }
  function buildTemplates() {
    if (templates) return templates;
    templates = [];
    const fonts = ['"IBM Plex Sans Arabic"', '"Readex Pro"', 'Tahoma', 'Arial', '"Segoe UI"', '"Times New Roman"', '"Traditional Arabic"', 'serif'];
    const weights = ['400', '700'];
    const c = document.createElement('canvas'); c.width = 120; c.height = 120;
    const x = c.getContext('2d', {willReadFrequently: true});
    const glyphs = [];
    for (let dg = 1; dg <= 9; dg++) glyphs.push([AR[dg], dg, 'ar']);
    for (let dg = 0; dg <= 9; dg++) glyphs.push([String(dg), dg, 'lat']);
    for (const f of fonts) for (const wt of weights) for (const [ch, dg, script] of glyphs) {
      x.fillStyle = '#fff'; x.fillRect(0, 0, 120, 120); x.fillStyle = '#000'; x.font = `${wt} 80px ${f}`; x.textBaseline = 'middle'; x.textAlign = 'center';
      x.fillText(ch, 60, 62);
      const p = x.getImageData(0, 0, 120, 120).data, bits = new Uint8Array(120 * 120);
      let x0 = 999, y0 = 999, x1 = -1, y1 = -1;
      for (let i = 0; i < bits.length; i++) if (p[i * 4] < 128) { bits[i] = 1; const xx = i % 120, yy = (i / 120) | 0; if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
      if (x1 < 0) continue;
      const t = norm(bits, 120, 120, {x0, y0, x1, y1}); t.d = dg; t.script = script;
      if (script === 'ar' && (dg === 2 || dg === 3)) t.top = topVec(bits, 120, {x0, y0, x1, y1});
      templates.push(t);
    }
    return templates;
  }
  /* Best Eastern Arabic digit, plus how well the same shape matches a Latin digit (to tell the scripts apart). */
  function classify(n) {
    let best = {d: -1, s: 0}, second = 0, lat = 0;
    const perDigit = new Float32Array(10);
    for (const t of buildTemplates()) {
      let s = 0; for (let i = 0; i < n.v.length; i++) s += n.v[i] * t.v[i];
      const arPen = Math.min(1, Math.abs(Math.log((n.ar + .05) / (t.ar + .05))) * .35);
      s -= arPen * .3;
      if (t.script === 'lat') { if (s > lat) lat = s; continue; }
      if (s > perDigit[t.d]) perDigit[t.d] = s;
    }
    let d2 = -1;
    for (let dg = 1; dg <= 9; dg++) { const s = perDigit[dg]; if (s > best.s) { second = best.s; d2 = best.d; best = {d: dg, s}; } else if (s > second) { second = s; d2 = dg; } }
    const script = best.s > lat + .02 ? 'ar' : lat > best.s + .02 ? 'lat' : 'tie';
    return {d: best.d, d2, s: best.s, margin: best.s - second, script};
  }
  /* Finds isolated digit-sized ink groups in a binarized zone.
     Returns {ar: Eastern-Arabic readings, blobs: other isolated groups worth a close-up Latin read}. */
  function arabicDigits(bin) {
    const w = bin.width, h = bin.height, p = bin.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, w, h).data;
    const bits = new Uint8Array(w * h); for (let i = 0; i < bits.length; i++) bits[i] = p[i * 4] < 128 ? 1 : 0;
    const lab = new Int32Array(w * h), q = new Int32Array(w * h), comps = [];
    let L = 0;
    for (let s = 0; s < bits.length; s++) {
      if (!bits[s] || lab[s]) continue;
      L++; let qh = 0, qt = 0; q[qt++] = s; lab[s] = L; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      while (qh < qt) {
        const pp = q[qh++], x = pp % w, y = (pp / w) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const k = yy * w + xx; if (bits[k] && !lab[k]) { lab[k] = L; q[qt++] = k; }
        }
      }
      if (qt > 2000000) break;
      comps.push({x0, y0, x1, y1, n: qt, L, w: x1 - x0 + 1, h: y1 - y0 + 1, fill: qt / ((x1 - x0 + 1) * (y1 - y0 + 1))});
    }
    // ٠ next to a digit: small, solid-ish, roughly as wide as tall (٥ is a ring with a hole, so it fills less)
    const zeroLike = (c, refH) => c.h < refH * .62 && c.fill > .5 && c.w > c.h * .45 && c.w < c.h * 1.5;
    const minH = Math.max(10, h * .022), maxH = h * .5;
    const big = comps.filter(c => c.h >= minH && c.h <= maxH && c.n >= 18 && c.w < c.h * 2.2 && c.x0 > 0 && c.x1 < w - 1);
    const dots = comps.filter(c => c.h >= 2 && c.w < c.h * 2.5 && c.n >= 4 && (c.h < minH * 1.8 || (c.fill > .5 && c.h < maxH * .5)));
    // classify big components
    for (const c of big) {
      const sub = new Uint8Array(bits.length);
      for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (lab[y * w + x] === c.L) sub[y * w + x] = 1;
      c.cls = classify(norm(sub, w, h, c));
      const pair = [c.cls.d, c.cls.d2].sort().join('');
      if (pair === '23' && c.cls.margin < .12) {
        const r = twoOrThree(sub, w, c);
        c.cls.d = r.d; c.cls.margin = r.margin > .03 ? Math.max(c.cls.margin, .05) : 0;
      }
    }
    big.sort((a, b) => a.x0 - b.x0);
    const groups = [];
    for (const c of big) {
      const g = groups[groups.length - 1], last = g && g[g.length - 1];
      const hRef = last ? Math.max(last.h, c.h) : c.h;
      const sameLine = last && Math.min(last.y1, c.y1) - Math.max(last.y0, c.y0) > Math.min(last.h, c.h) * .45;
      const zero = last && (zeroLike(c, last.h) || zeroLike(last, c.h));
      if (last && sameLine && !zero && c.x0 - last.x1 < hRef * 1.1 && Math.max(c.h, last.h) / Math.min(c.h, last.h) < 1.9) g.push(c); else groups.push([c]);
    }
    const out = [], blobs = [];
    for (const g of groups) {
      if (g.length > 3) continue;
      const gx0 = Math.min(...g.map(c => c.x0)), gx1 = Math.max(...g.map(c => c.x1)), gy0 = Math.min(...g.map(c => c.y0)), gy1 = Math.max(...g.map(c => c.y1)), gh = gy1 - gy0 + 1;
      // isolation: no other sizeable ink right next to the group on the same line
      // (a mark no bigger than an Arabic zero dot does not count)
      const near = comps.some(o => !g.includes(o) && !zeroLike(o, gh) && (o.h > gh * .5 || o.w > gh * .7) && o.n > 10 &&
        Math.min(o.y1, gy1) - Math.max(o.y0, gy0) > gh * .2 &&
        (Math.abs(o.x1 - gx0) < gh * 1.3 || Math.abs(o.x0 - gx1) < gh * 1.3) && !(o.x0 >= gx0 && o.x1 <= gx1));
      if (near) continue;
      // a number inside a line of words (a title like «تمارين ٤ و ٥») is not a page number
      const crowd = comps.some(o => !g.includes(o) && !zeroLike(o, gh) && o.h > gh * .5 && o.n > 10 &&
        Math.min(o.y1, gy1) - Math.max(o.y0, gy0) > gh * .3 && !(o.x0 >= gx0 && o.x1 <= gx1) &&
        (o.x1 < gx0 ? gx0 - o.x1 : o.x0 - gx1) < gh * 4);
      if (crowd) continue;
      const gbox = {x0: gx0 / w, y0: gy0 / h, x1: (gx1 + 1) / w, y1: (gy1 + 1) / h};
      if ((gx1 - gx0 + 1) < gh * (g.length * 1.1 + .4)) blobs.push({box: gbox, px: {x0: gx0, y0: gy0, x1: gx1, y1: gy1}});
      if (!g.every(c => c.cls.d > 0 && c.cls.s > .7 && c.cls.margin > .015)) continue;
      if (g.some(c => c.cls.script === 'lat')) continue;
      // ٠ is a small dot: allow dots between or after the digits at mid height (chained, for ١٠٠)
      const parts = g.map(c => ({x: c.x0, d: c.cls.d, s: c.cls.s}));
      let right = gx1;
      for (const dt of [...dots].sort((a, b) => a.x0 - b.x0)) {
        const cy = (dt.y0 + dt.y1) / 2;
        if (cy > gy0 + gh * .2 && cy < gy1 + gh * .15 && dt.x0 > gx0 - gh * .9 && dt.x0 < right + gh * .9 && (dt.h < gh * .5 || zeroLike(dt, gh)) && !g.some(c => dt.x0 >= c.x0 && dt.x1 <= c.x1)) {
          parts.push({x: dt.x0, d: 0, s: .8}); right = Math.max(right, dt.x1);
        }
      }
      if (parts.length > 3) continue;
      // must look Arabic, not Latin: a clearly-Arabic glyph or a ٠ dot
      if (!g.some(c => c.cls.script === 'ar') && parts.length === g.length) continue;
      // RTL script, but digits read left-to-right
      parts.sort((a, b) => a.x - b.x);
      if (parts[0].d === 0) continue;
      const v = +parts.map(t => t.d).join(''), conf = Math.min(...parts.map(t => t.s));
      // a lone ١ is easily an alif: demand more
      if (parts.length === 1 && parts[0].d === 1 && conf < .86) continue;
      out.push({v, conf: conf * 100, box: gbox});
    }
    return {ar: out, blobs};
  }

  /* Close-up read of one isolated blob: pad, enlarge to ~110px tall, single-word mode, digits only. */
  let blobWorker = null;
  async function getBlobWorker() {
    if (blobWorker) return blobWorker;
    await loadTess();
    blobWorker = await Tesseract.createWorker('eng', 1);
    await blobWorker.setParameters({tessedit_pageseg_mode: '8', tessedit_char_whitelist: '0123456789'});
    return blobWorker;
  }
  async function readBlob(bin, px) {
    const bh = px.y1 - px.y0 + 1, pad = Math.round(bh * .6), k = Math.max(1, Math.min(6, 110 / bh));
    const sw = px.x1 - px.x0 + 1 + pad * 2, sh = bh + pad * 2;
    const c = document.createElement('canvas'); c.width = Math.round(sw * k); c.height = Math.round(sh * k);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingEnabled = true;
    x.drawImage(bin, px.x0 - pad, px.y0 - pad, sw, sh, 0, 0, c.width, c.height);
    const w = await getBlobWorker(), {data} = await w.recognize(c);
    const t = (data.text || '').replace(/\s/g, '');
    if (!/^\d{1,3}$/.test(t) || t[0] === '0') return null;
    return {v: +t, conf: data.confidence};
  }

  /* ---------- Latin digits via Tesseract ---------- */
  const NUM = /^[\s\-–—_.,:;|()[\]{}«»"'*#~pPgG]*(?:page|pg|p|ص|صفحة)?\.?\s*(\d{1,3})(?:\s*[\/|\\]\s*\d{1,3})?[\s\-–—_.,:;|()[\]{}«»"'*]*$/i;
  async function latinDigits(w, canvas) {
    const {data} = await w.recognize(canvas);
    const words = (data.words || []).filter(wd => wd.text.trim()), out = [];
    for (const wd of words) {
      const m = NUM.exec(toLatin(wd.text.trim()));
      if (!m) continue;
      const v = parseInt(m[1], 10); if (!v) continue;
      const b = wd.bbox, bh = b.y1 - b.y0;
      // page numbers stand alone; a number inside a line of text (a title, an equation) is penalised
      const crowded = words.some(o => o !== wd && Math.min(o.bbox.y1, b.y1) - Math.max(o.bbox.y0, b.y0) > bh * .3 &&
        (Math.abs(o.bbox.x1 - b.x0) < bh * 2.2 || Math.abs(o.bbox.x0 - b.x1) < bh * 2.2) && o.confidence > 30);
      out.push({v, conf: wd.confidence, crowded, box: {x0: b.x0 / canvas.width, y0: b.y0 / canvas.height, x1: b.x1 / canvas.width, y1: b.y1 / canvas.height}});
    }
    return out;
  }

  function zones(pos) {
    const top = [{x: 0, y: 0, w: .36, h: .15, n: 'tl'}, {x: .3, y: 0, w: .4, h: .13, n: 'tc'}, {x: .64, y: 0, w: .36, h: .15, n: 'tr'}];
    const bot = [{x: 0, y: .85, w: .36, h: .15, n: 'bl'}, {x: .3, y: .87, w: .4, h: .13, n: 'bc'}, {x: .64, y: .85, w: .36, h: .15, n: 'br'}];
    return pos === 'top' ? top : pos === 'bottom' ? bot : [...top, ...bot];
  }

  /* Reads one page. src: canvas (unfiltered, upright). Returns {v, conf, box, sure} or null. box is normalized to src. */
  async function readPage(src, pos, onStep) {
    // handwritten notebooks: a circled number or a "lecture 25" heading at the top of the page
    if (window.Hand && pos !== 'bottom') {
      try {
        await Hand.load();
        const h = Hand.readTop(src).filter(c => !c.crossed);
        if (h.length && h[0].conf >= .3) {
          const b = h[0], rival = h.find(c => c.v !== b.v && c.kind === b.kind);
          // the net is often confident on a bad cut, so a circled number counts as sure only when the
          // different ways of separating it from the ring agree
          const sure = (b.kind === 'circle' ? b.conf >= .9 && b.agree >= .8 : b.conf >= .95) && (!rival || rival.score < b.score * .75);
          // a weak lone reading still beats the printed-text reader on handwriting (it reads strokes as "1")
          if (b.kind === 'lone' && b.conf < .4) throw 0;
          onStep && onStep(1);
          return {v: b.v, conf: 1 + b.conf, box: b.box, sure, kind: b.kind, opts: b.opts || [b.v], alt: rival ? rival.v : null, debug: h.slice(0, 4).map(c => ({v: c.v, conf: +c.conf.toFixed(2), kind: c.kind}))};
        }
      } catch (e) { if (e) console.warn(e); }
    }
    const w = await getDigitWorker();
    const cands = [];
    const add = (c, z, how) => {
      const box = {x0: z.x + c.box.x0 * z.w, y0: z.y + c.box.y0 * z.h, x1: z.x + c.box.x1 * z.w, y1: z.y + c.box.y1 * z.h};
      if (box.y1 - box.y0 > .09) return; // too big to be a page number
      // a 1-3 digit number has a narrow box; a wide one is a misread word
      const bw = (box.x1 - box.x0) * src.width, bh = (box.y1 - box.y0) * src.height, digits = String(c.v).length;
      if (bw > bh * (digits * .85 + .5)) return;
      // corner and edge positions are where page numbers live
      const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
      const edge = Math.max(Math.abs(cx - .5) * 2, Math.abs(cy - .5) * 2);
      const sc = c.conf / 100 + edge * .35 + (z.n[0] === 't' ? .08 : 0) - (c.crowded ? .55 : 0);
      cands.push({v: c.v, sc, box, how});
    };
    const overlap = (a, b) => {
      const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (ix <= 0 || iy <= 0) return 0;
      return ix * iy / Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
    };
    const tally = () => {
      // where the Arabic matcher is confident, a Latin reading of the same spot is a misread (١٥ -> "10")
      const ar = cands.filter(c => c.how === 'ar' && c.sc > 1.1);
      const votes = new Map();
      for (const c of cands) {
        let v = c.v, sc = c.sc;
        if (c.how === 'lat') { const a = ar.find(a => overlap(a.box, c.box) > .4); if (a && a.v !== c.v) { v = a.v; sc *= .8; } }
        const e = votes.get(v) || {v, score: 0, hits: 0, best: 0, box: null, how: new Set()};
        e.score += sc; e.hits++; e.how.add(c.how);
        if (sc > e.best) { e.best = sc; e.box = c.box; }
        votes.set(v, e);
      }
      return [...votes.values()].sort((a, b) => b.score - a.score);
    };
    const zs = zones(pos);
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i], zw = z.w * src.width, scale = Math.max(1.5, Math.min(4, 1500 / zw));
      const base = crop(src, z, scale);
      for (const kind of ['stretch', 'bin']) {
        const v = variant(base, kind);
        const lat = await latinDigits(w, v);
        for (const c of lat) add(c, z, 'lat');
        if (kind !== 'bin') continue;
        const {ar, blobs} = arabicDigits(v);
        for (const c of ar) add(c, z, 'ar');
        // close-up reads of small isolated marks the full-zone pass did not explain
        const seen = [...lat, ...ar].map(c => c.box);
        const todo = blobs.filter(b => !seen.some(s => overlap(s, b.box) > .3))
          .sort((a, b) => Math.abs(b.box.x0 + b.box.x1 - 1) - Math.abs(a.box.x0 + a.box.x1 - 1)).slice(0, 4);
        for (const b of todo) {
          try { const r = await readBlob(v, b.px); if (r) add({v: r.v, conf: r.conf * .9, box: b.box}, z, 'blob'); } catch (e) {}
        }
      }
      onStep && onStep((i + 1) / zs.length);
      // early exit once the top zones give a strong, repeated answer
      const top = tally()[0];
      if (top && top.hits >= 2 && top.best > 1.15 && i >= 2 && pos !== 'bottom') break;
    }
    const ranked = tally();
    if (!ranked.length) return null;
    const best = ranked[0], second = ranked[1];
    if (best.score < .55) return null;
    const sure = ((best.hits >= 2 && best.best > .95) || best.best > 1.2) && (!second || best.score > second.score * 1.6);
    return {v: best.v, conf: best.score, box: best.box, sure, alt: second ? second.v : null,
      debug: ranked.slice(0, 4).map(r => ({v: r.v, score: +r.score.toFixed(2), hits: r.hits, how: [...r.how].join('+')}))};
  }

  /* Cross-page check: duplicates and outliers get flagged and, where a common misread fits a gap, corrected. */
  // misread -> likely true digit (printed and handwritten: a flagged 1 reads as 9 or 7, a crossed 7 as 4, a Z-shaped 2 as 7)
  const CONF = {'1': '74', '7': '12', '4': '197', '0': '869', '8': '0369', '3': '85', '5': '63', '6': '508', '9': '801', '2': '7'};
  function reconcile(list) {
    const auto = list.filter(it => it.pnum != null && !it.manual);
    const all = list.filter(it => it.pnum != null);
    if (all.length < 3) return;
    const vals = all.map(it => it.pnum).sort((a, b) => a - b), med = vals[vals.length >> 1];
    const span = Math.max(4, list.length * 1.5);
    const used = new Set(all.map(it => it.pnum));
    const lo = Math.min(...vals.filter(v => Math.abs(v - med) <= span)), hi = Math.max(...vals.filter(v => Math.abs(v - med) <= span));
    const gaps = []; for (let v = lo - 1; v <= hi + 1; v++) if (v > 0 && !used.has(v)) gaps.push(v);
    const fixes = s => {
      const out = new Set();
      for (let i = 0; i < s.length; i++) for (const r of (CONF[s[i]] || '')) if (i || r !== '0' || s.length === 1) out.add(+(s.slice(0, i) + r + s.slice(i + 1)));
      if (s.length > 1) for (let i = 0; i < s.length; i++) out.add(+(s.slice(0, i) + s.slice(i + 1)));
      if (s.length === 2) out.add(+(s[1] + s[0]));
      return [...out].filter(v => v > 0);
    };
    // when many pages share numbers, the numbers mark lectures or sections rather than pages: repeats are expected
    const sureVals = all.filter(it => it.manual || !it.unsure).map(it => it.pnum);
    const repeats = sureVals.length >= 3 && (sureVals.length - new Set(sureVals).size) / sureVals.length > .15;
    if (repeats) {
      // numbers read with confidence are anchors; a doubtful page whose reading matches no anchor but whose
      // alternative reading does (a "lecture 26" heading among circled 26s) takes that alternative
      const anchors = new Map();
      for (const it of all) if (it.manual || !it.unsure) anchors.set(it.pnum, (anchors.get(it.pnum) || 0) + 1);
      for (const it of auto) {
        if (!it.popts || it.popts.length < 2) continue;
        const own = (anchors.get(it.pnum) || 0) - (it.unsure ? 0 : 1);
        if (own > 0) continue;
        const alt = it.popts.filter(v => v !== it.pnum && anchors.get(v)).sort((a, b) => anchors.get(b) - anchors.get(a))[0];
        if (alt != null) { it.palt = it.pnum; it.pnum = alt; it.unsure = true; }
      }
    }
    // pages whose number looks wrong: a duplicate of a more trusted page, or far from the rest
    const todo = [];
    for (const it of auto) {
      const dup = repeats ? [] : all.filter(o => o !== it && o.pnum === it.pnum);
      const far = Math.abs(it.pnum - med) > span;
      if (dup.length && dup.some(o => o.manual || (it.unsure && !o.unsure) || (!!o.unsure === !!it.unsure && (o.pconf || 0) > (it.pconf || 0)))) todo.push(it);
      else if (far) todo.push(it);
    }
    const ok = v => repeats ? all.some(o => o.pnum === v && !o.unsure && !todo.includes(o)) : gaps.includes(v);
    const take = (it, f) => { it.palt = it.pnum; it.pnum = f; const k = gaps.indexOf(f); if (k >= 0) gaps.splice(k, 1); };
    // first the reader's own other readings (strong evidence), then the usual digit confusions
    for (const it of todo) { const f = (it.popts || []).find(v => v !== it.pnum && ok(v)); if (f != null) { take(it, f); it.fixed = true; } }
    for (const it of todo) {
      if (!it.fixed) { const f = fixes(String(it.pnum)).find(v => v !== it.pnum && ok(v)); if (f != null) take(it, f); }
      delete it.fixed; it.unsure = true;
    }
  }

  /* Text-only PDF page (invisible text) for one page canvas. */
  async function textLayer(canvas, onProg) {
    const w = await getTextWorker(onProg);
    const k = Math.min(1, 2200 / Math.max(canvas.width, canvas.height));
    let src = canvas;
    if (k < 1) { src = document.createElement('canvas'); src.width = Math.round(canvas.width * k); src.height = Math.round(canvas.height * k); src.getContext('2d').drawImage(canvas, 0, 0, src.width, src.height); }
    const {data} = await w.recognize(src, {pdfTitle: 'rizma', pdfTextOnly: true}, {pdf: true, text: true, blocks: false, hocr: false, tsv: false});
    return {pdf: new Uint8Array(data.pdf), chars: (data.text || '').replace(/\s/g, '').length};
  }

  window.OCR = {readPage, reconcile, textLayer, getDigitWorker, getTextWorker, toLatin, arabicDigits, _variant: variant, _crop: crop};
})();

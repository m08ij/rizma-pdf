(() => {
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const FONT = '"IBM Plex Sans Arabic","Segoe UI",Tahoma,sans-serif';
const DFONT = '"Readex Pro","IBM Plex Sans Arabic","Segoe UI",Tahoma,sans-serif';
const SIZES = {A4:[210,297],A5:[148,210],B5:[176,250],Letter:[215.9,279.4],Legal:[215.9,355.6],Slide:[338.67,190.5]};
const GRIDS = ['1x1','1x2','2x1','1x3','2x2','2x3'];
const BGS = ['#ffffff','#fbf8f0','#f2f5fa','#1c2230'];
const COVERS = ['#2F5BEA','#17130A','#0E8A7B','#C2452F','#B7791F'];
const PDFLIB = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
const today = new Date().toLocaleDateString('ar', {year:'numeric', month:'long'});
const DEF = {kind:'notes',size:'A4',orient:'auto',margin:8,grid:'1x1',fit:'contain',valign:'center',gap:6,dir:'rtl',bg:'#ffffff',pattern:'none',
  border:0,radius:0,borderColor:'#c9d0db',shadow:false,coverColor:'#2F5BEA',header:'',pageNum:'center',numFmt:'n',digits:'ar',numPos:'both',
  watermark:'',wmOpacity:0.08,cover:false,coverTitle:'',coverSub:'',coverName:'',coverDate:today,skipCoverNum:true,dpi:'150',quality:0.85,
  filename:'دفتري',autoCrop:true,searchable:false};
const KEY = 'rizma-settings-v3';
let S = {...DEF};
try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };

let items = [], uid = 0, pvPage = 0, current = null;
const picked = new Set(); let anchor = null;
const AR = '٠١٢٣٤٥٦٧٨٩';
const arN = n => String(n).replace(/\d/g, d => AR[d]);
const num = n => S.digits === 'ar' ? arN(n) : String(n);
const toLatin = s => s.replace(/[٠-٩]/g, d => AR.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));

/* ---------- toast & busy ---------- */
function toast(msg, ms = 2800, action) {
  const t = document.createElement('div'); t.className = 'toast';
  const s = document.createElement('span'); s.textContent = msg; t.append(s);
  if (action) { const b = document.createElement('button'); b.textContent = action.label; b.onclick = () => { action.run(); t.remove(); }; t.append(b); }
  $('#toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, ms);
}
function busy(on, title, text, pct) {
  $('#busy').hidden = !on; if (!on) return;
  if (title) $('#busyTitle').textContent = title;
  $('#busyText').textContent = text || ''; $('#busyBar').style.width = (pct || 0) + '%';
}
const tick = () => new Promise(r => setTimeout(r, 0));
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.append(s); }); }

/* ---------- theme ---------- */
const mq = window.matchMedia('(prefers-color-scheme: dark)');
const isDarkTheme = () => (document.documentElement.dataset.theme || (mq.matches ? 'dark' : 'light')) === 'dark';
function paintThemeBtn() {
  $('#themeBtn').innerHTML = isDarkTheme()
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
}
$('#themeBtn').onclick = () => {
  const next = isDarkTheme() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('rizma-theme', next); } catch (e) {}
  paintThemeBtn();
};
mq.addEventListener && mq.addEventListener('change', paintThemeBtn);
paintThemeBtn();

/* ---------- image processing: paper warp -> rotate -> crop -> filter ---------- */
function process(it, max) {
  const img = it.img;
  let base;
  if (it.quad) base = Scan.warp(img, it.quad, max);
  else {
    const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height, k = Math.min(1, max / Math.max(sw, sh));
    base = document.createElement('canvas'); base.width = Math.max(1, Math.round(sw * k)); base.height = Math.max(1, Math.round(sh * k));
    const bx = base.getContext('2d'); bx.imageSmoothingQuality = 'high'; bx.drawImage(img, 0, 0, base.width, base.height);
  }
  const w = base.width, h = base.height, rot = ((it.rot % 360) + 360) % 360, rw = rot % 180 ? h : w, rh = rot % 180 ? w : h;
  let c1 = base;
  if (rot) { c1 = document.createElement('canvas'); c1.width = rw; c1.height = rh; const x1 = c1.getContext('2d'); x1.translate(rw / 2, rh / 2); x1.rotate(rot * Math.PI / 180); x1.drawImage(base, -w / 2, -h / 2); }
  const c = it.crop, l = Math.round(rw * c.l / 100), r = Math.round(rw * c.r / 100), t = Math.round(rh * c.t / 100), b = Math.round(rh * c.b / 100);
  const cw = Math.max(1, rw - l - r), ch = Math.max(1, rh - t - b);
  const c2 = document.createElement('canvas'); c2.width = cw; c2.height = ch;
  const x2 = c2.getContext('2d', {willReadFrequently: true}); x2.drawImage(c1, l, t, cw, ch, 0, 0, cw, ch);
  if (it.filter !== 'none' || it.bright || it.contrast) {
    const d = x2.getImageData(0, 0, cw, ch), p = d.data, B = it.bright * 1.2, C = it.contrast * 2.55, f = (259 * (C + 255)) / (255 * (259 - C)), mode = it.filter;
    for (let i = 0; i < p.length; i += 4) {
      let R = f * (p[i] - 128) + 128 + B, G = f * (p[i+1] - 128) + 128 + B, Bl = f * (p[i+2] - 128) + 128 + B;
      if (mode === 'enhance') {
        const L = .299 * R + .587 * G + .114 * Bl;
        R = 1.1 * (L + (R - L) * 1.3 - 128) + 132; G = 1.1 * (L + (G - L) * 1.3 - 128) + 132; Bl = 1.1 * (L + (Bl - L) * 1.3 - 128) + 132;
      } else if (mode !== 'none') {
        let v = .299 * R + .587 * G + .114 * Bl;
        if (mode === 'doc') { v = (v - 55) * 255 / 160; if (v > 212) v = 255; }
        else if (mode === 'bw') v = v > 150 ? 255 : 0;
        R = G = Bl = v;
      }
      p[i] = R; p[i+1] = G; p[i+2] = Bl;
    }
    x2.putImageData(d, 0, 0);
  }
  return c2;
}
const reproc = it => { it.proc = process(it, 2400); it.dirty = true; };
// geometry changed -> number position no longer valid
const resetRead = it => { if (!it.manual) { it.scanned = false; it.pbox = null; it.unsure = false; } else it.pbox = null; };

/* ---------- history (undo / redo) ---------- */
const F = ['rot','filter','bright','contrast','quad','crop','pnum','pconf','pbox','unsure','palt','phead','popts','scanned','manual'];
const snap = () => items.map(it => [it, Object.fromEntries(F.map(k => [k, clone(it[k])]))]);
let past = [], future = [];
function remember() { past.push(snap()); if (past.length > 60) past.shift(); future = []; syncHistory(); }
function restore(s) {
  items = s.map(([it, st]) => {
    const vis = ['rot','filter','bright','contrast','quad','crop'].some(k => JSON.stringify(it[k]) !== JSON.stringify(st[k]));
    Object.assign(it, clone(st)); if (vis) reproc(it); return it;
  });
  for (const id of [...picked]) if (!items.some(i => i.id === id)) picked.delete(id);
  renderGrid();
}
function undo() { if (!past.length) return; future.push(snap()); restore(past.pop()); syncHistory(); toast('تم التراجع', 1400); }
function redo() { if (!future.length) return; past.push(snap()); restore(future.pop()); syncHistory(); toast('تمت الإعادة', 1400); }
function syncHistory() { $('#undoBtn').disabled = !past.length; $('#redoBtn').disabled = !future.length; }
$('#undoBtn').onclick = undo; $('#redoBtn').onclick = redo;

/* ---------- page model ---------- */
const grid = () => S.grid.split('x').map(Number);
function buildPages() {
  const pages = []; if (S.cover) pages.push({type: 'cover'});
  const [c, r] = grid(), n = c * r;
  for (let i = 0; i < items.length; i += n) pages.push({type: 'imgs', items: items.slice(i, i + n)});
  if (!pages.length) pages.push({type: 'empty'});
  return pages;
}
const headerH = () => S.header.trim() ? 9 : 0;
const footerH = () => S.pageNum !== 'none' ? 8 : 0;
function pageDims(page) {
  const [c, r] = grid(), single = c * r === 1, it = page.type === 'imgs' && page.items[0];
  if (S.size === 'fit' && single && it) {
    const m = +S.margin, cw = 210 - 2 * m;
    return [210, Math.max(60, cw * it.proc.height / it.proc.width + 2 * m + headerH() + footerH())];
  }
  const base = SIZES[S.size] || SIZES.A4, lg = Math.max(...base), sm = Math.min(...base);
  let land;
  if (S.orient === 'portrait') land = false;
  else if (S.orient === 'landscape') land = true;
  else if (S.size === 'Slide') land = !(single && it && it.proc.height > it.proc.width * 1.05);
  else if (single && it) land = it.proc.width > it.proc.height * 1.05;
  else land = c > r;
  return land ? [lg, sm] : [sm, lg];
}
function pageLabel(i, total) {
  const off = S.cover && S.skipCoverNum ? 1 : 0, n = i + 1 - off, N = total - off;
  if (off && i === 0) return '';
  return {n: num(n), dash: '— ' + num(n) + ' —', of: num(n) + ' / ' + num(N), page: 'صفحة ' + num(n) + ' من ' + num(N)}[S.numFmt];
}
const isDark = hex => { const v = parseInt(hex.slice(1), 16); return (.299 * (v >> 16) + .587 * (v >> 8 & 255) + .114 * (v & 255)) < 110; };
function rr(x, X, Y, W, H, R) { x.beginPath(); if (R > 0 && x.roundRect) x.roundRect(X, Y, W, H, Math.min(R, W / 2, H / 2)); else x.rect(X, Y, W, H); }
function wrap(x, text, maxW) {
  const words = text.split(/\s+/), lines = []; let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (x.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line); return lines;
}
function renderPage(cv, page, idx, total, pxmm) {
  const [W, H] = pageDims(page);
  cv.width = Math.round(W * pxmm); cv.height = Math.round(H * pxmm);
  const x = cv.getContext('2d'); x.setTransform(pxmm, 0, 0, pxmm, 0, 0); x.imageSmoothingQuality = 'high';
  const dark = isDark(S.bg), ink = dark ? '#e8ecf2' : '#1b2330', soft = dark ? 'rgba(232,236,242,.6)' : 'rgba(27,35,48,.55)';
  x.fillStyle = S.bg; x.fillRect(0, 0, W, H);
  const pc = dark ? 'rgba(140,170,230,.22)' : 'rgba(60,110,200,.2)';
  x.lineWidth = .2; x.strokeStyle = pc; x.fillStyle = pc;
  if (S.pattern === 'lines') {
    for (let y = 22; y < H - 6; y += 8) { x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); }
    x.strokeStyle = 'rgba(210,70,70,.45)'; x.lineWidth = .3; const mx = S.dir === 'rtl' ? W - 18 : 18;
    x.beginPath(); x.moveTo(mx, 0); x.lineTo(mx, H); x.stroke();
  } else if (S.pattern === 'grid') {
    for (let y = 5; y < H; y += 5) { x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); }
    for (let X = 5; X < W; X += 5) { x.beginPath(); x.moveTo(X, 0); x.lineTo(X, H); x.stroke(); }
  } else if (S.pattern === 'dots') {
    for (let y = 5; y < H; y += 5) for (let X = 5; X < W; X += 5) { x.beginPath(); x.arc(X, y, .28, 0, 7); x.fill(); }
  }
  x.direction = 'rtl';
  const m = +S.margin, hh = headerH(), fh = footerH(), inset = Math.max(m, 7), mn = Math.min(W, H);
  if (page.type === 'cover') {
    const band = H * .38, cc = S.coverColor, onC = isDark(cc) ? '#fff' : '#17130A';
    x.fillStyle = cc; x.fillRect(0, 0, W, band);
    x.textAlign = 'right'; const R = W - inset - 6, maxW = W - 2 * inset - 12;
    x.fillStyle = onC; x.globalAlpha = .8; x.font = `500 ${mn * .028}px ${FONT}`;
    if (S.coverSub) x.fillText(S.coverSub, R, band * .3);
    x.globalAlpha = 1; const ts = mn * .075; x.font = `700 ${ts}px ${DFONT}`;
    const lines = wrap(x, S.coverTitle || 'عنوان الملف', maxW).slice(0, 3);
    lines.forEach((ln, i) => x.fillText(ln, R, band - inset - 4 - (lines.length - 1 - i) * ts * 1.25));
    x.fillStyle = ink; x.font = `600 ${mn * .034}px ${FONT}`;
    let y = band + mn * .1;
    if (S.coverName) { x.fillText(S.coverName, R, y); y += mn * .055; }
    x.fillStyle = soft; x.font = `400 ${mn * .026}px ${FONT}`;
    if (S.coverDate) x.fillText(S.coverDate, R, y);
    x.fillStyle = cc; x.fillRect(R - 24, y + 8, 24, 1.2);
    x.fillStyle = soft; x.font = `400 ${mn * .022}px ${FONT}`;
    x.fillText(num(total - 1) + ' صفحة', R, H - inset - 4);
  } else if (page.type === 'empty') {
    x.fillStyle = soft; x.textAlign = 'center'; x.font = `500 ${W * .035}px ${FONT}`;
    x.fillText('أضف صوراً لتظهر هنا', W / 2, H / 2);
  } else {
    if (hh) {
      x.fillStyle = soft; x.font = `500 3.6px ${FONT}`; x.textAlign = S.dir === 'rtl' ? 'right' : 'left';
      x.fillText(S.header, S.dir === 'rtl' ? W - inset : inset, Math.max(m, 4) + 5);
      x.strokeStyle = dark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.14)'; x.lineWidth = .25;
      x.beginPath(); x.moveTo(inset, Math.max(m, 4) + 7.2); x.lineTo(W - inset, Math.max(m, 4) + 7.2); x.stroke();
    }
    const top = hh ? Math.max(m, 4) + hh : m, bottom = H - (fh ? Math.max(m, 3) + fh : m);
    const bw = W - 2 * m, bh = Math.max(10, bottom - top);
    const [cols, rows] = grid(), g = +S.gap, cw = (bw - (cols - 1) * g) / cols, ch = (bh - (rows - 1) * g) / rows;
    page.items.forEach((it, i) => {
      let c = i % cols; const r = Math.floor(i / cols); if (S.dir === 'rtl') c = cols - 1 - c;
      placeImg(x, it.proc, m + c * (cw + g), top + r * (ch + g), cw, ch, pxmm);
    });
  }
  if (S.watermark.trim() && page.type !== 'empty') {
    x.save(); x.translate(W / 2, H / 2); x.rotate(-Math.atan2(H, W)); x.globalAlpha = +S.wmOpacity;
    x.fillStyle = dark ? '#fff' : '#000'; x.textAlign = 'center'; x.textBaseline = 'middle';
    let fs = mn * .14; x.font = `700 ${fs}px ${DFONT}`;
    const tw = x.measureText(S.watermark).width, lim = Math.hypot(W, H) * .75; if (tw > lim) { fs *= lim / tw; x.font = `700 ${fs}px ${DFONT}`; }
    x.fillText(S.watermark, 0, 0); x.restore();
  }
  if (fh && page.type !== 'empty') {
    const lbl = pageLabel(idx, total);
    if (lbl) {
      x.fillStyle = soft; x.font = `500 3.4px ${FONT}`; x.textBaseline = 'middle';
      x.textAlign = {center: 'center', right: 'right', left: 'left'}[S.pageNum];
      x.fillText(lbl, S.pageNum === 'center' ? W / 2 : S.pageNum === 'right' ? W - inset : inset, H - Math.max(m, 3) - fh / 2 + 1);
      x.textBaseline = 'alphabetic';
    }
  }
  return [W, H];
}
function placeImg(x, src, cx, cy, cw, ch, pxmm) {
  const iw = src.width, ih = src.height; let dx, dy, dw, dh, box;
  if (S.fit === 'stretch') { dx = cx; dy = cy; dw = cw; dh = ch; box = [cx, cy, cw, ch]; }
  else if (S.fit === 'cover') { const k = Math.max(cw / iw, ch / ih); dw = iw * k; dh = ih * k; dx = cx + (cw - dw) / 2; dy = cy + (ch - dh) / 2; box = [cx, cy, cw, ch]; }
  else {
    const k = Math.min(cw / iw, ch / ih); dw = iw * k; dh = ih * k; dx = cx + (cw - dw) / 2;
    dy = S.valign === 'top' ? cy : S.valign === 'bottom' ? cy + ch - dh : cy + (ch - dh) / 2; box = [dx, dy, dw, dh];
  }
  const R = +S.radius;
  if (S.shadow) { x.save(); x.shadowColor = 'rgba(0,0,0,.22)'; x.shadowBlur = 2.2 * pxmm; x.shadowOffsetY = .6 * pxmm; x.fillStyle = S.bg; rr(x, ...box, R); x.fill(); x.restore(); }
  x.save(); rr(x, ...box, R); x.clip(); x.drawImage(src, dx, dy, dw, dh); x.restore();
  if (+S.border > 0) { x.save(); x.lineWidth = +S.border; x.strokeStyle = S.borderColor; rr(x, ...box, R); x.stroke(); x.restore(); }
}

/* ---------- preview ---------- */
let pvQueued = false, lastDir = 0;
function schedulePreview() { if (pvQueued) return; pvQueued = true; const run = () => { if (!pvQueued) return; pvQueued = false; drawPreview(); }; requestAnimationFrame(run); setTimeout(run, 120); }
function drawPreview() {
  const pages = buildPages(); pvPage = Math.max(0, Math.min(pvPage, pages.length - 1));
  const page = pages[pvPage], [W, H] = pageDims(page), cv = $('#pv');
  const stage = cv.parentElement, availW = Math.max(180, stage.clientWidth - 32), availH = Math.min(420, Math.max(240, window.innerHeight * .42));
  const scale = Math.min(availW / W, availH / H), dpr = Math.min(2, window.devicePixelRatio || 1);
  renderPage(cv, page, pvPage, pages.length, scale * dpr);
  cv.style.width = Math.round(W * scale) + 'px'; cv.style.height = Math.round(H * scale) + 'px';
  if (lastDir) { cv.classList.remove('flip-n', 'flip-p'); void cv.offsetWidth; cv.classList.add(lastDir > 0 ? 'flip-n' : 'flip-p'); lastDir = 0; }
  $('#pvLabel').textContent = arN(pvPage + 1) + ' / ' + arN(pages.length);
  $('#pvSize').textContent = arN(Math.round(W)) + ' × ' + arN(Math.round(H)) + ' مم';
  $('#pvPrev').disabled = pvPage === 0; $('#pvNext').disabled = pvPage >= pages.length - 1;
  const real = pages.filter(p => p.type !== 'empty').length;
  $('#exportLbl').textContent = $('#exportFabLbl').textContent = real && items.length ? `تنزيل PDF (${arN(real)} صفحة)` : 'تنزيل PDF';
}
$('#pvNext').onclick = () => { lastDir = 1; pvPage++; drawPreview(); };
$('#pvPrev').onclick = () => { lastDir = -1; pvPage--; drawPreview(); };
window.addEventListener('resize', schedulePreview);

/* ---------- cards ---------- */
const ICON = {
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
  rot: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>',
  dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  del: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  check: '<path d="M5 12l5 5 9-10"/>'
};
const svg = (p, sw = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
function drawThumb(it, el) {
  const cv = el.querySelector('canvas'), p = it.proc, k = Math.min(280 / p.width, 360 / p.height);
  cv.width = Math.max(1, Math.round(p.width * k)); cv.height = Math.max(1, Math.round(p.height * k));
  const x = cv.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(p, 0, 0, cv.width, cv.height);
  it.dirty = false;
}
function syncHit(it, el) {
  const hit = el.querySelector('.hit');
  if (!it.pbox) { hit.innerHTML = ''; return; }
  const b = it.pbox, pad = .01;
  hit.innerHTML = `<i class="${it.unsure ? 'unsure' : ''}" style="left:${(b.x0 - pad) * 100}%;top:${(b.y0 - pad) * 100}%;width:${(b.x1 - b.x0 + 2 * pad) * 100}%;height:${(b.y1 - b.y0 + 2 * pad) * 100}%"></i>`;
}
function makeCard(it) {
  const el = document.createElement('div'); el.className = 'card'; el.dataset.id = it.id; el.tabIndex = 0;
  el.innerHTML = `<div class="thumb"><div class="frame"><canvas></canvas><div class="hit"></div></div>${it.sample ? '<span class="tag">مثال</span>' : ''}</div>
    <span class="badge"></span><button class="pick" data-a="pick" aria-label="تحديد">${svg(ICON.check, 3)}</button>
    <div class="meta"><span class="nm"></span></div>
    <div class="acts"><button data-a="edit" title="تعديل">${svg(ICON.edit)}</button><button data-a="rot" title="تدوير">${svg(ICON.rot)}</button><button data-a="dup" title="تكرار">${svg(ICON.dup)}</button><button data-a="del" class="del" title="حذف">${svg(ICON.del)}</button></div>`;
  el.querySelector('.nm').textContent = it.name; el.querySelector('.nm').title = it.name;
  drawThumb(it, el);
  return el;
}
function syncChip(it, el) {
  const meta = el.querySelector('.meta'); let chip = meta.querySelector('.pnum');
  if (!it.scanned && it.pnum == null) { if (chip) chip.remove(); return; }
  if (meta.querySelector('.pnum-in')) return;
  if (!chip) { chip = document.createElement('button'); chip.dataset.a = 'pnum'; meta.append(chip); }
  chip.className = 'pnum ' + (it.pnum == null ? 'miss' : it.unsure ? 'unsure' : 'found');
  chip.textContent = it.pnum != null ? 'ص ' + arN(it.pnum) + (it.unsure ? '؟' : '') : 'بلا رقم؟';
  chip.title = it.unsure ? 'غير متأكد من هذا الرقم' + (it.palt ? ` (قرأته ${arN(it.palt)})` : '') + '. اضغط لتصحيحه' : 'رقم الصفحة المكتوب على الصورة. اضغط لتعديله';
}
function renderGrid() {
  const g = $('#grid'), have = new Map([...g.children].map(e => [e.dataset.id, e]));
  const els = items.map((it, i) => {
    let el = have.get(String(it.id)); if (!el) el = makeCard(it); else if (it.dirty) drawThumb(it, el); have.delete(String(it.id));
    el.querySelector('.badge').textContent = arN(i + 1);
    el.classList.toggle('cur', current === it.id);
    el.classList.toggle('picked', picked.has(it.id));
    syncChip(it, el); syncHit(it, el);
    return el;
  });
  have.forEach(e => e.remove());
  els.forEach((e, i) => { if (g.children[i] !== e) g.insertBefore(e, g.children[i] || null); });
  $('#empty').hidden = items.length > 0;
  const pages = buildPages().filter(p => p.type !== 'empty').length;
  $('#count').innerHTML = `${arN(items.length)} صورة<small>${items.length ? arN(pages) + ' صفحة' : ''}</small>`;
  $('#sampleBanner').hidden = !items.some(i => i.sample);
  $('#autoSort').disabled = items.length < 2;
  $('#scanAll').checked = items.length > 0 && items.every(i => i.filter === 'doc');
  $('#cropAll').checked = !!S.autoCrop;
  g.classList.toggle('selecting', picked.size > 0);
  $('#selbar').hidden = picked.size === 0;
  $('#selCount').textContent = arN(picked.size) + ' محددة';
  syncHistory();
  schedulePreview();
}
const byId = id => items.find(i => i.id === +id);
function jumpTo(it) {
  const per = grid()[0] * grid()[1], p = Math.floor(items.indexOf(it) / per) + (S.cover ? 1 : 0);
  lastDir = p > pvPage ? 1 : p < pvPage ? -1 : 0; pvPage = p; current = it.id;
  $$('.card').forEach(c => c.classList.toggle('cur', c.dataset.id == it.id)); drawPreview();
}
function togglePick(it, range) {
  if (range && anchor != null) {
    const a = items.findIndex(i => i.id === anchor), b = items.indexOf(it);
    if (a >= 0) { for (let i = Math.min(a, b); i <= Math.max(a, b); i++) picked.add(items[i].id); renderGrid(); return; }
  }
  if (picked.has(it.id)) picked.delete(it.id); else picked.add(it.id);
  anchor = it.id; renderGrid();
}
function editNum(it, chip) {
  const inp = document.createElement('input'); inp.type = 'text'; inp.inputMode = 'numeric'; inp.className = 'pnum-in';
  inp.value = it.pnum != null ? it.pnum : ''; inp.placeholder = 'رقم'; inp.setAttribute('aria-label', 'رقم الصفحة');
  chip.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = ok => {
    if (done) return; done = true;
    if (ok) {
      const v = parseInt(toLatin(inp.value), 10), nv = isNaN(v) ? null : v;
      if (nv !== it.pnum || it.unsure) { remember(); it.pnum = nv; it.scanned = true; it.manual = true; it.unsure = false; }
    }
    inp.remove(); renderGrid();
  };
  inp.onkeydown = e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation(); };
  inp.onblur = () => finish(true);
  inp.onclick = e => e.stopPropagation();
}
function removeItems(list) {
  if (!list.length) return;
  remember();
  const ids = new Set(list.map(i => i.id));
  items = items.filter(i => !ids.has(i.id)); ids.forEach(id => picked.delete(id));
  if (ids.has(current)) current = null;
  renderGrid();
  toast(list.length > 1 ? `حُذفت ${arN(list.length)} صور` : 'حُذفت الصورة', 3500, {label: 'تراجع', run: undo});
}
$('#grid').addEventListener('click', e => {
  const card = e.target.closest('.card'); if (!card) return; const it = byId(card.dataset.id), a = e.target.closest('[data-a]')?.dataset.a;
  if (a === 'pick') return togglePick(it, e.shiftKey);
  if (a === 'pnum') return editNum(it, e.target.closest('.pnum'));
  if (a === 'edit') return openEditor(it);
  if (a === 'rot') {
    remember(); it.rot = (it.rot + 90) % 360; reproc(it); resetRead(it); renderGrid();
    card.querySelector('canvas').animate([{transform: 'rotate(-90deg) scale(.85)'}, {transform: 'none'}], {duration: 300, easing: 'ease-out'});
    return;
  }
  if (a === 'dup') { remember(); const cp = {...it, id: ++uid, crop: {...it.crop}, quad: clone(it.quad), sample: false}; items.splice(items.indexOf(it) + 1, 0, cp); renderGrid(); toast('تم تكرار الصورة'); return; }
  if (a === 'del') return removeItems([it]);
  if (e.ctrlKey || e.metaKey || e.shiftKey || picked.size) return togglePick(it, e.shiftKey);
  jumpTo(it);
});
$('#grid').addEventListener('dblclick', e => { const card = e.target.closest('.card'); if (card && !e.target.closest('[data-a]')) openEditor(byId(card.dataset.id)); });
$('#grid').addEventListener('keydown', e => {
  if (e.target.classList.contains('pnum-in')) return;
  const card = e.target.closest('.card'); if (!card || e.target !== card) return; const it = byId(card.dataset.id);
  if (e.key === 'Enter') openEditor(it);
  if (e.key === ' ') { e.preventDefault(); togglePick(it); }
});
if (window.Sortable) Sortable.create($('#grid'), {animation: 200, easing: 'cubic-bezier(.2,1,.3,1)', ghostClass: 'ghost-card', chosenClass: 'chosen-card',
  filter: 'button, input', preventOnFilter: false, delay: 140, delayOnTouchOnly: true,
  onStart() { remember(); },
  onEnd(ev) {
    if (ev.oldIndex === ev.newIndex) { past.pop(); syncHistory(); return; }
    const ids = [...$('#grid').children].map(e => +e.dataset.id); items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)); renderGrid();
  }});

/* selection bar */
$('#selbar').addEventListener('click', async e => {
  const k = e.target.closest('[data-sel]')?.dataset.sel; if (!k) return;
  const sel = items.filter(i => picked.has(i.id));
  if (k === 'all') { items.forEach(i => picked.add(i.id)); return renderGrid(); }
  if (k === 'none') { picked.clear(); return renderGrid(); }
  if (k === 'del') return removeItems(sel);
  remember();
  if (k === 'first' || k === 'last') { const rest = items.filter(i => !picked.has(i.id)); items = k === 'first' ? [...sel, ...rest] : [...rest, ...sel]; renderGrid(); return; }
  await eachWithProgress(sel, it => {
    if (k === 'rot') { it.rot = (it.rot + 90) % 360; resetRead(it); }
    if (k === 'doc') it.filter = 'doc';
    if (k === 'orig') it.filter = 'none';
  }, 'تعديل الصور المحددة…');
});

/* ---------- adding files ---------- */
function loadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.decoding = 'async'; im.onload = () => res(im); im.onerror = rej; im.src = src; }); }
const newItem = (name, img, extra) => ({id: ++uid, name, img, rot: 0, filter: 'none', bright: 0, contrast: 0, crop: {t:0,r:0,b:0,l:0}, quad: null,
  date: Date.now(), pnum: null, pconf: 0, pbox: null, unsure: false, palt: null, scanned: false, manual: false, ...extra});
async function addFiles(list) {
  const files = [...list].filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name));
  if (!files.length) { toast('لم أجد صوراً في ما أضفته'); return; }
  remember();
  if (items.some(i => i.sample)) items = items.filter(i => !i.sample);
  const scan = S.kind === 'notes';
  busy(true, 'جارٍ إضافة الصور…', '', 0); await tick();
  let bad = 0, cropped = 0, turned = 0;
  // handwritten pages photographed sideways or upside down are turned upright (not for slides)
  let orient = S.kind !== 'slides' && window.Hand;
  if (orient) { try { await Hand.load(); } catch (e) { orient = false; } }
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    try {
      const im = await loadImg(URL.createObjectURL(f));
      const it = newItem(f.name || 'صورة.png', im, {date: f.lastModified || Date.now(), filter: scan ? 'doc' : 'none'});
      if (S.autoCrop) { it.quad = Scan.detect(im); if (it.quad) cropped++; }
      if (orient) { try { const r = Hand.orient(it.quad ? Scan.warp(im, it.quad, 1400) : im); if (r) { it.rot = r; turned++; } } catch (e) { console.warn(e); } }
      reproc(it); items.push(it);
    } catch (e) { bad++; console.error(e); }
    busy(true, null, arN(i + 1) + ' من ' + arN(files.length), (i + 1) / files.length * 100); await tick();
  }
  busy(false); renderGrid();
  if (bad) toast(`تعذّر فتح ${arN(bad)} صورة. إذا كانت من آيفون (HEIC) حوّلها إلى JPG أولاً`, 5200);
  else toast(`أضيفت ${arN(files.length)} صورة` + (cropped ? `، وقُصّت الورقة في ${arN(cropped)}` : '') + (turned ? `، ودُوّرت ${arN(turned)} كانت مقلوبة` : ''), 3600);
}
const pickFiles = () => $('#file').click();
$('#addTop').onclick = pickFiles; $('#empty').onclick = pickFiles;
$('#empty').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFiles(); } };
$('#file').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
let dragN = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragN++; $('#drop').classList.add('show'); });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--dragN <= 0) { dragN = 0; $('#drop').classList.remove('show'); } });
window.addEventListener('drop', e => { if (!hasFiles(e)) return; e.preventDefault(); dragN = 0; $('#drop').classList.remove('show'); addFiles(e.dataTransfer.files); });
window.addEventListener('paste', e => {
  if (e.target.matches && e.target.matches('input')) return;
  const fs = [...(e.clipboardData?.items || [])].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
  if (fs.length) { e.preventDefault(); addFiles(fs); }
});

/* ---------- toolbar ---------- */
$('#sortBtn').onclick = e => { e.stopPropagation(); $('#sortPop').hidden = !$('#sortPop').hidden; };
document.addEventListener('click', () => { $('#sortPop').hidden = true; });
$('#sortPop').addEventListener('click', e => {
  const k = e.target.dataset.sort; if (!k) return;
  if (k === 'rescan') { remember(); items.forEach(i => { if (!i.manual) { i.scanned = false; i.pnum = null; i.pbox = null; i.unsure = false; } }); autoSort(); return; }
  remember();
  if (k === 'name') items.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'}));
  else if (k === 'date') items.sort((a, b) => a.date - b.date); else items.reverse();
  renderGrid(); toast('تمت إعادة الترتيب');
});
$('#clearAll').onclick = () => {
  if (!items.length) return;
  remember(); items = []; picked.clear(); current = null; renderGrid();
  toast('حُذفت كل الصور', 4000, {label: 'تراجع', run: undo});
};
$('#dropSamples').onclick = () => { remember(); items = items.filter(i => !i.sample); renderGrid(); };
async function eachWithProgress(list, fn, label) {
  if (!list.length) return;
  busy(true, label, '', 0);
  for (let i = 0; i < list.length; i++) { fn(list[i]); reproc(list[i]); busy(true, null, arN(i + 1) + ' من ' + arN(list.length), (i + 1) / list.length * 100); await tick(); }
  busy(false); renderGrid();
}
$('#scanAll').onchange = e => { const on = e.target.checked; remember(); eachWithProgress(items, it => { it.filter = on ? 'doc' : 'none'; }, on ? 'تحسين الصور…' : 'إرجاع الألوان الأصلية…'); };
$('#cropAll').onchange = async e => {
  S.autoCrop = e.target.checked; save(); remember();
  let n = 0;
  await eachWithProgress(items, it => { const q = S.autoCrop ? Scan.detect(it.img) : null; if (JSON.stringify(q) !== JSON.stringify(it.quad)) resetRead(it); it.quad = q; if (q) n++; }, S.autoCrop ? 'البحث عن حواف الورقة…' : 'إرجاع الصور كاملة…');
  if (S.autoCrop && items.length) toast(n ? `قُصّت الورقة في ${arN(n)} من ${arN(items.length)} صورة. عدّل الزوايا من المحرر إذا لزم` : 'لم أجد ورقة واضحة لقصها، الصور تملأ الإطار أصلاً', 4200);
};
$('#numOn').onchange = e => set('pageNum', e.target.checked ? (S.pageNum !== 'none' ? S.pageNum : 'center') : 'none');

/* keyboard */
document.addEventListener('keydown', e => {
  const typing = e.target.matches && e.target.matches('input, select, textarea');
  if (e.key === 'Escape') {
    if (!$('#editor').hidden) return closeEditor();
    if (!$('#drawer').hidden) return closeAdv();
    if (picked.size) { picked.clear(); renderGrid(); }
    return;
  }
  if (typing || !$('#editor').hidden) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  else if (mod && e.key.toLowerCase() === 'a' && items.length) { e.preventDefault(); items.forEach(i => picked.add(i.id)); renderGrid(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && picked.size) { e.preventDefault(); removeItems(items.filter(i => picked.has(i.id))); }
  else if (e.key === 'Delete') { const it = byId(document.activeElement?.dataset?.id); if (it) removeItems([it]); }
});

/* ---------- page-number reading ---------- */
function sortByPnum() {
  let prev = -1;
  const keyed = items.map((it, i) => { const k = it.pnum != null ? it.pnum : prev + .001 * (i + 1); if (it.pnum != null) prev = it.pnum; return [k, i, it]; });
  // same number: the page that opens the section ("lecture 25") goes first
  keyed.sort((a, b) => a[0] - b[0] || (b[2].phead ? 1 : 0) - (a[2].phead ? 1 : 0) || a[1] - b[1]);
  items = keyed.map(k => k[2]);
}
async function autoSort() {
  const todo = items.filter(i => !i.scanned);
  if (todo.length) {
    busy(true, 'تحميل قارئ الأرقام…', 'أول مرة فقط', 2);
    try { await OCR.getDigitWorker(m => { if (/load|init/i.test(m.status)) busy(true, null, 'تحميل قارئ الأرقام… ' + arN(Math.round(m.progress * 100)) + '٪', 2 + m.progress * 6); }); }
    catch (e) { busy(false); toast('تعذّر تحميل قارئ الأرقام. تأكد من اتصال الإنترنت، أو اكتب الأرقام يدوياً تحت كل صورة', 6000); console.error(e); return; }
    for (let i = 0; i < todo.length; i++) {
      const it = todo[i], thumb = $(`.card[data-id="${it.id}"] .thumb`);
      const sl = document.createElement('div'); sl.className = 'scanline'; thumb && thumb.append(sl);
      const base = 8 + i / todo.length * 92;
      busy(true, 'أقرأ أرقام الصفحات…', 'صورة ' + arN(i + 1) + ' من ' + arN(todo.length), base);
      try {
        const src = process({...it, filter: 'none', bright: 0, contrast: 0}, 2400);
        const r = await OCR.readPage(src, S.numPos, f => busy(true, null, 'صورة ' + arN(i + 1) + ' من ' + arN(todo.length), base + f * 92 / todo.length));
        if (r) { it.pnum = r.v; it.pconf = r.conf; it.pbox = r.box; it.unsure = !r.sure; it.palt = null; it.phead = r.kind === 'heading'; it.popts = r.opts || null; } else { it.pnum = null; it.pbox = null; it.unsure = false; it.phead = false; }
      } catch (e) { it.pnum = null; console.error(e); }
      it.scanned = true; it.manual = false; sl.remove();
    }
    busy(false);
    OCR.reconcile(items);
  }
  sortByPnum(); renderGrid();
  const found = items.filter(i => i.pnum != null).length, miss = items.length - found, unsure = items.filter(i => i.unsure && i.pnum != null).length;
  let msg = `رتبت ${arN(items.length)} صفحة حسب أرقامها`;
  if (miss) msg += `. ${arN(miss)} بلا رقم`;
  if (unsure) msg += `. ${arN(unsure)} غير مؤكدة (برتقالي)`;
  if (miss || unsure) msg += '، اضغط الرقم تحت الصورة لتصحيحه';
  toast(msg, miss || unsure ? 6500 : 3200, {label: 'تراجع', run: undo});
}
$('#autoSort').onclick = () => { remember(); autoSort(); };

/* ---------- settings binding ---------- */
const fmtOut = {margin: v => arN(v) + ' مم', gap: v => arN(v) + ' مم', border: v => +v ? arN(v) + ' مم' : 'بدون', radius: v => arN(v) + ' مم', wmOpacity: v => arN(Math.round(v * 100)) + '٪', quality: v => arN(Math.round(v * 100)) + '٪'};
function syncUI() {
  $$('[data-k]').forEach(el => {
    const k = el.dataset.k;
    if (el.classList.contains('seg')) el.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(S[k])));
    else if (el.type === 'checkbox') el.checked = !!S[k];
    else if (document.activeElement !== el) el.value = S[k];
  });
  $$('[data-out]').forEach(o => { const k = o.dataset.out; o.textContent = fmtOut[k] ? fmtOut[k](S[k]) : S[k]; });
  $$('#gridpick button').forEach(b => b.classList.toggle('on', b.dataset.v === S.grid));
  $$('#bgcolors .sw').forEach(b => b.classList.toggle('on', b.dataset.c === S.bg));
  $$('#coverColors .sw').forEach(b => b.classList.toggle('on', b.dataset.c === S.coverColor));
  $$('.kind').forEach(b => b.classList.toggle('on', b.dataset.kind === S.kind));
  $('#numOn').checked = S.pageNum !== 'none';
  $('#cropAll').checked = !!S.autoCrop;
}
function set(k, v) { S[k] = v; save(); syncUI(); if (k === 'grid' || k === 'cover') renderGrid(); else schedulePreview(); }
$$('[data-k]').forEach(el => {
  const k = el.dataset.k;
  if (el.classList.contains('seg')) el.addEventListener('click', e => { const b = e.target.closest('button'); if (b) set(k, b.dataset.v); });
  else el.addEventListener('input', () => set(k, el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value));
});
GRIDS.forEach(gv => {
  const [c, r] = gv.split('x').map(Number), b = document.createElement('button'); b.dataset.v = gv; b.title = arN(c * r) + ' في الصفحة';
  b.innerHTML = `<span class="mini" style="grid-template-columns:repeat(${c},1fr);grid-template-rows:repeat(${r},1fr)">${'<span></span>'.repeat(c * r)}</span>${arN(c * r)}`;
  b.onclick = () => set('grid', gv); $('#gridpick').append(b);
});
const swatches = (box, list, key) => list.forEach(c => {
  const b = document.createElement('button'); b.className = 'sw'; b.style.background = c; b.dataset.c = c; b.setAttribute('aria-label', c);
  b.onclick = () => set(key, c); $(box).append(b);
});
swatches('#bgcolors', BGS, 'bg'); swatches('#coverColors', COVERS, 'coverColor');
const bgCustom = document.createElement('input'); bgCustom.type = 'color'; bgCustom.setAttribute('aria-label', 'لون خلفية مخصص');
bgCustom.oninput = () => set('bg', bgCustom.value); $('#bgcolors').append(bgCustom);
$('#resetSettings').onclick = () => { S = {...DEF}; save(); syncUI(); renderGrid(); toast('رجعت الإعدادات الافتراضية'); };
const openAdv = () => { $('#drawer').hidden = false; $('#scrim').hidden = false; };
const closeAdv = () => { $('#drawer').hidden = true; $('#scrim').hidden = true; };
$('#openAdv').onclick = openAdv; $('#closeAdv').onclick = closeAdv; $('#scrim').onclick = closeAdv;
$('#tabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; $$('#tabs button').forEach(x => x.classList.toggle('on', x === b)); $$('.pane').forEach(p => p.hidden = p.dataset.p !== b.dataset.t); };

/* kinds */
const KINDS = [
  {id: 'notes', name: 'دفتر جامعي', desc: 'صفحة لكل صورة، مقصوصة وممسوحة', icon: '<path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6zM6 3v18M10 8h5M10 12h5"/>',
    s: {size:'A4', orient:'auto', grid:'1x1', fit:'contain', margin:6, gap:4, border:0, radius:0, shadow:false, pageNum:'center', numFmt:'n'}, filter: 'doc', crop: true},
  {id: 'summary', name: 'تلاخيص', desc: 'صورتان في كل صفحة مع إطار', icon: '<path d="M5 4h14v7H5zM5 13h14v7H5z"/>',
    s: {size:'A4', orient:'portrait', grid:'1x2', fit:'contain', margin:10, gap:6, border:.3, radius:2, shadow:false, pageNum:'center', numFmt:'page'}},
  {id: 'slides', name: 'سلايدات', desc: 'شريحة 16:9 لكل صفحة', icon: '<rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M8 21h8M12 17v4"/>',
    s: {size:'Slide', orient:'auto', grid:'1x1', fit:'contain', margin:0, gap:0, border:0, radius:0, shadow:false, pageNum:'none'}, filter: 'none', crop: false},
  {id: 'handout', name: 'سلايدات للطباعة', desc: '٣ شرائح في ورقة A4', icon: '<path d="M6 3h12v18H6zM9 6h6v3H9zM9 11h6v3H9zM9 16h6v2H9z"/>',
    s: {size:'A4', orient:'portrait', grid:'1x3', fit:'contain', margin:12, gap:8, border:.3, radius:1.5, shadow:true, pageNum:'center', numFmt:'of'}, filter: 'none', crop: false}
];
KINDS.forEach(p => {
  const b = document.createElement('button'); b.className = 'kind'; b.dataset.kind = p.id;
  b.innerHTML = `<span class="ic">${svg(p.icon)}</span><div><b>${p.name}</b><small>${p.desc}</small></div>`;
  b.onclick = async () => {
    Object.assign(S, p.s, {kind: p.id}); if (p.crop != null) S.autoCrop = p.crop; save(); syncUI(); pvPage = 0; renderGrid();
    const needs = items.filter(i => (p.filter && i.filter !== p.filter) || (p.crop === false && i.quad) || (p.crop && !i.quad && !i.noPaper));
    if (needs.length) {
      remember();
      await eachWithProgress(needs, it => {
        if (p.filter) it.filter = p.filter;
        if (p.crop === false && it.quad) { it.quad = null; resetRead(it); }
        if (p.crop && !it.quad) { it.quad = Scan.detect(it.img); if (!it.quad) it.noPaper = true; else resetRead(it); }
      }, 'تجهيز الصور…');
    }
  };
  $('#kinds').append(b);
});

/* ---------- editor ---------- */
let edIt = null, draft = null, edQ = false, edMode = 'result';
function openEditor(it) {
  edIt = it; draft = {rot: it.rot, filter: it.filter, bright: it.bright, contrast: it.contrast, crop: {...it.crop}, quad: clone(it.quad)};
  setEdMode('result'); $('#editor').hidden = false; $('#edSave').focus();
}
function setEdMode(m) {
  edMode = m; $$('#edMode button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  $('#edSvg').hidden = m !== 'corners'; $('#edHint').hidden = m !== 'corners';
  $$('#edWrap .handle').forEach(h => h.remove());
  if (m === 'corners') {
    const q = draft.quad || [{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}, {x: 0, y: 1}];
    q.forEach((p, i) => {
      const h = document.createElement('div'); h.className = 'handle'; h.dataset.i = i; h.setAttribute('role', 'slider'); h.setAttribute('aria-label', 'زاوية ' + arN(i + 1));
      $('#edWrap').append(h);
    });
  }
  syncEditor();
}
$('#edMode').onclick = e => { const b = e.target.closest('button'); if (b) setEdMode(b.dataset.m); };
function corners() { return draft.quad || [{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}, {x: 0, y: 1}]; }
function placeHandles() {
  const q = corners();
  $$('#edWrap .handle').forEach(h => { const p = q[+h.dataset.i]; h.style.left = p.x * 100 + '%'; h.style.top = p.y * 100 + '%'; });
  $('#edPoly').setAttribute('points', q.map(p => p.x + ',' + p.y).join(' '));
}
function syncEditor() {
  $$('#edFilters button').forEach(b => b.classList.toggle('on', b.dataset.f === draft.filter));
  $('#edBright').value = draft.bright; $('#oBright').textContent = arN(draft.bright);
  $('#edContrast').value = draft.contrast; $('#oContrast').textContent = arN(draft.contrast);
  for (const s of ['t','b','r','l']) { $('#ed' + s.toUpperCase()).value = draft.crop[s]; $('#o' + s.toUpperCase()).textContent = arN(draft.crop[s]) + '٪'; }
  if (edQ) return; edQ = true;
  const draw = () => {
    if (!edQ) return; edQ = false; if (!edIt) return;
    const cv = $('#edCanvas');
    if (edMode === 'corners') {
      const img = edIt.img, sw = img.naturalWidth, sh = img.naturalHeight, k = Math.min(1, 1100 / Math.max(sw, sh));
      cv.width = Math.round(sw * k); cv.height = Math.round(sh * k); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      placeHandles();
    } else {
      const c = process({...draft, img: edIt.img}, 1100); cv.width = c.width; cv.height = c.height; cv.getContext('2d').drawImage(c, 0, 0);
    }
  };
  requestAnimationFrame(draw); setTimeout(draw, 120);
}
let drag = null;
$('#edWrap').addEventListener('pointerdown', e => {
  const h = e.target.closest('.handle'); if (!h) return;
  e.preventDefault(); h.setPointerCapture(e.pointerId); drag = {i: +h.dataset.i};
  if (!draft.quad) draft.quad = corners().map(p => ({...p}));
});
$('#edWrap').addEventListener('pointermove', e => {
  if (!drag) return;
  const r = $('#edCanvas').getBoundingClientRect();
  draft.quad[drag.i] = {x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))};
  placeHandles();
});
$('#edWrap').addEventListener('pointerup', () => { drag = null; });
$('#edWrap').addEventListener('pointercancel', () => { drag = null; });
const closeEditor = () => { $('#editor').hidden = true; edIt = null; drag = null; };
$('#edFilters').onclick = e => { const b = e.target.closest('button'); if (b) { draft.filter = b.dataset.f; syncEditor(); } };
$('#edBright').oninput = e => { draft.bright = +e.target.value; syncEditor(); };
$('#edContrast').oninput = e => { draft.contrast = +e.target.value; syncEditor(); };
for (const s of ['t','b','r','l']) $('#ed' + s.toUpperCase()).oninput = e => { draft.crop[s] = +e.target.value; syncEditor(); };
$('#edRotR').onclick = () => { draft.rot = (draft.rot + 90) % 360; syncEditor(); };
$('#edRotL').onclick = () => { draft.rot = (draft.rot + 270) % 360; syncEditor(); };
$('#edDetect').onclick = () => {
  const q = Scan.detect(edIt.img);
  if (!q) { toast('لم أجد حواف ورقة واضحة. حرّك النقاط بيدك', 3500); setEdMode('corners'); return; }
  draft.quad = q; setEdMode(edMode); toast('وجدت الورقة');
};
$('#edNoCrop').onclick = () => { draft.quad = null; setEdMode(edMode); };
$('#edReset').onclick = () => { draft = {rot: 0, filter: 'none', bright: 0, contrast: 0, crop: {t:0,r:0,b:0,l:0}, quad: null}; setEdMode(edMode); };
$('#edCancel').onclick = closeEditor;
$('#editor').addEventListener('click', e => { if (e.target.id === 'editor') closeEditor(); });
$('#edSave').onclick = () => {
  const it = edIt, geo = ['rot','crop','quad'].some(k => JSON.stringify(it[k]) !== JSON.stringify(draft[k]));
  remember();
  Object.assign(it, clone(draft)); reproc(it); if (geo) resetRead(it);
  closeEditor(); renderGrid(); jumpTo(it); toast('حُفظت التعديلات');
};

/* ---------- export ---------- */
let DL = null;
const dlReady = (async () => { try { if (window.claude && window.claude.use) DL = await window.claude.use('downloads'); } catch (e) { DL = null; } })();
async function exportPDF() {
  if (!items.length) { toast('أضف صوراً أولاً'); return; }
  if (!window.jspdf) { toast('تعذّر تحميل مكتبة PDF. تحقق من الاتصال وأعد تحميل الصفحة', 5000); return; }
  const pages = buildPages().filter(p => p.type !== 'empty'), pxmm = +S.dpi / 25.4, cv = document.createElement('canvas');
  const searchable = !!S.searchable;
  busy(true, 'جارٍ إنشاء الملف…', '', 0); await tick();
  try {
    if (searchable) {
      busy(true, 'تحميل قارئ النصوص…', 'أول مرة فقط، قد يستغرق دقيقة', 1);
      if (!window.PDFLib) await loadScript(PDFLIB);
      await OCR.getTextWorker(m => { if (/load|init/i.test(m.status)) busy(true, null, 'تحميل قارئ النصوص… ' + arN(Math.round(m.progress * 100)) + '٪', 1 + m.progress * 4); });
    }
    let doc; const layers = [];
    let chars = 0;
    for (let i = 0; i < pages.length; i++) {
      const [W, H] = renderPage(cv, pages[i], i, pages.length, pxmm), o = W > H ? 'l' : 'p';
      const data = cv.toDataURL('image/jpeg', +S.quality);
      if (!doc) doc = new jspdf.jsPDF({unit: 'mm', format: [W, H], orientation: o, compress: true}); else doc.addPage([W, H], o);
      doc.addImage(data, 'JPEG', 0, 0, W, H, undefined, 'FAST');
      if (searchable && pages[i].type === 'imgs') {
        busy(true, 'أقرأ النص لجعل الملف قابلاً للبحث…', 'صفحة ' + arN(i + 1) + ' من ' + arN(pages.length), 5 + (i + .5) / pages.length * 90);
        try { const L = await OCR.textLayer(cv); layers[i] = L.pdf; chars += L.chars; } catch (e) { console.error(e); }
      } else busy(true, null, 'صفحة ' + arN(i + 1) + ' من ' + arN(pages.length), (i + 1) / pages.length * 100);
      await tick();
    }
    doc.setProperties({title: S.coverTitle || S.filename, creator: 'رزمة'});
    let blob = doc.output('blob');
    if (searchable && layers.some(Boolean)) {
      busy(true, 'دمج طبقة النص…', '', 97); await tick();
      const pdf = await PDFLib.PDFDocument.load(await blob.arrayBuffer()), pg = pdf.getPages();
      for (let i = 0; i < pg.length; i++) {
        if (!layers[i]) continue;
        try { const [emb] = await pdf.embedPdf(layers[i]); pg[i].drawPage(emb, {x: 0, y: 0, width: pg[i].getWidth(), height: pg[i].getHeight()}); } catch (e) { console.error(e); }
      }
      blob = new Blob([await pdf.save()], {type: 'application/pdf'});
    }
    const mb = (blob.size / 1048576).toFixed(1);
    const filename = ((S.filename || 'رزمة').replace(/[\\/:*?"<>|]+/g, '').trim() || 'رزمة') + '.pdf';
    await dlReady; busy(false);
    const extra = searchable ? (chars ? '، وتقدر تبحث فيه' : '، لكن لم أجد نصاً مقروءاً') : '';
    if (DL) {
      try { await DL.save({filename, data: blob}); toast('تم حفظ ' + filename + ' (' + arN(mb) + ' م.ب)' + extra, 4000); return; }
      catch (e) { if (e && e.code === 'declined') { toast('أُلغي الحفظ'); return; } }
    }
    const a = document.createElement('a'), url = URL.createObjectURL(blob); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast('تم تنزيل ' + filename + ' (' + arN(mb) + ' م.ب)' + extra, 4000);
  } catch (e) { busy(false); toast('تعذّر إنشاء الملف. جرّب دقة أقل من الإعدادات المتقدمة', 5000); console.error(e); }
}
$('#exportBtn').onclick = exportPDF; $('#exportFab').onclick = exportPDF;

/* ---------- example pages: photographed on a desk, deliberately out of order ---------- */
function sampleCanvas(n, title, lines, digits, tilt) {
  const c = document.createElement('canvas'), x = c.getContext('2d'); c.width = 1240; c.height = 1650;
  x.fillStyle = '#5b544c'; x.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(0,0,0,${.03 + (i % 5) * .01})`; x.fillRect(0, i * 42, c.width, 20); }
  x.save(); x.translate(620, 830); x.rotate(tilt);
  const PW = 1020, PH = 1420, px = -PW / 2, py = -PH / 2;
  x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 36; x.shadowOffsetY = 10; x.fillStyle = '#f3efe4'; x.fillRect(px, py, PW, PH); x.shadowColor = 'transparent';
  x.strokeStyle = 'rgba(80,120,190,.35)'; x.lineWidth = 2; for (let y = py + 200; y < py + PH - 40; y += 58) { x.beginPath(); x.moveTo(px + 30, y); x.lineTo(px + PW - 30, y); x.stroke(); }
  x.strokeStyle = 'rgba(200,60,60,.5)'; x.beginPath(); x.moveTo(px + PW - 110, py); x.lineTo(px + PW - 110, py + PH); x.stroke();
  x.fillStyle = '#26356b'; x.font = `500 36px ${FONT}`; x.direction = 'ltr'; x.textAlign = 'left';
  x.fillText(digits === 'ar' ? arN(n) : String(n), px + 60, py + 82);
  x.direction = 'rtl'; x.textAlign = 'right'; x.fillStyle = '#1d2b5c'; x.font = `700 46px ${DFONT}`; x.fillText(title, px + PW - 140, py + 180);
  x.font = `500 32px ${FONT}`; lines.forEach((t, i) => x.fillText(t, px + PW - 140, py + 300 + i * 116));
  x.restore();
  return c;
}
async function loadSamples() {
  try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]); await document.fonts.load(`700 20px "Readex Pro"`); await document.fonts.load(`500 20px "IBM Plex Sans Arabic"`); } catch (e) {}
  if (items.length) return;
  const defs = [
    [14, 'تابع: الاتصال', ['الدالة متصلة عند a إذا:', '١) f(a) معرّفة', '٢) النهاية موجودة', '٣) النهاية = f(a)'], 'en', .025],
    [12, 'المحاضرة ٣ — النهايات', ['تعريف: نهاية الدالة عند a تساوي L', 'إذا اقتربت f(x) من L كلما اقترب x من a', 'مثال: lim (x² − 1)/(x − 1) = 2'], 'en', -.03],
    [15, 'أمثلة محلولة', ['مثال ١: ابحث في اتصال الدالة', 'f(x) = |x| عند x = 0', 'الحل: النهاية من اليمين = اليسار = 0'], 'ar', .018],
    [13, 'النهايات عند اللانهاية', ['lim 1/x = 0 عندما x → ∞', 'نقسم على أعلى قوة في المقام', 'واجب: تمارين ٤ إلى ٩ صفحة ٧٢'], 'en', -.015]
  ];
  const names = ['IMG_3921.jpg', 'IMG_4107.jpg', 'IMG_3388.jpg', 'IMG_4650.jpg'];
  for (const [n, t, l, d, tilt] of defs) {
    const im = await loadImg(sampleCanvas(n, t, l, d, tilt).toDataURL('image/jpeg', .9));
    const it = newItem(names.shift(), im, {sample: true, filter: S.kind === 'notes' ? 'doc' : 'none'});
    if (S.autoCrop) it.quad = Scan.detect(im);
    reproc(it); if (!items.some(i => !i.sample)) items.push(it);
  }
  renderGrid();
}

syncUI(); renderGrid(); loadSamples();
if (document.fonts) document.fonts.ready.then(schedulePreview);
window.__rizma = {get items() { return items; }, S, ocrSrc: it => process({...it, filter: 'none', bright: 0, contrast: 0}, 2400)};
})();

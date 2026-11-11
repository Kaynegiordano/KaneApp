// Outils de sélection.
'use strict';
(() => {
  const U = KS.util, T = KS.tools, V = KS.view;

  // Mode d'après les touches (Maj = ajouter, Alt = soustraire, les deux = intersection)
  const modeOf = (ev, base, doc) => {
    if (!doc.selection.active) return ev.alt && !ev.shift ? 'new' : 'new';
    if (ev.shift && ev.alt) return 'int';
    if (ev.shift) return 'add';
    if (ev.alt) return 'sub';
    return base || 'new';
  };
  const selOptions = (extra = []) => [{ type: 'selmode' }, { type: 'sep' }, ...extra];
  const dashed = (ctx, fn) => {
    ctx.save();
    ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.setLineDash([]); fn(); ctx.stroke();
    ctx.strokeStyle = '#000'; ctx.setLineDash([4, 4]); ctx.lineDashOffset = -V.phase; ctx.stroke();
    ctx.restore();
  };
  const names = { new: 'Nouvelle sélection', add: 'Ajout à la sélection', sub: 'Soustraction de la sélection', int: 'Intersection de sélections' };

  // Déplacement du contour de sélection (glisser à l'intérieur avec un outil de sélection)
  const moveSel = {
    start(doc, ev) { this.p0 = ev; this.on = true; doc.selection.dragOffset = { dx: 0, dy: 0 }; },
    move(doc, ev) { let dx = ev.x - this.p0.x, dy = ev.y - this.p0.y; if (ev.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; } doc.selection.dragOffset = { dx: Math.round(dx), dy: Math.round(dy) }; },
    end(doc) {
      const o = doc.selection.dragOffset; doc.selection.dragOffset = null; this.on = false;
      if (o && (o.dx || o.dy)) KS.Hist.selection(doc, 'Déplacer la sélection', () => doc.selection.translate(o.dx, o.dy), 'move');
    },
  };
  // Les fourmis suivent le décalage pendant le glisser
  const origAnts = KS.Selection.prototype.drawAnts;
  KS.Selection.prototype.drawAnts = function (ctx, v, phase) {
    if (!this.dragOffset) return origAnts.call(this, ctx, v, phase);
    const o = this.dragOffset;
    origAnts.call(this, ctx, { ...v, ox: v.ox + o.dx * v.zoom, oy: v.oy + o.dy * v.zoom }, phase);
  };

  /* ---------------------------------------------------------------- rectangle & ellipse */
  function marquee(id, name, icon, shape) {
    return T.register({
      id, name, icon, shortcut: 'M', cursor: 'crosshair',
      defaults: { mode: 'new', feather: 0, style: 'normal', rw: 1, rh: 1, fw: 512, fh: 512 },
      options() {
        return selOptions([
          { type: 'scrub', id: 'feather', label: 'Contour progressif', min: 0, max: 250, unit: 'px' },
          { type: 'sep' },
          { type: 'select', id: 'style', label: 'Style', options: [['normal', 'Normal'], ['ratio', 'Proportions fixes'], ['size', 'Taille fixe']] },
          { type: 'scrub', id: 'rw', label: 'L', min: 0.01, max: 10000, step: 0.01 }, { type: 'scrub', id: 'rh', label: 'H', min: 0.01, max: 10000, step: 0.01 },
          { type: 'sep' },
          { type: 'button', text: 'Sélectionner et masquer…', action: () => KS.cmd.refineEdge() },
        ]);
      },
      down(ev, doc) {
        const p = T.snapPoint(doc, ev);
        this.mode = modeOf(ev, this.o.mode, doc);
        if (this.mode === 'new' && !ev.shift && !ev.alt && doc.selection.contains(ev.x, ev.y) && this.o.mode === 'new') { moveSel.start(doc, ev); return; }
        this.a = p; this.b = p; this.drawing = true;
        this.shiftAtStart = ev.shift; this.altAtStart = ev.alt;
      },
      move(ev, doc) {
        if (moveSel.on) return moveSel.move(doc, ev);
        if (!this.drawing) return;
        this.b = T.snapPoint(doc, ev);
        this.square = ev.shift && (!this.shiftAtStart || this.mode !== 'add') || (ev.shift && !doc.selection.active);
        this.center = ev.alt && (!this.altAtStart || this.mode !== 'sub');
      },
      rect() {
        const a = this.a, b = this.b;
        let w = b.x - a.x, hh = b.y - a.y;
        if (this.o.style === 'size') { w = this.o.rw * Math.sign(w || 1); hh = this.o.rh * Math.sign(hh || 1); }
        else if (this.o.style === 'ratio') { const r = this.o.rw / this.o.rh; if (Math.abs(w) / r > Math.abs(hh)) hh = Math.abs(w) / r * Math.sign(hh || 1); else w = Math.abs(hh) * r * Math.sign(w || 1); }
        else if (this.square) { const s = Math.max(Math.abs(w), Math.abs(hh)); w = s * Math.sign(w || 1); hh = s * Math.sign(hh || 1); }
        let r = this.center ? { x: a.x - Math.abs(w), y: a.y - Math.abs(hh), w: Math.abs(w) * 2, h: Math.abs(hh) * 2 } : U.normRect(a, { x: a.x + w, y: a.y + hh });
        if (shape === 'rect') r = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.x + r.w) - Math.round(r.x), h: Math.round(r.y + r.h) - Math.round(r.y) };
        return r;
      },
      up(ev, doc) {
        if (moveSel.on) return moveSel.end(doc);
        if (!this.drawing) return;
        this.drawing = false;
        const r = this.rect();
        const tiny = r.w < 1 || r.h < 1 || (Math.abs(this.b.x - this.a.x) * V.zoom < 2 && Math.abs(this.b.y - this.a.y) * V.zoom < 2 && this.o.style !== 'size');
        if (tiny) { if (this.mode === 'new' && doc.selection.active) KS.Hist.selection(doc, 'Désélectionner', () => doc.selection.clear(), 'select-none'); return; }
        KS.Hist.selection(doc, (shape === 'rect' ? 'Rectangle de sélection' : 'Ellipse de sélection'), () => {
          if (shape === 'rect') doc.selection.rect(r, this.mode, this.o.feather); else doc.selection.ellipse(r, this.mode, this.o.feather);
        }, icon);
      },
      cancel() { this.drawing = false; },
      overlay(ctx) {
        if (!this.drawing) return;
        const r = this.rect(), a = V.toScreen(r.x, r.y);
        dashed(ctx, () => {
          ctx.beginPath();
          if (shape === 'rect') ctx.rect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(r.w * V.zoom), Math.round(r.h * V.zoom));
          else ctx.ellipse(a.x + r.w * V.zoom / 2, a.y + r.h * V.zoom / 2, r.w * V.zoom / 2, r.h * V.zoom / 2, 0, 0, Math.PI * 2);
        });
        ctx.fillStyle = 'rgba(20,22,27,0.85)'; ctx.font = '11px Outfit, sans-serif';
        const label = `${Math.round(r.w)} × ${Math.round(r.h)}`;
        const tw = ctx.measureText(label).width + 12, m = V.mouse || { sx: a.x, sy: a.y };
        ctx.beginPath(); ctx.roundRect(m.sx + 14, m.sy + 14, tw, 20, 5); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText(label, m.sx + 20, m.sy + 28);
      },
    });
  }
  marquee('marquee-rect', 'Rectangle de sélection', 'marquee-rect', 'rect');
  marquee('marquee-ellipse', 'Ellipse de sélection', 'marquee-ellipse', 'ellipse');

  // Rangée / colonne unique
  for (const [id, name, horiz] of [['marquee-row', 'Rangée unique', true], ['marquee-col', 'Colonne unique', false]]) {
    T.register({
      id, name, icon: 'marquee-row', shortcut: 'M', cursor: 'crosshair', defaults: { mode: 'new' },
      options: () => selOptions(),
      down(ev, doc) {
        const mode = modeOf(ev, this.o.mode, doc);
        const r = horiz ? { x: 0, y: Math.floor(ev.y), w: doc.width, h: 1 } : { x: Math.floor(ev.x), y: 0, w: 1, h: doc.height };
        KS.Hist.selection(doc, name, () => doc.selection.rect(r, mode, 0), 'marquee-rect');
      },
    });
  }

  /* ---------------------------------------------------------------- lasso */
  T.register({
    id: 'lasso', name: 'Lasso', icon: 'lasso', shortcut: 'L', cursor: 'crosshair', defaults: { mode: 'new', feather: 0 },
    options: () => selOptions([{ type: 'scrub', id: 'feather', label: 'Contour progressif', min: 0, max: 250, unit: 'px' }]),
    down(ev, doc) {
      this.mode = modeOf(ev, this.o.mode, doc);
      if (this.mode === 'new' && !ev.shift && !ev.alt && doc.selection.contains(ev.x, ev.y) && this.o.mode === 'new') { moveSel.start(doc, ev); return; }
      this.pts = [{ x: ev.x, y: ev.y }];
    },
    move(ev, doc) {
      if (moveSel.on) return moveSel.move(doc, ev);
      if (!this.pts) return;
      const l = this.pts[this.pts.length - 1];
      if (Math.hypot(ev.x - l.x, ev.y - l.y) * V.zoom > 1.5) this.pts.push({ x: ev.x, y: ev.y });
    },
    up(ev, doc) {
      if (moveSel.on) return moveSel.end(doc);
      const pts = this.pts; this.pts = null;
      if (!pts || pts.length < 3) { if (this.mode === 'new' && doc.selection.active) KS.Hist.selection(doc, 'Désélectionner', () => doc.selection.clear(), 'select-none'); return; }
      KS.Hist.selection(doc, 'Lasso', () => doc.selection.polygon(pts, this.mode, this.o.feather), 'lasso');
    },
    cancel() { this.pts = null; },
    overlay(ctx) {
      if (!this.pts) return;
      dashed(ctx, () => { ctx.beginPath(); this.pts.forEach((p, i) => { const s = V.toScreen(p.x, p.y); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); });
    },
  });

  T.register({
    id: 'lasso-poly', name: 'Lasso polygonal', icon: 'lasso-poly', shortcut: 'L', cursor: 'crosshair', defaults: { mode: 'new', feather: 0 },
    options: () => selOptions([{ type: 'scrub', id: 'feather', label: 'Contour progressif', min: 0, max: 250, unit: 'px' }]),
    down(ev, doc) {
      let p = T.snapPoint(doc, ev);
      if (!this.pts) { this.mode = modeOf(ev, this.o.mode, doc); this.pts = [p]; return; }
      const f = this.pts[0];
      if (this.pts.length > 2 && Math.hypot(f.x - p.x, f.y - p.y) * V.zoom < 8) { this.close(doc); return; }
      if (ev.shift) p = snap45(this.pts[this.pts.length - 1], p);
      this.pts.push(p);
    },
    dblclick(ev, doc) { if (this.pts) this.close(doc); },
    close(doc) {
      const pts = this.pts; this.pts = null;
      if (pts && pts.length >= 3) KS.Hist.selection(doc, 'Lasso polygonal', () => doc.selection.polygon(pts, this.mode, this.o.feather), 'lasso-poly');
      KS.requestRender();
    },
    key(e, doc) {
      if (!this.pts) return false;
      if (e.key === 'Escape') { this.pts = null; KS.requestRender(); return true; }
      if (e.key === 'Enter') { this.close(doc); return true; }
      if (e.key === 'Backspace' || e.key === 'Delete') { this.pts.pop(); if (!this.pts.length) this.pts = null; KS.requestRender(); return true; }
      return false;
    },
    cancel() { this.pts = null; },
    deactivate(doc) { if (this.pts && doc) this.close(doc); },
    overlay(ctx) {
      if (!this.pts) return;
      const m = V.mouse;
      dashed(ctx, () => {
        ctx.beginPath();
        this.pts.forEach((p, i) => { const s = V.toScreen(p.x, p.y); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
        if (m) ctx.lineTo(m.sx, m.sy);
      });
      const f = V.toScreen(this.pts[0].x, this.pts[0].y);
      V.handle(ctx, f.x, f.y, 7, true);
    },
  });
  /* ---------------------------------------------------------------- lasso magnétique */
  // Le tracé suit les contours : chaque segment est le chemin de moindre coût (Dijkstra)
  // entre le dernier point d'ancrage et le contour le plus fort près du curseur.
  const magnetic = {
    edges(doc, all) {
      const d = KS.sampleData(doc, all), W = doc.width, H = doc.height, p = d.data;
      const lum = new Float32Array(W * H);
      for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = (p[j] * 0.299 + p[j + 1] * 0.587 + p[j + 2] * 0.114) * p[j + 3] / 255;
      const g = new Float32Array(W * H);
      let max = 1;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const gx = lum[i - W + 1] + 2 * lum[i + 1] + lum[i + W + 1] - lum[i - W - 1] - 2 * lum[i - 1] - lum[i + W - 1];
        const gy = lum[i + W - 1] + 2 * lum[i + W] + lum[i + W + 1] - lum[i - W - 1] - 2 * lum[i - W] - lum[i - W + 1];
        const m = Math.hypot(gx, gy); g[i] = m; if (m > max) max = m;
      }
      for (let i = 0; i < g.length; i++) g[i] /= max;
      return { W, H, g };
    },
    // Le pixel de contour le plus fort dans un rayon r ; le point lui-même si le contraste est trop faible
    snap(E, p, r, contrast) {
      const cx = Math.round(p.x), cy = Math.round(p.y);
      let best = -1, bx = cx, by = cy;
      for (let y = Math.max(0, cy - r); y <= Math.min(E.H - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(E.W - 1, cx + r); x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r * r) continue;
        const v = E.g[y * E.W + x] - Math.hypot(dx, dy) / (r * 40);       // a force egale, le plus proche
        if (v > best) { best = v; bx = x; by = y; }
      }
      if (best < contrast) { bx = Math.min(E.W - 1, Math.max(0, cx)); by = Math.min(E.H - 1, Math.max(0, cy)); }
      return { x: bx + 0.5, y: by + 0.5 };
    },
    wire(E, a, b, pad) {
      const ax = Math.floor(a.x), ay = Math.floor(a.y), bx = Math.floor(b.x), by = Math.floor(b.y);
      const x0 = Math.max(0, Math.min(ax, bx) - pad), y0 = Math.max(0, Math.min(ay, by) - pad);
      const x1 = Math.min(E.W - 1, Math.max(ax, bx) + pad), y1 = Math.min(E.H - 1, Math.max(ay, by) + pad);
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      if (w * h > 400000) return [b];                                     // trop loin : segment droit
      const dist = new Float32Array(w * h).fill(Infinity), prev = new Int32Array(w * h).fill(-1);
      const heap = [], push = (k, d) => { heap.push([d, k]); let i = heap.length - 1; while (i > 0) { const q = (i - 1) >> 1; if (heap[q][0] <= heap[i][0]) break; [heap[q], heap[i]] = [heap[i], heap[q]]; i = q; } };
      const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
      const s = (ay - y0) * w + (ax - x0), t = (by - y0) * w + (bx - x0);
      dist[s] = 0; push(s, 0);
      while (heap.length) {
        const [d, k] = pop();
        if (k === t) break;
        if (d > dist[k]) continue;
        const kx = k % w, ky = (k / w) | 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = kx + ox, ny = ky + oy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx, gv = E.g[(ny + y0) * E.W + nx + x0];
          const nd = d + (1.02 - gv) * (ox && oy ? 1.414 : 1);
          if (nd < dist[n]) { dist[n] = nd; prev[n] = k; push(n, nd); }
        }
      }
      const out = [];
      for (let k = t; k !== -1 && k !== s; k = prev[k]) out.push({ x: (k % w) + x0 + 0.5, y: ((k / w) | 0) + y0 + 0.5 });
      if (!out.length && t !== s) return [b];
      return out.reverse();
    },
  };
  T.register({
    id: 'lasso-magnetic', name: 'Lasso magnétique', icon: 'lasso-magnetic', shortcut: 'L', cursor: 'crosshair',
    defaults: { mode: 'new', feather: 0, width: 10, contrast: 10, frequency: 57, all: false },
    options: () => selOptions([
      { type: 'scrub', id: 'feather', label: 'Contour progressif', min: 0, max: 250, unit: 'px' },
      { type: 'scrub', id: 'width', label: 'Largeur', min: 1, max: 256, unit: 'px' },
      { type: 'scrub', id: 'contrast', label: 'Contraste', min: 1, max: 100, unit: '%' },
      { type: 'scrub', id: 'frequency', label: 'Fréquence', min: 0, max: 100 },
      { type: 'check', id: 'all', label: 'Échantillonner tous les calques' },
    ]),
    start(ev, doc) {
      this.mode = modeOf(ev, this.o.mode, doc);
      this.E = magnetic.edges(doc, this.o.all);
      const p = magnetic.snap(this.E, ev, this.o.width, this.o.contrast / 100);
      this.pts = [p]; this.anchors = [0]; this.live = [];
    },
    follow(ev) {
      if (!this.pts) return;
      const a = this.pts[this.anchors[this.anchors.length - 1]];
      const p = magnetic.snap(this.E, ev, this.o.width, this.o.contrast / 100);
      this.live = magnetic.wire(this.E, a, p, this.o.width + 4);
      // Points d'ancrage automatiques : plus la fréquence est haute, plus ils sont rapprochés (à l'écran)
      if (Math.hypot(p.x - a.x, p.y - a.y) * V.zoom > 12 + (100 - this.o.frequency) * 1.2) this.commit();
      KS.requestRender();
    },
    commit() {
      if (!this.live.length) return;
      this.pts.push(...this.live); this.anchors.push(this.pts.length - 1); this.live = [];
    },
    down(ev, doc) {
      if (!this.pts) { this.start(ev, doc); return; }
      const f = this.pts[0];
      if (this.pts.length > 2 && Math.hypot(f.x - ev.x, f.y - ev.y) * V.zoom < 8) { this.close(doc); return; }
      this.follow(ev); this.commit();
    },
    move(ev) { this.follow(ev); },
    hover(ev) { this.follow(ev); },
    dblclick(ev, doc) { if (this.pts) this.close(doc); },
    close(doc) {
      if (!this.pts) return;
      this.commit();
      const pts = this.pts.concat(magnetic.wire(this.E, this.pts[this.pts.length - 1], this.pts[0], this.o.width + 4));
      this.pts = null; this.live = []; this.E = null;
      if (pts.length >= 3) KS.Hist.selection(doc, 'Lasso magnétique', () => doc.selection.polygon(pts, this.mode, this.o.feather), 'lasso-magnetic');
      KS.requestRender();
    },
    key(e, doc) {
      if (!this.pts) return false;
      if (e.key === 'Escape') { this.cancel(); KS.requestRender(); return true; }
      if (e.key === 'Enter') { this.close(doc); return true; }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        this.anchors.pop();
        if (!this.anchors.length) this.cancel();
        else { this.pts.length = this.anchors[this.anchors.length - 1] + 1; this.live = []; }
        KS.requestRender(); return true;
      }
      return false;
    },
    cancel() { this.pts = null; this.live = []; this.E = null; },
    deactivate(doc) { if (this.pts && doc) this.close(doc); },
    overlay(ctx) {
      if (!this.pts) return;
      dashed(ctx, () => {
        ctx.beginPath();
        this.pts.concat(this.live).forEach((p, i) => { const s = V.toScreen(p.x, p.y); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
      });
      for (const i of this.anchors) { const s = V.toScreen(this.pts[i].x, this.pts[i].y); V.handle(ctx, s.x, s.y, 5, i === 0); }
    },
  });

  function snap45(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, d = Math.hypot(dx, dy);
    return { x: a.x + Math.cos(ang) * d, y: a.y + Math.sin(ang) * d };
  }
  KS.snap45 = snap45;

  /* ---------------------------------------------------------------- baguette magique */
  // Remplissage par diffusion sur une ImageData ; renvoie un masque Uint8Array
  KS.floodMask = (data, W, H, x0, y0, tol, contiguous, region, outArr) => {
    const p = data;
    x0 = Math.floor(x0); y0 = Math.floor(y0);
    const out = outArr || new Uint8Array(W * H);
    if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= H) return out;
    const i0 = (y0 * W + x0) * 4, r0 = p[i0], g0 = p[i0 + 1], b0 = p[i0 + 2], a0 = p[i0 + 3];
    const t = tol;
    const match = i => {
      const a = p[i + 3];
      if (a0 < 8 && a < 8) return true;
      return Math.abs(p[i] - r0) <= t && Math.abs(p[i + 1] - g0) <= t && Math.abs(p[i + 2] - b0) <= t && Math.abs(a - a0) <= t;
    };
    const R = region || { x: 0, y: 0, w: W, h: H };
    const X0 = R.x, X1 = R.x + R.w - 1, Y0 = R.y, Y1 = R.y + R.h - 1;
    if (!contiguous) {
      for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) { const k = y * W + x; if (match(k * 4)) out[k] = 1; }
      return out;
    }
    const stack = [x0, y0];
    while (stack.length) {
      const y = stack.pop(), x = stack.pop();
      let l = x, r = x;
      const row = y * W;
      if (out[row + x] || !match((row + x) * 4)) continue;
      while (l > X0 && !out[row + l - 1] && match((row + l - 1) * 4)) l--;
      while (r < X1 && !out[row + r + 1] && match((row + r + 1) * 4)) r++;
      for (let k = l; k <= r; k++) out[row + k] = 1;
      for (const ny of [y - 1, y + 1]) {
        if (ny < Y0 || ny > Y1) continue;
        const nrow = ny * W;
        let inSpan = false;
        for (let k = l; k <= r; k++) {
          const ok = !out[nrow + k] && match((nrow + k) * 4);
          if (ok && !inSpan) { stack.push(k, ny); inSpan = true; } else if (!ok) inSpan = false;
        }
      }
    }
    return out;
  };
  KS.maskToCanvas = (m, W, H, antialias = false) => {
    const img = new ImageData(W, H), p = img.data;
    for (let i = 0; i < m.length; i++) if (m[i]) p[i * 4 + 3] = 255;
    let c = U.canvas(W, H); U.putData(c, img);
    if (antialias) c = U.blurCanvas(c, 0.6);
    return c;
  };
  // Données de l'échantillon (calque actif ramené au document, ou composition)
  KS.sampleData = (doc, all) => {
    if (all || !doc.active || doc.active.kind === 'adjust' || doc.active.kind === 'group') return U.getData(doc.composite());
    const c = U.canvas(doc.width, doc.height), L = doc.active;
    c.getContext('2d').drawImage(L.canvas, L.x, L.y);
    return U.getData(c);
  };

  T.register({
    id: 'wand', name: 'Baguette magique', icon: 'wand', shortcut: 'W', cursor: 'crosshair',
    defaults: { mode: 'new', tolerance: 32, contiguous: true, all: false, antialias: true },
    options: () => selOptions([
      { type: 'scrub', id: 'tolerance', label: 'Tolérance', min: 0, max: 255 },
      { type: 'check', id: 'antialias', label: 'Lissage' },
      { type: 'check', id: 'contiguous', label: 'Pixels contigus' },
      { type: 'check', id: 'all', label: 'Échantillonner tous les calques' },
    ]),
    down(ev, doc) {
      const mode = modeOf(ev, this.o.mode, doc);
      const d = KS.sampleData(doc, this.o.all);
      const m = KS.floodMask(d.data, doc.width, doc.height, ev.x, ev.y, this.o.tolerance, this.o.contiguous);
      const c = KS.maskToCanvas(m, doc.width, doc.height, this.o.antialias);
      KS.Hist.selection(doc, 'Baguette magique', () => doc.selection.combineCanvas(c, mode), 'wand');
    },
  });

  /* ---------------------------------------------------------------- sélection rapide */
  T.register({
    id: 'quick-select', name: 'Sélection rapide', icon: 'quick-select', shortcut: 'W', cursor: 'none', altPaints: true,
    defaults: { size: 30, all: true, mode: 'add', tolerance: 26 },
    options: () => [
      { type: 'seg', id: 'mode', options: [['new', 'marquee-rect', 'Nouvelle'], ['add', 'plus', 'Ajouter (Maj)'], ['sub', 'minus', 'Soustraire (Alt)']] },
      { type: 'sep' },
      { type: 'scrub', id: 'size', label: 'Taille', min: 2, max: 800, unit: 'px', log: true },
      { type: 'scrub', id: 'tolerance', label: 'Sensibilité', min: 4, max: 100 },
      { type: 'check', id: 'all', label: 'Échantillonner tous les calques' },
      { type: 'sep' },
      { type: 'button', text: 'Sélectionner le sujet', icon: 'sparkles', action: () => KS.cmd.selectSubject() },
      { type: 'button', text: 'Sélectionner et masquer…', action: () => KS.cmd.refineEdge() },
    ],
    down(ev, doc) {
      this.data = KS.sampleData(doc, this.o.all);
      this.acc = new Uint8Array(doc.width * doc.height);
      this.scratch = new Uint8Array(doc.width * doc.height);
      this.dirtyR = null;
      this.mode = ev.alt ? 'sub' : ev.shift ? 'add' : (doc.selection.active ? (this.o.mode === 'sub' ? 'sub' : this.o.mode === 'new' ? 'new' : 'add') : 'new');
      if (this.o.mode === 'new' && doc.selection.active && !ev.shift && !ev.alt) this.mode = 'new';
      this.tmp = U.canvas(doc.width, doc.height);
      this.last = null;
      this.paint(ev, doc);
    },
    paint(ev, doc) {
      const W = doc.width, H = doc.height, r = this.o.size / 2;
      const pts = [];
      if (this.last) { const d = Math.hypot(ev.x - this.last.x, ev.y - this.last.y), n = Math.max(1, Math.ceil(d / Math.max(2, r / 2))); for (let i = 1; i <= n; i++) pts.push({ x: this.last.x + (ev.x - this.last.x) * i / n, y: this.last.y + (ev.y - this.last.y) * i / n }); }
      else pts.push(ev);
      this.last = { x: ev.x, y: ev.y };
      const p = this.data.data;
      for (const q of pts) {
        const cx = Math.floor(q.x), cy = Math.floor(q.y);
        if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
        const R = Math.ceil(r * 3);
        const region = U.rectIntersect({ x: cx - R, y: cy - R, w: R * 2 + 1, h: R * 2 + 1 }, { x: 0, y: 0, w: W, h: H });
        // couleur de référence : moyenne sous le pinceau ; on diffuse depuis plusieurs graines
        const seeds = [[cx, cy], [cx - r / 2, cy], [cx + r / 2, cy], [cx, cy - r / 2], [cx, cy + r / 2]];
        const sc = this.scratch;
        for (let y = region.y; y < region.y + region.h; y++) sc.fill(0, y * W + region.x, y * W + region.x + region.w);
        for (const [sx, sy] of seeds) {
          const X = Math.round(sx), Y = Math.round(sy);
          if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
          KS.floodMask(p, W, H, X, Y, this.o.tolerance, true, region, sc);
        }
        for (let y = region.y; y < region.y + region.h; y++) for (let x = region.x, k = y * W + x; x < region.x + region.w; x++, k++) if (sc[k]) this.acc[k] = 1;
        for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(H, cy + r); y++) for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(W, cx + r); x++) if (Math.hypot(x - cx, y - cy) <= r) this.acc[y * W + x] = 1;
        this.dirtyR = U.rectUnion(this.dirtyR, region);
      }
      this.dirty = true;
    },
    move(ev, doc) { if (this.acc) this.paint(ev, doc); },
    up(ev, doc) {
      if (!this.acc) return;
      const c = KS.maskToCanvas(this.acc, doc.width, doc.height, true);
      this.acc = null; this.data = null; this.scratch = null;
      KS.Hist.selection(doc, 'Sélection rapide', () => doc.selection.combineCanvas(c, this.mode), 'quick-select');
    },
    preRender(doc) {
      if (!this.acc || !this.dirty || !this.dirtyR) return;
      this.dirty = false;
      const W = doc.width, R = this.dirtyR, img = new ImageData(R.w, R.h), p = img.data, add = this.mode !== 'sub';
      for (let y = 0; y < R.h; y++) for (let x = 0; x < R.w; x++) {
        if (!this.acc[(y + R.y) * W + x + R.x]) continue;
        const k = (y * R.w + x) * 4; p[k] = add ? 61 : 230; p[k + 1] = add ? 124 : 70; p[k + 2] = add ? 240 : 60; p[k + 3] = 110;
      }
      this.tmp.getContext('2d').putImageData(img, R.x, R.y);
      this.dirtyR = null;
    },
    overlay(ctx) {
      if (this.acc) { ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(this.tmp, V.ox, V.oy, KS.state.doc.width * V.zoom, KS.state.doc.height * V.zoom); ctx.restore(); }
      T.drawBrushCursor(ctx, this.o.size, { cross: true });
    },
    key(e) {
      if (e.key === '[' || e.key === ']') { T.setOpt(this, 'size', U.clamp(Math.round(this.o.size * (e.key === ']' ? 1.15 : 1 / 1.15)), 2, 800)); T.renderOptions(); return true; }
      return false;
    },
  });
})();

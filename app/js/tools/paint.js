// Outils de peinture.
'use strict';
(() => {
  const U = KS.util, T = KS.tools, V = KS.view, h = KS.h, ui = KS.ui;

  // Touches communes aux pinceaux : [ ] taille, Maj+[ ] dureté, chiffres = opacité
  function brushKeys(tool, e) {
    if (!e.altKey && (e.key === '[' || e.key === ']' || e.key === '{' || e.key === '}')) {
      const up = e.key === ']' || e.key === '}';
      if (e.shiftKey && tool.o.hardness != null) T.setOpt(tool, 'hardness', U.clamp(tool.o.hardness + (up ? 25 : -25), 0, 100));
      else { const s = tool.o.size; T.setOpt(tool, 'size', U.clamp(Math.round(up ? (s < 10 ? s + 1 : s * 1.15) : (s < 10 ? s - 1 : s / 1.15)), 1, 2500)); }
      T.refreshBrushCtl(tool); KS.requestRender();
      T.brushGesture?.flash(e.shiftKey && tool.o.hardness != null ? `Dureté : ${tool.o.hardness} %` : `Taille : ${tool.o.size} px`);
      return true;
    }
    if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.altKey && tool.o.opacity != null) {
      // comme Photoshop : un chiffre = dizaines (0 = 100 %), deux chiffres tapés vite = valeur exacte (4 puis 5 = 45 %, 0 puis 0 = 0 %)
      const k = e.shiftKey && tool.o.flow != null ? 'flow' : 'opacity', now = performance.now(), prev = tool._digit;
      let v = e.key === '0' ? 100 : +e.key * 10;
      if (prev && prev.k === k && now - prev.t < 700) { v = Math.max(k === 'flow' ? 1 : 0, +(prev.key + e.key)); tool._digit = null; }
      else tool._digit = { k, key: e.key, t: now };
      T.setOpt(tool, k, v); T.renderOptions(); T.brushGesture?.flash(`${k === 'flow' ? 'Flux' : 'Opacité'} : ${v} %`);
      return true;
    }
    return false;
  }
  KS.brushKeys = brushKeys;

  const pressureBtns = tool => ({
    type: 'custom', render: () => {
      const a = ui.iconBtn('brush', 'La pression du stylet contrôle la taille', () => { T.setOpt(tool, 'pressureSize', !tool.o.pressureSize); a.classList.toggle('on', tool.o.pressureSize); });
      const b = ui.iconBtn('adjust', 'La pression du stylet contrôle l\'opacité', () => { T.setOpt(tool, 'pressureOpacity', !tool.o.pressureOpacity); b.classList.toggle('on', tool.o.pressureOpacity); });
      a.classList.toggle('on', !!tool.o.pressureSize); b.classList.toggle('on', !!tool.o.pressureOpacity);
      return h('div.opt-group', a, b);
    },
  });

  /* ---------------------------------------------------------------- pinceau, crayon, gomme */
  function brushTool(cfg) {
    const tool = T.register({
      id: cfg.id, name: cfg.name, icon: cfg.icon, shortcut: cfg.shortcut, cursor: 'none', altPicks: cfg.mode !== 'erase',
      defaults: Object.assign({ size: 30, hardness: cfg.aliased ? null : 80, opacity: 100, flow: 100, smoothing: 10, spacing: 8, pressureSize: true, pressureOpacity: false }, cfg.defaults || {}),
      options() {
        return [
          { type: 'brush' }, { type: 'sep' },
          cfg.mode === 'erase' ? { type: 'select', id: 'emode', label: 'Mode', options: [['brush', 'Pinceau'], ['pencil', 'Crayon']] } : null,
          { type: 'scrub', id: 'opacity', label: 'Opacité', min: 1, max: 100, unit: '%' },
          { type: 'scrub', id: 'flow', label: 'Flux', min: 1, max: 100, unit: '%' },
          { type: 'scrub', id: 'smoothing', label: 'Lissage', min: 0, max: 100, unit: '%' },
          { type: 'scrub', id: 'spacing', label: 'Pas', min: 1, max: 200, unit: '%' },
          { type: 'sep' }, pressureBtns(this),
        ];
      },
      down(ev, doc) {
        const target = T.paintTarget(doc);
        if (!target) return;
        let mode = cfg.mode, color = T.paintColor(target);
        const L = target.layer;
        if (mode === 'erase' && (target.gray || (L && L.lockAlpha))) { mode = 'paint'; color = target.gray ? U.gray(KS.state.bg) : KS.state.bg; }
        const aliased = cfg.aliased || (cfg.mode === 'erase' && this.o.emode === 'pencil');
        this.target = target;
        // calque de pixels : l'état d'avant n'est copié qu'au relâchement, sur le seul rectangle peint
        const cv = doc.channelView, lazy = !target.gray && !(cv && !(cv.r && cv.g && cv.b));
        this.token = lazy ? null : T.beginHist(target);
        this.stroke = new KS.Brush.Stroke({
          doc, target, size: this.o.size, hardness: aliased ? 1 : (this.o.hardness ?? 100) / 100, opacity: this.o.opacity / 100, flow: this.o.flow / 100,
          spacing: this.o.spacing / 100, color, mode, aliased, pressureSize: this.o.pressureSize, pressureOpacity: this.o.pressureOpacity,
          direct: target.gray, lockAlpha: L && L.lockAlpha && mode !== 'erase',
        });
        const p = { x: ev.x, y: ev.y, pressure: ev.pressure };
        if (ev.shift && this.lastPoint && this.lastDoc === doc) { this.stroke.start(this.lastPoint); this.stroke.move(p); }
        else this.stroke.start(p);
        this.lazy = { ...p };
        this.afterDab(doc);
      },
      move(ev, doc) {
        if (!this.stroke) return;
        const s = this.o.smoothing / 100 * 0.88;
        const p = { x: ev.x, y: ev.y, pressure: ev.pressure };
        if (s > 0) { this.lazy.x += (p.x - this.lazy.x) * (1 - s); this.lazy.y += (p.y - this.lazy.y) * (1 - s); this.lazy.pressure = p.pressure; }
        else this.lazy = p;
        this.stroke.move({ ...this.lazy });
        this.afterDab(doc);
      },
      afterDab(doc) {
        const st = this.stroke;
        // seule la zone des nouvelles touches est recomposée
        const r = st.takeDirty();
        if (st.direct && st.dirtyMove) { this.target.after(st.dirtyMove); st.dirtyMove = null; }
        if (r) { if (!st.direct) this.needPreview = true; doc.changed(r); }
        else KS.requestRender();
      },
      preRender() {
        if (this.stroke && this.needPreview && !this.stroke.direct) { this.target.layer.override = this.stroke.preview(); this.needPreview = false; }
      },
      up(ev, doc) {
        if (!this.stroke) return;
        const st = this.stroke;
        if (this.o.smoothing > 0) st.move({ x: ev.x, y: ev.y, pressure: this.lazy.pressure });
        const t0 = this.target, cr = !this.token && st.rect && U.rectIntersect(U.rectInt(st.rect), { x: 0, y: 0, w: t0.canvas.width, h: t0.canvas.height });
        const beforeRect = cr ? U.copyCanvas(t0.canvas, cr) : null;
        const rect = st.commit();
        if (st.direct) this.target.after(st.dirtyMove || rect);
        if (this.target.layer) { this.target.layer.override = null; this.target.layer.touch(); }
        const t = this.target;
        if (this.token) T.commitHist(doc, t, this.token, rect, cfg.histName, cfg.icon);
        else if (cr) { KS.Hist.commitRect(doc, cfg.histName, t.layer, cr, beforeRect, cfg.icon); KS.emit('layer-pixels', doc); }
        this.lastPoint = { x: ev.x, y: ev.y, pressure: ev.pressure }; this.lastDoc = doc;
        this.stroke = null; this.target = null;
        doc.changed(rect ? { x: rect.x + t.ox, y: rect.y + t.oy, w: rect.w, h: rect.h } : undefined);
      },
      cancel() { if (this.target && this.target.layer) { this.target.layer.override = null; this.target.layer.touch(); } this.stroke = null; },
      key(e) { return brushKeys(this, e); },
      overlay(ctx) { T.drawBrushCursor(ctx, this.o.size); },
    });
    return tool;
  }
  brushTool({ id: 'brush', name: 'Pinceau', icon: 'brush', shortcut: 'B', mode: 'paint', histName: 'Pinceau' });
  brushTool({ id: 'pencil', name: 'Crayon', icon: 'pencil', shortcut: 'B', mode: 'paint', aliased: true, histName: 'Crayon', defaults: { size: 4, smoothing: 0, spacing: 5, pressureSize: false } });
  brushTool({ id: 'eraser', name: 'Gomme', icon: 'eraser', shortcut: 'E', mode: 'erase', histName: 'Gomme', defaults: { emode: 'brush', hardness: 70 } });

  /* ---------------------------------------------------------------- tampon de duplication */
  T.register({
    id: 'clone', name: 'Tampon de duplication', icon: 'clone', shortcut: 'S', cursor: 'none',
    defaults: { size: 60, hardness: 50, opacity: 100, flow: 100, aligned: true, sample: 'layer', pressureSize: false, pressureOpacity: false },
    options() {
      return [
        { type: 'brush' }, { type: 'sep' },
        { type: 'scrub', id: 'opacity', label: 'Opacité', min: 1, max: 100, unit: '%' },
        { type: 'scrub', id: 'flow', label: 'Flux', min: 1, max: 100, unit: '%' },
        { type: 'check', id: 'aligned', label: 'Aligné' },
        { type: 'select', id: 'sample', label: 'Échantillon', options: [['layer', 'Calque actif'], ['all', 'Tous les calques']] },
        { type: 'sep' }, pressureBtns(this),
        { type: 'custom', render: () => h('span.opt-label', { text: 'Alt + clic : définir la source' }) },
      ];
    },
    down(ev, doc) {
      if (ev.alt) { this.src = { x: ev.x, y: ev.y, doc }; this.offset = null; KS.toast('Source définie', 'ok', 900); return; }
      if (!this.src || this.src.doc !== doc) { KS.toast('Alt + clic pour définir la source de duplication', 'err'); return; }
      const target = T.paintTarget(doc, { allowMaskEdit: false });
      if (!target || target.gray) return;
      if (!this.offset || !this.o.aligned) this.offset = { dx: this.src.x - ev.x, dy: this.src.y - ev.y };
      const L = target.layer;
      // le calque n'est modifié qu'au relâchement : il sert de source tel quel, sans copie
      const source = this.o.sample === 'all' ? { canvas: U.copyCanvas(doc.composite()), ox: 0, oy: 0 } : { canvas: L.canvas, ox: L.x, oy: L.y };
      this.target = target;
      const cv = doc.channelView;
      this.token = cv && !(cv.r && cv.g && cv.b) ? T.beginHist(target) : null;
      this.stroke = new KS.Brush.Stroke({
        doc, target, size: this.o.size, hardness: this.o.hardness / 100, opacity: this.o.opacity / 100, flow: this.o.flow / 100, spacing: 0.08,
        mode: 'clone', cloneSource: source, cloneOffset: this.offset, pressureSize: this.o.pressureSize, pressureOpacity: this.o.pressureOpacity, lockAlpha: L.lockAlpha,
      });
      this.stroke.start({ x: ev.x, y: ev.y, pressure: ev.pressure });
      this.changed(doc);
    },
    move(ev, doc) { if (this.stroke) { this.stroke.move({ x: ev.x, y: ev.y, pressure: ev.pressure }); this.changed(doc); } },
    // seule la zone des nouvelles touches est recomposée
    changed(doc) { const r = this.stroke.takeDirty(); if (r) { this.need = true; doc.changed(r); } else KS.requestRender(); },
    preRender() { if (this.stroke && this.need) { this.target.layer.override = this.stroke.preview(); this.need = false; } },
    up(ev, doc) {
      if (!this.stroke) return;
      const st = this.stroke, t = this.target;
      const cr = !this.token && st.rect && U.rectIntersect(U.rectInt(st.rect), { x: 0, y: 0, w: t.canvas.width, h: t.canvas.height });
      const before = cr ? U.copyCanvas(t.canvas, cr) : null;
      const rect = st.commit();
      t.layer.override = null; t.layer.touch();
      if (this.token) T.commitHist(doc, t, this.token, rect, 'Tampon de duplication', 'clone');
      else if (cr) { KS.Hist.commitRect(doc, 'Tampon de duplication', t.layer, cr, before, 'clone'); KS.emit('layer-pixels', doc); }
      this.stroke = null; this.target = null;
      doc.changed(rect ? { x: rect.x + t.ox, y: rect.y + t.oy, w: rect.w, h: rect.h } : undefined);
    },
    cancel() { if (this.target) { this.target.layer.override = null; this.target.layer.touch(); } this.stroke = null; },
    key(e) { return brushKeys(this, e); },
    overlay(ctx) {
      T.drawBrushCursor(ctx, this.o.size);
      const m = V.mouse;
      if (!m || !this.src) return;
      let p;
      if (this.offset && (this.stroke || this.o.aligned)) p = V.toScreen(m.x + this.offset.dx, m.y + this.offset.dy);
      else p = V.toScreen(this.src.x, this.src.y);
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(3, this.o.size * V.zoom / 2), 0, Math.PI * 2); ctx.setLineDash([3, 3]); ctx.stroke();
      ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(p.x - 6, p.y); ctx.lineTo(p.x + 6, p.y); ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x, p.y + 6); ctx.stroke();
      ctx.restore();
    },
  });

  /* ---------------------------------------------------------------- gomme magique & pot de peinture */
  function floodOnTarget(doc, ev, o, target) {
    const W = doc.width, H = doc.height;
    let data;
    if (o.all) data = U.getData(doc.composite());
    else { const c = U.canvas(W, H); c.getContext('2d').drawImage(target.canvas, target.ox, target.oy); data = U.getData(c); }
    const m = KS.floodMask(data.data, W, H, ev.x, ev.y, o.tolerance, o.contiguous);
    let mask = KS.maskToCanvas(m, W, H, o.antialias);
    if (doc.selection.mask) doc.selection.clip(mask);
    return mask;
  }
  T.register({
    id: 'eraser-magic', name: 'Gomme magique', icon: 'eraser-magic', shortcut: 'E', cursor: 'crosshair',
    defaults: { tolerance: 32, antialias: true, contiguous: true, all: false, opacity: 100 },
    options: () => [
      { type: 'scrub', id: 'tolerance', label: 'Tolérance', min: 0, max: 255 },
      { type: 'check', id: 'antialias', label: 'Lissage' }, { type: 'check', id: 'contiguous', label: 'Pixels contigus' }, { type: 'check', id: 'all', label: 'Échantillonner tous les calques' },
      { type: 'scrub', id: 'opacity', label: 'Opacité', min: 1, max: 100, unit: '%' },
    ],
    down(ev, doc) {
      const target = T.paintTarget(doc, { allowMaskEdit: false });
      if (!target || target.gray) return;
      const mask = floodOnTarget(doc, ev, this.o, target);
      const tok = T.beginHist(target), x = target.canvas.getContext('2d');
      x.globalCompositeOperation = 'destination-out'; x.globalAlpha = this.o.opacity / 100;
      x.drawImage(mask, -target.ox, -target.oy);
      x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
      target.layer.touch();
      T.commitHist(doc, target, tok, null, 'Gomme magique', 'eraser-magic');
      doc.changed();
    },
  });
  T.register({
    id: 'bucket', name: 'Pot de peinture', icon: 'bucket', shortcut: 'G', cursor: 'crosshair', altPicks: true,
    defaults: { tolerance: 32, antialias: true, contiguous: true, all: false, opacity: 100, blend: 'normal' },
    options: () => [
      { type: 'blend', id: 'blend', label: 'Mode' },
      { type: 'scrub', id: 'opacity', label: 'Opacité', min: 1, max: 100, unit: '%' },
      { type: 'scrub', id: 'tolerance', label: 'Tolérance', min: 0, max: 255 },
      { type: 'check', id: 'antialias', label: 'Lissage' }, { type: 'check', id: 'contiguous', label: 'Pixels contigus' }, { type: 'check', id: 'all', label: 'Tous les calques' },
    ],
    down(ev, doc) {
      const target = T.paintTarget(doc);
      if (!target) return;
      const mask = floodOnTarget(doc, ev, this.o, target);
      const W = doc.width, H = doc.height, fill = U.canvas(W, H), f = fill.getContext('2d');
      f.fillStyle = U.hex(T.paintColor(target)); f.fillRect(0, 0, W, H);
      f.globalCompositeOperation = 'destination-in'; f.drawImage(mask, 0, 0);
      const tok = T.beginHist(target), x = target.canvas.getContext('2d');
      x.globalAlpha = this.o.opacity / 100;
      x.globalCompositeOperation = target.layer && target.layer.lockAlpha ? 'source-atop' : KS.blendOp(this.o.blend);
      x.drawImage(fill, -target.ox, -target.oy);
      x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
      if (target.after) target.after(); else target.layer.touch();
      T.commitHist(doc, target, tok, null, 'Pot de peinture', 'bucket');
      doc.changed();
    },
  });

  /* ---------------------------------------------------------------- dégradés */
  const presetStops = () => {
    const fg = U.hex(KS.state.fg), bg = U.hex(KS.state.bg);
    return {
      fgbg: { name: 'Premier plan → arrière-plan', stops: [[0, fg, 1], [1, bg, 1]] },
      fgt: { name: 'Premier plan → transparent', stops: [[0, fg, 1], [1, fg, 0]] },
      bw: { name: 'Noir → blanc', stops: [[0, '#000000', 1], [1, '#ffffff', 1]] },
      spectrum: { name: 'Spectre', stops: [[0, '#ff0000', 1], [0.17, '#ffff00', 1], [0.33, '#00ff00', 1], [0.5, '#00ffff', 1], [0.67, '#0000ff', 1], [0.83, '#ff00ff', 1], [1, '#ff0000', 1]] },
      sunset: { name: 'Coucher de soleil', stops: [[0, '#2b1055', 1], [0.45, '#d53369', 1], [0.75, '#f28b30', 1], [1, '#fbd786', 1]] },
      ocean: { name: 'Océan', stops: [[0, '#0f2027', 1], [0.5, '#2c5364', 1], [1, '#5fd1e6', 1]] },
      chrome: { name: 'Chrome', stops: [[0, '#2a2a2a', 1], [0.35, '#f2f2f2', 1], [0.5, '#6e6e6e', 1], [0.7, '#ffffff', 1], [1, '#3a3a3a', 1]] },
      kane: { name: 'Kane', stops: [[0, '#3d7cf0', 1], [0.5, '#8a5cf6', 1], [1, '#ec4899', 1]] },
      custom: { name: 'Personnalisé…', stops: KS.prefs.customGradient || [[0, '#000000', 1], [1, '#ffffff', 1]] },
    };
  };
  KS.gradientPresets = presetStops;
  const cssStops = stops => stops.map(s => { const c = U.parseHex(s[1]); return `rgba(${c.r},${c.g},${c.b},${s[2]}) ${s[0] * 100}%`; }).join(',');

  // Dessine le dégradé sur ctx (canevas en coordonnées cible) de a vers b
  KS.drawGradient = (ctx, type, a, b, stops, reverse) => {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    let st = stops.map(s => [...s]);
    if (reverse) st = st.map(s => [1 - s[0], s[1], s[2]]).reverse();
    const add = (g, list) => list.forEach(s => { const c = U.parseHex(s[1]); g.addColorStop(U.clamp(s[0], 0, 1), `rgba(${c.r},${c.g},${c.b},${s[2]})`); });
    const len = Math.max(0.5, Math.hypot(b.x - a.x, b.y - a.y));
    let g;
    if (type === 'linear') { g = ctx.createLinearGradient(a.x, a.y, b.x, b.y); add(g, st); }
    else if (type === 'radial') { g = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, len); add(g, st); }
    else if (type === 'angle') { g = ctx.createConicGradient(Math.atan2(b.y - a.y, b.x - a.x), a.x, a.y); add(g, st); }
    else if (type === 'reflected') {
      const ax = a.x - (b.x - a.x), ay = a.y - (b.y - a.y);
      g = ctx.createLinearGradient(ax, ay, b.x, b.y);
      add(g, [...st.map(s => [0.5 - s[0] / 2, s[1], s[2]]).reverse(), ...st.map(s => [0.5 + s[0] / 2, s[1], s[2]])]);
    }
    if (g) { ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); return; }
    // losange : calcul pixel par pixel
    const lut = U.canvas(256, 1), lx = lut.getContext('2d'), lg = lx.createLinearGradient(0, 0, 256, 0);
    add(lg, st); lx.fillStyle = lg; lx.fillRect(0, 0, 256, 1);
    const L = lx.getImageData(0, 0, 256, 1).data, img = ctx.createImageData(W, H), p = img.data;
    const ang = Math.atan2(b.y - a.y, b.x - a.x), cs = Math.cos(-ang), sn = Math.sin(-ang);
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i += 4) {
      const dx = x - a.x, dy = y - a.y, u = Math.abs(dx * cs - dy * sn), v = Math.abs(dx * sn + dy * cs);
      const t = Math.min(255, Math.round((u + v) / len * 255)) * 4;
      p[i] = L[t]; p[i + 1] = L[t + 1]; p[i + 2] = L[t + 2]; p[i + 3] = L[t + 3];
    }
    ctx.putImageData(img, 0, 0);
  };

  T.register({
    id: 'gradient', name: 'Dégradé', icon: 'gradient', shortcut: 'G', cursor: 'crosshair', altPicks: true,
    defaults: { preset: 'fgbg', type: 'linear', blend: 'normal', opacity: 100, reverse: false },
    options() {
      const P = presetStops();
      const sw = h('button.btn.small', { style: { width: '120px', background: `linear-gradient(90deg, ${cssStops(P[this.o.preset]?.stops || P.fgbg.stops)})`, border: '1px solid var(--border-2)' }, 'data-tip': 'Modifier le dégradé' });
      sw.addEventListener('click', async () => { const s = await KS.dialogs.gradientEditor(P[this.o.preset]?.stops || P.fgbg.stops); if (s) { KS.prefs.customGradient = s; KS.prefs.save(); T.setOpt(this, 'preset', 'custom'); T.renderOptions(); } });
      return [
        { type: 'custom', render: () => h('div.opt-group', sw) },
        { type: 'select', id: 'preset', options: Object.entries(P).map(([k, v]) => [k, v.name]) },
        { type: 'seg', id: 'type', options: [['linear', 'gradient', 'Linéaire'], ['radial', 'shape-ellipse', 'Radial'], ['angle', 'rotate-cw', 'Incliné'], ['reflected', 'flip-v', 'Réfléchi'], ['diamond', 'shape-polygon', 'Losange']] },
        { type: 'sep' },
        { type: 'blend', id: 'blend', label: 'Mode' },
        { type: 'scrub', id: 'opacity', label: 'Opacité', min: 1, max: 100, unit: '%' },
        { type: 'check', id: 'reverse', label: 'Inverser' },
      ];
    },
    onOption(k) { if (k === 'preset') T.renderOptions(); },
    down(ev, doc) {
      const target = T.paintTarget(doc);
      if (!target) return;
      this.target = target; this.a = { x: ev.x, y: ev.y }; this.b = this.a;
      this.buf = U.canvas(target.canvas.width, target.canvas.height);
      this.tmp = U.canvas(1, 1);
    },
    move(ev, doc) {
      if (!this.target) return;
      this.b = ev.shift ? KS.snap45(this.a, ev) : { x: ev.x, y: ev.y };
      this.need = true; doc.changed();
    },
    compose(into) {
      const t = this.target, W = t.canvas.width, H = t.canvas.height;
      const g = U.fitCanvas(this.buf, W, H), gx = g.getContext('2d');
      const off = p => ({ x: p.x - t.ox, y: p.y - t.oy });
      let stops = (presetStops()[this.o.preset] || presetStops().fgbg).stops;
      if (t.gray) stops = stops.map(s => { const c = U.parseHex(s[1]), v = Math.round(U.luma(c.r, c.g, c.b)); return [s[0], U.hex({ r: v, g: v, b: v }), s[2]]; });
      KS.drawGradient(gx, this.o.type, off(this.a), off(this.b), stops, this.o.reverse);
      const doc = KS.state.doc;
      if (doc.selection.mask) doc.selection.clip(g, t.ox, t.oy);
      const x = into.getContext('2d');
      x.globalAlpha = this.o.opacity / 100;
      x.globalCompositeOperation = t.layer && t.layer.lockAlpha ? 'source-atop' : KS.blendOp(this.o.blend);
      x.drawImage(g, 0, 0);
      x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    },
    preRender() {
      if (!this.target || !this.need || this.target.gray) return;
      this.need = false;
      const t = this.target, c = U.fitCanvas(this.tmp, t.canvas.width, t.canvas.height);
      c.getContext('2d').drawImage(t.canvas, 0, 0);
      this.compose(c);
      t.layer.override = { canvas: c, x: t.ox, y: t.oy };
    },
    up(ev, doc) {
      const t = this.target; if (!t) return;
      this.target = null;
      if (t.layer) { t.layer.override = null; }
      if (U.dist(this.a, this.b) < 1) { if (t.layer) t.layer.touch(); doc.changed(); return; }
      const tok = T.beginHist(t);
      this.target = t; this.compose(t.canvas); this.target = null;
      if (t.after) t.after(); else t.layer.touch();
      T.commitHist(doc, t, tok, null, 'Dégradé', 'gradient');
      doc.changed();
    },
    cancel() { if (this.target?.layer) { this.target.layer.override = null; this.target.layer.touch(); } this.target = null; },
    overlay(ctx) {
      if (!this.target) return;
      const a = V.toScreen(this.a.x, this.a.y), b = V.toScreen(this.b.x, this.b.y);
      ctx.save();
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.lineWidth = 1.2; ctx.strokeStyle = '#fff'; ctx.stroke();
      V.handle(ctx, a.x, a.y, 9, true); V.handle(ctx, b.x, b.y, 9, true);
      ctx.restore();
    },
  });

  /* ---------------------------------------------------------------- éditeur de dégradé */
  KS.dialogs.gradientEditor = (initial) => new Promise(res => {
    let stops = initial.map(s => [...s]);
    let sel = 0;
    const bar = h('div', { class: 'checker', style: { height: '36px', borderRadius: '6px', position: 'relative', border: '1px solid var(--border-2)', cursor: 'copy' } });
    const fillBar = h('div', { style: { position: 'absolute', inset: '0', borderRadius: '5px' } });
    const marks = h('div', { style: { position: 'relative', height: '22px', margin: '4px 0 10px' } });
    bar.appendChild(fillBar);
    const colorChip = ui.colorChip(stops[0][1], v => { stops[sel][1] = v; draw(); });
    const opS = ui.scrub({ label: 'Opacité', value: 100, min: 0, max: 100, unit: '%', onInput: v => { stops[sel][2] = v / 100; draw(); } });
    const posS = ui.scrub({ label: 'Position', value: 0, min: 0, max: 100, unit: '%', onInput: v => { stops[sel][0] = v / 100; draw(); } });
    const del = ui.btn('Supprimer', () => { if (stops.length > 2) { stops.splice(sel, 1); sel = 0; draw(); } }, '.small', 'trash');
    function draw() {
      const sorted = stops.slice().sort((a, b) => a[0] - b[0]);
      fillBar.style.background = `linear-gradient(90deg, ${cssStops(sorted)})`;
      marks.innerHTML = '';
      stops.forEach((s, i) => {
        const m = h('div', { style: { position: 'absolute', left: `calc(${s[0] * 100}% - 7px)`, top: '0', width: '14px', height: '18px', borderRadius: '3px 3px 7px 7px', background: s[1], border: `2px solid ${i === sel ? 'var(--accent)' : 'var(--border-2)'}`, cursor: 'ew-resize' } });
        m.addEventListener('pointerdown', e => {
          e.preventDefault(); sel = i; draw();
          const r = marks.getBoundingClientRect(); m.setPointerCapture(e.pointerId);
          const mv = ev => {
            const out = Math.abs(ev.clientY - r.top) > 50 && stops.length > 2;
            stops[i][0] = U.clamp((ev.clientX - r.left) / r.width, 0, 1); stops[i].gone = out; draw();
          };
          const up = () => { m.removeEventListener('pointermove', mv); m.removeEventListener('pointerup', up); if (stops[i]?.gone) { stops.splice(i, 1); sel = 0; } draw(); };
          m.addEventListener('pointermove', mv); m.addEventListener('pointerup', up);
        });
        marks.appendChild(m);
      });
      const s = stops[sel];
      if (s) { colorChip.set(s[1]); opS.set(Math.round(s[2] * 100)); posS.set(Math.round(s[0] * 100)); }
    }
    bar.addEventListener('click', e => {
      const r = bar.getBoundingClientRect(), t = U.clamp((e.clientX - r.left) / r.width, 0, 1);
      stops.push([t, U.hex(KS.state.fg), 1]); sel = stops.length - 1; draw();
    });
    draw();
    const presets = h('div.swatches', { style: { gridTemplateColumns: 'repeat(9, 1fr)', marginBottom: '12px' } });
    Object.values(presetStops()).forEach(p => {
      const s = h('div.s', { style: { background: `linear-gradient(90deg, ${cssStops(p.stops)})`, aspectRatio: '2' }, title: p.name });
      s.addEventListener('click', () => { stops = p.stops.map(x => [...x]); sel = 0; draw(); });
      presets.appendChild(s);
    });
    KS.modal({
      title: 'Éditeur de dégradé', width: 560,
      body: h('div', presets, bar, marks, h('div.form-row', colorChip, opS, posS, del), h('div.note', { style: { marginTop: '8px' }, text: 'Cliquez sur la barre pour ajouter un point de couleur ; tirez un point vers le bas pour le supprimer.' })),
      buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }],
      onClose: v => res(v === 'ok' ? stops.map(s => [s[0], s[1], s[2]]).sort((a, b) => a[0] - b[0]) : null),
    });
  });
})();

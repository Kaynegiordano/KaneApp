// Registre des outils, barre d'outils, barre d'options et routage du pointeur.
'use strict';
(() => {
  const U = KS.util, h = KS.h, ui = KS.ui, V = KS.view;
  const T = KS.tools = { list: [], byId: {}, current: null, temp: null };

  // Disposition de la barre d'outils (groupes façon Photoshop)
  T.layout = [
    ['move'], ['marquee-rect', 'marquee-ellipse', 'marquee-row', 'marquee-col'], ['lasso', 'lasso-poly', 'lasso-magnetic'], ['quick-select', 'object-select', 'wand'], ['crop'], ['eyedropper'],
    null,
    ['heal-spot', 'remove', 'heal', 'patch'], ['brush', 'pencil', 'adjust-brush'], ['clone'], ['eraser', 'eraser-magic'], ['gradient', 'bucket'], ['blur', 'sharpen', 'smudge'], ['dodge', 'burn', 'sponge'],
    null,
    ['text'], ['pen'], ['path-select'], ['shape-rect', 'shape-ellipse', 'shape-polygon', 'shape-star', 'shape-line', 'shape-arrow', 'shape-heart'],
    null,
    ['hand'], ['zoom'],
  ];
  T.groupCurrent = {};

  T.register = tool => {
    tool.o = Object.assign({}, tool.defaults || {}, (KS.prefs.toolOpts || {})[tool.id] || {});
    T.list.push(tool); T.byId[tool.id] = tool;
    return tool;
  };
  T.saveOpts = tool => { KS.prefs.toolOpts[tool.id] = tool.o; KS.prefs.save(); };
  T.setOpt = (tool, k, v) => { tool.o[k] = v; T.saveOpts(tool); tool.onOption && tool.onOption(k, v); KS.requestRender(); };

  T.select = (id, opts = {}) => {
    const t = T.byId[id];
    if (!t) return;
    if (T.current === t) return;
    if (T.current) {
      if (T.current.commitOnLeave) T.current.commitOnLeave(KS.state.doc);
      T.current.deactivate && T.current.deactivate(KS.state.doc);
    }
    T.current = t;
    const g = T.layout.find(gr => gr && gr.includes(id));
    if (g) T.groupCurrent[g[0]] = id;
    t.activate && t.activate(KS.state.doc);
    if (!opts.silent) { KS.prefs.lastTool = id; KS.prefs.save(); }
    T.renderToolbar(); T.renderOptions(); T.updateCursor();
    KS.emit('tool', t);
    KS.requestRender();
  };
  KS.cancelActiveOps = () => { const t = T.current; if (t && t.cancel) t.cancel(KS.state.doc); };

  /* ---------------------------------------------------------------- barre d'outils */
  T.renderToolbar = () => {
    const bar = KS.$('#toolbar');
    if (!bar.dataset.built) {
      bar.dataset.built = '1';
      bar.innerHTML = '';
      for (const g of T.layout) {
        if (!g) { bar.appendChild(h('div.tool-sep')); continue; }
        const b = h('button.tool-btn' + (g.length > 1 ? '.has-group' : ''), { 'data-group': g[0] });
        b.addEventListener('click', () => T.select(T.byId[T.groupCurrent[g[0]]] ? T.groupCurrent[g[0]] : g[0]));
        // comme Photoshop : double-clic sur la main = taille écran, sur la loupe = 100 %
        b.addEventListener('dblclick', () => { if (!KS.state.doc) return; if (g[0] === 'hand') V.fit(KS.state.doc, true); else if (g[0] === 'zoom') V.setZoom(1); else return; KS.requestRender(); });
        const flyout = e => { e.preventDefault(); T.flyout(g, b); };
        b.addEventListener('contextmenu', flyout);
        let lp = 0;
        b.addEventListener('pointerdown', () => { if (g.length > 1) lp = setTimeout(() => T.flyout(g, b), 380); });
        b.addEventListener('pointerup', () => clearTimeout(lp));
        b.addEventListener('pointerleave', () => clearTimeout(lp));
        bar.appendChild(b);
      }
      bar.appendChild(h('div.tool-sep'));
      // couleurs
      const well = h('div.color-well');
      const fg = h('div.sw.fg', { 'data-tip': 'Couleur de premier plan' }), bg = h('div.sw.bg', { 'data-tip': 'Couleur d\'arrière-plan' });
      fg.addEventListener('click', async () => { const c = await KS.pickColor(KS.state.fg, 'Couleur de premier plan'); if (c) KS.setFG(c); });
      bg.addEventListener('click', async () => { const c = await KS.pickColor(KS.state.bg, 'Couleur d\'arrière-plan'); if (c) KS.setBG(c); });
      const sw = h('button.mini.swap', { html: KS.icon('swap'), 'data-tip': 'Permuter', 'data-key': 'X' }); sw.addEventListener('click', () => KS.swapColors());
      const rs = h('button.mini.reset', { html: KS.icon('reset-colors'), 'data-tip': 'Couleurs par défaut', 'data-key': 'D' }); rs.addEventListener('click', () => KS.resetColors());
      well.append(bg, fg, sw, rs);
      bar.appendChild(well);
      const qm = h('button.tool-btn.qm-btn', { html: KS.icon('quick-mask'), 'data-tip': 'Mode Masque', 'data-key': 'Q', style: { marginTop: '6px' } });
      qm.addEventListener('click', () => KS.cmd.quickMask());
      bar.appendChild(qm);
      KS.on('color', T.updateWell);
      KS.on('quickmask', () => qm.classList.toggle('active', !!KS.state.doc?.quickMask));
    }
    KS.$$('.tool-btn[data-group]', bar).forEach(b => {
      const g = T.layout.find(gr => gr && gr[0] === b.dataset.group);
      const id = T.byId[T.groupCurrent[g[0]]] ? T.groupCurrent[g[0]] : g[0], t = T.byId[id];
      if (!t) return;
      b.innerHTML = KS.icon(t.icon);
      b.dataset.tip = t.name; b.dataset.key = t.shortcut || '';
      b.classList.toggle('active', g.includes(T.current?.id));
    });
    T.updateWell();
  };
  T.updateWell = () => {
    const fg = KS.$('.color-well .fg'), bg = KS.$('.color-well .bg');
    if (fg) fg.style.background = U.hex(KS.state.fg);
    if (bg) bg.style.background = U.hex(KS.state.bg);
  };
  T.flyout = (g, btn) => {
    KS.$$('.tool-flyout').forEach(e => e.remove());
    const r = btn.getBoundingClientRect();
    const f = h('div.tool-flyout', { style: { left: r.right + 6 + 'px', top: r.top + 'px' } });
    for (const id of g) {
      const t = T.byId[id]; if (!t) continue;
      const it = h('div.item' + (T.current?.id === id ? '.current' : ''), { html: KS.icon(t.icon) }, h('span', { text: t.name }), h('span.key', { text: t.shortcut || '' }));
      it.addEventListener('click', () => { f.remove(); T.select(id); });
      f.appendChild(it);
    }
    document.body.appendChild(f);
    const close = e => { if (!f.contains(e.target)) { f.remove(); document.removeEventListener('pointerdown', close, true); } };
    setTimeout(() => document.addEventListener('pointerdown', close, true));
  };
  // Raccourci d'outil : touche → groupe ; Maj+touche → outil suivant du groupe
  T.byKey = (key, shift) => {
    const groups = T.layout.filter(g => g && T.byId[g[0]] && T.byId[g[0]].shortcut === key);
    if (!groups.length) return false;
    const g = groups[0];
    const cur = T.groupCurrent[g[0]] || g[0];
    if (shift && g.includes(T.current?.id)) {
      const ids = g.filter(id => T.byId[id]);
      T.select(ids[(ids.indexOf(T.current.id) + 1) % ids.length]);
    } else T.select(cur);
    return true;
  };

  /* ---------------------------------------------------------------- barre d'options */
  T.renderOptions = () => {
    const bar = KS.$('#optionsbar');
    bar.innerHTML = '';
    const t = T.current;
    if (!t) return;
    bar.appendChild(h('div.opt-tool', { html: KS.icon(t.icon) }, h('span', { text: t.name })));
    const defs = typeof t.options === 'function' ? t.options(KS.state.doc) : (t.options || []);
    for (const d of defs) { const e = T.optControl(t, d); if (e) bar.appendChild(e); }
  };
  T.optControl = (t, d) => {
    if (!d) return null;
    const set = v => T.setOpt(t, d.id, v);
    const label = d.label ? h('span.opt-label', { text: d.label }) : null;
    switch (d.type) {
      case 'sep': return h('div.opt-sep');
      case 'scrub': return h('div.opt-group', ui.scrub({ label: d.label, value: t.o[d.id], min: d.min, max: d.max, step: d.step || 1, unit: d.unit, log: d.log, onInput: set, width: d.width }));
      case 'select': return h('div.opt-group', label, ui.select(d.options, t.o[d.id], set));
      case 'check': return h('div.opt-group', ui.check(d.label, t.o[d.id], set, d.title));
      case 'seg': return h('div.opt-group', label, ui.seg(d.options, t.o[d.id], set));
      case 'color': return h('div.opt-group', label, ui.colorChip(t.o[d.id], (v, live) => { if (!live) set(v); }, d.label));
      case 'blend': return h('div.opt-group', label, KS.blendSelect(t.o[d.id], set));
      case 'button': { const b = d.icon && !d.text ? ui.iconBtn(d.icon, d.label, d.action) : ui.btn(d.text || d.label, d.action, d.cls || '.small', d.icon); return h('div.opt-group', b); }
      case 'selmode': return h('div.opt-group', ui.seg([['new', 'marquee-rect', 'Nouvelle sélection'], ['add', 'plus', 'Ajouter à la sélection (Maj)'], ['sub', 'minus', 'Soustraire de la sélection (Alt)'], ['int', 'select-invert', 'Intersection (Maj+Alt)']], t.o.mode || 'new', set));
      case 'brush': return T.brushControl(t);
      case 'custom': return d.render();
    }
    return null;
  };
  // Taille + dureté + aperçu de l'empreinte
  T.brushControl = t => {
    const prev = h('canvas', { width: 26, height: 26, style: { borderRadius: '6px', background: 'var(--field)', border: '1px solid var(--border)' } });
    const draw = () => {
      const x = prev.getContext('2d'); x.clearRect(0, 0, 26, 26);
      const tp = KS.Brush.tip(20, (t.o.hardness ?? 100) / 100, getComputedStyle(document.body).getPropertyValue('--text').trim() || '#fff');
      x.drawImage(tp, 13 - tp.width / 2, 13 - tp.height / 2);
    };
    draw();
    const size = ui.scrub({ label: 'Taille', value: t.o.size, min: 1, max: 2500, unit: 'px', log: true, onInput: v => { T.setOpt(t, 'size', v); } });
    const hard = t.o.hardness != null ? ui.scrub({ label: 'Dureté', value: t.o.hardness, min: 0, max: 100, unit: '%', onInput: v => { T.setOpt(t, 'hardness', v); draw(); } }) : null;
    const g = h('div.opt-group', prev, size, hard);
    t._sizeCtl = size; t._hardCtl = hard; t._drawTip = draw;
    return g;
  };
  T.refreshBrushCtl = t => { if (t._sizeCtl) t._sizeCtl.set(t.o.size); if (t._hardCtl) t._hardCtl.set(t.o.hardness); if (t._drawTip) t._drawTip(); };

  /* ---------------------------------------------------------------- curseurs */
  T.updateCursor = () => {
    const t = T.temp || T.current;
    let c = 'default';
    if (T.spaceDown) c = T.panning ? 'grabbing' : 'grab';
    else if (t) c = typeof t.cursor === 'function' ? t.cursor() : (t.cursor || 'crosshair');
    document.body.classList.toggle('cursor-hidden', c === 'none');
    V.canvas.style.cursor = c === 'none' ? 'none' : c;
  };
  T.drawBrushCursor = (ctx, size, opts = {}) => {
    const m = V.mouse; if (!m || !KS.state.doc) return;
    const r = Math.max(0.5, size * V.zoom / 2);
    ctx.save();
    ctx.beginPath(); ctx.arc(m.sx, m.sy, r, 0, Math.PI * 2);
    ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.stroke();
    if (r < 6 || opts.cross) {
      ctx.beginPath(); ctx.moveTo(m.sx - 5, m.sy); ctx.lineTo(m.sx + 5, m.sy); ctx.moveTo(m.sx, m.sy - 5); ctx.lineTo(m.sx, m.sy + 5);
      ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke(); ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
    ctx.restore();
  };

  /* ---------------------------------------------------------------- cibles de peinture */
  // Calque de pixels modifiable, sinon message et null
  T.pixelLayer = (doc, { allowMaskEdit = true, quiet = false } = {}) => {
    const L = doc.active;
    const say = m => { if (!quiet) KS.toast(m, 'err'); return null; };
    if (!L) return say('Aucun calque actif');
    if (!L.visible && !(allowMaskEdit && L.editMask)) return say('Le calque est masqué : rendez-le visible pour le modifier');
    if (L.lockAll) return say('Le calque est verrouillé');
    if (L.editMask && L.mask && allowMaskEdit) return L;
    if (L.kind === 'adjust') return say('Calque de réglage : sélectionnez son masque ou un calque de pixels');
    if (L.kind === 'group') return say("Sélectionnez un calque à l'intérieur du groupe");
    if (L.kind === 'text' || L.kind === 'shape' || L.kind === 'fill') {
      KS.confirm(L.kind === 'text' ? 'Ce calque de texte doit être pixellisé avant de continuer. Son texte ne sera plus modifiable.' : L.kind === 'fill' ? 'Ce calque de remplissage doit être pixellisé avant de continuer. Ses réglages ne seront plus modifiables.' : 'Ce calque de forme doit être pixellisé avant de continuer. La forme ne sera plus vectorielle.', { ok: 'Pixelliser' })
        .then(ok => { if (ok) KS.cmd.rasterize(); });
      return null;
    }
    return L;
  };
  T.paintTarget = (doc, opts = {}) => {
    if (doc.alphaEdit && !doc.quickMask) {
      const ch = doc.alphas.find(a => a.id === doc.alphaEdit);
      if (ch) return { kind: 'alpha', canvas: ch.canvas, ox: 0, oy: 0, gray: true, after: r => KS.cmd.updateAlphaOverlay(doc, r) };
    }
    if (doc.quickMask) {
      const q = doc.quickMask;
      return { kind: 'quick', canvas: q.canvas, ox: 0, oy: 0, gray: true, after: r => KS.cmd.updateQuickOverlay(doc, r) };
    }
    const L = T.pixelLayer(doc, opts);
    if (!L) return null;
    if (L.editMask && L.mask) {
      L.ensureMaskCovers(doc.rect);
      const m = L.mask;
      return { kind: 'mask', layer: L, canvas: m.canvas, ox: m.x, oy: m.y, gray: true, after: r => L.maskChanged(r) };
    }
    L.ensureCovers(doc.rect);
    return { kind: 'layer', layer: L, canvas: L.canvas, ox: L.x, oy: L.y, gray: false };
  };
  // Historique d'une cible
  T.beginHist = (target) => target.gray && target.kind !== 'mask' ? { gray: U.copyCanvas(target.canvas) } : KS.Hist.begin(target.layer, target.kind === 'mask' ? 'mask' : 'canvas');
  T.commitHist = (doc, target, token, rect, name, icon) => {
    if (token.gray) {
      const cv = target.canvas, before = token.gray, after = U.copyCanvas(cv), done = target.after || (() => {});
      const put = src => { const x = cv.getContext('2d'); x.clearRect(0, 0, cv.width, cv.height); x.drawImage(src, 0, 0); done(); doc.changed(); };
      doc.history.push({ name, icon, undo: () => put(before), redo: () => put(after) });
      return;
    }
    KS.Hist.commitPixels(doc, name, token, rect, icon);
    KS.emit('layer-pixels', doc);
  };
  T.paintColor = target => {
    const c = KS.state.fg;
    return target.gray ? U.gray(c) : c;
  };

  /* ---------------------------------------------------------------- pointeur */
  let drag = null;
  T.spaceDown = false;
  T.isDragging = () => !!drag;
  const evOf = (e, base) => {
    const { sx, sy } = V.eventPos(e);
    const p = V.toDoc(sx, sy);
    const pen = e.pointerType === 'pen' || e.pointerType === 'touch';
    return { x: p.x, y: p.y, sx, sy, pressure: pen ? (e.pressure || 0.0001) : 1, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, button: base ? base.button : e.button, e, pen };
  };
  T.attach = () => {
    const cv = V.canvas;
    cv.addEventListener('pointerdown', e => {
      const doc = KS.state.doc;
      ui.closeMenus();
      if (document.activeElement && document.activeElement !== document.body && !document.activeElement.closest('.text-editor')) document.activeElement.blur();
      if (!doc) return;
      if (T.brushGesture?.begin(e, doc)) return;
      if (T.spring) T.spring.used = true;
      const ev = evOf(e);
      if (KS.pickingColor) {
        KS.pickingColor = false;
        const c = doc.sample(ev.x, ev.y, 1);
        KS.emit('pick-color', c);
        return;
      }
      cv.setPointerCapture(e.pointerId);
      if (e.button === 1 || T.spaceDown) {
        if (T.spaceDown && (e.ctrlKey || e.altKey)) { V.zoomStep(e.altKey ? -1 : 1, ev.sx, ev.sy); return; }
        drag = { pan: true, sx: ev.sx, sy: ev.sy, id: e.pointerId }; T.panning = true; T.updateCursor(); return;
      }
      if (e.button === 2) return;
      let t = T.current;
      // outils temporaires : Ctrl → déplacement, Alt → pipette (outils de peinture)
      if (ev.ctrl && !t.ownsCtrl && T.byId.move) t = T.byId.move;
      else if (ev.alt && t.altPicks && !ev.shift) t = T.byId.eyedropper;
      if (KS.prefs.showGuides && (t.id === 'move' || ev.ctrl) && T.guideAt(doc, ev)) { T.startGuideDrag(doc, T.guideAt(doc, ev), e); return; }
      T.temp = t !== T.current ? t : null;
      drag = { tool: t, id: e.pointerId, last: ev };
      // Alt + clic : pipette ; Alt + clic glissé : taille / dureté du pinceau (la couleur prise est rendue)
      if (t.id === 'eyedropper' && T.temp && T.brushGesture?.altLeft(T.current)) drag.altFrom = { x: e.clientX, y: e.clientY };
      // outils sans pipette (gomme, Suppression, correcteur, tampon…) : on attend de savoir si c'est un clic (geste de l'outil) ou un glissé (taille)
      else if (e.button === 0 && ev.alt && !ev.shift && !ev.ctrl && t === T.current && T.brushGesture?.altLeft(t)) { drag.altFrom = { x: e.clientX, y: e.clientY }; drag.pending = ev; KS.requestRender(); return; }
      t.down && t.down(ev, doc);
      KS.requestRender();
    });
    cv.addEventListener('pointermove', e => {
      const doc = KS.state.doc;
      const ev = evOf(e);
      V.mouse = { sx: ev.sx, sy: ev.sy, x: ev.x, y: ev.y };
      KS.emit('mouse', ev);
      if (!doc) return;
      if (T.brushGesture?.move(e)) return;
      if (drag && drag.pan) { V.pan(ev.sx - drag.sx, ev.sy - drag.sy); drag.sx = ev.sx; drag.sy = ev.sy; return; }
      if (drag && drag.guide) { T.moveGuideDrag(doc, ev); return; }
      if (drag && drag.altFrom && Math.hypot(e.clientX - drag.altFrom.x, e.clientY - drag.altFrom.y) > 6) {
        const pick = drag.tool, from = drag.altFrom;
        if (!drag.pending) { if (pick.prevFg) KS.setFG(pick.prevFg); pick.up && pick.up(ev, doc); }
        drag = null; T.temp = null;
        T.brushGesture.beginFromDrag(e, doc, from);
        return;
      }
      if (drag && drag.pending) return;
      if (drag) {
        const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ce of (list.length ? list : [e])) { const cev = evOf(ce, drag.last); drag.tool.move && drag.tool.move(cev, doc); drag.last = cev; }
      } else {
        const t = T.current;
        t && t.hover && t.hover(ev, doc);
        if (KS.prefs.showGuides && (t?.id === 'move') && T.guideAt(doc, ev)) cv.style.cursor = T.guideAt(doc, ev).dir === 'h' ? 'ns-resize' : 'ew-resize';
        else if (!T.spaceDown) T.updateCursor();
      }
      KS.requestRender();
    });
    const end = e => {
      if (T.brushGesture?.end(e)) return;
      const doc = KS.state.doc;
      if (!drag) return;
      const d = drag; drag = null;
      if (d.pan) { T.panning = false; T.updateCursor(); return; }
      if (d.guide) { T.endGuideDrag(doc, evOf(e), d); return; }
      const ev = evOf(e, d.last);
      if (d.pending && doc) d.tool.down && d.tool.down(d.pending, doc); // Alt + clic sans glisser : le clic de l'outil (source du tampon…)
      d.tool.up && doc && d.tool.up(ev, doc);
      T.temp = null;
      if (T.springBack) { const id = T.springBack; T.springBack = null; if (T.byId[id]) T.select(id); }
      T.updateCursor();
      KS.requestRender();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('lostpointercapture', end);
    cv.addEventListener('pointerleave', () => { V.mouse = null; KS.emit('mouse', null); KS.requestRender(); });
    cv.addEventListener('dblclick', e => { const doc = KS.state.doc; if (doc && T.current.dblclick) T.current.dblclick(evOf(e), doc); });
    cv.addEventListener('contextmenu', e => { e.preventDefault(); if (T.brushGesture?.contextMenu()) return; const doc = KS.state.doc; if (doc) KS.cmd.canvasContextMenu(e, evOf(e)); });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const doc = KS.state.doc; if (!doc) return;
      if (T.brushGesture?.active) return;
      const { sx, sy } = V.eventPos(e);
      const zoomMode = KS.prefs.wheelZoom ? !e.shiftKey : (e.ctrlKey || e.altKey);
      if (zoomMode && !(KS.prefs.wheelZoom && e.shiftKey)) {
        const k = Math.exp(-e.deltaY * (e.ctrlKey && Math.abs(e.deltaY) < 30 ? 0.01 : 0.0018));
        V.setZoom(V.zoom * k, sx, sy);
      } else if (e.shiftKey || e.deltaX) V.pan(-(e.deltaX || e.deltaY), 0);
      else V.pan(0, -e.deltaY);
    }, { passive: false });

    // Règles : tirer un repère
    const rulerDrag = dir => e => {
      const doc = KS.state.doc; if (!doc || !KS.prefs.showGuides) return;
      e.preventDefault();
      drag = { guide: true, dir, index: -1, id: e.pointerId, before: KS.Hist.structSnap(doc) };
      V.guideDrag = { dir, pos: null };
      const mv = ev => { T.moveGuideDrag(doc, evOf(ev)); KS.requestRender(); };
      const up = ev => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (drag && drag.guide) { const d = drag; drag = null; T.endGuideDrag(doc, evOf(ev), d); } };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    };
    V.rh.addEventListener('pointerdown', rulerDrag('h'));
    V.rv.addEventListener('pointerdown', rulerDrag('v'));
  };

  /* ---------------------------------------------------------------- repères */
  T.guideAt = (doc, ev) => {
    const tol = 4 / V.zoom;
    let i = doc.guides.h.findIndex(y => Math.abs(y - ev.y) <= tol);
    if (i >= 0) return { dir: 'h', index: i };
    i = doc.guides.v.findIndex(x => Math.abs(x - ev.x) <= tol);
    if (i >= 0) return { dir: 'v', index: i };
    return null;
  };
  T.startGuideDrag = (doc, g, e) => {
    drag = { guide: true, dir: g.dir, index: g.index, id: e.pointerId, before: KS.Hist.structSnap(doc) };
    V.guideDrag = { dir: g.dir, pos: g.dir === 'h' ? doc.guides.h[g.index] : doc.guides.v[g.index] };
    (g.dir === 'h' ? doc.guides.h : doc.guides.v).splice(g.index, 1);
  };
  T.moveGuideDrag = (doc, ev) => {
    const g = V.guideDrag; if (!g) return;
    let p = g.dir === 'h' ? ev.y : ev.x;
    p = Math.round(p);
    if (KS.prefs.snap) { const lim = g.dir === 'h' ? doc.height : doc.width; for (const s of [0, lim / 2, lim]) if (Math.abs(p - s) * V.zoom < 6) p = s; }
    g.pos = p;
    const outside = g.dir === 'h' ? ev.sy < 0 : ev.sx < 0;
    g.remove = outside;
    KS.requestRender();
  };
  T.endGuideDrag = (doc, ev, d) => {
    const g = V.guideDrag; V.guideDrag = null;
    if (!g) return;
    const outside = g.dir === 'h' ? (ev.sy < 0 || ev.sy > V.h) : (ev.sx < 0 || ev.sx > V.w);
    if (g.pos != null && !outside) (g.dir === 'h' ? doc.guides.h : doc.guides.v).push(g.pos);
    if (d && d.before) doc.history.push({ name: outside ? 'Supprimer le repère' : 'Repère', icon: 'ruler', ...KS.Hist.structPart(doc, d.before) });
    KS.requestRender();
  };

  // Aimantation d'un point (bords, centre, repères, grille)
  T.snapPoint = (doc, p) => {
    if (!KS.prefs.snap) return p;
    const tol = 7 / V.zoom;
    const xs = [0, doc.width / 2, doc.width, ...(KS.prefs.showGuides ? doc.guides.v : [])];
    const ys = [0, doc.height / 2, doc.height, ...(KS.prefs.showGuides ? doc.guides.h : [])];
    if (KS.prefs.showGrid) { const g = KS.prefs.gridSize; xs.push(Math.round(p.x / g) * g); ys.push(Math.round(p.y / g) * g); }
    let x = p.x, y = p.y;
    for (const s of xs) if (Math.abs(p.x - s) < tol) { x = s; break; }
    for (const s of ys) if (Math.abs(p.y - s) < tol) { y = s; break; }
    return { ...p, x, y };
  };
})();


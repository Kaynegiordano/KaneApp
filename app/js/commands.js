// Commandes de l'application (appelées par les menus, raccourcis et panneaux).
'use strict';
(() => {
  const U = KS.util, h = KS.h, ui = KS.ui, T = KS.tools, V = KS.view;
  const C = KS.cmd = {};
  const D = () => KS.state.doc;
  const withDoc = fn => (...a) => { const d = D(); if (!d) return; return fn(d, ...a); };

  /* ================================================================ fichier */
  C.newDoc = async (initial) => { const o = await KS.dialogs.newDoc(initial); if (o) KS.addDoc(KS.createDoc(o)); };
  C.newFromClipboard = async () => {
    const c = await C.readClipboardImage();
    if (!c) { KS.toast('Le presse-papiers ne contient pas d\'image', 'err'); return; }
    const d = new KS.Doc({ name: 'Presse-papiers', width: c.width, height: c.height });
    d.addLayer(new KS.Layer({ name: 'Calque 1', canvas: c }), 0); d.dirty = false;
    KS.addDoc(d);
  };
  C.open = () => KS.io.open();
  C.save = withDoc(d => KS.io.save(d, false));
  C.saveAs = withDoc(d => KS.io.save(d, true));
  C.exportAs = withDoc(d => KS.io.exportAs(d));
  C.quickExport = withDoc(d => KS.io.quickExport(d));
  C.place = () => KS.io.place();
  C.placeInto = () => KS.io.placeInto();
  C.close = withDoc(d => KS.closeDoc(d));
  C.closeAll = async () => { for (const d of KS.state.docs.slice()) { if (!(await KS.closeDoc(d))) return; } };
  C.revert = withDoc(async d => {
    if (!d.path) return;
    if (!(await KS.confirm(`Revenir à la version enregistrée de « ${d.name} » ? Les modifications seront perdues.`, { ok: 'Revenir' }))) return;
    const f = await KS.native.readFile(d.path); if (f.error) return KS.toast(f.error, 'err');
    const nd = await KS.io.decode(f); nd.path = d.path; nd.name = d.name;
    const i = KS.state.docs.indexOf(d); KS.state.docs[i] = nd; KS.switchDoc(nd);
  });
  C.duplicateDoc = withDoc(d => {
    const n = new KS.Doc({ name: d.name.replace(/\.[^.]+$/, '') + ' copie', width: d.width, height: d.height });
    n.layers = d.layers.map(L => L.clone(L.name));
    n.activeId = n.layers[Math.max(0, d.activeIndex)]?.id;
    n.guides = JSON.parse(JSON.stringify(d.guides));
    KS.addDoc(n);
  });

  /* ================================================================ édition */
  C.undo = withDoc(d => { if (T.current?.id === 'text' && KS.textTool.ed) return; KS.panels.defs.properties?.commitPending?.(); d.history.undo(); });
  C.redo = withDoc(d => { KS.panels.defs.properties?.commitPending?.(); d.history.redo(); });

  // Applique fn(canvasDuCalque) → nouveau canevas, sur le calque actif (ou son masque), dans la sélection
  C.applyPixels = (d, name, icon, fn, opts = {}) => {
    const L = T.pixelLayer(d);
    if (!L) return false;
    const mask = L.editMask && L.mask;
    const tgt = mask ? L.mask : L;
    if (mask) L.ensureMaskCovers(d.rect); else L.ensureCovers(d.rect);
    const tok = KS.Hist.begin(L, mask ? 'mask' : 'canvas');
    const out = fn(U.copyCanvas(tgt.canvas), { offset: { x: tgt.x, y: tgt.y }, doc: d });
    // filtres calculés en parallèle : le résultat arrive plus tard (promesse)
    if (out && typeof out.then === 'function') return out.then(res => finishPixels(d, name, icon, opts, L, mask, tgt, tok, res));
    return finishPixels(d, name, icon, opts, L, mask, tgt, tok, out);
  };
  const finishPixels = (d, name, icon, opts, L, mask, tgt, tok, res) => {
    C.blendResult(d, tgt.canvas, res, tgt.x, tgt.y, opts.ignoreSelection);
    if (mask) L.maskChanged(); else L.touch();
    KS.Hist.commitPixels(d, name, tok, d.selection.active && !opts.ignoreSelection ? U.rectIntersect({ x: d.selection.bounds.x - tgt.x, y: d.selection.bounds.y - tgt.y, w: d.selection.bounds.w, h: d.selection.bounds.h }, { x: 0, y: 0, w: tgt.canvas.width, h: tgt.canvas.height }) : null, icon);
    if (opts.fadeable !== false) C.rememberFade(d, L, mask ? 'mask' : 'canvas', tok.before.canvas, name);
    KS.emit('layer-pixels', d);
    d.changed();
    return true;
  };
  // Écrit res dans dst, en respectant la sélection (fondu par l'alpha du masque)
  C.blendResult = (d, dst, res, ox, oy, ignoreSel) => {
    const x = dst.getContext('2d');
    if (!d.selection.active || ignoreSel) { x.clearRect(0, 0, dst.width, dst.height); x.drawImage(res, 0, 0); return; }
    const t = U.copyCanvas(res); d.selection.clip(t, ox, oy);
    d.selection.cut(dst, ox, oy);
    x.drawImage(t, 0, 0);
  };
  // Aperçu en direct d'une fonction pixel ; renvoie { update(fn), cancel(), commit(name, icon) }
  C.previewPixels = (d) => {
    const L = T.pixelLayer(d);
    if (!L) return null;
    const mask = L.editMask && L.mask, tgt = mask ? L.mask : L;
    if (mask) L.ensureMaskCovers(d.rect); else L.ensureCovers(d.rect);
    const src = U.copyCanvas(tgt.canvas);
    let last = null, seq = 0;
    const api = {
      L, src,
      update(fn) {
        const n = ++seq;
        const r = fn(U.copyCanvas(src), { offset: { x: tgt.x, y: tgt.y }, doc: d });
        // résultat asynchrone : on ignore celui d'un aperçu dépassé ou annulé entre-temps
        if (r && typeof r.then === 'function') return r.then(res => { if (n === seq) show(res); });
        show(r);
      },
      cancel() { seq++; L.override = null; if (mask) L.maskChanged(); L.touch(); d.changed(); },
      commit(name, icon) {
        seq++;
        L.override = null;
        if (!last) { api.cancel(); return; }
        const tok = KS.Hist.begin(L, mask ? 'mask' : 'canvas');
        const x = tgt.canvas.getContext('2d'); x.clearRect(0, 0, tgt.canvas.width, tgt.canvas.height); x.drawImage(last, 0, 0);
        if (mask) L.maskChanged(); else L.touch();
        KS.Hist.commitPixels(d, name, tok, null, icon);
        C.rememberFade(d, L, mask ? 'mask' : 'canvas', src, name);
        KS.emit('layer-pixels', d); d.changed();
      },
    };
    const show = res => {
      const out = U.copyCanvas(src);
      C.blendResult(d, out, res, tgt.x, tgt.y);
      last = out;
      if (mask) { const m = L.mask, keep = m.canvas; m.canvas = out; L.maskChanged(); m.canvas = keep; m._preview = true; }
      else L.override = { canvas: out, x: L.x, y: L.y };
      d.changed();
    };
    return api;
  };

  // Presse-papiers
  C.copy = withDoc(async (d, merged = false) => {
    let src, ox = 0, oy = 0;
    if (merged) src = d.flatten();
    else { const L = d.active; if (!L || L.kind === 'adjust') return; if (L.kind === 'group') { const [a, b] = d.block(L); src = d.flatten(d.layers.slice(a, b + 1)); } else { src = L.image().canvas; ox = L.image().x; oy = L.image().y; } }
    const r = d.selection.bounds || (merged ? d.rect : (d.active.contentBounds() || d.rect));
    const c = U.canvas(r.w, r.h), x = c.getContext('2d');
    x.drawImage(src, ox - r.x, oy - r.y);
    if (d.selection.mask) { x.globalCompositeOperation = 'destination-in'; x.drawImage(d.selection.mask, -r.x, -r.y); }
    KS.state.clipboard = { canvas: c, x: r.x, y: r.y, w: c.width, h: c.height };
    try { const blob = await U.blobFromCanvas(c); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); } catch (e) { console.warn('presse-papiers système', e); }
    KS.toast(merged ? 'Copié avec fusion' : 'Copié', 'ok', 900);
  });
  C.cut = withDoc(async d => {
    const L = T.pixelLayer(d); if (!L) return;
    await C.copy(false);
    C.clear();
  });
  C.readClipboardImage = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) for (const t of it.types) if (t.startsWith('image/')) return U.canvasFromBlob(await it.getType(t));
    } catch (e) { console.warn(e); }
    return KS.state.clipboard ? U.copyCanvas(KS.state.clipboard.canvas) : null;
  };
  C.pasteCanvas = (c, inPlace = false) => {
    const d = D();
    if (!d) { const nd = new KS.Doc({ name: 'Presse-papiers', width: c.width, height: c.height }); nd.addLayer(new KS.Layer({ name: 'Calque 1', canvas: c }), 0); nd.dirty = false; KS.addDoc(nd); return; }
    const cb = KS.state.clipboard;
    let at = null;
    if (cb && cb.w === c.width && cb.h === c.height) { if (inPlace || true) at = { x: cb.x, y: cb.y }; c = cb.canvas; }
    if (!at) {
      const b = d.selection.bounds;
      at = b ? { x: Math.round(b.x + (b.w - c.width) / 2), y: Math.round(b.y + (b.h - c.height) / 2) } : { x: Math.round((d.width - c.width) / 2), y: Math.round((d.height - c.height) / 2) };
    }
    const L = new KS.Layer({ name: d.newLayerName('Calque'), canvas: U.copyCanvas(c), x: at.x, y: at.y });
    KS.Hist.structure(d, 'Coller', () => d.addLayer(L, d.activeIndex + 1), 'paste');
  };
  C.pasteInto = withDoc(async d => { const c = await C.readClipboardImage(); if (c) KS.io.placeIntoCanvas(d, c, 'Image collée'); else KS.toast('Rien à coller', 'err'); });
  C.paste = async (inPlace) => { const c = await C.readClipboardImage(); if (c) C.pasteCanvas(c, inPlace); else KS.toast('Rien à coller', 'err'); };
  C.clear = withDoc(d => {
    const L = T.pixelLayer(d); if (!L) return;
    if (!d.selection.active) { KS.toast('Faites d\'abord une sélection (ou supprimez le calque)', 'info'); return; }
    if (L.editMask && L.mask) return C.applyPixels(d, 'Effacer', 'trash', c => { const x = c.getContext('2d'); x.fillStyle = U.hex(KS.state.bg); x.fillRect(0, 0, c.width, c.height); return c; });
    C.applyPixels(d, 'Effacer', 'trash', c => { U.clearCanvas(c); return c; });
  });
  C.fillWith = withDoc((d, o) => {
    if (o.src === 'content') return C.contentAwareFill(d);
    const col = o.color || (o.src === 'fg' ? KS.state.fg : o.src === 'bg' ? KS.state.bg : o.src === 'black' ? { r: 0, g: 0, b: 0 } : o.src === 'white' ? { r: 255, g: 255, b: 255 } : { r: 128, g: 128, b: 128 });
    const L = d.active;
    const gray = L && L.editMask;
    C.applyPixels(d, 'Remplir', 'fill', c => {
      const out = U.copyCanvas(c), x = out.getContext('2d');
      x.globalAlpha = o.opacity ?? 1;
      x.globalCompositeOperation = o.keep || (L && L.lockAlpha) ? 'source-atop' : KS.blendOp(o.mode || 'normal');
      x.fillStyle = U.hex(gray ? U.gray(col) : col); x.fillRect(0, 0, out.width, out.height);
      return out;
    });
  });
  C.fill = async () => { if (!D()) return; const o = await KS.dialogs.fill(); if (o) C.fillWith(o); };
  C.fillFG = () => C.fillWith({ src: 'fg', keep: false });
  C.fillBG = () => C.fillWith({ src: 'bg', keep: false });
  C.contentAwareFill = d => {
    if (!d.selection.active) { KS.toast('Sélectionnez d\'abord la zone à remplacer', 'err'); return; }
    const L = T.pixelLayer(d, { allowMaskEdit: false }); if (!L) return;
    L.ensureCovers(d.rect);
    const tok = KS.Hist.begin(L);
    const m = U.canvas(L.canvas.width, L.canvas.height); m.getContext('2d').drawImage(d.selection.mask, -L.x, -L.y);
    const b = d.selection.bounds, rect = { x: b.x - L.x, y: b.y - L.y, w: b.w, h: b.h };
    const r = KS.heal(L.canvas, U.copyCanvas(L.canvas), m, rect, null);
    L.touch();
    KS.Hist.commitPixels(d, 'Remplir (contenu)', tok, r, 'sparkles');
    d.changed();
  };
  C.stroke = withDoc(async d => {
    if (!d.selection.active) { KS.toast('Le contour s\'applique à une sélection', 'err'); return; }
    const o = await KS.dialogs.stroke(); if (!o) return;
    const L = T.pixelLayer(d); if (!L) return;
    L.ensureCovers(d.rect);
    const tok = KS.Hist.begin(L);
    // bande autour du bord de la sélection via dilatation/érosion du masque
    const sel = d.selection, snap = sel.snapshot();
    const outer = U.canvas(d.width, d.height), inner = U.canvas(d.width, d.height);
    const w = o.width;
    const grow = o.pos === 'outside' ? w : o.pos === 'center' ? w / 2 : 0, shrink = o.pos === 'inside' ? w : o.pos === 'center' ? w / 2 : 0;
    if (grow) sel.expand(grow); outer.getContext('2d').drawImage(sel.mask, 0, 0); sel.restore(snap);
    if (shrink) sel.contract(shrink); if (sel.mask) inner.getContext('2d').drawImage(sel.mask, 0, 0); sel.restore(snap);
    const band = U.canvas(d.width, d.height), bx = band.getContext('2d');
    bx.drawImage(outer, 0, 0); bx.globalCompositeOperation = 'destination-out'; bx.drawImage(inner, 0, 0);
    bx.globalCompositeOperation = 'source-in'; bx.fillStyle = o.color; bx.fillRect(0, 0, d.width, d.height);
    const x = L.canvas.getContext('2d');
    x.globalAlpha = o.opacity; x.globalCompositeOperation = KS.blendOp(o.mode); x.drawImage(band, -L.x, -L.y);
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    L.touch(); KS.Hist.commitPixels(d, 'Contour', tok, null, 'stroke'); d.changed();
  });
  C.freeTransform = withDoc(d => { if (T.current?.id === 'transform') return; T.byId.transform.begin(d); });
  C.transformMode = withDoc((d, mode) => {
    const tr = T.byId.transform;
    if (T.current?.id !== 'transform' && !tr.begin(d)) return;
    tr.setMode(mode); T.renderOptions(); KS.requestRender();
  });
  C.flipLayer = withDoc((d, dir) => {
    const L = T.pixelLayer(d, { allowMaskEdit: false }); if (!L) return;
    if (d.selection.active) return T.byId.transform.begin(d, { fx: dir === 'h' ? -1 : 1, fy: dir === 'v' ? -1 : 1 }) && T.byId.transform.finish(true);
    const tok = KS.Hist.begin(L);
    const c = U.canvas(L.canvas.width, L.canvas.height), x = c.getContext('2d');
    if (dir === 'h') { x.translate(c.width, 0); x.scale(-1, 1); } else { x.translate(0, c.height); x.scale(1, -1); }
    x.drawImage(L.canvas, 0, 0);
    // symétrie autour du centre du contenu
    const b = L.contentBounds() || L.bounds();
    const cxDoc = b.x + b.w / 2, cyDoc = b.y + b.h / 2;
    const nx = dir === 'h' ? Math.round(2 * cxDoc - (L.x + L.canvas.width)) : L.x, ny = dir === 'v' ? Math.round(2 * cyDoc - (L.y + L.canvas.height)) : L.y;
    L.canvas = c; L.ctx = x; L.x = nx; L.y = ny; L.touch();
    KS.Hist.commitPixels(d, dir === 'h' ? 'Symétrie horizontale' : 'Symétrie verticale', tok, null, dir === 'h' ? 'flip-h' : 'flip-v');
    d.changed();
  });
  C.rotateLayer = withDoc((d, deg) => {
    const L = T.pixelLayer(d, { allowMaskEdit: false }); if (!L) return;
    if (T.byId.transform.begin(d, { rot: deg * Math.PI / 180 })) T.byId.transform.finish(true);
  });

  /* ================================================================ image */
  C.adjust = withDoc((d, type) => {
    if (KS.prefs.editableAdjustments === false || (d.active?.editMask && d.active.mask)) return C.adjustPixels(type);
    if (d.active?.kind === 'adjust' && d.active.adjust.type === type) return C.editAdjustment();
    return C.newEditableAdjustment(type);
  });
  C.adjustPixels = withDoc(async (d, type) => {
    const def = { ...KS.Adjust.defs[type], key: type };
    if (!(def.params || []).length && !def.custom) return C.applyPixels(d, def.name, def.icon, c => { const data = U.getData(c); KS.Adjust.apply(type, data, {}); U.putData(c, data); return c; });
    const pv = C.previewPixels(d); if (!pv) return;
    const histo = KS.Adjust.hist(U.getData(pv.src));
    const run = vals => pv.update(c => { const data = U.getData(c); KS.Adjust.apply(type, data, vals, d); U.putData(c, data); return c; });
    await KS.dialogs.params({
      title: def.name, def, values: KS.Adjust.defaults(type), histo, width: def.custom ? 340 : 520,
      preview: run, cancel: keep => { if (keep) pv.cancel(); else pv.cancel(); },
      apply: vals => { run(vals); pv.commit(def.name, def.icon); },
      auto: def.custom === 'levels' ? vals => { const tmp = U.getData(pv.src); const hh = KS.Adjust.hist(tmp); for (const ch of ['r', 'g', 'b']) { let tot = 0; for (let i = 0; i < 256; i++) tot += hh[ch][i]; let lo = 0, hi = 255, a = 0; for (; lo < 255; lo++) { a += hh[ch][lo]; if (a > tot * 0.001) break; } a = 0; for (; hi > 0; hi--) { a += hh[ch][hi]; if (a > tot * 0.001) break; } vals[ch] = { ...KS.Adjust.LV0(), inBlack: lo, inWhite: Math.max(lo + 2, hi) }; } run(vals); } : null,
    });
  });
  const pixelCmd = (name, icon, fn) => withDoc(d => C.applyPixels(d, name, icon, c => { const data = U.getData(c); fn(data); U.putData(c, data); return c; }));
  C.autoTone = pixelCmd('Ton automatique', 'levels', x => KS.Adjust.autoTone(x));
  C.autoContrast = pixelCmd('Contraste automatique', 'brightness', x => KS.Adjust.autoContrast(x));
  C.autoColor = pixelCmd('Couleur automatique', 'balance', x => KS.Adjust.autoColor(x));
  C.quickEnhance = pixelCmd('Amélioration rapide', 'sparkles', x => KS.Adjust.quickEnhance(x));
  C.desaturate = pixelCmd('Désaturation', 'bw', x => KS.Adjust.desaturate(x));
  C.equalize = pixelCmd('Égaliser', 'histogram', x => KS.Adjust.equalize(x));
  C.invert = withDoc(d => C.adjust('invert'));

  C.imageSize = withDoc(async d => {
    const o = await KS.dialogs.imageSize(d); if (!o || (o.w === d.width && o.h === d.height)) return;
    const sx = o.w / d.width, sy = o.h / d.height;
    const scaleCanvas = (c, w, hh) => {
      const out = U.canvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(hh))), x = out.getContext('2d');
      x.imageSmoothingEnabled = o.quality !== 'pixelated'; x.imageSmoothingQuality = o.quality === 'medium' ? 'medium' : 'high';
      if (o.quality === 'high' && (sx < 0.5 || sy < 0.5)) {
        let src = c; while (src.width / 2 > out.width && src.height / 2 > out.height) { const t = U.canvas(src.width / 2, src.height / 2); const tx = t.getContext('2d'); tx.imageSmoothingQuality = 'high'; tx.drawImage(src, 0, 0, t.width, t.height); src = t; }
        x.drawImage(src, 0, 0, out.width, out.height);
      } else x.drawImage(c, 0, 0, out.width, out.height);
      return out;
    };
    KS.Hist.full(d, 'Taille de l\'image', () => {
      for (const L of d.layers) {
        if (L.kind !== 'adjust') { L.canvas = scaleCanvas(L.canvas, L.canvas.width * sx, L.canvas.height * sy); L.ctx = L.canvas.getContext('2d'); L.x = Math.round(L.x * sx); L.y = Math.round(L.y * sy); }
        if (L.text) { L.text.size *= Math.min(sx, sy); L.text._pad = Math.round((L.text._pad || 0) * sx); }
        if (L.mask) { const m = L.mask; m.canvas = scaleCanvas(m.canvas, m.canvas.width * sx, m.canvas.height * sy); m.ctx = m.canvas.getContext('2d'); m.x = Math.round(m.x * sx); m.y = Math.round(m.y * sy); L.maskChanged(); }
        L.touch();
      }
      d.width = o.w; d.height = o.h; d.selection.resize();
      d.guides.h = d.guides.h.map(y => y * sy); d.guides.v = d.guides.v.map(x => x * sx);
    }, 'image-size');
    V.fit(d); KS.emit('docsize', d);
  });
  C.canvasSize = withDoc(async d => {
    const o = await KS.dialogs.canvasSize(d); if (!o) return;
    const dx = Math.round((o.w - d.width) * o.ax / 2), dy = Math.round((o.h - d.height) * o.ay / 2);
    C.resizeCanvas(d, o.w, o.h, dx, dy, o.color, 'Taille de la zone de travail');
  });
  // Nouvelle taille ; (dx,dy) = décalage du contenu ; color = remplissage de l'arrière-plan
  C.resizeCanvas = (d, w, hh, dx, dy, color = 'transparent', name = 'Zone de travail') => {
    KS.Hist.full(d, name, () => {
      for (const L of d.layers) { if (L.kind !== 'adjust') { L.x += dx; L.y += dy; } if (L.mask) { L.mask.x += dx; L.mask.y += dy; } L.touch(); }
      const bgL = d.layers[0];
      if (color !== 'transparent' && bgL && bgL.kind === 'raster' && bgL.name === 'Arrière-plan') {
        const col = color === 'bg' ? KS.state.bg : color === 'fg' ? KS.state.fg : color === 'black' ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
        const c = U.canvas(w, hh), x = c.getContext('2d'); x.fillStyle = U.hex(col); x.fillRect(0, 0, w, hh); x.drawImage(bgL.canvas, bgL.x, bgL.y);
        bgL.canvas = c; bgL.ctx = x; bgL.x = 0; bgL.y = 0; bgL.touch();
      }
      d.guides.h = d.guides.h.map(y => y + dy); d.guides.v = d.guides.v.map(x => x + dx);
      d.width = w; d.height = hh; d.selection.resize();
    }, 'canvas-size');
    V.fit(d); KS.emit('docsize', d);
  };
  C.cropTo = (d, b, deletePixels = false) => {
    const fn = () => {
      for (const L of d.layers) {
        if (L.kind !== 'adjust') { L.x -= b.x; L.y -= b.y; }
        if (L.mask) { L.mask.x -= b.x; L.mask.y -= b.y; }
        if (deletePixels && L.kind === 'raster') { const r = U.rectIntersect(L.bounds(), { x: 0, y: 0, w: b.w, h: b.h }); if (r) L.trimTo(r); else L.trimTo({ x: 0, y: 0, w: 1, h: 1 }); }
        L.touch();
      }
      d.guides.h = d.guides.h.map(y => y - b.y).filter(y => y >= 0 && y <= b.h); d.guides.v = d.guides.v.map(x => x - b.x).filter(x => x >= 0 && x <= b.w);
      d.width = b.w; d.height = b.h; d.selection.resize();
    };
    if (deletePixels) KS.Hist.full(d, 'Recadrage', fn, 'crop'); else KS.Hist.structure(d, 'Recadrage', fn, 'crop');
    V.fit(d); KS.emit('docsize', d); KS.emit('selection', d);
  };
  C.cropToSelection = withDoc(d => { const b = d.selection.bounds; if (!b) return KS.toast('Aucune sélection', 'err'); C.cropTo(d, b, false); });
  C.trim = withDoc(d => { const b = U.alphaBounds(d.flatten(), 0); if (!b) return; C.cropTo(d, b, false); });
  C.revealAll = withDoc(d => {
    let r = d.rect; for (const L of d.layers) if (L.kind !== 'adjust') { const b = L.contentBounds(); if (b) r = U.rectUnion(r, b); }
    if (r.w === d.width && r.h === d.height && !r.x && !r.y) return;
    C.cropTo(d, r, false);
  });
  C.rotateCanvas = withDoc((d, deg) => {
    const W = d.width, H = d.height, swap = deg % 180 !== 0;
    const nw = swap ? H : W, nh = swap ? W : H;
    // fonctions de rotation d'un rectangle (doc) et d'un canevas
    const rotC = c => {
      const out = U.canvas(swap ? c.height : c.width, swap ? c.width : c.height), x = out.getContext('2d');
      x.translate(out.width / 2, out.height / 2); x.rotate(deg * Math.PI / 180); x.drawImage(c, -c.width / 2, -c.height / 2);
      return out;
    };
    const rotPos = (x, y, w, hh) => {
      if (deg === 90) return { x: H - (y + hh), y: x };
      if (deg === -90 || deg === 270) return { x: y, y: W - (x + w) };
      return { x: W - (x + w), y: H - (y + hh) };
    };
    KS.Hist.full(d, deg === 180 ? 'Rotation 180°' : deg === 90 ? 'Rotation 90° horaire' : 'Rotation 90° antihoraire', () => {
      for (const L of d.layers) {
        if (L.kind !== 'adjust') { const p = rotPos(L.x, L.y, L.canvas.width, L.canvas.height); L.canvas = rotC(L.canvas); L.ctx = L.canvas.getContext('2d'); L.x = p.x; L.y = p.y; if (L.kind === 'text') L.rasterize(); }
        if (L.mask) { const m = L.mask, p = rotPos(m.x, m.y, m.canvas.width, m.canvas.height); m.canvas = rotC(m.canvas); m.ctx = m.canvas.getContext('2d'); m.x = p.x; m.y = p.y; L.maskChanged(); }
        L.touch();
      }
      d.width = nw; d.height = nh; d.selection.resize(); d.guides = { h: [], v: [] };
    }, deg > 0 ? 'rotate-cw' : 'rotate-ccw');
    V.fit(d); KS.emit('docsize', d);
  });
  C.flipCanvas = withDoc((d, dir) => {
    const W = d.width, H = d.height;
    const flipC = c => { const out = U.canvas(c.width, c.height), x = out.getContext('2d'); if (dir === 'h') { x.translate(c.width, 0); x.scale(-1, 1); } else { x.translate(0, c.height); x.scale(1, -1); } x.drawImage(c, 0, 0); return out; };
    KS.Hist.full(d, dir === 'h' ? 'Symétrie horizontale de la zone' : 'Symétrie verticale de la zone', () => {
      for (const L of d.layers) {
        if (L.kind !== 'adjust') { L.canvas = flipC(L.canvas); L.ctx = L.canvas.getContext('2d'); if (dir === 'h') L.x = W - (L.x + L.canvas.width); else L.y = H - (L.y + L.canvas.height); if (L.kind === 'text') L.rasterize(); }
        if (L.mask) { const m = L.mask; m.canvas = flipC(m.canvas); m.ctx = m.canvas.getContext('2d'); if (dir === 'h') m.x = W - (m.x + m.canvas.width); else m.y = H - (m.y + m.canvas.height); L.maskChanged(); }
        L.touch();
      }
      if (d.selection.mask) { d.selection.mask = flipC(d.selection.mask); d.selection.refresh(); }
    }, dir === 'h' ? 'flip-h' : 'flip-v');
  });

  /* ================================================================ calques */
  // Indice d'insertion « au-dessus du calque actif » (dans le groupe actif s'il est déplié)
  C.insertIndex = (d, L) => {
    const A = d.active;
    if (A && A.kind === 'group' && !A.collapsed) { L.parent = A.id; return d.layers.indexOf(A); }
    if (A) { L.parent = A.parent || null; return d.layers.indexOf(A) + 1; }
    return d.layers.length;
  };
  C.newLayer = withDoc(d => {
    const L = new KS.Layer({ name: d.newLayerName(), w: 1, h: 1 });
    KS.Hist.structure(d, 'Nouveau calque', () => d.addLayer(L, C.insertIndex(d, L)), 'new-layer');
  });
  C.newLayerDialog = withDoc(async d => {
    const name = await KS.prompt('Nouveau calque', 'Nom', d.newLayerName());
    if (name == null) return;
    const L = new KS.Layer({ name: name || d.newLayerName() });
    KS.Hist.structure(d, 'Nouveau calque', () => d.addLayer(L, C.insertIndex(d, L)), 'new-layer');
  });
  // Copie d'un bloc (calque ou groupe avec son contenu), parents remappés
  C.cloneBlock = (d, L) => {
    const [a, b] = d.block(L), src = d.layers.slice(a, b + 1), map = new Map();
    const out = src.map(l => { const c = l.clone(l === L ? l.name + ' copie' : l.name); map.set(l.id, c); return c; });
    out.forEach((c, i) => { const p = src[i].parent; c.parent = map.has(p) ? map.get(p).id : (p ?? null); });
    return out;
  };
  C.duplicateLayer = withDoc(d => {
    const list = d.selected; if (!list.length) return;
    KS.Hist.structure(d, list.length > 1 ? 'Dupliquer les calques' : 'Dupliquer le calque', () => {
      const ids = [];
      for (const L of list.slice().reverse()) {
        const blk = C.cloneBlock(d, L), top = blk[blk.length - 1];
        d.layers.splice(d.layers.indexOf(L) + 1, 0, ...blk);
        ids.push(top.id);
      }
      d.activeId = ids[0]; d.selectedIds = new Set(ids); d.changed();
    }, 'duplicate');
  });
  C.deleteLayer = withDoc(d => {
    const list = d.selected; if (!list.length) return;
    const remaining = d.layers.filter(l => !list.some(x => x === l || d.isDescendant(l, x)) && l.kind !== 'group');
    if (!remaining.length) { KS.toast('Un document doit garder au moins un calque', 'err'); return; }
    KS.Hist.structure(d, list.length > 1 ? 'Supprimer les calques' : list[0].kind === 'group' ? 'Supprimer le groupe' : 'Supprimer le calque', () => list.forEach(L => d.removeLayer(L)), 'trash');
  });
  // Grouper les calques sélectionnés (Ctrl+G)
  C.groupLayers = withDoc(d => {
    const list = d.selected; if (!list.length) return;
    const top = list[list.length - 1];
    const G = new KS.Layer({ name: d.newLayerName('Groupe'), kind: 'group', parent: top.parent || null });
    KS.Hist.structure(d, 'Grouper les calques', () => {
      d.layers.splice(d.block(top)[1] + 1, 0, G);
      // on range les blocs juste sous le groupe, du haut vers le bas
      for (const L of list.slice().reverse()) {
        const blk = d.takeBlock(L);
        L.parent = G.id;
        d.layers.splice(d.layers.indexOf(G), 0, ...blk);
      }
      d.activeId = G.id; d.selectedIds = new Set([G.id]); d.changed();
    }, 'group');
  });
  C.ungroup = withDoc(d => {
    const G = d.active; if (!G || G.kind !== 'group') return;
    KS.Hist.structure(d, 'Dissocier les calques', () => {
      const kids = d.children(G);
      kids.forEach(k => { k.parent = G.parent || null; });
      d.layers.splice(d.layers.indexOf(G), 1);
      d.activeId = kids.length ? kids[kids.length - 1].id : null;
      d.selectedIds = new Set(kids.map(k => k.id)); d.changed();
    }, 'group');
  });
  C.layerViaCopy = withDoc((d, cut = false) => {
    const L = d.active; if (!L) return;
    if (!d.selection.active) { if (!cut) C.duplicateLayer(); return; }
    if (L.kind !== 'raster') { KS.toast('Calque de pixels requis', 'err'); return; }
    const img = L.image();
    const c = U.canvas(d.width, d.height), x = c.getContext('2d'); x.drawImage(L.canvas, L.x, L.y);
    d.selection.clip(c);
    const b = d.selection.bounds;
    const N = new KS.Layer({ name: d.newLayerName(), canvas: U.copyCanvas(c, b), x: b.x, y: b.y });
    void img;
    if (cut) {
      const before = KS.Hist.structSnap(d), tok = KS.Hist.begin(L);
      L.ensureCovers(d.rect); d.selection.cut(L.canvas, L.x, L.y); L.touch();
      d.addLayer(N, d.layers.indexOf(L) + 1);
      KS.Hist.commitPixels(d, 'Calque par couper', tok, null, 'cut', KS.Hist.structPart(d, before));
      KS.emit('layers', d);
    } else KS.Hist.structure(d, 'Calque par copier', () => d.addLayer(N, d.layers.indexOf(L) + 1), 'copy');
  });
  C.newAdjustLayer = withDoc((d, type) => {
    const def = KS.Adjust.defs[type];
    const L = new KS.Layer({ name: def.name, kind: 'adjust', adjust: { type, params: KS.Adjust.defaults(type) } });
    L.addMask(d, d.selection.active ? 'selection' : 'reveal');
    KS.Hist.structure(d, 'Calque de réglage ' + def.name, () => d.addLayer(L, d.activeIndex + 1), 'adjust');
    KS.panels.focus('properties');
  });
  C.newFillLayer = withDoc(async d => {
    const c = await KS.pickColor(KS.state.fg, 'Calque de remplissage : couleur unie'); if (!c) return;
    const L = new KS.Layer({ name: d.newLayerName('Couleur unie'), w: d.width, h: d.height });
    L.ctx.fillStyle = U.hex(c); L.ctx.fillRect(0, 0, d.width, d.height);
    L.addMask(d, d.selection.active ? 'selection' : 'reveal');
    KS.Hist.structure(d, 'Calque de remplissage', () => d.addLayer(L, d.activeIndex + 1), 'fill');
  });
  C.layerStyle = withDoc((d, section) => { const L = d.active; if (!L || L.kind === 'adjust' || L.kind === 'group') return; KS.dialogs.layerStyle(d, L, section || 'shadow'); });
  C.clearStyle = withDoc(d => { const L = d.active; if (L && L.effects) KS.Hist.structure(d, 'Effacer le style', () => { L.effects = null; L.touch(); }, 'fx'); });
  C.addMask = withDoc((d, mode) => {
    const L = d.active; if (!L) return;
    if (L.mask) { L.editMask = true; KS.emit('layers', d); return; }
    const m = mode || (d.selection.active ? 'selection' : 'reveal');
    KS.Hist.structure(d, 'Masque de fusion', () => { L.addMask(d, m); L.editMask = true; }, 'mask');
  });
  C.deleteMask = withDoc(d => { const L = d.active; if (L?.mask) KS.Hist.structure(d, 'Supprimer le masque', () => { L.mask = null; L.editMask = false; L.touch(); }, 'mask'); });
  C.toggleMask = withDoc(d => { const L = d.active; if (L?.mask) KS.Hist.structure(d, L.mask.enabled ? 'Désactiver le masque' : 'Activer le masque', () => { L.mask.enabled = !L.mask.enabled; L.touch(); }, 'mask'); });
  C.invertMask = withDoc(d => {
    const L = d.active; if (!L?.mask) return;
    const tok = KS.Hist.begin(L, 'mask'), x = L.mask.ctx;
    x.globalCompositeOperation = 'difference'; x.fillStyle = '#fff'; x.fillRect(0, 0, L.mask.canvas.width, L.mask.canvas.height); x.globalCompositeOperation = 'source-over';
    L.mask.outside = 255 - (L.mask.outside ?? 255);
    L.maskChanged(); KS.Hist.commitPixels(d, 'Négatif du masque', tok, null, 'invert'); d.changed();
  });
  C.applyMask = withDoc(d => {
    const L = d.active; if (!L?.mask || L.kind !== 'raster') return;
    KS.Hist.full(d, 'Appliquer le masque', () => {
      L.ensureCovers(d.rect);
      const img = L._decorate({ canvas: L.canvas, x: L.x, y: L.y }, false);
      const fx = L.effects; L.effects = null;
      const r = L._decorate({ canvas: L.canvas, x: L.x, y: L.y }, false);
      L.effects = fx; void img;
      L.canvas = U.copyCanvas(r.canvas); L.ctx = L.canvas.getContext('2d'); L.mask = null; L.editMask = false; L.touch();
    }, 'mask');
  });
  C.toggleClip = withDoc(d => { const L = d.active; if (!L || d.activeIndex === 0) return; KS.Hist.structure(d, L.clip ? 'Libérer le masque d\'écrêtage' : 'Masque d\'écrêtage', () => { L.clip = !L.clip; L.touch(); }, 'arrow-down'); });
  C.arrange = withDoc((d, where) => {
    const L = d.active; if (!L) return;
    const sib = d.layers.filter(l => (l.parent || null) === (L.parent || null)), i = sib.indexOf(L);
    const j = where === 'up' ? i + 1 : where === 'down' ? i - 1 : where === 'front' ? sib.length - 1 : 0;
    if (j < 0 || j >= sib.length || j === i) return;
    KS.Hist.structure(d, 'Disposition', () => d.moveBlock(L, sib[j], { above: j > i }), where === 'up' || where === 'front' ? 'arrow-up' : 'arrow-down');
  });
  // Fusionne une liste de calques en un calque de pixels (à la place du plus haut)
  C.mergeList = (d, list, name) => {
    KS.Hist.full(d, name, () => {
      const all = []; for (const L of list) { const [a, b] = d.block(L); all.push(...d.layers.slice(a, b + 1)); }
      const keep = d.layers.filter(l => all.includes(l));
      const c = d.flatten(keep);
      const top = list[list.length - 1];
      const N = new KS.Layer({ name: top.kind === 'group' ? top.name : top.name, canvas: c, parent: top.parent || null });
      const idx = d.layers.indexOf(top);
      d.layers.splice(idx + 1, 0, N);
      d.layers = d.layers.filter(l => !all.includes(l));
      d.activeId = N.id; d.selectedIds = new Set([N.id]);
    }, 'merge');
  };
  C.mergeDown = withDoc(d => {
    if (d.selected.length > 1) return C.mergeList(d, d.selected, 'Fusionner les calques');
    if (d.active && d.active.kind === 'group') return C.mergeList(d, [d.active], 'Fusionner le groupe');
    const i = d.activeIndex; if (i <= 0) return;
    const top = d.layers[i], bot = d.layers[i - 1];
    if (bot.kind !== 'raster' || (bot.parent || null) !== (top.parent || null)) { KS.toast('Le calque inférieur doit être un calque de pixels du même groupe', 'err'); return; }
    KS.Hist.full(d, 'Fusionner vers le bas', () => {
      const r = U.rectUnion(bot.bounds(), d.rect);
      const c = U.canvas(r.w, r.h), x = c.getContext('2d');
      const sub = new KS.Doc({ width: r.w, height: r.h });
      const shift = l => { const k = l.clone(l.name); k.x -= r.x; k.y -= r.y; if (k.mask) { k.mask.x -= r.x; k.mask.y -= r.y; } k.clip = false; k.touch(); return k; };
      const b2 = shift(bot); b2.opacity = 1; b2.blend = 'normal';
      sub.composeInto(x, [b2, shift(top)]);
      bot.canvas = c; bot.ctx = x; bot.x = r.x; bot.y = r.y; bot.mask = null; bot.effects = null; bot.editMask = false; bot.touch();
      d.layers.splice(i, 1); d.activeId = bot.id;
    }, 'merge');
  });
  C.mergeVisible = withDoc(d => {
    const vis = d.layers.filter(l => d.shown(l) && l.kind !== 'group');
    if (vis.length < 2) return;
    KS.Hist.full(d, 'Fusionner les calques visibles', () => {
      const c = d.flatten(vis);
      const L = new KS.Layer({ name: vis[0].name === 'Arrière-plan' ? 'Arrière-plan' : 'Fusion', canvas: c });
      const idx = d.layers.indexOf(vis[0]);
      d.layers = d.layers.filter(l => !vis.includes(l) && !(l.kind === 'group' && d.shown(l)));
      d.layers.forEach(l => { if (l.parent && !d.layerById(l.parent)) l.parent = null; });
      L.parent = null;
      d.layers.splice(Math.min(idx, d.layers.length), 0, L);
      d.activeId = L.id;
    }, 'merge');
  });
  C.stampVisible = withDoc(d => {
    const L = new KS.Layer({ name: d.newLayerName('Fusion'), canvas: d.flatten() });
    KS.Hist.structure(d, 'Tampon des calques visibles', () => d.addLayer(L, d.layers.length), 'merge');
  });
  C.flatten = withDoc(d => {
    KS.Hist.full(d, 'Aplatir l\'image', () => {
      const c = U.canvas(d.width, d.height), x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, d.width, d.height); x.drawImage(d.flatten(), 0, 0);
      const L = new KS.Layer({ name: 'Arrière-plan', canvas: c });
      d.layers = [L]; d.activeId = L.id;
    }, 'merge');
  });
  C.rasterize = withDoc(d => { const L = d.active; if (L && (L.kind === 'text' || L.kind === 'shape' || L.kind === 'fill')) KS.Hist.structure(d, L.kind === 'text' ? 'Pixelliser le texte' : L.kind === 'fill' ? 'Pixelliser le remplissage' : 'Pixelliser la forme', () => L.rasterize(), 'rasterize'); });
  C.toggleVisible = (L) => { const d = D(); if (!d) return; KS.Hist.structure(d, L.visible ? 'Masquer le calque' : 'Afficher le calque', () => { L.visible = !L.visible; }, L.visible ? 'eye-off' : 'eye'); };
  C.selectAllLayers = withDoc(d => { d.selectedIds = new Set(d.layers.filter(l => !l.parent).map(l => l.id)); KS.emit('layers', d); });
  C.soloLayer = (L) => {
    const d = D(); if (!d) return;
    const others = d.layers.filter(l => l !== L);
    const solo = others.every(l => !l.visible);
    KS.Hist.structure(d, 'Afficher / masquer', () => { L.visible = true; others.forEach(l => { l.visible = solo; }); }, 'eye');
  };
  C.selectFromLayer = (L, mode = 'new') => {
    const d = D(); if (!d || L.kind === 'adjust') return;
    if (L.kind === 'group') { const [a, b] = d.block(L), c = d.flatten(d.layers.slice(a, b + 1)); return KS.Hist.selection(d, 'Charger la sélection', () => d.selection.combine(x => x.drawImage(c, 0, 0), mode), 'select-all'); }
    KS.Hist.selection(d, 'Charger la sélection', () => d.selection.fromLayer(L, mode), 'select-all');
  };
  C.selectFromMask = (L) => {
    const d = D(); if (!d || !L.mask) return;
    KS.Hist.selection(d, 'Charger le masque', () => d.selection.combine(c => c.drawImage(L.mask.alpha, L.mask.x, L.mask.y), 'new'), 'mask');
  };
  C.trimLayer = withDoc(d => {
    const L = d.active; if (!L || L.kind !== 'raster') return;
    const b = L.contentBounds(); if (!b) return;
    KS.Hist.full(d, 'Rogner le calque', () => L.trimTo(b), 'trim');
  });
  // Calques de pixels concernés par un déplacement (groupes → descendants)
  C.movable = d => {
    const out = new Set();
    for (const L of d.selected) {
      if (L.kind === 'group') d.descendants(L).forEach(x => x.kind !== 'group' && out.add(x));
      else out.add(L);
    }
    return [...out];
  };
  C.boundsOf = list => { let r = null; for (const L of list) { const b = L.kind === 'adjust' ? null : L.contentBounds(); if (b) r = U.rectUnion(r, b); } return r; };
  C.align = withDoc((d, k) => {
    const items = d.selected;
    if (items.length > 1) {
      // plusieurs calques : alignés sur leur boîte commune
      const R = C.boundsOf(C.movable(d)); if (!R) return;
      KS.Hist.structure(d, 'Aligner', () => {
        for (const it of items) {
          const ls = it.kind === 'group' ? d.descendants(it).filter(x => x.kind !== 'group') : [it];
          const b = C.boundsOf(ls); if (!b) continue;
          let dx = 0, dy = 0;
          if (k === 'l') dx = R.x - b.x; if (k === 'r') dx = R.x + R.w - (b.x + b.w); if (k === 'hc') dx = Math.round(R.x + R.w / 2 - (b.x + b.w / 2));
          if (k === 't') dy = R.y - b.y; if (k === 'b') dy = R.y + R.h - (b.y + b.h); if (k === 'vc') dy = Math.round(R.y + R.h / 2 - (b.y + b.h / 2));
          ls.forEach(L => C.shiftLayer(L, dx, dy));
        }
      }, 'move');
      return;
    }
    const L = d.active; if (!L || L.kind === 'adjust') return;
    const ls = L.kind === 'group' ? d.descendants(L).filter(x => x.kind !== 'group') : [L];
    const b = C.boundsOf(ls); if (!b) return;
    const R = d.selection.bounds || d.rect;
    let dx = 0, dy = 0;
    if (k === 'l') dx = R.x - b.x; if (k === 'r') dx = R.x + R.w - (b.x + b.w); if (k === 'hc') dx = Math.round(R.x + R.w / 2 - (b.x + b.w / 2));
    if (k === 't') dy = R.y - b.y; if (k === 'b') dy = R.y + R.h - (b.y + b.h); if (k === 'vc') dy = Math.round(R.y + R.h / 2 - (b.y + b.h / 2));
    if (!dx && !dy) return;
    KS.Hist.structure(d, 'Aligner', () => ls.forEach(x => C.shiftLayer(x, dx, dy)), 'move');
  });
  C.shiftLayer = (L, dx, dy) => {
    if (L.kind !== 'adjust' && L.kind !== 'group') { L.x += dx; L.y += dy; }
    if (L.mask && (L.mask.linked || L.kind === 'adjust' || L.kind === 'group')) { L.mask.x += dx; L.mask.y += dy; }
    L.touch();
  };
  // Répartir (3 calques ou plus) : centres espacés régulièrement
  C.distribute = withDoc((d, axis) => {
    const items = d.selected.map(it => ({ it, ls: it.kind === 'group' ? d.descendants(it).filter(x => x.kind !== 'group') : [it] })).map(o => ({ ...o, b: C.boundsOf(o.ls) })).filter(o => o.b);
    if (items.length < 3) { KS.toast('Sélectionnez au moins trois calques', 'info'); return; }
    const c = o => axis === 'h' ? o.b.x + o.b.w / 2 : o.b.y + o.b.h / 2;
    items.sort((a, b) => c(a) - c(b));
    const first = c(items[0]), last = c(items[items.length - 1]), step = (last - first) / (items.length - 1);
    KS.Hist.structure(d, 'Répartir', () => items.forEach((o, i) => { const delta = Math.round(first + step * i - c(o)); o.ls.forEach(L => C.shiftLayer(L, axis === 'h' ? delta : 0, axis === 'v' ? delta : 0)); }), 'move');
  });
  C.nudge = withDoc((d, dx, dy) => {
    const L = d.active; if (!L || L.lockAll) return;
    if (d.selection.active && L.kind === 'raster') {
      const mv = T.byId.move;
      mv.down({ x: 0, y: 0, alt: false, ctrl: false, shift: false }, d);
      mv.move({ x: dx, y: dy, shift: false }, d);
      mv.preRender(d); mv.up({}, d);
      return;
    }
    const last = d.history.items[d.history.pos];
    if (last && last.nudge && last.layer === L && performance.now() - last.t < 1200) {
      L.x += dx; L.y += dy; if (L.mask && L.mask.linked) { L.mask.x += dx; L.mask.y += dy; }
      L.touch(); last.redoSnap = KS.Hist.structSnap(d); last.t = performance.now(); d.changed(); return;
    }
    const before = KS.Hist.structSnap(d);
    if (L.kind !== 'adjust') { L.x += dx; L.y += dy; }
    if (L.mask && (L.mask.linked || L.kind === 'adjust')) { L.mask.x += dx; L.mask.y += dy; }
    L.touch();
    const part = KS.Hist.structPart(d, before);
    const e = { name: 'Déplacer', icon: 'move', nudge: true, layer: L, t: performance.now(), undo: part.undo, redo: () => { if (e.redoSnap) { const s = e.redoSnap; d.layers = s.layers.slice(); for (const [l, p] of s.props) l.setProps(p); } else part.redo(); } };
    d.history.push(e);
  });
  C.removeBackground = withDoc(async d => {
    const L = T.pixelLayer(d, { allowMaskEdit: false }); if (!L) return;
    const sel = C.subjectMask(d, L);
    if (!sel) { KS.toast('Impossible de distinguer le sujet du fond', 'err'); return; }
    KS.Hist.structure(d, 'Supprimer l\'arrière-plan', () => {
      const prev = d.selection.mask; d.selection.mask = sel; d.selection.refresh();
      L.mask = null; L.addMask(d, 'selection');
      d.selection.mask = prev; d.selection.refresh();
    }, 'sparkles');
    KS.toast('Arrière-plan masqué (masque de fusion modifiable)', 'ok');
  });
  // Masque du sujet : on retire ce qui ressemble aux bords et y est relié
  C.subjectMask = (d, L) => {
    const W = d.width, H = d.height;
    const src = L ? (() => { const c = U.canvas(W, H); c.getContext('2d').drawImage(L.image().canvas, L.image().x, L.image().y); return c; })() : d.composite();
    const s = Math.min(1, 900 / Math.max(W, H)), w = Math.max(2, Math.round(W * s)), hh = Math.max(2, Math.round(H * s));
    const sm = U.canvas(w, hh); sm.getContext('2d').drawImage(U.blurCanvas(src, 1.5 / s), 0, 0, w, hh);
    const p = U.getData(sm).data;
    // couleurs de bord (moyennes par segments) et tolérance adaptative
    const border = [];
    for (let x = 0; x < w; x++) border.push(x, 0, x, hh - 1);
    for (let y = 0; y < hh; y++) border.push(0, y, w - 1, y);
    let sum = 0, cnt = 0;
    const bc = [];
    for (let i = 0; i < border.length; i += 2) { const q = (border[i + 1] * w + border[i]) * 4; bc.push([p[q], p[q + 1], p[q + 2], p[q + 3]]); }
    for (let i = 1; i < bc.length; i++) { sum += Math.abs(bc[i][0] - bc[i - 1][0]) + Math.abs(bc[i][1] - bc[i - 1][1]) + Math.abs(bc[i][2] - bc[i - 1][2]); cnt++; }
    const tol = U.clamp(18 + (sum / cnt) * 2.2, 18, 70);
    const bg = new Uint8Array(w * hh), stack = [];
    for (let i = 0; i < border.length; i += 2) stack.push(border[i], border[i + 1]);
    const close = (a, b) => Math.abs(p[a] - p[b]) + Math.abs(p[a + 1] - p[b + 1]) + Math.abs(p[a + 2] - p[b + 2]);
    // diffusion : un pixel rejoint le fond s'il ressemble à son voisin déjà « fond »
    const seedQ = [];
    for (let i = 0; i < stack.length; i += 2) { const k = stack[i + 1] * w + stack[i]; if (!bg[k]) { bg[k] = 1; seedQ.push(k); } }
    while (seedQ.length) {
      const k = seedQ.pop(), x = k % w, y = (k / w) | 0, q = k * 4;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= hh) continue;
        const nk = ny * w + nx; if (bg[nk]) continue;
        if (p[nk * 4 + 3] < 10 || close(q, nk * 4) < tol * 0.55) { bg[nk] = 1; seedQ.push(nk); }
      }
    }
    let fg = 0; for (let i = 0; i < bg.length; i++) if (!bg[i]) fg++;
    if (fg < w * hh * 0.01 || fg > w * hh * 0.98) return null;
    const img = new ImageData(w, hh);
    for (let i = 0; i < bg.length; i++) img.data[i * 4 + 3] = bg[i] ? 0 : 255;
    const small = U.canvas(w, hh); U.putData(small, img);
    const big = U.canvas(W, H), bx = big.getContext('2d'); bx.imageSmoothingQuality = 'high'; bx.drawImage(small, 0, 0, W, H);
    // lissage des bords : flou puis seuil doux
    const bl = U.blurCanvas(big, Math.max(1, 1.2 / s)), dd = U.getData(bl), q = dd.data;
    for (let i = 3; i < q.length; i += 4) q[i] = U.clamp((q[i] - 90) * 255 / 75, 0, 255);
    const out = U.canvas(W, H); U.putData(out, dd);
    return out;
  };

  /* ================================================================ sélection */
  C.selectAll = withDoc(d => KS.Hist.selection(d, 'Tout sélectionner', () => d.selection.all(), 'select-all'));
  C.deselect = withDoc(d => { if (T.current?.id === 'crop' || !d.selection.active) return; KS.Hist.selection(d, 'Désélectionner', () => d.selection.clear(), 'select-none'); });
  C.reselect = withDoc(d => KS.Hist.selection(d, 'Resélectionner', () => d.selection.reselect(), 'select-all'));
  C.invertSelection = withDoc(d => KS.Hist.selection(d, 'Intervertir', () => d.selection.invert(), 'select-invert'));
  const modify = (name, label, fn, icon = 'select-all') => withDoc(async d => {
    if (!d.selection.active) { KS.toast('Aucune sélection', 'err'); return; }
    const v = await KS.prompt(name, label, KS.prefs['mod_' + name] || 5, { type: 'number', min: 1, max: 500, unit: 'pixels' });
    if (!v) return;
    KS.prefs['mod_' + name] = v; KS.prefs.save();
    await KS.busy(() => KS.Hist.selection(d, name, () => fn(d.selection, v), icon));
  });
  C.feather = modify('Contour progressif', 'Rayon', (s, v) => s.feather(v));
  C.expand = modify('Dilater', 'Dilater de', (s, v) => s.expand(v));
  C.contract = modify('Contracter', 'Contracter de', (s, v) => s.contract(v));
  C.smooth = modify('Lisser', 'Rayon', (s, v) => s.smooth(v));
  C.border = modify('Bordure', 'Largeur', (s, v) => s.border(v));
  C.selectSubject = withDoc(async d => {
    const m = await KS.busy(() => C.subjectMask(d, null));
    if (!m) { KS.toast('Sujet introuvable : essayez la sélection rapide', 'err'); return; }
    KS.Hist.selection(d, 'Sélectionner le sujet', () => d.selection.combineCanvas(m, 'new'), 'sparkles');
  });
  C.colorRange = withDoc(async d => {
    let color = { ...KS.state.fg }, fuzz = 40;
    const data = U.getData(d.composite()).data, W = d.width, H = d.height;
    const prev = d.selection.snapshot();
    const build = () => {
      const img = new ImageData(W, H), o = img.data;
      for (let i = 0; i < W * H; i++) {
        const q = i * 4, dist = Math.max(Math.abs(data[q] - color.r), Math.abs(data[q + 1] - color.g), Math.abs(data[q + 2] - color.b));
        o[q + 3] = dist <= fuzz ? 255 : dist <= fuzz * 2 ? 255 * (1 - (dist - fuzz) / fuzz) : 0;
      }
      const c = U.canvas(W, H); U.putData(c, img); return c;
    };
    const apply = U.throttle(() => { d.selection.mask = build(); d.selection.refresh(); KS.requestRender(); }, 120);
    const chip = ui.colorChip(U.hex(color), v => { color = U.parseHex(v); apply(); });
    const pick = ui.btn('Prélever dans l\'image', () => { KS.pickingColor = true; m.back.style.display = 'none'; KS.once('pick-color', c => { m.back.style.display = ''; if (c) { color = c; chip.set(U.hex(c)); apply(); } }); }, '.small', 'eyedropper');
    const body = h('div.form-col', { style: { width: '380px', gap: '12px' } },
      h('div.form-row', h('span.opt-label', { text: 'Couleur' }), chip, pick),
      ui.paramRow({ id: 'f', label: 'Tolérance', min: 0, max: 200 }, fuzz, v => { fuzz = v; apply(); }),
      h('div.note', { text: 'Sélectionne toutes les zones proches de la couleur, avec un fondu progressif.' }));
    const m = KS.modal({
      title: 'Plage de couleurs', body, seeThrough: true,
      buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }],
      onClose: v => {
        const after = d.selection.snapshot();
        d.selection.restore(prev);
        if (v === 'ok') KS.Hist.selection(d, 'Plage de couleurs', () => d.selection.restore(after), 'palette');
      },
    });
    apply();
  });
  C.refineEdge = withDoc(async d => {
    if (!d.selection.active) { KS.toast('Faites d\'abord une sélection', 'err'); return; }
    const orig = d.selection.snapshot();
    const vals = { smooth: 0, feather: 0, contrast: 0, shift: 0 };
    const defs = { params: [
      { id: 'smooth', label: 'Lisser', min: 0, max: 50, unit: 'px' }, { id: 'feather', label: 'Contour progressif', min: 0, max: 100, step: 0.5, unit: 'px' },
      { id: 'contrast', label: 'Contraste', min: 0, max: 100, unit: '%' }, { id: 'shift', label: 'Décalage du contour', min: -100, max: 100, unit: '%' },
    ] };
    const run = U.throttle(() => {
      d.selection.restore(orig);
      const s = d.selection;
      if (vals.smooth) s.smooth(vals.smooth);
      if (vals.shift > 0) s.expand(Math.round(vals.shift / 10)); else if (vals.shift < 0) s.contract(Math.round(-vals.shift / 10));
      if (vals.feather) s.feather(vals.feather);
      if (vals.contrast && s.mask) {
        const dd = U.getData(s.mask), q = dd.data, k = 1 + vals.contrast / 12;
        for (let i = 3; i < q.length; i += 4) q[i] = U.clamp((q[i] - 128) * k + 128, 0, 255);
        U.putData(s.mask, dd); s.refresh();
      }
      KS.requestRender();
    }, 150);
    const content = KS.buildParamUI(defs, vals, run);
    let m = null;
    m = KS.modal({
      title: 'Sélectionner et masquer', body: h('div', content), seeThrough: true, width: 520,
      left: [ui.btn('Sortie : masque de fusion', () => m && m.close('mask'), '.small', 'mask')],
      buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }],
      onClose: v => {
        const after = d.selection.snapshot();
        d.selection.restore(orig);
        if (!v) return;
        KS.Hist.selection(d, 'Sélectionner et masquer', () => d.selection.restore(after), 'select-all');
        if (v === 'mask') C.addMask('selection');
      },
    });
  });
  C.quickMask = withDoc(d => {
    if (!d.quickMask) {
      const c = U.canvas(d.width, d.height), x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, d.width, d.height);
      if (d.selection.mask) {
        x.fillStyle = '#000'; x.fillRect(0, 0, d.width, d.height);
        const t = U.canvas(d.width, d.height), tx = t.getContext('2d'); tx.fillStyle = '#fff'; tx.fillRect(0, 0, d.width, d.height);
        tx.globalCompositeOperation = 'destination-in'; tx.drawImage(d.selection.mask, 0, 0); x.drawImage(t, 0, 0);
      }
      d.quickMask = { canvas: c, overlay: U.canvas(d.width, d.height), selBefore: d.selection.snapshot() };
      C.updateQuickOverlay(d);
      KS.toast('Mode Masque : peignez en noir pour masquer, en blanc pour sélectionner (Q pour sortir)', 'info', 3500);
    } else {
      const q = d.quickMask; d.quickMask = null;
      const dd = U.getData(q.canvas), p = dd.data; let all = true;
      for (let i = 0; i < p.length; i += 4) { if (p[i] < 250) all = false; p[i + 3] = p[i]; p[i] = p[i + 1] = p[i + 2] = 0; }
      const m = U.canvas(d.width, d.height); U.putData(m, dd);
      const before = q.selBefore;
      d.selection.restore(before);
      KS.Hist.selection(d, 'Quitter le mode Masque', () => { if (all) d.selection.clear(); else { d.selection.mask = m; d.selection.refresh(); } }, 'quick-mask');
    }
    KS.emit('quickmask', d); d.changed();
  });
  C.updateQuickOverlay = (d, r) => {
    const q = d.quickMask; if (!q) return;
    const R = r ? U.rectIntersect(U.rectInt(r), { x: 0, y: 0, w: d.width, h: d.height }) : { x: 0, y: 0, w: d.width, h: d.height };
    if (!R) return;
    const src = U.getData(q.canvas, R), s = src.data, out = new ImageData(R.w, R.h), o = out.data;
    for (let i = 0; i < s.length; i += 4) { o[i] = 255; o[i + 1] = 30; o[i + 2] = 40; o[i + 3] = (255 - s[i]) * 0.5; }
    q.overlay.getContext('2d').putImageData(out, R.x, R.y);
    d.changed();
  };

  /* ================================================================ filtres */
  C.filter = withDoc(async (d, id) => {
    const def = KS.Filters.defs[id];
    if (!def) return;
    KS.state.lastFilter = id;
    const run = (c, vals, info) => def.apply(c, vals, { ...info, fg: KS.state.fg, bg: KS.state.bg });
    if (!def.params.length) return KS.busy(() => C.applyPixels(d, def.name, 'filter', (c, info) => run(c, {}, info)));
    const pv = C.previewPixels(d); if (!pv) return;
    const vals = Object.fromEntries(def.params.filter(p => p.id).map(p => [p.id, (KS.prefs.filterVals?.[id] || {})[p.id] ?? p.def]));
    await KS.dialogs.params({
      title: def.name, def: { ...def, key: id }, values: vals, width: 520,
      preview: v => pv.update((c, info) => run(c, v, info)),
      cancel: () => pv.cancel(),
      apply: async v => {
        KS.prefs.filterVals = { ...(KS.prefs.filterVals || {}), [id]: { ...v } }; KS.prefs.save();
        await KS.busy(() => pv.update((c, info) => run(c, v, info)));
        pv.commit(def.name, 'filter');
      },
    });
  });
  // Sélection > Agrandir / Sélection similaire (Photoshop) : ajoute les pixels dont la couleur est
  // proche de celles déjà sélectionnées (tolérance de la baguette magique) ; Agrandir ne garde que
  // ceux qui touchent la sélection, Sélection similaire les prend dans toute l'image.
  C.growSelection = withDoc((d, similar = false) => {
    const sel = d.selection;
    if (!sel.active) { KS.toast('Faites d\'abord une sélection.', 'err'); return; }
    const wand = T.byId.wand, tol = (wand?.o.tolerance ?? 32), W = d.width, H = d.height;
    const px = KS.sampleData(d, wand?.o.all).data, m = U.getData(sel.mask).data;
    // plage de couleurs sélectionnées (2e–98e centiles par canal), élargie de la tolérance
    const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    let n = 0;
    for (let i = 0; i < m.length; i += 4) if (m[i + 3] > 127) { hist[0][px[i]]++; hist[1][px[i + 1]]++; hist[2][px[i + 2]]++; n++; }
    if (!n) return;
    const range = hist.map(hh => { let lo = 0, hi = 255, a = 0; for (; lo < 255; lo++) { a += hh[lo]; if (a > n * 0.02) break; } a = 0; for (; hi > 0; hi--) { a += hh[hi]; if (a > n * 0.02) break; } return [Math.max(0, lo - tol), Math.min(255, hi + tol)]; });
    const ok = i => px[i] >= range[0][0] && px[i] <= range[0][1] && px[i + 1] >= range[1][0] && px[i + 1] <= range[1][1] && px[i + 2] >= range[2][0] && px[i + 2] <= range[2][1];
    const out = new Uint8Array(W * H);
    if (similar) { for (let p = 0; p < W * H; p++) if (m[p * 4 + 3] > 127 || ok(p * 4)) out[p] = 1; }
    else {
      // diffusion depuis la sélection vers les voisins de couleur proche
      const stack = new Int32Array(W * H); let sp = 0;
      for (let p = 0; p < W * H; p++) if (m[p * 4 + 3] > 127) { out[p] = 1; stack[sp++] = p; }
      while (sp) {
        const p = stack[--sp], x = p % W, y = (p / W) | 0;
        for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
          if (q < 0 || out[q] || !ok(q * 4)) continue;
          out[q] = 1; stack[sp++] = q;
        }
      }
    }
    const c = U.canvas(W, H), img = new ImageData(W, H);
    for (let p = 0; p < W * H; p++) if (out[p]) img.data[p * 4 + 3] = 255;
    U.putData(c, img);
    KS.Hist.selection(d, similar ? 'Sélection similaire' : 'Agrandir', () => sel.combineCanvas(c, 'add'), 'select-all');
  });
  C.lastFilter = () => { if (KS.state.lastFilter) C.filter(KS.state.lastFilter); };
  // Ctrl+F : répète le dernier filtre avec les mêmes réglages, sans boîte de dialogue
  C.repeatFilter = withDoc(d => {
    const id = KS.state.lastFilter, def = id && KS.Filters.defs[id];
    if (!def) return;
    const vals = Object.fromEntries(def.params.filter(p => p.id).map(p => [p.id, (KS.prefs.filterVals?.[id] || {})[p.id] ?? p.def]));
    KS.busy(() => C.applyPixels(d, def.name, 'filter', (c, info) => def.apply(c, vals, { ...info, fg: KS.state.fg, bg: KS.state.bg })));
  });

  /* ---------------------------------------------------------------- atténuer */
  // Ctrl+Maj+F, juste après un filtre ou un réglage : mélange le résultat avec l'état d'avant
  // (opacité et mode de fusion), comme Édition > Atténuer de Photoshop.
  C.rememberFade = (d, L, which, before, name) => {
    const tgt = which === 'mask' ? L.mask : L;
    d.fade = { L, which, before, after: U.copyCanvas(tgt.canvas), x: tgt.x, y: tgt.y, name, pos: d.history.pos };
  };
  C.canFade = () => {
    const d = D(), f = d && d.fade;
    if (!f || f.pos !== d.history.pos || !d.layers.includes(f.L)) return false;
    const tgt = f.which === 'mask' ? f.L.mask : f.L;
    return !!tgt && tgt.canvas.width === f.after.width && tgt.canvas.height === f.after.height && tgt.x === f.x && tgt.y === f.y;
  };
  C.fade = withDoc(d => {
    if (!C.canFade()) { KS.toast("Rien à atténuer : appliquez d'abord un filtre ou un réglage.", "err"); return; }
    const f = d.fade, L = f.L, mask = f.which === 'mask', tgt = mask ? L.mask : L;
    const tok = KS.Hist.begin(L, f.which);
    let op = 100, mode = 'normal';
    const paint = () => {
      const x = tgt.canvas.getContext('2d');
      x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
      x.clearRect(0, 0, tgt.canvas.width, tgt.canvas.height);
      x.drawImage(f.before, 0, 0);
      x.globalAlpha = op / 100; x.globalCompositeOperation = KS.blendOp(mode);
      x.drawImage(f.after, 0, 0);
      x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
      if (mask) L.maskChanged(); else L.touch();
      d.changed();
    };
    const live = U.throttle(paint, 40);
    const o = ui.scrub({ value: op, min: 0, max: 100, unit: '%', onInput: v => { op = v; live(); } });
    const b = KS.blendSelect(mode, v => { mode = v; paint(); });
    KS.modal({
      title: 'Atténuer : ' + f.name, width: 380, seeThrough: true,
      body: h('div.form-grid', h('label.l', { text: 'Opacité' }), o, h('label.l', { text: 'Mode' }), b),
      buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }],
      onClose: v => {
        if (v !== 'ok') { op = 100; mode = 'normal'; paint(); return; }
        paint();
        KS.Hist.commitPixels(d, 'Atténuer : ' + f.name, tok, null, 'filter');
        d.fade = null;
        KS.emit('layer-pixels', d);
      },
    });
  });
  C.cameraRaw = () => C.adjust('cameraRaw');

  /* ================================================================ affichage */
  C.zoomIn = () => { if (D()) V.zoomStep(1); };
  C.zoomOut = () => { if (D()) V.zoomStep(-1); };
  C.fit = () => { if (D()) V.fit(D(), true); };
  C.actual = () => { if (D()) V.setZoom(1); };
  C.zoom200 = () => { if (D()) V.setZoom(2); };
  C.togglePref = (k, after) => { KS.prefs[k] = !KS.prefs[k]; KS.prefs.save(); after && after(); KS.requestRender(); KS.emit('prefs'); };
  C.toggleRulers = () => C.togglePref('rulers', () => V.setRulers(KS.prefs.rulers));
  C.toggleGrid = () => C.togglePref('showGrid');
  C.toggleGuides = () => C.togglePref('showGuides');
  C.toggleSnap = () => C.togglePref('snap');
  C.togglePixelGrid = () => C.togglePref('pixelGrid');
  C.newGuide = withDoc(async d => {
    const dir = await new Promise(res => {
      let o = 'h', pos = 0;
      const f = h('input.field', { type: 'text', value: '0', style: { width: '90px' } });
      f.addEventListener('keydown', e => e.stopPropagation());
      KS.modal({ title: 'Nouveau repère', body: h('div.form-grid', h('label.l', { text: 'Orientation' }), ui.seg([['h', 'Horizontale'], ['v', 'Verticale']], 'h', v => { o = v; }), h('label.l', { text: 'Position' }), h('div.form-row', f, h('span.note', { text: 'px' }))), buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }], onClose: v => { pos = parseFloat(f.value); res(v === 'ok' && !isNaN(pos) ? { o, pos } : null); } });
    });
    if (!dir) return;
    KS.Hist.structure(d, 'Nouveau repère', () => (dir.o === 'h' ? d.guides.h : d.guides.v).push(dir.pos), 'ruler');
    KS.prefs.showGuides = true; KS.requestRender();
  });
  C.clearGuides = withDoc(d => KS.Hist.structure(d, 'Effacer les repères', () => { d.guides = { h: [], v: [] }; }, 'ruler'));
  C.fullscreen = () => { if (KS.native?.toggleFullscreen) KS.native.toggleFullscreen(); else if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else document.documentElement.requestFullscreen().catch(() => {}); };
  C.togglePanels = () => { document.body.classList.remove('no-dock'); document.body.classList.toggle('no-panels'); setTimeout(() => V.resize(), 0); };
  // Maj+Tab : masquer les panneaux de droite seulement (outils et options restent)
  C.toggleDock = () => { document.body.classList.remove('no-panels'); document.body.classList.toggle('no-dock'); setTimeout(() => V.resize(), 0); };
  // F : modes d'écran comme Photoshop — standard, plein écran avec menus, plein écran (image seule)
  C.screenMode = (next = ((KS.state.screenMode || 0) + 1) % 3) => {
    const was = KS.state.screenMode || 0; KS.state.screenMode = next;
    if (!!was !== !!next) C.fullscreen();
    document.body.classList.toggle('screen-full', next === 2);
    setTimeout(() => V.resize(), 60);
    KS.tools.brushGesture?.flash(['Mode écran standard', 'Plein écran avec menus', 'Plein écran (F ou Échap pour revenir)'][next]);
  };
  // Ctrl+H : afficher / masquer les extras
  C.toggleExtras = () => { V.hideExtras = !V.hideExtras; KS.tools.brushGesture?.flash(V.hideExtras ? 'Extras masqués (Ctrl+H)' : 'Extras affichés'); KS.requestRender(); };
  // Alt + clic sur la vignette d'un masque : le voir seul ; encore une fois pour revenir
  C.viewMask = L => {
    const d = D(); if (!d || !L?.mask) return;
    if (d.maskView === L) d.maskView = null;
    else { d.maskView = L; d.setActive(L); L.editMask = true; KS.tools.brushGesture?.flash('Masque affiché seul — Alt+clic sur sa vignette pour revenir'); }
    KS.emit('layers', d); KS.emit('active-layer', d); KS.requestRender();
  };
  // Chiffres avec un outil sans opacité (déplacement, sélection…) : opacité du calque, comme Photoshop ; deux chiffres vite = valeur exacte
  let layerDigit = null;
  C.layerOpacityKey = digit => {
    const d = D(), L = d?.active; if (!L) return false;
    const now = performance.now();
    let v = digit === '0' ? 100 : +digit * 10;
    if (layerDigit && now - layerDigit.t < 700 && layerDigit.L === L) { v = +(layerDigit.k + digit); layerDigit = null; } else layerDigit = { k: digit, t: now, L };
    KS.Hist.structure(d, 'Opacité du calque', () => { L.opacity = v / 100; d.changed(); }, 'layers');
    KS.tools.brushGesture?.flash('Opacité du calque : ' + v + ' %');
    return true;
  };
  C.resetWorkspace = () => { KS.prefs.panels = {}; KS.prefs.dockWidth = 300; KS.prefs.save(); KS.panels.groups = []; KS.panels.build(); };

  /* ================================================================ couleurs */
  KS.setFG = (c, fromPanel) => { KS.state.fg = { r: c.r, g: c.g, b: c.b }; KS.emit('color', KS.state.fg, fromPanel); };
  KS.setBG = (c, fromPanel) => { KS.state.bg = { r: c.r, g: c.g, b: c.b }; KS.emit('color', KS.state.bg, fromPanel); };
  KS.swapColors = () => { const a = KS.state.fg; KS.state.fg = KS.state.bg; KS.state.bg = a; KS.emit('color'); };
  KS.resetColors = () => { KS.state.fg = { r: 0, g: 0, b: 0 }; KS.state.bg = { r: 255, g: 255, b: 255 }; KS.emit('color'); };

  /* ================================================================ menu contextuel de la toile */
  // clic droit avec un outil de pinceau : le sélecteur de forme (Photoshop) ; « Autres actions… » ouvre le menu habituel
  C.canvasContextMenu = (e, ev, menuOnly) => {
    const d = D(); if (!d) return;
    const t = T.current;
    if (!menuOnly && !e.shiftKey && T.brushGesture?.sizeable(t)) { T.brushGesture.picker(t, e.clientX, e.clientY, () => C.canvasContextMenu(e, ev, true)); return; }
    const sel = d.selection.active;
    const items = [];
    if (t && t.contextItems) items.push(...t.contextItems(d), { sep: true });
    if (sel) items.push(
      { label: 'Désélectionner', kb: 'Ctrl+D', action: C.deselect, icon: 'select-none' },
      { label: 'Intervertir la sélection', kb: 'Ctrl+Maj+I', action: C.invertSelection, icon: 'select-invert' },
      { label: 'Contour progressif…', kb: 'Maj+F6', action: C.feather },
      { label: 'Sélectionner et masquer…', action: C.refineEdge },
      { sep: true },
      { label: 'Calque par copier', kb: 'Ctrl+J', action: () => C.layerViaCopy(false), icon: 'copy' },
      { label: 'Calque par couper', kb: 'Ctrl+Maj+J', action: () => C.layerViaCopy(true), icon: 'cut' },
      { label: 'Transformation manuelle', kb: 'Ctrl+T', action: C.freeTransform, icon: 'transform' },
      { sep: true },
      { label: 'Remplir…', kb: 'Maj+F5', action: C.fill, icon: 'fill' },
      { label: 'Remplir (contenu pris en compte)', action: () => C.contentAwareFill(d), icon: 'sparkles' },
      { label: 'Contour…', action: C.stroke, icon: 'stroke' });
    else items.push(
      { label: 'Tout sélectionner', kb: 'Ctrl+A', action: C.selectAll, icon: 'select-all' },
      { label: 'Sélectionner le sujet', action: C.selectSubject, icon: 'sparkles' },
      { label: 'Resélectionner', kb: 'Ctrl+Maj+D', action: C.reselect, disabled: !d.selection.last },
      { sep: true },
      { label: 'Coller', kb: 'Ctrl+V', action: () => C.paste(), icon: 'paste' },
      { label: 'Transformation manuelle', kb: 'Ctrl+T', action: C.freeTransform, icon: 'transform' },
      { label: 'Nouveau calque', kb: 'Ctrl+Maj+N', action: C.newLayer, icon: 'new-layer' });
    const under = KS.layerAt(d, ev.x, ev.y);
    if (under) items.push({ sep: true }, { head: 'Calque sous le pointeur' }, { label: under.name, icon: 'layers', action: () => d.setActive(under) });
    ui.menu(items, e.clientX, e.clientY);
  };
})();

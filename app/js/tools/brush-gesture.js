// Gestes sur la zone de travail, sans peindre sur le document (comme Photoshop, et un peu plus) :
//   Alt + clic droit glissé (ou Alt + clic gauche glissé)  : taille (horizontal) / dureté (vertical)
//   Ctrl + Alt + clic droit glissé                          : opacité (horizontal) / flux (vertical)
//   Maj + Alt + clic droit                                  : sélecteur de couleur au curseur (carré + bande de teinte)
'use strict';
(() => {
  const T = KS.tools, V = KS.view, U = KS.util;
  // Tout outil à empreinte ronde qui a une taille : pinceaux, gomme, Suppression, correcteurs, tampon, densité, pinceau de réglage…
  const sizeable = t => !!t && !!t.o && Number.isFinite(t.o.size) && t.cursor === 'none';
  const SQ = 200, BAR = 26, GAP = 10; // sélecteur de couleur : carré saturation/luminosité + bande de teinte
  let gesture = null, suppressUntil = 0;
  const G = T.brushGesture = {};
  Object.defineProperty(G, 'active', { get: () => !!gesture });
  G.sizeable = sizeable;
  // Alt + clic gauche glissé : sauf les outils qui peignent déjà avec Alt (sélection rapide, pinceau de réglage)
  G.altLeft = t => sizeable(t) && !t.altPaints;

  const hudEl = () => { const el = KS.h('div.brush-hud', { 'aria-label': 'Réglage du pinceau' }); KS.$('#overlay-ui').appendChild(el); return el; };
  function placeHud(el, sx, sy) {
    el.style.left = U.clamp(sx + 18, 8, Math.max(8, V.w - el.offsetWidth - 8)) + 'px';
    el.style.top = U.clamp(sy + 20, 8, Math.max(8, V.h - el.offsetHeight - 8)) + 'px';
  }
  function label(g) {
    const t = g.tool;
    if (g.mode === 'color') return U.hex(KS.state.fg).toUpperCase();
    if (g.mode === 'opacity') return `Opacité : ${t.o.opacity} %${g.hasFlow ? ' · Flux : ' + t.o.flow + ' %' : ''}`;
    return `Taille : ${t.o.size} px${g.hasHardness ? ' · Dureté : ' + t.o.hardness + ' %' : ''}`;
  }
  function refresh() {
    if (!gesture) return;
    const g = gesture, t = g.tool;
    if (g.mode !== 'color') { T.refreshBrushCtl(t); if (t.id === 'quick-select' || g.mode === 'opacity') T.renderOptions(); }
    g.hud.textContent = label(g);
    if (g.mode === 'color') placeHud(g.hud, g.ox + SQ + GAP + BAR - 18, g.oy + SQ - 12);
    else { const p = V.toScreen(g.point.x, g.point.y); placeHud(g.hud, p.x, p.y); }
    KS.requestRender();
  }
  function start(e, doc, mode, from) {
    const tool = T.current;
    const pos = V.eventPos(e), point = V.toDoc(pos.sx, pos.sy);
    gesture = { tool, doc, mode, id: e.pointerId, startX: from ? from.x : e.clientX, startY: from ? from.y : e.clientY, zoom: V.zoom, point,
      size: tool.o.size, hardness: tool.o.hardness, hasHardness: Number.isFinite(tool.o.hardness),
      opacity: tool.o.opacity, flow: tool.o.flow, hasFlow: Number.isFinite(tool.o.flow), hud: hudEl() };
    if (mode === 'color') {
      const g = gesture; g.fg = { ...KS.state.fg }; g.hsv = U.rgb2hsv(KS.state.fg);
      // comme Photoshop : la couleur actuelle se trouve sous le curseur à l'ouverture
      g.ox = U.clamp(pos.sx - g.hsv.s * SQ, 6, Math.max(6, V.w - SQ - GAP - BAR - 6));
      g.oy = U.clamp(pos.sy - (1 - g.hsv.v) * SQ, 6, Math.max(6, V.h - SQ - 6));
      g.hud.classList.add('color');
    }
    if (!V.canvas.hasPointerCapture(e.pointerId)) V.canvas.setPointerCapture(e.pointerId);
    V.mouse = { ...pos, ...point };
    V.canvas.style.cursor = mode === 'color' ? 'crosshair' : 'none';
    refresh(); return true;
  }
  // Alt + clic droit (Ctrl : opacité, Maj : couleur)
  G.begin = (e, doc) => {
    if (e.button === 2 && !e.altKey && !gesture) suppressUntil = 0;
    const tool = T.current;
    if (gesture || T.isDragging() || KS.modalOpen() || KS.pickingColor || T.spaceDown || e.button !== 2 || !e.altKey) return false;
    const mode = e.shiftKey ? 'color' : (e.ctrlKey || e.metaKey) ? 'opacity' : 'size';
    if (mode === 'color' ? !tool : !sizeable(tool)) return false;
    if (mode === 'opacity' && !Number.isFinite(tool.o.opacity)) return false;
    e.preventDefault();
    return start(e, doc, mode);
  };
  // Alt + clic gauche glissé : la pipette du simple clic laisse la place au réglage de taille dès que le pointeur bouge
  G.beginFromDrag = (e, doc, from) => {
    if (gesture || !sizeable(T.current)) return false;
    return start(e, doc, 'size', from);
  };
  G.move = e => {
    const g = gesture;
    if (!g || e.pointerId !== g.id) return false;
    e.preventDefault();
    if (KS.state.doc !== g.doc || (g.mode !== 'color' && T.current !== g.tool)) { G.finish(true); return true; }
    if (g.mode === 'color') {
      const { sx, sy } = V.eventPos(e);
      if (sx >= g.ox + SQ + GAP / 2) g.hsv.h = U.clamp((sy - g.oy) / SQ, 0, .9999) * 360;
      else { g.hsv.s = U.clamp((sx - g.ox) / SQ, 0, 1); g.hsv.v = U.clamp(1 - (sy - g.oy) / SQ, 0, 1); }
      KS.setFG(U.hsv2rgb(g.hsv));
      refresh(); return true;
    }
    const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
    const delta = v => Math.abs(v) <= 3 ? 0 : v - Math.sign(v) * 3;
    if (g.mode === 'opacity') {
      g.tool.o.opacity = U.clamp(Math.round(g.opacity + delta(dx) * .4), 1, 100);
      if (g.hasFlow) g.tool.o.flow = U.clamp(Math.round(g.flow - delta(dy) * .4), 1, 100);
    } else {
      const min = g.tool.id === 'quick-select' ? 2 : 1, max = g.tool.id === 'quick-select' ? 800 : 2500;
      g.tool.o.size = U.clamp(Math.round(g.size + 2 * delta(dx) / Math.max(.01, g.zoom)), min, max);
      if (g.hasHardness) g.tool.o.hardness = U.clamp(Math.round(g.hardness + delta(dy) * .5), 0, 100);
    }
    refresh(); return true;
  };
  G.finish = cancel => {
    const g = gesture; if (!g) return;
    gesture = null; suppressUntil = Date.now() + 500;
    if (g.mode === 'color') { if (cancel) KS.setFG(g.fg); }
    else if (cancel) { Object.assign(g.tool.o, { size: g.size, hardness: g.hardness, opacity: g.opacity, flow: g.flow }); }
    else T.saveOpts(g.tool);
    g.hud.remove();
    if (V.canvas.hasPointerCapture(g.id)) V.canvas.releasePointerCapture(g.id);
    T.refreshBrushCtl(g.tool); T.renderOptions(); T.updateCursor(); KS.requestRender();
  };
  G.end = e => {
    if (!gesture || e.pointerId !== gesture.id) return false;
    e.preventDefault();
    G.finish(e.type !== 'pointerup'); return true;
  };
  G.contextMenu = () => !!gesture || Date.now() < suppressUntil;
  G.draw = ctx => {
    const g = gesture; if (!g) return;
    ctx.save();
    if (g.mode === 'color') {
      const { ox, oy, hsv } = g, bx = ox + SQ + GAP;
      ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 18;
      ctx.fillStyle = U.hex(U.hsv2rgb({ h: hsv.h, s: 1, v: 1 })); ctx.fillRect(ox, oy, SQ, SQ);
      ctx.shadowBlur = 0;
      let gr = ctx.createLinearGradient(ox, 0, ox + SQ, 0); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = gr; ctx.fillRect(ox, oy, SQ, SQ);
      gr = ctx.createLinearGradient(0, oy, 0, oy + SQ); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, '#000'); ctx.fillStyle = gr; ctx.fillRect(ox, oy, SQ, SQ);
      gr = ctx.createLinearGradient(0, oy, 0, oy + SQ);
      for (let i = 0; i <= 6; i++) gr.addColorStop(i / 6, U.hex(U.hsv2rgb({ h: (i * 60) % 360, s: 1, v: 1 })));
      ctx.fillStyle = gr; ctx.fillRect(bx, oy, BAR, SQ);
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.strokeRect(ox + .5, oy + .5, SQ - 1, SQ - 1); ctx.strokeRect(bx + .5, oy + .5, BAR - 1, SQ - 1);
      // repères : point de la couleur, curseur de teinte, ancienne / nouvelle couleur
      const px = ox + hsv.s * SQ, py = oy + (1 - hsv.v) * SQ, hy = oy + hsv.h / 360 * SQ;
      ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.strokeRect(bx - 2, hy - 3, BAR + 4, 6);
      ctx.fillStyle = U.hex(g.fg); ctx.fillRect(ox, oy + SQ + 6, SQ / 2, 14);
      ctx.fillStyle = U.hex(KS.state.fg); ctx.fillRect(ox + SQ / 2, oy + SQ + 6, SQ / 2, 14);
    } else {
      const p = V.toScreen(g.point.x, g.point.y), radius = Math.max(.5, g.tool.o.size * V.zoom / 2);
      const hardness = g.hasHardness ? g.tool.o.hardness / 100 : 1;
      const alpha = g.mode === 'opacity' ? .7 * g.tool.o.opacity / 100 : .5;
      ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      const tint = g.mode === 'opacity' ? KS.state.fg : { r: 239, g: 68, b: 68 }, rgba = a => `rgba(${tint.r},${tint.g},${tint.b},${a})`;
      if (hardness >= .99) ctx.fillStyle = rgba(alpha * .9);
      else {
        const gradient = ctx.createRadialGradient(p.x, p.y, radius * hardness, p.x, p.y, radius);
        gradient.addColorStop(0, rgba(alpha)); gradient.addColorStop(1, rgba(0)); ctx.fillStyle = gradient;
      }
      ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke();
      ctx.lineWidth = 1; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    }
    ctx.restore();
  };
  // Bulle brève près du curseur (raccourcis [ ], chiffres, modes de fusion…) à la place d'une notification
  let flashEl = null, flashTimer = 0;
  G.flash = text => {
    if (!flashEl || !flashEl.isConnected) { flashEl = hudEl(); flashEl.classList.add('flash'); }
    flashEl.textContent = text;
    const m = V.mouse || { sx: V.w / 2 - 60, sy: V.h / 2 - 20 };
    placeHud(flashEl, m.sx, m.sy);
    clearTimeout(flashTimer); flashTimer = setTimeout(() => { flashEl?.remove(); flashEl = null; }, 900);
  };
  window.addEventListener('keydown', e => {
    if (!gesture) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); G.finish(true); return; }
    // Ne pas changer d'outil ou déclencher une commande au milieu du geste.
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  window.addEventListener('keyup', e => { if (gesture && e.key === 'Alt') { e.preventDefault(); G.finish(false); } }, true);
  window.addEventListener('blur', () => G.finish(false));
  KS.on('doc', () => { if (gesture && KS.state.doc !== gesture.doc) G.finish(true); });
  KS.on('tool', () => { if (gesture && gesture.mode !== 'color' && T.current !== gesture.tool) G.finish(true); });
})();

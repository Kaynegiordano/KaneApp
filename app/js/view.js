// Vue : dessine le document actif (damier, composition, grille, repères,
// sélection, surcouches d'outil) et convertit écran <-> document.
'use strict';
(() => {
  const U = KS.util;
  const V = KS.view = {
    canvas: null, ctx: null, dpr: 1, w: 0, h: 0, zoom: 1, ox: 0, oy: 0, phase: 0, mouse: null,
    rulerSize: 20,
  };
  let raf = 0;

  KS.requestRender = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; V.render(); }); };

  V.init = () => {
    V.canvas = KS.$('#view');
    V.ctx = V.canvas.getContext('2d');
    V.vp = KS.$('#viewport');
    V.rh = KS.$('#ruler-h'); V.rv = KS.$('#ruler-v'); V.rc = KS.$('#ruler-corner');
    new ResizeObserver(() => V.resize()).observe(V.vp);
    V.resize();
    setInterval(() => {
      const d = KS.state.doc;
      if (d && (d.selection.edges || KS.tools?.current?.animated)) { V.phase = (V.phase + 1) % 8; KS.requestRender(); }
    }, 110);
    V.readTheme();
  };
  V.readTheme = () => {
    const cs = getComputedStyle(document.body);
    V.colors = {
      workspace: cs.getPropertyValue('--workspace').trim() || '#0e1013',
      ruler: cs.getPropertyValue('--ruler').trim(), rulerInk: cs.getPropertyValue('--ruler-ink').trim(),
      border: cs.getPropertyValue('--border').trim(), accent: cs.getPropertyValue('--accent').trim(),
    };
    V.checker = null;
    KS.requestRender();
  };
  V.resize = () => {
    const rul = V.vp.classList.contains('rulers') ? V.rulerSize : 0;
    const W = V.vp.clientWidth - rul, H = V.vp.clientHeight - rul;
    V.dpr = window.devicePixelRatio || 1;
    V.w = W; V.h = H;
    V.canvas.width = Math.max(1, Math.round(W * V.dpr)); V.canvas.height = Math.max(1, Math.round(H * V.dpr));
    V.canvas.style.width = W + 'px'; V.canvas.style.height = H + 'px';
    if (rul) {
      V.rh.width = Math.round(W * V.dpr); V.rh.height = Math.round(rul * V.dpr); V.rh.style.width = W + 'px'; V.rh.style.height = rul + 'px';
      V.rv.width = Math.round(rul * V.dpr); V.rv.height = Math.round(H * V.dpr); V.rv.style.width = rul + 'px'; V.rv.style.height = H + 'px';
    }
    const d = KS.state.doc;
    if (d && !d.view.init) V.fit(d);
    V.sync();
    KS.requestRender();
  };
  V.setRulers = on => { V.vp.classList.toggle('rulers', !!on); V.resize(); };

  // Le document actif fournit zoom et origine
  V.sync = () => {
    const d = KS.state.doc;
    if (!d) return;
    V.zoom = d.view.zoom; V.ox = d.view.x; V.oy = d.view.y;
  };
  V.store = () => {
    const d = KS.state.doc;
    if (!d) return;
    d.view.zoom = V.zoom; d.view.x = V.ox; d.view.y = V.oy; d.view.init = true;
    KS.emit('view', d);
    KS.requestRender();
  };
  V.toDoc = (sx, sy) => ({ x: (sx - V.ox) / V.zoom, y: (sy - V.oy) / V.zoom });
  V.toScreen = (x, y) => ({ x: V.ox + x * V.zoom, y: V.oy + y * V.zoom });
  V.eventPos = e => { const r = V.canvas.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; };

  V.ZOOMS = [0.01, 0.02, 0.03, 0.04, 0.05, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 12, 16, 24, 32, 64];
  // Ajuste à l'écran ; allowUp : autorise un zoom > 100 % pour les petites images
  V.fit = (d = KS.state.doc, allowUp = false) => {
    if (!d || V.w < 10 || !V.vp || V.vp.clientWidth < 10 || V.vp.clientHeight < 10) return;
    const m = 40;
    let z = Math.min((V.w - m * 2) / d.width, (V.h - m * 2) / d.height);
    if (!allowUp) z = Math.min(z, 1);
    V.zoom = U.clamp(z, 0.01, 64);
    V.center(d);
  };
  V.center = (d = KS.state.doc) => {
    V.ox = Math.round((V.w - d.width * V.zoom) / 2);
    V.oy = Math.round((V.h - d.height * V.zoom) / 2);
    V.store();
  };
  V.setZoom = (z, sx = V.w / 2, sy = V.h / 2) => {
    z = U.clamp(z, 0.01, 64);
    const p = V.toDoc(sx, sy);
    V.zoom = z;
    V.ox = sx - p.x * z; V.oy = sy - p.y * z;
    V.store();
  };
  V.zoomStep = (dir, sx, sy) => {
    const z = V.zoom;
    let n = dir > 0 ? V.ZOOMS.find(v => v > z * 1.001) : [...V.ZOOMS].reverse().find(v => v < z / 1.001);
    V.setZoom(n || z, sx, sy);
  };
  V.pan = (dx, dy) => { V.ox += dx; V.oy += dy; V.store(); };

  /* ---------------------------------------------------------------- rendu */
  V.render = () => {
    const ctx = V.ctx, dpr = V.dpr, d = KS.state.doc;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = V.colors?.workspace || '#0e1013';
    ctx.fillRect(0, 0, V.canvas.width, V.canvas.height);
    if (!d) { V.renderRulers(); return; }
    V.sync();
    const tool = KS.tools?.current;
    if (tool && tool.preRender) tool.preRender(d);
    const z = V.zoom, W = d.width, H = d.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rx = V.ox, ry = V.oy, rw = W * z, rh = H * z;
    // ombre portée du document
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 28; ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#fff'; ctx.fillRect(rx, ry, rw, rh);
    ctx.restore();
    if (!V.checker) V.checker = U.checkerPattern(ctx, KS.prefs.checker || 8);
    ctx.fillStyle = V.checker;
    ctx.fillRect(rx, ry, rw, rh);

    // affichage progressif : les tuiles pas encore recalculées viennent de l'aperçu basse résolution
    const st = d.channelView ? { comp: d.display(), pending: null } : d.frame();
    const comp = st.comp;
    // ne dessiner que la partie visible (zooms très forts)
    const vis = U.rectIntersect({ x: 0, y: 0, w: W, h: H }, { x: -V.ox / z, y: -V.oy / z, w: V.w / z, h: V.h / z });
    ctx.imageSmoothingEnabled = z < 1;
    ctx.imageSmoothingQuality = 'high';
    if (vis) {
      const sx = Math.floor(vis.x), sy = Math.floor(vis.y), sw = Math.min(W - sx, Math.ceil(vis.x + vis.w) - sx + 1), sh = Math.min(H - sy, Math.ceil(vis.y + vis.h) - sy + 1);
      // zoom arrière : depuis la copie réduite la plus proche (1/2, 1/4…) plutôt que la pleine résolution
      const lv = d.channelView ? 0 : Math.floor(Math.log2(1 / Math.max(1e-6, z * V.dpr)));
      if (lv >= 1) {
        const m = Math.pow(2, -Math.min(lv, 6)), mip = d.mip(m);
        ctx.drawImage(mip, sx * m, sy * m, sw * m, sh * m, rx + sx * z, ry + sy * z, sw * z, sh * z);
      } else ctx.drawImage(comp, sx, sy, sw, sh, rx + sx * z, ry + sy * z, sw * z, sh * z);
      if (st.pending) {
        // un seul dessin de l'aperçu, découpé aux tuiles en attente (pas de joints entre tuiles)
        const S = KS.Doc.TILE, k = st.k;
        ctx.save();
        ctx.beginPath();
        for (const key of st.pending) {
          const [tx, ty] = key.split(',').map(Number);
          const T = U.rectIntersect({ x: tx, y: ty, w: S, h: S }, { x: sx, y: sy, w: sw, h: sh });
          if (T) ctx.rect(rx + T.x * z, ry + T.y * z, T.w * z, T.h * z);
        }
        ctx.clip();
        ctx.fillStyle = V.checker; ctx.fillRect(rx + sx * z, ry + sy * z, sw * z, sh * z);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(st.proxy, sx * k, sy * k, sw * k, sh * k, rx + sx * z, ry + sy * z, sw * z, sh * z);
        ctx.restore();
      }
      if (d.quickMask) ctx.drawImage(d.quickMask.overlay, sx, sy, sw, sh, rx + sx * z, ry + sy * z, sw * z, sh * z);
      const ach = d.alphaEdit && !d.quickMask && d.alphas.find(a => a.id === d.alphaEdit);
      if (ach && ach.overlay) ctx.drawImage(ach.overlay, sx, sy, sw, sh, rx + sx * z, ry + sy * z, sw * z, sh * z);
      // Alt + clic sur la vignette d'un masque : le masque seul, en niveaux de gris (comme Photoshop)
      const mv = d.maskView && d.layers.includes(d.maskView) && d.maskView.mask;
      if (mv) {
        const g = mv.outside ?? 255; ctx.fillStyle = `rgb(${g},${g},${g})`; ctx.fillRect(rx, ry, rw, rh);
        ctx.save(); ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip();
        ctx.drawImage(mv.canvas, rx + mv.x * z, ry + mv.y * z, mv.canvas.width * z, mv.canvas.height * z);
        ctx.restore();
      }
      // grille de pixels
      if (z >= 10 && KS.prefs.pixelGrid) {
        ctx.save();
        ctx.beginPath();
        for (let x = sx; x <= sx + sw; x++) { const X = Math.round(rx + x * z) + 0.5; ctx.moveTo(X, Math.max(0, ry + sy * z)); ctx.lineTo(X, Math.min(V.h, ry + (sy + sh) * z)); }
        for (let y = sy; y <= sy + sh; y++) { const Y = Math.round(ry + y * z) + 0.5; ctx.moveTo(Math.max(0, rx + sx * z), Y); ctx.lineTo(Math.min(V.w, rx + (sx + sw) * z), Y); }
        ctx.strokeStyle = 'rgba(128,128,128,0.35)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
      }
    }
    ctx.imageSmoothingEnabled = true;
    // Ctrl+H : extras masqués (fourmis de sélection, grille, repères) ; la sélection reste active
    if (!V.hideExtras) {
      if (KS.prefs.showGrid) V.drawGrid(ctx, d);
      if (KS.prefs.showGuides) V.drawGuides(ctx, d);
      if (!d.quickMask) d.selection.drawAnts(ctx, V, V.phase);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (KS.tools.brushGesture?.active) KS.tools.brushGesture.draw(ctx);
    else if (tool && tool.overlay) { ctx.save(); tool.overlay(ctx, V, d); ctx.restore(); }
    if (V.smartGuides) V.drawSmart(ctx);
    V.renderRulers();
    KS.emit('rendered', d);
  };

  V.drawGrid = (ctx, d) => {
    const g = KS.prefs.gridSize || 64, sub = KS.prefs.gridSub || 1, z = V.zoom;
    ctx.save();
    ctx.beginPath(); ctx.rect(V.ox, V.oy, d.width * z, d.height * z); ctx.clip();
    const lines = (step, alpha) => {
      if (step * z < 6) return;
      ctx.beginPath();
      for (let x = 0; x <= d.width; x += step) { const X = Math.round(V.ox + x * z) + 0.5; ctx.moveTo(X, V.oy); ctx.lineTo(X, V.oy + d.height * z); }
      for (let y = 0; y <= d.height; y += step) { const Y = Math.round(V.oy + y * z) + 0.5; ctx.moveTo(V.ox, Y); ctx.lineTo(V.ox + d.width * z, Y); }
      ctx.globalAlpha = alpha; ctx.strokeStyle = KS.prefs.gridColor; ctx.lineWidth = 1; ctx.stroke();
    };
    if (sub > 1) lines(g / sub, 0.4);
    lines(g, 1);
    ctx.restore();
  };
  V.drawGuides = (ctx, d) => {
    ctx.save();
    ctx.strokeStyle = KS.prefs.guideColor; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const y of d.guides.h) { const Y = Math.round(V.oy + y * V.zoom) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(V.w, Y); }
    for (const x of d.guides.v) { const X = Math.round(V.ox + x * V.zoom) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, V.h); }
    ctx.stroke();
    if (V.guideDrag && V.guideDrag.pos != null) {
      ctx.setLineDash([5, 4]); ctx.beginPath();
      const g = V.guideDrag;
      if (g.dir === 'h') { const Y = Math.round(V.oy + g.pos * V.zoom) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(V.w, Y); }
      else { const X = Math.round(V.ox + g.pos * V.zoom) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, V.h); }
      ctx.stroke();
    }
    ctx.restore();
  };
  V.drawSmart = ctx => {
    ctx.save(); ctx.strokeStyle = '#ff2fa0'; ctx.lineWidth = 1; ctx.beginPath();
    for (const g of V.smartGuides) {
      if (g.x != null) { const X = Math.round(V.ox + g.x * V.zoom) + 0.5; ctx.moveTo(X, V.oy + g.a * V.zoom); ctx.lineTo(X, V.oy + g.b * V.zoom); }
      else { const Y = Math.round(V.oy + g.y * V.zoom) + 0.5; ctx.moveTo(V.ox + g.a * V.zoom, Y); ctx.lineTo(V.ox + g.b * V.zoom, Y); }
    }
    ctx.stroke(); ctx.restore();
  };

  // Pas de graduation adapté au zoom
  function rulerStep(z) {
    const target = 60 / z;
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
    return steps.find(s => s >= target) || 100000;
  }
  V.renderRulers = () => {
    if (!V.vp.classList.contains('rulers')) return;
    const dpr = V.dpr, c = V.colors || {};
    for (const [cv, horiz] of [[V.rh, true], [V.rv, false]]) {
      const x = cv.getContext('2d');
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      const L = horiz ? V.w : V.h, T = V.rulerSize;
      x.fillStyle = c.ruler || '#181b20'; x.fillRect(0, 0, horiz ? L : T, horiz ? T : L);
      x.strokeStyle = c.border || '#2a2f38'; x.lineWidth = 1;
      x.beginPath();
      if (horiz) { x.moveTo(0, T - 0.5); x.lineTo(L, T - 0.5); } else { x.moveTo(T - 0.5, 0); x.lineTo(T - 0.5, L); }
      x.stroke();
      const d = KS.state.doc;
      if (!d) continue;
      const z = V.zoom, o = horiz ? V.ox : V.oy, step = rulerStep(z), sub = step / 10 * z >= 4 ? step / 10 : step / 5 * z >= 4 ? step / 5 : step / 2;
      x.fillStyle = x.strokeStyle = c.rulerInk || '#6f7886';
      x.font = '9.5px Outfit, Segoe UI, sans-serif';
      x.beginPath();
      const start = Math.floor(-o / z / sub) * sub, end = (L - o) / z;
      for (let v = start; v <= end; v += sub) {
        const p = Math.round(o + v * z) + 0.5;
        const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
        const len = major ? T : T * 0.3;
        if (horiz) { x.moveTo(p, T - len); x.lineTo(p, T); } else { x.moveTo(T - len, p); x.lineTo(T, p); }
        if (major) {
          const label = String(Math.round(v));
          if (horiz) x.fillText(label, p + 3, 10);
          else { x.save(); x.translate(10, p + 3); x.rotate(-Math.PI / 2); x.fillText(label, -x.measureText(label).width - 2, 0); x.restore(); }
        }
      }
      x.stroke();
      if (V.mouse) {
        x.strokeStyle = c.accent || '#3d7cf0';
        x.beginPath();
        const p = Math.round(horiz ? V.mouse.sx : V.mouse.sy) + 0.5;
        if (horiz) { x.moveTo(p, 0); x.lineTo(p, T); } else { x.moveTo(0, p); x.lineTo(T, p); }
        x.stroke();
      }
    }
    const cx = V.rc.getContext('2d');
    V.rc.width = V.rulerSize * dpr; V.rc.height = V.rulerSize * dpr;
    cx.fillStyle = c.ruler || '#181b20'; cx.fillRect(0, 0, V.rc.width, V.rc.height);
  };

  // Aides pour les surcouches
  V.handle = (ctx, x, y, size = 8, round = false) => {
    ctx.beginPath();
    if (round) ctx.arc(x, y, size / 2, 0, Math.PI * 2); else ctx.rect(Math.round(x - size / 2) + 0.5, Math.round(y - size / 2) + 0.5, size, size);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeStyle = V.colors?.accent || '#3d7cf0'; ctx.lineWidth = 1.5; ctx.stroke();
  };
  V.docPath = (ctx, fn) => {
    ctx.save();
    ctx.setTransform(V.dpr * V.zoom, 0, 0, V.dpr * V.zoom, V.dpr * V.ox, V.dpr * V.oy);
    fn(ctx);
    ctx.restore();
  };
})();


// Timeline à la Vegas : règle, marqueurs, sélection temporelle, pistes, événements (fondus, découpe,
// glisser, ondulation, magnétisme, groupes), en-têtes de piste, transport et défilement.
'use strict';
(() => {
  const h = KC.h, U = KC.util, P = KC.P, FX = KC.FX, M = KC.media, E = KC.engine;
  const T = KC.timeline = { tool: 'edit', hover: null, drag: null, ghost: null, snapLine: null, band: null, dirty: true };
  const HEAD = 15;          // hauteur du bandeau d'en-tête d'un événement
  const RULER_LOOP = 28, RULER_MARK = 15;   // bandes de la règle (sélection, marqueurs)
  let cv, cx, rcv, rcx, wrap, headersInner, tip;
  let W = 0, H = 0, RW = 0, RH = 0, dpr = 1;

  const view = () => KC.project.view;
  const X = t => (t - view().scroll) * view().zoom;
  const TT = x => x / view().zoom + view().scroll;
  T.X = X; T.T = TT;

  /* ============================================================ géométrie des pistes */
  T.rows = () => {
    const rows = [];
    let y = -view().scrollY;
    for (const tr of KC.project.tracks) { rows.push({ track: tr, y, h: tr.height }); y += tr.height; }
    return rows;
  };
  T.totalHeight = () => KC.project.tracks.reduce((s, t) => s + t.height, 0);
  const rowAt = y => T.rows().find(r => y >= r.y && y < r.y + r.h) || null;

  /* ============================================================ magnétisme */
  function snapPoints(exclude) {
    const pts = [0, E.time];
    for (const e of KC.project.events) if (!exclude.has(e.id)) pts.push(e.start, e.start + e.length);
    for (const m of KC.project.markers) pts.push(m.t);
    const lp = KC.project.loop; if (lp.out > lp.in) pts.push(lp.in, lp.out);
    return pts;
  }
  function snapTime(t, pts, ev) {
    if (!KC.prefs.snap || (ev && ev.shiftKey)) return { t: P.snapFrame(t), line: null };
    const thr = 8 / view().zoom;
    let best = null, bd = thr;
    for (const p of pts) { const d = Math.abs(p - t); if (d < bd) { bd = d; best = p; } }
    return best != null ? { t: best, line: best } : { t: P.snapFrame(t), line: null };
  }

  /* ============================================================ dessin */
  T.redraw = () => { T.dirty = true; };
  function resize() {
    dpr = window.devicePixelRatio || 1;
    const r = wrap.getBoundingClientRect();
    W = Math.max(1, Math.floor(r.width)); H = Math.max(1, Math.floor(r.height));
    cv.width = W * dpr; cv.height = H * dpr;
    const rr = rcv.parentElement.getBoundingClientRect();
    RW = Math.max(1, Math.floor(rr.width)); RH = Math.max(1, Math.floor(rr.height));
    rcv.width = RW * dpr; rcv.height = RH * dpr;
    T.dirty = true;
  }
  function css(name) { return getComputedStyle(document.body).getPropertyValue(name).trim(); }
  let colors = {};
  T.refreshColors = () => {
    colors = {
      bg: css('--tl-bg'), a: css('--tl-track-a'), b: css('--tl-track-b'), grid: css('--tl-grid'), ruler: css('--ruler'),
      ink: css('--ruler-ink'), text: css('--text'), muted: css('--muted'), accent: css('--accent'), border: css('--border'),
      panel: css('--panel-2'), accentRgb: css('--accent-rgb'),
    };
    T.dirty = true;
  };

  // Pas de graduation adapté au zoom
  function tickStep() {
    const fps = P.fps(), z = view().zoom;
    const cands = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
    for (const c of cands) if (c * z >= 70) return c;
    return 7200;
  }

  function drawRuler() {
    const x = rcx;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = colors.ruler; x.fillRect(0, 0, RW, RH);
    // sélection temporelle (bande du haut)
    const lp = KC.project.loop;
    x.fillStyle = colors.panel; x.fillRect(0, 0, RW, RULER_LOOP);
    if (lp.out > lp.in) {
      const a = X(lp.in), b = X(lp.out);
      x.fillStyle = KC.prefs.loop ? 'rgba(' + colors.accentRgb + ',.75)' : 'rgba(150,160,180,.55)';
      x.fillRect(a, 1, b - a, RULER_LOOP - 2);
      x.fillStyle = '#d9e8ff';
      for (const edge of [a, b]) { x.fillRect(edge - 3, 3, 6, RULER_LOOP - 6); }
      if (b - a > 150) {
        x.font = '600 11px Outfit, sans-serif'; x.textBaseline = 'middle';
        x.fillText('Boucle · ' + U.fmtTime(lp.out - lp.in, P.fps()), Math.max(10, a + 12), RULER_LOOP / 2, Math.min(b, RW) - Math.max(10, a + 12) - 12);
      }
    } else {
      x.fillStyle = colors.ink; x.font = '11px Outfit, sans-serif'; x.textBaseline = 'middle';
      x.fillText('Glissez ici pour sélectionner une boucle', 10, RULER_LOOP / 2);
    }
    // marqueurs
    x.fillStyle = colors.bg; x.fillRect(0, RULER_LOOP, RW, RULER_MARK);
    x.font = '600 10px Outfit, Segoe UI, sans-serif'; x.textBaseline = 'middle';
    for (const m of KC.project.markers) {
      const mx = Math.round(X(m.t)) + 0.5;
      if (mx < -60 || mx > RW + 4) continue;
      const label = String(m.num || '') + (m.name ? ' ' + m.name : '');
      const tw = x.measureText(label).width + 8;
      x.fillStyle = '#e8a33a';
      x.fillRect(mx, RULER_LOOP + 1, tw, RULER_MARK - 2);
      x.fillStyle = '#1a1a1a'; x.fillText(label, mx + 4, RULER_LOOP + RULER_MARK / 2 + 0.5);
    }
    // règle
    const y0 = RULER_LOOP + RULER_MARK;
    const step = tickStep(), fps = P.fps();
    const t0 = Math.floor(TT(0) / step) * step;
    x.strokeStyle = colors.ink; x.fillStyle = colors.ink; x.lineWidth = 1;
    x.font = '10.5px "Cascadia Mono", Consolas, monospace'; x.textBaseline = 'top';
    x.beginPath();
    for (let t = t0; t < TT(RW) + step; t += step) {
      const px = Math.round(X(t)) + 0.5;
      if (px < -100) continue;
      x.moveTo(px, RH); x.lineTo(px, y0 + 4);
      const sub = step >= 1 ? 4 : 5;
      for (let k = 1; k < sub; k++) { const sx = Math.round(X(t + step * k / sub)) + 0.5; x.moveTo(sx, RH); x.lineTo(sx, RH - 5); }
      if (t >= 0) x.fillText(U.fmtTime(t, fps), px + 3, y0 + 3);
    }
    x.stroke();
    x.strokeStyle = colors.border; x.beginPath(); x.moveTo(0, RH - 0.5); x.lineTo(RW, RH - 0.5); x.stroke();
    // curseur
    const cxp = Math.round(X(E.time)) + 0.5;
    x.fillStyle = '#ffffff';
    x.beginPath(); x.moveTo(cxp - 6, y0); x.lineTo(cxp + 6, y0); x.lineTo(cxp, y0 + 8); x.closePath(); x.fill();
    x.strokeStyle = '#fff'; x.beginPath(); x.moveTo(cxp, y0); x.lineTo(cxp, RH); x.stroke();
  }

  function trackColor(tr) { return P.TRACK_COLORS[tr.color % P.TRACK_COLORS.length]; }
  function shade(hex, k) {
    const s = hex.replace('#', ''); let r = parseInt(s.slice(0, 2), 16), g = parseInt(s.slice(2, 4), 16), b = parseInt(s.slice(4, 6), 16);
    if (k < 0) { r *= 1 + k; g *= 1 + k; b *= 1 + k; } else { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  // Couche fixe (pistes, événements) mise en cache : seul le curseur est redessiné pendant la lecture
  const sc = document.createElement('canvas'), scx = sc.getContext('2d');
  function drawStatic() {
    if (sc.width !== cv.width || sc.height !== cv.height) { sc.width = cv.width; sc.height = cv.height; }
    const x = scx;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = colors.bg; x.fillRect(0, 0, W, H);
    const rows = T.rows();
    rows.forEach((r, i) => {
      if (r.y > H || r.y + r.h < 0) return;
      x.fillStyle = (KC.sel.track === r.track.id) ? shade(i % 2 ? colors.b : colors.a, 0.05) : i % 2 ? colors.b : colors.a;
      x.fillRect(0, r.y, W, r.h - 1);
      x.fillStyle = colors.border; x.fillRect(0, r.y + r.h - 1, W, 1);
    });
    // grille
    const step = tickStep();
    x.fillStyle = colors.grid;
    for (let t = Math.floor(TT(0) / step) * step; t < TT(W); t += step) x.fillRect(Math.round(X(t)), 0, 1, H);
    // sélection temporelle
    const lp = KC.project.loop;
    if (lp.out > lp.in) {
      x.fillStyle = 'rgba(' + colors.accentRgb + ',.10)';
      x.fillRect(X(lp.in), 0, X(lp.out) - X(lp.in), H);
    }
    // événements
    const byTrack = new Map(rows.map(r => [r.track.id, r]));
    const evs = KC.eventIndex.between(TT(-2),TT(W+2));
    for (const ev of evs) {
      const r = byTrack.get(ev.track); if (!r) continue;
      if (r.y > H || r.y + r.h < 0) continue;
      const x0 = X(ev.start), x1 = X(ev.start + ev.length);
      if (x1 < -2 || x0 > W + 2) continue;
      drawEvent(x, ev, r, x0, x1);
    }
    // fondus enchaînés : croix au-dessus
    for (const ev of evs) {
      if (!ev.xIn) continue;
      const r = byTrack.get(ev.track); if (!r) continue;
      const a = X(ev.start), b = X(ev.start + ev.fadeIn);
      if (b < 0 || a > W) continue;
      x.save();
      x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 1.2;
      x.beginPath(); x.moveTo(a, r.y + HEAD + 1); x.lineTo(b, r.y + r.h - 3); x.moveTo(a, r.y + r.h - 3); x.lineTo(b, r.y + HEAD + 1); x.stroke();
      x.restore();
    }
    // durée des transitions (fondus enchaînés et transitions d'entrée)
    for (const ev of evs) {
      if (!(ev.fadeIn > 0) || (!ev.xIn && P.kindOf(ev) !== 'video')) continue;
      if (!ev.xIn && (!ev.transition || ev.transition === 'dissolve')) continue;
      const r = byTrack.get(ev.track); if (!r) continue;
      const a = X(ev.start), b = X(ev.start + ev.fadeIn);
      if (b < 0 || a > W || b - a < 26) continue;
      const isV = P.kindOf(ev) === 'video';
      const name = isV ? ((FX.TRANSITIONS[ev.transition || 'dissolve'] || {}).name || '') : 'Fondu';
      const dur = U.fmtNum(ev.fadeIn, ev.fadeIn < 10 ? 2 : 1) + ' s';
      const label = b - a > 110 ? name + ' · ' + dur : dur;
      x.save();
      x.font = '600 10px Outfit, sans-serif'; x.textBaseline = 'middle'; x.textAlign = 'center';
      const tw = Math.min(b - a - 4, x.measureText(label).width + 10);
      const cy = r.y + HEAD + Math.max(9, (r.h - HEAD) / 2);
      x.fillStyle = 'rgba(10,12,18,.78)';
      x.beginPath(); x.roundRect((a + b) / 2 - tw / 2, cy - 7, tw, 14, 4); x.fill();
      x.fillStyle = ev.xIn ? '#ffd34d' : '#9fc4ff';
      x.fillText(label, (a + b) / 2, cy + 0.5, tw - 4);
      x.restore();
    }
    // marqueurs
    x.save(); x.setLineDash([3, 3]); x.strokeStyle = 'rgba(232,163,58,.7)';
    for (const m of KC.project.markers) { const mx = Math.round(X(m.t)) + 0.5; if (mx < 0 || mx > W) continue; x.beginPath(); x.moveTo(mx, 0); x.lineTo(mx, H); x.stroke(); }
    x.restore();
    // fantômes de dépôt
    if (T.ghost) {
      x.save();
      for (const g of T.ghost) {
        const r = g.trackId ? byTrack.get(g.trackId) : null;
        const y = r ? r.y : g.y, hh = r ? r.h : 60;
        x.fillStyle = 'rgba(' + colors.accentRgb + ',.35)'; x.strokeStyle = colors.accent; x.lineWidth = 2;
        x.fillRect(X(g.start), y + 1, g.length * view().zoom, hh - 3);
        x.strokeRect(X(g.start) + 1, y + 2, g.length * view().zoom - 2, hh - 5);
        if (g.label) { x.fillStyle = '#fff'; x.font = '11px Outfit, sans-serif'; x.textBaseline = 'top'; x.fillText(g.label, X(g.start) + 6, y + 6); }
      }
      x.restore();
    }
    if (T.band) {
      const b = T.band;
      x.fillStyle = 'rgba(' + colors.accentRgb + ',.15)'; x.strokeStyle = colors.accent; x.lineWidth = 1;
      x.fillRect(b.x, b.y, b.w, b.h); x.strokeRect(b.x + 0.5, b.y + 0.5, b.w, b.h);
    }
    if (T.snapLine != null) {
      x.fillStyle = '#ffd34d';
      x.fillRect(Math.round(X(T.snapLine)), 0, 1, H);
    }
  }
  function draw(full) {
    if (full) drawStatic();
    const x = cx;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.drawImage(sc, 0, 0);
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = '#ffffff';
    x.fillRect(Math.round(X(E.time)), 0, 1, H);
    drawRuler();
  }

  function drawEvent(x, ev, r, x0, x1) {
    const tr = r.track, isV = tr.kind === 'video';
    const sel = KC.sel.has(ev.id);
    const top = r.y + 1, hh = r.h - 3, bodyTop = top + HEAD, bodyH = hh - HEAD;
    const col = ev.color || trackColor(tr);
    const vx0 = Math.max(x0, -4), vx1 = Math.min(x1, W + 4);
    const w = vx1 - vx0;
    const m = ev.media ? P.media(ev.media) : null;
    x.save();
    x.beginPath(); x.rect(vx0, top, w, hh); x.clip();
    // corps
    x.fillStyle = sel ? shade(col, -0.45) : '#1f2026';
    x.fillRect(vx0, bodyTop, w, bodyH);
    // vignettes / forme d'onde
    if (bodyH > 6) {
      if (isV) drawThumbs(x, ev, m, x0, x1, bodyTop, bodyH, vx0, vx1);
      else drawWave(x, ev, m, x0, x1, bodyTop, bodyH, vx0, vx1, col, sel);
    }
    if (sel) { x.fillStyle = 'rgba(' + colors.accentRgb + ',.18)'; x.fillRect(vx0, bodyTop, w, bodyH); }
    // en-tête
    x.fillStyle = sel ? shade(col, 0.25) : col;
    x.fillRect(vx0, top, w, HEAD);
    x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(vx0, top + HEAD - 1, w, 1);
    // titre
    const tx = Math.max(x0 + 5, 4);
    let label = P.eventName(ev);
    if (Math.abs(ev.speed - 1) > 1e-6) label += '  ×' + U.fmtNum(ev.speed, 2);
    if (ev.norm) label += '  (norm.)';
    x.fillStyle = '#121316'; x.font = '600 10.5px Outfit, Segoe UI, sans-serif'; x.textBaseline = 'middle';
    const btnW = isV && x1 - x0 > 70 ? 36 : 0;
    x.fillText(label, tx, top + HEAD / 2 + 0.5, Math.max(0, x1 - tx - 6 - btnW));
    // boutons Panoramique / Effets
    if (btnW) {
      const bx = Math.min(x1, W) - 18;
      drawBtn(x, bx, top + 1, 'pc', ev.pc && !FX.pcIsIdentity(ev.pc));
      drawBtn(x, bx - 17, top + 1, 'fx', ev.fx && ev.fx.length);
    } else if (!isV && x1 - x0 > 40 && ev.mute) { /* rien */ }
    // fondus
    x.fillStyle = 'rgba(0,0,0,.42)';
    x.strokeStyle = 'rgba(255,255,255,.75)'; x.lineWidth = 1;
    if (ev.fadeIn > 0 && !ev.xIn) {
      const fx = x0 + ev.fadeIn * view().zoom;
      x.beginPath(); x.moveTo(x0, bodyTop); x.lineTo(fx, bodyTop); x.lineTo(x0, top + hh); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(x0, top + hh); x.lineTo(fx, bodyTop); x.stroke();
    }
    if (ev.fadeOut > 0 && !ev.xOut) {
      const fx = x1 - ev.fadeOut * view().zoom;
      x.beginPath(); x.moveTo(x1, bodyTop); x.lineTo(fx, bodyTop); x.lineTo(x1, top + hh); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(x1, top + hh); x.lineTo(fx, bodyTop); x.stroke();
    }
    // ligne de niveau (opacité / gain)
    const lvl = isV ? (ev.opacity == null ? 1 : ev.opacity) : KC.ui.dbToFader(ev.gain) / 0.75;
    const hov = T.hover && T.hover.ev === ev;
    if (lvl < 0.999 || hov) {
      const ly = bodyTop + (1 - U.clamp(lvl, 0, 1)) * (bodyH - 2) + 1;
      x.strokeStyle = hov ? '#9fc4ff' : 'rgba(120,170,255,.9)'; x.lineWidth = 1.5;
      x.beginPath(); x.moveTo(x0 + (ev.xIn ? 0 : ev.fadeIn * view().zoom), ly); x.lineTo(x1 - (ev.xOut ? 0 : ev.fadeOut * view().zoom), ly); x.stroke();
    }
    // poignées de fondu
    if (hov) {
      x.fillStyle = '#fff';
      const fi = x0 + ev.fadeIn * view().zoom, fo = x1 - ev.fadeOut * view().zoom;
      x.fillRect(fi - 3, top + 1, 6, 6);
      x.fillRect(fo - 3, top + 1, 6, 6);
    }
    // muet
    if (ev.mute) {
      x.fillStyle = 'rgba(0,0,0,.5)'; x.fillRect(vx0, top, w, hh);
      x.strokeStyle = 'rgba(255,255,255,.12)'; x.lineWidth = 1;
      x.beginPath(); for (let k = Math.floor(vx0 / 10) * 10 - hh; k < vx1; k += 10) { x.moveTo(k, top + hh); x.lineTo(k + hh, top); } x.stroke();
    }
    // repères de boucle
    if (m && m.duration && m.kind !== 'image') {
      const d = m.duration;
      let k = Math.ceil((ev.offset + 1e-6) / d) * d;
      x.fillStyle = '#ffffff';
      while (k < ev.offset + ev.length * ev.speed - 1e-6) {
        const lx = x0 + (k - ev.offset) / ev.speed * view().zoom;
        x.beginPath(); x.moveTo(lx - 4, top + HEAD); x.lineTo(lx + 4, top + HEAD); x.lineTo(lx, top + HEAD + 6); x.closePath(); x.fill();
        k += d;
      }
    }
    // manquant
    if (m && M.get(m).missing) { x.fillStyle = 'rgba(224,83,61,.35)'; x.fillRect(vx0, bodyTop, w, bodyH); }
    x.restore();
    // contour
    x.strokeStyle = sel ? '#ffffff' : 'rgba(0,0,0,.55)'; x.lineWidth = sel ? 1.5 : 1;
    x.strokeRect(Math.round(x0) + 0.5, top + 0.5, Math.round(x1 - x0) - 1, hh - 1);
  }
  function drawBtn(x, bx, by, kind, on) {
    x.fillStyle = on ? '#3d7cf0' : 'rgba(0,0,0,.28)';
    x.fillRect(bx, by, 15, HEAD - 3);
    x.strokeStyle = '#fff'; x.fillStyle = '#fff'; x.lineWidth = 1.2;
    if (kind === 'fx') { x.font = '700 8.5px Outfit, sans-serif'; x.textBaseline = 'middle'; x.fillText('fx', bx + 3, by + 6.5); }
    else { x.strokeRect(bx + 3.5, by + 3.5, 8, 5); x.fillRect(bx + 7, by + 5, 1.2, 2); }
  }
  function drawThumbs(x, ev, m, x0, x1, top, hh, vx0, vx1) {
    if (ev.gen) {
      const g = ev.gen;
      if (g.type === 'solid') { x.fillStyle = g.color; x.globalAlpha = 0.85; x.fillRect(vx0, top, vx1 - vx0, hh); x.globalAlpha = 1; }
      else if (g.type === 'gradient') {
        const gr = x.createLinearGradient(vx0, 0, vx1, 0); gr.addColorStop(0, g.c1); gr.addColorStop(1, g.c2);
        x.fillStyle = gr; x.globalAlpha = 0.85; x.fillRect(vx0, top, vx1 - vx0, hh); x.globalAlpha = 1;
      } else if (g.type === 'text') {
        x.fillStyle = '#2a2d38'; x.fillRect(vx0, top, vx1 - vx0, hh);
        x.fillStyle = '#d7dbe6'; x.font = `${g.bold ? 700 : 400} ${Math.min(22, hh * 0.45)}px "${g.font}", Outfit, sans-serif`; x.textBaseline = 'middle';
        x.fillText(String(g.text || '').split('\n')[0], Math.max(x0, 0) + 8, top + hh / 2, Math.max(0, x1 - Math.max(x0, 0) - 12));
      } else { x.fillStyle = '#555'; x.fillRect(vx0, top, vx1 - vx0, hh); }
      return;
    }
    if (!m) return;
    const ar = (m.width && m.height) ? m.width / m.height : 16 / 9;
    const tw = Math.max(8, hh * ar);
    const z = view().zoom;
    let k0 = Math.floor((vx0 - x0) / tw);
    for (let k = Math.max(0, k0); ; k++) {
      const px = x0 + k * tw;
      if (px > vx1) break;
      const tLocal = (k * tw) / z;
      const img = M.thumbAt(m, srcAt(ev, m, tLocal));
      if (img) x.drawImage(img, px, top, tw, hh);
      else { x.fillStyle = k % 2 ? '#2a2c34' : '#25272e'; x.fillRect(px, top, tw, hh); }
    }
    x.fillStyle = 'rgba(0,0,0,.15)'; x.fillRect(vx0, top, vx1 - vx0, hh);
  }
  function srcAt(ev, m, tau) {
    let st = ev.offset + tau * ev.speed;
    if (m.duration && st >= m.duration) st = st % m.duration;
    return st;
  }
  function drawWave(x, ev, m, x0, x1, top, hh, vx0, vx1, col) {
    x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(vx0, top, vx1 - vx0, hh);
    if (!m) return;
    const r = M.get(m);
    const mid = top + hh / 2;
    x.fillStyle = 'rgba(255,255,255,.08)'; x.fillRect(vx0, Math.round(mid), vx1 - vx0, 1);
    if (!r.peaks) return;
    const z = view().zoom, g = U.dbToGain(ev.gain + (ev.norm || 0));
    x.fillStyle = shade(col, 0.35);
    const a = Math.max(Math.floor(vx0), Math.floor(x0)), b = Math.min(Math.ceil(vx1), Math.ceil(x1));
    for (let px = a; px < b; px++) {
      const tA = (px - x0) / z, tB = (px + 1 - x0) / z;
      const pk = M.peakRange(m, srcAt(ev, m, tA), srcAt(ev, m, tA) + (tB - tA) * ev.speed + 1 / r.peakRate);
      if (pk == null) continue;
      const v = Math.min(1, Math.sqrt(pk) * g) * (hh / 2 - 2);
      x.fillRect(px, mid - v, 1, v * 2 + 1);
    }
  }

  /* ============================================================ test de position */
  function hit(px, py) {
    const r = rowAt(py);
    if (!r) return null;
    const z = view().zoom;
    const evs = KC.eventIndex.between(TT(px - 4) - 1e-8, TT(px + 4) + 1e-8, r.track.id).sort((a, b) => b.start - a.start);
    // le plus récent d'abord (au-dessus dans un fondu enchaîné)
    let found = null;
    for (const ev of evs) {
      const x0 = X(ev.start), x1 = X(ev.start + ev.length);
      if (px >= x0 - 4 && px <= x1 + 4) {
        if (px < x0 || px > x1) { if (!found) found = { ev, x0, x1 }; continue; }
        found = { ev, x0, x1 }; break;
      }
    }
    if (!found) return { row: r, zone: 'empty' };
    const { ev, x0, x1 } = found;
    const top = r.y + 1, hh = r.h - 3, bodyTop = top + HEAD, bodyH = hh - HEAD;
    const isV = r.track.kind === 'video';
    const fi = x0 + ev.fadeIn * z, fo = x1 - ev.fadeOut * z;
    const res = { row: r, ev, x0, x1 };
    if (isV && x1 - x0 > 70 && py >= top && py < top + HEAD) {
      const bx = Math.min(x1, W) - 18;
      if (px >= bx && px <= bx + 15) return { ...res, zone: 'btnPc' };
      if (px >= bx - 17 && px <= bx - 2) return { ...res, zone: 'btnFx' };
    }
    if (py < top + 9) {
      if (Math.abs(px - fi) <= 6 && !(Math.abs(px - x0) <= 3 && py > top + 8)) return { ...res, zone: 'fadeIn' };
      if (Math.abs(px - fo) <= 6) return { ...res, zone: 'fadeOut' };
    }
    if (Math.abs(px - x0) <= 5) return { ...res, zone: 'trimL' };
    if (Math.abs(px - x1) <= 5) return { ...res, zone: 'trimR' };
    const lvl = isV ? (ev.opacity == null ? 1 : ev.opacity) : KC.ui.dbToFader(ev.gain) / 0.75;
    const ly = bodyTop + (1 - U.clamp(lvl, 0, 1)) * (bodyH - 2) + 1;
    if (py >= bodyTop - 1 && Math.abs(py - ly) <= 4 && px > fi + 3 && px < fo - 3) return { ...res, zone: 'level' };
    return { ...res, zone: 'body' };
  }
  const CURSORS = { trimL: 'ew-resize', trimR: 'ew-resize', fadeIn: 'nesw-resize', fadeOut: 'nwse-resize', level: 'ns-resize', body: 'default', btnFx: 'pointer', btnPc: 'pointer', empty: 'text' };

  /* ============================================================ interactions sur les pistes */
  function showTip(text, ev) {
    if (!text) { tip.hidden = true; return; }
    tip.hidden = false; tip.textContent = text;
    tip.style.left = (ev.clientX + 14) + 'px'; tip.style.top = (ev.clientY + 16) + 'px';
  }

  function onDown(e) {
    if (e.button === 1) { // bouton du milieu : défilement
      e.preventDefault();
      const s0 = view().scroll, y0 = view().scrollY;
      U.drag(e, (dx, dy) => { view().scroll = Math.max(0, s0 - dx / view().zoom); view().scrollY = U.clamp(y0 - dy, 0, Math.max(0, T.totalHeight() - H + 40)); syncScroll(); T.redraw(); });
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    const r = cv.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const ht = hit(px, py);
    if (e.button === 2) {
      if (ht && ht.ev) {
        if (!KC.sel.has(ht.ev.id)) KC.sel.set(KC.sel.expand([ht.ev]).map(x => x.id));
        T.redraw();
        KC.context(e, eventMenu(ht.ev));
      } else {
        KC.context(e, emptyMenu(TT(px), ht && ht.row.track));
      }
      return;
    }
    if (Math.abs(px - X(E.time)) <= 6 && !e.ctrlKey && !e.altKey && !e.shiftKey) return startScrub(e, cv);
    if (T.tool === 'time') return startTimeSelect(e, px);
    if (!ht || ht.zone === 'empty') {
      if (ht) KC.sel.track = ht.row.track.id;
      if (T.tool === 'select' || (e.ctrlKey && e.shiftKey)) return startBand(e, px, py);
      return startTimeSelect(e, px);
    }
    const ev = ht.ev;
    if (T.tool === 'razor') { e.preventDefault(); KC.cmd.razorAt(ev, TT(px)); return; }
    KC.sel.track = ev.track;
    if (ht.zone === 'btnFx') { KC.windows.eventFx(ev); return; }
    if (ht.zone === 'btnPc') { KC.windows.panCrop(ev); return; }
    if (e.detail === 2 && ht.zone === 'body' && ev.fadeIn > 0 && TT(px) < ev.start + ev.fadeIn) { KC.cmd.transitionDuration(ev); return; }
    if (e.detail === 2 && ht.zone === 'body') {
      // double-clic : sélection temporelle = l'événement (Vegas)
      KC.project.loop = { in: ev.start, out: ev.start + ev.length };
      if (ev.gen && ev.gen.type === 'text') KC.windows.generator(ev);
      KC.emit('loop'); T.redraw();
      return;
    }
    // sélection
    if (e.ctrlKey && ht.zone === 'body') {
      const grp = KC.sel.expand([ev]);
      if (KC.sel.has(ev.id)) { grp.forEach(g => KC.sel.ids.delete(g.id)); KC.emit('selection'); }
      else KC.sel.set(grp.map(g => g.id), true);
      T.redraw();
      // Ctrl+glisser = copie
      return startMove(e, ev, px, py, { copy: true, ctrlOnly: true });
    }
    if (e.shiftKey && ht.zone === 'body' && KC.sel.ids.size) {
      // Maj+clic : étendre la sélection sur la plage
      const sel = KC.sel.list();
      const a = Math.min(ev.start, ...sel.map(s => s.start)), b = Math.max(ev.start + ev.length, ...sel.map(s => s.start + s.length));
      const tracks = new Set([ev.track, ...sel.map(s => s.track)]);
      KC.sel.set(KC.project.events.filter(o => tracks.has(o.track) && o.start >= a - 1e-6 && o.start + o.length <= b + 1e-6).map(o => o.id), true);
      T.redraw();
      return;
    }
    if (!KC.sel.has(ev.id)) KC.sel.set(KC.sel.expand([ev]).map(x => x.id));
    T.redraw();
    switch (ht.zone) {
      case 'trimL': case 'trimR': return startTrim(e, ev, ht.zone === 'trimL', px);
      case 'fadeIn': case 'fadeOut': return startFade(e, ev, ht.zone === 'fadeIn', px);
      case 'level': return startLevel(e, ev, ht.row);
      default: return e.altKey ? startSlip(e, ev, px) : startMove(e, ev, px, py, {});
    }
  }

  function startTimeSelect(e, px) {
    const t0 = TT(px);
    const pts = snapPoints(new Set());
    const s0 = snapTime(t0, pts, e).t;
    let moved = false;
    E.pause();
    E.seek(s0);
    U.drag(e, (dx, dy, ev) => {
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      const r = cv.getBoundingClientRect();
      const sn = snapTime(TT(ev.clientX - r.left), pts, ev);
      T.snapLine = sn.line;
      KC.project.loop = { in: Math.max(0, Math.min(s0, sn.t)), out: Math.max(s0, sn.t) };
      E.seek(sn.t);
      KC.emit('loop'); T.redraw();
    }, () => {
      T.snapLine = null;
      if (!moved) {
        if (!KC.native || true) KC.sel.clear();
        E.seek(s0);
        if (KC.project.loop.out > KC.project.loop.in && !KC.prefs.loop) { /* garder la sélection */ }
      } else {
        E.seek(KC.project.loop.in);
      }
      T.redraw();
    });
  }

  function startBand(e, px, py) {
    const add = e.ctrlKey;
    const before = new Set(KC.sel.ids);
    U.drag(e, (dx, dy) => {
      const b = { x: Math.min(px, px + dx), y: Math.min(py, py + dy), w: Math.abs(dx), h: Math.abs(dy) };
      T.band = b;
      const tA = TT(b.x), tB = TT(b.x + b.w);
      const rows = T.rows().filter(r => r.y + r.h > b.y && r.y < b.y + b.h).map(r => r.track.id);
      const ids = KC.project.events.filter(ev => rows.includes(ev.track) && ev.start < tB && ev.start + ev.length > tA).map(ev => ev.id);
      KC.sel.ids = new Set(add ? [...before, ...ids] : ids);
      KC.emit('selection');
      T.redraw();
    }, () => { T.band = null; T.redraw(); });
  }

  function startMove(e, ev, px, py, { copy }) {
    const moving = KC.sel.list();
    if (!moving.length) return;
    const orig = new Map(moving.map(m => [m.id, { start: m.start, track: m.track }]));
    const excl = new Set(moving.map(m => m.id));
    const pts = snapPoints(excl);
    const r0 = rowAt(py);
    const kindTracks = k => KC.project.tracks.filter(t => t.kind === k);
    let started = false, copied = false;
    const minStart = Math.min(...moving.map(m => m.start));
    U.drag(e, (dx, dy, mev) => {
      if (!started) {
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        started = true;
        KC.begin();
        if (copy && (mev.ctrlKey)) {
          // laisse une copie à la place d'origine
          const gmap = new Map();
          for (const m of moving) {
            const c = U.deep(m); c.id = U.uid();
            if (c.group) { if (!gmap.has(c.group)) gmap.set(c.group, U.uid()); c.group = gmap.get(c.group); }
            KC.project.events.push(c);
          }
          copied = true;
        }
      }
      const r = cv.getBoundingClientRect();
      let dt = dx / view().zoom;
      // magnétisme sur le début et la fin de l'événement saisi
      const o = orig.get(ev.id);
      const s1 = snapTime(o.start + dt, pts, mev), s2 = snapTime(o.start + ev.length + dt, pts, mev);
      let line = null;
      if (s1.line != null && (s2.line == null || Math.abs(s1.t - (o.start + dt)) <= Math.abs(s2.t - (o.start + ev.length + dt)))) { dt = s1.t - o.start; line = s1.line; }
      else if (s2.line != null) { dt = s2.t - (o.start + ev.length); line = s2.line; }
      else dt = P.snapFrame(o.start + dt) - o.start;
      if (minStart + dt < 0) dt = -minStart;
      T.snapLine = line;
      // changement de piste (même type)
      const rr = rowAt(mev.clientY - r.top);
      let tDelta = 0;
      if (rr && r0 && rr.track.kind === r0.track.kind) {
        const list = kindTracks(r0.track.kind);
        tDelta = list.indexOf(rr.track) - list.indexOf(r0.track);
      }
      for (const m of moving) {
        const om = orig.get(m.id);
        m.start = Math.max(0, om.start + dt);
        const ot = P.track(om.track);
        if (ot && ot.kind === r0.track.kind && tDelta) {
          const list = kindTracks(ot.kind);
          const ni = U.clamp(list.indexOf(ot) + tDelta, 0, list.length - 1);
          m.track = list[ni].id;
        } else m.track = om.track;
      }
      const og = P.outgoing(ev), ic = P.incoming(ev);
      const xf = og ? '  ·  transition ' + U.fmtNum(og.start + og.length - ev.start, 2) + ' s' : ic ? '  ·  transition ' + U.fmtNum(ev.start + ev.length - ic.start, 2) + ' s' : '';
      showTip(U.fmtTime(ev.start, P.fps()) + xf + (copied ? '  (copie)' : ''), mev);
      E.redraw(); T.redraw();
    }, () => {
      showTip(null);
      T.snapLine = null;
      if (!started) {
        // simple clic : place le curseur, sélectionne seulement cet événement (et son groupe)
        if (!e.ctrlKey) KC.sel.set(KC.sel.expand([ev]).map(x => x.id));
        const r = cv.getBoundingClientRect();
        E.seek(TT(e.clientX - r.left));
        T.redraw();
        return;
      }
      const tracks = new Set();
      for (const m of moving) { tracks.add(m.track); tracks.add(orig.get(m.id).track); }
      P.recalcCrossfades([...tracks]);
      KC.commit(copied ? 'Copier des événements' : 'Déplacer des événements');
      T.redraw();
    });
  }

  function startSlip(e, ev, px) {
    const m = P.media(ev.media);
    if (!m || m.kind === 'image') return startMove(e, ev, px, 0, {});
    const group = KC.sel.list().filter(o => o.media === ev.media);
    const orig = new Map(group.map(g => [g.id, g.offset]));
    KC.begin();
    U.drag(e, (dx, dy, mev) => {
      const d = dx / view().zoom;
      for (const g of group) {
        let off = orig.get(g.id) - d * g.speed;
        const maxOff = g.loop !== false ? m.duration : Math.max(0, m.duration - g.length * g.speed);
        off = U.clamp(off, 0, Math.max(0, maxOff));
        g.offset = off;
      }
      showTip('Décalage source : ' + U.fmtTime(ev.offset, P.fps()), mev);
      E.redraw(); T.redraw();
    }, () => { showTip(null); KC.commit('Glisser le contenu'); });
  }

  function startTrim(e, ev, left, px) {
    const members = KC.sel.list().filter(o => left ? Math.abs(o.start - ev.start) < 1e-6 : Math.abs(o.start + o.length - ev.start - ev.length) < 1e-6);
    const orig = new Map(members.map(m => [m.id, { start: m.start, length: m.length, offset: m.offset, speed: m.speed, fadeIn: m.fadeIn, fadeOut: m.fadeOut }]));
    const excl = new Set(members.map(m => m.id));
    const pts = snapPoints(excl);
    const stretch = e.ctrlKey;
    const rippleOn = KC.prefs.ripple !== 'off';
    const origEnd = ev.start + ev.length;
    KC.begin();
    let lastDelta = 0;
    U.drag(e, (dx, dy, mev) => {
      const o = orig.get(ev.id);
      let edge = left ? o.start + dx / view().zoom : o.start + o.length + dx / view().zoom;
      const sn = snapTime(edge, pts, mev); edge = sn.t; T.snapLine = sn.line;
      const fr = P.frame();
      for (const m of members) {
        const om = orig.get(m.id);
        const srcLen = P.sourceLength(m);
        const loops = m.loop !== false || !isFinite(srcLen);
        if (left) {
          let ns = Math.min(edge, om.start + om.length - fr);
          if (!stretch) {
            const minS = loops && !m.media ? 0 : om.start - om.offset / om.speed;
            ns = Math.max(ns, (m.gen || (P.media(m.media) || {}).kind === 'image') ? 0 : minS, 0);
            m.start = ns; m.length = om.start + om.length - ns;
            m.offset = Math.max(0, om.offset + (ns - om.start) * om.speed);
          } else {
            ns = Math.max(0, ns);
            const nl = om.start + om.length - ns;
            m.speed = U.clamp(om.speed * om.length / nl, 0.1, 10); m.start = ns; m.length = nl;
          }
        } else {
          let nl = Math.max(fr, edge - om.start);
          if (!stretch) {
            if (!loops) nl = Math.min(nl, (srcLen - om.offset) / om.speed);
            m.length = nl;
          } else {
            m.speed = U.clamp(om.speed * om.length / nl, 0.1, 10); m.length = om.length * om.speed / m.speed;
          }
        }
        if (m.fadeIn > m.length) m.fadeIn = m.length;
        if (m.fadeOut > m.length - m.fadeIn) m.fadeOut = Math.max(0, m.length - m.fadeIn);
      }
      if (!left && rippleOn) {
        const nd = ev.start + ev.length - origEnd;
        P.ripple(origEnd + Math.min(0, lastDelta) - 1e-6, nd - lastDelta, KC.prefs.ripple === 'all' ? null : [...new Set(members.map(m => m.track))], [...excl]);
        lastDelta = nd;
      }
      showTip((stretch ? 'Vitesse ×' + U.fmtNum(ev.speed, 2) + ' — ' : '') + 'Longueur : ' + U.fmtTime(ev.length, P.fps()), mev);
      E.redraw(); T.redraw();
    }, () => {
      showTip(null); T.snapLine = null;
      P.recalcCrossfades([...new Set(members.map(m => m.track))]);
      KC.commit(stretch ? 'Modifier la vitesse' : 'Découper un événement');
      T.redraw();
    });
  }

  function startFade(e, ev, isIn, px) {
    const members = KC.sel.list().filter(o => Math.abs(o.start - ev.start) < 1e-6 && Math.abs(o.length - ev.length) < 1e-6);
    if (!members.includes(ev)) members.push(ev);
    const orig = new Map(members.map(m => [m.id, isIn ? m.fadeIn : m.fadeOut]));
    KC.begin();
    U.drag(e, (dx, dy, mev) => {
      for (const m of members) {
        let v = orig.get(m.id) + (isIn ? dx : -dx) / view().zoom;
        v = P.snapFrame(U.clamp(v, 0, m.length - (isIn ? m.fadeOut : m.fadeIn)));
        if (isIn) { m.fadeIn = v; m.xIn = false; } else { m.fadeOut = v; m.xOut = false; }
      }
      showTip((isIn ? 'Fondu d\'entrée : ' : 'Fondu de sortie : ') + U.fmtTime(isIn ? ev.fadeIn : ev.fadeOut, P.fps()), mev);
      E.redraw(); T.redraw();
    }, () => { showTip(null); KC.commit('Modifier un fondu'); });
  }

  function startLevel(e, ev, row) {
    const isV = row.track.kind === 'video';
    const bodyH = row.h - 3 - HEAD;
    const members = KC.sel.list().filter(o => P.kindOf(o) === row.track.kind);
    const orig = new Map(members.map(m => [m.id, isV ? (m.opacity == null ? 1 : m.opacity) : KC.ui.dbToFader(m.gain) / 0.75]));
    KC.begin();
    U.drag(e, (dx, dy, mev) => {
      for (const m of members) {
        const v = U.clamp(orig.get(m.id) - dy / bodyH * (mev.ctrlKey ? 0.2 : 1), 0, 1);
        if (isV) m.opacity = Math.round(v * 1000) / 1000;
        else m.gain = Math.round(KC.ui.faderToDb(v * 0.75) * 10) / 10;
      }
      showTip(isV ? 'Opacité : ' + Math.round(ev.opacity * 100) + ' %' : 'Gain : ' + U.fmtDb(ev.gain), mev);
      E.redraw(); T.redraw();
    }, () => { showTip(null); KC.commit(isV ? 'Modifier l\'opacité' : 'Modifier le gain'); });
  }

  function onMove(e) {
    if (T.dragging) return;
    const r = cv.getBoundingClientRect();
    const ht = hit(e.clientX - r.left, e.clientY - r.top);
    const prev = T.hover && T.hover.ev;
    T.hover = ht && ht.ev ? ht : null;
    cv.style.cursor = T.tool === 'time' || T.tool === 'razor' ? 'crosshair' : Math.abs(e.clientX - r.left - X(E.time)) <= 6 ? 'ew-resize' : ht ? (CURSORS[ht.zone] || 'default') : 'default';
    if (ht && ht.zone === 'empty' && T.tool === 'select') cv.style.cursor = 'crosshair';
    if ((T.hover && T.hover.ev) !== prev) T.redraw();
  }

  /* ============================================================ règle : curseur, sélection, marqueurs */
  function onRulerDown(e) {
    const r = rcv.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    if (e.button === 2) {
      const mk = markerAt(px, py);
      if (mk) { KC.context(e, markerMenu(mk)); return; }
      KC.context(e, [
        ...addTrackMenu(), '-',
        { label: 'Insérer un marqueur ici', icon: 'marker', action: () => KC.edit('Ajouter un marqueur', () => P.addMarker(TT(px))) },
        { label: 'Effacer la sélection temporelle', action: () => { KC.project.loop = { in: 0, out: 0 }; KC.emit('loop'); T.redraw(); } },
        '-',
        { label: 'Format : temps et images', checked: KC.prefs.timeFormat === 'smpte', action: () => setTimeFormat('smpte') },
        { label: 'Format : heures, minutes, secondes', checked: KC.prefs.timeFormat === 'sec', action: () => setTimeFormat('sec') },
        { label: 'Format : images', checked: KC.prefs.timeFormat === 'frames', action: () => setTimeFormat('frames') },
      ]);
      return;
    }
    if (e.button !== 0) return;
    if (py < RULER_LOOP) {
      // Cette bande crée une plage directement, sans changer d'outil.
      const lp = KC.project.loop;
      const nearIn = lp.out > lp.in && Math.abs(px - X(lp.in)) < 7;
      const nearOut = lp.out > lp.in && Math.abs(px - X(lp.out)) < 7;
      if (e.detail === 2) {
        const t = Math.max(0, TT(px));
        const ev = KC.project.events.find(ev => P.kindOf(ev) === 'video' && t >= ev.start && t < ev.start + ev.length);
        if (ev) { KC.project.loop = { in: ev.start, out: ev.start + ev.length }; KC.emit('loop'); C.playSelection(); }
        return;
      }
      const resume = E.beginScrub();
      const pts = snapPoints(new Set()), o = { ...lp };
      const start = snapTime(Math.max(0, TT(px)), pts, e).t;
      let moved = false;
      E.seek(start);
      U.drag(e, (dx, dy, ev) => {
        if (!moved && Math.abs(dx) < 3) return;
        moved = true;
        const t = snapTime(Math.max(0, TT(ev.clientX - r.left)), pts, ev);
        T.snapLine = t.line;
        if (nearIn) KC.project.loop.in = Math.max(0, Math.min(t.t, o.out - P.frame()));
        else if (nearOut) KC.project.loop.out = Math.max(t.t, o.in + P.frame());
        else if (e.altKey && o.out > o.in && start > o.in && start < o.out) {
          const len = o.out - o.in;
          KC.project.loop.in = Math.max(0, o.in + P.snapFrame(dx / view().zoom));
          KC.project.loop.out = KC.project.loop.in + len;
        } else KC.project.loop = { in: Math.min(start, t.t), out: Math.max(start, t.t) };
        E.seek(t.t);
        KC.emit('loop'); T.redraw();
      }, () => {
        T.snapLine = null;
        if (moved && KC.project.loop.out > KC.project.loop.in) {
          KC.prefs.loop = true; KC.prefs.save(); KC.emit('prefs');
          E.seek(KC.project.loop.in);
          KC.markDirty();
        }
        E.endScrub(resume); T.redraw();
      });
      return;
    }
    if (py < RULER_LOOP + RULER_MARK) {
      const mk = markerAt(px, py);
      if (mk) {
        if (e.detail === 2) { renameMarker(mk); return; }
        E.seek(mk.t);
        const t0 = mk.t;
        let moved = false;
        U.drag(e, (dx) => { if (!moved && Math.abs(dx) < 3) return; if (!moved) { moved = true; KC.begin(); } mk.t = Math.max(0, P.snapFrame(t0 + dx / view().zoom)); T.redraw(); }, () => { if (moved) { KC.project.markers.sort((a, b) => a.t - b.t); KC.commit('Déplacer un marqueur'); } });
        return;
      }
    }
    // règle : positionner le curseur et faire défiler
    startScrub(e, rcv);
  }
  function startScrub(e, surface) {
    const r = surface.getBoundingClientRect();
    const wasPlaying = E.beginScrub();
    const seekAt = ev => E.seek(Math.max(0, TT(ev.clientX - r.left)));
    seekAt(e);
    U.drag(e, (dx, dy, ev) => seekAt(ev), () => E.endScrub(wasPlaying));
  }

  function markerAt(px, py) {
    if (py < RULER_LOOP || py > RULER_LOOP + RULER_MARK) return null;
    rcx.font = '600 10px Outfit, Segoe UI, sans-serif';
    for (const m of KC.project.markers.slice().reverse()) {
      const mx = X(m.t), tw = rcx.measureText(String(m.num || '') + (m.name ? ' ' + m.name : '')).width + 8;
      if (px >= mx - 2 && px <= mx + tw) return m;
    }
    return null;
  }
  async function renameMarker(mk) {
    const n = await KC.prompt('Renommer le marqueur', 'Nom du marqueur', mk.name || '');
    if (n != null) KC.edit('Renommer un marqueur', () => { mk.name = n; });
  }
  function markerMenu(mk) {
    return [
      { label: 'Renommer…', action: () => renameMarker(mk) },
      { label: 'Aller au marqueur', action: () => E.seek(mk.t) },
      { label: 'Supprimer', icon: 'trash', action: () => KC.edit('Supprimer un marqueur', () => { KC.project.markers = KC.project.markers.filter(m => m !== mk); }) },
      '-',
      { label: 'Supprimer tous les marqueurs', action: () => KC.edit('Supprimer les marqueurs', () => { KC.project.markers = []; }) },
    ];
  }
  function setTimeFormat(f) { KC.prefs.timeFormat = f; KC.prefs.save(); KC.emit('time-format'); T.redraw(); updateClock(); }

  /* ============================================================ menus contextuels */
  function addTrackMenu() {
    return [
      { label: 'Insérer une piste vidéo', icon: 'video', key: 'Ctrl+Maj+Q', action: KC.cmd.addVideoTrack },
      { label: 'Insérer une piste audio', icon: 'audio', key: 'Ctrl+Q', action: KC.cmd.addAudioTrack },
    ];
  }
  function eventMenu(ev) {
    const isV = P.kindOf(ev) === 'video';
    const m = ev.media ? P.media(ev.media) : null;
    const sel = KC.sel.list();
    const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
    const colorsSub = [{ label: 'Couleur de la piste', checked: !ev.color, action: () => KC.edit('Couleur', () => sel.forEach(s => { s.color = null; })) },
      ...P.TRACK_COLORS.map((c, i) => ({ label: ['Rouge', 'Orange', 'Jaune', 'Vert', 'Cyan', 'Bleu', 'Violet', 'Rose', 'Gris'][i], checked: ev.color === c, action: () => KC.edit('Couleur', () => sel.forEach(s => { s.color = c; })) }))];
    return [
      ...addTrackMenu(), '-',
      { label: 'Lire cet événement en boucle', icon: 'loop', action: () => { KC.project.loop = { in: ev.start, out: ev.start + ev.length }; KC.emit('loop'); KC.cmd.playSelection(); } },
      '-',
      { label: 'Couper', icon: 'cut', key: 'Ctrl+X', action: KC.cmd.cut },
      { label: 'Copier', icon: 'copy', key: 'Ctrl+C', action: KC.cmd.copy },
      { label: 'Supprimer', icon: 'trash', key: 'Suppr', action: KC.cmd.deleteSel },
      { label: 'Diviser', icon: 'split', key: 'S', action: KC.cmd.split },
      '-',
      isV ? { label: 'Panoramique/Recadrage de l\'événement…', icon: 'pancrop', action: () => KC.windows.panCrop(ev) } : null,
      isV ? { label: 'Transformer la sélection / tout le projet…', icon: 'pancrop', action: () => KC.dialogs.batchTransform() } : null,
      isV ? { label: 'Effets d\'événement vidéo…', icon: 'fx', action: () => KC.windows.eventFx(ev) } : null,
      ev.gen ? { label: ev.gen.type === 'text' ? 'Modifier le texte…' : 'Modifier le générateur…', icon: 'text', action: () => KC.windows.generator(ev) } : null,
      isV && ev.fadeIn > 0 ? { label: 'Durée de la transition…', icon: 'transition', action: () => KC.cmd.transitionDuration(ev) } : null,
      isV ? { label: 'Transition d\'entrée', icon: 'transition', sub: () => Object.entries(FX.TRANSITIONS).map(([k, d]) => ({ label: d.name, checked: (ev.transition || 'dissolve') === k, action: () => KC.cmd.setTransition(k, sel.filter(s => P.kindOf(s) === 'video')) })) } : null,
      { label: 'Vitesse de lecture', icon: 'speed', sub: () => [...speeds.map(s => ({ label: Math.round(s * 100) + ' %', checked: Math.abs(ev.speed - s) < 1e-6, action: () => KC.cmd.setSpeed(s) })), '-', { label: 'Personnalisée…', action: () => KC.dialogs.eventProps(ev) }] },
      '-',
      { label: 'Groupe', icon: 'group', sub: [
        { label: 'Créer un groupe', key: 'G', action: KC.cmd.group },
        { label: 'Retirer du groupe', key: 'U', action: KC.cmd.ungroup },
        { label: 'Sélectionner le groupe', action: () => { KC.sel.set(P.groupOf(ev).map(x => x.id)); T.redraw(); } },
      ] },
      { label: 'Commutateurs', sub: [
        { label: 'Muet', checked: !!ev.mute, action: () => KC.edit('Muet', () => { const v = !ev.mute; sel.forEach(s => { s.mute = v; }); }) },
        m && m.kind !== 'image' ? { label: 'Boucle', checked: ev.loop !== false, action: () => KC.edit('Boucle', () => { const v = ev.loop === false; sel.forEach(s => { s.loop = v; }); }) } : null,
        !isV ? { label: 'Normaliser', checked: !!ev.norm, action: KC.cmd.normalize } : null,
      ] },
      { label: 'Couleur de l\'événement', icon: 'color', sub: colorsSub },
      '-',
      m ? { label: 'Afficher dans l\'explorateur Windows', action: () => KC.native.showInFolder(m.path) } : null,
      m ? { label: 'Remplacer le média…', action: () => M.relink(m) } : null,
      m && m.kind !== 'image' ? { label: 'Créer un proxy vidéo', icon: 'bolt', action: () => M.makeProxy(m) } : null,
      m && m.kind === 'video' ? { label: 'Agrandir avec l\'IA…', icon: 'wand', action: () => KC.ai.dialog(m) } : null,
      m && m.kind === 'video' ? { label: 'Couper les passages figés…', icon: 'cut', action: () => KC.cmd.cutFreezes(KC.sel.has(ev.id) ? null : [ev]) } : null,
      m && m.origPath ? { label: 'Revenir au fichier original', icon: 'reset', action: () => M.restoreOriginal(m) } : null,
      { label: 'Propriétés…', icon: 'props', action: () => KC.dialogs.eventProps(ev) },
    ];
  }
  function emptyMenu(t, track) {
    return [
      { label: 'Coller ici', icon: 'paste', key: 'Ctrl+V', disabled: !KC.clipboard, action: () => { E.seek(P.snapFrame(t)); KC.cmd.paste(track); } },
      { label: 'Insérer un texte ici', icon: 'text', action: () => KC.cmd.insertGenerator('text', t, track?.kind === 'video' ? track.id : null) },
      { label: 'Insérer une couleur unie ici', icon: 'solid', action: () => KC.cmd.insertGenerator('solid', t, track?.kind === 'video' ? track.id : null) },
      { label: 'Insérer un marqueur ici', icon: 'marker', action: () => KC.edit('Ajouter un marqueur', () => P.addMarker(t)) },
      '-',
      ...addTrackMenu(),
      '-',
      { label: 'Tout sélectionner', key: 'Ctrl+A', action: KC.cmd.selectAll },
    ];
  }

  /* ============================================================ glisser-déposer depuis les panneaux */
  // KC.dnd = { kind: 'media'|'path'|'gen'|'vfx'|'afx'|'trans', ... } renseigné au début du glisser
  KC.dnd = null;
  function dropTarget(e) {
    const r = cv.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    return { px, py, t: TT(px), row: rowAt(py), ht: hit(px, py) };
  }
  function ghostFor(d, tg, ev) {
    const pts = snapPoints(new Set());
    const sn = snapTime(Math.max(0, tg.t), pts, ev);
    T.snapLine = sn.line;
    const t = sn.t;
    if (d.kind === 'media') {
      const ms = d.ids.map(id => P.media(id)).filter(Boolean);
      let cur = t; const g = [];
      for (const m of ms) {
        const len = m.kind === 'image' ? KC.prefs.imageLength : (d.out || m.duration) - (d.in || 0);
        const trackId = tg.row ? tg.row.track.id : null;
        g.push({ start: cur, length: len, trackId: trackId && ((m.hasVideo && tg.row.track.kind === 'video') || (!m.hasVideo && tg.row.track.kind === 'audio')) ? trackId : null, y: T.totalHeight() - view().scrollY, label: m.name });
        cur += len;
      }
      return g;
    }
    if (d.kind === 'path') return [{ start: t, length: 5, trackId: tg.row ? tg.row.track.id : null, y: T.totalHeight() - view().scrollY, label: d.paths.length > 1 ? d.paths.length + ' fichiers' : U.base(d.paths[0]) }];
    if (d.kind === 'gen') return [{ start: t, length: KC.prefs.genLength, trackId: tg.row && tg.row.track.kind === 'video' ? tg.row.track.id : null, y: T.totalHeight() - view().scrollY, label: FX.GENERATORS[d.type].name }];
    return null;
  }
  function onDragOver(e) {
    const d = KC.dnd;
    const files = e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    if (!d && !files) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const tg = dropTarget(e);
    if (d && (d.kind === 'vfx' || d.kind === 'trans')) {
      T.ghost = null;
      T.hover = tg.ht && tg.ht.ev && P.kindOf(tg.ht.ev) === 'video' ? tg.ht : null;
      T.redraw();
      return;
    }
    T.ghost = d ? ghostFor(d, tg, e) : [{ start: P.snapFrame(Math.max(0, tg.t)), length: 5, trackId: tg.row ? tg.row.track.id : null, y: T.totalHeight() - view().scrollY, label: 'Fichiers' }];
    T.redraw();
  }
  function onDragLeave() { T.ghost = null; T.snapLine = null; T.redraw(); }
  async function onDrop(e) {
    e.preventDefault();
    const d = KC.dnd; KC.dnd = null;
    const tg = dropTarget(e);
    const ghost = T.ghost; T.ghost = null; T.snapLine = null; T.redraw();
    const t = ghost && ghost[0] ? ghost[0].start : P.snapFrame(Math.max(0, tg.t));
    const trackId = tg.row ? tg.row.track.id : null;
    if (d && d.kind === 'vfx') {
      if (tg.ht && tg.ht.ev && P.kindOf(tg.ht.ev) === 'video') {
        const targets = KC.sel.has(tg.ht.ev.id) ? KC.sel.list().filter(s => P.kindOf(s) === 'video') : [tg.ht.ev];
        KC.edit('Ajouter un effet', () => targets.forEach(ev => ev.fx.push(FX.make(d.type))));
        KC.windows.eventFx(tg.ht.ev);
      } else KC.toast('Déposez l\'effet sur un événement vidéo', 'info');
      return;
    }
    if (d && d.kind === 'trans') {
      if (tg.ht && tg.ht.ev && P.kindOf(tg.ht.ev) === 'video') KC.cmd.setTransition(d.type, [tg.ht.ev]);
      else KC.toast('Déposez la transition sur un événement vidéo', 'info');
      return;
    }
    if (d && d.kind === 'gen') { KC.cmd.insertGenerator(d.type, t, trackId && P.track(trackId).kind === 'video' ? trackId : null); return; }
    let medias = [];
    if (d && d.kind === 'media') medias = d.ids.map(id => P.media(id)).filter(Boolean);
    else {
      const paths = d && d.kind === 'path' ? d.paths : [...(e.dataTransfer.files || [])].map(f => KC.native.pathForFile(f)).filter(Boolean);
      const ok = paths.filter(M.isMedia);
      if (paths.some(p => /\.kcp$/i.test(p))) { KC.cmd.openProject(paths.find(p => /\.kcp$/i.test(p))); return; }
      if (!ok.length) { if (paths.length) KC.toast('Aucun média reconnu', 'err'); return; }
      medias = await KC.busy(() => M.import(ok));
    }
    if (!medias.length) return;
    T.placeMedias(medias, t, trackId, d && d.kind === 'media' ? { in: d.in, out: d.out } : {});
  }
  T.placeMedias = async (medias, t, trackId, range = {}) => {
    const wasEmpty = KC.project.events.length === 0;
    let created = [];
    KC.edit(medias.length > 1 ? 'Ajouter des médias' : 'Ajouter un média', () => {
      let cur = t;
      for (const m of medias) {
        const evs = P.placeMedia(m, cur, { track: trackId, in: range.in, out: range.out });
        created.push(...evs);
        if (evs.length) cur = evs[0].start + evs[0].length;
      }
      P.recalcCrossfades([...new Set(created.map(c => c.track))]);
    });
    KC.sel.set(created.map(c => c.id));
    T.redraw();
    const firstV = medias.find(m => m.hasVideo && m.kind === 'video' && m.width);
    if (wasEmpty && firstV) KC.dialogs.matchMedia(firstV);
  };

  /* ============================================================ en-têtes de piste */
  function buildHeaders() {
    headersInner.innerHTML = '';
    const tracks = KC.project.tracks;
    let y = 0;
    tracks.forEach((tr, i) => {
      const el = header(tr, i);
      el.style.top = y + 'px'; el.style.height = tr.height + 'px';
      y += tr.height;
      headersInner.appendChild(el);
    });
    headersInner.style.height = y + 'px';
    syncScroll();
  }
  function header(tr, i) {
    const col = trackColor(tr);
    const isV = tr.kind === 'video';
    const anySolo = KC.project.tracks.some(t => t.kind === tr.kind && t.solo);
    const num = h('div.num', { style: { background: col }, text: String(i + 1), title: 'Glisser pour réordonner' });
    const name = h('div.tname', { text: P.trackLabel(tr), title: 'Double-clic pour renommer' });
    name.addEventListener('dblclick', () => {
      const inp = h('input', { value: tr.name || P.trackLabel(tr) });
      name.innerHTML = ''; name.appendChild(inp); inp.focus(); inp.select();
      const done = ok => { if (ok) KC.edit('Renommer la piste', () => { tr.name = inp.value.trim(); }); buildHeaders(); };
      inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
      inp.addEventListener('blur', () => done(true));
    });
    const btn = (label, cls, title, on, fn) => { const b = h('div.tbtn' + (on ? '.' + cls : ''), { title, html: label }); b.addEventListener('click', e => { e.stopPropagation(); fn(); }); return b; };
    const row1 = h('div.row1',
      h('span.tkind', { html: KC.icon(isV ? 'video' : 'audio') }), name,
      !isV ? btn(KC.icon('fx'), 'on-fx', 'Effets de piste…', tr.fx && tr.fx.length, () => KC.windows.trackFx(tr)) : null,
      isV ? btn(KC.icon('pancrop'), 'on-fx', 'Mouvement de la piste (zoom, position, rotation)…', !FX.tmIsIdentity(tr), () => KC.windows.trackMotion(tr)) : null,
      btn('M', 'on-m', 'Muet', tr.mute, () => { KC.edit('Muet', () => { tr.mute = !tr.mute; }); }),
      btn('S', 'on-s', 'Solo', tr.solo, () => { KC.edit('Solo', () => { tr.solo = !tr.solo; }); }),
    );
    void anySolo;
    const body = h('div.body', row1);
    if (isV) {
      const val = h('span.val', { text: Math.round(tr.level * 100) + ' %' });
      const sl = KC.ui.hslider({ value: tr.level, def: 1, onStart: () => KC.begin(), onInput: v => { tr.level = Math.round(v * 100) / 100; val.textContent = Math.round(tr.level * 100) + ' %'; E.redraw(); }, onEnd: () => KC.commit('Niveau de la piste') });
      body.append(h('div.row2', h('span.lbl', { text: 'Niveau' }), sl, val));
      if (tr.height >= 64) {
        const zv = h('span.val', { text: Math.round(FX.tmOf(tr).zoom * 100) + ' %', title: 'Double-clic sur le curseur : 100 %' });
        const zs = KC.ui.hslider({ value: FX.tmOf(tr).zoom, def: 1, map: z => (Math.log2(U.clamp(z, 0.25, 4)) + 2) / 4, unmap: p => { const z = Math.pow(2, p * 4 - 2); return Math.abs(z - 1) < 0.03 ? 1 : Math.round(z * 100) / 100; },
          onStart: () => KC.begin(), onInput: v => { tr.tm = { ...FX.tmOf(tr), zoom: v }; zv.textContent = Math.round(v * 100) + ' %'; E.redraw(); }, onEnd: () => KC.commit('Zoom de la piste') });
        body.append(h('div.row2', h('span.lbl', { text: 'Zoom' }), zs, zv));
      }
    } else {
      const val = h('span.val', { text: U.fmtDb(tr.volume) });
      const sl = KC.ui.hslider({ value: tr.volume, def: 0, map: db => KC.ui.dbToFader(db), unmap: p => { const d = KC.ui.faderToDb(p); return isFinite(d) ? Math.round(d * 10) / 10 : -Infinity; }, onStart: () => KC.begin(), onInput: v => { tr.volume = isFinite(v) ? v : -80; val.textContent = U.fmtDb(tr.volume); }, onEnd: () => KC.commit('Volume de la piste') });
      const pv = h('span.val', { text: panText(tr.pan) });
      const pan = KC.ui.hslider({ value: tr.pan, def: 0, center: true, map: v => (v + 1) / 2, unmap: p => Math.round((p * 2 - 1) * 100) / 100, onStart: () => KC.begin(), onInput: v => { tr.pan = v; pv.textContent = panText(v); }, onEnd: () => KC.commit('Panoramique de la piste') });
      const meter = h('div.meter', h('i'));
      meter.dataset.track = tr.id;
      if (tr.height >= 62) body.append(h('div.row2', h('span.lbl', { text: 'Vol.' }), sl, val), h('div.row2', h('span.lbl', { text: 'Pan.' }), pan, pv), meter);
      else body.append(h('div.row2', h('span.lbl', { text: 'Vol.' }), sl, val), meter);
    }
    const el = h('div.track-h' + (KC.sel.track === tr.id ? '.sel' : ''), num, body, h('div.resize'));
    el.dataset.id = tr.id;
    el.addEventListener('mousedown', () => { KC.sel.track = tr.id; KC.$$('.track-h').forEach(x => x.classList.toggle('sel', x.dataset.id === tr.id)); T.redraw(); });
    el.addEventListener('contextmenu', e => KC.context(e, trackMenu(tr)));
    // redimensionner
    el.querySelector('.resize').addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      const h0 = tr.height;
      U.drag(e, (dx, dy) => { tr.height = U.clamp(Math.round(h0 + dy), 34, 260); buildHeaders(); T.redraw(); }, () => KC.markDirty());
    });
    // réordonner
    num.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      const idx0 = KC.project.tracks.indexOf(tr);
      let moved = false;
      U.drag(e, (dx, dy, ev) => {
        const r = headersInner.parentElement.getBoundingClientRect();
        const rr = rowAt(ev.clientY - r.top);
        if (!rr || rr.track === tr) return;
        if (!moved) { moved = true; KC.begin(); }
        const p = KC.project.tracks;
        p.splice(p.indexOf(tr), 1);
        p.splice(p.indexOf(rr.track) + (p.indexOf(rr.track) >= idx0 ? 1 : 0), 0, tr);
        buildHeaders(); T.redraw(); E.redraw();
      }, () => { if (moved) KC.commit('Réordonner les pistes'); });
    });
    // dépôt d'effets audio sur l'en-tête
    el.addEventListener('dragover', e => { if (KC.dnd && KC.dnd.kind === 'afx' && !isV) { e.preventDefault(); el.classList.add('drop-target'); } });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', e => {
      el.classList.remove('drop-target');
      if (!(KC.dnd && KC.dnd.kind === 'afx') || isV) return;
      e.preventDefault();
      const type = KC.dnd.type; KC.dnd = null;
      KC.edit('Ajouter un effet de piste', () => tr.fx.push(FX.make(type, true)));
      KC.windows.trackFx(tr);
    });
    return el;
  }
  const panText = v => Math.abs(v) < 0.005 ? 'Centre' : (v < 0 ? 'G ' : 'D ') + Math.round(Math.abs(v) * 100) + ' %';
  function trackMenu(tr) {
    const isV = tr.kind === 'video';
    return [
      { label: 'Insérer une piste vidéo', icon: 'video', action: KC.cmd.addVideoTrack },
      { label: 'Insérer une piste audio', icon: 'audio', action: KC.cmd.addAudioTrack },
      { label: 'Dupliquer la piste', icon: 'copy', action: () => KC.edit('Dupliquer la piste', () => {
        const p = KC.project, i = p.tracks.indexOf(tr);
        const nt = U.deep(tr); nt.id = U.uid(); nt.name = tr.name ? tr.name + ' (copie)' : '';
        p.tracks.splice(i + 1, 0, nt);
        const evs = p.events.filter(e => e.track === tr.id).map(e => ({ ...U.deep(e), id: U.uid(), track: nt.id, group: null }));
        p.events.push(...evs);
      }) },
      { label: 'Supprimer la piste', icon: 'trash', action: () => KC.edit('Supprimer la piste', () => P.removeTrack(tr.id)) },
      '-',
      { label: 'Sélectionner tous les événements', action: () => { KC.sel.set(KC.project.events.filter(e => e.track === tr.id).map(e => e.id)); T.redraw(); } },
      !isV ? { label: 'Effets de piste…', icon: 'fx', action: () => KC.windows.trackFx(tr) } : null,
      isV ? { label: 'Mouvement de la piste (zoom, position, rotation)…', icon: 'pancrop', action: () => KC.windows.trackMotion(tr) } : null,
      isV ? { label: 'Remplir le cadre (toute la piste)', icon: 'fit', action: () => KC.dialogs.fillTrack(tr) } : null,
      isV ? { label: 'Réinitialiser le mouvement de la piste', icon: 'x', disabled: FX.tmIsIdentity(tr), action: () => KC.edit('Réinitialiser le mouvement de la piste', () => { delete tr.tm; }) } : null,
      isV ? { label: 'Transformer les événements de la piste…', icon: 'pancrop', action: () => { KC.sel.set(KC.project.events.filter(e => e.track === tr.id).map(e => e.id)); KC.dialogs.batchTransform(); } } : null,
      { label: 'Couleur de la piste', icon: 'color', sub: P.TRACK_COLORS.map((c, i) => ({ label: ['Rouge', 'Orange', 'Jaune', 'Vert', 'Cyan', 'Bleu', 'Violet', 'Rose', 'Gris'][i], checked: tr.color === i, action: () => KC.edit('Couleur de la piste', () => { tr.color = i; }) })) },
      { label: 'Hauteur', sub: [
        { label: 'Réduite', action: () => { tr.height = 40; buildHeaders(); T.redraw(); } },
        { label: 'Normale', action: () => { tr.height = isV ? 78 : 62; buildHeaders(); T.redraw(); } },
        { label: 'Grande', action: () => { tr.height = 130; buildHeaders(); T.redraw(); } },
      ] },
    ];
  }

  /* ============================================================ défilement / zoom */
  function contentEnd() { return Math.max(P.duration() + 30, TT(W) - view().scroll + 5, 60); }
  function syncScroll() {
    // horizontal
    const hs = KC.$('#tl-hscroll'), th = hs.firstChild;
    const total = contentEnd(), vis = W / view().zoom;
    const tw = hs.clientWidth;
    const w = Math.max(24, tw * Math.min(1, vis / total));
    th.style.width = w + 'px';
    th.style.left = ((tw - w) * U.clamp(view().scroll / Math.max(0.0001, total - vis), 0, 1)) + 'px';
    // vertical
    const vsb = KC.$('#tl-vscroll'), tv = vsb.firstChild;
    const th2 = vsb.clientHeight, tot = Math.max(T.totalHeight() + 40, H);
    const hh = Math.max(24, th2 * Math.min(1, H / tot));
    view().scrollY = U.clamp(view().scrollY, 0, Math.max(0, tot - H));
    tv.style.height = hh + 'px';
    tv.style.top = ((th2 - hh) * (tot - H > 0 ? view().scrollY / (tot - H) : 0)) + 'px';
    headersInner.style.transform = `translateY(${-view().scrollY}px)`;
    const zs = KC.$('#tl-zoom input'); if (zs) zs.value = Math.log(view().zoom);
  }
  T.setZoom = (z, anchorX = W / 2) => {
    const t = TT(anchorX);
    view().zoom = U.clamp(z, 0.2, 4000);
    view().scroll = Math.max(0, t - anchorX / view().zoom);
    syncScroll(); T.redraw();
  };
  T.fit = () => {
    const d = Math.max(5, P.duration());
    view().zoom = U.clamp((W - 40) / d, 0.2, 4000); view().scroll = 0;
    syncScroll(); T.redraw();
  };
  T.ensureVisible = (t) => {
    const x = X(t);
    if (x > W - 20) { view().scroll = t - (W * 0.1) / view().zoom; syncScroll(); T.redraw(); }
    else if (x < 0) { view().scroll = Math.max(0, t - (W * 0.1) / view().zoom); syncScroll(); T.redraw(); }
  };
  function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey) { view().scroll = Math.max(0, view().scroll + (e.deltaY || e.deltaX) / view().zoom); syncScroll(); T.redraw(); return; }
    if (e.shiftKey) { view().scrollY += e.deltaY; syncScroll(); T.redraw(); return; }
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { view().scroll = Math.max(0, view().scroll + e.deltaX / view().zoom); syncScroll(); T.redraw(); return; }
    const r = cv.getBoundingClientRect();
    T.setZoom(view().zoom * Math.pow(1.0018, -e.deltaY), e.clientX - r.left);
  }

  /* ============================================================ horloge, transport */
  function updateClock() {
    const c = KC.$('#tl-clock');
    if (c.querySelector('input')) return;
    const big = c.querySelector('.big'), small = c.querySelector('.small');
    big.textContent = U.fmtTime(E.time, P.fps());
    const duration = KC.eventIndex.duration();
    const summary = [duration, KC.project.settings.width, KC.project.settings.height, P.fps(), KC.prefs.timeFormat].join('|');
    if (small.dataset.summary === summary) return;
    small.dataset.summary = summary;
    small.innerHTML = '';
    small.append(h('span', { text: 'Durée ' + U.fmtTime(duration, P.fps()) }), h('span', { text: Math.round(KC.project.settings.width) + '×' + Math.round(KC.project.settings.height) + ' · ' + U.fmtFps(P.fps()) + ' i/s' }));
  }
  function buildClock() {
    const c = KC.$('#tl-clock');
    c.innerHTML = '';
    const big = h('div.big', { title: 'Double-clic : aller à un temps précis' });
    c.append(big, h('div.small'));
    big.addEventListener('dblclick', () => {
      const inp = h('input.big', { value: U.fmtTime(E.time, P.fps()) });
      big.replaceWith(inp); inp.focus(); inp.select();
      const done = ok => { if (ok) { const t = U.parseTime(inp.value, P.fps()); if (t != null) E.seek(t); } buildClock(); updateClock(); };
      inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
      inp.addEventListener('blur', () => done(false));
    });
    c.addEventListener('contextmenu', e => KC.context(e, [
      ...addTrackMenu(), '-',
      { label: 'Temps et images (SMPTE)', checked: KC.prefs.timeFormat === 'smpte', action: () => setTimeFormat('smpte') },
      { label: 'Heures, minutes, secondes', checked: KC.prefs.timeFormat === 'sec', action: () => setTimeFormat('sec') },
      { label: 'Images', checked: KC.prefs.timeFormat === 'frames', action: () => setTimeFormat('frames') },
    ]));
  }
  function buildTransport() {
    const tp = KC.$('#transport');
    tp.innerHTML = '';
    const b = (icon, title, fn, id, label) => {
      const x = h('button.tb' + (label ? '.transport-label' : ''), { title, 'aria-label': title, html: KC.icon(icon) });
      if (label) x.append(h('span', { text: label }));
      if (id) x.id = id;
      x.addEventListener('click', fn); tp.appendChild(x); return x;
    };
    const sep = () => tp.append(h('span.transport-sep', { 'aria-hidden': 'true' }));
    b('to-start', 'Aller au début', () => E.seek(0));
    b('prev-frame', 'Image précédente (←)', () => E.step(-1));
    b('play', 'Lire / pause (Entrée)', () => E.togglePause(), 'tp-play', 'Lire');
    b('stop', 'Arrêt et retour au départ (Échap)', () => E.stop());
    b('next-frame', 'Image suivante (→)', () => E.step(1));
    b('to-end', 'Aller à la fin', () => E.seek(P.duration()));
    const seek = h('input#tp-seek', { type: 'range', min: 0, max: P.duration(), step: P.frame(), value: E.time, 'aria-label': 'Position de lecture', title: 'Glisser pour parcourir la vidéo' });
    seek.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      // Le déplacement est explicite : les rafraîchissements du slider ne perturbent pas le glissement natif.
      e.preventDefault();
      const resume = E.beginScrub(), rect = seek.getBoundingClientRect(), end = P.duration();
      const seekAt = ev => E.seek(U.clamp((ev.clientX - rect.left - 8) / Math.max(1, rect.width - 16), 0, 1) * end);
      seekAt(e);
      U.drag(e, (dx, dy, ev) => seekAt(ev), () => E.endScrub(resume));
    });
    seek.addEventListener('input', () => E.seek(Number(seek.value)));
    tp.append(seek, h('span#tp-time'));
    sep();
    const speed = h('select#tp-speed', { 'aria-label': 'Vitesse de lecture', title: 'Vitesse de lecture' }, [0.25, 0.5, 1, 1.5, 2].map(v => h('option', { value: v, text: v + '×', selected: v === 1 })));
    speed.addEventListener('change', () => E.setRate(Number(speed.value)));
    tp.append(speed);
    b('audio', 'Activer / couper le son de l’aperçu', () => { E.masterMute = !E.masterMute; updateTransport(); }, 'tp-mute');
    sep();
    b('region', 'Sélection temporelle : glisser sur la timeline, même sur un clip', () => { T.tool = T.tool === 'time' ? 'edit' : 'time'; updateTransport(); T.redraw(); }, 'tp-region', 'Sélection');
    b('to-start', 'Définir le début de sélection (I)', () => KC.cmd.markIn(), null, 'I');
    b('to-end', 'Définir la fin de sélection (O)', () => KC.cmd.markOut(), null, 'O');
    b('loop', 'Activer / désactiver la boucle (Q)', () => KC.cmd.toggleLoop(), 'tp-loop');
    b('play', 'Lire la sélection en boucle', () => KC.cmd.playSelection(), 'tp-selection', 'Lire la sélection');
    b('reset', 'Effacer la sélection temporelle', () => { KC.project.loop = { in: 0, out: 0 }; KC.emit('loop'); }, 'tp-clear');
    tp.append(h('span#tp-region-info'));
    b('video', 'Ajouter une piste vidéo', () => C.addVideoTrack(), null, '+ Vidéo');
    b('audio', 'Ajouter une piste audio', () => C.addAudioTrack(), null, '+ Audio');
    updateTransport();
  }
  function updateTransport() {
    const lp = KC.project.loop, hasLoop = lp.out > lp.in;
    for (const [id, on] of [['tp-loop', KC.prefs.loop], ['tp-region', T.tool === 'time'], ['tp-mute', E.masterMute]]) {
      const el = KC.$('#' + id); if (el) { el.classList.toggle('on', !!on); el.setAttribute('aria-pressed', String(!!on)); }
    }
    const p = KC.$('#tp-play');
    if (p && p.getAttribute('aria-pressed') !== String(E.playing)) { p.innerHTML = KC.icon(E.playing ? 'pause' : 'play'); p.append(h('span', { text: E.playing ? 'Pause' : 'Lire' })); p.setAttribute('aria-pressed', String(E.playing)); }
    for (const id of ['tp-selection', 'tp-clear']) { const el = KC.$('#' + id); if (el) el.disabled = !hasLoop; }
    const info = KC.$('#tp-region-info');
    if (info) info.textContent = hasLoop ? 'Sélection : ' + U.fmtTime(lp.in, P.fps()) + ' → ' + U.fmtTime(lp.out, P.fps()) + ' · Durée ' + U.fmtTime(lp.out - lp.in, P.fps()) : 'Glissez dans la bande au-dessus des pistes pour sélectionner une boucle. Double-clic : boucle du clip.';
    const speed = KC.$('#tp-speed'); if (speed) speed.value = String(E.rate);
    updatePosition();
  }
  function updatePosition() {
    const seek = KC.$('#tp-seek');
    if (seek) { seek.max = Math.max(P.duration(), E.time); seek.step = P.frame(); seek.value = E.time; }
    const time = KC.$('#tp-time'); if (time) time.textContent = U.fmtTime(E.time, P.fps()) + ' / ' + U.fmtTime(P.duration(), P.fps());
  }
  function buildZoom() {
    const z = KC.$('#tl-zoom');
    z.innerHTML = '';
    const out = h('button.tb', { title: 'Zoom arrière (↓)', html: KC.icon('zoom-out') });
    const rng = h('input', { type: 'range', min: Math.log(0.2), max: Math.log(4000), step: 0.01, value: Math.log(view().zoom), title: 'Zoom' });
    const inn = h('button.tb', { title: 'Zoom avant (↑)', html: KC.icon('zoom-in') });
    const fit = h('button.tb', { title: 'Afficher tout le projet', html: KC.icon('fit') });
    out.addEventListener('click', () => T.setZoom(view().zoom / 1.5));
    inn.addEventListener('click', () => T.setZoom(view().zoom * 1.5));
    fit.addEventListener('click', () => T.fit());
    rng.addEventListener('input', () => T.setZoom(Math.exp(parseFloat(rng.value))));
    z.append(out, rng, inn, fit);
  }
  function bindScrollbars() {
    const hs = KC.$('#tl-hscroll'), th = hs.firstChild;
    th.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation(); th.classList.add('drag');
      const s0 = view().scroll, total = contentEnd(), vis = W / view().zoom, tw = hs.clientWidth - th.offsetWidth;
      U.drag(e, dx => { view().scroll = U.clamp(s0 + dx / Math.max(1, tw) * (total - vis), 0, Math.max(0, total - vis)); syncScroll(); T.redraw(); }, () => th.classList.remove('drag'));
    });
    hs.addEventListener('pointerdown', e => {
      const r = hs.getBoundingClientRect(); const vis = W / view().zoom;
      view().scroll = Math.max(0, view().scroll + (e.clientX - r.left < th.offsetLeft ? -vis : vis) * 0.9); syncScroll(); T.redraw();
    });
    const vs = KC.$('#tl-vscroll'), tv = vs.firstChild;
    tv.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation(); tv.classList.add('drag');
      const y0 = view().scrollY, tot = Math.max(T.totalHeight() + 40, H), tr = vs.clientHeight - tv.offsetHeight;
      U.drag(e, (dx, dy) => { view().scrollY = U.clamp(y0 + dy / Math.max(1, tr) * (tot - H), 0, Math.max(0, tot - H)); syncScroll(); T.redraw(); }, () => tv.classList.remove('drag'));
    });
    KC.$('#tl-headers').addEventListener('wheel', e => { e.preventDefault(); view().scrollY += e.deltaY; syncScroll(); T.redraw(); }, { passive: false });
  }

  /* ============================================================ boucle de dessin */
  // Elle s'endort quand rien ne change (ni lecture, ni position, ni redessin demandé) ; le moteur et T.dirty la réveillent.
  let lastTime = -1, lastDrawn = -1, looping = false, dirty = T.dirty;
  const wake = () => { if (!looping) { looping = true; requestAnimationFrame(frame); } };
  Object.defineProperty(T, 'dirty', { enumerable: true, get: () => dirty, set: v => { dirty = v; if (v) wake(); } });
  E.onWake(wake);
  function frame() {
    let again = true;
    try { again = step(); } finally { if (again) requestAnimationFrame(frame); else looping = false; }
  }
  function step() {
    if (!KC.project || !cv) return false;
    if (E.time !== lastTime) {
      lastTime = E.time;
      updateClock(); updatePosition();
      if (E.playing && KC.prefs.followCursor) T.ensureVisible(E.time);
    }
    if (T.dirty) { T.dirty = false; draw(true); lastDrawn = E.time; }
    else if (lastDrawn !== E.time) { draw(false); lastDrawn = E.time; }
    // vu-mètres de piste
    if (E.playing) for (const m of KC.$$('.track-h .meter')) { const v = E.trackLevel(m.dataset.track); m.firstChild.style.width = Math.min(100, Math.sqrt(v) * 100) + '%'; }
    return E.playing || T.dirty || E.time !== lastTime || lastDrawn !== E.time;
  }

  T.init = () => {
    cv = KC.$('#tl-canvas'); cx = cv.getContext('2d');
    rcv = KC.$('#tl-ruler'); rcx = rcv.getContext('2d');
    wrap = KC.$('#tl-canvas-wrap'); headersInner = KC.$('#tl-headers-inner');
    tip = h('div', { style: { position: 'fixed', zIndex: 1500, background: 'var(--panel)', border: '1px solid var(--border-2)', borderRadius: '5px', padding: '3px 8px', fontSize: '12px', pointerEvents: 'none', boxShadow: 'var(--shadow)', fontFamily: 'var(--mono)' }, hidden: true });
    document.body.appendChild(tip);
    T.refreshColors();
    new ResizeObserver(() => { resize(); syncScroll(); }).observe(wrap);
    new ResizeObserver(() => { resize(); }).observe(rcv.parentElement);
    cv.addEventListener('pointerdown', e => { T.dragging = true; onDown(e); });
    window.addEventListener('pointerup', () => { T.dragging = false; });
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerleave', () => { if (T.hover) { T.hover = null; T.redraw(); } });
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('wheel', onWheel, { passive: false });
    rcv.title = 'Bande du haut : sélectionner une boucle · Règle graduée : parcourir la vidéo · Alt+glisser : déplacer la sélection';
    rcv.setAttribute('aria-label', 'Sélection temporelle au-dessus des pistes et règle de lecture');
    rcv.addEventListener('pointerdown', onRulerDown);
    rcv.addEventListener('pointermove', e => {
      const r = rcv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const lp = KC.project.loop, edge = lp.out > lp.in && (Math.abs(px - X(lp.in)) < 7 || Math.abs(px - X(lp.out)) < 7);
      rcv.style.cursor = py < RULER_LOOP ? (edge ? 'ew-resize' : 'crosshair') : 'ew-resize';
    });
    rcv.addEventListener('contextmenu', e => e.preventDefault());
    rcv.addEventListener('wheel', onWheel, { passive: false });
    wrap.addEventListener('dragover', onDragOver);
    wrap.addEventListener('dragleave', onDragLeave);
    wrap.addEventListener('drop', onDrop);
    buildClock(); buildTransport(); buildZoom(); bindScrollbars();
    KC.on('change', () => { buildHeaders(); updateEmpty(); T.redraw(); updateClock(); });
    KC.on('project-loaded', () => { buildHeaders(); updateEmpty(); syncScroll(); T.redraw(); updateClock(); });
    KC.on('selection', () => T.redraw());
    KC.on('loop', () => { updateTransport(); T.redraw(); });
    KC.on('play-state', updateTransport);
    KC.on('prefs', () => { updateTransport(); T.redraw(); });
    KC.on('media-updated', () => T.redraw());
    KC.on('redraw-timeline', () => T.redraw());
    KC.on('theme', () => T.refreshColors());
    KC.on('settings', () => { updateClock(); updateTransport(); T.redraw(); });
    KC.on('rate', updateTransport);
    KC.$('#timeline').addEventListener('contextmenu', e => {
      if (e.defaultPrevented) return;
      KC.context(e, addTrackMenu());
    });
    KC.on('change', updateTransport);
    KC.on('project-loaded', updateTransport);
    KC.on('project-loaded', wake);
    wake();
  };
  function updateEmpty() {
    const el = KC.$('#tl-empty');
    if (KC.project.events.length) { el.innerHTML = ''; return; }
    if (el.firstChild) return;
    el.appendChild(h('div.box', { html: '<b>Glissez des vidéos, des sons ou des images ici</b><br>depuis les Médias du projet, l\'Explorateur ou Windows.<br>Ctrl+I pour importer · Espace pour lire' }));
  }

  /* ============================================================ commandes d'édition */
  const C = KC.cmd;
  const targets = () => { const s = KC.sel.list(); return s; };
  C.split = () => {
    const t = E.time;
    let evs = targets().filter(e => t > e.start + 1e-6 && t < e.start + e.length - 1e-6);
    if (!evs.length) evs = KC.project.events.filter(e => t > e.start + 1e-6 && t < e.start + e.length - 1e-6);
    if (!evs.length) { KC.toast('Placez le curseur sur un événement', 'info'); return; }
    let created = [];
    KC.edit('Diviser', () => {
      const gmap = new Map();
      for (const ev of evs) {
        const b = P.split(ev, P.snapFrame(t));
        if (!b) continue;
        if (ev.group) { if (!gmap.has(ev.group)) gmap.set(ev.group, U.uid()); b.group = gmap.get(ev.group); }
        created.push(b);
      }
    });
    KC.sel.set(created.map(c => c.id));
  };
  C.deleteSel = () => {
    const ids = [...KC.sel.ids];
    if (!ids.length) return;
    KC.edit('Supprimer', () => P.deleteEvents(ids));
    KC.sel.clear();
  };
  C.copy = () => {
    const evs = targets();
    if (!evs.length) return;
    const t0 = Math.min(...evs.map(e => e.start));
    const tracks = KC.project.tracks;
    KC.clipboard = evs.map(e => ({ ev: U.deep(e), dt: e.start - t0, trackIndex: tracks.findIndex(t => t.id === e.track), kind: P.kindOf(e) }));
    KC.toast(evs.length + ' événement(s) copié(s)', 'info', 1200);
  };
  C.cut = () => { C.copy(); C.deleteSel(); };
  C.paste = (track) => {
    const cb = KC.clipboard; if (!cb || !cb.length) return;
    const created = [];
    KC.edit('Coller', () => {
      const p = KC.project, gmap = new Map();
      const minIdx = Math.min(...cb.map(c => c.trackIndex));
      const selTrack = track || (KC.sel.track && P.track(KC.sel.track));
      const shift = selTrack ? p.tracks.indexOf(selTrack) - minIdx : 0;
      for (const c of cb) {
        let tr = p.tracks[c.trackIndex + shift];
        if (!tr || tr.kind !== c.kind) tr = p.tracks[c.trackIndex];
        if (!tr || tr.kind !== c.kind) tr = p.tracks.find(t => t.kind === c.kind) || P.newTrack(c.kind);
        const ev = U.deep(c.ev); ev.id = U.uid(); ev.track = tr.id; ev.start = P.snapFrame(E.time + c.dt);
        if (ev.group) { if (!gmap.has(ev.group)) gmap.set(ev.group, U.uid()); ev.group = gmap.get(ev.group); }
        p.events.push(ev); created.push(ev);
      }
      if (KC.prefs.ripple !== 'off') {
        const len = Math.max(...created.map(e => e.start + e.length)) - E.time;
        P.ripple(E.time, len, [...new Set(created.map(e => e.track))], created.map(e => e.id));
      }
      P.recalcCrossfades([...new Set(created.map(e => e.track))]);
    });
    KC.sel.set(created.map(c => c.id));
  };
  C.selectAll = () => { KC.sel.set(KC.project.events.map(e => e.id)); T.redraw(); };
  C.group = () => {
    const evs = targets(); if (evs.length < 2) { KC.toast('Sélectionnez au moins deux événements', 'info'); return; }
    const g = U.uid(); KC.edit('Grouper', () => evs.forEach(e => { e.group = g; }));
  };
  C.ungroup = () => { const evs = targets(); if (!evs.length) return; KC.edit('Dissocier', () => evs.forEach(e => { e.group = null; })); };
  C.addVideoTrack = () => KC.edit('Insérer une piste vidéo', () => { const t = P.newTrack('video'); KC.sel.track = t.id; });
  C.addAudioTrack = () => KC.edit('Insérer une piste audio', () => { const t = P.newTrack('audio'); KC.sel.track = t.id; });
  C.deleteTrack = () => { const tr = KC.sel.track && P.track(KC.sel.track); if (!tr) { KC.toast('Sélectionnez une piste', 'info'); return; } KC.edit('Supprimer la piste', () => P.removeTrack(tr.id)); };
  C.addMarker = () => KC.edit('Ajouter un marqueur', () => P.addMarker(E.time));
  C.playSelection = () => {
    if (KC.project.loop.out <= KC.project.loop.in) return;
    KC.prefs.loop = true; KC.prefs.save(); KC.emit('prefs');
    E.play(KC.project.loop.in);
  };
  C.toggleLoop = () => { KC.prefs.loop = !KC.prefs.loop; KC.prefs.save(); KC.emit('prefs'); T.redraw(); };
  // Événement qui précède `ev` bout à bout sur la même piste (fin = début de ev, à une image près)
  const adjacentBefore = (ev) => {
    const fr = P.frame();
    return KC.project.events.filter(o => o !== ev && o.track === ev.track && Math.abs(o.start + o.length - ev.start) < fr * 0.6)
      .sort((a, b) => b.start - a.start)[0] || null;
  };
  // Crée ou modifie le chevauchement entre A et B pour une transition de durée d (comme Vegas)
  const setOverlap = (B, d) => {
    const A = P.outgoing(B) || adjacentBefore(B);
    if (!A) { B.fadeIn = U.clamp(P.snapFrame(d), 0, B.length); B.xIn = false; return false; }
    const cur = Math.max(0, A.start + A.length - B.start);
    d = P.snapFrame(U.clamp(d, P.frame(), Math.min(A.length, B.length) - P.frame()));
    const delta = cur - d;                       // > 0 : B recule vers la droite ; < 0 : B avance
    const moving = KC.prefs.ignoreGroups ? [B] : P.groupOf(B);
    const tracks = [...new Set(moving.map(m => m.track))];
    const pivot = B.start + 1e-6;
    // B (et son groupe) se décale, ainsi que tout ce qui le suit sur les mêmes pistes
    for (const e of KC.project.events) {
      if (tracks.includes(e.track) && e.start >= pivot - 1e-6 && e !== A) e.start = Math.max(0, P.snapFrame(e.start + delta));
    }
    P.recalcCrossfades(tracks);
    return true;
  };
  C.setTransition = (type, evs) => {
    let created = 0;
    KC.edit('Transition : ' + FX.TRANSITIONS[type].name, () => {
      for (const ev of evs) {
        ev.transition = type;
        const hasOverlap = !!P.outgoing(ev);
        if (!hasOverlap && adjacentBefore(ev)) { setOverlap(ev, KC.prefs.transitionLength); created++; }
        else if (!(ev.fadeIn > 0)) { ev.fadeIn = Math.min(ev.length / 2, KC.prefs.transitionLength); ev.xIn = false; }
      }
    });
    if (created) KC.toast('Transition créée : les clips se chevauchent de ' + U.fmtNum(KC.prefs.transitionLength, 2) + ' s', 'ok', 2200);
  };
  C.transitionDuration = async (ev) => {
    const cur = ev.xIn ? ev.fadeIn : ev.fadeIn;
    const v = await KC.prompt('Durée de la transition', 'Durée en secondes (ou en temps : 00:00:01;15)', U.fmtNum(cur || KC.prefs.transitionLength, 2));
    if (v == null) return;
    let d = parseFloat(String(v).replace(',', '.'));
    if (String(v).includes(':')) d = U.parseTime(v, P.fps());
    if (!(d > 0)) { KC.toast('Durée invalide', 'err'); return; }
    KC.edit('Durée de la transition', () => setOverlap(ev, d));
  };
  C.setSpeed = (s) => {
    const evs = targets(); if (!evs.length) return;
    KC.edit('Vitesse de lecture', () => {
      for (const ev of evs) {
        const srcLen = ev.length * ev.speed;
        ev.speed = s; ev.length = Math.max(P.frame(), P.snapFrame(srcLen / s));
        if (ev.fadeIn + ev.fadeOut > ev.length) { ev.fadeIn = Math.min(ev.fadeIn, ev.length / 2); ev.fadeOut = Math.min(ev.fadeOut, ev.length / 2); }
      }
      P.recalcCrossfades([...new Set(evs.map(e => e.track))]);
    });
  };
  C.normalize = () => {
    const evs = targets().filter(e => P.kindOf(e) === 'audio' && e.media);
    if (!evs.length) { KC.toast('Sélectionnez des événements audio', 'info'); return; }
    KC.edit('Normaliser', () => {
      for (const ev of evs) {
        if (ev.norm) { ev.norm = 0; continue; }
        const m = P.media(ev.media);
        const pk = M.peakRange(m, ev.offset, ev.offset + ev.length * ev.speed);
        if (!pk) continue;
        ev.norm = Math.round(Math.min(24, -20 * Math.log10(pk) - 0.1) * 10) / 10;
      }
    });
  };
  C.toggleMuteSel = () => { const evs = targets(); if (!evs.length) return; const v = !evs[0].mute; KC.edit('Muet', () => evs.forEach(e => { e.mute = v; })); };
  C.insertGenerator = (type, t = E.time, trackId = null) => {
    const gen = FX.GENERATORS[type].def();
    let ev;
    KC.edit('Insérer : ' + FX.GENERATORS[type].name, () => {
      ev = P.placeGenerator(gen, t, trackId);
      if (gen.type === 'text' && gen.anim && gen.anim !== 'none') FX.applyTextAnim(ev, gen.anim);
    });
    KC.sel.set([ev.id]);
    KC.windows.generator(ev);
  };
  C.trimToSelection = () => {
    const lp = KC.project.loop;
    if (!(lp.out > lp.in)) { KC.toast('Créez d\'abord une sélection temporelle', 'info'); return; }
    const evs = targets().length ? targets() : KC.project.events;
    KC.edit('Découper à la sélection', () => {
      for (const ev of evs.slice()) {
        if (ev.start + ev.length <= lp.in || ev.start >= lp.out) { KC.project.events = KC.project.events.filter(e => e !== ev); continue; }
        if (ev.start < lp.in) { const d = lp.in - ev.start; ev.start = lp.in; ev.length -= d; ev.offset += d * ev.speed; ev.fadeIn = 0; ev.xIn = false; }
        if (ev.start + ev.length > lp.out) { ev.length = lp.out - ev.start; ev.fadeOut = 0; ev.xOut = false; }
      }
    });
  };
  C.edgePrev = () => { const pts = edges().filter(x => x < E.time - 1e-6); if (pts.length) E.seek(pts[pts.length - 1]); };
  C.edgeNext = () => { const pts = edges().filter(x => x > E.time + 1e-6); if (pts.length) E.seek(pts[0]); };
  const edges = () => [...new Set([0, ...KC.project.events.flatMap(e => [e.start, e.start + e.length]), ...KC.project.markers.map(m => m.t)])].sort((a, b) => a - b);
  C.nudge = (frames) => {
    const evs = targets(); if (!evs.length) return;
    const d = frames / P.fps();
    if (evs.some(e => e.start + d < 0)) return;
    KC.edit('Déplacer', () => { evs.forEach(e => { e.start = P.snapFrame(e.start + d); }); P.recalcCrossfades([...new Set(evs.map(e => e.track))]); });
  };
  C.markIn = () => { const lp = KC.project.loop; KC.project.loop = { in: E.time, out: lp.out > E.time ? lp.out : E.time + 5 }; KC.emit('loop'); };
  C.markOut = () => { const lp = KC.project.loop; KC.project.loop = { in: lp.in < E.time ? lp.in : Math.max(0, E.time - 5), out: E.time }; KC.emit('loop'); };
  C.jumpMarker = (n) => { const m = KC.project.markers.find(x => x.num === n); if (m) E.seek(m.t); };
})();

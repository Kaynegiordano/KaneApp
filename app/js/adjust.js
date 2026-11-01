// Réglages d'image : fonctions pixel par pixel (souvent par table LUT) et leurs
// paramètres. Servent à la fois au menu Image > Réglages (destructif) et aux
// calques de réglage (non destructifs).
'use strict';
(() => {
  const U = KS.util;
  const C = v => v < 0 ? 0 : v > 255 ? 255 : v;

  function lut(fn) { const t = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) t[i] = fn(i); return t; }
  function applyLUT(d, lr, lg = lr, lb = lr) {
    const p = d.data;
    for (let i = 0; i < p.length; i += 4) { p[i] = lr[p[i]]; p[i + 1] = lg[p[i + 1]]; p[i + 2] = lb[p[i + 2]]; }
  }
  const S2L = new Float32Array(256); for (let i = 0; i < 256; i++) { const c = i / 255; S2L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const L2S = v => { v = v <= 0 ? 0 : v >= 1 ? 1 : v; return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); };

  // Spline monotone (Fritsch–Carlson) pour les courbes
  function curveLUT(points) {
    const pts = points.slice().sort((a, b) => a[0] - b[0]);
    if (pts.length < 2) return lut(i => i);
    const n = pts.length, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const dx = [], dy = [], m = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = xs[i + 1] - xs[i] || 1e-6; dy[i] = (ys[i + 1] - ys[i]) / dx[i]; }
    m[0] = dy[0]; m[n - 1] = dy[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = dy[i - 1] * dy[i] <= 0 ? 0 : (dy[i - 1] + dy[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (dy[i] === 0) { m[i] = m[i + 1] = 0; continue; }
      const a = m[i] / dy[i], b = m[i + 1] / dy[i], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * dy[i]; m[i + 1] = t * b * dy[i]; }
    }
    return lut(x => {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n - 1]) return ys[n - 1];
      let k = 0; while (k < n - 2 && x > xs[k + 1]) k++;
      const h = dx[k], t = (x - xs[k]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
    });
  }
  function levelsLUT(l) {
    const ib = l.inBlack, iw = Math.max(ib + 1, l.inWhite), g = l.gamma || 1, ob = l.outBlack, ow = l.outWhite;
    return lut(v => { let t = (v - ib) / (iw - ib); t = t < 0 ? 0 : t > 1 ? 1 : t; t = Math.pow(t, 1 / g); return ob + t * (ow - ob); });
  }
  const LV0 = () => ({ inBlack: 0, gamma: 1, inWhite: 255, outBlack: 0, outWhite: 255 });

  function hist(d) {
    const h = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), l: new Uint32Array(256) };
    const p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] < 8) continue;
      h.r[p[i]]++; h.g[p[i + 1]]++; h.b[p[i + 2]]++; h.l[(p[i] * 77 + p[i + 1] * 150 + p[i + 2] * 29) >> 8]++;
    }
    return h;
  }
  function clipRange(hh, clip = 0.001) {
    let total = 0; for (let i = 0; i < 256; i++) total += hh[i];
    const lim = total * clip; let lo = 0, hi = 255, acc = 0;
    for (; lo < 255; lo++) { acc += hh[lo]; if (acc > lim) break; }
    acc = 0; for (; hi > 0; hi--) { acc += hh[hi]; if (acc > lim) break; }
    return hi <= lo ? [0, 255] : [lo, hi];
  }
  const stretch = (lo, hi) => lut(v => (v - lo) * 255 / (hi - lo));

  // Noir et blanc façon Photoshop : min + secondaire × w2 + primaire × w1
  function bwGray(r, g, b, w) {
    let mx, md, mn, pri, sec;
    if (r >= g && r >= b) { mx = r; if (g >= b) { md = g; mn = b; pri = w.reds; sec = w.yellows; } else { md = b; mn = g; pri = w.reds; sec = w.magentas; } }
    else if (g >= r && g >= b) { mx = g; if (r >= b) { md = r; mn = b; pri = w.greens; sec = w.yellows; } else { md = b; mn = r; pri = w.greens; sec = w.cyans; } }
    else { mx = b; if (r >= g) { md = r; mn = g; pri = w.blues; sec = w.magentas; } else { md = g; mn = r; pri = w.blues; sec = w.cyans; } }
    return mn + (md - mn) * sec / 100 + (mx - md) * pri / 100;
  }

  const defs = {
    brightness: {
      name: 'Luminosité/Contraste', icon: 'brightness',
      params: [
        { id: 'brightness', label: 'Luminosité', min: -150, max: 150, def: 0 },
        { id: 'contrast', label: 'Contraste', min: -50, max: 100, def: 0 },
      ],
      apply(d, p) {
        const g = Math.pow(2, -p.brightness / 110);
        const k = p.contrast >= 0 ? 1 + p.contrast / 40 : 1 + p.contrast / 60;
        const t = lut(v => { let x = 255 * Math.pow(v / 255, g); x = (x - 127.5) * k + 127.5; return x; });
        applyLUT(d, t);
      },
    },
    levels: {
      name: 'Niveaux', icon: 'levels', custom: 'levels',
      defaults: () => ({ channel: 'rgb', rgb: LV0(), r: LV0(), g: LV0(), b: LV0() }),
      apply(d, p) {
        const m = levelsLUT(p.rgb);
        const R = levelsLUT(p.r), G = levelsLUT(p.g), B = levelsLUT(p.b);
        applyLUT(d, lut(i => m[R[i]]), lut(i => m[G[i]]), lut(i => m[B[i]]));
      },
    },
    curves: {
      name: 'Courbes', icon: 'curves', custom: 'curves',
      defaults: () => ({ channel: 'rgb', rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] }),
      apply(d, p) {
        const m = curveLUT(p.rgb), R = curveLUT(p.r), G = curveLUT(p.g), B = curveLUT(p.b);
        applyLUT(d, lut(i => m[R[i]]), lut(i => m[G[i]]), lut(i => m[B[i]]));
      },
    },
    exposure: {
      name: 'Exposition', icon: 'exposure',
      params: [
        { id: 'exposure', label: 'Exposition', min: -5, max: 5, step: 0.01, def: 0 },
        { id: 'offset', label: 'Décalage', min: -0.5, max: 0.5, step: 0.001, def: 0 },
        { id: 'gamma', label: 'Correction gamma', min: 0.1, max: 4, step: 0.01, def: 1 },
      ],
      apply(d, p) {
        const k = Math.pow(2, p.exposure);
        const t = lut(v => { let x = S2L[v] * k + p.offset; x = x <= 0 ? 0 : Math.pow(x, 1 / p.gamma); return L2S(x); });
        applyLUT(d, t);
      },
    },
    vibrance: {
      name: 'Vibrance', icon: 'vibrance',
      params: [
        { id: 'vibrance', label: 'Vibrance', min: -100, max: 100, def: 0 },
        { id: 'saturation', label: 'Saturation', min: -100, max: 100, def: 0 },
      ],
      apply(d, p) {
        const px = d.data, vib = p.vibrance / 100, sat = p.saturation / 100;
        for (let i = 0; i < px.length; i += 4) {
          let r = px[i], g = px[i + 1], b = px[i + 2];
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b), s = mx ? (mx - mn) / mx : 0;
          const l = U.luma(r, g, b);
          const k = 1 + sat + vib * (1 - s) * (vib > 0 ? 1.4 : 1);
          px[i] = C(l + (r - l) * k); px[i + 1] = C(l + (g - l) * k); px[i + 2] = C(l + (b - l) * k);
        }
      },
    },
    hueSat: {
      name: 'Teinte/Saturation', icon: 'hue',
      params: [
        { id: 'hue', label: 'Teinte', min: -180, max: 180, def: 0, gradient: 'hue' },
        { id: 'saturation', label: 'Saturation', min: -100, max: 100, def: 0 },
        { id: 'lightness', label: 'Luminosité', min: -100, max: 100, def: 0 },
        { id: 'colorize', label: 'Redéfinir', type: 'check', def: false },
      ],
      // Même calcul que U.rgb2hsl / U.hsl2rgb, écrit sans tableaux intermédiaires (×3 plus rapide)
      apply(d, p) {
        const px = d.data, dh = p.hue / 360, ds = p.saturation / 100, dl = p.lightness / 100;
        const ch = ((p.hue + 180) / 360) % 1, cs = Math.max(0, Math.min(1, 0.25 + ds * 0.75));
        const hue = (q0, q1, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return q0 + (q1 - q0) * 6 * t; if (t < 0.5) return q1; if (t < 2 / 3) return q0 + (q1 - q0) * (2 / 3 - t) * 6; return q0; };
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
          const mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
          let l = (mx + mn) / 2, h = 0, s = 0;
          if (mx !== mn) {
            const dd = mx - mn;
            s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
            h = (mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4) / 6;
          }
          if (p.colorize) { h = ch; s = cs; }
          else { h = (h + dh + 1) % 1; s = ds > 0 ? s + (1 - s) * ds * s * 1.2 + s * ds * 0.3 : s * (1 + ds); s = s < 0 ? 0 : s > 1 ? 1 : s; }
          l = dl > 0 ? l + (1 - l) * dl : l * (1 + dl);
          if (s === 0) { const v = l * 255; px[i] = v; px[i + 1] = v; px[i + 2] = v; continue; }
          const q1 = l < 0.5 ? l * (1 + s) : l + s - l * s, q0 = 2 * l - q1;
          px[i] = hue(q0, q1, h + 1 / 3) * 255; px[i + 1] = hue(q0, q1, h) * 255; px[i + 2] = hue(q0, q1, h - 1 / 3) * 255;
        }
      },
    },
    colorBalance: {
      name: 'Balance des couleurs', icon: 'balance',
      params: [
        { type: 'heading', label: 'Tons moyens' },
        { id: 'mcr', label: 'Cyan ↔ Rouge', min: -100, max: 100, def: 0, gradient: 'linear-gradient(90deg,#00ffff,#ff0000)' },
        { id: 'mmg', label: 'Magenta ↔ Vert', min: -100, max: 100, def: 0, gradient: 'linear-gradient(90deg,#ff00ff,#00ff00)' },
        { id: 'myb', label: 'Jaune ↔ Bleu', min: -100, max: 100, def: 0, gradient: 'linear-gradient(90deg,#ffff00,#0000ff)' },
        { type: 'heading', label: 'Tons foncés' },
        { id: 'scr', label: 'Cyan ↔ Rouge', min: -100, max: 100, def: 0, gradient: 'linear-gradient(90deg,#00ffff,#ff0000)' },
        { id: 'smg', label: 'Magenta ↔ Vert', min: -100, max: 100, def: 0, gradient: 'linear-gradient(90deg,#ff00ff,#00ff00)' },
        { id: 'syb', label: 'Jaune ↔ Bleu', min: -100, max: 100, def: 0, gradient: 'linear-gradient(90deg,#ffff00,#0000ff)' },
        { type: 'heading', label: 'Tons clairs' },
        { id: 'hcr', label: 'Cyan ↔ Rouge', min: -100, max: 100, def: 0, gradient: 'linear-gradient(90deg,#00ffff,#ff0000)' },
        { id: 'hmg', label: 'Magenta ↔ Vert', min: -100, max: 100, def: 0, gradient: 'linear-gradient(90deg,#ff00ff,#00ff00)' },
        { id: 'hyb', label: 'Jaune ↔ Bleu', min: -100, max: 100, def: 0, gradient: 'linear-gradient(90deg,#ffff00,#0000ff)' },
        { id: 'preserve', label: 'Conserver la luminosité', type: 'check', def: true },
      ],
      apply(d, p) {
        const px = d.data;
        const ws = new Float32Array(256), wm = new Float32Array(256), wh = new Float32Array(256);
        for (let v = 0; v < 256; v++) {
          const t = v / 255;
          ws[v] = U.clamp(1 - t * 2.2, 0, 1); wh[v] = U.clamp((t - 0.55) * 2.2, 0, 1); wm[v] = Math.max(0, 1 - Math.abs(t - 0.5) * 2.4);
        }
        const k = 0.6;
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i], g = px[i + 1], b = px[i + 2];
          const l0 = U.luma(r, g, b), li = l0 | 0;
          const dr = (p.scr * ws[li] + p.mcr * wm[li] + p.hcr * wh[li]) * k;
          const dg = (p.smg * ws[li] + p.mmg * wm[li] + p.hmg * wh[li]) * k;
          const db = (p.syb * ws[li] + p.myb * wm[li] + p.hyb * wh[li]) * k;
          let R = r + dr - (dg + db) / 2, G = g + dg - (dr + db) / 2, B = b + db - (dr + dg) / 2;
          if (p.preserve) { const l1 = U.luma(R, G, B), dl = l0 - l1; R += dl; G += dl; B += dl; }
          px[i] = C(R); px[i + 1] = C(G); px[i + 2] = C(B);
        }
      },
    },
    blackWhite: {
      name: 'Noir et blanc', icon: 'bw',
      params: [
        { id: 'reds', label: 'Rouges', min: -200, max: 300, def: 40, gradient: 'linear-gradient(90deg,#000,#ff3b30)' },
        { id: 'yellows', label: 'Jaunes', min: -200, max: 300, def: 60, gradient: 'linear-gradient(90deg,#000,#ffd60a)' },
        { id: 'greens', label: 'Verts', min: -200, max: 300, def: 40, gradient: 'linear-gradient(90deg,#000,#34c759)' },
        { id: 'cyans', label: 'Cyans', min: -200, max: 300, def: 60, gradient: 'linear-gradient(90deg,#000,#32d7f0)' },
        { id: 'blues', label: 'Bleus', min: -200, max: 300, def: 20, gradient: 'linear-gradient(90deg,#000,#0a84ff)' },
        { id: 'magentas', label: 'Magentas', min: -200, max: 300, def: 80, gradient: 'linear-gradient(90deg,#000,#ff2dd4)' },
        { id: 'tint', label: 'Teinte', type: 'check', def: false },
        { id: 'tintColor', label: 'Couleur de teinte', type: 'color', def: '#e1c699' },
      ],
      apply(d, p) {
        const px = d.data, tc = U.parseHex(p.tintColor) || { r: 225, g: 198, b: 153 };
        const tl = U.luma(tc.r, tc.g, tc.b) || 1;
        for (let i = 0; i < px.length; i += 4) {
          const v = C(bwGray(px[i], px[i + 1], px[i + 2], p));
          if (p.tint) {
            const k = v / 255, m = 4 * k * (1 - k);
            px[i] = C(v + (tc.r - tl) * m); px[i + 1] = C(v + (tc.g - tl) * m); px[i + 2] = C(v + (tc.b - tl) * m);
          } else { px[i] = px[i + 1] = px[i + 2] = v; }
        }
      },
    },
    photoFilter: {
      name: 'Filtre photo', icon: 'photo-filter',
      params: [
        { id: 'preset', label: 'Filtre', type: 'select', def: '#ec8a00', options: [['#ec8a00', 'Réchauffement (85)'], ['#fa9600', 'Réchauffement (LBA)'], ['#ebb113', 'Réchauffement (81)'], ['#006dff', 'Refroidissement (80)'], ['#005dff', 'Refroidissement (LBB)'], ['#00b5ff', 'Refroidissement (82)'], ['#ea1a1a', 'Rouge'], ['#f28a00', 'Orange'], ['#f9e31c', 'Jaune'], ['#19c919', 'Vert'], ['#1dcbea', 'Cyan'], ['#1d35ea', 'Bleu'], ['#9b1dea', 'Violet'], ['#e318e3', 'Magenta'], ['#ac7a33', 'Sépia']] },
        { id: 'density', label: 'Densité', min: 0, max: 100, def: 25, unit: '%' },
        { id: 'preserve', label: 'Conserver la luminosité', type: 'check', def: true },
      ],
      apply(d, p) {
        const c = U.parseHex(p.preset) || { r: 236, g: 138, b: 0 }, k = p.density / 100, px = d.data;
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i], g = px[i + 1], b = px[i + 2], l0 = U.luma(r, g, b);
          let R = r + (r * c.r / 255 - r) * k, G = g + (g * c.g / 255 - g) * k, B = b + (b * c.b / 255 - b) * k;
          if (p.preserve) { const l1 = U.luma(R, G, B) || 1; const s = l0 / l1; R *= s; G *= s; B *= s; }
          px[i] = C(R); px[i + 1] = C(G); px[i + 2] = C(B);
        }
      },
    },
    channelMixer: {
      name: 'Mélangeur de couches', icon: 'sliders',
      params: [
        { type: 'heading', label: 'Sortie rouge' },
        { id: 'rr', label: 'Rouge', min: -200, max: 200, def: 100, unit: '%' }, { id: 'rg', label: 'Vert', min: -200, max: 200, def: 0, unit: '%' }, { id: 'rb', label: 'Bleu', min: -200, max: 200, def: 0, unit: '%' },
        { type: 'heading', label: 'Sortie verte' },
        { id: 'gr', label: 'Rouge', min: -200, max: 200, def: 0, unit: '%' }, { id: 'gg', label: 'Vert', min: -200, max: 200, def: 100, unit: '%' }, { id: 'gb', label: 'Bleu', min: -200, max: 200, def: 0, unit: '%' },
        { type: 'heading', label: 'Sortie bleue' },
        { id: 'br', label: 'Rouge', min: -200, max: 200, def: 0, unit: '%' }, { id: 'bg', label: 'Vert', min: -200, max: 200, def: 0, unit: '%' }, { id: 'bb', label: 'Bleu', min: -200, max: 200, def: 100, unit: '%' },
        { id: 'mono', label: 'Monochrome (sortie rouge)', type: 'check', def: false },
      ],
      apply(d, p) {
        const px = d.data, f = 1 / 100;
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i], g = px[i + 1], b = px[i + 2];
          const R = (r * p.rr + g * p.rg + b * p.rb) * f;
          if (p.mono) { px[i] = px[i + 1] = px[i + 2] = C(R); continue; }
          px[i] = C(R); px[i + 1] = C((r * p.gr + g * p.gg + b * p.gb) * f); px[i + 2] = C((r * p.br + g * p.bg + b * p.bb) * f);
        }
      },
    },
    invert: { name: 'Négatif', icon: 'invert', params: [], apply(d) { applyLUT(d, lut(i => 255 - i)); } },
    posterize: {
      name: 'Postérisation', icon: 'posterize',
      params: [{ id: 'levels', label: 'Niveaux', min: 2, max: 64, def: 4 }],
      apply(d, p) { const n = p.levels - 1; applyLUT(d, lut(i => Math.round(Math.round(i / 255 * n) * 255 / n))); },
    },
    threshold: {
      name: 'Seuil', icon: 'threshold',
      params: [{ id: 'level', label: 'Seuil', min: 1, max: 255, def: 128 }],
      apply(d, p) { const px = d.data; for (let i = 0; i < px.length; i += 4) { const v = U.luma(px[i], px[i + 1], px[i + 2]) >= p.level ? 255 : 0; px[i] = px[i + 1] = px[i + 2] = v; } },
    },
    gradientMap: {
      name: 'Courbe de transfert de dégradé', icon: 'gradient-map',
      params: [
        { id: 'c1', label: 'Couleur des ombres', type: 'color', def: '#000000' },
        { id: 'c2', label: 'Couleur des lumières', type: 'color', def: '#ffffff' },
        { id: 'mid', label: 'Couleur médiane (optionnelle)', type: 'check', def: false },
        { id: 'c3', label: 'Médiane', type: 'color', def: '#c0392b' },
        { id: 'reverse', label: 'Inverser', type: 'check', def: false },
      ],
      apply(d, p) {
        let a = U.parseHex(p.c1), b = U.parseHex(p.c2); const m = U.parseHex(p.c3);
        if (p.reverse) [a, b] = [b, a];
        const T = []; for (let i = 0; i < 256; i++) {
          let t = i / 255, x, y;
          if (p.mid) { if (t < 0.5) { x = a; y = m; t *= 2; } else { x = m; y = b; t = (t - 0.5) * 2; } } else { x = a; y = b; }
          T.push([x.r + (y.r - x.r) * t, x.g + (y.g - x.g) * t, x.b + (y.b - x.b) * t]);
        }
        const px = d.data;
        for (let i = 0; i < px.length; i += 4) { const c = T[(px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8]; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; }
      },
    },
    // Correction sélective (Photoshop) : pour chaque gamme de couleurs, on ajoute ou retire
    // de l'encre cyan, magenta, jaune et noire. Relative : en proportion de l'encre déjà
    // présente ; absolue : en valeur fixe. Le poids d'un pixel dans une gamme vient de
    // l'écart entre ses composantes (couleurs) ou de sa luminosité (blancs, neutres, noirs).
    selectiveColor: {
      name: 'Correction sélective', icon: 'palette', custom: 'selective',
      params: [
        { id: 'method', def: 'relative' },
        ...['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks'].map(id => ({ id, def: { c: 0, m: 0, y: 0, k: 0 } })),
      ],
      apply(d, p) {
        const R = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks'].map(id => p[id] || { c: 0, m: 0, y: 0, k: 0 });
        if (R.every(a => !a.c && !a.m && !a.y && !a.k)) return;
        const rel = p.method !== 'absolute', px = d.data, w = new Float32Array(9);
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i], g = px[i + 1], b = px[i + 2];
          const mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b), md = r + g + b - mx - mn;
          w.fill(0);
          // couleurs primaires : la composante dominante ; secondaires : les deux plus fortes
          if (mx !== mn) {
            if (r === mx) w[0] = mx - md; else if (g === mx) w[2] = mx - md; else w[4] = mx - md;
            if (b === mn) w[1] = md - mn; else if (r === mn) w[3] = md - mn; else w[5] = md - mn;
          }
          if (mn > 128) w[6] = (mn - 128) * 2;
          if (mx < 128) w[8] = (128 - mx) * 2;
          w[7] = Math.max(0, 255 - (Math.abs(mx - 128) + Math.abs(mn - 128)));
          for (let ch = 0; ch < 3; ch++) {
            const v = px[i + ch] / 255, ink = 1 - v;
            let delta = 0;
            for (let k = 0; k < 9; k++) {
              if (!w[k]) continue;
              const a = R[k], cmy = (ch === 0 ? a.c : ch === 1 ? a.m : a.y) / 100, kk = a.k / 100;
              let dv = rel ? (cmy * ink + kk * ink) : (cmy + kk);
              delta += dv * w[k] / 255;
            }
            const ni = ink + delta;
            px[i + ch] = (1 - (ni < 0 ? 0 : ni > 1 ? 1 : ni)) * 255;
          }
        }
      },
    },
    sepia: {
      name: 'Sépia', icon: 'photo-filter',
      params: [{ id: 'amount', label: 'Intensité', min: 0, max: 100, def: 80, unit: '%' }],
      apply(d, p) {
        const px = d.data, k = p.amount / 100;
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i], g = px[i + 1], b = px[i + 2];
          px[i] = C(r + ((r * .393 + g * .769 + b * .189) - r) * k);
          px[i + 1] = C(g + ((r * .349 + g * .686 + b * .168) - g) * k);
          px[i + 2] = C(b + ((r * .272 + g * .534 + b * .131) - b) * k);
        }
      },
    },
    cameraRaw: {
      name: 'Filtre Camera Raw', icon: 'camera', noLayer: true,
      params: [
        { type: 'heading', label: 'Balance des blancs' },
        { id: 'temp', label: 'Température', min: -100, max: 100, def: 0, gradient: 'linear-gradient(90deg,#3d7cf0,#e8e8e8,#f0b23d)' },
        { id: 'tint', label: 'Teinte', min: -100, max: 100, def: 0, gradient: 'linear-gradient(90deg,#3dc46a,#e8e8e8,#d23dd0)' },
        { type: 'heading', label: 'Lumière' },
        { id: 'exposure', label: 'Exposition', min: -4, max: 4, step: 0.05, def: 0 },
        { id: 'contrast', label: 'Contraste', min: -100, max: 100, def: 0 },
        { id: 'highlights', label: 'Tons clairs', min: -100, max: 100, def: 0 },
        { id: 'shadows', label: 'Tons foncés', min: -100, max: 100, def: 0 },
        { id: 'whites', label: 'Blancs', min: -100, max: 100, def: 0 },
        { id: 'blacks', label: 'Noirs', min: -100, max: 100, def: 0 },
        { type: 'heading', label: 'Présence' },
        { id: 'texture', label: 'Texture', min: -100, max: 100, def: 0 },
        { id: 'clarity', label: 'Clarté', min: -100, max: 100, def: 0 },
        { id: 'dehaze', label: 'Correction du voile', min: -100, max: 100, def: 0 },
        { id: 'vibrance', label: 'Vibrance', min: -100, max: 100, def: 0 },
        { id: 'saturation', label: 'Saturation', min: -100, max: 100, def: 0 },
        { type: 'heading', label: 'Effets' },
        { id: 'vignette', label: 'Vignettage', min: -100, max: 100, def: 0 },
        { id: 'grain', label: 'Grain', min: 0, max: 100, def: 0 },
      ],
      apply(d, p) {
        const W = d.width, H = d.height, px = d.data;
        // versions floues pour les réglages locaux (clarté, tons clairs/foncés)
        let blurL = null, blurT = null;
        const needBig = p.clarity || p.highlights || p.shadows || p.dehaze;
        if (needBig || p.texture) {
          const src = U.canvas(W, H); src.getContext('2d').putImageData(d, 0, 0);
          if (needBig) blurL = U.getData(U.blurCanvas(src, Math.max(4, Math.min(W, H) / 60))).data;
          if (p.texture) blurT = U.getData(U.blurCanvas(src, 2.5)).data;
        }
        const ek = Math.pow(2, p.exposure);
        const tr = p.temp / 100 * 40, tb = -p.temp / 100 * 40, tg = -p.tint / 100 * 30, tm = p.tint / 100 * 15;
        const ct = 1 + p.contrast / 100 * 0.6;
        const vib = p.vibrance / 100, sat = p.saturation / 100;
        const cx = W / 2, cy = H / 2, maxd = Math.hypot(cx, cy);
        const vg = p.vignette / 100;
        for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i += 4) {
          let r = px[i], g = px[i + 1], b = px[i + 2];
          r += tr + tm; g += tg; b += tb + tm;
          if (ek !== 1) { r = L2S(S2L[C(r) | 0] * ek); g = L2S(S2L[C(g) | 0] * ek); b = L2S(S2L[C(b) | 0] * ek); }
          let l = U.luma(r, g, b) / 255;
          let dl = 0;
          if (blurL) {
            const bl = U.luma(blurL[i], blurL[i + 1], blurL[i + 2]) / 255;
            if (p.shadows) dl += p.shadows / 100 * 0.5 * Math.pow(1 - bl, 2.2) * (1 - l);
            if (p.highlights) dl += p.highlights / 100 * 0.5 * Math.pow(bl, 2.2) * l;
            if (p.clarity) dl += (l - bl) * p.clarity / 100 * 1.2 * (1 - Math.abs(l - 0.5) * 1.2);
            if (p.dehaze) dl += (l - bl) * p.dehaze / 100 * 0.6 - p.dehaze / 100 * 0.08 * (1 - l);
          }
          if (blurT) { const tl = U.luma(blurT[i], blurT[i + 1], blurT[i + 2]) / 255; dl += (l - tl) * p.texture / 100 * 1.5; }
          if (p.whites) dl += p.whites / 100 * 0.25 * Math.pow(l, 3);
          if (p.blacks) dl += p.blacks / 100 * 0.25 * Math.pow(1 - l, 3);
          if (vg) {
            const dd = Math.hypot(x - cx, y - cy) / maxd, f = Math.pow(dd, 2.2);
            dl += vg * f * (vg < 0 ? l * 0.9 : (1 - l) * 0.9);
          }
          const add = dl * 255;
          r += add; g += add; b += add;
          if (ct !== 1) { r = (r - 128) * ct + 128; g = (g - 128) * ct + 128; b = (b - 128) * ct + 128; }
          if (vib || sat || p.dehaze) {
            const L = U.luma(r, g, b), mx = Math.max(r, g, b), mn = Math.min(r, g, b), s = mx > 0 ? (mx - mn) / mx : 0;
            const k = 1 + sat + vib * (1 - s) * 1.3 + p.dehaze / 100 * 0.25;
            r = L + (r - L) * k; g = L + (g - L) * k; b = L + (b - L) * k;
          }
          if (p.grain) { const n = (Math.random() - 0.5) * p.grain * 0.9; r += n; g += n; b += n; }
          px[i] = C(r); px[i + 1] = C(g); px[i + 2] = C(b);
        }
      },
    },
  };

  // Valeurs par défaut d'un réglage
  function defaults(type) {
    const def = defs[type];
    if (def.defaults) return def.defaults();
    const o = {};
    for (const p of def.params) if (p.id) o[p.id] = p.def;
    return o;
  }

  KS.Adjust = {
    defs, defaults, curveLUT, levelsLUT, hist, LV0,
    apply(type, d, params, doc) { const def = defs[type]; if (def) def.apply(d, params, doc); },
    // Le résultat d'un pixel dépend-il de ses voisins ou de sa position ? (alors pas de recomposition partielle)
    isSpatial(type, p) { return type === 'cameraRaw' && !!p && !!(p.texture || p.clarity || p.highlights || p.shadows || p.dehaze || p.vignette || p.grain); },
    // Commandes automatiques
    autoTone(d) { const h = hist(d); const [r0, r1] = clipRange(h.r), [g0, g1] = clipRange(h.g), [b0, b1] = clipRange(h.b); applyLUT(d, stretch(r0, r1), stretch(g0, g1), stretch(b0, b1)); },
    autoContrast(d) { const h = hist(d); const [a, b] = clipRange(h.l, 0.005); applyLUT(d, stretch(a, b)); },
    autoColor(d) {
      // neutralise la dominante (moyenne des tons moyens vers le gris) puis étire
      const px = d.data; let R = 0, G = 0, B = 0, n = 0;
      for (let i = 0; i < px.length; i += 16) { const l = U.luma(px[i], px[i + 1], px[i + 2]); if (l > 40 && l < 215 && px[i + 3] > 8) { R += px[i]; G += px[i + 1]; B += px[i + 2]; n++; } }
      if (n) { const m = (R + G + B) / 3 / n; const kr = m / (R / n), kg = m / (G / n), kb = m / (B / n); applyLUT(d, lut(i => i * kr), lut(i => i * kg), lut(i => i * kb)); }
      KS.Adjust.autoContrast(d);
    },
    // Amélioration rapide : 20 % de chacune des corrections automatiques (ton, contraste, couleur), calculées sur l'image
    // d'origine puis additionnées, et une touche de présence (vibrance, clarté, texture). Un seul passage, jamais excessif.
    quickEnhance(d, k = 0.2) {
      const src = new Uint8ClampedArray(d.data), acc = new Float32Array(src.length);
      for (const fn of ['autoTone', 'autoContrast', 'autoColor']) {
        const tmp = new ImageData(new Uint8ClampedArray(src), d.width, d.height); KS.Adjust[fn](tmp);
        const t = tmp.data; for (let i = 0; i < t.length; i++) acc[i] += (t[i] - src[i]) * k;
      }
      const px = d.data;
      for (let i = 0; i < px.length; i += 4) { px[i] = C(src[i] + acc[i]); px[i + 1] = C(src[i + 1] + acc[i + 1]); px[i + 2] = C(src[i + 2] + acc[i + 2]); }
      defs.cameraRaw.apply(d, { ...KS.Adjust.defaults('cameraRaw'), vibrance: 12, clarity: 10, texture: 8 });
    },
    equalize(d) {
      const h = hist(d).l; let total = 0; for (let i = 0; i < 256; i++) total += h[i];
      const cdf = new Float32Array(256); let acc = 0; for (let i = 0; i < 256; i++) { acc += h[i]; cdf[i] = acc / total; }
      const px = d.data;
      for (let i = 0; i < px.length; i += 4) {
        const l = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8, k = l ? cdf[l] * 255 / l : 1;
        px[i] = C(px[i] * k); px[i + 1] = C(px[i + 1] * k); px[i + 2] = C(px[i + 2] * k);
      }
    },
    desaturate(d) { const px = d.data; for (let i = 0; i < px.length; i += 4) { const v = U.luma(px[i], px[i + 1], px[i + 2]); px[i] = px[i + 1] = px[i + 2] = v; } },
  };
})();

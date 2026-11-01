// Entrées / sorties : ouvrir, enregistrer (KSP natif, PSD, PNG, JPEG, WebP), importer.
'use strict';
(() => {
  const U = KS.util;
  const io = KS.io = {};
  const IMG_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'ico', 'avif', 'jfif'];
  const ext = n => (n.split('.').pop() || '').toLowerCase();
  const baseName = n => n.replace(/\.[^.]+$/, '');
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif' };
  io.OPEN_FILTERS = [
    { name: 'Tous les fichiers pris en charge', extensions: ['ksp', 'psd', ...IMG_EXT] },
    { name: 'Document KaneApp', extensions: ['ksp'] }, { name: 'Photoshop', extensions: ['psd'] },
    { name: 'Images', extensions: IMG_EXT }, { name: 'Tous les fichiers', extensions: ['*'] },
  ];

  /* ---------------------------------------------------------------- ouvrir */
  io.open = async () => {
    if (KS.native) {
      const files = await KS.native.openDialog({ filters: io.OPEN_FILTERS });
      for (const f of files) await io.openEntry(f);
      return;
    }
    const inp = KS.$('#file-input');
    inp.accept = '.ksp,.psd,image/*';
    inp.onchange = async () => { for (const f of inp.files) await io.openFile(f); inp.value = ''; };
    inp.click();
  };
  io.openPath = async p => {
    const f = await KS.native.readFile(p);
    if (f.error) { KS.toast('Impossible d\'ouvrir : ' + f.error, 'err', 4000); io.forgetRecent(p); return; }
    await io.openEntry(f);
  };
  io.openFile = async file => {
    const data = new Uint8Array(await file.arrayBuffer());
    const p = KS.native && KS.native.pathForFile ? KS.native.pathForFile(file) : null;
    await io.openEntry({ name: file.name, data, path: p || null });
  };
  // { name, data: Uint8Array, path }
  io.openEntry = async f => {
    const existing = f.path && KS.state.docs.find(d => d.path === f.path);
    if (existing) { KS.switchDoc(existing); return existing; }
    try {
      const doc = await KS.busy(() => io.decode(f));
      if (!doc) return null;
      doc.path = f.path || null;
      doc.dirty = false;
      KS.addDoc(doc);
      if (f.path) io.addRecent(doc);
      return doc;
    } catch (e) {
      console.error(e);
      KS.toast(`Impossible d'ouvrir « ${f.name} » : ${e.message || e}`, 'err', 5000);
      return null;
    }
  };
  io.decode = async f => {
    const e = ext(f.name);
    if (e === 'ksp') return io.readKSP(f);
    if (e === 'psd' || e === 'psb') return io.readPSD(f);
    const c = await U.canvasFromBlob(new Blob([f.data], { type: MIME[e] || 'application/octet-stream' }));
    const doc = new KS.Doc({ name: f.name, width: c.width, height: c.height });
    doc.addLayer(new KS.Layer({ name: 'Arrière-plan', canvas: c }), 0);
    doc.format = ['png', 'jpg', 'jpeg', 'webp'].includes(e) ? (e === 'jpg' ? 'jpeg' : e) : null;
    doc.history.items[0].name = 'Ouvrir';
    return doc;
  };
  io.canvasFromEntry = async f => {
    const e = ext(f.name);
    if (e === 'psd' || e === 'ksp') { const d = await io.decode(f); return d.flatten(); }
    return U.canvasFromBlob(new Blob([f.data], { type: MIME[e] || 'application/octet-stream' }));
  };

  /* ---------------------------------------------------------------- format natif KSP */
  const toDataURL = c => c.toDataURL('image/png');
  // Les PNG des calques sont encodés en parallèle hors du fil de l'interface (KS.codec) : une copie de
  // secours ne fige plus la fenêtre. Le JSON garde des marqueurs à leur place, remplacés octet pour octet.
  function kspJSON(doc, png) {
    const idx = new Map(doc.layers.map((L, i) => [L.id, i]));
    const layers = doc.layers.map(L => ({
      name: L.name, kind: L.kind, x: L.x, y: L.y, opacity: L.opacity, blend: L.blend, visible: L.visible, lockAll: L.lockAll, lockAlpha: L.lockAlpha, clip: L.clip,
      text: L.text, adjust: L.adjust, effects: L.effects, shape: L.shape, fill: L.fill, collapsed: L.collapsed,
      parent: L.parent && idx.has(L.parent) ? idx.get(L.parent) : -1,
      png: L.kind === 'adjust' || L.kind === 'group' ? null : png(L.canvas, L.id),
      mask: L.mask ? { x: L.mask.x, y: L.mask.y, enabled: L.mask.enabled, linked: L.mask.linked, outside: L.mask.outside, png: png(L.mask.canvas, L.id + ':masque') } : null,
    }));
    const thumb = io.thumbnail(doc, 160);
    return JSON.stringify({
      app: 'Kanevas', version: 2, width: doc.width, height: doc.height, guides: doc.guides, active: doc.activeIndex, thumb, layers,
      paths: doc.paths, alphas: doc.alphas.map(a => ({ name: a.name, png: png(a.canvas, a.id) })),
    });
  }
  io.writeKSP = async doc => {
    if (KS.codec?.available()) {
      const images = [], mark = 'KSPNG-' + U.uid() + '-';
      const json = kspJSON(doc, (canvas, key) => { images.push({ canvas, key }); return mark + (images.length - 1); });
      try {
        const pngs = await KS.codec.pngs(images), enc = new TextEncoder(), parts = [];
        const re = new RegExp('"' + mark + '(\\d+)"', 'g');
        let at = 0, m;
        while ((m = re.exec(json))) { parts.push(enc.encode(json.slice(at, m.index + 1)), pngs[+m[1]], enc.encode('"')); at = m.index + m[0].length; }
        parts.push(enc.encode(json.slice(at)));
        const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
        let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
        return out;
      } catch (err) { console.warn('Encodage PNG en parallèle indisponible :', err); }
    }
    return new TextEncoder().encode(kspJSON(doc, toDataURL));
  };
  io.readKSP = async f => {
    const j = JSON.parse(new TextDecoder().decode(f.data));
    if (!['Kanevas', 'KaneShop'].includes(j.app)) throw new Error('Fichier KSP invalide');
    const doc = new KS.Doc({ name: f.name, width: j.width, height: j.height });
    const load = async src => { const img = await U.loadImage(src); const c = U.canvas(img.width, img.height); c.getContext('2d').drawImage(img, 0, 0); return c; };
    for (const l of j.layers) {
      const L = new KS.Layer({ name: l.name, kind: l.kind, canvas: l.png ? await load(l.png) : undefined, x: l.x, y: l.y, opacity: l.opacity, blend: l.blend, visible: l.visible, lockAll: l.lockAll, lockAlpha: l.lockAlpha, clip: l.clip, adjust: l.adjust, effects: l.effects, collapsed: l.collapsed, parent: null });
      if (l.text) { L.text = l.text; }
      if (l.shape) { L.shape = l.shape; }
      if (l.fill) { L.fill = l.fill; }
      if (l.mask) { const c = await load(l.mask.png); L.mask = { canvas: c, ctx: c.getContext('2d'), x: l.mask.x, y: l.mask.y, enabled: l.mask.enabled, linked: l.mask.linked, outside: l.mask.outside ?? 255, alpha: null }; L.maskChanged(); }
      doc.layers.push(L);
    }
    j.layers.forEach((l, i) => { if (l.parent != null && l.parent >= 0 && doc.layers[l.parent]) doc.layers[i].parent = doc.layers[l.parent].id; });
    doc.activeId = (doc.layers[j.active] || doc.layers[doc.layers.length - 1])?.id;
    doc.guides = j.guides || { h: [], v: [] };
    doc.paths = (j.paths || []).map(p => ({ ...p, id: U.uid() }));
    for (const a of j.alphas || []) doc.alphas.push({ id: U.uid(), name: a.name, canvas: await load(a.png) });
    doc.format = 'ksp';
    doc.history.items[0].name = 'Ouvrir';
    return doc;
  };

  /* ---------------------------------------------------------------- PSD */
  const PSD_BLEND = { pass: 'pass through', normal: 'normal', darken: 'darken', multiply: 'multiply', 'color-burn': 'color burn', lighten: 'lighten', screen: 'screen', 'color-dodge': 'color dodge', lighter: 'linear dodge', overlay: 'overlay', 'soft-light': 'soft light', 'hard-light': 'hard light', difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity' };
  const FROM_PSD = Object.fromEntries(Object.entries(PSD_BLEND).map(([a, b]) => [b, a]));
  const rgbOf = hex => { const c = U.parseHex(hex) || { r: 0, g: 0, b: 0 }; return { r: c.r, g: c.g, b: c.b }; };
  const hexOf = c => c && c.r != null ? U.hex({ r: c.r, g: c.g, b: c.b }) : '#000000';
  // ag-psd (830 Ko) n'est chargé qu'au premier PSD ouvert ou enregistré : démarrage plus léger
  let psdLib = null;
  io.loadPSD = () => psdLib || (psdLib = window.agPsd ? Promise.resolve() : new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'vendor/ag-psd.js';
    s.onload = () => res(); s.onerror = () => { psdLib = null; rej(new Error('Module PSD indisponible')); };
    document.head.appendChild(s);
  }));
  io.readPSD = async f => {
    await io.loadPSD();
    const psd = agPsd.readPsd(f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength), { skipThumbnail: true, useImageData: false });
    const doc = new KS.Doc({ name: f.name, width: psd.width, height: psd.height });
    let skipped = 0;
    const common = (L, l) => {
      L.opacity = l.opacity ?? 1;
      L.blend = FROM_PSD[l.blendMode] || 'normal';
      L.visible = !l.hidden;
      L.clip = !!l.clipping;
      if (l.mask && l.mask.canvas) {
        const c = l.mask.canvas;
        L.mask = { canvas: c, ctx: c.getContext('2d'), x: l.mask.left || 0, y: l.mask.top || 0, enabled: !l.mask.disabled, linked: true, outside: l.mask.defaultColor ?? 255, alpha: null };
        L.maskChanged();
      }
      if (l.effects) L.effects = io.psdEffectsIn(l.effects);
    };
    // les enfants d'ag-psd vont du bas vers le haut ; un groupe vient après ses enfants
    const walk = (list, parent) => {
      for (const l of list || []) {
        if (l.children) {
          const G = new KS.Layer({ name: l.name || 'Groupe', kind: 'group', parent, collapsed: !l.opened });
          walk(l.children, G.id);
          common(G, l);
          if (G.blend === 'normal' && l.blendMode === undefined) G.blend = 'pass';
          doc.layers.push(G);
          continue;
        }
        let L;
        if (l.adjustment) {
          const a = io.psdAdjustment(l.adjustment);
          if (!a) { skipped++; continue; }
          L = new KS.Layer({ name: l.name || 'Réglage', kind: 'adjust', adjust: a, parent });
        } else {
          if (!l.canvas) continue;
          L = new KS.Layer({ name: l.name || 'Calque', canvas: l.canvas, x: l.left || 0, y: l.top || 0, parent });
        }
        common(L, l);
        doc.layers.push(L);
      }
    };
    walk(psd.children, null);
    if (!doc.layers.length && psd.canvas) doc.layers.push(new KS.Layer({ name: 'Arrière-plan', canvas: psd.canvas, parent: null }));
    doc.activeId = doc.layers[doc.layers.length - 1]?.id;
    doc.format = 'psd';
    doc.history.items[0].name = 'Ouvrir';
    if (skipped) setTimeout(() => KS.toast(`${skipped} calque(s) de réglage non pris en charge ont été ignorés`, 'info', 4000), 300);
    return doc;
  };
  const HUE0 = { a: 0, b: 0, c: 0, d: 0, hue: 0, saturation: 0, lightness: 0 };
  io.psdAdjustment = a => {
    const D = KS.Adjust.defaults;
    switch (a.type) {
      case 'brightness/contrast': return { type: 'brightness', params: { brightness: a.brightness || 0, contrast: a.contrast || 0 } };
      case 'hue/saturation': return { type: 'hueSat', params: { hue: a.master?.hue || 0, saturation: a.master?.saturation || 0, lightness: a.master?.lightness || 0, colorize: false } };
      case 'invert': return { type: 'invert', params: {} };
      case 'posterize': return { type: 'posterize', params: { levels: a.levels || 4 } };
      case 'threshold': return { type: 'threshold', params: { level: a.level || 128 } };
      case 'vibrance': return { type: 'vibrance', params: { vibrance: a.vibrance || 0, saturation: a.saturation || 0 } };
      case 'exposure': return { type: 'exposure', params: { exposure: a.exposure || 0, offset: a.offset || 0, gamma: a.gamma || 1 } };
      case 'levels': {
        const p = D('levels');
        const cv = m => ({ inBlack: m.shadowInput ?? 0, inWhite: m.highlightInput ?? 255, gamma: m.midtoneInput ?? 1, outBlack: m.shadowOutput ?? 0, outWhite: m.highlightOutput ?? 255 });
        if (a.rgb) p.rgb = cv(a.rgb); if (a.red) p.r = cv(a.red); if (a.green) p.g = cv(a.green); if (a.blue) p.b = cv(a.blue);
        return { type: 'levels', params: p };
      }
      case 'curves': {
        const p = D('curves');
        const conv = c => c && c.length ? c.map(q => [q.input, q.output]) : [[0, 0], [255, 255]];
        if (a.rgb) p.rgb = conv(a.rgb); if (a.red) p.r = conv(a.red); if (a.green) p.g = conv(a.green); if (a.blue) p.b = conv(a.blue);
        return { type: 'curves', params: p };
      }
      case 'color balance': {
        const z = { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 }, s = a.shadows || z, m = a.midtones || z, hh = a.highlights || z;
        return { type: 'colorBalance', params: { scr: s.cyanRed, smg: s.magentaGreen, syb: s.yellowBlue, mcr: m.cyanRed, mmg: m.magentaGreen, myb: m.yellowBlue, hcr: hh.cyanRed, hmg: hh.magentaGreen, hyb: hh.yellowBlue, preserve: a.preserveLuminosity !== false } };
      }
      case 'black & white': return { type: 'blackWhite', params: { reds: a.reds ?? 40, yellows: a.yellows ?? 60, greens: a.greens ?? 40, cyans: a.cyans ?? 60, blues: a.blues ?? 20, magentas: a.magentas ?? 80, tint: !!a.useTint, tintColor: hexOf(a.tintColor) } };
      case 'photo filter': return { type: 'photoFilter', params: { preset: hexOf(a.color), density: a.density ?? 25, preserve: a.preserveLuminosity !== false } };
      case 'channel mixer': {
        const c = (o, d) => o ? [o.red, o.green, o.blue] : d;
        const [rr, rg, rb] = c(a.red, [100, 0, 0]), [gr, gg, gb] = c(a.green, [0, 100, 0]), [br, bg, bb] = c(a.blue, [0, 0, 100]);
        return { type: 'channelMixer', params: { rr, rg, rb, gr, gg, gb, br, bg, bb, mono: !!a.monochrome } };
      }
      case 'gradient map': {
        const st = (a.colorStops || []).slice().sort((x, y) => x.location - y.location);
        const p = D('gradientMap');
        if (st.length) { p.c1 = hexOf(st[0].color); p.c2 = hexOf(st[st.length - 1].color); if (st.length > 2) { p.mid = true; p.c3 = hexOf(st[Math.floor(st.length / 2)].color); } }
        p.reverse = !!a.reverse;
        return { type: 'gradientMap', params: p };
      }
    }
    return null;
  };
  // Nos réglages → calques de réglage Photoshop
  io.psdAdjustmentOut = (type, p) => {
    const lv = l => ({ shadowInput: Math.round(l.inBlack), highlightInput: Math.round(l.inWhite), midtoneInput: l.gamma, shadowOutput: Math.round(l.outBlack), highlightOutput: Math.round(l.outWhite) });
    const cu = c => c.map(([i, o]) => ({ input: Math.round(i), output: Math.round(o) }));
    switch (type) {
      case 'brightness': return { type: 'brightness/contrast', brightness: Math.round(p.brightness), contrast: Math.round(p.contrast), useLegacy: false };
      case 'levels': return { type: 'levels', rgb: lv(p.rgb), red: lv(p.r), green: lv(p.g), blue: lv(p.b) };
      case 'curves': return { type: 'curves', rgb: cu(p.rgb), red: cu(p.r), green: cu(p.g), blue: cu(p.b) };
      case 'exposure': return { type: 'exposure', exposure: p.exposure, offset: p.offset, gamma: p.gamma };
      case 'vibrance': return { type: 'vibrance', vibrance: Math.round(p.vibrance), saturation: Math.round(p.saturation) };
      case 'hueSat': return { type: 'hue/saturation', master: { ...HUE0, hue: Math.round(p.hue), saturation: Math.round(p.saturation), lightness: Math.round(p.lightness) }, reds: { ...HUE0, a: 315, b: 345, c: 15, d: 45 }, yellows: { ...HUE0, a: 15, b: 45, c: 75, d: 105 }, greens: { ...HUE0, a: 75, b: 105, c: 135, d: 165 }, cyans: { ...HUE0, a: 135, b: 165, c: 195, d: 225 }, blues: { ...HUE0, a: 195, b: 225, c: 255, d: 285 }, magentas: { ...HUE0, a: 255, b: 285, c: 315, d: 345 } };
      case 'colorBalance': return { type: 'color balance', shadows: { cyanRed: p.scr, magentaGreen: p.smg, yellowBlue: p.syb }, midtones: { cyanRed: p.mcr, magentaGreen: p.mmg, yellowBlue: p.myb }, highlights: { cyanRed: p.hcr, magentaGreen: p.hmg, yellowBlue: p.hyb }, preserveLuminosity: !!p.preserve };
      case 'blackWhite': return { type: 'black & white', reds: p.reds, yellows: p.yellows, greens: p.greens, cyans: p.cyans, blues: p.blues, magentas: p.magentas, useTint: !!p.tint, tintColor: rgbOf(p.tintColor) };
      case 'photoFilter': return { type: 'photo filter', color: rgbOf(p.preset), density: p.density, preserveLuminosity: !!p.preserve };
      case 'channelMixer': return { type: 'channel mixer', monochrome: !!p.mono, red: { red: p.rr, green: p.rg, blue: p.rb, constant: 0 }, green: { red: p.gr, green: p.gg, blue: p.gb, constant: 0 }, blue: { red: p.br, green: p.bg, blue: p.bb, constant: 0 }, gray: { red: p.rr, green: p.rg, blue: p.rb, constant: 0 } };
      case 'invert': return { type: 'invert' };
      case 'posterize': return { type: 'posterize', levels: p.levels };
      case 'threshold': return { type: 'threshold', level: p.level };
      case 'gradientMap': {
        let stops = [[0, p.c1], ...(p.mid ? [[0.5, p.c3]] : []), [1, p.c2]];
        return { type: 'gradient map', gradientType: 'solid', reverse: !!p.reverse, smoothness: 4096, colorStops: stops.map(([l, c]) => ({ color: rgbOf(c), location: l, midpoint: 0.5 })), opacityStops: [{ opacity: 1, location: 0, midpoint: 0.5 }, { opacity: 1, location: 1, midpoint: 0.5 }] };
      }
    }
    return null;
  };
  io.psdEffectsIn = e => {
    const fx = KS.defaultEffects();
    const px = v => (v && typeof v === 'object' ? v.value : v) || 0;
    const ds = Array.isArray(e.dropShadow) ? e.dropShadow[0] : e.dropShadow;
    if (ds) Object.assign(fx.shadow, { on: ds.enabled !== false, color: hexOf(ds.color), opacity: ds.opacity ?? 0.75, angle: ds.angle ?? 120, distance: px(ds.distance), size: px(ds.size) });
    if (e.outerGlow) Object.assign(fx.glow, { on: e.outerGlow.enabled !== false, color: hexOf(e.outerGlow.color), opacity: e.outerGlow.opacity ?? 0.75, size: px(e.outerGlow.size) });
    if (e.innerGlow) Object.assign(fx.innerGlow, { on: e.innerGlow.enabled !== false, color: hexOf(e.innerGlow.color), opacity: e.innerGlow.opacity ?? 0.75, size: px(e.innerGlow.size) });
    const st = Array.isArray(e.stroke) ? e.stroke[0] : e.stroke;
    if (st) Object.assign(fx.stroke, { on: st.enabled !== false, color: hexOf(st.color), opacity: st.opacity ?? 1, size: px(st.size), position: st.position === 'inside' ? 'inside' : st.position === 'center' ? 'center' : 'outside' });
    const sf = Array.isArray(e.solidFill) ? e.solidFill[0] : e.solidFill;
    if (sf) Object.assign(fx.overlay, { on: sf.enabled !== false, color: hexOf(sf.color), opacity: sf.opacity ?? 1, blend: FROM_PSD[sf.blendMode] || 'normal' });
    return Object.values(fx).some(x => x.on) ? fx : null;
  };
  const psdEffectsOut = fx => {
    if (!fx) return undefined;
    const e = {};
    const px = v => ({ units: 'Pixels', value: v });
    if (fx.shadow?.on) e.dropShadow = [{ enabled: true, color: rgbOf(fx.shadow.color), opacity: fx.shadow.opacity, angle: fx.shadow.angle, distance: px(fx.shadow.distance), size: px(fx.shadow.size), blendMode: 'multiply', useGlobalLight: false }];
    if (fx.glow?.on) e.outerGlow = { enabled: true, color: rgbOf(fx.glow.color), opacity: fx.glow.opacity, size: px(fx.glow.size), blendMode: 'screen' };
    if (fx.innerGlow?.on) e.innerGlow = { enabled: true, color: rgbOf(fx.innerGlow.color), opacity: fx.innerGlow.opacity, size: px(fx.innerGlow.size), blendMode: 'screen' };
    if (fx.stroke?.on) e.stroke = [{ enabled: true, color: rgbOf(fx.stroke.color), opacity: fx.stroke.opacity ?? 1, size: px(fx.stroke.size), position: fx.stroke.position, fillType: 'color', blendMode: 'normal' }];
    if (fx.overlay?.on) e.solidFill = [{ enabled: true, color: rgbOf(fx.overlay.color), opacity: fx.overlay.opacity, blendMode: PSD_BLEND[fx.overlay.blend] || 'normal' }];
    return Object.keys(e).length ? e : undefined;
  };
  // Tracé vectoriel → BezierPath ag-psd (points : poignée entrante, ancre, poignée sortante)
  const psdPaths = subpaths => subpaths.map(sp => ({ open: !sp.closed, fillRule: 'non-zero', operation: 'combine', knots: sp.pts.map(p => ({ linked: true, points: [p.ix, p.iy, p.x, p.y, p.ox, p.oy] })) }));
  io.writePSD = async doc => {
    await io.loadPSD();
    let dropped = 0;
    const kids = new Map();
    for (const L of doc.layers) { const k = L.parent || null; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(L); }
    const one = (L, opts) => {
      const o = { name: L.name, opacity: L.opacity, blendMode: PSD_BLEND[L.blend] || 'normal', hidden: !L.visible, clipping: L.clip, transparencyProtected: L.lockAlpha };
      if (L.mask) o.mask = { left: L.mask.x, top: L.mask.y, canvas: L.mask.canvas, defaultColor: L.mask.outside ?? 255, disabled: !L.mask.enabled };
      if (opts.fx) { const e = psdEffectsOut(L.effects); if (e) o.effects = e; }
      if (L.kind === 'group') { o.opened = !L.collapsed; o.children = level(L.id, opts); return o; }
      if (L.kind === 'adjust') {
        const a = opts.adjust ? io.psdAdjustmentOut(L.adjust.type, L.adjust.params) : null;
        if (!a) { dropped++; return null; }
        o.adjustment = a;
        return o;
      }
      o.left = L.x; o.top = L.y; o.canvas = L.canvas;
      if (L.kind === 'shape' && opts.vector) {
        const sh = L.shape;
        o.vectorFill = { type: 'color', color: rgbOf(sh.fillColor) };
        o.vectorMask = { paths: psdPaths(sh.subpaths) };
        o.vectorStroke = { strokeEnabled: !!sh.stroke, fillEnabled: !!sh.fill, lineWidth: { units: 'Pixels', value: sh.strokeWidth || 0 }, lineAlignment: 'center', content: { type: 'color', color: rgbOf(sh.strokeColor) }, opacity: 1, blendMode: 'normal' };
      }
      return o;
    };
    const level = (parent, opts) => (kids.get(parent) || []).map(L => one(L, opts)).filter(Boolean);
    const comp = doc.flatten();
    const tries = [{ fx: true, adjust: true, vector: true }, { fx: true, adjust: true, vector: false }, { fx: false, adjust: true, vector: false }, { fx: false, adjust: false, vector: false }];
    let buf = null, last;
    for (const opts of tries) {
      dropped = 0;
      try { buf = agPsd.writePsd({ width: doc.width, height: doc.height, children: level(null, opts), canvas: comp }, { generateThumbnail: true }); break; }
      catch (e) { last = e; console.warn('PSD : nouvel essai plus simple', opts, e); }
    }
    if (!buf) throw last;
    if (dropped) setTimeout(() => KS.toast(`${dropped} calque(s) de réglage sans équivalent Photoshop n'ont pas été écrits (le .ksp les garde)`, 'info', 5000), 200);
    return new Uint8Array(buf);
  };

  /* ---------------------------------------------------------------- enregistrer */
  io.SAVE_FILTERS = [
    { name: 'Document KaneApp (.ksp)', extensions: ['ksp'] }, { name: 'Photoshop (.psd)', extensions: ['psd'] },
    { name: 'PNG', extensions: ['png'] }, { name: 'JPEG', extensions: ['jpg'] }, { name: 'WebP', extensions: ['webp'] },
  ];
  io.exportCanvas = (doc, scale = 1, bg = null) => {
    const comp = doc.flatten();
    const w = Math.max(1, Math.round(doc.width * scale)), hh = Math.max(1, Math.round(doc.height * scale));
    const c = U.canvas(w, hh), x = c.getContext('2d');
    if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, hh); }
    x.imageSmoothingQuality = 'high';
    if (scale < 0.5) {
      // réduction progressive pour un rendu propre
      let src = comp, sw = comp.width, sh = comp.height;
      while (sw / 2 > w) { const t = U.canvas(sw / 2, sh / 2); t.getContext('2d').drawImage(src, 0, 0, t.width, t.height); src = t; sw = t.width; sh = t.height; }
      x.drawImage(src, 0, 0, w, hh);
    } else x.drawImage(comp, 0, 0, w, hh);
    return c;
  };
  io.encode = async (doc, fmt, opts = {}) => {
    if (fmt === 'ksp') return io.writeKSP(doc);
    if (fmt === 'psd') return io.writePSD(doc);
    const mime = fmt === 'jpg' || fmt === 'jpeg' ? 'image/jpeg' : 'image/' + fmt;
    const c = io.exportCanvas(doc, opts.scale || 1, mime === 'image/jpeg' ? '#ffffff' : null);
    const blob = await U.blobFromCanvas(c, mime, opts.quality ?? 0.92);
    return new Uint8Array(await blob.arrayBuffer());
  };
  const fmtOfPath = p => { const e = ext(p); return e === 'jpg' || e === 'jpeg' ? 'jpeg' : e; };
  io.save = async (doc = KS.state.doc, as = false) => {
    KS.panels.defs.properties?.commitPending?.();
    if (!doc) return false;
    const layered = doc.layers.length > 1 || doc.layers.some(L => L.kind !== 'raster' || L.mask || L.effects);
    if (!as && doc.path && (doc.format === 'ksp' || doc.format === 'psd' || !layered)) return io.writeTo(doc, doc.path, doc.format || fmtOfPath(doc.path));
    if (!as && doc.path && layered && ['png', 'jpeg', 'webp'].includes(doc.format)) {
      const r = await KS.confirm(`« ${doc.name} » contient des calques. Les enregistrer dans une image ${doc.format.toUpperCase()} les fusionnera dans le fichier (le document reste en calques).`, { ok: 'Enregistrer quand même', third: 'Enregistrer sous…' });
      if (r === true) return io.writeTo(doc, doc.path, doc.format);
      if (r !== 'third') return false;
    }
    const def = baseName(doc.name) + (layered ? '.ksp' : '.' + (doc.format === 'jpeg' ? 'jpg' : doc.format || 'png'));
    if (KS.native) {
      const dir = doc.path ? doc.path.replace(/[\\/][^\\/]*$/, '') : '';
      const p = await KS.native.saveDialog({ defaultPath: dir ? dir + '\\' + def : def, filters: layered ? io.SAVE_FILTERS : [io.SAVE_FILTERS[2], io.SAVE_FILTERS[3], io.SAVE_FILTERS[4], io.SAVE_FILTERS[0], io.SAVE_FILTERS[1]] });
      if (!p) return false;
      return io.writeTo(doc, p, fmtOfPath(p));
    }
    const name = await KS.prompt('Enregistrer sous', 'Nom du fichier', def);
    if (!name) return false;
    const fmt = fmtOfPath(name) || 'ksp';
    const data = await KS.busy(() => io.encode(doc, fmt));
    U.download(new Blob([data]), name);
    doc.name = name; doc.format = fmt; doc.dirty = false; KS.emit('doc-meta', doc);
    return true;
  };
  io.writeTo = async (doc, path, fmt) => {
    if (!['ksp', 'psd', 'png', 'jpeg', 'jpg', 'webp'].includes(fmt)) { KS.toast('Format non pris en charge : ' + fmt, 'err'); return false; }
    try {
      const revision = doc.revision || 0;
      const data = await KS.busy(() => io.encode(doc, fmt));
      const r = await KS.native.writeFile(path, data);
      if (!r.ok) throw new Error(r.error);
      doc.path = path; doc.name = path.split(/[\\/]/).pop(); doc.format = fmt === 'jpg' ? 'jpeg' : fmt; doc.dirty = (doc.revision || 0) !== revision;
      if (!doc.dirty && KS.recovery) await KS.recovery.saved(doc);
      io.addRecent(doc);
      KS.emit('doc-meta', doc);
      KS.toast('Enregistré : ' + doc.name, 'ok');
      return true;
    } catch (e) { KS.toast('Échec de l\'enregistrement : ' + (e.message || e), 'err', 5000); return false; }
  };
  io.exportAs = async (doc = KS.state.doc) => {
    if (!doc) return;
    const o = await KS.dialogs.exportAs(doc);
    if (!o) return;
    const e = o.fmt === 'jpeg' ? 'jpg' : o.fmt, def = baseName(doc.name) + '.' + e;
    const data = await KS.busy(() => io.encode(doc, o.fmt, o));
    if (KS.native) {
      const p = await KS.native.saveDialog({ title: 'Exporter', defaultPath: def, filters: [{ name: o.fmt.toUpperCase(), extensions: [e] }] });
      if (!p) return;
      const r = await KS.native.writeFile(p, data);
      if (r.ok) KS.toast('Exporté : ' + p.split(/[\\/]/).pop(), 'ok'); else KS.toast('Échec : ' + r.error, 'err');
    } else U.download(new Blob([data]), def);
  };
  io.quickExport = async (doc = KS.state.doc) => {
    if (!doc) return;
    const def = baseName(doc.name) + '.png';
    const data = await KS.busy(() => io.encode(doc, 'png'));
    if (KS.native) {
      const dir = doc.path ? doc.path.replace(/[\\/][^\\/]*$/, '') : null;
      const p = await KS.native.saveDialog({ title: 'Exportation rapide en PNG', defaultPath: dir ? dir + '\\' + def : def, filters: [{ name: 'PNG', extensions: ['png'] }] });
      if (!p) return;
      const r = await KS.native.writeFile(p, data);
      if (r.ok) KS.toast('Exporté : ' + p.split(/[\\/]/).pop(), 'ok'); else KS.toast('Échec : ' + r.error, 'err');
    } else U.download(new Blob([data]), def);
  };

  /* ---------------------------------------------------------------- importer / placer */
  io.placeCanvas = (doc, c, name = 'Image importée', at) => {
    let canvas = c;
    if (c.width > doc.width || c.height > doc.height) {
      const s = Math.min(doc.width / c.width, doc.height / c.height);
      canvas = U.canvas(c.width * s, c.height * s);
      const x = canvas.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, canvas.width, canvas.height);
    }
    const pos = at || { x: Math.round((doc.width - canvas.width) / 2), y: Math.round((doc.height - canvas.height) / 2) };
    const L = new KS.Layer({ name, canvas, x: pos.x, y: pos.y });
    KS.Hist.structure(doc, 'Importer', () => doc.addLayer(L, doc.activeIndex + 1), 'import');
    return L;
  };
  io.place = async () => {
    const doc = KS.state.doc; if (!doc) return;
    if (KS.native) {
      const files = await KS.native.openDialog({ title: 'Importer et incorporer', filters: io.OPEN_FILTERS, multi: false });
      for (const f of files) io.placeCanvas(doc, await io.canvasFromEntry(f), baseName(f.name));
      return;
    }
    const inp = KS.$('#file-input'); inp.accept = 'image/*,.psd,.ksp';
    inp.onchange = async () => { for (const f of inp.files) io.placeCanvas(doc, await io.canvasFromEntry({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }), baseName(f.name)); inp.value = ''; };
    inp.click();
  };

  // Insérer une image dans le calque actif (texte, forme, pixels) : elle couvre son contenu
  // et lui est écrêtée ; on la déplace ou la transforme ensuite à l'intérieur.
  io.placeIntoCanvas = (doc, c, name) => {
    const base = doc.active;
    if (!base || base.kind === 'group' || base.kind === 'adjust') { KS.toast('Choisissez d\'abord un calque de texte, de forme ou de pixels.', 'err'); return null; }
    const b = base.contentBounds() || base.bounds();
    const s = Math.max(b.w / c.width, b.h / c.height);
    const canvas = U.canvas(Math.max(1, Math.round(c.width * s)), Math.max(1, Math.round(c.height * s)));
    const x = canvas.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, canvas.width, canvas.height);
    const L = new KS.Layer({ name, canvas, x: Math.round(b.x + (b.w - canvas.width) / 2), y: Math.round(b.y + (b.h - canvas.height) / 2), clip: true });
    KS.Hist.structure(doc, 'Insérer dans le calque', () => doc.addLayer(L, doc.activeIndex + 1), 'image');
    return L;
  };
  io.placeInto = async () => {
    const doc = KS.state.doc; if (!doc) return;
    const base = doc.active;
    if (!base || base.kind === 'group' || base.kind === 'adjust') { KS.toast('Choisissez d\'abord un calque de texte, de forme ou de pixels.', 'err'); return; }
    if (KS.native) {
      const files = await KS.native.openDialog({ title: 'Insérer une image dans le calque', filters: io.OPEN_FILTERS, multi: false });
      for (const f of files) io.placeIntoCanvas(doc, await io.canvasFromEntry(f), baseName(f.name));
      return;
    }
    const inp = KS.$('#file-input'); inp.accept = 'image/*,.psd,.ksp';
    inp.onchange = async () => { for (const f of inp.files) io.placeIntoCanvas(doc, await io.canvasFromEntry({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }), baseName(f.name)); inp.value = ''; };
    inp.click();
  };

  /* ---------------------------------------------------------------- récents */
  io.thumbnail = (doc, size = 120) => {
    // copie réduite tenue à jour pour l'écran : recomposer tout le document en pleine résolution coûtait près d'une seconde sur une grande image
    const src = doc.previewSource ? doc.previewSource() : doc.flatten();
    const c = src.width > 0 && src.height > 0 ? src : doc.flatten(), s = Math.min(size / doc.width, size / doc.height, 1) * doc.width / c.width;
    const t = U.canvas(c.width * s, c.height * s); const x = t.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, t.width, t.height);
    return t.toDataURL('image/jpeg', 0.7);
  };
  io.addRecent = doc => {
    if (!doc.path) return;
    let thumb = null; try { thumb = io.thumbnail(doc, 96); } catch { /* ignore */ }
    const list = (KS.prefs.recent || []).filter(r => r.path !== doc.path);
    list.unshift({ path: doc.path, name: doc.name, thumb, w: doc.width, h: doc.height, t: Date.now() });
    KS.prefs.recent = list.slice(0, 16); KS.prefs.save();
    KS.emit('recent');
  };
  io.forgetRecent = p => { KS.prefs.recent = (KS.prefs.recent || []).filter(r => r.path !== p); KS.prefs.save(); KS.emit('recent'); };
})();

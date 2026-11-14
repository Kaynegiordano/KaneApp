// Atelier Animer : l'éditeur de fonds animés de KaneApp, construit comme celui de Wallpaper Engine (couches, effets,
// propriétés) mais plus direct. Les effets sont ceux de Wallpaper Engine, avec leurs réglages et libellés ; l'aperçu les
// exécute avec leurs propres shaders (animer-gl.js). Les masques se peignent ici ou s'affinent dans Retouche (sélection
// rapide, Sujet, masque rapide…), ou se calculent par IA (sujet, profondeur). « Envoyer » écrit une vraie scène dans les
// projets de Wallpaper Engine (animer-host.cjs, wallpaper-engine.cjs).
'use strict';
(() => {
  const h = KS.h, ui = KS.ui, N = KS.native, U = KS.util, C = KS.cmd;
  if (!N?.animerCall) return;
  const TAU = Math.PI * 2;
  const call = async (op, args) => { const r = await N.animerCall(op, args); if (!r.ok) throw new Error(r.error); return r.value; };
  const MASK_MAX = 2048, IMAGE_MAX = 4096;
  const OVERRIDES = [
    { key: 'rate', label: 'Quantité', min: 0, max: 4, step: 0.05 },
    { key: 'count', label: 'Nombre maximal', min: 0.1, max: 4, step: 0.05 },
    { key: 'speed', label: 'Vitesse', min: 0, max: 4, step: 0.05 },
    { key: 'size', label: 'Taille', min: 0.1, max: 4, step: 0.05 },
    { key: 'alpha', label: 'Opacité', min: 0, max: 2, step: 0.02 },
    { key: 'lifetime', label: 'Durée de vie', min: 0.2, max: 4, step: 0.05 },
  ];
  const MODES = { opacitymask: 'Masque', flowmask: 'Direction', depth: 'Profondeur', rgbmask: 'Image' };

  /* ---------------------------------------------------------------- état */
  const A = KS.animer = { project: null, id: null };
  let root, stage, canvas, engine, left, right, bar, emptyBox, brushRing, handle, paintBar, titleEl, playBtn, sendBtn, testBtn, banner;
  let image = null;
  const S = { W: 1, H: 1, mw: 1, mh: 1 };
  const masks = new Map(), dirtyMasks = new Set(), painted = new Map(), thumbs = new Map();
  const defs = new Map(), variants = new Map();
  let status = null, sel = null, paint = null, leftTab = 'layers';
  let tool = 'paint', overlayOn = true, playing = true, time = 0, last = 0, raf = 0, visible = false;
  let view = { z: 1, x: 0, y: 0 }, fitted = true;
  const brush = { size: 60, intensity: 1, hardness: 0.35 };
  let saveTimer = 0, saving = null, undo = [];

  const uid = () => Math.random().toString(36).slice(2, 9);
  const P = () => A.project;
  const imageLayer = () => P()?.layers.find(l => l.kind === 'image');
  const effectOf = id => imageLayer()?.effects.find(e => e.id === id);
  const layerOf = id => P()?.layers.find(l => l.id === id);
  const vkey = l => l.folder + '/' + l.variant;
  const maskKey = (e, pass, index) => 'mask:' + e + ':' + pass + ':' + index;
  const parseKey = k => { const m = String(k).match(/^mask:([\w-]+):(\d+):(\d+)$/); return m && { effect: m[1], pass: +m[2], index: +m[3] }; };
  const slotOf = key => { const k = parseKey(key), e = k && effectOf(k.effect); return e && (defs.get(e.effect)?.textures || []).find(t => t.pass === k.pass && t.index === k.index); };
  const isFlow = key => slotOf(key)?.mode === 'flowmask';
  const liveKeys = () => [...masks.keys()].filter(k => slotOf(k));

  /* ---------------------------------------------------------------- masques */
  const blankMask = (flow, white) => {
    const c = U.canvas(S.mw, S.mh), x = c.getContext('2d');
    x.fillStyle = flow ? 'rgb(127,127,0)' : white ? '#fff' : '#000'; x.fillRect(0, 0, S.mw, S.mh); return c;
  };
  async function canvasFromBytes(data) {
    const bmp = await createImageBitmap(new Blob([data]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = U.canvas(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); bmp.close?.(); return c;
  }
  const pngBytes = async c => new Uint8Array(await (await U.blobFromCanvas(c, 'image/png')).arrayBuffer());
  const fit2 = c => { if (c.width === S.mw && c.height === S.mh) return c; const r = U.canvas(S.mw, S.mh); r.getContext('2d').drawImage(c, 0, 0, S.mw, S.mh); return r; };
  // le masque d'une texture d'effet, créé à la couleur de départ de Wallpaper Engine (noir ou blanc, direction neutre)
  function ensureMask(key) {
    if (masks.has(key)) return masks.get(key);
    const slot = slotOf(key); const c = blankMask(slot?.mode === 'flowmask', slot?.paint === 1);
    masks.set(key, c); engine.setMask(key, c); return c;
  }
  // un effet sans rien de peint ne fait rien : la liste le signale (miniature du masque, 64 px)
  function measure(key) {
    const c = masks.get(key); if (!c) { painted.delete(key); drawThumb(key); return; }
    const t = U.canvas(64, Math.max(1, Math.round(64 * c.height / c.width))), x = t.getContext('2d', { willReadFrequently: true });
    x.drawImage(c, 0, 0, t.width, t.height);
    const d = x.getImageData(0, 0, t.width, t.height).data, flow = isFlow(key);
    let on = false; for (let i = 0; i < d.length && !on; i += 4) on = flow ? Math.abs(d[i] - 127) > 3 || Math.abs(d[i + 1] - 127) > 3 : d[i] > 6;
    painted.set(key, on);
    drawThumb(key);
  }
  function drawThumb(key) {
    const t = thumbs.get(key), c = masks.get(key); if (!t) return;
    const x = t.getContext('2d'); x.clearRect(0, 0, t.width, t.height);
    if (!c) { x.globalAlpha = 0.35; x.drawImage(image, 0, 0, t.width, t.height); x.globalAlpha = 1; return; }
    x.drawImage(c, 0, 0, t.width, t.height);
    if (isFlow(key)) {   // carte de direction : on montre l'intensité
      const d = x.getImageData(0, 0, t.width, t.height);
      for (let i = 0; i < d.data.length; i += 4) { const v = Math.min(255, Math.hypot(d.data[i] - 127.5, d.data[i + 1] - 127.5) * 2); d.data[i] = d.data[i + 1] = d.data[i + 2] = v; }
      x.putImageData(d, 0, 0);
    }
  }
  function pushUndo(key) {
    const c = masks.get(key); if (!c) { undo.push({ key, c: null }); return; }
    const b = U.canvas(c.width, c.height); b.getContext('2d').drawImage(c, 0, 0);
    undo.push({ key, c: b }); if (undo.length > 16) undo.shift();
  }
  function replaceMask(key, src) {
    pushUndo(key);
    const c = ensureMask(key), x = c.getContext('2d');
    x.globalCompositeOperation = 'copy'; x.drawImage(src, 0, 0, c.width, c.height); x.globalCompositeOperation = 'source-over';
    engine.setMask(key, c); syncEngine(); changed(key); measure(key); renderLeft(); kick();
  }
  A.undo = () => {
    const u = undo.pop(); if (!u) return false;
    if (!u.c) { masks.delete(u.key); engine.dropMask(u.key); painted.delete(u.key); }
    else { const c = ensureMask(u.key), x = c.getContext('2d'); x.globalCompositeOperation = 'copy'; x.drawImage(u.c, 0, 0); x.globalCompositeOperation = 'source-over'; engine.setMask(u.key, c); }
    changed(u.key); measure(u.key); renderLeft(); renderRight(); kick(); return true;
  };
  // masque gris (0..1 dans r) → carte de direction (angle : 0 = vers le haut, sens des aiguilles), même déplacement sur les
  // deux axes ; le contenu suit la direction : la carte pointe à l'opposé (on échantillonne en amont)
  function flowFromGray(gray, angle, force = 1) {
    const out = U.canvas(gray.width, gray.height), src = gray.getContext('2d').getImageData(0, 0, gray.width, gray.height), d = src.data;
    const m = Math.min(S.W, S.H), dx = Math.sin(angle), dy = -Math.cos(angle);
    const fx = -dx * m / S.W * force, fy = -dy * m / S.H * force;
    for (let i = 0; i < d.length; i += 4) { const a = d[i] / 255; d[i] = Math.round(127.5 + fx * a * 127.5); d[i + 1] = Math.round(127.5 + fy * a * 127.5); d[i + 2] = 0; d[i + 3] = 255; }
    out.getContext('2d').putImageData(src, 0, 0); return out;
  }
  // canevas de sélection (alpha) à la taille de l'image → masque gris à la taille des masques
  function grayFromAlpha(src) {
    const c = U.canvas(S.mw, S.mh), x = c.getContext('2d', { willReadFrequently: true });
    if (src) x.drawImage(src, 0, 0, S.mw, S.mh);
    const d = x.getImageData(0, 0, S.mw, S.mh);
    for (let i = 0; i < d.data.length; i += 4) { const a = d.data[i + 3]; d.data[i] = d.data[i + 1] = d.data[i + 2] = a; d.data[i + 3] = 255; }
    x.putImageData(d, 0, 0); return c;
  }

  /* ---------------------------------------------------------------- vue */
  function resize() {
    if (!canvas || !stage) return;
    const r = stage.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr)), hh = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
    if (fitted) fit();
  }
  function fit() {
    if (!P()) return;
    const r = stage.getBoundingClientRect(), pad = 24;
    const z = Math.min((r.width - pad * 2) / S.W, (r.height - pad * 2) / S.H);
    view = { z, x: (r.width - S.W * z) / 2, y: (r.height - S.H * z) / 2 }; fitted = true;
  }
  const toImage = (cx, cy) => { const r = stage.getBoundingClientRect(); return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z }; };
  const cssColor = name => { const c = U.parseHex(getComputedStyle(document.body).getPropertyValue(name).trim() || '#000000'); return [c.r / 255, c.g / 255, c.b / 255]; };
  // zone peinte en surimpression : rouge rosé franc, comme le masque rapide de Retouche, visible sur toutes les images
  const MASK_TINT = [1, 0.16, 0.38];
  let clear = null;
  function frame(now) {
    raf = 0;
    if (!visible || !engine || !P()) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
    if (playing) { time += dt; engine.step(dt); }
    const dpr = window.devicePixelRatio || 1;
    engine.present(time, { x: view.x * dpr, y: view.y * dpr, w: S.W * view.z * dpr, h: S.H * view.z * dpr },
      paint && overlayOn ? { key: paint.key, flow: isFlow(paint.key), tint: MASK_TINT, opacity: playing ? 0.55 : 0.65 } : null, clear || (clear = cssColor('--workspace')));
    placeHandle();
    raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf && visible) { last = 0; raf = requestAnimationFrame(frame); } };

  /* ---------------------------------------------------------------- moteur, définitions */
  async function needDef(key) {
    if (!defs.has(key)) defs.set(key, await call('effect', { key }));
    return defs.get(key);
  }
  async function needVariant(folder, variant) {
    const k = folder + '/' + variant;
    if (!variants.has(k)) variants.set(k, await call('preset', { folder, variant }));
    return variants.get(k);
  }
  function syncEngine() {
    if (!engine || !P()) return;
    engine.setEffects(imageLayer().effects.map(e => ({ id: e.id, def: defs.get(e.effect), visible: e.visible !== false, values: e.values, combos: e.combos })));
    engine.setBloom(P().bloom || {});
    engine.setAmbiances(P().layers.filter(l => l.kind === 'particle' && variants.has(vkey(l))).map(l => ({ id: l.id, variant: variants.get(vkey(l)), visible: l.visible !== false, x: l.x, y: l.y, scale: l.scale, angle: l.angle, overrides: l.overrides })));
    kick();
  }

  /* ---------------------------------------------------------------- enregistrement */
  function changed(key) { if (key) dirtyMasks.add(key); clearTimeout(saveTimer); saveTimer = setTimeout(() => A.flush().catch(e => KS.toast('Enregistrement d’Animer : ' + e.message, 'err', 6000)), 1200); }
  A.flush = async () => {
    clearTimeout(saveTimer); saveTimer = 0;
    if (!A.id || !P()) return;
    if (saving) await saving.catch(() => {});
    const keys = [...dirtyMasks]; dirtyMasks.clear();
    saving = (async () => {
      const out = {};
      for (const k of keys) if (masks.has(k) && slotOf(k)) out[k] = await pngBytes(masks.get(k));
      const t = engine?.snapshot(time, 320, Math.max(1, Math.round(320 * S.H / S.W)));
      await call('save', { id: A.id, project: P(), masks: out, keep: liveKeys(), thumb: t ? new Uint8Array(await (await U.blobFromCanvas(t, 'image/jpeg', 0.82)).arrayBuffer()) : null });
    })();
    try { await saving; } catch (e) { keys.forEach(k => dirtyMasks.add(k)); throw e; } finally { saving = null; }
  };

  /* ---------------------------------------------------------------- ouverture */
  // projets d'Animer 1.38.0 (mouvements et ambiances maison) → couches et effets de Wallpaper Engine
  async function migrate(p, raw) {
    if ((p.version || 1) >= 2) return { p, masks: raw, toFlow: [] };
    const legacy = await call('legacy').catch(() => ({}));
    const img = { id: 'image', kind: 'image', name: p.title || 'Illustration', effects: [] }, out = {}, toFlow = [];
    for (const e of p.effects || []) {
      const q = e.params || {}, src = raw['v1:' + e.id], base = { id: e.id, name: e.name, visible: e.visible !== false };
      if (e.type === 'respiration') { img.effects.push({ ...base, effect: 'shake', values: { speed: q.vitesse ?? 1.4, strength: q.force ?? 0.1, friction: [q.douceur ?? 1, q.douceur ?? 1] }, combos: { NOISE: q.irregulier ? 1 : 0 } }); if (src) out[maskKey(e.id, 0, 1)] = src; }
      else if (e.type === 'clignement') { img.effects.push({ ...base, effect: 'shake', values: { speed: q.vitesse ?? 1.2, strength: q.force ?? 0.1, friction: [1, 1], bounds: [0.993, 0.998] }, combos: { DIRECTION: 1 } }); if (src) { out[maskKey(e.id, 0, 1)] = src; toFlow.push(maskKey(e.id, 0, 1)); } }
      else if (e.type === 'ondulation') { img.effects.push({ ...base, effect: 'waterwaves', values: { speed: q.vitesse ?? 1.5, scale: q.echelle ?? 12, strength: q.force ?? 0.1, direction: q.direction ?? 0, exponent: q.exposant ?? 1 }, combos: {} }); if (src) out[maskKey(e.id, 0, 1)] = src; }
      else if (e.type === 'lueur') { img.effects.push({ ...base, effect: 'pulse', values: { speed: q.vitesse ?? 1, amount: q.force ?? 1, phase: q.phase ?? 0, tinthigh: q.couleur || '#ffffff' }, combos: {} }); if (src) out[maskKey(e.id, 0, 2)] = src; }
      else if (e.type === 'regard') { img.effects.push({ ...base, effect: 'iris', values: { scale: [q.force ?? 1, q.force ?? 1], speed: q.vitesse ?? 1, rough: q.douceur ?? 0.2, noiseamount: q.flottement ?? 0.5 }, combos: {} }); if (src) out[maskKey(e.id, 0, 1)] = src; }
    }
    const layers = [img];
    for (const a of p.ambiances || []) { const [folder, variant] = legacy[a.key] || ['ember', 1]; layers.push({ id: a.id, kind: 'particle', folder, variant, name: a.name, visible: a.visible !== false, x: a.x, y: a.y, scale: a.scale ?? 1, angle: 0, overrides: a.overrides || {} }); }
    return { p: { version: 2, title: p.title, width: p.width, height: p.height, created: p.created, layers, bloom: p.bloom || { on: false, strength: 0.8, threshold: 0.65 }, we: p.we }, masks: out, toFlow };
  }
  async function start(project, id, img, maskBytes = {}) {
    for (const k of masks.keys()) engine?.dropMask(k);
    masks.clear(); painted.clear(); dirtyMasks.clear(); thumbs.clear(); undo = []; sel = null; paint = null;
    stage?.classList.remove('painting');
    const m = await migrate(project, maskBytes);
    A.project = m.p; A.id = id; time = 0;
    ensureEngine();
    image = img; S.W = img.width; S.H = img.height;
    const k = Math.min(1, MASK_MAX / Math.max(S.W, S.H)); S.mw = Math.max(1, Math.round(S.W * k)); S.mh = Math.max(1, Math.round(S.H * k));
    engine.setImage(img, S.W, S.H);
    const problems = [];
    for (const e of imageLayer().effects) await needDef(e.effect).catch(err => problems.push(err.message));
    for (const l of P().layers) if (l.kind === 'particle') await needVariant(l.folder, l.variant).catch(err => problems.push(err.message));
    for (const [key, data] of Object.entries(m.masks)) {
      if (!slotOf(key)) continue;
      let c = fit2(await canvasFromBytes(data));
      if (m.toFlow.includes(key)) c = flowFromGray(c, Math.PI, 1);       // clignement 1.38.0 : la paupière descend
      masks.set(key, c); engine.setMask(key, c); measure(key);
    }
    if ((project.version || 1) < 2) for (const key of masks.keys()) dirtyMasks.add(key);
    if (problems.length) KS.toast(problems[0], 'err', 6000);
    fitted = true; resize(); syncEngine();
    sel = { kind: 'layer', id: imageLayer().id };
    render(); KS.ws?.sync?.();
    if ((project.version || 1) < 2) changed();
  }
  // une image (fichier, document de Retouche, média du projet) devient un nouveau projet Animer
  A.openCanvas = async (src, title) => {
    await A.flush().catch(() => {});
    let c = src;
    if (Math.max(c.width, c.height) > IMAGE_MAX) {
      const k = IMAGE_MAX / Math.max(c.width, c.height), r = U.canvas(Math.round(c.width * k), Math.round(c.height * k));
      r.getContext('2d').drawImage(c, 0, 0, r.width, r.height); c = r;
    }
    title = String(title || 'Animation').replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 80) || 'Animation';
    const { id } = await call('create', { title, image: await pngBytes(c) });
    const project = { version: 2, title, width: c.width, height: c.height, created: new Date().toISOString(),
      layers: [{ id: 'image', kind: 'image', name: title, effects: [] }], bloom: { on: false, strength: 0.8, threshold: 0.65 } };
    await start(project, id, c);
    await A.flush();
  };
  A.openBytes = async (data, name) => A.openCanvas(await canvasFromBytes(data), name);
  A.openFile = async () => {
    const files = await N.openDialog({ filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }], multi: false });
    if (files?.length) await A.openBytes(files[0].data, files[0].name);
  };
  A.openDocument = async () => {
    const d = KS.state.doc && !KS.state.doc.animerMask ? KS.state.doc : KS.state.docs.find(x => !x.animerMask);
    if (!d) throw new Error('Ouvrez une illustration dans Retouche');
    await A.openCanvas(U.copyCanvas(d.composite()), d.name);
  };
  A.load = async id => {
    await A.flush().catch(() => {});
    const r = await call('load', { id });
    await start(r.project, id, await canvasFromBytes(r.image), r.masks);
  };
  A.close = async () => {
    await A.flush().catch(() => {});
    for (const k of masks.keys()) engine?.dropMask(k);
    masks.clear(); A.project = null; A.id = null; sel = null; paint = null; stage?.classList.remove('painting'); render(); KS.ws?.sync?.();
  };

  /* ---------------------------------------------------------------- effets, ambiances */
  async function addEffect(key) {
    const def = await needDef(key);
    const e = { id: 'e' + uid(), effect: key, name: def.title, visible: true, values: {}, combos: {} };
    imageLayer().effects.push(e);
    sel = { kind: 'effect', id: e.id }; if (paint) stopPaint();
    syncEngine(); render(); changed();
    if (engine.check(def)) KS.toast('« ' + def.title + ' » ne peut pas être montré dans l’aperçu ; il fonctionnera dans Wallpaper Engine (bouton Tester).', 'info', 6000);
    return e;
  }
  function removeEffect(id) {
    imageLayer().effects = imageLayer().effects.filter(e => e.id !== id);
    for (const k of [...masks.keys()]) if (parseKey(k)?.effect === id) { engine.dropMask(k); masks.delete(k); painted.delete(k); }
    if (sel?.id === id) sel = { kind: 'layer', id: imageLayer().id };
    if (paint && parseKey(paint.key)?.effect === id) stopPaint();
    syncEngine(); render(); changed();
  }
  function moveEffect(id, delta) {
    const list = imageLayer().effects, i = list.findIndex(x => x.id === id), j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]]; syncEngine(); renderLeft(); renderRight(); changed();
  }
  async function addAmbiance(folder, variant) {
    const v = await needVariant(folder, variant);
    const l = { id: 'p' + uid(), kind: 'particle', folder, variant, name: v.label === v.title ? v.title : v.title + ' · ' + v.label, visible: true,
      x: Math.round(S.W / 2), y: Math.round(S.H / 2), scale: +(Math.max(0.5, Math.min(4, S.H / 1080))).toFixed(3), angle: 0, overrides: {} };
    P().layers.push(l); sel = { kind: 'layer', id: l.id }; if (paint) stopPaint();
    syncEngine(); render(); changed();
    return l;
  }
  function removeLayer(id) {
    P().layers = P().layers.filter(l => l.id !== id || l.kind === 'image');
    if (sel?.id === id) sel = { kind: 'layer', id: imageLayer().id };
    syncEngine(); render(); changed();
  }

  /* ---------------------------------------------------------------- pinceau */
  let stroke = null;
  function dab(ctx, x, y, r, rgb, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r), c = rgb.join(',');
    g.addColorStop(0, `rgba(${c},${alpha})`); g.addColorStop(Math.min(0.95, brush.hardness), `rgba(${c},${alpha})`); g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  function paintTo(p) {
    const c = masks.get(stroke.key); if (!c) return;
    const ctx = c.getContext('2d'), k = S.mw / S.W, flow = stroke.flow;
    const r = Math.max(1, brush.size * k / 2), spacing = Math.max(0.6, r * 0.25);
    const from = stroke.last, dx = p.x - from.x, dy = p.y - from.y, dist = Math.hypot(dx, dy);
    if (flow) {
      if (dist < 1.5 / view.z && stroke.dir === null) return;
      if (dist > 0) { const ux = dx / dist, uy = dy / dist; stroke.dir = stroke.dir ? [stroke.dir[0] * 0.7 + ux * 0.3, stroke.dir[1] * 0.7 + uy * 0.3] : [ux, uy]; }
    }
    let rgb;
    if (flow) {
      if (tool === 'erase') rgb = [127, 127, 0];
      else {
        const l = Math.hypot(...stroke.dir) || 1, m = Math.min(S.W, S.H), f = brush.intensity;
        // carte en coordonnées de texture : la direction peinte en pixels donne le même déplacement sur les deux axes ;
        // le contenu suit le geste (la carte pointe à l'opposé, comme dans l'éditeur de Wallpaper Engine)
        const fx = -stroke.dir[0] / l * m / S.W * f, fy = -stroke.dir[1] / l * m / S.H * f;
        rgb = [Math.round(127.5 + fx * 127.5), Math.round(127.5 + fy * 127.5), 0].map(v => Math.max(0, Math.min(255, v)));
      }
    } else { const v = tool === 'erase' ? 0 : Math.round(255 * brush.intensity); rgb = [v, v, v]; }
    const steps = Math.max(1, Math.ceil(dist * k / spacing));
    for (let i = 1; i <= steps; i++) dab(ctx, (from.x + dx * i / steps) * k, (from.y + dy * i / steps) * k, r, rgb, 0.28);
    stroke.last = p; engine.setMask(stroke.key, c); kick();
  }
  function beginStroke(ev) {
    if (!paint) return false;
    const fresh = !masks.has(paint.key);
    pushUndo(paint.key); ensureMask(paint.key);
    if (fresh) syncEngine();
    const e = effectOf(parseKey(paint.key).effect); if (e && e.visible === false) { e.visible = true; syncEngine(); renderLeft(); }
    const p = toImage(ev.clientX, ev.clientY);
    stroke = { key: paint.key, last: p, dir: null, flow: isFlow(paint.key) };
    if (!stroke.flow) paintTo(p);
    return true;
  }
  function endStroke() { if (!stroke) return; const k = stroke.key; stroke = null; changed(k); const was = painted.get(k); measure(k); if (was !== painted.get(k)) renderLeft(); }
  function startPaint(key) { paint = { key }; tool = 'paint'; overlayOn = true; sel = { kind: 'effect', id: parseKey(key).effect }; stage.classList.add('painting'); renderPaintBar(); renderRight(); kick(); }
  function stopPaint() { paint = null; stage?.classList.remove('painting'); if (brushRing) brushRing.hidden = true; renderPaintBar(); renderRight(); kick(); }

  /* ---------------------------------------------------------------- masques automatiques et Retouche */
  async function subjectMask() {
    if (!KS.ai?.available) throw new Error('Le détourage par IA n’est pas disponible');
    const id = await KS.ai.ensureModel(); if (!id) throw new Error('Modèle de détourage non installé');
    const m = await KS.ai.segment(image, id);
    if (!m) throw new Error('Sujet introuvable');
    return grayFromAlpha(m);
  }
  // parties du corps détectées par Kane Detailer (moteur du Studio IA) : cheveux, yeux, visage, vêtements…
  const PARTS = [['cheveux', 'Cheveux'], ['yeux', 'Yeux'], ['visage', 'Visage'], ['vetements', 'Vêtements'], ['personne', 'Corps entier'], ['mains', 'Mains'], ['poitrine', 'Poitrine']];
  const partCache = new Map();
  async function partMask(part, label) {
    if (!N.forgeKaneMasks || !KS.engine) throw new Error('La détection des parties demande le moteur du Studio IA');
    const ck = A.id + ':' + part;
    if (!partCache.has(ck)) {
      if (!(await KS.engine.ensure())) throw new Error('Démarrez le moteur du Studio IA pour détecter les parties de l’image');
      const r = await N.forgeKaneMasks(KS.gen?.url?.() || KS.engine.url, { parts: [part] }, await pngBytes(image));
      if (!r.ok) throw new Error(/404|Not Found/i.test(r.error) ? 'Le moteur du Studio est trop ancien pour cette détection : mettez Kane OS à jour puis redémarrez le moteur.' : r.error);
      partCache.set(ck, r.masks?.[part] || null);
    }
    const bytes = partCache.get(ck);
    if (!bytes) throw new Error('Aucune zone « ' + label + ' » trouvée dans l’image');
    return fit2(await canvasFromBytes(bytes));
  }
  let depthOk = false;
  async function depthMask() {
    if (!depthOk) {
      const m = (await N.aiStatus()).find(x => x.id === 'depth'); if (!m) throw new Error('Modèle de profondeur indisponible');
      if (!m.installed && !(await KS.ai.downloadDialog([m], { title: 'Télécharger le modèle de profondeur', text: 'La profondeur est calculée par Depth Anything V2 (1,3 Go, usage personnel), sur votre PC. Il faut le télécharger une fois.' }))) throw new Error('Modèle de profondeur non installé');
      depthOk = true;
    }
    const k = 994 / Math.max(S.W, S.H), w = Math.max(14, Math.round(S.W * k / 14) * 14), hh = Math.max(14, Math.round(S.H * k / 14) * 14);
    const c = U.canvas(w, hh), x = c.getContext('2d'); x.drawImage(image, 0, 0, w, hh);
    const px = x.getImageData(0, 0, w, hh).data, n = w * hh, input = new Float32Array(3 * n), mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
    for (let i = 0; i < n; i++) for (let ch = 0; ch < 3; ch++) input[ch * n + i] = (px[i * 4 + ch] / 255 - mean[ch]) / std[ch];
    const r = await N.aiDepth(input, w, hh); if (!r.ok) throw new Error(r.error);
    const ow = r.dims.at(-1), oh = r.dims.at(-2), d = r.depth, sorted = Array.from(d.filter((_, i) => i % 7 === 0)).sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length * 0.01)], hi = sorted[Math.floor(sorted.length * 0.995)], s = 1 / ((hi - lo) || 1);
    const o = U.canvas(ow, oh), ox = o.getContext('2d'), id = ox.createImageData(ow, oh);
    for (let i = 0; i < d.length; i++) { const v = Math.round(U.clamp((d[i] - lo) * s, 0, 1) * 255); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
    ox.putImageData(id, 0, 0); return fit2(o);
  }
  // direction d'une carte de direction remplie depuis une zone (IA, Retouche) : petite fenêtre avec un cadran
  async function askDirection(title) {
    let angle = 0, force = 1;
    const d = dial(0, v => { angle = v; });
    const f = ui.paramRow({ label: 'Force', min: 5, max: 100, step: 1, unit: '%' }, 100, v => { force = v / 100; });
    const ok = await KS.modal({ title: 'Direction · ' + title, width: 380, body: h('div.an-ask', h('p.an-help', { text: 'Le contenu de la zone se déplacera dans cette direction (0° = vers le haut).' }), d, f),
      buttons: [{ label: 'Annuler', value: false }, { label: 'Appliquer', primary: true, value: true }] }).done;
    return ok ? { angle, force } : null;
  }
  async function applyZone(key, gray, label) {
    if (isFlow(key)) { const dir = await askDirection(label); if (!dir) return; gray = flowFromGray(gray, dir.angle, dir.force); }
    replaceMask(key, gray); renderRight();
  }
  // Le masque devient la sélection d'un document de Retouche : sélection rapide, baguette, Sujet, masque rapide (Q),
  // « Sélectionner et masquer »… puis « Renvoyer à Animer ».
  A.editInRetouche = async key => {
    const slot = slotOf(key), e = effectOf(parseKey(key).effect); if (!slot || !e) return;
    if (paint) stopPaint();
    const d = new KS.Doc({ name: 'Masque · ' + e.name + (slot.label ? ' · ' + slot.label : ''), width: S.W, height: S.H });
    d.addLayer(new KS.Layer({ name: 'Image', canvas: U.copyCanvas(image) }), 0);
    const m = masks.get(key);
    if (m && painted.get(key)) {
      const sel2 = U.canvas(S.W, S.H);
      const g = U.canvas(m.width, m.height), gx = g.getContext('2d', { willReadFrequently: true }); gx.drawImage(m, 0, 0);
      const id = gx.getImageData(0, 0, g.width, g.height), flow = isFlow(key);
      for (let i = 0; i < id.data.length; i += 4) { const a = flow ? Math.min(255, Math.hypot(id.data[i] - 127.5, id.data[i + 1] - 127.5) * 2) : id.data[i]; id.data[i] = id.data[i + 1] = id.data[i + 2] = 0; id.data[i + 3] = a; }
      gx.putImageData(id, 0, 0); sel2.getContext('2d').drawImage(g, 0, 0, S.W, S.H);
      d.selection.combineCanvas(sel2, 'new');
    }
    d.animerMask = { project: A.id, key, label: e.name + (slot.label ? ' — ' + slot.label : '') };
    await A.flush().catch(() => {});
    KS.ws.go(null); await C.toggleStudio(false); KS.addDoc(d); d.dirty = false;
    KS.toast('Affinez la sélection (sélection rapide W, Sélection › Sujet, masque rapide Q…), puis « Renvoyer à Animer ».', 'info', 7000);
    renderBanner();
  };
  async function returnFromRetouche(d) {
    const info = d.animerMask; if (!info) return;
    if (d.quickMask) { if (KS.state.doc !== d) KS.switchDoc(d); C.quickMask(); }
    if (info.project && info.project !== A.id) await A.load(info.project);
    if (!slotOf(info.key)) throw new Error('L’effet de ce masque n’existe plus dans Animer');
    const gray = grayFromAlpha(d.selection.mask);
    d.dirty = false; d.animerMask = null;
    await KS.closeDoc(d);
    KS.ws.go('animer');
    sel = { kind: 'effect', id: parseKey(info.key).effect };
    await applyZone(info.key, gray, info.label);
    renderBanner();
  }
  function renderBanner() {
    if (!banner) return;
    const d = KS.state.doc, on = !!d?.animerMask && KS.ws?.cur !== 'animer' && !KS.studio?.on && !document.body.classList.contains('suite-home');
    banner.hidden = !on; if (!on) return;
    banner.replaceChildren(h('span.an-bn-icon', { html: KS.icon('sparkles') }),
      h('div.an-bn-t', h('b', { text: 'Masque d’Animer : ' + d.animerMask.label }), h('small', { text: 'La sélection devient le masque. Sélection rapide (W), baguette, Sélection › Sujet, masque rapide (Q), Sélectionner et masquer.' })),
      ui.btn('Renvoyer à Animer', () => KS.suite.run('Masque renvoyé à Animer', () => returnFromRetouche(d)).catch(() => {}), '.small.primary', 'check'),
      ui.btn('Abandonner', async () => { d.dirty = false; d.animerMask = null; await KS.closeDoc(d); KS.ws.go('animer'); }, '.small'));
  }

  /* ---------------------------------------------------------------- interactions de la scène */
  function placeHandle() {
    if (!handle) return;
    const l = sel?.kind === 'layer' ? layerOf(sel.id) : null;
    handle.hidden = !(l && l.kind === 'particle') || !!paint;
    if (!handle.hidden) { handle.style.left = (view.x + l.x * view.z) + 'px'; handle.style.top = (view.y + l.y * view.z) + 'px'; }
  }
  function showRing(ev) {
    brushRing.hidden = !paint || !ev;
    if (!paint || !ev) return;
    const r = stage.getBoundingClientRect(), d = brush.size * view.z;
    Object.assign(brushRing.style, { width: d + 'px', height: d + 'px', left: (ev.clientX - r.left - d / 2) + 'px', top: (ev.clientY - r.top - d / 2) + 'px' });
    brushRing.classList.toggle('erase', tool === 'erase');
  }
  function bindStage() {
    let pan = null, drag = null, space = false;
    stage.addEventListener('wheel', ev => {
      if (!P() || ev.target.closest('.an-paintbar, .an-empty')) return; ev.preventDefault();
      if (paint && (ev.altKey || ev.shiftKey)) { brush.size = Math.max(2, Math.min(1200, brush.size * (ev.deltaY < 0 ? 1.12 : 1 / 1.12))); renderPaintBar(); showRing(ev); return; }
      const r = stage.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
      const z = Math.max(0.02, Math.min(16, view.z * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)));
      view.x = mx - (mx - view.x) * z / view.z; view.y = my - (my - view.y) * z / view.z; view.z = z; fitted = false; kick(); showRing(ev);
    }, { passive: false });
    stage.addEventListener('pointerdown', ev => {
      if (!P() || ev.target.closest('.an-paintbar, .an-empty')) return;
      try { stage.setPointerCapture(ev.pointerId); } catch { /* pointeur déjà relâché */ }
      if (ev.button === 1 || ev.button === 2 || space) { pan = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y }; stage.classList.add('panning'); return; }
      if (ev.button !== 0) return;
      if (ev.target === handle) { const l = layerOf(sel.id), p = toImage(ev.clientX, ev.clientY); drag = { l, dx: l.x - p.x, dy: l.y - p.y }; return; }
      beginStroke(ev);
    });
    stage.addEventListener('pointermove', ev => {
      if (!P() || ev.target.closest('.an-paintbar, .an-empty')) { brushRing.hidden = true; return; }
      showRing(ev);
      const p = toImage(ev.clientX, ev.clientY); engine?.setPointer(U.clamp(p.x / S.W, 0, 1), U.clamp(p.y / S.H, 0, 1));
      if (pan) { view.x = pan.vx + ev.clientX - pan.x; view.y = pan.vy + ev.clientY - pan.y; fitted = false; kick(); return; }
      if (drag) { drag.l.x = Math.round(p.x + drag.dx); drag.l.y = Math.round(p.y + drag.dy); syncEngine(); return; }
      if (stroke) for (const pe of ev.getCoalescedEvents?.() || [ev]) paintTo(toImage(pe.clientX, pe.clientY));
    });
    const end = () => {
      if (pan) { pan = null; stage.classList.remove('panning'); }
      if (drag) { drag = null; changed(); renderRight(); }
      endStroke();
    };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
    stage.addEventListener('pointerleave', () => { brushRing.hidden = true; });
    stage.addEventListener('contextmenu', ev => ev.preventDefault());
    stage.addEventListener('dblclick', ev => { if (ev.target === canvas && !paint) { fit(); kick(); } });
    stage.addEventListener('dragover', ev => { ev.preventDefault(); ev.stopPropagation(); });
    stage.addEventListener('drop', async ev => {
      ev.preventDefault(); ev.stopPropagation();
      const f = [...ev.dataTransfer.files].find(x => /^image\//.test(x.type) || /\.(png|jpe?g|webp|bmp)$/i.test(x.name));
      if (f) KS.suite.run('Ouverture de l’image dans Animer', async () => A.openBytes(new Uint8Array(await f.arrayBuffer()), f.name)).catch(() => {});
    });
    document.addEventListener('keydown', ev => {
      if (!visible || KS.modalOpen?.() || ev.target.matches?.('input, textarea, select')) return;
      if (ev.code === 'Space') { space = true; stage.classList.add('can-pan'); ev.preventDefault(); return; }
      const k = ev.key.toLowerCase();
      if ((ev.ctrlKey || ev.metaKey) && k === 'z') { if (A.undo()) ev.preventDefault(); ev.stopPropagation(); return; }
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (k === 'escape' && paint) stopPaint();
      else if (k === 'b' && paint) { tool = 'paint'; renderPaintBar(); }
      else if (k === 'e' && paint) { tool = 'erase'; renderPaintBar(); }
      else if (k === 'm' && paint) { overlayOn = !overlayOn; renderPaintBar(); kick(); }
      else if ((k === '[' || k === ']') && paint) { brush.size = Math.max(2, Math.min(1200, brush.size * (k === ']' ? 1.15 : 1 / 1.15))); renderPaintBar(); }
      else if (k === 'p' && P()) { playing = !playing; renderBar(); kick(); }
      else if (k === '0' && P()) { fit(); kick(); }
      else return;
      ev.preventDefault(); ev.stopPropagation();
    }, true);
    document.addEventListener('keyup', ev => { if (ev.code === 'Space') { space = false; stage?.classList.remove('can-pan'); } });
  }

  /* ---------------------------------------------------------------- Wallpaper Engine */
  async function send(then) {
    if (!P()) return;
    if (!status?.engine) throw new Error('Wallpaper Engine est introuvable. Installez-le avec Steam, puis relancez KaneApp.');
    if (!imageLayer().effects.length && !P().layers.some(l => l.kind === 'particle')) throw new Error('Ajoutez au moins un effet ou une ambiance.');
    if (paint) stopPaint();
    await A.flush();
    const out = {};
    for (const k of liveKeys()) out[k] = await pngBytes(masks.get(k));
    const pw = Math.min(1280, S.W), ph = Math.max(1, Math.round(pw * S.H / S.W));
    const prev = engine.snapshot(Math.max(time, 1.5), pw, ph);
    const preview = new Uint8Array(await (await U.blobFromCanvas(prev, 'image/jpeg', 0.88)).arrayBuffer());
    const r = await call('export', { id: A.id, masks: out, preview, then });
    P().we = { name: r.name, date: new Date().toISOString() };
    KS.toast(then === 'test' ? 'Ouverture dans une fenêtre de Wallpaper Engine…' : then === 'apply' ? 'Fond d’écran appliqué : ' + r.title : 'Disponible dans Wallpaper Engine : ' + r.title, 'ok', 5000);
    renderBar();
    return r;
  }

  /* ---------------------------------------------------------------- petits composants */
  // cadran de direction (radians ; 0 = vers le haut, sens des aiguilles), comme dans l'éditeur de Wallpaper Engine
  function dial(value, onInput, label = 'Direction') {
    let v = +value || 0;
    const line = h('div.an-dial-line'), knob = h('div.an-dial', { title: 'Faire tourner' }, line);
    const field = h('input.field', { type: 'text', value: String(Math.round(v * 180 / Math.PI)) });
    const setV = (nv, fire = true) => { v = nv; line.style.transform = `rotate(${v * 180 / Math.PI}deg)`; field.value = String(Math.round(v * 180 / Math.PI)); if (fire) onInput(v); };
    setV(v, false);
    const at = ev => { const r = knob.getBoundingClientRect(); return Math.atan2(ev.clientX - (r.left + r.width / 2), -(ev.clientY - (r.top + r.height / 2))); };
    knob.addEventListener('pointerdown', ev => { knob.setPointerCapture(ev.pointerId); setV(at(ev)); const mv = e2 => setV(at(e2)); const up = () => { knob.removeEventListener('pointermove', mv); knob.removeEventListener('pointerup', up); }; knob.addEventListener('pointermove', mv); knob.addEventListener('pointerup', up); });
    field.addEventListener('keydown', e2 => { e2.stopPropagation(); if (e2.key === 'Enter') field.blur(); });
    field.addEventListener('change', () => { const n = parseFloat(field.value.replace(',', '.')); if (!isNaN(n)) setV(n * Math.PI / 180); });
    return h('div.an-param.an-dialrow', h('span.pl', { text: label + ' (°)' }), h('div.an-dial-box', knob, field));
  }
  const numList = v => Array.isArray(v) ? v.map(Number) : typeof v === 'number' ? [v] : String(v ?? '').trim() ? String(v).trim().split(/\s+/).map(Number) : [];
  const hexOf = v => { if (typeof v === 'string' && /^#/.test(v)) return v; const a = numList(v); return a.length >= 3 ? U.hex({ r: a[0] * 255, g: a[1] * 255, b: a[2] * 255 }) : '#ffffff'; };
  function rangeOf(prm, d0) {
    if (Array.isArray(prm.range) && prm.range.length === 2) return prm.range.map(Number);
    const d = Math.abs(d0 || 0); return [Math.min(0, d0 || 0), Math.max(1, d * 4)];
  }
  // un réglage annoté d'un shader de Wallpaper Engine → curseur, cadran, couleur ou champs
  function paramWidget(e, prm) {
    const cur = e.values[prm.material] ?? prm.default;
    const set = v => { e.values[prm.material] = v; syncEngine(); changed(); };
    if (prm.color) return ui.paramRow({ type: 'color', label: prm.label }, hexOf(cur), v => set(v));
    if (prm.direction) return dial(numList(cur)[0] || 0, v => set(+v.toFixed(4)), prm.label);
    const vals = numList(cur), d0 = numList(prm.default);
    const [min, max] = rangeOf(prm, d0[0]), step = prm.int ? 1 : Math.max(0.001, +((max - min) / 400).toPrecision(1));
    if (prm.type === 'float' || prm.type === 'int') return ui.paramRow({ label: prm.label, min, max, step }, U.clamp(vals[0] ?? d0[0] ?? 0, min, max), v => set(v));
    const n = prm.type === 'vec2' ? 2 : prm.type === 'vec3' ? 3 : 4;
    if (n === 2 && prm.linked) return ui.paramRow({ label: prm.label, min, max, step }, U.clamp(vals[0] ?? 0, min, max), v => set([v, v]));
    if (n === 2 && prm.range) {
      const xy = [vals[0] ?? 0, vals[1] ?? vals[0] ?? 0];
      return h('div.an-pair', h('span.pl', { text: prm.label }), ...['X', 'Y'].map((ax, i) => ui.paramRow({ label: ax, min, max, step }, U.clamp(xy[i], min, max), v => { xy[i] = v; set(xy.slice()); })));
    }
    const arr = Array.from({ length: n }, (_, i) => vals[i] ?? d0[i] ?? 0);
    const fields = arr.map((v, i) => { const f = h('input.field', { type: 'text', value: String(+(+v).toFixed(4)) }); f.addEventListener('keydown', ev => ev.stopPropagation()); f.addEventListener('change', () => { const x = parseFloat(f.value.replace(',', '.')); if (!isNaN(x)) { arr[i] = x; set(arr.slice()); } }); return f; });
    return h('div.an-param.an-vec', h('span.pl', { text: prm.label }), h('div.an-vec-f', fields));
  }
  const requireOk = (req, e, def) => !req || Object.entries(req).every(([k, v]) => (e.combos[k] ?? def.combos.find(c => c.combo === k)?.default ?? 0) == v);

  /* ---------------------------------------------------------------- choix d'un effet, d'une ambiance */
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  async function pickEffect() {
    const all = status?.effects || [];
    let search = '', chosen = all.find(f => f.key === 'foliagesway') || all[0];
    const list = h('div.an-pick-list'), info = h('div.an-pick-info');
    const fill = () => {
      list.replaceChildren();
      const q = norm(search);
      let group = null;
      for (const f of all) {
        if (q && !norm(f.title + ' ' + f.description + ' ' + f.groupLabel).includes(q)) continue;
        if (f.groupLabel !== group) { group = f.groupLabel; list.append(h('div.an-pick-group', { text: group })); }
        const b = h('button.an-pick-item' + (f === chosen ? '.on' : ''), h('span', { text: f.title }), f.performance ? h('em', { text: f.performance === 'veryexpensive' ? 'très lourd' : 'lourd' }) : null);
        b.addEventListener('click', () => { chosen = f; fill(); });
        b.addEventListener('dblclick', () => { chosen = f; modal.close('ok'); });
        list.append(b);
      }
      info.replaceChildren(chosen ? h('div', h('span.an-kind', { text: chosen.groupLabel }), h('h3', { text: chosen.title }), h('p', { text: chosen.description || '' }),
        chosen.performance ? h('p.an-note', { text: 'Effet lourd : il demande plus à la carte graphique dans Wallpaper Engine.' }) : null) : '');
    };
    const input = h('input.field', { placeholder: 'Rechercher un effet…', 'aria-label': 'Rechercher un effet' });
    input.addEventListener('input', () => { search = input.value; fill(); }); input.addEventListener('keydown', ev => ev.stopPropagation());
    const modal = KS.modal({ title: 'Ajouter un effet', width: 760, body: h('div.an-pick', input, h('div.an-pick-cols', list, info)),
      buttons: [{ label: 'Annuler', value: false }, { label: 'Ajouter', primary: true, value: 'ok' }] });
    fill(); setTimeout(() => input.focus(), 0);
    if ((await modal.done) === 'ok' && chosen) await KS.suite.run('Effet · ' + chosen.title, () => addEffect(chosen.key));
  }
  async function pickAmbiance() {
    const all = status?.presets || [];
    let search = '', chosen = null;
    const list = h('div.an-pick-list'), info = h('div.an-pick-info');
    const fill = () => {
      list.replaceChildren();
      const q = norm(search);
      for (const p of all) {
        const vs = p.variants.filter(v => v.supported && (!q || norm(p.title + ' ' + v.label).includes(q)));
        if (!vs.length) continue;
        list.append(h('div.an-pick-group', { text: p.title }));
        for (const v of vs) {
          const on = chosen && chosen.p === p && chosen.v === v;
          const b = h('button.an-pick-item' + (on ? '.on' : ''), h('span', { text: v.label }));
          b.addEventListener('click', () => { chosen = { p, v }; fill(); });
          b.addEventListener('dblclick', () => { chosen = { p, v }; modal.close('ok'); });
          list.append(b);
        }
      }
      info.replaceChildren(chosen ? h('div', h('span.an-kind', { text: chosen.p.title }), h('h3', { text: chosen.v.label }), h('p', { text: chosen.p.description || 'Système de particules fourni avec Wallpaper Engine.' }),
        h('p.an-note', { text: 'L’aperçu imite les particules ; « Tester dans Wallpaper Engine » montre le rendu exact.' })) : h('p.an-note', { text: 'Choisissez une ambiance.' }));
    };
    const input = h('input.field', { placeholder: 'Rechercher (pluie, braises, magie…)', 'aria-label': 'Rechercher une ambiance' });
    input.addEventListener('input', () => { search = input.value; fill(); }); input.addEventListener('keydown', ev => ev.stopPropagation());
    const modal = KS.modal({ title: 'Ajouter une ambiance', width: 760, body: h('div.an-pick', input, h('div.an-pick-cols', list, info)),
      buttons: [{ label: 'Annuler', value: false }, { label: 'Ajouter', primary: true, value: 'ok' }] });
    fill(); setTimeout(() => input.focus(), 0);
    if ((await modal.done) === 'ok' && chosen) await KS.suite.run('Ambiance · ' + chosen.p.title, () => addAmbiance(chosen.p.folder, chosen.v.index));
  }

  /* ---------------------------------------------------------------- interface */
  function ensureEngine() { if (!engine) engine = KS.animerGL(canvas); }
  function renderBar() {
    if (!bar) return;
    const has = !!P();
    titleEl.textContent = has ? P().title : 'Aucune animation ouverte'; titleEl.title = has ? 'Renommer l’animation' : '';
    playBtn.hidden = !has; playBtn.innerHTML = KS.icon(playing ? 'pause' : 'play'); playBtn.dataset.tip = playing ? 'Pause (P)' : 'Lecture (P)';
    testBtn.disabled = sendBtn.disabled = !has || !status?.engine;
    testBtn.title = status?.engine ? 'Ouvre la scène dans une fenêtre de Wallpaper Engine, sans changer le fond du bureau' : 'Wallpaper Engine est introuvable';
  }
  function row({ on, off, label, sub, todo, eye, onEye, onClick, extra = [] }) {
    const el = h('div.an-row' + (on ? '.on' : '') + (off ? '.off' : ''), { role: 'button', tabIndex: 0 },
      eye ? ui.iconBtn(off ? 'lock' : 'eye', off ? 'Afficher' : 'Masquer', ev => { ev.stopPropagation(); onEye(); }) : h('span.an-row-pad'),
      h('div.an-row-t', h('b', { text: label }), sub ? h('small' + (todo ? '.todo' : ''), { text: sub }) : null), ...extra);
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target === el) onClick(); });
    return el;
  }
  function renderLeft() {
    if (!left) return;
    if (!P()) { left.replaceChildren(); return; }
    const tabs = ui.seg([['layers', 'Couches'], ['scene', 'Scène']], leftTab, v => { leftTab = v; renderLeft(); });
    tabs.classList.add('an-tabs');
    const body = [];
    if (leftTab === 'layers') {
      body.push(ui.btn('Ajouter une ambiance', () => { if (!status?.engine) { KS.toast('Les ambiances viennent des préréglages de Wallpaper Engine : installez-le avec Steam.', 'err', 6000); return; } pickAmbiance().catch(e => KS.toast(e.message, 'err')); }, '.small.an-add', 'plus'));
      const list = h('div.an-list');
      for (const l of P().layers.slice().reverse()) {
        if (l.kind === 'image') {
          const n = l.effects.length;
          list.append(row({ on: sel?.kind === 'layer' && sel.id === l.id, label: l.name || 'Illustration', sub: 'Calque d’image · ' + (n ? n + ' effet' + (n > 1 ? 's' : '') : 'aucun effet'),
            onClick: () => { sel = { kind: 'layer', id: l.id }; if (paint) stopPaint(); render(); } }));
          for (const e of l.effects) {
            const def = defs.get(e.effect), keys = [...masks.keys()].filter(k => parseKey(k)?.effect === e.id);
            const needs = (def?.textures || []).some(t => t.mode === 'flowmask'), done = keys.some(k => painted.get(k));
            const sub = !def ? e.effect : needs && !done ? 'Direction à peindre' : keys.length && !done ? 'Masque vide' : keys.length ? def.title + ' · masque' : def.title;
            const r = row({ on: sel?.kind === 'effect' && sel.id === e.id, off: e.visible === false, label: e.name, sub, todo: (needs || keys.length) && !done, eye: true,
              onEye: () => { e.visible = e.visible === false; syncEngine(); renderLeft(); changed(); }, onClick: () => { sel = { kind: 'effect', id: e.id }; if (paint && parseKey(paint.key).effect !== e.id) stopPaint(); render(); } });
            r.classList.add('an-sub'); list.append(r);
          }
        } else {
          list.append(row({ on: sel?.kind === 'layer' && sel.id === l.id, off: l.visible === false, label: l.name, sub: 'Ambiance · particules', eye: true,
            onEye: () => { l.visible = l.visible === false; syncEngine(); renderLeft(); changed(); }, onClick: () => { sel = { kind: 'layer', id: l.id }; if (paint) stopPaint(); render(); },
            extra: [ui.iconBtn('trash', 'Supprimer l’ambiance', ev => { ev.stopPropagation(); removeLayer(l.id); }, '.an-del')] }));
        }
      }
      body.push(list, h('p.an-note.an-order', { text: 'Les effets s’appliquent de haut en bas, comme dans Wallpaper Engine ; les ambiances passent devant l’image.' }));
    } else {
      const b = P().bloom;
      body.push(h('div.an-sec', h('b', { text: 'Halo lumineux' })),
        h('p.an-help', { text: 'Les zones les plus claires de l’image et des particules rayonnent, comme le « bloom » des options de scène de Wallpaper Engine.' }),
        ui.check('Allumé', b.on, v => { b.on = v; syncEngine(); changed(); }),
        ui.paramRow({ label: 'Force', min: 0, max: 4, step: 0.05 }, b.strength ?? 0.8, v => { b.strength = v; syncEngine(); changed(); }),
        ui.paramRow({ label: 'Seuil', min: 0, max: 0.99, step: 0.01 }, b.threshold ?? 0.65, v => { b.threshold = v; syncEngine(); changed(); }),
        h('div.an-sec', h('b', { text: 'Raccourcis' })),
        h('p.an-note', { text: 'Molette : zoom · Espace ou clic droit + glisser : déplacer · 0 : ajuster · P : lecture. En peinture : B pinceau, E gomme, [ ] ou Maj + molette : taille, M : voir la zone, Échap : terminer, Ctrl+Z : annuler.' }));
    }
    left.replaceChildren(tabs, h('div.an-left-body', body));
  }
  function textureRow(e, t) {
    const key = maskKey(e.id, t.pass, t.index), paintable = t.mode === 'opacitymask' || t.mode === 'flowmask' || t.mode === 'depth';
    const th = h('canvas.an-thumb', { width: 96, height: Math.max(24, Math.round(96 * S.H / S.W)) });
    thumbs.set(key, th); drawThumb(key);
    const has = masks.has(key), label = t.label || MODES[t.mode] || 'Texture', actions = [];
    if (paintable) {
      const painting = paint?.key === key;
      if (t.mode !== 'depth') actions.push(ui.btn(painting ? 'Terminer' : 'Peindre', () => painting ? stopPaint() : startPaint(key), '.small' + (painting ? '.primary' : ''), 'brush'));
      if (t.mode !== 'depth') actions.push(ui.btn('Retouche', () => A.editInRetouche(key).catch(err => KS.toast(err.message, 'err')), '.small', 'image'));
      actions.push(ui.btn('Auto', ev => {
        const r = ev.currentTarget.getBoundingClientRect();
        const z = (fn, title) => KS.suite.run(title, async () => applyZone(key, await fn(), label)).catch(() => {});
        ui.menu([
          t.mode === 'depth' ? { label: 'Profondeur (IA)', icon: 'sparkles', action: () => KS.suite.run('Profondeur par IA', async () => replaceMask(key, await depthMask())).catch(() => {}) } : null,
          { label: 'Sujet (IA)', icon: 'sparkles', action: () => z(subjectMask, 'Sujet par IA') },
          { label: 'Partie détectée (Studio IA)', icon: 'sparkles', sub: PARTS.map(([k, l]) => ({ label: l, action: () => z(() => partMask(k, l), l + ' par IA') })) },
          { label: 'Arrière-plan (IA)', action: () => z(async () => { const g = await subjectMask(), x = g.getContext('2d'); x.globalCompositeOperation = 'difference'; x.fillStyle = '#fff'; x.fillRect(0, 0, g.width, g.height); return g; }, 'Arrière-plan par IA') },
          { sep: true },
          { label: 'Tout', action: () => z(async () => blankMask(false, true), 'Masque plein') },
          { label: 'Rien', action: () => replaceMask(key, blankMask(t.mode === 'flowmask', false)) },
          { label: 'Inverser', disabled: !has || t.mode === 'flowmask', action: () => { const c = U.copyCanvas(masks.get(key)), x = c.getContext('2d'); x.globalCompositeOperation = 'difference'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); replaceMask(key, c); } },
        ].filter(Boolean), r.left, r.bottom + 4);
      }, '.small', 'sparkles'));
      if (has) actions.push(ui.iconBtn('trash', 'Retirer ce masque (l’effet agit alors partout)', () => { pushUndo(key); engine.dropMask(key); masks.delete(key); painted.delete(key); dirtyMasks.add(key); if (paint?.key === key) stopPaint(); syncEngine(); renderRight(); renderLeft(); changed(key); }));
    }
    const note = !paintable ? (t.default ? 'Texture fournie : ' + t.default : 'Texture non modifiable ici')
      : !has ? (t.mode === 'flowmask' ? 'Glissez le pinceau dans le sens du mouvement.' : t.mode === 'depth' ? 'Auto › Profondeur (IA) calcule la carte.' : 'Sans masque, l’effet agit sur tout le calque.')
      : painted.get(key) ? '' : 'Masque vide : l’effet n’agit nulle part.';
    return h('div.an-tex', th, h('div.an-tex-r', h('b', { text: label }), note ? h('small', { text: note }) : null, h('div.an-tex-a', actions)));
  }
  function renderRight() {
    if (!right) return;
    thumbs.clear();
    if (!P()) { right.replaceChildren(); return; }
    const body = [];
    const L = sel?.kind === 'layer' ? layerOf(sel.id) : null, e = sel?.kind === 'effect' ? effectOf(sel.id) : null;
    if (e) {
      const def = defs.get(e.effect);
      body.push(h('div.an-crumb', h('button', { text: imageLayer().name || 'Calque', on: { click: () => { sel = { kind: 'layer', id: imageLayer().id }; if (paint) stopPaint(); render(); } } }), h('span', { text: '›' }), h('b', { text: def?.title || e.effect })));
      const name = h('input.field.an-name', { value: e.name, maxLength: 60, 'aria-label': 'Nom de l’effet' });
      name.addEventListener('change', () => { e.name = name.value.trim() || def?.title || e.effect; renderLeft(); changed(); });
      name.addEventListener('keydown', ev => ev.stopPropagation());
      body.push(h('div.an-head-row', name, ui.iconBtn(e.visible === false ? 'lock' : 'eye', e.visible === false ? 'Afficher' : 'Masquer', () => { e.visible = e.visible === false; syncEngine(); render(); changed(); }),
        ui.iconBtn('trash', 'Supprimer l’effet', () => removeEffect(e.id))));
      if (def?.description) body.push(h('p.an-help', { text: def.description }));
      if (engine?.errors.get(e.effect)) body.push(h('p.an-warn', { text: 'Cet effet ne peut pas être montré dans l’aperçu ; il fonctionnera dans Wallpaper Engine (bouton Tester).' }));
      if (!def) body.push(h('p.an-warn', { text: 'Définition de l’effet indisponible (Wallpaper Engine introuvable ?).' }));
      else {
        const combos = def.combos.filter(c => !/^AUDIO/.test(c.combo) && requireOk(c.require, e, def));
        if (combos.length) {
          body.push(h('div.an-sec', h('b', { text: 'Options' })));
          for (const c of combos) {
            const cur = e.combos[c.combo] ?? c.default;
            if (c.options) body.push(ui.paramRow({ type: 'select', label: c.label, options: c.options.map(o => [String(o.value), o.label]) }, String(cur), v => { e.combos[c.combo] = +v; syncEngine(); renderRight(); changed(); }));
            else body.push(ui.check(c.label, !!cur, v => { e.combos[c.combo] = v ? 1 : 0; syncEngine(); renderRight(); changed(); }));
          }
        }
        const tex = def.textures.filter(t => requireOk(t.require, e, def) && t.mode);
        if (tex.length) { body.push(h('div.an-sec', h('b', { text: 'Textures' }))); for (const t of tex) body.push(textureRow(e, t)); }
        // comme l'éditeur de Wallpaper Engine : seulement les réglages employés par la variante choisie (Mode UV / Sommets…)
        const active = engine?.activeMaterials({ id: e.id, def, values: e.values, combos: e.combos });
        const params = def.params.filter(p => !p.hidden && requireOk(p.require, e, def) && (!active || active.has(p.material)));
        if (params.length) {
          body.push(h('div.an-sec', h('b', { text: 'Réglages' })));
          let group = '';
          for (const p of params) { if (p.group && p.group !== group) { group = p.group; body.push(h('div.an-group', { text: group })); } body.push(paramWidget(e, p)); }
        }
        body.push(h('div.an-actions', ui.btn('Réglages d’origine', () => { e.values = {}; e.combos = {}; syncEngine(); renderRight(); changed(); }, '.small'),
          ui.btn('Monter', () => moveEffect(e.id, -1), '.small'), ui.btn('Descendre', () => moveEffect(e.id, 1), '.small')));
      }
    } else if (L?.kind === 'image') {
      const name = h('input.field.an-name', { value: L.name || '', maxLength: 60, 'aria-label': 'Nom du calque' });
      name.addEventListener('change', () => { L.name = name.value.trim() || 'Illustration'; renderLeft(); changed(); });
      name.addEventListener('keydown', ev => ev.stopPropagation());
      body.push(h('div.an-head', h('span.an-kind', { text: 'Calque d’image' }), name, h('small.an-dim', { text: S.W + ' × ' + S.H + ' px' })));
      const list = h('div.an-list');
      L.effects.forEach((ef, i) => {
        const def = defs.get(ef.effect);
        list.append(row({ off: ef.visible === false, label: ef.name, sub: def?.title || ef.effect, eye: true,
          onEye: () => { ef.visible = ef.visible === false; syncEngine(); render(); changed(); }, onClick: () => { sel = { kind: 'effect', id: ef.id }; render(); },
          extra: [ui.iconBtn('chevron-down', 'Descendre', ev => { ev.stopPropagation(); moveEffect(ef.id, 1); }, i === L.effects.length - 1 ? '.an-hide' : ''), ui.iconBtn('trash', 'Supprimer', ev => { ev.stopPropagation(); removeEffect(ef.id); }, '.an-del')] }));
      });
      body.push(h('div.an-sec', h('b', { text: 'Effets' }), ui.btn('Ajouter', () => { if (!status?.engine) { KS.toast('Les effets viennent de Wallpaper Engine : installez-le avec Steam.', 'err', 6000); return; } pickEffect().catch(err => KS.toast(err.message, 'err')); }, '.small.primary', 'plus')),
        L.effects.length ? list : h('p.an-note', { text: 'Ajoutez un effet (Oscillation Feuillage pour les cheveux, Secousse pour la respiration, À impulsion pour une lueur…), puis peignez son masque.' }));
    } else if (L?.kind === 'particle') {
      const v = variants.get(vkey(L)), preset = (status?.presets || []).find(p => p.folder === L.folder);
      body.push(h('div.an-head', h('span.an-kind', { text: 'Ambiance' }), h('b', { text: v ? v.title : L.folder })));
      if (preset && preset.variants.filter(x => x.supported).length > 1)
        body.push(ui.paramRow({ type: 'select', label: 'Variante', options: preset.variants.filter(x => x.supported).map(x => [String(x.index), x.label]) }, String(L.variant), async val => {
          await KS.suite.run('Ambiance', async () => { await needVariant(L.folder, +val); L.variant = +val; const nv = variants.get(vkey(L)); L.name = nv.label === nv.title ? nv.title : nv.title + ' · ' + nv.label; syncEngine(); render(); changed(); }).catch(() => {});
        }));
      body.push(h('p.an-help', { text: 'Faites glisser la poignée sur l’image pour placer l’ambiance. L’aperçu imite les particules de Wallpaper Engine ; « Tester » montre le rendu exact.' }));
      const base = Math.max(0.5, Math.min(4, S.H / 1080));
      body.push(h('div.an-sec', h('b', { text: 'Placement' })),
        ui.paramRow({ label: 'Position X', min: -S.W, max: 2 * S.W, step: 1 }, L.x, val => { L.x = val; syncEngine(); changed(); }),
        ui.paramRow({ label: 'Position Y', min: -S.H, max: 2 * S.H, step: 1 }, L.y, val => { L.y = val; syncEngine(); changed(); }),
        ui.paramRow({ label: 'Échelle', unit: '%', min: 10, max: 400, step: 1 }, Math.round(L.scale / base * 100), val => { L.scale = +(val / 100 * base).toFixed(4); syncEngine(); changed(); }),
        dial((L.angle || 0) * Math.PI / 180, val => { L.angle = +(val * 180 / Math.PI).toFixed(2); syncEngine(); changed(); }, 'Angle'),
        h('div.an-sec', h('b', { text: 'Particules' })));
      for (const def of OVERRIDES) body.push(ui.paramRow({ label: def.label, min: def.min, max: def.max, step: def.step }, L.overrides[def.key] ?? 1, val => { L.overrides[def.key] = val; syncEngine(); changed(); }));
      body.push(ui.paramRow({ type: 'color', label: 'Couleur' }, L.overrides.couleur || '#ffffff', val => { L.overrides.couleur = val; syncEngine(); changed(); }));
      body.push(h('div.an-actions', ui.btn('Recentrer', () => { L.x = Math.round(S.W / 2); L.y = Math.round(S.H / 2); syncEngine(); renderRight(); changed(); }, '.small'),
        ui.btn('Réglages d’origine', () => { L.overrides = {}; L.scale = base; L.angle = 0; syncEngine(); renderRight(); changed(); }, '.small'),
        ui.btn('Supprimer', () => removeLayer(L.id), '.small', 'trash')));
    }
    right.replaceChildren(h('div.an-right-h', { text: 'Propriétés' }), h('div.an-right-body', body));
  }
  function renderPaintBar() {
    if (!paintBar) return;
    paintBar.hidden = !paint;
    if (!paint) return;
    const slot = slotOf(paint.key), e = effectOf(parseKey(paint.key).effect), flow = slot?.mode === 'flowmask';
    const seg = ui.seg([['paint', 'brush', 'Pinceau (B)'], ['erase', 'eraser', 'Gomme (E)']], tool, v => { tool = v; });
    const size = ui.scrub({ label: 'Taille', value: Math.round(brush.size), min: 2, max: 1200, step: 1, unit: 'px', width: 44, onInput: v => { brush.size = v; } });
    const inten = ui.scrub({ label: flow ? 'Force' : 'Intensité', value: Math.round(brush.intensity * 100), min: 1, max: 100, step: 1, unit: '%', width: 36, onInput: v => { brush.intensity = v / 100; } });
    const hard = ui.scrub({ label: 'Dureté', value: Math.round(brush.hardness * 100), min: 0, max: 95, step: 1, unit: '%', width: 36, onInput: v => { brush.hardness = v / 100; } });
    const see = ui.btn('Voir la zone', () => { overlayOn = !overlayOn; renderPaintBar(); kick(); }, '.small' + (overlayOn ? '.on' : ''), 'mask'); see.title = 'Montrer le masque peint (M)';
    paintBar.replaceChildren(...[h('b.an-pb-t', { text: (e?.name || '') + ' · ' + (slot?.label || 'Masque') }), seg, size, inten, hard, see,
      flow ? h('span.an-pb-tip', { text: 'Glissez dans le sens du mouvement' }) : null, ui.btn('Terminé', () => stopPaint(), '.small.primary', 'check')].filter(Boolean));
  }
  async function renderEmpty() {
    if (!emptyBox) return;
    emptyBox.hidden = !!P(); if (P()) return;
    const recent = h('div.an-recent');
    const intro = h('div.an-intro',
      h('div.an-icon', { html: KS.icon('sparkles') }), h('h2', { text: 'Animer une image' }),
      h('p', { text: 'Les effets de Wallpaper Engine (Oscillation Feuillage, Secousse, Vagues d’eau, À impulsion, Rayons divins…) et ses ambiances, avec un aperçu fidèle en direct. Masques au pinceau, dans Retouche (sélection rapide, Sujet) ou par IA.' }),
      h('div.an-start', ui.btn('Ouvrir une image…', () => KS.suite.run('Ouverture de l’image dans Animer', () => A.openFile()).catch(() => {}), '.primary', 'folder-open'),
        ui.btn('Utiliser le document de Retouche', () => KS.suite.run('Animer le document', () => A.openDocument()).catch(() => {}), '', 'image')),
      status && !status.engine ? h('p.an-warn', { text: 'Wallpaper Engine est introuvable : effets, ambiances et envoi demandent Wallpaper Engine (Steam).' }) : null,
      recent);
    emptyBox.replaceChildren(intro);
    try {
      const list = await call('list');
      if (list.length) recent.replaceChildren(h('b', { text: 'Vos animations' }), h('div.an-grid', list.slice(0, 24).map(p => {
        const b = h('button.an-card', { title: p.title }, p.thumb ? h('img', { src: 'kcm://f/' + encodeURIComponent(p.thumb) + '?t=' + encodeURIComponent(p.updated || ''), alt: '' }) : h('div.an-noimg'), h('span', { text: p.title }));
        b.addEventListener('click', () => KS.suite.run('Ouverture de l’animation', () => A.load(p.id)).catch(() => {}));
        b.addEventListener('contextmenu', ev => { ev.preventDefault(); ui.menu([{ label: 'Ouvrir', action: () => KS.suite.run('Ouverture de l’animation', () => A.load(p.id)).catch(() => {}) },
          { label: 'Afficher le dossier', action: () => call('reveal', { id: p.id }) }, { sep: true },
          { label: 'Supprimer…', icon: 'trash', action: async () => { if (await KS.confirm('Supprimer l’animation « ' + p.title + ' » ? Ses masques et réglages seront effacés (la scène déjà envoyée reste dans Wallpaper Engine).', { title: 'Animer', ok: 'Supprimer', danger: true })) { await call('remove', { id: p.id }); renderEmpty(); } } }], ev.clientX, ev.clientY); });
        return b;
      })));
    } catch { /* liste indisponible */ }
  }
  function render() { renderBar(); renderLeft(); renderRight(); renderPaintBar(); renderEmpty(); kick(); }

  function build(container) {
    titleEl = h('button.an-title');
    titleEl.addEventListener('click', async () => {
      if (!P()) return;
      const input = h('input.field', { value: P().title, maxLength: 80, style: { width: '340px' } });
      const ok = await KS.modal({ title: 'Nom de l’animation', body: input, buttons: [{ label: 'Annuler', value: false }, { label: 'Renommer', primary: true, value: true }] }).done;
      if (ok && input.value.trim()) { P().title = input.value.trim(); renderBar(); changed(); }
    });
    playBtn = ui.iconBtn('pause', 'Pause (P)', () => { playing = !playing; renderBar(); kick(); });
    testBtn = ui.btn('Tester dans Wallpaper Engine', () => KS.suite.run('Essai dans Wallpaper Engine', () => send('test')).catch(() => {}), '.small', 'play');
    sendBtn = ui.btn('Envoyer vers Wallpaper Engine', ev => {
      const r = ev.currentTarget.getBoundingClientRect();
      ui.menu([
        { label: 'Envoyer (ajouter à mes fonds)', icon: 'export', action: () => KS.suite.run('Envoi vers Wallpaper Engine', () => send()).catch(() => {}) },
        { label: 'Envoyer et appliquer comme fond d’écran', icon: 'image', action: () => KS.suite.run('Fond d’écran Wallpaper Engine', () => send('apply')).catch(() => {}) },
        { sep: true },
        { label: 'Ouvrir le dossier de la scène', disabled: !P()?.we, action: () => call('reveal', { we: P().we.name }) },
        { label: 'Ouvrir le dossier de l’animation', action: () => call('reveal', { id: A.id }) },
      ], r.left, r.bottom + 4);
    }, '.small.primary', 'export');
    bar = h('div.an-bar', h('div.an-brand', { html: KS.icon('sparkles') }), h('b', { text: 'Animer' }), titleEl,
      ui.btn('Ouvrir une image…', () => KS.suite.run('Ouverture de l’image dans Animer', () => A.openFile()).catch(() => {}), '.small', 'folder-open'),
      ui.btn('Depuis Retouche', () => KS.suite.run('Animer le document', () => A.openDocument()).catch(() => {}), '.small', 'image'),
      ui.btn('Mes animations', () => A.close(), '.small', 'grid'),
      h('div.spacer'), playBtn, testBtn, sendBtn);
    canvas = h('canvas.an-canvas');
    brushRing = h('div.an-ring', { hidden: true });
    handle = h('div.an-handle', { hidden: true, title: 'Faire glisser pour placer l’ambiance' });
    paintBar = h('div.an-paintbar', { hidden: true });
    emptyBox = h('div.an-empty');
    stage = h('div.an-stage', canvas, brushRing, handle, paintBar, emptyBox);
    left = h('aside.an-left'); right = h('aside.an-right');
    root = h('div.an-root', bar, h('div.an-body', left, stage, right));
    container.replaceChildren(root);
    banner = h('div.an-banner', { hidden: true }); document.body.append(banner);
    KS.on('doc', renderBanner); KS.on('studio', renderBanner);
    try { ensureEngine(); } catch (e) { emptyBox.replaceChildren(h('p.an-warn', { text: e.message })); }
    bindStage();
    new ResizeObserver(() => { resize(); kick(); }).observe(stage);
    const themeObs = new MutationObserver(() => { clear = null; kick(); renderBanner(); });
    themeObs.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  // monté dans l'espace « Animer » de workspaces.js
  A.mount = async container => {
    if (!root) build(container);
    if (!status) { try { status = await call('status'); } catch { status = { engine: null, effects: [], presets: [] }; } }
    render();
  };
  A.show = on => {
    visible = !!on;
    if (visible) { resize(); kick(); } else if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!on) A.flush().catch(() => {});
    setTimeout(renderBanner, 0);
  };
  A.debug = {
    masks, defs, variants, brush, get engine() { return engine; }, get time() { return time; }, set time(v) { time = v; }, set playing(v) { playing = v; },
    get sel() { return sel; }, select: s => { sel = s; render(); }, addEffect, addAmbiance, send, view: () => view, startPaint, stopPaint, ensureMask, maskKey, replaceMask, flowFromGray, returnFromRetouche, pickEffect, pickAmbiance,
    paint: (key, pts, t = 'paint') => { tool = t; const fresh = !masks.has(key); pushUndo(key); ensureMask(key); if (fresh) syncEngine(); stroke = { key, last: pts[0], dir: null, flow: isFlow(key) }; if (!stroke.flow) paintTo(pts[0]); for (const p of pts.slice(1)) paintTo(p); endStroke(); },
  };
})();

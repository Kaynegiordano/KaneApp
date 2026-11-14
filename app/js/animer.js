// Atelier Animer : on peint sur l'image ce qui bouge (comme dans l'éditeur de Wallpaper Engine), l'aperçu joue tout de
// suite les effets de Wallpaper Engine, puis « Envoyer » écrit une vraie scène dans ses projets. Pas de calcul long :
// tout est dans la page (WebGL), le processus principal n'enregistre que les fichiers (animer-host.cjs).
'use strict';
(() => {
  const h = KS.h, ui = KS.ui, N = KS.native, U = KS.util;
  if (!N?.animerCall) return;
  const TAU = Math.PI * 2;
  const call = async (op, args) => { const r = await N.animerCall(op, args); if (!r.ok) throw new Error(r.error); return r.value; };
  const MASK_MAX = 2048, IMAGE_MAX = 4096;

  /* ---------------------------------------------------------------- mouvements */
  // période (s) ↔ vitesse des effets de Wallpaper Engine (une oscillation = 2π / vitesse)
  const period = { get: v => TAU / v, set: s => TAU / s };
  const TYPES = {
    respiration: { label: 'Respiration', flow: true, icon: 'sliders',
      help: 'Faites glisser le pinceau dans le sens du mouvement : vers le haut sur la poitrine et les épaules, un peu sur la tête. Repasser renforce, la gomme calme.',
      defaults: S => ({ vitesse: TAU / 4.5, force: Math.sqrt(10 / Math.min(S.W, S.H)), douceur: 1, irregulier: false }) },
    ondulation: { label: 'Cheveux et tissus', icon: 'brush',
      help: 'Peignez les mèches, la tresse, le voile ou le tissu qui flotte. Tournez la direction dans le sens où pendent les cheveux.',
      defaults: () => ({ vitesse: 1.5, echelle: 12, force: 0.1, direction: 0, exposant: 1 }) },
    lueur: { label: 'Lueur', icon: 'sun',
      help: 'Peignez ce qui s’allume et s’éteint doucement : yeux, bijoux, magie, lanternes. Choisissez la couleur de la lueur.',
      defaults: () => ({ vitesse: 1, force: 1, couleur: '#ffffff', phase: 0 }) },
    regard: { label: 'Regard', icon: 'eye',
      help: 'Peignez les iris et le blanc des yeux, sans les cils ni les paupières : les yeux regardent un peu ailleurs puis reviennent.',
      defaults: () => ({ force: 1.5, vitesse: 0.8, douceur: 0.2, flottement: 0.4 }) },
    clignement: { label: 'Clignement', icon: 'eye',
      help: 'Peignez l’œil ouvert, entre les cils du haut et ceux du bas : la paupière descend dessus de temps en temps. Réglez la hauteur de l’œil. Marche mieux quand il y a de la place entre l’œil et le sourcil.',
      defaults: S => ({ vitesse: TAU / 5, hauteur: Math.max(4, Math.round(S.H * 0.015)), force: Math.sqrt(Math.max(4, Math.round(S.H * 0.015)) / S.H) }) },
  };
  const PARAMS = {
    respiration: S => [
      { key: 'vitesse', label: 'Un souffle toutes les', unit: 's', min: 1.5, max: 12, step: 0.1, to: period.get, from: period.set },
      { key: 'force', label: 'Amplitude', unit: 'px', min: 1, max: 60, step: 0.5, to: v => v * v * Math.min(S.W, S.H), from: px => Math.sqrt(px / Math.min(S.W, S.H)) },
      { key: 'douceur', label: 'Souplesse', min: 0.3, max: 3, step: 0.05 },
      { key: 'irregulier', label: 'Rythme irrégulier', type: 'check' },
    ],
    ondulation: () => [
      { key: 'direction', label: 'Direction', unit: '°', min: 0, max: 359, step: 1, to: r => ((r * 180 / Math.PI) % 360 + 360) % 360, from: d => d * Math.PI / 180, dial: true },
      { key: 'vitesse', label: 'Vitesse', min: 0.1, max: 6, step: 0.05 },
      { key: 'echelle', label: 'Nombre de vagues', min: 2, max: 60, step: 0.5 },
      { key: 'force', label: 'Amplitude', min: 0.02, max: 0.4, step: 0.005 },
      { key: 'exposant', label: 'Forme de la vague', min: 0.51, max: 4, step: 0.01 },
    ],
    lueur: () => [
      { key: 'couleur', label: 'Couleur', type: 'color' },
      { key: 'vitesse', label: 'Une lueur toutes les', unit: 's', min: 0.5, max: 12, step: 0.1, to: period.get, from: period.set },
      { key: 'force', label: 'Intensité', min: 0, max: 2, step: 0.02 },
      { key: 'phase', label: 'Décalage', min: 0, max: 6.28, step: 0.05 },
    ],
    regard: () => [
      { key: 'force', label: 'Amplitude', min: 0.2, max: 6, step: 0.05 },
      { key: 'vitesse', label: 'Un coup d’œil toutes les', unit: 's', min: 0.5, max: 6, step: 0.05, to: v => 1 / v, from: s => 1 / s },
      { key: 'douceur', label: 'Transition', min: 0.05, max: 1, step: 0.01 },
      { key: 'flottement', label: 'Flottement', min: 0, max: 1.5, step: 0.02 },
    ],
    clignement: S => [
      { key: 'hauteur', label: 'Hauteur de l’œil', unit: 'px', min: 2, max: Math.round(S.H * 0.2), step: 1, after: p => { p.force = Math.sqrt(p.hauteur / S.H); } },
      { key: 'vitesse', label: 'Un clignement toutes les', unit: 's', min: 2, max: 12, step: 0.1, to: period.get, from: period.set },
    ],
  };
  const OVERRIDES = [
    { key: 'rate', label: 'Quantité', min: 0, max: 4, step: 0.05 },
    { key: 'count', label: 'Nombre maximal', min: 0.1, max: 4, step: 0.05 },
    { key: 'speed', label: 'Vitesse', min: 0, max: 4, step: 0.05 },
    { key: 'size', label: 'Taille', min: 0.1, max: 4, step: 0.05 },
    { key: 'alpha', label: 'Opacité', min: 0, max: 2, step: 0.02 },
    { key: 'lifetime', label: 'Durée de vie', min: 0.2, max: 4, step: 0.05 },
  ];

  /* ---------------------------------------------------------------- état */
  const A = KS.animer = { project: null, id: null };
  let root, stage, canvas, engine, left, right, bar, emptyBox, brushRing, handle, tools, titleEl, playBtn, sendBtn, testBtn;
  let image = null, S = { W: 1, H: 1, mw: 1, mh: 1 };
  const masks = new Map();                     // id du mouvement → toile du masque
  const dirtyMasks = new Set();
  let sel = null, tool = 'paint', overlayOn = true, playing = true, time = 0, last = 0, raf = 0, visible = false;
  let view = { z: 1, x: 0, y: 0 }, fitted = true;
  const brush = { size: 60, intensity: 1, hardness: 0.35 };
  let status = null, ambianceData = new Map(), saveTimer = 0, saving = null, undo = [];

  const uid = () => Math.random().toString(36).slice(2, 9);
  const P = () => A.project;
  const effectOf = id => P()?.effects.find(e => e.id === id);
  const ambOf = id => P()?.ambiances.find(a => a.id === id);

  /* ---------------------------------------------------------------- masques */
  const blankMask = flow => {
    const c = U.canvas(S.mw, S.mh), x = c.getContext('2d', { willReadFrequently: false });
    x.fillStyle = flow ? 'rgb(127,127,0)' : '#000'; x.fillRect(0, 0, S.mw, S.mh); return c;
  };
  async function canvasFromBytes(data) {
    const bmp = await createImageBitmap(new Blob([data]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = U.canvas(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); bmp.close?.(); return c;
  }
  const pngBytes = async c => new Uint8Array(await (await U.blobFromCanvas(c, 'image/png')).arrayBuffer());
  // un mouvement sans rien de peint ne fait rien : la liste le signale (miniature du masque, 64 px)
  const painted = new Map();
  function measure(id) {
    const e = effectOf(id), c = masks.get(id); if (!e || !c) return;
    const t = U.canvas(64, Math.max(1, Math.round(64 * c.height / c.width))), x = t.getContext('2d', { willReadFrequently: true });
    x.drawImage(c, 0, 0, t.width, t.height);
    const d = x.getImageData(0, 0, t.width, t.height).data, flow = TYPES[e.type].flow;
    let on = false; for (let i = 0; i < d.length && !on; i += 4) on = flow ? Math.abs(d[i] - 127) > 3 || Math.abs(d[i + 1] - 127) > 3 : d[i] > 6;
    painted.set(id, on);
  }
  // masque prêt pour Wallpaper Engine : le clignement devient une carte de direction (vers le haut, intensité = masque)
  function exportMask(e) {
    const c = masks.get(e.id);
    if (e.type !== 'clignement') return c;
    const out = U.canvas(c.width, c.height), src = c.getContext('2d').getImageData(0, 0, c.width, c.height), d = src.data;
    for (let i = 0; i < d.length; i += 4) { const m = d[i] / 255; d[i] = 127; d[i + 1] = Math.max(0, Math.min(255, Math.round(127 - m * 127.5))); d[i + 2] = 0; d[i + 3] = 255; }
    out.getContext('2d').putImageData(src, 0, 0); return out;
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
  const accent = () => { const c = U.parseHex(getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#e05570'); return [c.r / 255, c.g / 255, c.b / 255]; };
  let tint = [1, 0.3, 0.45];
  function frame(now) {
    raf = 0;
    if (!visible || !engine || !P()) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
    if (playing) { time += dt; engine.step(dt); }
    const dpr = window.devicePixelRatio || 1;
    const e = sel?.kind === 'effect' ? effectOf(sel.id) : null;
    engine.present(time, { x: view.x * dpr, y: view.y * dpr, w: S.W * view.z * dpr, h: S.H * view.z * dpr },
      e && overlayOn ? { id: e.id, flow: !!TYPES[e.type].flow, tint, opacity: playing ? 0.4 : 0.55 } : null, clearColor());
    placeHandle();
    raf = requestAnimationFrame(frame);
  }
  let clear = null;
  const clearColor = () => clear || (clear = (() => { const c = U.parseHex(getComputedStyle(document.body).getPropertyValue('--workspace').trim() || '#0e1013'); return [c.r / 255, c.g / 255, c.b / 255]; })());
  const kick = () => { if (!raf && visible) { last = 0; raf = requestAnimationFrame(frame); } };

  /* ---------------------------------------------------------------- moteur */
  function syncEngine() {
    if (!engine || !P()) return;
    engine.setEffects(P().effects.map(e => ({ id: e.id, type: e.type, visible: e.visible !== false, params: e.params })));
    engine.setBloom(P().bloom || {});
    engine.setAmbiances(P().ambiances.filter(a => ambianceData.has(a.key)).map(a => ({ id: a.id, key: a.key, visible: a.visible !== false, x: a.x, y: a.y, scale: a.scale, overrides: a.overrides, data: ambianceData.get(a.key) })));
    kick();
  }
  async function loadAmbiance(key) {
    if (ambianceData.has(key)) return ambianceData.get(key);
    const d = await call('ambiance', { key }); ambianceData.set(key, d); return d;
  }

  /* ---------------------------------------------------------------- enregistrement */
  function changed(maskId) { if (maskId) dirtyMasks.add(maskId); clearTimeout(saveTimer); saveTimer = setTimeout(() => A.flush().catch(e => KS.toast('Enregistrement d’Animer : ' + e.message, 'err', 6000)), 1200); }
  A.flush = async () => {
    clearTimeout(saveTimer); saveTimer = 0;
    if (!A.id || !P()) return;
    if (saving) await saving.catch(() => {});
    const ids = [...dirtyMasks]; dirtyMasks.clear();
    saving = (async () => {
      const out = {};
      for (const id of ids) if (masks.has(id) && effectOf(id)) out[id] = await pngBytes(masks.get(id));
      const t = engine?.snapshot(time, 320, Math.max(1, Math.round(320 * S.H / S.W)));
      await call('save', { id: A.id, project: P(), masks: out, thumb: t ? new Uint8Array(await (await U.blobFromCanvas(t, 'image/jpeg', 0.82)).arrayBuffer()) : null });
    })();
    try { await saving; } catch (e) { ids.forEach(id => dirtyMasks.add(id)); throw e; } finally { saving = null; }
  };

  /* ---------------------------------------------------------------- ouverture */
  async function setImage(c) {
    image = c; S.W = c.width; S.H = c.height;
    const k = Math.min(1, MASK_MAX / Math.max(S.W, S.H)); S.mw = Math.max(1, Math.round(S.W * k)); S.mh = Math.max(1, Math.round(S.H * k));
    engine.setImage(c, S.W, S.H);
  }
  async function start(project, id, img, maskBytes = {}) {
    for (const k of masks.keys()) engine?.dropMask(k);
    masks.clear(); painted.clear(); dirtyMasks.clear(); undo = []; sel = null;
    A.project = project; A.id = id; time = 0;
    ensureEngine(); await setImage(img);
    for (const e of project.effects) {
      let c = maskBytes[e.id] ? await canvasFromBytes(maskBytes[e.id]) : blankMask(TYPES[e.type]?.flow);
      if (c.width !== S.mw || c.height !== S.mh) { const r = U.canvas(S.mw, S.mh); r.getContext('2d').drawImage(c, 0, 0, S.mw, S.mh); c = r; }
      masks.set(e.id, c); engine.setMask(e.id, c); measure(e.id);
    }
    for (const a of project.ambiances) await loadAmbiance(a.key).catch(e => KS.toast(e.message, 'err', 6000));
    fitted = true; resize(); syncEngine();
    sel = project.effects[0] ? { kind: 'effect', id: project.effects[0].id } : null;
    render(); KS.ws?.sync?.();
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
    const project = { version: 1, title, width: c.width, height: c.height, effects: [], ambiances: [], bloom: { on: false, strength: 0.8, threshold: 0.65 }, created: new Date().toISOString() };
    await start(project, id, c);
    await A.flush();
  };
  A.openBytes = async (data, name) => A.openCanvas(await canvasFromBytes(data), name);
  A.openFile = async () => {
    const files = await N.openDialog({ filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }], multi: false });
    if (files?.length) await A.openBytes(files[0].data, files[0].name);
  };
  A.openDocument = async () => {
    const d = KS.state.doc; if (!d) throw new Error('Ouvrez une illustration dans Retouche');
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
    masks.clear(); A.project = null; A.id = null; sel = null; render(); KS.ws?.sync?.();
  };

  /* ---------------------------------------------------------------- ajout, retrait */
  const nameFor = (base, list) => { const n = list.filter(x => (x.name || '').startsWith(base)).length; return n ? base + ' ' + (n + 1) : base; };
  function addEffect(type) {
    const T = TYPES[type], e = { id: 'm' + uid(), type, name: nameFor(T.label, P().effects), visible: true, params: T.defaults(S) };
    P().effects.push(e);
    const c = blankMask(T.flow); masks.set(e.id, c); engine.setMask(e.id, c);
    sel = { kind: 'effect', id: e.id }; tool = 'paint'; overlayOn = true;
    syncEngine(); render(); changed(e.id);
  }
  async function addAmbiance(key) {
    const d = await loadAmbiance(key);
    const a = { id: 'a' + uid(), key, name: nameFor(d.label, P().ambiances), visible: true, x: S.W / 2, y: S.H / 2, scale: +(Math.max(0.5, Math.min(4, S.H / 1080))).toFixed(3), overrides: {} };
    P().ambiances.push(a); sel = { kind: 'ambiance', id: a.id };
    syncEngine(); render(); changed();
  }
  function remove(kind, id) {
    if (kind === 'effect') { P().effects = P().effects.filter(e => e.id !== id); engine.dropMask(id); masks.delete(id); }
    else P().ambiances = P().ambiances.filter(a => a.id !== id);
    if (sel?.id === id) sel = null;
    syncEngine(); render(); changed();
  }
  function move(kind, id, delta) {
    const list = kind === 'effect' ? P().effects : P().ambiances, i = list.findIndex(x => x.id === id), j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]]; syncEngine(); render(); changed();
  }

  /* ---------------------------------------------------------------- pinceau */
  let stroke = null;
  function dab(ctx, x, y, r, rgb, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r), c = rgb.join(',');
    g.addColorStop(0, `rgba(${c},${alpha})`); g.addColorStop(Math.min(0.95, brush.hardness), `rgba(${c},${alpha})`); g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  function paintTo(p) {
    const e = effectOf(stroke.id), c = masks.get(stroke.id); if (!e || !c) return;
    const ctx = c.getContext('2d'), k = S.mw / S.W, flow = TYPES[e.type].flow;
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
        // carte en coordonnées de texture : la direction peinte en pixels donne le même déplacement sur les deux axes
        const fx = -stroke.dir[0] / l * m / S.W * f, fy = -stroke.dir[1] / l * m / S.H * f;
        rgb = [Math.round(127.5 + fx * 127.5), Math.round(127.5 + fy * 127.5), 0].map(v => Math.max(0, Math.min(255, v)));
      }
    } else { const v = tool === 'erase' ? 0 : Math.round(255 * brush.intensity); rgb = [v, v, v]; }
    const steps = Math.max(1, Math.ceil(dist * k / spacing));
    for (let i = 1; i <= steps; i++) dab(ctx, (from.x + dx * i / steps) * k, (from.y + dy * i / steps) * k, r, rgb, 0.28);
    stroke.last = p; engine.setMask(stroke.id, c); kick();
  }
  function beginStroke(ev) {
    const e = sel?.kind === 'effect' && effectOf(sel.id); if (!e) return false;
    const c = masks.get(e.id);
    const before = U.canvas(c.width, c.height); before.getContext('2d').drawImage(c, 0, 0);
    undo.push({ id: e.id, c: before }); if (undo.length > 12) undo.shift();
    if (e.visible === false) { e.visible = true; syncEngine(); render(); }
    const p = toImage(ev.clientX, ev.clientY);
    stroke = { id: e.id, last: p, dir: null };
    if (!TYPES[e.type].flow) paintTo(p);
    return true;
  }
  A.undo = () => {
    const u = undo.pop(); if (!u || !masks.has(u.id)) return false;
    const c = masks.get(u.id); const x = c.getContext('2d'); x.globalCompositeOperation = 'copy'; x.drawImage(u.c, 0, 0); x.globalCompositeOperation = 'source-over';
    engine.setMask(u.id, c); changed(u.id); measure(u.id); renderLeft(); kick(); return true;
  };
  function clearMask(id, fill) {
    const e = effectOf(id), c = masks.get(id); if (!e || !c) return;
    const before = U.canvas(c.width, c.height); before.getContext('2d').drawImage(c, 0, 0); undo.push({ id, c: before });
    const x = c.getContext('2d'); x.fillStyle = TYPES[e.type].flow ? 'rgb(127,127,0)' : fill ? '#fff' : '#000'; x.fillRect(0, 0, c.width, c.height);
    engine.setMask(id, c); changed(id); measure(id); renderLeft();
  }

  /* ---------------------------------------------------------------- interactions de la scène */
  function placeHandle() {
    if (!handle) return;
    const a = sel?.kind === 'ambiance' ? ambOf(sel.id) : null;
    handle.hidden = !a;
    if (a) { handle.style.left = (view.x + a.x * view.z) + 'px'; handle.style.top = (view.y + a.y * view.z) + 'px'; }
  }
  function showRing(ev) {
    const e = sel?.kind === 'effect';
    brushRing.hidden = !e || !ev;
    if (!e || !ev) return;
    const r = stage.getBoundingClientRect(), d = brush.size * view.z;
    Object.assign(brushRing.style, { width: d + 'px', height: d + 'px', left: (ev.clientX - r.left - d / 2) + 'px', top: (ev.clientY - r.top - d / 2) + 'px' });
    brushRing.classList.toggle('erase', tool === 'erase');
  }
  function bindStage() {
    let pan = null, drag = null, space = false;
    stage.addEventListener('wheel', ev => {
      if (!P()) return; ev.preventDefault();
      if (ev.altKey || ev.shiftKey) { brush.size = Math.max(2, Math.min(1200, brush.size * (ev.deltaY < 0 ? 1.12 : 1 / 1.12))); renderTools(); showRing(ev); return; }
      const r = stage.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
      const z = Math.max(0.02, Math.min(16, view.z * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)));
      view.x = mx - (mx - view.x) * z / view.z; view.y = my - (my - view.y) * z / view.z; view.z = z; fitted = false; kick();
    }, { passive: false });
    stage.addEventListener('pointerdown', ev => {
      if (!P()) return;
      try { stage.setPointerCapture(ev.pointerId); } catch { /* pointeur déjà relâché */ }
      if (ev.button === 1 || ev.button === 2 || space) { pan = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y }; stage.classList.add('panning'); return; }
      if (ev.button !== 0) return;
      if (ev.target === handle) { const a = ambOf(sel.id); drag = { a, dx: a.x - toImage(ev.clientX, ev.clientY).x, dy: a.y - toImage(ev.clientX, ev.clientY).y }; return; }
      beginStroke(ev);
    });
    stage.addEventListener('pointermove', ev => {
      showRing(ev);
      if (pan) { view.x = pan.vx + ev.clientX - pan.x; view.y = pan.vy + ev.clientY - pan.y; fitted = false; kick(); return; }
      if (drag) { const p = toImage(ev.clientX, ev.clientY); drag.a.x = Math.round(p.x + drag.dx); drag.a.y = Math.round(p.y + drag.dy); syncEngine(); return; }
      if (stroke) for (const pe of ev.getCoalescedEvents?.() || [ev]) paintTo(toImage(pe.clientX, pe.clientY));
    });
    const end = () => {
      if (pan) { pan = null; stage.classList.remove('panning'); }
      if (drag) { drag = null; changed(); renderRight(); }
      if (stroke) { const id = stroke.id; stroke = null; changed(id); const was = painted.get(id); measure(id); if (was !== painted.get(id)) renderLeft(); }
    };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
    stage.addEventListener('pointerleave', () => { brushRing.hidden = true; });
    stage.addEventListener('contextmenu', ev => ev.preventDefault());
    stage.addEventListener('dblclick', ev => { if (ev.target === canvas && !sel) { fit(); kick(); } });
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
      if (k === 'b') { tool = 'paint'; renderTools(); }
      else if (k === 'e') { tool = 'erase'; renderTools(); }
      else if (k === 'm') { overlayOn = !overlayOn; renderTools(); kick(); }
      else if (k === '[' || k === ']') { brush.size = Math.max(2, Math.min(1200, brush.size * (k === ']' ? 1.15 : 1 / 1.15))); renderTools(); }
      else if (k === 'p') { playing = !playing; renderBar(); }
      else if (k === '0') { fit(); kick(); }
      else return;
      ev.preventDefault(); ev.stopPropagation();
    }, true);
    document.addEventListener('keyup', ev => { if (ev.code === 'Space') { space = false; stage?.classList.remove('can-pan'); } });
  }

  /* ---------------------------------------------------------------- Wallpaper Engine */
  async function send(then) {
    if (!P()) return;
    if (!status?.engine) throw new Error('Wallpaper Engine est introuvable. Installez-le avec Steam, puis relancez KaneApp.');
    if (!P().effects.length && !P().ambiances.length) throw new Error('Ajoutez au moins un mouvement ou une ambiance.');
    await A.flush();
    const list = [];
    for (const e of P().effects) list.push(await pngBytes(exportMask(e)));
    const pw = Math.min(1280, S.W), ph = Math.max(1, Math.round(pw * S.H / S.W));
    const prev = engine.snapshot(Math.max(time, 1.5), pw, ph);
    const preview = new Uint8Array(await (await U.blobFromCanvas(prev, 'image/jpeg', 0.88)).arrayBuffer());
    const r = await call('export', { id: A.id, masks: list, preview, then });
    P().we = { name: r.name, date: new Date().toISOString() };
    KS.toast(then === 'test' ? 'Ouverture dans une fenêtre de Wallpaper Engine…' : then === 'apply' ? 'Fond d’écran appliqué : ' + r.title : 'Disponible dans Wallpaper Engine : ' + r.title, 'ok', 5000);
    renderBar();
    return r;
  }

  /* ---------------------------------------------------------------- interface */
  function ensureEngine() {
    if (engine) return;
    engine = KS.animerGL(canvas);
  }
  function renderBar() {
    if (!bar) return;
    const has = !!P();
    titleEl.textContent = has ? P().title : 'Aucune animation ouverte';
    titleEl.title = has ? 'Renommer l’animation' : '';
    playBtn.hidden = !has; playBtn.innerHTML = KS.icon(playing ? 'pause' : 'play'); playBtn.dataset.tip = playing ? 'Pause (P)' : 'Lecture (P)';
    testBtn.disabled = sendBtn.disabled = !has || !status?.engine;
    testBtn.title = status?.engine ? 'Ouvre la scène dans une fenêtre de Wallpaper Engine, sans changer le fond du bureau' : 'Wallpaper Engine est introuvable';
  }
  function row(kind, item, label, sub, todo = false) {
    const on = sel?.kind === kind && sel.id === item.id;
    const eye = ui.iconBtn(item.visible === false ? 'lock' : 'eye', item.visible === false ? 'Afficher' : 'Masquer', ev => { ev.stopPropagation(); item.visible = item.visible === false; syncEngine(); render(); changed(); });
    const del = ui.iconBtn('trash', 'Supprimer', ev => { ev.stopPropagation(); remove(kind, item.id); });
    const up = ui.iconBtn('chevron-down', 'Descendre', ev => { ev.stopPropagation(); move(kind, item.id, 1); }, '.an-down');
    const el = h('div.an-row' + (on ? '.on' : '') + (item.visible === false ? '.off' : ''), { role: 'button', tabIndex: 0 }, eye, h('div.an-row-t', h('b', { text: label }), h('small' + (todo ? '.todo' : ''), { text: sub })), up, del);
    el.addEventListener('click', () => { sel = { kind, id: item.id }; if (kind === 'effect') overlayOn = true; render(); kick(); });
    return el;
  }
  function renderLeft() {
    if (!left) return;
    if (!P()) { left.replaceChildren(); return; }
    const addFx = ui.btn('Ajouter', ev => { const r = ev.currentTarget.getBoundingClientRect(); ui.menu(Object.entries(TYPES).map(([k, T]) => ({ label: T.label, icon: T.icon, action: () => addEffect(k) })), r.left, r.bottom + 4); }, '.small', 'plus');
    const addAmb = ui.btn('Ajouter', ev => {
      const r = ev.currentTarget.getBoundingClientRect();
      if (!status?.engine) { KS.toast('Les ambiances viennent des préréglages de Wallpaper Engine : installez-le avec Steam.', 'err', 6000); return; }
      ui.menu((status.ambiances || []).map(a => ({ label: a.label, action: () => KS.suite.run('Ambiance · ' + a.label, () => addAmbiance(a.key)).catch(() => {}) })), r.left, r.bottom + 4);
    }, '.small', 'plus');
    const fx = P().effects.map(e => row('effect', e, e.name, painted.get(e.id) ? (e.name === TYPES[e.type]?.label ? 'Peint' : TYPES[e.type]?.label) : 'À peindre', !painted.get(e.id)));
    const amb = P().ambiances.map(a => row('ambiance', a, a.name, 'Particules'));
    const b = P().bloom;
    const halo = h('div.an-row' + (sel?.kind === 'bloom' ? '.on' : '') + (b.on ? '' : '.off'), { role: 'button', tabIndex: 0 },
      ui.iconBtn(b.on ? 'eye' : 'lock', b.on ? 'Éteindre le halo' : 'Allumer le halo', ev => { ev.stopPropagation(); b.on = !b.on; syncEngine(); render(); changed(); }),
      h('div.an-row-t', h('b', { text: 'Halo lumineux' }), h('small', { text: b.on ? 'Les zones claires rayonnent' : 'Éteint' })));
    halo.addEventListener('click', () => { sel = { kind: 'bloom' }; render(); });
    left.replaceChildren(
      h('div.an-sec', h('b', { text: 'Mouvements' }), addFx), fx.length ? h('div.an-list', fx) : h('p.an-note', { text: 'Ajoutez un mouvement puis peignez où il agit.' }),
      h('div.an-sec', h('b', { text: 'Ambiance' }), addAmb), amb.length ? h('div.an-list', amb) : h('p.an-note', { text: status?.engine ? 'Braises, feuilles, brume, neige… à placer sur l’image.' : 'Wallpaper Engine introuvable : ambiances indisponibles.' }),
      h('div.an-sec', h('b', { text: 'Lumière' })), h('div.an-list', halo),
      h('p.an-note.an-order', { text: 'Les mouvements s’appliquent dans l’ordre de la liste, comme dans Wallpaper Engine.' }));
  }
  function slider(def, value, onInput) {
    const shown = def.to ? def.to(value) : value;
    const r = ui.paramRow({ label: def.label, unit: def.unit, min: def.min, max: def.max, step: def.step }, +(+shown).toFixed(4), v => onInput(def.from ? def.from(v) : v));
    if (def.dial) { const arrow = h('span.an-arrow', { text: '↓', style: { transform: `rotate(${shown}deg)` } }); r.querySelector('.pl')?.append(arrow); r.arrow = arrow; }
    return r;
  }
  function renderRight() {
    if (!right) return;
    if (!P()) { right.replaceChildren(); return; }
    const body = [];
    if (sel?.kind === 'effect' && effectOf(sel.id)) {
      const e = effectOf(sel.id), T = TYPES[e.type];
      const name = h('input.field.an-name', { value: e.name, maxLength: 60, 'aria-label': 'Nom du mouvement' });
      name.addEventListener('change', () => { e.name = name.value.trim() || T.label; renderLeft(); changed(); });
      name.addEventListener('keydown', ev => ev.stopPropagation());
      body.push(h('div.an-head', h('span.an-kind', { text: T.label }), name), h('p.an-help', { text: T.help }));
      for (const def of PARAMS[e.type](S)) {
        if (def.type === 'check') { body.push(ui.check(def.label, !!e.params[def.key], v => { e.params[def.key] = v; syncEngine(); changed(); })); continue; }
        if (def.type === 'color') { body.push(ui.paramRow({ type: 'color', label: def.label }, e.params[def.key] || '#ffffff', v => { e.params[def.key] = v; syncEngine(); changed(); })); continue; }
        const r = slider(def, e.params[def.key], v => {
          e.params[def.key] = v; def.after?.(e.params);
          if (r.arrow) r.arrow.style.transform = `rotate(${def.to(v)}deg)`;
          syncEngine(); changed();
        });
        body.push(r);
      }
      body.push(h('div.an-actions', ui.btn('Tout effacer', () => clearMask(e.id), '.small', 'eraser'),
        T.flow ? null : ui.btn('Tout remplir', () => clearMask(e.id, true), '.small', 'bucket')));
    } else if (sel?.kind === 'ambiance' && ambOf(sel.id)) {
      const a = ambOf(sel.id), base = Math.max(0.5, Math.min(4, S.H / 1080));
      const name = h('input.field.an-name', { value: a.name, maxLength: 60, 'aria-label': 'Nom de l’ambiance' });
      name.addEventListener('change', () => { a.name = name.value.trim() || a.name; renderLeft(); changed(); });
      name.addEventListener('keydown', ev => ev.stopPropagation());
      body.push(h('div.an-head', h('span.an-kind', { text: 'Ambiance' }), name),
        h('p.an-help', { text: 'Faites glisser la poignée sur l’image pour placer l’ambiance. Les particules sont celles de Wallpaper Engine ; l’aperçu les imite, « Tester » montre le rendu exact.' }));
      body.push(slider({ label: 'Zone', unit: '%', min: 25, max: 400, step: 1, to: s => s / base * 100, from: p => +(p / 100 * base).toFixed(4) }, a.scale, v => { a.scale = v; syncEngine(); changed(); }));
      for (const def of OVERRIDES) body.push(slider(def, a.overrides[def.key] ?? 1, v => { a.overrides[def.key] = v; syncEngine(); changed(); }));
      body.push(ui.paramRow({ type: 'color', label: 'Couleur' }, a.overrides.couleur || '#ffffff', v => { a.overrides.couleur = v; syncEngine(); changed(); }));
      body.push(h('div.an-actions', ui.btn('Recentrer', () => { a.x = S.W / 2; a.y = S.H / 2; syncEngine(); changed(); }, '.small'),
        ui.btn('Réglages d’origine', () => { a.overrides = {}; a.scale = base; syncEngine(); renderRight(); changed(); }, '.small')));
    } else if (sel?.kind === 'bloom') {
      const b = P().bloom;
      body.push(h('div.an-head', h('span.an-kind', { text: 'Lumière' }), h('b', { text: 'Halo lumineux' })),
        h('p.an-help', { text: 'Les zones les plus claires de l’image et des particules rayonnent, comme le « bloom » de Wallpaper Engine.' }),
        ui.check('Allumé', b.on, v => { b.on = v; syncEngine(); renderLeft(); changed(); }),
        slider({ label: 'Force', min: 0, max: 4, step: 0.05 }, b.strength ?? 0.8, v => { b.strength = v; syncEngine(); changed(); }),
        slider({ label: 'Seuil', min: 0, max: 0.99, step: 0.01 }, b.threshold ?? 0.65, v => { b.threshold = v; syncEngine(); changed(); }));
    } else {
      body.push(h('div.an-head', h('span.an-kind', { text: 'Animer' }), h('b', { text: 'Comment faire' })),
        h('ol.an-steps', h('li', { text: 'Ajoutez un mouvement (Respiration, Cheveux et tissus, Lueur…).' }), h('li', { text: 'Peignez sur l’image où il agit : l’aperçu bouge tout de suite.' }),
          h('li', { text: 'Ajoutez une ambiance (braises, feuilles, brume…) et placez-la.' }), h('li', { text: '« Tester » ouvre la vraie scène dans Wallpaper Engine ; « Envoyer » l’ajoute à vos fonds.' })),
        h('p.an-note', { text: 'Molette : zoom · Espace ou clic droit + glisser : déplacer · Maj + molette ou [ ] : taille du pinceau · B pinceau · E gomme · M voir la zone · P lecture · Ctrl+Z annuler.' }));
    }
    right.replaceChildren(...body);
  }
  function renderTools() {
    if (!tools) return;
    const e = sel?.kind === 'effect' ? effectOf(sel.id) : null;
    tools.hidden = !e;
    if (!e) return;
    const seg = ui.seg([['paint', 'brush', 'Pinceau (B)'], ['erase', 'eraser', 'Gomme (E)']], tool, v => { tool = v; });
    const size = ui.scrub({ label: 'Taille', value: Math.round(brush.size), min: 2, max: 1200, step: 1, unit: 'px', width: 44, onInput: v => { brush.size = v; } });
    const flow = TYPES[e.type].flow;
    const inten = ui.scrub({ label: flow ? 'Force' : 'Intensité', value: Math.round(brush.intensity * 100), min: 1, max: 100, step: 1, unit: '%', width: 36, onInput: v => { brush.intensity = v / 100; } });
    const hard = ui.scrub({ label: 'Dureté', value: Math.round(brush.hardness * 100), min: 0, max: 95, step: 1, unit: '%', width: 36, onInput: v => { brush.hardness = v / 100; } });
    const see = ui.btn('Voir la zone', () => { overlayOn = !overlayOn; renderTools(); kick(); }, '.small' + (overlayOn ? '.on' : ''), 'mask');
    see.title = 'Montrer le masque peint (M)';
    tools.replaceChildren(seg, size, inten, hard, see);
  }
  async function renderEmpty() {
    if (!emptyBox) return;
    emptyBox.hidden = !!P(); if (P()) return;
    const recent = h('div.an-recent');
    const intro = h('div.an-intro',
      h('div.an-icon', { html: KS.icon('sparkles') }), h('h2', { text: 'Animer une image' }),
      h('p', { text: 'Peignez ce qui bouge — respiration, cheveux, lueurs, regard — ajoutez une ambiance, et envoyez le tout dans Wallpaper Engine. L’aperçu montre les effets de Wallpaper Engine en direct.' }),
      h('div.an-start', ui.btn('Ouvrir une image…', () => KS.suite.run('Ouverture de l’image dans Animer', () => A.openFile()).catch(() => {}), '.primary', 'folder-open'),
        ui.btn('Utiliser le document de Retouche', () => KS.suite.run('Animer le document', () => A.openDocument()).catch(() => {}), '', 'image')),
      status && !status.engine ? h('p.an-warn', { text: 'Wallpaper Engine est introuvable. Vous pouvez préparer l’animation ; l’envoi et les ambiances demandent Wallpaper Engine (Steam).' }) : null,
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
  function render() { renderBar(); renderLeft(); renderRight(); renderTools(); renderEmpty(); kick(); }

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
    tools = h('div.an-tools', { hidden: true });
    emptyBox = h('div.an-empty');
    stage = h('div.an-stage', canvas, brushRing, handle, tools, emptyBox);
    left = h('aside.an-left'); right = h('aside.an-right');
    root = h('div.an-root', bar, h('div.an-body', left, stage, right));
    container.replaceChildren(root);
    try { ensureEngine(); } catch (e) { emptyBox.replaceChildren(h('p.an-warn', { text: e.message })); }
    bindStage();
    new ResizeObserver(() => { resize(); kick(); }).observe(stage);
    const themeObs = new MutationObserver(() => { clear = null; tint = accent(); kick(); });
    themeObs.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
    tint = accent();
  }

  // monté dans l'espace « Animer » de workspaces.js
  A.mount = async container => {
    if (!root) build(container);
    if (!status) { try { status = await call('status'); } catch (e) { status = { engine: null, ambiances: [] }; } }
    render();
  };
  A.show = on => { visible = !!on; if (visible) { resize(); kick(); } else if (raf) { cancelAnimationFrame(raf); raf = 0; } if (!on) A.flush().catch(() => {}); };
  A.debug = { masks, get engine() { return engine; }, get time() { return time; }, set time(v) { time = v; }, set playing(v) { playing = v; }, select: s => { sel = s; render(); }, brush, paint: (pts, t = 'paint') => {
    tool = t; const e = effectOf(sel.id); if (!e) return; const c = masks.get(e.id); undo.push({ id: e.id, c: (() => { const b = U.canvas(c.width, c.height); b.getContext('2d').drawImage(c, 0, 0); return b; })() });
    stroke = { id: e.id, last: pts[0], dir: null }; if (!TYPES[e.type].flow) paintTo(pts[0]); for (const p of pts.slice(1)) paintTo(p); stroke = null; changed(e.id); measure(e.id); renderLeft();
  }, addEffect, addAmbiance, send, view: () => view };
})();

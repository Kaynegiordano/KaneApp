// Wallpaper Engine pour l'atelier Animer : où il est installé, lecture de ses textures (.tex) et de ses ambiances
// (systèmes de particules fournis avec le logiciel), écriture d'un projet de scène dans projects/myprojects, et
// lancement d'une fenêtre de rendu ou du fond d'écran. Aucune dépendance à Electron : testable avec Node seul.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');

/* ------------------------------------------------------------------ installation */
function steamLibraries(env) {
  const roots = new Set();
  for (const base of [env['ProgramFiles(x86)'], env.ProgramFiles, 'C:\\Program Files (x86)', 'C:\\Program Files']) if (base) roots.add(path.join(base, 'Steam'));
  const libs = new Set();
  for (const steam of roots) {
    libs.add(steam);
    try {
      const vdf = fs.readFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1].replace(/\\\\/g, '\\'));
    } catch { /* Steam absent de cet emplacement */ }
  }
  for (const d of 'CDEFGHIJ') { libs.add(d + ':\\SteamLibrary'); libs.add(d + ':\\Steam'); }
  return [...libs];
}
const isEngine = dir => !!dir && fs.existsSync(path.join(dir, 'wallpaper64.exe')) && fs.existsSync(path.join(dir, 'bin', 'resourcecompiler64.exe')) && fs.existsSync(path.join(dir, 'assets'));
function locate(env = process.env) {
  if (env.KANEAPP_WALLPAPER_ENGINE) return isEngine(env.KANEAPP_WALLPAPER_ENGINE) ? path.resolve(env.KANEAPP_WALLPAPER_ENGINE) : null;
  for (const lib of steamLibraries(env)) {
    const dir = path.join(lib, 'steamapps', 'common', 'wallpaper_engine');
    if (isEngine(dir)) return dir;
  }
  return null;
}

/* ------------------------------------------------------------------ textures .tex */
// Décompression LZ4 (format bloc) : les mipmaps des .tex de Wallpaper Engine sont compressés ainsi.
function lz4(src, size) {
  const out = Buffer.alloc(size);
  let i = 0, o = 0;
  while (i < src.length) {
    const token = src[i++];
    let len = token >> 4;
    if (len === 15) { let b; do { b = src[i++]; len += b; } while (b === 255); }
    src.copy(out, o, i, i + len); i += len; o += len;
    if (i >= src.length) break;
    const offset = src[i] | (src[i + 1] << 8); i += 2;
    if (!offset) throw new Error('Texture LZ4 invalide');
    let match = token & 15;
    if (match === 15) { let b; do { b = src[i++]; match += b; } while (b === 255); }
    match += 4;
    for (let k = 0; k < match; k++, o++) out[o] = out[o - offset];
  }
  if (o !== size) throw new Error('Texture LZ4 tronquée');
  return out;
}
const c565 = v => [((v >> 11) & 31) * 255 / 31, ((v >> 5) & 63) * 255 / 63, (v & 31) * 255 / 31];
function dxt(data, w, h, kind) {          // kind : 1, 3 ou 5
  const out = new Uint8Array(w * h * 4), bw = Math.ceil(w / 4), bh = Math.ceil(h / 4), step = kind === 1 ? 8 : 16;
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const b = (by * bw + bx) * step, cb = kind === 1 ? b : b + 8;
    const a0 = data.readUInt16LE(cb), a1 = data.readUInt16LE(cb + 2), bits = data.readUInt32LE(cb + 4);
    const p0 = c565(a0), p1 = c565(a1), pal = [p0, p1];
    if (kind !== 1 || a0 > a1) { pal.push(p0.map((v, i) => (2 * v + p1[i]) / 3), p0.map((v, i) => (v + 2 * p1[i]) / 3)); }
    else { pal.push(p0.map((v, i) => (v + p1[i]) / 2), [0, 0, 0]); }
    let alphas = null;
    if (kind === 5) {
      const e0 = data[b], e1 = data[b + 1]; alphas = [e0, e1];
      if (e0 > e1) for (let k = 1; k < 7; k++) alphas.push(((7 - k) * e0 + k * e1) / 7);
      else { for (let k = 1; k < 5; k++) alphas.push(((5 - k) * e0 + k * e1) / 5); alphas.push(0, 255); }
    }
    for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
      const x = bx * 4 + px, y = by * 4 + py; if (x >= w || y >= h) continue;
      const k = py * 4 + px, ci = (bits >> (2 * k)) & 3, o = (y * w + x) * 4, c = pal[ci];
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
      if (kind === 1) out[o + 3] = a0 <= a1 && ci === 3 ? 0 : 255;
      else if (kind === 3) out[o + 3] = ((data.readUInt16LE(b + Math.floor(k / 4) * 2) >> ((k % 4) * 4)) & 15) * 17;
      else {
        const bitPos = 3 * k, lo = data.readUIntLE(b + 2, 6);
        out[o + 3] = alphas[Math.floor(lo / 2 ** bitPos) % 8];
      }
    }
  }
  return out;
}
const FORMATS = { 0: 'rgba8888', 4: 'dxt5', 6: 'dxt3', 7: 'dxt1', 8: 'rg88', 9: 'r8' };
// Lit un .tex : image 0, mipmap 0, convertie en RGBA comme les shaders de particules la lisent (R8 → blanc, alpha = r ;
// RG88 → rrrg). Les planches animées (drapeau 4) donnent leurs images (frames) en pixels de la texture.
function readTex(buf) {
  let o = 0;
  const str = () => { const end = buf.indexOf(0, o); const s = buf.toString('latin1', o, end); o = end + 1; return s; };
  const i32 = () => { const v = buf.readInt32LE(o); o += 4; return v; };
  const f32 = () => { const v = buf.readFloatLE(o); o += 4; return v; };
  if (str() !== 'TEXV0005' || str() !== 'TEXI0001') throw new Error('Texture Wallpaper Engine inconnue');
  const format = i32(), flags = i32(), texWidth = i32(), texHeight = i32(), width = i32(), height = i32(); i32();
  const container = str();
  const images = i32();
  let imageFormat = -1;
  if (container === 'TEXB0003') imageFormat = i32();
  else if (container === 'TEXB0004') { imageFormat = i32(); if (i32() === 1 && imageFormat === -1) throw new Error('Texture vidéo non prise en charge'); }
  else if (container !== 'TEXB0001' && container !== 'TEXB0002') throw new Error('Conteneur de texture inconnu : ' + container);
  if (images < 1) throw new Error('Texture vide');
  const mips = i32();
  // TEXB0004 peut porter un en-tête de mipmap étendu (1, 2, JSON, 1) ; les textures compilées pour une scène n'en ont pas
  if (container === 'TEXB0004' && buf.readInt32LE(o) === 1 && buf.readInt32LE(o + 4) === 2) { i32(); i32(); str(); i32(); }
  const mw = i32(), mh = i32();
  let lz = 0, raw = 0;
  if (container !== 'TEXB0001') { lz = i32(); raw = i32(); }
  const n = i32(); let data = buf.subarray(o, o + n); o += n;
  if (lz === 1) data = lz4(data, raw);
  const out = { width, height, texWidth: mw, texHeight: mh, format: FORMATS[format] || String(format), flags, mipmaps: mips };
  if (imageFormat !== -1) { out.encoded = Buffer.from(data); out.mime = data[0] === 0x89 ? 'image/png' : data[0] === 0xff ? 'image/jpeg' : 'application/octet-stream'; }
  else {
    const px = mw * mh, rgba = new Uint8Array(px * 4);
    if (format === 0) rgba.set(data.subarray(0, px * 4));
    else if (format === 9) for (let i = 0; i < px; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = data[i]; }
    else if (format === 8) for (let i = 0; i < px; i++) { const r = data[i * 2]; rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = r; rgba[i * 4 + 3] = data[i * 2 + 1]; }
    else if (format === 4 || format === 6 || format === 7) rgba.set(dxt(Buffer.from(data), mw, mh, format === 7 ? 1 : format === 6 ? 3 : 5));
    else throw new Error('Format de texture non pris en charge : ' + format);
    out.rgba = rgba;
  }
  if (flags & 4) {
    // passe les autres mipmaps et images pour atteindre la description des planches
    try {
      const skip = () => { i32(); i32(); if (container !== 'TEXB0001') { i32(); i32(); } const n = i32(); o += n; };   // « o += i32() » perdrait les 4 octets lus
      for (let m = 1; m < mips; m++) skip();
      for (let im = 1; im < images; im++) { const k = i32(); for (let m = 0; m < k; m++) skip(); }
      const magic = str();
      if (/^TEXS000[123]$/.test(magic)) {
        const count = i32();
        if (magic === 'TEXS0003') { i32(); i32(); }
        out.frames = [];
        for (let k = 0; k < count; k++) {
          const image = i32(), time = f32();
          const v = magic === 'TEXS0001' ? [i32(), i32(), i32(), i32(), i32(), i32()] : [f32(), f32(), f32(), f32(), f32(), f32()];
          out.frames.push({ image, time, x: v[0], y: v[1], w: v[2], h: v[5] });
        }
      }
    } catch { /* planche illisible : image entière */ }
  }
  return out;
}

/* ------------------------------------------------------------------ ambiances (préréglages de Wallpaper Engine) */
// Les préréglages vivent dans assets/presets/<dossier>/(particles|materials)/presets/… ; ajoutés à une scène, l'éditeur
// les copie dans le projet sous particles/presets/… et materials/presets/… : l'export fait de même.
const AMBIANCES = {
  braises: { label: 'Braises', folder: 'ember', particle: 'particles/presets/ember.json', place: 'bas' },
  feuilles: { label: 'Feuilles au vent', folder: 'leaves', particle: 'particles/presets/leaves1.json', place: 'droite' },
  sakura: { label: 'Pétales de sakura', folder: 'leaves', particle: 'particles/presets/leaves5.json', place: 'droite' },
  brume: { label: 'Brume', folder: 'fog', particle: 'particles/presets/fog1.json', place: 'bas' },
  poussiere: { label: 'Poussière dans la lumière', folder: 'lightshafts', particle: 'particles/presets/dust_motes_0.json', place: 'centre' },
  rayons: { label: 'Rayons de lumière', folder: 'lightshafts', particle: 'particles/presets/light_shafts_0.json', place: 'haut-gauche' },
  neige: { label: 'Neige', folder: 'snow', particle: 'particles/presets/snowflat.json', place: 'haut' },
  magie: { label: 'Éclats magiques', folder: 'magic', particle: 'particles/presets/magic_sparkle.json', place: 'centre' },
};
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const safeRel = rel => typeof rel === 'string' && /^[\w./ -]+$/.test(rel) && !rel.split('/').includes('..');
// Un système et ses enfants, avec leurs matériaux ; `files` reçoit chaque fichier à copier (chemin du projet → source).
function loadSystem(engine, folder, rel, files, depth = 0) {
  if (!safeRel(rel) || depth > 4) throw new Error('Ambiance invalide : ' + rel);
  const src = path.join(engine, 'assets', 'presets', folder, rel);
  const def = readJSON(src); files.set(rel, src);
  let material = null;
  if (def.material && safeRel(def.material)) {
    const msrc = path.join(engine, 'assets', 'presets', folder, def.material);
    const m = readJSON(msrc); files.set(def.material, msrc);
    const pass = (m.passes || [])[0] || {};
    material = { blending: pass.blending || 'translucent', texture: (pass.textures || [])[0] || 'util/white', combos: pass.combos || {} };
  }
  const children = (def.children || []).filter(c => c && safeRel(c.name)).map(c => ({ ...c, system: loadSystem(engine, folder, c.name, files, depth + 1) }));
  return { file: rel, def, material, children };
}
const texCache = new Map();
function assetTexture(engine, name) {
  if (!safeRel(name)) throw new Error('Texture invalide : ' + name);
  const file = path.join(engine, 'assets', 'materials', name + '.tex');
  const key = file.toLowerCase();
  if (!texCache.has(key)) {
    const t = readTex(fs.readFileSync(file));
    texCache.set(key, t); if (texCache.size > 40) texCache.delete(texCache.keys().next().value);
  }
  return texCache.get(key);
}
function ambiance(engine, key) {
  const A = AMBIANCES[key]; if (!A) throw new Error('Ambiance inconnue : ' + key);
  const files = new Map(), system = loadSystem(engine, A.folder, A.particle, files);
  const textures = {};
  const walk = s => { if (s.material && !(s.material.texture in textures)) textures[s.material.texture] = assetTexture(engine, s.material.texture); s.children.forEach(c => walk(c.system)); };
  walk(system);
  return { key, label: A.label, place: A.place, system, textures, files: [...files.keys()] };
}

/* ------------------------------------------------------------------ effets natifs */
// Chaque mouvement de l'atelier est un effet fourni avec Wallpaper Engine, réglé et peint comme dans son éditeur.
const EFFECTS = { respiration: 'shake', clignement: 'shake', ondulation: 'waterwaves', lueur: 'pulse', regard: 'iris' };
const vec = v => Array.isArray(v) ? v.map(x => +(+x).toFixed(5)).join(' ') : +(+v).toFixed(5);
const hexToVec = hex => { const n = parseInt(String(hex || '#ffffff').slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
// Constantes et combinaisons de chaque effet (noms des « material » des shaders de Wallpaper Engine).
function effectPass(e, mask) {
  const p = e.params || {};
  switch (e.type) {
    case 'respiration': return { textures: [null, mask], combos: { NOISE: p.irregulier ? 1 : 0, DIRECTION: 0 },
      constantshadervalues: { speed: vec(p.vitesse ?? 1.4), strength: vec(p.force ?? 0.1), friction: vec([p.douceur ?? 1, p.douceur ?? 1]), bounds: '0 1' } };
    case 'clignement': return { textures: [null, mask], combos: { NOISE: 0, DIRECTION: 1 },
      constantshadervalues: { speed: vec(p.vitesse ?? 1.2), strength: vec(p.force ?? 0.1), friction: '1 1', bounds: '0.993 0.998' } };
    case 'ondulation': return { textures: [null, mask], combos: { PERSPECTIVE: 0, DUALWAVES: 0 },
      constantshadervalues: { speed: vec(p.vitesse ?? 1.5), scale: vec(p.echelle ?? 12), exponent: vec(p.exposant ?? 1), strength: vec(p.force ?? 0.1), direction: vec(p.direction ?? 0) } };
    case 'lueur': return { textures: [null, null, mask], combos: { BLENDMODE: 9, PULSEALPHA: 0, PULSECOLOR: 1 },
      constantshadervalues: { speed: vec(p.vitesse ?? 1), phase: vec(p.phase ?? 0), amount: vec(p.force ?? 1), bounds: '0 1', noisespeed: 0.5, noiseamount: 0, power: 1,
        tintlow: '1 1 1', tinthigh: vec(hexToVec(p.couleur)) } };
    case 'regard': return { textures: [null, mask], combos: { BACKGROUND: 0 },
      constantshadervalues: { scale: vec([p.force ?? 1, p.force ?? 1]), speed: vec(p.vitesse ?? 1), rough: vec(p.douceur ?? 0.2), noiseamount: vec(p.flottement ?? 0.5), phase: 0 } };
    default: throw new Error('Mouvement inconnu : ' + e.type);
  }
}
function copyEffect(engine, name, out) {
  const src = path.join(engine, 'assets', 'effects', name);
  if (!fs.existsSync(path.join(src, 'effect.json'))) throw new Error('Effet « ' + name + ' » introuvable dans Wallpaper Engine');
  const walk = dir => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, ent.name), rel = path.relative(src, f).split(path.sep).join('/');
      if (ent.isDirectory()) { if (rel !== 'preview') walk(f); continue; }
      const dst = rel === 'effect.json' ? path.join(out, 'effects', name, 'effect.json') : path.join(out, rel);
      if (rel !== 'effect.json' && !/^(materials|shaders)\//.test(rel)) continue;
      fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(f, dst);
    }
  };
  walk(src);
}

/* ------------------------------------------------------------------ scène */
const slugify = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'kaneapp_animer';
const sha1 = file => { try { return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex'); } catch { return null; } };
const writeJSON = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, '\t')); };
const userKey = (prefix, i) => 'kane_' + prefix + '_' + (i + 1);

// Décrit la scène (scene.json, project.json) et la liste des textures à écrire. Pure : testable sans disque.
function buildScene(p) {
  const W = Math.round(p.width), H = Math.round(p.height);
  if (!(W > 0 && H > 0 && W <= 16384 && H <= 16384)) throw new Error('Taille d’image invalide');
  let uid = 1; const id = () => uid++;
  const props = { schemecolor: { order: 0, text: 'ui_browse_properties_scheme_color', type: 'color', value: '0 0 0' } };
  let order = 1;
  const toggle = (key, text, value = true) => { props[key] = { order: order++, text, type: 'bool', value: !!value }; return { user: key, value: !!value }; };
  const textures = [{ name: 'kaneapp_image', key: 'image' }];
  const effects = [], effectNames = new Set();
  (p.effects || []).forEach((e, i) => {
    const name = EFFECTS[e.type]; if (!name) throw new Error('Mouvement inconnu : ' + e.type);
    effectNames.add(name);
    const mask = 'masks/kaneapp_' + e.type + '_' + (i + 1);
    textures.push({ name: mask, key: 'mask:' + i });
    const pass = effectPass(e, mask);
    effects.push({ file: 'effects/' + name + '/effect.json', id: id(), name: e.name || e.type, visible: e.visible === false ? false : toggle(userKey('mouvement', i), e.name || e.type),
      passes: [{ id: id(), ...pass }] });
  });
  const objects = [{ id: id(), name: p.title || 'Illustration', image: 'models/kaneapp_image.json', origin: `${W / 2} ${H / 2} 0`, size: `${W} ${H}`, scale: '1 1 1', angles: '0 0 0',
    visible: true, parallaxDepth: '0 0', colorBlendMode: 0, copybackground: true, effects }];
  const presets = new Set();
  (p.ambiances || []).forEach((a, i) => {
    const A = AMBIANCES[a.key]; if (!A) throw new Error('Ambiance inconnue : ' + a.key);
    presets.add(a.key);
    const o = a.overrides || {}, s = +(a.scale ?? 1);
    const io = { id: id() };
    for (const k of ['rate', 'count', 'speed', 'size', 'alpha', 'lifetime']) if (o[k] != null && +o[k] !== 1) io[k] = +(+o[k]).toFixed(4);
    if (o.couleur && o.couleur.toLowerCase() !== '#ffffff') io.colorn = vec(hexToVec(o.couleur));
    objects.push({ id: id(), name: a.name || A.label, particle: A.particle, origin: `${+(+a.x).toFixed(2)} ${+(H - a.y).toFixed(2)} 0`, scale: `${s} ${s} 1`, angles: '0 0 0',
      parallaxDepth: '0 0', visible: a.visible === false ? false : toggle(userKey('ambiance', i), a.name || A.label), instanceoverride: io });
  });
  const b = p.bloom || {};
  const general = { ambientcolor: '0.3 0.3 0.3', skylightcolor: '0.3 0.3 0.3', clearcolor: '0 0 0', clearenabled: true,
    orthogonalprojection: { width: W, height: H }, cameraparallax: false, cameraparallaxamount: 0.5, cameraparallaxdelay: 0.1, cameraparallaxmouseinfluence: 0,
    camerashake: false, camerapreview: true, bloom: b.on ? toggle('kane_halo', 'Halo lumineux') : false, bloomstrength: +(b.strength ?? 0.8), bloomthreshold: +(b.threshold ?? 0.65), bloomtint: '1 1 1' };
  const scene = { camera: { center: '0 0 -1', eye: '0 0 0', up: '0 1 0' }, general, objects };
  const project = { file: 'scene.json', type: 'scene', title: p.title || 'Animation KaneApp', description: p.description || 'Créé avec l’atelier Animer de KaneApp.', preview: 'preview.jpg',
    tags: [], version: 0, general: { properties: props } };
  return { scene, project, textures, effects: [...effectNames], presets: [...presets] };
}

const compileTex = (compiler, png) => new Promise((resolve, reject) => {
  // le compilateur attend une image rangée dans un dossier « materials » (ailleurs il ne rend jamais la main) : borné
  execFile(compiler, ['-tex', '-i', png, '-o', png.replace(/\.png$/i, '.tex')], { timeout: 180000, windowsHide: true }, (err, stdout, stderr) => {
    if (err || !fs.existsSync(png.replace(/\.png$/i, '.tex'))) reject(new Error('Compilation de la texture « ' + path.basename(png) + ' » impossible' + (stderr || stdout ? ' : ' + String(stderr || stdout).trim().slice(0, 300) : '')));
    else resolve();
  });
});

// Écrit le projet dans <Wallpaper Engine>/projects/myprojects. Un projet retouché dans l'éditeur de Wallpaper Engine depuis
// le dernier envoi, ou qui ne vient pas de cet atelier, n'est jamais écrasé : la nouvelle version va à côté (_2, _3…).
async function exportProject(engine, p, { projects } = {}) {
  if (!isEngine(engine)) throw new Error('Wallpaper Engine est introuvable. Installez-le avec Steam.');
  const root = projects || path.join(engine, 'projects', 'myprojects');
  if (!fs.existsSync(root)) throw new Error('Dossier des projets de Wallpaper Engine introuvable : ' + root);
  if (!p || typeof p.source !== 'string' || !p.source) throw new Error('Projet Animer invalide');
  const built = buildScene(p);
  const stage = path.join(root, '.kaneapp-envoi-' + process.pid + '-' + Date.now());
  fs.mkdirSync(stage, { recursive: true });
  try {
    const binaries = { image: p.image };
    (p.effects || []).forEach((e, i) => { binaries['mask:' + i] = e.mask; });
    const jobs = [];
    for (const t of built.textures) {
      const data = binaries[t.key]; if (!data || !data.length) throw new Error('Texture manquante : ' + t.key);
      const png = path.join(stage, 'materials', t.name + '.png');
      fs.mkdirSync(path.dirname(png), { recursive: true });
      fs.writeFileSync(png, Buffer.from(data));
      writeJSON(png.replace(/\.png$/i, '.tex-json'), { format: 'rgba8888', nonpoweroftwo: true, nomip: true, clampuvs: true });
      jobs.push(png);
    }
    const compiler = path.join(engine, 'bin', 'resourcecompiler64.exe');
    for (let i = 0; i < jobs.length; i += 4) await Promise.all(jobs.slice(i, i + 4).map(png => compileTex(compiler, png)));
    for (const png of jobs) fs.rmSync(png, { force: true });
    writeJSON(path.join(stage, 'materials', 'kaneapp_image.json'), { passes: [{ shader: 'genericimage4', textures: ['kaneapp_image'], blending: 'translucent', cullmode: 'nocull', depthtest: 'disabled', depthwrite: 'disabled', combos: {} }] });
    writeJSON(path.join(stage, 'models', 'kaneapp_image.json'), { autosize: true, material: 'materials/kaneapp_image.json' });
    for (const name of built.effects) copyEffect(engine, name, stage);
    for (const key of built.presets) {
      const A = AMBIANCES[key], files = new Map(); loadSystem(engine, A.folder, A.particle, files);
      for (const [rel, src] of files) { const dst = path.join(stage, rel); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
    }
    if (p.preview?.length) fs.writeFileSync(path.join(stage, 'preview.jpg'), Buffer.from(p.preview));
    else delete built.project.preview;
    // choix du dossier : celui du dernier envoi de ce projet s'il n'a pas été retouché depuis
    const slug = slugify(p.title);
    let target = null, keep = {};
    for (let n = 1; n < 100; n++) {
      const dir = path.join(root, n === 1 ? slug : slug + '_' + n);
      if (!fs.existsSync(dir)) { target = dir; break; }
      let mark = null; try { mark = readJSON(path.join(dir, 'kaneapp-animer.json')); } catch { /* pas de cet atelier */ }
      if (mark && mark.source === p.source && sha1(path.join(dir, 'scene.json')) === mark.scene && sha1(path.join(dir, 'project.json')) === mark.project) {
        try { const old = readJSON(path.join(dir, 'project.json')); for (const k of ['workshopid', 'workshopurl']) if (old[k]) keep[k] = old[k]; } catch { /* rien */ }
        target = dir; break;
      }
    }
    if (!target) throw new Error('Trop de versions de ce fond dans Wallpaper Engine');
    Object.assign(built.project, keep);
    writeJSON(path.join(stage, 'scene.json'), built.scene);
    writeJSON(path.join(stage, 'project.json'), built.project);
    writeJSON(path.join(stage, 'kaneapp-animer.json'), { source: p.source, scene: sha1(path.join(stage, 'scene.json')), project: sha1(path.join(stage, 'project.json')), date: new Date().toISOString() });
    if (fs.existsSync(target)) {
      const old = target + '.kaneapp-ancien';
      fs.rmSync(old, { recursive: true, force: true });
      try { fs.renameSync(target, old); } catch { throw new Error('Fermez ce fond dans l’éditeur de Wallpaper Engine, puis envoyez-le de nouveau.'); }
      fs.renameSync(stage, target); fs.rmSync(old, { recursive: true, force: true });
    } else fs.renameSync(stage, target);
    return { folder: target, name: path.basename(target), project: path.join(target, 'project.json'), title: built.project.title };
  } catch (e) {
    fs.rmSync(stage, { recursive: true, force: true });
    throw e;
  }
}

/* ------------------------------------------------------------------ lecture */
function run(engine, args) {
  const exe = path.join(engine, 'wallpaper64.exe');
  if (!fs.existsSync(exe)) throw new Error('Wallpaper Engine est introuvable');
  const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => {}); child.unref();
}
// Fenêtre de rendu indépendante : le fond du bureau ne change pas.
const testWindow = (engine, project, title = 'KaneApp — Animer') => run(engine, ['-control', 'openWallpaper', '-file', project, '-playInWindow', title, '-width', '1280', '-height', '720']);
const apply = (engine, project) => run(engine, ['-control', 'openWallpaper', '-file', project]);

module.exports = { locate, readTex, lz4, ambiance, AMBIANCES, EFFECTS, buildScene, exportProject, testWindow, apply, slugify };

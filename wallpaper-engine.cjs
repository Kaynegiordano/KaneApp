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

/* ------------------------------------------------------------------ fichiers de Wallpaper Engine */
// JSON tolérant : plusieurs fichiers de Wallpaper Engine ont des virgules finales
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/,(\s*[}\]])/g, '$1'));
const parseLoose = text => { try { return JSON.parse(String(text).replace(/,(\s*[}\]])/g, '$1')); } catch { return {}; } };
const safeRel = rel => typeof rel === 'string' && /^[\w./ -]+$/.test(rel) && !rel.split('/').includes('..');
const safeKey = key => typeof key === 'string' && /^[\w-]{1,64}$/.test(key);
// Libellés de l'éditeur de Wallpaper Engine, en français (repli anglais)
const locales = new Map();
function locale(engine) {
  if (!locales.has(engine)) {
    const L = {};
    for (const f of ['ui_en-us.json', 'ui_fr-fr.json']) try { Object.assign(L, readJSON(path.join(engine, 'locale', f))); } catch { /* langue absente */ }
    locales.set(engine, L);
  }
  return locales.get(engine);
}
const tr = (L, k) => (k && L[k]) || (typeof k === 'string' ? k.replace(/^ui_editor_properties_/, '').replace(/_/g, ' ') : '');
const texCache = new Map();
function assetTexture(engine, name, dirs = []) {
  if (!safeRel(name)) throw new Error('Texture invalide : ' + name);
  const file = [...dirs.map(d => path.join(d, 'materials', name + '.tex')), path.join(engine, 'assets', 'materials', name + '.tex')].find(f => fs.existsSync(f));
  if (!file) throw new Error('Texture introuvable : ' + name);
  const key = file.toLowerCase();
  if (!texCache.has(key)) {
    const t = readTex(fs.readFileSync(file));
    texCache.set(key, t); if (texCache.size > 60) texCache.delete(texCache.keys().next().value);
  }
  return texCache.get(key);
}

/* ------------------------------------------------------------------ effets */
// Les effets de l'éditeur (assets/effects) : passes, cibles, shaders avec leurs annotations (réglages, textures, options).
const GROUPS = { animate: 'Animer', interactive: 'Interactif', blur: 'Flou', colorize: 'Coloriser', distort: 'Déformer', enhance: 'Améliorer' };
const GROUP_ORDER = Object.keys(GROUPS);
const HIDDEN_EFFECTS = new Set(['_empty']);
function shaderFile(engine, dir, name, ext) {
  return [path.join(dir, 'shaders', name + '.' + ext), path.join(engine, 'assets', 'shaders', name + '.' + ext)].find(f => fs.existsSync(f));
}
function withIncludes(engine, dir, src, seen = new Set()) {
  return src.replace(/^[ \t]*#include\s+"([^"]+)"[^\n]*$/gm, (_m, inc) => {
    if (seen.has(inc)) return '';
    seen.add(inc);
    const f = [path.join(dir, 'shaders', inc), path.join(engine, 'assets', 'shaders', inc)].find(x => fs.existsSync(x));
    if (!f) throw new Error('En-tête de shader introuvable : ' + inc);
    return withIncludes(engine, dir, fs.readFileSync(f, 'utf8'), seen);
  }).replace(/^[ \t]*#require[^\n]*$/gm, '');
}
// Annotations des shaders : « uniform … // {json} » et « // [COMBO] {json} »
function annotations(src) {
  const uniforms = [], textures = [], combos = [];
  for (const line of src.split(/\r?\n/)) {
    let m = line.match(/^\s*\/\/\s*\[COMBO\]\s*(\{.*\})\s*$/);
    if (m) { const c = parseLoose(m[1]); if (c.combo) combos.push(c); continue; }
    m = line.match(/^\s*uniform\s+(\w+)\s+(\w+)\s*(\[\s*\d+\s*\])?\s*;\s*(?:\/\/\s*(\{.*\}))?/);
    if (!m) continue;
    const a = m[4] ? parseLoose(m[4]) : {};
    if (m[1] === 'sampler2D') { const i = +m[2].replace(/\D/g, ''); if (/^g_Texture\d+$/.test(m[2])) textures.push({ index: i, ...a }); }
    else if (a.material) uniforms.push({ ...a, glsl: m[1], name: m[2], color: a.type === 'color' });
  }
  return { uniforms, textures, combos };
}
function loadShader(engine, dir, name) {
  const vf = shaderFile(engine, dir, name, 'vert'), ff = shaderFile(engine, dir, name, 'frag');
  if (!vf || !ff) throw new Error('Shader introuvable : ' + name);
  // réglages lus après inclusion des en-têtes : common_composite.h déclare g_CompositeColor, g_CompositeAlpha…
  const vert = withIncludes(engine, dir, fs.readFileSync(vf, 'utf8')), frag = withIncludes(engine, dir, fs.readFileSync(ff, 'utf8'));
  const av = annotations(vert), af = annotations(frag);
  // stages : en Direct3D, sommets et pixels ont chacun leurs constantes (g_Speed peut valoir « speed » et « speeduv »)
  return { name, vert, frag, stages: { vert: av.uniforms.map(u => ({ name: u.name, material: u.material })), frag: af.uniforms.map(u => ({ name: u.name, material: u.material })) },
    uniforms: [...af.uniforms, ...av.uniforms.filter(u => !af.uniforms.some(x => x.name === u.name && x.material === u.material))],
    textures: [...af.textures, ...av.textures.filter(t => !af.textures.some(x => x.index === t.index))],
    combos: [...af.combos, ...av.combos.filter(c => !af.combos.some(x => x.combo === c.combo))] };
}
function effects(engine) {
  const L = locale(engine), out = [];
  for (const key of fs.readdirSync(path.join(engine, 'assets', 'effects'))) {
    if (HIDDEN_EFFECTS.has(key) || !safeKey(key)) continue;
    try {
      const d = readJSON(path.join(engine, 'assets', 'effects', key, 'effect.json'));
      out.push({ key, group: d.group || 'colorize', groupLabel: GROUPS[d.group] || d.group, title: tr(L, d.name), description: tr(L, d.description), performance: d.performance || '' });
    } catch { /* effet illisible */ }
  }
  return out.sort((a, b) => (GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)) || a.title.localeCompare(b.title, 'fr'));
}
const defCache = new Map();
function effectDef(engine, key) {
  if (!safeKey(key)) throw new Error('Effet invalide');
  if (defCache.has(key)) return defCache.get(key);
  const dir = path.join(engine, 'assets', 'effects', key), L = locale(engine);
  const d = readJSON(path.join(dir, 'effect.json'));
  const res = rel => [path.join(dir, rel), path.join(engine, 'assets', rel)].find(f => safeRel(rel) && fs.existsSync(f));
  const shaders = {}, assetNames = new Set();
  let preview = true;
  const fbos = (d.fbos || []).map(f => ({ name: f.name, scale: +f.scale || 1, format: f.format || 'rgba8888' }));
  const passes = (d.passes || []).map(ps => {
    if (!ps.material) { preview = false; return { command: ps.command || 'inconnu', source: ps.source, target: ps.target }; }
    const mf = res(ps.material); if (!mf) { preview = false; return { missing: ps.material }; }
    const m = (readJSON(mf).passes || [])[0] || {};
    if (!shaders[m.shader]) shaders[m.shader] = loadShader(engine, dir, m.shader);
    const sh = shaders[m.shader];
    for (const t of m.textures || []) if (t && !String(t).startsWith('_rt_')) assetNames.add(t);
    for (const t of sh.textures) if (t.default && !String(t.default).startsWith('_rt_')) assetNames.add(t.default);
    for (const b of ps.bind || []) if (b.name !== 'previous' && !fbos.some(f => f.name === b.name)) preview = false;
    for (const t of sh.textures) if (String(t.default || '').startsWith('_rt_') && !(ps.bind || []).some(b => b.index === t.index)) preview = false;
    return { shader: m.shader, combos: m.combos || {}, textures: m.textures || [], constants: m.constantshadervalues || {}, blending: m.blending || 'normal', target: ps.target || null, bind: ps.bind || [] };
  });
  // réglages présentés : uniformes annotés de toutes les passes, une fois par nom de matériau
  const params = [], seen = new Set();
  passes.forEach((ps, i) => {
    if (!ps.shader) return;
    for (const u of shaders[ps.shader].uniforms) {
      if (seen.has(u.material)) { params.find(p => p.material === u.material).passes.push(i); continue; }
      seen.add(u.material);
      params.push({ material: u.material, type: u.glsl, label: tr(L, u.label || u.material), default: u.default, range: u.range, group: u.group ? tr(L, u.group) : '',
        color: !!u.color, direction: !!u.direction, int: !!u.int, linked: !!u.linked, position: !!u.position, hidden: !!u.hidden, require: u.require || null, passes: [i] });
    }
  });
  const combos = [], cseen = new Set();
  passes.forEach((ps, i) => {
    if (!ps.shader) return;
    for (const c of shaders[ps.shader].combos) {
      if (cseen.has(c.combo)) { combos.find(x => x.combo === c.combo).passes.push(i); continue; }
      cseen.add(c.combo);
      const options = c.options && typeof c.options === 'object' ? Object.entries(c.options).map(([k, v]) => ({ value: +v, label: tr(L, k) })) : null;
      combos.push({ combo: c.combo, label: tr(L, c.material || c.combo), type: c.type || (options ? 'options' : 'bool'), default: +(c.default ?? 0), options, require: c.require || null, passes: [i] });
    }
  });
  const textures = [];
  passes.forEach((ps, i) => {
    if (!ps.shader) return;
    for (const t of shaders[ps.shader].textures) {
      if (t.index === 0 || t.hidden || (ps.bind || []).some(b => b.index === t.index)) continue;
      textures.push({ pass: i, index: t.index, label: tr(L, t.label), mode: t.mode || '', combo: t.combo || '', default: ps.textures[t.index] || t.default || '',
        paint: /0 0 0/.test(t.paintdefaultcolor || '') ? 0 : 1, format: t.format || '', require: t.require || null });
    }
  });
  const assets = {};
  for (const n of assetNames) try { assets[n] = assetTexture(engine, n, [dir]); } catch { /* texture d'appoint absente */ }
  const def = { key, title: tr(L, d.name), description: tr(L, d.description), group: d.group, performance: d.performance || '', preview, passes, fbos, shaders, params, combos, textures, assets };
  defCache.set(key, def);
  return def;
}

/* ------------------------------------------------------------------ préréglages (ambiances) */
// assets/presets/<dossier>/preset.json : variantes, chacune une liste d'objets (systèmes de particules surtout). Ajoutés à une
// scène, l'éditeur copie leurs fichiers dans le projet (particles/presets/…, materials/presets/…) : l'export fait de même.
function loadSystem(engine, folder, rel, files, depth = 0) {
  if (!safeRel(rel) || depth > 5) throw new Error('Préréglage invalide : ' + rel);
  const src = path.join(engine, 'assets', 'presets', folder, rel);
  const def = readJSON(src); files.set(rel, src);
  let material = null;
  if (def.material && safeRel(def.material)) {
    const msrc = path.join(engine, 'assets', 'presets', folder, def.material);
    if (fs.existsSync(msrc)) {
      const m = readJSON(msrc); files.set(def.material, msrc);
      const pass = (m.passes || [])[0] || {};
      material = { blending: pass.blending || 'translucent', texture: (pass.textures || [])[0] || 'util/white', combos: pass.combos || {} };
    }
  }
  const children = (def.children || []).filter(c => c && safeRel(c.name)).map(c => ({ ...c, system: loadSystem(engine, folder, c.name, files, depth + 1) }));
  return { file: rel, def, material, children };
}
function presets(engine) {
  const L = locale(engine), out = [], root = path.join(engine, 'assets', 'presets');
  for (const folder of fs.readdirSync(root)) {
    if (!safeKey(folder)) continue;
    let d; try { d = readJSON(path.join(root, folder, 'preset.json')); } catch { continue; }
    const labels = (d.options?.droplistOptions || []).map(o => tr(L, o.label));
    const variants = (d.variants || []).map((v, i) => ({ index: i, label: labels[i] || (d.variants.length > 1 ? 'Variante ' + (i + 1) : tr(L, d.name)),
      supported: (v.objects || []).length > 0 && v.objects.every(o => o.particle) }));
    if (variants.some(v => v.supported)) out.push({ folder, title: tr(L, d.name), description: tr(L, d.description), variants });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
}
const v3 = (s, d) => (typeof s === 'string' ? s.trim().split(/\s+/).map(Number) : Array.isArray(s) ? s.map(Number) : d).concat(d).slice(0, 3);
function presetVariant(engine, folder, index) {
  if (!safeKey(folder)) throw new Error('Préréglage invalide');
  const L = locale(engine), d = readJSON(path.join(engine, 'assets', 'presets', folder, 'preset.json'));
  const v = (d.variants || [])[+index]; if (!v) throw new Error('Variante introuvable');
  const files = new Map(), textures = {};
  const objects = (v.objects || []).filter(o => o.particle).map(o => ({ name: o.name || '', particle: o.particle, origin: v3(o.origin, [0, 0, 0]), scale: v3(o.scale, [1, 1, 1]), angles: v3(o.angles, [0, 0, 0]),
    system: loadSystem(engine, folder, o.particle, files) }));
  const walk = s => { if (s.material && !(s.material.texture in textures)) { try { textures[s.material.texture] = assetTexture(engine, s.material.texture, [path.join(engine, 'assets', 'presets', folder)]); } catch { textures[s.material.texture] = null; } } s.children.forEach(c => walk(c.system)); };
  objects.forEach(o => walk(o.system));
  const labels = (d.options?.droplistOptions || []).map(o => tr(L, o.label));
  return { folder, index: +index, title: tr(L, d.name), label: labels[+index] || tr(L, d.name), objects, textures, files: [...files.keys()] };
}
// anciennes ambiances (Animer 1.38.0) → préréglage et variante
const LEGACY_AMBIANCES = { braises: ['ember', 1], feuilles: ['leaves', 0], sakura: ['leaves', 4], brume: ['fog', 0], poussiere: ['lightshafts', 3], rayons: ['lightshafts', 4], neige: ['snow', 1], magie: ['magic', 1] };

/* ------------------------------------------------------------------ scène */
const vec = v => Array.isArray(v) ? v.map(x => +(+x).toFixed(5)).join(' ') : +(+v).toFixed(5);
const hexToVec = hex => { const n = parseInt(String(hex || '#ffffff').slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const slugify = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'kaneapp_animer';
const sha1 = file => { try { return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex'); } catch { return null; } };
const writeJSON = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, '\t')); };
const maskKey = (effect, pass, index) => 'mask:' + effect + ':' + pass + ':' + index;
// valeur d'un réglage telle que la scène l'écrit : nombre, ou « x y z » ; couleurs en #rrggbb converties
const sceneValue = v => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v) ? vec(hexToVec(v)) : Array.isArray(v) ? vec(v) : typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' ? vec(v) : String(v);

// Décrit scene.json et project.json. p : { title, width, height, layers, bloom } ; defs : définitions des effets employés ;
// variants : objets des préréglages employés ; masks : clés des masques fournis. Pure : testable sans disque.
function buildScene(p, defs, variants = {}, masks = new Set()) {
  const W = Math.round(p.width), H = Math.round(p.height);
  if (!(W > 0 && H > 0 && W <= 16384 && H <= 16384)) throw new Error('Taille d’image invalide');
  let uid = 1; const id = () => uid++;
  const props = { schemecolor: { order: 0, text: 'ui_browse_properties_scheme_color', type: 'color', value: '0 0 0' } };
  let order = 1;
  const toggle = (key, text, value = true) => { props[key] = { order: order++, text, type: 'bool', value: !!value }; return { user: key, value: !!value }; };
  const textures = [{ name: 'kaneapp_image', key: 'image' }];
  const used = new Set(), presetsUsed = new Set();
  const layers = p.layers || [];
  const image = layers.find(l => l.kind === 'image') || { effects: [] };
  let n = 0;
  const effectsOut = (image.effects || []).map(e => {
    const def = defs[e.effect]; if (!def) throw new Error('Effet inconnu : ' + e.effect);
    used.add(e.effect); n++;
    const values = e.values || {}, combos = e.combos || {};
    const passes = def.passes.map((ps, i) => {
      if (!ps.shader) return { id: id() };
      const out = { id: id() };
      const sh = def.shaders[ps.shader];
      const cv = {};
      for (const c of sh.combos) if (c.combo in combos) cv[c.combo] = +combos[c.combo];
      if (Object.keys(cv).length) out.combos = cv;
      const tex = [];
      for (const t of sh.textures) {
        const k = maskKey(e.id, i, t.index);
        if (masks.has(k)) { const name = 'masks/kaneapp_' + n + '_' + i + '_' + t.index; textures.push({ name, key: k }); tex[t.index] = name; }
      }
      if (tex.length) out.textures = Array.from({ length: tex.length }, (_, k) => tex[k] || null);
      const csv = {};
      for (const u of sh.uniforms) if (u.material in values) csv[u.material] = sceneValue(values[u.material]);
      if (Object.keys(csv).length) out.constantshadervalues = csv;
      return out;
    });
    return { file: 'effects/' + e.effect + '/effect.json', id: id(), name: e.name || def.title, visible: e.visible === false ? false : toggle('kane_effet_' + n, e.name || def.title), passes };
  });
  const objects = [{ id: id(), name: image.name || p.title || 'Illustration', image: 'models/kaneapp_image.json', origin: `${W / 2} ${H / 2} 0`, size: `${W} ${H}`, scale: '1 1 1', angles: '0 0 0',
    visible: true, parallaxDepth: '0 0', colorBlendMode: 0, copybackground: true, effects: effectsOut }];
  let a = 0;
  for (const l of layers) {
    if (l.kind !== 'particle') continue;
    const v = variants[l.folder + '/' + l.variant]; if (!v) throw new Error('Préréglage introuvable : ' + l.folder);
    presetsUsed.add(l.folder + '/' + l.variant); a++;
    const o = l.overrides || {}, s = +(l.scale ?? 1), visible = l.visible === false ? false : toggle('kane_ambiance_' + a, l.name || v.label);
    for (const ob of v.objects) {
      const io = { id: id() };
      for (const k of ['rate', 'count', 'speed', 'size', 'alpha', 'lifetime']) if (o[k] != null && +o[k] !== 1) io[k] = +(+o[k]).toFixed(4);
      if (o.couleur && o.couleur.toLowerCase() !== '#ffffff') io.colorn = vec(hexToVec(o.couleur));
      const ang = (+l.angle || 0) * Math.PI / 180;
      objects.push({ id: id(), name: (l.name || v.label) + (v.objects.length > 1 ? ' · ' + (ob.name || '') : ''), particle: ob.particle,
        origin: `${+(+l.x + ob.origin[0] * s).toFixed(2)} ${+(H - l.y + ob.origin[1] * s).toFixed(2)} ${+(ob.origin[2] * s).toFixed(2)}`,
        scale: `${+(s * ob.scale[0]).toFixed(4)} ${+(s * ob.scale[1]).toFixed(4)} ${+(s * ob.scale[2]).toFixed(4)}`,
        angles: `${ob.angles[0]} ${ob.angles[1]} ${+(ob.angles[2] + ang).toFixed(5)}`, parallaxDepth: '0 0', visible, instanceoverride: io });
    }
  }
  const b = p.bloom || {};
  const general = { ambientcolor: '0.3 0.3 0.3', skylightcolor: '0.3 0.3 0.3', clearcolor: '0 0 0', clearenabled: true,
    orthogonalprojection: { width: W, height: H }, cameraparallax: false, cameraparallaxamount: 0.5, cameraparallaxdelay: 0.1, cameraparallaxmouseinfluence: 0,
    camerashake: false, camerapreview: true, bloom: b.on ? toggle('kane_halo', 'Halo lumineux') : false, bloomstrength: +(b.strength ?? 0.8), bloomthreshold: +(b.threshold ?? 0.65), bloomtint: '1 1 1' };
  const scene = { camera: { center: '0 0 -1', eye: '0 0 0', up: '0 1 0' }, general, objects };
  const project = { file: 'scene.json', type: 'scene', title: p.title || 'Animation KaneApp', description: p.description || 'Créé avec l’atelier Animer de KaneApp.', preview: 'preview.jpg',
    tags: [], version: 0, general: { properties: props } };
  return { scene, project, textures, effects: [...used], presets: [...presetsUsed] };
}

const compileTex = (compiler, png) => new Promise((resolve, reject) => {
  // le compilateur attend une image rangée dans un dossier « materials » (ailleurs il ne rend jamais la main) : borné
  execFile(compiler, ['-tex', '-i', png, '-o', png.replace(/\.png$/i, '.tex')], { timeout: 180000, windowsHide: true }, (err, stdout, stderr) => {
    if (err || !fs.existsSync(png.replace(/\.png$/i, '.tex'))) reject(new Error('Compilation de la texture « ' + path.basename(png) + ' » impossible' + (stderr || stdout ? ' : ' + String(stderr || stdout).trim().slice(0, 300) : '')));
    else resolve();
  });
});
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

// Écrit le projet dans <Wallpaper Engine>/projects/myprojects. Un projet retouché dans l'éditeur de Wallpaper Engine depuis
// le dernier envoi, ou qui ne vient pas de cet atelier, n'est jamais écrasé : la nouvelle version va à côté (_2, _3…).
async function exportProject(engine, p, { projects } = {}) {
  if (!isEngine(engine)) throw new Error('Wallpaper Engine est introuvable. Installez-le avec Steam.');
  const root = projects || path.join(engine, 'projects', 'myprojects');
  if (!fs.existsSync(root)) throw new Error('Dossier des projets de Wallpaper Engine introuvable : ' + root);
  if (!p || typeof p.source !== 'string' || !p.source) throw new Error('Projet Animer invalide');
  const image = (p.layers || []).find(l => l.kind === 'image') || { effects: [] };
  const defs = {}; for (const e of image.effects || []) if (!defs[e.effect]) defs[e.effect] = effectDef(engine, e.effect);
  const variants = {}; for (const l of p.layers || []) if (l.kind === 'particle') variants[l.folder + '/' + l.variant] = presetVariant(engine, l.folder, l.variant);
  const masks = p.masks || {};
  const built = buildScene(p, defs, variants, new Set(Object.keys(masks)));
  const stage = path.join(root, '.kaneapp-envoi-' + process.pid + '-' + Date.now());
  fs.mkdirSync(stage, { recursive: true });
  try {
    const binaries = { image: p.image, ...masks };
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
      const [folder, index] = key.split('/'), files = new Map();
      for (const ob of presetVariant(engine, folder, index).objects) loadSystem(engine, folder, ob.particle, files);
      for (const [rel, src] of files) { const dst = path.join(stage, rel); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
    }
    if (p.preview?.length) fs.writeFileSync(path.join(stage, 'preview.jpg'), Buffer.from(p.preview));
    else delete built.project.preview;
    // choix du dossier : celui du dernier envoi de ce projet s'il n'a pas été retouché depuis
    const slug = slugify(p.title);
    let target = null, keep = {};
    for (let i = 1; i < 100; i++) {
      const dir = path.join(root, i === 1 ? slug : slug + '_' + i);
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

module.exports = { locate, readTex, lz4, readJSON, effects, effectDef, presets, presetVariant, loadSystem, LEGACY_AMBIANCES, GROUPS, buildScene, exportProject, testWindow, apply, slugify, maskKey };

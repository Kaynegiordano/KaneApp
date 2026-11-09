// Studio Forge dans Kanevas : nouvelle image (nouveau document), image vers image
// (visages, mains, yeux), agrandir et détailler (MultiDiffusion), PNG Info (lecture, écriture, envoi au
// panneau), et l'IA en direct (rendu qui suit le dessin). Tout passe par le Forge local.
'use strict';
(() => {
  const U = KS.util, h = KS.h, ui = KS.ui, C = KS.cmd, G = KS.gen, N = KS.native;
  const D = () => KS.state.doc;
  const DEF = {
    size: { w: 1024, h: 1024 },
    i2iStrength: 0.5,
    md: { factor: 1.5, upscaler: '', tile: 1024, overlap: 64, method: 'Mixture of Diffusers', denoise: 0.3, steps: 20 },
    hr: { enabled: false, scale: 1.5, upscaler: '', steps: 0, denoise: 0.4, cfg: 0 },
    refiner: { model: '', at: 0.8 },
    batchCount: 1, varSeed: -1, varStrength: 0,
    sketchStrength: 0.85, inpaintFill: 1, maskBlur: 8, inpaintPad: 96, inpaintArea: 'zone', softInpaint: false, neverOom: false,
    live: { strength: 0.6, steps: 8, size: 768 },
  };
  G.studio = () => {
    const s = G.settings(), o = { ...DEF };
    for (const k in s) if (s[k] !== undefined) o[k] = s[k];
    for (const k of ['size', 'ad', 'md', 'live', 'hr', 'refiner']) o[k] = { ...DEF[k], ...(s[k] || {}) };
    return o;
  };
  const pngBytes = async c => new Uint8Array(await (await U.blobFromCanvas(c)).arrayBuffer());
  const scaled = (src, w, hh, sx = 0, sy = 0, sw = src.width, sh = src.height) => {
    const c = U.canvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(hh))), x = c.getContext('2d');
    x.imageSmoothingQuality = 'high'; x.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height); return c;
  };
  const r8 = v => Math.max(64, Math.round(v / 8) * 8);
  const mp1 = (w, hh, target = 1048576) => { const k = Math.sqrt(target / (w * hh)); return { W: U.clamp(Math.round(w * k / 64) * 64, 256, 2048), H: U.clamp(Math.round(hh * k / 64) * 64, 256, 2048) }; };

  /* ---------------------------------------------------------------- scripts (MultiDiffusion) */
  G.scriptsFor = async (st, kind, opt = {}) => {
    const s = {};
    if (opt.md) { const m = st.md || DEF.md; s['MultiDiffusion Integrated'] = { args: [true, m.method, +m.tile, +m.tile, +m.overlap, 1] }; }
    return s;
  };
  G.addScripts = (payload, scripts) => {
    if (scripts && typeof scripts.then === 'function') throw new Error('scripts asynchrones');
    if (!scripts || !Object.keys(scripts).length) return;
    payload.alwayson_scripts = { ...(payload.alwayson_scripts || {}), ...scripts };
  };
  const basePayload = (st, pp, W, H, n) => {
    const p = { prompt: pp.prompt, negative_prompt: pp.negative, steps: st.steps, cfg_scale: st.cfg, width: W, height: H, batch_size: U.clamp(n | 0, 1, 4), n_iter: 1,
      seed: st.seed != null && st.seed !== '' ? +st.seed : -1, save_images: false, send_images: true, ...pp.extra };
    if (pp.sampler) p.sampler_name = pp.sampler;
    if (pp.scheduler) p.scheduler = pp.scheduler;
    if (G.extraParams) Object.assign(p, G.extraParams(st, kindOf(st)));
    return p;
  };
  const kindOf = st => st._kind || 'img2img';
  const needForge = async () => {
    const f = await G.forge(true);
    if (!f) { KS.toast(G.forgeError() + ' : lancez Forge depuis Kane OS', 'err', 5000); return null; }
    return f;
  };
  const promptOf = p => (p ?? KS.state.lastPrompt ?? '').trim();

  /* ---------------------------------------------------------------- nouvelle image (nouveau document) */
  C.newImageDoc = async prompt => {
    const st = G.studio(), raw = promptOf(prompt);
    if (!raw) { KS.toast('Écrivez d\'abord l\'invite dans le panneau IA', 'info'); KS.panels.focus('generate'); return; }
    const forge = await needForge(); if (!forge) return;
    const W = r8(st.size.w), H = r8(st.size.h);
    try {
      const pp = await G.preparePrompt(raw, forge, st);
      const payload = basePayload({ ...st, _kind: 'txt' }, pp, W, H, st.count);
      G.addScripts(payload, await G.scriptsFor(st, 'txt'));
      const job = { txt: true, payload, W, H, R: { x: 0, y: 0, w: W, h: H } };
      if (payload.enable_hr) { job.outW = Math.round(W * payload.hr_scale / 8) * 8; job.outH = Math.round(H * payload.hr_scale / 8) * 8; job.R = { x: 0, y: 0, w: job.outW, h: job.outH }; }
      const res = await G.forgeRun(job); res.job = job;
      const nd = new KS.Doc({ name: raw.replace(/[\\/:*?"<>|]/g, '').slice(0, 40) || 'Image IA', width: job.R.w, height: job.R.h });
      KS.addDoc(nd);
      G.addGenLayer(nd, res, null, { name: 'Image IA', prompt: raw, hist: 'Générer une image', noMask: true, index: 0, icon: 'image' });
      if (pp.shown !== raw) KS.toast('Envoyé à Forge : « ' + pp.shown + ' »', 'info', 4000);
      return nd;
    } catch (e) { KS.toast('Génération impossible : ' + e.message, 'err', 6000); }
  };

  /* ---------------------------------------------------------------- image vers image */
  // L'image visible (ou la sélection) retravaillée ; le résultat arrive dans un calque, l'original reste dessous
  C.img2imgDoc = async prompt => {
    const d = D(); if (!d) return;
    const st = G.studio(), raw = promptOf(prompt);
    const forge = await needForge(); if (!forge) return;
    const sel = d.selection.active ? U.rectIntersect(U.rectInt(d.selection.bounds), d.rect) : null;
    const R = sel || d.rect;
    const { W, H } = mp1(R.w, R.h);
    try {
      const pp = await G.preparePrompt(raw || 'masterpiece, best quality', forge, st);
      const payload = { ...basePayload(st, pp, W, H, st.count), denoising_strength: st.i2iStrength, resize_mode: 0 };
      G.addScripts(payload, await G.scriptsFor(st, 'img2img'));
      const init = scaled(d.composite(), W, H, R.x, R.y, R.w, R.h);
      const job = { payload, W, H, R, init: await pngBytes(init), mask: null };
      const res = await G.forgeRun(job); res.job = job;
      const alpha = U.canvas(d.width, d.height); if (sel) alpha.getContext('2d').drawImage(d.selection.mask, 0, 0);
      return G.addGenLayer(d, res, alpha, { name: 'Image → image' + (raw ? ' : ' + raw.slice(0, 30) : ''), prompt: raw, hist: 'Image vers image', noMask: !sel, icon: 'image' });
    } catch (e) { KS.toast('Image vers image impossible : ' + e.message, 'err', 6000); }
  };

  /* ---------------------------------------------------------------- agrandir et détailler */
  // Agrandissement ESRGAN puis image vers image par tuiles (MultiDiffusion) à faible force : de vrais détails
  // à la nouvelle taille, sans recomposer l'image. Le résultat s'ouvre dans un nouveau document.
  C.upscaleDetail = async () => {
    const d = D(); if (!d) return;
    const st = G.studio(), m = st.md;
    const forge = await needForge(); if (!forge) return;
    const f = +m.factor || 1.5, W = r8(d.width * f), H = r8(d.height * f);
    if (Math.max(W, H) > 8192 || W * H > 40e6) { KS.toast('Résultat trop grand (8192 px de côté, 40 mégapixels au plus)', 'err', 4000); return; }
    const up = m.upscaler || (forge.upscalers || []).find(n => /ultrasharp/i.test(n)) || (forge.upscalers || [])[0] || 'Lanczos';
    try {
      const comp = d.composite();
      const r1 = await G.task('Agrandissement (' + up + ')…', async () => N.forgeUpscale(G.url(), { resize_mode: 1, upscaling_resize_w: W, upscaling_resize_h: H, upscaling_crop: false, upscaler_1: up, upscaler_2: 'None', extras_upscaler_2_visibility: 0, gfpgan_visibility: 0, codeformer_visibility: 0, show_extras_results: true }, await pngBytes(comp)));
      if (!r1.ok) throw new Error(r1.error);
      let big = await U.canvasFromBlob(new Blob([r1.image], { type: 'image/png' }));
      if (big.width !== W || big.height !== H) big = scaled(big, W, H);
      const pp = await G.preparePrompt(promptOf() || 'masterpiece, best quality, highly detailed', forge, st);
      const payload = { ...basePayload({ ...st, steps: m.steps }, pp, W, H, 1), denoising_strength: +m.denoise, resize_mode: 0 };
      G.addScripts(payload, await G.scriptsFor(st, 'img2img', { md: true }));
      const job = { payload, W, H, R: { x: 0, y: 0, w: W, h: H }, init: await pngBytes(big), mask: null };
      const res = await G.forgeRun(job); res.job = job;
      const nd = new KS.Doc({ name: d.name.replace(/\.[^.]+$/, '') + ` ×${f} détaillé`, width: W, height: H });
      KS.addDoc(nd);
      nd.addLayer(new KS.Layer({ name: 'Agrandi (' + up + ')', canvas: big }), 0);
      G.addGenLayer(nd, res, null, { name: 'Détails (MultiDiffusion)', hist: 'Agrandir et détailler', noMask: true, index: 1, icon: 'upscale' });
    } catch (e) { KS.toast('Agrandir et détailler impossible : ' + e.message, 'err', 6000); }
  };

  /* ---------------------------------------------------------------- PNG Info */
  // Paramètres de génération rangés dans les PNG (bloc « parameters », comme Forge) : lus à l'ouverture,
  // réécrits à l'export, et renvoyables au panneau IA.
  const PNG = KS.png = {};
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (bytes) => { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const isPng = u8 => u8 && u8.length > 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47;
  const inflate = async bytes => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  PNG.readText = async u8 => {
    const out = {};
    if (!isPng(u8)) return out;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), dec = new TextDecoder('utf-8'), lat = new TextDecoder('latin1');
    for (let o = 8; o + 12 <= u8.length;) {
      const len = dv.getUint32(o), type = String.fromCharCode(u8[o + 4], u8[o + 5], u8[o + 6], u8[o + 7]), data = u8.subarray(o + 8, o + 8 + len);
      if (type === 'tEXt') { const z = data.indexOf(0); if (z > 0) out[lat.decode(data.subarray(0, z))] = lat.decode(data.subarray(z + 1)); }
      else if (type === 'iTXt') {
        const z = data.indexOf(0); if (z > 0) {
          const key = lat.decode(data.subarray(0, z)), comp = data[z + 1];
          let p = z + 3; p = data.indexOf(0, p) + 1; p = data.indexOf(0, p) + 1;
          const body = data.subarray(p);
          try { out[key] = dec.decode(comp ? await inflate(body) : body); } catch { /* bloc illisible */ }
        }
      } else if (type === 'zTXt') { const z = data.indexOf(0); if (z > 0) try { out[lat.decode(data.subarray(0, z))] = lat.decode(await inflate(data.subarray(z + 2))); } catch { /* rien */ } }
      if (type === 'IEND') break;
      o += 12 + len;
    }
    return out;
  };
  // Le PNG a-t-il déjà un bloc texte de cette clé (tEXt, iTXt ou zTXt) ? Saute de bloc en bloc sans lire les pixels.
  PNG.hasText = (u8, key) => {
    if (!isPng(u8)) return false;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), k = new TextEncoder().encode(key + '\0');
    for (let o = 8; o + 12 <= u8.length;) {
      const len = dv.getUint32(o), type = String.fromCharCode(u8[o + 4], u8[o + 5], u8[o + 6], u8[o + 7]);
      if (type === 'IEND') return false;
      if ((type === 'tEXt' || type === 'iTXt' || type === 'zTXt') && len >= k.length && k.every((b, i) => u8[o + 8 + i] === b)) return true;
      o += 12 + len;
    }
    return false;
  };
  // Ajoute (ou remplace) un bloc texte UTF-8 (iTXt) juste avant la fin du PNG
  PNG.writeText = (u8, key, text) => {
    if (!isPng(u8)) return u8;
    const enc = new TextEncoder(), k = enc.encode(key), t = enc.encode(text);
    const data = new Uint8Array(k.length + 5 + t.length); data.set(k, 0); data.set(t, k.length + 5);
    const chunk = new Uint8Array(12 + data.length), cv = new DataView(chunk.buffer);
    cv.setUint32(0, data.length); chunk.set(enc.encode('iTXt'), 4); chunk.set(data, 8);
    cv.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let o = 8, end = -1;
    while (o + 12 <= u8.length) { const len = dv.getUint32(o); if (String.fromCharCode(u8[o + 4], u8[o + 5], u8[o + 6], u8[o + 7]) === 'IEND') { end = o; break; } o += 12 + len; }
    if (end < 0) return u8;
    const out = new Uint8Array(u8.length + chunk.length);
    out.set(u8.subarray(0, end), 0); out.set(chunk, end); out.set(u8.subarray(end), end + chunk.length);
    return out;
  };
  // Infotexte de Forge / A1111 → { prompt, negative, params: { Steps, Sampler… }, loras: [{ name, weight }] }
  PNG.parseInfo = text => {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    let pi = -1; for (let i = lines.length - 1; i >= 0; i--) if (/^Steps: /.test(lines[i])) { pi = i; break; }
    const head = (pi >= 0 ? lines.slice(0, pi) : lines).join('\n');
    const ni = head.indexOf('\nNegative prompt:');
    const prompt = (ni >= 0 ? head.slice(0, ni) : head.startsWith('Negative prompt:') ? '' : head).trim();
    const negative = ni >= 0 ? head.slice(ni + 17).trim() : head.startsWith('Negative prompt:') ? head.slice(16).trim() : '';
    const params = {};
    if (pi >= 0) for (const m of lines.slice(pi).join(', ').matchAll(/\s*([\w ./+-]+?):\s*("(?:\\.|[^\\"])*"|[^,]*)(?:,|$)/g)) params[m[1].trim()] = m[2].trim().replace(/^"|"$/g, '');
    const loras = [...prompt.matchAll(/<lora:([^:>]+):?([-\d.]*)>/g)].map(m => ({ name: m[1], weight: m[2] ? +m[2] : 1 }));
    return { prompt, negative, params, loras };
  };
  // Envoie un infotexte au panneau IA (invite, LoRA, réglages, taille, graine, modèle)
  G.applyInfo = async text => {
    const I = PNG.parseInfo(text), P = I.params;
    let cat = null; try { cat = N && N.forgeCatalog ? await N.forgeCatalog(G.url()) : null; } catch { /* hors ligne */ }
    const loras = I.loras.map(l => { const c = cat && cat.ok && cat.loras.find(x => x.name === l.name || x.alias === l.name); return { name: l.name, weight: l.weight, trigger: c ? c.trigger : '' }; });
    let prompt = I.prompt.replace(/<lora:[^>]+>/g, '').replace(/^\s*newest, year 2026, safe,\s*/i, '');
    for (const l of loras) if (l.trigger) prompt = prompt.split(l.trigger.replace(/,\s*$/, '')).join('');
    prompt = prompt.replace(/\s*,\s*,+/g, ',').replace(/^[\s,]+|[\s,]+$/g, '').replace(/\s{2,}/g, ' ');
    const o = { loras, negative: I.negative || G.settings().negative };
    if (P.Steps) o.steps = +P.Steps;
    if (P['CFG scale']) o.cfg = +P['CFG scale'];
    if (P.Shift) o.shift = +P.Shift;
    if (P.Sampler) o.sampler = P.Sampler;
    if (P['Schedule type']) o.scheduler = P['Schedule type'];
    if (P.Seed) o.seed = +P.Seed;
    if (P.Size) { const [w, hh] = P.Size.split('x').map(Number); if (w && hh) o.size = { w, h: hh }; }
    if (P.Model && cat && cat.ok) { const m = cat.models.find(x => x.name === P.Model || x.title.startsWith(P.Model + '.')); if (m) o.model = String(m.title).replace(/\s*\[[0-9a-f]{6,}\]$/i, '') === String(cat.current.model).replace(/\s*\[[0-9a-f]{6,}\]$/i, '') ? '' : m.title; }
    G.saveSettings(o);
    KS.state.lastPrompt = prompt;
    KS.genPanel && KS.genPanel.render();
    KS.panels.focus('generate');
    KS.toast('Réglages envoyés au panneau IA', 'ok', 1800);
  };
  C.pngInfo = async () => {
    const d = D();
    let text = d && d.genInfo || '';
    const ta = h('textarea.field', { rows: 9, style: { width: '100%', resize: 'vertical', font: '12px ui-monospace, Consolas, monospace' }, readonly: true });
    const table = h('div.form-grid.pi-grid');
    const show = t => {
      text = t || ''; ta.value = text || 'Aucune information de génération dans ce document.';
      table.innerHTML = '';
      if (!text) return;
      const I = PNG.parseInfo(text);
      const add = (k, v) => v && table.append(h('label.l', { text: k }), h('span.pi-v', { text: v }));
      add('LoRA', I.loras.map(l => l.name + ' ' + l.weight).join(', '));
      for (const k of ['Steps', 'Sampler', 'Schedule type', 'CFG scale', 'Seed', 'Size', 'Model', 'Denoising strength']) add(k, I.params[k]);
    };
    show(text);
    const open = ui.btn('Lire une autre image…', async () => {
      const files = KS.native ? await KS.native.openDialog({ title: 'Image à lire', multi: false, filters: [{ name: 'PNG', extensions: ['png'] }] }) : [];
      if (files && files[0]) { const t = await PNG.readText(new Uint8Array(files[0].data)); show(t.parameters || ''); if (!t.parameters) KS.toast('Ce PNG ne contient pas de paramètres de génération', 'info'); }
    }, '.small', 'folder-open');
    KS.modal({
      title: 'Infos de génération (PNG Info)', width: 620,
      body: h('div.form-col', { style: { gap: '10px' } }, ta, table),
      left: [open, ui.btn('Copier', () => { navigator.clipboard.writeText(text || ''); KS.toast('Copié', 'ok', 900); }, '.small', 'copy')],
      buttons: [{ label: 'Fermer', value: null }, { label: 'Envoyer au panneau IA', primary: true, value: 'ok', action: async () => { if (!text) return false; await G.applyInfo(text); } }],
    });
  };
  // ouverture : lire les paramètres ; export PNG : les réécrire
  const io = KS.io;
  const decode0 = io.decode, encode0 = io.encode;
  io.decode = async f => {
    const doc = await decode0(f);
    try { if (doc && /\.png$/i.test(f.name)) { const t = await PNG.readText(f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data)); if (t.parameters) doc.genInfo = t.parameters; } } catch { /* rien */ }
    return doc;
  };
  io.encode = async (doc, fmt, opts = {}) => {
    const data = await encode0(doc, fmt, opts);
    if (fmt === 'png' && doc && doc.genInfo && KS.prefs.keepGenInfo !== false) return PNG.writeText(data, 'parameters', doc.genInfo);
    return data;
  };

  /* ---------------------------------------------------------------- IA en direct */
  // Surprise : pendant que vous dessinez, Forge repeint l'image dans une fenêtre flottante (image vers image,
  // peu d'étapes, graine fixe pour rester cohérent d'un rendu à l'autre). « Poser en calque » garde un rendu.
  const LV = G.live = { on: false, el: null, busy: false, again: false, last: null };
  const liveRender = async () => {
    const d = D();
    if (!LV.on || !d) return;
    if (LV.busy) { LV.again = true; return; }
    LV.busy = true; LV.again = false;
    const st = G.studio(), status = LV.el.querySelector('.lv-status');
    try {
      const forge = await G.forge();
      if (!forge) { status.textContent = 'Forge non joint'; return; }
      const prog = await N.forgeProgress(G.url(), false);
      if (prog.ok && prog.jobs > 0) { status.textContent = 'Forge occupé…'; LV.again = true; return; }
      const k = Math.min(1, st.live.size / Math.max(d.width, d.height));
      const W = r8(d.width * k), H = r8(d.height * k);
      const raw = promptOf();
      const pp = await G.preparePrompt(raw || 'masterpiece, best quality', forge, { ...st, count: 1 });
      const seed = st.seed != null && +st.seed >= 0 ? +st.seed : (LV.seed ??= Math.floor(Math.random() * 2 ** 31));
      const payload = { ...basePayload({ ...st, steps: st.live.steps, seed }, pp, W, H, 1), denoising_strength: st.live.strength, resize_mode: 0 };
      if (payload.override_settings) payload.override_settings_restore_afterwards = false;   // pas de rechargement à chaque rendu
      status.textContent = 'Rendu…';
      const t0 = performance.now();
      const r = await N.forgeImg2img(G.url(), payload, await pngBytes(scaled(d.composite(), W, H)), null);
      if (!r.ok) throw new Error(r.error);
      const img = await U.canvasFromBlob(new Blob([r.images[r.images.length - 1]], { type: 'image/png' }));
      LV.last = { canvas: img, doc: d };
      const cv = LV.el.querySelector('canvas'); cv.width = img.width; cv.height = img.height; cv.getContext('2d').drawImage(img, 0, 0);
      status.textContent = `${Math.round(performance.now() - t0)} ms · ${W}×${H}`;
    } catch (e) { status.textContent = 'Erreur : ' + e.message; }
    finally { LV.busy = false; if (LV.again && LV.on) setTimeout(liveRender, 50); }
  };
  const liveQueue = U.debounce(() => liveRender(), 700);
  C.toggleLive = () => {
    if (LV.on) { LV.on = false; LV.el && LV.el.remove(); LV.el = null; KS.genPanel && KS.genPanel.render(); return; }
    if (!D()) return KS.toast('Ouvrez une image ou un document pour dessiner', 'info');
    LV.on = true; LV.seed = null;
    const cv = h('canvas.lv-canvas');
    const drag = h('div.lv-head', h('span', { html: KS.icon('sparkles') }), h('b', { text: 'IA en direct' }), h('span.lv-status', { text: 'Dessinez : le rendu suit.' }), h('div.spacer'),
      ui.iconBtn('history', 'Nouvelle graine', () => { LV.seed = null; liveQueue(); }, '.sm'),
      ui.iconBtn('layers', 'Poser ce rendu en calque', () => {
        const L0 = LV.last; if (!L0 || L0.doc !== D()) return KS.toast('Pas encore de rendu', 'info');
        const d = D(), c = scaled(L0.canvas, d.width, d.height);
        const L = new KS.Layer({ name: 'IA en direct', canvas: c });
        KS.Hist.structure(d, 'IA en direct', () => d.addLayer(L, C.insertIndex(d, L)), 'sparkles');
      }, '.sm'),
      ui.iconBtn('close', 'Fermer', () => C.toggleLive(), '.sm'));
    LV.el = h('div.lv-win', drag, cv, h('div.note.lv-note', { text: 'Image vers image, ' + G.studio().live.steps + ' étapes, force ' + Math.round(G.studio().live.strength * 100) + ' % (réglages dans le panneau IA). Invite et LoRA du panneau.' }));
    drag.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      const r = LV.el.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
      drag.setPointerCapture(e.pointerId);
      const mv = ev => { LV.el.style.left = r.left + ev.clientX - x0 + 'px'; LV.el.style.top = r.top + ev.clientY - y0 + 'px'; LV.el.style.right = 'auto'; };
      const up = () => { drag.removeEventListener('pointermove', mv); drag.removeEventListener('pointerup', up); };
      drag.addEventListener('pointermove', mv); drag.addEventListener('pointerup', up);
    });
    document.body.appendChild(LV.el);
    KS.genPanel && KS.genPanel.render();
    liveRender();
  };
  for (const ev of ['history', 'doc']) KS.on(ev, () => { if (LV.on) liveQueue(); });
})();

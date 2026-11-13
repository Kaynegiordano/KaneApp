// IA générative, façon Photoshop 2026 : outil Suppression et remplissage sans invite (LaMa, local),
// remplissage génératif, développement génératif et super résolution (Forge local, lancé par
// Kane OS), Harmoniser, pinceau de réglage. Rien ne part en ligne.
'use strict';
(() => {
  const U = KS.util, h = KS.h, ui = KS.ui, C = KS.cmd, T = KS.tools, V = KS.view;
  const N = KS.native, ai = KS.ai;
  const G = KS.gen = {};
  const D = () => KS.state.doc;

  /* ---------------------------------------------------------------- outils communs */
  const scaled = (src, w, hh, sx = 0, sy = 0, sw = src.width, sh = src.height) => {
    const c = U.canvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(hh))), x = c.getContext('2d');
    x.imageSmoothingQuality = 'high'; x.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  };
  const pngBytes = async c => new Uint8Array(await (await U.blobFromCanvas(c)).arrayBuffer());
  const fromPng = u8 => U.canvasFromBlob(new Blob([u8], { type: 'image/png' }));
  // Dilatation d'un masque (alpha) d'environ r pixels : flou puis seuil
  const dilate = (m, r) => {
    if (r < 0.5) return m;
    const b = U.blurCanvas(m, r / 2), d = U.getData(b), px = d.data;
    for (let i = 3; i < px.length; i += 4) px[i] = px[i] > 8 ? 255 : 0;
    U.putData(b, d); return b;
  };
  // Masque alpha → image noir et blanc (blanc = zone à générer), pour Forge
  const bwMask = (m, w, hh, sx, sy, sw, sh) => {
    const c = U.canvas(w, hh), x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, w, hh);
    const t = scaled(m, w, hh, sx, sy, sw, sh), tx = t.getContext('2d');
    tx.globalCompositeOperation = 'source-in'; tx.fillStyle = '#fff'; tx.fillRect(0, 0, w, hh);
    x.drawImage(t, 0, 0);
    return c;
  };
  // Masque de fusion d'un calque (niveaux de gris) à partir d'un masque alpha, limité au rectangle R
  const layerMaskFrom = (alpha, R, feather) => {
    const c = U.canvas(R.w, R.h), x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, R.w, R.h);
    const t = U.canvas(R.w, R.h), tx = t.getContext('2d');
    tx.drawImage(alpha, -R.x, -R.y);
    const s = feather > 0 ? U.blurCanvas(dilate(t, feather), feather) : t, sx = s.getContext('2d');
    sx.globalCompositeOperation = 'source-in'; sx.fillStyle = '#fff'; sx.fillRect(0, 0, R.w, R.h);
    x.drawImage(s, 0, 0);
    return { canvas: c, ctx: x, x: R.x, y: R.y, enabled: true, linked: true, alpha: null, outside: 0 };
  };
  // Fusionne les n dernières étapes de l'historique en une seule
  G.mergeLast = (doc, n, name, icon) => {
    const H = doc.history;
    if (n < 2 || H.pos !== H.items.length - 1 || H.pos < n) return;
    const parts = H.items.splice(H.pos - n + 1, n);
    H.items.push(KS.Hist.combine(name, icon, parts));
    H.pos = H.items.length - 1;
    KS.emit('history', doc);
  };

  // Tâche longue : voile avec message, progression et bouton Annuler
  // progress() renvoie un nombre (0…1) ou { p, step, steps, image } : l'image est l'aperçu en direct de Forge
  G.task = async (label, fn, { cancel, progress } = {}) => {
    const txt = h('span', { text: label }), pct = h('span.gen-pct');
    const shot = h('img.gen-live', { alt: '', hidden: true });
    const card = h('div.gen-card', h('div.gen-row', h('div.spin'), h('div.gen-txt', txt, pct), cancel ? ui.btn('Annuler', () => { cancel(); txt.textContent = 'Annulation…'; }, '.small') : null), shot);
    const back = h('div.busy.gen-busy', card);
    document.body.appendChild(back);
    let timer = null, busy = false, url = null;
    if (progress) timer = setInterval(async () => {
      if (busy) return; busy = true;
      try {
        const r = await progress();
        const p = typeof r === 'number' ? r : r && r.p;
        if (p != null) pct.textContent = Math.round(p * 100) + ' %' + (r && r.steps ? ` · étape ${r.step || 0} / ${r.steps}` : '');
        else if (r && r.text) pct.textContent = String(r.text).slice(0, 90);
        if (r && r.image) { if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(new Blob([r.image], { type: 'image/png' })); shot.src = url; shot.hidden = false; }
      } catch { /* rien */ } finally { busy = false; }
    }, 900);
    await new Promise(r => setTimeout(r, 30));     // laisse s'afficher le voile (rAF est suspendu fenêtre masquée)
    try { return await (KS.suite ? KS.suite.run(label, fn) : fn()); } finally { clearInterval(timer); back.remove(); if (url) URL.revokeObjectURL(url); }
  };

  /* ---------------------------------------------------------------- réglages et état de Forge */
  // v2 (1.0.7) : force 85 % (l'objet se fond mieux dans l'image), réglages des versions précédentes oubliés
  // Panneau IA (1.0.8) : modèle, VAE et encodeur ('' = ceux chargés dans Forge), LoRA [{ name, weight, trigger }],
  // échantillonneur et planificateur ('' = réglage du modèle), graine (-1 = au hasard)
  const GEN_DEFAULTS = { negative: 'lowres, blurry, watermark, text, signature, jpeg artifacts', count: 3, strength: 0.85, steps: 30, cfg: 4.5, url: 'http://127.0.0.1:7860', v: 2,
    model: '', vae: '', te: '', loras: [], sampler: '', scheduler: '', seed: -1, shift: 3, usePrefix: true, useTriggers: true, keepLoaded: false };
  G.settings = () => { const p = KS.prefs.genAI || {}; return Object.assign({ prompt: '' }, GEN_DEFAULTS, p.v === 2 ? p : (p.url ? { url: p.url } : {})); };
  G.saveSettings = o => { const s = { ...G.settings(), ...o, v: 2 }; delete s.prompt; KS.prefs.genAI = s; KS.prefs.save(); };

  /* ---------------------------------------------------------------- invite : traduction et réglages du modèle */
  // Les modèles d'image ne comprennent que l'anglais : en français, anima dessine une fille au hasard.
  const FR = /[àâäçéèêëîïôöûùüÿœæ]|\b(le|la|les|un|une|des|du|de|d'|l'|sur|dans|avec|et|au|aux|sous|pour|qui|petite?s?|grande?s?|rouges?|bleue?s?|verte?s?|noire?s?|blanche?s?|ciel|arbres?|chat|chien|fleurs?|montagnes?|mer|eau|maison|voiture|oiseaux?|poissons?|nuages?|soleil|lune|herbe|bois|pierre|rocher)\b/i;
  G.looksFrench = t => FR.test(t || '');
  // « ajoute un bateau » : le verbe d'ordre n'est pas une description, on le retire
  const stripCmd = t => t.replace(/^\s*(ajoute[rz]?|rajoute[rz]?|mets|mettre|place[rz]?|dessine[rz]?|g[ée]n[èe]re[rz]?|cr[ée]e[rz]?|fais|faire|ins[èe]re[rz]?|add|draw|put|generate|create|make)\s+(moi\s+|me\s+)?/i, '');
  let mtOk = false;
  G.mtReady = async (ask = true) => {
    if (!N || !N.aiTranslate) return false;
    if (mtOk) return true;
    const m = (await N.aiStatus()).find(x => x.id === 'translate-fr-en');
    if (!m) return false;
    if (m.installed) return (mtOk = true);
    if (!ask) return false;
    const id = await ai.downloadDialog([m], {
      title: 'Traduire les invites en anglais',
      text: 'Forge et son modèle ne comprennent que l\'anglais : une invite en français donne des images sans rapport (souvent une fille). KaneApp peut la traduire sur votre PC avec Opus-MT (licence CC-BY 4.0, 113 Mo, téléchargé une fois depuis Hugging Face).',
    });
    return (mtOk = !!id);
  };
  G.toEnglish = async (text, ask = true) => {
    const t = stripCmd((text || '').trim());
    if (!t || !G.looksFrench(t)) return t;
    if (!(await G.mtReady(ask))) return null;
    const r = await N.aiTranslate(t);
    if (!r.ok) throw new Error('traduction : ' + r.error);
    return stripCmd(r.text);
  };
  // Réglages propres au modèle actif de Forge
  G.modelPreset = model => /anima/i.test(model || '')
    ? { prefix: 'newest, year 2026, safe, ', sampler: 'ER SDE', scheduler: 'simple', style: 'anime' }
    : { prefix: '', sampler: null, scheduler: null, style: null };
  const PERSON = /\b(girls?|wom[ae]n|m[ae]n|boys?|persons?|people|humans?|lady|ladies|child(ren)?|kids?|characters?|faces?|portrait|warriors?|knights?|princess|mermaids?|witch|elf|elves|she|he|her|his|couple|crowd|soldiers?|robot)\b/i;
  const NO_PERSON = '1girl, girl, woman, 1boy, boy, man, person, people, human, character, face';
  // Invite finale envoyée à Forge
  // Modèle et modules demandés, s'ils diffèrent de ceux chargés dans Forge : changés le temps de la requête
  G.overrides = (o, forge) => {
    const cur = (forge && forge.current) || {};
    const ov = {};
    const nm = t => String(t || '').replace(/\s*\[[0-9a-f]{6,}\]$/i, '');
    if (o.model && nm(o.model) !== nm(cur.model || forge?.model)) ov.sd_model_checkpoint = o.model;
    if (o.vae || o.te) {
      const mods = (cur.modules || []).slice(), isVae = f => /[\\/]vae[\\/]|vae/i.test(f), isTe = f => /[\\/](text_encoder|clip)[\\/]/i.test(f);
      const next = mods.filter(f => !(o.vae && isVae(f)) && !(o.te && isTe(f)));
      if (o.vae) next.push(o.vae); if (o.te) next.push(o.te);
      if (JSON.stringify(next.slice().sort()) !== JSON.stringify(mods.slice().sort())) ov.forge_additional_modules = next;
    }
    return Object.keys(ov).length ? { override_settings: ov, override_settings_restore_afterwards: !o.keepLoaded } : {};
  };
  G.preparePrompt = async (raw, forge, o) => {
    let en = await G.toEnglish(raw);
    if (en == null) { en = stripCmd(raw.trim()); KS.toast('Invite envoyée en français : le résultat risque d\'être sans rapport. Écrivez-la en anglais pour de meilleurs résultats.', 'info', 6000); }
    const pre = G.modelPreset(o.model || (forge && forge.model));
    const loras = (o.loras || []).filter(l => l.name && l.weight);
    const trig = o.useTriggers ? loras.map(l => (l.trigger || '').replace(/,\s*$/, '')).filter(Boolean) : [];
    const tags = loras.map(l => `<lora:${l.name}:${+(+l.weight).toFixed(2)}>`);
    const person = PERSON.test(en) || loras.length > 0 && /girl|woman|man|boy|eve|evie/i.test(trig.join(' '));
    const neg = [o.negative, person ? '' : NO_PERSON, 'nsfw, nude'].filter(Boolean).join(', ');
    const prompt = [(o.usePrefix !== false ? pre.prefix : '') + [...trig, en].filter(Boolean).join(', '), ...tags].join(' ');
    // « Shift » des modèles à flux (anima) = distilled_cfg_scale de l'API (3,5 par défaut là-bas, 3 dans Forge)
    const extra = { ...G.overrides(o, forge), distilled_cfg_scale: +o.shift || 3 };
    return { prompt, negative: neg, sampler: o.sampler || pre.sampler, scheduler: o.scheduler || pre.scheduler, shown: en, extra };
  };
  let forgeCache = null;
  // Adresse du moteur : celui que Kanevas démarre (engine.js), sinon l'adresse réglée à la main
  G.url = () => (KS.engine && KS.engine.url) || G.settings().url;
  G.forge = async (fresh = false, opts = {}) => {
    if (!N || !N.forgeStatus) return null;
    if (!fresh && forgeCache && Date.now() - forgeCache.t < 15000) return forgeCache.s;
    if (KS.engine && !opts.noStart && !(await KS.engine.ensure())) { forgeCache = { t: Date.now(), s: null, err: KS.engine.error || 'Moteur IA arrêté' }; return null; }
    const r = await N.forgeStatus(G.url());
    forgeCache = { t: Date.now(), s: r.ok ? r : null, err: r.error };
    return forgeCache.s;
  };
  G.forgeError = () => forgeCache?.err || 'Forge n\'est pas démarré';
  const forgeProgress = async () => { const r = await N.forgeProgress(G.url(), true); return r && r.ok ? { p: r.progress, step: r.step, steps: r.steps, image: r.image } : null; };
  G.forgeProgress = forgeProgress;

  /* ---------------------------------------------------------------- LaMa (suppression) */
  let lamaOk = false;
  G.lamaReady = async (ask = true) => {
    if (!N || !N.aiInpaint) return false;
    if (lamaOk) return true;
    const m = (await N.aiStatus()).find(x => x.id === 'lama');
    if (!m) return false;
    if (m.installed) { N.aiWarm && N.aiWarm('lama'); return (lamaOk = true); }
    if (!ask) return false;
    const id = await ai.downloadDialog([m], {
      title: 'Télécharger le modèle de suppression',
      text: 'L\'outil Suppression et le remplissage sans invite utilisent le modèle LaMa (licence Apache 2.0, 208 Mo), qui tourne entièrement sur votre PC (carte graphique via DirectML si possible). Il faut le télécharger une fois depuis Hugging Face.',
    });
    if (id && N.aiWarm) N.aiWarm('lama');
    return (lamaOk = !!id);
  };
  ai.ensureInpaint = G.lamaReady;

  // Remplit la zone `mask` (alpha, mêmes coordonnées que src) dont la boîte est B.
  // Renvoie { raw, fill, rect } : raw = résultat sur tout le rectangle, fill = seulement la zone, fondue.
  G.inpaint = async (src, mask, B) => {
    const want = Math.max(B.w, B.h) * 2 + 96;
    const cw = Math.min(src.width, Math.max(B.w, Math.round(want))), ch = Math.min(src.height, Math.max(B.h, Math.round(want)));
    const R = { x: U.clamp(Math.round(B.x + B.w / 2 - cw / 2), 0, src.width - cw), y: U.clamp(Math.round(B.y + B.h / 2 - ch / 2), 0, src.height - ch), w: cw, h: ch };
    const S = 512;
    const img = U.canvas(S, S), ix = img.getContext('2d');
    ix.fillStyle = '#808080'; ix.fillRect(0, 0, S, S);
    ix.imageSmoothingQuality = 'high'; ix.drawImage(src, R.x, R.y, R.w, R.h, 0, 0, S, S);
    const mk = dilate(scaled(mask, S, S, R.x, R.y, R.w, R.h), 6);
    const md = U.getData(mk).data, mb = new Uint8Array(S * S);
    for (let i = 0; i < mb.length; i++) mb[i] = md[i * 4 + 3];
    const r = await N.aiInpaint(U.getData(img).data, mb);
    if (!r.ok) throw new Error(r.error);
    const out = U.canvas(S, S); U.putData(out, new ImageData(new Uint8ClampedArray(r.rgba), S, S));
    const raw = scaled(out, R.w, R.h);
    // la zone d'origine (élargie de quelques pixels), adoucie, sert à fondre le résultat
    const k = Math.max(R.w, R.h) / S;
    const fm = U.canvas(R.w, R.h); fm.getContext('2d').drawImage(mask, -R.x, -R.y);
    const soft = U.blurCanvas(dilate(fm, Math.max(3, 4 * k)), Math.max(1, 1.5 * k));
    const fill = U.copyCanvas(raw), fx = fill.getContext('2d');
    fx.globalCompositeOperation = 'destination-in'; fx.drawImage(soft, 0, 0);
    G.lastEP = r.ep;
    return { raw, fill, rect: R };
  };

  /* ---------------------------------------------------------------- Forge (génération) */
  // Génère count variantes pour la zone `mask` de src (canevas complets, mêmes dimensions).
  // whole : génère sur toute l'image (développement) ; sinon autour de la zone, avec une marge de contexte.
  G.forgeGenerate = async (src, mask, B, o, whole = false) => {
    let R;
    if (whole) R = { x: 0, y: 0, w: src.width, h: src.height };
    else {
      // marge de contexte autour de la zone : réglée dans le Studio (inpaintPad), sinon 35 % de la zone
      const pad = o.pad != null ? Math.max(16, +o.pad) : Math.round(Math.max(B.w, B.h) * 0.35 + 32);
      R = U.rectIntersect(U.rectInt({ x: B.x - pad, y: B.y - pad, w: B.w + pad * 2, h: B.h + pad * 2 }), { x: 0, y: 0, w: src.width, h: src.height });
    }
    // environ 1 mégapixel, côtés multiples de 64 (taille de travail des modèles récents)
    const k = Math.sqrt((o.megapixels || 1) * 1048576 / (R.w * R.h));
    const W = U.clamp(Math.round(R.w * k / 64) * 64, 256, 2048), H = U.clamp(Math.round(R.h * k / 64) * 64, 256, 2048);
    const init = U.canvas(W, H), ix = init.getContext('2d');
    ix.fillStyle = '#808080'; ix.fillRect(0, 0, W, H);
    ix.imageSmoothingQuality = 'high'; ix.drawImage(src, R.x, R.y, R.w, R.h, 0, 0, W, H);
    const mimg = bwMask(dilate(scaled(mask, W, H, R.x, R.y, R.w, R.h), 6), W, H, 0, 0, W, H);
    const payload = {
      prompt: o.prompt, negative_prompt: o.negative || '', steps: o.steps, cfg_scale: o.cfg, denoising_strength: o.strength,
      width: W, height: H, batch_size: U.clamp(o.count | 0, 1, 4), n_iter: 1, seed: o.seed != null && o.seed !== '' ? +o.seed : -1,
      mask_blur: o.maskBlur != null ? +o.maskBlur : 12, inpainting_fill: o.fill != null ? +o.fill : 1, inpaint_full_res: false, inpainting_mask_invert: 0, resize_mode: 0,
      save_images: false, send_images: true,
    };
    if (G.extraParams) Object.assign(payload, G.extraParams(o, 'inpaint'));
    if (o.sampler) payload.sampler_name = o.sampler;
    if (o.scheduler) payload.scheduler = o.scheduler;
    Object.assign(payload, o.extra || {});
    if (G.scriptsFor) G.addScripts(payload, await G.scriptsFor(o, 'inpaint'));
    const job = { init: await pngBytes(init), mask: await pngBytes(mimg), payload, W, H, R };
    return { ...(await G.forgeRun(job)), job };
  };
  G.forgeRun = async job => {
    let stop = false;
    const label = job.label || (job.payload.override_settings?.sd_model_checkpoint ? 'Changement de modèle puis génération avec Forge…' : 'Génération avec Forge…');
    const r = await G.task(label, () => job.txt ? N.forgeTxt2img(G.url(), job.payload) : N.forgeImg2img(G.url(), job.payload, job.init, job.mask),
      { cancel: () => { stop = true; N.forgeInterrupt(G.url()); }, progress: N.forgeProgress ? forgeProgress : null });
    if (!r.ok) throw new Error(r.error);
    const imgs = [];
    // taille attendue : celle de la requête, ou après le hires fix
    const OW = job.outW || job.W, OH = job.outH || job.H;
    for (const u8 of r.images) { const c = await fromPng(u8); if (c.width === OW && c.height === OH) imgs.push(c); }
    if (!imgs.length) throw new Error(stop ? 'Génération annulée' : 'Forge n\'a renvoyé aucune image');
    let infos = [];
    try { const info = r.info && JSON.parse(r.info); if (info && info.seed != null) G.lastSeed = info.seed; infos = (info && info.infotexts) || []; } catch { /* rien */ }
    // une éventuelle grille ou image de masque arrive en tête
    const n = (job.payload.batch_size || 1) * (job.payload.n_iter || 1);
    const res = { variants: imgs.slice(-n).map(c => c.width === job.R.w && c.height === job.R.h ? c : scaled(c, job.R.w, job.R.h)), rect: job.R, infos: infos.slice(-n) };
    if (G.onResults) G.onResults(res, job);
    return res;
  };

  /* ---------------------------------------------------------------- calques générés */
  // Nouveau calque au-dessus du calque actif : l'image générée sur tout le rectangle, et un
  // masque de fusion (la zone demandée, adoucie) pour la fondre ; les variantes restent en mémoire.
  G.addGenLayer = (doc, res, alpha, info) => {
    const R = res.rect;
    const L = new KS.Layer({ name: info.name, canvas: U.copyCanvas(res.variants[0]), x: R.x, y: R.y });
    if (!info.noMask) { L.mask = layerMaskFrom(alpha, R, info.feather ?? U.clamp(Math.max(R.w, R.h) * 0.006, 1.5, 10)); L.maskChanged(); }
    L._gen = { variants: res.variants, i: 0, job: res.job || null, prompt: info.prompt || '', infos: res.infos || [], preserveDocumentParams: !!info.preserveDocumentParams };
    if (!info.preserveDocumentParams && res.infos && res.infos[0]) doc.genInfo = res.infos[0];
    const at = info.index ?? C.insertIndex(doc, L);
    KS.Hist.structure(doc, info.hist || 'Remplissage génératif', () => doc.addLayer(L, at), info.icon || 'sparkles');
    KS.emit('active-layer', doc); KS.emit('gen', doc);
    return L;
  };
  G.setVariant = (doc, L, i) => {
    const g = L._gen; if (!g) return;
    i = (i + g.variants.length) % g.variants.length;
    const v = g.variants[i];
    if (v.width !== L.canvas.width || v.height !== L.canvas.height) { KS.toast('Le calque a été modifié : ses variantes ne s\'appliquent plus', 'info'); return; }
    const tok = KS.Hist.begin(L);
    L.ctx.clearRect(0, 0, v.width, v.height); L.ctx.drawImage(v, 0, 0); L.touch();
    KS.Hist.commitPixels(doc, 'Variante ' + (i + 1), tok, { x: 0, y: 0, w: v.width, h: v.height }, 'sparkles');
    g.i = i;
    if (!g.preserveDocumentParams && g.infos && g.infos[i]) doc.genInfo = g.infos[i];
    KS.emit('layer-pixels', doc); KS.emit('gen', doc);
  };
  G.generateMore = async (doc, L) => {
    const g = L?._gen; if (!g) return;
    if (!g.job) { KS.toast('Ces variantes viennent de l\'IA locale : refaites une sélection pour générer à nouveau', 'info', 3500); return; }
    if (!(await G.forge(true))) { KS.toast(G.forgeError() + ' : lancez Forge depuis Kane OS', 'err', 4000); return; }
    try {
      const res = await G.forgeRun(g.job);
      g.variants.push(...res.variants);
      g.infos = (g.infos || []).concat(res.infos || []);
      G.setVariant(doc, L, g.variants.length - res.variants.length);
    } catch (e) { KS.toast(e.message, 'err', 5000); }
  };

  /* ---------------------------------------------------------------- remplissage génératif */
  // Remplit la zone (masque alpha en coordonnées document) : avec une invite, Forge génère ;
  // sans invite, LaMa remplit avec les alentours (comme Photoshop).
  G.fillRegion = async (doc, alpha, B, o, info = {}) => {
    const prompt = (o.prompt || '').trim();
    const src = doc.composite();
    try {
      if (prompt) {
        const forge = await G.forge(true);
        if (!forge) { KS.toast(G.forgeError() + ' : lancez Forge depuis Kane OS. Sans invite, la zone est remplie par l\'IA locale.', 'err', 6000); return null; }
        const st = { ...G.settings(), ...o };
        const pp = await G.preparePrompt(prompt, forge, st);
        const res = await G.forgeGenerate(src, alpha, B, { ...st, ...pp });
        if (pp.shown !== prompt) KS.toast('Envoyé à Forge : « ' + pp.shown + ' »', 'info', 5000);
        return G.addGenLayer(doc, res, alpha, { name: 'Génératif : ' + prompt.slice(0, 40), prompt, ...info });
      }
      if (!(await G.lamaReady(true))) return null;
      const r = await G.task('Suppression par l\'IA locale…', () => G.inpaint(src, alpha, B));
      return G.addGenLayer(doc, { variants: [r.raw], rect: r.rect }, alpha, { name: info.name || 'Suppression', hist: info.hist || 'Supprimer', icon: 'remove', feather: U.clamp(Math.max(B.w, B.h) * 0.01, 1.5, 8), ...info });
    } catch (e) { KS.toast('Génération impossible : ' + e.message, 'err', 6000); return null; }
  };

  // Boîte de l'invite (paramètres avancés compris)
  G.promptDialog = ({ title = 'Remplissage génératif', expand = false, extra = null } = {}) => new Promise(async res => {
    const s = G.settings();
    const ta = h('textarea.field', { rows: 3, placeholder: expand ? 'Ce qu\'il faut voir autour (vide : prolonger l\'image avec l\'IA locale)' : 'Décrivez ce qu\'il faut générer (vide : remplir avec les alentours, IA locale)', style: { width: '100%', resize: 'vertical' } });
    ta.value = KS.state.lastPrompt || '';
    const neg = h('input.field', { type: 'text', value: s.negative, style: { width: '100%' } });
    const vals = { count: s.count, strength: s.strength, steps: s.steps, cfg: s.cfg };
    const url = h('input.field', { type: 'text', value: s.url, style: { width: '100%' } });
    const status = h('div.note', { text: 'Forge : vérification…' });
    const sent = h('div.note', { style: { minHeight: '16px' } });
    let fState = null, tseq = 0;
    const showSent = U.debounce(async () => {
      const n = ++tseq, raw = ta.value.trim();
      if (!raw) { sent.textContent = ''; return; }
      const pre = G.modelPreset(fState && fState.model);
      if (G.looksFrench(raw) && !(await G.mtReady(false))) { sent.textContent = 'Invite en français : elle sera traduite en anglais sur votre PC (petit modèle de 113 Mo à télécharger une fois).'; return; }
      try { const en = await G.toEnglish(raw, false); if (n === tseq) sent.textContent = 'Envoyé à Forge : ' + pre.prefix + en; } catch { sent.textContent = ''; }
    }, 450);
    ta.addEventListener('input', showSent);
    const adv = h('div.form-grid', { hidden: true },
      h('label.l', { text: 'À éviter' }), neg,
      h('label.l', { text: 'Variantes' }), ui.seg([['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']], String(vals.count), v => { vals.count = +v; }),
      h('label.l', { text: 'Force' }), ui.scrub({ value: Math.round(vals.strength * 100), min: 30, max: 100, unit: '%', onInput: v => { vals.strength = v / 100; } }),
      h('label.l', { text: 'Étapes' }), ui.scrub({ value: vals.steps, min: 4, max: 80, onInput: v => { vals.steps = v; } }),
      h('label.l', { text: 'Échelle CFG' }), ui.scrub({ value: vals.cfg, min: 1, max: 15, step: 0.5, onInput: v => { vals.cfg = v; } }),
      h('label.l', { text: 'Adresse de Forge' }), url);
    const advBtn = ui.btn('Paramètres avancés', () => { adv.hidden = !adv.hidden; }, '.small', 'settings');
    const body = h('div.form-col', { style: { width: '520px', gap: '10px' } }, extra, ta, sent, status, advBtn, adv);
    KS.modal({
      title, body,
      buttons: [{ label: 'Annuler', value: null }, { label: 'Générer', primary: true, value: 'ok' }],
      onClose: v => {
        if (v !== 'ok') return res(null);
        const o = { ...vals, negative: neg.value, url: url.value.trim() || 'http://127.0.0.1:7860' };
        G.saveSettings(o);
        KS.state.lastPrompt = ta.value;
        res({ ...o, prompt: ta.value });
      },
    });
    const f = fState = await G.forge(true);
    showSent();
    const style = f && G.modelPreset(f.model).style;
    status.textContent = f ? `Forge prêt : ${String(f.model || 'modèle actif').replace(/\.safetensors.*$/, '')}${style === 'anime' ? ' (modèle de style anime : le résultat suivra ce style)' : ''}. Écrivez en français ou en anglais.` : `${G.forgeError()} : seule la génération sans invite (IA locale) est possible. Lancez Forge depuis Kane OS pour les invites.`;
    status.style.color = f ? 'var(--text-2)' : 'var(--danger, #d05050)';
  });

  // Supprimer la sélection avec l'IA : le remplissage va dans un nouveau calque
  C.removeSelection = async () => {
    const d = D(); if (!d) return;
    if (!d.selection.active) { KS.toast('Sélectionnez d\'abord l\'élément à supprimer', 'info'); return; }
    const B = U.rectIntersect(U.rectInt(d.selection.bounds), d.rect); if (!B) return;
    if (!(await G.lamaReady(true))) { C.contentAwareFill(d); return; }
    await G.fillRegion(d, U.copyCanvas(d.selection.mask), B, { prompt: '' }, { name: 'Suppression', hist: 'Supprimer avec l\'IA' });
  };

  /* ---------------------------------------------------------------- générer une image (txt2img) */
  // Nouvelle image dans un calque : elle couvre la sélection (avec son masque) ou toute la zone de travail
  C.generateImage = async (prompt, opts = {}) => {
    const d = D(); if (!d) return;
    const st = { ...G.settings(), ...opts };
    const raw = (prompt ?? st.prompt ?? '').trim();
    if (!raw) { KS.toast('Décrivez l\'image à générer (panneau IA)', 'info'); KS.panels.focus('generate'); return; }
    const forge = await G.forge(true);
    if (!forge) { KS.toast(G.forgeError() + ' : lancez Forge depuis Kane OS', 'err', 5000); return; }
    const sel = d.selection.active ? U.rectIntersect(U.rectInt(d.selection.bounds), d.rect) : null;
    const R = sel || d.rect;
    const k = Math.sqrt(1048576 / (R.w * R.h));
    const W = U.clamp(Math.round(R.w * k / 64) * 64, 256, 2048), H = U.clamp(Math.round(R.h * k / 64) * 64, 256, 2048);
    try {
      const pp = await G.preparePrompt(raw, forge, st);
      const payload = { prompt: pp.prompt, negative_prompt: pp.negative, steps: st.steps, cfg_scale: st.cfg, width: W, height: H,
        batch_size: U.clamp(st.count | 0, 1, 4), n_iter: 1, seed: st.seed != null && st.seed !== '' ? +st.seed : -1, save_images: false, send_images: true, ...pp.extra };
      if (pp.sampler) payload.sampler_name = pp.sampler;
      if (pp.scheduler) payload.scheduler = pp.scheduler;
      if (G.scriptsFor) G.addScripts(payload, await G.scriptsFor(st, 'txt'));
      if (G.extraParams) Object.assign(payload, G.extraParams(st, 'txt'));
      const job = { txt: true, payload, W, H, R };
      if (payload.enable_hr) { job.outW = Math.round(W * payload.hr_scale / 8) * 8; job.outH = Math.round(H * payload.hr_scale / 8) * 8; }
      const res = await G.forgeRun(job);
      if (pp.shown !== raw) KS.toast('Envoyé à Forge : « ' + pp.shown + ' »', 'info', 5000);
      res.job = job;
      const alpha = U.canvas(d.width, d.height), ax = alpha.getContext('2d');
      if (sel) ax.drawImage(d.selection.mask, 0, 0); else { ax.fillStyle = '#fff'; ax.fillRect(0, 0, d.width, d.height); }
      return G.addGenLayer(d, res, alpha, { name: 'Image : ' + raw.slice(0, 40), prompt: raw, hist: 'Générer une image', feather: sel ? undefined : 0 });
    } catch (e) { KS.toast('Génération impossible : ' + e.message, 'err', 6000); }
  };

  /* ---------------------------------------------------------------- développement génératif */
  const RATIOS = [['margin', 'Marges seulement'], ['1:1', 'Carré 1:1'], ['4:3', '4:3'], ['3:2', '3:2'], ['16:9', '16:9'], ['21:9', '21:9'], ['3:4', '3:4 (portrait)'], ['2:3', '2:3 (portrait)'], ['4:5', '4:5 (portrait)'], ['9:16', '9:16 (portrait)']];
  G.expandSize = (w, hh, o) => {
    let W = w, H = hh;
    if (o.ratio !== 'margin') { const [a, b] = o.ratio.split(':').map(Number), r = a / b; if (r > w / hh) W = Math.round(hh * r); else H = Math.round(w / r); }
    const m = o.margin / 100;
    W = Math.round(W * (1 + m)); H = Math.round(H * (1 + m));
    const ax = o.anchor === 'left' ? 0 : o.anchor === 'right' ? 2 : 1, ay = o.anchor === 'top' ? 0 : o.anchor === 'bottom' ? 2 : 1;
    return { W, H, dx: Math.round((W - w) * ax / 2), dy: Math.round((H - hh) * ay / 2) };
  };
  C.generativeExpand = async () => {
    const d = D(); if (!d) return;
    const o = { ratio: KS.prefs.expandRatio || '16:9', margin: 0, anchor: 'center' };
    const info = h('div.note');
    const upd = () => { const z = G.expandSize(d.width, d.height, o); info.textContent = `${d.width} × ${d.height} → ${z.W} × ${z.H} px`; };
    const extra = h('div.form-grid',
      h('label.l', { text: 'Format' }), ui.select(RATIOS, o.ratio, v => { o.ratio = v; if (v === 'margin' && !o.margin) { o.margin = 25; mg.set(25); } upd(); }),
      h('label.l', { text: 'Marge en plus' }), (() => { const s = ui.scrub({ value: o.margin, min: 0, max: 200, unit: '%', onInput: v => { o.margin = v; upd(); } }); return s; })(),
      h('label.l', { text: 'Image d\'origine' }), ui.select([['center', 'Au centre'], ['left', 'À gauche'], ['right', 'À droite'], ['top', 'En haut'], ['bottom', 'En bas']], o.anchor, v => { o.anchor = v; upd(); }),
      h('span'), info);
    const mg = extra.children[3];
    upd();
    const p = await G.promptDialog({ title: 'Développement génératif', expand: true, extra });
    if (!p) return;
    KS.prefs.expandRatio = o.ratio; KS.prefs.save();
    const { W, H, dx, dy } = G.expandSize(d.width, d.height, o);
    if (W === d.width && H === d.height) { KS.toast('Choisissez un format ou une marge pour agrandir l\'image', 'info'); return; }
    if (W * H > 80e6) { KS.toast('Image trop grande (80 mégapixels au plus)', 'err'); return; }
    // image élargie ; la zone neuve est pré-remplie d'un flou des couleurs voisines
    const comp = d.composite();
    const src = U.canvas(W, H), sx = src.getContext('2d');
    sx.drawImage(U.blurCanvas(scaled(comp, W / 8, H / 8), 6), 0, 0, W, H);
    sx.drawImage(comp, dx, dy);
    // masque : tout sauf l'image d'origine, rentrée de quelques pixels sur les côtés agrandis pour fondre la jointure
    const ov = Math.max(8, Math.round(Math.min(d.width, d.height) * 0.025));
    const alpha = U.canvas(W, H), ax = alpha.getContext('2d');
    ax.fillStyle = '#fff'; ax.fillRect(0, 0, W, H);
    const l = dx > 0 ? ov : 0, t = dy > 0 ? ov : 0, r = W - dx - d.width > 0 ? ov : 0, b = H - dy - d.height > 0 ? ov : 0;
    ax.clearRect(dx + l, dy + t, d.width - l - r, d.height - t - b);
    const prompt = (p.prompt || '').trim();
    let res;
    try {
      if (prompt) {
        const forge = await G.forge(true);
        if (!forge) { KS.toast(G.forgeError() + ' : lancez Forge depuis Kane OS (ou laissez l\'invite vide pour l\'IA locale)', 'err', 6000); return; }
        const st = { ...G.settings(), ...p };
        const pp = await G.preparePrompt(prompt, forge, st);
        res = await G.forgeGenerate(src, alpha, { x: 0, y: 0, w: W, h: H }, { ...st, ...pp, strength: 1 }, true);
        if (pp.shown !== prompt) KS.toast('Envoyé à Forge : « ' + pp.shown + ' »', 'info', 5000);
      } else {
        if (!(await G.lamaReady(true))) return;
        const r0 = await G.task('Développement par l\'IA locale…', () => G.inpaint(src, alpha, { x: 0, y: 0, w: W, h: H }));
        res = { variants: [r0.raw], rect: r0.rect };
      }
    } catch (e) { KS.toast('Génération impossible : ' + e.message, 'err', 6000); return; }
    C.resizeCanvas(d, W, H, dx, dy, 'transparent', 'Développement génératif');
    G.addGenLayer(d, res, alpha, { name: prompt ? 'Développement : ' + prompt.slice(0, 36) : 'Développement génératif', prompt, index: Math.min(1, d.layers.length), hist: 'Développement génératif', feather: ov });
    G.mergeLast(d, 2, 'Développement génératif', 'gen-expand');
  };

  /* ---------------------------------------------------------------- super résolution */
  // Deux méthodes. Classique : le modèle ESRGAN seul (rapide, fidèle, n'invente rien). Générative : l'image agrandie par
  // ce modèle est repeinte par tuiles par le moteur du Studio (Kane MultiDiffusion) : du vrai détail à la nouvelle taille.
  // Chaque tuile reçoit l'invite de ce qu'elle montre (WD14) et une invite négative contre les visages là où il n'y en a
  // pas ; les formes et les couleurs de la source sont tenues. Au-delà de ×2, deux passes (×2 puis la taille finale).
  const SR = { method: 'gen', factor: 2, creativity: 0.35, detail: 0.3, tilePrompts: true };
  const genPrompt = info => { const t = String(info || ''); const i = t.search(/\n(Negative prompt:|Steps:)/); return (i < 0 ? t : t.slice(0, i)).trim(); };
  const genNegative = info => { const m = /\nNegative prompt: ([^\n]*)/.exec(String(info || '')); return m ? m[1].trim() : ''; };
  C.superResolution = async (opts = {}) => {
    const d = D(); if (!d) return;
    if (!N || !N.forgeUpscale) { KS.toast('La super résolution n\'est disponible que dans l\'application de bureau', 'info'); return; }
    const f = await G.forge(true);
    if (!f) { KS.toast(G.forgeError() + ' : la super résolution passe par le moteur du Studio', 'err', 5000); return; }
    if (!f.upscalers.length) { KS.toast('Le moteur ne propose aucun modèle d\'agrandissement', 'err'); return; }
    const kmd = N.forgeKmdInfo ? await N.forgeKmdInfo(G.url()) : { ok: false };
    const pref = KS.prefs.upscaler;
    const def = f.upscalers.find(n => n === pref) || f.upscalers.find(n => /ultrasharp/i.test(n)) || f.upscalers.find(n => /R-ESRGAN 4x\+$/.test(n)) || f.upscalers[0];
    const o = { ...SR, ...(KS.prefs.superRes || {}), ...opts, model: def, prompt: genPrompt(d.genInfo) };
    if (!kmd.ok) o.method = 'classic';
    const gen = () => o.method === 'gen';
    const size = () => ({ W: Math.round(d.width * o.factor), H: Math.round(d.height * o.factor) });
    const info = h('div.note');
    let planSeq = 0;
    const upd = async () => {
      const { W, H } = size(), seq = ++planSeq;
      let txt = `${d.width} × ${d.height} → ${W} × ${H} px, dans un nouveau document`;
      info.textContent = txt;
      if (!gen()) return;
      const passes = o.factor > 2 ? 2 : 1;
      const r = await N.forgeKmdPlan(G.url(), { width: W - W % 8, height: H - H % 8 }).catch(() => null);
      if (seq !== planSeq) return;
      if (r && r.ok) txt += ` · ${r.plan.count} tuile${r.plan.count > 1 ? 's' : ''} de ${r.plan.tile[0]} × ${r.plan.tile[1]} px`;
      info.textContent = txt + (passes > 1 ? ' · 2 passes (×2 puis la taille finale)' : '');
    };
    const genRows = [];
    const row = (label, ctl, title) => { const l = h('label.l', { text: label, title: title || '' }); genRows.push(l, ctl); return [l, ctl]; };
    const prompt = h('textarea.field', { rows: 3, spellcheck: false, placeholder: 'Facultatif : ce que montre l’image (en anglais ou en français). Vide : chaque tuile est décrite par ce qu’on y voit.' });
    prompt.value = o.prompt; prompt.addEventListener('input', () => { o.prompt = prompt.value; }); prompt.addEventListener('keydown', e => e.stopPropagation());
    const factors = [['1.5', '× 1,5'], ['2', '× 2'], ['3', '× 3'], ['4', '× 4']];
    const showGen = () => { for (const el of genRows) el.style.display = gen() ? '' : 'none'; upd(); };
    const pending = new Promise(res => KS.modal({
      title: 'Super résolution IA', width: 520,
      body: h('div.form-grid',
        h('label.l', { text: 'Méthode' }), ui.seg([['gen', 'Générative', kmd.ok ? 'Ajoute du vrai détail (moteur du Studio, Kane MultiDiffusion)' : 'Kane MultiDiffusion absent du moteur : mettez Kane OS à jour puis redémarrez le moteur du Studio'], ['classic', 'Classique', 'Agrandisseur seul : rapide, fidèle, n’invente rien']], o.method, v => {
          if (v === 'gen' && !kmd.ok) { KS.toast('Kane MultiDiffusion n’est pas dans ce moteur : mettez Kane OS à jour puis redémarrez le moteur du Studio.', 'err', 5000); return; }
          o.method = v; showGen();
        }),
        h('label.l', { text: 'Agrandir' }), ui.seg(factors.map(([v, l]) => [v, l]), String(o.factor), v => { o.factor = +v; upd(); }),
        h('label.l', { text: 'Modèle' }), ui.select(f.upscalers.map(n => [n, n]), o.model, v => { o.model = v; }),
        ...row('Créativité', ui.scrub({ value: o.creativity, min: 0.15, max: 0.6, step: 0.05, onInput: v => { o.creativity = v; } }), 'Force du repeint : 0,25 fidèle, 0,35 conseillé, 0,5 et plus redessine'),
        ...row('Détail en plus', ui.scrub({ value: o.detail, min: 0, max: 1, step: 0.05, onInput: v => { o.detail = v; } }), 'Grain et finesse ajoutés au milieu du calcul'),
        ...row('Invite', prompt),
        ...row('', ui.check('Invite par tuile (ce que chaque tuile montre)', o.tilePrompts, v => { o.tilePrompts = v; }, 'WD14 décrit chaque tuile : le personnage n’est demandé que là où il se trouve, plus de visages inventés dans le décor')),
        h('span'), info,
        h('span'), h('div.note', { text: 'Calcul local par le moteur du Studio. Générative : environ une minute pour ×2 d’une image de 2 mégapixels sur une RTX 5080.' })),
      buttons: [{ label: 'Annuler', value: null }, { label: 'Agrandir', primary: true, value: 'ok' }],
      onClose: v => res(v === 'ok'),
    }));
    showGen();
    if (!(await pending)) return;
    const { W, H } = size();
    const maxSide = gen() ? 8192 : 16384, maxPx = gen() ? 40e6 : 150e6;
    if (Math.max(W, H) > maxSide || W * H > maxPx) { KS.toast(`Résultat trop grand (${maxSide.toLocaleString('fr-FR')} px de côté, ${maxPx / 1e6} mégapixels au plus${gen() ? ' en générative' : ''})`, 'err', 5000); return; }
    KS.prefs.upscaler = o.model;
    KS.prefs.superRes = { method: o.method, factor: o.factor, creativity: o.creativity, detail: o.detail, tilePrompts: o.tilePrompts };
    KS.prefs.save();
    const comp = d.composite();
    // transparence : l'agrandisseur travaille en RVB, l'alpha est agrandi à part
    const probe = U.getData(scaled(comp, Math.min(256, d.width), Math.min(256, d.height))).data;
    let alphaUsed = false; for (let i = 3; i < probe.length; i += 4) if (probe[i] < 255) { alphaUsed = true; break; }
    try {
      let out;
      if (gen()) out = await G.superGen(comp, W, H, { ...o, info: d.genInfo }, f);
      else {
        const r = await G.task('Super résolution…', async () => N.forgeUpscale(G.url(), {
          resize_mode: 0, upscaling_resize: o.factor, upscaler_1: o.model, upscaler_2: 'None', extras_upscaler_2_visibility: 0,
          gfpgan_visibility: 0, codeformer_visibility: 0, show_extras_results: true,
        }, await pngBytes(comp)), { cancel: () => N.forgeInterrupt(G.url()) });
        if (!r.ok) throw new Error(r.error);
        out = await fromPng(r.image);
      }
      if (!out) return;
      if (out.width !== W || out.height !== H) out = scaled(out, W, H);
      if (alphaUsed) { const x = out.getContext('2d'); x.globalCompositeOperation = 'destination-in'; x.imageSmoothingQuality = 'high'; x.drawImage(comp, 0, 0, W, H); }
      const label = String(o.factor).replace('.', ',');
      const nd = new KS.Doc({ name: d.name.replace(/\.[^.]+$/, '') + ` ×${label}` + (gen() ? ' détaillé' : ''), width: W, height: H });
      nd.addLayer(new KS.Layer({ name: `Super résolution ×${label}` + (gen() ? ' (générative)' : ''), canvas: out }), 0);
      KS.addDoc(nd);
      KS.toast(`Agrandi ×${label} (${gen() ? 'générative, ' : ''}${o.model})`, 'ok');
    } catch (e) { KS.toast('Super résolution impossible : ' + e.message, 'err', 6000); }
  };

  // Super résolution générative : une ou deux passes d'image vers image par tuiles (Kane MultiDiffusion). L'agrandisseur
  // choisi prépare l'image à la taille de la passe (réglage upscaler_for_img2img, le temps de la requête).
  G.superGen = async (comp, W, H, o, forge) => {
    const st = G.studio();
    const own = (o.prompt || '').trim();
    const fromInfo = own && own === genPrompt(o.info);
    // invite reprise de l'image : déjà complète (préfixe du modèle, LoRA) ; sinon celle tapée, ou une invite de qualité
    const pp = await G.preparePrompt(own || 'masterpiece, best quality, highly detailed', forge,
      fromInfo || /<lora:/i.test(own) ? { ...st, usePrefix: false, loras: [] } : st);
    // pas de « personne » en négatif ici : l'image en a peut-être une ; les tuiles sans visage ont leur propre négatif
    const negative = (fromInfo && genNegative(o.info)) || [st.negative, 'nsfw, nude'].filter(Boolean).join(', ');
    const r8 = v => Math.max(64, Math.floor(v / 8) * 8);
    const stages = o.factor > 2 ? [[r8(comp.width * 2), r8(comp.height * 2), 1], [r8(W), r8(H), 0.8]] : [[r8(W), r8(H), 1]];
    let cur = comp;
    for (let i = 0; i < stages.length; i++) {
      const [sw, sh, k] = stages[i];
      const ov = pp.extra.override_settings || {};
      const payload = {
        prompt: pp.prompt, negative_prompt: negative, steps: +st.steps || 30, cfg_scale: +st.cfg || 4.5, width: sw, height: sh,
        batch_size: 1, n_iter: 1, seed: st.seed != null && st.seed !== '' ? +st.seed : -1, denoising_strength: U.clamp(+o.creativity * k, 0.1, 0.75),
        resize_mode: 0, save_images: false, send_images: true, distilled_cfg_scale: pp.extra.distilled_cfg_scale,
        // aperçu en direct approché (RVB) : un aperçu complet décoderait plusieurs mégapixels à chaque pas
        override_settings: { ...ov, upscaler_for_img2img: o.model, live_previews_enable: true, show_progress_type: 'RGB', show_progress_every_n_steps: 1 },
        override_settings_restore_afterwards: pp.extra.override_settings ? pp.extra.override_settings_restore_afterwards : true,
        alwayson_scripts: { 'Kane MultiDiffusion': { args: [{ enabled: true, prompts: o.tilePrompts !== false, negatives: o.tilePrompts !== false, structure: 0.5, detail: +o.detail || 0, colors: 1 }] } },
      };
      if (pp.sampler) payload.sampler_name = pp.sampler;
      if (pp.scheduler) payload.scheduler = pp.scheduler;
      if (sw * sh > 12e6) payload.alwayson_scripts['Never OOM Integrated'] = { args: [false, true] };    // VAE par tuiles
      const job = { payload, W: sw, H: sh, R: { x: 0, y: 0, w: sw, h: sh }, init: await pngBytes(cur), mask: null,
        label: 'Super résolution générative' + (stages.length > 1 ? ` (passe ${i + 1} / ${stages.length})` : '') + '…' };
      const res = await G.forgeRun(job);
      cur = res.variants[0];
    }
    return cur;
  };

  /* ---------------------------------------------------------------- harmoniser */
  // Accorde la lumière et la couleur du calque actif à ce qu'il y a dessous (transfert des
  // moyennes et écarts types en Lab, mesurés sur le calque et sur son voisinage).
  const LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const ENC = new Uint8ClampedArray(4097);
  for (let i = 0; i <= 4096; i++) { const c = i / 4096; ENC[i] = 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) + 0.5; }
  const fLab = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 0.137931;
  const toLab = (r, g, b, o) => {
    const R = LIN[r], Gc = LIN[g], B = LIN[b];
    const x = fLab((0.4124 * R + 0.3576 * Gc + 0.1805 * B) / 0.95047), y = fLab(0.2126 * R + 0.7152 * Gc + 0.0722 * B), z = fLab((0.0193 * R + 0.1192 * Gc + 0.9505 * B) / 1.08883);
    o[0] = 116 * y - 16; o[1] = 500 * (x - y); o[2] = 200 * (y - z);
  };
  const fInv = t => { const t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 0.137931) / 7.787; };
  const enc = v => ENC[v <= 0 ? 0 : v >= 1 ? 4096 : (v * 4096) | 0];
  const stats = (px, wt) => {
    const o = [0, 0, 0], s = [0, 0, 0], q = [0, 0, 0]; let n = 0;
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      const w = wt(j, px[i + 3]); if (!w) continue;
      toLab(px[i], px[i + 1], px[i + 2], o);
      for (let k = 0; k < 3; k++) { s[k] += o[k] * w; q[k] += o[k] * o[k] * w; }
      n += w;
    }
    if (n < 1) return null;
    const m = s.map(v => v / n), sd = q.map((v, k) => Math.sqrt(Math.max(1e-4, v / n - m[k] * m[k])));
    return { m, sd, chroma: Math.hypot(sd[1], sd[2]) };
  };
  C.harmonize = async () => {
    const d = D(); if (!d) return;
    const L = d.active;
    if (!L || L.kind !== 'raster') { KS.toast('Harmoniser s\'applique à un calque de pixels posé sur une image', 'info'); return; }
    if (L.editMask) { L.editMask = false; KS.emit('layers', d); }
    const idx = d.layers.indexOf(L);
    if (idx <= 0) { KS.toast('Rien sous ce calque : placez-le au-dessus d\'un arrière-plan', 'info'); return; }
    const cb = L.contentBounds(); if (!cb) { KS.toast('Le calque est vide', 'info'); return; }
    // mesures sur une copie réduite (≈ 300 px) du calque et de ce qu'il y a dessous, autour
    const pad = Math.max(cb.w, cb.h) * 0.5;
    const R = U.rectIntersect(U.rectInt({ x: cb.x - pad, y: cb.y - pad, w: cb.w + pad * 2, h: cb.h + pad * 2 }), d.rect);
    if (!R) return;
    const s = Math.min(1, 300 / Math.max(R.w, R.h)), sw = Math.max(1, Math.round(R.w * s)), sh = Math.max(1, Math.round(R.h * s));
    const below = d.flatten(d.layers.slice(0, idx));
    const bg = U.getData(scaled(below, sw, sh, R.x, R.y, R.w, R.h)).data;
    const lc = U.canvas(sw, sh), lx = lc.getContext('2d'); lx.imageSmoothingQuality = 'high';
    lx.drawImage(L.canvas, (L.x - R.x) * s, (L.y - R.y) * s, L.canvas.width * s, L.canvas.height * s);
    const lp = U.getData(lc).data;
    const src = stats(lp, (j, a) => a >= 128 ? 1 : 0);
    let dst = stats(bg, j => lp[j * 4 + 3] < 128 && bg[j * 4 + 3] > 128 ? 1 : 0);
    if (!dst) dst = stats(bg, (j, a) => a > 128 ? 1 : 0);
    if (!src || !dst) { KS.toast('Pas assez de pixels pour comparer', 'err'); return; }
    const pv = C.previewPixels(d); if (!pv) return;
    const run = (c, v) => {
      const amt = v.amount / 100, kl = amt * v.light / 100, kc = amt * v.color / 100, kk = v.contrast / 100;
      const rl = 1 + (U.clamp(dst.sd[0] / src.sd[0], 0.6, 1.6) - 1) * kk, rc = U.clamp(dst.chroma / (src.chroma || 1), 0.5, 1.6);
      const data = U.getData(c), px = data.data, o = [0, 0, 0];
      // cache exact par couleur (les pixels voisins se répètent souvent)
      const keys = new Int32Array(1 << 18).fill(-1), vals = new Int32Array(1 << 18);
      for (let i = 0; i < px.length; i += 4) {
        if (!px[i + 3]) continue;
        const key = px[i] << 16 | px[i + 1] << 8 | px[i + 2], hk = Math.imul(key, 2654435761) >>> 14;
        if (keys[hk] === key) { const v = vals[hk]; px[i] = v >> 16; px[i + 1] = v >> 8 & 255; px[i + 2] = v & 255; continue; }
        toLab(px[i], px[i + 1], px[i + 2], o);
        // lumière : moitié de l'écart de luminosité moyenne + contraste ; couleur : 40 % de la dominante
        // (le calque garde ses propres couleurs, il prend l'éclairage et la teinte ambiante du fond)
        const l = o[0] + ((dst.m[0] - src.m[0]) * 0.5 + (o[0] - src.m[0]) * (rl - 1)) * kl;
        const a = o[1] + ((dst.m[1] - src.m[1]) * 0.4 + (o[1] - src.m[1]) * (rc - 1) * 0.5) * kc;
        const b = o[2] + ((dst.m[2] - src.m[2]) * 0.4 + (o[2] - src.m[2]) * (rc - 1) * 0.5) * kc;
        const fy = (l + 16) / 116, X = fInv(fy + a / 500) * 0.95047, Y = fInv(fy), Z = fInv(fy - b / 200) * 1.08883;
        px[i] = enc(3.2406 * X - 1.5372 * Y - 0.4986 * Z);
        px[i + 1] = enc(-0.9689 * X + 1.8758 * Y + 0.0415 * Z);
        px[i + 2] = enc(0.0557 * X - 0.204 * Y + 1.057 * Z);
        keys[hk] = key; vals[hk] = px[i] << 16 | px[i + 1] << 8 | px[i + 2];
      }
      U.putData(c, data); return c;
    };
    const def = { key: 'harmonize', name: 'Harmoniser', params: [
      { id: 'amount', label: 'Intensité', min: 0, max: 100, def: 75, unit: '%' },
      { id: 'light', label: 'Lumière', min: 0, max: 100, def: 100, unit: '%' },
      { id: 'color', label: 'Couleur', min: 0, max: 100, def: 100, unit: '%' },
      { id: 'contrast', label: 'Contraste', min: 0, max: 100, def: 50, unit: '%' },
    ] };
    await KS.dialogs.params({
      title: 'Harmoniser', def, values: { amount: 75, light: 100, color: 100, contrast: 50 }, width: 460,
      preview: v => pv.update(c => run(c, v)), cancel: () => pv.cancel(),
      apply: v => { pv.update(c => run(c, v)); pv.commit('Harmoniser', 'harmonize'); },
    });
  };

  /* ---------------------------------------------------------------- outil Suppression */
  // Comme Photoshop : on peint sur l'élément, il disparaît au relâchement (LaMa, sinon cicatrisation).
  T.register({
    id: 'remove', name: 'Suppression', icon: 'remove', shortcut: 'J', cursor: 'none',
    defaults: { size: 60, sampleAll: true },
    activate() { G.lamaReady(false); },          // précharge le modèle s'il est installé
    options() {
      return [
        { type: 'brush' }, { type: 'sep' },
        { type: 'check', id: 'sampleAll', label: 'Échantillonner tous les calques' },
        { type: 'custom', render: () => h('span.opt-label', { text: 'Peignez sur ce qui doit disparaître : l\'IA locale le remplace au relâchement' }) },
        N && N.aiInpaint ? { type: 'button', text: 'Sélection → supprimer', icon: 'remove', action: () => C.removeSelection() } : null,
      ];
    },
    down(ev, doc) {
      if (this.busy) return;
      const target = T.paintTarget(doc, { allowMaskEdit: false });
      if (!target || target.gray) return;
      this.target = target;
      this.stroke = new KS.Brush.Stroke({ doc, target, size: this.o.size, hardness: 0.85, opacity: 0.5, flow: 1, spacing: 0.1, color: { r: 236, g: 64, b: 122 }, mode: 'paint' });
      this.stroke.start({ x: ev.x, y: ev.y, pressure: 1 });
      this.changed(doc);
    },
    move(ev, doc) { if (this.stroke) { this.stroke.move({ x: ev.x, y: ev.y, pressure: 1 }); this.changed(doc); } },
    changed(doc) { const r = this.stroke.takeDirty(); if (r) { this.need = true; doc.changed(r); } else KS.requestRender(); },
    preRender() { if (this.stroke && this.need) { this.need = false; this.target.layer.override = this.stroke.preview(); } },
    async up(ev, doc) {
      if (!this.stroke) return;
      const t = this.target, st = this.stroke, L = t.layer;
      this.stroke = null; this.target = null;
      let mask = st.buffer;
      if (doc.selection.mask) { mask = U.copyCanvas(st.buffer); doc.selection.clip(mask, t.ox, t.oy); }
      const rect = st.rect && U.rectIntersect(U.rectInt(st.rect), { x: 0, y: 0, w: t.canvas.width, h: t.canvas.height });
      if (!rect) { L.override = null; L.touch(); doc.changed(); return; }
      this.busy = true;
      try {
        if (await G.lamaReady(true)) {
          const all = this.o.sampleAll;
          L.override = null; L.touch();
          let src = t.canvas, m = mask, B = rect;
          if (all) {
            src = doc.composite();
            m = U.canvas(doc.width, doc.height); m.getContext('2d').drawImage(mask, t.ox, t.oy);
            B = U.rectIntersect({ x: rect.x + t.ox, y: rect.y + t.oy, w: rect.w, h: rect.h }, doc.rect);
          }
          if (!B) return;
          const res = await G.task('Suppression…', () => G.inpaint(src, m, B));
          const R = all ? { x: res.rect.x - t.ox, y: res.rect.y - t.oy, w: res.rect.w, h: res.rect.h } : res.rect;
          const Rc = U.rectIntersect(U.rectInt(R), { x: 0, y: 0, w: t.canvas.width, h: t.canvas.height });
          if (!Rc) return;
          const before = U.copyCanvas(t.canvas, Rc);
          t.canvas.getContext('2d').drawImage(res.fill, R.x, R.y);
          L.touch();
          KS.Hist.commitRect(doc, 'Suppression', L, Rc, before, 'remove'); KS.emit('layer-pixels', doc);
          doc.changed({ x: Rc.x + t.ox, y: Rc.y + t.oy, w: Rc.w, h: Rc.h });
        } else {
          // sans modèle : correcteur localisé
          L.override = null;
          let before = null;
          const done = KS.heal(t.canvas, t.canvas, mask, rect, null, Z => { before = U.copyCanvas(t.canvas, Z); });
          L.touch();
          if (done && before) { KS.Hist.commitRect(doc, 'Suppression', L, done, before, 'remove'); KS.emit('layer-pixels', doc); }
          doc.changed();
        }
      } catch (e) {
        L.override = null; L.touch(); doc.changed();
        KS.toast('Suppression impossible : ' + e.message, 'err', 5000);
      } finally { this.busy = false; }
    },
    cancel() { if (this.target) { this.target.layer.override = null; this.target.layer.touch(); } this.stroke = null; },
    key(e) { return KS.brushKeys(this, e); },
    overlay(ctx) { T.drawBrushCursor(ctx, this.o.size); },
  });

  /* ---------------------------------------------------------------- pinceau de réglage */
  // Photoshop 2025 : on peint un réglage ; il vit dans un calque de réglage dont on peint le masque.
  const AB = {
    lighten: ['Éclaircir', 'exposure', a => ({ exposure: 1.6 * a })],
    darken: ['Assombrir', 'exposure', a => ({ exposure: -1.6 * a })],
    contrast: ['Contraste', 'brightness', a => ({ contrast: 80 * a })],
    saturate: ['Saturer', 'vibrance', a => ({ vibrance: 70 * a, saturation: 25 * a })],
    desaturate: ['Désaturer', 'vibrance', a => ({ saturation: -100 * a })],
    warm: ['Réchauffer', 'photoFilter', a => ({ preset: '#ec8a00', density: 70 * a })],
    cool: ['Refroidir', 'photoFilter', a => ({ preset: '#006dff', density: 70 * a })],
    bw: ['Noir et blanc', 'blackWhite', () => ({})],
  };
  G.adjustBrushPresets = AB;
  T.register({
    id: 'adjust-brush', name: 'Pinceau de réglage', icon: 'adjust-brush', shortcut: 'B', cursor: 'none', altPaints: true,
    defaults: { size: 80, hardness: 30, opacity: 100, flow: 60, preset: 'lighten', amount: 50 },
    options() {
      return [
        { type: 'brush' }, { type: 'sep' },
        { type: 'select', id: 'preset', label: 'Réglage', options: Object.entries(AB).map(([k, v]) => [k, v[0]]) },
        { type: 'scrub', id: 'amount', label: 'Intensité', min: 1, max: 100, unit: '%' },
        { type: 'scrub', id: 'flow', label: 'Flux', min: 1, max: 100, unit: '%' },
        { type: 'custom', render: () => h('span.opt-label', { text: 'Alt : effacer le réglage' }) },
      ];
    },
    // Le calque du pinceau est réutilisé tant qu'il est actif et du même réglage
    layerFor(doc) {
      const A = doc.active, p = this.o.preset, def = AB[p];
      if (A && A.kind === 'adjust' && A.adjust?.brush === p) { if (A.mask) { A.editMask = true; return { L: A, created: false }; } }
      const type = def[1];
      const L = new KS.Layer({ name: 'Pinceau de réglage : ' + def[0], kind: 'adjust', adjust: { type, params: { ...KS.Adjust.defaults(type), ...def[2](this.o.amount / 100) }, brush: p } });
      L.addMask(doc, 'hide');
      KS.Hist.structure(doc, 'Pinceau de réglage', () => { doc.addLayer(L, C.insertIndex(doc, L)); L.editMask = true; }, 'adjust-brush');
      KS.emit('active-layer', doc);
      return { L, created: true };
    },
    down(ev, doc) {
      if (doc.quickMask || doc.alphaEdit) { KS.toast('Quittez le mode Masque pour utiliser le pinceau de réglage', 'info'); return; }
      const { created } = this.layerFor(doc);
      const target = T.paintTarget(doc);
      if (!target || target.kind !== 'mask') return;
      this.created = created; this.target = target;
      this.token = T.beginHist(target);
      const v = ev.alt ? 0 : 255;
      this.stroke = new KS.Brush.Stroke({
        doc, target, size: this.o.size, hardness: this.o.hardness / 100, opacity: this.o.opacity / 100, flow: this.o.flow / 100,
        spacing: 0.08, color: { r: v, g: v, b: v }, mode: 'paint', pressureSize: true, direct: true,
      });
      this.stroke.start({ x: ev.x, y: ev.y, pressure: ev.pressure });
      this.after(doc);
    },
    move(ev, doc) { if (this.stroke) { this.stroke.move({ x: ev.x, y: ev.y, pressure: ev.pressure }); this.after(doc); } },
    after(doc) {
      const st = this.stroke, r = st.takeDirty();
      if (st.dirtyMove) { this.target.after(st.dirtyMove); st.dirtyMove = null; }
      if (r) doc.changed(r); else KS.requestRender();
    },
    up(ev, doc) {
      if (!this.stroke) return;
      const st = this.stroke, t = this.target;
      const rect = st.commit();
      t.after(st.dirtyMove || rect);
      T.commitHist(doc, t, this.token, rect, 'Pinceau de réglage', 'adjust-brush');
      if (this.created) G.mergeLast(doc, 2, 'Pinceau de réglage : ' + AB[this.o.preset][0], 'adjust-brush');
      this.stroke = null; this.target = null; this.created = false;
      doc.changed();
    },
    cancel() { this.stroke = null; this.target = null; },
    key(e) { return KS.brushKeys(this, e); },
    overlay(ctx) { T.drawBrushCursor(ctx, this.o.size); },
  });
})();

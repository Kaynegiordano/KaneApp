// Parcours Studio ↔ Édition dans un vrai renderer Electron, sans moteur ni profil utilisateur.
// Lancer : node_modules/.bin/electron tools/test-studio.cjs
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanevas-studio-'));
app.setPath('userData', path.join(tmp, 'profile'));
const preload = path.join(tmp, 'preload.cjs');
fs.writeFileSync(preload, `
window.realDoubleClick = (x, y) => require('electron').ipcRenderer.invoke('test-double-click', x, y);
window.realClick = (x, y) => require('electron').ipcRenderer.invoke('test-click', x, y);
window.realDrag = (x, y) => require('electron').ipcRenderer.invoke('test-drag', x, y);
localStorage.setItem('kanevas.prefs', JSON.stringify({ fx: { v: 1, editor: { strength: 0.85 } }, genAI: { v: 2, strength: 1, loras: [{ name: 'obsolete-girl', weight: 1 }] } }));
window.loraImages = []; window.loraPaths = [];
window.calls = [];
window.txtCalls = []; window.extraCalls = []; window.interrupts = 0;
window.ksNative = {
  gpuMemory: async () => window.gpuFails ? {ok:false} : {ok:true,used:window.gpuUsed ?? 1302,total:16275,measuredAt:window.gpuStale ? 1 : Date.now(),devices:[{name:'NVIDIA test',used:1302,total:16275}]},
  setTitle() {}, setTitleBar() {}, setZoom() {}, onCloseRequest() {}, onOpenPath() {},
  getPending: async () => [],
  pathForFile: file => 'C:/selected/' + file.name,
  pickImagePaths: async () => window.loraPaths,
  loraThumb: async () => ({ ok: false }),
  loraCall: async (cmd, args = {}) => {
    if (cmd === 'info') return { ok: true, presets: { style: { label: 'Style' } }, scopes: { full: { label: 'Full', hint: '', summary: 'All' } },
      resolutions: [512,1024], optimizers: { adamw8bit: 'AdamW' }, dits: [], fewshot_resolutions: [512,1024], sd_scripts: 'C:/training', tagger: true };
    if (cmd === 'list') return { ok: true, projects: window.loraImages.length ? [{ name: 'Import-test', count: window.loraImages.length }] : [] };
    if (cmd === 'import') { window.loraImages.push(...args.paths.map(p => ({file: p.split('/').pop(),path:p}))); return {ok:true,name:'Import-test',added:args.paths.length,count:window.loraImages.length}; }
    if (cmd === 'load') return { ok:true,manifest:{ trigger: 'n1x3u', lora_type: 'style' },images:window.loraImages,runs:window.loraRun ? [window.loraRun] : [] };
    if (cmd === 'install') { (window.loraInstalls ||= []).push(args); return { ok: true, installed: 'C:/Lora/Anima/' + args.name + '.safetensors', name: args.name }; }
    return {ok:true,status:null};
  },
  forgeStatus: async () => { if (window.holdStatus) await new Promise(resolve => { window.releaseStatus = resolve; }); return { ok: true }; },
  forgeCatalog: async () => ({ ok: true, models: [{ title: 'Studio-model', name: 'Studio-model' }, { title: 'Anima-2.9B.safetensors [abcdef1234]', name: 'Anima-2.9B' }],
    loras: [{ name: 'test', alias: 'Illustration', weight: 0.7, trigger: 'painted', negative: 'bad lines', rel: 'Art', mtime: 1 }],
    modules: [], current: { model: 'Studio-model', modules: [] },
    dtype: 'Automatic', samplers: ['Euler'], schedulers: ['Automatic'], scripts: [], styles: [], presets: {}, upscalers: ['Lanczos'],
    kdInfo: { version: 5, parts: [{ key: 'cheveux', label: 'Cheveux', denoise: 0.3, model: 'anzhc_headhair_seg_y8n.pt' }, { key: 'pieds', label: 'Pieds', denoise: 0.38, model: null },
      { key: 'visage', label: 'Visage', denoise: 0.35, model: 'anzhc_face_seg_640_v4_y11n.pt' }, { key: 'yeux', label: 'Yeux', denoise: 0.3, model: 'anzhc_eyes_seg_hd.pt' }],
      presets: { Portrait: ['cheveux', 'visage', 'yeux'], 'Corps entier': ['cheveux', 'visage', 'yeux'] }, force_help: '0,15–0,25 : retouche légère' } }),
  forgeKaneDetect: async (url, payload, png) => { window.kdDetect = payload; return { ok: true, regions: [{ part: 'visage', box: [1, 1, 20, 20], conf: 0.9 }], preview: png }; },
  forgeKaneDetail: async (url, payload, png) => { (window.kdCalls = window.kdCalls || []).push(payload); return { ok: true, image: png, info: 'Kane Detailer : Visage x1 (0.35)', zones: png }; },
  forgeImg2img: async (url, payload, init, mask) => {
    window.calls.push({ url, payload, init, mask });
    if (window.holdGeneration) await new Promise(resolve => { window.releaseGeneration = resolve; });
    return { ok: true, images: [init], info: { seed: 42, infotexts: [payload.prompt + '\\nSteps: 32, Sampler: Euler, Seed: 42, Size: 128x64'] } };
  },
  forgeTxt2img: async (url, payload) => { window.txtCalls.push(payload);
    if (window.holdGeneration) await new Promise(resolve => { window.releaseGeneration = resolve; });
    return { ok: true, images: [window.calls[0].init],
    info: { seed: 84, infotexts: [payload.prompt + '\\nSteps: 20, Seed: 84, Size: 128x64'] } }; },
  forgeUpscale: async (url, payload, init) => { window.extraCalls.push(payload);
    if (window.holdGeneration) await new Promise(resolve => { window.releaseGeneration = resolve; });
    return { ok: true, image: init }; },
  forgeInterrupt: async () => { window.interrupts++; window.releaseGeneration?.(); window.releaseGeneration = null; return { ok: true }; },
  forgeProgress: async () => ({ ok: true, progress: 0.5 }),
  openDialog: async () => window.pickFiles || [],
  saveFiles: async (title, files) => { window.cutFiles = files; return { ok: true, written: files.map(f => f.name) }; }
};
`);

async function scenario() {
  const results = [];
  const assert = (ok, message) => { if (!ok) throw new Error(message); results.push(message); };
  const wait = async test => { for (let i = 0; i < 100; i++) { if (test()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error('Timeout'); };
  const button = (label, scope = document) => [...scope.querySelectorAll('button')].find(b => b.textContent === label);
  const more = async label => {
    document.querySelector('.fx-output-actions .fx-more').click(); await new Promise(r => setTimeout(r, 30));
    const mi = [...document.querySelectorAll('.menu .mi')].find(i => i.textContent.includes(label));
    if (!mi) throw new Error('Menu Plus sans : ' + label);
    mi.click(); await new Promise(r => setTimeout(r, 30));
  };
  const click = async (label, scope) => { const b = button(label, scope); if (!b) throw new Error('Bouton absent : ' + label); b.click(); await new Promise(r => setTimeout(r, 30)); };
  const doc = name => { const d = new KS.Doc({ name, width: 128, height: 64 }); const c = KS.util.canvas(128, 64); const x = c.getContext('2d'); x.fillStyle = '#3970bb'; x.fillRect(0, 0, 128, 64); d.addLayer(new KS.Layer({ name: 'Base', canvas: c }), 0); return d; };
  const a = doc('Source A'); KS.addDoc(a);
  await KS.gpuMemory.refresh();
  const gauge = document.querySelector('#gpu-status');
  assert(gauge.dataset.state === 'ready' && gauge.textContent.includes('16'), 'La VRAM se lit dans Edition sans démarrer Studio');
  window.gpuFails = true; await KS.gpuMemory.refresh();
  assert(gauge.dataset.state === 'unavailable' && !gauge.textContent.includes('302') && gauge.querySelector('progress').hidden, 'Une erreur retire le chiffre périmé au lieu de figer la jauge');
  window.gpuFails = false; window.gpuUsed = 0; await KS.gpuMemory.refresh();
  assert(gauge.dataset.state === 'ready' && gauge.querySelector('progress').value === 0, 'La jauge récupère après une erreur et accepte une VRAM utilisée nulle');
  window.gpuStale = true; await KS.gpuMemory.refresh();
  assert(gauge.dataset.state === 'unavailable', 'Une mesure trop ancienne est écartée');
  window.gpuStale = false; window.gpuUsed = 15000; await KS.gpuMemory.refresh();
  assert(gauge.dataset.state === 'high', 'La jauge signale une VRAM presque pleine');
  window.gpuUsed = 4000;
  await new Promise(r => setTimeout(r, 3200));
  assert(gauge.dataset.state === 'ready' && gauge.querySelector('progress').value === 25, 'Le rafraîchissement automatique continue sans moteur actif');
  assert(!KS.panels.defs.generate && !KS.panels.LAYOUT.some(g => g.tabs.includes('generate')), 'Aucun panneau Img2Img ni Studio IA dans le dock Édition');
  const navTabs = KS.panels.LAYOUT.find(g => g.id === 'g-nav').tabs;
  assert(navTabs.indexOf('aidraw') === navTabs.indexOf('histogram') + 1 && navTabs.indexOf('info') === navTabs.indexOf('aidraw') + 1 && !KS.panels.isVisible('aidraw'), 'Dessin IA est optionnel entre Histogramme et Infos');
  await KS.cmd.sendToStudio('img2img');
  await wait(() => document.querySelector('.fx-left .fx-panel .fx-slider'));
  assert(KS.studio.on && KS.prefs.fx.tab === 'img2img', 'Img2Img ouvre le Studio');
  assert(gauge.getBoundingClientRect().bottom <= innerHeight && gauge.getBoundingClientRect().height > 0, 'La même jauge reste visible dans Studio IA');
  assert(document.querySelector('.fx-source .iv-media').getAttribute('aria-label') === 'Source A', 'Le document envoyé devient la source');
  a.layers[0].ctx.fillStyle = '#cc0011'; a.layers[0].ctx.fillRect(0, 0, 128, 64); a.layers[0].touch(); a.changed();
  const b = doc('Autre document'); KS.addDoc(b);
  b.layers[0].ctx.fillStyle = '#11bb44'; b.layers[0].ctx.fillRect(0, 0, 128, 64); b.layers[0].touch(); b.changed();
  await KS.cmd.toggleStudio(false); await KS.cmd.toggleStudio(true);
  assert(document.querySelector('.fx-source .iv-media').getAttribute('aria-label') === 'Source A', 'Changer de document ne remplace pas la source');
  KS.prefs.fx.i2i.prompt = 'original <lora:test:0.7>'; KS.prefs.fx.translate = false;
  const before = a.layers.length;
  await KS.cmd.studioGenerate();
  assert(window.calls.length === 1 && window.calls[0].payload.width === 128 && window.calls[0].payload.height === 64, 'La génération utilise la taille de la source');
  const sent = await KS.util.canvasFromBlob(new Blob([window.calls[0].init], { type: 'image/png' }));
  assert(sent.getContext('2d').getImageData(0, 0, 1, 1).data[2] === 187, 'Les pixels envoyés viennent de la source choisie, pas du document actif');
  assert(a.layers.length === before && b.layers.length === 1, 'Générer ne modifie aucun document de l’Édition');
  assert(!!document.querySelector('.fx-img2img .fx-view img'), 'Le résultat Img2Img possède un grand aperçu');
  const sourceZoom = document.querySelector('.fx-source .iv-viewport');
  await new Promise(r => setTimeout(r, 60));
  const sourceScale = +sourceZoom.dataset.scale, zr = sourceZoom.getBoundingClientRect();
  sourceZoom.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, clientX: zr.left + zr.width / 2, clientY: zr.top + zr.height / 2, bubbles: true, cancelable: true }));
  assert(+sourceZoom.dataset.scale > sourceScale, 'La molette zoome dans la source Img2Img');
  await click('100 %', document.querySelector('.fx-source'));
  assert(+sourceZoom.dataset.scale === 1, 'Le bouton 100 % affiche la taille réelle');
  const outputZoom = document.querySelector('.fx-view .iv-viewport'), oldScale = +outputZoom.dataset.scale;
  await click('+', document.querySelector('.fx-view'));
  assert(+outputZoom.dataset.scale > oldScale, 'Le résultat possède des commandes de zoom indépendantes de la source');
  const zoomedMedia = outputZoom.querySelector('img');
  const panRect = zoomedMedia.getBoundingClientRect();
  await window.realDrag(Math.round(panRect.left + panRect.width / 2), Math.round(panRect.top + panRect.height / 2));
  assert(zoomedMedia.style.transform.includes('translate(35px, 20px)'), 'Glisser déplace l’image dans son aperçu : ' + zoomedMedia.style.transform);
  await click('Image entière', document.querySelector('.fx-view'));
  assert(+outputZoom.dataset.scale === oldScale && zoomedMedia.style.transform.includes('translate(0px, 0px)'), 'Image entière réinitialise le zoom et le déplacement du cadre');
    const docsBeforePreview = KS.state.docs.length;
    const imageRect = zoomedMedia.getBoundingClientRect();
    await window.realClick(Math.round(imageRect.left + imageRect.width / 2), Math.round(imageRect.top + imageRect.height / 2));
    await wait(() => !!document.querySelector('.iv-lightbox .iv-media'));
    assert(document.querySelectorAll('.iv-lightbox').length === 1, 'Un seul clic sur le résultat terminé l’ouvre en plein écran');
    const fullImageRect = document.querySelector('.iv-lightbox .iv-media').getBoundingClientRect();
    await window.realClick(Math.round(fullImageRect.left + fullImageRect.width / 2), Math.round(fullImageRect.top + fullImageRect.height / 2));
    assert(!!document.querySelector('.iv-lightbox'), 'Un vrai clic sur l’image ne ferme pas le plein écran');
    assert(KS.state.docs.length === docsBeforePreview, 'Le clic affiche le résultat en plein écran sans ouvrir un document dans l’Édition');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await window.realDoubleClick(Math.round(imageRect.left + imageRect.width / 2), Math.round(imageRect.top + imageRect.height / 2));
    await wait(() => !!document.querySelector('.iv-lightbox .iv-media'));
    await new Promise(r => setTimeout(r, 100));
    assert(document.querySelectorAll('.iv-lightbox').length === 1, 'Un double-clic par habitude ouvre le plein écran une fois sans le refermer');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.querySelector('.fx-view .iv-scale').click();
  await wait(() => !!document.querySelector('.iv-lightbox .iv-media'));
  assert(KS.modalOpen() && document.querySelector('.iv-lightbox img').src === zoomedMedia.src, 'Cliquer sur la barre au-dessus ouvre la même image en plein écran');
  // position mesurée une fois le plein écran installé (image chargée, mise en page faite), dans la marge gauche
  await new Promise(r => setTimeout(r, 500));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const outsideRect = document.querySelector('.iv-fullscreen .iv-viewport').getBoundingClientRect();
  await window.realClick(Math.round(outsideRect.left + 3), Math.round(outsideRect.top + outsideRect.height / 2));
  // l'envoi du clic rend la main avant que la page l'ait traité : sans cette attente, le test échouait une fois sur deux
  await new Promise(r => setTimeout(r, 60));
  assert(!KS.modalOpen(), 'Cliquer autour de l’image ferme le plein écran');
  {
    // clic droit sur le résultat : menu avec « Copier l’image », qui met un PNG dans le presse-papiers
    const vp = document.querySelector('.fx-view .iv-viewport'), r = vp.getBoundingClientRect();
    vp.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 20 }));
    const items = [...document.querySelectorAll('.menu .menu-item, .menu button, .menu [role="menuitem"], .menu > div')].map(x => x.textContent.trim());
    assert(items.some(t => t.startsWith('Copier l’image')) && items.some(t => t.startsWith('Ouvrir dans Retouche')), 'Le clic droit sur le résultat propose Copier l’image : ' + items.join(' | '));
    KS.ui.closeMenus();
    let copied = null; const realWrite = navigator.clipboard.write.bind(navigator.clipboard);
    navigator.clipboard.write = async list => { copied = await list[0].getType('image/png'); };
    await KS.preview.copy(document.querySelector('.fx-view .iv-media'));
    navigator.clipboard.write = realWrite;
    assert(copied && copied.size > 0 && copied.type === 'image/png', 'Copier l’image met un PNG dans le presse-papiers');
    // Amélioration rapide : corrections automatiques à 20 % (image terne, dominante bleue)
    const W = 64, H = 32, im = new ImageData(W, H);
    for (let i = 0; i < W * H; i++) { const v = 90 + (i % W); im.data.set([v, v + 4, v + 25, 255], i * 4); }
    const before = new Uint8ClampedArray(im.data); KS.Adjust.quickEnhance(im);
    let diff = 0, maxd = 0; for (let i = 0; i < before.length; i++) if (i % 4 !== 3) { const e = Math.abs(im.data[i] - before[i]); diff += e; maxd = Math.max(maxd, e); }
    diff /= W * H * 3;
    assert(diff > 2 && maxd < 80, 'Amélioration rapide : visible mais modérée (écart moyen ' + diff.toFixed(1) + ', max ' + maxd + ')');
    assert(typeof KS.cmd.quickEnhance === 'function' && !!document.querySelector('#workspace-actions .ws-enhance'), 'Bouton Amélioration rapide présent');
    // Kane Detailer : action « Détailler » sur le résultat, invite reprise de l'image, parties du volet
    const shown = document.querySelectorAll('.fx-view .iv-media').length;
    const vp2 = document.querySelector('.fx-view .iv-viewport'), r2 = vp2.getBoundingClientRect();
    vp2.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r2.left + 20, clientY: r2.top + 20 }));
    const det = [...document.querySelectorAll('.menu *')].find(x => x.children.length < 3 && /^Détailler \(Kane Detailer\)/.test(x.textContent.trim()));
    assert(det, 'Le clic droit propose Détailler (Kane Detailer)');
    det.click();
    await wait(() => (window.kdCalls || []).length === 1);
    const kd = window.kdCalls[0];
    assert(kd.parts.join() === 'vetements,poitrine,cheveux,mains,visage,yeux' && kd.forces && !('strength' in kd) && kd.detail === 0 && kd.upscale === 1 && kd.keep === 0.8 && kd.resolution === 1024 && kd.tries === 2 && kd.repair === true && kd.grain === 0.5 && kd.glow === true && kd.age === true && kd.autotag === true && kd.soft === true && kd.wd === true && kd.prompt && !/Steps:/.test(kd.prompt), 'Détailler envoie les parties du volet et l’invite de l’image : ' + JSON.stringify(kd).slice(0, 200));
    await wait(() => /Kane Detailer/.test(document.querySelector('.fx-outinfo')?.textContent || ''));
    assert(shown >= 1, 'Le résultat détaillé s’affiche');
    assert([...document.querySelectorAll('.fx-output-actions button')].some(b => b.textContent === 'Zones repeintes'), 'Le résultat détaillé propose « Zones repeintes »');
    // Avant / après : visionneuse de comparaison, rideau puis côte à côte
    await click('Avant / après', document.querySelector('.fx-output-actions'));
    await wait(() => !!document.querySelector('.iv-lightbox .iv-cmp'));
    const cmp = document.querySelector('.iv-lightbox .iv-cmp');
    await new Promise(r => setTimeout(r, 60));
    assert(cmp.querySelectorAll('.iv-media').length === 2 && /Kane Detailer/.test(cmp.querySelector('.iv-cmp-tag.b').textContent), 'Avant / après compare l’original et le résultat détaillé');
    const split0 = +cmp.dataset.split;
    cmp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert(+cmp.dataset.split > split0 && /inset\(0px 0px 0px \d+px\)/.test(cmp.querySelector('.iv-cmp-b').style.clipPath), 'Les flèches déplacent le rideau : ' + cmp.querySelector('.iv-cmp-b').style.clipPath);
    const z0 = +cmp.dataset.scale, cr = cmp.getBoundingClientRect();
    cmp.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, clientX: cr.left + cr.width / 2, clientY: cr.top + cr.height / 2, bubbles: true, cancelable: true }));
    const [ma, mb] = cmp.querySelectorAll('.iv-media');
    assert(+cmp.dataset.scale > z0 && ma.style.transform === mb.style.transform, 'La molette zoome les deux images ensemble');
    await click('Côte à côte', document.querySelector('.iv-lightbox'));
    assert(cmp.classList.contains('side') && !cmp.querySelector('.iv-cmp-b').style.clipPath, 'Côte à côte montre les deux images entières');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(() => !KS.modalOpen());
  }
  {
    const titles = [...document.querySelectorAll('.fx-acc-t')].map(x => x.textContent);
    assert(titles.includes('Kane Detailer'), 'Volet Kane Detailer présent : ' + titles.join(', '));
    // volet ouvert : une ligne par partie avec sa force, la force modifiée part avec la génération
    const head = [...document.querySelectorAll('.fx-acc-h')].find(x => x.textContent.includes('Kane Detailer'));
    head.click(); await new Promise(r => setTimeout(r, 50));
    const rows = [...document.querySelectorAll('.kd-row')];
    assert(rows.length === 4 && rows[2].querySelector('.fx-num').value === '0.35', 'Une ligne et une force par partie (visage 0,35) : ' + rows.map(r => r.textContent).join(' | '));
    const num = rows[2].querySelector('.fx-num'); num.value = '0.22'; num.dispatchEvent(new Event('change'));
    const kdOf = () => KS.prefs.fx[KS.prefs.fx.tab === 'img2img' ? 'i2i' : 't2i'].kd;
    await wait(() => kdOf().forces.visage === 0.22);
    assert(kdOf().forces.visage === 0.22 && !rows[2].querySelector('.kd-reset').hidden, 'Changer la force du visage la retient et montre le retour à la recette');
    { const txt = [...document.querySelectorAll('.fx-acc')].find(x => x.querySelector('.kd-row'))?.textContent || ''; assert(['Invite de zone d’après ce qu’on y voit', 'Raccords invisibles', 'Juge WD14'].every(x => txt.includes(x)), 'Le volet montre les réglages de Kane Detailer 5'); }
    head.click();
    // « Voir les zones » ouvre l'aperçu des zones
    const vp3 = document.querySelector('.fx-view .iv-viewport'), r3 = vp3.getBoundingClientRect();
    vp3.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r3.left + 20, clientY: r3.top + 20 }));
    const zones = [...document.querySelectorAll('.menu *')].find(x => x.children.length < 3 && /^Voir les zones/.test(x.textContent.trim()));
    assert(zones, 'Le clic droit propose Voir les zones'); zones.click();
    await wait(() => !!document.querySelector('.iv-lightbox'));
    assert(window.kdDetect && /Visage ×1/.test(document.querySelector('.iv-lightbox')?.textContent || document.body.textContent), 'Voir les zones affiche les zones trouvées');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
  {
    // Retouche : un mode de fusion agit directement sur un calque seul (sans copie), et l'affichage = l'export
    // document à part (le document partagé et son historique servent aux tests suivants)
    const prevDoc = KS.state.doc;
    const d = KS.addDoc(KS.createDoc({ name: 'Fusion', width: 96, height: 64, background: 'custom', color: { r: 120, g: 150, b: 200 } }));
    const L0 = d.layers[0], gx = L0.canvas.getContext('2d');
    for (let y = 0; y < 64; y += 8) for (let x = 0; x < 96; x += 8) { gx.fillStyle = `rgb(${(x * 2.6) | 0},${(y * 3.8) | 0},${((x + y) * 1.5) | 0})`; gx.fillRect(x, y, 8, 8); }
    L0.touch();
    const px = () => { const c = d.flatten(); const x = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let t = 0; for (let k = 0; k < x.length; k += 4) t += x[k] + x[k + 1] + x[k + 2]; return t; };
    const base = px(), res = {};
    for (const m of ['darken', 'multiply', 'lighten', 'screen', 'overlay', 'difference', 'hue', 'saturation', 'color', 'luminosity']) { L0.blend = m; res[m] = px(); }
    L0.blend = 'multiply'; L0.opacity = 0.5; const half = px(); L0.opacity = 1;
    assert(half < base && half > res.multiply && Math.abs(half - (base + res.multiply) / 2) < base * 0.03, 'L’opacité dose l’effet sur un calque seul ' + half);
    L0.blend = 'normal';
    assert(res.darken < base && res.multiply < base, 'Obscurcir et Produit assombrissent un calque seul ' + JSON.stringify([base, res.darken, res.multiply]));
    assert(res.lighten > base && res.screen > base, 'Éclaircir et Superposition éclaircissent un calque seul');
    assert(['overlay', 'difference', 'hue', 'saturation', 'color', 'luminosity'].every(m => res[m] !== base), 'Tous les modes changent un calque seul ' + JSON.stringify(res));
    assert(d.layers.length === 1, 'Aucune copie de calque créée');
    // avec un calque dessous, le mode reprend son sens habituel (le haut se mélange au bas)
    L0.blend = 'multiply';
    const under = new KS.Layer({ name: 'Blanc', w: 96, h: 64 }); const ux = under.canvas.getContext('2d'); ux.fillStyle = '#fff'; ux.fillRect(0, 0, 96, 64);
    d.layers.unshift(under);
    assert(Math.abs(px() - base) < 96 * 64, 'Produit sur du blanc : image d’origine');
    d.dirty = false; await KS.closeDoc(d);
    if (prevDoc && KS.state.doc !== prevDoc) KS.switchDoc(prevDoc);
  }
  await click('⛶', document.querySelector('.fx-source'));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(!KS.modalOpen() && +sourceZoom.dataset.scale === 1, 'Échap ferme le plein écran sans changer le zoom de la source');
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));   // mise en page finie avant de viser l'image
  const sourceRect = document.querySelector('.fx-source .iv-media').getBoundingClientRect();
  await window.realDoubleClick(Math.round(sourceRect.left + sourceRect.width / 2), Math.round(sourceRect.top + sourceRect.height / 2));
  await wait(() => !!document.querySelector('.iv-lightbox'));
  assert(KS.state.docs.length === docsBeforePreview, 'Le vrai double-clic fonctionne aussi sur la source Img2Img');
  document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
  const dropData = new DataTransfer(); dropData.items.add(new File(['test'], 'test.png', { type: 'image/png' }));
  await KS.cmd.toggleStudio(false);
  window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dropData, bubbles: true, cancelable: true }));
  assert(document.querySelector('#viewport').classList.contains('drop-active'), 'L’indicateur d’import apparaît seulement pendant un dépôt de fichier');
  const child = document.createElement('div'); document.body.append(child);
  child.addEventListener('drop', e => e.stopPropagation()); child.dispatchEvent(new DragEvent('drop', { dataTransfer: dropData, bubbles: true, cancelable: true })); child.remove();
  assert(!document.querySelector('#viewport').classList.contains('drop-active'), 'Un dépôt capturé par un panneau efface aussi le voile global');
  window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dropData, bubbles: true, cancelable: true }));
  window.dispatchEvent(new Event('blur'));
  assert(!document.querySelector('#viewport').classList.contains('drop-active'), 'Une sortie de fenêtre efface le faux filigrane');
  await KS.cmd.toggleStudio(true);
  await click('Vers Img2Img');
  assert(KS.state.docs.length === 2 && KS.studio.on, 'Reprendre un résultat ne crée pas de document dans l’Édition');
  assert(KS.prefs.fx.i2i.prompt === 'original <lora:test:0.7>' && KS.prefs.fx.i2i.seed === -1, 'L’invite suit le résultat et la graine reste aléatoire');
  await click('Inpaint');
  const paintPreview = document.querySelector('.fx-source .iv-viewport'), paintedBeforePan = document.querySelector('.fx-painter').toDataURL();
  paintPreview.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 71, button: 1, clientX: 40, clientY: 40, bubbles: true }));
  paintPreview.dispatchEvent(new PointerEvent('pointermove', { pointerId: 71, clientX: 70, clientY: 80, bubbles: true }));
  paintPreview.dispatchEvent(new PointerEvent('pointerup', { pointerId: 71, button: 1, bubbles: true }));
  assert(document.querySelector('.fx-painter').toDataURL() === paintedBeforePan, 'Déplacer l’aperçu au bouton central ne peint pas le masque');
  assert(KS.studio.on && !!document.querySelector('.fx-painter') && KS.state.docs.length === 2, 'Inpaint reste dans le Studio et affiche son propre canevas');
  const paint = (from, to = from) => {
    const canvas = document.querySelector('.fx-painter'), rect = canvas.getBoundingClientRect();
    const send = (type, p) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, button: 0, bubbles: true,
      clientX: rect.left + p.x * rect.width / 128, clientY: rect.top + p.y * rect.height / 64 }));
    send('pointerdown', from); send('pointermove', to); send('pointerup', to);
  };
  KS.prefs.fx.painter.size = 16;
  paint({ x: 8, y: 8 }, { x: 12, y: 12 });
  await KS.cmd.studioGenerate();
  assert(window.calls.length === 2 && !!window.calls[1].mask, 'Le masque peint directement dans le Studio est envoyé à Forge');
  const maskSent = await KS.util.canvasFromBlob(new Blob([window.calls[1].mask], { type: 'image/png' }));
  assert(maskSent.getContext('2d').getImageData(8, 8, 1, 1).data[0] === 255 && maskSent.getContext('2d').getImageData(40, 40, 1, 1).data[0] === 0, 'Le masque envoyé est blanc dans la zone peinte et noir ailleurs');
  assert(KS.studio.on && a.layers.length === 1 && b.layers.length === 1 && KS.state.doc === b, 'Peindre dans le Studio ne change aucun document de l’Édition');
  const cancelOps = KS.cancelActiveOps; let canceledEditor = false;
  KS.cancelActiveOps = () => { canceledEditor = true; };
  await click('Annuler');
  const callsBeforeUndo = window.calls.length;
  await KS.cmd.studioGenerate();
  assert(window.calls.length === callsBeforeUndo, 'Annuler efface le trait de masque dans le Studio');
  await click('Rétablir');
  document.querySelector('.fx-img2img').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  document.querySelector('.fx-img2img').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
  assert(!canceledEditor, 'Annuler et rétablir dans le Studio ne touchent pas aux opérations de l’Édition');
  KS.cancelActiveOps = cancelOps;
  await click('Inverser');
  await KS.cmd.studioGenerate();
  assert(window.calls.length === 3 && !!window.calls[2].mask, 'Les outils de masque fonctionnent depuis le Studio');
  await more('Ajouter en calque');
  assert(!KS.studio.on && b.layers.length === 2, 'Ajouter en calque revient volontairement au document actif dans l’Édition');
  await KS.cmd.sendToStudio('img2img');
  await click('Ouvrir dans Retouche');
  assert(!KS.studio.on && KS.state.doc !== b, 'Ouvrir un résultat crée un nouveau document dans l’Édition');
  await KS.cmd.sendToStudio('extras');
  assert(KS.prefs.fx.tab === 'extras' && !!document.querySelector('.fx-dropzone .iv-media'), 'L’Édition envoie aussi vers Extras');
  await KS.cmd.sendToStudio('pnginfo');
  assert(KS.prefs.fx.tab === 'pnginfo', 'L’Édition envoie aussi vers PNG Info');
  await click('Envoyer vers Img2Img');
  assert(KS.prefs.fx.tab === 'img2img', 'PNG Info renvoie sa source vers Img2Img');
  document.querySelector('.fx-srcfoot button[title="Retirer la source"]').click(); await new Promise(r => setTimeout(r, 30));
  const count = window.calls.length;
  await KS.cmd.studioGenerate();
  assert(window.calls.length === count, 'Aucune génération Img2Img sans source');
  const canvas = a.composite(), bytes = new Uint8Array(await (await KS.util.blobFromCanvas(canvas)).arrayBuffer());
  window.pickFiles = [{ name: 'Import.png', data: KS.png.writeText(bytes, 'parameters', 'Imported prompt\nSteps: 18, Sampler: Euler, Seed: 123, Size: 128x64') }];
  document.querySelector('.fx-source .fx-dropzone').click();
  await wait(() => document.querySelector('.fx-source .iv-media')?.getAttribute('aria-label') === 'Import.png');
  assert(KS.prefs.fx.i2i.seed === -1 && KS.prefs.fx.i2i.prompt === 'Imported prompt', 'Importer un PNG reprend l’invite sans figer sa graine');
  await click('Créer', document.querySelector('.fx-rail'));
  assert(KS.prefs.fx.tab === 'txt2img' && !!document.querySelector('.fx-out'), 'txt2img reste accessible');
  KS.prefs.fx.t2i.prompt = 'new image <lora:test:0.8>';
  await KS.cmd.studioGenerate();
  {
    // Refaire avec un autre modèle : même invite et même graine, modèle changé pour cette image seulement, puis comparaison
    const callsBefore = window.txtCalls.length, shownBefore = KS.prefs.fx.t2i.steps;
    await more('Refaire avec un autre modèle…');
    await wait(() => !!document.querySelector('.modal .fx-pickmodel .fx-card'));
    const cards = [...document.querySelectorAll('.modal .fx-pickmodel .fx-card')];
    assert(cards.length === 1 && cards[0].querySelector('.fx-card-n').textContent === 'Anima-2.9B.safetensors', 'Le choix propose les autres modèles, pas le modèle actif : ' + cards.map(c => c.textContent).join(', '));
    cards[0].click();
    await wait(() => window.txtCalls.length === callsBefore + 1 && !!document.querySelector('.iv-lightbox .iv-cmp'));
    const p = window.txtCalls.at(-1);
    assert(p.seed === 84 && p.override_settings.sd_model_checkpoint === 'Anima-2.9B.safetensors [abcdef1234]' && p.override_settings_restore_afterwards && p.n_iter === 1 && p.steps === 20,
      'La même image est refaite avec la même graine et l’autre modèle pour cette génération seulement : ' + JSON.stringify({ seed: p.seed, o: p.override_settings, steps: p.steps }));
    assert(KS.prefs.fx.t2i.steps === shownBefore && KS.prefs.fx.t2i.seed === -1, 'Les réglages affichés du Studio ne changent pas');
    window.txtCalls.pop();   // la suite compte les générations ordinaires, toutes à graine aléatoire
    assert(document.querySelectorAll('.iv-lightbox .iv-cmp .iv-media').length === 2 && document.querySelector('.iv-lightbox h3').textContent === 'Comparer les modèles', 'La comparaison s’ouvre sur les deux modèles');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(() => !KS.modalOpen());
    assert(document.querySelectorAll('.fx-thumbs img').length === 2 && [...document.querySelectorAll('.fx-output-actions button')].some(b => b.textContent === 'Comparer à l’original'), 'L’original reste à côté du nouveau résultat, comparable à tout moment');
    // galerie : choisir une image, puis comparer avec une autre
    KS.panels.focus('gallery');
    const cells = () => [...document.querySelectorAll('.ga-cell')];
    assert(cells().length >= 2, 'La galerie de la séance montre les images : ' + cells().length);
    {
      cells()[0].click();
      [...document.querySelectorAll('.menu .mi')].find(x => x.textContent.trim() === 'Choisir pour comparer').click();
      await wait(() => cells()[0].classList.contains('cmp'));
      cells()[1].click();
      [...document.querySelectorAll('.menu .mi')].find(x => x.textContent.trim() === 'Comparer avec l’image choisie').click();
      await wait(() => !!document.querySelector('.iv-lightbox .iv-cmp'));
      assert(!cells()[0].classList.contains('cmp') && document.querySelectorAll('.iv-lightbox .iv-cmp .iv-media').length === 2, 'Comparer deux images de la galerie, puis le choix est remis à zéro');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(() => !KS.modalOpen());
    }
  }
  const docsBefore = KS.state.docs.length;
  await click('Vers Img2Img');
  assert(KS.prefs.fx.i2i.seed === -1 && KS.state.docs.length === docsBefore, 'txt2img envoie vers Img2Img avec une nouvelle graine aléatoire');
  document.querySelector('.fx-source button[title="Ouvrir la source dans Retouche"]').click(); await new Promise(r => setTimeout(r, 30));
  await KS.cmd.sendToStudio('img2img');
  assert(KS.prefs.fx.i2i.seed === -1, 'Un aller-retour dans l’Édition conserve le mode aléatoire');
  await click('img2img', document.querySelector('.fx-modes'));
  await KS.cmd.studioGenerate();
  await more('Agrandir avec le hires fix (Créer)');
  assert(KS.prefs.fx.tab === 'txt2img' && KS.prefs.fx.t2i.prompt === 'new image <lora:test:0.8>', 'Img2Img renvoie image et réglages vers txt2img / Hires');
  await more('Agrandir avec le hires fix');
  await wait(() => window.txtCalls.length === 2 && !!document.querySelector('.fx-generate'));
  assert(window.txtCalls.at(-1).seed === -1, 'Hires demande aussi une graine aléatoire');
  assert(window.txtCalls.at(-1).override_settings.show_progress_type === 'Full' && window.txtCalls.at(-1).override_settings.show_progress_every_n_steps >= 2, 'L’aperçu en direct demande le décodage complet (net) à chaque génération');
  await click('Transformer', document.querySelector('.fx-rail'));
  assert(document.querySelector('.fx-source .iv-media').getAttribute('aria-label').startsWith('new image'), 'La source survit au changement d’onglet');
  await click('Inpaint sketch');
  KS.prefs.fx.painter.color = '#22cc44'; KS.prefs.fx.painter.erase = false;
  const beforeSketch = window.calls.length;
  paint({ x: 8, y: 8 }); await KS.cmd.studioGenerate();
  const sketch = await KS.util.canvasFromBlob(new Blob([window.calls.at(-1).init], { type: 'image/png' }));
  assert(window.calls.length === beforeSketch + 1 && !!window.calls.at(-1).mask && sketch.getContext('2d').getImageData(8, 8, 1, 1).data[1] === 204 && KS.studio.on,
    'Inpaint sketch peint ses couleurs et son masque entièrement dans le Studio');
  await click('Gomme'); KS.prefs.fx.painter.size = 32; paint({ x: 8, y: 8 });
  const beforeErase = window.calls.length;
  await KS.cmd.studioGenerate();
  assert(window.calls.length === beforeErase, 'La gomme du Studio efface la zone du croquis');
  await click('img2img', document.querySelector('.fx-modes'));
  const file = new File([bytes], 'Drop.png', { type: 'image/png' }), transfer = new DataTransfer(); transfer.items.add(file);
  document.querySelector('.fx-source .fx-dropzone').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  await wait(() => document.querySelector('.fx-source .iv-media')?.getAttribute('aria-label') === 'Drop.png');
  assert(KS.state.docs.length === docsBefore + 1, 'Glisser-déposer importe dans le Studio sans ouvrir de document');
  await click('Batch');
  window.pickFiles = [{ name: 'One.png', data: bytes }, { name: 'Two.png', data: bytes }];
  await click('Choisir des images…');
  const beforeBatch = window.calls.length;
  await KS.cmd.studioGenerate();
  assert(window.calls.length === beforeBatch + 2 && document.querySelectorAll('.fx-img2img .fx-thumbs img').length === 2, 'Batch traite chaque entrée et conserve les résultats dans le Studio');
  await click('img2img', document.querySelector('.fx-modes'));
  KS.prefs.fx.i2i.seed = 1234; KS.prefs.fx.i2i.subseed = 4321; KS.prefs.fx.i2i.seedExtra = true;
  await KS.cmd.studioGenerate();
  assert(window.calls.at(-1).payload.seed === -1 && window.calls.at(-1).payload.subseed === -1, 'Une ancienne graine fixe ne bloque plus les générations suivantes');
  assert(window.calls.every(c => c.payload.seed === -1) && window.txtCalls.every(p => p.seed === -1), 'Toutes les générations txt2img, Img2Img et Batch demandent une graine aléatoire');
  const key = (target, repeat = false) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', ctrlKey: true, repeat, bubbles: true, cancelable: true }));
  const beforeShortcut = window.calls.length;
  window.holdGeneration = true;
  key(document.querySelector('textarea.fx-prompt'));
  await wait(() => window.calls.length === beforeShortcut + 1 && !!window.releaseGeneration);
  assert(!!document.querySelector('.fx-interrupt'), 'Ctrl+Entrée démarre depuis l’invite et affiche Interrompre');
  key(document.querySelector('textarea.fx-prompt'), true);
  assert(window.interrupts === 0, 'Maintenir Ctrl+Entrée ne provoque pas une interruption immédiate');
  key(document.querySelector('.fx-num'));
  await wait(() => window.interrupts === 1 && !!document.querySelector('.fx-generate'));
  assert(window.calls.length === beforeShortcut + 1, 'Ctrl+Entrée depuis un réglage interrompt sans lancer une deuxième requête');
  window.holdGeneration = false; window.holdStatus = true;
  key(document.querySelector('.fx-source'));
  await wait(() => !!window.releaseStatus);
  key(document.querySelector('.fx-source'));
  window.holdStatus = false; window.releaseStatus(); window.releaseStatus = null;
  await wait(() => !!document.querySelector('.fx-generate'));
  assert(window.calls.length === beforeShortcut + 1, 'Ctrl+Entrée annule aussi une génération encore en préparation');
  const aiMenu = KS.menus.defs().find(m => m.label === 'IA').items();
  assert(aiMenu.some(i => i.label === 'Envoyer vers Img2Img — transformer l’image') && aiMenu.some(i => i.label === 'Envoyer vers Inpaint — retoucher une zone'), 'Le menu IA propose clairement Img2Img et Inpaint au même niveau');
  assert(!!button('Vers Img2Img') && !!button('Vers Inpaint'), 'Les résultats proposent les deux destinations avec des libellés explicites');
  await KS.cmd.toggleStudio(false);
  document.querySelector('.ws-to-studio').click();
  const sendItem = [...document.querySelectorAll('.menu .mi')].find(i => i.textContent.includes('Envoyer vers Img2Img'));
  assert(!!sendItem, 'Le menu d’envoi du document contient Img2Img');
  sendItem.click();
  await wait(() => KS.studio.on && KS.prefs.fx.i2iMode === 'img2img');
  await KS.cmd.sendToStudio('extras'); window.holdGeneration = true;
  key(document.querySelector('.fx-num'));
  await wait(() => window.extraCalls.length === 1 && !!window.releaseGeneration);
  key(document.querySelector('.fx-num'));
  await wait(() => window.interrupts === 2 && !!document.querySelector('.fx-generate'));
  assert(window.extraCalls.length === 1, 'Ctrl+Entrée démarre et interrompt aussi Extras');
  await KS.cmd.openStudioTab('txt2img');
  const beforeT2IShortcut = window.txtCalls.length;
  key(document.querySelector('textarea.fx-prompt'));
  await wait(() => window.txtCalls.length === beforeT2IShortcut + 1 && !!window.releaseGeneration);
  key(document.querySelector('textarea.fx-prompt'));
  await wait(() => window.interrupts === 3 && !!document.querySelector('.fx-generate'));
  assert(window.txtCalls.length === beforeT2IShortcut + 1 && window.txtCalls.at(-1).seed === -1, 'Ctrl+Entrée démarre et interrompt txt2img avec une graine aléatoire');
  window.holdGeneration = false;
  await KS.cmd.openStudioTab('img2img');
  await click('Inpaint');
  await click('Peindre le masque');
  paint({ x: 8, y: 8 }, { x: 40, y: 24 });
  assert(document.querySelectorAll('.fx-output-actions > .fx-actiongroup').length === 3 && !!document.querySelector('.fx-output-actions .fx-more'), 'Les actions du résultat : l’essentiel en trois groupes, le reste dans Plus');
  assert(![...document.querySelectorAll('.fx-output-actions button')].some(b => /^[📂💾🗃️✨]+$/u.test(b.textContent)), 'Les actions du résultat utilisent des libellés explicites');
  for (const theme of ['dark', 'graphite', 'light']) {
    KS.prefs.theme = theme; KS.prefs.accent = '#8c60d0'; KS.applyPrefs();
    const style = getComputedStyle(document.querySelector('#studio'));
    assert(style.getPropertyValue('--fx-accent').trim() === getComputedStyle(document.body).getPropertyValue('--accent').trim(), 'Le Studio suit la couleur d’accent du thème ' + theme);
  }
  const drawDoc = doc('Dessin à la demande'); KS.addDoc(drawDoc);
  drawDoc.selection.rect({ x: 20, y: 10, w: 30, h: 25 }, 'new', 0); KS.emit('selection', drawDoc);
  KS.prefs.fx.t2i.prompt = 'golden star <lora:test:0.6>'; KS.prefs.fx.t2i.negative_prompt = 'noise';
  KS.prefs.fx.t2i.styles = ['Shared style']; KS.prefs.fx.t2i.sampler_name = 'Euler'; KS.prefs.fx.t2i.scheduler = 'Automatic'; KS.prefs.fx.t2i.steps = 19; KS.prefs.fx.t2i.cfg_scale = 5;
  KS.prefs.fx.t2i.kd.enabled = true;
  drawDoc.genParams = { prompt: 'initial landscape', styles: [] }; drawDoc.genInfo = 'initial landscape\nSteps: 19';
  const beforePanel = window.calls.length + window.txtCalls.length;
  await KS.cmd.openEditorDraw();
  await wait(() => drawDoc.view.init && KS.view.w > 0);
  assert(!!KS.util.rectIntersect({ x: drawDoc.view.x, y: drawDoc.view.y, w: drawDoc.width * drawDoc.view.zoom, h: drawDoc.height * drawDoc.view.zoom }, { x: 0, y: 0, w: KS.view.w, h: KS.view.h }), 'Le document créé depuis le Studio reste visible au retour dans l’Édition');
  assert(!KS.studio.on && KS.panels.isVisible('aidraw') && window.calls.length + window.txtCalls.length === beforePanel, 'Ouvrir Dessin IA ne lance aucune génération et conserve l’Édition');
  const drawRoot = document.querySelector('.edraw');
  const panelBox = drawRoot.closest('.pbody').getBoundingClientRect(), addBox = drawRoot.querySelector('.fx-generate').getBoundingClientRect();
  assert(addBox.top >= panelBox.top && addBox.bottom <= panelBox.bottom, 'Le bouton Ajouter le dessin est visible sans faire défiler le panneau');
  assert(drawRoot.querySelector('textarea').value === '' && drawRoot.textContent.includes('Studio-model'), 'La demande locale démarre vide et garde le modèle du Studio');
  assert(KS.prefs.fx.editor.strength === 0.5, 'L’ancienne force de 85 % est migrée à 50 %');
  const expectedPrompt = KS.prefs.fx.t2i.prompt;
  const localPrompt = drawRoot.querySelector('textarea'); localPrompt.value = 'a small wooden bridge'; localPrompt.dispatchEvent(new Event('input'));
  await KS.cmd.editorDraw();
  const request = window.calls.at(-1);
  assert(request.payload.prompt === 'a small wooden bridge <lora:test:0.6>' && request.payload.styles[0] === 'Shared style' && request.payload.sampler_name === 'Euler' && request.payload.steps === 19 && request.payload.cfg_scale === 5 && request.payload.negative_prompt === 'noise' && request.url === KS.gen.url(), 'La demande remplace la scène du Studio et conserve LoRA, styles, échantillonnage et moteur');
  assert(request.payload.denoising_strength === 0.5 && request.payload.seed === -1 && request.mask && !request.payload.enable_hr && !request.payload.alwayson_scripts['Kane Detailer'] && !request.payload.alwayson_scripts.ADetailer, 'Le remplissage est un inpaint à 50 %, avec masque, graine aléatoire et sans retouche automatique des visages');
  assert(KS.prefs.fx.t2i.prompt === expectedPrompt, 'La demande locale ne modifie pas la description du Studio');
  assert(drawDoc.genParams.prompt === 'initial landscape' && drawDoc.genInfo.startsWith('initial landscape'), 'La retouche préserve le prompt initial et les métadonnées du document');
  await KS.cmd.sendToStudio('params');
  assert(KS.prefs.fx.t2i.prompt === 'initial landscape', 'Renvoyer les paramètres du document au Studio retrouve le prompt initial');
  KS.prefs.fx.t2i.prompt = expectedPrompt; KS.prefs.fx.t2i.styles = ['Shared style']; await KS.cmd.openEditorDraw();

  const generated = drawDoc.layers.at(-1), maskData = generated.mask.canvas.getContext('2d');
  assert(drawDoc.layers.length === 2 && generated.mask && maskData.getImageData(30, 20, 1, 1).data[0] > 200 && maskData.getImageData(100, 50, 1, 1).data[0] === 0 && !KS.studio.on, 'Le dessin dans la sélection crée un calque masqué et reste dans l’Édition');
  assert(drawDoc.layers[0].ctx.getImageData(0, 0, 1, 1).data[2] === 187, 'Le dessin IA préserve les pixels du calque original');
  assert(generated._gen.params.prompt === 'a small wooden bridge <lora:test:0.6>', 'La retouche conserve ses propres paramètres sur son calque');
  KS.gen.setVariant(drawDoc, generated, 0);
  assert(drawDoc.genInfo.startsWith('initial landscape'), 'Changer de variante préserve aussi le prompt initial');
  KS.cmd.undo(); KS.cmd.undo(); assert(drawDoc.layers.length === 1, 'L’ajout du dessin peut être annulé en une seule étape');
  drawDoc.selection.clear(); KS.emit('selection', drawDoc);
  assert(drawRoot.querySelector('.fx-generate').disabled, 'Le mode sélection attend une zone avant de générer');
  const destination = drawRoot.querySelector('select'); destination.value = 'layer'; destination.dispatchEvent(new Event('change'));
  await KS.cmd.openStudioTab('txt2img');
  assert(document.querySelector('#studio textarea').value === expectedPrompt, 'Les modifications du panneau se retrouvent dans le Studio');
  const studioPrompt = document.querySelector('#studio textarea'); studioPrompt.value = 'a silver moon <lora:test:0.4>'; studioPrompt.dispatchEvent(new Event('input'));
  await KS.cmd.openEditorDraw();
  assert(document.querySelector('.edraw textarea').value === 'a small wooden bridge', 'Changer la scène du Studio ne remplace pas la demande locale');
  const beforeDrawT2I = window.txtCalls.length; await KS.cmd.editorDraw();
  assert(window.txtCalls.length === beforeDrawT2I + 1 && drawDoc.layers.length === 2 && !drawDoc.layers.at(-1).mask && !KS.studio.on, 'Le mode nouveau calque dessine sans sélection avec txt2img');
  assert(window.txtCalls.at(-1).prompt === 'a small wooden bridge <lora:test:0.4>', 'Les poids LoRA modifiés dans le Studio sont relus à la génération suivante');
  drawDoc.selection.rect({ x: 20, y: 10, w: 30, h: 25 }, 'new', 0);
  await KS.cmd.generativeFill();
  for (const force of [0.4, 0.6]) {
    const forceSelect = document.querySelectorAll('.edraw select')[1];
    forceSelect.value = String(force); forceSelect.dispatchEvent(new Event('change'));
    await KS.cmd.generativeFill('a stone path');
    assert(window.calls.at(-1).payload.denoising_strength === force && window.calls.at(-1).payload.prompt === 'a stone path <lora:test:0.4>', 'Le remplissage depuis le menu partage la force ' + force + ' et les LoRA actifs');
  }
  const beforeEmpty = window.calls.length;
  await KS.cmd.generativeFill('');
  assert(window.calls.length === beforeEmpty && document.querySelector('.edraw .fx-generate').disabled && !KS.modalOpen(), 'Une demande vide ouvre le panneau sans génération ni ancien dialogue avancé');
  await KS.cmd.generativeFill();
  assert(!KS.modalOpen() && KS.panels.isVisible('aidraw'), 'Le menu Remplissage ouvre le même panneau simple');
  KS.prefs.fx.editor.prompt = 'une petite maison'; KS.prefs.fx.translate = true;
  const oldEnglish = KS.gen.toEnglish; KS.gen.toEnglish = async () => null;
  await KS.cmd.editorDraw();
  assert(window.calls.length === beforeEmpty, 'Une traduction indisponible ne lance pas une génération française incomprise');
  KS.gen.toEnglish = async () => 'a small house';
  await KS.cmd.editorDraw();
  assert(window.calls.at(-1).payload.prompt === 'a small house <lora:test:0.4>', 'La traduction conserve les balises LoRA et traduit uniquement la demande locale');
  KS.gen.toEnglish = oldEnglish; KS.prefs.fx.translate = false;
  const interruptsBeforeDraw = window.interrupts, layersBeforeCancel = drawDoc.layers.length;
  window.holdGeneration = true; key(document.querySelector('.edraw textarea'));
  await wait(() => !!window.releaseGeneration);
  key(document.querySelector('.edraw textarea'));
  await wait(() => window.interrupts === interruptsBeforeDraw + 1 && !!document.querySelector('.edraw .fx-generate'));
  assert(drawDoc.layers.length === layersBeforeCancel, 'Ctrl+Entrée interrompt le dessin IA sans ajouter un calque incomplet');
  window.holdGeneration = false;
  assert(KS.menus.defs().find(m => m.label === 'IA').items().some(i => i.label === 'Ajouter un dessin IA…'), 'Le panneau Dessin IA est également accessible dans le menu IA');
  KS.prefs.theme = 'dark'; KS.prefs.accent = '#2f6fdb'; KS.applyPrefs();
  await KS.cmd.openStudioTab('txt2img');
  document.querySelector('#toasts').replaceChildren();
  document.querySelector('.fx-body').scrollTop = 0;
  assert([...document.querySelectorAll('.fx-rail button')].some(b => b.textContent === 'Lora'), 'Le volet LoRA porte le nom Lora');
  const priorDoc = KS.state.doc; KS.state.doc = null;
  await click('Découper', document.querySelector('.fx-rail'));
  await wait(() => !!document.querySelector('.sc-prev'));
  assert(!!document.querySelector('.sc-prev'), 'Découper ouvre le résultat du Studio sans document dans Édition');
  await click('Exporter les panneaux…', document.querySelector('.modal'));
  await wait(() => !!window.cutFiles?.length);
  assert(window.cutFiles.every(f => f.data.length > 100 && /_\d+\.jpg$/.test(f.name)), 'La découpe exporte les panneaux de l’image du Studio');
  KS.state.doc = priorDoc;
  await KS.cmd.openStudioTab('train'); await wait(() => !!document.querySelector('.lt-drop'));
  const beforeLoraDocs = KS.state.docs.length, loraDrop = new DataTransfer();
  loraDrop.items.add(new File([bytes], 'training-a.png', {type:'image/png'}));
  loraDrop.items.add(new File([bytes], 'training-b.png', {type:'image/png'}));
  document.querySelector('.lt-drop').dispatchEvent(new DragEvent('drop', { dataTransfer:loraDrop, bubbles:true, cancelable:true }));
  await wait(() => window.loraImages.length === 2 && document.querySelectorAll('.lt-cell').length === 2);
  await new Promise(r => setTimeout(r,100));
  assert(KS.state.docs.length === beforeLoraDocs && KS.prefs.fx.tab === 'train', 'Importer plusieurs images par dépôt dans Lora ne crée aucun document dans Edition');
  window.loraPaths = ['C:/selected/picked.png']; document.querySelector('.lt-drop').click();
  await wait(() => window.loraImages.length === 3);
  assert(KS.state.docs.length === beforeLoraDocs, 'Choisir les images dans Lora les garde aussi dans cet atelier');
  window.dispatchEvent(new DragEvent('drop', { dataTransfer:loraDrop, bubbles:true, cancelable:true }));
  await new Promise(r => setTimeout(r,100));
  assert(KS.state.docs.length === beforeLoraDocs, 'Un dépôt ailleurs dans le Studio ne passe pas implicitement dans Edition');
  // Atelier Lora : une carte par époque (images d'aperçu), « Garder cette version » installe avec le déclencheur @
  window.loraRun = { run: 'C:/runs/r1', project: 'Import-test', running: false, state: 'done', pct: 100, text: 'Terminé', output: 'C:/out/n1x3u.safetensors', token: '@n1x3u',
    checkpoints: ['C:/out/n1x3u-000002.safetensors', 'C:/out/n1x3u.safetensors'], samples: [], before: ['C:/out/sample/n1x3u_000000_00_1.png'],
    epochs: [{ epoch: 2, path: 'C:/out/n1x3u-000002.safetensors', name: 'n1x3u-000002', final: false, samples: ['C:/out/sample/n1x3u_e000002_00_1.png', 'C:/out/sample/n1x3u_e000002_01_1.png'] },
      { epoch: 4, path: 'C:/out/n1x3u.safetensors', name: 'n1x3u', final: true, samples: ['C:/out/sample/n1x3u_e000004_00_1.png'] }] };
  KS.trainTab.invalidate(); await wait(() => document.querySelectorAll('.lt-ep').length === 3);
  const eps = [...document.querySelectorAll('.lt-ep')];
  assert(eps.length === 3 && eps[0].classList.contains('before') && eps[1].classList.contains('final') && eps[2].querySelectorAll('.lt-ep-imgs img').length === 2, 'Lora : référence sans LoRA, puis une carte par époque (la finale en premier) avec ses images');
  [...eps[2].querySelectorAll('button')].find(b => b.textContent === 'Garder cette version').click();
  await wait(() => window.loraInstalls?.length === 1);
  assert(window.loraInstalls[0].path.endsWith('n1x3u-000002.safetensors') && window.loraInstalls[0].token === '@n1x3u' && window.loraInstalls[0].weight === 1 && window.loraInstalls[0].preview.includes('e000002_01'), 'Garder une époque l’installe avec @n1x3u, poids 1 et son image');
  window.loraRun = null; KS.trainTab.invalidate();
  await KS.cmd.openStudioTab('txt2img');
  // Chercher / remplacer, nettoyer et historique des invites
  const pta = document.querySelector('.fx-prompts textarea.fx-prompt'), fbar = document.querySelector('.fx-prompts .kf-bar');
  const type = (el, v) => { el.value = v; el.dispatchEvent(new Event('input')); };
  type(pta, 'red hair, blue eyes, Red hair, smile');
  pta.focus(); pta.setSelectionRange(0, 8);
  pta.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 150));
  const finput = fbar.querySelector('.kf-input'), fcount = fbar.querySelector('.kf-count');
  assert(!fbar.hidden && finput.value === 'red hair' && fcount.textContent === '1/2', 'Ctrl+F dans l’invite ouvre la recherche avec le mot sélectionné (2 occurrences, casse ignorée)');
  assert(pta.parentElement.querySelectorAll('.kf-mirror mark').length === 2, 'Les occurrences sont surlignées dans l’invite');
  finput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert(fcount.textContent === '2/2', 'Entrée passe à l’occurrence suivante');
  await click('Aa', fbar); await new Promise(r => setTimeout(r, 30));
  assert(fcount.textContent === '1/1', 'Respecter la casse réduit les occurrences');
  await click('Aa', fbar);
  await click('⇄', fbar);
  fbar.querySelector('.kf-rinput').value = 'blonde hair';
  await click('Tout remplacer', fbar);
  assert(KS.prefs.fx.t2i.prompt === 'blonde hair, blue eyes, blonde hair, smile' && fcount.textContent === '0', 'Tout remplacer met à jour l’invite enregistrée');
  const interruptsBefore = window.interrupts;
  fbar.querySelector('.kf-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert(fbar.hidden && !pta.parentElement.querySelector('.kf-mirror mark') && window.interrupts === interruptsBefore, 'Échap range la recherche sans interrompre la génération');
  document.querySelector('.fx-ptools button[title^="Nettoyer"]').click(); await new Promise(r => setTimeout(r, 30));
  assert(KS.prefs.fx.t2i.prompt === 'blonde hair, blue eyes, smile', 'Nettoyer retire les doublons');
  type(pta, '  (red hair, blue eyes:1.2),, smile ,smile, <lora:test:0.7>  painted\nBREAK , smile');
  document.querySelector('.fx-ptools button[title^="Nettoyer"]').click(); await new Promise(r => setTimeout(r, 30));
  assert(KS.prefs.fx.t2i.prompt === '(red hair, blue eyes:1.2), smile, <lora:test:0.7> painted\nBREAK, smile', 'Nettoyer garde les groupes entre parenthèses, les LoRA et les lignes');
  KS.prefs.fx.promptHistory = [];
  type(pta, 'history one'); await KS.cmd.studioGenerate();
  type(pta, 'history two'); await KS.cmd.studioGenerate();
  type(pta, 'history one'); await KS.cmd.studioGenerate();
  assert(KS.prefs.fx.promptHistory.map(e => e.p).join('|') === 'history one|history two', 'L’historique garde chaque invite générée une fois, la plus récente en tête');
  document.querySelector('.fx-ptools button[title^="Historique"]').click(); await new Promise(r => setTimeout(r, 30));
  const hmodal = document.querySelector('.modal'), hq = hmodal.querySelector('input[type=search]');
  type(hq, 'two');
  assert(hmodal.querySelectorAll('.kf-hrow').length === 1, 'La recherche filtre l’historique');
  hmodal.querySelector('.kf-hrow').click();
  await new Promise(r => setTimeout(r, 30));
  assert(!document.querySelector('.modal') && KS.prefs.fx.t2i.prompt === 'history two' && document.querySelector('.fx-prompts textarea.fx-prompt').value === 'history two', 'Cliquer une entrée reprend l’invite');
  // Pendant une génération : un clic sur l'aperçu en direct montre la dernière image terminée
  window.holdGeneration = true;
  const running = KS.cmd.studioGenerate();
  await wait(() => !!window.releaseGeneration && !!document.querySelector('.fx-view.live'));
  const lastDone = KS.studio.gallery[0];
  document.querySelector('.fx-view.live').click();
  await wait(() => !!document.querySelector('.iv-lightbox .iv-media'));
  assert(!lastDone.canvas && lastDone.blob instanceof Blob && lastDone.blob.type === 'image/png', 'La galerie garde le PNG compressé, pas l’image décodée');
  const peek = document.querySelector('.iv-lightbox .iv-media');
  await wait(() => peek.complete && peek.naturalWidth > 0);
  assert(document.querySelector('.iv-lightbox h3').textContent.startsWith('Dernière image terminée') && peek.src.startsWith('blob:') && peek.naturalWidth === lastDone.w && peek.naturalHeight === lastDone.h, 'Pendant la génération, un clic sur l’aperçu affiche la dernière image terminée');
  assert(!!document.querySelector('.fx-view.live') && !!document.querySelector('.fx-interrupt'), 'La génération continue derrière le plein écran');
  const interruptsPeek = window.interrupts;
  document.querySelector('.iv-lightbox').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert(!KS.modalOpen() && window.interrupts === interruptsPeek && !!window.releaseGeneration, 'Échap ferme ce plein écran sans interrompre la génération');
  window.holdGeneration = false; window.releaseGeneration(); window.releaseGeneration = null; await running;
  assert(!document.querySelector('.fx-view.live') && !!document.querySelector('.fx-view .iv-click-open'), 'Une fois terminée, l’image se voit en plein écran d’un clic');
  // Studio 3 : l'image au centre, l'invite en bas avec ses pastilles, le tiroir, la séance, la loupe
  assert(!!document.querySelector('.fx-v3 .fx-center .fx-dock .fx-composer') && !!document.querySelector('.fx-v3 > .fx-drawer .fx-left .fx-seg') && !!document.querySelector('.fx-v3 > .fx-film'), 'Studio 3 : image au centre, invite en bas, séance et tiroir à droite');
  const pillOf = id => document.querySelector('.fx-pill[data-id="' + id + '"]');
  const negWas = KS.prefs.fx.negOpen;
  pillOf('neg').click(); await new Promise(r => setTimeout(r, 450));
  assert(document.querySelector('.fx-neg').hidden === negWas && KS.prefs.fx.negOpen === !negWas, 'L’invite négative se replie et se rouvre (pastille), état retenu');
  const pta3 = document.querySelector('.fx-prompts textarea.fx-prompt'); pta3.value = 'silver moon <lora:test:0.6>'; pta3.dispatchEvent(new Event('input'));
  assert(pillOf('lora').textContent === 'LoRA · 1', 'La pastille LoRA compte les LoRA de l’invite');
  pillOf('lora').click();
  assert(!!document.querySelector('.fx-pop .fx-lchip'), 'La pastille LoRA montre les LoRA actifs avec leur poids');
  [...document.querySelectorAll('.fx-pop button')].find(b => b.textContent === 'Parcourir tous les LoRA').click();
  assert(!document.querySelector('.fx-pop') && !document.querySelector('.fx-drawer').hidden && document.querySelector('.fx-seg button.on').textContent.startsWith('LoRA') && !!document.querySelector('.fx-drawer .fx-card[data-lora]'), '« Parcourir tous les LoRA » ouvre le tiroir sur les LoRA');
  document.querySelector('.fx-seg button').click();
  pillOf('drawer').click();
  assert(document.querySelector('.fx-drawer').hidden && KS.prefs.fx.drawer === false, 'La pastille Réglages ferme le tiroir');
  pillOf('drawer').click();
  assert(!document.querySelector('.fx-drawer').hidden && KS.prefs.fx.drawer === true, 'et le rouvre');
  const kdWas = !!KS.prefs.fx.t2i.kd.enabled;
  pillOf('kd').click();
  assert(KS.prefs.fx.t2i.kd.enabled === !kdWas && pillOf('kd').classList.contains('on') === !kdWas, 'La pastille Kane Detailer l’active ou le coupe');
  pillOf('kd').click();
  pillOf('model').click();
  assert(!!document.querySelector('.fx-pop .fx-mlist .fx-mrow.on') && !!document.querySelector('.fx-pop .fx-modchips') && !!document.querySelector('.fx-pop select'), 'La pastille Modèle : modèles, VAE / encodeur et précision');
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  assert(!document.querySelector('.fx-pop'), 'La petite fenêtre se ferme d’un clic ailleurs');
  pillOf('format').click();
  [...document.querySelectorAll('.fx-pop .fx-chip')].find(b => b.textContent === '1:1').click();
  assert(pillOf('format').textContent.startsWith('1:1') && KS.prefs.fx.t2i.width === KS.prefs.fx.t2i.height && !!document.querySelector('.fx-pop .fx-chip.on'), 'Le format se choisit dans sa pastille, qui le montre aussitôt');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(!document.querySelector('.fx-pop'), 'Échap ferme la petite fenêtre');
  const film = () => [...document.querySelectorAll('.fx-film img')];
  assert(film().length >= 2 && film().length === KS.studio.gallery.length, 'La séance montre toutes les images générées, en colonne');
  film().at(-1).click();
  await wait(() => film().at(-1).classList.contains('on'));
  assert(!!document.querySelector('.fx-view .iv-media'), 'Un clic sur une image de la séance la remet en grand');
  document.querySelector('.fx-view .iv-viewport').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  await wait(() => film().at(-2).classList.contains('on'));
  assert(film().at(-2).classList.contains('on'), '← passe à l’image voisine de la séance');
  const lensArea = document.querySelector('.fx-view .iv-viewport'), mr = document.querySelector('.fx-view .iv-media').getBoundingClientRect();
  lensArea.dispatchEvent(new PointerEvent('pointermove', { clientX: mr.left + mr.width / 2, clientY: mr.top + mr.height / 2, bubbles: true }));
  assert(!!document.querySelector('.fx-view .fx-loupe') && document.querySelector('.fx-view .fx-loupe').hidden, 'La loupe existe et reste cachée quand l’image est déjà affichée à 100 %');
  assert(!document.querySelector('#studio').textContent.includes('ADetailer') && !Object.keys(KS.prefs.fx.t2i).includes('ad'), 'ADetailer a disparu du Studio');
  return results;
}

app.whenReady().then(async () => {
  let win;
  try {
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { preload, contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
    ipcMain.handle('test-double-click', async (_event, x, y) => {
      win.webContents.sendInputEvent({ type:'mouseMove', x, y });
      for (const clickCount of [1, 2]) {
        win.webContents.sendInputEvent({ type:'mouseDown', x, y, button:'left', clickCount });
        win.webContents.sendInputEvent({ type:'mouseUp', x, y, button:'left', clickCount });
      }
    });
    ipcMain.handle('test-click', (_event, x, y) => {
      win.webContents.sendInputEvent({ type:'mouseMove', x, y });
      win.webContents.sendInputEvent({ type:'mouseDown', x, y, button:'left', clickCount:1 });
      win.webContents.sendInputEvent({ type:'mouseUp', x, y, button:'left', clickCount:1 });
    });
    ipcMain.handle('test-drag', async (_event, x, y) => {
      win.webContents.sendInputEvent({ type:'mouseMove', x, y });
      win.webContents.sendInputEvent({ type:'mouseDown', x, y, button:'left', clickCount:1 });
      await new Promise(r => setTimeout(r, 30));
      win.webContents.sendInputEvent({ type:'mouseMove', x:x+35, y:y+20, button:'left' });
      await new Promise(r => setTimeout(r, 30));
      win.webContents.sendInputEvent({ type:'mouseUp', x:x+35, y:y+20, button:'left', clickCount:1 });
    });
    const errors = [];
    win.webContents.on('console-message', details => { if (details.level === 'error') { errors.push(details.message); console.error(details.message); } });
    await win.loadFile(process.env.KANEVAS_TEST_APP_PATH || path.join(__dirname, '../app/index.html'));
    const results = await win.webContents.executeJavaScript('(' + scenario.toString() + ')()');
    if (errors.length) throw new Error(errors.join('\n'));
    for (const result of results) console.log('OK ' + result);
    if (process.env.KANEVAS_TEST_SCREENSHOT) {
      win.setSize(1430, 1000);
      await win.webContents.executeJavaScript('KS.cmd.openEditorDraw()');
      await new Promise(r => setTimeout(r, 500));
      await win.webContents.executeJavaScript('KS.view.resize(); KS.view.render(); document.querySelector("#toasts").replaceChildren()');
      fs.writeFileSync(process.env.KANEVAS_TEST_SCREENSHOT.replace('.png', '-edition.png'), (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript('KS.cmd.openStudioTab("txt2img")');
    }
    for (const width of [1440, 1000]) {
      win.setSize(width, 1000);
      await new Promise(r => setTimeout(r, 500));
      const overflow = await win.webContents.executeJavaScript('document.querySelector(".fx-body").scrollWidth > document.querySelector(".fx-body").clientWidth + 1');
      if (overflow) throw new Error('Débordement horizontal à ' + width + ' px');
      console.log('OK Mise en page à ' + width + ' px');
      if (process.env.KANEVAS_TEST_SCREENSHOT) fs.writeFileSync(process.env.KANEVAS_TEST_SCREENSHOT.replace('.png', '-' + width + '.png'), (await win.webContents.capturePage()).toPNG());
      if (process.env.KANEVAS_TEST_SCREENSHOT && width === 1440) {
        await win.webContents.executeJavaScript('document.querySelector(".fx-view .iv-scale").click()');
        await new Promise(r => setTimeout(r, 200));
        fs.writeFileSync(process.env.KANEVAS_TEST_SCREENSHOT.replace('.png', '-fullscreen.png'), (await win.webContents.capturePage()).toPNG());
        await win.webContents.executeJavaScript('document.querySelector(".iv-lightbox").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))');
      }

    }
    app.exit(0);
  } catch (err) { console.error(err); app.exit(1); }
});

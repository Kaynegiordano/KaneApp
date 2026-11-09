// Contrats réels de la suite dans Electron ; serveurs locaux et métadonnées ffprobe simulés.
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = process.env.KANEVAS_TEST_ROOT || path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanevas-suite-'));
app.setPath('userData', path.join(tmp, 'profile'));
const kc = require(path.join(root, 'kaneclip-host.cjs')); kc.registerScheme();
let win, store, servers = [], errors = [], updates = 0, gpuReleases = 0, animationState = 'libre', animationPosts = 0;
const projects = path.join(tmp, 'output', 'animation'); fs.mkdirSync(projects, {recursive:true});
fs.mkdirSync(path.join(tmp, 'wallpaper-engine-animator'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'wallpaper-engine-animator', 'config.json'), JSON.stringify({ projets: projects }));
const legacyProject=path.join(tmp,'wallpaper-engine-animator','Ancien projet');
fs.mkdirSync(path.join(legacyProject,'peinture'),{recursive:true});
fs.writeFileSync(path.join(legacyProject,'scene.png'),nativeImage.createFromBitmap(Buffer.alloc(128*64*4,255),{width:128,height:64}).toPNG());
fs.writeFileSync(path.join(legacyProject,'peinture','peinture.json'),'{"zones":[],"reglages":{"force":0.6}}');
async function listen(port, handler) {
  const server = http.createServer(handler); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); servers.push(server);
}
const json = (r, data) => { r.setHeader('Content-Type', 'application/json'); r.end(JSON.stringify(data)); };
async function backend() {
  const p = await store.call('create', { name: 'Persistance' });
  const src = path.join(tmp, 'external.png'); fs.writeFileSync(src, Buffer.from([1, 2, 3]));
  const first = await store.call('import', { project: p.id, path: src });
  const dupe = await store.call('import', { project: p.id, path: src }); assert(dupe.duplicate);
  fs.unlinkSync(src); assert.equal(fs.readFileSync(first.item.path).length, 3);
  const versions = await Promise.all(Array.from({ length: 6 }, (_, i) => store.call('capture', { project: p.id, data: new Uint8Array([i]), name: 'Version.png', parent: first.item.id })));
  assert.equal(versions[5].project.items.length, 7); assert.equal(versions[5].item.revision, 2);
  const reopened = require(path.join(root, 'suite-store.cjs'))(path.join(app.getPath('userData'), 'projects'));
  assert.equal((await reopened.call('get', { project: p.id })).items.length, 7);
  await assert.rejects(store.call('get', { project: '../outside' }));
  await assert.rejects(store.call('capture', { project: p.id, name: 'Bad', data: new Uint8Array([0]), parent: 'missing' }));
  await store.call('animation', { project: p.id, value: { dossier: 'Animation de test' } });
  assert.equal((await reopened.call('get', { project: p.id })).animation.dossier, 'Animation de test');
  await store.call('rename', { project: p.id, name: 'Mon atelier' });
  console.log('OK Copies durables, dédoublonnage, versions, écritures concurrentes, reprise et validation des chemins');
}
async function scenario() {
  const results = [], check = (ok, text) => { if (!ok) throw new Error(text); results.push(text); };
  const wait = async fn => { const end = Date.now() + 15000; while (!fn() && Date.now() < end) await new Promise(r => setTimeout(r, 50)); if (!fn()) throw new Error('Timeout renderer'); };
  const click = label => { const b = [...document.querySelectorAll('.modal button')].find(b => b.textContent === label); if (!b) throw new Error('Bouton modal absent : ' + label); b.click(); };
  await KS.suite.ready; await KS.suite.home();
  await KS.dialogs.runtimeMigration();
  check(document.querySelector('.modal').textContent.includes('opération distincte') && ![...document.querySelectorAll('.modal button')].some(b=>/Supprimer/.test(b.textContent)), 'La migration expose ses étapes et réserve le retrait des sources à une opération distincte');
  check([...document.querySelectorAll('.modal button')].find(b=>b.textContent==='Activer les copies vérifiées').disabled, 'La bascule reste indisponible sans copie vérifiée et testée');
  click('Fermer');

  const S = KS.suite, WX = KS.ws;
  check(S.project.name === 'KaneApp', 'Le projet par défaut Mon atelier devient KaneApp');
  const creating = S.newProject(); await wait(() => !!document.querySelector('.modal input'));
  document.querySelector('.modal input').value = 'Illustration de test'; click('Enregistrer'); await creating;
  check(document.body.classList.contains('suite-home') && !!document.querySelector('#kane-nav .ws-switch'), 'Accueil Projet et navigation commune (panneau K)');
  await KS.gpuMemory.refresh();
  const gpuVisible = () => { const r = document.querySelector('#gpu-status').getBoundingClientRect(); return r.height >= 20 && r.bottom <= innerHeight && r.width <= innerWidth; };
  check(gpuVisible() && document.querySelector('#gpu-status').dataset.state === 'ready', 'VRAM du pilote visible dès le Projet');
  const navLabels = [...document.querySelectorAll('#kane-nav .ws-btn')].map(b => b.textContent).join('|');
  check(navLabels === 'Projet|Retouche|Studio IA|Animation|Animation Vidéo|Montage', 'Navigation demandée, Montage en dernier : ' + navLabels);
  document.querySelector('.ws-btn[data-v="video"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 80 }));
  check([...document.querySelectorAll('.menu .mi .lb')].some(b => b.textContent === 'Arrêter'), 'Le clic droit sur une app propose Arrêter');
  KS.ui.closeMenus();
  const d = new KS.Doc({ name: 'Illustration', width: 128, height: 64 });
  const base = KS.util.canvas(128, 64); base.getContext('2d').fillStyle = '#3878b8'; base.getContext('2d').fillRect(0, 0, 128, 64);
  d.addLayer(new KS.Layer({ name: 'Base', canvas: base }), 0);
  const top = KS.util.canvas(128, 64); top.getContext('2d').fillStyle = '#dda238'; top.getContext('2d').fillRect(20, 15, 40, 25);
  d.addLayer(new KS.Layer({ name: 'Détail', canvas: top }), 1); KS.addDoc(d); await KS.cmd.toggleStudio(false);
  check(gpuVisible(), 'VRAM visible dans Edition');
  const first = await S.capture(); check(!!first.snapshotPath, 'Capture avec document natif et aperçu séparés');
  const duplicate = await S.capture(); check(first.id === duplicate.id, 'Capturer sans modification réutilise la version existante');
  d.layers[1].ctx.fillStyle = '#ee2345'; d.layers[1].ctx.fillRect(30, 10, 20, 20); d.layers[1].touch(); d.history.push({ name: 'Retouche', undo() {}, redo() {} });
  const second = await S.capture(); check(second.parent === first.id && second.revision === 2, 'Une modification crée une version liée sans écraser la précédente');
  await S.open(first); const restored = KS.state.doc;
  check(restored.layers.length === 2 && restored.layers[1].name === 'Détail', 'Reprendre une version retrouve les deux calques éditables');
  check(restored.path === null, 'Les instantanés archivés sont ouverts comme copies de travail');
  restored.selection.combine(x => x.fillRect(10, 10, 24, 24)); const selection = await S.capture('selection');
  check(!selection.snapshotPath && selection.id !== first.id, 'La sélection seule est un média distinct');
  await S.home(); S.selected = second.id; await S.refresh();
  check(document.querySelector('.suite-detail h3').textContent === second.name, 'La sélection de bibliothèque affiche ses actions');
  const cards = () => document.querySelectorAll('#suite-home .suite-media').length;
  KS.prefs.libraryCount = 2; KS.emit('prefs');
  check(S.project.items.length > 2 && cards() === 2 && !!document.querySelector('#suite-home .suite-more'), 'La bibliothèque montre le nombre de médias choisi (' + cards() + ' sur ' + S.project.items.length + '), avec « Afficher plus »');
  [...document.querySelectorAll('#suite-home .suite-more button')].find(b => b.textContent === 'Tout afficher').click();
  check(cards() === S.project.items.length && !document.querySelector('#suite-home .suite-more'), 'Tout afficher montre tous les médias du projet');
  KS.prefs.libraryCount = 48; KS.emit('prefs');
  check(cards() === S.project.items.length && document.querySelector('#suite-home .suite-count').value === '48', 'Le nombre se règle aussi dans la bibliothèque');
  await S.animate(second); check(S.project.animation?.item === second.id && WX.el.wallpaper.ready, 'Création et liaison d’une animation par le véritable pont preload');
  check(gpuVisible(), 'VRAM visible dans Animation avec son cadre intégré');
  const dossier = S.project.animation.dossier;
  await S.resumeAnimation(); check(S.project.animation.dossier === dossier, 'Reprendre l’animation conserve son projet et ses zones');
  const canceled = S.animate(first); await wait(() => KS.modalOpen()); click('Annuler'); await canceled;
  check(S.project.animation.item === second.id, 'Annuler un transfert ne change pas la source liée');
  const small = KS.util.canvas(32, 32), wrongSize = await KS.native.weaUpdate(dossier, new Uint8Array(await (await KS.util.blobFromCanvas(small)).arrayBuffer()));
  check(!wrongSize.ok && wrongSize.error.includes('Dimensions'), 'Une source de dimensions différentes ne remplace pas la scène peinte');
  const updating = S.animate(first); await wait(() => KS.modalOpen()); click('Mettre à jour la source'); await updating;
  check(S.project.animation.dossier === dossier && S.project.animation.item === first.id, 'Mise à jour de la source sans créer une autre animation');
  await S.toVideo(second); const video = await WX.request('video', 'state');
  check(video.media.length === 1 && video.events >= 1, 'Ajout sur la vraie timeline KaneClip depuis la bibliothèque');
  const timelineBefore = JSON.parse((await KS.native.suiteCall('videoRead', { project: S.project.id })).value.data).events;
  const replace = S.replaceVideo(first); await wait(() => !!document.querySelector('.modal select')); click('Remplacer'); await replace;
  const after = await WX.request('video', 'state'); check(after.media[0].path === first.path && after.events === video.events, 'Remplacement du média en conservant les événements du montage');
  await WX.request('video', 'save');
  const saved = await KS.native.suiteCall('videoRead', { project: S.project.id });
  check(JSON.parse(saved.value.data).events.length === after.events, 'Montage sauvegardé dans le dossier du projet commun');
  check(JSON.stringify(JSON.parse(saved.value.data).events) === JSON.stringify(timelineBefore), 'Les coupes, placements et effets des événements sont inchangés après remplacement');
  const originalProject = S.project.id;
  const other = S.newProject(); await wait(() => !!document.querySelector('.modal input'));
  document.querySelector('.modal input').value = 'Autre projet'; click('Enregistrer'); await other;
  check((await WX.request('video', 'state')).events === 0, 'Changer de projet ouvre un montage indépendant');
  await S.openProject(originalProject);
  check((await WX.request('video', 'state')).events === after.events, 'Revenir au projet restaure son montage et ses médias');
  await WX.stop('video'); check(!WX.el.video.frame, 'Arrêter Montage sauvegarde puis décharge son interface');
  await S.openVideo(); check((await WX.request('video', 'state')).events === after.events, 'Rouvrir Montage après arrêt retrouve sa timeline');
  check(gpuVisible(), 'VRAM visible dans Montage');
  await S.toComfy(first); check(WX.el.comfyui.ready, 'Image injectée dans le nœud LoadImage par le véritable pont ComfyUI');
  const wf = { nodes: [{ id: 7, type: 'LoadImage' }, { id: 9, type: 'LoadImage' }] };
  await WX.request('comfyui', 'workflow', { workflow: wf });
  const multiple = S.toComfy(second); await wait(() => !!document.querySelector('.modal select')); click('Utiliser cette entrée'); await multiple;
  const state = await WX.request('comfyui', 'image', { name: 'test.png' }); check(state.nodes?.length === 2, 'Plusieurs entrées de workflow : choix explicite du nœud');
  check(gpuVisible(), 'VRAM visible dans Animation Vidéo');
  const rejected = await WX.request('comfyui', 'workflow', { workflow: {} }).then(() => false, () => true); check(rejected, 'Un workflow au mauvais format produit une erreur lisible');
  const beforeCount = S.project.items.length;
  await S.collect([{ canvas: top, info: 'prompt\nSeed: 123', kind: 'txt2img' }]);
  check(S.project.items.length === beforeCount + 1 && S.project.items[0].info.includes('Seed: 123'), 'Les générations rejoignent la bibliothèque avec leurs paramètres');
  const projectId = S.project.id;
  await S.refresh(); check(S.project.id === projectId && S.project.animation.dossier === dossier, 'Relecture du projet : médias et animation conservés');
  await KS.cmd.sendToStudio('img2img'); await wait(() => !!document.querySelector('.fx-source .iv-viewport'));
  check(document.querySelector('.ws-btn[data-v="studio"]').classList.contains('on') && KS.appearance.active === 'studio', 'Le Studio intégré reprend sa couleur et le zoom avec la navigation commune');
  await WX.stop('studio');
  check(!KS.studio.on && !KS.engine.ready(), 'Arrêter Studio interrompt son espace et arrête le moteur par le pont natif');
  for (const theme of ['light', 'dark', 'graphite']) { KS.prefs.theme = theme; KS.prefs.accent = '#a65cf0'; KS.applyPrefs(); for (const id in WX.el) { WX.theme(id); } }
  KS.dialogs.prefs();
  document.querySelector('.modal .pf-side .side-item[data-id="look"]').click();   // couleurs des espaces : onglet Apparence
  const color = document.querySelector('[data-space-color="wallpaper"]'); color.value = '#6d9c88'; color.dispatchEvent(new Event('input', { bubbles: true }));
  click('Fermer'); WX.go('wallpaper');
  check(KS.prefs.spaceColors.wallpaper === '#6d9c88' && getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#6d9c88', 'La couleur personnalisée d’Animation est appliquée et mémorisée');
  check(getComputedStyle(document.querySelector('.suite-step')).boxShadow === 'none', 'Le style commun utilise des surfaces plates sans ombre');
  await new Promise(r => setTimeout(r, 300));
  const frame = WX.el.comfyui.frame;
  check(frame.contentDocument === null, 'Les cadres spécialisés restent isolés du document principal');
  await S.home(); check(!document.body.classList.contains('ws-ext') && !KS.studio.on, 'Retour Projet cohérent après les trois ateliers');
  const modal = KS.modal({ title: 'Annulation', body: KS.h('p', { text: 'test' }), buttons: [{ label: 'Annuler', value: false }] }); modal.close(null);
  check(await modal.done === null, 'Fermer une boîte de dialogue résout également son résultat');
  WX.go('wallpaper');
  const oldAnimationItem = S.project.animation.item, oldDocumentCount = KS.state.docs.length;
  [...WX.el.wallpaper.bar.querySelectorAll('button')].find(b=>b.textContent==='Ouvrir une image…').click();
  await wait(() => KS.modalOpen()); click('Nouvelle animation');
  await wait(() => S.project.animation.item !== oldAnimationItem && !S.tasks.some(t => t.phase === 'running'));
  check(KS.state.docs.length === oldDocumentCount && (await WX.request('wallpaper','state')).width === 128, 'Ouvrir une image depuis Animation charge la source sans ouvrir de document Edition');
  return { results, projectId, first: first.path, second: second.path, dossier };
}
app.whenReady().then(async () => {
  try {
    await listen(8780, async (req, res) => {
      if (req.url === '/api/projets') return json(res, fs.readdirSync(projects).map(dossier => ({ dossier, titre: dossier, anime: false })));
      if (req.url === '/api/forge') return json(res, { pret: false, lanceur: false });
      if (req.url.endsWith('/etat')) return json(res, { etat: animationState, lignes: [], etapes: [] });
      if (/\/(animer|super|video|sam)$/.test(req.url) && req.method === 'POST') {
        req.resume(); animationPosts++;
        if (req.url.endsWith('/sam')) return json(res, { masque: 'test' });
        animationState = 'en cours'; setTimeout(() => { animationState = 'fini'; }, 250);
        return json(res, { lance: true });
      }
      if (req.url.includes('/image?') || req.url.endsWith('/vignette')) {
        res.setHeader('Content-Type', 'image/png'); return res.end(fs.readFileSync(path.join(projects, decodeURIComponent(req.url.split('/')[2]), 'scene.png')));
      }
      if (req.url.includes('/enregistre')) { req.resume(); return json(res, { ok: true }); }
      if (req.url.includes('/fichier/')) { res.statusCode = 404; return res.end('Absent'); }
      if (req.url === '/api/nouveau') {
        let text = ''; for await (const b of req) text += b; const body = JSON.parse(text), dossier = 'Animation-test';
        fs.mkdirSync(path.join(projects, dossier), { recursive: true }); fs.writeFileSync(path.join(projects, dossier, 'scene.png'), Buffer.from(body.image.split(',')[1], 'base64'));
        return json(res, { dossier });
      }
      if (process.env.KANEVAS_TEST_WALLPAPER_HTML) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(fs.readFileSync(process.env.KANEVAS_TEST_WALLPAPER_HTML)); }
      res.setHeader('Content-Type', 'text/html'); res.end('<html><head></head><body><header id="haut"><span class="logo"></span><button id="animer">Animer</button><button id="videoBtn">Vidéo</button><button id="oPeindre"></button><button id="oApercu"></button><button id="superBtn"></button><span id="statut">Prêt</span></header><script>let P=null,IW=128,IH=64;async function enregistre(){} async function chargeProjets(){} async function ouvre(p){P=p;document.querySelector("#statut").textContent="Prêt";}</script></body></html>');
    });
    await listen(8188, (req, res) => {
      if (req.url === '/system_stats') return json(res, {});
      if (req.url === '/queue') return json(res, { queue_running: [], queue_pending: [] });
      if (req.url === '/upload/image') { req.resume(); return json(res, { name: 'uploaded.png' }); }
      if (req.url === '/scripts/app.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end('export const app={graph:{_nodes:[{id:1,type:"LoadImage",widgets:[{name:"image",value:"",options:{values:[]}}]}]},loadGraphData(w){this.graph._nodes=w.nodes.map(n=>({...n,widgets:[{name:"image",value:"",options:{values:[]}}]}))}};'); }
      res.setHeader('Content-Type', 'text/html'); res.end('<html><head></head><body>Workflow de test</body></html>');
    });
    kc.setup(() => win); store = require(path.join(root, 'suite-host.cjs'))(() => win);
    const managed = require(path.join(root, 'managed-runtimes.cjs'))(app.getPath('userData'));
    require(path.join(root, 'runtime-migration-host.cjs'))({ getWin:()=>win, managed, directories:()=>({root:tmp,python:process.execPath}), idle:async()=>{}, reset(){} });

    require(path.join(root, 'services.cjs'))({ getWin: () => win, root: () => tmp, engine: { forgeUrl: async () => 'http://127.0.0.1:7862', state: () => 'off', start() {}, release: async () => { gpuReleases++; } } });
    const reply = (ch, fn) => { ipcMain.removeHandler(ch); ipcMain.handle(ch, fn); };
    reply('open-dialog', () => [{ name:'Image choisie.png',data:new Uint8Array(fs.readFileSync(path.join(projects,'Animation-test','scene.png'))) }]);
    reply('kc:ff-available', () => ({ path: 'test-ffmpeg' }));
    reply('kc:probe', (_e, p) => { const size = nativeImage.createFromPath(p).getSize(); return { ok: true, path: p, name: path.basename(p), kind: 'image', size: fs.statSync(p).size, video: { ...size, codec: 'png', fps: 0 } }; });
    reply('kc:proxy-path', () => null);
    for (const ch of ['set-title', 'set-titlebar']) ipcMain.on(ch, () => {});
    let engineState = 'off';
    const engineStatus = () => ({ state: engineState, ours: engineState === 'ready', url: engineState === 'ready' ? 'http://127.0.0.1:7862' : '' });
    reply('get-pending', () => []); reply('list-fonts', () => []); reply('engine-status', engineStatus);
    reply('engine-start', () => { engineState = 'ready'; return engineStatus(); });
    reply('engine-stop', () => { engineState = 'off'; return engineStatus(); });
    reply('forge-status', () => ({ ok: true }));
    reply('gpu-memory', () => ({ ok:true, used:1302, total:16275, measuredAt:Date.now(), devices:[{name:'NVIDIA test',used:1302,total:16275}] }));
    reply('forge-catalog', () => ({ ok: true, models: [{ title: 'Studio-test', name: 'Studio-test' }], current: { model: 'Studio-test', modules: [] }, loras: [], modules: [], samplers: ['Euler'], schedulers: ['Automatic'], scripts: [], styles: [], presets: {}, upscalers: ['Lanczos'] }));
    reply('app-version', () => 'test'); reply('update-state', () => ({ state: 'none' })); reply('update-check', () => ({ state: 'none' }));
    reply('recovery-list', () => ({ ok: true, entries: [] })); reply('recovery-write', () => ({ ok: true })); reply('recovery-remove', () => ({ ok: true }));
    reply('read-file', (_e, p) => ({ path: p, name: path.basename(p), data: new Uint8Array(fs.readFileSync(p)) }));
    await backend();
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { preload: path.join(root, 'preload.js'), nodeIntegration: false, contextIsolation: true, nodeIntegrationInSubFrames: true, backgroundThrottling: false, offscreen: true } });
    win.webContents.on('console-message', d => { if (d.level === 'error') errors.push(d.message); });
    win.webContents.on('preload-error', (_e, p, err) => errors.push(p + ': ' + err.message));
    await win.loadFile(path.join(root, 'app', 'index.html'));
    const result = await win.webContents.executeJavaScript('(' + scenario.toString() + ')()');
    for (const line of result.results) console.log('OK ' + line);
    const animationFrame = win.webContents.mainFrame.frames.find(f => f.url.startsWith('http://127.0.0.1:8780/'));
    assert.equal(await animationFrame.executeJavaScript('document.getElementById("superBtn").textContent'), 'Animation automatique');
    const command = 'fetch("/p/Animation-test/animer", {method:"POST",body:"{}"}).then(r=>r.json())';
    assert((await animationFrame.executeJavaScript(command)).lance);
    assert.equal(gpuReleases, 1); assert(await win.webContents.executeJavaScript('KS.animationBusy'));
    assert.equal(await win.webContents.executeJavaScript('KS.gen.forge(true)'), null);
    const concurrent = await animationFrame.executeJavaScript(command);
    assert(!concurrent.lance && animationPosts === 1 && gpuReleases === 1);

    const end = Date.now() + 5000;
    while (await win.webContents.executeJavaScript('KS.animationBusy') && Date.now() < end) await new Promise(r => setTimeout(r, 50));
    assert.equal(gpuReleases, 2); assert.equal(animationPosts, 1);
    await animationFrame.executeJavaScript('fetch("/p/Animation-test/sam", {method:"POST",body:"{}"}).then(r=>r.json())');
    assert.equal(gpuReleases, 4); assert.equal(animationPosts, 2);
    const invalid = await win.webContents.executeJavaScript('KS.native.animationRun("../outside", "animer", {})');
    assert(!invalid.ok && animationPosts === 2);
    console.log('OK Animation automatique, vrai pont du cadre, décharge Studio avant/après, réservation GPU et segmentation synchrone');
    if (process.env.KANEVAS_TEST_WALLPAPER_HTML) {
      const waitRenderer = async code => { for (let i=0;i<200;i++) { if (await win.webContents.executeJavaScript(code)) return; await new Promise(r=>setTimeout(r,20)); } throw new Error('Import Animation bloqué : '+code); };
      for (const mode of ['selection','depot']) {
        const before = await win.webContents.executeJavaScript('({item:KS.suite.project.animation.item,docs:KS.state.docs.length})');
        await animationFrame.executeJavaScript(`(async()=>{
          window.prompt=()=>{throw new Error('prompt interdit dans Electron')};
          const response=await fetch('/p/Animation-test/image?import');
          const file=new File([await response.blob()],'Image importée.png',{type:'image/png'}), dt=new DataTransfer();dt.items.add(file);
          if (${JSON.stringify(mode)}==='selection') {const input=document.getElementById('fichier');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));}
          else window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));
        })()`);
        await waitRenderer('KS.modalOpen()');
        await win.webContents.executeJavaScript('[...document.querySelectorAll(".modal button")].find(b=>b.textContent==="Nouvelle animation").click()');
        await waitRenderer('KS.suite.project.animation.item !== '+JSON.stringify(before.item)+' && !KS.suite.tasks.some(t=>t.phase==="running")');
        assert.equal(await win.webContents.executeJavaScript('KS.state.docs.length'),before.docs);
        assert(await animationFrame.executeJavaScript('IW===128 && IH===64 && IMG.complete'));
        console.log('OK Import Animation par '+mode+' : image visible, sans prompt() ni document Edition');
      }
      await animationFrame.executeJavaScript('creer(new File(["image invalide"],"invalide.png",{type:"image/png"}))');
      assert(await animationFrame.executeJavaScript('document.getElementById("statut").textContent.startsWith("Ouverture impossible")'));
      console.log('OK Une image illisible affiche une erreur au lieu de rester sur Chargement');
    }
    const palettes = await win.webContents.executeJavaScript('(async()=>{const out={};for(const id of ["wallpaper","video","comfyui"]){const theme=KS.suite.theme(id);await KS.ws.request(id,"theme",theme);out[id]=theme.colors["--accent"];}return out;})()');
    for (const [id, url] of [['wallpaper', '127.0.0.1:8780'], ['video', '/kaneclip/app/'], ['comfyui', '127.0.0.1:8188']]) {
      const frame = win.webContents.mainFrame.frames.find(f => decodeURIComponent(f.url).replace(/\\/g, '/').includes(url));
      assert(frame); assert.equal(await frame.executeJavaScript('getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()'), palettes[id]);
    }
    console.log('OK Les trois interfaces intégrées reçoivent leur propre couleur et le thème commun');
    assert.equal(fs.readFileSync(result.first).length > 0, true);
    assert.equal(fs.readFileSync(result.second).length > 0, true);
    assert.equal(fs.readdirSync(path.join(projects, result.dossier, 'work', 'sources')).length, 1);
    console.log('OK La source Animation précédente est sauvegardée avant remplacement');
    assert.equal(fs.readFileSync(path.join(projects,'Ancien projet','peinture','peinture.json'),'utf8'),fs.readFileSync(path.join(legacyProject,'peinture','peinture.json'),'utf8'));
    assert(fs.existsSync(path.join(legacyProject,'scene.png')));
    console.log('OK Ancien projet copié dans output/animation avec ses zones ; original conservé');
    if (process.env.KANEVAS_TEST_SCREENSHOT) {
      for (const [id, command] of [['animation', 'KS.suite.resumeAnimation()'], ['video', 'KS.suite.openVideo()']]) {
        await win.webContents.executeJavaScript(command); await new Promise(r => setTimeout(r, 300));
        await win.webContents.executeJavaScript('document.querySelector("#toasts").replaceChildren()');
        fs.writeFileSync(process.env.KANEVAS_TEST_SCREENSHOT.replace('.png', '-' + id + '.png'), (await win.webContents.capturePage()).toPNG());
      }
    }
    await win.loadFile(path.join(root, 'app', 'index.html'));
    const restart = await win.webContents.executeJavaScript('(async()=>{await KS.suite.ready;await KS.suite.openVideo();const state=await KS.ws.request("video","state");await KS.suite.home();document.querySelector("#toasts").replaceChildren();return {id:KS.suite.project.id,count:KS.suite.project.items.length,events:state.events,color:KS.prefs.spaceColors.wallpaper};})()');
    assert.equal(restart.id, result.projectId); assert(restart.count >= 4 && restart.events >= 1);
    assert.equal(restart.color, '#6d9c88');
    console.log('OK Après rechargement complet : projet, bibliothèque et montage retrouvés');
    for (const width of [1440, 1024]) {
      win.setSize(width, 1000); await new Promise(r => setTimeout(r, 350));
      assert(await win.webContents.executeJavaScript('document.querySelector("#gpu-status").getBoundingClientRect().bottom <= innerHeight'));
      assert(await win.webContents.executeJavaScript('document.querySelector("#titlebar").scrollWidth <= document.querySelector("#titlebar").clientWidth + 1 && document.querySelector("#suite-home").scrollWidth <= document.querySelector("#suite-home").clientWidth + 1'));
      console.log('OK Mise en page Projet à ' + width + ' px');
      if (process.env.KANEVAS_TEST_SCREENSHOT) fs.writeFileSync(process.env.KANEVAS_TEST_SCREENSHOT.replace('.png', '-' + width + '.png'), (await win.webContents.capturePage()).toPNG());
    }
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('Profil de test : ' + tmp); app.exit(0);
  } catch (e) { console.error(e); console.error(errors.join('\n')); console.log('Profil : ' + tmp); app.exit(1); }
});

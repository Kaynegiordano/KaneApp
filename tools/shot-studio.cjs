// Captures du Studio IA avec le vrai catalogue mis en cache (modèles, LoRA, Kane Detailer), sans moteur.
// Fenêtre transparente (jamais visible) ; les images sont celles de la page, pas du bureau.
// Lancer : node_modules/.bin/electron tools/shot-studio.cjs <dossier de sortie> [largeur] [hauteur]
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const outDir = process.argv[2] || path.join(os.tmpdir(), 'kanevas-shots');
const W = +(process.argv[3] || 1600), H = +(process.argv[4] || 1000);
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanevas-shot-'));
app.setPath('userData', path.join(tmp, 'profile'));
let catalog = null;
for (const dir of ['KaneShop', 'Kanevas']) {
  try { catalog = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, dir, 'forge-catalog-cache.json'), 'utf8')).catalog; break; } catch { /* suivant */ }
}
// SHOT_IMAGES : PNG renvoyés tour à tour par la fausse génération (pour voir la scène et la séance remplies)
const imgs = (process.env.SHOT_IMAGES || '').split(';').filter(Boolean).map(f => fs.readFileSync(f).toString('base64'));
const preload = path.join(tmp, 'preload.cjs');
fs.writeFileSync(preload, `
localStorage.setItem('kanevas.prefs', JSON.stringify({ studio: true, startPage: 'studio', kanevasPalette: true, theme: ${JSON.stringify(process.env.SHOT_THEME || 'dark')}, fx: { v: 1, tab: 'txt2img' } }));
const CAT = ${JSON.stringify(catalog)};
const IMGS = ${JSON.stringify(imgs)};
const png = (() => { const c = document.createElement('canvas'); return c; })();
window.ksNative = {
  setTitle() {}, setTitleBar() {}, setZoom() {}, onCloseRequest() {}, onOpenPath() {}, onEngine() {},
  getPending: async () => [],
  gpuMemory: async () => ({ ok: true, used: 5200, total: 16275, measuredAt: Date.now(), devices: [{ name: 'NVIDIA', used: 5200, total: 16275 }] }),
  engineStatus: async () => ({ state: 'ready', url: 'http://127.0.0.1:7862', ours: true, profile: 'Kane OS', tail: [] }),
  forgeStatus: async () => ({ ok: true }),
  forgeCatalogCache: async () => ({ ok: true, catalog: CAT }),
  forgeCatalog: async () => ({ ok: true, ...CAT }),
  forgeProgress: async () => ({ ok: true, progress: 0 }),
  // SHOT_LORA=<dossier> : un projet Lora factice dont les images (et les aperçus d'époque) sont les PNG/JPG de ce dossier
  loraThumb: async file => { try { return { ok: true, data: new Uint8Array(require('fs').readFileSync(file)) }; } catch { return { ok: false }; } },
  forgeTxt2img: async (url, payload) => { const n = Math.max(1, (+payload.batch_size || 1) * (+payload.n_iter || 1));
    const images = Array.from({ length: n }, () => { const b = IMGS[(window.__n = (window.__n || 0) + 1) % Math.max(1, IMGS.length)]; return b ? Uint8Array.from(atob(b), c => c.charCodeAt(0)) : new Uint8Array(); });
    return { ok: true, images, info: { seed: 1000 + window.__n, infotexts: [payload.prompt + '\\nNegative prompt: ' + payload.negative_prompt + '\\nSteps: ' + payload.steps + ', Sampler: ' + payload.sampler_name + ', Schedule type: ' + payload.scheduler + ', CFG scale: ' + payload.cfg_scale + ', Seed: ' + (1000 + window.__n) + ', Size: ' + payload.width + 'x' + payload.height] } }; },
  forgeImg2img: async (url, payload, init) => ({ ok: true, images: [init], info: { seed: 7, infotexts: [payload.prompt + '\\nSteps: 32, Seed: 7'] } }),
  forgeKaneZones: async () => ({ ok: false }),
  forgeSkip: async () => ({ ok: true }), forgeInterrupt: async () => ({ ok: true }),
  forgeSetOptions: async () => ({ ok: true }),
  openDialog: async () => [],
  loraCall: async (cmd, args = {}) => {
    const dir = ${JSON.stringify(process.env.SHOT_LORA || '')};
    if (!dir) return { ok: true, projects: [], presets: {}, scopes: {}, resolutions: [], optimizers: {}, dits: [], fewshot_resolutions: [] };
    const fs = require('fs'), path = require('path');
    const files = fs.readdirSync(dir).filter(f => /\.(png|jpe?g)$/i.test(f)).map(f => path.join(dir, f));
    const imgs = files.filter(f => !/_e0000|_000000_/.test(f)).slice(0, 12), eps = files.filter(f => /_e0000/.test(f));
    if (cmd === 'info') return { ok: true, presets: { style: { label: 'Style', hint: 'le trait d’un artiste' }, character: { label: 'Personnage', hint: '' } }, scopes: { full: { label: 'Tout le modèle', hint: '', summary: 'tout' } }, scope_default: 'full',
      resolutions: [512, 768, 1024], optimizers: { adamw8bit: 'AdamW8bit' }, dits: [{ path: 'C:/m/anima_baseV10.safetensors', name: 'anima_baseV10.safetensors', kind: 'base', note: '' }], dit: 'C:/m/anima_baseV10.safetensors', fewshot_resolutions: [512, 1024, 1536], sd_scripts: 'C:/sd', tagger: true };
    if (cmd === 'list') return { ok: true, projects: [{ name: 'project', trigger: 'n1x3u', count: imgs.length }, { name: 'decor', trigger: 'v1lle', count: 31 }] };
    if (cmd === 'load') {
      const caps = Object.fromEntries(imgs.map((f, i) => [path.basename(f), ['safe', '1girl', 'solo', i % 3 ? 'frieren' : 'makima (chainsaw man)', 'long hair', i % 2 ? 'smile' : 'looking at viewer', 'upper body', i % 4 ? 'white hair' : 'red hair', i === 2 ? 'patreon username' : 'simple background'].join(', ')]));
      const ep = n => eps.filter(f => f.includes('_e0000' + String(n).padStart(2, '0')));
      return { ok: true, manifest: { trigger: 'n1x3u', lora_type: 'style', epochs: 11, repeats: 4, dim: 20, learning_rate: 4.7e-5, captions: caps, recipe: 2, sample_every: 250 },
        images: imgs.map(f => ({ file: path.basename(f), path: f, preview: f })),
        runs: [{ run: 'C:/runs/r', project: 'project', running: false, state: 'done', pct: 100, text: 'Entraînement terminé.', output: 'C:/out/n1x3u.safetensors', token: '@n1x3u', checkpoints: [], samples: [], before: [],
          epochs: [4, 6, 8, 10].map(n => ({ epoch: n, path: 'C:/out/n1x3u-' + n + '.safetensors', name: n === 10 ? 'n1x3u' : 'n1x3u-0000' + String(n).padStart(2, '0'), final: n === 10, samples: ep(n) })) }] };
    }
    return { ok: true, status: null };
  },
};
`);

const logFile = path.join(outDir, 'journal.txt');
fs.writeFileSync(logFile, '');
const log = m => { fs.appendFileSync(logFile, m + '\n'); console.log(m); };
setTimeout(() => { log('ABANDON : plus de 150 s'); app.exit(2); }, 150000);
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ width: W, height: H, show: false, skipTaskbar: true, enableLargerThanScreen: true, useContentSize: true,
      webPreferences: { preload, contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
    // une fenêtre hors écran n'a jamais le focus système : sans émulation, :focus ne s'applique pas
    const errors = [];
    win.webContents.on('console-message', d => { if (d.level === 'error') errors.push(d.message); });
    const t0 = Date.now();
    await win.loadFile(process.env.KANEVAS_TEST_APP_PATH || path.join(__dirname, '../app/index.html'));
    try { win.webContents.debugger.attach('1.3'); await Promise.race([win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }), new Promise(r => setTimeout(r, 3000))]); } catch { /* sans émulation */ }
    const js = (s, ms = 25000) => Promise.race([win.webContents.executeJavaScript(s), new Promise((_, no) => setTimeout(() => no(new Error('délai dépassé')), ms))]);
    const shot = async name => { await new Promise(r => setTimeout(r, 350)); fs.writeFileSync(path.join(outDir, name + '.png'), (await win.webContents.capturePage()).toPNG()); log('capture ' + name); };
    await js('new Promise(r => { const t = () => document.querySelector("#studio .fx-body, #studio .st-body") ? r() : setTimeout(t, 50); t(); })');
    log('studio affiché en ' + (Date.now() - t0) + ' ms');
    await js('KS.cmd.openStudioTab("txt2img")');
    await shot('01-creer');
    log('thème ' + await js('KS.prefs.theme + " " + document.body.className'));
    // SHOT_STEPS : fichier JSON [[nom, code], ...]
    const steps = process.env.SHOT_STEPS ? JSON.parse(fs.readFileSync(process.env.SHOT_STEPS, 'utf8')) : [];
    for (const [name, code] of steps) { try { await js(code); } catch (e) { log('étape ' + name + ' : ' + e.message + ' · modale : ' + await js('document.querySelector(".modal")?.innerText.slice(0, 300) || "aucune"').catch(() => '?')); } await shot(name); }
    // vitesse : Retouche -> Studio, Créer <-> Transformer, ouvrir / fermer un volet (moyennes)
    const perf = await js(`(async () => {
      const raf = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const avg = async (n, fn) => { let t = 0; for (let i = 0; i < n; i++) t += await fn(); return t / n; };
      const open = await avg(6, async () => { await KS.cmd.toggleStudio(false); await raf(); const a = performance.now(); await KS.cmd.toggleStudio(true); await raf(); return performance.now() - a; });
      const tabs = await avg(6, async () => { const a = performance.now(); await KS.cmd.openStudioTab('img2img'); await raf(); await KS.cmd.openStudioTab('txt2img'); await raf(); return (performance.now() - a) / 2; });
      const acc = await avg(6, async () => { const hd = [...document.querySelectorAll('.fx-acc-h')].find(x => /Hires/.test(x.textContent)); if (!hd) return 0; const a = performance.now(); hd.click(); await raf(); return performance.now() - a; });
      return 'ouvrir le Studio ' + open.toFixed(1) + ' ms · changer d onglet ' + tabs.toFixed(1) + ' ms · volet ' + acc.toFixed(1) + ' ms · ' + document.querySelectorAll('#studio *').length + ' éléments';
    })()`, 60000);
    log('vitesse : ' + perf);
    // temps de rendu de l'onglet Créer (moyenne de 10)
    const ms = await js('(async () => { const t = performance.now(); for (let i = 0; i < 10; i++) { KS.genPanel.render(); await new Promise(r => requestAnimationFrame(r)); } return (performance.now() - t) / 10; })()');
    const nodes = await js('document.querySelectorAll("#studio *").length');
    log('rendu Créer : ' + ms.toFixed(1) + ' ms, ' + nodes + ' éléments');
    if (errors.length) log('ERREURS\n' + errors.join('\n'));
    app.exit(0);
  } catch (err) { log('ERREUR ' + (err.stack || err)); app.exit(1); }
});

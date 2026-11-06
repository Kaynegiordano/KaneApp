// Mémoire du Studio IA sur une longue séance : N générations txt2img simulées (PNG 1856 × 1024 tous différents),
// puis mémoire de chaque processus (rendu, GPU) relevée par Electron.
// Lancer : node_modules/.bin/electron tools/bench-studio-memory.cjs [N]
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const N = +(process.argv.find(a => /^\d+$/.test(a)) || 60);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanevas-bench-mem-'));
app.setPath('userData', path.join(tmp, 'profile'));
const preload = path.join(tmp, 'preload.cjs');
fs.writeFileSync(preload, `
localStorage.setItem('kanevas.prefs', JSON.stringify({ fx: { v: 1, livePreview: false } }));
let n = 0;
const png = async () => {
  const c = document.createElement('canvas'); c.width = 1856; c.height = 1024; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 1856, 1024); g.addColorStop(0, 'hsl(' + (n * 37 % 360) + ',60%,40%)'); g.addColorStop(1, '#e8c090'); x.fillStyle = g; x.fillRect(0, 0, 1856, 1024);
  for (let i = 0; i < 300; i++) { x.fillStyle = 'hsla(' + ((i * 13 + n * 7) % 360) + ',70%,55%,.35)'; x.beginPath(); x.arc((i * 997 + n * 131) % 1856, (i * 619 + n * 71) % 1024, 20 + i % 70, 0, 7); x.fill(); }
  n++;
  return new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer());
};
window.ksNative = {
  gpuMemory: async () => ({ ok: false }), setTitle() {}, setTitleBar() {}, setZoom() {}, onCloseRequest() {}, onOpenPath() {}, getPending: async () => [],
  forgeStatus: async () => ({ ok: true }),
  forgeCatalog: async () => ({ ok: true, models: [{ title: 'M', name: 'M' }], loras: [], modules: [], current: { model: 'M', modules: [] }, dtype: 'Automatic',
    samplers: ['Euler'], schedulers: ['Automatic'], scripts: [], styles: [], presets: {}, upscalers: ['Lanczos'] }),
  forgeTxt2img: async (url, payload) => ({ ok: true, images: [await png()], info: { seed: n, infotexts: [payload.prompt + '\\nSteps: 20, Seed: ' + n + ', Size: 1856x1024'] } }),
  forgeProgress: async () => ({ ok: true, progress: 0 }), forgeInterrupt: async () => ({ ok: true }),
};
`);
app.commandLine.appendSwitch('js-flags', '--expose-gc');   // gc() : mesurer ce qui est retenu, pas ce qui attend le ramasse-miettes
const mb = kb => Math.round(kb / 1024);   // workingSetSize / privateBytes sont en Ko
function metrics() {
  const out = {};
  for (const m of app.getAppMetrics()) {
    const k = m.type === 'Tab' ? 'rendu' : m.type === 'GPU' ? 'gpu' : m.type === 'Browser' ? 'principal' : m.type;
    out[k] = (out[k] || 0) + mb(m.memory.privateBytes || m.memory.workingSetSize);
  }
  return out;
}
app.whenReady().then(async () => {
  // fenêtre affichée (une page cachée n'a presque pas de temps libre : toBlob y attend jusqu'à 5 s), mais transparente,
  // hors de la barre des tâches et sans prendre le focus
  const win = new BrowserWindow({ show: false, width: 1440, height: 1000, x: 0, y: 0, opacity: 0, skipTaskbar: true, focusable: false, webPreferences: { preload, contextIsolation: false, sandbox: false, backgroundThrottling: false } });
  win.showInactive();
  // KV_APP : un autre dossier app/ (version précédente, pour comparer)
  await win.loadFile(path.join(process.env.KV_APP || path.join(__dirname, '..', 'app'), 'index.html'));
  const js = s => win.webContents.executeJavaScript(s);
  await js(`(async () => { await KS.suite?.ready; await KS.cmd.toggleStudio(true); KS.prefs.fx.tab = 'txt2img'; KS.prefs.fx.t2i.prompt = 'bench'; })()`);
  await new Promise(r => setTimeout(r, 1500));
  const before = metrics();
  const t = Date.now();
  for (let i = 0; i < N; i++) await js(`KS.cmd.studioGenerate()`);
  const gen = (Date.now() - t) / N;
  await js(`new Promise(r => setTimeout(r, 1500))`);
  win.webContents.session.clearCache();
  await js(`window.gc ? gc() : 0`);
  const after = metrics();
  const heap = await js(`performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null`);
  const gallery = await js(`KS.studio.gallery.length`);
  console.log(JSON.stringify({ images: N, galerie: gallery, msParGeneration: Math.round(gen), avantMo: before, apresMo: after, tasJsMo: heap }));
  app.exit(0);
  setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* fichiers encore ouverts */ } }, 0);
});

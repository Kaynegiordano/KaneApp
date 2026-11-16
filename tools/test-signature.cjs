// Signer des images (app/js/signature.js) : tailles 720p, version de la signature selon le fond, fichiers écrits
// dans « Images signées » sans écraser, JPEG sans métadonnées, entrées de menu. Fenêtre hors écran, dossier temporaire.
// Lancer : node_modules/electron/dist/electron.exe tools/test-signature.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kaneapp-signature-'));
app.setPath('userData', path.join(tmp, 'profile'));
const images = path.join(tmp, 'photos');
fs.mkdirSync(images);
const preload = path.join(tmp, 'preload.cjs');
fs.writeFileSync(preload, `
const fs = require('node:fs'), path = require('node:path');
localStorage.setItem('kanevas.prefs', JSON.stringify({ kanevasPalette: true, startPage: 'edit' }));
window.__ouverts = [];
window.ksNative = { setTitle() {}, setTitleBar() {}, setZoom() {}, onCloseRequest() {}, onOpenPath() {}, onEngine() {}, getPending: async () => [],
  engineStatus: async () => ({ state: 'off', tail: [] }), forgeStatus: async () => ({ ok: false }), gpuMemory: async () => ({ ok: false }),
  makeDir: async p => { fs.mkdirSync(p, { recursive: true }); return { ok: true }; },
  exists: async p => fs.existsSync(p),
  writeFile: async (p, d) => { fs.writeFileSync(p, Buffer.from(d)); return { ok: true }; },
  readFile: async p => ({ path: p, name: path.basename(p), data: new Uint8Array(fs.readFileSync(p)) }),
  showInFolder: p => window.__ouverts.push(p),
};
`);
setTimeout(() => { console.log('ABANDON : plus de 120 s'); app.exit(2); }, 120000);
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'OK ' : 'ÉCHEC ') + msg); if (!ok) fails++; };

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: { preload, contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
  const errors = [];
  win.webContents.on('console-message', d => { if (d.level === 'error') errors.push(d.message); });
  await win.loadFile(path.join(__dirname, '../app/index.html'));
  const js = s => win.webContents.executeJavaScript(s);
  try {
    await js(`new Promise(r => { const t = () => KS.signature && KS.prefs && KS.io ? r() : setTimeout(t, 50); t(); })`);

    // 1. Tailles : 720p au plus, jamais d'agrandissement
    const tailles = await js(`[[2000, 1500], [1500, 2000], [4000, 1000], [1000, 1000], [500, 400]].map(([w, h]) => KS.signature.taille720(w, h).join('x'))`);
    check(JSON.stringify(tailles) === JSON.stringify(['960x720', '720x960', '1280x320', '720x720', '500x400']), 'tailles 720p : ' + tailles.join(', '));

    // 2. Monogramme dessiné avec les polices de Windows
    const mono = await js(`(() => { const m = KS.signature.monogrammes(); return { w: m.noir.width, h: m.noir.height, ombre: m.ombre.width - m.noir.width }; })()`);
    check(mono.w > 200 && mono.h > 100 && mono.ombre === 20, `monogramme ${mono.w}×${mono.h}`);

    // 3. Version de la signature selon le fond du coin
    const versions = await js(`['#ffffff', '#000000', '#808080'].map(f => { const c = KS.util.canvas(960, 720), x = c.getContext('2d'); x.fillStyle = f; x.fillRect(0, 0, 960, 720); return KS.signature.poserSignature(c); })`);
    check(versions.join() === 'noir,blanc,ombre', 'signature noire, blanche, ombrée : ' + versions.join(', '));

    // 4. Chaque protection change l'image ; la signature est bien en bas à droite
    const rendu = await js(`(() => {
      const src = KS.util.canvas(2000, 1500), x = src.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 2000, 1500);
      const px = (c, X, Y) => Array.from(c.getContext('2d').getImageData(X, Y, 1, 1).data.slice(0, 3));
      const blancs = (c, x0, y0, w, h) => { const d = c.getContext('2d').getImageData(x0, y0, w, h).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 250 && d[i+1] > 250 && d[i+2] > 250) n++; return n / (d.length / 4); };
      const r = {};
      for (const p of ['motif', 'centre', 'aucune']) { const c = KS.signature.signer(src, p); r[p] = { w: c.width, h: c.height, centre: blancs(c, 380, 260, 200, 200), coin: blancs(c, 960 - 150, 720 - 70, 140, 60), haut: blancs(c, 0, 0, 300, 200), motif: blancs(c, 0, 0, 960, 720) }; }
      return r;
    })()`);
    check(rendu.motif.w === 960 && rendu.motif.h === 720, 'copie 960×720');
    check(rendu.aucune.coin < 0.95 && rendu.aucune.haut === 1 && rendu.aucune.centre === 1, 'signature seule : coin signé, reste intact');
    check(rendu.centre.centre < 0.99 && rendu.centre.haut === 1, 'grand KG au centre');
    check(rendu.motif.motif < rendu.aucune.motif - 0.002, "filigrane sur toute l'image");

    // 5. Signer des fichiers : dossier « Images signées », noms libres, JPEG sans métadonnées
    await js(`(async () => {
      const c = KS.util.canvas(1600, 1200), x = c.getContext('2d'); x.fillStyle = '#2a6'; x.fillRect(0, 0, 1600, 1200);
      const png = new Uint8Array(await (await KS.util.blobFromCanvas(c, 'image/png')).arrayBuffer());
      window.__png = png;
    })()`);
    const png = Buffer.from(await js(`Array.from(window.__png)`));
    fs.writeFileSync(path.join(images, 'vacances.png'), png);
    fs.writeFileSync(path.join(images, 'pas une image.jpg'), 'texte');
    const signerTout = () => js(`(async () => {
      const entrees = await Promise.all(${JSON.stringify([path.join(images, 'vacances.png'), path.join(images, 'pas une image.jpg')])}.map(p => ksNative.readFile(p)));
      const fin = KS.signature.signerFichiers(entrees);
      await new Promise(r => setTimeout(r, 400));
      const b = [...document.querySelectorAll('.modal-foot button')].find(x => x.textContent.trim() === 'Signer');
      if (!b) return { pasDeBouton: true };
      b.click();
      const r = await fin;
      return { faites: r.faites, erreurs: r.erreurs };
    })()`);
    const r1 = await signerTout();
    const r2 = await signerTout();
    const sortie = path.join(images, 'Images signées');
    const noms = fs.existsSync(sortie) ? fs.readdirSync(sortie).sort() : [];
    check(!r1.pasDeBouton && r1.faites.length === 1, '1 image signée sur 2 (l\'autre est illisible)');
    check(r1.erreurs.length === 1 && /pas une image/.test(r1.erreurs[0]), 'l\'image illisible est signalée sans arrêter les autres');
    check(JSON.stringify(noms) === JSON.stringify(['vacances_KG-2.jpg', 'vacances_KG.jpg']), 'jamais d\'écrasement : ' + noms.join(', '));
    const jpg = fs.readFileSync(path.join(sortie, 'vacances_KG.jpg'));
    check(jpg[0] === 0xff && jpg[1] === 0xd8 && !jpg.includes(Buffer.from('Exif')), 'JPEG sans métadonnées');
    const dims = await js(`KS.util.canvasFromBlob(new Blob([new Uint8Array(${JSON.stringify(Array.from(jpg))})], { type: 'image/jpeg' })).then(c => c.width + 'x' + c.height)`);
    check(dims === '960x720', 'fichier signé en 960×720 : ' + dims);
    check(fs.existsSync(path.join(images, 'vacances.png')) && fs.readFileSync(path.join(images, 'vacances.png')).equals(png), 'original intact');
    check((await js(`KS.prefs.signatureProtection`)) === 'motif', 'protection retenue');

    // 6. Entrées de menu
    const menus = await js(`JSON.stringify(KS.menus ? KS.menus : null) && document.documentElement.innerHTML.length > 0 && (() => {
      const src = KS.signature && document.querySelector('script[src="js/signature.js"]');
      return !!src;
    })()`);
    check(menus, 'signature.js chargé par index.html');
    const menuSrc = fs.readFileSync(path.join(__dirname, '../app/js/ui/menus.js'), 'utf8');
    check(menuSrc.includes('KS.signature.signerFichiers()') && menuSrc.includes('KS.signature.signerDocument()'), 'Fichier › Signer des images… et Exporter › Signée pour les réseaux');
    check(!errors.length, 'aucune erreur dans la console' + (errors.length ? ' : ' + errors.join(' | ') : ''));
  } catch (e) {
    console.log('ÉCHEC exception : ' + (e.stack || e)); fails++;
  }
  win.destroy();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* profil encore verrouillé : dossier temporaire */ }
  console.log(fails ? `${fails} échec(s)` : 'Tout est bon.');
  app.exit(fails ? 1 : 0);
});

// Animation 4.0 : découpe en calques dans Retouche. Vraie fenêtre KaneApp, vrai détourage BiRefNet, vrai moteur Animation.
// Lancer (port 8780 libre) : set KANEVAS_TEST_IMAGE=<illustration avec un personnage> && npx electron tools/test-animation-decoupe.cjs
// KANEVAS_TEST_SCREENSHOT=<png> : capture de la fenêtre (hors écran) avec le panneau des calques.
const { app } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const occupied = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).map(l => l.trim().split(/\s+/)).some(c => c[0] === 'TCP' && c[1]?.endsWith(':8780') && c[3] === 'LISTENING');
assert(!occupied, 'Fermez Animation avant ce test isolé : le port 8780 est utilisé.');
const image = process.env.KANEVAS_TEST_IMAGE;
assert(image && fs.existsSync(image), 'KANEVAS_TEST_IMAGE : une illustration avec un personnage');
const root = process.env.KANEVAS_TEST_ROOT || path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kaneapp-decoupe-'));
const profile = path.join(tmp, 'profile'); process.env.KANEVAS_PROFILE = profile;
const managed = require(path.join(root, 'managed-runtimes.cjs'))(profile);
let owned;
try { owned = managed.activate('C:\\KaneOS\\KaneAppData\\migration.json'); }
catch (error) {
  // ComfyUI se met à jour seul : l'activation stricte refuse ses empreintes. Ce test n'utilise qu'Animation : profil d'essai
  // construit comme activate(), sans le contrôle des empreintes.
  const report = JSON.parse(fs.readFileSync('C:\\KaneOS\\KaneAppData\\migration.json', 'utf8'));
  if (!report.components?.wallpaper?.directory) { console.log('SAUTÉ : ' + error.message); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(0); }
  fs.mkdirSync(profile, { recursive: true });
  owned = { active: true, activatedAt: Date.now(), root: report.destination, report: 'C:\\KaneOS\\KaneAppData\\migration.json', components: report.components,
    models: report.models, profiles: report.profiles, source: report.source, previous: {}, media: report.media, cleanup: report.cleanup, deletionAllowed: false };
  console.log('(activation stricte refusée : ' + error.message + ' ; profil d’essai sans contrôle des empreintes)');
}
owned.source = tmp; fs.writeFileSync(path.join(profile, 'managed-runtimes.json'), JSON.stringify(owned));
// modèles d'IA de KaneApp (BiRefNet) : jonction vers ceux de l'utilisateur, retirée à la fin (jamais de suppression récursive)
const models = path.join(profile, 'models'), userModels = path.join(process.env.APPDATA, 'KaneApp', 'models');
if (fs.existsSync(userModels)) fs.symlinkSync(userModels, models, 'junction');
const output = path.join(tmp, 'output', 'animation'); fs.mkdirSync(output, { recursive: true });
const dir = owned.components.wallpaper.directory;
const child = spawn(path.join(dir, 'venv/Scripts/python.exe'), ['-u', path.join(root.replace(/app\.asar$/, 'app.asar.unpacked'), 'animation-runtime.py'), '--server', path.join(dir, 'outils/peintre.py'), '--port', '8780'],
  { cwd: dir, windowsHide: true, env: { ...process.env, WEA_PROJETS: output, PYTHONIOENCODING: 'utf-8' }, stdio: process.env.KANEVAS_TEST_LOG ? ['ignore', fs.openSync(path.join(tmp, 'serveur.log'), 'w'), fs.openSync(path.join(tmp, 'serveur.log'), 'a')] : 'ignore' });
if (process.env.KANEVAS_TEST_LOG) console.log('journal du serveur : ' + path.join(tmp, 'serveur.log'));
const cleanup = () => {
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* déjà fini */ }
  try { if (fs.lstatSync(models).isSymbolicLink()) fs.rmdirSync(models); } catch { /* sans jonction */ }
};
const py = (code, ...args) => {
  const f = path.join(tmp, 'verif.py'); fs.writeFileSync(f, 'import sys; sys.path.insert(0, ' + JSON.stringify(path.join(dir, 'outils')) + ')' + String.fromCharCode(10) + code);
  return execFileSync(path.join(dir, 'venv/Scripts/python.exe'), ['-I', f, ...args], { cwd: path.join(dir, 'outils'), encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONPATH: path.join(dir, 'outils'), PYTHONIOENCODING: 'utf-8' } });
};
let handled = false;
app.on('browser-window-created', (_e, win) => {
  if (handled) return; handled = true; win.setOpacity(0); win.setSkipTaskbar(true);
  if (process.env.KANEVAS_TEST_LOG) win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 'warning') console.log('[page]', e.message.slice(0, 300)); });
  win.webContents.once('did-finish-load', async () => {
    try {
      let ready = false;
      for (let i = 0; i < 150; i++) { try { ready = (await fetch('http://127.0.0.1:8780/api/projets')).ok; if (ready) break; } catch { /* démarrage */ } await new Promise(r => setTimeout(r, 100)); }
      assert(ready, 'Serveur Animation non disponible');
      // 1. Retouche : IA › Découper en calques pour l'animation
      const t0 = Date.now();
      const doc = await win.webContents.executeJavaScript(`(async()=>{
        await KS.suite.ready; await KS.io.openPath(${JSON.stringify(image)});
        const src = KS.state.doc, d = await KS.cmd.cutForAnimation();
        const kids = g => d.layers.filter(L => L.parent === g?.id).map(L => ({ name: L.name, mask: !!L.mask, w: L.canvas?.width, h: L.canvas?.height }));
        const groups = d.layers.filter(L => L.kind === 'group');
        const comp = d.composite(), a = comp.getContext('2d').getImageData(0, 0, comp.width, comp.height).data;
        const o = src.composite().getContext('2d').getImageData(0, 0, comp.width, comp.height).data;
        let e = 0; for (let i = 0; i < a.length; i += 4) e += (Math.abs(a[i] - o[i]) + Math.abs(a[i + 1] - o[i + 1]) + Math.abs(a[i + 2] - o[i + 2])) / 3;
        return { docs: KS.state.docs.length, active: KS.state.doc === d, name: d.name, groups: groups.map(g => ({ name: g.name, blend: g.blend, kids: kids(g) })), ecart: e / (a.length / 4) };
      })()`);
      const personnage = doc.groups.find(g => g.name === 'Personnage'), decor = doc.groups.find(g => g.name === 'Décor');
      assert(doc.active && doc.docs === 2 && personnage && decor, JSON.stringify(doc));
      assert(personnage.kids.some(k => k.name === 'Corps') && personnage.kids.every(k => k.mask), JSON.stringify(personnage));
      assert(personnage.kids.some(k => /^Bras /.test(k.name)), 'au moins un bras : ' + JSON.stringify(personnage.kids.map(k => k.name)));
      assert(decor.kids.length === 1 && decor.kids[0].name === 'Fond' && !decor.kids[0].mask, JSON.stringify(decor));
      assert(doc.ecart < 2.5, 'les calques recomposent l’image (écart ' + doc.ecart.toFixed(2) + '/255)');
      console.log(`OK Retouche : ${personnage.kids.length + 1} calques (${personnage.kids.map(k => k.name).join(', ')}) à masques, écart ${doc.ecart.toFixed(2)}/255, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      if (process.env.KANEVAS_TEST_SCREENSHOT) { await new Promise(r => setTimeout(r, 400)); fs.writeFileSync(process.env.KANEVAS_TEST_SCREENSHOT, (await win.webContents.capturePage()).toPNG()); }
      // 2. Le PSD écrit par Retouche, lu par Animation : masques appliqués, rôles devinés d'après les noms
      const psdFile = path.join(tmp, 'calques.psd');
      fs.writeFileSync(psdFile, Buffer.from(await win.webContents.executeJavaScript('KS.io.writePSD(KS.state.doc)')));
      const lu = JSON.parse(py(`import json, sys, psd, calques_psd
d = psd.lit(open(sys.argv[1], 'rb').read())
print(json.dumps({'calques': [[c.nom, list(c.chemin), c.image.getchannel('A').getextrema()] for c in d.calques], 'roles': calques_psd.devine_roles(d)}))`, psdFile).trim());
      const roles = Object.fromEntries(lu.calques.map((c, i) => [c[0], lu.roles[i]]));
      assert.equal(roles.Fond, 'decor'); assert.equal(roles.Corps, 'corps');
      for (const [n, r] of Object.entries(roles)) if (/^Bras /.test(n)) assert.equal(r, 'bras', n); else if (/^Cheveux/.test(n)) assert.equal(r, 'cheveux', n);
      assert(lu.calques.filter(c => c[0] !== 'Fond').every(c => c[2][0] === 0), 'masques appliqués à l’alpha');
      console.log('OK PSD : lu par Animation avec ses masques, rôles ' + Object.entries(roles).map(([n, r]) => n + '=' + r).join(', '));
      // 3. « Animer l'illustration » : nouveau projet Animation construit sur les calques
      const dossier = await win.webContents.executeJavaScript(`(async()=>{ await KS.cmd.toWallpaper(); return KS.suite.project.animation.dossier; })()`).catch(async error => {
        const f = win.webContents.mainFrame.frames.find(x => x.url.startsWith('http://127.0.0.1:8780/'));
        const etat = f ? await f.executeJavaScript('JSON.stringify({ P: typeof P === "undefined" ? null : P, statut: document.getElementById("statut")?.textContent, ressources: performance.getEntriesByType("resource").slice(-8).map(r => r.name.replace(location.origin, "") + " " + Math.round(r.duration)) })').catch(e => 'cadre : ' + e.message) : 'sans cadre';
        throw new Error(error.message + ' — atelier : ' + etat);
      });
      const manifest = JSON.parse(fs.readFileSync(path.join(output, dossier, 'psd', 'calques.json'), 'utf8'));
      assert(manifest.calques.some(c => c.role === 'bras') && manifest.calques.some(c => c.role === 'corps') && manifest.calques[0].role === 'decor', JSON.stringify(manifest.calques.map(c => c.role)));
      console.log(`OK Animer : projet « ${dossier} » en ${manifest.calques.length} calques (${manifest.calques.map(c => c.role).join(', ')})`);
      // 4. Atelier Animation, « ✂ Découper en calques » : calques.psd du projet écrit, ouvert dans Retouche, rechargé
      const proj = await win.webContents.executeJavaScript(`(async()=>{
        const r = await KS.cmd.cutAnimationProject(${JSON.stringify(dossier)});
        return { ...r, path: KS.state.doc.path, dirty: KS.state.doc.dirty, groups: KS.state.doc.layers.filter(L => L.kind === 'group').length };
      })()`);
      assert(proj.calques >= 3 && proj.path === path.join(output, dossier, 'calques.psd') && !proj.dirty && proj.groups === 2, JSON.stringify(proj));
      assert(fs.existsSync(path.join(output, dossier, 'calques (précédent).psd')), 'ancien document gardé');
      const rech = await (await fetch(`http://127.0.0.1:8780/p/${encodeURIComponent(dossier)}/recharger`, { method: 'POST', body: '{}' })).json();
      assert(rech.ok && rech.calques === proj.calques, JSON.stringify(rech));
      console.log(`OK Atelier : calques.psd du projet remplacé (ancien gardé), ouvert dans Retouche, rechargé (${rech.calques} calques)`);
      // 5. le pont de l'atelier : « ✂ Découper en calques » passe par Retouche dans KaneApp
      await win.webContents.executeJavaScript(`(async()=>{ await KS.ws.ensure('wallpaper'); await KS.ws.request('wallpaper', 'open', { dossier: ${JSON.stringify(dossier)} }); })()`);
      const frame = win.webContents.mainFrame.frames.find(f => f.url.startsWith('http://127.0.0.1:8780/'));
      const bridge = frame ? await frame.executeJavaScript('typeof window.kaneDecoupeRetouche') : 'sans atelier';
      assert.equal(bridge, 'function');
      console.log('OK Pont : le bouton de l’atelier passe par Retouche');
      cleanup(); app.exit(0);
    } catch (error) { console.error(error); cleanup(); app.exit(1); }
  });
});
require(path.join(root, 'main.js'));

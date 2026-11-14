// Atelier Animer dans une vraie fenêtre (WebGL réel) : tous les effets de Wallpaper Engine compilés et rendus, peinture
// d'un masque et d'une direction, masque affiné dans Retouche, ambiance et halo, enregistrement, réouverture, reprise d'un
// projet d'Animer 1.38.0, envoi d'une scène compilée par Wallpaper Engine. Profil, sorties et projets Wallpaper Engine
// temporaires. Sans Wallpaper Engine, le test s'arrête après l'écran d'accueil.
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = process.env.KANEVAS_TEST_ROOT || path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kaneapp-animer-'));
app.setPath('userData', path.join(tmp, 'profile'));
const kc = require(path.join(root, 'kaneclip-host.cjs')); kc.registerScheme();
const WE = require(path.join(root, 'wallpaper-engine.cjs'));
const engine = WE.locate();
const weProjects = path.join(tmp, 'we-projects'); fs.mkdirSync(weProjects);
let win; const errors = [];
const pixels = t => { if (t.rgba) return t.rgba; const b = nativeImage.createFromBuffer(t.encoded).toBitmap(); for (let i = 0; i < b.length; i += 4) { const r = b[i]; b[i] = b[i + 2]; b[i + 2] = r; } return b; };

async function scenario(hasEngine) {
  const results = [], check = (ok, text) => { console.log('ETAPE ' + (ok ? 'ok ' : 'KO ') + text); if (!ok) throw new Error(text); results.push(text); };
  const wait = async (fn, ms = 15000) => { const end = Date.now() + ms; while (!(await fn()) && Date.now() < end) await new Promise(r => setTimeout(r, 50)); if (!(await fn())) throw new Error('Délai dépassé'); };
  await KS.suite.ready; await KS.suite.home();
  const labels = [...document.querySelectorAll('#kane-nav .ws-btn')].map(b => b.textContent).join('|');
  check(labels.includes('Studio IA|Animer|Vidéo IA'), 'Espace Animer dans la navigation : ' + labels);
  KS.ws.go('animer');
  await wait(() => !!document.querySelector('.an-intro'));
  check(!!document.querySelector('.an-intro .an-start'), 'Écran d’accueil d’Animer');
  if (!hasEngine) return { results };
  const W = 640, H = 360, img = KS.util.canvas(W, H), x = img.getContext('2d');
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#203050'); g.addColorStop(1, '#805040'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  for (let i = 0; i < W; i += 12) for (let j = 0; j < H; j += 12) if ((i + j) % 24 === 0) { x.fillStyle = '#c0d0e0'; x.fillRect(i, j, 12, 12); }
  x.fillStyle = '#ffffff'; x.beginPath(); x.arc(520, 80, 30, 0, Math.PI * 2); x.fill();
  await KS.animer.openCanvas(img, 'Essai Animer.png');
  const A = KS.animer, D = A.debug;
  check(A.project?.version === 2 && A.project.layers[0].kind === 'image' && !!A.id, 'Une image devient un projet Animer (couche d’image)');
  check(!!document.querySelector('.an-left .an-row') && /Calque d’image/.test(document.querySelector('.an-right').textContent), 'Panneaux Couches et Propriétés');
  D.playing = false;
  const snap = t => D.engine.snapshot(t, W, H).getContext('2d').getImageData(0, 0, W, H).data;
  const diff = (a, b, x0, y0, x1, y1) => { let s = 0, n = 0; for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * W + xx) * 4; s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n++; } return s / n / 3; };
  const mean = a => { let s = 0; for (let i = 0; i < a.length; i += 4) s += a[i] + a[i + 1] + a[i + 2]; return s / (a.length / 4) / 3; };
  check(diff(snap(0), snap(1.3), 0, 0, W, H) === 0, 'Sans effet, l’image reste fixe');
  // tout le catalogue : chaque effet compile et rend une image
  const fx = (await KS.native.animerCall('status')).value.effects, bad = [];
  for (const f of fx) {
    await D.addEffect(f.key);
    const img2 = snap(1.1), err = D.engine.errors.get(f.key);
    if (err || !(mean(img2) > 1)) bad.push(f.key + (err ? ' : ' + err.split('\n')[0] : ' : image noire'));
    document.querySelector('.an-right .an-head-row .icon-btn:last-child').click();      // supprimer l'effet
    if (A.project.layers[0].effects.length) bad.push(f.key + ' : non supprimé');
  }
  check(!bad.length, 'Les ' + fx.length + ' effets de Wallpaper Engine compilent et rendent dans l’aperçu' + (bad.length ? ' — ' + bad.join(' ; ') : ''));
  // Secousse : direction peinte vers le haut dans la moitié gauche
  const shake = await D.addEffect('shake');
  check(/Secousse/.test(document.querySelector('.an-right').textContent) && !!document.querySelector('.an-right .an-tex'), 'Propriétés de l’effet : options, textures, réglages');
  shake.values.speed = 1.4;
  const kShake = D.maskKey(shake.id, 0, 1);
  Object.assign(D.brush, { size: 140, intensity: 1, hardness: 0.5 });
  D.paint(kShake, [{ x: 160, y: 260 }, { x: 160, y: 220 }, { x: 160, y: 180 }, { x: 160, y: 140 }, { x: 160, y: 100 }]);
  const flow = D.masks.get(kShake), fd = flow.getContext('2d').getImageData(0, 0, flow.width, flow.height).data;
  const at = (px, py) => { const k = flow.width / W, i = (Math.round(py * k) * flow.width + Math.round(px * k)) * 4; return [fd[i], fd[i + 1]]; };
  check(at(160, 180)[1] > 200 && Math.abs(at(160, 180)[0] - 127) < 8 && at(500, 300)[0] === 127, 'Secousse : la direction peinte est écrite dans la carte de direction ' + at(160, 180));
  let a = snap(0.6), b = snap(2.0);
  check(diff(a, b, 110, 120, 210, 240) > 4 && diff(a, b, 400, 150, 630, 350) < 0.5, 'Secousse : seule la zone peinte bouge (' + diff(a, b, 110, 120, 210, 240).toFixed(1) + ')');
  // Oscillation Feuillage : masque peint
  const fol = await D.addEffect('foliagesway'), kFol = D.maskKey(fol.id, 0, 1);
  D.paint(kFol, [{ x: 440, y: 220 }, { x: 480, y: 260 }]);
  a = snap(0.3); b = snap(1.1);
  check(diff(a, b, 420, 200, 500, 280) > 2 && diff(a, b, 0, 300, 60, 360) < 0.5, 'Oscillation Feuillage : la zone peinte ondule');
  // le vrai geste : pointeur sur la scène
  D.startPaint(kFol);
  const st = document.querySelector('.an-stage'), v = D.view(), r0 = st.getBoundingClientRect();
  const ev = (ix, iy) => ({ clientX: r0.left + v.x + ix * v.z, clientY: r0.top + v.y + iy * v.z, pointerId: 7, button: 0, bubbles: true });
  check(!document.querySelector('.an-paintbar').hidden && st.classList.contains('painting'), 'Mode peinture : barre du pinceau, curseur rond');
  st.dispatchEvent(new PointerEvent('pointerdown', ev(80, 330))); st.dispatchEvent(new PointerEvent('pointermove', ev(100, 330))); st.dispatchEvent(new PointerEvent('pointerup', ev(100, 330)));
  const fm = D.masks.get(kFol), px = fm.getContext('2d').getImageData(Math.round(90 * fm.width / W), Math.round(330 * fm.height / H), 1, 1).data;
  check(px[0] > 60, 'Le pinceau suit la souris sur la scène (' + px[0] + ')');
  check(A.undo() && D.masks.get(kFol).getContext('2d').getImageData(Math.round(90 * fm.width / W), Math.round(330 * fm.height / H), 1, 1).data[0] === 0, 'Ctrl+Z annule le dernier coup de pinceau');
  D.stopPaint();
  check(!st.classList.contains('painting'), 'Hors peinture, le curseur normal revient');
  // À impulsion
  const pulse = await D.addEffect('pulse'); pulse.values.tinthigh = '#ff8040';
  D.paint(D.maskKey(pulse.id, 0, 2), [{ x: 300, y: 60 }, { x: 330, y: 60 }]);
  D.select({ kind: 'effect', id: pulse.id });
  const before = snap(0.0), lit = snap(Math.PI / 3 * 1.5);
  check(diff(before, lit, 280, 40, 350, 80) > 4, 'À impulsion : la zone peinte s’allume');
  // masque affiné dans Retouche : la sélection devient le masque
  await A.editInRetouche(kFol);
  const d = KS.state.doc;
  check(!!d?.animerMask && KS.ws.cur !== 'animer' && !document.querySelector('.an-banner').hidden, 'Le masque s’ouvre dans Retouche, avec le bandeau « Renvoyer à Animer »');
  d.selection.rect({ x: 20, y: 20, w: 100, h: 60 }, 'add');
  await D.returnFromRetouche(d);
  const back = D.masks.get(kFol), bd = back.getContext('2d').getImageData(Math.round(60 * back.width / W), Math.round(50 * back.height / H), 1, 1).data;
  check(KS.ws.cur === 'animer' && bd[0] > 200 && !KS.state.docs.includes(d), 'Retour de Retouche : la sélection devient le masque (' + bd[0] + ')');
  // ambiance et halo
  await D.addAmbiance('ember', 1);
  const amb = A.project.layers.at(-1);
  check(amb.kind === 'particle' && Math.abs(amb.x - W / 2) < 1, 'Ambiance Braise ajoutée au centre');
  const still = snap(0.2);
  for (let i = 0; i < 40; i++) D.engine.step(1 / 15);
  check(diff(still, snap(0.2), 0, 0, W, H) > 0.05, 'Braises visibles et animées dans l’aperçu');
  A.project.bloom.on = true; A.project.bloom.strength = 2; D.engine.setBloom(A.project.bloom);
  check(diff(still, snap(0.2), 470, 30, 570, 130) > 3, 'Halo lumineux autour des zones claires');
  // enregistrement, réouverture
  await A.flush();
  const saved = { id: A.id, effects: A.project.layers[0].effects.map(e => e.effect).join(), flowSum: [...fd].reduce((s, v) => s + v, 0) };
  await A.close();
  await wait(() => !!document.querySelector('.an-card'));
  await A.load(saved.id);
  const reflow = D.masks.get(kShake), rd = reflow.getContext('2d').getImageData(0, 0, reflow.width, reflow.height).data;
  check(A.project.layers[0].effects.map(e => e.effect).join() === saved.effects && Math.abs([...rd].reduce((s, v) => s + v, 0) - saved.flowSum) / saved.flowSum < 0.002, 'Réouverture : effets et masques retrouvés');
  const sent = await D.send();
  check(!!sent?.name, 'Envoi vers Wallpaper Engine : ' + sent.name);
  return { results, id: saved.id, sent, effectsCount: fx.length };
}

// projet d'Animer 1.38.0 (mouvements maison) : repris en effets de Wallpaper Engine
async function legacyScenario(id) {
  await KS.animer.load(id);
  const L = KS.animer.project.layers, e = L[0].effects;
  return { version: KS.animer.project.version, effects: e.map(x => x.effect + ':' + JSON.stringify(x.combos)), particles: L.filter(l => l.kind === 'particle').map(l => l.folder + '/' + l.variant),
    masks: [...KS.animer.debug.masks.keys()] };
}

app.whenReady().then(async () => {
  try {
    kc.setup(() => win);
    require(path.join(root, 'suite-host.cjs'))(() => win);
    const out = path.join(tmp, 'output');
    require(path.join(root, 'animer-host.cjs'))({ getWin: () => win, directory: id => { const d = path.join(out, id); fs.mkdirSync(d, { recursive: true }); return d; },
      environment: () => ({ ...process.env, KANEAPP_WE_PROJECTS: weProjects }) });
    const reply = (ch, fn) => { ipcMain.removeHandler(ch); ipcMain.handle(ch, fn); };
    for (const ch of ['set-title', 'set-titlebar']) ipcMain.on(ch, () => {});
    reply('get-pending', () => []); reply('list-fonts', () => []); reply('engine-status', () => ({ state: 'off' }));
    reply('gpu-memory', () => ({ ok: true, used: 1000, total: 16000, measuredAt: Date.now(), devices: [] }));
    reply('app-version', () => 'test'); reply('update-state', () => ({ state: 'none' })); reply('update-check', () => ({ state: 'none' }));
    reply('recovery-list', () => ({ ok: true, entries: [] })); reply('recovery-write', () => ({ ok: true })); reply('recovery-remove', () => ({ ok: true }));
    reply('svc-status', (_e, id) => ({ id, state: 'off', found: true })); reply('engine-config', () => ({})); reply('engine-profiles', () => []);
    reply('vram-idle', () => ({ ok: true })); reply('pending-prompt', () => null); reply('get-pending-studio', () => null); reply('runtime-migration-state', () => ({ running: false }));
    win = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { preload: path.join(root, 'preload.js'), nodeIntegration: false, contextIsolation: true, nodeIntegrationInSubFrames: true, backgroundThrottling: false, offscreen: true } });
    win.webContents.on('console-message', d => { if (d.level === 'error') errors.push(d.message); if (process.env.KANEVAS_TEST_VERBOSE) console.log('[page] ' + d.message); });
    win.webContents.on('preload-error', (_e, p, err) => errors.push(p + ': ' + err.message));
    await win.loadFile(path.join(root, 'app', 'index.html'));
    const r = await win.webContents.executeJavaScript('(' + scenario.toString() + ')(' + JSON.stringify(!!engine) + ')');
    for (const line of r.results) console.log('OK ' + line);
    if (engine) {
      const dir = path.join(out, 'animer', r.id);
      const project = JSON.parse(fs.readFileSync(path.join(dir, 'animer.json'), 'utf8'));
      assert.equal(project.version, 2);
      const files = fs.readdirSync(path.join(dir, 'masks')).sort();
      assert.equal(files.length, 3, files.join());
      console.log('OK Fichiers du projet : animer.json (version 2), image, trois masques, vignette');
      const sceneDir = path.join(weProjects, r.sent.name), scene = JSON.parse(fs.readFileSync(path.join(sceneDir, 'scene.json'), 'utf8'));
      const efx = scene.objects[0].effects;
      assert.deepEqual(efx.map(e => e.file.split('/')[1]), ['shake', 'foliagesway', 'pulse']);
      assert.equal(scene.objects[1].particle, 'particles/presets/ember.json');
      assert.equal(scene.general.bloom.user, 'kane_halo');
      for (const e of efx) for (const p of e.passes) for (const t of (p.textures || []).filter(Boolean)) assert(fs.existsSync(path.join(sceneDir, 'materials', t + '.tex')), 'texture ' + t);
      assert.equal(efx[2].passes[0].constantshadervalues.tinthigh, '1 0.50196 0.25098');
      const flow = WE.readTex(fs.readFileSync(path.join(sceneDir, 'materials', efx[0].passes[0].textures[1] + '.tex')));
      const fp = pixels(flow); let raised = 0; for (let i = 0; i < fp.length; i += 4) if (fp[i + 1] > 200) raised++;
      assert(raised > 100, 'secousse : ' + raised);
      assert(fs.existsSync(path.join(sceneDir, 'effects', 'foliagesway', 'effect.json')) && fs.existsSync(path.join(sceneDir, 'shaders', 'effects', 'foliagesway.frag')) && fs.existsSync(path.join(sceneDir, 'particles', 'presets', 'emberglow.json')));
      console.log('OK Scène Wallpaper Engine : effets copiés, masques compilés en .tex, couleur, braises et halo');
      // projet d'Animer 1.38.0
      const old = path.join(out, 'animer', 'ancien-abc123'); fs.mkdirSync(path.join(old, 'masks'), { recursive: true });
      fs.copyFileSync(path.join(dir, 'image.png'), path.join(old, 'image.png'));
      const gray = nativeImage.createFromBitmap(Buffer.alloc(64 * 36 * 4, 255), { width: 64, height: 36 }).toPNG();
      for (const id of ['m1', 'm2', 'm3']) fs.writeFileSync(path.join(old, 'masks', id + '.png'), gray);
      fs.writeFileSync(path.join(old, 'animer.json'), JSON.stringify({ version: 1, title: 'Ancien', width: 640, height: 360, bloom: { on: false },
        effects: [{ id: 'm1', type: 'respiration', name: 'Respiration', params: { vitesse: 1.4, force: 0.1 } }, { id: 'm2', type: 'clignement', name: 'Clignement', params: { vitesse: 1.2, force: 0.3 } }, { id: 'm3', type: 'lueur', name: 'Lueur', params: { couleur: '#ff0000' } }],
        ambiances: [{ id: 'a1', key: 'feuilles', name: 'Feuilles', x: 320, y: 180, scale: 1, overrides: {} }] }));
      const L = await win.webContents.executeJavaScript('(' + legacyScenario.toString() + ')("ancien-abc123")');
      assert.equal(L.version, 2);
      assert.deepEqual(L.effects, ['shake:{"NOISE":0}', 'shake:{"DIRECTION":1}', 'pulse:{}']);
      assert.deepEqual(L.particles, ['leaves/0']);
      assert.deepEqual(L.masks.map(k => k.replace(/^mask:[^:]+:/, '')).sort(), ['0:1', '0:1', '0:2']);
      console.log('OK Projet d’Animer 1.38.0 repris : Secousse, Secousse (clignement), À impulsion, Feuilles 1, masques');
    } else console.log('-- Wallpaper Engine absent : effets, ambiances et envoi non testés');
    if (process.env.KANEVAS_TEST_SCREENSHOT && r.id) {
      await win.webContents.executeJavaScript(`(async () => { KS.ws.go("animer"); await KS.animer.load(${JSON.stringify(r.id)}); const D = KS.animer.debug; D.playing = true; const e = KS.animer.project.layers[0].effects[1]; D.select({ kind: "effect", id: e.id }); document.querySelector("#toasts").replaceChildren(); })()`);
      await new Promise(res => setTimeout(res, 800));
      fs.writeFileSync(process.env.KANEVAS_TEST_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
    }
    const real = errors.filter(e => !/favicon|Autofill|Animer, effet/i.test(e));
    assert.deepEqual(real, []);
    console.log('OK Aucune erreur dans la console');
  } catch (e) { console.error('ÉCHEC', e.stack || e.message); if (errors.length) console.error(errors.join('\n')); process.exitCode = 1; }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* fichiers encore ouverts */ } app.quit(); }
});

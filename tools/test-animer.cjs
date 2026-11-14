// Atelier Animer dans une vraie fenêtre (WebGL réel) : peinture des cinq mouvements, aperçu qui bouge seulement là où
// on a peint, ambiance et halo, enregistrement puis réouverture, envoi d'une scène compilée par Wallpaper Engine.
// Profil, sorties et projets Wallpaper Engine temporaires. Sans Wallpaper Engine : ambiances et envoi sont sautés.
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
// pixels RGBA d'une texture lue : brute, ou PNG rangé dans le .tex (masques compilés par Wallpaper Engine)
const pixels = t => { if (t.rgba) return t.rgba; const b = nativeImage.createFromBuffer(t.encoded).toBitmap(); for (let i = 0; i < b.length; i += 4) { const r = b[i]; b[i] = b[i + 2]; b[i + 2] = r; } return b; };

async function scenario(hasEngine) {
  const results = [], check = (ok, text) => { console.log('ETAPE ' + (ok ? 'ok ' : 'KO ') + text); if (!ok) throw new Error(text); results.push(text); };
  const wait = async (fn, ms = 15000) => { const end = Date.now() + ms; while (!(await fn()) && Date.now() < end) await new Promise(r => setTimeout(r, 50)); if (!(await fn())) throw new Error('Délai dépassé'); };
  await KS.suite.ready; await KS.suite.home();
  const labels = [...document.querySelectorAll('#kane-nav .ws-btn')].map(b => b.textContent).join('|');
  check(labels.includes('Studio IA|Animer|Vidéo IA'), 'Espace Animer dans la navigation : ' + labels);
  KS.ws.go('animer');
  await wait(() => !!document.querySelector('.an-intro'));
  check(!!document.querySelector('.an-intro .an-start'), 'Écran d’accueil d’Animer : ouvrir une image ou le document de Retouche');
  // image d'essai : dégradé, bandes et un disque clair (pour le halo)
  const W = 640, H = 360, img = KS.util.canvas(W, H), x = img.getContext('2d');
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#203050'); g.addColorStop(1, '#805040'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  for (let i = 0; i < W; i += 12) for (let j = 0; j < H; j += 12) if ((i + j) % 24 === 0) { x.fillStyle = '#c0d0e0'; x.fillRect(i, j, 12, 12); }
  x.fillStyle = '#ffffff'; x.beginPath(); x.arc(520, 80, 30, 0, Math.PI * 2); x.fill();
  await KS.animer.openCanvas(img, 'Essai Animer.png');
  const A = KS.animer, D = A.debug;
  check(A.project?.title === 'Essai Animer' && A.project.width === W && !!A.id, 'Une image devient un projet Animer enregistré');
  D.playing = false;
  const snap = t => { const c = D.engine.snapshot(t, W, H); return c.getContext('2d').getImageData(0, 0, W, H).data; };
  const diff = (a, b, x0, y0, x1, y1) => { let s = 0, n = 0; for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * W + xx) * 4; s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n++; } return s / n / 3; };
  const still0 = snap(0), still1 = snap(1.3);
  check(diff(still0, still1, 0, 0, W, H) === 0, 'Sans mouvement, l’image reste fixe');
  // 1. respiration : coup de pinceau vers le haut dans la moitié gauche
  D.addEffect('respiration');
  Object.assign(D.brush, { size: 140, intensity: 1, hardness: 0.5 });
  D.paint([{ x: 160, y: 260 }, { x: 160, y: 220 }, { x: 160, y: 180 }, { x: 160, y: 140 }, { x: 160, y: 100 }]);
  const flow = D.masks.get(A.project.effects[0].id), fd = flow.getContext('2d').getImageData(0, 0, flow.width, flow.height).data;
  const at = (px, py) => { const k = flow.width / W, i = (Math.round(py * k) * flow.width + Math.round(px * k)) * 4; return [fd[i], fd[i + 1]]; };
  check(at(160, 180)[1] > 200 && Math.abs(at(160, 180)[0] - 127) < 6 && at(500, 300)[0] === 127 && at(500, 300)[1] === 127, 'Respiration : la direction peinte (vers le haut) est écrite dans la carte de direction ' + at(160, 180));
  let a = snap(0.6), b = snap(2.0);
  check(diff(a, b, 110, 120, 210, 240) > 4 && diff(a, b, 400, 150, 630, 350) < 0.5, 'Respiration : seule la zone peinte bouge (' + diff(a, b, 110, 120, 210, 240).toFixed(1) + ')');
  // le vrai geste : pointeur sur la scène (coordonnées de l'écran converties en pixels de l'image)
  D.addEffect('lueur');
  const st = document.querySelector('.an-stage'), v = D.view(), r0 = st.getBoundingClientRect();
  const at2 = (ix, iy) => ({ clientX: r0.left + v.x + ix * v.z, clientY: r0.top + v.y + iy * v.z, pointerId: 7, button: 0, bubbles: true });
  st.dispatchEvent(new PointerEvent('pointerdown', at2(600, 330))); st.dispatchEvent(new PointerEvent('pointermove', at2(620, 330))); st.dispatchEvent(new PointerEvent('pointerup', at2(620, 330)));
  const gm = D.masks.get(A.project.effects.at(-1).id), gd = gm.getContext('2d').getImageData(Math.round(610 * gm.width / W), Math.round(330 * gm.height / H), 1, 1).data;
  check(gd[0] > 60, 'Le pinceau suit la souris sur la scène (' + gd[0] + ')');
  check(A.undo() && D.masks.get(A.project.effects.at(-1).id).getContext('2d').getImageData(Math.round(610 * gm.width / W), Math.round(330 * gm.height / H), 1, 1).data[0] === 0, 'Ctrl+Z annule le dernier coup de pinceau');
  document.querySelector('.an-row.on .icon-btn:last-child').click();
  check(A.project.effects.length === 1, 'Supprimer un mouvement le retire de la liste');
  // 2. cheveux et tissus
  D.addEffect('ondulation'); D.paint([{ x: 420, y: 200 }, { x: 460, y: 240 }, { x: 500, y: 280 }]);
  a = snap(0.3); b = snap(1.1);
  check(diff(a, b, 400, 190, 510, 290) > 3 && diff(a, b, 0, 0, 80, 60) < 0.5, 'Cheveux et tissus : ondulation dans la zone peinte');
  // 3. lueur
  D.addEffect('lueur'); A.project.effects.at(-1).params.couleur = '#ff8040'; D.paint([{ x: 300, y: 60 }, { x: 330, y: 60 }]);
  KS.animer.debug.select({ kind: 'effect', id: A.project.effects.at(-1).id });
  const before = snap(0.0), lit = snap(Math.PI);
  check(diff(before, lit, 280, 40, 350, 80) > 8 && diff(before, lit, 0, 300, 60, 360) < 0.5, 'Lueur : la zone peinte s’allume et s’éteint');
  // 4. regard et 5. clignement
  D.addEffect('regard'); D.paint([{ x: 80, y: 60 }]);
  D.addEffect('clignement'); D.paint([{ x: 240, y: 300 }]);
  const blink = A.project.effects.at(-1); blink.params.vitesse = 1; blink.params.hauteur = 30; blink.params.force = Math.sqrt(30 / H);
  KS.animer.debug.select({ kind: 'effect', id: blink.id });
  const open = snap(0.2), closed = snap(Math.PI / 2 * 1.0 + 0.0001);
  const shut = diff(open, closed, 235, 290, 275, 330), out = diff(open, closed, 590, 0, 640, 40);
  check(shut > 5 && out < 0.5, 'Clignement : la paupière descend brièvement sur la zone peinte (' + shut.toFixed(1) + ' / ' + out.toFixed(2) + ')');
  // le clignement seul : œil ouvert hors du bref passage de la paupière
  D.engine.setEffects([{ id: blink.id, type: 'clignement', visible: true, params: blink.params }]);
  const o1 = snap(0.2), o2 = snap(1.2), o3 = snap(2.4), c1 = snap(Math.PI / 2);
  check(diff(o1, o2, 0, 0, W, H) === 0 && diff(o1, o3, 0, 0, W, H) === 0 && diff(o1, c1, 235, 290, 275, 330) > 5, 'Clignement : l’œil reste ouvert entre deux clignements');
  D.select({ kind: 'effect', id: blink.id });
  check(A.project.effects.map(e => e.type).join() === 'respiration,ondulation,lueur,regard,clignement', 'Cinq mouvements, dans l’ordre de la liste');
  // halo
  A.project.bloom.on = true; A.project.bloom.strength = 2; D.select({ kind: 'bloom' });
  KS.animer.debug.engine.setBloom(A.project.bloom);
  const glow = snap(0.2);
  check(diff(open, glow, 470, 30, 570, 130) > 3, 'Halo lumineux autour des zones claires');
  let ambi = null;
  if (hasEngine) {
    await D.addAmbiance('braises');
    const amb = A.project.ambiances[0];
    check(amb && Math.abs(amb.x - W / 2) < 1 && amb.scale > 0, 'Ambiance Braises ajoutée au centre');
    for (let i = 0; i < 40; i++) D.engine.step(1 / 15);
    const withParticles = snap(0.2);
    ambi = diff(glow, withParticles, 0, 0, W, H);
    check(ambi > 0.05, 'Braises visibles dans l’aperçu (' + ambi.toFixed(2) + ')');
  }
  // enregistrement, réouverture
  await A.flush();
  const saved = { id: A.id, effects: A.project.effects.length, flowSum: [...fd].reduce((s, v) => s + v, 0) };
  await A.close();
  await wait(() => !!document.querySelector('.an-card'));
  check(!A.project && !!document.querySelector('.an-card'), 'La liste « Vos animations » montre le projet enregistré');
  await A.load(saved.id);
  const reflow = D.masks.get(A.project.effects[0].id), rd = reflow.getContext('2d').getImageData(0, 0, reflow.width, reflow.height).data;
  check(A.project.effects.length === saved.effects && Math.abs([...rd].reduce((s, v) => s + v, 0) - saved.flowSum) / saved.flowSum < 0.002, 'Réouverture : mouvements et masques retrouvés');
  let sent = null;
  if (hasEngine) { sent = await D.send(); check(!!sent?.name, 'Envoi vers Wallpaper Engine : ' + sent.name); }
  return { results, id: saved.id, sent, ui: { left: document.querySelector('.an-left').textContent.slice(0, 200) } };
}

app.whenReady().then(async () => {
  try {
    kc.setup(() => win);
    require(path.join(root, 'suite-host.cjs'))(() => win);
    require(path.join(root, 'animer-host.cjs'))({ getWin: () => win, directory: id => { const d = path.join(tmp, 'output', id); fs.mkdirSync(d, { recursive: true }); return d; },
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
    const dir = path.join(tmp, 'output', 'animer', r.id);
    const project = JSON.parse(fs.readFileSync(path.join(dir, 'animer.json'), 'utf8'));
    assert.equal(project.effects.length, 5);
    for (const e of project.effects) assert(fs.existsSync(path.join(dir, 'masks', e.id + '.png')), 'masque ' + e.id);
    assert(fs.existsSync(path.join(dir, 'thumb.jpg')) && fs.existsSync(path.join(dir, 'image.png')));
    console.log('OK Fichiers du projet : animer.json, image, cinq masques, vignette');
    if (engine) {
      const out = path.join(weProjects, r.sent.name);
      const scene = JSON.parse(fs.readFileSync(path.join(out, 'scene.json'), 'utf8'));
      const fx = scene.objects[0].effects.map(e => e.file.split('/')[1]);
      assert.deepEqual(fx, ['shake', 'waterwaves', 'pulse', 'iris', 'shake']);
      assert.equal(scene.objects[1].particle, 'particles/presets/ember.json');
      assert.equal(scene.general.bloom.user, 'kane_halo');
      for (const e of scene.objects[0].effects) for (const t of e.passes[0].textures.filter(Boolean)) assert(fs.existsSync(path.join(out, 'materials', t + '.tex')), 'texture ' + t);
      // le masque du clignement est envoyé en carte de direction vers le haut (r = 127, g < 127 là où l'on a peint)
      const blink = WE.readTex(fs.readFileSync(path.join(out, 'materials', scene.objects[0].effects[4].passes[0].textures[1] + '.tex')));
      const bp = pixels(blink); let up = 0; for (let i = 0; i < bp.length; i += 4) if (bp[i + 1] < 100 && Math.abs(bp[i] - 127) <= 1) up++;
      assert(up > 50, 'clignement : ' + up);
      const flow = WE.readTex(fs.readFileSync(path.join(out, 'materials', scene.objects[0].effects[0].passes[0].textures[1] + '.tex')));
      const fp = pixels(flow); let raised = 0; for (let i = 0; i < fp.length; i += 4) if (fp[i + 1] > 200) raised++;
      assert(raised > 100, 'respiration : ' + raised);
      assert(fs.existsSync(path.join(out, 'effects', 'shake', 'effect.json')) && fs.existsSync(path.join(out, 'shaders', 'effects', 'iris.frag')) && fs.existsSync(path.join(out, 'particles', 'presets', 'emberglow.json')));
      console.log('OK Scène Wallpaper Engine : effets natifs copiés, masques compilés en .tex, braises et halo');
    } else console.log('-- Wallpaper Engine absent : ambiance et envoi non testés');
    if (process.env.KANEVAS_TEST_SCREENSHOT) {
      await win.webContents.executeJavaScript('KS.ws.go("animer"); KS.animer.debug.playing = true; KS.animer.debug.select({ kind: "effect", id: KS.animer.project.effects[1].id }); document.querySelector("#toasts").replaceChildren()');
      await new Promise(r => setTimeout(r, 700));
      fs.writeFileSync(process.env.KANEVAS_TEST_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
    }
    const real = errors.filter(e => !/favicon|Autofill/i.test(e));
    assert.deepEqual(real, []);
    console.log('OK Aucune erreur dans la console');
  } catch (e) { console.error('ÉCHEC', e.stack || e.message); if (errors.length) console.error(errors.join('\n')); process.exitCode = 1; }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* fichiers encore ouverts */ } app.quit(); }
});

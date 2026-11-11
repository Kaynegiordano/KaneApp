// Gestes et raccourcis « à la Photoshop » de Retouche, avec de vrais événements souris et clavier (fenêtre hors écran).
// Lancer : node_modules/electron/dist/electron.exe tools/test-retouche.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanevas-retouche-'));
app.setPath('userData', path.join(tmp, 'profile'));
const preload = path.join(tmp, 'preload.cjs');
fs.writeFileSync(preload, `
localStorage.setItem('kanevas.prefs', JSON.stringify({ kanevasPalette: true, startPage: 'edit' }));
window.ksNative = { setTitle() {}, setTitleBar() {}, setZoom() {}, onCloseRequest() {}, onOpenPath() {}, onEngine() {}, getPending: async () => [],
  engineStatus: async () => ({ state: 'off', tail: [] }), forgeStatus: async () => ({ ok: false }), gpuMemory: async () => ({ ok: false }) };
`);
setTimeout(() => { console.log('ABANDON : plus de 120 s'); app.exit(2); }, 120000);
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'OK ' : 'ÉCHEC ') + msg); if (!ok) fails++; };

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1400, height: 900, useContentSize: true, webPreferences: { preload, contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
  const errors = [];
  win.webContents.on('console-message', d => { if (d.level === 'error') errors.push(d.message); });
  await win.loadFile(path.join(__dirname, '../app/index.html'));
  const js = s => win.webContents.executeJavaScript(s);
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const send = ev => win.webContents.sendInputEvent(ev);
  const key = async (keyCode, type = 'both', modifiers = []) => {
    if (type !== 'up') send({ type: 'keyDown', keyCode, modifiers });
    if (type === 'both') await pause(20);
    if (type !== 'down') send({ type: 'keyUp', keyCode, modifiers });
    await pause(40);
  };
  // glisser réel : bouton, touches tenues, trajet en quelques pas
  const drag = async (x0, y0, x1, y1, { button = 'left', modifiers = [], steps = 6, hold } = {}) => {
    send({ type: 'mouseMove', x: x0, y: y0, modifiers });
    send({ type: 'mouseDown', x: x0, y: y0, button, clickCount: 1, modifiers }); await pause(30);
    for (let i = 1; i <= steps; i++) { send({ type: 'mouseMove', x: Math.round(x0 + (x1 - x0) * i / steps), y: Math.round(y0 + (y1 - y0) * i / steps), button, modifiers }); await pause(15); }
    if (hold) await hold();
    send({ type: 'mouseUp', x: x1, y: y1, button, clickCount: 1, modifiers }); await pause(60);
  };
  try {
    await js(`new Promise(r => { const t = () => KS.tools && KS.tools.byId && KS.tools.byId.brush ? r() : setTimeout(t, 50); t(); })`);
    await js(`(async () => {
      if (KS.studio && KS.studio.on) await KS.cmd.toggleStudio(false);
      KS.suite?.hideHome?.();
      KS.addDoc(KS.createDoc({ name: 'Gestes', width: 800, height: 600, background: 'white' }));
      await new Promise(r => setTimeout(r, 300));
      KS.view.setZoom(1); KS.view.center();
      KS.setFG({ r: 200, g: 30, b: 40 }); KS.cmd.fillFG();
      KS.resetColors(); KS.tools.select('brush');
      Object.assign(KS.tools.byId.brush.o, { size: 30, hardness: 80, opacity: 100, flow: 100 });
    })()`);
    await pause(300);
    // centre de la zone de travail, en coordonnées de la fenêtre
    const c = await js(`(() => { const r = KS.view.canvas.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const st = () => js(`({ tool: KS.tools.current.id, size: KS.tools.byId.brush.o.size, hard: KS.tools.byId.brush.o.hardness, op: KS.tools.byId.brush.o.opacity, flow: KS.tools.byId.brush.o.flow,
      fg: KS.util.hex(KS.state.fg), hist: KS.state.doc.history.items.length, gesture: KS.tools.brushGesture.active })`);

    // 1. Alt + clic gauche glissé : taille / dureté, sans peindre ni changer la couleur
    let a = await st();
    await drag(c.x, c.y, c.x + 120, c.y + 40, { modifiers: ['alt'] });
    let b = await st();
    check(b.size > a.size + 50 && b.hard > a.hard && b.fg === a.fg && b.hist === a.hist && !b.gesture, `Alt + clic gauche glissé : taille ${a.size} → ${b.size} px, dureté ${a.hard} → ${b.hard} %, couleur et document intacts`);
    // 2. Alt + clic simple : pipette
    send({ type: 'mouseMove', x: c.x + 5, y: c.y + 5, modifiers: ['alt'] });
    send({ type: 'mouseDown', x: c.x + 5, y: c.y + 5, button: 'left', clickCount: 1, modifiers: ['alt'] }); await pause(30);
    send({ type: 'mouseUp', x: c.x + 5, y: c.y + 5, button: 'left', clickCount: 1, modifiers: ['alt'] }); await pause(60);
    b = await st();
    check(b.fg === '#c81e28' && b.tool === 'brush', 'Alt + clic sans bouger : pipette (' + b.fg + '), le pinceau reste l’outil');
    // 3. Alt + clic droit glissé (Photoshop) : toujours la taille
    a = await st();
    await drag(c.x, c.y, c.x - 80, c.y, { button: 'right', modifiers: ['alt'] });
    b = await st();
    check(b.size < a.size && b.hist === a.hist, `Alt + clic droit glissé : taille ${a.size} → ${b.size} px`);
    check(!(await js(`!!document.querySelector('.menu')`)), 'Pas de menu contextuel après le geste');
    // 4. Ctrl + Alt + clic droit glissé : opacité / flux
    a = await st();
    await drag(c.x, c.y, c.x - 100, c.y + 60, { button: 'right', modifiers: ['control', 'alt'] });
    b = await st();
    check(b.op < a.op && b.flow < a.flow && b.size === a.size, `Ctrl + Alt + clic droit glissé : opacité ${a.op} → ${b.op} %, flux ${a.flow} → ${b.flow} %`);
    // 5. Maj + Alt + clic droit : couleur au curseur ; Échap rend la couleur d'avant
    a = await st();
    await drag(c.x, c.y, c.x - 60, c.y - 70, { button: 'right', modifiers: ['shift', 'alt'] });
    b = await st();
    check(b.fg !== a.fg && b.hist === a.hist, `Maj + Alt + clic droit glissé : nouvelle couleur ${a.fg} → ${b.fg}`);
    let seen = false;
    await drag(c.x, c.y, c.x + 40, c.y + 50, { button: 'right', modifiers: ['shift', 'alt'], hold: async () => { seen = (await st()).fg !== b.fg; send({ type: 'keyDown', keyCode: 'Escape', modifiers: ['shift', 'alt'] }); await pause(40); } });
    check(seen && (await st()).fg === b.fg, 'La couleur change en direct, Échap la rend');
    // 6. Opacité à deux chiffres
    await key('4'); await key('5');
    check((await st()).op === 45, 'Taper 4 puis 5 : opacité 45 %');
    await pause(800); await key('7');
    check((await st()).op === 70, 'Un seul chiffre : 70 %');
    // 7. [ ] : la taille change et une bulle l'annonce près du curseur
    a = await st(); await key(']');
    check((await st()).size > a.size && await js(`!!document.querySelector('.brush-hud.flash') && document.querySelector('.brush-hud.flash').textContent.startsWith('Taille')`), '] agrandit le pinceau, bulle « Taille » près du curseur');
    // 8. Outil à ressort : E maintenu + tracé → retour au pinceau ; E bref → gomme gardée
    a = await st();
    await key('E', 'down'); await pause(60);
    check((await st()).tool === 'eraser', 'E maintenu : gomme');
    await drag(c.x - 100, c.y - 100, c.x + 50, c.y - 100);
    await key('E', 'up');
    b = await st();
    check(b.tool === 'brush' && b.hist === a.hist + 1, 'Tracé à la gomme puis E relâché : retour au pinceau (le tracé est bien fait)');
    await key('E');
    check((await st()).tool === 'eraser', 'Appui bref sur E : la gomme reste choisie');
    await js(`KS.tools.select('brush')`);
    // 9. Calques : Alt + [ / ], Maj + / −
    await js(`(() => { KS.cmd.newLayer(); KS.cmd.newLayer(); })()`); await pause(100);
    const layer = () => js(`({ i: KS.state.doc.layers.indexOf(KS.state.doc.active), n: KS.state.doc.layers.length, blend: KS.state.doc.active.blend || 'normal' })`);
    a = await layer();
    await key('[', 'both', ['alt']);
    b = await layer();
    check(b.i === a.i - 1, `Alt + [ : calque du dessous (${a.i} → ${b.i})`);
    await key(']', 'both', ['alt', 'shift']);
    check((await layer()).i === a.n - 1, 'Alt + Maj + ] : calque tout en haut');
    a = await layer();
    await key('Plus', 'both', ['shift']);
    b = await layer();
    check(a.blend === 'normal' && b.blend !== 'normal', `Maj + + : mode de fusion suivant (${a.blend} → ${b.blend})`);
    await key('numsub', 'both', ['shift']);
    check((await layer()).blend === 'normal', 'Maj + − : retour au mode précédent');
    // 10. Vue d'ensemble : zoom 400 %, H maintenu + clic glissé, relâcher → même zoom, autre endroit, retour au pinceau
    await js(`KS.view.setZoom(4); KS.tools.select('brush')`);
    const v0 = await js(`({ z: KS.view.zoom, ox: KS.view.ox, oy: KS.view.oy })`);
    await key('H', 'down'); await pause(60);
    let zoomDuring = 0;
    await drag(c.x, c.y, c.x + 200, c.y + 120, { hold: async () => { zoomDuring = await js('KS.view.zoom'); } });
    await key('H', 'up');
    const v1 = await js(`({ z: KS.view.zoom, ox: KS.view.ox, oy: KS.view.oy, tool: KS.tools.current.id })`);
    check(zoomDuring < v0.z / 2 && v1.z === v0.z && (v1.ox !== v0.ox || v1.oy !== v0.oy) && v1.tool === 'brush', `Vue d’ensemble : zoom ${v0.z} → ${zoomDuring.toFixed(2)} pendant l’appui → ${v1.z}, vue déplacée, retour au pinceau`);
    // 11. Tous les outils qui ont une taille : Alt + clic gauche glissé et Alt + clic droit glissé
    await js(`KS.view.setZoom(1); KS.view.center()`); await pause(100);
    const ids = await js(`Object.values(KS.tools.byId).filter(t => KS.tools.brushGesture.sizeable(t) && !t.hidden).map(t => t.id)`);
    check(['eraser', 'remove', 'clone', 'heal-spot', 'dodge', 'blur', 'adjust-brush'].every(id => ids.includes(id)), 'Outils à taille reconnus : ' + ids.join(', '));
    for (const id of ids) {
      const size = () => js(`KS.tools.byId[${JSON.stringify(id)}].o.size`);
      await js(`KS.tools.select(${JSON.stringify(id)}); KS.tools.byId[${JSON.stringify(id)}].o.size = 40`); await pause(40);
      const h0 = await js('KS.state.doc.history.items.length'), altPaints = await js(`!!KS.tools.byId[${JSON.stringify(id)}].altPaints`);
      await drag(c.x, c.y, c.x - 30, c.y, { button: 'right', modifiers: ['alt'] });
      const sRight = await size();
      await js(`KS.tools.byId[${JSON.stringify(id)}].o.size = 40`);
      let sLeft = 40;
      if (!altPaints) { await drag(c.x, c.y, c.x + 60, c.y, { modifiers: ['alt'] }); sLeft = await size(); }
      const h1 = await js('KS.state.doc.history.items.length');
      check(sRight < 40 && (altPaints || sLeft > 40) && h1 === h0, `${id} : Alt + clic droit glissé 40 → ${sRight} px` + (altPaints ? ' (Alt + clic gauche garde son rôle : peindre en retirant)' : `, Alt + clic gauche glissé 40 → ${sLeft} px`) + ', document intact');
    }
    await js(`KS.tools.select('clone'); KS.tools.byId.clone.src = null`);
    send({ type: 'mouseMove', x: c.x, y: c.y, modifiers: ['alt'] });
    send({ type: 'mouseDown', x: c.x, y: c.y, button: 'left', clickCount: 1, modifiers: ['alt'] }); await pause(30);
    send({ type: 'mouseUp', x: c.x, y: c.y, button: 'left', clickCount: 1, modifiers: ['alt'] }); await pause(60);
    check(await js(`!!KS.tools.byId.clone.src`), 'Tampon : Alt + clic sans bouger définit toujours la source');
    const visibleErrors = errors.filter(e => !/favicon|ResizeObserver/.test(e));
    check(!visibleErrors.length, 'Aucune erreur dans la console' + (visibleErrors.length ? ' : ' + visibleErrors.slice(0, 3).join(' | ') : ''));
    if (process.env.RETOUCHE_SHOT) {
      // capture du sélecteur de couleur ouvert
      await js(`KS.view.setZoom(1); KS.view.center(); KS.tools.select('brush')`); await pause(200);
      send({ type: 'mouseMove', x: c.x, y: c.y, modifiers: ['shift', 'alt'] });
      send({ type: 'mouseDown', x: c.x, y: c.y, button: 'right', clickCount: 1, modifiers: ['shift', 'alt'] }); await pause(40);
      send({ type: 'mouseMove', x: c.x + 40, y: c.y - 30, button: 'right', modifiers: ['shift', 'alt'] }); await pause(250);
      fs.writeFileSync(process.env.RETOUCHE_SHOT, (await win.webContents.capturePage()).toPNG());
      send({ type: 'mouseUp', x: c.x + 40, y: c.y - 30, button: 'right', clickCount: 1, modifiers: ['shift', 'alt'] }); await pause(60);
    }
  } catch (e) { console.log('ÉCHEC ' + (e.stack || e)); fails++; }
  console.log(fails ? fails + ' échec(s)' : 'Tout est bon');
  app.exit(fails ? 1 : 0);
});

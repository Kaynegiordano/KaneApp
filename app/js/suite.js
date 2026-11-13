// Projet commun, bibliothèque durable et parcours Illustration → Animation → Montage.
'use strict';
(() => {
  const N = KS.native, h = KS.h, ui = KS.ui, C = KS.cmd, U = KS.util;
  if (!N?.suiteCall) return;
  const S = KS.suite = { project: null, tasks: [], selected: null };
  let home, drawer, nav, list, stage, details, taskButton, projectButton, search = '', filter = 'all', started = false, extra = 0;
  // Nombre de médias montrés dans la bibliothèque (préférence libraryCount ; 0 = tous) : un projet de plusieurs centaines
  // d'images ne charge plus toutes ses vignettes à l'ouverture de KaneApp. « Afficher plus » en ajoute pour la séance.
  const COUNTS = [[12, '12'], [24, '24'], [48, '48'], [96, '96'], [200, '200'], [0, 'Tous']];
  const shown = () => { const n = +(KS.prefs.libraryCount ?? 48); return n > 0 ? n + extra : Infinity; };
  let resolveReady; S.ready = new Promise(r => resolveReady = r);
  const captures = new WeakMap(), animations = new Map();
  const mediaURL = p => 'kcm://f/' + encodeURIComponent(p);
  const titleOf = source => ({ edition: 'Retouche', studio: 'Studio IA', wallpaper: 'Animation', comfyui: 'Animation Vidéo', video: 'Montage', import: 'Import' })[source] || source;
  const action = (label, fn, cls = '', disabled = false, icon) => {
    const b = ui.btn(label, () => S.run(label, fn).catch(() => {}), cls, icon); b.disabled = disabled; return b;
  };
  async function call(op, args = {}) {
    const result = await N.suiteCall(op, { project: S.project?.id, ...args });
    if (!result.ok) throw new Error(result.error); return result.value;
  }
  function adopt(p) {
    if (!p || p.id !== S.project?.id) return;
    S.project = p; render(); KS.emit('suite-project', p);
  }
  S.run = async (label, fn) => {
    const task = { id: crypto.randomUUID(), label, phase: 'running', time: Date.now() };
    S.tasks.unshift(task); S.tasks = S.tasks.slice(0, 40); renderTasks();
    try { const value = await fn(); task.phase = 'done'; return value; }
    catch (err) { task.phase = 'error'; task.error = err.message; if (!err.suiteShown) { KS.toast(err.message, 'err', 6000); err.suiteShown = true; } throw err; }
    finally { renderTasks(); }
  };
  function externalTask(id, m) {
    let task = S.tasks.find(t => t.external === id && t.phase === 'running');
    if (m.busy) {
      if (!task) { task = { id: crypto.randomUUID(), external: id, label: '', phase: 'running', time: Date.now() }; S.tasks.unshift(task); }
      task.label = m.status || (id === 'wallpaper' ? 'Animation en cours' : 'Traitement vidéo');
    } else if (task) { task.phase = /[ée]chec|erreur/i.test(m.status || '') ? 'error' : 'done'; task.error = task.phase === 'error' ? m.status : null; }
    renderTasks();
  }
  S.event = (id, m) => {
    if (typeof m.busy === 'boolean') externalTask(id, m);
    if (m.error) KS.toast(m.error, 'err', 6000);
    if (id === 'wallpaper' && m.dossier) animations.set(id, m);
    if (id === 'wallpaper' && m.completed && S.project?.animation?.dossier === m.dossier) {
      S.run('Récupération de la boucle', async () => {
        const project = S.project.id, outputs = await N.svcOutputs('wallpaper', 100);
        for (const it of outputs.filter(it => it.path.split(/[\\/]/).includes(m.dossier))) {
          const result = await call('import', { project, path: it.path, source: 'wallpaper' }); adopt(result.project);
        }
      }).catch(() => {});
    }
  };
  function renderTasks() {
    if (!taskButton) return;
    const busy = S.tasks.filter(t => t.phase === 'running');
    taskButton.textContent = busy.length ? busy.length + ' tâche(s) en cours' : 'Activité';
    taskButton.classList.toggle('working', !!busy.length);
  }
  S.showTasks = () => {
    const body = h('div.suite-tasklist');
    const fill = () => {
      body.replaceChildren();
      for (const t of S.tasks) body.append(h('div.suite-task', { 'data-phase': t.phase }, h('span', { text: t.phase === 'running' ? '◌' : t.phase === 'error' ? '!' : '✓' }),
        h('div', h('b', { text: t.label }), h('small', { text: t.error || (t.phase === 'running' ? 'En cours…' : 'Terminé') }))));
      if (!S.tasks.length) body.append(h('p.note', { text: 'Les transferts, animations et rendus apparaîtront ici.' }));
    };
    const modal = KS.modal({ title: 'Activité de la suite', width: 580, body, buttons: [{ label: 'Fermer', primary: true }] });
    fill(); const timer = setInterval(fill, 800); modal.done.then(() => clearInterval(timer));
  };
  S.theme = id => {
    const cs = getComputedStyle(document.body), colors = {};
    for (const key of ['--bg', '--chrome', '--panel', '--panel-2', '--raised', '--hover', '--field', '--border', '--border-2', '--text', '--text-2', '--muted', '--accent', '--accent-2', '--accent-rgb', '--accent-soft', '--accent-ink', '--ui', '--mono', '--radius', '--radius-lg']) colors[key] = cs.getPropertyValue(key).trim();
    const acc = U.parseHex(KS.appearance.color(id || KS.appearance.active));
    colors['--accent'] = U.hex(acc); colors['--accent-rgb'] = `${acc.r}, ${acc.g}, ${acc.b}`;
    colors['--accent-2'] = KS.prefs.theme === 'light' ? U.hex({ r: acc.r * .72, g: acc.g * .72, b: acc.b * .72 }) : U.hex({ r: acc.r + (255 - acc.r) * .18, g: acc.g + (255 - acc.g) * .18, b: acc.b + (255 - acc.b) * .18 });
    colors['--accent-soft'] = `rgba(${acc.r}, ${acc.g}, ${acc.b}, .12)`;
    return { theme: KS.prefs.theme, flat: true, colors };
  };
  S.hideHome = () => document.body.classList.remove('suite-home');
  S.home = async () => {
    await S.ready; await C.toggleStudio(false); KS.ws.go(null);
    document.body.classList.add('suite-home'); KS.ws.sync(); render();
  };
  S.library = async () => {
    await S.ready;
    if (document.body.classList.contains('suite-home') && KS.prefs.showLibrary === true) { search = ''; render(); list?.scrollIntoView({ block: 'nearest' }); return; }
    drawer.hidden = !drawer.hidden; if (!drawer.hidden) renderLibrary(drawer);
  };
  async function inputName(title, initial) {
    const input = h('input.field', { value: initial, placeholder: 'Nom du projet', maxLength: 120, style: { width: '360px' } });
    const modal = KS.modal({ title, body: input, buttons: [{ label: 'Annuler', value: false }, { label: 'Enregistrer', primary: true, value: true }] });
    setTimeout(() => { input.focus(); input.select(); }, 0);
    return (await modal.done) ? input.value.trim() : null;
  }
  function canSwitch() {
    if (KS.studioApi?.isBusy() || S.tasks.some(t => t.phase === 'running')) throw new Error('Attendez la fin des tâches avant de changer de projet');
  }
  async function choose(p) {
    if (KS.ws.el.video?.ready) await KS.ws.request('video', 'save');
    if (KS.ws.el.wallpaper?.ready) await KS.ws.request('wallpaper', 'flush');
    if (KS.ws.el.video?.ready) await KS.ws.request('video', 'project', { project: p });
    S.project = p; S.selected = p.items[0]?.id || null;
    KS.prefs.suiteProject = p.id; KS.prefs.save();
    render(); KS.emit('suite-project', p); await S.home();
  }
  S.newProject = async () => {
    await S.ready; canSwitch(); const name = await inputName('Nouveau projet créatif', 'Mon projet');
    if (name) await S.run('Création du projet', async () => choose(await call('create', { name })));
  };
  S.chooseProject = async () => {
    await S.ready; const projects = await call('list');
    const body = h('div.suite-projectlist');
    for (const p of projects) body.append(ui.btn(p.name + ' · ' + p.count + ' média(s)', async () => {
      try { canSwitch(); modal.close(); await S.openProject(p.id); } catch (e) { if (!e.suiteShown) KS.toast(e.message, 'err'); }
    }, '.suite-projectchoice' + (p.id === S.project.id ? '.on' : ''), 'folder-open'));
    const modal = KS.modal({ title: 'Vos projets', body, width: 480, buttons: [{ label: 'Nouveau projet', value: 'new' }, { label: 'Fermer', value: false }] });
    if ((await modal.done) === 'new') await S.newProject();
  };
  S.openProject = async id => { await S.ready; canSwitch(); await S.run('Ouverture du projet', async () => choose(await call('get', { project: id }))); };
  S.rename = async () => { const name = await inputName('Renommer le projet', S.project.name); if (name) adopt(await call('rename', { name })); };
  S.import = async paths => {
    await S.ready; const project = S.project.id;
    const files = paths || await N.suitePick();
    for (const path of files) { const r = await call('import', { project, path, source: 'import' }); adopt(r.project); S.selected = r.item.id; }
    render();
  };
  S.capture = async (scope = 'document') => {
    KS.panels.defs.properties?.commitPending?.();
    await S.ready; const d = KS.state.doc; if (!d) throw new Error('Ouvrez une illustration dans Retouche');
    const project = S.project.id, known = captures.get(d), revision = d.revision;
    if (scope === 'document' && known?.project === project && known.revision === revision) return S.project.items.find(it => it.id === known.id);
    let canvas = U.copyCanvas(d.composite()), suffix = '';
    const snapshotPromise = scope === 'document' ? KS.io.writeKSP(d) : null;
    if (scope === 'selection') {
      const bounds = d.selection.bounds; if (!bounds) throw new Error('Sélectionnez une zone dans l’illustration');
      canvas = U.copyCanvas(canvas, bounds); const x = canvas.getContext('2d'); x.globalCompositeOperation = 'destination-in'; x.drawImage(d.selection.mask, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h); suffix = ' — sélection';
    }
    const thumb = U.canvas(Math.max(1, Math.round(canvas.width * 320 / Math.max(canvas.width, canvas.height))), Math.max(1, Math.round(canvas.height * 320 / Math.max(canvas.width, canvas.height))));
    thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);
    let data = new Uint8Array(await (await U.blobFromCanvas(canvas)).arrayBuffer());
    if (d.genInfo) data = KS.png.writeText(data, 'parameters', d.genInfo);
    const snapshot = await snapshotPromise;
    const r = await call('capture', { project, name: d.name.replace(/\.[^.]+$/, '') + suffix + '.png', data, snapshot,
      thumb: new Uint8Array(await (await U.blobFromCanvas(thumb, 'image/jpeg', .8)).arrayBuffer()), source: 'edition', info: d.genInfo,
      parent: scope === 'document' && known?.project === project ? known.id : null });
    adopt(r.project); S.selected = r.item.id;
    if (scope === 'document') captures.set(d, { project, id: r.item.id, revision });
    return r.item;
  };
  S.collect = async items => {
    await S.ready; const project = S.project.id;
    await S.run('Archivage des générations', async () => {
      for (const it of items) {
        // le PNG de Forge tel quel (pas de second encodage, ses métadonnées gardées) ; sinon encodé depuis l'image
        const data = it.bytes || new Uint8Array(await (await U.blobFromCanvas(it.canvas)).arrayBuffer());
        const tagged = it.info && !KS.png.hasText(data, 'parameters') ? KS.png.writeText(data, 'parameters', it.info) : data;
        const r = await call('capture', { project, name: 'Création ' + new Date().toLocaleTimeString('fr-FR').replace(/:/g, '-') + '.png', data: tagged, source: 'studio', info: it.info }); adopt(r.project);
      }
    });
  };
  S.open = async it => {
    const path = it.snapshotPath || it.path;
    const existing = KS.state.docs.find(d => captures.get(d)?.id === it.id && captures.get(d)?.project === S.project.id && captures.get(d)?.revision === d.revision);
    await C.toggleStudio(false);
    if (existing) { KS.switchDoc(existing); return; }
    const f = await N.readFile(path); if (f.error) throw new Error(f.error);
    // Les instantanés sont immuables : enregistrer le document propose un fichier de travail distinct.
    const d = await KS.io.openEntry({ ...f, path: null });
    if (!d) throw new Error('Illustration illisible');
    d.name = it.name.replace(/\.[^.]+$/, '') + (it.snapshotPath ? '.ksp' : '.png'); d.genInfo = it.info || '';
    captures.set(d, { project: S.project.id, id: it.id, revision: d.revision });
  };
  S.toStudio = async (it, target) => {
    const f = await N.readFile(it.path); if (f.error) throw new Error(f.error);
    const canvas = await KS.io.canvasFromEntry(f); await KS.studioApi.sendCanvas(canvas, it.info || '', target);
  };
  S.addLayer = async it => {
    const d = KS.state.doc; if (!d) throw new Error('Ouvrez d’abord un document destinataire');
    const f = await N.readFile(it.path); if (f.error) throw new Error(f.error);
    const canvas = await KS.io.canvasFromEntry(f);
    if (!KS.state.docs.includes(d)) throw new Error('Le document destinataire a été fermé');
    await C.toggleStudio(false); KS.switchDoc(d);
    KS.io.placeCanvas(d, canvas, it.name.replace(/\.[^.]+$/, ''), canvas.width <= d.width && canvas.height <= d.height ? { x: Math.round((d.width - canvas.width) / 2), y: Math.round((d.height - canvas.height) / 2) } : null);
    drawer.hidden = true;
  };
  async function modalChoice(title, message, buttons) { return (await KS.modal({ title, body: h('p', { text: message }), buttons }).done); }
  S.importAnimation = async file => {
    await S.ready;
    if (!file) file = (await N.openDialog({ title:'Ouvrir une image dans Animation', multi:false, filters:[{name:'Images',extensions:['png','jpg','jpeg','webp','bmp','gif','avif']}] }))?.[0];
    if (!file) return;
    if (file.error) throw new Error(file.error);
    if (!file.data || file.data.byteLength > 100 * 1024 * 1024) throw new Error('Choisissez une image de moins de 100 Mo');
    let canvas;
    try { canvas = await KS.io.canvasFromEntry(file); }
    catch { throw new Error('Cette image est illisible ou son format n’est pas pris en charge.'); }
    const data = new Uint8Array(await (await U.blobFromCanvas(canvas)).arrayBuffer());
    const r = await call('capture', { name:String(file.name || 'Image').replace(/\.[^.]+$/, '') + '.png', data, source:'wallpaper' });
    adopt(r.project); S.selected = r.item.id;
    return S.animate(r.item);
  };
  S.animate = async (it, psd = null) => {
    if (it.kind !== 'image') throw new Error('Choisissez une image pour l’animation');
    const project = S.project.id, linked = S.project.animation;
    // document en calques (découpe 4.0) : toujours une nouvelle animation, construite sur ses calques
    const decision = psd ? 'new' : linked ? await modalChoice('Animation du projet', 'Reprendre les zones existantes avec cette version, ou créer une autre animation ?',
      [{ label: 'Annuler', value: null }, { label: 'Nouvelle animation', value: 'new' }, { label: 'Mettre à jour la source', primary: true, value: 'update' }]) : 'new';
    if (!decision) return false;
    await KS.ws.ensure('wallpaper');
    const f = await N.readFile(it.path); if (f.error) throw new Error(f.error);
    let dossier;
    if (decision === 'update') {
      await KS.ws.request('wallpaper', 'flush'); const result = await N.weaUpdate(linked.dossier, f.data);
      if (!result.ok) throw new Error(result.error); dossier = linked.dossier;
    } else { const result = await N.weaNew(S.project.name, psd || f.data); if (!result.ok) throw new Error(result.error); dossier = result.dossier; }
    const p = await call('animation', { project, value: { dossier, item: it.id, updated: Date.now() } }); adopt(p);
    await KS.ws.request('wallpaper', 'open', { dossier });
    drawer.hidden = true; KS.toast(decision === 'update' ? 'Source mise à jour. Les zones sont conservées ; vérifiez-les avant de régénérer.' : 'Animation prête : peignez les zones à mettre en mouvement.', 'ok', 4500);
    return true;
  };
  S.resumeAnimation = async () => {
    const link = S.project.animation; if (!link) return KS.ws.go('wallpaper');
    await KS.ws.ensure('wallpaper'); await KS.ws.request('wallpaper', 'open', { dossier: link.dossier });
  };
  S.openVideo = async () => { await S.ready; await KS.ws.ensure('video'); await KS.ws.request('video', 'project', { project: S.project }); };
  S.toVideo = async it => { await S.openVideo(); await KS.ws.request('video', 'add', { path: it.path }); drawer.hidden = true; KS.toast('Média ajouté au montage du projet.', 'ok'); };
  S.replaceVideo = async it => {
    await S.openVideo(); const state = await KS.ws.request('video', 'state');
    const options = state.media.filter(m => m.path !== it.path); if (!options.length) throw new Error('Le montage ne contient aucun autre média à remplacer');
    const select = ui.select(options.map(m => [m.path, m.name]), options[0].path);
    const ok = await KS.modal({ title: 'Mettre à jour un média du montage', body: h('div.form-col', h('p', { text: 'Les événements utilisant ce média garderont leurs coupes, effets et positions. Vérifiez la durée si la nouvelle vidéo est plus courte.' }), select),
      buttons: [{ label: 'Annuler', value: false }, { label: 'Remplacer', primary: true, value: true }] }).done;
    if (ok) { await KS.ws.request('video', 'replace', { previous: select.value, path: it.path }); drawer.hidden = true; }
  };
  S.toComfy = async it => {
    await KS.ws.ensure('comfyui'); const f = await N.readFile(it.path); if (f.error) throw new Error(f.error);
    const r = await N.comfyUpload(it.name, f.data); if (!r.ok) throw new Error(r.error);
    const result = await KS.ws.request('comfyui', 'image', { name: r.name });
    if (result?.nodes) {
      const select = ui.select(result.nodes.map(n => [n.id, n.title + ' · #' + n.id]), result.nodes[0].id);
      const ok = await KS.modal({ title: 'Choisir l’entrée du workflow', body: select, buttons: [{ label: 'Annuler', value: false }, { label: 'Utiliser cette entrée', primary: true, value: true }] }).done;
      if (!ok) return; await KS.ws.request('comfyui', 'image', { name: r.name, node: select.value });
    }
    drawer.hidden = true; KS.toast('Image placée dans l’entrée du workflow.', 'ok');
  };
  S.loadWorkflow = async () => {
    const files = await N.openDialog({ filters: [{ name: 'Workflow ComfyUI', extensions: ['json'] }], multi: false }); if (!files.length) return;
    const workflow = JSON.parse(new TextDecoder().decode(files[0].data));
    await KS.ws.ensure('comfyui'); await KS.ws.request('comfyui', 'workflow', { workflow });
    KS.toast('Workflow chargé. Choisissez une image dans la bibliothèque pour son entrée.', 'ok', 4500);
  };
  S.collectOutputs = async id => {
    if (S.tasks.some(t => t.external === id && t.phase === 'running')) throw new Error('Attendez la fin du traitement avant de récupérer les résultats');
    const project = S.project.id;
    let outputs = await N.svcOutputs(id, 80);
    if (id === 'wallpaper' && S.project.animation) outputs = outputs.filter(it => it.path.split(/[\\/]/).includes(S.project.animation.dossier));
    const selected = new Set(), grid = h('div.suite-outputpick');
    for (const it of outputs) {
      const preview = it.video ? h('video', { src: mediaURL(it.path), preload: 'metadata', muted: true }) : h('img', { src: mediaURL(it.path), loading: 'lazy', alt: '' });
      const check = h('input', { type: 'checkbox' }); check.addEventListener('change', () => check.checked ? selected.add(it.path) : selected.delete(it.path));
      grid.append(h('label', check, preview, h('span', { text: it.name })));
    }
    if (!outputs.length) grid.append(h('p.note', { text: 'Aucun résultat disponible. Exportez une vidéo depuis Animation ou exécutez votre workflow.' }));
    const ok = await KS.modal({ title: 'Ajouter des résultats au projet', width: 760, body: grid, buttons: [{ label: 'Annuler', value: false }, { label: 'Ajouter la sélection', primary: true, value: true }] }).done;
    if (!ok) return;
    for (const path of selected) { const r = await call('import', { project, path, source: id }); adopt(r.project); }
    await S.library();
  };
  function renderLibrary(container) {
    const input = h('input.field', { placeholder: 'Rechercher un média…', value: search, 'aria-label': 'Rechercher un média' });
    const type = ui.select([['all', 'Tous les médias'], ['image', 'Images'], ['video', 'Vidéos'], ['audio', 'Audio']], filter);
    const count = ui.select(COUNTS.map(([v, l]) => [String(v), v ? l + ' affichés' : 'Tout afficher']), String(+(KS.prefs.libraryCount ?? 48)));
    count.title = 'Nombre de médias montrés à l’ouverture (les plus récents d’abord)';
    count.classList.add('suite-count');
    const grid = h('div.suite-media-grid');
    const fill = () => {
      const all = S.project.items.filter(it => (filter === 'all' || it.kind === filter) && (it.name + ' ' + titleOf(it.source)).toLowerCase().includes(search.toLowerCase()));
      const items = all.slice(0, shown());
      grid.replaceChildren();
      for (const it of items) {
        const b = h('button.suite-media' + (it.id === S.selected ? '.selected' : ''), { 'data-item': it.id, title: it.name, 'aria-pressed': String(it.id === S.selected) });
        const preview = h('div.suite-media-preview');
        if (it.kind === 'image') preview.append(h('img', { src: mediaURL(it.thumbPath || it.path), loading: 'lazy', alt: '' }));
        else if (it.kind === 'video') preview.append(h('video', { src: mediaURL(it.path), preload: 'metadata', muted: true }));
        else preview.append(h('span', { text: '♫' }));
        preview.append(h('span.suite-badge', { text: it.snapshotPath ? 'Calques' : it.kind === 'video' ? 'Vidéo' : it.kind === 'audio' ? 'Audio' : 'Image' }));
        b.append(preview, h('b', { text: it.name }), h('small', { text: titleOf(it.source) + ' · v' + it.revision }));
        b.addEventListener('click', () => { S.selected = it.id; fill(); renderDetails(detail); });
        b.addEventListener('dblclick', () => S.run('Ouverture du média', () => it.kind === 'image' ? S.open(it) : S.toVideo(it)).catch(() => {}));
        grid.append(b);
      }
      if (all.length > items.length) {
        const rest = all.length - items.length, step = Math.min(rest, +(KS.prefs.libraryCount ?? 48) || 48);
        const more = h('div.suite-more', h('span', { text: items.length + ' sur ' + all.length + ' médias' }),
          ui.btn('Afficher ' + step + ' de plus', () => { extra += step; fill(); }, '.small'),
          ui.btn('Tout afficher', () => { extra = Infinity; fill(); }, '.small'));
        grid.append(more);
      }
      if (!items.length) grid.append(h('div.suite-library-empty', h('span', { html: KS.icon('image') }), h('b', { text: S.project.items.length ? 'Aucun média correspondant' : 'Votre projet commence ici' }), h('p', { text: 'Importez une image, créez-la dans le Studio ou capturez votre document avec ses calques.' })));
    };
    input.addEventListener('input', () => { search = input.value; fill(); });
    type.addEventListener('change', () => { filter = type.value; fill(); });
    count.addEventListener('change', () => { KS.prefs.libraryCount = +count.value; KS.prefs.save(); extra = 0; fill(); });
    const detail = h('aside.suite-detail');
    container.replaceChildren(h('div.suite-library-head', h('b', { text: 'Bibliothèque du projet' }), h('span', { text: S.project.items.length + ' média(s)' }), h('div.spacer'),
      action('Importer…', () => S.import(), '.small', false, 'folder-open'), container === drawer ? ui.iconBtn('close', 'Fermer la bibliothèque', () => drawer.hidden = true) : null),
      h('div.suite-library-tools', input, type, count), h('div.suite-library-body', h('div.suite-media-scroll', grid), detail));
    fill(); renderDetails(detail);
  }
  function renderDetails(el) {
    const it = S.project.items.find(x => x.id === S.selected);
    if (!it) { el.replaceChildren(h('p.note', { text: 'Choisissez un média pour poursuivre sa création.' })); return; }
    const image = it.kind === 'image';
    el.replaceChildren(h('span.suite-eyebrow', { text: titleOf(it.source) + ' · version ' + it.revision }), h('h3', { text: it.name }),
      h('p.note', { text: (it.snapshotPath ? 'Document avec calques conservé · ' : '') + U.fmtBytes(it.size) + ' · ' + new Date(it.added).toLocaleDateString('fr-FR') }),
      action(it.snapshotPath ? 'Reprendre avec les calques' : 'Ouvrir dans Retouche', () => S.open(it), '.primary', !image, 'image'),
      action(KS.state.doc ? 'Ajouter en calque · ' + KS.state.doc.name : 'Ajouter en calque', () => S.addLayer(it), '.small', !image || !KS.state.doc, 'layers'),
      action('Animer cette image', () => S.animate(it), '', !image, 'sparkles'),
      action('Ajouter au montage', () => S.toVideo(it), '', false, 'play'),
      action('Mettre à jour un média du montage…', () => S.replaceVideo(it), '.small'),
      h('div.suite-detail-sep'),
      action('Transformer dans le Studio', () => S.toStudio(it, 'img2img'), '.small', !image),
      action('Retoucher une zone', () => S.toStudio(it, 'inpaint'), '.small', !image),
      action('Utiliser dans un workflow', () => S.toComfy(it), '.small', !image),
      action('Afficher le fichier', () => N.showInFolder(it.path), '.small'));
    if (it.parent) { const parent = S.project.items.find(x => x.id === it.parent); if (parent) el.append(action('Voir la version précédente', () => { S.selected = parent.id; render(); }, '.small')); }
    if (it.info) el.append(h('details.suite-parameters', h('summary', { text: 'Paramètres de génération' }), h('pre', { text: it.info })));
  }
  function render() {
    if (!home || !S.project) return;
    projectButton.textContent = S.project.name; projectButton.title = 'Changer de projet';
    const p = S.project;
    home.replaceChildren(h('div.suite-home-scroll', h('section.suite-hero',
      h('div', h('span.suite-eyebrow', { text: 'KANE APP · VOTRE PROJET CRÉATIF' }), h('h1', { text: p.name }), h('p', { text: 'Une illustration. Du mouvement. Un film. Gardez le fil de votre création.' })),
      h('div.suite-project-actions', action('Renommer', () => S.rename(), '.small'), action('Dossier du projet', () => N.openFolder(p.folder), '.small'))),
      h('div.suite-pipeline',
        pipeline('01', 'Créer', 'Imaginez dans le Studio IA.', 'sparkles', () => C.openStudioTab('txt2img')),
        pipeline('02', 'Retoucher', 'Composez et retouchez vos images.', 'image', () => C.toggleStudio(false)),
        pipeline('03', 'Animer', p.animation ? 'Reprenez les mouvements du projet.' : 'Donnez du mouvement à une illustration.', 'play', () => S.resumeAnimation()),
        pipeline('04', 'Monter', 'Assemblez les séquences et le son.', 'layers', () => S.openVideo())),
      list = h('section.suite-library'),
      h('footer.suite-home-footer', h('span', { text: 'Les médias importés et leurs versions sont copiés dans ce projet. Les générations du Studio y sont archivées.' }), action('Animation Vidéo · ComfyUI', () => KS.ws.go('comfyui'), '.small'))));
    if (KS.prefs.showLibrary === true) renderLibrary(list); // masquée par défaut : rien à préparer
    if (!drawer.hidden) renderLibrary(drawer);
    KS.ws?.sync(); renderTasks();
  }
  function pipeline(num, title, description, icon, fn) {
    const b = h('button.suite-step', h('span.suite-step-top', h('span', { text: num }), h('span', { html: KS.icon(icon) })), h('b', { text: title }), h('small', { text: description }));
    b.addEventListener('click', () => S.run(title, fn).catch(() => {})); return b;
  }
  S.rerender = () => { if (home && document.body.classList.contains('suite-home')) render(); };
  S.refresh = async () => { adopt(await call('get')); };
  let lastCount = KS.prefs.libraryCount;
  KS.on('prefs', () => { if (KS.prefs.libraryCount !== lastCount) { lastCount = KS.prefs.libraryCount; extra = 0; render(); } });
  KS.on('doc', d => { if (d && (document.body.classList.contains('suite-home') || KS.ws.cur)) C.toggleStudio(false); });
  KS.on('ui-ready', () => setTimeout(async () => {
    if (started) return; started = true;
    home = h('section#suite-home'); KS.$('#main').append(home);
    drawer = h('aside#suite-library-drawer', { hidden: true, 'aria-label': 'Bibliothèque du projet' }); document.body.append(drawer);
    projectButton = ui.btn('KaneApp', () => S.chooseProject(), '.suite-project-button', 'folder-open');
    taskButton = ui.btn('Activité', () => S.showTasks(), '.small.sb-activity');
    const sw = document.querySelector('.ws-switch');
    const projectTab = h('button.ws-btn', { 'data-v': 'project', text: 'Projet' }); projectTab.addEventListener('click', () => S.home()); sw.prepend(projectTab);
    document.querySelector('.ws-to-studio')?.remove();
    const captureButton = ui.btn('Capturer ▾', e => {
      const r = e.currentTarget.getBoundingClientRect(); ui.menu([
        { label: 'Document avec ses calques', disabled: !KS.state.doc, action: () => S.run('Capture du document', () => S.capture()).catch(() => {}) },
        { label: 'Sélection seule', disabled: !KS.state.doc?.selection.bounds, action: () => S.run('Capture de la sélection', () => S.capture('selection')).catch(() => {}) },
      ], r.left, r.bottom + 4);
    }, '.small.sb-capture');
    // Navigation KaneApp : panneau vertical ouvert par le bouton K de la barre de titre (à la place de l'ancienne barre horizontale).
    const pinButton = ui.btn('', () => { KS.prefs.navPinned = !KS.prefs.navPinned; KS.prefs.save(); KS.emit('prefs'); }, '.small.kn-pin');
    const brand = KS.$('#titlebar .brand');
    nav = h('aside#kane-nav', { hidden: true, 'aria-label': 'Navigation KaneApp' },
      h('div.kn-head', projectButton, pinButton),
      h('div.kn-title', { text: 'Espaces' }), sw,
      h('div.kn-title', { text: 'Projet' }),
      h('div.kn-actions', captureButton, ui.btn('Bibliothèque', () => S.library(), '.small.sb-library'), taskButton),
      h('div.kn-foot', ui.btn('Préférences', () => KS.dialogs.prefs(), '.small', 'settings')));
    document.body.append(nav);
    const pinned = () => !!KS.prefs.navPinned;
    const layoutNav = () => {
      const open = !nav.hidden;
      document.documentElement.classList.toggle('kn-pinned', open && pinned());
      brand?.classList.toggle('kn-on', open);
      pinButton.textContent = pinned() ? 'Détacher' : 'Épingler';
      pinButton.title = pinned() ? 'Le panneau se ferme après chaque choix' : 'Garder le panneau ouvert et réserver sa place';
      setTimeout(() => { window.dispatchEvent(new Event('resize')); try { KS.view.resize(); } catch { /* pas encore prêt */ } }, 0);
    };
    const setNav = open => { nav.hidden = !open; layoutNav(); };
    KS.nav = { open: () => setNav(true), close: () => setNav(false), toggle: () => setNav(nav.hidden) };
    if (brand) { brand.classList.add('kn-brand'); brand.setAttribute('role', 'button'); brand.tabIndex = 0; brand.title = 'KaneApp : espaces et navigation';
      brand.addEventListener('click', () => KS.nav.toggle());
      brand.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); KS.nav.toggle(); } }); }
    // Le panneau se ferme tout de suite (avant le travail lourd d'un espace qui se charge), puis la commande choisie est lancée à l'image suivante.
    const passing = new WeakSet();
    let menuFromNav = false;
    // Un menu ouvert depuis le panneau (clic droit sur un espace, Capturer) passe au-dessus ; le panneau se referme avec lui.
    nav.addEventListener('contextmenu', () => { menuFromNav = true; });
    KS.on('menus-closed', () => { if (menuFromNav) { menuFromNav = false; if (!pinned()) setTimeout(() => setNav(false), 0); } });
    nav.addEventListener('click', e => {
      const target = e.target.closest('.ws-btn, .kn-actions .btn, .suite-project-button');
      if (!target || pinned()) return;
      if (passing.delete(target)) return;
      // Capturer ouvre un menu placé sous le bouton : le panneau reste jusqu'à la fermeture de ce menu.
      if (target.matches('.sb-capture')) { setTimeout(() => { menuFromNav = true; }, 0); return; }
      e.stopPropagation(); e.preventDefault();
      setNav(false);
      requestAnimationFrame(() => setTimeout(() => { passing.add(target); target.click(); }, 0));
    }, true);
    document.addEventListener('pointerdown', e => { if (!nav.hidden && !pinned() && !nav.contains(e.target) && !e.target.closest('.brand, .menu, .modal-back')) setNav(false); }, true);
    KS.on('prefs', () => { if (pinned() && nav.hidden) setNav(true); else layoutNav(); });
    setNav(pinned());
    const themeObserver = new MutationObserver(() => { for (const id in KS.ws.el) KS.ws.theme(id); });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !KS.modalOpen()) { drawer.hidden = true; if (!KS.prefs.navPinned) KS.nav?.close(); } });
    drawer.addEventListener('keydown', e => { if (e.target.matches('input,select')) e.stopPropagation(); });
    try {
      const projects = await call('list'); const current = projects.find(p => p.id === KS.prefs.suiteProject) || projects[0];
      S.project = current ? await call('get', { project: current.id }) : await call('create', { name: 'KaneApp' });
      if (S.project.name === 'Mon atelier') S.project = await call('rename', { name: 'KaneApp' });
      KS.prefs.suiteProject = S.project.id; KS.prefs.save(); S.selected = S.project.items[0]?.id;
      render(); resolveReady();
      if (!KS.state.doc && !KS.studio?.on && (KS.prefs.startPage || 'project') === 'project') await S.home();
    } catch (err) { resolveReady(); KS.toast('Projet indisponible : ' + err.message, 'err', 8000); }
  }, 0));
})();

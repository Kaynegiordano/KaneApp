// Ateliers spécialisés de la suite. Le projet, les médias et les tâches sont portés par Kanevas.
'use strict';
(() => {
  const h = KS.h, ui = KS.ui, C = KS.cmd, N = KS.native;
  if (!N?.svcStatus) return;
  const WS = {
    wallpaper: { label: 'Animation', engine: 'Wallpaper Animator', icon: 'sparkles', svc: true,
      help: 'Peignez les zones, réglez leurs mouvements et créez une boucle ou un fond d’écran interactif.' },
    comfyui: { label: 'Animation Vidéo', engine: 'ComfyUI', icon: 'grid', svc: true,
      help: 'Préparez un workflow avec une image du projet, puis personnalisez son graphe dans ComfyUI.' },
    video: { label: 'Montage', engine: 'KaneClip', icon: 'play', svc: false,
      help: 'Assemblez vos images et animations avec du son, des transitions et des titres.' },
  };
  const WX = KS.ws = { cur: null, el: {}, st: {}, pending: new Map(), definitions: WS };
  const gpuState = value => { KS.animationBusy = !!value.busy; KS.emit('animation-gpu', value); if (value.error) KS.toast(value.error, 'err', 6000); };
  N.onAnimationGPU?.(gpuState);
  N.animationGPUState?.().then(gpuState).catch(() => {});
  let host;
  const up = s => s && ['ready', 'external'].includes(s.state);
  function build(id) {
    if (WX.el[id]) return WX.el[id];
    const E = WX.el[id] = { bar: h('div.wx-bar'), frameBox: h('div.wx-frame'), frame: null, ready: false };
    E.sec = h('section.wx-ws', { 'data-ws': id }, E.bar, E.frameBox); host.append(E.sec);
    renderBar(id); renderFrame(id); return E;
  }
  /* Montage : les menus de KaneClip vivent dans la barre de menus du haut de KaneApp, pas dans une seconde barre. */
  const convertMenu = nodes => nodes.map(n => n.sep ? { sep: true } : n.sub ? { label: n.label, sub: convertMenu(n.sub) }
    : { label: n.label, kb: n.kb, checked: n.checked, disabled: n.disabled, action: () => WX.request('video', 'menu-run', { path: n.path }).catch(e => KS.toast(e.message, 'err')) });
  const videoMenu = {
    labels: ['Fichier', 'Édition', 'Affichage', 'Insérer', 'Outils', 'Options', 'Aide'],
    items: async label => {
      const menu = (await WX.request('video', 'menu-tree')).find(m => m.label === label);
      const items = convertMenu(menu ? menu.items : []);
      if (label !== 'Fichier') return items;
      return [{ label: 'Ajouter le document KaneApp', disabled: !KS.state.doc, action: () => KS.suite.run('Ajout au montage', () => C.toVideo()).catch(() => {}) },
        { label: 'Bibliothèque du projet', action: () => KS.suite.library() }, { sep: true }, ...items];
    },
  };
  function renderBar(id) {
    const E = WX.el[id]; if (!E) return;
    const W = WS[id], s = WX.st[id];
    if (id === 'video') { E.bar.style.display = 'none'; return; }
    const btn = (label, fn, disabled = false) => { const b = ui.btn(label, () => KS.suite?.run(label, fn).catch(() => {}), '.small'); b.disabled = disabled; return b; };
    const subtitle = id === 'video' ? KS.suite?.project?.name || W.engine : E.title || W.engine;
    const controls = [h('div.wx-identity', h('b', { text: W.label }), h('span', { text: subtitle, title: subtitle }))];
    if (id === 'wallpaper') {
      controls.push(btn('Ouvrir une image…', () => KS.suite.importAnimation()), btn('Animer le document', () => C.toWallpaper(), !KS.state.doc),
        btn('Reprendre l’animation', () => KS.suite.resumeAnimation(), !KS.suite?.project?.animation),
        btn('Exporter le fond', () => WX.request(id, 'export'), !up(s)));
    } else if (id === 'comfyui') {
      controls.push(btn('Charger un workflow…', () => KS.suite.loadWorkflow()),
        btn('Utiliser le document', () => C.toComfy(), !KS.state.doc));
    } else controls.push(btn('Ajouter le document', () => C.toVideo(), !KS.state.doc), btn('Enregistrer le montage', () => WX.request('video', 'save')));
    const libButton = btn('Bibliothèque', () => KS.suite.library()); libButton.classList.add('sb-library');
    controls.push(h('div.spacer'), libButton);
    if (W.svc) controls.push(btn('Récupérer les résultats', () => KS.suite.collectOutputs(id)),
      ui.btn(up(s) ? 'Moteur prêt' : s?.state === 'starting' ? 'Démarrage…' : 'Moteur arrêté', e => {
        const r = e.currentTarget.getBoundingClientRect();
        ui.menu([
          { label: 'Démarrer', disabled: up(s) || s?.state === 'starting', action: () => KS.suite.run('Démarrage de ' + W.engine, () => WX.ensure(id)).catch(() => {}) },
          { label: 'Arrêter', disabled: !s?.ours, action: () => N.svcStop(id) },
          { label: 'Ouvrir le journal', action: async () => KS.modal({ title: W.engine, body: h('pre.eg-log', { text: await N.svcLog(id) || '(vide)' }), buttons: [{ label: 'Fermer', primary: true }] }) },
          { label: 'Ouvrir le dossier des résultats', action: () => N.svcOpenFolder(id) },
        ], r.left, r.bottom + 4);
      }, '.small'));
    E.bar.replaceChildren(...controls);
  }
  async function renderFrame(id) {
    const E = WX.el[id], W = WS[id], s = WX.st[id]; if (!E) return;
    if (W.svc && !up(s)) {
      if (E.frame) { E.frame.remove(); E.frame = null; E.ready = false; }
      E.frameBox.replaceChildren(h('div.wx-empty', h('div.wx-icon', { html: KS.icon(W.icon) }), h('b', { text: W.label }),
        h('p', { text: W.help }), h('p.wx-msg', { text: s?.error || (s?.state === 'starting' ? 'Préparation de l’atelier…' : 'Le moteur démarre lorsque vous en avez besoin.') }),
        s?.state === 'starting' ? h('div.spin') : ui.btn('Ouvrir l’atelier', () => KS.suite.run('Ouverture de ' + W.label, () => WX.ensure(id)).catch(() => {}), '.primary')));
      return;
    }
    if (E.frame || E.loading) return;
    E.loading = true;
    try {
      const url = id === 'video' ? await N.kcUrl() : s.url;
      const frame = h('iframe.wx-iframe', { src: url, title: W.label, allow: 'clipboard-read; clipboard-write; autoplay; fullscreen' });
      E.frame = frame; E.ready = false;
      frame.addEventListener('load', () => { E.loaded = true; setTimeout(() => WX.theme(id), 250); });
      E.frameBox.replaceChildren(frame);
    } finally { E.loading = false; }
  }
  async function refresh(id) {
    if (!WS[id].svc) return null;
    WX.st[id] = await N.svcStatus(id); renderBar(id); renderFrame(id); return WX.st[id];
  }
  N.onSvc(s => { WX.st[s.id] = s; renderBar(s.id); renderFrame(s.id); KS.emit('suite-services'); });
  WX.ensure = async id => {
    go(id);
    if (!WS[id].svc) return true;
    let s = await refresh(id); if (up(s)) return true;
    if (s.found === false) throw new Error(WS[id].engine + ' est introuvable. Installez-le depuis KaneOS.');
    if (s.state !== 'starting') { s = WX.st[id] = await N.svcStart(id); renderBar(id); renderFrame(id); }
    const until = Date.now() + 600000;
    while (!up(WX.st[id]) && Date.now() < until) {
      if (['error', 'off'].includes(WX.st[id]?.state)) throw new Error(WX.st[id].error || 'Démarrage interrompu');
      await new Promise(r => setTimeout(r, 500));
    }
    if (!up(WX.st[id])) throw new Error('Le moteur ne répond pas');
    return true;
  };
  WX.request = async (id, op, args = {}) => {
    if (!WX.el[id]?.frame) await WX.ensure(id);
    const E = WX.el[id], until = Date.now() + 25000;
    while (!E.ready && Date.now() < until) await new Promise(r => setTimeout(r, 100));
    if (!E.ready) throw new Error('L’atelier initialise son interface. Réessayez dans un instant.');
    return new Promise((resolve, reject) => {
      const key = crypto.randomUUID(), timer = setTimeout(() => { WX.pending.delete(key); reject(new Error('L’atelier ne répond pas à la commande')); }, 45000);
      WX.pending.set(key, { id, resolve, reject, timer });
      E.frame.contentWindow.postMessage({ kv: 'suite-request', id: key, op, ...args }, '*');
    });
  };
  WX.theme = id => {
    const E = WX.el[id]; if (!E?.ready || !KS.suite) return;
    WX.request(id, 'theme', KS.suite.theme(id)).catch(() => {});
  };
  function go(id) {
    if (id && !WS[id]) return;
    if (WX.cur === 'video' && id !== 'video' && WX.el.video?.ready) {
      WX.request('video', 'pause').catch(() => {});
    }
    if (id && KS.studio.on) C.toggleStudio(false);
    KS.suite?.hideHome(); WX.cur = id;
    document.body.classList.toggle('ws-ext', !!id);
    if (id) { build(id); renderFrame(id); for (const [key, E] of Object.entries(WX.el)) E.sec.hidden = key !== id; refresh(id).catch(e => KS.toast(e.message, 'err')); }
    KS.prefs.workspace = id || ''; KS.prefs.save(); sync();
    window.dispatchEvent(new Event('resize'));
  }
  WX.go = C.workspace = go;
  WX.stop = async id => {
    if (id === 'project') return;
    if (id === 'edit') {
      for (const d of KS.state.docs.slice()) if (!(await KS.closeDoc(d))) return;
      await KS.suite.home(); return;
    }
    if (id === 'studio') {
      if (KS.studioApi.isBusy()) KS.studioApi.interrupt();
      const until = Date.now() + 8000;
      while (KS.studioApi.isBusy() && Date.now() < until) await new Promise(r => setTimeout(r, 100));
      await KS.engine.refresh();
      await KS.engine.stop(true); await C.toggleStudio(false);
      await KS.suite.home(); return;
    }
    const E = WX.el[id];
    if (id === 'wallpaper' && E?.ready) await WX.request(id, 'flush');
    if (id === 'video') {
      if (E?.ready) await WX.request(id, 'stop');
      await N.kcStop();
    } else {
      const s = await N.svcStop(id, true); WX.st[id] = s;
    }
    for (const [key, pending] of WX.pending) if (pending.id === id) { clearTimeout(pending.timer); pending.reject(new Error('Application arrêtée')); WX.pending.delete(key); }
    if (E) { E.frame?.remove(); E.frame = null; E.ready = false; E.loaded = false; }
    KS.suite.event(id, { busy: false, status: 'Arrêté' });
    if (WX.cur === id) await KS.suite.home();
    sync();
  };
  WX.contextMenu = id => [
    { head: KS.appearance.labels[id] || id },
    { label: 'Ouvrir', action: () => id === 'project' ? KS.suite.home() : id === 'studio' ? C.toggleStudio(true) : id === 'edit' ? C.toggleStudio(false) : id === 'video' ? KS.suite.run('Ouverture du montage', () => KS.suite.openVideo()).catch(() => {}) : go(id) },
    { label: 'Arrêter', icon: 'close', disabled: id === 'project', action: () => KS.suite.run('Arrêt · ' + KS.appearance.labels[id], () => WX.stop(id)).catch(() => {}) },
  ];
  function sync() {
    const cur = document.body.classList.contains('suite-home') ? 'project' : WX.cur || (KS.studio.on ? 'studio' : 'edit');
    KS.appearance.activate(cur);
    KS.menus?.setExternal(cur === 'video' ? videoMenu : null);
    document.querySelectorAll('.ws-btn[data-v]').forEach(b => {
      const id = b.dataset.v;
      b.classList.toggle('on', id === cur); b.setAttribute('aria-current', id === cur ? 'page' : 'false');
      b.dataset.running = String(id === 'studio' ? KS.engine?.ready() : id === 'video' ? !!WX.el.video?.frame : !!WX.st[id] && up(WX.st[id]));
    });
    for (const id in WX.el) renderBar(id);
  }
  WX.sync = sync;
  const toggle0 = C.toggleStudio;
  C.toggleStudio = async on => {
    KS.suite?.hideHome(); WX.cur = null; document.body.classList.remove('ws-ext'); KS.prefs.workspace = '';
    const r = await toggle0(on); sync(); return r;
  };
  C.toComfy = async () => { const it = await KS.suite.capture(); if (it) await KS.suite.toComfy(it); };
  C.toWallpaper = async () => { const it = await KS.suite.capture(); if (it) await KS.suite.animate(it); };
  C.toVideo = async () => { const it = await KS.suite.capture(); if (it) await KS.suite.toVideo(it); };
  KS.on('studio', sync); KS.on('doc', sync); KS.on('suite-project', sync); KS.on('engine', sync);
  KS.on('ui-ready', () => setTimeout(() => {
    host = h('section#ws-ext'); KS.$('#main').append(host);
    const sw = document.querySelector('.ws-switch');
    sw.addEventListener('contextmenu', e => {
      const button = e.target.closest('.ws-btn[data-v]'); if (!button) return;
      e.preventDefault(); ui.menu(WX.contextMenu(button.dataset.v), e.clientX, e.clientY);
    });
    for (const [id, W] of Object.entries(WS)) {
      const b = h('button.ws-btn', { 'data-v': id, text: W.label, title: W.help });
      b.addEventListener('click', () => { if (id === 'video') KS.suite.run('Ouverture du montage', () => KS.suite.openVideo()).catch(() => {}); else go(id); }); sw.append(b);
    }
    window.addEventListener('message', async e => {
      const [id, E] = Object.entries(WX.el).find(([, x]) => e.source === x.frame?.contentWindow) || [];
      if (!id || !e.data) return;
      const expected = id === 'comfyui' ? 'http://127.0.0.1:8188' : id === 'wallpaper' ? 'http://127.0.0.1:8780' : 'null';
      if (e.origin !== expected && !(id === 'video' && e.origin === 'file://')) return;
      const m = e.data;
      if (m.kv === 'suite-native-request' && id === 'wallpaper' && m.op === 'animation-import') {
        let result;
        try { const opened = await KS.suite.run('Ouverture de l’image dans Animation', () => KS.suite.importAnimation({ name:m.name, data:m.data })); result = { ok:true, opened }; }
        catch (err) { result = { ok:false, error:err.message }; }
        if (E.frame?.contentWindow === e.source) e.source.postMessage({ kv:'suite-native-response', id:m.id, ...result }, e.origin);
        return;
      }
      if (m.kv === 'suite-native-request' && id === 'wallpaper' && m.op === 'animation-open-document') {
        let result;
        try {
          const found = await N.animationDocument(String(m.dossier || ''));
          if (!found.ok) throw new Error(found.error);
          go(null); await KS.io.openPath(found.path); result = { ok: true };
          KS.toast('Document en calques ouvert : enregistrez (Ctrl+S), puis « Recharger » dans Animation.', 'ok', 5000);
        } catch (err) { result = { ok: false, error: err.message }; }
        if (E.frame?.contentWindow === e.source) e.source.postMessage({ kv: 'suite-native-response', id: m.id, ...result }, e.origin);
        return;
      }
      if (m.kv === 'suite-native-request' && id === 'wallpaper' && m.op === 'animation-run') {
        let result;
        if (KS.studioApi.isBusy()) result = { ok: false, error: 'Le Studio génère encore une image. Attendez sa fin avant Animation.' };
        else {
          gpuState({ busy: true });
          try { result = await N.animationRun(m.dossier, m.operation, m.body); } catch (err) { result = { ok: false, error: err.message }; }
          if (!result.ok) { try { gpuState(await N.animationGPUState()); } catch { /* la réservation reste visible en cas de liaison perdue */ } }
        }
        if (!result.ok) KS.toast(result.error, 'err', 6000);
        E.frame?.contentWindow.postMessage({ kv: 'suite-native-response', id: m.id, ...result }, expected);
      } else if (m.kv === 'suite-response') {
        const p = WX.pending.get(m.id); if (!p || p.id !== id) return;
        clearTimeout(p.timer); WX.pending.delete(m.id); m.error ? p.reject(new Error(m.error)) : p.resolve(m.value);
      } else if (m.kv === 'suite-event') {
        if (m.ready) { E.ready = true; WX.theme(id); }
        if (m.dossier) { E.title = m.dossier; renderBar(id); }
        KS.suite?.event(id, m);
      } else if (m.kv === 'kc-title') { E.title = String(m.title || '').replace(/\s*[—-]\s*KaneClip\s*$/, ''); renderBar(id); }
    });
    for (const id in WS) if (WS[id].svc) N.svcStatus(id).then(s => { WX.st[id] = s; KS.emit('suite-services'); });
    sync();
  }, 0));
  KS.beforeClose = async () => {
    try { if ((await N.runtimeMigrationState?.())?.running) { KS.toast('La migration continue. Attendez sa fin avant de quitter KaneApp.', 'info', 5000); return false; } } catch { /* version sans migration */ }
    if (WX.el.video?.ready) { try { await WX.request('video', 'save'); } catch (e) { KS.toast(e.message, 'err'); return false; } }
    // Un échec d'enregistrement d'Animation ne doit jamais empêcher de quitter : on demande (1.34.1)
    if (WX.el.wallpaper?.ready) {
      try { await WX.request('wallpaper', 'flush'); } catch (e) {
        const quit = await KS.confirm(e.message + '. Quitter quand même ? Les dernières modifications des zones seront perdues.', { title: 'Animation', ok: 'Quitter sans enregistrer', danger: true });
        if (!quit) return false;
      }
    }
    // Le dialogue natif de KaneClip reste disponible pour un montage non rattaché au projet.
    const V = WX.el.video;
    if (!V?.frame) return true;
    return new Promise(resolve => {
      const timeout = setTimeout(() => { window.removeEventListener('message', on); resolve(false); }, 120000);
      const on = e => { if (e.source === V.frame.contentWindow && e.data?.kv === 'kc-close-ok') { clearTimeout(timeout); window.removeEventListener('message', on); resolve(true); } };
      window.addEventListener('message', on); V.frame.contentWindow.postMessage({ kv: 'close-request' }, '*');
    });
  };
})();

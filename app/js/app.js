// Démarrage : documents et onglets, accueil, barre d'état, glisser-déposer, fermeture.
'use strict';
(() => {
  const U = KS.util, h = KS.h, ui = KS.ui, V = KS.view, T = KS.tools;

  /* ---------------------------------------------------------------- thème */
  const CHROME = { dark: ['#16181d', '#c3cad6'], graphite: ['#323232', '#dddddd'], light: ['#f4f6f8', '#3b4552'] };
  KS.applyPrefs = () => {
    const p = KS.prefs;
    document.body.classList.remove('theme-dark', 'theme-graphite', 'theme-light');
    document.body.classList.add('theme-' + (CHROME[p.theme] ? p.theme : 'light'));
    const acc = U.parseHex(KS.appearance?.color(KS.appearance.active) || p.accent) || { r: 47, g: 111, b: 219 };
    const lighter = U.hex({ r: acc.r + (255 - acc.r) * 0.18, g: acc.g + (255 - acc.g) * 0.18, b: acc.b + (255 - acc.b) * 0.18 });
    const root = document.documentElement.style;
    root.setProperty('--accent', U.hex(acc)); root.setProperty('--accent-rgb', `${acc.r}, ${acc.g}, ${acc.b}`); root.setProperty('--accent-2', p.theme === 'light' ? U.hex({ r: acc.r * .72, g: acc.g * .72, b: acc.b * .72 }) : lighter); root.setProperty('--accent-soft', `rgba(${acc.r},${acc.g},${acc.b},${p.theme === 'light' ? '.09' : '.16'})`);
    if (!KS.native) root.setProperty('--caption-w', '12px');
    const c = CHROME[p.theme] || CHROME.light;
    if (KS.native) KS.native.setTitleBar({ color: c[0], symbolColor: c[1], height: Math.round(40 * (p.uiScale || 1)) });
    // taille de l'interface (écrans haute définition)
    if (p.uiScale === undefined) { p.uiScale = screen.width >= 2560 && (window.devicePixelRatio || 1) <= 1.25 ? 1.15 : 1; p.save(); }
    if (KS.native && KS.native.setZoom) KS.native.setZoom(p.uiScale || 1);
    V.readTheme();
    T.renderOptions && T.current && T.renderOptions();
    KS.requestRender();
    KS.appearance?.refreshTabs();
  };

  /* ---------------------------------------------------------------- documents */
  KS.addDoc = doc => {
    KS.state.docs.push(doc);
    KS.switchDoc(doc);
    return doc;
  };
  KS.switchDoc = doc => {
    KS.panels.defs.properties?.commitPending?.();
    const cur = KS.state.doc;
    if (cur === doc && doc) return;
    if (T.current && T.current.commitOnLeave && cur) T.current.commitOnLeave(cur);
    if (T.current && T.current.cancel && cur) T.current.cancel(cur);
    KS.state.doc = doc || null;
    KS.$('#home').hidden = !!doc;
    if (doc) { if (!doc.view.init) V.fit(doc); V.sync(); }
    if (T.current && T.current.activate) T.current.activate(doc);
    renderTabs(); updateTitle();
    KS.emit('doc', doc); KS.emit('layers', doc); KS.emit('history', doc); KS.emit('selection', doc);
    T.renderOptions();
    KS.requestRender();
  };
  KS.closeDoc = async doc => {
    KS.panels.defs.properties?.commitPending?.();
    if (doc.dirty) {
      const r = await KS.confirm(`Enregistrer les modifications de « ${doc.name} » avant de fermer ?`, { ok: 'Enregistrer', cancel: 'Annuler', third: 'Ne pas enregistrer' });
      if (r === false) return false;
      if (r === true) { if (KS.state.doc !== doc) KS.switchDoc(doc); if (!(await KS.io.save(doc))) return false; }
    }
    if (KS.recovery) await KS.recovery.forget(doc);
    if (doc === KS.state.doc && T.current?.cancel) T.current.cancel(doc);
    const i = KS.state.docs.indexOf(doc);
    KS.state.docs.splice(i, 1);
    if (KS.state.doc === doc) { KS.state.doc = null; KS.switchDoc(KS.state.docs[Math.min(i, KS.state.docs.length - 1)] || null); }
    else renderTabs();
    if (!KS.state.docs.length) renderHome();
    return true;
  };

  function renderTabs() {
    const bar = KS.$('#tabs');
    bar.innerHTML = '';
    for (const d of KS.state.docs) {
      const t = h('div.tab' + (d === KS.state.doc ? '.active' : ''), { title: d.path || d.name },
        h('span.name', { text: d.name }), h('span', { text: `@ ${Math.round((d === KS.state.doc ? V.zoom : d.view.zoom) * 100)} %`, style: { color: 'var(--muted)', fontSize: '11px' } }));
      if (d.dirty) t.appendChild(h('span.dirty', { title: 'Modifications non enregistrées' }));
      const x = h('button.close', { html: KS.icon('close'), 'aria-label': 'Fermer' });
      x.addEventListener('click', e => { e.stopPropagation(); KS.closeDoc(d); });
      t.appendChild(x);
      t.addEventListener('pointerdown', e => { if (e.button === 1) { e.preventDefault(); KS.closeDoc(d); } else if (!e.target.closest('.close')) KS.switchDoc(d); });
      bar.appendChild(t);
    }
    const plus = ui.iconBtn('plus', 'Nouveau document (Ctrl+N)', () => KS.cmd.newDoc(), '.sm');
    plus.style.margin = '0 0 3px 4px';
    bar.appendChild(plus);
  }
  KS.renderTabs = renderTabs;
  function updateTitle() {
    const d = KS.state.doc;
    const t = d ? `${d.name}${d.dirty ? ' •' : ''} — KaneApp` : 'KaneApp';
    document.title = t;
    if (KS.native) KS.native.setTitle(t);
    KS.$('#doc-title').textContent = d ? `${d.name} @ ${Math.round(V.zoom * 100)} % (${d.active ? d.active.name : '—'}, RVB/8)${d.dirty ? ' •' : ''}` : '';
  }
  const titleSoon = U.throttle(() => { updateTitle(); renderTabs(); }, 250);
  KS.on('history', titleSoon); KS.on('doc-meta', titleSoon); KS.on('view', titleSoon); KS.on('active-layer', titleSoon); KS.on('layers', titleSoon);

  /* ---------------------------------------------------------------- accueil */
  function renderHome() {
    const home = KS.$('#home');
    home.hidden = !!KS.state.doc;
    home.innerHTML = '';
    const inner = h('div.home-inner');
    inner.appendChild(h('div.home-hero', h('span.brand-mark'), h('div', h('h1', { text: 'KaneApp' }), h('p', { text: 'Retouche, peinture, montage : tout est prêt. Glissez une image ici pour commencer.' }))));
    inner.appendChild(h('div.home-actions',
      ui.btn('Nouveau fichier', () => KS.cmd.newDoc(), '.primary.big', 'file-plus'),
      ui.btn('Ouvrir…', () => KS.cmd.open(), '.big', 'folder-open'),
      ui.btn('Depuis le presse-papiers', () => KS.cmd.newFromClipboard(), '.big', 'paste')));
    const grid = h('div.preset-grid');
    if (KS.prefs.showQuickStart !== false) inner.appendChild(h('h2', { text: 'Démarrer rapidement' }));
    for (const p of KS.dialogs.PRESETS.filter(p => p.w).slice(0, 10)) {
      const s = Math.min(70 / p.w, 54 / p.h);
      const card = h('div.preset', h('div.shape', h('i', { style: { width: p.w * s + 'px', height: p.h * s + 'px' } })), h('div.t', { text: p.t }), h('div.s', { text: p.s + ' px' }));
      card.addEventListener('click', () => KS.addDoc(KS.createDoc({ name: 'Sans titre ' + (KS.state.docs.length + 1), width: p.w, height: p.h, background: 'white' })));
      grid.appendChild(card);
    }
    if (KS.prefs.showQuickStart !== false) inner.appendChild(grid);
    const rec = (KS.prefs.recent || []).slice(0, +(KS.prefs.recentCount ?? 16) || 16);
    const showRecent = KS.prefs.showRecent !== false;
    if (rec.length && KS.native) {
      const toggle = ui.btn(showRecent ? 'Masquer' : 'Afficher', () => { KS.prefs.showRecent = !showRecent; KS.prefs.save(); renderHome(); }, '.small', showRecent ? 'eye-off' : 'eye');
      inner.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' } }, h('h2', { text: 'Récents' }), toggle));
    }
    if (rec.length && KS.native && showRecent) {
      const list = h('div.recent-list');
      for (const r of rec) {
        const thumb = r.thumb ? h('img', { src: r.thumb, style: { width: '44px', height: '44px', objectFit: 'cover', borderRadius: '6px', flexShrink: '0' } }) : h('span', { html: KS.icon('image') });
        const x = ui.iconBtn('close', 'Retirer de la liste', e => { e.stopPropagation(); KS.io.forgetRecent(r.path); }, '.sm.x');
        const it = h('div.recent', thumb, h('div', { style: { minWidth: '0' } }, h('div.n', { text: r.name }), h('div.p', { text: (r.w ? `${r.w} × ${r.h} — ` : '') + r.path })), x);
        it.addEventListener('click', () => KS.io.openPath(r.path));
        list.appendChild(it);
      }
      inner.appendChild(list);
    }
    if (KS.prefs.showDropHint !== false) inner.appendChild(h('div.drop-hint', { html: KS.icon('import', 'style="width:28px;height:28px;display:block;margin:0 auto 8px"') }, h('div', { text: 'Déposez des images, des PSD ou des fichiers .ksp n\'importe où dans la fenêtre' })));
    home.appendChild(inner);
  }
  KS.on('recent', () => { if (!KS.state.doc) renderHome(); });
  KS.on('prefs', () => { if (!KS.state.doc) renderHome(); });

  /* ---------------------------------------------------------------- barre d'état */
  function buildStatus() {
    const bar = KS.$('#statusbar');
    const zoom = h('input.zoom-field', { type: 'text', value: '100 %' });
    zoom.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { const v = parseFloat(zoom.value); if (v > 0 && KS.state.doc) V.setZoom(v / 100); zoom.blur(); } });
    const size = h('span'), pos = h('span'), col = h('span'), sel = h('span'), hint = h('span.hint');
    const recovery = h('button', { type: 'button', style: { background: 'transparent', border: '0', padding: '0', fontSize: '11px', color: 'var(--muted)', whiteSpace: 'nowrap' }, title: 'Copies de récupération', text: 'Secours automatique' });
    recovery.addEventListener('click', () => KS.recovery.show());
    KS.on('recovery-status', s => {
      const labels = { waiting: 'Secours automatique', saving: 'Copie de secours…', saved: 'Secours : ' + (s.savedAt ? new Date(s.savedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'prêt'), error: 'Échec de la copie de secours', disabled: 'Secours désactivé', unavailable: 'Secours : application de bureau' };
      recovery.textContent = labels[s.phase]; recovery.style.color = s.phase === 'error' ? 'var(--danger)' : 'var(--muted)';
    });
    bar.append(zoom, size, pos, col, sel, recovery, hint);
    const upd = () => {
      const d = KS.state.doc;
      if (document.activeElement !== zoom) zoom.value = d ? Math.round(V.zoom * 1000) / 10 + ' %' : '—';
      size.textContent = d ? `${d.width} × ${d.height} px` : '';
      const b = d?.selection.bounds; sel.textContent = b ? `Sélection : ${b.w} × ${b.h}` : '';
      hint.textContent = hintFor(T.current);
    };
    KS.on('view', upd); KS.on('doc', upd); KS.on('selection', upd); KS.on('tool', upd); KS.on('docsize', upd); KS.on('history', upd);
    KS.on('mouse', U.throttle(ev => {
      const d = KS.state.doc;
      if (!d || !ev) { pos.textContent = ''; col.innerHTML = ''; return; }
      pos.textContent = `X ${Math.floor(ev.x)}  Y ${Math.floor(ev.y)}`;
      const c = ev.x >= 0 && ev.y >= 0 && ev.x < d.width && ev.y < d.height ? d.sample(ev.x, ev.y, 1) : null;
      col.innerHTML = '';
      if (c) col.append(h('span.st-color', { style: { background: U.hex(c) } }), U.hex(c).toUpperCase());
    }, 50));
    upd();
  }
  const HINTS = {
    move: 'Glisser pour déplacer · Alt : dupliquer · Maj : contraindre · flèches : décaler',
    'marquee-rect': 'Maj : ajouter · Alt : soustraire · glisser dans la sélection pour la déplacer',
    'marquee-ellipse': 'Maj : cercle / ajouter · Alt : depuis le centre / soustraire',
    lasso: 'Tracer à main levée · Maj : ajouter · Alt : soustraire',
    'lasso-poly': 'Clic : sommet · double-clic ou Entrée : fermer · Retour arr. : annuler le sommet',
    'lasso-magnetic': 'Clic puis suivre le contour · clic : point d\'ancrage · double-clic ou Entrée : fermer · Retour arr. : annuler le point',
    wand: 'Clic : sélectionner les couleurs proches · Maj : ajouter · Alt : soustraire',
    'quick-select': 'Peindre sur l\'objet · Alt : retirer · [ ] : taille',
    crop: 'Ajuster le cadre puis Entrée · Maj : garder les proportions',
    brush: 'Alt+clic : pipette · Ctrl+Alt+clic droit glissé : opacité / flux · 4 puis 5 : 45 % · Maj+clic : ligne droite',
    pencil: 'Alt+clic : pipette · Maj+Alt+clic droit : couleur · Maj+clic : ligne droite',
    eraser: '[ ] : taille · Maj+clic : ligne droite',
    clone: 'Alt+clic : définir la source, puis peindre',
    patch: 'Entourer la zone, puis la faire glisser · Source : réparée depuis l\'endroit d\'arrivée · Destination : recopiée',
    heal: 'Alt+clic : définir la source, puis peindre',
    'heal-spot': 'Peindre sur le défaut à corriger',
    gradient: 'Glisser pour tracer · Maj : angles de 45°',
    text: 'Clic : nouveau texte · clic sur un texte : le modifier · Ctrl+Entrée : valider · Échap : annuler',
    transform: 'Coins : échelle (Maj : libre, Alt : depuis le centre) · hors du cadre : rotation · Entrée : valider · Échap : annuler',
    hand: 'Glisser pour faire défiler · double-clic : taille écran · H maintenu + clic : vue d’ensemble',
    zoom: 'Clic : zoom avant · Alt+clic : zoom arrière · glisser : zoom continu',
    eyedropper: 'Clic : premier plan · Alt+clic : arrière-plan',
  };
  const hintFor = t => t && KS.tools.brushGesture?.sizeable(t) ? (KS.tools.brushGesture.altLeft(t) ? 'Alt + clic glissé' : 'Alt + clic droit glissé') + ' : taille / dureté · ' + (HINTS[t.id] || '') : t ? (HINTS[t.id] || (t.id.startsWith('shape') ? 'Maj : proportions · Alt : depuis le centre' : '')) : '';

  /* ---------------------------------------------------------------- actions de la barre de titre */
  function buildTitleActions() {
    const box = KS.$('#workspace-actions');
    const theme = ui.iconBtn(KS.prefs.theme === 'light' ? 'moon' : 'sun', 'Thème clair / sombre', () => {
      KS.prefs.theme = KS.prefs.theme === 'light' ? 'dark' : 'light'; KS.prefs.save(); KS.applyPrefs();
      theme.innerHTML = KS.icon(KS.prefs.theme === 'light' ? 'moon' : 'sun');
    }, '.sm');
    const enhance = ui.iconBtn('sparkles', 'Amélioration rapide (Ctrl+Maj+Q) : 20 % de ton, contraste et couleur automatiques, plus un peu de vibrance, de clarté et de netteté', () => KS.cmd.quickEnhance(), '.sm');
    enhance.classList.add('ws-enhance');
    box.append(enhance,
      ui.iconBtn('undo', 'Annuler (Ctrl+Z)', () => KS.cmd.undo(), '.sm'), ui.iconBtn('redo', 'Rétablir (Ctrl+Maj+Z)', () => KS.cmd.redo(), '.sm'),
      ui.iconBtn('keyboard', 'Raccourcis clavier (F1)', () => KS.dialogs.shortcuts(), '.sm'), theme,
      ui.iconBtn('settings', 'Préférences (Ctrl+K)', () => KS.dialogs.prefs(), '.sm'));
  }

  /* ---------------------------------------------------------------- glisser-déposer */
  function attachDrop() {
    let depth = 0;
    let expiry;
    const vp = KS.$('#viewport');
    const resetDrop = () => { depth = 0; clearTimeout(expiry); vp.classList.remove('drop-active'); };
    KS.resetDrop = resetDrop;
    const touchDrop = () => { clearTimeout(expiry); expiry = setTimeout(resetDrop, 1200); };
    window.addEventListener('dragenter', e => { if (![...(e.dataTransfer?.types || [])].includes('Files')) return; e.preventDefault(); depth++; if (!KS.studio?.on && !KS.ws?.cur) vp.classList.add('drop-active'); touchDrop(); });
    window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) vp.classList.remove('drop-active'); });
    window.addEventListener('dragover', e => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; touchDrop(); });
    // Un dépôt traité par un atelier ne remonte pas jusqu’au gestionnaire global.
    window.addEventListener('drop', resetDrop, true);
    for (const event of ['dragend', 'blur', 'pointerdown', 'keydown']) window.addEventListener(event, resetDrop, true);
    document.addEventListener('visibilitychange', resetDrop);
    window.addEventListener('drop', async e => {
      e.preventDefault(); resetDrop();
      if (KS.ws?.cur === 'wallpaper') {
        const file = [...e.dataTransfer.files].find(f => f.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif|avif)$/i.test(f.name));
        if (file) await KS.suite.run('Ouverture de l’image dans Animation', async () => KS.suite.importAnimation({name:file.name,data:new Uint8Array(await file.arrayBuffer())})).catch(() => {});
        return;
      }
      if (KS.studio?.on) return;
      const files = [...e.dataTransfer.files];
      const d = KS.state.doc;
      const onCanvas = d && e.target.closest && e.target.closest('#viewport');
      for (const f of files) {
        if (onCanvas && !/\.(ksp)$/i.test(f.name)) {
          try {
            const c = await KS.io.canvasFromEntry({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
            const p = V.toDoc(e.clientX - V.canvas.getBoundingClientRect().left, e.clientY - V.canvas.getBoundingClientRect().top);
            const inside = p.x >= 0 && p.y >= 0 && p.x <= d.width && p.y <= d.height;
            KS.io.placeCanvas(d, c, f.name.replace(/\.[^.]+$/, ''), inside && c.width <= d.width && c.height <= d.height ? { x: Math.round(p.x - c.width / 2), y: Math.round(p.y - c.height / 2) } : null);
          } catch (err) { KS.toast('Fichier illisible : ' + f.name, 'err'); }
        } else await KS.io.openFile(f);
      }
    });
  }

  /* ---------------------------------------------------------------- fermeture de la fenêtre */
  async function onCloseRequest() {
    KS.panels.defs.properties?.commitPending?.();
    for (const d of KS.state.docs.slice()) {
      if (!d.dirty) continue;
      KS.switchDoc(d);
      if (!(await KS.closeDoc(d))) return;
    }
    if (KS.beforeClose && !(await KS.beforeClose())) return;     // espaces intégrés (montage non enregistré…)
    for (const d of KS.state.docs.slice()) await KS.recovery.forget(d);
    KS.prefs.save();
    KS.native.confirmClose();
  }

  /* ---------------------------------------------------------------- démarrage */
  function init() {
    if (KS.prefs.theme === undefined) KS.prefs.theme = 'light';
    KS.applyPrefs();
    V.init();
    if (KS.prefs.rulers) V.setRulers(true);
    T.attach();
    KS.menus.build();
    KS.menus.attach();
    KS.panels.build();
    buildTitleActions();
    KS.emit('ui-ready');
    buildStatus();
    attachDrop();
    T.groupCurrent = KS.prefs.groupCurrent || {};
    const start = T.byId[KS.prefs.lastTool] && !T.byId[KS.prefs.lastTool].hidden ? KS.prefs.lastTool : 'brush';
    T.select(start, { silent: true });
    KS.on('tool', () => { KS.prefs.groupCurrent = T.groupCurrent; KS.prefs.save(); });
    renderTabs(); renderHome(); updateTitle();
    // les modifications marquent le document
    KS.on('history', d => { if (d) titleSoon(); });
    if (KS.native) {
      KS.native.onCloseRequest(onCloseRequest);
      // Ouvertures dans l'ordre d'arrivée ; « Envoyer vers le Studio » (Kane Explorer) attend que l'image soit ouverte
      let opening = Promise.resolve();
      const queue = fn => { opening = opening.then(fn).catch(() => {}); };
      KS.native.onOpenPath(p => queue(() => KS.io.openPath(p)));
      if (KS.native.onOpenStudio) KS.native.onOpenStudio(t => queue(() => KS.cmd.sendToStudio(t)));
      KS.native.getPending().then(list => {
        list.forEach(p => queue(() => KS.io.openPath(p)));
        if (list.length && KS.native.getPendingStudio) KS.native.getPendingStudio().then(t => { if (t) queue(() => KS.cmd.sendToStudio(t)); });
      });
    } else {
      window.addEventListener('beforeunload', e => { if (KS.state.docs.some(d => d.dirty)) { e.preventDefault(); e.returnValue = ''; } });
    }
    KS.recovery.init();
    window.addEventListener('resize', () => KS.requestRender());
    KS.requestRender();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();


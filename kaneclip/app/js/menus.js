// Barre de menus, barre d'outils et raccourcis clavier (inspirés de Vegas Pro).
'use strict';
(() => {
  const h = KC.h, U = KC.util, P = KC.P, E = KC.engine, C = KC.cmd;

  const ripName = { off: 'Désactivée', tracks: 'Pistes concernées', all: 'Toutes les pistes et marqueurs' };
  const setPref = (k, v) => { KC.prefs[k] = v; KC.prefs.save(); KC.emit('prefs'); updateToolbar(); };
  C.toggleSnap = () => { setPref('snap', !KC.prefs.snap); KC.toast('Magnétisme ' + (KC.prefs.snap ? 'activé' : 'désactivé'), 'info', 1100); };
  C.toggleXfade = () => { setPref('autoCrossfade', !KC.prefs.autoCrossfade); KC.toast('Fondus enchaînés automatiques ' + (KC.prefs.autoCrossfade ? 'activés' : 'désactivés'), 'info', 1300); };
  C.toggleGroups = () => { setPref('ignoreGroups', !KC.prefs.ignoreGroups); KC.toast('Groupement ' + (KC.prefs.ignoreGroups ? 'ignoré' : 'actif'), 'info', 1100); };
  C.toggleRipple = () => { setPref('ripple', KC.prefs.ripple === 'off' ? 'tracks' : 'off'); KC.toast('Ondulation automatique : ' + ripName[KC.prefs.ripple], 'info', 1300); };
  C.setTool = (t) => { KC.timeline.tool = t; updateToolbar(); };

  const MENUS = () => [
    ['Fichier', [
      { label: 'Nouveau', icon: 'new', key: 'Ctrl+N', action: C.newProject },
      { label: 'Ouvrir…', icon: 'open', key: 'Ctrl+O', action: () => C.openProject() },
      { label: 'Projets récents', sub: () => KC.prefs.recent.length ? KC.prefs.recent.map(p => ({ label: U.base(p), action: () => C.openProject(p) })).concat(['-', { label: 'Effacer la liste', action: () => { KC.prefs.recent = []; KC.prefs.save(); } }]) : [{ label: 'Aucun projet récent', disabled: true }] },
      { label: 'Enregistrer', icon: 'save', key: 'Ctrl+S', action: () => C.saveProject() },
      { label: 'Enregistrer sous…', key: 'Ctrl+Maj+S', action: () => C.saveProject(true) },
      '-',
      { label: 'Importer des médias…', icon: 'import', key: 'Ctrl+I', action: C.importMedia },
      { label: 'Rendre en tant que…', icon: 'render', key: 'Ctrl+M', action: C.render },
      '-',
      { label: 'Propriétés du projet…', icon: 'props', key: 'Alt+Entrée', action: () => KC.dialogs.projectProps() },
      '-',
      { label: 'Quitter', action: () => window.close() },
    ]],
    ['Édition', [
      { label: 'Annuler', icon: 'undo', key: 'Ctrl+Z', disabled: () => !KC.history.undo.length, action: KC.undo },
      { label: 'Rétablir', icon: 'redo', key: 'Ctrl+Y', disabled: () => !KC.history.redo.length, action: KC.redo },
      '-',
      { label: 'Couper', icon: 'cut', key: 'Ctrl+X', action: C.cut },
      { label: 'Copier', icon: 'copy', key: 'Ctrl+C', action: C.copy },
      { label: 'Coller', icon: 'paste', key: 'Ctrl+V', disabled: () => !KC.clipboard, action: () => C.paste() },
      { label: 'Supprimer', icon: 'trash', key: 'Suppr', action: C.deleteSel },
      { label: 'Tout sélectionner', key: 'Ctrl+A', action: C.selectAll },
      '-',
      { label: 'Diviser', icon: 'split', key: 'S', action: C.split },
      { label: 'Découper à la sélection temporelle', icon: 'trim', key: 'Ctrl+T', action: C.trimToSelection },
      { label: 'Lever la plage (laisser un vide)', key: ';', action: C.liftRange },
      { label: 'Extraire la plage et refermer', key: "'", action: C.extractRange },
      { label: 'Grouper', icon: 'group', key: 'G', action: C.group },
      { label: 'Dissocier', icon: 'ungroup', key: 'U', action: C.ungroup },
      '-',
      { label: 'Aller à…', key: 'Ctrl+G', action: C.goTo },
      { label: 'Vitesse de lecture', icon: 'speed', sub: [0.25, 0.5, 0.75, 1, 1.5, 2, 4].map(s => ({ label: Math.round(s * 100) + ' %', action: () => C.setSpeed(s) })) },
    ]],
    ['Affichage', [
      { label: 'Thème sombre', checked: () => KC.prefs.theme === 'dark', action: () => C.setTheme('dark') },
      { label: 'Thème graphite', checked: () => KC.prefs.theme === 'graphite', action: () => C.setTheme('graphite') },
      { label: 'Thème clair', checked: () => KC.prefs.theme === 'light', action: () => C.setTheme('light') },
      '-',
      { label: 'Dispositions de fenêtres', sub: () => KC.workspace.menu() },
      { label: 'Propriétés de la sélection', checked: () => KC.prefs.inspector, action: () => KC.workspace.toggleInspector() },
      { label: 'Agrandir la timeline', key: 'Ctrl+Maj+F11', checked: () => KC.workspace.focused, action: () => KC.workspace.toggleTimeline() },
      '-',
      { label: 'Médias du projet', icon: 'film', action: () => KC.dock.show('media') },
      { label: 'Explorateur', icon: 'folder', action: () => KC.dock.show('explorer') },
      { label: 'Transitions', icon: 'transition', action: () => KC.dock.show('transitions') },
      { label: 'Effets', icon: 'fx', action: () => KC.dock.show('fx') },
      { label: 'Générateurs de médias', icon: 'text', action: () => KC.dock.show('generators') },
      { label: 'Découpage', icon: 'trim', action: () => KC.dock.show('trimmer') },
      { label: 'Liste des marqueurs', icon: 'marker', action: () => KC.dock.show('markers') },
      { label: 'Atelier créatif', icon: 'wand', action: () => KC.workspace.activate('creative') },
      { label: 'Sous-titres', icon: 'text', action: () => KC.workspace.activate('captions') },
      '-',
      { label: 'Zoom avant', icon: 'zoom-in', key: '↑', action: () => KC.timeline.setZoom(KC.project.view.zoom * 1.5) },
      { label: 'Zoom arrière', icon: 'zoom-out', key: '↓', action: () => KC.timeline.setZoom(KC.project.view.zoom / 1.5) },
      { label: 'Afficher tout le projet', icon: 'fit', key: 'Ctrl+Maj+F', action: () => KC.timeline.fit() },
      '-',
      { label: 'Aperçu plein écran', icon: 'fullscreen', key: 'Alt+Maj+4', action: C.previewFullscreen },
      { label: 'Plein écran', key: 'F11', action: () => KC.native.toggleFullscreen() },
    ]],
    ['Insérer', [
      { label: 'Piste vidéo', icon: 'video', key: 'Ctrl+Maj+Q', action: C.addVideoTrack },
      { label: 'Piste audio', icon: 'audio', key: 'Ctrl+Q', action: C.addAudioTrack },
      '-',
      { label: 'Titre / texte', icon: 'text', key: 'Ctrl+Maj+T', action: () => C.insertGenerator('text') },
      { label: 'Bandeau (tiers inférieur)', icon: 'text', action: () => C.insertGenerator('lower') },
      { label: 'Couleur unie', icon: 'solid', action: () => C.insertGenerator('solid') },
      { label: 'Dégradé', icon: 'gradient', action: () => C.insertGenerator('gradient') },
      { label: 'Damier', icon: 'checker', action: () => C.insertGenerator('checker') },
      '-',
      { label: 'Marqueur', icon: 'marker', key: 'M', action: C.addMarker },
      { label: 'Médias…', icon: 'import', key: 'Ctrl+I', action: C.importMedia },
    ]],
    ['Outils', [
      { label: 'Actions rapides…', key: 'Ctrl+K', action: () => C.quickActions() },
      { label: 'Importer des sous-titres SRT…', icon: 'text', action: () => KC.captions.import() },
      { label: 'Exporter les sous-titres SRT…', icon: 'export', action: () => KC.captions.export() },
      '-',
      { label: 'Panoramique/Recadrage de l\'événement…', icon: 'pancrop', action: () => { const e = sel1('video'); if (e) KC.windows.panCrop(e); } },
      { label: 'Transformer plusieurs événements…', icon: 'pancrop', key: 'Ctrl+Maj+G', action: () => KC.dialogs.batchTransform() },
      { label: 'Effets d\'événement vidéo…', icon: 'fx', action: () => { const e = sel1('video'); if (e) KC.windows.eventFx(e); } },
      { label: 'Effets de piste audio…', icon: 'fx', action: () => { const t = KC.sel.track && P.track(KC.sel.track); if (t && t.kind === 'audio') KC.windows.trackFx(t); else KC.toast('Sélectionnez une piste audio', 'info'); } },
      { label: 'Propriétés de l\'événement…', icon: 'props', action: () => { const e = sel1(); if (e) KC.dialogs.eventProps(e); } },
      '-',
      { label: 'Agrandir avec l\'IA (Real-ESRGAN)…', icon: 'wand', action: () => C.aiUpscale() },
      { label: 'Couper les passages figés…', icon: 'cut', action: () => C.cutFreezes() },
      { label: 'Normaliser l\'audio', icon: 'normalize', action: C.normalize },
      { label: 'Rendre muet / audible', icon: 'mute', action: C.toggleMuteSel },
      { label: 'Créer des proxys pour tous les médias vidéo', icon: 'bolt', action: () => KC.project.media.filter(m => m.kind === 'video').forEach(m => KC.media.makeProxy(m)) },
      { label: 'Supprimer les médias inutilisés', icon: 'trash', action: () => KC.media.removeUnused() },
      '-',
      { label: 'Copier le cliché', icon: 'clipboard', action: C.snapshotCopy },
      { label: 'Enregistrer le cliché…', icon: 'camera', action: C.snapshotSave },
    ]],
    ['Options', [
      { label: 'Magnétisme', key: 'F8', checked: () => KC.prefs.snap, action: C.toggleSnap },
      { label: 'Fondu enchaîné automatique', checked: () => KC.prefs.autoCrossfade, action: C.toggleXfade },
      { label: 'Ignorer le groupement des événements', key: 'Ctrl+Maj+U', checked: () => KC.prefs.ignoreGroups, action: C.toggleGroups },
      { label: 'Ondulation automatique', sub: () => Object.entries(ripName).map(([k, l]) => ({ label: l, checked: KC.prefs.ripple === k, action: () => setPref('ripple', k) })) },
      { label: 'Lecture en boucle', key: 'Q', checked: () => KC.prefs.loop, action: C.toggleLoop },
      { label: 'Suivre le curseur pendant la lecture', checked: () => KC.prefs.followCursor, action: () => setPref('followCursor', !KC.prefs.followCursor) },
      '-',
      { label: 'Préférences…', icon: 'settings', action: () => KC.dialogs.prefs() },
    ]],
    ['Aide', [
      { label: 'Raccourcis clavier', icon: 'keyboard', key: 'F1', action: () => KC.dialogs.shortcuts() },
      { label: 'Rechercher des mises à jour…', icon: 'refresh', action: () => C.checkUpdates && C.checkUpdates() },
      { label: 'Outils de développement', key: 'F12', action: () => KC.native.toggleDevTools() },
      '-',
      { label: 'À propos de KaneClip', icon: 'info', action: () => KC.dialogs.about() },
    ]],
  ];
  const sel1 = (kind) => { const s = KC.sel.list().filter(e => !kind || P.kindOf(e) === kind); if (!s.length) { KC.toast('Sélectionnez un événement' + (kind === 'video' ? ' vidéo' : ''), 'info'); return null; } return s[0]; };

  C.goTo = async () => {
    const v = await KC.prompt('Aller à', 'Temps (ex. 00:01:30;12, 1:30, 90 ou 300f)', U.fmtTime(E.time, P.fps()));
    if (v == null) return;
    const t = U.parseTime(v, P.fps());
    if (t == null) KC.toast('Temps non reconnu', 'err'); else E.seek(t);
  };
  C.setTheme = (t) => { KC.prefs.theme = t; KC.prefs.save(); KC.applyTheme(); };

  function buildMenubar() {
    const bar = KC.$('#menubar');
    bar.innerHTML = '';
    let openIdx = -1;
    MENUS().forEach(([label], i) => {
      const el = h('div.mb', { text: label });
      const open = () => {
        const r = el.getBoundingClientRect();
        KC.menu.open(MENUS()[i][1], r.left, r.bottom + 2);
        KC.$$('.mb', bar).forEach(x => x.classList.remove('open')); el.classList.add('open');
        openIdx = i;
      };
      el.addEventListener('mousedown', e => { e.preventDefault(); if (openIdx === i && KC.menu.isOpen()) { KC.menu.close(); return; } open(); });
      el.addEventListener('mouseenter', () => { if (KC.menu.isOpen() && openIdx !== i) open(); });
      bar.appendChild(el);
    });
    KC.on('menu-closed', () => { openIdx = -1; KC.$$('.mb', bar).forEach(x => x.classList.remove('open')); });
  }

  /* ------------------------------------------------------------ barre d'outils */
  const TB = {};
  function buildToolbar() {
    const t = KC.$('#toolbar');
    t.innerHTML = '';
    let target = t;
    const b = (id, icon, title, fn) => { const x = h('button.tb', { title, 'aria-label': title, html: KC.icon(icon) }); x.addEventListener('click', fn); target.appendChild(x); if (id) TB[id] = x; return x; };
    const sep = () => target.appendChild(h('div.tb-sep'));
    b(null, 'new', 'Nouveau projet (Ctrl+N)', C.newProject);
    b(null, 'open', 'Ouvrir un projet (Ctrl+O)', () => C.openProject());
    b('save', 'save', 'Enregistrer (Ctrl+S)', () => C.saveProject());
    sep();
    b(null, 'import', 'Importer des médias (Ctrl+I)', C.importMedia);
    b(null, 'props', 'Propriétés du projet (Alt+Entrée)', () => KC.dialogs.projectProps());
    sep();
    b('undo', 'undo', 'Annuler (Ctrl+Z)', KC.undo);
    b('redo', 'redo', 'Rétablir (Ctrl+Y)', KC.redo);
    sep();
    b(null, 'cut', 'Couper (Ctrl+X)', C.cut);
    b(null, 'copy', 'Copier (Ctrl+C)', C.copy);
    b(null, 'paste', 'Coller (Ctrl+V)', () => C.paste());
    b(null, 'trash', 'Supprimer (Suppr)', C.deleteSel);
    target = KC.$('#timeline-tools');
    target.replaceChildren(h('span.timeline-label', { text: 'Montage' }));
    b(null, 'split', 'Diviser au curseur (S)', C.split);
    b(null, 'trim', 'Découper à la sélection temporelle (Ctrl+T)', C.trimToSelection);
    sep();
    b('toolEdit', 'cursor', 'Outil Édition normale', () => C.setTool('edit'));
    b('toolRazor', 'cut', 'Outil Rasoir (C) · couper au clic', () => C.setTool('razor'));
    b('toolSelect', 'select', 'Outil Sélection (rectangle)', () => C.setTool('select'));
    sep();
    b('snap', 'magnet', 'Magnétisme (F8)', C.toggleSnap);
    b('xfade', 'crossfade', 'Fondu enchaîné automatique', C.toggleXfade);
    b('ripple', 'ripple', 'Ondulation automatique (Ctrl+L)', C.toggleRipple);
    b('groups', 'ungroup', 'Ignorer le groupement (Ctrl+Maj+U)', C.toggleGroups);
    sep();
    b(null, 'marker', 'Insérer un marqueur (M)', C.addMarker);
    b(null, 'ripple', 'Extraire la plage et refermer (apostrophe)', C.extractRange);
    b(null, 'text', 'Insérer un texte (Ctrl+Maj+T)', () => C.insertGenerator('text'));
    target.append(h('span.tb-flex'), h('span#timeline-summary'));
    const focus = b(null, 'fit', 'Agrandir / rétablir la timeline (Ctrl+Maj+F11)', () => KC.workspace.toggleTimeline());
    focus.id = 'timeline-focus';
    t.append(h('div.tb-flex'), h('div#workspace-controls'));
    const r = h('button.tb-btn', { html: KC.icon('render') + 'Rendre en tant que…', title: 'Rendre en tant que (Ctrl+M)', 'aria-label': 'Rendre en tant que (Ctrl+M)' });
    r.addEventListener('click', C.render);
    t.appendChild(r);
    updateToolbar();
  }
  function updateToolbar() {
    if (!TB.snap) return;
    TB.snap.classList.toggle('on', !!KC.prefs.snap);
    TB.xfade.classList.toggle('on', !!KC.prefs.autoCrossfade);
    TB.ripple.classList.toggle('on', KC.prefs.ripple !== 'off');
    TB.groups.classList.toggle('on', !!KC.prefs.ignoreGroups);
    TB.toolEdit.classList.toggle('on', KC.timeline.tool === 'edit');
    TB.toolSelect.classList.toggle('on', KC.timeline.tool === 'select');
    TB.toolRazor.classList.toggle('on', KC.timeline.tool === 'razor');
    TB.undo.disabled = !KC.history.undo.length;
    TB.redo.disabled = !KC.history.redo.length;
  }
  KC.on('change', updateToolbar);
  KC.on('prefs', updateToolbar);

  /* ------------------------------------------------------------ clavier */
  function onKey(e) {
    if (KC.$('#modals').children.length) return;
    if (U.isTyping(e)) return;
    if (e.key === 'F11' && e.ctrlKey && e.shiftKey) { e.preventDefault(); KC.workspace.toggleTimeline(); return; }
    const k = e.key, ctrl = e.ctrlKey || e.metaKey, shift = e.shiftKey, alt = e.altKey;
    const lower = k.length === 1 ? k.toLowerCase() : k;
    const run = (fn) => { e.preventDefault(); fn(); };
    if (ctrl && !alt) {
      switch (lower) {
        case 'z': return run(shift ? KC.redo : KC.undo);
        case 'y': return run(KC.redo);
        case 'x': return run(C.cut);
        case 'c': return run(C.copy);
        case 'v': return run(() => C.paste());
        case 'a': return run(C.selectAll);
        case 's': return run(() => C.saveProject(shift));
        case 'o': return run(() => C.openProject());
        case 'n': return run(C.newProject);
        case 'i': return run(C.importMedia);
        case 'm': return run(C.render);
        case 'k': return run(C.quickActions);
        case 'q': return run(shift ? C.addVideoTrack : C.addAudioTrack);
        case 't': return run(shift ? () => C.insertGenerator('text') : C.trimToSelection);
        case 'g': return run(shift ? () => KC.dialogs.batchTransform() : C.goTo);
        case 'l': return run(C.toggleRipple);
        case 'u': if (shift) return run(C.toggleGroups); break;
        case 'f': if (shift) return run(() => KC.timeline.fit()); break;
        case 'ArrowLeft': return run(C.edgePrev);
        case 'ArrowRight': return run(C.edgeNext);
        case 'Home': return run(() => E.seek(0));
        case 'End': return run(() => E.seek(P.duration()));
      }
      return;
    }
    if (alt && k === 'Enter') return run(() => KC.dialogs.projectProps());
    if (alt && shift && k === '4') return run(C.previewFullscreen);
    if (alt) return;
    switch (k) {
      case ' ': return run(E.toggle);
      case 'Enter': return run(E.togglePause);
      case 'Escape': if (E.playing) return run(E.stop); if (KC.sel.ids.size) return run(() => KC.sel.clear()); return;
      case 'Delete': case 'Backspace': return run(C.deleteSel);
      case 'ArrowLeft': return run(() => E.step(shift ? -10 : -1));
      case 'ArrowRight': return run(() => E.step(shift ? 10 : 1));
      case 'ArrowUp': return run(() => KC.timeline.setZoom(KC.project.view.zoom * 1.4, KC.timeline.X(E.time)));
      case 'ArrowDown': return run(() => KC.timeline.setZoom(KC.project.view.zoom / 1.4, KC.timeline.X(E.time)));
      case 'Home': return run(() => E.seek(0));
      case 'End': return run(() => E.seek(P.duration()));
      case 'F1': return run(() => KC.dialogs.shortcuts());
      case 'F8': return run(C.toggleSnap);
      case 'F11': return run(() => KC.native.toggleFullscreen());
      case 'F12': return run(() => KC.native.toggleDevTools());
    }
    if (e.code === 'Numpad4') return run(() => C.nudge(-1));
    if (e.code === 'Numpad6') return run(() => C.nudge(1));
    switch (lower) {
      case 'v': return run(() => C.setTool('edit'));
      case 'c': return run(() => C.setTool('razor'));
      case ';': return run(C.liftRange);
      case "'": return run(C.extractRange);
      case 's': return run(C.split);
      case 'm': return run(C.addMarker);
      case 'g': return run(C.group);
      case 'u': return run(C.ungroup);
      case 'q': return run(C.toggleLoop);
      case 'i': return run(C.markIn);
      case 'o': return run(C.markOut);
      case 'k': return run(() => E.pause());
      case 'l': return run(() => E.shuttle(E.playing && E.rate > 0 ? Math.min(8, E.rate * 2) : 1));
      case 'j': return run(() => E.shuttle(E.playing && E.rate < 0 ? Math.max(-8, E.rate * 2) : -1));
    }
    if (/^[1-9]$/.test(k)) return run(() => C.jumpMarker(parseInt(k, 10)));
  }

  KC.menus = { defs: MENUS, init: () => { buildMenubar(); buildToolbar(); window.addEventListener('keydown', onKey); }, updateToolbar };
})();

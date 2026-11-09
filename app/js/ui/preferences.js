// Préférences : fenêtre à onglets avec recherche, et mise en page (éléments masquables) appliquée à toute l'application.
'use strict';
(() => {
  const h = KS.h, ui = KS.ui, P = KS.prefs, C = KS.cmd, V = KS.view, N = KS.native;
  const SPACES = [['studio', 'Studio IA'], ['wallpaper', 'Animation'], ['comfyui', 'Animation Vidéo'], ['video', 'Montage']];

  /* ---------------------------------------------------------------- mise en page */
  // Un réglage « show… » à false ajoute la classe pf-hide-… sur <body> ; le CSS fait le reste.
  const FLAGS = {
    showHero: 'hero', showPipeline: 'pipeline', showLibrary: 'library', showHomeFooter: 'homefoot',
    showCapture: 'capture', showLibraryButton: 'libbtn', showActivity: 'activity',
    showStatusbar: 'statusbar', showGpu: 'gpu',
  };
  const L = KS.layout = {};
  let lastBars = '';
  L.apply = () => {
    const cl = document.body.classList;
    for (const [key, name] of Object.entries(FLAGS)) cl.toggle('pf-hide-' + name, P[key] === false);
    for (const [id] of SPACES) cl.toggle('pf-hide-ws-' + id, !!P.hiddenSpaces?.[id]);
    cl.toggle('pf-reduce-motion', !!P.reduceMotion);
    cl.toggle('pf-home-empty', P.showHero === false && P.showPipeline === false && P.showLibrary === false);
    const bars = `${P.showStatusbar}|${P.showGpu}|${JSON.stringify(P.hiddenSpaces || {})}`;
    if (bars !== lastBars) { lastBars = bars; setTimeout(() => { try { V.resize(); } catch { /* pas encore prêt */ } window.dispatchEvent(new Event('resize')); }, 0); }
  };
  KS.on('ui-ready', () => setTimeout(L.apply, 50));
  L.apply();

  /* ---------------------------------------------------------------- catalogue des réglages */
  const TABS = [
    ['general', 'Général', 'settings'], ['display', 'Affichage', 'eye'], ['look', 'Apparence', 'palette'],
    ['canvas', 'Canevas', 'grid'], ['ai', 'IA et Studio', 'sparkles'], ['advanced', 'Avancé', 'sliders'],
  ];
  const S = [];
  const add = s => S.push(s);
  const on = (tab, group, key, label, desc, def, extra = {}) => add({ tab, group, key, label, desc, def, type: 'check', ...extra });
  const spaceColor = () => KS.appearance.controls();

  // Général
  add({ tab: 'general', group: 'Démarrage', key: 'startPage', def: 'project', label: 'Écran au lancement', desc: 'Ce que KaneApp affiche à l’ouverture, quand aucun document n’est repris.', type: 'seg', opts: [['project', 'Projet'], ['edit', 'Retouche']] });
  on('general', 'Protection du travail', 'autoRecovery', 'Sauvegardes de secours automatiques', 'Copies locales séparées du projet, après 5 secondes d’inactivité puis à intervalle régulier. La récupération est proposée au lancement.', true, { after: () => KS.recovery?.configure() });
  add({ tab: 'general', group: 'Protection du travail', key: 'recoveryInterval', def: 30, label: 'Intervalle de secours', type: 'seg', num: true, opts: [['15', '15 s'], ['30', '30 s'], ['60', '1 min'], ['120', '2 min']], after: () => KS.recovery?.configure() });
  add({ tab: 'general', group: 'Retouche', key: 'historySize', def: 60, label: 'États d’historique', desc: 'Nombre d’étapes que l’on peut annuler. Plus il est élevé, plus la mémoire est sollicitée.', type: 'scrub', min: 5, max: 300 });
  on('general', 'Retouche', 'editableAdjustments', 'Créer des réglages modifiables', 'Les réglages d’image sont conservés dans des calques. Double-cliquez sur leur vignette pour les reprendre.', true);
  on('general', 'Retouche', 'keepGenInfo', 'Conserver les paramètres de génération dans les PNG', 'Ajoute le prompt et les réglages IA aux fichiers PNG exportés.', true);
  add({ tab: 'general', group: 'Mises à jour', label: 'Mises à jour de KaneApp', desc: 'Vérifie les nouvelles versions publiées sur GitHub.', kw: 'version télécharger', type: 'btns', hidden: () => !KS.updates?.available,
    btns: () => [['Rechercher maintenant', () => C.checkUpdates()], P.skipUpdate ? ['Réafficher la version ignorée', e => { delete P.skipUpdate; P.save(); e.currentTarget.remove(); KS.toast('Les mises à jour seront de nouveau proposées', 'ok'); }] : null] });

  // Affichage : tout ce que l’on peut masquer
  on('display', 'Écran Projet', 'showHero', 'En-tête du projet', 'Nom du projet, Renommer et Dossier du projet.', true);
  on('display', 'Écran Projet', 'showPipeline', 'Parcours Créer · Retoucher · Animer · Monter', 'Les quatre grandes étapes en haut de l’écran Projet.', true);
  on('display', 'Écran Projet', 'showLibrary', 'Bibliothèque du projet', 'La grille des médias sur l’écran Projet. Le bouton Bibliothèque la rouvre dans un panneau.', true, { kw: 'médias images grille' });
  add({ tab: 'display', group: 'Écran Projet', key: 'libraryCount', def: 48, label: 'Médias affichés à l’ouverture', desc: 'Les plus récents d’abord. « Afficher plus » en bas de la bibliothèque montre les suivants. Moins de vignettes = ouverture plus rapide.', type: 'seg', num: true, kw: 'nombre images bibliothèque projet vignettes',
    opts: [['12', '12'], ['24', '24'], ['48', '48'], ['96', '96'], ['200', '200'], ['0', 'Tous']] });
  add({ tab: 'display', group: 'Écran Retouche', key: 'recentCount', def: 16, label: 'Fichiers récents affichés', type: 'seg', num: true, kw: 'nombre récents', opts: [['4', '4'], ['8', '8'], ['16', '16'], ['30', '30']] });
  on('display', 'Écran Projet', 'showHomeFooter', 'Pied de page', 'Le rappel sur la copie des médias et le raccourci Animation Vidéo.', true);
  on('display', 'Écran Retouche', 'showRecent', 'Projets récents', 'La liste des derniers fichiers ouverts. Un bouton Masquer / Afficher est aussi présent sur l’écran.', true, { kw: 'récents derniers fichiers' });
  on('display', 'Écran Retouche', 'showQuickStart', 'Démarrer rapidement', 'Les formats prêts à l’emploi.', true, { kw: 'préréglages formats' });
  on('display', 'Écran Retouche', 'showDropHint', 'Indication de dépôt de fichiers', null, true);
  for (const [id, name] of SPACES) add({ tab: 'display', group: 'Espaces du panneau KaneApp', label: name, desc: id === 'studio' ? 'Décochez un espace pour le retirer du panneau. Il reste accessible par le parcours du projet.' : null, type: 'check', kw: 'onglet espace atelier',
    get: () => !P.hiddenSpaces?.[id], set: v => { P.hiddenSpaces = { ...(P.hiddenSpaces || {}), [id]: !v }; } });
  on('display', 'Panneau KaneApp', 'navPinned', 'Garder le panneau ouvert', 'Le panneau vertical s’ouvre avec le bouton K en haut à gauche. Épinglé, il reste affiché et réserve sa place ; sinon il se referme après chaque choix.', false, { kw: 'navigation espaces menu latéral barre verticale k', apply: false });
  on('display', 'Panneau KaneApp', 'showCapture', 'Bouton Capturer', 'Dans le panneau KaneApp.', true);
  on('display', 'Panneau KaneApp', 'showLibraryButton', 'Bouton Bibliothèque', null, true);
  on('display', 'Panneau KaneApp', 'showActivity', 'Bouton Activité', null, true);
  on('display', 'Fenêtre', 'ctxBar', 'Barre des tâches contextuelle', 'La barre flottante d’actions rapides sous l’image.', true, { after: () => KS.taskbar?.render() });
  on('display', 'Fenêtre', 'showStatusbar', 'Barre d’état de l’édition', 'Zoom, taille, position du curseur et couleur.', true);
  on('display', 'Fenêtre', 'showGpu', 'Mémoire graphique (VRAM)', 'La jauge en bas de la fenêtre.', true, { kw: 'gpu jauge' });

  // Apparence
  add({ tab: 'look', group: 'Thème', key: 'theme', def: 'light', label: 'Thème', type: 'seg', apply: true, opts: [['dark', 'Sombre'], ['graphite', 'Graphite'], ['light', 'Givre']] });
  add({ tab: 'look', group: 'Thème', key: 'accent', def: '#2f6fdb', label: 'Accent de KaneApp', type: 'accent', apply: true, kw: 'couleur' });
  add({ tab: 'look', group: 'Thème', label: 'Couleurs des espaces', desc: 'Une teinte par espace de travail.', type: 'node', kw: 'accent onglets', build: spaceColor });
  add({ tab: 'look', group: 'Interface', key: 'uiScale', def: undefined, label: 'Taille de l’interface', type: 'seg', num: true, apply: true, opts: [['0.9', '90 %'], ['1', '100 %'], ['1.15', '115 %'], ['1.25', '125 %'], ['1.5', '150 %']] });
  on('look', 'Interface', 'reduceMotion', 'Réduire les animations', 'Supprime les transitions et les effets de glissement.', false, { kw: 'mouvement accessibilité' });

  // Canevas
  add({ tab: 'canvas', group: 'Navigation', key: 'wheelZoom', def: true, label: 'Molette de la souris', type: 'seg', opts: [['zoom', 'Zoome'], ['scroll', 'Fait défiler']], get: () => (P.wheelZoom ? 'zoom' : 'scroll'), set: v => { P.wheelZoom = v === 'zoom'; } });
  on('canvas', 'Aides visuelles', 'rulers', 'Règles', null, true, { after: v => V.setRulers(v) });
  on('canvas', 'Aides visuelles', 'showGrid', 'Grille', null, false);
  add({ tab: 'canvas', group: 'Aides visuelles', key: 'gridSize', def: 64, label: 'Grille tous les', type: 'scrub', min: 2, max: 1000, unit: 'px' });
  add({ tab: 'canvas', group: 'Aides visuelles', key: 'gridSub', def: 4, label: 'Subdivisions de la grille', type: 'scrub', min: 1, max: 10 });
  on('canvas', 'Aides visuelles', 'showGuides', 'Repères', null, true);
  add({ tab: 'canvas', group: 'Aides visuelles', key: 'guideColor', def: '#00d4ff', label: 'Couleur des repères', type: 'chip' });
  on('canvas', 'Aides visuelles', 'pixelGrid', 'Grille de pixels aux forts zooms', null, true);
  on('canvas', 'Aides visuelles', 'snap', 'Magnétisme', 'Aimante les éléments aux repères, aux bords et aux centres.', true);
  add({ tab: 'canvas', group: 'Transparence', key: 'checker', def: 8, label: 'Taille du damier', type: 'seg', num: true, opts: [['4', 'Petit'], ['8', 'Moyen'], ['16', 'Grand']], after: () => { V.checker = null; } });

  // IA et Studio
  on('ai', 'Moteur', 'engineAuto', 'Démarrer le moteur automatiquement', 'Lance le moteur IA local dès qu’une fonction en a besoin.', true, { kw: 'forge génération' });
  add({ tab: 'ai', group: 'Moteur', key: 'vramIdle', def: 30, label: 'Libérer la mémoire graphique', desc: 'Décharge le modèle du Studio (près de 9 Go) après ce délai sans génération. Il est rechargé à la génération suivante ou à l’ouverture du Studio. La jauge VRAM, en bas de la fenêtre, libère aussi la mémoire à la demande.', type: 'seg', num: true, kw: 'vram gpu carte graphique décharger jeu', opts: [['10', '10 min'], ['30', '30 min'], ['60', '1 h'], ['0', 'Jamais']], after: () => KS.gpuMemory?.setIdle?.(P.vramIdle) });
  on('ai', 'Génération', 'hideAfterGen', 'Masquer les calques Zone IA / Croquis IA après une génération', null, true);
  on('ai', 'Génération', 'autoSave', 'Archiver les générations du Studio', 'Enregistre chaque image générée dans le dossier de sortie.', true);
  add({ tab: 'ai', group: 'Moteurs et modèles', label: 'Moteur local', desc: 'Dossier, profil et démarrage du moteur du Studio.', type: 'btns', hidden: () => !N?.engineConfig, btns: () => [['Configurer le moteur local…', () => KS.dialogs.enginePrefs()]] });
  add({ tab: 'ai', group: 'Moteurs et modèles', label: 'Modèles d’IA locaux', desc: 'Sélection, suppression d’arrière-plan, super résolution.', type: 'btns', hidden: () => !N || !C.aiModels, btns: () => [['Gérer les modèles…', () => C.aiModels()]] });

  // Avancé
  add({ tab: 'advanced', group: 'Disposition', label: 'Panneaux', desc: 'Remet les panneaux latéraux à leur place d’origine.', type: 'btns', btns: () => [['Rétablir la disposition des panneaux', () => { C.resetWorkspace(); KS.toast('Disposition rétablie', 'ok'); }]] });
  add({ tab: 'advanced', group: 'Disposition', label: 'Raccourcis clavier', type: 'btns', btns: () => [['Afficher les raccourcis…', () => KS.dialogs.shortcuts()]] });
  add({ tab: 'advanced', group: 'Données', label: 'Liste des fichiers récents', desc: 'Efface la liste. Les fichiers ne sont pas supprimés.', type: 'btns', btns: () => [['Vider la liste', () => { P.recent = []; P.save(); KS.emit('recent'); KS.toast('Liste vidée', 'ok'); }]] });
  add({ tab: 'advanced', group: 'Données', label: 'Applications intégrées', desc: 'Migration des moteurs vers KaneApp.', type: 'btns', hidden: () => !N, btns: () => [['Migration vers KaneApp…', () => KS.dialogs.runtimeMigration()]] });

  const get = s => s.get ? s.get() : (P[s.key] === undefined ? s.def : P[s.key]);
  const commit = (s, v) => {
    if (s.set) s.set(v); else P[s.key] = v;
    if (s.key === 'accent' && P.spaceColors) delete P.spaceColors.project;
    P.save();
    if (s.apply) KS.applyPrefs?.();
    if (s.key === 'accent') document.querySelectorAll('[data-space-color]').forEach(i => { i.value = KS.appearance.color(i.dataset.spaceColor); });
    if (s.after) s.after(v);
    L.apply(); KS.requestRender?.(); KS.emit('prefs');
  };

  function control(s) {
    const v = get(s);
    if (s.type === 'check') return ui.check('', v, x => commit(s, x));
    if (s.type === 'seg') return ui.seg(s.opts, String(v), x => commit(s, s.num ? +x : x));
    if (s.type === 'scrub') return ui.scrub({ value: v, min: s.min, max: s.max, unit: s.unit || '', onChange: x => commit(s, x) });
    if (s.type === 'chip') return ui.colorChip(v, (x, preview) => { if (!preview) commit(s, x); else { P[s.key] = x; KS.requestRender?.(); } });
    if (s.type === 'accent') {
      const row = h('div.form-row');
      const mark = () => row.querySelectorAll('button').forEach(b => { b.style.outline = b.dataset.c === get(s) ? '2px solid var(--text)' : 'none'; b.style.outlineOffset = '2px'; });
      for (const c of ['#2f6fdb', '#8a5cf6', '#ec4899', '#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#64748b']) {
        const b = h('button.color-chip', { style: { background: c, borderRadius: '50%' }, title: c, 'data-c': c });
        b.addEventListener('click', () => { commit(s, c); mark(); }); row.append(b);
      }
      mark(); return row;
    }
    if (s.type === 'btns') return h('div.form-row', { style: { flexWrap: 'wrap', justifyContent: 'flex-end' } }, ...s.btns().filter(Boolean).map(([t, fn]) => ui.btn(t, fn, '.small')));
    if (s.type === 'node') return s.build();
    return h('span');
  }

  function row(s) {
    const wide = s.type === 'node';
    const text = h('div.pf-text', h('b', { text: s.label }), s.desc ? h('span', { text: s.desc }) : null);
    const ctl = control(s);
    if (s.type === 'check') text.addEventListener('click', () => ctl.input.click());
    return h('div.pf-row' + (wide ? '.stack' : '') + (s.type === 'check' ? '.pf-click' : ''), text, h('div.pf-ctl', ctl));
  }

  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  /* ---------------------------------------------------------------- fenêtre */
  function open(tab) {
    let cur = TABS.some(t => t[0] === tab) ? tab : (TABS.some(t => t[0] === P.prefsTab) ? P.prefsTab : 'general');
    const main = h('div.pf-main');
    const side = h('div.dialog-side.pf-side');
    const search = h('input.field', { type: 'search', placeholder: 'Rechercher un réglage…', 'aria-label': 'Rechercher un réglage' });
    const items = {};
    let dlg;

    function render() {
      const q = norm(search.value.trim());
      main.replaceChildren();
      Object.entries(items).forEach(([id, el]) => el.classList.toggle('active', !q && id === cur));
      const list = S.filter(s => !(s.hidden && s.hidden()) && (q ? norm([s.label, s.desc, s.group, s.kw].join(' ')).includes(q) : s.tab === cur));
      if (!list.length) { main.append(h('div.pf-empty', { text: q ? 'Aucun réglage ne correspond à « ' + search.value.trim() + ' ».' : 'Rien à régler ici.' })); return; }
      main.append(h('h2.pf-title', { text: q ? list.length + ' résultat' + (list.length > 1 ? 's' : '') : TABS.find(t => t[0] === cur)[1] }));
      let group = null, box = null;
      for (const s of list) {
        const g = q ? (TABS.find(t => t[0] === s.tab)[1] + ' › ' + s.group) : s.group;
        if (g !== group) { group = g; box = h('section.pf-group', h('h4', { text: g })); main.append(box); }
        box.append(row(s));
      }
      main.scrollTop = 0;
    }
    for (const [id, name, icon] of TABS) {
      const el = h('div.side-item', { 'data-id': id, html: KS.icon(icon, 'style="width:16px;height:16px"') }, h('span', { text: name }));
      el.addEventListener('click', () => { cur = id; P.prefsTab = id; P.save(); search.value = ''; render(); });
      items[id] = el; side.append(el);
    }
    side.prepend(search);
    search.addEventListener('input', render);
    search.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { if (search.value) { search.value = ''; render(); } else dlg.close(null); } });

    const resetAll = async () => {
      if (!(await KS.confirm('Tous les réglages reviennent à leur valeur d’origine : thème, affichage, canevas, IA. Vos documents et projets ne sont pas touchés.', { title: 'Rétablir les réglages', ok: 'Rétablir' }))) return;
      for (const s of S) if (s.key) { if (s.def === undefined) delete P[s.key]; else P[s.key] = s.def; }
      P.hiddenSpaces = {}; P.spaceColors = {}; delete P.skipUpdate; P.save();
      KS.applyPrefs?.(); L.apply(); V.setRulers(P.rulers); V.checker = null; KS.recovery?.configure(); KS.taskbar?.render(); KS.requestRender?.(); KS.emit('prefs');
      render(); KS.toast('Réglages rétablis', 'ok');
    };
    dlg = KS.modal({ title: 'Préférences', width: 900, body: h('div.pf', side, main), buttons: [{ label: 'Fermer', primary: true }], left: [ui.btn('Tout rétablir', resetAll, '.small')] });
    dlg.body.style.padding = '0';
    render();
    return dlg;
  }
  KS.prefsDialog = { open, settings: S };
})();

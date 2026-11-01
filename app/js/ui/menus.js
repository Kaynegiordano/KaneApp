// Barre de menus et raccourcis clavier.
'use strict';
(() => {
  const ui = KS.ui, C = KS.cmd, T = KS.tools;
  const D = () => KS.state.doc;
  const noDoc = () => !D();
  const noSel = () => !D() || !D().selection.active;
  const M = KS.menus = {};

  const adjItems = () => [
    ['brightness', 'Luminosité/Contraste…'], ['levels', 'Niveaux…', 'Ctrl+L'], ['curves', 'Courbes…', 'Ctrl+M'], ['exposure', 'Exposition…'], null,
    ['vibrance', 'Vibrance…'], ['hueSat', 'Teinte/Saturation…', 'Ctrl+U'], ['colorBalance', 'Balance des couleurs…', 'Ctrl+B'], ['blackWhite', 'Noir et blanc…', 'Ctrl+Alt+Maj+B'], ['photoFilter', 'Filtre photo…'], ['channelMixer', 'Mélangeur de couches…'], null,
    ['invert', 'Négatif', 'Ctrl+I'], ['posterize', 'Postérisation…'], ['threshold', 'Seuil…'], ['gradientMap', 'Courbe de transfert de dégradé…'], ['selectiveColor', 'Correction sélective…'], ['sepia', 'Sépia…'],
  ].map(a => a ? { label: a[1], kb: a[2], icon: KS.Adjust.defs[a[0]].icon, action: () => C.adjust(a[0]), disabled: noDoc } : { sep: true });

  M.adjustLayerMenu = () => KS.ADJ_LIST.map(id => ({ label: KS.Adjust.defs[id].name + '…', icon: KS.Adjust.defs[id].icon, action: () => C.newAdjustLayer(id), disabled: noDoc }));
  M.fxMenu = () => [
    { label: 'Options de fusion…', action: () => C.layerStyle('blend') }, { sep: true },
    { label: 'Ombre portée…', action: () => C.layerStyle('shadow') }, { label: 'Lueur externe…', action: () => C.layerStyle('glow') },
    { label: 'Lueur interne…', action: () => C.layerStyle('innerGlow') }, { label: 'Contour…', action: () => C.layerStyle('stroke') },
    { label: 'Incrustation couleur…', action: () => C.layerStyle('overlay') }, { sep: true },
    { label: 'Effacer le style de calque', action: () => C.clearStyle(), disabled: () => !D()?.active?.effects },
  ];
  M.layerContext = L => [
    { label: 'Modifier le réglage…', icon: 'adjust', action: C.editAdjustment, hidden: L.kind !== 'adjust' },
    { label: 'Options de fusion…', icon: 'fx', action: () => C.layerStyle('blend'), disabled: L.kind === 'adjust' },
    { label: 'Dupliquer le calque', icon: 'duplicate', action: C.duplicateLayer },
    { label: 'Supprimer le calque', icon: 'trash', action: C.deleteLayer },
    { sep: true },
    { label: 'Sélectionner les pixels', icon: 'select-all', action: () => C.selectFromLayer(L), disabled: L.kind === 'adjust' },
    { label: L.mask ? 'Modifier le masque de fusion' : 'Ajouter un masque de fusion', icon: 'mask', action: () => C.addMask() },
    { label: 'Appliquer le masque de fusion', action: C.applyMask, disabled: !L.mask || L.kind !== 'raster' },
    { label: 'Supprimer le masque de fusion', action: C.deleteMask, disabled: !L.mask },
    { label: L.clip ? 'Libérer le masque d\'écrêtage' : 'Créer un masque d\'écrêtage', kb: 'Ctrl+Alt+G', action: C.toggleClip },
    { label: 'Insérer une image dans ce calque…', icon: 'image', action: C.placeInto, disabled: L.kind === 'group' || L.kind === 'adjust' },
    { sep: true },
    { label: L.kind === 'shape' ? 'Pixelliser la forme' : L.kind === 'fill' ? 'Pixelliser le remplissage' : 'Pixelliser le texte', icon: 'rasterize', action: C.rasterize, disabled: L.kind !== 'text' && L.kind !== 'shape' && L.kind !== 'fill' },
    { label: 'Grouper les calques', kb: 'Ctrl+G', icon: 'group', action: C.groupLayers },
    { label: 'Dissocier les calques', kb: 'Ctrl+Maj+G', action: C.ungroup, disabled: L.kind !== 'group' },
    { label: 'Rogner le calque à son contenu', icon: 'trim', action: C.trimLayer, disabled: L.kind !== 'raster' },
    { label: 'Supprimer l\'arrière-plan', icon: 'remove-bg', action: C.removeBackground, disabled: L.kind !== 'raster' },
    { label: 'Harmoniser…', icon: 'harmonize', action: () => C.harmonize(), disabled: L.kind !== 'raster' },
    { sep: true },
    { label: 'Fusionner vers le bas', kb: 'Ctrl+E', icon: 'merge', action: C.mergeDown },
    { label: 'Fusionner les calques visibles', kb: 'Ctrl+Maj+E', action: C.mergeVisible },
    { label: 'Aplatir l\'image', action: C.flatten },
  ];
  const filterGroups = () => {
    const groups = {};
    for (const [id, f] of Object.entries(KS.Filters.defs)) (groups[f.group] = groups[f.group] || []).push({ label: f.name + (f.params.length ? '…' : ''), action: () => C.filter(id), disabled: noDoc });
    return ['Flou', 'Renforcement', 'Bruit', 'Pixellisation', 'Esthétiques', 'Rendu', 'Déformation', 'Divers'].filter(g => groups[g]).map(g => ({ label: g, sub: groups[g] }));
  };
  const recentItems = () => {
    const r = KS.prefs.recent || [];
    if (!r.length) return [{ label: 'Aucun fichier récent', disabled: true }];
    return [...r.map(x => ({ label: x.name, icon: 'image', action: () => KS.io.openPath(x.path) })), { sep: true }, { label: 'Effacer la liste', action: () => { KS.prefs.recent = []; KS.prefs.save(); KS.emit('recent'); } }];
  };

  M.defs = () => [
    {
      label: 'Fichier', items: [
        { label: 'Nouveau…', kb: 'Ctrl+N', icon: 'file-plus', action: () => C.newDoc() },
        { label: 'Nouveau depuis le presse-papiers', icon: 'paste', action: C.newFromClipboard },
        { label: 'Ouvrir…', kb: 'Ctrl+O', icon: 'folder-open', action: C.open },
        { label: 'Fichiers récents', sub: recentItems, hidden: !KS.native },
        { label: 'Récupérer des documents…', icon: 'history', action: () => KS.recovery.show(), hidden: !KS.native },
        { label: 'Fermer', kb: 'Ctrl+W', action: C.close, disabled: noDoc },
        { label: 'Tout fermer', kb: 'Ctrl+Alt+W', action: C.closeAll, disabled: noDoc },
        { sep: true },
        { label: 'Enregistrer', kb: 'Ctrl+S', icon: 'save', action: C.save, disabled: noDoc },
        { label: 'Enregistrer sous…', kb: 'Ctrl+Maj+S', action: C.saveAs, disabled: noDoc },
        { label: 'Version précédente', kb: 'F12', action: C.revert, disabled: () => !D()?.path },
        { sep: true },
        { label: 'Exporter', icon: 'export', disabled: noDoc, sub: [
          { label: 'Exportation rapide en PNG', kb: 'Ctrl+Maj+Alt+E', action: C.quickExport },
          { label: 'Exporter sous…', kb: 'Ctrl+Alt+Maj+W', action: C.exportAs },
          { label: 'Exporter en CMJN (TIFF)…', icon: 'cmyk', action: () => C.exportCMYK() },
        ] },
        { label: 'Importer et incorporer…', icon: 'import', action: C.place, disabled: noDoc },
        { label: 'Insérer une image dans le calque…', icon: 'image', action: C.placeInto, disabled: noDoc },
        { label: 'Dupliquer le document', icon: 'duplicate', action: C.duplicateDoc, disabled: noDoc },
        { label: 'Infos de génération (PNG Info)…', icon: 'info', action: () => C.pngInfo() },
        { sep: true },
        { label: 'Quitter', kb: 'Ctrl+Q', action: () => window.close() },
      ],
    },
    {
      label: 'Édition', items: [
        { label: () => 'Annuler ' + (D()?.history.canUndo ? D().history.items[D().history.pos].name : ''), kb: 'Ctrl+Z', icon: 'undo', action: C.undo, disabled: () => !D()?.history.canUndo },
        { label: () => 'Rétablir ' + (D()?.history.canRedo ? D().history.items[D().history.pos + 1].name : ''), kb: 'Ctrl+Maj+Z', icon: 'redo', action: C.redo, disabled: () => !D()?.history.canRedo },
        { label: () => C.canFade() ? 'Atténuer : ' + D().fade.name + '…' : 'Atténuer…', kb: 'Ctrl+Maj+F', action: C.fade, disabled: () => !C.canFade() },
        { sep: true },
        { label: 'Couper', kb: 'Ctrl+X', icon: 'cut', action: C.cut, disabled: noSel },
        { label: 'Copier', kb: 'Ctrl+C', icon: 'copy', action: () => C.copy(false), disabled: noDoc },
        { label: 'Copier avec fusion', kb: 'Ctrl+Maj+C', action: () => C.copy(true), disabled: noDoc },
        { label: 'Coller', kb: 'Ctrl+V', icon: 'paste', action: () => C.paste(false) },
        { label: 'Coller sur place', kb: 'Ctrl+Maj+V', action: () => C.paste(true), disabled: noDoc },
        { label: 'Coller dans le calque', kb: 'Ctrl+Alt+Maj+V', action: C.pasteInto, disabled: noDoc },
        { label: 'Effacer', kb: 'Suppr', action: C.clear, disabled: noSel },
        { sep: true },
        { label: 'Remplir…', kb: 'Maj+F5', icon: 'fill', action: C.fill, disabled: noDoc },
        { label: 'Remplissage d\'après le contenu', icon: 'patch', action: () => C.contentAwareFill(D()), disabled: noSel },
        { label: 'Remplissage génératif…', kb: 'Ctrl+Maj+Alt+G', icon: 'sparkles', action: () => C.generativeFill(), disabled: noSel },
        { label: 'Supprimer avec l\'IA', kb: 'Maj+Suppr', icon: 'remove', action: () => C.removeSelection(), disabled: noSel },
        { label: 'Transformer dans le Studio IA (Img2Img)…', icon: 'image', action: () => C.openGenPanel(), disabled: noDoc },
        { label: 'Contour…', icon: 'stroke', action: C.stroke, disabled: noSel },
        { sep: true },
        { label: 'Transformation manuelle', kb: 'Ctrl+T', icon: 'transform', action: C.freeTransform, disabled: noDoc },
        { label: 'Transformation', disabled: noDoc, sub: [
          { label: 'Échelle / rotation', action: C.freeTransform },
          { label: 'Inclinaison', icon: 'skew', action: () => C.transformMode('skew') },
          { label: 'Torsion', icon: 'distort', action: () => C.transformMode('distort') },
          { label: 'Perspective', icon: 'perspective', action: () => C.transformMode('perspective') },
          { label: 'Déformation', icon: 'warp', action: () => C.transformMode('warp') },
          { sep: true },
          { label: 'Rotation 180°', action: () => C.rotateLayer(180) },
          { label: 'Rotation 90° horaire', action: () => C.rotateLayer(90) },
          { label: 'Rotation 90° antihoraire', action: () => C.rotateLayer(-90) },
          { sep: true },
          { label: 'Symétrie axe horizontal', action: () => C.flipLayer('h') },
          { label: 'Symétrie axe vertical', action: () => C.flipLayer('v') },
        ] },
        { sep: true },
        { label: 'Préférences…', kb: 'Ctrl+K', icon: 'settings', action: KS.dialogs.prefs },
        { label: "Modèles d'IA…", icon: 'sparkles', action: () => C.aiModels(), hidden: !KS.native },
      ],
    },
    {
      label: 'Image', items: [
        { label: 'Réglages', icon: 'adjust', sub: adjItems, disabled: noDoc },
        { sep: true },
        { label: 'Amélioration rapide', kb: 'Ctrl+Maj+Q', icon: 'sparkles', action: C.quickEnhance, disabled: noDoc },
        { label: 'Ton automatique', kb: 'Ctrl+Maj+L', action: C.autoTone, disabled: noDoc },
        { label: 'Contraste automatique', kb: 'Ctrl+Alt+Maj+L', action: C.autoContrast, disabled: noDoc },
        { label: 'Couleur automatique', kb: 'Ctrl+Maj+B', action: C.autoColor, disabled: noDoc },
        { label: 'Désaturation', kb: 'Ctrl+Maj+U', action: C.desaturate, disabled: noDoc },
        { label: 'Égaliser', action: C.equalize, disabled: noDoc },
        { sep: true },
        { label: 'Taille de l\'image…', kb: 'Ctrl+Alt+I', icon: 'image-size', action: C.imageSize, disabled: noDoc },
        { label: 'Taille de la zone de travail…', kb: 'Ctrl+Alt+C', icon: 'canvas-size', action: C.canvasSize, disabled: noDoc },
        { label: 'Développement génératif…', icon: 'gen-expand', action: () => C.generativeExpand(), disabled: noDoc },
        { label: 'Super résolution IA…', icon: 'upscale', action: () => C.superResolution(), disabled: noDoc, hidden: !KS.native },
        { label: 'Rotation de l\'image', disabled: noDoc, sub: [
          { label: '180°', action: () => C.rotateCanvas(180) }, { label: '90° horaire', icon: 'rotate-cw', action: () => C.rotateCanvas(90) }, { label: '90° antihoraire', icon: 'rotate-ccw', action: () => C.rotateCanvas(-90) },
          { sep: true }, { label: 'Symétrie de la zone de travail horizontale', icon: 'flip-h', action: () => C.flipCanvas('h') }, { label: 'Symétrie de la zone de travail verticale', icon: 'flip-v', action: () => C.flipCanvas('v') },
        ] },
        { label: 'Recadrer (selon la sélection)', icon: 'crop', action: C.cropToSelection, disabled: noSel },
        { label: 'Rogner (transparence)', icon: 'trim', action: C.trim, disabled: noDoc },
        { label: 'Tout faire apparaître', action: C.revealAll, disabled: noDoc },
        { sep: true },
        { label: 'Dupliquer…', icon: 'duplicate', action: C.duplicateDoc, disabled: noDoc },
        { label: 'Découper pour les réseaux…', icon: 'grid', action: () => C.socialCut(), disabled: noDoc },
      ],
    },
    {
      label: 'Calque', items: [
        { label: 'Nouveau', disabled: noDoc, sub: [
          { label: 'Calque…', kb: 'Ctrl+Maj+N', icon: 'new-layer', action: C.newLayerDialog },
          { label: 'Calque par copier', kb: 'Ctrl+J', icon: 'copy', action: () => C.layerViaCopy(false) },
          { label: 'Calque par couper', kb: 'Ctrl+Maj+J', icon: 'cut', action: () => C.layerViaCopy(true) },
        ] },
        { label: 'Dupliquer le calque', icon: 'duplicate', action: C.duplicateLayer, disabled: noDoc },
        { label: 'Supprimer le calque', icon: 'trash', action: C.deleteLayer, disabled: noDoc },
        { sep: true },
        { label: 'Grouper les calques', kb: 'Ctrl+G', icon: 'group', action: C.groupLayers, disabled: noDoc },
        { label: 'Dissocier les calques', kb: 'Ctrl+Maj+G', action: C.ungroup, disabled: () => D()?.active?.kind !== 'group' },
        { label: 'Sélectionner tous les calques', kb: 'Ctrl+Alt+A', action: C.selectAllLayers, disabled: noDoc },
        { sep: true },
        { label: 'Style de calque', icon: 'fx', sub: M.fxMenu, disabled: noDoc },
        { label: 'Nouveau calque de remplissage', disabled: noDoc, sub: [{ label: 'Couleur unie…', icon: 'fill', action: () => C.newFillLayer('solid') }, { label: 'Dégradé…', icon: 'gradient', action: () => C.newFillLayer('gradient') }, { label: 'Motif…', icon: 'grid', action: () => C.newFillLayer('pattern') }] },
        { label: 'Nouveau calque de réglage', icon: 'adjust', sub: M.adjustLayerMenu, disabled: noDoc },
        { sep: true },
        { label: 'Masque de fusion', icon: 'mask', disabled: noDoc, sub: [
          { label: 'Tout faire apparaître', action: () => C.addMask('reveal') }, { label: 'Tout masquer', action: () => C.addMask('hide') },
          { label: 'Faire apparaître la sélection', action: () => C.addMask('selection'), disabled: noSel }, { label: 'Masquer la sélection', action: () => C.addMask('hide-selection'), disabled: noSel },
          { sep: true }, { label: 'Activer / désactiver', action: C.toggleMask }, { label: 'Intervertir', action: C.invertMask }, { label: 'Appliquer', action: C.applyMask }, { label: 'Supprimer', action: C.deleteMask },
        ] },
        { label: 'Créer un masque d\'écrêtage', kb: 'Ctrl+Alt+G', action: C.toggleClip, disabled: noDoc },
        { label: 'Insérer une image dans le calque…', icon: 'image', action: C.placeInto, disabled: noDoc },
        { sep: true },
        { label: 'Pixelliser', icon: 'rasterize', action: C.rasterize, disabled: () => !['text', 'shape'].includes(D()?.active?.kind) },
        { label: 'Supprimer l\'arrière-plan', icon: 'remove-bg', action: C.removeBackground, disabled: noDoc },
        { label: 'Harmoniser…', icon: 'harmonize', action: () => C.harmonize(), disabled: () => !D()?.active || D().active.kind !== 'raster' || D().layers.indexOf(D().active) <= 0 },
        { label: 'Disposition', disabled: noDoc, sub: [
          { label: 'Premier plan', kb: 'Ctrl+Maj+]', icon: 'arrow-top', action: () => C.arrange('front') }, { label: 'En avant', kb: 'Ctrl+]', icon: 'arrow-up', action: () => C.arrange('up') },
          { label: 'En arrière', kb: 'Ctrl+[', icon: 'arrow-down', action: () => C.arrange('down') }, { label: 'Arrière-plan', kb: 'Ctrl+Maj+[', icon: 'arrow-bottom', action: () => C.arrange('back') },
        ] },
        { label: 'Aligner', disabled: noDoc, sub: [
          { label: 'Bords supérieurs', icon: 'align-top', action: () => C.align('t') }, { label: 'Centres verticaux', icon: 'align-vcenter', action: () => C.align('vc') }, { label: 'Bords inférieurs', icon: 'align-bottom', action: () => C.align('b') },
          { sep: true }, { label: 'Bords gauches', icon: 'align-left', action: () => C.align('l') }, { label: 'Centres horizontaux', icon: 'align-hcenter', action: () => C.align('hc') }, { label: 'Bords droits', icon: 'align-right', action: () => C.align('r') },
        ] },
        { label: 'Répartir', disabled: noDoc, sub: [{ label: 'Centres horizontaux', action: () => C.distribute('h') }, { label: 'Centres verticaux', action: () => C.distribute('v') }] },
        { sep: true },
        { label: 'Fusionner vers le bas', kb: 'Ctrl+E', icon: 'merge', action: C.mergeDown, disabled: noDoc },
        { label: 'Fusionner les calques visibles', kb: 'Ctrl+Maj+E', action: C.mergeVisible, disabled: noDoc },
        { label: 'Tampon des calques visibles', kb: 'Ctrl+Alt+Maj+E', action: C.stampVisible, disabled: noDoc },
        { label: 'Aplatir l\'image', action: C.flatten, disabled: noDoc },
      ],
    },
    {
      label: 'Sélection', items: [
        { label: 'Tout sélectionner', kb: 'Ctrl+A', icon: 'select-all', action: C.selectAll, disabled: noDoc },
        { label: 'Désélectionner', kb: 'Ctrl+D', icon: 'select-none', action: C.deselect, disabled: noSel },
        { label: 'Resélectionner', kb: 'Ctrl+Maj+D', action: C.reselect, disabled: () => !D()?.selection.last },
        { label: 'Intervertir', kb: 'Ctrl+Maj+I', icon: 'select-invert', action: C.invertSelection, disabled: noDoc },
        { sep: true },
        { label: 'Sujet', icon: 'sparkles', action: C.selectSubject, disabled: noDoc },
        { label: 'Agrandir', action: () => C.growSelection(false), disabled: () => !D()?.selection.active },
        { label: 'Sélection similaire', action: () => C.growSelection(true), disabled: () => !D()?.selection.active },
        { label: 'Plage de couleurs…', icon: 'palette', action: C.colorRange, disabled: noDoc },
        { label: 'Sélectionner et masquer…', kb: 'Ctrl+Alt+R', action: C.refineEdge, disabled: noSel },
        { label: 'Modifier', disabled: noSel, sub: [
          { label: 'Bordure…', action: C.border }, { label: 'Lisser…', action: C.smooth }, { label: 'Dilater…', action: C.expand }, { label: 'Contracter…', action: C.contract }, { label: 'Contour progressif…', kb: 'Maj+F6', action: C.feather },
        ] },
        { sep: true },
        { label: 'Récupérer la sélection du calque', action: () => D()?.active && C.selectFromLayer(D().active), disabled: noDoc },
        { label: 'Mémoriser la sélection…', icon: 'save', action: C.saveSelection, disabled: noSel },
        { label: 'Récupérer la sélection…', icon: 'channels', action: C.loadSelectionDialog, disabled: noDoc },
        { label: 'Sélection de la luminosité', kb: 'Ctrl+Alt+2', action: () => C.loadChannel('rgb'), disabled: noDoc },
        { label: 'Sélection → tracé', icon: 'pen', action: () => C.selectionToPath(), disabled: noSel },
        { label: 'Mode Masque', kb: 'Q', icon: 'quick-mask', checked: () => !!D()?.quickMask, action: C.quickMask, disabled: noDoc },
      ],
    },
    {
      label: 'Filtre', items: () => [
        { label: KS.state.lastFilter ? 'Dernier filtre : ' + KS.Filters.defs[KS.state.lastFilter].name : 'Dernier filtre', kb: 'Ctrl+F', action: C.repeatFilter, disabled: () => noDoc() || !KS.state.lastFilter },
        { label: 'Dernier filtre, avec ses réglages…', kb: 'Ctrl+Alt+F', action: C.lastFilter, disabled: () => noDoc() || !KS.state.lastFilter },
        { sep: true },
        { label: 'Filtre Camera Raw…', kb: 'Ctrl+Maj+A', icon: 'camera', action: C.cameraRaw, disabled: noDoc },
        { label: 'Fluidité…', kb: 'Ctrl+Maj+X', icon: 'liquify', action: () => KS.liquify && KS.liquify(), disabled: noDoc },
        { sep: true },
        ...filterGroups(),
      ],
    },
    {
      label: 'IA', items: () => [
        { label: () => KS.studio && KS.studio.on ? 'Revenir à Retouche' : 'Ouvrir le Studio IA', kb: 'F6', icon: 'sparkles', action: () => C.toggleStudio() },
        { label: 'Créer une image dans txt2img', icon: 'file-plus', action: () => C.openStudioTab('txt2img') },
        { label: 'Générer / interrompre dans le Studio', kb: 'Ctrl+Entrée', action: () => C.studioGenerate(), hidden: !(KS.studio && KS.studio.on) },
        { sep: true },
        { head: 'Envoyer une copie du document au Studio' },
        { label: 'Envoyer vers Img2Img — transformer l’image', icon: 'image', action: () => C.sendToStudio('img2img'), disabled: noDoc },
        { label: 'Envoyer vers Inpaint — retoucher une zone', icon: 'brush', action: () => C.sendToStudio('inpaint'), disabled: noDoc },
        { label: 'Autres destinations', icon: 'sparkles', disabled: noDoc, sub: [
          { label: 'Agrandir dans Extras', action: () => C.sendToStudio('extras') },
          { label: 'Lire les paramètres dans PNG Info', action: () => C.sendToStudio('pnginfo') },
          { label: 'Agrandir avec Hires dans txt2img', action: () => C.sendToStudio('txt2img') },
          { label: 'Réutiliser les réglages dans txt2img', action: () => C.sendToStudio('params'), disabled: () => !(D() && (D().genInfo || D().genParams)) },
        ] },
        { sep: true, hidden: !KS.ws },
        { head: 'Autres espaces', hidden: !KS.ws },
        { label: 'Utiliser l’illustration dans un workflow…', icon: 'grid', action: () => KS.suite.run('Préparation du workflow', () => C.toComfy()).catch(() => {}), disabled: noDoc, hidden: !KS.ws },
        { label: 'Animer l’illustration', icon: 'sparkles', action: () => KS.suite.run('Préparation de l’animation', () => C.toWallpaper()).catch(() => {}), disabled: noDoc, hidden: !KS.ws },
        { label: 'Ajouter l’illustration au montage', icon: 'play', action: () => KS.suite.run('Ajout au montage', () => C.toVideo()).catch(() => {}), disabled: noDoc, hidden: !KS.ws },
        { label: () => KS.engine && KS.engine.ready() ? 'Arrêter le moteur IA' : 'Démarrer le moteur IA', icon: 'settings', action: () => KS.engine && (KS.engine.ready() ? KS.engine.stop() : KS.engine.ensure()), hidden: !KS.engine },
        { sep: true },
        { head: 'Retoucher' },
        { label: 'Ajouter un dessin IA…', icon: 'sparkles', action: () => C.openEditorDraw(), disabled: noDoc },
        { label: 'Remplissage génératif…', icon: 'sparkles', action: () => C.generativeFill(), disabled: noSel },
        { label: 'Supprimer avec l\'IA', icon: 'remove', action: () => C.removeSelection(), disabled: noSel },
        { label: 'Développement génératif…', icon: 'gen-expand', action: () => C.generativeExpand(), disabled: noDoc },
        { label: 'Super résolution IA…', icon: 'upscale', action: () => C.superResolution(), disabled: noDoc },
        { label: 'Harmoniser…', icon: 'harmonize', action: () => C.harmonize(), disabled: noDoc },
        { sep: true },
        { label: 'Infos de génération (PNG Info)…', icon: 'info', action: () => C.pngInfo() },
        { label: 'Train LoRA…', icon: 'layers', action: () => C.loraStudio(), hidden: !KS.native },
        { label: 'Modèles d\'IA locaux…', icon: 'settings', action: () => C.aiModels(), hidden: !KS.native },
      ],
    },
    {
      label: 'Affichage', items: [
        { label: 'Zoom avant', kb: 'Ctrl++', icon: 'zoom', action: C.zoomIn, disabled: noDoc },
        { label: 'Zoom arrière', kb: 'Ctrl+-', icon: 'zoom-out', action: C.zoomOut, disabled: noDoc },
        { label: 'Taille écran', kb: 'Ctrl+0', action: C.fit, disabled: noDoc },
        { label: '100 %', kb: 'Ctrl+1', action: C.actual, disabled: noDoc },
        { label: '200 %', action: C.zoom200, disabled: noDoc },
        { sep: true },
        { label: 'Règles', kb: 'Ctrl+R', checked: () => KS.prefs.rulers, action: C.toggleRulers },
        { label: 'Grille', kb: 'Ctrl+\'', checked: () => KS.prefs.showGrid, action: C.toggleGrid },
        { label: 'Repères', kb: 'Ctrl+;', checked: () => KS.prefs.showGuides, action: C.toggleGuides },
        { label: 'Magnétisme', kb: 'Ctrl+Maj+;', checked: () => KS.prefs.snap, action: C.toggleSnap },
        { label: 'Grille de pixels', checked: () => KS.prefs.pixelGrid, action: C.togglePixelGrid },
        { label: 'Barre des tâches contextuelle', checked: () => KS.prefs.ctxBar !== false, action: () => C.toggleCtxBar() },
        { sep: true },
        { label: 'Épreuve des couleurs (CMJN)', kb: 'Ctrl+Y', icon: 'cmyk', checked: () => !!KS.state.doc?.proof, action: () => C.toggleProof(), disabled: noDoc },
        { label: 'Couleurs non imprimables', kb: 'Ctrl+Maj+Y', checked: () => !!KS.state.doc?.gamutWarn, action: () => C.toggleGamut(), disabled: noDoc },
        { sep: true },
        { label: 'Nouveau repère…', icon: 'ruler', action: C.newGuide, disabled: noDoc },
        { label: 'Effacer les repères', action: C.clearGuides, disabled: noDoc },
        { sep: true },
        { label: 'Plein écran', kb: 'F11', icon: 'maximize', action: C.fullscreen },
        { label: 'Masquer les panneaux', kb: 'Tab', icon: 'panels', action: C.togglePanels },
      ],
    },
    {
      label: 'Fenêtre', items: () => [
        { head: 'Thème' },
        ...[['dark', 'Sombre'], ['graphite', 'Graphite'], ['light', 'Clair']].map(([k, l]) => ({ label: l, checked: () => KS.prefs.theme === k, action: () => { KS.prefs.theme = k; KS.prefs.save(); KS.applyPrefs(); } })),
        { sep: true },
        { head: 'Panneaux' },
        ...Object.entries(KS.panels.defs).map(([id, p]) => ({ label: p.title, action: () => KS.panels.focus(id) })),
        { label: 'Réinitialiser l\'espace de travail', action: C.resetWorkspace },
        { sep: true },
        { head: 'Documents' },
        ...KS.state.docs.map(d => ({ label: d.name + (d.dirty ? ' •' : ''), checked: () => d === D(), action: () => KS.switchDoc(d) })),
      ],
    },
    {
      label: 'Aide', items: [
        { label: 'Raccourcis clavier', kb: 'F1', icon: 'keyboard', action: KS.dialogs.shortcuts },
        { label: 'Rechercher des mises à jour…', icon: 'history', action: () => C.checkUpdates(), hidden: !KS.native },
        { label: 'À propos de KaneApp', icon: 'info', action: KS.dialogs.about },
        { sep: true },
        { label: 'Outils de développement', kb: 'Ctrl+Maj+F12', action: () => KS.native && KS.native.toggleDevTools(), hidden: !KS.native },
      ],
    },
  ];

  /* ---------------------------------------------------------------- barre de menus */
  // Un espace intégré (Montage) peut remplacer les menus : { labels: [...], items: async label => [...] }
  let external = null, built = [], showToken = 0;
  KS.on('menus-closed', () => { built.forEach(x => x.classList.remove('open')); });
  M.setExternal = ext => { if (external === ext) return; external = ext; M.build(); };
  M.current = () => external;          // menus de l'espace intégré actif (palette de commandes)
  M.build = () => {
    const bar = KS.$('#menubar');
    bar.innerHTML = '';
    let open = -1;
    const defs = external ? external.labels.map(label => ({ label })) : M.defs();
    const btns = built = defs.map((m, i) => {
      const b = KS.h('button.menu-btn', { text: m.label });
      const show = async () => {
        const r = b.getBoundingClientRect(), token = ++showToken;
        btns.forEach(x => x.classList.remove('open'));
        b.classList.add('open'); open = i;
        let items;
        if (external) { try { items = await external.items(m.label); } catch (err) { KS.toast(err.message, 'err'); b.classList.remove('open'); return; } }
        else items = typeof m.items === 'function' ? m.items() : M.defs()[i].items;
        if (token !== showToken || !b.classList.contains('open')) return;
        ui.menu(items, r.left, r.bottom + 4);
      };
      b.addEventListener('pointerdown', e => { e.preventDefault(); if (open === i && ui.menuOpen()) { ui.closeMenus(); } else show(); });
      b.addEventListener('mouseenter', () => { if (open >= 0 && ui.menuOpen() && open !== i) show(); });
      bar.appendChild(b);
      return b;
    });
  };

  /* ---------------------------------------------------------------- raccourcis */
  const norm = kb => {
    let s = kb.toLowerCase().replace('maj', 'shift').replace('suppr', 'delete'), key = null;
    if (s.endsWith('++')) { key = '+'; s = s.slice(0, -2); }
    const parts = s.split('+').filter(Boolean);
    if (key) parts.push(key);
    return parts;
  };
  const comboOf = parts => { const mods = ['ctrl', 'alt', 'shift'].filter(m => parts.includes(m)); const key = parts.filter(p => !['ctrl', 'alt', 'shift'].includes(p)).pop(); return [...mods, key].join('+'); };
  M.shortcuts = new Map();
  M.collect = () => {
    M.shortcuts.clear();
    const walk = items => {
      for (const it of (typeof items === 'function' ? items() : items)) {
        if (!it || it.sep || it.head) continue;
        if (it.kb && it.action) M.shortcuts.set(comboOf(norm(it.kb)), it);
        if (it.sub && typeof it.sub !== 'function') walk(it.sub);
        else if (it.sub && typeof it.sub === 'function' && it.label !== 'Fichiers récents') walk(it.sub);
      }
    };
    M.defs().forEach(m => walk(m.items));
    // compléments
    const extra = { 'ctrl+shift+p': () => KS.palette?.open(), 'ctrl+alt+z': C.undo, 'shift+f6': C.feather, 'ctrl+shift+x': () => KS.liquify && KS.liquify(), 'ctrl+=': C.zoomIn, 'ctrl+shift+=': C.zoomIn, 'f1': KS.dialogs.shortcuts, 'ctrl+shift+f12': () => KS.native && KS.native.toggleDevTools(), 'ctrl+shift+a': C.cameraRaw, 'ctrl+enter': () => C.pathToSelection(), 'ctrl+2': () => C.selectChannel('rgb'), 'ctrl+3': () => C.selectChannel('r'), 'ctrl+4': () => C.selectChannel('g'), 'ctrl+5': () => C.selectChannel('b'),
      'ctrl+6': () => D()?.alphas[0] && C.selectChannel(D().alphas[0].id), 'ctrl+7': () => D()?.alphas[1] && C.selectChannel(D().alphas[1].id), 'ctrl+g': C.groupLayers, 'ctrl+shift+g': C.ungroup, 'ctrl+alt+a': C.selectAllLayers };
    for (const k in extra) M.shortcuts.set(k, { action: extra[k] });
  };
  const keyName = e => {
    if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
    if (/^Numpad\d$/.test(e.code)) return e.code.slice(6);
    if (e.code === 'BracketLeft') return '[';
    if (e.code === 'BracketRight') return ']';
    if (e.code === 'NumpadAdd') return '+';
    if (e.code === 'NumpadSubtract') return '-';
    if (e.key === 'Delete') return 'delete';
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
    return k === 'dead' ? e.code.toLowerCase() : k;
  };
  const isTyping = t => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  KS.keys = { alt: false, space: false };

  M.attach = () => {
    M.collect();
    window.addEventListener('keydown', e => {
      KS.keys.alt = e.altKey;
      if (e.key === 'Alt') { e.preventDefault(); T.updateCursor(); }
      if (KS.modalOpen()) return;
      if (isTyping(e.target)) return;
      const doc = D();
      const tool = T.current;
      // outil courant d'abord (Entrée, Échap, flèches, [ ]…)
      if (tool && tool.key && doc && !e.ctrlKey) {
        const tk = e.code === 'BracketLeft' ? (e.shiftKey ? '{' : '[') : e.code === 'BracketRight' ? (e.shiftKey ? '}' : ']') : /^Digit\d$/.test(e.code) ? e.code.slice(5) : e.key;
        if (tool.key({ key: tk, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, repeat: e.repeat }, doc)) { e.preventDefault(); return; }
      }
      if (e.key === ' ' && !e.repeat) { T.spaceDown = true; T.updateCursor(); e.preventDefault(); return; }
      if (e.key === ' ') { e.preventDefault(); return; }
      const k = keyName(e);
      const combo = [e.ctrlKey || e.metaKey ? 'ctrl' : null, e.altKey ? 'alt' : null, e.shiftKey ? 'shift' : null, k].filter(Boolean).join('+');
      // zoom (claviers AZERTY/QWERTY)
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd')) { e.preventDefault(); C.zoomIn(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.code === 'NumpadSubtract' || e.code === 'Minus') && !e.shiftKey) { e.preventDefault(); C.zoomOut(); return; }
      if (combo === 'ctrl+v' || combo === 'ctrl+shift+v') { KS.pasteInPlace = e.shiftKey; return; } // géré par l'événement « paste »
      const sc = M.shortcuts.get(combo);
      if (sc) {
        e.preventDefault();
        const dis = typeof sc.disabled === 'function' ? sc.disabled() : sc.disabled;
        if (!dis) sc.action();
        return;
      }
      if (e.ctrlKey || e.metaKey) { if (['r', 'w', 'p', 'f', 'g', 'n', 't', 'j'].includes(k)) e.preventDefault(); return; }
      // touches simples
      if (e.key === 'Tab') { e.preventDefault(); C.togglePanels(); return; }
      if (e.key === 'F11') { e.preventDefault(); C.fullscreen(); return; }
      if (!doc && !['d', 'x'].includes(k)) { if (/^[a-z]$/.test(k)) T.byKey(k.toUpperCase(), e.shiftKey); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (e.altKey) return C.fillFG();
        if (doc && doc.selection.active) return C.clear();
        if (tool?.id === 'move') return C.deleteLayer();
        return;
      }
      if (e.altKey && e.key === 'Backspace') return C.fillFG();
      if (e.key === 'Escape') { if (doc && doc.selection.active && !e.repeat && tool?.id !== 'crop') { /* Échap ne désélectionne pas, comme Photoshop */ } return; }
      if (e.altKey) return;
      if (k === 'd') return KS.resetColors();
      if (k === 'x') return KS.swapColors();
      if (k === 'q') return C.quickMask();
      if (/^[a-z]$/.test(k) && T.byKey(k.toUpperCase(), e.shiftKey)) { e.preventDefault(); return; }
    }, true);
    window.addEventListener('keyup', e => {
      KS.keys.alt = e.altKey;
      if (e.key === ' ') { T.spaceDown = false; T.updateCursor(); }
      if (e.key === 'Alt') { e.preventDefault(); T.updateCursor(); }
    });
    window.addEventListener('blur', () => { T.spaceDown = false; KS.keys.alt = false; });
    // Ctrl+Backspace (remplir avec l'arrière-plan)
    window.addEventListener('keydown', e => { if (!KS.modalOpen() && !isTyping(e.target) && e.ctrlKey && e.key === 'Backspace') { e.preventDefault(); C.fillBG(); } });
    // Coller
    document.addEventListener('paste', async e => {
      if (KS.modalOpen() || isTyping(e.target)) return;
      e.preventDefault();
      const items = [...(e.clipboardData?.items || [])];
      const img = items.find(i => i.type.startsWith('image/'));
      if (img) { const c = await KS.util.canvasFromBlob(img.getAsFile()); C.pasteCanvas(c, KS.pasteInPlace); return; }
      if (KS.state.clipboard) { C.pasteCanvas(KS.util.copyCanvas(KS.state.clipboard.canvas), true); return; }
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) for (const f of files) await KS.io.openFile(f);
    });
  };
})();

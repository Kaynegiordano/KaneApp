// Mises à jour (releases GitHub) : vérification au démarrage, téléchargement et installation sur demande.
'use strict';
(() => {
  const h = KS.h, C = KS.cmd;
  const N = KS.native;
  const up = KS.updates = { available: !!(N && N.updateCheck), version: '1.0.0', packaged: false, state: { status: 'idle' } };
  if (!up.available) return;

  let manual = false, dlg = null, prog = null;
  const close = () => { if (dlg) { dlg.close(); dlg = null; } };
  const show = (title, body, buttons) => { close(); dlg = KS.modal({ title, body, buttons }); };
  const text = (t, extra) => h('div', { style: { width: '420px', lineHeight: '1.5' } }, h('div', { text: t }), extra || null);

  function render(s) {
    if (s.status === 'available') {
      if (!manual && KS.prefs.skipUpdate === s.version) return;
      show('Mise à jour disponible', text('KaneApp ' + s.version + ' est disponible (vous avez la version ' + up.version + ').',
        h('div.note', { style: { marginTop: '8px' }, text: 'Le téléchargement se fait depuis GitHub ; vos documents ouverts ne sont pas touchés.' })), [
        { label: 'Ignorer cette version', action: () => { KS.prefs.skipUpdate = s.version; KS.prefs.save(); } },
        { label: 'Plus tard' },
        { label: 'Télécharger', primary: true, action: () => { manual = true; N.updateDownload(); } },
      ]);
    } else if (s.status === 'downloading') {
      const label = 'Téléchargement de KaneApp ' + (s.version || '') + '… ' + (s.percent || 0) + ' %';
      if (prog && prog.isConnected) prog.textContent = label;
      else { prog = h('div', { text: label }); show('Téléchargement', h('div', { style: { width: '420px' } }, prog), [{ label: 'En arrière-plan' }]); }
    } else if (s.status === 'ready') {
      const dirty = KS.state.docs.some(d => d.dirty);
      show('Prêt à installer', text('KaneApp ' + s.version + ' est téléchargé. KaneApp va se fermer puis se rouvrir.',
        dirty ? h('div.note', { style: { marginTop: '8px' }, text: 'Des documents ont des modifications non enregistrées : enregistrez-les d\'abord (ou laissez la récupération automatique les protéger).' }) : null), [
        { label: 'Plus tard' },
        { label: 'Redémarrer et installer', primary: true, action: () => N.updateInstall() },
      ]);
    } else if (manual && s.status === 'none') {
      KS.toast('KaneApp est à jour (version ' + up.version + ')', 'ok'); manual = false;
    } else if (manual && s.status === 'error') {
      KS.toast('Mise à jour impossible : ' + (s.error || 'erreur inconnue'), 'err', 5000); manual = false;
    } else if (manual && s.status === 'checking') {
      KS.toast('Recherche de mises à jour…', 'info', 1500);
    }
  }

  N.onUpdateStatus(s => { up.state = s; render(s); });
  N.appVersion().then(v => { up.version = v.version; up.packaged = v.packaged; });

  C.checkUpdates = async () => {
    if (!up.packaged) { KS.toast('Les mises à jour ne fonctionnent que dans la version installée', 'info', 3000); return; }
    manual = true;
    const r = await N.updateCheck();
    if (r && r.status === 'available') render(r);
  };
})();

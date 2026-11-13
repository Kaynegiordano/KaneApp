// Moteur IA intégré : Kanevas démarre lui-même le moteur de Forge quand on en a besoin (Studio IA, génération),
// réutilise celui de Kane OS s'il tourne, et l'arrête en quittant. Voyant d'état dans la barre de titre.
'use strict';
(() => {
  const h = KS.h, ui = KS.ui, N = KS.native;
  const E = KS.engine = { url: '', state: 'off', error: '', ours: false, tail: [], profile: '' };
  if (!N || !N.engineStatus) { KS.engine = null; return; }
  const LABEL = { off: 'IA arrêtée', starting: 'IA : démarrage…', ready: 'IA prête', external: 'IA prête (Kane OS)', error: 'IA : erreur' };
  let chip = null, waiters = [];
  const apply = s => {
    Object.assign(E, { state: s.state, url: s.state === 'ready' || s.state === 'external' ? s.url : '', error: s.error || '', ours: s.ours, tail: s.tail || [], profile: s.profile || '' });
    if (chip) {
      chip.dataset.state = s.state;
      chip.querySelector('.eg-l').textContent = LABEL[s.state] || s.state;
      chip.title = s.state === 'error' ? s.error : s.state === 'ready' ? 'Moteur de Forge démarré par KaneApp (' + E.profile + ')' : s.state === 'external' ? 'Moteur de Forge lancé par Kane OS' : 'Cliquer pour démarrer ou arrêter le moteur IA';
    }
    if (s.state === 'ready' || s.state === 'external' || s.state === 'error' || s.state === 'off') { const w = waiters; waiters = []; w.forEach(f => f(s)); }
    KS.emit('engine', E);
  };
  N.onEngine(apply);
  E.refresh = async () => apply(await N.engineStatus());
  E.ready = () => E.state === 'ready' || E.state === 'external';
  E.start = async () => {
    const s = await N.engineStart(KS.prefs.engineProfile || undefined);
    apply(s);
    return s;
  };
  E.stop = async explicit => apply(await N.engineStop(explicit === true));
  // Prêt à générer ? Sinon démarre le moteur (sauf préférence contraire) et attend, journal à l'appui.
  E.ensure = async ({ quiet = false } = {}) => {
    await E.refresh();
    if (E.ready()) return true;
    if (E.state !== 'starting') {
      if (KS.prefs.engineAuto === false) { if (!quiet) KS.toast('Moteur IA arrêté : démarrez-le (voyant « IA » de la barre de titre)', 'info', 4000); return false; }
      await E.start();
      if (E.ready()) return true;
      if (E.state === 'error') { KS.toast('Moteur IA : ' + E.error, 'err', 6000); return false; }
    }
    const done = new Promise(res => waiters.push(res));
    const s = await KS.gen.task('Démarrage du moteur IA (Forge, profil ' + (E.profile || 'Kane OS') + ')…', () => done, {
      progress: async () => { await E.refresh(); return { p: null, text: (E.tail || []).slice(-1)[0] }; },
    });
    if (s.state === 'error') { KS.toast('Moteur IA : ' + s.error, 'err', 6000); return false; }
    return E.ready();
  };

  const menu = () => {
    const r = chip.getBoundingClientRect();
    ui.menu([
      { head: LABEL[E.state] + (E.profile && E.ours ? ' · ' + E.profile : '') },
      { label: 'Démarrer le moteur IA', icon: 'sparkles', action: () => E.ensure(), disabled: E.ready() || E.state === 'starting' },
      { label: 'Arrêter le moteur IA', icon: 'close', action: () => E.stop(), disabled: !E.ours || !(E.state === 'ready' || E.state === 'starting') },
      { label: 'Journal du moteur…', icon: 'history', action: showLog },
      { sep: true },
      { label: 'Démarrer automatiquement quand il le faut', checked: () => KS.prefs.engineAuto !== false, action: () => { KS.prefs.engineAuto = KS.prefs.engineAuto === false; KS.prefs.save(); } },
      { label: 'Choisir le profil…', action: pickProfile },
      { label: 'Ouvrir le dossier des images générées', icon: 'folder-open', action: () => N.openOutputs() },
    ], r.right - 260, r.bottom + 4);
  };
  async function showLog() {
    const pre = h('pre.eg-log', { text: await N.engineLog() || '(vide)' });
    KS.modal({ title: 'Journal du moteur IA', width: 760, body: pre, buttons: [{ label: 'Fermer', primary: true }] });
    setTimeout(() => { pre.scrollTop = pre.scrollHeight; }, 30);
  }
  async function pickProfile() {
    const p = await N.engineProfiles();
    if (!p.profiles.length) return KS.toast('Aucun profil Kane OS trouvé : arguments par défaut', 'info');
    let v = KS.prefs.engineProfile || p.profiles[0].id;
    const sel = ui.select(p.profiles.map(x => [x.id, x.name]), v, x => { v = x; args.textContent = p.profiles.find(q => q.id === x)?.args || ''; });
    const args = h('div.note', { text: p.profiles.find(q => q.id === v)?.args || '' });
    KS.modal({ title: 'Profil du moteur IA', width: 560, body: h('div.form-col', { style: { gap: '8px' } }, h('div.note', { text: 'Profils de Forge de Kane OS (' + p.data + '). Pris en compte au prochain démarrage du moteur.' }), sel, args),
      buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok', action: () => { KS.prefs.engineProfile = v; KS.prefs.save(); } }] });
  }
  KS.on('ui-ready', () => {
    const box = KS.$('#workspace-actions'); if (!box) return;
    chip = h('button.eg-chip', { 'data-state': 'off' }, h('span.eg-dot'), h('span.eg-l', { text: LABEL.off }));
    chip.addEventListener('click', menu);
    box.prepend(chip);
    E.refresh();
  });
  setInterval(() => { if (!document.hidden) E.refresh(); }, 15000);
  E.showLog = showLog; E.pickProfile = pickProfile;
  KS.cmd.engineStart = () => E.ensure();
  KS.cmd.engineStop = () => E.stop();
})();

// Sauvegardes de secours locales, indépendantes du fichier de travail.
'use strict';
(() => {
  const states = new WeakMap();
  let running = null, timer = null, interval = null, ready = false, warned = false, pointerDown = false;
  const native = KS.native;
  const available = !!native?.recoveryWrite;
  const R = KS.recovery = {};
  const state = doc => {
    if (!states.has(doc)) states.set(doc, { id: crypto.randomUUID(), savedRevision: -1, closed: false });
    return states.get(doc);
  };
  const safe = () => !pointerDown && !KS.modalOpen() && !KS.textTool?.ed && !KS.pickingColor && !KS.panels.defs.properties?.editing && !KS.state.docs.some(d => d.layers.some(l => l.override));
  R.status = { phase: available ? 'waiting' : 'unavailable', savedAt: null };
  const status = (phase, savedAt = R.status.savedAt) => { R.status = { phase, savedAt }; KS.emit('recovery-status', R.status); };
  R.configure = () => {
    clearInterval(interval); clearTimeout(timer);
    if (available && KS.prefs.autoRecovery !== false) {
      interval = setInterval(() => R.flush(), Math.max(15, Number(KS.prefs.recoveryInterval) || 30) * 1000);
      status('waiting');
    } else status(available ? 'disabled' : 'unavailable');
  };
  function schedule() {
    if (!ready || !available || KS.prefs.autoRecovery === false) return;
    clearTimeout(timer); timer = setTimeout(() => R.flush(), 5000);
  }
  R.flush = () => {
    if (running) return running;
    if (!ready || !available || KS.prefs.autoRecovery === false || !safe()) return Promise.resolve(false);
    running = (async () => {
      let saved = false;
      for (const doc of KS.state.docs.slice()) {
        const s = state(doc), revision = doc.revision || 0;
        if ((!doc.dirty && doc.path) || s.closed || revision === s.savedRevision) continue;
        if (!safe()) break;
        status('saving');
        const data = await KS.io.writeKSP(doc);
        if (s.closed || !KS.state.docs.includes(doc)) continue;
        const result = await native.recoveryWrite(s.id, { name: doc.name, path: doc.path, format: doc.format }, data);
        if (!result.ok) throw new Error(result.error);
        s.savedRevision = revision; saved = true;
        status('saved', result.savedAt); warned = false;
      }
      return saved;
    })().catch(err => {
      status('error');
      if (!warned) { KS.toast('Sauvegarde de secours impossible : ' + (err.message || err), 'err', 6000); warned = true; }
      return false;
    }).finally(() => { running = null; });
    return running;
  };
  R.forget = async doc => {
    if (!available) return;
    const s = state(doc); s.closed = true;
    if (running) await running;
    const result = await native.recoveryRemove(s.id);
    if (!result.ok) { KS.toast('La copie de secours reste sur disque : ' + result.error, 'err'); return; }
    s.savedRevision = -1;
  };
  R.saved = async doc => {
    if (doc.dirty) return;
    await R.forget(doc);
    state(doc).closed = false;
  };
  R.restore = async entries => {
    let count = 0;
    for (const entry of entries) {
      try {
        if (KS.state.docs.some(d => state(d).id === entry.id)) continue;
        const record = await native.recoveryRead(entry.id);
        if (!record.ok) throw new Error(record.error);
        const doc = await KS.io.readKSP({ name: record.name, data: record.data });
        doc.path = record.path; doc.format = record.format || 'ksp'; doc.dirty = true;
        doc.history.items[0].name = 'Récupération automatique';
        states.set(doc, { id: entry.id, savedRevision: -1, closed: false });
        KS.addDoc(doc); count++;
      } catch (err) { KS.toast('Récupération impossible de « ' + entry.name + ' » : ' + err.message, 'err', 6000); }
    }
    if (count) KS.toast(count + ' document(s) récupéré(s). Pensez à les enregistrer.', 'ok', 6000);
    schedule(); return count;
  };
  R.show = async () => {
    if (!available) return;
    try {
      const result = await native.recoveryList();
      if (!result.ok) throw new Error(result.error);
      const ids = new Set(KS.state.docs.map(d => state(d).id));
      const entries = result.entries.filter(e => !ids.has(e.id));
      if (!entries.length) { if (result.unreadable) KS.toast('Certaines copies de secours sont illisibles. Elles ont été conservées sur disque.', 'err', 6000); return; }
      const h = KS.h, ui = KS.ui, selected = new Set(entries.map(e => e.id));
      const body = h('div', h('p', { text: 'KaneApp a retrouvé des documents non enregistrés. Choisissez ceux à récupérer.' }));
      for (const e of entries) {
        body.appendChild(h('div', { style: { padding: '10px 0', borderBottom: '1px solid var(--border)' } },
          ui.check(e.name + ' — ' + new Date(e.savedAt).toLocaleString('fr-FR'), true, v => v ? selected.add(e.id) : selected.delete(e.id)),
          h('div.note', { text: e.path || 'Document sans fichier', style: { overflowWrap: 'anywhere' } })));
      }
      if (result.unreadable) body.appendChild(h('p.note', { text: 'Certaines copies sont illisibles ; elles sont conservées sur disque.' }));
      const dialog = KS.modal({ title: 'Récupérer votre travail', width: 620, body,
        buttons: [{ label: 'Plus tard', value: null }, { label: 'Récupérer la sélection', primary: true, action: async () => { if (!selected.size) return false; await R.restore(entries.filter(e => selected.has(e.id))); } }],
        left: [ui.btn('Supprimer les copies…', async () => {
          const chosen = entries.filter(e => selected.has(e.id));
          if (!chosen.length || !(await KS.confirm('Supprimer définitivement les ' + chosen.length + ' copie(s) sélectionnée(s) ?', { danger: true, ok: 'Supprimer' }))) return;
          for (const e of chosen) { const r = await native.recoveryRemove(e.id); if (!r.ok) { KS.toast(r.error, 'err'); return; } }
          dialog.close(null); R.show();
        }, '.small')],
      });
    } catch (err) { KS.toast('Lecture des sauvegardes de secours impossible : ' + err.message, 'err'); }
  };
  R.init = () => {
    ready = true; R.configure();
    KS.on('history', schedule); KS.on('doc-meta', schedule); KS.on('doc', schedule);
    window.addEventListener('pointerdown', () => { pointerDown = true; }, true);
    window.addEventListener('pointerup', () => { pointerDown = false; schedule(); }, true);
    window.addEventListener('pointercancel', () => { pointerDown = false; }, true);
    window.addEventListener('blur', () => { pointerDown = false; R.flush(); });
    if (available) R.show();
  };
})();

// Passages figés : repère, dans les plans vidéo, les moments où l'image ne bouge plus
// (fin des boucles FL2VA de MiniMax, départ immobile…) et les retire de la timeline.
// L'analyse se fait dans le processus principal (freeze-detect.cjs) ; ici, le dialogue
// et la coupe, annulable en une fois. Le son lié (groupe) est coupé avec l'image et la
// suite des pistes concernées se resserre ; les autres pistes ne bougent pas.
'use strict';
(() => {
  const h = KC.h, U = KC.util, P = KC.P, N = KC.native;
  const F = KC.freeze = {};

  // Plage du média lue par l'événement (secondes du fichier), ou la raison de l'écarter
  F.sourceRange = (ev, m) => {
    if (!m || m.kind !== 'video' || !m.hasVideo) return { error: 'pas un plan vidéo' };
    if (!(ev.speed > 0)) return { error: 'lecture inversée' };
    const start = ev.offset, end = ev.offset + ev.length * ev.speed;
    if (m.duration && end > m.duration + 1 / (m.fps || P.fps()) + 1e-6) return { error: 'l\'événement répète le média (boucle)' };
    return { start, end };
  };

  // Retire de l'événement les plages du fichier [t0, t1[ (secondes du média).
  // Annulable par l'appelant (KC.edit). Retourne la durée retirée de la timeline.
  F.cut = (ev, ranges) => {
    const members = KC.sel.expand([ev]);
    const tracks = [...new Set(members.map(e => e.track))];
    const start = ev.start, offset = ev.offset, speed = ev.speed, end = P.end(ev);
    let removed = 0;
    for (const [t0, t1] of [...ranges].sort((a, b) => b[0] - a[0])) {
      const a = U.clamp(P.snapFrame(start + (t0 - offset) / speed), start, end);
      const b = U.clamp(P.snapFrame(start + (t1 - offset) / speed), start, end);
      if (b - a < P.frame() - 1e-6) continue;
      KC.editing.clearRange(a, b, tracks);
      for (const e of KC.project.events) if (tracks.includes(e.track) && e.start >= b - 1e-6) e.start = P.snapFrame(e.start - (b - a));
      removed += b - a;
    }
    P.recalcCrossfades(tracks);
    return removed;
  };

  // Plages à retirer d'une analyse, en secondes du média
  F.ranges = (res, edgesOnly) => res.runs
    .filter(r => !edgesOnly || r.where !== 'milieu')
    .map(r => [res.start + r.drop[0] / res.fps, res.start + (r.drop[1] + 1) / res.fps]);

  const secs = t => U.fmtNum(t, 2) + ' s';
  function describe(res, edgesOnly) {
    if (!res.ok) return [res.error];
    if (res.still) return ['image figée du début à la fin : rien à couper'];
    if (res.tooMany) return [`passages figés trop longs (${secs(res.dropped / res.fps)} sur ${secs(res.frames / res.fps)}) : plan laissé tel quel`];
    const runs = res.runs.filter(r => !edgesOnly || r.where !== 'milieu');
    if (!runs.length) return ['aucune image figée'];
    return runs.map(r => {
      const len = r.b - r.a + 1, at = res.start + r.a / res.fps;
      if (r.duplicate) return 'dernière image identique à la première : retirée';
      const what = r.where === 'fin' && r.loop ? 'retirée, la première image fait la jonction de boucle' : `${len} images → 1`;
      return `${r.where === 'début' ? 'Début figé' : r.where === 'fin' ? 'Fin figée' : 'Milieu figé'} à ${secs(at)} (${secs(len / res.fps)}) : ${what}`;
    });
  }

  // Plans concernés : la sélection, sinon tous les plans vidéo du montage
  function targets(list) {
    let evs = (list || KC.sel.list()).filter(e => P.kindOf(e) === 'video' && e.media);
    if (!evs.length && !list) evs = KC.project.events.filter(e => P.kindOf(e) === 'video' && e.media);
    return evs.filter(e => (P.media(e.media) || {}).kind === 'video').sort((a, b) => a.start - b.start);
  }

  KC.cmd.cutFreezes = async (list = null) => {
    if (!N || !N.freezeAnalyze) { KC.toast('Analyse indisponible dans cette version', 'err'); return; }
    const evs = targets(list);
    if (!evs.length) { KC.toast('Aucun plan vidéo à analyser', 'info'); return; }
    KC.engine.pause();
    const status = h('div', { style: { minWidth: '360px' }, text: 'Préparation…' });
    const wait = KC.modal({ title: 'Passages figés', body: status, buttons: [] });
    const found = [];
    for (const [i, ev] of evs.entries()) {
      const m = P.media(ev.media);
      status.textContent = `Analyse du plan ${i + 1} sur ${evs.length} : ${m.name}…`;
      const src = F.sourceRange(ev, m);
      const res = src.error ? { ok: false, error: src.error }
        : await N.freezeAnalyze(m.path, { ...src, fps: m.fps || P.fps(), width: m.width, height: m.height });
      found.push({ ev, m, res });
    }
    wait.close();

    let edgesOnly = !!KC.prefs.freezeEdgesOnly;
    const list_ = h('div', { style: { display: 'grid', gap: '10px', maxHeight: '50vh', overflow: 'auto' } });
    const total = h('div', { style: { fontWeight: 600 } });
    const usable = f => f.res.ok && !f.res.still && !f.res.tooMany;
    const render = () => {
      list_.replaceChildren();
      let sum = 0;
      for (const f of found) {
        const lines = describe(f.res, edgesOnly);
        if (usable(f)) sum += F.ranges(f.res, edgesOnly).reduce((s, [a, b]) => s + (b - a) / f.ev.speed, 0);
        list_.append(h('div', h('div', { style: { fontWeight: 600 }, text: `${f.m.name} — à ${U.fmtTime(f.ev.start, P.fps())}` }),
          ...lines.map(t => h('div.note', { text: t }))));
      }
      total.textContent = sum > 0 ? `Durée retirée : ${secs(sum)}` : 'Rien à couper.';
      go.disabled = !(sum > 0);
    };
    const edges = KC.ui.check('Ne couper qu\'au début et à la fin (garder les pauses du milieu)', edgesOnly, v => { edgesOnly = v; KC.prefs.freezeEdgesOnly = v; KC.prefs.save(); render(); });
    const body = h('div', { style: { width: '620px', display: 'grid', gap: '12px' } },
      h('div.note', { text: 'Une image figée est retirée quand aucune zone ne bouge, même un peu ; le seuil s\'adapte au bruit de chaque vidéo. Le son lié est coupé avec l\'image et la suite des mêmes pistes se resserre. Ctrl+Z annule.' }),
      list_, edges, total);
    const go = h('button.btn.primary', { html: KC.icon('cut') + 'Couper' });
    const dlg = KC.modal({ title: 'Passages figés', body, buttons: [{ label: 'Annuler' }] });
    dlg.el.querySelector('.modal-foot').appendChild(go);
    render();
    go.addEventListener('click', () => {
      dlg.close();
      let removed = 0, plans = 0;
      KC.edit('Couper les passages figés', () => {
        // de droite à gauche : les coupes déjà faites ne décalent pas les plans restants
        for (const f of [...found].reverse()) {
          if (!usable(f) || !P.event(f.ev.id)) continue;
          const r = F.cut(f.ev, F.ranges(f.res, edgesOnly));
          if (r > 0) { removed += r; plans++; }
        }
      });
      KC.sel.clean(); KC.emit('selection');
      KC.toast(removed > 0 ? `${secs(removed)} retirées sur ${plans} plan${plans > 1 ? 's' : ''}` : 'Rien n\'a été coupé', removed > 0 ? 'ok' : 'info', 3500);
    });
  };
})();

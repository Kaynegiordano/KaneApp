// Une seule jauge dans le cadre commun, y compris lorsque Studio est arrêté.
'use strict';
(() => {
  const root = document.querySelector('#gpu-status');
  const value = root.querySelector('.gpu-memory-value'), bar = root.querySelector('progress');
  let pending;
  async function read() {
    try {
      const r = await KS.native?.gpuMemory?.();
      if (!r?.ok || !Number.isFinite(r.used) || !Number.isFinite(r.total) || !Number.isFinite(r.measuredAt) || r.total <= 0 || r.used < 0 || r.used > r.total || Date.now() - r.measuredAt > 10000) throw new Error('Mesure indisponible');
      const percent = Math.round(r.used / r.total * 100);
      value.textContent = `${Math.round(r.used).toLocaleString('fr-FR')} / ${Math.round(r.total).toLocaleString('fr-FR')} Mo`;
      bar.value = percent; bar.hidden = false;
      root.dataset.state = percent >= 90 ? 'high' : 'ready';
      root.title = 'Mémoire graphique utilisée par toutes les applications · actualisée toutes les 3 secondes · clic : libérer\n' +
        (r.devices || []).map(d => `${d.name} : ${Math.round(d.used)} / ${Math.round(d.total)} Mo`).join('\n');
    } catch {
      value.textContent = 'Indisponible'; bar.hidden = true;
      root.dataset.state = 'unavailable';
      root.title = 'Le pilote NVIDIA ne fournit pas de mesure. Nouvelle tentative automatique toutes les 3 secondes.';
    }
  }
  function refresh() {
    if (document.hidden) return Promise.resolve();
    if (!pending) pending = read().finally(() => { pending = null; });
    return pending;
  }
  KS.gpuMemory = { refresh };
  setInterval(refresh, 3000);

  // Clic sur la jauge : libérer la mémoire graphique maintenant (modèle du Studio, modèles de ComfyUI), ou
  // décharger automatiquement le Studio après un délai sans génération (réglage aussi dans Préférences › IA).
  const N = KS.native;
  const idle = () => KS.prefs.vramIdle ?? 30;
  const tell = minutes => { try { N?.vramIdle?.(minutes)?.catch?.(() => {}); } catch { /* processus principal sans ce réglage */ } };
  tell(idle());
  const used = async () => { const r = await N.gpuMemory(); return r?.ok ? r.used : null; };
  async function release() {
    const before = await used();
    KS.toast('Libération de la mémoire graphique…', 'info', 2500);
    const r = await N.vramRelease();
    const parts = [r.studio === 'freed' && 'Studio', r.comfy === 'freed' && 'ComfyUI'].filter(Boolean);
    if (!parts.length) {
      KS.toast(r.studio === 'busy' || r.comfy === 'busy' ? 'Une génération est en cours : ses modèles restent chargés.' : r.studio === 'external' ? 'Le moteur utilisé est le Forge de Kane OS : arrêtez-le depuis Kane OS pour libérer sa mémoire.' : 'Aucun modèle de KaneApp n’occupait la mémoire graphique.', 'info', 5000);
      return;
    }
    await new Promise(res => setTimeout(res, 3500));          // relevé suivant du pilote
    const after = await used(); refresh();
    const freed = before != null && after != null ? Math.round(before - after) : 0;
    KS.toast(`Mémoire graphique libérée${freed > 50 ? ' : ' + freed.toLocaleString('fr-FR') + ' Mo' : ''} (${parts.join(', ')}). Rechargée à la prochaine génération.`, 'ok', 6000);
  }
  KS.gpuMemory.release = release;
  KS.gpuMemory.setIdle = minutes => { KS.prefs.vramIdle = minutes; KS.prefs.save(); tell(minutes); };
  function menu() {
    if (!N?.vramRelease) return;
    const r = root.getBoundingClientRect();
    const opt = (m, label) => ({ label, checked: () => idle() === m, action: () => KS.gpuMemory.setIdle(m) });
    KS.ui.menu([
      { head: 'Mémoire graphique' },
      { label: 'Libérer maintenant', icon: 'sparkles', action: () => release().catch(e => KS.toast(e.message, 'err')) },
      { sep: true },
      { head: 'Décharger le Studio sans génération depuis' },
      opt(10, '10 minutes'), opt(30, '30 minutes'), opt(60, '1 heure'), opt(0, 'Jamais'),
    ], r.right - 270, r.top - 4, { up: true });
  }
  root.tabIndex = 0; root.setAttribute('role', 'button');
  root.addEventListener('click', menu);
  root.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); menu(); } });
  document.addEventListener('visibilitychange', () => {
    // Ne pas laisser une ancienne valeur visible après une mise en veille.
    value.textContent = 'Lecture…'; bar.hidden = true; root.dataset.state = 'loading';
    if (!document.hidden) refresh();
  });
  refresh();
})();

// Merge : fusion de modèles dans le Studio IA. Trois modes, un seul calcul dans merge_bridge.py (Python du Studio) :
//   LoRA + LoRA            → un nouveau LoRA (exact, rangs additionnés ; ou recompressé au rang voulu)
//   Checkpoint + Checkpoint → un nouveau checkpoint (somme pondérée, différence ajoutée, dégradé le long des blocs)
//   LoRA → Checkpoint      → un checkpoint qui contient déjà les LoRA (plus rien à charger à la génération)
// La page ne manipule que des identifiants de modèles ; les fichiers sont lus et écrits côté application, jamais écrasés.
'use strict';
(() => {
  const h = KS.h, N = KS.native;
  const F = () => KS.fxui;
  const S = {
    list: null, loading: false, tab: 'lora', info: {}, running: false, pct: 0, text: '', result: null, error: '', unsub: null,
    lora: { items: [{ id: '', weight: 0.6 }, { id: '', weight: 0.6 }], method: 'concat', rank: 32 },
    ckpt: { a: '', b: '', c: '', mode: 'sum', alpha: 0.5, gradient: false, alphaEnd: 0.8 },
    inject: { model: '', items: [{ id: '', weight: 1 }] },
    embed: { model: '' },
    parts: { vae: '', te: '' },
    dtype: 'source', name: '', nameEdited: false,
  };
  let root = null;
  const mb = n => n >= 2 ** 30 ? (n / 2 ** 30).toFixed(1) + ' Go' : Math.round(n / 2 ** 20) + ' Mo';
  const stem = id => String(id || '').replace(/^(ckpt|lora):/, '').replace(/\.safetensors$/i, '').split('/').pop();

  async function load(force) {
    if (S.loading || (S.list && !force)) return;
    S.loading = true; draw();
    const r = await N.mergeList();
    S.loading = false;
    if (r.ok) { S.list = r; S.error = ''; } else S.error = r.error;
    draw();
  }
  async function inspect(id) {
    if (!id || S.info[id] || S.running) return;
    S.info[id] = { pending: true };
    const r = await N.mergeInspect([id]);
    S.info[id] = r.ok && r.files && r.files[0] ? r.files[0] : { error: r.error || 'illisible' };
    refreshNotes();
  }

  /* ---------------------------------------------------------------- pièces d'interface */
  function picker(kind, obj, key, label, { optional = false } = {}) {
    const list = S.list ? ({ ckpt: S.list.checkpoints, lora: S.list.loras, vae: S.list.vaes, te: S.list.encoders }[kind] || []) : [];
    const sel = h('select.fx-sel', h('option', { value: '', text: optional ? '— aucun —' : '— choisir —' }), ...list.map(m => h('option', { value: m.id, text: m.name + ' · ' + mb(m.size) })));
    sel.value = obj[key] || '';
    sel.addEventListener('change', () => { obj[key] = sel.value; inspect(sel.value); autoName(); draw(); });
    return label ? F().field(label, sel) : sel;
  }
  const noteFor = id => {
    if (!id) return '';
    const i = S.info[id]; if (!i) return '';
    if (i.pending) return '… lecture';
    if (i.error) return '⚠️ ' + i.error;
    return [i.arch, i.kind === 'lora' ? `LoRA rang ${i.rank} · ${i.modules} modules` : i.kind === 'vae' ? 'VAE' : i.kind === 'text_encoder' ? 'encodeur de texte' : 'checkpoint', i.dtype, mb(i.size)].join(' · ') + (i.unsupported ? ` · ⚠️ ${i.unsupported} tenseurs LoHa/LoKr ignorés` : '') + (i.recipe ? ' · issu d’une fusion' : '');
  };
  const noteEl = id => h('div.fx-info.mg-note', { 'data-id': id || '', text: noteFor(id) });
  function refreshNotes() {
    if (!root) return;
    root.querySelectorAll('.mg-note[data-id]').forEach(el => { el.textContent = noteFor(el.dataset.id); });
    const w = root.querySelector('.mg-warn'); if (w) w.innerHTML = F().md(warning());
    const g = root.querySelector('.mg-go'); if (g) g.disabled = S.running || !ready() || !!warning();
  }
  // modèles d'architectures différentes : le résultat serait incohérent
  function warning() {
    const ids = S.tab === 'lora' ? S.lora.items.map(x => x.id) : S.tab === 'ckpt' ? [S.ckpt.a, S.ckpt.b, S.ckpt.mode === 'diff' ? S.ckpt.c : ''] : S.tab === 'inject' ? [S.inject.model, ...S.inject.items.map(x => x.id)] : [S.embed.model];
    const withParts = S.tab !== 'lora' ? [...ids, S.parts.vae, S.parts.te] : ids;
    const archs = [...new Set(withParts.filter(Boolean).map(i => S.info[i] && S.info[i].arch).filter(a => a && a !== 'inconnue'))];
    if (archs.length > 1) return '⚠️ **Architectures différentes** (' + archs.join(', ') + ') : ces modèles ne peuvent pas être fusionnés ensemble.';
    const base = S.info[ids[0]];
    if ((S.parts.vae || S.parts.te) && S.tab !== 'lora' && base && base.arch && base.arch !== 'anima') return '⚠️ Intégrer le VAE et l’encodeur est prévu pour les checkpoints **ANIMA** (ici : ' + base.arch + ').';
    return '';
  }
  function autoName() {
    if (S.nameEdited) return;
    const s = S.tab === 'lora' ? ['mix', ...S.lora.items.map(x => stem(x.id)).filter(Boolean)] : S.tab === 'ckpt' ? ['mix', stem(S.ckpt.a), stem(S.ckpt.b)].filter(Boolean)
      : S.tab === 'embed' ? [stem(S.embed.model), 'complet'] : [stem(S.inject.model), ...S.inject.items.map(x => stem(x.id)).filter(Boolean)].filter(Boolean);
    S.name = s.length > 1 ? s.join('_').slice(0, 70) : '';
    const el = root && root.querySelector('.mg-name'); if (el) el.value = S.name;
  }
  function loraRows(items, max, optionalFirst) {
    const box = h('div.mg-rows');
    items.forEach((it, i) => {
      const sl = F().slider('Force', it, 'weight', -1, 2, 0.05, 'Poids de ce LoRA dans le mélange (1 = plein effet ; négatif = effet inversé)');
      const rm = h('button.mg-x', { text: '×', title: 'Retirer', disabled: items.length <= (optionalFirst ? 1 : 1) });
      rm.addEventListener('click', () => { items.splice(i, 1); draw(); });
      box.appendChild(h('div.mg-row', h('div.mg-pick', picker('lora', it, 'id', 'LoRA ' + (i + 1)), noteEl(it.id)), sl, rm));
    });
    if (items.length < max) {
      const add = F().tbtn('＋ Ajouter un LoRA', () => { items.push({ id: '', weight: 0.6 }); draw(); });
      box.appendChild(add);
    }
    return box;
  }

  // VAE et encodeur de texte intégrés au checkpoint produit : un fichier qui se charge seul, sans module à côté dans le Studio
  function partsBox(required) {
    const P = S.parts;
    return h('div.mg-parts', h('div.fx-h', { text: required ? 'À intégrer' : 'Intégrer aussi (facultatif)' }),
      h('div.fx-info', { text: 'Le VAE et l’encodeur de texte (Qwen3 0.6B) entrent dans le fichier. Dans le Studio, laissez alors « VAE / Text Encoder » vide : Forge utilise ceux du fichier. ANIMA uniquement ; le fichier grossit d’environ 1,5 Go.' }),
      h('div.lt-grid3', h('div', picker('vae', P, 'vae', 'VAE', { optional: true }), noteEl(P.vae)), h('div', picker('te', P, 'te', 'Encodeur de texte', { optional: true }), noteEl(P.te))));
  }

  /* ---------------------------------------------------------------- les modes */
  function loraPanel() {
    const L = S.lora;
    return h('div.fx-panel.lt-card', h('div.fx-h', { text: 'LoRA + LoRA' }),
      h('div.fx-info', { text: 'Mélange plusieurs LoRA en un seul fichier. « Exact » additionne les rangs : le résultat est identique à charger les LoRA ensemble avec les mêmes forces. « Recompressé » ramène la somme à un rang plus petit (fichier plus léger, léger écart).' }),
      loraRows(L.items, 8),
      h('div.lt-row', F().radio('Méthode', [['concat', 'Exact (rangs additionnés)'], ['svd', 'Recompressé (SVD)']], L, 'method', '', () => draw()),
        L.method === 'svd' ? F().slider('Rang final', L, 'rank', 4, 128, 4, 'Plus le rang est petit, plus le fichier est léger et plus l’écart avec la somme exacte grandit') : null));
  }
  function ckptPanel() {
    const C = S.ckpt, diff = C.mode === 'diff';
    return h('div.fx-panel.lt-card', h('div.fx-h', { text: 'Checkpoint + Checkpoint' }),
      h('div.fx-info', { text: 'Mélange deux checkpoints de la même architecture. Le fichier du premier sert de base : sa structure et ses noms de couches sont conservés.' }),
      F().radio('Mode', [['sum', 'Somme pondérée : A·(1−α) + B·α'], ['diff', 'Différence ajoutée : A + α·(B − C)']], C, 'mode', 'Différence ajoutée : transplante ce que B a appris de plus que C (son modèle de base) dans A', () => draw()),
      h('div.lt-grid3', h('div', picker('ckpt', C, 'a', diff ? 'A — modèle à améliorer' : 'A — base'), noteEl(C.a)), h('div', picker('ckpt', C, 'b', diff ? 'B — modèle spécialisé' : 'B — mélangé à A'), noteEl(C.b)),
        diff ? h('div', picker('ckpt', C, 'c', 'C — base de B (retirée)'), noteEl(C.c)) : null),
      F().slider(diff ? 'α — force' : 'α — part de B', C, 'alpha', diff ? 0 : 0, diff ? 2 : 1, 0.01, diff ? '1 = ajoute toute la différence B − C' : '0 = A seul · 1 = B seul · 0,5 = moitié-moitié'),
      F().check('Dégradé le long des blocs', C, 'gradient', 'α varie progressivement du premier au dernier bloc du réseau : par exemple la structure (premiers blocs) de A et le style (derniers blocs) de B', () => draw()),
      C.gradient ? F().slider('α au dernier bloc', C, 'alphaEnd', diff ? 0 : 0, diff ? 2 : 1, 0.01, 'α part de la valeur ci-dessus au premier bloc et arrive à celle-ci au dernier') : null,
      partsBox(false));
  }
  function injectPanel() {
    const I = S.inject;
    return h('div.fx-panel.lt-card', h('div.fx-h', { text: 'LoRA → Checkpoint' }),
      h('div.fx-info', { text: 'Fusionne un ou plusieurs LoRA dans un checkpoint : le LoRA fait partie du modèle, plus besoin de le charger ni de l’écrire dans l’invite. Les couches du checkpoint sont modifiées W ← W + force × (up · down) ; celles sans LoRA restent identiques.' }),
      h('div.lt-grid3', h('div', picker('ckpt', I, 'model', 'Checkpoint'), noteEl(I.model))),
      loraRows(I.items, 8), partsBox(false));
  }
  function embedPanel() {
    const E = S.embed;
    return h('div.fx-panel.lt-card', h('div.fx-h', { text: 'Tout-en-un : checkpoint + VAE + encodeur' }),
      h('div.fx-info', { text: 'Regroupe un checkpoint ANIMA, son VAE et son encodeur de texte dans un seul fichier, relu par Forge exactement comme avec les trois fichiers séparés (vérifié couche par couche).' }),
      h('div.lt-grid3', h('div', picker('ckpt', E, 'model', 'Checkpoint'), noteEl(E.model))), partsBox(true));
  }

  /* ---------------------------------------------------------------- lancement */
  const ready = () => {
    if (S.tab === 'lora') return S.lora.items.filter(x => x.id).length >= 2;
    if (S.tab === 'ckpt') return !!(S.ckpt.a && S.ckpt.b && (S.ckpt.mode !== 'diff' || S.ckpt.c)) && S.ckpt.a !== S.ckpt.b;
    if (S.tab === 'embed') return !!(S.embed.model && (S.parts.vae || S.parts.te));
    return !!(S.inject.model && S.inject.items.some(x => x.id));
  };
  function jobOf() {
    const base = { dtype: S.dtype, name: S.name || 'merge' };
    if (S.tab !== 'lora' && (S.parts.vae || S.parts.te)) base.embed = { vae: S.parts.vae || null, text_encoder: S.parts.te || null };
    if (S.tab === 'embed') return { ...base, kind: 'embed', model: S.embed.model };
    if (S.tab === 'lora') return { ...base, kind: 'loras', loras: S.lora.items.filter(x => x.id), method: S.lora.method, rank: S.lora.rank };
    if (S.tab === 'ckpt') {
      const C = S.ckpt;
      return { ...base, kind: 'checkpoints', models: [C.a, C.b, ...(C.mode === 'diff' ? [C.c] : [])], mode: C.mode, alpha: C.alpha, alpha_end: C.gradient ? C.alphaEnd : null };
    }
    return { ...base, kind: 'lora_into_checkpoint', model: S.inject.model, loras: S.inject.items.filter(x => x.id) };
  }
  async function run() {
    if (S.running || !ready()) return;
    if (warning()) return KS.toast('Ces modèles n’ont pas la même architecture', 'err', 5000);
    S.running = true; S.pct = 0; S.text = 'Démarrage…'; S.result = null; S.error = ''; draw();
    S.unsub && S.unsub();
    S.unsub = N.onMergeProgress(m => { S.pct = m.progress; S.text = m.text || ''; const bar = root && root.querySelector('.mg-bar > i'); if (bar) bar.style.width = S.pct + '%'; const t = root && root.querySelector('.mg-prog'); if (t) t.textContent = S.text; });
    const r = await N.mergeRun(jobOf());
    S.unsub && S.unsub(); S.unsub = null; S.running = false;
    if (r.ok) { S.result = r; S.list = null; KS.toast('Fusion terminée : ' + r.name, 'ok', 5000); await load(true); } else if (!r.cancelled) S.error = r.error; else S.error = 'Fusion annulée.';
    draw();
  }
  async function useResult() {
    const r = S.result; if (!r) return;
    const st = KS.studio;
    if (!st || !st.refreshModels) return KS.toast('Studio indisponible', 'err');
    if (!(await st.refreshModels())) return KS.toast('Le moteur IA n’est pas démarré : le fichier sera listé à son prochain démarrage', 'info', 5000);
    if (r.id.startsWith('ckpt:')) await st.useCheckpoint(r.id.replace(/^ckpt:/, ''));
    else KS.toast('LoRA prêt : ajoutez-le depuis la liste des LoRA du Studio', 'ok', 4000);
  }

  function resultBox() {
    if (S.error) return h('div.fx-md.mg-err', { html: F().md('⚠️ ' + S.error) });
    const r = S.result; if (!r) return null;
    const lines = [`✅ **${r.name}.safetensors** — ${mb(r.size)} en ${r.seconds} s.`];
    if (r.merged != null) lines.push(`${r.merged} couches mélangées sur ${r.layers}` + (r.kept ? ` · ${r.kept} gardées de A (absentes de B)` : '') + '.');
    if (r.rank) lines.push(`Rang du LoRA obtenu : ${r.rank} · ${r.modules} modules.`);
    if (r.embedded && r.embedded.length) lines.push('Intégrés au fichier : ' + r.embedded.join(', ') + ' — laissez « VAE / Text Encoder » vide dans le Studio.');
    for (const x of r.report || []) lines.push(`${x.name} : ${x.applied} / ${x.modules} modules appliqués` + (x.unmatched && x.unmatched.length ? ` (non appliqués, ex. ${x.unmatched[0]})` : '') + (x.unsupported ? ` · ${x.unsupported} tenseurs LoHa/LoKr ignorés` : '') + '.');
    lines.push(r.id.startsWith('ckpt:') ? 'Dossier : **KaneApp / output / merge** (listé par Forge dans Stable-diffusion / KaneApp).' : 'Dossier : **KaneApp / output / lora** (listé par Forge dans Lora / KaneApp).');
    return h('div.mg-result', h('div.fx-md', { html: F().md(lines.join('\n')) }), F().tbtn(r.id.startsWith('ckpt:') ? 'Utiliser dans le Studio' : 'Actualiser les LoRA du Studio', () => useResult(), '.primary'));
  }

  function draw() {
    if (!root || !root.isConnected) return;
    const { tbtn, select } = F();
    const sc = root.closest('.fx-body'), top = sc ? sc.scrollTop : 0;
    const tabs = F().tabs([['lora', 'LoRA + LoRA'], ['ckpt', 'Checkpoints'], ['inject', 'LoRA → Checkpoint'], ['embed', 'VAE + encodeur']], S.tab, v => { S.tab = v; S.nameEdited = false; autoName(); draw(); });
    const panel = !S.list ? h('div.fx-note', { text: S.loading ? 'Lecture des modèles…' : (S.error || 'Aucun modèle lu.') }) : S.tab === 'lora' ? loraPanel() : S.tab === 'ckpt' ? ckptPanel() : S.tab === 'inject' ? injectPanel() : embedPanel();
    const name = h('input.fx-in.mg-name', { placeholder: 'nom du fichier créé', spellcheck: false, value: S.name });
    name.addEventListener('input', () => { S.name = name.value; S.nameEdited = !!name.value; });
    const dt = h('select.fx-sel', ...[['source', 'Comme le modèle d’origine'], ['bf16', 'bf16'], ['fp16', 'fp16'], ['fp32', 'fp32 (fichier deux fois plus gros)']].map(([v, l]) => h('option', { value: v, text: l })));
    dt.value = S.dtype; dt.addEventListener('change', () => { S.dtype = dt.value; });
    const go = tbtn(S.running ? 'Fusion en cours…' : 'Fusionner', run, '.primary.lt-start.mg-go');
    go.disabled = S.running || !ready() || !!warning();
    const cancel = S.running ? tbtn('Annuler', async () => { await N.mergeCancel(); }, '') : null;
    const out = h('div.fx-panel.lt-card', h('div.fx-h', { text: 'Résultat' }),
      h('div.lt-row', F().field('Nom du nouveau fichier', name, 'Un fichier existant n’est jamais écrasé : un numéro est ajouté'), F().field('Précision', dt, 'bf16 et fp16 : même taille ; fp32 : plus précis, deux fois plus gros. En bf16, de très petites contributions de LoRA peuvent être arrondies.')),
      h('div.mg-warn.fx-md', { html: F().md(warning()) }),
      h('div.lt-row.lt-go', go, cancel),
      S.running ? h('div', h('div.lt-bar.mg-bar', h('i', { style: 'width:' + S.pct + '%' })), h('div.fx-info.mg-prog', { text: S.text })) : null,
      resultBox());
    const refresh = tbtn('Actualiser la liste', () => load(true), '.sm');
    root.replaceChildren(h('div.lt-col.mg-col', h('div.fx-panel.lt-card', h('div.fx-h', { text: 'Merge' }),
      h('div.lt-intro', { text: 'Mixer des LoRA, mélanger des checkpoints, fusionner des LoRA dans un checkpoint, ou y intégrer le VAE et l’encodeur de texte. Les fichiers d’origine ne sont jamais modifiés ; le résultat est un nouveau fichier listé par Forge.' }), h('div.lt-row', tabs, refresh)), panel, out));
    if (sc) sc.scrollTop = top;
    refreshNotes();
  }

  KS.mergeTab = {
    render(content) {
      root = content; draw(); load(false);
      for (const id of [S.ckpt.a, S.ckpt.b, S.ckpt.c, S.inject.model, S.embed.model, S.parts.vae, S.parts.te, ...S.lora.items.map(x => x.id), ...S.inject.items.map(x => x.id)]) inspect(id);
    },
  };
})();

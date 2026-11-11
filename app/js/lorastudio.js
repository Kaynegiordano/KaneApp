// Train LoRA : l'onglet d'entraînement de Forge (extension forge_lora_trainer) dans le Studio IA. Mêmes cartes, mêmes
// réglages et même ordre (Project, Preset, Captions, Training settings, entraînement) ; mêmes projets, dans le dossier
// lora_training de Forge. La passerelle lora_bridge.py fait tourner la bibliothèque de l'extension avec le Python de Forge.
'use strict';
(() => {
  const h = KS.h, N = KS.native, U = KS.util, ui = KS.ui;
  const S = { info: null, projects: [], cur: '', data: null, form: null, caps: {}, msgs: {}, run: null, power: false, poll: null, thumbs: new Map(), loading: '' };
  let root = null;
  const F = () => KS.fxui;
  const call = async (cmd, args = {}) => { const r = await N.loraCall(cmd, args); if (!r.ok) throw new Error(r.error); return r; };
  const isHash = n => /^[0-9a-f]{24,}$/i.test(n);
  const label = p => p.trigger ? p.trigger + (isHash(p.name) ? '' : ' — ' + p.name) : p.name;
  const msg = (key, text) => { S.msgs[key] = text; const el = root && root.querySelector(`[data-msg="${key}"]`); if (el) el.innerHTML = F().md(text); };
  const msgBox = key => h('div.fx-md', { 'data-msg': key, html: F().md(S.msgs[key] || '') });
  const busy = async (key, text, fn) => {
    msg(key, '⏳ ' + text);
    try { return await fn(); } catch (e) { msg(key, '⚠️ ' + e.message); throw e; }
  };
  async function thumb(file, w = 256) {
    const k = file + '|' + w;
    if (S.thumbs.has(k)) return S.thumbs.get(k);
    const r = await N.loraThumb(file, w);
    const u = r.ok ? URL.createObjectURL(new Blob([r.data], { type: 'image/jpeg' })) : '';
    S.thumbs.set(k, u);
    return u;
  }
  const img = (file, w) => { const i = h('img', { alt: '', loading: 'lazy' }); thumb(file, w).then(u => { if (u) i.src = u; }); return i; };

  /* ---------------------------------------------------------------- données */
  const FORM_KEYS = ['trigger', 'lora_type', 'steps', 'epochs', 'repeats', 'resolution', 'dim', 'learning_rate', 'optimizer', 'scope', 'multires', 'native_res', 'flip_aug',
    'network_dropout', 'caption_dropout_rate', 'lr_scheduler_num_cycles', 'rank_dropout', 'module_dropout', 'threshold', 'base_model', 'sample_every', 'sample_prompt'];
  const DEF = { trigger: '', lora_type: 'style', steps: 2000, epochs: 0, repeats: 10, resolution: 1024, dim: 20, learning_rate: 5e-5, optimizer: 'adamw8bit', scope: 'full',
    multires: false, flip_aug: false, network_dropout: 0, caption_dropout_rate: 0, lr_scheduler_num_cycles: 1, rank_dropout: 0, module_dropout: 0, threshold: 0.35,
    base_model: '', sample_every: 250, sample_prompt: '' };
  const saveForm = U.debounce(async () => {
    if (!S.cur || !S.form) return;
    const patch = {}; for (const k of FORM_KEYS) patch[k] = S.form[k];
    try { await call('save', { name: S.cur, patch }); } catch (e) { msg('train', '⚠️ ' + e.message); }
  }, 600);
  async function refreshProjects() { S.projects = (await call('list')).projects || []; }
  async function openProject(name) {
    S.cur = name; KS.prefs.loraProject = name; KS.prefs.save();
    if (!name) { S.data = null; S.form = null; S.caps = {}; return render(); }
    S.data = await call('load', { name });
    const m = S.data.manifest || {};
    S.form = { ...DEF, ...Object.fromEntries(FORM_KEYS.filter(k => m[k] != null).map(k => [k, m[k]])) };
    if (!S.form.base_model || !S.info.dits.some(d => d.path === S.form.base_model)) S.form.base_model = S.info.dit;
    if (S.form.scope && !S.info.scopes[S.form.scope]) S.form.scope = S.info.scope_default;
    S.caps = { ...(m.captions || {}) };
    const n = S.data.images.length;
    S.msgs.project = `${n} image(s) in **${label({ name, trigger: m.trigger })}**. Aperçus réduits ; originaux conservés pour l’entraînement.` + (S.data.note ? '\n\n' + S.data.note : '');
    const last = (S.data.runs || [])[0];
    if (last) { S.run = last; S.msgs.train = last.text; if (last.running) startPoll(); }
    render();
  }

  /* ---------------------------------------------------------------- entraînement en cours (suivi, extinction du PC) */
  function startPoll() {
    if (S.poll) return;
    S.poll = setInterval(async () => {
      if (!S.run || !S.run.run) return stopPoll();
      try {
        const st = (await call('status', { run: S.run.run })).status;
        const was = S.run.running;
        S.run = st;
        msg('train', st.text);
        const bar = root && root.querySelector('.lt-bar > i'); if (bar) bar.style.width = (st.pct || 0) + '%';
        const tail = root && root.querySelector('.lt-log'); if (tail) tail.textContent = st.tail || '';
        if (was && !st.running) {
          stopPoll();
          KS.toast(st.state === 'done' ? 'Entraînement LoRA terminé' : 'Entraînement LoRA arrêté (' + st.state + ')', st.state === 'done' ? 'ok' : 'info', 6000);
          const queue = KS.prefs.loraQueue || [];
          if (!st.stopped && st.state !== 'stopped' && queue.length) {
            // file d'attente : le projet suivant démarre tout seul ; l'extinction attend la fin de la file
            const next = queue.shift(); KS.prefs.loraQueue = queue; KS.prefs.save();
            if (await startQueued(next)) return;
          }
          if (S.power && !st.stopped && st.state !== 'stopped') {
            const r = await N.loraShutdown(true, `KaneApp : entraînement LoRA ${st.state === 'done' ? 'terminé' : 'terminé avec une erreur'}. Le PC s'éteint dans 2 minutes. Pour annuler : bouton « Annuler l'extinction » de KaneApp, ou shutdown /a.`);
            msg('power', r.ok ? '⏻ Extinction programmée dans 2 minutes.' : 'Extinction impossible : ' + r.error);
          }
          S.power = false;
          if (S.cur) { S.data = await call('load', { name: S.cur }).catch(() => S.data); }
          if (root && root.isConnected) render();
        }
      } catch { /* passerelle occupée : on réessaie */ }
    }, 5000);
  }
  function stopPoll() { clearInterval(S.poll); S.poll = null; }
  // Démarre un projet de la file avec ses réglages enregistrés (ceux du formulaire au moment où il a été mis en file)
  async function startQueued(name) {
    try {
      const d = await call('load', { name }), m = d.manifest || {};
      const r = await call('start', { name, dit: m.base_model || S.info?.dit, qwen3: S.qwen3 || S.info?.qwen3, vae: S.vae || S.info?.vae,
        sample_every: m.sample_every ?? 250, sample_prompt: m.sample_prompt || '' });
      const hh = Math.floor(r.estimate_s / 3600), mm = Math.floor(r.estimate_s % 3600 / 60);
      const left = (KS.prefs.loraQueue || []).length;
      S.run = { run: r.run, project: name, running: true, state: 'running', pct: 0, checkpoints: [], samples: [],
        text: `File d'attente : **${label({ name, trigger: m.trigger })}** démarré, environ ${hh} h ${String(mm).padStart(2, '0')}.` + (left ? ` Encore ${left} projet(s) ensuite.` : ' Dernier de la file.') };
      S.msgs.train = S.run.text;
      KS.toast('Entraînement suivant : ' + label({ name, trigger: m.trigger }), 'info', 5000);
      startPoll(); if (root && root.isConnected) render();
      return true;
    } catch (e) {
      KS.toast('File d’attente arrêtée : ' + e.message, 'err', 8000);
      msg('train', '⚠️ File d’attente arrêtée sur « ' + name + ' » : ' + e.message);
      return false;
    }
  }
  function queueView() {
    const { tbtn } = F();
    const q = KS.prefs.loraQueue || [];
    if (!q.length) return null;
    return h('div.lt-queue', h('span.fx-lbl', { text: 'File d’attente' }),
      ...q.map((name, i) => {
        const p = S.projects.find(x => x.name === name) || { name };
        const x = h('button.lt-x', { type: 'button', text: '×', title: 'Retirer de la file' });
        x.addEventListener('click', () => { KS.prefs.loraQueue = q.filter(n => n !== name); KS.prefs.save(); render(); });
        return h('span.lt-qitem', h('b', { text: String(i + 1) }), h('span', { text: label(p) }), x);
      }),
      !(S.run && S.run.running) ? tbtn('Démarrer la file', async () => { const q2 = KS.prefs.loraQueue || []; const next = q2.shift(); KS.prefs.loraQueue = q2; KS.prefs.save(); if (next) await startQueued(next); }, '.primary.sm') : null,
      h('span.fx-info', { text: S.power ? 'Le PC s’éteindra à la fin de la file.' : '' }));
  }
  async function enqueue() {
    if (!S.cur) return msg('train', 'Choisissez d’abord un projet.');
    if (!String(S.form.trigger || '').trim()) return msg('train', 'Donnez un mot déclencheur avant de mettre ce projet en file.');
    const patch = {}; for (const k of FORM_KEYS) patch[k] = S.form[k];
    await call('save', { name: S.cur, patch });
    const q = (KS.prefs.loraQueue || []).filter(n => n !== S.cur);
    q.push(S.cur); KS.prefs.loraQueue = q; KS.prefs.save();
    msg('train', `« ${label({ name: S.cur, trigger: S.form.trigger })} » ajouté à la file (${q.length}), avec ses réglages actuels. `
      + (S.run && S.run.running ? 'Il démarrera à la fin de l’entraînement en cours.' : 'Cliquez « Démarrer la file » quand elle est prête.'));
    render();
  }

  /* ---------------------------------------------------------------- actions (comme les boutons de l'onglet de Forge) */
  async function importFrom({ folder, paths }) {
    const F2 = root.querySelector('.lt-newname');
    const r = await busy('project', 'Import…', () => call('import', { folder: folder || '', paths: paths || [], name: S.cur || '', new_name: F2 ? F2.value.trim() : '' }));
    await refreshProjects(); await openProject(r.name);
    msg('project', `${r.added} image(s) importée(s) dans **${label(S.projects.find(p => p.name === r.name) || { name: r.name })}** (${r.count} au total). Originaux conservés ; aperçus réduits. Légendez-les (ou appliquez un préréglage), puis entraînez.`);
  }
  async function addFromKanevas(which) {
    if (!S.cur) return KS.toast('Choisissez ou créez d\'abord un projet', 'info');
    const docs = which === 'all' ? KS.state.docs : KS.state.doc ? [KS.state.doc] : [];
    if (!docs.length) return KS.toast('Aucun document ouvert', 'info');
    let n = 0;
    for (const d of docs) {
      let c = d.composite();
      if (which === 'sel' && d.selection.active) { const b = U.rectInt(d.selection.bounds); const t = U.canvas(b.w, b.h); t.getContext('2d').drawImage(c, -b.x, -b.y); c = t; }
      const bytes = new Uint8Array(await (await U.blobFromCanvas(c)).arrayBuffer());
      const r = await N.loraWrite(S.cur, d.name.replace(/\.[^.]+$/, '') + (which === 'sel' ? '_selection' : ''), bytes);
      if (r.ok) n++;
    }
    await openProject(S.cur);
    msg('project', `${n} image(s) ajoutée(s) depuis KaneApp.`);
  }
  async function applyPreset() {
    if (!S.cur) return msg('preset', 'Choisissez d’abord un projet.');
    const r = await busy('preset', 'Légendes manquantes puis préréglage…', () => call('preset', { name: S.cur, kind: S.form.lora_type, threshold: S.form.threshold }));
    const m = r.manifest;
    for (const k of FORM_KEYS) if (m[k] != null) S.form[k] = m[k];
    S.caps = { ...(m.captions || {}) };
    S.msgs.preset = r.status;
    render();
  }
  async function autoCaption() {
    if (!S.cur) return msg('captions', 'Choisissez d’abord un projet.');
    const r = await busy('captions', 'Légendes WD14…', () => call('caption', { name: S.cur, threshold: S.form.threshold, only_missing: false }));
    S.caps = { ...(r.captions || {}) };
    const n = S.data.images.length, f = r.failed || [];
    S.msgs.captions = `${n - f.length} image(s) sur ${n} légendée(s) au seuil ${S.form.threshold}.` + (f.length ? `\n\n**${f.length} image(s) n’ont pas pu être légendées** et s’entraîneraient avec le déclencheur seul : ` + f.slice(0, 10).map(x => '`' + x + '`').join(', ') : '');
    render();
  }
  // Tags du projet : combien d'images portent chaque tag ; un clic le retire, le renomme ou le met partout
  const splitTags = c => String(c || '').split(',').map(t => t.trim()).filter(Boolean);
  function tagStats() {
    const n = new Map();
    for (const c of Object.values(S.caps)) for (const t of new Set(splitTags(c))) n.set(t, (n.get(t) || 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }
  async function editTags(label, fn) {
    S.capsUndo = { ...S.caps };
    let changed = 0;
    for (const [file, c] of Object.entries(S.caps)) {
      const before = splitTags(c), after = fn(before, file);
      if (after.join(', ') !== before.join(', ')) { S.caps[file] = after.join(', '); changed++; }
    }
    if (!changed) { delete S.capsUndo; return KS.toast('Aucune légende à changer', 'info', 2000); }
    await saveCaptions();
    msg('captions', `${label} : ${changed} légende(s) modifiée(s) et enregistrée(s).`);
    S.capsMsg = `${label} : ${changed} légende(s).`;
    render();
  }
  function tagManager() {
    const { tbtn } = F();
    queueMicrotask(() => { const d = root && root.querySelector('.lt-tagbox'); if (d && !d._kw) { d._kw = true; d.addEventListener('toggle', () => { S.tagsOpen = d.open; }); } });
    const stats = tagStats(), total = Object.keys(S.caps).length;
    const filter = h('input.fx-in', { placeholder: 'Filtrer les tags…', spellcheck: false, value: S.tagFilter || '' });
    const list = h('div.lt-tags');
    const fill = () => {
      const q = filter.value.trim().toLowerCase();
      list.replaceChildren(...stats.filter(([t]) => !q || t.toLowerCase().includes(q)).slice(0, 160).map(([t, n]) => {
        const b = h('button.lt-tag' + (n === total ? '.all' : ''), { type: 'button', title: `${n} image(s) sur ${total} — clic : retirer, renommer…` }, h('span', { text: t }), h('b', { text: String(n) }));
        b.addEventListener('click', e => {
          const r = e.currentTarget.getBoundingClientRect();
          ui.menu([
            { label: `Retirer « ${t} » des ${n} légende(s)`, icon: 'trash', action: () => editTags(`« ${t} » retiré`, tags => tags.filter(x => x !== t)).catch(err => KS.toast(err.message, 'err')) },
            { label: 'Renommer partout…', icon: 'text', action: async () => {
              const v = (await KS.prompt('Renommer le tag', 'Nouveau nom', t) || '').trim(); if (!v || v === t) return;
              editTags(`« ${t} » → « ${v} »`, tags => [...new Set(tags.map(x => x === t ? v : x))]).catch(err => KS.toast(err.message, 'err'));
            } },
            n < total ? { label: `L’ajouter aux ${total - n} autre(s) légende(s)`, icon: 'plus', action: () => editTags(`« ${t} » ajouté`, tags => tags.includes(t) ? tags : [...tags, t]).catch(err => KS.toast(err.message, 'err')) } : null,
          ].filter(Boolean), r.left, r.bottom + 4);
        });
        return b;
      }));
    };
    filter.addEventListener('input', () => { S.tagFilter = filter.value; fill(); });
    filter.addEventListener('keydown', e => e.stopPropagation());
    fill();
    const add = h('input.fx-in', { placeholder: 'tag à ajouter à toutes les légendes', spellcheck: false });
    add.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') addAll(); });
    const addAll = () => { const v = add.value.trim(); if (v) editTags(`« ${v} » ajouté partout`, tags => tags.includes(v) ? tags : [...tags, v]).catch(err => KS.toast(err.message, 'err')); };
    const undo = S.capsUndo ? tbtn('Annuler la dernière modification', async () => { S.caps = { ...S.capsUndo }; delete S.capsUndo; await saveCaptions(); msg('captions', 'Dernière modification des tags annulée.'); render(); }, '.sm') : null;
    return h('details.fx-acc.lt-acc.lt-tagbox', { open: !!S.tagsOpen },
      h('summary.fx-acc-h', h('span.fx-acc-t', { text: `Tags du projet (${stats.length} différents)` })),
      h('div.fx-acc-b',
        h('div.fx-info', { text: 'Nombre d’images qui portent chaque tag. En surbrillance : présent sur toutes les images. Un clic : le retirer partout, le renommer, ou le compléter.' }),
        filter, list, h('div.lt-row', add, tbtn('Ajouter partout', addAll, '.sm'), undo)));
  }
  async function saveCaptions() {
    if (!S.cur) return;
    await busy('captions', 'Enregistrement…', () => call('save', { name: S.cur, patch: { captions: S.caps } }));
    msg('captions', `Légendes enregistrées pour ${Object.keys(S.caps).length} image(s).`);
  }
  async function removeImage(file) {
    if (!(await KS.confirm('Retirer « ' + file + ' » du projet ? Le fichier est supprimé du dossier du projet.', { title: 'Atelier LoRA', ok: 'Retirer', danger: true }))) return;
    await call('remove', { name: S.cur, files: [file] });
    await openProject(S.cur);
  }
  const forgeBusy = async () => {
    const E = KS.engine; if (!E || !E.ready()) return false;
    const p = await N.forgeProgress(KS.gen.url(), false);
    return p && p.ok && p.jobs > 0;
  };
  async function freeVram() {
    const E = KS.engine;
    if (!E || !E.ready()) return 'Forge n\'est pas démarré : la carte graphique est libre.';
    if (await forgeBusy()) throw new Error('Forge génère en ce moment : attendez la fin de la génération.');
    const before = await N.forgeMemory(KS.gen.url());
    await N.forgeUnload(KS.gen.url());
    const after = await N.forgeMemory(KS.gen.url());
    const mb = v => Math.round(v / 1048576);
    return before.ok && after.ok ? `Free VRAM **${mb(after.total - after.used)} MB** of ${mb(after.total)} MB (was ${mb(before.total - before.used)} MB). Forge reloads the checkpoint by itself on the next generation.` : 'Modèle de Forge déchargé.';
  }
  async function start() {
    if (!S.cur) return msg('train', 'Choisissez d’abord un projet.');
    if ((KS.prefs.loraQueue || []).includes(S.cur)) { KS.prefs.loraQueue = KS.prefs.loraQueue.filter(n => n !== S.cur); KS.prefs.save(); }
    const f = S.form;
    if (!String(f.trigger || '').trim()) return msg('train', 'Donnez un mot déclencheur : c’est le mot à écrire dans l’invite pour appeler le LoRA.');
    try {
      let note = '';
      if (await forgeBusy()) return msg('train', 'Forge utilise actuellement le GPU. Attends la fin de la génération.');
      if (S.freeFirst !== false && KS.engine && KS.engine.ready()) note = '\n\n' + await freeVram();
      const patch = {}; for (const k of FORM_KEYS) patch[k] = f[k];
      await call('save', { name: S.cur, patch });
      const r = await busy('train', 'Préparation du jeu de données et démarrage de sd-scripts…', () => call('start', { name: S.cur, dit: f.base_model, qwen3: S.qwen3 || S.info.qwen3, vae: S.vae || S.info.vae, sample_every: f.sample_every, sample_prompt: f.sample_prompt }));
      const hh = Math.floor(r.estimate_s / 3600), mm = Math.floor(r.estimate_s % 3600 / 60);
      S.msgs.train = `Démarré (pid ${r.pid}). ${r.count} image(s) × ${f.repeats} répétitions${r.resolutions.length > 1 ? ` × ${r.resolutions.length} résolutions` : ''} = ${r.per_epoch} pas par époque, `
        + `${+f.epochs > 0 ? f.epochs + ' époques' : f.steps + ' pas fixés à la main'} = ${r.total} pas en ${r.resolutions.map(x => x + ' px').join(' × ')}, dimension ${f.dim}, `
        + `${f.optimizer === 'prodigy' ? 'taux adaptatif' : 'taux ' + (+f.learning_rate).toPrecision(2)}.\n\nDurée estimée : **${hh} h ${String(mm).padStart(2, '0')}**. Dans vos invites : **${r.token || f.trigger}**. Le résultat arrive dans \`${r.output}\`.\n\n`
        + 'KaneApp attendra la fin de cet entraînement pour les nouvelles générations.' + note;
      S.run = { run: r.run, project: S.cur, running: true, state: 'running', pct: 0, text: S.msgs.train, checkpoints: [], samples: [] };
      startPoll(); render();
    } catch (e) { msg('train', '⚠️ ' + e.message); }
  }
  async function stop() {
    if (!S.run || !S.run.running) return msg('train', 'Aucun entraînement en cours.');
    try { S.run = (await call('stop', { run: S.run.run })).status; S.run.stopped = true; stopPoll(); msg('train', 'Entraînement arrêté. Les checkpoints déjà sauvegardés sont conservés.'); render(); }
    catch (e) { msg('train', 'Échec de l’arrêt : ' + e.message); }
  }
  async function del() {
    if (!S.cur) return;
    if (S.run && S.run.running && S.run.project === S.cur) return msg('project', 'Arrête l’entraînement avant de supprimer ce projet.');
    if (!(await KS.confirm('Supprimer le projet « ' + label(S.projects.find(p => p.name === S.cur) || { name: S.cur }) + ' » et ses images ? Les LoRA déjà entraînés restent dans le dossier des LoRA.', { title: 'Atelier LoRA', ok: 'Supprimer', danger: true }))) return;
    await call('delete', { name: S.cur });
    await refreshProjects(); S.cur = ''; await openProject('');
  }

  /* ---------------------------------------------------------------- actualiser (relancer un entraînement après un bug) */
  // Relit tout depuis le disque : libère un entraînement « fantôme » (processus mort ou PID réutilisé par Windows, qui
  // bloquait « Un entraînement tourne déjà » et les générations), recharge catalogue, projets, images et état du suivi.
  let refreshing = false;
  async function refreshAll() {
    if (refreshing) return; refreshing = true;
    let note = '';
    try {
      stopPoll();
      let r = null;
      try { r = await call('refresh'); } catch (e) { note = '⚠️ ' + e.message; }
      S.run = r && r.status || null; S.checked = 0; S.thumbs.clear();
      if (r && r.fixed && r.fixed.length) note = '🔧 Entraînement bloqué libéré : ' + r.fixed.map(x => x.reason).join(' ; ') + '. Vous pouvez relancer.';
      const cat = KS.studioApi && KS.studioApi.cat();
      S.info = await call('info', { modules: (cat && cat.current.modules) || [] });
      await refreshProjects();
      if (S.cur && S.projects.some(p => p.name === S.cur)) await openProject(S.cur); else if (S.cur) { S.cur = ''; await openProject(''); } else render();
      if (r && r.status && r.status.running) {
        S.run = r.status; startPoll();
        if (r.idle_s > 900) note += (note ? '\n\n' : '') + `⚠️ Le journal n'a pas bougé depuis ${Math.round(r.idle_s / 60)} min : l'entraînement semble bloqué. Cliquez sur **Stop** pour le fermer, puis relancez.`;
      }
      const etat = S.run ? S.run.text : 'Aucun entraînement en cours.';
      msg('train', (note ? note + '\n\n' : '') + etat);
      if (!note) KS.toast('Atelier LoRA actualisé', 'ok', 2500);
      render();
    } catch (e) { msg('train', '⚠️ Actualisation impossible : ' + e.message); }
    finally { refreshing = false; }
  }

  /* ---------------------------------------------------------------- clic droit : arrêter / relancer l'entraînement */
  // Fonctionne depuis le bouton « Lora » du Studio comme depuis la carte d'entraînement, même si l'atelier n'a pas été ouvert.
  const ensureInfo = async () => {
    if (!S.info) { const cat = KS.studioApi && KS.studioApi.cat(); S.info = await call('info', { modules: (cat && cat.current.modules) || [] }); }
    return S.info;
  };
  const currentRun = async () => { try { return (await call('status')).status || null; } catch { return null; } };
  async function waitStopped(runDir, ms = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if (!(await call('status', { run: runDir })).status.running) return true; } catch { return true; }
      await new Promise(r => setTimeout(r, 800));
    }
    return false;
  }
  async function stopAny({ quiet = false } = {}) {
    const st = await currentRun();
    if (!st || !st.running) { if (!quiet) KS.toast('Aucun entraînement en cours', 'info', 2200); return null; }
    await call('stop', { run: st.run });
    stopPoll();
    S.run = { ...st, running: false, stopped: true, state: 'stopped', text: 'Entraînement arrêté. Les checkpoints déjà sauvegardés sont conservés.' };
    S.msgs.train = S.run.text;
    const ok = await waitStopped(st.run);
    if (!quiet) KS.toast(ok ? 'Entraînement arrêté' : 'Arrêt demandé : le processus se ferme encore', ok ? 'ok' : 'info', 3000);
    if (root && root.isConnected) { if (S.cur) S.data = await call('load', { name: S.cur }).catch(() => S.data); render(); }
    return st;
  }
  async function restartRun() {
    try {
      const st = await currentRun(), running = !!(st && st.running);
      const project = (st && st.project) || S.cur || KS.prefs.loraProject;
      if (!project) return KS.toast('Ouvrez d\'abord un projet dans l\'atelier Lora', 'info', 3500);
      const name = label(S.projects.find(p => p.name === project) || { name: project });
      if (running && !(await KS.confirm('Arrêter l\'entraînement de « ' + name + ' » (' + Math.round(st.pct || 0) + ' % fait) et le relancer de zéro avec les mêmes réglages ?', { title: 'Relancer l\'entraînement', ok: 'Arrêter et relancer' }))) return;
      if (running) { await stopAny({ quiet: true }); }
      if (await forgeBusy()) return KS.toast('Forge génère en ce moment : attendez la fin de la génération.', 'info', 4000);
      const info = await ensureInfo();
      const m = (await call('load', { name: project })).manifest || {};
      if (!String(m.trigger || '').trim()) return KS.toast('Ce projet n\'a pas de mot déclencheur : ouvrez-le dans l\'atelier Lora', 'info', 4500);
      const dit = m.base_model && info.dits.some(d => d.path === m.base_model) ? m.base_model : info.dit;
      if (S.freeFirst !== false && KS.engine && KS.engine.ready()) { try { await freeVram(); } catch { /* génération en cours : on continue */ } }
      const r = await call('start', { name: project, dit, qwen3: S.qwen3 || info.qwen3, vae: S.vae || info.vae, sample_every: m.sample_every ?? 250, sample_prompt: m.sample_prompt || '' });
      S.run = { run: r.run, project, running: true, state: 'running', pct: 0, text: 'Entraînement relancé (pid ' + r.pid + ').', checkpoints: [], samples: [] };
      S.msgs.train = S.run.text; S.checked = 0;
      startPoll();
      KS.toast('Entraînement de « ' + name + ' » relancé', 'ok', 3500);
      if (root && root.isConnected) { if (S.cur === project) await openProject(project); else render(); }
    } catch (e) { KS.toast('Relance impossible : ' + e.message, 'err', 6000); }
  }
  async function contextMenu(x, y) {
    let st = null;
    try { st = await Promise.race([currentRun(), new Promise(r => setTimeout(() => r(null), 2500))]); } catch { /* menu sans état */ }
    const running = !!(st && st.running);
    ui.menu([
      { head: running ? 'Entraînement en cours : ' + label({ name: st.project || '?' }) + ' (' + Math.round(st.pct || 0) + ' %)' : 'Aucun entraînement en cours' },
      { label: 'Arrêter l\'entraînement', icon: 'close', disabled: !running, action: () => stopAny().catch(e => KS.toast('Arrêt impossible : ' + e.message, 'err', 5000)) },
      { label: running ? 'Arrêter et relancer' : 'Relancer l\'entraînement', icon: 'history', action: restartRun },
      { sep: true },
      { label: 'Actualiser (libérer un entraînement bloqué)', icon: 'history', action: () => (S.info ? refreshAll() : KS.trainTab.open().then(() => refreshAll())) },
      { label: 'Ouvrir l\'atelier Lora', icon: 'layers', action: () => KS.trainTab.open() },
    ], x, y);
  }

  /* ---------------------------------------------------------------- rendu */
  function render() {
    if (!root || !root.isConnected) return;
    const { field, row2, slider, select, check, text, tbtn } = F();
    const sc = root.closest('.fx-body'), top = sc ? sc.scrollTop : 0;
    const I = S.info, f = S.form || { ...DEF };
    const on = !!S.cur;
    // carte Project
    const sel = h('select.fx-sel', h('option', { value: '', text: '' }), ...S.projects.map(p => h('option', { value: p.name, text: label(p) + ' · ' + p.count + ' img' + (p.last && p.last.running ? ' · en cours' : '') })));
    sel.value = S.cur;
    sel.addEventListener('change', () => openProject(sel.value).catch(e => msg('project', '⚠️ ' + e.message)));
    const newName = h('input.fx-in.lt-newname', { placeholder: 'nom', spellcheck: false });
    const folder = h('input.fx-in', { placeholder: 'C:\\Users\\you\\Pictures\\training set', spellcheck: false, value: S.folder || '' });
    folder.addEventListener('input', () => { S.folder = folder.value; });
    const drop = h('div.fx-dropzone.lt-drop', h('div', { text: '… ou déposez des images ici (ou cliquez pour les choisir)' }));
    drop.addEventListener('click', async () => { const paths = await N.pickImagePaths(); if (paths.length) importFrom({ paths }).catch(() => {}); });
    drop.addEventListener('dragenter', e => { e.preventDefault(); e.stopPropagation(); drop.classList.add('over'); });
    drop.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); KS.resetDrop?.(); drop.classList.remove('over'); const paths = [...e.dataTransfer.files].map(x => N.pathForFile(x)).filter(Boolean); if (paths.length) importFrom({ paths }).catch(() => {}); });
    const gallery = h('div.lt-gallery');
    for (const im of (S.data ? S.data.images : [])) {
      const x = h('button.lt-x', { text: '×', title: 'Retirer cette image du projet' }); x.addEventListener('click', e => { e.stopPropagation(); removeImage(im.file); });
      const cell = h('div.lt-cell', { title: im.file }, img(im.preview || im.path, 200), x);
      cell.addEventListener('dblclick', async () => { const r = await N.loraFile(im.path); if (r.ok) KS.io.openEntry({ name: r.name, data: new Uint8Array(r.data), path: null }); });
      gallery.appendChild(cell);
    }
    const project = h('div.fx-panel.lt-card',
      h('div.lt-row', field('Projet', sel), tbtn('Actualiser', () => refreshAll()), tbtn('Supprimer', del)),
      h('div.lt-row', field('Nouveau projet', newName, 'Ce nom sert aussi au projet créé par une importation, à la place du nom du dossier source'),
        tbtn('Créer', async () => {
          const n = newName.value.trim(); if (!n) return msg('project', 'Donnez d’abord un nom au projet.');
          const r = await call('create', { name: n }); await refreshProjects(); await openProject(r.name); msg('project', `Projet « ${r.name} » créé.`);
        }, '.primary')),
      h('div.fx-info', { text: 'Ce nom sert aussi au projet créé par une importation ci-dessous, à la place du nom du dossier source.' }),
      h('div.lt-row', field('Dossier source', folder), tbtn('Parcourir…', async () => { const p = await N.pickFolder('Dossier d\'images'); if (p) { folder.value = p; S.folder = p; } }),
        tbtn('Importer les images', () => { if (!folder.value.trim()) return msg('project', 'Indiquez un dossier, ou déposez des images.'); importFrom({ folder: folder.value.trim() }).catch(() => {}); }, '.primary')),
      h('div.fx-info', { text: 'Pour de gros lots haute résolution : indiquez le dossier puis « Importer les images ». Copie locale ; qualité originale conservée.' }),
      drop,
      h('div.fx-outbtns', h('span.fx-info', { text: 'Depuis KaneApp :' }), tbtn('Image du document', () => addFromKanevas('doc')), tbtn('Sélection', () => addFromKanevas('sel')), tbtn('Documents ouverts', () => addFromKanevas('all'))),
      msgBox('project'), on ? gallery : null);
    // carte Preset
    const kinds = Object.entries(I.presets);
    const hint = h('div.fx-info', { text: (I.presets[f.lora_type] || {}).hint || '' });
    const preset = h('div.fx-panel.lt-card', h('div.fx-h', { text: 'Préréglage' }),
      h('div.fx-info', { text: 'Règle la dimension du réseau, le taux d’apprentissage, les répétitions, les époques et la résolution selon le type ET le nombre d’images du projet. Tous les préréglages sauf Style nettoient aussi les légendes. Tout reste modifiable ensuite.' }),
      h('div.lt-row', F().radio('Type de LoRA', kinds.map(([k, v]) => [k, v.label]), f, 'lora_type', '', v => { hint.textContent = (I.presets[v] || {}).hint || ''; saveForm(); }), tbtn('Appliquer le préréglage', () => applyPreset().catch(() => {}), '.primary')),
      hint, msgBox('preset'));
    // carte Captions
    const rows = h('div.lt-caps');
    for (const im of (S.data ? S.data.images : [])) {
      const ta = h('textarea.fx-ta.fx-small', { rows: 2, spellcheck: false }); ta.value = S.caps[im.file] || '';
      ta.addEventListener('input', () => { S.caps[im.file] = ta.value; });
      rows.appendChild(h('div.lt-caprow', img(im.preview || im.path, 120), h('div.fx-col', h('span.fx-info', { text: im.file }), ta)));
    }
    const captions = h('div.fx-panel.lt-card', h('div.fx-h', { text: 'Légendes' }),
      h('div.lt-row', slider('Seuil de confiance des tags', f, 'threshold', 0.1, 0.9, 0.05, '', saveForm), tbtn('Légender toutes les images', () => autoCaption().catch(() => {}), '.primary')),
      on && Object.keys(S.caps).length ? tagManager() : null,
      on ? rows : null,
      h('div.lt-row', tbtn('Enregistrer les légendes', () => saveCaptions().catch(() => {}), '.primary'), msgBox('captions')));
    // carte Training settings
    const lr = h('input.fx-in', { value: String(f.learning_rate), spellcheck: false, title: 'les préréglages le placent entre 2e-5 et 1e-4' });
    lr.addEventListener('change', () => { const v = parseFloat(lr.value); if (v > 0) { f.learning_rate = v; saveForm(); } lr.value = String(f.learning_rate); });
    const scopeHint = h('div.fx-info', { html: F().md(I.scopes[f.scope] ? `**${I.scopes[f.scope].summary}** · ${I.scopes[f.scope].hint}` : '') });
    const dit = I.dits.find(d => d.path === f.base_model);
    const ditNote = h('div.fx-info', { text: dit ? dit.note : '' });
    const qwen = h('input.fx-in', { value: S.qwen3 || I.qwen3 || '', spellcheck: false }); qwen.addEventListener('change', () => { S.qwen3 = qwen.value; });
    const vae = h('input.fx-in', { value: S.vae || I.vae || '', spellcheck: false }); vae.addEventListener('change', () => { S.vae = vae.value; });
    const adv = h('details.fx-acc.lt-acc', h('summary.fx-acc-h', h('span.fx-acc-t', { text: 'Techniques avancées' })), h('div.fx-acc-b',
      h('div.fx-info', { text: 'Toutes facultatives : laissées à 0 / 1, elles reproduisent exactement la recette ci-dessus.' }),
      F().row3(slider('Network dropout', f, 'network_dropout', 0, 0.5, 0.05, 'éteint une part des neurones du LoRA à chaque étape', saveForm), slider('Caption dropout rate', f, 'caption_dropout_rate', 0, 0.5, 0.05, '', saveForm), slider('Redémarrages du taux (cosine_with_restarts)', f, 'lr_scheduler_num_cycles', 1, 6, 1, '', saveForm)),
      row2(slider('Rank dropout', f, 'rank_dropout', 0, 0.5, 0.05, '', saveForm), slider('Module dropout', f, 'module_dropout', 0, 0.5, 0.05, '', saveForm))));
    const paths = h('details.fx-acc.lt-acc', h('summary.fx-acc-h', h('span.fx-acc-t', { text: 'Chemins des modèles (détectés)' })), h('div.fx-acc-b', row2(field('Encodeur de texte Qwen3', qwen), field('VAE Qwen-Image', vae))));
    const settings = h('div.fx-panel.lt-card', h('div.fx-h', { text: 'Réglages de l’entraînement' }),
      h('div.lt-grid4', text('Mot déclencheur', f, 'trigger', { rows: 1, placeholder: 'monstyle', tip: 'le mot à écrire dans l’invite pour appeler le LoRA ; aussi le nom du fichier créé', onInput: saveForm }),
        slider('Étapes', f, 'steps', 100, 4000, 100, 'utilisé seulement si Époques vaut 0', saveForm), slider('Époques', f, 'epochs', 0, 40, 1, '0 = désactivé. Sinon : nombre d’étapes exact = images × répétitions', saveForm),
        slider('Répétitions par image', f, 'repeats', 1, 60, 1, 'images × cette valeur = 1 époque', saveForm)),
      h('div.fx-info', { text: 'Au-dessus de 0, Époques s’adapte au nombre d’images du projet (sd-scripts calcule le nombre d’étapes exact : images × répétitions) et remplace Étapes.' }),
      h('div.lt-grid4', select('Résolution d’entraînement', I.resolutions.map(r => [String(r), String(r)]), { get v() { return String(f.resolution); }, set v(x) { f.resolution = +x; saveForm(); } }, 'v', 'ANIMA travaille en 1024 ; ne descendez à 768 que si la VRAM manque'),
        slider('Dimension / alpha du réseau', f, 'dim', 4, 128, 4, '', saveForm), field('Taux d’apprentissage', lr),
        select('Optimiseur', Object.entries(I.optimizers), f, 'optimizer', '', saveForm)),
      h('div.lt-grid3', select('Modules entraînés', Object.entries(I.scopes).map(([k, v]) => [k, v.label]), f, 'scope', 'les parties du modèle que le LoRA a le droit de modifier', v => { scopeHint.innerHTML = F().md(`**${I.scopes[v].summary}** · ${I.scopes[v].hint}`); saveForm(); }),
        check('Taille réelle des images', f, 'native_res', 'chaque image s’entraîne à sa propre taille (jusqu’à 1536 × 1536), jamais agrandie : le trait est appris à l’échelle où vous générez (1856 × 1024…). Environ 40 % plus long.', saveForm),
        check('Plusieurs résolutions', f, 'multires', `entraîne en ${I.fewshot_resolutions.join(' / ')} px au lieu d’une seule taille`, saveForm),
        check('Images en miroir', f, 'flip_aug', 'une seconde vue de chaque image, gratuitement. À éviter pour un sujet volontairement asymétrique', saveForm)),
      scopeHint, adv,
      select('Modèle de base pour l\'entraînement', I.dits.map(d => [d.path, d.name + (d.kind === 'base' ? ' (Base, conseillé)' : d.kind === 'tuned' ? ' (affiné)' : '')]), f, 'base_model', 'Pour Anima : la version Base (la LoRA marchera ensuite sur Aesthetic et Turbo)', v => { const d = I.dits.find(x => x.path === v); ditNote.textContent = d ? d.note : ''; saveForm(); }),
      ditNote, paths);
    // carte entraînement
    const run = S.run, running = !!(run && run.running);
    const freeFirst = { v: S.freeFirst !== false }, power = { v: S.power };
    const results = h('div.lt-results');
    const token = run && run.token || f.trigger || '';
    const eps = run && run.epochs || [];
    if (eps.length || (run && (run.before || []).length)) {
      // Choisir l'époque : la dernière n'est pas toujours la meilleure. Mêmes images (même graine) d'une sauvegarde à l'autre.
      results.append(h('div.fx-lbl', { text: running ? 'Versions déjà sauvegardées (les suivantes arrivent)' : 'Choisissez la version à garder' }),
        h('div.fx-info', { text: 'Mêmes invites et même graine à chaque sauvegarde : comparez, puis gardez celle où le style est là sans abîmer le reste. Dans vos invites : ' + (token || 'le déclencheur') + '.' }));
      const grid = h('div.lt-epochs');
      if ((run.before || []).length) grid.append(h('div.lt-ep.before', h('div.lt-ep-h', h('b', { text: 'Sans le LoRA' }), h('span.fx-info', { text: 'référence' })), h('div.lt-ep-imgs', ...run.before.map(s => img(s, 260)))));
      for (const c of eps.slice().reverse()) {
        const tryIt = tbtn('Essayer', () => KS.studioApi && KS.studioApi.addToPrompt(`<lora:${c.name}:1>` + (token ? ' ' + token : '')), '.sm', 'Ajoute cette version et son déclencheur à l\'invite de Créer');
        const keep = tbtn('Garder cette version', async () => {
          try {
            const r = await call('install', { path: c.path, name: (f.trigger || c.name).replace(/^@/, ''), token, weight: 1, preview: c.samples[c.samples.length - 1] || '',
              notes: `KaneApp, ${c.final ? 'dernière époque' : 'époque ' + c.epoch}, préréglage ${f.lora_type || 'style'}` });
            KS.toast(`LoRA installé : ${r.name} — poids conseillé 1`, 'ok', 5000);
            KS.studioApi?.reloadCat?.();
          } catch (e) { KS.toast('Installation impossible : ' + e.message, 'err', 6000); }
        }, '.primary.sm', 'Copie cette version dans vos LoRA (dossier Anima), avec sa fiche et son image');
        grid.append(h('div.lt-ep' + (c.final ? '.final' : ''),
          h('div.lt-ep-h', h('b', { text: c.final ? `Époque ${c.epoch} · finale` : `Époque ${c.epoch}` }), h('span.fx-info', { text: c.name })),
          c.samples.length ? h('div.lt-ep-imgs', ...c.samples.map(s => img(s, 260))) : h('div.fx-info', { text: 'Pas d’image d’aperçu pour cette version.' }),
          h('div.lt-row', tryIt, keep)));
      }
      results.append(grid);
      if (run.output) results.append(tbtn('Ouvrir le dossier', () => N.openFolder(run.output.replace(/[\\/][^\\/]+$/, '')), '.sm'));
    } else if (run && !running && (run.checkpoints || []).length) {
      results.append(h('div.fx-lbl', { text: 'LoRA produits' }));
      for (const ck of run.checkpoints.slice().reverse()) {
        const stem = ck.split(/[\\/]/).pop().replace(/\.safetensors$/i, '');
        results.append(h('div.lt-ck', h('span', { text: stem }), tbtn('Essayer dans Créer', () => KS.studioApi && KS.studioApi.addToPrompt(`<lora:${stem}:1>` + (token ? ' ' + token : '')), '.sm', 'Ajoute le LoRA et son déclencheur à l\'invite de Créer')));
      }
      results.append(tbtn('Ouvrir le dossier', () => N.openFolder(run.output.replace(/[\\/][^\\/]+$/, '')), '.sm'));
    }
    const samples = !eps.length && run && (run.samples || []).length ? h('div.lt-samples', ...run.samples.slice(-8).map(s => img(s, 220))) : null;
    const train = h('div.fx-panel.lt-card',
      row2(check('Images d’aperçu à chaque sauvegarde', { get v() { return +f.sample_every > 0; }, set v(x) { f.sample_every = x ? 250 : 0; } }, 'v',
          'Deux images (une scène du jeu d’images, une nouvelle) avant l’entraînement puis à chaque version sauvegardée, même graine : pour choisir la meilleure époque', saveForm),
        text('Invite des aperçus', f, 'sample_prompt', { rows: 1, placeholder: 'automatique : tirée de vos légendes, plus une scène nouvelle', onInput: saveForm })),
      h('div.lt-row', check('Libérer la VRAM avant l’entraînement', freeFirst, 'v', 'sd-scripts charge sa propre copie du modèle ; ce que Forge garde en mémoire est retiré à l’entraînement', v => { S.freeFirst = v; }),
        tbtn('Libérer la VRAM maintenant', async () => { try { msg('vram', await freeVram()); } catch (e) { msg('vram', '⚠️ ' + e.message); } })),
      msgBox('vram'),
      h('div.lt-row.lt-go', tbtn(running ? 'Entraînement en cours…' : 'Lancer l’entraînement', () => start(), '.primary.lt-start'),
        tbtn('Ajouter à la file', () => enqueue().catch(e => msg('train', '⚠️ ' + e.message)), '.lt-enqueue', 'Enchaîner plusieurs projets : chacun démarre à la fin du précédent, avec ses réglages enregistrés. KaneApp doit rester ouvert.'),
        tbtn('Arrêter', () => stop()), tbtn('Actualiser', () => refreshAll())),
      queueView(),
      h('div.lt-row', check('Éteindre le PC quand l\'entraînement est terminé', power, 'v', '2 min après la fin, réussi ou en échec ; pas si vous l\'arrêtez vous-même. KaneApp doit rester ouvert.', v => { S.power = v; msg('power', v ? '⏻ Le PC s\'éteindra 2 minutes après la fin de l\'entraînement (réussi ou en échec). Pas d\'extinction si vous l\'arrêtez vous-même.' : 'Le PC restera allumé à la fin de l\'entraînement.'); }),
        tbtn('Annuler l\'extinction', async () => { S.power = false; await N.loraShutdown(false); msg('power', 'Extinction annulée : le PC restera allumé.'); render(); })),
      msgBox('power'),
      h('div.lt-bar', h('i', { style: { width: (run ? run.pct || 0 : 0) + '%' } })),
      msgBox('train'),
      run && run.tail ? h('pre.lt-log', { text: run.tail }) : null,
      samples, results);
    train.addEventListener('contextmenu', e => { if (e.target.closest('input, textarea, select')) return; e.preventDefault(); contextMenu(e.clientX, e.clientY); });
    train.title = 'Clic droit : arrêter / relancer l\'entraînement';
    const intro = h('div.fx-panel.lt-intro', { html: '<b>Entraîner un LoRA ANIMA</b> avec kohya-ss/sd-scripts, d’après la recette d’un LoRA de référence qui fonctionne, adaptée au type choisi et au nombre d’images.<br>Importer les images → les légender → choisir un préréglage ou régler soi-même → entraîner. Le résultat s’utilise comme tout autre LoRA dans Créer et Transformer.' + (I.sd_scripts ? '' : '<br><b>sd-scripts (avec ANIMA) est introuvable à côté du dossier de Forge.</b>') + (I.tagger ? '' : '<br>Légendes automatiques indisponibles : ' + (I.tagger_error || '')) });
    intro.append(h('div.lt-row', tbtn('Actualiser', () => refreshAll()), h('span.fx-note', { text: 'Recharge les projets et l’état de l’entraînement, et libère un entraînement bloqué : à utiliser si « Lancer l’entraînement » ne repart pas.' })));
    // deux colonnes sur grand écran : données à gauche (projet, preset, légendes), réglages et entraînement à droite
    const colL = h('div.lt-col'), colR = h('div.lt-col');
    colL.append(...[project, on ? preset : null, on ? captions : null].filter(Boolean));
    colR.append(...[intro, on ? settings : null, on ? train : null].filter(Boolean));
    root.replaceChildren(colL, colR);
    if (sc) sc.scrollTop = top;
  }

  KS.trainTab = {
    contextMenu,
    open: async () => { if (KS.cmd.loraStudio) await KS.cmd.loraStudio(); },
    invalidate() { stopPoll(); S.info = null; S.data = null; S.projects = []; S.run = null; S.checked = 0; if (root?.isConnected) KS.trainTab.render(root); },
    async render(el) {
      root = el;
      el.replaceChildren(h('div.fx-panel', h('div.fx-note', { text: 'Lecture de l\'entraîneur de Forge…' })));
      try {
        if (!N || !N.loraCall) throw new Error('Disponible seulement dans l\'application de bureau');
        if (!S.info) { const cat = KS.studioApi && KS.studioApi.cat(); S.info = await call('info', { modules: (cat && cat.current.modules) || [] }); }
        await refreshProjects();
        if (!S.run) { try { const st = (await call('status')).status; if (st && st.running) { S.run = st; S.msgs.train = st.text; startPoll(); } } catch { /* rien */ } }
        const want = S.cur || KS.prefs.loraProject || '';
        if (want && S.projects.some(p => p.name === want)) await openProject(want); else render();
      } catch (e) { el.replaceChildren(h('div.fx-panel', h('div.fx-note', { text: 'Atelier LoRA : ' + e.message }), KS.fxui.tbtn('Réessayer', () => KS.trainTab.render(el)))); }
    },
    // nom du projet qui s'entraîne, sinon '' (les générations attendent sa fin, comme dans Forge)
    async running() {
      if (S.run && S.run.running) return label(S.projects.find(p => p.name === S.run.project) || { name: S.run.project || '?' });
      if (S.checked && Date.now() - S.checked < 30000) return '';
      S.checked = Date.now();
      try { const st = (await call('status')).status; if (st && st.running) { S.run = st; startPoll(); return label({ name: st.project || '?' }); } } catch { /* passerelle indisponible */ }
      return '';
    },
  };
})();

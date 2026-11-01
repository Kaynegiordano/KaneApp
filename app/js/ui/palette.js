// Palette de commandes (Ctrl+Maj+P ou la loupe de la barre de titre) : commandes des menus de l'espace actif,
// outils, espaces, fichiers récents et réglages, trouvés en quelques lettres sans tenir compte des accents.
// Les dernières commandes lancées remontent en tête.
'use strict';
(() => {
  const h = KS.h, C = KS.cmd, T = KS.tools;
  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[…«»"’']/g, ' ').replace(/\s+/g, ' ').trim();
  const P = KS.palette = {};
  let current = null;

  const toEdition = async () => { if (KS.studio?.on || KS.ws?.cur || document.body.classList.contains('suite-home')) await C.toggleStudio(false); };
  async function entries() {
    const out = [], seen = new Set();
    const push = e => { const k = e.kind + '|' + e.where + '|' + e.label; if (seen.has(k)) return; seen.add(k); e.key = k; out.push(e); };
    const walk = (items, where) => {
      let list; try { list = typeof items === 'function' ? items() : items; } catch { return; }
      for (const it of list || []) {
        if (!it || it.sep || it.head || it.hidden) continue;
        const label = typeof it.label === 'function' ? it.label() : it.label;
        if (!label) continue;
        if (it.sub) { if (label !== 'Fichiers récents') walk(it.sub, where.concat(label)); continue; }
        if (it.action) push({ kind: 'cmd', label: label.replace(/…$/, ''), where: where.join(' › '), kb: it.kb, icon: it.icon, run: it.action, disabled: it.disabled });
      }
    };
    const ext = KS.menus.current?.();
    if (ext) { for (const label of ext.labels) { try { walk(await ext.items(label), [label]); } catch { /* atelier pas prêt */ } } }
    else for (const m of KS.menus.defs()) walk(m.items, [m.label]);
    for (const [id, name] of Object.entries(KS.appearance?.labels || {})) {
      const open = KS.ws?.contextMenu?.(id)?.find(it => it.label === 'Ouvrir');
      if (open) push({ kind: 'space', label: name.replace(/ · KaneApp$/, ''), where: 'Espace', icon: 'grid', run: open.action });
    }
    for (const t of T.list) if (!t.hidden && t.name) push({ kind: 'tool', label: t.name, where: 'Outil', kb: t.shortcut, icon: t.icon, run: async () => { await toEdition(); T.select(t.id); } });
    for (const r of KS.prefs.recent || []) push({ kind: 'file', label: r.name, where: 'Fichier récent · ' + r.path, icon: 'image', run: () => KS.io.openPath(r.path) });
    for (const s of KS.prefsDialog?.settings || []) {
      if (!s.label || (s.hidden && s.hidden())) continue;
      push({ kind: 'pref', label: s.label, where: 'Préférences › ' + s.group, icon: 'settings', run: () => {
        const dlg = KS.prefsDialog.open(s.tab), f = dlg.el.querySelector('input[type=search]');
        if (f) { f.value = s.label; f.dispatchEvent(new Event('input')); }
      } });
    }
    return out;
  }
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const subseq = (q, s) => { let i = 0; for (const c of s) if (c === q[i]) i++; return i === q.length; };
  function score(q, e) {
    if (!q) return 1;
    const L = e.n || (e.n = norm(e.label)), W = e.w || (e.w = norm(e.where));
    if (L === q) return 100;
    if (L.startsWith(q)) return 85;
    if (new RegExp('(^|[\\s/(-])' + esc(q)).test(L)) return 70;
    if (L.includes(q)) return 50;
    const words = q.split(' ');
    if (words.every(w => L.includes(w))) return 40;
    if (words.every(w => (L + ' ' + W).includes(w))) return 25;
    return q.length > 2 && subseq(q.replace(/ /g, ''), L) ? 10 : 0;
  }
  const disabled = e => { try { return typeof e.disabled === 'function' ? !!e.disabled() : !!e.disabled; } catch { return true; } };

  P.open = async () => {
    if (current) { current.input.focus(); return; }
    KS.ui.closeMenus?.();
    const input = h('input.kp-input', { type: 'text', placeholder: 'Rechercher une commande, un outil, un espace, un réglage…', spellcheck: 'false', 'aria-label': 'Rechercher une commande' });
    const list = h('div.kp-list', { role: 'listbox' }), hint = h('div.kp-hint', { text: '↑ ↓ pour choisir · Entrée pour lancer · Échap pour fermer' });
    const box = h('div.kp', input, list, hint), back = h('div.kp-back', box);
    document.body.append(back);
    const me = current = { input, back };
    let all = [], shown = [], sel = 0;
    const used = () => KS.prefs.paletteUsed || [];
    const close = () => { if (current !== me) return; current = null; back.remove(); };
    function render() {
      const q = norm(input.value), u = used();
      shown = all.map(e => {
        let s = score(q, e); if (!s) return null;
        const r = u.indexOf(e.key); if (r >= 0) s += q ? 12 - Math.min(10, r) : 200 - r;
        return { e, s: s - (disabled(e) ? 1000 : 0) };
      }).filter(Boolean).sort((a, b) => b.s - a.s).slice(0, q ? 60 : 30).map(x => x.e);
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      list.replaceChildren(...(shown.length ? shown.map((e, i) => {
        const off = disabled(e);
        const row = h('div.kp-row' + (i === sel ? '.sel' : '') + (off ? '.off' : ''), { role: 'option' },
          h('span.ic', { html: e.icon ? KS.icon(e.icon) : '' }), h('span.kp-l', h('b', { text: e.label }), h('span.kp-w', { text: e.where })),
          e.kb ? h('span.kb', { text: e.kb }) : null);
        row.addEventListener('pointermove', () => { if (sel !== i) { sel = i; mark(); } });
        row.addEventListener('click', () => run(e));
        return row;
      }) : [h('div.kp-empty', { text: all.length ? 'Aucune commande ne correspond.' : 'Chargement…' })]));
    }
    const mark = () => { [...list.children].forEach((r, i) => r.classList.toggle('sel', i === sel)); list.children[sel]?.scrollIntoView({ block: 'nearest' }); };
    function run(e) {
      if (!e || disabled(e)) return;
      KS.prefs.paletteUsed = [e.key, ...used().filter(k => k !== e.key)].slice(0, 20); KS.prefs.save();
      close();
      setTimeout(() => { try { Promise.resolve(e.run()).catch(err => KS.toast(err.message, 'err')); } catch (err) { KS.toast(err.message, 'err'); } }, 0);
    }
    input.addEventListener('input', () => { sel = 0; render(); });
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 }[e.key];
      if (step) { e.preventDefault(); sel = Math.max(0, Math.min(shown.length - 1, sel + step)); mark(); }
      else if (e.key === 'Enter') { e.preventDefault(); run(shown[sel]); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
    render(); input.focus();
    all = await entries();
    if (current === me) render();
  };
  KS.on('ui-ready', () => {
    const box = KS.$('#workspace-actions'); if (!box) return;
    box.prepend(KS.ui.iconBtn('search', 'Rechercher une commande (Ctrl+Maj+P)', () => P.open(), '.sm'));
  });
})();

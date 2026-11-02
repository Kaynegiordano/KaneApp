// Panneaux Calques et Historique.
'use strict';
(() => {
  const U = KS.util, h = KS.h, ui = KS.ui, P = KS.panels;

  P.register('layers', {
    title: 'Calques', flush: true, fill: true,
    build(el) {
      this.el = el;
      const blend = KS.blendSelect('normal', v => { const d = KS.state.doc, L = d?.active; if (L) KS.Hist.structure(d, 'Mode de fusion', () => { L.blend = v; }, 'layers'); }, true);
      blend.classList.add('grow');
      let opBefore = null;
      const opacity = ui.scrub({
        label: 'Opacité', value: 100, min: 0, max: 100, unit: '%',
        onInput: v => { const d = KS.state.doc, L = d?.active; if (!L) return; if (!opBefore) opBefore = KS.Hist.structSnap(d); L.opacity = v / 100; d.changed(); },
        onChange: () => { const d = KS.state.doc; if (opBefore && d) { d.history.push({ name: 'Opacité', icon: 'layers', ...KS.Hist.structPart(d, opBefore) }); opBefore = null; } },
      });
      const lockA = ui.iconBtn('lock-alpha', 'Verrouiller les pixels transparents', () => this.toggle('lockAlpha', 'Verrouillage de la transparence'), '.sm');
      const lockAll = ui.iconBtn('lock', 'Tout verrouiller', () => this.toggle('lockAll', 'Verrouillage'), '.sm');
      this.ctl = { blend, opacity, lockA, lockAll };
      const top = h('div.layers-top',
        h('div.row', blend),
        h('div.row', opacity, h('span', { style: { flex: '1' } }), h('span.opt-label', { text: 'Verrou' }), lockA, lockAll));
      this.list = h('div.layers-list');
      const bottom = h('div.layers-bottom',
        ui.iconBtn('fx', 'Ajouter un style de calque', e => { const r = e.currentTarget.getBoundingClientRect(); ui.menu(KS.menus.fxMenu(), r.left, r.top - 200); }, '.sm'),
        ui.iconBtn('mask', 'Ajouter un masque de fusion (Alt : masquer)', e => KS.cmd.addMask(e.altKey ? 'hide' : null), '.sm'),
        ui.iconBtn('adjust', 'Nouveau calque de réglage', e => { const r = e.currentTarget.getBoundingClientRect(); ui.menu(KS.menus.adjustLayerMenu(), r.left, r.top - 420); }, '.sm'),
        ui.iconBtn('clip', 'Masque d\'écrêtage : le calque n\'apparaît que dans celui du dessous (Ctrl+Alt+G, ou Alt+clic sur le calque)', () => KS.cmd.toggleClip(), '.sm'),
        ui.iconBtn('group', 'Nouveau groupe à partir des calques sélectionnés (Ctrl+G)', () => KS.cmd.groupLayers(), '.sm'),
        ui.iconBtn('duplicate', 'Dupliquer le calque', () => KS.cmd.duplicateLayer(), '.sm'),
        ui.iconBtn('new-layer', 'Nouveau calque', () => KS.cmd.newLayer(), '.sm'),
        ui.iconBtn('trash', 'Supprimer le calque', () => KS.cmd.deleteLayer(), '.sm'));
      el.append(top, this.list, bottom);
      const rebuild = U.debounce(() => this.render(), 16);
      KS.on('layers', rebuild); KS.on('doc', rebuild); KS.on('history', rebuild); KS.on('active-layer', rebuild);
      KS.on('layer-pixels', U.throttle(() => this.thumbs(), 200));
      KS.on('rendered', U.throttle(() => this.thumbs(true), 500));
      this.render();
    },
    toggle(k, name) {
      const d = KS.state.doc, L = d?.active; if (!L) return;
      KS.Hist.structure(d, name, () => { L[k] = !L[k]; }, 'lock');
    },
    render() {
      const doc = KS.state.doc, list = this.list;
      list.innerHTML = '';
      this.rows = [];
      if (!doc) { list.appendChild(h('div.empty-note', { text: 'Aucun document' })); return; }
      const A = doc.active;
      if (A) {
        const pass = this.ctl.blend.querySelector('.opt-pass'); if (pass) pass.hidden = A.kind !== 'group';
        this.ctl.blend.value = A.blend; this.ctl.opacity.set(Math.round(A.opacity * 100));
        this.ctl.lockA.classList.toggle('on', A.lockAlpha); this.ctl.lockAll.classList.toggle('on', A.lockAll);
      }
      const sel = new Set(doc.selected.map(l => l.id));
      for (let i = doc.layers.length - 1; i >= 0; i--) {
        const L = doc.layers[i];
        // groupe replié : ses descendants sont cachés
        let hidden = false; for (let p = doc.parentOf(L); p; p = doc.parentOf(p)) if (p.collapsed) { hidden = true; break; }
        if (hidden) continue;
        const depth = doc.depth(L);
        const row = h('div.layer-row' + (L.id === doc.activeId ? '.active' : sel.has(L.id) ? '.multi' : '') + (!doc.shown(L) ? '.hidden-layer' : ''), { 'data-id': L.id });
        row.style.paddingLeft = (2 + depth * 16) + 'px';
        const eye = h('button.eye', { html: KS.icon(L.visible ? 'eye' : 'eye-off'), 'data-tip': 'Afficher / masquer (Alt : isoler)' });
        eye.addEventListener('click', e => { e.stopPropagation(); if (e.altKey) KS.cmd.soloLayer(L); else KS.cmd.toggleVisible(L); });
        eye.addEventListener('pointerdown', e => e.stopPropagation());
        row.appendChild(eye);
        if (L.clip) row.appendChild(h('span.link', { html: KS.icon('clip'), 'data-tip': "Masque d'écrêtage (Alt+clic pour libérer)" }));
        let thumb;
        if (L.kind === 'group') {
          const caret = h('button.eye', { html: KS.icon(L.collapsed ? 'chevron-right' : 'chevron-down'), 'data-tip': 'Déplier / replier' });
          caret.style.width = '18px';
          caret.addEventListener('click', e => { e.stopPropagation(); L.collapsed = !L.collapsed; this.render(); });
          caret.addEventListener('pointerdown', e => e.stopPropagation());
          row.appendChild(caret);
          thumb = h('div.thumb.kind', { html: KS.icon(L.collapsed ? 'group' : 'group-open') });
        } else if (L.kind === 'adjust') {
          thumb = h('div.thumb.kind' + (!L.editMask ? '.sel' : ''), { html: KS.icon(KS.Adjust.defs[L.adjust.type].icon) });
        } else if (L.kind === 'text') {
          thumb = h('div.thumb.kind' + (!L.editMask ? '.sel' : ''), { html: KS.icon('text') });
        } else {
          const cv = h('canvas', { width: 38, height: 34 });
          thumb = h('div.thumb' + (L.mask && !L.editMask && L.id === doc.activeId ? '.sel' : ''), cv);
          L.drawThumb(cv, doc);
          if (L.kind === 'shape') thumb.appendChild(h('span.kind-badge', { html: KS.icon('shape-star') }));
          if (L.kind === 'fill') thumb.appendChild(h('span.kind-badge', { html: KS.icon(KS.FillLayers?.DEFS[L.fill?.type]?.icon || 'fill') }));
          row._cv = cv;
        }
        thumb.addEventListener('click', e => {
          if (e.ctrlKey) { e.stopPropagation(); KS.cmd.selectFromLayer(L, e.shiftKey ? 'add' : e.altKey ? 'sub' : 'new'); return; }
          if (L.editMask) { L.editMask = false; KS.emit('layers', doc); }
        });
        row.appendChild(thumb);
        if (L.mask) {
          row.appendChild(h('span.link', { html: L.mask.linked ? KS.icon('link') : '' }));
          const mc = h('canvas', { width: 38, height: 34 });
          const mt = h('div.thumb' + (L.editMask ? '.sel' : ''), { 'data-tip': 'Masque — clic : modifier, Ctrl+clic : sélectionner, Maj+clic : désactiver' }, mc);
          if (!L.mask.enabled) mt.style.opacity = '0.35';
          L.drawThumb(mc, doc, 'mask');
          mt.addEventListener('click', e => {
            e.stopPropagation();
            if (e.ctrlKey) { KS.cmd.selectFromMask(L); return; }
            if (e.shiftKey) { doc.setActive(L); KS.cmd.toggleMask(); return; }
            doc.setActive(L); L.editMask = true; KS.emit('layers', doc); KS.emit('active-layer', doc);
          });
          row._mc = mc;
          row.appendChild(mt);
        }
        const name = h('div.lname', { text: L.name });
        name.addEventListener('dblclick', e => { e.stopPropagation(); this.rename(L, name); });
        row.appendChild(name);
        const badges = h('div.badges');
        if (L.effects && Object.values(L.effects).some(f => f.on)) { const fx = h('span.fx-badge', { text: 'fx', 'data-tip': 'Style de calque (double-clic)' }); fx.addEventListener('dblclick', e => { e.stopPropagation(); doc.setActive(L); KS.cmd.layerStyle(); }); badges.appendChild(fx); }
        if (L.lockAll) badges.appendChild(h('span', { html: KS.icon('lock') }));
        else if (L.lockAlpha) badges.appendChild(h('span', { html: KS.icon('lock-alpha') }));
        row.appendChild(badges);
        row.addEventListener('click', e => {
          if (row._dragged) { row._dragged = false; return; }
          // Alt+clic : écrête ce calque à celui du dessous (comme Photoshop)
          if (e.altKey && !e.ctrlKey && !e.shiftKey) { doc.setActive(L); KS.cmd.toggleClip(); return; }
          if (e.ctrlKey || e.metaKey) {
            // ajout / retrait de la sélection multiple
            if (doc.selectedIds.has(L.id) && doc.selectedIds.size > 1) { doc.selectedIds.delete(L.id); if (doc.activeId === L.id) doc.activeId = [...doc.selectedIds][0]; KS.emit('layers', doc); KS.emit('active-layer', doc); }
            else doc.setActive(L, true);
            return;
          }
          if (e.shiftKey && doc.active) {
            const vis = this.rows.map(r => +r.dataset.id), a = vis.indexOf(doc.activeId), b = vis.indexOf(L.id);
            const [lo, hi] = a < b ? [a, b] : [b, a];
            doc.selectedIds = new Set(vis.slice(lo, hi + 1));
            doc.activeId = L.id; KS.emit('layers', doc); KS.emit('active-layer', doc);
            return;
          }
          if (doc.activeId !== L.id || doc.selectedIds.size > 1) { doc.setActive(L); L.editMask = L.editMask && !!L.mask; }
        });
        row.addEventListener('dblclick', e => {
          if (e.target.closest('.lname')) return;
          doc.setActive(L);
          if (L.kind === 'text') { KS.tools.select('text'); KS.textTool.begin(doc, L, false); }
          else if (L.kind === 'adjust') KS.cmd.editAdjustment();
          else if (L.kind === 'shape' || L.kind === 'group') P.focus('properties');
          else KS.cmd.layerStyle();
        });
        row.addEventListener('contextmenu', e => { e.preventDefault(); if (!doc.selectedIds.has(L.id)) doc.setActive(L); ui.menu(KS.menus.layerContext(L), e.clientX, e.clientY); });
        this.drag(row, L, doc);
        list.appendChild(row);
        this.rows.push(row);
      }
    },
    thumbs(activeOnly) {
      const doc = KS.state.doc; if (!doc || !this.rows || !P.isVisible('layers')) return;
      for (const row of this.rows) {
        const L = doc.layerById(+row.dataset.id); if (!L) continue;
        if (activeOnly && L.id !== doc.activeId) continue;
        if (row._lastV === L.version) continue;
        row._lastV = L.version;
        if (row._cv) L.drawThumb(row._cv, doc);
        if (row._mc) L.drawThumb(row._mc, doc, 'mask');
      }
    },
    rename(L, nameEl) {
      const doc = KS.state.doc;
      const f = h('input.field', { type: 'text', value: L.name });
      nameEl.innerHTML = ''; nameEl.appendChild(f); f.focus(); f.select();
      const done = ok => { if (ok && f.value.trim() && f.value !== L.name) KS.Hist.structure(doc, 'Renommer le calque', () => { L.name = f.value.trim(); }, 'layers'); else this.render(); };
      f.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
      f.addEventListener('blur', () => done(true));
    },
    // Glisser-déposer : au-dessus, en dessous, ou dans un groupe (milieu de sa ligne)
    drag(row, L, doc) {
      row.addEventListener('pointerdown', e => {
        if (e.button !== 0 || e.target.closest('input') || e.target.closest('button')) return;
        const y0 = e.clientY;
        let dragging = false, target = null, mode = 'above';
        const clear = () => this.rows.forEach(r => r.classList.remove('drop-above', 'drop-below', 'drop-into'));
        const mv = ev => {
          if (!dragging && Math.abs(ev.clientY - y0) > 5) { dragging = true; row.style.opacity = '0.5'; }
          if (!dragging) return;
          clear();
          const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.layer-row');
          if (!over || over === row || !this.rows.includes(over)) { target = null; return; }
          const T = doc.layerById(+over.dataset.id);
          if (T === L || doc.isDescendant(T, L)) { target = null; return; }
          const r = over.getBoundingClientRect(), f = (ev.clientY - r.top) / r.height;
          mode = T.kind === 'group' && f > 0.28 && f < 0.72 ? 'into' : f < 0.5 ? 'above' : 'below';
          over.classList.add(mode === 'into' ? 'drop-into' : mode === 'above' ? 'drop-above' : 'drop-below');
          target = T;
        };
        const up = () => {
          window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
          row.style.opacity = ''; clear();
          if (!dragging) return;
          row._dragged = true; setTimeout(() => { row._dragged = false; }, 0);
          if (!target) return;
          const moving = doc.selectedIds.has(L.id) ? doc.selected : [L];
          KS.Hist.structure(doc, 'Ordre des calques', () => {
            // on dépose dans l'ordre visuel (du haut vers le bas)
            const list = moving.filter(m => m !== target && !doc.isDescendant(target, m)).sort((a, b) => doc.layers.indexOf(b) - doc.layers.indexOf(a));
            let anchor = target, first = true;
            for (const m of list) {
              if (first) { doc.moveBlock(m, anchor, mode === 'into' ? { inside: true } : { above: mode === 'above' }); first = false; }
              else doc.moveBlock(m, anchor, { above: false });
              anchor = m;
            }
          }, 'layers');
        };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      });
    },
  });

  P.register('history', {
    title: 'Historique', flush: true,
    build(el) {
      this.el = el;
      const render = U.debounce(() => this.render(), 20);
      KS.on('history', render); KS.on('doc', render);
      this.render();
    },
    render() {
      const el = this.el, doc = KS.state.doc;
      el.innerHTML = '';
      if (!doc) { el.appendChild(h('div.empty-note', { text: 'Aucun document' })); return; }
      // instantanés en tête (clic : rétablir ; double-clic : renommer), puis les étapes
      const snaps = h('div', { style: { padding: '4px 4px 0' } });
      for (const s of doc.snapshots || []) {
        const r = h('div.hist-row', { html: KS.icon('camera'), title: 'Rétablir cet état (annulable)' }, h('span', { text: s.name }));
        r.addEventListener('click', () => KS.Hist.restoreSnapshot(doc, s));
        r.addEventListener('dblclick', async () => { const n = await KS.prompt("Renommer l'instantané", 'Nom', s.name); if (n) { s.name = n; this.render(); } });
        r.addEventListener('contextmenu', e => { e.preventDefault(); ui.menu([{ label: "Supprimer l'instantané", icon: 'trash', action: () => { doc.snapshots = doc.snapshots.filter(x => x !== s); this.render(); } }], e.clientX, e.clientY); });
        snaps.appendChild(r);
      }
      if (snaps.children.length) { snaps.appendChild(h('div', { style: { borderBottom: '1px solid var(--border)', margin: '4px 0' } })); el.appendChild(snaps); }
      const box = h('div', { style: { padding: '4px' } });
      const H = doc.history;
      H.items.forEach((it, i) => {
        const r = h('div.hist-row' + (i === H.pos ? '.current' : '') + (i > H.pos ? '.future' : ''), { html: KS.icon(it.icon || 'dot') }, h('span', { text: it.name }));
        r.addEventListener('click', () => H.goto(i));
        box.appendChild(r);
      });
      el.appendChild(box);
      el.appendChild(h('div.layers-bottom',
        ui.iconBtn('camera', "Nouvel instantané de l'état actuel", () => KS.Hist.snapshot(doc, 'Instantané ' + ((doc.snapshots || []).length + 1)), '.sm')));
      const cur = box.children[H.pos];
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    },
  });
})();

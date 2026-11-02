// Dock de panneaux (groupes à onglets) + panneaux Couleur, Nuancier, Propriétés,
// Réglages, Navigateur, Histogramme, Infos.
'use strict';
(() => {
  const U = KS.util, h = KS.h, ui = KS.ui, V = KS.view;
  const P = KS.panels = { defs: {}, groups: [] };

  // Groupes (haut → bas) ; grow = prend la place restante
  P.LAYOUT = [
    { id: 'g-nav', tabs: ['navigator', 'histogram', 'aidraw', 'info'], collapsed: true },
    { id: 'g-color', tabs: ['color', 'swatches'] },
    { id: 'g-props', tabs: ['properties', 'adjustments', 'gallery'], height: 250 },
    { id: 'g-layers', tabs: ['layers', 'channels', 'paths', 'history'], grow: true },
  ];
  P.register = (id, def) => { P.defs[id] = def; };

  P.build = () => {
    const dock = KS.$('#dock');
    dock.innerHTML = '';
    dock.style.width = (KS.prefs.dockWidth || 300) + 'px';
    const rz = h('div.dock-resizer');
    rz.addEventListener('pointerdown', e => {
      e.preventDefault(); rz.setPointerCapture(e.pointerId);
      const x0 = e.clientX, w0 = dock.offsetWidth;
      const mv = ev => { const w = U.clamp(w0 + x0 - ev.clientX, 240, 520); dock.style.width = w + 'px'; KS.prefs.dockWidth = w; };
      const up = () => { rz.removeEventListener('pointermove', mv); rz.removeEventListener('pointerup', up); KS.prefs.save(); KS.emit('dock-resized'); };
      rz.addEventListener('pointermove', mv); rz.addEventListener('pointerup', up);
    });
    dock.appendChild(rz);
    const st = KS.prefs.panels || (KS.prefs.panels = {});
    for (const g of P.LAYOUT) {
      const s = st[g.id] || (st[g.id] = { active: g.tabs[0], collapsed: !!g.collapsed, height: g.height || null });
      const el = h('div.pgroup' + (g.grow ? '.grow' : ''), { 'data-id': g.id });
      const tabs = h('div.ptabs'), body = h('div.pbody');
      const panes = {};
      for (const id of g.tabs) {
        const def = P.defs[id]; if (!def) continue;
        const tb = h('button.ptab', { text: def.title });
        tb.addEventListener('click', () => { s.active = id; if (s.collapsed) { s.collapsed = false; el.classList.remove('collapsed'); } show(); KS.prefs.save(); });
        tb.addEventListener('dblclick', () => { s.collapsed = !s.collapsed; el.classList.toggle('collapsed', s.collapsed); KS.prefs.save(); });
        tabs.appendChild(tb);
        const pane = h('div.ppane' + (def.flush ? '.flush' : '') + (def.fill ? '.fill' : ''));
        body.appendChild(pane);
        panes[id] = { tb, pane, def, built: false };
      }
      const col = h('button.pcollapse', { html: KS.icon('chevron-down'), 'data-tip': 'Réduire / déplier' });
      col.addEventListener('click', () => { s.collapsed = !s.collapsed; el.classList.toggle('collapsed', s.collapsed); KS.prefs.save(); show(); });
      tabs.append(h('div.spacer'), col);
      el.append(tabs, body);
      if (s.collapsed) el.classList.add('collapsed');
      if (!g.grow && s.height) body.style.height = s.height + 'px';
      dock.appendChild(el);
      if (!g.grow) {
        const r = h('div.pgroup-resizer');
        r.addEventListener('pointerdown', e => {
          e.preventDefault(); r.setPointerCapture(e.pointerId);
          const y0 = e.clientY, h0 = body.offsetHeight;
          const mv = ev => { const nh = U.clamp(h0 + ev.clientY - y0, 60, 800); body.style.height = nh + 'px'; s.height = nh; };
          const up = () => { r.removeEventListener('pointermove', mv); r.removeEventListener('pointerup', up); KS.prefs.save(); KS.emit('dock-resized'); };
          r.addEventListener('pointermove', mv); r.addEventListener('pointerup', up);
        });
        dock.appendChild(r);
      }
      function show() {
        if (!panes[s.active]) s.active = g.tabs[0];
        for (const id in panes) {
          const p = panes[id], on = id === s.active;
          p.tb.classList.toggle('active', on); p.pane.classList.toggle('active', on);
          if (on && !p.built) { p.built = true; p.def.build(p.pane); }
          if (on && p.def.show) p.def.show(p.pane);
        }
      }
      show();
      P.groups.push({ g, el, show, s, panes });
    }
  };
  P.isVisible = id => P.groups.some(G => G.s.active === id && !G.s.collapsed && G.panes[id]);
  P.focus = id => {
    if (id === 'generate') return KS.cmd.openGenPanel && KS.cmd.openGenPanel();
    const G = P.groups.find(x => x.panes[id]);
    if (!G) return;
    G.s.active = id; G.s.collapsed = false; G.el.classList.remove('collapsed'); G.show(); KS.prefs.save();
  };

  /* ---------------------------------------------------------------- couleur */
  P.register('color', {
    title: 'Couleur',
    build(el) {
      let target = 'fg';
      const fgB = h('button.color-chip', { 'data-tip': 'Modifier le premier plan' }), bgB = h('button.color-chip', { 'data-tip': 'Modifier l\'arrière-plan' });
      const cp = new KS.ColorPicker({ color: KS.state.fg, onChange: c => { target === 'fg' ? KS.setFG(c, true) : KS.setBG(c, true); } });
      const sel = t => { target = t; fgB.style.outline = t === 'fg' ? '2px solid var(--accent)' : ''; bgB.style.outline = t === 'bg' ? '2px solid var(--accent)' : ''; cp.set(KS.state[t]); };
      fgB.addEventListener('click', () => sel('fg')); bgB.addEventListener('click', () => sel('bg'));
      const sync = () => { fgB.style.background = U.hex(KS.state.fg); bgB.style.background = U.hex(KS.state.bg); if (!cp.dragging) cp.set(KS.state[target]); };
      KS.on('color', (_c, fromPanel) => { if (!fromPanel) sync(); else { fgB.style.background = U.hex(KS.state.fg); bgB.style.background = U.hex(KS.state.bg); } });
      el.append(h('div.form-row', { style: { marginBottom: '8px' } }, fgB, bgB, h('span.note', { text: 'Premier plan / arrière-plan' })), cp.el);
      sel('fg'); sync();
    },
  });

  /* ---------------------------------------------------------------- nuancier */
  const DEFAULT_SWATCHES = [
    '#000000', '#1f1f1f', '#3d3d3d', '#5c5c5c', '#7a7a7a', '#999999', '#b8b8b8', '#d6d6d6', '#f0f0f0', '#ffffff',
    '#ff0000', '#ff8000', '#ffff00', '#80ff00', '#00ff00', '#00ff80', '#00ffff', '#0080ff', '#0000ff', '#8000ff', '#ff00ff', '#ff0080',
    '#e57373', '#f06292', '#ba68c8', '#9575cd', '#7986cb', '#64b5f6', '#4fc3f7', '#4dd0e1', '#4db6ac', '#81c784', '#aed581', '#dce775', '#fff176', '#ffd54f', '#ffb74d', '#ff8a65',
    '#b71c1c', '#880e4f', '#4a148c', '#311b92', '#1a237e', '#0d47a1', '#01579b', '#006064', '#004d40', '#1b5e20', '#33691e', '#827717', '#f57f17', '#ff6f00', '#e65100', '#bf360c',
    '#3d7cf0', '#8a5cf6', '#ec4899', '#f5d0b0', '#e0ac69', '#c68642', '#8d5524', '#5c3a1e',
  ];
  KS.getSwatches = () => KS.prefs.swatches || DEFAULT_SWATCHES;
  P.register('swatches', {
    title: 'Nuancier',
    build(el) {
      const grid = h('div.swatches');
      const render = () => {
        grid.innerHTML = '';
        KS.getSwatches().forEach((hex, i) => {
          const s = h('div.s', { style: { background: hex }, 'data-tip': hex.toUpperCase() + ' — clic : premier plan, Alt : arrière-plan, clic droit : supprimer' });
          s.addEventListener('click', e => { const c = U.parseHex(hex); if (e.altKey || e.ctrlKey) KS.setBG(c); else KS.setFG(c); });
          s.addEventListener('contextmenu', e => { e.preventDefault(); const list = KS.getSwatches().slice(); list.splice(i, 1); KS.prefs.swatches = list; KS.prefs.save(); render(); });
          grid.appendChild(s);
        });
        const add = h('button.s.add', { html: KS.icon('plus'), 'data-tip': 'Ajouter la couleur de premier plan' });
        add.addEventListener('click', () => { const list = KS.getSwatches().slice(); list.push(U.hex(KS.state.fg)); KS.prefs.swatches = list; KS.prefs.save(); render(); });
        grid.appendChild(add);
      };
      render();
      const reset = ui.btn('Réinitialiser', () => { KS.prefs.swatches = null; KS.prefs.save(); render(); }, '.small');
      el.append(grid, h('div', { style: { marginTop: '10px' } }, reset));
    },
  });

  /* ---------------------------------------------------------------- propriétés */
  P.register('properties', {
    title: 'Propriétés',
    build(el) {
      this.el = el;
      const refresh = U.debounce(() => this.render(), 30);
      KS.on('active-layer', refresh); KS.on('layers', refresh); KS.on('doc', refresh); KS.on('history', refresh);
      this.render();
    },
    render() {
      const el = this.el; if (!el) return;
      const doc = KS.state.doc;
      if (this.editing && doc && this.editing.doc === doc && this.editing.layer === doc.active) return;
      this.commitPending?.();
      el.innerHTML = '';
      this.editing = null;
      if (!doc) { el.appendChild(h('div.empty-note', { text: 'Aucun document ouvert' })); return; }
      const L = doc.active;
      if (!L) { el.appendChild(h('div.empty-note', { text: 'Aucun calque' })); return; }
      const sec = (title, ...kids) => h('div.prop-section', h('h4', { text: title }), ...kids);
      if (L.kind === 'adjust') {
        const def = KS.Adjust.defs[L.adjust.type];
        el.appendChild(h('div.form-row', { style: { marginBottom: '10px' } }, h('span', { html: KS.icon(def.icon), style: { width: '18px', color: 'var(--accent-2)' } }), h('b', { text: def.name })));
        let before = null;
        const commit = () => {
          const snap = before; before = null;
          if (!snap) return;
          if (this.commitPending === commit) this.editing = null;
          doc.history.push({ name: 'Modifier ' + def.name, icon: 'adjust', ...KS.Hist.structPart(doc, snap) });
        };
        this.commitPending = commit;
        const push = U.debounce(commit, 700);
        const params = L.adjust.params;
        const histo = KS.Adjust.hist(U.getData(doc.flatten(doc.layers.slice(0, doc.layers.indexOf(L)))));
        let lastAdjust = JSON.parse(JSON.stringify(L.adjust));
        const ui_ = KS.buildParamUI(def, params, () => {
          if (!before) { const snap = KS.Hist.structSnap(doc); snap.props.set(L, { ...snap.props.get(L), adjust: lastAdjust }); before = snap; }
          this.editing = { doc, layer: L };
          L.touch(); doc.changed(); push();
          lastAdjust = JSON.parse(JSON.stringify(L.adjust));
        }, { histo, width: '100%', auto: def.custom === 'levels' ? () => autoLevels(doc, L, params) : null });
        el.appendChild(ui.btn('Modifier le réglage…', () => KS.cmd.editAdjustment(), '.small', 'adjust'));
        el.appendChild(h('div.note', { text: 'Ce réglage reste modifiable et conserve les pixels d’origine.' }));
        el.appendChild(ui_);
        el.appendChild(h('div.form-row', { style: { marginTop: '12px' } },
          ui.btn('Réinitialiser', () => { commit(); KS.Hist.structure(doc, 'Réinitialiser ' + def.name, () => { L.adjust.params = KS.Adjust.defaults(L.adjust.type); L.touch(); }, 'adjust'); }, '.small', 'undo'),
          ui.btn(L.visible ? 'Masquer' : 'Afficher', () => KS.cmd.toggleVisible(L), '.small', L.visible ? 'eye-off' : 'eye')));
        return;
      }
      if (L.kind === 'text') {
        const t = L.text;
        const ta = h('textarea.field', { rows: 3, style: { width: '100%' }, value: t.text });
        ta.addEventListener('keydown', e => e.stopPropagation());
        ta.addEventListener('change', () => KS.Hist.structure(doc, 'Modifier le texte', () => { t.text = ta.value; L.renderText(); }, 'text'));
        const set = patch => KS.Hist.structure(doc, 'Modifier le texte', () => { Object.assign(L.text, patch); L.renderText(); }, 'text');
        el.append(sec('Texte', ta),
          sec('Caractère',
            h('div.form-col',
              ui.select(KS.FONTS.map(f => [f, f]), t.family, v => set({ family: v })),
              h('div.prop-grid',
                ui.scrub({ label: 'Corps', value: t.size, min: 1, max: 2000, unit: 'px', log: true, onChange: v => set({ size: v }) }),
                ui.scrub({ label: 'Interligne', value: t.leading || 1.2, min: 0.5, max: 4, step: 0.05, onChange: v => set({ leading: v }) }),
                ui.scrub({ label: 'Approche', value: t.tracking || 0, min: -50, max: 200, onChange: v => set({ tracking: v }) }),
                h('div.form-row', ui.colorChip(t.color, (v, live) => { if (live) { L.text.color = v; L.renderText(); doc.changed(); } else set({ color: v }); }, 'Couleur du texte'), h('span.note', { text: 'Couleur' }))),
              h('div.form-row',
                ui.seg([['left', 'text-left', 'Gauche'], ['center', 'text-center', 'Centre'], ['right', 'text-right', 'Droite']], t.align, v => set({ align: v })),
                ui.seg([['b', 'bold', 'Gras'], ['i', 'italic', 'Italique'], ['u', 'underline', 'Souligné']], t.bold ? 'b' : t.italic ? 'i' : t.underline ? 'u' : '', v => set({ bold: v === 'b' ? !t.bold : t.bold, italic: v === 'i' ? !t.italic : t.italic, underline: v === 'u' ? !t.underline : t.underline }))))),
          h('div.form-row', ui.btn('Pixelliser le texte', () => KS.cmd.rasterize(), '.small', 'rasterize')));
      }
      if (L.kind === 'group') {
        el.append(sec('Groupe', h('div.note', { text: `${doc.descendants(L).length} calque(s). Mode « Passage » : les calques du groupe se fondent directement dans l'image.` })),
          sec('Apparence', h('div.form-col',
            KS.blendSelect(L.blend, v => KS.Hist.structure(doc, 'Mode de fusion', () => { L.blend = v; }, 'layers'), true),
            ui.scrub({ label: 'Opacité', value: Math.round(L.opacity * 100), min: 0, max: 100, unit: '%', onChange: v => KS.Hist.structure(doc, 'Opacité', () => { L.opacity = v / 100; }, 'layers') }))),
          h('div.form-row', ui.btn('Dissocier', () => KS.cmd.ungroup(), '.small', 'group'), ui.btn('Fusionner le groupe', () => KS.cmd.mergeDown(), '.small', 'merge')));
        return;
      }
      if (L.kind === 'fill' && L.fill && KS.fillProperties) el.appendChild(KS.fillProperties(doc, L, sec));
      if (L.kind === 'shape') {
        const sh = L.shape;
        const set = patch => KS.Hist.structure(doc, 'Modifier la forme', () => { Object.assign(L.shape, patch); L.renderShape(); }, 'shape-star');
        const live = patch => { Object.assign(L.shape, patch); L.renderShape(); doc.changed(); };
        el.appendChild(sec('Forme vectorielle',
          h('div.form-col',
            h('div.form-row', ui.check('Fond', sh.fill, v => set({ fill: v })), ui.colorChip(sh.fillColor, (v, l) => l ? live({ fillColor: v }) : set({ fillColor: v }), 'Couleur de fond')),
            h('div.form-row', ui.check('Contour', sh.stroke, v => set({ stroke: v })), ui.colorChip(sh.strokeColor, (v, l) => l ? live({ strokeColor: v }) : set({ strokeColor: v }), 'Couleur du contour'),
              ui.scrub({ value: sh.strokeWidth, min: 0, max: 300, unit: 'px', onChange: v => set({ strokeWidth: v, stroke: v > 0 || sh.stroke }) })),
            h('div.note', { text: 'Modifiez les points avec la Sélection directe (A) ou ajoutez-en avec la Plume (P).' }),
            h('div.form-row', ui.btn('Pixelliser', () => KS.cmd.rasterize(), '.small', 'rasterize'), ui.btn('Tracé → sélection', () => KS.cmd.pathToSelection(), '.small', 'select-all')))));
        // Rectangle : ses angles restent réglables tant que ses points n'ont pas été modifiés
        const lr = KS.liveRect(L);
        if (lr) {
          const linked = lr.linked ?? lr.radii.every(v => v === lr.radii[0]);
          const setRadii = (radii, lk = linked) => KS.Hist.structure(doc, 'Angles du rectangle', () => {
            const g = KS.liveRect(L) || lr;
            L.shape.live = { ...g, radii, linked: lk };
            L.shape.subpaths = KS.roundRectSubpaths(g.x, g.y, g.w, g.h, radii);
            L.renderShape();
          }, 'shape-rect');
          const r = { min: 0, max: Math.ceil(Math.min(lr.w, lr.h) / 2), unit: 'px' };
          const link = ui.iconBtn('link', linked ? 'Angles liés : cliquer pour régler chaque angle' : 'Un rayon par angle : cliquer pour les lier',
            () => { setRadii(linked ? lr.radii : lr.radii.map(() => Math.max(...lr.radii)), !linked); this.render(); });
          if (linked) link.classList.add('active');
          const one = (i, label) => ui.scrub({ label, value: Math.round(lr.radii[i]), ...r, onChange: v => setRadii(lr.radii.map((x, j) => j === i ? v : x)) });
          el.appendChild(sec('Angles',
            linked
              ? h('div.form-row', link, ui.scrub({ label: 'Rayon', value: Math.round(lr.radii[0]), ...r, onChange: v => setRadii([v, v, v, v]) }))
              : h('div.form-col', h('div.form-row', link), h('div.prop-grid', one(0, '↖'), one(1, '↗'), one(3, '↙'), one(2, '↘')))));
        }
      }
      // transformation
      const b = L.contentBounds() || L.bounds();
      const moveTo = (dx, dy) => KS.Hist.structure(doc, 'Déplacer', () => { L.x += dx; L.y += dy; if (L.mask && L.mask.linked) { L.mask.x += dx; L.mask.y += dy; } L.touch(); }, 'move');
      el.appendChild(sec('Transformation',
        h('div.prop-grid',
          ui.scrub({ label: 'X', value: b.x, min: -100000, max: 100000, unit: 'px', popup: false, onChange: v => moveTo(v - b.x, 0) }),
          ui.scrub({ label: 'Y', value: b.y, min: -100000, max: 100000, unit: 'px', popup: false, onChange: v => moveTo(0, v - b.y) }),
          h('div.note', { text: `L : ${b.w} px` }), h('div.note', { text: `H : ${b.h} px` })),
        h('div.form-row', { style: { marginTop: '8px' } },
          ui.iconBtn('flip-h', 'Symétrie horizontale du calque', () => KS.cmd.flipLayer('h')), ui.iconBtn('flip-v', 'Symétrie verticale du calque', () => KS.cmd.flipLayer('v')),
          ui.iconBtn('rotate-ccw', 'Rotation 90° antihoraire', () => KS.cmd.rotateLayer(-90)), ui.iconBtn('rotate-cw', 'Rotation 90° horaire', () => KS.cmd.rotateLayer(90)),
          ui.iconBtn('transform', 'Transformation manuelle (Ctrl+T)', () => KS.cmd.freeTransform()))));
      el.appendChild(sec('Apparence',
        h('div.form-col',
          KS.blendSelect(L.blend, v => KS.Hist.structure(doc, 'Mode de fusion', () => { L.blend = v; }, 'layers')),
          ui.scrub({ label: 'Opacité', value: Math.round(L.opacity * 100), min: 0, max: 100, unit: '%', onChange: v => KS.Hist.structure(doc, 'Opacité', () => { L.opacity = v / 100; }, 'layers') }),
          ui.btn('Style de calque…', () => KS.cmd.layerStyle(), '.small', 'fx'))));
      if (L.mask) {
        el.appendChild(sec('Masque de fusion',
          h('div.form-row', { style: { flexWrap: 'wrap' } },
            ui.btn(L.editMask ? 'Modifier le calque' : 'Modifier le masque', () => { L.editMask = !L.editMask; KS.emit('layers', doc); this.render(); }, '.small', 'mask'),
            ui.btn(L.mask.enabled ? 'Désactiver' : 'Activer', () => KS.cmd.toggleMask(), '.small'),
            ui.btn('Intervertir', () => KS.cmd.invertMask(), '.small'),
            ui.btn('Appliquer', () => KS.cmd.applyMask(), '.small'),
            ui.btn('Supprimer', () => KS.cmd.deleteMask(), '.small', 'trash'))));
      }
      if (L.kind === 'raster') {
        el.appendChild(sec('Actions rapides', h('div.form-row', { style: { flexWrap: 'wrap' } },
          ui.btn('Supprimer l\'arrière-plan', () => KS.cmd.removeBackground(), '.small', 'sparkles'),
          ui.btn('Rognage automatique', () => KS.cmd.trimLayer(), '.small', 'trim'))));
      }
    },
  });
  function autoLevels(doc, L, params) {
    const d = U.getData(doc.flatten(doc.layers.slice(0, doc.layers.indexOf(L))));
    const hh = KS.Adjust.hist(d);
    for (const ch of ['r', 'g', 'b']) {
      let total = 0; for (let i = 0; i < 256; i++) total += hh[ch][i];
      let lo = 0, hi = 255, acc = 0; const lim = total * 0.001;
      for (; lo < 255; lo++) { acc += hh[ch][lo]; if (acc > lim) break; }
      acc = 0; for (; hi > 0; hi--) { acc += hh[ch][hi]; if (acc > lim) break; }
      params[ch] = { ...KS.Adjust.LV0(), inBlack: lo, inWhite: Math.max(lo + 2, hi) };
    }
  }

  /* ---------------------------------------------------------------- réglages */
  const ADJ_LIST = ['brightness', 'levels', 'curves', 'exposure', 'vibrance', 'hueSat', 'colorBalance', 'blackWhite', 'photoFilter', 'channelMixer', 'invert', 'posterize', 'threshold', 'gradientMap', 'selectiveColor'];
  KS.ADJ_LIST = ADJ_LIST;
  P.register('adjustments', {
    title: 'Réglages',
    build(el) {
      const grid = h('div.adj-grid');
      for (const id of ADJ_LIST) {
        const d = KS.Adjust.defs[id];
        const b = h('button.adj-btn', { html: KS.icon(d.icon), 'data-tip': 'Nouveau calque de réglage : ' + d.name });
        b.appendChild(h('span', { text: d.name.split(/[/ ]/)[0] }));
        b.addEventListener('click', () => KS.cmd.newAdjustLayer(id));
        grid.appendChild(b);
      }
      el.append(h('div.note', { text: 'Ajouter un calque de réglage (non destructif) :', style: { marginBottom: '8px' } }), grid);
    },
  });

  /* ---------------------------------------------------------------- navigateur */
  P.register('navigator', {
    title: 'Navigateur',
    build(el) {
      const cv = h('canvas');
      const wrap = h('div.nav-wrap', cv);
      const zr = ui.range({ value: 1, min: 0.01, max: 32, step: 0.01, log: true, onInput: v => V.setZoom(v) });
      const zf = h('input.field.num-field', { type: 'text' });
      zf.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { const v = parseFloat(zf.value); if (v > 0) V.setZoom(v / 100); zf.blur(); } });
      el.append(wrap, h('div.nav-zoom', ui.iconBtn('zoom-out', 'Zoom arrière', () => V.zoomStep(-1)), zr, ui.iconBtn('zoom', 'Zoom avant', () => V.zoomStep(1)), zf));
      let geo = null;
      const draw = U.throttle(() => {
        const doc = KS.state.doc;
        if (!doc || !P.isVisible('navigator')) return;
        const W = Math.max(100, wrap.clientWidth - 8), H = 150;
        const s = Math.min(W / doc.width, H / doc.height);
        cv.width = Math.round(doc.width * s); cv.height = Math.round(doc.height * s);
        const x = cv.getContext('2d');
        x.fillStyle = U.checkerPattern(x, 4); x.fillRect(0, 0, cv.width, cv.height);
        x.imageSmoothingQuality = 'medium';
        x.drawImage(doc.previewSource(), 0, 0, cv.width, cv.height);
        const r = { x: -V.ox / V.zoom * s, y: -V.oy / V.zoom * s, w: V.w / V.zoom * s, h: V.h / V.zoom * s };
        x.strokeStyle = '#ff3b30'; x.lineWidth = 2; x.strokeRect(r.x, r.y, r.w, r.h);
        geo = { s };
        zr.setValue(V.zoom); if (document.activeElement !== zf) zf.value = Math.round(V.zoom * 1000) / 10 + ' %';
      }, 120);
      KS.on('rendered', draw); KS.on('view', draw); KS.on('dock-resized', draw);
      cv.addEventListener('pointerdown', e => {
        const doc = KS.state.doc; if (!doc || !geo) return;
        cv.setPointerCapture(e.pointerId);
        const go = ev => {
          const r = cv.getBoundingClientRect(), dx = (ev.clientX - r.left) / geo.s, dy = (ev.clientY - r.top) / geo.s;
          V.ox = V.w / 2 - dx * V.zoom; V.oy = V.h / 2 - dy * V.zoom; V.store();
        };
        go(e);
        const up = () => { cv.removeEventListener('pointermove', go); cv.removeEventListener('pointerup', up); };
        cv.addEventListener('pointermove', go); cv.addEventListener('pointerup', up);
      });
    },
    show() { KS.requestRender(); },
  });

  /* ---------------------------------------------------------------- histogramme */
  P.register('histogram', {
    title: 'Histogramme',
    build(el) {
      const cv = h('canvas.histo', { width: 300, height: 100 });
      let mode = 'rgb';
      const sel = ui.select([['rgb', 'Couleurs'], ['l', 'Luminosité'], ['r', 'Rouge'], ['g', 'Vert'], ['b', 'Bleu']], mode, v => { mode = v; draw(); });
      const stats = h('div.info-grid');
      el.append(h('div.form-row', { style: { marginBottom: '8px' } }, h('span.opt-label', { text: 'Couche' }), sel), cv, stats);
      const draw = U.throttle(() => {
        const doc = KS.state.doc;
        if (!doc || !P.isVisible('histogram')) return;
        const c = doc.previewSource(), s = Math.min(1, 512 / Math.max(c.width, c.height));
        const t = U.canvas(c.width * s, c.height * s); t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
        const hh = KS.Adjust.hist(U.getData(t));
        cv.width = cv.clientWidth || 280;
        const x = cv.getContext('2d'), W = cv.width, H = cv.height;
        x.clearRect(0, 0, W, H);
        const plot = (arr, color, comp = 'source-over') => {
          let mx = 1; for (let i = 0; i < 256; i++) mx = Math.max(mx, arr[i]);
          x.globalCompositeOperation = comp; x.fillStyle = color; x.beginPath(); x.moveTo(0, H);
          for (let i = 0; i < 256; i++) x.lineTo(i / 255 * W, H - Math.sqrt(arr[i] / mx) * (H - 4));
          x.lineTo(W, H); x.closePath(); x.fill(); x.globalCompositeOperation = 'source-over';
        };
        if (mode === 'rgb') { plot(hh.r, 'rgba(255,70,70,0.85)', 'lighter'); plot(hh.g, 'rgba(70,220,90,0.85)', 'lighter'); plot(hh.b, 'rgba(70,120,255,0.85)', 'lighter'); }
        else plot(hh[mode], mode === 'l' ? '#b9c0cc' : mode === 'r' ? '#ff5a5a' : mode === 'g' ? '#4cd964' : '#4c8dff');
        const arr = hh[mode === 'rgb' ? 'l' : mode];
        let n = 0, sum = 0, sq = 0; for (let i = 0; i < 256; i++) { n += arr[i]; sum += i * arr[i]; sq += i * i * arr[i]; }
        const mean = n ? sum / n : 0, sd = n ? Math.sqrt(sq / n - mean * mean) : 0;
        let med = 0, acc = 0; for (let i = 0; i < 256; i++) { acc += arr[i]; if (acc >= n / 2) { med = i; break; } }
        stats.innerHTML = '';
        stats.append(h('b', { text: 'Moyenne' }), h('span', { text: mean.toFixed(1) }), h('b', { text: 'Écart' }), h('span', { text: sd.toFixed(1) }), h('b', { text: 'Médiane' }), h('span', { text: med }), h('b', { text: 'Pixels' }), h('span', { text: (doc.width * doc.height).toLocaleString('fr-FR') }));
      }, 400);
      KS.on('rendered', draw);
    },
    show() { KS.requestRender(); },
  });

  /* ---------------------------------------------------------------- infos */
  P.register('info', {
    title: 'Infos',
    build(el) {
      const grid = h('div.info-grid');
      el.appendChild(grid);
      const upd = U.throttle(ev => {
        const doc = KS.state.doc;
        grid.innerHTML = '';
        if (!doc) return;
        const add = (a, b) => grid.append(h('b', { text: a }), h('span', { text: b }));
        if (ev) {
          const c = doc.sample(ev.x, ev.y, 1);
          add('X', Math.floor(ev.x)); add('Y', Math.floor(ev.y));
          if (c) { const hsv = U.rgb2hsv(c); add('R', c.r); add('T', Math.round(hsv.h) + '°'); add('V', c.g); add('S', Math.round(hsv.s * 100) + ' %'); add('B', c.b); add('L', Math.round(hsv.v * 100) + ' %'); add('Hex', U.hex(c).toUpperCase()); add('Alpha', Math.round(c.a * 100) + ' %'); }
        }
        add('Doc', `${doc.width}×${doc.height}`);
        const b = doc.selection.bounds; if (b) add('Sél.', `${b.w}×${b.h}`);
      }, 60);
      KS.on('mouse', ev => { if (P.isVisible('info')) upd(ev); });
      upd(null);
    },
  });
})();

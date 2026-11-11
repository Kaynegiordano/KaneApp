// Pipette, texte, formes, main, zoom.
'use strict';
(() => {
  const U = KS.util, T = KS.tools, V = KS.view, h = KS.h, ui = KS.ui;

  /* ---------------------------------------------------------------- pipette */
  T.register({
    id: 'eyedropper', name: 'Pipette', icon: 'eyedropper', shortcut: 'I', cursor: 'crosshair',
    defaults: { size: 1, source: 'all' },
    options: () => [
      { type: 'select', id: 'size', label: 'Échantillon', options: [[1, 'Pixel'], [3, 'Moyenne 3 × 3'], [5, 'Moyenne 5 × 5'], [11, 'Moyenne 11 × 11'], [31, 'Moyenne 31 × 31']] },
      { type: 'select', id: 'source', label: 'Calques', options: [['all', 'Tous les calques'], ['layer', 'Calque actif']] },
      { type: 'custom', render: () => h('span.opt-label', { text: 'Alt + clic : couleur d\'arrière-plan' }) },
    ],
    pick(ev, doc) {
      const c = doc.sample(ev.x, ev.y, +this.o.size, this.o.source);
      if (!c) return;
      this.ring = { c, alt: ev.alt };
      if (ev.alt && T.current.id === 'eyedropper') KS.setBG(c); else KS.setFG(c);
    },
    down(ev, doc) { this.prevFg = { ...KS.state.fg }; this.picking = true; this.pick(ev, doc); },
    move(ev, doc) { if (this.picking) this.pick(ev, doc); },
    up() { this.picking = false; this.ring = null; },
    overlay(ctx) {
      if (!this.picking || !V.mouse || !this.ring) return;
      const m = V.mouse, R = 46;
      ctx.save();
      ctx.lineWidth = 14;
      ctx.beginPath(); ctx.arc(m.sx, m.sy, R, Math.PI, 0); ctx.strokeStyle = U.hex(this.ring.c); ctx.stroke();
      ctx.beginPath(); ctx.arc(m.sx, m.sy, R, 0, Math.PI); ctx.strokeStyle = U.hex(this.prevFg || KS.state.bg); ctx.stroke();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.5)';
      ctx.beginPath(); ctx.arc(m.sx, m.sy, R + 7, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(m.sx, m.sy, R - 7, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    },
  });

  /* ---------------------------------------------------------------- texte */
  KS.FONTS = ['Outfit', 'Segoe UI', 'Segoe UI Variable Display', 'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Franklin Gothic Medium', 'Gabriola', 'Georgia', 'Impact', 'Ink Free', 'Lucida Console', 'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Sitka Text', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
  const setFonts = list => { if (list && list.length) { KS.FONTS = [...new Set(['Outfit', ...list])]; if (T.current?.id === 'text') T.renderOptions(); KS.emit('fonts'); } };
  if (KS.native && KS.native.listFonts) KS.native.listFonts().then(setFonts).catch(() => {});
  else if ('queryLocalFonts' in window) {
    // Version web (Chrome, Edge) : les polices installées sur le PC, après autorisation du navigateur.
    // La demande doit venir d'un clic ; si l'autorisation est déjà accordée, elles sont chargées d'emblée.
    KS.webFonts = {
      loaded: false,
      async ask(silent) {
        try {
          const fonts = await window.queryLocalFonts();
          const families = [...new Set(fonts.map(f => f.family))].sort((a, b) => a.localeCompare(b, 'fr'));
          if (!families.length) throw new Error('aucune police');
          this.loaded = true; setFonts(families);
          if (!silent) KS.toast(`${families.length} polices du PC disponibles.`);
        } catch (e) {
          if (!silent) KS.toast('Le navigateur a refusé l\'accès aux polices du PC (autorisation « Polices » du site).', 'err');
        }
      },
    };
    navigator.permissions?.query({ name: 'local-fonts' }).then(p => { if (p.state === 'granted') KS.webFonts.ask(true); }).catch(() => {});
  }

  const textTool = T.register({
    id: 'text', name: 'Texte horizontal', icon: 'text', shortcut: 'T', cursor: 'text',
    defaults: { family: 'Outfit', size: 72, color: '#000000', bold: false, italic: false, underline: false, align: 'left', leading: 1.2, tracking: 0 },
    options() {
      const o = this.o;
      const fam = ui.select(KS.FONTS.map(f => [f, f]), o.family, v => this.setStyle({ family: v }));
      fam.style.width = '180px';
      const styleSeg = h('div.seg',
        ...[['bold', 'bold', 'Gras'], ['italic', 'italic', 'Italique'], ['underline', 'underline', 'Souligné']].map(([k, ic, tip]) => {
          const b = h('button', { html: KS.icon(ic), 'data-tip': tip }); if (o[k]) b.classList.add('on');
          b.addEventListener('click', () => { b.classList.toggle('on'); this.setStyle({ [k]: b.classList.contains('on') }); });
          return b;
        }));
      const pcFonts = KS.webFonts && !KS.webFonts.loaded ? ui.btn('Polices du PC', () => KS.webFonts.ask(), '.small', 'text') : null;
      if (pcFonts) pcFonts.dataset.tip = 'Charger les polices installées sur ce PC (le navigateur demande l\'autorisation)';
      return [
        { type: 'custom', render: () => h('div.opt-group', fam, styleSeg, ...(pcFonts ? [pcFonts] : [])) },
        { type: 'custom', render: () => h('div.opt-group', ui.scrub({ label: 'Corps', value: o.size, min: 1, max: 2000, unit: 'px', log: true, onInput: v => this.setStyle({ size: v }) })) },
        { type: 'custom', render: () => h('div.opt-group', ui.seg([['left', 'text-left', 'Aligner à gauche'], ['center', 'text-center', 'Centrer'], ['right', 'text-right', 'Aligner à droite']], o.align, v => this.setStyle({ align: v }))) },
        { type: 'custom', render: () => h('div.opt-group', ui.scrub({ label: 'Interligne', value: o.leading, min: 0.5, max: 4, step: 0.05, onInput: v => this.setStyle({ leading: v }) }), ui.scrub({ label: 'Approche', value: o.tracking, min: -50, max: 200, unit: 'px', onInput: v => this.setStyle({ tracking: v }) })) },
        { type: 'custom', render: () => h('div.opt-group', ui.colorChip(o.color, (v, live) => this.setStyle({ color: v }, live), 'Couleur du texte')) },
        { type: 'sep' },
        this.ed ? { type: 'custom', render: () => h('div.opt-group', ui.btn('Annuler', () => this.end(false), '.small', 'close'), ui.btn('Valider', () => this.end(true), '.small.primary', 'check')) } : null,
      ];
    },
    // Applique un style au texte en cours, ou au calque de texte actif
    setStyle(patch, live) {
      Object.assign(this.o, patch); T.saveOpts(this);
      const doc = KS.state.doc; if (!doc) return;
      if (this.ed) { Object.assign(this.ed.layer.text, patch); this.ed.layer.renderText(); this.styleEditor(); doc.changed(); return; }
      const L = doc.active;
      if (L && L.kind === 'text' && !live) KS.Hist.structure(doc, 'Modifier le texte', () => { Object.assign(L.text, patch); L.renderText(); }, 'text');
      else if (L && L.kind === 'text' && live) { Object.assign(L.text, patch); L.renderText(); doc.changed(); }
    },
    activate(doc) { const L = doc?.active; if (L && L.kind === 'text') { Object.assign(this.o, pick(L.text)); } },
    deactivate() { if (this.ed) this.end(true); },
    commitOnLeave() { if (this.ed) this.end(true); },
    cancel() { if (this.ed) this.end(false); },
    down(ev, doc) {
      if (this.ed) {
        const b = this.ed.layer.textBox();
        if (ev.x >= b.x - 4 && ev.x <= b.x + b.w + 4 && ev.y >= b.y - 4 && ev.y <= b.y + b.h + 4) return;
        this.end(true);
        return;
      }
      // cliquer sur un calque de texte existant pour le modifier
      const hit = [...doc.layers].reverse().find(L => L.kind === 'text' && L.visible && (() => { const b = L.textBox(); return ev.x >= b.x && ev.x <= b.x + b.w && ev.y >= b.y && ev.y <= b.y + b.h; })());
      if (hit) { doc.setActive(hit); this.begin(doc, hit, false); return; }
      const text = { text: '', family: this.o.family, size: this.o.size, color: this.o.color, bold: this.o.bold, italic: this.o.italic, underline: this.o.underline, align: this.o.align, leading: this.o.leading, tracking: this.o.tracking };
      const before = KS.Hist.structSnap(doc);
      const L = new KS.Layer({ name: 'Texte', kind: 'text', text, x: Math.round(ev.x), y: Math.round(ev.y - this.o.size * 0.85) });
      doc.addLayer(L, doc.activeIndex + 1);
      this.begin(doc, L, true, before);
    },
    begin(doc, L, isNew, before) {
      if (L.lockAll) { KS.toast('Le calque est verrouillé', 'err'); return; }
      this.ed = { doc, layer: L, isNew, before: before || KS.Hist.structSnap(doc), orig: JSON.stringify(L.text) };
      Object.assign(this.o, pick(L.text));
      const e = h('div.text-editor', { contentEditable: 'plaintext-only', spellcheck: false });
      e.textContent = L.text.text;
      e.addEventListener('input', () => { L.text.text = e.innerText.replace(/\n$/, ''); if (L.text.text === '' && e.innerText === '\n') L.text.text = ''; L.renderText(); this.place(); doc.changed(); });
      e.addEventListener('keydown', ev => {
        ev.stopPropagation();
        if (ev.key === 'Escape') { ev.preventDefault(); this.end(false); }
        else if (ev.key === 'Enter' && (ev.ctrlKey || ev.location === 3)) { ev.preventDefault(); this.end(true); }
      });
      e.addEventListener('pointerdown', ev => ev.stopPropagation());
      KS.$('#overlay-ui').appendChild(e);
      this.ed.el = e;
      this.styleEditor();
      this.offView = KS.on('view', () => this.styleEditor());
      T.renderOptions();
      KS.emit('layers', doc);
      setTimeout(() => { e.focus(); const r = document.createRange(); r.selectNodeContents(e); if (!isNew) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); } }, 0);
      doc.changed();
    },
    styleEditor() {
      const ed = this.ed; if (!ed) return;
      const t = ed.layer.text, e = ed.el, z = V.zoom;
      Object.assign(e.style, {
        font: KS.Layer.fontString(t, z), lineHeight: t.size * (t.leading || 1.2) * z + 'px', letterSpacing: (t.tracking || 0) * z + 'px',
        textAlign: t.align, color: 'transparent', textDecoration: 'none', minWidth: Math.max(4, t.size * z * 0.3) + 'px',
      });
      e.style.setProperty('caret-color', t.color === '#ffffff' ? '#3d7cf0' : t.color);
      this.place();
    },
    place() {
      const ed = this.ed; if (!ed) return;
      const b = ed.layer.textBox(), p = V.toScreen(b.x, b.y);
      ed.el.style.left = p.x + 'px'; ed.el.style.top = p.y + 'px';
      ed.el.style.minHeight = b.h * V.zoom + 'px';
    },
    end(ok) {
      const ed = this.ed; if (!ed) return;
      this.ed = null;
      KS.off('view', this.offView);
      ed.el.remove();
      const { doc, layer: L } = ed;
      const empty = !L.text.text.trim();
      if (!ok) {
        if (ed.isNew) doc.removeLayer(L);
        else { L.text = JSON.parse(ed.orig); L.renderText(); }
      } else if (empty && ed.isNew) {
        doc.removeLayer(L);
      } else if (ed.isNew || JSON.stringify(L.text) !== ed.orig) {
        const prevAuto = (JSON.parse(ed.orig).text || '').split('\n')[0].slice(0, 30) || 'Texte';
        if (ed.isNew || L.name === prevAuto || L.name === 'Texte') L.name = L.text.text.split('\n')[0].slice(0, 30) || 'Texte';
        doc.history.push({ name: ed.isNew ? 'Calque de texte' : 'Modifier le texte', icon: 'text', ...KS.Hist.structPart(doc, ed.before) });
      }
      KS.emit('layers', doc);
      T.renderOptions();
      doc.changed();
    },
    key(e) { if (this.ed) return true; return false; },
    overlay(ctx, v, doc) {
      const L = this.ed ? this.ed.layer : (doc.active && doc.active.kind === 'text' ? doc.active : null);
      if (!L) return;
      const b = L.textBox(), a = V.toScreen(b.x, b.y);
      ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = this.ed ? V.colors.accent : 'rgba(128,140,160,0.7)'; ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(a.x) - 3.5, Math.round(a.y) - 3.5, b.w * V.zoom + 7, b.h * V.zoom + 7); ctx.restore();
    },
  });
  function pick(t) { const o = {}; for (const k of ['family', 'size', 'color', 'bold', 'italic', 'underline', 'align', 'leading', 'tracking']) if (t[k] !== undefined) o[k] = t[k]; return o; }
  KS.textTool = textTool;

  /* ---------------------------------------------------------------- formes */
  // Dessine une forme (coordonnées document) ; r = rectangle, a/b = points pour les lignes
  KS.drawShape = (ctx, kind, g, o) => {
    ctx.beginPath();
    const { x, y, w, h: hh } = g.r;
    if (kind === 'rect') ctx.roundRect(x, y, w, hh, KS.rectRadii(Math.abs(w), Math.abs(hh), o.radii));
    else if (kind === 'round') ctx.roundRect(x, y, w, hh, Math.min(o.radius, Math.abs(w) / 2, Math.abs(hh) / 2));
    else if (kind === 'ellipse') ctx.ellipse(x + w / 2, y + hh / 2, Math.abs(w / 2), Math.abs(hh / 2), 0, 0, Math.PI * 2);
    else if (kind === 'polygon' || kind === 'star') {
      const n = Math.max(3, o.sides | 0), cx = x + w / 2, cy = y + hh / 2, rx = w / 2, ry = hh / 2;
      const pts = kind === 'star' ? n * 2 : n;
      for (let i = 0; i < pts; i++) {
        const a = -Math.PI / 2 + i * Math.PI * 2 / pts, k = kind === 'star' && i % 2 ? o.inner / 100 : 1;
        const px = cx + Math.cos(a) * rx * k, py = cy + Math.sin(a) * ry * k;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
    } else if (kind === 'heart') {
      const cx = x + w / 2;
      ctx.moveTo(cx, y + hh * 0.98);
      ctx.bezierCurveTo(x - w * 0.05, y + hh * 0.62, x, y + hh * 0.05, x + w * 0.27, y + hh * 0.04);
      ctx.bezierCurveTo(x + w * 0.4, y + hh * 0.03, cx, y + hh * 0.15, cx, y + hh * 0.28);
      ctx.bezierCurveTo(cx, y + hh * 0.15, x + w * 0.6, y + hh * 0.03, x + w * 0.73, y + hh * 0.04);
      ctx.bezierCurveTo(x + w, y + hh * 0.05, x + w * 1.05, y + hh * 0.62, cx, y + hh * 0.98);
      ctx.closePath();
    } else if (kind === 'line' || kind === 'arrow') {
      const a = g.a, b = g.b, ang = Math.atan2(b.y - a.y, b.x - a.x), lw = o.weight;
      if (kind === 'arrow') {
        const head = Math.max(lw * 3.2, 12), hw = Math.max(lw * 2.4, 9);
        const bx = b.x - Math.cos(ang) * head, by = b.y - Math.sin(ang) * head;
        const nx = -Math.sin(ang), ny = Math.cos(ang);
        ctx.moveTo(a.x + nx * lw / 2, a.y + ny * lw / 2); ctx.lineTo(bx + nx * lw / 2, by + ny * lw / 2); ctx.lineTo(bx + nx * hw, by + ny * hw);
        ctx.lineTo(b.x, b.y); ctx.lineTo(bx - nx * hw, by - ny * hw); ctx.lineTo(bx - nx * lw / 2, by - ny * lw / 2); ctx.lineTo(a.x - nx * lw / 2, a.y - ny * lw / 2); ctx.closePath();
      } else {
        const nx = -Math.sin(ang) * lw / 2, ny = Math.cos(ang) * lw / 2;
        ctx.moveTo(a.x + nx, a.y + ny); ctx.lineTo(b.x + nx, b.y + ny); ctx.lineTo(b.x - nx, b.y - ny); ctx.lineTo(a.x - nx, a.y - ny); ctx.closePath();
      }
    }
    if (o.fill || kind === 'line' || kind === 'arrow') { ctx.fillStyle = o.fillColor; if (o.fill || kind === 'line' || kind === 'arrow') ctx.fill(); }
    if (o.stroke && o.strokeWidth > 0) { ctx.lineWidth = o.strokeWidth; ctx.strokeStyle = o.strokeColor; ctx.lineJoin = 'round'; ctx.stroke(); }
  };
  // Angles du rectangle : un seul rayon pour les quatre (liés), ou un rayon par angle
  const radiiOf = o => o.rLink ? [o.radius, o.radius, o.radius, o.radius] : [o.rTL, o.rTR, o.rBR, o.rBL];
  const cornerOptions = tool => {
    const o = tool.o;
    const link = ui.iconBtn('link', o.rLink ? 'Angles liés : cliquer pour régler chaque angle' : 'Un rayon par angle : cliquer pour les lier', () => {
      if (o.rLink) for (const k of ['rTL', 'rTR', 'rBR', 'rBL']) T.setOpt(tool, k, o.radius);
      else T.setOpt(tool, 'radius', Math.max(o.rTL, o.rTR, o.rBR, o.rBL));
      T.setOpt(tool, 'rLink', !o.rLink); T.renderOptions();
    });
    if (o.rLink) link.classList.add('active');
    const r = { min: 0, max: 2000, unit: 'px' };
    return [{ type: 'sep' }, { type: 'custom', render: () => h('div.opt-group', link) },
      ...(o.rLink ? [{ type: 'scrub', id: 'radius', label: 'Angles', ...r }]
        : [{ type: 'scrub', id: 'rTL', label: '↖', ...r }, { type: 'scrub', id: 'rTR', label: '↗', ...r }, { type: 'scrub', id: 'rBR', label: '↘', ...r }, { type: 'scrub', id: 'rBL', label: '↙', ...r }])];
  };
  const SHAPES = [
    ['shape-rect', 'Rectangle', 'rect'], ['shape-ellipse', 'Ellipse', 'ellipse'],
    ['shape-polygon', 'Polygone', 'polygon'], ['shape-star', 'Étoile', 'star'], ['shape-line', 'Trait', 'line'], ['shape-arrow', 'Flèche', 'arrow'], ['shape-heart', 'Cœur', 'heart'],
  ];
  for (const [id, name, kind] of SHAPES) {
    const lineLike = kind === 'line' || kind === 'arrow';
    T.register({
      id, name, icon: id, shortcut: 'U', cursor: 'crosshair',
      defaults: { fill: true, fillColor: '#3d7cf0', stroke: false, strokeColor: '#000000', strokeWidth: 4, radius: 0, rLink: true, rTL: 0, rTR: 0, rBR: 0, rBL: 0, sides: kind === 'star' ? 5 : 6, inner: 45, weight: 8 },
      options() {
        const useFg = ui.iconBtn('palette', 'Utiliser la couleur de premier plan', () => { T.setOpt(this, 'fillColor', U.hex(KS.state.fg)); T.renderOptions(); });
        return [
          lineLike ? null : { type: 'check', id: 'fill', label: 'Fond' },
          { type: 'color', id: 'fillColor', label: lineLike ? 'Couleur' : '' },
          { type: 'custom', render: () => h('div.opt-group', useFg) },
          { type: 'sep' },
          lineLike ? { type: 'scrub', id: 'weight', label: 'Épaisseur', min: 1, max: 500, unit: 'px' } : null,
          { type: 'check', id: 'stroke', label: 'Contour' }, { type: 'color', id: 'strokeColor' }, { type: 'scrub', id: 'strokeWidth', min: 0, max: 300, unit: 'px' },
          ...(kind === 'rect' ? cornerOptions(this) : []),
          kind === 'polygon' || kind === 'star' ? { type: 'scrub', id: 'sides', label: kind === 'star' ? 'Branches' : 'Côtés', min: 3, max: 64 } : null,
          kind === 'star' ? { type: 'scrub', id: 'inner', label: 'Creux', min: 5, max: 95, unit: '%' } : null,
        ];
      },
      geom() {
        const a = this.a, b = this.b;
        if (lineLike) return { a, b, r: U.normRect(a, b) };
        let w = b.x - a.x, hh = b.y - a.y;
        if (this.sq) { const s = Math.max(Math.abs(w), Math.abs(hh)); w = s * Math.sign(w || 1); hh = s * Math.sign(hh || 1); }
        const r = this.ctr ? { x: a.x - Math.abs(w), y: a.y - Math.abs(hh), w: Math.abs(w) * 2, h: Math.abs(hh) * 2 } : U.normRect(a, { x: a.x + w, y: a.y + hh });
        return { r };
      },
      down(ev, doc) { this.a = T.snapPoint(doc, ev); this.b = this.a; this.on = true; },
      move(ev, doc) {
        if (!this.on) return;
        this.b = lineLike && ev.shift ? KS.snap45(this.a, ev) : T.snapPoint(doc, ev);
        this.sq = ev.shift; this.ctr = ev.alt;
      },
      up(ev, doc) {
        if (!this.on) return;
        this.on = false;
        const g = this.geom();
        if ((lineLike ? U.dist(g.a, g.b) : Math.min(g.r.w, g.r.h)) < 2) return;
        const o = { ...this.o, radii: radiiOf(this.o) };
        const L = KS.newShapeLayer(doc, doc.newLayerName(name), KS.shapeSubpaths(kind, g, o), { fill: lineLike ? true : o.fill, fillColor: o.fillColor, stroke: o.stroke, strokeColor: o.strokeColor, strokeWidth: o.strokeWidth });
        if (kind === 'rect') L.shape.live = { kind: 'rect', ...g.r, radii: o.radii };
        KS.Hist.structure(doc, name, () => doc.addLayer(L, doc.activeIndex + 1), id);
      },
      cancel() { this.on = false; },
      overlay(ctx) {
        if (!this.on) return;
        const g = this.geom();
        ctx.globalAlpha = 0.85;
        V.docPath(ctx, c => KS.drawShape(c, kind, g, { ...this.o, radii: radiiOf(this.o) }));
        ctx.globalAlpha = 1;
        V.docPath(ctx, c => { c.lineWidth = 1 / V.zoom; c.strokeStyle = V.colors.accent; c.setLineDash([4 / V.zoom, 3 / V.zoom]); c.strokeRect(g.r.x, g.r.y, g.r.w, g.r.h); });
      },
    });
  }

  /* ---------------------------------------------------------------- main, zoom */
  T.register({
    id: 'hand', name: 'Main', icon: 'hand', shortcut: 'H', cursor: 'grab',
    options: () => [
      { type: 'button', text: '100 %', action: () => KS.view.setZoom(1) },
      { type: 'button', text: 'Taille écran', action: () => KS.view.fit(KS.state.doc, true) },
      { type: 'button', text: 'Remplir l\'écran', action: () => { const d = KS.state.doc; KS.view.setZoom(Math.max(V.w / d.width, V.h / d.height)); KS.view.center(d); } },
    ],
    // H maintenu + clic : vue d'ensemble (toute l'image, cadre de la vue actuelle) ; au relâchement, retour au zoom d'avant, là où est le cadre
    down(ev, doc) {
      if (KS.keys?.h && doc && V.zoom > Math.min((V.w - 80) / doc.width, (V.h - 80) / doc.height) * 1.05) {
        this.bird = { zoom: V.zoom, w: V.w / V.zoom, h: V.h / V.zoom }; V.fit(doc, true); this.birdAt(ev); return;
      }
      this.p = ev; V.canvas.style.cursor = 'grabbing';
    },
    birdAt(ev) { this.bird.x = ev.x; this.bird.y = ev.y; KS.requestRender(); },
    move(ev) { if (this.bird) return this.birdAt(ev); if (this.p) { V.pan(ev.sx - this.p.sx, ev.sy - this.p.sy); this.p = ev; } },
    up() {
      const b = this.bird; this.bird = null;
      if (b) { V.zoom = b.zoom; V.ox = V.w / 2 - b.x * b.zoom; V.oy = V.h / 2 - b.y * b.zoom; V.store(); KS.requestRender(); }
      this.p = null; T.updateCursor();
    },
    overlay(ctx) {
      const b = this.bird; if (!b) return;
      const p = V.toScreen(b.x - b.w / 2, b.y - b.h / 2), w = b.w * V.zoom, hh = b.h * V.zoom;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.strokeRect(p.x, p.y, w, hh);
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.strokeRect(p.x, p.y, w, hh);
    },
    dblclick(ev, doc) { V.fit(doc, true); },
  });
  T.register({
    id: 'zoom', name: 'Zoom', icon: 'zoom', shortcut: 'Z', cursor: 'zoom-in',
    defaults: { scrubby: true },
    options: () => [
      { type: 'check', id: 'scrubby', label: 'Zoom par glissement' },
      { type: 'sep' },
      { type: 'button', text: '100 %', action: () => KS.view.setZoom(1) },
      { type: 'button', text: 'Taille écran', action: () => KS.view.fit(KS.state.doc, true) },
    ],
    down(ev) { this.p0 = ev; this.z0 = V.zoom; this.moved = false; this.alt = ev.alt; },
    move(ev) {
      if (!this.p0) return;
      const dx = ev.sx - this.p0.sx;
      if (Math.abs(dx) > 3) this.moved = true;
      if (this.moved && this.o.scrubby) V.setZoom(this.z0 * Math.exp(dx / 150), this.p0.sx, this.p0.sy);
    },
    up(ev) {
      if (this.p0 && !this.moved) V.zoomStep(ev.alt ? -1 : 1, ev.sx, ev.sy);
      this.p0 = null;
    },
    cursor() { return KS.keys?.alt ? 'zoom-out' : 'zoom-in'; },
  });
})();

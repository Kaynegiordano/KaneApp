// IA locale : détourage du sujet (BiRefNet, ONNX), exécuté sur la machine.
// Le modèle est téléchargé une seule fois, à la demande, après confirmation.
'use strict';
(() => {
  const U = KS.util, h = KS.h, ui = KS.ui, C = KS.cmd, T = KS.tools, V = KS.view;
  const N = KS.native;
  const ai = KS.ai = { available: !!(N && N.aiStatus) };
  const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

  // Modèle prêt (téléchargé) ; sinon propose de le télécharger
  ai.ensureModel = async () => {
    if (!ai.available) return null;
    const list = (await N.aiStatus()).filter(m => m.kind === 'segment');
    const pref = KS.prefs.aiModel;
    const ready = list.filter(m => m.installed);
    if (ready.length) return (ready.find(m => m.id === pref) || ready[0]).id;
    return ai.downloadDialog(list);
  };
  ai.downloadDialog = (list, o = {}) => new Promise(res => {
    let choice = list.some(m => m.id === 'birefnet-lite') ? 'birefnet-lite' : list[0].id;
    const opts = h('div.preset-list');
    const rows = list.map(m => {
      const r = h('div.preset-row' + (m.id === choice ? '.on' : ''), h('span.t', { text: m.name }), h('span.s', { text: Math.round(m.size / 1048576) + ' Mo' }));
      r.addEventListener('click', () => { choice = m.id; rows.forEach(x => x.classList.toggle('on', x === r)); });
      opts.appendChild(r); return r;
    });
    const bar = h('div', { style: { height: '6px', borderRadius: '4px', background: 'var(--border-2)', overflow: 'hidden', marginTop: '12px' } }, h('div', { style: { height: '100%', width: '0%', background: 'var(--accent)', transition: 'width .2s' } }));
    const status = h('div.note', { style: { marginTop: '6px' } });
    const body = h('div', { style: { width: '460px' } },
      h('p', { style: { marginTop: '0', color: 'var(--text-2)', lineHeight: '1.5' }, text: o.text || 'Le détourage par IA utilise le modèle BiRefNet (licence MIT), qui tourne entièrement sur votre PC (carte graphique via DirectML si possible). Il faut le télécharger une fois depuis GitHub.' }),
      opts, bar, status);
    let busy = false;
    const m = KS.modal({
      title: o.title || 'Télécharger le modèle de détourage', body,
      buttons: [{ label: 'Annuler', value: null }, { label: 'Télécharger', primary: true, value: 'ok', action: async () => {
        if (busy) return false;
        busy = true; m.primary.disabled = true;
        const off = p => { if (p.id !== choice) return; bar.firstChild.style.width = (p.got / p.total * 100).toFixed(1) + '%'; status.textContent = `${Math.round(p.got / 1048576)} / ${Math.round(p.total / 1048576)} Mo`; };
        ai._progress = off;
        status.textContent = 'Téléchargement…';
        const r = await N.aiDownload(choice);
        ai._progress = null;
        busy = false; m.primary.disabled = false;
        if (!r.ok) { status.textContent = 'Échec : ' + r.error; return false; }
        if (list.find(m => m.id === choice)?.kind === 'segment') { KS.prefs.aiModel = choice; KS.prefs.save(); }
        return true;
      } }],
      onClose: v => res(v === 'ok' ? choice : null),
    });
  });
  if (ai.available) N.onAiProgress(p => ai._progress && ai._progress(p));

  // Masque du sujet (canevas w×h, alpha = sujet) à partir d'une image
  ai.segment = async (src, id) => {
    const S = 1024, c = U.canvas(S, S), x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, S, S);
    x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, S, S);
    const p = x.getImageData(0, 0, S, S).data, n = S * S, t = new Float32Array(3 * n);
    // normalisation par tables (256 valeurs par couche) plutôt qu'un calcul par pixel
    const tab = [0, 1, 2].map(k => Float32Array.from({ length: 256 }, (_, v) => (v / 255 - MEAN[k]) / STD[k]));
    const [t0, t1, t2] = tab;
    for (let i = 0, q = 0; i < n; i++, q += 4) { t[i] = t0[p[q]]; t[n + i] = t1[p[q + 1]]; t[2 * n + i] = t2[p[q + 2]]; }
    const r = await N.aiSegment(id, t);
    if (!r.ok) throw new Error(r.error);
    ai.lastEP = r.ep;
    const img = new ImageData(S, S), o = img.data, m = r.mask;
    for (let i = 0; i < n; i++) o[i * 4 + 3] = m[i];
    const mk = U.canvas(S, S); U.putData(mk, img);
    const out = U.canvas(src.width, src.height), ox = out.getContext('2d');
    ox.imageSmoothingQuality = 'high'; ox.drawImage(mk, 0, 0, src.width, src.height);
    return out;
  };

  // Masque du sujet du document (IA si disponible, sinon méthode par couleurs de bord)
  C.subjectMaskAsync = async (d, L, region) => {
    const src = (() => {
      const c = U.canvas(d.width, d.height);
      if (L) { const im = L.image(); c.getContext('2d').drawImage(im.canvas, im.x, im.y); } else c.getContext('2d').drawImage(d.composite(), 0, 0);
      return c;
    })();
    if (ai.available) {
      const id = await ai.ensureModel();
      if (id) {
        const R = region || d.rect;
        const crop = U.copyCanvas(src, R);
        const m = await KS.busy(() => ai.segment(crop, id));
        const full = U.canvas(d.width, d.height); full.getContext('2d').drawImage(m, R.x, R.y);
        return full;
      }
      if (!region) KS.toast('Sans modèle IA : détourage approximatif par couleurs', 'info', 3000);
    }
    if (region) {
      const tmp = new KS.Doc({ width: region.w, height: region.h });
      tmp.addLayer(new KS.Layer({ name: 't', canvas: U.copyCanvas(src, region) }), 0);
      const m = C.subjectMask(tmp, null); if (!m) return null;
      const full = U.canvas(d.width, d.height); full.getContext('2d').drawImage(m, region.x, region.y); return full;
    }
    return C.subjectMask(d, L);
  };
  C.selectSubject = async () => {
    const d = KS.state.doc; if (!d) return;
    try {
      const m = await C.subjectMaskAsync(d, null);
      if (!m) { KS.toast('Sujet introuvable : essayez la sélection rapide', 'err'); return; }
      KS.Hist.selection(d, 'Sélectionner le sujet', () => d.selection.combineCanvas(m, 'new'), 'sparkles');
    } catch (e) { KS.toast('Détourage impossible : ' + e.message, 'err', 5000); }
  };
  C.removeBackground = async () => {
    const d = KS.state.doc; if (!d) return;
    const L = T.pixelLayer(d, { allowMaskEdit: false }); if (!L) return;
    try {
      const m = await C.subjectMaskAsync(d, L);
      if (!m) { KS.toast('Impossible de distinguer le sujet du fond', 'err'); return; }
      KS.Hist.structure(d, 'Supprimer l\'arrière-plan', () => {
        const prev = d.selection.mask; d.selection.mask = m; d.selection.refresh();
        L.mask = null; L.addMask(d, 'selection');
        d.selection.mask = prev; d.selection.refresh();
      }, 'sparkles');
      KS.toast('Arrière-plan masqué (masque de fusion modifiable)', 'ok');
    } catch (e) { KS.toast('Détourage impossible : ' + e.message, 'err', 5000); }
  };
  C.aiModels = async () => {
    if (!ai.available) { KS.toast('L\'IA n\'est disponible que dans l\'application de bureau', 'info'); return; }
    const list = await N.aiStatus();
    const body = h('div.form-col', { style: { width: '440px', gap: '10px' } },
      ...list.map(m => h('div.form-row', h('span', { text: m.name, style: { flex: '1' } }), h('span.note', { text: Math.round(m.size / 1048576) + ' Mo' }),
        m.installed && m.kind !== 'segment' ? h('span.note', { text: 'Installé' }) : m.installed ? ui.btn(KS.prefs.aiModel === m.id ? 'Utilisé' : 'Utiliser', () => { KS.prefs.aiModel = m.id; KS.prefs.save(); KS.toast('Modèle : ' + m.name, 'ok'); }, '.small' + (KS.prefs.aiModel === m.id ? '.primary' : ''))
          : ui.btn('Télécharger…', async () => { md.close(); if (m.kind === 'inpaint') await ai.ensureInpaint(true); else if (m.kind === 'translate') await KS.gen.mtReady(true); else await ai.downloadDialog([m]); }, '.small'))),
      h('div.note', { text: 'Les modèles sont rangés dans le dossier de données de KaneApp. Calcul local, rien n\'est envoyé en ligne.' }));
    const md = KS.modal({ title: 'Modèles d\'IA', body, buttons: [{ label: 'Fermer', primary: true }] });
  };

  /* ---------------------------------------------------------------- outil Sélection d'objet */
  T.register({
    id: 'object-select', name: 'Sélection d\'objet', icon: 'object-select', shortcut: 'W', cursor: 'crosshair', defaults: { mode: 'new' },
    options: () => [
      { type: 'selmode' }, { type: 'sep' },
      { type: 'custom', render: () => h('span.opt-label', { text: 'Encadrez un objet : il est détouré automatiquement' + (ai.available ? ' (IA locale)' : '') }) },
      { type: 'sep' },
      { type: 'button', text: 'Sélectionner le sujet', icon: 'sparkles', action: () => C.selectSubject() },
      ai.available ? { type: 'button', text: 'Modèles d\'IA…', action: () => C.aiModels() } : null,
    ],
    down(ev, doc) { this.a = { x: ev.x, y: ev.y }; this.b = this.a; this.mode = ev.shift ? 'add' : ev.alt ? 'sub' : (this.o.mode || 'new'); },
    move(ev) { if (this.a) this.b = { x: ev.x, y: ev.y }; },
    async up(ev, doc) {
      if (!this.a) return;
      const r0 = U.normRect(this.a, this.b); this.a = null;
      if (r0.w < 4 || r0.h < 4) return;
      const pad = Math.max(r0.w, r0.h) * 0.12;
      const R = U.rectIntersect(U.rectInt({ x: r0.x - pad, y: r0.y - pad, w: r0.w + pad * 2, h: r0.h + pad * 2 }), doc.rect);
      if (!R) return;
      try {
        const m = await C.subjectMaskAsync(doc, null, R);
        if (!m) { KS.toast('Aucun objet trouvé dans le cadre', 'err'); return; }
        // on garde l'objet dans le cadre tracé (légèrement agrandi)
        const x = m.getContext('2d'), k = 4;
        x.globalCompositeOperation = 'destination-in'; x.fillRect(r0.x - k, r0.y - k, r0.w + k * 2, r0.h + k * 2);
        KS.Hist.selection(doc, 'Sélection d\'objet', () => doc.selection.combineCanvas(m, this.mode), 'object-select');
      } catch (e) { KS.toast('Détourage impossible : ' + e.message, 'err', 5000); }
    },
    cancel() { this.a = null; },
    overlay(ctx) {
      if (!this.a) return;
      const r = U.normRect(this.a, this.b), p = V.toScreen(r.x, r.y);
      ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(p.x + 0.5, p.y + 0.5, r.w * V.zoom, r.h * V.zoom);
      ctx.strokeStyle = V.colors.accent; ctx.lineDashOffset = 4; ctx.strokeRect(p.x + 0.5, p.y + 0.5, r.w * V.zoom, r.h * V.zoom); ctx.restore();
    },
  });
})();

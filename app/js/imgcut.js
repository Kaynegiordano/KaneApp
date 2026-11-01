// Découpe pour les réseaux (ImgCut de Forge, en mieux) : une image large en panneaux de carrousel
// (Instagram 4:5, Story 9:16, X 3:4…), ou en grille de profil 3 colonnes. Aperçu en direct sur l'image,
// cadrage par glissement, fond blanc, noir ou flou de l'image ; export numéroté dans un dossier.
'use strict';
(() => {
  const U = KS.util, h = KS.h, ui = KS.ui, C = KS.cmd;
  const FORMATS = { '4:5': 'Instagram · publication (4:5)', '9:16': 'Instagram · Story / Reel (9:16)', '3:4': 'X · portrait (3:4)', '2:3': 'Portrait classique (2:3)', '1:1': 'Carré (1:1)' };
  const MAXP = 10;
  const ratioOf = s => { const m = /^\s*(\d{1,2})\s*:\s*(\d{1,2})\s*$/.exec(s || ''); return m ? [+m[1], +m[2]] : null; };
  const lossOf = (W, H, r, n) => { const a = W / H, t = n * r[0] / r[1]; return 1 - Math.min(a, t) / Math.max(a, t); };
  // Même choix qu'ImgCut : le format et le nombre qui gardent le plus d'image (léger bonus aux moins de panneaux)
  const layout = (W, H, o) => {
    if (o.mode === 'grid') {
      const r = ratioOf(o.tile) || [1, 1], cols = 3;
      const rows = o.count || U.clamp(Math.round(H * cols * r[0] / (W * r[1])), 1, 6);
      return { kind: 'grid', r, cols, rows, n: cols * rows, label: `Grille ${cols} × ${rows}`, loss: lossOf(W, H, [r[0] * cols, r[1] * rows], 1) };
    }
    if (o.format === 'auto') {
      let best = null;
      for (const [k, label] of Object.entries(FORMATS)) {
        if (k === '1:1') continue;
        const r = ratioOf(k);
        for (let n = o.count || 1; n <= (o.count || MAXP); n++) { const l = lossOf(W, H, r, n), sc = l + 0.008 * (n - 1); if (!best || sc < best.sc) best = { sc, r, n, label, loss: l }; }
      }
      return { kind: 'row', r: best.r, n: best.n, cols: best.n, rows: 1, label: best.label, loss: best.loss };
    }
    const r = ratioOf(o.format === 'custom' ? o.custom : o.format) || [4, 5];
    const n = o.count || U.clamp(Math.floor(W * r[1] / (H * r[0]) + 0.5), 1, MAXP);
    return { kind: 'row', r, n, cols: n, rows: 1, label: FORMATS[o.format] || `Personnalisé (${r[0]}:${r[1]})`, loss: lossOf(W, H, r, n) };
  };
  // Grand canevas (tous les panneaux côte à côte) rempli selon le mode, puis découpé
  const render = (src, L, o, pw) => {
    const ph = Math.round(pw * L.r[1] / L.r[0]), CW = pw * L.cols, CH = ph * L.rows;
    const c = U.canvas(CW, CH), x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    const cover = o.fit === 'cover';
    const k = cover ? Math.max(CW / src.width, CH / src.height) : Math.min(CW / src.width, CH / src.height);
    const dw = src.width * k, dh = src.height * k;
    if (!cover) {
      if (o.bg === 'blur') { const b = Math.max(CW / src.width, CH / src.height); x.filter = `blur(${Math.round(Math.max(CW, CH) / 60)}px) brightness(0.9)`; x.drawImage(src, (CW - src.width * b) / 2, (CH - src.height * b) / 2, src.width * b, src.height * b); x.filter = 'none'; }
      else { x.fillStyle = o.bg === 'black' ? '#000' : '#fff'; x.fillRect(0, 0, CW, CH); }
    }
    const ox = (CW - dw) / 2 + (cover ? o.dx * Math.max(0, dw - CW) / 2 : 0), oy = (CH - dh) / 2 + (cover ? o.dy * Math.max(0, dh - CH) / 2 : 0);
    x.drawImage(src, ox, oy, dw, dh);
    const panels = [];
    for (let r = 0; r < L.rows; r++) for (let q = 0; q < L.cols; q++) panels.push({ r, q, c: U.copyCanvas(c, { x: q * pw, y: r * ph, w: pw, h: ph }) });
    // grille de profil : on publie d'abord la case en bas à droite (elle finit en bas à droite du profil)
    if (L.kind === 'grid') panels.sort((a, b) => (b.r - a.r) || (b.q - a.q));
    return { full: c, panels: panels.map(p => p.c), pw, ph };
  };

  C.socialCut = async input => {
    let d = input?.canvas ? { name: input.name || 'Image Studio', composite: () => input.canvas } : KS.state.doc;
    if (!d && KS.native?.openDialog) {
      const files = await KS.native.openDialog({ title: 'Image à découper', multi: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }] });
      if (!files?.[0]) return;
      try { const canvas = await KS.io.canvasFromEntry(files[0]); d = { name: files[0].name, composite: () => canvas }; }
      catch (e) { KS.toast('Image illisible : ' + e.message, 'err'); return; }
    }
    if (!d) return KS.toast('Ouvrez ou générez une image à découper.', 'info');
    const src = d.composite();
    const o = Object.assign({ mode: 'row', format: 'auto', custom: '4:5', tile: '1:1', count: 0, fit: 'cover', bg: 'white', width: 1080, file: 'jpeg', dx: 0, dy: 0 }, KS.prefs.socialCut || {}, { dx: 0, dy: 0 });
    const prev = h('canvas.sc-prev'), info = h('div.note');
    const VW = 760, VH = 360;
    const draw = () => {
      const L = layout(src.width, src.height, o);
      const R = render(src, L, o, 240);
      const k = Math.min(VW / R.full.width, VH / R.full.height);
      prev.width = Math.round(R.full.width * k); prev.height = Math.round(R.full.height * k);
      const x = prev.getContext('2d'); x.drawImage(R.full, 0, 0, prev.width, prev.height);
      x.strokeStyle = 'rgba(255,255,255,.95)'; x.lineWidth = 2; x.setLineDash([6, 4]);
      for (let q = 1; q < L.cols; q++) { const X = Math.round(q * prev.width / L.cols) + 0.5; x.beginPath(); x.moveTo(X, 0); x.lineTo(X, prev.height); x.stroke(); }
      for (let r = 1; r < L.rows; r++) { const Y = Math.round(r * prev.height / L.rows) + 0.5; x.beginPath(); x.moveTo(0, Y); x.lineTo(prev.width, Y); x.stroke(); }
      x.setLineDash([]); x.font = '600 13px system-ui'; x.fillStyle = '#fff'; x.shadowColor = 'rgba(0,0,0,.7)'; x.shadowBlur = 4;
      const order = L.kind === 'grid' ? null : [...Array(L.n).keys()];
      for (let i = 0; i < L.n; i++) {
        let q, r, num;
        if (order) { q = i; r = 0; num = i + 1; } else { r = Math.floor(i / L.cols); q = i % L.cols; num = (L.rows - 1 - r) * L.cols + (L.cols - 1 - q) + 1; }
        x.fillText(String(num).padStart(2, '0'), q * prev.width / L.cols + 8, r * prev.height / L.rows + 20);
      }
      x.shadowBlur = 0;
      const ph = Math.round(o.width * L.r[1] / L.r[0]);
      info.textContent = `${L.label} : ${L.n} ${L.n > 1 ? 'panneaux' : 'panneau'} de ${o.width} × ${ph} px` +
        (L.loss >= 0.005 ? ` · environ ${Math.round(L.loss * 100)} % ${o.fit === 'cover' ? 'de recadrage (faites glisser l\'aperçu pour cadrer)' : 'de marges'}` : '') +
        (L.kind === 'grid' ? ' · numérotés dans l\'ordre de publication (01 en premier, il finit en bas à droite)' : ' · de gauche à droite');
    };
    // cadrage : glisser l'aperçu
    prev.addEventListener('pointerdown', e => {
      if (o.fit !== 'cover') return;
      prev.setPointerCapture(e.pointerId);
      const x0 = e.clientX, y0 = e.clientY, a = o.dx, b = o.dy;
      const mv = ev => { o.dx = U.clamp(a + (ev.clientX - x0) / (prev.width / 2), -1, 1); o.dy = U.clamp(b + (ev.clientY - y0) / (prev.height / 2), -1, 1); draw(); };
      const up = () => { prev.removeEventListener('pointermove', mv); prev.removeEventListener('pointerup', up); };
      prev.addEventListener('pointermove', mv); prev.addEventListener('pointerup', up);
    });
    const set = (k, v) => { o[k] = v; draw(); refresh(); };
    const fmtSel = ui.select([['auto', 'Auto · meilleur format vertical'], ...Object.entries(FORMATS), ['custom', 'Personnalisé…']], o.format, v => set('format', v));
    const custom = h('input.field', { type: 'text', value: o.custom, style: { width: '70px' } });
    custom.addEventListener('change', () => set('custom', custom.value)); custom.addEventListener('keydown', e => e.stopPropagation());
    const tileSel = ui.select([['1:1', 'Cases carrées (1:1)'], ['4:5', 'Cases 4:5'], ['3:4', 'Cases 3:4 (profil 2025)']], o.tile, v => set('tile', v));
    const rowFmt = h('div.sc-opt', h('label.l', { text: 'Format' }), fmtSel, custom);
    const rowTile = h('div.sc-opt', h('label.l', { text: 'Cases' }), tileSel);
    const refresh = () => { rowFmt.hidden = o.mode === 'grid'; rowTile.hidden = o.mode !== 'grid'; custom.hidden = o.format !== 'custom'; };
    const body = h('div.form-col', { style: { width: VW + 'px', gap: '10px' } },
      h('div.sc-opts',
        h('div.sc-opt', h('label.l', { text: 'Découpe' }), ui.seg([['row', 'Carrousel'], ['grid', 'Grille du profil']], o.mode, v => { o.count = 0; set('mode', v); })),
        rowFmt, rowTile,
        h('div.sc-opt', h('label.l', { text: 'Nombre' }), ui.scrub({ value: o.count, min: 0, max: 10, onInput: v => set('count', v), title: '0 = automatique' }), h('span.note', { text: '0 = auto' })),
        h('div.sc-opt', h('label.l', { text: 'Remplissage' }), ui.seg([['cover', 'Remplir (recadrer)'], ['contain', 'Image entière']], o.fit, v => set('fit', v))),
        h('div.sc-opt', h('label.l', { text: 'Fond' }), ui.seg([['white', 'Blanc'], ['black', 'Noir'], ['blur', 'Flou de l\'image']], o.bg, v => set('bg', v))),
        h('div.sc-opt', h('label.l', { text: 'Largeur' }), ui.scrub({ value: o.width, min: 320, max: 2160, unit: 'px', onInput: v => set('width', v) })),
        h('div.sc-opt', h('label.l', { text: 'Fichiers' }), ui.seg([['jpeg', 'JPEG'], ['png', 'PNG']], o.file, v => set('file', v)))),
      h('div.sc-stage', prev), info);
    refresh(); draw();
    KS.modal({
      title: 'Découper pour les réseaux', body,
      buttons: [{ label: 'Annuler', value: null }, { label: 'Exporter les panneaux…', primary: true, value: 'ok', action: async () => {
        const L = layout(src.width, src.height, o), R = render(src, L, o, Math.round(o.width));
        if (R.pw * L.cols * R.ph * L.rows > 60e6) { KS.toast('Sortie trop grande : réduisez la largeur', 'err'); return false; }
        const mime = o.file === 'png' ? 'image/png' : 'image/jpeg', ext = o.file === 'png' ? 'png' : 'jpg';
        const base = d.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '') || 'KaneApp';
        const files = [];
        for (let i = 0; i < R.panels.length; i++) {
          const blob = await U.blobFromCanvas(R.panels[i], mime, 0.92);
          files.push({ name: `${base}_${String(i + 1).padStart(2, '0')}.${ext}`, data: new Uint8Array(await blob.arrayBuffer()) });
        }
        KS.prefs.socialCut = { ...o, dx: 0, dy: 0 }; KS.prefs.save();
        if (KS.native && KS.native.saveFiles) {
          const r = await KS.native.saveFiles('Dossier des panneaux', files);
          if (r.canceled) return false;
          if (!r.ok) { KS.toast('Export impossible : ' + r.error, 'err', 5000); return false; }
          KS.toast(`${r.written.length} panneaux enregistrés`, 'ok');
        } else for (const f of files) U.download(new Blob([f.data]), f.name);
      } }],
    });
  };
})();

// Boîtes de dialogue.
'use strict';
(() => {
  const U = KS.util, h = KS.h, ui = KS.ui;
  KS.once = (ev, fn) => { const w = (...a) => { KS.off(ev, w); fn(...a); }; KS.on(ev, w); };

  /* ---------------------------------------------------------------- noyau */
  const stack = [];
  KS.modalOpen = () => stack.length > 0;
  KS.modal = ({ title, body, width, buttons = [], left = [], onClose, seeThrough = false, closeOnBackdrop = false, noFoot = false }) => {
    let resolveDone;
    const done = new Promise(resolve => { resolveDone = resolve; });
    const back = h('div.modal-back' + (seeThrough ? '.see-through' : ''));
    const head = h('div.modal-head', h('h3', { text: title }), ui.iconBtn('close', 'Fermer', () => close(null), '.sm'));
    const bodyEl = h('div.modal-body', body);
    const foot = h('div.modal-foot', ...left, h('div.spacer'));
    let primary = null;
    for (const b of buttons) {
      const btn = ui.btn(b.label, async () => {
        if (b.action) { const r = await b.action(); if (r === false) return; }
        close(b.value !== undefined ? b.value : b.label);
      }, b.primary ? '.primary' : '');
      if (b.primary) primary = btn;
      foot.appendChild(btn);
    }
    const el = h('div.modal', { style: { width: width ? width + 'px' : null } }, head, bodyEl, noFoot ? null : foot);
    back.appendChild(el);
    KS.$('#modals').appendChild(back);
    let closed = false;
    function close(v) {
      if (closed) return;
      closed = true;
      back.remove();
      stack.splice(stack.indexOf(api), 1);
      resolveDone(v);
      onClose && onClose(v);
    }
    // déplacer la boîte par son titre
    head.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      const r = el.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
      el.style.position = 'fixed'; el.style.left = r.left + 'px'; el.style.top = r.top + 'px'; el.style.margin = '0';
      head.setPointerCapture(e.pointerId);
      const mv = ev => { el.style.left = r.left + ev.clientX - x0 + 'px'; el.style.top = Math.max(0, r.top + ev.clientY - y0) + 'px'; };
      const up = () => { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); };
      head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up);
    });
    if (closeOnBackdrop) back.addEventListener('pointerdown', e => { if (e.target === back) close(null); });
    const api = { el, body: bodyEl, close, primary, back, foot, done };
    stack.push(api);
    setTimeout(() => { const f = el.querySelector('input.field, select.field, textarea'); if (f && !f.dataset.nofocus) { f.focus(); if (f.select) f.select(); } }, 30);
    return api;
  };
  document.addEventListener('keydown', e => {
    const top = stack[stack.length - 1];
    if (!top) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); top.close(null); }
    else if (e.key === 'Enter' && top.primary && !(e.target.tagName === 'TEXTAREA') && !e.target.closest('.seg')) {
      e.preventDefault(); e.stopPropagation();
      if (e.target.tagName === 'INPUT') e.target.dispatchEvent(new Event('change'));
      setTimeout(() => top.primary.click(), 0);
    }
  }, true);

  KS.confirm = (message, { title = 'KaneApp', ok = 'OK', cancel = 'Annuler', third = null, danger = false } = {}) => new Promise(res => {
    const buttons = [];
    if (third) buttons.push({ label: third, value: 'third' });
    buttons.push({ label: cancel, value: false });
    buttons.push({ label: ok, primary: true, value: true });
    KS.modal({ title, body: h('div', { style: { maxWidth: '440px', lineHeight: '1.5', color: 'var(--text-2)' }, text: message }), buttons, onClose: v => res(v === null ? false : v) });
    void danger;
  });
  KS.prompt = (title, label, value, { type = 'text', min, max, unit, step = 1 } = {}) => new Promise(res => {
    const f = h('input.field', { type: 'text', value: value ?? '', style: { width: type === 'number' ? '110px' : '300px' } });
    f.addEventListener('keydown', e => e.stopPropagation());
    const body = h('div.form-row', h('label.l', { text: label }), f, unit ? h('span.note', { text: unit }) : null);
    KS.modal({
      title, body, buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }],
      onClose: v => {
        if (v !== 'ok') return res(null);
        if (type === 'number') { let n = parseFloat(String(f.value).replace(',', '.')); if (isNaN(n)) return res(null); if (min != null) n = Math.max(min, n); if (max != null) n = Math.min(max, n); return res(Math.round(n / step) * step); }
        res(f.value);
      },
    });
  });

  const D = KS.dialogs = {};
  const numField = (value, w = 80) => { const f = h('input.field', { type: 'text', value, style: { width: w + 'px', textAlign: 'right' } }); f.addEventListener('keydown', e => e.stopPropagation()); return f; };
  const num = f => { const n = parseFloat(String(f.value).replace(',', '.')); return isNaN(n) ? 0 : n; };

  /* ---------------------------------------------------------------- nouveau document */
  D.PRESETS = [
    { t: 'Personnalisé', w: null },
    { t: 'Full HD', w: 1920, h: 1080, s: '1920 × 1080' },
    { t: '4K UHD', w: 3840, h: 2160, s: '3840 × 2160' },
    { t: 'QHD (fond d\'écran)', w: 2560, h: 1440, s: '2560 × 1440' },
    { t: 'Ultra-large', w: 3440, h: 1440, s: '3440 × 1440' },
    { t: 'Instagram carré', w: 1080, h: 1080, s: '1080 × 1080' },
    { t: 'Instagram portrait', w: 1080, h: 1350, s: '1080 × 1350' },
    { t: 'Story / Reels', w: 1080, h: 1920, s: '1080 × 1920' },
    { t: 'Miniature YouTube', w: 1280, h: 720, s: '1280 × 720' },
    { t: 'A4 300 ppp', w: 2480, h: 3508, s: '2480 × 3508' },
    { t: 'A3 300 ppp', w: 3508, h: 4961, s: '3508 × 4961' },
    { t: 'Carte postale', w: 1748, h: 1240, s: '1748 × 1240' },
    { t: 'Icône', w: 512, h: 512, s: '512 × 512' },
    { t: 'Bannière web', w: 1500, h: 500, s: '1500 × 500' },
  ];
  D.newDoc = (initial = {}) => new Promise(res => {
    const last = KS.prefs.lastNew || { w: 1920, h: 1080, bg: 'white' };
    const nameF = h('input.field', { type: 'text', value: initial.name || 'Sans titre ' + (KS.state.docs.length + 1), style: { width: '100%' } });
    nameF.addEventListener('keydown', e => e.stopPropagation());
    const wF = numField(initial.w || last.w), hF = numField(initial.h || last.h);
    let ratio = (initial.w || last.w) / (initial.h || last.h), linked = false;
    const link = ui.iconBtn('link', 'Conserver les proportions', () => { linked = !linked; link.classList.toggle('on', linked); ratio = num(wF) / Math.max(1, num(hF)); });
    wF.addEventListener('input', () => { if (linked) hF.value = Math.round(num(wF) / ratio); mark(); });
    hF.addEventListener('input', () => { if (linked) wF.value = Math.round(num(hF) * ratio); mark(); });
    let bg = initial.bg || last.bg;
    const bgSel = ui.select([['white', 'Blanc'], ['black', 'Noir'], ['transparent', 'Transparent'], ['bg', 'Couleur d\'arrière-plan']], bg, v => { bg = v; });
    const orient = ui.seg([['p', 'Portrait', 'Portrait'], ['l', 'Paysage', 'Paysage']], 'l', () => { const a = wF.value; wF.value = hF.value; hF.value = a; mark(); });
    const list = h('div.preset-list', { style: { width: '250px' } });
    const rows = D.PRESETS.map(p => {
      const r = h('div.preset-row', h('span.t', { text: p.t }), p.s ? h('span.s', { text: p.s }) : null);
      r.addEventListener('click', () => { if (p.w) { wF.value = p.w; hF.value = p.h; } mark(); });
      r.addEventListener('dblclick', () => m.primary.click());
      list.appendChild(r);
      return r;
    });
    function mark() {
      const w = num(wF), hh = num(hF);
      let found = false;
      rows.forEach((r, i) => { const p = D.PRESETS[i]; const on = p.w && ((p.w === w && p.h === hh)); r.classList.toggle('on', on); found = found || on; });
      if (!found) rows[0].classList.add('on');
      orient.set(w >= hh ? 'l' : 'p');
      info.textContent = `${U.fmtBytes(w * hh * 4)} par calque`;
    }
    const info = h('div.note');
    const form = h('div.form-grid', { style: { flex: '1' } },
      h('label.l', { text: 'Nom' }), nameF,
      h('label.l', { text: 'Largeur' }), h('div.form-row', wF, h('span.note', { text: 'px' }), link),
      h('label.l', { text: 'Hauteur' }), h('div.form-row', hF, h('span.note', { text: 'px' })),
      h('label.l', { text: 'Orientation' }), orient,
      h('label.l', { text: 'Fond' }), bgSel,
      h('span'), info);
    mark();
    const m = KS.modal({
      title: 'Nouveau document', width: 640, body: h('div.dialog-split', list, form),
      buttons: [{ label: 'Annuler', value: null }, { label: 'Créer', primary: true, value: 'ok' }],
      onClose: v => {
        if (v !== 'ok') return res(null);
        const w = U.clamp(Math.round(num(wF)), 1, 30000), hh = U.clamp(Math.round(num(hF)), 1, 30000);
        KS.prefs.lastNew = { w, h: hh, bg }; KS.prefs.save();
        res({ name: nameF.value.trim() || 'Sans titre', width: w, height: hh, background: bg });
      },
    });
  });

  /* ---------------------------------------------------------------- taille de l'image */
  D.imageSize = doc => new Promise(res => {
    const wF = numField(doc.width), hF = numField(doc.height), pF = numField(100, 70);
    let linked = true;
    const link = ui.iconBtn('link', 'Conserver les proportions', () => { linked = !linked; link.classList.toggle('on', linked); });
    link.classList.add('on');
    const r = doc.width / doc.height;
    wF.addEventListener('input', () => { if (linked) hF.value = Math.round(num(wF) / r); pF.value = Math.round(num(wF) / doc.width * 1000) / 10; upd(); });
    hF.addEventListener('input', () => { if (linked) wF.value = Math.round(num(hF) * r); pF.value = Math.round(num(hF) / doc.height * 1000) / 10; upd(); });
    pF.addEventListener('input', () => { wF.value = Math.round(doc.width * num(pF) / 100); hF.value = Math.round(doc.height * num(pF) / 100); upd(); });
    let q = 'high';
    const qSel = ui.select([['high', 'Automatique (bicubique)'], ['medium', 'Bilinéaire'], ['pixelated', 'Au plus proche (pixels nets)']], q, v => { q = v; });
    const info = h('div.note');
    const upd = () => { info.textContent = `Taille : ${U.fmtBytes(num(wF) * num(hF) * 4 * doc.layers.length)} (avant : ${U.fmtBytes(doc.width * doc.height * 4 * doc.layers.length)})`; };
    upd();
    KS.modal({
      title: 'Taille de l\'image', width: 420,
      body: h('div.form-grid',
        h('label.l', { text: 'Largeur' }), h('div.form-row', wF, h('span.note', { text: 'px' }), link),
        h('label.l', { text: 'Hauteur' }), h('div.form-row', hF, h('span.note', { text: 'px' })),
        h('label.l', { text: 'Échelle' }), h('div.form-row', pF, h('span.note', { text: '%' })),
        h('label.l', { text: 'Rééchantillonnage' }), qSel, h('span'), info),
      buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }],
      onClose: v => res(v === 'ok' ? { w: U.clamp(Math.round(num(wF)), 1, 30000), h: U.clamp(Math.round(num(hF)), 1, 30000), quality: q } : null),
    });
  });

  /* ---------------------------------------------------------------- taille de la zone de travail */
  D.canvasSize = doc => new Promise(res => {
    const wF = numField(doc.width), hF = numField(doc.height);
    let rel = false, anchor = 4;
    const relC = ui.check('Relative', false, v => { rel = v; wF.value = v ? 0 : doc.width; hF.value = v ? 0 : doc.height; });
    const grid = h('div.anchor-grid');
    const btns = [...Array(9)].map((_, i) => { const b = h('button', { 'aria-label': 'Ancrage ' + (i + 1) }); b.addEventListener('click', () => { anchor = i; btns.forEach((x, j) => x.classList.toggle('on', j === i)); }); grid.appendChild(b); return b; });
    btns[4].classList.add('on');
    let color = 'transparent';
    const cSel = ui.select([['transparent', 'Transparent'], ['bg', 'Arrière-plan'], ['fg', 'Premier plan'], ['white', 'Blanc'], ['black', 'Noir']], color, v => { color = v; });
    KS.modal({
      title: 'Taille de la zone de travail', width: 420,
      body: h('div.form-grid',
        h('label.l', { text: 'Actuelle' }), h('span.note', { text: `${doc.width} × ${doc.height} px` }),
        h('label.l', { text: 'Largeur' }), h('div.form-row', wF, h('span.note', { text: 'px' })),
        h('label.l', { text: 'Hauteur' }), h('div.form-row', hF, h('span.note', { text: 'px' })),
        h('span'), relC,
        h('label.l', { text: 'Position' }), grid,
        h('label.l', { text: 'Extension' }), cSel),
      buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }],
      onClose: v => {
        if (v !== 'ok') return res(null);
        let w = Math.round(num(wF)), hh = Math.round(num(hF));
        if (rel) { w += doc.width; hh += doc.height; }
        res({ w: U.clamp(w, 1, 30000), h: U.clamp(hh, 1, 30000), ax: anchor % 3, ay: Math.floor(anchor / 3), color });
      },
    });
  });

  /* ---------------------------------------------------------------- éditeur de courbes */
  ui.curvesEditor = (params, onInput, histo) => {
    const wrap = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
    let ch = params.channel || 'rgb', sel = -1;
    const chSel = ui.select([['rgb', 'RVB'], ['r', 'Rouge'], ['g', 'Vert'], ['b', 'Bleu']], ch, v => { ch = v; params.channel = v; sel = -1; draw(); });
    const presets = ui.select([['', 'Paramètre prédéfini…'], ['contrast', 'Contraste moyen'], ['strong', 'Contraste fort'], ['lighter', 'Plus clair'], ['darker', 'Plus foncé'], ['negative', 'Négatif'], ['fade', 'Fondu (mat)'], ['linear', 'Linéaire']], '', v => {
      const P = { contrast: [[0, 0], [64, 52], [192, 204], [255, 255]], strong: [[0, 0], [64, 40], [192, 216], [255, 255]], lighter: [[0, 0], [110, 150], [255, 255]], darker: [[0, 0], [150, 110], [255, 255]], negative: [[0, 255], [255, 0]], fade: [[0, 40], [128, 128], [255, 230]], linear: [[0, 0], [255, 255]] };
      if (P[v]) { params[ch] = P[v].map(p => p.slice()); sel = -1; draw(); onInput(params); }
      presets.value = '';
    });
    const cv = h('canvas', { width: 256, height: 256 });
    const box = h('div.curve-box', cv);
    const inF = numField('', 56), outF = numField('', 56);
    const apply = () => { if (sel < 0) return; const p = params[ch][sel]; p[0] = U.clamp(num(inF), 0, 255); p[1] = U.clamp(num(outF), 0, 255); draw(); onInput(params); };
    inF.addEventListener('change', apply); outF.addEventListener('change', apply);
    wrap.append(h('div.form-row', h('span.opt-label', { text: 'Couche' }), chSel, presets), box, h('div.form-row', h('span.opt-label', { text: 'Entrée' }), inF, h('span.opt-label', { text: 'Sortie' }), outF, h('span.note', { text: 'Clic : ajouter · glisser hors du cadre : supprimer' })));
    const color = { rgb: '#e8e8e8', r: '#ff5a5a', g: '#4cd964', b: '#4c8dff' };
    function draw() {
      const x = cv.getContext('2d');
      x.clearRect(0, 0, 256, 256);
      if (histo) {
        const hh = histo[ch === 'rgb' ? 'l' : ch]; let mx = 1; for (let i = 0; i < 256; i++) mx = Math.max(mx, hh[i]);
        x.fillStyle = 'rgba(140,150,165,0.25)';
        for (let i = 0; i < 256; i++) { const v = Math.sqrt(hh[i] / mx) * 256; x.fillRect(i, 256 - v, 1, v); }
      }
      x.strokeStyle = 'rgba(140,150,165,0.25)'; x.lineWidth = 1; x.beginPath();
      for (let i = 1; i < 4; i++) { x.moveTo(i * 64 + 0.5, 0); x.lineTo(i * 64 + 0.5, 256); x.moveTo(0, i * 64 + 0.5); x.lineTo(256, i * 64 + 0.5); }
      x.moveTo(0, 256); x.lineTo(256, 0); x.stroke();
      const lut = KS.Adjust.curveLUT(params[ch]);
      x.strokeStyle = color[ch]; x.lineWidth = 2; x.beginPath();
      for (let i = 0; i < 256; i++) { const y = 255 - lut[i]; i ? x.lineTo(i, y) : x.moveTo(i, y); }
      x.stroke();
      params[ch].forEach((p, i) => { x.beginPath(); x.rect(p[0] - 4, 255 - p[1] - 4, 8, 8); x.fillStyle = i === sel ? color[ch] : '#1b1e24'; x.fill(); x.strokeStyle = color[ch]; x.lineWidth = 1.5; x.stroke(); });
      if (sel >= 0) { inF.value = Math.round(params[ch][sel][0]); outF.value = Math.round(params[ch][sel][1]); } else { inF.value = ''; outF.value = ''; }
    }
    box.addEventListener('pointerdown', e => {
      const r = cv.getBoundingClientRect();
      const pt = ev => [U.clamp((ev.clientX - r.left) / r.width * 256, 0, 255), U.clamp(255 - (ev.clientY - r.top) / r.height * 256, 0, 255)];
      const [px, py] = pt(e);
      const pts = params[ch];
      sel = pts.findIndex(p => Math.abs(p[0] - px) < 8 && Math.abs(p[1] - py) < 8);
      if (sel < 0) { pts.push([px, py]); pts.sort((a, b) => a[0] - b[0]); sel = pts.findIndex(p => p[0] === px && p[1] === py); onInput(params); }
      draw();
      box.setPointerCapture(e.pointerId);
      const mv = ev => {
        const [x, y] = pt(ev);
        const out = ev.clientX < r.left - 20 || ev.clientX > r.right + 20 || ev.clientY < r.top - 20 || ev.clientY > r.bottom + 20;
        const p = pts[sel]; if (!p) return;
        if (out && pts.length > 2) { p.hidden = true; } else p.hidden = false;
        const lo = sel > 0 ? pts[sel - 1][0] + 1 : 0, hi = sel < pts.length - 1 ? pts[sel + 1][0] - 1 : 255;
        p[0] = U.clamp(x, lo, hi); p[1] = y;
        const save = params[ch];
        params[ch] = pts.filter(q => !q.hidden);
        draw(); onInput(params);
        params[ch] = save;
      };
      const up = () => {
        box.removeEventListener('pointermove', mv); box.removeEventListener('pointerup', up);
        params[ch] = pts.filter(q => !q.hidden); params[ch].forEach(q => delete q.hidden);
        if (sel >= params[ch].length) sel = -1;
        draw(); onInput(params);
      };
      box.addEventListener('pointermove', mv); box.addEventListener('pointerup', up);
    });
    draw();
    wrap.refresh = () => draw();
    return wrap;
  };

  /* ---------------------------------------------------------------- éditeur de niveaux */
  ui.levelsEditor = (params, onInput, histo, autoFn) => {
    const wrap = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', minWidth: '260px', maxWidth: '340px' } });
    let ch = params.channel || 'rgb';
    const chSel = ui.select([['rgb', 'RVB'], ['r', 'Rouge'], ['g', 'Vert'], ['b', 'Bleu']], ch, v => { ch = v; params.channel = v; sync(); });
    const cv = h('canvas.levels-hist', { width: 300, height: 110 });
    const track = h('div', { style: { position: 'relative', height: '16px', margin: '0 0 4px' } });
    const mk = (fill) => h('div', { style: { position: 'absolute', top: '0', width: '0', height: '0', borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderBottom: `10px solid ${fill}`, transform: 'translateX(-6px)', cursor: 'ew-resize', filter: 'drop-shadow(0 0 1px rgba(0,0,0,.8))' } });
    const kB = mk('#000'), kG = mk('#888'), kW = mk('#fff');
    track.append(kB, kG, kW);
    const ib = numField(0, 50), ig = numField(1, 50), iw = numField(255, 50), ob = numField(0, 50), ow = numField(255, 50);
    const outGrad = h('div.grad-bar', { style: { background: 'linear-gradient(90deg,#000,#fff)' } });
    wrap.append(h('div.form-row', h('span.opt-label', { text: 'Couche' }), chSel, autoFn ? ui.btn('Auto', () => { autoFn(); sync(); onInput(params); }, '.small') : null),
      cv, track, h('div.form-row', { style: { justifyContent: 'space-between' } }, ib, ig, iw),
      h('span.opt-label', { text: 'Niveaux de sortie' }), outGrad, h('div.form-row', { style: { justifyContent: 'space-between' } }, ob, ow));
    const L = () => params[ch];
    function sync() {
      const l = L();
      ib.value = Math.round(l.inBlack); ig.value = l.gamma.toFixed(2); iw.value = Math.round(l.inWhite); ob.value = Math.round(l.outBlack); ow.value = Math.round(l.outWhite);
      const W = track.clientWidth || 300;
      kB.style.left = l.inBlack / 255 * W + 'px'; kW.style.left = l.inWhite / 255 * W + 'px';
      const gpos = l.inBlack + (l.inWhite - l.inBlack) * Math.pow(0.5, l.gamma);
      kG.style.left = gpos / 255 * W + 'px';
      const x = cv.getContext('2d'); x.clearRect(0, 0, 300, 110);
      if (histo) {
        const hh = histo[ch === 'rgb' ? 'l' : ch]; let mx = 1; for (let i = 0; i < 256; i++) mx = Math.max(mx, hh[i]);
        x.fillStyle = ch === 'r' ? '#ff6b6b' : ch === 'g' ? '#5ad17a' : ch === 'b' ? '#5b93f5' : '#b9c0cc';
        for (let i = 0; i < 256; i++) { const v = Math.sqrt(hh[i] / mx) * 108; x.fillRect(i * 300 / 256, 110 - v, 300 / 256 + 0.5, v); }
      }
    }
    const fromFields = () => {
      const l = L();
      l.inBlack = U.clamp(num(ib), 0, 253); l.inWhite = U.clamp(num(iw), l.inBlack + 2, 255); l.gamma = U.clamp(num(ig), 0.1, 9.99);
      l.outBlack = U.clamp(num(ob), 0, 255); l.outWhite = U.clamp(num(ow), 0, 255);
      sync(); onInput(params);
    };
    [ib, ig, iw, ob, ow].forEach(f => f.addEventListener('change', fromFields));
    const drag = (knob, fn) => knob.addEventListener('pointerdown', e => {
      e.preventDefault(); knob.setPointerCapture(e.pointerId);
      const r = track.getBoundingClientRect();
      const mv = ev => { fn(U.clamp((ev.clientX - r.left) / r.width * 255, 0, 255)); sync(); onInput(params); };
      const up = () => { knob.removeEventListener('pointermove', mv); knob.removeEventListener('pointerup', up); };
      knob.addEventListener('pointermove', mv); knob.addEventListener('pointerup', up);
    });
    drag(kB, v => { const l = L(); l.inBlack = Math.min(v, l.inWhite - 2); });
    drag(kW, v => { const l = L(); l.inWhite = Math.max(v, l.inBlack + 2); });
    drag(kG, v => { const l = L(); const t = U.clamp((v - l.inBlack) / (l.inWhite - l.inBlack), 0.01, 0.99); l.gamma = U.clamp(Math.log(t) / Math.log(0.5), 0.1, 9.99); });
    requestAnimationFrame(sync);
    wrap.refresh = sync;
    return wrap;
  };

  // Interface de paramètres d'un réglage ou d'un filtre (boîtes et panneau Propriétés)
  // Correction sélective : une gamme de couleurs choisie, ses quatre encres, et la méthode
  const SELECTIVE_RANGES = [['reds', 'Rouges'], ['yellows', 'Jaunes'], ['greens', 'Verts'], ['cyans', 'Cyans'], ['blues', 'Bleus'], ['magentas', 'Magentas'], ['whites', 'Blancs'], ['neutrals', 'Neutres'], ['blacks', 'Noirs']];
  function selectiveEditor(values, onInput) {
    let range = 'reds';
    const el = h('div', { style: { minWidth: '380px' } });
    const inks = [['c', 'Cyan', 'linear-gradient(90deg,#ff3b30,#e8e8e8,#00c2e0)'], ['m', 'Magenta', 'linear-gradient(90deg,#34c759,#e8e8e8,#e0007a)'], ['y', 'Jaune', 'linear-gradient(90deg,#3d7cf0,#e8e8e8,#f5d000)'], ['k', 'Noir', 'linear-gradient(90deg,#ffffff,#808080,#000000)']];
    const rows = inks.map(([k, label, gradient]) => ui.paramRow({ id: k, label, min: -100, max: 100, unit: '%', gradient }, (values[range] || {})[k] || 0, v => {
      values[range] = { c: 0, m: 0, y: 0, k: 0, ...values[range], [k]: v };
      onInput(values);
    }));
    const pick = ui.select(SELECTIVE_RANGES, range, v => { range = v; rows.forEach((r, i) => r.set((values[range] || {})[inks[i][0]] || 0)); });
    const method = ui.seg([['relative', 'Relative'], ['absolute', 'Absolue']], values.method || 'relative', v => { values.method = v; onInput(values); });
    el.append(h('div.param.wide', h('span.pl', { text: 'Couleurs' }), pick), ...rows, h('div.param.wide', h('span.pl', { text: 'Méthode' }), method));
    el.refresh = () => rows.forEach((r, i) => r.set((values[range] || {})[inks[i][0]] || 0));
    return el;
  }
  KS.buildParamUI = (def, values, onInput, opts = {}) => {
    if (def.custom === 'curves') return ui.curvesEditor(values, onInput, opts.histo);
    if (def.custom === 'levels') return ui.levelsEditor(values, onInput, opts.histo, opts.auto);
    if (def.custom === 'selective') return selectiveEditor(values, onInput);
    const el = h('div', { style: { minWidth: opts.width || '380px' } });
    const rows = [];
    for (const p of def.params) {
      const row = ui.paramRow(p, values[p.id], v => { values[p.id] = v; onInput(values); });
      row.def = p; rows.push(row);
      el.appendChild(row);
    }
    el.refresh = () => rows.forEach(r => r.def.id && r.set && r.set(values[r.def.id]));
    if (!def.params.length) el.appendChild(h('div.note', { text: 'Ce filtre n\'a pas de paramètre.' }));
    return el;
  };

  // Boîte générique avec aperçu en direct sur le document
  D.params = ({ title, def, values, histo, preview, cancel, apply, auto, width }) => new Promise(res => {
    let on = true, closed = false;
    const vals = values;
    const run = U.throttle(() => { if (on && !closed) preview(vals); }, 70);
    const content = KS.buildParamUI(def, vals, () => run(), { histo, auto: auto ? () => auto(vals) : null });
    const prev = ui.check('Aperçu', true, v => { on = v; if (v) preview(vals); else cancel(true); });
    const reset = ui.btn('Réinitialiser', () => {
      const d = KS.Adjust.defs[def.key] ? KS.Adjust.defaults(def.key) : Object.fromEntries(def.params.filter(p => p.id).map(p => [p.id, p.def]));
      for (const k in vals) delete vals[k];
      Object.assign(vals, d);
      const parent = content.parentElement;
      const fresh = KS.buildParamUI(def, vals, () => run(), { histo, auto: auto ? () => auto(vals) : null });
      parent.replaceChild(fresh, parent.firstChild);
      run();
    }, '.small');
    KS.modal({
      title, width, body: h('div', content), seeThrough: true,
      left: [prev, reset],
      buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }],
      onClose: v => { closed = true; if (v === 'ok') { apply(vals); res(vals); } else { cancel(); res(null); } },
    });
    setTimeout(() => { if (!closed && on) preview(vals); }, 30);
  });

  /* ---------------------------------------------------------------- remplir / contour */
  D.fill = () => new Promise(res => {
    let src = 'fg', mode = 'normal', op = 100, keep = false;
    const s = ui.select([['fg', 'Couleur de premier plan'], ['bg', 'Couleur d\'arrière-plan'], ['color', 'Couleur…'], ['black', 'Noir'], ['gray', 'Gris 50 %'], ['white', 'Blanc'], ['content', 'Contenu pris en compte (retouche)']], src, v => { src = v; });
    const b = KS.blendSelect(mode, v => { mode = v; });
    const o = ui.scrub({ value: op, min: 1, max: 100, unit: '%', onInput: v => { op = v; } });
    const k = ui.check('Préserver la transparence', false, v => { keep = v; });
    KS.modal({
      title: 'Remplir', width: 420,
      body: h('div.form-grid', h('label.l', { text: 'Contenu' }), s, h('label.l', { text: 'Mode' }), b, h('label.l', { text: 'Opacité' }), o, h('span'), k),
      buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }],
      onClose: async v => {
        if (v !== 'ok') return res(null);
        let color = null;
        if (src === 'color') { color = await KS.pickColor(KS.state.fg, 'Couleur de remplissage'); if (!color) return res(null); }
        res({ src, mode, opacity: op / 100, keep, color });
      },
    });
  });
  D.stroke = () => new Promise(res => {
    let width = 3, pos = 'center', color = U.hex(KS.state.fg), op = 100, mode = 'normal';
    const w = ui.scrub({ value: width, min: 1, max: 250, unit: 'px', onInput: v => { width = v; } });
    const c = ui.colorChip(color, v => { color = v; });
    const p = ui.seg([['inside', 'Intérieur'], ['center', 'Centre'], ['outside', 'Extérieur']], pos, v => { pos = v; });
    const b = KS.blendSelect(mode, v => { mode = v; });
    const o = ui.scrub({ value: op, min: 1, max: 100, unit: '%', onInput: v => { op = v; } });
    KS.modal({
      title: 'Contour', width: 420,
      body: h('div.form-grid', h('label.l', { text: 'Épaisseur' }), w, h('label.l', { text: 'Couleur' }), c, h('label.l', { text: 'Position' }), p, h('label.l', { text: 'Mode' }), b, h('label.l', { text: 'Opacité' }), o),
      buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }],
      onClose: v => res(v === 'ok' ? { width, pos, color, opacity: op / 100, mode } : null),
    });
  });

  /* ---------------------------------------------------------------- style de calque */
  D.layerStyle = (doc, layer, start = 'shadow') => new Promise(res => {
    const before = JSON.parse(JSON.stringify(layer.effects || null));
    const fx = layer.effects ? JSON.parse(JSON.stringify(layer.effects)) : KS.defaultEffects();
    const defaults = KS.defaultEffects();
    for (const k in defaults) if (!fx[k]) fx[k] = defaults[k];
    const blendBefore = { blend: layer.blend, opacity: layer.opacity };
    const upd = () => { layer.effects = JSON.parse(JSON.stringify(fx)); layer.touch(); doc.changed(); };
    const sections = [
      ['blend', 'Options de fusion'],
      ['shadow', 'Ombre portée'], ['glow', 'Lueur externe'], ['innerGlow', 'Lueur interne'], ['stroke', 'Contour'], ['overlay', 'Incrustation couleur'],
    ];
    const side = h('div.dialog-side'), pane = h('div', { style: { flex: '1', minWidth: '360px' } });
    const checks = {};
    let current = start;
    const row = (label, ctrl) => h('div.param.wide', h('span.pl', { text: label }), ctrl);
    const scrub = (obj, key, min, max, unit, step = 1, scale = 1) => ui.scrub({ value: obj[key] * scale, min, max, step, unit, onInput: v => { obj[key] = v / scale; upd(); } });
    function show(id) {
      current = id;
      side.querySelectorAll('.side-item').forEach(e => e.classList.toggle('active', e.dataset.id === id));
      pane.innerHTML = '';
      pane.appendChild(h('h4', { text: sections.find(s => s[0] === id)[1], style: { margin: '2px 0 10px', fontSize: '14px' } }));
      if (id === 'blend') {
        pane.append(
          row('Mode de fusion', KS.blendSelect(layer.blend, v => { layer.blend = v; doc.changed(); })),
          row('Opacité', ui.scrub({ value: Math.round(layer.opacity * 100), min: 0, max: 100, unit: '%', onInput: v => { layer.opacity = v / 100; doc.changed(); } })));
        return;
      }
      const o = fx[id];
      if (o.color !== undefined) pane.appendChild(row('Couleur', ui.colorChip(o.color, v => { o.color = v; if (!o.on) { o.on = true; checks[id].set(true); } upd(); })));
      if (o.blend !== undefined) pane.appendChild(row('Mode', KS.blendSelect(o.blend, v => { o.blend = v; upd(); })));
      if (o.opacity !== undefined) pane.appendChild(row('Opacité', scrub(o, 'opacity', 0, 100, '%', 1, 100)));
      if (id === 'shadow') pane.append(row('Angle', scrub(o, 'angle', -180, 180, '°')), row('Distance', scrub(o, 'distance', 0, 500, 'px')), row('Taille', scrub(o, 'size', 0, 250, 'px')));
      if (id === 'glow' || id === 'innerGlow') pane.append(row('Taille', scrub(o, 'size', 0, 250, 'px')));
      if (id === 'stroke') pane.append(row('Taille', scrub(o, 'size', 1, 250, 'px')), row('Position', ui.seg([['outside', 'Extérieur'], ['center', 'Centre'], ['inside', 'Intérieur']], o.position, v => { o.position = v; upd(); })));
      if (!o.on) { o.on = true; checks[id].set(true); upd(); }
    }
    for (const [id, label] of sections) {
      const it = h('div.side-item', { 'data-id': id });
      if (id !== 'blend') {
        const c = ui.check('', fx[id].on, v => { fx[id].on = v; upd(); });
        c.addEventListener('click', e => e.stopPropagation());
        checks[id] = c; it.appendChild(c);
      } else it.appendChild(h('span', { style: { width: '16px' } }));
      it.appendChild(h('span', { text: label }));
      it.addEventListener('click', () => show(id));
      side.appendChild(it);
    }
    show(start);
    KS.modal({
      title: 'Style de calque — ' + layer.name, width: 640, seeThrough: true, body: h('div.dialog-split', side, pane),
      buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }],
      onClose: v => {
        if (v !== 'ok') { layer.effects = before; Object.assign(layer, blendBefore); layer.touch(); doc.changed(); return res(null); }
        const after = fx;
        const any = Object.values(after).some(e => e.on);
        const newBlend = { blend: layer.blend, opacity: layer.opacity };
        layer.effects = before; Object.assign(layer, blendBefore);
        KS.Hist.structure(doc, 'Style de calque', () => { layer.effects = any ? after : null; Object.assign(layer, newBlend); layer.touch(); }, 'fx');
        res(after);
      },
    });
    void current;
  });

  /* ---------------------------------------------------------------- export */
  D.exportAs = doc => new Promise(res => {
    let fmt = 'png', q = 92, scale = 100, bg = '#ffffff';
    const preview = h('img', { style: { maxWidth: '100%', maxHeight: '360px', display: 'block', margin: '0 auto', borderRadius: '6px' }, class: 'checker' });
    const info = h('div.note', { style: { textAlign: 'center', marginTop: '8px' } });
    const fSel = ui.select([['png', 'PNG'], ['jpeg', 'JPEG'], ['webp', 'WebP']], fmt, v => { fmt = v; qRow.style.display = v === 'png' ? 'none' : ''; run(); });
    const qs = ui.scrub({ value: q, min: 1, max: 100, unit: '%', onInput: v => { q = v; run(); } });
    const qRow = h('div.form-row', h('span.opt-label', { text: 'Qualité' }), qs); qRow.style.display = 'none';
    const ss = ui.scrub({ value: scale, min: 1, max: 400, unit: '%', onInput: v => { scale = v; run(); } });
    let url = null, blob = null;
    const run = U.debounce(async () => {
      const c = KS.io.exportCanvas(doc, scale / 100, fmt === 'png' ? null : bg);
      blob = await U.blobFromCanvas(c, 'image/' + fmt, q / 100);
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(blob); preview.src = url;
      info.textContent = `${c.width} × ${c.height} px — ${U.fmtBytes(blob.size)}`;
    }, 150);
    run();
    KS.modal({
      title: 'Exporter sous', width: 720,
      body: h('div.dialog-split', h('div', { style: { flex: '1', minWidth: '360px' } }, preview, info),
        h('div.form-col', { style: { width: '220px', gap: '12px' } }, h('div.form-row', h('span.opt-label', { text: 'Format' }), fSel), qRow, h('div.form-row', h('span.opt-label', { text: 'Échelle' }), ss),
          h('div.note', { text: 'Le JPEG n\'a pas de transparence : le fond devient blanc.' }))),
      buttons: [{ label: 'Annuler', value: null }, { label: 'Exporter…', primary: true, value: 'ok' }],
      onClose: v => { if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); res(v === 'ok' ? { fmt, quality: q / 100, scale: scale / 100 } : null); },
    });
  });

  /* ---------------------------------------------------------------- préférences (voir ui/preferences.js) */
  D.prefs = tab => KS.prefsDialog && KS.prefsDialog.open(typeof tab === 'string' ? tab : undefined);

  D.enginePrefs = async () => {
    const N = KS.native;
    if (!N?.engineConfig) return KS.toast('Disponible dans l’application de bureau.', 'info');
    if (KS.studioApi?.isBusy()) return KS.toast('Attendez la fin de la génération avant de changer le moteur.', 'info');
    const config = await N.engineConfig();
    if (config.managed) return KS.modal({ title: 'Moteurs gérés par KaneApp', width: 640,
      body: h('div.form-col', h('p', { text: 'Le Studio utilise sa copie vérifiée dans les données de KaneApp.' }), h('div.note', { text: config.runtime }),
        h('p.note', { text: 'Les modèles communs restent dans ' + config.models + '. Les anciennes installations sont conservées.' })),
      buttons: [{ label: 'Fermer' }, { label: 'Gérer la migration…', primary: true, action: () => D.runtimeMigration() }] });
    let directory = config.runtime, models = config.models, shareExternal = config.shareExternal;
    const runtimeText = h('div.note', { text: directory }), modelsText = h('div.note', { text: models });
    const body = h('div.form-col', { style: { gap: '12px' } },
      h('p', { text: 'Le Studio démarre son moteur local sans ouvrir l’interface de Forge. Vous pouvez lui attribuer un runtime et des modèles séparés de KaneOS.' }),
      h('b', { text: 'Dossier du moteur' }), runtimeText, ui.btn('Choisir le moteur…', async () => { const selected = await N.pickFolder('Moteur local avec launch.py et venv'); if (selected) { directory = selected; runtimeText.textContent = selected; } }, '.small'),
      h('b', { text: 'Dossier des modèles' }), modelsText, ui.btn('Choisir les modèles…', async () => { const selected = await N.pickFolder('Dossier des modèles du Studio'); if (selected) { models = selected; modelsText.textContent = selected; } }, '.small'),
      ui.check('Réutiliser le moteur Forge de KaneOS s’il est déjà lancé', shareExternal, v => shareExternal = v),
      h('p.note', { text: 'Cette configuration ne copie pas les fichiers et n’installe pas Python. Le backend actuel reste compatible Forge ; conservez son installation tant que vous n’avez pas préparé un runtime séparé.' }));
    KS.modal({ title: 'Moteur du Studio IA', width: 640, body, buttons: [{ label: 'Annuler' }, { label: 'Enregistrer', primary: true, action: async () => {
      const r = await N.engineConfigSave({ directory, models, shareExternal });
      if (!r.ok) { KS.toast(r.error, 'err', 6000); return false; }
      KS.toast('Configuration du moteur enregistrée.', 'ok');
    } }] });
  };

  let migrationView = null;
  KS.native?.onRuntimeMigration?.(value => migrationView?.(value));
  D.runtimeMigration = async () => {
    const N = KS.native;
    if (!N?.runtimeMigrationState) return KS.toast('Disponible dans l’application de bureau.', 'info');
    const status = h('div.note', { role: 'status', 'aria-live': 'polite' }), rows = h('div.form-col');
    const buttons = {};
    const action = (key, label) => buttons[key] = ui.btn(label, async () => {
      if (KS.studioApi?.isBusy() || await KS.trainingRunning?.()) return KS.toast('Attendez la fin des tâches IA et de l’entraînement.', 'info');
      const result = await N.runtimeMigrationRun(key);
      if (!result.ok) KS.toast(result.error, 'err', 6000);
      update(await N.runtimeMigrationState());
    }, '.small');
    const labels = { studio: 'Studio IA', comfyui: 'Animation Vidéo · ComfyUI', wallpaper: 'Animation', training: 'Entraînement LoRA', media: 'Montage · FFmpeg' };
    const phases = { inventoried: 'Inventorié', copying: 'Copie en cours', verified: 'Copie vérifiée', probed: 'Environnement testé' };
    const update = value => {
      const components = Object.entries(value.report?.components || {});
      const copied = components.length === 4 && components.every(([, c]) => ['verified', 'probed'].includes(c.phase));
      const tested = copied && components.every(([, c]) => c.phase === 'probed') && value.report.integrityCheckedAt && value.report.media?.phase === 'probed';
      status.textContent = value.error || (value.running ? 'Opération en cours… ' + (labels[value.progress?.component] || '') + (value.progress?.files ? ' · ' + value.progress.files + ' fichiers' : '') : value.active ? 'KaneApp utilise ses copies des moteurs.' : 'Les installations actuelles sont encore utilisées.');
      rows.replaceChildren(h('div.note', { text: value.destination }), ...components.map(([id, c]) => h('div.note', { text: labels[id] + ' · ' + (phases[c.phase] || c.phase) + ' · ' + (c.bytes / 2 ** 30).toFixed(1) + ' Go' })));
      if (value.report?.media) rows.append(h('div.note', { text: 'Montage · FFmpeg · ' + (phases[value.report.media.phase] || value.report.media.phase) }));
      buttons.copy.disabled = value.running || value.active;
      buttons.verify.disabled = value.running || !copied;
      buttons.probe.disabled = value.running || !copied || !value.report?.integrityCheckedAt;
      buttons.activate.disabled = value.running || value.active || !tested;
      buttons.rollback.disabled = value.running || !value.active || !!value.report?.cleanup?.startedAt;
      if (value.report?.cleanup?.startedAt) status.textContent = value.error || 'Migration définitive : les moteurs et projets sont gérés par KaneApp. Les anciennes installations sont retirées.';
    };
    const body = h('div.form-col', { style: { gap: '12px' } },
      h('p', { text: 'Les moteurs, extensions, environnements Python et projets sont copiés dans les données de KaneApp. Les modèles communs restent partagés dans leur dossier actuel.' }),
      status, rows,
      h('div.form-row', action('copy', '1. Copier les moteurs'), action('verify', '2. Vérifier les fichiers'), action('probe', '3. Tester les environnements')),
      h('div.form-row', action('activate', 'Activer les copies vérifiées'), action('rollback', 'Revenir aux installations précédentes')),
      h('p.note', { text: 'Le retrait des anciennes installations est une opération distincte, après validation de vos usages et vérification des données. Après ce retrait, les moteurs restent gérés par KaneApp et le retour aux anciennes installations est désactivé.' }));
    KS.modal({ title: 'Migration des applications vers KaneApp', body, width: 760, buttons: [{ label: 'Fermer', primary: true }], onClose: () => { migrationView = null; } });
    migrationView = update; update(await N.runtimeMigrationState());
  };

  /* ---------------------------------------------------------------- raccourcis, à propos */
  D.shortcuts = () => {
    const sec = (t, rows) => h('section', h('h4', { text: t }), h('div.shortcut-table', rows.flatMap(([a, b]) => [h('span', { text: a }), h('span.k', { text: b })])));
    const body = h('div.shortcut-cols', { style: { width: '900px' } },
      sec('Outils', [['Déplacement', 'V'], ['Sélection rect./elliptique', 'M'], ['Lasso', 'L'], ['Baguette / sélection rapide', 'W'], ['Recadrage', 'C'], ['Pipette', 'I'], ['Correcteur', 'J'], ['Pinceau / crayon', 'B'], ['Tampon de duplication', 'S'], ['Gomme', 'E'], ['Dégradé / pot de peinture', 'G'], ['Netteté, flou, doigt', 'R'], ['Densité, éponge', 'O'], ['Texte', 'T'], ['Formes', 'U'], ['Main', 'H (Espace)'], ['Zoom', 'Z'], ['Outil suivant du groupe', 'Maj + touche']]),
      sec('Pinceaux', [['Taille au geste', 'Alt + clic (droit ou gauche) + glisser ↔'], ['Dureté au geste', 'Alt + clic (droit ou gauche) + glisser ↕'], ['Opacité / flux au geste', 'Ctrl + Alt + clic droit + glisser ↔ / ↕'], ['Couleur au curseur', 'Maj + Alt + clic droit'], ['Annuler le geste', 'Échap'], ['Taille −/+', '[  ]'], ['Dureté −/+', 'Maj [  ]'], ['Opacité 10…100 %', '1…0'], ['Opacité exacte', 'deux chiffres vite (4 5 = 45 %)'], ['Flux', 'Maj + chiffres'], ['Pipette temporaire', 'Alt + clic'], ['Ligne droite', 'Maj + clic'], ['Forme et taille du pinceau', 'clic droit sur l’image']]),
      sec('Gestes', [['Outil à ressort', 'maintenir sa touche, utiliser, relâcher'], ['Vue d’ensemble', 'H maintenu + clic, relâcher sur la zone'], ['Main temporaire', 'Espace'], ['Zoom temporaire', 'Ctrl / Alt + Espace + clic']]),
      sec('Couleurs', [['Couleurs par défaut', 'D'], ['Permuter', 'X'], ['Masque rapide', 'Q'], ['Remplir premier plan', 'Alt+Retour arr.'], ['Remplir arrière-plan', 'Ctrl+Retour arr.']]),
      sec('Fichier', [['Nouveau', 'Ctrl+N'], ['Ouvrir', 'Ctrl+O'], ['Enregistrer', 'Ctrl+S'], ['Enregistrer sous', 'Ctrl+Maj+S'], ['Exporter sous', 'Ctrl+Alt+Maj+W'], ['Fermer', 'Ctrl+W']]),
      sec('Édition', [['Annuler', 'Ctrl+Z'], ['Rétablir', 'Ctrl+Maj+Z'], ['Couper / copier / coller', 'Ctrl+X / C / V'], ['Copier avec fusion', 'Ctrl+Maj+C'], ['Transformation manuelle', 'Ctrl+T'], ['Remplir…', 'Maj+F5 ou Maj+Retour arr.'], ['Effacer la sélection', 'Suppr']]),
      sec('Calques', [['Nouveau calque', 'Ctrl+Maj+N'], ['Calque par copier', 'Ctrl+J'], ['Calque par couper', 'Ctrl+Maj+J'], ['Fusionner vers le bas', 'Ctrl+E'], ['Fusionner les visibles', 'Ctrl+Maj+E'], ['Masque d\'écrêtage', 'Ctrl+Alt+G'], ['Monter / descendre', 'Ctrl+] / ['], ['Calque au-dessus / dessous', 'Alt+] / ['], ['Calque tout en haut / en bas', 'Alt+Maj+] / ['], ['Mode de fusion suivant / précédent', 'Maj + / Maj −'], ['Isoler un calque', 'Alt+clic sur l’œil'], ['Opacité du calque', '1…0 (outil sans opacité)'], ['Voir le masque seul', 'Alt+clic sur sa vignette'], ['Masque d’écrêtage', 'Alt+clic entre deux calques'], ['Sélection du contenu', 'Ctrl+clic vignette']]),
      sec('Sélection', [['Tout', 'Ctrl+A'], ['Désélectionner', 'Ctrl+D'], ['Resélectionner', 'Ctrl+Maj+D'], ['Intervertir', 'Ctrl+Maj+I'], ['Contour progressif', 'Maj+F6'], ['Ajouter / soustraire', 'Maj / Alt']]),
      sec('Image', [['Niveaux', 'Ctrl+L'], ['Courbes', 'Ctrl+M'], ['Teinte/Saturation', 'Ctrl+U'], ['Balance des couleurs', 'Ctrl+B'], ['Noir et blanc', 'Ctrl+Alt+Maj+B'], ['Négatif', 'Ctrl+I'], ['Désaturer', 'Ctrl+Maj+U'], ['Taille de l\'image', 'Ctrl+Alt+I'], ['Taille de la zone de travail', 'Ctrl+Alt+C'], ['Camera Raw', 'Ctrl+Maj+A'], ['Fluidité', 'Ctrl+Maj+X']]),
      sec('Affichage', [['Zoom avant / arrière', 'Ctrl+ + / −'], ['Taille écran', 'Ctrl+0'], ['100 %', 'Ctrl+1'], ['Règles', 'Ctrl+R'], ['Grille', 'Ctrl+\''], ['Repères', 'Ctrl+;'], ['Masquer les panneaux', 'Tab'], ['Masquer les panneaux de droite', 'Maj+Tab'], ['Modes d’écran', 'F'], ['Masquer les extras', 'Ctrl+H'], ['Taille écran / 100 %', 'double-clic sur Main / Zoom'], ['Plein écran', 'F11']]));
    KS.modal({ title: 'Raccourcis clavier', body, buttons: [{ label: 'Fermer', primary: true }] });
  };
  D.about = () => {
    const body = h('div', { style: { display: 'flex', gap: '18px', alignItems: 'center', width: '460px' } },
      h('span.brand-mark.xl'),
      h('div', h('div', { text: 'KaneApp', style: { fontSize: '22px', fontWeight: '600' } }), h('div.note', { text: 'Version ' + (KS.updates ? KS.updates.version : '1.0.0') + ' — création d’images, animation et montage.' }),
        h('div.note', { style: { marginTop: '8px' }, text: 'Lecture et écriture PSD par ag-psd (MIT). Police Outfit (OFL). Tout reste sur votre machine.' })));
    KS.modal({ title: 'À propos', body, buttons: [{ label: 'Fermer', primary: true }] });
  };
})();


// Studio IA : la page de Forge dans Kanevas. Mêmes onglets (txt2img, img2img, Extras, PNG Info, Train LoRA, ImgCut,
// Settings), mêmes réglages, mêmes noms et même ordre que l'interface de Forge (thème Modern UI de Kane OS).
// img2img, ses masques et ses croquis vivent entièrement dans le Studio. Les documents de l'Édition
// sont copiés à l'envoi ; les résultats ne retournent dans l'éditeur que sur demande explicite.
'use strict';
(() => {
  const U = KS.util, h = KS.h, ui = KS.ui, C = KS.cmd, G = KS.gen, N = KS.native;
  const D = () => KS.state.doc;
  const SD = KS.studio = { on: false, gallery: [] };
  const url = () => G.url();
  const pngBytes = async c => new Uint8Array(await (await U.blobFromCanvas(c)).arrayBuffer());
  const fromPng = u8 => U.canvasFromBlob(new Blob([u8], { type: 'image/png' }));
  const clone = o => JSON.parse(JSON.stringify(o));
  const norm = t => String(t || '').replace(/\s*\[[0-9a-f]{6,}\]$/i, '');
  const base = f => String(f || '').split(/[\\/]/).pop();
  const r8 = v => Math.max(64, Math.round(v / 8) * 8);
  const scaled = (c, w, hh) => { const o = U.canvas(w, hh), x = o.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, w, hh); return o; };
  const fillEl = (el, ...kids) => el.replaceChildren(...kids.filter(Boolean));

  /* ---------------------------------------------------------------- réglages (mêmes clés que l'API de Forge) */
  const COMMON = () => ({
    prompt: '', negative_prompt: '', styles: [], sampler_name: 'SEEDS 3', scheduler: 'Beta57', steps: 22, width: 1024, height: 1024, n_iter: 1, batch_size: 1,
    cfg_scale: 4, distilled_cfg_scale: 3, seed: -1, seedExtra: false, subseed: -1, subseed_strength: 0, seed_resize_from_w: 0, seed_resize_from_h: 0,
    kd: { enabled: false, skip: false, parts: ['vetements', 'poitrine', 'cheveux', 'mains', 'visage', 'yeux'], forces: {}, keep: 0.8, resolution: 1024, detail: 0, upscale: 1, showZones: true, tries: 2, repair: true, grain: 0.5, glow: true, age: true, autotag: true, soft: true, wd: true },
    noom: { unet: false, vae: false }, script: 'None', scriptArgs: {}, open: {},
  });
  const DEF = {
    v: 1, tab: 'txt2img', i2iMode: 'img2img', scale: 'anima', translate: true, saveImages: true, livePreview: true, previewMode: 'net', seeded: false, presetName: '', promptHistory: [],
    negOpen: false, infoOpen: false, drawer: null, loupe: true,
    lora: { q: '', sort: 'new' },
    painter: { size: 40, color: '#ff7a30', erase: false },
    editor: { target: 'selection', prompt: '', strength: 0.5, variants: 1, fillVersion: 1 },
    t2i: { ...COMMON(), width: 1920, height: 1024, enable_hr: false, hr_upscaler: 'Latent', hr_second_pass_steps: 32, denoising_strength: 0.6, hr_scale: 2, hr_resize_x: 0, hr_resize_y: 0,
      hr_distilled_cfg: 3, hr_cfg: 4, hr_checkpoint_name: 'Use same checkpoint', hr_additional_modules: ['Use same choices'], hr_sampler_name: 'Use same sampler', hr_scheduler: 'Use same scheduler',
      hr_prompt: '', hr_negative_prompt: '' },
    i2i: { ...COMMON(), steps: 32, resize_mode: 1, sizeTab: 'to', scale_by: 1, autoSize: true, denoising_strength: 0.6, mask_blur: 4, inpainting_mask_invert: 0, inpainting_fill: 1,
      inpaint_full_res: 1, inpaint_full_res_padding: 32,
      soft: { enabled: false, bias: 1, preserve: 0.5, contrast: 4, influence: 0, diffThr: 0.5, diffContrast: 2 },
      md: { enabled: false, method: 'Mixture of Diffusers', tw: 768, th: 768, overlap: 64, batch: 1 } },
    ex: { mode: 'by', resize: 4, w: 1024, h: 1024, crop: true, up1: 'None', up2: 'None', vis2: 0, batch: false },
  };
  const FREE = new Set(['scriptArgs', 'open', 'forces']);   // dictionnaires sans clés fixes
  const merge = (def, cur) => {
    const o = clone(def);
    if (!cur || typeof cur !== 'object') return o;
    for (const k in cur) {
      if (FREE.has(k)) o[k] = cur[k] && typeof cur[k] === 'object' ? cur[k] : {};
      else if (!(k in o)) continue;
      else if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) o[k] = merge(o[k], cur[k]);
      else o[k] = cur[k];
    }
    return o;
  };
  const FX = merge(DEF, KS.prefs.fx && KS.prefs.fx.v === 1 ? KS.prefs.fx : null);
  // Migration vers la force modérée du nouveau remplissage.
  if (!KS.prefs.fx?.editor?.fillVersion) FX.editor.strength = 0.5;
  FX.editor.strength = U.clamp(+FX.editor.strength || 0.5, 0.4, 0.6);
  for (const k of ['t2i', 'i2i']) { FX[k].seed = -1; FX[k].subseed = -1; }
  KS.prefs.fx = FX;
  const save = U.debounce(() => { KS.prefs.fx = FX; KS.prefs.save(); }, 400);
  const OUT = { t2i: { items: [], sel: 0 }, i2i: { items: [], sel: 0 }, ex: { items: [], sel: 0 }, png: null, exSrc: null, batch: [] };
  let i2iDoc = null; // Source explicite, indépendante du document actif dans l'Édition.
  const lastSeed = {};

  /* ---------------------------------------------------------------- catalogue de Forge */
  let cat = null, catErr = '', loading = false;
  const blobUrl = u8 => URL.createObjectURL(new Blob([u8], { type: 'image/jpeg' }));
  const decorate = r => {
    for (const l of r.loras) if (l.preview) l.url = blobUrl(l.preview);
    for (const m of r.models) if (m.preview) m.url = blobUrl(m.preview);
    return r;
  };
  // Dernier catalogue connu : la page est utilisable tout de suite, pendant que le moteur démarre (une dizaine de secondes)
  async function loadCached() {
    if (cat || !N || !N.forgeCatalogCache) return;
    try {
      const r = await N.forgeCatalogCache();
      if (!r || !r.ok || cat) return;
      cat = decorate(r); cat.stale = true;
      if (SD.on) render();
      renderEditorDraw();
    } catch { /* pas de cache */ }
  }
  async function loadCat() {
    if (!N || !N.forgeCatalog || loading) return cat;
    loading = true; renderTop();
    try {
      const r = await N.forgeCatalog(url());
      if (r.ok) {
        decorate(r);
        if (cat) for (const x of [...cat.loras, ...cat.models]) if (x.url) URL.revokeObjectURL(x.url);
        cat = r; catErr = '';
        if (!FX.seeded && r.defaults && r.defaults.t2i) {   // première fois : les valeurs par défaut de l'interface de Forge
          for (const k of ['t2i', 'i2i']) for (const [key, v] of Object.entries(r.defaults[k] || {})) {
            if (key === 'seed' || key === 'subseed') continue;
            if (v == null || v === '' || ((key === 'width' || key === 'height') && !+v)) continue;
            FX[k][key] = typeof DEF[k][key] === 'number' ? +v : v;
          }
          FX.seeded = true; save();
        }
      } else catErr = r.error;
    } catch (e) { catErr = e.message; }
    loading = false;
    if (SD.on) render();
    renderEditorDraw();
    return cat;
  }
  async function ensureCat() {
    if (!(await G.forge(true))) { KS.toast(G.forgeError(), 'err', 5000); return null; }
    return cat && !cat.stale ? cat : await loadCat();
  }
  // Charge le modèle en avance (première génération : 15 à 20 s de chargement des poids sinon)
  let warmed = false, warming = false;
  async function warm() {
    if (warmed || warming || !N || !N.forgeWarm || BUSY || PREPARING || KS.animationBusy || !KS.engine || !KS.engine.ready()) return;
    if (await KS.trainingRunning()) return;
    warming = true; renderTop();
    try { const r = await N.forgeWarm(url()); warmed = !!(r && r.ok); } catch { /* sera chargé à la première génération */ }
    warming = false; renderTop();
  }
  // modèle déchargé pour libérer la mémoire graphique : préchauffé de nouveau à la prochaine ouverture du Studio
  N?.onVramReleased?.(() => { warmed = false; });

  /* ---------------------------------------------------------------- petits composants façon Forge */
  const field = (label, ctl, tip) => h('div.fx-field', { title: tip || '' }, label ? h('label.fx-lbl', { text: label }) : null, ctl);
  const row2 = (...a) => h('div.fx-row2', ...a);
  const row3 = (...a) => h('div.fx-row3', ...a);
  const ebtn = (emoji, tip, fn, cls = '') => { const b = h('button.fx-ebtn' + cls, { text: emoji, title: tip }); b.addEventListener('click', fn); return b; };
  const tbtn = (label, fn, cls = '', tip = '') => { const b = h('button.fx-btn2' + cls, { text: label, title: tip }); b.addEventListener('click', fn); return b; };
  // bouton à icône (Studio 2) : le libellé est dans l'info-bulle et pour les lecteurs d'écran
  const ibtn = (icon, tip, fn, cls = '') => { const b = h('button.fx-ibtn' + cls, { title: tip, 'aria-label': tip, type: 'button' }); b.innerHTML = KS.icon(icon); b.addEventListener('click', fn); return b; };
  // section du volet de réglages : un titre discret, pas de cadre
  const sect = (title, ...kids) => h('section.fx-sect', h('div.fx-sect-h', { text: title }), ...kids.flat().filter(Boolean));
  function slider(label, obj, key, min, max, step, tip, onChange) {
    const num = h('input.fx-num', { type: 'number', min, max, step, value: obj[key] });
    const rng = h('input.fx-rng', { type: 'range', min, max, step, value: obj[key] });
    const fill = () => rng.style.setProperty('--p', ((U.clamp(+obj[key], min, max) - min) / (max - min) * 100) + '%');
    const set = (v, from) => {
      v = +v; if (isNaN(v)) { num.value = obj[key]; return; }
      obj[key] = v; if (from !== num) num.value = v; if (from !== rng) rng.value = v;
      fill(); save(); onChange && onChange(v);
    };
    num.addEventListener('change', () => set(num.value, num));
    rng.addEventListener('input', () => set(rng.value, rng));
    fill();
    const el = h('div.fx-field.fx-slider', { title: tip || '' }, h('div.fx-sh', h('label.fx-lbl', { text: label }), num), rng);
    el.set = v => set(v);
    return el;
  }
  function select(label, options, obj, key, tip, onChange) {
    const s = h('select.fx-sel');
    for (const o of options) { const [v, l] = Array.isArray(o) ? o : [o, o]; s.appendChild(h('option', { value: v, text: l })); }
    const cur = obj[key] == null ? '' : String(obj[key]);
    if (cur && ![...s.options].some(o => o.value === cur)) s.appendChild(h('option', { value: cur, text: cur }));
    s.value = cur;
    s.addEventListener('change', () => { obj[key] = s.value; save(); onChange && onChange(s.value); });
    return label ? field(label, s, tip) : s;
  }
  function radio(label, options, obj, key, tip, onChange) {
    const box = h('div.fx-radio');
    for (const [v, l] of options) {
      const b = h('label.fx-ropt' + (obj[key] === v ? '.on' : ''), h('input', { type: 'radio', checked: obj[key] === v, tabIndex: -1 }), h('span', { text: l }));
      b.addEventListener('click', e => {
        e.preventDefault(); obj[key] = v; save();
        box.querySelectorAll('.fx-ropt').forEach(x => { x.classList.toggle('on', x === b); x.querySelector('input').checked = x === b; });
        onChange && onChange(v);
      });
      box.appendChild(b);
    }
    return field(label, box, tip);
  }
  function check(label, obj, key, tip, onChange) {
    const i = h('input', { type: 'checkbox', checked: !!obj[key] });
    i.addEventListener('change', () => { obj[key] = i.checked; save(); onChange && onChange(i.checked); });
    return h('label.fx-check', { title: tip || '' }, i, h('span', { text: label }));
  }
  function text(label, obj, key, { rows = 2, placeholder = '', tip, onInput } = {}) {
    const t = h(rows > 1 ? 'textarea.fx-ta.fx-small' : 'input.fx-in', { rows, placeholder, spellcheck: false });
    t.value = obj[key] == null ? '' : obj[key];
    t.addEventListener('input', () => { obj[key] = t.value; save(); onInput && onInput(t.value); });
    return label ? field(label, t, tip) : t;
  }
  function tabs(list, cur, onChange, cls = '') {
    const bar = h('div.fx-tabs' + cls);
    for (const [v, l] of list) { const b = h('button' + (v === cur ? '.on' : ''), { text: l }); b.addEventListener('click', () => onChange(v)); bar.appendChild(b); }
    return bar;
  }
  // Accordéon de Forge (InputAccordion : case à cocher dans l'en-tête quand `on` est donné)
  function acc(title, st, key, body, { on, tip, active } = {}) {
    const open = !!st.open[key];
    const head = h('div.fx-acc-h', { title: tip || '' });
    const el = h('div.fx-acc' + (open ? '.open' : '') + ((on ? on[0][on[1]] : active) ? '.active' : ''), head);
    if (on) {
      const i = h('input', { type: 'checkbox', checked: !!on[0][on[1]] });
      i.addEventListener('click', e => e.stopPropagation());
      i.addEventListener('change', () => { on[0][on[1]] = i.checked; save(); el.classList.toggle('active', i.checked); });
      head.append(i);
    }
    head.append(h('span.fx-acc-t', { text: title }), h('span.fx-acc-a', { html: KS.icon(open ? 'chevron-down' : 'chevron-right') }));
    head.addEventListener('click', () => { st.open[key] = !open; save(); renderParams(); });
    if (open) el.appendChild(h('div.fx-acc-b', ...[].concat(typeof body === 'function' ? body() : body)));
    return el;
  }
  const md = t => String(t || '').replace(/&(?![a-z]+;|#\d+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>');
  const tokens = t => (String(t || '').replace(/<[^>]+>/g, ' ').match(/[A-Za-zÀ-ÿ]+|\d|[^\sA-Za-zÀ-ÿ\d]/g) || []).length;
  KS.fxui = { field, row2, row3, ebtn, tbtn, slider, select, radio, check, text, tabs, md };

  /* ---------------------------------------------------------------- formats (puces FORMAT du thème Modern UI) */
  const SCALES = {
    anima: { label: 'ANIMA', title: 'Grand côté plafonné à 1536, la plus grande résolution d\'entraînement d\'ANIMA (environ 1,3 MP)', presets: [
      ['1:1', 1152, 1152, 'Carré'], ['4:5', 1024, 1280, 'Portrait Instagram'], ['5:4', 1280, 1024, 'Paysage 5:4'], ['3:4', 1008, 1344, 'Portrait 3:4'], ['4:3', 1344, 1008, 'Paysage 4:3'],
      ['2:3', 928, 1392, 'Portrait 2:3 / impression'], ['3:2', 1392, 928, 'Paysage 3:2 / photo'], ['9:16', 864, 1536, 'Story / Reels / TikTok'], ['16:9', 1536, 864, 'Écran large / YouTube'], ['21:9', 1456, 624, 'Ultra large'],
    ] },
    hires: { label: '1024', title: 'Ancienne règle : petit côté = 1024. Plus grand et plus lent', presets: [
      ['1:1', 1024, 1024, 'Carré'], ['4:5', 1024, 1280, 'Portrait Instagram'], ['5:4', 1280, 1024, 'Paysage 5:4'], ['3:4', 1024, 1344, 'Portrait 3:4'], ['4:3', 1344, 1024, 'Paysage 4:3'],
      ['2:3', 1024, 1536, 'Portrait 2:3'], ['3:2', 1536, 1024, 'Paysage 3:2'], ['9:16', 1024, 1856, 'Story'], ['16:9', 1856, 1024, 'Écran large'], ['21:9', 2048, 896, 'Ultra large'],
    ] },
  };
  function formatRow(st) {
    const sc = SCALES[FX.scale] ? FX.scale : 'anima';
    const row = h('div.fx-fmt');
    for (const [id, S] of Object.entries(SCALES)) {
      const b = h('button.fx-chip.fx-scale' + (sc === id ? '.on' : ''), { text: S.label, title: S.title });
      b.addEventListener('click', () => { FX.scale = id; save(); renderParams(); }); row.appendChild(b);
    }
    for (const [lab, w, hh, name] of SCALES[sc].presets) {
      const b = h('button.fx-chip' + (st.width === w && st.height === hh ? '.on' : ''), { text: lab, title: `${name} : ${w} × ${hh} (${(w * hh / 1e6).toFixed(2)} MP)` });
      b.addEventListener('click', () => { st.width = w; st.height = hh; if ('autoSize' in st) { st.autoSize = false; st.sizeTab = 'to'; } save(); renderParams(); });
      row.appendChild(b);
    }
    return row;
  }

  /* ---------------------------------------------------------------- surfaces du Studio (txt2img et img2img) */
  // Chaque surface a son invite, son bouton Generate et sa colonne de réglages
  const CTX = { t2i: { k: 't2i' }, i2i: { k: 'i2i' } };
  const EDIT = { k: 't2i', action: () => C.editorDraw() };
  const els = {};
  let root = null;
  const RAIL = [['txt2img', 'Créer', 'file-plus'], ['img2img', 'Transformer', 'image'], ['angle', 'Angle', 'angle'], ['extras', 'Agrandir', 'upscale'], ['pnginfo', 'Paramètres PNG', 'info'],
    ['imgcut', 'Découper', 'crop'], ['settings', 'Réglages', 'settings']];
  function mountPage() {
    root = KS.$('#studio');
    root.className = 'fx';
    const rail = h('nav.fx-rail'), top = h('div.fx-top'), body = h('div.fx-body');
    root.replaceChildren(rail, h('div.fx-page', top, body));
    Object.assign(els, { rail, top, body });
    if (!root._keys) {
      root._keys = true;
      root.addEventListener('keydown', e => {
        if (e.target.matches && e.target.matches('input, textarea, select')) { e.stopPropagation(); return; }
        if (FX.tab === 'txt2img' && !e.ctrlKey && !e.altKey && !e.metaKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && !e.target.closest('.iv-cmp, .fx-drawer')) {
          e.preventDefault(); e.stopPropagation(); stepFilm(e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1); return;
        }
        if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'l' && (FX.tab === 'txt2img' || FX.tab === 'img2img')) {
          e.preventDefault(); FX.loupe = FX.loupe === false; save(); KS.toast(FX.loupe ? 'Loupe au survol activée' : 'Loupe au survol désactivée', 'info', 1400); renderOut(FX.tab === 'img2img' ? 'i2i' : 't2i'); return;
        }
        if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
          e.preventDefault(); e.stopPropagation();
          if (FX.tab !== 'img2img' || !i2iDoc) return;
          CTX.i2i.finishStroke && CTX.i2i.finishStroke();
          if (e.key.toLowerCase() === 'y' || e.shiftKey) i2iDoc.history.redo(); else i2iDoc.history.undo();
          if (CTX.i2i.paintDraw) CTX.i2i.paintDraw(); else render();
        }
      });
    }
  }
  function renderRail() {
    els.rail.replaceChildren();
    for (const [id, label, icon] of RAIL) {
      const b = h('button' + (FX.tab === id ? '.on' : ''), { title: label + ' · ' + id + (id === 'train' ? ' — clic droit : arrêter / relancer l\'entraînement' : '') }, h('span', { html: KS.icon(icon) }), h('span', { text: label }));
      b.addEventListener('click', () => {
        if (id === 'imgcut') {
          const it = FX.tab === 'img2img' ? selItem('i2i') || (i2iDoc && { canvas: sourceFor(i2iDoc, true), name: i2iDoc.name }) : FX.tab === 'extras' ? selItem('ex') || OUT.exSrc : FX.tab === 'pnginfo' ? OUT.png : selItem('t2i');
          return C.socialCut(it ? { canvas: it.canvas, name: it.name || docName(it) } : undefined);
        }
        FX.tab = id; save(); render();
      });
      if (id === 'train') b.addEventListener('contextmenu', e => { e.preventDefault(); if (KS.trainTab && KS.trainTab.contextMenu) KS.trainTab.contextMenu(e.clientX, e.clientY); });
      els.rail.appendChild(b);
    }
    els.rail.appendChild(h('div.spacer'));
    const back = h('button', { title: 'Revenir au document dans Retouche (F6)' }, h('span', { html: KS.icon('brush') }), h('span', { text: 'Retouche' }));
    back.addEventListener('click', () => C.toggleStudio(false));
    els.rail.appendChild(back);
  }
  const DTYPES = ['Automatic', 'Automatic (fp16 LoRA)', 'float8-e4m3fn', 'float8-e4m3fn (fp16 LoRA)', 'float8-e5m2', 'float8-e5m2 (fp16 LoRA)'];
  async function setOptions(o, msg) {
    if (!KS.engine || !KS.engine.ready()) return KS.toast('Le moteur IA démarre : réessayez dans quelques secondes', 'info', 3000);
    const r = await N.forgeSetOptions(url(), o);
    if (!r.ok) return KS.toast('Forge : ' + r.error, 'err', 6000);
    if (cat) {
      if (o.sd_model_checkpoint) cat.current.model = o.sd_model_checkpoint;
      if (o.forge_additional_modules) cat.current.modules = o.forge_additional_modules;
      if (o.forge_unet_storage_dtype) cat.dtype = o.forge_unet_storage_dtype;
    }
    if (msg) KS.toast(msg, 'ok', 2600);
    warmed = false; setTimeout(warm, 400);
    renderTop(); renderParams();
  }
  // Liste à puces (VAE / Text Encoder) : comme le multi-sélecteur de Forge
  function modulesPicker(values, onChange, { same = false } = {}) {
    const box = h('div.fx-modchips');
    const names = (cat ? cat.modules : []).map(m => [m.path, m.name]);
    for (const v of values) {
      const chip = h('span.fx-mchip', h('span', { text: base(v) }));
      const x = h('button', { text: '×', title: 'Retirer' }); x.addEventListener('click', () => onChange(values.filter(q => q !== v)));
      chip.appendChild(x); box.appendChild(chip);
    }
    const add = h('select.fx-modadd', { title: 'Ajouter' }, h('option', { value: '', text: '＋' }),
      ...(same ? [h('option', { value: 'Use same choices', text: 'Use same choices' })] : []),
      ...names.filter(([p, n]) => !values.includes(p) && !values.includes(n)).map(([p, n]) => h('option', { value: same ? n : p, text: n })));
    add.addEventListener('change', () => { if (!add.value) return; onChange(add.value === 'Use same choices' ? ['Use same choices'] : [...values.filter(q => q !== 'Use same choices'), add.value]); });
    box.appendChild(add);
    return box;
  }
  function engineBadge() {
    const E = KS.engine, st = E ? E.state : 'off';
    return h('div.fx-eng', h('span.fx-dot' + (E && E.ready() ? '.ok' : st === 'starting' ? '.busy' : '')),
      h('span', { text: !E ? 'Moteur indisponible' : E.ready() ? (warming ? 'Chargement du modèle…' : E.state === 'external' ? 'Forge de Kane OS' : 'Moteur IA prêt') : st === 'starting' ? 'Démarrage du moteur…' : st === 'error' ? 'Moteur : erreur' : 'Moteur IA arrêté' }),
      E && !E.ready() && st !== 'starting' ? tbtn('Démarrer', () => E.ensure().then(ok => ok && loadCat()), '.primary.sm') : null);
  }
  let topPop = false;
  document.addEventListener('pointerdown', e => {
    if (topPop && !e.target.closest('.fx-toppop, .fx-topbtn, .menu')) { topPop = false; renderTop(); }
  }, true);
  function renderTop() {
    const t = els.top; if (!t || !SD.on) return;
    const ck = h('select.fx-sel.fx-ck-sel', { title: 'Checkpoint : le modèle de génération' });
    if (cat) {
      for (const m of cat.models) ck.appendChild(h('option', { value: m.title, text: norm(m.title) }));
      const cur = cat.models.find(m => norm(m.title) === norm(cat.current.model));
      ck.value = cur ? cur.title : '';
      ck.addEventListener('change', () => setOptions({ sd_model_checkpoint: ck.value }, 'Checkpoint : ' + norm(ck.value) + ' (chargé à la prochaine génération)'));
    } else ck.appendChild(h('option', { text: loading ? 'Lecture de Forge…' : 'Moteur IA arrêté' }));
    ck.disabled = !cat;
    const ref = ibtn('rotate-cw', 'Relire les modèles, modules et LoRA de Forge', async () => { if (!cat) return loadCat(); await N.forgeRefreshCheckpoints(url()); await N.forgeRefreshLoras(url()); loadCat(); });
    // VAE / Text Encoder et précision : rarement changés, repliés dans un petit volet
    const mods = cat ? cat.current.modules || [] : [];
    const more = h('button.fx-topbtn' + (topPop ? '.on' : ''), { type: 'button', title: 'VAE / Text Encoder et Diffusion in Low Bits', 'aria-expanded': String(topPop) },
      h('span.fx-topbtn-t', { text: mods.length ? mods.map(base).join(' · ') : 'VAE / encodeur' }), h('span.fx-topbtn-a', { html: KS.icon('chevron-down') }));
    more.disabled = !cat;
    more.addEventListener('click', () => { topPop = !topPop; renderTop(); });
    let pop = null;
    if (topPop && cat) {
      const dt = h('select.fx-sel', ...DTYPES.map(d => h('option', { value: d, text: d })));
      dt.value = cat.dtype || 'Automatic';
      dt.addEventListener('change', () => setOptions({ forge_unet_storage_dtype: dt.value }, 'Diffusion in Low Bits : ' + dt.value + ' (au prochain chargement du modèle)'));
      pop = h('div.fx-toppop', field('VAE / Text Encoder', modulesPicker(mods, v => setOptions({ forge_additional_modules: v }, 'VAE / Text Encoder changés'))),
        field('Diffusion in Low Bits', dt, 'Précision des poids du modèle en mémoire'));
    }
    fillEl(t, h('div.fx-model', h('span.fx-model-i', { html: KS.icon('sparkles') }), ck), more, ref, pop, h('div.spacer'), engineBadge());
    renderPills(CTX.t2i); renderPills(CTX.i2i);
  }

  /* ---------------------------------------------------------------- rendu de la page */
  function render() {
    if (!SD.on || !root) return;
    CTX.i2i.finishStroke && CTX.i2i.finishStroke();
    CTX.i2i.finishStroke = null; CTX.i2i.paintDraw = null;
    renderRail(); renderTop();
    for (const c of Object.values(CTX)) { c.left = null; c.genbox = null; c.promptTa = null; c.modes = null; }
    els.out = null; els.i2iOut = null; els.exGen = null; els.exOut = null;
    let content;
    switch (FX.tab) {
      case 'img2img': content = i2iTab(); break;
      case 'extras': content = extrasTab(); break;
      case 'pnginfo': content = pngTab(); break;
      case 'settings': content = settingsTab(); break;
      case 'angle': content = h('div.ag-page'); break;
      default: FX.tab = 'txt2img'; content = t2iTab();
    }
    els.body.replaceChildren(content);
    els.body.classList.toggle('fx-fit', FX.tab === 'txt2img' || FX.tab === 'img2img');
    document.body.classList.toggle('fx-angle', FX.tab === 'angle');
    if (FX.tab === 'angle') KS.angleTab ? KS.angleTab.render(content) : content.append(h('div.fx-note', { text: 'Angle indisponible.' }));
  }
  function t2iTab() {
    const c = CTX.t2i;
    c.left = h('div.fx-left'); els.out = h('div.fx-out.fx-stage'); els.film = h('div.fx-film');
    const wrap = h('div.fx-gen.fx-v3', h('div.fx-center', els.out, dock(promptRow(c))), els.film, drawer(c));
    renderParams(); renderOut();
    return wrap;
  }
  // Barre d'invite : sa place est celle de l'invite repliée ; pendant la saisie elle s'agrandit vers le haut, par-dessus l'image
  function dock(composer) {
    const d = h('div.fx-dock', composer);
    const sync = () => { if (!composer.querySelector('textarea:focus') && composer.offsetHeight) d.style.height = (composer.offsetHeight + 26) + 'px'; };
    new ResizeObserver(() => requestAnimationFrame(sync)).observe(composer);
    composer.addEventListener('focusout', () => setTimeout(sync, 0));
    return d;
  }
  // Tiroir des réglages complets : à droite, fermable (pastille « Réglages »), l'état est retenu
  function drawer(c) {
    if (FX.drawer == null) { FX.drawer = innerWidth >= 1650; save(); }
    const d = h('aside.fx-drawer', { hidden: FX.drawer === false, 'aria-label': 'Réglages du Studio' }, c.left);
    els.drawer = d; return d;
  }
  function toggleDrawer(open = FX.drawer === false) {
    FX.drawer = !!open; save();
    if (els.drawer) els.drawer.hidden = !open;
    for (const c of [CTX.t2i, CTX.i2i]) renderPills(c);
  }
  function i2iTab() {
    const c = CTX.i2i;
    c.left = h('div.fx-left'); c.modes = h('div.fx-i2ihead'); els.i2iOut = h('div.fx-out.fx-stage');
    const source = h('div.fx-panel.fx-source');
    const d = i2iDoc;
    const paintable = d && FX.i2iMode !== 'img2img' && FX.i2iMode !== 'batch';
    const preview = d && !paintable && sourceFor(d, false);
    if (preview) { preview.setAttribute('role', 'img'); preview.setAttribute('aria-label', d.name); }
    const zone = h('div.fx-dropzone', { role: 'button', tabIndex: 0, 'aria-label': 'Choisir l’image source Img2Img' },
      paintable ? painterCanvas(d) : d ? preview : h('div', { text: 'Déposez une image ou cliquez pour l’importer' }));   // canevas affiché tel quel : pas d'encodage PNG à chaque rendu
    if (d) KS.preview.mount(zone, zone.firstElementChild, { identity: d, width: d.width, height: d.height, paint: paintable });
    const pick = async () => {
      if (N && N.openDialog) {
        const files = await N.openDialog({ title: 'Image source Img2Img', multi: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }] });
        if (files && files[0]) await loadI2I(files[0]);
      } else {
        const input = h('input', { type: 'file', accept: 'image/*' });
        input.addEventListener('change', async () => { const f = input.files[0]; if (f) await loadI2I({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }); });
        input.click();
      }
    };
    if (!paintable && !d) {
      zone.addEventListener('click', pick);
      zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    } else { if (paintable) zone.classList.add('fx-paintzone'); zone.removeAttribute('role'); zone.removeAttribute('tabindex'); }
    dropTo(zone, loadI2I);
    source.append(c.modes, zone,
      h('div.fx-srcfoot', h('div.fx-docinfo', { text: d ? `${d.width} × ${d.height}` : 'Choisissez une image ou reprenez le document de Retouche.', title: d ? d.name : '' }),
        h('div.fx-outbtns', tbtn('Importer…', pick, '.sm', 'Importer une image source'), tbtn('Depuis Retouche', () => C.sendToStudio(FX.i2iMode === 'inpaint' ? 'inpaint' : 'img2img'), '.sm', 'Prendre le document ouvert dans Retouche'),
          d ? ibtn('brush', 'Ouvrir la source dans Retouche', () => toEdition({ canvas: sourceFor(d, true), name: d.name, info: d.genInfo, params: d.genParams })) : null,
          d ? ibtn('close', 'Retirer la source', () => { i2iDoc = null; render(); }) : null)));
    const wrap = h('div.fx-gen.fx-v3.fx-img2img', h('div.fx-center', h('div.fx-i2i-stage', source, els.i2iOut), dock(promptRow(c))), drawer(c));
    renderModeTools(); renderCtx(c); renderOut('i2i');
    return wrap;
  }
  async function loadI2I(entry) {
    try {
      const canvas = await KS.io.canvasFromEntry(entry), chunks = await KS.png.readText(new Uint8Array(entry.data));
      i2iDoc = itemDoc({ canvas, info: chunks.parameters || '', name: entry.name });
      if (chunks.parameters) paramsTo('i2i', { info: chunks.parameters });
      FX.i2i.autoSize = true; save(); render();
    } catch (e) { KS.toast('Import impossible : ' + e.message, 'err', 5000); }
  }
  function painterCanvas(d) {
    const role = ['sketch', 'inpaint_sketch'].includes(FX.i2iMode) ? 'sketch' : 'zone';
    const k = Math.min(1, 4096 / Math.max(d.width, d.height));
    const canvas = h('canvas.fx-painter', { width: Math.max(1, Math.round(d.width * k)), height: Math.max(1, Math.round(d.height * k)), tabIndex: 0,
      'aria-label': role === 'zone' ? 'Peindre le masque dans le Studio IA' : 'Dessiner le croquis dans le Studio IA' });
    const background = sourceFor(d, false), x = canvas.getContext('2d');
    const draw = () => {
      x.setTransform(canvas.width / d.width, 0, 0, canvas.height / d.height, 0, 0);
      x.clearRect(0, 0, d.width, d.height); x.drawImage(background, 0, 0);
      const sketch = roleLayer(d, 'sketch'), zone = roleLayer(d, 'zone');
      if (sketch && sketch.visible && role === 'sketch') x.drawImage(sketch.canvas, sketch.x, sketch.y);
      if (zone && zone.visible && role === 'zone') { x.globalAlpha = 0.4; x.drawImage(zone.canvas, zone.x, zone.y); x.globalAlpha = 1; }
    };
    let stroke = null;
    const point = e => { const r = canvas.getBoundingClientRect(); return { x: U.clamp((e.clientX - r.left) * d.width / r.width, 0, d.width), y: U.clamp((e.clientY - r.top) * d.height / r.height, 0, d.height) }; };
    const dab = p => {
      const { layer: L, last, size, color, erase } = stroke, ctx = L.ctx;
      ctx.save(); ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
      ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = size; ctx.lineCap = ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(last.x - L.x, last.y - L.y); ctx.lineTo(p.x - L.x, p.y - L.y); ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x - L.x, p.y - L.y, size / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      stroke.last = p; L.touch(); d.changed(); draw();
    };
    const finish = e => {
      if (!stroke || (e && e.pointerId !== stroke.id)) return;
      const s = stroke; stroke = null;
      KS.Hist.commitPixels(d, role === 'zone' ? 'Peindre le masque IA' : 'Peindre le croquis IA', s.token, null, s.erase ? 'eraser' : 'brush');
      draw();
    };
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0 || stroke) return;
      e.preventDefault(); e.stopPropagation(); canvas.focus();
      const L = ensureRoleLayer(d, role); L.ensureCovers(d.rect);
      stroke = { id: e.pointerId, layer: L, token: KS.Hist.begin(L), last: point(e), size: U.clamp(+FX.painter.size || 40, 1, 512),
        color: role === 'zone' ? '#ff2040' : FX.painter.color, erase: FX.painter.erase };
      try { canvas.setPointerCapture(e.pointerId); } catch { /* événements de test sans pointeur système */ }
      dab(point(e));
    });
    canvas.addEventListener('pointermove', e => { if (stroke && e.pointerId === stroke.id) { e.preventDefault(); dab(point(e)); } });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(ev, finish);
    canvas.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
        e.preventDefault(); e.stopPropagation(); finish();
        if (e.key.toLowerCase() === 'y' || e.shiftKey) d.history.redo(); else d.history.undo();
        draw();
      }
    });
    CTX.i2i.paintDraw = draw; CTX.i2i.finishStroke = finish;
    draw(); return canvas;
  }

  /* ---------------------------------------------------------------- invite, LoRA actifs, Generate */
  function promptRow(c, { compact = false } = {}) {
    const st = FX[c.k];
    const area = (key, label, rows) => {
      const ta = h('textarea.fx-ta.fx-prompt', { placeholder: compact ? label + '\nCtrl+Entrée : générer / interrompre · Alt+Entrée : passer une image' : label, spellcheck: false, rows });
      ta.value = st[key] || '';
      const cnt = h('span.fx-tok');
      const upd = () => { const n = tokens(ta.value); cnt.textContent = n + '/' + Math.max(75, Math.ceil(n / 75) * 75); };
      ta.addEventListener('input', () => {
        st[key] = ta.value; upd(); save();
        if (key === 'prompt') { trNote(c); markLoras(c); renderChips(c); }
        for (const peer of [CTX.t2i, EDIT]) if (peer !== c && peer.k === c.k && peer.syncPrompt) peer.syncPrompt();
        if (c.find) c.find.refresh();
        renderGenButtons();
      });
      ta.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
          e.preventDefault(); e.stopPropagation();
          const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
          if (c.find.open && !sel) c.find.hide(); else c.find.show(sel.length < 80 && !sel.includes('\n') ? sel : '');
        } else if (e.key === 'Enter' && e.altKey) { e.preventDefault(); skip(); }
        else if (e.key === 'Escape') interrupt();
        else if (e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); editWeight(ta, e.key === 'ArrowUp' ? 1 : -1); }
      });
      upd();
      return { box: h('div.fx-pbox', cnt, ta), ta };
    };
    const P = area('prompt', compact ? 'Décrivez l’image souhaitée' : 'Décrivez l’image souhaitée… (Ctrl+Entrée : générer · Échap : interrompre)', 3), Q = area('negative_prompt', 'Éléments à éviter (invite négative)', 2);
    c.promptTa = P.ta; c.negTa = Q.ta;
    c.syncPrompt = () => {
      P.ta.value = st.prompt; Q.ta.value = st.negative_prompt;
      for (const ta of [P.ta, Q.ta]) { const n = tokens(ta.value); ta.parentElement.querySelector('.fx-tok').textContent = n + '/' + Math.max(75, Math.ceil(n / 75) * 75); }
      trNote(c); renderChips(c); markLoras(c);
      if (c.find) c.find.refresh();
    };
    c.trNote = h('div.fx-trnote'); c.chips = h('div.fx-lchips'); c.genbox = h('div.fx-genbox');
    c.find = findBar(c);
    renderGenButtons(); trNote(c); renderChips(c);
    c.findBtn = ibtn('search', 'Chercher et remplacer dans l\'invite (Ctrl+F dans l\'invite)', () => c.find.toggle());
    const clearPrompts = () => { for (const t of [P.ta, Q.ta]) { t.value = ''; t.dispatchEvent(new Event('input')); } };
    const readP = () => { readParams(c.k); if (c === EDIT) renderEditorDraw(); };
    if (!compact) {
      // Studio : historique, chercher et nettoyer restent visibles ; lire les paramètres, styles et effacer passent dans « Plus »
      const more = ibtn('more', 'Plus d’outils pour l’invite', e => {
        const r = e.currentTarget.getBoundingClientRect();
        ui.menu([
          { label: 'Lire les paramètres collés (ou ceux de la dernière image)', icon: 'import', action: readP },
          (cat && cat.styles && cat.styles.length) || FX[c.k].styles.length ? { label: 'Appliquer les styles choisis à l’invite', icon: 'palette', action: () => applyStyles(c) } : null,
          { sep: true },
          { label: 'Effacer l’invite et l’invite négative', icon: 'trash', action: clearPrompts },
        ].filter(Boolean), r.right - 300, r.top - 8 - 4 * 34);
      });
      var studioTools = h('div.fx-ptools',
        ibtn('history', 'Historique des invites : reprendre une invite déjà utilisée, avec recherche', () => historyDialog(c)),
        c.findBtn,
        ibtn('eraser-magic', 'Nettoyer l\'invite : doublons, virgules et espaces en trop (Ctrl+Z pour annuler)', () => cleanPrompts(c)),
        more);
    }
    const tools = h('div.fx-ptools',
      ibtn('import', 'Lire les paramètres collés dans l\'invite (texte d\'une image de Forge), ou ceux de la dernière génération si l\'invite est vide', () => { readParams(c.k); if (c === EDIT) renderEditorDraw(); }),
      ibtn('history', 'Historique des invites : reprendre une invite déjà utilisée, avec recherche', () => historyDialog(c)),
      c.findBtn,
      ibtn('eraser-magic', 'Nettoyer l\'invite : doublons, virgules et espaces en trop (Ctrl+Z pour annuler)', () => cleanPrompts(c)),
      ibtn('palette', 'Appliquer les styles choisis à l\'invite', () => applyStyles(c)),
      ibtn('trash', 'Effacer l\'invite et l\'invite négative', () => { for (const t of [P.ta, Q.ta]) { t.value = ''; t.dispatchEvent(new Event('input')); } }));
    if (compact) return h('div.fx-toprow.fx-compact', c.find.bar, P.box, c.chips,
      c === EDIT ? h('details.edraw-details', h('summary', { text: 'Éléments à éviter' }), Q.box) : Q.box,
      c.trNote, c.genbox, h('div.fx-ptools-row', tools, stylesPicker(c.k)));
    // Studio : invite en bas, pastilles de réglages rapides (modèle, format, lot, LoRA, Kane Detailer, Hires…)
    const neg = h('div.fx-neg', Q.box);
    c.negSync = () => { neg.hidden = !FX.negOpen; };
    c.negSync();
    let words = -1;
    Q.ta.addEventListener('input', () => { const n = (st.negative_prompt.match(/[^\s,]+/g) || []).length; if (n !== words) { words = n; renderPills(c); } });
    c.pills = h('div.fx-pills');
    renderPills(c);
    const foot = h('div.fx-cfoot', c.pills, studioTools);
    return h('div.fx-toprow.fx-composer', h('div.fx-prompts', c.find.bar, P.box, neg, c.trNote, foot), h('div.fx-genside', c.genbox));
  }
  /* ---------------------------------------------------------------- pastilles et petites fenêtres au-dessus de l'invite */
  let POP = null;
  const closePop = () => { if (!POP) return; POP.el.remove(); POP.anchor.classList.remove('open'); POP = null; };
  // Petite fenêtre ancrée au-dessus d'une pastille ; recliquer la pastille la referme. `build` est rejoué par refreshPop.
  function popover(anchor, title, build) {
    const same = POP && POP.id === anchor.dataset.id; closePop(); if (same) return;
    const el = h('div.fx.fx-pop', { role: 'dialog', 'aria-label': title });
    POP = { el, anchor, id: anchor.dataset.id, title, build }; anchor.classList.add('open');
    document.body.append(el); refreshPop();
  }
  function refreshPop() {
    if (!POP) return;
    if (!POP.anchor.isConnected) return closePop();
    fillEl(POP.el, h('div.fx-pop-h', { text: POP.title }), ...[].concat(POP.build()).filter(Boolean));
    const r = POP.anchor.getBoundingClientRect(), w = POP.el.offsetWidth;
    POP.el.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    POP.el.style.bottom = Math.max(8, innerHeight - r.top + 8) + 'px';
  }
  document.addEventListener('pointerdown', e => { if (POP && !POP.el.contains(e.target) && !POP.anchor.contains(e.target) && !e.target.closest('.menu')) closePop(); }, true);
  document.addEventListener('keydown', e => { if (POP && e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closePop(); } }, true);
  const num = v => String(Math.round(+v * 100) / 100).replace('.', ',');
  function fmtLabel(st) {
    const sc = SCALES[FX.scale] ? FX.scale : 'anima', p = SCALES[sc].presets.find(x => x[1] === +st.width && x[2] === +st.height);
    return (p ? p[0] + ' · ' : '') + st.width + ' × ' + st.height;
  }
  function pill(id, label, { icon, on, title, dot, onClick } = {}) {
    const b = h('button.fx-pill' + (on ? '.on' : ''), { type: 'button', title: title || '', 'data-id': id });
    if (dot) b.append(h('span.fx-pdot.' + dot));
    if (icon) b.insertAdjacentHTML('beforeend', KS.icon(icon));
    b.append(h('span', { text: label }));
    b.addEventListener('click', () => onClick(b));
    return b;
  }
  function renderPills(c) {
    if (!c.pills) return;
    const st = FX[c.k], E = KS.engine;
    const nL = (st.prompt.match(/<lora:/g) || []).length, words = (st.negative_prompt.match(/[^\s,]+/g) || []).length;
    const model = cat ? (norm(cat.current.model || '') || 'Modèle').replace(/\.safetensors$/i, '') : loading ? 'Lecture de Forge…' : 'Moteur IA arrêté';
    const dot = E && E.ready() ? 'ok' : E && E.state === 'starting' ? 'busy' : 'off';
    const keep = POP && c.pills.contains(POP.anchor) ? POP.id : null;
    fillEl(c.pills,
      pill('model', model, { dot, title: 'Modèle, VAE / encodeur, précision et état du moteur', onClick: b => popover(b, 'Modèle', () => modelPop()) }),
      pill('format', fmtLabel(st), { icon: 'crop', title: 'Format et taille de l’image', onClick: b => popover(b, 'Format', () => formatPop(c)) }),
      c.k === 'i2i' ? pill('force', 'Force ' + num(st.denoising_strength), { icon: 'sliders', title: 'Force (denoising) : bas = proche de l’image de départ, haut = très différent', onClick: b => popover(b, 'Force', () => [slider('Force (denoising)', st, 'denoising_strength', 0, 1, 0.01, 'Denoising strength', () => { renderPills(c); }), h('div.fx-info', { text: '0,3 : retouche légère · 0,5 : redessine · 0,7 et plus : nouvelle image' })]) }) : null,
      pill('lot', (+st.batch_size * +st.n_iter) + ' image' + (+st.batch_size * +st.n_iter > 1 ? 's' : ''), { icon: 'grid', title: 'Images par lot et nombre de lots', onClick: b => popover(b, 'Lot', () => [
        slider('Images par lot', st, 'batch_size', 1, 8, 1, 'Batch size : images générées en même temps', () => renderPills(c)),
        slider('Lots', st, 'n_iter', 1, 128, 1, 'Batch count : nombre de lots à la suite', () => renderPills(c)),
        h('div.fx-info', { text: 'Plusieurs images s’affichent ensemble en planche, en grand, pour choisir d’un coup d’œil.' })]) }),
      pill('lora', nL ? 'LoRA · ' + nL : 'LoRA', { icon: 'layers', on: !!nL, title: 'LoRA actifs (poids, fiche) et tous les LoRA', onClick: b => popover(b, nL ? 'LoRA actifs' : 'LoRA', () => [
        nL ? c.chips : h('div.fx-info', { text: 'Aucun LoRA dans l’invite.' }),
        h('div.fx-pop-row', tbtn('Parcourir tous les LoRA', () => { closePop(); st.open._sub = 'lora'; save(); toggleDrawer(true); renderCtx(c); }, '.primary.sm'),
          h('span.fx-info', { text: 'Ctrl+↑ / Ctrl+↓ dans l’invite : poids' }))]) }),
      cat && cat.kdInfo ? pill('kd', 'Kane Detailer', { icon: 'sparkles', on: !!st.kd.enabled, title: 'Clic : activer ou couper Kane Detailer (ses réglages sont dans le tiroir)', onClick: () => { st.kd.enabled = !st.kd.enabled; save(); renderParams(); } }) : null,
      c.k === 't2i' ? pill('hires', 'Hires fix', { icon: 'maximize', on: !!st.enable_hr, title: 'Clic : activer ou couper le hires fix (ses réglages sont dans le tiroir)', onClick: () => { st.enable_hr = !st.enable_hr; save(); renderParams(); } }) : null,
      pill('neg', words ? 'Négatif · ' + words : 'Négatif', { icon: FX.negOpen ? 'chevron-down' : 'chevron-right', on: !!FX.negOpen, title: 'Afficher ou replier l’invite négative', onClick: () => { FX.negOpen = !FX.negOpen; save(); renderPills(c); c.negSync && c.negSync(); if (FX.negOpen && c.negTa) c.negTa.focus(); } }),
      (cat && cat.styles && cat.styles.length) || st.styles.length ? stylesPicker(c.k) : null,
      pill('drawer', 'Réglages', { icon: 'sliders', on: FX.drawer !== false, title: 'Ouvrir ou fermer le tiroir des réglages complets', onClick: () => toggleDrawer() }));
    if (keep) { const n = c.pills.querySelector('[data-id="' + keep + '"]'); if (n) { POP.anchor = n; n.classList.add('open'); } }
  }
  function modelPop() {
    if (!cat) return [engineBadge()];
    const list = h('div.fx-mlist');
    for (const m of cat.models) {
      const on = norm(m.title) === norm(cat.current.model);
      const row = h('button.fx-mrow' + (on ? '.on' : ''), { type: 'button', title: m.title }, h('span', { text: norm(m.title).replace(/\.safetensors$/i, '') }));
      row.addEventListener('click', () => { closePop(); if (!on) setOptions({ sd_model_checkpoint: m.title }, 'Checkpoint : ' + norm(m.title) + ' (chargé à la prochaine génération)'); });
      list.append(row);
    }
    const dt = h('select.fx-sel', ...DTYPES.map(d => h('option', { value: d, text: d })));
    dt.value = cat.dtype || 'Automatic';
    dt.addEventListener('change', () => { closePop(); setOptions({ forge_unet_storage_dtype: dt.value }, 'Diffusion in Low Bits : ' + dt.value + ' (au prochain chargement du modèle)'); });
    return [list,
      field('VAE / Text Encoder', modulesPicker(cat.current.modules || [], v => { closePop(); setOptions({ forge_additional_modules: v }, 'VAE / Text Encoder changés'); })),
      field('Diffusion in Low Bits', dt, 'Précision des poids du modèle en mémoire'),
      h('div.fx-pop-row', engineBadge(), h('div.spacer'), tbtn('Relire les modèles', async () => { closePop(); await N.forgeRefreshCheckpoints(url()); await N.forgeRefreshLoras(url()); loadCat(); }, '.sm'))];
  }
  function formatPop(c) {
    const st = FX[c.k], step = (cat && cat.resStep) || 16, d = c.k === 'i2i' ? i2iDoc : null;
    const manual = () => { if ('autoSize' in st) st.autoSize = false; save(); renderPills(c); renderParams(); };
    const swap = ebtn('⇅', 'Inverser largeur et hauteur', () => { [st.width, st.height] = [st.height, st.width]; manual(); refreshPop(); });
    return [formatRow(st),
      h('div.fx-pop-dims', h('div.fx-col', slider('Largeur', st, 'width', 64, 2048, step, 'Width', manual), slider('Hauteur', st, 'height', 64, 2048, step, 'Height', manual)), swap),
      d ? h('div.fx-pop-row', tbtn('Ajuster à la source', () => { st.autoSize = true; save(); renderParams(); refreshPop(); }, '.sm'), tbtn('Taille exacte de la source', () => { st.autoSize = 'exact'; save(); renderParams(); refreshPop(); }, '.sm')) : null];
  }
  function trNote(c) {
    if (!c.trNote) return;
    const fr = FX.translate !== false && G.looksFrench(FX[c.k].prompt);
    c.trNote.textContent = fr ? 'Invite en français : traduite en anglais sur votre PC avant l\'envoi à Forge (les balises <lora:…> restent telles quelles).' : '';
  }
  // Poids dans l'invite, comme Forge : Ctrl+↑ / Ctrl+↓ sur une balise <lora:…> (pas de 0,05) ou sur un mot, (mot:1.1)
  function editWeight(ta, dir) {
    const v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    for (const m of v.matchAll(/<lora:([^:>]+):?(-?[\d.]*)>/g)) {
      if (a >= m.index && a <= m.index + m[0].length) {
        const w = Math.round(((m[2] === '' ? 1 : +m[2]) + dir * 0.05) * 100) / 100;
        const rep = `<lora:${m[1]}:${w}>`;
        ta.value = v.slice(0, m.index) + rep + v.slice(m.index + m[0].length);
        ta.selectionStart = ta.selectionEnd = m.index + rep.length - 1;
        return ta.dispatchEvent(new Event('input'));
      }
    }
    for (const m of v.matchAll(/\(([^()]+):(-?[\d.]+)\)/g)) {
      if (a >= m.index && a <= m.index + m[0].length) {
        const w = Math.round((+m[2] + dir * 0.1) * 100) / 100;
        const rep = w === 1 ? m[1] : `(${m[1]}:${w})`;
        ta.value = v.slice(0, m.index) + rep + v.slice(m.index + m[0].length);
        ta.selectionStart = m.index + (w === 1 ? 0 : 1); ta.selectionEnd = ta.selectionStart + m[1].length;
        return ta.dispatchEvent(new Event('input'));
      }
    }
    let s = a, e = b;
    if (s === e) { while (s > 0 && !/[,\n(]/.test(v[s - 1])) s--; while (e < v.length && !/[,\n)]/.test(v[e])) e++; }
    const word = v.slice(s, e).trim(); if (!word) return;
    const lead = v.slice(s, e).indexOf(word); s += lead; e = s + word.length;
    const w = Math.round((1 + dir * 0.1) * 100) / 100, rep = `(${word}:${w})`;
    ta.value = v.slice(0, s) + rep + v.slice(e);
    ta.selectionStart = s + 1; ta.selectionEnd = s + 1 + word.length;
    ta.dispatchEvent(new Event('input'));
  }
  // Chercher / remplacer dans l'invite, repris de l'extension forge_prompt_find : Ctrl+F dans une invite ou 🔍,
  // Entrée / Maj+Entrée = suivant / précédent, Échap ou Ctrl+F = ranger. Surlignage par un calque transparent
  // posé par-dessus le champ (le fond du champ est opaque), insensible à la souris.
  const escHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function findBar(c) {
    const input = h('input.fx-in.kf-input', { type: 'text', placeholder: 'Chercher dans l’invite', spellcheck: false });
    const count = h('span.kf-count');
    const field = h('div.kf-field', h('span.kf-glass', { text: '🔍' }), input, count);
    const tbtn = (text, tip) => h('button.kf-btn', { type: 'button', text, title: tip });
    const prev = tbtn('▲', 'Précédent (Maj+Entrée)'), next = tbtn('▼', 'Suivant (Entrée)');
    const caseBtn = tbtn('Aa', 'Respecter la casse'), wordBtn = tbtn('Mot', 'Mot entier');
    const scope = h('select.fx-sel.kf-scope', { title: 'Où chercher' }, ...[['both', 'Tout'], ['prompt', 'Invite'], ['neg', 'Négative']].map(([v, t]) => h('option', { value: v, text: t })));
    const replBtn = tbtn('⇄', 'Remplacer'), close = tbtn('✕', 'Ranger (Échap ou Ctrl+F)');
    const rinput = h('input.fx-in.kf-rinput', { type: 'text', placeholder: 'Remplacer par…', spellcheck: false });
    const one = tbtn('Remplacer', 'Remplacer l’occurrence surlignée (Entrée)'), all = tbtn('Tout remplacer', 'Remplacer toutes les occurrences');
    const row2 = h('div.kf-row.kf-row2', rinput, one, all); row2.hidden = true;
    const bar = h('div.kf-bar', h('div.kf-row', field, prev, next, caseBtn, wordBtn, scope, replBtn, close), row2);
    bar.hidden = true;
    const F = { bar, open: false, matches: [], index: -1 };
    const prompts = () => [c.promptTa, c.negTa].filter(Boolean);
    const targets = () => scope.value === 'prompt' ? [c.promptTa] : scope.value === 'neg' ? [c.negTa] : prompts();
    const mirror = ta => {
      if (!ta._kfMirror) {
        ta._kfMirror = h('div.kf-mirror');
        ta.parentElement.appendChild(ta._kfMirror);
        ta.addEventListener('scroll', () => { ta._kfMirror.scrollTop = ta.scrollTop; });
        new ResizeObserver(() => { if (F.open && ta._kfMirror.style.display !== 'none') mirror(ta); }).observe(ta);
      }
      const m = ta._kfMirror, cs = getComputedStyle(ta);
      m.style.display = '';
      for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'wordSpacing']) m.style[p] = cs[p];
      Object.assign(m.style, { left: ta.offsetLeft + ta.clientLeft + 'px', top: ta.offsetTop + ta.clientTop + 'px', width: ta.clientWidth + 'px', height: ta.clientHeight + 'px' });
      m.scrollTop = ta.scrollTop;
      return m;
    };
    const paint = () => {
      const cur = F.matches[F.index];
      for (const ta of prompts()) {
        const list = F.open ? F.matches.filter(x => x.ta === ta) : [];
        if (!list.length) { if (ta._kfMirror) { ta._kfMirror.innerHTML = ''; ta._kfMirror.style.display = 'none'; } continue; }
        let html = '', last = 0;
        for (const mt of list) { html += escHtml(ta.value.slice(last, mt.start)) + `<mark${mt === cur ? ' class="kf-cur"' : ''}>` + escHtml(ta.value.slice(mt.start, mt.end)) + '</mark>'; last = mt.end; }
        mirror(ta).innerHTML = html + escHtml(ta.value.slice(last)) + '\n';
      }
      const n = F.matches.length;
      count.textContent = !input.value ? '' : n ? `${F.index + 1}/${n}` : '0';
      field.classList.toggle('kf-none', !!input.value && !n);
    };
    const compute = keep => {
      const previous = keep && F.matches[F.index];
      F.matches = [];
      if (input.value) {
        let src = esc(input.value);
        if (wordBtn.classList.contains('on')) src = '(?<![\\w@])' + src + '(?![\\w@])';
        const re = new RegExp(src, caseBtn.classList.contains('on') ? 'g' : 'gi');
        for (const ta of targets()) for (const m of ta.value.matchAll(re)) if (m[0]) F.matches.push({ ta, start: m.index, end: m.index + m[0].length });
      }
      F.index = F.matches.length ? 0 : -1;
      if (previous) { const k = F.matches.findIndex(x => x.ta === previous.ta && x.start >= previous.start); if (k >= 0) F.index = k; }
      paint();
    };
    const reveal = () => {
      const mt = F.matches[F.index]; if (!mt) return;
      const mark = mt.ta._kfMirror && mt.ta._kfMirror.querySelector('mark.kf-cur');
      if (mark) mt.ta.scrollTop = Math.max(0, mark.offsetTop - mt.ta.clientHeight / 3);
      mt.ta.setSelectionRange(mt.start, mt.end);
    };
    const step = d => {
      if (!F.matches.length) compute(false);
      if (!F.matches.length) return;
      F.index = (F.index + d + F.matches.length) % F.matches.length;
      paint(); reveal();
    };
    // insertText garde l'annulation native (Ctrl+Z) et déclenche « input », donc l'état et les puces suivent
    const replaceAt = (mt, text) => {
      mt.ta.focus({ preventScroll: true }); mt.ta.setSelectionRange(mt.start, mt.end);
      if (!document.execCommand('insertText', false, text)) { mt.ta.value = mt.ta.value.slice(0, mt.start) + text + mt.ta.value.slice(mt.end); mt.ta.dispatchEvent(new Event('input')); }
    };
    const replaceOne = () => { const mt = F.matches[F.index]; if (!mt) return; replaceAt(mt, rinput.value); compute(true); reveal(); rinput.focus(); };
    const replaceAll = () => {
      const list = F.matches.slice().sort((a, b) => a.ta === b.ta ? b.start - a.start : 0);   // de la fin vers le début
      if (!list.length) return;
      for (const mt of list) replaceAt(mt, rinput.value);
      KS.toast(list.length + ' remplacement' + (list.length > 1 ? 's' : ''), 'ok', 1500);
      compute(false); input.focus();
    };
    F.show = (seed = '') => {
      F.open = true; bar.hidden = false;
      if (seed) input.value = seed;
      input.focus(); input.select(); compute(false); if (F.matches.length) reveal();
      if (c.findBtn) c.findBtn.classList.add('on');
    };
    F.hide = () => {
      F.open = false; bar.hidden = true; F.matches = []; F.index = -1; paint();
      if (c.findBtn) c.findBtn.classList.remove('on');
      if (c.promptTa) c.promptTa.focus({ preventScroll: true });
    };
    F.toggle = () => F.open ? F.hide() : F.show();
    F.refresh = () => { if (F.open) compute(true); };
    input.addEventListener('input', U.debounce(() => compute(false), 100));
    scope.addEventListener('change', () => compute(false));
    for (const b of [caseBtn, wordBtn]) b.addEventListener('click', () => { b.classList.toggle('on'); compute(false); input.focus(); });
    prev.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));
    replBtn.addEventListener('click', () => { row2.hidden = !row2.hidden; replBtn.classList.toggle('on', !row2.hidden); (row2.hidden ? input : rinput).focus(); });
    one.addEventListener('click', replaceOne);
    all.addEventListener('click', replaceAll);
    close.addEventListener('click', F.hide);
    bar.addEventListener('keydown', e => {
      e.stopPropagation();                         // ni Ctrl+Entrée (générer) ni Échap (interrompre) pendant la frappe ici
      if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f')) { e.preventDefault(); F.hide(); }
      else if (e.key === 'Enter' && e.target === input) { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Enter' && e.target === rinput) { e.preventDefault(); replaceOne(); }
    });
    return F;
  }
  // 🧹 Nettoyer : par ligne, découpe aux virgules hors (), [], {}, <> ; retire espaces en trop, tags vides et doublons
  function cleanPrompt(text) {
    let removed = 0;
    const lines = String(text || '').split('\n').map(line => {
      const parts = []; let depth = 0, cur = '';
      for (const ch of line) {
        if ('([{<'.includes(ch)) depth++;
        else if (')]}>'.includes(ch)) depth = Math.max(0, depth - 1);
        if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
      }
      parts.push(cur);
      const seen = new Set(), out = [];
      for (const p of parts) {
        const t = p.replace(/\s+/g, ' ').trim(); if (!t) continue;
        const key = t.toLowerCase();
        if (seen.has(key)) { removed++; continue; }
        seen.add(key); out.push(t);
      }
      return out.join(', ');
    });
    return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), removed };
  }
  function cleanPrompts(c) {
    let removed = 0, changed = 0;
    for (const ta of [c.promptTa, c.negTa]) {
      if (!ta) continue;
      const r = cleanPrompt(ta.value);
      removed += r.removed;
      if (r.text === ta.value) continue;
      changed++;
      ta.focus({ preventScroll: true }); ta.select();
      if (!document.execCommand('insertText', false, r.text)) { ta.value = r.text; ta.dispatchEvent(new Event('input')); }
    }
    KS.toast(!changed ? 'Invite déjà propre' : removed ? `Invite nettoyée : ${removed} doublon${removed > 1 ? 's' : ''} retiré${removed > 1 ? 's' : ''} (Ctrl+Z pour annuler)` : 'Invite nettoyée (Ctrl+Z pour annuler)', 'ok', 2600);
  }
  // 🕘 Historique : les 60 dernières invites envoyées à Forge (txt2img et img2img), avec recherche
  const HISTORY_MAX = 60;
  function rememberPrompt(st) {
    const p = String(st.prompt || '').trim(), n = String(st.negative_prompt || '').trim();
    if (!p && !n) return;
    const list = (FX.promptHistory || []).filter(e => !(e.p === p && e.n === n));
    FX.promptHistory = [{ p, n, t: Date.now() }, ...list].slice(0, HISTORY_MAX); save();
  }
  function historyDialog(c) {
    const st = FX[c.k];
    const q = h('input.fx-in', { type: 'search', placeholder: 'Chercher dans l’historique (mots de l’invite ou de l’invite négative)', spellcheck: false });
    const list = h('div.kf-hist');
    const when = t => new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    let dlg;
    const apply = (e, withNeg) => {
      st.prompt = e.p; if (withNeg) st.negative_prompt = e.n; save();
      if (c.syncPrompt) c.syncPrompt();
      for (const peer of [CTX.t2i, EDIT]) if (peer !== c && peer.k === c.k && peer.syncPrompt) peer.syncPrompt();
      renderGenButtons(); dlg.close(null);
      KS.toast('Invite reprise de l’historique', 'ok', 1500);
    };
    const draw = () => {
      const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
      const all = FX.promptHistory || [];
      const found = all.filter(e => words.every(w => (e.p + '\n' + e.n).toLowerCase().includes(w)));
      list.replaceChildren(...(found.length ? found.map(e => {
        const row = h('div.kf-hrow', { title: 'Cliquer : reprendre l’invite et l’invite négative' },
          h('div.kf-hmeta', h('span', { text: when(e.t) }), ebtn('➕', 'Reprendre seulement l’invite (garder l’invite négative actuelle)', ev => { ev.stopPropagation(); apply(e, false); }, '.sm'),
            ebtn('🗑️', 'Retirer de l’historique', ev => { ev.stopPropagation(); FX.promptHistory = (FX.promptHistory || []).filter(x => x !== e); save(); draw(); }, '.sm')),
          h('div.kf-hp', { text: e.p || '—' }),
          e.n ? h('div.kf-hn', { text: e.n }) : null);
        row.addEventListener('click', () => apply(e, true));
        return row;
      }) : [h('div.fx-info', { text: all.length ? 'Aucune invite ne contient ces mots.' : 'L’historique se remplit à chaque génération.' })]));
    };
    q.addEventListener('input', draw);
    draw();
    const clear = ui.btn('Tout effacer', () => { FX.promptHistory = []; save(); draw(); KS.toast('Historique effacé', 'ok', 1500); });
    dlg = KS.modal({ title: 'Historique des invites', width: 720, body: h('div.kf-hbox', q, list), buttons: [{ label: 'Fermer', value: null }], left: [clear] });
    setTimeout(() => q.focus(), 0);
  }
  // LoRA de l'invite : une puce par balise, poids réglable, fiche modifiable
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const loraRe = name => new RegExp('<lora:' + esc(name) + '(:[^>]*)?>', 'i');
  function renderChips(c) {
    const box = c.chips; if (!box) return;
    const st = FX[c.k], found = [...st.prompt.matchAll(/<lora:([^:>]+):?(-?[\d.]*)>/g)];
    box.replaceChildren(...found.map(m => {
      const l = cat && cat.loras.find(x => x.name === m[1]);
      const w = h('input.fx-num', { type: 'number', step: 0.05, value: m[2] === '' ? 1 : +m[2], title: 'Poids du LoRA dans l\'invite' });
      w.addEventListener('change', () => {
        st.prompt = st.prompt.replace(m[0], `<lora:${m[1]}:${+w.value}>`); save();
        if (c.promptTa) { c.promptTa.value = st.prompt; c.promptTa.dispatchEvent(new Event('input')); }
      });
      const edit = l ? ebtn('🛠️', 'Modifier la fiche du LoRA (activation text, poids préféré, aperçu…)', () => editLora(l), '.sm') : null;
      const x = ebtn('×', 'Retirer de l\'invite', () => l ? toggleLora(c, l) : (() => { st.prompt = st.prompt.replace(m[0], '').trim(); c.promptTa.value = st.prompt; c.promptTa.dispatchEvent(new Event('input')); })(), '.sm');
      return h('span.fx-lchip' + (l ? '' : '.missing'), { title: l ? (l.description || l.name) : 'LoRA introuvable dans Forge' }, l && l.url ? h('img', { src: l.url, alt: '' }) : null, h('span', { text: l ? (l.alias || l.name) : m[1] }), w, edit, x);
    }));
  }
  function stylesPicker(k) {
    const st = FX[k];
    const b = h('button.fx-styles', { type: 'button', title: 'Styles de Forge (styles.csv) : ajoutés à l\'invite au moment de générer' }, h('span.fx-lbl', { text: 'Styles' }), h('span.fx-styles-v', { text: st.styles.length ? st.styles.join(', ') : '—' }));
    b.addEventListener('click', () => {
      const list = (cat && cat.styles) || [];
      const r = b.getBoundingClientRect();
      ui.menu(list.length ? list.map(s => ({ label: s.name, checked: () => st.styles.includes(s.name), action: () => {
        st.styles = st.styles.includes(s.name) ? st.styles.filter(x => x !== s.name) : [...st.styles, s.name]; save();
        b.querySelector('.fx-styles-v').textContent = st.styles.length ? st.styles.join(', ') : '—';
      } })) : [{ label: cat ? 'Aucun style dans Forge (styles.csv)' : 'Moteur IA arrêté', disabled: true }], r.left, r.bottom + 4);
    });
    return b;
  }
  function applyStyles(c) {
    const st = FX[c.k], list = ((cat && cat.styles) || []).filter(s => st.styles.includes(s.name));
    if (!list.length) return KS.toast('Choisissez d\'abord un ou plusieurs styles', 'info');
    const merge1 = (txt, add) => !add ? txt : add.includes('{prompt}') ? add.replace('{prompt}', txt) : [txt, add].filter(Boolean).join(', ');
    for (const s of list) { st.prompt = merge1(st.prompt, s.prompt); st.negative_prompt = merge1(st.negative_prompt, s.negative); }
    st.styles = []; save();
    if (c === EDIT) renderEditorDraw(); else render();
  }
  function renderGenButtons() {
    for (const c of [CTX.t2i, CTX.i2i, EDIT]) {
      const g = c.genbox; if (!g) continue;
      if (KS.animationBusy && !BUSY && !PREPARING) {
        g.replaceChildren(h('button.fx-generate', { text: 'Moteur utilisé par Animation', disabled: true })); continue;
      }
      if (BUSY || PREPARING) {
        const stopping = BUSY ? BUSY.stopping : PREPARING.canceled;
        const i = h('button.fx-interrupt', { text: stopping ? 'Interruption…' : 'Interrompre', title: 'Interrompre (Ctrl+Entrée ou Échap)', disabled: stopping }); i.addEventListener('click', interrupt);
        const s = h('button.fx-skip', { text: 'Passer l’image', title: 'Passer à l\'image suivante du lot (Alt+Entrée)' }); s.addEventListener('click', skip);
        g.replaceChildren(...(BUSY ? [i, s] : [i]));
      } else {
        const d = D(), unavailable = c === EDIT && (!d || !FX.editor.prompt.trim() || (FX.editor.target === 'selection' && !d.selection.bounds));
        const b = h('button.fx-generate', { title: 'Générer (Ctrl+Entrée)', disabled: unavailable });
        if (c !== EDIT) b.innerHTML = KS.icon('sparkles');
        b.append(c === EDIT ? 'Ajouter le dessin' : 'Générer');
        b.addEventListener('click', () => c.action ? c.action() : generate(c.k));
        g.replaceChildren(b);
      }
    }
  }

  /* ---------------------------------------------------------------- colonne des réglages */
  function renderParams() { renderCtx(CTX.t2i); renderCtx(CTX.i2i); renderPills(CTX.t2i); renderPills(CTX.i2i); refreshPop(); }
  function renderCtx(c) {
    const left = c.left; if (!left) return;
    const st = FX[c.k];
    const sc = left.scrollTop;
    const nLora = (st.prompt.match(/<lora:/g) || []).length;
    const subs = [['generation', 'Réglages'], ['lora', nLora ? 'LoRA · ' + nLora : 'LoRA'], ['checkpoints', 'Modèles']];
    const sub = subs.some(s => s[0] === st.open._sub) ? st.open._sub : 'generation';
    const bar = tabs(subs, sub, v => { st.open._sub = v; save(); renderCtx(c); }, '.fx-seg');
    let content;
    if (!cat) content = h('div.fx-panel', h('div.fx-note', { text: loading ? 'Lecture de Forge…' : (catErr && KS.engine && KS.engine.ready() ? catErr : 'Le moteur IA (Forge) n\'est pas démarré.') }),
      !loading ? tbtn('Démarrer le moteur IA', () => ensureCat(), '.primary') : null);
    else if (sub === 'lora') content = loraTab(c);
    else if (sub === 'checkpoints') content = ckptTab();
    else content = c.k === 't2i' ? t2iParams(st) : i2iParams(st);
    const stale = cat && cat.stale && !(KS.engine && KS.engine.ready()) ? h('div.fx-info.fx-stale', { text: 'Le moteur IA démarre (environ 10 s) : vous pouvez déjà régler et écrire, la génération partira dès qu\'il est prêt.' }) : null;
    fillEl(left, h('div.fx-dhead', bar, ibtn('close', 'Fermer le tiroir (les pastilles sous l’invite restent)', () => toggleDrawer(false))), stale, content);
    left.scrollTop = sc;
    renderPills(c);
  }
  const rp = () => renderParams();
  function samplingRow(st) {
    return h('div.fx-col',
      row2(select('Échantillonneur', cat.samplers, st, 'sampler_name', 'Sampling method'), select('Planificateur', cat.schedulers, st, 'scheduler', 'Schedule type')),
      slider('Étapes', st, 'steps', 1, 150, 1, 'Sampling steps'));
  }
  function presetRow(st) {
    const names = Object.keys(cat.presets || {}).sort();
    const id = 'fx-pl-' + Math.random().toString(36).slice(2);
    const inp = h('input.fx-in', { list: id, value: FX.presetName || '', spellcheck: false });
    inp.addEventListener('change', () => {
      FX.presetName = inp.value; save();
      const p = cat.presets[inp.value]; if (!p) return;
      if (p.sampler) st.sampler_name = p.sampler; if (p.scheduler) st.scheduler = p.scheduler; if (p.steps) st.steps = +p.steps;
      if (p.cfg) st.cfg_scale = +p.cfg; if (p.dcfg) st.distilled_cfg_scale = +p.dcfg;
      if (p.width && p.height) { st.width = +p.width; st.height = +p.height; if ('autoSize' in st) st.autoSize = false; }
      save(); renderParams();
    });
    const write = async presets => { const r = await N.forgePresetsWrite(presets); if (!r.ok) return KS.toast(r.error, 'err'); cat.presets = presets; renderParams(); };
    inp.placeholder = 'Nom du préréglage…';
    const sv = ibtn('save', 'Enregistrer l’échantillonnage et la taille sous ce nom (aussi dans Forge)', () => {
      const n = inp.value.trim(); if (!n) return KS.toast('Tapez un nom de préréglage puis Enregistrer', 'info');
      write({ ...cat.presets, [n]: { sampler: st.sampler_name, scheduler: st.scheduler, steps: st.steps, cfg: st.cfg_scale, dcfg: st.distilled_cfg_scale, width: st.width, height: st.height } })
        .then(() => KS.toast('Préréglage « ' + n + ' » enregistré (aussi dans Forge)', 'ok'));
    });
    const del = ibtn('trash', 'Supprimer ce préréglage', () => { const n = inp.value.trim(); if (!cat.presets[n]) return; const p = { ...cat.presets }; delete p[n]; FX.presetName = ''; write(p); });
    return h('div.fx-preset', { title: 'Préréglage : échantillonnage et taille, jamais l’invite' }, h('div.fx-field.grow', h('label.fx-lbl', { text: 'Préréglage' }), inp,
      h('datalist', { id }, ...names.map(n => h('option', { value: n })))), sv, del);
  }
  function seedRows(st, k) {
    const out = [h('div.fx-seedrow', h('div.fx-seedv', { text: lastSeed[k] != null ? 'Aléatoire · dernière : ' + lastSeed[k] : 'Aléatoire à chaque génération', title: 'Une nouvelle graine est tirée à chaque génération' }),
      check('Variations', st, 'seedExtra', 'Réglages de variation ; la graine reste aléatoire', rp))];
    if (st.seedExtra) {
      out.push(slider('Force de variation', st, 'subseed_strength', 0, 1, 0.01),
        row2(slider('Largeur d’origine', st, 'seed_resize_from_w', 0, 2048, 8, 'Resize seed from width'), slider('Hauteur d’origine', st, 'seed_resize_from_h', 0, 2048, 8, 'Resize seed from height')));
    }
    return out;
  }
  const kdForce = (st, part) => st.kd.forces[part.key] != null ? +st.kd.forces[part.key] : part.denoise;
  function kdAcc(st, k) {
    return acc('Kane Detailer', st, 'kd', () => {
      const info = cat && cat.kdInfo;
      if (!info) return [h('div.note', { text: 'Kane Detailer n’est pas dans ce moteur : mettez Kane OS à jour puis redémarrez le moteur du Studio.' })];
      const out = [];
      if (k === 'i2i') {
        out.push(check('Skip img2img', st.kd, 'skip', 'Pas de passe img2img classique : seule l’image source est détaillée, partie par partie', rp));
        if (st.kd.skip && INPAINT_MODES.includes(FX.i2iMode)) out.push(h('div.note', { text: 'En inpaint, la passe classique a quand même lieu.' }));
      }
      const presets = Object.entries(info.presets || {});
      const same = list => list.length === st.kd.parts.length && list.every(x => st.kd.parts.includes(x));
      const bar = h('div.fx-tabs.fx-subtabs');
      for (const [name, list] of presets) {
        const b = h('button' + (same(list) ? '.on' : ''), { text: name });
        b.addEventListener('click', () => { st.kd.parts = list.slice(); save(); rp(); }); bar.appendChild(b);
      }
      out.push(bar);
      // une ligne par partie : case, nom, force (curseur + valeur), retour à la recette
      const rows = h('div.kd-rows');
      for (const part of info.parts) {
        const on = st.kd.parts.includes(part.key), tmp = { v: kdForce(st, part) };
        const i = h('input', { type: 'checkbox', checked: on, disabled: !part.model });
        i.addEventListener('change', () => { const set = new Set(st.kd.parts); i.checked ? set.add(part.key) : set.delete(part.key); st.kd.parts = info.parts.map(x => x.key).filter(x => set.has(x)); save(); rp(); });
        const sl = slider('', tmp, 'v', 0.05, 0.75, 0.01, 'Force de repeint de « ' + part.label + ' » (recette : ' + part.denoise + ')', v => { st.kd.forces[part.key] = v; save(); reset.hidden = false; });
        const reset = h('button.kd-reset', { text: '↺', title: 'Revenir à la force de la recette (' + part.denoise + ')', hidden: st.kd.forces[part.key] == null });
        reset.addEventListener('click', () => { delete st.kd.forces[part.key]; save(); rp(); });
        rows.appendChild(h('div.kd-row' + (on ? '' : '.off'), { title: part.model ? 'Détecteur : ' + part.model : 'Détecteur absent du dossier models/adetailer' },
          h('label.fx-check', i, h('span', { text: part.label })), sl, reset));
      }
      out.push(h('div.kd-help', { text: 'Force = part de la zone qui est redessinée. ' + (info.force_help || '') }), rows,
        row2(slider('Détail en plus', st.kd, 'detail', 0, 1, 0.05, 'Ajoute du détail dans les zones : bruit un peu plus fort, invite de détail, contours renforcés (0 = non)'),
          radio('Agrandir avant de détailler', [[1, '×1'], [1.5, '×1,5'], [2, '×2']], st.kd, 'upscale', 'L’image est agrandie (upscaler de Forge) avant le détail : le détail ajouté reste visible même sur un petit visage. L’image finale est plus grande.')),
        row2(slider('Garder les couleurs d’origine', st.kd, 'keep', 0, 1, 0.05, '1 : seul le détail est repris, teintes et lumière inchangées · 0 : le repeint tel quel'),
          slider('Résolution de travail', st.kd, 'resolution', 768, 1536, 64, 'Chaque zone est repeinte à cette taille (1024 pour ANIMA), au plus 3 à 4 fois agrandie')),
        ...(info.version >= 4 ? [
          h('div.kd-help', { text: 'Juge et style (Kane Detailer 4)' }),
          row2(slider('Essais par zone', st.kd, 'tries', 1, 4, 1, 'Visage, yeux, mains et pieds sont repeints plusieurs fois ; le juge (détecteur, DWPose, ressemblance) garde le meilleur essai, ou l’original si aucun n’est meilleur. 2 essais ≈ deux fois plus long sur ces zones.'),
            slider('Garder le grain du pinceau', st.kd, 'grain', 0, 1, 0.05, 'Remet la touche fine du pinceau là où le repeint a lissé la peinture (0 = non)')),
          check('Réparer les mains douteuses', st.kd, 'repair', 'Une main peu sûre pour DWPose reçoit aussi un essai repeint fort (0,5), gardé seulement s’il est nettement meilleur', rp),
          check('Protéger les lumières', st.kd, 'glow', 'Yeux lumineux, reflets, magie : les points qui brillent gardent leur éclat', rp),
          check('Ne pas vieillir les visages', st.kd, 'age', 'Ajoute « rides, sillons, cernes, âgé » à ce qu’il faut éviter sur le visage et les yeux, sauf si l’invite demande un personnage mûr', rp),
          ...(info.version >= 5 ? [
            check('Invite de zone d’après ce qu’on y voit', st.kd, 'autotag', 'WD14 reconnaît ce que contient chaque zone (objet tenu, couleur des yeux, ongles…) et l’ajoute à son invite : le repeint ne change plus la couleur des yeux et ne fait plus disparaître l’objet tenu', rp),
            check('Raccords invisibles', st.kd, 'soft', 'Inpainting doux dans chaque zone : le bord du masque est repeint progressivement, sans couture', rp),
            check('Juge WD14', st.kd, 'wd', 'Le juge tient aussi compte de la netteté, des erreurs d’anatomie et de l’identité vues par WD14', rp)] : [])] : []),
        check('Montrer les zones repeintes après la génération', st.kd, 'showZones', 'Ajoute à côté du résultat l’image des zones vraiment repeintes (masque et zone de travail)'),
        h('div.note', { text: 'Passe du plus large au plus fin. Clic droit sur un résultat : « Voir les zones » (ce qui sera repeint) ou « Détailler » sur une image déjà faite.' }));
      return out;
    }, { on: [st.kd, 'enabled'], tip: 'Détaille chaque partie du corps après la génération (détecteurs pour l’illustration)' });
  }
  const advAcc = (st, k) => acc('Avancé', st, 'adv', () => [
    h('div.fx-sub', { text: 'Never OOM Integrated' }),
    check('Décharger le modèle à chaque passe (UNet)', st.noom, 'unet', 'Enabled for UNet (always offload) : plus lent, mais pas de manque de mémoire'),
    check('VAE par tuiles', st.noom, 'vae', 'Enabled for VAE (always tiled) : indispensable pour les très grandes images'),
    ...scriptBlock(st, k)], { active: st.noom.unet || st.noom.vae || (st.script && st.script !== 'None'), tip: 'Never OOM, scripts de Forge (X/Y/Z plot, Prompt matrix…)' });
  const SCRIPT_NAMES = { 'prompt matrix': 'Prompt matrix', 'prompts from file or textbox': 'Prompts from file or textbox', 'x/y/z plot': 'X/Y/Z plot', loopback: 'Loopback', 'sd upscale': 'SD upscale' };
  const SCRIPT_HELP = {
    'x/y/z plot': 'Grille de comparaison : choisissez un paramètre par axe et ses valeurs séparées par des virgules (ex. Steps : 20, 30, 40 ; CFG Scale : 3, 4, 5).',
    'prompt matrix': 'Séparez des variantes par | dans l\'invite : une image par combinaison, réunies dans une grille.',
    'prompts from file or textbox': 'Une invite par ligne : une génération par ligne.',
    loopback: 'Repasse plusieurs fois le résultat dans img2img.',
    'sd upscale': 'Agrandit puis refait l\'image par tuiles (taille des tuiles = Width × Height).',
  };
  const XYZ_HIDDEN = [2, 5, 8, 18];
  function scriptBlock(st, k) {
    const list = (cat.scripts || []).filter(s => s.img2img === (k === 'i2i'));
    const out = [select('Script', [['None', 'Aucun'], ...list.map(s => [s.name, SCRIPT_NAMES[s.name] || s.name.replace(/^./, c => c.toUpperCase())])], st, 'script', '', rp)];
    const sc = list.find(s => s.name === st.script);
    if (!sc) return out;
    const vals = st.scriptArgs[sc.name] || (st.scriptArgs[sc.name] = sc.args.map(a => a.value == null ? (a.choices ? a.choices[0] : '') : a.value));
    while (vals.length < sc.args.length) vals.push(sc.args[vals.length].value ?? '');
    if (SCRIPT_HELP[sc.name]) out.push(h('div.fx-info', { text: SCRIPT_HELP[sc.name] }));
    const grid = h('div.fx-script');
    sc.args.forEach((a, i) => {
      if (sc.name === 'x/y/z plot' && XYZ_HIDDEN.includes(i)) return;
      const lab = a.label || ('Argument ' + (i + 1));
      let el;
      if (typeof a.value === 'boolean') el = check(lab, vals, i);
      else if (a.choices) el = select(lab, a.choices, vals, i);
      else if (typeof a.value === 'number' && a.min != null && a.max != null) el = slider(lab, vals, i, a.min, a.max, a.step || 1);
      else el = text(lab, vals, i, { rows: /list of prompt/i.test(lab) ? 5 : 1, placeholder: /values/i.test(lab) ? 'ex. 20, 30, 40' : '' });
      grid.appendChild(el);
    });
    out.push(grid);
    return out;
  }
  function t2iParams(st) {
    const step = cat.resStep || 16;
    const hrRes = () => {
      const w = st.width, hh = st.height;
      let tw, th;
      if (st.hr_resize_x || st.hr_resize_y) { tw = st.hr_resize_x || Math.round(st.hr_resize_y * w / hh); th = st.hr_resize_y || Math.round(st.hr_resize_x * hh / w); }
      else { tw = Math.round(w * st.hr_scale); th = Math.round(hh * st.hr_scale); }
      return `${w} × ${hh} → ${tw} × ${th}`;
    };
    const hrInfo = h('div.fx-info');
    const updHr = () => { hrInfo.textContent = hrRes(); };
    updHr();
    const hires = acc('Hires fix', st, 'hr', () => [
      field('Résolution finale', hrInfo),
      row2(select('Agrandisseur', [...(cat.latent.length ? cat.latent : ['Latent']), ...cat.upscalers], st, 'hr_upscaler', 'Upscaler'), slider('Étapes', st, 'hr_second_pass_steps', 0, 150, 1, 'Hires steps : 0 = autant que la première passe')),
      slider('Force (denoising)', st, 'denoising_strength', 0, 1, 0.05, 'Denoising strength'),
      row3(slider('Agrandir ×', st, 'hr_scale', 1, 4, 0.05, 'Upscale by', updHr), slider('Largeur cible', st, 'hr_resize_x', 0, 4096, step, 'Resize width to (0 = selon ×)', updHr), slider('Hauteur cible', st, 'hr_resize_y', 0, 4096, step, 'Resize height to (0 = selon ×)', updHr)),
      row2(slider('Shift', st, 'hr_distilled_cfg', 1, 24, 0.5), slider('CFG', st, 'hr_cfg', 1, 24, 0.5, 'Hires CFG Scale')),
      row2(select('Modèle', [['Use same checkpoint', 'Même modèle'], ...cat.models.map(m => norm(m.title))], st, 'hr_checkpoint_name', 'Hires checkpoint'),
        field('VAE / encodeur', modulesPicker(st.hr_additional_modules, v => { st.hr_additional_modules = v.length ? v : ['Use same choices']; save(); rp(); }, { same: true }), 'Hires VAE / Text Encoder')),
      row2(select('Échantillonneur', [['Use same sampler', 'Le même'], ...cat.samplers], st, 'hr_sampler_name', 'Hires sampling method'), select('Planificateur', [['Use same scheduler', 'Le même'], ...cat.schedulers], st, 'hr_scheduler', 'Hires schedule type')),
      text('', st, 'hr_prompt', { placeholder: 'Invite de la passe hires\n(vide : la même que la première passe)' }),
      text('', st, 'hr_negative_prompt', { placeholder: 'Invite négative de la passe hires\n(vide : la même que la première passe)' }),
    ], { on: [st, 'enable_hr'], tip: 'Seconde passe plus grande : plus de détails' });
    const swap = ebtn('⇅', 'Inverser largeur et hauteur', () => { [st.width, st.height] = [st.height, st.width]; save(); rp(); });
    return h('div.fx-panel.fx-plain',
      sect('Format', formatRow(st),
        h('div.fx-dims', h('div.fx-col', slider('Largeur', st, 'width', 64, 2048, step, 'Width', updHr), slider('Hauteur', st, 'height', 64, 2048, step, 'Height', updHr)), swap,
          h('div.fx-col', slider('Images par lot', st, 'batch_size', 1, 8, 1, 'Batch size : images générées en même temps'), slider('Lots', st, 'n_iter', 1, 128, 1, 'Batch count : nombre de lots à la suite')))),
      sect('Échantillonnage', samplingRow(st),
        row2(slider('CFG', st, 'cfg_scale', 1, 24, 0.5, 'CFG Scale'), slider('Shift', st, 'distilled_cfg_scale', 1, 24, 0.5, 'Shift des modèles à flux (anima) : Distilled CFG Scale de l\'API')), presetRow(st)),
      sect('Graine', seedRows(st, 't2i')),
      kdAcc(st, 't2i'), hires, advAcc(st, 't2i'));
  }
  const INPAINT_MODES = ['inpaint', 'inpaint_sketch', 'inpaint_upload'];
  // Taille de génération la plus fidèle aux proportions de la source (multiples de 8, côté long <= 2048) :
  // 5568 x 3072 (29:16) donne 1856 x 1024 pile, au lieu de 2048 x 1128 (proportions faussées, donc recadrage).
  const fitDoc = d => {
    const wide = d.width >= d.height, big = Math.max(d.width, d.height), small = Math.min(d.width, d.height);
    const cap = Math.min(big, 2048), ratio = small / big, q = v => Math.max(64, Math.round(v / 8) * 8);
    let best = null;
    for (let L = Math.min(2048, q(cap)); L >= Math.max(64, cap * 0.75); L -= 8) {
      const S = q(L * ratio), score = Math.abs(S / L - ratio) / ratio + (cap - L) / cap * 0.002;
      if (!best || score < best.score - 1e-9) best = { L, S, score };
    }
    best = best || { L: q(cap), S: q(cap * ratio) };
    return wide ? { w: best.L, h: best.S } : { w: best.S, h: best.L };
  };
  // autoSize : true = ajusté à la source (côté long <= 2048), 'exact' = taille exacte de la source (clic sur 📐)
  const shrinkBtn = (d, st) => { const b = h('button.fx-ebtn', { text: 'Réduire à ' + fitDoc(d).w + ' × ' + fitDoc(d).h, style: { width: 'auto', height: 'auto', marginLeft: '8px', padding: '2px 8px' } }); b.addEventListener('click', () => { st.autoSize = true; save(); rp(); }); return b; };
  const autoDims = (st, d) => st.autoSize === 'exact' ? { w: r8(d.width), h: r8(d.height) } : fitDoc(d);
  function i2iParams(st) {
    const step = cat.resStep || 16, d = i2iDoc, inpaint = INPAINT_MODES.includes(FX.i2iMode);
    if (st.autoSize && d) { const f = autoDims(st, d); st.width = f.w; st.height = f.h; st.scale_by = Math.round(f.w / d.width * 1000) / 1000; }
    const trans = [slider('Force (denoising)', st, 'denoising_strength', 0, 1, 0.01, 'Denoising strength : écart à l\'image de départ, bas = proche, haut = très différent'),
      radio('Redimensionnement', [[0, 'Étirer'], [1, 'Recadrer'], [2, 'Compléter'], [3, 'Étirer (latent)']], st, 'resize_mode', 'Resize mode : Just Resize, Crop and Resize, Resize and Fill, Just Resize (latent upscale)')];
    const inp = inpaint ? [
      slider('Flou du masque', st, 'mask_blur', 0, 64, 1, 'Mask blur'),
      radio('Zone refaite', [[0, 'Masquée'], [1, 'Non masquée']], st, 'inpainting_mask_invert', 'Mask mode : Inpaint masked / not masked'),
      radio('Départ', [[0, 'Remplissage'], [1, 'Original'], [2, 'Bruit latent'], [3, 'Latent vide']], st, 'inpainting_fill', 'Masked content : Original = repart de l\'image ; Remplissage = des couleurs voisines ; Bruit latent = du bruit (nouveau contenu)'),
      radio('Surface', [[0, 'Image entière'], [1, 'Zone seule']], st, 'inpaint_full_res', 'Inpaint area : Zone seule = la zone est recadrée et refaite en Largeur × Hauteur, puis recollée (plus de détails)'),
      slider('Marge autour de la zone (px)', st, 'inpaint_full_res_padding', 0, 256, 4, 'Only masked padding, pixels')] : [];
    const soft = inpaint ? acc('Soft inpainting', st, 'soft', () => [
        row2(slider('Biais', st.soft, 'bias', 0, 8, 0.1, 'Schedule bias'), slider('Préservation', st.soft, 'preserve', 0, 8, 0.05, 'Preservation strength')),
        row2(slider('Contraste de transition', st.soft, 'contrast', 1, 32, 0.5, 'Transition contrast boost'), slider('Influence du masque', st.soft, 'influence', 0, 1, 0.05, 'Mask influence')),
        row2(slider('Seuil de différence', st.soft, 'diffThr', 0, 8, 0.25, 'Difference threshold'), slider('Contraste de différence', st.soft, 'diffContrast', 0, 8, 0.25, 'Difference contrast'))], { on: [st.soft, 'enabled'], tip: 'Fond progressif entre la zone refaite et le reste' }) : null;
    const manual = () => { st.autoSize = false; save(); };
    const maxSz = Math.max(2048, d ? r8(Math.max(d.width, d.height)) : 0);
    const swap = ebtn('⇅', 'Inverser largeur et hauteur', () => { [st.width, st.height] = [st.height, st.width]; st.autoSize = false; save(); rp(); });
    const auto = ebtn('📐', 'Prendre la taille exacte de l’image source', () => { st.autoSize = 'exact'; save(); rp(); }, st.autoSize ? '.on' : '');
    const src = d ? { w: d.width, h: d.height } : null;
    const byText = v => { const w = r8(src.w * v), hh = r8(src.h * v); return `${src.w} × ${src.h} → ${w} × ${hh}` + (Math.max(w, hh) > 2048 ? ' — très grand pour la génération (mémoire, lenteur) : réduisez l’échelle' : ''); };
    const byInfo = h('div.fx-info', { text: src ? byText(st.scale_by) : 'Aucune image' });
    const sizeBody = st.sizeTab === 'by'
      ? h('div.fx-col', slider('Échelle', st, 'scale_by', 0.1, 4, 0.01, 'Resize by', v => { st.autoSize = false; if (src) byInfo.textContent = byText(v); }), byInfo,
        st.autoSize && src ? h('div.fx-info', { text: st.autoSize === 'exact' ? 'Échelle 1 : taille exacte de la source (📐).' : 'Échelle ajustée à la source : mêmes proportions, côté long <= 2048. Cliquez 📐 pour la taille exacte.' }) : null)
      : h('div.fx-col', slider('Largeur', st, 'width', 64, maxSz, step, 'Width', manual), slider('Hauteur', st, 'height', 64, maxSz, step, 'Height', manual),
        st.autoSize && d ? (st.autoSize === 'exact'
          ? h('div.fx-info', { text: `Taille exacte de la source (📐) : ${d.width} × ${d.height}` + (Math.max(st.width, st.height) > 2048 ? ' — très grand pour la génération (mémoire, lenteur). ' : '. ') }, shrinkBtn(d, st))
          : h('div.fx-info', { text: `Source ${d.width} × ${d.height} → ${st.width} × ${st.height} (mêmes proportions, côté long <= 2048). Cliquez 📐 pour la taille exacte.` })) : null);
    return h('div.fx-panel.fx-plain',
      sect(inpaint ? 'Retouche de zone' : 'Transformation', trans, inp),
      sect('Taille', tabs([['to', 'Taille'], ['by', 'Échelle']], st.sizeTab, v => { st.sizeTab = v; save(); rp(); }, '.fx-subtabs'),
        st.sizeTab === 'to' ? formatRow(st) : null,
        h('div.fx-dims', sizeBody, h('div.fx-col.fx-mid', swap, auto),
          h('div.fx-col', slider('Images par lot', st, 'batch_size', 1, 8, 1, 'Batch size'), slider('Lots', st, 'n_iter', 1, 128, 1, 'Batch count')))),
      sect('Échantillonnage', samplingRow(st),
        row2(slider('CFG', st, 'cfg_scale', 1, 24, 0.5, 'CFG Scale'), slider('Shift', st, 'distilled_cfg_scale', 0, 24, 0.5)), presetRow(st)),
      sect('Graine', seedRows(st, 'i2i')),
      kdAcc(st, 'i2i'), soft,
      acc('MultiDiffusion', st, 'md', () => [select('Méthode', ['MultiDiffusion', 'Mixture of Diffusers'], st.md, 'method'),
        row2(slider('Largeur de tuile', st.md, 'tw', 256, 2048, 64, 'Tile width'), slider('Hauteur de tuile', st.md, 'th', 256, 2048, 64, 'Tile height')),
        row2(slider('Chevauchement', st.md, 'overlap', 0, 1024, 16, 'Tile overlap'), slider('Tuiles par lot', st.md, 'batch', 1, 8, 1, 'Tile batch size'))], { on: [st.md, 'enabled'], tip: 'MultiDiffusion Integrated : génération par tuiles, pour les très grandes images' }),
      advAcc(st, 'i2i'));
  }

  /* ---------------------------------------------------------------- onglets Lora et Checkpoints */
  function toggleLora(c, l) {
    const st = FX[c.k], re = loraRe(l.name);
    if (re.test(st.prompt)) {
      st.prompt = st.prompt.replace(new RegExp('\\s*' + re.source + (l.trigger ? '\\s*' + esc(l.trigger) : ''), 'i'), '').replace(re, '').trim();
      if (l.negative) st.negative_prompt = st.negative_prompt.replace(new RegExp('(,\\s*)?' + esc(l.negative)), '').trim();
    } else {
      const w = +(l.weight || (cat && cat.defaultWeight) || 1);
      st.prompt = (st.prompt ? st.prompt.replace(/\s+$/, '') + ' ' : '') + `<lora:${l.name}:${w}>` + (l.trigger ? ' ' + l.trigger : '');
      if (l.negative && !st.negative_prompt.includes(l.negative)) st.negative_prompt = [st.negative_prompt, l.negative].filter(Boolean).join(', ');
    }
    save();
    if (c.negTa) c.negTa.value = st.negative_prompt;
    if (c.promptTa) { c.promptTa.value = st.prompt; c.promptTa.dispatchEvent(new Event('input')); }
  }
  function markLoras(c) {
    if (!c.left) return;
    const tab = c.left.querySelector('.fx-seg button:nth-child(2)'), n = (FX[c.k].prompt.match(/<lora:/g) || []).length;
    if (tab) tab.textContent = n ? 'LoRA · ' + n : 'LoRA';
    if (c._nLora !== n) { c._nLora = n; renderPills(c); if (POP && POP.id === 'lora') refreshPop(); }
    for (const el of c.left.querySelectorAll('.fx-card[data-lora]')) el.classList.toggle('on', loraRe(el.dataset.lora).test(FX[c.k].prompt));
  }
  function loraTab(c) {
    const L = FX.lora;
    const q = h('input.fx-in.fx-search', { type: 'search', placeholder: 'Rechercher un LoRA…', value: L.q, spellcheck: false });
    const sort = h('select.fx-sel.fx-sort', ...[['forge', 'Défaut de Forge'], ['new', 'Plus récentes d’abord'], ['old', 'Plus anciennes d’abord'], ['name', 'Nom (A→Z)']].map(([v, l]) => h('option', { value: v, text: l })));
    sort.value = L.sort;
    const refresh = ebtn('🔄', 'Relire la liste des LoRA', async () => { await N.forgeRefreshLoras(url()); await loadCat(); });
    const folders = [...new Set(cat.loras.map(l => l.rel).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const chips = h('div.fx-folders');
    const grid = h('div.fx-cards');
    const fill = () => {
      const term = L.q.trim().toLowerCase();
      let list = cat.loras.filter(l => !term || (l.rel + '\\' + l.name + ' ' + (l.alias || '') + ' ' + (l.trigger || '') + ' ' + (l.description || '')).toLowerCase().includes(term));
      if (L.sort === 'new') list = list.slice().sort((a, b) => b.mtime - a.mtime);
      else if (L.sort === 'old') list = list.slice().sort((a, b) => a.mtime - b.mtime);
      else if (L.sort === 'name') list = list.slice().sort((a, b) => a.name.localeCompare(b.name));
      grid.replaceChildren(...list.map(l => {
        const edit = h('button.fx-card-edit', { text: '🛠️', title: 'Modifier la fiche (comme le bouton 🛠 de Forge)' });
        edit.addEventListener('click', e => { e.stopPropagation(); editLora(l); });
        const card = h('div.fx-card' + (loraRe(l.name).test(FX[c.k].prompt) ? '.on' : ''), { 'data-lora': l.name, title: l.name + (l.description ? '\n' + l.description : '') + (l.trigger ? '\nActivation text : ' + l.trigger : '') + '\nPreferred weight : ' + (l.weight || 1) + (l.rel ? '\n' + l.rel + '\\' : '') },
          l.url ? h('img', { src: l.url, alt: '', loading: 'lazy' }) : h('div.fx-nopv', { text: 'NO PREVIEW' }), edit, h('div.fx-card-n', { text: l.alias || l.name }));
        card.addEventListener('click', () => toggleLora(c, l));
        return card;
      }));
      if (!list.length) grid.appendChild(h('div.fx-note', { text: cat.loras.length ? 'Aucun LoRA ne correspond.' : 'Aucun LoRA dans Forge.' }));
      chips.replaceChildren(...['', ...folders].map(f => {
        const b = h('button.fx-chip' + ((f === '' ? !term : term === f.toLowerCase()) ? '.on' : ''), { text: f ? f + '\\' : 'Tous' });
        b.addEventListener('click', () => { L.q = f; q.value = f; save(); fill(); }); return b;
      }));
    };
    q.addEventListener('input', () => { L.q = q.value; save(); fill(); });
    sort.addEventListener('change', () => { L.sort = sort.value; save(); fill(); });
    fill();
    return h('div.fx-panel', h('div.fx-lorabar', q, sort, refresh), chips, grid,
      h('div.fx-info', { text: 'Clic sur une carte : ajoute <lora:nom:poids préféré> et son activation text (recliquez pour l\'enlever). 🛠️ : modifier la fiche. Dans l\'invite, Ctrl+↑ / Ctrl+↓ change le poids.' }));
  }
  // Fiche d'un LoRA : les mêmes champs que « Edit user metadata » de Forge, écrits dans le même <lora>.json
  async function editLora(l) {
    const f = { description: l.description || '', sdVersion: l.sdVersion || 'Unknown', trigger: l.trigger || '', weight: +(l.weight || 1), negative: l.negative || '', notes: l.notes || '' };
    let preview = null;
    const pv = h('div.fx-lpv', l.url ? h('img', { src: l.url, alt: '' }) : h('div.fx-nopv', { text: 'NO PREVIEW' }));
    const setPv = async c => { preview = await pngBytes(c); pv.replaceChildren(h('img', { src: c.toDataURL('image/png'), alt: '' })); };
    const it = selItem('t2i');
    const pvBtns = h('div.fx-outbtns',
      tbtn('Image sélectionnée dans Créer', () => it ? setPv(it.canvas) : KS.toast('Aucune image générée', 'info'), '', 'Comme « Replace preview » de Forge'),
      tbtn('Image du document', () => D() ? setPv(D().composite()) : KS.toast('Aucun document ouvert', 'info')),
      tbtn('Choisir…', async () => { const files = await N.openDialog({ title: 'Aperçu du LoRA', multi: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }); if (files && files[0]) setPv(await KS.io.canvasFromEntry(files[0])); }));
    const body = h('div.fx.fx-meta',
      h('div.fx-meta-top', pv, h('div.fx-col', h('div.fx-h', { text: l.alias || l.name }), h('div.fx-info', { text: (l.rel ? l.rel + '\\' : '') + l.name + (l.base ? ' · ' + l.base : '') }), pvBtns)),
      text('Description', f, 'description', { rows: 2 }),
      row2(select('Stable Diffusion version', ['SD1', 'SDXL', 'Flux', 'Unknown'], f, 'sdVersion'), slider('Preferred weight', f, 'weight', 0, 2, 0.01, 'Poids mis dans <lora:…> au clic sur la carte')),
      text('Activation text', f, 'trigger', { rows: 2, tip: 'Ajouté à l\'invite avec le LoRA (mot déclencheur)' }),
      text('Negative prompt', f, 'negative', { rows: 2, tip: 'Ajouté à l\'invite négative avec le LoRA' }),
      text('Notes', f, 'notes', { rows: 3 }));
    const ok = await new Promise(res => KS.modal({ title: 'Fiche du LoRA', width: 640, body, onClose: res, buttons: [{ label: 'Annuler', value: null }, { label: 'Save', primary: true, value: 'ok' }] }));
    if (ok !== 'ok') return;
    const r = await N.loraMetaWrite(l.name, f, preview);
    if (!r.ok) return KS.toast('Fiche non enregistrée : ' + r.error, 'err', 6000);
    Object.assign(l, { description: f.description, sdVersion: f.sdVersion, trigger: f.trigger.trim(), weight: f.weight, negative: f.negative, notes: f.notes });
    if (preview) { if (l.url) URL.revokeObjectURL(l.url); l.url = URL.createObjectURL(new Blob([preview], { type: 'image/png' })); }
    KS.toast('Fiche de « ' + (l.alias || l.name) + ' » enregistrée (aussi pour Forge)', 'ok');
    renderParams(); for (const c of [CTX.t2i, CTX.i2i]) renderChips(c);
  }
  function ckptTab() {
    const grid = h('div.fx-cards');
    for (const m of cat.models) {
      const on = norm(m.title) === norm(cat.current.model);
      const card = h('div.fx-card' + (on ? '.on' : ''), { title: m.title }, m.url ? h('img', { src: m.url, alt: '' }) : h('div.fx-nopv', { text: 'NO PREVIEW' }), h('div.fx-card-n', { text: norm(m.title) }));
      card.addEventListener('click', () => setOptions({ sd_model_checkpoint: m.title }, 'Checkpoint : ' + norm(m.title) + ' (chargé à la prochaine génération)'));
      grid.appendChild(card);
    }
    return h('div.fx-panel', grid);
  }

  /* ---------------------------------------------------------------- source img2img et outils du Studio */
  const I2I_MODES = [['img2img', 'img2img'], ['sketch', 'Sketch'], ['inpaint', 'Inpaint'], ['inpaint_sketch', 'Inpaint sketch'], ['inpaint_upload', 'Inpaint upload'], ['batch', 'Batch']];
  const I2I_HELP = {
    img2img: 'Toute l\'image (les calques visibles du document) est refaite selon l\'invite. La force règle l\'écart à l\'original.',
    sketch: 'Peignez des formes et des couleurs sur le calque « Croquis IA » : l\'image, croquis compris, est refaite selon l\'invite.',
    inpaint: 'Peignez en rouge sur le calque « Zone IA » ce qui doit changer (ou faites une sélection), décrivez le résultat, Generate : le reste ne bouge pas.',
    inpaint_sketch: 'Peignez en couleur ce qui doit changer : seule la partie peinte est refaite, en partant de vos couleurs.',
    inpaint_upload: 'Chargez un masque noir et blanc (blanc = à refaire) : il remplit le calque « Zone IA ».',
    batch: 'Chaque image choisie passe dans img2img avec ces réglages ; les résultats vont dans output\\img2img-images de Forge.',
  };
  const roleLayer = (d, role) => d && d.layers.find(l => l.aiRole === role || (!l.aiRole && l.name === (role === 'zone' ? 'Zone IA' : 'Croquis IA')));
  const ensureRoleLayer = (d, role) => {
    let L = roleLayer(d, role);
    if (L) { L.aiRole = role; if (!L.visible) { L.visible = true; L.touch(); d.changed(); KS.emit('layers', d); } return L; }
    L = new KS.Layer({ name: role === 'zone' ? 'Zone IA' : 'Croquis IA', w: d.width, h: d.height, opacity: role === 'zone' ? 0.55 : 1 });
    L.aiRole = role;
    KS.Hist.structure(d, role === 'zone' ? 'Calque Zone IA' : 'Calque Croquis IA', () => d.addLayer(L, d.layers.length), role === 'zone' ? 'brush' : 'pencil');
    return L;
  };
  const layerAlpha = (d, L) => { const c = U.canvas(d.width, d.height); c.getContext('2d').drawImage(L.canvas, L.x, L.y); return c; };
  const sourceFor = (d, keepSketch) => {
    const zone = roleLayer(d, 'zone'), sketch = roleLayer(d, 'sketch');
    return d.flatten(d.layers.filter(l => l !== zone && (keepSketch || l !== sketch) && l.visible !== false));
  };
  const clearRole = (role, d = D()) => {
    const L = roleLayer(d, role); if (!L) return;
    const tok = KS.Hist.begin(L); L.ctx.clearRect(0, 0, L.canvas.width, L.canvas.height); L.touch();
    KS.Hist.commitPixels(d, role === 'zone' ? 'Effacer la zone IA' : 'Effacer le croquis', tok, null, 'trash'); d.changed();
  };
  const paintZone = (d, drawFn, label, icon) => {
    const L = ensureRoleLayer(d, 'zone'); L.ensureCovers(d.rect);
    const tok = KS.Hist.begin(L);
    drawFn(L);
    L.touch(); KS.Hist.commitPixels(d, label, tok, null, icon); d.changed();
  };
  const invertZone = (d = D()) => {
    if (!d) return;
    paintZone(d, L => {
      const c = U.canvas(L.canvas.width, L.canvas.height), x = c.getContext('2d');
      x.fillStyle = 'rgb(255,32,64)'; x.fillRect(0, 0, c.width, c.height); x.globalCompositeOperation = 'destination-out'; x.drawImage(L.canvas, 0, 0);
      L.ctx.clearRect(0, 0, c.width, c.height); L.ctx.drawImage(c, 0, 0);
    }, 'Inverser la zone IA', 'select-invert');
  };
  const selectionToZone = (d = D()) => {
    if (!d || !d.selection.active) return KS.toast('Faites d\'abord une sélection', 'info');
    paintZone(d, L => {
      const t = U.canvas(d.width, d.height), x = t.getContext('2d');
      x.drawImage(d.selection.mask, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = 'rgb(255,32,64)'; x.fillRect(0, 0, d.width, d.height);
      L.ctx.drawImage(t, -L.x, -L.y);
    }, 'Sélection → zone IA', 'brush');
  };
  async function uploadMask(d = i2iDoc) {
    if (!d) return KS.toast('Choisissez d’abord une image source', 'info');
    const files = await N.openDialog({ title: 'Masque (blanc = à refaire)', multi: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }] });
    if (!files || !files[0]) return;
    const m = await KS.io.canvasFromEntry(files[0]);
    const t = scaled(m, d.width, d.height), x = t.getContext('2d'), id = x.getImageData(0, 0, d.width, d.height), p = id.data;
    for (let i = 0; i < p.length; i += 4) { const lum = (p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11) * p[i + 3] / 255; p[i] = 255; p[i + 1] = 32; p[i + 2] = 64; p[i + 3] = lum > 127 ? 255 : 0; }
    x.putImageData(id, 0, 0);
    paintZone(d, L => { L.ctx.clearRect(0, 0, L.canvas.width, L.canvas.height); L.ctx.drawImage(t, -L.x, -L.y); }, 'Masque chargé', 'mask');
  }
  async function pickBatch() {
    const files = await N.openDialog({ title: 'Images à traiter', multi: true, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }] });
    if (!files || !files.length) return;
    OUT.batch = [];
    for (const f of files) OUT.batch.push({ name: f.name, canvas: await KS.io.canvasFromEntry(f) });
    renderModeTools();
  }
  function renderModeTools() {
    const c = CTX.i2i, box = c.modes; if (!box) return;
    const d = i2iDoc, m = FX.i2iMode;
    const modes = tabs(I2I_MODES, m, v => { FX.i2iMode = v; save(); render(); }, '.fx-modes');
    const tools = [];
    const sourceAction = fn => { if (!d) return KS.toast('Choisissez d’abord une image source', 'info'); CTX.i2i.finishStroke && CTX.i2i.finishStroke(); fn(d); CTX.i2i.paintDraw && CTX.i2i.paintDraw(); };
    if (m !== 'img2img' && m !== 'batch') {
      const sketch = m === 'sketch' || m === 'inpaint_sketch', role = sketch ? 'sketch' : 'zone';
      tools.push(tbtn(sketch ? 'Pinceau' : 'Peindre le masque', () => { FX.painter.erase = false; save(); renderModeTools(); }, FX.painter.erase ? '.sm' : '.primary.sm'),
        tbtn('Gomme', () => { FX.painter.erase = true; save(); renderModeTools(); }, FX.painter.erase ? '.primary.sm' : '.sm'),
        slider('Taille du pinceau (px)', FX.painter, 'size', 1, 512, 1),
        sketch ? ui.colorChip(FX.painter.color, hex => { FX.painter.color = hex; save(); }, 'Couleur du croquis') : null,
        tbtn('Annuler', () => sourceAction(() => d.history.undo()), '.sm'), tbtn('Rétablir', () => sourceAction(() => d.history.redo()), '.sm'),
        tbtn(sketch ? 'Effacer le croquis' : 'Effacer', () => sourceAction(() => clearRole(role, d)), '.sm'));
      if (!sketch) tools.push(tbtn('Inverser', () => sourceAction(() => invertZone(d)), '.sm'),
        d && d.selection.active ? tbtn('Sélection → masque', () => sourceAction(() => selectionToZone(d)), '.sm') : null);
      if (m === 'inpaint_upload') tools.push(tbtn('Charger un masque…', async () => { await uploadMask(d); CTX.i2i.paintDraw && CTX.i2i.paintDraw(); }, '.primary.sm'));
    }
    if (m === 'batch') tools.push(tbtn('Choisir des images…', pickBatch, '.primary.sm'), h('span.fx-info', { text: OUT.batch.length ? OUT.batch.length + ' image(s)' : 'Aucune image choisie' }),
      OUT.batch.length ? tbtn('Vider', () => { OUT.batch = []; renderModeTools(); }, '.sm') : null);
    const help = (m === 'batch' ? '' : d ? `Image : ${d.name} (${d.width} × ${d.height}). ` : 'Aucune image ouverte. ') + I2I_HELP[m];
    fillEl(box, modes, tools.length ? h('div.fx-i2itools', ...tools.filter(Boolean)) : null, h('div.fx-help', { text: I2I_HELP[m], title: help }));
  }
  function sendMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    ui.menu([
      { head: 'Envoyer une copie du document' },
      { label: 'Envoyer vers Img2Img — transformer l’image', icon: 'image', action: () => C.sendToStudio('img2img') },
      { label: 'Envoyer vers Inpaint — retoucher une zone', icon: 'brush', action: () => C.sendToStudio('inpaint') },
      { label: 'Agrandir (onglet Agrandir)', icon: 'upscale', action: () => C.sendToStudio('extras') },
      { label: 'Lire les paramètres dans PNG Info', icon: 'info', action: () => C.sendToStudio('pnginfo') },
      { label: 'Agrandir avec le hires fix (Créer)', icon: 'file-plus', action: () => C.sendToStudio('txt2img') },
      { label: 'Réutiliser les réglages dans Créer', icon: 'history', action: () => C.sendToStudio('params'), disabled: !(D() && (D().genInfo || D().genParams)) },
    ], r.left, r.bottom + 4);
  }

  /* ---------------------------------------------------------------- sorties (galerie de Forge) */
  async function toItems(r, kind, p) {
    let info = {};
    try { info = r.info ? (typeof r.info === 'string' ? JSON.parse(r.info) : r.info) : {}; } catch { /* rien */ }
    const infos = info.infotexts || [];
    // grille en tête : celle des scripts (X/Y/Z, Prompt matrix) ou celle de Forge dès qu'il y a plusieurs images
    const n = p ? (+p.batch_size || 1) * (+p.n_iter || 1) : 0, count = (r.images || []).length;
    const grids = n && count > n ? count - n : p && /x\/y\/z plot|prompt matrix/.test(p.script_name || '') ? 1 : 0;
    const items = [];
    for (let i = 0; i < count; i++) {
      const bytes = r.images[i], canvas = await fromPng(bytes);
      items.push({ canvas, bytes, url: URL.createObjectURL(new Blob([bytes], { type: 'image/png' })), info: infos[i] || infos[infos.length - 1] || '', kind, grid: i < grids && count > 1 });
    }
    if (info.seed != null) lastSeed[kind === 'img2img' ? 'i2i' : 't2i'] = info.seed;
    // Kane Detailer : l'image des zones vraiment repeintes, gardée par l'extension pour chaque graine
    const kdArgs = p && p.alwayson_scripts && p.alwayson_scripts['Kane Detailer'];
    if (kdArgs && N && N.forgeKaneZones) {
      const seeds = info.all_seeds || (info.seed != null ? [info.seed] : []);
      for (let i = grids; i < items.length; i++) {
        const seed = seeds[i - grids] ?? seeds[0];
        if (seed == null) continue;
        try { const z = await N.forgeKaneZones(url(), seed); if (z.ok) items[i].kdZones = z.zones; } catch { /* pas de zones */ }
      }
    }
    return items;
  }
  const releaseItems = o => { for (const it of o.items || []) if (it.url) URL.revokeObjectURL(it.url); };
  // Galerie de la séance : le PNG compressé et une vignette, pas l'image décodée (60 images 1856 × 1024 décodées
  // tenaient environ 1 Go de mémoire graphique, prise au moteur). L'image n'est décodée qu'au moment de s'en servir.
  function pushGallery(items) {
    if (KS.suite) KS.suite.collect(items).catch(() => {});
    for (const it of items) {
      const c = it.canvas, k = 220 / Math.max(c.width, c.height);
      const t = U.canvas(Math.max(1, Math.round(c.width * k)), Math.max(1, Math.round(c.height * k)));
      t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
      const g = { id: U.uid(), w: c.width, h: c.height, blob: it.bytes ? new Blob([it.bytes], { type: 'image/png' }) : null, canvas: null,
        info: it.info, params: it.params, seed: it.seed, kind: it.kind, from: it.from, time: Date.now(), thumb: t.toDataURL('image/jpeg', 0.82) };
      if (!g.blob) { g.canvas = c; U.blobFromCanvas(c).then(b => { if (b) { g.blob = b; g.canvas = null; } }); }
      SD.gallery.unshift(g); it.gid = g.id;
    }
    if (SD.gallery.length > 120) SD.gallery.length = 120;
    renderGallery();
    renderFilm();
  }
  // image de la galerie, décodée pour l'action demandée
  const galleryItem = async g => ({ ...g, canvas: g.canvas || await U.canvasFromBlob(g.blob) });
  const galleryMedia = g => {
    if (g.canvas) return { canvas: g.canvas, w: g.w, h: g.h };
    const src = URL.createObjectURL(g.blob);
    return { src, w: g.w, h: g.h, release: () => URL.revokeObjectURL(src) };
  };
  /* ---------------------------------------------------------------- comparer deux images */
  let cmpPick = null;   // image de la galerie choisie en premier
  const infoModel = info => (/\bModel: ([^,\n]+)/.exec(info || '') || [])[1] || '';
  // nom d'un checkpoint sans dossier, extension ni empreinte : « anima_aestheticV11 » (infotexte) = « anima_aestheticV11.safetensors [3c18…] » (catalogue)
  const ckptStem = t => base(norm(t)).replace(/\.(safetensors|ckpt|gguf|pt|bin)$/i, '').toLowerCase();
  const cmpLabel = (it, fallback) => [it.from === 'Kane Detailer' ? 'Kane Detailer' : '', infoModel(it.info), it.seed != null ? 'graine ' + it.seed : ''].filter(Boolean).join(' · ') || fallback;
  const itemMedia = it => it.canvas ? { canvas: it.canvas, w: it.canvas.width, h: it.canvas.height } : galleryMedia(it);
  const compareItems = (a, b, title = 'Comparer') => KS.preview.compare({ ...itemMedia(a), label: cmpLabel(a, 'A') }, { ...itemMedia(b), label: cmpLabel(b, 'B') }, { title });
  const compareGallery = (a, b) => compareItems(a, b, 'Comparer deux images de la galerie');
  // résultat refait (Kane Detailer, autre modèle) : comparé à l'image d'origine
  const compareBefore = it => it && it.before && compareItems(it.before, it, it.from === 'Kane Detailer' ? 'Avant / après Kane Detailer' : 'Comparer les modèles');
  const selItem = key => { const o = OUT[key]; return o.items[o.sel] || null; };
  const docName = it => (it.info || 'Image IA').split('\n')[0].replace(/<[^>]+>|[\\/:*?"<>|]/g, '').trim().slice(0, 40) || 'Image IA';
  const itemDoc = it => {
    const d = new KS.Doc({ name: it.name || docName(it), width: it.canvas.width, height: it.canvas.height });
    d.addLayer(new KS.Layer({ name: 'Image IA', canvas: U.copyCanvas(it.canvas) }), 0);
    d.genInfo = it.info || ''; d.genParams = it.params ? clone(it.params) : null; d.dirty = false; return d;
  };
  const snapshotSource = d => {
    const copy = itemDoc({ canvas: sourceFor(d, false), name: d.name, info: d.genInfo, params: d.genParams });
    for (const role of ['zone', 'sketch']) {
      const L = roleLayer(d, role); if (!L) continue;
      const layer = new KS.Layer({ name: L.name, canvas: U.copyCanvas(L.canvas), x: L.x, y: L.y, opacity: L.opacity, visible: L.visible });
      layer.aiRole = role; copy.addLayer(layer, copy.layers.length);
    }
    copy.selection.mask = d.selection.snapshot(); copy.selection.refresh();
    copy.dirty = false; return copy;
  };
  const openItem = it => KS.addDoc(itemDoc(it));
  const addAsLayer = async it => {
    const d = D(); if (!d) return KS.toast('Aucun document ouvert', 'info');
    KS.io.placeCanvas(d, it.canvas.width === d.width && it.canvas.height === d.height ? U.copyCanvas(it.canvas) : scaled(it.canvas, d.width, d.height), 'Image IA', { x: 0, y: 0 });
    await C.toggleStudio(false);
    KS.toast('Ajoutée en calque à « ' + d.name + ' »', 'ok', 1500);
  };
  async function saveItem(it) {
    if (!it) return;
    const p = await N.saveDialog({ title: 'Enregistrer l\'image', defaultPath: docName(it).replace(/[^\w\- ]+/g, '').slice(0, 40) + '.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (p) { await N.writeFile(p, it.bytes || await pngBytes(it.canvas)); KS.toast('Enregistrée', 'ok', 1200); }
  }
  async function saveAll(items) {
    if (!items.length) return;
    const t = Date.now();
    const r = await N.saveFiles('Dossier où enregistrer les images', await Promise.all(items.map(async (it, i) => ({ name: `kanevas-${t}-${i}.png`, data: it.bytes || await pngBytes(it.canvas) }))));
    if (r && r.ok) KS.toast(r.written.length + ' image(s) enregistrée(s)', 'ok');
  }
  // « Send to » de Forge : l'image et ses paramètres passent à un autre onglet
  // st : réglages à remplir (par défaut ceux de l'onglet, enregistrés)
  function applyInfoTo(k, textInfo, { size = true, st = FX[k] } = {}) {
    if (!textInfo) return;
    const I = KS.png.parseInfo(textInfo), P = I.params;
    st.prompt = I.prompt; st.negative_prompt = I.negative;
    if (P.Steps) st.steps = +P.Steps;
    if (P.Sampler) st.sampler_name = P.Sampler;
    if (P['Schedule type']) st.scheduler = P['Schedule type'];
    if (P['CFG scale']) st.cfg_scale = +P['CFG scale'];
    const sh = P['Distilled CFG Scale'] || P.Shift; if (sh) st.distilled_cfg_scale = +sh;
    st.seed = -1; st.subseed = -1;
    if (P['Variation seed']) { st.seedExtra = true; st.subseed_strength = +(P['Variation seed strength'] || 0); }
    if (size && P.Size) { const [w, hh] = P.Size.split('x').map(Number); if (w && hh) { st.width = w; st.height = hh; if ('autoSize' in st) st.autoSize = false; } }
    if (k === 't2i') {
      if (P['Hires upscale']) { st.enable_hr = true; st.hr_scale = +P['Hires upscale']; if (P['Denoising strength']) st.denoising_strength = +P['Denoising strength']; }
      if (P['Hires upscaler']) st.hr_upscaler = P['Hires upscaler'];
      if (P['Hires steps']) st.hr_second_pass_steps = +P['Hires steps'];
    } else if (P['Denoising strength']) st.denoising_strength = +P['Denoising strength'];
    if (st === FX[k]) save();
  }
  // Réglages repris d'un onglet à l'autre (comme « Send to img2img » de Forge) : l'invite telle qu'elle a été
  // tapée (français, balises <lora:…>), l'invite négative, les styles, l'échantillonnage, la graine
  const SHARED = ['prompt', 'negative_prompt', 'styles', 'sampler_name', 'scheduler', 'steps', 'cfg_scale', 'distilled_cfg_scale',
    'seed', 'seedExtra', 'subseed', 'subseed_strength', 'seed_resize_from_w', 'seed_resize_from_h', 'noom'];
  const snapParams = st => clone(Object.fromEntries(SHARED.map(k => [k, st[k]])));
  function paramsTo(k, it) {
    if (it.params) {
      const st = FX[k], src = clone(it.params);
      for (const key of SHARED) if (key !== 'seed' && key !== 'subseed' && src[key] !== undefined) st[key] = src[key];
      st.seed = -1; st.subseed = -1;
      save();
    } else applyInfoTo(k, it.info, { size: false });
  }
  async function toEdition(it) {
    openItem(it);
    await C.toggleStudio(false);
  }
  function sendTo(target, it) {
    if (!it) return KS.toast('Aucune image', 'info');
    if (target === 'extras') { OUT.exSrc = { canvas: it.canvas, name: docName(it) }; FX.tab = 'extras'; save(); return C.toggleStudio(true).then(render); }
    if (target === 'txt2img') { paramsTo('t2i', it); FX.tab = 'txt2img'; save(); return C.toggleStudio(true).then(render); }
    if (target === 'edit') return toEdition(it);
    i2iDoc = itemDoc(it);
    if (it.info || it.params) paramsTo('i2i', it);
    FX.i2i.autoSize = true; FX.i2iMode = target === 'inpaint' ? 'inpaint' : 'img2img'; FX.tab = 'img2img'; save();
    return C.toggleStudio(true).then(render);
  }
  // Depuis l'Édition : le document tel qu'il est, renvoyé au Studio
  C.sendToStudio = async (target = 'img2img') => {
    const d = D(); if (!d) return KS.toast('Aucun document ouvert', 'info');
    const canvas = d.composite();
    if (target === 'img2img' || target === 'inpaint') {
      i2iDoc = snapshotSource(d);
      if (d.genInfo || d.genParams) paramsTo('i2i', { params: d.genParams, info: d.genInfo });
      FX.i2i.autoSize = true; FX.i2iMode = target; FX.tab = 'img2img';
    }
    else if (target === 'params') {
      if (!d.genInfo && !d.genParams) return KS.toast('Ce document n\'a pas de paramètres de génération', 'info');
      paramsTo('t2i', { params: d.genParams, info: d.genInfo }); FX.tab = 'txt2img';
    }
    else if (target === 'extras') { OUT.exSrc = { canvas, name: d.name }; FX.tab = 'extras'; }
    else if (target === 'pnginfo') { OUT.png = { canvas, name: d.name, text: d.genInfo || '', chunks: d.genInfo ? { parameters: d.genInfo } : {} }; FX.tab = 'pnginfo'; }
    else {
      let bytes = await pngBytes(canvas);
      if (d.genInfo) bytes = KS.png.writeText(bytes, 'parameters', d.genInfo);
      OUT.t2i.items.unshift({ canvas, bytes, url: URL.createObjectURL(new Blob([bytes], { type: 'image/png' })), info: d.genInfo || '', kind: 'kanevas', from: d.name });
      OUT.t2i.sel = 0; FX.tab = 'txt2img';
    }
    save();
    await C.toggleStudio(true);
    render();
    KS.toast('« ' + d.name + ' » envoyé au Studio IA', 'ok', 1800);
  };
  function readParams(k) {
    const st = FX[k];
    if (/\bSteps: \d+/.test(st.prompt)) { applyInfoTo(k, st.prompt); render(); return KS.toast('Paramètres lus depuis l\'invite', 'ok', 1500); }
    const it = selItem(k) || OUT[k].items[0] || (k === 'i2i' && i2iDoc && i2iDoc.genInfo ? { info: i2iDoc.genInfo } : null);
    if (!it || !it.info) return KS.toast('Aucune génération encore', 'info');
    applyInfoTo(k, it.info, { size: k === 't2i' }); render();
    KS.toast('Paramètres repris', 'ok', 1500);
  }
  // « Détailler » : Kane Detailer sur un résultat déjà fait (invite et réglages repris de l'image quand ils y sont)
  let detailing = false;
  async function detailItem(key, it) {
    if (!it) return;
    if (!N || !N.forgeKaneDetail || !(cat && cat.kdInfo)) return KS.toast('Kane Detailer n’est pas dans ce moteur : mettez Kane OS à jour puis redémarrez le moteur du Studio.', 'err', 5000);
    if (BUSY || PREPARING || detailing) return KS.toast('Attendez la fin de la génération en cours.', 'info', 2500);
    const st = FX[key === 'i2i' ? 'i2i' : 't2i'];
    const parts = st.kd.parts.length ? st.kd.parts : (cat.kdInfo.presets['Corps entier'] || []);
    const info = it.info || '', neg = info.indexOf('\nNegative prompt:'), steps = info.indexOf('\nSteps:');
    const prompt = info ? info.slice(0, neg >= 0 ? neg : steps >= 0 ? steps : info.length).trim() : await english(st.prompt);
    const negative = info && neg >= 0 ? info.slice(neg + 17, steps > neg ? steps : info.length).trim() : await english(st.negative_prompt);
    const payload = { parts, forces: { ...st.kd.forces }, keep: +st.kd.keep, resolution: +st.kd.resolution, detail: +st.kd.detail || 0, upscale: +st.kd.upscale || 1, tries: +st.kd.tries || 1, repair: !!st.kd.repair, grain: +st.kd.grain || 0, glow: !!st.kd.glow, age: !!st.kd.age, autotag: st.kd.autotag !== false, soft: st.kd.soft !== false, wd: st.kd.wd !== false, prompt, negative_prompt: negative, seed: -1,
      sampler_name: st.sampler_name, scheduler: st.scheduler, steps: +st.steps, cfg_scale: +st.cfg_scale, distilled_cfg_scale: +st.distilled_cfg_scale };
    detailing = true;
    KS.toast('Kane Detailer : ' + parts.length + ' partie(s) en cours…', 'info', 4000);
    try {
      const r = await N.forgeKaneDetail(url(), payload, it.bytes || await pngBytes(it.canvas));
      if (!r.ok) throw new Error(r.error);
      const canvas = await fromPng(r.image);
      const item = { canvas, bytes: r.image, url: URL.createObjectURL(new Blob([r.image], { type: 'image/png' })), info: (info ? info + '\n' : '') + r.info, kind: it.kind || 'txt2img', from: 'Kane Detailer', kdZones: r.zones || null,
        seed: it.seed, params: it.params, before: { canvas: it.canvas, info: it.info, seed: it.seed, from: it.from } };
      const o = OUT[key] || OUT.t2i; o.items.unshift(item); o.sel = 0; pushGallery([item]); renderOut(key in OUT ? key : 't2i');
      KS.toast(r.info, 'ok', 4000);
    } catch (e) { KS.toast('Kane Detailer : ' + e.message, 'err', 6000); }
    finally { detailing = false; }
  }
  // « Voir les zones » : ce que Kane Detailer repeindrait (parties cochées), sans rien générer
  async function detectItem(key, it) {
    if (!it) return;
    if (!N || !N.forgeKaneDetect || !(cat && cat.kdInfo)) return KS.toast('Kane Detailer n’est pas dans ce moteur : mettez Kane OS à jour puis redémarrez le moteur du Studio.', 'err', 5000);
    const st = FX[key === 'i2i' ? 'i2i' : 't2i'];
    const parts = st.kd.parts.length ? st.kd.parts : (cat.kdInfo.presets['Corps entier'] || []);
    try {
      const r = await N.forgeKaneDetect(url(), { parts }, it.bytes || await pngBytes(it.canvas));
      if (!r.ok) throw new Error(r.error);
      const canvas = await fromPng(r.preview), labels = {};
      for (const z of r.regions) labels[z.part] = (labels[z.part] || 0) + 1;
      const names = Object.fromEntries(cat.kdInfo.parts.map(x => [x.key, x.label]));
      KS.preview.open(canvas, canvas.width, canvas.height, { title: 'Zones Kane Detailer : ' + (Object.entries(labels).map(([k2, n]) => names[k2] + ' ×' + n).join(', ') || 'rien trouvé') });
    } catch (e) { KS.toast('Kane Detailer : ' + e.message, 'err', 6000); }
  }
  // Même invite, mêmes réglages et même graine avec un autre modèle, puis comparaison côte à côte.
  // Le modèle n'est changé que pour cette image (override_settings) : le modèle choisi dans le Studio reste le même.
  function pickModel(exclude) {
    const grid = h('div.fx-cards.fx-pickmodel');
    const modal = KS.modal({ title: 'Refaire avec un autre modèle', width: 760, buttons: [{ label: 'Annuler', value: null }],
      body: h('div.fx-pick', h('p.fx-info', { text: 'La même image est refaite avec le modèle choisi : même invite, mêmes réglages, même graine. Le modèle est chargé pour cette image seulement ; comptez le temps de chargement des deux modèles.' }), grid) });
    for (const m of cat.models) {
      if (ckptStem(m.title) === ckptStem(exclude)) continue;
      const card = h('button.fx-card', { type: 'button', title: m.title }, m.url ? h('img', { src: m.url, alt: '' }) : h('div.fx-nopv', { text: 'NO PREVIEW' }), h('div.fx-card-n', { text: norm(m.title) }));
      card.addEventListener('click', () => modal.close(m));
      grid.appendChild(card);
    }
    if (!grid.children.length) grid.replaceWith(h('div.fx-note', { text: 'Aucun autre modèle dans models/Stable-diffusion.' }));
    return modal.done;
  }
  async function remakeWithModel(it) {
    if (!it || BUSY || PREPARING || detailing) return;
    const seed = it.seed ?? +((/\bSeed: (\d+)/.exec(it.info || '') || [])[1]);
    if (!it.info || !Number.isFinite(seed)) return KS.toast('Cette image n’a pas ses paramètres de génération : impossible de la refaire à l’identique.', 'info', 4000);
    if (!(await ensureCat())) return;
    const was = infoModel(it.info) || norm(cat.current.model);
    const model = await pickModel(was);
    if (!model) return;
    const prep = PREPARING = { k: 't2i', canceled: false }; renderGenButtons();
    try {
      if (await trainingRuns() || prep.canceled) return;
      // réglages de l'image (infotexte), pas ceux affichés : taille, échantillonnage, hires ; détailleurs actuels du Studio
      const st = { ...clone(FX.t2i), enable_hr: false, n_iter: 1, batch_size: 1, script: 'None' };
      if (it.params) Object.assign(st, clone(it.params));
      applyInfoTo('t2i', it.info, { st });
      const P = KS.png.parseInfo(it.info).params;
      const p = await payloadFor('t2i', st);
      if (prep.canceled) return;
      p.seed = seed;
      if (P['Variation seed']) p.subseed = +P['Variation seed'];
      p.override_settings = { ...p.override_settings, sd_model_checkpoint: model.title };
      const r = await runForge('t2i', () => N.forgeTxt2img(url(), p));
      if (!r.ok) throw new Error(r.error);
      const res = (await toItems(r, 'txt2img', p)).filter(x => !x.grid)[0];
      if (!res) throw new Error('Forge n\'a renvoyé aucune image (génération interrompue ?)');
      res.params = snapParams(st); res.seed = seed;
      res.before = { canvas: it.canvas, info: it.info, seed, from: it.from };
      OUT.t2i.items.unshift(res); OUT.t2i.sel = 0; FX.tab = 'txt2img';
      render(); pushGallery([res]);
      compareBefore(res);
    } catch (e) { KS.toast('Comparaison impossible : ' + e.message, 'err', 7000); }
    finally { if (PREPARING === prep) PREPARING = null; renderGenButtons(); }
  }
  async function showZones(it) {
    if (!it || !it.kdZones) return;
    const canvas = await fromPng(it.kdZones);
    KS.preview.open(canvas, canvas.width, canvas.height, { title: 'Zones repeintes par Kane Detailer (couleur : masque, pointillés : zone de travail)' });
  }
  function outButtons(key, it) {
    const sub = key === 'i2i' ? 'img2img-images' : key === 'ex' ? 'extras-images' : 'txt2img-images';
    const items = OUT[key].items;
    const action = (label, fn, { enabled = !!it, primary = false, tip = '', icon } = {}) => {
      const b = h('button.fx-abtn' + (primary ? '.primary' : ''), { type: 'button', title: tip || label });
      if (icon) b.innerHTML = KS.icon(icon);
      b.append(h('span', { text: label })); b.disabled = !enabled; b.addEventListener('click', fn); return b;
    };
    const group = (id, label, ...buttons) => h('div.fx-actiongroup', { 'data-group': id, role: 'group', 'aria-label': label, title: label }, ...buttons.filter(Boolean));
    const more = action('Plus', e => {
      const r = e.currentTarget.getBoundingClientRect();
      ui.menu([
        { label: 'Ajouter en calque' + (D() ? ' · ' + D().name : ''), icon: 'layers', action: () => addAsLayer(it), disabled: !D() },
        key === 't2i' ? { label: 'Refaire avec un autre modèle…', icon: 'compare', action: () => remakeWithModel(it), disabled: !it.info || !!BUSY } : null,
        { label: 'Voir les zones (Kane Detailer)', icon: 'grid', action: () => detectItem(key, it) },
        { sep: true },
        key !== 'ex' ? { label: 'Agrandir (onglet Agrandir)', icon: 'upscale', action: () => sendTo('extras', it) } : null,
        key === 't2i' ? { label: 'Agrandir avec le hires fix', icon: 'maximize', action: () => upscaleHires(it) } : key === 'i2i' ? { label: 'Agrandir avec le hires fix (Créer)', icon: 'maximize', action: () => C.sendToStudioItem(it) } : null,
        { sep: true },
        { label: 'Tout enregistrer…', icon: 'export', action: () => saveAll(items), disabled: items.length < 2 },
        { label: 'Copier l’image', icon: 'copy', action: () => KS.preview.copy(it.bytes ? new Blob([it.bytes], { type: 'image/png' }) : it.canvas) },
        N ? { label: key === 'ex' ? 'Dossier des images (output\\kanevas)' : 'Dossier des images (output\\' + sub + ')', icon: 'folder-open', action: () => key === 'ex' ? N.openOutputs() : N.openForgeOutput(sub) } : null,
      ].filter(Boolean), Math.max(8, r.right - 290), r.bottom + 4);
    }, { icon: 'more', tip: 'Calque, autre modèle, agrandir, tout enregistrer, copier, dossier…' });
    more.classList.add('fx-more');
    return h('div.fx-output-actions',
      group('edit', 'Utiliser dans Retouche', action('Ouvrir dans Retouche', () => sendTo('edit', it), { primary: true, icon: 'brush', tip: 'Créer un nouveau document avec ce résultat' })),
      group('transform', 'Transformer',
        action('Vers Img2Img', () => sendTo('img2img', it), { icon: 'image', tip: 'Envoyer vers Img2Img : transformer cette image' }),
        action('Vers Inpaint', () => sendTo('inpaint', it), { icon: 'mask', tip: 'Envoyer vers Inpaint : retoucher une zone' }),
        action('Détailler', () => detailItem(key, it), { icon: 'sparkles', tip: 'Kane Detailer : repeint de près chaque partie choisie dans le tiroir, couleurs d’origine gardées' }),
        it && it.kdZones ? action('Zones repeintes', () => showZones(it), { icon: 'eye', tip: 'Ce que Kane Detailer a vraiment repeint sur cette image' }) : null),
      it && it.before ? group('compare', 'Comparer', action(it.from === 'Kane Detailer' ? 'Avant / après' : 'Comparer à l’original', () => compareBefore(it), { icon: 'compare', tip: 'Rideau ou côte à côte, avec l’image de départ' })) : null,
      group('files', 'Fichiers', action('Enregistrer', () => saveItem(it), { icon: 'save', tip: 'Enregistrer cette image…' }), more));
  }
  C.sendToStudioItem = async it => {
    const bytes = it.bytes || await pngBytes(it.canvas);
    OUT.t2i.items.unshift({ ...it, bytes, url: URL.createObjectURL(new Blob([bytes], { type: 'image/png' })) });
    OUT.t2i.sel = 0; paramsTo('t2i', it); FX.tab = 'txt2img'; save(); await C.toggleStudio(true); render();
  };
  function progressBox() {
    const bar = h('i'), txt = h('span', { text: 'En attente de Forge…' }), img = h('img.fx-live', { alt: '', hidden: true });
    Object.assign(els, { progBar: bar, progTxt: txt, progImg: img });
    return { box: h('div.fx-prog', h('div.fx-prog-bar', bar), txt), img };
  }
  // Pendant une génération, un clic sur l'aperçu en direct montre en plein écran la dernière image terminée
  // (la plus récente de la galerie, sinon le résultat affiché avant de lancer) ; l'aperçu continue derrière.
  function peekLastDone(view, key) {
    view.classList.add('fx-peek');
    view.title = 'Clic : voir en plein écran la dernière image terminée';
    view.addEventListener('click', () => {
      const g = SD.gallery[0], o = OUT[key], it = o && (o.items[o.sel] || o.items[0]);
      const m = g ? galleryMedia(g) : null;
      const pick = m ? { media: m.canvas || h('img', { src: m.src }), w: m.w, h: m.h } : it ? { media: h('img', { src: it.url }), w: it.canvas.width, h: it.canvas.height } : null;
      if (!pick) return KS.toast('Aucune image terminée pour l’instant : la première arrive à la fin de cette génération.', 'info', 2600);
      KS.preview.open(pick.media, pick.w, pick.h, { title: 'Dernière image terminée (génération en cours…)' }).done.then(() => m?.release?.());
    });
  }
  function renderOut(key = 't2i') {
    const box = key === 'i2i' ? els.i2iOut : els.out; if (!box) return;
    const o = OUT[key], it = o.items[o.sel];
    const real = o.items.filter(x => !x.grid), busy = BUSY && BUSY.k === key;
    let main;
    if (busy) { const p = progressBox(); main = h('div.fx-view.live'); els.progView = main; main.append(p.box, p.img); peekLastDone(main, key); }
    else if (o.board && real.length > 1) {
      // planche : tout le lot en grand, côte à côte ; un clic montre une image seule
      main = h('div.fx-thumbs.fx-board', { 'data-n': Math.min(real.length, 9) });
      for (const x of real) {
        const i = o.items.indexOf(x), im = h('img', { src: x.url, alt: '', title: 'Clic : voir cette image seule' });
        const cell = h('div.fx-bcell' + (i === o.sel ? '.on' : ''), im);
        im.addEventListener('click', () => { o.sel = i; o.board = false; renderOut(key); });
        cell.addEventListener('contextmenu', e => { e.preventDefault(); o.sel = i; renderOut(key); });
        attachLoupe(cell, () => containRect(im), x);
        main.append(cell);
      }
      // disposition qui montre les images le plus grand possible (4 portraits : côte à côte ; 4 paysages : 2 × 2)
      const board = main, ratio = real[0].canvas.width / real[0].canvas.height || 1;
      const fit = () => {
        const W = board.clientWidth, H = board.clientHeight, n = real.length, g = 14; if (!W || !H) return;
        let best = null;
        for (let cols = 1; cols <= n; cols++) {
          const rows = Math.ceil(n / cols), w = Math.min((W - g * (cols - 1)) / cols, (H - g * (rows - 1)) / rows * ratio);
          if (!best || w > best.w + 0.5) best = { cols, rows, w };
        }
        board.style.gridTemplateColumns = `repeat(${best.cols}, minmax(0, 1fr))`;
        board.style.gridTemplateRows = `repeat(${best.rows}, minmax(0, 1fr))`;
      };
      fit(); new ResizeObserver(() => requestAnimationFrame(fit)).observe(board);
    } else if (it) {
      main = h('div.fx-view');
      const im = h('img', { src: it.url, alt: '' });
      KS.preview.mount(main, im, { identity: it, width: it.canvas.width, height: it.canvas.height, clickOpen: true, menu: () => [
        { label: 'Enregistrer…', icon: 'save', action: () => saveItem(it) },
        { label: 'Ouvrir dans Retouche', icon: 'file-plus', action: () => sendTo('edit', it) },
        { label: 'Ajouter en calque', icon: 'layers', action: () => addAsLayer(it), disabled: !D() },
        { label: 'Envoyer vers Img2Img', icon: 'image', action: () => sendTo('img2img', it) },
        { label: 'Envoyer vers Inpaint', icon: 'brush', action: () => sendTo('inpaint', it) },
        { label: 'Détailler (Kane Detailer)', icon: 'sparkles', action: () => detailItem(key, it) },
        { label: 'Voir les zones (Kane Detailer)', icon: 'grid', action: () => detectItem(key, it) },
        it.kdZones ? { label: 'Zones repeintes (Kane Detailer)', icon: 'eye', action: () => showZones(it) } : null,
        it.before ? { label: it.from === 'Kane Detailer' ? 'Avant / après' : 'Comparer à l’original', icon: 'compare', action: () => compareBefore(it) } : null,
        key === 't2i' && it.info ? { label: 'Refaire avec un autre modèle…', icon: 'compare', action: () => remakeWithModel(it) } : null].filter(Boolean) });
      const area = main.querySelector('.iv-viewport');
      attachLoupe(main, () => im.getBoundingClientRect(), it, () => +(area && area.dataset.scale) >= 0.9);
    } else main = h('div.fx-view.fx-empty', h('div.fx-ph', h('span', { html: KS.icon(key === 'i2i' ? 'image' : 'sparkles') }),
      h('b', { text: key === 'i2i' ? 'Le résultat apparaîtra ici' : 'Votre image apparaîtra ici, en grand' }),
      h('small', { text: key === 'i2i' ? 'Choisissez une image source, décrivez le changement, puis Générer.' : 'Décrivez-la en bas puis Générer (Ctrl+Entrée). Survolez le résultat : la loupe montre les détails à 100 %.' })));
    // petite barre au-dessus : lot, infos, loupe, puis les actions
    const thumbs = !busy && real.length > 1 && !(o.board && real.length > 1) ? h('div.fx-thumbs.fx-mini', ...o.items.map((x, i) => { const t = h('img' + (i === o.sel ? '.on' : ''), { src: x.url, alt: '', title: x.from ? 'Venue de l\'Édition : ' + x.from : 'Voir cette image' }); t.addEventListener('click', () => { o.sel = i; renderOut(key); }); return t; }),
      ibtn('grid', 'Revoir tout le lot en planche', () => { o.board = true; renderOut(key); })) : null;
    const meta = it && !busy ? h('span.fx-sb-meta', { text: [it.canvas.width + ' × ' + it.canvas.height, it.seed != null ? 'graine ' + it.seed : '', o.time && !it.from ? o.time.replace(' sec.', ' s') : ''].filter(Boolean).join(' · ') }) : null;
    const info = it && !busy ? infoBox((it.from ? 'Venue de l\'Édition : ' + it.from + '\n\n' : '') + (it.info || '(sans paramètres de génération)') + (o.time && !it.from ? `\n\nTemps : ${o.time}` : '')) : null;
    const lens = it && !busy ? ibtn('zoom', 'Loupe au survol : détails à 100 % sans cliquer (touche L)', () => { FX.loupe = FX.loupe === false; save(); renderOut(key); }, FX.loupe !== false ? '.on' : '') : null;
    const bar = h('div.fx-stagebar', h('div.fx-sb-left', thumbs, meta, info, lens), it && !busy ? outButtons(key, it) : null);
    fillEl(box, bar, main);
    if (key === 't2i') renderFilm();
  }
  function renderStrip() {
    renderOut('i2i');
  }
  // Paramètres de génération du résultat : un bouton, le texte s'ouvre par-dessus l'image
  function infoBox(text) {
    const d = h('details.fx-infobox', h('summary', { title: 'Paramètres de génération' }, h('span', { html: KS.icon('info') }), h('span', { text: 'Paramètres' })), h('div.fx-outinfo', { text }));
    d.open = !!FX.infoOpen;
    d.addEventListener('toggle', () => { FX.infoOpen = d.open; save(); });
    return d;
  }
  // rectangle réellement occupé par une image en object-fit: contain
  function containRect(im) {
    const r = im.getBoundingClientRect(), W = im.naturalWidth || 1, H = im.naturalHeight || 1, k = Math.min(r.width / W, r.height / H);
    const w = W * k, hh = H * k;
    return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - hh) / 2, width: w, height: hh, right: r.left + (r.width + w) / 2, bottom: r.top + (r.height + hh) / 2 };
  }
  // Loupe au survol : un rond qui suit la souris et montre l'image à 100 % (visage, mains, yeux) sans cliquer
  function attachLoupe(host, rectOf, it, off = () => false) {
    if (!it || !it.url || !it.canvas) return;
    const W = it.canvas.width, H = it.canvas.height;
    const lens = h('div.fx-loupe', { hidden: true, 'aria-hidden': 'true' });
    lens.style.backgroundImage = 'url("' + it.url + '")';
    lens.style.backgroundSize = W + 'px ' + H + 'px';
    host.append(lens);
    host.addEventListener('pointermove', e => {
      const r = rectOf();
      if (FX.loupe === false || e.buttons || off() || !r.width || r.width >= W * 0.9 || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) { lens.hidden = true; return; }
      const S = lens.offsetWidth || 260, hr = host.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width * W, py = (e.clientY - r.top) / r.height * H;
      lens.hidden = false;
      lens.style.transform = `translate(${e.clientX - hr.left - S / 2}px, ${e.clientY - hr.top - S / 2}px)`;
      lens.style.backgroundPosition = `${S / 2 - px}px ${S / 2 - py}px`;
    });
    host.addEventListener('pointerleave', () => { lens.hidden = true; });
    host.addEventListener('pointerdown', () => { lens.hidden = true; });
    host.addEventListener('wheel', () => { lens.hidden = true; }, { passive: true });
  }
  // Séance : toutes les images de la séance, en colonne à droite (← → pour passer de l'une à l'autre)
  function renderFilm() {
    const f = els.film; if (!f) return;
    const o = OUT.t2i, cur = o.items[o.sel];
    f.hidden = !SD.gallery.length;
    if (!SD.gallery.length) return f.replaceChildren();
    fillEl(f, h('div.fx-film-h', { text: 'Séance', title: 'Les images de cette séance · ← → pour passer de l’une à l’autre' }), ...SD.gallery.map(g => {
      const t = h('img' + (cur && cur.gid === g.id ? '.on' : ''), { src: g.thumb, alt: '', loading: 'lazy', title: (g.info || '').split('\n')[0].slice(0, 160) || 'Image de la séance' });
      t.addEventListener('click', () => showGallery(g));
      return t;
    }));
    const on = f.querySelector('img.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  }
  async function showGallery(g) {
    const o = OUT.t2i, i = o.items.findIndex(x => x.gid === g.id);
    if (i >= 0) { o.sel = i; o.board = false; return renderOut('t2i'); }
    const full = await galleryItem(g), bytes = g.blob ? new Uint8Array(await g.blob.arrayBuffer()) : null;
    o.items.unshift({ canvas: full.canvas, bytes, url: g.blob ? URL.createObjectURL(g.blob) : full.canvas.toDataURL('image/png'), info: g.info, params: g.params, seed: g.seed, kind: g.kind, from: g.from, gid: g.id, before: g.before });
    o.sel = 0; o.board = false;
    // les images revues s'ajoutent devant : au-delà de 16, les plus anciennes sont libérées (elles restent dans la séance)
    while (o.items.length > 16) { const x = o.items.pop(); if (x.url && x.url.startsWith('blob:')) URL.revokeObjectURL(x.url); }
    renderOut('t2i');
  }
  function stepFilm(dir) {
    if (!SD.gallery.length || BUSY) return;
    const cur = OUT.t2i.items[OUT.t2i.sel], i = cur ? SD.gallery.findIndex(g => g.id === cur.gid) : -1;
    const next = SD.gallery[U.clamp(i < 0 ? 0 : i + dir, 0, SD.gallery.length - 1)];
    if (next && (!cur || next.id !== cur.gid)) showGallery(next);
  }

  /* ---------------------------------------------------------------- génération */
  let BUSY = null, PREPARING = null, progTimer = null, tickBusy = false;
  async function tick() {
    if (tickBusy || !BUSY) return; tickBusy = true;
    try {
      const r = await N.forgeProgress(url(), FX.livePreview !== false);
      if (r && r.ok && BUSY && BUSY.k === 'edit' && editorStatus) editorStatus.textContent = 'Génération du dessin : ' + Math.round((r.progress || 0) * 100) + ' %';
      if (r && r.ok && BUSY && els.progTxt) {
        const p = Math.max(0, Math.min(1, r.progress || 0));
        els.progBar.style.width = Math.round(p * 100) + '%';
        els.progTxt.textContent = (BUSY.label ? BUSY.label + ' · ' : '') + Math.round(p * 100) + '%' + (r.eta > 0 ? ` · ${Math.round(r.eta)} s restantes` : '') + (r.steps ? ` · étape ${r.step || 0} / ${r.steps}` : '') + (p === 0 && !r.image ? ' · préparation (chargement du modèle…)' : '');
        if (r.image) {
          if (els.progImg._u) URL.revokeObjectURL(els.progImg._u);
          els.progImg._u = URL.createObjectURL(new Blob([r.image], { type: 'image/jpeg' }));
          els.progImg.onload = () => { const v = els.progView; if (v && els.progImg.naturalWidth) v.style.aspectRatio = els.progImg.naturalWidth + ' / ' + els.progImg.naturalHeight; };
          els.progImg.src = els.progImg._u; els.progImg.hidden = false;
        }
      }
    } catch { /* rien */ } finally { tickBusy = false; }
  }
  const refreshBusy = k => { renderGenButtons(); renderExGen(); refreshEditorDraw(); if (k === 't2i') renderOut(); else if (k === 'i2i') renderStrip(); else if (k === 'ex') renderExOut(); };
  async function runForge(k, call) {
    BUSY = { k, t0: performance.now() };
    refreshBusy(k);
    progTimer = setInterval(tick, 700);
    try { return await (KS.suite ? KS.suite.run('Génération · Studio IA', call) : call()); }
    finally {
      clearInterval(progTimer);
      if (els.progImg && els.progImg._u) URL.revokeObjectURL(els.progImg._u);
      const dt = ((performance.now() - BUSY.t0) / 1000).toFixed(1) + ' sec.';
      BUSY = null; if (OUT[k]) OUT[k].time = dt;
      refreshBusy(k);
    }
  }
  const interrupt = () => {
    if (PREPARING) PREPARING.canceled = true;
    if (BUSY) {
      if (BUSY.stopping) return;
      BUSY.stopping = true;
      Promise.resolve(N.forgeInterrupt(url())).catch(e => KS.toast('Interruption impossible : ' + e.message, 'err'));
    } else if (PREPARING) PREPARING.canceled = true;
    renderGenButtons(); renderExGen(); refreshEditorDraw();
  };
  const skip = () => { if (BUSY) N.forgeSkip(url()); };
  let warnedFr = false;
  async function english(t, required = false) {
    if (!t || FX.translate === false || !G.looksFrench(t)) return t;
    const tags = [];
    const body = t.replace(/<[^>]+>/g, m => { tags.push(m); return ' '; }).replace(/\s{2,}/g, ' ').trim();
    const en = await G.toEnglish(body, true);
    if (en == null) {
      if (required) throw new Error('La traduction est nécessaire pour cette demande en français. Installez le traducteur proposé ou écrivez la demande en anglais.');
      if (!warnedFr) KS.toast('Invite envoyée en français : Forge risque de dessiner autre chose.', 'info', 5000); warnedFr = true; return t;
    }
    return [en, tags.join(' ')].filter(Boolean).join(' ');
  }
  async function payloadFor(k, st, strictPrompt = false) {
    if (KS.animationBusy) throw new Error('Le moteur IA est réservé à Animation. Attendez la fin de sa tâche.');
    const p = {
      prompt: await english(st.prompt, strictPrompt), negative_prompt: await english(st.negative_prompt), styles: st.styles,
      sampler_name: st.sampler_name, scheduler: st.scheduler, steps: +st.steps, width: +st.width, height: +st.height, n_iter: +st.n_iter, batch_size: +st.batch_size,
      cfg_scale: +st.cfg_scale, distilled_cfg_scale: +st.distilled_cfg_scale, seed: -1, save_images: FX.saveImages !== false, send_images: true, alwayson_scripts: {},
    };
    if (st.seedExtra) Object.assign(p, { subseed: -1, subseed_strength: +st.subseed_strength, seed_resize_from_w: +st.seed_resize_from_w, seed_resize_from_h: +st.seed_resize_from_h });
    if (k === 't2i' && st.enable_hr) Object.assign(p, {
      enable_hr: true, hr_upscaler: st.hr_upscaler, hr_second_pass_steps: +st.hr_second_pass_steps, denoising_strength: +st.denoising_strength, hr_scale: +st.hr_scale,
      hr_resize_x: +st.hr_resize_x, hr_resize_y: +st.hr_resize_y, hr_distilled_cfg: +st.hr_distilled_cfg, hr_cfg: +st.hr_cfg,
      hr_checkpoint_name: st.hr_checkpoint_name || 'Use same checkpoint', hr_additional_modules: st.hr_additional_modules && st.hr_additional_modules.length ? st.hr_additional_modules : ['Use same choices'],
      // « Use same … » : l'interface de Forge les traduit, son API non (« bad sampler name »)
      hr_sampler_name: st.hr_sampler_name && st.hr_sampler_name !== 'Use same sampler' ? st.hr_sampler_name : undefined,
      hr_scheduler: st.hr_scheduler && st.hr_scheduler !== 'Use same scheduler' ? st.hr_scheduler : undefined,
      hr_prompt: await english(st.hr_prompt), hr_negative_prompt: await english(st.hr_negative_prompt),
    });
    if (st.kd.enabled && st.kd.parts.length && cat && cat.kdInfo) p.alwayson_scripts['Kane Detailer'] = { args: [{ enabled: true, parts: st.kd.parts, forces: { ...st.kd.forces }, skip: k === 'i2i' && !!st.kd.skip, keep: +st.kd.keep, resolution: +st.kd.resolution, detail: +st.kd.detail || 0, upscale: +st.kd.upscale || 1, tries: +st.kd.tries || 1, repair: !!st.kd.repair, grain: +st.kd.grain || 0, glow: !!st.kd.glow, age: !!st.kd.age, autotag: st.kd.autotag !== false, soft: st.kd.soft !== false, wd: st.kd.wd !== false }] };
    if (st.noom.unet || st.noom.vae) p.alwayson_scripts['Never OOM Integrated'] = { args: [!!st.noom.unet, !!st.noom.vae] };
    if (k === 'i2i') {
      if (st.md.enabled) p.alwayson_scripts['MultiDiffusion Integrated'] = { args: [true, st.md.method, +st.md.tw, +st.md.th, +st.md.overlap, +st.md.batch] };
      if (st.soft.enabled && INPAINT_MODES.includes(FX.i2iMode)) p.alwayson_scripts['Soft inpainting'] = { args: [true, +st.soft.bias, +st.soft.preserve, +st.soft.contrast, +st.soft.influence, +st.soft.diffThr, +st.soft.diffContrast] };
    }
    const sc = st.script !== 'None' && cat && cat.scripts.find(s => s.name === st.script && s.img2img === (k === 'i2i'));
    if (sc) {
      const vals = st.scriptArgs[sc.name] || [];
      const INDEX = { 'x/y/z plot': [0, 3, 6], 'sd upscale': [1] }[sc.name] || [];
      p.script_name = sc.name;
      p.script_args = sc.args.map((a, i) => {
        let v = vals[i] !== undefined ? vals[i] : a.value;
        if (sc.name === 'x/y/z plot' && i === 18) v = true;            // valeurs tapées en texte, comme « Use text inputs instead of dropdowns »
        if (sc.name === 'x/y/z plot' && [2, 5, 8].includes(i)) v = [];
        if (INDEX.includes(i) && a.choices) v = Math.max(0, a.choices.indexOf(v));
        if (typeof a.value === 'number' && v !== '' && v != null) v = +v;
        return v == null ? '' : v;
      });
    }
    // aperçu : « net » = le latent décodé par le VAE (même taille que le résultat), « rapide » = approximation 8 fois plus petite
    const net = FX.livePreview !== false && FX.previewMode !== 'fast';
    p.override_settings = { ...(p.override_settings || {}), live_previews_enable: FX.livePreview !== false, show_progress_type: net ? 'Full' : 'RGB', show_progress_every_n_steps: net ? Math.max(2, Math.round((+st.steps || 20) / 8)) : 1 };
    p.override_settings_restore_afterwards = p.override_settings_restore_afterwards !== false;
    return p;
  }
  // Un entraînement LoRA garde la carte graphique : comme dans Forge, les générations attendent sa fin
  async function trainingRuns() {
    const r = await KS.trainingRunning();
    if (r) KS.toast('Un entraînement LoRA est en cours (' + r + ') : la carte graphique est prise. Attendez sa fin ou arrêtez-le dans Lora Studio.', 'info', 6000);
    return !!r;
  }
  async function generate(k) {
    if (BUSY || PREPARING) return;
    CTX.i2i.finishStroke && CTX.i2i.finishStroke();
    const prep = PREPARING = { k, canceled: false };
    renderGenButtons();
    try {
      if (await trainingRuns() || prep.canceled) return;
      if (!(await ensureCat()) || prep.canceled) return;
      const st = FX[k]; st.seed = -1; st.subseed = -1; save();
      const p = await payloadFor(k, st);
      if (prep.canceled) return;
      rememberPrompt(st);
      if (k === 't2i') await runT2I(p);
      else await runI2I(p, st);
    } catch (e) { KS.toast('Génération impossible : ' + e.message, 'err', 7000); }
    finally { if (PREPARING === prep) PREPARING = null; renderGenButtons(); }
  }
  async function runT2I(p, firstpass, snap = snapParams(FX.t2i)) {
    const r = await runForge('t2i', () => N.forgeTxt2img(url(), p, firstpass));
    if (!r.ok) throw new Error(r.error);
    const items = await toItems(r, 'txt2img', p);
    if (!items.length) throw new Error('Forge n\'a renvoyé aucune image (génération interrompue ?)');
    for (const it of items) { it.params = snap; const m = /\bSeed: (\d+)/.exec(it.info || ''); if (m) it.seed = +m[1]; }
    releaseItems(OUT.t2i);
    OUT.t2i.items = items; OUT.t2i.sel = items.findIndex(i => !i.grid) >= 0 ? items.findIndex(i => !i.grid) : 0;
    OUT.t2i.board = items.filter(i => !i.grid).length > 1;
    renderOut(); pushGallery(items.filter(i => !i.grid));
  }
  // ✨ de Forge : la même image, refaite avec le hires fix (image de première passe)
  async function upscaleHires(it) {
    if (!it || BUSY || PREPARING) return;
    const prep = PREPARING = { k: 't2i', canceled: false }; renderGenButtons();
    try {
      if (await trainingRuns() || prep.canceled) return;
      if (!(await ensureCat()) || prep.canceled) return;
      const p = await payloadFor('t2i', { ...FX.t2i, enable_hr: true, n_iter: 1, batch_size: 1, script: 'None' });
      if (prep.canceled) return;
      const I = KS.png.parseInfo(it.info);
      if (it.info && I.prompt) { p.prompt = I.prompt; p.negative_prompt = I.negative; }
      p.width = it.canvas.width; p.height = it.canvas.height;
      await runT2I(p, it.bytes || await pngBytes(it.canvas), it.params || snapParams(FX.t2i));
    } catch (e) { KS.toast('Agrandissement impossible : ' + e.message, 'err', 7000); }
    finally { if (PREPARING === prep) PREPARING = null; renderGenButtons(); }
  }
  const maskCanvas = alpha => {
    const m = U.canvas(alpha.width, alpha.height), x = m.getContext('2d');
    x.drawImage(alpha, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = '#fff'; x.fillRect(0, 0, m.width, m.height);
    x.globalCompositeOperation = 'destination-over'; x.fillStyle = '#000'; x.fillRect(0, 0, m.width, m.height);
    return m;
  };
  const i2iSize = (st, w, hh) => st.autoSize ? autoDims(st, { width: w, height: hh }) : st.sizeTab === 'by' ? { w: r8(w * st.scale_by), h: r8(hh * st.scale_by) } : { w: +st.width, h: +st.height };
  async function runI2I(p, st) {
    const mode = FX.i2iMode;
    Object.assign(p, { resize_mode: +st.resize_mode, denoising_strength: +st.denoising_strength });
    if (mode === 'batch') return runBatch(p, st);
    const d = i2iDoc; if (!d) return KS.toast('Choisissez une image source dans Img2Img', 'info', 4000);
    const keepSketch = mode === 'sketch' || mode === 'inpaint_sketch';
    let mask = null;
    if (INPAINT_MODES.includes(mode)) {
      const role = mode === 'inpaint_sketch' ? 'sketch' : 'zone';
      const roleL = roleLayer(d, role);
      let alpha = roleL && roleL.visible !== false ? layerAlpha(d, roleL) : null;
      if (alpha && !U.alphaBounds(alpha, 8)) alpha = null;
      if (!alpha && role === 'zone' && d.selection.active) alpha = U.copyCanvas(d.selection.mask);
      if (!alpha) return KS.toast(role === 'zone' ? 'Peignez d\'abord le masque (« Peindre le masque ») ou faites une sélection' : 'Peignez d\'abord en couleur ce qui doit changer', 'info', 4500);
      if (role === 'sketch') { const g = U.blurCanvas(alpha, 6), gx = g.getContext('2d'); gx.drawImage(alpha, 0, 0); alpha = g; }
      mask = maskCanvas(alpha);
      Object.assign(p, { mask_blur: +st.mask_blur, inpainting_mask_invert: +st.inpainting_mask_invert, inpainting_fill: +st.inpainting_fill, inpaint_full_res: +st.inpaint_full_res, inpaint_full_res_padding: +st.inpaint_full_res_padding });
    }
    const init = sourceFor(d, keepSketch);
    const sz = i2iSize(st, init.width, init.height); p.width = sz.w; p.height = sz.h;
    const initB = await pngBytes(init), maskB = mask ? await pngBytes(mask) : null;
    const snap = snapParams(st);
    const r = await runForge('i2i', () => N.forgeImg2img(url(), p, initB, maskB));
    if (!r.ok) throw new Error(r.error);
    const items = await toItems(r, 'img2img', p);
    if (!items.length) throw new Error('Forge n\'a renvoyé aucune image (génération interrompue ?)');
    releaseItems(OUT.i2i);
    OUT.i2i.items = items; OUT.i2i.sel = 0; OUT.i2i.board = items.filter(i => !i.grid).length > 1;
    for (const it of items) { it.params = snap; const m = /\bSeed: (\d+)/.exec(it.info || ''); if (m) it.seed = +m[1]; }
    const imgs = items.filter(i => !i.grid);
    renderStrip(); pushGallery(imgs);
  }
  async function runBatch(p, st) {
    if (!OUT.batch.length) return KS.toast('Choisissez d\'abord des images (« Choisir des images… »)', 'info');
    const all = [], snap = snapParams(st), batch = OUT.batch.slice();
    await runForge('i2i', async () => {
      for (let i = 0; i < batch.length; i++) {
        if (BUSY && BUSY.stopping) break;
        const b = batch[i], sz = i2iSize(st, b.canvas.width, b.canvas.height);
        BUSY.label = `Image ${i + 1} / ${batch.length}`;
        const r = await N.forgeImg2img(url(), { ...p, width: sz.w, height: sz.h }, await pngBytes(b.canvas), null);
        if (!r.ok) throw new Error(r.error);
        const items = await toItems(r, 'img2img', p);
        for (const it of items) { it.params = snap; const m = /\bSeed: (\d+)/.exec(it.info || ''); if (m) it.seed = +m[1]; }
        all.push(...items);
      }
    });
    releaseItems(OUT.i2i);
    OUT.i2i.items = all; OUT.i2i.sel = 0; OUT.i2i.board = all.filter(i => !i.grid).length > 1; renderStrip(); pushGallery(all.filter(i => !i.grid));
    KS.toast(all.length + ' image(s) traitée(s)' + (FX.saveImages !== false ? ' : dans output\\img2img-images de Forge' : ''), 'ok', 4000);
  }

  /* ---------------------------------------------------------------- Extras */
  function extrasTab() {
    const ex = FX.ex, src = OUT.exSrc, d = D();
    const zone = h('div.fx-dropzone', src ? KS.preview.copyCanvas(src.canvas) : h('div', { text: 'Déposer l\'image ici, ou cliquer pour en choisir une' }));
    const pick = async () => {
      const files = await N.openDialog({ title: 'Image à agrandir', multi: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }] });
      if (files && files[0]) { OUT.exSrc = { canvas: await KS.io.canvasFromEntry(files[0]), name: files[0].name }; render(); }
    };
    if (src) KS.preview.mount(zone, zone.firstElementChild, { identity: src, width: src.canvas.width, height: src.canvas.height }); else zone.addEventListener('click', pick);
    dropTo(zone, async f => { OUT.exSrc = { canvas: await KS.io.canvasFromEntry(f), name: f.name }; render(); });
    const srcBtns = h('div.fx-outbtns', tbtn('Importer une image…', pick), tbtn('Depuis Retouche', () => { if (!d) return KS.toast('Aucun document ouvert', 'info'); OUT.exSrc = { canvas: d.composite(), name: d.name }; render(); }),
      src ? h('span.fx-info', { text: `${src.name} · ${src.canvas.width} × ${src.canvas.height}` }) : null);
    const ups = ['None', ...(cat ? cat.upscalers : [])];
    const sizeTabs = tabs([['by', 'Par facteur'], ['to', 'Taille précise']], ex.mode, v => { ex.mode = v; save(); render(); }, '.fx-subtabs');
    const sizeBody = ex.mode === 'to'
      ? h('div.fx-col', row2(slider('Largeur', ex, 'w', 64, 8192, 8), slider('Hauteur', ex, 'h', 64, 8192, 8)), check('Recadrer pour remplir', ex, 'crop'))
      : h('div.fx-col', slider('Agrandissement (×)', ex, 'resize', 1, 8, 0.05), src ? h('div.fx-info', { text: `${src.canvas.width} × ${src.canvas.height} → ${Math.round(src.canvas.width * ex.resize)} × ${Math.round(src.canvas.height * ex.resize)}` }) : null);
    const left = h('div.fx-left',
      tabs([['single', 'Une image'], ['batch', 'Plusieurs images']], ex.batch ? 'batch' : 'single', v => { ex.batch = v === 'batch'; save(); render(); }),
      ex.batch
        ? h('div.fx-panel', tbtn('Choisir des images…', async () => { const files = await N.openDialog({ title: 'Images à agrandir', multi: true, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }] }); if (files && files.length) { OUT.exBatch = files; render(); } }, '.primary'),
          h('div.fx-info', { text: OUT.exBatch && OUT.exBatch.length ? OUT.exBatch.length + ' image(s) : ' + OUT.exBatch.map(f => f.name).slice(0, 5).join(', ') : 'Aucune image choisie' }))
        : h('div.fx-panel', zone, srcBtns),
      h('div.fx-panel', h('div.fx-acc.open.active', h('div.fx-acc-h', h('span.fx-acc-t', { text: 'Agrandissement' })), h('div.fx-acc-b', sizeTabs, sizeBody,
        row2(select('Modèle d’agrandissement', ups, ex, 'up1'), select('Second modèle (mélange)', ups, ex, 'up2')), slider('Part du second modèle', ex, 'vis2', 0, 1, 0.001)))));
    els.exGen = h('div.fx-genbox');
    els.exOut = h('div.fx-exout');
    const wrap = h('div.fx-gen', h('div.fx-cols', left, h('div.fx-out', els.exGen, els.exOut)));
    renderExOut();
    return wrap;
  }
  function renderExGen() {
    const g = els.exGen; if (!g) return;
    if (KS.animationBusy && !BUSY && !PREPARING) { g.replaceChildren(h('button.fx-generate', { text: 'Moteur utilisé par Animation', disabled: true })); return; }
    if (BUSY || PREPARING) { const i = h('button.fx-interrupt', { text: 'Interrompre', title: 'Interrompre (Ctrl+Entrée)' }); i.addEventListener('click', interrupt); g.replaceChildren(i); return; }
    const b = h('button.fx-generate', { text: 'Agrandir', title: 'Agrandir (Ctrl+Entrée)' }); b.addEventListener('click', runExtras); g.replaceChildren(b);
  }
  function renderExOut() {
    renderExGen();
    const box = els.exOut; if (!box) return;
    const o = OUT.ex, it = o.items[o.sel];
    const view = h('div.fx-view');
    if (BUSY && BUSY.k === 'ex') { const p = progressBox(); view.append(p.box); peekLastDone(view, 'ex'); }
    else if (it) KS.preview.mount(view, h('img', { src: it.url, alt: '' }), { identity: it, width: it.canvas.width, height: it.canvas.height, clickOpen: true });
    else view.append(h('div.fx-ph', { html: KS.icon('upscale') }));
    const thumbs = o.items.length > 1 ? h('div.fx-thumbs', ...o.items.map((x, i) => { const t = h('img' + (i === o.sel ? '.on' : ''), { src: x.url, alt: '' }); t.addEventListener('click', () => { o.sel = i; renderExOut(); }); return t; })) : null;
    fillEl(box, view, thumbs, outButtons('ex', it), it ? h('div.fx-outinfo', { text: `${it.canvas.width} × ${it.canvas.height}` + (it.info ? '\n' + it.info : '') + (o.time ? `\nDurée : ${o.time}` : '') }) : null);
  }
  const stamp = () => { const t = new Date(), p = n => String(n).padStart(2, '0'); return `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}`; };
  async function runExtras() {
    if (BUSY || PREPARING) return;
    const prep = PREPARING = { k: 'ex', canceled: false }; renderExGen();
    const items = [];
    try {
      const ex = FX.ex;
      const sources = ex.batch ? await Promise.all((OUT.exBatch || []).map(async f => ({ canvas: await KS.io.canvasFromEntry(f), name: f.name }))) : OUT.exSrc ? [OUT.exSrc] : [];
      if (prep.canceled) return;
      if (!sources.length) return KS.toast(ex.batch ? 'Choisissez d\'abord des images' : 'Choisissez d\'abord une image', 'info');
      if (await trainingRuns() || prep.canceled) return;
      if (!(await ensureCat()) || prep.canceled) return;
      const payload = { resize_mode: ex.mode === 'to' ? 1 : 0, upscaling_resize: +ex.resize, upscaling_resize_w: +ex.w, upscaling_resize_h: +ex.h, upscaling_crop: !!ex.crop,
        upscaler_1: ex.up1, upscaler_2: ex.up2, extras_upscaler_2_visibility: +ex.vis2, show_extras_results: true };
      await runForge('ex', async () => {
        for (let i = 0; i < sources.length; i++) {
          if (BUSY && BUSY.stopping) break;
          BUSY.label = sources.length > 1 ? `Image ${i + 1} / ${sources.length}` : '';
          const r = await N.forgeUpscale(url(), payload, await pngBytes(sources[i].canvas));
          if (!r.ok) throw new Error(r.error);
          const canvas = await fromPng(r.image);
          items.push({ canvas, bytes: r.image, url: URL.createObjectURL(new Blob([r.image], { type: 'image/png' })), info: String(r.info || '').replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim(), kind: 'extras' });
          if (FX.saveImages !== false && N.saveOutput) N.saveOutput('extras', `${stamp()}-${i}.png`, r.image).catch(() => {});
        }
      });
    } catch (e) { KS.toast('Extras : ' + e.message, 'err', 6000); }
    finally { if (PREPARING === prep) PREPARING = null; renderExGen(); }
    if (items.length) { releaseItems(OUT.ex); OUT.ex.items = items; OUT.ex.sel = 0; renderExOut(); pushGallery(items); }
  }
  function dropTo(el, fn) {
    el.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', async e => {
      e.preventDefault(); e.stopPropagation(); el.classList.remove('over');
      const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return;
      fn({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
    });
  }

  /* ---------------------------------------------------------------- PNG Info */
  async function loadPng(entry) {
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
    const chunks = await KS.png.readText(data);
    const canvas = await KS.io.canvasFromEntry({ name: entry.name, data });
    OUT.png = { canvas, name: entry.name, text: chunks.parameters || '', chunks, bytes: data };
    render();
  }
  function pngTab() {
    const o = OUT.png, d = D();
    const zone = h('div.fx-dropzone', o ? KS.preview.copyCanvas(o.canvas) : h('div', { text: 'Déposer une image ici, ou cliquer pour en choisir une' }));
    if (o) KS.preview.mount(zone, zone.firstElementChild, { identity: o, width: o.canvas.width, height: o.canvas.height });
    const pick = async () => {
      const files = await N.openDialog({ title: 'Image à lire', multi: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
      if (files && files[0]) loadPng(files[0]);
    };
    if (!o) zone.addEventListener('click', pick);
    dropTo(zone, loadPng);
    const fromDoc = tbtn('Depuis Retouche', () => { if (!d) return KS.toast('Aucun document ouvert', 'info'); OUT.png = { canvas: d.composite(), name: d.name, text: d.genInfo || '', chunks: d.genInfo ? { parameters: d.genInfo } : {} }; render(); });
    const it = o && { canvas: o.canvas, info: o.text, bytes: o.bytes };
    const others = o ? Object.entries(o.chunks).filter(([k2]) => k2 !== 'parameters') : [];
    const right = h('div.fx-out',
      h('div.fx-outinfo.fx-pnginfo', { text: o ? (o.text || 'Aucun paramètre de génération dans cette image.') + others.map(([k2, v]) => `\n\n${k2}:\n${v}`).join('') : 'Les paramètres de génération de l\'image (Prompt, Negative prompt, Steps, Sampler…) apparaîtront ici.' }),
      h('div.fx-outbtns', ...[['txt2img', 'Réutiliser les réglages dans Créer'], ['img2img', 'Envoyer vers Img2Img'], ['inpaint', 'Envoyer vers Inpaint'], ['extras', 'Agrandir']].map(([t, l]) => {
        const b = tbtn(l, () => { if (!o) return; if (t === 'txt2img' && !o.text) return KS.toast('Aucun paramètre à envoyer', 'info'); sendTo(t, it); }); b.disabled = !o; return b;
      }), o && o.text ? tbtn('Copier', () => { navigator.clipboard.writeText(o.text); KS.toast('Copié', 'ok', 900); }) : null));
    return h('div.fx-gen', h('div.fx-cols', h('div.fx-left', h('div.fx-panel', zone, h('div.fx-outbtns', tbtn('Importer une image…', pick), fromDoc))), right));
  }

  /* ---------------------------------------------------------------- Settings */
  function settingsTab() {
    const E = KS.engine;
    const pane = (title, ...kids) => h('div.fx-panel', h('div.fx-h', { text: title }), ...kids);
    return h('div.fx-settings',
      pane('Moteur du Studio IA',
        h('div.fx-info', { text: !E ? 'Indisponible dans cette version.' : E.ready() ? (E.state === 'external' ? 'Forge de Kane OS (déjà lancé) : KaneApp l\'utilise.' : 'Moteur démarré par KaneApp, profil ' + (E.profile || 'Kane OS') + '. Il s\'arrête quand vous quittez KaneApp.') : E.state === 'starting' ? 'Démarrage…' : E.state === 'error' ? 'Erreur : ' + E.error : 'Arrêté.' }),
        E ? h('div.fx-outbtns', tbtn('Démarrer', () => E.ensure().then(ok => ok && loadCat()), '.primary'), tbtn('Arrêter', () => E.stop(true)), tbtn('Journal…', () => E.showLog && E.showLog()), tbtn('Profil…', () => E.pickProfile && E.pickProfile()), tbtn('Configurer le moteur…', () => KS.dialogs.enginePrefs())) : null,
        check('Démarrer le moteur automatiquement quand il le faut', { v: KS.prefs.engineAuto !== false }, 'v', '', v => { KS.prefs.engineAuto = v; KS.prefs.save(); })),
      pane('Génération',
        check('Traduire en anglais les invites écrites en français (modèle local Opus-MT)', FX, 'translate', 'Forge et anima ne comprennent que l\'anglais'),
        check('Enregistrer les images comme Forge (dossiers output\\txt2img-images, img2img-images…)', FX, 'saveImages', 'Avec leurs paramètres (PNG Info), comme l\'interface de Forge'),
        select('Aperçu en direct pendant la génération', [['net', 'Net : décodé par le VAE, même taille que le résultat'], ['fast', 'Rapide : petite image approximative'], ['off', 'Désactivé']],
          { get v() { return FX.livePreview === false ? 'off' : FX.previewMode === 'fast' ? 'fast' : 'net'; }, set v(x) { FX.livePreview = x !== 'off'; FX.previewMode = x === 'fast' ? 'fast' : 'net'; save(); } }, 'v',
          'Net coûte environ 10 % de temps en plus (un décodage toutes les quelques étapes)'),
        check('Masquer le calque Zone IA / Croquis IA après une génération', { v: KS.prefs.hideAfterGen !== false }, 'v', '', v => { KS.prefs.hideAfterGen = v; KS.prefs.save(); })),
      pane('Dossiers',
        h('div.fx-outbtns', tbtn('Images de Forge (output)', () => N.openForgeOutput('')), tbtn('Images d\'Extras (output\\kanevas)', () => N.openOutputs())),
        h('div.fx-info', { text: cat && cat.dirs ? 'Forge : ' + cat.dirs.data : 'Forge : dossier lu au premier démarrage du moteur.' })));
  }

  /* ---------------------------------------------------------------- galerie du dock (espace Édition) */
  let galleryRoot = null;
  function renderGallery() {
    if (!galleryRoot) return;
    galleryRoot.innerHTML = '';
    const head = h('div.ga-head', h('span', { text: SD.gallery.length ? SD.gallery.length + ' image(s) cette session' : 'Les images générées apparaîtront ici.' }), h('div.spacer'),
      N && N.openForgeOutput ? ui.iconBtn('folder-open', 'Ouvrir le dossier des images de Forge', () => N.openForgeOutput(''), '.sm') : null);
    const grid = h('div.ga-grid');
    if (cmpPick && !SD.gallery.includes(cmpPick)) cmpPick = null;
    for (const it of SD.gallery) {
      const cell = h('button.ga-cell' + (it === cmpPick ? '.cmp' : ''), h('img', { src: it.thumb, alt: '', title: (it.info || '').split('\n')[0].slice(0, 160) }), h('span.ga-k', { text: it === cmpPick ? 'à comparer' : it.kind }));
      const use = fn => async () => fn(await galleryItem(it));
      const openMenu = (x, y) => {
        const pickItem = () => { cmpPick = it === cmpPick ? null : it; renderGallery(); if (cmpPick) KS.toast('Choisissez maintenant l’autre image à comparer (clic sur sa vignette)', 'info', 2600); };
        ui.menu([
          cmpPick && cmpPick !== it ? { label: 'Comparer avec l’image choisie', icon: 'compare', action: () => { const a = cmpPick; cmpPick = null; renderGallery(); compareGallery(a, it); } } : null,
          { label: it === cmpPick ? 'Ne plus choisir pour comparer' : cmpPick ? 'Choisir celle-ci pour comparer' : 'Choisir pour comparer', icon: 'compare', action: pickItem },
          { sep: true },
          { label: 'Ouvrir dans Retouche', icon: 'file-plus', action: use(x2 => sendTo('edit', x2)) },
          { label: 'Ajouter comme calque', icon: 'layers', action: use(addAsLayer), disabled: !D() },
          { label: 'Envoyer vers Img2Img', icon: 'image', action: use(x2 => sendTo('img2img', x2)) },
          { label: 'Envoyer vers Inpaint', icon: 'brush', action: use(x2 => sendTo('inpaint', x2)) },
          { label: 'Réutiliser ces réglages (Créer)', icon: 'history', action: () => sendTo('txt2img', it), disabled: !it.info },
          { label: 'Copier l’image', icon: 'copy', action: () => it.blob ? KS.preview.copy(it.blob) : KS.preview.copy(it.canvas) },
        ], x, y);
      };
      cell.addEventListener('click', () => { const r = cell.getBoundingClientRect(); openMenu(r.left, r.bottom + 4); });
      cell.addEventListener('contextmenu', e => { e.preventDefault(); openMenu(e.clientX, e.clientY); });
      grid.appendChild(cell);
    }
    galleryRoot.append(head, grid);
  }
  KS.panels.register('gallery', { title: 'Galerie', build(el) { galleryRoot = h('div.ga'); el.appendChild(galleryRoot); renderGallery(); } });
  /* ---------------------------------------------------------------- dessin IA optionnel dans l'Édition */
  let editorRoot = null, editorStatus = null, editorModel = null;
  function refreshEditorDraw() {
    if (!editorRoot) return;
    const d = D(), active = BUSY || PREPARING;
    if (editorModel) { editorModel.textContent = cat ? 'Modèle : ' + (norm(cat.current.model) || 'modèle actif de Forge') : 'Modèle et réglages du Studio IA.'; editorModel.title = editorModel.textContent; }
    if (editorStatus) editorStatus.textContent = KS.animationBusy ? 'Le moteur IA sera disponible à la fin de la tâche Animation.' : active
      ? (active.stopping || active.canceled ? 'Interruption…' : active.k === 'edit' ? 'Génération du dessin…' : 'Une génération est en cours dans le Studio.')
      : !d ? 'Ouvrez un document pour ajouter un dessin.'
      : FX.editor.target === 'selection' ? (d.selection.bounds ? 'Le dessin sera ajouté dans la sélection, avec un masque modifiable.' : 'Sélectionnez la zone à dessiner avec le lasso ou le rectangle de sélection.')
      : 'Le dessin sera ajouté sur un nouveau calque aux dimensions du document.';
    renderGenButtons();
  }
  function renderEditorDraw() {
    if (!editorRoot) return;
    const scroll = editorRoot.scrollTop;
    const prompt = h('textarea.fx-ta', { rows: 2, placeholder: 'Ex. : une petite étoile dorée sur le mur', spellcheck: false,
      'aria-label': 'Décrivez uniquement ce que vous voulez ajouter ou modifier' });
    prompt.value = FX.editor.prompt;
    prompt.addEventListener('input', () => { FX.editor.prompt = prompt.value; save(); renderGenButtons(); });
    EDIT.genbox = h('div.fx-genbox');
    const loras = [...FX.t2i.prompt.matchAll(/<(?:lora|lyco):([^:>]+)(?::([^>]+))?>/gi)]
      .map(m => m[1] + ' × ' + (m[2] || '1'));
    editorStatus = h('div.edraw-status', { role: 'status', 'aria-live': 'polite' });
    editorModel = h('div.fx-info.edraw-model');
    editorRoot.replaceChildren(
      select('Ajouter le dessin…', [['selection', 'Dans la sélection'], ['layer', 'Sur un nouveau calque']], FX.editor, 'target', '', renderEditorDraw),
      editorStatus, field('Que voulez-vous ajouter ou modifier ?', prompt),
      EDIT.genbox,
      FX.editor.target === 'selection' ? select('Force', [['0.4', 'Douce · 40 %'], ['0.5', 'Équilibrée · 50 %'], ['0.6', 'Marquée · 60 %']], FX.editor, 'strength') : null,
      FX.editor.target === 'selection' ? h('div.fx-info', { text: 'Commencez à 50 %. Augmentez si le changement est trop discret.' }) : null,
      h('details.edraw-details', h('summary', { text: 'Réglages du Studio utilisés' }), editorModel,
        h('div.fx-info', { text: 'Même modèle, styles, LoRA et réglages de génération que Créer. La description du Studio est remplacée par votre demande ci-dessus.' }),
        h('div.fx-info', { text: 'LoRA actifs : ' + (loras.join(', ') || 'aucun') }),
        h('div.fx-info', { text: 'Un LoRA de personnage ou un style peut influencer le sujet. Ajustez-le dans le Studio si nécessaire.' }),
        slider('Variantes', FX.editor, 'variants', 1, 4, 1),
        tbtn('Modifier dans le Studio IA', () => C.openStudioTab('txt2img'), '.sm')));
    refreshEditorDraw(); editorRoot.scrollTop = scroll;
  }
  KS.panels.register('aidraw', {
    title: 'Dessin IA',
    fill: true,
    build(el) {
      editorRoot = h('div.fx.edraw'); el.append(editorRoot);
      editorRoot.addEventListener('keydown', e => { if (e.target.matches('input, textarea, select')) e.stopPropagation(); });
      renderEditorDraw();
    },
    show() { renderEditorDraw(); },
  });
  C.openEditorDraw = async () => { await C.toggleStudio(false); KS.panels.focus('aidraw'); };
  // Tous les accès au remplissage partagent ce panneau et le même moteur.
  C.generativeFill = async prompt => {
    const d = D();
    if (!d?.selection.bounds) return KS.toast('Sélectionnez d’abord la zone à modifier.', 'info');
    FX.editor.target = 'selection';
    if (prompt !== undefined) FX.editor.prompt = String(prompt);
    save(); await C.openEditorDraw();
    if (prompt !== undefined && String(prompt).trim()) return C.editorDraw();
    editorRoot?.querySelector('textarea')?.focus();
  };
  C.editorDraw = async () => {
    if (BUSY || PREPARING) return interrupt();
    const d = D(), mode = FX.editor.target, st = clone(FX.t2i), options = clone(FX.editor);
    // Garder les réseaux actifs, jamais la scène précédente ni ses mots déclencheurs.
    const tags = st.prompt.match(/<(?:lora|lyco):[^>]+>/gi) || [];
    st.prompt = [...new Set([options.prompt.trim(), ...tags])].filter(Boolean).join(' ');
    if (!d) return KS.toast('Ouvrez un document pour ajouter un dessin.', 'info');
    if (!options.prompt.trim()) return KS.toast('Décrivez le dessin à ajouter.', 'info');
    if (mode === 'selection' && !d.selection.bounds) return KS.toast('Sélectionnez d’abord la zone à dessiner.', 'info');
    const width = d.width, height = d.height, alpha = mode === 'selection' ? d.selection.snapshot() : null;
    const initial = alpha ? U.copyCanvas(d.composite()) : null;
    const prep = PREPARING = { k: 'edit', canceled: false }; refreshEditorDraw();
    try {
      if (await trainingRuns() || prep.canceled) return;
      if (!(await ensureCat()) || prep.canceled) return;
      const p = await payloadFor('t2i', { ...st, enable_hr: false, script: 'None',
        kd: mode === 'selection' ? { ...st.kd, enabled: false } : st.kd, n_iter: 1, batch_size: U.clamp(+options.variants || 1, 1, 4) }, true);
      let initBytes = null, maskBytes = null;
      if (alpha) {
        Object.assign(p, { denoising_strength: U.clamp(+options.strength || 0.5, 0.4, 0.6), resize_mode: 0, mask_blur: 4,
          inpainting_mask_invert: 0, inpainting_fill: 1, inpaint_full_res: 1, inpaint_full_res_padding: 32 });
        initBytes = await pngBytes(initial); maskBytes = await pngBytes(maskCanvas(alpha));
      } else { const size = fitDoc(d); p.width = size.w; p.height = size.h; }
      if (prep.canceled) return;
      const response = await runForge('edit', () => alpha ? N.forgeImg2img(url(), p, initBytes, maskBytes) : N.forgeTxt2img(url(), p));
      if (prep.canceled) return;
      if (!response.ok) throw new Error(response.error);
      const items = await toItems(response, alpha ? 'img2img' : 'txt2img', p);
      try {
        const images = items.filter(it => !it.grid);
        if (!images.length) throw new Error('Forge n’a renvoyé aucun dessin.');
        const params = snapParams(st);
        for (const it of images) { it.params = params; const seed = /\bSeed: (\d+)/.exec(it.info || ''); if (seed) it.seed = +seed[1]; }
        pushGallery(images);
        if (!KS.state.docs.includes(d) || d.width !== width || d.height !== height) return KS.toast('Le document a été fermé ou redimensionné. Le dessin reste dans la Galerie.', 'info', 5000);
        const variants = images.map(it => it.canvas.width === width && it.canvas.height === height ? it.canvas : scaled(it.canvas, width, height));
        const layer = G.addGenLayer(d, { variants, rect: { x: 0, y: 0, w: width, h: height }, infos: images.map(it => it.info) }, alpha,
          { name: 'Dessin IA : ' + st.prompt.replace(/<[^>]+>/g, '').trim().slice(0, 32), hist: 'Ajouter un dessin IA', prompt: st.prompt, noMask: !alpha, icon: 'sparkles', preserveDocumentParams: true });
        // La retouche appartient au calque et à la galerie. Le document garde les
        // paramètres de sa génération initiale pour ses prochains envois au Studio.
        if (layer?._gen) layer._gen.params = params;
        KS.toast('Dessin ajouté sur un nouveau calque.', 'ok', 2000);
      } finally { releaseItems({ items }); }
    } catch (e) { if (!prep.canceled) KS.toast('Dessin impossible : ' + e.message, 'err', 6000); }
    finally { if (PREPARING === prep) PREPARING = null; refreshEditorDraw(); renderGenButtons(); }
  };
  for (const ev of ['doc', 'selection']) KS.on(ev, refreshEditorDraw);
  KS.on('animation-gpu', () => { renderGenButtons(); renderExGen(); refreshEditorDraw(); });
  KS.on('studio', on => { if (!on) renderEditorDraw(); });
  KS.genPanel = { render, reload: loadCat, mount() {}, unmount() {} };
  C.openStudioTab = async tab => { FX.tab = tab; save(); await C.toggleStudio(true); render(); };
  C.openGenPanel = () => D() && !SD.on ? C.sendToStudio('img2img') : (async () => { FX.tab = 'img2img'; save(); await C.toggleStudio(true); render(); })();
  // Résultats des commandes de l'espace Édition (remplissage génératif…) : galerie et enregistrement
  G.onResults = async (res, job) => {
    const kind = job.txt ? 'txt2img' : job.mask ? 'inpaint' : 'img2img';
    const items = res.variants.map((c, i) => ({ canvas: c, info: (res.infos || [])[i] || '', kind }));
    pushGallery(items);
    if (KS.prefs.autoSave !== false && N && N.saveOutput) for (let i = 0; i < items.length; i++) {
      try { let bytes = await pngBytes(items[i].canvas); if (items[i].info) bytes = KS.png.writeText(bytes, 'parameters', items[i].info); await N.saveOutput(kind, `${stamp()}-${i}.png`, bytes); } catch { /* facultatif */ }
    }
  };
  // Infos de génération et LoRA : ce sont maintenant des onglets du Studio
  G.applyInfo = async t => { applyInfoTo('t2i', t); FX.tab = 'txt2img'; save(); await C.toggleStudio(true); render(); };
  C.pngInfo = async () => { const d = D(); if (d) OUT.png = { canvas: d.composite(), name: d.name, text: d.genInfo || '', chunks: d.genInfo ? { parameters: d.genInfo } : {} }; FX.tab = 'pnginfo'; save(); await C.toggleStudio(true); render(); };
  // l'entraînement et le Merge sont dans Lora Studio (1.34)
  C.loraStudio = async () => { const r = await N.openLoraStudio(); if (!r.ok) KS.toast(r.error, 'info', 6000); };
  // nom du projet que Lora Studio entraîne, sinon '' (les générations attendent sa fin) ; relu au plus toutes les 10 s
  let trainSeen = { at: 0, name: '' };
  KS.trainingRunning = async () => {
    if (!N || !N.loraTrainingRunning) return '';
    if (Date.now() - trainSeen.at < 10000) return trainSeen.name;
    const r = await N.loraTrainingRunning().catch(() => null);
    const run = r && r.ok && r.running;
    trainSeen = { at: Date.now(), name: run ? (run.trigger || run.project) : '' };
    return trainSeen.name;
  };
  // Merge : relire les modèles de Forge après une fusion, et charger le checkpoint obtenu
  SD.refreshModels = async () => {
    if (!KS.engine || !KS.engine.ready()) return false;
    await N.forgeRefreshCheckpoints(url()); await N.forgeRefreshLoras(url()); await loadCat();
    return true;
  };
  SD.useCheckpoint = async file => {
    const want = String(file || '').replace(/\\/g, '/').toLowerCase();
    const m = cat && cat.models.find(x => String(x.file || '').replace(/\\/g, '/').toLowerCase().endsWith('/' + want) || String(x.file || '').replace(/\\/g, '/').toLowerCase().endsWith(want));
    if (!m) return KS.toast('Checkpoint introuvable dans Forge : relisez les modèles (🔄)', 'err', 5000);
    await setOptions({ sd_model_checkpoint: m.title }, 'Checkpoint : ' + norm(m.title) + ' (chargé à la prochaine génération)');
  };
  KS.studioApi = {
    isBusy: () => !!(BUSY || PREPARING),
    interrupt,
    addToPrompt: async (text) => { const st = FX.t2i; st.prompt = (st.prompt ? st.prompt.replace(/\s+$/, '') + ' ' : '') + text; save(); FX.tab = 'txt2img'; await C.toggleStudio(true); if (N.forgeRefreshLoras && KS.engine && KS.engine.ready()) { await N.forgeRefreshLoras(url()); await loadCat(); } render(); },
    reloadCat: loadCat, cat: () => cat, selected: () => selItem('t2i'),
    // une image venue d'un autre espace (sortie ComfyUI…) vers img2img, Inpaint, Extras ou txt2img
    sendCanvas: (canvas, info, target = 'img2img') => sendTo(target, { canvas, info: info || '', kind: 'import' }),
  };

  /* ---------------------------------------------------------------- paramètres des commandes de l'espace Édition (remplissage génératif…) */
  G.extraParams = (st, kind) => {
    const p = {};
    const bc = U.clamp(+st.batchCount || 1, 1, 16); if (bc > 1) p.n_iter = bc;
    if (st.varStrength > 0) { p.subseed = st.varSeed != null && +st.varSeed >= 0 ? +st.varSeed : -1; p.subseed_strength = +st.varStrength; }
    if (kind === 'txt' && st.hr && st.hr.enabled) {
      Object.assign(p, { enable_hr: true, hr_scale: +st.hr.scale || 1.5, hr_upscaler: st.hr.upscaler || 'Latent', hr_second_pass_steps: +st.hr.steps || 0, denoising_strength: +st.hr.denoise || 0.4, hr_resize_x: 0, hr_resize_y: 0,
        // valeurs par défaut de l'interface de Forge : sans elles, son API plante (« NoneType is not iterable »)
        hr_additional_modules: ['Use same choices'], hr_checkpoint_name: 'Use same checkpoint' });
      if (st.hr.cfg) p.hr_cfg = +st.hr.cfg;
    }
    return p;
  };
  const scripts0 = G.scriptsFor;
  G.scriptsFor = async (st, kind, opt = {}) => {
    const s = await scripts0(st, kind, opt);
    if (st.neverOom) s['Never OOM Integrated'] = { args: [true, true] };
    if (st.softInpaint && kind === 'inpaint') s['Soft inpainting'] = { args: [true, 1, 0.5, 4, 0, 0.5, 2] };
    return s;
  };

  /* ---------------------------------------------------------------- bascule Édition ⇄ Studio IA */
  C.studioGenerate = () => {
    if (BUSY || PREPARING) return interrupt();
    if (!SD.on) return C.sendToStudio('img2img');
    if (FX.tab === 'extras') return runExtras();
    if (FX.tab === 'txt2img' || FX.tab === 'img2img') return generate(FX.tab === 'img2img' ? 'i2i' : 't2i');
  };
  C.toggleStudio = async (on = !SD.on) => {
    if (on === SD.on && (!on || root)) return;
    SD.on = on;
    document.body.classList.toggle('studio', on);
    if (on) {
      mountPage(); render();
      loadCached();
      if (KS.engine && !KS.animationBusy) KS.engine.ensure({ quiet: true }).then(ok => { if (ok && (!cat || cat.stale)) loadCat().then(warm); else if (ok) { renderTop(); warm(); } });
      else loadCat();
    } else {
      CTX.i2i.finishStroke && CTX.i2i.finishStroke();
      CTX.i2i.finishStroke = null; CTX.i2i.paintDraw = null;
      if (root) { root.replaceChildren(); root.className = ''; }
      for (const c of Object.values(CTX)) { c.left = null; c.genbox = null; c.promptTa = null; c.modes = null; }
      els.out = null; els.i2iOut = null;
    }
    KS.prefs.studio = on; KS.prefs.save();
    switchBtns.forEach(b => b.classList.toggle('on', (b.dataset.v === 'studio') === on));
    KS.emit('studio', on);
    window.dispatchEvent(new Event('resize'));
  };
  const switchBtns = [];
  KS.on('ui-ready', () => {
    const box = KS.$('#workspace-actions'); if (!box) return;
    const sw = h('div.ws-switch');
    for (const [v, label] of [['edit', 'Retouche'], ['studio', 'Studio IA']]) {
      const b = h('button.ws-btn', { 'data-v': v, text: label }); b.addEventListener('click', () => C.toggleStudio(v === 'studio'));
      switchBtns.push(b); sw.appendChild(b);
    }
    switchBtns[0].classList.add('on');
    const send = h('button.ws-btn.ws-to-studio', { text: 'Envoyer au Studio ▸', disabled: !D() });
    send.addEventListener('click', () => sendMenu(send));
    KS.on('doc', () => { send.disabled = !D(); });
    box.prepend(send, sw);
    // au lancement : Projet par défaut ; le Studio ne rouvre que si c'est l'écran choisi dans les Préférences
    if (KS.prefs.startPage === 'studio' && !D()) setTimeout(() => C.toggleStudio(true), 300);
  });
  // l'état du moteur est relu toutes les 15 s : seuls le voyant et la colonne bougent (jamais l'invite en cours de frappe)
  KS.on('engine', E => {
    if (SD.on) renderTop();
    refreshEditorDraw();
    if (!E.ready()) warmed = false;
    if (E.ready() && (!cat || cat.stale) && !loading && SD.on) loadCat().then(warm); else if (E.ready() && SD.on) warm(); else if (!cat) renderCtx(CTX.i2i);
  });
  const onDoc = U.debounce(() => { if (SD.on && FX.tab === 'img2img') { renderModeTools(); if (FX.i2i.autoSize) renderCtx(CTX.i2i); } }, 150);
  for (const ev of ['doc', 'selection']) KS.on(ev, onDoc);
  document.addEventListener('keydown', e => {
    const inEditor = !SD.on && !KS.ws?.cur && !document.body.classList.contains('suite-home') && KS.panels.isVisible('aidraw') && (editorRoot && editorRoot.contains(e.target) || !e.target.matches('input, textarea, select, [contenteditable="true"]'));
    if ((!SD.on && !inEditor) || KS.modalOpen() || e.isComposing) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.altKey && !e.shiftKey) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat) inEditor ? C.editorDraw() : C.studioGenerate();
    } else if ((BUSY || PREPARING) && e.key === 'Escape' && !e.defaultPrevented) interrupt();
  }, true);
})();

// Outils communs : espace de noms, bus d'événements, préférences, DOM, temps, menus, fenêtres modales.
'use strict';
const KC = window.KC = { native: window.kcNative || null, cmd: {} };

/* ---------------------------------------------------------------- bus */
(() => {
  const handlers = {};
  KC.on = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); return fn; };
  KC.off = (ev, fn) => { const h = handlers[ev]; if (h) { const i = h.indexOf(fn); if (i >= 0) h.splice(i, 1); } };
  KC.emit = (ev, ...args) => { (handlers[ev] || []).slice().forEach(fn => { try { fn(...args); } catch (e) { console.error(ev, e); } }); };
})();

/* ---------------------------------------------------------------- préférences */
KC.prefs = (() => {
  const defaults = {
    theme: 'dark', timeFormat: 'smpte', imageLength: 5, genLength: 5, transitionLength: 1, autoCrossfade: true,
    snap: true, ripple: 'off', ignoreGroups: false, quality: 'preview', autoProxy: true, autosave: 2, uiScale: 1,
    dockW: 460, upperH: 0, headerW: 230, recent: [], dockTab: 'media', mediaView: 'grid', explorerDir: '',
    workspace: 'edit', inspector: true, savedLayouts: [],
    loop: false, overlays: { grid: false, safe: false }, renderFormat: 'mp4-h264', renderTemplate: '', renderDir: '',
    projectDefaults: null, skipUpdate: '', followCursor: true, scrubAudio: true,
  };
  let data = {};
  try { data = JSON.parse(localStorage.getItem('kaneclip.prefs') || '{}'); } catch { data = {}; }
  const p = Object.assign({}, defaults, data);
  p.save = () => { try { const o = {}; for (const k in p) if (typeof p[k] !== 'function') o[k] = p[k]; localStorage.setItem('kaneclip.prefs', JSON.stringify(o)); } catch { /* stockage indisponible */ } };
  return p;
})();

/* ---------------------------------------------------------------- maths */
const U = KC.util = {};
U.clamp = (v, a, b) => v < a ? a : v > b ? b : v;
U.lerp = (a, b, t) => a + (b - a) * t;
U.uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
U.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
U.fmtBytes = n => n < 1024 ? n + ' o' : n < 1048576 ? (n / 1024).toFixed(1) + ' Ko' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' Mo' : (n / 1073741824).toFixed(2) + ' Go';
U.dbToGain = db => db <= -60 ? 0 : Math.pow(10, db / 20);
U.gainToDb = g => g <= 0.001 ? -Infinity : 20 * Math.log10(g);
U.fmtDb = db => !isFinite(db) || db <= -60 ? '-Inf.' : (db > 0 ? '+' : '') + db.toFixed(1) + ' dB';
U.base = p => String(p || '').split(/[\\/]/).pop();
U.dir = p => { const s = String(p || ''); const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/')); return i > 0 ? s.slice(0, i) : s; };
U.ext = p => (String(p || '').match(/\.([^.\\/]+)$/) || [])[1]?.toLowerCase() || '';
U.stripExt = n => String(n || '').replace(/\.[^.]+$/, '');
U.mediaUrl = p => 'kcm://f/' + encodeURIComponent(p);
U.fmtNum = (v, d = 2) => Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
U.deep = o => JSON.parse(JSON.stringify(o));
U.esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------------------------------------------------------------- temps */
// Formats : smpte (HH:MM:SS;II), sec (HH:MM:SS.mmm), frames (nombre d'images)
U.fmtTime = (t, fps, fmt = KC.prefs.timeFormat) => {
  fps = fps || 30;
  const neg = t < 0; t = Math.abs(t);
  if (fmt === 'frames') return (neg ? '-' : '') + Math.round(t * fps);
  if (fmt === 'sec') {
    const ms = Math.round(t * 1000);
    const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, r = ms % 1000;
    return (neg ? '-' : '') + `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
  }
  const nf = Math.round(fps);
  const total = Math.round(t * fps);
  const f = total % nf, secs = Math.floor(total / nf);
  const h = Math.floor(secs / 3600), m = Math.floor(secs / 60) % 60, s = secs % 60;
  return (neg ? '-' : '') + `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')};${String(f).padStart(2, '0')}`;
};
// Texte saisi -> secondes (accepte 1:23, 00:01:02;12, 12.5, 300f)
U.parseTime = (str, fps) => {
  str = String(str || '').trim().replace(',', '.');
  if (!str) return null;
  fps = fps || 30;
  if (/^\d+f$/i.test(str)) return parseInt(str, 10) / fps;
  const smpte = str.match(/^(?:(\d+):)?(?:(\d+):)?(\d+)[;:](\d+)$/);
  if (smpte && str.includes(';')) {
    const parts = str.split(/[:;]/).map(Number);
    const f = parts.pop(), s = parts.pop() || 0, m = parts.pop() || 0, h = parts.pop() || 0;
    return h * 3600 + m * 60 + s + f / Math.round(fps);
  }
  const parts = str.split(':');
  if (parts.some(x => x === '' || isNaN(Number(x)))) return null;
  let t = 0;
  for (const x of parts) t = t * 60 + Number(x);
  return t;
};
U.fmtDur = t => {
  t = Math.max(0, t || 0);
  const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = Math.floor(t % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
U.fmtFps = f => {
  const r = Math.round(f * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : r.toFixed(3).replace('.', ',');
};

/* ---------------------------------------------------------------- DOM */
KC.$ = (sel, root = document) => root.querySelector(sel);
KC.$$ = (sel, root = document) => [...root.querySelectorAll(sel)];
// h('div.cls#id', {attrs, on:{}}, enfants...)
KC.h = (tag, attrs, ...kids) => {
  const m = tag.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const e = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) for (const part of m[2].match(/[.#][\w-]+/g)) {
    if (part[0] === '.') e.classList.add(part.slice(1)); else e.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'on') for (const ev in v) e.addEventListener(ev, v[ev]);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k in e && k !== 'list' && k !== 'form') { try { e[k] = v; } catch { e.setAttribute(k, v); } }
    else e.setAttribute(k, v === true ? '' : v);
  }
  const add = k => {
    if (k == null || k === false) return;
    if (Array.isArray(k)) k.forEach(add);
    else e.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  };
  kids.forEach(add);
  return e;
};
const h = KC.h;

/* ---------------------------------------------------------------- retours visuels */
KC.toast = (msg, type = 'info', ms = 2800) => {
  const icon = type === 'err' ? 'alert' : type === 'ok' ? 'check' : 'info';
  const t = h('div.toast.' + type, { html: KC.icon ? KC.icon(icon) : '' });
  t.appendChild(document.createTextNode(msg));
  KC.$('#toasts').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .25s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 260); }, ms);
};
KC.busy = async (fn) => {
  const b = h('div.busy', h('div.spin'));
  document.body.appendChild(b);
  await new Promise(r => setTimeout(r, 16));
  try { return await fn(); } finally { b.remove(); }
};

/* ---------------------------------------------------------------- menus */
// items : [{label, key, icon, action, disabled, checked, sub:[...]}, '-' , {header}]
KC.menu = (() => {
  let stack = [];
  const closeAll = () => { stack.forEach(m => m.remove()); stack = []; KC.emit('menu-closed'); };
  function open(items, x, y, level = 0, opts = {}) {
    while (stack.length > level) stack.pop().remove();
    const m = h('div.menu');
    for (const it of items) {
      if (!it) continue;
      if (it === '-') { m.appendChild(h('div.sep')); continue; }
      if (it.header) { m.appendChild(h('div.hdr', { text: it.header })); continue; }
      const dis = typeof it.disabled === 'function' ? it.disabled() : it.disabled;
      const chk = typeof it.checked === 'function' ? it.checked() : it.checked;
      const ico = chk ? KC.icon('check') : it.icon ? KC.icon(it.icon) : '';
      const row = h('div.mi' + (dis ? '.dis' : ''), h('span.ico', { html: ico }), h('span.lb', { text: it.label }),
        it.key ? h('span.k', { text: it.key }) : null, it.sub ? h('span.arrow', { text: '›' }) : null);
      if (it.sub) {
        row.addEventListener('mouseenter', () => {
          const r = row.getBoundingClientRect();
          open(typeof it.sub === 'function' ? it.sub() : it.sub, r.right - 2, r.top - 5, level + 1);
          KC.$$('.mi.hl', m).forEach(e => e.classList.remove('hl')); row.classList.add('hl');
        });
      } else {
        row.addEventListener('mouseenter', () => { while (stack.length > level + 1) stack.pop().remove(); KC.$$('.mi.hl', m).forEach(e => e.classList.remove('hl')); });
        row.addEventListener('click', e => { e.stopPropagation(); closeAll(); if (it.action) it.action(); });
      }
      m.appendChild(row);
    }
    KC.$('#popups').appendChild(m);
    const r = m.getBoundingClientRect();
    if (x + r.width > innerWidth - 4) x = level ? Math.max(4, x - r.width - (opts.parentW || 230)) : innerWidth - r.width - 4;
    if (y + r.height > innerHeight - 4) y = Math.max(4, innerHeight - r.height - 4);
    m.style.left = x + 'px'; m.style.top = y + 'px';
    stack.push(m);
    return m;
  }
  window.addEventListener('mousedown', e => { if (stack.length && !e.target.closest('.menu') && !e.target.closest('#menubar')) closeAll(); }, true);
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && stack.length) { closeAll(); e.stopPropagation(); } }, true);
  window.addEventListener('blur', () => closeAll());
  return { open: (items, x, y) => open(items, x, y, 0), close: closeAll, isOpen: () => stack.length > 0 };
})();
KC.context = (e, items) => { e.preventDefault(); e.stopPropagation(); KC.menu.open(items, e.clientX, e.clientY); };

/* ---------------------------------------------------------------- fenêtres modales */
// buttons : [{label, primary, danger, action (retourne false pour garder ouvert), value}]
KC.modal = ({ title, body, buttons = [{ label: 'OK', primary: true }], onClose, onKey, width, escValue = null, left }) => {
  let resolveFn;
  const done = new Promise(r => { resolveFn = r; });
  const back = h('div.modal-back');
  const box = h('div.modal', { style: width ? { width: width + 'px' } : null });
  const foot = h('div.modal-foot');
  if (left) foot.appendChild(left);
  if (left) foot.appendChild(h('div.sp'));
  const close = (val) => {
    if (!back.isConnected) return;
    back.remove(); document.removeEventListener('keydown', key, true);
    if (onClose) onClose(val);
    resolveFn(val);
  };
  for (const b of buttons) {
    const btn = h('button.btn' + (b.primary ? '.primary' : '') + (b.danger ? '.danger' : ''), { text: b.label });
    btn.addEventListener('click', async () => {
      if (b.action) { const r = await b.action(); if (r === false) return; }
      close(b.value !== undefined ? b.value : b.label);
    });
    foot.appendChild(btn);
  }
  box.append(h('div.modal-head', { text: title || '' }), h('div.modal-body', body), foot);
  back.appendChild(box);
  const key = e => {
    // fenêtres empilées (aperçu au-dessus de « Rendre en tant que ») : seule celle du dessus répond au clavier
    const top = back.parentElement && back.parentElement.lastElementChild;
    if (top && top !== back && top.classList.contains('modal-back')) return;
    if (onKey && onKey(e) === true) { e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(escValue); }
    else if (e.key === 'Enter' && !(e.target && e.target.tagName === 'TEXTAREA')) {
      const p = buttons.find(b => b.primary);
      if (p) { e.preventDefault(); e.stopPropagation(); foot.querySelector('.btn.primary').click(); }
    }
    e.stopPropagation();
  };
  document.addEventListener('keydown', key, true);
  KC.$('#modals').appendChild(back);
  setTimeout(() => { const f = box.querySelector('input:not([type=checkbox]):not([type=range]), select, textarea'); if (f) { f.focus(); if (f.select) f.select(); } }, 20);
  return { close, done, el: box };
};
KC.confirm = (title, text, okLabel = 'OK', danger = false) => KC.modal({
  title, body: h('div', { style: { maxWidth: '460px', lineHeight: '1.5' }, text }),
  buttons: [{ label: 'Annuler', value: false }, { label: okLabel, primary: !danger, danger, value: true }], escValue: false,
}).done;
KC.alert = (title, text) => KC.modal({ title, body: h('div', { style: { maxWidth: '520px', lineHeight: '1.5', whiteSpace: 'pre-wrap' }, text }) }).done;
KC.prompt = (title, label, value = '') => {
  const inp = h('input.field', { value, style: { width: '320px' } });
  return KC.modal({
    title, body: h('div', h('div', { style: { marginBottom: '8px', color: 'var(--text-2)' }, text: label }), inp),
    buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, action: () => { inp._v = inp.value; } }],
  }).done.then(v => v === 'OK' ? inp._v : null);
};

/* ---------------------------------------------------------------- glisser (souris) */
// U.drag(e, move(dx, dy, ev), up(ev)) : capture le pointeur jusqu'au relâchement
U.drag = (e, move, up) => {
  const x0 = e.clientX, y0 = e.clientY;
  const mm = ev => move && move(ev.clientX - x0, ev.clientY - y0, ev);
  const mu = ev => { window.removeEventListener('pointermove', mm); window.removeEventListener('pointerup', mu); window.removeEventListener('pointercancel', mu); if (up) up(ev); };
  window.addEventListener('pointermove', mm);
  window.addEventListener('pointerup', mu);
  window.addEventListener('pointercancel', mu);
};
U.isTyping = e => { const t = e.target; return t && (t.tagName === 'INPUT' && !['range', 'checkbox', 'color', 'button'].includes(t.type) || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
U.loadImage = src => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('Image illisible')); i.src = src; });
U.canvas = (w, hh) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(hh)); return c; };
U.blob = (c, type = 'image/png', q) => new Promise(r => c.toBlob(r, type, q));

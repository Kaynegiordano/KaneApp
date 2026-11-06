// Aperçu partagé du Studio : zoom au pointeur, taille réelle, ajustement et déplacement.
'use strict';
(() => {
  const states = new WeakMap(), instances = new Set();
  let space = false;
  document.addEventListener('keydown', e => { if (e.code === 'Space' && e.target.closest?.('.iv-viewport')) { space = true; e.preventDefault(); } }, true);
  document.addEventListener('keyup', e => { if (e.code === 'Space') space = false; }, true);
  window.addEventListener('blur', () => { space = false; });
  const detached = new MutationObserver(() => { for (const i of instances) if (!i.host.isConnected) { i.observer.disconnect(); instances.delete(i); } });
  detached.observe(document.documentElement, { subtree: true, childList: true });
  // copie d'un canevas pour l'afficher ailleurs (un tracé GPU, au lieu d'un encodage PNG qui fige l'interface)
  const copyCanvas = c => { const o = document.createElement('canvas'); o.width = c.width; o.height = c.height; o.getContext('2d').drawImage(c, 0, 0); return o; };
  KS.preview = { copyCanvas, open(media, width, height, { title = 'Aperçu plein écran' } = {}) {
    const image = media.tagName === 'CANVAS' ? copyCanvas(media) : KS.h('img', { src: media.currentSrc || media.src, alt: 'Image en plein écran' });
    const host = KS.h('div.iv-fullscreen');
    const previous = document.activeElement;
    const modal = KS.modal({ title, body: host, noFoot: true,
      onClose: () => previous?.isConnected && previous.focus() });
    modal.back.classList.add('iv-lightbox');
    // Le second clic d'un double-clic d'habitude ne doit pas refermer ce qu'un clic vient d'ouvrir.
    const opened = performance.now(), settled = () => performance.now() - opened > 450;
    modal.back.addEventListener('pointerdown', e => { if (e.target === modal.back && settled()) modal.close(null); });
    const preview = KS.preview.mount(host, image, { width, height, fullscreen: false });
    preview.area.addEventListener('click', e => { if (e.target === preview.area && !e.defaultPrevented && settled()) modal.close(); });
    preview.area.focus();
    return modal;
  }, mount(host, media, { identity = media, width, height, paint = false, fullscreen = true, clickOpen = false, menu = null } = {}) {
    const h = KS.h;
    let state = states.get(identity); if (!state) { state = { scale: 1, x: 0, y: 0, fit: true }; states.set(identity, state); }
    host.classList.add('iv-host');
    const area = h('div.iv-viewport', { tabIndex: 0, 'aria-label': paint ? 'Aperçu du masque · molette : zoom · bouton central ou Espace : déplacer' : 'Aperçu · molette : zoom · glisser : déplacer' });
    media.classList.add('iv-media'); area.append(media);
    const label = h('span.iv-scale', { text: 'Ajusté', 'aria-live': 'polite' });
    const button = (text, title, fn) => { const b = h('button', { text, title, type: 'button' }); b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); fn(); }); return b; };
    let drag = null, dragged = false;
    const size = () => ({ w: width || media.naturalWidth || media.width || 1, h: height || media.naturalHeight || media.height || 1 });
    const render = () => {
      const s = size(), w = area.clientWidth, hh = area.clientHeight; if (!w || !hh) return;
      if (state.fit) { state.scale = Math.min((w - 16) / s.w, (hh - 16) / s.h, 1); state.x = state.y = 0; }
      state.scale = Math.max(.01, state.scale);
      media.style.width = s.w + 'px'; media.style.height = s.h + 'px';
      media.style.transform = `translate(-50%, -50%) translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
      label.textContent = Math.round(state.scale * 100) + ' %'; area.dataset.scale = state.scale;
    };
    const zoom = (value, clientX, clientY) => {
      const rect = area.getBoundingClientRect(), x = clientX == null ? 0 : clientX - rect.left - rect.width / 2, y = clientY == null ? 0 : clientY - rect.top - rect.height / 2;
      const next = Math.min(16, Math.max(.01, value)), k = next / state.scale;
      state.x = x - (x - state.x) * k; state.y = y - (y - state.y) * k; state.scale = next; state.fit = false; render();
    };
    const controls = h('div.iv-controls', button('−', 'Réduire le zoom', () => zoom(state.scale / 1.25)), label,
      button('+', 'Augmenter le zoom', () => zoom(state.scale * 1.25)), button('Image entière', 'Réinitialiser le zoom et afficher toute l’image dans son cadre', () => { state.fit = true; render(); }),
      button('100 %', 'Taille réelle : un pixel de l’image par pixel d’écran', () => { state.x = state.y = 0; zoom(1); }),
      fullscreen ? button('⛶', 'Voir l’image en plein écran · cliquer autour ou Échap pour fermer', () => KS.preview.open(media, size().w, size().h)) : null);
    if (fullscreen) {
      media.title = clickOpen ? 'Clic : voir l’image en plein écran · glisser : déplacer' : 'Double-clic : voir l’image en plein écran';
      if (clickOpen) area.classList.add('iv-click-open');
      // La capture du pointeur utilisée pour déplacer l'image redirige le double-clic
      // vers le cadre. Écouter ce cadre couvre les vrais clics comme les images zoomées.
      else area.addEventListener('dblclick', e => { e.preventDefault(); e.stopPropagation(); KS.preview.open(media, size().w, size().h); });
      label.title = 'Voir l’image en plein écran'; label.tabIndex = 0; label.setAttribute('role', 'button');
      label.addEventListener('click', e => { e.stopPropagation(); KS.preview.open(media, size().w, size().h); });
      label.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); KS.preview.open(media, size().w, size().h); } }); }
    controls.addEventListener('pointerdown', e => e.stopPropagation());
    controls.addEventListener('keydown', e => e.stopPropagation());
    host.append(controls, area);
    area.addEventListener('wheel', e => { e.preventDefault(); e.stopPropagation(); zoom(state.scale * Math.exp(-e.deltaY * .002), e.clientX, e.clientY); }, { passive: false });
    area.addEventListener('pointerdown', e => {
      if (e.button !== 1 && !(e.button === 0 && (!paint || space))) return;
      e.preventDefault(); e.stopImmediatePropagation(); area.focus();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, px: state.x, py: state.y }; dragged = false;
    }, true);
    area.addEventListener('pointermove', e => {
      if (!drag || drag.id !== e.pointerId) return; e.preventDefault(); e.stopPropagation();
      if (!dragged) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) <= 3) return;
        dragged = true;
        try { area.setPointerCapture(e.pointerId); } catch { /* pointeur synthétique */ }
      }
      state.fit = false; state.x = drag.px + e.clientX - drag.x; state.y = drag.py + e.clientY - drag.y; render();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) area.addEventListener(type, e => { if (drag?.id === e.pointerId) drag = null; });
    area.addEventListener('pointerleave', () => { if (!dragged) drag = null; });
    area.addEventListener('click', e => {
      if (dragged) { e.preventDefault(); e.stopPropagation(); dragged = false; }
      else if (fullscreen && clickOpen && e.button === 0) { e.preventDefault(); e.stopPropagation(); KS.preview.open(media, size().w, size().h); }
    });
    // clic droit : copier l'image (presse-papiers Windows, PNG en pleine résolution), plus les actions propres à l'appelant
    if (!paint) area.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      KS.ui.menu([{ label: 'Copier l’image', icon: 'copy', action: () => KS.preview.copy(media, size().w, size().h) }, ...((menu && menu()) || [])], e.clientX, e.clientY);
    });
    area.addEventListener('keydown', e => {
      if (e.key === '+' || e.key === '=') { e.preventDefault(); e.stopPropagation(); zoom(state.scale * 1.25); }
      else if (e.key === '-') { e.preventDefault(); e.stopPropagation(); zoom(state.scale / 1.25); }
      else if (e.key === '0') { e.preventDefault(); e.stopPropagation(); state.fit = true; render(); }
    });
    const observer = new ResizeObserver(render); observer.observe(area); instances.add({ host, observer });
    media.addEventListener('load', render); requestAnimationFrame(render);
    return { area, fit() { state.fit = true; render(); }, zoom, state };
  }, async copy(media, width, height) {
    try {
      // PNG déjà encodé (galerie) : copié tel quel
      if (media instanceof Blob) { await navigator.clipboard.write([new ClipboardItem({ 'image/png': media })]); KS.toast('Image copiée', 'ok', 1100); return; }
      let c = media;
      if (!(media instanceof HTMLCanvasElement)) {
        if (media.decode) await media.decode().catch(() => {});
        c = document.createElement('canvas'); c.width = width || media.naturalWidth || media.width; c.height = height || media.naturalHeight || media.height;
        c.getContext('2d').drawImage(media, 0, 0, c.width, c.height);
      }
      const blob = await new Promise((ok, ko) => c.toBlob(b => b ? ok(b) : ko(new Error('Image illisible')), 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      KS.toast('Image copiée', 'ok', 1100);
    } catch (e) { KS.toast('Copie impossible : ' + e.message, 'err'); }
  },
  // Comparer deux images { src | canvas, w, h, label } : rideau à glisser ou côte à côte, zoom et déplacement communs.
  // B est affichée à la taille de A (un résultat agrandi se compare à son original pixel pour pixel).
  compare(a, b, { title = 'Comparer' } = {}) {
    const h = KS.h, W = a.w, H = a.h;
    const media = m => { const el = m.canvas ? copyCanvas(m.canvas) : h('img', { src: m.src, alt: m.label || '' }); el.classList.add('iv-media'); el.draggable = false; return el; };
    const st = { scale: 1, x: 0, y: 0, fit: true, split: 0.5, side: false };
    const ma = media(a), mb = media(b);
    const pa = h('div.iv-cmp-pane', ma), pb = h('div.iv-cmp-pane.iv-cmp-b', mb);
    const handle = h('div.iv-cmp-handle', { title: 'Glisser pour comparer' }, h('span'));
    const tag = (m, cls) => h('span.iv-cmp-tag' + cls, { text: m.label || '' });
    const ta = tag(a, '.a'), tb = tag(b, '.b');
    const area = h('div.iv-viewport.iv-cmp', { tabIndex: 0, 'aria-label': 'Comparaison · glisser la ligne ou ← → · molette : zoom · glisser l’image : déplacer' }, pa, pb, handle, ta, tb);
    const label = h('span.iv-scale', { text: 'Ajusté' });
    const button = (text, tip, fn) => { const el = h('button', { text, title: tip, type: 'button' }); el.addEventListener('click', e => { e.preventDefault(); fn(); }); return el; };
    const render = () => {
      const w = area.clientWidth, hh = area.clientHeight; if (!w || !hh) return;
      const pw = st.side ? w / 2 : w;
      if (st.fit) { st.scale = Math.min((pw - 16) / W, (hh - 16) / H, 1); st.x = st.y = 0; }
      for (const m of [ma, mb]) { m.style.width = W + 'px'; m.style.height = H + 'px'; m.style.transform = `translate(-50%, -50%) translate(${st.x}px, ${st.y}px) scale(${st.scale})`; }
      area.classList.toggle('side', st.side);
      pb.style.clipPath = st.side ? '' : `inset(0 0 0 ${Math.round(st.split * w)}px)`;
      handle.style.left = Math.round(st.split * w) + 'px'; handle.hidden = st.side;
      label.textContent = Math.round(st.scale * 100) + ' %'; area.dataset.scale = st.scale; area.dataset.split = st.split.toFixed(3);
    };
    const zoom = (value, cx, cy) => {
      const r = area.getBoundingClientRect(), pw = st.side ? r.width / 2 : r.width;
      const left = st.side && cx != null && cx - r.left > pw ? r.left + pw : r.left;
      const x = cx == null ? 0 : cx - left - pw / 2, y = cy == null ? 0 : cy - r.top - r.height / 2;
      const next = Math.min(16, Math.max(.01, value)), k = next / st.scale;
      st.x = x - (x - st.x) * k; st.y = y - (y - st.y) * k; st.scale = next; st.fit = false; render();
    };
    const modes = h('div.iv-cmp-modes',
      button('Rideau', 'Une seule image, coupée par une ligne à glisser', () => { st.side = false; st.fit = true; sync(); render(); }),
      button('Côte à côte', 'Les deux images l’une à côté de l’autre, même zoom', () => { st.side = true; st.fit = true; sync(); render(); }));
    const sync = () => { const [r, s] = modes.children; r.classList.toggle('on', !st.side); s.classList.toggle('on', st.side); };
    const controls = h('div.iv-controls', modes, h('div.spacer'), button('−', 'Réduire le zoom', () => zoom(st.scale / 1.25)), label,
      button('+', 'Augmenter le zoom', () => zoom(st.scale * 1.25)), button('Image entière', 'Afficher toute l’image', () => { st.fit = true; render(); }),
      button('100 %', 'Taille réelle', () => { st.x = st.y = 0; zoom(1); }));
    const host = h('div.iv-fullscreen.iv-host', controls, area);
    const modal = KS.modal({ title, body: host, noFoot: true });
    modal.back.classList.add('iv-lightbox');
    let drag = null;
    area.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.button !== 1) return;
      e.preventDefault(); area.focus();
      const onLine = !st.side && e.button === 0 && Math.abs(e.clientX - handle.getBoundingClientRect().left - 1) < 14;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, px: st.x, py: st.y, line: onLine };
      try { area.setPointerCapture(e.pointerId); } catch { /* pointeur synthétique */ }
    });
    area.addEventListener('pointermove', e => {
      if (!drag || drag.id !== e.pointerId) return;
      const r = area.getBoundingClientRect();
      if (drag.line) st.split = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      else { st.fit = false; st.x = drag.px + e.clientX - drag.x; st.y = drag.py + e.clientY - drag.y; }
      render();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) area.addEventListener(type, e => { if (drag?.id === e.pointerId) drag = null; });
    area.addEventListener('wheel', e => { e.preventDefault(); zoom(st.scale * Math.exp(-e.deltaY * .002), e.clientX, e.clientY); }, { passive: false });
    area.addEventListener('keydown', e => {
      const step = e.shiftKey ? 0.1 : 0.02;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); st.split = Math.min(1, Math.max(0, st.split + (e.key === 'ArrowLeft' ? -step : step))); render(); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(st.scale * 1.25); }
      else if (e.key === '-') { e.preventDefault(); zoom(st.scale / 1.25); }
      else if (e.key === '0') { e.preventDefault(); st.fit = true; render(); }
    });
    const observer = new ResizeObserver(render); observer.observe(area);
    modal.done.then(() => { observer.disconnect(); a.release?.(); b.release?.(); });
    for (const m of [ma, mb]) m.addEventListener?.('load', render);
    sync(); requestAnimationFrame(() => { render(); area.focus(); });
    return Object.assign(modal, { state: st, area, render });
  } };
})();

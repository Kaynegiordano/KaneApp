// Document : calques (du bas vers le haut), sélection, historique, vue, repères,
// tracés et couches alpha.
//
// Groupes : la liste reste plate. Un calque de groupe (kind 'group') est placé
// juste au-dessus de ses descendants, qui sont contigus sous lui ; chaque calque
// connaît son groupe parent par `parent` (id ou null).
'use strict';
(() => {
  const U = KS.util;

  class Doc {
    constructor({ name = 'Sans titre', width = 1920, height = 1080 } = {}) {
      this.id = U.uid();
      this.name = name;
      this.width = width; this.height = height;
      this.layers = [];
      this.activeId = null;
      this.selectedIds = new Set();   // sélection multiple de calques (inclut l'actif)
      this.selection = new KS.Selection(this);
      this.history = new KS.Hist.History(this);
      this.view = { zoom: 1, x: 0, y: 0, fitted: false };
      this.guides = { h: [], v: [] };
      this.paths = [];                // tracés : { id, name, subpaths: [{ closed, pts: [{x,y,ix,iy,ox,oy}] }] }
      this.activePathId = null;
      this.alphas = [];               // couches alpha : { id, name, canvas (gris) }
      this.channelView = null;        // null = RVB ; sinon { r, g, b } visibles
      this.alphaEdit = null;          // couche alpha en cours de modification (id)
      this.path = null;
      this.format = null;
      this.dirty = false;
      this.revision = 0;
      this.compositeCanvas = U.canvas(width, height);
      this.compositeDirty = true;
      this.quickMask = null;
      this.stamp = 0;
    }

    get active() { return this.layers.find(l => l.id === this.activeId) || null; }
    get activeIndex() { return this.layers.findIndex(l => l.id === this.activeId); }
    layerById(id) { return this.layers.find(l => l.id === id) || null; }
    setActive(layer, keepSelection = false) {
      if (!layer) return;
      if (!keepSelection) this.selectedIds = new Set([layer.id]);
      else this.selectedIds.add(layer.id);
      if (this.activeId !== layer.id || !keepSelection) { this.activeId = layer.id; }
      if (layer.kind === 'shape') this.activePathId = null;
      KS.emit('layers', this); KS.emit('active-layer', this);
    }
    // Calques sélectionnés (ordre du document), sans les descendants d'un groupe déjà pris
    get selected() {
      const ids = this.selectedIds.size ? this.selectedIds : new Set(this.activeId ? [this.activeId] : []);
      if (this.activeId) ids.add(this.activeId);
      const list = this.layers.filter(l => ids.has(l.id));
      return list.filter(l => !list.some(g => g !== l && g.kind === 'group' && this.isDescendant(l, g)));
    }

    /* ------------------------------------------------ arbre des groupes */
    parentOf(L) { return L && L.parent ? this.layerById(L.parent) : null; }
    isDescendant(L, G) { let p = this.parentOf(L); while (p) { if (p === G) return true; p = this.parentOf(p); } return false; }
    descendants(G) { return this.layers.filter(l => this.isDescendant(l, G)); }
    children(G) { const id = G ? G.id : null; return this.layers.filter(l => (l.parent || null) === id); }
    depth(L) { let d = 0, p = this.parentOf(L); while (p) { d++; p = this.parentOf(p); } return d; }
    // Bloc [début, fin] (indices) d'un calque et de ses descendants
    block(L) {
      const i = this.layers.indexOf(L);
      if (L.kind !== 'group') return [i, i];
      return [i - this.descendants(L).length, i];
    }
    takeBlock(L) { const [a, b] = this.block(L); return this.layers.splice(a, b - a + 1); }
    // Visible si lui et tous ses groupes sont visibles
    shown(L) { let p = L; while (p) { if (!p.visible) return false; p = this.parentOf(p); } return true; }
    // Déplace le bloc de L : au-dessus (above=true) ou en dessous de la cible ; inside = dans le groupe cible (en haut)
    moveBlock(L, target, { above = true, inside = false } = {}) {
      if (target === L || (target && this.isDescendant(target, L))) return false;
      const blk = this.takeBlock(L);
      if (inside && target && target.kind === 'group') {
        L.parent = target.id;
        this.layers.splice(this.layers.indexOf(target), 0, ...blk);
      } else if (target) {
        L.parent = target.parent || null;
        const [a, b] = this.block(target);
        this.layers.splice(above ? b + 1 : a, 0, ...blk);
      } else { L.parent = null; this.layers.push(...blk); }
      this.changed();
      return true;
    }

    // Insère à l'indice donné ; sans parent explicite, le calque prend le groupe de son voisin du dessous
    addLayer(layer, index = this.activeIndex + 1, select = true) {
      if (index < 0 || index > this.layers.length) index = this.layers.length;
      if (layer.parent === undefined) {
        const below = this.layers[index - 1], above = this.layers[index];
        layer.parent = below ? (below.parent || null) : (above ? above.parent || null : null);
      }
      this.layers.splice(index, 0, layer);
      if (select) { this.activeId = layer.id; this.selectedIds = new Set([layer.id]); }
      this.changed();
      return layer;
    }
    removeLayer(layer) {
      if (this.layers.indexOf(layer) < 0) return;
      const start = this.block(layer)[0];
      const blk = this.takeBlock(layer);
      if (blk.some(l => l.id === this.activeId)) {
        const n = this.layers[start - 1] || this.layers[start] || null;
        this.activeId = n ? n.id : null;
      }
      this.selectedIds = new Set(this.activeId ? [this.activeId] : []);
      this.changed();
    }
    newLayerName(base = 'Calque') {
      let n = 1;
      const names = new Set(this.layers.map(l => l.name));
      while (names.has(`${base} ${n}`)) n++;
      return `${base} ${n}`;
    }

    // rect (coordonnées document) : seule cette zone a changé ; sans rect, tout le document.
    changed(rect) {
      const r = rect ? U.rectInt(rect) : null;
      if (!r || this.compositeDirty === true) this.compositeDirty = true;
      else this.compositeDirty = U.rectUnion(this.compositeDirty || null, r);
      if (this.proxy) this.proxy.dirty = !r || this.proxy.dirty === true ? true : U.rectUnion(this.proxy.dirty || null, r);
      this._lastChange = performance.now();
      this.stamp++;
      KS.requestRender && KS.requestRender();
    }

    /* ------------------------------------------------ composition */
    // Le cache (compositeCanvas) n'est recomposé que sur la zone modifiée, élargie de la portée
    // des styles de calque ; tout le document si un réglage dépend du voisinage (Camera Raw).
    //
    // Affichage progressif (comme Photoshop) : quand la zone est trop grande pour être recomposée
    // en pleine résolution sans ralentir (calques de réglage sur une grande image…), l'écran montre
    // aussitôt un aperçu basse résolution (proxy), puis les tuiles en pleine résolution sont
    // recalculées par petites tranches dès que l'on cesse de manipuler.
    _takeDirty() {
      const c = this.compositeCanvas, full = this.rect;
      const sized = c.width === this.width && c.height === this.height;
      if (!sized) { U.fitCanvas(c, this.width, this.height); this.compositeDirty = true; this.pending = null; }
      let R = this.compositeDirty === true ? full : this.compositeDirty;
      this.compositeDirty = false;
      if (!R) return null;
      if (R !== full) {
        const pad = this._effectsReach();
        R = pad === Infinity ? full : U.rectIntersect({ x: R.x - pad, y: R.y - pad, w: R.w + pad * 2, h: R.h + pad * 2 }, full);
      }
      return R;
    }
    // Recomposition exacte et immédiate de R
    _composeExact(R) {
      const c = this.compositeCanvas, t0 = performance.now();
      if (this._effectsReach() === Infinity) {
        // réglage spatial : il lui faut toute l'image d'un coup
        U.fitCanvas(c, this.width, this.height);
        this.composeInto(c.getContext('2d'), this.layers);
        this.pending = null;
        R = this.rect;
        this._mipTouch(R);
      } else this._composeTiles(c, R);
      const mp = R.w * R.h / 1e6;
      if (mp > 0.25) { const v = (performance.now() - t0) / mp; this._msPerMP = this._msPerMP ? this._msPerMP * 0.5 + v * 0.5 : v; }
      KS.emit('composite', this, R);
    }
    // Composition exacte et complète (export, pipette, échantillonnage…)
    composite() {
      const R = this._takeDirty();
      if (R) this._composeExact(R);
      if (this.pending && this.pending.size) {
        if (this._effectsReach() === Infinity) this._composeExact(this.rect);
        else for (const k of [...this.pending]) this._refineTile(k);
      }
      return this.compositeCanvas;
    }
    // Coût estimé d'une recomposition (ms par mégapixel) : mesuré, sinon déduit des calques
    _cost() {
      if (this._msPerMP) return this._msPerMP;
      let n = 1;
      for (const L of this.layers) if (L.visible) n += L.kind === 'adjust' ? 40 : L.effects ? 4 : 0.5;
      return n;
    }
    // État pour l'écran : { comp, proxy, k, pending } ; recompose ce qui peut l'être sans attendre
    frame() {
      const R = this._takeDirty();
      if (R) {
        const ms = R.w * R.h / 1e6 * this._cost();
        if (ms < Doc.SYNC_MS || this.width * this.height < Doc.PROXY_PX * 1.5) this._composeExact(R);
        else {
          // trop long : tuiles en attente + aperçu basse résolution
          this.pending = this.pending || new Set();
          const S = Doc.TILE;
          for (let ty = Math.floor(R.y / S) * S; ty < R.y + R.h; ty += S) for (let tx = Math.floor(R.x / S) * S; tx < R.x + R.w; tx += S) this.pending.add(tx + ',' + ty);
          if (!this.proxy) this.proxy = { dirty: true };
          this._scheduleRefine();
        }
      }
      const pend = this.pending && this.pending.size ? this.pending : null;
      if (pend && this.proxy && this.proxy.dirty) this._updateProxy();
      return { comp: this.compositeCanvas, proxy: pend ? this.proxy.canvas : null, k: pend ? this.proxy.k : 1, pending: pend };
    }
    // Image la plus fraîche pour les vignettes (navigateur, histogramme) : l'aperçu tant que
    // la pleine résolution n'est pas terminée, sans forcer le calcul complet.
    previewSource() {
      const f = this.frame();
      if (f.pending) return f.proxy;
      // grande image : une copie réduite (environ 1 Mpx) suffit aux vignettes
      let m = 1; while (m > 1 / 64 && this.width * this.height * m * m > 1.5e6) m /= 2;
      return m < 1 ? this.mip(m) : f.comp;
    }
    _updateProxy() {
      const W = this.width, H = this.height, k = Math.min(1, Math.sqrt(Doc.PROXY_PX / (W * H)));
      let P = this.proxy;
      if (!P.canvas || P.k !== k) { P.canvas = U.canvas(Math.ceil(W * k), Math.ceil(H * k)); P.k = k; P.dirty = true; }
      let R = P.dirty === true ? this.rect : P.dirty;
      P.dirty = false;
      if (R !== this.rect) {
        const pad = this._effectsReach();
        R = pad === Infinity ? this.rect : U.rectIntersect({ x: R.x - pad, y: R.y - pad, w: R.w + pad * 2, h: R.h + pad * 2 }, this.rect);
        if (!R) return;
      }
      // zone alignée sur la grille de l'aperçu
      const px = Math.floor(R.x * k), py = Math.floor(R.y * k), pw = Math.min(P.canvas.width, Math.ceil((R.x + R.w) * k)) - px, ph = Math.min(P.canvas.height, Math.ceil((R.y + R.h) * k)) - py;
      if (pw <= 0 || ph <= 0) return;
      const D = { x: px / k, y: py / k, w: pw / k, h: ph / k };
      const t = U.canvas(pw, ph), x = t.getContext('2d');
      x.imageSmoothingQuality = 'medium';
      x.setTransform(k, 0, 0, k, -px, -py);
      this._k = k;
      try { this.composeInto(x, this.layers, D); } finally { this._k = 1; }
      const pc = P.canvas.getContext('2d');
      pc.clearRect(px, py, pw, ph);
      pc.drawImage(t, px, py);
    }
    _scheduleRefine() {
      if (this._refining) return;
      this._refining = true;
      const step = () => {
        if (!this.pending || !this.pending.size) { this._refining = false; KS.requestRender(); return; }
        // on attend une pause dans la manipulation
        const idle = performance.now() - (this._lastChange || 0);
        if (idle < Doc.REFINE_DELAY) { setTimeout(step, Doc.REFINE_DELAY - idle + 5); return; }
        if (this.compositeDirty) { KS.requestRender(); setTimeout(step, 16); return; }
        const t0 = performance.now();
        if (this._effectsReach() === Infinity) this._composeExact(this.rect);
        else for (const k of this.pending) { this._refineTile(k); if (performance.now() - t0 > 12) break; }
        KS.requestRender();
        setTimeout(step, 0);
      };
      setTimeout(step, Doc.REFINE_DELAY);
    }
    _refineTile(key) {
      const S = Doc.TILE, [tx, ty] = key.split(',').map(Number);
      const T = U.rectIntersect({ x: tx, y: ty, w: S, h: S }, this.rect);
      this.pending.delete(key);
      if (T) this._composeTiles(this.compositeCanvas, T);
    }
    // Compose R par tuiles dans de petits canevas de travail, recopiés ensuite dans le cache.
    // Dessiner puis relire (réglages) directement dans un canevas de plusieurs dizaines de
    // mégapixels coûte des dizaines de fois plus cher que dans une tuile.
    _composeTiles(c, R) {
      const x = c.getContext('2d'), S = Doc.TILE;
      for (let ty = R.y; ty < R.y + R.h; ty += S) {
        for (let tx = R.x; tx < R.x + R.w; tx += S) {
          const T = { x: tx, y: ty, w: Math.min(S, R.x + R.w - tx), h: Math.min(S, R.y + R.h - ty) };
          const { t } = this._scratch(T);
          this.composeInto(t.getContext('2d'), this.layers, T);
          x.clearRect(T.x, T.y, T.w, T.h);
          x.drawImage(t, T.x, T.y);
        }
      }
      this._mipTouch(R);
    }
    // Copie réduite de la composition (facteur m = 1/2, 1/4…), tenue à jour par zones : l'écran
    // en zoom arrière dessine depuis elle, au lieu de réduire des dizaines de mégapixels à chaque image.
    mip(m) {
      this._mips = this._mips || new Map();
      let M = this._mips.get(m);
      if (!M || M.w !== this.width || M.h !== this.height) {
        M = { m, w: this.width, h: this.height, canvas: U.canvas(Math.ceil(this.width * m), Math.ceil(this.height * m)), dirty: this.rect };
        this._mips.set(m, M);
      }
      if (M.dirty) { const R = M.dirty; M.dirty = null; this._mipUpdate(M, R); }
      return M.canvas;
    }
    _mipTouch(R) { if (this._mips) for (const M of this._mips.values()) M.dirty = M.dirty ? U.rectUnion(M.dirty, R) : R; }
    _mipUpdate(M, R) {
      // zone alignée sur la grille réduite, puis divisée par deux autant de fois que nécessaire
      const step = Math.round(1 / M.m), x0 = Math.floor(R.x / step) * step, y0 = Math.floor(R.y / step) * step;
      const x1 = Math.min(this.width, Math.ceil((R.x + R.w) / step) * step), y1 = Math.min(this.height, Math.ceil((R.y + R.h) / step) * step);
      if (x1 <= x0 || y1 <= y0) return;
      let cur = U.canvas(x1 - x0, y1 - y0);
      cur.getContext('2d').drawImage(this.compositeCanvas, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
      for (let s = 1; s < step; s *= 2) {
        const nx = U.canvas(Math.max(1, Math.ceil(cur.width / 2)), Math.max(1, Math.ceil(cur.height / 2))), c = nx.getContext('2d');
        c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'low';
        c.drawImage(cur, 0, 0, nx.width, nx.height);
        cur = nx;
      }
      const dx = x0 / step, dy = y0 / step, mc = M.canvas.getContext('2d');
      mc.clearRect(dx, dy, cur.width, cur.height);
      mc.drawImage(cur, dx, dy);
    }
    // Portée maximale des styles de calque visibles (px) ; Infinity si un réglage est spatial
    _effectsReach() {
      let pad = 0;
      for (const L of this.layers) {
        if (!L.visible) continue;
        if (L.kind === 'adjust' && KS.Adjust.isSpatial && KS.Adjust.isSpatial(L.adjust.type, L.adjustPreview || L.adjust.params)) return Infinity;
        const fx = L.effects;
        if (!fx) continue;
        if (fx.shadow?.on) pad = Math.max(pad, (fx.shadow.distance || 0) + (fx.shadow.size || 0) * 1.5 + 2);
        if (fx.glow?.on) pad = Math.max(pad, (fx.glow.size || 0) * 1.6 + 2);
        if (fx.stroke?.on) pad = Math.max(pad, (fx.stroke.size || 0) + 2);
        if (fx.innerGlow?.on) pad = Math.max(pad, (fx.innerGlow.size || 0) * 1.6 + 2);
      }
      return Math.ceil(pad);
    }
    flatten(layers = this.layers) {
      const c = U.canvas(this.width, this.height);
      this.composeInto(c.getContext('2d'), layers);
      return c;
    }
    // Compose une sous-liste (ordre conservé) : les calques dont le groupe n'y figure pas sont à la racine.
    // R : zone à composer (coordonnées document) ; les canevas intermédiaires ont sa taille.
    composeInto(ctx, layers, R = this.rect) {
      const set = new Set(layers);
      const kids = new Map();
      for (const L of layers) {
        let p = this.parentOf(L);
        while (p && !set.has(p)) p = this.parentOf(p);
        const key = p ? p.id : null;
        if (!kids.has(key)) kids.set(key, []);
        kids.get(key).push(L);
      }
      this._level(ctx, kids.get(null) || [], kids, R);
    }
    // Canevas de travail de la taille de R, dessiné en coordonnées document
    _scratch(R) {
      const k = this._k || 1;
      const t = U.canvas(Math.max(1, Math.round(R.w * k)), Math.max(1, Math.round(R.h * k))), x = t.getContext('2d');
      if (k !== 1) x.imageSmoothingQuality = 'medium';
      x.setTransform(k, 0, 0, k, -R.x * k, -R.y * k);
      return { t, x };
    }
    // under : il y a déjà des calques dessous dans ctx (sinon un mode de fusion agit sur le calque lui-même)
    _level(ctx, items, kids, R = this.rect, under = false) {
      for (let i = 0; i < items.length; i++) {
        const L = items[i];
        if (L.clip && i > 0) continue;               // dessiné avec sa base
        const clipped = [];
        for (let j = i + 1; j < items.length && items[j].clip; j++) clipped.push(items[j]);
        if (!L.visible) continue;
        if (L.kind === 'adjust') { this.applyAdjustLayer(ctx, L, R); continue; }
        const alone = !under;
        under = true;   // décidé sur la structure, pas sur la zone R : même rendu d'une tuile à l'autre
        if (L.kind === 'group') { this._group(ctx, L, kids.get(L.id) || [], kids, R, !alone); continue; }
        // en aperçu basse résolution, chaque calque fournit sa copie réduite (mise en cache)
        const k1 = this._k || 1, imgOf = Lx => k1 < 1 ? Lx.imageScaled(k1) : Lx.image();
        let img = imgOf(L);
        if (!U.rectIntersect({ x: img.x, y: img.y, w: img.w || img.canvas.width, h: img.h || img.canvas.height }, R)) continue;
        const vis = clipped.filter(c => c.visible);
        if (vis.length) {
          const { t, x: tx } = this._scratch(R);
          put(tx, img);
          for (const c of vis) {
            if (c.kind === 'adjust') {
              // Le réglage conserve déjà l'alpha de sa base : ne pas l'appliquer deux fois.
              this.applyAdjustLayer(tx, c, R);
              continue;
            }
            if (c.kind === 'group') continue;
            const ci = imgOf(c);
            const { t: t2, x: k } = this._scratch(R);
            put(k, ci);
            k.globalCompositeOperation = 'destination-in';
            put(k, img);
            tx.globalAlpha = c.opacity;
            tx.globalCompositeOperation = KS.blendOp(c.blend);
            tx.drawImage(t2, R.x, R.y, R.w, R.h);
            tx.globalAlpha = 1; tx.globalCompositeOperation = 'source-over';
          }
          img = { canvas: t, x: R.x, y: R.y, w: R.w, h: R.h };
        }
        const self = alone && KS.blendOp(L.blend) !== 'source-over';
        if (self) img = selfBlend(L, img, !vis.length && !L.override);
        ctx.globalAlpha = L.opacity;
        ctx.globalCompositeOperation = self ? 'source-over' : KS.blendOp(L.blend);
        put(ctx, img);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    // Masque d'un groupe ou d'un réglage, sur la zone R
    _groupMask(G, R = this.rect) {
      const m = G.mask;
      if (!m || !m.enabled || !m.alpha) return null;
      const { t: mk, x: mx } = this._scratch(R);
      if ((m.outside ?? 255) > 0) { mx.globalAlpha = m.outside / 255; mx.fillRect(R.x, R.y, R.w, R.h); mx.globalAlpha = 1; }
      mx.clearRect(m.x, m.y, m.canvas.width, m.canvas.height);
      mx.drawImage(m.alpha, m.x, m.y);
      return mk;
    }
    _group(ctx, G, children, kids, R = this.rect, under = false) {
      const mask = this._groupMask(G, R);
      if (G.blend === 'pass') {
        if (G.opacity >= 1 && !mask) { this._level(ctx, children, kids, R, under); return; }
        // passage : composer sur une copie du fond, puis fondre selon opacité et masque
        const { t, x: tx } = this._scratch(R), p = this._pixelRect(ctx, R);
        if (p) tx.drawImage(ctx.canvas, p.x, p.y, p.w, p.h, p.dx, p.dy, p.dw, p.dh);
        this._level(tx, children, kids, R, under);
        if (mask) { tx.globalCompositeOperation = 'destination-in'; tx.drawImage(mask, R.x, R.y, R.w, R.h); }
        ctx.globalAlpha = G.opacity; ctx.drawImage(t, R.x, R.y, R.w, R.h); ctx.globalAlpha = 1;
        return;
      }
      const { t, x: tx } = this._scratch(R);
      this._level(tx, children, kids, R);
      if (mask) { tx.globalCompositeOperation = 'destination-in'; tx.drawImage(mask, R.x, R.y, R.w, R.h); tx.globalCompositeOperation = 'source-over'; }
      ctx.globalAlpha = G.opacity;
      ctx.globalCompositeOperation = KS.blendOp(G.blend);
      ctx.drawImage(t, R.x, R.y, R.w, R.h);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    // Zone R (coordonnées document) en pixels du canevas de ctx (translaté, et mis à l'échelle
    // pour l'aperçu) ; dx… : la même zone ramenée en coordonnées document
    _pixelRect(ctx, R) {
      const m = ctx.getTransform();
      const x = Math.round(R.x * m.a + m.e), y = Math.round(R.y * m.d + m.f);
      const r = U.rectIntersect({ x, y, w: Math.round(R.w * m.a), h: Math.round(R.h * m.d) }, { x: 0, y: 0, w: ctx.canvas.width, h: ctx.canvas.height });
      if (!r) return null;
      return { ...r, dx: (r.x - m.e) / m.a, dy: (r.y - m.f) / m.d, dw: r.w / m.a, dh: r.h / m.d };
    }
    applyAdjustLayer(ctx, L, R = this.rect) {
      const P = this._pixelRect(ctx, R);
      if (!P) return;
      const W = P.w, H = P.h;
      const original = ctx.getImageData(P.x, P.y, W, H);
      const src = new ImageData(new Uint8ClampedArray(original.data), W, H);
      const params = L.adjustPreview || L.adjust.params;
      KS.Adjust.apply(L.adjust.type, src, params, this);
      const op = KS.blendOp(L.blend);
      let adjusted = src.data;
      if (op !== 'source-over') {
        const t = U.canvas(W, H), tx = t.getContext('2d');
        const bottom = new ImageData(new Uint8ClampedArray(original.data), W, H);
        const top = new ImageData(new Uint8ClampedArray(src.data), W, H);
        for (let i = 3; i < top.data.length; i += 4) { bottom.data[i] = top.data[i] = 255; }
        tx.putImageData(bottom, 0, 0);
        const tc = U.canvas(W, H); U.putData(tc, top);
        tx.globalCompositeOperation = op; tx.drawImage(tc, 0, 0);
        adjusted = tx.getImageData(0, 0, W, H).data;
      }
      // masque sur la même zone (coordonnées document de P)
      const mk = this._groupMask(L, { x: P.dx, y: P.dy, w: P.dw, h: P.dh });
      const mask = mk ? U.getData(mk).data : null, pixels = original.data;
      const op1 = L.opacity;
      if (!mask && op1 >= 1) { for (let i = 0; i < pixels.length; i += 4) { pixels[i] = adjusted[i]; pixels[i + 1] = adjusted[i + 1]; pixels[i + 2] = adjusted[i + 2]; } }
      else {
        for (let i = 0; i < pixels.length; i += 4) {
          const strength = op1 * (mask ? mask[i + 3] / 255 : 1);
          if (!strength) continue;
          pixels[i] += (adjusted[i] - pixels[i]) * strength;
          pixels[i + 1] += (adjusted[i + 1] - pixels[i + 1]) * strength;
          pixels[i + 2] += (adjusted[i + 2] - pixels[i + 2]) * strength;
        }
      }
      // Un réglage de couleur change les couleurs, sans épaissir les bords transparents.
      ctx.putImageData(original, P.x, P.y);
    }

    // Image affichée (filtre de couches : rouge seul en niveaux de gris, etc.)
    display() {
      const c = this.composite(), v = this.channelView;
      if (!v || (v.r && v.g && v.b)) return c;
      if (this._disp && this._disp.stamp === this.stamp && this._disp.key === JSON.stringify(v)) return this._disp.canvas;
      const d = U.getData(c), p = d.data, n = (v.r ? 1 : 0) + (v.g ? 1 : 0) + (v.b ? 1 : 0);
      for (let i = 0; i < p.length; i += 4) {
        if (n === 1) { const g = v.r ? p[i] : v.g ? p[i + 1] : p[i + 2]; p[i] = p[i + 1] = p[i + 2] = g; }
        else { if (!v.r) p[i] = 0; if (!v.g) p[i + 1] = 0; if (!v.b) p[i + 2] = 0; }
      }
      const out = this._disp?.canvas && this._disp.canvas.width === c.width && this._disp.canvas.height === c.height ? this._disp.canvas : U.canvas(c.width, c.height);
      U.putData(out, d);
      this._disp = { stamp: this.stamp, key: JSON.stringify(v), canvas: out };
      return out;
    }

    sample(x, y, size = 1, source = 'all') {
      x = Math.floor(x); y = Math.floor(y);
      const r = Math.floor(size / 2);
      let c, ox = 0, oy = 0;
      const A = this.active;
      if (source === 'layer' && A && A.kind !== 'adjust' && A.kind !== 'group') { c = A.canvas; ox = A.x; oy = A.y; }
      else c = this.composite();
      const rx = x - r - ox, ry = y - r - oy;
      const box = U.rectIntersect({ x: rx, y: ry, w: size, h: size }, { x: 0, y: 0, w: c.width, h: c.height });
      if (!box) return null;
      const d = U.getData(c, box).data;
      let R = 0, G = 0, B = 0, Al = 0;
      for (let i = 0; i < d.length; i += 4) { const a = d[i + 3]; R += d[i] * a; G += d[i + 1] * a; B += d[i + 2] * a; Al += a; }
      if (!Al) return null;
      return { r: Math.round(R / Al), g: Math.round(G / Al), b: Math.round(B / Al), a: Al / (d.length / 4) / 255 };
    }

    get rect() { return { x: 0, y: 0, w: this.width, h: this.height }; }
    get workRect() { return this.selection.bounds ? { ...this.selection.bounds } : this.rect; }
    get activePath() { return this.paths.find(p => p.id === this.activePathId) || null; }
  }

  // Dessine une image de calque { canvas, x, y, w?, h? } (w, h : taille en coordonnées document)
  function put(ctx, im) { ctx.drawImage(im.canvas, im.x, im.y, im.w || im.canvas.width, im.h || im.canvas.height); }

  // Mode de fusion d'un calque sans rien dessous : il se fond avec lui-même (ce que donnerait une copie dessous),
  // ou, pour les modes sans effet sur une copie identique, avec une variante de lui-même :
  // Obscurcir/Éclaircir/Différence/Exclusion/Teinte avec sa version floutée (ombres ou lumières qui s'étalent,
  // contours, couleurs harmonisées), Saturation/Couleur avec sa version plus saturée, Luminosité plus contrastée.
  const SELF_TOP = {
    darken: 'blur', lighten: 'blur', difference: 'blur', exclusion: 'blur', hue: 'blur',
    saturation: 'saturate(1.6)', color: 'saturate(1.35)', luminosity: 'contrast(1.25)',
  };
  function selfBlend(L, img, cacheable) {
    const op = KS.blendOp(L.blend), k = img.w ? img.canvas.width / img.w : 1;
    if (cacheable && L._self && L._self.src === img.canvas && L._self.v === L.version && L._self.op === op) return L._self.r;
    const W = img.canvas.width, H = img.canvas.height;
    const c = U.canvas(W, H), x = c.getContext('2d');
    x.drawImage(img.canvas, 0, 0);
    let top = img.canvas, f = SELF_TOP[L.blend];
    if (f) {
      const t = U.canvas(W, H), tx = t.getContext('2d');
      if (f === 'blur') f = `blur(${Math.max(1.5, 0.012 * Math.min(W, H)).toFixed(1)}px)`;
      tx.filter = f; tx.drawImage(img.canvas, 0, 0); tx.filter = 'none';
      // bords du flou : on garde l'image d'origine là où le flou devient transparent
      tx.globalCompositeOperation = 'destination-over'; tx.drawImage(img.canvas, 0, 0);
      tx.globalCompositeOperation = 'destination-in'; tx.drawImage(img.canvas, 0, 0);
      top = t;
    }
    x.globalCompositeOperation = op; x.drawImage(top, 0, 0);
    x.globalCompositeOperation = 'destination-in'; x.drawImage(img.canvas, 0, 0);   // forme du calque gardée
    const r = { canvas: c, x: img.x, y: img.y, w: img.w || W / k, h: img.h || H / k };
    if (cacheable) L._self = { src: img.canvas, v: L.version, op, r };
    return r;
  }
  Doc.TILE = 512;                  // côté des tuiles de composition (px)
  Doc.SYNC_MS = 35;                // au-delà (estimé), l'affichage passe par l'aperçu basse résolution
  Doc.PROXY_PX = 1e6;              // taille de l'aperçu (pixels)
  Doc.REFINE_DELAY = 220;          // pause (ms) avant de calculer la pleine résolution
  KS.Doc = Doc;

  KS.createDoc = ({ name, width, height, background = 'white', color }) => {
    const d = new Doc({ name, width, height });
    const L = new KS.Layer({ name: background === 'transparent' ? 'Calque 1' : 'Arrière-plan', w: width, h: height });
    if (background !== 'transparent') {
      L.ctx.fillStyle = background === 'black' ? '#000' : background === 'custom' ? U.hex(color || KS.state.bg) : background === 'bg' ? U.hex(KS.state.bg) : '#fff';
      L.ctx.fillRect(0, 0, width, height);
    }
    d.addLayer(L, 0);
    d.dirty = false;
    return d;
  };
})();

// Signer des images : une copie 720p, filigranée et signée « KG · Kane Giordano », prête pour les réseaux.
// Repris de l'écran Signature de Kane OS (launcher/backend/signature.py), même rendu, mais dessiné ici sur canvas :
//   1. réduction en 720p (petit côté 720 px au plus, grand côté 1280 au plus), jamais d'agrandissement ;
//   2. protection : un filigrane KG répété en diagonale (« motif »), un grand KG au centre (« centre ») ou rien ;
//   3. signature en bas à droite, noire sur fond clair, blanche sur fond sombre, blanche ombrée entre les deux ;
//   4. JPEG sans métadonnées (le canvas n'en recopie aucune : ni position GPS, ni appareil) ; l'original n'est jamais modifié.
// Le monogramme est dessiné avec deux polices livrées avec Windows (Brush Script et Segoe UI Light).
'use strict';
(() => {
  const U = KS.util, h = KS.h, ui = KS.ui;
  const S = KS.signature = {};

  S.TAILLE_MAX = [1280, 720];
  S.QUALITE = 0.85;
  S.PROTECTIONS = [['motif', 'Filigrane sur toute l\'image'], ['centre', 'Grand KG au centre'], ['aucune', 'Signature seule']];
  S.DOSSIER = 'Images signées';
  S.SUFFIXE = '_KG';
  const SIGNATURE_LARGEUR = 0.16, SIGNATURE_OPACITE = 0.90, SIGNATURE_MARGE = 0.03;
  const MOTIF_OPACITE = 0.13, MOTIF_TAILLE = 0.11, MOTIF_ANGLE = 30;
  const POLICE_KG = '"Brush Script MT"', POLICE_NOM = '"Segoe UI Light"';
  const EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff'];

  /* ---------------------------------------------------------------- monogramme */
  // Une police absente retombe sur une police de secours : on le voit à la largeur mesurée.
  function policePresente(famille) {
    const c = U.canvas(1, 1).getContext('2d');
    return ['monospace', 'serif'].every(secours => {
      c.font = `100px ${secours}`; const a = c.measureText('KG Kane').width;
      c.font = `100px ${famille}, ${secours}`; return c.measureText('KG Kane').width !== a;
    });
  }

  // Masque (blanc sur transparent) du texte, rogné au plus près.
  function texte(chaine, police, espacement = 0) {
    const mesure = U.canvas(1, 1).getContext('2d');
    mesure.font = police; mesure.letterSpacing = espacement + 'px';
    const m = mesure.measureText(chaine), marge = 100;
    const c = U.canvas(m.width + 2 * marge, m.fontBoundingBoxAscent + m.fontBoundingBoxDescent + 2 * marge);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.font = police; x.letterSpacing = espacement + 'px'; x.textBaseline = 'top'; x.fillStyle = '#fff';
    x.fillText(chaine, marge, marge);
    return rogner(c);
  }

  function rogner(c) {
    const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return U.canvas(1, 1);
    const r = U.canvas(x1 - x0 + 1, y1 - y0 + 1);
    r.getContext('2d').drawImage(c, -x0, -y0);
    return r;
  }

  // « KG » au pinceau, un filet, puis « KANE GIORDANO » en capitales fines espacées.
  function masqueMonogramme() {
    if (!policePresente(POLICE_KG) || !policePresente(POLICE_NOM))
      throw new Error('Polices Windows introuvables (Brush Script MT, Segoe UI Light) : la signature en a besoin.');
    const kg = texte('KG', `840px ${POLICE_KG}`);
    const nom = texte('KANE GIORDANO', `140px ${POLICE_NOM}`, 52);
    const ecart = 80, filet = Math.round(nom.width * 0.35);
    const l = Math.max(kg.width, nom.width), hh = kg.height + ecart + 6 + ecart + nom.height;
    const grand = U.canvas(l, hh), g = grand.getContext('2d');
    g.drawImage(kg, Math.floor((l - kg.width) / 2), 0);
    const y = kg.height + ecart;
    g.fillStyle = '#fff'; g.fillRect(Math.floor((l - filet) / 2), y, filet, 7);
    g.drawImage(nom, Math.floor((l - nom.width) / 2), y + 6 + ecart);
    // dessiné en double taille pour des bords nets, puis une marge de 20 px
    const m = U.canvas(Math.floor(l / 2) + 40, Math.floor(hh / 2) + 40), x = m.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(grand, 20, 20, Math.floor(l / 2), Math.floor(hh / 2));
    return m;
  }

  function teinter(masque, couleur) {
    const c = U.canvas(masque.width, masque.height), x = c.getContext('2d');
    x.drawImage(masque, 0, 0);
    x.globalCompositeOperation = 'source-in'; x.fillStyle = couleur; x.fillRect(0, 0, c.width, c.height);
    return c;
  }

  let cache = null;
  // Les trois versions du monogramme : noir, blanc et blanc ombré.
  S.monogrammes = () => {
    if (cache) return cache;
    const masque = masqueMonogramme();
    const noir = teinter(masque, '#111'), blanc = teinter(masque, '#fff');
    const ombre = U.canvas(masque.width + 20, masque.height + 20), o = ombre.getContext('2d');
    o.filter = 'blur(6px)'; o.globalAlpha = 0.55; o.drawImage(noir, 10, 13);
    o.filter = 'none'; o.globalAlpha = 1; o.drawImage(blanc, 10, 10);
    return (cache = { noir, blanc, ombre });
  };

  /* ---------------------------------------------------------------- traitement */
  const largeur = (img, l) => { const r = l / img.width; return [Math.max(1, Math.round(img.width * r)), Math.max(1, Math.round(img.height * r))]; };
  const poser = (x, img, l, px, py, opacite = 1) => { const [w, hh] = largeur(img, l); x.globalAlpha = opacite; x.drawImage(img, px, py, w, hh); x.globalAlpha = 1; return [w, hh]; };

  S.taille720 = (w, hh) => {
    const [bl, bh] = w === hh ? [720, 720] : w > hh ? S.TAILLE_MAX : [S.TAILLE_MAX[1], S.TAILLE_MAX[0]];
    const s = Math.min(1, bl / w, bh / hh);   // jamais d'agrandissement
    return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(hh * s))];
  };

  function motif(x, l, hh) {
    const tuile = S.monogrammes().ombre;
    const [tw, th] = largeur(tuile, Math.max(40, Math.floor(l * MOTIF_TAILLE)));
    const cote = Math.floor(Math.hypot(l, hh)) + 2 * tw;
    const px = Math.floor(tw * 2.6), py = Math.floor(th * 1.9);
    x.save();
    x.translate(l / 2, hh / 2); x.rotate(-MOTIF_ANGLE * Math.PI / 180); x.translate(-cote / 2, -cote / 2);
    x.globalAlpha = MOTIF_OPACITE;
    for (let rang = 0, y = 0; y < cote; rang++, y += py)
      for (let xx = rang % 2 ? Math.floor(px / 2) : 0; xx < cote; xx += px) x.drawImage(tuile, xx, y, tw, th);
    x.restore();
  }

  function centre(x, l, hh) {
    const sig = S.monogrammes().ombre, [w, sh] = largeur(sig, Math.floor(Math.min(l, hh) * 0.55));
    poser(x, sig, w, Math.floor((l - w) / 2), Math.floor((hh - sh) / 2), 0.22);
  }

  // Pose la signature en bas à droite ; renvoie la version choisie selon la luminosité du coin.
  S.poserSignature = (c) => {
    const x = c.getContext('2d', { willReadFrequently: true }), l = c.width, hh = c.height;
    const lw = Math.max(90, Math.floor(l * SIGNATURE_LARGEUR)), marge = Math.floor(Math.min(l, hh) * SIGNATURE_MARGE);
    const m = S.monogrammes(), [w, sh] = largeur(m.noir, lw);
    const px = l - w - marge, py = hh - sh - marge;
    const d = x.getImageData(Math.max(0, px), Math.max(0, py), Math.max(1, Math.min(w, l)), Math.max(1, Math.min(sh, hh))).data;
    let somme = 0;
    for (let i = 0; i < d.length; i += 4) somme += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const lum = somme / (d.length / 4);
    const version = lum > 165 ? 'noir' : lum < 90 ? 'blanc' : 'ombre';
    const sig = m[version], [vw, vh] = largeur(sig, lw);
    poser(x, sig, lw, l - vw - marge, hh - vh - marge, SIGNATURE_OPACITE);
    return version;
  };

  // Copie signée (canvas 720p opaque) d'une image ou d'un canvas.
  S.signer = (source, protection = 'motif') => {
    if (!S.PROTECTIONS.some(p => p[0] === protection)) throw new Error('Protection inconnue : ' + protection);
    const sw = source.naturalWidth || source.width, sh = source.naturalHeight || source.height;
    const [l, hh] = S.taille720(sw, sh);
    const c = U.canvas(l, hh), x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff'; x.fillRect(0, 0, l, hh);              // la transparence devient du blanc
    x.imageSmoothingQuality = 'high';
    x.drawImage(source, 0, 0, l, hh);
    if (protection === 'motif') motif(x, l, hh);
    else if (protection === 'centre') centre(x, l, hh);
    S.poserSignature(c);
    return c;
  };

  S.jpeg = async c => new Uint8Array(await (await U.blobFromCanvas(c, 'image/jpeg', S.QUALITE)).arrayBuffer());

  // « photo.png » -> photo_KG.jpg, puis photo_KG-2.jpg… sans jamais écraser.
  S.baseNom = nom => {
    let b = String(nom || '').replace(/\\/g, '/').split('/').pop();
    if (b.replace(/^\.+/, '').includes('.')) b = b.slice(0, b.lastIndexOf('.'));
    b = b.replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/^[ .]+|[ .]+$/g, '').slice(0, 120);
    return b || 'image';
  };
  async function cheminLibre(dossier, nom) {
    const base = dossier + '\\' + S.baseNom(nom) + S.SUFFIXE;
    let p = base + '.jpg';
    for (let n = 2; await KS.native.exists(p); n++) p = `${base}-${n}.jpg`;
    return p;
  }
  const dossierDe = p => p.replace(/[\\/][^\\/]*$/, '');

  /* ---------------------------------------------------------------- boîte de dialogue */
  const protectionMemo = () => { const p = KS.prefs.signatureProtection; return S.PROTECTIONS.some(x => x[0] === p) ? p : 'motif'; };

  // Aperçu de la première image et choix de la protection ; renvoie la protection, ou null.
  function dialogue({ titre, apercu, note, bouton }) {
    return new Promise(res => {
      let protection = protectionMemo();
      const img = h('img', { style: { maxWidth: '100%', maxHeight: '380px', display: 'block', margin: '0 auto', borderRadius: '6px' } });
      const info = h('div.note', { style: { textAlign: 'center', marginTop: '8px' } });
      let url = null;
      const rendre = async () => {
        try {
          const c = S.signer(apercu, protection);
          const blob = await U.blobFromCanvas(c, 'image/jpeg', S.QUALITE);
          if (url) URL.revokeObjectURL(url);
          url = URL.createObjectURL(blob); img.src = url;
          info.textContent = `${c.width} × ${c.height} px — ${U.fmtBytes(blob.size)}`;
        } catch (e) { info.textContent = e.message || String(e); }
      };
      const choix = h('div.form-col', { style: { gap: '6px' } }, ...S.PROTECTIONS.map(([v, lab]) => {
        const r = h('input', { type: 'radio', name: 'ks-sig-protection', value: v, checked: v === protection });
        r.addEventListener('change', () => { protection = v; rendre(); });
        return h('label.check', r, h('span', { text: lab }));
      }));
      rendre();
      KS.modal({
        title: titre, width: 760,
        body: h('div.dialog-split', h('div', { style: { flex: '1', minWidth: '380px' } }, img, info),
          h('div.form-col', { style: { width: '220px', gap: '12px' } }, h('span.opt-label', { text: 'Protection' }), choix,
            h('div.note', { text: note }))),
        buttons: [{ label: 'Annuler', value: null }, { label: bouton, primary: true, value: 'ok' }],
        onClose: v => {
          if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
          if (v === 'ok') { KS.prefs.signatureProtection = protection; KS.prefs.save(); }
          res(v === 'ok' ? protection : null);
        },
      });
    });
  }

  /* ---------------------------------------------------------------- commandes */
  // Fichier › Signer des images… : plusieurs fichiers, les copies vont dans « Images signées » à côté des originaux.
  S.signerFichiers = async (entrees) => {
    if (!KS.native) { KS.toast('Signer des images demande l\'application de bureau.', 'err'); return; }
    if (!entrees) entrees = await KS.native.openDialog({ title: 'Choisis les images à signer', filters: [{ name: 'Images', extensions: EXTENSIONS }] });
    entrees = (entrees || []).filter(f => f && !f.error && !(f.path || '').split(/[\\/]/).includes(S.DOSSIER));
    if (!entrees.length) return null;
    let premiere;
    try { premiere = await KS.io.canvasFromEntry(entrees[0]); } catch (e) { KS.toast(`« ${entrees[0].name} » n'est pas une image lisible.`, 'err', 4000); return null; }
    const protection = await dialogue({
      titre: entrees.length > 1 ? `Signer ${entrees.length} images` : 'Signer l\'image', apercu: premiere, bouton: 'Signer',
      note: `Copies 720p en JPEG, sans métadonnées, dans « ${S.DOSSIER} » à côté des originaux. Les originaux ne sont pas modifiés.`,
    });
    if (!protection) return null;
    const faites = [], erreurs = [];
    await KS.busy(async () => {
      for (const f of entrees) {
        try {
          const c = S.signer(f === entrees[0] ? premiere : await KS.io.canvasFromEntry(f), protection);
          const dossier = dossierDe(f.path) + '\\' + S.DOSSIER;
          const mk = await KS.native.makeDir(dossier);
          if (!mk.ok) throw new Error(mk.error);
          const p = await cheminLibre(dossier, f.name);
          const r = await KS.native.writeFile(p, await S.jpeg(c));
          if (!r.ok) throw new Error(r.error);
          faites.push(p);
        } catch (e) { erreurs.push(`${f.name} : ${e.message || e}`); }
      }
    });
    if (faites.length) {
      KS.toast(`${faites.length} image${faites.length > 1 ? 's' : ''} signée${faites.length > 1 ? 's' : ''}, dans « ${S.DOSSIER} ».`, 'ok', 4000);
      KS.native.showInFolder(faites[faites.length - 1]);
    }
    for (const e of erreurs) KS.toast(e, 'err', 5000);
    return { faites, erreurs };
  };

  // Fichier › Exporter › Signée pour les réseaux… : le document ouvert, tel qu'il s'affiche (calques fusionnés).
  S.signerDocument = async (doc = KS.state.doc) => {
    if (!doc) return null;
    const image = KS.io.exportCanvas(doc, 1, '#ffffff');
    const protection = await dialogue({
      titre: 'Exporter signée pour les réseaux', apercu: image, bouton: 'Exporter…',
      note: 'Copie 720p en JPEG, sans métadonnées. Le document n\'est pas modifié.',
    });
    if (!protection) return null;
    const data = await KS.busy(() => S.jpeg(S.signer(image, protection)));
    const nom = S.baseNom(doc.name) + S.SUFFIXE + '.jpg';
    if (!KS.native) { U.download(new Blob([data], { type: 'image/jpeg' }), nom); return null; }
    const p = await KS.native.saveDialog({ title: 'Exporter signée', defaultPath: doc.path ? dossierDe(doc.path) + '\\' + nom : nom, filters: [{ name: 'JPEG', extensions: ['jpg'] }] });
    if (!p) return null;
    const r = await KS.native.writeFile(p, data);
    if (r.ok) KS.toast('Exportée signée : ' + p.split(/[\\/]/).pop(), 'ok'); else KS.toast('Échec : ' + r.error, 'err');
    return r.ok ? p : null;
  };
})();

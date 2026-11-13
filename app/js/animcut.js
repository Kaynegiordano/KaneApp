// Animation 4.0 : découpe en calques dans Retouche, sans SAM.
// La silhouette vient du détourage BiRefNet de Retouche (« Sélectionner le sujet ») ; Animation y place le squelette de pose,
// sépare cheveux et bras par GrabCut (les frontières suivent les bords de l'image) et repeint les parties cachées. Chaque
// pièce revient en calque avec un masque de fusion : peindre le masque en blanc ou en noir l'agrandit ou la réduit.
'use strict';
(() => {
  const U = KS.util, C = KS.cmd, N = KS.native;
  if (!N?.animationCut) return;
  const pngBytes = async c => new Uint8Array(await (await U.blobFromCanvas(c)).arrayBuffer());
  const canvasOf = bytes => U.canvasFromBlob(new Blob([bytes], { type: 'image/png' }));

  // silhouette du sujet en niveaux de gris (blanc = personnage)
  async function silhouette(src) {
    if (!KS.ai?.available) throw new Error('Le détourage par IA n’est disponible que dans l’application de bureau');
    const id = await KS.ai.ensureModel();
    if (!id) throw new Error('La découpe a besoin du modèle de détourage BiRefNet (menu IA › Modèles d’IA).');
    const m = await KS.ai.segment(src, id), x = m.getContext('2d'), d = x.getImageData(0, 0, m.width, m.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) { const a = p[i + 3]; p[i] = p[i + 1] = p[i + 2] = a; p[i + 3] = 255; }
    x.putImageData(d, 0, 0);
    return m;
  }

  // Image → document en calques (pas encore ouvert) : groupes Décor (Fond) et Personnage (pièces à masques)
  C.cutLayers = async (src, name) => {
    const alpha = await silhouette(src);
    await KS.ws.ensure('wallpaper', { quiet: true });          // le moteur d'Animation (pose, GrabCut, LaMa)
    const r = await N.animationCut(await pngBytes(src), await pngBytes(alpha), true);
    if (!r.ok) throw new Error(r.error);
    const doc = new KS.Doc({ name, width: src.width, height: src.height });
    const groups = new Map();
    for (const c of r.calques) { if (!groups.has(c.groupe)) groups.set(c.groupe, []); groups.get(c.groupe).push(c); }
    for (const [g, list] of groups) {                           // du dessous vers le dessus ; le groupe après ses enfants
      const G = new KS.Layer({ name: g || 'Personnage', kind: 'group', parent: null });
      for (const c of list) {
        const L = new KS.Layer({ name: c.nom, canvas: await canvasOf(c.couleurs), x: c.x, y: c.y, parent: G.id });
        if (c.masque) {
          const mc = await canvasOf(c.masque);
          L.mask = { canvas: mc, ctx: mc.getContext('2d'), x: c.x, y: c.y, enabled: true, linked: true, outside: 0, alpha: null };
          L.maskChanged();
        }
        doc.layers.push(L);
      }
      G.blend = 'pass';
      doc.layers.push(G);
    }
    const corps = doc.layers.find(L => L.name === 'Corps');
    doc.activeId = (corps || doc.layers[doc.layers.length - 1]).id;
    doc.history.items[0].name = 'Découpe en calques';
    return { doc, count: r.calques.length, journal: r.journal };
  };

  // Retouche : le document en cours → un nouveau document en calques, à corriger puis « Animer l'illustration »
  C.cutForAnimation = async () => {
    const d0 = KS.state.doc; if (!d0) throw new Error('Ouvrez une illustration dans Retouche');
    const src = U.copyCanvas(d0.composite());
    const { doc, count } = await C.cutLayers(src, d0.name.replace(/\.[^.]+$/, '') + ' — calques');
    doc.dirty = true; KS.addDoc(doc);
    KS.toast(`${count} calques. Corrigez un masque au pinceau (blanc = montrer, noir = cacher), puis « Animer l’illustration ».`, 'ok', 8000);
    return doc;
  };

  // Atelier Animation, « ✂ Découper en calques » : la découpe de l'image du projet devient son calques.psd, ouvert dans
  // Retouche ; l'atelier recharge ensuite le document (rôles devinés d'après les noms des calques).
  C.cutAnimationProject = async dossier => {
    const f = await N.animationScene(dossier); if (!f.ok) throw new Error(f.error);
    const file = await N.readFile(f.path); if (file.error) throw new Error(file.error);
    const src = await KS.io.canvasFromEntry({ ...file, name: 'scene.png' });
    const { doc, count } = await C.cutLayers(src, 'calques.psd');
    const w = await N.animationWriteDocument(dossier, await KS.io.writePSD(doc));
    if (!w.ok) throw new Error(w.error);
    // une version précédente de ce document ouverte dans Retouche : fermée si intacte, sinon détachée du fichier
    const same = p => p && String(p).toLowerCase() === String(w.path).toLowerCase();
    for (const old of KS.state.docs.filter(x => same(x.path))) {
      if (old.dirty) { old.path = null; old.name = old.name.replace(/\.psd$/i, '') + ' (avant redécoupe)'; }
      else await KS.closeDoc(old);
    }
    doc.path = w.path; doc.format = 'psd'; doc.dirty = false;
    KS.ws.go(null); KS.addDoc(doc);
    KS.toast('Calques ouverts dans Retouche : corrigez les masques si besoin, enregistrez (Ctrl+S), puis « Recharger » dans Animation.', 'ok', 8000);
    return { calques: count };
  };
})();

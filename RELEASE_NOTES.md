# 1.31.0 — Animation : découper une image en calques

- Dans Animation, **« ✂ Découper en calques »** transforme une image plate en document en calques complet (fond, décor, cheveux derrière et devant, corps, visage, robe, manches, bras, bijoux…), avec les parties cachées repeintes (Animation 2.4).
- La découpe réserve la carte graphique comme les autres tâches d'Animation, et le moteur IA n'est déchargé qu'une fois à la fin.
- **« Ouvrir le document »** ouvre `calques.psd` dans l'Édition : corrigez un calque ou repeignez une partie cachée, enregistrez (Ctrl+S), puis **« Recharger »** dans Animation. Chaque calque garde son rôle.

# 1.30.2 — Animation Vidéo : les extensions de ComfyUI se mettent à jour

- À chaque ouverture de l'atelier Animation Vidéo, KaneApp met à jour **ComfyUI** (comme avant) **et maintenant ses extensions** (KJNodes, rgthree, Easy-Use, DaSiWa…).
- Une extension modifiée à la main n'est pas touchée. L'état d'avant est gardé, et il est rétabli si l'installation de ses paquets échoue.
- Le journal de l'atelier indique ce qui a été mis à jour.

# 1.30.1 — Atelier Lora : le préréglage conseillé

- **« Conseillé : … »** sous les types de LoRA, pour Style, Technique et Peinture numérique. KaneApp lit les légendes du projet :
  - un procédé (monochrome, aquarelle, encre, croquis…) sur la plupart des images → **Technique** ;
  - la même ambiance lumineuse (contre-jour, flou d'arrière-plan, particules…) sur la plupart des images → **Peinture numérique** ;
  - sinon → **Style**.
- La raison est affichée, et « Choisir … » applique le type d'un clic. Rien n'est changé sans votre clic.

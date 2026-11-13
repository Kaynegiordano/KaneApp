# 1.34.0 — L'entraînement Lora et le Merge passent dans Lora Studio

- **Lora Studio** est une application à part. Elle reprend l'atelier d'entraînement Lora et le Merge (fusion de LoRA et de checkpoints), avec les mêmes projets et les mêmes moteurs.
- Le Studio IA de KaneApp n'a plus les onglets Lora et Merge. L'utilisation des LoRA ne change pas : liste des LoRA, fiches, poids et déclencheurs dans Créer et Transformer.
- Pendant un entraînement dans Lora Studio, le Studio attend sa fin avant de générer, comme avant.
- « Essayer » dans Lora Studio ajoute le LoRA et son déclencheur à l'invite de Créer.
- Menu Studio › « Lora Studio (entraînement, Merge)… » ouvre l'application.

# 1.33.0 — KaneApp s'appelle KaneApp partout

- Le programme devient **KaneApp.exe**, installé dans `Programs\KaneApp` (au lieu de `Programs\Kanevas\Kanevas.exe`). La mise à jour déplace l'installation toute seule et recrée les raccourcis.
- L'installateur s'appelle **KaneApp-Setup**, et le dépôt GitHub **Kaynegiordano/KaneApp** (l'ancienne adresse redirige).
- Les dossiers de KaneOS deviennent **KaneApp** (le code) et **KaneAppData** (les moteurs IA). Vos préférences passent dans `%APPDATA%\KaneApp`.
- Rien n'est perdu : réglages, projets, galerie, Lora et moteurs restent en place. Les anciens chemins restent valables grâce à un lien invisible.
- Si KaneApp était épinglé à la barre des tâches, épinglez-le de nouveau depuis le menu Démarrer.

# 1.32.0 — Animation : éditeur de squelette

- Pour un document en calques, l'onglet **« 1. Squelette »** d'Animation montre les os du personnage sur l'image (Animation 2.6). L'onglet **« Zones »** reste pour les yeux, l'eau, les particules et la lumière.
- **Articulations** : glissez un rond blanc (épaule, coude, poignet, cou…) quand la pose détectée est décalée.
- **Mouvements** : pour chaque famille (respiration, tête, bras, cheveux, tissus, bijoux), une case, l'amplitude et la vitesse ; pour un os, son amplitude, « Figé » ou son ressort.
- **Pièces** : choisissez l'os qui porte un calque, par exemple une main posée sur la hanche portée par le bassin.
- **Chaînes** : tracez une mèche ou un pan de tissu en cliquant de la racine à la pointe, ou retirez une chaîne mal placée.
- **« Appliquer ▶ »** met l'aperçu à jour en quelques secondes, sans refaire toute l'animation. Vos retouches sont gardées quand vous relancez « 2. Animer ».

# 1.31.1 — Animation : l'aperçu bouge comme dans Wallpaper Engine

- L'aperçu de l'atelier et la vidéo jouent maintenant **le même personnage-marionnette que la scène** : mêmes os, mêmes mouvements de la tête, des bras, des cheveux et des tissus (Animation 2.5.2). Avant, l'aperçu animait encore les anciens calques, bien moins que Wallpaper Engine.
- Le clignement et le regard suivent la tête du personnage dans l'aperçu, comme dans la scène.
- Les vagues et l'herbe s'affichent aussi dans l'aperçu de l'atelier.

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

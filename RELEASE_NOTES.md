# 1.38.0 — Animer : vos images bougent dans Wallpaper Engine

- Nouvel espace **Animer**. Ouvrez une image (fichier, document de Retouche, média du projet, ou glissez-la), ajoutez un mouvement et **peignez où il agit** : l'aperçu bouge tout de suite, sans bouton « Animer » ni attente.
- Cinq mouvements, ceux de Wallpaper Engine : **Respiration** (glissez le pinceau dans le sens du mouvement), **Cheveux et tissus** (vagues dans le sens des mèches), **Lueur** (yeux, bijoux, magie, à la couleur choisie), **Regard** (les yeux regardent ailleurs puis reviennent), **Clignement**.
- **Ambiances** à placer sur l'image : braises, feuilles au vent, pétales de sakura, brume, poussière dans la lumière, rayons, neige, éclats magiques. Et un **halo lumineux** autour des zones claires.
- L'aperçu utilise les mêmes formules que Wallpaper Engine : ce que vous voyez est ce que le fond d'écran jouera.
- **Tester dans Wallpaper Engine** ouvre la vraie scène dans une fenêtre, sans toucher au fond d'écran. **Envoyer** l'ajoute à vos fonds ; **Envoyer et appliquer** la pose sur le bureau. Dans l'éditeur de Wallpaper Engine, tout reste modifiable, et chaque mouvement ou ambiance a sa case dans les réglages du fond.
- Vos animations sont enregistrées toutes seules dans `output\animer` et se rouvrent depuis « Mes animations ».
- Il faut Wallpaper Engine (Steam) pour les ambiances et l'envoi.

# 1.37.0 — Animation retirée, place à Vidéo IA

- L'atelier **Animation** (fonds animés pour Wallpaper Engine) est retiré de KaneApp : onglet, menus, découpe en calques et moteur.
- L'espace ComfyUI devient **Vidéo IA**, un onglet comme les autres : étape « Vidéo IA » sur l'écran Projet, « Faire une vidéo IA » sur un média de la bibliothèque, et dans le menu IA.
- Il faut Kane OS 5.3.0.

# 1.36.0 — Découpe en calques dans Retouche (Animation 4.0)

- Nouveau : **IA › Découper en calques pour l’animation**. L’illustration ouverte devient un document en calques : Fond, Cheveux derrière, Corps, Bras, Cheveux devant. Plus de SAM : la silhouette vient du détourage de Retouche (BiRefNet), et les membres sont séparés d’après le squelette, en suivant les bords de l’image.
- Chaque pièce a un **masque de fusion** : peignez-le en blanc ou en noir pour agrandir ou réduire une pièce. Les parties cachées (le corps sous un bras, les cheveux derrière la nuque, le fond) sont déjà repeintes.
- **Animer l’illustration** envoie ce document avec ses calques : l’animation est construite sur les pièces.
- Dans l’atelier Animation, **✂ Découper en calques** passe aussi par Retouche : le document s’ouvre pour correction, puis Ctrl+S et « Recharger ».
- Il faut Kane OS 5.2.0 (moteur Animation 4.0).

# 1.35.0 — Super résolution générative (Kane MultiDiffusion)

- **Super résolution IA** a deux méthodes. **Générative** (par défaut) ajoute du vrai détail : l'image agrandie par le modèle choisi (4x-UltraSharp…) est repeinte par tuiles par le moteur du Studio. **Classique** garde l'agrandisseur seul.
- La générative utilise **Kane MultiDiffusion**, une nouvelle extension du moteur, plus fidèle et plus rapide que MultiDiffusion :
  - moins de tuiles (2048 × 3072 : 6 au lieu de 12), et des raccords qui changent de place à chaque pas ;
  - chaque tuile ne reçoit que ce qu'elle montre (WD14), avec un négatif contre les visages là où il n'y en a pas. Sur l'image d'essai, MultiDiffusion inventait un petit personnage derrière une main ; ici, rien n'apparaît ;
  - les formes et les couleurs de la source sont tenues.
- Réglages : ×1,5 à ×4, créativité (0,35), détail en plus, invite (reprise de l'image si elle vient du Studio), invite par tuile. Au-delà de ×2, deux passes. Environ 50 s pour ×2 d'une image de 2 mégapixels sur une RTX 5080.
- Dans le Studio, image vers image › **MultiDiffusion** propose **Kane MultiDiffusion** (conseillé) avec ses réglages : structure, détail en plus, couleurs d'origine, chevauchement, taille de tuile, invite par tuile.
- Il faut le moteur du Studio à jour (Kane OS) : sinon la méthode générative est grisée et le Studio revient à MultiDiffusion.

# 1.34.1 — KaneApp se ferme toujours

- Un projet Animation supprimé pendant qu'il était ouvert bloquait la fermeture de KaneApp. À chaque essai, le message « Les zones de l'animation n'ont pas pu être enregistrées » s'ajoutait. Le projet disparu est maintenant refermé, sans rien bloquer.
- Si l'enregistrement des zones échoue vraiment, KaneApp propose « Quitter sans enregistrer » au lieu de refuser de se fermer.

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

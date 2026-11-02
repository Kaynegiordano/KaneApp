# 1.19.0 — Kane Detailer : skip img2img, force par partie

- **Skip img2img** (onglet img2img) : pas de passe img2img classique, seule l'image source est détaillée partie par partie. Ignoré en inpaint.
- **Une force par partie**, à la place de « Intensité ». Chaque partie a son curseur, avec un bouton ↺ pour revenir à la recette. Repères : 0,15–0,25 retouche légère, 0,3–0,4 redessine les détails, 0,5 et plus peut changer la forme.
- **Voir les zones** (clic droit sur un résultat) : montre ce que Kane Detailer va repeindre, sans rien générer.
- Détection plus sûre : les mains et les hauts de vêtements souvent manqués sont maintenant trouvés (seuils par partie et second avis pour les mains).

# 1.18.0 — Kane Detailer

- **Studio IA : volet Kane Detailer**, à côté d'ADetailer, pensé pour l'illustration et la peinture numérique. Après la génération, chaque partie choisie est détectée puis repeinte de près : vêtements, cheveux, mains, visage, yeux. Le corps entier, les pieds et les bijoux sont disponibles en option.
- Chaque partie a sa propre recette. L'invite ne garde que ce qui décrit la partie (couleur des yeux, des cheveux…), avec le style et les LoRA. Les deux yeux sont repeints ensemble, et le visage n'est pas repeint par la passe des cheveux. Le résultat garde la teinte et la lumière d'origine.
- Préréglages Portrait, Corps entier et Tout. Réglages : intensité, part de couleurs d'origine gardée, résolution de travail.
- **Détailler (Kane Detailer)** : bouton ou clic droit sur un résultat déjà fait.
- Il faut que Kane OS soit à jour (extension dans le moteur du Studio, nouveaux détecteurs dans models/adetailer).

# 1.17.0 — KaneApp, copie au clic droit, Amélioration rapide

- L'application s'appelle **KaneApp** partout : fenêtre, menus, raccourcis, liste des applications de Windows, Kane OS. Vos préférences, modèles et projets ne bougent pas.
- **Studio IA** : clic droit sur l'image (résultat, plein écran, galerie) → **Copier l'image** (PNG en pleine résolution, prêt à coller ailleurs), Enregistrer, Ouvrir dans Retouche, etc.
- **Retouche** : bouton **Amélioration rapide** (baguette en haut, menu Image, Ctrl+Maj+Q). Il applique 20 % de chaque correction automatique (ton, contraste, couleur) avec un peu de vibrance, de clarté et de netteté, en une seule étape (Ctrl+Z pour revenir).

# 1.16.1 — Angle : le même prompt que l'image

- L'invite ET l'invite négative de l'image sont reprises et envoyées telles quelles à Forge (plus de préfixe ni de négatif ajoutés). Elles restent modifiables.
- Sampler SEEDS 3 + Beta57, 22 étapes par défaut (réglables dans l'onglet). CFG et Shift repris de l'image.

# 1.16.0 — Studio IA : changer l'angle d'une image

- L'onglet Pose 3D est remplacé par **Angle** : on envoie son image (Retouche, fichier, glisser-déposer ou dernière image créée) et on la regarde d'un autre point de vue.
- Le relief de l'image est calculé sur votre PC (Depth Anything V2 Large, 1,3 Go téléchargé une fois, environ 1 à 3 s sur la carte graphique).
- Tourner, incliner, rapprocher à la souris ou avec les curseurs ; vues toutes faites (¾ gauche/droite, plongée, contre-plongée). Les zones à repeindre s'affichent en direct.
- « Générer le nouvel angle » : Forge (ANIMA) repeint les zones découvertes et les bords à la taille de l'image, avec l'invite reprise de l'image ; le reste garde ses pixels. « Unifier le dessin » (0,2 par défaut) repasse légèrement sur toute l'image pour effacer l'effet de relief.
- Jusqu'à environ 25° le dessin reste fidèle ; au-delà, Forge invente davantage. La pose ne change pas.

# 1.15.0 — Studio IA : Pose 3D

- Nouvel onglet **Pose 3D** sous Transformer : un corps humain réaliste (MakeHuman), femme ou homme, muscles, poids, taille, proportions.
- Poser : cliquer une partie du corps et tourner les anneaux ; mains et pieds se tirent avec « Déplacer » (le bras ou la jambe suit). Symétrie, miroir, annuler (Ctrl+Z).
- 16 poses toutes faites (debout, marche, course, assis, à genoux, garde…), 7 poses de main, vos poses enregistrées.
- Caméra : vues Face, Trois-quarts, Profil, Dos, Plongée, Contre-plongée, Buste, Visage ; focale de 12 à 200 mm. Lumière orientable, contre-jour, ombre au sol.
- Dessin de référence derrière le mannequin (depuis Retouche ou un fichier) pour caler l'angle et la pose.
- Envoi : calque guide dans le dessin ouvert (ombré, contours, silhouette, profondeur, normales, OpenPose), nouveau document, Transformer ou PNG.

# 1.14.2 — Animation : rebouchage avec ANIMATION_INPAINT

- Le rebouchage des tuiles (mode Découpes) utilise le checkpoint tout-en-un **ANIMATION_INPAINT** (créé avec Merge) quand Forge le voit ; sinon le checkpoint du Studio, comme avant.
- Le temps de la passe, les modules VAE / encodeur du Studio sont écartés (le fichier porte les siens), puis rendus tels qu’ils étaient.

# 1.14.1 — Merge : VAE et encodeur de texte intégrés

- Nouveau mode **VAE + encodeur** dans l’onglet Merge : un checkpoint ANIMA, son VAE et son encodeur Qwen3 0.6B dans un seul fichier. Forge le relit exactement comme avec les trois fichiers séparés (comparé couche par couche avec son propre chargeur). Dans le Studio, laisser « VAE / Text Encoder » vide.
- Les modes **Checkpoints** et **LoRA → Checkpoint** peuvent aussi intégrer VAE et encodeur au fichier produit (facultatif).
- Les fichiers choisis sont vérifiés (VAE Wan 2.1 / Qwen-Image, encodeur Qwen3 0.6B) ; autre architecture que ANIMA : refusé avec un message clair.
- Le fichier grossit d’environ 1,5 Go.

# 1.14.0 — Studio IA : onglet Merge

- Nouvel onglet **Merge** juste sous Lora : mixer des LoRA, mélanger des checkpoints, fusionner des LoRA dans un checkpoint.
- **LoRA + LoRA** : un seul LoRA à partir de plusieurs, avec une force par LoRA. « Exact » additionne les rangs (identique à charger les LoRA ensemble) ; « Recompressé » ramène la somme au rang voulu (SVD).
- **Checkpoint + Checkpoint** : somme pondérée A·(1−α)+B·α, ou différence ajoutée A+α·(B−C) ; dégradé d’α le long des blocs (structure de A, style de B). Les checkpoints de noms de couches différents (ANIMA « net. » / « model.diffusion_model. ») se marient.
- **LoRA → Checkpoint** : le LoRA fait partie du modèle, sans rien à charger ni écrire dans l’invite. Les couches sans LoRA restent identiques ; le compte rendu indique combien de modules ont été appliqués.
- Vérifications avant de lancer : architectures lues dans les fichiers (ANIMA, SDXL, SD 1.5…), fusion bloquée si elles diffèrent. Progression, annulation, précision de sortie (bf16 / fp16 / fp32).
- Fichiers d’origine jamais modifiés ; résultats dans output/merge (checkpoints, listés par Forge dans Stable-diffusion/KaneApp) et output/lora (LoRA). Bouton « Utiliser dans le Studio » : relit les modèles et sélectionne le checkpoint obtenu.
- Essais sur deux checkpoints ANIMA de 4 Go : fusion en 3 à 5 secondes.

# 1.13.1 — Animation : la scène va dans « a poster »

- Sortie Scène : « a poster » contient la scène Wallpaper Engine et plus aucun fond Web ; Wallpaper Engine la reconnaît comme une scène.
- L’aperçu Web de l’atelier passe dans « work\apercu web ». En sortie Web, « a poster » reçoit le fond Web comme avant.
- Les interactions (Appliquer) ne recouvrent jamais une scène.

# 1.13.0 — Plus fluide, palette de commandes, VRAM libérée

- Copies de secours sans gel : calques encodés en parallèle hors de l’interface, calques inchangés non réencodés (gel 690 → 40 ms sur une image 4K à 3 calques).
- Montage (KaneClip 1.4.2) : plus aucun calcul quand rien ne bouge, même masqué ; inclut le rendu 4K de KaneClip 1.4.1.
- Jauge VRAM : un seul relevé continu du pilote au lieu d’un processus toutes les 3 secondes.
- Clic sur la jauge VRAM : libérer la mémoire graphique (Studio, ComfyUI) maintenant ou après 10 min / 30 min / 1 h sans génération. Modèle rechargé à la génération suivante.
- Palette de commandes (Ctrl+Maj+P ou la loupe) : menus, outils, espaces, fichiers récents et réglages en quelques lettres, sans accents.
- Animation et ComfyUI s’ouvrent dès qu’ils sont prêts ; mise à jour de ComfyUI plus rapide (pip seulement si ses dépendances changent).

# 1.12.18 — Montage : Atelier créatif et sous-titres

- KaneClip 1.4 intégré : cinq looks éditables, intensité et mouvements progressifs sur les plans sélectionnés.
- Sous-titres SRT : importer, corriger, caler, rechercher, styliser et exporter ; incrustation dans la vidéo.
- Ctrl+K : palette d’actions avec recherche et navigation au clavier.
- Lecture et timeline : index des événements et affichage limité aux clips visibles ; temps de composition et désactivation temporaire des effets d’aperçu.
- Inclut le moniteur Source/Programme, le montage par insertion/remplacement, le rasoir et les améliorations de l’édition 1.12.17.

# 1.12.17 — Montage : KaneClip 1.3

- Moniteur Source / Programme et disposition Dérushage.
- Montage par insertion ou remplacement sur pistes vidéo/audio ciblées.
- Rasoir, levée et extraction de plage ; suppression ondulée corrigée.
- Effets réglables dans Propriétés et gestionnaire de marqueurs.
- Vérifications en profil isolé avec média synthétique et export réel.

Kane App / Kanevas 1.12.16 — Un clic = plein écran

- Studio IA : un simple clic sur le résultat l'ouvre en plein écran (avant : double-clic).
- Pendant une génération, un clic sur l'aperçu en direct montre la dernière image terminée en plein écran ; la génération continue derrière.

Kane App / Kanevas 1.12.15 — Chercher dans l'invite

- Studio IA : 🔍 (ou Ctrl+F dans l'invite) surligne, parcourt et remplace un mot dans l'invite et l'invite négative, comme l'extension Forge « Chercher dans le prompt ».
- 🕘 Historique des 60 dernières invites générées, avec recherche ; un clic les reprend.
- 🧹 Nettoyer : retire les tags en double, virgules et espaces en trop (Ctrl+Z annule).

Kane App / Kanevas 1.12.14 — Montage : mouvement de piste

- Montage (KaneClip 1.2.0) : curseur « Zoom » dans l'en-tête de chaque piste vidéo (double-clic = 100 %) et bouton de mouvement de piste (zoom, position, rotation, remplir le cadre) ; clic droit sur une piste : remplir, réinitialiser, transformer ses événements.

Kane App / Kanevas 1.12.13 — Montage : transformer plusieurs vidéos

- Montage (KaneClip 1.1.0) : « Transformer plusieurs événements… » (Ctrl+Maj+G, menu Outils, clic droit, Propriétés) remplit ou ajuste au cadre, zoome, tourne et recentre toute la sélection, les pistes concernées ou tout le projet en une fois, annulable.
- Espace de montage façon VEGAS Pro : dispositions, panneau Propriétés, médias classés par type.

Kane App / Kanevas 1.12.12 — Respiration douce

- Animation : case « Respiration douce de tout le personnage » (par défaut, sans zone à peindre) avec réglage d'amplitude ; le corps et les calques suivent, boucle sans à-coup, curseur Wallpaper Engine. Cliquez « Appliquer au Web ».

Kane App / Kanevas 1.12.11 — 📐 = taille exacte de la source

- Transformer : 📐 prend la taille exacte de l'image source (5568 x 3072 reste 5568 x 3072) ; curseurs étendus. Une nouvelle image reste ajustée par défaut (1856 x 1024) ; avertissement au-dessus de 2048 px avec un bouton « Réduire à… ».

Kane App / Kanevas 1.12.10 — Resize by fidèle à la source

- Transformer : « Resize by » suit la taille ajustée à la source quand 📐 est actif (5568 x 3072 : échelle 0,333 = 1856 x 1024, plus 1,0). Échelle de 0,1 à 4, avertissement au-dessus de 2048 px.

Kane App / Kanevas 1.12.9 — Taille de l'image source plus juste

- Transformer : la taille automatique garde les proportions exactes de l'image donnée (5568 x 3072 donne 1856 x 1024 au lieu de 2048 x 1128, qui recadrait). La zone Taille affiche source et taille utilisée.

Kane App / Kanevas 1.12.8 — Atelier Lora en deux colonnes

- Onglet Lora du Studio : projet, preset et légendes à gauche, réglages et entraînement à droite, au lieu d'une colonne qui laissait un grand vide à droite.
- Correction : « null » affiché en bas de l'onglet sans projet ouvert.

Kane App / Kanevas 1.12.7 — Aperçu net, Studio plus rapide, clic droit sur Lora

- Aperçu en direct net : le latent est décodé par le VAE, à la taille du résultat, et remplit la zone (avant : petite image approximative au milieu d'un grand cadre). Réglage Net / Rapide / Désactivé dans Réglages. Environ 6 % de temps en plus.
- Studio plus rapide : le dernier catalogue (modèles, LoRA, échantillonneurs) s'affiche tout de suite pendant que le moteur démarre, et le modèle est chargé en avance : la première génération n'attend plus 20 s de plus.
- Clic droit sur le bouton Lora du Studio (ou sur la carte d'entraînement) : Arrêter l'entraînement, Arrêter et relancer, Actualiser.

Kane App / Kanevas 1.12.6 — Actualiser dans l'atelier LoRA, ComfyUI à jour

- Studio IA > LoRA : le bouton Actualiser relit les projets et l'état de l'entraînement, et libère un entraînement bloqué (processus disparu ou numéro réutilisé par Windows) qui empêchait de relancer.
- Si l'entraînement en cours ne donne plus signe de vie depuis 15 minutes, l'atelier le signale ; le bouton Stop le ferme.
- ComfyUI se met à jour à chaque démarrage depuis Kanevas (git et paquets Python, retour arrière si une installation échoue), puis démarre sur la version à jour.
- Inclut les icônes 1.12.3 à 1.12.5.

Kane App / Kanevas 1.12.5 — Icône Windows au lancement

- L'icône de la fenêtre et de la barre des tâches est fournie par un fichier ICO accessible directement à Windows, en dehors de l'archive de l'application.
- Le symbole K tricolore et les dix tailles d'icône sont conservés.

Kane App / Kanevas 1.12.4 — Icône K tricolore

- La rosace est remplacée par un K géométrique corail, jaune et turquoise sur fond anthracite.
- Cette identité distingue Kanevas du K blanc sur fond bleu de Kane OS.
- Le symbole est commun à l'interface, à l'exécutable, aux raccourcis et à l'installateur Windows.

Kane App / Kanevas 1.12.3 — Nouvelle icône multicolore

- Une rosace de rubans multicolores remplace le K blanc sur fond bleu pour distinguer Kanevas de Kane OS.
- La même identité est utilisée dans la fenêtre, l'accueil, À propos, la version web, les raccourcis et l'installateur Windows.
- Icône transparente avec dix tailles natives de 16 à 256 pixels pour Windows.

Kane App / Kanevas 1.12.2 — L'espace « Edition » devient « Retouche »

- L'espace d'édition d'images s'appelle désormais Retouche, pour ne plus le confondre avec le menu Édition. Le nom est changé partout : panneau Kane App, étape du parcours (Créer · Retoucher · Animer · Monter), Studio IA, bibliothèque, Préférences et couleurs des espaces.
- Le menu Édition (annuler, copier, coller…) ne change pas.

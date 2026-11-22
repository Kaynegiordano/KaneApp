# 1.50.0 — Studio IA : Surprends-moi

- **Surprends-moi** (bouton à étoiles sous l'invite, à côté de Nettoyer) : ajoute à la fin de l'invite une mise en scène tirée au hasard, un cadrage, une lumière, un lieu et une ambiance (par exemple : de dos, contre-jour, forêt de bambous, lucioles). Votre personnage, vos LoRA et le reste de l'invite ne changent pas.
- Cliquer encore remplace le tirage par un autre, sans jamais reprendre les mêmes idées deux fois de suite. Ctrl+Z annule.
- Ce que l'invite décrit déjà est respecté : si vous avez écrit un cadrage ou une lumière, cette catégorie n'est pas tirée.

# 1.49.0 — Montage : vidéos fluides, détails stables

- **Fluidité IA** : une vidéo à 16 ou 24 images par seconde rendue en 30 ou 60 (ou un ralenti) n'a plus d'images répétées. Dans **Rendre en tant que › Fluidité**, choisissez « IA : créer les images intermédiaires » : l'IA calcule le mouvement et crée les images manquantes, sans saccades. Elle utilise le modèle RIFE déjà présent dans le dossier des modèles ; rien n'est téléchargé.
- **Détails stables** : avec l'agrandissement IA, la case « Stabiliser les détails » (cochée par défaut) évite que les détails inventés par le modèle scintillent d'une image à l'autre.
- **Plus rapide** : l'agrandissement IA va 1,7 à 3 fois plus vite sur les plans de plus de 40 images. La première fois, la préparation du modèle prend jusqu'à une minute.
- **Aperçu avant/après…** : à côté du choix du modèle IA, comparez sur une image du Programme l'agrandissement classique et celui du modèle, en glissant la séparation, à la taille réelle si vous voulez ; « Garder ce modèle » le reprend pour le rendu.
- **10 bits** : en HEVC, AV1 et VP9, la case « 10 bits » (cochée par défaut) garde les dégradés lisses (ciel, fonds flous, ombres) au lieu de former des bandes.

**Corrigé** : un projet rendu à une autre cadence que la sienne (24 i/s rendu en 60) pouvait montrer une image noire à un raccord.

# 1.48.1 — Mémoire graphique rendue pour de bon

- **Libérer maintenant** (jauge VRAM) et le déchargement automatique rendent maintenant toute la mémoire graphique du Studio : il restait environ 5,6 Go après le déchargement (cache de la carte, détecteurs de Kane Detailer, agrandisseurs), il n'en reste plus que le minimum (~0,2 Go en plus de Windows).
- **Changer de programme** : quand un autre programme a besoin de la carte graphique (un jeu, ComfyUI de Vidéo IA, Animation…) et que le Studio n'a rien généré depuis une minute, KaneApp décharge le Studio aussitôt, sans attendre le délai réglé, et le signale. Avant, Windows déplaçait sa mémoire graphique dans la RAM au lieu de la libérer, puis la faisait remonter d'un coup au retour.
- Le modèle est rechargé à la génération suivante (quelques secondes).

Nécessite le moteur du Studio à jour : redémarrez le moteur.

# 1.48.0 — Montage : agrandissement IA au rendu

Quand une vidéo est plus petite que le rendu (1376×768 rendue en 1080p ou en 4K, par exemple), Montage peut maintenant l'agrandir avec un modèle d'IA au lieu d'une simple interpolation : les contours, les cils, les mèches de cheveux redeviennent nets au lieu d'agrandir le flou de compression.

- **Rendre en tant que › Agrandissement › Méthode : IA**. Le modèle est choisi automatiquement (×2 jusqu'au double, sinon ×4) ou à la main parmi ceux du dossier des modèles (`models\ESRGAN`). Rien n'est téléchargé.
- Les plans agrandis passent d'abord par le modèle, sur la carte graphique, avec une barre de progression ; compter de l'ordre d'une seconde par image. Un plan déjà agrandi est repris tel quel aux rendus suivants.
- Les couleurs et la lumière de la source sont conservées, image par image et raccord compris.
- Le modèle traite chaque image séparément : sur les détails très fins (cheveux, herbe), un léger scintillement reste possible.

# 1.47.0 — Montage : couper les passages figés

Les vidéos MiniMax en boucle atteignent souvent leur dernière image en avance, puis ne bougent plus : la boucle marque une pause à chaque tour. Montage repère maintenant ces moments et les retire.

- **Outils › Couper les passages figés…**, au clic droit d'un plan vidéo ou avec Ctrl+K : les plans sélectionnés sont analysés (tous les plans vidéo si rien n'est sélectionné). La liste indique chaque passage figé trouvé (début, milieu, fin) et la durée retirée ; **Couper** les retire, le son lié avec.
- La détection s'adapte à chaque vidéo : un petit mouvement localisé, comme un clignement, compte comme du mouvement, alors qu'un léger scintillement de compression n'empêche pas de reconnaître une image figée. Un passage simplement lent n'est pas coupé.
- Boucle (dernière image identique à la première) : toute la fin figée est retirée, et la première image fait la jonction, sans doublon.
- « Ne couper qu'au début et à la fin » garde les pauses du milieu. Ctrl+Z annule la coupe en une fois.

**Corrigé : rendu exact à l'image près aux raccords.** À 24 images par seconde, environ un raccord sur deux perdait la première image du plan suivant et répétait la dernière du précédent : une petite saccade à chaque coupe. Chaque image rendue est maintenant la bonne.

# 1.46.0 — Signer des images

L'outil « Signer des images » de Kane OS est maintenant dans KaneApp, avec le même rendu : une copie 720p en JPEG, sans métadonnées, filigranée KG et signée « KG · Kane Giordano » en bas à droite (noire, blanche ou ombrée selon le fond).

- **Fichier › Signer des images…** : choisissez une ou plusieurs images. Un aperçu montre la première image, avec la protection au choix : filigrane sur toute l'image, grand KG au centre ou signature seule. Les copies vont dans « Images signées », à côté des originaux, sans rien écraser ; le dossier s'ouvre à la fin.
- **Fichier › Exporter › Signée pour les réseaux (720p, KG)…** : le document ouvert, tel qu'il s'affiche.

Les originaux ne sont jamais modifiés. La dernière protection choisie est retenue.

# 1.45.3 — Animation Wallpaper Engine : avec le squelette, les zones peintes agissent de nouveau

- Avec le squelette du personnage, les zones peintes (respiration, soulèvement) bougent de nouveau le personnage dans l'aperçu, et les yeux suivent.
- Le fond envoyé à Wallpaper Engine est fidèle à l'aperçu : plus de trou sombre entre le visage et les cheveux ni de bords en dents de scie (moteur Animation 4.1.0, Kane OS).

# 1.45.2 — Visages : KaneDraw et Kane Detailer corrigés

- **KaneDraw** : les visages sont vraiment épargnés par la simplification en masses. Sur ANIMA, ils ne l'étaient pas, alors que les paramètres de l'image indiquaient `faces=1`.
- **Kane Detailer** : un visage dont le repeint échouait (mémoire vidéo pleine…) restait tel quel, sans rien dire. Il est maintenant réessayé. S'il échoue encore, un avertissement s'affiche, et la zone apparaît « non repeinte » dans « Zones repeintes », où **Refaire** la reprend.

Nécessite le moteur du Studio à jour (KaneDraw 2.2.1, Kane Detailer 5.5.1) : redémarrez le moteur.

# 1.45.1 — Aperçus de LoRA avec leurs paramètres

Corrigé : une image posée comme aperçu d'un LoRA (fiche 🛠️) perdait son invite et ses réglages de génération. L'aperçu les garde maintenant, comme « Replace preview » de Forge : on les retrouve dans PNG Info ou en glissant l'aperçu dans le Studio.

- **Image sélectionnée dans Créer** et **Image du document** : l'invite, le négatif et les réglages de l'image sont écrits dans l'aperçu.
- **Choisir…** : un PNG qui contient déjà ses paramètres est copié tel quel.
- **Enregistrer** / **Tout enregistrer** dans Créer : les images gardent aussi leurs paramètres quand elles n'en avaient pas encore.

Les aperçus posés avant cette version restent sans paramètres : reposez-les depuis l'image d'origine pour les récupérer.

# 1.45.0 — KaneDraw : l'image guide

Dans le panneau KaneDraw (sampler **KaneDraw**, txt2img), le **Croquis** devient l'**Image guide**. Choisissez une photo, une de vos images, un rendu 3D ou un croquis : la pose, l'angle, le cadrage et la lumière la suivent, puis le modèle peint votre invite librement.

- **Force** : à 1, la forme est tenue ; vers 0,5, la graine reprend presque toute la composition.
- **Précision** : de la composition seule (0) à la pose et au contour (1).
- **Durée** : de la composition seulement (0) à presque tout le trajet (1), plus proche de l'image guide.
- **Garder les couleurs** : décoché, les couleurs d'ensemble sont laissées au modèle.
- Un aperçu de l'image guide s'affiche dans le panneau.

Corrigé : un croquis seul brûlait l'image en noir et blanc purs ; le guide tient maintenant toujours au moins la composition.

Le guide suit la forme visible, pas un squelette : une main ou un doigt précis n'est pas reproduit à l'identique.

Nécessite le moteur du Studio à jour (KaneDraw 2.2) : redémarrez le moteur après sa mise à jour.

# 1.44.1 — KaneDraw 2.1 : corrections

- **Visages épargnés** : ils ne l'étaient jamais avec ANIMA (son format d'image n'était pas reconnu). C'est corrigé, et le bord du visage est maintenant protégé aussi.
- **Ébauche** : le bruit de départ était environ 7 % trop fort avec les réglages par défaut. Il est au niveau exact. Les images changent un peu par rapport à la 1.44.0, à graine égale.
- **Croquis** : il ne reste plus comme image de référence du mode Edit d'ANIMA pour la génération suivante.
- Si le croquis, la seconde graine ou les détecteurs de visages échouent, ce réglage est abandonné et l'image est quand même générée. Les paramètres de l'image ne gardent que ce qui a servi.
- Reprendre une image faite sur un croquis prévient que le croquis n'est pas dans ses paramètres.

Nécessite le moteur du Studio à jour (KaneDraw 2.1) : redémarrez le moteur après sa mise à jour.

# 1.44.0 — KaneDraw 2 : ses réglages dans le Studio

Choisissez l'échantillonneur **KaneDraw** : un panneau KaneDraw apparaît dans les réglages de txt2img.

- **Ébauche** : renforce les grandes masses de la graine et les garde pendant la composition (masses et lumière plus franches). À 0, la composition est celle de SEEDS 3.
- **Simplification des masses** : à mi-parcours, l'image est simplifiée puis repeinte. Les formes restent, le détail est réinventé.
- **Guidage qui se relâche** : CFG plus fort au début, plus faible à la fin, jamais sous 1.
- **Épargner les visages** : la simplification ne touche pas les visages (détecteurs de Kane Detailer).
- **Seconde graine** : la composition vient de la graine de l'image, la matière (touche, textures) d'une seconde graine. Boutons : au hasard, ou graine de la dernière image.
- **Croquis** : une image ou le document ouvert dans Retouche donne ses grandes masses de clair et d'obscur à la composition.

Les réglages sont écrits dans les paramètres de l'image et repris par PNG Info (le croquis lui-même n'y est pas). En img2img, KaneDraw reste exactement SEEDS 3.

Nécessite le moteur du Studio à jour (KaneDraw 2, fork perso-anima) : redémarrez le moteur après sa mise à jour.

# 1.43.1 — Kane Detailer : refaire une zone, peindre une zone, juge des mains

- **Zones repeintes** montre maintenant le compte rendu de chaque zone : repeinte ou gardée telle quelle, force, essai retenu, temps et ce qui y a été vu.
- **Refaire** : une zone ratée est repeinte seule, avec une nouvelle graine. Le reste de l'image ne bouge pas.
- **Peindre une zone** (clic droit sur l'image, ou depuis les zones repeintes) : peignez ce que les détecteurs ont manqué, choisissez sa recette (main, visage…) et sa force, puis Repeindre.
- **Petits visages en deux temps** : un petit visage est d'abord agrandi par l'upscaler, puis repeint. Il gagne du vrai détail au lieu d'une tache.
- **Juge des mains appris sur vos images** : marquez des mains « Ratée » ou « Réussie » dans les zones repeintes, puis « Apprendre » (12 de chaque sorte au moins). Le juge n'est gardé que s'il est fiable ; il écarte alors les essais aux mains ratées.
- Il faut le moteur du Studio à jour (Kane Detailer 5.4), puis le redémarrer.

# 1.43.0 — Super résolution générative : aperçu des tuiles, créativité par tuile, hires fix par tuiles

- **Voir les tuiles…** dans la fenêtre de super résolution : la source avec le contour de chaque tuile, et l'invite et le négatif que chacune recevra. Bleu : visage ou mains, la forme est tenue. Orange : zone floue, plus de liberté.
- **Créativité par tuile** (cochée par défaut) : les visages et les mains gardent mieux leur forme, les zones floues ou plates reçoivent plus de détail.
- **Garde-fou mémoire** : si d'autres programmes occupent plus de 2,5 Go de mémoire graphique (Animation, un jeu…), la fenêtre le dit avant de lancer. Sinon le calcul déborde et devient des dizaines de fois plus lent.
- Au-delà de ×2, la seconde passe agrandit avec Lanczos au lieu du modèle ESRGAN (environ 20 s gagnées sur un ×3) : la passe de diffusion redonne le détail.
- L'étiquetage WD14 tourne pendant l'agrandissement de la source, au lieu de s'ajouter après.
- **Studio, Créer › Hires fix › « Par tuiles (Kane MultiDiffusion) »** : la seconde passe se fait par tuiles, avec l'invite de ce que chaque tuile montre. Structure, détail en plus, couleurs d'origine et invite par tuile sont réglables.
- Studio, image vers image › MultiDiffusion : réglages « Tuiles par lot (0 = auto) » et « Créativité par tuile ».
- Il faut le moteur du Studio à jour (Kane MultiDiffusion 1.2).

# 1.42.1 — Super résolution générative : revue

- Créativité basse (0,15 à 0,25) : le calcul fait maintenant au moins 8 pas. Avant, il n'en restait que 4 ou 5, trop peu pour fondre les raccords entre tuiles.
- Annuler une super résolution affiche « Super résolution annulée », plus un message d'erreur.
- Sans tagger WD14 dans le moteur, la fenêtre le dit au lieu de proposer une case sans effet.
- Studio, image vers image › MultiDiffusion : en retouche de zone, une note rappelle que seuls les tuiles et le détail en plus s'appliquent.
- Avec le moteur du Studio à jour (Kane MultiDiffusion 1.1) : retouche de zone et source recadrée corrigées, étiquettes d'ambiance gardées dans toutes les tuiles.

# 1.42.0 — Animation Wallpaper Engine : l'ancien atelier revient

- L'ancien atelier **Animation** revient, sous le nom **Animation Wallpaper Engine** : on peint les zones, on règle leurs mouvements (respiration, cheveux, voile, reflets, scintillement, clignement…) et on obtient une boucle ou un fond d'écran interactif pour Wallpaper Engine.
- Il retrouve sa place : onglet, étape « Animer » de l'écran Projet, « Animer cette image » dans la bibliothèque, IA › Animer l'illustration et Découper en calques pour l'animation.
- **Vidéo IA** (ComfyUI) garde son nom.
- Il faut Kane OS 5.4.0 (moteur Animation Wallpaper Engine).

# 1.41.0 — Animer retiré

- L'espace **Animer** est retiré de KaneApp : onglet, étape « Animer » de l'écran Projet, menus et glisser-déposer.
- Vos animations déjà créées ne sont pas effacées : elles restent dans `output\animer`, et les fonds envoyés restent dans Wallpaper Engine.

# 1.40.0 — Animer : sélection rapide et zones qui s'additionnent

- Nouveau bouton **Sélectionner** sous chaque masque : la **sélection rapide**, la **baguette magique** et la **sélection d'objet** de Retouche, directement dans Animer. Glissez sur les cheveux, la zone s'étend toute seule ; encadrez un objet, l'IA le détoure.
- Les zones **s'additionnent** : la zone suivante (Auto ou sélection) peut **remplacer** le masque, s'y **ajouter**, s'en **retirer** ou le **croiser**. Maj = ajouter, Alt = retirer, comme dans Retouche. Par exemple : Sujet, puis Alt + clic sur les yeux.
- Pour un mouvement à direction (Secousse…), la zone sélectionnée prend le sens que vous choisissez.
- La barre du masque ne déborde plus quand la fenêtre est étroite.

# 1.39.0 — Animer 2 : tout l'éditeur de Wallpaper Engine, en plus simple

- **Tous les effets de Wallpaper Engine** dans Animer : Oscillation Feuillage, Secousse, Vagues d'eau, Débit d'eau, Mouvement Iris, À impulsion, Tournoyer, Rayons divins, Brillance, Flous, Teinte, Profondeur de parallax… (45), avec leurs vrais réglages et leurs noms français. Ils s'ajoutent comme dans Wallpaper Engine (« Ajouter un effet », par groupes, avec recherche).
- L'aperçu les joue avec **leurs propres shaders** : ce que vous voyez est ce que le fond d'écran jouera.
- **Masques** : *Peindre* au pinceau, *Retouche* pour affiner avec la sélection rapide, la baguette, Sélection › Sujet ou le masque rapide (bandeau « Renvoyer à Animer »), ou *Auto* : sujet, arrière-plan, cheveux, yeux, visage, vêtements… détectés par l'IA, ou la profondeur de l'image.
- **Ambiances** : les 68 préréglages de particules de Wallpaper Engine (pluie, braises, feu, feux d'artifice, éclairs, magie, neige, fumée…).
- Écran organisé comme l'éditeur de Wallpaper Engine : **Couches** à gauche, **Propriétés** à droite.
- Corrigé : le curseur disparaissait sur l'image hors peinture ; la zone peinte se voit maintenant en rouge.
- Vos animations d'Animer 1.38 s'ouvrent toujours (converties en effets de Wallpaper Engine).
- La détection des cheveux, yeux et vêtements demande le moteur du Studio IA à jour (Kane OS).

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

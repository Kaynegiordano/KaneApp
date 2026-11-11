# Kanevas

Éditeur d'images de bureau inspiré de Photoshop (Electron + Canvas, 100 % local).

## Lancer
- `Kanevas.vbs`, ou `Lancer Kanevas.cmd`.
- Un fichier passé en argument (ou glissé sur la fenêtre) est ouvert.

## Version web
https://kaynegiordano.github.io/Kanevas/ : le dossier `app/` publié sur GitHub Pages à chaque push sur `main`
(`.github/workflows/pages.yml`). Ouvrir et enregistrer passent par le navigateur ; l'IA locale, les
sauvegardes de secours et les mises à jour restent propres à l'application de bureau. Les polices du PC
sont proposées dans Chrome et Edge (bouton « Polices du PC » de l'outil Texte, après autorisation du site).

## Icône

Le K géométrique corail, jaune et turquoise sur fond anthracite distingue Kane App / Kanevas du lanceur Kane OS. Le visuel source est
`build/icon-source.png`. `python tools/build-icon.py` (Pillow requis) reconstruit `app/icon.png`
et les trois copies ICO utilisées par la fenêtre, les raccourcis et l'installateur. Les ICO contiennent
dix tailles de 16 à 256 pixels ; le symbole reste transparent et indépendant du thème de l'interface.

## Outils récents
### Atelier Lora recalibré (1.29.0)

- **Constat** : les 19 LoRA entraînés par l'atelier avaient tous un poids conseillé de 0,2 à 0,35 (fiches `.json`), contre 0,85 pour les LoRA de la communauté. La recette (taux 1e-4, ~70 passages par image) était environ 3 fois trop forte ; la fiche d'ANIMA conseille 2e-5 pour un rang 32.
- **Recette** (`forge_lora_trainer/lib_trainer/presets.py`, fork Forge `perso-anima`) : taux ×0,5 environ (bande 1e-5…6e-5), passages ×0,6. Style, 24 images : 4,7e-5 et 44 passages au lieu de 9,5e-5 et 70.
- **Légendes** (`caption.py`) : ordre d'ANIMA `[sécurité] [compte] [personnages] [déclencheur] [reste]`, note de contenu tirée du classement WD14, `@nom` pour Style / Technique / Peinture. Plus de mélange de légendes : l'encodeur de texte reste en cache (1,39 s/pas contre 1,48, mesuré).
- **Mesures de vitesse** (RTX 5080, 1024 px) : sans gradient checkpointing, la mémoire déborde (45 s/pas) ; un lot de 4 ne gagne rien par image (1,56 s) ; seul le cache de l'encodeur aide. Le gain vient surtout du nombre de passages.
- **Aperçus par époque** : `--sample_every_n_epochs` + `--sample_at_first`, deux invites (une légende « safe » du jeu, une scène nouvelle), 832×1216, CFG 4. `lora_bridge.epoch_cards()` relie `<nom>-<époque>.safetensors` et `<nom>_e<époque>_…png` ; `cmd_install` copie la version choisie dans `Lora/Anima` (suffixe `_2` plutôt qu'écraser) avec fiche et image.
- **Anciens projets** : `recipe` < 2 → message à l'ouverture ; « Appliquer le préréglage » recalcule et ajoute la note de contenu (`caption.add_safety`).
- **Tests** : `tools/test-lora-bridge.py` (Python du Studio, 14 vérifications, dossier temporaire) et `test-studio.cjs` (cartes d'époque, installation).

### Studio IA 3 : l'image d'abord (1.26.0)

Après la 1.24 (« tout est trop serré, on ne voit pas si l'image est réussie sans cliquer »), le Studio est repensé autour de l'image.
Taille de référence : l'écran de l'utilisateur, 2560 × 1440 affiché à 150 % avec KaneApp à 115 %, soit environ 1 480 × 790 pixels d'interface.
`tools/shot-studio.cjs <dossier> 1484 795` reproduit cette taille.

- **Disposition** (`.fx-v3`, `app/css/studio.css`) :
  - au centre, l'image en grand (`.fx-center` > `.fx-stage`), avec une fine barre au-dessus (lot, taille · graine · temps, Paramètres, loupe, actions) ;
  - en bas, l'invite (`dock()`) ;
  - à droite, la séance (`.fx-film`) puis le tiroir (`.fx-drawer`).
  - La barre du haut (Checkpoint / VAE / moteur) est masquée en Créer et Transformer ; la pastille Modèle la remplace.
- **Invite** :
  - repliée, elle tient sur 2 lignes (l'invite négative sur 1) ;
  - pendant la saisie, elle grandit vers le haut par-dessus l'image. La place de l'image ne bouge pas : la hauteur du `dock` est celle de l'invite repliée, mesurée par un ResizeObserver.
- **Pastilles** (`renderPills`) : Modèle (avec état du moteur), Format, Force (Transformer), Lot, LoRA · n, Kane Detailer, Hires fix, Négatif, Styles (seulement s'il y en a) et Réglages.
  - Modèle, Format, Force, Lot et LoRA ouvrent une petite fenêtre au-dessus (`popover` / `refreshPop`, `.fx.fx-pop` sur `body`) qui suit les réglages.
  - Kane Detailer et Hires fix s'activent d'un clic.
- **Tiroir** : les réglages complets en une colonne aérée (Réglages · LoRA · Modèles), fermable.
  - Il est fermé par défaut sous 1 650 px de large (`FX.drawer` vaut null au premier passage), puis l'état est retenu.
- **Loupe au survol** (`attachLoupe`) : un rond qui montre l'image à 100 % sous la souris (visage, mains, yeux), sans cliquer.
  - Cachée si l'image est déjà affichée à 90 % ou plus, pendant un glisser ou un zoom.
  - Touche L ou bouton loupe pour l'activer ou la couper (`FX.loupe`).
- **Planche** (`o.board`) : un lot de plusieurs images s'affiche en grand, côte à côte. Un ResizeObserver choisit le nombre de colonnes qui montre les images le plus grand (4 portraits : une ligne ; 4 paysages : 2 × 2). Un clic montre une image seule ; le bouton grille revient à la planche.
- **Séance** en colonne : toutes les images de la séance, l'image affichée encadrée ; ← → (ou ↑ ↓) pour passer de l'une à l'autre (`stepFilm`).
- **Actions** : Ouvrir dans Retouche, Vers Img2Img, Vers Inpaint, Détailler, (Zones repeintes, Avant / après), Enregistrer, puis **Plus** : calque, autre modèle, voir les zones, agrandir (Extras, hires fix), tout enregistrer, copier, dossier.
- **Outils de l'invite** : Historique, Chercher et Nettoyer en icônes ; « ⋯ » pour lire les paramètres, appliquer les styles et effacer.
- **Captures** : `shot-studio.cjs` active l'émulation du focus (CDP `Emulation.setFocusEmulationEnabled`), car une fenêtre hors écran n'a jamais le focus système et `:focus` ne s'y applique pas. `SHOT_IMAGES` renvoie aussi des lots entiers.
- **Tests** : `test-studio.cjs` (176 vérifications).

### Studio IA 2, sans ADetailer, bibliothèque réglable (1.24.0)

- **Studio IA 2** (`app/js/studio.js`, `app/css/studio.css`) pour Créer et Transformer :
  - au centre, le composeur d'invite (invite négative repliable, boutons LoRA et Styles, outils en icônes) avec le bouton Générer, puis le résultat en grand ;
  - à droite, un volet qui défile seul (onglets Réglages · LoRA · Modèles) : sections Format, Échantillonnage, Graine, puis Kane Detailer, Hires fix et Avancé (Never OOM, scripts) ;
  - la page tient dans la fenêtre, sans défiler.
- **Libellés en français**, avec le nom de Forge dans l'info-bulle (Échantillonneur = Sampling method, Lots = Batch count…). Les valeurs envoyées à l'API sont inchangées.
- **Barre du haut** : le checkpoint, puis VAE / Text Encoder et Diffusion in Low Bits repliés dans un petit volet.
- **Sous le résultat** :
  - la **séance**, avec les vignettes des images déjà générées ; un clic remet une image en grand (au-delà de 16, les plus anciennes sont libérées) ;
  - les actions en une barre compacte avec icônes ;
  - les paramètres de génération repliés sur une ligne.
- **ADetailer retiré** (remplacé par Kane Detailer) :
  - plus d'accordéon ni de requête `/adetailer/v1/ad_model` dans le catalogue ;
  - `C.detailPass` supprimé ;
  - au démarrage du moteur, `disableReplacedExtensions` (`main.js`) ajoute l'extension `aadetailer-neoforge` à `disabled_extensions` de son `config.json`.
  - Les fichiers de l'extension restent : l'atelier LoRA emprunte son tagger WD14 pour les légendes.
  - Démarrage du moteur mesuré : 9,8 s avec ADetailer, 9,6 s sans (pas de différence nette). Kane Detailer détecte seul (5 zones en 4,2 s).
- **Bibliothèque du projet** :
  - préférence `libraryCount` (12, 24, 48, 96, 200 ou Tous ; 48 par défaut), réglable aussi dans la bibliothèque ;
  - « Afficher N de plus » et « Tout afficher » en bas de la grille.
  - Écran Retouche : `recentCount`, le nombre de fichiers récents (jusqu'à 30).
- **Captures** : `electron tools/shot-studio.cjs <dossier> [largeur] [hauteur]` affiche le Studio avec le vrai catalogue mis en cache, sans moteur, dans une fenêtre hors écran. Variables :
  - `SHOT_STEPS` : fichier JSON `[[nom, code], …]` ;
  - `SHOT_IMAGES` : PNG renvoyés par une fausse génération ;
  - `SHOT_THEME` ;
  - `KANEVAS_TEST_APP_PATH` : une autre version de l'application.

  Les temps d'ouverture, de changement d'onglet et de volet restent sous une image (33 ms, le pas de la mesure hors écran), avant comme après.
- **Tests** : `test-studio.cjs` (166 vérifications) et `test-suite.cjs` (55).

### Comparer, refaire avec un autre modèle, galerie compressée (1.23.0)

- **Visionneuse de comparaison** `KS.preview.compare(a, b)` (`app/js/image-preview.js`) : rideau (glisser la ligne, ← →) ou côte à côte, zoom et déplacement communs ; B est affichée à la taille de A. Entrées : Avant / après d’un résultat Kane Detailer (`item.before`), « Choisir pour comparer » dans la galerie, « Refaire avec un autre modèle… ».
- **Refaire avec un autre modèle** (`remakeWithModel`, `app/js/studio.js`) : réglages relus dans l’infotexte de l’image (`applyInfoTo` sur une copie), graine de l’image, `override_settings.sd_model_checkpoint` avec `override_settings_restore_afterwards` : Forge recharge le modèle pour cette image et le réglage du moteur revient ensuite.
- **Galerie compressée** : `SD.gallery` garde le PNG (`blob`) et une vignette, plus l’image décodée ; `galleryItem` la décode au moment d’une action. Banc : `electron tools/bench-studio-memory.cjs 120` (KV_APP=<dossier app> pour une autre version). 120 images 1856 × 1024 : processus GPU 1 475 → 552 Mo. Le banc ouvre une fenêtre transparente : dans une fenêtre cachée, Chromium n’a presque pas de temps libre et `toBlob` y attend jusqu’à 5 s.
- Plus d’encodage PNG à l’affichage : source img2img, Extras, PNG Info et plein écran tracent le canevas (`KS.preview.copyCanvas`) au lieu de `toDataURL`. `KS.suite.collect` réutilise `it.bytes` (`KS.png.hasText` évite un second bloc `parameters`).
- Tests : `test-suite.cjs` remis à jour pour le panneau K (52 vérifications) ; `test-studio.cjs` 158 vérifications, le test « Cliquer autour de l’image » n’échoue plus une fois sur deux (il vérifiait avant que le clic simulé soit traité) ; `test-owned-main.cjs` et `test-animation-native.cjs` sont sautés avec un message quand les copies des moteurs ont changé, au lieu de bloquer derrière une boîte d’erreur.

### Animation : la scène va dans « a poster » (1.13.1)

- En sortie **Scène** (par défaut), `a poster` ne contient plus que la scène Wallpaper Engine : ouvert dans l'éditeur de Wallpaper Engine, il est reconnu comme une scène (avant, le fond Web resté dans `a poster` créait un projet Web `myprojects\index…`).
- `animation_web.py` écrit l'aperçu Web de l'atelier dans `work\apercu web`, et dans `a poster` seulement en sortie Web ou Vidéo, jamais par-dessus une scène. Moteur Animation 1.17.1 (`engines/animation/outils/sorties.py`, dans Kane OS).

### Optimisation générale, palette de commandes, VRAM libérée (1.13.0)

- **Copies de secours sans gel** : les PNG des calques sont encodés en parallèle dans des workers (`app/js/codec.js`, `png-worker.js`) à partir d'instantanés pris dans la même tâche ; un calque inchangé (même empreinte de pixels) n'est pas réencodé. La vignette part de la copie réduite tenue pour l'écran au lieu de recomposer tout le document. Mesures sur une image 4K à 3 calques : gel de l'interface 690 → 40 ms, copie suivante 940 → 240 ms ; sur 6000 × 4000 à 5 calques : 946 → 31 ms. Pixels relus identiques. Le magasin des copies (`recovery-store.cjs`) lit l'en-tête sans charger l'image et écrit par morceaux (liste 74 → 4 ms), format de fichier inchangé.
- **Montage au repos** (KaneClip 1.4.2) : l'aperçu et la timeline ne demandent plus d'image quand rien ne bouge ; Montage masqué 175 → 17 ms de calcul par 15 s. Inclut KaneClip 1.4.1 (rendu 4K, son au choix).
- **Jauge VRAM** : un seul `nvidia-smi -lms` tant que la jauge est lue (environ 1 ms par relevé au lieu de 30 ms pour un processus toutes les 3 s), arrêté 10 s après la dernière lecture.
- **Libérer la mémoire graphique** : clic sur la jauge VRAM → Libérer maintenant (modèle du Studio, modèles de ComfyUI via `/free`) ou décharger le Studio après 10 min / 30 min (défaut) / 1 h sans génération (aussi dans Préférences › IA et Studio). Le modèle est rechargé à la génération suivante et préchauffé à l'ouverture du Studio ; le Forge de Kane OS n'est pas touché.
- **Palette de commandes** (Ctrl+Maj+P ou la loupe de la barre de titre) : commandes des menus de l'espace actif (y compris Montage), outils, espaces, fichiers récents et réglages ; recherche sans accents, flèches + Entrée, les dernières commandes en tête.
- **Ateliers plus prompts** : Animation et ComfyUI s'ouvrent dès que leur serveur répond (sondage 0,4 s au lieu de 1,5 s) ; la mise à jour de ComfyUI au lancement n'attend plus le réseau plus de 20 s et ne relance pip que si ses fichiers de dépendances ont changé.
- Tests : `node tools/test-recovery-store.cjs`, `node tools/test-gpu-memory.cjs`.

### Un clic = plein écran, même pendant une génération (1.12.16)

- Studio IA (txt2img, img2img, Extras) : un **simple clic** sur le résultat l'ouvre en plein écran (avant : double-clic). Glisser déplace toujours l'image zoomée, la molette zoome ; un double-clic par habitude n'ouvre puis ne referme plus le plein écran.
- **Pendant une génération**, un clic sur l'aperçu en direct montre en plein écran la **dernière image terminée** (en général la précédente). La génération continue derrière ; Échap ou un clic autour referme sans l'interrompre.

### Chercher dans l'invite, historique, nettoyer (1.12.15)

- Studio IA, sous l'invite : **🔍 Chercher** (ou Ctrl+F dans l'invite, le mot sélectionné est repris) surligne les occurrences dans l'invite et l'invite négative ; Entrée / Maj+Entrée pour passer de l'une à l'autre, Aa (casse), Mot (mot entier), portée Tout / Invite / Négative, ⇄ pour remplacer une occurrence ou tout remplacer (Ctrl+Z annule). Échap ou ✕ range la barre. Même outil que l'extension « Chercher dans le prompt » de Forge.
- **🕘 Historique** : les 60 dernières invites générées (txt2img et img2img), avec recherche par mots ; un clic reprend l'invite et l'invite négative, ➕ seulement l'invite.
- **🧹 Nettoyer** : retire les tags en double, les virgules et espaces en trop, sans casser les groupes entre parenthèses, les balises <lora:…> ni les retours à la ligne (Ctrl+Z annule).

### Respiration douce de tout le personnage (1.12.12)

- Animation, panneau « Interactions souris » : nouvelle case **Respiration douce de tout le personnage**, cochée par défaut et sans zone à peindre. Le personnage se soulève et gonfle très légèrement (de 0,1 % à 0,7 % de la hauteur, réglable avec « Amplitude de la respiration »), les calques (cheveux, visage...) suivent le même mouvement et la boucle reste sans à-coup. Un curseur « Respiration douce » est aussi créé pour Wallpaper Engine. Cliquez « Appliquer au Web » pour la prendre en compte.

### 📐 = taille exacte de la source (1.12.11)

- Transformer : le bouton 📐 donne maintenant la taille exacte de l'image source (5568 x 3072 reste 5568 x 3072), comme dans Forge ; les curseurs Width/Height montent assez haut pour l'afficher. Une nouvelle image arrive toujours ajustée (mêmes proportions, côté long <= 2048, ex. 1856 x 1024). Au-dessus de 2048 px, un avertissement et un bouton « Réduire à… » ramènent à la taille ajustée.

### « Resize by » fidèle à la source (1.12.10)

- Transformer : avec 📐 actif, l'onglet « Resize by » prend lui aussi la taille ajustée à la source (5568 x 3072 donne une échelle de 0,333, soit 1856 x 1024) au lieu de 1,0 (5568 x 3072, bien trop lourd). L'échelle descend maintenant jusqu'à 0,1 et un avertissement apparaît au-dessus de 2048 px.

### Taille de l'image source plus juste (1.12.9)

- Transformer (img2img, inpaint) : la taille automatique (📐) garde maintenant exactement les proportions de la source. Avant, 5568 x 3072 devenait 2048 x 1128 (proportions faussées, donc image recadrée) ; maintenant 1856 x 1024. Le côté long reste limité à 2048, par multiples de 8, et la zone indique « source -> taille utilisée ».

### Atelier Lora en deux colonnes (1.12.8)

- L'onglet Lora du Studio occupe toute la largeur : projet, preset et légendes à gauche, réglages d'entraînement et lancement à droite (une seule colonne sur petit écran). Plus de vide à droite sur grand écran.
- Correction : le mot « null » s'affichait en bas de l'onglet quand aucun projet n'était ouvert.

### Aperçu net, Studio plus rapide, clic droit sur Lora (1.12.7)

- **Aperçu en direct net** : pendant la génération, l'aperçu est le latent décodé par le VAE, à la taille du résultat
  (avant : une petite image approximative, 8 fois plus petite, au milieu d'un grand cadre). La zone prend la forme de
  l'image et l'aperçu la remplit ; texte d'avancement en français (secondes restantes, étape). Coût : environ 6 % de temps.
  Réglage dans Réglages > Génération : Net / Rapide / Désactivé. Le moteur du Studio ne proposait pas la méthode « Full » :
  Kanevas corrige à chaque démarrage une ligne de `modules/sd_samplers_common.py` de son propre moteur (idempotent) et
  demande la méthode par génération (`override_settings`), sans changer le réglage de Forge.
- **Studio plus rapide** : le dernier catalogue (modèles, LoRA et leurs aperçus, échantillonneurs…) est gardé sur disque
  et la page est utilisable tout de suite, pendant que le moteur démarre (environ 10 s) ; le modèle est chargé en avance
  dès que le moteur répond (la première génération prenait plus de 20 s de plus). Détection du moteur toutes les 0,5 s.
- **Clic droit sur « Lora »** (bouton du Studio, ou carte d'entraînement) : Arrêter l'entraînement, Arrêter et relancer
  (mêmes réglages, repart de zéro), Actualiser, Ouvrir l'atelier. Fonctionne aussi si l'atelier n'a pas été ouvert.
- `tools/test-studio.cjs` remis à jour (l'espace s'appelle Retouche) : 110 vérifications.

### Actualiser dans l’atelier LoRA, ComfyUI à jour (1.12.6)

Le bouton Actualiser de Studio IA > LoRA libère un entraînement bloqué et relit les projets. ComfyUI se met à jour (git + paquets) à chaque démarrage depuis Kanevas.

### Illustrations interactives dans Animation (1.10.0)

- Le panneau **Interactions souris** propose le regard qui suit le curseur (gauche/droite), une tête réactive
  et un clignement avec petit mouvement au clic. L'intensité se règle de 0 à 100 %.
- **Appliquer au Web** met à jour les calques déjà calculés sans génération IA. **Tester dans l’aperçu**
  ouvre le résultat et déclenche une réaction si elle est activée. Les animations manquantes sont signalées.
- Le balancement de tête est plus visible, avec une amplitude plafonnée et des calques du visage synchronisés.
- Le moteur Web fait maintenant partie de Kane App. Les options suivent le dossier **a poster** et les réglages
  Wallpaper Engine ; sans entrée souris, la boucle vidéo reste périodique.
- Les pages et descriptions précédentes sont sauvegardées avant remplacement. Les interactions restent facultatives.
  Elles utilisent les zones préparées ; elles ne créent pas de nouvelles poses de personnage.

### Sélection Magique dans Animation (1.9.4)

- Le moteur SAM de **Magique** peut de nouveau se charger sous Windows. L'adaptateur conserve
  une vraie classe `subprocess.Popen`, nécessaire aux imports de Torch et asyncio.
- Sélection automatique, retrait, annulation et libération du GPU sont vérifiés avec le vrai modèle SAM.

### Import Animation et sorties communes (1.9.3)

- **Ouvrir une image…** est visible dans la barre Animation. Le choix de fichier et le dépôt dans l'atelier
  utilisent aussi l'import Kane App, sans boîte `prompt()` incompatible avec Electron ni document parasite dans Edition.
- Les sorties vont dans **C:\KaneOS\output**, puis **studio**, **animation**, **comfyui**, **montage**, **lora**
  (et **edition** par défaut pour les enregistrements de l'éditeur). Les exports manuels peuvent garder une destination choisie.
- Animation y range chaque projet avec sa source, ses zones et ses exports. Les anciens projets sont copiés
  sans écraser les dossiers existants ni supprimer les originaux.
- Les LoRA entraînés sont stockés dans output/lora et restent accessibles au catalogue Studio par une jonction.
  La configuration des sorties Studio est sauvegardée avant modification ; les autres paramètres sont conservés.

### Mémoire graphique dans tous les espaces (1.9.2)

- Le double-clic dans les aperçus du Studio ouvre le plein écran avec la souris. La capture du pointeur
  commence seulement lors d'un déplacement ; un clic sur l'image agrandie la garde ouverte.
- La jauge **VRAM** reste dans la barre inférieure commune : Projet, Edition, Studio IA, Animation,
  Animation Vidéo et Montage. Elle se met à jour toutes les trois secondes, même lorsque Studio est arrêté.
- La lecture vient directement du pilote NVIDIA et couvre l'utilisation de toute la carte graphique.
  Le survol détaille les cartes présentes ; une utilisation supérieure à 90 % apparaît en orange.
- Si le pilote ne répond pas, la jauge indique **Indisponible** et réessaie automatiquement ; elle ne conserve
  pas un ancien chiffre. La lecture reprend dès que la fenêtre redevient visible.

### Migration définitive et aperçu Studio (1.9.1)
- Double-clic sur une image du Studio pour l’afficher en plein écran ; Échap ou clic autour pour fermer.
- Retrait contrôlé des anciennes installations après validation et audit final ; Kane OS regroupe ces activités dans Kane App.
- Après retrait, les moteurs restent gérés par Kane App et le retour aux anciens chemins est désactivé.

### Moteurs gérés par Kanevas (1.9.0)
- L’import d’images dans **Lora** reste dans l’atelier d’entraînement. Un dépôt dans le Studio
  ne crée plus implicitement de documents dans **Edition**.
- **Préférences > Applications intégrées > Migration vers Kanevas** copie les moteurs du Studio,
  ComfyUI, Animation et sd-scripts dans **KanevasData**, avec leurs environnements Python,
  extensions, nœuds et données. Les chemins internes et lanceurs Python sont adaptés dans les copies.
- Les fichiers sont contrôlés par **SHA256**, les environnements Python testés et les points d’entrée
  revérifiés avant activation. **Montage** reçoit aussi son propre FFmpeg vérifié et sa licence.
- Après bascule, le Studio, les services et l’atelier Lora utilisent les copies. Une ancienne instance
  sur le même port est signalée au lieu d’être reprise à leur place.
- Les modèles communs, caches et le Python Windows de base restent partagés. Les sources restent
  conservées : **aucune suppression automatique**, même après activation. Le retour à la configuration
  précédente garde les copies et leurs nouvelles données.
- Les usages sur les projets personnels — entraînement complet, vidéo générative et rendu d’animation —
  restent à valider avant tout retrait des anciennes applications. Détails et contrôles : [MIGRATION.md](MIGRATION.md).

### Aperçus et mémoire d’Animation (1.8.2)
- Au-dessus de chaque aperçu du Studio : **Image entière** recentre et ajuste l’image au cadre,
  **100 %** affiche sa taille réelle. Le pourcentage et **⛶** ouvrent un aperçu plein écran,
  fermé par un clic autour de l’image, le bouton Fermer ou Échap. Le zoom du cadre reste conservé.
- Le remplissage conserve le prompt initial et les paramètres du document, même après un changement de variante
  ou un renvoi de ses paramètres au Studio. Les réglages de retouche restent attachés au résultat et à son calque.
- Correction du voile « Déposer pour importer » : remise à zéro après les dépôts capturés par un panneau,
  fin de glissement, sortie de fenêtre et interruption du geste. Aucun texte n’est ajouté aux pixels de l’image.
- **Animation automatique** remplace « Proposer les mouvements ». Les gestes utilisent déjà DWPose
  (épaule, coude, poignet), avec estimation du squelette de la zone si les articulations ne sont pas disponibles.
- Animation réserve le moteur et décharge le checkpoint du Studio avant son analyse et après sa tâche.
  Elle ne lance la diffusion que si des fonds doivent être reconstruits. Les requêtes de génération concurrentes
  sont refusées ; une panne réseau ne déclenche pas la décharge d’une tâche dont l’état est inconnu.
- Lorsqu’Animation est démarrée par Kane App, un adaptateur libère SAM après segmentation et LaMa/ViTMatte
  avant de solliciter la diffusion. Le checkpoint actif du Studio reste utilisé, puis est déchargé après le rebouchage.
  Les scripts installés dans KaneOS sont conservés. Si le moteur Animation tournait déjà séparément,
  **clic droit Animation > Arrêter**, puis le rouvrir dans Kane App pour appliquer aussi cet adaptateur.
- Tests Electron des aperçus, prompts, dépôts et échanges avec Animation ; tests isolés des réservations GPU et
  du nettoyage des modèles. Démarrage HTTP et lecture des presets vérifiés avec le vrai backend Python installé.
  Modèles simulés pour les tests GPU : pas de mesure de VRAM récupérée ni d’évaluation des gestes sur image réelle.

### Remplissage génératif simplifié (1.8.1)
- Dans Edition, sélectionner une zone puis **Remplissage génératif** : le même panneau **Dessin IA**
  s’ouvre depuis la barre contextuelle, les menus et le raccourci. Décrire uniquement le changement souhaité.
- Modèle, LoRA et poids actifs, styles, invite négative, étapes, CFG et échantillonneur de **Studio IA > Créer**
  sont partagés. La description de la scène et ses mots déclencheurs ne sont pas recopiés.
- Force **50 %** par défaut, avec **40 %** (douce) ou **60 %** (marquée). L’ancienne valeur 85 % est migrée.
  Un résultat par défaut ; les variantes et le lien vers les réglages du Studio sont repliés.
- La sélection est envoyée en inpaint et le résultat reste sur un nouveau calque masqué, annulable.
  Les scripts de génération, Hires et la retouche automatique des visages sont écartés de ce remplissage local.
- La demande en français est traduite suivant l’option du Studio. Si la traduction est activée mais indisponible,
  la génération attend une traduction fonctionnelle ou une demande en anglais au lieu d’envoyer une invite incomprise.
- **Supprimer** conserve le remplissage local sans description. Les LoRA de personnage et styles actifs peuvent
  encore influencer le sujet : leur liste est visible dans les réglages repliés.
- Validation : parcours Electron, migration des préférences, requêtes à 40/50/60 %, traduction, LoRA, masques,
  annulation et raccourcis. Réponses de génération simulées : pas de comparaison de qualité sur GPU réel.

### Kane App, Studio et apparence (1.8.0)
- L’interface porte le nom **Kane App** ; le projet par défaut « Mon atelier » est renommé. L’installateur,
  les mises à jour et les documents conservent leur compatibilité Kanevas.
- Navigation : **Projet · Edition · Studio IA · Animation · Animation Vidéo · Montage**.
  Animation Vidéo conserve ComfyUI et ses workflows ; Montage conserve KaneClip.
- Style commun plus plat : surfaces unies, angles discrets, suppression des ombres décoratives.
  **Préférences > Couleurs des espaces** règle un accent distinct pour chaque activité et le conserve au redémarrage.
  Les interfaces Wallpaper, ComfyUI et KaneClip reçoivent le thème et leur propre accent.
- Studio : molette pour zoomer dans les sources et résultats, boutons − / +, **Ajuster** et **100 %**.
  Glisser déplace une image ; dans les masques et croquis, bouton central ou Espace + glisser pour déplacer
  sans peindre. Le zoom ne change pas la résolution ni les pixels envoyés au moteur.
- **Découper** utilise le résultat actif du Studio, sa source si nécessaire, ou propose un import.
  Aucun document ouvert dans Edition n’est nécessaire. **Lora** remplace le libellé « Entraîner un LoRA ».
- Clic droit sur un espace > **Arrêter** : interruption du Studio et arrêt du moteur ; sauvegarde puis arrêt
  d’Animation ; sauvegarde et annulation des rendus/proxys/agrandissements de Montage avant de décharger sa page.
  Pour un moteur lancé depuis KaneOS, le processus est identifié avant son arrêt explicite.
  L’arrêt d’Edition passe par la fermeture habituelle des documents et leurs dialogues de sauvegarde.
- **Préférences > Configurer le moteur local** permet de désigner un runtime Python et un dossier de modèles
  séparés, et de désactiver la réutilisation du Forge de KaneOS. Le moteur reste actuellement compatible Forge
  (`launch.py`, `venv/Scripts/python.exe`) : aucun téléchargement, déplacement ou désinstallation automatique.
  Préparer un runtime distinct est nécessaire avant de retirer les fichiers de Forge.
- Tests : `tools/test-studio.cjs` (zoom, peinture, découpe), `tools/test-suite.cjs` (navigation, apparence des cadres,
  arrêt/reprise, persistance) et `node tools/test-runtime.cjs` (configuration et identification des processus).

### Projet créatif commun (1.7.0)
- Un nouvel accueil **Projet** relie **Édition**, **Studio IA**, **Animation**, **Vidéo** et **Workflows**.
  Les ateliers conservent leur page lorsqu'on change d'espace ; leur thème suit celui de Kanevas.
- Chaque projet possède une **bibliothèque persistante**. Importer copie les images, vidéos et sons dans son
  dossier local. **Capturer > Document avec ses calques** archive un PNG et un document KSP éditable ;
  **Sélection seule** crée un média recadré avec transparence. Une nouvelle capture modifiée garde la version précédente.
- Les générations du Studio rejoignent automatiquement la bibliothèque avec leurs paramètres. Les résultats
  de ComfyUI et les exports d'Animation s'ajoutent depuis **Récupérer les résultats**. Les boucles du projet sont
  également récupérées à la fin des tâches d'Animation observées dans la session.
- Sélectionner un média propose de reprendre ses calques, de l'ajouter au document actif, de le transformer dans
  le Studio, de l'animer, de l'ajouter au montage ou de l'utiliser dans un workflow.
- **Animation** conserve une liaison avec son projet Wallpaper Animator. Reprendre retrouve les zones ;
  mettre à jour la source conserve leur peinture si les dimensions correspondent. L'ancienne scène est sauvegardée
  dans `work/sources`, les aperçus calculés sont invalidés. Il faut vérifier les zones et régénérer l'animation.
- **Vidéo** conserve un montage KaneClip par projet (`montage.kcp`), enregistré automatiquement après les changements.
  **Mettre à jour un média du montage** conserve les événements, coupes et effets. Une vidéo plus courte demande
  de vérifier les fins de clips. Les fichiers KCP autonomes restent utilisables depuis les menus de KaneClip.
- **Workflows** garde l'éditeur ComfyUI complet. Charger un workflow JSON au format interface, puis choisir
  **Utiliser dans un workflow** place l'image dans un nœud LoadImage ; plusieurs entrées donnent lieu à un choix.
  Les modèles et nœuds nécessaires au workflow doivent être présents dans ComfyUI.
- **Activité** suit les transferts, générations et tâches signalées par les ateliers. Les files d'exécution et
  la mémoire GPU restent gérées par leurs moteurs ; cette version n'introduit pas de planificateur GPU global.
- Les dossiers locaux sont dans `projects` du profil Kanevas (**Dossier du projet**). Les animations restent dans
  le dossier de Wallpaper Animator ; le projet en conserve la liaison. Déplacer un projet entier peut nécessiter
  de relier les médias du montage et l'animation. Les documents ouverts ne sont pas fermés en changeant de projet.
- Vérification : `node_modules/.bin/electron tools/test-suite.cjs` (vrais ponts et timeline, serveurs et métadonnées
  ffprobe simulés, profil temporaire), plus `tools/test-studio.cjs` pour les parcours Forge existants.

- **Rectangle** : un seul outil, avec ses angles réglables (un rayon pour les quatre, ou un par angle avec le
  bouton de liaison). Ils restent modifiables après coup dans Propriétés > Angles, tant que ses points n'ont
  été que déplacés.
- **Lasso magnétique** (L) : cliquer, puis suivre le bord ; les points s'accrochent au contour le plus net
  (Largeur, Contraste, Fréquence). Clic : point d'ancrage, double-clic ou Entrée : fermer, Retour arrière : annuler le point.
- **Image dans un texte ou une forme** : Calque > Insérer une image dans le calque… (ou menu contextuel du
  calque), ou Édition > Coller dans le calque (Ctrl+Alt+Maj+V). L'image couvre le calque actif et lui est
  écrêtée. Alt+clic sur un calque, ou le bouton d'écrêtage sous la liste, crée ou libère un masque d'écrêtage.
- **Pièce** (J, avec les correcteurs) : entourer la zone, puis la faire glisser. Source : la zone est réparée avec
  la texture de l'endroit d'arrivée ; Destination : elle y est recopiée. La texture se fond dans la lumière locale.
- **Calques de remplissage** dynamiques (Calque > Nouveau calque de remplissage) : couleur unie, dégradé (linéaire,
  radial, angle, réfléchi, losange), motif (damier, rayures, pois, grille, diagonales, grain). Réglables à tout
  moment dans Propriétés ; « Pixelliser » en fait un calque de pixels.
- **Correction sélective** (Image > Réglages, ou calque de réglage) : cyan, magenta, jaune, noir par gamme de
  couleurs (rouges… noirs), méthode relative ou absolue.
- **Atténuer** (Édition, Ctrl+Maj+F) juste après un filtre ou un réglage : opacité et mode de fusion du résultat.
  **Ctrl+F** répète le dernier filtre avec ses réglages, **Ctrl+Alt+F** le rouvre avec sa boîte.
- **Instantanés** (bouton appareil photo du panneau Historique) : figer un état, le rétablir plus tard (annulable).
- **Sélection > Agrandir / Sélection similaire** : ajoute les couleurs proches de la sélection (tolérance de la
  baguette magique), contiguës ou dans toute l'image.

## IA générative et nouveautés façon Photoshop 2026 (1.0.6)
- **Outil Suppression** (J, avec les correcteurs) : peindre sur ce qui doit disparaître ; au relâchement, l'IA locale
  LaMa (licence Apache 2.0, 208 Mo, téléchargée une fois après accord) reconstitue le fond. « Échantillonner tous les
  calques » permet de travailler sur un calque vide. Sans modèle : correcteur localisé.
- **Supprimer avec l'IA** (Édition, Maj+Suppr) : la sélection est remplacée par les alentours, dans un nouveau calque
  « Suppression » avec masque (rien n'est détruit).
- **Remplissage génératif** (Édition, Ctrl+Maj+Alt+G, ou la barre contextuelle) : une invite décrit ce qu'il faut
  générer dans la sélection ; la génération passe par **Forge** (Stable Diffusion local lancé par Kane OS, avec son
  modèle actif). 1 à 4 variantes, à parcourir avec ‹ › dans la barre contextuelle, « Générer encore » en ajoute.
  Le résultat est un calque avec masque de fusion. Invite vide : remplissage par LaMa, sans Forge.
- **Développement génératif** (Image) : agrandit l'image à un format (16:9, 1:1, 4:5…) ou d'une marge, la zone neuve
  est générée (Forge avec invite, sinon LaMa) dans un calque placé au-dessus de l'arrière-plan. Une seule étape d'historique.
- **Super résolution IA** (Image) : ×2, ×3 ou ×4 avec les modèles ESRGAN de Forge (4x-UltraSharp…), dans un nouveau
  document ; la transparence est conservée.
- **Harmoniser** (Calque, menu du calque, barre contextuelle) : accorde la lumière, le contraste et la dominante de
  couleur du calque à ce qu'il y a dessous (mesures en Lab sur le calque et son voisinage), avec aperçu.
- **Pinceau de réglage** (B, avec le pinceau) : on peint un réglage (éclaircir, assombrir, contraste, saturer,
  désaturer, réchauffer, refroidir, noir et blanc) ; il vit dans un calque de réglage dont on peint le masque,
  modifiable ensuite dans Propriétés. Alt efface.
- **Barre des tâches contextuelle** (Affichage) : sous l'image, les actions utiles selon la situation (sélection,
  calque généré et ses variantes, calque de pixels) et une invite de génération directe.
- **Invites en français** (1.0.7) : les modèles d'image ne comprennent que l'anglais ; en français, anima dessinait
  une fille au hasard qui remplissait la zone. L'invite est maintenant traduite sur le PC par Opus-MT fr→en
  (Helsinki-NLP, licence CC-BY 4.0, 113 Mo téléchargés une fois, `translate.cjs`) ; la boîte affiche « Envoyé à
  Forge : … ». Les verbes d'ordre (« ajoute », « dessine »…) sont retirés.
- **Réglages selon le modèle actif de Forge** : pour anima, préfixe `newest, year 2026, safe`, échantillonneur ER SDE,
  planificateur simple. Si l'invite ne demande pas de personnage, « girl, woman, man, person… » passent en négatif.
  Force par défaut 85 % (l'objet se fond mieux dans l'image), 30 étapes, CFG 4,5, bords adoucis.
- **Panneau IA, une « mini Forge »** (1.1.0, onglet IA à côté de Propriétés ; Édition > Générer une image…) :
  invite (traduite si elle est en français, aperçu de ce qui part), modèle, VAE et encodeur de texte de Forge,
  **LoRA** en grille avec leurs aperçus (poids conseillé et mot déclencheur lus dans leur fiche `.json`, recherche,
  LoRA d'une autre base grisés), préréglages d'échantillonnage de Forge (`style_presets.json`) et préréglages
  Kanevas enregistrés (modèle + LoRA + réglages), échantillonneur, planificateur, étapes, CFG, variantes, force,
  graine (au hasard, ou reprise de la dernière image). Boutons : Générer dans la sélection, **Nouvelle image**
  (txt2img dans un calque, à la taille de la sélection ou de l'image), Développer. Un autre modèle que celui chargé
  dans Forge est utilisé le temps de la requête (Forge revient ensuite au sien, sauf « Garder ce modèle chargé »).
- `KANEVAS_PROFILE=<dossier>` : lance Kanevas avec un dossier de données séparé (essais automatisés pendant que
  l'application habituelle est ouverte).
- Forge est appelé par le processus principal, uniquement sur une adresse locale (127.0.0.1 par défaut, réglable dans
  Paramètres avancés). Rien ne part en ligne.

## ComfyUI, Wallpaper et Vidéo dans Kanevas (1.6.0)
- Trois nouveaux espaces à côté d'Édition et Studio IA, dans la barre du haut : **ComfyUI**, **Wallpaper** et **Vidéo**.
  Chaque espace garde sa page quand on passe de l'un à l'autre.
- **ComfyUI** : son éditeur de graphes, démarré par Kanevas sur un clic (ou repris s'il tourne déjà dans Kane OS),
  arrêté en quittant. « Envoyer l'image du document » la dépose dans son dossier input (nœud Load Image, nom copié) ;
  « Sorties » liste les images et vidéos d'output\comfyui : ouvrir dans l'Édition, ajouter en calque, envoyer au
  Studio IA (Img2Img, Extras) ou à la Vidéo.
- **Wallpaper** (Wallpaper Engine Animator) : démarré en entrant dans l'espace. « Animer l'image du document » crée
  le projet et l'ouvre. Le fond sous les découpes est redessiné par **le moteur Forge de Kanevas** (WEA_FORGE_URL ;
  un relais local sur le port 8601 répond comme le lanceur Kane OS pour le démarrer au besoin). « Vidéos exportées »
  envoie les MP4 à la Vidéo.
- **Vidéo** : KaneClip intégré dans kaneclip/ (c'est désormais sa seule version : la version standalone et son
  dépôt sont retirés, KaneClip évolue ici). Ses fonctions du processus principal passent par des canaux « kc:… » (kaneclip-host.cjs),
  ffmpeg est celui des moteurs gérés par Kane App, sinon winget / PATH. « Ajouter l'image du document » la pose sur la timeline ;
  un montage non enregistré est proposé à l'enregistrement en quittant Kanevas.
- Menu IA de l'Édition : Envoyer à ComfyUI, Animer dans Wallpaper, Ajouter à la Vidéo.
- 1.6.1 : le relais local (port 8601) démarre aussi ComfyUI à la demande du « Geste IA » de Wallpaper.

## Img2Img dans le Studio IA
- Le Studio reprend les thèmes et la couleur d'accent de l'Édition. Les actions sous les résultats sont
  regroupées : Édition, Transformer, Agrandir et Fichiers.
- **Img2Img** retrouve son onglet dans le Studio, avec une image source et un aperçu des résultats côte à côte.
  Importer une image par clic ou glisser-déposer, ou utiliser **Envoyer vers Img2Img / Inpaint** depuis l'Édition.
- Depuis txt2img, Extras, PNG Info ou la Galerie, **Envoyer vers Img2Img / Inpaint** transfère l'image et ses paramètres.
  La source reste choisie lorsque l'on change de document dans l'Édition ou d'onglet dans le Studio.
- **Inpaint, Sketch et Inpaint sketch restent dans le Studio** : peindre sur l'image source avec le pinceau
  ou la gomme, régler la taille et la couleur, annuler/rétablir les traits, effacer ou inverser le masque.
  L'import d'un masque et le traitement par lots sont également accessibles dans cet onglet.
- L'Édition ne contient plus de panneau Img2Img. Son bouton **Envoyer au Studio** copie l'image et ses paramètres ;
  peindre ou générer dans le Studio ne modifie pas le document de l'Édition.
- Générer conserve les résultats dans le Studio. **Ouvrir le résultat dans l'Édition** crée un document ;
  **Ajouter en calque** revient au document actif ; **Envoyer vers Img2Img** reprend le résultat comme source
  sans créer de documents supplémentaires.
- **Graine aléatoire à chaque génération** : les graines des images restent consultables dans leurs informations,
  mais un import ou un transfert ne les fixe pas pour la génération suivante.
- **Ctrl+Entrée** démarre ou interrompt la génération dans tout le Studio, y compris depuis les champs de texte.
  Pendant la préparation, le même raccourci annule le lancement.
- Vérification des parcours sans moteur réel : `node_modules/.bin/electron tools/test-studio.cjs`
  (profil temporaire et réponses Forge simulées).

## Dessin IA dans l'Édition (1.5.0)
- Onglet **Dessin IA** entre Histogramme et Infos, ou **IA > Ajouter un dessin IA…**. Ce panneau est optionnel :
  il ne s'ouvre pas automatiquement et aucune génération ne démarre à son ouverture.
- L'invite, l'invite négative, les balises et poids des LoRA, les styles et les réglages de txt2img sont partagés
  avec le Studio, ainsi que le moteur Forge et son modèle actif. Les LoRA se choisissent aussi dans le panneau.
- **Dans la sélection** : dessiner avec le lasso ou le rectangle une zone à compléter, décrire le dessin,
  puis **Ajouter le dessin**. Le résultat est un nouveau calque avec un masque modifiable.
- **Sur un nouveau calque** : génère à la taille du document sans sélection. Force et variantes sont réglables ;
  l'historique permet d'annuler l'ajout. **Ctrl+Entrée** génère ou interrompt depuis ce panneau.

## Édition ⇄ Studio IA, LoRA, Train LoRA (1.4.0 — ancien parcours)
- **img2img passe dans l'Édition** : le panneau IA de l'Édition est remplacé par le panneau **img2img** de Forge (mêmes
  réglages que dans le Studio : Resize mode, Inpaint, Soft inpainting, Denoising, ADetailer, MultiDiffusion, scripts…),
  avec ses modes img2img / Sketch / Inpaint / Inpaint sketch / Inpaint upload / Batch, juste à côté de la toile.
  L'onglet img2img du Studio est retiré.
- **Envoi dans les deux sens** : du Studio, 🖼️ / 🎨 ouvrent l'image dans l'Édition (panneau img2img ou Inpaint) ;
  de l'Édition, « Envoyer au Studio IA » (panneau img2img et menu IA) renvoie le document tel qu'il est vers la sortie
  de txt2img (✨ hires, 💾, Send to…), Extras ou PNG Info, ou ses paramètres vers txt2img.
- **Refiner** retiré.
- **LoRA personnalisables comme dans Forge** : bouton 🛠️ sur chaque carte (Description, Stable Diffusion version,
  Activation text, Preferred weight, Negative prompt, Notes, aperçu à partir d'une image générée ou du document),
  écrit dans le même `<lora>.json` que Forge ; le negative text s'ajoute à l'invite négative ; étiquettes des LoRA
  actifs sous l'invite avec leur poids ; Ctrl+↑ / Ctrl+↓ dans l'invite change le poids comme dans Forge.
- **Train LoRA refait** : l'Atelier LoRA devient un onglet du Studio qui reprend l'onglet de Forge carte par carte
  (Project, Preset, Captions, Training settings, Free VRAM, Start / Stop / Refresh progress, extinction du PC),
  import d'un dossier source, légendes modifiables, progression en direct, LoRA produits à essayer dans txt2img ;
  les générations attendent la fin d'un entraînement (comme Forge).
- Menu IA de l'Édition simplifié : les commandes en double avec le Studio sont retirées (nouvelle image, image → image,
  agrandir et détailler, IA en direct) ; restent les outils de retouche (remplissage génératif, suppression, développement,
  super résolution, harmoniser).

## Studio IA = la page de Forge (1.3.0)
- Le Studio IA reprend l'interface de Forge (thème Modern UI de Kane OS) : rail à gauche (txt2img, img2img, Extras,
  PNG Info, Train LoRA, ImgCut, Settings), barre Checkpoint / VAE / Text Encoder / Diffusion in Low Bits / VRAM,
  Prompt et Negative Prompt avec compteur, Generate orange (Interrupt / Skip), Styles, onglets Generation /
  Checkpoints / Lora (cartes, puces de dossiers, tri), mêmes réglages, mêmes noms et même ordre que Forge.
- Réglages repris tels quels : Sampling Method / Schedule Type / Steps, Preset (le même fichier que Forge), Hires. fix
  complet, Refiner, Width / Height / Batch, FORMAT ANIMA / 1024, Shift, CFG Scale, Seed + Extra, ADetailer (4 onglets,
  Detection, Mask Preprocessing, Inpainting), Never OOM, MultiDiffusion, Soft inpainting, scripts (X/Y/Z plot, Prompt
  matrix, Prompts from file, Loopback, SD upscale). Valeurs par défaut lues dans Forge.
- img2img : sous-onglets img2img / Sketch / Inpaint / Inpaint sketch / Inpaint upload / Batch ; l'image d'entrée est le
  document Kanevas (toile et outils dans l'onglet), le masque se peint sur « Zone IA », le croquis sur « Croquis IA ».
  Resize mode, Mask blur, Mask mode, Masked content, Inpaint area et padding envoyés à Forge comme dans son interface.
- Sorties comme Forge : images enregistrées par Forge dans ses dossiers output, boutons 📂 💾 🗃️ 🖼️ 🎨 📐 ✨, infotexte,
  Send to entre onglets ; Extras (Upscaler 1 / 2) et PNG Info (Send to txt2img / img2img / inpaint / extras).

## Studio IA autonome (1.2.0)
- **Moteur intégré** : Kanevas démarre lui-même le moteur de Forge quand on entre dans le Studio IA ou qu'on génère
  (`launch.py` du dossier de Forge, profil de Kane OS, `--nowebui --port 7862 --server-name 127.0.0.1`, prêt en
  ~10 s). Si le Forge de Kane OS tourne déjà (7860), il est réutilisé. Voyant « IA » dans la barre de titre :
  démarrer, arrêter, journal, profil (RTX 5080 / portable 8 Go), démarrage automatique. Le moteur est arrêté en
  quittant ; un moteur resté actif après un plantage est repris et peut être arrêté.
- **Studio IA** (bascule Édition ⇄ Studio IA dans la barre de titre, F6) : tous les réglages de Forge dans une
  colonne à gauche, barre de modes au-dessus de l'image, galerie des résultats à droite.
  - **Créer** : txt2img, dans un nouveau document (ou un calque).
  - **Transformer** : img2img de toute l'image (ou de la sélection), force réglable.
  - **Retoucher la zone peinte** : « Peindre la zone » crée le calque rouge **Zone IA** ; on peint ce qui doit
    changer (gomme, effacer, inverser, sélection → zone), on décrit le résultat, Générer : seule la zone change.
  - **Croquis** : « Peindre le croquis » crée le calque **Croquis IA** ; on peint grossièrement formes et couleurs,
    Forge en fait une vraie image à cet endroit.
  - **Agrandir** : ESRGAN puis MultiDiffusion.
- Réglages Forge ajoutés : **hires fix** (agrandissement, agrandisseur, étapes, force, CFG), **refiner**, **lots**
  (nombre de lots × images par lot), **graine de variation**, retouche (**contenu masqué**, zone seule + marge ou
  image entière, flou du masque, **soft inpainting**), **Never OOM**, interrompre / passer.
- **Galerie** : chaque image générée (vignette, ouvrir, ajouter en calque, transformer, réutiliser les réglages,
  copier, infos) ; **enregistrement automatique** avec les paramètres dans `C:\KaneOS\output\kanevas\<type>\<date>`
  (jamais dans Images : souvent un dossier OneDrive, où la création récursive de dossiers de Node boucle sans fin).

## Studio Forge (1.1.0)
Kanevas pilote le Forge local comme un « mini Forge », avec en plus tout l'éditeur autour (menu **IA**, panneau **IA**).
- **Nouvelle image** (Ctrl+Alt+N) : txt2img dans un **nouveau document** (taille, formats, « comme l'image »), l'image
  en cours n'est jamais touchée. Variantes ‹ ›, « Générer encore ». Aussi : image dans un calque ou dans la sélection.
- **Image → image** : l'image (ou la sélection) retravaillée selon l'invite et la force, dans un calque au-dessus.
- **ADetailer** : détecteurs de Forge (visages, mains, yeux Eyeful…), jusqu'à 3, invite / force / confiance ; à chaque
  génération, ou **Retoucher (ADetailer)** seul sur l'image en cours (comme « Skip img2img »), dans un calque.
- **Agrandir et détailler** : agrandissement ESRGAN (×1,5 / ×2 / ×3) puis image vers image par tuiles
  (**MultiDiffusion**, Mixture of Diffusers), dans un nouveau document (calque agrandi + calque détaillé).
- **Shift** (anima) envoyé comme dans Forge (3), préréglages de Forge avec leur Shift et leur taille.
- **Aperçu en direct** de l'image qui se forme pendant chaque génération (option de Forge).
- **PNG Info** (Fichier ou IA) : les paramètres d'un PNG de Forge sont lus à l'ouverture et réécrits à l'export PNG ;
  « Envoyer au panneau IA » reprend invite, LoRA, réglages, graine, taille, modèle.
- **IA en direct** : pendant que vous dessinez, Forge repeint l'image dans une fenêtre flottante (image vers image,
  peu d'étapes, graine fixe ; ~1 s par rendu en 640 px) ; « Poser en calque » garde un rendu.
- **Atelier LoRA** (IA > Atelier LoRA, ou bouton du panneau) : projets de l'entraîneur de Forge (mêmes dossiers),
  images depuis des fichiers, un dossier, l'image en cours, la sélection ou les documents ouverts ; légendes WD14
  automatiques, modifiables, ajout / retrait d'un tag partout ; type (style, personnage, vêtement…) et préréglage de
  l'entraîneur ; modèle de base (anima Base conseillé), époques, répétitions, dim, taux, résolution, multi-résolutions,
  options avancées ; lancement (le modèle de Forge est déchargé d'abord), progression, échantillons, arrêt ;
  sauvegardes à **essayer** directement dans le panneau IA. La recette et les préréglages sont ceux de
  `forge_lora_trainer`, appelé par `lora_bridge.py` avec le Python du venv de Forge.
- **Découper pour les réseaux** (Image, remplace ImgCut) : carrousel (Instagram 4:5, Story 9:16, X 3:4, 2:3, carré,
  personnalisé, auto) ou **grille du profil** 3 colonnes numérotée dans l'ordre de publication ; aperçu en direct,
  cadrage en faisant glisser l'aperçu, fond blanc, noir ou flou de l'image ; export numéroté dans un dossier.

## Performances (grandes images)
- Seule la zone modifiée est recomposée (élargie de la portée des styles de calque), par tuiles de 512 px dans de
  petits canevas de travail. Un réglage dépendant du voisinage (Camera Raw : clarté, voile…) recompose tout.
- Affichage progressif façon Photoshop : quand une recomposition serait longue (réglages sur une grande image,
  opacité ou visibilité d'un calque…), l'écran montre aussitôt un aperçu basse résolution (copies réduites des
  calques, en cache) ; la pleine résolution est calculée par tranches pendant les pauses. Export, pipette et
  échantillonnage utilisent toujours la composition exacte.
- Pinceau : l'aperçu et le report sur le calque ne touchent que les nouvelles touches ; l'historique ne garde
  que le rectangle modifié, copié au relâchement ; les tampons du pinceau sont réutilisés d'un trait à l'autre.
- Zoom arrière : l'écran, le navigateur et l'histogramme lisent une pyramide de copies réduites (1/2, 1/4…)
  de la composition, mise à jour par zones ; vignettes des calques réduites par moitiés successives.
- Filtres lourds réécrits (1.0.6), résultats identiques au pixel près : Flou de surface et Réduction du bruit
  répartis sur les cœurs du processeur (workers, `js/kernels.js` + `js/filter-worker.js`), Médiane à médiane
  suivie, Minimum / Maximum en van Herk (coût constant quel que soit le rayon). Mesuré : Flou de surface ×6 à ×7,
  Médiane ×7 à ×13, Maximum rayon 50 : 5,4 s → 0,14 s (1,5 Mpx). La bibliothèque PSD n'est chargée qu'au premier PSD.
  Les tâches longues continuent quand la fenêtre est masquée.
- Banc d'essai : `tools/bench.js` (à charger dans la page de `app/` servie avec le dossier racine), qui vérifie
  aussi que la composition partielle égale une composition complète. Sur 6000×4000 px à 5 calques (réglage
  Teinte/Saturation, ombre portée), mesuré dans Electron jusqu'à la fin du travail du GPU : pinceau 787 → 19 ms
  par mouvement, curseur d'un réglage > 1 s → 21 ms, affichage en zoom arrière 63 → 16 ms.
- Retouche (tampon, correcteurs, pièce, flou, netteté, doigt, densité, éponge) : recomposition limitée aux
  touches, le calque sert de source sans copie, l'historique ne sauvegarde que la zone touchée (par tuiles de
  256 px pour les outils qui modifient le calque au fil du trait). Les grands canevas sont lus au travers d'une
  copie de la zone, pour rester sur la carte graphique. `tools/bench-retouch.js` : en usage réel sur 6000×4000,
  tampon 20 → 99 images/s, correcteur localisé 21 → 107, goutte d'eau 11 → 33.

## IA locale (détourage)
« Sélectionner le sujet », « Supprimer l'arrière-plan » et l'outil « Sélection d'objet » utilisent BiRefNet
(licence MIT) via onnxruntime-node (DirectML sinon processeur). Le modèle est téléchargé au premier usage,
après confirmation, dans `%APPDATA%\Kanevas\models` (ou le dossier de données historique KaneShop si déjà présent) (léger 224 Mo ou complet 973 Mo ; Édition > Modèles d'IA).

## Formats
- **.ksp** : format natif, garde tout (calques de texte modifiables, calques de réglage, masques, styles, repères).
- **.psd** : lecture et écriture via ag-psd : groupes, masques, modes de fusion, opacité, écrêtage, styles,
  calques de réglage (14 types), formes vectorielles (avec repli pixel si besoin).
- **TIFF CMJN** en export (séparation simple, sans profil ICC) ; épreuve écran CMJN et alerte de gamut (Ctrl+Y / Ctrl+Maj+Y).
- 16 bits par couche : non pris en charge (le moteur Canvas travaille en 8 bits).
- PNG, JPEG, WebP, GIF, BMP, SVG, AVIF en lecture ; PNG / JPEG / WebP en export.

## Organisation
```
main.js / preload.js     processus Electron (fenêtre, fichiers, polices)
app/index.html           page
app/css/style.css        thèmes Sombre / Graphite / Clair
app/js/                  cœur : document, calques, sélection, historique, rendu, réglages, filtres, pinceau, E/S
app/js/tools/            outils (sélection, peinture, retouche, transformation, texte, formes…)
app/js/ui/               panneaux, menus, boîtes de dialogue, sélecteur de couleurs
app/vendor/ag-psd.js     bibliothèque PSD (MIT, voir ag-psd-LICENSE.txt)
```

## Installer sur une autre machine
`Lancer Kanevas.cmd` installe les dépendances au besoin. Les versions récentes de npm bloquent les scripts
d'installation : le binaire d'Electron est alors récupéré par `node node_modules\electron\install.js`.

## Tester sans Electron
`python -m http.server 8742 --directory app` puis http://127.0.0.1:8742 (ouverture/enregistrement
passent alors par le navigateur).

Palette par défaut : **Givre**, harmonisée avec KaneOS (gris clair, blanc, bleu #2f6fdb). Les thèmes Sombre et Graphite restent disponibles dans les préférences. Les anciens documents .ksp restent compatibles.


## Protection du travail
Les sauvegardes de secours sont activées par défaut : après 5 secondes d'inactivité et contrôle toutes les 30 secondes (intervalle réglable dans les préférences). Elles restent séparées de vos projets dans le sous-dossier recovery des données de Kanevas. Deux générations sont conservées par document, avec écriture temporaire et validation avant restauration.
Après un arrêt inattendu, une fenêtre propose de récupérer les documents non enregistrés. « Plus tard » conserve les copies ; Fichier > Récupérer des documents permet de les retrouver. Une sauvegarde manuelle réussie ou une fermeture volontaire du document retire sa copie de secours. Une erreur de disque est signalée dans la barre d'état.

## Réglages modifiables
Image > Réglages et Camera Raw créent par défaut un calque de réglage, sans modifier les pixels du calque source. Le réglage est écrêté au calque actif quand celui-ci le permet ; une sélection devient son masque. Double-cliquez sur sa vignette, ou choisissez « Modifier le réglage… » dans ses propriétés ou son menu contextuel. Annuler rétablit le réglage précédent ; OK crée une étape d'historique.
Les ombres, lueurs, contours et incrustations restent modifiables avec « Style de calque… » ou le badge fx. Enregistrez en .ksp pour conserver l'intégralité des réglages ; les exports PNG/JPEG sont des images aplaties. Les filtres pixel et les réglages appliqués à un masque restent des opérations sur les pixels. Le mode historique est disponible en décochant « Créer des réglages modifiables ».

## Réglage des outils au geste
Maintenir Alt + bouton droit dans la zone de travail : glisser horizontalement pour la taille, verticalement pour la dureté. Un cercle rouge et les valeurs montrent l’empreinte. Relâcher pour conserver, Échap pour revenir aux valeurs précédentes. Disponible sur les outils de peinture et de retouche, et la sélection rapide (taille seulement). Le crayon reste à bord dur. Alt + clic gauche garde la pipette ou la définition de source du tampon/correcteur. [ ] et Maj+[ ] restent disponibles.


## Installateur et mises à jour
- **Installer** : télécharger `Kanevas-Setup-x.y.z.exe` depuis les [Releases](https://github.com/Kaynegiordano/Kanevas/releases) (installation par utilisateur, sans droits administrateur).
- **Mises à jour** : Kanevas vérifie les releases GitHub 8 secondes après le démarrage ; Aide > Rechercher des mises à jour… le fait à la demande. Rien n'est téléchargé sans accord, puis « Redémarrer et installer ». Ne fonctionne que dans la version installée.
- **Publier une version** : changer `version` dans `package.json` (et la même dans le journal des changements ci-dessous), puis `Publier une version.cmd`. Il construit l'installateur (`npm run dist`) et crée la release GitHub avec `Kanevas-Setup-x.y.z.exe`, `.blockmap` et `latest.yml` (ce dernier est indispensable aux mises à jour).

## Journal des versions
- **1.0.0** : première version publique, installateur Windows et mises à jour GitHub.
- **1.0.1** : correction de l'icône (multi-tailles, identifiant de barre des tâches aligné sur l'installateur).
- **1.0.2** : rectangle à angles réglables, lasso magnétique, image insérée dans un texte ou une forme, pictos d'outils redessinés, polices du PC dans la version web.
- **1.0.3** : grandes images bien plus fluides (composition par zones, affichage progressif, pyramide de zoom), outil Pièce, calques de remplissage dynamiques, Correction sélective, Atténuer, Ctrl+F, instantanés, Agrandir / Sélection similaire.
- **1.0.4** : retouche fluide sur les grandes images (tampon de duplication, correcteurs, pièce, flou, netteté, doigt, densité, éponge).
- **1.0.5** : Electron 44.7.2 (correctifs de sécurité de Chromium).
- **1.0.6** : façon Photoshop 2026 : outil Suppression et Supprimer avec l'IA (LaMa local), remplissage et développement génératifs et super résolution (via Forge), Harmoniser, pinceau de réglage, barre des tâches contextuelle ; filtres lourds bien plus rapides ; accents réparés dans les noms des modèles d'IA.
- **1.0.7** : génération Forge corrigée : invites en français traduites en anglais sur le PC (fini les filles au hasard), réglages adaptés au modèle anima, force 85 %, invite envoyée affichée ; jointure du développement génératif plus douce.
- **1.1.0** : Studio Forge : nouvelle image dans un nouveau document, image → image, ADetailer (et retouche seule), agrandir et détailler (MultiDiffusion), Shift, aperçu en direct, PNG Info, IA en direct, atelier LoRA (entraîneur de Forge), découpe pour les réseaux (carrousel, grille du profil), menu IA.
- **1.4.1** : Studio IA → Édition : l'invite telle que tapée (français, LoRA), l'invite négative, les styles, l'échantillonnage, la graine et ADetailer passent au panneau img2img (et reviennent avec « Ses paramètres vers txt2img »).
- **1.4.0** : img2img dans l'Édition (panneau de Forge), envoi Édition ⇄ Studio IA, Refiner retiré, fiches LoRA (🛠️) et poids, Train LoRA refait comme l'onglet de Forge.
- **1.3.0** : le Studio IA devient la page de Forge : mêmes onglets, réglages, noms et ordre ; img2img / Sketch / Inpaint sur la toile Kanevas ; Extras, PNG Info, scripts.
- **1.2.0** : Studio IA autonome : moteur de Forge démarré par Kanevas, espace Studio IA (Créer, Transformer, Retoucher la zone peinte, Croquis, Agrandir), hires fix, refiner, lots, graine de variation, options de retouche, soft inpainting, Never OOM, galerie et enregistrement automatique.
- **1.15.0** : Studio IA, onglet Pose 3D : corps humain réaliste posable (MakeHuman), poses et mains toutes faites, cinématique inverse, caméra et lumière, dessin de référence en fond, calque guide (ombré, contours, silhouette, profondeur, normales, OpenPose).
- **1.16.0** : Studio IA, l'onglet Pose 3D devient **Angle** : relief de l'image (Depth Anything V2, local), nouvel angle de vue à la souris, zones découvertes repeintes par Forge à la taille de l'image, passe d'unification.
- **1.16.1** : Angle : invite et invite négative de l'image envoyées telles quelles, SEEDS 3 + Beta57 en 22 étapes par défaut, CFG et Shift repris de l'image.
- **1.22.0** : Kane Detailer 4 : plusieurs essais par zone départagés par un juge (ou l'original gardé), essai réparateur pour les mains douteuses, grain du pinceau gardé, lumières protégées, visages qui ne vieillissent plus.
- **1.24.0** : Studio IA 2 : composeur d'invite, résultat en grand, volet de réglages à droite en français, séance sous le résultat, actions compactes ; ADetailer retiré au profit de Kane Detailer ; nombre de médias de la bibliothèque réglable.
- **1.25.0** : Kane Detailer 5 : invite de zone d'après ce qu'on y voit (WD14), juge WD14 (netteté, identité, erreurs), raccords invisibles (inpainting doux).
- **1.26.0** : Studio IA 3 : l'image en grand au centre, invite en bas qui s'agrandit pendant la saisie, pastilles de réglages rapides, tiroir de réglages aéré, loupe au survol (détails à 100 % sans cliquer), planche pour les lots, séance en colonne avec ← →.
- **1.26.1** : Kane Explorer peut envoyer une image directement dans le Studio IA (clic droit → Envoyer vers KaneApp → Img2Img, Inpaint, Extras ou PNG Info) : option de lancement `--kane-studio=…`, aussi quand KaneApp est déjà ouvert.
- **1.26.2** : finitions du Studio IA 3 : avec le tiroir ouvert, actions et pastilles restent sur une ligne (requêtes de conteneur `fxstage` / `fxdock` : icônes seules sous 1 060 / 1 220 px) ; onglets Agrandir et Lora en français ; « txt2img » / « Extras » renommés Créer / Agrandir dans les libellés.
- **1.26.3** : KaneApp s'ouvre sur Projet par défaut, même quitté dans le Studio IA (`prefs.studio` ne rouvre plus le Studio au lancement) ; Préférences › Écran au lancement : Projet, Retouche ou Studio IA (`startPage`). `test-suite.cjs` recharge KaneApp pour vérifier les trois cas.
- **1.26.4** : bibliothèque de l'écran Projet masquée par défaut (`showLibrary` doit valoir `true` pour l'afficher ; la grille n'est alors plus construite) ; le bouton Bibliothèque ouvre toujours le panneau.
- **1.27.0** : Retouche à la Photoshop : Alt + clic gauche glissé = taille / dureté (clic simple = pipette), Ctrl + Alt + clic droit glissé = opacité / flux, Maj + Alt + clic droit = sélecteur de couleur au curseur (`brush-gesture.js`), opacité à deux chiffres, outils à ressort (`T.spring`), vue d'ensemble H, Alt + [ ] calques, Maj + / − modes de fusion, bulle `G.flash`. Test : `tools/test-retouche.cjs` (vrais événements souris / clavier, 19 vérifications).
- **1.27.1** : geste de taille pour tous les outils à empreinte (`brushGesture.sizeable` : taille + curseur rond, au lieu d'une liste figée qui oubliait Suppression et le pinceau de réglage) ; Alt + clic gauche glissé pour les outils sans pipette (un Alt + clic simple est rejoué tel quel : source du tampon) ; `altPaints` pour les outils qui peignent avec Alt.
- **1.28.0** : sélecteur de forme au clic droit (`brushGesture.picker`), masque seul (`doc.maskView`, Alt+clic vignette), chiffres = opacité du calque (`C.layerOpacityKey`), Ctrl+H (`V.hideExtras`), Maj+Tab (`no-dock`), F modes d'écran (`C.screenMode`), Maj+Retour arrière = Remplir, double-clic Main / Loupe. test-retouche : 37 vérifications.
- **1.29.0** : atelier Lora recalibré (LoRA justes au poids 1, ~40 % plus court), légendes dans l'ordre d'ANIMA avec note de contenu et `@nom` pour les styles, aperçus et carte par époque avec « Garder cette version ».

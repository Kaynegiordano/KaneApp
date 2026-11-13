# Montage dans Kanevas 1.12.18

Montage embarque KaneClip 1.4.0. Sa provenance figure dans `kaneclip/VERSION.json`.
Les menus de KaneClip sont exposés par `KC.menus.defs` dans la barre de Kanevas.
Quitter Montage interrompt la lecture du Programme et du moniteur Source.

## Utilisation

- **Dérushage** : ouvrir un média dans Source, choisir les points I/O puis insérer ou remplacer sur les pistes ciblées. Le Programme conserve sa position et sa plage indépendantes.
- **Création** : sélectionner les plans, choisir l'intensité du prochain look et une recette. Les effets ajoutés restent modifiables dans Propriétés. Changer de recette remplace les effets de l'Atelier et préserve les effets manuels. Zoom progressif, dézoom et panoramique écrivent des images-clés de recadrage.
- **Sous-titres** : importer un SRT UTF-8 ou ajouter du texte au curseur. Corriger le texte, ouvrir Calage pour les temps, choisir Clair ou Cartouche. Les textes sont incrustés à l'export vidéo et peuvent être réexportés en SRT. La transcription automatique n'est pas incluse.
- **Ctrl+K** : rechercher une action sans tenir compte des accents, choisir avec les flèches et exécuter avec Entrée.
- **FX activés / FX ignorés** : désactiver temporairement les effets de l'aperçu. L'export vidéo conserve les effets du projet. Le compteur en millisecondes mesure la composition ; il ne mesure pas la totalité du décodage et de l'affichage.

## Vérification

Depuis ce dépôt, sans dépendance supplémentaire :

```powershell
node kaneclip/tests/editing-model.cjs
node kaneclip/tests/captions-model.cjs
node kaneclip/tests/event-index.cjs
```

L'index est comparé à une recherche exhaustive sur 20 001 événements :
chevauchements, longues séquences, recherche par piste et invalidations.
Les temps de ce micro-benchmark ne représentent pas un gain de FPS global.

Le dépôt source KaneClip contient aussi `tests/pro-editing.cjs`,
`tests/native-playback.cjs` et `tests/workspace.cjs`. Le parcours pro nécessite
Electron, Playwright et FFmpeg ; il fabrique ses médias et utilise un profil
isolé. Pour l'intégration, depuis le dépôt KaneClip :

```powershell
$env:KANE_PRO_HOST='C:/KaneOS/KaneApp'
node tests/pro-editing.cjs
# Pour contrôler ensuite l'installation :
$env:KANE_PRO_APP='C:/Users/Franc/AppData/Local/Programs/KaneApp/KaneApp.exe'
node tests/pro-editing.cjs
```

`KANEVAS_PROFILE` est réglé par ce test : le profil personnel KaneShop reste
à l'écart. Le test vérifie le montage Source, les opérations liées A/V,
les effets, l'Atelier, les sous-titres, les raccourcis et un export réel H.264/AAC.
Il contrôle également que quitter Montage interrompt la lecture.

La construction utilise `npm run dist` (publication désactivée). L'installation
se fait lorsque Kanevas est fermé ; le SHA-256 de l'archive `app.asar` installée
doit correspondre à celui du paquet construit avant de lancer le parcours
sur l'exécutable installé.

Validation locale du 20 octobre 2026 : les trois modèles passent, ainsi que
les parcours Electron autonome, intégré et installé en 1.12.18. La lecture
MP4/MKV/WebM et les dispositions passent dans le dépôt source. L'installation
1.12.18 a été contrôlée par identité SHA-256 de `app.asar`, présence des nouveaux
modules et export H.264/AAC depuis l'application installée en profil isolé.

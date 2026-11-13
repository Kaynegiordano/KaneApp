# Moteurs gérés par Kanevas

La migration copie les installations locales. Le retrait officiel des anciennes installations est séparé de cette copie et n’est effectué qu’après validation de l’utilisateur et audit final des sources.

## Données et installations

- `C:\KaneOS\KaneAppData\runtimes\studio` : moteur du Studio, extensions, Python et projets LoRA.
- `C:\KaneOS\KaneAppData\runtimes\ComfyUI` : Animation Vidéo, nœuds personnalisés, Python et données de l’interface.
- `C:\KaneOS\KaneAppData\runtimes\Animation` : Animation, outils, Python, ressources et projets locaux.
- `C:\KaneOS\KaneAppData\runtimes\sd-scripts` : bibliothèque d’entraînement.
- `C:\KaneOS\KaneAppData\bin` : FFmpeg et sa licence, utilisés par Montage et les processus intégrés.

Le dossier commun `C:\KaneOS\models`, les sorties communes de KaneOS, les caches Hugging Face et le Python de base installé dans Windows restent partagés. Ce ne sont pas des copies indépendantes de ces données. Ils doivent rester en place.

Les copies sont séparées du dossier de l’installateur et du dépôt Git. Une mise à jour de Kanevas ne remplace pas les environnements ni les projets.

## Étapes

Préférences > Applications intégrées > Migration vers Kanevas :

1. Copier les moteurs. Le contenu est comparé par SHA256 ; les jonctions sont matérialisées, les chemins de configuration et lanceurs Python sont réparés seulement dans les copies. Les caches Python compilés sont recalculés au besoin.
2. Vérifier les fichiers depuis les manifestes enregistrés. Les fichiers de configuration modifiés ensuite par l’application peuvent naturellement différer de cet instantané initial.
3. Tester les environnements Python copiés, leurs imports et l’absence des installations d’origine dans leurs chemins de chargement.
4. Arrêter les moteurs, puis activer les copies vérifiées. Les points d’entrée et exécutables sont revérifiés. Kanevas refuse de reprendre un ancien processus à la place d’une copie migrée.

`migration.json` conserve les étapes, les contrôles et les validations applicatives. Les fichiers `*-files.jsonl` contiennent les empreintes avant/après et distinguent les fichiers adaptés. Un verrou empêche deux opérations sur les mêmes copies.

## Validation et retrait différé

Les contrôles Python et les API ne prouvent pas à eux seuls qu’un workflow personnel ou un entraînement complet fonctionne. Le rapport garde des validations en attente : projets Studio, entraînement LoRA, workflows vidéo et rendus Animation.

Le bouton de copie ne supprime rien. Après validation des usages, `tools/audit-legacy-runtimes.py` compare les sources actuelles aux empreintes initiales et aux copies. Toute donnée nouvelle ou différente bloque le retrait. Dans Kane OS, `setup/finalize-kanevas.ps1` exige cet audit réussi, les copies actives et les moteurs arrêtés. Il vérifie les quatre chemins sources exacts, retire les jonctions sans suivre leur cible, puis supprime les anciens dossiers Studio/Forge, ComfyUI, Animation et sd-scripts.

Le rapport conserve les chemins retirés, l’autorisation et les dates. Dès le début du retrait, le lanceur présente Kane App à la place des applications séparées et désactive leurs anciens canaux de mise à jour. Les modèles, sorties, caches et Python partagés restent en place. Les dépôts de développement et données des autres applications restent indépendants de ce retrait.

Avant retrait, le retour aux installations précédentes restaure les fichiers de configuration sauvegardés et conserve les copies. Après retrait, cette commande est désactivée dans l’interface et refusée dans le processus principal, pour ne pas rétablir des chemins supprimés.

## Contrôles développeur

- `node tools/test-managed-runtimes.cjs` : activation, intégrité des points d’entrée, confinement et retour à la configuration précédente.
- `python tools/test-runtime-migrate.py` : copie réelle de petits jeux de fichiers, réparation des chemins, SHA256, corruption et verrou.
- `tools/test-studio.cjs` : import Lora isolé de l’Édition.
- `tools/test-suite.cjs` : interface et ponts natifs de migration, suppression indisponible sans données vérifiées.
- `tools/test-owned-main.cjs` : vrai processus principal et profil isolé, chemins des services et projets LoRA copiés, FFmpeg réel et catalogue fonctionnel quand les métadonnées `cmd-flags` de Forge ne répondent pas.
- `python tools/verify-migrated-runtimes.py --report C:\KaneOS\KaneAppData\migration.json --component studio` : génération et inpaint sur le moteur copié, sur un port de test. Les autres composants disponibles sont `comfyui`, `wallpaper`, `lora` et `media`.

Ces contrôles applicatifs utilisent les copies réelles et des ports locaux distincts. L’entraînement LoRA complet, une vidéo générative et l’évaluation des mouvements sur les projets personnels restent à effectuer avant d’autoriser un retrait.

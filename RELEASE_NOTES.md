# 1.29.0 — Atelier Lora : plus rapide, mieux réglé

- **Des LoRA justes au poids 1** : tous les LoRA entraînés ici s'utilisaient à 0,2–0,35, signe d'une recette environ trois fois trop forte. Le taux d'apprentissage est divisé par deux environ (comme le conseille la fiche d'ANIMA) et le nombre de passages par image baisse de 40 %. Essai sur votre style n1x3u (24 images) : **24 minutes au lieu de 41**, image propre au poids 1.
- **Légendes dans l'ordre d'ANIMA** : note de contenu (safe, sensitive, nsfw, explicit), nombre de personnages, personnages, déclencheur, puis le reste. La note est ajoutée aux anciennes légendes quand vous appliquez le préréglage, sans toucher au reste.
- **« @nom » pour les styles** (Style, Technique, Peinture numérique) : ANIMA reconnaît un artiste à son « @ ». Écrivez par exemple **@n1x3u** dans vos invites.
- **Une version par époque, à comparer** : deux images d'aperçu (une scène de votre jeu d'images, une scène nouvelle) avant l'entraînement puis à chaque sauvegarde, même graine. Chaque époque a sa carte avec **Essayer** et **Garder cette version**, qui l'installe dans vos LoRA avec sa fiche (déclencheur, poids 1) et son image, sans jamais écraser un fichier.
- **Anciens projets** : un message signale les réglages calculés avec l'ancienne recette ; « Appliquer le préréglage » les recalcule.
- Préréglages et messages de l'atelier en français.

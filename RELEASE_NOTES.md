# 1.30.0 — Atelier Lora : taille réelle, tags, file d'attente

- **Le trait appris à la bonne échelle** : vous générez surtout en 1856 × 1024, mais l'atelier entraînait à environ 1024 × 1024. Pour les styles (Style, Technique, Peinture numérique) dont les images dépassent 1024 × 1024, chaque image s'entraîne maintenant à sa taille réelle (jusqu'à 1536, jamais agrandie). Essai sur n1x3u comparé en 1856 × 1024 : hachures, mèches et grain du dessin nettement mieux rendus. Environ 40 % plus long, et encore plus court que l'ancienne recette (35 min contre 41 pour 24 images). Case « Taille réelle des images » pour choisir.
- **Tags du projet** : combien d'images portent chaque tag ; d'un clic, retirer un tag de toutes les légendes, le renommer ou l'ajouter partout. « Annuler la dernière modification ».
- **File d'attente** : « Ajouter à la file » garde les réglages du projet ; « Démarrer la file » enchaîne les entraînements, chacun à la fin du précédent. « Éteindre le PC » attend la fin de la file.
- Noms de fichiers longs coupés proprement dans la liste des légendes ; carte d'époque à une seule image centrée.

# DSH Design Studio — alpha.10 : tracés SVG et Bézier

**Date :** 2026-11-16. **Statut :** prototype expérimental sur `feat/native-file-persistence`. Aucun tag, aucune release, aucune fusion.

## Preuves exécutées

- SHA vérifié par CI : `582ed6c7d60a546fe57172fe0c0183c7eb8ba286`.
- [GitHub Actions — run 43964684414](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/43964684414), commande `npm run check` sous Node.js 22.
- Sortie du job : **163 tests, 163 PASS, 0 FAIL, 0 SKIP**. Les tests combinent parsing pur, écriture et relecture de fichiers temporaires, routes hôte simulées et gestionnaires d'événements React simulés.
- **NOT_RUN :** installation dans une vraie instance DSH, gestes dans un navigateur réel, affichage sur PC/mobile. Le succès de la CI ne prouve pas ces points.

## Ce qui est implémenté

### Tracés natifs

- Création d'un élément `<path>` cubique via le bouton **Tracé** (mêmes contrôles de révision/source que les autres formes).
- Liste des tracés disponibles via `GET /design-studio-native/document` : `pathNodes` indique quels éléments sont réellement éditables, leurs points, positions numériques et connexions des poignées.
- Parseur dédié `src/svg-paths.mjs` avec grammaire **absolue et explicite** : `M` début, `L` ligne, `Q` quadratique, `C` cubique, `Z` fermeture.
- Les coordonnées relatives, les répétitions implicites, `H/V/S/T/A`, les transformations et les éléments imbriqués sont **refusés** au lieu d'être convertis à perte.
- Édition d'une ancre ou poignée via `kind: 'svg-path-point'` : la commande vérifie l'identifiant, l'indice, la plage des valeurs, le caractère direct du nœud SVG et le SHA du fichier ; elle remplace **deux plages numériques exactes** dans l'attribut `d`, puis renvoie les patches inverses pour Annuler/Rétablir.
- Bornes du parseur : **8192 caractères pour `d`**, **128 commandes**, **256 points**, coordonnées finies dans `[-10⁶,+10⁶]`. Le sérialiseur arrondit les coordonnées modifiées à trois décimales, sans toucher aux autres chiffres du tracé.

### Interface V3 Graphite

- Sélection d'un calque `path` dans la liste ; poignées d'ancres carrées et poignées de contrôle rondes, liens vers les ancres, prévisualisation visuelle du tracé pendant le mouvement.
- L'aperçu utilise une surimpression SVG non persistante, sans lancer d'agent IA.
- Déplacement au pointeur de chaque ancre/poignée, magnétisme de grille déjà disponible et **Alt** pour passer en placement libre.
- **Échap** ou `pointercancel` annule le geste sans écrire dans le fichier ; l'écriture native n'intervient qu'au relâchement après mouvement significatif.
- Lorsqu'une coordonnée ne bouge pas, le magnétisme ne la décale plus arbitrairement.
- L'inspecteur affiche un état explicite pour les tracés refusés.

## Tests ajoutés

- Parseur : M/L/Q/C/Z, exponentielles et nombres signés, sous-chemins, liens Bézier, limites, commande inconnue, chemin relatif, format invalide, ID ambigu.
- Patch source : un seul point modifié, stabilité du reste du fichier, annulation exacte, erreur sur index/coordonnées invalides.
- Routes API + vrais fichiers temporaires : édition d'un contrôle cubique, refus d'une version obsolète, ajout d'un tracé éditable, annulation du déplacement puis de la création.
- UI simulée : sélection, poignées, aperçu du `d`, contrôle Bézier, pas d'écriture durant le glissement, Annuler/Rétablir, commandes non prises en charge, Alt, création et annulation avec Échap.

## Limites et points bloquants

- Le rendu de la courbe pendant un mouvement est une **surimpression** ; l'aperçu en iframe n'est rafraîchi qu'après sauvegarde et relecture.
- Le support est délibérément limité au sous-ensemble explicite `M/L/Q/C/Z`, sur un élément `path` **feuille, direct sous `svg`, sans transform**, avec `viewBox` pris en charge.
- Les ancres ne déplacent pas automatiquement leurs tangentes adjacentes ; pas de lissage automatique ni de contrainte symétrique. Les courbes quadratiques affichent deux guides pour leur unique poignée.
- Pas d'édition de courbes avec `arc`, de boolean operations, d'outil Plume complet, de sélection multiple, de groupe transformé, de guides persistants ni de précision de hit-testing validée en navigateur.
- Les métadonnées de tracés sont calculées dans une liste bornée à 128 éléments, avec scans conservateurs ; **profiling de gros SVG non réalisé**.
- Pas de CAS atomique interprocessus ni d'audit exhaustif des races sur les chemins fichiers.

**Gate final :** PR #8 en brouillon vers `dev`, sans fusion ni release tant que la vérification DSH réelle, les conditions de sécurité et l'ergonomie n'ont pas été démontrées.

# DSH Design Studio alpha.9 — Grille et repères de précision

**Date :** 2026-11-16. **État :** version expérimentale sur `feat/native-file-persistence`, **aucune publication**.

## Preuves exécutées

- Source testée au commit `9f5cc9e2f62c8f3b242ebba128d34f11311de5f2`.
- [GitHub Actions run 43959981523](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/43959981523) : commande `npm run check` sous Node 22.
- Résultat des logs : **141 tests exécutés, 141 PASS, 0 FAIL, 0 SKIP** (vérification syntaxique des modules + tests Node).
- Les tests du client simulent React et les événements pointeur. **Une installation réelle et les gestes dans DeepSeek Harness sont toujours NOT_RUN**.

## Fonctionnalités intégrées

- Bouton **Grille** : affiche ou masque une grille visuelle au-dessus du SVG, sans altérer la source.
- **Pas de grille** : sélection parmi 2, 5, 8, 10, 16, 20, 25, 32, 50, 64, 100 **unités SVG**. L'origine d'accrochage correspond à l'origine du `viewBox` ; les pas sont recalculés selon les dimensions du document.
- Bouton **Aimant** : magnétisme optionnel sur la grille pour les déplacements et les poignées de redimensionnement.
- Bouton **Repères** : alignement intelligent facultatif des **centres et bords** d'un élément déplacé avec le document et les autres éléments dont la géométrie est disponible.
- Seuil d'alignement : **6 pixels à l'écran**, convertis en unités SVG d'après les dimensions réellement affichées, sans seuil fixe en unités source.
- Guides verticaux/horizontaux cuivrés uniquement pendant un glissement et retirés lors du relâchement, de l'annulation ou du rechargement.
- **Alt** pendant le geste ignore temporairement les deux types de magnétisme pour un positionnement fin.
- Les coordonnées du déplacement sont calculées identiquement dans la prévisualisation et dans la transaction native validée au relâchement. Pas de requêtes IA ni d'écriture pendant le déplacement.

## Périmètre et limites

- Les **repères intelligents** couvrent les déplacements ; le **redimensionnement** ne bénéficie pour l'instant que du magnétisme de grille. Le verrouillage de proportion **Maj** demeure pris en charge. Les repères de calage des chemins Bézier restent à concevoir.
- Si grille et repères sont activés simultanément, le repère intelligent le plus proche dans la tolérance peut ajuster le point obtenu après accrochage à la grille.
- Les formes complexes, groupes et transformations ne disposent toujours pas d'un calcul géométrique complet. Les hit-box des textes sont estimées et ne sont pas des métriques de police exactes.
- L'origine des lignes affichées sur le SVG correspond au coin supérieur gauche du `viewBox` ; ce système ne fournit pas encore de grille isométrique, de règles, de guides utilisateur persistants ou de gestion d'unités physiques.
- Les réglages de grille/aimant/repères sont **locaux à la session de panneau** : ils ne sont pas enregistrés dans le SVG ni conservés après redémarrage.
- **NOT_RUN** : intégration réelle DSH, test Chromium/Firefox, mobile, lecteur d'écran, performances sur grands fichiers.
- **NOT_RUN** : vérification des races filesystem interprocessus et des chemins symlinks ; la branche reste expérimentale et la PR demeure un brouillon.

## Suite prioritaire

1. Tester le rendu et les gestes dans un profil de développement DSH réel ; relever version, capture, journaux et SHA.
2. Vérifier l'ergonomie de la grille et des repères en haute densité DPI et au zoom mobile.
3. Poursuivre la sélection précise et les outils de dessin de chemins, avec un modèle source SVG non destructif.
4. Maintenir la direction **V3 Graphite** sans bleu omniprésent et sans réécriture de SVG inutiles.

**Aucune fusion `main`, aucun tag et aucune release.**

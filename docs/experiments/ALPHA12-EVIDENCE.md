# DSH Design Studio — Alpha 0.1.0.12 · Outil Plume

**Date :** 16 novembre 2026. **Statut :** prototype sur `feat/native-file-persistence`, PR #8 en brouillon vers `dev`. Aucun merge, tag ou release.

## Preuve de vérification

- **SHA testé :** `147b5109f0e08c02e4772ca9500e4b93d8f16abf`.
- **GitHub Actions :** [run 43970321870](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/43970321870), workflow `Core source patch tests`.
- **Commande exécutée :** `npm run check` (Node.js 22, vérification syntaxique et `node --test tests/*.test.mjs`).
- **Sortie observée :** **191 tests, 191 PASS, 0 FAIL, 0 SKIP**.
- La CI simule les événements React, mais certains tests font réellement communiquer le client simulé avec le routeur Host et écrivent des SVG dans un dossier temporaire. **L'installation et les gestes dans l'application DSH réelle restent NOT_RUN**.

## Fonctionnalités ajoutées

### Plume manuelle, sans IA

- Barre d'outils V3 Graphite : **✒ Plume · P**, **Nouveau**, **Fermer le tracé**.
- Clic dans le canevas : crée un nouvel élément SVG natif `<path id="shape-N" d="M x y" .../>` au point choisi. Les clics suivants ajoutent des segments explicites `L`.
- Clic-glissé au moment de placer une ancre : crée une courbe cubique `C` reliant l'ancre précédente, avec contrôle sortant basé sur la direction de la tangente conservée en session (si disponible), contrôle entrant d'après le geste et ancre terminale à la position choisie.
- Prévisualisation visuelle de la direction de la tangente, uniquement dans le canevas : pas d'écriture pendant le geste.
- La fermeture ajoute une commande `Z`, **uniquement à partir de trois ancres**. Les tracés fermés ne sont plus proposés en continuation.
- **Reprendre le tracé avec la Plume** permet de continuer un chemin déjà existant avec un seul sous-chemin ouvert ; après réouverture, la tangente en session est remise à zéro. Les chemins fermés ou complexes sont refusés.
- `Échap`/`pointercancel` interrompent le geste en cours sans écriture. La navigation par **Espace + glisser** reste prioritaire.
- Le zoom et la grille existants sont respectés lors du placement des points ; **Alt** ignore le magnétisme de grille.

### Persistence native

- Les mutations passent par `kind: 'svg-pen'` : opérations `start`, `append`, `close`.
- La création réutilise `svgShapeInsertPatch` avec des coordonnées explicites ; append/close écrivent uniquement à la fin de l'attribut `d` concerné. Le reste du document reste byte-pour-byte intact.
- Les bornes et les refus du parseur de chemins demeurent : coordonnées finies bornées, grammaire explicite `M/L/Q/C/Z` absolue, un sous-chemin ouvert pour continuer, limites de taille et de nombre de commandes.
- SHA-256 de révision obligatoire sur chaque appel ; un fichier modifié entre ouverture et sauvegarde provoque un refus `409`, sans écrasement.
- L'historique des patches natifs inverse exactement les opérations « création → lignes/courbes → fermeture », y compris des annulations successives.

## Tests

- Unitaires : création au point précis ; ajout de `L`, ajout de `C`, fermeture ; refus de commandes invalides, tangentes non finies, coordonnées hors plage, chemins fermés/à sous-chemins multiples et limites du parseur.
- Host + fichier : création, segments, fermeture, Undo des quatre écritures, protection contre conflit externe, validation des données.
- Client + Host **réels dans les tests** (environnement React simulé) : clics/clic-glissé, fermeture, Undo, annulation Échap, clic hors du plan, reprise d'un ancien chemin, impossibilité de reprendre un chemin fermé.

## Limites et suites

- Il ne s'agit pas encore de l'outil Plume complet des éditeurs professionnels. **NOT_IMPLEMENTED :** mode automatique de tangentes symétriques/lissées lors de l'édition, poignée sortante persistante entre redémarrages, continuation des chemins transformés/relatifs/fermés, courbe par pression/stylet, double-clic pour achever un tracé ouvert, transformation de courbes existantes au clic.
- La géométrie est calculée à partir des rectangles d'affichage du canevas : la fidélité des gestes, du zoom, du rendu et des coordonnées doit être validée en navigateur réel.
- Les appels réseau, tests de concurrency interprocessus et audit TOCTOU de l'accès filesystem doivent encore être renforcés.
- **NOT_RUN :** installation dans DSH Desktop/Web, screenshots et tests de souris/pavé tactile/tactile, accessibilité, environnement multi-OS, performances réelles.

**Bloqueurs de release inchangés :** aucune fusion vers `main`, aucun tag, aucune publication à ce stade.

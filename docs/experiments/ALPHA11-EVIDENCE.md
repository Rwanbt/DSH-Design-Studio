# DSH Design Studio — alpha.11 : édition de topologie des tracés

**Date :** 2026-11-16. **Statut :** expérimental, PR #8 vers `dev` toujours en brouillon.

## Gate automatisé vérifié

- Code vérifié au commit `4c9041896101ffa3de3387a643eeb3ae64093f9f`.
- [GitHub Actions run 43966767066](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/43966767066).
- Commande : `npm run check` sous Node.js 22 (vérifications syntaxiques et `node --test tests/*.test.mjs`).
- Sortie vérifiée : **177 tests, 177 PASS, 0 FAIL, 0 SKIP**.
- Les tests concernent la logique pure, de vrais fichiers temporaires et des simulations des événements React/Host. **L'installation réelle dans DSH n'a pas été exécutée (NOT_RUN).**

## Fonctionnalités livrées

### Insertion de points

- Le modèle des chemins SVG natifs expose les segments editables `L`, `Q`, `C` avec leur `commandIndex`, leur point médian et le caractère supprimable ou non.
- L'éditeur affiche un bouton **+** sur le milieu du segment sélectionné ainsi qu'une commande d'ajout dans l'inspecteur. Le geste est manuel, sans IA.
- `L` : insertion d'un nouveau sommet intermédiaire par séparation en deux segments.
- `Q` et `C` : subdivision au paramètre `t=0,5` avec **De Casteljau**. La courbe reste géométriquement identique à l'arrondi numérique près (coordonnées insérées à six décimales). Les coordonnées non modifiées conservent leurs caractères source d'origine.
- Le patch remplace uniquement la plage textuelle de **la commande concernée dans l'attribut `d`**, pas le fichier SVG ni ses autres éléments.

### Suppression conservatrice

- L'inspecteur propose **Retirer** pour un sommet terminal appartenant à une commande explicite `L`.
- Seule cette commande `L` est supprimée. Cette action change volontairement la géométrie, et peut être annulée exactement avec les patches inverses de la session.
- Les commandes `M`, `Z`, `Q` et `C` ne peuvent pas être supprimées par ce premier outil : cela imposerait un choix explicite sur la modification des tangentes, de la forme et des sous-chemins.

### Sécurité et validations

- Nouvel appel `kind: svg-path-topology` de l'API native ; ID SVG unique, type d'opération, index de commande, SHA-256 de la révision et opérations de fichier existantes sont vérifiés avant écriture.
- Sous-ensemble accepté : chemins `M/L/Q/C/Z` absolus **avec commandes explicites**, élément feuille directement sous `<svg>`, sans transformation de groupes ou d'éléments.
- Refus : index inconnu, arcs/relatif/commandes implicites, structure inconnue, dépassement des limites du parseur, suppression Bézier ambiguë, révision de fichier obsolète.
- Les tests vérifient l'ajout sur ligne/courbe quadratique/cubique, l'annulation exacte, la suppression d'une ligne, la préservation du reste du SVG, le refus d'écritures concurrentes, et les nouveaux contrôles React simulés.

## Limitations restantes

- Les commandes d'insertion travaillent au **point médian** du segment uniquement, pas encore au paramètre de clic arbitraire ni par tracé au stylet.
- Le calcul à six décimales peut créer de très petites différences géométriques sur des coordonnées complexes ; il ne constitue pas un système exact de contraintes paramétriques.
- La suppression d'une ligne n'optimise pas automatiquement les segments voisins. Les contrôles Bézier et ancres ne proposent pas encore de tangentes solidaires, de mode symétrique ou de lissage automatique.
- Les paths relatifs, arcs, sous-groupes transformés et opérations booléennes restent en lecture seule pour l'édition graphique.
- Les tests React sont simulés. **NOT_RUN** : chargement réel dans DSH, inspection à l'écran, souris/pavé tactile/stylet, Firefox/Chromium, mobile, accessibilité, performance et concurrence fichiers interprocessus.

**Aucune fusion vers `main`, aucun tag et aucune release de production.**

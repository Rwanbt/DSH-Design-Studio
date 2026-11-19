# ADR-039 — Copier et appliquer l'apparence SVG native

**Statut : implémenté sur `dev`, vérifications actuelles à confirmer au SHA final**  
**Date : 19 novembre 2026**

## Contexte

Le plugin pouvait déjà copier/coller un calque entier, mais pas reprendre les
propriétés visuelles d'une forme pour les appliquer à une autre. Ce workflow
est important pour un éditeur de design professionnel.

## Décision

Les commandes « Copier apparence » et « Appliquer apparence » de
l'inspecteur et du menu contextuel réutilisent une primitive Host
`svg-appearance-transfer`. Le presse-papiers client retient uniquement
l'identifiant de la forme source, le chemin du document et la clé du workspace ;
il ne conserve pas de markup SVG à injecter.

Le Host relit le document courant et vérifie ses révisions
`baseHash` / `baseIdentity`. Il copie seulement les valeurs explicitement
écrites pour un sous-ensemble borné : `fill`, `stroke`,
`stroke-width`, `stroke-opacity`, `fill-opacity`, `opacity`,
`stroke-linecap`, `stroke-linejoin`, `stroke-dasharray`.

Les propriétés déjà identiques ne génèrent pas de patch. Les modifications
d'attributs existants sont des patches exacts ; les propriétés absentes sont
ajoutées à l'ouverture de la balise sans re-sérialiser le document. Plusieurs
insertions au même emplacement sont regroupées en un patch, donc chaque geste
ne génère qu'une seule écriture transactionnelle et un Undo exact.

## Refus délibérés

- Source et destination doivent être deux formes éditables distinctes du
  **même fichier, dans le même workspace**.
- Le style CSS d'un élément, une feuille `<style>`, une instruction
  `xml-stylesheet` ou une entité XML ambiguë entraîne un refus.
- Les cibles verrouillées (directement ou via un ancêtre) sont refusées.
- Une référence de peinture `url(#id)` doit pointer vers un ID défini dans
  ce même document.
- Une source sans attribut natif explicite, ou un transfert sans changement,
  est refusé sans écriture.

Cette opération ne prétend pas recopier les apparences effectivement calculées
par une cascade CSS, les styles hérités, les filtres, les masques, ou les
ressources externes. Elle ne fournit pas encore de styles partagés globaux
ou de Design Tokens cross-document.

## Validation

- `tests/svg-appearance.test.mjs` : exactitude, valeurs copiées, fusion des
  insertions, Undo, refus de verrou/style/référence.
- `tests/browser/specs/appearance.mjs` : action utilisateur réelle dans
  l'inspecteur contre le Host et le système de fichiers, puis Undo.
- Les niveaux CI doivent être contrôlés sur le SHA final ; l'intégration
  du bundle dans DSH Desktop reste **NOT_RUN** pour cette tranche.

**Aucune promotion vers `main` ni release ne découle de cet ADR.**

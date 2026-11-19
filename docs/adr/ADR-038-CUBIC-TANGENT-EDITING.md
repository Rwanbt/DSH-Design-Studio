# ADR-038 — Tangentes Bézier cubiques lissées et symétriques

**Statut : implémenté sur `dev`, certification DSH Desktop NOT_RUN**  
**Date : 19 novembre 2026**

## Besoin

L'outil de plume possède déjà les points de contrôle des segments cubiques.
Un éditeur vectoriel professionnel doit permettre de traiter une jonction
entre deux courbes comme un nœud à tangentes lissées ou symétriques.

## Contrat d'édition

La primitive `svgPathTangentPatches(source,{id,index,mode})` concerne
exclusivement les chemins dont le parseur natif accepte la grammaire
explicite absolue `M/L/Q/C/Z`. Seules les ancres où deux commandes
`C` successives se rejoignent sont proposées dans l'inspecteur.

- `smooth` : conserver la longueur du bras sortant et l'aligner sur
  l'opposé du bras entrant ;
- `symmetric` : aligner les tangentes et égaliser leurs longueurs.

L'ancre et le contrôle entrant restent inchangés. Seules les deux
valeurs numériques de la poignée sortante sont patchées. Les mêmes
préconditions Host, révisions et mécanismes d'Undo exact restent en vigueur.

La direction est refusée si la tangente entrante est de longueur nulle,
si une longueur nécessaire est nulle, si la géométrie sort des limites,
si le nœud ne joint pas deux commandes cubiques, ou si le chemin n'est
pas sûr à éditer. Les valeurs non prises en charge ne sont jamais
reconverties automatiquement.

## Vérification

- `tests/svg-paths.test.mjs` : symétrie, lissage, refus, inversion exacte.
- `tests/browser/specs/path-tangent.mjs` : geste réel depuis l'inspecteur,
  écriture SVG sur disque, Undo via Host.
- `npm run check` et `npm run test:browser` : contrôles CI à vérifier
  sur le SHA candidat réel, **pas seulement sur un SHA intermédiaire**.
- `npm run test:dsh` Web/Desktop : pas réexécuté pour cette tranche.

## Hors périmètre

Les commandes relatives, arcs, transformations imbriquées et chemins
avec commandes implicites restent conservativement hors édition
visuelle. Il ne s'agit pas encore d'un outil de manipulation de tangentes
au pointeur avec contraintes temps réel ni de la parité complète
Penpot/Figma/Affinity.

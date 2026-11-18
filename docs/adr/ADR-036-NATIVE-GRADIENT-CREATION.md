# ADR-036 — Création native de dégradés SVG (Graphite)

**Statut : implémenté sur `dev`, validation de niveau 3 non exécutée.**
**Date : 19 novembre 2026.**

## Besoin

L'inspecteur Graphite pouvait modifier les arrêts d'un dégradé existant, mais
ne permettait pas de transformer une forme à remplissage uni en forme à dégradé.
Un outil de design visuel doit pouvoir créer ce remplissage sans éditer le SVG
à la main.

## Décision

La commande du panneau « Remplissage » expose **Dégradé linéaire** et
**Dégradé radial**. Elle appelle la route Host avec
`kind: 'svg-gradient-create'`, l'identifiant du calque et le type demandé.

`src/svg-gradient-create.mjs` construit un **batch transactionnel de deux
patches de source non chevauchants** :
1. une déclaration `<linearGradient>` ou `<radialGradient>` avec deux arrêts
   de départ, insérée dans le `<defs>` existant ou dans un nouveau `<defs>` ;
2. un attribut `fill="url(#dsh_gradient_N)"` sur la forme sélectionnée,
   remplacé exactement lorsqu'il existait, ou inséré lorsqu'il était absent.

L'identifiant du dégradé est déterministe et unique dans le document scanné.
Le Host conserve les protections `baseHash` / `baseIdentity`, les verrous
et la validation du fichier avant écriture. **Un geste = une écriture et un
Undo exact** pour les deux patches.

Les arrêts peuvent ensuite être édités avec le panneau déjà existant
(couleur, opacité, position, ajout/suppression).

## Limites et refus

La création est volontairement refusée pour :
- calque inexistant, sans id unique, verrouillé, en lecture seule ou hors
  des tags pris en charge ;
- `style` en ligne sur la cible, `<style>` dans le document ou déclaration
  `xml-stylesheet` : leur cascade ne serait pas maîtrisée ;
- attribut `fill` encodé par entité XML ;
- plusieurs `<defs>` racine ou un `<defs/>` autofermant ;
- source SVG structurellement ambiguë ou non scannable.

Les deux arrêts initiaux utilisent la couleur hexadécimale solide déjà présente sur la forme (sinon noir) puis blanc. L'éditeur ne gère pas ici
la création d'un dégradé multi-étapes à partir d'une palette, le déplacement
sur canevas des points `x1/y1/x2/y2` ou la conversion d'un dégradé existant.
Les valeurs inconnues dans le reste du fichier ne sont pas re-sérialisées.

## Preuves et vérifications

- `tests/svg-gradient-create.test.mjs` : patches exacts, nouveau `defs`,
  dégradés linéaire/radial, ids uniques, inversion, refus typés.
- `tests/browser/specs/gradient.mjs` : action réelle dans l'inspecteur,
  sauvegarde Host, dégradé sélectionnable et Undo sur disque.
- `npm run check` / `npm run test:browser` : vérifier les résultats
  **sur le SHA candidat**, et ne pas transformer une CI en cours en PASS.
- `npm run test:dsh` : **NOT_RUN pour cette nouvelle fonctionnalité** ;
  validation Web et Desktop à réaliser avant toute revendication de release.

La référence graphique demeure
[`DSH-Design-Studio-V3-Graphite-interactive.html`](../design/DSH-Design-Studio-V3-Graphite-interactive.html).

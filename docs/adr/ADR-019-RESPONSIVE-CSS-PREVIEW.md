# ADR-019 — Aperçu responsive avec projection CSS bornée

**Date :** 17 novembre 2026 · **Statut :** expérimental, testé par simulation Host/React seulement · **Issues :** #11 et #13.

## Problème

L'alpha.18 sait associer des éléments HTML à des règles CSS de fichiers locaux, mais n'affiche pas ces styles externes dans l'iframe. Charger aveuglément les feuilles depuis le système de fichiers ou les injecter directement risquerait d'exposer des directives CSS externes, des `url()`, des `@import` et des changements de cascade incompris. Nous avons besoin d'un aperçu utile sur plusieurs largeurs **sans attribuer à tort un style calculé**.

## Décision pour l'alpha.19

1. **Largeurs de prévisualisation :** quatre modes manuels du canevas HTML, Auto (100 % de la surface disponible), Bureau (1280 px), Tablette (768 px), Mobile (390 px). La largeur est appliquée à l'iframe dans un conteneur défilable horizontalement ; un `meta viewport` explicite est présent dans le document de prévisualisation. Aucune modification du HTML ou du CSS n'est déclenchée par un changement de mode.
2. **CSS autorisé seulement :** nouveau module `src/html-responsive-preview.mjs`, opérant sur les **règles simples déjà analysées** par `listCssVisualRules`, reconnues par `#id` ou `.classe` et associées aux ID/classes sources. Seules les déclarations dont la propriété et la valeur respectent la liste strictement autorisée de `HTML_STYLE_PROPERTIES` sont émises.
3. **Interdictions :** aucune règle `@import`, `@media`, `@supports`, règle imbriquée, sélecteur composite, variable dynamique ou valeur comportant `url(...)` ; aucune feuille source complète n'est injectée. La projection est **bornée à 24 KiB**, y compris les séparateurs et les différentes feuilles.
4. **Construction :** le Host lit les feuilles déjà validées via `createNativeFileStore.read` (contrôles de chemins/symlinks), assemble le sous-ensemble CSS puis renvoie `previewCss` et `previewCoverage` (comptages des déclarations projetées/ignorées et limite atteinte). Le client impose à nouveau un plafond et refuse les caractères susceptibles de fermer une balise `<style>`.
5. **Encapsulation :** le client insère la projection dans une balise `<style data-dsh-preview-subset="partial">` de son `srcDoc`, tout en conservant la CSP et le modèle `allow-same-origin` **sans `allow-scripts`** décrit par ADR-017. L'édition du HTML/du CSS conserve les opérations natives révisionnées et l'historique Undo/Redo existants.
6. **Transparence UX :** le panneau affiche systématiquement **« Aperçu partiel »**, les déclarations incluses/ignorées et le mode de largeur. Les styles sources non pris en charge peuvent encore influencer un vrai navigateur et ne sont pas interprétés comme absents.

## Limites et risques non résolus

- Cette projection CSS **n'est ni un calcul de cascade, ni un rendu CSS complet**. La spécificité indicative, l'héritage, les priorités, le `!important`, les media queries de fichiers externes et les composants dynamiques ne sont pas résolus ; la représentation pourrait diverger du navigateur final.
- Les styles `<style>` et les attributs inline du document source sont conservés dans l'iframe (sous CSP). Les risques HTML/CSS hostiles restent soumis à l'**audit en vrai navigateur** de l'ADR-017.
- Les largeurs d'iframe changent la surface CSS dans les navigateurs compatibles, mais **aucune preuve de rendu pixel-perfect ou de `getComputedStyle`** n'a été obtenue dans DSH Desktop/Web.
- Ne jamais ajouter `allow-scripts` à l'iframe same-origin sans revoir complètement la frontière de confiance.
- Les documents avec plusieurs feuilles CSS ou des sélecteurs complexes ne voient qu'un **sous-ensemble**, dans l'ordre des liens admissibles, sans garanties de priorité effective.

## Critères d'acceptation et preuves

- CI Node 22 : module de projection avec exclusions et limite 24 KiB ; test Host→fichiers temporaires ; tests React simulés pour les quatre largeurs, CSP/sandbox, absence de sauvegarde, warnings CSS. Voir `docs/experiments/ALPHA19-EVIDENCE.md`.
- **À exécuter pour promouvoir G0/G2/G4 :** DSH Desktop/Web, rendu Chromium+Firefox avec captures à 390/768/1280, HTML/CSS hostile, interactions au pointeur et au tactile, comparaison du CSS calculé avec une page réelle, tests de réseau sous CSP, accessibilité clavier et stabilité des rechargements d'iframe.
- Le stockage natif face à un éditeur externe non coopératif reste un chantier séparé (G1).

**G0 NOT_RUN · G1 PARTIAL · G2 PARTIAL · G4 PARTIAL. PR #8 DRAFT. Aucune release.**

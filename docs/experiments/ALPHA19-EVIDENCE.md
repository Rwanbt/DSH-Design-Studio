# DSH Design Studio — Alpha 0.1.0.19 · Aperçu responsive et CSS local filtré

**Date :** 17 novembre 2026 · **Statut :** expérimental, PR #8 en brouillon vers `dev`, aucune publication.

## Preuve exécutée

- **Commit de code testé :** `e40daa813bedda34284b30d77e57eecd6216de1a`.
- **GitHub Actions :** [run 43991894012](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/43991894012).
- **Commande :** `npm run check` (Node.js 22, contrôles syntaxiques et `node --test tests/*.test.mjs`).
- **Sortie réelle vérifiée : 259 tests, 259 PASS, 0 FAIL, 0 SKIP, 0 TODO**.
- La première run alpha.19 (43991750030) présentait **257 PASS, 2 FAIL** : une fixture HTML trop restrictive et un dépassement du plafond CSS par les séparateurs de règles. Ces deux erreurs ont été corrigées et la suite complète a ensuite réussi sur le SHA ci-dessus.
- **Ce ne sont pas des captures ni des tests de rendu navigateur :** l'interface est exercée avec React/DOM simulés et le Host via fichiers temporaires sur Linux GitHub Actions.

## Fonctionnalités intégrées

### Prévisualisation HTML responsive

- Toolbar de l'aperçu : **Auto, Bureau 1280 px, Tablette 768 px, Mobile 390 px**.
- Largeur réglée sur l'iframe HTML dans une zone de défilement horizontal, sans écriture sur le fichier source.
- Métadonnée `<meta name="viewport" content="width=device-width, initial-scale=1">` ajoutée dans le `srcDoc` de prévisualisation.
- L'iframe HTML maintient `sandbox="allow-same-origin"` **sans `allow-scripts`**, et la CSP restrictive existante.

### Rendu partiel des feuilles CSS locales

- Nouveau `src/html-responsive-preview.mjs` : projection **strictement limitée** à des sélecteurs simples `#id` et `.classe` déjà reconnus, avec une propriété et une valeur conformes à la liste conservatrice de l'éditeur manuel.
- Aucun original CSS complet inséré. Les directives `@import`, `url(...)`, `@media`, sélecteurs imbriqués ou composites, propriétés non validées et valeurs complexes ne sont pas émis dans cette projection.
- Taille totale plafonnée à **24 KiB** en comptant les séparateurs entre règles et feuilles.
- Le Host fournit `previewCss` et `previewCoverage`, avec nombre de déclarations incluses/ignorées et indicateur de troncature.
- Le client filtre à nouveau la taille et les caractères dangereux avant de construire sa balise `<style data-dsh-preview-subset="partial">`.
- Texte d'avertissement explicite : **« Aperçu partiel · CSS locaux simples uniquement (pas de cascade calculée) »**.
- Enregistrement, lecture, navigation HTML↔CSS et Annuler/Rétablir continuent à utiliser les préconditions natives `baseHash` et `baseIdentity`, sans IA.

## Vérifications supplémentaires de la CI

1. Projection des seules propriétés CSS autorisées, sans conserver un `background-image:url(...)`.
2. Refus des sélecteurs non supportés, doublons, règles imbriquées et propriétés non autorisées.
3. Borne de taille 24 KiB respectée dans un stylesheet extrême, y compris les séparateurs ; absence de dépassement multi-feuille.
4. Host HTML → CSS local → représentation filtrée, avec source HTML et CSS restée byte-identique.
5. Refus de projection des liens conditionnels (ex. `media="print"`) et externes.
6. Client simulé : choix des quatre formats, largeur exacte de l'iframe et non-modification du fichier.
7. CSP `script-src 'none'`, `connect-src 'none'`, absence de `allow-scripts` et avertissement de couverture partielle.
8. Régression totale des éditeurs SVG, HTML et CSS, concurrence des sauvegardes et Undo.

## Limites : ne pas sur-promettre

- **NOT_IMPLEMENTED :** cascade réelle (sélecteurs complexes, héritage, `!important`, priorités, variables, at-rules, média externes), rendu pixel-perfect, calcul `getComputedStyle` et édition visuelle complète des layouts Flexbox/Grid.
- **NOT_RUN :** fonctionnement iframe/CSP et media queries dans Chromium/Firefox, DSH Desktop/Web, souris/tactile/mobile physique, audit sécurité HTML/CSS hostile, Windows/macOS, réseau/NFS et tolérance à la coupure de courant.
- **P0 non validé :** la sécurité du stockage contre un éditeur externe non coopératif ne bénéficie pas d'un CAS atomique universel ; le modèle same-origin sans scripts d'ADR-017 exige toujours un audit.
- **Le simple passage des tests ne valide pas la fidélité d'un rendu navigateur**, qui exige captures et tests E2E réels.

## Traçabilité

- [ADR-019 — Aperçu responsive et projection CSS](../adr/ADR-019-RESPONSIVE-CSS-PREVIEW.md)
- [ADR-018 — Correspondances HTML/CSS candidates](../adr/ADR-018-HTML-CSS-CANDIDATE-MAPPING.md)
- [ADR-017 — Frontière de confiance iframe](../adr/ADR-017-HTML-PREVIEW-CLICK-SELECTION.md)
- [Matrice G0–G5](../roadmap/DELIVERY-GATES-2026-11-17.md)
- Ticket **#11** : cascade & responsive, toujours ouvert. Ticket **#13** : UX mobile, toujours ouvert.

**PR #8 DRAFT vers `dev`; aucune fusion dans `main`, aucun tag et aucune release.**

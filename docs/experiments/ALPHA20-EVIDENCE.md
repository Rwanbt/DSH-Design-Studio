# DSH Design Studio — Alpha 0.1.0.20 · Contrôles Flex/Grid et dock compact

**Date :** 17 novembre 2026 · **Branche :** `feat/native-file-persistence` · **PR #8 :** DRAFT vers `dev` · **Aucune release, aucun tag ni merge.**

## Preuve réellement exécutée

- **Code et version testés au SHA :** `a88f340b8098cedef1a3e8847f37f320277aa237`.
- **GitHub Actions :** [run 43993385351](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/43993385351).
- **Commande :** `npm run check` sous Node.js 22 (vérification des fichiers sources, puis `node --test tests/*.test.mjs`).
- **Sortie observée dans le job CI : 269 tests / 269 PASS / 0 FAIL / 0 SKIP / 0 TODO.**
- Un premier lot (run 43993009308) a produit **267 PASS / 1 FAIL**, lié à un test pensant que le réglage Grid était visible en mode Block alors que l'UI le cache volontairement. Corrigé et revalidé, puis ajout d'un test Grid complet et validation sur le SHA ci-dessus.
- Les tests React utilisent un **harness simulé** ; les tests API/écritures font de vraies opérations dans des dossiers temporaires Linux de GitHub Actions. **Ni rendu navigateur ni DSH réel n'ont été validés.**

## Réalisé

### Inspecteur visuel Flexbox / Grid

- Préréglages accessibles pour les éléments HTML à ID source unique **et** les règles CSS externes simples `#id` / `.classe`.
- `display` : Flex / Grid / Block ; Flex : `flex-direction`, `justify-content`, `align-items` ; Grid : `grid-template-columns` (1, 2, 3 ou 4 colonnes) et `grid-auto-flow` (row/column) ; espacement `gap` commun.
- `grid-template-columns` limité côté serveur aux valeurs `1fr` ou `repeat(N, minmax(0, 1fr))`, N=2,3,4. Aucune valeur libre n'est injectée par ces boutons.
- Chaque geste déclenche une unique transaction `html-style` ou `css-rule` déjà sécurisée par `baseHash` et `baseIdentity`, son verrou coopératif et son patch exact inverse. Les valeurs de source HTML/CSS sont conservées hors plage ciblée. L'historique Undo/Redo reste actif.
- Si un brouillon source n'est pas enregistré, si une opération est en cours ou si le mapping n'est pas fiable, les préréglages sont désactivés ou absents. Un groupe réservé à Flex ou Grid n'est pas proposé de façon trompeuse en mode incompatible.

### Adaptation du panneau à sa largeur réelle

- L'UI graphite contient maintenant une navigation **Calques / Canevas / Propriétés** à un seul panneau visible quand le **conteneur DSH** devient inférieur à environ **750 px**.
- `container-type:inline-size` et `@container` évitent de dépendre uniquement de la largeur globale du navigateur.
- Le canevas est sélectionné par défaut en mode compact. Au-dessus du seuil, les trois panneaux habituels restent visibles ; une largeur intermédiaire réduit leurs dimensions.
- L'interface utilise des rôles `tablist` / `tab` et expose `aria-selected`. La navigation manuelle entre panneaux ne sauvegarde **aucun** fichier et n'appelle aucune IA.

## Scénarios couverts

1. HTML inline Grid : changement du `display` native, refus d'un groupe Flex incompatible, rechargement, Undo exact.
2. CSS externe : sélection d'une règle, changement vers Flex, écriture sur disque, vérification du `baseIdentity`, Undo exact.
3. CSS externe : passage de Block à Grid, activation de préréglages, enregistrement de deux colonnes, Undo de la dernière modification.
4. Préservation de la source pour tous les préréglages et validation des grilles 1/2/3/4 colonnes ; refus des URLs, `var()`, CSS arbitraire ou concaténé.
5. Brouillon HTML/CSS non enregistré : aucune modification de disposition autorisée.
6. Interface compacte : présence du dock, sélection exclusive d'un panneau, absence de POST vers l'API lors de la navigation, présence de règles `@container`.
7. Régressions complètes des éditeurs SVG, HTML, CSS, grille/Plume, Undo/Redo, sécurité des fichiers et concurrence interprocessus.

## Limites majeures

- **NOT_IMPLEMENTED :** constructeur visuel Flex/Grid drag-and-drop, visualisation réelle de la cascade `getComputedStyle`, éditeur de breakpoints et règles `@media` / `@container` du projet, CSS avancé, sélection d'éléments HTML sans ID et synchronisation multi-fichiers atomique.
- **NOT_RUN :** installation DSH Desktop/Web, conteneur CSS responsive réel, tests sur smartphone et gestes tactiles, Firefox/Chromium, lecteurs d'écran, focus/tabulation complète, capture visuelle, performance gros documents.
- **G1 PARTIAL :** CAS universel face aux éditeurs externes et races de chemins non résolus.
- **G2 PARTIAL :** CSS réellement calculé et rendu de productions non validés ; iframe sandbox `allow-same-origin` sans scripts requiert audit navigateur réel (ADR-017).
- **G0 NOT_RUN :** tunnel de connexion au poste DSH indisponible. Aucun résultat de test simulé ne promeut ce gate.

## Traçabilité

- [ADR-020 — Outils Flex/Grid et dock compact](../adr/ADR-020-LAYOUT-PRESETS-AND-COMPACT-PANELS.md)
- [ADR-019 — Projection CSS responsive](../adr/ADR-019-RESPONSIVE-CSS-PREVIEW.md)
- [Matrice de livraison G0–G5](../roadmap/DELIVERY-GATES-2026-11-17.md)
- Tickets **#11** CSS/layout et **#13** UX/mobile : **OPEN/PARTIAL**.

**Conclusion : prototype fonctionnel supplémentaire uniquement dans le périmètre couvert par les tests. PR #8 DRAFT, pas de merge/tag/release.**

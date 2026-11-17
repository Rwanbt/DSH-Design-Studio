# ADR-020 — Préréglages Flexbox/Grid conservateurs et panneaux responsives

**Date :** 2026-11-17 · **Statut :** expérimental, alpha.20 · **Issues :** #11, #13.

## Contexte

Le moteur alpha.19 sauvegarde précisément les styles HTML inline et les valeurs de règles CSS simples, mais l'interface exigeait de saisir les propriétés à la main. Sur un panneau DSH étroit, les trois colonnes occupaient de plus trop de largeur malgré l'empilement CSS.

## Décision — outils de disposition manuels

- Conserver le modèle **source native unique** : un clic de préréglage produit **une seule** opération existante `html-style` ou `css-rule` à valeur validée, avec `baseHash`, `baseIdentity`, verrou coopératif, relecture et patch inverse exact. Aucune IA et aucun moteur de layout supplémentaire.
- `display` : `flex`, `grid`, `block`. En mode Flex, proposer direction, justification et alignement ; en mode Grid, nombre de colonnes et auto-flow ; dans Flex ou Grid, régler `gap`. Les groupes non adaptés sont masqués ou désactivés.
- Encadrer `grid-template-columns` : uniquement `1fr` ou `repeat(N, minmax(0, 1fr))` avec **N ∈ {2,3,4}**, sans variable, URL, expression, propriété CSS arbitraire ou délimiteur injecté. `grid-auto-flow` limité à `row` ou `column`. Ces propriétés passent dans la liste de validation côté **serveur** et la projection de CSS de l'alpha.19.
- Les valeurs des boutons reflètent les **déclarations sauvegardées** du nœud sélectionné ; aucune propriété calculée ni résolution de cascade n'est sous-entendue. Les boutons sont désactivés lorsque le document est occupé, en rechargement ou contient un brouillon source non sauvegardé. Les nœuds/règles ambigus restent non éditables.

## Décision — adaptation du panneau DSH

- Utiliser des **container queries CSS** sur la surface `.dsh-studio-workbench`, dont la largeur peut être différente de celle de l'écran.
- En largeur normale : conserver les trois panneaux latéraux existants et le canevas.
- Sous **750 px de largeur de conteneur**, montrer une barre **Calques / Canevas / Propriétés**, un seul panneau actif et une grille à une colonne. Le canevas demeure la vue active par défaut ; l'état de la vue est local à la session React.
- Entre les largeurs intermédiaires : réduire les largeurs minimales des panneaux avant de basculer en mode compact.
- Aucun changement de panneaux ne déclenche de sauvegarde, de reformatage HTML/CSS/SVG ou d'appel d'IA.

## Ce que cette décision ne résout pas

- Les controls **Flex/Grid ne sont pas un constructeur visuel complet de la cascade ou des breakpoints** : pas d'édition de `@media`, `@container` dans le fichier utilisateur, pas de matrice CSS, pas de placement interactif au pointeur, ni d'inspecteur de style réellement calculé.
- Le CSS externe peut imposer un `display` effectif différent des déclarations visibles dans l'inspecteur HTML. Les boutons indiquent le style déclaré dans la source choisie, **pas** la valeur calculée.
- Les interactions au doigt, l'accessibilité clavier/lecteur d'écran, le comportement réel des container queries dans DSH Web/Desktop et la fidélité des rendus restent **NOT_RUN**. Le panneau compact utilise des rôles `tablist`/`tab`, mais la navigation complète aux flèches et le focus management doivent encore être vérifiés et implémentés.
- La sécurité filesystem face aux logiciels externes non coopératifs et la frontière de confiance iframe d'ADR-017 demeurent ouvertes.

## Critères de preuve

- Suite CI Node : validation/refus du vocabulaire Flex/Grid, patches exacts et Undo, requêtes Host par fichiers temporaires, tests React simulés de l'état des boutons, des modes, des protections de brouillon et du dock compact.
- Tests **navigateur réel + DSH réel** requis avant promotion G0/G2/G4, avec captures à différentes tailles de panneau et tests clavier/tactile.

**G0 NOT_RUN · G1 PARTIAL · G2 PARTIAL · G4 PARTIAL. PR #8 DRAFT. Pas de release.**

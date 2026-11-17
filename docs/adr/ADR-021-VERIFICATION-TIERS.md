# ADR-021 — Trois niveaux de vérification, et ce que chacun prouve

**Statut :** accepté · **Date :** 17 novembre 2026 · **Contexte :** gates G0–G4, PR #8 déjà fusionnée.

## Contexte

Les preuves alpha (jusqu'à alpha.20) étaient **string-level ou React-simulées** : le bundle client n'avait jamais été exécuté par un navigateur, l'iframe `srcDoc`, le sandbox et la CSP n'avaient jamais été évalués par un moteur réel, et le plugin n'avait jamais été installé dans un vrai DeepSeek Harness. Le README et la matrice signalaient déjà cette limite, mais aucun mécanisme ne la mesurait.

Une première exécution réelle a immédiatement révélé deux défauts invisibles aux tests unitaires : l'`exports` map refusait `<package>/client.js` (le bundle n'était donc jamais servi, sans aucune erreur), et `dsh.client.inject` nommait un paquet inexistant. Aucun test existant ne pouvait les détecter.

## Décision

Toute promotion de gate cite le **niveau** de preuve atteint :

1. **Niveau 1 — module pur (`node --test`).** Fonctions `source → patch`. Prouve les invariants de texte : round-trip octet-exact, préconditions, refus typés. Ne prouve ni le DOM, ni le navigateur, ni le Host.
2. **Niveau 2 — navigateur réel + Host réel (`tests/browser`, `npm run test:browser`).** Chromium et Firefox exécutent le vrai `client.js` contre le vrai `createRouteHandler(ctx)` et un système de fichiers temporaire réel. **Seul** le shell DSH est simulé (module loader, `require('react')`, `ctx.slots`). Prouve : pointeur/clavier réels, DOM réel, iframes, CSP, sandbox, sauvegarde et Undo sur disque, accessibilité calculée, budgets de performance.
3. **Niveau 3 — DSH réel (`tests/e2e/real-dsh.mjs`, `npm run test:dsh`).** Binaire DeepSeek Harness installé, `dsh` CLI, `DSH_HOME`/`HOME` jetables, profil neuf, application Web réelle, session réelle, routes et sauvegarde réelles. Prouve l'installation, l'enregistrement du bundle et le comportement du Host dans le produit.

### Règles

- Un niveau ne remplace jamais le suivant : un PASS de niveau 1 ne prouve pas le niveau 2, un PASS de niveau 2 ne prouve pas l'installation réelle.
- Les environnements absents produisent **`NOT_RUN` explicite avec la raison**, jamais un succès. Si Playwright, un navigateur ou une installation DSH manque, le runner l'annonce et poursuit les autres vérifications.
- Chaque `NOT_RUN` documente **ce qui manque précisément** (par exemple : DSH ne rend pas la zone `conversation.view` pour une séance vide, et un tour exige un fournisseur LLM).
- Playwright, react et react-dom sont des `devDependencies` réservées aux tests : le plugin reste sans dépendance d'exécution et `npm run check` s'exécute sans installation.

### Simulation déclarée

Le shell du niveau 2 est un **substitut explicite** documenté dans `tests/browser/harness/shell.html` et dans l'en-tête de `host-server.mjs`. Il n'est jamais présenté comme DSH. Le profil du niveau 3 amorce un espace de travail enregistré, parce qu'un hôte sans interface ne peut pas ouvrir le sélecteur de dossier natif ; tout le reste est réel et chaque étape est rapportée séparément.

## Conséquences

- `npm run check` reste rapide et sans dépendance ; `npm run test:browser` et `npm run test:dsh` sont séparés et facultatifs.
- La CI exécute le niveau 1 sur Linux et Windows, et le niveau 2 (Chromium + Firefox) sur `ubuntu-24.04` épinglé, car Playwright n'installe ses navigateurs que sur les images qu'il prend en charge.
- Les rapports historiques (ALPHA*.md) restent des preuves datées de leur niveau d'origine ; ils ne sont pas réécrits.
- Une régression qui n'apparaît qu'au niveau 3 doit être verrouillée par un test de niveau 1 ou 2 lorsque c'est possible : l'`exports` map est désormais couverte par `tests/dsh-client-manifest.test.mjs`.

## Alternatives écartées

- **Tout tester en jsdom** : ne prouve ni CSP, ni sandbox, ni gestes pointeur, ni le moteur de rendu ; c'est précisément ce qui a masqué les défauts ci-dessus.
- **Uniquement des tests manuels dans DSH** : non reproductibles en CI, non chiffrables, et impossibles à exécuter sans session LLM.
- **Simuler le Host dans les tests navigateur** : aurait rendu les tests verts sur un Host fictif ; ici le vrai handler sert réellement les fichiers.

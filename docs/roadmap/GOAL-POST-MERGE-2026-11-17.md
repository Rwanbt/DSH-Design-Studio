# GOAL — DSH Design Studio · Après fusion dans dev · MVP fiable puis release candidate

**Date de référence : 17 novembre 2026** · **Dépôt :** https://github.com/Rwanbt/DSH-Design-Studio · **Branche de travail :** `dev`.

## Mission

Tu es l'orchestrateur technique autonome de DSH Design Studio dans DeepSeek Harness. Reprends le projet existant, sans repartir de zéro, et avance méthodiquement vers un **MVP réellement installable et utile en édition manuelle SVG/HTML/CSS**, puis vers une release candidate professionnelle. Tu peux mobiliser des agents spécialisés si cela fait réellement gagner du temps, mais tu es responsable de leur coordination, de l'intégration, des preuves et des limites.

La demande explicite du propriétaire : **ne conserver à distance que les branches `main` et `dev`**. Les 296 commits de la PR #8 ont été squash-fusionnés dans `dev` au commit `c2f17475ff7ea730cf543d4e3ee20a57a1f8a776`. La PR #8 est fusionnée, `main` n'a pas été modifiée. L'ancienne branche `feat/native-file-persistence` peut encore exister à distance ; **la supprimer proprement est la première opération de ce GOAL**. Les développements alpha.20 sont déjà présents dans `dev`. La dernière CI prouvée *avant fusion* : GitHub Actions run `43993595879`, source SHA `06ce20ecebf8dad657dd3834812e00236c2f4f3d`, commande `npm run check` sous Node 22 : **269 PASS / 0 FAIL / 0 SKIP**. Ce résultat n'est **pas** une preuve de test dans le vrai DSH.

## Phase 0 — Lecture, photographie et nettoyage Git (obligatoire avant tout développement)

1. Lire **`AGENTS.md`**, `README.md`, `docs/roadmap/DELIVERY-GATES-2026-11-17.md`, `docs/roadmap/IMPLEMENTATION-PLAN.md`, `docs/audits/SOURCE-MATRIX.md` et `docs/experiments/ALPHA20-EVIDENCE.md` ; lire aussi les ADR 0001–0003 et ADR-017 à ADR-020. Lire les tickets #1–#14 ouverts et les PR pertinentes. Les documents peuvent contenir des descriptions dépassées : comparer au code et au SHA réels.
2. Faire `git status --short`, `git remote -v`, `git fetch origin --prune`, `git branch -avv` et `git ls-remote --heads origin` ; identifier les SHAs courants de `main`, `dev` et de l'éventuelle ancienne branche. Ne jamais supposer qu'une branche, un fichier ou une capacité existe.
3. Se placer sur `dev`, mettre à jour exclusivement par fast-forward (`git switch dev`, `git pull --ff-only origin dev`). Refuser tout force-push, hard reset de travail non sauvegardé, rebase de `main` ou suppression d'historique non vérifiée. Si l'arbre local est sale, inventorier les changements et les préserver.
4. **Supprimer seulement l'ancienne branche fusionnée** si elle existe encore et si toutes les vérifications sont satisfaites :
   - PR #8 effectivement `merged` vers `dev` ;
   - contenu du commit de squash `c2f17475ff7ea730cf543d4e3ee20a57a1f8a776` identique à l'extrémité distante de `feat/native-file-persistence` : par exemple `git diff --exit-code c2f17475ff7ea730cf543d4e3ee20a57a1f8a776 origin/feat/native-file-persistence` doit réussir ; les historiques divergent normalement après un squash, **ne pas se fier à merge-base --is-ancestor** ;
   - alors seulement : `git push origin --delete feat/native-file-persistence`, `git fetch --prune` et vérifier `git ls-remote --heads origin`.
   - S'il existe une autre branche inattendue : **ne pas la supprimer** sans examen de son origine/contenu ; signaler ce cas.
   - Si authentification ou autorisation manquante : noter **BLOCKED**, donner la commande exacte à exécuter, continuer les autres tâches.
5. **À la fin de chaque jalon**, l'ensemble des branches *distantes persistantes* doit être exactement `main` et `dev`. Les branches temporaires ne sont admises que si la protection GitHub exige une PR : les créer pour une tâche, squash-merger vers `dev` après validation, puis les supprimer immédiatement. Ne jamais maintenir des `feat/*` persistantes.
6. Lancer **`node --version`** (Node ≥ 22) puis `npm run check` sur le nouveau HEAD `dev` ; enregistrer la commande, l'environnement, le code retour, le nombre exact de tests, les échecs/skip et le SHA. Ne pas transformer un SKIP/NOT_RUN en PASS. Noter qu'un simple PASS unitaire ne prouve pas le rendu de navigateur.

## Règles permanentes et architecture

- **Le SVG, le HTML et le CSS réels restent les sources canoniques.** Ne pas convertir silencieusement le document complet en JSON, ne pas re-sérialiser/reformater le code pour une petite opération. Patches ciblés, inverses exacts, provenance de chaque écriture, contrôle de révision `baseHash` **et** `baseIdentity`, annulation, gestion des conflits avec source externe.
- **Éditeur manuel indépendant de l'IA** : créer, sélectionner, manipuler, éditer, sauvegarder, Annuler/Rétablir sans clé LLM, token ou fournisseur. Les agents éventuels réutiliseront les mêmes APIs transactionnelles en fin de plan.
- Les sources SVG/HTML/CSS, le navigateur et les chemins du workspace sont **non fiables**. Aucune exécution du JavaScript du document, requête réseau non autorisée, lecture hors workspace, écrasement silencieux, contour de sécurité par simplification ou auto-promotion d'un gate. Prendre particulièrement en compte ADR-017 : `sandbox="allow-same-origin"` **sans** `allow-scripts`, avec CSP stricte ; auditer ce choix **en navigateur réel**, pas seulement en simulateur.
- **Pas de dépendances lourdes sans justification** : vérifier licence, NOTICE, provenance du code, API, sécurité, maintenance, coût CPU/RAM et compatibilité DSH avant installation. Privilégier des composants testables et une interface Graphite intégrée à DSH.
- **Branches** : `main` est stable et intouchable sans approbation explicite du propriétaire. `dev` reçoit les améliorations testées. Pas de tag, release ou publication npm avant GO/NO-GO explicite.
- **Multi-agents possibles** : Orchestrateur, responsable intégration DSH, responsable sécurité fichiers, éditeur SVG, éditeur web CSS/HTML, UX/accessibilité, tests/CI, reviewer indépendant. Assigner des sous-ensembles de fichiers disjoints, un propriétaire par fichier pendant une modification, sérialiser les commits, faire des revues croisées. **Éviter les worktrees et les modifications simultanées du même fichier**. Ne pas recréer une arborescence de branches permanentes pour les agents.
- **Optimiser les tokens** : explorer les fichiers pertinents, produire des synthèses courtes et citables, ne pas faire de revues générales répétitives. Utiliser un reviewer plus coûteux uniquement pour les décisions d'architecture, les risques système, les cas difficiles ou la validation d'un gate. Continuer les chantiers disponibles si un outil ou modèle est indisponible.
- Pour chaque jalon : petit plan d'exécution, code réel, tests unitaires + intégration + E2E selon le gate, revue, correction, commit atomique, mise à jour du ticket/de l'ADR/de la matrice et de la preuve. Les commits de `dev` doivent rester lisibles. Ne pas confondre la réussite d'une CI avec l'absence de dette technique.

## Ordre d'exécution — réduction des risques avant expansion fonctionnelle

### G0 · P0 — Installer et tester dans le DSH réel

1. Inventorier le manifeste `cordis.patch.yml`, `src/plugin-host.mjs`, `client.js`, les APIs DSH/Cordis présentes, le chargement des assets, routes/session/workspace, et les versions du DSH réellement installées et accessibles.
2. Créer une procédure **reproductible et non destructive** d'installation/test dans un profil DSH de développement jetable. Capturer les versions OS/DSH/Node, les commandes, le SHA et les logs. Ne pas installer sur le profil principal sans contrôle.
3. Tester le lancement réel du plugin, l'onglet/panneau, l'ouverture et la sauvegarde de vrais SVG, HTML et CSS, la Plume, la sélection, zoom/pan, guides, inspecteurs, Undo/Redo et réouverture ; tester aussi le mode **sans IA**.
4. Ajouter des tests E2E navigateur réalistes (au moins Chromium et Firefox si possible) pour événements pointeur, DOM, sélection HTML, CSP/sandbox, sauvegardes et source-preserving Undo. Simuler uniquement les parties auxquelles l'environnement ne donne pas accès, et distinguer clairement simulé/réel.
5. Si DSH réel est inaccessible : laisser **G0 = NOT_RUN/BLOCKED**, conserver un smoke-test automatisé maximal et une checklist très précise pour le propriétaire ; **continuer G1–G4**, sans prétendre que G0 est validé.

### G1 · P0 — Stockage et protection contre la perte de données

1. Auditer le flux complet de `src/native-file-store.mjs`, `src/native-write-lock.mjs`, `src/native-patch.mjs` et du routeur Host : paths, symlinks/hardlinks, remplacement de parents, fichiers temp, `fsync`, locks persistants, crash avant/après rename, conflits de contenu et d'identité.
2. Tester la concurrence avec **des processus externes non coopératifs**, le remplacement de fichier à octets identiques, les modifications pendant l'attente d'un verrou, les erreurs de stockage et la récupération après arrêt brutal. Ajouter de vrais tests multi-processus, fault injection et garanties de conservation des données.
3. Distinguer verrous *coopératifs* et vrai compare-and-swap atomique. Étudier les primitives adaptées à Linux/Windows (et macOS si CI disponible), ou adopter une stratégie conservatrice de refus/rechargement lorsque la garantie forte n'existe pas. Ne jamais certifier un CAS universel sur la seule base des vérifications de chemins Node.
4. Ajouter CI Linux + Windows, au minimum, sans désactiver des tests devenus rouges ; garder les particularités POSIX/Windows sous tests séparés et honnêtes. Définir l'expérience de conflit/reload et la protection de l'historique.

### G2 · P1 — Édition web complète et sécurisée

1. Construire une sélection DOM↔source fiable **au-delà des seuls ID simples**, sans sacrifier la préservation des octets. Définir une stratégie pour les IDs dupliqués, HTML malformé, classes, CSS de frameworks, composants et nœuds dynamiques ; lecture seule si ambigu. Permettre l'édition visuelle sûre de texte, attributs simples, disposition.
2. Pour le CSS, remplacer progressivement le scanner conservateur par une architecture source-mapping testée : sélecteurs complexes, provenance des déclarations, cascade, spécificité, héritage, `!important`, variables, `@media`/breakpoints. Distinguer style **déclaré**, **calculé**, et source effectivement modifiable ; ne pas déduire automatiquement des informations sans moteur navigateur.
3. Conserver la sécurité actuelle du `srcDoc` (ADR-017–019). Réaliser un audit hostile HTML/CSS **dans de vrais navigateurs**, avec navigation, requêtes réseau, attributs dangereux, scripts, fichiers externes, iframe, sandbox et CSP. Si l'architecture same-origin ne tient pas, proposer une alternative formellement cadrée et testée avant d'ouvrir plus de capacités.
4. Étendre les contrôles manuels Flex/Grid : flex-wrap, justify/align, basis/grow/shrink, grid tracks/gaps/placement, positionnement responsable, breakpoints et responsive ; chaque action doit disposer d'un patch source, d'une précondition de révision et d'un Undo. Tester la fidélité de l'aperçu responsive à 390/768/1280 px dans de vrais navigateurs. Les valeurs CSS arbitraires restent refusées si le parseur ne peut pas les protéger.

### G3 · P1 — Moteur SVG vectoriel professionnel

1. Implémenter sélection multiple, groupes/sous-groupes, calques hiérarchiques avec ordre/visibilité/verrouillage, déplacement/rotation/échelle autour d'un pivot et matrices/transformations imbriquées, avec tests de géométrie et source inchangée hors plages.
2. Compléter les chemins : absolu/relatif, commandes smooth/arcs, topologie, modes de tangente Angle/Lissé/Symétrique et réédition des segments sans les convertir destructivement.
3. Ajouter progressivement gradients, clipping/masques, styles, typographie et opérations booléennes **après évaluation des bibliothèques/licences**. Conserver `defs`, IDs, namespaces et éléments SVG non gérés ; ne pas prétendre qu'une opération partielle est complète.
4. Tests de fixtures SVG externes, round-trip, coordonnées, rendu de comparaison et cas inconnus ; tests utilisateur réels de la Plume et des poignées avant fermeture du gate.

### G4 · P1 — UX Graphite, mobile, accessibilité et performance

1. Auditer le panneau V3 Graphite actuel, les container queries, le dock Calques/Canevas/Propriétés, les largeurs d'iframe et les contrôles de zoom. Garder l'esthétique DSH sans surcharge visuelle.
2. Réaliser interactions tactiles (pan, pinch, drag, sélection, poignées), tablette/smartphone, focus, tabulation/flèches, ARIA, réduction des animations, messages de conflit et menus contextuels. **Ne pas considérer des attributs ARIA seuls comme preuve d'accessibilité.**
3. Tests E2E et captures sur plusieurs tailles, régressions clavier, pointer, Firefox/Chromium, fonctionnement Android si environnement disponible.
4. Définir des budgets mesurables à partir de vrais profils sur documents volumineux (temps d'ouverture, mémoire, réactivité, sauvegarde) ; optimiser sans dégrader la qualité des sources.

### G5 · P2 — IA facultative, puis packaging/release candidate

1. Seulement lorsque les bases manuelles sont fiables, fournir des tools aux agents qui appellent les mêmes opérations de source, avec identités de révision, provenance, diff visible et validation humaine avant sauvegarde.
2. Gérer agent/agent et humain/agent : conflits explicites, permissions, audit, annulation, limites de ressources, pas d'accès aux secrets/fichiers hors workspace.
3. Préparer licence/NOTICE/SBOM, packaging du plugin, matrice OS/navigateurs/DSH, migrations/rollback, tutoriel utilisateur, documentation d'installation, checklist sécurité et procédure de release candidate.
4. Construire un rapport GO/NO-GO. Une release et un merge dans `main` nécessitent **l'accord explicite du propriétaire et des gates pertinents réellement passés**.

## Backlog et système de preuves

- Maintenir `docs/roadmap/DELIVERY-GATES-2026-11-17.md` comme source de vérité des gates **G0 à G5**, avec états `PASS / PARTIAL / BLOCKED / NOT_RUN / FAIL`, lien vers les commits et sorties de test.
- Mettre à jour les tickets GitHub **#1–#14** : fermer seulement sur preuves ; établir dépendances et priorités, éviter doublons ; documenter les critères de sortie et problèmes encore ouverts.
- Conserver les ADR existantes et en créer uniquement pour les nouveaux arbitrages importants. Préserver les rapports alpha historiques comme preuves à leur date, sans les réécrire pour affirmer qu'ils ont été testés dans DSH réel.
- Ajouter un rapport court par session ou jalon sous `docs/operations/` : baseline HEAD, changements, fichiers, commandes, SHA, nombre tests PASS/FAIL/SKIP, niveau de test (unitaire/Host simulé/navigateur réel/DSH réel), risques, tickets, décision GO/NO-GO, prochaine action.
- Optionnel : s'il existe un vault Obsidian lié au projet et accessible, y reporter le même résumé, sans bloquer la progression si inaccessible.

## Autonomie et conditions d'arrêt

**Ne me demande pas confirmation entre les tâches normales et ne t'arrête pas après une seule correction ou une seule alpha.** Priorise les risques majeurs, réalise les phases compatibles en parallèle sous contrôle, corrige les bugs et réexécute les validations. Si un environnement manque (DSH réel, Windows, navigateur, permission GitHub), consigne précisément le blocage et avance les autres chantiers ; ne jamais inventer un PASS. Si une opération destructrice n'est pas couverte par cette autorisation explicite (suppression d'une autre branche, modification de `main`, publication), ne l'exécute pas.

À chaque étape communique une synthèse courte : **ce qui a changé réellement**, **SHA + tests exécutés et sorties**, **gates validés ou bloqués**, **tâches suivantes**. Objectif final : une branche `dev` cohérente, seulement `main` + `dev` sur le remote, un éditeur SVG/HTML/CSS manuel fiable et réellement testé, et une décision documentée sur la publication — sans dette cachée ni affirmation de production-ready prématurée.

**COMMENCE MAINTENANT : Phase 0, vérification du squash, suppression sûre de l'ancienne branche, puis tests sur `dev` et traitement de G0/G1.**
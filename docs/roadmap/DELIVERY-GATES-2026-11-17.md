# DSH Design Studio — Matrice de livraison et de couverture

**Mise à jour :** 17 novembre 2026 · **branche :** `feat/native-file-persistence` · **PR :** #8 (DRAFT vers `dev`).

**Règle de lecture :** un test unitaire ou une simulation du Host n'est pas un test dans l'application réelle. Un sous-ensemble fonctionnel implémenté n'implique pas que tout le chantier soit terminé. Les preuves du dernier jalon sont dans `docs/experiments/ALPHA20-EVIDENCE.md` ; les décisions de sécurité, rendu partiel et disposition figurent dans ADR-017 à ADR-020.

## 1. État observable et découpage du travail

| Chantier | Implémenté et vérifié automatiquement | Non implémenté ou seulement partiel | Gate |
|---|---|---|---|
| **P0 · DSH Host/Client** | Enregistrement simulé, routes natives, viewport React simulé, isolation de prévisualisation | Installation réelle dans DSH Web/Desktop, compatibilité versions, capture et gestes réels | **BLOCKED / NOT_RUN** |
| **P0 · Données natives** | SVG/HTML/CSS en source canonique, patches exacts, inverses, SHA et identity obligatoires, verrou coopératif entre processus, tests de remplacement | CAS universel face aux éditeurs externes, confinement fort via descripteurs OS, crash/power-loss, NFS/SMB, tests Windows/macOS | **PARTIAL** |
| **P1 · HTML visuel** | Identification des éléments à ID unique, styles inline conservateurs et première sélection au clic dans un iframe sans scripts (test React simulé) | Validation réelle des iframes/CSP, DOM↔source robuste, texte/attributs, composants dynamiques, formulaires, breakpoints CSS éditables et responsive avancé | **PARTIAL** |
| **P1 · CSS externe** | Alpha.16 : édition ciblée de règles uniques `#id`/`.classe` de CSS ; Alpha.18 : correspondances **possibles** HTML↔CSS locaux, navigation + Undo ; Alpha.20 : préréglages natifs Flex/Grid validés et annulables | Cascade CSS réelle (la projection locale filtrée alpha.19 n'est qu'un sous-ensemble), gestion des sélecteurs complexes, `@media`, variables, CSS Modules, édition multi-fichiers atomique | **PARTIAL** |
| **P1 · SVG manuel** | Formes primitives, sélection, déplacements, texte simple, calques feuille, outil Plume, M/L/Q/C/Z explicites, grille, guides et points Bézier | Groupes, transformations composées, arcs/relatif, tangentes lissées/symétriques, masques, dégradés, effets, opérations booléennes | **PARTIAL** |
| **P1 · Ergonomie** | Structure V3 Graphite, contrôles clavier/souris simulés, quatre largeurs HTML, aperçu CSS filtré et dock à un panneau via container queries en simulation | Vérification UI réelle, sélection graphique précise, accessibilité, mobile, pinch, gros projets, thèmes | **PARTIAL / NOT_RUN** |
| **P2 · Agent humain/IA** | Protocole de modifications natives réutilisable par l'interface manuelle | Outils exposés aux agents, diffs/approbation, provenance, orchestration et conflits multiagents | **NOT_IMPLEMENTED** |
| **P3 · Release** | CI Node 22, tests de sources et de fichiers temporaires, PR isolée | Tests OS/browser/DSH, SBOM et licences, installateur, rollback, documentation opérateur et vérification de sécurité indépendante | **NOT_RUN** |

## 2. Ordre de livraison (critères vérifiables)

### Gate G0 — Installer et utiliser l'alpha dans DSH (bloquant pour MVP)
1. Faire un build/install dans un profil DSH de développement **jetable**, en notant DSH version, OS, commande, logs et SHA.
2. Vérifier que le tab s'affiche, que les trois formats se chargent, que les routes Host sont joignables et que l'interface fonctionne sans credentials IA.
3. Ouvrir des documents réels et tester sauvegarde, relance, Annuler/Rétablir, sauvegarde concurrente, zoom, pan, Plume et sélection au pointeur.
4. Contrôler captures desktop et mobile ; relever anomalies. **Pass = preuves réelles**. Situation actuelle : **NOT_RUN (connexion au poste indisponible)**.

### Gate G1 — Stockage sans perte silencieuse
1. Mettre au point une stratégie multi-OS de résolution des chemins par descripteurs; auditer symlinks, renommages, fichiers temporaires et scénarios de crash.
2. Tester Windows 11, Linux et au moins un stockage distant si nécessaire. Conserver les données originales pour toutes les erreurs/interruptions.
3. Test de concurrence entre plugin et processus externe non coopératif. Ne pas appeler le mécanisme actuel « CAS universel ».
4. Obtenir les rapports de mutation/rollback et comparer les SHAs. **Actuellement PARTIAL**.

### Gate G2 — HTML/CSS utilisable de manière visuelle
1. Sélection **directe** dans un `iframe sandbox` sans exécuter le JavaScript du document. **Prototype alpha.17 :** parent DSH lit le DOM d'un `srcDoc` avec `allow-same-origin` mais sans `allow-scripts`, avec garde session/fichier/identité, ID source unique et DOM unique. Cette décision d'architecture est explicitée dans ADR-017 ; **tests réels navigateur/XSS restent NOT_RUN**. Toute alternative avec pont `postMessage` doit être authentifiée (origine/source/session/document/révision/nonce) et revue séparément.
2. Relier explicitement l'élément HTML aux règles CSS locales. **Prototype alpha.18 :** références locales sûres, sélecteurs simples `#id`/`.classe`, fichier, spécificité indicative, navigation vers la feuille et sauvegarde native ; **aucune cascade effective ni style calculé**. ADR-018 ; analyse complète et tests navigateur toujours NOT_RUN.
3. Modifier propriétés, texte/attributs simples, Flex/Grid et breakpoints en conservant les fichiers HTML/CSS octet pour octet hors plages choisies.
4. Tests de fichiers réels + navigateur réel ; `@media`/complexité inconnue toujours refusés sans avertissement trompeur. **Actuellement PARTIAL**.

### Gate G3 — SVG vectoriel robuste
1. Supporter transformations, groupes et multi-sélection ; déduire la géométrie réellement affichée et préserver `defs`, namespaces et éléments inconnus.
2. Étendre les chemins (relatifs/arc/smooth), tangentes Angle/Lissé/Symétrique, plume et sélection exacte.
3. Ajouter calques structurés, verrouillage/visibilité, gradient, clipping/masques et opérations booléennes via adaptateur choisi et audité.
4. Fixtures SVG externes, comparaisons visuelles et non-régression des sources. **Actuellement PARTIAL**.

### Gate G4 — UX, accessibilité et performance
1. Finaliser V3 Graphite : panneau contextuel, barres rétractables, état de travail, erreurs, actions cohérentes.
2. Adapter réellement mobile/tactile, tester clavier/focus, lecteur d'écran et dimensions d'écran.
3. Budgets de performance et mémoire sur gros SVG/HTML/CSS, sans dépendance de modèle IA.
4. Vérification des scénarios d'édition réels, pas seulement tests du DOM React simulé. **Actuellement NOT_RUN**.

### Gate G5 — IA facultative, puis release candidate
1. Fournir aux agents les mêmes commandes validées et préconditions de révision que l'UI.
2. Approbation/diff/annulation explicites pour les modifications IA, sans secrets transférés.
3. Audit licences/NOTICES, SBOM, packaging DSH Web/Desktop, migration/rollback, release checklist et GO/NO-GO.
4. Aucun tag, release, merge `main` tant que les gates G0–G4 pertinents sont ouverts.

## 3. Critères permanents

- **Source canonique :** pas de conversion silencieuse SVG→JSON ou HTML→DOM sérialisé. Édition conservatrice si mappage ambigu.
- **IA optionnelle :** édition manuelle complètement fonctionnelle hors ligne et sans tokens.
- **Sécurité :** un `SKIP`/`NOT_RUN` n'est jamais un `PASS`; refus des sources externes dangereuses, des éléments ambigus et des conflits.
- **Preuves :** chaque promotion de gate cite la commande, l'output complet ou résumé exact, un SHA testé, un OS et une version DSH lorsque pertinente.
- **Ordre :** **G0 + G1** avant de qualifier l'application de MVP stable ; développement de **G2/G3** peut se faire sur branche expérimentale mais ne doit pas masquer ces deux bloqueurs.

## 4. Prochaine séquence de développement proposée

- **Alpha.16 (branche actuelle)** : styles CSS externes simples, tests exacts et états read-only.
- **Alpha.17 (prototype implémenté)** : clic HTML direct via accès DOM par le parent dans iframe sans scripts (ADR-017) ; tests React simulés PASS, tests navigateurs réels/sécurité NOT_RUN. La stratégie par messages demeure une option non implémentée.
- **Alpha.18 (prototype implémenté)** : liens HTML→CSS locaux et correspondances indicatives avec navigation vers un inspecteur de feuille native ; cascade, rendu CSS externe et calcul des styles non implémentés.
- **Alpha.20 (préréglages et dock implémentés)** : boutons Flex/Grid pour HTML/CSS avec whitelist côté serveur et Undo exact ; interface compacte via container queries avec onglets. Validation React simulée PASS, DSH et gestes mobiles réels NOT_RUN. Le constructeur complet et les media queries éditables restent NON IMPLÉMENTÉS (ADR-020).
- **Alpha.19 (projection partielle implémentée)** : quatre largeurs d'iframe + projection CSS locale conservatrice et bornée (ADR-019) ; **Flex/Grid complet et breakpoints éditables non implémentés ; tests navigateur réels NOT_RUN**.
- **Alpha.20+** : SVG groupes/tangentes/transformations et UI mobile au vu des résultats du smoke G0.
- **Après gates** : outillage IA et préparation de RC.

**Pas de pourcentage fictif :** l'achèvement d'un jalon se mesure par le comportement démontré et les critères de sortie, pas par le seul nombre de tests.

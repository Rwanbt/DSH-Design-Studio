# DSH Design Studio — Matrice de livraison et de couverture

**Mise à jour :** 17 novembre 2026 (session autonome post-fusion) · **branche d'intégration :** `dev` · **PR #8 fusionnée par squash** (`c2f1747`) ; **`main` inchangée** ; remote limité à `main` + `dev`.

**Règle de lecture :** un test unitaire, une simulation du Host **ou un test navigateur avec shell simulé** ne remplace pas un test dans l'application réelle. Chaque promotion de gate ci-dessous cite la commande, le résultat exact et le niveau de test réellement atteint. Un `NOT_RUN` n'est jamais un `PASS`.

**Preuves de cette session :** [`docs/operations/SESSION-2026-11-17-POST-MERGE.md`](../operations/SESSION-2026-11-17-POST-MERGE.md) · rapport navigateur `tests/browser/__reports__/browser-report.json` · rapport DSH réel `tests/browser/__reports__/real-dsh.json`.

## 1. État par chantier

| Chantier | Vérifié réellement | Encore partiel / non fait | Gate |
|---|---|---|---|
| **P0 · Installation DSH** | Profil jetable créé depuis le template livré, plugin installé et enregistré comme bundle, application Web réelle démarrée, UI chargée, session réelle créée, **tour assistant réel produit**, routes `/health`, `/files`, `/document`, `/apply` répondantes, sauvegarde réelle disque, révision périmée refusée (409), bundle client servi (200) déclarant `conversation.view`, **workbench rendu dans la conversation DSH réelle** (capture `docs/operations/evidence/dsh-workbench.png`), aucune erreur JS du plugin | Desktop (Electron) non testé séparément de l'application Web ; tour réel nécessitant des credentials fournisseur (opt-in) | **PASS** |
| **P0 · Données natives** | Patchs exacts, inverses, `baseHash` + `baseIdentity`, verrou coopératif, **preuves multi-processus réelles**, SIGKILL, injection de pannes, refus symlink/hardlink/parent, identité refusée à octets identiques | Fenêtre TOCTOU résiduelle documentée (pas de CAS universel portable), macOS/NFS/SMB non exécutés | **PARTIAL** |
| **P1 · HTML visuel** | Sélection au clic dans une iframe réelle sans script, édition de texte et d'attributs en liste blanche, refus fail-closed du balisage mixte, tests navigateur réels Chromium + Firefox | Cascade/computed styles, sélecteurs CSS complexes côté rendu, composants dynamiques | **PARTIAL** |
| **P1 · CSS externe** | Édition de règles à sélecteurs simples, listes de sélecteurs et combinateurs, variables CSS, refus typés dans les at-rules, projection bornée sans `@import`/`url()` | Cascade réelle, `@media` éditables, CSS Modules, édition multi-fichiers atomique | **PARTIAL** |
| **P1 · SVG manuel** | Hiérarchie, groupes/dégroupes, déplacement d'un groupe entier par une seule translation, visibilité, verrouillage, rotation/échelle autour du pivot réel, géométrie transformée, plume et nœuds Bézier, Undo exact | Multi-sélection avancée (groupes hétérogènes), tangentes lissées/symétriques, arcs/relatif, dégradés, masques, booléens | **PARTIAL** |
| **P1 · Ergonomie** | 390/768/1280 px réellement mesurés, tablist ARIA réelle, focus visible, réduction d'animation, budget 1500 nœuds exécuté | Lecteur d'écran réel, tactile matériel, thèmes | **PARTIAL** |
| **P2 · Agent humain/IA** | Protocole natif réutilisable, révisions, provenance | Outils exposés aux agents, diff/approbation, orchestration multi-agents | **NOT_IMPLEMENTED** |
| **P3 · Release** | CI Linux + Windows + navigateur **tous verts**, `npm run check` sans dépendance, SBOM généré, NOTICE, guide d'installation, checklist et décision GO/NO-GO | Aucun tag/publication (accord propriétaire requis), pas de build Desktop packagé | **PARTIAL** |

## 2. Gates

### Gate G0 — Installer et utiliser l'alpha dans DSH
**Statut : PASS (installation, Host, bundle et workbench dans la vraie conversation).**

Preuves exécutées (`node tests/e2e/real-dsh.mjs`, DSH 0.2.2-rc.3, Node 24, Linux x64) : 14 `PASS`, 0 `FAIL`, 1 `NOT_RUN`.
- Profil `e2e` créé depuis le template `web` livré ; `dsh plugin --profile e2e add link:<repo>` enregistre le bundle.
- `dsh --profile e2e --no-open` sert l'application réelle ; session réelle créée par l'UI.
- `/design-studio-native/health` → 200 `{"ok":true,...}` ; `/files` → 200 ; `/document` → 200 avec `nodes` ; `/apply` → 200 et fichier réellement modifié ; seconde écriture avec révision périmée → **409** et fichier inchangé.
- `window.__DSH_BOOT__.entries` contient `@rwanbt/dsh-design-studio` et le module servi (200, 89 771 octets) déclare `conversation.view`.
- **Workbench dans la vraie conversation :** avec `DSH_E2E_REUSE_CREDENTIALS=1` (copie locale, mode 600, supprimée avec le profil jetable) et une surcouche de modèle, **un tour assistant réel** a été produit en 2 s ; DSH rend alors la zone `conversation.view`, le composant enregistré est cliquable et le texte `DSH · Design Studio` est présent dans le DOM. Capture : `docs/operations/evidence/dsh-workbench.png` (1440×900, contenu non uniforme vérifié).
- **Résultat final : 19 PASS / 0 FAIL / 0 NOT_RUN.** La variante sans credentials reste à `NOT_RUN` sur les deux dernières étapes : c'est une limite d'environnement, pas un succès simulé.
- Non couvert : l'application Desktop (Electron) elle-même, seulement son serveur Web réellement démarré.

### Gate G1 — Stockage sans perte silencieuse
**Statut : PARTIAL (fort).** Preuves : `npm run check` 406/406 ; 18 tests dédiés (multi-processus, SIGKILL, injection ENOSPC/EACCES, parent remplacé/absent, identité, symlink/hardlink). CI Linux **PASS** ; CI Windows : trois échecs réels observés puis corrigés (rename transitoire, `rmdir` du verrou, bits POSIX inexistants) — voir historique des runs. Non prouvé : macOS, NFS/SMB, fermeture du TOCTOU.

### Gate G2 — HTML/CSS utilisable de manière visuelle
**Statut : PARTIAL. La frontière de sécurité est désormais mesurée en navigateur réel et durcie sur deux couches (ADR-022).** Preuves : HTML hostile avec `<script>`, `on*`, `javascript:`, `<iframe>`, `<object>`, `<form>`, `<meta http-equiv="refresh">`, `<base>`, `prefetch`, CSS `@import`, `url()` distants → **aucune réponse** reçue d'une origine non fiable, aucun script exécuté (frame et parent), navigation empêchée, trame toujours `about:srcdoc`, sélection au clic toujours fonctionnelle ; CSP `script-src 'none'`/`connect-src 'none'`/`default-src 'none'`/`frame-src 'none'`/`base-uri 'none'`, `sandbox="allow-same-origin"` sans `allow-scripts`, aperçu SVG en `sandbox=""`, et suppression de `meta refresh`/`base` dans la projection. Mesure isolée : une meta-refresh de corps navigue une frame non sandboxée, mais **pas** notre sandbox, dans les deux moteurs. Exécuté sur Chromium **et** Firefox (27 vérifications).

### Gate G3 — SVG vectoriel robuste
**Statut : PARTIAL.** Preuves : hiérarchie/groupes/dégroupes/visibilité/verrou/transformation + géométrie transformée, avec round-trip octet-exact, refus typés, et 5 specs navigateur réels (dont la coïncidence poignées/rendu à ±2 px et la rotation autour du pivot réel). Non fait : booléens, masques, dégradés, tangentes lissées.

### Gate G4 — UX, accessibilité et performance
**Statut : PARTIAL (progrès mesurés).** Preuves navigateur : tablist ARIA réelle, focus visible calculé, activation clavier (Entrée) des contrôles, absence d'animation sous `prefers-reduced-motion`, trois largeurs réellement mesurées, budget d'ouverture/sauvegarde sur 1500 nœuds **mesuré** (< 15 s ouverture, < 8 s sauvegarde) et régression quadratique corrigée. Non fait : lecteur d'écran réel, appareil tactile, profils mémoire.

### Gate G5 — IA facultative puis release candidate
**Statut : NOT_STARTED.** Aucun outil agent, aucun SBOM/NOTICE complet, aucun packaging ni checklist de release. Aucun tag ni publication.

## 3. Critères permanents

- **Source canonique :** aucun re-sérialisation ; chaque opération est un patch `{start,end,before,after}` avec précondition de révision.
- **IA optionnelle :** aucun chemin d'édition manuelle n'appelle un fournisseur ; le profil de test DSH n'a volontairement aucune credential.
- **Sécurité :** refus par défaut, liste blanche d'attributs côté Host, iframes inertes, CSP ; un `SKIP`/`NOT_RUN` n'est jamais un `PASS`.
- **Preuves :** chaque ligne ci-dessus renvoie à une commande exécutée ; les rapports alpha antérieurs sont conservés comme preuves datées, sans réécriture.

## 4. Prochaine séquence

1. Fermer G0 : exécuter le harness réel sur un profil disposant d'un fournisseur et d'une séance non vide, capturer le workbench.
2. G5 : licences/NOTICE/SBOM, packaging, migration/rollback, documentation opérateur, rapport GO/NO-GO.
3. G2/G3 restants : cascade et `@media`, tangentes lissées, booléens — chacun derrière un refus explicite tant qu'il n'est pas prouvé.

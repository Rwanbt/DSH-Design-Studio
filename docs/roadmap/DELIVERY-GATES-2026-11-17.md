# DSH Design Studio — Matrice de livraison et de couverture

**Mise à jour :** 17 novembre 2026 (session autonome post-fusion) · **branche d'intégration :** `dev` · **PR #8 fusionnée par squash** (`c2f1747`) ; **`main` inchangée** ; remote limité à `main` + `dev`.

**Règle de lecture :** un test unitaire, une simulation du Host **ou un test navigateur avec shell simulé** ne remplace pas un test dans l'application réelle. Chaque promotion de gate ci-dessous cite la commande, le résultat exact et le niveau de test réellement atteint. Un `NOT_RUN` n'est jamais un `PASS`.

**Preuves de cette session :** [`docs/operations/SESSION-2026-11-17-POST-MERGE.md`](../operations/SESSION-2026-11-17-POST-MERGE.md) · rapport navigateur `tests/browser/__reports__/browser-report.json` · rapport DSH réel `tests/browser/__reports__/real-dsh.json`.

## 1. État par chantier

| Chantier | Vérifié réellement | Encore partiel / non fait | Gate |
|---|---|---|---|
| **P0 · Installation DSH** | Profil jetable créé depuis le template livré, plugin installé et enregistré comme bundle, application Web réelle démarrée, UI chargée, session réelle créée, **tour assistant réel produit**, routes `/health`, `/files`, `/document`, `/apply` répondantes, sauvegarde réelle disque, révision périmée refusée (409), bundle client servi (200) déclarant `conversation.view`, **workbench rendu dans la conversation DSH réelle** (captures `dsh-workbench*.png`) — **et désormais dans l'application Desktop (Electron 44.7.0 / Chromium 152)**, qui sert le bundle par son propre protocole `dsh-app://` en URL groupées (`plugins/??…`), avec routes Host réactives et workbench peint par le thème de l'hôte (captures `dsh-workbench-desktop*.png`) | Tour réel sur le Desktop non exécuté : le profil `desktop` jetable n'a pas d'adaptateur pour le fournisseur testé (`NO_ADAPTER`), donc la conversation y est rendue par le chemin d'erreur ; onboarding du shell traversé par script (pas de test manuel) | **PASS** |
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

Preuves exécutées (`node tests/e2e/real-dsh.mjs`, DSH 0.2.2-rc.3, Node 24, Linux x64) : **31 `PASS`, 0 `FAIL`, 0 `NOT_RUN`**, en deux moitiés — l'application Web réelle (20 étapes) et l'application Desktop réelle (11 étapes).
- Profil `e2e` créé depuis le template `web` livré ; `dsh plugin --profile e2e add link:<repo>` enregistre le bundle.
- `dsh --profile e2e --no-open` sert l'application réelle ; session réelle créée par l'UI.
- `/design-studio-native/health` → 200 `{"ok":true,...}` ; `/files` → 200 ; `/document` → 200 avec `nodes` ; `/apply` → 200 et fichier réellement modifié ; seconde écriture avec révision périmée → **409** et fichier inchangé.
- `window.__DSH_BOOT__.entries` contient `@rwanbt/dsh-design-studio` et le module servi (200, 106 855 octets) déclare `conversation.view`.
- **Workbench dans la vraie conversation (plugin interne) :** avec `DSH_E2E_REUSE_CREDENTIALS=1` (copie locale, mode 600, supprimée avec le profil jetable) et une surcouche de modèle, **un tour assistant réel** a été produit en 2 s ; DSH rend alors la zone `conversation.view`, le composant enregistré est cliquable et le texte `DSH · Design Studio` est présent dans le DOM. Captures : `docs/operations/evidence/dsh-workbench.png` (viewport) et `dsh-workbench-element.png` (la vue elle-même) ; le workbench est peint par le thème de l'hôte (`rgb(255,255,255)` = valeur DSH de `--dsw-alias-bg-layer-1`).
- **Application Desktop (Electron) — `tests/e2e/desktop-shell.mjs`, exécuté par le même harness :**
  - `HOME`/`DSH_HOME` jetables + `XDG_*` redirigés : le shell crée **son propre** profil `desktop` (profil possédé par l'application, que la CLI refuse de créer) ; `dsh plugin --profile desktop add link:<repo>` l'installe ensuite, comme le ferait un utilisateur.
  - Second démarrage : Playwright s'attache en CDP au vrai renderer `dsh-app://app/` (**Electron 44.7.0, Chromium 152.0.7977.130**, 79 entrées client).
  - Le shell sert le bundle par **son** protocole, en URL groupées : `plugins/??@rwanbt/dsh-design-studio/client.js&rev=1d95b76ad6e1` → **HTTP 200, 106 855 octets** (`immediately=true`), taille identique au service HTTP — deux chemins de livraison distincts, tous deux prouvés.
  - Routes Host réactives dans le runtime desktop : `/design-studio-native/health` → **200** `{"ok":true,"editor":"native-prototype","version":1}` (après authentification par le token du shell ; sans token : 401, ce qui est le comportement attendu).
  - **Workbench rendu dans le Desktop** : l'onglet `design studio` de la zone `conversation.view` est ouvert, l'élément est dans le DOM, peint par le thème de l'hôte (`background=rgb(255, 255, 255)` = `--dsw-alias-bg-layer-1` du Desktop), boîte mesurée 994×658 ; captures `dsh-workbench-desktop.png` (1 707×1 005, 6 364 couleurs) et `dsh-workbench-desktop-element.png` (1 327×879, 1 808 couleurs) — la mesure d'image évite de prendre une capture vide pour une preuve.
  - Aucune erreur JavaScript du plugin dans le renderer desktop.
  - **Non couvert :** le tour assistant réel dans le shell (profil `desktop` sans adaptateur pour le fournisseur testé → `NO_ADAPTER`, la conversation reste non vide par le chemin d'erreur) ; la fenêtre « bienvenue » et le parcours de connexion au compte (fermés/sautés par script, pas testés manuellement).
- **Résultat final : 31 PASS / 0 FAIL / 0 NOT_RUN.** La variante sans credentials reste à `NOT_RUN` sur les étapes qui exigent un tour réel : c'est une limite d'environnement, pas un succès simulé.

### Gate G1 — Stockage sans perte silencieuse
**Statut : PARTIAL (fort).** Preuves : `npm run check` 409/409 ; 18 tests dédiés (multi-processus, SIGKILL, injection ENOSPC/EACCES, parent remplacé/absent, identité, symlink/hardlink). CI Linux **PASS** ; CI Windows : trois échecs réels observés puis corrigés (rename transitoire, `rmdir` du verrou, bits POSIX inexistants) — voir historique des runs. Non prouvé : macOS, NFS/SMB, fermeture du TOCTOU.

### Gate G2 — HTML/CSS utilisable de manière visuelle
**Statut : PARTIAL. La frontière de sécurité est désormais mesurée en navigateur réel et durcie sur deux couches (ADR-022).** Preuves : HTML hostile avec `<script>`, `on*`, `javascript:`, `<iframe>`, `<object>`, `<form>`, `<meta http-equiv="refresh">`, `<base>`, `prefetch`, CSS `@import`, `url()` distants → **aucune réponse** reçue d'une origine non fiable, aucun script exécuté (frame et parent), navigation empêchée, trame toujours `about:srcdoc`, sélection au clic toujours fonctionnelle ; CSP `script-src 'none'`/`connect-src 'none'`/`default-src 'none'`/`frame-src 'none'`/`base-uri 'none'`, `sandbox="allow-same-origin"` sans `allow-scripts`, aperçu SVG en `sandbox=""`, et suppression de `meta refresh`/`base` dans la projection. Mesure isolée : une meta-refresh de corps navigue une frame non sandboxée, mais **pas** notre sandbox, dans les deux moteurs. Exécuté sur Chromium **et** Firefox (27 vérifications).

### Gate G3 — SVG vectoriel robuste
**Statut : PARTIAL.** Preuves : hiérarchie/groupes/dégroupes/visibilité/verrou/transformation + géométrie transformée, avec round-trip octet-exact, refus typés, et 5 specs navigateur réels (dont la coïncidence poignées/rendu à ±2 px et la rotation autour du pivot réel). Non fait : booléens, masques, dégradés, tangentes lissées.

### Gate G4 — UX, accessibilité et performance
**Statut : PARTIAL (progrès mesurés).** Preuves navigateur : tablist ARIA réelle, focus visible calculé, activation clavier (Entrée) des contrôles, absence d'animation sous `prefers-reduced-motion`, trois largeurs réellement mesurées, budget d'ouverture/sauvegarde sur 1500 nœuds **mesuré** (< 15 s ouverture, < 8 s sauvegarde) et régression quadratique corrigée. Non fait : lecteur d'écran réel, appareil tactile, profils mémoire.

### Gate G5 — IA facultative puis release candidate
**Statut : NOT_STARTED pour l'IA facultative ; préparation de RC faite.** Outils agent : aucun (G5.1/G5.2 non implémentés). Préparation livrée et vérifiée : `docs/operations/SBOM.json` régénérable (`npm run sbom`, dépendances runtime vides), `NOTICE`, `docs/operations/INSTALL.md` (installation dans un profil, **y compris le profil `desktop`**), checklist d'acceptation et décision GO/NO-GO (`docs/operations/RELEASE-DECISION-2026-11-17.md`) : **GO** pour une RC expérimentale approuvée par le propriétaire sur `dev`, **NO-GO** pour un stable ou une fusion dans `main`. Aucun tag, aucune publication.

## 3. Critères permanents

- **Source canonique :** aucun re-sérialisation ; chaque opération est un patch `{start,end,before,after}` avec précondition de révision.
- **IA optionnelle :** aucun chemin d'édition manuelle n'appelle un fournisseur ; le profil de test DSH n'a volontairement aucune credential.
- **Sécurité :** refus par défaut, liste blanche d'attributs côté Host, iframes inertes, CSP ; un `SKIP`/`NOT_RUN` n'est jamais un `PASS`.
- **Preuves :** chaque ligne ci-dessus renvoie à une commande exécutée ; les rapports alpha antérieurs sont conservés comme preuves datées, sans réécriture.

## 4. Prochaine séquence

1. ~~Fermer G0~~ **fait** : app Web réelle et app Desktop réelle, workbench rendu dans les deux, captures committées.
2. Reste pour G0 : tour assistant réel dans le shell Desktop (nécessite un profil `desktop` avec adaptateur fournisseur) et parcours de connexion au compte — les seules parties non prouvées.
3. G5 : outils agent (G5.1/G5.2), puis tag/RC — **bloqués sur accord explicite du propriétaire** ; ne jamais toucher `main`.
4. G2/G3 restants : cascade et `@media`, tangentes lissées, booléens — chacun derrière un refus explicite tant qu'il n'est pas prouvé.

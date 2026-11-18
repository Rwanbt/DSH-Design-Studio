# Plan d'intégration — de l'alpha expérimentale à un outil utilisable

> **Actualisation du 19 novembre 2026 (à revérifier au SHA courant) :**
> la création de dégradés linéaires/radiaux, les arrêts éditables et la
> géométrie native depuis l'inspecteur Graphite sont implémentés sur \`dev\`
> (ADR-036) avec tests module/navigateur. Cette actualisation ne ferme
> pas le gate DSH Desktop et ne vaut pas validation Production Ready.
> Les sections historiques de ce document peuvent indiquer
> « création hors périmètre » : elles décrivent le périmètre plus ancien.


**Date :** 18 novembre 2026 · **Branche :** `dev` · **Base :** `e369a2d`
**Auteur :** orchestrateur · **Statut :** plan d'exécution, pas une décision de release.

## 1. Décision de périmètre

DSH Design Studio ne cherche pas à égaler Figma ou Penpot. Ces produits reposent
sur un moteur de rendu, un modèle de composants et une synchronisation
distribuée qui représentent des années d'ingénierie. Vouloir les rattraper dans un
plugin embarqué produirait des fonctionnalités à moitié faites — exactement ce que
la mission interdit.

Le périmètre de release retenu est donc :

> **Un éditeur manuel SVG / HTML / CSS local, sans IA, qui ne perd jamais un octet,
> qui fait bien les gestes quotidiens d'un designer, et dont chaque fonction
> annoncée est vérifiée dans le vrai DSH.**

### Dans le périmètre (engagé)

| # | Capacité | État actuel |
|---|---|---|
| 1 | Créer, ouvrir, éditer, sauvegarder, renommer, supprimer des documents natifs | livré |
| 2 | Formes SVG, plume, nœuds Bézier, texte et typographie | livré |
| 3 | Calques : hiérarchie, groupe, visibilité, verrou, renommage, ordre par glisser, alignement, distribution | livré |
| 4 | Transformations : déplacement, rotation/échelle à pivot réel, matrices imbriquées | livré |
| 5 | Apparence SVG : remplissage, opacité, **dégradés (couleur, opacité, ajout/suppression d'arrêts)**, **contours** | dégradés livrés (1.1 et 1.4) · contours à faire |
| 6 | HTML visuel : sélection dans l'aperçu, texte, attributs, classes, presets Flex/Grid, aperçu responsive borné | livré |
| 7 | CSS : règles, sélecteurs, variables, **une déclaration dans un `@media` simple** | livré |
| 8 | Sécurité des aperçus (iframe inerte, CSP, sandbox) | livré, mesuré en navigateur |
| 9 | Sauvegarde sans perte : patches exacts, révisions, conflits refusés, Undo/Redo exact | livré |
| 10 | Intégration DSH : vue de conversation + panneau barre latérale, thème de l'hôte | livré côté Web |
| 11 | Vérification réelle : Web, **Desktop**, accessibilité réelle, plateformes | Web livré · Desktop/AT à faire |
| 12 | Fonctionnalités agentiques optionnelles sur les mêmes primitives | non implémenté |

### Hors périmètre (explicitement annoncé comme absent)

- Collaboration temps réel, commentaires, historique de versions partagé.
- Composants/symboles et styles d'objet réutilisables ; variables de design.
- Opérations booléennes, moteur de filtres, masques complexes.
- Import Figma/Sketch/AI/PSD ; export PNG/PDF/React/Tailwind.
- Prototypage (liens entre écrans), planches multiples, onglets d'*artboards*
  dans un même document (les onglets de **documents**, un fichier par onglet,
  sont la tranche 3.1 et sont livrés).
- Cascade CSS calculée, `@container`, breakpoints éditables, CSS de frameworks.

Ces éléments ne seront **jamais** annoncés comme disponibles ; toute mention
future devra passer par une nouvelle décision et ses propres preuves.

## 2. Vagues d'exécution

Chaque vague est une suite de tranches livrables séparément, avec revue
indépendante, gates niveau 1/2, puis commit atomique sur `dev`.

### Vague 1 — Finir l'apparence SVG (priorité P0 du périmètre)

| Tranche | Contenu | Dépendances | Preuve exigée |
|---|---|---|---|
| 1.1 | **Arrêts de dégradé** — livré : couleur et opacité d'un arrêt existant ; `offset` supporté par module/Host mais non exposé ; refus explicites (hérité par `href`, `style=`, feuille de style du document, id encodé, entités, hors bornes, `none`) | — | module + route + specs navigateur ; octets exacts, 1 écriture, Undo exact |
| 1.2 | **Contours** : `stroke`, `stroke-width`, `stroke-opacity`, `stroke-linecap`, `stroke-linejoin`, `stroke-dasharray` borné ; panneau « Contour » réellement actif ou refusé avec raison | 1.1 | idem |
| 1.3 | **Opacité de remplissage** distincte de l'opacité globale (`fill-opacity`) | 1.2 | idem |
| 1.4 | **Arrêts ajoutés/supprimés** — livré : un `<stop>` complet inséré à l'index demandé ou en fin (style du voisin, offset distinct calculé, indentation observée) et un span exact retiré (indentation de ligne comprise) ; **un patch, un Undo** chacun ; document re-scanné, plafond 32, refus du dernier arrêt et de toutes les raisons 1.1 ; panneau « Ajouter un arrêt » / « Supprimer l'arrêt N » ([ADR-033](../adr/ADR-033-GRADIENT-STOP-EDITING.md)) | 1.1 | patch réversible, refus si le document n'est pas structurable ; octets exacts, 1 écriture, Undo exact |

> **1.4 — implémentée et vérifiée aux niveaux 1 et 2 (2026-11-18).** Module
> `svgGradientStopInsertPatch` / `svgGradientStopRemovePatch` (Host :
> `svg-gradient-stop-add`, `svg-gradient-stop-remove`), un seul span et donc un
> seul Undo par geste. L'ajout copie couleur/opacité du voisin, calcule un offset
> distinct dans l'unité du fichier (`50%` ≡ `0.5`, jamais de doublon) et respecte
> l'indentation ou la ligne unique du contenu ; la suppression retire le span
> exact de l'arrêt, avec son saut de ligne et son indentation quand il occupe sa
> ligne seule, et refuse le dernier arrêt. Toute insertion/retrait est re-scanné
> par `scanSvgDocument` et refusé `invalid-result` si le document ne parse plus
> ou si le nombre d'arrêts n'a pas bougé d'exactement ±1. Côté client, « Ajouter
> un arrêt » et « Supprimer l'arrêt N » (N = numéro 1-based affiché) sont
> désactivés sans requête si le document est occupé/modifié, si le dernier arrêt
> est visé ou si le plafond de 32 est atteint. Preuves : `npm run check`
> **613/613 PASS** (10 tests ajoutés : 8 module, 2 routes réelles) ; navigateur
> Chromium 145 + Firefox 146, `--grep=gradient:` → **12 PASS / 0 FAIL / 0
> NOT_RUN** (6 specs, **76 vérifications par moteur**, dont 20 pour l'ajout et 14
> pour la suppression) ; non-régression ciblée `--grep=inspector:` → **4 PASS /
> 0 FAIL**. Limites : l'ajout respecte la position documentaire, pas l'ordre des
> offsets (un ajout en fin sur `0, 0.55, 100%` reçoit `77.5%`) ; pas de
> réordonnancement, pas d'édition d'offset dans l'UI, pas de vérification des
> références à l'`id` d'un arrêt supprimé, et niveau 3 (`test:dsh`/Desktop)
> **NOT_RUN**.

Sortie de vague : tout dessin SVG importé peut être retouché (couleur, contour,
dégradé) sans jamais réécrire les octets voisins.

### Vague 2 — Vérification réelle (bloque toute revendication)

| Tranche | Contenu | Preuve exigée |
|---|---|---|
| 2.1 | **Desktop Electron** sur l'UI actuelle : installation, panneau, édition, sauvegarde dans un profil jetable | **Tentative faite, `NOT_RUN`** : le shell démarre réellement en ozone headless (CDP publié) mais sa fenêtre de premier démarrage n'est pas pilotable sans display interactif ; `Xvfb` absent et son installation exige root. Commande propriétaire et cause exacte dans [DESKTOP-VERIFICATION-2026-11-18.md](../operations/DESKTOP-VERIFICATION-2026-11-18.md) |
| 2.2 | **Lecteur d'écran réel** sur le parcours de commande | **arbre d'accessibilité réel vérifié** (CDP Chromium, noms calculés Firefox, zéro contrôle anonyme, focus clavier) — le lecteur lui-même reste `NOT_RUN` : Orca exige un display interactif, Xvfb absent, `DISPLAY=:0` interdit ([rapport](../operations/ACCESSIBILITY-2026-11-18.md)) |
| 2.3 | **Tactile** : sélection et glissement au doigt | **émulation vérifiée** (`hasTouch` + API `touchscreen`, Chromium et Firefox) ; appareil physique, pincement et taille des poignées au doigt : `NOT_RUN` |
| 2.4 | **Plateformes** : macOS, NFS/SMB | **Retrait explicite** du périmètre certifié, avec la matrice des plateformes et le comportement fail-closed du stockage ([PLATFORM-MATRIX-2026-11-18.md](../operations/PLATFORM-MATRIX-2026-11-18.md)) |

Sortie de vague : le mot « production ready » devient discutable ; tant que 2.1
et 2.2 ne sont pas faits, le verdict reste **NO-GO**.

### Vague 3 — Confort professionnel (après 1 et 2)

| Tranche | Contenu |
|---|---|
| 3.1 | **Onglets de documents** — livré : plusieurs fichiers ouverts, un état complet par onglet (source, sélection, Undo/Redo, brouillon), changement/fermeture sans écriture, limite de 8 onglets ([ADR-034](../adr/ADR-034-DOCUMENT-TABS.md)) |
| 3.2 | Planche redimensionnable depuis l'UI (`viewBox`/`width`/`height` explicites) |
| 3.3 | Export PNG du document courant, sans réécrire la source |
| 3.4 | **Journal local de récupération des modifications non enregistrées** — livré : la source des documents modifiés est copiée dans `localStorage` (bornée, une clé par espace de travail), un bandeau explicite la propose après un crash, la récupération ne charge que l'éditeur et n'écrit jamais le fichier ; corrections de la revue indépendante D1–D6 livrées (frappe pendant un save préservée, base de révision conservée, `/document` relu pour un onglet déjà ouvert, message non contradictoire, fermeture sans enregistrer qui efface l'entrée, fermeture bloquée pendant un save) ([ADR-035](../adr/ADR-035-UNSAVED-RECOVERY-JOURNAL.md)) |

> **3.1 — implémentée et vérifiée aux niveaux 1 et 2 (2026-11-18).** Le workbench
> garde jusqu'à **8 onglets de documents** ouverts, chacun avec son état complet :
> `doc`/`source` (y compris la source non enregistrée), `nodes`, surfaces
> d'inspecteur, sélection, caméra, `undoStack`/`redoStack` et brouillon de texte.
> Changer d'onglet, en ouvrir un ou en fermer un n'envoie **aucun `/apply`** ;
> seule une action explicite enregistre, et `save()` vise toujours le fichier de
> l'onglet **actif**. La fermeture d'un onglet modifié exige une confirmation
> (`role="alertdialog"`) qui nomme le chemin ; refuser laisse l'onglet et les
> octets intacts. Les préconditions de sauvegarde existantes sont conservées
> (révision périmée, conflit externe, `busy`, `reloadRequired`), et
> `manageFile()` rend un renommage/suppression cohérent même quand le fichier est
> ouvert dans un onglet en arrière-plan (chemin suivi, révision relue à
> l'activation, onglet fermé si le fichier est supprimé). Accessibilité réelle :
> `tablist`/`tab`, `aria-selected`, `aria-controls` vers un `tabpanel`, nom
> accessible explicite, flèches/`Home`/`End` pour le focus et `Entrée`/`Espace`
> pour activer. Preuves : `npm run check` (**591/591 PASS**, dont 7 tests
> `tests/client-tabs.test.mjs`) ; navigateur Chromium 145 + Firefox 146,
> `--grep=tab:` → **8 PASS / 0 FAIL** (4 specs, 48 vérifications par moteur),
> plus **86 PASS / 0 FAIL** sur 43 des 93 specs (`tab:`, `html:`, `css:`,
> `geometry:`, `graphite:`, `responsive:`, `performance:`, `a11y:`, `landing:`,
> `create:`, `files:`, `conflict:`, `safety:`), 325 vérifications par moteur ;
> la spec `responsive:` a révélé que la bande réduisait le canevas au point de
> rendre l'en-tête d'aperçu HTML inatteignable — corrigé (aperçu ancré en haut
> et défilable), pas contourné dans le test. Limites honnêtes : la borne
> est un nombre d'onglets, pas un budget mémoire (fichiers ≤ 8 Mio, historique
> ≤ 2 Mio × 30 par onglet) ; les onglets ne survivent ni au rechargement ni au
> changement d'espace de travail ; le dédoublonnage se fait sur le chemin exact ;
> la bande est dans la colonne canevas, donc masquée en disposition compacte
> quand le dock affiche « Calques »/« Propriétés » ; pas de `Ctrl+Tab`, pas de
> réordonnancement, pas de « tout enregistrer » ; suite navigateur complète
> **non réexécutée** et niveau 3 (`npm run test:dsh`/Desktop) **NOT_RUN**.

> **3.2 — implémentée et vérifiée aux niveaux 1 et 2 (2026-11-18).** La section
> « Planche » de l'inspecteur affiche la taille réellement déclarée dans le
> fichier (`/document` renvoie `artboard`), avec un champ largeur, un champ
> hauteur et une case **« Redimensionner le contenu »** séparée. Décochée, seule
> `width`/`height` change et le `viewBox` reste intact ; cochée, `viewBox`,
> `width` et `height` partent dans **un seul patch batch** (une écriture, un
> Undo). Refus typés sans écriture : document non SVG, planche non résoluble,
> `viewBox` invalide, `preserveAspectRatio` non standard, valeur non numérique,
> ≤ 0 ou hors 1..20000, taille identique. Le canevas utilise la taille déclarée
> et letterboxe le contenu quand ses proportions diffèrent du `viewBox`, de
> sorte que les poignées restent alignées. Preuves : `npm run check` (584 tests,
> dont 14 pour la planche) ; navigateur Chromium 145 + Firefox 146,
> `--grep=artboard:` → 8 specs PASS, 46 vérifications par moteur (92 au total),
> octets exacts sur disque, 1 POST par action, Undo octet-exact. Limites : pas de
> ratio verrouillé, pas de redimensionnement par poignées de planche, et essai
> dans un vrai DSH `NOT_RUN`.

> **3.3 — implémentée et vérifiée aux niveaux 1 et 2 (2026-11-18).** Le bouton
> **« Exporter PNG »** convertit la **source actuelle de l'éditeur** (y compris
> les modifications non enregistrées), jamais `doc.source` sur disque : la
> source est sérialisée en `Blob` SVG, chargée dans une `Image`, dessinée dans un
> `canvas` à l'échelle choisie (**1×/2×**) puis téléchargée via
> `canvas.toBlob`. Aucun `/apply`, aucune écriture disque, aucune entrée Undo,
> aucune requête Host : le fichier reste byte-identique et le PNG est produit en
> mémoire. La taille vient de `width`/`height` déclarés, sinon du `viewBox` ; une
> planche non résoluble est refusée, et une sortie > **8192 px** par côté est
> refusée avec la taille calculée. Le nom dérive du fichier courant
> (`carte.svg` → `carte.png`). Un document HTML/CSS désactive le bouton avec une
> raison visible (`PNG : disponible uniquement pour les documents SVG`). Une
> source contenant `<script>` est refusée explicitement : le SVG chargé comme
> image n'exécute pas de script et ne charge pas de ressource externe dans
> Chromium/Firefox, mais l'export ne prétend pas convertir du contenu actif.
> Preuves : `npm run check` **591/591 PASS** ; navigateur Chromium 145 + Firefox
> 146, `--grep=png:` → **12 PASS / 0 FAIL** (6 specs, 66 vérifications par
> moteur) : signature PNG `89 50 4E 47`, dimensions lues dans l'IHDR (600×400 en
> 1×, 1200×800 en 2×), pixel échantillonné `#bda991` puis `#2277cc` pour la
> source non enregistrée, **0 POST `/apply`** et **0 requête Host** au clic, octets
> disque inchangés, Undo toujours vide ; HTML et CSS désactivés avec raison ;
> `<script>` refusé sans téléchargement ; conversion en mode image inerte
> vérifiée (gestionnaire `onload` non exécuté, image distante non chargée) ;
> `viewBox` de secours, source invalide et sortie 10000×200 refusées. Non-régression ciblée : export natif, onglets,
> presse-papiers, glisser-déposer de calque et alignement PASS sur les deux
> moteurs. Limites : pas de pixels identiques entre moteurs (rendu de police et
> anticrénelage), seules la signature, l'IHDR et quelques pixels de remplissage
> sont assertés ; les ressources externes du SVG ne sont pas embarquées (le
> navigateur ne les charge pas en mode image), donc un SVG dépendant d'une police
> ou d'une image distante peut rendre différemment ; pas de fond opaque ni de
> choix de qualité (PNG sans perte uniquement) ; niveau 3 (`test:dsh`/Desktop)
> `NOT_RUN`.

> **3.4 — implémentée et vérifiée aux niveaux 1 et 2 (2026-11-18).** Le journal
> couvre le cas réel qui manquait : une fermeture brutale de DSH (plantage,
> fermeture de fenêtre, rechargement) alors qu'un document a des modifications
> non enregistrées. Chaque onglet modifié (actif ou en arrière-plan, ADR-034) est
> copié — source exacte, chemin relatif, révision de base, horodatage — sous
> `dsh-design-studio:recovery:v1:<w:espace|s:session>:<fichier>`, après 250 ms de
> frappe avec vidage forcé sur `pagehide`/`beforeunload`/démontage. Bornes
> annoncées : **256 Kio** UTF-8 par entrée et **8 entrées par scope**, sans
> éviction ni troncature ; un dépassement n'est pas journalisé et le dit. Au
> montage, un bandeau `role="alert"` nomme le fichier et l'âge de la dernière
> copie, avec « Récupérer les modifications » et « Ignorer » : **aucune action
> automatique**. « Récupérer » ouvre le fichier en lecture seule, relit la
> révision courante même pour un onglet déjà ouvert, signale une divergence et
> installe la source comme brouillon non enregistré — **0 `/apply`**, fichier
> byte-identique ; l'enregistrement reste explicite et passe par les
> préconditions existantes. L'entrée est effacée par une sauvegarde réussie
> dont la source n'a pas changé pendant l'envoi, par « Ignorer », par « Fermer
> sans enregistrer », ou quand la source redevient identique au disque. Un
> `localStorage` absent/plein/refusant l'écriture ne
> casse ni l'édition ni la sauvegarde : échec silencieux dans la fonction,
> avertissement affiché **une fois**. Case « Journal de récupération » dans
> *Options*, préférence conservée, désactivée = plus de nouvelles copies.
> **Corrections de la revue indépendante (D1–D6, 18/11/2026)** : une frappe
> pendant un `/apply` en vol n'est plus écrasée par le rechargement (le document
> n'est pas rechargé, seules `hash`/`identity` sont adoptées, le tampon reste
> modifié et l'entrée de journal est conservée) ; une entrée garde sa
> `baseHash` d'origine tant qu'aucune sauvegarde n'a réussi ; la récupération
> relit `/document` même pour un onglet déjà ouvert ; le message de divergence
> ne dit plus à la fois « inchangé » et « a changé » ; « Fermer sans
> enregistrer » supprime l'entrée du scope ; fermer un onglet pendant un save
> est refusé avec un message et le bouton de confirmation est désactivé.
> Preuves ciblées de ces corrections : niveau 1 → **19/19 PASS** (11 tests
> journal + 8 tests onglets) et **36/36 PASS** sur la non-régression save/load ;
> niveau 2 → **22 PASS / 0 FAIL / 0 NOT_RUN** (11 specs `recovery:` ×
> Chromium 145.0.7632.6 + Firefox 146.0.1, **67 vérifications par moteur**,
> 134 au total). La suite complète (`npm run check`) n'a pas été relancée dans
> cette passe et le niveau 3 (`test:dsh`/Desktop) reste **NOT_RUN**.
> Preuves : `npm run check` → **598/598 PASS / 0 FAIL** (dont 7 tests
> `tests/client-recovery.test.mjs`) ; navigateur Chromium 145 + Firefox 146,
> `--grep=recovery:` → **14 PASS / 0 FAIL** (7 specs, **47 vérifications par
> moteur**) ; non-régression ciblée sur `tab:` (8), `conflict:` (4), `panel:`
> (6), `a11y:` (8), `png:` (12) → **38 PASS / 0 FAIL**. Limites honnêtes : ce
> n'est **pas une sauvegarde** (copie unique, aucune version, aucun retour après
> « Ignorer ») ; elle ne survit ni au nettoyage des données du navigateur, ni à
> un autre profil/navigateur/machine ; rien n'est chiffré ; les brouillons de
> texte inline, les onglets, Undo/Redo et la sélection ne sont pas restaurés ;
> pas de fusion de révisions (une divergence est signalée, pas résolue) ; deux
> onglets du même fichier partagent une clé (dernier écrivain gagnant) ; le
> quota est partagé avec le reste de l'origine ; le niveau 2 simule le crash par
> `page.reload()`, un vrai processus tué n'est pas testé ; niveau 3
> (`test:dsh`/Desktop) **NOT_RUN**. Choix de portée : le plan parlait d'un
> « journal de patches » ; rejouer des patches sur une révision périmée est un
> conflit silencieux, donc la tranche livre la **source exacte récupérable**, pas
> un historique de patches.

Sortie de vague : usage quotidien sans friction, sans élargir le périmètre
fonctionnel.

### Vague 4 — Optionnel, hors périmètre de release

Outils agentiques (mêmes primitives, diff visible, approbation), puis seulement
ensuite booléens/composants s'ils sont explicitement demandés.

## 3. Règles d'exécution (inchangées)

1. Une tranche = tests écrits **avant** la correction quand il s'agit d'un défaut.
2. Toute écriture passe par un patch ciblé et une précondition de révision.
3. Un refus est explicite et ne modifie aucun octet ; jamais d'approximation
   silencieuse.
4. Chaque tranche : niveau 1, niveau 2 (Chromium + Firefox), **revue indépendante**,
   correction des constats, puis commit atomique et push sur `dev`.
5. La documentation (ADR, matrice de livraison, README, décision de release) est
   mise à jour dans le même commit ou juste après, avec les SHA réels.
6. `main`, les tags et toute publication restent interdits sans accord explicite
   du propriétaire.
7. Un `NOT_RUN` reste un `NOT_RUN` : jamais promu en succès.

## 4. Risques identifiés

| Risque | Mitigation |
|---|---|
| Le Desktop ne se laisse pas piloter sans fenêtre visible sur le profil personnel | profil et `HOME`/`XDG` jetables, `DSH_E2E_DESKTOP=0` par défaut, preuve par captures |
| L'accessibilité réelle révèle des défauts structurels (focus, ordre, noms) | traiter avant la vague 3 ; ne jamais déclarer WCAG sur la seule présence d'attributs |
| Les dégradés/contours touchent des documents réels | refus par défaut sur les constructions ambiguës ; patchs sur la seule valeur d'attribut |
| La dette de `client.js` (≈3 600 lignes) ralentit les tranches | extraction progressive par domaine, tests préservés, jamais de réécriture globale |
| Une tranche « presque finie » est annoncée comme finie | rapport honnête par tranche, `PARTIAL`/`NOT_RUN` explicites |

## 5. Critères de sortie (rappel)

Aucune release tant que :

- [ ] la vague 1 est livrée et vérifiée en navigateur réel ;
- [ ] la vague 2.1 (Desktop) et 2.2 (lecteur d'écran) sont exécutées ou
      explicitement retirées du périmètre certifié ;
- [ ] chaque contrôle visible fait ce qu'il annonce, ou est désactivé avec raison ;
- [ ] la matrice de livraison et la décision de release citent les SHA et les
      commandes réellement exécutées ;
- [ ] le propriétaire approuve explicitement la publication.

## 6. État au moment d'écrire ce plan

- `npm run check` : **553 PASS / 0 FAIL / 0 SKIP**.
- `npm run test:browser` : **156 PASS / 0 FAIL / 0 NOT_RUN** (78 specs × 2 moteurs).
- `npm run test:dsh` (Web, sans IA) sur `e369a2d` : **30 PASS / 0 FAIL / 6 NOT_RUN**,
  preuves dans `docs/operations/evidence/2026-11-18-e369a2d/`.
- Desktop, lecteur d'écran, tactile, macOS/NFS : `NOT_RUN`.
- Verdict : **NO-GO** Production Ready, aucune release, `main` intacte à `67870f7`.

# P0 source inventory — 2026-11-16

This is a **documentation/manifest-level preliminary review** based on live GitHub repository metadata, README and LICENSE files. It is **not** a code-level audit or execution test.

| Candidate | Primary reusable concept | Default branch | Repository size (GitHub KB) | License file checked | Status |
|---|---|---|---:|---|---|
| [Sal7one/DSH-Design-Studio](https://github.com/Sal7one/DSH-Design-Studio) | DSH workbench, project history, previews, assets, host/client split | master | 12956 | MIT, copyright Sal7one 2026 | Evaluate as host/shell base |
| [AndreTheAccelerator/dsh-design-canvas](https://github.com/AndreTheAccelerator/dsh-design-canvas) | Layer model, drag/resize, frames, transactions, undo | main | 111 | MIT, copyright Andre Accelerator 2026 | Evaluate editing engine |
| [zhang-guo-wen/dsh-web-design](https://github.com/zhang-guo-wen/dsh-web-design) | HTML element selection, pending edits and targeted source write-back | master | 1201 | Apache-2.0 | Evaluate source-mapping algorithm |
| [ZSeven-W/dsh-openpencil](https://github.com/ZSeven-W/dsh-openpencil) | Embedded managed vector editor, canvas-agent tools, save semantics | main | 5735 | MIT, copyright ZSeven—W 2026 | Inspect dependency on external OpenPencil runtime and .op format |
| [OrderG-X/dsh-design-studio](https://github.com/OrderG-X/dsh-design-studio) | DSH context, responsive frames, previews, slides workflow | main | 16411 | MIT, copyright OrderG-X 2026 | UX reference / candidate |
| [Devin-AXIS/deepseek-design](https://github.com/Devin-AXIS/deepseek-design) | HTML properties panel and native integration patterns | main | 115931 | iPolloWork Source Available License | **Reference only. No code copying** |

## Evidence checkpoints

- Repositories above were retrieved through GitHub API on 2026-11-16.
- The six README.md and LICENSE files were fetched directly; repository sizes and branches were retrieved from GitHub metadata.
- Other code files, dependencies and shipped bundles **have not yet been fully inspected**. Individual code files may have separate notices; downstream dependencies have separate licenses.
- An MIT project may incorporate MIT and Apache-2.0 material while retaining the relevant attribution, notices and patent/license terms. Never relabel Apache-2.0 files as MIT.
- The plugin named `dsh-openpencil` is MIT but it invokes an OpenPencil editor/runtime; audit the runtime's license and distribution model independently.
- Screenshots and stock assets are not assumed to share the source code license.

## Decision gates before reuse

1. Inspect `package.json`, manifests, client/host entrypoints and tree (at a **pinned commit SHA**, not moving branch heads).
2. Record each candidate's architecture, dependencies, build, DSH compatibility and active maintenance.
3. Classify code as **COPY / ADAPT / REIMPLEMENT / REFERENCE ONLY** and document the reason.
4. Test exact native write-back of representative SVG / HTML files in a disposable workspace.
5. Run dependency/license scans and third-party attribution check.
6. Approve one plugin shell and document the migration plan; only then import code.

## Preliminary hypothesis (not a final selection)

Sal7one's workbench may make the best DSH shell; Design Canvas can inform a shared command/document engine; Web Design can inform HTML targeted write-back; OpenPencil can inform SVG workflow. Keep two distinct canonical source adapters (HTML/CSS and SVG) to avoid lossy serialization.

## Vérification de l'implémentation interne (17 novembre 2026)

Le tableau des dépôts amont ci-dessus reste un inventaire **préliminaire**, sans transfert de code. La branche expérimentale locale contient désormais des modules natifs écrits pour ce plugin, dont `src/native-file-store.mjs`, `src/html-visual.mjs`, `src/svg-paths.mjs` et `src/css-visual.mjs`. L'alpha.16 dispose d'une **preuve de tests internes**, et non d'une preuve d'intégration DSH : [run 43982069590](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/43982069590), source SHA `29fd25d881069574cea56154f135a20e5da7a0c5`, commande `npm run check` (Node 22), **230 PASS / 0 FAIL / 0 SKIP**.

**Périmètre vérifié :** patches natifs ciblés SVG/HTML/CSS, édition manuelle, tests Host avec dossiers temporaires et React simulé. **Non vérifié :** licence de chaque dépendance amont par fichier, copie d'assets externes (aucune copie revendiquée ici), DSH réel, compatibilité cross-platform, sécurité filesystem contre éditeurs externes. La feuille de route consolidée avec gates de sortie et tickets est [DELIVERY-GATES-2026-11-17.md](../roadmap/DELIVERY-GATES-2026-11-17.md).

## Alpha.17 — Frontière de confiance de l'aperçu HTML (17 novembre 2026)

La sélection au clic a été ajoutée au client du dépôt, **sans copier de code amont** et sans installer d'éditeur tiers. Décision : [`ADR-017`](../adr/ADR-017-HTML-PREVIEW-CLICK-SELECTION.md). Le code de confiance du parent inspecte un iframe `srcDoc` avec `allow-same-origin`, **sans `allow-scripts`** et sous CSP restrictive. Les tests automatisés de cette sélection sont **simulés**, ce qui n'établit pas les garanties de sécurité en navigateur réel. Preuve globale : [run 43986355036](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/43986355036), SHA `eb29a9660ee5a4f33a4064994af645b227cfd884`, `npm run check`, **236 PASS, 0 FAIL, 0 SKIP**. **NOT_RUN :** essai Firefox/Chromium/DSH réel, attaque XSS, sanitisation complète, navigation des iframes et audit d'isolation. G0/G2 demeurent ouverts.

## Alpha.18 — Liaison locale HTML ↔ CSS (17 novembre 2026)

Le module interne `src/html-css-associations.mjs` lit les seules références CSS relatives et sûres au workspace et affiche les **correspondances possibles** `#id`/`.classe` pour des éléments HTML ayant un ID source unique. Il n'intègre ni framework, ni runtime tiers, et ne copie aucun code amont. Les fichiers sont ouverts et édités via les primitives natives existantes, avec les mêmes préconditions de révision. **Le rendu CSS externe, la cascade effective et `getComputedStyle` ne sont pas implémentés.** Architecture : [`ADR-018`](../adr/ADR-018-HTML-CSS-CANDIDATE-MAPPING.md). CI : [run 43988320991](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/43988320991), SHA `9e9e6f7310f7d83b016d6ec18a8d891becca628d`, `npm run check` sur Node 22, **249 PASS / 0 FAIL / 0 SKIP**. **G0 NOT_RUN, G1/G2 PARTIAL.**

## Alpha.19 — Prévisualisation responsive bornée (17 novembre 2026)

Le plugin embarque désormais un module interne indépendant `src/html-responsive-preview.mjs`, qui synthétise uniquement une **projection de déclarations CSS simples déjà validées** sans dépendances externes ni code repris de dépôts tiers. L'iframe HTML possède quatre largeurs d'affichage, mais le CSS calculé, les animations, les media queries des feuilles liées et la cascade complète restent hors périmètre. Voir [ADR-019](../adr/ADR-019-RESPONSIVE-CSS-PREVIEW.md) et [preuve alpha.19](../experiments/ALPHA19-EVIDENCE.md). CI : [run 43991894012](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/43991894012), commit source `e40daa813bedda34284b30d77e57eecd6216de1a`, Node 22 `npm run check`, **259 PASS, 0 FAIL, 0 SKIP**. **NOT_RUN** : navigateur réel, DSH Web/Desktop, tests visuels mobile, audit XSS/CSP ; G0/G1/G2/G4 ouverts.

## Alpha.20 — Préréglages de layout et dock compact (17 novembre 2026)

Les contrôles Flex/Grid et la navigation compacte sont implémentés directement dans le client DSH natif, sans intégration de bibliothèque visuelle tierce. Le stockage conserve sa logique de patches exacts HTML/CSS, et les colonnes Grid sont limitées à des préréglages strictement validés dans `src/html-visual.mjs`. La CI [run 43993385351](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/43993385351) sur le SHA `a88f340b8098cedef1a3e8847f37f320277aa237`, commande `npm run check` (Node 22), rapporte **269 PASS / 0 FAIL / 0 SKIP**. Il s'agit d'interactions simulées, **pas** d'une preuve de rendu/appareil réel. Architecture : [ADR-020](../adr/ADR-020-LAYOUT-PRESETS-AND-COMPACT-PANELS.md). **NOT_RUN :** DSH réel, rendu mobile, navigation clavier/lecteur d'écran, audit sécurité iframe et CSS complexe. G0/G1/G2/G4 ouverts.

## Import du texte PowerPoint

Le mode d’import de `src/presentation-pptx.py` utilise le même moteur optionnel python-pptx que l’export, sans ajouter de dépendance npm. Le Host lit un fichier PPTX du workspace, borne la taille de l’archive et crée une présentation HTML distincte par écriture exclusive. Les titres et paragraphes des cadres de texte de premier niveau sont éditables. Les tableaux, images, groupes, graphiques et la mise en page PowerPoint restent à couvrir.

Le test unitaire vérifie l’ordre, les IDs d’édition, les caractères Unicode et l’échappement HTML. Chromium et Firefox ont exécuté le parcours d’export et de réimport en mode headless. Le vrai Host DSH Web a répondu HTTP 201 au premier import et HTTP 409 au second, avec le PPTX source préservé. DSH Desktop et le tour d’assistant avec identifiants étaient désactivés pour cette validation.

L’import reconnaît aussi les tableaux PowerPoint de premier niveau. Il crée des cellules HTML avec IDs stables, en-têtes et fusions de lignes ou de colonnes. Le test unitaire vérifie une fusion horizontale et des paragraphes échappés. Les scénarios Chromium et Firefox vérifient l’import, l’édition d’une cellule depuis l’aperçu et la préservation des deux fichiers lors d’un second import. L’export PowerPoint a encore un rendu textuel des tableaux.

L’export reconstruit aussi les tableaux HTML sous forme de tableaux PowerPoint natifs. Les cellules et en-têtes restent éditables, les fusions rectangulaires sont conservées et un tableau aux fusions incompatibles est signalé avant téléchargement. La disposition est recalculée en 16:9, avec les objets texte et tableaux empilés dans l’ordre du document. Les styles CSS et la mise en forme riche interne des cellules ne sont pas reproduits. Le test en navigateur inspecte le tableau PowerPoint avec python-pptx, puis le réimporte et modifie une cellule depuis l’aperçu.

## Suppression réversible d’une diapositive

L’action utilise le même verrou et les mêmes préconditions de révision que l’édition HTML native. Elle retire uniquement la section sélectionnée, protège la dernière diapositive et conserve une inversion exacte dans l’historique. Les vérifications couvrent la cible absente, la dernière page, l’annulation et les octets sur disque.

## Mode diaporama HTML

Le lecteur ouvre une boîte modale dans le panneau DSH et démarre sur la diapositive sélectionnée. Les flèches, Page précédente/suivante, Début, Fin et Échap agissent sur le lecteur. Le rendu réutilise l’aperçu HTML isolé avec une iframe sans permissions et n’écrit aucun fichier. Les scénarios Chromium et Firefox vérifient la diapositive initiale, le clavier, le retour du focus et la préservation du HTML.

## Propositions IA sur la structure des présentations

L’outil DSH `design_studio_propose` accepte l’ajout, la duplication, le déplacement et la suppression d’une diapositive. Les opérations proposées partagent les mêmes fonctions de validation et de planification que les actions manuelles. La proposition reste dans la session du document et expose les différences avant et après. L’application vérifie à nouveau la révision et l’empreinte présentée, puis enregistre une opération annulable. Les tests invoquent l’outil directement et vérifient le parcours de validation en navigateur. Le test DSH Web sans identifiants ne déclenche aucun appel de modèle.

## Rotation des pages dans un assemblage PDF

Chaque sélection peut ajouter une rotation de 90°, 180° ou 270° aux pages qu’elle place dans la copie. Le Host assemble d’abord les pages avec Poppler et applique les rotations au document de sortie avec le moteur optionnel pypdf. L’assemblage sans rotation utilise toujours les outils Poppler seuls. Les tests navigateur vérifient l’angle par page, l’ordre, le texte sélectionnable et les fichiers sources intacts. Le test Host réel vérifie une copie tournée de 270°.

## Outils PDF dans le panneau d’espace de travail

Le panneau découvre les PDF par le même identifiant d’espace enregistré que les fichiers HTML et SVG. Il ouvre l’aperçu avec les outils de notes et de surlignage, ou le formulaire d’assemblage depuis la liste. Dans une conversation avec lecteur natif disponible, le fichier s’ouvre dans ce lecteur et les actions restent disponibles dans le panneau. Chromium et Firefox ont vérifié le périmètre de la requête d’aperçu et les deux voies d’accès. Le vrai DSH Web a ouvert les deux formulaires depuis un espace enregistré.

La sélection d’un assemblage PDF accepte les numéros isolés, les plages ascendantes et les plages descendantes dans le même champ. Le compteur affiche le nombre de pages de la copie en comptant les répétitions. L’expansion respecte la limite existante de 24 pages et conserve l’ordre avant l’envoi au Host. Les scénarios Chromium et Firefox vérifient la plage descendante, le refus d’une plage excessive et l’ordre du texte dans le téléchargement.

L’aperçu PDF affiche la page courante et le total, avec des commandes pour passer directement à la page précédente ou suivante. Le Host calcule le total et rend la page à partir des mêmes octets. Le changement de page invalide la révision utilisée pour un placement précédent et l’export annoté attend la fin du chargement. Le scénario navigateur vérifie les deux bornes et place une note après un aller-retour.

Le formulaire PDF peut préparer jusqu’à douze annotations sur plusieurs pages et les écrire dans une seule copie. Chaque entrée nécessite un aperçu et conserve l’identité et l’empreinte du PDF utilisé pour son placement. Le Host lit une seule version du fichier et refuse le lot entier si une entrée est périmée. Les tests navigateur inspectent la répartition native des notes sur deux pages. Le test du Host réel vérifie un lot note et surlignage ainsi que le refus d’un lot mixant deux révisions.

## Import du texte PDF en HTML

Le Host utilise Poppler pour extraire le texte sélectionnable et vérifier les limites de pages. L’import restitue des sections HTML par page avec des IDs stables sur les lignes, échappe le texte et crée le fichier voisin par écriture exclusive. Les PDF de plus de 32 pages sont refusés. Les pages sans texte sont signalées et un PDF entièrement sans texte ne crée aucun fichier. L’OCR, les polices et la reconstruction visuelle des objets restent à traiter. Une vérification directe a confirmé l’échappement de caractères HTML et le signalement d’une page vide. Le parcours navigateur ouvre la copie, modifie une ligne importée et vérifie les octets de l’original.

## Reconnaissance locale des pages PDF numérisées

L’action « Importer avec OCR » conserve le texte sélectionnable et traite uniquement les pages pour lesquelles Poppler n’en trouve pas. Elle rend ces pages en niveaux de gris et lance Tesseract en français et en anglais, sans service distant. La conversion accepte jusqu’à huit pages à reconnaître par import et signale les pages reconnues ou sans résultat dans le document de sortie HTML. Les pages mixtes qui comportent déjà du texte sélectionnable suivent l’extraction ordinaire. La mise en page n’est pas reconstruite.

Les parcours navigateur et DSH Web peuvent recevoir une fixture de deux pages raster via `DSH_E2E_OCR_FIXTURE`. Pour cette validation, la source de la fixture a été générée par `pdfFixture(['First scanned sentence','Second scanned sentence'])`, rendue en PGM avec `pdftoppm -r 180 -gray`, puis enregistrée en PDF multipage avec Pillow. L’extraction simple a refusé ce PDF sans texte et le mode OCR a reconnu les deux pages. Tesseract 5.5.0 et les données française et anglaise ont été extraits de paquets Ubuntu dans un dossier temporaire et n’entrent pas dans le bundle.

Les imports texte et OCR regroupent les lignes d’un même bloc en un paragraphe HTML éditable. Les lignes vides émises par l’extracteur marquent les séparations. Les blocs longs sont découpés à la limite de l’inspecteur pour rester éditables. Les tests navigateur couvrent une phrase répartie sur deux lignes dans le PDF et l’édition du texte sur une autre page. Les séparations dépendent de l’extracteur et le document conserve l’ordre de lecture qu’il fournit.

Les propositions IA HTML prennent aussi en charge le style en ligne et les attributs autorisés, à partir de l’ID source de l’élément. Les actions manuelles et les propositions partagent les mêmes fonctions de validation. Les tests d’outil couvrent la préparation d’une couleur et d’un attribut `title`, ainsi que le refus d’une URL CSS et d’un gestionnaire d’événement. Les scénarios navigateur vérifient la comparaison, la couleur calculée après approbation et l’annulation exacte.

Les propositions CSS peuvent modifier une déclaration dans un bloc `@media` simple de largeur minimale ou maximale. L’outil associe le sélecteur entier à la condition normalisée et refuse une paire ambiguë. L’inspecteur garde son adressage par position. Les scénarios navigateur approuvent puis annulent une proposition et comparent les octets de la feuille. La feuille du test comprend le même sélecteur en dehors du bloc, ce qui vérifie que la règle globale reste intacte.

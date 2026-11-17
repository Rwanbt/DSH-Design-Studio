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

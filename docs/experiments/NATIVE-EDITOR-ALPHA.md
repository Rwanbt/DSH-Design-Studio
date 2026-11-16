# Native editor alpha — P0/P1 experiment

**Status:** experimental `0.1.0-alpha.13` on a draft source branch (not released). GitHub Actions [run 43973328639](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/43973328639), tested source SHA `deb959be98d1807ef2ea0741a42d7c5356d48b54`: **195 PASS, 0 FAIL, 0 SKIP**. Interprocess writes now use a cooperating native lock; real DSH Desktop/Web installation and universal atomic CAS remain **NOT_RUN/NOT_IMPLEMENTED**. See [alpha.13 evidence](ALPHA13-EVIDENCE.md).

## What it can do

- Read an existing SVG, HTML/HTM or CSS file **relative to the current DSH session workspace**.
- **Browse and filter** existing SVG/HTML/CSS files from the live conversation's workspace using **Parcourir…**, then open them without manually typing a relative path. The picker excludes symlinks and hidden/vendor folders, caps the number of entries and does not disclose file contents.
- Show a sandboxed HTML/SVG preview (scripts forbidden, remote resources disallowed by its preview policy).
- **Outil Plume** : mode de dessin au pointeur (P), création d'un tracé natif au clic, segments droits par clics successifs et cubiques au clic-glissé, fermeture explicite, reprise des chemins ouverts depuis l'inspecteur ; Échap annule un geste non sauvegardé. Les lignes/contrôles existants continuent d'être modifiables manuellement et via les patches natifs, sans IA.
- **Points et segments SVG** : ajout d'un point au milieu d'un segment `L/Q/C` via un bouton **+** sur le canevas ou l'inspecteur, subdivision Bézier par De Casteljau (précision six décimales) et suppression conservatrice des seuls points terminant une ligne explicite `L`. Une seule commande de `d` est réécrite, sans reconstruire le SVG. Opérations annulables.
- **Tracés SVG natifs et poignées Bézier** : création d'une courbe cubique par le bouton **Tracé**, édition des ancres et des contrôles de chemins `M/L/Q/C/Z` absolus explicites, aperçu à l'écran pendant le glissement, écriture ciblée de deux nombres du chemin au relâchement, Annuler/Rétablir et annulation par Échap. Les chemins relatifs, arcs et structures complexes demeurent en lecture seule.
- **Grille et magnétisme** : affichage réglable, pas de 2 à 100 unités SVG, accrochage activable pour les déplacements/redimensionnements, et **repères intelligents** (centres/bords d'autres éléments ou du document) pour les déplacements. **Alt** désactive temporairement l'accrochage pour un placement libre. Ce sont des outils manuels : aucun token IA et aucune écriture tant que le pointeur n'est pas relâché.
- **Navigate the SVG canvas** without touching source: Select / Hand, drag pan (hand, middle-button or temporary Space), Ctrl/Cmd+wheel pointer-anchored zoom, wheel/trackpad pan, +/- zoom and Fit to recenter. Keyboard shortcuts V, H and 0. Zoom range 12.5%–800%; no tokens are needed.
- For simple SVGs with a `viewBox`, **directly click and drag** rectangles, circles and ellipses using an overlay. The drag gesture generates one atomic pair of native coordinate edits (`x`/`y` or `cx`/`cy`). Movement is shown by an outline while dragging and the SVG preview refreshes after save.
- **Resize** rectangles/ellipses from any of four corners, anchoring the opposite corner. Hold **Shift** to preserve their aspect ratio. Circle resizing is not yet supported.
- **Duplicate/Delete selected SVG layers** through checked source-span operations, with generated unique IDs, keyboard shortcuts Ctrl+D / Delete and in-session Undo/Redo. The experimental mapper currently supports direct children of the SVG root without nested graphics; unsupported cases fail rather than rewriting unknown markup. Executable SVG nodes are rejected.
- **Create** rectangles, circles, ellipses and **editable native SVG text objects** with manual toolbar buttons. The editor inserts a new native SVG element with a unique generated `shape-N` ID, without rewriting existing elements. Requires simple untransformed SVG with a root `viewBox` and an explicit closing `</svg>` tag.
- **Edit simple SVG text directly** by double-clicking its approximate selection area or using an inspectable text field. Supports simple text and the plugin's generated multiline `<tspan>` structure; rich nested text remains uneditable. Font family, size, weight, style, letter spacing and alignment may be edited only where corresponding SVG attributes already exist. User content is escaped for XML.
- **Nudge** a selected SVG shape with arrow keys by one SVG unit, or ten units with Shift.
- **Recover safely from uncertain saves**: if a write was acknowledged but the source cannot be reloaded, or a save reports a stale revision, the editor blocks further writes, clears uncertain history and offers a manual reload instead of silently continuing from stale content.
- **Undo/Redo** recorded manual saves via validated source inverse/forward patches. History is **in-memory per current browser editor session**, bounded to 30 entries and 2 MiB per entry; it is not persisted across DSH restart. External modifications must be reloaded and never silently overwritten.
- Show SVG node IDs in a layer list and manually edit an **existing** attribute (`fill`, `stroke`, `x`, `y`, `width`, `height`, `d`, etc.), provided the node has a **unique** `id`.
- Expand *Manual source editor* to edit and save native SVG/HTML/CSS text directly.
- Save native source with SHA-256 revision precondition; detect stale writes, reject invalid/ambiguous patches, keep inverse edits at API level. File writes use temporary-file replacement and source validation.
- Edit with **zero model calls**. AI integration is not implemented yet.

## Developer checkout and local checks

```sh
git clone --branch feat/native-file-persistence https://github.com/Rwanbt/DSH-Design-Studio.git
cd DSH-Design-Studio
npm run check
```

Native DSH bundle metadata is in `package.json` and `cordis.patch.yml`. The entrypoints are `src/plugin-host.mjs` and `client.js`. **Real DSH installation remains NOT_RUN**; install as a local bundle in a *disposable/test* Harness profile only, using that version's supported plugin manager. Do not replace or shadow another installed `dsh-design-studio` plugin until the name conflict and lifecycle are verified.

For a simple local manual test, place `examples/design.svg` inside the active session workspace, select **Parcourir…** or type the relative path and click **Open**. Select `rect #card`, choose `fill`, adjust its value and click **Apply without AI**. For a drag exercise, drag the `card` outline on the preview, release the pointer, and check that only `x` and `y` changed in the original SVG. Reopen the source file outside DSH and compare the changed bytes.

## Architecture

```text
DSH conversation.view (client.js)
    ↓ GET /design-studio-native/files?sessionId=... (read-only list)
    ↓ GET /design-studio-native/document?sessionId=...&file=...
    ↓ POST /design-studio-native/apply
DSH Host plugin (src/plugin-host.mjs)
    ↓ current session → workingDirectory
Native store (src/native-file-store.mjs)
    ↓ source hash + source-span precondition
SVG span selector (src/svg-attributes.mjs)
SVG geometry/drag constraints (src/svg-geometry.mjs)
Native patch engine (src/native-patch.mjs)
    ↓ existing SVG/HTML/CSS workspace file
```

## Limits and blockers

- **Pointer drag of basic SVG rectangles/circles/ellipses is experimental**: four corner resize handles for rectangles/ellipses; no edge handles, freehand drawing, multi-select, Bézier-node editor, groups, transforms, guides, snapping or full responsive property editor. The overlay uses rectangular hit areas, not exact painted-path hit testing. Some SVGs intentionally disable drag when geometries cannot be mapped safely. Tests simulate pointer events; real DSH browser gestures remain unverified.
- Shape creation is deliberately conservative: malformed, ambiguous, transformed, grouped or script-bearing SVG files are rejected rather than silently modified. The ID allocator is workspace-local, deterministic and does not yet support changing ID names through the GUI.
- Text hit areas are estimated from text length and font size, not exact glyph geometry. The inline text editor does not yet implement true font metrics or production-grade multiline layout. Selecting complex text falls back to source editing.
- SVG inspector only edits existing attributes of uniquely identified nodes. No XML DOM / general SVG parser; `<script>` and `<!DOCTYPE>` SVGs are rejected for inspector editing.
- HTML is previewed and source-editable, but **not yet visually selectable** with mapped CSS/DOM source edits.
- Undo/Redo toolbar is implemented for recent successful saves within the mounted UI; **persistent history across reload/restart is not implemented**.
- Source editor replaces whole document content on explicit save; only semantic SVG attribute modifications use minimal source spans. A file hash guards saves but source editor is not a syntax validator.
- Native edits use **both process-local serialization and an atomic directory lock shared between cooperating processes**, plus SHA preconditions and a last-minute on-disk recheck. **External editors do not honor the lock**, so true universal compare-and-swap is not guaranteed. A hard crash can leave a stale lock that must only be manually removed after confirming no active writer. Directory symlink/rename races require an isolation review before release.
- No external imagery or scripts in preview; HTML depending on external CSS/JS will not render identically to production.
- Native API fetch URLs are now origin-root (`/design-studio-native`) so they resolve correctly under nested conversation routes. This is covered by mocked client tests, **not** live DSH.
- No DSH Desktop or Web smoke test, no packaging/install success claim, no UI screenshot validation, no security review, no accessibility check and no Windows integration test yet.

## Gates

| Gate | Status |
|---|---|
| Core patch tests | PASS (GitHub Actions) |
| Native store round-trip tests | PASS (GitHub Actions) |
| Cross-process writer lock race and failure cleanup | PASS (GitHub Actions, separate Node processes) |
| External editor / NFS / OS race isolation | NOT_RUN |
| SVG targeted source-edit tests | PASS (GitHub Actions) |
| Mocked Host routes, client registration, lifecycle and pointer events | PASS (GitHub Actions) |
| Session workspace file discovery and mocked selection UI | PASS (GitHub Actions) |
| Zoom, pan, Fit, Space/middle-button navigation; post-zoom SVG drag | PASS (GitHub Actions event simulation) |
| Grid overlay, snapping, sibling alignment guides and Alt bypass | PASS (GitHub Actions client simulations) |
| Native SVG path parser, Bézier edit + creation and exact source undo | PASS (GitHub Actions unit/API tests) |
| Path node handles, live preview and Escape cancellation | PASS (GitHub Actions simulated client events) |
| Save/reload failure and stale revision UI recovery | PASS (GitHub Actions event simulation) |
| Actual DSH UI opening and selection | NOT_RUN |
| Runtime security isolation | NOT_RUN |
| SVG rectangle/circle/ellipse pointer drag (mocked) | PASS (GitHub Actions simulation) |
| Four-corner rectangle/ellipse resize with Shift, keyboard nudge, in-memory undo/redo | PASS (GitHub Actions unit simulations) |
| Manual SVG shape creation and native undo | PASS (GitHub Actions file/API tests) |
| SVG text content edits / multiline tspan / typography / text creation | PASS (GitHub Actions unit/API tests) |
| Inline editor, text inspector, Add Text UI (mocked client) | PASS (GitHub Actions client simulations) |
| Undo/redo native source round-trip and conflict rejection | PASS (GitHub Actions file/API integration tests) |
| Real DSH browser pointer interaction | NOT_RUN |
| Freehand vector drawing / Bézier handles | NOT_IMPLEMENTED |
| Real HTML visual source mapping | NOT_IMPLEMENTED |
| CI on multiple operating systems | NOT_RUN |

UI direction is documented in [V3 Graphite decision](../design/INTERFACE-V3-GRAPHITE.md). The separate HTML V3 concept is **not** this running plugin; the real plugin uses the native DSH React/Host shell and is only partially visually aligned so far.

**Do not merge to `main` or publish an npm release from this experimental branch without an explicit smoke test and review.**

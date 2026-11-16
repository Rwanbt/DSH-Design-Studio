# Native editor alpha — P0/P1 experiment

**Status:** experimental `0.1.0-alpha.3` (source branch, no release). Validated at commit `d2f37ab9cd83e4d56e4a0d63ef48d3345facf509`: [GitHub Actions run 43928519053](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/43928519053), **62 PASS, 0 FAIL, 0 SKIP**. These are Node tests and mocked Host/Client interactions; **real DSH installation is NOT_RUN**.

## What it can do

- Read an existing SVG, HTML/HTM or CSS file **relative to the current DSH session workspace**.
- Show a sandboxed HTML/SVG preview (scripts forbidden, remote resources disallowed by its preview policy).
- For simple SVGs with a `viewBox`, **directly click and drag** rectangles, circles and ellipses using an overlay. The drag gesture generates one atomic pair of native coordinate edits (`x`/`y` or `cx`/`cy`). Movement is shown by an outline while dragging and the SVG preview refreshes after save.
- **Resize** selected rectangles and ellipses using a south-east corner handle (the opposite corner remains anchored). Circle resizing is not yet supported.
- **Nudge** a selected SVG shape with arrow keys by one SVG unit, or ten units with Shift.
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

For a simple local manual test, place `examples/design.svg` inside the active session workspace, type the relative path in the plugin view and click **Open**. Select `rect #card`, choose `fill`, adjust its value and click **Apply without AI**. For a drag exercise, drag the `card` outline on the preview, release the pointer, and check that only `x` and `y` changed in the original SVG. Reopen the source file outside DSH and compare the changed bytes.

## Architecture

```text
DSH conversation.view (client.js)
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

- **Pointer drag of basic SVG rectangles/circles/ellipses is experimental**: one corner resize handle for rectangles/ellipses; no multi-corner resize, free drawing, multi-select, Bézier-node editor, groups, transforms, guides, snapping or full responsive property editor. The overlay uses rectangular hit areas, not exact painted-path hit testing. Some SVGs intentionally disable drag when geometries cannot be mapped safely. Tests simulate pointer events; real DSH browser gestures remain unverified.
- SVG inspector only edits existing attributes of uniquely identified nodes. No XML DOM / general SVG parser; `<script>` and `<!DOCTYPE>` SVGs are rejected for inspector editing.
- HTML is previewed and source-editable, but **not yet visually selectable** with mapped CSS/DOM source edits.
- Undo/Redo toolbar is implemented for recent successful saves within the mounted UI; **persistent history across reload/restart is not implemented**.
- Source editor replaces whole document content on explicit save; only semantic SVG attribute modifications use minimal source spans. A file hash guards saves but source editor is not a syntax validator.
- The native file store has *process-local* write serialization and a last-minute on-disk recheck; it **does not provide an atomic compare-and-swap across independent processes**, and directory symlink/rename races require a stronger isolation design before release.
- No external imagery or scripts in preview; HTML depending on external CSS/JS will not render identically to production.
- No DSH Desktop or Web smoke test, no packaging/install success claim, no UI screenshot validation, no security review, no accessibility check and no Windows integration test yet.

## Gates

| Gate | Status |
|---|---|
| Core patch tests | PASS (GitHub Actions) |
| Native store round-trip tests | PASS (GitHub Actions) |
| SVG targeted source-edit tests | PASS (GitHub Actions) |
| Mocked Host routes, client registration and pointer events | PASS (GitHub Actions) |
| Actual DSH UI opening and selection | NOT_RUN |
| Runtime security isolation | NOT_RUN |
| SVG rectangle/circle/ellipse pointer drag (mocked) | PASS (GitHub Actions simulation) |
| Rectangle/ellipse resize, keyboard nudge, in-memory undo/redo | PASS (GitHub Actions unit simulations) |
| Undo/redo native source round-trip and conflict rejection | PASS (GitHub Actions file/API integration tests) |
| Real DSH browser pointer interaction | NOT_RUN |
| Freehand vector drawing / Bézier handles | NOT_IMPLEMENTED |
| Real HTML visual source mapping | NOT_IMPLEMENTED |
| CI on multiple operating systems | NOT_RUN |

**Do not merge to `main` or publish an npm release from this experimental branch without an explicit smoke test and review.**

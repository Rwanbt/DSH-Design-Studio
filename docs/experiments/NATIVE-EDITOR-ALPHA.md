# Native editor alpha — P0/P1 experiment

**Status:** `0.1.0-alpha.1`, experimental and **not production-ready**. Last automated validation: [GitHub Actions run 43922834817](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/43922834817) on head `20b49e91fd8a124383fa551a212c484c6d799213`: **39 PASS, 0 FAIL, 0 SKIP** from `npm run check`. This run validates Node modules, mocked host routes and mocked client registration — **NOT** a real DSH installation.

## What it can do

- Read an existing SVG, HTML/HTM or CSS file **relative to the current DSH session workspace**.
- Show a sandboxed HTML/SVG preview (scripts forbidden, remote resources disallowed by its preview policy).
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

For a simple local manual test, place `examples/design.svg` inside the active session workspace, type the relative path in the plugin view and click **Open**. Select `rect #card`, choose `fill`, adjust its value and click **Apply without AI**. Reopen the source file outside DSH and compare the changed bytes.

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
Native patch engine (src/native-patch.mjs)
    ↓ existing SVG/HTML/CSS workspace file
```

## Limits and blockers

- **No drag-to-move, free drawing, multi-select, Bézier handle editor, guides, snapping, or full responsive property editor yet.** Initial SVG layers are selected by list, not by clicking the preview.
- SVG inspector only edits existing attributes of uniquely identified nodes. No XML DOM / general SVG parser; `<script>` and `<!DOCTYPE>` SVGs are rejected for inspector editing.
- HTML is previewed and source-editable, but **not yet visually selectable** with mapped CSS/DOM source edits.
- No persisted undo/redo UI. Patch engine exposes inverse spans, which is not the same as a durable editor history.
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
| Mocked Host routes and client registration | PASS (GitHub Actions) |
| Actual DSH UI opening and selection | NOT_RUN |
| Runtime security isolation | NOT_RUN |
| Freehand/vector mouse interactions | NOT_IMPLEMENTED |
| Real HTML visual source mapping | NOT_IMPLEMENTED |
| CI on multiple operating systems | NOT_RUN |

**Do not merge to `main` or publish an npm release from this experimental branch without an explicit smoke test and review.**

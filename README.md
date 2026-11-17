# DSH Design Studio

Native visual design workspace for **DeepSeek Harness**: edit real **SVG, HTML and CSS** files manually, with AI, or in a hybrid workflow.

> Status: **P0/P1 — experimental, `dev` only.** A native DeepSeek Harness Host/Client prototype edits real **SVG, HTML and CSS** files through byte-exact, revision-checked source patches, fully offline and without AI credentials: SVG primitive creation, direct manipulation with grid/snap/smart guides, hierarchical layers with group/ungroup, group dragging, visibility and lock, pivot rotation and scaling through normalised matrices, Bézier point/topology editing and a manual Pen, native SVG text and typography, HTML click-to-select in an inert preview frame with text and allowlisted attribute editing, linked-CSS inspection with selector lists and custom properties, bounded responsive previews, and cross-process write protection with exact Undo/Redo.
> **Verification:** 397 core tests, a real Chromium + Firefox gate, and a real DeepSeek Harness installation test. The real installation proves registration, the Host routes, a real save and a refused stale revision; opening the workbench *inside* the real conversation is still **NOT_RUN** because DSH renders no view area for a blank session (see `docs/roadmap/DELIVERY-GATES-2026-11-17.md`). **Not production ready.**

## Non-negotiable principles

- **Manual-first**: selecting, dragging, resizing, styling, drawing, undo/redo and saving must work without AI tokens or provider credentials.
- **Native open files**: SVG, HTML and CSS are canonical; optional, documented JSON stores editor-only metadata.
- **Shared editing semantics**: user and agent edits use validated transactional commands, with revision checks and undo/redo.
- **No silent overwrites**: source snapshots, diffs and conflicts are explicit.
- **Native DSH integration**: installable sidebar/workbench plugin, not a separate desktop application.
- **Licensing**: project MIT; reusable third-party code only after per-file/dependency license verification. Preserve required MIT and Apache-2.0 notices; source-available implementations are reference-only without permission.
- **Security**: no unrestricted filesystem paths or untrusted script execution in the editor origin.

## Initial scope

1. Visual **HTML/CSS** editing with precise source write-back, responsive preview and round-trip integrity.
2. Visual **SVG** editing including geometry, layers, path/node manipulation and loss-conscious round trips.
3. Optional agent tooling on the same document model.
4. Presentations and broader creative tools **after** the HTML/SVG foundations are proven.

## Development

- `main`: stable documentation and reviewed changes.
- `dev`: integration branch — the only working branch. No long-lived `feat/*`
  branches: temporary branches are deleted immediately after the squash merge.
- Never force-push, never edit `main` without the owner's explicit approval.

```bash
npm run check        # core suite: 397 tests, zero dependencies to install
npm run test:browser # real Chromium + Firefox gate (needs npm install + browsers)
npm run test:dsh     # real DeepSeek Harness installation, disposable profile
npm run sbom         # regenerate docs/operations/SBOM.json
```

Read `docs/roadmap/IMPLEMENTATION-PLAN.md` and `docs/audits/SOURCE-MATRIX.md` on `dev`. See [`docs/experiments/NATIVE-EDITOR-ALPHA.md`](docs/experiments/NATIVE-EDITOR-ALPHA.md) for test evidence and limitations, plus [`docs/design/INTERFACE-V3-GRAPHITE.md`](docs/design/INTERFACE-V3-GRAPHITE.md) for the approved but unfinished UI direction (graphite, not pervasive blue).

### Experimental alpha

For the next execution plan, read [the post-merge GOAL](docs/roadmap/GOAL-POST-MERGE-2026-11-17.md). See [alpha.20 evidence](docs/experiments/ALPHA20-EVIDENCE.md) for 269 automated tests, native Flexbox/Grid presets and the compact workbench dock. Architecture: [ADR-017](docs/adr/ADR-017-HTML-PREVIEW-CLICK-SELECTION.md), [ADR-018](docs/adr/ADR-018-HTML-CSS-CANDIDATE-MAPPING.md) and [ADR-019](docs/adr/ADR-019-RESPONSIVE-CSS-PREVIEW.md) and [ADR-020](docs/adr/ADR-020-LAYOUT-PRESETS-AND-COMPACT-PANELS.md). A consolidated gate-by-gate backlog is in [delivery gates](docs/roadmap/DELIVERY-GATES-2026-11-17.md).

Run `npm run check` with Node.js 22+ to execute the native patch/store, SVG adapter, Host route and client tests. No model credentials are needed. Three verification levels are defined in [ADR-021](docs/adr/ADR-021-VERIFICATION-TIERS.md), and every claim cites the level that was actually executed. The native bundle is `@rwanbt/dsh-design-studio` and does **have** a verified real installation path, but it is **not** a stable release: see [install guide](docs/operations/INSTALL.md), [release checklist and GO/NO-GO](docs/operations/RELEASE-DECISION-2026-11-17.md), [SBOM](docs/operations/SBOM.json) and [NOTICE](NOTICE). `examples/design.svg` is a sample document to open relative to a DSH session workspace. The **Parcourir…** picker lists supported files directly from the active conversation workspace, without searching unrelated local directories.

## Sources and attribution

The candidate repos and their verified license files are tracked in the source matrix. Their names and functionality descriptions do **not** mean code has been copied or integrated.

## License

MIT — see `LICENSE`.

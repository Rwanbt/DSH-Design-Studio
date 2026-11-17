# DSH Design Studio

Native visual design workspace for **DeepSeek Harness**: edit real **SVG, HTML and CSS** files manually, with AI, or in a hybrid workflow.

> Status: **P0/P1 — experimental alpha.20 on `feat/native-file-persistence`**. A native DSH Host/Client prototype supports SVG primitive creation, moving, resizing, properties, direct SVG layer duplicate/delete, session workspace file browsing, zoom/pan/fit canvas navigation, configurable grid/snap/smart guides, conservative Bézier point/topology editing and manual Pen drawing, and recovery after uncertain saves, cross-process cooperative write locks, revision identity tokens and guarded parent-directory identity checks, simple native SVG text editing, an initial HTML inline CSS inspector with parent-controlled scriptless preview click selection, a standalone CSS rule inspector, HTML↔CSS source associations, responsive HTML viewport presets and a bounded partial preview of validated local CSS declarations, one-property native Flexbox/Grid preset controls, and a container-responsive single-panel dock for narrow DSH workspaces, plus manual SVG/HTML/CSS source editing. Simulated host/client tests pass; **real DSH installation, visual UX and production readiness remain unverified**.

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
- `dev`: integration branch.
- Feature work on `feat/*` branches with tests and review.

Read `docs/roadmap/IMPLEMENTATION-PLAN.md` and `docs/audits/SOURCE-MATRIX.md` on `dev`. See [`docs/experiments/NATIVE-EDITOR-ALPHA.md`](docs/experiments/NATIVE-EDITOR-ALPHA.md) for test evidence and limitations, plus [`docs/design/INTERFACE-V3-GRAPHITE.md`](docs/design/INTERFACE-V3-GRAPHITE.md) for the approved but unfinished UI direction (graphite, not pervasive blue).

### Experimental alpha

See [alpha.20 evidence](docs/experiments/ALPHA20-EVIDENCE.md) for 269 automated tests, native Flexbox/Grid presets and the compact workbench dock. Architecture: [ADR-017](docs/adr/ADR-017-HTML-PREVIEW-CLICK-SELECTION.md), [ADR-018](docs/adr/ADR-018-HTML-CSS-CANDIDATE-MAPPING.md) and [ADR-019](docs/adr/ADR-019-RESPONSIVE-CSS-PREVIEW.md) and [ADR-020](docs/adr/ADR-020-LAYOUT-PRESETS-AND-COMPACT-PANELS.md). A consolidated gate-by-gate backlog is in [delivery gates](docs/roadmap/DELIVERY-GATES-2026-11-17.md).

Run `npm run check` with Node.js 22+ to execute the native patch/store, SVG adapter and mocked DSH Host/Client tests. No model credentials are needed. The native bundle is `@rwanbt/dsh-design-studio`; **do not treat it as a tested installer or stable release**. `examples/design.svg` is a sample document to open relative to a DSH session workspace. The alpha.7 **Parcourir…** picker can list supported files directly from the active conversation workspace, without searching unrelated local directories.

## Sources and attribution

The candidate repos and their verified license files are tracked in the source matrix. Their names and functionality descriptions do **not** mean code has been copied or integrated.

## License

MIT — see `LICENSE`.

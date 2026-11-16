# DSH Design Studio

Native visual design workspace for **DeepSeek Harness**: edit real **SVG, HTML and CSS** files manually, with AI, or in a hybrid workflow.

> Status: **P0/P1 — experimental alpha on `feat/native-file-persistence`**. A first native DSH plugin shell, SVG attribute inspector and source editor are implemented. Their mocked API and registration tests pass; actual DSH installation, mouse editing and production readiness remain **unverified**.

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

Read `docs/roadmap/IMPLEMENTATION-PLAN.md` and `docs/audits/SOURCE-MATRIX.md` on `dev`. See [`docs/experiments/NATIVE-EDITOR-ALPHA.md`](docs/experiments/NATIVE-EDITOR-ALPHA.md) for the current manual editor prototype and its limitations.

### Experimental alpha

Run `npm run check` with Node.js 22+ to execute the native patch/store, SVG adapter and mocked DSH Host/Client tests. No model credentials are needed. The native bundle is `@rwanbt/dsh-design-studio`; **do not treat it as a tested installer or stable release**. `examples/design.svg` is a sample document to open relative to a DSH session workspace.

## Sources and attribution

The candidate repos and their verified license files are tracked in the source matrix. Their names and functionality descriptions do **not** mean code has been copied or integrated.

## License

MIT — see `LICENSE`.

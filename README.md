# DSH Design Studio

Native visual design workspace for **DeepSeek Harness**: edit real **SVG, HTML and CSS** files manually, with AI, or in a hybrid workflow.

> Status: **P0 — discovery and architecture**. This repository does not yet contain a working editor. No runtime compatibility or production readiness is claimed.

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

Read `docs/roadmap/IMPLEMENTATION-PLAN.md` and `docs/audits/SOURCE-MATRIX.md` on `dev`. Initial work is an audit, not a wholesale merge.

## Sources and attribution

The candidate repos and their verified license files are tracked in the source matrix. Their names and functionality descriptions do **not** mean code has been copied or integrated.

## License

MIT — see `LICENSE`.

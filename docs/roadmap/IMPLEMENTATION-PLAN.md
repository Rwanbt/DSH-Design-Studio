# DSH Design Studio — implementation roadmap

Status: **P0 in progress**, created 2026-11-16. No working plugin, benchmarks, native editor tests or passed release gates have been claimed.

## Product contract

A native DeepSeek Harness workbench with manually operable HTML/CSS and SVG editors, optional AI using the *same validated editing commands*, and reliable editing of real workspace files.

### Gates applying to every phase

- Link each claim to a reproducible command and output plus an exact repository commit SHA.
- `SKIP`, `NOT_RUN` or untested screenshots never count as `PASS`.
- No silent overwriting and no code import without license and attribution verification.
- User can edit and save without model credentials, internet or token consumption.
- UI must remain consistent with DSH on desktop; small screens receive a separate ergonomic evaluation.
- Stable `main` gets only reviewed changes from `dev`.

## P0 — verified audit and architecture (current)

- Audit actual source trees (client/host), DSH lifecycle and extension points.
- Audit dependencies, licensing, bundled editor engines and security boundaries.
- Compare native editing operations and identify reusable units, incompatibilities and missing features.
- Prototype round-trip fixtures: native SVG and HTML+CSS preserved after **no-op** save and targeted edits.
- Record ADRs and risk register; decide shell and editors only after evidence.
- **Exit:** code-backed source matrix; architecture ADRs; explicit COPY/ADAPT/REIMPLEMENT classifications; feasibility proof.

## P1 — manual workspace/editor foundation

- Native DSH tab/panel, workspace file browser, open/save and safe file boundary.
- Shared command protocol: stable node IDs, base revision, affected ranges, inverse operation, provenance and transactional commit.
- Layer tree, selection, move/resize, keyboard controls, property inspector and undo/redo.
- **Exit:** testable manual editing, zero API calls, persistence/reopen, deterministic tests.

## P2 — HTML/CSS native edition

- Select DOM nodes in a sandboxed preview and map to source safely.
- Attribute/text/style edits, responsive breakpoints, layout inspector (Flexbox/Grid).
- Refuse unsafe/ambiguous changes rather than rewriting unrelated code.
- Preserve external CSS, formatting, scripts and project structure; dynamic component frameworks are separate opt-in adapters.
- **Exit:** round-trip fixtures and source diff assertions; conflict-handling tests.

## P3 — SVG native edition

- Paths/nodes, Bézier handles, shapes, transforms, alignment, grouping, layers, viewBox, fills/strokes, masks/gradients.
- Preserve namespaces, ids, defs, unknown elements and geometry where possible; no-op must be byte-stable.
- Set visible unsupported-feature warnings with lossless fallback, never silently flatten.
- **Exit:** import/edit/save/reopen fixtures from diverse SVGs; rendering and diff checks.

## P4 — optional AI/human hybrid

- Expose read/inspect/preview/apply tool surface using same command executor as UI.
- Explicit diff, approval/undo, revision compare-and-swap and conflict resolution.
- Send context scoped to selected nodes/target operations; never require model for manual actions.
- **Exit:** concurrent human/agent changes tested and no secret/path leaks.

## P5 — design systems and UX

- Tokens, assets, reusable components, grids/guides/snapping, keyboard shortcuts, responsive PC/mobile layouts.
- Accessibility, performance on large files, dark/light modes and recovery.
- **Exit:** UX scenarios and performance budgets verified on target DSH versions.

## P6 — packaging and release candidate

- CI, dependency/SBOM/license checks, cross-platform installation, migration and rollback.
- Tested integration on DSH Desktop and Web, signed-off documentation, changelog and notices.
- **Exit:** explicit GO/NO-GO; do not declare production ready without completed gates.

## Backlog ordering

1. P0-01 Pin upstream SHAs and inspect manifests/source trees.
2. P0-02 Audit open-source licenses, copied assets and dependency graph.
3. P0-03 Check DSH host/client API contracts and compatibility.
4. P0-04 Compare manual canvas/HTML source write-back/vector integration.
5. P0-05 Define canonical source editing and document command protocol.
6. P0-06 Create round-trip tests and select technical base.

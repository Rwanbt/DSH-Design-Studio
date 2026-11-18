# DSH Design Studio

An **internal plugin for DeepSeek Harness** — not a separate application. It adds a
native `conversation.view` to the host, so it inherits DSH's theme, language and
session workspace, and edits real **SVG, HTML and CSS** files manually (an optional
AI workflow is planned on the same transactional API).

> Status: **P0/P1 — experimental.** `dev` is the integration branch; `main` is pinned at an older, owner-approved state and is **not** moved by this work. A native DeepSeek Harness Host/Client prototype edits real **SVG, HTML and CSS** files through byte-exact, revision-checked source patches, fully offline and without AI credentials: creation of new documents from the workbench (never replacing an existing file, ADR-025), SVG primitive creation, direct manipulation with grid/snap/smart guides, hierarchical layers with group/ungroup, group dragging, visibility and lock, pivot rotation and scaling through normalised matrices, Bézier point/topology editing and a manual Pen, native SVG text and typography, HTML click-to-select in an inert preview frame with text and allowlisted attribute editing, linked-CSS inspection with selector lists and custom properties, bounded responsive previews, and cross-process write protection with exact Undo/Redo. It is reachable from the DSH sidebar: the panel lists the registered workspaces, edits the selected one and never sends a filesystem path.
> **Verification (18 November 2026, `dev`):** **531 core tests** (`npm run check`, zero runtime dependencies), a real **Chromium 145 + Firefox 146** gate (**130 runs, 65 specs × 2 engines**), and a real DeepSeek Harness installation in disposable profiles: the **Web** app passes a credential-free sidebar workflow (**31 PASS / 0 FAIL / 6 NOT_RUN**, real save, byte-exact Undo/Redo, reopen, HTML/CSS creation and edits, measured 1280/768/390 previews, refused external conflict, conditional CSS edit). The **Desktop (Electron)** shell was verified in an earlier session; it is **NOT_RUN** for the current UI and is therefore outside the certified scope. Also `NOT_RUN`: a real assistant turn without credentials, CSP/account console diagnostics as a security proof, macOS, NFS/SMB, real touch devices and screen readers. Evidence lives in `docs/operations/` (`REAL-WEB-2026-11-18.md`, `BASELINE-2026-11-18.md`, `PERFORMANCE-BUDGETS-2026-11-18.md`). **Not production ready.**

## Non-negotiable principles

- **Manual-first**: selecting, dragging, resizing, styling, drawing, undo/redo and saving must work without AI tokens or provider credentials.
- **Native open files**: SVG, HTML and CSS are canonical; optional, documented JSON stores editor-only metadata.
- **Shared editing semantics**: user and agent edits use validated transactional commands, with revision checks and undo/redo.
- **No silent overwrites**: source snapshots, diffs and conflicts are explicit.
- **Native DSH integration**: a bundle installed into a DSH profile, rendered as a `conversation.view` **and as a sidebar cell with its own panel** (ADR-024) that edits a registered workspace by id; no own process, window, port or build, and no colours pinned outside the host theme tokens (ADR-023).
- **Licensing**: project MIT; reusable third-party code only after per-file/dependency license verification. Preserve required MIT and Apache-2.0 notices; source-available implementations are reference-only without permission.
- **Security**: no unrestricted filesystem paths or untrusted script execution in the editor origin.

## Initial scope

1. Visual **HTML/CSS** editing with precise source write-back, responsive preview and round-trip integrity.
2. Visual **SVG** editing including geometry, layers, path/node manipulation and loss-conscious round trips.
3. Optional agent tooling on the same document model.
4. Presentations and broader creative tools **after** the HTML/SVG foundations are proven.

## Development

- `main`: pinned at `67870f7` and moved only by the owner's explicit approval.
  `dev` is ahead of it; an aligned branch would not by itself be a release.
- `dev`: integration branch — the only working branch. No long-lived `feat/*`
  branches: temporary branches are deleted immediately after the squash merge.
- Never force-push; `main` moves only with the owner's explicit approval, and
  only when `dev` is green (`npm run check`, `npm run test:browser`).

```bash
npm run check        # core suite: 531 tests, zero dependencies to install
npm run test:browser # real Chromium + Firefox gate: 130 runs (needs npm install + browsers)
npm run test:dsh     # real DeepSeek Harness installation, disposable profile
npm run benchmark    # reproducible engine benchmark, 100 to 10 000 elements
npm run sbom         # regenerate docs/operations/SBOM.json
```

Read `docs/roadmap/IMPLEMENTATION-PLAN.md` and `docs/audits/SOURCE-MATRIX.md` on `dev`. See [`docs/experiments/NATIVE-EDITOR-ALPHA.md`](docs/experiments/NATIVE-EDITOR-ALPHA.md) for test evidence and limitations, plus [`docs/design/INTERFACE-V3-GRAPHITE.md`](docs/design/INTERFACE-V3-GRAPHITE.md) for the approved but unfinished UI direction (graphite, not pervasive blue).

### Experimental alpha

For the next execution plan, read [the post-merge GOAL](docs/roadmap/GOAL-POST-MERGE-2026-11-17.md). See [alpha.20 evidence](docs/experiments/ALPHA20-EVIDENCE.md) for 269 automated tests, native Flexbox/Grid presets and the compact workbench dock. Architecture: [ADR-017](docs/adr/ADR-017-HTML-PREVIEW-CLICK-SELECTION.md), [ADR-018](docs/adr/ADR-018-HTML-CSS-CANDIDATE-MAPPING.md) and [ADR-019](docs/adr/ADR-019-RESPONSIVE-CSS-PREVIEW.md) and [ADR-020](docs/adr/ADR-020-LAYOUT-PRESETS-AND-COMPACT-PANELS.md). A consolidated gate-by-gate backlog is in [delivery gates](docs/roadmap/DELIVERY-GATES-2026-11-17.md).

Run `npm run check` with Node.js 22+ to execute the native patch/store, SVG adapter, Host route and client tests. No model credentials are needed. Three verification levels are defined in [ADR-021](docs/adr/ADR-021-VERIFICATION-TIERS.md), and every claim cites the level that was actually executed. The native bundle is `@rwanbt/dsh-design-studio` and does **have** a verified real installation path, but it is **not** a stable release: see [install guide](docs/operations/INSTALL.md), [release checklist and GO/NO-GO](docs/operations/RELEASE-DECISION-2026-11-17.md), [SBOM](docs/operations/SBOM.json) and [NOTICE](NOTICE). `examples/design.svg` is a sample document to open relative to a DSH session workspace. The **Parcourir…** picker lists supported files directly from the active conversation workspace, without searching unrelated local directories. The same panel creates new documents (`+ SVG`, `+ HTML`, `+ CSS`) from native templates: the Host refuses an existing path with `already-exists` instead of replacing it, and never creates directories implicitly ([ADR-025](docs/adr/ADR-025-NATIVE-DOCUMENT-CREATION.md)). A **right-click menu** on any canvas shape or layer row exposes the same operations as the inspector (duplicate, copy, paste, paint order, delete, group, hide, lock), and `Ctrl+C` / `Ctrl+V` copy a layer's exact bytes — into the same document or another one — with the fragment re-validated by the Host and every id rewritten ([ADR-028](docs/adr/ADR-028-CONTEXT-MENU-AND-CLIPBOARD.md)). It also **renames and permanently deletes** those documents from the same list, behind an explicit confirmation that names the exact path: both operations require the opened revision, a rename never replaces an occupied name, a delete only ever removes one regular non-hardlinked SVG/HTML/CSS file inside the workspace, and there is no recycle bin ([ADR-027](docs/adr/ADR-027-DESTRUCTIVE-FILE-OPERATIONS.md)).

## Sources and attribution

The candidate repos and their verified license files are tracked in the source matrix. Their names and functionality descriptions do **not** mean code has been copied or integrated.

## License

MIT — see `LICENSE`.


### Interactive UI reference (Graphite V3)

The [interactive HTML mockup](docs/design/DSH-Design-Studio-V3-Graphite-interactive.html) is committed on `dev` and is the visual reference the native workbench now follows: its shell geometry, surface shades, tool icons and inspector sections are reproduced in `client.js` and compared against the file itself by the browser gate (`tests/browser/specs/graphite-reference.mjs`). The palette is scoped to the editor ([ADR-026](docs/adr/ADR-026-EXACT-GRAPHITE-WORKBENCH.md)). The mockup remains a design reference, not an implementation: functional parity, security boundaries and native write-back are proven separately, and the running DSH window is still `NOT_RUN` for this shell.

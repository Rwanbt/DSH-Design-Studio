# Agent instructions

Read `README.md`, all accepted ADRs, `docs/roadmap/IMPLEMENTATION-PLAN.md` and `docs/audits/SOURCE-MATRIX.md` before editing code.

Use `dev` as the integration/work branch. Keep the long-lived remote branch set to **only `main` and `dev`**. Create temporary branches only if GitHub protection requires a PR and delete them immediately upon merging. Never edit or merge into `main` without explicit user approval. Never force-push. Multi-agent work must use clear file ownership and avoid concurrent uncoordinated edits. Report observed files, SHAs, executed commands, output and honest PASS/FAIL/NOT_RUN state.

During P0 do **not** import upstream code, vendor binaries or install an editor runtime without first checking its source/license, pinned SHA and compatibility. Prefer minimal, repeatable experiments over speculative architecture.

Every manual editor feature must work without AI credentials or token calls. Real native SVG, HTML and CSS remain canonical. JSON is optional metadata. Never silently overwrite concurrent edits. Treat untrusted HTML/SVG, browser origins, file paths, scripts and external resources as security boundaries.

Do not claim production ready or tests passed based on README claims alone. Update the audit matrix with direct evidence and preserve required third-party notices.

Post-squash merge execution plan: `docs/roadmap/GOAL-POST-MERGE-2026-11-17.md`. Always verify the actual branch refs, source files, test commands and CI outputs. An alpha CI PASS never substitutes for real DSH Desktop/Web tests, browser security validation or safe external-editor filesystem CAS.

## Verification levels (mandatory before claiming anything works)

Three levels are defined in `docs/adr/ADR-021-VERIFICATION-TIERS.md`. Always name the
level you actually executed, and never promote a lower level to a higher one:

1. `npm run check` — pure modules and host logic. No dependencies needed.
2. `npm run test:browser` — real Chromium and Firefox against the real
   `src/plugin-host.mjs` handler and a real temporary filesystem. Only the DSH
   client shell is simulated.
3. `npm run test:dsh` — a real DeepSeek Harness installation in a disposable
   `DSH_HOME`/`HOME`, real web app, real session, real Host routes. Requires an
   installed DSH and Playwright; missing environments must be reported as
   `NOT_RUN`, never as success.

`npm run sbom` regenerates `docs/operations/SBOM.json`; the runtime dependency set
must stay empty and the test-only devDependencies are recorded in `NOTICE`.

## UI reference for agents

Before redesigning any editor workbench UI, inspect `docs/design/DSH-Design-Studio-V3-Graphite-interactive.html` **and** `docs/design/INTERFACE-V3-GRAPHITE.md`. The HTML is the actual interactive Graphite V3 visual reference: dominant canvas, compact tool strip, layers, contextual inspector, warm graphite/stone accents, and editable SVG text. Preserve the host-native DSH architecture and theme tokens; translate the visual hierarchy, do not paste the standalone HTML as the plugin implementation. Verify proposed changes in the real DSH workbench, compare screenshots and interactions to the reference, and report differences. The initial mockup is a design direction, not a claim of final professional UX or production-readiness.

# Agent instructions

Read `README.md`, all accepted ADRs, `docs/roadmap/IMPLEMENTATION-PLAN.md` and `docs/audits/SOURCE-MATRIX.md` before editing code.

Use `dev` as the integration/work branch. Keep the long-lived remote branch set to **only `main` and `dev`**. Create temporary branches only if GitHub protection requires a PR and delete them immediately upon merging. Never edit or merge into `main` without explicit user approval. Never force-push. Multi-agent work must use clear file ownership and avoid concurrent uncoordinated edits. Report observed files, SHAs, executed commands, output and honest PASS/FAIL/NOT_RUN state.

During P0 do **not** import upstream code, vendor binaries or install an editor runtime without first checking its source/license, pinned SHA and compatibility. Prefer minimal, repeatable experiments over speculative architecture.

Every manual editor feature must work without AI credentials or token calls. Real native SVG, HTML and CSS remain canonical. JSON is optional metadata. Never silently overwrite concurrent edits. Treat untrusted HTML/SVG, browser origins, file paths, scripts and external resources as security boundaries.

Do not claim production ready or tests passed based on README claims alone. Update the audit matrix with direct evidence and preserve required third-party notices.

Post-squash merge execution plan: `docs/roadmap/GOAL-POST-MERGE-2026-11-17.md`. Always verify the actual branch refs, source files, test commands and CI outputs. An alpha CI PASS never substitutes for real DSH Desktop/Web tests, browser security validation or safe external-editor filesystem CAS.

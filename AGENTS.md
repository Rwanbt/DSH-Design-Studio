# Agent instructions

Read `README.md`, all accepted ADRs, `docs/roadmap/IMPLEMENTATION-PLAN.md` and `docs/audits/SOURCE-MATRIX.md` before editing code.

Work from `dev` or a `feat/*` branch, not direct production changes to `main`. Report observed files, SHAs, executed commands, output and honest PASS/FAIL/NOT_RUN state.

During P0 do **not** import upstream code, vendor binaries or install an editor runtime without first checking its source/license, pinned SHA and compatibility. Prefer minimal, repeatable experiments over speculative architecture.

Every manual editor feature must work without AI credentials or token calls. Real native SVG, HTML and CSS remain canonical. JSON is optional metadata. Never silently overwrite concurrent edits. Treat untrusted HTML/SVG, browser origins, file paths, scripts and external resources as security boundaries.

Do not claim production ready or tests passed based on README claims alone. Update the audit matrix with direct evidence and preserve required third-party notices.

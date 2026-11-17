# Session report — post-merge autonomous run (17 November 2026)

**Baseline:** `dev` @ `c97101e` (PR #8 squash `c2f1747` already integrated), `npm run check` **269 pass / 0 fail / 0 skip**, Node v24.19.0, Linux x64.
**Work branch:** `dev` only. `main` untouched. Remote heads: `main` + `dev` (the merged `feat/native-file-persistence` was deleted after verifying its tip was byte-identical to the squash commit).

## 1. What actually changed

### Git cleanup (phase 0)

- Verified PR #8 `MERGED` into `dev` at `c2f17475ff7ea730cf543d4e3ee20a57a1f8a776` through the GitHub API.
- Verified `git diff --exit-code c2f1747 origin/feat/native-file-persistence` → exit 0 (identical trees; the histories diverge, as expected after a squash).
- Deleted the remote branch, pruned, and confirmed `git ls-remote --heads origin` returns exactly `dev` and `main`.

### Verification capability (the structural gap)

The alpha evidence was string-level and React-simulated: **no browser had ever run the client**. Two honest tiers now exist:

| Tier | What is real | What is simulated | Where |
|---|---|---|---|
| Browser gate | Chromium 145 and Firefox 146, real DOM, pointer/keyboard events, iframes, CSP, sandbox, the real `src/plugin-host.mjs` route handler, a real temporary filesystem | only the DSH client shell (`__ModuleLoader__`, `require('react')`, `ctx.slots`) | `tests/browser/` |
| Real DSH | the installed DeepSeek Harness 0.2.2-rc.3 binary, the `dsh` CLI, a disposable `DSH_HOME`/`HOME`, a fresh profile from the shipped `web` template, the real web app, a real session, the real Host routes and a real save | the registered workspace is seeded in the disposable profile's store because a headless host cannot open the native folder picker | `tests/e2e/real-dsh.mjs` |

### Product defects found and fixed (each was invisible to the alpha CI)

1. **The client bundle was never served in a real DSH.** DSH requests `<package>/client.js`; the exports map only exposed `./client`, so Node threw `ERR_PACKAGE_PATH_NOT_EXPORTED` and the bundle was dropped silently — no error, no view. Fixed the exports map and reduced `dsh.client.inject` to the real service (`slots`), after discovering the declared `@deepseek-ai/dsh-client-ui-slots` package does not exist in any profile.
2. **Selection handles drifted from the artwork.** The artboard was sized from width only, so a wide `viewBox` overflowed the canvas vertically (measured 41 px offset); hit targets no longer matched the rendered shapes. The artboard now fits both axes and a geometry spec asserts coincidence within 2 px.
3. **Wheel zoom/pan scrolled the host page.** React registers wheel listeners as passive, so `preventDefault()` only warned. A non-passive capture listener now cancels the scroll exactly once per event.
4. **Quadratic open on large documents.** Reading visibility/lock/transform state re-scanned the document once per layer (1500 layers → 12 s). A single structure scan feeds the whole list (0.7 s; budget test enforces it).
5. **Ctrl-click could never group.** Extending a selection dropped the previous primary layer, so the first extension yielded one id instead of two.
6. **Windows: replacement rename and lock release.** Real Windows CI showed 3 then 2 failures. Fixes: bounded retry of the same `rename` on EACCES/EBUSY/EPERM, bounded retry of the lock `rmdir`, a platform-correct permission assertion instead of asserted POSIX bits, and Windows-tolerant polling deadlines.
7. **Accessibility:** added `lang="fr"`, a `prefers-reduced-motion` rule, `prefers-contrast` support and an accessible name for the workbench. The documented canvas-owned shortcut contract (Space = temporary pan even when a control is focused) was kept and is now asserted in a browser instead of being changed silently.

### Capabilities delivered

- **SVG structure:** byte-exact hierarchy model, group/ungroup of contiguous siblings, visibility toggle, lock marker, and rotation/scale about the real rendered pivot written as one normalised `matrix(...)`. Transform-aware geometry keeps a usable canvas for documents with groups or transforms, and drag deltas are mapped back through the accumulated matrix inverse.
- **HTML:** structural element mapping (key/path/exact byte span), duplicate-ID and malformed-markup read-only handling, text editing, and an attribute allowlist enforced on the Host.
- **CSS:** selector lists and the four combinators, custom properties, and typed refusal inside `@media`/`@supports`/`@keyframes`/`@layer`.
- **Storage:** injectable I/O seam, typed failure mapping, real multi-process/crash/fault-injection proof, and documentation of the exact guarantee (cooperative advisory lock + pre-rename re-validation + post-commit verification — **not** a universal CAS).

## 2. Executed evidence

| Command | Result |
|---|---|
| `npm run check` (baseline `c97101e`) | 269 pass / 0 fail / 0 skip |
| `npm run check` (final) | **394 pass / 0 fail / 0 skip**, exit 0, Node v24.19.0 |
| `npm run test:browser` (Chromium 145 + Firefox 146) | see `tests/browser/__reports__/browser-report.json`; 27 specs per browser, **all PASS** locally |
| `npm run test:dsh` | 14 PASS / 0 FAIL / 1 NOT_RUN (see below) |
| GitHub Actions `core` (ubuntu) | PASS |
| GitHub Actions `core` (windows-latest) | see the run history; every observed failure was fixed (rename/lock/permission/path issues), never skipped |
| GitHub Actions `browser` (ubuntu-24.04) | PASS (Chromium + Firefox installed and executed in CI) |

### Real DSH results (`tests/e2e/real-dsh.mjs`)

PASS: installation resolution, disposable profile creation from the shipped template, plugin install and bundle registration, real web app boot, real Web UI load, real session creation, `/health`, `/files`, `/document`, a real save through `/apply`, stale-revision refusal (HTTP 409), **client bundle served by the real Host** (HTTP 200, 89,771 bytes, `immediately=true`, `inject=["slots"]`), **bundle declares the `conversation.view` slot**, no JavaScript errors on the page.

NOT_RUN: the workbench opening **inside** the real conversation. DSH renders no `conversation.view` area at all while a session is blank, and producing a turn requires an LLM provider that this credential-free disposable profile deliberately does not have. This is a documented environment limit, not a pass.

## 3. Commits on `dev`

`7d49e10` browser gate + real-DSH harness · `3346cc7` artboard fit + wheel fix · `6be5ec7` SVG structure modules · `e3d2716` HTML/CSS host mapping · `539d353` storage proof · `1ab9150` client export fix · `65308ba` Windows fixes · `ae4f850` structural editor UI · `722347d` HTML text/attributes + Windows rename.

## 4. Remaining risks and open work

- The TOCTOU window between the final re-validation and `rename` cannot be closed portably; writes that complete before it are refused (proven), writes after it are detected (proven), the window is documented and never called a universal CAS.
- A real DSH store/test **with an LLM turn** is still needed to prove the workbench inside the real conversation UI.
- macOS, NFS/SMB and real mobile devices remain NOT_RUN.
- The HTML visual editor is conservative by design: optional end tags, browser-style recovery and CSS cascade/computed styles stay read-only.
- Not yet delivered: optional AI tooling (G5.1–G5.2), SBOM/packaging/release checklist (G5.3), and the GO/NO-GO report.

## 5. Next actions

1. Run the real-DSH harness on a profile with a provider and a non-blank session to close the last G0 step.
2. Finish G5: licence/NOTICE/SBOM, packaging, migration/rollback, operator documentation and the GO/NO-GO report.
3. Wire the remaining CSS capabilities (computed-style distinction, `@media` editing) behind explicit refusals.

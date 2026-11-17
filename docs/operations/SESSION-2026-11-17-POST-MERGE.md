# Session report — post-merge autonomous run (17 November 2026)

**Baseline:** `dev` @ `c97101e` (PR #8 squash `c2f1747` already integrated), `npm run check` **269 pass / 0 fail / 0 skip**, Node v24.19.0, Linux x64.
**Final:** 398 core tests, 31 real-browser specs × Chromium + Firefox, real DSH 19/19.
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

### Independent review and the defects it caught

An independent read-only review of the whole session diff (`c97101e..HEAD`) returned **MERGE-READY WITH FIXES** and three P1 defects, all reproduced and fixed:

1. **Rotation/scale pivot was in the wrong coordinate space.** The pivot came from the rendered (artboard) centre while a `transform` attribute acts in the element's *parent* space, so rotating a layer inside a translated group displaced it by the ancestor translation and saved that displacement. Handles now carry the parent-space inverse; a spec rotates a layer inside `translate(1000,0)` and asserts both the exact matrix (`0,1,-1,0,40,0`) and that the visible centre does not move.
2. **`data-locked` was not enforced on the mutations that actually run.** Drag and property edits went through `svgAttributePatch`, and delete/duplicate through the legacy `svgElementPatch`, neither of which checked the lock. Both now refuse with `locked`, proven at the module and route level.
3. **Nested delete/duplicate was unreachable.** The route never passed `nested:true`, so deleting a group returned `unknown-node`. The route now defaults to the nested implementation, and the old test that locked the limitation was rewritten to prove the new behaviour (delete a group, restore it byte-for-byte with the inverse, duplicate with unique ids).

P2 findings also fixed: an unregistered SVG sandbox spec, a composition assertion that could not fail, an over-claiming lock comment, ungrouping silently dropping group attributes (now refused with `unsupported-group`), a regex bypass in the preview neutraliser (entity-encoded `refresh` and a quoted `>`; now a quote-aware scanner), and evidence reports that were cited but gitignored (now tracked).

### Internal-plugin integration (framing + theme)

The product is an internal DSH bundle, not an external application (ADR-023). Two integration defects were found:

- the client referenced **four DSH theme tokens that do not exist** (`--dsw-alias-surface-1/2`, `-content-primary`, `-border`), so the fallbacks always won and the workbench never followed DSH's theme despite appearing to. Structural colours now use the real semantic tokens (surfaces, borders, text, states) with hex fallbacks, the font follows `--dsw-font-family`, and the approved Graphite accent is kept as a design decision;
- the client entry point was not resolvable as `<package>/client.js`, so DSH silently dropped the bundle (fixed earlier this session).

Guardrails: `tests/dsh-theme-tokens.test.mjs` fails on any unknown token name, and the browser spec `dsh-theme` injects a light palette and asserts the workbench surfaces/text actually follow it.

Proven in the product: the real DSH instance renders a **light** theme, and the workbench now paints `rgb(255,255,255)` — exactly the value DSH gives `--dsw-alias-bg-layer-1` — instead of its previous hardcoded dark surface. The gate asserts that equality, and the canvas uses the recessed `--dsw-alias-bg-layer-2` so the white artwork sheet stays distinguishable. Evidence: `docs/operations/evidence/dsh-workbench-element.png` (1153×785, 1 552 distinct colours). Real DSH result: **20 PASS / 0 FAIL**.

### Windows intermittent failure: diagnosed, not papered over

One HTML↔CSS navigation test failed intermittently on Windows only. Instead of raising a timeout again, the failure now reports the client's own state; the next failing run returned `{"alert":null,"hasReturnButton":true,"hasLinkedCssButton":false}` — proving the "return to HTML" click was a no-op because the client was still busy after the undo, not that the Host had failed. The test now waits until the button is actionable, and the same class of race is already guarded in the CSS integration tests.

### Security work beyond the plan

- Measured the `<meta http-equiv="refresh">` / `<base>` vectors in real Chromium and Firefox: an isolated probe showed a body-level meta refresh DOES navigate an unsandboxed `srcDoc` frame and does NOT navigate a frame with our `sandbox="allow-same-origin"`. Rather than relying on one browser behaviour, the preview projection now also strips `meta refresh` and `base` (the file on disk is untouched). Recorded in `docs/adr/ADR-022-HTML-PREVIEW-SECURITY-VERIFIED.md`, asserted on both engines.

### Capabilities delivered

- **SVG structure:** byte-exact hierarchy model, group/ungroup of contiguous siblings, visibility toggle, lock marker, and rotation/scale about the real rendered pivot written as one normalised `matrix(...)`. Transform-aware geometry keeps a usable canvas for documents with groups or transforms, and drag deltas are mapped back through the accumulated matrix inverse.
- **HTML:** structural element mapping (key/path/exact byte span), duplicate-ID and malformed-markup read-only handling, text editing, and an attribute allowlist enforced on the Host.
- **CSS:** selector lists and the four combinators, custom properties, and typed refusal inside `@media`/`@supports`/`@keyframes`/`@layer`.
- **Storage:** injectable I/O seam, typed failure mapping, real multi-process/crash/fault-injection proof, and documentation of the exact guarantee (cooperative advisory lock + pre-rename re-validation + post-commit verification — **not** a universal CAS).

## 2. Executed evidence

| Command | Result |
|---|---|
| `npm run check` (baseline `c97101e`) | 269 pass / 0 fail / 0 skip |
| `npm run check` (final) | **406 pass / 0 fail / 0 skip**, exit 0, Node v24.19.0 |
| `npm run test:browser` (Chromium 145 + Firefox 146) | **62 PASS / 0 FAIL** (31 specs × 2 engines); report at `tests/browser/__reports__/browser-report.json` |
| `npm run test:dsh` (without credentials) | 14 PASS / 0 FAIL / 1 NOT_RUN (blank-session limit) |
| `npm run test:dsh` (credentials opt-in) | **19 PASS / 0 FAIL / 0 NOT_RUN**, workbench rendered in the real conversation |
| GitHub Actions `core` (ubuntu) | PASS |
| GitHub Actions `core` (windows-latest) | see the run history; every observed failure was fixed (rename/lock/permission/path issues), never skipped |
| GitHub Actions `browser` (ubuntu-24.04) | PASS (Chromium + Firefox installed and executed in CI) |
| GitHub Actions run `44007780142` | **all jobs green**: `core (ubuntu)`, `core (windows)`, `browser` |

### Real DSH results (`tests/e2e/real-dsh.mjs`)

PASS: installation resolution, disposable profile creation from the shipped template, plugin install and bundle registration, real web app boot, real Web UI load, real session creation, `/health`, `/files`, `/document`, a real save through `/apply`, stale-revision refusal (HTTP 409), **client bundle served by the real Host** (HTTP 200, 89,771 bytes, `immediately=true`, `inject=["slots"]`), **bundle declares the `conversation.view` slot**, no JavaScript errors on the page.

**Workbench inside the real conversation: PASS.** DSH renders no `conversation.view` area while a session is blank, so the harness now supports an opt-in real turn (`DSH_E2E_REUSE_CREDENTIALS=1` copies the caller's own credential file into the disposable, mode-600 home; `DSH_E2E_MODEL_PROVIDER`/`DSH_E2E_MODEL` add a model overlay). One short message produced a real assistant turn in 2 s, DSH rendered the view area, the registered `Design Studio` entry was clickable, and `DSH · Design Studio` appeared in the DOM of the real product.

Evidence: `docs/operations/evidence/dsh-workbench.png` (1440×900, 5 779 distinct colours — verified non-blank) plus `tests/browser/__reports__/real-dsh.json`.

Without credentials the two final steps stay `NOT_RUN`; that variant is reported as an environment limit, never as a pass.

## 3. Commits on `dev`

`7d49e10` browser gate + real-DSH harness · `3346cc7` artboard fit + wheel fix · `6be5ec7` SVG structure modules · `e3d2716` HTML/CSS host mapping · `539d353` storage proof · `1ab9150` client export fix · `65308ba` Windows fixes · `ae4f850` structural editor UI · `722347d` HTML text/attributes + Windows rename.

## 4. Remaining risks and open work

- The TOCTOU window between the final re-validation and `rename` cannot be closed portably; writes that complete before it are refused (proven), writes after it are detected (proven), the window is documented and never called a universal CAS.
- A real DSH store/test **with an LLM turn** is still needed to prove the workbench inside the real conversation UI.
- macOS, NFS/SMB and real mobile devices remain NOT_RUN.
- The HTML visual editor is conservative by design: optional end tags, browser-style recovery and CSS cascade/computed styles stay read-only.
- Not yet delivered: optional AI tooling (G5.1–G5.2), SBOM/packaging/release checklist (G5.3), and the GO/NO-GO report.

## 5. Next actions

1. ~~Close G0 with a real turn~~ — done: 19 PASS / 0 FAIL, workbench rendered in the real product.
2. Exercise the plugin inside the DSH Desktop renderer (there is no plugin build to package: the release artifact is a versioned bundle installed into a profile).
3. Wire the remaining CSS capabilities (`@media` editing, computed-style distinction) and smoothed/symmetric Bézier tangents, each behind explicit refusals until proven.
4. Optional AI tooling (G5.1/G5.2) once the owner approves the contract; today it is explicitly not implemented.

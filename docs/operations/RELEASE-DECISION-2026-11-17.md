# Release candidate checklist and GO/NO-GO — 17 November 2026

**Candidate:** `@rwanbt/dsh-design-studio` @ `0.1.0-alpha.20`, branch `dev`.
**Verdict: NO-GO for a stable release and NO-GO for a `main` merge.** GO only for
an *internal experimental RC snapshot* once the two blockers in §3 are closed.
Nothing was tagged, published or merged into `main`: both require the owner's
explicit approval.

## 1. What is ready

| Item | State | Evidence |
|---|---|---|
| Core suite | **394 / 394 PASS**, 0 fail, 0 skip, no dependencies installed | `npm run check` |
| Real browser gate | 27 specs × Chromium 145 + Firefox 146 | `npm run test:browser`, report JSON |
| Real DSH gate | 14 PASS / 0 FAIL / 1 NOT_RUN | `npm run test:dsh`, report JSON |
| CI — Linux | PASS | GitHub Actions `core (ubuntu-latest)` |
| CI — Windows | every observed failure fixed (rename, lock release, POSIX bits, path separators) | GitHub Actions `core (windows-latest)` history |
| CI — browser | PASS on pinned `ubuntu-24.04` | GitHub Actions `browser` |
| Runtime dependencies | **zero** | `npm run sbom` → `runtimeDependencyCount: 0` |
| SBOM | generated | `docs/operations/SBOM.json` |
| Third-party notices | written | `NOTICE` |
| Licence | MIT | `LICENSE` |
| Install/rollback guide | written | `docs/operations/INSTALL.md` |
| Branch hygiene | remote = `main` + `dev` only; `main` untouched | `git ls-remote --heads origin` |

## 2. Packaging steps (to run after approval only)

1. `npm run check && npm run test:browser && npm run test:dsh` on the release commit.
2. `npm run sbom` and commit the regenerated `docs/operations/SBOM.json`.
3. Bump `package.json` version to the approved RC identifier (e.g. `0.1.0-rc.1`).
4. `npm pack --dry-run` and confirm the archive contains exactly:
   `src/`, `client.js`, `cordis.patch.yml`, `README.md`, `LICENSE`, `NOTICE`.
5. Tag `v<version>` on `dev` (annotated) and attach the pack archive; **do not**
   publish to npm unless the owner asks for it.
6. Record the tag, the commit SHA, the three command outputs and the CI run URLs
   in a new dated file under `docs/operations/`.

## 3. Blockers for a stable release

1. **G0 is not fully closed.** The real installation proves installation, bundle
   registration, the Host routes, a real save and a refused stale revision, but
   **the workbench has never been observed opening inside the real DSH
   conversation**. DSH renders no `conversation.view` area while a session is
   blank, and producing a turn needs an LLM provider that the disposable profile
   deliberately lacks. Closing it requires one run on a profile with a provider.
2. **No macOS, NFS/SMB, or real touch-device verification.** Windows is covered
   by CI; macOS and network filesystems are `NOT_RUN`, and the storage guarantee
   is explicitly *not* a universal CAS.
3. **G5 (optional AI tooling) is not implemented.** The manual editor is complete
   enough for an experimental RC, but any claim of "hybrid" workflow would be
   false today.

## 4. Known limitations to publish with the RC

- Storage: cooperative advisory lock + pre-rename re-validation + post-commit
  verification. A non-cooperating editor writing inside the final
  validate→rename window can still be overwritten; the window is bounded and
  documented, and everything before it is refused.
- HTML/CSS: no cascade, no computed styles, no framework CSS, no source maps;
  optional end tags and malformed markup stay read-only.
- SVG: no boolean operations, gradients, masks or smoothed/symmetric tangents;
  duplicated elements do not rewrite `href`/`xlink:href` references.
- Accessibility: verified for focus, keyboard activation, ARIA state, reduced
  motion and three widths — **not** verified with a real screen reader.
- Performance budget: 1500-node SVG opens and saves inside the asserted budget on
  the reference machine; no memory profile has been captured.

## 5. Rollback plan

- Revert the release commit on `dev` (no force-push, no history rewrite).
- Uninstall from profiles with `dsh plugin --profile <name> remove @rwanbt/dsh-design-studio`.
- Documents are untouched by design: every edit was a targeted patch and the
  original bytes outside the edited ranges were preserved (proven by round-trip
  tests), so a rollback never needs document repair.

## 6. Decision

| Question | Answer |
|---|---|
| Merge into `main`? | **NO** — G0.2 open, owner approval required. |
| Tag an experimental RC on `dev`? | **GO** after owner approval and step §2 executed. |
| Publish to npm? | **NO** — explicit owner decision only. |
| Call it production ready? | **NO**. |

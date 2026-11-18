# Release candidate checklist and GO/NO-GO — 17 November 2026

> **Actualisation du 18 novembre 2026 — cette décision reste NO-GO.** Les compteurs
> ci-dessous sont ceux de la session du 17 ; l'état mesuré du 18 est :
> **598 tests noyau**, **210 runs navigateur** (105 specs × 2 moteurs), **31 PASS /
> 0 FAIL / 6 NOT_RUN** en DSH Web réel sans IA, benchmark moteur reproductible
> (`npm run benchmark`) exécuté aussi en CI, et **Desktop `NOT_RUN`** pour l'UI
> actuelle. Voir `REAL-WEB-2026-11-18.md`, `PERFORMANCE-BUDGETS-2026-11-18.md` et
> la matrice `DELIVERY-GATES-2026-11-17.md`. `main` reste à `67870f7` : aucun
> merge, tag ou publication n'a été effectué.

**Candidate:** `@rwanbt/dsh-design-studio` @ `0.1.0-alpha.20`, branch `dev`.
**Verdict: GO for an owner-approved experimental RC snapshot on `dev`; NO-GO for a
stable release and NO-GO for a `main` merge.** The real-installation blocker is
closed (§3.1); the remaining limits are documented below and none of them hides a
silent failure mode. Nothing was tagged, published or merged into `main`: both
require the owner's explicit approval.

## 1. What is ready

**Product framing:** an internal DeepSeek Harness bundle (Host plugin + `conversation.view` client view). No
standalone application, no separate process, no own window/port; installation is `dsh plugin --profile <p> add …`
(see ADR-023).

| Item | State | Evidence |
|---|---|---|
| Core suite | **598 / 598 PASS**, 0 fail, 0 skip, no dependencies installed (18 Nov) | `npm run check` |
| Real browser gate | 105 specs × Chromium 145 + Firefox 146 = **210 PASS / 0 FAIL** (18 Nov, report committed) | `npm run test:browser`, report JSON |
| Real DSH gate (Web, no AI) | **31 PASS / 0 FAIL / 6 NOT_RUN** in disposable profiles; Desktop NOT_RUN for this UI | `npm run test:dsh`, `REAL-WEB-2026-11-18.md` |
| CI — Linux | PASS | GitHub Actions `core (ubuntu-latest)` |
| CI — Windows | every observed failure fixed (rename, lock release, POSIX bits, path separators) | GitHub Actions `core (windows-latest)` history |
| CI — browser | PASS on pinned `ubuntu-24.04` | GitHub Actions `browser` |
| Runtime dependencies | **zero** | `npm run sbom` → `runtimeDependencyCount: 0` |
| SBOM | generated | `docs/operations/SBOM.json` |
| Third-party notices | written | `NOTICE` |
| Licence | MIT | `LICENSE` |
| Install/rollback guide | written | `docs/operations/INSTALL.md` |
| Branch hygiene | remote = `main` + `dev` only; `main` pinned at `67870f7`, `dev` ahead | `git ls-remote --heads origin` |

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

1. ~~**G0 is not fully closed.**~~ **Closed.** With an opt-in real assistant turn
   the workbench rendered inside the real DeepSeek Harness conversation, with the
   registered client bundle served by the real Host. Screenshot evidence is
   committed. What is *not* covered is the packaged Desktop/Electron shell: only
   its real Web server has been driven so far.
2. **No macOS, NFS/SMB, or real touch-device verification.** Windows is covered
   by CI (functionally, with two documented `SKIP`s); macOS and network
   filesystems are `NOT_RUN` and now **explicitly removed from the certified
   perimeter** — see [PLATFORM-MATRIX-2026-11-18.md](PLATFORM-MATRIX-2026-11-18.md).
   The storage guarantee is explicitly *not* a universal CAS.
3. **G5 (optional AI tooling) is not implemented.** The manual editor is complete
   enough for an experimental RC, but any claim of "hybrid" workflow would be
   false today.
4. **The Desktop shell is not verified for the current UI.** Earlier Electron
   evidence predates the menu, conditional-CSS and drag work; the Web path is the
   only one certified today, so any Desktop claim would be unfounded.

## 4. Known limitations to publish with the RC

- Storage: cooperative advisory lock + pre-rename re-validation + post-commit
  verification. A non-cooperating editor writing inside the final
  validate→rename window can still be overwritten; the window is bounded and
  documented, and everything before it is refused.
- HTML/CSS: no cascade, no computed styles, no framework CSS, no source maps;
  optional end tags and malformed markup stay read-only.
- SVG: no boolean operations, gradients, masks or smoothed/symmetric tangents;
  duplicated elements do not rewrite `href`/`xlink:href` references.
- File management: renaming and deleting exist, but a confirmed delete is
  **permanent** — there is no recycle bin, no folder operation and no undo for
  either; a filesystem without hard links refuses to rename instead of risking
  an overwrite (ADR-027).
- Accessibility: verified for focus, keyboard activation, ARIA state, reduced
  motion and three widths — **not** verified with a real screen reader.
- Performance budget: 1500-node SVG opens and saves inside the asserted budget on
  the reference machine; no memory profile has been captured.

## 5. Rollback plan

**Vérifié le 18 novembre 2026, sur un profil jetable** (`DSH_HOME`/`HOME`
temporaires, aucun profil personnel) : `npm run test:dsh` exécute désormais
`dsh plugin --profile e2e remove @rwanbt/dsh-design-studio` puis relit le
manifeste du profil. Résultat : **PASS** — `dsh plugin remove` sort en code 0 et
le bundle n'est plus listé (`still listed=false`). Les documents de l'espace de
travail ne sont pas touchés : toutes les écritures étaient des patches ciblés, un
rollback n'exige aucune réparation de fichier.

**Archive vérifiée** (`npm pack --dry-run`) : 28 fichiers, exactement `src/*.mjs`,
`client.js`, `cordis.patch.yml`, `README.md`, `LICENSE`, `NOTICE` et
`package.json` — aucune fuite de test, de documentation interne ni de fichier de
configuration locale.

- Revert the release commit on `dev` (no force-push, no history rewrite).
- Uninstall from profiles with `dsh plugin --profile <name> remove @rwanbt/dsh-design-studio`.
- Documents are untouched by design: every edit was a targeted patch and the
  original bytes outside the edited ranges were preserved (proven by round-trip
  tests), so a rollback never needs document repair.

## 6. Decision

| Question | Answer |
|---|---|
| Merge into `main`? | **NO** — owner approval required and the DSH Desktop renderer is untested. |
| Tag an experimental RC on `dev`? | **GO** after owner approval and step §2 executed. |
| Publish to npm? | **NO** — explicit owner decision only. |
| Call it production ready? | **NO** — voir le [rapport final du 18 novembre](FINAL-REPORT-2026-11-18.md) : Desktop et lecteur d'écran réels restent `NOT_RUN`. |

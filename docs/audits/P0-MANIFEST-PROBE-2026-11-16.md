# P0 — manifest and architecture probe (2026-11-16)

**Evidence class:** retrieved upstream `package.json`, README, LICENSE and Design Canvas CONTRACT.md via GitHub connector. Not a source implementation audit. No test commands executed; all runtime test gates are NOT_RUN.

## Specific technical findings

| Candidate | Version observed | Host + client architecture | Build/test from manifest | Main integration concern |
|---|---|---|---|---|
| Sal7one/DSH-Design-Studio | 2.8.0 | `lib/index.js`, `lib/client.js`, `cordis.patch.yml`; injects conversation, session, settings | Node >=22; `node scripts/check.mjs`; `node --test` suite | Design workflow centers agent/select-to-prompt; manual authoring needs new engine |
| AndreTheAccelerator/dsh-design-canvas | 1.0.0 | `index.js`, `host/model.js`, `host/store.js`, `host/tools.js`, right-sidebar `client.js` | dependency-free; node syntax and model tests | Canonical `design-board.json`, not native SVG/HTML; adapt command patterns, not save model |
| zhang-guo-wen/dsh-web-design | 1.3.1 | `lib/index.mjs`, sidebar `lib/client.js`; DSH FS/sandbox/services | tsdown/tsc/Vitest/smokes | Targeted source writing has ambiguous/dynamic DOM limitations; requires tests |
| ZSeven-W/dsh-openpencil | 0.1.0-rc.15 | `lib/index.js`, `lib/client.js`, staged managed editor runtime | Node >=24.11, pnpm 10.12.1, many build and runtime tests | `.op` primary document, native SVG path editing fidelity NOT_VERIFIED |
| OrderG-X/dsh-design-studio | 0.23.1 | `lib/index.js` and `lib/client.js`, sidebar inject | `node --test --test-concurrency=1 test/*.mjs` | Broad design/prototype tool, but manual element editing not confirmed |
| Devin-AXIS/deepseek-design | 1.0.0-beta.22 in README | Integrated host/client editor | Node >=24.9, Bun, npm | Source Available: REFERENCE ONLY |

## Immediate engineering implications

1. **Do not copy Design Canvas's JSON document model** as canonical storage. Its `CONTRACT.md` expressly defines `design-board.json` in the session workspace. Borrow only the validated operation and versioning *approach* after implementation review.
2. **OpenPencil's plugin MIT license is not evidence of lossless SVG round-trip**. Its package targets `.op` and bundles or stages a managed editor runtime. OpenPencil upstream's root LICENSE is MIT, but subpackages/assets/dependencies require review.
3. **Choose integration shell only after code inspection.** Sal7one provides a persistent conversation tab, while Design Canvas and OrderG-X inject the right sidebar; both UX patterns should be prototyped rather than assuming interoperability.
4. **HTML edits must be source-targeted**, with precise rejection when unique mapping is impossible. External CSS and JavaScript-rendered trees require explicit behavior.
5. Requirements for an editor command protocol include an atomic mode, expected revision, inverse patches, disk source hash and exact affected source ranges; the JSON canvas's in-memory `version` field alone is insufficient for external source edits.

## Retrieved artifact hashes (blob SHA; NOT source commit SHA)

- Sal7one `package.json`: `26a39b059095b4c59296a4b3c3899ec3513f2d05`
- Design Canvas `package.json`: `ae704e656961c8d93122a8f9a9f3004a3b2c3489`
- Design Canvas `CONTRACT.md`: `08d0d8718c80043359706ef0455e345da2e704bb`
- Web Design `package.json`: `b1e830467b7c847a8a6ca28f0c71dad2a9b50b73`
- OpenPencil `package.json`: `97ea7aa3a6c9da046509ac7ea8ec12a1c8f7f84c`
- OrderG-X `package.json`: `c2b9916932f2c3b0448a091ee27fd8a23b52801a`
- OpenPencil upstream `LICENSE`: `0dec8929ada31c1b4a60e64410e283a538ca9dfc`

These hashes identify fetched file blobs, **not immutable snapshots of entire source trees**. Exact commit pinning is still an open P0 task.

## Unverified gates

- source analysis at pinned upstream commit: NOT_RUN
- dependency and license scan: NOT_RUN
- plugin install in DSH: NOT_RUN
- HTML native round-trip: NOT_RUN
- SVG native round-trip: NOT_RUN
- direct manipulation and zero-token manual workflow: NOT_RUN

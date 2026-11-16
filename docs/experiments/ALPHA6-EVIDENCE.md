# DSH Design Studio — alpha.6 implementation evidence

**Date:** 2026-11-16. **Experimental, no release.**

## Code and automated gate

- Verified source commit: `d6d0432aa60cf2072c0f861a87fe78c90a203600`.
- Command in [GitHub Actions run 43952992076](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/43952992076): `npm run check` with Node 22.
- Log result: **105 tests, 105 PASS, 0 FAIL, 0 SKIP**, plus Node syntax checks.
- CI primarily tests pure operations, real temporary files and simulated DSH Host/API/React client. **A real DSH Desktop/Web installation is NOT_RUN.**

## Changes since alpha.5

1. New `src/svg-elements.mjs`: conservative, quote-aware SVG tag and ID source-range scanner for duplicating and deleting **direct SVG leaf elements**. Generated IDs avoid collisions. Edits are exact source-span patches, and Undo/Redo uses the existing inverse patch and SHA-256 revision preconditions.
2. Host API `svg-layer` operations in `src/plugin-host.mjs` and contextual controls in `client.js`; Ctrl+D and Delete shortcuts avoid interfering with focused text inputs.
3. Safety refusal: ambiguous IDs, malformed XML, nested graphics, unsupported operations, `script`, `foreignObject` and event-handler attributes. This is intentionally not a complete XML/CSS/SVG parser or full SVG security sanitizer.
4. Corrected Unicode font-family validation in `src/svg-attributes.mjs`. Regression tests exercise safe family names and reject script-like values.
5. Client HTTP calls use **origin-root** `/design-studio-native/...` paths, including nested conversation routes (mock regression tests).

## DSH contract cross-check (source code, not runtime execution)

- The host `ctx.webServer.register({kind:'prefix',path,handler})` pattern is also used by `AndreTheAccelerator/dsh-design-canvas/host/routes.js`.
- The session `ctx.agents.get(sessionId)` and `ctx.workingDirectory.ensure(agent)` pattern appears in `AndreTheAccelerator/dsh-design-canvas/host/store.js`.
- The conversation `slots.inject('conversation.view', () => slots.register(..., component))` pattern appears in `Sal7one/DSH-Design-Studio/lib/client.js`.
- The same-origin absolute-path HTTP pattern appears in `Sal7one/DSH-Design-Studio/lib/client/src/api.js`.

These are **source-backed compatibility indicators only**. They do not prove that our bundle is installable into every DSH version or that its UI, routes and permissions work in the user's active profile.

## Open release gates

- **NOT_RUN:** DSH installation, real browser click/drag/keyboard, load/unload lifecycle, desktop and mobile visual inspection.
- **NOT_RUN:** cross-process contention, symlink/rename race security review and operating-system matrix.
- **NOT_IMPLEMENTED:** SVG group manipulation, rich text, precise glyph geometry, Bézier handles, visual HTML source mapping, durable undo history, advanced drawing UI.

**Do not merge into `main`, tag or distribute as production-ready from this evidence.** The PR targets `dev` and remains a draft.

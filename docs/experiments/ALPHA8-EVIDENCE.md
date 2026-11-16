# Design Studio alpha.8 — navigation and save-recovery evidence

**Date:** 2026-11-16. **State:** experimental source branch; **NOT a release**.

## Verified code and tests

- GitHub Actions: [run 43958121836](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/43958121836), source commit `b7ba7d8a5b767d8e56d4441929ed41ff51dba6d8`.
- Actual CI command: `npm run check` on Node.js 22 (Node syntax checks plus `node --test tests/*.test.mjs`).
- Observed summary in job logs: **132 tests / 132 PASS / 0 FAIL / 0 SKIP**.
- Browser/client tests use a mocked React tree and event handlers; they do **not** establish performance or usability in a real DSH application.

## Implemented: manual SVG viewport navigation

`client.js` now uses separate, nonpersistent camera state `{zoom, offsetX, offsetY}` that does not enter native document patch requests.

- Graphite toolbar: **selection, hand, zoom out, zoom percentage, zoom in, fit/recenter**.
- Zoom range: **12.5% to 800%**.
- `Ctrl`/`Cmd` + wheel: anchor-aware zoom under the pointer.
- Wheel/trackpad scroll: 2-axis pan; Shift scroll enables horizontal pan.
- Hand-tool drag, middle-button drag, and temporary **Space + drag** work without changing the active selected layer.
- Keyboard: **V** select, **H** hand, **+ / −** zoom, **0** fit/recenter.
- Viewport transformations preserve scale-aware pointer-to-SVG movement coordinates. Supported SVG objects continue to save through exact source patches only when a shape is actually manipulated.
- On opening a different document, the camera resets to the default view. Re-reading the same document for a source save does not reset its camera.

The model intentionally does not use a global event listener or change DSH keyboard shortcuts while inputs have focus. Gesture support is scoped to the plugin's mounted view. Fit is provisional: portrait/large documents may need refinement after testing actual container sizes and device scale factors.

## Implemented: save/reload failure protection

- After an acknowledged native file write, the client now **checks whether the required document reload succeeded** before recording an Undo/Redo step.
- If that reload fails, the UI marks its state uncertain, clears potentially invalid history, blocks further writes, and offers a **Recharger le fichier** recovery action.
- Network/unknown-status and HTTP 5xx save failures are treated conservatively; HTTP 409 stale-revision also requires reload.
- Deterministic validation failures (e.g. HTTP 400) remain visible without unnecessarily disabling an otherwise current document.
- Source contents stay native SVG/HTML/CSS; viewport changes do not alter disk content.

## Regression evidence

- Mocked client pointer tests: zoom in/out, zoom anchored at cursor, trackpad/middle-button/touch pan, fit view, Space temporary hand, shape drag after zoom, no unexpected `POST` for camera-only gestures.
- Simulated save failures: successful write + failed read; stale revision response; invalid-value response. Tests check recovery availability and write denial when editor state is uncertain.
- Existing 119 source/host/workspace tests are retained and pass.

## Production gates still not satisfied

- **NOT_RUN:** installation, visual smoke, pointer actions and keyboard behavior inside a real **DeepSeek Harness Desktop/Web** profile; user's local DSH tunnel was unavailable in the prior check.
- **NOT_RUN:** real browser zoom/pan geometry rendering, responsive mobile gestures (including two-finger pinch), accessibility evaluation, performance profiling.
- **NOT_RUN:** cross-process atomic file compare-and-swap, directory-swap races, operating-system matrix.
- **NOT_IMPLEMENTED:** precise SVG path hit tests, Bézier node editing, nested group transforms, HTML visual source mapping, durable Undo/Redo across DSH restarts.

Keep **PR #8 draft targeting `dev`**. Do not merge to `main`, tag or publish an npm release based only on simulated tests.

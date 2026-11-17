# DSH Design Studio — alpha.7 evidence

**Recorded:** 2026-11-16. **Draft PR #8. Not a release or real DSH integration certification.**

## Verified code gate

- Verified commit: `6e853a8a19a2f6150f26aba569169562468bb63b`
- GitHub Actions: [Core source patch tests — run 43955013097](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/43955013097)
- Executed command: `npm run check` on Node.js 22, including syntax verification and `node --test tests/*.test.mjs`.
- Observed results: **119 total / 119 passed / 0 failed / 0 skipped**.

The tests use real temporary directories and files for the store, but **mocked** DSH Host registration and browser React events. The user's DSH tunnel was disconnected when checked: `Tunnel-client has not been seen for 300 seconds`. Real app installation and UI operation remain **NOT_RUN**.

## Functional additions

### Session workspace file picker

- `src/workspace-files.mjs`: read-only discovery of existing `.svg`, `.html`, `.htm` and `.css` files in the active session workspace. Returns relative paths, file formats and sizes only (no file contents or absolute host paths).
- Bounded: at most **300 files**, **4,000 scanned entries**, **7 directory levels** and **8 MiB/file**. Truncation is explicitly reported.
- Ignores symlink entries, hidden paths, `node_modules`, caches and VCS directories, and hard-linked files; permissions and disappearing files are handled conservatively.
- `GET /design-studio-native/files?sessionId=...` uses the existing live-session workspace resolution. **This endpoint does not grant additional file write authority**; opening and saving still pass through native-file-store checks.
- `client.js`: **Parcourir…** action, path filtering, direct open, list-size indication and guard against switching when unsaved source edits exist. A failed open does not silently discard the current document.
- Source API URLs remain absolute to the origin root, so nested DSH conversation routes cannot accidentally redirect requests to a relative path.

### DSH lifecycle test

- `tests/plugin-lifecycle.test.mjs` mounts the Host `apply(ctx)` against a realistic mocked `webServer.register` and `ctx.effect`, exercises health and file listing through its route, then confirms disposer execution.
- This is a **mock lifecycle gate**; it does not validate that the actual DSH plugin loader accepts the bundle and renders the UI.

## Hardening boundaries and remaining work

- Workspace enumeration reduces accidental exposure but is **not** a general-purpose filesystem sandbox. Concurrent directory replacement and other TOCTOU races require additional review, especially on cross-platform filesystems.
- Real DSH Desktop/Web profile install, tab visibility, pointer/mouse/touch rendering and onboarding UX: **NOT_RUN**.
- Browser file-tree enhancements (favorites, directories expansion, visual thumbnails), mobile picker ergonomics and large-workspace performance: **NOT_IMPLEMENTED**.
- Existing known gaps remain: cross-process atomic CAS, complete SVG structure/paths, rich typography, HTML visual source mapping, persisted undo/redo, full accessibility/security audit.
- Keep PR **draft** to `dev`, with no merge into `main`, npm publish, tag or production claim.

## Next real-app smoke workflow

1. In a disposable DSH profile, load the local branch's scoped bundle `@rwanbt/dsh-design-studio`; verify the client tab and Host API both initialize.
2. Open a chat whose workspace contains `examples/design.svg`; use **Parcourir…** to find and open it.
3. Change a color or text; verify that only intended source spans changed and Undo restores exact content.
4. Attempt to switch files with an unsaved text-source edit: verify that switching is blocked.
5. Record DSH version, OS, install command, screenshots, exact logs and commit SHA. Without those results, the live smoke gate stays **NOT_RUN**.

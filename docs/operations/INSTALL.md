# Installing DSH Design Studio in a DeepSeek Harness profile

This is an **internal DeepSeek Harness plugin**, not a separate application: it has
no own process, window, port or installer build. It is delivered as a DSH bundle
(`package.json` → `dsh.bundle.patch` → `cordis.patch.yml`) and its UI is a
`conversation.view` of the host application, so it inherits the DSH theme, language
and workspace. The plugin is **MIT** and has **zero runtime dependencies**.

> Status: experimental. Gates G0–G4 are partially open (see
> `docs/roadmap/DELIVERY-GATES-2026-11-17.md`). Do not install into the profile
> you rely on for production work without reading that matrix.

## 1. Requirements

| Requirement | Minimum | Checked with |
|---|---|---|
| DeepSeek Harness | 0.2.x (`0.2.2-rc.3` used for the real verification) | `dsh --version` |
| Node.js | 22 | `node --version` |
| OS | Linux x64 verified | Windows verified by CI, macOS **NOT_RUN** |
| AI provider | **none** | the editor never calls a model |
| Shell | DSH Web or DSH Desktop | Both driven end-to-end (Web 20 steps, Desktop 11 steps, 31/31 PASS) |

## 2. Install into a disposable profile (recommended first)

Install the CLI once (see the DeepSeek Harness documentation for the desktop
build of your platform), then:

```bash
# 1. A disposable home keeps your real profile untouched.
export DSH_HOME="$PWD/dsh-try-home"
mkdir -p "$DSH_HOME"

# 2. Create a fresh profile from the shipped web template.
dsh --profile design-try --from-default-profile web --dump-config > /dev/null

# 3. Install this plugin (from a clone) and verify the bundle registration.
dsh plugin --profile design-try add link:/absolute/path/to/DSH-Design-Studio
cat "$DSH_HOME/profiles/design-try/package.json"
#   → dsh.profile.bundles must list "@rwanbt/dsh-design-studio"

# 4. Boot the real web UI and open the printed URL.
dsh --profile design-try --no-open --port 0 --host 127.0.0.1
```

The Design Studio view is registered in the `conversation.view` slot. DeepSeek
Harness does not render that slot area for a **blank** session, so open an
existing conversation (or send one message) before expecting the workbench tab.

## 3. Install into your own profile

```bash
dsh plugin --profile <your-profile> add link:/absolute/path/to/DSH-Design-Studio
```

Restart the application afterwards. To remove it:

```bash
dsh plugin --profile <your-profile> remove @rwanbt/dsh-design-studio
```

Nothing outside the profile's `node_modules` and `package.json` is modified: the
plugin writes only to the files you explicitly open, plus a cooperative
`.<file>.dsh-native.lock` directory next to a file while a save is committed.

## 3 bis. Install into the DSH Desktop application

The desktop application owns its own `desktop` profile, so the order matters:
the CLI refuses to create it and asks you to let the application do it first.

```bash
# 1. Start DSH Desktop once, let it finish first-run setup, then quit it fully.
# 2. Install into the profile the application created:
dsh plugin --profile desktop add link:/absolute/path/to/DSH-Design-Studio
# 3. Start DSH Desktop again.
```

What this does *not* do: it does not add an installer, a service or a second
window. The plugin is a bundle inside the profile the application already owns,
and its UI is a `conversation.view` tab of the desktop window. The desktop serves
client bundles over its own `dsh-app://` protocol in batched URLs — a different
delivery path from the web app, both verified (see
`docs/roadmap/DELIVERY-GATES-2026-11-17.md`, gate G0).

A real assistant turn inside the desktop shell is not verified here: the
disposable profile used for the automated run has no provider adapter
(`NO_ADAPTER`). The workbench itself, the Host routes, the theme and the absence
of client errors are verified in the real application.

## 3 ter. If the bundled pnpm refuses the profile store

Observed on a real 0.2.2-rc.3 installation whose profile had been created by an
older runtime: every install — ours or any other — fails before touching the
plugin with

```
[ERR_PNPM_UNEXPECTED_STORE] Unexpected store location
The dependencies at "<profile>/node_modules" are currently linked from the store
at "…/store/v10". pnpm now wants to use the store at "…/store/v11".
```

The profile records `packageManager: pnpm@10.33.2` while DSH now ships pnpm 11;
pnpm 11 always appends its own store version, so no `store-dir` / `storeDir`
setting can make it reuse a `v10` store (tried: it resolves to `v10/v11`). The
install is refused cleanly, so nothing is half-written.

Two honest options:

1. **Migrate the profile (supported path).** Run the bundled pnpm 11 once in the
   profile so its `node_modules` is re-linked from the v11 store. This is a real
   maintenance operation: it downloads packages and rewrites the profile tree,
   so take a copy of `package.json`, `pnpm-lock.yaml` and `node_modules/.modules.yaml`
   first, and only do it with the application closed.
2. **Link manually + restart (workaround).** What a `link:` dependency is anyway:
   a symlink plus two entries.

```bash
cd ~/.dsh/profiles/desktop            # or your profile directory
mkdir -p node_modules/@rwanbt
ln -sfn /absolute/path/to/DSH-Design-Studio node_modules/@rwanbt/dsh-design-studio
# then add, in package.json:
#   "dependencies": { "@rwanbt/dsh-design-studio": "link:/absolute/path/to/DSH-Design-Studio" }
#   "dsh.profile.bundles": [ …, "@rwanbt/dsh-design-studio" ]
# Use an ABSOLUTE link target, like every other profile bundle. A relative
# `link:` is resolved against the profile directory and silently yields a
# wrong path (observed: ../../../../mnt/... became /home/mnt/...), which the
# bundle list then displays as the plugin's source.
```

A manual link is **not** the supported path: the next `pnpm install` in that
profile will drop the symlink, and the Plugins screen keeps failing until the
store is migrated. Restarting the application is required — bundles are read at
startup, and `link:` cannot hot-load.

## 4. First run checklist

1. Open a conversation with a workspace that contains an `.svg`, `.html` or `.css` file.
2. Open `examples/design.svg` (copy it into that workspace first).
3. Verify: the layer list shows nested layers, dragging a shape rewrites only
   its coordinates, `Undo` restores the identical bytes, and `Recharger le
   fichier` shows the saved document.
4. Edit outside the editor (any other program), then save from the editor: the
   save must be refused with an explicit stale-revision message and the external
   content must survive. This is the intended behaviour.

## 5. Uninstall / rollback

- Remove the plugin from the profile (command above) and restart.
- The editor never converts your documents: uninstalling leaves SVG/HTML/CSS
  files exactly as they were, because every edit was a targeted source patch.
- If a save was refused or a crash left `.<file>.dsh-native.lock` behind, confirm
  no Design Studio process is saving that file, then remove the directory
  manually. It is never auto-evicted, by design.

## 6. Verifying the installation is real

```bash
npm run check        # core suite, no dependencies installed
npm run test:browser # real Chromium + Firefox gate (needs npm install)
npm run test:dsh     # real DSH installation, disposable profile (needs the dsh install)
```

`npm run test:dsh` prints one line per step and an explicit `NOT_RUN` when the
DSH installation, Playwright or a session is unavailable. A `NOT_RUN` is never
reported as a success.

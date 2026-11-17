# Installing DSH Design Studio in a DeepSeek Harness profile

The plugin is **MIT**, has **zero runtime dependencies**, and is delivered as a
DSH bundle: `package.json` → `dsh.bundle.patch` → `cordis.patch.yml`.

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

/**
 * Real DSH Desktop (Electron) verification (gate G0, desktop half).
 *
 * The plugin is an *internal DSH bundle*: users mostly run it inside the DSH
 * Desktop application, so an alpha that only works in the Web app would be a
 * false PASS. This module drives the real Electron shell:
 *
 *   1. the shell is booted once in a disposable HOME/DSH_HOME so it creates its
 *      own `desktop` profile (that profile is owned by the app, not by the CLI);
 *   2. the plugin is installed into it with the real CLI
 *      (`dsh plugin --profile desktop add link:<repo>`) — the documented way to
 *      add a bundle to the Desktop app;
 *   3. the shell is booted again and Playwright attaches over CDP to the real
 *      `dsh-app://app/` renderer. That is a DIFFERENT document and delivery path
 *      than the Web app (batched `plugins/??…` URLs over a custom protocol), so
 *      it is exactly where a client bundle silently breaks;
 *   4. the Host routes, the workbench, the host theme, the screenshot and the
 *      page errors are asserted inside that renderer.
 *
 * The shell has a first-run onboarding wizard and no `--patch` switch, so the
 * conversation is made non-blank by sending ONE short message. With no provider
 * adapter in the disposable desktop profile that message fails before any
 * network call (observed: `NO_ADAPTER`), which is enough for DSH to render the
 * conversation.view area. If a provider adapter does exist and the caller opted
 * into credentials, that one message could consume a few dozen tokens — set
 * DSH_E2E_DESKTOP_TURN=0 to skip it (the workbench step then reports NOT_RUN).
 *
 * Every step reports PASS/FAIL/NOT_RUN with the observation that justifies it.
 * A missing Electron runtime, a refused profile or a shell that never publishes
 * a DevTools port is NOT_RUN, never PASS.
 */
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Run a command to completion, capturing both streams. */
function run(interpreter, argv, env, timeout = 180000) {
  return new Promise((resolve) => {
    const child = spawn(interpreter, argv, { env })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }) })
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: -1, out, err: String(error) }) })
  })
}

/** Boot the Electron shell and wait for the two ports it publishes. */
async function bootShell(binary, env) {
  // Extra Electron flags are opt-in only. `DSH_E2E_DESKTOP_ARGS` exists so a
  // headless ozone session can be attempted on a machine without Xvfb, and so a
  // future flag never becomes an implicit default.
  const extra = String(process.env.DSH_E2E_DESKTOP_ARGS || '').split(/\s+/).filter(Boolean)
  const child = spawn(binary, ['--remote-debugging-port=0', ...extra], { env })
  let log = ''
  child.stdout.on('data', (chunk) => { log += chunk })
  child.stderr.on('data', (chunk) => { log += chunk })
  let devtoolsPort = null
  let webUrl = null
  for (let attempt = 0; attempt < 240 && !devtoolsPort; attempt += 1) {
    const match = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(log)
    if (match) devtoolsPort = Number(match[1])
    else await sleep(250)
  }
  for (let attempt = 0; attempt < 120 && !webUrl; attempt += 1) {
    const match = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+)/.exec(log)
    if (match) webUrl = match[1]
    else await sleep(250)
  }
  return { child, devtoolsPort, webUrl, log: () => log }
}

/** Stop the shell and everything it spawned. */
async function stopShell(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await sleep(900)
  if (child.exitCode === null) child.kill('SIGKILL')
  await sleep(300)
}

/** Click through the shell's first-run wizard; never a window-closing button. */
async function dismissOnboarding(page) {
  const steps = [/^(Commencez|Get started)$/, /^(Je l'ai compris|I understand)$/,
    /^(Sauter|Skip|Passer)$/, /^(Plus tard|Later|Pas maintenant|Not now)$/,
    /^(Suivant|Next)$/, /^(Continuer|Continue)$/]
  const started = Date.now()
  let idle = 0
  // The wizard appears a beat after the boot payload, and one step can open a
  // confirmation dialog, so keep polling instead of failing on the first frame.
  while (Date.now() - started < 90000 && idle < 8) {
    let clicked = false
    for (const name of steps) {
      const button = page.getByRole('button', { name })
      if (!(await button.count())) continue
      if (await button.first().click({ timeout: 5000 }).then(() => true).catch(() => false)) {
        clicked = true
        break
      }
    }
    if (clicked) {
      idle = 0
      await page.waitForTimeout(1200)
    } else {
      idle += 1
      await page.waitForTimeout(1500)
    }
  }
}

async function checkDesktopSidebar(page, workspaceId, fixture, record) {
  const file = path.basename(fixture)
  const original = await readFile(fixture, 'utf8')
  await page.getByRole('button', { name: 'Design Studio', exact: true }).click({ timeout: 20000 })
  const panel = page.locator('[aria-label="Design Studio panel"]')
  await panel.getByLabel('Workspace', { exact: true }).selectOption(workspaceId, { timeout: 15000 })
  await panel.getByRole('button', { name: 'Open file ' + file, exact: true }).click()
  await panel.getByRole('button', { name: 'Select layer rect #probe', exact: true }).click()
  const x = panel.getByLabel('Geometry x', { exact: true })
  await x.fill('25')
  await x.press('Enter')
  const preview = panel.frameLocator('iframe[title="Isolated SVG preview"]')
  await preview.locator('rect#probe[x="25"]').waitFor()
  const saved = await readFile(fixture, 'utf8')
  if (saved !== original.replace('x="10"', 'x="25"')) throw new Error('Desktop save changed unexpected bytes')
  await panel.getByRole('button', { name: 'Undo saved edit', exact: true }).click()
  await preview.locator('rect#probe[x="10"]').waitFor()
  if (await readFile(fixture, 'utf8') !== original) throw new Error('Desktop Undo did not restore exact bytes')
  record('credential-free Desktop sidebar saves and undoes an SVG', 'PASS',
    'real renderer and Host, exact saved bytes, Undo restored the original')
}

/**
 * Verify the plugin inside the real DSH Desktop renderer.
 * @param {object} options
 * @param {string} options.root Disposable root that owns every file written here.
 * @param {string} options.binary The real Electron binary (`deepseek-harness`).
 * @param {string} options.cli Path of the real `dsh` CLI inside app.asar.
 * @param {string} options.repoRoot Repository root that gets installed.
 * @param {(step: string, status: string, detail: string) => void} options.record
 * @param {object} options.playwright Loaded Playwright module.
 * @param {object} options.env Environment of the disposable home (HOME, DSH_HOME…).
 * @param {boolean} [options.hasCredentials] Credentials were copied into the home.
 * @param {string} [options.screenshot] Optional path for the evidence capture.
 */
export async function checkDesktopShell({ root, binary, cli, repoRoot, record, playwright, env,
  hasCredentials = false, screenshot = '' }) {
  // The CLI lives inside app.asar and only the Electron binary can read that
  // archive, so the binary is what must exist on disk; the CLI is its argument.
  if (!existsSync(binary)) {
    record('boot the real DSH Desktop shell', 'NOT_RUN', 'no Electron binary at ' + binary)
    return
  }
  const home = env.DSH_HOME
  const profileDir = path.join(home, 'profiles/desktop')
  // Keep every XDG directory inside the disposable root: the shell derives its
  // userData from them, and a host path would mean touching real settings.
  const shellEnv = { ...env }
  delete shellEnv.ELECTRON_RUN_AS_NODE
  delete shellEnv.DSH_PROFILE
  delete shellEnv.DSH_PROFILE_DIR
  for (const key of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME']) {
    shellEnv[key] = path.join(root, key.toLowerCase().replace(/_/g, '-'))
    await mkdir(shellEnv[key], { recursive: true })
  }

  // Phase 1 — first launch: the app owns its `desktop` profile and creates it.
  let shell = null
  try {
    shell = await bootShell(binary, shellEnv)
    if (!shell.devtoolsPort) {
      record('boot the real DSH Desktop shell', 'NOT_RUN',
        'the shell never published a DevTools port: ' + shell.log().slice(-300))
      return
    }
    record('boot the real DSH Desktop shell', 'PASS',
      `Electron shell, CDP port ${shell.devtoolsPort}` + (shell.webUrl ? ', Host ' + new URL(shell.webUrl).origin : ''))
    await sleep(6000)
    const profiles = await readdir(path.join(home, 'profiles')).catch(() => [])
    record('the shell initializes its own desktop profile', profiles.includes('desktop') ? 'PASS' : 'FAIL',
      'profiles: ' + JSON.stringify(profiles) +
        // A headless ozone session boots Electron but its first-run window is
        // never driven, so the profile is not created. Say so instead of leaving
        // a bare list of directories.
        (profiles.includes('desktop') ? ''
          : '; the first-run window was not driven (headless ozone / no interactive display)'))
    if (!profiles.includes('desktop')) return
  } finally {
    await stopShell(shell?.child)
  }

  // Phase 2 — install the plugin the way a user does: through the real CLI.
  const installed = await run(binary, ['--expose-internals', cli, 'plugin', '--profile', 'desktop', 'add',
    'link:' + repoRoot], { ...env, ELECTRON_RUN_AS_NODE: '1' })
  let bundles = []
  try {
    const manifest = JSON.parse(await readFile(path.join(profileDir, 'package.json'), 'utf8'))
    bundles = manifest?.dsh?.profile?.bundles ?? []
  } catch { /* reported below */ }
  record('install the plugin into the Desktop profile',
    installed.code === 0 && bundles.includes('@rwanbt/dsh-design-studio') ? 'PASS' : 'FAIL',
    installed.code === 0
      ? 'bundles: ' + JSON.stringify(bundles)
      : `dsh plugin exited ${installed.code}: ${(installed.err || installed.out).slice(0, 300)}`)
  if (!bundles.includes('@rwanbt/dsh-design-studio')) return

  // A workspace is a user-level precondition; the headless shell cannot open a
  // native folder picker. An existing registration (for example the one the Web
  // phase created in the same home) is reused as-is: rewriting a store that the
  // application also owns is how a seeded state silently diverges.
  const workspaceDir = path.join(env.HOME, 'Documents/deepseek-harness/default-workspace')
  await mkdir(workspaceDir, { recursive: true })
  const workspaceFile = path.join(home, 'storages/workspace.json')
  await mkdir(path.dirname(workspaceFile), { recursive: true })
  const usable = await readFile(workspaceFile, 'utf8').then((body) => {
    const store = JSON.parse(body)
    const ids = store?.global?.workspaceIds ?? []
    const table = store?.tables?.workspaces ?? {}
    return ids.some((id) => table[id] && existsSync(table[id].path))
  }).catch(() => false)
  if (!usable) {
    const workspaceId = randomUUID()
    await writeFile(workspaceFile, JSON.stringify({
      unit: { name: 'workspace', version: 2 },
      global: { initialized: true, workspaceIds: [workspaceId], archivedSessionIds: [], pinnedSessionIds: [] },
      tables: { workspaces: { [workspaceId]: { path: workspaceDir, title: 'desktop-e2e-workspace',
        sessionIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } } },
    }, null, 2) + '\n', 'utf8')
  }
  // A file the workbench must find: this proves the renderer reaches the Host
  // through the desktop protocol, not only that the view is mounted.
  const activeWorkspace = await readFile(workspaceFile, 'utf8').then((body) => {
    const store = JSON.parse(body)
    const table = store?.tables?.workspaces ?? {}
    const id = (store?.global?.workspaceIds ?? []).find((candidate) => table[candidate] && existsSync(table[candidate].path))
    if (!id) throw new Error('No registered Desktop test workspace')
    return { id, directory: table[id].path }
  })
  const probeName = 'desktop-probe.svg'
  const probePath = path.join(activeWorkspace.directory, probeName)
  await writeFile(probePath,
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">\n  <rect id="probe" x="10" y="10" width="40" height="30" fill="#bda991"/>\n</svg>\n',
    'utf8')

  // Phase 3 — second launch: the real renderer, with the bundle registered.
  shell = null
  let browser = null
  try {
    shell = await bootShell(binary, shellEnv)
    if (!shell.devtoolsPort) {
      record('attach to the real Desktop renderer', 'NOT_RUN',
        'the second shell launch published no DevTools port: ' + shell.log().slice(-300))
      return
    }
    browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:' + shell.devtoolsPort, { timeout: 30000 })
    const context = browser.contexts()[0]
    const pages = context.pages()
    const page = pages.find((candidate) => candidate.url().startsWith('dsh-app://'))
    if (!page) {
      record('attach to the real Desktop renderer', 'FAIL',
        'no dsh-app:// page among ' + JSON.stringify(pages.map((candidate) => candidate.url())))
      return
    }
    // Closing the welcome window before entering the workspace quits Electron.
    // The API key screen offers an explicit skip without credentials.
    const welcome = pages.find((candidate) => candidate.url().endsWith('/welcome.html'))
    if (welcome) {
      await welcome.locator('#api-key').click({ timeout: 15000 })
      await welcome.locator('#skip-key').click({ timeout: 15000, noWaitAfter: true })
    }
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 200)))
    await page.waitForFunction(() => (window.__DSH_BOOT__?.entries || []).length > 0, null, { timeout: 45000 })
      .catch(() => {})
    const engine = await page.evaluate(() => {
      const electron = /Electron\/([\d.]+)/.exec(navigator.userAgent)
      const chromium = /Chrome\/([\d.]+)/.exec(navigator.userAgent)
      return { electron: electron ? electron[1] : null, chromium: chromium ? chromium[1] : null,
        entries: (window.__DSH_BOOT__?.entries || []).length, href: location.href }
    })
    record('attach to the real Desktop renderer',
      engine.electron ? 'PASS' : 'FAIL',
      engine.electron
        ? `Electron ${engine.electron}, Chromium ${engine.chromium}, ${engine.entries} client entries on ${engine.href}`
        : 'attached page is not the Electron renderer: ' + JSON.stringify(engine))

    // The shell delivers client bundles over its own protocol in batched URLs:
    // a different path from the Web app, and the one that would break silently.
    const entry = await page.evaluate(async () => {
      const found = (window.__DSH_BOOT__?.entries || [])
        .filter((item) => String(item.id || '').includes('dsh-design-studio'))
      if (found.length === 0) return { registered: false }
      const item = found[0]
      try {
        const response = await fetch(item.url, { cache: 'no-store' })
        const source = await response.text()
        return { registered: true, id: item.id, url: item.url, immediate: item.immediately,
          status: response.status, bytes: source.length,
          registersView: source.includes('conversation.view') && source.includes('dsh-design-studio') }
      } catch (error) {
        return { registered: true, id: item.id, url: item.url, error: String(error).slice(0, 200) }
      }
    }).catch((error) => ({ registered: false, error: String(error).slice(0, 200) }))
    record('the Desktop shell serves the plugin client bundle',
      entry.registered && entry.status === 200 && entry.bytes > 1000 && entry.registersView ? 'PASS' : 'FAIL',
      entry.registered
        ? `${entry.id} ${entry.url} HTTP ${entry.status}, ${entry.bytes} bytes, immediately=${entry.immediate}` +
          (entry.error ? ` (${entry.error})` : '')
        : 'the plugin is absent from the Desktop renderer entries: ' + JSON.stringify(entry.error || ''))

    // The Host half must run inside the desktop runtime too. The token URL
    // authenticates the request context; the Host refuses anonymous calls (401).
    if (shell.webUrl) {
      await context.request.get(shell.webUrl).catch(() => {})
      const health = await context.request.get(new URL('/design-studio-native/health', shell.webUrl).href)
        .then(async (response) => ({ status: response.status(), body: await response.json().catch(() => null) }))
        .catch((error) => ({ status: 0, body: String(error).slice(0, 120) }))
      record('the plugin Host routes run in the desktop runtime',
        health.status === 200 && health.body?.ok === true ? 'PASS' : 'FAIL',
        `HTTP ${health.status} ${JSON.stringify(health.body).slice(0, 120)}`)
    }

    // A conversation is required for DSH to render the conversation.view area.
    await dismissOnboarding(page)
    await checkDesktopSidebar(page, activeWorkspace.id, probePath, record)
    let workbench = 0
    if (process.env.DSH_E2E_DESKTOP_TURN === '0') {
      record('the workbench renders in DSH Desktop', 'NOT_RUN', 'disabled with DSH_E2E_DESKTOP_TURN=0')
    } else {
      const composer = page.locator('[contenteditable="true"], textarea').first()
      await composer.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
      const usable = await composer.click({ timeout: 15000 }).then(() => true).catch(() => false)
      if (usable) {
        await page.keyboard.type('Reply with the single word: ok')
        const send = page.getByRole('button', { name: /^(Envoyer le message|Send message)$/ })
        let sent = await send.count()
          ? await send.first().click({ timeout: 10000 }).then(() => true).catch(() => false)
          : false
        if (!sent) await page.keyboard.press('Enter')
      }
      // The view switcher appears once the conversation is no longer blank.
      const viewTab = page.getByRole('tab', { name: /Design Studio/i })
      for (let attempt = 0; attempt < 60 && !(await viewTab.count()); attempt += 1) await sleep(1000)
      if (await viewTab.count()) await viewTab.first().click({ timeout: 10000 }).catch(() => {})
      workbench = await page.getByText('DSH · Design Studio').count().catch(() => 0)
      const visible = usable ? '' : await page.evaluate(() => Array.from(document.querySelectorAll('button'))
        .filter((button) => button.offsetParent !== null).map((button) => button.innerText.trim())
        .filter(Boolean).slice(0, 8)).catch(() => [])
      record('the workbench renders in DSH Desktop',
        workbench > 0 ? 'PASS' : (usable ? 'FAIL' : 'NOT_RUN'),
        workbench > 0
          ? 'conversation.view tab opened and the workbench element is in the desktop DOM'
          : usable
            ? 'the composer was usable but the conversation.view area never rendered'
            : 'the shell composer was not reachable (onboarding wizard not dismissed); visible buttons: '
              + JSON.stringify(visible))
    }

    if (workbench > 0) {
      const theme = await page.evaluate(() => {
        const section = document.querySelector('.dsh-studio-workbench')
        if (!section) return { found: false }
        const probe = document.createElement('div')
        probe.style.background = 'var(--dsw-alias-bg-layer-1)'
        document.body.appendChild(probe)
        const tokenValue = getComputedStyle(probe).backgroundColor
        probe.remove()
        const box = section.getBoundingClientRect()
        return { found: true, background: getComputedStyle(section).backgroundColor, tokenValue,
          width: Math.round(box.width), height: Math.round(box.height) }
      })
      // The client calls the Host with RELATIVE URLs, which on dsh-app://app/
      // only work if the application's protocol forwards them to the runtime.
      // A rendered shell with an empty file list would look fine and be broken.
      // The panel opens on demand ("Parcourir…"), it never lists files on mount.
      // The visible label is localized and its aria-label overrides it, so the
      // stable hook is the label the bundle always ships.
      const browse = page.getByRole('button', { name: /Browse workspace design files/i })
      const browsed = await browse.count()
        ? await browse.first().click({ timeout: 10000 }).then(() => true).catch(() => false)
        : false
      let listed = false
      for (let attempt = 0; attempt < 25 && !listed; attempt += 1) {
        listed = await page.getByText(probeName).count().then((count) => count > 0).catch(() => false)
        if (!listed) await sleep(750)
      }
      const panelText = listed ? '' : (await page.evaluate(() => {
        const section = document.querySelector('.dsh-studio-workbench')
        return section ? section.innerText.slice(0, 240).replace(/\n+/g, ' | ') : 'no workbench section'
      }).catch(() => ''))
      record('the workbench reaches the Host through the desktop protocol',
        listed ? 'PASS' : 'FAIL',
        listed
          ? `${probeName} listed from the workspace the application registered`
          : `${probeName} never appeared after opening the file panel (clicked=${browsed}); ` +
            `panel text: ${JSON.stringify(panelText)}`)

      record('workbench painted by the host theme in DSH Desktop',
        theme.found && theme.background === theme.tokenValue && theme.width > 200 ? 'PASS' : 'FAIL',
        theme.found
          ? `background=${theme.background}, desktop --dsw-alias-bg-layer-1=${theme.tokenValue}, ` +
            `box=${theme.width}x${theme.height}`
          : 'the workbench section was not found in the desktop DOM')

      if (screenshot) {
        const body = await page.screenshot({ timeout: 15000 }).catch(() => null)
        const section = page.locator('.dsh-studio-workbench').first()
        const elementShot = await section.screenshot({ timeout: 15000 }).catch(() => null)
        await mkdir(path.dirname(path.resolve(screenshot)), { recursive: true }).catch(() => {})
        const viewPath = path.resolve(screenshot)
        const elementPath = viewPath.replace(/\.png$/i, '-element.png')
        if (body) await writeFile(viewPath, body)
        if (elementShot) await writeFile(elementPath, elementShot)
        // IHDR is the first chunk: 8-byte signature, length, type, then w/h.
        const dimension = elementShot && elementShot.length > 33
          ? `${elementShot.readUInt32BE(16)}x${elementShot.readUInt32BE(20)}`
          : 'n/a'
        record('screenshot of the workbench in DSH Desktop',
          Boolean(body) && Boolean(elementShot) ? 'PASS' : 'FAIL',
          body && elementShot
            ? `${viewPath} (${body.length} bytes) + ${elementPath} (${elementShot.length} bytes, ${dimension})`
            : 'the Electron renderer returned no screenshot')
      }
    }

    // Same policy as the Web run: plugin or uncaught page errors fail; missing
    // account records in a disposable home are environment noise.
    const errors = pageErrors.filter((item) => !/\[deepseek-account\]|account read failed/.test(item))
    record('no plugin JavaScript errors in DSH Desktop',
      errors.length === 0 ? 'PASS' : 'FAIL',
      errors.slice(0, 3).join(' | ') || 'none')
    if (hasCredentials) record('credentials for the desktop run', 'PASS',
      'copied from the caller into the disposable home (mode 600, deleted with it)')
  } catch (error) {
    record('real DSH Desktop check', 'FAIL',
      String(error && error.message ? error.message : error).slice(0, 300))
  } finally {
    if (browser) await browser.close().catch(() => {})
    await stopShell(shell?.child)
  }
}

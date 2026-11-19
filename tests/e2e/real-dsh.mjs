/**
 * Real DeepSeek Harness installation test (gate G0).
 *
 * This is the only test that exercises the plugin inside the real product:
 * a disposable DSH_HOME + HOME, the real `dsh` CLI, the real web application,
 * a real Chromium page and the real Host services behind the plugin routes.
 *
 * Nothing here is simulated. When the DSH installation, Playwright or a browser
 * is unavailable the step reports NOT_RUN and the script exits 0 — a missing
 * environment is never reported as a PASS.
 *
 * Usage: node tests/e2e/real-dsh.mjs [--json=path] [--keep]
 *   DSH_E2E_DSH_ROOT   installation root containing `deepseek-harness` and
 *                      `resources/app.asar` (default: /mnt/Stockage/App/DeepSeekHarness)
 *   DSH_E2E_PLAYWRIGHT Playwright package directory (devDependency fallback)
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm, mkdir, readdir, stat, writeFile, readFile, copyFile, chmod } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { checkDesktopShell } from './desktop-shell.mjs'
import { disposableEnvironment } from './environment.mjs'
import { stopServer } from './real-dsh-lifecycle.mjs'
import { checkSidebar, sessionWorkspaceFromRegistry, isExpectedConflictConsole } from './real-dsh-web.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const hit = args.find((argument) => argument.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const keep = args.includes('--keep')
const jsonPath = option('json', '')

const results = []
const record = (step, status, detail) => {
  results.push({ step, status, detail })
  console.log(`${status.padEnd(8)} ${step} — ${detail}`)
}

function resolvePlaywright() {
  const candidates = []
  if (process.env.DSH_E2E_PLAYWRIGHT) candidates.push(process.env.DSH_E2E_PLAYWRIGHT)
  candidates.push(path.join(repoRoot, 'node_modules/playwright'))
  for (const extra of String(process.env.DSH_E2E_PLAYWRIGHT_FALLBACKS || '').split(path.delimiter)) {
    if (extra) candidates.push(extra)
  }
  return candidates
}

async function loadPlaywright() {
  for (const candidate of resolvePlaywright()) {
    try {
      const module = await import(pathToFileURL(path.join(candidate, 'index.mjs')).href)
      if (module.chromium) return { module, from: candidate }
    } catch { /* try next */ }
  }
  return null
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const installRoot = process.env.DSH_E2E_DSH_ROOT || '/mnt/Stockage/App/DeepSeekHarness'
  const binary = path.join(installRoot, 'deepseek-harness')
  const archive = path.join(installRoot, 'resources/app.asar')
  const cli = path.join(archive, 'dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')
  // The CLI lives INSIDE app.asar: only the Electron binary can read that
  // archive (plain Node cannot traverse it), so the archive file is what must
  // exist on disk and the binary is the interpreter for every CLI call.
  if (!existsSync(binary) || !existsSync(archive)) {
    record('resolve DSH installation', 'NOT_RUN', `no DeepSeek Harness installation at ${installRoot}`)
    return
  }
  record('resolve DSH installation', 'PASS', `${binary} (${(await stat(binary)).size} bytes), archive present`)

  const playwright = await loadPlaywright()
  if (!playwright) {
    record('resolve Playwright', 'NOT_RUN', 'set DSH_E2E_PLAYWRIGHT or run npm install')
    return
  }

  // Opt-in: a real turn needs a provider. With DSH_E2E_REUSE_CREDENTIALS=1 the
  // harness copies the caller's own DSH credential file into the DISPOSABLE home
  // (mode 600, deleted with the temp root) and never prints it. Nothing is sent
  // unless DSH_E2E_MODEL_PROVIDER/DSH_E2E_MODEL are also set, and then only one
  // short message. Both are off by default.
  const reuseCredentials = process.env.DSH_E2E_REUSE_CREDENTIALS === '1'
  const modelProvider = process.env.DSH_E2E_MODEL_PROVIDER || ''
  const modelName = process.env.DSH_E2E_MODEL || ''
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-g0-'))
  let server = null
  let serverClosed = true
  try {
    const { cliEnv: childEnv, browserEnv, directories } = disposableEnvironment(root, process.env)
    for (const directory of directories) await mkdir(directory, { recursive: true })
    // A registered workspace is a user-level precondition. The headless host
    // cannot open the native folder picker, so the disposable profile is seeded
    // with the registry format the desktop writes when a user adds folders. Everything
    // after this point (Host services, sessions, routes, saves) is real.
    const workspaceDir = path.join(childEnv.HOME, 'Documents/deepseek-harness/default-workspace')
    await mkdir(workspaceDir, { recursive: true })
    const workspaceId = randomUUID()
    const otherWorkspaceId = randomUUID()
    const otherWorkspaceDir = path.join(root, 'empty-workspace')
    await mkdir(otherWorkspaceDir, { recursive: true })
    const document = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">\n  <rect id="box" x="10" y="10" width="40" height="30" fill="#bda991"/>\n</svg>\n'
    await writeFile(path.join(workspaceDir, 'g0-art.svg'), document, 'utf8')
    await mkdir(path.join(childEnv.DSH_HOME, 'storages'), { recursive: true })
    let credentialCopy = null
    if (reuseCredentials) {
      const sourceCredentials = path.join(path.dirname(process.env.DSH_HOME || path.join(os.homedir(), '.dsh')), '.dsh/.credentials.yaml')
      for (const candidate of [sourceCredentials, path.join(os.homedir(), '.dsh/.credentials.yaml')]) {
        if (existsSync(candidate)) {
          credentialCopy = path.join(childEnv.DSH_HOME, '.credentials.yaml')
          await copyFile(candidate, credentialCopy)
          await chmod(credentialCopy, 0o600)
          break
        }
      }
    }
    record('reuse caller credentials for a real turn',
      reuseCredentials ? (credentialCopy ? 'PASS' : 'NOT_RUN') : 'NOT_RUN',
      reuseCredentials
        ? (credentialCopy ? 'copied into the disposable DSH_HOME (mode 600, deleted at the end)' : 'no credential file found')
        : 'disabled (set DSH_E2E_REUSE_CREDENTIALS=1 to enable)')

    await writeFile(path.join(childEnv.DSH_HOME, 'storages/workspace.json'), JSON.stringify({
      unit: { name: 'workspace', version: 2 },
      global: { initialized: true, workspaceIds: [otherWorkspaceId, workspaceId], archivedSessionIds: [], pinnedSessionIds: [] },
      tables: { workspaces: { [otherWorkspaceId]: { path: otherWorkspaceDir, title: 'e2e-empty-workspace',
        sessionIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, [workspaceId]: { path: workspaceDir, title: 'e2e-workspace',
        sessionIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } } },
    }, null, 2) + '\n', 'utf8')
    const nodeBin = process.env.DSH_E2E_NODE || binary
    /** Run the real dsh CLI to completion and capture both streams. */
    const run = (cliArgs, { timeout = 180000 } = {}) => new Promise((resolve) => {
      const child = spawn(nodeBin, ['--expose-internals', cli, ...cliArgs], { env: childEnv })
      let out = ''
      let err = ''
      const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
      child.stdout.on('data', (chunk) => { out += chunk })
      child.stderr.on('data', (chunk) => { err += chunk })
      child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }) })
      child.on('error', (error) => { clearTimeout(timer); resolve({ code: -1, out, err: String(error) }) })
    })

    const created = await run(['--profile', 'e2e', '--from-default-profile', 'web', '--dump-config'])
    if (created.code !== 0) {
      record('create disposable profile', 'FAIL', `dsh exited ${created.code}: ${created.err.slice(0, 300)}`)
      return
    }
    record('create disposable profile', 'PASS', `${childEnv.DSH_HOME}/profiles/e2e (shipped web template)`)

    const installed = await run(['plugin', '--profile', 'e2e', 'add', 'link:' + repoRoot])
    if (installed.code !== 0) {
      record('install plugin into profile', 'FAIL', `dsh plugin exited ${installed.code}: ${installed.err.slice(0, 400)}`)
      return
    }
    const profileJson = JSON.parse(await readFile(path.join(childEnv.DSH_HOME, 'profiles/e2e/package.json'), 'utf8'))
    const registered = profileJson?.dsh?.profile?.bundles?.includes('@rwanbt/dsh-design-studio')
    record('install plugin into profile', registered ? 'PASS' : 'FAIL',
      'bundles: ' + JSON.stringify(profileJson?.dsh?.profile?.bundles))

    // Boot the real web application on an ephemeral port.
    const bootArgs = ['--expose-internals', cli, '--profile', 'e2e']
    if (credentialCopy && modelProvider && modelName) {
      const overlay = path.join(root, 'model.yml')
      await writeFile(overlay, '- id: agent-default-model\n  name: "@deepseek-ai/dsh-agent-default-model"\n'
        + '  config:\n    provider: ' + JSON.stringify(modelProvider) + '\n    model: ' + JSON.stringify(modelName) + '\n', 'utf8')
      bootArgs.push('--patch', overlay)
      record('model overlay for a real turn', 'PASS', `${modelProvider}/${modelName} (no secret is logged)`)
    } else {
      record('model overlay for a real turn', 'NOT_RUN', 'requires explicit credential reuse plus DSH_E2E_MODEL_PROVIDER and DSH_E2E_MODEL')
    }
    bootArgs.push('--no-open', '--port', '0', '--host', '127.0.0.1')
    server = spawn(nodeBin, bootArgs, { env: childEnv })
    serverClosed = false
    server.once('close', () => { server.dshE2eClosed = true })
    let serverError = null
    server.on('error', (error) => { serverError = error })
    let log = ''
    server.stdout.on('data', (chunk) => { log += chunk })
    server.stderr.on('data', (chunk) => { log += chunk })
    let url = null
    for (let attempt = 0; attempt < 120 && !url; attempt += 1) {
      const match = /(http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+)/.exec(log)
      if (match) url = match[1]
      else if (serverError || server.dshE2eClosed) break
      else await sleep(250)
    }
    if (!url) {
      record('boot real DSH web app', 'FAIL', String(serverError || 'no URL in: ' + log.slice(-400)))
      return
    }
    const origin = new URL(url).origin
    record('boot real DSH web app', 'PASS', origin)

    const browser = await playwright.module.chromium.launch({ headless: true, env: browserEnv,
      args: ['--disable-dev-shm-usage', '--no-sandbox'] })
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      const page = await context.newPage()
      const consoleErrors = []
      const refusalEvidence = { active: false, confirmed: false, requestCount: 0, url: '', consoleIndices: [] }
      page.on('pageerror', (error) => consoleErrors.push(String(error).slice(0, 200)))
      page.on('console', (message) => {
        if (message.type() !== 'error') return
        const diagnostic = { text: message.text(), url: message.location().url }
        const index = consoleErrors.push(diagnostic.text.slice(0, 200)) - 1
        if (isExpectedConflictConsole(diagnostic, refusalEvidence)) refusalEvidence.consoleIndices.push(index)
      })
      await page.goto(url, { waitUntil: 'load', timeout: 60000 })
      await page.waitForTimeout(4000)
      const title = await page.title()
      record('load real DSH Web UI', 'PASS', JSON.stringify(title))

      // Dismiss onboarding overlays without relying on a single language: the
      // preview notice, then the "no credentials yet" dialog.
      for (const name of [/^(Continuer|Continue)$/, /^(Fermer|Close)$/]) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const button = page.getByRole('button', { name })
          if (!(await button.count())) break
          await button.first().click({ timeout: 8000 }).catch(() => {})
          await page.waitForTimeout(700)
        }
      }

      const studio = await checkSidebar({ page, workspaceId, otherWorkspaceId, workspaceDir, document, record, refusalEvidence })

      // Optional evidence capture: the viewport AND the workbench element itself.
      // An element screenshot is proof that the plugin is really on screen; a bare
      // viewport shot can be all page chrome if the view sits below the fold.
      const screenshot = process.env.DSH_E2E_SCREENSHOT
      if (screenshot) {
        const target = studio
        await target.scrollIntoViewIfNeeded().catch(() => {})
        await page.waitForTimeout(400)
        await mkdir(path.dirname(path.resolve(screenshot)), { recursive: true })
        await page.screenshot({ path: path.resolve(screenshot) })
        const section = studio
        const elementShot = path.resolve(screenshot).replace(/\.png$/i, '-element.png')
        const captured = await section.screenshot({ path: elementShot }).then(() => true).catch(() => false)
        record('screenshot of the real DSH workbench', captured ? 'PASS' : 'FAIL',
          captured ? `${path.resolve(screenshot)} + ${elementShot}` : 'could not capture the workbench element')
      }
      const newSession = page.getByRole('button', { name: /^(Nouvelle séance|New session)$/ })
      if (await newSession.count()) {
        await newSession.first().click({ timeout: 15000 }).catch(() => {})
        await page.waitForTimeout(2500)
      }

      // The Host services only answer for a live DSH session: discover its id
      // from the real session store instead of guessing it.
      const sessionsRoot = path.join(childEnv.DSH_HOME, 'sessions')
      let sessionId = null
      for (let attempt = 0; attempt < 40 && !sessionId; attempt += 1) {
        const workspaces = await readdir(sessionsRoot).catch(() => [])
        for (const workspace of workspaces) {
          const ids = await readdir(path.join(sessionsRoot, workspace)).catch(() => [])
          if (ids.length) sessionId = ids[ids.length - 1]
        }
        if (!sessionId) await sleep(250)
      }
      record('create a real DSH session', sessionId ? 'PASS' : 'NOT_RUN',
        sessionId ? sessionId : 'the Web UI did not create a session')

      if (sessionId) {
        // Resolve actual session membership, not the sidebar's independent picker.
        // Only the two roots created by this runner may receive a fixture.
        let sessionWorkspace = null
        for (let attempt = 0; attempt < 40 && !sessionWorkspace; attempt += 1) {
          const registry = JSON.parse(await readFile(path.join(childEnv.DSH_HOME, 'storages/workspace.json'), 'utf8'))
          sessionWorkspace = sessionWorkspaceFromRegistry(registry, sessionId, [workspaceDir, otherWorkspaceDir])
          if (!sessionWorkspace) await sleep(250)
        }
        if (!sessionWorkspace) throw new Error('Real session has no persisted workspace membership')
        const workspace = sessionWorkspace.path
        await writeFile(path.join(workspace, 'g0-art.svg'), document, 'utf8')
        record('resolve real session workspace', 'PASS', `registry membership ${sessionWorkspace.id}; fixture written inside its owned root`)

        const health = await context.request.get(origin + '/design-studio-native/health')
        const healthBody = await health.json().catch(() => null)
        record('plugin route /health on the real Host',
          health.status() === 200 && healthBody?.ok === true ? 'PASS' : 'FAIL',
          `HTTP ${health.status()} ${JSON.stringify(healthBody)}`)

        const files = await context.request.get(origin +
          '/design-studio-native/files?sessionId=' + encodeURIComponent(sessionId))
        const filesBody = await files.json().catch(() => null)
        const workspaceLabel = filesBody?.files ? `${filesBody.files.length} files` : 'no file payload'
        record('plugin route /files on the real Host',
          files.status() === 200 && Array.isArray(filesBody?.files) &&
            filesBody.files.some(file => file.path === 'g0-art.svg') ? 'PASS' : 'FAIL',
          `HTTP ${files.status()} ${workspaceLabel}`)

        // Read the seeded fixture through the real session-scoped Host path.
        const opened = await context.request.get(origin + '/design-studio-native/document?sessionId=' +
          encodeURIComponent(sessionId) + '&file=g0-art.svg')
        const openedBody = await opened.json().catch(() => null)
        const hasHash = typeof openedBody?.document?.hash === 'string'
        record('open a real SVG through the real Host',
          opened.status() === 200 && hasHash ? 'PASS' : 'FAIL',
          `HTTP ${opened.status()} nodes=${Array.isArray(openedBody?.nodes) ? openedBody.nodes.length : 'n/a'}`)

        if (hasHash) {
          const data = { sessionId, file: 'g0-art.svg', baseHash: openedBody.document.hash,
            baseIdentity: openedBody.document.identity, kind: 'svg-attribute',
            id: 'box', attribute: 'x', value: '25' }
          const file = path.join(workspace, data.file)
          const original = await readFile(file)
          const preview = await context.request.post(origin + '/design-studio-native/preview', { data })
          const previewBody = await preview.json().catch(() => null)
          const previewUnchanged = (await readFile(file)).equals(original)

          const applied = await context.request.post(origin + '/design-studio-native/apply', { data })
          const appliedBody = await applied.json().catch(() => null)
          const onDisk = await readFile(file, 'utf8')
          const previewMatchesApply = preview.status() === 200 && previewBody?.changed === true &&
            previewBody.proposedHash === appliedBody?.result?.hash &&
            JSON.stringify(previewBody.patches) === JSON.stringify(appliedBody?.patches)
          record('preview a real SVG edit without writing through the real Host',
            previewUnchanged && previewMatchesApply ? 'PASS' : 'FAIL',
            `HTTP ${preview.status()} unchanged=${previewUnchanged} matchesApply=${previewMatchesApply}`)
          const patched = applied.status() === 200 && onDisk.includes('x="25"') &&
            onDisk.includes('width="40" height="30"')
          record('save a real SVG through the real Host', patched ? 'PASS' : 'FAIL',
            `HTTP ${applied.status()} ${JSON.stringify(appliedBody?.error || 'ok')} bytes=${onDisk.length}`)

          // A stale revision must be refused, never silently overwritten.
          const stale = await context.request.post(origin + '/design-studio-native/apply', {
            data: { sessionId, file: 'g0-art.svg', baseHash: openedBody.document.hash,
              baseIdentity: openedBody.document.identity, kind: 'svg-attribute',
              id: 'box', attribute: 'x', value: '99' },
          })
          const unchanged = (await readFile(path.join(workspace, 'g0-art.svg'), 'utf8')).includes('x="25"')
          record('stale revision refused on the real Host',
            stale.status() === 409 && unchanged ? 'PASS' : 'FAIL',
            `HTTP ${stale.status()}`)
        }
      }

      // A real turn is what makes DSH render the conversation.view area at all.
      // It requires both a provider and the caller's consent, so it is opt-in.
      if (sessionId && credentialCopy && modelProvider && modelName) {
        try {
          const composer = page.locator('[contenteditable="true"], textarea').first()
          await composer.waitFor({ state: 'visible', timeout: 20000 })
          await composer.click()
          await page.keyboard.type('Reply with the single word: ok')
          const send = page.getByRole('button', { name: /^(Envoyer le message|Send message)$/ })
          await send.first().click({ timeout: 15000 })
          const started = Date.now()
          let assistantText = ''
          while (Date.now() - started < 90000) {
            await page.waitForTimeout(2000)
            assistantText = await page.locator('body').innerText()
            if (/\bok\b/.test(assistantText.slice(-4000)) && !/Envoyer le message/.test(assistantText)) break
          }
          record('one real assistant turn', 'PASS', `turn completed in ${Math.round((Date.now() - started) / 1000)}s`)
        } catch (error) {
          record('one real assistant turn', 'FAIL', String(error && error.message ? error.message : error).slice(0, 240))
        }
      } else {
        record('one real assistant turn', 'NOT_RUN',
          'needs DSH_E2E_REUSE_CREDENTIALS=1 plus DSH_E2E_MODEL_PROVIDER/DSH_E2E_MODEL (one short message is sent)')
      }

      // The client bundle must be served by the real Host and registered in the
      // real client manifest. This is provable even when the conversation view
      // area is not rendered (DSH hides it entirely for a blank session).
      const clientEntry = await page.evaluate(async () => {
        const entries = (window.__DSH_BOOT__?.entries || []).filter((entry) => String(entry.id || '').includes('dsh-design-studio'))
        if (entries.length === 0) return { registered: false }
        const entry = entries[0]
        const response = await fetch('/' + entry.url, { cache: 'no-store' })
        const source = await response.text()
        return { registered: true, id: entry.id, url: entry.url, immediately: entry.immediately,
          inject: entry.inject, status: response.status, bytes: source.length,
          registersView: source.includes('conversation.view') && source.includes('dsh-design-studio') }
      })
      record('client bundle served by the real Host',
        clientEntry.registered && clientEntry.status === 200 && clientEntry.bytes > 1000 ? 'PASS' : 'FAIL',
        clientEntry.registered
          ? `${clientEntry.id} HTTP ${clientEntry.status}, ${clientEntry.bytes} bytes, immediately=${clientEntry.immediately}, inject=${JSON.stringify(clientEntry.inject)}`
          : 'the plugin client module is absent from window.__DSH_BOOT__.entries')
      record('client bundle registers the conversation view',
        clientEntry.registersView === true ? 'PASS' : 'FAIL',
        clientEntry.registersView === true ? 'bundle declares conversation.view' : 'the served bundle does not register a conversation view')

      record('legacy conversation workbench gate', 'NOT_RUN',
        'separate optional conversation path; sidebar manual gate needs neither session nor AI')

      // This is a bounded observation gate, not an absence-of-errors or security
      // proof: inherited text filters exclude CSP/account diagnostics globally.
      // Report those exclusions separately rather than attributing their origin.
      const environmentNoise = consoleErrors.filter((entry) => /\[deepseek-account\]|account read failed/.test(entry))
      const cspDiagnostics = consoleErrors.filter((entry) => /Content Security Policy/i.test(entry))
      record('CSP/account diagnostics not assessed by this gate', 'NOT_RUN',
        `CSP excluded=${cspDiagnostics.length}; account excluded=${environmentNoise.length} (text filters, counts may overlap); no security/account guarantee. Samples: ` +
        [...cspDiagnostics.slice(0, 1), ...environmentNoise.slice(0, 1)].join(' | '))
      // Exempt at most the single network diagnostic from the unique, verified
      // HTTP409 stale-revision action; never other 409s, JS errors, or late errors.
      const expectedIndices = refusalEvidence.confirmed && refusalEvidence.requestCount === 1 &&
        refusalEvidence.consoleIndices.length === 1 ? refusalEvidence.consoleIndices : []
      record('classify deliberate conflict resource diagnostic', 'PASS',
        `${expectedIndices.length} network diagnostic correlated to the unique verified /apply HTTP409; remaining diagnostics are checked after the declared CSP/account text exclusions`)
      const pluginErrors = consoleErrors.filter((entry, index) =>
        !expectedIndices.includes(index) &&
        !/Content Security Policy/i.test(entry) &&
        !/\[deepseek-account\]|account read failed/.test(entry))
      record('no non-excluded errors observed during this run',
        pluginErrors.length === 0 ? 'PASS' : 'FAIL',
        `remaining=${pluginErrors.length}; CSP/account text matches and verified expected409 are excluded, not proven harmless. ` +
        (pluginErrors.slice(0, 3).join(' | ') || 'No remaining diagnostic observed.'))

      await context.close()
    } finally {
      await browser.close()
    }

    // Uninstall / rollback is a documented user path: remove the bundle from the
    // disposable profile and prove the profile no longer lists it. Documents are
    // never touched by design, so no repair step is needed.
    if (server) {
      try { await stopServer(server); serverClosed = true } catch { /* reported below */ }
      server = null
    }
    const removed = await run(['plugin', '--profile', 'e2e', 'remove', '@rwanbt/dsh-design-studio'])
    let removedProfile = null
    try {
      removedProfile = JSON.parse(await readFile(path.join(childEnv.DSH_HOME, 'profiles/e2e/package.json'), 'utf8'))
    } catch { /* reported by the assertion below */ }
    const stillListed = removedProfile?.dsh?.profile?.bundles?.includes('@rwanbt/dsh-design-studio')
    record('uninstall the bundle from the disposable profile',
      removed.code === 0 && stillListed === false ? 'PASS' : 'FAIL',
      `dsh plugin remove exited ${removed.code}; still listed=${String(stillListed)}` +
        (removed.code === 0 ? '' : ` ${removed.err.slice(0, 200)}`))

    // Same bundle, different delivery path: the real DSH Desktop (Electron)
    // application. Opt out with DSH_E2E_DESKTOP=0 (the Web assertions above
    // remain the gate).
    if (process.env.DSH_E2E_DESKTOP === '0') {
      record('boot the real DSH Desktop shell', 'NOT_RUN', 'disabled with DSH_E2E_DESKTOP=0')
    } else {
      const shot = process.env.DSH_E2E_SCREENSHOT
      await checkDesktopShell({ root, binary, cli, repoRoot: repoRoot, record,
        playwright: playwright.module, env: childEnv, hasCredentials: Boolean(credentialCopy),
        screenshot: shot ? shot.replace(/\.png$/i, '-desktop.png') : '' })
    }
  } catch (error) {
    record('real DSH test', 'FAIL', String(error && error.message ? error.message : error).slice(0, 400))
  } finally {
    try {
      await stopServer(server)
      serverClosed = true
      if (server) record('stop disposable DSH server', 'PASS', 'close observed before directory cleanup')
    } catch (error) {
      record('stop disposable DSH server', 'FAIL', String(error.message || error))
    }
    if (!keep && serverClosed) {
      try {
        await rm(root, { recursive: true, force: true })
        record('cleanup disposable environment', 'PASS', 'removed owned temporary root after server close')
      } catch (error) {
        record('cleanup disposable environment', 'FAIL', String(error.message || error))
      }
    } else console.log('kept: ' + root)

  }
  return
}

async function finish() {
  const summary = {
    pass: results.filter((entry) => entry.status === 'PASS').length,
    fail: results.filter((entry) => entry.status === 'FAIL').length,
    notRun: results.filter((entry) => entry.status === 'NOT_RUN').length,
  }
  console.log(`\nsummary: ${summary.pass} pass, ${summary.fail} fail, ${summary.notRun} not-run`)
  if (jsonPath) {
    await writeFile(path.resolve(jsonPath), JSON.stringify({ results, summary,
      at: new Date().toISOString() }, null, 2) + '\n')
    console.log('report: ' + path.resolve(jsonPath))
  }
  return summary.fail === 0 ? 0 : 1
}

main().then(finish).then((code) => { process.exitCode = code }).catch((error) => {
  console.error('real DSH test crashed:', error)
  process.exitCode = 2
})

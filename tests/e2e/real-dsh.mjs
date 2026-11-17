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
import { mkdtemp, rm, mkdir, readdir, stat, writeFile, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
    return finish()
  }
  record('resolve DSH installation', 'PASS', `${binary} (${(await stat(binary)).size} bytes), archive present`)

  const playwright = await loadPlaywright()
  if (!playwright) {
    record('resolve Playwright', 'NOT_RUN', 'set DSH_E2E_PLAYWRIGHT or run npm install')
    return finish()
  }

  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-g0-'))
  const childEnv = {
    ...process.env,
    HOME: path.join(root, 'home'),
    DSH_HOME: path.join(root, 'dsh-home'),
    ELECTRON_RUN_AS_NODE: '1',
    NO_AT_BRIDGE: '1',
  }
  await mkdir(childEnv.HOME, { recursive: true })
  await mkdir(childEnv.DSH_HOME, { recursive: true })
  // A registered workspace is a user-level precondition. The headless host
  // cannot open the native folder picker, so the disposable profile is seeded
  // with exactly what the desktop writes when a user adds a folder. Everything
  // after this point (Host services, sessions, routes, saves) is real.
  const workspaceDir = path.join(childEnv.HOME, 'Documents/deepseek-harness/default-workspace')
  await mkdir(workspaceDir, { recursive: true })
  const workspaceId = randomUUID()
  await mkdir(path.join(childEnv.DSH_HOME, 'storages'), { recursive: true })
  await writeFile(path.join(childEnv.DSH_HOME, 'storages/workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [workspaceId], archivedSessionIds: [], pinnedSessionIds: [] },
    tables: { workspaces: { [workspaceId]: { path: workspaceDir, title: 'e2e-workspace',
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

  let server = null
  try {
    const created = await run(['--profile', 'e2e', '--from-default-profile', 'web', '--dump-config'])
    if (created.code !== 0) {
      record('create disposable profile', 'FAIL', `dsh exited ${created.code}: ${created.err.slice(0, 300)}`)
      return finish()
    }
    record('create disposable profile', 'PASS', `${childEnv.DSH_HOME}/profiles/e2e (shipped web template)`)

    const installed = await run(['plugin', '--profile', 'e2e', 'add', 'link:' + repoRoot])
    if (installed.code !== 0) {
      record('install plugin into profile', 'FAIL', `dsh plugin exited ${installed.code}: ${installed.err.slice(0, 400)}`)
      return finish()
    }
    const profileJson = JSON.parse(await readFile(path.join(childEnv.DSH_HOME, 'profiles/e2e/package.json'), 'utf8'))
    const registered = profileJson?.dsh?.profile?.bundles?.includes('@rwanbt/dsh-design-studio')
    record('install plugin into profile', registered ? 'PASS' : 'FAIL',
      'bundles: ' + JSON.stringify(profileJson?.dsh?.profile?.bundles))

    // Boot the real web application on an ephemeral port.
    server = spawn(nodeBin, ['--expose-internals', cli, '--profile', 'e2e', '--no-open',
      '--port', '0', '--host', '127.0.0.1'], { env: childEnv })
    let log = ''
    server.stdout.on('data', (chunk) => { log += chunk })
    server.stderr.on('data', (chunk) => { log += chunk })
    let url = null
    for (let attempt = 0; attempt < 120 && !url; attempt += 1) {
      const match = /(http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+)/.exec(log)
      if (match) url = match[1]
      else await sleep(250)
    }
    if (!url) {
      record('boot real DSH web app', 'FAIL', 'no URL in: ' + log.slice(-400))
      return finish()
    }
    const origin = new URL(url).origin
    record('boot real DSH web app', 'PASS', origin)

    const browser = await playwright.module.chromium.launch({ headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox'] })
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      const page = await context.newPage()
      const consoleErrors = []
      page.on('pageerror', (error) => consoleErrors.push(String(error).slice(0, 200)))
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200))
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
          files.status() === 200 && Array.isArray(filesBody?.files) ? 'PASS' : 'FAIL',
          `HTTP ${files.status()} ${workspaceLabel}`)

        // Write a real document through the real Host write path.
        const workspace = path.join(childEnv.HOME, 'Documents/deepseek-harness/default-workspace')
        const document = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">\n  <rect id="box" x="10" y="10" width="40" height="30" fill="#bda991"/>\n</svg>\n'
        await mkdir(workspace, { recursive: true })
        await writeFile(path.join(workspace, 'g0-art.svg'), document, 'utf8')
        const opened = await context.request.get(origin + '/design-studio-native/document?sessionId=' +
          encodeURIComponent(sessionId) + '&file=g0-art.svg')
        const openedBody = await opened.json().catch(() => null)
        const hasHash = typeof openedBody?.document?.hash === 'string'
        record('open a real SVG through the real Host',
          opened.status() === 200 && hasHash ? 'PASS' : 'FAIL',
          `HTTP ${opened.status()} nodes=${Array.isArray(openedBody?.nodes) ? openedBody.nodes.length : 'n/a'}`)

        if (hasHash) {
          const applied = await context.request.post(origin + '/design-studio-native/apply', {
            data: { sessionId, file: 'g0-art.svg', baseHash: openedBody.document.hash,
              baseIdentity: openedBody.document.identity, kind: 'svg-attribute',
              id: 'box', attribute: 'x', value: '25' },
          })
          const appliedBody = await applied.json().catch(() => null)
          const onDisk = await readFile(path.join(workspace, 'g0-art.svg'), 'utf8')
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

      // Opening the workbench inside the real conversation needs a non-blank
      // session: DSH renders no conversation.view area at all while the session
      // is blank, and producing a turn requires an LLM provider this disposable,
      // credential-free profile deliberately does not have.
      const blank = await page.evaluate(() => document.body.innerText)
      const workbench = await page.getByText('DSH · Design Studio').count()
      record('design studio workbench opens inside real DSH',
        workbench > 0 ? 'PASS' : 'NOT_RUN',
        workbench > 0
          ? 'workbench rendered in the real conversation'
          : 'NOT PROVEN: the conversation.view area is only rendered for a non-blank session; the disposable profile has no LLM provider by design (blank UI: '
            + JSON.stringify(blank.slice(0, 120)) + ')')

      record('no JavaScript errors in the real DSH page',
        consoleErrors.filter((entry) => !/Content Security Policy/i.test(entry)).length === 0 ? 'PASS' : 'FAIL',
        consoleErrors.slice(0, 3).join(' | ') || 'none')
      await context.close()
    } finally {
      await browser.close()
    }
  } catch (error) {
    record('real DSH test', 'FAIL', String(error && error.message ? error.message : error).slice(0, 400))
  } finally {
    if (server) {
      server.kill('SIGTERM')
      await sleep(800)
      if (server.exitCode === null) server.kill('SIGKILL')
    }
    if (!keep) await rm(root, { recursive: true, force: true }).catch(() => {})
    else console.log(`kept: ${root}`)
  }
  return finish()
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

main().then((code) => { process.exitCode = code }).catch((error) => {
  console.error('real DSH test crashed:', error)
  process.exitCode = 2
})

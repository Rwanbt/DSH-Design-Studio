/**
 * Run the real-browser gate: Chromium and Firefox, one browser at a time.
 *
 * Usage:  node tests/browser/run.mjs [--browsers=chromium,firefox] [--grep=substr]
 *                                     [--probe] [--json=path] [--headed]
 *
 * Requires Playwright (devDependency) and its browsers. Set
 * `DSH_E2E_PLAYWRIGHT` to a Playwright package directory when the dependency is
 * not installed in this repository. When Playwright or a browser is missing the
 * runner reports `NOT_RUN` and exits 0 — a missing environment is never a PASS.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { startHarness, repoRoot } from './harness/host-server.mjs'
import { specs } from './specs/index.mjs'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const hit = args.find((argument) => argument.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const flag = (name) => args.includes(`--${name}`)
const wanted = option('browsers', 'chromium,firefox').split(',').map((name) => name.trim()).filter(Boolean)
const grep = option('grep', '')
const probe = flag('probe')
const headed = flag('headed')
const jsonPath = option('json', '')

const BUILD_ID = (() => {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim() }
  catch { return 'unknown' }
})()

async function loadPlaywright() {
  const candidates = []
  if (process.env.DSH_E2E_PLAYWRIGHT) candidates.push(process.env.DSH_E2E_PLAYWRIGHT)
  candidates.push(path.join(repoRoot, 'node_modules/playwright'))
  for (const extra of String(process.env.DSH_E2E_PLAYWRIGHT_FALLBACKS || '').split(path.delimiter)) {
    if (extra) candidates.push(extra)
  }
  for (const candidate of candidates) {
    try {
      const url = pathToFileURL(path.join(candidate, 'index.mjs')).href
      const module = await import(url)
      if (module.chromium && module.firefox) return { module, from: candidate }
    } catch { /* try next candidate */ }
  }
  return null
}

/** Minimal assertion recorder: every failure is reported with its spec and message. */
function createAssert(record) {
  const fail = (message) => { record.failures.push(message); throw new AssertionError(message) }
  class AssertionError extends Error {}
  return {
    AssertionError,
    ok(value, message) { record.checks += 1; if (!value) fail(message || 'expected a truthy value') },
    equal(actual, expected, message) {
      record.checks += 1
      if (!Object.is(actual, expected)) {
        fail(`${message || 'values differ'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
      }
    },
    deepEqual(actual, expected, message) {
      record.checks += 1
      const a = JSON.stringify(actual), b = JSON.stringify(expected)
      if (a !== b) fail(`${message || 'structures differ'}: expected ${b}, got ${a}`)
    },
    match(value, pattern, message) {
      record.checks += 1
      if (!pattern.test(String(value))) fail(`${message || 'pattern mismatch'}: ${pattern} vs ${JSON.stringify(String(value)).slice(0, 400)}`)
    },
    fail(message) { record.checks += 1; fail(message) },
  }
}

async function waitForShell(page) {
  await page.waitForFunction(() => window.__DSH_HARNESS__?.ready === true, null, { timeout: 30000 })
  const state = await page.evaluate(() => ({
    errors: window.__DSH_HARNESS__.errors,
    injected: window.__DSH_HARNESS__.injected,
    registration: window.__DSH_HARNESS__.registration,
    fatal: window.__DSH_HARNESS__.fatal,
  }))
  if (state.fatal) throw new Error('shell failed to mount: ' + state.errors.join(' | '))
  return state
}

async function main() {
  const playwright = await loadPlaywright()
  if (!playwright) {
    console.log('NOT_RUN browser gate: Playwright is unavailable (set DSH_E2E_PLAYWRIGHT or npm install).')
    return 0
  }
  const { module: pw } = playwright
  const selected = specs.filter((spec) => spec.name.includes(grep))
  if (selected.length === 0) {
    console.log(`NOT_RUN browser gate: no spec matches grep "${grep}".`)
    return 0
  }
  const report = { build: BUILD_ID, playwright: playwright.from, startedAt: new Date().toISOString(),
    browsers: {}, summary: { pass: 0, fail: 0, notRun: 0 } }
  console.log(`browser gate — repo ${BUILD_ID}`)
  console.log(`playwright: ${playwright.from}`)
  console.log(`specs: ${selected.length}${grep ? ` (grep "${grep}")` : ''}`)

  for (const browserName of wanted) {
    const type = pw[browserName]
    if (!type) { console.log(`SKIP unknown browser "${browserName}"`); continue }
    let browser
    try {
      browser = await type.launch({ headless: !headed, args: browserName === 'chromium'
        ? ['--disable-dev-shm-usage', '--no-sandbox'] : [] })
    } catch (error) {
      console.log(`NOT_RUN ${browserName}: ${String(error).split('\n')[0]}`)
      report.browsers[browserName] = { status: 'NOT_RUN', reason: String(error).split('\n')[0] }
      report.summary.notRun += 1
      continue
    }
    const version = browser.version()
    console.log(`\n=== ${browserName} ${version} ===`)
    const browserRecord = { version, specs: [], status: 'PASS' }
    report.browsers[browserName] = browserRecord
    try {
      for (const spec of selected) {
        const harness = await startHarness()
        const context = await browser.newContext({ viewport: spec.viewport || { width: 1280, height: 820 },
          ...(spec.contextOptions || {}) })
        const page = await context.newPage()
        const consoleErrors = []
        page.on('pageerror', (error) => consoleErrors.push('pageerror: ' + String(error)))
        page.on('console', (message) => {
          if (message.type() === 'error') consoleErrors.push('console: ' + message.text().slice(0, 200))
        })
        const record = { name: spec.name, checks: 0, failures: [], consoleErrors }
        const assert = createAssert(record)
        let status = 'PASS'
        try {
          await page.goto(harness.url, { waitUntil: 'load' })
          if (!probe) {
            const shell = await waitForShell(page)
            await spec.run({ page, context, browser, harness, assert, shell, probe })
            // `allowConsoleErrors: 'csp-only'` keeps the gate strict: a spec may
            // provoke the browser's expected CSP refusal for an external
            // resource, but a JavaScript error is still a failure.
            const relevant = spec.allowConsoleErrors === true
              ? []
              : consoleErrors.filter((entry) => {
                if (spec.allowConsoleErrors === 'csp-only') return !/Content[- ]Security[- ]Policy/i.test(entry)
                if (spec.allowConsoleErrors === 'refusals') {
                  // A deliberately refused save (409/423) is reported by the
                  // browser as a resource error; the spec asserts the outcome.
                  return !/Content[- ]Security[- ]Policy/i.test(entry) &&
                    !/Failed to load resource: the server responded with a status of (409|423)/.test(entry)
                }
                return true
              })
            if (relevant.length > 0) {
              assert.fail('unexpected console/page errors: ' + relevant.slice(0, 4).join(' ; '))
            }
          } else {
            await probeDom(page, harness, browserName)
          }
        } catch (error) {
          status = 'FAIL'
          record.failures.push(String(error && error.message ? error.message : error))
        }
        if (record.failures.length > 0) status = 'FAIL'
        browserRecord.specs.push({ ...record, status })
        if (status === 'FAIL') browserRecord.status = 'FAIL'
        report.summary[status === 'PASS' ? 'pass' : 'fail'] += 1
        const detail = status === 'PASS'
          ? `${record.checks} checks`
          : record.failures.slice(0, 3).join(' | ')
        console.log(`${status === 'PASS' ? 'PASS' : 'FAIL'}  ${spec.name} — ${status === 'PASS' ? detail : detail}`)
        if (status === 'FAIL' && record.consoleErrors.length > 0) {
          console.log('      console: ' + record.consoleErrors.slice(0, 3).join(' ; '))
        }
        await context.close()
        await harness.close({ keepWorkspace: flag('keep-workspace') })
      }
    } finally {
      await browser.close()
    }
  }
  report.finishedAt = new Date().toISOString()
  console.log(`\nsummary: ${report.summary.pass} pass, ${report.summary.fail} fail, ${report.summary.notRun} not-run`)
  if (jsonPath) {
    await mkdir(path.dirname(path.resolve(jsonPath)), { recursive: true })
    await writeFile(path.resolve(jsonPath), JSON.stringify(report, null, 2) + '\n')
    console.log(`report: ${path.resolve(jsonPath)}`)
  }
  return report.summary.fail === 0 ? 0 : 1
}

/** Dump the rendered UI so specs can be written against the real DOM. */
async function probeDom(page, harness, browserName) {
  await page.waitForTimeout(500)
  const dump = await page.evaluate(() => {
    const describe = (node, depth) => {
      if (depth > 9) return null
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim()
        return text ? { text: text.slice(0, 90) } : null
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return null
      const attributes = {}
      for (const attribute of node.attributes) {
        if (/^(style|class|d)$/.test(attribute.name)) continue
        attributes[attribute.name] = String(attribute.value).slice(0, 90)
      }
      const children = []
      for (const child of node.childNodes) {
        const item = describe(child, depth + 1)
        if (item) children.push(item)
      }
      return { tag: node.tagName.toLowerCase(), attributes,
        text: children.length === 0 ? (node.textContent || '').trim().slice(0, 90) : undefined,
        children }
    }
    return { html: document.getElementById('root')?.outerHTML.slice(0, 4000),
      text: document.body.innerText.slice(0, 2000),
      tree: describe(document.getElementById('root'), 0),
      harness: window.__DSH_HARNESS__ }
  })
  console.log(`[probe ${browserName}] harness ready:`, JSON.stringify(dump.harness.registration))
  console.log('[probe] body text:\n' + dump.text)
  console.log('[probe] tree:\n' + JSON.stringify(dump.tree, null, 1).slice(0, 7000))
}

main().then((code) => { process.exitCode = code }).catch((error) => {
  console.error('browser gate crashed:', error)
  process.exitCode = 2
})

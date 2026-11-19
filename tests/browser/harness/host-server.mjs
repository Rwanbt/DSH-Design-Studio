/**
 * Real-browser harness for the Design Studio client bundle.
 *
 * WHAT IS REAL HERE
 * - the browser (Chromium and Firefox through Playwright): real DOM, real
 *   pointer/keyboard events, real iframes, real CSP enforcement, real sandbox;
 * - the HTTP API: the actual `createRouteHandler(ctx)` from src/plugin-host.mjs
 *   serves /design-studio-native/* and therefore the real patch engine,
 *   revision identity checks, locks and filesystem writes;
 * - the workspace: a real temporary directory on disk.
 *
 * WHAT IS SIMULATED
 * - only the DeepSeek Harness client shell: `window.__ModuleLoader__`,
 *   `require('react')` and `ctx.slots` (see harness/shell.html). The DSH Web
 *   application itself is exercised by tests/e2e/real-dsh.mjs, not here.
 *
 * This separation is deliberate: it keeps an honest, CI-runnable browser gate
 * for pointer/DOM/iframe/CSP/undo/save behaviour without pretending it is a
 * DSH installation test.
 */
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply } from '../../../src/plugin-host.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
export const repoRoot = path.resolve(here, '../../..')

const CONTENT_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

/**
 * Locate the React UMD builds used by the harness shell.
 * The plugin itself never depends on React: this is test scaffolding only.
 * @returns {Promise<{react: string, reactDom: string}>}
 */
export async function findReactUmd() {
  const roots = []
  if (process.env.DSH_E2E_REACT_DIR) roots.push(process.env.DSH_E2E_REACT_DIR)
  for (const extra of String(process.env.DSH_E2E_REACT_FALLBACKS || '').split(path.delimiter)) {
    if (extra) roots.push(path.join(extra, 'react/umd'), path.join(extra, 'react-dom/umd'))
  }
  roots.push(path.join(repoRoot, 'node_modules/react/umd'), path.join(repoRoot, 'node_modules/react-dom/umd'))
  const react = roots.map((dir) => path.join(dir, 'react.production.min.js'))
    .find((file) => file && fileExists(file))
  const reactDom = roots.map((dir) => path.join(dir, 'react-dom.production.min.js'))
    .find((file) => file && fileExists(file))
  if (!react || !reactDom) {
    const error = new Error('React UMD bundles not found (set DSH_E2E_REACT_DIR or run npm install)')
    error.code = 'react-missing'
    throw error
  }
  return { react, reactDom }
}

const fileExists = (file) => {
  try { return statSync(file).isFile() } catch { return false }
}

/**
 * Start the harness server on an ephemeral loopback port.
 * @param {object} [options]
 * @param {string} [options.workspace] existing workspace directory (a temporary one is created otherwise)
 * @param {string} [options.sessionId] session identifier the Host handler will accept
 * @returns {Promise<object>} handle with url, workspace, sessionId, helpers and close()
 */
export async function startHarness({ workspace, sessionId = 'e2e-session', workspaces } = {}) {
  // Resolve test assets before creating the temporary workspace. Missing
  // browser-only dependencies must never leak a workspace on setup failure.
  const umd = await findReactUmd()
  // Read all assets before allocating any disposable directory. A missing
  // shell/client/UMD file must fail without leaving temporary workspace data.
  const shell = await readFile(path.join(here, 'shell.html'), 'utf8')
  const clientSource = await readFile(path.join(repoRoot, 'client.js'), 'utf8')
  const reactSource = await readFile(umd.react)
  const reactDomSource = await readFile(umd.reactDom)
  const root = workspace ? path.resolve(workspace) : await mkdtemp(path.join(os.tmpdir(), 'dsh-design-e2e-'))
  await mkdir(root, { recursive: true })

  // A registry stand-in, so the sidebar panel path (workspace ids, no session)
  // is exercised against the real route handler. `workspaces: []` disables the
  // entries; `workspaces: null` simulates a host without the service at all.
  // A relative `path` is resolved inside the temporary root, so two workspaces
  // can own two real, different directories in one harness.
  const registryEntries = (workspaces === undefined
    ? [{ id: 'ws-e2e', title: 'Espace de test', status: 'ok' }]
    : (workspaces || [])).map((entry) => ({
    id: entry.id,
    title: entry.title,
    path: typeof entry.path === 'string' && entry.path
      ? (path.isAbsolute(entry.path) ? entry.path : path.join(root, entry.path))
      : root,
    status: async () => entry.status || 'ok',
  }))
  const registryById = new Map(registryEntries.map((entry) => [entry.id, entry]))
  const agent = { id: sessionId }
  let proposalTool
  let hostHandler
  const ctx = {
    agents: { get: (id) => (id === sessionId ? agent : undefined) },
    workingDirectory: { ensure: async () => root },
    workspaceRegistry: workspaces === null ? undefined : {
      get: (id) => registryById.get(id),
      list: () => registryEntries.slice(),
    },
    webServer: { register(route) { hostHandler = route.handler } },
    effect(start) { start() },
    inject(_services, register) {
      register({ ...ctx, tools: { register(tool) { proposalTool = tool } } })
    },
  }
  apply(ctx)

  const requests = []
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://harness.local')
    requests.push({ method: req.method, path: url.pathname, search: url.search })
    try {
      if (url.pathname.startsWith('/design-studio-native')) return hostHandler(req, res)
      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'content-type': CONTENT_TYPES['.html'], 'cache-control': 'no-store' })
        return res.end(shell.replace("'__SESSION__'", JSON.stringify(sessionId)))
      }
      if (url.pathname === '/client.js') {
        res.writeHead(200, { 'content-type': CONTENT_TYPES['.js'], 'cache-control': 'no-store' })
        return res.end(clientSource)
      }
      if (url.pathname === '/react.js') {
        res.writeHead(200, { 'content-type': CONTENT_TYPES['.js'], 'cache-control': 'no-store' })
        return res.end(reactSource)
      }
      if (url.pathname === '/react-dom.js') {
        res.writeHead(200, { 'content-type': CONTENT_TYPES['.js'], 'cache-control': 'no-store' })
        return res.end(reactDomSource)
      }
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('harness error: ' + String(error && error.message))
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  const origin = `http://127.0.0.1:${port}`

  return {
    origin,
    url: origin + '/',
    workspace: root,
    sessionId,
    requests,
    async propose(edit) {
      const result = await proposalTool.execute(edit,{ agent, signal: new AbortController().signal, callId: 'browser-fixture' })
      return JSON.parse(result)
    },
    /** Absolute path of a workspace file. */
    file: (relative) => path.join(root, relative),
    /** Write a workspace file (creates parent directories). */
    async write(relative, content) {
      const target = path.join(root, relative)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, content, 'utf8')
      return target
    },
    /** Read a workspace file as UTF-8. */
    read: (relative) => readFile(path.join(root, relative), 'utf8'),
    async close({ keepWorkspace = false } = {}) {
      // The Host may finish short-lived lock/temp-file cleanup just after the
      // last HTTP response. Node's rm retry applies to ENOTEMPTY/EBUSY/EPERM;
      // do not swallow a persistent failure or leave undeclared test artifacts.
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      if (!keepWorkspace && !workspace) {
        await rm(root, { recursive: true, force: true, maxRetries: 12, retryDelay: 100 })
      }
    },
  }
}

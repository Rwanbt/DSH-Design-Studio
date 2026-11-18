/**
 * Unsaved-recovery journal (ADR-035) at level 1.
 *
 * These tests render the REAL client component in a VM with a mocked React
 * renderer, a mocked native API and a `localStorage` stand-in, exactly like the
 * other client-*.test.mjs files. They prove the properties that must hold
 * without a browser:
 *
 *  - editing a document journals its exact source under a key scoped to the
 *    workspace/session, with no request at all;
 *  - a fresh mount (the "reload after a crash" case) offers a banner naming the
 *    file and its age, and NEVER opens or writes anything by itself;
 *  - “Récupérer” loads the journaled source into the editor and sends no
 *    /apply: the file on disk keeps its original bytes;
 *  - “Ignorer” removes the entry, and a new mount no longer offers it;
 *  - a successful save removes the entry for that file;
 *  - an oversized source and a storage that refuses writes are reported once,
 *    without truncation and without breaking the editor;
 *  - two scopes never share an entry.
 *
 * Real Chromium/Firefox and the real Host handler are covered by
 * tests/browser/specs/recovery.mjs (level 2); neither level replaces the other.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const CLIENT = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const RECOVERY_PREFIX = 'dsh-design-studio:recovery:v1:'
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function find(node, match) {
  if (Array.isArray(node)) {
    for (const item of node) { const found = find(item, match); if (found) return found }
    return null
  }
  if (!node || typeof node !== 'object') return null
  if (match(node)) return node
  return find(node.children || [], match)
}

function findAll(node, match, output = []) {
  if (Array.isArray(node)) { for (const item of node) findAll(item, match, output); return output }
  if (node && typeof node === 'object') {
    if (match(node)) output.push(node)
    findAll(node.children || [], match, output)
  }
  return output
}

function textOf(node) {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && node.children) return textOf(node.children)
  return ''
}

/** A `localStorage` stand-in that survives a simulated reload. */
export function memoryStorage({ failSetItem = null } = {}) {
  const map = new Map()
  return {
    _map: map,
    get length() { return map.size },
    key(index) { return [...map.keys()][index] ?? null },
    getItem(key) { return map.has(String(key)) ? map.get(String(key)) : null },
    setItem(key, value) {
      const name = String(key)
      if (failSetItem && failSetItem(name)) {
        const error = new Error('QuotaExceededError: simulated refusal')
        error.name = 'QuotaExceededError'
        throw error
      }
      map.set(name, String(value))
    },
    removeItem(key) { map.delete(String(key)) },
    clear() { map.clear() },
  }
}

export function recoveryKeys(storage) {
  return [...storage._map.keys()].filter((key) => key.startsWith(RECOVERY_PREFIX))
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<rect id="box" x="10" y="10" width="20" height="20" fill="red"/>' +
  '<text id="label" x="10" y="80" font-size="20">Hello</text></svg>'

function sources() {
  return { 'a.svg': { file: 'a.svg', format: 'svg', source: SVG, hash: 'sha-a', identity: 'id-a' } }
}

/**
 * Boot one client instance. Calling it again with the same storage/sources is
 * the test's "page reload": a fresh renderer state over the same local storage.
 */
export function boot({ storage, sources: documents, requests = [], sessionId = 'known' }) {
  let index = 0
  let definition
  let component
  const state = []
  const effects = {}
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
      const i = index++
      if (!(i in state)) state[i] = initial
      return [state[i], (next) => { state[i] = typeof next === 'function' ? next(state[i]) : next }]
    },
    useEffect(effect, deps) {
      const i = index++
      const previous = effects[i]
      const changed = !previous || !deps || deps.length !== previous.length ||
        deps.some((value, position) => value !== previous[position])
      if (!changed) return
      effects[i] = deps
      effect()
    },
    useRef(initial) {
      const i = index++
      if (!(i in state)) state[i] = { current: initial }
      return state[i]
    },
  }
  const fetch = async (url, options = {}) => {
    const target = new URL(String(url))
    const method = options.method || 'GET'
    const body = options.body ? JSON.parse(options.body) : null
    requests.push({ pathname: target.pathname, method, file: target.searchParams.get('file'), body })
    assert.ok(target.pathname.startsWith('/design-studio-native/'),
      'the editor only talks to its native API, got ' + target.pathname)
    if (target.pathname === '/design-studio-native/files') {
      return {
        ok: true,
        json: async () => ({
          ok: true, truncated: false,
          files: Object.keys(documents).map((path) => ({ path, format: 'svg', size: documents[path].source.length })),
        }),
      }
    }
    if (target.pathname === '/design-studio-native/document') {
      const document = documents[target.searchParams.get('file')]
      if (!document) return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not-found', message: 'not found' }) }
      return {
        ok: true,
        json: async () => ({
          ok: true,
          document: { ...document },
          nodes: [{ id: 'box', tag: 'rect', attributes: { x: '10', y: '10', width: '20', height: '20', fill: 'red' } }],
          textNodes: [],
          gradients: [], pathNodes: [],
          geometry: { artboard: { x: 0, y: 0, width: 100, height: 100 }, handles: [] },
          warning: null,
        }),
      }
    }
    if (target.pathname === '/design-studio-native/apply') {
      const document = documents[body?.file]
      if (!document) return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not-found', message: 'not found' }) }
      if (body.kind === 'replace-source') document.source = body.source
      return {
        ok: true,
        json: async () => ({
          ok: true,
          result: { changed: true, inverse: [], patches: [] },
          createdId: null,
        }),
      }
    }
    throw new Error('Unexpected endpoint: ' + target.pathname)
  }
  runInNewContext(CLIENT, {
    window: { __ModuleLoader__: { load: (loaded) => { definition = loaded } }, localStorage: storage },
    URL,
    setTimeout,
    clearTimeout,
    document: { baseURI: 'https://dsh.example/conversation/current/' },
    fetch,
  })
  const plugin = definition.factory((name) => { assert.equal(name, 'react'); return React })
  plugin.apply({
    slots: {
      inject: (_, fn) => fn(),
      register: (meta, view) => { if (meta.name === 'conversation.view') component = view },
    },
  })
  const render = () => { index = 0; return component({ sessionId }) }
  return { render, requests }
}

const sourceArea = (app) => find(app.render(), (node) => node.type === 'textarea' && node.props.spellCheck === false)
const pathField = (app) => find(app.render(), (node) => node.props?.['aria-label'] === 'Workspace file')
const applies = (app) => app.requests.filter((request) => request.pathname === '/design-studio-native/apply')
const banner = (app) => find(app.render(), (node) => node.props?.['data-recovery-banner'] !== undefined)
const warning = (app) => findAll(app.render(), (node) => node.props?.['data-recovery-warning'] !== undefined)
const note = (app) => find(app.render(), (node) => node.props?.['data-recovery-note'] !== undefined)

async function openFile(app, name) {
  pathField(app).props.onChange({ target: { value: name } })
  const open = find(app.render(), (node) => node.type === 'button' && node.children?.includes('Open'))
  await open.props.onClick()
  await settle()
}

/** Type a new source, render (React would rerender), let the debounce fire. */
async function editSource(app, value) {
  sourceArea(app).props.onChange({ target: { value } })
  app.render()
  await sleep(420)
  app.render()
}

function clickButton(app, label) {
  const button = find(app.render(), (node) => node.props?.['aria-label'] === label)
  assert.ok(button, 'expected a button named ' + label)
  return button
}

test('an unsaved edit is journaled, then offered after a reload without any write', async () => {
  const storage = memoryStorage()
  const documents = sources()
  const requests = []
  const first = boot({ storage, sources: documents, requests })
  await openFile(first, 'a.svg')
  const edited = SVG.replace('fill="red"', 'fill="blue"')
  await editSource(first, edited)
  assert.ok(edited !== SVG)
  assert.equal(applies(first).length, 0, 'journaling must never send /apply')
  const keys = recoveryKeys(storage)
  assert.equal(keys.length, 1, 'exactly one entry per modified file: ' + JSON.stringify(keys))
  assert.ok(keys[0].includes(encodeURIComponent('s:known')), 'the key names the scope: ' + keys[0])
  assert.ok(keys[0].includes(encodeURIComponent('a.svg')), 'the key names the file: ' + keys[0])
  const entry = JSON.parse(storage.getItem(keys[0]))
  assert.equal(entry.source, edited, 'the exact source is stored, not a diff or a truncated copy')
  assert.equal(entry.baseHash, 'sha-a', 'the revision the edit was based on is recorded')
  assert.ok(!JSON.stringify(entry).includes('/mnt/'), 'no filesystem path may be stored')

  // "Crash then reopen": a fresh renderer over the same local storage.
  const second = boot({ storage, sources: documents, requests })
  second.render()
  const offered = banner(second)
  assert.ok(offered, 'a journal entry must be offered at mount')
  assert.equal(offered.props['data-recovery-banner'], 'a.svg', 'the banner names the exact file')
  const text = textOf(offered)
  assert.ok(text.includes('a.svg') && text.includes('il y a'), 'file and age are visible: ' + JSON.stringify(text))
  assert.ok(text.includes('rien n’a été écrit'), 'the banner states the disk is untouched')
  assert.equal(applies(second).length, 0, 'mounting must not write anything')
  assert.equal(documents['a.svg'].source, SVG, 'no file may be opened or written by the banner itself')

  // Explicit recovery: the journaled source lands in the editor only.
  await clickButton(second, 'Récupérer les modifications de a.svg').props.onClick()
  await settle(); await settle()
  assert.equal(sourceArea(second).props.value, edited, 'the journaled source is loaded into the editor')
  assert.equal(applies(second).length, 0, 'recovery must never send /apply')
  assert.equal(documents['a.svg'].source, SVG, 'the file on disk keeps its original bytes')
  assert.equal(banner(second), null, 'the banner is dismissed once recovered in this session')
  assert.ok(note(second), 'the recovery outcome is stated in the UI')
})

test('ignoring removes the entry and it never comes back after a reload', async () => {
  const storage = memoryStorage()
  const documents = sources()
  const requests = []
  const first = boot({ storage, sources: documents, requests })
  await openFile(first, 'a.svg')
  await editSource(first, SVG.replace('fill="red"', 'fill="green"'))
  assert.equal(recoveryKeys(storage).length, 1)

  const second = boot({ storage, sources: documents, requests })
  second.render()
  assert.ok(banner(second), 'the entry is offered before it is ignored')
  clickButton(second, 'Ignorer la récupération de a.svg').props.onClick()
  second.render()
  assert.equal(banner(second), null, 'ignoring dismisses the banner')
  assert.deepEqual(recoveryKeys(storage), [], 'ignoring deletes the local copy')

  const third = boot({ storage, sources: documents, requests })
  third.render()
  assert.equal(banner(third), null, 'a new mount must not offer a discarded entry')
  assert.equal(documents['a.svg'].source, SVG, 'ignoring never touches the file')
})

test('a successful save clears the journal entry for that file', async () => {
  const storage = memoryStorage()
  const documents = sources()
  const requests = []
  const first = boot({ storage, sources: documents, requests })
  await openFile(first, 'a.svg')
  const edited = SVG.replace('fill="red"', 'fill="purple"')
  await editSource(first, edited)
  assert.equal(recoveryKeys(storage).length, 1, 'the edit was journaled')

  const save = find(first.render(), (node) => node.type === 'button' && node.children?.includes('Save source'))
  await save.props.onClick()
  await settle()
  assert.equal(applies(first).length, 1, 'saving is exactly one /apply')
  assert.equal(documents['a.svg'].source, edited, 'the save reached the real write path')
  assert.deepEqual(recoveryKeys(storage), [], 'a successful save makes the entry obsolete')

  const second = boot({ storage, sources: documents, requests })
  second.render()
  assert.equal(banner(second), null, 'a reload after a save must not offer the banner')
})

test('an oversized source is refused, never truncated, and editing continues', async () => {
  const storage = memoryStorage()
  const documents = sources()
  const requests = []
  const app = boot({ storage, sources: documents, requests })
  await openFile(app, 'a.svg')
  const oversized = SVG.replace('Hello', 'H'.repeat(300 * 1024))
  assert.ok(oversized.length > 256 * 1024)
  await editSource(app, oversized)
  assert.deepEqual(recoveryKeys(storage), [], 'an entry above 256 Kio must not be stored in any form')
  const warnings = warning(app)
  assert.equal(warnings.length, 1, 'the refusal is reported exactly once')
  const message = textOf(warnings[0])
  assert.ok(message.includes('256 Kio'), 'the message names the size limit: ' + JSON.stringify(message))
  assert.ok(/troncature/.test(message), 'the message states that nothing was truncated: ' + JSON.stringify(message))
  assert.equal(sourceArea(app).props.value, oversized, 'the in-progress edit is still in the editor')
  assert.equal(applies(app).length, 0, 'the refusal writes nothing')
})

test('a storage refusing writes is reported once and the edit continues', async () => {
  const storage = memoryStorage({ failSetItem: (key) => key.startsWith(RECOVERY_PREFIX) })
  const documents = sources()
  const requests = []
  const app = boot({ storage, sources: documents, requests })
  await openFile(app, 'a.svg')
  await editSource(app, SVG.replace('fill="red"', 'fill="orange"'))
  const warnings = warning(app)
  assert.equal(warnings.length, 1, 'a storage refusal is reported exactly once: ' + warnings.length)
  assert.match(textOf(warnings[0]), /refusé l’écriture|quota/, 'the warning names the storage failure')
  assert.deepEqual(recoveryKeys(storage), [], 'nothing was stored')

  await editSource(app, SVG.replace('fill="red"', 'fill="teal"'))
  assert.equal(warning(app).length, 1, 'further edits do not repeat the warning')
  assert.equal(sourceArea(app).props.value, SVG.replace('fill="red"', 'fill="teal"'),
    'editing keeps working after a storage failure')
})

test('two scopes never share a journal entry', async () => {
  const storage = memoryStorage()
  const documents = sources()
  const requests = []
  const owner = boot({ storage, sources: documents, requests, sessionId: 'session-one' })
  await openFile(owner, 'a.svg')
  const edited = SVG.replace('fill="red"', 'fill="black"')
  await editSource(owner, edited)
  assert.equal(recoveryKeys(storage).length, 1)

  const stranger = boot({ storage, sources: documents, requests, sessionId: 'session-two' })
  stranger.render()
  assert.equal(banner(stranger), null, 'another scope must never see the entry')

  const back = boot({ storage, sources: documents, requests, sessionId: 'session-one' })
  back.render()
  assert.ok(banner(back), 'the owning scope still offers its own entry')
  await clickButton(back, 'Récupérer les modifications de a.svg').props.onClick()
  await settle(); await settle()
  assert.equal(sourceArea(back).props.value, edited)
})

test('a full journal refuses a ninth entry instead of replacing one', async () => {
  const storage = memoryStorage()
  const documents = sources()
  const requests = []
  const prefix = RECOVERY_PREFIX + encodeURIComponent('s:known') + ':'
  const seeded = []
  for (let index = 0; index < 8; index += 1) {
    const file = 'ancien-' + index + '.svg'
    const payload = JSON.stringify({ v: 1, file, format: 'svg', source: SVG, baseHash: 'h-' + index,
      baseIdentity: 'i-' + index, savedAt: Date.now() - (8 - index) * 1000 })
    storage.setItem(prefix + encodeURIComponent(file), payload)
    seeded.push(payload)
  }
  const app = boot({ storage, sources: documents, requests })
  await openFile(app, 'a.svg')
  await editSource(app, SVG.replace('fill="red"', 'fill="silver"'))

  assert.equal(recoveryKeys(storage).length, 8, 'the cap is eight entries per scope')
  const seededNow = [...storage._map.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([, value]) => value)
  assert.deepEqual(seededNow, seeded, 'no existing entry may be replaced to make room')
  assert.equal(recoveryKeys(storage).some((key) => key.includes(encodeURIComponent('a.svg'))), false,
    'the ninth document is not journaled')
  const warnings = warning(app)
  assert.equal(warnings.length, 1, 'the refusal is reported')
  const message = textOf(warnings[0])
  assert.ok(/plein/.test(message) && /Aucune entrée n’a été remplacée/.test(message),
    'the message states the full journal and the absence of replacement: ' + JSON.stringify(message))
  assert.equal(sourceArea(app).props.value, SVG.replace('fill="red"', 'fill="silver"'),
    'the edit stays in the editor')
})

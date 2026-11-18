/**
 * Document tabs (ADR-034) at level 1.
 *
 * These tests render the REAL client component in a VM with a mocked React
 * renderer and a mocked native API, exactly like the other client-*.test.mjs
 * files. They prove the properties that must hold without a browser:
 *
 *  - opening a second document gives it its own tab instead of discarding the
 *    first one, and never calls /apply;
 *  - switching tabs restores that tab's source, its selection state and its
 *    Undo history without a single read or write;
 *  - an explicit save always targets the ACTIVE tab's file, and the other open
 *    document's bytes are untouched;
 *  - a ninth tab is refused with an explicit message and no request at all;
 *  - closing a dirty tab only asks first; cancelling keeps it, confirming
 *    discards it without writing and activates its neighbour.
 *
 * Real bytes on real disk, real Chromium/Firefox and the real Host handler are
 * covered by tests/browser/specs/tabs.mjs (level 2); neither level replaces the
 * other.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const settle = () => new Promise((resolve) => setTimeout(resolve, 15))

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

function sourcesFor(names) {
  const sources = {}
  names.forEach((name, index) => {
    sources[name] = {
      file: name,
      format: name.endsWith('.html') ? 'html' : 'svg',
      source: '<svg id="doc-' + index + '" viewBox="0 0 100 100"><rect id="box" x="10" y="10" width="20" height="20" fill="red"/><text id="label" x="10" y="80" font-size="20">Hello</text></svg>',
      hash: 'sha-' + index,
      identity: 'identity-' + index,
    }
  })
  return sources
}

async function harness(names = ['a.svg', 'b.svg'], { deferApply = false } = {}) {
  let index = 0
  let definition
  let component
  const state = []
  const effects = {}
  const requests = []
  const sources = sourcesFor(names)
  let releaseApply = null
  const applyGate = deferApply ? new Promise((resolve) => { releaseApply = resolve }) : null
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
      const i = index++
      if (!(i in state)) state[i] = initial
      return [state[i], (next) => { state[i] = typeof next === 'function' ? next(state[i]) : next }]
    },
    // The client half receives DSH's full React 18, so effects are part of the
    // contract; this mock keeps hook order stable and runs an effect only when
    // its dependencies change. Behaviour is proven by the browser gate.
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
      return { ok: true, json: async () => ({ ok: true, truncated: false,
        files: Object.keys(sources).map((path) => ({ path, format: sources[path].format,
          size: sources[path].source.length })) }) }
    }
    if (target.pathname === '/design-studio-native/document') {
      const document = sources[target.searchParams.get('file')]
      if (!document) return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not-found', message: 'not found' }) }
      return { ok: true, json: async () => ({ ok: true,
        document: { ...document },
        nodes: [
          { id: 'box', tag: 'rect', attributes: { x: '10', y: '10', width: '20', height: '20', fill: 'red' } },
          { id: 'label', tag: 'text', attributes: { 'font-size': '20' } },
        ],
        textNodes: [{ id: 'label', text: 'Hello', editable: true, attributes: { 'font-size': '20' } }],
        gradients: [], pathNodes: [],
        geometry: { artboard: { x: 0, y: 0, width: 100, height: 100 }, handles: [] },
        warning: null }) }
    }
    if (target.pathname === '/design-studio-native/rename') {
      if (sources[body.next]) {
        return { ok: false, status: 409, json: async () => ({ ok: false, error: 'already-exists', message: 'occupied' }) }
      }
      sources[body.next] = { ...sources[body.file], file: body.next, identity: 'identity-' + body.next }
      delete sources[body.file]
      return { ok: true, json: async () => ({ ok: true, document: { ...sources[body.next] } }) }
    }
    if (target.pathname === '/design-studio-native/delete') {
      delete sources[body.file]
      return { ok: true, json: async () => ({ ok: true, document: { file: body.file } }) }
    }
    if (target.pathname === '/design-studio-native/apply') {
      // An optional gate holds the response so a test can observe (and act
      // during) the real in-flight window of a save.
      if (applyGate) await applyGate
      const document = sources[body?.file]
      if (!document) return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not-found', message: 'not found' }) }
      if (body.kind === 'replace-source') document.source = body.source
      return { ok: true, json: async () => ({ ok: true,
        result: { changed: true, inverse: [{ start: 0, end: 1, before: 'a', after: 'b' }],
          patches: [{ start: 0, end: 1, before: 'b', after: 'a' }] },
        createdId: null }) }
    }
    throw new Error('Unexpected endpoint: ' + target.pathname)
  }
  runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: (loaded) => { definition = loaded } } },
    URL,
    document: { baseURI: 'https://dsh.example/conversation/current/' },
    fetch,
  })
  const plugin = definition.factory((name) => { assert.equal(name, 'react'); return React })
  plugin.apply({ slots: { inject: (_, fn) => fn(), register: (meta, view) => {
    if (meta.name === 'conversation.view') component = view
  } } })
  const render = () => { index = 0; return component({ sessionId: 'known' }) }
  return { render, requests, sources, releaseApply: () => releaseApply?.() }
}

const sourceArea = (app) => find(app.render(), (node) => node.type === 'textarea' && node.props.spellCheck === false)
const pathField = (app) => find(app.render(), (node) => node.props?.['aria-label'] === 'Workspace file')
const documentReads = (app) => app.requests.filter((request) => request.pathname === '/design-studio-native/document')
const applies = (app) => app.requests.filter((request) => request.pathname === '/design-studio-native/apply')
const docTabs = (app) => findAll(app.render(),
  (node) => node.props?.role === 'tab' && String(node.props?.id || '').startsWith('doc-tab-'))
const tabFor = (app, file) => docTabs(app).find((tab) => {
  const label = String(tab.props['aria-label'])
  return label === file || label.startsWith(file + ' ·')
})

async function openFile(app, name) {
  pathField(app).props.onChange({ target: { value: name } })
  const open = find(app.render(), (node) => node.type === 'button' && node.children?.includes('Open'))
  await open.props.onClick()
  await settle()
}

test('opening two documents gives each its own tab and switching writes nothing', async () => {
  const app = await harness(['a.svg', 'b.svg'])
  await openFile(app, 'a.svg')
  const source = sourceArea(app)
  source.props.onChange({ target: { value: 'A-UNSAVED' } })
  await openFile(app, 'b.svg')

  assert.equal(documentReads(app).length, 2, 'each document is read exactly once when opened')
  assert.equal(applies(app).length, 0, 'opening another document must never write')
  assert.equal(pathField(app).props.value, 'b.svg', 'the open path follows the active tab')
  const tabs = docTabs(app)
  assert.equal(tabs.length, 2, 'both documents stay open')
  assert.equal(tabFor(app, 'a.svg').props['aria-selected'], false)
  assert.equal(tabFor(app, 'b.svg').props['aria-selected'], true)
  assert.equal(tabFor(app, 'a.svg').props['aria-label'], 'a.svg · modifications non enregistrées',
    'the tab with pending work is marked, by name')

  // Returning to the first tab restores its unsaved source without any I/O.
  await tabFor(app, 'a.svg').props.onClick()
  await settle()
  assert.equal(documentReads(app).length, 2, 'switching tabs is a renderer operation, not a reread')
  assert.equal(sourceArea(app).props.value, 'A-UNSAVED', 'the unsaved edit survives the switch')
  assert.equal(tabFor(app, 'a.svg').props['aria-selected'], true)
  assert.equal(applies(app).length, 0, 'switching tabs must never write')
})

test('saving always writes the active tab and leaves the other document intact', async () => {
  const app = await harness(['a.svg', 'b.svg'])
  await openFile(app, 'a.svg')
  await openFile(app, 'b.svg')
  sourceArea(app).props.onChange({ target: { value: 'B-EDITED' } })

  const save = find(app.render(), (node) => node.type === 'button' && node.children?.includes('Save source'))
  await save.props.onClick()
  await settle()

  const writes = applies(app)
  assert.equal(writes.length, 1, 'an explicit save is exactly one /apply')
  assert.equal(writes[0].body.file, 'b.svg', 'the write targets the ACTIVE tab, never another one')
  assert.equal(writes[0].body.source, 'B-EDITED')
  assert.ok(app.sources['a.svg'].source.includes('id="doc-0"'),
    'the other open document must be byte-identical to its own content')
  assert.equal(tabFor(app, 'b.svg').props['aria-label'], 'b.svg',
    'a saved tab stops advertising unsaved changes')

  // The other tab still holds its own, unmodified source.
  await tabFor(app, 'a.svg').props.onClick()
  await settle()
  assert.ok(sourceArea(app).props.value.includes('id="doc-0"'))
  assert.equal(applies(app).length, 1, 'switching back must not save anything')
})

test('undo history belongs to its tab, not to the editor', async () => {
  const app = await harness(['a.svg', 'b.svg'])
  await openFile(app, 'a.svg')
  sourceArea(app).props.onChange({ target: { value: 'A-SAVED' } })
  await find(app.render(), (node) => node.type === 'button' && node.children?.includes('Save source')).props.onClick()
  await settle()
  const undo = () => find(app.render(), (node) => node.props?.['aria-label'] === 'Undo saved edit')
  assert.equal(undo().props.disabled, false, 'the saved edit is undoable in its own tab')

  await openFile(app, 'b.svg')
  assert.equal(undo().props.disabled, true, 'a different tab has no history, even after a save elsewhere')

  await tabFor(app, 'a.svg').props.onClick()
  await settle()
  assert.equal(undo().props.disabled, false, 'returning to the tab restores its undo history')
  assert.equal(applies(app).length, 1, 'restoring history is not a write')
})

test('a ninth tab is refused with an explicit message and no request', async () => {
  const names = ['t0.svg', 't1.svg', 't2.svg', 't3.svg', 't4.svg', 't5.svg', 't6.svg', 't7.svg', 't8.svg']
  const app = await harness(names)
  for (const name of names.slice(0, 8)) await openFile(app, name)
  assert.equal(docTabs(app).length, 8, 'the bound is eight open documents')
  const readsBefore = documentReads(app).length

  await openFile(app, 't8.svg')
  assert.equal(docTabs(app).length, 8, 'the ninth document must not open')
  assert.equal(documentReads(app).length, readsBefore, 'a refused tab must not even read the file')
  const alert = find(app.render(), (node) => node.props?.role === 'alert')
  assert.ok(alert, 'the refusal must be visible')
  assert.match(textOf(alert), /Limite de 8 onglets/)
  assert.equal(applies(app).length, 0)
})

test('closing a dirty tab asks first, cancelling keeps it, confirming discards without writing', async () => {
  const app = await harness(['a.svg', 'b.svg'])
  await openFile(app, 'a.svg')
  sourceArea(app).props.onChange({ target: { value: 'A-DRAFT' } })
  await openFile(app, 'b.svg')

  // Closing a background tab with pending work is a question naming the file.
  const closeA = findAll(app.render(), (node) => node.props?.['aria-label'] === 'Fermer a.svg')[0]
  closeA.props.onClick()
  const dialog = find(app.render(), (node) => node.props?.role === 'alertdialog')
  assert.ok(dialog, 'closing a dirty tab must ask for confirmation')
  assert.equal(dialog.props['data-tab-close-confirm'], 'a.svg', 'the question names the exact file')
  assert.equal(docTabs(app).length, 2, 'asking must not close anything')
  assert.equal(applies(app).length, 0)

  // Refusing leaves the tab intact, with its work.
  find(app.render(), (node) => node.type === 'button' && node.children?.includes('Annuler')).props.onClick()
  assert.equal(docTabs(app).length, 2, 'cancelling keeps the tab')
  assert.equal(tabFor(app, 'a.svg').props['aria-label'], 'a.svg · modifications non enregistrées')
  assert.equal(applies(app).length, 0, 'cancelling must not write')

  // Confirming discards the tab without writing, and activates its neighbour.
  findAll(app.render(), (node) => node.props?.['aria-label'] === 'Fermer a.svg')[0].props.onClick()
  find(app.render(), (node) => node.type === 'button' &&
    node.children?.includes('Fermer sans enregistrer')).props.onClick()
  await settle()
  assert.equal(docTabs(app).length, 1, 'only the discarded tab is closed')
  assert.equal(tabFor(app, 'a.svg'), undefined)
  assert.equal(tabFor(app, 'b.svg').props['aria-selected'], true, 'the neighbour becomes active')
  assert.equal(applies(app).length, 0, 'closing a tab never writes')

  // Closing the last clean tab returns to the landing state.
  findAll(app.render(), (node) => node.props?.['aria-label'] === 'Fermer b.svg')[0].props.onClick()
  await settle()
  assert.equal(docTabs(app).length, 0)
  assert.ok(find(app.render(), (node) => node.props?.role === 'region' &&
    node.props?.['aria-label'] === 'Open a design file'), 'the landing state is honest again')
  assert.equal(applies(app).length, 0)
})

test('a file renamed or deleted while its tab is in the background stays coherent', async () => {
  const app = await harness(['a.svg', 'b.svg'])
  await openFile(app, 'a.svg')
  await openFile(app, 'b.svg')
  await find(app.render(), (node) => node.props?.['aria-label'] === 'Browse workspace design files').props.onClick()
  await settle()

  // Rename the file of an INACTIVE tab through the real file panel.
  find(app.render(), (node) => node.props?.['aria-label'] === 'Rename a.svg').props.onClick()
  find(app.render(), (node) => node.props?.['aria-label'] === 'New path for a.svg')
    .props.onChange({ target: { value: 'a2.svg' } })
  await find(app.render(), (node) => node.props?.['aria-label'] === 'Confirm rename of a.svg').props.onClick()
  await settle()
  assert.ok(app.sources['a2.svg'], 'the rename must reach the Host')
  assert.equal(app.sources['a.svg'], undefined)
  assert.equal(tabFor(app, 'a2.svg').props['aria-selected'], false, 'the renamed tab stays in the background')
  assert.equal(tabFor(app, 'b.svg').props['aria-selected'], true, 'the active tab is unchanged')
  assert.equal(applies(app).length, 0, 'renaming never writes document bytes')

  // Activating it reloads the new path/revision before the user can edit.
  await tabFor(app, 'a2.svg').props.onClick()
  await settle()
  assert.deepEqual(documentReads(app).map((request) => request.file).slice(-1), ['a2.svg'],
    'a renamed tab refreshes its revision when activated')
  assert.equal(pathField(app).props.value, 'a2.svg')

  // Deleting a file whose tab is in the background closes that tab only.
  await tabFor(app, 'b.svg').props.onClick()
  await settle()
  find(app.render(), (node) => node.props?.['aria-label'] === 'Delete a2.svg').props.onClick()
  await find(app.render(), (node) => node.props?.['aria-label'] === 'Confirm delete of a2.svg').props.onClick()
  await settle()
  assert.equal(app.sources['a2.svg'], undefined, 'the delete must reach the Host')
  assert.equal(docTabs(app).length, 1, 'only the deleted file loses its tab')
  assert.equal(tabFor(app, 'b.svg').props['aria-selected'], true)
  assert.equal(applies(app).length, 0, 'deleting a tab sends no /apply')
})

test('a pending text draft belongs to its tab and is restored with it', async () => {
  const app = await harness(['a.svg', 'b.svg'])
  await openFile(app, 'a.svg')
  find(app.render(), (node) => node.props?.['aria-label'] === 'Select layer text #label').props.onClick()
  await settle()
  const content = find(app.render(), (node) => node.props?.['aria-label'] === 'Text content')
  assert.ok(content, 'selecting a text layer must expose its content field')
  content.props.onChange({ target: { value: 'Draft in A' } })
  await settle()
  assert.equal(tabFor(app, 'a.svg').props['aria-label'], 'a.svg · modifications non enregistrées',
    'a pending text draft counts as unsaved work for the tab')

  await openFile(app, 'b.svg')
  await tabFor(app, 'a.svg').props.onClick()
  await settle()
  assert.equal(find(app.render(), (node) => node.props?.['aria-label'] === 'Text content').props.value,
    'Draft in A', 'the draft is restored together with its selection')
  assert.equal(applies(app).length, 0, 'switching tabs never writes a draft')
})

test('a save in flight refuses to close its tab and disables the discard button', async () => {
  const app = await harness(['a.svg'], { deferApply: true })
  await openFile(app, 'a.svg')
  const edited = 'A-IN-FLIGHT'
  sourceArea(app).props.onChange({ target: { value: edited } })
  app.render()

  // Ask the discard question BEFORE the save starts.
  findAll(app.render(), (node) => node.props?.['aria-label'] === 'Fermer a.svg')[0].props.onClick()
  app.render()
  assert.ok(find(app.render(), (node) => node.props?.role === 'alertdialog'),
    'closing a modified tab asks first')
  assert.equal(find(app.render(), (node) => node.type === 'button' &&
    node.children?.includes('Fermer sans enregistrer')).props.disabled, false,
    'the discard button is usable when no save is in flight')

  // Start the save and hold its response.
  const pending = find(app.render(), (node) => node.type === 'button' &&
    node.children?.includes('Save source')).props.onClick()
  await settle()
  assert.equal(applies(app).length, 1, 'the save is really in flight')

  const close = findAll(app.render(), (node) => node.props?.['aria-label'] === 'Fermer a.svg')[0]
  assert.equal(close.props.disabled, true, 'the tab close control is disabled during a save')
  const discard = find(app.render(), (node) => node.type === 'button' &&
    node.children?.includes('Fermer sans enregistrer'))
  assert.equal(discard.props.disabled, true, 'the discard button is disabled during a save')

  // The handler itself refuses too: the guard must not depend on the attribute.
  discard.props.onClick()
  await settle()
  assert.equal(docTabs(app).length, 1, 'the tab must stay open while the save is in flight')
  const alert = find(app.render(), (node) => node.props?.role === 'alert')
  assert.ok(alert && /Enregistrement en cours/.test(textOf(alert)), 'a clear refusal is shown')

  // Once the save settles, the same confirmation works again.
  app.releaseApply()
  await pending
  await settle()
  assert.equal(find(app.render(), (node) => node.type === 'button' &&
    node.children?.includes('Fermer sans enregistrer')).props.disabled, false,
    'the discard button is usable again after the save')
  find(app.render(), (node) => node.type === 'button' &&
    node.children?.includes('Fermer sans enregistrer')).props.onClick()
  await settle()
  assert.equal(docTabs(app).length, 0, 'after the save the tab can be closed')
  assert.equal(applies(app).length, 1, 'closing never sends another write')
})

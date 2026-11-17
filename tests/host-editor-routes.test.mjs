/**
 * Host route integration for the structural editor operations.
 *
 * These tests mount the real createRouteHandler(ctx) and drive it through the
 * real HTTP-ish request objects, so the wiring between the route, the patch
 * modules and the revision checks is what is exercised here. Byte-level
 * invariants live in the module tests; this file proves the contract the client
 * depends on.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import os from 'node:os'
import path from 'node:path'
import { createRouteHandler } from '../src/plugin-host.mjs'

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
  <rect id="a" x="10" y="10" width="40" height="30" fill="#bda991"/>
  <rect id="b" x="60" y="10" width="40" height="30" fill="#8a9a7b"/>
  <rect id="c" x="110" y="10" width="40" height="30" fill="#5b6b7b"/>
</svg>
`
const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>t</title></head>
<body><h1 id="title" class="hero">Original</h1><p id="lead">Body</p></body></html>
`

async function mount() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-host-routes-'))
  await mkdir(root, { recursive: true })
  const handler = createRouteHandler({
    agents: { get: (id) => (id === 's1' ? { id } : undefined) },
    workingDirectory: { ensure: async () => root },
    webServer: { register: () => () => {} },
  })
  const call = async (method, target, body) => {
    const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
    request.method = method
    request.url = target
    request.headers = body === undefined ? {} : { 'content-type': 'application/json' }
    let status = 0
    let payload = ''
    await handler(request, {
      writeHead(code) { status = code },
      end(json) { payload = json },
    })
    return { status, body: JSON.parse(payload) }
  }
  const open = async (file) => {
    const response = await call('GET', '/design-studio-native/document?sessionId=s1&file=' + file)
    assert.equal(response.status, 200)
    return response.body
  }
  const apply = (payload) => call('POST', '/design-studio-native/apply', { sessionId: 's1', ...payload })
  const write = (file, content) => writeFile(path.join(root, file), content, 'utf8')
  const read = (file) => readFile(path.join(root, file), 'utf8')
  const revision = (document) => ({ file: document.document.file,
    baseHash: document.document.hash, baseIdentity: document.document.identity })
  return { root, call, open, apply, write, read, revision, close: () => rm(root, { recursive: true, force: true }) }
}

test('the document payload exposes hierarchy, visibility, lock and transform state', async () => {
  const host = await mount()
  try {
    await host.write('scene.svg', SVG.replace('fill="#8a9a7b"', 'display="none" fill="#8a9a7b"')
      .replace('<rect id="c"', '<rect id="c" transform="translate(5 5)"'))
    const document = await host.open('scene.svg')
    const byId = Object.fromEntries(document.nodes.map((node) => [node.id, node]))
    assert.deepEqual(Object.keys(byId).sort(), ['a', 'b', 'c'])
    assert.equal(byId.b.hidden, true, 'display="none" is reported as hidden')
    assert.equal(byId.c.transform, 'translate(5 5)', 'the raw transform value is reported')
    assert.equal(byId.a.hidden, false)
    for (const node of document.nodes) {
      assert.equal(typeof node.depth, 'number', 'every node reports its depth')
      assert.equal(typeof node.isGroup, 'boolean', 'every node reports whether it is a group')
    }
  } finally { await host.close() }
})

test('grouping two sibling layers commits one patch set and is undone exactly', async () => {
  const host = await mount()
  try {
    await host.write('scene.svg', SVG)
    const opened = await host.open('scene.svg')
    const grouped = await host.apply({ ...host.revision(opened), kind: 'svg-grouping',
      operation: 'group', ids: ['a', 'b'], groupId: 'pair' })
    assert.equal(grouped.status, 200, JSON.stringify(grouped.body))
    const after = await host.read('scene.svg')
    assert.match(after, /<g id="pair">/)
    assert.ok(after.indexOf('<g id="pair">') < after.indexOf('id="a"'), 'the wrapper precedes the first child')
    assert.ok(after.indexOf('</g>') > after.indexOf('id="b"'), 'the wrapper closes after the last child')
    const inverse = await host.apply({ file: 'scene.svg', baseHash: grouped.body.result.hash,
      baseIdentity: grouped.body.result.identity, kind: 'patches', patches: grouped.body.result.inverse })
    assert.equal(inverse.status, 200, JSON.stringify(inverse.body))
    assert.equal(await host.read('scene.svg'), SVG, 'undo restores the byte-identical original')
  } finally { await host.close() }
})

test('ungrouping restores the flat document byte for byte', async () => {
  const host = await mount()
  try {
    const grouped = SVG.replace('<rect id="a"', '<g id="pair"><rect id="a"')
      .replace('fill="#8a9a7b"/>', 'fill="#8a9a7b"/></g>')
    await host.write('scene.svg', grouped)
    const opened = await host.open('scene.svg')
    const response = await host.apply({ ...host.revision(opened), kind: 'svg-grouping', operation: 'ungroup', id: 'pair' })
    assert.equal(response.status, 200, JSON.stringify(response.body))
    const after = await host.read('scene.svg')
    assert.ok(!after.includes('<g id="pair">'), 'the wrapper is gone')
    assert.equal(after, grouped.replace('<g id="pair">', '').replace('</g>', ''),
      'only the two wrapper tags were removed')
  } finally { await host.close() }
})

test('visibility and lock toggles target one element and are reversible', async () => {
  const host = await mount()
  try {
    await host.write('scene.svg', SVG)
    let opened = await host.open('scene.svg')
    const hidden = await host.apply({ ...host.revision(opened), kind: 'svg-visibility',
      id: 'a', property: 'display', value: 'none' })
    assert.equal(hidden.status, 200, JSON.stringify(hidden.body))
    let disk = await host.read('scene.svg')
    assert.match(disk, /<rect id="a"[^>]*display="none"/)
    assert.ok(disk.includes('<rect id="b" x="60"'), 'sibling layers keep every byte')
    opened = await host.open('scene.svg')
    const shown = await host.apply({ file: 'scene.svg', baseHash: opened.document.hash,
      baseIdentity: opened.document.identity, kind: 'svg-visibility', id: 'a', property: 'display', value: null })
    assert.equal(shown.status, 200, JSON.stringify(shown.body))
    assert.equal(await host.read('scene.svg'), SVG, 'removing the override restores the original bytes')

    opened = await host.open('scene.svg')
    const locked = await host.apply({ ...host.revision(opened), kind: 'svg-lock', id: 'b', locked: true })
    assert.equal(locked.status, 200, JSON.stringify(locked.body))
    disk = await host.read('scene.svg')
    assert.match(disk, /<rect id="b"[^>]*data-locked="true"/)
    opened = await host.open('scene.svg')
    const refused = await host.apply({ file: 'scene.svg', baseHash: opened.document.hash,
      baseIdentity: opened.document.identity, kind: 'svg-visibility', id: 'b', property: 'display', value: 'none' })
    assert.equal(refused.status, 400, 'a locked layer refuses further edits')
    assert.equal(refused.body.error, 'locked')
  } finally { await host.close() }
})

test('a transform operation writes one matrix and refuses unsupported operations', async () => {
  const host = await mount()
  try {
    await host.write('scene.svg', SVG)
    const opened = await host.open('scene.svg')
    const moved = await host.apply({ ...host.revision(opened), kind: 'svg-transform', id: 'a',
      operation: { type: 'translate', dx: 12, dy: -4 } })
    assert.equal(moved.status, 200, JSON.stringify(moved.body))
    assert.match(await host.read('scene.svg'), /<rect id="a"[^>]*transform="matrix\(1,0,0,1,12,-4\)"/)
    const invalid = await host.apply({ file: 'scene.svg', baseHash: moved.body.result.hash,
      baseIdentity: moved.body.result.identity, kind: 'svg-transform', id: 'a',
      operation: { type: 'shear', dx: 2 } })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.body.error, 'unsupported-transform', 'unknown operations are refused, never guessed')
  } finally { await host.close() }
})

test('HTML text and attribute edits are exact and refused when unsafe', async () => {
  const host = await mount()
  try {
    await host.write('page.html', HTML)
    let opened = await host.open('page.html')
    const element = opened.htmlElements.find((entry) => entry.id === 'title')
    assert.ok(element && element.key, 'HTML elements expose a structural key')
    const text = await host.apply({ ...host.revision(opened), kind: 'html-text', key: element.key, value: 'Renamed' })
    assert.equal(text.status, 200, JSON.stringify(text.body))
    let disk = await host.read('page.html')
    assert.ok(disk.includes('>Renamed</h1>'), 'the text content changed')
    assert.ok(disk.includes('<p id="lead">Body</p>'), 'other elements keep every byte')

    opened = await host.open('page.html')
    const attribute = await host.apply({ ...host.revision(opened), kind: 'html-attribute',
      key: opened.htmlElements.find((entry) => entry.id === 'title').key, attribute: 'class', value: 'hero title' })
    assert.equal(attribute.status, 200, JSON.stringify(attribute.body))
    disk = await host.read('page.html')
    assert.ok(disk.includes('class="hero title"'), 'the allowlisted attribute changed')

    opened = await host.open('page.html')
    const refused = await host.apply({ ...host.revision(opened), kind: 'html-attribute',
      key: opened.htmlElements.find((entry) => entry.id === 'title').key, attribute: 'src', value: 'https://evil.invalid/x' })
    assert.equal(refused.status, 400, 'dangerous attributes are refused by the Host, not only by the UI')
    assert.equal(refused.body.error, 'forbidden-attribute')
    assert.ok(!(await host.read('page.html')).includes('evil.invalid'))
  } finally { await host.close() }
})

test('every new operation still requires a matching revision', async () => {
  const host = await mount()
  try {
    await host.write('scene.svg', SVG)
    const opened = await host.open('scene.svg')
    const stale = { ...host.revision(opened), baseHash: 'a'.repeat(64) }
    for (const payload of [
      { kind: 'svg-grouping', operation: 'group', ids: ['a', 'b'] },
      { kind: 'svg-visibility', id: 'a', property: 'display', value: 'none' },
      { kind: 'svg-lock', id: 'a', locked: true },
      { kind: 'svg-transform', id: 'a', operation: { type: 'translate', dx: 1, dy: 1 } },
    ]) {
      const response = await host.apply({ ...stale, ...payload })
      assert.equal(response.status, 409, `${payload.kind} must refuse a stale base hash`)
    }
    assert.equal(await host.read('scene.svg'), SVG, 'no refused operation may touch the file')
  } finally { await host.close() }
})

test('a locked layer refuses drag-style attribute edits and layer deletion', async () => {
  const host = await mount()
  try {
    const locked = SVG.replace('<rect id="a"', '<rect id="a" data-locked="true"')
    await host.write('locked.svg', locked)
    const opened = await host.open('locked.svg')
    const revision = host.revision(opened)

    // Dragging sends a batch of attribute edits: the lock must stop it server-side.
    const drag = await host.apply({ ...revision, kind: 'svg-attributes',
      edits: [{ id: 'a', attribute: 'x', value: '99' }] })
    assert.equal(drag.status, 400)
    assert.equal(drag.body.error, 'locked')
    assert.equal(await host.read('locked.svg'), locked, 'a locked layer must never move')

    const removal = await host.apply({ ...revision, kind: 'svg-layer', id: 'a', operation: 'delete' })
    assert.equal(removal.status, 400)
    assert.equal(removal.body.error, 'locked')
    assert.equal(await host.read('locked.svg'), locked, 'a locked layer must never be deleted')

    // Unlocking is the only way forward, and it is a normal reversible edit.
    const unlocked = await host.apply({ ...revision, kind: 'svg-lock', id: 'a', locked: false })
    assert.equal(unlocked.status, 200, JSON.stringify(unlocked.body))
    const opened2 = await host.open('locked.svg')
    const moved = await host.apply({ ...host.revision(opened2), kind: 'svg-attributes',
      edits: [{ id: 'a', attribute: 'x', value: '99' }] })
    assert.equal(moved.status, 200, JSON.stringify(moved.body))
    assert.match(await host.read('locked.svg'), /<rect id="a"[^>]*x="99"/)
  } finally { await host.close() }
})

test('grouped layers can be deleted and duplicated through the route with exact inverses', async () => {
  const host = await mount()
  try {
    const grouped = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
  <g id="pair">
    <rect id="a" x="10" y="10" width="40" height="30" fill="#bda991"/>
    <rect id="b" x="60" y="10" width="40" height="30" fill="#8a9a7b"/>
  </g>
</svg>
`
    await host.write('grouped.svg', grouped)
    let opened = await host.open('grouped.svg')

    const removed = await host.apply({ ...host.revision(opened), kind: 'svg-layer', id: 'pair', operation: 'delete' })
    assert.equal(removed.status, 200, JSON.stringify(removed.body))
    const afterDelete = await host.read('grouped.svg')
    assert.ok(!afterDelete.includes('id="pair"'), 'the whole group is gone')
    assert.ok(!afterDelete.includes('id="a"'), 'its children are gone with it')
    const undo = await host.apply({ file: 'grouped.svg', baseHash: removed.body.result.hash,
      baseIdentity: removed.body.result.identity, kind: 'patches', patches: removed.body.result.inverse })
    assert.equal(undo.status, 200, JSON.stringify(undo.body))
    assert.equal(await host.read('grouped.svg'), grouped, 'the inverse restores the group byte for byte')

    opened = await host.open('grouped.svg')
    const copied = await host.apply({ ...host.revision(opened), kind: 'svg-layer', id: 'pair', operation: 'duplicate' })
    assert.equal(copied.status, 200, JSON.stringify(copied.body))
    const afterCopy = await host.read('grouped.svg')
    const ids = [...afterCopy.matchAll(/id="([^"]+)"/g)].map((match) => match[1])
    assert.equal(new Set(ids).size, ids.length, 'a duplicated group never creates duplicate ids')
    assert.ok(ids.length >= 6, 'the clone carries the group and its children')
    assert.ok(afterCopy.includes('id="a-copy"') || afterCopy.includes('id="a-copy-2"'),
      'child ids are rewritten in the clone')
  } finally { await host.close() }
})

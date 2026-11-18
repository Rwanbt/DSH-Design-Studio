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

/** The single differing range between two strings. */
function singleRange(before, after) {
  const limit = Math.min(before.length, after.length)
  let prefix = 0
  while (prefix < limit && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (suffix < limit - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1
  return { prefix, suffix, before: before.slice(prefix, before.length - suffix),
    after: after.slice(prefix, after.length - suffix) }
}

test('renaming a layer id writes one patch over the value and is undone exactly', async () => {
  const host = await mount()
  try {
    await host.write('rename.svg', SVG)
    const opened = await host.open('rename.svg')
    const renamed = await host.apply({ ...host.revision(opened), kind: 'svg-rename', id: 'a', next: 'zulu' })
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body))
    assert.equal(renamed.body.createdId, 'zulu', 'the client must reselect the new id')
    const disk = await host.read('rename.svg')
    const window = singleRange(SVG, disk)
    assert.equal(window.before, 'a')
    assert.equal(window.after, 'zulu')
    assert.ok(disk.includes('<rect id="b" x="60" y="10" width="40" height="30" fill="#8a9a7b"/>'),
      'sibling layers keep every byte')

    const undo = await host.apply({ file: 'rename.svg', baseHash: renamed.body.result.hash,
      baseIdentity: renamed.body.result.identity, kind: 'patches', patches: renamed.body.result.inverse })
    assert.equal(undo.status, 200, JSON.stringify(undo.body))
    assert.equal(await host.read('rename.svg'), SVG, 'the inverse restores the original bytes exactly')
  } finally { await host.close() }
})

test('svg-rename refuses invalid, identical, colliding, referenced, locked and read-only targets', async () => {
  const host = await mount()
  try {
    await host.write('rename.svg', SVG)
    let opened = await host.open('rename.svg')
    const refusal = async (payload, code) => {
      const response = await host.apply({ ...host.revision(opened), kind: 'svg-rename', ...payload })
      assert.equal(response.status, 400, `${payload.id}→${payload.next}: ${JSON.stringify(response.body)}`)
      assert.equal(response.body.error, code)
      assert.equal(await host.read('rename.svg'), SVG, 'a refused rename never touches the file')
    }
    await refusal({ id: 'a', next: '1bad' }, 'invalid-id')
    await refusal({ id: 'a', next: 'bad name' }, 'invalid-id')
    await refusal({ id: 'a', next: 'a' }, 'unchanged')
    await refusal({ id: 'a', next: 'b' }, 'id-collision')
    await refusal({ id: 'ghost', next: 'x' }, 'unknown-node')

    // References are refused rather than rewritten: the old id is still used.
    const url = `<svg xmlns="http://www.w3.org/2000/svg"><rect id="a" x="1" y="1" width="2" height="2"/><rect x="0" y="0" width="9" height="9" fill="url(#a)"/></svg>`
    await host.write('url.svg', url)
    opened = await host.open('url.svg')
    const refusedUrl = await host.apply({ ...host.revision(opened), kind: 'svg-rename', id: 'a', next: 'alpha' })
    assert.equal(refusedUrl.status, 400)
    assert.equal(refusedUrl.body.error, 'id-referenced')
    assert.equal(await host.read('url.svg'), url)

    const locked = SVG.replace('<rect id="a"', '<rect id="a" data-locked="true"')
    await host.write('locked.svg', locked)
    opened = await host.open('locked.svg')
    const refusedLocked = await host.apply({ ...host.revision(opened), kind: 'svg-rename', id: 'a', next: 'alpha' })
    assert.equal(refusedLocked.status, 400)
    assert.equal(refusedLocked.body.error, 'locked')
    assert.equal(await host.read('locked.svg'), locked)

    const readOnly = `<svg xmlns="http://www.w3.org/2000/svg"><defs><rect id="tint" x="1" y="1" width="2" height="2"/></defs></svg>`
    await host.write('defs.svg', readOnly)
    opened = await host.open('defs.svg')
    const refusedDefs = await host.apply({ ...host.revision(opened), kind: 'svg-rename', id: 'tint', next: 'teinte' })
    assert.equal(refusedDefs.status, 400)
    assert.equal(refusedDefs.body.error, 'read-only')
    assert.equal(await host.read('defs.svg'), readOnly)
  } finally { await host.close() }
})

test('svg-rename refuses CSS, entity, ARIA and SMIL references at the real route', async () => {
  const host = await mount()
  try {
    const svg = (extra) => `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="a" x="1" y="1" width="2" height="2"/>${extra}</svg>`
    const cases = [
      ['css-pseudo.svg', svg('<style>#a:hover{opacity:.5}</style>'), 'a', 'id-referenced'],
      ['css-attribute.svg', svg('<style>[id="a"]{opacity:.5}</style>'), 'a', 'id-referenced'],
      ['encoded-href.svg', svg('<use href="&#35;a" x="0" y="0"/>'), 'a', 'id-referenced'],
      ['foreign-href.svg', svg('<use xmlns:x="http://www.w3.org/1999/xlink" x:href="#a" x="0" y="0"/>'), 'a', 'id-referenced'],
      ['aria.svg', svg('<g aria-labelledby="title a footer"/>'), 'a', 'id-referenced'],
      ['smil.svg', svg('<animate begin="a.click" attributeName="opacity" dur="1s"/>'), 'a', 'id-referenced'],
      ['ambiguous.svg', svg('<text data-note="AT&T">x</text>'), 'a', 'ambiguous-entities'],
      ['escaped-id.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="layer.1" x="1" y="1" width="2" height="2"/><style>#layer\\.1{opacity:.5}</style></svg>`, 'layer.1', 'id-not-renamable'],
    ]
    for (const [file, source, id, code] of cases) {
      await host.write(file, source)
      const opened = await host.open(file)
      const response = await host.apply({ ...host.revision(opened), kind: 'svg-rename', id, next: 'panneau' })
      assert.equal(response.status, 400, file + ': ' + JSON.stringify(response.body))
      assert.equal(response.body.error, code, file)
      assert.equal(await host.read(file), source, file + ' is never written')
    }
  } finally { await host.close() }
})

test('svg-rename keeps the revision contract and refuses non-SVG documents', async () => {
  const host = await mount()
  try {
    await host.write('rename.svg', SVG)
    const opened = await host.open('rename.svg')

    const missing = await host.call('POST', '/design-studio-native/apply',
      { sessionId: 's1', file: 'rename.svg', baseHash: opened.document.hash, kind: 'svg-rename', id: 'a', next: 'alpha' })
    assert.equal(missing.status, 428, JSON.stringify(missing.body))
    assert.equal(missing.body.error, 'missing-revision')

    const stale = await host.apply({ ...host.revision(opened), baseHash: 'a'.repeat(64), kind: 'svg-rename', id: 'a', next: 'alpha' })
    assert.equal(stale.status, 409, JSON.stringify(stale.body))
    assert.equal(stale.body.error, 'stale-revision')
    assert.equal(await host.read('rename.svg'), SVG)

    await host.write('styles.css', 'h1 { color: #202124; }\n')
    const css = await host.open('styles.css')
    const refused = await host.apply({ ...host.revision(css), kind: 'svg-rename', id: 'a', next: 'alpha' })
    assert.equal(refused.status, 400, JSON.stringify(refused.body))
    assert.equal(refused.body.error, 'unsupported-format')
  } finally { await host.close() }
})

const GRADIENT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#102030" stop-opacity="1"/>
      <stop offset="1" stop-color="#405060"/>
    </linearGradient>
    <linearGradient id="inherited" href="#sky"/>
  </defs>
  <rect id="panel" x="10" y="10" width="40" height="30" fill="url(#sky)"/>
  <rect id="ghost" x="60" y="10" width="40" height="30" fill="url(#inherited)"/>
</svg>
`

test('the document payload exposes addressable gradients with stops and references', async () => {
  const host = await mount()
  try {
    await host.write('gradients.svg', GRADIENT_SVG)
    const document = await host.open('gradients.svg')
    const byId = Object.fromEntries(document.gradients.map((gradient) => [gradient.id, gradient]))
    assert.deepEqual(Object.keys(byId).sort(), ['inherited', 'sky'])
    assert.equal(byId.sky.usable, true)
    assert.equal(byId.sky.reason, null)
    assert.equal(byId.sky.type, 'linear')
    assert.deepEqual(byId.sky.referencedBy, ['panel'])
    assert.equal(byId.sky.stops.length, 2)
    assert.equal(byId.sky.stops[0].color, '#102030')
    assert.equal(byId.sky.stops[1].opacity, null)
    assert.equal(typeof byId.sky.stops[0].colorSpan.start, 'number')
    assert.equal(byId.inherited.usable, false)
    assert.equal(byId.inherited.reason, 'inherited-gradient')
    assert.equal(document.nodes.find((node) => node.id === 'ghost').attributes.fill, 'url(#inherited)')
  } finally { await host.close() }
})

test('svg-gradient-stop writes one attribute value at the real route and undoes exactly', async () => {
  const host = await mount()
  try {
    await host.write('gradient.svg', GRADIENT_SVG)
    const opened = await host.open('gradient.svg')
    const response = await host.apply({ ...host.revision(opened), kind: 'svg-gradient-stop',
      gradientId: 'sky', index: 1, attribute: 'stop-color', value: '#aabbcc' })
    assert.equal(response.status, 200, JSON.stringify(response.body))
    assert.equal(response.body.patches.length, 1, 'exactly one patch for one attribute value')
    const expected = GRADIENT_SVG.replace('offset="1" stop-color="#405060"', 'offset="1" stop-color="#aabbcc"')
    assert.equal(await host.read('gradient.svg'), expected, 'only the targeted attribute value changed')

    const inverse = await host.apply({ file: 'gradient.svg', baseHash: response.body.result.hash,
      baseIdentity: response.body.result.identity, kind: 'patches', patches: response.body.result.inverse })
    assert.equal(inverse.status, 200, JSON.stringify(inverse.body))
    assert.equal(await host.read('gradient.svg'), GRADIENT_SVG, 'Undo restores the byte-identical original')
  } finally { await host.close() }
})

test('svg-gradient-stop refuses unknown, inherited, absent, invalid and unchanged values without writing', async () => {
  const host = await mount()
  try {
    await host.write('gradient.svg', GRADIENT_SVG)
    const opened = await host.open('gradient.svg')
    const cases = [
      [{ gradientId: 'nope', index: 0, attribute: 'stop-color', value: '#ffffff' }, 'unknown-gradient'],
      [{ gradientId: 'inherited', index: 0, attribute: 'stop-color', value: '#ffffff' }, 'inherited-gradient'],
      [{ gradientId: 'sky', index: 1, attribute: 'stop-opacity', value: '0.4' }, 'missing-attribute'],
      [{ gradientId: 'sky', index: 5, attribute: 'stop-color', value: '#ffffff' }, 'index-out-of-range'],
      [{ gradientId: 'sky', index: 0, attribute: 'stop-color', value: 'red' }, 'invalid-value'],
      [{ gradientId: 'sky', index: 0, attribute: 'stop-color', value: '#102030' }, 'unchanged'],
      [{ gradientId: 'sky', index: 0, attribute: 'fill', value: '#ffffff' }, 'invalid-target'],
    ]
    for (const [request, code] of cases) {
      const response = await host.apply({ ...host.revision(opened), kind: 'svg-gradient-stop', ...request })
      assert.equal(response.status, 400, JSON.stringify(response.body))
      assert.equal(response.body.error, code, JSON.stringify(request))
      assert.equal(await host.read('gradient.svg'), GRADIENT_SVG, JSON.stringify(request) + ' writes nothing')
    }
  } finally { await host.close() }
})

test('svg-gradient-stop-add and svg-gradient-stop-remove write one exact span each and undo exactly', async () => {
  const host = await mount()
  try {
    await host.write('gradient.svg', GRADIENT_SVG)
    const opened = await host.open('gradient.svg')
    const added = await host.apply({ ...host.revision(opened), kind: 'svg-gradient-stop-add',
      gradientId: 'sky' })
    assert.equal(added.status, 200, JSON.stringify(added.body))
    assert.equal(added.body.patches.length, 1, 'one added stop is exactly one patch')
    const withStop = GRADIENT_SVG.replace(
      '      <stop offset="1" stop-color="#405060"/>\n',
      '      <stop offset="1" stop-color="#405060"/>\n      <stop offset="0.5" stop-color="#405060"/>\n')
    assert.equal(await host.read('gradient.svg'), withStop, 'one complete stop line is inserted')
    const reopened = await host.open('gradient.svg')
    const sky = reopened.gradients.find((gradient) => gradient.id === 'sky')
    assert.equal(sky.stops.length, 3, 'the document payload resynchronises the stop count')
    assert.deepEqual(sky.stops.map((stop) => stop.offset), ['0', '1', '0.5'])

    const undoneAdd = await host.apply({ file: 'gradient.svg', baseHash: added.body.result.hash,
      baseIdentity: added.body.result.identity, kind: 'patches', patches: added.body.result.inverse })
    assert.equal(undoneAdd.status, 200, JSON.stringify(undoneAdd.body))
    assert.equal(await host.read('gradient.svg'), GRADIENT_SVG, 'the insertion inverse restores the bytes')

    const openedAgain = await host.open('gradient.svg')
    const removed = await host.apply({ ...host.revision(openedAgain), kind: 'svg-gradient-stop-remove',
      gradientId: 'sky', index: 1 })
    assert.equal(removed.status, 200, JSON.stringify(removed.body))
    assert.equal(removed.body.patches.length, 1, 'one removed stop is exactly one patch')
    assert.equal(await host.read('gradient.svg'),
      GRADIENT_SVG.replace('\n      <stop offset="1" stop-color="#405060"/>', ''),
      'the stop line and its indentation disappear, every other byte stays')
    const afterRemoval = await host.open('gradient.svg')
    const remaining = afterRemoval.gradients.find((gradient) => gradient.id === 'sky')
    assert.deepEqual(remaining.stops.map((stop) => stop.offset), ['0'])
    assert.equal(remaining.usable, true)

    const undoneRemove = await host.apply({ file: 'gradient.svg', baseHash: removed.body.result.hash,
      baseIdentity: removed.body.result.identity, kind: 'patches', patches: removed.body.result.inverse })
    assert.equal(undoneRemove.status, 200, JSON.stringify(undoneRemove.body))
    assert.equal(await host.read('gradient.svg'), GRADIENT_SVG, 'the removal inverse restores the bytes')
  } finally { await host.close() }
})

test('the structural gradient routes refuse typed and never write', async () => {
  const host = await mount()
  try {
    await host.write('gradient.svg', GRADIENT_SVG)
    const opened = await host.open('gradient.svg')
    const cases = [
      [{ kind: 'svg-gradient-stop-add', gradientId: 'sky', index: 9 }, 'index-out-of-range'],
      [{ kind: 'svg-gradient-stop-add', gradientId: 'sky', offset: '1' }, 'offset-collision'],
      [{ kind: 'svg-gradient-stop-add', gradientId: 'sky', offset: '100%' }, 'offset-collision'],
      [{ kind: 'svg-gradient-stop-add', gradientId: 'inherited' }, 'inherited-gradient'],
      [{ kind: 'svg-gradient-stop-add', gradientId: 'nope' }, 'unknown-gradient'],
      [{ kind: 'svg-gradient-stop-remove', gradientId: 'sky', index: 5 }, 'index-out-of-range'],
      [{ kind: 'svg-gradient-stop-remove', gradientId: 'inherited', index: 0 }, 'inherited-gradient'],
    ]
    for (const [request, code] of cases) {
      const response = await host.apply({ ...host.revision(opened), ...request })
      assert.equal(response.status, 400, JSON.stringify(response.body))
      assert.equal(response.body.error, code, JSON.stringify(request))
      assert.equal(await host.read('gradient.svg'), GRADIENT_SVG, JSON.stringify(request) + ' writes nothing')
    }

    // The last remaining stop is refused explicitly, at the real route.
    await host.write('solo.svg', '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
      '<linearGradient id="solo"><stop offset="0" stop-color="#111111"/></linearGradient></defs></svg>\n')
    const solo = await host.open('solo.svg')
    const soloBefore = await host.read('solo.svg')
    const last = await host.apply({ ...host.revision(solo), kind: 'svg-gradient-stop-remove',
      gradientId: 'solo', index: 0 })
    assert.equal(last.status, 400, JSON.stringify(last.body))
    assert.equal(last.body.error, 'last-stop')
    assert.match(last.body.message, /without stops/)
    assert.equal(await host.read('solo.svg'), soloBefore, 'the refused removal writes nothing')

    // Same revision contract as every other write kind.
    const missing = await host.call('POST', '/design-studio-native/apply',
      { sessionId: 's1', file: 'gradient.svg', baseHash: opened.document.hash,
        kind: 'svg-gradient-stop-add', gradientId: 'sky' })
    assert.equal(missing.status, 428, JSON.stringify(missing.body))
    assert.equal(missing.body.error, 'missing-revision')

    // A CSS document is not an SVG gradient target, for both new kinds.
    await host.write('styles.css', 'h1 { color: #202124; }\n')
    const css = await host.open('styles.css')
    for (const kind of ['svg-gradient-stop-add', 'svg-gradient-stop-remove']) {
      const refused = await host.apply({ ...host.revision(css), kind, gradientId: 'sky', index: 0 })
      assert.equal(refused.status, 400, JSON.stringify(refused.body))
      assert.equal(refused.body.error, 'unsupported-format')
      assert.equal(await host.read('styles.css'), 'h1 { color: #202124; }\n')
    }
  } finally { await host.close() }
})

test('svg-gradient-stop keeps the revision contract and refuses non-SVG documents', async () => {
  const host = await mount()
  try {
    await host.write('gradient.svg', GRADIENT_SVG)
    const opened = await host.open('gradient.svg')

    const missing = await host.call('POST', '/design-studio-native/apply',
      { sessionId: 's1', file: 'gradient.svg', baseHash: opened.document.hash,
        kind: 'svg-gradient-stop', gradientId: 'sky', index: 0, attribute: 'stop-color', value: '#ffffff' })
    assert.equal(missing.status, 428, JSON.stringify(missing.body))
    assert.equal(missing.body.error, 'missing-revision')

    const stale = await host.apply({ ...host.revision(opened), baseHash: 'a'.repeat(64),
      kind: 'svg-gradient-stop', gradientId: 'sky', index: 0, attribute: 'stop-color', value: '#ffffff' })
    assert.equal(stale.status, 409, JSON.stringify(stale.body))
    assert.equal(stale.body.error, 'stale-revision')
    assert.equal(await host.read('gradient.svg'), GRADIENT_SVG)

    await host.write('styles.css', 'h1 { color: #202124; }\n')
    const css = await host.open('styles.css')
    const refused = await host.apply({ ...host.revision(css), kind: 'svg-gradient-stop',
      gradientId: 'sky', index: 0, attribute: 'stop-color', value: '#ffffff' })
    assert.equal(refused.status, 400, JSON.stringify(refused.body))
    assert.equal(refused.body.error, 'unsupported-format')
    assert.equal(await host.read('styles.css'), 'h1 { color: #202124; }\n')
  } finally { await host.close() }
})

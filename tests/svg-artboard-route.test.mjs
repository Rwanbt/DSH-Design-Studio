/**
 * Host route contract for artboard resizing.
 *
 * These tests mount the real `createRouteHandler(ctx)` against a real temporary
 * workspace: the XML bytes on disk, the revision checks and the typed refusals
 * are the observable contract the client depends on.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import os from 'node:os'
import path from 'node:path'
import { createRouteHandler } from '../src/plugin-host.mjs'

const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">
  <rect id="one" x="10" y="20" width="30" height="40" fill="#bda991"/>
  <circle id="dot" cx="120" cy="80" r="12"/>
</svg>
`
const SIZED = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">' +
  '<rect id="one" x="1" y="2" width="3" height="4"/></svg>'
const HTML = '<!doctype html><html lang="en"><body><h1 id="title">T</h1></body></html>'

async function mount() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-artboard-routes-'))
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
    assert.equal(response.status, 200, JSON.stringify(response.body))
    return response.body
  }
  const apply = (payload) => call('POST', '/design-studio-native/apply', { sessionId: 's1', ...payload })
  const write = (file, content) => writeFile(path.join(root, file), content, 'utf8')
  const read = (file) => readFile(path.join(root, file), 'utf8')
  const revision = (document) => ({ file: document.document.file,
    baseHash: document.document.hash, baseIdentity: document.document.identity })
  return { root, call, open, apply, write, read, revision,
    close: () => rm(root, { recursive: true, force: true }) }
}

test('the document payload exposes the artboard size actually declared in the file', async () => {
  const host = await mount()
  try {
    await host.write('scene.svg', SVG)
    const document = await host.open('scene.svg')
    assert.equal(document.artboard.ok, true)
    assert.equal(document.artboard.source, 'viewBox')
    assert.equal(document.artboard.width, 240)
    assert.equal(document.artboard.height, 160)
    assert.equal(document.artboard.viewBox, '0 0 240 160')
    assert.equal(document.artboard.displayResize, true)

    await host.write('sized.svg', SIZED)
    const sized = await host.open('sized.svg')
    assert.equal(sized.artboard.ok, true)
    assert.equal(sized.artboard.source, 'size')
    assert.equal(sized.artboard.width, 120)
    assert.equal(sized.artboard.displayResize, false)

    await host.write('page.html', HTML)
    const html = await host.open('page.html')
    assert.equal(html.artboard, null, 'a non-SVG document exposes no artboard')
  } finally { await host.close() }
})

test('a display resize is one write, leaves the viewBox intact and Undo is byte-exact', async () => {
  const host = await mount()
  try {
    await host.write('scene.svg', SVG)
    const opened = await host.open('scene.svg')
    const resized = await host.apply({ ...host.revision(opened), kind: 'svg-artboard',
      width: 300, height: 160, scaleContent: false })
    assert.equal(resized.status, 200, JSON.stringify(resized.body))
    assert.equal(resized.body.patches.length, 1, 'only the differing attribute is patched')
    const disk = await host.read('scene.svg')
    assert.equal(disk, SVG.replace('width="240"', 'width="300"'))
    assert.ok(disk.includes('viewBox="0 0 240 160"'))
    assert.ok(disk.includes('id="one" x="10" y="20" width="30" height="40"'),
      'shapes are not touched')

    const undo = await host.apply({ file: 'scene.svg',
      baseHash: resized.body.result.hash, baseIdentity: resized.body.result.identity,
      kind: 'patches', patches: resized.body.result.inverse })
    assert.equal(undo.status, 200, JSON.stringify(undo.body))
    assert.equal(await host.read('scene.svg'), SVG)
  } finally { await host.close() }
})

test('the content mode sends viewBox, width and height in one patch set', async () => {
  const host = await mount()
  try {
    await host.write('scene.svg', SVG)
    const opened = await host.open('scene.svg')
    const resized = await host.apply({ ...host.revision(opened), kind: 'svg-artboard',
      width: 300, height: 200, scaleContent: true })
    assert.equal(resized.status, 200, JSON.stringify(resized.body))
    assert.equal(resized.body.patches.length, 3, 'one transaction carries all three attributes')
    const disk = await host.read('scene.svg')
    assert.equal(disk, SVG.replace(
      'width="240" height="160" viewBox="0 0 240 160"',
      'width="300" height="200" viewBox="0 0 300 200"'))
    assert.ok(disk.includes('<circle id="dot" cx="120" cy="80" r="12"/>'))

    const undo = await host.apply({ file: 'scene.svg',
      baseHash: resized.body.result.hash, baseIdentity: resized.body.result.identity,
      kind: 'patches', patches: resized.body.result.inverse })
    assert.equal(undo.status, 200, JSON.stringify(undo.body))
    assert.equal(await host.read('scene.svg'), SVG)
  } finally { await host.close() }
})

test('refusals are typed, write nothing and keep the revision usable', async () => {
  const host = await mount()
  try {
    await host.write('scene.svg', SVG)
    let opened = await host.open('scene.svg')
    const outOfRange = await host.apply({ ...host.revision(opened), kind: 'svg-artboard',
      width: 0, height: 160 })
    assert.equal(outOfRange.status, 400)
    assert.equal(outOfRange.body.error, 'out-of-range')
    assert.equal(await host.read('scene.svg'), SVG)

    const invalid = await host.apply({ ...host.revision(opened), kind: 'svg-artboard',
      width: 'wide', height: 160 })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.body.error, 'invalid-dimensions')
    assert.equal(await host.read('scene.svg'), SVG)

    const same = await host.apply({ ...host.revision(opened), kind: 'svg-artboard',
      width: 240, height: 160 })
    assert.equal(same.status, 400)
    assert.equal(same.body.error, 'no-change')
    assert.equal(await host.read('scene.svg'), SVG)

    await host.write('sized.svg', SIZED)
    const sized = await host.open('sized.svg')
    const missing = await host.apply({ ...host.revision(sized), kind: 'svg-artboard',
      width: 200, height: 100 })
    assert.equal(missing.status, 400)
    assert.equal(missing.body.error, 'missing-viewbox')
    assert.equal(await host.read('sized.svg'), SIZED)
    // The explicit mode is the coherent one: it adds the viewBox in the same write.
    const content = await host.apply({ ...host.revision(sized), kind: 'svg-artboard',
      width: 200, height: 100, scaleContent: true })
    assert.equal(content.status, 200, JSON.stringify(content.body))
    assert.equal(await host.read('sized.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">' +
      '<rect id="one" x="1" y="2" width="3" height="4"/></svg>')

    await host.write('ratio.svg', '<svg viewBox="0 0 240 160" preserveAspectRatio="none"></svg>')
    opened = await host.open('ratio.svg')
    const aspect = await host.apply({ ...host.revision(opened), kind: 'svg-artboard',
      width: 300, height: 160 })
    assert.equal(aspect.status, 400)
    assert.equal(aspect.body.error, 'unsupported-aspect-ratio')
    assert.equal(await host.read('ratio.svg'), '<svg viewBox="0 0 240 160" preserveAspectRatio="none"></svg>')

    await host.write('page.html', HTML)
    const html = await host.open('page.html')
    const notSvg = await host.apply({ ...host.revision(html), kind: 'svg-artboard',
      width: 300, height: 160 })
    assert.equal(notSvg.status, 400)
    assert.equal(notSvg.body.error, 'unsupported-format')
  } finally { await host.close() }
})

/**
 * Paint order: in SVG, document order *is* the z-order.
 *
 * The reorder is one contiguous, byte-exact source replacement, so these tests
 * check the three properties that make it safe: the resulting order is the
 * requested one, every element keeps its exact text, and no byte outside the
 * moved region is rewritten.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { svgOrderPatch } from '../src/svg-order.mjs'
import { createRouteHandler } from '../src/plugin-host.mjs'

const DOC = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">\n' +
  '  <rect id="a" x="1"/>\n  <rect id="b" x="2"/>\n  <rect id="c" x="3"/>\n</svg>\n'

function moved(source, id, direction) {
  const result = svgOrderPatch(source, { id, direction })
  return {
    result,
    text: source.slice(0, result.patch.start) + result.patch.after + source.slice(result.patch.end),
  }
}

function order(text) {
  return [...text.matchAll(/id="([abc])"/g)].map((match) => match[1])
}

test('one step forward and backward swap exactly two layers', () => {
  const forward = moved(DOC, 'a', 'forward')
  assert.deepEqual(order(forward.text), ['b', 'a', 'c'])
  assert.equal(forward.text.includes('<rect id="a" x="1"/>'), true, 'the moved element keeps its bytes')
  const backward = moved(DOC, 'c', 'backward')
  assert.deepEqual(order(backward.text), ['a', 'c', 'b'])
  // Everything outside the edited window is byte-identical.
  for (const step of [forward, backward]) {
    const patch = step.result.patch
    assert.equal(DOC.slice(0, patch.start), step.text.slice(0, patch.start),
      'the prefix must be preserved verbatim')
    assert.equal(DOC.slice(patch.end), step.text.slice(patch.start + patch.after.length),
      'the suffix must be preserved verbatim')
    assert.equal(patch.before, DOC.slice(patch.start, patch.end),
      'the recorded `before` is the exact original span')
  }
})

test('front and back move a layer across every sibling', () => {
  assert.deepEqual(order(moved(DOC, 'a', 'front').text), ['b', 'c', 'a'])
  assert.deepEqual(order(moved(DOC, 'c', 'back').text), ['c', 'a', 'b'])
  assert.deepEqual(order(moved(DOC, 'b', 'front').text), ['a', 'c', 'b'])
  assert.deepEqual(order(moved(DOC, 'b', 'back').text), ['b', 'a', 'c'])
})

test('reordering inside a group only touches that group', () => {
  const grouped = '<svg><g id="g"><rect id="a"/><rect id="b"/></g><rect id="z"/></svg>'
  const { text } = moved(grouped, 'a', 'front')
  assert.ok(text.includes('<g id="g"><rect id="b"/><rect id="a"/></g>'))
  assert.ok(text.includes('<rect id="z"/>'), 'the sibling outside the group is untouched')
})

test('an unchanged position is reported instead of writing identical bytes', () => {
  assert.throws(() => svgOrderPatch(DOC, { id: 'a', direction: 'back' }),
    (error) => error.code === 'invalid-target')
  assert.throws(() => svgOrderPatch(DOC, { id: 'c', direction: 'forward' }),
    (error) => error.code === 'invalid-target')
})

test('unsupported targets are refused with a typed code', () => {
  assert.throws(() => svgOrderPatch(DOC, { id: 'nope', direction: 'front' }),
    (error) => error.code === 'unknown-node')
  assert.throws(() => svgOrderPatch(DOC, { id: 'a', direction: 'sideways' }),
    (error) => error.code === 'invalid-target')
  assert.throws(() => svgOrderPatch('<svg><rect id="seul"/></svg>', { id: 'seul', direction: 'front' }),
    (error) => error.code === 'invalid-target', 'a layer without siblings has no order to change')
  const locked = '<svg><g id="g" data-locked="true"><rect id="a"/><rect id="b"/></g></svg>'
  assert.throws(() => svgOrderPatch(locked, { id: 'a', direction: 'front' }),
    (error) => error.code === 'locked')
  const readOnly = '<svg><defs><rect id="a"/><rect id="b"/></defs></svg>'
  assert.throws(() => svgOrderPatch(readOnly, { id: 'a', direction: 'front' }),
    (error) => error.code === 'read-only')
})

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-order-'))
  try {
    await writeFile(path.join(root, 'ordre.svg'), DOC)
    const ctx = { agents: { get: (id) => id === 'known' ? { id } : undefined },
      workingDirectory: { ensure: async () => root } }
    const route = createRouteHandler(ctx)
    const invoke = async (method, url, body) => {
      const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
      request.method = method; request.url = url
      request.headers = body === undefined ? {} : { 'content-type': 'application/json' }
      let status, json
      const response = { writeHead(code) { status = code }, end(data) { json = JSON.parse(data) } }
      await route(request, response)
      return { status, json }
    }
    await run({ invoke, root })
  } finally { await rm(root, { recursive: true, force: true }) }
}

const DOCUMENT_URL = '/design-studio-native/document?sessionId=known&file=ordre.svg'

test('the Host applies a reorder through the real route and Undo restores the exact order', () => fixture(async ({ invoke, root }) => {
  const opened = (await invoke('GET', DOCUMENT_URL)).json.document
  const response = await invoke('POST', '/design-studio-native/apply', {
    sessionId: 'known', file: 'ordre.svg', baseHash: opened.hash, baseIdentity: opened.identity,
    kind: 'svg-order', id: 'a', direction: 'front',
  })
  assert.equal(response.status, 200)
  const text = await readFile(path.join(root, 'ordre.svg'), 'utf8')
  assert.deepEqual(order(text), ['b', 'c', 'a'])
  // The inverse patch recorded by the store restores the original bytes.
  const inverse = response.json.result.inverse
  const restored = (await invoke('GET', DOCUMENT_URL)).json.document
  const undone = await invoke('POST', '/design-studio-native/apply', {
    sessionId: 'known', file: 'ordre.svg', baseHash: restored.hash, baseIdentity: restored.identity,
    kind: 'patches', patches: inverse,
  })
  assert.equal(undone.status, 200)
  assert.equal(await readFile(path.join(root, 'ordre.svg'), 'utf8'), DOC)
}))

test('a refused reorder over the real route changes no byte', () => fixture(async ({ invoke, root }) => {
  const opened = (await invoke('GET', DOCUMENT_URL)).json.document
  const response = await invoke('POST', '/design-studio-native/apply', {
    sessionId: 'known', file: 'ordre.svg', baseHash: opened.hash, baseIdentity: opened.identity,
    kind: 'svg-order', id: 'a', direction: 'back',
  })
  assert.equal(response.status, 400)
  assert.equal(response.json.error, 'invalid-target')
  assert.equal(await readFile(path.join(root, 'ordre.svg'), 'utf8'), DOC)
}))

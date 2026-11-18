/**
 * Pasting a copied element: the clipboard is untrusted input.
 *
 * Pure module first, then the real Host route. The properties that matter are
 * that the inserted bytes are exactly one well-formed element, that every id is
 * fresh, that nothing can be smuggled around the element, and that a refused
 * paste leaves the document untouched.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { svgFragmentInsertPatch } from '../src/svg-fragment.mjs'
import { createRouteHandler } from '../src/plugin-host.mjs'

const DOC = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">\n  <rect id="card" x="1" y="2" width="3" height="4"/>\n  <circle id="card-copy" cx="5" cy="5" r="2"/>\n</svg>\n'

/** Apply one patch the way the store does, to assert the resulting bytes. */
function applied(source, fragment) {
  const result = svgFragmentInsertPatch(source, { fragment })
  return {
    result,
    text: source.slice(0, result.patch.start) + result.patch.after + source.slice(result.patch.end),
  }
}

test('a pasted leaf keeps its attributes and receives a fresh unique id', () => {
  const { result, text } = applied(DOC, '<rect id="card" x="9" y="9" width="4" height="4" fill="#abc"/>')
  assert.equal(result.id, 'card-copy-2', 'the id must not collide with the existing card-copy')
  assert.ok(text.includes('<rect id="card-copy-2" x="9" y="9" width="4" height="4" fill="#abc"/>'))
  assert.ok(text.includes('id="card"'), 'the original layer is untouched')
  assert.ok(text.endsWith('</svg>\n'), 'the paste stays inside the SVG root')
  // The insertion is one pure insertion: nothing before it moves.
  assert.equal(result.patch.start, result.patch.end)
  assert.equal(result.patch.before, '')
})

test('a pasted group rewrites every id it contains', () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg"><g id="scene"><rect id="a" width="2" height="2"/><circle id="b" r="1"/></g></svg>'
  const { result, text } = applied(source, '<g id="scene"><rect id="a" width="2" height="2"/><circle id="b" r="1"/></g>')
  assert.equal(result.id, 'scene-copy')
  assert.ok(text.includes('<g id="scene-copy">'))
  assert.ok(text.includes('<rect id="a-copy" width="2" height="2"/>'))
  assert.ok(text.includes('<circle id="b-copy" r="1"/>'))
  assert.ok(text.includes('id="scene"'), 'the original group is untouched')
})

test('an element without an id is pasted without inventing one', () => {
  const { result, text } = applied(DOC, '<rect x="1" y="1" width="1" height="1"/>')
  assert.equal(result.id, null)
  assert.ok(text.includes('<rect x="1" y="1" width="1" height="1"/>'))
})

test('markup smuggled around the element can never reach the document', () => {
  const attacks = [
    '<rect id="x" width="1" height="1"/></svg><script>alert(1)</script><svg>',
    '<rect id="x" width="1" height="1"/><rect id="y" width="1" height="1"/>',
    '<script>alert(1)</script>',
    '<foreignObject><div>html</div></foreignObject>',
    '<rect id="x" width="1" height="1" onclick="alert(1)"/>',
  ]
  for (const fragment of attacks) {
    assert.throws(() => svgFragmentInsertPatch(DOC, { fragment }),
      (error) => ['invalid-fragment', 'unsupported-svg', 'ambiguous-svg'].includes(error.code),
      'fragment must be refused: ' + fragment)
  }
})

test('an element that carries an unfollowed reference is refused, not duplicated', () => {
  for (const fragment of [
    '<use id="u" href="#card"/>',
    '<text id="t" href="#card">x</text>',
    '<g id="grp" xlink:href="#card"><rect id="r" width="1" height="1"/></g>',
  ]) {
    assert.throws(() => svgFragmentInsertPatch(DOC, { fragment }),
      (error) => ['invalid-fragment', 'unsupported-svg'].includes(error.code),
      'reference-bearing fragment must be refused: ' + fragment)
  }
})

test('trailing trivia is dropped because only the parsed element span is copied', () => {
  const { text } = applied(DOC, '<rect id="x" width="1" height="1"/><!-- comment -->')
  assert.ok(text.includes('<rect id="x" width="1" height="1"/>'), 'the element is pasted')
  assert.equal(text.includes('<!-- comment -->'), false, 'trivia outside the element is never copied')
})

test('empty, non-string and oversized payloads are refused with a typed code', () => {
  assert.throws(() => svgFragmentInsertPatch(DOC, { fragment: '' }), (error) => error.code === 'invalid-source')
  assert.throws(() => svgFragmentInsertPatch(DOC, { fragment: '   ' }), (error) => error.code === 'invalid-source')
  assert.throws(() => svgFragmentInsertPatch(DOC, { fragment: 42 }), (error) => error.code === 'invalid-source')
  assert.throws(() => svgFragmentInsertPatch(DOC, { fragment: '<rect/>' + 'x'.repeat(1024 * 1024) }),
    (error) => error.code === 'too-large')
})

test('a target document without any child gets the paste right after the open tag', () => {
  const empty = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
  const { text } = applied(empty, '<rect id="a" width="1" height="1"/>')
  assert.equal(text, '<svg xmlns="http://www.w3.org/2000/svg"><rect id="a" width="1" height="1"/></svg>')
})

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-paste-'))
  try {
    await writeFile(path.join(root, 'cible.svg'), DOC)
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

const DOCUMENT_URL = '/design-studio-native/document?sessionId=known&file=cible.svg'

test('the Host applies a paste through the real route and reports the created id', () => fixture(async ({ invoke, root }) => {
  const document = (await invoke('GET', DOCUMENT_URL)).json.document
  const response = await invoke('POST', '/design-studio-native/apply', {
    sessionId: 'known', file: 'cible.svg',
    baseHash: document.hash, baseIdentity: document.identity,
    kind: 'svg-paste', fragment: '<rect id="card" width="7" height="7"/>',
  })
  assert.equal(response.status, 200)
  assert.equal(response.json.createdId, 'card-copy-2')
  const text = await readFile(path.join(root, 'cible.svg'), 'utf8')
  assert.ok(text.includes('<rect id="card-copy-2" width="7" height="7"/>'))
  assert.ok(text.includes('id="card-copy"'), 'existing ids are untouched')
}))

test('a refused paste over the real route leaves the file byte-identical', () => fixture(async ({ invoke, root }) => {
  const before = await readFile(path.join(root, 'cible.svg'), 'utf8')
  const document = (await invoke('GET', DOCUMENT_URL)).json.document
  const response = await invoke('POST', '/design-studio-native/apply', {
    sessionId: 'known', file: 'cible.svg',
    baseHash: document.hash, baseIdentity: document.identity,
    kind: 'svg-paste', fragment: '<rect id="x"/><script>alert(1)</script>',
  })
  assert.equal(response.status, 400)
  assert.ok(['invalid-fragment', 'unsupported-svg'].includes(response.json.error), response.json.error)
  assert.equal(await readFile(path.join(root, 'cible.svg'), 'utf8'), before,
    'a refused paste must not alter one byte')
}))

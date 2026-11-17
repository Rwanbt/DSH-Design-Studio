import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createNativeFileStore } from '../src/native-file-store.mjs'
import { listEditableSvgNodes } from '../src/svg-attributes.mjs'
import { svgGeometry } from '../src/svg-geometry.mjs'

const mockup = await readFile(new URL('../docs/design/DSH-Design-Studio-V3-Graphite-interactive.html', import.meta.url), 'utf8')
const example = await readFile(new URL('../examples/graphite-v3.svg', import.meta.url), 'utf8')

test('Graphite native example retains the exact authored artwork from the supplied HTML', () => {
  const artboard = mockup.match(/<svg\s+xmlns="http:\/\/www\.w3\.org\/2000\/svg"\s+id="artboard"[\s\S]*?<\/svg>/)?.[0]
  assert.ok(artboard)
  const expected = artboard.replace('id="artboard"', 'id="graphite-board" width="680" height="440"')
    .replace(/data-id="([^"]+)"/g, 'id="$1"')
    .replace(/ class="(?:document-svg|selectable)"/g, '')
    .replace(/></g, '>\n<')
  assert.equal(example, '<?xml version="1.0" encoding="UTF-8"?>\n' + expected + '\n')
  assert.ok(example.includes('fill="url(#orbGrad)"'), 'gradients are preserved, not replaced by a fake colour')
  assert.ok(example.includes('filter="url(#blur)"'), 'authored effects stay native even if their inspector is read-only')
})

test('Graphite reference artboard and ids are addressable by the real native editor', () => {
  const geometry = svgGeometry(example, { transforms: true })
  assert.deepEqual(geometry.artboard, { x: 0, y: 0, width: 680, height: 440 })
  const ids = listEditableSvgNodes(example).map(node => node.id)
  for (const id of ['bg-panel', 'orb', 'accent', 'chip', 'hero-title', 'hero-subtitle']) {
    assert.ok(ids.includes(id), `reference object ${id} must be editable by its own native id`)
  }
})

test('creating the Graphite native example preserves its bytes and refuses a duplicate', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-graphite-reference-'))
  try {
    const store = createNativeFileStore(root)
    const created = await store.create('graphite.svg', { source: example })
    assert.equal(created.source, example)
    assert.equal((await store.read('graphite.svg')).source, example)
    await assert.rejects(store.create('graphite.svg', { source: 'overwritten' }), { code: 'already-exists' })
    assert.equal(await readFile(path.join(root, 'graphite.svg'), 'utf8'), example)
  } finally { await rm(root, { recursive: true, force: true }) }
})

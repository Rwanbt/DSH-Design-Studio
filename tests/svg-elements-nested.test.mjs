import test from 'node:test'
import assert from 'node:assert/strict'
import { svgElementPatch } from '../src/svg-elements.mjs'
import { listEditableSvgNodes } from '../src/svg-attributes.mjs'
import { applyNativePatches, sourceHash } from '../src/native-patch.mjs'

const apply = (source, patches) => applyNativePatches({ source, format: 'svg', baseHash: sourceHash(source), patches })
const once = (source, patch) => apply(source, [patch])

test('the historical leaf-only contract is preserved without the explicit nested opt-in', () => {
  const doc = '<svg viewBox="0 0 10 10"><g id="grp"><rect id="a" x="0" y="0" width="1" height="1"/></g></svg>'
  assert.throws(() => svgElementPatch(doc, { id: 'a', operation: 'delete' }), { code: 'unsupported-svg' })
  assert.throws(() => svgElementPatch(doc, { id: 'grp', operation: 'duplicate' }), { code: 'unknown-node' })
})

test('nested delete removes exactly the element span and inverts byte for byte', () => {
  const doc = '<svg viewBox="0 0 10 10"><g id="grp">' +
    '<rect id="a" x="0" y="0" width="1" height="1"/>' +
    '<circle id="b" cx="1" cy="1" r="1"/></g></svg>'
  const { patch, selectedId, nested } = svgElementPatch(doc, { id: 'a', operation: 'delete', nested: true })
  assert.equal(selectedId, null)
  assert.equal(nested, true)
  assert.equal(patch.before, '<rect id="a" x="0" y="0" width="1" height="1"/>')
  const result = once(doc, patch)
  assert.equal(result.ok, true)
  assert.equal(result.source, '<svg viewBox="0 0 10 10"><g id="grp">' +
    '<circle id="b" cx="1" cy="1" r="1"/></g></svg>')
  assert.equal(apply(result.source, result.inverse).source, doc)
})

test('deleting a group removes its exact span including children', () => {
  const doc = '<svg viewBox="0 0 10 10"><g id="grp" transform="scale(2)">' +
    '<rect id="a" x="0" y="0" width="1" height="1"/></g><rect id="b" x="0" y="0" width="1" height="1"/></svg>'
  const { patch } = svgElementPatch(doc, { id: 'grp', operation: 'delete', nested: true })
  const result = once(doc, patch)
  assert.equal(result.source, '<svg viewBox="0 0 10 10"><rect id="b" x="0" y="0" width="1" height="1"/></svg>')
  assert.equal(apply(result.source, result.inverse).source, doc)
})

test('duplicating a group rewrites every id in the clone uniquely', () => {
  const doc = '<svg viewBox="0 0 10 10"><g id="grp">' +
    '<rect id="a" x="0" y="0" width="1" height="1"/>' +
    '<circle id="b" cx="1" cy="1" r="1"/></g></svg>'
  const { patch, selectedId, idMap } = svgElementPatch(doc, { id: 'grp', operation: 'duplicate', nested: true })
  assert.equal(selectedId, 'grp-copy')
  assert.deepEqual(idMap, { grp: 'grp-copy', a: 'a-copy', b: 'b-copy' })
  const result = once(doc, patch)
  assert.equal(result.ok, true)
  assert.equal(result.source, '<svg viewBox="0 0 10 10"><g id="grp">' +
    '<rect id="a" x="0" y="0" width="1" height="1"/>' +
    '<circle id="b" cx="1" cy="1" r="1"/></g>' +
    '<g id="grp-copy"><rect id="a-copy" x="0" y="0" width="1" height="1"/>' +
    '<circle id="b-copy" cx="1" cy="1" r="1"/></g></svg>')
  assert.deepEqual(listEditableSvgNodes(result.source).map(node => node.id),
    ['grp', 'a', 'b', 'grp-copy', 'a-copy', 'b-copy'])
  // Everything outside the inserted clone is untouched.
  assert.equal(result.source.slice(0, patch.start), doc.slice(0, patch.start))
  assert.equal(result.source.slice(patch.start + patch.after.length), doc.slice(patch.start))
  assert.equal(apply(result.source, result.inverse).source, doc)
})

test('duplicating a nested leaf keeps grouping and parent transforms', () => {
  const doc = '<svg viewBox="0 0 10 10"><g id="grp" transform="matrix(1,0,0,1,5,5)">' +
    '<rect id="a" x="0" y="0" width="1" height="1"/></g></svg>'
  const { patch, selectedId } = svgElementPatch(doc, { id: 'a', operation: 'duplicate', nested: true })
  assert.equal(selectedId, 'a-copy')
  const result = once(doc, patch)
  assert.equal(result.source, '<svg viewBox="0 0 10 10"><g id="grp" transform="matrix(1,0,0,1,5,5)">' +
    '<rect id="a" x="0" y="0" width="1" height="1"/>' +
    '<rect id="a-copy" x="0" y="0" width="1" height="1"/></g></svg>')
  assert.equal(apply(result.source, result.inverse).source, doc)
})

test('cloned ids never collide with existing ones', () => {
  const doc = '<svg viewBox="0 0 10 10"><g id="grp">' +
    '<rect id="a" x="0" y="0" width="1" height="1"/></g>' +
    '<rect id="a-copy" x="0" y="0" width="1" height="1"/>' +
    '<rect id="grp-copy" x="0" y="0" width="1" height="1"/></svg>'
  const { idMap, selectedId } = svgElementPatch(doc, { id: 'grp', operation: 'duplicate', nested: true })
  assert.equal(selectedId, 'grp-copy-2')
  assert.deepEqual(idMap, { grp: 'grp-copy-2', a: 'a-copy-2' })
})

test('nested operations refuse unaddressable, read-only, locked, root and malformed targets', () => {
  const doc = '<svg viewBox="0 0 10 10"><g id="grp"><rect id="a" x="0" y="0" width="1" height="1"/></g></svg>'
  assert.throws(() => svgElementPatch(doc, { id: 'missing', operation: 'delete', nested: true }), { code: 'unknown-node' })
  const rootId = '<svg id="root" viewBox="0 0 10 10"><rect id="a" x="0" y="0" width="1" height="1"/></svg>'
  assert.throws(() => svgElementPatch(rootId, { id: 'root', operation: 'delete', nested: true }), { code: 'unsupported-svg' })
  const defs = '<svg viewBox="0 0 10 10"><defs><rect id="d" x="0" y="0" width="1" height="1"/></defs></svg>'
  assert.throws(() => svgElementPatch(defs, { id: 'd', operation: 'delete', nested: true }), { code: 'read-only' })
  const locked = '<svg viewBox="0 0 10 10"><g id="grp" data-locked="true">' +
    '<rect id="a" x="0" y="0" width="1" height="1"/></g></svg>'
  assert.throws(() => svgElementPatch(locked, { id: 'a', operation: 'delete', nested: true }), { code: 'locked' })
  const malformed = '<svg viewBox="0 0 10 10"><g id="grp"><rect id="a"></g></svg>'
  assert.throws(() => svgElementPatch(malformed, { id: 'a', operation: 'delete', nested: true }), { code: 'invalid-svg' })
  const unsupportedTag = '<svg viewBox="0 0 10 10"><defs id="d"/></svg>'
  assert.throws(() => svgElementPatch(unsupportedTag, { id: 'd', operation: 'delete', nested: true }), { code: 'unsupported-svg' })
})

test('nested delete/duplicate tolerate comments, CDATA and unicode around the target', () => {
  const doc = '<svg viewBox="0 0 10 10"><!-- <rect id="ghost"/> -->' +
    '<g id="grp"><![CDATA[ 🚀 ]]><text id="t" x="1" y="2">héllo 🚀</text></g></svg>'
  const { patch } = svgElementPatch(doc, { id: 't', operation: 'delete', nested: true })
  const result = once(doc, patch)
  assert.equal(result.source, '<svg viewBox="0 0 10 10"><!-- <rect id="ghost"/> -->' +
    '<g id="grp"><![CDATA[ 🚀 ]]></g></svg>')
  assert.equal(apply(result.source, result.inverse).source, doc)
  const copy = svgElementPatch(doc, { id: 't', operation: 'duplicate', nested: true })
  assert.equal(copy.selectedId, 't-copy')
  assert.equal(once(doc, copy.patch).source, doc.replace('héllo 🚀</text></g>',
    'héllo 🚀</text><text id="t-copy" x="1" y="2">héllo 🚀</text></g>'))
})

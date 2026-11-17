import test from 'node:test'
import assert from 'node:assert/strict'
import { svgGroupPatch, svgUngroupPatch, svgGroupingPatch } from '../src/svg-groups.mjs'
import { applyNativePatches, sourceHash } from '../src/native-patch.mjs'

const apply = (source, patches) => applyNativePatches({ source, format: 'svg', baseHash: sourceHash(source), patches })

const base = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n' +
  '  <rect id="a" x="1" y="2" width="3" height="4"/>\n' +
  '  <rect id="b" x="5" y="6" width="7" height="8"/>\n' +
  '  <circle id="c" cx="9" cy="9" r="2"/>\n' +
  '</svg>'

test('grouping wraps a contiguous sibling run and inverts byte for byte', () => {
  const { patches, id } = svgGroupPatch(base, { ids: ['a', 'b'] })
  assert.equal(id, 'group-1')
  const result = apply(base, patches)
  assert.equal(result.ok, true)
  const expected = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n' +
    '  <g id="group-1"><rect id="a" x="1" y="2" width="3" height="4"/>\n' +
    '  <rect id="b" x="5" y="6" width="7" height="8"/></g>\n' +
    '  <circle id="c" cx="9" cy="9" r="2"/>\n' +
    '</svg>'
  assert.equal(result.source, expected)
  assert.equal(apply(result.source, result.inverse).source, base)
})

test('grouping only inserts bytes inside the selected run', () => {
  const { patches } = svgGroupPatch(base, { ids: ['a', 'b'] })
  const ordered = [...patches].sort((left, right) => left.start - right.start)
  assert.equal(ordered.length, 2)
  assert.equal(ordered[0].before, '')
  assert.equal(ordered[1].before, '')
  assert.equal(ordered[0].start, base.indexOf('<rect id="a"'))
  assert.equal(ordered[1].start, base.indexOf('height="8"/>') + 'height="8"/>'.length)
  const rebuilt = base.slice(0, ordered[0].start) + ordered[0].after +
    base.slice(ordered[0].start, ordered[1].start) + ordered[1].after +
    base.slice(ordered[1].start)
  assert.equal(apply(base, patches).source, rebuilt)
  // Proof by difference: removing the two inserted strings restores the source.
  assert.equal(rebuilt.replace(ordered[0].after, '').replace(ordered[1].after, ''), base)
})

test('grouping accepts a comment between adjacent siblings', () => {
  const source = '<svg viewBox="0 0 10 10"><rect id="a" x="0" y="0" width="1" height="1"/>' +
    '<!-- note --><rect id="b" x="1" y="1" width="1" height="1"/></svg>'
  const result = apply(source, svgGroupPatch(source, { ids: ['a', 'b'] }).patches)
  assert.equal(result.source, '<svg viewBox="0 0 10 10"><g id="group-1">' +
    '<rect id="a" x="0" y="0" width="1" height="1"/><!-- note -->' +
    '<rect id="b" x="1" y="1" width="1" height="1"/></g></svg>')
  assert.equal(apply(result.source, result.inverse).source, source)
})

test('grouping allocates a fresh id and honours an explicit one', () => {
  const existing = '<svg viewBox="0 0 10 10"><g id="group-1"/>' +
    '<rect id="a" x="0" y="0" width="1" height="1"/>' +
    '<rect id="b" x="2" y="2" width="1" height="1"/></svg>'
  assert.equal(svgGroupPatch(existing, { ids: ['a', 'b'] }).id, 'group-2')
  assert.equal(svgGroupPatch(base, { ids: ['a'], id: 'mine' }).id, 'mine')
  assert.ok(apply(base, svgGroupPatch(base, { ids: ['a'], id: 'mine' }).patches).source
    .includes('<g id="mine"><rect id="a"'))
  assert.throws(() => svgGroupPatch(base, { ids: ['a'], id: 'a' }), { code: 'ambiguous-svg' })
})

test('grouping refuses non-contiguous and cross-parent selections with typed codes', () => {
  assert.throws(() => svgGroupPatch(base, { ids: ['a', 'c'] }), { code: 'non-contiguous-selection' })
  const twoParents = '<svg viewBox="0 0 10 10">' +
    '<g id="g1"><rect id="a" x="0" y="0" width="1" height="1"/></g>' +
    '<g id="g2"><rect id="b" x="1" y="1" width="1" height="1"/></g></svg>'
  assert.throws(() => svgGroupPatch(twoParents, { ids: ['a', 'b'] }), { code: 'different-parents' })
  // The two parent groups themselves *are* adjacent siblings and can be grouped.
  assert.equal(svgGroupPatch(twoParents, { ids: ['g1', 'g2'] }).id, 'group-1')
})

test('grouping refuses the root, defs content, locked and unknown layers', () => {
  const rootId = '<svg id="root" viewBox="0 0 10 10"><rect id="a" x="0" y="0" width="1" height="1"/></svg>'
  assert.throws(() => svgGroupPatch(rootId, { ids: ['root'] }), { code: 'unsafe-selection' })
  const defs = '<svg viewBox="0 0 10 10"><defs><rect id="d" x="0" y="0" width="1" height="1"/></defs>' +
    '<rect id="a" x="0" y="0" width="1" height="1"/></svg>'
  assert.throws(() => svgGroupPatch(defs, { ids: ['d'] }), { code: 'read-only' })
  const locked = '<svg viewBox="0 0 10 10"><g id="g1" data-locked="true">' +
    '<rect id="a" x="0" y="0" width="1" height="1"/></g></svg>'
  assert.throws(() => svgGroupPatch(locked, { ids: ['a'] }), { code: 'locked' })
  assert.throws(() => svgGroupPatch(base, { ids: ['missing'] }), { code: 'unknown-node' })
  assert.throws(() => svgGroupPatch(base, { ids: [] }), { code: 'invalid-target' })
  assert.throws(() => svgGroupPatch(base, { ids: ['a', 'a'] }), { code: 'invalid-target' })
  assert.throws(() => svgGroupPatch('<svg><g id="g1"><rect id="a"></g></svg>', { ids: ['a'] }), { code: 'invalid-svg' })
})

test('ungrouping removes only the wrapper tags and inverts byte for byte', () => {
  const grouped = '<svg viewBox="0 0 10 10"><g id="g1">' +
    '<rect id="a" x="0" y="0" width="1" height="1"/>' +
    '<rect id="b" x="1" y="1" width="1" height="1"/></g>' +
    '<circle id="c" cx="1" cy="1" r="1"/></svg>'
  const { patches } = svgUngroupPatch(grouped, { id: 'g1' })
  const result = apply(grouped, patches)
  assert.equal(result.ok, true)
  assert.equal(result.source, '<svg viewBox="0 0 10 10">' +
    '<rect id="a" x="0" y="0" width="1" height="1"/>' +
    '<rect id="b" x="1" y="1" width="1" height="1"/>' +
    '<circle id="c" cx="1" cy="1" r="1"/></svg>')
  assert.equal(apply(result.source, result.inverse).source, grouped)
})

test('ungrouping a nested group keeps the parent wrapper intact', () => {
  const source = '<svg viewBox="0 0 10 10"><g id="outer"><g id="inner">' +
    '<rect id="a" x="0" y="0" width="1" height="1"/></g></g></svg>'
  const result = apply(source, svgUngroupPatch(source, { id: 'inner' }).patches)
  assert.equal(result.source, '<svg viewBox="0 0 10 10"><g id="outer">' +
    '<rect id="a" x="0" y="0" width="1" height="1"/></g></svg>')
  assert.equal(apply(result.source, result.inverse).source, source)
})

test('ungrouping an empty self-closing group removes exactly its tag', () => {
  const source = '<svg viewBox="0 0 10 10"><g id="empty"/><rect id="a" x="0" y="0" width="1" height="1"/></svg>'
  const { patches, empty } = svgUngroupPatch(source, { id: 'empty' })
  assert.equal(empty, true)
  assert.deepEqual(patches.map(patch => [patch.before, patch.after]), [['<g id="empty"/>', '']])
  const result = apply(source, patches)
  assert.equal(result.source, '<svg viewBox="0 0 10 10"><rect id="a" x="0" y="0" width="1" height="1"/></svg>')
  assert.equal(apply(result.source, result.inverse).source, source)
})

test('ungrouping refuses non-groups, read-only, locked and unknown layers', () => {
  assert.throws(() => svgUngroupPatch(base, { id: 'a' }), { code: 'unsupported-group' })
  assert.throws(() => svgUngroupPatch(base, { id: 'missing' }), { code: 'unknown-node' })
  const locked = '<svg viewBox="0 0 10 10"><g id="g1" data-locked="true"></g></svg>'
  assert.throws(() => svgUngroupPatch(locked, { id: 'g1' }), { code: 'locked' })
  const defs = '<svg viewBox="0 0 10 10"><defs><g id="g1"><rect id="a" x="0" y="0" width="1" height="1"/></g></defs></svg>'
  assert.throws(() => svgUngroupPatch(defs, { id: 'g1' }), { code: 'read-only' })
})

test('group and ungroup round trip through one dispatcher', () => {
  const grouped = svgGroupingPatch(base, { operation: 'group', ids: ['b', 'c'] })
  const afterGroup = apply(base, grouped.patches)
  assert.ok(afterGroup.source.includes('<g id="group-1"><rect id="b"'))
  const ungrouped = svgGroupingPatch(afterGroup.source, { operation: 'ungroup', id: 'group-1' })
  const afterUngroup = apply(afterGroup.source, ungrouped.patches)
  assert.equal(afterUngroup.source, base)
  assert.throws(() => svgGroupingPatch(base, { operation: 'flatten' }), { code: 'invalid-target' })
})

test('grouping tolerates unicode and comments around the run', () => {
  const source = '<svg viewBox="0 0 10 10"><!-- 🚀 <rect id="ghost"/> -->' +
    '<text id="label" x="1" y="2">héllo 🚀</text>' +
    '<rect id="a" x="0" y="0" width="1" height="1"/></svg>'
  const result = apply(source, svgGroupPatch(source, { ids: ['label', 'a'] }).patches)
  assert.equal(result.source, '<svg viewBox="0 0 10 10"><!-- 🚀 <rect id="ghost"/> -->' +
    '<g id="group-1"><text id="label" x="1" y="2">héllo 🚀</text>' +
    '<rect id="a" x="0" y="0" width="1" height="1"/></g></svg>')
  assert.equal(apply(result.source, result.inverse).source, source)
})

test('selection order does not matter, only sibling order does', () => {
  const forward = apply(base, svgGroupPatch(base, { ids: ['a', 'b'] }).patches).source
  const reverse = svgGroupPatch(base, { ids: ['b', 'a'] })
  assert.deepEqual(reverse.patches, svgGroupPatch(base, { ids: ['a', 'b'] }).patches)
  assert.equal(apply(base, reverse.patches).source, forward)
})

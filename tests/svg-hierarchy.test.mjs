import test from 'node:test'
import assert from 'node:assert/strict'
import { listEditableSvgNodes, svgAttributePatch } from '../src/svg-attributes.mjs'
import { applyNativePatches, sourceHash } from '../src/native-patch.mjs'

const nested = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n' +
  '  <g id="outer">\n' +
  '    <g id="inner">\n' +
  '      <rect id="r1" x="1" y="2" width="3" height="4"/>\n' +
  '      <circle id="c1" cx="5" cy="6" r="7"/>\n' +
  '    </g>\n' +
  '    <rect id="r2" x="8" y="9" width="10" height="11"/>\n' +
  '  </g>\n' +
  '  <path id="p" d="M0 0 L1 1"/>\n' +
  '</svg>'

const byId = (source, id) => listEditableSvgNodes(source).find(node => node.id === id)
const apply = (source, patches) => applyNativePatches({ source, format: 'svg', baseHash: sourceHash(source), patches })

test('nested groups expose depth, parent path and sibling order', () => {
  const nodes = listEditableSvgNodes(nested)
  assert.deepEqual(nodes.map(node => node.id), ['outer', 'inner', 'r1', 'c1', 'r2', 'p'])
  const outer = nodes[0], inner = nodes[1], r1 = nodes[2], c1 = nodes[3], r2 = nodes[4], p = nodes[5]
  assert.equal(outer.depth, 1)
  assert.equal(outer.parentId, null)
  assert.equal(outer.parentTag, 'svg')
  assert.equal(outer.siblingIndex, 0)
  assert.equal(outer.isGroup, true)
  assert.deepEqual(outer.ancestorIds, [])
  assert.equal(inner.depth, 2)
  assert.equal(inner.parentId, 'outer')
  assert.equal(inner.parentTag, 'g')
  assert.equal(inner.siblingIndex, 0)
  assert.deepEqual(inner.ancestorIds, ['outer'])
  assert.equal(r1.depth, 3)
  assert.equal(r1.parentId, 'inner')
  assert.deepEqual(r1.ancestorIds, ['outer', 'inner'])
  assert.equal(r1.siblingIndex, 0)
  assert.equal(r1.isGroup, false)
  assert.equal(c1.siblingIndex, 1)
  assert.equal(r2.depth, 2)
  assert.equal(r2.siblingIndex, 1)
  assert.equal(p.depth, 1)
  assert.equal(p.siblingIndex, 1)
  // `order` is document order across every element, so the SVG root is 0.
  assert.deepEqual(nodes.map(node => node.order), [1, 2, 3, 4, 5, 6])
  for (const node of nodes) assert.equal(node.structure, true)
})

test('each node exposes its exact source span without re-serialising', () => {
  const r1 = byId(nested, 'r1')
  assert.equal(nested.slice(r1.start, r1.end), '<rect id="r1" x="1" y="2" width="3" height="4"/>')
  assert.equal(r1.selfClosing, true)
  assert.equal(r1.openEnd, r1.end)
  const inner = byId(nested, 'inner')
  assert.equal(nested.slice(inner.start, inner.openEnd), '<g id="inner">')
  assert.ok(nested.slice(inner.start, inner.end).endsWith('</g>'))
  assert.equal(inner.end - inner.start, nested.slice(inner.start, inner.end).length)
  const outer = byId(nested, 'outer')
  assert.equal(nested.slice(outer.start, outer.openEnd), '<g id="outer">')
  assert.equal(nested.slice(outer.end - 4, outer.end), '</g>')
})

test('tolerates comments, CDATA and self-closing tags without fake nodes', () => {
  const tricky = '<svg viewBox="0 0 10 10">' +
    '<!-- <g id="fake"><rect id="fake-inner"/></g> -->' +
    '<rect id="self" x="0" y="0" width="1" height="1"/>' +
    '<g id="grp">' +
    '<![CDATA[ <rect id="cdata"/> ]]>' +
    '<rect id="child" x="0" y="0" width="1" height="1"/>' +
    '</g>' +
    '</svg>'
  assert.deepEqual(listEditableSvgNodes(tricky).map(node => node.id), ['self', 'grp', 'child'])
  assert.equal(byId(tricky, 'child').parentId, 'grp')
  assert.equal(byId(tricky, 'child').depth, 2)
  assert.throws(() => svgAttributePatch(tricky, { id: 'fake', attribute: 'fill', value: 'red' }), { code: 'unknown-node' })
})

test('quoted attribute values containing markup never become nodes', () => {
  const disguised = '<svg viewBox="0 0 10 10"><rect id="real" data-note="<g id=\'fake\'/> 2 &gt; 1" ' +
    'x="1" y="1" width="2" height="2"/></svg>'
  const nodes = listEditableSvgNodes(disguised)
  assert.deepEqual(nodes.map(node => node.id), ['real'])
  assert.equal(nodes[0].start, disguised.indexOf('<rect'))
  assert.equal(nodes[0].attributes.x, '1')
  assert.throws(() => svgAttributePatch(disguised, { id: 'fake', attribute: 'fill', value: 'red' }), { code: 'unknown-node' })
})

test('defs, symbol and gradient content is listed as read-only', () => {
  const withDefs = '<svg viewBox="0 0 10 10">' +
    '<defs><rect id="src" x="0" y="0" width="1" height="1"/></defs>' +
    '<rect id="top" x="2" y="2" width="1" height="1"/>' +
    '<symbol id="icon"><path id="ip" d="M0 0 L1 1"/></symbol>' +
    '</svg>'
  const nodes = listEditableSvgNodes(withDefs)
  assert.deepEqual(nodes.map(node => node.id), ['src', 'top', 'ip'])
  const src = nodes.find(node => node.id === 'src')
  const top = nodes.find(node => node.id === 'top')
  const ip = nodes.find(node => node.id === 'ip')
  assert.equal(src.readOnly, true)
  assert.equal(top.readOnly, false)
  assert.equal(ip.readOnly, true)
  assert.equal(ip.parentId, 'icon')
  assert.equal(top.parentTag, 'svg')
})

test('unicode and astral characters keep UTF-16 spans exact', () => {
  const source = '<svg viewBox="0 0 10 10"><text id="t" x="1" y="2">🚀 héllo ✓</text>' +
    '<rect id="r" x="1" y="2" width="3" height="4"/></svg>'
  const nodes = listEditableSvgNodes(source)
  assert.deepEqual(nodes.map(node => node.id), ['t', 'r'])
  const rect = nodes.find(node => node.id === 'r')
  assert.equal(source.slice(rect.start, rect.end), '<rect id="r" x="1" y="2" width="3" height="4"/>')
  const patch = svgAttributePatch(source, { id: 'r', attribute: 'width', value: '9' })
  assert.equal(patch.before, '3')
  assert.equal(patch.start, source.indexOf('width="3"') + 7)
  const result = apply(source, [patch])
  assert.equal(result.ok, true)
  assert.equal(result.source, source.replace('width="3"', 'width="9"'))
  assert.equal(apply(result.source, result.inverse).source, source)
})

test('malformed structure degrades to a flat, explicitly unlocated listing', () => {
  const malformed = '<svg viewBox="0 0 10 10"><path id="p" d="M0 0 L1 1"></svg>'
  const nodes = listEditableSvgNodes(malformed)
  assert.deepEqual(nodes.map(node => node.id), ['p'])
  assert.equal(nodes[0].structure, false)
  assert.equal(nodes[0].depth, null)
  assert.equal(nodes[0].start, null)
  assert.equal(nodes[0].readOnly, true)
})

test('duplicate ids and unsafe sources are still refused before mapping', () => {
  assert.throws(() => listEditableSvgNodes('<svg><rect id="a"/><g id="a"/></svg>'), { code: 'ambiguous-svg' })
  assert.throws(() => listEditableSvgNodes('<!DOCTYPE svg><svg/>'), { code: 'unsupported-svg' })
  assert.throws(() => listEditableSvgNodes('<svg><script>x()</script></svg>'), { code: 'unsupported-svg' })
})

test('self-closing groups and empty content spans are mapped exactly', () => {
  const source = '<svg viewBox="0 0 10 10"><g id="empty"/><g id="open"></g>' +
    '<rect id="r" x="0" y="0" width="1" height="1"/></svg>'
  const empty = byId(source, 'empty')
  assert.equal(empty.isGroup, true)
  assert.equal(empty.selfClosing, true)
  assert.equal(empty.openEnd, empty.end)
  assert.equal(empty.start, source.indexOf('<g id="empty"/>'))
  const open = byId(source, 'open')
  assert.equal(open.selfClosing, false)
  assert.equal(open.end - open.openEnd, '</g>'.length)
  assert.equal(source.slice(open.contentStart, open.contentEnd), '')
  assert.equal(open.readOnly, false)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { svgAttributePatch } from '../src/svg-attributes.mjs'
import { applyNativePatches, sourceHash } from '../src/native-patch.mjs'

function apply(source, operation) {
  const patch = svgAttributePatch(source, operation)
  const result = applyNativePatches({ source, format: 'svg', baseHash: sourceHash(source), patches: [patch] })
  assert.equal(result.ok, true)
  const undo = applyNativePatches({ source: result.source, format: 'svg', baseHash: sourceHash(result.source), patches: result.inverse })
  assert.equal(undo.source, source, 'the explicit default declaration must be exactly reversible')
  return result.source
}

test('Graphite opacity makes an absent SVG default explicit with one exact insertion', () => {
  const source = '<svg>\r\n  <rect id="card" width="20" fill="#f00" />\r\n</svg>'
  const edited = apply(source, { id: 'card', attribute: 'opacity', value: '0' })
  assert.equal(edited, '<svg>\r\n  <rect id="card" width="20" fill="#f00"  opacity="0"/>\r\n</svg>')
  for (const value of ['-1', '2', 'url(#paint)', '0" onclick="x', 'NaN']) {
    assert.throws(() => svgAttributePatch(source, { id: 'card', attribute: 'opacity', value }), { code: 'invalid-value' })
  }
})

test('missing native text defaults can be declared without rewriting the text or its siblings', () => {
  const source = '<svg><text id="title" x="10">A &amp; B</text><rect id="keep"/></svg>'
  const edited = apply(source, { id: 'title', attribute: 'font-style', value: 'italic' })
  assert.equal(edited, '<svg><text id="title" x="10" font-style="italic">A &amp; B</text><rect id="keep"/></svg>')
  assert.throws(() => svgAttributePatch(source, { id: 'keep', attribute: 'font-style', value: 'italic' }), { code: 'unsupported-edit' })
  assert.throws(() => svgAttributePatch(source, { id: 'keep', attribute: 'fill', value: '#fff' }), { code: 'unsupported-edit' },
    'the historical no-insertion rule remains for attributes outside the explicit UI defaults')
})

test('default insertion still respects ancestor locks and read-only SVG regions', () => {
  assert.throws(() => svgAttributePatch('<svg><g id="g" data-locked="true"><rect id="r"/></g></svg>',
    { id: 'r', attribute: 'opacity', value: '0.5' }), { code: 'locked' })
  assert.throws(() => svgAttributePatch('<svg><defs><rect id="r"/></defs></svg>',
    { id: 'r', attribute: 'opacity', value: '0.5' }))
})

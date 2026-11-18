import test from 'node:test'
import assert from 'node:assert/strict'
import { listEditableSvgNodes, svgAttributePatch } from '../src/svg-attributes.mjs'
import { applyNativePatches, sourceHash } from '../src/native-patch.mjs'
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><!-- <rect id="fake" fill="red"/> -->\n<rect id="a" fill="red" width="12"/><path id="b" d="M0 0 L1 1"/></svg>'
test('lists unique editable ids and ignores markup in comments',()=>{
  assert.deepEqual(listEditableSvgNodes(svg).map(n=>n.id),['a','b'])
})
test('edits only the target SVG attribute without reserializing',()=>{
  const patch=svgAttributePatch(svg,{id:'a',attribute:'fill',value:'#fff'})
  const result=applyNativePatches({source:svg,format:'svg',baseHash:sourceHash(svg),patches:[patch]})
  assert.equal(result.ok,true)
  assert.equal(result.source,svg.replace('id="a" fill="red"','id="a" fill="#fff"'))
})
test('attributes containing greater-than characters do not confuse tag scanner',()=>{
  const source='<svg><rect id="a" data-note="2 > 1" fill="red"/></svg>'
  assert.equal(svgAttributePatch(source,{id:'a',attribute:'fill',value:'blue'}).before,'red')
})
test('duplicate node IDs rejected',()=>{
  assert.throws(()=>listEditableSvgNodes('<svg><rect id="a"/><rect id="a"/></svg>'),{code:'ambiguous-svg'})
})
test('refuses adding a missing attribute rather than risky rewrite',()=>{
  assert.throws(()=>svgAttributePatch(svg,{id:'b',attribute:'fill',value:'red'}),{code:'unsupported-edit'})
})
test('rejects DTD and scripts',()=>{
  assert.throws(()=>listEditableSvgNodes('<!DOCTYPE svg><svg/>'),{code:'unsupported-svg'})
  assert.throws(()=>listEditableSvgNodes('<svg><script>evil()</script></svg>'),{code:'unsupported-svg'})
})
test('rejects unsafe external paint URLs and invalid numeric properties',()=>{
  assert.throws(()=>svgAttributePatch(svg,{id:'a',attribute:'fill',value:'url(https://example.com/a)'}),{code:'invalid-value'})
  assert.throws(()=>svgAttributePatch(svg,{id:'a',attribute:'width',value:'-9'}),{code:'invalid-value'})
})
test('rejects malformed attribute markup',()=>{
  assert.throws(()=>listEditableSvgNodes('<svg><rect id=a /></svg>'),{code:'invalid-svg'})
})
test('does not allow editing nodes only present in comments',()=>{
  assert.throws(()=>svgAttributePatch(svg,{id:'fake',attribute:'fill',value:'blue'}),{code:'unknown-node'})
})
test('supports single quotes, newlines and explicitly bounded safe path data',()=>{
  const source="<svg>\n<path id='p' d='M 0 0 L 20 10'/>\n</svg>"
  assert.equal(svgAttributePatch(source,{id:'p',attribute:'d',value:'M0 0L2 2'}).before,'M 0 0 L 20 10')
})

/**
 * Appearance attributes: stroke family and the two opacity channels.
 *
 * They are ordinary validated attributes, so the interesting properties are the
 * ones a designer depends on: a value the browser would misinterpret is refused,
 * a missing declaration is inserted as one reversible span, and nothing else in
 * the document is rewritten.
 */
const PLAIN = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">' +
  '<rect id="r" width="10" height="10"/></svg>\n'

function applied(source, params) {
  const patch = svgAttributePatch(source, params)
  return {
    patch,
    text: source.slice(0, patch.start) + patch.after + source.slice(patch.end),
    undone: source.slice(0, patch.start) + patch.before + source.slice(patch.end),
  }
}

test('the stroke family is insertable once and reversible', () => {
  const cases = [
    ['stroke', '#ff0000'],
    ['stroke-width', '2.5'],
    ['stroke-opacity', '0.4'],
    ['stroke-linecap', 'round'],
    ['stroke-linejoin', 'bevel'],
    ['stroke-dasharray', '4 2'],
    ['fill-opacity', '0.3'],
  ]
  for (const [attribute, value] of cases) {
    const step = applied(PLAIN, { id: 'r', attribute, value })
    assert.equal(step.text, PLAIN.replace('/></svg>', ' ' + attribute + '="' + value + '"/></svg>'),
      attribute + ' must be inserted before the closing bracket only')
    assert.equal(step.undone, PLAIN, attribute + ' must undo exactly')
    assert.equal(step.patch.before, '', 'an insertion has no previous bytes')
  }
})

test('an existing stroke attribute is replaced in place, not duplicated', () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg"><rect id="r" stroke="#000" stroke-width="1"/></svg>'
  const step = applied(source, { id: 'r', attribute: 'stroke', value: '#bda991' })
  assert.equal(step.text, source.replace('stroke="#000"', 'stroke="#bda991"'))
  assert.equal(step.undone, source)
})

test('values the browser could misread are refused without a patch', () => {
  const refused = [
    ['stroke', 'url(javascript:alert(1))'],
    ['stroke', 'expression(alert(1))'],
    ['stroke', '#ff0000;fill:url(x)'],
    ['stroke-width', '-1'],
    ['stroke-width', '1e3'],
    ['stroke-opacity', '1.4'],
    ['fill-opacity', '-0.2'],
    ['stroke-linecap', 'wobbly'],
    ['stroke-linejoin', 'sharp'],
    ['stroke-dasharray', '4px'],
    ['stroke-dasharray', '4 2 4 2 4 2 4 2 4 2 4 2 4 2 4 2 4 2 4 2 4 2 4 2 4 2 4 2 4 2 4 2 4'],
  ]
  for (const [attribute, value] of refused) {
    assert.throws(() => svgAttributePatch(PLAIN, { id: 'r', attribute, value }),
      (error) => error.code === 'invalid-value', attribute + '=' + value + ' must be refused')
  }
})

test('the two opacity channels are independent attributes', () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg"><rect id="r" opacity="0.5"/></svg>'
  const step = applied(source, { id: 'r', attribute: 'fill-opacity', value: '0.25' })
  assert.equal(step.text, source.replace('/></svg>', ' fill-opacity="0.25"/></svg>'))
  assert.ok(step.text.includes('opacity="0.5"'), 'the global opacity must not be rewritten')
})

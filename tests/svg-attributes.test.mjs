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

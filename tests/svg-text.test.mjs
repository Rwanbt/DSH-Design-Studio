import test from 'node:test'
import assert from 'node:assert/strict'
import { listSvgTextNodes,svgTextPatch,escapeSvgText,decodeSvgText } from '../src/svg-text.mjs'
import { applyNativePatches,sourceHash } from '../src/native-patch.mjs'

const base='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">\n<!-- <text id="fake">impostor</text> -->\n<text id="title" x="20" y="50" font-size="32" fill="#fff">Hello &amp; world</text>\n<rect id="r" x="2" y="2" width="3" height="4"/>\n</svg>'
function apply(source,patch){ return applyNativePatches({source,format:'svg',baseHash:sourceHash(source),patches:[patch]}) }
test('maps true source spans, ignoring fake text tags inside comments',()=>{
  const found=listSvgTextNodes(base)
  assert.equal(found.length,1)
  assert.equal(found[0].id,'title')
  assert.equal(found[0].text,'Hello & world')
  assert.equal(found[0].before,'Hello &amp; world')
})
test('targeted text edit preserves all unrelated SVG source and supports undo',()=>{
  const patch=svgTextPatch(base,{id:'title',value:'Design <studio> & friends'})
  const result=apply(base,patch)
  assert.equal(result.ok,true)
  assert.equal(result.source,base.replace('Hello &amp; world','Design &lt;studio&gt; &amp; friends'))
  const undo=applyNativePatches({source:result.source,format:'svg',baseHash:result.hash,patches:result.inverse})
  assert.equal(undo.source,base)
})
test('multiline text emits safe tspans and is editable again',()=>{
  const result=apply(base,svgTextPatch(base,{id:'title',value:'Une ligne\nDeux & <trois>'}))
  assert.equal(result.ok,true)
  assert.ok(result.source.includes('<tspan x="20" dy="1.2em">Deux &amp; &lt;trois&gt;</tspan>'))
  const lines=listSvgTextNodes(result.source)
  assert.equal(lines[0].text,'Une ligne\nDeux & <trois>')
  const again=apply(result.source,svgTextPatch(result.source,{id:'title',value:'Terminé'}))
  assert.equal(again.ok,true)
  assert.equal(listSvgTextNodes(again.source)[0].text,'Terminé')
})
test('rejects nested rich SVG text that would require lossy reconstruction',()=>{
  const src='<svg><text id="t" x="2"><tspan fill="red">Red</tspan></text></svg>'
  assert.equal(listSvgTextNodes(src)[0].editable,false)
  assert.throws(()=>svgTextPatch(src,{id:'t',value:'Blue'}),{code:'unsupported-text'})
})
test('rejects malicious entities and control characters',()=>{
  assert.equal(decodeSvgText('A &lt; B &#x1F680;'),'A < B 🚀')
  assert.equal(escapeSvgText('<&>'),'&lt;&amp;&gt;')
  assert.throws(()=>decodeSvgText('a &bogus; b'),{code:'unsupported-entity'})
  assert.throws(()=>escapeSvgText('a\u0000b'),{code:'invalid-text'})
})
test('text geometry cannot be mistaken for comment and ambiguous ids fail',()=>{
  assert.throws(()=>svgTextPatch(base,{id:'fake',value:'x'}),{code:'unknown-node'})
  assert.throws(()=>svgTextPatch('<svg><text id="t">a</text><text id="t">b</text></svg>',{id:'t',value:'c'}),{code:'ambiguous-svg'})
})

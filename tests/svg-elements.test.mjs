import test from 'node:test'
import assert from 'node:assert/strict'
import { svgElementPatch } from '../src/svg-elements.mjs'
import { sourceHash, applyNativePatches } from '../src/native-patch.mjs'

const original='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n'+
  '<!-- <rect id="fake" x="0"/> -->\n'+
  '<rect id="card" x="10" y="20" width="30" height="40" fill="#eee"/>\n'+
  '<text id="label" x="15" y="20">Hello &amp; World</text>\n</svg>\n'
const apply=(source,patch)=>applyNativePatches({source,format:'svg',baseHash:sourceHash(source),patches:[patch]})

test('duplicate SVG rectangle produces unique id with original bytes intact',()=>{
  const {patch,selectedId}=svgElementPatch(original,{id:'card',operation:'duplicate'})
  assert.equal(selectedId,'card-copy')
  const next=apply(original,patch)
  assert.equal(next.ok,true)
  assert.equal(next.source.includes('<rect id="card-copy"'),true)
  assert.equal(next.source.replace(patch.after,''),original)
  const reverse=applyNativePatches({source:next.source,format:'svg',baseHash:next.hash,patches:next.inverse})
  assert.equal(reverse.source,original)
})
test('duplicate chooses a fresh id and preserves quoted attributes',()=>{
  const src='<svg><rect id=\'shape\' data-note="2 > 1" x="5" y="8" width="9" height="6"/>'+
    '<rect id="shape-copy" x="10"/></svg>'
  const copy=svgElementPatch(src,{id:'shape',operation:'duplicate'})
  assert.equal(copy.selectedId,'shape-copy-2')
  assert.ok(copy.patch.after.includes('data-note="2 > 1"'))
  assert.ok(apply(src,copy.patch).source.includes("id='shape-copy-2'"))
})
test('delete leaf element only and undo restores exact file',()=>{
  const {patch,selectedId}=svgElementPatch(original,{id:'label',operation:'delete'})
  assert.equal(selectedId,null)
  assert.equal(patch.before,'<text id="label" x="15" y="20">Hello &amp; World</text>')
  const next=apply(original,patch)
  assert.equal(next.ok,true)
  assert.ok(next.source.includes('id="card"'))
  assert.ok(!next.source.includes('id="label"'))
  assert.equal(applyNativePatches({source:next.source,format:'svg',baseHash:next.hash,patches:next.inverse}).source,original)
})
test('comments cannot be mistaken for selectable elements',()=>{
  assert.throws(()=>svgElementPatch(original,{id:'fake',operation:'delete'}),{code:'unknown-node'})
})
test('nested text and group elements refuse editing rather than losing structure',()=>{
  const src='<svg><g id="group"><rect id="child" x="2" y="3"/></g>'+
    '<text id="rich"><tspan font-style="italic">Hi</tspan></text></svg>'
  for(const id of ['group','child','rich']) {
    assert.throws(()=>svgElementPatch(src,{id,operation:'delete'}),{code:id==='group'?'unknown-node':'unsupported-svg'})
  }
})
test('ambiguous IDs and malformed XML are refused',()=>{
  assert.throws(()=>svgElementPatch('<svg><rect id="x"/><circle id="x"/></svg>',{id:'x',operation:'delete'}),{code:'ambiguous-svg'})
  assert.throws(()=>svgElementPatch('<svg><rect id="x"></svg>',{id:'x',operation:'delete'}),{code:'invalid-svg'})
  assert.throws(()=>svgElementPatch('<!DOCTYPE svg><svg><rect id="x"/></svg>',{id:'x',operation:'duplicate'}),{code:'unsupported-svg'})
})
test('refuses unsupported operations and unaddressable layers',()=>{
  assert.throws(()=>svgElementPatch(original,{id:'card',operation:'rename'}),{code:'invalid-target'})
  assert.throws(()=>svgElementPatch(original,{id:'missing',operation:'duplicate'}),{code:'unknown-node'})
})

test('rejects executable SVG nodes or event handler attributes before layer mutation',()=>{
  const bad=[
    '<svg><rect id="x"/><script>alert(1)</script></svg>',
    '<svg><rect id="x" onload="evil()"/></svg>',
    '<svg><rect id="x"/><foreignObject><div>HTML</div></foreignObject></svg>',
  ]
  for(const source of bad) {
    assert.throws(()=>svgElementPatch(source,{id:'x',operation:'duplicate'}),{code:'unsupported-svg'})
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { svgShapeInsertPatch } from '../src/svg-shapes.mjs'
import { applyNativePatches,sourceHash } from '../src/native-patch.mjs'
import { listEditableSvgNodes } from '../src/svg-attributes.mjs'

const base='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">\n  <rect id="existing" x="2" y="3" width="5" height="8" fill="red"/>\n</svg>\n'

test('manual rectangle insertion preserves all pre-existing bytes',()=>{
  const {id,patch}=svgShapeInsertPatch(base,'rect')
  assert.equal(id,'shape-1')
  const result=applyNativePatches({source:base,format:'svg',baseHash:sourceHash(base),patches:[patch]})
  assert.equal(result.ok,true)
  assert.equal(result.source.replace(patch.after,''),base)
  assert.deepEqual(listEditableSvgNodes(result.source).map(node=>node.id),['existing','shape-1'])
  assert.equal(applyNativePatches({source:result.source,format:'svg',baseHash:result.hash,patches:result.inverse}).source,base)
})
test('circle and ellipse created with native coordinates and stable IDs',()=>{
  for(const kind of ['circle','ellipse']){
    const {patch}=svgShapeInsertPatch(base,kind)
    const result=applyNativePatches({source:base,format:'svg',baseHash:sourceHash(base),patches:[patch]})
    assert.equal(result.ok,true)
    assert.ok(result.source.includes('<'+kind+' id="shape-1"'))
  }
})
test('subsequent shape creates unique ID',()=>{
  const first=svgShapeInsertPatch(base,'rect')
  const doc=applyNativePatches({source:base,format:'svg',baseHash:sourceHash(base),patches:[first.patch]}).source
  assert.equal(svgShapeInsertPatch(doc,'rect').id,'shape-2')
})
test('rejects unsupported root, kind and scripts',()=>{
  assert.throws(()=>svgShapeInsertPatch('<svg/>','rect'),{code:'unsupported-svg'})
  assert.throws(()=>svgShapeInsertPatch(base,'polygon'),{code:'unsupported-shape'})
  assert.throws(()=>svgShapeInsertPatch('<svg viewBox="0 0 100 100"><script>alert(1)</script></svg>','rect'))
})
test('refuses multi-root and transformed SVGs',()=>{
  assert.throws(()=>svgShapeInsertPatch('<svg viewBox="0 0 10 10"></svg><svg viewBox="0 0 10 10"></svg>','rect'))
  assert.throws(()=>svgShapeInsertPatch('<svg viewBox="0 0 10 10"><g transform="translate(1)"></g></svg>','rect'))
})

test('manual path creation generates editable explicit cubic coordinates and can undo',()=>{
  const created=svgShapeInsertPatch(base,'path')
  assert.equal(created.id,'shape-1')
  const output=applyNativePatches({source:base,format:'svg',baseHash:sourceHash(base),patches:[created.patch]})
  assert.equal(output.ok,true)
  assert.match(output.source,/<path id="shape-1" d="M [^"]+ C [^"]+" fill="none" stroke="#bca38d"/)
  assert.equal(output.source.replace(created.patch.after,''),base)
  assert.equal(applyNativePatches({source:output.source,format:'svg',baseHash:output.hash,patches:output.inverse}).source,base)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {planSvgMultiNudge} from '../src/svg-multi-nudge.mjs'
import {applyNativePatches,sourceHash} from '../src/native-patch.mjs'

const ROOT='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100">'+
  '<rect id="a" x="10" y="10" width="20" height="20"/>'+
  '<circle id="b" cx="50" cy="50" r="8"/>'+
  '</svg>'
const apply=(source,patches)=>applyNativePatches({source,format:'svg',baseHash:sourceHash(source),patches})

test('moves two independent shapes in one exactly reversible patch batch',()=>{
  const patches=planSvgMultiNudge(ROOT,{ids:['a','b'],dx:10,dy:-2})
  assert.equal(patches.length,2)
  const changed=apply(ROOT,patches)
  assert.equal(changed.ok,true,JSON.stringify(changed))
  assert.ok(changed.source.includes('id="a" x="10" y="10" width="20" height="20" transform="matrix(1,0,0,1,10,-2)"'))
  assert.ok(changed.source.includes('id="b" cx="50" cy="50" r="8" transform="matrix(1,0,0,1,10,-2)"'))
  assert.equal(apply(changed.source,changed.inverse).source,ROOT)
})
test('mapped delta respects a transformed parent and does not rewrite siblings',()=>{
  const source='<svg viewBox="0 0 200 200">'+
    '<g id="parent" transform="scale(2)"><rect id="a" x="10" y="10" width="20" height="20"/></g>'+
    '<rect id="b" x="50" y="10" width="20" height="20"/></svg>'
  const patches=planSvgMultiNudge(source,{ids:['a','b'],dx:10,dy:0})
  const changed=apply(source,patches)
  assert.equal(changed.ok,true,JSON.stringify(changed))
  assert.ok(changed.source.includes('id="a" x="10" y="10" width="20" height="20" transform="matrix(1,0,0,1,5,0)"'))
  assert.ok(changed.source.includes('id="b" x="50" y="10" width="20" height="20" transform="matrix(1,0,0,1,10,0)"'))
  assert.equal(apply(changed.source,changed.inverse).source,source)
})
test('rejects duplicate ids, overlapping group/child, missing geometry and zero movement',()=>{
  const source='<svg viewBox="0 0 100 100">'+
    '<g id="parent"><rect id="a" x="10" y="10" width="20" height="20"/></g>'+
    '<rect id="b" x="30" y="40" width="20" height="20"/></svg>'
  const cases=[
    [{ids:['a','a'],dx:1,dy:0},'invalid-target'],
    [{ids:['parent','a'],dx:1,dy:0},'overlapping-selection'],
    [{ids:['a','missing'],dx:1,dy:0},'unknown-node'],
    [{ids:['a','b'],dx:0,dy:0},'invalid-target'],
    [{ids:['a','b'],dx:Infinity,dy:0},'invalid-target'],
  ]
  for(const [options,code] of cases)assert.throws(
    ()=>planSvgMultiNudge(source,options),e=>e?.code===code)
})

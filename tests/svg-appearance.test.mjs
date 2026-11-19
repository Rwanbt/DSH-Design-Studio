import test from 'node:test'
import assert from 'node:assert/strict'
import {planSvgAppearanceTransfer} from '../src/svg-appearance.mjs'
import {applyNativePatches,sourceHash} from '../src/native-patch.mjs'

const SRC='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'+
  '<rect id="from" fill="#af3100" stroke="#223344" stroke-width="3" opacity="0.5" />'+
  '<rect id="to" x="10" width="30" fill="#dddddd" /></svg>'
const apply=(source,patches)=>applyNativePatches({source,format:'svg',baseHash:sourceHash(source),patches})

test('native appearance transfer patches only explicit values and merges insertions',()=>{
  const patches=planSvgAppearanceTransfer(SRC,{sourceId:'from',targetId:'to'})
  assert.ok(patches.length>=2)
  const changed=apply(SRC,patches)
  assert.equal(changed.ok,true,JSON.stringify(changed))
  assert.ok(changed.source.includes('id="from" fill="#af3100" stroke="#223344"'))
  assert.ok(changed.source.includes('id="to" x="10" width="30" fill="#af3100" stroke="#223344" stroke-width="3" opacity="0.5"'))
  assert.equal(apply(changed.source,changed.inverse).source,SRC,'Undo restores every original byte')
})
test('native appearance transfer refuses ambiguous, locked, missing and unchanged targets',()=>{
  for(const [text,sourceId,targetId,code] of [
    [SRC,'from','from','unchanged'],
    [SRC,'from','missing','unknown-node'],
    [SRC.replace('id="to"','id="to" data-locked="true"'),'from','to','locked'],
    [SRC.replace('id="to"','id="to" style="fill:blue"'),'from','to','ambiguous-style'],
    [SRC.replace('fill="#af3100"','fill="url(#missing)"'),'from','to','unknown-reference'],
  ])assert.throws(()=>planSvgAppearanceTransfer(text,{sourceId,targetId}),e=>e?.code===code)
})

/**
 * Native gradient creation: two coordinated exact spans, one file commit.
 * New documents remain SVG, no unrelated source bytes are reserialized.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { planSvgGradientCreation } from '../src/svg-gradient-create.mjs'
import { applyNativePatches, sourceHash } from '../src/native-patch.mjs'
import { scanSvgDocument } from '../src/svg-document.mjs'

const SOURCE = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <!-- preserve me -->
  </defs>
  <rect id="panel" x="2" y="3" width="20" height="30" fill="#123456"/>
</svg>
`
const apply = (source, patches) => applyNativePatches({
  source, format:'svg', baseHash:sourceHash(source), patches,
})

test('creates an editable linear gradient and assigns it in one reversible transaction', () => {
  const { patches, gradientId, selectedId } = planSvgGradientCreation(SOURCE,{id:'panel'})
  assert.equal(gradientId,'dsh_gradient_1')
  assert.equal(selectedId,'panel')
  assert.equal(patches.length,2)
  const result=apply(SOURCE, patches)
  assert.equal(result.ok,true,JSON.stringify(result))
  assert.equal(result.changed,true)
  assert.ok(result.source.includes('<!-- preserve me -->'),'existing comments survive')
  assert.ok(result.source.includes('<linearGradient id="dsh_gradient_1"'))
  assert.ok(result.source.includes('fill="url(#dsh_gradient_1)"'))
  assert.ok(result.source.includes('<stop offset="0" stop-color="#000000"/>'))
  assert.ok(result.source.includes('<stop offset="1" stop-color="#ffffff"/>'))
  const scan=scanSvgDocument(result.source)
  assert.equal(scan.byId.get('panel').attributes.get('fill').value,'url(#dsh_gradient_1)')
  assert.equal(scan.byId.get('dsh_gradient_1').tag,'linearGradient')
  const undone=apply(result.source,result.inverse)
  assert.equal(undone.ok,true)
  assert.equal(undone.source,SOURCE,'one undo restores the original document byte-for-byte')
})

test('creates radial gradients even without defs or a preexisting fill', () => {
  const source='<svg xmlns="http://www.w3.org/2000/svg"><circle id="orb" cx="20" cy="20" r="8"/></svg>'
  const { patches }=planSvgGradientCreation(source,{id:'orb',type:'radial'})
  const next=apply(source,patches)
  assert.equal(next.ok,true)
  assert.ok(next.source.includes('<defs>'))
  assert.ok(next.source.includes('<radialGradient id="dsh_gradient_1"'))
  assert.equal(scanSvgDocument(next.source).byId.get('orb').attributes.get('fill').value,
    'url(#dsh_gradient_1)')
  assert.equal(apply(next.source,next.inverse).source,source)
})

test('next gradient gets a fresh unique id; no existing gradients are rewritten', () => {
  const first=apply(SOURCE,planSvgGradientCreation(SOURCE,{id:'panel'}).patches).source
  const second=planSvgGradientCreation(first,{id:'panel',type:'radial'})
  assert.equal(second.gradientId,'dsh_gradient_2')
  const next=apply(first,second.patches)
  assert.equal(next.ok,true)
  assert.ok(next.source.includes('id="dsh_gradient_1"'))
  assert.ok(next.source.includes('id="dsh_gradient_2"'))
  assert.equal(apply(next.source,next.inverse).source,first)
})

test('ambiguous, locked, missing and read-only layers refuse safely', () => {
  const cases=[
    [SOURCE,{id:'missing'},'unknown-node'],
    [SOURCE,{id:'panel',type:'mesh'},'invalid-target'],
    [SOURCE.replace('<rect id="panel"','<rect id="panel" style="fill:red"'),{id:'panel'},'ambiguous-style'],
    [SOURCE.replace('<rect id="panel"','<rect id="panel" data-locked="true"'),{id:'panel'},'locked'],
    [SOURCE.replace('<!-- preserve me -->','<style>rect{fill:red}</style>'),{id:'panel'},'ambiguous-style'],
    [SOURCE.replace('<rect id="panel"','<rect id="panel" fill="#ccc"'),{id:'panel'},'ambiguous-svg'],
  ]
  for(const [source,request,code] of cases) {
    assert.throws(()=>planSvgGradientCreation(source,request),
      error=>error?.code===code,'should refuse '+code)
  }
})

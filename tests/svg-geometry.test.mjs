import test from 'node:test'
import assert from 'node:assert/strict'
import { svgGeometry, svgMoveEdits, svgResizeEdits, svgResizeCornerGeometry, svgResizeCornerEdits } from '../src/svg-geometry.mjs'
import { svgAttributePatch } from '../src/svg-attributes.mjs'
import { applyNativePatches, sourceHash } from '../src/native-patch.mjs'

const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect id="card" x="90" y="60" width="460" height="240" fill="#fff"/><circle id="dot" cx="150" cy="150" r="40"/><ellipse id="oval" cx="300" cy="150" rx="25" ry="10"/></svg>'

test('extracts geometries with correct SVG user coordinates', () => {
  const { artboard, handles, warning } = svgGeometry(source)
  assert.equal(warning, null)
  assert.deepEqual(artboard, {x:0,y:0,width:640,height:360})
  assert.deepEqual(handles.map(h => h.id), ['card','dot','oval'])
  assert.deepEqual(handles[0].move, {x:'x',y:'y',initialX:90,initialY:60})
  assert.deepEqual(handles[1].move, {x:'cx',y:'cy',initialX:150,initialY:150})
  assert.deepEqual([handles[2].x,handles[2].y,handles[2].width,handles[2].height],[275,140,50,20])
})
test('moves rectangle by mapping x and y into source spans', () => {
  const handle = svgGeometry(source).handles[0]
  const patches = svgMoveEdits(handle,15.5,-8).map(edit=>svgAttributePatch(source,edit))
  const result = applyNativePatches({source,format:'svg',baseHash:sourceHash(source),patches})
  assert.equal(result.ok,true)
  assert.ok(result.source.includes('id="card" x="105.5" y="52"'))
  assert.equal(applyNativePatches({source:result.source,format:'svg',baseHash:result.hash,patches:result.inverse}).source,source)
})
test('moves circle center instead of bounding-box origin', () => {
  const handle=svgGeometry(source).handles[1]
  assert.deepEqual(svgMoveEdits(handle,5,7),[
    {id:'dot',attribute:'cx',value:'155'},
    {id:'dot',attribute:'cy',value:'157'}
  ])
})
test('refuses moving SVGs with groups or transforms', () => {
  assert.equal(svgGeometry('<svg viewBox="0 0 20 20"><g><rect id="r" x="1" y="1" width="2" height="2"/></g></svg>').handles.length,0)
  assert.equal(svgGeometry('<svg viewBox="0 0 20 20"><rect id="r" transform="scale(2)" x="1" y="1" width="2" height="2"/></svg>').handles.length,0)
})
test('requires valid viewBox; no silent incorrect pixel conversion', () => {
  assert.equal(svgGeometry('<svg><rect id="r" x="1" y="1" width="2" height="2"/></svg>').artboard,null)
  assert.equal(svgGeometry('<svg viewBox="0 0 0 20"></svg>').artboard,null)
  assert.equal(svgGeometry('<svg viewBox="0 0 20 20" preserveAspectRatio="none"></svg>').artboard,null)
})
test('requires explicit coordinate attributes, skips impossible handles', () => {
  const noX='<svg viewBox="0 0 100 100"><rect id="r" width="5" height="5"/></svg>'
  assert.equal(svgGeometry(noX).handles.length,0)
})
test('rejects malformed move delta', () => {
  const handle=svgGeometry(source).handles[0]
  assert.throws(()=>svgMoveEdits(handle,Number.NaN,3),TypeError)
  assert.throws(()=>svgMoveEdits(handle,Infinity,3),TypeError)
})
test('supports nonzero viewBox offsets', () => {
  const result=svgGeometry('<svg viewBox="-50 -100 200 100"><circle id="x" cx="0" cy="-50" r="5"/></svg>')
  assert.deepEqual(result.artboard,{x:-50,y:-100,width:200,height:100})
  assert.equal(result.handles[0].y,-55)
})

test('ignores fake SVG root inside comment when deriving viewBox',()=>{
  const input='<!-- <svg viewBox="0 0 999 999"> --><svg viewBox="0 0 200 100"><rect id="a" x="5" y="6" width="7" height="8"/></svg>'
  const geometry=svgGeometry(input)
  assert.deepEqual(geometry.artboard,{x:0,y:0,width:200,height:100})
  assert.deepEqual(geometry.handles.map(h=>h.id),['a'])
})
test('refuses duplicate roots and foreignObject content',()=>{
  assert.equal(svgGeometry('<svg viewBox="0 0 20 20"/><svg viewBox="0 0 30 30"/>').artboard,null)
  assert.equal(svgGeometry('<svg viewBox="0 0 20 20"><foreignObject><rect id="r" x="0" y="0" width="2" height="2"/></foreignObject></svg>').handles.length,0)
})

test('south-east resize of rectangle edits only width and height', () => {
  const item = svgGeometry(source).handles[0]
  assert.deepEqual(svgResizeEdits(item,20,-30), [
    { id:'card', attribute:'width', value:'480' },
    { id:'card', attribute:'height', value:'210' },
  ])
})
test('south-east ellipse resize preserves top-left anchor', () => {
  const item = svgGeometry(source).handles[2]
  assert.deepEqual(svgResizeEdits(item,10,20), [
    {id:'oval',attribute:'cx',value:'305'},
    {id:'oval',attribute:'cy',value:'160'},
    {id:'oval',attribute:'rx',value:'30'},
    {id:'oval',attribute:'ry',value:'20'},
  ])
})
test('resize clamps to positive dimensions and rejects circle/NaN', () => {
  const rectangle=svgGeometry(source).handles[0]
  assert.deepEqual(svgResizeEdits(rectangle,-10000,-10000).map(x=>x.value),['1','1'])
  assert.throws(()=>svgResizeEdits(svgGeometry(source).handles[1],2,2),TypeError)
  assert.throws(()=>svgResizeEdits(rectangle,Infinity,2),TypeError)
})

test('four corner resize preserves opposite anchor for rectangles',()=>{
  const item=svgGeometry(source).handles[0]
  assert.deepEqual(svgResizeCornerGeometry(item,'nw',20,30),{x:110,y:90,width:440,height:210})
  assert.deepEqual(svgResizeCornerGeometry(item,'ne',20,30),{x:90,y:90,width:480,height:210})
  assert.deepEqual(svgResizeCornerGeometry(item,'sw',20,30),{x:110,y:60,width:440,height:270})
  assert.deepEqual(svgResizeCornerGeometry(item,'se',20,30),{x:90,y:60,width:480,height:270})
})
test('aspect ratio is locked for resize and XML source writes remain scoped',()=>{
  const item=svgGeometry(source).handles[0]
  const geometry=svgResizeCornerGeometry(item,'se',46,0,true)
  assert.ok(Math.abs(geometry.width/geometry.height-item.width/item.height)<1e-9)
  const edits=svgResizeCornerEdits(item,'nw',10,10,true)
  const patches=edits.map(edit=>svgAttributePatch(source,edit))
  const out=applyNativePatches({source,format:'svg',baseHash:sourceHash(source),patches})
  assert.equal(out.ok,true)
  assert.equal(out.source.replace(/id="card" x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*"/,'id="card" x="90" y="60" width="460" height="240"'),source)
})
test('corner resize rejects unsupported shapes/corners and invalid deltas',()=>{
  const item=svgGeometry(source).handles[0]
  assert.throws(()=>svgResizeCornerEdits(item,'middle',10,0),TypeError)
  assert.throws(()=>svgResizeCornerEdits(item,'nw',Infinity,0),TypeError)
  assert.throws(()=>svgResizeCornerEdits(svgGeometry(source).handles[1],'se',3,3),TypeError)
})

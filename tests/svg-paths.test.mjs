import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEditablePath, listSvgPathModels, svgPathPointPatches } from '../src/svg-paths.mjs'
import { applyNativePatches,sourceHash } from '../src/native-patch.mjs'

const start='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">\n'+
  '  <!-- <path id="ghost" d="M99 99"/> -->\n'+
  '  <path id="stroke" fill="none" stroke="#333" d="M 10,20 C 30,40 50,60 70,80 Q 85,95 100,90 L 110,80 Z"/>\n</svg>'
function applied(source,patches) {return applyNativePatches({source,format:'svg',baseHash:sourceHash(source),patches})}

test('parses explicit M, L, Q, C and Z with stable point indices and control links',()=>{
  const points=parseEditablePath('M 10,20 C 30,40 50,60 70,80 Q 85,95 100,90 L 110,80 Z')
  assert.deepEqual(points.map(p=>p.role),['anchor','cubic-in','cubic-out','anchor','quadratic','anchor','anchor'])
  assert.deepEqual(points.map(p=>[p.x,p.y]),[[10,20],[30,40],[50,60],[70,80],[85,95],[100,90],[110,80]])
  assert.deepEqual(points[1].link,{x:10,y:20})
  assert.deepEqual(points[2].link,{x:70,y:80})
  assert.deepEqual(points[4].link,{x:100,y:90})
})
test('supports signed/decimal/exponent syntax without rewriting unaffected bytes',()=>{
  const text='M-1.2e1 +.5 L .25,-4.50e-1'
  const points=parseEditablePath(text)
  assert.deepEqual(points.map(p=>[p.x,p.y]),[[-12,0.5],[0.25,-0.45]])
  const source='<svg viewBox="0 0 100 100"><path id="p" d="'+text+'"/></svg>'
  const patches=svgPathPointPatches(source,{id:'p',index:1,x:23.125,y:-5})
  const result=applied(source,patches)
  assert.equal(result.ok,true)
  assert.equal(result.source,source.replace('.25,-4.50e-1','23.125,-5'))
  assert.equal(applied(result.source,result.inverse).source,source)
})
test('modifies only two numeric spans of cubic-control handle, exactly reversible',()=>{
  const patches=svgPathPointPatches(start,{id:'stroke',index:2,x:52.5,y:56.25})
  assert.equal(patches.length,2)
  const output=applied(start,patches)
  assert.equal(output.ok,true)
  assert.equal(output.source,start.replace('50,60','52.5,56.25'))
  assert.equal(applied(output.source,output.inverse).source,start)
})
test('path listing exposes editable nodes and ignores fake comments',()=>{
  const models=listSvgPathModels(start)
  assert.equal(models.length,1)
  assert.equal(models[0].id,'stroke')
  assert.equal(models[0].editable,true)
  assert.equal(models[0].points[2].x,50)
  assert.equal(models[0].points[2].link.y,80)
})
test('multiple subpaths and closepaths require explicit M',()=>{
  assert.equal(parseEditablePath('M0 0 L10 0 Z M20 20 L25 25').length,4)
  assert.throws(()=>parseEditablePath('M0 0 Z L2 3'),{code:'unsupported-path'})
})
test('unsupported/implicit SVG path formats are rejected rather than coerced',()=>{
  for(const d of ['m0 0 l5 5','M0 0 10 10','M0 0 H20','M0 0 A20 20 0 0 1 30 30',
                   'M0 0 S1 2 3 4','M0 0 T5 6','M0 0 C 1 2 3 4 5',
                   'M0 0 L1 2 3 4','M0 0 Z Z','L0 0','M0 0 rubbish']){
    assert.throws(()=>parseEditablePath(d),{code:'unsupported-path'},d)
  }
})
test('bad point index and out-of-range numbers fail without any source modification',()=>{
  for(const options of [{index:99,x:1,y:2},{index:-1,x:1,y:2},
                        {index:0,x:Infinity,y:3},{index:0,x:1e7,y:2}]){
    assert.throws(()=>svgPathPointPatches(start,{id:'stroke',...options}))
  }
})
test('a nested path or transformed root is rejected by the source mapper',()=>{
  const nested='<svg viewBox="0 0 100 100"><g><path id="p" d="M0 0 L10 10"/></g></svg>'
  const transformed='<svg viewBox="0 0 100 100"><path id="p" d="M0 0 L10 10" transform="translate(5)"/></svg>'
  const malformed='<svg viewBox="0 0 100 100"><path id="p" d="M0 0 L10 10"></svg>'
  for(const text of [nested,transformed,malformed]){
    assert.equal(listSvgPathModels(text)[0].editable,false)
    assert.throws(()=>svgPathPointPatches(text,{id:'p',index:0,x:5,y:4}))
  }
})
test('disallows script, handlers, foreignObject, duplicate IDs and missing d',()=>{
  const cases=[
    '<svg viewBox="0 0 100 100"><path id="p" d="M1 1" onload="evil()"/></svg>',
    '<svg viewBox="0 0 100 100"><path id="p" d="M1 1"/><script>evil()</script></svg>',
    '<svg viewBox="0 0 100 100"><path id="p" d="M1 1"/><foreignObject/></svg>',
    '<svg viewBox="0 0 100 100"><path id="p"/></svg>',
    '<svg viewBox="0 0 100 100"><path id="p" d="M1 1"/><path id="p" d="M2 2"/></svg>',
  ]
  for(const text of cases)assert.throws(()=>svgPathPointPatches(text,{id:'p',index:0,x:3,y:4}))
})
test('enforces path limits and refuses unknown SVG shape IDs',()=>{
  assert.throws(()=>parseEditablePath('M0 0 '+'L1 1 '.repeat(150)),{code:'unsupported-path'})
  assert.throws(()=>svgPathPointPatches(start,{id:'ghost',index:0,x:0,y:0}),{code:'unknown-node'})
})

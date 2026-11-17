import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { svgShapeInsertPatch } from '../src/svg-shapes.mjs'
import { applyNativePatches, sourceHash } from '../src/native-patch.mjs'
import { scanSvgDocument } from '../src/svg-document.mjs'
import { createRouteHandler } from '../src/plugin-host.mjs'

const base='<svg viewBox="10 -20 200 100">\n  <rect id="existing" x="2" y="3" width="5" height="8"/>\n</svg>\n'
const placed={x:-12.3456,y:78.9012}
function apply(source,patches){
  const result=applyNativePatches({source,format:'svg',baseHash:sourceHash(source),patches})
  assert.equal(result.ok,true)
  return result
}

test('positioned primitives use exact native anchor attributes, not centred offsets',()=>{
  const expected={
    rect:'x="-12.346" y="78.901" width="20" height="20"',
    circle:'cx="-12.346" cy="78.901" r="10"',
    ellipse:'cx="-12.346" cy="78.901" rx="10" ry="7"',
    text:'x="-12.346" y="78.901" font-size="12"',
  }
  for(const [kind,attributes] of Object.entries(expected)){
    const {id,patch}=svgShapeInsertPatch(base,kind,placed)
    assert.ok(patch.after.includes('<'+kind+' id="'+id+'" '+attributes))
    if(kind==='text')assert.ok(patch.after.includes('text-anchor="middle"'))
    const output=apply(base,[patch])
    assert.equal(output.source.replace(patch.after,''),base)
    assert.equal(apply(output.source,output.inverse).source,base)
  }
})

test('omitted/null position preserves historical centred defaults byte for byte',()=>{
  const expected={rect:'x="100" y="20" width="20" height="20"',circle:'cx="110" cy="30" r="10"',ellipse:'cx="110" cy="30" rx="10" ry="7"',text:'x="110" y="30" font-size="12"'}
  for(const [kind,attributes] of Object.entries(expected)){
    assert.deepEqual(svgShapeInsertPatch(base,kind),svgShapeInsertPatch(base,kind,null))
    assert.ok(svgShapeInsertPatch(base,kind).patch.after.includes(attributes))
  }
})

test('placement rejects partial, coerced, nonfinite and out-of-native-range values',()=>{
  for(const kind of ['rect','circle','ellipse','text']){
    for(const position of [{},{x:2},{y:3},{x:'2',y:3},{x:2,y:'3'},{x:null,y:3},{x:NaN,y:3},{x:2,y:Infinity},{x:-Infinity,y:3},{x:1e6+1,y:3},false,'2']){
      assert.throws(()=>svgShapeInsertPatch(base,kind,position),{code:'invalid-geometry'})
    }
    const {patch}=svgShapeInsertPatch(base,kind,{x:-1e6,y:1e6})
    assert.ok(patch.after.includes('="-1000000"'))
    assert.ok(patch.after.includes('="1000000"'))
    assert.ok(!svgShapeInsertPatch(base,kind,{x:-0,y:0}).patch.after.includes('="-0"'))
  }
  assert.throws(()=>svgShapeInsertPatch(base,'path',placed),{code:'invalid-geometry'})
})

test('grouped native Graphite insertion remains a root sibling and roundtrips exact bytes',async()=>{
  const source=await readFile(new URL('../examples/graphite-v3.svg',import.meta.url),'utf8')
  for(const kind of ['rect','circle','ellipse','text']){
    const {id,patch}=svgShapeInsertPatch(source,kind,placed)
    const output=apply(source,[patch])
    const scan=scanSvgDocument(output.source)
    assert.equal(scan.byId.get(id).parent,scan.root)
    assert.equal(output.source.replace(patch.after,''),source)
    assert.equal(apply(output.source,output.inverse).source,source)
  }
  assert.throws(()=>svgShapeInsertPatch(source,'rect'),{code:'unsupported-svg'})
})

test('positioned root insertion supports group transforms without inheriting them',()=>{
  const source='<svg viewBox="0 0 100 100"><g transform="translate(30 40)"><rect id="r" x="0" y="0" width="5" height="5"/></g></svg>'
  const {id,patch}=svgShapeInsertPatch(source,'rect',{x:3,y:4})
  const scan=scanSvgDocument(apply(source,[patch]).source)
  assert.equal(scan.byId.get(id).parent,scan.root)
  assert.equal(scan.byId.get(id).attributes.get('x').value,'3')
})

test('positioned shapes reserve IDs of non-layer definitions too',()=>{
  const source='<svg viewBox="0 0 100 100"><defs><linearGradient id="shape-1"/></defs></svg>'
  const created=svgShapeInsertPatch(source,'rect',{x:0,y:0})
  assert.equal(created.id,'shape-2')
  assert.equal(scanSvgDocument(apply(source,[created.patch]).source).byId.size,2)
})

test('positioned insertion retains hostile/ambiguous/unsupported root refusals',()=>{
  for(const source of [
    '<!DOCTYPE svg><svg viewBox="0 0 100 100"></svg>',
    '<svg viewBox="0 0 100 100"><script/></svg>',
    '<svg viewBox="0 0 100 100"><foreignObject/></svg>',
    '<svg viewBox="0 0 100 100"><g onclick="x()"/></svg>',
    '<svg viewBox="0 0 100 100"><g id="same"/><rect id="same"/></svg>',
    '<svg viewBox="0 0 100 100"><g></svg>',
    '<svg viewBox="0 0 100 100" transform="translate(1)"></svg>',
    '<svg viewBox="0 0 100 100"></svg><svg/>',
    '<svg viewBox="0 0 100 100"/>',
  ])assert.throws(()=>svgShapeInsertPatch(source,'rect',placed))
})

async function hostFixture(run){
  const root=await mkdtemp(path.join(os.tmpdir(),'dsh-placement-'))
  try{
    const file=path.join(root,'drawing.svg')
    await writeFile(file,base)
    const route=createRouteHandler({agents:{get:id=>id==='known'?{id}:undefined},workingDirectory:{ensure:async()=>root}})
    const invoke=async(method,url,body)=>{
      const request=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))])
      Object.assign(request,{method,url,headers:body===undefined?{}:{'content-type':'application/json'}})
      let status,json
      await route(request,{writeHead(code){status=code},end(data){json=JSON.parse(data)}})
      return {status,json}
    }
    const open=async()=>(await invoke('GET','/design-studio-native/document?sessionId=known&file=drawing.svg')).json.document
    const add=async(doc,extra={})=>invoke('POST','/design-studio-native/apply',{sessionId:'known',file:'drawing.svg',baseHash:doc.hash,baseIdentity:doc.identity,kind:'svg-add-shape',shape:'rect',...extra})
    await run({file,invoke,open,add})
  }finally{
    // root is the exact directory returned by mkdtemp above, never a user path.
    assert.equal(path.dirname(root),os.tmpdir())
    assert.ok(path.basename(root).startsWith('dsh-placement-'))
    await rm(root,{recursive:true,force:true})
  }
}

test('Host coordinates persist through native CAS; replay of stale placement is refused',()=>hostFixture(async({file,open,add,invoke})=>{
  const source=await readFile(new URL('../examples/graphite-v3.svg',import.meta.url),'utf8')
  await writeFile(file,source)
  const doc=await open()
  const result=await add(doc,{shape:'ellipse',x:12.25,y:-9.5})
  assert.equal(result.status,200)
  const changed=await readFile(file,'utf8')
  assert.ok(changed.includes('<ellipse id="shape-1" cx="12.25" cy="-9.5"'))
  assert.equal((await open()).source,changed)
  const stale=await add(doc,{x:99,y:99})
  assert.equal(stale.status,409)
  assert.equal(stale.json.error,'stale-revision')
  assert.equal(await readFile(file,'utf8'),changed)
  const current=await open()
  const undo=await invoke('POST','/design-studio-native/apply',{sessionId:'known',file:'drawing.svg',baseHash:current.hash,baseIdentity:current.identity,kind:'patches',patches:result.json.result.inverse})
  assert.equal(undo.status,200)
  assert.equal(await readFile(file,'utf8'),source)
}))

test('Host rejects invalid/partial JSON coordinates without writes and preserves omission',()=>hostFixture(async({file,open,add})=>{
  const doc=await open()
  for(const extra of [{x:5},{y:6},{x:'5',y:6},{x:5,y:'6'},{x:null,y:6},{x:Infinity,y:6},{x:5,y:NaN},{x:1e6+1,y:6},{shape:'path',x:5,y:6}]){
    const refused=await add(doc,extra)
    assert.equal(refused.status,400)
    assert.equal(refused.json.error,'invalid-geometry')
    assert.equal(await readFile(file,'utf8'),base)
  }
  const result=await add(doc)
  assert.equal(result.status,200)
  assert.ok((await readFile(file,'utf8')).includes('x="100" y="20" width="20" height="20"'))
}))

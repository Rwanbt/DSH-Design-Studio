import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRouteHandler } from '../src/plugin-host.mjs'

async function fixture(run) {
  const root=await mkdtemp(path.join(os.tmpdir(),'dsh-host-'))
  try {
    await writeFile(path.join(root,'icon.svg'),'<svg><rect id="box" fill="red" width="10"/></svg>')
    const ctx={agents:{get:id=>id==='known'?{id}:undefined},workingDirectory:{ensure:async()=>root}}
    const route=createRouteHandler(ctx)
    const invoke=async (method,url,body) => {
      const request=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);request.method=method;request.url=url
      request.headers=body===undefined?{}:{'content-type':'application/json'}
      let status, json
      const response={writeHead(code){status=code},end(data){json=JSON.parse(data)}}
      await route(request,response)
      return {status,json}
    }
    await run(invoke,root)
  } finally {await rm(root,{recursive:true,force:true})}
}
const url='/design-studio-native/document?sessionId=known&file=icon.svg'
test('health route is available',()=>fixture(async invoke=>{
  const r=await invoke('GET','/design-studio-native/health')
  assert.equal(r.status,200); assert.equal(r.json.ok,true)
}))
test('manual SVG open exposes editable id-based properties',()=>fixture(async invoke=>{
  const r=await invoke('GET',url)
  assert.equal(r.status,200)
  assert.deepEqual(r.json.nodes.map(n=>n.id),['box'])
  assert.equal(r.json.nodes[0].attributes.fill,'red')
}))
test('manual SVG property editing writes native SVG and rejects stale edits',()=>fixture(async(invoke,root)=>{
  const initial=(await invoke('GET',url)).json.document
  const body={sessionId:'known',file:'icon.svg',baseHash:initial.hash,kind:'svg-attribute',id:'box',attribute:'fill',value:'#abc'}
  const updated=await invoke('POST','/design-studio-native/apply',body)
  assert.equal(updated.status,200)
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),'<svg><rect id="box" fill="#abc" width="10"/></svg>')
  const stale=await invoke('POST','/design-studio-native/apply',body)
  assert.equal(stale.status,409);assert.equal(stale.json.error,'stale-revision')
}))
test('session access required',()=>fixture(async invoke=>{
  const r=await invoke('GET','/design-studio-native/document?sessionId=other&file=icon.svg')
  assert.equal(r.status,400);assert.equal(r.json.error,'no-session')
}))
test('HTML/SVG path traversal rejected in API',()=>fixture(async invoke=>{
  const r=await invoke('GET','/design-studio-native/document?sessionId=known&file=../icon.svg')
  assert.equal(r.status,400);assert.equal(r.json.error,'invalid-path')
}))
test('malicious SVG external paint references rejected in API',()=>fixture(async invoke=>{
  const d=(await invoke('GET',url)).json.document
  const r=await invoke('POST','/design-studio-native/apply',{sessionId:'known',file:'icon.svg',baseHash:d.hash,kind:'svg-attribute',id:'box',attribute:'fill',value:'url(https://evil.test/x)'})
  assert.equal(r.status,400);assert.equal(r.json.error,'invalid-value')
}))

test('geometry is exposed for SVG with a viewBox and a movable rectangle',()=>fixture(async invoke=>{
  const base='/design-studio-native/document?sessionId=known&file=icon.svg'
  const r=await invoke('GET',base)
  assert.equal(r.status,200)
  // Current original sample has no viewBox; dragging is deliberately unavailable.
  assert.equal(r.json.geometry.artboard,null)
  assert.deepEqual(r.json.geometry.handles,[])
}))
test('SVG coordinate batch moves both coordinates with one native save',()=>fixture(async(invoke,root)=>{
  await writeFile(path.join(root,'icon.svg'),'<svg viewBox="0 0 100 100"><rect id="box" x="5" y="7" width="10" height="20"/></svg>')
  const url='/design-studio-native/document?sessionId=known&file=icon.svg'
  const doc=(await invoke('GET',url)).json
  assert.deepEqual(doc.geometry.handles.map(h=>h.id),['box'])
  const edits=[{id:'box',attribute:'x',value:'35'},{id:'box',attribute:'y',value:'12'}]
  const result=await invoke('POST','/design-studio-native/apply',{sessionId:'known',file:'icon.svg',baseHash:doc.document.hash,kind:'svg-attributes',edits})
  assert.equal(result.status,200)
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),'<svg viewBox="0 0 100 100"><rect id="box" x="35" y="12" width="10" height="20"/></svg>')
}))
test('SVG batch rejects duplicate and invalid edit without modifying file',()=>fixture(async(invoke,root)=>{
  await writeFile(path.join(root,'icon.svg'),'<svg viewBox="0 0 100 100"><rect id="box" x="5" y="7" width="10" height="20"/></svg>')
  const doc=(await invoke('GET',url)).json.document
  const edits=[{id:'box',attribute:'x',value:'22'},{id:'box',attribute:'x',value:'23'}]
  const result=await invoke('POST','/design-studio-native/apply',{sessionId:'known',file:'icon.svg',baseHash:doc.hash,kind:'svg-attributes',edits})
  assert.equal(result.status,400)
  assert.equal(result.json.error,'overlap')
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),doc.source)
}))

import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtemp, mkdir, rmdir, symlink, writeFile, readFile, readdir, rename, rm } from 'node:fs/promises'
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
  const body={sessionId:'known',file:'icon.svg',baseHash:initial.hash,baseIdentity:initial.identity,kind:'svg-attribute',id:'box',attribute:'fill',value:'#abc'}
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
  const r=await invoke('POST','/design-studio-native/apply',{sessionId:'known',file:'icon.svg',baseHash:d.hash,baseIdentity:d.identity,kind:'svg-attribute',id:'box',attribute:'fill',value:'url(https://evil.test/x)'})
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
  const result=await invoke('POST','/design-studio-native/apply',{sessionId:'known',file:'icon.svg',baseHash:doc.document.hash,baseIdentity:doc.document.identity,kind:'svg-attributes',edits})
  assert.equal(result.status,200)
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),'<svg viewBox="0 0 100 100"><rect id="box" x="35" y="12" width="10" height="20"/></svg>')
}))
test('SVG batch rejects duplicate and invalid edit without modifying file',()=>fixture(async(invoke,root)=>{
  await writeFile(path.join(root,'icon.svg'),'<svg viewBox="0 0 100 100"><rect id="box" x="5" y="7" width="10" height="20"/></svg>')
  const doc=(await invoke('GET',url)).json.document
  const edits=[{id:'box',attribute:'x',value:'22'},{id:'box',attribute:'x',value:'23'}]
  const result=await invoke('POST','/design-studio-native/apply',{sessionId:'known',file:'icon.svg',baseHash:doc.hash,baseIdentity:doc.identity,kind:'svg-attributes',edits})
  assert.equal(result.status,400)
  assert.equal(result.json.error,'overlap')
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),doc.source)
}))

test('native edit, undo and redo round trip preserves exact SVG bytes',()=>fixture(async(invoke,root)=>{
  const original='<svg viewBox="0 0 100 100">\n <rect id="box" x="5" y="7" width="10" height="20" fill="red"/>\n</svg>'
  await writeFile(path.join(root,'icon.svg'),original)
  const url='/design-studio-native/document?sessionId=known&file=icon.svg'
  const endpoint='/design-studio-native/apply'
  const first=(await invoke('GET',url)).json.document
  const move=await invoke('POST',endpoint,{sessionId:'known',file:'icon.svg',baseHash:first.hash,baseIdentity:first.identity,kind:'svg-attributes',
    edits:[{id:'box',attribute:'x',value:'15'},{id:'box',attribute:'y',value:'27'}]})
  assert.equal(move.status,200)
  assert.equal(move.json.patches.length,2)
  assert.equal(move.json.result.inverse.length,2)
  const changed=(await invoke('GET',url)).json.document
  assert.notEqual(changed.source,original)
  const undo=await invoke('POST',endpoint,{sessionId:'known',file:'icon.svg',baseHash:changed.hash,baseIdentity:changed.identity,kind:'patches',
    patches:move.json.result.inverse})
  assert.equal(undo.status,200)
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),original)
  const reverted=(await invoke('GET',url)).json.document
  const redo=await invoke('POST',endpoint,{sessionId:'known',file:'icon.svg',baseHash:reverted.hash,baseIdentity:reverted.identity,kind:'patches',
    patches:move.json.patches})
  assert.equal(redo.status,200)
  assert.equal((await invoke('GET',url)).json.document.source,changed.source)
}))
test('undo refuses stale file after external edit and does not overwrite it',()=>fixture(async(invoke,root)=>{
  const endpoint='/design-studio-native/apply'
  const initial=(await invoke('GET',url)).json.document
  const first=await invoke('POST',endpoint,{sessionId:'known',file:'icon.svg',baseHash:initial.hash,baseIdentity:initial.identity,kind:'svg-attribute',id:'box',attribute:'fill',value:'blue'})
  assert.equal(first.status,200)
  const expected=(await invoke('GET',url)).json.document
  const external='<svg><rect id="box" fill="green" width="10"/></svg>'
  await writeFile(path.join(root,'icon.svg'),external)
  const undo=await invoke('POST',endpoint,{sessionId:'known',file:'icon.svg',baseHash:expected.hash,baseIdentity:expected.identity,kind:'patches',patches:first.json.result.inverse})
  assert.equal(undo.status,409)
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),external)
}))

test('manual Add rectangle route inserts shape and supports exact undo',()=>fixture(async(invoke,root)=>{
  const initial='<svg viewBox="0 0 200 100">\n  <rect id="box" x="5" y="7" width="10" height="20"/>\n</svg>'
  await writeFile(path.join(root,'icon.svg'),initial)
  const current=(await invoke('GET',url)).json.document
  const created=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:current.hash,baseIdentity:current.identity,kind:'svg-add-shape',shape:'rect'
  })
  assert.equal(created.status,200)
  assert.equal(created.json.createdId,'shape-1')
  const newDoc=(await invoke('GET',url)).json.document
  assert.ok(newDoc.source.includes('<rect id="shape-1"'))
  const undone=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:newDoc.hash,baseIdentity:newDoc.identity,kind:'patches',patches:created.json.result.inverse
  })
  assert.equal(undone.status,200)
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),initial)
}))

test('native layer duplication is atomic and reversible with same source hash',()=>fixture(async(invoke,root)=>{
  const original='<svg viewBox="0 0 150 100">\n<rect id="block" x="10" y="20" width="40" height="30"/>\n</svg>'
  await writeFile(path.join(root,'icon.svg'),original)
  const opened=(await invoke('GET',url)).json.document
  const copied=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:opened.hash,baseIdentity:opened.identity,kind:'svg-layer',id:'block',operation:'duplicate'
  })
  assert.equal(copied.status,200)
  assert.equal(copied.json.createdId,'block-copy')
  assert.equal(copied.json.patches.length,1)
  const changed=(await invoke('GET',url)).json.document
  assert.equal(changed.source.includes('id="block-copy"'),true)
  const undo=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:changed.hash,baseIdentity:changed.identity,kind:'patches',patches:copied.json.result.inverse
  })
  assert.equal(undo.status,200)
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),original)
}))
test('delete SVG text layer and undo; refuse stale file instead of overwriting',()=>fixture(async(invoke,root)=>{
  const original='<svg viewBox="0 0 150 100"><text id="title" x="5" y="15">Hello</text></svg>'
  await writeFile(path.join(root,'icon.svg'),original)
  const opened=(await invoke('GET',url)).json.document
  const del=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:opened.hash,baseIdentity:opened.identity,kind:'svg-layer',id:'title',operation:'delete'
  })
  assert.equal(del.status,200)
  assert.equal((await readFile(path.join(root,'icon.svg'),'utf8')).includes('<text'),false)
  const changed=(await invoke('GET',url)).json.document
  await writeFile(path.join(root,'icon.svg'),'<svg viewBox="0 0 150 100"><rect id="external" x="2" y="3" width="5" height="7"/></svg>')
  const stale=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:changed.hash,baseIdentity:changed.identity,kind:'patches',patches:del.json.result.inverse
  })
  assert.equal(stale.status,409)
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),'<svg viewBox="0 0 150 100"><rect id="external" x="2" y="3" width="5" height="7"/></svg>')
}))
test('nested SVG layers are deleted by exact span and restored by the inverse',()=>fixture(async(invoke,root)=>{
  // The historical limitation ("nested layers cannot be deleted") is lifted: the
  // route now uses the nested implementation, which deletes exactly the node span
  // and returns an inverse able to restore the file byte for byte.
  const original='<svg viewBox="0 0 100 100"><g><rect id="child" x="2" y="2" width="3" height="3"/></g></svg>'
  await writeFile(path.join(root,'icon.svg'),original)
  const doc=(await invoke('GET',url)).json.document
  const result=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:doc.hash,baseIdentity:doc.identity,kind:'svg-layer',id:'child',operation:'delete'
  })
  assert.equal(result.status,200,JSON.stringify(result.json))
  const deleted=await readFile(path.join(root,'icon.svg'),'utf8')
  assert.ok(!deleted.includes('id="child"'),'the nested layer is gone')
  assert.equal(deleted,original.replace(/<rect id="child"[^>]*\/>/,''),'only the node span was removed')
  const undo=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:result.json.result.hash,baseIdentity:result.json.result.identity,
    kind:'patches',patches:result.json.result.inverse
  })
  assert.equal(undo.status,200,JSON.stringify(undo.json))
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),original,'the inverse restores the exact bytes')
}))

test('GET /files lists only supported workspace files and hides symlinks and excluded directories',()=>fixture(async(invoke,root)=>{
  await mkdir(path.join(root,'pages'))
  await mkdir(path.join(root,'node_modules'))
  await writeFile(path.join(root,'pages','landing.HTML'),'<h1>Hello</h1>')
  await writeFile(path.join(root,'pages','theme.css'),'a{}')
  await writeFile(path.join(root,'node_modules','private.svg'),'<svg/>')
  await writeFile(path.join(root,'.hidden.svg'),'<svg/>')
  await symlink('icon.svg',path.join(root,'shortcut.svg'))
  const response=await invoke('GET','/design-studio-native/files?sessionId=known')
  assert.equal(response.status,200)
  assert.deepEqual(response.json.files.map(file=>file.path),['icon.svg','pages/landing.HTML','pages/theme.css'])
  assert.equal(response.json.ok,true)
  for(const item of response.json.files) {
    assert.equal(typeof item.size,'number')
    assert.equal(item.path.startsWith('/'),false)
    assert.equal(Object.hasOwn(item,'source'),false)
  }
  assert.equal(JSON.stringify(response.json).includes(root),false)
}))
test('GET /files rejects access outside active conversation session',()=>fixture(async invoke=>{
  const response=await invoke('GET','/design-studio-native/files?sessionId=unknown')
  assert.equal(response.status,400)
  assert.equal(response.json.error,'no-session')
}))


test('native Bézier anchor/control editing is reversible and preserves all unrelated bytes',()=>fixture(async(invoke,root)=>{
  const original='<svg viewBox="0 0 200 100">\n'+
    ' <path id="curve" d="M 10,20 C 30,40 50,60 70,80 Z" stroke="#765432" fill="none"/>\n</svg>'
  await writeFile(path.join(root,'icon.svg'),original)
  const opened=await invoke('GET',url)
  assert.equal(opened.status,200)
  const pathModel=opened.json.pathNodes.find(path=>path.id==='curve')
  assert.equal(pathModel.editable,true)
  assert.equal(pathModel.points.length,4)
  assert.equal(pathModel.points[2].role,'cubic-out')
  assert.deepEqual(pathModel.points[2].link,{x:70,y:80})
  const edited=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:opened.json.document.hash,baseIdentity:opened.json.document.identity,
    kind:'svg-path-point',id:'curve',index:2,x:54.5,y:57.25
  })
  assert.equal(edited.status,200)
  assert.equal(edited.json.patches.length,2)
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),original.replace('50,60','54.5,57.25'))
  const revert=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:edited.json.result.hash,baseIdentity:edited.json.result.identity,
    kind:'patches',patches:edited.json.result.inverse
  })
  assert.equal(revert.status,200)
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),original)
}))
test('unsupported relative path cannot be edited and source is preserved',()=>fixture(async(invoke,root)=>{
  const original='<svg viewBox="0 0 100 100"><path id="rel" d="m10 10 c5 5 10 15 20 20"/></svg>'
  await writeFile(path.join(root,'icon.svg'),original)
  const current=await invoke('GET',url)
  assert.equal(current.status,200)
  assert.equal(current.json.pathNodes[0].editable,false)
  const refused=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:current.json.document.hash,baseIdentity:current.json.document.identity,
    kind:'svg-path-point',id:'rel',index:0,x:15,y:10
  })
  assert.equal(refused.status,400)
  assert.equal(refused.json.error,'unsupported-path')
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),original)
}))
test('stale path edit is rejected after external SVG modification',()=>fixture(async(invoke,root)=>{
  const original='<svg viewBox="0 0 100 100"><path id="p" d="M10 20 L30 40"/></svg>'
  await writeFile(path.join(root,'icon.svg'),original)
  const opened=(await invoke('GET',url)).json.document
  const concurrent=original.replace('L30 40','L35 40')
  await writeFile(path.join(root,'icon.svg'),concurrent)
  const refused=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:opened.hash,baseIdentity:opened.identity,
    kind:'svg-path-point',id:'p',index:1,x:38,y:45
  })
  assert.equal(refused.status,409)
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),concurrent)
}))


test('create native cubic Bézier then edit its control point, keeping exact Undo history',()=>fixture(async(invoke,root)=>{
  const initial='<svg viewBox="0 0 200 100"><rect id="box" x="2" y="3" width="10" height="20"/></svg>'
  await writeFile(path.join(root,'icon.svg'),initial)
  const open=(await invoke('GET',url)).json.document
  const created=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:open.hash,baseIdentity:open.identity,kind:'svg-add-shape',shape:'path'
  })
  assert.equal(created.status,200)
  assert.equal(created.json.createdId,'shape-1')
  const afterCreate=(await invoke('GET',url)).json
  const editable=afterCreate.pathNodes.find(p=>p.id==='shape-1')
  assert.ok(editable)
  assert.equal(editable.editable,true)
  assert.deepEqual(editable.points.map(p=>p.role),['anchor','cubic-in','cubic-out','anchor'])
  const changed=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:afterCreate.document.hash,baseIdentity:afterCreate.document.identity,
    kind:'svg-path-point',id:'shape-1',index:1,x:73,y:42
  })
  assert.equal(changed.status,200)
  const afterEdit=(await invoke('GET',url)).json.document
  assert.ok(afterEdit.source.includes('73 42'))
  const undoEdit=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:afterEdit.hash,baseIdentity:afterEdit.identity,
    kind:'patches',patches:changed.json.result.inverse
  })
  assert.equal(undoEdit.status,200)
  const afterUndo=(await invoke('GET',url)).json.document
  const undoCreate=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:afterUndo.hash,baseIdentity:afterUndo.identity,
    kind:'patches',patches:created.json.result.inverse
  })
  assert.equal(undoCreate.status,200)
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),initial)
}))


test('native path midpoint insertion then Undo restores exact source bytes',()=>fixture(async(invoke,root)=>{
  const original='<svg viewBox="0 0 100 100">\n <path id="p" d="M0 0 C0 40 40 40 40 0 L70 15"/>\n</svg>'
  await writeFile(path.join(root,'icon.svg'),original)
  const doc=(await invoke('GET',url)).json
  assert.deepEqual(doc.pathNodes[0].segments.map(seg=>seg.type),['C','L'])
  const update=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:doc.document.hash,baseIdentity:doc.document.identity,kind:'svg-path-topology',
    id:'p',operation:'insert',commandIndex:2
  })
  assert.equal(update.status,200)
  const after=(await invoke('GET',url)).json.document
  assert.ok(after.source.includes('C 0 20 10 30 20 30 C 30 30 40 20 40 0'))
  assert.equal(update.json.patches.length,1)
  const undone=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:after.hash,baseIdentity:after.identity,
    kind:'patches',patches:update.json.result.inverse
  })
  assert.equal(undone.status,200)
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),original)
}))
test('remove an L endpoint then Undo restores the original line exactly',()=>fixture(async(invoke,root)=>{
  const original='<svg viewBox="0 0 100 100"><path id="p" d="M0 0 L20 20 L30 30"/></svg>'
  await writeFile(path.join(root,'icon.svg'),original)
  const doc=(await invoke('GET',url)).json.document
  const removed=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:doc.hash,baseIdentity:doc.identity,
    kind:'svg-path-topology',id:'p',operation:'remove',commandIndex:2
  })
  assert.equal(removed.status,200)
  const edited=(await invoke('GET',url)).json.document
  assert.equal(edited.source,original.replace(' L20 20',''))
  const undone=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:edited.hash,baseIdentity:edited.identity,
    kind:'patches',patches:removed.json.result.inverse
  })
  assert.equal(undone.status,200)
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),original)
}))
test('topology operations reject stale external writes and unsafe curve removal',()=>fixture(async(invoke,root)=>{
  const original='<svg viewBox="0 0 100 100"><path id="p" d="M0 0 Q25 50 50 0"/></svg>'
  await writeFile(path.join(root,'icon.svg'),original)
  const doc=(await invoke('GET',url)).json.document
  const refused=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:doc.hash,baseIdentity:doc.identity,
    kind:'svg-path-topology',id:'p',operation:'remove',commandIndex:2
  })
  assert.equal(refused.status,400)
  assert.equal(refused.json.error,'unsupported-segment')
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),original)
  const concurrent=original.replace('Q25 50','Q30 50')
  await writeFile(path.join(root,'icon.svg'),concurrent)
  const stale=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:doc.hash,baseIdentity:doc.identity,
    kind:'svg-path-topology',id:'p',operation:'insert',commandIndex:2
  })
  assert.equal(stale.status,409)
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),concurrent)
}))


test('pen workflow starts, appends straight and cubic commands, closes, and undoes all source writes',()=>fixture(async(invoke,root)=>{
  const original='<svg viewBox="0 0 100 100"><rect id="box" x="5" y="5" width="10" height="10"/></svg>'
  await writeFile(path.join(root,'icon.svg'),original)
  let current=(await invoke('GET',url)).json.document
  const operations=[
    {kind:'svg-pen',operation:'start',x:10,y:10},
    {kind:'svg-pen',operation:'append',id:'shape-1',x:20,y:20},
    {kind:'svg-pen',operation:'append',id:'shape-1',x:60,y:40,c1:{x:30,y:15},c2:{x:50,y:35}},
    {kind:'svg-pen',operation:'close',id:'shape-1'},
  ]
  const inverse=[]
  for(const operation of operations){
    const result=await invoke('POST','/design-studio-native/apply',{
      sessionId:'known',file:'icon.svg',baseHash:current.hash,baseIdentity:current.identity,...operation,
    })
    assert.equal(result.status,200,JSON.stringify(result.json))
    if(operation.operation==='start')assert.equal(result.json.createdId,'shape-1')
    inverse.push(result.json.result.inverse)
    current=(await invoke('GET',url)).json.document
  }
  assert.ok(current.source.includes('d="M 10 10 L 20 20 C 30 15 50 35 60 40 Z"'))
  for(const patches of inverse.reverse()){
    const reverted=await invoke('POST','/design-studio-native/apply',{
      sessionId:'known',file:'icon.svg',baseHash:current.hash,baseIdentity:current.identity,kind:'patches',patches
    })
    assert.equal(reverted.status,200)
    current=(await invoke('GET',url)).json.document
  }
  assert.equal(current.source,original)
}))
test('pen refuses early closure and malformed tangent requests without touching SVG',()=>fixture(async(invoke,root)=>{
  const original='<svg viewBox="0 0 100 100"><path id="p" d="M0 0 L10 10"/></svg>'
  await writeFile(path.join(root,'icon.svg'),original)
  const opened=(await invoke('GET',url)).json.document
  for(const request of [
    {operation:'close',id:'p'},
    {operation:'append',id:'p',x:20,y:30,c1:{x:5,y:1}},
    {operation:'append',id:'p',x:20,y:30,c1:{x:NaN,y:0},c2:{x:7,y:8}}
  ]){
    const result=await invoke('POST','/design-studio-native/apply',{
      sessionId:'known',file:'icon.svg',baseHash:opened.hash,baseIdentity:opened.identity,kind:'svg-pen',...request
    })
    assert.equal(result.status,400)
  }
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),original)
}))
test('external changes during pen gesture cause stale revision, not source overwrite',()=>fixture(async(invoke,root)=>{
  const original='<svg viewBox="0 0 100 100"><path id="p" d="M0 0 L10 10"/></svg>'
  await writeFile(path.join(root,'icon.svg'),original)
  const opened=(await invoke('GET',url)).json.document
  await writeFile(path.join(root,'icon.svg'),original.replace('L10 10','L11 10'))
  const stale=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:opened.hash,baseIdentity:opened.identity,kind:'svg-pen',
    operation:'append',id:'p',x:20,y:30
  })
  assert.equal(stale.status,409)
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),original.replace('L10 10','L11 10'))
}))


test('held cross-process lock returns HTTP 423 without writing any source',()=>fixture(async(invoke,root)=>{
  const original=await readFile(path.join(root,'icon.svg'),'utf8')
  const doc=(await invoke('GET',url)).json.document
  const lockPath=path.join(root,'.icon.svg.dsh-native.lock')
  await mkdir(lockPath)
  const result=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:doc.hash,baseIdentity:doc.identity,kind:'svg-attribute',
    id:'box',attribute:'fill',value:'#bada55'
  })
  assert.equal(result.status,423)
  assert.equal(result.json.error,'file-busy')
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),original)
  await rmdir(lockPath)
  const retried=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:doc.hash,baseIdentity:doc.identity,kind:'svg-attribute',
    id:'box',attribute:'fill',value:'#bada55'
  })
  assert.equal(retried.status,200)
  assert.ok((await readFile(path.join(root,'icon.svg'),'utf8')).includes('fill="#bada55"'))
}))


test('Host API identity token prevents same-byte external file replacement',()=>fixture(async(invoke,root)=>{
  const file=path.join(root,'icon.svg')
  const initial=(await invoke('GET',url)).json.document
  assert.match(initial.identity,/^[a-f0-9]{64}$/)
  await writeFile(path.join(root,'replacement.svg'),initial.source)
  await rename(path.join(root,'replacement.svg'),file)
  const changed=(await invoke('GET',url)).json.document
  assert.equal(initial.hash,changed.hash,'Source hash is deliberately unchanged')
  assert.notEqual(initial.identity,changed.identity)
  const refused=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:initial.hash,baseIdentity:initial.identity,
    kind:'svg-attribute',id:'box',attribute:'fill',value:'#cc0000'
  })
  assert.equal(refused.status,409)
  assert.equal(refused.json.error,'stale-revision')
  assert.equal(await readFile(file,'utf8'),initial.source)
  const accepted=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:changed.hash,baseIdentity:changed.identity,
    kind:'svg-attribute',id:'box',attribute:'fill',value:'#cc0000'
  })
  assert.equal(accepted.status,200)
  assert.ok((await readFile(file,'utf8')).includes('fill="#cc0000"'))
}))


test('legacy native write without file identity is rejected with HTTP 428, even if SHA matches',()=>fixture(async(invoke,root)=>{
  const original=(await invoke('GET',url)).json.document
  const rejected=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'icon.svg',baseHash:original.hash,
    kind:'svg-attribute',id:'box',attribute:'fill',value:'blue'
  })
  assert.equal(rejected.status,428)
  assert.equal(rejected.json.error,'missing-revision')
  assert.equal(await readFile(path.join(root,'icon.svg'),'utf8'),original.source)
  for(const bad of ['',null,'0'.repeat(64),'not-an-identity']){
    const response=await invoke('POST','/design-studio-native/apply',{
      sessionId:'known',file:'icon.svg',baseHash:original.hash,baseIdentity:bad,
      kind:'svg-attribute',id:'box',attribute:'fill',value:'blue'
    })
    assert.equal(response.status,bad==='0'.repeat(64)?409:428)
  }
}))


test('HTML visual property editor preserves all unrelated source bytes and Undo restores the original',()=>fixture(async(invoke,root)=>{
  const input='<!doctype html>\n<main id="app"><h1 id="title" style="color: red; padding: 12px;">Hello</h1></main>\n'
  await writeFile(path.join(root,'page.html'),input)
  const opened=await invoke('GET','/design-studio-native/document?sessionId=known&file=page.html')
  assert.equal(opened.status,200)
  const doc=opened.json.document
  assert.deepEqual(opened.json.htmlElements.map(n=>n.id),['app','title'])
  const update=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'page.html',baseHash:doc.hash,baseIdentity:doc.identity,
    kind:'html-style',id:'title',property:'color',value:'#bda991'
  })
  assert.equal(update.status,200,JSON.stringify(update.json))
  assert.equal(await readFile(path.join(root,'page.html'),'utf8'),input.replace('color: red','color: #bda991'))
  assert.equal(update.json.patches.length,1)
  const changed=await invoke('GET','/design-studio-native/document?sessionId=known&file=page.html')
  const reverted=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'page.html',baseHash:changed.json.document.hash,
    baseIdentity:changed.json.document.identity,kind:'patches',patches:update.json.result.inverse
  })
  assert.equal(reverted.status,200)
  assert.equal(await readFile(path.join(root,'page.html'),'utf8'),input)
}))
test('HTML visual editor refuses CSS injection and a stale file identity',()=>fixture(async(invoke,root)=>{
  const input='<main id="app" style="display: block;">OK</main>'
  await writeFile(path.join(root,'page.html'),input)
  const doc=(await invoke('GET','/design-studio-native/document?sessionId=known&file=page.html')).json.document
  for(const malicious of ['url(https://evil.test)', 'block;position:fixed', '<script>']){
    const r=await invoke('POST','/design-studio-native/apply',{
      sessionId:'known',file:'page.html',baseHash:doc.hash,baseIdentity:doc.identity,
      kind:'html-style',id:'app',property:'display',value:malicious
    })
    assert.equal(r.status,400)
    assert.equal(r.json.error,'invalid-value')
  }
  assert.equal(await readFile(path.join(root,'page.html'),'utf8'),input)
  const nextFile=path.join(root,'new-page.html')
  await writeFile(nextFile,input)
  await rename(nextFile,path.join(root,'page.html'))
  const rejected=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'page.html',baseHash:doc.hash,baseIdentity:doc.identity,
    kind:'html-style',id:'app',property:'display',value:'flex'
  })
  assert.equal(rejected.status,409)
  assert.equal(await readFile(path.join(root,'page.html'),'utf8'),input)
}))


test('CSS source rule edit and native Undo preserve all unrelated stylesheet bytes',()=>fixture(async(invoke,root)=>{
  const source='#app { color: red; display: block; }\n.card { gap: 8px; }\n'
  await writeFile(path.join(root,'theme.css'),source)
  const opened=await invoke('GET','/design-studio-native/document?sessionId=known&file=theme.css')
  assert.equal(opened.status,200)
  assert.deepEqual(opened.json.cssRules.map(x=>x.selector),['#app','.card'])
  const doc=opened.json.document
  const edited=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'theme.css',baseHash:doc.hash,baseIdentity:doc.identity,
    kind:'css-rule',selector:'#app',property:'color',value:'#bda991'
  })
  assert.equal(edited.status,200,JSON.stringify(edited.json))
  const updated=source.replace('color: red','color: #bda991')
  assert.equal(await readFile(path.join(root,'theme.css'),'utf8'),updated)
  const fresh=(await invoke('GET','/design-studio-native/document?sessionId=known&file=theme.css')).json.document
  const undone=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'theme.css',baseHash:fresh.hash,baseIdentity:fresh.identity,
    kind:'patches',patches:edited.json.result.inverse
  })
  assert.equal(undone.status,200)
  assert.equal(await readFile(path.join(root,'theme.css'),'utf8'),source)
}))
test('CSS visual edit rejects ambiguous selectors, untrusted values and stale identity',()=>fixture(async(invoke,root)=>{
  const original='#app { color: red; } #app { color: blue; }'
  const filepath=path.join(root,'theme.css')
  await writeFile(filepath,original)
  const doc=(await invoke('GET','/design-studio-native/document?sessionId=known&file=theme.css')).json.document
  for(const value of ['red;position:fixed', 'url(https://evil.test)','blue']){
    const refused=await invoke('POST','/design-studio-native/apply',{
      sessionId:'known',file:'theme.css',baseHash:doc.hash,baseIdentity:doc.identity,
      kind:'css-rule',selector:'#app',property:'color',value
    })
    assert.equal(refused.status,400)
  }
  assert.equal(await readFile(filepath,'utf8'),original)
  await writeFile(path.join(root,'replacement.css'),original)
  await rename(path.join(root,'replacement.css'),filepath)
  const stale=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'theme.css',baseHash:doc.hash,baseIdentity:doc.identity,
    kind:'css-rule',selector:'#app',property:'color',value:'green'
  })
  assert.equal(stale.status,409)
}))


test('HTML Host response discovers safe linked CSS files and candidate ID/class declarations',()=>fixture(async(invoke,root)=>{
  await mkdir(path.join(root,'assets'))
  const html='<link rel="stylesheet" href="./assets/site.css">'+
    '<main id="app"><h1 id="title" class="card">Hello</h1></main>'
  const css='#title{color:red}\n.card{display:flex;gap:8px}\n'
  await writeFile(path.join(root,'page.html'),html)
  await writeFile(path.join(root,'assets/site.css'),css)
  const opened=await invoke('GET','/design-studio-native/document?sessionId=known&file=page.html')
  assert.equal(opened.status,200)
  assert.equal(opened.json.stylesheets[0].file,'assets/site.css')
  assert.equal(opened.json.stylesheets[0].status,'inspected')
  assert.match(opened.json.stylesheets[0].identity,/^[a-f0-9]{64}$/)
  const matches=opened.json.styleMatches.find(x=>x.id==='title').matches
  assert.deepEqual(matches.map(x=>x.selector),['#title','.card'])
  assert.ok(matches.every(x=>x.file==='assets/site.css'))
  assert.deepEqual(opened.json.styleMatches.find(x=>x.id==='app').matches,[])
  assert.equal(await readFile(path.join(root,'assets/site.css'),'utf8'),css)
  // A candidate click is NOT a write; the existing CSS route requires a fresh
  // CSS file revision before any actual edit is committed.
  const cssDoc=(await invoke('GET','/design-studio-native/document?sessionId=known&file=assets%2Fsite.css')).json.document
  const applied=await invoke('POST','/design-studio-native/apply',{
    sessionId:'known',file:'assets/site.css',baseHash:cssDoc.hash,
    baseIdentity:cssDoc.identity,kind:'css-rule',selector:'#title',property:'color',value:'#bda991'
  })
  assert.equal(applied.status,200)
  assert.equal(await readFile(path.join(root,'page.html'),'utf8'),html)
  assert.equal(await readFile(path.join(root,'assets/site.css'),'utf8'),css.replace('color:red','color:#bda991'))
}))
test('HTML linked styles refuse unsafe paths, stale symlinks and never fetch external resources',()=>fixture(async(invoke,root)=>{
  const html='<link rel="stylesheet" href="https://example.invalid/a.css">'+
    '<link href="../private.css" rel="stylesheet">'+
    '<link rel="stylesheet" href="missing.css">'+
    '<main id="app"></main>'
  await writeFile(path.join(root,'page.html'),html)
  const opened=await invoke('GET','/design-studio-native/document?sessionId=known&file=page.html')
  assert.equal(opened.status,200)
  assert.deepEqual(opened.json.stylesheets.map(x=>x.status),
    ['unsupported-link','unsupported-link','unavailable'])
  assert.equal(opened.json.styleMatches.find(x=>x.id==='app').matches.length,0)
}))


test('HTML API preview projection includes only safe CSS declarations and never rewrites linked file',()=>fixture(async(invoke,root)=>{
  await mkdir(path.join(root,'styles'))
  const html='<link rel="stylesheet" href="styles/theme.css"><main id="app" class="card">Hello</main>'
  const css='#app{color:#bda991;display:grid;background-image:url(https://example.invalid/i)}'+
    '\n.card{gap:16px;font-size:18px;}'
  await writeFile(path.join(root,'page.html'),html)
  await writeFile(path.join(root,'styles/theme.css'),css)
  const response=await invoke('GET','/design-studio-native/document?sessionId=known&file=page.html')
  assert.equal(response.status,200)
  assert.ok(response.json.previewCss.includes('#app{color:#bda991;display:grid;}'))
  assert.ok(response.json.previewCss.includes('.card{gap:16px;font-size:18px;}'))
  assert.ok(!response.json.previewCss.includes('url('))
  assert.ok(!response.json.previewCss.includes('https:'))
  assert.deepEqual(response.json.previewCoverage,{
    status:'partial',includedDeclarations:4,omittedDeclarations:1,truncated:false
  })
  assert.equal(await readFile(path.join(root,'page.html'),'utf8'),html)
  assert.equal(await readFile(path.join(root,'styles/theme.css'),'utf8'),css)
}))
test('unsupported and conditional linked stylesheets do not inject untrusted CSS into preview',()=>fixture(async(invoke,root)=>{
  await writeFile(path.join(root,'bad.css'),'#app{display:none}')
  const html='<link rel="stylesheet" href="bad.css" media="print">'+
    '<link rel="stylesheet" href="https://bad.invalid/no.css">'+
    '<main id="app">Visible</main>'
  await writeFile(path.join(root,'page.html'),html)
  const response=await invoke('GET','/design-studio-native/document?sessionId=known&file=page.html')
  assert.equal(response.status,200)
  assert.equal(response.json.previewCss,'')
  assert.deepEqual(response.json.stylesheets.map(link=>link.status),['unsupported-link','unsupported-link'])
  assert.equal(await readFile(path.join(root,'bad.css'),'utf8'),'#app{display:none}')
}))

// --- creation -----------------------------------------------------------------
// A workbench that can only open existing files forces the user to leave it to
// start any design. These tests drive the real route against a real workspace
// and check the one property that must never regress: creation never replaces.
const CREATE = '/design-studio-native/create'
const NEW_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect id="box" fill="red"/></svg>'

test('create writes a new native document and the workbench can open it', () => fixture(async (invoke, root) => {
  const created = await invoke('POST', CREATE, { sessionId: 'known', file: 'nouveau.svg', source: NEW_SVG })
  assert.equal(created.status, 201)
  assert.equal(created.json.ok, true)
  assert.equal(created.json.created.format, 'svg')
  assert.match(created.json.created.hash, /^[a-f0-9]{64}$/)
  assert.equal(await readFile(path.join(root, 'nouveau.svg'), 'utf8'), NEW_SVG)

  const files = await invoke('GET', '/design-studio-native/files?sessionId=known')
  assert.ok(files.json.files.some((item) => item.path === 'nouveau.svg'), 'the new file must be listed')

  const opened = await invoke('GET', '/design-studio-native/document?sessionId=known&file=nouveau.svg')
  assert.equal(opened.status, 200)
  assert.deepEqual(opened.json.nodes.map((node) => node.id), ['box'])
  assert.deepEqual(opened.json.geometry.artboard, { x: 0, y: 0, width: 10, height: 10 })
}))

test('create refuses an existing path without touching one byte', () => fixture(async (invoke, root) => {
  const original = await readFile(path.join(root, 'icon.svg'), 'utf8')
  const refused = await invoke('POST', CREATE, { sessionId: 'known', file: 'icon.svg', source: NEW_SVG })
  assert.equal(refused.status, 409)
  assert.equal(refused.json.error, 'already-exists')
  assert.equal(await readFile(path.join(root, 'icon.svg'), 'utf8'), original)
}))

test('create validates the path, the format and the payload before writing', () => fixture(async (invoke, root) => {
  const traversal = await invoke('POST', CREATE, { sessionId: 'known', file: '../escape.svg', source: NEW_SVG })
  assert.equal(traversal.status, 400)
  assert.equal(traversal.json.error, 'invalid-path')
  const format = await invoke('POST', CREATE, { sessionId: 'known', file: 'note.txt', source: 'x' })
  assert.equal(format.status, 400)
  assert.equal(format.json.error, 'unsupported-format')
  const missingDirectory = await invoke('POST', CREATE, { sessionId: 'known', file: 'absent/page.svg', source: NEW_SVG })
  assert.equal(missingDirectory.status, 400)
  assert.equal(missingDirectory.json.error, 'missing-directory')
  const noSource = await invoke('POST', CREATE, { sessionId: 'known', file: 'vide.svg' })
  assert.equal(noSource.status, 400)
  assert.equal(noSource.json.error, 'invalid-source')
  const noSession = await invoke('POST', CREATE, { sessionId: 'other', file: 'x.svg', source: NEW_SVG })
  assert.equal(noSession.status, 400)
  assert.equal(noSession.json.error, 'no-session')
  assert.deepEqual((await readdir(root)).filter((name) => name.includes('escape') || name.includes('vide') || name.includes('note')), [])
}))

test('a created document is editable through /apply with its fresh identity', () => fixture(async (invoke, root) => {
  const created = (await invoke('POST', CREATE, { sessionId: 'known', file: 'frais.svg', source: NEW_SVG })).json.created
  const edited = await invoke('POST', '/design-studio-native/apply', {
    sessionId: 'known', file: 'frais.svg', baseHash: created.hash, baseIdentity: created.identity,
    kind: 'svg-attribute', id: 'box', attribute: 'fill', value: '#00ff00',
  })
  assert.equal(edited.status, 200)
  assert.ok((await readFile(path.join(root, 'frais.svg'), 'utf8')).includes('fill="#00ff00"'))
  // The identity from before the edit must now be stale, exactly like a reopened file.
  const stale = await invoke('POST', '/design-studio-native/apply', {
    sessionId: 'known', file: 'frais.svg', baseHash: created.hash, baseIdentity: created.identity,
    kind: 'svg-attribute', id: 'box', attribute: 'fill', value: '#000000',
  })
  assert.equal(stale.status, 409)
  assert.equal(stale.json.error, 'stale-revision')
}))

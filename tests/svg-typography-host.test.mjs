import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRouteHandler } from '../src/plugin-host.mjs'
import { listSvgTextNodes } from '../src/svg-text.mjs'

async function harness(run) {
  const root=await mkdtemp(path.join(os.tmpdir(),'dsh-text-host-'))
  const file='example.svg'
  const initial='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">\n'+
    '  <text id="title" x="20" y="45" font-size="32" font-family="Inter, Arial" font-weight="500" font-style="normal" letter-spacing="0" text-anchor="start" fill="#ededec">Hello</text>\n</svg>'
  try{
    await writeFile(path.join(root,file),initial)
    const ctx={agents:{get:id=>id==='session'?{id}:undefined},workingDirectory:{ensure:async()=>root}}
    const handler=createRouteHandler(ctx)
    const call=async(method,operation,params)=>{
      const body=method==='POST'?Buffer.from(JSON.stringify(params)) : null
      const request=Readable.from(body?[body]:[])
      request.method=method;request.url=operation;request.headers=body?{'content-type':'application/json'}:{}
      let status=0,answer
      await handler(request,{writeHead(code){status=code},end(data){answer=JSON.parse(data)}})
      return {status,...answer}
    }
    await run({call,file,root,initial,url:'/design-studio-native/document?sessionId=session&file='+file})
  }finally{await rm(root,{recursive:true,force:true})}
}
test('host exposes recognized native SVG text nodes without generating an agent request',()=>harness(async({call,url})=>{
  const reply=await call('GET',url)
  assert.equal(reply.status,200)
  assert.equal(reply.textNodes[0].text,'Hello')
  assert.equal(reply.textNodes[0].editable,true)
  assert.equal(reply.geometry.handles.find(h=>h.id==='title').tag,'text')
}))
test('editing text via host preserves geometry and SVG original bytes outside content',()=>harness(async({call,url,file,root,initial})=>{
  const doc=(await call('GET',url)).document
  const response=await call('POST','/design-studio-native/apply',{
    sessionId:'session',file,baseHash:doc.hash,kind:'svg-text',id:'title',value:'Hello & <friends>'
  })
  assert.equal(response.status,200)
  const edited=await readFile(path.join(root,file),'utf8')
  assert.equal(edited,initial.replace('>Hello</text>','>Hello &amp; &lt;friends&gt;</text>'))
  const undo=await call('POST','/design-studio-native/apply',{
    sessionId:'session',file,baseHash:response.result.hash,kind:'patches',patches:response.result.inverse
  })
  assert.equal(undo.status,200)
  assert.equal(await readFile(path.join(root,file),'utf8'),initial)
}))
test('native typographic properties are restricted and editable',()=>harness(async({call,url,file,root})=>{
  const doc=(await call('GET',url)).document
  const changed=await call('POST','/design-studio-native/apply',{
    sessionId:'session',file,baseHash:doc.hash,kind:'svg-attribute',id:'title',attribute:'font-size',value:'40'
  })
  assert.equal(changed.status,200)
  assert.ok((await readFile(path.join(root,file),'utf8')).includes('font-size="40"'))
  const denied=await call('POST','/design-studio-native/apply',{
    sessionId:'session',file,baseHash:changed.result.hash,kind:'svg-attribute',id:'title',attribute:'font-family',value:'url(javascript:evil)'
  })
  assert.equal(denied.status,400)
  assert.equal(denied.error,'invalid-value')
}))
test('text object creation is reversible and becomes editable',()=>harness(async({call,url,file,root,initial})=>{
  const doc=(await call('GET',url)).document
  const result=await call('POST','/design-studio-native/apply',{
    sessionId:'session',file,baseHash:doc.hash,kind:'svg-add-shape',shape:'text'
  })
  assert.equal(result.status,200)
  const next=(await call('GET',url)).document
  assert.ok(next.source.includes('<text id="shape-1"'))
  assert.equal(listSvgTextNodes(next.source).find(n=>n.id==='shape-1').text,'Double-click to edit')
  await call('POST','/design-studio-native/apply',{
    sessionId:'session',file,baseHash:next.hash,kind:'patches',patches:result.result.inverse
  })
  assert.equal(await readFile(path.join(root,file),'utf8'),initial)
}))
test('external file edit conflicts with an in-progress native text edit',()=>harness(async({call,url,file,root})=>{
  const old=(await call('GET',url)).document
  await writeFile(path.join(root,file),old.source.replace('>Hello</text>','>Different</text>'))
  const response=await call('POST','/design-studio-native/apply',{
    sessionId:'session',file,baseHash:old.hash,kind:'svg-text',id:'title',value:'My draft'
  })
  assert.equal(response.status,409)
  assert.equal((await readFile(path.join(root,file),'utf8')).includes('>Different</text>'),true)
}))

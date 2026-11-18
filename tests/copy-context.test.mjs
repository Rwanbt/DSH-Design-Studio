import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import os from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { createRouteHandler } from '../src/plugin-host.mjs'

const group='<g id="group" transform="translate(10 20)" fill="red"><rect id="child" width="10" height="10"/></g>'
const source=(attrs='',body=group)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" ${attrs}>${body}</svg>`

async function inspect(svg) {
  const root=await mkdtemp(path.join(os.tmpdir(),'dsh-copy-context-'))
  try {
    await writeFile(path.join(root,'source.svg'),svg)
    const route=createRouteHandler({agents:{get:()=>({id:'known'})},workingDirectory:{ensure:async()=>root}})
    const req=Readable.from([])
    req.method='GET';req.url='/design-studio-native/document?sessionId=known&file=source.svg';req.headers={}
    let payload,status
    await route(req,{writeHead(value){status=value},end(value){payload=JSON.parse(value)}})
    assert.equal(status,200)
    assert.equal(await readFile(path.join(root,'source.svg'),'utf8'),svg)
    return payload
  } finally { await rm(root,{recursive:true,force:true}) }
}

test('copy context: complete direct group allowed, transformed child refused, named and anonymous roots',async()=>{
  for(const attrs of ['', 'id="root"']) {
    const {nodes}=await inspect(source(attrs))
    assert.equal(nodes.find(n=>n.id==='group').copyContextSafe,true)
    assert.equal(nodes.find(n=>n.id==='group').copyContextReason,null)
    assert.equal(nodes.find(n=>n.id==='child').copyContextSafe,false)
    assert.equal(nodes.find(n=>n.id==='child').copyContextReason,'ancestor-context')
    if(attrs) assert.equal(nodes.find(n=>n.id==='root').copyContextSafe,false)
  }
})

test('copy context: all nonstructural root attributes and style nodes fail closed',async()=>{
  for(const attrs of ['style="fill:red"','class="paint"','fill="red"','color="red"','xml:space="preserve"','transform="translate(1 2)"','data-custom="x"']) {
    const {nodes}=await inspect(source(attrs))
    assert.equal(nodes.find(n=>n.id==='group').copyContextSafe,false,attrs)
    assert.equal(nodes.find(n=>n.id==='group').copyContextReason,'root-context',attrs)
  }
  for(const body of [`<style>rect{fill:red}</style>${group}`,`<defs><style>rect{fill:red}</style></defs>${group}`]) {
    const {nodes}=await inspect(source('',body))
    assert.equal(nodes.find(n=>n.id==='group').copyContextReason,'document-styles')
  }
})

test('copy context: stylesheet processing instructions are refused, XML declaration alone allowed',async()=>{
  for(const instruction of ['<?xml-stylesheet type="text/css" href="paint.css"?>',
    "<?xml-stylesheet href='paint.css' type='text/css'?>",'<?XML-STYLESHEET href="paint.css"?>',
    '<!-- <?xml-stylesheet href="paint.css"?> -->']) {
    const {nodes}=await inspect(instruction+source())
    assert.equal(nodes.find(n=>n.id==='group').copyContextSafe,false,instruction)
    assert.equal(nodes.find(n=>n.id==='group').copyContextReason,'document-styles',instruction)
  }
  const {nodes}=await inspect('<?xml version="1.0" encoding="UTF-8"?>'+source())
  assert.equal(nodes.find(n=>n.id==='group').copyContextSafe,true)
})

test('copy context: direct root card remains eligible',async()=>{
  const {nodes}=await inspect(source('width="100" height="100" version="1.1" preserveAspectRatio="xMidYMid meet" xmlns:xlink="http://www.w3.org/1999/xlink"','<rect id="card" fill="blue" width="10" height="10"/>'))
  assert.equal(nodes[0].copyContextSafe,true)
})

test('copy context: real client copy refuses unsafe or missing metadata without replacing previous clipboard',async()=>{
  // Execute the actual local handler with real Host payload, no parallel policy.
  const client=await readFile(new URL('../client.js',import.meta.url),'utf8')
  const start=client.indexOf('      function copyLayer(id) {')
  const end=client.indexOf('\n      /**',start)
  assert.ok(start>=0&&end>start)
  const payload=await inspect(source())
  let clipboard={fragment:'previous'},notice='Calque copié : previous',error=''
  const context={doc:payload.document,nodes:payload.nodes,active:'child',
    setClipboard(value){clipboard=value},setNotice(value){notice=value},setError(value){error=value}}
  runInNewContext(client.slice(start,end)+'\nthis.copyLayer=copyLayer',context)
  for(const metadata of [false,undefined]) {
    context.nodes.find(n=>n.id==='child').copyContextSafe=metadata
    context.copyLayer('child')
    assert.equal(clipboard.fragment,'previous')
    assert.equal(notice,'')
    assert.match(error,/Copie refusée.*groupe parent/)
  }
  context.copyLayer('group')
  assert.equal(clipboard.fragment,group)
  assert.match(notice,/Calque copié/)
})

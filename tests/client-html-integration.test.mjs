import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { Readable } from 'node:stream'
import os from 'node:os'
import path from 'node:path'
import { createRouteHandler } from '../src/plugin-host.mjs'

function find(node,predicate){
  if(Array.isArray(node)){for(const item of node){const found=find(item,predicate);if(found)return found}return null}
  if(!node || typeof node!=='object')return null
  if(predicate(node))return node
  return find(node.children||[],predicate)
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,25))
async function harness(run) {
  const root=await mkdtemp(path.join(os.tmpdir(),'dsh-html-client-'))
  const source='<!doctype html><html><body><main id="app" style="display: block;">'+
    '<h1 id="title" style="color: red;">Hello</h1></main></body></html>'
  const file=path.join(root,'page.html')
  try {
    await writeFile(file,source)
    let index=0,definition,component
    const states=[],calls=[]
    const React={
      createElement:(type,props,...children)=>({type,props:props||{},children}),
      useState(initial){const i=index++;if(!(i in states))states[i]=initial
        return [states[i],next=>{states[i]=typeof next==='function'?next(states[i]):next}]},
      useRef(initial){const i=index++;if(!(i in states))states[i]={current:initial};return states[i]},
    }
    const route=createRouteHandler({
      agents:{get:id=>id==='known'?{id}:undefined},workingDirectory:{ensure:async()=>root}
    })
    const fetch=async(url,options={})=>{
      const dest=new URL(String(url))
      assert.equal(dest.origin,'https://dsh.example')
      const method=options.method||'GET'
      const body=options.body?JSON.parse(options.body):null
      calls.push({method,path:dest.pathname,body})
      const req=Readable.from(options.body?[Buffer.from(options.body)]:[])
      req.method=method
      req.url=dest.pathname+dest.search
      req.headers=options.body?options.headers||{'content-type':'application/json'}:{}
      let status,content
      await route(req,{writeHead(code){status=code},end(answer){content=JSON.parse(answer)}})
      return {ok:status>=200&&status<300,status,json:async()=>content}
    }
    runInNewContext(await readFile(new URL('../client.js',import.meta.url),'utf8'),{
      window:{__ModuleLoader__:{load:d=>definition=d}},URL,fetch,
      document:{baseURI:'https://dsh.example/session/current/'}
    })
    const plugin=definition.factory(name=>{assert.equal(name,'react');return React})
    plugin.apply({slots:{inject:(_,cb)=>cb(),register:(_,view)=>{component=view}}})
    const render=()=>{index=0;return component({sessionId:'known'})}
    // Open default path, then choose a file in the same active workspace.
    await find(render(),n=>n.props?.['aria-label']==='Browse workspace design files').props.onClick()
    await settle()
    const picked=find(render(),n=>n.props?.['aria-label']==='Open file page.html')
    assert.ok(picked)
    picked.props.onClick()
    await settle()
    await run({render,source,file,calls:()=>calls})
  }finally{await rm(root,{recursive:true,force:true})}
}
test('HTML layer selection highlights isolated preview without mutating actual document',()=>harness(async app=>{
  const title=find(app.render(),n=>n.props?.['aria-label']==='Select HTML element title')
  assert.ok(title)
  title.props.onClick()
  const frame=find(app.render(),n=>n.type==='iframe'&&n.props.title==='Isolated design preview')
  assert.ok(frame)
  assert.equal(frame.props.sandbox,'')
  assert.ok(frame.props.srcDoc.includes('[id="title"]{outline:2px solid #bda991'))
  assert.equal(await readFile(app.file,'utf8'),app.source)
  assert.equal(app.calls().filter(call=>call.method==='POST').length,0)
}))
test('HTML inspector edits native style and allows exact Undo without invoking an agent',()=>harness(async app=>{
  find(app.render(),n=>n.props?.['aria-label']==='Select HTML element title').props.onClick()
  const picker=find(app.render(),n=>n.props?.['aria-label']==='HTML style property')
  picker.props.onChange({target:{value:'color'}})
  find(app.render(),n=>n.props?.['aria-label']==='HTML style value')
    .props.onChange({target:{value:'#bda991'}})
  const apply=find(app.render(),n=>n.props?.['aria-label']==='Apply HTML visual style')
  assert.ok(apply)
  apply.props.onClick()
  await settle()
  const modified=await readFile(app.file,'utf8')
  assert.equal(modified,app.source.replace('color: red','color: #bda991'))
  const writes=app.calls().filter(c=>c.method==='POST')
  assert.equal(writes.length,1)
  assert.equal(writes[0].body.kind,'html-style')
  assert.equal(writes[0].body.id,'title')
  assert.equal(writes[0].body.property,'color')
  assert.match(writes[0].body.baseIdentity,/^[a-f0-9]{64}$/)
  const undo=find(app.render(),n=>n.props?.['aria-label']==='Undo saved edit')
  assert.ok(undo)
  undo.props.onClick()
  await settle()
  assert.equal(await readFile(app.file,'utf8'),app.source)
}))
test('visual HTML editor cannot save when unsaved source differs from the opened revision',()=>harness(async app=>{
  find(app.render(),n=>n.props?.['aria-label']==='Select HTML element app').props.onClick()
  find(app.render(),n=>n.type==='textarea'&&n.props.spellCheck===false)
    .props.onChange({target:{value:app.source+'<!-- local draft -->'}})
  const save=find(app.render(),n=>n.props?.['aria-label']==='Apply HTML visual style')
  assert.ok(save.props.disabled)
  assert.equal(app.calls().filter(c=>c.method==='POST').length,0)
}))

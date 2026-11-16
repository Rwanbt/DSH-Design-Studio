import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { runInNewContext } from 'node:vm'
import { createRouteHandler } from '../src/plugin-host.mjs'

function find(node,predicate) {
  if(Array.isArray(node)) {for(const item of node){const match=find(item,predicate);if(match)return match}return null}
  if(!node || typeof node!=='object')return null
  if(predicate(node))return node
  return find(node.children||[],predicate)
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,100))
async function withPenClient(fn) {
  const root=await mkdtemp(path.join(os.tmpdir(),'dsh-pen-client-'))
  const file=path.join(root,'design.svg')
  const initial='<svg viewBox="0 0 100 100">\n</svg>\n'
  try {
    await writeFile(file,initial)
    let calls=[],index=0,component,definition
    const state=[]
    const React={
      createElement:(type,props,...children)=>({type,props:props||{},children}),
      useState(initial){
        const i=index++
        if(!(i in state))state[i]=initial
        return [state[i],next=>{state[i]=typeof next==='function'?next(state[i]):next}]
      },
      useRef(initial){
        const i=index++
        if(!(i in state))state[i]={current:initial}
        return state[i]
      }
    }
    const ctx={agents:{get:id=>id==='session'?{id}:undefined},workingDirectory:{ensure:async()=>root}}
    const route=createRouteHandler(ctx)
    const fetch=async(url,options={})=>{
      const target=new URL(String(url))
      assert.equal(target.pathname.startsWith('/design-studio-native/'),true)
      const method=options.method||'GET'
      calls.push({method,pathname:target.pathname,params:options.body?JSON.parse(options.body):null})
      const request=Readable.from(options.body?[Buffer.from(options.body)]:[])
      request.method=method;request.url=target.pathname+target.search
      request.headers=options.body?options.headers||{'content-type':'application/json'}:{}
      let status,content
      await route(request,{writeHead(code){status=code},end(answer){content=JSON.parse(answer)}})
      return {ok:status>=200&&status<300,status,json:async()=>content}
    }
    runInNewContext(await readFile(new URL('../client.js',import.meta.url),'utf8'),{
      window:{__ModuleLoader__:{load:module=>definition=module}},URL,fetch,
      document:{baseURI:'https://dsh.example/workspace/session/1/'}
    })
    const plugin=definition.factory(name=>{assert.equal(name,'react');return React})
    plugin.apply({slots:{inject:(_,cb)=>cb(),register:(_,view)=>{component=view}}})
    const render=()=>{index=0;return component({sessionId:'session'})}
    await find(render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
    await fn({render,calls:()=>calls,initial,file})
  }finally{await rm(root,{recursive:true,force:true})}
}
function gesture(render,{x,y,endX=x,endY=y,id}) {
  const surface=find(render(),n=>n.props?.['aria-label']==='Pen drawing surface')
  assert.ok(surface,'Pen pointer surface must exist')
  const bounds={left:0,top:0,width:200,height:200}
  const currentTarget={getBoundingClientRect:()=>bounds,setPointerCapture(){}}
  surface.props.onPointerDown({button:0,pointerId:id,clientX:x,clientY:y,
    currentTarget,preventDefault(){},stopPropagation(){}})
  if(x!==endX||y!==endY)surface.props.onPointerMove({pointerId:id,clientX:endX,clientY:endY,currentTarget})
  const result=surface.props.onPointerUp({pointerId:id,clientX:endX,clientY:endY,currentTarget})
  return result
}
test('Pen UI creates, extends and closes source-accurate SVG path through real native Host routes',()=>withPenClient(async app=>{
  const {render,file,initial}=app
  find(render(),n=>n.props?.['aria-label']==='Activate Pen tool').props.onClick()
  assert.ok(find(render(),n=>n.props?.['aria-label']==='Pen drawing surface'))
  gesture(render,{x:20,y:20,id:1})
  await settle()
  assert.equal((await readFile(file,'utf8')).includes('d="M 10 10"'),true)
  gesture(render,{x:40,y:40,id:2})
  await settle()
  assert.equal((await readFile(file,'utf8')).includes('d="M 10 10 L 20 20"'),true)
  gesture(render,{x:140,y:100,endX:160,endY:100,id:3})
  await settle()
  const drawn=await readFile(file,'utf8')
  assert.ok(drawn.includes('C '),drawn)
  assert.ok(drawn.includes('70 50'),drawn)
  const close=find(render(),n=>n.props?.['aria-label']==='Close current pen path')
  assert.ok(close)
  assert.equal(close.props.disabled,false)
  close.props.onClick()
  await settle()
  assert.ok((await readFile(file,'utf8')).includes(' Z"'))
  for(let i=0;i<4;i++){
    const undo=find(render(),n=>n.props?.['aria-label']==='Undo saved edit')
    assert.equal(undo.props.disabled,false,'History must support each of four pen operations')
    undo.props.onClick()
    await settle()
  }
  assert.equal(await readFile(file,'utf8'),initial)
  const writes=app.calls().filter(call=>call.method==='POST')
  assert.deepEqual(writes.slice(0,4).map(call=>call.params.operation),
    ['start','append','append','close'])
  assert.ok(writes.every(call=>/^[a-f0-9]{64}$/.test(call.params.baseIdentity)),
    'Every native write and Undo must send the current file identity token')
}))
test('Pen drag tangent preview and Escape cancel do not persist source',()=>withPenClient(async app=>{
  const {render,file,initial}=app
  find(render(),n=>n.props?.['aria-label']==='Activate Pen tool').props.onClick()
  const surface=find(render(),n=>n.props?.['aria-label']==='Pen drawing surface')
  const target={getBoundingClientRect:()=>({left:0,top:0,width:200,height:200}),setPointerCapture(){}}
  surface.props.onPointerDown({button:0,pointerId:10,clientX:20,clientY:20,
    currentTarget:target,preventDefault(){},stopPropagation(){}})
  surface.props.onPointerMove({pointerId:10,clientX:40,clientY:60,currentTarget:target})
  const preview=find(render(),n=>n.props?.className==='dsh-studio-pen-surface')
  assert.ok(find(preview,n=>n.type==='line'),'Preview should indicate tangent')
  let prevented=false
  render().props.onKeyDown({key:'Escape',target:{tagName:'BUTTON'},preventDefault(){prevented=true}})
  surface.props.onPointerUp({pointerId:10,clientX:40,clientY:60,currentTarget:target})
  await settle()
  assert.equal(prevented,true)
  assert.equal(app.calls().filter(c=>c.method==='POST').length,0)
  assert.equal(await readFile(file,'utf8'),initial)
}))
test('Pen start requires active tool, source synchrony and a point inside artboard',()=>withPenClient(async app=>{
  const {render,file,initial}=app
  assert.equal(find(render(),n=>n.props?.['aria-label']==='Pen drawing surface'),null)
  find(render(),n=>n.props?.['aria-label']==='Activate Pen tool').props.onClick()
  gesture(render,{x:500,y:500,id:1})
  await settle()
  assert.equal(app.calls().filter(c=>c.method==='POST').length,0)
  assert.equal(await readFile(file,'utf8'),initial)
}))

test('Pen resumes an existing selected open path rather than silently making another shape',()=>withPenClient(async app=>{
  const {render,file}=app
  find(render(),n=>n.props?.['aria-label']==='Activate Pen tool').props.onClick()
  gesture(render,{x:30,y:30,id:1})
  await settle()
  find(render(),n=>n.props?.['aria-label']==='Select canvas tool').props.onClick()
  const resume=find(render(),n=>n.props?.['aria-label']==='Resume selected path with pen tool')
  assert.ok(resume)
  resume.props.onClick()
  gesture(render,{x:90,y:100,id:2})
  await settle()
  const text=await readFile(file,'utf8')
  assert.equal((text.match(/<path /g)||[]).length,1)
  assert.ok(text.includes('d="M 15 15 L 45 50"'),text)
}))
test('closed SVG paths are not offered as resumable pen strokes',()=>withPenClient(async app=>{
  const {render}=app
  find(render(),n=>n.props?.['aria-label']==='Activate Pen tool').props.onClick()
  gesture(render,{x:20,y:20,id:1});await settle()
  gesture(render,{x:40,y:40,id:2});await settle()
  gesture(render,{x:90,y:70,id:3});await settle()
  find(render(),n=>n.props?.['aria-label']==='Close current pen path').props.onClick()
  await settle()
  find(render(),n=>n.props?.['aria-label']==='Select canvas tool').props.onClick()
  assert.equal(find(render(),n=>n.props?.['aria-label']==='Resume selected path with pen tool'),null)
}))

import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {runInNewContext} from 'node:vm'
import {Readable} from 'node:stream'
import os from 'node:os'
import path from 'node:path'
import {createRouteHandler} from '../src/plugin-host.mjs'
function find(node,predicate){
  if(Array.isArray(node)){for(const item of node){const found=find(item,predicate);if(found)return found}return null}
  if(!node||typeof node!=='object')return null
  if(predicate(node))return node
  return find(node.children||[],predicate)
}
async function until(predicate,message) {
  const deadline=Date.now()+2500
  while(Date.now()<deadline){
    if(await predicate())return
    await new Promise(resolve=>setTimeout(resolve,20))
  }
  assert.fail(message)
}
async function fixture(run) {
  const root=await mkdtemp(path.join(os.tmpdir(),'dsh-css-ui-'))
  const file=path.join(root,'theme.css')
  const source='#app { color: red; display: block; }\n.card { gap: 8px; }\n'
  try {
    await writeFile(file,source)
    let index=0,component,definition
    const state=[],calls=[]
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
      },
    }
    const route=createRouteHandler({
      agents:{get:id=>id==='active'?{id}:undefined},
      workingDirectory:{ensure:async()=>root},
    })
    const fetch=async(rawUrl,options={})=>{
      const dest=new URL(String(rawUrl))
      assert.equal(dest.origin,'https://dsh.example')
      const method=options.method||'GET'
      const body=options.body?JSON.parse(options.body):null
      calls.push({method,pathname:dest.pathname,body})
      const req=Readable.from(options.body?[Buffer.from(options.body)]:[])
      req.method=method;req.url=dest.pathname+dest.search
      req.headers=options.body?options.headers||{'content-type':'application/json'}:{}
      let status,content
      await route(req,{writeHead(code){status=code},end(bytes){content=JSON.parse(bytes)}})
      return {ok:status>=200&&status<300,status,json:async()=>content}
    }
    runInNewContext(await readFile(new URL('../client.js',import.meta.url),'utf8'),{
      window:{__ModuleLoader__:{load:def=>definition=def}},URL,fetch,
      document:{baseURI:'https://dsh.example/sessions/1/'},
    })
    const plugin=definition.factory(name=>{assert.equal(name,'react');return React})
    plugin.apply({slots:{inject:(_slot,cb)=>cb(),register:(_meta,view)=>{component=view}}})
    const render=()=>{index=0;return component({sessionId:'active'})}
    const browse=find(render(),n=>n.props?.['aria-label']==='Browse workspace design files')
    browse.props.onClick()
    await until(()=>!!find(render(),n=>n.props?.['aria-label']==='Open file theme.css'),'CSS file list not loaded')
    find(render(),n=>n.props?.['aria-label']==='Open file theme.css').props.onClick()
    await until(()=>!!find(render(),n=>n.props?.['aria-label']==='Select CSS rule #app'),'CSS document not opened')
    await run({render,source,file,calls:()=>calls})
  }finally{await rm(root,{recursive:true,force:true})}
}
test('CSS inspector selects native file rules without writing on selection',()=>fixture(async({render,file,source,calls})=>{
  assert.ok(find(render(),n=>n.props?.['aria-label']==='Select CSS rule #app'))
  assert.ok(find(render(),n=>n.props?.['aria-label']==='Select CSS rule .card'))
  find(render(),n=>n.props?.['aria-label']==='Select CSS rule #app').props.onClick()
  assert.ok(find(render(),n=>n.props?.className==='dsh-studio-css-rule-preview'))
  assert.equal(await readFile(file,'utf8'),source)
  assert.equal(calls().filter(c=>c.method==='POST').length,0)
}))
test('CSS inspector commits one native declaration and exact Undo through Host',()=>fixture(async({render,file,source,calls})=>{
  find(render(),n=>n.props?.['aria-label']==='Select CSS rule #app').props.onClick()
  assert.equal(find(render(),n=>n.props?.['aria-label']==='CSS rule value').props.value,'red')
  find(render(),n=>n.props?.['aria-label']==='CSS rule value')
    .props.onChange({target:{value:'#bda991'}})
  find(render(),n=>n.props?.['aria-label']==='Apply CSS rule style').props.onClick()
  const expected=source.replace('color: red','color: #bda991')
  await until(async()=>await readFile(file,'utf8')===expected,'Native CSS style save did not complete')
  await until(()=>find(render(),n=>n.props?.['aria-label']==='Undo saved edit')?.props.disabled===false,
    'Undo history not ready')
  const posts=calls().filter(c=>c.method==='POST')
  assert.equal(posts.length,1)
  assert.equal(posts[0].body.kind,'css-rule')
  assert.equal(posts[0].body.selector,'#app')
  assert.match(posts[0].body.baseIdentity,/^[a-f0-9]{64}$/)
  find(render(),n=>n.props?.['aria-label']==='Undo saved edit').props.onClick()
  await until(async()=>await readFile(file,'utf8')===source,'Native CSS Undo did not restore source')
}))
test('dirty source prevents the separate CSS visual editor from overwriting a draft',()=>fixture(async({render,calls,source})=>{
  find(render(),n=>n.props?.['aria-label']==='Select CSS rule #app').props.onClick()
  find(render(),n=>n.type==='textarea'&&n.props.spellCheck===false)
    .props.onChange({target:{value:source+'/* draft */'}})
  assert.equal(find(render(),n=>n.props?.['aria-label']==='Apply CSS rule style').props.disabled,true)
  assert.equal(calls().filter(c=>c.method==='POST').length,0)
}))

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
  // Windows can keep a deleted lock directory in "delete pending" for a moment,
  // so the next acquire legitimately waits before succeeding. The invariant is
  // that the write lands, not that it lands within 2.5 s.
  const deadline=Date.now()+(process.platform==='win32'?15000:5000)
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
    const effects={}; const cleanups=[]
  const React={
      createElement:(type,props,...children)=>({type,props:props||{},children}),
      useState(initial){
        const i=index++
        if(!(i in state))state[i]=initial
        return [state[i],next=>{state[i]=typeof next==='function'?next(state[i]):next}]
      },
      // The client half receives DSH's full React 18, so effects are part of its
      // contract. This mock keeps hook order stable and runs an effect when its
      // dependencies change; behaviour is covered by the browser gate.
      useEffect(effect, deps) {
        const i=index++
        const previous=effects[i]
        const changed=!previous||!deps||deps.length!==previous.length||
          deps.some((value,index)=>value!==previous[index])
        if(!changed) return
        effects[i]=deps
        const cleanup=effect()
        if(typeof cleanup==='function') cleanups.push(cleanup)
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
    plugin.apply({slots:{inject:(_slot,cb)=>cb(),register:(meta,view)=>{if(meta.name==='conversation.view')component=view}}})
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


test('visual Flex presets use one revision-guarded CSS rule operation and Undo',()=>fixture(async({render,file,source,calls})=>{
  find(render(),n=>n.props?.['aria-label']==='Select CSS rule #app').props.onClick()
  const flex=find(render(),n=>n.props?.['aria-label']==='Set css layout display to flex')
  assert.ok(flex)
  assert.equal(flex.props.disabled,false)
  assert.ok(find(render(),n=>n.props?.['aria-label']==='Visual layout controls'))
  flex.props.onClick()
  const expected=source.replace('display: block','display: flex')
  await until(async()=>await readFile(file,'utf8')===expected,'Flex display write missing')
  await until(()=>find(render(),n=>n.props?.['aria-label']==='Undo saved edit')?.props.disabled===false,
    'Undo stack not ready')
  const posts=calls().filter(item=>item.method==='POST')
  assert.equal(posts.length,1)
  assert.equal(posts[0].body.kind,'css-rule')
  assert.equal(posts[0].body.property,'display')
  assert.equal(posts[0].body.value,'flex')
  assert.match(posts[0].body.baseIdentity,/^[a-f0-9]{64}$/)
  find(render(),n=>n.props?.['aria-label']==='Undo saved edit').props.onClick()
  await until(async()=>await readFile(file,'utf8')===source,'Flex display undo missing')
}))
test('CSS visual layout mode limits disable incompatible grid controls and respect dirty drafts',()=>fixture(async({render,calls,source})=>{
  find(render(),n=>n.props?.['aria-label']==='Select CSS rule #app').props.onClick()
  assert.equal(find(render(),n=>n.props?.['aria-label']==='Set css layout display to block').props['aria-pressed'],true)
  const gridTwo=find(render(),n=>n.props?.['aria-label']==='Set css layout grid-template-columns to repeat(2, minmax(0, 1fr))')
  assert.equal(gridTwo,null,'Grid-specific controls are hidden in Block mode')
  find(render(),n=>n.type==='textarea'&&n.props.spellCheck===false)
    .props.onChange({target:{value:source+'/* unsaved */'}})
  assert.equal(find(render(),n=>n.props?.['aria-label']==='Set css layout display to flex').props.disabled,true)
  assert.equal(calls().filter(item=>item.method==='POST').length,0)
}))
test('mobile panels expose an accessible single-active-pane navigation without writes',()=>fixture(async({render,calls})=>{
  const mobile=find(render(),n=>n.props?.['aria-label']==='Mobile editor panels')
  assert.ok(mobile)
  assert.equal(mobile.props.role,'tablist')
  const tree=render()
  const styles=find(tree,n=>n.type==='style')
  assert.ok(styles)
  const css=String(styles.children.join(''))
  assert.ok(css.includes('@container (max-width:750px)'))
  assert.ok(css.includes('.dsh-studio-mobile-active'))
  assert.equal(find(tree,n=>n.props?.['aria-label']==='Mobile panel canvas').props['aria-selected'],true)
  for(const [tab,pane] of [['inspector','dsh-studio-inspector'],['layers','dsh-studio-sidebar'],
    ['canvas','dsh-studio-canvas']]){
    find(render(),n=>n.props?.['aria-label']==='Mobile panel '+tab).props.onClick()
    const frame=render()
    assert.equal(find(frame,n=>n.props?.['aria-label']==='Mobile panel '+tab).props['aria-selected'],true)
    const panel=find(frame,n=>typeof n.props?.className==='string'&&n.props.className.startsWith(pane))
    assert.ok(panel.props.className.includes('dsh-studio-mobile-active'))
  }
  assert.equal(calls().filter(item=>item.method==='POST').length,0)
}))


test('Grid columns preset performs two safe native saves and Undo restores last change',()=>fixture(async({render,file,source,calls})=>{
  find(render(),n=>n.props?.['aria-label']==='Select CSS rule #app').props.onClick()
  find(render(),n=>n.props?.['aria-label']==='Set css layout display to grid').props.onClick()
  const initial=source.replace('display: block','display: grid')
  await until(async()=>await readFile(file,'utf8')===initial,'Grid display save failed')
  await until(()=>find(render(),n=>n.props?.['aria-label']===
    'Set css layout grid-template-columns to repeat(2, minmax(0, 1fr))')?.props.disabled===false,
    'Grid column controls did not activate')
  find(render(),n=>n.props?.['aria-label']===
    'Set css layout grid-template-columns to repeat(2, minmax(0, 1fr))').props.onClick()
  const expected=initial.replace('display: grid;', 'display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));')
  await until(async()=>await readFile(file,'utf8')===expected,'Grid column save failed')
  await until(()=>find(render(),n=>n.props?.['aria-label']==='Undo saved edit')?.props.disabled===false,
    'Native Undo did not activate')
  const writes=calls().filter(item=>item.method==='POST')
  assert.equal(writes.length,2)
  assert.equal(writes[0].body.kind,'css-rule')
  assert.equal(writes[1].body.property,'grid-template-columns')
  assert.match(writes[1].body.baseIdentity,/^[a-f0-9]{64}$/)
  find(render(),n=>n.props?.['aria-label']==='Undo saved edit').props.onClick()
  await until(async()=>await readFile(file,'utf8')===initial,'Grid column Undo failed')
}))

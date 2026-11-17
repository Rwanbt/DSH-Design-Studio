import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const settle=()=>new Promise(resolve=>setTimeout(resolve,18))
function find(tree,pred){
  if(Array.isArray(tree)){for(const item of tree){const node=find(item,pred);if(node)return node}return null}
  if(!tree||typeof tree!=='object')return null
  if(pred(tree))return tree
  return find(tree.children||[],pred)
}
async function harness(mode='reload-fails') {
  let index=0,definition,view,revision=0,reads=0,writes=0
  const state=[]
  let failReload=true
  const effects={}; const cleanups=[]
  const React={
    createElement:(type,props,...children)=>({type,props:props||{},children}),
    useState(initial) {
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
  const source='<svg viewBox="0 0 100 100"><rect id="box" x="10" y="15" width="20" height="20" fill="red"/></svg>'
  const doc=()=>({file:'design.svg',format:'svg',source,hash:'revision-'+revision})
  const fetch=async(url,options={})=>{
    const target=new URL(String(url))
    assert.ok(target.pathname.startsWith('/design-studio-native/'))
    if(target.pathname==='/design-studio-native/document'){
      reads++
      if(reads>=2 && failReload) {
        failReload=false
        return {ok:false,status:503,json:async()=>({ok:false,error:'temporarily-unavailable',message:'Could not reopen file'})}
      }
      return {ok:true,status:200,json:async()=>({
        ok:true,document:doc(),nodes:[{id:'box',tag:'rect',attributes:{x:'10',y:'15',width:'20',height:'20',fill:'red'}}],
        textNodes:[],geometry:{artboard:{x:0,y:0,width:100,height:100},handles:[]},warning:null
      })}
    }
    if(target.pathname==='/design-studio-native/apply'){
      writes++
      if(mode==='stale'){
        return {ok:false,status:409,json:async()=>({ok:false,error:'stale-revision',message:'External file change'})}
      }
      if(mode==='invalid'){
        return {ok:false,status:400,json:async()=>({ok:false,error:'invalid-value',message:'Validation refused'})}
      }
      revision++
      return {ok:true,status:200,json:async()=>({ok:true,result:{changed:true,inverse:[{start:0,end:1,before:'a',after:'b'}]},patches:[{start:0,end:1,before:'b',after:'a'}]})}
    }
    throw Error('Unexpected native route')
  }
  runInNewContext(await readFile(new URL('../client.js',import.meta.url),'utf8'),{
    window:{__ModuleLoader__:{load:data=>definition=data}},URL,
    document:{baseURI:'https://dsh.example/conversation/current/'},fetch,
  })
  const plugin=definition.factory(name=>{assert.equal(name,'react');return React})
  plugin.apply({slots:{inject:(_,fn)=>fn(),register:(meta,component)=>{if(meta.name==='conversation.view')view=component}}})
  const render=()=>{index=0;return view({sessionId:'known'})}
  await find(render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  return {render,setFailReload:v=>{failReload=v},writes:()=>writes,reads:()=>reads}
}
test('successful native save followed by failed read blocks edits and clears history until explicit reload',async()=>{
  const app=await harness()
  let add=find(app.render(),n=>n.props?.['aria-label']==='Add rect')
  assert.ok(add)
  add.props.onClick()
  await settle()
  assert.equal(app.writes(),1,'File was saved once')
  let reload=find(app.render(),n=>n.props?.['aria-label']==='Reload after save error')
  assert.ok(reload,'Editor must offer explicit recovery after unknown on-disk state')
  assert.equal(find(app.render(),n=>n.props?.['aria-label']==='Add rect').props.disabled,true)
  assert.equal(find(app.render(),n=>n.props?.['aria-label']==='Undo saved edit').props.disabled,true)
  find(app.render(),n=>n.props?.['aria-label']==='Add rect').props.onClick()
  await settle()
  assert.equal(app.writes(),1,'Stale editor cannot issue another write')
  reload.props.onClick()
  await settle()
  assert.equal(find(app.render(),n=>n.props?.['aria-label']==='Reload after save error'),null)
  assert.equal(find(app.render(),n=>n.props?.['aria-label']==='Add rect').props.disabled,false)
})
test('a 409 stale-revision response requires reload before further source edits',async()=>{
  const app=await harness('stale')
  find(app.render(),n=>n.props?.['aria-label']==='Add rect').props.onClick()
  await settle()
  assert.equal(app.writes(),1)
  assert.ok(find(app.render(),n=>n.props?.['aria-label']==='Reload after save error'))
  assert.equal(find(app.render(),n=>n.props?.['aria-label']==='Add rect').props.disabled,true)
})
test('a validation error keeps current editor responsive without forced file reload',async()=>{
  const app=await harness('invalid')
  find(app.render(),n=>n.props?.['aria-label']==='Add rect').props.onClick()
  await settle()
  assert.equal(app.writes(),1)
  assert.equal(find(app.render(),n=>n.props?.['aria-label']==='Reload after save error'),null)
  assert.equal(find(app.render(),n=>n.props?.['aria-label']==='Add rect').props.disabled,false)
  assert.ok(find(app.render(),n=>n.props.role==='alert'))
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

function find(node,match) {
  if(Array.isArray(node)){
    for(const item of node){const found=find(item,match);if(found)return found}
    return null
  }
  if(!node || typeof node!=='object')return null
  if(match(node))return node
  return find(node.children||[],match)
}

function findAll(node,match,output=[]) {
  if(Array.isArray(node)){for(const item of node)findAll(item,match,output);return output}
  if(node&&typeof node==='object'){
    if(match(node))output.push(node)
    findAll(node.children||[],match,output)
  }
  return output
}

const settle=()=>new Promise(resolve=>setTimeout(resolve,12))

async function harness() {
  const state=[];let index=0,definition,component
  const requests=[]
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
  const sources={
    'design.svg':{file:'design.svg',format:'svg',source:'<svg/>',hash:'sha-design'},
    'assets/icon.svg':{file:'assets/icon.svg',format:'svg',source:'<svg/>',hash:'sha-icon'},
    'pages/layout.html':{file:'pages/layout.html',format:'html',source:'<main>Layout</main>',hash:'sha-layout'},
  }
  const files=[
    {path:'assets/icon.svg',format:'svg',size:6},
    {path:'pages/layout.html',format:'html',size:19},
  ]
  const fetch=async (url,options={})=>{
    const target=new URL(String(url))
    requests.push({pathname:target.pathname,search:target.search,method:options.method||'GET'})
    assert.equal(target.origin,'https://dsh.example')
    assert.ok(target.pathname.startsWith('/design-studio-native/'),'The editor only uses its native API')
    if(target.pathname==='/design-studio-native/files')
      return {ok:true,json:async()=>({ok:true,files,truncated:false,scanned:4})}
    if(target.pathname==='/design-studio-native/document') {
      const file=target.searchParams.get('file')
      const document=sources[file]
      if(!document)return {ok:false,json:async()=>({ok:false,error:'not-found'})}
      return {ok:true,json:async()=>({ok:true,document,nodes:[],textNodes:[],geometry:{artboard:null,handles:[]},warning:null})}
    }
    throw Error('Unexpected endpoint: '+target.pathname)
  }
  runInNewContext(await readFile(new URL('../client.js',import.meta.url),'utf8'),{
    window:{__ModuleLoader__:{load:loaded=>definition=loaded}},
    URL,
    document:{baseURI:'https://dsh.example/workspaces/conversation/abc/'},
    fetch,
  })
  const plugin=definition.factory(name=>{assert.equal(name,'react');return React})
  plugin.apply({slots:{inject:(_,fn)=>fn(),register:(meta,view)=>{if(meta.name==='conversation.view')component=view}}})
  const render=()=>{index=0;return component({sessionId:'known'})}
  return {render,requests}
}

test('the list loads on mount and Browse refreshes only session-local native files',async()=>{
  const app=await harness()
  // Renders once: the mount effect is the first read (the tab used to open blank).
  app.render()
  await settle()
  assert.equal(app.requests.filter(x=>x.pathname==='/design-studio-native/files').length,1,
    'mounting must read the workspace list once')
  const browse=find(app.render(),n=>n.props?.['aria-label']==='Browse workspace design files')
  assert.ok(browse)
  await browse.props.onClick();await settle()
  assert.equal(app.requests.filter(x=>x.pathname==='/design-studio-native/files').length,2,
    'an explicit refresh reads it again')
  assert.ok(app.requests.every(x=>x.search.includes('sessionId=known')),
    'every read must stay scoped to this session')
  const shown=findAll(app.render(),n=>n.props?.['aria-label']?.startsWith('Open file ')).map(n=>n.props['aria-label'])
  assert.deepEqual(shown,['Open file assets/icon.svg','Open file pages/layout.html'])
})
test('selecting listed HTML opens native source without typing relative path',async()=>{
  const app=await harness()
  await find(app.render(),n=>n.props?.['aria-label']==='Browse workspace design files').props.onClick();await settle()
  await find(app.render(),n=>n.props?.['aria-label']==='Open file pages/layout.html').props.onClick();await settle()
  const value=find(app.render(),n=>n.props?.['aria-label']==='Workspace file')
  assert.equal(value.props.value,'pages/layout.html')
  const source=find(app.render(),n=>n.type==='textarea'&&n.props.spellCheck===false)
  assert.ok(source)
  assert.equal(source.props.value,'<main>Layout</main>')
  assert.equal(find(app.render(),n=>n.props?.['aria-label']==='Open file pages/layout.html'),null)
})
test('file picker filter limits visible list without mutating files',async()=>{
  const app=await harness()
  await find(app.render(),n=>n.props?.['aria-label']==='Browse workspace design files').props.onClick();await settle()
  find(app.render(),n=>n.props?.['aria-label']==='Filter design files').props.onChange({target:{value:'layout'}})
  assert.deepEqual(findAll(app.render(),n=>n.props?.['aria-label']?.startsWith('Open file ')).map(n=>n.props['aria-label']),['Open file pages/layout.html'])
})
test('unsaved source changes survive opening another file in a new tab',async()=>{
  const app=await harness()
  const open=find(app.render(),n=>n.type==='button'&&n.children?.includes('Open'))
  await open.props.onClick()
  const source=find(app.render(),n=>n.type==='textarea'&&n.props.spellCheck===false)
  source.props.onChange({target:{value:'<svg id="edited"/>'}})
  await find(app.render(),n=>n.props?.['aria-label']==='Browse workspace design files').props.onClick();await settle()
  await find(app.render(),n=>n.props?.['aria-label']==='Open file pages/layout.html').props.onClick();await settle()

  // Opening a second document no longer refuses (or discards) the unsaved one:
  // it gets its own tab, and the only reads are /document calls.
  const docs=app.requests.filter(x=>x.pathname==='/design-studio-native/document')
  assert.equal(docs.length,2,'each open document is read exactly once')
  const readFile=(entry)=>new URL('https://x'+entry.search).searchParams.get('file')
  assert.equal(readFile(docs[0]),'design.svg')
  assert.equal(readFile(docs[1]),'pages/layout.html')
  assert.equal(app.requests.filter(x=>x.pathname==='/design-studio-native/apply').length,0,
    'opening another file must never write')
  assert.equal(find(app.render(),n=>n.props?.['aria-label']==='Workspace file').props.value,'pages/layout.html')
  const tabs=findAll(app.render(),n=>n.props?.role==='tab'&&String(n.props?.id||'').startsWith('doc-tab-'))
  assert.equal(tabs.length,2,'both documents stay open as tabs')
  const first=tabs.find(tab=>tab.props['aria-label'].startsWith('design.svg'))
  assert.ok(first,'the first document keeps its own tab')

  // Returning to it restores the unsaved draft, without reading or writing.
  await first.props.onClick();await settle()
  assert.equal(find(app.render(),n=>n.type==='textarea'&&n.props.spellCheck===false).props.value,
    '<svg id="edited"/>','the unsaved source must survive the round trip')
  assert.equal(app.requests.filter(x=>x.pathname==='/design-studio-native/document').length,2,
    'switching tabs is a renderer operation, not a reread')
})

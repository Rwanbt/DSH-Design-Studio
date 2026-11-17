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
async function until(predicate,message) {
  const deadline=Date.now()+2500
  while(Date.now()<deadline){
    if(await predicate())return
    await new Promise(resolve=>setTimeout(resolve,20))
  }
  assert.fail(message)
}
async function harness(run,options={}) {
  const root=await mkdtemp(path.join(os.tmpdir(),'dsh-html-client-'))
  const source=options.html||('<!doctype html><html><body><main id="app" style="display: block;">'+
    '<h1 id="title" style="color: red;">Hello</h1></main></body></html>')
  const file=path.join(root,'page.html')
  try {
    await writeFile(file,source)
    for(const [name,content] of Object.entries(options.css||{})){
      assert.match(name,/^[A-Za-z0-9_-]+\.css$/)
      await writeFile(path.join(root,name),content)
    }
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
    await until(()=>!!find(render(),n=>n.props?.['aria-label']==='Open file page.html'),
      'Workspace HTML entry did not load')
    find(render(),n=>n.props?.['aria-label']==='Open file page.html').props.onClick()
    await until(()=>!!find(render(),n=>n.props?.['aria-label']==='Select HTML element title'),
      'HTML document did not open')
    await run({render,source,file,root,calls:()=>calls})
  }finally{await rm(root,{recursive:true,force:true})}
}
test('HTML layer selection highlights isolated preview without mutating actual document',()=>harness(async app=>{
  const title=find(app.render(),n=>n.props?.['aria-label']==='Select HTML element title')
  assert.ok(title)
  title.props.onClick()
  const frame=find(app.render(),n=>n.type==='iframe'&&n.props.title==='Isolated design preview')
  assert.ok(frame)
  assert.equal(frame.props.sandbox,'allow-same-origin')
  assert.equal(frame.props.sandbox.includes('allow-scripts'),false)
  assert.ok(frame.props.srcDoc.includes("script-src 'none'"))
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
  const expected=app.source.replace('color: red','color: #bda991')
  await until(async()=>await readFile(app.file,'utf8')===expected,
    'Native HTML style change did not commit')
  const modified=await readFile(app.file,'utf8')
  assert.equal(modified,expected)
  await until(()=>find(app.render(),n=>n.props?.['aria-label']==='Undo saved edit')?.props.disabled===false,
    'Undo history was not ready')
  const writes=app.calls().filter(c=>c.method==='POST')
  assert.equal(writes.length,1)
  assert.equal(writes[0].body.kind,'html-style')
  assert.equal(writes[0].body.id,'title')
  assert.equal(writes[0].body.property,'color')
  assert.match(writes[0].body.baseIdentity,/^[a-f0-9]{64}$/)
  const undo=find(app.render(),n=>n.props?.['aria-label']==='Undo saved edit')
  assert.ok(undo)
  undo.props.onClick()
  await until(async()=>await readFile(app.file,'utf8')===app.source,'HTML undo did not restore source')
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


function fakeHtmlFrame({url='about:srcdoc',domIds=['app','title']}={}) {
  const listeners=new Map(),removed=[]
  const element=(id,tagName='H1')=>({
    tagName,getAttribute(name){return name==='id'?id:null},
    closest(selector){return selector==='[id]'?this:null}
  })
  const targetTitle=element('title'),targetApp=element('app','MAIN')
  const domNodes=domIds.map(id=>element(id,id==='app'?'MAIN':'H1'))
  const contentDocument={
    URL:url,
    documentElement:{contains(node){return !!node}},
    querySelectorAll(selector){
      assert.equal(selector,'[id]')
      return domNodes
    },
    addEventListener(event,handler,capture){
      assert.equal(capture,true)
      listeners.set(event,handler)
    },
    removeEventListener(event,handler,capture){
      removed.push({event,handler,capture})
      if(listeners.get(event)===handler)listeners.delete(event)
    }
  }
  const frame={contentDocument}
  const fire=(target,extra={})=>{
    let prevented=false
    listeners.get('click')?.({
      target,...extra,preventDefault(){prevented=true}
    })
    return prevented
  }
  return {frame,element,targetTitle,targetApp,fire,listeners,removed,contentDocument}
}
test('clicking inert HTML preview selects a uniquely mapped element without modifying source',()=>harness(async app=>{
  const frame=find(app.render(),n=>n.type==='iframe'&&n.props.title==='Isolated design preview')
  assert.equal(frame.props.sandbox,'allow-same-origin')
  assert.equal(frame.props.sandbox.includes('allow-scripts'),false)
  assert.ok(frame.props.srcDoc.includes("script-src 'none'"))
  const browser=fakeHtmlFrame()
  frame.props.onLoad({currentTarget:browser.frame})
  assert.equal(typeof browser.listeners.get('click'),'function')
  const nested={closest:()=>browser.targetTitle}
  assert.equal(browser.fire(nested),true)
  const selected=find(app.render(),n=>n.type==='iframe'&&n.props.title==='Isolated design preview')
  assert.ok(selected.props.srcDoc.includes('[id="title"]{outline:2px solid #bda991'))
  assert.equal(await readFile(app.file,'utf8'),app.source)
  assert.equal(app.calls().filter(call=>call.method==='POST').length,0)
}))
test('HTML preview refuses unknown ids, DOM duplication and wrong tag mapping',()=>harness(async app=>{
  const frame=find(app.render(),n=>n.type==='iframe'&&n.props.title==='Isolated design preview')
  const browser=fakeHtmlFrame({domIds:['app','title','title']})
  frame.props.onLoad({currentTarget:browser.frame})
  assert.equal(browser.fire(browser.targetTitle),true)
  assert.equal(find(app.render(),n=>n.type==='iframe')?.props.srcDoc.includes('[id="title"]{outline:'),false)
  const fake=browser.element('nonexistent')
  assert.equal(browser.fire(fake),true)
  assert.equal(find(app.render(),n=>n.type==='iframe')?.props.srcDoc.includes('[id="nonexistent"]'),false)
  const other=fakeHtmlFrame()
  other.frame.contentDocument.querySelectorAll=()=>[other.element('title')]
  frame.props.onLoad({currentTarget:other.frame})
  assert.equal(browser.listeners.has('click'),false,'Old handler is detached')
  assert.ok(browser.removed.length>=1)
  const wrong=other.element('title','BUTTON')
  assert.equal(other.fire(wrong),true)
  assert.equal(find(app.render(),n=>n.type==='iframe')?.props.srcDoc.includes('[id="title"]{outline:'),false)
}))
test('HTML click selection ignores navigated frames and untrusted inaccessible frame documents',()=>harness(async app=>{
  const frame=find(app.render(),n=>n.type==='iframe'&&n.props.title==='Isolated design preview')
  const navigated=fakeHtmlFrame({url:'https://untrusted.example/'})
  frame.props.onLoad({currentTarget:navigated.frame})
  assert.equal(navigated.listeners.size,0)
  frame.props.onLoad({currentTarget:{
    get contentDocument(){throw new Error('cross-origin blocked')}
  }})
  assert.equal(navigated.listeners.size,0)
}))
test('HTML click handler refuses stale document identity after a native save',()=>harness(async app=>{
  const initial=find(app.render(),n=>n.type==='iframe'&&n.props.title==='Isolated design preview')
  const browser=fakeHtmlFrame()
  initial.props.onLoad({currentTarget:browser.frame})
  find(app.render(),n=>n.props?.['aria-label']==='Select HTML element app').props.onClick()
  find(app.render(),n=>n.props?.['aria-label']==='HTML style value')
    .props.onChange({target:{value:'#aabbcc'}})
  find(app.render(),n=>n.props?.['aria-label']==='Apply HTML visual style').props.onClick()
  await until(async()=>(await readFile(app.file,'utf8')).includes('#aabbcc'),
    'Style change not saved before stale-frame guard test')
  await until(()=>{
    const tree=app.render(),frame=find(tree,n=>n.type==='iframe'&&n.props.title==='Isolated design preview')
    const applying=find(tree,n=>n.props?.['aria-label']==='Apply HTML visual style')
    return frame?.props.srcDoc.includes('#aabbcc') && !applying?.props.disabled
  },'Preview did not render new native revision')
  browser.fire(browser.targetTitle)
  const newFrame=find(app.render(),n=>n.type==='iframe'&&n.props.title==='Isolated design preview')
  assert.equal(newFrame.props.srcDoc.includes('[id="title"]{outline:'),false,
    'Click from a previous file revision must not change the selection')
}))
test('HTML preview refuses click mapping during an unsaved source draft',()=>harness(async app=>{
  const frame=find(app.render(),n=>n.type==='iframe'&&n.props.title==='Isolated design preview')
  const browser=fakeHtmlFrame()
  frame.props.onLoad({currentTarget:browser.frame})
  find(app.render(),n=>n.type==='textarea'&&n.props.spellCheck===false)
    .props.onChange({target:{value:app.source+'<!-- draft -->'}})
  app.render() // Simulated React flush: refresh live event-handler context.
  browser.fire(browser.targetTitle)
  const updated=find(app.render(),n=>n.type==='iframe'&&n.props.title==='Isolated design preview')
  assert.equal(updated.props.srcDoc.includes('[id="title"]{outline:'),false)
}))


test('HTML preview blocks synthetic events and fails closed on DOM query errors',()=>harness(async app=>{
  const frame=find(app.render(),n=>n.type==='iframe'&&n.props.title==='Isolated design preview')
  const fake=fakeHtmlFrame()
  frame.props.onLoad({currentTarget:fake.frame})
  assert.equal(fake.fire(fake.targetTitle,{isTrusted:false}),true)
  assert.equal(find(app.render(),n=>n.type==='iframe')?.props.srcDoc.includes('[id="title"]{outline:'),false)
  fake.frame.contentDocument.querySelectorAll=()=>{throw new Error('DOM unavailable')}
  assert.equal(fake.fire(fake.targetTitle,{isTrusted:true}),true)
  assert.equal(find(app.render(),n=>n.type==='iframe')?.props.srcDoc.includes('[id="title"]{outline:'),false)
  assert.equal(app.calls().filter(call=>call.method==='POST').length,0)
}))


test('HTML CSS candidate navigation uses the real CSS inspector and native Undo, then returns',()=>harness(async app=>{
  find(app.render(),n=>n.props?.['aria-label']==='Select HTML element title').props.onClick()
  const match=find(app.render(),n=>n.props?.['aria-label']==='Open linked CSS #title in theme.css')
  assert.ok(match,'Recognized local linked CSS ID should have an open button')
  assert.ok(find(app.render(),n=>n.props?.className==='dsh-studio-linked-css'))
  assert.equal(app.calls().filter(call=>call.method==='POST').length,0)
  match.props.onClick()
  await until(()=>!!find(app.render(),n=>n.props?.['aria-label']==='CSS rule value'),
    'Linked CSS file did not open')
  assert.equal(find(app.render(),n=>n.props?.['aria-label']==='CSS rule value').props.value,'red')
  find(app.render(),n=>n.props?.['aria-label']==='CSS rule value')
    .props.onChange({target:{value:'#bda991'}})
  find(app.render(),n=>n.props?.['aria-label']==='Apply CSS rule style').props.onClick()
  const cssFile=path.join(app.root,'theme.css')
  await until(async()=>(await readFile(cssFile,'utf8')).includes('#bda991'),'CSS write not completed')
  await until(()=>find(app.render(),n=>n.props?.['aria-label']==='Undo saved edit')?.props.disabled===false,
    'Undo not ready')
  assert.equal(await readFile(app.file,'utf8'),app.source,'HTML is never rewritten by CSS edit')
  const writes=app.calls().filter(call=>call.method==='POST')
  assert.equal(writes.length,1)
  assert.equal(writes[0].body.file,'theme.css')
  assert.match(writes[0].body.baseIdentity,/^[a-f0-9]{64}$/)
  find(app.render(),n=>n.props?.['aria-label']==='Undo saved edit').props.onClick()
  await until(async()=>await readFile(cssFile,'utf8')==='#title{color:red}\n.card{gap:8px}\n',
    'Native stylesheet Undo failed')
  const back=find(app.render(),n=>n.props?.['aria-label']==='Return to linked HTML page')
  assert.ok(back)
  back.props.onClick()
  await until(()=>!!find(app.render(),n=>n.props?.['aria-label']==='Open linked CSS #title in theme.css'),
    'Return to HTML did not restore selected element')
  assert.equal(await readFile(app.file,'utf8'),app.source)
}, {
  html:'<link rel="stylesheet" href="theme.css"><h1 id="title" class="card">Hello</h1>',
  css:{'theme.css':'#title{color:red}\n.card{gap:8px}\n'}
}))
test('linked CSS navigation reloads fresh external revisions rather than using stale match values',()=>harness(async app=>{
  find(app.render(),n=>n.props?.['aria-label']==='Select HTML element title').props.onClick()
  await writeFile(path.join(app.root,'theme.css'),'#title{color:blue}')
  find(app.render(),n=>n.props?.['aria-label']==='Open linked CSS #title in theme.css').props.onClick()
  await until(()=>!!find(app.render(),n=>n.props?.['aria-label']==='CSS rule value'),
    'Fresh CSS file was not opened')
  assert.equal(find(app.render(),n=>n.props?.['aria-label']==='CSS rule value').props.value,'blue')
  assert.equal(app.calls().filter(call=>call.method==='POST').length,0)
}, {
  html:'<link rel="stylesheet" href="theme.css"><h1 id="title">Hello</h1>',
  css:{'theme.css':'#title{color:red}'}
}))
test('HTML-to-CSS file navigation is disabled while source contains unsaved changes',()=>harness(async app=>{
  find(app.render(),n=>n.props?.['aria-label']==='Select HTML element title').props.onClick()
  find(app.render(),n=>n.type==='textarea'&&n.props.spellCheck===false)
    .props.onChange({target:{value:app.source+'<!-- dirty -->'}})
  const linked=find(app.render(),n=>n.props?.['aria-label']==='Open linked CSS #title in theme.css')
  assert.ok(linked)
  assert.equal(linked.props.disabled,true)
  assert.equal(app.calls().filter(call=>call.method==='POST').length,0)
}, {
  html:'<link rel="stylesheet" href="theme.css"><h1 id="title">Hello</h1>',
  css:{'theme.css':'#title{color:red}'}
}))


test('responsive preview switches width presets without saving native source',()=>harness(async app=>{
  const getFrame=()=>find(app.render(),n=>n.type==='iframe'&&n.props.title==='Isolated design preview')
  const original=getFrame()
  assert.equal(original.props.style.width,'100%')
  assert.equal(original.props.sandbox,'allow-same-origin')
  assert.ok(original.props.srcDoc.includes('<meta name="viewport" content="width=device-width, initial-scale=1">'))
  assert.ok(find(app.render(),n=>n.props?.['aria-label']==='HTML responsive viewport'))
  const screens=[['mobile','390px'],['tablet','768px'],['desktop','1280px'],['auto','100%']]
  for(const [mode,width] of screens) {
    const control=find(app.render(),n=>n.props?.['aria-label']==='HTML viewport '+mode)
    assert.ok(control,'Responsive viewport control '+mode)
    control.props.onClick()
    const frame=getFrame()
    assert.equal(frame.props.style.width,width)
    assert.equal(find(app.render(),n=>n.props?.['aria-label']==='HTML viewport '+mode).props['aria-pressed'],true)
    assert.ok(frame.props.srcDoc.includes("script-src 'none'"))
    assert.equal(frame.props.sandbox.includes('allow-scripts'),false)
  }
  assert.equal(await readFile(app.file,'utf8'),app.source)
  assert.equal(app.calls().filter(call=>call.method==='POST').length,0)
}))
test('HTML iframe contains only safe projected local CSS while retaining scriptless CSP',()=>harness(async app=>{
  const frame=find(app.render(),n=>n.type==='iframe'&&n.props.title==='Isolated design preview')
  assert.ok(frame.props.srcDoc.includes('data-dsh-preview-subset="partial"'))
  assert.ok(frame.props.srcDoc.includes('#title{color:#bda991;display:flex;}'))
  assert.ok(frame.props.srcDoc.includes('.card{gap:8px;}'))
  assert.equal(frame.props.srcDoc.includes('url(https://evil.invalid'),false)
  assert.equal(frame.props.srcDoc.includes('background-image:url'),false)
  assert.ok(frame.props.srcDoc.includes("connect-src 'none'"))
  assert.ok(frame.props.srcDoc.includes("frame-src 'none'"))
  assert.ok(find(app.render(),n=>n.props?.className==='dsh-studio-responsive-preview'))
  assert.equal(await readFile(app.file,'utf8'),app.source)
  assert.equal(app.calls().filter(call=>call.method==='POST').length,0)
}, {
  html:'<link rel="stylesheet" href="theme.css"><h1 id="title" class="card">Hello</h1>',
  css:{'theme.css':'#title{color:#bda991;display:flex;background-image:url(https://evil.invalid)}\n.card{gap:8px;}'}
}))
test('HTML preview warns of partial CSS rendering and omits conditional CSS links',()=>harness(async app=>{
  const frame=find(app.render(),n=>n.type==='iframe'&&n.props.title==='Isolated design preview')
  assert.equal(frame.props.srcDoc.includes('display:none'),false)
  const warning=find(app.render(),n=>n.props?.role==='status'&&typeof n.children?.[0]==='string'&&n.children[0].includes('Aperçu partiel'))
  assert.ok(warning)
  assert.ok(String(warning.children[0]).includes('0 déclarations compatibles'))
  assert.equal(await readFile(app.file,'utf8'),app.source)
}, {
  html:'<link rel="stylesheet" href="theme.css" media="print"><main id="app">Text</main>',
  css:{'theme.css':'#app{display:none}'}
}))

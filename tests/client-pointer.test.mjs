import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const source = '<svg viewBox="0 0 100 100"><rect id="box" x="10" y="20" width="30" height="40"/></svg>'
const documentData = { file: 'design.svg', format: 'svg', source, hash: 'original-sha256' }
const handle = {
  id:'box',tag:'rect',x:10,y:20,width:30,height:40,
  move:{x:'x',y:'y',initialX:10,initialY:20},resizable:true
}

function createHarness(extraHandles=[],extraPaths=[]) {
  const state=[]
  let index=0
  let component
  let writes=[]
  const effects={}; const cleanups=[]
  const React = {
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
    useRef(initial) {
      const i=index++
      if(!(i in state))state[i]={current:initial}
      return state[i]
    },
  }
  let registration
  const ctx={slots:{inject:(_name,callback)=>callback(),register:(details,view)=>{if(details.name==='conversation.view'){registration=details;component=view}return()=>{}}}}
  const fetch=async (url,options={})=>{
    assert.ok(new URL(String(url)).pathname.startsWith('/design-studio-native/'),'Editor must use same-origin root API routes, never an AI endpoint')
    if(options.method==='POST'){
      writes.push(JSON.parse(options.body))
      return {ok:true,json:async()=>({ok:true,result:{changed:true,inverse:[{start:0,end:1,before:'a',after:'b'}]},patches:[{start:0,end:1,before:'b',after:'a'}]})}
    }
    return {ok:true,json:async()=>({
      ok:true,document:documentData,
      nodes:[{id:'box',tag:'rect',attributes:{x:'10',y:'20',width:'30',height:'40'}},
        ...extraHandles.map(other=>({id:other.id,tag:other.tag,attributes:{}})),
        ...extraPaths.map(p=>({id:p.id,tag:'path',attributes:{d:p.d||''}}))],
      pathNodes:extraPaths,
      geometry:{artboard:{x:0,y:0,width:100,height:100},handles:[handle,...extraHandles]},warning:null
    })}
  }
  let definition
  return {
    async init() {
      runInNewContext(await readFile(new URL('../client.js',import.meta.url),'utf8'),{
        window:{__ModuleLoader__:{load:d=>definition=d}},URL,
        document:{baseURI:'https://dsh.example/workspaces/conversation/session/'},fetch
      })
      const plugin=definition.factory(name=>{assert.equal(name,'react');return React})
      plugin.apply(ctx)
      assert.equal(registration.id,'dsh-design-studio')
    },
    render() {index=0;return component({sessionId:'known'})},
    writes:()=>writes
  }
}

function find(tree,predicate) {
  if(Array.isArray(tree)){
    for(const child of tree){const found=find(child,predicate);if(found)return found}
    return null
  }
  if(!tree || typeof tree!=='object')return null
  if(predicate(tree))return tree
  return find(tree.children||[],predicate)
}

test('pointer gesture sends only two targeted SVG coordinates without an AI call',async()=>{
  const harness=createHarness()
  await harness.init()
  let tree=harness.render()
  const open=find(tree,node=>node.type==='button' && node.children?.includes('Open'))
  assert.ok(open)
  await open.props.onClick()
  tree=harness.render()
  const control=find(tree,node=>node.type==='button' && node.props['aria-label']==='Drag rect box')
  assert.ok(control,'SVG rectangle must be directly manipulable')
  const target={parentElement:{getBoundingClientRect:()=>({width:200,height:200})},setPointerCapture:()=>{}}
  let prevented=false
  control.props.onPointerDown({button:0,pointerId:7,clientX:5,clientY:10,currentTarget:target,preventDefault:()=>{prevented=true}})
  assert.equal(prevented,true)
  control.props.onPointerMove({pointerId:7,clientX:25,clientY:50})
  control.props.onPointerUp({pointerId:7,clientX:25,clientY:50})
  await new Promise(resolve=>setTimeout(resolve,10))
  assert.equal(harness.writes().length,1)
  const data=harness.writes()[0]
  assert.equal(data.kind,'svg-attributes')
  assert.equal(data.baseHash,'original-sha256')
  assert.deepEqual(data.edits,[
    {id:'box',attribute:'x',value:'20'},
    {id:'box',attribute:'y',value:'40'},
  ])
})
test('click without movement selects an element but does not write the file',async()=>{
  const harness=createHarness()
  await harness.init()
  await find(harness.render(),node=>node.type==='button' && node.children?.includes('Open')).props.onClick()
  const control=find(harness.render(),node=>node.props?.['aria-label']==='Drag rect box')
  const target={parentElement:{getBoundingClientRect:()=>({width:200,height:200})},setPointerCapture:()=>{}}
  control.props.onPointerDown({button:0,pointerId:1,clientX:30,clientY:30,currentTarget:target,preventDefault:()=>{}})
  control.props.onPointerUp({pointerId:1,clientX:30,clientY:30})
  await new Promise(resolve=>setTimeout(resolve,5))
  assert.equal(harness.writes().length,0)
})

test('selected rectangle gets bottom-right resize handle and commits dimensions',async()=>{
  const harness=createHarness()
  await harness.init()
  await find(harness.render(),node=>node.type==='button' && node.children?.includes('Open')).props.onClick()
  let control=find(harness.render(),node=>node.props?.['aria-label']==='Drag rect box')
  const target={parentElement:{getBoundingClientRect:()=>({width:200,height:200})},setPointerCapture:()=>{}}
  control.props.onPointerDown({button:0,pointerId:1,clientX:20,clientY:20,currentTarget:target,preventDefault:()=>{}})
  control.props.onPointerUp({pointerId:1,clientX:20,clientY:20})
  const resize=find(harness.render(),node=>node.props?.['aria-label']==='Resize rect box')
  assert.ok(resize,'The selected rectangle must expose a dedicated resize control')
  resize.props.onPointerDown({button:0,pointerId:2,clientX:20,clientY:20,currentTarget:target,stopPropagation:()=>{},preventDefault:()=>{}})
  resize.props.onPointerMove({pointerId:2,clientX:40,clientY:60})
  resize.props.onPointerUp({pointerId:2,clientX:40,clientY:60})
  await new Promise(resolve=>setTimeout(resolve,10))
  assert.deepEqual(harness.writes()[0].edits,[
    {id:'box',attribute:'x',value:'10'},
    {id:'box',attribute:'y',value:'20'},
    {id:'box',attribute:'width',value:'40'},
    {id:'box',attribute:'height',value:'60'}
  ])
})
test('undo and redo use saved inverse and forward patches without AI',async()=>{
  const harness=createHarness()
  await harness.init()
  await find(harness.render(),node=>node.type==='button' && node.children?.includes('Open')).props.onClick()
  const target={parentElement:{getBoundingClientRect:()=>({width:200,height:200})},setPointerCapture:()=>{}}
  const control=find(harness.render(),node=>node.props?.['aria-label']==='Drag rect box')
  control.props.onPointerDown({button:0,pointerId:3,clientX:0,clientY:0,currentTarget:target,preventDefault:()=>{}})
  control.props.onPointerUp({pointerId:3,clientX:20,clientY:20})
  await new Promise(resolve=>setTimeout(resolve,10))
  let undo=find(harness.render(),node=>node.props?.['aria-label']==='Undo saved edit')
  assert.equal(undo.props.disabled,false)
  undo.props.onClick()
  await new Promise(resolve=>setTimeout(resolve,10))
  assert.equal(harness.writes()[1].kind,'patches')
  assert.deepEqual(harness.writes()[1].patches,[{start:0,end:1,before:'a',after:'b'}])
  const redo=find(harness.render(),node=>node.props?.['aria-label']==='Redo saved edit')
  assert.equal(redo.props.disabled,false)
  redo.props.onClick()
  await new Promise(resolve=>setTimeout(resolve,10))
  assert.equal(harness.writes()[2].kind,'patches')
  assert.deepEqual(harness.writes()[2].patches,[{start:0,end:1,before:'b',after:'a'}])
})

test('arrow key nudges selected shape by one unit; Shift uses ten units',async()=>{
  const harness=createHarness()
  await harness.init()
  await find(harness.render(),node=>node.type==='button'&&node.children?.includes('Open')).props.onClick()
  let root=harness.render()
  const selected=find(root,node=>node.props?.['aria-label']==='Drag rect box')
  const target={parentElement:{getBoundingClientRect:()=>({width:200,height:200})},setPointerCapture:()=>{}}
  selected.props.onPointerDown({button:0,pointerId:11,clientX:10,clientY:10,currentTarget:target,preventDefault:()=>{}})
  selected.props.onPointerUp({pointerId:11,clientX:10,clientY:10})
  root=harness.render()
  let prevented=false
  root.props.onKeyDown({key:'ArrowRight',shiftKey:true,target:{tagName:'BUTTON'},preventDefault:()=>{prevented=true}})
  await new Promise(resolve=>setTimeout(resolve,10))
  assert.equal(prevented,true)
  assert.equal(harness.writes()[0].kind,'svg-attribute')
  assert.equal(harness.writes()[0].attribute,'x')
  assert.equal(harness.writes()[0].value,'20')
})

test('north-west resize preserves opposite bottom-right corner',async()=>{
  const harness=createHarness();await harness.init()
  await find(harness.render(),node=>node.type==='button'&&node.children?.includes('Open')).props.onClick()
  const target={parentElement:{getBoundingClientRect:()=>({width:200,height:200})},setPointerCapture:()=>{}}
  const control=find(harness.render(),node=>node.props?.['aria-label']==='Drag rect box')
  control.props.onPointerDown({button:0,pointerId:1,clientX:0,clientY:0,currentTarget:target,preventDefault:()=>{}})
  control.props.onPointerUp({pointerId:1,clientX:0,clientY:0})
  const nw=find(harness.render(),node=>node.props?.['aria-label']==='Resize NW rect box')
  assert.ok(nw)
  const handleTarget={...target,dataset:{corner:'nw'}}
  nw.props.onPointerDown({button:0,pointerId:2,clientX:0,clientY:0,currentTarget:handleTarget,stopPropagation:()=>{},preventDefault:()=>{}})
  nw.props.onPointerMove({pointerId:2,clientX:20,clientY:10})
  nw.props.onPointerUp({pointerId:2,clientX:20,clientY:10})
  await new Promise(resolve=>setTimeout(resolve,10))
  assert.deepEqual(harness.writes()[0].edits,[
    {id:'box',attribute:'x',value:'20'},
    {id:'box',attribute:'y',value:'25'},
    {id:'box',attribute:'width',value:'20'},
    {id:'box',attribute:'height',value:'35'}
  ])
})
test('Shift corner resize preserves original aspect ratio',async()=>{
  const harness=createHarness();await harness.init()
  await find(harness.render(),node=>node.type==='button'&&node.children?.includes('Open')).props.onClick()
  const target={parentElement:{getBoundingClientRect:()=>({width:200,height:200})},setPointerCapture:()=>{},dataset:{corner:'se'}}
  const control=find(harness.render(),node=>node.props?.['aria-label']==='Drag rect box')
  control.props.onPointerDown({button:0,pointerId:1,clientX:0,clientY:0,currentTarget:target,preventDefault:()=>{}})
  control.props.onPointerUp({pointerId:1,clientX:0,clientY:0})
  const resize=find(harness.render(),node=>node.props?.['aria-label']==='Resize rect box')
  resize.props.onPointerDown({button:0,pointerId:3,clientX:0,clientY:0,currentTarget:target,stopPropagation:()=>{},preventDefault:()=>{}})
  resize.props.onPointerUp({pointerId:3,clientX:20,clientY:0,shiftKey:true})
  await new Promise(resolve=>setTimeout(resolve,10))
  assert.deepEqual(harness.writes()[0].edits,[
    {id:'box',attribute:'x',value:'10'},
    {id:'box',attribute:'y',value:'20'},
    {id:'box',attribute:'width',value:'40'},
    {id:'box',attribute:'height',value:'53.333'}
  ])
})

test('Add Rectangle toolbar submits a native SVG shape creation without AI',async()=>{
  const harness=createHarness();await harness.init()
  await find(harness.render(),node=>node.type==='button'&&node.children?.includes('Open')).props.onClick()
  const add=find(harness.render(),node=>node.props?.['aria-label']==='Add rect')
  assert.ok(add,'A manual shape button should exist in the SVG editor')
  await add.props.onClick()
  assert.equal(harness.writes().length,0,'arming the tool does not write')
  const overlay=find(harness.render(),node=>node.props?.['aria-label']==='Direct manipulation overlay')
  await overlay.props.onPointerDownCapture({button:0,clientX:25,clientY:25,
    currentTarget:{getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})},preventDefault(){},stopPropagation(){}})
  assert.equal(harness.writes().length,1)
  assert.equal(harness.writes()[0].kind,'svg-add-shape')
  assert.equal(harness.writes()[0].shape,'rect')
})

test('contextual layer duplication is a native manual edit without an LLM call',async()=>{
  const harness=createHarness()
  await harness.init()
  await find(harness.render(),node=>node.type==='button'&&node.children?.includes('Open')).props.onClick()
  const selected=find(harness.render(),node=>node.props?.['aria-label']==='Drag rect box')
  const target={parentElement:{getBoundingClientRect:()=>({width:200,height:200})},setPointerCapture:()=>{}}
  selected.props.onPointerDown({button:0,pointerId:71,clientX:20,clientY:20,currentTarget:target,preventDefault:()=>{}})
  selected.props.onPointerUp({pointerId:71,clientX:20,clientY:20})
  const duplicate=find(harness.render(),node=>node.props?.['aria-label']==='Duplicate selected layer')
  assert.ok(duplicate)
  duplicate.props.onClick()
  await new Promise(resolve=>setTimeout(resolve,12))
  assert.equal(harness.writes().length,1)
  assert.equal(harness.writes()[0].kind,'svg-layer')
  assert.equal(harness.writes()[0].operation,'duplicate')
  assert.equal(harness.writes()[0].id,'box')
})
test('delete key on a selected layer sends native delete but not when editing text',async()=>{
  const harness=createHarness()
  await harness.init()
  await find(harness.render(),node=>node.type==='button'&&node.children?.includes('Open')).props.onClick()
  const layer=find(harness.render(),node=>node.type==='button'&&node.props?.['aria-label']==='Select layer rect #box')
  layer.props.onClick()
  let prevented=false
  harness.render().props.onKeyDown({key:'Delete',target:{tagName:'BUTTON'},preventDefault:()=>{prevented=true}})
  await new Promise(resolve=>setTimeout(resolve,12))
  assert.equal(prevented,true)
  assert.equal(harness.writes()[0].operation,'delete')
  harness.render().props.onKeyDown({key:'Delete',target:{tagName:'TEXTAREA'},preventDefault:()=>{throw Error('Keyboard event intercepted in editor')}})
  assert.equal(harness.writes().length,1)
})


test('zoom toolbar changes artboard scale without writing an SVG file', async()=>{
  const h=createHarness();await h.init()
  await find(h.render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  assert.equal(find(h.render(),n=>n.props?.['aria-label']==='Canvas zoom level').children[0],'100%')
  find(h.render(),n=>n.props?.['aria-label']==='Zoom in canvas').props.onClick()
  assert.equal(find(h.render(),n=>n.props?.['aria-label']==='Canvas zoom level').children[0],'125%')
  assert.match(find(h.render(),n=>n.props?.className==='dsh-studio-artboard').props.style.transform,/scale\(1.25\)/)
  find(h.render(),n=>n.props?.['aria-label']==='Zoom out canvas').props.onClick()
  assert.equal(find(h.render(),n=>n.props?.['aria-label']==='Canvas zoom level').children[0],'100%')
  assert.equal(h.writes().length,0)
})
test('Ctrl+wheel zoom anchors the hovered point rather than jumping to center',async()=>{
  const h=createHarness();await h.init()
  await find(h.render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  const viewport=find(h.render(),n=>n.props?.['aria-label']==='Canvas viewport')
  viewport.props.ref.current={getBoundingClientRect:()=>({left:10,top:20,width:400,height:300})}
  let prevented=false
  viewport.props.onWheel({ctrlKey:true,deltaX:0,deltaY:-100,clientX:310,clientY:170,target:{tagName:'DIV'},preventDefault(){prevented=true}})
  assert.equal(prevented,true)
  const transform=find(h.render(),n=>n.props?.className==='dsh-studio-artboard').props.style.transform
  const match=/translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(transform)
  assert.ok(match,transform)
  const zoom=Number(match[3]),x=Number(match[1]),y=Number(match[2])
  assert.ok(Math.abs(zoom-Math.exp(0.2))<1e-9)
  assert.ok(Math.abs(x-(1-zoom)*100)<1e-9,'Hovered x remains fixed under zoom')
  assert.ok(Math.abs(y)<1e-9)
  assert.equal(h.writes().length,0)
})
test('hand tool pans via mouse/touch pointer events and never mutates source',async()=>{
  const h=createHarness();await h.init()
  await find(h.render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  find(h.render(),n=>n.props?.['aria-label']==='Pan canvas tool').props.onClick()
  const viewport=find(h.render(),n=>n.props?.['aria-label']==='Canvas viewport')
  let captured=false
  const target={getBoundingClientRect:()=>({left:0,top:0,width:500,height:400}),setPointerCapture:()=>{captured=true}}
  viewport.props.onPointerDown({button:0,pointerId:42,clientX:80,clientY:90,pointerType:'touch',currentTarget:target,preventDefault(){}})
  viewport.props.onPointerMove({pointerId:42,clientX:120,clientY:115})
  viewport.props.onPointerUp({pointerId:42})
  assert.equal(captured,true)
  assert.match(find(h.render(),n=>n.props?.className==='dsh-studio-artboard').props.style.transform,/translate\(40px, 25px\)/)
  assert.equal(h.writes().length,0)
})
test('middle-button panning works without switching out of selection tool',async()=>{
  const h=createHarness();await h.init()
  await find(h.render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  const viewport=find(h.render(),n=>n.props?.['aria-label']==='Canvas viewport')
  viewport.props.onPointerDown({button:1,pointerId:4,clientX:20,clientY:30,currentTarget:{
    getBoundingClientRect:()=>({left:0,top:0,width:500,height:400}),setPointerCapture(){}},preventDefault(){}})
  viewport.props.onPointerMove({pointerId:4,clientX:10,clientY:50})
  viewport.props.onPointerCancel({pointerId:4})
  assert.match(find(h.render(),n=>n.props?.className==='dsh-studio-artboard').props.style.transform,/translate\(-10px, 20px\)/)
  assert.equal(h.writes().length,0)
})
test('normal trackpad wheel pans viewport while remaining offline and read-only',async()=>{
  const h=createHarness();await h.init()
  await find(h.render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  const viewport=find(h.render(),n=>n.props?.['aria-label']==='Canvas viewport')
  viewport.props.onWheel({deltaX:8,deltaY:12,target:{tagName:'DIV'},preventDefault(){}})
  assert.match(find(h.render(),n=>n.props?.className==='dsh-studio-artboard').props.style.transform,/translate\(-8px, -12px\)/)
  assert.equal(h.writes().length,0)
})
test('Fit recenters portrait artboard within known viewport without any file save',async()=>{
  const h=createHarness();await h.init()
  await find(h.render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  const viewport=find(h.render(),n=>n.props?.['aria-label']==='Canvas viewport')
  viewport.props.ref.current={getBoundingClientRect:()=>({left:0,top:0,width:500,height:200})}
  find(h.render(),n=>n.props?.['aria-label']==='Zoom in canvas').props.onClick()
  find(h.render(),n=>n.props?.['aria-label']==='Fit canvas view').props.onClick()
  const transform=find(h.render(),n=>n.props?.className==='dsh-studio-artboard').props.style.transform
  assert.match(transform,/translate\(0px, 0px\)/)
  assert.match(transform,/scale\(0.344\)/)
  assert.equal(h.writes().length,0)
})
test('moving an SVG handle at zoom level 125% preserves SVG coordinates',async()=>{
  const h=createHarness();await h.init()
  await find(h.render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  find(h.render(),n=>n.props?.['aria-label']==='Zoom in canvas').props.onClick()
  const control=find(h.render(),n=>n.props?.['aria-label']==='Drag rect box')
  const target={parentElement:{getBoundingClientRect:()=>({width:250,height:250})},setPointerCapture(){}}
  control.props.onPointerDown({button:0,pointerId:9,clientX:40,clientY:50,currentTarget:target,preventDefault(){}})
  control.props.onPointerUp({pointerId:9,clientX:65,clientY:75})
  await new Promise(resolve=>setTimeout(resolve,15))
  assert.equal(h.writes().length,1)
  assert.deepEqual(h.writes()[0].edits,[
    {id:'box',attribute:'x',value:'20'},
    {id:'box',attribute:'y',value:'30'},
  ])
})
test('V/H keyboard tool switching avoids SVG writes and editable inputs',async()=>{
  const h=createHarness();await h.init()
  await find(h.render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  let used=false
  h.render().props.onKeyDown({key:'h',target:{tagName:'BUTTON'},preventDefault(){used=true}})
  assert.equal(used,true)
  let pan=find(h.render(),n=>n.props?.['aria-label']==='Pan canvas tool')
  assert.equal(pan.props.style.background,'#51483d')
  h.render().props.onKeyDown({key:'v',target:{tagName:'TEXTAREA'},preventDefault(){throw Error('Input shortcut hijacked')}})
  assert.equal(find(h.render(),n=>n.props?.['aria-label']==='Pan canvas tool').props.style.background,'#51483d')
  h.render().props.onKeyDown({key:'v',target:{tagName:'BUTTON'},preventDefault(){}})
  assert.equal(find(h.render(),n=>n.props?.['aria-label']==='Select canvas tool').props.style.background,'#51483d')
  assert.equal(h.writes().length,0)
})


test('Space temporarily pans instead of dragging selected artwork',async()=>{
  const h=createHarness();await h.init()
  await find(h.render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  const root=h.render()
  let prevent=false
  root.props.onKeyDown({key:' ',code:'Space',target:{tagName:'BUTTON'},preventDefault(){prevent=true}})
  assert.equal(prevent,true)
  assert.equal(find(h.render(),n=>n.props?.['aria-label']==='Select canvas tool').props.style.background,'#51483d')
  const shape=find(h.render(),n=>n.props?.['aria-label']==='Drag rect box')
  const target={parentElement:{getBoundingClientRect:()=>({width:200,height:200})},setPointerCapture(){}}
  let shapePrevented=false
  shape.props.onPointerDown({button:0,pointerId:5,clientX:10,clientY:10,currentTarget:target,preventDefault(){shapePrevented=true}})
  assert.equal(shapePrevented,false,'Artwork must not capture pointer while Space is held')
  const viewport=find(h.render(),n=>n.props?.['aria-label']==='Canvas viewport')
  viewport.props.onPointerDown({button:0,pointerId:5,clientX:10,clientY:10,currentTarget:{
    getBoundingClientRect:()=>({width:400,height:300}),setPointerCapture(){}},preventDefault(){}})
  viewport.props.onPointerMove({pointerId:5,clientX:60,clientY:30})
  viewport.props.onPointerUp({pointerId:5})
  assert.match(find(h.render(),n=>n.props?.className==='dsh-studio-artboard').props.style.transform,/translate\(50px, 20px\)/)
  assert.equal(h.writes().length,0)
  h.render().props.onKeyUp({key:' ',code:'Space'})
  assert.match(find(h.render(),n=>n.props?.['aria-label']==='Drag rect box').props.style.cursor,/move/)
})
test('Space hand mode lets pan gestures pass through resize handles',async()=>{
  const h=createHarness();await h.init()
  await find(h.render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  const shape=find(h.render(),n=>n.props?.['aria-label']==='Drag rect box')
  const target={parentElement:{getBoundingClientRect:()=>({width:200,height:200})},setPointerCapture(){}}
  shape.props.onPointerDown({button:0,pointerId:1,clientX:10,clientY:10,currentTarget:target,preventDefault(){}})
  shape.props.onPointerUp({pointerId:1,clientX:10,clientY:10})
  h.render().props.onKeyDown({key:' ',target:{tagName:'BUTTON'},preventDefault(){}})
  const corner=find(h.render(),n=>n.props?.['aria-label']==='Resize NW rect box')
  assert.ok(corner)
  let stopped=false
  corner.props.onPointerDown({button:0,pointerId:2,clientX:10,clientY:10,currentTarget:{
    dataset:{corner:'nw'},parentElement:{getBoundingClientRect:()=>({width:200,height:200})}
  },stopPropagation(){stopped=true},preventDefault(){}})
  assert.equal(stopped,false,'Temporary hand tool must allow pointer events to bubble to viewport')
  assert.equal(h.writes().length,0)
})


test('grid toggles and spacing change only the document overlay, not its SVG source',async()=>{
  const h=createHarness();await h.init()
  await find(h.render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  assert.equal(find(h.render(),n=>n.props?.className==='dsh-studio-document-grid'),null)
  const toggle=find(h.render(),n=>n.props?.['aria-label']==='Toggle canvas grid')
  assert.equal(toggle.props['aria-pressed'],false)
  toggle.props.onClick()
  assert.equal(find(h.render(),n=>n.props?.className==='dsh-studio-document-grid').props.style.backgroundSize,'10% 10%')
  assert.equal(find(h.render(),n=>n.props?.['aria-label']==='Toggle canvas grid').props['aria-pressed'],true)
  find(h.render(),n=>n.props?.['aria-label']==='Grid spacing').props.onChange({target:{value:'20'}})
  assert.equal(find(h.render(),n=>n.props?.className==='dsh-studio-document-grid').props.style.backgroundSize,'20% 20%')
  toggle.props.onClick()
  assert.equal(find(h.render(),n=>n.props?.className==='dsh-studio-document-grid'),null)
  assert.equal(h.writes().length,0)
})
test('grid snap commits SVG coordinates at chosen step without AI',async()=>{
  const h=createHarness();await h.init()
  await find(h.render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  find(h.render(),n=>n.props?.['aria-label']==='Toggle smart alignment guides').props.onClick()
  find(h.render(),n=>n.props?.['aria-label']==='Toggle snap to grid').props.onClick()
  const shape=find(h.render(),n=>n.props?.['aria-label']==='Drag rect box')
  const target={parentElement:{getBoundingClientRect:()=>({width:200,height:200})},setPointerCapture(){}}
  shape.props.onPointerDown({button:0,pointerId:10,clientX:0,clientY:0,currentTarget:target,preventDefault(){}})
  shape.props.onPointerMove({pointerId:10,clientX:13,clientY:0})
  const preview=find(h.render(),n=>n.props?.['aria-label']==='Drag rect box')
  assert.equal(preview.props.style.left,'20%')
  assert.equal(h.writes().length,0,'Grid previews must not save before gesture release')
  shape.props.onPointerUp({pointerId:10,clientX:13,clientY:0})
  await new Promise(resolve=>setTimeout(resolve,16))
  assert.equal(h.writes().length,1)
  assert.deepEqual(h.writes()[0].edits,[
    {id:'box',attribute:'x',value:'20'},
    {id:'box',attribute:'y',value:'20'}
  ])
})
test('changing snap step to 5 units snaps to nearest user-space coordinate',async()=>{
  const h=createHarness();await h.init()
  await find(h.render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  find(h.render(),n=>n.props?.['aria-label']==='Toggle smart alignment guides').props.onClick()
  find(h.render(),n=>n.props?.['aria-label']==='Toggle snap to grid').props.onClick()
  find(h.render(),n=>n.props?.['aria-label']==='Grid spacing').props.onChange({target:{value:'5'}})
  const shape=find(h.render(),n=>n.props?.['aria-label']==='Drag rect box')
  shape.props.onPointerDown({button:0,pointerId:20,clientX:0,clientY:0,currentTarget:{
    parentElement:{getBoundingClientRect:()=>({width:200,height:200})},setPointerCapture(){}
  },preventDefault(){}})
  shape.props.onPointerUp({pointerId:20,clientX:14,clientY:0})
  await new Promise(resolve=>setTimeout(resolve,16))
  assert.equal(h.writes()[0].edits[0].value,'15')
  assert.equal(h.writes()[0].edits[1].value,'20')
})
test('smart alignment shows a warm guide and aligns the moved right edge to canvas center',async()=>{
  const h=createHarness();await h.init()
  await find(h.render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  const shape=find(h.render(),n=>n.props?.['aria-label']==='Drag rect box')
  shape.props.onPointerDown({button:0,pointerId:30,clientX:0,clientY:0,currentTarget:{
    parentElement:{getBoundingClientRect:()=>({width:200,height:200})},setPointerCapture(){}
  },preventDefault(){}})
  shape.props.onPointerMove({pointerId:30,clientX:16,clientY:0})
  const guide=find(h.render(),n=>n.props?.className==='dsh-studio-guide-x')
  assert.ok(guide,'Center alignment should show a visible vertical guide')
  assert.equal(guide.props.style.left,'50%')
  assert.equal(h.writes().length,0)
  shape.props.onPointerUp({pointerId:30,clientX:16,clientY:0})
  await new Promise(resolve=>setTimeout(resolve,16))
  assert.equal(h.writes()[0].edits[0].value,'20')
  assert.equal(find(h.render(),n=>n.props?.className==='dsh-studio-guide-x'),null)
})
test('disabling smart guides leaves unaligned user-space movement unchanged',async()=>{
  const h=createHarness();await h.init()
  await find(h.render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  find(h.render(),n=>n.props?.['aria-label']==='Toggle smart alignment guides').props.onClick()
  const shape=find(h.render(),n=>n.props?.['aria-label']==='Drag rect box')
  shape.props.onPointerDown({button:0,pointerId:40,clientX:0,clientY:0,currentTarget:{
    parentElement:{getBoundingClientRect:()=>({width:200,height:200})},setPointerCapture(){}
  },preventDefault(){}})
  shape.props.onPointerMove({pointerId:40,clientX:16,clientY:0})
  assert.equal(find(h.render(),n=>n.props?.className==='dsh-studio-guide-x'),null)
  shape.props.onPointerUp({pointerId:40,clientX:16,clientY:0})
  await new Promise(resolve=>setTimeout(resolve,16))
  assert.equal(h.writes()[0].edits[0].value,'18')
})
test('resizing a corner snaps its moving endpoint to grid and keeps opposite corner',async()=>{
  const h=createHarness();await h.init()
  await find(h.render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  find(h.render(),n=>n.props?.['aria-label']==='Toggle snap to grid').props.onClick()
  const select=find(h.render(),n=>n.props?.['aria-label']==='Drag rect box')
  const target={parentElement:{getBoundingClientRect:()=>({width:200,height:200})},setPointerCapture(){}}
  select.props.onPointerDown({button:0,pointerId:1,clientX:0,clientY:0,currentTarget:target,preventDefault(){}})
  select.props.onPointerUp({pointerId:1,clientX:0,clientY:0})
  const resize=find(h.render(),n=>n.props?.['aria-label']==='Resize rect box')
  resize.props.onPointerDown({button:0,pointerId:50,clientX:0,clientY:0,currentTarget:{...target,dataset:{corner:'se'}},stopPropagation(){},preventDefault(){}})
  resize.props.onPointerMove({pointerId:50,clientX:13,clientY:0})
  resize.props.onPointerUp({pointerId:50,clientX:13,clientY:0})
  await new Promise(resolve=>setTimeout(resolve,16))
  assert.deepEqual(h.writes()[0].edits,[
    {id:'box',attribute:'x',value:'10'},
    {id:'box',attribute:'y',value:'20'},
    {id:'box',attribute:'width',value:'40'},
    {id:'box',attribute:'height',value:'40'}
  ])
})
test('cancelled grid-snap gestures never save source changes',async()=>{
  const h=createHarness();await h.init()
  await find(h.render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  find(h.render(),n=>n.props?.['aria-label']==='Toggle snap to grid').props.onClick()
  const shape=find(h.render(),n=>n.props?.['aria-label']==='Drag rect box')
  shape.props.onPointerDown({button:0,pointerId:88,clientX:0,clientY:0,currentTarget:{
    parentElement:{getBoundingClientRect:()=>({width:200,height:200})},setPointerCapture(){}
  },preventDefault(){}})
  shape.props.onPointerMove({pointerId:88,clientX:34,clientY:0})
  shape.props.onPointerCancel({pointerId:88,clientX:34,clientY:0})
  await new Promise(resolve=>setTimeout(resolve,12))
  assert.equal(h.writes().length,0)
  assert.equal(find(h.render(),n=>n.props?.className==='dsh-studio-guide-x'),null)
})


test('Alt bypasses both smart guides and grid snapping for precise positioning',async()=>{
  const h=createHarness();await h.init()
  await find(h.render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  find(h.render(),n=>n.props?.['aria-label']==='Toggle snap to grid').props.onClick()
  const shape=find(h.render(),n=>n.props?.['aria-label']==='Drag rect box')
  shape.props.onPointerDown({button:0,pointerId:101,clientX:0,clientY:0,currentTarget:{
    parentElement:{getBoundingClientRect:()=>({width:200,height:200})},setPointerCapture(){}
  },preventDefault(){}})
  shape.props.onPointerMove({pointerId:101,clientX:13,clientY:0,altKey:true})
  assert.equal(find(h.render(),n=>n.props?.['aria-label']==='Drag rect box').props.style.left,'16.5%')
  assert.equal(find(h.render(),n=>n.props?.className==='dsh-studio-guide-x'),null)
  shape.props.onPointerUp({pointerId:101,clientX:13,clientY:0,altKey:true})
  await new Promise(resolve=>setTimeout(resolve,16))
  assert.equal(h.writes().length,1)
  assert.equal(h.writes()[0].edits[0].value,'16.5')
  assert.equal(h.writes()[0].edits[1].value,'20')
})
test('smart guides align moving object edges to nearby SVG sibling edges',async()=>{
  const sibling={id:'neighbor',tag:'rect',x:70,y:25,width:10,height:20,
    move:{x:'x',y:'y',initialX:70,initialY:25},resizable:true}
  const h=createHarness([sibling]);await h.init()
  await find(h.render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  const shape=find(h.render(),n=>n.props?.['aria-label']==='Drag rect box')
  shape.props.onPointerDown({button:0,pointerId:102,clientX:0,clientY:0,currentTarget:{
    parentElement:{getBoundingClientRect:()=>({width:200,height:200})},setPointerCapture(){}
  },preventDefault(){}})
  shape.props.onPointerMove({pointerId:102,clientX:56,clientY:0})
  assert.equal(find(h.render(),n=>n.props?.className==='dsh-studio-guide-x').props.style.left,'70%')
  shape.props.onPointerUp({pointerId:102,clientX:56,clientY:0})
  await new Promise(resolve=>setTimeout(resolve,16))
  assert.equal(h.writes()[0].edits[0].value,'40','right edge should align exactly to neighbor left edge')
})


function samplePath() {
  const d='M1 2 C3 4 5 6 7 8'
  const span=(token)=>{const start=d.indexOf(token);return {start,end:start+token.length}}
  return {
    id:'curve',editable:true,d,
    segments:[{commandIndex:2,type:'C',midpoint:{x:4,y:5},removable:false,endIndex:3}],
    points:[
      {index:0,role:'anchor',x:1,y:2,xSpan:span('1'),ySpan:span('2'),linkIndex:null},
      {index:1,role:'cubic-in',x:3,y:4,xSpan:span('3'),ySpan:span('4'),linkIndex:0},
      {index:2,role:'cubic-out',x:5,y:6,xSpan:span('5'),ySpan:span('6'),linkIndex:3},
      {index:3,role:'anchor',x:7,y:8,xSpan:span('7'),ySpan:span('8'),linkIndex:null}
    ]
  }
}
test('selecting an editable path exposes anchor and Bézier control handles',async()=>{
  const h=createHarness([],[samplePath()]);await h.init()
  await find(h.render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  const layer=find(h.render(),n=>n.type==='button'&&n.props?.['aria-label']==='Select layer path #curve')
  assert.ok(layer)
  layer.props.onClick()
  assert.ok(find(h.render(),n=>n.props?.className==='dsh-studio-path-overlay'))
  for(let i=0;i<4;i++)assert.ok(find(h.render(),n=>n.props?.['aria-label']==='Move path point '+i+' of curve'))
  const lines=find(h.render(),n=>n.type==='line'&&n.props.key==='path-connector-2')
  assert.ok(lines,'Bezier control lines must connect to their anchors')
  assert.equal(h.writes().length,0)
})
test('dragging a Bézier control previews live path without writes then commits one native action',async()=>{
  const h=createHarness([],[samplePath()]);await h.init()
  await find(h.render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  find(h.render(),n=>n.type==='button'&&n.props?.['aria-label']==='Select layer path #curve').props.onClick()
  const control=find(h.render(),n=>n.props?.['aria-label']==='Move path point 2 of curve')
  let captured=false,stopped=false
  const target={parentElement:{getBoundingClientRect:()=>({width:200,height:200})},setPointerCapture(){captured=true}}
  control.props.onPointerDown({button:0,pointerId:55,clientX:0,clientY:0,currentTarget:target,
    stopPropagation(){stopped=true},preventDefault(){}})
  control.props.onPointerMove({pointerId:55,clientX:20,clientY:10})
  assert.equal(captured,true)
  assert.equal(stopped,true)
  const overlay=find(h.render(),n=>n.props?.className==='dsh-studio-path-overlay')
  const preview=find(overlay,n=>n.type==='path')
  assert.equal(preview.props.d,'M1 2 C3 4 15 11 7 8')
  assert.equal(h.writes().length,0)
  control.props.onPointerUp({pointerId:55,clientX:20,clientY:10})
  await new Promise(resolve=>setTimeout(resolve,18))
  assert.equal(h.writes().length,1)
  assert.equal(h.writes()[0].kind,'svg-path-point')
  assert.equal(h.writes()[0].id,'curve')
  assert.equal(h.writes()[0].index,2)
  assert.equal(h.writes()[0].x,15)
  assert.equal(h.writes()[0].y,11)
  assert.equal(find(h.render(),n=>n.props?.className==='dsh-studio-path-overlay')?.children[0]?.props?.d,'M1 2 C3 4 5 6 7 8')
})
test('Alt bypasses grid snap for Bézier nodes; cancel causes no save',async()=>{
  const h=createHarness([],[samplePath()]);await h.init()
  await find(h.render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  find(h.render(),n=>n.type==='button'&&n.props?.['aria-label']==='Select layer path #curve').props.onClick()
  find(h.render(),n=>n.props?.['aria-label']==='Toggle snap to grid').props.onClick()
  const control=find(h.render(),n=>n.props?.['aria-label']==='Move path point 1 of curve')
  const target={parentElement:{getBoundingClientRect:()=>({width:200,height:200})},setPointerCapture(){}}
  control.props.onPointerDown({button:0,pointerId:5,clientX:0,clientY:0,currentTarget:target,stopPropagation(){},preventDefault(){}})
  control.props.onPointerMove({pointerId:5,clientX:16,clientY:4,altKey:true})
  assert.equal(find(h.render(),n=>n.props?.['aria-label']==='Move path point 1 of curve').props.style.left,'11%')
  control.props.onPointerCancel({pointerId:5,clientX:16,clientY:4})
  await new Promise(resolve=>setTimeout(resolve,15))
  assert.equal(h.writes().length,0)
})
test('unsupported complex path remains selectable but has no active point controls',async()=>{
  const h=createHarness([],[{id:'curve',editable:false,reason:'unsupported-path',points:[]}]);await h.init()
  await find(h.render(),n=>n.type==='button'&&n.children?.includes('Open')).props.onClick()
  find(h.render(),n=>n.type==='button'&&n.props?.['aria-label']==='Select layer path #curve').props.onClick()
  assert.equal(find(h.render(),n=>n.props?.className==='dsh-studio-path-overlay'),null)
  assert.equal(find(h.render(),n=>n.props?.['aria-label']==='Move path point 0 of curve'),null)
  assert.equal(h.writes().length,0)
})


test('Add Path action inserts a native editable cubic without AI',async()=>{
  const h=createHarness();await h.init()
  await find(h.render(),node=>node.type==='button'&&node.children?.includes('Open')).props.onClick()
  const add=find(h.render(),node=>node.props?.['aria-label']==='Add path')
  assert.ok(add,'Toolbar must expose an explicit path creation tool')
  add.props.onClick()
  await new Promise(resolve=>setTimeout(resolve,16))
  assert.equal(h.writes().length,1)
  assert.equal(h.writes()[0].kind,'svg-add-shape')
  assert.equal(h.writes()[0].shape,'path')
})
test('one-axis grid snap keeps the untouched Bézier coordinate stable',async()=>{
  const h=createHarness([],[samplePath()]);await h.init()
  await find(h.render(),node=>node.type==='button'&&node.children?.includes('Open')).props.onClick()
  find(h.render(),node=>node.type==='button'&&node.props?.['aria-label']==='Select layer path #curve').props.onClick()
  find(h.render(),node=>node.props?.['aria-label']==='Toggle snap to grid').props.onClick()
  const node=find(h.render(),n=>n.props?.['aria-label']==='Move path point 1 of curve')
  node.props.onPointerDown({button:0,pointerId:100,clientX:0,clientY:0,currentTarget:{
    parentElement:{getBoundingClientRect:()=>({width:200,height:200})},setPointerCapture(){}
  },stopPropagation(){},preventDefault(){}})
  node.props.onPointerUp({pointerId:100,clientX:20,clientY:0})
  await new Promise(resolve=>setTimeout(resolve,18))
  assert.equal(h.writes().length,1)
  assert.equal(h.writes()[0].kind,'svg-path-point')
  assert.equal(h.writes()[0].x,10)
  assert.equal(h.writes()[0].y,4)
})


test('Escape cancels an in-progress Bézier edit without committing the SVG',async()=>{
  const h=createHarness([],[samplePath()]);await h.init()
  await find(h.render(),node=>node.type==='button'&&node.children?.includes('Open')).props.onClick()
  find(h.render(),node=>node.type==='button'&&node.props?.['aria-label']==='Select layer path #curve').props.onClick()
  const control=find(h.render(),n=>n.props?.['aria-label']==='Move path point 1 of curve')
  const target={parentElement:{getBoundingClientRect:()=>({width:200,height:200})},setPointerCapture(){}}
  control.props.onPointerDown({button:0,pointerId:19,clientX:0,clientY:0,currentTarget:target,stopPropagation(){},preventDefault(){}})
  control.props.onPointerMove({pointerId:19,clientX:20,clientY:20})
  let prevented=false
  h.render().props.onKeyDown({key:'Escape',target:{tagName:'BUTTON'},preventDefault(){prevented=true}})
  control.props.onPointerUp({pointerId:19,clientX:20,clientY:20})
  await new Promise(resolve=>setTimeout(resolve,15))
  assert.equal(prevented,true)
  assert.equal(h.writes().length,0)
  assert.equal(find(h.render(),n=>n.props?.className==='dsh-studio-path-overlay')?.children[0]?.props?.d,'M1 2 C3 4 5 6 7 8')
})


test('canvas midpoint + button commits a native curve subdivision without changing source on render',async()=>{
  const h=createHarness([],[samplePath()]);await h.init()
  await find(h.render(),node=>node.type==='button'&&node.children?.includes('Open')).props.onClick()
  find(h.render(),node=>node.type==='button'&&node.props?.['aria-label']==='Select layer path #curve').props.onClick()
  const midpoint=find(h.render(),node=>node.props?.['aria-label']==='Insert path point on segment 2 of curve')
  assert.ok(midpoint)
  assert.equal(h.writes().length,0)
  midpoint.props.onClick()
  await new Promise(resolve=>setTimeout(resolve,18))
  assert.equal(h.writes().length,1)
  assert.deepEqual({kind:h.writes()[0].kind,id:h.writes()[0].id,operation:h.writes()[0].operation,
    commandIndex:h.writes()[0].commandIndex},
    {kind:'svg-path-topology',id:'curve',operation:'insert',commandIndex:2})
})
test('curve inspector permits insertion but does not expose destructive Bézier removal',async()=>{
  const h=createHarness([],[samplePath()]);await h.init()
  await find(h.render(),node=>node.type==='button'&&node.children?.includes('Open')).props.onClick()
  find(h.render(),node=>node.type==='button'&&node.props?.['aria-label']==='Select layer path #curve').props.onClick()
  assert.ok(find(h.render(),node=>node.props?.['aria-label']==='Insert midpoint segment 2'))
  assert.equal(find(h.render(),node=>node.props?.['aria-label']==='Remove line point segment 2'),null)
})
test('inspector removes only a selected supported line endpoint with one native operation',async()=>{
  const path={id:'line',editable:true,d:'M1 1 L5 5',
    segments:[{commandIndex:2,type:'L',midpoint:{x:3,y:3},removable:true,endIndex:1}],
    points:[{index:0,role:'anchor',x:1,y:1},{index:1,role:'anchor',x:5,y:5}]}
  const h=createHarness([],[path]);await h.init()
  await find(h.render(),node=>node.type==='button'&&node.children?.includes('Open')).props.onClick()
  find(h.render(),node=>node.type==='button'&&node.props?.['aria-label']==='Select layer path #line').props.onClick()
  const remove=find(h.render(),node=>node.props?.['aria-label']==='Remove line point segment 2')
  assert.ok(remove)
  remove.props.onClick()
  await new Promise(resolve=>setTimeout(resolve,18))
  assert.equal(h.writes().length,1)
  assert.deepEqual([h.writes()[0].kind,h.writes()[0].operation,h.writes()[0].commandIndex],
    ['svg-path-topology','remove',2])
})

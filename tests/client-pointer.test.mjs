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

function createHarness() {
  const state=[]
  let index=0
  let component
  let writes=[]
  const React = {
    createElement:(type,props,...children)=>({type,props:props||{},children}),
    useState(initial) {
      const i=index++
      if(!(i in state))state[i]=initial
      return [state[i],next=>{state[i]=typeof next==='function'?next(state[i]):next}]
    },
    useRef(initial) {
      const i=index++
      if(!(i in state))state[i]={current:initial}
      return state[i]
    },
  }
  let registration
  const ctx={slots:{inject:(_name,callback)=>callback(),register:(details,view)=>{registration=details;component=view;return()=>{}}}}
  const fetch=async (url,options={})=>{
    assert.ok(String(url).includes('design-studio-native/'),'Editor must not call AI endpoints')
    if(options.method==='POST'){
      writes.push(JSON.parse(options.body))
      return {ok:true,json:async()=>({ok:true,result:{changed:true,inverse:[{start:0,end:1,before:'a',after:'b'}]},patches:[{start:0,end:1,before:'b',after:'a'}]})}
    }
    return {ok:true,json:async()=>({
      ok:true,document:documentData,
      nodes:[{id:'box',tag:'rect',attributes:{x:'10',y:'20',width:'30',height:'40'}}],
      geometry:{artboard:{x:0,y:0,width:100,height:100},handles:[handle]},warning:null
    })}
  }
  let definition
  return {
    async init() {
      runInNewContext(await readFile(new URL('../client.js',import.meta.url),'utf8'),{
        window:{__ModuleLoader__:{load:d=>definition=d}},URL,
        document:{baseURI:'https://dsh.example/'},fetch
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
  const layer=find(harness.render(),node=>node.type==='button'&&node.children?.includes('rect #box'))
  layer.props.onClick()
  let prevented=false
  harness.render().props.onKeyDown({key:'Delete',target:{tagName:'BUTTON'},preventDefault:()=>{prevented=true}})
  await new Promise(resolve=>setTimeout(resolve,12))
  assert.equal(prevented,true)
  assert.equal(harness.writes()[0].operation,'delete')
  harness.render().props.onKeyDown({key:'Delete',target:{tagName:'TEXTAREA'},preventDefault:()=>{throw Error('Keyboard event intercepted in editor')}})
  assert.equal(harness.writes().length,1)
})

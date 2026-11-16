import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const source = '<svg viewBox="0 0 100 100"><rect id="box" x="10" y="20" width="30" height="40"/></svg>'
const documentData = { file: 'design.svg', format: 'svg', source, hash: 'original-sha256' }
const handle = {
  id:'box',tag:'rect',x:10,y:20,width:30,height:40,
  move:{x:'x',y:'y',initialX:10,initialY:20}
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
      return {ok:true,json:async()=>({ok:true,result:{changed:true}})}
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

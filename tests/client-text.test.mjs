import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const textSource='<svg viewBox="0 0 200 100"><text id="txt" x="15" y="30" font-size="18" font-family="Inter, Arial" font-weight="500" font-style="normal" letter-spacing="0" text-anchor="start" fill="#eeeeee">Hello</text></svg>'
const textAttrs={x:'15',y:'30','font-size':'18','font-family':'Inter, Arial','font-weight':'500','font-style':'normal','letter-spacing':'0','text-anchor':'start',fill:'#eeeeee'}
const textHandle={id:'txt',tag:'text',text:true,x:15,y:12,width:48,height:23,move:{x:'x',y:'y',initialX:15,initialY:30},resizable:false}

function locate(node,predicate) {
  if(Array.isArray(node)) {for(const item of node){const found=locate(item,predicate);if(found)return found}return null}
  if(!node||typeof node!=='object')return null
  if(predicate(node))return node
  return locate(node.children||[],predicate)
}

async function mockClient() {
  const state=[];let at=0,component,plugin
  const writes=[]
  const effects={}; const cleanups=[]
  const React={
    createElement:(type,props,...children)=>({type,props:props||{},children}),
    useState(initial) {
      const i=at++
      if(!(i in state))state[i]=initial
      return [state[i],next=>{state[i]=typeof next==='function'?next(state[i]):next}]
    },
    // The real client half receives DSH's full React 18, so effects are part of
    // its contract. This mock only has to keep hook order stable and run an
    // effect when its dependencies change; behavioural coverage of the effects
    // lives in the browser gate (tests/browser/specs/landing.mjs).
    useEffect(effect, deps) {
      const i=at++
      const previous=effects[i]
      const changed=!previous||!deps||deps.length!==previous.length||
        deps.some((value,index)=>value!==previous[index])
      if(!changed) return
      effects[i]=deps
      const cleanup=effect()
      if(typeof cleanup==='function') cleanups.push(cleanup)
    },
    useRef(initial) {
      const i=at++
      if(!(i in state))state[i]={current:initial}
      return state[i]
    }
  }
  const fetch=async (url,options={})=>{
    assert.ok(new URL(String(url)).pathname.startsWith('/design-studio-native/'),'Manual editing must target native root routes, never LLM')
    if(options.method==='POST'){
      writes.push(JSON.parse(options.body))
      return {ok:true,json:async()=>({ok:true,result:{changed:true,inverse:[]},patches:[]})}
    }
    return {ok:true,json:async()=>({
      ok:true,document:{file:'design.svg',format:'svg',source:textSource,hash:'mock-original'},
      nodes:[{id:'txt',tag:'text',attributes:textAttrs}],
      textNodes:[{id:'txt',text:'Hello',editable:true,attributes:textAttrs}],
      geometry:{artboard:{x:0,y:0,width:200,height:100},handles:[textHandle]},warning:null
    })}
  }
  runInNewContext(await readFile(new URL('../client.js',import.meta.url),'utf8'),{
    window:{__ModuleLoader__:{load:d=>plugin=d}},URL,fetch,document:{baseURI:'https://dsh.example/workspaces/conversation/session/'}
  })
  const p=plugin.factory(name=>{assert.equal(name,'react');return React})
  p.apply({slots:{inject:(_,fn)=>fn(),register:(_,c)=>{component=c}}})
  const render=()=>{at=0;return component({sessionId:'known'})}
  await locate(render(),n=>n.type==='button'&&n.children.includes('Open')).props.onClick()
  return {render,writes}
}

test('text layer exposes a typography inspector and a content field',async()=>{
  const h=await mockClient()
  const layer=locate(h.render(),n=>n.type==='button'&&n.children?.includes('text #txt'))
  assert.ok(layer)
  layer.props.onClick()
  const inspector=locate(h.render(),n=>n.props?.['aria-label']==='Text content')
  assert.ok(inspector)
  assert.equal(inspector.props.value,'Hello')
})
test('double-click on text canvas handle starts inline editing and commits native source operation',async()=>{
  const h=await mockClient()
  const layer=locate(h.render(),n=>n.props?.['aria-label']==='Drag text txt')
  assert.ok(layer)
  layer.props.onDoubleClick()
  const inline=locate(h.render(),n=>n.props?.['aria-label']==='Edit SVG text inline')
  assert.ok(inline)
  inline.props.onChange({target:{value:'Hello <Design> & everyone'}})
  const submit=locate(h.render(),n=>n.type==='button'&&n.children?.includes('Apply text'))
  assert.ok(submit)
  submit.props.onClick()
  await new Promise(resolve=>setTimeout(resolve,12))
  assert.equal(h.writes.length,1)
  assert.equal(h.writes[0].kind,'svg-text')
  assert.equal(h.writes[0].id,'txt')
  assert.equal(h.writes[0].value,'Hello <Design> & everyone')
})
test('typography select issues restricted source update without AI',async()=>{
  const h=await mockClient()
  locate(h.render(),n=>n.type==='button'&&n.children?.includes('text #txt')).props.onClick()
  const picker=locate(h.render(),n=>n.type==='select'&&n.props.value==='Inter, Arial')
  assert.ok(picker)
  picker.props.onChange({target:{value:'Georgia'}})
  await new Promise(resolve=>setTimeout(resolve,12))
  assert.equal(h.writes[0].kind,'svg-attribute')
  assert.equal(h.writes[0].attribute,'font-family')
  assert.equal(h.writes[0].value,'Georgia')
})
test('Add Text toolbar creates a native editable text object',async()=>{
  const h=await mockClient()
  const add=locate(h.render(),n=>n.props?.['aria-label']==='Add text')
  assert.ok(add)
  add.props.onClick()
  await new Promise(resolve=>setTimeout(resolve,12))
  assert.equal(h.writes[0].kind,'svg-add-shape')
  assert.equal(h.writes[0].shape,'text')
})

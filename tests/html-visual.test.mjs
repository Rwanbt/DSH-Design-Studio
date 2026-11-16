import test from 'node:test'
import assert from 'node:assert/strict'
import { listHtmlVisualElements,htmlVisualStylePatch } from '../src/html-visual.mjs'
import { applyNativePatches,sourceHash } from '../src/native-patch.mjs'

const html='<!doctype html>\n<!-- <div id="ghost"> -->\n'+
  '<main id="app" class="site"><h1 id="title" style="color: red; padding: 12px;">Hello</h1></main>\n'
function apply(source,patch){
  return applyNativePatches({source,format:'html',baseHash:sourceHash(source),patches:[patch]})
}
test('lists real unique HTML ids and ignores fake comment tags',()=>{
  assert.deepEqual(listHtmlVisualElements(html).map(item=>item.id),['app','title'])
  assert.deepEqual(listHtmlVisualElements(html).map(item=>item.tag),['main','h1'])
})
test('changing one existing style value preserves the rest of HTML exactly and Undo works',()=>{
  const patch=htmlVisualStylePatch(html,{id:'title',property:'color',value:'#bda991'})
  const changed=apply(html,patch)
  assert.equal(changed.ok,true)
  assert.equal(changed.source,html.replace('color: red','color: #bda991'))
  assert.equal(apply(changed.source,changed.inverse[0]).source,html)
})
test('inserts style attribute into plain HTML id without rewriting original markup',()=>{
  const patch=htmlVisualStylePatch(html,{id:'app',property:'display',value:'flex'})
  const changed=apply(html,patch)
  assert.equal(changed.ok,true)
  assert.equal(changed.source,html.replace('class="site">','class="site" style="display: flex;">'))
  assert.equal(apply(changed.source,changed.inverse[0]).source,html)
})
test('appends a second style declaration while keeping unrelated declarations verbatim',()=>{
  const changed=apply(html,htmlVisualStylePatch(html,{id:'title',property:'gap',value:'8px'}))
  assert.equal(changed.source,html.replace('padding: 12px;','padding: 12px; gap: 8px;'))
})
test('respects single-quoted style and attribute values',()=>{
  const source="<div id='card' style='color: red'>Hi</div>"
  const changed=apply(source,htmlVisualStylePatch(source,{id:'card',property:'color',value:'blue'}))
  assert.equal(changed.source,"<div id='card' style='color: blue'>Hi</div>")
})
test('rejects duplicate ids instead of choosing an arbitrary element',()=>{
  const source='<main id="same"></main><p id="same">Hello</p>'
  assert.equal(listHtmlVisualElements(source).filter(x=>x.editable).length,0)
  assert.throws(()=>htmlVisualStylePatch(source,{id:'same',property:'color',value:'red'}),{code:'unknown-node'})
})
test('ignores fake HTML inside scripts, styles, templates and textarea content',()=>{
  const source='<script>const x = \'<div id="fake">\';</script>'+
    '<style>p::before{content:"<div id=\\"stylefake\\">"}</style>'+
    '<template><div id="inert">Hidden</div></template>'+
    '<textarea><div id="textfake">Test</div></textarea>'+
    '<main id="real">OK</main>'
  assert.deepEqual(listHtmlVisualElements(source).map(x=>x.id),['real'])
})
test('refuses injected CSS values and unrelated attributes',()=>{
  for(const value of ['red; background:url(https://evil)','url(javascript:alert(1))',
    'calc(100% - 1px)','"><script>','expression(foo)','green\nfoo','rgb(1,2,3)']){
    assert.throws(()=>htmlVisualStylePatch(html,{id:'title',property:'color',value}),{code:'invalid-value'},value)
  }
  assert.throws(()=>htmlVisualStylePatch(html,{id:'title',property:'position',value:'fixed'}),{code:'invalid-value'})
})
test('refuses non-id targets and HTML with ambiguous complex styles',()=>{
  const source='<div id="card" style="color: red; color: blue">X</div>'
  assert.throws(()=>htmlVisualStylePatch(source,{id:'card',property:'color',value:'green'}),{code:'unsupported-html'})
  assert.throws(()=>htmlVisualStylePatch('<div id=card>X</div>',{id:'card',property:'color',value:'red'}),{code:'unsupported-html'})
  assert.throws(()=>htmlVisualStylePatch('<div id="card" style="color: &quot;red&quot;">X</div>',
    {id:'card',property:'color',value:'blue'}),{code:'unsupported-html'})
})
test('no-op and missing elements use existing non-destructive patch semantics',()=>{
  assert.throws(()=>htmlVisualStylePatch(html,{id:'missing',property:'color',value:'red'}),{code:'unknown-node'})
  const patch=htmlVisualStylePatch(html,{id:'title',property:'color',value:'red'})
  const result=apply(html,patch)
  assert.equal(result.changed,false)
})

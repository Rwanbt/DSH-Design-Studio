import test from 'node:test'
import assert from 'node:assert/strict'
import { listCssVisualRules,cssVisualRulePatch } from '../src/css-visual.mjs'
import { applyNativePatches,sourceHash } from '../src/native-patch.mjs'
const css='#app { color: red; display: block; }\n.card {\n  padding: 12px;\n  gap: 5px;\n}\n'
const apply=(source,patch)=>applyNativePatches({source,format:'css',baseHash:sourceHash(source),patches:[patch]})
test('lists unique simple top-level CSS id/class rules and their values',()=>{
  assert.deepEqual(listCssVisualRules(css),[
    {selector:'#app',editable:true,reason:null,declarations:[
      {property:'color',value:'red'},{property:'display',value:'block'}]},
    {selector:'.card',editable:true,reason:null,declarations:[
      {property:'padding',value:'12px'},{property:'gap',value:'5px'}]}
  ])
})
test('changes one declaration value without normalizing other CSS, then exact undo',()=>{
  const patch=cssVisualRulePatch(css,{selector:'#app',property:'color',value:'#bda991'})
  assert.deepEqual(patch,{start:css.indexOf('red'),end:css.indexOf('red')+3,before:'red',after:'#bda991'})
  const updated=apply(css,patch)
  assert.equal(updated.ok,true)
  assert.equal(updated.source,css.replace('color: red','color: #bda991'))
  assert.equal(apply(updated.source,updated.inverse[0]).source,css)
})
test('adds one declaration while keeping all existing bytes and allows undo',()=>{
  const patch=cssVisualRulePatch(css,{selector:'.card',property:'height',value:'120px'})
  const changed=apply(css,patch)
  assert.ok(changed.source.includes('height: 120px;'))
  assert.equal(changed.source.replace(patch.after,''),css)
  assert.equal(apply(changed.source,changed.inverse[0]).source,css)
})
test('handles compact and empty blocks',()=>{
  const input='#a{} .button{color:red;}'
  const a=apply(input,cssVisualRulePatch(input,{selector:'#a',property:'display',value:'flex'}))
  assert.equal(a.source,'#a{display: flex;} .button{color:red;}')
  const b=apply(input,cssVisualRulePatch(input,{selector:'.button',property:'gap',value:'8px'}))
  assert.equal(b.source,'#a{} .button{color:red; gap: 8px;}')
})
test('no-op returns unchanged source and no inverse operation',()=>{
  const patch=cssVisualRulePatch(css,{selector:'#app',property:'color',value:'red'})
  const result=apply(css,patch)
  assert.equal(result.changed,false)
  assert.equal(result.source,css)
})
test('refuses duplicate rule selector or duplicate properties rather than choosing silently',()=>{
  const dup='#app{color:red} #app {color:blue}'
  assert.equal(listCssVisualRules(dup).every(x=>!x.editable),true)
  assert.throws(()=>cssVisualRulePatch(dup,{selector:'#app',property:'color',value:'green'}))
  const dupeProp='#app{color:red;color:blue;}'
  assert.throws(()=>cssVisualRulePatch(dupeProp,{selector:'#app',property:'color',value:'green'}),{code:'unsupported-css'})
})
test('refuses risky CSS values and unsupported selector/property',()=>{
  for(const value of ['url(https://host)', 'red;position:fixed','rgb(2,3,4)','<style>',
    'expression(alert(1))','red\nheight:100px']){
    assert.throws(()=>cssVisualRulePatch(css,{selector:'#app',property:'color',value}),{code:'invalid-value'})
  }
  for(const selector of ['#app:hover','#app, .card','main > #app','@media','#unknown[]']){
    assert.throws(()=>cssVisualRulePatch(css,{selector,property:'color',value:'blue'}),{code:'invalid-value'})
  }
  assert.throws(()=>cssVisualRulePatch(css,{selector:'#app',property:'position',value:'absolute'}),{code:'invalid-value'})
})
test('ignores CSS comment fake rules and refuses nested @media or complex declaration blocks',()=>{
  const input='/* #fake { color: red; } */\n#real{ color: red; }\n@media(min-width:600px){#hidden{color:red}}'
  const listed=listCssVisualRules(input)
  assert.deepEqual(listed.map(x=>x.selector),['#real'])
  assert.throws(()=>cssVisualRulePatch(input,{selector:'#hidden',property:'color',value:'blue'}),{code:'unknown-node'})
  const quoted='#app { content: "hi; there"; color:red; }'
  assert.equal(listCssVisualRules(quoted)[0].editable,false)
  assert.throws(()=>cssVisualRulePatch(quoted,{selector:'#app',property:'color',value:'green'}),{code:'unsupported-css'})
})
test('style declarations with comments or braces remain read-only',()=>{
  for(const source of ['#app{color:/*comment*/red}', '#app{--custom: {foo:bar};}',
    '#app{ color: red; color: blue;}']){
    const [model]=listCssVisualRules(source)
    assert.ok(!model || !model.editable,
      'Unsupported declaration body must not allow partial updates')
  }
})
test('CSS path is bounded and missing rules are never guessed',()=>{
  assert.equal(listCssVisualRules('x'.repeat(512*1024+1)).length,0)
  assert.throws(()=>cssVisualRulePatch(css,{selector:'#missing',property:'color',value:'blue'}),{code:'unknown-node'})
})

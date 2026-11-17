import test from 'node:test'
import assert from 'node:assert/strict'
import {htmlVisualStylePatch} from '../src/html-visual.mjs'
import {cssVisualRulePatch,listCssVisualRules} from '../src/css-visual.mjs'
import {buildSafeLinkedPreviewCss} from '../src/html-responsive-preview.mjs'
import {applyNativePatches,sourceHash} from '../src/native-patch.mjs'
function write(source,format,patch){
  return applyNativePatches({source,format,baseHash:sourceHash(source),patches:[patch]})
}
test('HTML grid presets save one native inline style span with exact undo',()=>{
  const source='<main id="layout" style="display:grid; gap:8px">Content</main>'
  const patch=htmlVisualStylePatch(source,{id:'layout',property:'grid-template-columns',
    value:'repeat(3, minmax(0, 1fr))'})
  const result=write(source,'html',patch)
  assert.ok(result.changed)
  assert.ok(result.source.includes('grid-template-columns: repeat(3, minmax(0, 1fr))'))
  assert.equal(write(result.source,'html',result.inverse[0]).source,source)
})
test('CSS layout presets preserve unrelated rules and exact undo',()=>{
  const source='.layout{display:grid; color:#abc;} .other{color:red;}'
  const patch=cssVisualRulePatch(source,{selector:'.layout',property:'grid-auto-flow',value:'column'})
  const result=write(source,'css',patch)
  assert.ok(result.source.includes('grid-auto-flow: column'))
  assert.ok(result.source.includes('.other{color:red;}'))
  assert.equal(write(result.source,'css',result.inverse[0]).source,source)
  const preview=buildSafeLinkedPreviewCss(listCssVisualRules(result.source),new Set(['.layout']))
  assert.ok(preview.css.includes('grid-auto-flow:column'))
})
test('accepted column presets are finite and reject arbitrary injected CSS',()=>{
  const source='#grid{display:grid}'
  const accepted=['1fr','repeat(2, minmax(0, 1fr))','repeat(3, minmax(0, 1fr))',
    'repeat(4, minmax(0, 1fr))']
  for(const value of accepted){
    const patch=cssVisualRulePatch(source,{selector:'#grid',property:'grid-template-columns',value})
    assert.ok(write(source,'css',patch).source.includes(value))
  }
  const rejected=['repeat(5, minmax(0, 1fr))','repeat(2, 1fr)','100vh',
    'repeat(2,minmax(0,1fr));position:fixed',
    'url(http://evil.invalid/a)','minmax(calc(1rem - 1px),1fr)','1fr}body{display:none','']
  for(const value of rejected) {
    assert.throws(()=>cssVisualRulePatch(source,{selector:'#grid',property:'grid-template-columns',value}),
      {code:'invalid-value'},value)
    assert.throws(()=>htmlVisualStylePatch('<main id="grid"/>',
      {id:'grid',property:'grid-template-columns',value}),{code:'invalid-value'},value)
  }
})
test('grid auto-flow, flex direction, gap and alignment stay allowlisted',()=>{
  const source='<div id="node" />'
  for(const [property,value] of [
    ['display','flex'],['display','grid'],['display','block'],
    ['flex-direction','column'],['justify-content','space-between'],
    ['align-items','center'],['gap','16px'],['grid-auto-flow','row']
  ]) {
    assert.ok(htmlVisualStylePatch(source,{id:'node',property,value}).after.includes(value))
  }
  for(const [property,value] of [
    ['grid-auto-flow','dense'],['flex-direction','expression(1)'],['gap','16px;display:none'],
    ['justify-content','unsafe'],['grid-template-columns','var(--anything)']
  ])assert.throws(()=>cssVisualRulePatch('#node{display:block}',{selector:'#node',property,value}),
    {code:'invalid-value'})
})

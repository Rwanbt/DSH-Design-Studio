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

test('extended layout properties accept only literal, resource-free tokens', async () => {
  const { listHtmlVisualElements, htmlVisualStylePatch } = await import('../src/html-visual.mjs')
  const source = '<!doctype html><html><body><p id="lead">Text</p></body></html>'
  const id = listHtmlVisualElements(source).find((element) => element.id === 'lead').id
  const accepted = [
    ['flex-wrap', 'wrap'], ['align-content', 'space-between'], ['align-self', 'center'],
    ['flex-grow', '2'], ['flex-shrink', '0'], ['flex-basis', '25%'],
    ['grid-template-rows', 'repeat(3, minmax(0, 1fr))'], ['row-gap', '16px'],
    ['column-gap', '8px'], ['justify-items', 'center'], ['place-items', 'center'],
    ['max-width', '100%'], ['min-width', 'auto'], ['text-wrap', 'balance'],
    ['line-height', '1.4'], ['object-fit', 'cover'], ['overflow', 'hidden'], ['z-index', '3'],
  ]
  for (const [property, value] of accepted) {
    const patch = htmlVisualStylePatch(source, { id, property, value })
    assert.equal(patch.after.includes(property + ': ' + value), true,
      `${property}: ${value} must be accepted`)
  }
  const rejected = [
    ['flex-wrap', 'wrap; color: red'], ['flex-grow', '999'], ['flex-basis', 'url(evil)'],
    ['grid-template-rows', 'repeat(99, 1fr)'], ['row-gap', 'expression(alert(1))'],
    ['max-width', 'calc(100% - 1px)'], ['z-index', '99999'], ['overflow', 'overlay'],
    ['position', 'absolute'],
  ]
  for (const [property, value] of rejected) {
    assert.throws(() => htmlVisualStylePatch(source, { id, property, value }),
      (error) => ['invalid-value', 'unsupported-property'].includes(error.code),
      `${property}: ${JSON.stringify(value)} must be refused`)
  }
})

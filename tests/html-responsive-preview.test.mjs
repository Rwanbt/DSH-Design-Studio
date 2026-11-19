import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSafeLinkedPreviewCss } from '../src/html-responsive-preview.mjs'
import { listCssVisualRules } from '../src/css-visual.mjs'

test('projects safe local CSS selector/property/value subset without including raw sheet',()=>{
  const raw='#title { color:#bda991; display:flex; background-image:url(https://bad.invalid/img); }'+
    '\n.card {gap:12px; flex-direction:column;}'
  const result=buildSafeLinkedPreviewCss(listCssVisualRules(raw),new Set(['#title','.card']))
  assert.equal(result.css,'#title{color:#bda991;display:flex;}\n.card{gap:12px;flex-direction:column;}')
  assert.equal(result.included,4)
  assert.equal(result.omitted,1)
  assert.equal(result.truncated,false)
  assert.ok(!result.css.includes('http'))
  assert.ok(!result.css.includes('url('))
})
test('unknown, nested and duplicate rules cannot become preview CSS',()=>{
  const original='#known{color:red;} #known{color:blue;} @media(max-width:600px){#known{display:none}} #other{color:green;}'
  const projected=buildSafeLinkedPreviewCss(listCssVisualRules(original),new Set(['#known']))
  assert.equal(projected.css,'')
  assert.equal(projected.included,0)
})
test('unexpected CSS values, rule names and CSS constructs never pass the allowlist',()=>{
  const rules=[
    {editable:true,selector:'#title',declarations:[
      {property:'color',value:'red;position:fixed'},
      {property:'background-color',value:'url(https://evil)'},
      {property:'opacity',value:'0.6'},
      {property:'display',value:'grid'},
      {property:'--evil',value:'anything'},
      {property:'padding',value:'12px}script{'},
    ]},
    {editable:true,selector:'body > #title',declarations:[{property:'display',value:'none'}]},
    {editable:true,selector:'#title',declarations:[{property:'display',value:'flex'}]},
    {editable:false,selector:'.untrusted',declarations:[{property:'color',value:'blue'}]},
  ]
  const projected=buildSafeLinkedPreviewCss(rules,new Set(['#title']))
  assert.equal(projected.css,'#title{opacity:0.6;display:grid;}\nbody > #title{display:none;}\n#title{display:flex;}')
  assert.equal(projected.included,4)
  assert.equal(projected.omitted,4)
  assert.ok(!/[{}]/.test(projected.css.replace(/[^{}]+\{[^}]*\}/g,'')))
  assert.ok(!projected.css.includes('evil'))
})
test('projected stylesheet has a bounded output even with extreme repeated rules',()=>{
  const items=Array.from({length:1600},()=>({
    editable:true,selector:'#a',declarations:[
      {property:'font-size',value:'12345678901234567890px'},
      {property:'background-color',value:'#abcdefff'},
      {property:'justify-content',value:'space-evenly'},
    ]
  }))
  const preview=buildSafeLinkedPreviewCss(items,new Set(['#a']))
  assert.ok(preview.css.length<=24576)
  assert.equal(preview.truncated,true)
  assert.ok(preview.included>0)
  assert.ok(preview.omitted>0)
})
test('CSS subset conservatively omits styles that are not guaranteed valid in preview',()=>{
  const css='@import "https://bad.invalid/a.css"; #title{color:red; font-family:SomeFont; margin:10px; text-align:center;}'
  const out=buildSafeLinkedPreviewCss(listCssVisualRules(css),new Set(['#title']))
  assert.ok(out.css.includes('margin:10px'))
  assert.ok(out.css.includes('text-align:center'))
  assert.ok(!out.css.includes('font-family'))
  assert.ok(!out.css.includes('import'))
  assert.ok(!out.css.includes('https:'))
})

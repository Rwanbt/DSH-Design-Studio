import test from 'node:test'
import assert from 'node:assert/strict'
import {
  listCssVisualRules,listCssVisualRuleDetails,cssVisualRulePatch,
  cssVisualDeclarationPatch,parseCssSelectorList,
} from '../src/css-visual.mjs'
import { applyNativePatches,sourceHash } from '../src/native-patch.mjs'

const apply=(source,patch)=>applyNativePatches({
  source,format:'css',baseHash:sourceHash(source),patches:[patch],
})

const css='/* header */\n'+
  'h1, .a > .b { color: red; padding: 8px; }\n'+
  'main .card { display: flex; }\n'+
  'h2 + p { gap: 4px; }\n'+
  'h2 ~ p { margin: 2px; }\n'+
  '#hero { --brand: #aa8844; color: #333333; }\n'

test('selector lists, combinators and type selectors are listed with exact spans',()=>{
  const rules=listCssVisualRules(css)
  assert.deepEqual(rules.map(rule=>rule.selector),[
    'h1, .a > .b','main .card','h2 + p','h2 ~ p','#hero',
  ])
  assert.ok(rules.every(rule=>rule.editable===true&&rule.reason===null))
  assert.deepEqual(rules[0].declarations,[
    {property:'color',value:'red'},{property:'padding',value:'8px'},
  ])
  // Existing observable shape is preserved exactly (four keys per rule).
  assert.deepEqual(Object.keys(rules[0]),
    ['selector','editable','reason','declarations'])
  const details=listCssVisualRuleDetails(css)
  assert.equal(details[0].selectors.length,2)
  assert.deepEqual(details[0].selectors,['h1','.a > .b'])
  assert.deepEqual(details[1].selectors,['main .card'])
  for(const rule of details){
    assert.equal(rule.scope,'top-level')
    assert.equal(rule.editable,true)
    assert.equal(css.slice(rule.selectorStart,rule.selectorEnd),rule.selector)
    for(const declaration of rule.declarations){
      assert.equal(css.slice(declaration.start,declaration.end),declaration.value)
    }
  }
  const parsed=parseCssSelectorList('h1, .a > .b + .c ~ #d')
  assert.equal(parsed.ok,true)
  assert.deepEqual(parsed.members.map(member=>member.selector),['h1','.a > .b + .c ~ #d'])
  assert.deepEqual(parsed.members[1].combinators,['>','+','~'])
  assert.equal(parsed.members[1].hasCombinators,true)
})

test('patching a selector list changes only its declaration and undoes byte-exactly',()=>{
  const patch=cssVisualRulePatch(css,{selector:'h1, .a > .b',property:'color',value:'blue'})
  assert.deepEqual(patch,{
    start:css.indexOf('red'),end:css.indexOf('red')+3,before:'red',after:'blue',
  })
  const changed=apply(css,patch)
  assert.equal(changed.ok,true)
  assert.equal(changed.source,css.replace('color: red','color: blue'))
  assert.ok(changed.source.includes('main .card { display: flex; }'))
  assert.equal(apply(changed.source,changed.inverse[0]).source,css)
  // The detailed API resolves the same rule and produces the same patch.
  assert.deepEqual(cssVisualDeclarationPatch(css,
    {selector:'h1, .a > .b',property:'color',value:'blue'}),patch)
})

test('descendant, child, adjacent and sibling combinators are editable top-level rules',()=>{
  const patches=[
    ['main .card','display','block'],
    ['h2 + p','gap','6px'],
    ['h2 ~ p','margin','3px'],
  ]
  for(const [selector,property,value] of patches){
    const patch=cssVisualDeclarationPatch(css,{selector,property,value})
    const changed=apply(css,patch)
    assert.equal(changed.ok,true,selector)
    assert.ok(changed.source.includes(value),selector)
    assert.equal(apply(changed.source,changed.inverse[0]).source,css,selector)
  }
  // `.a > .b` is a child-combinator member inside the selector list.
  const childRule='.a > .b { color: red; }'
  const changed=apply(childRule,cssVisualDeclarationPatch(childRule,
    {selector:'.a > .b',property:'color',value:'blue'}))
  assert.equal(changed.source,'.a > .b { color: blue; }')
  assert.equal(apply(changed.source,changed.inverse[0]).source,childRule)
})

test('@media, @supports, @keyframes and @layer declarations are refused with typed scope',()=>{
  const at='#top { color: red; }\n'+
    '@media (min-width: 600px) { #hidden { display: none; } }\n'+
    '@supports (display: grid) { .grid { display: grid; } }\n'+
    '@keyframes pulse { from { opacity: 0; } 50% { opacity: 0.5; } to { opacity: 1; } }\n'+
    '@layer base { .layer { color: blue; } }\n'
  const details=listCssVisualRuleDetails(at)
  const top=details.find(rule=>rule.selector==='#top')
  assert.equal(top.scope,'top-level')
  assert.equal(top.editable,true)
  const expectations={
    '#hidden':['media','display','block'],
    '.grid':['supports','display','block'],
    from:['keyframes','opacity','0.5'],
    '.layer':['layer','color','red'],
    '50%':['keyframes','opacity','0.5'],
  }
  for(const [selector,[atName,property,value]] of Object.entries(expectations)){
    const rule=details.find(item=>item.selector===selector)
    assert.ok(rule,selector)
    assert.equal(rule.scope,'inside-at-rule',selector)
    assert.equal(rule.atRule,atName,selector)
    assert.equal(rule.editable,false,selector)
    assert.equal(rule.reasonCode,'inside-at-rule',selector)
    assert.match(rule.reason,new RegExp('@'+atName),selector)
    assert.throws(()=>cssVisualDeclarationPatch(at,{selector,property,value}),{
      code:'inside-at-rule',atRule:atName,
    },selector)
  }
  // Historical entry point keeps its old fail-closed code for nested rules,
  // while the attached reasonCode still identifies the at-rule scope.
  let legacyError=null
  try{cssVisualRulePatch(at,{selector:'#hidden',property:'display',value:'block'})}
  catch(caught){legacyError=caught}
  assert.equal(legacyError.code,'unknown-node')
  assert.equal(legacyError.reasonCode,'inside-at-rule')
  assert.equal(legacyError.atRule,'media')
  assert.throws(()=>cssVisualDeclarationPatch(at,{selector:'@media',
    property:'display',value:'block'}),{code:'at-rule-selector',atRule:'media'})
  assert.equal(at,'#top { color: red; }\n'+
    '@media (min-width: 600px) { #hidden { display: none; } }\n'+
    '@supports (display: grid) { .grid { display: grid; } }\n'+
    '@keyframes pulse { from { opacity: 0; } 50% { opacity: 0.5; } to { opacity: 1; } }\n'+
    '@layer base { .layer { color: blue; } }\n')
})

test('custom properties can be edited and inserted while surrounding bytes stay intact',()=>{
  const details=listCssVisualRuleDetails(css)
  const hero=details.find(rule=>rule.selector==='#hero')
  const brand=hero.declarations.find(declaration=>declaration.property==='--brand')
  assert.equal(brand.customProperty,true)
  assert.equal(css.slice(brand.start,brand.end),'#aa8844')

  const existing=cssVisualDeclarationPatch(css,
    {selector:'#hero',property:'--brand',value:'#112233'})
  const changed=apply(css,existing)
  assert.equal(changed.source,css.replace('--brand: #aa8844','--brand: #112233'))
  assert.equal(apply(changed.source,changed.inverse[0]).source,css)

  // The historical entry point also edits custom-property values.
  const legacyCustom=cssVisualRulePatch(css,
    {selector:'#hero',property:'--brand',value:'#445566'})
  assert.equal(apply(css,legacyCustom).source,
    css.replace('--brand: #aa8844','--brand: #445566'))

  const inserted=cssVisualDeclarationPatch(css,
    {selector:'#hero',property:'--space',value:'8px'})
  const withNew=apply(css,inserted)
  assert.ok(withNew.source.includes('--space: 8px;'))
  assert.equal(apply(withNew.source,withNew.inverse[0]).source,css)

  const uppercase='#x { --Brand: #AABBCC; }\n'
  const uppercaseDetails=listCssVisualRuleDetails(uppercase)
  assert.equal(uppercaseDetails[0].declarations[0].property,'--Brand')
  const upperPatch=cssVisualDeclarationPatch(uppercase,
    {selector:'#x',property:'--Brand',value:'#DDEEFF'})
  assert.equal(apply(uppercase,upperPatch).source,
    '#x { --Brand: #DDEEFF; }\n')
})

test('unsafe custom-property values are refused instead of injected',()=>{
  const source='#x { --safe: red; }'
  for(const value of ['red; } body { display: none }','url(https://evil.test/a)',
    'expression(alert(1))','red/* comment */','a@b','<script>']){
    assert.throws(()=>cssVisualDeclarationPatch(source,
      {selector:'#x',property:'--safe',value}),{code:'invalid-value'},value)
  }
  assert.throws(()=>cssVisualDeclarationPatch(source,
    {selector:'#x',property:'--new',value:''}),{code:'invalid-value'})
  assert.equal(source,'#x { --safe: red; }')
})

test('ambiguous selectors are refused with typed codes, never patched silently',()=>{
  const duplicate='#dup { color: red; }\n#dup { color: blue; }'
  const duplicateDetails=listCssVisualRuleDetails(duplicate)
  assert.ok(duplicateDetails.every(rule=>rule.reasonCode==='duplicate-selector'))
  assert.throws(()=>cssVisualDeclarationPatch(duplicate,
    {selector:'#dup',property:'color',value:'green'}),{code:'ambiguous-selector'})
  const listDuplicate='h1, .a { color: red; }\n.a, h2 { color: blue; }'
  assert.throws(()=>cssVisualDeclarationPatch(listDuplicate,
    {selector:'.a',property:'color',value:'green'}),{code:'ambiguous-selector'})
  assert.equal(apply(listDuplicate,cssVisualDeclarationPatch(listDuplicate,
    {selector:'h1, .a',property:'color',value:'green'})).source,
  'h1, .a { color: green; }\n.a, h2 { color: blue; }')
  assert.throws(()=>cssVisualDeclarationPatch(css,
    {selector:'#missing',property:'color',value:'red'}),{code:'unknown-node'})
  // Legacy contract: a selector list with no exact top-level rule stays invalid-value.
  assert.throws(()=>cssVisualRulePatch(css,{selector:'.a > .b',
    property:'color',value:'red'}),{code:'invalid-value'})
})

test('unsupported selectors are typed read-only and simple-rule behaviour is unchanged',()=>{
  const pseudo='#x:hover { color: red; }\n[x] { color: blue; }\n'
  const details=listCssVisualRuleDetails(pseudo)
  assert.equal(details.length,2)
  assert.ok(details.every(rule=>rule.editable===false))
  assert.ok(details.every(rule=>rule.reasonCode==='unsupported-selector'))
  assert.throws(()=>cssVisualDeclarationPatch(pseudo,
    {selector:'#x:hover',property:'color',value:'green'}),{code:'invalid-value'})

  const simple='#app { color: red; display: block; }\n.card {\n  padding: 12px;\n  gap: 5px;\n}\n'
  const patch=cssVisualRulePatch(simple,{selector:'#app',property:'color',value:'#bda991'})
  assert.deepEqual(patch,{start:simple.indexOf('red'),end:simple.indexOf('red')+3,
    before:'red',after:'#bda991'})
  assert.equal(apply(simple,patch).source,simple.replace('color: red','color: #bda991'))
  assert.deepEqual(listCssVisualRules(simple),[
    {selector:'#app',editable:true,reason:null,declarations:[
      {property:'color',value:'red'},{property:'display',value:'block'}]},
    {selector:'.card',editable:true,reason:null,declarations:[
      {property:'padding',value:'12px'},{property:'gap',value:'5px'}]},
  ])
})

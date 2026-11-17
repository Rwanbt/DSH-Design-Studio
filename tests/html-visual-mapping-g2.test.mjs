import test from 'node:test'
import assert from 'node:assert/strict'
import {
  listHtmlVisualElements,resolveHtmlVisualElement,htmlVisualTextPatch,
  htmlVisualAttributePatch,
} from '../src/html-visual.mjs'

const doc='<!doctype html>\n<html>\n<head><title>Demo</title></head>\n<body>\n'+
  '<main id="app" class="site">\n'+
  '<h1 id="title" style="color: red;">Hello</h1>\n'+
  '<p id="plain">Text</p>\n'+
  '<span>Bare</span>\n'+
  '</main>\n</body>\n</html>\n'

test('structural map exposes stable keys, html-rooted child paths and exact byte spans',()=>{
  const first=listHtmlVisualElements(doc)
  const second=listHtmlVisualElements(doc)
  assert.deepEqual(first.map(item=>item.id),['app','title','plain'])
  assert.deepEqual(first.map(item=>item.path),[[1,0],[1,0,0],[1,0,1]])
  assert.deepEqual(first.map(item=>item.key),second.map(item=>item.key))
  assert.equal(new Set(first.map(item=>item.key)).size,first.length)
  assert.equal(first[0].key,'main#app@1.0')
  assert.equal(first[0].pathString,'1.0')
  for(const item of first){
    assert.equal(item.balanced,true)
    assert.equal(item.reasonCode,null)
    assert.equal(item.editable,true)
    // Every span points at the ORIGINAL bytes, never a reconstruction.
    assert.equal(doc.slice(item.start,item.end).startsWith('<'+item.tag),true)
    assert.equal(doc.slice(item.start,item.end).endsWith('</'+item.tag+'>'),true)
    assert.equal(doc.slice(item.openStart,item.openEnd).endsWith('>'),true)
    assert.equal(doc.slice(item.openStart,item.openStart+1+item.tag.length),
      '<'+item.tag)
  }
  const title=first.find(item=>item.id==='title')
  assert.equal(doc.slice(title.textStart,title.textEnd),'Hello')
  assert.equal(doc.slice(title.closeStart,title.closeEnd),'</h1>')
})

test('elements without ids are still addressable by deterministic structural path',()=>{
  const listed=listHtmlVisualElements(doc)
  const spanPath=[1,0,2]
  const resolved=resolveHtmlVisualElement(doc,{path:spanPath})
  assert.equal(resolved.tag,'span')
  assert.equal(resolved.id,null)
  assert.deepEqual(resolved.path,spanPath)
  const patch=htmlVisualTextPatch(doc,{path:spanPath,text:'Changed'})
  assert.deepEqual(patch,{start:doc.indexOf('Bare'),end:doc.indexOf('Bare')+4,
    before:'Bare',after:'Changed'})
  assert.equal(doc.slice(patch.start,patch.end),patch.before)
  // The same target can be addressed by id, key and path with one result.
  const byId=resolveHtmlVisualElement(doc,{id:'plain'})
  const byKey=resolveHtmlVisualElement(doc,{key:byId.key})
  assert.deepEqual(byId.path,byKey.path)
  assert.equal(byId.key,byKey.key)
  assert.throws(()=>resolveHtmlVisualElement(doc,{path:[9,9]}),{code:'unknown-node'})
  assert.throws(()=>resolveHtmlVisualElement(doc,{key:'main#missing@1.0'}),
    {code:'unknown-node'})
  assert.throws(()=>resolveHtmlVisualElement(doc,{id:'plain',path:[1,0]}),
    {code:'invalid-target'})
  assert.throws(()=>resolveHtmlVisualElement(doc,{}),{code:'invalid-target'})
  assert.throws(()=>resolveHtmlVisualElement(doc,{path:'not-a-path'}),
    {code:'invalid-target'})
  assert.equal(listed.length,3)
})

test('duplicate ids are read-only with a typed reason and never a guessed target',()=>{
  const source='<main id="same"></main><p id="same">Hello</p>'
  const listed=listHtmlVisualElements(source)
  assert.equal(listed.length,2)
  for(const item of listed){
    assert.equal(item.editable,false)
    assert.equal(item.reasonCode,'duplicate-id')
    assert.equal(item.reason,'duplicate-or-invalid-id')
  }
  assert.throws(()=>resolveHtmlVisualElement(source,{id:'same'}),
    {code:'ambiguous-target',reasonCode:'duplicate-id'})
  assert.throws(()=>htmlVisualTextPatch(source,{id:'same',text:'Wrong'}),
    {code:'ambiguous-target',reasonCode:'duplicate-id'})
  assert.throws(()=>htmlVisualAttributePatch(source,
    {id:'same',name:'class',value:'chosen'}),{code:'ambiguous-target'})
  // Structural keys/paths must not bypass the duplicate-id refusal.
  const key=listed[0].key
  assert.throws(()=>htmlVisualTextPatch(source,{key,text:'Wrong'}),
    {code:'read-only-target',reasonCode:'duplicate-id'})
  assert.throws(()=>htmlVisualAttributePatch(source,
    {path:[0],name:'class',value:'chosen'}),
  {code:'read-only-target',reasonCode:'duplicate-id'})
  assert.equal(source,'<main id="same"></main><p id="same">Hello</p>')
})

test('unbalanced or mismatched markup is typed read-only instead of reconstructed',()=>{
  const source='<main id="a"><div id="b"><span id="c">Hi</main>'
  const listed=listHtmlVisualElements(source)
  assert.deepEqual(listed.map(item=>item.id),['a','b','c'])
  for(const item of listed)assert.equal(item.editable,false)
  assert.equal(listed.find(item=>item.id==='b').reasonCode,'unbalanced-markup')
  assert.equal(listed.find(item=>item.id==='c').reasonCode,'unbalanced-markup')
  assert.equal(listed.find(item=>item.id==='a').reasonCode,'ambiguous-descendant')
  for(const item of listed)
    assert.throws(()=>htmlVisualTextPatch(source,{id:item.id,text:'x'}),
      {code:'read-only-target'})
  assert.throws(()=>htmlVisualAttributePatch(source,
    {id:'a',name:'title',value:'x'}),{code:'read-only-target',reasonCode:'ambiguous-descendant'})
  const unclosed='<section id="open">text'
  const open=listHtmlVisualElements(unclosed)
  assert.equal(open[0].editable,false)
  assert.equal(open[0].reasonCode,'unbalanced-markup')
  assert.equal(unclosed,'<section id="open">text')
})

test('template, script and style regions are inert, typed read-only and never guessed',()=>{
  const source='<template><div id="inert" class="x">Hidden</div></template>'+
    '<script>const fake = \'<div id="scriptfake">\';</script>'+
    '<style>.x::before{content:"<div id=\\"stylefake\\">"}</style>'+
    '<main id="real">OK</main>'
  // Default listing keeps its historical contract: inert regions are skipped.
  assert.deepEqual(listHtmlVisualElements(source).map(item=>item.id),['real'])
  const detailed=listHtmlVisualElements(source,{includeReadOnlyRegions:true})
  assert.deepEqual(detailed.map(item=>item.id),['inert','real'])
  const inert=detailed.find(item=>item.id==='inert')
  assert.equal(inert.editable,false)
  assert.equal(inert.reasonCode,'inert-template')
  assert.equal(detailed.some(item=>item.id==='scriptfake'),false)
  assert.equal(detailed.some(item=>item.id==='stylefake'),false)
  assert.throws(()=>htmlVisualTextPatch(source,{id:'inert',text:'Changed'}),
    {code:'read-only-target',reasonCode:'inert-template'})
  assert.throws(()=>htmlVisualAttributePatch(source,
    {id:'inert',name:'class',value:'y'}),{code:'read-only-target',reasonCode:'inert-template'})
  assert.equal(detailed.find(item=>item.id==='real').editable,true)
})

test('inline SVG self-closing children do not poison the following HTML mapping',()=>{
  const source='<main id="app"><svg viewBox="0 0 10 10">'+
    '<path d="M0 0"/><circle cx="1" cy="1" r="1"/></svg>'+
    '<p id="after">OK</p></main>'
  const listed=listHtmlVisualElements(source)
  assert.deepEqual(listed.map(item=>item.id),['app','after'])
  assert.equal(listed.find(item=>item.id==='after').editable,true)
  assert.equal(resolveHtmlVisualElement(source,{id:'after'}).readonly,false)
  // A non-void HTML element that self-closes is still ambiguous: browsers
  // do not honour the slash there, so the tree cannot be inferred safely.
  const ambiguous='<div id="bad"/>'
  assert.equal(listHtmlVisualElements(ambiguous)[0].reasonCode,'ambiguous-self-closing')
  assert.throws(()=>htmlVisualTextPatch(ambiguous,{id:'bad',text:'x'}),
    {code:'read-only-target'})
})

test('mapping is bounded and invalid sources never throw from the list path',()=>{
  assert.deepEqual(listHtmlVisualElements(null),[])
  assert.deepEqual(listHtmlVisualElements('x'.repeat(512*1024+1)),[])
  assert.throws(()=>htmlVisualTextPatch('x'.repeat(512*1024+1),
    {id:'x',text:'y'}),{code:'unsupported-source'})
  assert.throws(()=>resolveHtmlVisualElement('x'.repeat(512*1024+1),{id:'x'}),
    {code:'unsupported-source'})
})

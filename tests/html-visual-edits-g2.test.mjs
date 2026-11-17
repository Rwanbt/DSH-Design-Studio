import test from 'node:test'
import assert from 'node:assert/strict'
import {
  listHtmlVisualElements,htmlVisualTextPatch,htmlVisualAttributePatch,
  htmlVisualStylePatch,
} from '../src/html-visual.mjs'
import { applyNativePatches,sourceHash } from '../src/native-patch.mjs'

function apply(source,patch,format='html') {
  return applyNativePatches({source,format,baseHash:sourceHash(source),patches:[patch]})
}

const html='<!doctype html>\n<!-- before -->\n'+
  '<div class="card" id="card" title="Old" data-kind="note">Old text</div>\n'+
  '<!-- after -->\n'+
  '<p id="second" data-kind="note">Second</p>\n'

test('text edit changes only the text bytes and its inverse restores the original',()=>{
  const patch=htmlVisualTextPatch(html,{id:'card',text:'New text'})
  assert.deepEqual(patch,{start:html.indexOf('Old text'),end:html.indexOf('Old text')+8,
    before:'Old text',after:'New text'})
  const changed=apply(html,patch)
  assert.equal(changed.ok,true)
  assert.equal(changed.source,html.replace('>Old text</div>','>New text</div>'))
  // Attributes and comments surrounding the element are byte-identical.
  assert.ok(changed.source.includes('<div class="card" id="card" title="Old" data-kind="note">'))
  assert.ok(changed.source.includes('<!-- before -->'))
  assert.ok(changed.source.includes('<!-- after -->'))
  assert.equal(apply(changed.source,changed.inverse[0]).source,html)
  // Structural keys survive byte-preserving edits: the element identity is
  // the source path, not a regenerated document.
  const before=listHtmlVisualElements(html).find(item=>item.id==='card')
  const after=listHtmlVisualElements(changed.source).find(item=>item.id==='card')
  assert.equal(after.key,before.key)
  assert.deepEqual(after.path,before.path)
})

test('attribute edits preserve every byte outside the attribute range and undo exactly',()=>{
  const expected=html.replace('title="Old"','title="New title"')
  const patch=htmlVisualAttributePatch(html,{id:'card',name:'title',value:'New title'})
  const changed=apply(html,patch)
  assert.equal(changed.source,expected)
  assert.equal(apply(changed.source,changed.inverse[0]).source,html)
  // A target key selects the same element as its id.
  const key=listHtmlVisualElements(html).find(item=>item.id==='card').key
  const byKey=htmlVisualAttributePatch(html,{key,name:'title',value:'New title'})
  assert.deepEqual(byKey,patch)
  // Same value is a no-op patch, not a rewrite.
  const noop=htmlVisualAttributePatch(html,{id:'card',name:'title',value:'Old'})
  const result=apply(html,noop)
  assert.equal(result.changed,false)
  assert.equal(result.source,html)
})

test('attribute insertion and deletion touch only the start tag bytes',()=>{
  const inserted=htmlVisualAttributePatch(html,{id:'second',name:'data-role',value:'cta'})
  const withAttribute=apply(html,inserted)
  assert.equal(withAttribute.source,
    html.replace('<p id="second" data-kind="note">','<p id="second" data-kind="note" data-role="cta">'))
  assert.equal(apply(withAttribute.source,withAttribute.inverse[0]).source,html)

  const removed=htmlVisualAttributePatch(html,{id:'card',name:'data-kind',value:null})
  const without=apply(html,removed)
  assert.equal(without.source,html.replace(' data-kind="note"',''))
  assert.equal(apply(without.source,without.inverse[0]).source,html)
  assert.throws(()=>htmlVisualAttributePatch(html,{id:'card',name:'data-missing',value:null}),
    {code:'attribute-not-found'})
})

test('strict attribute allowlist accepts safe attributes on insertion',()=>{
  const source='<div id="target">Text</div>'
  const accepted=[
    ['class','a b'],['title','Hello'],['alt','Picture'],['hidden',''],
    ['lang','fr-CA'],['dir','rtl'],['data-kind','hero'],['data-a1','ok'],
  ]
  for(const [name,value] of accepted){
    const patch=htmlVisualAttributePatch(source,{id:'target',name,value})
    const changed=apply(source,patch)
    assert.equal(changed.ok,true,name)
    assert.equal(changed.source,`<div id="target" ${name}="${value}">Text</div>`,name)
    assert.equal(apply(changed.source,changed.inverse[0]).source,source,name)
  }
  // Existing single-quoted attributes keep their quote style when possible.
  const single="<div id='target' class='old'>Text</div>"
  const changed=apply(single,htmlVisualAttributePatch(single,
    {id:'target',name:'class',value:'new'}))
  assert.equal(changed.source,"<div id='target' class='new'>Text</div>")
  // Boolean attributes are removed as one exact byte range.
  const boolean='<div id="target" hidden>Text</div>'
  const withoutHidden=apply(boolean,htmlVisualAttributePatch(boolean,
    {id:'target',name:'hidden',value:null}))
  assert.equal(withoutHidden.source,'<div id="target">Text</div>')
  assert.equal(apply(withoutHidden.source,withoutHidden.inverse[0]).source,boolean)
  // Unquoted existing values are rewritten as one safe quoted attribute span.
  const unquoted='<div id="target" title=Old>Text</div>'
  const rewritten=apply(unquoted,htmlVisualAttributePatch(unquoted,
    {id:'target',name:'title',value:'New'}))
  assert.equal(rewritten.source,'<div id="target" title="New">Text</div>')
  assert.equal(apply(rewritten.source,rewritten.inverse[0]).source,unquoted)
})

test('dangerous attributes are refused with typed codes and reasons, never written',()=>{
  const source='<div id="target" onclick="doNotRun()">Text</div>'
  for(const name of ['src','href','action','onclick','onmouseover','style','srcdoc',
    'formaction','xlink:href','srcset','poster','ping']){
    let error=null
    try{htmlVisualAttributePatch(source,{id:'target',name,value:'x'})}
    catch(caught){error=caught}
    assert.ok(error,'expected refusal for '+name)
    assert.equal(error.code,'forbidden-attribute',name)
    assert.equal(typeof error.reason,'string',name)
    assert.ok(error.reason.length>0,name)
  }
  // Case-insensitive HTML attribute names are refused too.
  assert.throws(()=>htmlVisualAttributePatch(source,{id:'target',name:'HREF',value:'x'}),
    {code:'forbidden-attribute'})
  assert.throws(()=>htmlVisualAttributePatch(source,{id:'target',name:'ONCLICK',value:'x'}),
    {code:'forbidden-attribute'})
  assert.equal(source,'<div id="target" onclick="doNotRun()">Text</div>')
})

test('attributes outside the allowlist and unsafe values are refused',()=>{
  const source='<div id="target">Text</div>'
  for(const name of ['id','aria-label','role','name','value','classlist']){
    assert.throws(()=>htmlVisualAttributePatch(source,{id:'target',name,value:'x'}),
      {code:'unsupported-attribute'},name)
  }
  const refusedValues=[
    ['title','<script>'],['title','Tom & Jerry'],['title','a"b'],['title','line\nbreak'],
    ['alt','<img>'],['class','bad{token}'],['class','1invalid'],['lang','../etc'],
    ['dir','up'],['hidden','yes'],['data-x','a<b'],
  ]
  for(const [name,value] of refusedValues){
    assert.throws(()=>htmlVisualAttributePatch(source,{id:'target',name,value}),
      {code:'invalid-value'},name+'='+JSON.stringify(value))
  }
  assert.equal(source,'<div id="target">Text</div>')
})

test('text edits refuse markup, entity ambiguity, nested elements, void elements and comments',()=>{
  const parent='<div id="parent"><span id="child">Child</span></div>'
  assert.throws(()=>htmlVisualTextPatch(parent,{id:'parent',text:'Replaced'}),
    {code:'unsupported-content'})
  assert.throws(()=>htmlVisualTextPatch(parent,{id:'child',text:'<b>nope</b>'}),
    {code:'invalid-value'})
  assert.throws(()=>htmlVisualTextPatch(parent,{id:'child',text:'Tom & Jerry'}),
    {code:'invalid-value'})
  assert.throws(()=>htmlVisualTextPatch('<img id="pic" alt="x">',
    {id:'pic',text:'x'}),{code:'unsupported-target'})
  const commented='<div id="c"><!-- keep -->Old</div>'
  assert.throws(()=>htmlVisualTextPatch(commented,{id:'c',text:'New'}),
    {code:'unsupported-content'})
  assert.equal(commented,'<div id="c"><!-- keep -->Old</div>')
})

test('text and attribute edits refuse duplicate-id and malformed targets before writing',()=>{
  const duplicate='<main id="same"></main><p id="same">Hello</p>'
  assert.throws(()=>htmlVisualTextPatch(duplicate,{id:'same',text:'x'}),
    {code:'ambiguous-target'})
  const malformed='<main id="a"><div id="b"><span id="c">Hi</main>'
  for(const id of ['a','b','c']){
    assert.throws(()=>htmlVisualTextPatch(malformed,{id,text:'x'}),
      {code:'read-only-target'})
    assert.throws(()=>htmlVisualAttributePatch(malformed,{id,name:'class',value:'x'}),
      {code:'read-only-target'})
  }
  assert.equal(duplicate,'<main id="same"></main><p id="same">Hello</p>')
  assert.equal(malformed,'<main id="a"><div id="b"><span id="c">Hi</main>')
})

test('style patch behaviour remains available next to the new edit APIs',()=>{
  const source='<main id="app"><h1 id="title" style="color: red;">Hello</h1></main>'
  const patch=htmlVisualStylePatch(source,{id:'title',property:'color',value:'blue'})
  const changed=apply(source,patch)
  assert.equal(changed.source,source.replace('color: red','color: blue'))
  assert.equal(apply(changed.source,changed.inverse[0]).source,source)
  // The attribute API deliberately refuses style so CSS validation is not bypassed.
  assert.throws(()=>htmlVisualAttributePatch(source,
    {id:'title',name:'style',value:'color:blue'}),{code:'forbidden-attribute'})
})

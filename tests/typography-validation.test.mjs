import test from 'node:test'
import assert from 'node:assert/strict'
import { svgAttributePatch } from '../src/svg-attributes.mjs'
import { applyNativePatches, sourceHash } from '../src/native-patch.mjs'

const source='<svg viewBox="0 0 200 100"><text id="label" font-family="Arial" font-size="28" font-style="normal" fill="#eee">Title</text></svg>'

test('font-family updates accept safe common and Unicode family names',()=>{
  for(const family of ['Georgia','Noto Sans','Écriture Moderne','Avenir Next','Noto Sans JP']) {
    const patch=svgAttributePatch(source,{id:'label',attribute:'font-family',value:family})
    const edited=applyNativePatches({source,format:'svg',baseHash:sourceHash(source),patches:[patch]})
    assert.equal(edited.ok,true)
    assert.ok(edited.source.includes('font-family="'+family+'"'))
  }
})
test('typography validation rejects script-like and markup-injection values',()=>{
  for(const family of ['url(javascript:alert(1))','A" onload="bad','<script>','background:url(http://x)']) {
    assert.throws(()=>svgAttributePatch(source,{id:'label',attribute:'font-family',value:family}),{code:'invalid-value'})
  }
})
test('numeric font-size bounds and supported style values are enforced',()=>{
  assert.throws(()=>svgAttributePatch(source,{id:'label',attribute:'font-size',value:'0'}),{code:'invalid-value'})
  assert.throws(()=>svgAttributePatch(source,{id:'label',attribute:'font-size',value:'999'}),{code:'invalid-value'})
  assert.equal(svgAttributePatch(source,{id:'label',attribute:'font-style',value:'italic'}).after,'italic')
})

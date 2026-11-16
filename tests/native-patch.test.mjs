import test from 'node:test'
import assert from 'node:assert/strict'
import { applyNativePatches, sourceHash } from '../src/native-patch.mjs'
const apply = (source, patches, format='svg', baseHash=sourceHash(source)) => applyNativePatches({source, format, baseHash, patches})

test('no-op preserves exact source and hash', () => {
  const source = '\ufeff<svg xmlns="http://www.w3.org/2000/svg">\n  <rect/>\n</svg>\n'
  assert.deepEqual(apply(source, []), {ok:true, source, hash:sourceHash(source),changed:false,inverse:[]})
})
test('SVG targeted edit preserves all unrelated bytes', () => {
  const source = '<svg>\n  <rect fill="red"/>\n  <rect fill="red"/>\n</svg>'
  const start = source.lastIndexOf('red')
  const result = apply(source, [{start,end:start+3,before:'red',after:'#00f'}])
  assert.equal(result.ok,true)
  assert.equal(result.source,'<svg>\n  <rect fill="red"/>\n  <rect fill="#00f"/>\n</svg>')
  const undo = apply(result.source,result.inverse,'svg',result.hash)
  assert.equal(undo.source,source)
})
test('HTML unicode offsets and inverse', () => {
  const source='<p>🎨 design</p>'
  const start=source.indexOf('design')
  const result=apply(source,[{start,end:start+6,before:'design',after:'studio'}],'html')
  assert.equal(result.source,'<p>🎨 studio</p>')
  assert.equal(apply(result.source,result.inverse,'html',result.hash).source,source)
})
test('CSS edits remain bounded',()=>{
  const source='a { color: red; }\nb { color: red; }'
  const start=source.indexOf('red')
  assert.equal(apply(source,[{start,end:start+3,before:'red',after:'blue'}],'css').source,'a { color: blue; }\nb { color: red; }')
})
test('stale revision rejected',()=>{
  const source='<svg/>'
  assert.equal(apply(source,[],'svg',sourceHash('other')).code,'stale-revision')
})
test('range mismatch rejected',()=>{
  assert.equal(apply('<svg/>',[{start:1,end:4,before:'XXX',after:'div'}]).code,'precondition-failed')
})
test('overlapping ranges rejected atomically',()=>{
  const source='abcdef'
  assert.equal(apply(source,[{start:1,end:3,before:'bc',after:'x'},{start:2,end:4,before:'cd',after:'y'}]).code,'overlap')
})
test('same-position inserts rejected',()=>{
  const source='abc'
  assert.equal(apply(source,[{start:1,end:1,before:'',after:'x'},{start:1,end:1,before:'',after:'y'}]).code,'overlap')
})
test('multiple edits and precise inverse offsets',()=>{
  const source='abcdef'
  const result=apply(source,[{start:1,end:2,before:'b',after:'BBB'},{start:4,end:6,before:'ef',after:'Z'}])
  assert.equal(result.source,'aBBBcdZ')
  assert.equal(apply(result.source,result.inverse,'svg',result.hash).source,source)
})
test('unsupported format and malformed patch rejected',()=>{
  assert.equal(apply('x',[],'js').code,'unsupported-format')
  assert.equal(apply('x',[{start:-1,end:1,before:'x',after:'y'}]).code,'invalid-patch')
})
test('patch order does not change result',()=>{
  const source='abcdef'
  const patches=[{start:4,end:6,before:'ef',after:'x'},{start:0,end:2,before:'ab',after:'y'}]
  const result=apply(source,patches)
  assert.equal(result.source,'ycdx')
  assert.equal(apply(result.source,result.inverse,'svg',result.hash).source,source)
})

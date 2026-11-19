import test from 'node:test'
import assert from 'node:assert/strict'
import { collectHtmlCssCandidates,resolveStylesheetPath } from '../src/html-css-associations.mjs'

const identity='a'.repeat(64)
function storeFor(files) {
  const reads=[]
  return {
    reads,
    async read(file) {
      reads.push(file)
      if(!Object.hasOwn(files,file))throw new Error('missing')
      return {source:files[file],identity}
    },
  }
}
function htmlWith(cssHref,body) {
  return `<link rel="stylesheet" href="${cssHref}">${body}`
}

test('selector-list matches are labelled possible with indicative specificity',async()=>{
  const css='h1, .card { color: red; }\n'
  const store=storeFor({'pages/styles/site.css':css})
  const html=htmlWith('styles/site.css',
    '<main id="app"><h1 id="title" class="card">Hi</h1></main>')
  const result=await collectHtmlCssCandidates(store,{file:'pages/index.html',source:html})
  const title=result.styleMatches.find(item=>item.id==='title')
  assert.equal(title.matches.length,1)
  const match=title.matches[0]
  assert.equal(match.selector,'h1, .card')
  assert.equal(match.matchedSelector,'h1')
  assert.deepEqual(match.matchedSelectors,['h1','.card'])
  assert.equal(match.specificity,10)
  assert.equal(match.specificityApproximate,true)
  assert.equal(match.certainty,'possible')
  assert.deepEqual(match.declarations,[{property:'color',value:'red'}])
  // Never presented as a resolved cascade or computed style.
  assert.equal(Object.hasOwn(match,'computed'),false)
  assert.equal(Object.hasOwn(match,'cascade'),false)
  assert.equal(result.styleMatches.find(item=>item.id==='app').matches.length,0)
  assert.deepEqual(store.reads,['pages/styles/site.css'])
})

test('simple id/class candidates keep exact historical specificity values',async()=>{
  const css='#title { color: red; }\n.card { display: flex; }\n'
  const store=storeFor({'pages/styles/site.css':css})
  const html=htmlWith('styles/site.css','<h1 id="title" class="card">Hi</h1>')
  const result=await collectHtmlCssCandidates(store,{file:'pages/index.html',source:html})
  const matches=result.styleMatches.find(item=>item.id==='title').matches
  assert.deepEqual(matches.map(match=>match.selector),['#title','.card'])
  assert.deepEqual(matches.map(match=>match.specificity),[100,10])
  assert.ok(matches.every(match=>match.specificityApproximate===false))
  assert.ok(matches.every(match=>match.certainty==='possible'))
  assert.ok(matches.every(match=>Object.hasOwn(match,'computed')===false))
  assert.equal(typeof result.styleMatches[0].key,'string')
  assert.deepEqual(result.styleMatches[0].path,[1])
})

test('child selectors and simple media are candidates while pseudo-classes stay excluded',async()=>{
  const css='main > #title { display: none; }\n'+
    '@media (min-width: 600px) { #title { color: blue; } }\n'+
    '#title:hover { color: green; }\n'
  const store=storeFor({'pages/styles/site.css':css})
  const html=htmlWith('styles/site.css','<main id="app"><h1 id="title">Hi</h1></main>')
  const result=await collectHtmlCssCandidates(store,{file:'pages/index.html',source:html})
  const matches=result.styleMatches.find(item=>item.id==='title').matches
  assert.equal(matches.length,2)
  assert.equal(matches[0].selector,'main > #title')
  assert.equal(matches[1].media.condition,'(min-width: 600px)')
  assert.equal(matches[0].editable,true)
  const refusals=result.stylesheets[0].ambiguousSelectors
  assert.ok(Array.isArray(refusals))
  const bySelector=new Map(refusals.map(entry=>[entry.selector,entry]))
  assert.equal(bySelector.has('main > #title'),false)
  assert.equal(bySelector.has('#title'),false)
  assert.equal(bySelector.get('#title:hover').reason,'unsupported-selector')
  assert.ok(refusals.every(entry=>typeof entry.reason==='string'))
})

test('type selectors are possible structural candidates without claiming computed style',async()=>{
  const css='h1 { color: red; }\n'
  const store=storeFor({'pages/styles/site.css':css})
  const html=htmlWith('styles/site.css','<h1 id="title">Hi</h1><p id="para">P</p>')
  const result=await collectHtmlCssCandidates(store,{file:'pages/index.html',source:html})
  const title=result.styleMatches.find(item=>item.id==='title')
  assert.equal(title.matches.length,1)
  assert.equal(title.matches[0].specificity,1)
  assert.equal(title.matches[0].specificityApproximate,false)
  assert.equal(title.matches[0].certainty,'possible')
  assert.equal(result.styleMatches.find(item=>item.id==='para').matches.length,0)
})

test('duplicated selectors are marked ambiguous instead of being chosen silently',async()=>{
  const css='#title { color: red; }\n#title { color: blue; }\n'
  const store=storeFor({'pages/styles/site.css':css})
  const html=htmlWith('styles/site.css','<h1 id="title">Hi</h1>')
  const result=await collectHtmlCssCandidates(store,{file:'pages/index.html',source:html})
  const matches=result.styleMatches.find(item=>item.id==='title').matches
  assert.equal(matches.length,2)
  for(const match of matches){
    assert.equal(match.certainty,'ambiguous')
    assert.equal(match.editable,false)
    assert.equal(match.reasonCode,'duplicate-selector')
  }
})

test('inert template elements never become CSS candidates',async()=>{
  const css='.card { color: red; }\n'
  const store=storeFor({'pages/styles/site.css':css})
  const html=htmlWith('styles/site.css',
    '<template><div id="hidden" class="card">x</div></template>'+
    '<main id="app" class="card">x</main>')
  const result=await collectHtmlCssCandidates(store,{file:'pages/index.html',source:html})
  assert.deepEqual(result.styleMatches.map(item=>item.id),['app'])
  assert.equal(result.styleMatches[0].matches.length,1)
  assert.equal(result.styleMatches[0].matches[0].selector,'.card')
})

test('@import and at-rules never trigger extra file reads or preview injection',async()=>{
  const css='@import "https://evil.test/steal.css";\n'+
    '@font-face { font-family: X; src: url(https://evil.test/x.woff2); }\n'+
    '#title { color: red; }\n'
  const store=storeFor({'pages/styles/site.css':css})
  const html=htmlWith('styles/site.css','<h1 id="title">Hi</h1>')
  const result=await collectHtmlCssCandidates(store,{file:'pages/index.html',source:html})
  assert.deepEqual(store.reads,['pages/styles/site.css'])
  assert.equal(result.styleMatches[0].matches.length,1)
  assert.ok(!result.previewCss.includes('evil'))
  assert.ok(!result.previewCss.includes('@import'))
  assert.ok(!result.previewCss.includes('font-face'))
  assert.equal(resolveStylesheetPath('pages/index.html','https://evil.test/x.css'),null)
})

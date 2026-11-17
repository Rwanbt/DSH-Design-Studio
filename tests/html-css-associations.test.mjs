import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,mkdir,writeFile,symlink,rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createNativeFileStore } from '../src/native-file-store.mjs'
import { resolveStylesheetPath,collectHtmlCssCandidates } from '../src/html-css-associations.mjs'

async function withWorkspace(run){
  const root=await mkdtemp(path.join(os.tmpdir(),'dsh-css-associations-'))
  try {
    await mkdir(path.join(root,'pages'))
    await mkdir(path.join(root,'pages','styles'))
    return await run(root,createNativeFileStore(root))
  } finally {await rm(root,{recursive:true,force:true})}
}
async function collection(store,file,source) {
  return collectHtmlCssCandidates(store,{file,source})
}
test('safe relative link path rejects traversal, remote schemes, encoded aliases and absolute paths',()=>{
  const ok=['style.css','./style.css','styles/site.css','assets/icons/button.css']
  assert.deepEqual(ok.map(href=>resolveStylesheetPath('pages/index.html',href)),[
    'pages/style.css','pages/style.css','pages/styles/site.css','pages/assets/icons/button.css'])
  const rejected=['../secret.css','./../secret.css','styles/../secret.css','/etc/secret.css',
    '//host/file.css','https://host/css.css','data:text/css,body{}.css','file:///x.css',
    '%2e%2e/a.css','assets%2Ffoo.css','style.css?version=1','style.css#hash',
    'foo\\bar.css','a//b.css','a/./b.css','',null,'C:/temp.css','hidden.css/'];
  for(const href of rejected)assert.equal(resolveStylesheetPath('pages/index.html',href),null,String(href))
})
test('HTML id and classes associate only with flat static rules in the linked CSS file',()=>withWorkspace(async(root,store)=>{
  const css='#title {color:#aa8844;}\n.card {display:flex;gap:8px}\n'
  await writeFile(path.join(root,'pages/styles/theme.css'),css)
  const html='<link rel="stylesheet" href="./styles/theme.css">'+
    '<section id="app"><h1 id="title" class="card accent">Hi</h1></section>'
  const result=await collection(store,'pages/index.html',html)
  assert.equal(result.stylesheets.length,1)
  assert.equal(result.stylesheets[0].status,'inspected')
  assert.match(result.stylesheets[0].identity,/^[a-f0-9]{64}$/)
  assert.deepEqual(result.styleMatches.find(e=>e.id==='title').matches.map(e=>e.selector),['#title','.card'])
  assert.deepEqual(result.styleMatches.find(e=>e.id==='app').matches,[])
  const line=result.styleMatches.find(e=>e.id==='title').matches[0]
  assert.equal(line.file,'pages/styles/theme.css')
  assert.equal(line.specificity,100)
  assert.equal(line.declarations[0].property,'color')
  assert.equal(line.editable,true)
}))
test('unavailable, unsupported, duplicate and external CSS links are fail-closed',()=>withWorkspace(async(root,store)=>{
  await writeFile(path.join(root,'pages/styles/a.css'),'#app{color:red}')
  const html='<link href="https://evil.example/steal.css" rel="stylesheet">'+
    '<link rel="stylesheet" href="../outside.css">'+
    '<link rel="stylesheet" href="styles/missing.css">'+
    '<link rel="stylesheet" href="styles/a.css">'+
    '<link rel="stylesheet" href="styles/a.css">'+
    '<div id="app"></div>'
  const result=await collection(store,'pages/index.html',html)
  assert.deepEqual(result.stylesheets.map(link=>link.status),[
    'unsupported-link','unsupported-link','unavailable','inspected','duplicate-link'])
  assert.equal(result.styleMatches.find(x=>x.id==='app').matches.length,1)
  assert.equal(result.styleMatches[0].matches[0].file,'pages/styles/a.css')
}))
test('symlinked CSS files are not read or treated as editable references',()=>withWorkspace(async(root,store)=>{
  await writeFile(path.join(root,'outside.css'),'#app{display:none;}')
  await symlink(path.join(root,'outside.css'),path.join(root,'pages/styles/untrusted.css'))
  const html='<link rel="stylesheet" href="styles/untrusted.css"><main id="app">Hello</main>'
  const data=await collection(store,'pages/index.html',html)
  assert.equal(data.stylesheets[0].status,'unavailable')
  assert.equal(data.styleMatches.find(e=>e.id==='app').matches.length,0)
}))
test('comments, script strings, templates and invalid unquoted links never open files',()=>withWorkspace(async(root,store)=>{
  await writeFile(path.join(root,'pages/styles/a.css'),'#app{color:red}')
  const html='<!-- <link rel="stylesheet" href="styles/a.css"> -->'+
    '<script>const fake = \'<link rel="stylesheet" href="styles/a.css">\';</script>'+
    '<template><link rel="stylesheet" href="styles/a.css"></template>'+
    '<link rel=stylesheet href="styles/a.css">'+
    '<div id="app"></div>'
  const result=await collection(store,'pages/index.html',html)
  assert.deepEqual(result.stylesheets.map(s=>s.status),['unsupported-link'])
  assert.deepEqual(result.styleMatches.find(e=>e.id==='app').matches,[])
}))
test('multiple stylesheets show potential competing rules without declaring computed style',()=>withWorkspace(async(root,store)=>{
  await writeFile(path.join(root,'pages/styles/a.css'),'.card{color:red}')
  await writeFile(path.join(root,'pages/styles/b.css'),'.card{color:blue}')
  const html='<link rel="stylesheet" href="styles/a.css">'+
    '<link rel="stylesheet" href="styles/b.css">'+
    '<div id="card" class="card" style="color:green;">Text</div>'
  const result=await collection(store,'pages/index.html',html)
  const matches=result.styleMatches.find(e=>e.id==='card').matches
  assert.equal(matches.length,2)
  assert.equal(matches[0].specificity,10)
  assert.equal(matches[1].duplicateAcrossFiles,true)
  assert.equal(result.stylesheets.length,2)
  assert.equal(Object.hasOwn(matches[0],'computed'),false)
}))
test('bounded inspection refuses linked stylesheets beyond the eighth link',()=>withWorkspace(async(root,store)=>{
  const html=Array.from({length:10},(_,i)=>'<link rel="stylesheet" href="x'+i+'.css">').join('')+
    '<div id="app"></div>'
  const result=await collection(store,'pages/index.html',html)
  assert.equal(result.stylesheets.length,9)
  assert.equal(result.stylesheets.at(-1).status,'limit-exceeded')
  assert.equal(result.styleMatches[0].matches.length,0)
}))

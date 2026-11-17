import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, symlink, chmod, stat, rm, link, rename } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createNativeFileStore } from '../src/native-file-store.mjs'

async function workspace(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-native-store-'))
  try { return await run(root, createNativeFileStore(root)) }
  finally { await rm(root, { recursive: true, force: true }) }
}
const patchFor = (source, before, after) => {
  const start = source.indexOf(before)
  return [{start, end:start + before.length, before, after}]
}

test('reads and no-op saves exact BOM and CRLF bytes', () => workspace(async (root, store) => {
  const bytes = Buffer.from('\ufeff<svg>\r\n<rect fill="red"/>\r\n</svg>\r\n')
  await writeFile(path.join(root, 'icon.svg'), bytes)
  const doc = await store.read('icon.svg')
  assert.ok(doc.source.startsWith('\ufeff'))
  const saved = await store.apply('icon.svg', {baseHash:doc.hash,baseIdentity:doc.identity,patches:[]})
  assert.equal(saved.changed,false)
  assert.deepEqual(await readFile(path.join(root,'icon.svg')),bytes)
}))
test('precise edit saves and can be reopened and undone', () => workspace(async (root, store) => {
  const source = '<svg><rect fill="red"/><rect fill="red"/></svg>'
  await writeFile(path.join(root,'icon.svg'),source)
  const doc=await store.read('icon.svg')
  const index=source.lastIndexOf('red')
  const saved=await store.apply('icon.svg',{baseHash:doc.hash,baseIdentity:doc.identity,patches:[{start:index,end:index+3,before:'red',after:'blue'}]})
  assert.equal(saved.changed,true)
  const edited=await store.read('icon.svg')
  assert.equal(edited.source,'<svg><rect fill="red"/><rect fill="blue"/></svg>')
  assert.equal(edited.hash,saved.hash)
  await store.apply('icon.svg',{baseHash:edited.hash,baseIdentity:edited.identity,patches:saved.inverse})
  assert.equal((await store.read('icon.svg')).source,source)
}))
test('stale external edit is rejected without overwrite', () => workspace(async(root,store)=>{
  await writeFile(path.join(root,'page.html'),'<p>old</p>')
  const doc=await store.read('page.html')
  await writeFile(path.join(root,'page.html'),'<p>new</p>')
  await assert.rejects(store.apply('page.html',{baseHash:doc.hash,baseIdentity:doc.identity,patches:patchFor(doc.source,'old','OK')}),{code:'stale-revision'})
  assert.equal(await readFile(path.join(root,'page.html'),'utf8'),'<p>new</p>')
}))
test('two saves from one revision cannot both succeed', () => workspace(async(root,store)=>{
  await writeFile(path.join(root,'page.html'),'<p>old</p>')
  const doc=await store.read('page.html')
  const p=patchFor(doc.source,'old','one')
  const results=await Promise.allSettled([
    store.apply('page.html',{baseHash:doc.hash,baseIdentity:doc.identity,patches:p}),
    store.apply('page.html',{baseHash:doc.hash,baseIdentity:doc.identity,patches:patchFor(doc.source,'old','two')})
  ])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
  assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='stale-revision').length,1)
}))
test('rejects relative traversal and absolute, Windows paths and unsupported extensions', () => workspace(async(root,store)=>{
  for (const pathName of ['../bad.svg','a/../bad.svg','/tmp/a.svg','C:\\tmp\\x.svg','foo.js','a//b.svg',
    'page:ads.svg','CON.svg','aux/file.css','COM1.svg','name?.html','page .css','folder./page.svg','bad\u0001name.svg']) {
    await assert.rejects(store.read(pathName))
  }
}))
test('refuses symlink files and directory components', () => workspace(async(root,store)=>{
  await writeFile(path.join(root,'real.svg'),'<svg/>')
  await symlink('real.svg',path.join(root,'link.svg'))
  await assert.rejects(store.read('link.svg'),{code:'symlink-forbidden'})
  await mkdir(path.join(root,'dir'))
  await symlink('dir',path.join(root,'alias'))
  await writeFile(path.join(root,'dir','x.svg'),'<svg/>')
  await assert.rejects(store.read('alias/x.svg'),{code:'symlink-forbidden'})
}))
test('rejects hardlinked files', () => workspace(async(root,store)=>{
  await writeFile(path.join(root,'a.svg'),'<svg/>')
  await link(path.join(root,'a.svg'),path.join(root,'b.svg'))
  await assert.rejects(store.read('a.svg'),{code:'invalid-file'})
}))
test('rejects invalid UTF-8 and NUL',()=>workspace(async(root,store)=>{
  await writeFile(path.join(root,'bad.svg'),Buffer.from([0xff]))
  await assert.rejects(store.read('bad.svg'),{code:'invalid-encoding'})
  await writeFile(path.join(root,'bad.svg'),Buffer.from([0x3c,0,0x3e]))
  await assert.rejects(store.read('bad.svg'),{code:'invalid-encoding'})
}))
test('preserves file permissions during a save',()=>workspace(async(root,store)=>{
  await writeFile(path.join(root,'x.css'),'a{color:red}')
  await chmod(path.join(root,'x.css'),0o640)
  const doc=await store.read('x.css')
  await store.apply('x.css',{baseHash:doc.hash,baseIdentity:doc.identity,patches:patchFor(doc.source,'red','blue')})
  assert.equal((await stat(path.join(root,'x.css'))).mode&0o777,0o640)
}))
test('rejects malformed edits without modifying source',()=>workspace(async(root,store)=>{
  await writeFile(path.join(root,'x.svg'),'<svg/>')
  const doc=await store.read('x.svg')
  await assert.rejects(store.apply('x.svg',{baseHash:doc.hash,baseIdentity:doc.identity,patches:[{start:0,end:1,before:'X',after:'a'}]}),{code:'precondition-failed'})
  assert.equal(await readFile(path.join(root,'x.svg'),'utf8'),doc.source)
}))


test('identity tokens reject same-content replacement across read/apply',()=>workspace(async(root,store)=>{
  const file=path.join(root,'same.svg')
  const content='<svg><rect id="one"/></svg>'
  await writeFile(file,content)
  const original=await store.read('same.svg')
  assert.match(original.identity,/^[a-f0-9]{64}$/)
  const replacement=path.join(root,'replacement.svg')
  await writeFile(replacement,content)
  await rename(replacement,file)
  const fresh=await store.read('same.svg')
  assert.equal(original.hash,fresh.hash,'Bytes are identical')
  assert.notEqual(original.identity,fresh.identity,'Filesystem identity changed')
  await assert.rejects(store.apply('same.svg',{
    baseHash:original.hash,baseIdentity:original.identity,
    patches:patchFor(content,'one','two')
  }),{code:'stale-revision'})
  assert.equal(await readFile(file,'utf8'),content)
  const saved=await store.apply('same.svg',{
    baseHash:fresh.hash,baseIdentity:fresh.identity,
    patches:patchFor(content,'one','two')
  })
  assert.equal(saved.changed,true)
  assert.equal((await store.read('same.svg')).source,'<svg><rect id="two"/></svg>')
}))

test('identity precondition also refuses metadata-only rewrites',()=>workspace(async(root,store)=>{
  const file=path.join(root,'fresh.css')
  const content='body{color:red}'
  await writeFile(file,content)
  const doc=await store.read('fresh.css')
  // Same bytes through a new file should always invalidate the on-disk identity.
  await writeFile(path.join(root,'tmp.css'),content)
  await rename(path.join(root,'tmp.css'),file)
  const now=await store.read('fresh.css')
  assert.equal(now.hash,doc.hash)
  assert.notEqual(now.identity,doc.identity)
  await assert.rejects(store.apply('fresh.css',{
    baseHash:doc.hash,baseIdentity:doc.identity,patches:[]
  }),{code:'stale-revision'})
}))

test('replacing a parent directory while a write waits for lock never writes to the replacement',()=>workspace(async(root,store)=>{
  const sub=path.join(root,'pages')
  await mkdir(sub)
  const original='<p>old</p>'
  await writeFile(path.join(sub,'page.html'),original)
  const doc=await store.read('pages/page.html')
  const lockDir=path.join(sub,'.page.html.dsh-native.lock')
  await mkdir(lockDir)
  const pending=store.apply('pages/page.html',{
    baseHash:doc.hash,baseIdentity:doc.identity,
    patches:patchFor(doc.source,'old','new')
  })
  // Attach the rejection handler immediately: a directory swap may terminate
  // the pending operation before the scheduled assertion runs.
  void pending.catch(()=>{})
  await new Promise(resolve=>setTimeout(resolve,90))
  await rename(sub,path.join(root,'pages-original'))
  await mkdir(sub)
  await writeFile(path.join(sub,'page.html'),original)
  await assert.rejects(pending,{code:'stale-revision'})
  assert.equal(await readFile(path.join(sub,'page.html'),'utf8'),original)
  assert.equal(await readFile(path.join(root,'pages-original','page.html'),'utf8'),original)
}))

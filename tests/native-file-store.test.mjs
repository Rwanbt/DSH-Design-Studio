import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, symlink, chmod, stat, rm, link } from 'node:fs/promises'
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
  const saved = await store.apply('icon.svg', {baseHash:doc.hash,patches:[]})
  assert.equal(saved.changed,false)
  assert.deepEqual(await readFile(path.join(root,'icon.svg')),bytes)
}))
test('precise edit saves and can be reopened and undone', () => workspace(async (root, store) => {
  const source = '<svg><rect fill="red"/><rect fill="red"/></svg>'
  await writeFile(path.join(root,'icon.svg'),source)
  const doc=await store.read('icon.svg')
  const index=source.lastIndexOf('red')
  const saved=await store.apply('icon.svg',{baseHash:doc.hash,patches:[{start:index,end:index+3,before:'red',after:'blue'}]})
  assert.equal(saved.changed,true)
  const edited=await store.read('icon.svg')
  assert.equal(edited.source,'<svg><rect fill="red"/><rect fill="blue"/></svg>')
  assert.equal(edited.hash,saved.hash)
  await store.apply('icon.svg',{baseHash:edited.hash,patches:saved.inverse})
  assert.equal((await store.read('icon.svg')).source,source)
}))
test('stale external edit is rejected without overwrite', () => workspace(async(root,store)=>{
  await writeFile(path.join(root,'page.html'),'<p>old</p>')
  const doc=await store.read('page.html')
  await writeFile(path.join(root,'page.html'),'<p>new</p>')
  await assert.rejects(store.apply('page.html',{baseHash:doc.hash,patches:patchFor(doc.source,'old','OK')}),{code:'stale-revision'})
  assert.equal(await readFile(path.join(root,'page.html'),'utf8'),'<p>new</p>')
}))
test('two saves from one revision cannot both succeed', () => workspace(async(root,store)=>{
  await writeFile(path.join(root,'page.html'),'<p>old</p>')
  const doc=await store.read('page.html')
  const p=patchFor(doc.source,'old','one')
  const results=await Promise.allSettled([
    store.apply('page.html',{baseHash:doc.hash,patches:p}),
    store.apply('page.html',{baseHash:doc.hash,patches:patchFor(doc.source,'old','two')})
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
  await store.apply('x.css',{baseHash:doc.hash,patches:patchFor(doc.source,'red','blue')})
  assert.equal((await stat(path.join(root,'x.css'))).mode&0o777,0o640)
}))
test('rejects malformed edits without modifying source',()=>workspace(async(root,store)=>{
  await writeFile(path.join(root,'x.svg'),'<svg/>')
  const doc=await store.read('x.svg')
  await assert.rejects(store.apply('x.svg',{baseHash:doc.hash,patches:[{start:0,end:1,before:'X',after:'a'}]}),{code:'precondition-failed'})
  assert.equal(await readFile(path.join(root,'x.svg'),'utf8'),doc.source)
}))

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, link, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { listWorkspaceDocuments } from '../src/workspace-files.mjs'

async function workspace(fn) {
  const root=await mkdtemp(path.join(os.tmpdir(),'dsh-native-picker-'))
  try {await fn(root)}
  finally {await rm(root,{recursive:true,force:true})}
}

test('returns sorted SVG HTML CSS paths with format and byte sizes',()=>workspace(async root=>{
  await mkdir(path.join(root,'assets'))
  await mkdir(path.join(root,'src'))
  await writeFile(path.join(root,'assets','poster.SVG'),'<svg/>')
  await writeFile(path.join(root,'src','index.HTML'),'<h1>Hi</h1>')
  await writeFile(path.join(root,'src','theme.css'),'a{}')
  await writeFile(path.join(root,'app.js'),'console.log(1)')
  const result=await listWorkspaceDocuments(root)
  assert.deepEqual(result.files.map(item=>item.path),['assets/poster.SVG','src/index.HTML','src/theme.css'])
  assert.deepEqual(result.files.map(item=>item.format),['svg','html','css'])
  assert.equal(result.files[0].size,6)
  assert.equal(result.truncated,false)
  assert.ok(result.scanned>=5)
}))
test('ignores hidden paths, node_modules and cache directories',()=>workspace(async root=>{
  await mkdir(path.join(root,'.git'))
  await mkdir(path.join(root,'node_modules'))
  await mkdir(path.join(root,'.cache'))
  await mkdir(path.join(root,'good'))
  for(const name of ['.git','node_modules','.cache','good']) await writeFile(path.join(root,name,'test.svg'),'<svg/>')
  await writeFile(path.join(root,'.secret.svg'),'<svg/>')
  assert.deepEqual((await listWorkspaceDocuments(root)).files.map(f=>f.path),['good/test.svg'])
}))
test('does not follow directory or file symlinks escaping the workspace',()=>workspace(async root=>{
  const outside=await mkdtemp(path.join(os.tmpdir(),'dsh-picker-outside-'))
  try {
    await mkdir(path.join(outside,'external'))
    await writeFile(path.join(outside,'external','secret.svg'),'<svg/>')
    await symlink(path.join(outside,'external'),path.join(root,'linked'),process.platform==='win32'?'junction':'dir')
    await symlink(path.join(outside,'external','secret.svg'),path.join(root,'leak.svg'))
    assert.deepEqual((await listWorkspaceDocuments(root)).files,[])
  }finally{await rm(outside,{recursive:true,force:true})}
}))
test('does not offer hardlinked or oversized files',()=>workspace(async root=>{
  await writeFile(path.join(root,'allowed.svg'),'<svg/>')
  await link(path.join(root,'allowed.svg'),path.join(root,'linked.svg'))
  await writeFile(path.join(root,'too-big.css'),'X'.repeat(8*1024*1024+1))
  await writeFile(path.join(root,'normal.css'),'a{}')
  assert.deepEqual((await listWorkspaceDocuments(root)).files.map(f=>f.path),['normal.css'])
}))
test('caps to 300 files and reports truncation instead of unbounded response',()=>workspace(async root=>{
  await Promise.all(Array.from({length:322},(_,i)=>writeFile(path.join(root,'file-'+String(i).padStart(4,'0')+'.svg'),'<svg/>')))
  const result=await listWorkspaceDocuments(root)
  assert.equal(result.files.length,300)
  assert.equal(result.truncated,true)
  assert.deepEqual(result.files.map(f=>f.path),[...result.files.map(f=>f.path)].sort((a,b)=>a.localeCompare(b,'en')))
}))
test('caps recursion depth and does not scan files past the limit',()=>workspace(async root=>{
  let at=root
  for(let i=0;i<10;i++) {
    at=path.join(at,'layer'+i)
    await mkdir(at)
  }
  await writeFile(path.join(at,'deep.svg'),'<svg/>')
  const result=await listWorkspaceDocuments(root)
  assert.equal(result.files.length,0)
  assert.equal(result.truncated,true)
}))
test('rejects invalid workspace root',async()=>{
  await assert.rejects(listWorkspaceDocuments(''),{code:'invalid-path'})
})

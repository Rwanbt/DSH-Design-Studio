import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rmdir, readFile, writeFile, lstat, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNativeFileStore } from '../src/native-file-store.mjs'
import { withNativeWriteLock } from '../src/native-write-lock.mjs'

const worker=fileURLToPath(new URL('./fixtures/native-write-worker.mjs',import.meta.url))
async function fixture(run) {
  const root=await mkdtemp(path.join(os.tmpdir(),'dsh-cross-process-lock-'))
  try {await run(root)}finally{await rm(root,{recursive:true,force:true})}
}
function childWriter(root,hash,replacement,gate) {
  const child=spawn(process.execPath,[worker,root,'page.html',hash,replacement,gate],
    {stdio:['ignore','pipe','pipe']})
  let output='',errors='',readyDone=false
  let resolveReady,rejectReady
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject})
  child.stdout.on('data',bytes=>{
    output+=String(bytes)
    if(output.includes('READY\n') && !readyDone){readyDone=true;resolveReady()}
  })
  child.stderr.on('data',bytes=>{errors+=String(bytes)})
  const done=new Promise((resolve,reject)=>{
    child.on('error',err=>{if(!readyDone)rejectReady(err);reject(err)})
    child.on('close',code=>{
      if(!readyDone)rejectReady(new Error('Worker exited before ready: '+errors))
      if(code!==0){reject(new Error('Worker failed '+code+': '+errors));return}
      const last=output.trim().split(/\r?\n/).at(-1)
      try{resolve(JSON.parse(last))}catch(e){reject(new Error('Invalid child output: '+output+'\n'+errors))}
    })
  })
  return {ready,done}
}

test('two genuinely independent Node processes cannot both save one revision',()=>fixture(async root=>{
  await writeFile(path.join(root,'page.html'),'<p>old</p>')
  const hash=(await createNativeFileStore(root).read('page.html')).hash
  const gate=path.join(root,'go.start')
  const a=childWriter(root,hash,'one',gate), b=childWriter(root,hash,'two',gate)
  await Promise.all([a.ready,b.ready])
  await writeFile(gate,'go')
  const results=await Promise.all([a.done,b.done])
  assert.equal(results.filter(result=>result.ok).length,1,JSON.stringify(results))
  assert.equal(results.filter(result=>!result.ok&&result.code==='stale-revision').length,1,JSON.stringify(results))
  const text=await readFile(path.join(root,'page.html'),'utf8')
  assert.ok(text==='<p>one</p>'||text==='<p>two</p>',text)
  await assert.rejects(lstat(path.join(root,'.page.html.dsh-native.lock')),{code:'ENOENT'})
}))
test('a held writer lock times out without evicting the other owner',()=>fixture(async root=>{
  const file=path.join(root,'page.html')
  const directory=path.join(root,'.page.html.dsh-native.lock')
  await writeFile(file,'<p>old</p>')
  await mkdir(directory)
  let executed=false
  await assert.rejects(
    withNativeWriteLock(file,async()=>{executed=true},{waitMs:100,pollMs:10}),
    {code:'file-busy'}
  )
  assert.equal(executed,false)
  assert.equal((await lstat(directory)).isDirectory(),true)
  assert.equal(await readFile(file,'utf8'),'<p>old</p>')
  await rmdir(directory)
  await withNativeWriteLock(file,async()=>{executed=true})
  assert.equal(executed,true)
}))
test('a failed edit releases the cross-process lock and allows the next save',()=>fixture(async root=>{
  const file=path.join(root,'page.html')
  await writeFile(file,'<p>old</p>')
  const store=createNativeFileStore(root)
  const doc=await store.read('page.html')
  await assert.rejects(store.apply('page.html',{
    baseHash:doc.hash,
    patches:[{start:3,end:6,before:'wrong',after:'blue'}],
  }),{code:'precondition-failed'})
  const saved=await store.apply('page.html',{
    baseHash:doc.hash,
    patches:[{start:3,end:6,before:'old',after:'new'}],
  })
  assert.equal(saved.changed,true)
  assert.equal(await readFile(file,'utf8'),'<p>new</p>')
  await assert.rejects(lstat(path.join(root,'.page.html.dsh-native.lock')),{code:'ENOENT'})
}))

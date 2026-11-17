import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { apply, inject, name } from '../src/plugin-host.mjs'

test('host bundle registers one API prefix and unregisters it on effect disposal',async()=>{
  const cwd=await mkdtemp(path.join(os.tmpdir(),'dsh-plugin-lifecycle-'))
  try {
    await writeFile(path.join(cwd,'logo.svg'),'<svg/>')
    const subscriptions=[]
    let registered,disposed=false
    const ctx={
      agents:{get:id=>id==='active'?{id}:undefined},
      workingDirectory:{ensure:async()=>cwd},
      webServer:{
        register({kind,prefix,path,handler}){
          assert.equal(kind,'prefix')
          assert.equal(path,'/design-studio-native')
          assert.equal(prefix,undefined)
          assert.equal(typeof handler,'function')
          registered=handler
          return ()=>{disposed=true;registered=undefined}
        },
      },
      effect(factory){
        const dispose=factory()
        assert.equal(typeof dispose,'function')
        subscriptions.push(dispose)
      },
    }
    assert.equal(name,'dsh-design-studio')
    assert.deepEqual(inject,['webServer','agents','workingDirectory','workspaceRegistry'])
    apply(ctx)
    assert.equal(subscriptions.length,1)
    const invoke=async pathname=>{
      const request=Readable.from([])
      request.method='GET';request.url=pathname;request.headers={}
      let status,answer
      await registered(request,{
        writeHead(code){status=code},
        end(json){answer=JSON.parse(json)},
      })
      return {status,answer}
    }
    const health=await invoke('/design-studio-native/health')
    assert.equal(health.status,200)
    assert.equal(health.answer.ok,true)
    const files=await invoke('/design-studio-native/files?sessionId=active')
    assert.equal(files.status,200)
    assert.deepEqual(files.answer.files.map(f=>f.path),['logo.svg'])
    subscriptions[0]()
    assert.equal(disposed,true)
    assert.equal(registered,undefined)
  }finally{await rm(cwd,{recursive:true,force:true})}
})

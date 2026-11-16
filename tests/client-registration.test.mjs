import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const client = new URL('../client.js',import.meta.url)
const pkg = new URL('../package.json',import.meta.url)
test('browser entrypoint registers native conversation Design Studio view without AI', async()=>{
  let definition
  runInNewContext(await readFile(client,'utf8'), {
    window:{__ModuleLoader__:{load: plugin=>definition=plugin}}
  })
  assert.equal(definition.id,'@rwanbt/dsh-design-studio')
  const React={createElement:(type,props,...children)=>({type,props,children})}
  const plugin=definition.factory(name=>{assert.equal(name,'react');return React})
  let slot,registration,component
  const slots={inject:(name,fn)=>{slot=name;fn()},register:(details,view)=>{registration=details;component=view;return()=>{}}}
  plugin.apply({slots})
  assert.equal(slot,'conversation.view')
  assert.equal(registration.id,'dsh-design-studio')
  assert.equal(typeof component,'function')
})
test('native plugin package exposes host, client and bundle manifest',async()=>{
  const manifest=JSON.parse(await readFile(pkg,'utf8'))
  assert.equal(manifest.name,'@rwanbt/dsh-design-studio')
  assert.equal(manifest.dsh.client.platform,'web')
  assert.equal(manifest.dsh.bundle.patch,'./cordis.patch.yml')
  assert.equal(manifest.exports['./client'],'./client.js')
})

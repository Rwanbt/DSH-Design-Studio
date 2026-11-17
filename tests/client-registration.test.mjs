import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const client = new URL('../client.js',import.meta.url)
const pkg = new URL('../package.json',import.meta.url)

const source = await readFile(client,'utf8')

test('browser entrypoint registers the conversation view, the sidebar entry and its panel', async()=>{
  let definition
  runInNewContext(source, {window:{__ModuleLoader__:{load: plugin=>definition=plugin}}})
  assert.equal(definition.id,'@rwanbt/dsh-design-studio')
  const React={createElement:(type,props,...children)=>({type,props,children})}
  const plugin=definition.factory(name=>{assert.equal(name,'react');return React})
  const registered=[]
  const slots={
    inject:(name,fn)=>{
      const before=registered.length
      fn()
      assert.ok(registered.length>before,'inject must register exactly one cell: '+name)
      assert.equal(registered.at(-1).slot,name)
    },
    register:(details,component)=>{registered.push({slot:details.name,...details,component});return()=>{}},
  }
  plugin.apply({slots})
  const bySlot=Object.fromEntries(registered.map(entry=>[entry.slot,entry]))
  assert.deepEqual(Object.keys(bySlot).sort(),['conversation.view','main','sidebar.panellist'])

  // The conversation view keeps its own id and a stable order.
  assert.equal(bySlot['conversation.view'].id,'dsh-design-studio')
  assert.equal(bySlot['conversation.view'].order,25)
  assert.equal(typeof bySlot['conversation.view'].component,'function')

  // ADR-024: the sidebar list id must address the main cell with the same key,
  // otherwise the icon would select a panel that does not exist.
  assert.equal(bySlot.main.key,'design-studio')
  assert.equal(bySlot['sidebar.panellist'].id,bySlot.main.key)
  assert.equal(typeof bySlot['sidebar.panellist'].label,'function')
  assert.equal(bySlot['sidebar.panellist'].label(),'Design Studio')
  assert.equal(typeof bySlot['sidebar.panellist'].component,'function')
  assert.equal(typeof bySlot.main.component,'function')
  assert.notEqual(bySlot['sidebar.panellist'].component,bySlot.main.component,
    'the sidebar cell is an icon, the main cell is the panel')
})

test('native plugin package exposes host, client and bundle manifest',async()=>{
  const manifest=JSON.parse(await readFile(pkg,'utf8'))
  assert.equal(manifest.name,'@rwanbt/dsh-design-studio')
  assert.equal(manifest.dsh.client.platform,'web')
  assert.equal(manifest.dsh.bundle.patch,'./cordis.patch.yml')
  assert.equal(manifest.exports['./client'],'./client.js')
})

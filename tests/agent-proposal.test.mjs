import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { apply } from '../src/plugin-host.mjs'

test('DSH proposal tool prepares a scoped native diff without saving', async context => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-proposal-'))
  const outside = await mkdtemp(join(tmpdir(), 'dsh-proposal-outside-'))
  context.after(() => Promise.all([root, outside].map(path => rm(path, { recursive: true, force: true }))))
  const agent = { id: 'design-session' }
  const original = '<h1 id="hero">Before</h1>'
  await writeFile(join(root, 'page.html'), original)
  await writeFile(join(outside, 'page.html'), '<h1 id="hero">Outside</h1>')
  let tool
  let handler
  apply({
    effect(start) { start() },
    webServer: { register(route) { handler = route.handler } },
    agents: { get(sessionId) {
      return sessionId === agent.id ? agent : sessionId === 'different' ? { id: sessionId } : null
    } },
    workingDirectory: { async ensure(caller) { assert.equal(caller, agent); return root } },
    inject(names, install) {
      assert.deepEqual(names, ['tools'])
      install({
        tools: { register(definition) { tool = definition } },
        workingDirectory: { async ensure(caller) { assert.equal(caller, agent); return root } },
      })
    },
  })
  assert.equal(tool.name, 'design_studio_propose')
  const inputs = { file: 'page.html', kind: 'html-text', id: 'hero', value: 'After' }
  const scope = { agent, signal: new AbortController().signal, callId: 'call-1' }
  const invoke = async (args, execution = scope) => JSON.parse(await tool.execute(args, execution))
  const result = await invoke(inputs)
  assert.equal(result.ok, true)
  assert.equal(result.callId, scope.callId)
  assert.deepEqual(result.proposal.edit, inputs)
  assert.equal(result.proposal.patches[0].before, 'Before')
  assert.equal(result.proposal.patches[0].after, 'After')
  assert.match(result.proposal.baseIdentity, /^[a-f0-9]{64}$/)
  assert.notEqual(result.proposal.baseHash, result.proposal.proposedHash)
  assert.equal(await readFile(join(root, 'page.html'), 'utf8'), original)
  assert.equal((await invoke({ ...inputs, workspaceId: 'other' })).error, 'invalid-edit')
  assert.equal((await invoke({ ...inputs, file: join(outside, 'page.html') })).ok, false)
  assert.equal((await invoke(inputs, { ...scope, agent: undefined })).error, 'no-session')
  await assert.rejects(tool.execute(inputs, { ...scope, signal: AbortSignal.abort() }), { name: 'AbortError' })

  async function request(method, endpoint, body) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
    req.method = method
    req.url = '/design-studio-native' + endpoint
    req.headers = { 'content-type': 'application/json' }
    let status
    let payload
    await handler(req, { writeHead(code) { status = code }, end(value) { payload = JSON.parse(value) } })
    return { status, payload }
  }

  const endpoint = '/proposals?file=page.html&sessionId='
  const list = await request('GET', endpoint + agent.id)
  assert.equal(list.status, 200)
  assert.equal(list.payload.proposals.length, 1)
  const [proposal] = list.payload.proposals
  assert.equal(proposal.callId, scope.callId)
  assert.deepEqual((await request('GET', endpoint + 'different')).payload.proposals, [])
  assert.equal(await readFile(join(root, 'page.html'), 'utf8'), original)
  const approval = { kind: 'agent-proposal', proposalId: proposal.id, file: inputs.file, sessionId: agent.id,
    baseHash: proposal.baseHash, baseIdentity: proposal.baseIdentity, expectedProposedHash: proposal.proposedHash }
  const wrongSession = await request('POST', '/apply', { ...approval, sessionId: 'different' })
  assert.equal(wrongSession.status, 404)
  const wrongHash = await request('POST', '/apply', { ...approval, expectedProposedHash: '0'.repeat(64) })
  assert.equal(wrongHash.status, 409)
  assert.equal(await readFile(join(root, 'page.html'), 'utf8'), original)

  const saved = await request('POST', '/apply', { ...approval, value: 'Injected' })
  assert.equal(saved.status, 200)
  const savedRevision = saved.payload.result
  assert.equal(await readFile(join(root, 'page.html'), 'utf8'), '<h1 id="hero">After</h1>')
  assert.equal((await request('POST', '/apply', approval)).status, 404)
  assert.deepEqual((await request('GET', endpoint + agent.id)).payload.proposals, [])

  const undo = await request('POST', '/apply', { kind: 'patches', sessionId: agent.id, file: inputs.file,
    baseHash: savedRevision.hash, baseIdentity: savedRevision.identity, patches: savedRevision.inverse })
  assert.equal(undo.status, 200)
  assert.equal(await readFile(join(root, 'page.html'), 'utf8'), original)
  assert.equal((await invoke(inputs)).ok,true)
  const [discarded]=(await request('GET',endpoint+agent.id)).payload.proposals
  const discard={sessionId:agent.id,file:inputs.file,proposalId:discarded.id}
  assert.equal((await request('POST','/proposals/discard',{...discard,sessionId:'different'})).status,404)
  assert.equal((await request('POST','/proposals/discard',{...discard,file:'other.html'})).status,404)
  assert.equal((await request('POST','/proposals/discard',discard)).status,200)
  assert.equal((await request('POST','/apply',{...approval,proposalId:discarded.id})).status,404)
  assert.deepEqual((await request('GET',endpoint+agent.id)).payload.proposals,[])
  assert.equal(await readFile(join(root,inputs.file),'utf8'),original)

  const style = await invoke({file:inputs.file,kind:'html-style',id:'hero',property:'color',value:'#123456'})
  assert.equal(style.ok,true)
  assert.match(style.proposal.patches[0].after,/color: #123456/)
  const attribute = await invoke({file:inputs.file,kind:'html-attribute',id:'hero',attribute:'title',value:'Review'})
  assert.equal(attribute.ok,true)
  assert.match(attribute.proposal.patches[0].after,/title="Review"/)
  assert.equal((await invoke({file:inputs.file,kind:'html-style',id:'hero',property:'background-image',value:'url(remote.png)'})).ok,false)
  assert.equal((await invoke({file:inputs.file,kind:'html-attribute',id:'hero',attribute:'onclick',value:'run()'})).ok,false)
  assert.equal(await readFile(join(root,inputs.file),'utf8'),original)

  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect id="a"/><rect id="b"/></svg>'
  await writeFile(join(root,'shapes.svg'),svg)
  const order = await invoke({file:'shapes.svg',kind:'svg-order',id:'a',direction:'front'})
  assert.equal(order.ok,true)
  assert.match(order.proposal.patches[0].after,/id="b".*id="a"/)
  const transform = {file:'shapes.svg',kind:'svg-transform',id:'a',operation:{type:'translate',dx:12,dy:5}}
  const translated = await invoke(transform)
  assert.equal(translated.ok,true)
  assert.match(translated.proposal.patches[0].after,/matrix\(1,0,0,1,12,5\)/)
  assert.equal((await invoke({...transform,operation:{...transform.operation,dx:'12'}})).error,'invalid-edit')
  const visibility = await invoke({file:'shapes.svg',kind:'svg-visibility',id:'a',property:'display',value:'none'})
  assert.equal(visibility.ok,true)
  assert.match(visibility.proposal.patches[0].after,/display="none"/)
  assert.equal((await invoke({file:'shapes.svg',kind:'svg-order',id:'a',direction:'sideways'})).error,'invalid-target')
  assert.equal(await readFile(join(root,'shapes.svg'),'utf8'),svg)

  const deck = '<main id="dsh-deck" data-dsh-deck="1"><section id="slide-first"><h1>First</h1></section>\n'+
    '<section id="slide-second"><h1>Second</h1></section></main>'
  await writeFile(join(root,'deck.html'),deck)
  for (const fields of [
    {kind:'slide-add',id:'slide-third',title:'Third'},
    {kind:'slide-duplicate',id:'slide-first',newId:'slide-copy'},
    {kind:'slide-reorder',id:'slide-second',direction:'earlier'},
    {kind:'slide-remove',id:'slide-second'},
  ]) {
    const edit = {file:'deck.html',...fields}
    const planned = await invoke(edit)
    assert.equal(planned.ok,true,fields.kind)
    assert.deepEqual(planned.proposal.edit,edit)
    assert.equal(planned.proposal.changed,true)
  }
  assert.equal((await invoke({file:'deck.html',kind:'slide-reorder',id:'slide-second',direction:'sideways'})).error,'invalid-slide-order')
  assert.equal((await invoke({file:'deck.html',kind:'slide-remove',id:'slide-first',value:'extra'})).error,'invalid-edit')
  assert.equal(await readFile(join(root,'deck.html'),'utf8'),deck)

})

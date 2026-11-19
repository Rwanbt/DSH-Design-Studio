import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  apply({
    effect() {},
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
})

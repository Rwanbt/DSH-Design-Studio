/**
 * Host routes for the two destructive file operations.
 *
 * The routes are thin on purpose: the store owns every guarantee. What these
 * tests prove is the contract the client depends on — status codes, typed
 * error codes, and the fact that a refused request leaves both the source and
 * the destination byte-identical.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtemp, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRouteHandler } from '../src/plugin-host.mjs'

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-host-admin-'))
  try {
    await writeFile(path.join(root, 'icon.svg'), '<svg><rect id="box" fill="red" width="10"/></svg>')
    await writeFile(path.join(root, 'autre.svg'), '<svg><!-- other --></svg>')
    const ctx = { agents: { get: (id) => id === 'known' ? { id } : undefined },
      workingDirectory: { ensure: async () => root } }
    const route = createRouteHandler(ctx)
    const invoke = async (method, url, body) => {
      const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
      request.method = method; request.url = url
      request.headers = body === undefined ? {} : { 'content-type': 'application/json' }
      let status, json
      const response = { writeHead(code) { status = code }, end(data) { json = JSON.parse(data) } }
      await route(request, response)
      return { status, json }
    }
    const open = async (file) => (await invoke('GET',
      '/design-studio-native/document?sessionId=known&file=' + encodeURIComponent(file))).json.document
    await run({ invoke, open, root })
  } finally { await rm(root, { recursive: true, force: true }) }
}

const post = (invoke, endpoint, body) => invoke('POST', '/design-studio-native/' + endpoint, body)

test('rename moves the opened document and returns the revision to use next', () => fixture(async ({ invoke, open, root }) => {
  const document = await open('icon.svg')
  const response = await post(invoke, 'rename',
    { sessionId: 'known', file: 'icon.svg', next: 'icone.svg', baseHash: document.hash, baseIdentity: document.identity })
  assert.equal(response.status, 200)
  assert.equal(response.json.ok, true)
  assert.equal(response.json.document.file, 'icone.svg')
  assert.equal(response.json.document.hash, document.hash)
  assert.equal(await readFile(path.join(root, 'icone.svg'), 'utf8'),
    '<svg><rect id="box" fill="red" width="10"/></svg>')
  await assert.rejects(readFile(path.join(root, 'icon.svg'), 'utf8'), /ENOENT/)
  // The returned revision is the one an edit must present immediately after.
  const edited = await post(invoke, 'apply', { sessionId: 'known', file: 'icone.svg',
    baseHash: response.json.document.hash, baseIdentity: response.json.document.identity,
    kind: 'svg-attribute', id: 'box', attribute: 'fill', value: 'blue' })
  assert.equal(edited.status, 200)
  assert.ok((await readFile(path.join(root, 'icone.svg'), 'utf8')).includes('fill="blue"'))
}))

test('rename refuses an occupied destination with 409 and preserves both files', () => fixture(async ({ invoke, open, root }) => {
  const document = await open('icon.svg')
  const response = await post(invoke, 'rename',
    { sessionId: 'known', file: 'icon.svg', next: 'autre.svg', baseHash: document.hash, baseIdentity: document.identity })
  assert.equal(response.status, 409)
  assert.equal(response.json.error, 'already-exists')
  assert.equal(await readFile(path.join(root, 'autre.svg'), 'utf8'), '<svg><!-- other --></svg>')
  assert.equal(await readFile(path.join(root, 'icon.svg'), 'utf8'),
    '<svg><rect id="box" fill="red" width="10"/></svg>')
}))

test('rename without a current revision is refused with 428 before touching the disk', () => fixture(async ({ invoke, root }) => {
  const response = await post(invoke, 'rename', { sessionId: 'known', file: 'icon.svg', next: 'neuf.svg' })
  assert.equal(response.status, 428)
  assert.equal(response.json.error, 'missing-revision')
  assert.deepEqual((await readdir(root)).sort(), ['autre.svg', 'icon.svg'])
}))

test('rename escapes the workspace or a symlinked parent are refused with 400', () => fixture(async ({ invoke, open, root }) => {
  const document = await open('icon.svg')
  const escape = await post(invoke, 'rename',
    { sessionId: 'known', file: 'icon.svg', next: '../dehors.svg', baseHash: document.hash, baseIdentity: document.identity })
  assert.equal(escape.status, 400)
  assert.equal(escape.json.error, 'invalid-path')
  // A symlinked component inside the workspace must be refused too.
  await symlink(path.join(root, 'autre.svg'), path.join(root, 'lien.svg'))
  const link = await post(invoke, 'rename',
    { sessionId: 'known', file: 'icon.svg', next: 'lien.svg/x.svg', baseHash: document.hash, baseIdentity: document.identity })
  assert.equal(link.status, 400)
  assert.ok(['symlink-forbidden', 'invalid-path'].includes(link.json.error), link.json.error)
}))

test('delete removes the opened document and reports it', () => fixture(async ({ invoke, open, root }) => {
  const document = await open('icon.svg')
  const response = await post(invoke, 'delete',
    { sessionId: 'known', file: 'icon.svg', baseHash: document.hash, baseIdentity: document.identity })
  assert.equal(response.status, 200)
  assert.equal(response.json.result.deleted, true)
  await assert.rejects(readFile(path.join(root, 'icon.svg'), 'utf8'), /ENOENT/)
  assert.deepEqual((await readdir(root)).sort(), ['autre.svg'])
}))

test('delete with a stale revision is refused with 409 and keeps the file', () => fixture(async ({ invoke, open, root }) => {
  const document = await open('icon.svg')
  await writeFile(path.join(root, 'icon.svg'), '<svg><!-- written elsewhere --></svg>')
  const response = await post(invoke, 'delete',
    { sessionId: 'known', file: 'icon.svg', baseHash: document.hash, baseIdentity: document.identity })
  assert.equal(response.status, 409)
  assert.equal(response.json.error, 'stale-revision')
  assert.equal(await readFile(path.join(root, 'icon.svg'), 'utf8'), '<svg><!-- written elsewhere --></svg>')
}))

test('delete without a revision is refused with 428', () => fixture(async ({ invoke }) => {
  const response = await post(invoke, 'delete', { sessionId: 'known', file: 'icon.svg' })
  assert.equal(response.status, 428)
  assert.equal(response.json.error, 'missing-revision')
}))

test('the new routes reject an unknown session instead of guessing a workspace', () => fixture(async ({ invoke }) => {
  for (const endpoint of ['rename', 'delete']) {
    const response = await post(invoke, endpoint,
      { sessionId: 'unknown', file: 'icon.svg', next: 'x.svg',
        baseHash: 'a'.repeat(64), baseIdentity: 'b'.repeat(64) })
    assert.ok(response.status >= 400, endpoint + ' must be refused: ' + response.status)
    assert.equal(response.json.ok, false)
  }
}))

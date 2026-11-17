import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRouteHandler } from '../src/plugin-host.mjs'

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect id="box" fill="red"/></svg>'

/**
 * Two real workspace roots, resolved only through a registry id.
 *
 * The point of these tests is the ADR-024 boundary: a sidebar panel has no
 * session, so it addresses a workspace by id. An id is a registry key, never a
 * path, and the routes must keep refusing anything the registry does not own.
 */
async function workspaceFixture(run, { registry = true } = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'dsh-workspace-routes-'))
  const first = path.join(base, 'projet-a')
  const second = path.join(base, 'projet-b')
  await mkdir(first, { recursive: true })
  await mkdir(second, { recursive: true })
  await writeFile(path.join(first, 'icon.svg'), ICON)
  await writeFile(path.join(first, 'styles.css'), 'body { color: #111; }')
  await writeFile(path.join(second, 'autre.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>')
  await writeFile(path.join(base, 'hors-espace.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  const workspaces = [
    { id: 'ws-a', path: first, title: 'Projet A', createdAt: '2026-01-01', updatedAt: '2026-01-01',
      sessionIds: [], status: async () => 'ok' },
    { id: 'ws-b', path: second, title: 'Projet B', createdAt: '2026-01-02', updatedAt: '2026-01-02',
      sessionIds: [], status: async () => 'ok' },
    { id: 'ws-gone', path: path.join(base, 'disparu'), title: 'Disparu', createdAt: '2026-01-03', updatedAt: '2026-01-03',
      sessionIds: [], status: async () => 'missing-dir' },
  ]
  const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]))
  const ctx = {
    agents: { get: (id) => (id === 'known' ? { id } : undefined) },
    workingDirectory: { ensure: async () => first },
    workspaceRegistry: registry ? { get: (id) => byId.get(id), list: () => workspaces } : undefined,
  }
  const route = createRouteHandler(ctx)
  const invoke = async (method, url, body) => {
    const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
    request.method = method
    request.url = url
    request.headers = body === undefined ? {} : { 'content-type': 'application/json' }
    let status, json
    const response = { writeHead(code) { status = code }, end(data) { json = JSON.parse(data) } }
    await route(request, response)
    return { status, json }
  }
  try { return await run({ invoke, first, second, base }) }
  finally { await rm(base, { recursive: true, force: true }) }
}

const docUrl = (workspaceId) =>
  '/design-studio-native/document?workspaceId=' + encodeURIComponent(workspaceId) + '&file=icon.svg'

test('workspace listing exposes ids, titles and status but never a filesystem path', () => workspaceFixture(async ({ invoke }) => {
  const listing = await invoke('GET', '/design-studio-native/workspaces')
  assert.equal(listing.status, 200)
  assert.equal(listing.json.available, true)
  assert.deepEqual(listing.json.workspaces.map((item) => item.id), ['ws-a', 'ws-b', 'ws-gone'])
  assert.deepEqual(listing.json.workspaces.map((item) => item.status), ['ok', 'ok', 'missing-dir'])
  assert.equal(listing.json.workspaces[0].title, 'Projet A')
  for (const card of listing.json.workspaces) {
    assert.deepEqual(Object.keys(card).sort(), ['id', 'status', 'title'])
  }
  assert.ok(!JSON.stringify(listing.json).includes(os.tmpdir()), 'no absolute path may leak through the listing')
}))

test('a workspace id lists and opens files from its own root', () => workspaceFixture(async ({ invoke, first }) => {
  const files = await invoke('GET', '/design-studio-native/files?workspaceId=ws-a')
  assert.equal(files.status, 200)
  assert.deepEqual(files.json.files.map((item) => item.path).sort(), ['icon.svg', 'styles.css'])
  const opened = await invoke('GET', docUrl('ws-a'))
  assert.equal(opened.status, 200)
  assert.deepEqual(opened.json.nodes.map((node) => node.id), ['box'])
  assert.equal(opened.json.document.source, ICON)
  // The bytes really came from the registered root, not from a copy.
  assert.equal(await readFile(path.join(first, 'icon.svg'), 'utf8'), ICON)
}))

test('an id cannot read another root, and a path-shaped id is refused as unknown', () => workspaceFixture(async ({ invoke, base }) => {
  const crossed = await invoke('GET', docUrl('ws-b'))
  assert.equal(crossed.status, 409)
  assert.equal(crossed.json.error, 'stale-revision', 'a missing file in that root is a refusal, never a fallback')
  assert.equal(crossed.json.document, undefined, 'no document may be returned by a refused read')

  for (const id of [path.join(base, 'projet-a'), '../projet-a', 'ws-a/../ws-b', 'ws-a%00']) {
    const attempt = await invoke('GET', docUrl(id))
    assert.equal(attempt.status, 400, 'path-shaped id must be refused: ' + JSON.stringify(id))
    assert.equal(attempt.json.error, 'unknown-workspace')
  }
  // An empty id is "no target given", not "the root of the world".
  const empty = await invoke('GET', docUrl(''))
  assert.equal(empty.status, 400)
  assert.equal(empty.json.error, 'no-session')
  // The unowned file next to the workspaces is never reachable by a relative climb.
  const climb = await invoke('GET', '/design-studio-native/document?workspaceId=ws-a&file=../hors-espace.svg')
  assert.equal(climb.status, 400)
  assert.equal(climb.json.error, 'invalid-path')
}))

test('a workspace whose directory disappeared is refused before any read', () => workspaceFixture(async ({ invoke }) => {
  const gone = await invoke('GET', docUrl('ws-gone'))
  assert.equal(gone.status, 409)
  assert.equal(gone.json.error, 'workspace-missing')
  const files = await invoke('GET', '/design-studio-native/files?workspaceId=ws-gone')
  assert.equal(files.status, 409)
  assert.equal(files.json.error, 'workspace-missing')
}))

test('workspace-scoped apply and create write real files and keep revision discipline', () => workspaceFixture(async ({ invoke, first }) => {
  const opened = await invoke('GET', docUrl('ws-a'))
  const base = opened.json.document
  const edited = await invoke('POST', '/design-studio-native/apply', {
    workspaceId: 'ws-a', file: 'icon.svg', baseHash: base.hash, baseIdentity: base.identity,
    kind: 'svg-attribute', id: 'box', attribute: 'fill', value: '#00ff00',
  })
  assert.equal(edited.status, 200)
  assert.ok((await readFile(path.join(first, 'icon.svg'), 'utf8')).includes('fill="#00ff00"'))

  const stale = await invoke('POST', '/design-studio-native/apply', {
    workspaceId: 'ws-a', file: 'icon.svg', baseHash: base.hash, baseIdentity: base.identity,
    kind: 'svg-attribute', id: 'box', attribute: 'fill', value: '#000000',
  })
  assert.equal(stale.status, 409)
  assert.equal(stale.json.error, 'stale-revision')

  const created = await invoke('POST', '/design-studio-native/create', {
    workspaceId: 'ws-a', file: 'page.css', source: 'body { margin: 0; }',
  })
  assert.equal(created.status, 201)
  assert.equal(created.json.created.format, 'css')
  assert.equal(await readFile(path.join(first, 'page.css'), 'utf8'), 'body { margin: 0; }')
  const duplicate = await invoke('POST', '/design-studio-native/create', {
    workspaceId: 'ws-a', file: 'page.css', source: 'body { margin: 1px; }',
  })
  assert.equal(duplicate.status, 409)
  assert.equal(duplicate.json.error, 'already-exists')
}))

test('two targets at once are refused instead of silently preferring one', () => workspaceFixture(async ({ invoke }) => {
  const both = await invoke('GET', '/design-studio-native/files?sessionId=known&workspaceId=ws-a')
  assert.equal(both.status, 400)
  assert.equal(both.json.error, 'invalid-target')
  const bothBody = await invoke('POST', '/design-studio-native/create', {
    sessionId: 'known', workspaceId: 'ws-a', file: 'x.svg', source: ICON,
  })
  assert.equal(bothBody.status, 400)
  assert.equal(bothBody.json.error, 'invalid-target')
}))

test('the session target keeps working exactly as before', () => workspaceFixture(async ({ invoke }) => {
  const viaSession = await invoke('GET', '/design-studio-native/files?sessionId=known')
  assert.equal(viaSession.status, 200)
  assert.deepEqual(viaSession.json.files.map((item) => item.path).sort(), ['icon.svg', 'styles.css'])
  const viaSessionDoc = await invoke('GET', '/design-studio-native/document?sessionId=known&file=icon.svg')
  assert.equal(viaSessionDoc.status, 200)
  assert.equal(viaSessionDoc.json.nodes[0].id, 'box')
  const unknownSession = await invoke('GET', '/design-studio-native/files?sessionId=inconnue')
  assert.equal(unknownSession.status, 400)
  assert.equal(unknownSession.json.error, 'no-session')
}))

test('without a workspace registry the panel routes degrade honestly', () => workspaceFixture(async ({ invoke, first }) => {
  const listing = await invoke('GET', '/design-studio-native/workspaces')
  assert.equal(listing.status, 200)
  assert.deepEqual(listing.json, { ok: true, workspaces: [], available: false })
  const scoped = await invoke('GET', '/design-studio-native/files?workspaceId=ws-a')
  assert.equal(scoped.status, 503)
  assert.equal(scoped.json.error, 'workspace-unavailable')
  // The session path still works: a missing optional service must not break it.
  const session = await invoke('GET', '/design-studio-native/files?sessionId=known')
  assert.equal(session.status, 200)
  assert.deepEqual((await readdir(first)).sort(), ['icon.svg', 'styles.css'])
}, { registry: false }))

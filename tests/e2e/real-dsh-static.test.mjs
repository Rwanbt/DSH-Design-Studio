/** Level 1 only: source contracts and fake child lifecycle. Never launches DSH/browser/server. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { stopServer } from './real-dsh-lifecycle.mjs'
import { sessionWorkspaceFromRegistry, isExpectedConflictConsole } from './real-dsh-web.mjs'

class FakeChild extends EventEmitter {
  exitCode = null
  signalCode = null
  signals = []
  kill(signal) { this.signals.push(signal); return true }
}

test('unit lifecycle: waits for close, not just exitCode, before resolving', async () => {
  const child = new FakeChild()
  let resolved = false
  const stopped = stopServer(child, { timeout: 100 }).then(() => { resolved = true })
  assert.deepEqual(child.signals, ['SIGTERM'])
  child.exitCode = 0
  child.emit('exit', 0)
  await Promise.resolve()
  assert.equal(resolved, false)
  child.emit('close', 0)
  await stopped
  assert.equal(resolved, true)
  assert.equal(child.listenerCount('close'), 0)
})

test('unit lifecycle: escalates to SIGKILL but still requires close', async () => {
  const child = new FakeChild()
  const originalKill = child.kill.bind(child)
  child.kill = signal => {
    originalKill(signal)
    if (signal === 'SIGKILL') queueMicrotask(() => child.emit('close', null, signal))
    return true
  }
  await stopServer(child, { timeout: 10 })
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL'])
})

test('unit lifecycle: missing close rejects honestly and releases listener', async () => {
  const child = new FakeChild()
  await assert.rejects(stopServer(child, { timeout: 10 }), /close not observed.*directory retained/)
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL'])
  assert.equal(child.listenerCount('close'), 0)
})

test('unit lifecycle: already observed close and absent process need no signal', async () => {
  const child = new FakeChild()
  child.dshE2eClosed = true
  await stopServer(child)
  await stopServer(null)
  assert.deepEqual(child.signals, [])
})

test('unit session workspace: actual persisted membership wins over first/default/sidebar workspace', () => {
  const registry = { tables: { workspaces: {
    default: { path: '/owned/default', sessionIds: [] },
    empty: { path: '/owned/empty', sessionIds: ['real-session'] },
  } } }
  assert.deepEqual(sessionWorkspaceFromRegistry(registry, 'real-session', ['/owned/default', '/owned/empty']),
    { id: 'empty', path: '/owned/empty' })
  assert.equal(sessionWorkspaceFromRegistry(registry, 'not-yet-attached', ['/owned/default', '/owned/empty']), null)
})

test('unit session workspace: ambiguous or unowned registry membership refuses fixture writes', () => {
  const record = { path: '/personal', sessionIds: ['session'] }
  assert.throws(() => sessionWorkspaceFromRegistry({ tables: { workspaces: { one: record } } },
    'session', ['/owned']), /outside the disposable/)
  assert.throws(() => sessionWorkspaceFromRegistry({ tables: { workspaces: { one: record, two: record } } },
    'session', ['/owned']), /multiple workspace/)
})

test('unit conflict diagnostic classifier: exact action window, unique request, URL and network409 only', () => {
  const diagnostic = { text: 'Failed to load resource: the server responded with a status of 409 (Conflict)',
    url: 'http://127.0.0.1:1234/design-studio-native/apply' }
  const evidence = { active: true, requestCount: 1, url: diagnostic.url }
  assert.equal(isExpectedConflictConsole(diagnostic, evidence), true)
  assert.equal(isExpectedConflictConsole(diagnostic, { ...evidence, active: false }), false)
  assert.equal(isExpectedConflictConsole(diagnostic, { ...evidence, requestCount: 2 }), false)
  assert.equal(isExpectedConflictConsole(diagnostic, { ...evidence, requestCount: 0 }), false)
  assert.equal(isExpectedConflictConsole({ ...diagnostic, url: diagnostic.url + '/other' }, evidence), false)
  assert.equal(isExpectedConflictConsole({ ...diagnostic, text: 'Uncaught Error: 409 stale-revision' }, evidence), false)
  assert.equal(isExpectedConflictConsole({ ...diagnostic, text: diagnostic.text.replace('409', '500') }, evidence), false)
})

test('static HTML/CSS workflow contract only: creation, byte checks, Undo, measured widths and external refusal', async () => {
  const source = await readFile(new URL('./real-dsh-web.mjs', import.meta.url), 'utf8')
  const client = await readFile(new URL('../../client.js', import.meta.url), 'utf8')
  for (const name of ['New design file name', 'HTML element text', 'Apply HTML element text',
    'HTML viewport ', 'CSS rule property', 'CSS rule value', 'Apply CSS rule style', 'Select CSS rule ']) {
    assert.ok(source.includes(name), `workflow references ${name}`)
    assert.ok(client.includes(name), `client declares ${name}`)
  }
  assert.match(source, /createNativeFile\('html', createdHtml\)/)
  assert.match(source, /createNativeFile\('css', css\)/)
  assert.match(source, /expectDisk\(editedHtml, 'g0-manual.html'\)/)
  assert.match(source, /expectDisk\(createdHtml, 'g0-manual.html'\)/)
  assert.match(source, /expectDisk\(editedCss, 'g0-manual.css'\)/)
  assert.match(source, /expectDisk\(css, 'g0-manual.css'\)/)
  assert.match(source, /frame.getBoundingClientRect\(\).width - expected/)
  assert.match(source, /frame.contentWindow.innerWidth - expected/)
  assert.match(source, /response.status\(\) !== 409/)
  assert.match(source, /body\?\.error !== 'stale-revision'/)
  assert.match(source, /readFile\(path.join\(workspaceDir, 'g0-manual.css'\), 'utf8'\) !== external/)
  const runner = await readFile(new URL('./real-dsh.mjs', import.meta.url), 'utf8')
  assert.match(runner, /refusalEvidence.confirmed && refusalEvidence.requestCount === 1/)
  assert.match(runner, /refusalEvidence.consoleIndices.length === 1/)
  assert.match(runner, /!expectedIndices.includes\(index\)/)
  assert.match(runner, /record\('CSP\/account diagnostics not assessed by this gate', 'NOT_RUN'/)
  assert.match(runner, /CSP excluded=\$\{cspDiagnostics.length\}; account excluded=\$\{environmentNoise.length\}/)
  assert.match(runner, /no non-excluded errors observed during this run/)
  assert.doesNotMatch(runner, /all other errors remain subject|none from the plugin; environment-only/)
})

test('static runner contract: initialization protected, close before rm, summary after finally', async () => {
  const source = await readFile(new URL('./real-dsh.mjs', import.meta.url), 'utf8')
  assert.match(source, /try \{\s+const \{ cliEnv/)
  assert.ok(source.indexOf('await stopServer(server)') < source.indexOf('await rm(root'))
  assert.match(source, /if \(!keep && serverClosed\)/)
  assert.match(source, /record\('cleanup disposable environment', 'FAIL'/)
  assert.match(source, /main\(\)\.then\(finish\)/)
  assert.doesNotMatch(source, /return finish\(\)/)
  assert.match(source, /if \(credentialCopy && modelProvider && modelName\)/)
  assert.ok(source.indexOf('await checkSidebar(') < source.indexOf('const newSession'))
  assert.match(source, /sessionWorkspaceFromRegistry\(registry, sessionId, \[workspaceDir, otherWorkspaceDir\]\)/)
  assert.match(source, /const workspace = sessionWorkspace.path/)
  assert.match(source, /filesBody.files.some\(file => file.path === 'g0-art.svg'\)/)
})

test('static sidebar contract: actual accessible controls, exact disk save/Undo/reopen, scoped theme evidence', async () => {
  const source = await readFile(new URL('./real-dsh-web.mjs', import.meta.url), 'utf8')
  const client = await readFile(new URL('../../client.js', import.meta.url), 'utf8')
  for (const name of ['Design Studio', 'Workspace', 'Canvas viewport', 'Select layer ', 'Geometry ', 'Undo saved edit', 'Redo saved edit']) {
    assert.ok(source.includes(name), `runner uses ${name}`)
    assert.ok(client.includes(name), `client declares ${name}`)
  }
  assert.match(source, /expectDisk\(changed\)/)
  assert.match(source, /expectDisk\(document\)/)
  assert.match(source, /selectOption\(otherWorkspaceId\)/)
  assert.match(source, /reopenedX !== '25'/)
  assert.match(source, /rgb\(32, 33, 37\)/)
  assert.match(source, /JSON.stringify\(hostBefore\) === JSON.stringify\(theme.hostAfter\)/)
  assert.match(source, /theme.light.host.probe.background === 'rgb\(250, 250, 248\)'/)
  assert.match(source, /const themeOwner = document.body/)
  assert.match(source, /finally \{[\s\S]*themeOwner.style.removeProperty/)
  assert.doesNotMatch(source, /context.request|selectPanel|keyboard.type|credentials.yaml/)
  assert.equal((source.match(/await writeFile\(/g) || []).length, 1, 'only deliberate external-writer injection writes directly')
  assert.match(source, /await writeFile\(path.join\(workspaceDir, 'g0-manual.css'\), external, 'utf8'\)/)
})

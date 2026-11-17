import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const root = new URL('..', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const require = createRequire(new URL('package.json', root))

test('the client entry is resolvable by the path DSH actually requests', async () => {
  // A real DeepSeek Harness installation loads plugin clients through
  // `<package>/client.js`. An exports map that only exposes `./client` makes the
  // resolver throw ERR_PACKAGE_PATH_NOT_EXPORTED, and the bundle is silently
  // dropped: the view never appears and no error is logged.
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.exports['./client.js'], './client.js')
  assert.equal(require.resolve('@rwanbt/dsh-design-studio/client.js'),
    path.resolve(new URL('client.js', root).pathname))
  assert.equal(require.resolve('@rwanbt/dsh-design-studio/client'),
    path.resolve(new URL('client.js', root).pathname))
  const info = await stat(new URL('client.js', root))
  assert.ok(info.size > 0, 'the client bundle must exist')
})

test('the client manifest declares only integration points that exist', async () => {
  const client = manifest.dsh?.client
  assert.equal(client.platform, 'web')
  assert.equal(client.immediately, true)
  // `slots` is a client service name. Scoped package names would have to be
  // present in every profile that installs this plugin, so they must not be
  // invented: a wrong one silently disables the whole bundle.
  assert.deepEqual(client.inject, ['slots'])
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(manifest.main, './src/plugin-host.mjs')
})

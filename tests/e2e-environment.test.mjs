import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { disposableEnvironment } from './e2e/environment.mjs'

const root = path.resolve('disposable-e2e-root')

test('disposable environment redirects homes, XDG, package caches and temporary files', () => {
  const inherited = Object.freeze({
    HOME: '/caller/home', DSH_HOME: '/caller/dsh', XDG_CONFIG_HOME: '/caller/config',
    XDG_DATA_HOME: '/caller/data', XDG_CACHE_HOME: '/caller/cache', XDG_STATE_HOME: '/caller/state',
    TMPDIR: '/caller/tmp', TEMP: '/caller/temp', TMP: '/caller/tmp2',
    npm_config_cache: '/caller/npm-cache', npm_config_userconfig: '/caller/npmrc',
    npm_config_store_dir: '/caller/pnpm-store', yarn_cache_folder: '/caller/yarn',
  })
  const { cliEnv, browserEnv, directories } = disposableEnvironment(root, inherited)
  for (const name of ['HOME', 'DSH_HOME', 'DSH_AGENTS_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
    'XDG_STATE_HOME', 'TMPDIR', 'TMP', 'TEMP', 'NPM_CONFIG_CACHE', 'NPM_CONFIG_PREFIX',
    'NPM_CONFIG_STORE_DIR', 'PNPM_HOME', 'PNPM_STORE_DIR', 'YARN_CACHE_FOLDER', 'YARN_GLOBAL_FOLDER',
    'COREPACK_HOME', 'BUN_INSTALL_CACHE_DIR', 'NPM_CONFIG_USERCONFIG', 'NPM_CONFIG_GLOBALCONFIG']) {
    assert.ok(path.relative(root, cliEnv[name]) && !path.relative(root, cliEnv[name]).startsWith('..'), name)
    assert.equal(browserEnv[name], cliEnv[name], name)
  }
  for (const name of ['npm_config_cache', 'npm_config_userconfig', 'npm_config_store_dir', 'yarn_cache_folder']) {
    assert.equal(Object.hasOwn(cliEnv, name), false, name)
  }
  assert.equal(new Set(directories).size, directories.length)
  assert.ok(directories.includes(cliEnv.TMPDIR))
  assert.ok(directories.includes(path.dirname(cliEnv.NPM_CONFIG_USERCONFIG)))
  assert.equal(inherited.HOME, '/caller/home')
})

test('agent home override is redirected regardless of inherited casing', () => {
  for (const name of ['DSH_AGENTS_HOME', 'dsh_agents_home', 'Dsh_Agents_Home']) {
    const inherited = Object.freeze({ [name]: '/caller/agents' })
    const { cliEnv, browserEnv, directories } = disposableEnvironment(root, inherited)
    assert.equal(cliEnv.DSH_AGENTS_HOME, path.join(root, 'agents'))
    assert.equal(browserEnv.DSH_AGENTS_HOME, path.join(root, 'agents'))
    if (name !== 'DSH_AGENTS_HOME') {
      assert.equal(Object.hasOwn(cliEnv, name), false, name)
      assert.equal(Object.hasOwn(browserEnv, name), false, name)
    }
    assert.ok(directories.includes(path.join(root, 'agents')))
    assert.equal(inherited[name], '/caller/agents')
  }
})

test('credentials and profile overrides are removed without changing the input', () => {
  const names = ['DSH_PROFILE_DIR', 'dsh_profile_dir', 'OPENAI_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
    'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'GOOGLE_APPLICATION_CREDENTIALS',
    'AZURE_CLIENT_SECRET', 'AZURE_CLIENT_CERTIFICATE_PATH', 'GH_TOKEN', 'GITHUB_TOKEN', 'NPM_TOKEN',
    'npm_config__auth', 'npm_config__authToken', 'SSH_AUTH_SOCK', 'DB_PASSWORD', 'service_apiKey',
    'COHERE_KEY', 'SSH_PASSPHRASE']
  const inherited = Object.freeze(Object.fromEntries(names.map((name) => [name, 'synthetic-sensitive-value'])))
  const { cliEnv, browserEnv } = disposableEnvironment(root, inherited)
  for (const name of names) {
    assert.equal(Object.hasOwn(cliEnv, name), false, name)
    assert.equal(Object.hasOwn(browserEnv, name), false, name)
  }
  assert.equal(JSON.stringify(cliEnv).includes('synthetic-sensitive-value'), false)
  assert.equal(Object.keys(inherited).length, names.length)
})

test('credential-bearing URLs are not inherited, ordinary network configuration remains', () => {
  const { cliEnv } = disposableEnvironment(root, {
    HTTPS_PROXY: 'https://user:synthetic@proxy.invalid',
    npm_config_registry: 'https://user:synthetic@registry.invalid',
    HTTP_PROXY: 'http://proxy.invalid:8080', NO_PROXY: 'localhost,127.0.0.1',
  })
  assert.equal(Object.hasOwn(cliEnv, 'HTTPS_PROXY'), false)
  assert.equal(Object.hasOwn(cliEnv, 'npm_config_registry'), false)
  assert.equal(cliEnv.HTTP_PROXY, 'http://proxy.invalid:8080')
  assert.equal(cliEnv.NO_PROXY, 'localhost,127.0.0.1')
})

test('dependency resolution and existing runtime flags survive; Chromium is not run as Node', () => {
  const preserved = {
    PATH: '/installed/node/bin:/usr/bin', NODE_PATH: '/installed/modules',
    LD_LIBRARY_PATH: '/installed/libs',
    PLAYWRIGHT_BROWSERS_PATH: '/installed/browsers', DSH_E2E_PLAYWRIGHT: '/installed/playwright',
    LANG: 'fr_FR.UTF-8', DISPLAY: ':99',
  }
  const { cliEnv, browserEnv } = disposableEnvironment(root, {
    ...preserved, ELECTRON_RUN_AS_NODE: 'inherited', electron_run_as_node: 'inherited',
    NODE_OPTIONS: '--require=/caller/preload.cjs', node_options: '--import=/caller/preload.mjs',
  })
  for (const [name, value] of Object.entries(preserved)) {
    assert.equal(cliEnv[name], value, name)
    assert.equal(browserEnv[name], value, name)
  }
  for (const name of ['NODE_OPTIONS', 'node_options']) {
    assert.equal(Object.hasOwn(cliEnv, name), false, name)
    assert.equal(Object.hasOwn(browserEnv, name), false, name)
  }
  assert.equal(cliEnv.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(cliEnv.NO_AT_BRIDGE, '1')
  assert.equal(Object.hasOwn(browserEnv, 'ELECTRON_RUN_AS_NODE'), false)
  assert.equal(Object.hasOwn(browserEnv, 'electron_run_as_node'), false)
  browserEnv.HOME = 'changed'
  assert.equal(cliEnv.HOME, path.join(root, 'home'))
})

test('real runner supplies isolated environments without launching a process in this test', async () => {
  const source = await readFile(new URL('./e2e/real-dsh.mjs', import.meta.url), 'utf8')
  assert.match(source, /disposableEnvironment\(root, process\.env\)/)
  assert.match(source, /for \(const directory of directories\) await mkdir\(directory, \{ recursive: true \}\)/)
  assert.match(source, /chromium\.launch\(\{ headless: true, env: browserEnv,/)
  assert.match(source, /args: \['--disable-dev-shm-usage', '--no-sandbox'\]/)
  assert.match(source, /spawn\(nodeBin, \['--expose-internals', cli, \.\.\.cliArgs\], \{ env: childEnv \}\)/)
  assert.match(source, /spawn\(nodeBin, bootArgs, \{ env: childEnv \}\)/)
})

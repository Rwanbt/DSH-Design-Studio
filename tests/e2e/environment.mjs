import path from 'node:path'

/** Environment hygiene, not an OS sandbox: PATH/NODE_PATH and installed dependencies
 * remain accessible. NODE_OPTIONS is not needed by this harness and may preload code;
 * the required --expose-internals flag is supplied explicitly by the CLI caller.
 */
export function disposableEnvironment(root, inherited) {
  const env = Object.fromEntries(Object.entries(inherited).filter(([name, value]) => {
    if (/TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CERTIFICATE|AUTH|(?:^|_)KEY(?:_|$)/i.test(name) ||
      /^(DSH_PROFILE_DIR|ELECTRON_RUN_AS_NODE|NODE_OPTIONS)$/i.test(name)) return false
    // Proxy/registry URLs can carry credentials despite an innocuous variable name.
    try {
      const url = new URL(value)
      if (url.username || url.password) return false
    } catch { /* ordinary non-URL environment value */ }
    return true
  }))
  const directories = {
    HOME: 'home', DSH_HOME: 'dsh-home', DSH_AGENTS_HOME: 'agents',
    XDG_CONFIG_HOME: 'config', XDG_DATA_HOME: 'data',
    XDG_CACHE_HOME: 'cache', XDG_STATE_HOME: 'state',
    TMPDIR: 'tmp', TMP: 'tmp', TEMP: 'tmp',
    NPM_CONFIG_CACHE: 'cache/npm', NPM_CONFIG_PREFIX: 'data/npm',
    YARN_CACHE_FOLDER: 'cache/yarn', YARN_GLOBAL_FOLDER: 'data/yarn',
    PNPM_HOME: 'data/pnpm', PNPM_STORE_DIR: 'cache/pnpm', NPM_CONFIG_STORE_DIR: 'cache/pnpm',
    COREPACK_HOME: 'cache/corepack', BUN_INSTALL_CACHE_DIR: 'cache/bun',
  }
  // Remove case variants too: npm accepts lowercase config variables and Windows
  // environment names are case-insensitive. Never reuse the caller's npmrc.
  const files = { NPM_CONFIG_USERCONFIG: 'config/npmrc', NPM_CONFIG_GLOBALCONFIG: 'config/npmrc-global' }
  const overridden = new Set([...Object.keys(directories), ...Object.keys(files)])
  for (const name of Object.keys(env)) {
    if (overridden.has(name.toUpperCase())) delete env[name]
  }
  for (const [name, relative] of Object.entries({ ...directories, ...files })) env[name] = path.join(root, relative)
  env.NO_AT_BRIDGE = '1'
  return {
    cliEnv: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    browserEnv: { ...env },
    directories: [...new Set(Object.values(directories).map((relative) => path.join(root, relative)))],
  }
}

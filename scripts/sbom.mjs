/**
 * Emit a minimal, honest SBOM for this plugin.
 *
 * The runtime dependency set is empty by design: the plugin imports only Node
 * built-ins and receives React from the DeepSeek Harness host. The SBOM therefore
 * records the package itself, its (empty) runtime dependencies, and the
 * test-only devDependencies with their licences.
 *
 * Usage: node scripts/sbom.mjs [--out docs/operations/SBOM.json]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const outFile = outIndex >= 0 ? path.resolve(args[outIndex + 1]) : path.join(repo, 'docs/operations/SBOM.json')

const manifest = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'))
let commit = 'unknown'
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim() } catch { /* not a git checkout */ }

const DEV_LICENSES = {
  playwright: 'Apache-2.0',
  react: 'MIT',
  'react-dom': 'MIT',
}

const components = [
  {
    type: 'application',
    name: manifest.name,
    version: manifest.version,
    license: manifest.license,
    scope: 'runtime',
    description: manifest.description,
  },
  ...Object.entries(manifest.devDependencies ?? {}).map(([name, version]) => ({
    type: 'library',
    name,
    version,
    license: DEV_LICENSES[name] ?? 'UNKNOWN',
    scope: 'test-only',
    note: 'Declared for the real-browser gate; never imported by src/ or client.js and not required to run the editor.',
  })),
]

const runtimeDependencies = Object.keys(manifest.dependencies ?? {})
if (runtimeDependencies.length > 0) {
  throw new Error('This plugin is expected to have zero runtime dependencies, found: ' + runtimeDependencies.join(', '))
}

const sbom = {
  bomFormat: 'CycloneDX-like (documented subset)',
  specNote: 'Minimal SBOM: full package graph resolution is unnecessary because the runtime dependency set is empty and verified below.',
  metadata: {
    subject: manifest.name,
    version: manifest.version,
    commit,
    generatedAt: new Date().toISOString(),
    generator: 'scripts/sbom.mjs',
    runtimeDependencyCount: runtimeDependencies.length,
  },
  components,
}

await mkdir(path.dirname(outFile), { recursive: true })
await writeFile(outFile, JSON.stringify(sbom, null, 2) + '\n')
console.log(`SBOM written to ${outFile} (${components.length} components, ${runtimeDependencies.length} runtime dependencies)`)

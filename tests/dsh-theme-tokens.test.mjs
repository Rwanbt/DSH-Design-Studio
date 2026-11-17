/**
 * DSH theme integration.
 *
 * The workbench is an INTERNAL DSH plugin: it must inherit the host's semantic
 * theme tokens instead of pinning its own colours, otherwise it ignores DSH's
 * light/dark themes. This test fails if the client references a token name that
 * does not exist in the installed DSH theme package, which is exactly how the
 * alpha build silently stopped following the host theme.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const clientUrl = new URL('../client.js', import.meta.url)
const client = await readFile(clientUrl, 'utf8')

// Verified against @deepseek-ai/dsh-client-ui-theme (450 tokens) on DSH 0.2.2-rc.3.
const KNOWN_DSH_TOKENS = new Set([
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-bg-module-platform',
  '--dsw-alias-bg-document-preview',
  '--dsw-alias-bg-document-selection',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-border-l3',
  '--dsw-alias-border-l4',
  '--dsw-alias-border-selected',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-label-caption',
  '--dsw-alias-label-dimmed',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-idle-primary',
  '--dsw-alias-brand-primary',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-settings-card-fill',
  '--dsw-alias-settings-card-stroke',
  '--dsw-font-family',
  '--dsw-font-family-brand',
  '--dsw-radius-xs',
  '--dsw-radius-sm',
  '--dsw-radius-md',
  '--dsw-radius-lg',
  '--dsw-radius-xl',
  '--dsw-radius-panel',
  '--dsw-specific-sidebar-fill',
])

test('every DSH token referenced by the client exists in the host theme', () => {
  const used = [...new Set(client.match(/--dsw-[a-z0-9-]+/g) ?? [])]
  assert.ok(used.length > 0, 'the client must reference DSH theme tokens')
  const unknown = used.filter((token) => !KNOWN_DSH_TOKENS.has(token))
  assert.deepEqual(unknown, [],
    'unknown DSH tokens silently fall back to the hardcoded value and break theming')
})

test('the plugin retains valid host tokens beside its scoped Graphite palette', () => {
  for (const family of ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2']) {
    assert.ok(client.includes(family), `missing surface token ${family}`)
  }
  for (const family of ['--dsw-alias-border-l1', '--dsw-alias-border-l2']) {
    assert.ok(client.includes(family), `missing border token ${family}`)
  }
  for (const family of ['--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary']) {
    assert.ok(client.includes(family), `missing text token ${family}`)
  }
  for (const family of ['--dsw-alias-state-error-primary', '--dsw-alias-state-warn-primary']) {
    assert.ok(client.includes(family), `missing state token ${family}`)
  }
  // Host-facing wrapper retains DSH typography; the exact editor font is local (ADR-026).
  assert.match(client, /--dsw-font-family/, 'the workbench must inherit the DSH font family')
  assert.match(client, /\.dsh-studio-workbench\{--dsw-alias-bg-base:/, 'Graphite aliases must be scoped to the workbench, never the document root')
})

test('every token use keeps a fallback so the plugin renders without the host theme', () => {
  const uses = client.match(/var\(--dsw-[a-z0-9-]+[^)]*\)/g) ?? []
  assert.ok(uses.length > 0, 'expected var() uses')
  const withoutFallback = uses.filter((use) => !use.includes(','))
  assert.deepEqual(withoutFallback, [], 'each token must carry a fallback value')
})

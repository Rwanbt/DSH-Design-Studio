/**
 * ADR-026: the explicitly requested Graphite palette is local to the editor.
 * The surrounding DSH UI keeps its own light/dark tokens. Verify both directions:
 * host theme changes cannot whiten the editor; editor styles cannot recolour DSH.
 */
import { SVG_DOCUMENT, openWorkspaceFile } from './helpers.mjs'

const DARK = {
  '--dsw-alias-bg-base': 'rgb(20, 22, 25)',
  '--dsw-alias-bg-layer-1': 'rgb(26, 29, 34)',
  '--dsw-alias-bg-layer-2': 'rgb(32, 36, 41)',
  '--dsw-alias-border-l1': 'rgb(50, 54, 60)',
  '--dsw-alias-border-l2': 'rgb(70, 74, 80)',
  '--dsw-alias-label-primary': 'rgb(240, 240, 240)',
  '--dsw-alias-label-secondary': 'rgb(180, 182, 185)',
}
const LIGHT = {
  '--dsw-alias-bg-base': 'rgb(250, 250, 248)',
  '--dsw-alias-bg-layer-1': 'rgb(255, 255, 255)',
  '--dsw-alias-bg-layer-2': 'rgb(244, 244, 241)',
  '--dsw-alias-border-l1': 'rgb(214, 214, 210)',
  '--dsw-alias-border-l2': 'rgb(196, 196, 192)',
  '--dsw-alias-label-primary': 'rgb(24, 24, 26)',
  '--dsw-alias-label-secondary': 'rgb(90, 90, 96)',
}

async function readTheme(page, tokens) {
  return page.evaluate(values => {
    for (const [name, value] of Object.entries(values)) document.documentElement.style.setProperty(name, value)
    let probe = document.querySelector('[data-dsh-theme-probe]')
    if (!probe) {
      probe = document.createElement('div')
      probe.dataset.dshThemeProbe = ''
      probe.style.cssText = 'position:fixed;left:-100px;width:10px;height:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)'
      document.body.appendChild(probe)
    }
    const nodeStyle = selector => {
      const node = document.querySelector(selector)
      if (!node) return null
      const style = getComputedStyle(node)
      return { background: style.backgroundColor, color: style.color, border: style.borderRightColor }
    }
    return {
      host: nodeStyle('[data-dsh-theme-probe]'),
      sidebar: nodeStyle('.dsh-studio-sidebar'),
      inspector: nodeStyle('.dsh-studio-inspector'),
      toolbar: nodeStyle('.dsh-studio-toolbar'),
      canvas: nodeStyle('.dsh-studio-canvas'),
      hostTokens: Object.fromEntries(Object.keys(values).map(name => [name,
        getComputedStyle(document.documentElement).getPropertyValue(name).trim()])),
    }
  }, tokens)
}

export const dshThemeSpec = {
  name: 'dsh: exact Graphite palette stays scoped while the surrounding host changes light and dark themes',
  async run({ page, harness, assert }) {
    await harness.write('theme.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'theme.svg', { expect: 'svg' })
    const dark = await readTheme(page, DARK)
    const light = await readTheme(page, LIGHT)
    assert.equal(dark.host.background, DARK['--dsw-alias-bg-layer-1'], 'the host uses its actual dark token')
    assert.equal(light.host.background, LIGHT['--dsw-alias-bg-layer-1'], 'the host uses its actual light token')
    assert.equal(light.host.color, LIGHT['--dsw-alias-label-primary'], 'the editor does not override host text colour')
    for (const region of ['sidebar', 'inspector', 'toolbar', 'canvas']) {
      assert.ok(dark[region] && light[region], `${region} exists in the integrated shell`)
      assert.deepEqual(light[region], dark[region], `${region} must retain the requested Graphite appearance`)
    }
    assert.equal(light.sidebar.background, 'rgb(36, 37, 40)', 'sidebar uses the final reference --panel, not host white')
    assert.equal(light.inspector.background, 'rgb(36, 37, 40)', 'inspector uses the same reference panel')
    assert.deepEqual(light.hostTokens, LIGHT, 'no Graphite rule may rewrite tokens on the document root')
    assert.equal(await harness.read('theme.svg'), SVG_DOCUMENT, 'changing editor/host appearance never edits the design')
  },
}

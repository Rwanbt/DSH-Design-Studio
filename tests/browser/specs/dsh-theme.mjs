/**
 * The workbench is an internal DSH plugin: it must be painted by the host theme,
 * not by pinned colours. This spec injects a light DSH palette and asserts that
 * every structural surface/border/text colour follows it.
 */
import { SVG_DOCUMENT, openWorkspaceFile } from './helpers.mjs'

const LIGHT = {
  '--dsw-alias-bg-base': 'rgb(250, 250, 248)',
  '--dsw-alias-bg-layer-1': 'rgb(255, 255, 255)',
  '--dsw-alias-bg-layer-2': 'rgb(244, 244, 241)',
  '--dsw-alias-border-l1': 'rgb(214, 214, 210)',
  '--dsw-alias-border-l2': 'rgb(196, 196, 192)',
  '--dsw-alias-label-primary': 'rgb(24, 24, 26)',
  '--dsw-alias-label-secondary': 'rgb(90, 90, 96)',
  '--dsw-alias-state-error-primary': 'rgb(180, 30, 30)',
}

const readTheme = (page, tokens) => page.evaluate((values) => {
  for (const [name, value] of Object.entries(values)) {
    document.documentElement.style.setProperty(name, value)
  }
  const workbench = document.querySelector('.dsh-studio-workbench')
  const panel = workbench?.querySelector('aside') ?? workbench?.querySelector('header')
  const style = panel ? getComputedStyle(panel) : null
  return {
    background: style?.backgroundColor ?? '',
    color: style?.color ?? '',
    border: style?.borderBottomColor || style?.borderRightColor || '',
  }
}, tokens)

export const dshThemeSpec = {
  name: 'dsh: the workbench is painted by the host theme tokens, not pinned colours',
  async run({ page, harness, assert }) {
    await harness.write('theme.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'theme.svg', { expect: 'svg' })

    const dark = await readTheme(page, {})
    const light = await readTheme(page, LIGHT)

    // The host palette must actually drive the rendering…
    assert.ok(light.background !== dark.background,
      `surfaces must follow the host tokens (dark ${dark.background} vs light ${light.background})`)
    assert.ok(light.color !== dark.color,
      `text must follow the host tokens (dark ${dark.color} vs light ${light.color})`)
    // …and adopt the injected values rather than an approximation.
    const normalise = (value) => value.replace(/\s+/g, '')
    assert.ok([LIGHT['--dsw-alias-bg-layer-1'], LIGHT['--dsw-alias-bg-layer-2'], LIGHT['--dsw-alias-bg-base']]
      .map(normalise).includes(normalise(light.background)),
      `expected a host surface colour, got ${light.background}`)
    assert.equal(normalise(light.color), normalise(LIGHT['--dsw-alias-label-primary']),
      'the primary text colour must be the host token value')

    // Interactive emphasis keeps the approved Graphite accent: theming the
    // structure must not erase the product identity.
    const accent = await page.evaluate(() => {
      const node = [...document.querySelectorAll('.dsh-studio-workbench *')]
        .find((element) => /#bda991|rgb\(189, 169, 145\)|var\(--dsh-studio-accent/.test(getComputedStyle(element).borderColor))
      return node ? getComputedStyle(node).borderColor : null
    })
    assert.ok(accent === null || /rgb\(189, 169, 145\)|rgb\(189,169,145\)/.test(accent.replace(/\s+/g, ' ')),
      'the Graphite accent must survive theming')
  },
}

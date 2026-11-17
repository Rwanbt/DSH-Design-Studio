/**
 * Compare the real plugin DOM to the supplied Graphite HTML, not hand-copied
 * numbers in a test. Equal workbench dimensions; authored document content and
 * unsupported prototype-only actions are intentionally not pixel-diffed.
 * This is tier 2 evidence, not proof of delivery in the running DSH Desktop.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { openWorkspaceFile } from './helpers.mjs'

const referenceUrl = new URL('../../../docs/design/DSH-Design-Studio-V3-Graphite-interactive.html', import.meta.url)
const evidenceDir = fileURLToPath(new URL('../__reports__/graphite/', import.meta.url))

async function measure(page, selectors) {
  return page.evaluate((entries) => Object.fromEntries(Object.entries(entries).map(([key, selector]) => {
    const node = document.querySelector(selector)
    if (!node) return [key, null]
    const rect = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    return [key, { width: rect.width, height: rect.height, background: style.backgroundColor,
      fontSize: style.fontSize, borderRadius: style.borderRadius, display: style.display }]
  })), selectors)
}

export const graphiteReferenceSpec = {
  name: 'graphite: shell geometry and icon artwork match the supplied HTML reference',
  viewport: { width: 1440, height: 960 },
  async run({ page, context, browser, harness, assert }) {
    const artwork = await readFile(new URL('../../../examples/graphite-v3.svg', import.meta.url), 'utf8')
    await harness.write('graphite.svg', artwork)
    await openWorkspaceFile(page, 'graphite.svg', { expect: 'svg' })
    await page.getByRole('button', { name: 'Select layer ellipse #orb' }).click()
    const root = page.locator('.dsh-studio-workbench')
    const bounds = await root.boundingBox()
    assert.ok(bounds && bounds.width > 1000, 'desktop comparison requires a full-width workbench')
    const reference = await context.newPage()
    try {
      await reference.setViewportSize({ width: Math.round(bounds.width), height: Math.round(bounds.height) })
      // Trusted, repository-owned reference. User documents still render in the
      // plugin's inert iframe and never take this path.
      await reference.setContent(await readFile(referenceUrl, 'utf8'), { waitUntil: 'load' })
      const expected = await measure(reference, { top: '.top', toolbar: '.toolbar', rail: '.rail',
        sidebar: '.side', inspector: '.inspector', footer: '.bottom-bar', stageHeader: '.stage-top' })
      const actual = await measure(page, { top: '.dsh-studio-top', toolbar: '.dsh-studio-toolbar',
        rail: '.dsh-studio-rail', sidebar: '.dsh-studio-sidebar', inspector: '.dsh-studio-inspector',
        footer: '.dsh-studio-footer', stageHeader: '.dsh-studio-stage-top' })
      for (const key of Object.keys(expected)) {
        assert.ok(actual[key] && expected[key], `${key}: both plugin and reference must render this region`)
        const dimension = ['rail', 'sidebar', 'inspector'].includes(key) ? 'width' : 'height'
        assert.ok(Math.abs(actual[key][dimension] - expected[key][dimension]) <= 1,
          `${key} ${dimension}: plugin ${actual[key][dimension]} vs supplied reference ${expected[key][dimension]}`)
        assert.equal(actual[key].background, expected[key].background,
          `${key}: preserve the exact reference surface shade, not one shared grey for every panel`)
      }
      assert.equal(await page.locator('.dsh-studio-rail button').count(),
        await reference.locator('.rail button').count(), 'the rail must contain the reference positions, not extra placeholder panels')
      // These are the actual path/rect/circle definitions from the supplied
      // file, not approximate Unicode glyphs that happen to occupy 33 pixels.
      const toolArtwork = (target, selector) => target.locator(selector).evaluateAll(nodes => nodes.map(node =>
        [...node.querySelectorAll('svg > *')].map(child => child.outerHTML.replace(/\s+/g, ' ').trim())))
      const expectedTools = await toolArtwork(reference, '.tools > .tool[data-tool]')
      const actualTools = await toolArtwork(page, '.dsh-studio-toolbar [data-tool]')
      assert.equal(actualTools.length, expectedTools.length, 'the reference tool strip must be integrated in full')
      for (let i = 0; i < expectedTools.length; i++) {
        // Attribute order is immaterial, so compare semantic SVG definitions.
        const canonical = list => list.map(markup => [...markup.matchAll(/([\w-]+)="([^"]*)"/g)]
          .map(match => [match[1].toLowerCase(), match[2]]).sort((a, b) => a[0].localeCompare(b[0])))
        assert.deepEqual(canonical(actualTools[i]), canonical(expectedTools[i]), `tool ${i}: SVG artwork differs from reference`)
      }
      const headings = await page.locator('.dsh-studio-inspector').innerText()
      for (const section of ['Transformation', 'Apparence', 'Remplissage', 'Contour', 'Effets']) {
        assert.ok(headings.includes(section), `the ${section} section must remain present, not replaced by a footnote`)
      }
      await mkdir(evidenceDir, { recursive: true })
      const engine = browser.browserType().name()
      await root.screenshot({ path: path.join(evidenceDir, `${engine}-plugin.png`) })
      await reference.locator('.app').screenshot({ path: path.join(evidenceDir, `${engine}-reference.png`) })
      await writeFile(path.join(evidenceDir, `${engine}-comparison.json`), JSON.stringify({
        reference: fileURLToPath(referenceUrl), expected, actual,
        limitations: 'Geometry and SVG artwork checks; not a whole-screen pixel equality claim; DSH shell simulated.'
      }, null, 2) + '\n')
    } finally { await reference.close() }
  },
}

export const graphiteWelcomeSpec = {
  name: 'graphite: an unopened document keeps the same editor shell instead of an admin page',
  async run({ page, assert }) {
    for (const selector of ['.dsh-studio-top', '.dsh-studio-toolbar', '.dsh-studio-rail',
      '.dsh-studio-sidebar', '.dsh-studio-canvas', '.dsh-studio-inspector', '.dsh-studio-footer']) {
      await page.locator(selector).first().waitFor({ state: 'visible', timeout: 15000 })
      assert.equal(await page.locator(selector).count(), 1, `${selector} must be present exactly once on first visit`)
    }
    const landing = page.getByRole('region', { name: 'Open a design file' })
    assert.ok(await landing.isVisible(), 'workspace files/create actions must stay available in the canvas')
    assert.equal(await page.getByRole('button', { name: 'Create SVG file' }).count(), 1)
    assert.equal(await page.getByLabel('New design file name').count(), 1)
  },
}

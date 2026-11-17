/**
 * Responsive behaviour and measurable performance budgets on real documents.
 */
import { SVG_DOCUMENT, openWorkspaceFile, waitForDisk } from './helpers.mjs'

export const responsiveSpec = {
  allowConsoleErrors: 'csp-only',
  name: 'responsive: 390/768/1280 px keep the editor usable and the preview width truthful',
  async run({ page, harness, assert }) {
    await harness.write('page.html', `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Responsive</title>
<link rel="stylesheet" href="r.css"></head>
<body><h1 id="headline">Responsive</h1><p id="lead">Body copy.</p></body></html>
`)
    await harness.write('r.css', 'h1 { color: #202124 }\n.lead { color: #555 }\n')
    await openWorkspaceFile(page, 'page.html', { expect: 'html' })

    const preview = page.locator('iframe[title="Isolated design preview"]')
    const results = {}
    for (const [label, width, expected] of [['desktop', 1280, 1280], ['tablet', 768, 768], ['mobile', 390, 390]]) {
      await page.setViewportSize({ width: width + 400, height: 900 })
      await page.getByRole('button', { name: 'HTML viewport ' + label }).click()
      await page.waitForTimeout(250)
      results[label] = await preview.evaluate((node) => node.getBoundingClientRect().width)
      assert.ok(Math.abs(results[label] - expected) <= 2,
        `${label} preview width must be ${expected}px, measured ${results[label]}`)
    }

    // The compact dock must not clip the inspector at 390 px.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(300)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    assert.ok(overflow <= 1, `the workbench must not overflow horizontally at 390 px (overflow ${overflow}px)`)
  },
}

export const performanceSpec = {
  name: 'performance: a 1500-node SVG opens and saves within a documented budget',
  async run({ page, harness, assert }) {
    const nodes = []
    for (let index = 0; index < 1500; index += 1) {
      nodes.push(`  <rect id="n${index}" x="${(index % 50) * 12}" y="${Math.floor(index / 50) * 12}" width="10" height="10" fill="#bda991"/>`)
    }
    const big = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">\n${nodes.join('\n')}\n</svg>\n`
    await harness.write('big.svg', big)
    const started = Date.now()
    await openWorkspaceFile(page, 'big.svg', { expect: 'svg' })
    await page.getByRole('button', { name: 'rect #n0' }).waitFor({ state: 'visible', timeout: 30000 })
    const openMs = Date.now() - started
    assert.ok(openMs < 15000, `opening 1500 nodes must stay under 15 s (measured ${openMs} ms)`)

    const dragStarted = Date.now()
    const handle = page.getByRole('button', { name: 'Drag rect n0' })
    const box = await handle.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 5 })
    await page.mouse.up()
    await waitForDisk(harness, 'big.svg', (content) => content !== big, { label: 'big save', timeout: 20000 })
    const saveMs = Date.now() - dragStarted
    assert.ok(saveMs < 8000, `a single save on 1500 nodes must stay under 8 s (measured ${saveMs} ms)`)

    const bytes = (await harness.read('big.svg')).length
    assert.ok(bytes > big.length - 200, 'the save must not shrink the document')
  },
}

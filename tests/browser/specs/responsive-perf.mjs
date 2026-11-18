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

/**
 * A larger document than the asserted budget, measured rather than assumed.
 *
 * 5 000 elements is beyond what the CI budget guards, so this spec does not
 * impose a tight ceiling: it proves the editor still opens, lists and saves such
 * a document, and records the measured times in its detail so a regression is
 * visible in the report instead of being discovered by a user.
 */
export const largeDocumentSpec = {
  name: 'performance: a 5000-node SVG still opens, lists and saves without a silent failure',
  async run({ page, harness, assert }) {
    const nodes = []
    for (let index = 0; index < 5000; index += 1) {
      nodes.push(`  <rect id="n${index}" x="${(index % 100) * 6}" y="${Math.floor(index / 100) * 6}" width="5" height="5" fill="#bda991"/>`)
    }
    const big = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320" viewBox="0 0 640 320">\n${nodes.join('\n')}\n</svg>\n`
    await harness.write('large.svg', big)

    const started = Date.now()
    await openWorkspaceFile(page, 'large.svg', { expect: 'svg' })
    await page.getByRole('button', { name: 'Select layer rect #n0' }).waitFor({ state: 'visible', timeout: 60000 })
    const openMs = Date.now() - started
    // Generous ceiling: this is a smoke test for scale, not a frame budget.
    assert.ok(openMs < 60000, `opening 5000 nodes must stay under 60 s (measured ${openMs} ms)`)

    // The layer list really holds every layer, not a truncated prefix.
    const listed = await page.evaluate(() =>
      document.querySelectorAll('[aria-label^="Select layer rect #n"]').length)
    assert.equal(listed, 5000, 'every layer must be listed, not silently truncated')

    // One edit still goes through the exact-patch path and stays reversible.
    const editStarted = Date.now()
    await page.getByRole('button', { name: 'Select layer rect #n0' }).click()
    await page.getByLabel('Geometry x').fill('7')
    await page.getByLabel('Geometry x').press('Enter')
    const edited = await waitForDisk(harness, 'large.svg',
      (text) => text.includes('id="n0" x="7"'), { label: 'large save', timeout: 30000 })
    const saveMs = Date.now() - editStarted
    assert.ok(saveMs < 30000, `a save on 5000 nodes must stay under 30 s (measured ${saveMs} ms)`)
    assert.ok(edited.length > big.length - 200, 'the save must not shrink the document')
    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    await waitForDisk(harness, 'large.svg', (text) => text === big, { label: 'large undo' })
    assert.equal(await harness.read('large.svg'), big, 'Undo restores the 5000-node file byte for byte')
  },
}

/**
 * Stroke editing.
 *
 * A shape without a stroke gains one as a single validated insertion, and every
 * control writes exactly one attribute through the same transaction as the rest
 * of the inspector. These specs read the real bytes and count real Host calls,
 * so "one action, one write, one Undo" is measured rather than assumed.
 */
import { SVG_DOCUMENT, openWorkspaceFile, waitForDisk } from './helpers.mjs'

const PLAIN = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
  <rect id="box" x="20" y="20" width="80" height="60" fill="#bda991"/>
</svg>
`

export const strokeCreateSpec = {
  name: 'stroke: colour, width, cap, join and dashes each write one attribute and undo exactly',
  async run({ page, harness, assert }) {
    let applies = 0
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/design-studio-native/apply')) applies += 1
    })
    await harness.write('trait.svg', PLAIN)
    await openWorkspaceFile(page, 'trait.svg', { expect: 'svg' })
    await page.getByRole('button', { name: 'Select layer rect #box' }).click()
    await page.getByLabel('Stroke colour').waitFor({ state: 'visible', timeout: 15000 })

    // No stroke yet: the panel is real, not a decorative placeholder.
    assert.equal(await page.locator('[data-stroke-panel]').count(), 1)
    assert.equal(await page.getByLabel('Stroke colour').isDisabled(), false,
      'the stroke colour control must be usable on a shape without stroke')

    const beforeStroke = applies
    await page.getByLabel('Stroke colour').fill('#ff0000')
    const withStroke = await waitForDisk(harness, 'trait.svg', (text) => text.includes('stroke="#ff0000"'))
    assert.equal(applies, beforeStroke + 1, 'one colour action is exactly one Host write')
    assert.ok(withStroke.includes('<rect id="box" x="20" y="20" width="80" height="60" fill="#bda991" stroke="#ff0000"/>'),
      'the stroke is inserted before the closing bracket, every other byte is untouched')

    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    await waitForDisk(harness, 'trait.svg', (text) => text === PLAIN)
    assert.equal(await harness.read('trait.svg'), PLAIN, 'Undo removes exactly the inserted declaration')

    // Existing declaration replaced in place, one attribute at a time.
    await page.getByLabel('Stroke width').fill('3')
    await page.getByLabel('Stroke width').press('Enter')
    const withWidth = await waitForDisk(harness, 'trait.svg', (text) => text.includes('stroke-width="3"'))
    assert.ok(!withWidth.includes('stroke-width="3" stroke-width'), 'the width is written once')
    await page.getByLabel('Stroke line cap').selectOption('round')
    await waitForDisk(harness, 'trait.svg', (text) => text.includes('stroke-linecap="round"'))
    await page.getByLabel('Stroke line join').selectOption('bevel')
    await waitForDisk(harness, 'trait.svg', (text) => text.includes('stroke-linejoin="bevel"'))
    await page.getByLabel('Stroke opacity').fill('0.5')
    await page.getByLabel('Stroke opacity').press('Enter')
    await waitForDisk(harness, 'trait.svg', (text) => text.includes('stroke-opacity="0.5"'))
    await page.getByLabel('Stroke dash array').fill('4 2')
    await page.getByLabel('Stroke dash array').press('Enter')
    const dashed = await waitForDisk(harness, 'trait.svg', (text) => text.includes('stroke-dasharray="4 2"'))
    assert.ok(dashed.includes('fill="#bda991"'), 'the fill is never touched by a stroke edit')

    // The stroke paint was undone earlier, so give the shape a real stroke again
    // before removing it: "Aucun" must clear an existing declaration.
    await page.getByLabel('Stroke colour').fill('#ff0000')
    await waitForDisk(harness, 'trait.svg', (text) => text.includes('stroke="#ff0000"'))
    await page.waitForFunction(() => document.querySelector('[aria-label="Stroke value"]')?.value === '#ff0000')
    await page.getByRole('button', { name: 'Remove stroke' }).click()
    const removed = await waitForDisk(harness, 'trait.svg', (text) => text.includes('stroke="none"'))
    assert.ok(removed.includes('stroke-width="3"'), 'removing the paint keeps the other stroke settings')
  },
}

export const strokeRefusalSpec = {
  name: 'stroke: values the browser could misread are never written',
  async run({ page, harness, assert }) {
    let applies = 0
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/design-studio-native/apply')) applies += 1
    })
    await harness.write('refus.svg', PLAIN)
    await openWorkspaceFile(page, 'refus.svg', { expect: 'svg' })
    await page.getByRole('button', { name: 'Select layer rect #box' }).click()
    await page.getByLabel('Stroke dash array').waitFor({ state: 'visible', timeout: 15000 })

    const before = applies
    // Values the interface must simply not send: the field keeps them out.
    for (const value of ['4px', 'expression(alert(1))', '-2']) {
      await page.getByLabel('Stroke dash array').fill(value)
      await page.getByLabel('Stroke dash array').press('Enter')
    }
    await page.getByLabel('Stroke opacity').fill('1.4')
    await page.getByLabel('Stroke opacity').press('Enter')
    await page.getByLabel('Stroke width').fill('-1')
    await page.getByLabel('Stroke width').press('Enter')
    await page.waitForTimeout(400)
    assert.equal(applies, before, 'an invalid stroke value must never reach the Host')
    assert.equal(await harness.read('refus.svg'), PLAIN, 'and must not modify the file')
  },
}

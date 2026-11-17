/**
 * Numeric inspector (Graphite V3 parity).
 *
 * The mockup puts X/Y/W/H and a fill hex in the inspector. These fields must
 * edit the document's own attributes - one value per save, exact undo - and
 * must never invent geometry for a shape that does not carry it.
 */
import { waitForDisk } from './helpers.mjs'

const RECT = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">
  <rect id="one" x="10" y="20" width="30" height="40" fill="#bda991"/>
  <path id="curve" d="M0 0 L10 10" fill="#333333"/>
</svg>
`

export const geometryInspectorSpec = {
  name: 'inspector: numeric X/Y/W/H edit one attribute at a time and undo exactly',
  async run({ page, harness, assert }) {
    await harness.write('mesure.svg', RECT)
    await page.getByRole('button', { name: 'Refresh workspace design files' }).click()
    await page.getByRole('button', { name: 'Open file mesure.svg' }).click()
    await page.waitForSelector('[aria-label="Canvas viewport"]', { timeout: 20000 })
    await page.getByRole('button', { name: 'Select layer rect #one' }).click()

    // The inputs show the document values, not a computed model.
    assert.equal(await page.getByLabel('Geometry x').inputValue(), '10')
    assert.equal(await page.getByLabel('Geometry y').inputValue(), '20')
    assert.equal(await page.getByLabel('Geometry width').inputValue(), '30')
    assert.equal(await page.getByLabel('Geometry height').inputValue(), '40')

    await page.getByLabel('Geometry width').fill('55')
    await page.getByLabel('Geometry width').blur()
    const widened = await waitForDisk(harness, 'mesure.svg', (text) => text.includes('width="55"'),
      { label: 'geometry width' })
    assert.ok(widened.includes('id="one" x="10" y="20" width="55" height="40"'),
      'only the edited attribute changes: ' + JSON.stringify(widened.split('\n')[2] || ''))
    assert.ok(widened.includes('id="curve"'), 'the other layers keep their bytes')
    assert.equal(await page.getByLabel('Geometry width').inputValue(), '55',
      'the field reflects the saved revision')

    // A path has no width attribute: no invented inputs, no broken numbers.
    await page.getByRole('button', { name: 'Select layer path #curve' }).click()
    assert.equal(await page.getByLabel('Geometry width').isEnabled(), false,
      'the persistent reference section must not make unsupported dimensions editable')
    assert.equal(await page.getByLabel('Geometry width').inputValue(), '',
      'a read-only placeholder must never invent a width for a path')

    // Undo restores the exact original bytes.
    await page.getByRole('button', { name: 'Select layer rect #one' }).click()
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    const restored = await waitForDisk(harness, 'mesure.svg', (text) => text === RECT, { label: 'undo geometry' })
    assert.equal(restored, RECT, 'undo restores the byte-identical document')
  },
}

export const fillInspectorSpec = {
  name: 'inspector: the fill hex field writes one validated paint and undo restores it',
  async run({ page, harness, assert }) {
    await harness.write('couleur.svg', RECT)
    await page.getByRole('button', { name: 'Refresh workspace design files' }).click()
    await page.getByRole('button', { name: 'Open file couleur.svg' }).click()
    await page.waitForSelector('[aria-label="Canvas viewport"]', { timeout: 20000 })
    await page.getByRole('button', { name: 'Select layer rect #one' }).click()

    assert.equal(await page.getByLabel('Fill hex').inputValue(), '#bda991', 'the field shows the real paint')
    assert.equal(await page.getByLabel('Fill colour').inputValue(), '#bda991', 'the swatch follows the same value')

    await page.getByLabel('Fill hex').fill('#00ff88')
    await page.getByLabel('Fill hex').blur()
    const painted = await waitForDisk(harness, 'couleur.svg', (text) => text.includes('#00ff88'),
      { label: 'fill edit' })
    assert.ok(painted.includes('<rect id="one" x="10" y="20" width="30" height="40" fill="#00ff88"/>'),
      'the fill value is replaced in place: ' + JSON.stringify(painted.split('\n')[2] || ''))
    assert.ok(painted.includes('fill="#333333"'), 'other fills are untouched')
    assert.equal(await page.getByLabel('Fill hex').inputValue(), '#00ff88')

    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    const restored = await waitForDisk(harness, 'couleur.svg', (text) => text === RECT, { label: 'undo fill' })
    assert.equal(restored, RECT)
  },
}

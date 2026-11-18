/**
 * Gradient stop editing from the inspector.
 *
 * Every spec drives a real browser against the real Host handler and a real
 * temporary filesystem: the assertions read the bytes on disk, count the actual
 * `POST /apply` requests, and prove that Undo restores the previous file exactly.
 *
 * The fixture deliberately contains: a writable gradient (`sky`), a gradient
 * inherited through `href` (`inherited`), and shapes whose fill is a plain hex,
 * a `url(#…)` pointing at an unknown gradient, and no fill at all.
 */
import { assertSingleDifferingRange, openWorkspaceFile, waitForDisk } from './helpers.mjs'

const GRADIENT_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <!-- gradient fixture: only stop attributes may ever be rewritten -->
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#102030" stop-opacity="1"/>
      <stop offset="0.55" stop-color="#405060"/>
      <stop offset="100%" stop-color="#8090a0" stop-opacity="0.8"/>
    </linearGradient>
    <linearGradient id="inherited" href="#sky" x1="0" y1="0" x2="0" y2="1"/>
  </defs>
  <rect id="panel" x="20" y="20" width="240" height="140" fill="url(#sky)"/>
  <rect id="ghost" x="300" y="20" width="120" height="80" fill="url(#inherited)"/>
  <rect id="orphan" x="300" y="140" width="120" height="80" fill="url(#absent)"/>
  <circle id="chip" cx="460" cy="300" r="40" fill="#3a3f45"/>
</svg>
`

function countApplies(page) {
  let count = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/design-studio-native/apply')) count += 1
  })
  return () => count
}

/** The inspector section for the gradient referenced by the selected shape. */
async function openGradientSection(page, id) {
  const section = page.locator('[data-gradient-section="' + id + '"]')
  await section.waitFor({ state: 'visible', timeout: 10000 })
  return section
}

export const gradientStopEditSpec = {
  name: 'gradient: editing a stop colour and opacity writes one exact attribute each and Undo restores the bytes',
  async run({ page, harness, assert }) {
    const applies = countApplies(page)
    await harness.write('degrade.svg', GRADIENT_SVG)
    await openWorkspaceFile(page, 'degrade.svg', { expect: 'svg' })

    await page.getByRole('button', { name: 'Select layer rect #panel', exact: true }).click()
    const section = await openGradientSection(page, 'sky')
    assert.equal(await section.getAttribute('data-gradient-usable'), 'true',
      'the referenced gradient is writable')
    assert.ok((await section.innerText()).includes('linearGradient · #sky · 3 arrêt(s)'),
      'the section names the gradient and its stop count')

    const color = page.getByLabel('Gradient stop 0 colour', { exact: true })
    const opacity = page.getByLabel('Gradient stop 0 opacity', { exact: true })
    assert.equal(await color.inputValue(), '#102030', 'the colour field starts from the file value')
    assert.equal(await opacity.inputValue(), '1', 'the opacity field starts from the file value')
    // A stop without stop-opacity must not offer an active opacity field.
    assert.equal(await page.getByLabel('Gradient stop 1 opacity', { exact: true }).isDisabled(), true,
      'an absent attribute has no active field (this tranche never inserts one)')
    assert.equal(await harness.read('degrade.svg'), GRADIENT_SVG, 'rendering the inspector must not write')
    assert.equal(applies(), 0, 'rendering the inspector must not call the Host')

    await color.fill('#205080')
    await color.press('Enter')
    const withColor = await waitForDisk(harness, 'degrade.svg',
      (text) => text.includes('stop-color="#205080"'), { label: 'stop colour' })
    const colorWindow = assertSingleDifferingRange(assert, GRADIENT_SVG, withColor, 'stop colour')
    // The differing range is inside the value (the shared prefix/suffix digits
    // are excluded by the diff), and the full comparison below proves that only
    // this attribute value changed.
    assert.ok(colorWindow.before.length > 0 && colorWindow.after.length > 0 && colorWindow.before.length <= 7,
      'the differing range stays inside the edited value')
    assert.equal(withColor, GRADIENT_SVG.replace('stop-color="#102030"', 'stop-color="#205080"'),
      'no other byte moved: comments, offsets, quote style and other stops are untouched')
    assert.equal(applies(), 1, 'one stop colour is exactly one Host write')

    // The same inspector, after reload, edits the third stop opacity.
    const thirdOpacity = page.getByLabel('Gradient stop 2 opacity', { exact: true })
    assert.equal(await thirdOpacity.inputValue(), '0.8', 'the opacity value comes from the file')
    await thirdOpacity.fill('0.5')
    await thirdOpacity.press('Enter')
    const withOpacity = await waitForDisk(harness, 'degrade.svg',
      (text) => text.includes('stop-opacity="0.5"'), { label: 'stop opacity' })
    assertSingleDifferingRange(assert, withColor, withOpacity, 'stop opacity')
    assert.equal(withOpacity, withColor.replace('stop-opacity="0.8"', 'stop-opacity="0.5"'),
      'only the targeted stop-opacity value changed')
    assert.equal(applies(), 2, 'one stop opacity is exactly one Host write')

    // Undo is byte-exact and only reverts the last write.
    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    await waitForDisk(harness, 'degrade.svg', (text) => text === withColor, { label: 'undo stop opacity' })
    assert.equal(await harness.read('degrade.svg'), withColor, 'Undo restores the colour-only bytes exactly')
    assert.equal(applies(), 3, 'Undo is one more Host write')
    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    await waitForDisk(harness, 'degrade.svg', (text) => text === GRADIENT_SVG, { label: 'undo stop colour' })
    assert.equal(await harness.read('degrade.svg'), GRADIENT_SVG, 'the second Undo restores the original file')
    assert.equal(applies(), 4, 'each Undo is exactly one Host write')
  },
}

export const gradientInheritedReadOnlySpec = {
  name: 'gradient: an href-inherited gradient is read-only, shows its reason and sends no request',
  async run({ page, harness, assert }) {
    const applies = countApplies(page)
    await harness.write('herite.svg', GRADIENT_SVG)
    await openWorkspaceFile(page, 'herite.svg', { expect: 'svg' })

    await page.getByRole('button', { name: 'Select layer rect #ghost', exact: true }).click()
    const section = await openGradientSection(page, 'inherited')
    assert.equal(await section.getAttribute('data-gradient-usable'), 'false',
      'an inherited gradient is never reported as writable')
    const reason = page.locator('[data-gradient-reason]')
    assert.equal(await reason.getAttribute('data-gradient-reason'), 'inherited-gradient',
      'the refusal is typed in the DOM, not only in prose')
    assert.match(await reason.innerText(), /hérité par href/,
      'the reason is visible to the user')
    assert.equal(await page.locator('[data-gradient-section] input').count(), 0,
      'no active field is proposed for a non-editable gradient')
    assert.equal(await harness.read('herite.svg'), GRADIENT_SVG, 'nothing was written')
    assert.equal(applies(), 0, 'no request was sent for a read-only gradient')
  },
}

export const gradientNotReferencedSpec = {
  name: 'gradient: a fill that is not a resolvable url(#id) shows no gradient section',
  async run({ page, harness, assert }) {
    const applies = countApplies(page)
    await harness.write('sans-degrade.svg', GRADIENT_SVG)
    await openWorkspaceFile(page, 'sans-degrade.svg', { expect: 'svg' })

    // Plain hex fill: the existing fill controls are enough, nothing new.
    await page.getByRole('button', { name: 'Select layer circle #chip', exact: true }).click()
    await page.waitForTimeout(300)
    assert.equal(await page.locator('[data-gradient-section]').count(), 0,
      'a hex fill must not show a gradient section')

    // url(#absent) is a reference to an unknown gradient: it is not listed, so
    // no section is invented for it.
    await page.getByRole('button', { name: 'Select layer rect #orphan', exact: true }).click()
    await page.waitForTimeout(300)
    assert.equal(await page.locator('[data-gradient-section]').count(), 0,
      'an unknown gradient id must not show a gradient section')
    assert.equal(await harness.read('sans-degrade.svg'), GRADIENT_SVG, 'selection never writes')
    assert.equal(applies(), 0, 'selection never calls the Host')
  },
}

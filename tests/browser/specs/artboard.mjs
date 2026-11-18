/**
 * Artboard (planche) resizing from the inspector.
 *
 * Every spec drives the real browser against the real Host handler and a real
 * temporary filesystem. It reads the exact bytes on disk, counts the actual
 * `POST /apply` requests and proves that Undo restores the previous file byte
 * for byte. The fixture contains shapes whose `width` attributes must never be
 * confused with the root `width`.
 */
import { openWorkspaceFile, waitForDisk } from './helpers.mjs'

const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">
  <rect id="one" x="10" y="20" width="30" height="40" fill="#bda991"/>
  <circle id="dot" cx="120" cy="80" r="12" fill="#3a3f45"/>
</svg>
`

const SIZED = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">
  <rect id="one" x="10" y="20" width="30" height="40" fill="#bda991"/>
</svg>
`

function countApplies(page) {
  let count = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/design-studio-native/apply')) count += 1
  })
  return () => count
}

async function openArtboard(page, harness, file) {
  await openWorkspaceFile(page, file, { expect: 'svg' })
  const section = page.locator('[data-artboard-inspector]')
  await section.waitFor({ state: 'visible', timeout: 10000 })
  return section
}

function ratio(child, parent) {
  return child.width / child.height
}

export const artboardWidthSpec = {
  name: 'artboard: a width change rewrites only the root width, rescales the canvas and Undo is byte-exact',
  async run({ page, harness, assert }) {
    const applies = countApplies(page)
    await harness.write('planche.svg', SVG)
    const section = await openArtboard(page, harness, 'planche.svg')

    assert.equal(await section.getAttribute('data-artboard-ok'), 'true')
    assert.match(await section.innerText(), /240 × 160 px/, 'the current size is read from the file')
    assert.match(await section.innerText(), /viewBox 0 0 240 160/)
    assert.equal(await page.getByLabel('Artboard width').inputValue(), '240')
    assert.equal(await page.getByLabel('Artboard height').inputValue(), '160')
    assert.equal(await page.getByLabel('Redimensionner le contenu').isChecked(), false,
      'the content mode is an explicit, separate choice')
    assert.equal(applies(), 0, 'rendering the inspector must not write')

    const before = await page.locator('.dsh-studio-artboard').boundingBox()
    const beforeContent = await page.locator('.dsh-studio-artboard-content').boundingBox()
    assert.ok(Math.abs(ratio(before, null) - 240 / 160) < 0.03,
      'the board starts at the declared 240x160 aspect ratio')
    assert.ok(Math.abs(beforeContent.height - before.height) < 2,
      'with matching proportions the content fills the board')

    await page.getByLabel('Artboard width').fill('300')
    await page.getByRole('button', { name: 'Apply artboard size' }).click()

    const widened = await waitForDisk(harness, 'planche.svg',
      (text) => text.includes('width="300"'), { label: 'artboard width' })
    assert.equal(widened, SVG.replace('width="240"', 'width="300"'),
      'only the root width changed; viewBox and every shape keep their exact bytes')
    assert.equal(applies(), 1, 'one Apply is exactly one Host write')
    await page.waitForFunction(() => document.querySelector('[aria-label="Artboard width"]')?.value === '300')

    // The canvas reflects the new declared size, and the content is letterboxed
    // instead of being stretched: handles still sit on the rendered shape.
    await page.waitForFunction(() => {
      const board = document.querySelector('.dsh-studio-artboard')
      const label = document.querySelector('.dsh-studio-artboard-label')
      return board && label && Math.abs(board.getBoundingClientRect().width / board.getBoundingClientRect().height - 300 / 160) < 0.03
    })
    const after = await page.locator('.dsh-studio-artboard').boundingBox()
    assert.ok(Math.abs(ratio(after, null) - 300 / 160) < 0.03,
      'the board aspect ratio follows the new width')
    assert.match(await page.locator('.dsh-studio-artboard-label').innerText(), /300 × 160/,
      'the label shows the size read back from the Host')
    const content = await page.locator('.dsh-studio-artboard-content').boundingBox()
    assert.ok(Math.abs(ratio(content, null) - 240 / 160) < 0.03,
      'the content keeps the viewBox proportions and is centered')
    const handle = await page.getByRole('button', { name: 'Drag rect one' }).boundingBox()
    const expected = {
      x: content.x + (10 / 240) * content.width,
      y: content.y + (20 / 160) * content.height,
      width: (30 / 240) * content.width,
    }
    assert.ok(Math.abs(handle.x - expected.x) <= 2,
      `the handle x follows the letterboxed content (${handle.x.toFixed(1)} vs ${expected.x.toFixed(1)})`)
    assert.ok(Math.abs(handle.y - expected.y) <= 2,
      `the handle y follows the letterboxed content (${handle.y.toFixed(1)} vs ${expected.y.toFixed(1)})`)
    assert.ok(Math.abs(handle.width - expected.width) <= 2,
      `the handle width follows the letterboxed content (${handle.width.toFixed(1)} vs ${expected.width.toFixed(1)})`)

    // Undo is byte-exact and restores the previous canvas size.
    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    await waitForDisk(harness, 'planche.svg', (text) => text === SVG, { label: 'undo artboard width' })
    assert.equal(await harness.read('planche.svg'), SVG, 'Undo restores the original bytes exactly')
    assert.equal(applies(), 2, 'Undo is exactly one more Host write')
    await page.waitForFunction(() => document.querySelector('[aria-label="Artboard width"]')?.value === '240')
    assert.equal(await page.getByLabel('Artboard width').inputValue(), '240')
  },
}

export const artboardContentSpec = {
  name: 'artboard: the content mode writes viewBox, width and height in one write and Undo restores the bytes',
  async run({ page, harness, assert }) {
    const applies = countApplies(page)
    await harness.write('contenu.svg', SVG)
    const section = await openArtboard(page, harness, 'contenu.svg')

    await page.getByLabel('Artboard width').fill('300')
    await page.getByLabel('Artboard height').fill('200')
    const checkbox = page.getByLabel('Redimensionner le contenu')
    await checkbox.check()
    assert.equal(await checkbox.isChecked(), true)
    assert.match(await section.innerText(), /viewBox, largeur et hauteur changent ensemble/,
      'the checkbox announces exactly what it does')
    await page.getByRole('button', { name: 'Apply artboard size' }).click()

    const resized = await waitForDisk(harness, 'contenu.svg',
      (text) => text.includes('viewBox="0 0 300 200"'), { label: 'artboard content resize' })
    assert.equal(resized, SVG.replace(
      'width="240" height="160" viewBox="0 0 240 160"',
      'width="300" height="200" viewBox="0 0 300 200"'),
      'all three attributes changed together and no shape byte moved')
    assert.equal(applies(), 1, 'the three attributes travel in exactly one Host write')
    // Wait for the Host reload to reach the canvas and the metadata, not just
    // for the number the user typed to survive the first re-render.
    await page.waitForFunction(() => {
      const label = document.querySelector('.dsh-studio-artboard-label')?.textContent || ''
      const size = document.querySelector('[data-artboard-size]')?.textContent || ''
      return label.includes('300 × 200') && size.includes('300 × 200')
    })
    assert.equal(await page.getByLabel('Artboard width').inputValue(), '300')
    assert.equal(await page.getByLabel('Artboard height').inputValue(), '200')
    assert.match(await page.locator('.dsh-studio-artboard-label').innerText(), /300 × 200/)
    const board = await page.locator('.dsh-studio-artboard').boundingBox()
    assert.ok(Math.abs(ratio(board, null) - 300 / 200) < 0.03,
      'the canvas reflects the new size after the Host reload')

    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    await waitForDisk(harness, 'contenu.svg', (text) => text === SVG, { label: 'undo content resize' })
    assert.equal(await harness.read('contenu.svg'), SVG, 'Undo restores viewBox, width and height exactly')
    assert.equal(applies(), 2, 'Undo is exactly one more Host write')
  },
}

export const artboardNoViewBoxSpec = {
  name: 'artboard: a document without viewBox requires the explicit content mode and inserts one reversibly',
  async run({ page, harness, assert }) {
    const applies = countApplies(page)
    await harness.write('sans-viewbox.svg', SIZED)
    const section = await openArtboard(page, harness, 'sans-viewbox.svg')

    assert.equal(await section.getAttribute('data-artboard-ok'), 'true')
    assert.match(await section.innerText(), /120 × 80 px/)
    assert.match(await section.innerText(), /width 120 · height 80/)
    assert.equal(await page.getByRole('button', { name: 'Apply artboard size' }).isDisabled(), true,
      'without a viewBox the display mode must not silently resize the content')
    assert.equal(await page.locator('[data-artboard-blocked]').isVisible(), true,
      'the disabled control carries its reason')
    assert.equal(applies(), 0)

    await page.getByLabel('Redimensionner le contenu').check()
    assert.equal(await page.getByRole('button', { name: 'Apply artboard size' }).isEnabled(), true)
    await page.getByLabel('Artboard width').fill('200')
    await page.getByLabel('Artboard height').fill('100')
    await page.getByRole('button', { name: 'Apply artboard size' }).click()

    const resized = await waitForDisk(harness, 'sans-viewbox.svg',
      (text) => text.includes('viewBox="0 0 200 100"'), { label: 'insert viewBox' })
    assert.equal(resized,
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">\n' +
      '  <rect id="one" x="10" y="20" width="30" height="40" fill="#bda991"/>\n</svg>\n',
      'the viewBox is inserted once at the exact root offset')
    assert.equal(applies(), 1, 'one Apply is exactly one Host write')

    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    await waitForDisk(harness, 'sans-viewbox.svg', (text) => text === SIZED, { label: 'undo insert viewBox' })
    assert.equal(await harness.read('sans-viewbox.svg'), SIZED,
      'Undo removes exactly the inserted viewBox and restores width/height')
    assert.equal(applies(), 2)
  },
}

export const artboardRefusalSpec = {
  name: 'artboard: invalid values are refused without a request or a byte change',
  async run({ page, harness, assert }) {
    const applies = countApplies(page)
    await harness.write('refus.svg', SVG)
    await openArtboard(page, harness, 'refus.svg')

    await page.getByLabel('Artboard width').fill('0')
    await page.getByRole('button', { name: 'Apply artboard size' }).click()
    const alert = page.getByRole('alert')
    await alert.waitFor({ state: 'visible', timeout: 5000 })
    assert.match(await alert.innerText(), /hors bornes|1 à 20000/)
    assert.equal(applies(), 0, 'an invalid dimension never reaches the Host')
    assert.equal(await harness.read('refus.svg'), SVG, 'no byte changed')

    await page.getByLabel('Artboard width').fill('20001')
    await page.getByRole('button', { name: 'Apply artboard size' }).click()
    await page.waitForTimeout(300)
    assert.equal(applies(), 0, 'an out-of-bounds dimension never reaches the Host')
    assert.equal(await harness.read('refus.svg'), SVG)

    // The number input cannot hold letters in a real browser; the non-numeric
    // refusal is proven at the Host level instead.
  },
}

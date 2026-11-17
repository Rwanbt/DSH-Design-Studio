/**
 * Creating a brand-new document from the workbench.
 *
 * The plugin could only open files that already existed, so starting a design
 * meant leaving the editor. These specs drive the real UI against the real Host
 * and a real temporary workspace, and they check the two properties that must
 * hold: a create really writes a valid native document that opens in the canvas,
 * and a create never replaces a file that already exists.
 */
import { waitForDisk, openFileMenu } from './helpers.mjs'

export const createSpec = {
  name: 'create: a new SVG document is written, listed and opened in the canvas',
  async run({ page, harness, assert }) {
    const region = page.getByRole('region', { name: 'Open a design file' })
    await region.waitFor({ state: 'visible', timeout: 20000 })

    await page.getByLabel('New design file name').fill('carte')
    await page.getByRole('button', { name: 'Create SVG file' }).click()

    // The canvas mounts only after the Host returned a real document with a
    // real artboard, so its presence proves the created file is valid SVG.
    await page.waitForSelector('[aria-label="Canvas viewport"]', { timeout: 20000 })
    const stage = page.locator('.dsh-studio-stage-top')
    assert.ok((await stage.innerText()).includes('carte.svg'),
      'the stage header must name the created document: ' + JSON.stringify(await stage.innerText()))
    assert.equal(await page.getByLabel('Workspace file').inputValue(), 'carte.svg',
      'the created path becomes the open path')
    assert.equal(await region.count(), 0, 'the landing state disappears once the document is open')

    // The bytes on disk are a real SVG document, with the template ids the
    // layer list and the inspector already know how to edit.
    const written = await waitForDisk(harness, 'carte.svg', (content) => content.includes('</svg>'),
      { label: 'created svg' })
    assert.ok(written.startsWith('<?xml'), 'the created document starts with an XML declaration')
    assert.ok(written.includes('viewBox="0 0 640 360"'), 'the created document carries a real artboard')
    assert.ok(written.includes('id="fond"'), 'the created document carries an editable layer id')

    // The new file is part of the workspace listing from then on.
    await openFileMenu(page)
    await page.getByRole('button', { name: 'Browse workspace design files' }).click()
    await page.getByRole('button', { name: 'Open file carte.svg' })
      .waitFor({ state: 'visible', timeout: 20000 })
  },
}

export const createCssSpec = {
  name: 'create: a new CSS document opens the rule inspector with its own rules',
  async run({ page, harness, assert }) {
    await page.getByRole('region', { name: 'Open a design file' }).waitFor({ state: 'visible', timeout: 20000 })
    await page.getByLabel('New design file name').fill('theme')
    await page.getByRole('button', { name: 'Create CSS file' }).click()

    await page.getByRole('button', { name: 'Select CSS rule body' })
      .waitFor({ state: 'visible', timeout: 20000 })
    const stage = page.locator('.dsh-studio-stage-top')
    assert.ok((await stage.innerText()).includes('theme.css'),
      'the stage header must name the created stylesheet: ' + JSON.stringify(await stage.innerText()))

    // Editing the created stylesheet proves it is a real, writable document,
    // not a placeholder rendered from the client template.
    await page.getByRole('button', { name: 'Select CSS rule body' }).click()
    await page.getByLabel('CSS rule property').selectOption('color')
    await page.getByLabel('CSS rule value').fill('#123456')
    await page.getByRole('button', { name: 'Apply CSS rule style' }).click()
    const edited = await waitForDisk(harness, 'theme.css', (content) => content.includes('#123456'),
      { label: 'created css edit' })
    assert.ok(edited.includes(':root'), 'the template root rule survives the edit')
    assert.ok(edited.includes('body {'), 'the template body rule survives the edit')
  },
}

export const createRefusalSpec = {
  name: 'create: an existing path is refused and its bytes are never replaced',
  // The refusal is a deliberate 409; the browser reports it as a resource error
  // and the spec asserts the outcome, so the allowance stays scoped to refusals.
  allowConsoleErrors: 'refusals',
  async run({ page, harness, assert }) {
    const original = '<!-- kept exactly -->\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>\n'
    await harness.write('existe.svg', original)
    await page.getByRole('region', { name: 'Open a design file' }).waitFor({ state: 'visible', timeout: 20000 })
    await page.getByRole('button', { name: 'Refresh workspace design files' }).click()
    await page.getByRole('button', { name: 'Open file existe.svg' }).waitFor({ state: 'visible', timeout: 20000 })

    await page.getByLabel('New design file name').fill('existe.svg')
    await page.getByRole('button', { name: 'Create SVG file' }).click()

    const alert = page.getByRole('alert')
    await alert.waitFor({ state: 'visible', timeout: 20000 })
    assert.ok((await alert.innerText()).includes('existe.svg'),
      'the refusal must name the path it refused: ' + JSON.stringify(await alert.innerText()))
    assert.equal(await harness.read('existe.svg'), original,
      'a refused create must leave the existing bytes untouched')
    assert.equal(await page.getByRole('region', { name: 'Open a design file' }).count(), 1,
      'a refused create must keep the user on the landing state')
  },
}

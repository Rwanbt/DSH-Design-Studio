/**
 * Landing state of the workbench.
 *
 * The plugin shipped a tab whose body was empty until a file was open AND the
 * list of workspace files only existed after clicking "Parcourir…". A first
 * visit therefore looked like a broken plugin. These assertions drive a real
 * browser against a real Host and a real temporary workspace: the landing state
 * must list the workspace's design files without any click, open one directly,
 * and say something useful when the workspace holds no design file.
 */
import { SVG_DOCUMENT } from './helpers.mjs'

export const landingSpec = {
  name: 'landing: the workbench lists workspace files before any click and opens one directly',
  async run({ page, harness, assert }) {
    // Two real design files in a real temporary workspace, one nested.
    await harness.write('landing-a.svg', SVG_DOCUMENT)
    await harness.write('nested/landing-b.svg', SVG_DOCUMENT)

    const region = page.getByRole('region', { name: 'Open a design file' })
    await region.waitFor({ state: 'visible', timeout: 20000 })
    // The list loads on mount; files written afterwards must be reachable too,
    // so the refresh control is part of the contract (and is used here).
    await page.getByRole('button', { name: 'Refresh workspace design files' }).click()

    // The list must arrive without a "Parcourir…" click and without a typed path.
    const first = page.getByRole('button', { name: 'Open file landing-a.svg' })
    const nested = page.getByRole('button', { name: 'Open file nested/landing-b.svg' })
    await first.waitFor({ state: 'visible', timeout: 20000 })
    await nested.waitFor({ state: 'visible', timeout: 20000 })
    assert.equal(await region.getByText('Aucun fichier ouvert').count(), 1,
      'the landing state must name what the user is looking at')

    // Opening from that list must reach a real document, not just change a label.
    await nested.click()
    await page.waitForSelector('[aria-label="Canvas viewport"]', { timeout: 20000 })
    const stage = page.locator('.dsh-studio-stage-top')
    await stage.waitFor({ state: 'visible', timeout: 20000 })
    assert.ok((await stage.innerText()).includes('nested/landing-b.svg'),
      'the stage header must name the open document: ' + JSON.stringify(await stage.innerText()))
    assert.equal(await region.count(), 0,
      'the landing state must disappear once a document is open')
    // The open document is the one that was clicked, and the bytes are the real
    // workspace bytes (the Host read them; the browser did not invent them).
    const fileValue = await page.getByLabel('Workspace file').inputValue()
    assert.equal(fileValue, 'nested/landing-b.svg', 'the opened path must be the clicked path')
  },
}

export const landingEmptySpec = {
  name: 'landing: an empty workspace explains the situation instead of showing a blank tab',
  async run({ page, harness, assert }) {
    // A workspace with no design file at all: this used to render nothing.
    await harness.write('notes.txt', 'not a design file')
    const region = page.getByRole('region', { name: 'Open a design file' })
    await region.waitFor({ state: 'visible', timeout: 20000 })
    await page.getByRole('button', { name: 'Refresh workspace design files' }).click()
    assert.equal(await page.getByText(/0 fichiers? de design/).count(), 1,
      'the empty workspace must report zero design files, not merely hide the rows')
    const status = page.getByRole('status').filter({ hasText: 'Aucun fichier SVG, HTML ou CSS' })
    await status.waitFor({ state: 'visible', timeout: 20000 })
    assert.equal(await page.getByRole('button', { name: /^Open file / }).count(), 0,
      'no file row may be offered when the workspace has none')
    assert.equal(await page.getByLabel('Workspace file').count(), 1,
      'the typed path must stay available as the manual escape hatch')
  },
}

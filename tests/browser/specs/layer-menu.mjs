/**
 * The right-click layer menu.
 *
 * It is a second entry point to the same Host operations, so the specs check
 * that it edits real bytes, that Escape and the backdrop close it without
 * writing, and that a row action targets the row that was right-clicked rather
 * than the previous selection.
 */
import { SVG_DOCUMENT, openWorkspaceFile, waitForDisk } from './helpers.mjs'

export const layerMenuSpec = {
  name: 'menu: right-clicking a shape hides it through the real Host call and Escape closes without writing',
  async run({ page, harness, assert }) {
    await harness.write('menu.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'menu.svg', { expect: 'svg' })

    const shape = page.getByLabel('Drag circle dot')
    await shape.click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Actions du calque' })
    await menu.waitFor({ state: 'visible', timeout: 20000 })
    assert.ok((await menu.innerText()).includes('dot'), 'the menu must name the right-clicked layer')

    // Escape closes the menu and must not write anything.
    await page.keyboard.press('Escape')
    assert.equal(await menu.count(), 0, 'Escape must close the menu')
    assert.equal(await harness.read('menu.svg'), SVG_DOCUMENT, 'closing the menu must not write')

    // The backdrop closes it too, from a real pointer press on the canvas area.
    await shape.click({ button: 'right' })
    await menu.waitFor({ state: 'visible', timeout: 20000 })
    await page.locator('[data-layer-menu-backdrop]').click({ position: { x: 4, y: 4 } })
    assert.equal(await menu.count(), 0, 'the backdrop must close the menu')
    assert.equal(await harness.read('menu.svg'), SVG_DOCUMENT)

    // A menu action performs the same exact patch the inspector performs.
    await shape.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Masquer le calque' }).click()
    const hidden = await waitForDisk(harness, 'menu.svg', text => text.includes('id="dot"') && text.includes('display="none"'))
    assert.ok(hidden.includes('<circle'), 'hiding keeps the element itself')
    assert.ok(hidden.includes('id="card"'), 'hiding one layer leaves the others alone')

    // The menu exposes the inverse operation once the layer is hidden.
    await shape.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Afficher le calque' }).click()
    await waitForDisk(harness, 'menu.svg', text => !text.includes('display="none"'))
  },
}

export const layerMenuRowSpec = {
  name: 'menu: a row action targets the right-clicked layer, not the previous selection',
  async run({ page, harness, assert }) {
    await harness.write('rows.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'rows.svg', { expect: 'svg' })

    // Select one layer first; the menu is opened on a different row.
    await page.getByRole('button', { name: 'Select layer rect #card' }).click()
    await page.getByRole('button', { name: 'Select layer circle #dot' }).click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Actions du calque' })
    await menu.waitFor({ state: 'visible', timeout: 20000 })
    assert.ok((await menu.innerText()).includes('circle #dot'),
      'the menu must describe the row that was right-clicked: ' + JSON.stringify(await menu.innerText()))

    await page.getByRole('menuitem', { name: 'Dupliquer le calque' }).click()
    const duplicated = await waitForDisk(harness, 'rows.svg', text => text.includes('id="dot-copy"'))
    assert.ok(duplicated.includes('id="dot"'), 'the original layer is kept')
    assert.ok(duplicated.includes('id="card"'), 'the previously selected layer is untouched')
    // The clone is the selected layer, as with Ctrl+D.
    await page.getByRole('button', { name: 'Select layer circle #dot-copy' }).waitFor({ state: 'attached' })
  },
}

export const copyPasteSpec = {
  name: 'menu: copying a layer in one document and pasting it into another writes the real element with a fresh id',
  async run({ page, harness, assert }) {
    await harness.write('source.svg', SVG_DOCUMENT)
    await harness.write('cible.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'source.svg', { expect: 'svg' })

    // Copy through the shortcut, then verify the paste is only offered once
    // something was copied.
    await page.getByRole('button', { name: 'Select layer rect #card' }).click()
    await page.getByRole('button', { name: 'Select layer rect #card' }).focus()
    await page.keyboard.press('Control+c')
    assert.equal(await harness.read('source.svg'), SVG_DOCUMENT, 'copying must not write anything')

    // Open the other document and paste there.
    await openWorkspaceFile(page, 'cible.svg', { expect: 'svg' })
    const overlay = page.getByLabel('Direct manipulation overlay')
    await overlay.focus()
    await page.keyboard.press('Control+v')
    const pasted = await waitForDisk(harness, 'cible.svg', (text) => text.includes('id="card-copy"'))
    assert.ok(pasted.includes('id="card"'), 'the original layer stays in the target document')
    assert.ok(pasted.includes('x="40" y="40" width="240" height="140"'),
      'the copied geometry is the real one, not a placeholder')
    // The copied bytes never leak into the source document.
    assert.equal(await harness.read('source.svg'), SVG_DOCUMENT)

    // Pasting the same element again must allocate a second distinct id.
    await page.keyboard.press('Control+v')
    const twice = await waitForDisk(harness, 'cible.svg', (text) => text.includes('id="card-copy-2"'))
    assert.ok(twice.includes('id="card-copy"'), 'the first paste is kept')
  },
}

export const pasteMenuSpec = {
  name: 'menu: the paste entry stays disabled until a layer was really copied',
  async run({ page, harness, assert }) {
    await harness.write('vierge.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'vierge.svg', { expect: 'svg' })
    await page.getByRole('button', { name: 'Select layer rect #card' }).click({ button: 'right' })
    const paste = page.getByRole('menuitem', { name: 'Coller l’élément copié' })
    await paste.waitFor({ state: 'visible', timeout: 20000 })
    assert.equal(await paste.isDisabled(), true, 'nothing has been copied yet')

    await page.getByRole('menuitem', { name: 'Copier le calque' }).click()
    await page.getByRole('button', { name: 'Select layer rect #card' }).click({ button: 'right' })
    const enabled = page.getByRole('menuitem', { name: 'Coller l’élément copié' })
    assert.equal(await enabled.isDisabled(), false, 'a copied layer makes the paste available')
    await enabled.click()
    const pasted = await waitForDisk(harness, 'vierge.svg', (text) => text.includes('id="card-copy"'))
    assert.ok(pasted.includes('id="card"'))
  },
}

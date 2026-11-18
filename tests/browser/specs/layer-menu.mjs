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
    // The copy is announced before the paste is attempted, so a failure here
    // says "the shortcut did not reach the editor" instead of "the paste failed".
    const copied = page.locator('[data-created]')
    await copied.waitFor({ state: 'visible', timeout: 20000 })
    assert.ok((await copied.innerText()).includes('Calque copié'),
      'the copy must be confirmed: ' + JSON.stringify(await copied.innerText()))
    assert.equal(await harness.read('source.svg'), SVG_DOCUMENT, 'copying must not write anything')

    // Open the other document and paste there. Focus a real control inside the
    // workbench first: the shortcuts are handled by the section, so pressing a
    // key while focus sits outside it would legitimately do nothing.
    await openWorkspaceFile(page, 'cible.svg', { expect: 'svg' })
    await page.getByRole('button', { name: 'Select canvas tool' }).click()
    await page.keyboard.press('Control+v')
    const pasted = await waitForDisk(harness, 'cible.svg', (text) => text.includes('id="card-copy"'),
      { label: 'first paste' })
    assert.ok(pasted.includes('id="card"'), 'the original layer stays in the target document')
    assert.ok(pasted.includes('x="40" y="40" width="240" height="140"'),
      'the copied geometry is the real one, not a placeholder')
    // The copied bytes never leak into the source document.
    assert.equal(await harness.read('source.svg'), SVG_DOCUMENT)

    // Disk writes precede the client reload. Wait until the first saved edit is
    // ready to undo before sending another shortcut, which is ignored while busy.
    await page.waitForFunction(() =>
      document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    // Pasting the same element again must allocate a second distinct id.
    await page.keyboard.press('Control+v')
    const twice = await waitForDisk(harness, 'cible.svg', (text) => text.includes('id="card-copy-2"'),
      { label: 'second paste' })
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

export const reorderSpec = {
  name: 'menu: paint order changes the real document order and Undo restores it',
  async run({ page, harness, assert }) {
    await harness.write('ordre.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'ordre.svg', { expect: 'svg' })
    const order = (text) => [...text.matchAll(/id="(bg|card|dot|title)"/g)].map((match) => match[1])
    assert.deepEqual(order(await harness.read('ordre.svg')), ['bg', 'card', 'dot', 'title'])

    // Bring the first painted layer to the front through the menu.
    await page.getByRole('button', { name: 'Select layer rect #bg' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Mettre au premier plan' }).click()
    const reordered = await waitForDisk(harness, 'ordre.svg', (text) => order(text).at(-1) === 'bg')
    assert.deepEqual(order(reordered), ['card', 'dot', 'title', 'bg'])
    assert.ok(reordered.includes('<rect id="bg" x="0" y="0" width="600" height="400" fill="#f4f1ea"/>'),
      'the moved layer keeps its exact bytes')

    // The same operation is available from the keyboard: Ctrl+[ moves it back.
    await page.getByRole('button', { name: 'Select canvas tool' }).click()
    await page.keyboard.press('Control+[')
    const back = await waitForDisk(harness, 'ordre.svg', (text) => order(text)[2] === 'bg')
    assert.deepEqual(order(back), ['card', 'dot', 'bg', 'title'])

    // Undo restores the original order byte for byte.
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    assert.equal(await waitForDisk(harness, 'ordre.svg',
      (text) => JSON.stringify(order(text)) === JSON.stringify(['card', 'dot', 'title', 'bg'])),
    (await harness.read('ordre.svg')))
  },
}

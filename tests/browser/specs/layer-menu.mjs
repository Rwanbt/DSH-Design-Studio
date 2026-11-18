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

    const row = page.getByRole('button', { name: 'Select layer circle #dot' })
    const duplicate = menu.getByRole('menuitem', { name: 'Dupliquer le calque' })
    const focused = async name => assert.equal(await menu.getByRole('menuitem', { name, exact: true }).evaluate(node => node === document.activeElement), true, name + ' is focused')
    await focused('Dupliquer le calque')
    await page.keyboard.press('ArrowDown')
    await focused('Copier le calque')
    await page.keyboard.press('ArrowDown')
    await focused('Avancer d’un plan') // Empty clipboard: disabled paste is skipped.
    await page.keyboard.press('ArrowUp')
    await focused('Copier le calque')
    await page.keyboard.press('End')
    await focused('Fermer le menu')
    await page.keyboard.press('ArrowDown')
    await focused('Dupliquer le calque')
    await page.keyboard.press('ArrowUp')
    await focused('Fermer le menu')
    await page.keyboard.press('Home')
    await focused('Dupliquer le calque')
    // These would move/duplicate/delete/paste or switch canvas tools if bubbled.
    for (const key of ['Control+d', 'Control+v', 'Delete', 'r']) {
      await page.keyboard.press(key)
    }
    assert.equal(await page.getByRole('button', { name: 'Select canvas tool', exact: true }).getAttribute('aria-pressed'), 'true', 'r inside the menu cannot switch the canvas tool')
    assert.equal(await harness.read('rows.svg'), SVG_DOCUMENT, 'navigation and menu-scoped shortcuts never write')
    await page.keyboard.press('Escape')
    assert.equal(await menu.count(), 0)
    assert.equal(await row.evaluate(node => node === document.activeElement), true, 'Escape restores the row trigger')
    for (const key of ['ContextMenu', 'Shift+F10']) {
      await row.focus()
      await page.keyboard.press(key)
      await menu.waitFor({ state: 'visible' })
      await focused('Dupliquer le calque')
      await page.keyboard.press('Escape')
      assert.equal(await row.evaluate(node => node === document.activeElement), true)
    }
    for (const key of ['Tab', 'Shift+Tab']) {
      await row.focus()
      await page.keyboard.press('ContextMenu')
      await focused('Dupliquer le calque')
      await page.keyboard.press(key)
      assert.equal(await menu.count(), 0, key + ' closes the menu')
      assert.equal(await page.evaluate(() => !!document.activeElement && document.activeElement !== document.body && !document.activeElement.closest('[role="menu"]')), true, key + ' leaves focus on a real control')
    }
    await row.focus()
    assert.equal(await harness.read('rows.svg'), SVG_DOCUMENT, 'keyboard opening and closing preserve exact bytes')
    await page.keyboard.press('ContextMenu')
    await duplicate.waitFor()
    await focused('Dupliquer le calque')
    await page.keyboard.press('Enter')
    const duplicated = await waitForDisk(harness, 'rows.svg', text => text.includes('id="dot-copy"'))
    assert.ok(duplicated.includes('id="dot"'), 'the original layer is kept')
    assert.ok(duplicated.includes('id="card"'), 'the previously selected layer is untouched')
    // The clone is the selected layer, as with Ctrl+D.
    const clone = page.getByRole('button', { name: 'Select layer circle #dot-copy' })
    await clone.waitFor({ state: 'attached' })
    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await clone.focus()
    await page.keyboard.press('ContextMenu')
    await menu.getByRole('menuitem', { name: 'Supprimer le calque', exact: true }).focus()
    await page.keyboard.press('Enter')
    await waitForDisk(harness, 'rows.svg', text => !text.includes('id="dot-copy"'))
    await page.waitForFunction(() => !document.querySelector('[aria-label="Select layer circle #dot-copy"]') && document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    assert.equal(await page.getByRole('button', { name: 'Select canvas tool', exact: true }).evaluate(node => node === document.activeElement), true, 'deleting the trigger restores focus to a surviving canvas control')
    // Hold the real Host response while the user deliberately moves focus.
    let releaseResponse
    const released = new Promise(resolve => { releaseResponse = resolve })
    await page.route('**/design-studio-native/apply', async route => {
      const response = await route.fetch()
      await released
      await route.fulfill({ response })
    })
    await row.focus()
    await page.keyboard.press('ContextMenu')
    await menu.getByRole('menuitem', { name: 'Supprimer le calque', exact: true }).focus()
    await page.keyboard.press('Enter')
    const filter = page.getByRole('textbox', { name: 'Filter layers', exact: true })
    await filter.focus()
    releaseResponse()
    await waitForDisk(harness, 'rows.svg', text => !text.includes('id="dot"'))
    await page.waitForFunction(() => !document.querySelector('[aria-label="Select layer circle #dot"]') && document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    assert.equal(await filter.evaluate(node => node === document.activeElement), true, 'async completion does not steal deliberately moved focus')
    await page.unroute('**/design-studio-native/apply')
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

    // Source context is checked by the real Host, including an anonymous root.
    const group='<g id="parent" transform="translate(30 40)" fill="#aa2211"><rect id="child" x="1" y="2" width="20" height="10"/></g>'
    const nested='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">'+group+'</svg>'
    await harness.write('nested.svg',nested)
    await openWorkspaceFile(page,'nested.svg',{expect:'svg'})
    await page.getByRole('button',{name:'Select layer rect #child'}).click({button:'right'})
    await page.getByRole('menuitem',{name:'Copier le calque'}).click()
    await page.getByRole('alert').filter({hasText:'Copie refusée'}).waitFor()
    assert.ok((await page.getByRole('alert').innerText()).includes('groupe parent'))
    assert.equal(await page.locator('[data-created]').count(),0,'refusal clears stale copy success')
    assert.equal(await harness.read('nested.svg'),nested,'refused copy never changes source')
    assert.equal(await harness.read('cible.svg'),twice,'refused copy never changes target')

    // Refusal must not replace the previous root-card clipboard.
    await openWorkspaceFile(page,'cible.svg',{expect:'svg'})
    await page.getByRole('button',{name:'Select canvas tool'}).click()
    await page.keyboard.press('Control+v')
    await waitForDisk(harness,'cible.svg',text=>text.includes('id="card-copy-3"'))
    assert.equal(await harness.read('nested.svg'),nested)

    // The complete group keeps the transform and inherited fill inside its slice.
    await openWorkspaceFile(page,'nested.svg',{expect:'svg'})
    await page.getByRole('button',{name:'Select layer g #parent'}).click({button:'right'})
    await page.getByRole('menuitem',{name:'Copier le calque'}).click()
    await page.locator('[data-created]').filter({hasText:'Calque copié'}).waitFor()
    await openWorkspaceFile(page,'cible.svg',{expect:'svg'})
    await page.getByRole('button',{name:'Select canvas tool'}).click()
    await page.keyboard.press('Control+v')
    const withGroup=await waitForDisk(harness,'cible.svg',text=>text.includes('id="parent"'))
    assert.ok(withGroup.includes(group),'whole group exact bytes preserve transform and fill')
    assert.equal(await harness.read('nested.svg'),nested)

    // Root presentation is outside the slice too, even for a direct child.
    const styled=nested.replace('viewBox=','style="fill:blue" viewBox=')
    await harness.write('styled.svg',styled)
    await openWorkspaceFile(page,'styled.svg',{expect:'svg'})
    await page.getByRole('button',{name:'Select layer g #parent'}).click({button:'right'})
    await page.getByRole('menuitem',{name:'Copier le calque'}).click()
    await page.getByRole('alert').filter({hasText:'Copie refusée'}).waitFor()
    assert.equal(await harness.read('styled.svg'),styled)
    assert.equal(await harness.read('cible.svg'),withGroup)
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

    await page.keyboard.press('ArrowDown')
    assert.equal(await page.getByRole('menuitem', { name: 'Copier le calque' }).evaluate(node => node === document.activeElement), true)
    await page.keyboard.press('Space') // Native button activation, not canvas pan.
    assert.equal(await harness.read('vierge.svg'), SVG_DOCUMENT, 'Space copy does not write')
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

/**
 * Real pointer drag between layer rows.
 *
 * The row itself is the handle: a >4px pointer move starts the preview, the
 * sibling under the pointer is highlighted, and only pointerup sends the same
 * `svg-order` patch the menu and Ctrl+] use. These assertions read the real
 * bytes on disk and count real Host calls, so "no write before the drop" is not
 * inferred from the UI.
 */
/** Wait for the disk, then annotate a failure with the UI state that explains it. */
async function waitForDiskExplained(page, harness, file, predicate, label) {
  try {
    return await waitForDisk(harness, file, predicate, { label })
  } catch (error) {
    const alert = await page.getByRole('alert').innerText().catch(() => '')
    const notice = await page.locator('[data-created]').innerText().catch(() => '')
    const status = await page.locator('[data-layer-drop-status]').innerText().catch(() => '')
    const bytes = await harness.read(file).catch(() => null)
    const ids = bytes ? [...bytes.matchAll(/id="([a-z]+)"/g)].map((m) => m[1]).join(',') : 'none'
    throw new Error(`${error.message} | alert=${JSON.stringify(alert)} notice=${JSON.stringify(notice)} ` +
      `dropStatus=${JSON.stringify(status)} ids=${JSON.stringify(ids)}`)
  }
}

async function dragLayerRow(page, source, target, { steps = 8, beforeRelease = null } = {}) {
  const from = await source.boundingBox()
  const to = await target.boundingBox()
  if (!from || !to) throw new Error('layer row geometry unavailable')
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
  // A real pointer gesture: mouse.down → several mouse.move → mouse.up, so the
  // row's capture/preview logic is exercised exactly as a user would.
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(start.x + ((end.x - start.x) * step) / steps,
      start.y + ((end.y - start.y) * step) / steps)
    if (step === 2) {
      // Selecting the dragged row can scroll the layer list, so the target moves
      // under the pointer. Re-read it and finish on the live row, exactly as a
      // user aims at what they currently see.
      const live = await target.boundingBox()
      if (!live) throw new Error('layer row disappeared during the drag')
      end.x = live.x + live.width / 2
      end.y = live.y + live.height / 2
    }
  }
  if (beforeRelease) await beforeRelease()
  await page.mouse.up()
}

export const layerDragSpec = {
  name: 'drag: dropping a layer row sends one svg-order patch, never writes before the drop and refuses another parent',
  async run({ page, harness, assert }) {
    // Count the real Host mutations. Reading bytes alone could miss a write
    // that was refused, so both signals are asserted.
    let applies = 0
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/design-studio-native/apply')) applies += 1
    })
    const order = (text) => [...text.matchAll(/id="(bg|card|dot|title)"/g)].map((match) => match[1])
    const row = (name) => page.getByRole('button', { name, exact: true })

    // --- 1. hover, then a real drag: no write until the drop ----------------
    // A single-jump "flick" is handled in code (endLayerDrag judges by distance)
    // but is deliberately NOT asserted here: whether the engine delivers any
    // pointermove for one jump is timing dependent, and a flaky assertion would
    // weaken the gate. The multi-step gesture below is the asserted contract.
    await harness.write('glisser.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'glisser.svg', { expect: 'svg' })
    const bg = row('Select layer rect #bg')
    const card = row('Select layer rect #card')
    const dot = row('Select layer circle #dot')
    assert.deepEqual(order(await harness.read('glisser.svg')), ['bg', 'card', 'dot', 'title'])

    const beforeHover = applies
    await card.hover()
    await page.waitForTimeout(150)
    assert.equal(await harness.read('glisser.svg'), SVG_DOCUMENT, 'a simple hover must not write')
    assert.equal(applies, beforeHover, 'a simple hover must not call the Host')
    // A discrete grip marks the row as draggable without adding a tab stop.
    assert.equal(await bg.locator('.dsh-studio-grip').getAttribute('aria-hidden'), 'true')
    assert.equal(await bg.locator('.dsh-studio-grip').innerText(), '⠿')

    await dragLayerRow(page, bg, card, {
      beforeRelease: async () => {
        // The sibling under the pointer is the highlighted drop socket, and the
        // status names the one-step direction before anything is written.
        await page.waitForFunction(() =>
          document.querySelector('[data-layer-id="card"]')?.classList.contains('dsh-studio-drop-target'))
        const status = page.locator('[data-layer-drop-status]')
        await status.waitFor({ state: 'visible', timeout: 10000 })
        assert.match(await status.innerText(), /avancer d’un plan/)
        // Graphite stone/copper highlight and a real grabbing cursor, measured
        // on the live DOM rather than inferred from the class name.
        const targetPaint = await card.evaluate((node) => {
          const style = getComputedStyle(node)
          return { background: style.backgroundColor, cursor: style.cursor }
        })
        assert.equal(targetPaint.background, 'rgb(75, 64, 53)',
          'the drop socket must use the Graphite copper-stone surface, not a blue highlight')
        assert.equal(targetPaint.cursor, 'grabbing', 'the drop socket must show a grabbing cursor')
        assert.equal(await bg.evaluate((node) => getComputedStyle(node).opacity), '0.55',
          'the dragged row dims without touching the document')
        assert.equal(await harness.read('glisser.svg'), SVG_DOCUMENT, 'the drag itself must not write')
        assert.equal(applies, beforeHover, 'the drag itself must not call the Host')
      },
    })
    // A drop that refuses says why in the UI; surface it instead of only a
    // disk timeout, which would hide the real cause in a full-suite run.
    let dragged
    try {
      dragged = await waitForDiskExplained(page, harness, 'glisser.svg',
        (text) => JSON.stringify(order(text)) === JSON.stringify(['card', 'bg', 'dot', 'title']))
    } catch (error) {
      const alert = await page.getByRole('alert').innerText().catch(() => '')
      const notice = await page.locator('[data-created]').innerText().catch(() => '')
      throw new Error(error.message + ' | alert=' + JSON.stringify(alert) + ' notice=' + JSON.stringify(notice) +
        ' pressed=' + JSON.stringify(await bg.getAttribute('aria-pressed')))
    }
    assert.equal(applies, beforeHover + 1, 'the drop is exactly one Host write (svg-order)')
    // Untouched bytes survive and the moved layer keeps its exact slice.
    assert.ok(dragged.includes('<!-- editable demo; comments and unfamiliar attributes must survive -->'))
    assert.ok(dragged.includes('<rect id="bg" x="0" y="0" width="600" height="400" fill="#f4f1ea"/>'))
    assert.ok(dragged.includes('<rect id="card" x="40" y="40" width="240" height="140" fill="#bda991" rx="8" data-note="keep-me"/>'))
    assert.ok(dragged.includes('<circle id="dot" cx="420" cy="120" r="48" fill="#3a3f45"/>'))
    assert.ok(dragged.includes('<text id="title" x="60" y="230" font-family="Inter" font-size="28" fill="#202124">Title</text>'))

    // The drop leaves the selection on the row the user dragged, never on the
    // socket it happened to land on.
    assert.equal(await bg.getAttribute('aria-pressed'), 'true',
      'the dragged layer stays selected after the drop')
    assert.equal(await card.getAttribute('aria-pressed'), 'false',
      'the drop socket must not steal the selection')

    // --- 1b. a distant sibling is not a socket: one drop is exactly one rank --
    const beforeDistant = applies
    const bytesAtDistant = await harness.read('glisser.svg')
    await dragLayerRow(page, row('Select layer rect #bg'), row('Select layer text #title'), {
      beforeRelease: async () => {
        await page.waitForFunction(() =>
          document.querySelector('[data-layer-id="title"]')?.classList.contains('dsh-studio-drop-refused'))
        assert.match(await page.locator('[data-layer-drop-status]').innerText(), /voisin/)
      },
    })
    await page.getByRole('alert').filter({ hasText: 'voisin' })
      .waitFor({ state: 'visible', timeout: 10000 })
    assert.equal(await harness.read('glisser.svg'), bytesAtDistant,
      'a distant socket must be refused instead of promising an unreachable position')
    assert.equal(applies, beforeDistant, 'a refused distant drop must not call the Host')

    // --- 1c. Escape cancels the gesture without writing ----------------------
    const beforeEscape = applies
    const bytesAtEscape = await harness.read('glisser.svg')
    await dragLayerRow(page, row('Select layer rect #bg'), row('Select layer rect #card'), {
      beforeRelease: async () => {
        await page.waitForFunction(() =>
          document.querySelector('[data-layer-id="card"]')?.classList.contains('dsh-studio-drop-target'))
        await page.keyboard.press('Escape')
        await page.waitForFunction(() => !document.querySelector('[data-layer-drop-status]'),
          null, { timeout: 10000 })
      },
    })
    assert.equal(await harness.read('glisser.svg'), bytesAtEscape, 'Escape must cancel the drop without writing')
    assert.equal(applies, beforeEscape, 'Escape must not call the Host')

    // --- 2. Undo restores the exact original bytes --------------------------
    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    await waitForDiskExplained(page, harness, 'glisser.svg', (text) => text === SVG_DOCUMENT)
    assert.equal(await harness.read('glisser.svg'), SVG_DOCUMENT, 'Undo restores the original bytes exactly')
    assert.equal(applies, beforeHover + 2, 'Undo is one more Host call')

    // --- 3. dropping on the same row writes nothing -------------------------
    const beforeSameLine = applies
    const dotBox = await dot.boundingBox()
    const centre = { x: dotBox.x + dotBox.width / 2, y: dotBox.y + dotBox.height / 2 }
    await page.mouse.move(centre.x, centre.y)
    await page.mouse.down()
    await page.mouse.move(centre.x, centre.y + 9)
    await page.mouse.move(centre.x + 14, centre.y + 3)
    await page.waitForFunction(() =>
      document.querySelector('[data-layer-drop-status]')?.textContent.includes('Même ligne'))
    assert.equal(await harness.read('glisser.svg'), SVG_DOCUMENT, 'no write while dragging on the same row')
    await page.mouse.up()
    await page.locator('[data-created]').filter({ hasText: 'lui-même' })
      .waitFor({ state: 'visible', timeout: 10000 })
    await page.waitForTimeout(200)
    assert.equal(await harness.read('glisser.svg'), SVG_DOCUMENT, 'a same-row drop must not write')
    assert.equal(applies, beforeSameLine, 'a same-row drop must not call the Host')

    // --- 4. different parents: explicit refusal, byte-identical file --------
    const nested = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <g id="gauche">
    <rect id="un" x="20" y="20" width="100" height="60" fill="#ccbbaa"/>
    <rect id="deux" x="20" y="100" width="100" height="60" fill="#bbaa99"/>
  </g>
  <g id="droite">
    <rect id="trois" x="300" y="20" width="100" height="60" fill="#aa9988"/>
    <rect id="quatre" x="300" y="100" width="100" height="60" fill="#998877"/>
  </g>
</svg>
`
    await harness.write('parents.svg', nested)
    await openWorkspaceFile(page, 'parents.svg', { expect: 'svg' })
    const beforeCross = applies
    await dragLayerRow(page, row('Select layer rect #un'), row('Select layer rect #trois'), {
      beforeRelease: async () => {
        await page.waitForFunction(() =>
          document.querySelector('[data-layer-id="trois"]')?.classList.contains('dsh-studio-drop-refused'))
        assert.match(await page.locator('[data-layer-drop-status]').innerText(), /Parents différents/)
        const refused = await page.locator('[data-layer-id="trois"]').evaluate((node) => {
          const style = getComputedStyle(node)
          return { background: style.backgroundColor, cursor: style.cursor }
        })
        assert.equal(refused.background, 'rgb(61, 47, 45)',
          'the refused socket must use the muted error surface, not an applied highlight')
        assert.equal(refused.cursor, 'not-allowed', 'the refused socket must show a not-allowed cursor')
        assert.equal(await harness.read('parents.svg'), nested, 'a cross-parent preview must not write')
      },
    })
    await page.getByRole('alert').filter({ hasText: 'Parents différents' })
      .waitFor({ state: 'visible', timeout: 10000 })
    assert.equal(await harness.read('parents.svg'), nested,
      'a cross-parent drop must leave the file byte-identical')
    assert.equal(await harness.read('glisser.svg'), SVG_DOCUMENT)
    assert.equal(applies, beforeCross, 'a cross-parent drop must not call the Host')

    // --- 5. locked source: explicit refusal, no write -----------------------
    const lockedDocument = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <rect id="fixe" data-locked="true" x="20" y="20" width="120" height="80" fill="#ccbbaa"/>
  <rect id="mobile" x="200" y="20" width="120" height="80" fill="#bbaa99"/>
</svg>
`
    await harness.write('verrouille.svg', lockedDocument)
    await openWorkspaceFile(page, 'verrouille.svg', { expect: 'svg' })
    const beforeLocked = applies
    await dragLayerRow(page, row('Select layer rect #fixe (locked)'), row('Select layer rect #mobile'), {
      beforeRelease: async () => {
        assert.match(await page.locator('[data-layer-drop-status]').innerText(), /verrouillé/)
      },
    })
    await page.getByRole('alert').filter({ hasText: 'verrouillé' })
      .waitFor({ state: 'visible', timeout: 10000 })
    assert.equal(await harness.read('verrouille.svg'), lockedDocument,
      'a locked layer must never be reordered')
    assert.equal(applies, beforeLocked, 'a locked layer drop must not call the Host')

    // --- 6. root layer: explicit refusal, no write --------------------------
    const rootDocument = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" id="racine" width="300" height="200" viewBox="0 0 300 200">
  <rect id="enfant" x="20" y="20" width="120" height="80" fill="#ccbbaa"/>
</svg>
`
    await harness.write('racine.svg', rootDocument)
    await openWorkspaceFile(page, 'racine.svg', { expect: 'svg' })
    const beforeRoot = applies
    await dragLayerRow(page, row('Select layer svg #racine'), row('Select layer rect #enfant'))
    await page.getByRole('alert').filter({ hasText: 'racine SVG' })
      .waitFor({ state: 'visible', timeout: 10000 })
    assert.equal(await harness.read('racine.svg'), rootDocument, 'the SVG root must never be reordered')
    assert.equal(applies, beforeRoot, 'a root drop must not call the Host')

    // --- 7. drag is not the only path: the shortcuts still reorder ----------
    await openWorkspaceFile(page, 'glisser.svg', { expect: 'svg' })
    const keyboardCard = row('Select layer rect #card')
    await keyboardCard.click()
    await keyboardCard.focus()
    const beforeKeyboard = applies
    await page.keyboard.press('Control+]')
    const forwarded = await waitForDiskExplained(page, harness, 'glisser.svg',
      (text) => JSON.stringify(order(text)) === JSON.stringify(['bg', 'dot', 'card', 'title']))
    assert.ok(forwarded.includes('<rect id="card" x="40" y="40" width="240" height="140" fill="#bda991" rx="8" data-note="keep-me"/>'))
    assert.equal(applies, beforeKeyboard + 1, 'Ctrl+] keeps using the same single Host path')
    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await page.keyboard.press('Control+[')
    await waitForDiskExplained(page, harness, 'glisser.svg',
      (text) => JSON.stringify(order(text)) === JSON.stringify(['bg', 'card', 'dot', 'title']))
    assert.equal(await harness.read('glisser.svg'), SVG_DOCUMENT,
      'the keyboard round trip is byte-exact too')

    // --- 7b. backward drag moves the other way, still one atomic patch -------
    const beforeBackward = applies
    // card (index 1) onto bg (index 0) is an adjacent *backward* move and sits at
    // the top of the list, so the gesture never depends on scroll position.
    await dragLayerRow(page, row('Select layer rect #card'), row('Select layer rect #bg'))
    const backwards = await waitForDiskExplained(page, harness, 'glisser.svg',
      (text) => JSON.stringify(order(text)) === JSON.stringify(['card', 'bg', 'dot', 'title']))
    assert.ok(backwards.includes('<circle id="dot" cx="420" cy="120" r="48" fill="#3a3f45"/>'),
      'the moved layer keeps its exact bytes')
    assert.ok(applies > beforeBackward, 'a backward drop reaches the Host')
    assert.ok(applies - beforeBackward <= 1, 'a backward drop is at most one Host write: ' + (applies - beforeBackward))
    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    await waitForDiskExplained(page, harness, 'glisser.svg', (text) => text === SVG_DOCUMENT)

    // --- 8. an unsaved text draft blocks the drop, like every other action ---
    // The draft lives only in memory; a drag must not bypass it and write.
    await row('Select layer text #title').click()
    const textDraft = page.getByLabel('Text content', { exact: true })
    await textDraft.fill('Brouillon non enregistré')
    const beforeDraft = applies
    await dragLayerRow(page, row('Select layer rect #bg'), row('Select layer rect #card'), {
      beforeRelease: async () => {
        assert.equal(await harness.read('glisser.svg'), SVG_DOCUMENT,
          'a pending text draft must not be flushed by the drag preview')
      },
    })
    await page.getByRole('alert').filter({ hasText: 'Texte non enregistré' })
      .waitFor({ state: 'visible', timeout: 10000 })
    assert.equal(await harness.read('glisser.svg'), SVG_DOCUMENT,
      'an unsaved text draft must refuse the drop without writing')
    assert.equal(applies, beforeDraft, 'a draft refusal must not call the Host')
    assert.equal(await textDraft.inputValue(), 'Brouillon non enregistré', 'the draft is preserved, not discarded')
  },
}

/**
 * Rename a layer directly from the layer list.
 *
 * Every spec edits a real file through the real Host and asserts the bytes on
 * disk: one POST, one exact id span, byte-identical Undo. Client pre-checked
 * refusals are proven to send no request at all; a Host-only refusal (CSS
 * selector, ARIA, SMIL, encoded entity) is proven to send exactly one request,
 * write nothing, and keep the typed value in the field.
 */
import {
  SVG_DOCUMENT, assertSingleDifferingRange, diffWindow, openWorkspaceFile, waitForDisk,
} from './helpers.mjs'

const RENAME_INPUT = '[data-layer-rename-input]'

function countApplies(page) {
  let count = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/design-studio-native/apply')) count += 1
  })
  return () => count
}

export const renameLayerSpec = {
  name: 'rename: double-clicking a layer row writes only the id and Undo/Redo restore the exact bytes',
  async run({ page, harness, assert }) {
    const applies = countApplies(page)
    await harness.write('renommer.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'renommer.svg', { expect: 'svg' })

    const row = page.getByRole('button', { name: 'Select layer rect #card', exact: true })
    await row.dblclick()
    const input = page.locator(RENAME_INPUT)
    await input.waitFor({ state: 'visible', timeout: 10000 })
    assert.equal(await input.inputValue(), 'card', 'the inline editor starts from the current id')
    assert.equal(await input.getAttribute('aria-label'), 'Nouveau nom du calque #card')
    assert.equal(await input.evaluate((node) => node === document.activeElement), true,
      'the inline editor must take focus')
    assert.equal(await harness.read('renommer.svg'), SVG_DOCUMENT, 'opening the editor must not write')
    assert.equal(applies(), 0, 'opening the editor must not call the Host')

    await input.fill('panneau')
    await input.press('Enter')
    const renamed = await waitForDisk(harness, 'renommer.svg', (text) => text.includes('id="panneau"'),
      { label: 'rename card→panneau' })

    // One differing range, and it is the id value: no other byte moved.
    const window = assertSingleDifferingRange(assert, SVG_DOCUMENT, renamed, 'rename card→panneau')
    assert.equal(window.before, 'card')
    assert.equal(window.after, 'panneau')
    assert.equal(renamed, SVG_DOCUMENT.replace('id="card"', 'id="panneau"'))
    assert.ok(renamed.includes('data-note="keep-me"'), 'unrelated attributes survive')
    assert.equal(applies(), 1, 'a rename is exactly one Host write')

    // The tree and the selection follow the new name; the old one is gone.
    const renamedRow = page.getByRole('button', { name: 'Select layer rect #panneau', exact: true })
    await renamedRow.waitFor({ state: 'attached' })
    await page.waitForFunction(() => document.querySelector('[data-layer-id="panneau"]')?.getAttribute('aria-pressed') === 'true')
    assert.equal(await page.getByRole('button', { name: 'Select layer rect #card', exact: true }).count(), 0,
      'the old id must no longer be selectable')
    assert.equal(await page.locator(RENAME_INPUT).count(), 0, 'a successful rename closes the editor')
    assert.ok((await page.locator('[data-created]').innerText()).includes('Calque renommé'),
      'the rename is confirmed to the user')

    // Undo restores the original bytes and the selection follows the old name.
    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    await waitForDisk(harness, 'renommer.svg', (text) => text === SVG_DOCUMENT, { label: 'undo rename' })
    assert.equal(await harness.read('renommer.svg'), SVG_DOCUMENT, 'Undo restores the file byte for byte')
    assert.equal(applies(), 2, 'Undo is one more Host write')
    await page.waitForFunction(() => document.querySelector('[data-layer-id="card"]')?.getAttribute('aria-pressed') === 'true')
    assert.equal(await page.getByRole('button', { name: 'Select layer rect #panneau', exact: true }).count(), 0)

    // Redo applies the same rename again, one write, not a second edit path.
    await page.waitForFunction(() => document.querySelector('[aria-label="Redo saved edit"]')?.disabled === false)
    await page.getByRole('button', { name: 'Redo saved edit' }).click()
    await waitForDisk(harness, 'renommer.svg', (text) => text === renamed, { label: 'redo rename' })
    assert.equal(applies(), 3, 'Redo is one more Host write')
    await page.waitForFunction(() => document.querySelector('[data-layer-id="panneau"]')?.getAttribute('aria-pressed') === 'true')
  },
}

export const renameMenuSpec = {
  name: 'rename: the layer menu entry renames the right-clicked layer and Escape cancels without writing',
  async run({ page, harness, assert }) {
    const applies = countApplies(page)
    await harness.write('menu-renommer.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'menu-renommer.svg', { expect: 'svg' })

    const dotRow = page.getByRole('button', { name: 'Select layer circle #dot', exact: true })
    await dotRow.click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Actions du calque' })
    await menu.waitFor({ state: 'visible', timeout: 20000 })
    const entry = menu.getByRole('menuitem', { name: 'Renommer le calque' })
    assert.equal(await entry.isDisabled(), false, 'a normal layer offers the rename entry')
    await entry.click()

    const input = page.locator(RENAME_INPUT)
    await input.waitFor({ state: 'visible', timeout: 10000 })
    assert.equal(await input.inputValue(), 'dot', 'the menu targets the right-clicked layer')
    await input.fill('brouillon')
    await page.keyboard.press('Escape')
    assert.equal(await page.locator(RENAME_INPUT).count(), 0, 'Escape closes the inline editor')
    assert.equal(await harness.read('menu-renommer.svg'), SVG_DOCUMENT, 'Escape must not write')
    assert.equal(applies(), 0, 'Escape must not call the Host')
    await page.waitForFunction(() => document.activeElement?.closest?.('[data-layer-id="dot"]'))
    assert.equal(await page.getByRole('button', { name: 'Select layer circle #dot', exact: true })
      .evaluate((node) => node === document.activeElement), true, 'Escape restores focus to the row')

    // Blur (Tab) is a cancellation too: the field closes and nothing is written.
    await dotRow.click({ button: 'right' })
    await menu.getByRole('menuitem', { name: 'Renommer le calque' }).click()
    const blurred = page.locator(RENAME_INPUT)
    await blurred.waitFor({ state: 'visible', timeout: 10000 })
    await blurred.fill('brouillon')
    await page.keyboard.press('Tab')
    await page.waitForFunction(() => !document.querySelector('[data-layer-rename-input]'))
    assert.equal(await harness.read('menu-renommer.svg'), SVG_DOCUMENT, 'blur must not write')
    assert.equal(applies(), 0, 'blur must not call the Host')

    await dotRow.click({ button: 'right' })
    await menu.getByRole('menuitem', { name: 'Renommer le calque' }).click()
    const second = page.locator(RENAME_INPUT)
    await second.waitFor({ state: 'visible', timeout: 10000 })
    await second.fill('pastille')
    await second.press('Enter')
    const renamed = await waitForDisk(harness, 'menu-renommer.svg', (text) => text.includes('id="pastille"'),
      { label: 'menu rename dot→pastille' })
    assert.equal(applies(), 1, 'the menu rename is exactly one Host write')
    const diff = diffWindow(SVG_DOCUMENT, renamed)
    assert.equal(diff.before, 'dot')
    assert.equal(diff.after, 'pastille')
    assert.equal(renamed, SVG_DOCUMENT.replace('id="dot"', 'id="pastille"'))
    await page.waitForFunction(() => document.querySelector('[data-layer-id="pastille"]')?.getAttribute('aria-pressed') === 'true')
    assert.equal(await page.getByRole('button', { name: 'Select layer circle #dot', exact: true }).count(), 0)
  },
}

/**
 * A Host-only refusal: the client pre-check does not read CSS selectors, so
 * this is the one path that MUST send a request and still write nothing. The
 * inline field keeps the typed value and focus; the user can fix it in place.
 */
export const renameHostRefusalSpec = {
  name: 'rename: a CSS-only reference is refused by the Host and keeps the field open with its value',
  // The refused save is a real 400; Chromium logs it as a resource error.
  allowConsoleErrors: 'refusals',
  async run({ page, harness, assert }) {
    const applies = countApplies(page)
    const DOCUMENT = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
  <rect id="card" x="20" y="20" width="100" height="60" fill="#bda991"/>
  <circle id="dot" cx="240" cy="60" r="24" fill="#3a3f45"/>
  <style>#dot:hover{opacity:.5}</style>
</svg>
`
    await harness.write('css-ref.svg', DOCUMENT)
    await openWorkspaceFile(page, 'css-ref.svg', { expect: 'svg' })

    const row = page.getByRole('button', { name: 'Select layer circle #dot', exact: true })
    await row.dblclick()
    const input = page.locator(RENAME_INPUT)
    await input.waitFor({ state: 'visible', timeout: 10000 })
    await input.fill('pastille')
    await input.press('Enter')

    // The Host names the reference kind; the client could not know it.
    await page.getByRole('alert').filter({ hasText: 'referenced' })
      .waitFor({ state: 'visible', timeout: 10000 })
    assert.equal(applies(), 1, 'a CSS selector is only detectable by the Host: exactly one request')
    assert.equal(await harness.read('css-ref.svg'), DOCUMENT, 'a Host refusal writes nothing')
    assert.equal(await page.locator(RENAME_INPUT).count(), 1, 'the field stays open after a Host refusal')
    assert.equal(await input.inputValue(), 'pastille', 'the typed value survives the Host refusal')
    await page.waitForFunction(() => document.activeElement?.matches?.('[data-layer-rename-input]') === true)

    await input.press('Escape')
    assert.equal(await page.locator(RENAME_INPUT).count(), 0, 'Escape still leaves the refused editor')
    assert.equal(applies(), 1, 'closing after a refusal sends nothing else')
  },
}

/**
 * Undo of a rename must rewrite the multi-selection too, not only the active
 * id. Otherwise the new id stays selected next to the restored old one and the
 * next alignment refuses with "Un calque sélectionné n'existe plus".
 */
export const renameUndoSelectionSpec = {
  name: 'rename: Undo of a multi-selection rename leaves no phantom id and alignment still works',
  async run({ page, harness, assert }) {
    const applies = countApplies(page)
    const DOCUMENT = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
  <rect id="card" x="20" y="20" width="60" height="40" fill="#bda991"/>
  <rect id="dot" x="140" y="90" width="60" height="40" fill="#8a9a7b"/>
</svg>
`
    await harness.write('selection.svg', DOCUMENT)
    await openWorkspaceFile(page, 'selection.svg', { expect: 'svg' })

    const button = (name) => page.getByRole('button', { name, exact: true })
    const layer = (tag, id) => page.getByRole('button', {
      name: new RegExp('^Select layer ' + tag + ' #' + id + '(?: \\((?:hidden|locked|in selection)\\))*$'),
    })

    // One plain selection, then Ctrl-click: `dot` becomes active and `card`
    // stays in extraSelection. The menu entry renames the active row without
    // dropping that multi-selection (a double-click would select again).
    await layer('rect', 'card').click()
    await layer('rect', 'dot').click({ modifiers: ['ControlOrMeta'] })
    await layer('rect', 'dot').click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Actions du calque' })
    await menu.waitFor({ state: 'visible', timeout: 20000 })
    await menu.getByRole('menuitem', { name: 'Renommer le calque' }).click()
    const input = page.locator(RENAME_INPUT)
    await input.waitFor({ state: 'visible', timeout: 10000 })
    assert.equal(await input.inputValue(), 'dot')
    await input.fill('pastille')
    await input.press('Enter')
    await waitForDisk(harness, 'selection.svg', (text) => text.includes('id="pastille"'),
      { label: 'rename dot→pastille' })
    assert.equal(applies(), 1, 'the rename is one Host write')

    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await button('Undo saved edit').click()
    await waitForDisk(harness, 'selection.svg', (text) => text === DOCUMENT, { label: 'undo rename' })
    assert.equal(applies(), 2, 'Undo is one Host write')

    // The restored selection must only name ids that exist.
    await page.waitForFunction(() => document.querySelector('[data-layer-id="dot"]')?.getAttribute('aria-pressed') === 'true')
    assert.equal(await page.locator('[data-layer-id="pastille"]').count(), 0,
      'the replayed document no longer contains the new id')
    const reason = await page.locator('[data-align-reason]').innerText()
    assert.ok(!reason.includes("n'existe plus") && !reason.includes('n’existe plus'),
      'no phantom selection: ' + reason)
    assert.equal(await button('Aligner à gauche').isDisabled(), false,
      'the restored multi-selection is still alignable')

    // Prove it with one real alignment write, not just an enabled button.
    const beforeAlign = await harness.read('selection.svg')
    await button('Aligner à gauche').click()
    const aligned = await waitForDisk(harness, 'selection.svg', (text) => text !== beforeAlign,
      { label: 'align after undo' })
    assert.equal(applies(), 3, 'the alignment is one more Host write')
    assert.ok(aligned.includes('<rect id="dot" x="20"'), 'the restored layer moved to the common left edge')
  },
}

export const renameRefusalSpec = {
  name: 'rename: collisions, referenced ids, locked rows and invalid names are refused without a request',
  async run({ page, harness, assert }) {
    const applies = countApplies(page)
    const DOCUMENT = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
  <rect id="bg" x="0" y="0" width="320" height="200" fill="#f4f1ea"/>
  <rect id="card" x="20" y="20" width="100" height="60" fill="#bda991"/>
  <circle id="dot" cx="240" cy="60" r="24" fill="#3a3f45"/>
  <use href="#dot" x="0" y="0"/>
  <rect id="fixe" data-locked="true" x="20" y="120" width="100" height="40" fill="#8a9a7b"/>
  <text id="label" x="150" y="180" font-family="Inter" font-size="14" fill="#202124">Label</text>
</svg>
`
    await harness.write('refus.svg', DOCUMENT)
    await openWorkspaceFile(page, 'refus.svg', { expect: 'svg' })

    const row = (name) => page.getByRole('button', { name, exact: true })
    const alert = (text) => page.getByRole('alert').filter({ hasText: text })
    const input = page.locator(RENAME_INPUT)

    // 1. Collision with an existing id: explained, no input, no request.
    await row('Select layer rect #card').dblclick()
    await input.waitFor({ state: 'visible', timeout: 10000 })
    await input.fill('dot')
    await input.press('Enter')
    await alert('collision').waitFor({ state: 'visible', timeout: 10000 })
    assert.ok((await page.getByRole('alert').innerText()).includes('porte déjà le nom'),
      'the collision message names the reason')
    assert.equal(await input.inputValue(), 'dot', 'the refused value stays editable')
    assert.equal(await harness.read('refus.svg'), DOCUMENT, 'a collision must not write')
    assert.equal(applies(), 0, 'a collision must not call the Host')
    await input.press('Escape')
    assert.equal(await input.count(), 0)

    // 2. The old id is referenced (`<use href="#dot">`): refused, never rewritten.
    await row('Select layer circle #dot').dblclick()
    await input.waitFor({ state: 'visible', timeout: 10000 })
    await input.fill('pastille')
    await input.press('Enter')
    await alert('référencé').waitFor({ state: 'visible', timeout: 10000 })
    assert.equal(await harness.read('refus.svg'), DOCUMENT, 'a referenced id must not be renamed')
    assert.equal(applies(), 0, 'a referenced id must not reach the Host')
    assert.ok((await harness.read('refus.svg')).includes('<use href="#dot"'), 'the reference is untouched')
    await input.press('Escape')

    // 3. Invalid name: explicit message, no request.
    await row('Select layer rect #bg').dblclick()
    await input.waitFor({ state: 'visible', timeout: 10000 })
    await input.fill('1 nom invalide')
    await input.press('Enter')
    await alert('Nom invalide').waitFor({ state: 'visible', timeout: 10000 })
    assert.equal(await harness.read('refus.svg'), DOCUMENT)
    assert.equal(applies(), 0, 'an invalid name must not reach the Host')
    await input.press('Escape')

    // 4. Identical name: no cosmetic rewrite.
    await row('Select layer rect #bg').dblclick()
    await input.waitFor({ state: 'visible', timeout: 10000 })
    await input.press('Enter')
    await alert('identique').waitFor({ state: 'visible', timeout: 10000 })
    assert.equal(await harness.read('refus.svg'), DOCUMENT)
    assert.equal(applies(), 0)
    await input.press('Escape')

    // 5. A locked layer never opens the editor: it explains why.
    await row('Select layer rect #fixe (locked)').dblclick()
    await alert('verrouillé').waitFor({ state: 'visible', timeout: 10000 })
    assert.equal(await page.locator(RENAME_INPUT).count(), 0, 'a locked row does not open a dead editor')
    assert.equal(await harness.read('refus.svg'), DOCUMENT)
    assert.equal(applies(), 0, 'a locked row must not call the Host')

    // 6. An unsaved text draft is another pending state: rename refuses instead
    // of discarding the draft, and still sends nothing.
    await row('Select layer text #label').click()
    const textField = page.getByLabel('Text content', { exact: true })
    await textField.fill('Brouillon non enregistré')
    await row('Select layer rect #card').dblclick()
    await alert('Modifications non enregistrées').waitFor({ state: 'visible', timeout: 10000 })
    assert.equal(await page.locator(RENAME_INPUT).count(), 0, 'a pending draft does not open the editor')
    assert.equal(await harness.read('refus.svg'), DOCUMENT, 'the draft never flushes to disk')
    assert.equal(applies(), 0, 'a draft refusal must not call the Host')
    assert.equal(await textField.inputValue(), 'Brouillon non enregistré', 'the draft is preserved')
  },
}

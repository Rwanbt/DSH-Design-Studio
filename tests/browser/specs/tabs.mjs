/**
 * Document tabs (ADR-034) in real browsers.
 *
 * These specs drive the real UI against the real Host route handler and a real
 * temporary filesystem, in Chromium and Firefox. They prove the two properties a
 * user depends on when several documents are open:
 *
 *  - a tab owns its own state: switching tabs restores the unsaved source and
 *    never writes, never reads another file and never discards work;
 *  - an explicit save always targets the ACTIVE tab's file, and the bytes of the
 *    other open document are untouched.
 *
 * They also cover the confirmation that names a modified file before closing
 * its tab, and the keyboard model (arrows move, Enter activates, aria-selected
 * reports the real state).
 */
import { SVG_DOCUMENT, openWorkspaceFile, sourceOf, waitForDisk } from './helpers.mjs'

const SECOND = SVG_DOCUMENT.replace('fill="#bda991"', 'fill="#2277cc"')
if (SECOND === SVG_DOCUMENT) throw new Error('the second fixture must differ from the first')

const applies = (harness) => harness.requests.filter((request) => request.path.endsWith('/apply'))
const documentsTablist = (page) => page.getByRole('tablist', { name: 'Documents ouverts' })
const tabNamed = (page, file) => documentsTablist(page).getByRole('tab', { name: new RegExp('^' + file.replace('.', '\\.')) })

/** Open the advanced native source panel so the textarea is visible. */
async function revealSource(page) {
  await page.locator('summary').filter({ hasText: 'Code source natif' }).click()
  await page.locator('.dsh-studio-source textarea').waitFor({ state: 'visible', timeout: 10000 })
}

/** Wait until the newly opened file is the active document. */
async function waitForActiveFile(page, file) {
  await page.waitForFunction((name) =>
    document.querySelector('.dsh-studio-stage-top')?.innerText.includes(name), file, { timeout: 20000 })
  await page.waitForFunction((name) =>
    [...document.querySelectorAll('.dsh-studio-doc-tabs [role="tab"]')]
      .some((tab) => String(tab.getAttribute('aria-label')).startsWith(name) &&
        tab.getAttribute('aria-selected') === 'true'),
  file, { timeout: 20000 })
}

export const tabsSwitchSpec = {
  name: 'tab: switching between two open documents keeps the unsaved edit and writes nothing',
  async run({ page, harness, assert }) {
    await harness.write('a.svg', SVG_DOCUMENT)
    await harness.write('b.svg', SECOND)
    await openWorkspaceFile(page, 'a.svg', { expect: 'svg' })
    await revealSource(page)
    const edited = SVG_DOCUMENT.replace('Title', 'Edited in tab A')
    assert.ok(edited !== SVG_DOCUMENT, 'the edit must really change the source')
    await page.locator('.dsh-studio-source textarea').fill(edited)
    assert.equal(await page.getByRole('tab', { name: /^a\.svg/ }).getAttribute('aria-label'),
      'a.svg · modifications non enregistrées', 'the modified tab advertises its pending work')
    const writesBefore = applies(harness).length

    // Opening a second file must create a tab, not replace the first document
    // and not silently save it.
    await openWorkspaceFile(page, 'b.svg', { expect: 'svg' })
    await waitForActiveFile(page, 'b.svg')
    assert.equal(applies(harness).length, writesBefore,
      'opening another file in a new tab must not send any /apply')
    assert.equal(await page.getByRole('alert').count(), 0,
      'unsaved work in another tab is not an error: it is preserved')
    assert.equal(await harness.read('a.svg'), SVG_DOCUMENT,
      'the file of the first tab must still hold its original bytes')
    assert.equal(await documentsTablist(page).getByRole('tab').count(), 2,
      'both documents are open as tabs')
    assert.equal(await tabNamed(page, 'a.svg').getAttribute('aria-label'),
      'a.svg · modifications non enregistrées', 'the inactive tab keeps its dirty marker')
    assert.equal(await tabNamed(page, 'b.svg').getAttribute('aria-selected'), 'true')

    // Returning to the first tab restores the unsaved source exactly.
    await tabNamed(page, 'a.svg').click()
    await waitForActiveFile(page, 'a.svg')
    assert.equal(await sourceOf(page), edited, 'the unsaved edit is still there after the round trip')
    assert.equal(await page.getByLabel('Workspace file').inputValue(), 'a.svg',
      'the open path follows the active tab')
    assert.equal(await tabNamed(page, 'a.svg').getAttribute('aria-selected'), 'true')
    assert.equal(applies(harness).length, writesBefore, 'switching tabs must never write')
    assert.equal(await harness.read('a.svg'), SVG_DOCUMENT)
    assert.equal(await harness.read('b.svg'), SECOND)
  },
}

export const tabsSaveIsolationSpec = {
  name: 'tab: saving writes exactly one POST to the active document and the other file stays intact',
  async run({ page, harness, assert }) {
    await harness.write('a.svg', SVG_DOCUMENT)
    await harness.write('b.svg', SECOND)
    await openWorkspaceFile(page, 'a.svg', { expect: 'svg' })
    await openWorkspaceFile(page, 'b.svg', { expect: 'svg' })
    await waitForActiveFile(page, 'b.svg')
    await revealSource(page)

    const edited = SECOND.replace('fill="#2277cc"', 'fill="#998877"')
    assert.ok(edited !== SECOND, 'the second edit must really change the source')
    await page.locator('.dsh-studio-source textarea').fill(edited)
    const writesBefore = applies(harness).length
    const saved = page.waitForResponse((value) => value.url().includes('/design-studio-native/apply'))
    await page.getByRole('button', { name: 'Save source' }).click()
    const response = await saved
    assert.equal(response.status(), 200)
    assert.equal(await waitForDisk(harness, 'b.svg', (content) => content === edited,
      { label: 'save of the active tab' }), edited)

    assert.equal(applies(harness).length, writesBefore + 1,
      'an explicit save is exactly one POST')
    assert.equal(response.request().postDataJSON().file, 'b.svg',
      'the single POST targets the active tab file')
    assert.equal(await harness.read('a.svg'), SVG_DOCUMENT,
      'the other open document must be byte-identical to its own content')
    // The Host writes before answering, so wait for the client's reload before
    // reading the tab marker: the dot must clear once the bytes match disk.
    await page.waitForFunction((name) => {
      const tab = [...document.querySelectorAll('.dsh-studio-doc-tabs [role="tab"]')]
        .find((item) => String(item.getAttribute('aria-label')).startsWith(name))
      return tab?.getAttribute('aria-label') === name
    }, 'b.svg', { timeout: 15000 })
    assert.equal(await tabNamed(page, 'b.svg').getAttribute('aria-label'), 'b.svg',
      'a saved tab stops advertising unsaved changes')
    assert.equal(await tabNamed(page, 'a.svg').getAttribute('aria-label'), 'a.svg',
      'the other tab was never modified')
  },
}

export const tabsCloseConfirmSpec = {
  name: 'tab: closing a modified tab asks first, cancelling keeps it and its bytes unchanged',
  async run({ page, harness, assert }) {
    await harness.write('a.svg', SVG_DOCUMENT)
    await harness.write('b.svg', SECOND)
    await openWorkspaceFile(page, 'a.svg', { expect: 'svg' })
    await revealSource(page)
    const edited = SVG_DOCUMENT.replace('Title', 'Do not lose me')
    await page.locator('.dsh-studio-source textarea').fill(edited)
    const writesBefore = applies(harness).length

    // Closing the ACTIVE modified tab is a question that names the file.
    await page.getByRole('button', { name: 'Fermer a.svg' }).click()
    const dialog = page.getByRole('alertdialog')
    await dialog.waitFor({ state: 'visible', timeout: 10000 })
    const question = await dialog.innerText()
    assert.ok(question.includes('a.svg'), 'the confirmation must name the exact file: ' + JSON.stringify(question))
    assert.equal(await documentsTablist(page).getByRole('tab').count(), 1,
      'asking the question must not close the tab')
    assert.equal(await harness.read('a.svg'), SVG_DOCUMENT, 'asking must not write')

    // Refusing leaves the tab, its draft and the bytes intact.
    await dialog.getByRole('button', { name: 'Annuler' }).click()
    assert.equal(await page.getByRole('alertdialog').count(), 0, 'cancelling closes the question')
    assert.equal(await documentsTablist(page).getByRole('tab').count(), 1, 'cancelling keeps the tab')
    assert.equal(await sourceOf(page), edited, 'cancelling keeps the unsaved edit')
    assert.equal(await harness.read('a.svg'), SVG_DOCUMENT, 'cancelling writes nothing')
    assert.equal(applies(harness).length, writesBefore, 'no /apply may be sent by a close')

    // A dirty BACKGROUND tab is protected the same way, and confirming discards
    // only that tab without writing.
    await openWorkspaceFile(page, 'b.svg', { expect: 'svg' })
    await waitForActiveFile(page, 'b.svg')
    await page.getByRole('button', { name: 'Fermer a.svg' }).click()
    await page.getByRole('alertdialog').waitFor({ state: 'visible', timeout: 10000 })
    await page.getByRole('button', { name: 'Fermer sans enregistrer' }).click()
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.dsh-studio-doc-tabs [role="tab"]')]
        .every((tab) => tab.getAttribute('aria-label') !== 'a.svg'), null, { timeout: 10000 })
    assert.equal(await documentsTablist(page).getByRole('tab').count(), 1,
      'confirming closes only the dirty tab')
    assert.equal(await tabNamed(page, 'b.svg').getAttribute('aria-selected'), 'true',
      'the neighbour becomes the active tab')
    assert.equal(await harness.read('a.svg'), SVG_DOCUMENT,
      'discarding a draft never writes the file')
    assert.equal(await harness.read('b.svg'), SECOND)
    assert.equal(applies(harness).length, writesBefore, 'closing tabs sends no /apply')
  },
}

export const tabsKeyboardSpec = {
  name: 'tab: arrow keys move between document tabs and Enter activates the focused one',
  async run({ page, harness, assert }) {
    await harness.write('a.svg', SVG_DOCUMENT)
    await harness.write('b.svg', SECOND)
    await openWorkspaceFile(page, 'a.svg', { expect: 'svg' })
    await openWorkspaceFile(page, 'b.svg', { expect: 'svg' })
    await waitForActiveFile(page, 'b.svg')
    const tablist = documentsTablist(page)
    assert.equal(await tablist.getAttribute('aria-orientation'), 'horizontal')
    assert.equal(await tablist.getByRole('tab').count(), 2)

    // Focus the active tab, then move the focus without activating anything.
    await tabNamed(page, 'b.svg').focus()
    await page.keyboard.press('ArrowLeft')
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
    assert.match(String(focused), /^a\.svg/, 'ArrowLeft moves the focus to the previous tab: ' + focused)
    assert.equal(await tabNamed(page, 'b.svg').getAttribute('aria-selected'), 'true',
      'moving the focus does not change the active document')
    assert.equal(await page.getByLabel('Workspace file').inputValue(), 'b.svg')

    // Enter activates the focused tab.
    await page.keyboard.press('Enter')
    await waitForActiveFile(page, 'a.svg')
    assert.equal(await tabNamed(page, 'a.svg').getAttribute('aria-selected'), 'true')
    assert.equal(await tabNamed(page, 'b.svg').getAttribute('aria-selected'), 'false')

    // Home/End reach the ends of the strip, and Space also activates.
    await page.keyboard.press('End')
    const last = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
    assert.match(String(last), /^b\.svg/, 'End focuses the last tab: ' + last)
    await page.keyboard.press(' ')
    await waitForActiveFile(page, 'b.svg')
    assert.equal(await tabNamed(page, 'b.svg').getAttribute('aria-selected'), 'true')
    await page.keyboard.press('Home')
    const first = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
    assert.match(String(first), /^a\.svg/, 'Home focuses the first tab: ' + first)
    assert.equal(await harness.read('a.svg'), SVG_DOCUMENT, 'keyboard navigation writes nothing')
    assert.equal(await harness.read('b.svg'), SECOND)
    assert.equal(applies(harness).length, 0)
  },
}

export const tabDialogFocusSpec = {
  name: 'tab: closing a modified document focuses the confirmation, Escape cancels and focus returns',
  async run({ page, harness, assert }) {
    await harness.write('focus-a.svg', SVG_DOCUMENT)
    await harness.write('focus-b.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'focus-a.svg', { expect: 'svg' })
    await openWorkspaceFile(page, 'focus-b.svg', { expect: 'svg' })

    // Make the active document dirty WITHOUT writing: edit the source buffer and
    // never press Save, exactly like a user mid-edit.
    // The source drawer is collapsed by default, like for a user.
    const drawer = page.locator('details.dsh-studio-source')
    if (!(await drawer.evaluate((node) => node.open))) await drawer.locator('summary').click()
    const source = drawer.locator('textarea')
    await source.waitFor({ state: 'visible', timeout: 15000 })
    await source.fill(SVG_DOCUMENT.replace('id="card"', 'id="card" data-draft="1"'))
    await page.waitForFunction(() =>
      document.querySelector('.dsh-studio-source textarea')?.value.includes('data-draft="1"'),
      null, { timeout: 15000 })
    assert.equal(await harness.read('focus-b.svg'), SVG_DOCUMENT,
      'editing the buffer must not write the file')

    const closeButton = page.getByRole('button', { name: 'Fermer focus-b.svg' })
    await closeButton.click()
    // The apostrophe is a typographic one; match the file name only so the
    // assertion does not depend on that detail.
    const dialog = page.locator('[data-tab-close-confirm="focus-b.svg"]')
    await dialog.waitFor({ state: 'visible', timeout: 15000 })

    // The safe choice owns the focus: pressing Enter must not discard.
    const focused = await page.evaluate(() => {
      const node = document.activeElement
      return node ? (node.textContent || '').trim() : ''
    })
    assert.equal(focused, 'Annuler',
      'the confirmation must focus the non-destructive choice, got ' + JSON.stringify(focused))

    // Escape cancels the dialog and gives the focus back to the tab that asked.
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached', timeout: 10000 })
    const restored = await page.evaluate(() => {
      const node = document.activeElement
      return node ? (node.getAttribute('aria-label') || (node.textContent || '').trim()) : ''
    })
    assert.equal(restored, 'Fermer focus-b.svg',
      'cancelling must return the focus to the tab close button, got ' + JSON.stringify(restored))
    // Nothing was written by opening or cancelling the confirmation.
    assert.equal(await harness.read('focus-b.svg'), SVG_DOCUMENT)
  },
}


export const tabsCycleShortcutSpec = {
  name: 'tab: Ctrl+Tab and Ctrl+Shift+Tab cycle documents without saving an unsaved source draft',
  async run({ page, harness, assert }) {
    await harness.write('a.svg', SVG_DOCUMENT)
    await harness.write('b.svg', SECOND)
    await openWorkspaceFile(page, 'a.svg', { expect: 'svg' })
    await revealSource(page)
    const unsaved = SVG_DOCUMENT.replace('Title', 'Draft via shortcut')
    assert.ok(unsaved !== SVG_DOCUMENT, 'the draft differs from the file')
    const source = page.locator('.dsh-studio-source textarea')
    await source.fill(unsaved)
    await openWorkspaceFile(page, 'b.svg', { expect: 'svg' })
    await waitForActiveFile(page, 'b.svg')
    const writesBefore = applies(harness).length

    // Browser chrome can reserve Ctrl+Tab. Dispatching the keyboard event to
    // the focused editor proves this plugin's shortcut handler, not that an
    // external browser has delegated its native tab-switching accelerator.
    const activeSource = page.locator('.dsh-studio-source textarea')
    await revealSource(page)
    await activeSource.focus()
    await activeSource.dispatchEvent('keydown',
      { key: 'Tab', code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true })
    await waitForActiveFile(page, 'a.svg')
    assert.equal(await sourceOf(page), unsaved, 'cycling restores the exact unsaved source')
    assert.equal(await tabNamed(page, 'a.svg').getAttribute('aria-selected'), 'true')
    assert.equal(applies(harness).length, writesBefore, 'cycling must not write')

    await page.locator('.dsh-studio-source textarea').dispatchEvent('keydown',
      { key: 'Tab', code: 'Tab', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
    await waitForActiveFile(page, 'b.svg')
    assert.equal(await tabNamed(page, 'a.svg').getAttribute('aria-label'),
      'a.svg · modifications non enregistrées', 'dirty marker survives both shortcuts')
    assert.equal(await harness.read('a.svg'), SVG_DOCUMENT, 'file A remains unchanged on disk')
    assert.equal(await harness.read('b.svg'), SECOND, 'file B remains unchanged on disk')
    assert.equal(applies(harness).length, writesBefore, 'neither shortcut writes')
  },
}

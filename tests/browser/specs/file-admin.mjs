/**
 * Renaming and deleting from the file panel.
 *
 * Both actions are driven through the real UI against the real Host and a real
 * temporary workspace. The specs prove the properties a user depends on: the
 * confirmation names the exact path, nothing happens on the first click alone,
 * a rename keeps the document open under its new name, and deleting the open
 * document returns to the landing state instead of leaving a dead editor.
 */
import { SVG_DOCUMENT, openFileMenu, openWorkspaceFile } from './helpers.mjs'

/** Open the workspace panel the same way a user does: File → Parcourir… */
async function openPanel(page) {
  await openFileMenu(page)
  await page.getByRole('button', { name: 'Browse workspace design files' }).click()
  await page.locator('.dsh-studio-file-picker').waitFor({ state: 'visible', timeout: 20000 })
}

export const renameFileSpec = {
  name: 'files: renaming writes the new path, keeps the document open and never replaces another file',
  // The refused rename is a deliberate 409; the spec asserts its outcome.
  allowConsoleErrors: 'refusals',
  async run({ page, harness, assert }) {
    await harness.write('avant.svg', SVG_DOCUMENT)
    await harness.write('occupe.svg', '<svg><!-- occupied --></svg>')
    await openWorkspaceFile(page, 'avant.svg', { expect: 'svg' })
    await openPanel(page)

    // The first click only opens a confirmation: it must not write anything.
    await page.getByRole('button', { name: 'Rename avant.svg' }).click()
    assert.equal(await harness.read('avant.svg'), SVG_DOCUMENT,
      'opening the rename field must not move the file')
    const field = page.getByLabel('New path for avant.svg')
    assert.equal(await field.inputValue(), 'avant.svg', 'the field starts from the current path')

    await field.fill('apres.svg')
    const saved = page.waitForResponse((value) => value.url().includes('/design-studio-native/rename'))
    await page.getByRole('button', { name: 'Confirm rename of avant.svg' }).click()
    assert.equal((await saved).status(), 200)

    assert.equal(await harness.read('apres.svg'), SVG_DOCUMENT, 'the bytes must be byte-identical')
    const gone = await harness.read('avant.svg').then(() => false, () => true)
    assert.equal(gone, true, 'the old path must be gone')
    // The editor follows the file: the banner names the new path and the canvas
    // still shows the same document instead of dropping the user to the landing.
    await page.waitForFunction(() => document.querySelector('.dsh-studio-stage-top')?.innerText.includes('apres.svg'),
      null, { timeout: 20000 })
    assert.equal(await page.getByLabel('Workspace file').inputValue(), 'apres.svg')
    const notice = page.locator('[data-created]')
    assert.equal(await notice.innerText(), 'Fichier renommé : apres.svg')

    // A refused rename names the occupant and changes nothing on disk.
    await page.getByRole('button', { name: 'Rename apres.svg' }).click()
    await page.getByLabel('New path for apres.svg').fill('occupe.svg')
    await page.getByRole('button', { name: 'Confirm rename of apres.svg' }).click()
    const alert = page.getByRole('alert')
    await alert.waitFor({ state: 'visible', timeout: 20000 })
    assert.ok((await alert.innerText()).includes('occupe.svg'),
      'the refusal must name the occupied path: ' + JSON.stringify(await alert.innerText()))
    assert.equal(await harness.read('occupe.svg'), '<svg><!-- occupied --></svg>',
      'the occupied file must be untouched')
    assert.equal(await harness.read('apres.svg'), SVG_DOCUMENT,
      'the source must still exist after a refused rename')
  },
}

export const deleteFileSpec = {
  name: 'files: deleting the open document asks for the exact path, then returns to the landing state',
  async run({ page, harness, assert }) {
    await harness.write('jeter.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'jeter.svg', { expect: 'svg' })
    await openPanel(page)

    // The confirmation names the file and says it is permanent.
    await page.getByRole('button', { name: 'Delete jeter.svg' }).click()
    const confirm = page.getByRole('group', { name: 'Confirm file delete' })
    await confirm.waitFor({ state: 'visible', timeout: 20000 })
    assert.ok((await confirm.innerText()).includes('jeter.svg'),
      'the confirmation must name the exact path')
    assert.equal(await harness.read('jeter.svg'), SVG_DOCUMENT,
      'opening the confirmation must not delete anything')

    const removed = page.waitForResponse((value) => value.url().includes('/design-studio-native/delete'))
    await page.getByRole('button', { name: 'Confirm delete of jeter.svg' }).click()
    assert.equal((await removed).status(), 200)
    const gone = await harness.read('jeter.svg').then(() => false, () => true)
    assert.equal(gone, true, 'the file must be gone from disk')

    // The open document is gone too: the editor must not keep showing it.
    await page.getByRole('region', { name: 'Open a design file' })
      .waitFor({ state: 'visible', timeout: 20000 })
    assert.equal(await page.getByLabel('Canvas viewport').count(), 0,
      'a deleted document must not stay on the canvas')
    const notice = page.locator('[data-created]')
    assert.equal(await notice.innerText(), 'Fichier supprimé : jeter.svg')
  },
}

export const cancelDeleteSpec = {
  name: 'files: cancelling a delete leaves the file and the open document untouched',
  async run({ page, harness, assert }) {
    await harness.write('garde.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'garde.svg', { expect: 'svg' })
    await openPanel(page)

    await page.getByRole('button', { name: 'Delete garde.svg' }).click()
    await page.getByRole('group', { name: 'Confirm file delete' }).waitFor({ state: 'visible', timeout: 20000 })
    await page.getByRole('button', { name: 'Cancel file action' }).click()
    assert.equal(await page.getByRole('group', { name: 'Confirm file delete' }).count(), 0,
      'cancelling must close the confirmation')
    assert.equal(await harness.read('garde.svg'), SVG_DOCUMENT, 'nothing may be written or removed')
    assert.equal(await page.getByLabel('Canvas viewport').count(), 1, 'the document stays open')
  },
}

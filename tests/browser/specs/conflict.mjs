/**
 * Concurrency and recovery in the browser: an edit issued from the real UI must
 * be refused when the file changed underneath, never silently overwritten.
 */
import { SVG_DOCUMENT, dragBy, openWorkspaceFile, openFileMenu, waitForDisk } from './helpers.mjs'

export const externalConflictSpec = {
  allowConsoleErrors: 'refusals',
  name: 'conflict: an external edit wins and the stale UI save is refused, never overwritten',
  async run({ page, harness, assert }) {
    await harness.write('shared.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'shared.svg', { expect: 'svg' })
    await page.getByRole('button', { name: 'Drag rect card' }).waitFor({ state: 'visible' })

    const external = SVG_DOCUMENT.replace('fill="#bda991"', 'fill="#ff0000"')
    assert.ok(external !== SVG_DOCUMENT, 'fixture must differ from the loaded document')
    await harness.write('shared.svg', external)

    await dragBy(page, page.getByRole('button', { name: 'Drag rect card' }), 60, 30)
    await page.waitForTimeout(1200)

    assert.equal(await harness.read('shared.svg'), external,
      'the external content must be preserved byte for byte')
    const alertText = await page.getByRole('alert').innerText().catch(() => '')
    assert.ok(/changed|revision|identity|recharge|reload/i.test(alertText),
      'the UI must report the stale revision explicitly, got: ' + JSON.stringify(alertText.slice(0, 200)))

    // Recovery path: reload adopts the external bytes and re-enables editing.
    const reload = page.getByRole('button', { name: 'Reload after save error' })
    if (await reload.count()) await reload.first().click()
    else await page.getByRole('button', { name: 'Recharger le fichier' }).click()
    await page.waitForFunction((expected) => document.querySelector('textarea')?.value === expected, external,
      { timeout: 15000 })
    assert.equal(await page.locator('textarea').first().inputValue(), external,
      'reloading must adopt the externally modified content')
    assert.equal(await page.getByRole('alert').count(), 0, 'the conflict alert clears after reload')
  },
}

export const refusedWriteSpec = {
  allowConsoleErrors: 'refusals',
  name: 'conflict: deleting the file on disk makes the next save fail without recreating it',
  async run({ page, harness, assert }) {
    await harness.write('gone.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'gone.svg', { expect: 'svg' })
    const { rm } = await import('node:fs/promises')
    await rm(harness.file('gone.svg'))
    await dragBy(page, page.getByRole('button', { name: 'Drag rect card' }), 40, 20)
    await page.waitForTimeout(1000)
    const { stat } = await import('node:fs/promises')
    let exists = true
    try { await stat(harness.file('gone.svg')) } catch { exists = false }
    assert.equal(exists, false, 'a refused save must not resurrect a deleted file')
    const alertText = await page.getByRole('alert').innerText().catch(() => '')
    assert.ok(alertText.length > 0, 'the UI must report why the save could not complete')
  },
}

export const unsavedSourceGuardSpec = {
  name: 'safety: unsaved source text blocks opening another file instead of losing it',
  async run({ page, harness, assert }) {
    await harness.write('a.svg', SVG_DOCUMENT)
    await harness.write('b.svg', SVG_DOCUMENT.replace(/600/g, '640'))
    await openWorkspaceFile(page, 'a.svg', { expect: 'svg' })
    await page.locator('summary').filter({ hasText: 'Code source natif' }).click()
    await page.locator('textarea').first().fill(SVG_DOCUMENT.replace('Title', 'Edited locally'))
    await openFileMenu(page)
    await page.getByLabel('Workspace file').fill('b.svg')
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await page.waitForTimeout(500)
    const alertText = await page.getByRole('alert').innerText()
    assert.match(alertText, /unsaved|save or discard/i,
      'opening another file with unsaved text must be refused with an explicit message')
    assert.equal(await page.locator('textarea').first().inputValue(),
      SVG_DOCUMENT.replace('Title', 'Edited locally'), 'the unsaved text is preserved')
    assert.equal(await harness.read('a.svg'), SVG_DOCUMENT, 'the workspace file is untouched')
  },
}

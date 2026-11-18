/**
 * Unsaved-recovery journal (ADR-035) in real browsers.
 *
 * These specs drive the real UI against the real Host route handler and a real
 * temporary filesystem, in Chromium and Firefox. They prove the user-visible
 * contract: after a crash (here: a page reload, which destroys the renderer's
 * unsaved state exactly like a crash) an edited document is OFFERED for
 * recovery, named with its file and age; recovering only loads the journaled
 * source into the editor, never writing the file; ignoring deletes the local
 * copy for good; a successful save makes the entry obsolete; two workspaces
 * never share an entry; and a storage that refuses writes is reported once
 * without stopping the edit.
 */
import { SVG_DOCUMENT, openWorkspaceFile, waitForDisk } from './helpers.mjs'

const RECOVERY_PREFIX = 'dsh-design-studio:recovery:v1:'

const journalKeys = (page) => page.evaluate((prefix) => {
  const keys = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (typeof key === 'string' && key.startsWith(prefix)) keys.push(key)
  }
  return keys
}, RECOVERY_PREFIX)

const waitForJournalEntry = (page) => page.waitForFunction((prefix) => {
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (typeof key === 'string' && key.startsWith(prefix)) return true
  }
  return false
}, RECOVERY_PREFIX, { timeout: 15000 })

const banner = (page) => page.locator('[data-recovery-banner]')

async function revealSource(page) {
  await page.locator('summary').filter({ hasText: 'Code source natif' }).click()
  await page.locator('.dsh-studio-source textarea').waitFor({ state: 'visible', timeout: 10000 })
}

async function reloadPage(page) {
  await page.reload({ waitUntil: 'load' })
  await page.waitForFunction(() => window.__DSH_HARNESS__?.ready === true, null, { timeout: 30000 })
}

const applies = (harness) => harness.requests.filter((request) => request.path.endsWith('/apply'))
const documents = (harness) => harness.requests.filter((request) => request.path.endsWith('/document'))

export const recoveryAfterCrashSpec = {
  name: 'recovery: an unsaved edit is offered after a reload and recovery only loads it, never writes',
  async run({ page, harness, assert }) {
    await harness.write('accueil.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'accueil.svg', { expect: 'svg' })
    await revealSource(page)
    const edited = SVG_DOCUMENT.replace('fill="#bda991"', 'fill="#3311aa"')
    assert.ok(edited !== SVG_DOCUMENT, 'the edit must really change the source')
    await page.locator('.dsh-studio-source textarea').fill(edited)
    await waitForJournalEntry(page)
    assert.equal(applies(harness).length, 0, 'typing must never send /apply')
    assert.equal(await harness.read('accueil.svg'), SVG_DOCUMENT, 'typing must never touch the file')

    // A reload is the crash: the renderer state (tabs, source, undo) is gone.
    const readsBeforeReload = documents(harness).length
    await reloadPage(page)
    const offered = banner(page)
    await offered.waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await offered.getAttribute('data-recovery-banner'), 'accueil.svg',
      'the banner names the exact file')
    const text = await offered.innerText()
    assert.ok(text.includes('accueil.svg'), 'the banner names the file: ' + JSON.stringify(text))
    assert.match(text, /il y a/, 'the banner states the age of the modification: ' + JSON.stringify(text))
    assert.ok(/rien n’a été écrit/.test(text), 'the banner states that the disk is untouched')
    assert.equal(await page.getByLabel('Workspace file').inputValue(), 'design.svg',
      'the banner does not open anything by itself')
    assert.equal(documents(harness).length, readsBeforeReload,
      'mounting after a crash reads no document automatically')
    assert.equal(applies(harness).length, 0, 'mounting after a crash writes nothing')

    // Explicit recovery: source -> editor, nothing -> disk.
    await page.getByRole('button', { name: 'Récupérer les modifications' }).click()
    await page.waitForFunction((value) =>
      document.querySelector('.dsh-studio-source textarea')?.value === value, edited, { timeout: 20000 })
    assert.equal(await page.locator('.dsh-studio-source textarea').inputValue(), edited,
      'the journaled source is loaded into the editor')
    assert.equal(documents(harness).length, readsBeforeReload + 1,
      'recovery reads the opened file exactly once')
    assert.equal(applies(harness).length, 0, 'recovery must never send /apply')
    assert.equal(await harness.read('accueil.svg'), SVG_DOCUMENT,
      'the file on disk keeps its original bytes')
    assert.equal(await banner(page).count(), 0, 'the banner is dismissed once recovered')
    const note = page.locator('[data-recovery-note]')
    await note.waitFor({ state: 'visible', timeout: 10000 })
    assert.match(await note.innerText(), /Aucune écriture/, 'the outcome states that nothing was written')
  },
}

export const recoveryIgnoreSpec = {
  name: 'recovery: ignoring deletes the local entry and no banner returns after a reload',
  async run({ page, harness, assert }) {
    await harness.write('brouillon.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'brouillon.svg', { expect: 'svg' })
    await revealSource(page)
    await page.locator('.dsh-studio-source textarea').fill(SVG_DOCUMENT.replace('Title', 'Never saved'))
    await waitForJournalEntry(page)
    assert.equal((await journalKeys(page)).length, 1, 'the edit is journaled')

    await reloadPage(page)
    await banner(page).waitFor({ state: 'visible', timeout: 15000 })
    await page.getByRole('button', { name: 'Ignorer la récupération de brouillon.svg' }).click()
    await page.waitForFunction(() => document.querySelector('[data-recovery-banner]') === null,
      null, { timeout: 10000 })
    assert.deepEqual(await journalKeys(page), [], 'ignoring removes the local copy')
    assert.equal(await harness.read('brouillon.svg'), SVG_DOCUMENT, 'ignoring never writes the file')

    await reloadPage(page)
    await page.waitForTimeout(400)
    assert.equal(await banner(page).count(), 0, 'a discarded entry must not come back')
  },
}

export const recoverySaveClearsSpec = {
  name: 'recovery: a successful save clears the entry and a reload offers nothing',
  async run({ page, harness, assert }) {
    await harness.write('sauve.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'sauve.svg', { expect: 'svg' })
    await revealSource(page)
    const edited = SVG_DOCUMENT.replace('fill="#bda991"', 'fill="#0a7d4f"')
    await page.locator('.dsh-studio-source textarea').fill(edited)
    await waitForJournalEntry(page)

    await page.getByRole('button', { name: 'Save source' }).click()
    assert.equal(await waitForDisk(harness, 'sauve.svg', (content) => content === edited,
      { label: 'explicit save' }), edited)
    await page.waitForFunction((prefix) => {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index)
        if (typeof key === 'string' && key.startsWith(prefix)) return false
      }
      return true
    }, RECOVERY_PREFIX, { timeout: 15000 })

    await reloadPage(page)
    await page.waitForTimeout(400)
    assert.equal(await banner(page).count(), 0, 'a saved document needs no recovery')
    assert.equal(await harness.read('sauve.svg'), edited, 'the saved bytes are on disk')
  },
}

export const recoveryWorkspaceIsolationSpec = {
  name: 'recovery: two workspaces never share a journal entry',
  harness: {
    workspaces: [
      { id: 'ws-atelier-a', title: 'Atelier A', path: 'atelier-a' },
      { id: 'ws-atelier-b', title: 'Atelier B', path: 'atelier-b' },
    ],
  },
  async run({ page, harness, assert }) {
    await harness.write('atelier-a/accueil.svg', SVG_DOCUMENT)
    await harness.write('atelier-b/accueil.svg', SVG_DOCUMENT.replace('fill="#bda991"', 'fill="#333333"'))
    await page.goto(harness.url + '?panel=design-studio', { waitUntil: 'load' })
    await page.waitForFunction(() => window.__DSH_HARNESS__?.ready === true, null, { timeout: 30000 })
    const workspaceSelect = page.getByRole('combobox', { name: 'Workspace', exact: true })
    await workspaceSelect.waitFor({ state: 'visible', timeout: 20000 })
    assert.equal(await workspaceSelect.inputValue(), 'ws-atelier-a', 'the first workspace is active')

    // Edit a document of Atelier A only.
    await page.getByRole('button', { name: 'Open file accueil.svg' }).click()
    await page.waitForSelector('[aria-label="Canvas viewport"]', { timeout: 20000 })
    await revealSource(page)
    const edited = SVG_DOCUMENT.replace('Title', 'Edited in A')
    await page.locator('.dsh-studio-source textarea').fill(edited)
    await waitForJournalEntry(page)
    const keys = await journalKeys(page)
    assert.equal(keys.length, 1, 'only Atelier A has an entry')
    assert.ok(keys[0].includes(encodeURIComponent('w:ws-atelier-a')),
      'the key carries the workspace id: ' + keys[0])

    await reloadPage(page)
    await banner(page).waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await banner(page).getAttribute('data-recovery-banner'), 'accueil.svg')

    // Switching workspace hides the entry: it belongs to another project.
    await workspaceSelect.selectOption('ws-atelier-b')
    await page.waitForFunction(() => document.querySelector('[data-recovery-banner]') === null,
      null, { timeout: 15000 })
    assert.equal(await banner(page).count(), 0, 'Atelier B must not see Atelier A’s entry')
    assert.equal((await journalKeys(page)).length, 1,
      'switching workspace does not delete the other workspace’s entry')

    // Coming back still offers it, and it is the exact edited source.
    await workspaceSelect.selectOption('ws-atelier-a')
    await banner(page).waitFor({ state: 'visible', timeout: 15000 })
    await page.getByRole('button', { name: 'Récupérer les modifications' }).click()
    await page.waitForFunction((value) =>
      document.querySelector('.dsh-studio-source textarea')?.value === value, edited, { timeout: 20000 })
    assert.equal(await harness.read('atelier-a/accueil.svg'), SVG_DOCUMENT,
      'recovery in one workspace never writes its file')
    assert.ok((await harness.read('atelier-b/accueil.svg')).includes('fill="#333333"'),
      'the other workspace’s file is untouched')
  },
}

export const recoveryStorageFailureSpec = {
  name: 'recovery: a storage that refuses writes is reported once and the edit continues',
  async run({ page, harness, assert }) {
    // Patch the real Storage prototype BEFORE any edit, then reload so the
    // patched setItem is in place from the first React render.
    await page.addInitScript((prefix) => {
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function setItem(key, value) {
        if (String(key).startsWith(prefix)) {
          const error = new Error('QuotaExceededError: simulated refusal')
          error.name = 'QuotaExceededError'
          throw error
        }
        return original.call(this, key, value)
      }
    }, RECOVERY_PREFIX)
    await reloadPage(page)

    await harness.write('quota.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'quota.svg', { expect: 'svg' })
    await revealSource(page)
    const edited = SVG_DOCUMENT.replace('Title', 'Still editable')
    await page.locator('.dsh-studio-source textarea').fill(edited)
    const warning = page.locator('[data-recovery-warning]')
    await warning.waitFor({ state: 'visible', timeout: 15000 })
    const message = await warning.innerText()
    assert.match(message, /refusé l’écriture|quota/i, 'the warning names the storage failure: ' + JSON.stringify(message))
    assert.deepEqual(await journalKeys(page), [], 'nothing was stored')
    assert.equal(await page.locator('.dsh-studio-source textarea').inputValue(), edited,
      'the edit is still in the editor')

    await page.locator('.dsh-studio-source textarea').fill(edited.replace('Still editable', 'Still working'))
    await page.waitForTimeout(600)
    assert.equal(await page.locator('[data-recovery-warning]').count(), 1,
      'the warning is shown exactly once, not on every keystroke')
    assert.equal(await page.locator('.dsh-studio-source textarea').inputValue(),
      edited.replace('Still editable', 'Still working'), 'editing keeps working')
    const errors = await page.evaluate(() => window.__DSH_HARNESS__.errors)
    assert.deepEqual(errors, [], 'a storage failure must never crash the editor')

    // The explicit save path is unaffected by the journal failure.
    await page.getByRole('button', { name: 'Save source' }).click()
    const saved = edited.replace('Still editable', 'Still working')
    assert.equal(await waitForDisk(harness, 'quota.svg', (content) => content === saved,
      { label: 'save with a broken journal' }), saved)
  },
}

export const recoveryPreferenceSpec = {
  name: 'recovery: the journal can be disabled in Options and the preference survives a reload',
  async run({ page, harness, assert }) {
    const openOptions = async () => {
      const settings = page.locator('details.dsh-studio-settings')
      if (!(await settings.evaluate((node) => node.open))) await settings.locator('summary').click()
    }
    await harness.write('option.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'option.svg', { expect: 'svg' })
    await revealSource(page)

    // Disabling really stops the copies, and the preference is persisted.
    await openOptions()
    const toggle = page.getByRole('checkbox', { name: 'Journal de récupération' })
    await toggle.waitFor({ state: 'visible', timeout: 10000 })
    assert.equal(await toggle.isChecked(), true, 'the journal is enabled by default')
    await toggle.uncheck()
    assert.equal(await page.evaluate(() => localStorage.getItem('dsh-design-studio:pref:v1:recovery-enabled')), '0',
      'the preference is stored')
    await page.locator('.dsh-studio-source textarea').fill(SVG_DOCUMENT.replace('Title', 'Disabled journal'))
    await page.waitForTimeout(700)
    assert.deepEqual(await journalKeys(page), [], 'a disabled journal writes no entry')

    // A reload keeps the choice: still disabled, still no entry on the next edit.
    await reloadPage(page)
    await openWorkspaceFile(page, 'option.svg', { expect: 'svg' })
    await revealSource(page)
    await openOptions()
    assert.equal(await page.getByRole('checkbox', { name: 'Journal de récupération' }).isChecked(), false,
      'the preference survives the reload')
    await page.locator('.dsh-studio-source textarea').fill(SVG_DOCUMENT.replace('Title', 'Still disabled'))
    await page.waitForTimeout(700)
    assert.deepEqual(await journalKeys(page), [], 'no entry is written while disabled')

    // Re-enabling restores journaling without a reload.
    await page.getByRole('checkbox', { name: 'Journal de récupération' }).check()
    await page.locator('.dsh-studio-source textarea').fill(SVG_DOCUMENT.replace('Title', 'Enabled again'))
    await waitForJournalEntry(page)
    assert.equal((await journalKeys(page)).length, 1, 're-enabled journaling writes the entry again')
  },
}

export const recoveryChangedOnDiskSpec = {
  name: 'recovery: a file changed meanwhile is signalled, and recovery still never writes it',
  async run({ page, harness, assert }) {
    await harness.write('conflit.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'conflit.svg', { expect: 'svg' })
    await revealSource(page)
    const edited = SVG_DOCUMENT.replace('fill="#bda991"', 'fill="#7722aa"')
    await page.locator('.dsh-studio-source textarea').fill(edited)
    await waitForJournalEntry(page)

    // Someone else replaced the file while the journal still holds the edit.
    const other = SVG_DOCUMENT.replace('Title', 'Edited elsewhere')
    await harness.write('conflit.svg', other)
    await reloadPage(page)
    await banner(page).waitFor({ state: 'visible', timeout: 15000 })
    await page.getByRole('button', { name: 'Récupérer les modifications' }).click()
    await page.waitForFunction((value) =>
      document.querySelector('.dsh-studio-source textarea')?.value === value, edited, { timeout: 20000 })
    const note = page.locator('[data-recovery-note]')
    await note.waitFor({ state: 'visible', timeout: 10000 })
    const message = await note.innerText()
    assert.match(message, /changé sur le disque/,
      'the divergence from the recorded revision is stated')
    assert.ok(!message.includes('le fichier sur le disque est inchangé'),
      'the note must not contradict itself by calling the disk unchanged: ' + JSON.stringify(message))
    assert.equal(await harness.read('conflit.svg'), other,
      'recovery must not overwrite the bytes that arrived meanwhile')
    assert.equal(applies(harness).length, 0, 'a recovered stale source is never written automatically')
  },
}

const journalEntryOf = (page, file) => page.evaluate(({ prefix, file }) => {
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (typeof key !== 'string' || !key.startsWith(prefix)) continue
    const raw = localStorage.getItem(key)
    if (typeof raw !== 'string') continue
    try {
      const entry = JSON.parse(raw)
      if (entry && entry.file === file) return entry
    } catch (_) { /* a corrupt entry is not this spec's concern */ }
  }
  return null
}, { prefix: RECOVERY_PREFIX, file })

export const recoveryTypingDuringSaveSpec = {
  name: 'recovery: typing during a save keeps the live buffer, the saved bytes and the entry',
  async run({ page, harness, assert }) {
    await harness.write('frappe.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'frappe.svg', { expect: 'svg' })
    await revealSource(page)
    const sent = SVG_DOCUMENT.replace('fill="#bda991"', 'fill="#116644"')
    await page.locator('.dsh-studio-source textarea').fill(sent)
    await waitForJournalEntry(page)
    const writesBefore = applies(harness).length

    // Hold the POST until the test has typed a second edit, which is exactly
    // the window a slow Host leaves open.
    let releaseApply
    const gate = new Promise((resolve) => { releaseApply = resolve })
    let markIntercepted
    const intercepted = new Promise((resolve) => { markIntercepted = resolve })
    await page.route('**/design-studio-native/apply', async (route) => {
      markIntercepted()
      await gate
      await route.continue()
    })

    await page.getByRole('button', { name: 'Save source' }).click()
    await intercepted
    const typedMeanwhile = sent.replace('fill="#116644"', 'fill="#661144"')
    await page.locator('.dsh-studio-source textarea').fill(typedMeanwhile)
    releaseApply()

    assert.equal(await waitForDisk(harness, 'frappe.svg', (content) => content === sent,
      { label: 'save of the source sent before the typing' }), sent,
      'the file on disk holds exactly the source that was sent')
    assert.equal(applies(harness).length, writesBefore + 1,
      'exactly one write: the late typing is never written implicitly')

    await page.waitForFunction((value) =>
      document.querySelector('.dsh-studio-source textarea')?.value === value, typedMeanwhile, { timeout: 15000 })
    assert.equal(await page.locator('.dsh-studio-source textarea').inputValue(), typedMeanwhile,
      'the typing that happened during the save is still in the editor')
    const tab = page.getByRole('tab', { name: /^frappe\.svg/ })
    assert.match(await tab.getAttribute('aria-label'), /modifications non enregistrées/,
      'the buffer is still marked as unsaved')

    // The entry was NOT cleared: it must carry the live source for the next reload.
    await page.waitForFunction(({ prefix, file, source }) => {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index)
        if (typeof key !== 'string' || !key.startsWith(prefix)) continue
        try {
          const entry = JSON.parse(localStorage.getItem(key))
          if (entry && entry.file === file && entry.source === source) return true
        } catch (_) { /* ignore malformed entries */ }
      }
      return false
    }, { prefix: RECOVERY_PREFIX, file: 'frappe.svg', source: typedMeanwhile }, { timeout: 15000 })
    const entry = await journalEntryOf(page, 'frappe.svg')
    assert.ok(entry, 'the journal entry still exists after the save')
    assert.equal(entry.source, typedMeanwhile, 'journaling resumed with the live source')
  },
}

export const recoveryBaseRevisionSpec = {
  name: 'recovery: a journaled base revision survives recoveries until a save succeeds',
  async run({ page, harness, assert }) {
    await harness.write('base.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'base.svg', { expect: 'svg' })
    await revealSource(page)
    const edited = SVG_DOCUMENT.replace('fill="#bda991"', 'fill="#225577"')
    await page.locator('.dsh-studio-source textarea').fill(edited)
    await waitForJournalEntry(page)
    const recorded = await journalEntryOf(page, 'base.svg')
    assert.ok(recorded && recorded.baseHash, 'the entry records the revision it was based on')

    // Someone else replaces the file while the entry still holds the edit.
    const elsewhere = SVG_DOCUMENT.replace('Title', 'Edited elsewhere')
    await harness.write('base.svg', elsewhere)

    const recoverAndReadNote = async () => {
      await reloadPage(page)
      await banner(page).waitFor({ state: 'visible', timeout: 15000 })
      await page.getByRole('button', { name: 'Récupérer les modifications' }).click()
      const note = page.locator('[data-recovery-note]')
      await note.waitFor({ state: 'visible', timeout: 15000 })
      await page.waitForFunction((value) =>
        document.querySelector('.dsh-studio-source textarea')?.value === value, edited, { timeout: 20000 })
      return note.innerText()
    }

    const first = await recoverAndReadNote()

    // Debounced journaling must not rebase the entry on the CURRENT disk hash.
    await page.waitForTimeout(700)
    const afterRecovery = await journalEntryOf(page, 'base.svg')
    assert.equal(afterRecovery.baseHash, recorded.baseHash,
      'the journaled base revision is preserved after a recovery')
    assert.match(first, /changé sur le disque/, 'the divergence is reported')
    assert.ok(!first.includes('le fichier sur le disque est inchangé'),
      'the note must not claim the disk is unchanged while reporting divergence: ' + JSON.stringify(first))

    // A second crash/reload must still announce the divergence.
    const second = await recoverAndReadNote()
    assert.match(second, /changé sur le disque/, 'the divergence survives a second recovery')
    assert.equal(await harness.read('base.svg'), elsewhere, 'no recovery ever writes the file')
  },
}

export const recoveryOpenTabDivergenceSpec = {
  name: 'recovery: recovery on an already-open clean tab re-reads the disk and reports divergence',
  async run({ page, harness, assert }) {
    await harness.write('ouvert.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'ouvert.svg', { expect: 'svg' })
    await revealSource(page)
    const edited = SVG_DOCUMENT.replace('Title', 'Journaled title')
    await page.locator('.dsh-studio-source textarea').fill(edited)
    await waitForJournalEntry(page)

    await reloadPage(page)
    await banner(page).waitFor({ state: 'visible', timeout: 15000 })
    // The user reopens the same file themselves (clean tab), then someone else
    // replaces the file on disk AFTER that read.
    await openWorkspaceFile(page, 'ouvert.svg', { expect: 'svg' })
    const elsewhere = SVG_DOCUMENT.replace('fill="#bda991"', 'fill="#884422"')
    await harness.write('ouvert.svg', elsewhere)
    const readsBefore = documents(harness).length

    await page.getByRole('button', { name: 'Récupérer les modifications' }).click()
    const note = page.locator('[data-recovery-note]')
    await note.waitFor({ state: 'visible', timeout: 15000 })
    await page.waitForFunction((value) =>
      document.querySelector('.dsh-studio-source textarea')?.value === value, edited, { timeout: 20000 })
    assert.equal(documents(harness).length, readsBefore + 1,
      'recovery re-reads the current revision even for an already-open tab')
    assert.match(await note.innerText(), /changé sur le disque/,
      'the divergence is reported, not hidden behind a stale revision')
    assert.equal(await harness.read('ouvert.svg'), elsewhere, 'recovery never writes the file')
  },
}

export const recoveryDiscardClearsSpec = {
  name: 'recovery: closing without saving deletes the entry and it is not offered again',
  async run({ page, harness, assert }) {
    await harness.write('abandon.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'abandon.svg', { expect: 'svg' })
    await revealSource(page)
    await page.locator('.dsh-studio-source textarea').fill(SVG_DOCUMENT.replace('Title', 'Abandoned'))
    await waitForJournalEntry(page)

    await page.getByRole('button', { name: 'Fermer abandon.svg' }).click()
    const dialog = page.getByRole('alertdialog')
    await dialog.waitFor({ state: 'visible', timeout: 10000 })
    await page.getByRole('button', { name: 'Fermer sans enregistrer' }).click()
    await page.waitForFunction(() =>
      document.querySelectorAll('.dsh-studio-doc-tabs [role="tab"]').length === 0, null, { timeout: 10000 })
    // Let the debounced journal write (if any) settle before judging the entry.
    await page.waitForTimeout(700)
    assert.deepEqual(await journalKeys(page), [], 'discarding is the explicit no: the local copy is deleted')
    assert.equal(await harness.read('abandon.svg'), SVG_DOCUMENT, 'discarding never writes the file')
    assert.equal(applies(harness).length, 0, 'closing a tab never writes')

    await reloadPage(page)
    await page.waitForTimeout(400)
    assert.equal(await banner(page).count(), 0, 'a discarded entry is not offered again')
  },
}

/**
 * Sidebar panel (ADR-024).
 *
 * A sidebar cell has no conversation, so the panel edits a registered workspace
 * addressed by id. These specs mount the registered `main` occupant the way DSH
 * does — with no props — against the real Host routes and a real temporary
 * workspace, and they check what the user actually gets: the workspace name, a
 * real file list, a real document in the canvas, and requests that carry a
 * workspace id instead of a session id.
 */
import { SVG_DOCUMENT } from './helpers.mjs'

async function openPanel(page, harness, key = 'design-studio') {
  await page.goto(harness.url + '?panel=' + encodeURIComponent(key), { waitUntil: 'load' })
  await page.waitForFunction(() => window.__DSH_HARNESS__?.ready === true, null, { timeout: 30000 })
  const state = await page.evaluate(() => ({
    errors: window.__DSH_HARNESS__.errors,
    fatal: window.__DSH_HARNESS__.fatal,
    registrations: window.__DSH_HARNESS__.registrations,
  }))
  if (state.fatal) throw new Error('panel shell failed: ' + state.errors.join(' | '))
  return state
}

export const panelSpec = {
  name: 'panel: the sidebar cell opens its main panel and edits a workspace by id',
  async run({ page, harness, assert }) {
    await harness.write('accueil.svg', SVG_DOCUMENT)
    await harness.write('notes.txt', 'pas un fichier de design')

    const state = await openPanel(page, harness)
    assert.deepEqual(state.registrations.main, ['design-studio'],
      'the main cell must be registered under the sidebar id: ' + JSON.stringify(state.registrations))
    assert.deepEqual(state.registrations.sidebar, ['design-studio'],
      'exactly one sidebar cell must be registered: ' + JSON.stringify(state.registrations))

    // The sidebar icon is rendered by the shell, not by the plugin: the plugin
    // only supplies the glyph, at the size the owner asks for.
    const icon = page.locator('#harness-sidebar-button svg')
    await icon.waitFor({ state: 'visible', timeout: 20000 })
    assert.equal(await icon.getAttribute('width'), '16', 'the icon honours the requested size')
    assert.equal(await page.locator('#harness-sidebar-button').getAttribute('aria-label'), 'Design Studio')

    // The panel resolves its workspace through the Host, not through a prop.
    await page.getByLabel('Design Studio panel').waitFor({ state: 'visible', timeout: 20000 })
    assert.ok((await page.getByLabel('Design Studio panel').innerText()).includes('Espace de test'),
      'the registered workspace title must be shown, and its path must never be')
    assert.equal(await page.getByRole('combobox', { name: 'Workspace', exact: true }).count(), 0,
      'a single workspace needs no switcher, only its title')

    // A real file of that workspace opens in the real canvas.
    const file = page.getByRole('button', { name: 'Open file accueil.svg' })
    await file.waitFor({ state: 'visible', timeout: 20000 })
    assert.equal(await page.getByRole('button', { name: 'Open file notes.txt' }).count(), 0,
      'non-design files stay out of the list')
    await file.click()
    await page.waitForSelector('[aria-label="Canvas viewport"]', { timeout: 20000 })
    const stage = page.locator('.dsh-studio-stage-top')
    assert.ok((await stage.innerText()).includes('accueil.svg'),
      'the panel opens the document it was asked for: ' + JSON.stringify(await stage.innerText()))

    // The transport is what makes this a panel: workspace id, never a session id.
    const documents = harness.requests.filter((entry) => entry.path.endsWith('/design-studio-native/document'))
    assert.ok(documents.length > 0, 'the panel must read a document through the Host')
    assert.ok(documents.every((entry) => /workspaceId=ws-e2e/.test(entry.search || '')),
      'every document read must carry the workspace id: ' + JSON.stringify(documents.map((entry) => entry.search)))
    assert.ok(documents.every((entry) => !/sessionId=/.test(entry.search || '')),
      'a panel request must never carry a session id')
    assert.ok(harness.requests.some((entry) => entry.path.endsWith('/design-studio-native/workspaces')),
      'the panel lists workspaces through the Host')
  },
}

export const panelUnavailableSpec = {
  name: 'panel: a host without a workspace registry says so instead of showing an empty editor',
  harness: { workspaces: null },
  async run({ page, harness, assert }) {
    await openPanel(page, harness)
    const status = page.getByRole('status').filter({ hasText: 'registre d’espaces de travail' })
    await status.waitFor({ state: 'visible', timeout: 20000 })
    assert.equal(await page.locator('[aria-label="Canvas viewport"]').count(), 0,
      'no editor may be offered without a workspace')
    assert.equal(await page.getByRole('region', { name: 'Open a design file' }).count(), 0,
      'the landing state needs a workspace and must stay hidden')
  },
}

export const panelEmptySpec = {
  name: 'panel: no registered workspace is reported, and the editor is not faked',
  harness: { workspaces: [] },
  async run({ page, harness, assert }) {
    await openPanel(page, harness)
    const status = page.getByRole('status').filter({ hasText: 'Aucun espace de travail enregistré' })
    await status.waitFor({ state: 'visible', timeout: 20000 })
    assert.equal(await page.locator('[aria-label="Canvas viewport"]').count(), 0)
    assert.equal(await page.getByRole('combobox', { name: 'Workspace', exact: true }).count(), 0,
      'a switcher must not be rendered when there is no workspace')
  },
}

/** Real-page actions only: no shell simulation, credentials, or assistant turn. */
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** Resolve only registry-proven membership inside the runner's two owned roots.
 * DSH workspace/src/entity.ts attachSession validates header.cwd before persisting
 * sessionIds; a sidebar selection is not the host conversation workspace selection.
 */
export function sessionWorkspaceFromRegistry(registry, sessionId, allowedPaths) {
  const matches = Object.entries(registry?.tables?.workspaces || {})
    .filter(([, workspace]) => workspace.sessionIds?.includes(sessionId))
  if (matches.length === 0) return null
  if (matches.length !== 1) throw new Error('Session belongs to multiple workspace registry records')
  const [id, workspace] = matches[0]
  if (typeof workspace.path !== 'string' || !allowedPaths.includes(workspace.path)) {
    throw new Error('Session workspace is outside the disposable seeded workspaces')
  }
  return { id, path: workspace.path }
}

export async function checkSidebar({ page, workspaceId, otherWorkspaceId, workspaceDir, document, record }) {
  const hostBefore = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.dataset.dshE2eThemeProbe = ''
    probe.style.cssText = 'position:fixed;left:-100px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)'
    document.body.appendChild(probe)
    const measure = node => {
      const style = getComputedStyle(node)
      return { background: style.backgroundColor, color: style.color,
        base: style.getPropertyValue('--dsw-alias-bg-base').trim(),
        layer: style.getPropertyValue('--dsw-alias-bg-layer-1').trim() }
    }
    window.__dshE2eMeasureTheme = () => ({ root: measure(document.documentElement),
      body: measure(document.body), probe: measure(probe) })
    return window.__dshE2eMeasureTheme()
  })
  try {
    await page.getByRole('button', { name: 'Design Studio', exact: true }).click({ timeout: 20000 })
    const panel = page.locator('[aria-label="Design Studio panel"]')
    await panel.waitFor({ state: 'visible', timeout: 20000 })
    await panel.getByLabel('Workspace', { exact: true }).selectOption(workspaceId)
    const studio = panel.locator('.dsh-studio-workbench')
    await studio.getByRole('button', { name: 'Open file g0-art.svg', exact: true }).click({ timeout: 20000 })
    await studio.getByLabel('Canvas viewport', { exact: true }).waitFor({ state: 'visible', timeout: 20000 })
    const renderedBox = studio.frameLocator('iframe[title="Isolated SVG preview"]').locator('svg rect#box')
    await renderedBox.waitFor({ state: 'visible', timeout: 20000 })
    if (await renderedBox.getAttribute('x') !== '10') throw new Error('Initial canvas does not render the fixture x=10')
    await studio.getByRole('button', { name: 'Select layer rect #box', exact: true }).click()
    record('credential-free sidebar opens registered workspace SVG', 'PASS',
      'real sidebar → Workspace id → g0-art.svg → visible canvas and box layer; no AI turn')

    const theme = await page.evaluate(() => {
      const section = document.querySelector('[aria-label="Design Studio panel"] .dsh-studio-workbench')
      const hostAfter = window.__dshE2eMeasureTheme()
      const background = getComputedStyle(section).backgroundColor
      // The real DSH theme owns tokens on body, shadowing root inheritance.
      const themeOwner = document.body
      const names = ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-label-primary']
      const saved = names.map(name => [name, themeOwner.style.getPropertyValue(name), themeOwner.style.getPropertyPriority(name)])
      let light
      try {
        themeOwner.style.setProperty(names[0], 'rgb(250, 250, 248)')
        themeOwner.style.setProperty(names[1], 'rgb(255, 255, 255)')
        themeOwner.style.setProperty(names[2], 'rgb(24, 24, 26)')
        light = { background: getComputedStyle(section).backgroundColor, host: window.__dshE2eMeasureTheme() }
      } finally {
        for (const [name, value, priority] of saved) {
          if (value) themeOwner.style.setProperty(name, value, priority)
          else themeOwner.style.removeProperty(name)
        }
      }
      return { background, hostAfter, light, restored: window.__dshE2eMeasureTheme() }
    })
    record('ADR-026 local Graphite and unrecoloured real host',
      theme.background === 'rgb(32, 33, 37)' && theme.light.background === theme.background &&
      theme.light.host.probe.background === 'rgb(250, 250, 248)' &&
      JSON.stringify(hostBefore) === JSON.stringify(theme.hostAfter) &&
      JSON.stringify(hostBefore) === JSON.stringify(theme.restored) ? 'PASS' : 'FAIL',
      JSON.stringify({ before: hostBefore, ...theme }))

    const expectDisk = async expected => {
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) {
        if (await readFile(path.join(workspaceDir, 'g0-art.svg'), 'utf8') === expected) return
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error('Sidebar edit did not produce the exact expected bytes on disk')
    }
    const changed = document.replace('x="10"', 'x="25"')
    await studio.getByLabel('Geometry x', { exact: true }).fill('25')
    await studio.getByLabel('Geometry x', { exact: true }).press('Enter')
    await expectDisk(changed)
    record('sidebar UI save persists exact SVG bytes', 'PASS', 'Geometry x=25 committed; unrelated bytes unchanged')
    await studio.getByRole('button', { name: 'Undo saved edit', exact: true }).click()
    await expectDisk(document)
    record('sidebar UI Undo restores exact SVG bytes', 'PASS', 'Undo restored original file byte-for-byte')
    await studio.getByRole('button', { name: 'Redo saved edit', exact: true }).click()
    await expectDisk(changed)
    // The disk commit precedes the response/reload: never unmount a busy editor.
    await page.waitForFunction(() => {
      const undo = document.querySelector('[aria-label="Design Studio panel"] [aria-label="Undo saved edit"]')
      return undo && !undo.disabled
    }, null, { timeout: 15000 })
    await panel.getByLabel('Workspace', { exact: true }).selectOption(otherWorkspaceId)
    await panel.getByRole('button', { name: 'Refresh workspace design files', exact: true }).waitFor()
    await panel.getByLabel('Workspace', { exact: true }).selectOption(workspaceId)
    await studio.getByRole('button', { name: 'Open file g0-art.svg', exact: true }).click({ timeout: 20000 })
    await studio.getByRole('button', { name: 'Select layer rect #box', exact: true }).click()
    const reopenedX = await studio.getByLabel('Geometry x', { exact: true }).inputValue()
    await expectDisk(changed)
    if (reopenedX !== '25') throw new Error('Reopened canvas inspector did not load saved x=25')
    await renderedBox.waitFor({ state: 'visible', timeout: 15000 })
    if (await renderedBox.getAttribute('x') !== '25') throw new Error('Reopened SVG canvas did not render saved x=25')
    record('sidebar UI reopen reads persisted SVG', 'PASS', 'workspace remount and file reopen read Geometry x=25 from disk')
    return studio
  } finally {
    await page.evaluate(() => {
      document.querySelector('[data-dsh-e2e-theme-probe]')?.remove()
      delete window.__dshE2eMeasureTheme
    })
  }
}

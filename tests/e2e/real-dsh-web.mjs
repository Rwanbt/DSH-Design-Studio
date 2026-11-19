/** Real-page UI actions plus one deliberate external-writer fixture.
 * No shell simulation, credentials, or assistant turn.
 */
import { readFile, writeFile } from 'node:fs/promises'
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

/** Only the browser's one network-error diagnostic during the deliberate CAS refusal.
 * Confirmation of the matching response body and unique request happens separately.
 */
export function isExpectedConflictConsole({ text, url }, evidence) {
  return evidence.active && evidence.requestCount === 1 && url === evidence.url &&
    /^Failed to load resource: the server responded with a status of 409 \(Conflict\)$/.test(text)
}

export async function checkSidebar({ page, workspaceId, otherWorkspaceId, workspaceDir, document, record, refusalEvidence }) {
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

    const expectDisk = async (expected, file = 'g0-art.svg') => {
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) {
        try {
          if (await readFile(path.join(workspaceDir, file), 'utf8') === expected) return
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
        }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error(`Sidebar ${file} did not produce the exact expected bytes on disk`)
    }
    const waitReady = async (file, expected) => {
      await page.waitForFunction(({ file, expected }) => {
        const editor = document.querySelector('[aria-label="Design Studio panel"] .dsh-studio-workbench')
        return editor?.querySelector('[aria-label="Workspace file"]')?.value === file &&
          editor.querySelector('.dsh-studio-source textarea')?.value === expected &&
          editor.querySelector('.dsh-studio-status')?.textContent === '✓ Enregistré localement'
      }, { file, expected }, { timeout: 15000 })
    }
    const fileMenu = studio.locator('.dsh-studio-top details.dsh-studio-menu')
    const setFileMenu = async open => {
      if (await fileMenu.evaluate(node => node.open) !== open) await fileMenu.locator('summary').click()
    }
    const createNativeFile = async (format, expected) => {
      await setFileMenu(true)
      await studio.getByLabel('New design file name', { exact: true }).fill('g0-manual')
      await studio.getByRole('button', { name: `Create ${format.toUpperCase()} file`, exact: true }).click()
      await expectDisk(expected, `g0-manual.${format}`)
      await waitReady(`g0-manual.${format}`, expected)
      await setFileMenu(false)
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
    await waitReady('g0-art.svg', changed)

    const createdHtml = '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<title>Nouvelle page</title>\n</head>\n<body>\n' +
      '<h1 id="titre">Nouvelle page</h1>\n<p id="intro">Modifiez ce texte depuis le canevas.</p>\n</body>\n</html>\n'
    // Independent expected bytes: creation must write the native template, not a
    // document inferred from whatever the UI happened to write.
    await createNativeFile('html', createdHtml)
    const htmlFrame = studio.frameLocator('iframe[title="Isolated design preview"]')
    await htmlFrame.locator('#titre').click()
    record('sidebar UI creates native HTML', 'PASS', 'g0-manual.html exact template on disk; heading rendered and selected by real preview click')
    await studio.getByRole('textbox', { name: 'HTML element text', exact: true }).fill('Titre modifié sans IA')
    await studio.getByRole('button', { name: 'Apply HTML element text', exact: true }).click()
    const editedHtml = createdHtml.replace('>Nouvelle page</h1>', '>Titre modifié sans IA</h1>')
    await expectDisk(editedHtml, 'g0-manual.html')
    await waitReady('g0-manual.html', editedHtml)
    await htmlFrame.getByRole('heading', { name: 'Titre modifié sans IA', exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await studio.getByRole('button', { name: 'Undo saved edit', exact: true }).click()
    await expectDisk(createdHtml, 'g0-manual.html')
    await waitReady('g0-manual.html', createdHtml)
    await htmlFrame.getByRole('heading', { name: 'Nouvelle page', exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    record('sidebar HTML text save and Undo are byte-exact', 'PASS', 'only heading text changed; Undo restored complete original HTML and preview')

    const widths = {}
    for (const [mode, expected] of [['desktop', 1280], ['tablet', 768], ['mobile', 390]]) {
      await studio.getByRole('button', { name: 'HTML viewport ' + mode, exact: true }).click()
      await page.waitForFunction(({ mode, expected }) => {
        const editor = document.querySelector('[aria-label="Design Studio panel"] .dsh-studio-workbench')
        const frame = editor?.querySelector('iframe[title="Isolated design preview"]')
        return editor?.querySelector('[aria-label="HTML viewport ' + mode + '"]')?.getAttribute('aria-pressed') === 'true' &&
          frame && Math.abs(frame.getBoundingClientRect().width - expected) <= 1 &&
          Math.abs(frame.contentWindow.innerWidth - expected) <= 1
      }, { mode, expected }, { timeout: 15000 })
      widths[mode] = {
        element: await studio.locator('iframe[title="Isolated design preview"]').evaluate(frame => frame.getBoundingClientRect().width),
        viewport: await htmlFrame.locator('html').evaluate(() => window.innerWidth),
      }
    }
    await expectDisk(createdHtml, 'g0-manual.html')
    record('sidebar HTML responsive preview widths are measured', 'PASS', JSON.stringify(widths) + '; HTML bytes unchanged')

    const css = ':root {\n  --accent: #bda991;\n}\n\nbody {\n  font-family: system-ui, sans-serif;\n  color: #1f2124;\n}\n'
    await createNativeFile('css', css)
    await studio.getByRole('button', { name: 'Select CSS rule body', exact: true }).click()
    record('sidebar UI creates native CSS', 'PASS', 'g0-manual.css exact template on disk; native body rule inspector opened')
    await studio.getByLabel('CSS rule property', { exact: true }).selectOption('color')
    await studio.getByLabel('CSS rule value', { exact: true }).fill('#123456')
    await studio.getByRole('button', { name: 'Apply CSS rule style', exact: true }).click()
    const editedCss = css.replace('color: #1f2124', 'color: #123456')
    await expectDisk(editedCss, 'g0-manual.css')
    await waitReady('g0-manual.css', editedCss)
    await studio.getByRole('button', { name: 'Undo saved edit', exact: true }).click()
    await expectDisk(css, 'g0-manual.css')
    await waitReady('g0-manual.css', css)
    record('sidebar CSS rule save and Undo are byte-exact', 'PASS', 'only body color changed; Undo restored complete original CSS')

    // Conditional CSS in the real product: the @media row is a separate target
    // addressed by position, and its edit is a byte-exact native patch.
    const mediaCss = css + '\n@media (max-width: 600px) {\n  body {\n    color: #654321;\n  }\n}\n'
    await writeFile(path.join(workspaceDir, 'g0-manual.css'), mediaCss, 'utf8')
    // Remount the panel so the file is re-read from disk by a real user action.
    await panel.getByLabel('Workspace', { exact: true }).selectOption(otherWorkspaceId)
    await panel.getByRole('button', { name: 'Refresh workspace design files', exact: true }).waitFor()
    await panel.getByLabel('Workspace', { exact: true }).selectOption(workspaceId)
    await setFileMenu(true)
    await studio.getByLabel('Workspace file', { exact: true }).fill('g0-manual.css')
    await studio.getByRole('button', { name: 'Open', exact: true }).click()
    await waitReady('g0-manual.css', mediaCss)
    await setFileMenu(false)
    const conditionalRow = studio.getByRole('button', {
      name: 'Select conditional CSS rule (max-width: 600px) body block 1', exact: true })
    await conditionalRow.waitFor({ state: 'visible', timeout: 20000 })
    await conditionalRow.click()
    await studio.getByLabel('Conditional CSS rule property', { exact: true }).selectOption('color')
    await studio.getByLabel('Conditional CSS rule value', { exact: true }).fill('#0f0f0f')
    await studio.getByRole('button', { name: 'Apply conditional CSS rule style', exact: true }).click()
    const editedMedia = mediaCss.replace('color: #654321', 'color: #0f0f0f')
    await expectDisk(editedMedia, 'g0-manual.css')
    await waitReady('g0-manual.css', editedMedia)
    if (editedMedia.includes('#123456') === false && !editedMedia.includes('color: #1f2124')) {
      throw new Error('the unconditional rule must keep its own value')
    }
    await studio.getByRole('button', { name: 'Undo saved edit', exact: true }).click()
    await expectDisk(mediaCss, 'g0-manual.css')
    await waitReady('g0-manual.css', mediaCss)
    record('sidebar conditional CSS edit is byte-exact in real DSH',
      'PASS', 'simple @media row edited by position in the real panel; only that value changed; Undo restored exact bytes')

    // Deliberate external-writer fixture, confined to the newly created file.
    const external = mediaCss + '/* external writer wins exactly */\n'
    await writeFile(path.join(workspaceDir, 'g0-manual.css'), external, 'utf8')
    // Back to the unconditional rule: the conflict is proven on the normal path,
    // so the conditional selection must not linger as the edit target.
    await studio.getByRole('button', { name: 'Select CSS rule body', exact: true }).click()
    await studio.getByLabel('CSS rule value', { exact: true }).fill('#abcdef')
    Object.assign(refusalEvidence, { active: true, confirmed: false, requestCount: 0,
      url: new URL('/design-studio-native/apply', page.url()).href })
    const countRequest = request => {
      if (request.url() === refusalEvidence.url && request.method() === 'POST') refusalEvidence.requestCount += 1
    }
    page.on('request', countRequest)
    try {
      const refusedResponse = page.waitForResponse(response => {
        if (response.url() !== refusalEvidence.url || response.request().method() !== 'POST') return false
        const payload = response.request().postDataJSON()
        return payload?.workspaceId === workspaceId && !payload.sessionId &&
          payload.file === 'g0-manual.css' && payload.kind === 'css-rule' && payload.value === '#abcdef'
      }, { timeout: 15000 })
      const [response] = await Promise.all([refusedResponse,
        studio.getByRole('button', { name: 'Apply CSS rule style', exact: true }).click()])
      const body = await response.json()
      const alert = studio.getByRole('alert')
      await alert.waitFor({ state: 'visible', timeout: 15000 })
      const feedback = await alert.innerText()
      if (response.status() !== 409 || body?.error !== 'stale-revision' || refusalEvidence.requestCount !== 1 ||
          !/changed|revision|identity|reload|recharg/i.test(feedback)) {
        throw new Error(`External conflict was not explicitly refused: HTTP ${response.status()}, ${JSON.stringify(body)}, ${feedback}`)
      }
      if (await readFile(path.join(workspaceDir, 'g0-manual.css'), 'utf8') !== external) {
        throw new Error('Refused stale CSS edit overwrote external bytes')
      }
      refusalEvidence.confirmed = true
      record('sidebar external conflict refuses stale CSS save', 'PASS', 'one real UI apply → HTTP409 stale-revision + visible feedback; external bytes unchanged')
    } finally {
      refusalEvidence.active = false
      page.removeListener('request', countRequest)
    }
    // Explicit recovery adopts the external revision before returning to SVG.
    const reload = studio.getByRole('button', { name: 'Reload after save error', exact: true })
    if (await reload.count()) await reload.click()
    else await studio.getByRole('button', { name: 'Recharger le fichier', exact: true }).click()
    await waitReady('g0-manual.css', external)
    await expectDisk(external, 'g0-manual.css')
    await setFileMenu(true)
    await studio.getByLabel('New design file name', { exact: true }).fill('g0-slides')
    await studio.getByRole('button', { name: '+ Présentation', exact: true }).click()
    const slides = studio.getByRole('region', { name: 'Diapositives' })
    await slides.getByRole('button', { name: 'Diapositive 1', exact: true }).waitFor()
    await setFileMenu(false)
    const deckPath = path.join(workspaceDir, 'g0-slides.html')
    const deck = await readFile(deckPath, 'utf8')
    await slides.getByRole('textbox', { name: 'Titre de la nouvelle diapositive' }).fill('Real DSH slide')
    await slides.getByRole('button', { name: 'Ajouter une diapositive', exact: true }).click()
    const slidePreview = studio.frameLocator('iframe[title="Isolated design preview"]')
    await slidePreview.getByText('Real DSH slide', { exact: true }).waitFor()
    if (!(await readFile(deckPath, 'utf8')).includes('Real DSH slide')) {
      throw new Error('Slide title did not write through the real Host')
    }
    await studio.getByRole('button', { name: 'Undo saved edit', exact: true }).click()
    await expectDisk(deck, 'g0-slides.html')
    await waitReady('g0-slides.html', deck)
    record('sidebar presentation creates an HTML deck, adds a slide and undoes exactly',
      'PASS', 'real sidebar, on-disk title and byte-exact Undo')
    await setFileMenu(true)
    await studio.getByLabel('Workspace file', { exact: true }).fill('g0-art.svg')
    await studio.getByRole('button', { name: 'Open', exact: true }).click()
    await waitReady('g0-art.svg', changed)
    await setFileMenu(false)
    await renderedBox.waitFor({ state: 'visible', timeout: 15000 })
    return studio
  } finally {
    await page.evaluate(() => {
      document.querySelector('[data-dsh-e2e-theme-probe]')?.remove()
      delete window.__dshE2eMeasureTheme
    })
  }
}

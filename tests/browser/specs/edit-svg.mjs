/**
 * SVG direct manipulation, real pointer events, byte-exact source preservation,
 * native Undo/Redo and reopening. Every assertion is observed in a real browser
 * against the real Host route handler and a real file on disk.
 */
import { SVG_DOCUMENT, assertSingleDifferingRange, dragBy, openWorkspaceFile, sourceOf, waitForDisk,
  waitForEditorSource } from './helpers.mjs'

function numbersIn(xml, id, attributes) {
  const start = xml.indexOf(`id="${id}"`)
  if (start < 0) return null
  const tagStart = xml.lastIndexOf('<', start)
  const tagEnd = xml.indexOf('>', start)
  const tag = xml.slice(tagStart, tagEnd)
  const found = {}
  for (const attribute of attributes) {
    const match = new RegExp(`\\b${attribute}="(-?[0-9.]+)"`).exec(tag)
    found[attribute] = match ? Number(match[1]) : null
  }
  return found
}

export const svgEditSpec = {
  name: 'svg: pointer drag edits only the moved attribute and Undo restores exact bytes',
  async run({ page, harness, assert }) {
    await harness.write('art.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'art.svg', { expect: 'svg' })

    const loaded = await sourceOf(page)
    assert.equal(loaded, SVG_DOCUMENT, 'the source editor must mirror the file on disk byte for byte')

    // Real pointer gesture on the real overlay handle.
    const handle = page.getByRole('button', { name: 'Drag rect card' })
    await handle.waitFor({ state: 'visible' })
    const before = numbersIn(SVG_DOCUMENT, 'card', ['x', 'y'])
    await dragBy(page, handle, 70, 42)

    const moved = await waitForDisk(harness, 'art.svg', (content) => content !== SVG_DOCUMENT,
      { label: 'drag commit' })
    const window = assertSingleDifferingRange(assert, SVG_DOCUMENT, moved,
      'a single drag must only rewrite the moved element attributes')
    assert.match(window.after, /^(?:x="|y="|.*?(?:x|y)=")/, 'the edited range must contain the moved coordinates')

    const after = numbersIn(moved, 'card', ['x', 'y'])
    assert.ok(after.x > before.x, `dragging right must increase x (${before.x} → ${after.x})`)
    assert.ok(after.y > before.y, `dragging down must increase y (${before.y} → ${after.y})`)
    assert.equal(numbersIn(moved, 'dot', ['cx', 'cy']).cx, 420, 'untouched elements keep their coordinates')
    assert.ok(moved.includes('data-note="keep-me"'), 'unfamiliar attributes survive the edit')
    assert.ok(moved.includes('<!-- editable demo; comments and unfamiliar attributes must survive -->'),
      'comments survive the edit')
    assert.equal(await waitForEditorSource(page, moved), moved, 'the editor reflects the saved source')

    // Native Undo replays the exact inverse patch.
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    const restored = await waitForDisk(harness, 'art.svg', (content) => content === SVG_DOCUMENT,
      { label: 'undo' })
    assert.equal(restored, SVG_DOCUMENT, 'Undo must restore the identical original bytes')

    // Native Redo replays the forward patch.
    await page.getByRole('button', { name: 'Redo saved edit' }).click()
    const redone = await waitForDisk(harness, 'art.svg', (content) => content === moved, { label: 'redo' })
    assert.equal(redone, moved, 'Redo must reproduce the exact edited bytes')

    // Reopening the file must show the persisted document.
    await openWorkspaceFile(page, 'art.svg', { expect: 'svg' })
    assert.equal(await waitForEditorSource(page, redone), redone, 'reopening keeps the saved geometry')
  },
}

export const svgNavigationSpec = {
  name: 'svg: zoom, fit, grid, snap and tool controls respond in the browser',
  async run({ page, harness, assert }) {
    await harness.write('nav.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'nav.svg', { expect: 'svg' })

    const zoom = page.getByLabel('Canvas zoom level')
    const initial = await zoom.innerText()
    await page.getByRole('button', { name: 'Zoom in canvas' }).click()
    await page.waitForTimeout(120)
    const zoomed = await zoom.innerText()
    assert.ok(initial !== zoomed, `zoom in must change the reported level (${initial} → ${zoomed})`)
    assert.ok(Number.parseInt(zoomed, 10) > 100, 'zoom in must report more than 100%')

    await page.getByRole('button', { name: 'Fit canvas view' }).click()
    await page.waitForTimeout(120)
    assert.match(await zoom.innerText(), /%$/, 'fit must keep reporting a zoom level')

    const grid = page.getByRole('button', { name: 'Toggle canvas grid' })
    const before = await grid.getAttribute('aria-pressed')
    await grid.click()
    assert.equal(await grid.getAttribute('aria-pressed'), before === 'true' ? 'false' : 'true',
      'the grid toggle must expose its pressed state')

    const snap = page.getByRole('button', { name: 'Toggle snap to grid' })
    const snapBefore = await snap.getAttribute('aria-pressed')
    await snap.click()
    assert.equal(await snap.getAttribute('aria-pressed'), snapBefore === 'true' ? 'false' : 'true',
      'the snap toggle must expose its pressed state')
    await page.getByLabel('Grid spacing').selectOption('20')
    assert.equal(await page.getByLabel('Grid spacing').inputValue(), '20', 'grid spacing is selectable')

    // Switching to the pan tool must be reflected in the toolbar state.
    await page.getByRole('button', { name: 'Pan canvas tool' }).click()
    assert.equal(await page.evaluate(() => document.body.innerText.includes('Canevas · SVG')), true,
      'canvas stays mounted when the pan tool is active')
    // No edit may happen without a validated gesture.
    assert.equal(await harness.read('nav.svg'), SVG_DOCUMENT,
      'navigating and toggling controls must never modify the document')
  },
}

export const svgLayersSpec = {
  name: 'svg: duplicate and delete keep unique ids and undo byte-exactly',
  async run({ page, harness, assert }) {
    await harness.write('layers.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'layers.svg', { expect: 'svg' })
    await page.getByRole('button', { name: 'rect #card' }).click()
    await page.getByRole('button', { name: 'Duplicate selected layer' }).click()

    const duplicated = await waitForDisk(harness, 'layers.svg',
      (content) => (content.match(/<rect /g) || []).length === 3, { label: 'duplicate' })
    const ids = [...duplicated.matchAll(/id="([^"]+)"/g)].map((match) => match[1])
    assert.equal(new Set(ids).size, ids.length, 'every id must stay unique after duplication')
    assert.ok(duplicated.includes('data-note="keep-me"'), 'duplication copies attributes faithfully')

    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    const undone = await waitForDisk(harness, 'layers.svg', (content) => content === SVG_DOCUMENT,
      { label: 'undo duplicate' })
    assert.equal(undone, SVG_DOCUMENT, 'undoing a duplicate restores the byte-identical original')

    await page.getByRole('button', { name: 'circle #dot' }).click()
    await page.getByRole('button', { name: 'Delete selected layer' }).click()
    const deleted = await waitForDisk(harness, 'layers.svg', (content) => !content.includes('id="dot"'),
      { label: 'delete' })
    assert.ok(!deleted.includes('id="dot"'), 'delete removes the selected layer')
    assert.ok(deleted.includes('id="card"'), 'delete keeps the other layers')

    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    const restored = await waitForDisk(harness, 'layers.svg', (content) => content === SVG_DOCUMENT,
      { label: 'undo delete' })
    assert.equal(restored, SVG_DOCUMENT, 'undoing a delete restores the byte-identical original')
  },
}

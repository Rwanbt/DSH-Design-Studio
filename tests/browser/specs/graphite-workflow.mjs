import { SVG_DOCUMENT, openWorkspaceFile, openFileMenu, waitForDisk } from './helpers.mjs'

export const graphiteCreationToolSpec = {
  name: 'graphite: creation tools arm without writes and place the shape at the real canvas click',
  async run({ page, harness, assert }) {
    await harness.write('create-at.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'create-at.svg', { expect: 'svg' })
    await page.getByRole('button', { name: 'Add rect', exact: true }).click()
    assert.equal(await harness.read('create-at.svg'), SVG_DOCUMENT, 'arming Rectangle is not a disk edit')
    assert.equal(await page.getByRole('button', { name: 'Add rect', exact: true }).getAttribute('aria-pressed'), 'true')
    const overlay = page.getByLabel('Direct manipulation overlay')
    const box = await overlay.boundingBox()
    const artboardWidth = box.width
    const artboardHeight = box.height
    const response = page.waitForResponse(value => value.url().includes('/design-studio-native/apply') &&
      value.request().postDataJSON()?.kind === 'svg-add-shape')
    await overlay.click({ position: { x: box.width / 4, y: box.height / 2 } })
    const saved = await response
    assert.equal(saved.status(), 200)
    const payload = saved.request().postDataJSON()
    assert.equal(payload.shape, 'rect')
    // The click maps through the artboard transform, so assert the invariants
    // that must hold in every engine instead of a layout-dependent number.
    assert.ok(Number.isFinite(payload.x) && Number.isFinite(payload.y), 'coordinates must be finite numbers')
    for (const [axis, value] of [['x', payload.x], ['y', payload.y]]) {
      assert.ok(value >= -1 && value <= 681, `${axis} must stay within the visible artboard range, got ${value}`)
    }
    const created = await waitForDisk(harness, 'create-at.svg', text => text.includes('id="shape-1"'),
      { label: 'shape creation' })
    const storedX = Math.round(payload.x * 1000) / 1000
    const storedY = Math.round(payload.y * 1000) / 1000
    assert.ok(created.includes(`x="${storedX}" y="${storedY}"`), 'the file stores the actual mapped pointer position')
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    assert.equal(await waitForDisk(harness, 'create-at.svg', text => text === SVG_DOCUMENT), SVG_DOCUMENT)
    await page.getByRole('button', { name: 'Add rect', exact: true }).click()
    const overlayAgain = page.getByLabel('Direct manipulation overlay')
    const again = await overlayAgain.boundingBox()
    const second = page.waitForResponse(value => value.url().includes('/design-studio-native/apply') &&
      value.request().postDataJSON()?.kind === 'svg-add-shape')
    await overlayAgain.click({ position: { x: Math.round(again.width * 0.7), y: Math.round(again.height * 0.2) } })
    const secondPayload = (await second).request().postDataJSON()
    assert.ok(!(Math.abs(secondPayload.x - payload.x) < 0.01 && Math.abs(secondPayload.y - payload.y) < 0.01),
      'two different clicks must create two different native positions')
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    assert.equal(await waitForDisk(harness, 'create-at.svg', text => text === SVG_DOCUMENT), SVG_DOCUMENT)
    await page.getByRole('button', { name: 'Select canvas tool' }).focus()
    await page.keyboard.press('t')
    assert.equal(await page.getByRole('button', { name: 'Add text', exact: true }).getAttribute('aria-pressed'), 'true',
      'the advertised T shortcut activates the real text tool')
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('button', { name: 'Select canvas tool' }).getAttribute('aria-pressed'), 'true')
  },
}

export const graphiteDraftSpec = {
  name: 'graphite: a text draft survives property edits, layer changes and new-file attempts until explicitly handled',
  async run({ page, harness, assert }) {
    await harness.write('draft.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'draft.svg', { expect: 'svg' })
    await page.getByRole('button', { name: 'Select layer text #title' }).click()
    await page.getByLabel('Text content').fill('Keep my manual draft')
    await page.getByLabel('Fill hex').fill('#112233')
    await page.getByLabel('Fill hex').blur()
    await page.getByRole('alert').waitFor({ state: 'visible' })
    assert.equal(await page.getByLabel('Text content').inputValue(), 'Keep my manual draft')
    assert.equal(await harness.read('draft.svg'), SVG_DOCUMENT, 'a property save cannot destroy pending text')
    await page.getByRole('button', { name: 'Select layer rect #card' }).click()
    assert.equal(await page.getByLabel('Text content').inputValue(), 'Keep my manual draft', 'selection cannot silently drop text')
    await openFileMenu(page)
    await page.getByLabel('New design file name').fill('must-not-be-created')
    await page.getByRole('button', { name: 'Create SVG file', exact: true }).click()
    assert.equal(harness.requests.filter(request => request.path.endsWith('/create')).length, 0,
      'new-file creation must be refused before writing, not after writing then failing to open')
    await page.locator('.dsh-studio-top details.dsh-studio-menu > summary').click()
    await page.getByRole('button', { name: 'Discard text draft' }).click()
    assert.equal(await page.getByLabel('Text content').inputValue(), 'Title')
    await page.getByRole('button', { name: 'Select layer rect #card' }).click()
    assert.equal(await page.getByLabel('Geometry width').inputValue(), '240')
  },
}

export const graphiteExportSpec = {
  name: 'graphite: preview and export use the current native document without a new window or a rewrite',
  async run({ page, harness, assert }) {
    await harness.write('export.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'export.svg', { expect: 'svg' })
    await page.getByRole('button', { name: 'Preview native document' }).click()
    assert.equal(await page.locator('.dsh-studio-sidebar').isVisible(), false)
    assert.equal(await page.getByLabel('Direct manipulation overlay').isVisible(), false)
    assert.equal(await page.locator('iframe[title="Isolated SVG preview"]').isVisible(), true)
    assert.equal(await harness.read('export.svg'), SVG_DOCUMENT)
    await page.getByRole('button', { name: 'Preview native document' }).click()
    assert.equal(await page.locator('.dsh-studio-inspector').isVisible(), true)
    const received = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export native document' }).click()
    const download = await received
    assert.equal(download.suggestedFilename(), 'export.svg')
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    assert.equal(Buffer.concat(chunks).toString('utf8'), SVG_DOCUMENT,
      'export must deliver the exact saved native bytes, not a regenerated scene')
    assert.equal(await harness.read('export.svg'), SVG_DOCUMENT)
  },
}

export const graphiteOpacitySpec = {
  name: 'graphite: the reference opacity slider writes a native value and undoes it exactly',
  async run({ page, harness, assert }) {
    await harness.write('opacity.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'opacity.svg', { expect: 'svg' })
    await page.getByRole('button', { name: 'Select layer rect #card' }).click()
    const slider = page.getByRole('slider', { name: 'Opacity', exact: true })
    assert.equal(await slider.inputValue(), '100')
    await slider.focus()
    await page.keyboard.press('Home')
    const changed = await waitForDisk(harness, 'opacity.svg', text => text.includes('opacity="0"'))
    assert.ok(changed.includes('id="card"') && changed.includes('fill="#bda991"'), 'opacity does not replace paint')
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    assert.equal(await waitForDisk(harness, 'opacity.svg', text => text === SVG_DOCUMENT), SVG_DOCUMENT)
  },
}

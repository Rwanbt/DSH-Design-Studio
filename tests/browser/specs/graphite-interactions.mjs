import { readFile } from 'node:fs/promises'
import { openWorkspaceFile, waitForDisk } from './helpers.mjs'

export const graphiteEllipseSpec = {
  name: 'graphite: ellipse inspector uses bounding-box X/Y/W/H and saves one reversible native operation',
  async run({ page, harness, assert }) {
    const source = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">\n' +
      '<ellipse id="orb" cx="80" cy="70" rx="30" ry="20" fill="#bda991"/>\n</svg>\n'
    await harness.write('ellipse.svg', source)
    await openWorkspaceFile(page, 'ellipse.svg', { expect: 'svg' })
    await page.getByRole('button', { name: 'Select layer ellipse #orb' }).click()
    assert.equal(await page.getByLabel('Geometry x', { exact: true }).inputValue(), '50', 'X is the left edge, not cx')
    assert.equal(await page.getByLabel('Geometry y', { exact: true }).inputValue(), '50', 'Y is the top edge, not cy')
    assert.equal(await page.getByLabel('Geometry width', { exact: true }).inputValue(), '60', 'W is the diameter, not rx')
    assert.equal(await page.getByLabel('Geometry height', { exact: true }).inputValue(), '40', 'H is the diameter, not ry')
    const editResponse = page.waitForResponse(response => response.url().includes('/design-studio-native/apply') &&
      response.request().method() === 'POST')
    await page.getByLabel('Geometry width', { exact: true }).fill('100')
    await page.getByLabel('Geometry width', { exact: true }).blur()
    const response = await editResponse
    assert.equal(response.status(), 200)
    const payload = response.request().postDataJSON()
    assert.equal(payload.kind, 'svg-attributes', 'bbox resize must be a single CAS-guarded batch, not two saves')
    assert.equal(payload.edits.length, 2, 'radius and centre change together to preserve the left edge')
    const edited = await waitForDisk(harness, 'ellipse.svg', text => text.includes('rx="50"'), { label: 'ellipse bbox resize' })
    assert.ok(edited.includes('cx="100"'), 'left edge stays at 50 when width becomes 100')
    assert.ok(edited.includes('cy="70"') && edited.includes('ry="20"'), 'vertical geometry stays byte-identical')
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    assert.equal(await waitForDisk(harness, 'ellipse.svg', text => text === source), source)
  },
}

export const graphiteExampleSpec = {
  name: 'graphite: creating the supplied artwork makes a real native file and never fakes gradient paint',
  async run({ page, harness, assert }) {
    await page.getByLabel('New design file name').fill('graphite-example')
    await page.getByRole('button', { name: 'Create Graphite reference SVG', exact: true }).click()
    await page.waitForSelector('[aria-label="Canvas viewport"]', { timeout: 20000 })
    const file = await page.getByLabel('Workspace file').inputValue()
    const expected = await readFile(new URL('../../../examples/graphite-v3.svg', import.meta.url), 'utf8')
    assert.equal(await harness.read(file), expected, 'the artwork template must be the reference SVG, not an approximation')
    await page.getByRole('button', { name: 'Select layer ellipse #orb' }).click()
    const inspector = page.locator('.dsh-studio-inspector')
    assert.ok((await inspector.innerText()).includes('url(#orbGrad)'), 'the inspector must show the real gradient source')
    assert.equal(await page.getByLabel('Fill colour', { exact: true }).isEnabled(), false,
      'a gradient is not silently replaced by the colour picker fallback')
    const before = await harness.read(file)
    await page.getByRole('button', { name: 'Select layer text #hero-title' }).click()
    assert.equal(await page.getByLabel('Text content').inputValue(), 'Make')
    assert.equal(await harness.read(file), before, 'selection and inspection must never write the artwork')
  },
}

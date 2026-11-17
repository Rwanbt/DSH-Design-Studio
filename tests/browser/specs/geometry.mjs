/**
 * Hit-target geometry: a selection handle must sit exactly where the shape is
 * rendered, and the artboard must never be clipped out of its viewport.
 * This is the regression guard for the artboard fit/coordinate model.
 */
import { openWorkspaceFile } from './helpers.mjs'

const DOCUMENT = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <rect id="bg" x="0" y="0" width="600" height="400" fill="#f4f1ea"/>
  <rect id="card" x="40" y="40" width="240" height="140" fill="#bda991"/>
  <circle id="dot" cx="480" cy="320" r="40" fill="#3a3f45"/>
</svg>
`

/** Screen rectangle a shape occupies given the rendered artboard box. */
function expectedScreenBox(artboardRect, viewBox, shape) {
  const scaleX = artboardRect.width / viewBox.width
  const scaleY = artboardRect.height / viewBox.height
  return {
    x: artboardRect.x + (shape.x - viewBox.x) * scaleX,
    y: artboardRect.y + (shape.y - viewBox.y) * scaleY,
    width: shape.width * scaleX,
    height: shape.height * scaleY,
  }
}

export const handleGeometrySpec = {
  name: 'geometry: selection handles coincide with the rendered shapes, artboard stays fully visible',
  async run({ page, harness, assert }) {
    await harness.write('geometry.svg', DOCUMENT)
    await openWorkspaceFile(page, 'geometry.svg', { expect: 'svg' })

    const artboardRect = await page.locator('.dsh-studio-artboard').boundingBox()
    const viewportRect = await page.locator('[aria-label="Canvas viewport"]').boundingBox()
    assert.ok(artboardRect && viewportRect, 'the artboard and its viewport must be laid out')

    // No clipping: the whole artboard is inside the visible viewport.
    const tolerance = 1.5
    assert.ok(artboardRect.y >= viewportRect.y - tolerance,
      `artboard top ${artboardRect.y} must not be clipped by viewport top ${viewportRect.y}`)
    assert.ok(artboardRect.y + artboardRect.height <= viewportRect.y + viewportRect.height + tolerance,
      'artboard bottom must not be clipped by the viewport')
    assert.ok(artboardRect.x + artboardRect.width <= viewportRect.x + viewportRect.width + tolerance,
      'artboard right edge must not be clipped by the viewport')

    // The artboard keeps the document aspect ratio (otherwise hit targets drift).
    const ratio = artboardRect.width / artboardRect.height
    assert.ok(Math.abs(ratio - 600 / 400) < 0.02,
      `artboard must keep the 600x400 aspect ratio, measured ${ratio.toFixed(3)}`)

    const viewBox = { x: 0, y: 0, width: 600, height: 400 }
    const shapes = {
      card: { x: 40, y: 40, width: 240, height: 140 },
      dot: { x: 440, y: 280, width: 80, height: 80 },
    }
    for (const [id, shape] of Object.entries(shapes)) {
      const handle = await page.getByRole('button', { name: `Drag ${id === 'dot' ? 'circle' : 'rect'} ${id}` })
        .boundingBox()
      const expected = expectedScreenBox(artboardRect, viewBox, shape)
      assert.ok(Math.abs(handle.x - expected.x) <= 2,
        `${id} handle x must match the rendered shape (handle ${handle.x.toFixed(1)}, expected ${expected.x.toFixed(1)})`)
      assert.ok(Math.abs(handle.y - expected.y) <= 2,
        `${id} handle y must match the rendered shape (handle ${handle.y.toFixed(1)}, expected ${expected.y.toFixed(1)})`)
      assert.ok(Math.abs(handle.width - expected.width) <= 2,
        `${id} handle width must match the rendered shape (${handle.width.toFixed(1)} vs ${expected.width.toFixed(1)})`)
    }

    // A pointer press on the rendered circle must select that circle, not a neighbour.
    const dotBox = await page.getByRole('button', { name: 'Drag circle dot' }).boundingBox()
    await page.mouse.click(dotBox.x + dotBox.width / 2, dotBox.y + dotBox.height / 2)
    await page.waitForTimeout(200)
    const inspector = await page.locator('#root').innerText()
    assert.match(inspector, /circle #dot/, 'clicking the rendered shape must select it')
  },
}

export const zoomGeometrySpec = {
  name: 'geometry: zoom keeps the shape under the pointer and pan keeps handles attached',
  async run({ page, harness, assert }) {
    await harness.write('zoom.svg', DOCUMENT)
    await openWorkspaceFile(page, 'zoom.svg', { expect: 'svg' })
    const before = await page.getByRole('button', { name: 'Drag rect card' }).boundingBox()
    const viewport = await page.locator('[aria-label="Canvas viewport"]').boundingBox()
    const pointer = { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 }

    // Ctrl+wheel zoom is anchored at the pointer: the shape grows around it.
    await page.mouse.move(pointer.x, pointer.y)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -240)
    await page.keyboard.up('Control')
    await page.waitForTimeout(300)
    const zoomed = await page.getByRole('button', { name: 'Drag rect card' }).boundingBox()
    assert.ok(zoomed.width > before.width + 1,
      `zooming in must enlarge the shape handle (${before.width.toFixed(1)} → ${zoomed.width.toFixed(1)})`)

    // Panning (hand tool + drag) must move the handle with the artwork.
    await page.getByRole('button', { name: 'Pan canvas tool' }).click()
    await page.mouse.move(pointer.x, pointer.y)
    await page.mouse.down()
    await page.mouse.move(pointer.x + 60, pointer.y + 40, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    const panned = await page.getByRole('button', { name: 'Drag rect card' }).boundingBox()
    assert.ok(Math.abs((panned.x - zoomed.x) - 60) <= 3,
      `pan must move the handle with the artwork horizontally (${(panned.x - zoomed.x).toFixed(1)} vs 60)`)
    assert.ok(Math.abs((panned.y - zoomed.y) - 40) <= 3,
      `pan must move the handle with the artwork vertically (${(panned.y - zoomed.y).toFixed(1)} vs 40)`)
    // Panning and zooming must never write to the document.
    assert.equal(await harness.read('zoom.svg'), DOCUMENT, 'navigation must not modify the file')
  },
}

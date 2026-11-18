/**
 * PNG export from the CURRENT editor source (level 2, real Chromium + Firefox).
 *
 * The feature converts the visible SVG source — including unsaved edits — into
 * an in-memory PNG. These specs prove the two properties that make it safe:
 *
 *  - the Host is never asked to write: zero `POST /apply`, zero request, zero
 *    byte change on disk, no new Undo entry;
 *  - the download is a real PNG (signature + IHDR dimensions, and a sampled
 *    pixel for the unsaved-edit case), while a non-SVG document disables the
 *    control with a visible reason and a declared script is refused outright.
 *
 * Pixel exactness beyond the sampled solid fill is deliberately not claimed:
 * font rasterisation and antialiasing differ between Chromium and Firefox.
 */
import { inflateSync } from 'node:zlib'
import { CSS_DOCUMENT, HTML_DOCUMENT, SVG_DOCUMENT, openWorkspaceFile, sourceOf } from './helpers.mjs'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const applies = (harness) => harness.requests.filter((request) => request.path.endsWith('/apply'))

/** Read a Playwright download completely into a Buffer. */
async function downloadBytes(download) {
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

/** Minimal PNG reader: signature, IHDR fields and concatenated IDAT data. */
function parsePng(buffer) {
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (buffer[index] !== PNG_SIGNATURE[index]) {
      throw new Error(`invalid PNG signature at byte ${index}: ${buffer[index]}`)
    }
  }
  const info = { idat: [] }
  let offset = 8
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      info.width = data.readUInt32BE(0)
      info.height = data.readUInt32BE(4)
      info.bitDepth = data[8]
      info.colorType = data[9]
      info.interlace = data[12]
    } else if (type === 'IDAT') {
      info.idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (!info.width || !info.height) throw new Error('PNG has no readable IHDR')
  if (!info.idat.length) throw new Error('PNG has no IDAT data')
  return info
}

function paeth(left, up, upLeft) {
  const prediction = left + up - upLeft
  const distanceLeft = Math.abs(prediction - left)
  const distanceUp = Math.abs(prediction - up)
  const distanceUpLeft = Math.abs(prediction - upLeft)
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left
  if (distanceUp <= distanceUpLeft) return up
  return upLeft
}

/** Decode a non-interlaced 8-bit RGB/RGBA PNG so a real pixel can be sampled. */
function decodePng(buffer) {
  const info = parsePng(buffer)
  if (info.bitDepth !== 8 || ![2, 6].includes(info.colorType) || info.interlace !== 0) {
    throw new Error(`unsupported PNG shape: bitDepth=${info.bitDepth} colorType=${info.colorType} interlace=${info.interlace}`)
  }
  const channels = info.colorType === 6 ? 4 : 3
  const stride = info.width * channels
  const raw = inflateSync(Buffer.concat(info.idat))
  const pixels = Buffer.alloc(stride * info.height)
  let offset = 0
  for (let y = 0; y < info.height; y += 1) {
    const filter = raw[offset]
    offset += 1
    const row = y * stride
    const previous = row - stride
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[row + x - channels] : 0
      const up = y > 0 ? pixels[previous + x] : 0
      const upLeft = y > 0 && x >= channels ? pixels[previous + x - channels] : 0
      let value = raw[offset]
      offset += 1
      if (filter === 1) value += left
      else if (filter === 2) value += up
      else if (filter === 3) value += Math.floor((left + up) / 2)
      else if (filter === 4) value += paeth(left, up, upLeft)
      else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`)
      pixels[row + x] = value & 0xff
    }
  }
  return {
    width: info.width,
    height: info.height,
    colorType: info.colorType,
    pixel(x, y) {
      const index = y * stride + x * channels
      return [pixels[index], pixels[index + 1], pixels[index + 2]]
    },
  }
}

const near = (actual, expected, tolerance = 2) =>
  actual.length === 3 && actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance)

/** Resolve true if a download event arrives during `action`, false otherwise. */
async function downloadDuring(page, action, timeout = 900) {
  let seen = false
  const listener = () => { seen = true }
  page.on('download', listener)
  try {
    await action()
    await page.waitForTimeout(timeout)
  } finally {
    page.off('download', listener)
  }
  return seen
}

async function revealSource(page) {
  await page.locator('summary').filter({ hasText: 'Code source natif' }).click()
  await page.locator('.dsh-studio-source textarea').waitFor({ state: 'visible', timeout: 10000 })
}

const viewBoxOnlySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">
  <rect id="fond" x="0" y="0" width="300" height="200" fill="#f4f1ea"/>
</svg>
`

const oversizeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="5000" height="100" viewBox="0 0 5000 100">
  <rect id="bande" x="0" y="0" width="5000" height="100" fill="#bda991"/>
</svg>
`


export const pngExportSpec = {
  name: 'png: the current SVG downloads as a valid PNG at 1x and 2x with zero writes and zero Host requests',
  async run({ page, harness, assert }) {
    await harness.write('carte.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'carte.svg', { expect: 'svg' })

    const scale = page.getByLabel('PNG scale')
    assert.deepEqual(await scale.locator('option').allTextContents(), ['1×', '2×'],
      'both requested scales are offered in the real control')
    assert.equal(await scale.inputValue(), '1', '1x is the default')
    assert.equal(await page.getByRole('button', { name: 'Export PNG' }).isEnabled(), true,
      'an SVG document enables the PNG export')

    const requestsBefore = harness.requests.length
    const writesBefore = applies(harness).length

    const firstDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export PNG' }).click()
    const first = await firstDownload
    assert.equal(first.suggestedFilename(), 'carte.png', 'the filename is derived from carte.svg')
    const firstBytes = await downloadBytes(first)
    const firstInfo = parsePng(firstBytes)
    assert.equal(firstInfo.width, 600, 'IHDR width comes from the declared width')
    assert.equal(firstInfo.height, 400, 'IHDR height comes from the declared height')
    assert.equal(firstInfo.bitDepth, 8)
    assert.equal(firstInfo.interlace, 0)
    const firstPixels = decodePng(firstBytes)
    assert.ok(near(firstPixels.pixel(100, 100), [189, 169, 145]),
      'the exported PNG paints the source card fill #bda991')

    assert.equal(await harness.read('carte.svg'), SVG_DOCUMENT,
      'the source file is byte-identical after the export')
    assert.equal(applies(harness).length, writesBefore, 'PNG export sends zero POST /apply')
    assert.equal(harness.requests.length, requestsBefore,
      'PNG export makes zero Host request: the conversion is entirely local')
    assert.equal(await page.getByRole('button', { name: 'Undo saved edit' }).isDisabled(), true,
      'PNG export adds no Undo entry')

    await scale.selectOption('2')
    const secondDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export PNG' }).click()
    const second = await secondDownload
    assert.equal(second.suggestedFilename(), 'carte.png')
    const secondInfo = parsePng(await downloadBytes(second))
    assert.equal(secondInfo.width, 1200, '2x doubles the width')
    assert.equal(secondInfo.height, 800, '2x doubles the height')
    assert.equal(await harness.read('carte.svg'), SVG_DOCUMENT, '2x export still writes nothing')
    assert.equal(applies(harness).length, writesBefore, '2x export still sends zero POST /apply')
    assert.equal(harness.requests.length, requestsBefore, '2x export still makes zero Host request')
  },
}

export const pngUnsavedSourceSpec = {
  name: 'png: an unsaved source edit is rasterised while the file on disk keeps its old bytes',
  async run({ page, harness, assert }) {
    await harness.write('brouillon.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'brouillon.svg', { expect: 'svg' })
    await revealSource(page)

    const edited = SVG_DOCUMENT.replace('fill="#bda991"', 'fill="#2277cc"')
    assert.ok(edited !== SVG_DOCUMENT, 'the fixture edit must really differ')
    await page.locator('.dsh-studio-source textarea').fill(edited)
    await page.waitForFunction((value) =>
      document.querySelector('.dsh-studio-source textarea')?.value === value, edited, { timeout: 10000 })
    assert.equal(await sourceOf(page), edited, 'the editor exposes the edited source')

    const writesBefore = applies(harness).length
    const requestsBefore = harness.requests.length
    const received = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export PNG' }).click()
    const download = await received
    const bytes = await downloadBytes(download)
    const info = parsePng(bytes)
    assert.equal(info.width, 600)
    assert.equal(info.height, 400)
    const pixels = decodePng(bytes)
    assert.ok(near(pixels.pixel(100, 100), [34, 119, 204]),
      'the PNG reflects the unsaved #2277cc fill, not the saved #bda991 source')

    assert.equal(await harness.read('brouillon.svg'), SVG_DOCUMENT,
      'the file on disk still holds the original, saved bytes')
    assert.equal(applies(harness).length, writesBefore,
      'exporting an unsaved source never saves it implicitly')
    assert.equal(harness.requests.length, requestsBefore,
      'exporting an unsaved source makes zero Host request')
    assert.equal(await page.getByRole('button', { name: 'Undo saved edit' }).isDisabled(), true,
      'the unsaved export adds no Undo entry')
  },
}

export const pngNonSvgSpec = {
  name: 'png: HTML and CSS documents disable the export and show the reason',
  allowConsoleErrors: true,
  async run({ page, harness, assert }) {
    await harness.write('page.html', HTML_DOCUMENT)
    await openWorkspaceFile(page, 'page.html', { expect: 'html' })

    const button = page.getByRole('button', { name: 'Export PNG' })
    assert.equal(await button.isDisabled(), true, 'an HTML document disables PNG export')
    assert.equal(await page.getByLabel('PNG scale').isDisabled(), true,
      'the scale control is disabled with the export')
    const reason = page.getByText('PNG : disponible uniquement pour les documents SVG', { exact: true })
    assert.equal(await reason.isVisible(), true, 'the disabled control carries a visible reason')
    assert.equal(await button.getAttribute('aria-describedby'),
      await reason.getAttribute('id'), 'the reason is programmatically linked to the button')
    const topbar = await page.locator('.dsh-studio-top').evaluate((node) =>
      ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }))
    assert.ok(topbar.scrollWidth <= topbar.clientWidth + 1,
      'the reason must fit the real top bar instead of being clipped: ' + JSON.stringify(topbar))
    const reasonBox = await reason.boundingBox()
    const viewport = page.viewportSize()
    assert.ok(reasonBox && reasonBox.x >= 0 && reasonBox.x + reasonBox.width <= viewport.width,
      'the visible reason must be inside the 1280 px viewport: ' + JSON.stringify(reasonBox))
    const htmlDownload = await downloadDuring(page, () => button.evaluate((node) => node.click()))
    assert.equal(htmlDownload, false, 'a disabled export downloads nothing')
    assert.equal(await harness.read('page.html'), HTML_DOCUMENT)

    await harness.write('style.css', CSS_DOCUMENT)
    await openWorkspaceFile(page, 'style.css', { expect: 'css' })
    assert.equal(await page.getByRole('button', { name: 'Export PNG' }).isDisabled(), true,
      'a CSS document disables PNG export')
    assert.equal(await page.getByText('PNG : disponible uniquement pour les documents SVG', { exact: true })
      .isVisible(), true, 'the CSS document shows the same visible reason')
    const cssDownload = await downloadDuring(page, () =>
      page.getByRole('button', { name: 'Export PNG' }).evaluate((node) => node.click()))
    assert.equal(cssDownload, false, 'the CSS document downloads nothing')
    assert.equal(await harness.read('style.css'), CSS_DOCUMENT)
    assert.equal(applies(harness).length, 0, 'disabled exports send zero POST /apply')
  },
}

export const pngScriptRefusalSpec = {
  name: 'png: a source containing <script> is refused explicitly and never downloaded',
  allowConsoleErrors: true,
  async run({ page, harness, assert }) {
    // The Host refuses an SVG that DECLARES a script, so the script arrives the
    // way it does for a user: through the current editor source, unsaved. This
    // is the client-side boundary the export itself must enforce.
    await harness.write('actif.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'actif.svg', { expect: 'svg' })
    await revealSource(page)
    const withScript = SVG_DOCUMENT.replace('<rect id="card"',
      '<script>window.__pngPwned = \'ram\'; window.parent.__pngPwned = \'parent\'</script>\n  <rect id="card"')
    assert.ok(withScript !== SVG_DOCUMENT, 'the script fixture must really differ')
    await page.locator('.dsh-studio-source textarea').fill(withScript)
    await page.waitForFunction((value) =>
      document.querySelector('.dsh-studio-source textarea')?.value === value, withScript, { timeout: 10000 })

    const downloaded = await downloadDuring(page,
      () => page.getByRole('button', { name: 'Export PNG' }).click())
    assert.equal(downloaded, false, 'a script-bearing source must never be downloaded as PNG')
    const alert = page.getByRole('alert').filter({ hasText: /script/i })
    await alert.waitFor({ state: 'visible', timeout: 5000 })
    assert.match(await alert.innerText(), /<script>/,
      'the refusal names the active element instead of pretending to convert it')
    assert.equal(await page.evaluate(() => window.__pngPwned), undefined,
      'the document script never executes in the parent origin')
    assert.equal(await harness.read('actif.svg'), SVG_DOCUMENT,
      'the refused source stays editable and the file on disk is byte-identical')
    assert.equal(applies(harness).length, 0, 'a refusal sends zero POST /apply')
  },
}

export const pngDimensionSpec = {
  name: 'png: viewBox fallback works, invalid or oversized plans are refused without a download',
  // Firefox logs its own XML parser diagnostic for the deliberately malformed
  // source below; the spec asserts the user-visible refusal, not that log.
  allowConsoleErrors: true,
  async run({ page, harness, assert }) {
    await harness.write('viewbox.svg', viewBoxOnlySvg)
    await openWorkspaceFile(page, 'viewbox.svg', { expect: 'svg' })
    const received = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export PNG' }).click()
    const info = parsePng(await downloadBytes(await received))
    assert.equal(info.width, 300, 'without width/height the viewBox width is used')
    assert.equal(info.height, 200, 'without width/height the viewBox height is used')
    assert.equal(await harness.read('viewbox.svg'), viewBoxOnlySvg)

    await harness.write('large.svg', oversizeSvg)
    await openWorkspaceFile(page, 'large.svg', { expect: 'svg' })
    await page.getByLabel('PNG scale').selectOption('2')
    const oversizeDownload = await downloadDuring(page,
      () => page.getByRole('button', { name: 'Export PNG' }).click())
    assert.equal(oversizeDownload, false, 'an output above 8192 px per side is not downloaded')
    const oversizeAlert = page.getByRole('alert')
    await oversizeAlert.waitFor({ state: 'visible', timeout: 5000 })
    const oversizeText = await oversizeAlert.innerText()
    assert.match(oversizeText, /8192/, 'the refusal states the side limit: ' + JSON.stringify(oversizeText))
    assert.match(oversizeText, /10000×200/, 'the refusal states the refused size: ' + JSON.stringify(oversizeText))
    assert.equal(await harness.read('large.svg'), oversizeSvg)

    // A malformed source is refused before any image/canvas work.
    await revealSource(page)
    const broken = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect id="x"'
    await page.locator('.dsh-studio-source textarea').fill(broken)
    const brokenDownload = await downloadDuring(page,
      () => page.getByRole('button', { name: 'Export PNG' }).click())
    assert.equal(brokenDownload, false, 'an invalid SVG source downloads nothing')
    const brokenAlert = page.getByRole('alert')
    await brokenAlert.waitFor({ state: 'visible', timeout: 5000 })
    assert.match(await brokenAlert.innerText(), /invalide/i,
      'the invalid source gets an explicit message')
    assert.equal(await harness.read('large.svg'), oversizeSvg,
      'no refusal path writes the file')
    assert.equal(applies(harness).length, 0, 'no refusal path sends POST /apply')
  },
}

export const pngInertImageSpec = {
  name: 'png: image-mode conversion keeps active attributes inert and fetches no remote asset',
  allowConsoleErrors: true,
  async run({ page, harness, assert }) {
    await harness.write('inerte.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'inerte.svg', { expect: 'svg' })
    await revealSource(page)
    const remote = harness.origin + '/outside-image.png'
    const active = SVG_DOCUMENT
      .replace('<svg xmlns="http://www.w3.org/2000/svg"',
        '<svg onload="window.__pngHandler = \'ran\'" xmlns="http://www.w3.org/2000/svg"')
      .replace('<rect id="card"',
        '<image id="remote" href="' + remote + '" x="300" y="20" width="10" height="10"/>\n  <rect id="card"')
    assert.ok(active !== SVG_DOCUMENT, 'the active fixture must really differ')
    await page.locator('.dsh-studio-source textarea').fill(active)
    await page.waitForFunction((value) =>
      document.querySelector('.dsh-studio-source textarea')?.value === value, active, { timeout: 10000 })
    const requestsBefore = harness.requests.length
    const received = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export PNG' }).click()
    const info = parsePng(await downloadBytes(await received))
    assert.equal(info.width, 600)
    assert.equal(info.height, 400)
    assert.equal(await page.evaluate(() => window.__pngHandler), undefined,
      'the onload attribute of the source never executes during the conversion')
    assert.equal(harness.requests.some((request) => request.path === '/outside-image.png'), false,
      'an external image referenced by the SVG is not fetched in image mode')
    assert.equal(harness.requests.length, requestsBefore,
      'the conversion triggers no Host request even with an external reference')
    assert.equal(await harness.read('inerte.svg'), SVG_DOCUMENT,
      'the source file remains byte-identical')
    assert.equal(applies(harness).length, 0, 'the conversion sends zero POST /apply')
  },
}

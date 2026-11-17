/**
 * Shared helpers for the browser gate.
 * No assertion helpers here: every spec receives `assert` from the runner.
 */

/** Return the single region where two strings differ, plus its context. */
export function diffWindow(before, after) {
  const limit = Math.min(before.length, after.length)
  let prefix = 0
  while (prefix < limit && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (suffix < limit - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1
  return {
    prefix,
    suffix,
    before: before.slice(prefix, before.length - suffix),
    after: after.slice(prefix, after.length - suffix),
    beforeLength: before.length,
    afterLength: after.length,
  }
}

/** Number of differing regions is exactly one for a single attribute edit. */
export function assertSingleDifferingRange(assert, before, after, message) {
  const window = diffWindow(before, after)
  assert.ok(window.before.length > 0 || window.after.length > 0,
    `${message}: expected the document to change`)
  // The unchanged prefix and suffix must together cover every other byte.
  assert.equal(window.prefix + window.suffix + window.before.length, before.length,
    `${message}: bytes after the edited range must be preserved`)
  assert.equal(window.prefix + window.suffix + window.after.length, after.length,
    `${message}: no bytes may be added outside the edited range`)
  return window
}

/** The textarea labelled "Code source natif · avancé" mirrors the loaded document. */
export async function sourceOf(page) {
  return page.locator('.dsh-studio-source textarea').inputValue()
}

/**
 * Wait until the editor shows `expected`, then return it.
 * The Host writes the file before the client finishes reloading it, so an
 * immediate comparison races the reload on slow machines.
 */
export async function waitForEditorSource(page, expected, { timeout = 15000 } = {}) {
  await page.waitForFunction((value) => document.querySelector('.dsh-studio-source textarea')?.value === value, expected,
    { timeout })
  return sourceOf(page)
}

/** Open the real File menu before using the path field (Graphite toolbar). */
export async function openFileMenu(page) {
  const menu = page.locator('.dsh-studio-top details.dsh-studio-menu')
  if (!(await menu.getAttribute('open')) && !(await page.getByLabel('Workspace file').isVisible())) {
    await menu.locator('summary').click()
  }
}

/** Open a workspace file through the visible UI, not a hidden menu input. */
export async function openWorkspaceFile(page, relativePath, { expect, advanced = false } = {}) {
  await openFileMenu(page)
  await page.getByLabel('Workspace file').fill(relativePath)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  const menu = page.locator('.dsh-studio-top details.dsh-studio-menu')
  if (await menu.evaluate(node => node.open)) await menu.locator('summary').click()
  if (expect === 'svg') await page.waitForSelector('[aria-label="Canvas viewport"]', { timeout: 20000 })
  if (expect === 'html') await page.waitForSelector('iframe[title="Isolated design preview"]', { timeout: 20000 })
  if (expect === 'css') await page.waitForSelector('[aria-label="Select CSS rule h1"]', { timeout: 20000 })
  await page.waitForTimeout(250)
  if (advanced) await openAdvancedInspector(page)
}

/** Reveal the native action section using the same visible Inspecter tab as the user. */
export async function openAdvancedInspector(page) {
  await page.getByRole('button', { name: 'Inspecter', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.dsh-studio-technical')?.open === true)
}

/** Drag a pointer from the centre of a locator by a pixel offset. */
export async function dragBy(page, locator, dx, dy) {
  const box = await locator.boundingBox()
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(start.x + (dx * step) / 8, start.y + (dy * step) / 8)
  }
  await page.mouse.up()
}

/** Wait until the on-disk file satisfies `predicate(content)`. */
export async function waitForDisk(harness, file, predicate, { timeout = 15000, label = '' } = {}) {
  const started = Date.now()
  let last = null
  while (Date.now() - started < timeout) {
    last = await harness.read(file)
    if (predicate(last)) return last
    await new Promise((resolve) => setTimeout(resolve, 60))
  }
  throw new Error(`disk file ${file} did not reach the expected state${label ? ` (${label})` : ''}`
    + (last === null ? '' : `; last content begins: ${JSON.stringify(last.slice(0, 220))}`))
}

export const SVG_DOCUMENT = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <!-- editable demo; comments and unfamiliar attributes must survive -->
  <rect id="bg" x="0" y="0" width="600" height="400" fill="#f4f1ea"/>
  <rect id="card" x="40" y="40" width="240" height="140" fill="#bda991" rx="8" data-note="keep-me"/>
  <circle id="dot" cx="420" cy="120" r="48" fill="#3a3f45"/>
  <text id="title" x="60" y="230" font-family="Inter" font-size="28" fill="#202124">Title</text>
</svg>
`

export const HTML_DOCUMENT = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Harness page</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
  <h1 id="headline">Manual editing</h1>
  <p id="lead" class="lead" style="color: #333">Edit this paragraph.</p>
  <button id="cta" type="button">Call to action</button>
</body>
</html>
`

export const CSS_DOCUMENT = `/* native stylesheet */
h1 {
  color: #202124;
  font-size: 32px;
}

.lead {
  color: #555555;
  line-height: 1.5;
}
`

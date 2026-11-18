/**
 * Structural SVG editing through the real UI: hierarchy, visibility, locking,
 * grouping and pivot transforms. Every assertion reads the real file on disk.
 */
import { openWorkspaceFile, waitForDisk } from './helpers.mjs'

const DOCUMENT = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">
  <g id="row">
    <rect id="left" x="20" y="40" width="60" height="40" fill="#bda991"/>
    <rect id="right" x="100" y="40" width="60" height="40" fill="#8a9a7b"/>
  </g>
  <rect id="loose" x="180" y="40" width="40" height="40" fill="#5b6b7b"/>
</svg>
`

export const hierarchySpec = {
  name: 'structure: the layer list shows real nesting depth and hidden/locked state',
  async run({ page, harness, assert }) {
    const document = DOCUMENT
      .replace('<rect id="right"', '<rect id="right" display="none"')
      .replace('<rect id="loose"', '<rect id="loose" data-locked="true"')
    await harness.write('hierarchy.svg', document)
    await openWorkspaceFile(page, 'hierarchy.svg', { expect: 'svg', advanced: true })

    const paddingOf = async (name) => page.getByRole('button', { name }).evaluate((node) => parseFloat(getComputedStyle(node).paddingLeft))
    const groupDepth = await paddingOf('Select layer g #row')
    const childDepth = await paddingOf(/Select layer rect #left/)
    const looseDepth = await paddingOf('Select layer rect #loose')
    assert.ok(childDepth > groupDepth, `a child layer must be indented deeper (${groupDepth} → ${childDepth})`)
    assert.ok(looseDepth < childDepth, 'a root layer must not inherit child indentation')

    const hiddenRow = page.getByRole('button', { name: 'Select layer rect #right (hidden)' })
    assert.equal(await hiddenRow.count(), 1, 'hidden layers are announced as hidden')
    const lockedRow = page.getByRole('button', { name: 'Select layer rect #loose (locked)' })
    assert.equal(await lockedRow.count(), 1, 'locked layers are announced as locked')

    // Selecting a hidden layer must offer to show it again.
    await hiddenRow.click()
    assert.equal(await page.getByRole('button', { name: 'Show selected layer' }).isVisible(), true,
      'a hidden layer offers the show action')
    await page.getByRole('button', { name: 'Show selected layer' }).click()
    const shown = await waitForDisk(harness, 'hierarchy.svg', (content) => !content.includes('display="none"'),
      { label: 'show layer' })
    assert.ok(shown.includes('id="right" x="100"'), 'showing a layer keeps its geometry untouched')
    assert.equal(await harness.read('hierarchy.svg'), document.replace(' display="none"', ''),
      'only the display attribute was removed')
  },
}

export const lockSpec = {
  name: 'structure: locking a layer is written to the file and blocks further visual edits',
  async run({ page, harness, assert }) {
    await harness.write('lock.svg', DOCUMENT)
    await openWorkspaceFile(page, 'lock.svg', { expect: 'svg', advanced: true })
    await page.getByRole('button', { name: 'Select layer rect #loose' }).click()
    await page.getByRole('button', { name: 'Lock selected layer' }).click()
    const locked = await waitForDisk(harness, 'lock.svg', (content) => content.includes('data-locked="true"'),
      { label: 'lock' })
    assert.match(locked, /<rect id="loose"[^>]*data-locked="true"/, 'the lock marker is a real attribute')

    // The UI must now offer to unlock and refuse the action locally. The
    // server-side refusal is proven separately in tests/host-editor-routes.test.mjs
    // ("a locked layer refuses drag-style attribute edits and layer deletion").
    const unlock = page.getByRole('button', { name: 'Unlock selected layer' })
    await unlock.waitFor({ state: 'visible' })
    assert.equal(await page.getByRole('button', { name: 'Hide selected layer' }).isDisabled(), true,
      'the inspector disables the action for a locked layer (client gate)')
    assert.equal(await harness.read('lock.svg'), locked, 'the refused action must not touch the file')

    await unlock.click()
    const unlocked = await waitForDisk(harness, 'lock.svg', (content) => !content.includes('data-locked'),
      { label: 'unlock' })
    assert.equal(unlocked, DOCUMENT, 'unlocking restores the byte-identical original')
  },
}

export const groupSpec = {
  name: 'structure: ctrl-click groups sibling layers into one real <g> and undo restores bytes',
  async run({ page, harness, assert }) {
    const flat = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">
  <rect id="one" x="10" y="10" width="30" height="30" fill="#bda991"/>
  <rect id="two" x="60" y="10" width="30" height="30" fill="#8a9a7b"/>
  <rect id="three" x="110" y="10" width="30" height="30" fill="#5b6b7b"/>
</svg>
`
    await harness.write('group.svg', flat)
    await openWorkspaceFile(page, 'group.svg', { expect: 'svg', advanced: true })

    const groupButton = page.getByRole('button', { name: 'Group selected layers' })
    await page.getByRole('button', { name: 'Select layer rect #one' }).click()
    assert.equal(await groupButton.isDisabled(), true, 'one layer is not a groupable selection')

    await page.getByRole('button', { name: 'Select layer rect #two' }).click({ modifiers: ['ControlOrMeta'] })
    assert.equal(await groupButton.isDisabled(), false, 'two sibling layers can be grouped')
    await groupButton.click()

    const grouped = await waitForDisk(harness, 'group.svg', (content) => content.includes('<g '), { label: 'group' })
    assert.match(grouped, /<g id="[^"]+">/, 'a real group wrapper was inserted')
    const gStart = grouped.indexOf('<g ')
    const gEnd = grouped.indexOf('</g>')
    assert.ok(gStart < grouped.indexOf('id="one"') && gEnd > grouped.indexOf('id="two"'),
      'the wrapper encloses exactly the selected siblings')
    assert.ok(grouped.indexOf('id="three"') > gEnd, 'the unselected sibling stays outside the group')
    assert.ok(grouped.includes('<rect id="one" x="10" y="10" width="30" height="30" fill="#bda991"/>'),
      'grouping does not rewrite the children')

    // The layers panel is the sidebar, not the left rail: query it explicitly.
    await page.waitForFunction(() => /g #/.test(document.querySelector('.dsh-studio-sidebar')?.innerText || ''),
      null, { timeout: 15000 })
    const tree = await page.locator('.dsh-studio-sidebar').innerText()
    assert.match(tree, /g #/, 'the new group appears in the layer tree')

    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    const restored = await waitForDisk(harness, 'group.svg', (content) => content === flat, { label: 'undo group' })
    assert.equal(restored, flat, 'undoing a group restores the byte-identical original')
  },
}

export const ungroupSpec = {
  name: 'structure: ungrouping removes only the wrapper tags',
  async run({ page, harness, assert }) {
    await harness.write('ungroup.svg', DOCUMENT)
    await openWorkspaceFile(page, 'ungroup.svg', { expect: 'svg', advanced: true })
    await page.getByRole('button', { name: 'Select layer g #row' }).click()
    await page.getByRole('button', { name: 'Ungroup selected layer' }).click()
    const ungrouped = await waitForDisk(harness, 'ungroup.svg', (content) => !content.includes('<g '),
      { label: 'ungroup' })
    assert.ok(ungrouped.includes('<rect id="left"'), 'children keep their bytes')
    assert.ok(ungrouped.includes('<rect id="right"'), 'all children survive')
    assert.equal(ungrouped, DOCUMENT.replace('<g id="row">', '').replace('</g>', ''),
      'ungrouping removes exactly the two wrapper tags and keeps the surrounding whitespace')

    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    const restored = await waitForDisk(harness, 'ungroup.svg', (content) => content === DOCUMENT,
      { label: 'undo ungroup' })
    assert.equal(restored, DOCUMENT, 'undo restores the group byte for byte')
  },
}

export const transformSpec = {
  name: 'structure: rotate and scale write one normalised matrix about the shape centre',
  async run({ page, harness, assert }) {
    await harness.write('transform.svg', DOCUMENT)
    await openWorkspaceFile(page, 'transform.svg', { expect: 'svg', advanced: true })
    await page.getByRole('button', { name: 'Select layer rect #loose' }).click()
    await page.getByRole('button', { name: 'Rotate selected layer 90 degrees' }).click()

    const rotated = await waitForDisk(harness, 'transform.svg', (content) => content.includes('transform="matrix('),
      { label: 'rotate' })
    const matrix = /transform="matrix\(([^)]+)\)"/.exec(rotated)[1].split(',').map(Number)
    assert.equal(matrix.length, 6, 'a single normalised matrix is written')
    assert.ok(Math.abs(matrix[0]) < 1e-6 && Math.abs(matrix[1] - 1) < 1e-6, 'a=0, b=1 for a 90° rotation')
    assert.ok(Math.abs(matrix[2] + 1) < 1e-6 && Math.abs(matrix[3]) < 1e-6, 'c=-1, d=0 for a 90° rotation')
    // The pivot is the rendered centre of the shape (180+20, 40+20) = (200, 60).
    assert.ok(Math.abs(matrix[4] - 260) < 1e-3, `e must place the rotation about the centre, got ${matrix[4]}`)
    assert.ok(Math.abs(matrix[5] + 140) < 1e-3, `f must place the rotation about the centre, got ${matrix[5]}`)
    assert.ok(rotated.includes('<rect id="left"'), 'other layers keep every byte')

    await page.getByRole('button', { name: 'Scale selected layer up' }).click()
    const scaled = await waitForDisk(harness, 'transform.svg', (content) => content !== rotated,
      { label: 'scale' })
    const other = /<rect id="loose"[^>]*transform="matrix\(([^)]+)\)"/.exec(scaled)
    assert.ok(other, 'scaling composes onto the existing transform of the same layer')
    const composed = other[1].split(',').map(Number)
    // Rotation then scale-by-1.1 about the centre: the linear part must scale by
    // exactly 1.1 while staying a rotation ([0,1,-1,0] → [0,1.1,-1.1,0]).
    assert.ok(Math.abs(composed[1] - 1.1) < 1e-3,
      `the composed scale must be visible in b (got ${composed[1]})`)
    assert.ok(Math.abs(composed[2] + 1.1) < 1e-3,
      `the composed scale must be visible in c (got ${composed[2]})`)
    assert.ok(Math.abs(composed[0]) < 1e-6 && Math.abs(composed[3]) < 1e-6,
      'the composed matrix stays a pure scale-rotation')
    assert.equal((scaled.match(/transform="matrix\(/g) || []).length, 1,
      'each layer keeps a single transform attribute')

    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    await waitForDisk(harness, 'transform.svg', (content) => content === rotated, { label: 'undo scale' })
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    const back = await waitForDisk(harness, 'transform.svg', (content) => content === DOCUMENT,
      { label: 'undo rotate' })
    assert.equal(back, DOCUMENT, 'undoing both transforms restores the original bytes')
  },
}

export const groupDragSpec = {
  name: 'structure: dragging a group moves it with one transform and keeps children bytes',
  async run({ page, harness, assert }) {
    const grouped = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">
  <g id="row">
    <rect id="left" x="20" y="40" width="60" height="40" fill="#bda991"/>
    <rect id="right" x="100" y="40" width="60" height="40" fill="#8a9a7b"/>
  </g>
  <rect id="loose" x="180" y="40" width="40" height="40" fill="#5b6b7b"/>
</svg>
`
    await harness.write('groupdrag.svg', grouped)
    await openWorkspaceFile(page, 'groupdrag.svg', { expect: 'svg', advanced: true })

    const handle = page.getByRole('button', { name: 'Drag g row' })
    await handle.waitFor({ state: 'visible' })
    const box = await handle.boundingBox()
    assert.ok(box.width > 20, 'the group handle spans the union of its children')

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 8 })
    await page.mouse.up()

    const moved = await waitForDisk(harness, 'groupdrag.svg', (content) => content.includes('transform="matrix('),
      { label: 'group drag' })
    const matrix = /<g id="row"[^>]*transform="matrix\(([^)]+)\)"/.exec(moved)
    assert.ok(matrix, 'the group received a transform attribute')
    const values = matrix[1].split(',').map(Number)
    assert.ok(values[4] > 0 && values[5] > 0, `the translate must follow the drag (got ${values[4]}, ${values[5]})`)
    assert.ok(Math.abs(values[0] - 1) < 1e-6 && Math.abs(values[3] - 1) < 1e-6, 'moving a group is a pure translation')
    assert.ok(moved.includes('<rect id="left" x="20" y="40" width="60" height="40" fill="#bda991"/>'),
      'children keep their own coordinates')
    assert.ok(moved.includes('<rect id="right" x="100" y="40"'), 'siblings inside the group are untouched')
    assert.ok(!/id="loose"[^>]*transform=/.test(moved), 'a layer outside the group is unaffected')

    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    const restored = await waitForDisk(harness, 'groupdrag.svg', (content) => content === grouped,
      { label: 'undo group drag' })
    assert.equal(restored, grouped, 'undo restores the byte-identical original')
  },
}

export const nestedPivotSpec = {
  name: 'structure: rotating a layer inside a translated group keeps its centre fixed',
  async run({ page, harness, assert }) {
    // The parent shifts artwork by 1000 units: a pivot computed in artboard space
    // would displace the shape by the same amount and save that displacement.
    const nested = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 2000 2000">
  <g id="offset" transform="translate(1000,0)">
    <rect id="inner" x="10" y="10" width="20" height="20" fill="#bda991"/>
  </g>
</svg>
`
    await harness.write('pivot.svg', nested)
    await openWorkspaceFile(page, 'pivot.svg', { expect: 'svg', advanced: true })
    await page.getByRole('button', { name: 'Select layer rect #inner' }).click()
    const before = await page.getByRole('button', { name: 'Drag rect inner' }).boundingBox()
    await page.getByRole('button', { name: 'Rotate selected layer 90 degrees' }).click()

    const rotated = await waitForDisk(harness, 'pivot.svg', (content) => content.includes('transform="matrix('),
      { label: 'nested rotate' })
    const matrix = /<rect id="inner"[^>]*transform="matrix\(([^)]+)\)"/.exec(rotated)
    assert.ok(matrix, 'the layer received its own transform')
    const values = matrix[1].split(',').map(Number)
    assert.deepEqual(values.map((value) => Math.round(value * 1e6) / 1e6), [0, 1, -1, 0, 40, 0],
      'the pivot was expressed in the parent space, not in artboard space')
    assert.ok(rotated.includes('<g id="offset" transform="translate(1000,0)">'),
      'the ancestor transform is untouched')

    // The rendered centre must not move, which is what a user perceives.
    const after = await page.getByRole('button', { name: 'Drag rect inner' }).boundingBox()
    const centreBefore = { x: before.x + before.width / 2, y: before.y + before.height / 2 }
    const centreAfter = { x: after.x + after.width / 2, y: after.y + after.height / 2 }
    assert.ok(Math.abs(centreBefore.x - centreAfter.x) <= 2,
      `the visible centre must stay put horizontally (${centreBefore.x} → ${centreAfter.x})`)
    assert.ok(Math.abs(centreBefore.y - centreAfter.y) <= 2,
      `the visible centre must stay put vertically (${centreBefore.y} → ${centreAfter.y})`)

    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    const restored = await waitForDisk(harness, 'pivot.svg', (content) => content === nested,
      { label: 'undo nested rotate' })
    assert.equal(restored, nested, 'undo restores the original bytes')
  },
}

/* ------------------------------------------------------------------------- *
 * Multi-layer alignment
 *
 * The buttons write exactly one coordinate per layer through the single Host
 * batch `svg-attributes`, using the same transform-aware handles as the drag
 * gesture: `x`/`y` are artboard edges and `move.inverse` maps an artboard delta
 * back to local source coordinates. These assertions read the real file bytes
 * and count real Host calls: one gesture = one POST = one Undo step.
 * ------------------------------------------------------------------------- */

const ALIGN_DOCUMENT = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240" viewBox="0 0 400 240">
  <g id="shift" transform="translate(100,20) scale(2)">
    <rect id="a" x="40" y="30" width="60" height="40" fill="#bda991"/>
  </g>
  <rect id="b" x="30" y="120" width="50" height="30" fill="#8a9a7b"/>
  <rect id="c" x="150" y="60" width="80" height="50" fill="#5b6b7b"/>
  <text id="t" x="200" y="200" text-anchor="start" font-size="16" fill="#202124">T</text>
</svg>
`

const ALIGN_REFUSAL_DOCUMENT = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">
  <rect id="solo" x="10" y="10" width="20" height="20" fill="#bda991"/>
  <rect id="free" x="80" y="10" width="20" height="20" fill="#8a9a7b"/>
  <rect id="locked" x="150" y="10" width="20" height="20" fill="#5b6b7b" data-locked="true"/>
  <circle id="roundA" cx="40" cy="100" r="12" fill="#bda991"/>
  <circle id="roundB" cx="100" cy="100" r="12" fill="#8a9a7b"/>
  <rect id="turned" x="60" y="60" width="20" height="20" fill="#bda991" transform="rotate(30)"/>
  <defs>
    <rect id="template" x="0" y="0" width="10" height="10"/>
  </defs>
</svg>
`

const ALIGN_DEGENERATE_DOCUMENT = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100" viewBox="0 0 160 100">
  <g id="broken" transform="matrix(0,0,0,0,0,0)">
    <rect id="ghost" x="10" y="10" width="20" height="20" fill="#bda991"/>
  </g>
  <rect id="solid" x="60" y="10" width="20" height="20" fill="#8a9a7b"/>
</svg>
`

// Minimal HTML with no linked stylesheet, so the CSP of the inert preview
// does not add an unrelated console error to this refusal spec.
const ALIGN_HTML_DOCUMENT = '<!doctype html>\n<html lang="fr"><head><meta charset="utf-8">'
  + '<title>Alignement hors SVG</title></head><body><p id="plain">Texte simple</p></body></html>\n'

const ALIGN_MANY_DOCUMENT = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">\n'
  + Array.from({ length: 17 }, (_, index) =>
    `  <rect id="r${index}" x="${10 + index * 10}" y="10" width="8" height="8" fill="#8a9a7b"/>`).join('\n')
  + '\n</svg>\n'

const ALIGN_LABELS = ['Aligner à gauche', 'Aligner au centre horizontal', 'Aligner à droite',
  'Aligner en haut', 'Aligner au milieu vertical', 'Aligner en bas']

/** Open tag of one element, read from the real file bytes. */
function elementTag(source, id) {
  const marker = 'id="' + id + '"'
  const at = source.indexOf(marker)
  if (at < 0) return ''
  const start = source.lastIndexOf('<', at)
  const end = source.indexOf('>', at)
  return start < 0 || end < 0 ? '' : source.slice(start, end + 1)
}

/** One attribute value from an open tag, or null when absent. */
function attributeOf(tag, name) {
  const match = new RegExp('\\s' + name + '="([^"]*)"').exec(tag)
  return match ? match[1] : null
}

export const alignmentSpec = {
  name: 'align: ctrl-clicked layers align through one svg-attributes write and Undo restores the bytes',
  async run({ page, harness, assert }) {
    // Count the real Host mutations: the byte diff alone would miss a refused
    // extra write, and a single Undo only works if the edit was one batch.
    let applies = 0
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/design-studio-native/apply')) applies += 1
    })
    const button = (name) => page.getByRole('button', { name, exact: true })
    // Selection state appends "(in selection)" (and locked/hidden) to the row's
    // accessible name; a layer row locator must accept those real suffixes.
    const layer = (tag, id) => page.getByRole('button', {
      name: new RegExp('^Select layer ' + tag + ' #' + id + '(?: \\((?:hidden|locked|in selection)\\))*$'),
    })
    const reason = () => page.locator('[data-align-reason]').innerText()

    await harness.write('align.svg', ALIGN_DOCUMENT)
    await openWorkspaceFile(page, 'align.svg', { expect: 'svg' })

    // No selection: the controls exist, are disabled and say why.
    for (const label of ALIGN_LABELS) {
      assert.equal(await button(label).isDisabled(), true, label + ' is disabled without a multi-selection')
    }
    assert.match(await reason(), /au moins deux calques/, 'the visible reason explains the empty selection')
    assert.equal(await harness.read('align.svg'), ALIGN_DOCUMENT, 'the opening state never writes')
    assert.equal(applies, 0)

    // A single layer is still not an alignment operation.
    await layer('rect', 'a').click()
    assert.equal(await button('Aligner à gauche').isDisabled(), true, 'one layer cannot be aligned')
    assert.equal(await harness.read('align.svg'), ALIGN_DOCUMENT, 'a single selection writes nothing')

    // Ctrl-click gives two layers; `a` lives in a translated AND scaled
    // group, so the local x must be computed through the parent inverse:
    // artboard left 180 -> 30, local x = 40 + (30 - 180) / 2 = -35.
    await layer('rect', 'b').click({ modifiers: ['ControlOrMeta'] })
    assert.equal(await button('Aligner à gauche').isDisabled(), false, 'two layers enable the action')
    const before = await harness.read('align.svg')
    await button('Aligner à gauche').click()
    const aligned = await waitForDisk(harness, 'align.svg', (text) => text !== before, { label: 'align left' })
    assert.equal(applies, 1, 'the whole alignment is exactly one Host write')

    const tagA = elementTag(aligned, 'a')
    const tagB = elementTag(aligned, 'b')
    assert.equal(attributeOf(tagA, 'x'), '-35',
      'the transformed child moved in local coordinates through the parent inverse')
    assert.equal(attributeOf(tagB, 'x'), '30', 'the already aligned layer keeps its exact x')
    assert.equal(Number(attributeOf(tagA, 'x')) * 2 + 100, Number(attributeOf(tagB, 'x')),
      'both visible left edges coincide at x=30 in artboard space')
    assert.equal(attributeOf(tagA, 'y'), '30', 'a horizontal alignment never rewrites y')
    assert.equal(attributeOf(tagA, 'width'), '60', 'a horizontal alignment never rewrites width')
    assert.equal(attributeOf(tagA, 'height'), '40', 'a horizontal alignment never rewrites height')
    assert.equal(aligned, before.replace('<rect id="a" x="40"', '<rect id="a" x="-35"'),
      'only that one x attribute changed: every other byte is preserved')
    assert.ok(aligned.includes('<g id="shift" transform="translate(100,20) scale(2)">'),
      'the parent transform is kept byte for byte')

    // Undo is one step: the inverse of the single patch batch.
    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await button('Undo saved edit').click()
    const restored = await waitForDisk(harness, 'align.svg', (text) => text === before, { label: 'undo align' })
    assert.equal(restored, before, 'Undo restores the original bytes exactly')
    assert.equal(applies, 2, 'Undo is one more Host call')

    // Vertical alignment is the symmetric proof: only `y` may change.
    await layer('rect', 'b').click()
    await layer('rect', 'c').click({ modifiers: ['ControlOrMeta'] })
    await button('Aligner en haut').click()
    const vertical = await waitForDisk(harness, 'align.svg',
      (text) => attributeOf(elementTag(text, 'b'), 'y') === '60', { label: 'align top' })
    assert.equal(applies, 3, 'the vertical alignment is a second single write')
    assert.equal(attributeOf(elementTag(vertical, 'b'), 'x'), '30', 'a vertical alignment never rewrites x')
    assert.equal(attributeOf(elementTag(vertical, 'b'), 'width'), '50',
      'a vertical alignment never rewrites width')
    assert.equal(vertical, before.replace('<rect id="b" x="30" y="120"', '<rect id="b" x="30" y="60"'),
      'only the y attribute of the layer that needed it changed')

    // Already aligned: no cosmetic edit and no request at all.
    const noopWrites = applies
    await button('Aligner en haut').click()
    await page.waitForFunction(() =>
      document.querySelector('[data-align-reason]')?.textContent.includes('Déjà aligné'))
    assert.equal(applies, noopWrites, 'an already aligned selection sends no request')
    assert.equal(await harness.read('align.svg'), vertical, 'an already aligned selection changes no byte')

    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await button('Undo saved edit').click()
    await waitForDisk(harness, 'align.svg', (text) => text === before, { label: 'undo vertical align' })
    assert.equal(await harness.read('align.svg'), before, 'undo restores the original bytes again')
    assert.equal(applies, 4, 'Undo is the only remaining Host call')

    // Centre horizontal changes TWO layers in the same batch: the union box
    // centre is 130, so b (30..80) and c (150..230) both move. One POST and one
    // Undo must still cover the whole pair.
    await button('Aligner au centre horizontal').click()
    const centred = await waitForDisk(harness, 'align.svg',
      (text) => attributeOf(elementTag(text, 'b'), 'x') === '105' &&
        attributeOf(elementTag(text, 'c'), 'x') === '90', { label: 'align centre horizontal' })
    assert.equal(applies, 5, 'two coordinate edits are still exactly one Host write')
    assert.equal(Number(attributeOf(elementTag(centred, 'b'), 'x')) + 25, 130,
      'the first box centre meets the selection centre')
    assert.equal(Number(attributeOf(elementTag(centred, 'c'), 'x')) + 40, 130,
      'the second box centre meets the same selection centre')
    assert.equal(centred, before
      .replace('<rect id="b" x="30" y="120"', '<rect id="b" x="105" y="120"')
      .replace('<rect id="c" x="150" y="60"', '<rect id="c" x="90" y="60"'),
    'exactly the two x attributes changed; y, width and every other byte are preserved')

    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await button('Undo saved edit').click()
    await waitForDisk(harness, 'align.svg', (text) => text === before, { label: 'undo centre align' })
    assert.equal(await harness.read('align.svg'), before, 'one Undo restores both layers exactly')
    assert.equal(applies, 6, 'the centre Undo is one Host call')

    // A text layer with an explicit anchor has a provable edge and follows the
    // same single-coordinate rule. (An inherited anchor would be refused.)
    await layer('rect', 'b').click()
    await layer('text', 't').click({ modifiers: ['ControlOrMeta'] })
    await button('Aligner à gauche').click()
    const textAligned = await waitForDisk(harness, 'align.svg',
      (text) => attributeOf(elementTag(text, 't'), 'x') === '30', { label: 'align text left' })
    assert.equal(applies, 7, 'text alignment is still one Host write')
    assert.equal(attributeOf(elementTag(textAligned, 't'), 'y'), '200',
      'text x alignment never rewrites its baseline y')
    assert.equal(textAligned, before.replace('<text id="t" x="200"', '<text id="t" x="30"'),
      'only the text x attribute changed; the anchor and font attributes are untouched')

    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await button('Undo saved edit').click()
    await waitForDisk(harness, 'align.svg', (text) => text === before, { label: 'undo text align' })
    assert.equal(await harness.read('align.svg'), before, 'undo restores the text layer exactly')
    assert.equal(applies, 8, 'the text Undo is one Host call')

    // End-edge branches: the union's right edge is 230, so b (right 80) moves
    // while c (right 230) is already aligned and produces no edit.
    await layer('rect', 'b').click()
    await layer('rect', 'c').click({ modifiers: ['ControlOrMeta'] })
    await button('Aligner à droite').click()
    const rightAligned = await waitForDisk(harness, 'align.svg',
      (text) => attributeOf(elementTag(text, 'b'), 'x') === '180', { label: 'align right' })
    assert.equal(applies, 9, 'right alignment is one Host write')
    assert.equal(attributeOf(elementTag(rightAligned, 'c'), 'x'), '150',
      'the already right-aligned layer is untouched')
    assert.equal(rightAligned, before.replace('<rect id="b" x="30" y="120"', '<rect id="b" x="180" y="120"'),
      'right alignment changes only the x attribute that was out of line')

    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await button('Undo saved edit').click()
    await waitForDisk(harness, 'align.svg', (text) => text === before, { label: 'undo right align' })
    assert.equal(applies, 10, 'the right Undo is one Host call')

    // Bottom edge: the union's bottom is 150, so c (bottom 110) moves to
    // y=100 and b (bottom 150) stays byte-identical.
    await layer('rect', 'b').click()
    await layer('rect', 'c').click({ modifiers: ['ControlOrMeta'] })
    await button('Aligner en bas').click()
    const bottomAligned = await waitForDisk(harness, 'align.svg',
      (text) => attributeOf(elementTag(text, 'c'), 'y') === '100', { label: 'align bottom' })
    assert.equal(applies, 11, 'bottom alignment is one Host write')
    assert.equal(attributeOf(elementTag(bottomAligned, 'c'), 'x'), '150',
      'a vertical alignment never rewrites x')
    assert.equal(bottomAligned, before.replace('<rect id="c" x="150" y="60"', '<rect id="c" x="150" y="100"'),
      'bottom alignment changes only the y attribute that was out of line')

    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await button('Undo saved edit').click()
    await waitForDisk(harness, 'align.svg', (text) => text === before, { label: 'undo bottom align' })
    assert.equal(await harness.read('align.svg'), before, 'undo restores the original bytes after bottom align')
    assert.equal(applies, 12, 'the bottom Undo is one Host call')

    // Middle vertical: the union centre is 105, so both boxes move in one batch.
    await layer('rect', 'b').click()
    await layer('rect', 'c').click({ modifiers: ['ControlOrMeta'] })
    await button('Aligner au milieu vertical').click()
    const middleAligned = await waitForDisk(harness, 'align.svg',
      (text) => attributeOf(elementTag(text, 'b'), 'y') === '90' &&
        attributeOf(elementTag(text, 'c'), 'y') === '80', { label: 'align middle vertical' })
    assert.equal(applies, 13, 'two y edits are still exactly one Host write')
    assert.equal(Number(attributeOf(elementTag(middleAligned, 'b'), 'y')) + 15, 105,
      'the first box centre meets the selection middle')
    assert.equal(Number(attributeOf(elementTag(middleAligned, 'c'), 'y')) + 25, 105,
      'the second box centre meets the same selection middle')
    assert.equal(middleAligned, before
      .replace('<rect id="b" x="30" y="120"', '<rect id="b" x="30" y="90"')
      .replace('<rect id="c" x="150" y="60"', '<rect id="c" x="150" y="80"'),
    'exactly the two y attributes changed; x, width and every other byte are preserved')

    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await button('Undo saved edit').click()
    await waitForDisk(harness, 'align.svg', (text) => text === before, { label: 'undo middle vertical align' })
    assert.equal(await harness.read('align.svg'), before, 'undo restores the original bytes after every mode')
    assert.equal(applies, 14, 'every gesture remained one Host write plus its Undo')
  },
}

export const alignmentRefusalSpec = {
  name: 'align: single, locked, rotated, read-only, non-invertible, cx/cy and >16 selections are refused without writing',
  async run({ page, harness, assert }) {
    let applies = 0
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/design-studio-native/apply')) applies += 1
    })
    const button = (name) => page.getByRole('button', { name, exact: true })
    const layer = (tag, id) => page.getByRole('button', {
      name: new RegExp('^Select layer ' + tag + ' #' + id + '(?: \\((?:hidden|locked|in selection)\\))*$'),
    })
    const reason = () => page.locator('[data-align-reason]').innerText()
    const allDisabled = async () => {
      for (const label of ALIGN_LABELS) {
        assert.equal(await button(label).isDisabled(), true, label + ' must stay disabled')
      }
    }

    await harness.write('align-refus.svg', ALIGN_REFUSAL_DOCUMENT)
    await openWorkspaceFile(page, 'align-refus.svg', { expect: 'svg' })
    await allDisabled()
    assert.match(await reason(), /au moins deux calques/)

    await layer('rect', 'solo').click()
    await allDisabled()
    assert.match(await reason(), /au moins deux calques/, 'a single selection has a visible reason')
    assert.equal(await harness.read('align-refus.svg'), ALIGN_REFUSAL_DOCUMENT, 'a refusal writes nothing')
    assert.equal(applies, 0)

    // Sanity: two unlocked rects really do enable the action.
    await layer('rect', 'free').click({ modifiers: ['ControlOrMeta'] })
    assert.equal(await button('Aligner à gauche').isDisabled(), false,
      'two unlocked rects enable the action before the refusals')
    assert.equal(applies, 0, 'enabling a control never writes')

    // A locked layer blocks the whole selection.
    await layer('rect', 'free').click()
    await layer('rect', 'locked').click({ modifiers: ['ControlOrMeta'] })
    await allDisabled()
    assert.match(await reason(), /verrouillé/, 'the locked layer is named in the reason')
    assert.equal(await harness.read('align-refus.svg'), ALIGN_REFUSAL_DOCUMENT, 'a locked layer writes nothing')
    assert.equal(applies, 0)

    // An invertible rotation is still not a single-axis move: writing x would
    // also change the rendered y, so both axes refuse instead of approximating.
    await layer('rect', 'turned').click()
    await layer('rect', 'free').click({ modifiers: ['ControlOrMeta'] })
    await allDisabled()
    assert.match(await reason(), /rotation\/pivot/, 'a rotated layer names the axis refusal')
    assert.equal(await harness.read('align-refus.svg'), ALIGN_REFUSAL_DOCUMENT,
      'a rotated layer writes nothing')
    assert.equal(applies, 0)

    // Referenced <defs> content is read-only: it is listed as a layer but
    // refused before any coordinate is considered.
    await layer('rect', 'template').click()
    await layer('rect', 'free').click({ modifiers: ['ControlOrMeta'] })
    await allDisabled()
    assert.match(await reason(), /Lecture seule/, 'a read-only layer is named in the reason')
    assert.equal(await harness.read('align-refus.svg'), ALIGN_REFUSAL_DOCUMENT,
      'a read-only layer writes nothing')
    assert.equal(applies, 0)

    // cx/cy layers are refused rather than converted into x/y.
    await layer('circle', 'roundA').click()
    await layer('circle', 'roundB').click({ modifiers: ['ControlOrMeta'] })
    await allDisabled()
    assert.match(await reason(), /cx\/cy/, 'circle geometry is refused without converting the shape')
    assert.equal(await harness.read('align-refus.svg'), ALIGN_REFUSAL_DOCUMENT, 'a cx/cy refusal writes nothing')
    assert.equal(applies, 0)

    // A degenerate ancestor matrix has no invertible handle: the whole
    // operation must refuse instead of guessing a local coordinate.
    await harness.write('align-degenerate.svg', ALIGN_DEGENERATE_DOCUMENT)
    await openWorkspaceFile(page, 'align-degenerate.svg', { expect: 'svg' })
    await layer('rect', 'ghost').click()
    await layer('rect', 'solid').click({ modifiers: ['ControlOrMeta'] })
    await allDisabled()
    assert.match(await reason(), /Géométrie (?:indisponible|non inversible)/,
      'a non-invertible transform is refused explicitly')
    assert.equal(await harness.read('align-degenerate.svg'), ALIGN_DEGENERATE_DOCUMENT,
      'a non-invertible transform writes nothing')
    assert.equal(applies, 0)

    // The Host batch accepts at most 16 edits, so 17 selected layers are
    // refused before building any request.
    await harness.write('align-many.svg', ALIGN_MANY_DOCUMENT)
    await openWorkspaceFile(page, 'align-many.svg', { expect: 'svg' })
    await layer('rect', 'r0').click()
    for (let index = 1; index < 17; index += 1) {
      await layer('rect', 'r' + index).click({ modifiers: ['ControlOrMeta'] })
    }
    await allDisabled()
    assert.match(await reason(), /16 calques maximum/, 'the Host batch limit is named in the reason')
    assert.equal(await harness.read('align-many.svg'), ALIGN_MANY_DOCUMENT, '>16 layers write nothing')
    assert.equal(applies, 0, 'no refusal ever reached the Host')

    // A non-SVG document keeps the section visible but disabled with the reason
    // that actually applies, rather than hiding the controls silently.
    await harness.write('align.html', ALIGN_HTML_DOCUMENT)
    await openWorkspaceFile(page, 'align.html', { expect: 'html' })
    await allDisabled()
    assert.match(await reason(), /n’est pas un SVG/, 'a non-SVG document names its own reason')
    assert.equal(applies, 0, 'a non-SVG document never calls the Host')
  },
}

export const alignLockedAncestorSpec = {
  name: 'align: a layer locked through a named ancestor is refused before any Host call',
  async run({ page, harness, assert }) {
    const source = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">
  <g id="verrou" data-locked="true">
    <rect id="dedans" x="10" y="10" width="60" height="40" fill="#ccbbaa"/>
  </g>
  <rect id="libre" x="200" y="10" width="60" height="40" fill="#bbaa99"/>
</svg>
`
    await harness.write('ancetre.svg', source)
    await openWorkspaceFile(page, 'ancetre.svg', { expect: 'svg' })
    let applies = 0
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/design-studio-native/apply')) applies += 1
    })
    await page.getByRole('button', { name: /^Select layer rect #dedans/ }).click()
    await page.getByRole('button', { name: 'Select layer rect #libre' }).click({ modifiers: ['Control'] })
    const button = page.getByRole('button', { name: 'Aligner à gauche', exact: true })
    assert.equal(await button.isDisabled(), true,
      'a layer locked through its named ancestor must disable the alignment')
    assert.match(await page.locator('[data-align-reason]').innerText(), /verrouill/i)
    assert.equal(applies, 0, 'a refused alignment must not reach the Host')
    assert.equal(await harness.read('ancetre.svg'), source, 'nothing may be written')
  },
}

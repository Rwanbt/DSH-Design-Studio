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

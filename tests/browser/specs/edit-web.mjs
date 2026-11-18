/**
 * HTML visual editing: click-to-select inside the inert preview frame and
 * targeted inline-style writes that preserve every other byte.
 */
import { HTML_DOCUMENT, CSS_DOCUMENT, assertSingleDifferingRange, openFileMenu, openWorkspaceFile, sourceOf,
  waitForDisk, waitForEditorSource } from './helpers.mjs'

export const htmlSelectSpec = {
  allowConsoleErrors: 'csp-only',
  name: 'html: clicking a unique id in the real preview selects it and edits one style declaration',
  async run({ page, harness, assert }) {
    await harness.write('page.html', HTML_DOCUMENT)
    await harness.write('styles.css', CSS_DOCUMENT)
    await openWorkspaceFile(page, 'page.html', { expect: 'html' })

    const frame = page.frameLocator('iframe[title="Isolated design preview"]')
    await frame.locator('#headline').click()
    await page.getByLabel('HTML style property').waitFor({ state: 'visible', timeout: 10000 })
    const inspector = await page.locator('#root').innerText()
    assert.match(inspector, /h1 #headline/, 'the clicked element must become the selected HTML node')

    await page.getByLabel('HTML style property').selectOption('color')
    await page.getByLabel('HTML style value').fill('#bda991')
    await page.getByRole('button', { name: 'Apply HTML visual style' }).click()

    const edited = await waitForDisk(harness, 'page.html', (content) => content !== HTML_DOCUMENT,
      { label: 'html style' })
    const window = assertSingleDifferingRange(assert, HTML_DOCUMENT, edited,
      'an inline style edit must only rewrite the selected element')
    assert.match(window.after, /style="[^"]*#bda991/, 'the changed range must carry the new declaration')
    assert.ok(edited.includes('id="lead" class="lead" style="color: #333"'),
      'unrelated inline styles must stay byte-identical')
    assert.ok(edited.includes('<title>Harness page</title>'), 'the head must be untouched')
    assert.equal(await waitForEditorSource(page, edited), edited, 'the source editor mirrors the saved file')

    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    const restored = await waitForDisk(harness, 'page.html', (content) => content === HTML_DOCUMENT,
      { label: 'undo html style' })
    assert.equal(restored, HTML_DOCUMENT, 'Undo restores the exact original HTML bytes')
  },
}

export const htmlClickInvalidationSpec = {
  name: 'html: preview selection never targets an element without a unique source id',
  async run({ page, harness, assert }) {
    const ambiguous = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>dup</title></head>
<body><p id="dup">first</p><p id="dup">second</p><p class="plain">no id</p></body></html>
`
    await harness.write('dup.html', ambiguous)
    await openWorkspaceFile(page, 'dup.html', { expect: 'html' })
    const frame = page.frameLocator('iframe[title="Isolated design preview"]')
    await frame.locator('.plain').click()
    await page.waitForTimeout(400)
    const text = await page.locator('#root').innerText()
    assert.ok(!/p #plain/.test(text), 'an element without an id must not be silently selected')
    // The edit controls must not appear for an unaddressable element.
    assert.equal(await page.getByLabel('HTML style property').count(), 0,
      'no inline-style editor may be offered without a safe target')
    assert.equal(await harness.read('dup.html'), ambiguous, 'clicking an unaddressable element writes nothing')
  },
}

export const htmlLayoutSpec = {
  allowConsoleErrors: 'csp-only',
  name: 'html: flex/grid preset buttons apply one validated declaration with undo',
  async run({ page, harness, assert }) {
    await harness.write('layout.html', HTML_DOCUMENT)
    await harness.write('styles.css', CSS_DOCUMENT)
    await openWorkspaceFile(page, 'layout.html', { expect: 'html' })
    const frame = page.frameLocator('iframe[title="Isolated design preview"]')
    await frame.locator('#headline').click()
    await page.getByLabel('HTML style property').waitFor({ state: 'visible' })

    // Switch the element to flex first, then use a flex preset.
    const flex = page.getByRole('button', { name: 'Set html layout display to flex' })
    await flex.scrollIntoViewIfNeeded()
    await flex.click()
    const withDisplay = await waitForDisk(harness, 'layout.html',
      (content) => /display:\s*flex/.test(content), { label: 'display flex' })
    assert.match(withDisplay, /style="[^"]*display:\s*flex/, 'the display preset writes a real declaration')

    const justify = page.getByRole('button', { name: 'Set html layout justify-content to center' })
    await justify.scrollIntoViewIfNeeded()
    if (!(await justify.isDisabled())) {
      await justify.click()
      const withJustify = await waitForDisk(harness, 'layout.html',
        (content) => /justify-content:\s*center/.test(content), { label: 'justify-content' })
      assert.match(withJustify, /justify-content:\s*center/, 'the justify preset is applied as a single declaration')
      assert.ok(withJustify.includes('id="lead" class="lead" style="color: #333"'),
        'layout presets must not touch sibling elements')
    }
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    await page.waitForTimeout(400)
    const afterUndo = await harness.read('layout.html')
    assert.ok(!/justify-content/.test(afterUndo), 'undo removes the preset declaration')
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    const back = await waitForDisk(harness, 'layout.html', (content) => content === HTML_DOCUMENT,
      { label: 'undo all layout edits' })
    assert.equal(back, HTML_DOCUMENT, 'undoing every preset restores the byte-identical original')
  },
}

export const cssRuleSpec = {
  name: 'css: a native rule edit rewrites only the targeted declaration and is reversible',
  async run({ page, harness, assert }) {
    await harness.write('theme.css', CSS_DOCUMENT)
    await openWorkspaceFile(page, 'theme.css', { expect: 'css' })
    await page.getByRole('button', { name: 'Select CSS rule h1' }).click()
    await page.getByLabel('CSS rule property').selectOption('font-size')
    await page.getByLabel('CSS rule value').fill('48px')
    await page.getByRole('button', { name: 'Apply CSS rule style' }).click()

    const edited = await waitForDisk(harness, 'theme.css', (content) => content !== CSS_DOCUMENT,
      { label: 'css rule edit' })
    const window = assertSingleDifferingRange(assert, CSS_DOCUMENT, edited,
      'a declaration edit must only rewrite its own value')
    assert.equal(window.before, '32', 'the changed range is exactly the previous value digits')
    assert.equal(window.after, '48', 'the changed range is exactly the new value digits')
    assert.ok(edited.includes('font-size: 48px;'), 'the whole declaration keeps its unit')
    assert.ok(edited.includes('/* native stylesheet */'), 'comments survive a CSS edit')
    assert.ok(edited.includes('.lead {\n  color: #555555;\n  line-height: 1.5;\n}'),
      'other rules keep every byte')

    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    const restored = await waitForDisk(harness, 'theme.css', (content) => content === CSS_DOCUMENT,
      { label: 'undo css rule' })
    assert.equal(restored, CSS_DOCUMENT, 'undo restores the exact original stylesheet bytes')
  },
}

export const layoutPresetExtrasSpec = {
  name: 'html: wrap, gap and grid-row presets each write one validated declaration',
  allowConsoleErrors: 'csp-only',
  async run({ page, harness, assert }) {
    await harness.write('layout2.html', HTML_DOCUMENT)
    await harness.write('styles.css', CSS_DOCUMENT)
    await openWorkspaceFile(page, 'layout2.html', { expect: 'html' })
    const frame = page.frameLocator('iframe[title="Isolated design preview"]')
    await frame.locator('#lead').click()
    await page.getByLabel('HTML style property').waitFor({ state: 'visible' })

    const click = async (label) => {
      // `getByRole(name)` matches substrings: "…to wrap" would also match
      // "…to wrap-reverse", so these preset labels must be matched exactly.
      const button = page.getByRole('button', { name: label, exact: true })
      await button.scrollIntoViewIfNeeded()
      assert.equal(await button.isDisabled(), false, `${label} must be available`)
      await button.click()
    }

    await click('Set html layout display to flex')
    let disk = await waitForDisk(harness, 'layout2.html', (content) => /display:\s*flex/.test(content),
      { label: 'display' })
    await click('Set html layout flex-wrap to wrap')
    disk = await waitForDisk(harness, 'layout2.html', (content) => /flex-wrap:\s*wrap/.test(content),
      { label: 'flex-wrap' })
    await click('Set html layout column-gap to 16px')
    disk = await waitForDisk(harness, 'layout2.html', (content) => /column-gap:\s*16px/.test(content),
      { label: 'column-gap' })
    assert.ok(disk.includes('id="lead"'), 'the target element kept its identity attribute')
    assert.ok(disk.includes('color: #333'), 'the pre-existing inline declaration survived each preset')

    // Each preset must be reversible one action at a time.
    for (const name of ['column-gap', 'flex-wrap', 'display']) {
      await page.getByRole('button', { name: 'Undo saved edit' }).click()
      await page.waitForTimeout(250)
    }
    const restored = await waitForDisk(harness, 'layout2.html', (content) => content === HTML_DOCUMENT,
      { label: 'undo all presets' })
    assert.equal(restored, HTML_DOCUMENT, 'undoing every preset restores the byte-identical original')
  },
}

const MEDIA_CSS = `/* conditional rules */
h1 {
  color: #444444;
}

.card {
  color: #333333;
}

@media (max-width: 600px) {
  .card {
    color: #111111;
  }
}

@media (max-width: 600px) {
  .card {
    color: #222222;
  }
}
`

export const cssMediaEditSpec = {
  name: 'css: a conditional declaration is edited at its exact offset and its twin block is untouched',
  async run({ page, harness, assert }) {
    await harness.write('media.css', MEDIA_CSS)
    await openWorkspaceFile(page, 'media.css', { expect: 'css' })

    // Both conditional rows name the same selector: only the condition and the
    // exact position distinguish them.
    const rows = page.getByRole('button', { name: /^Select conditional CSS rule / })
    await rows.first().waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await rows.count(), 2, 'both conditional blocks are listed separately')
    const labels = await rows.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))
    // Two identical selector+condition blocks must still be distinguishable by
    // an accessible name, not only by their position on screen.
    assert.deepEqual(labels, [
      'Select conditional CSS rule (max-width: 600px) .card block 1',
      'Select conditional CSS rule (max-width: 600px) .card block 2',
    ], 'identical selector and condition remain distinguishable: ' + JSON.stringify(labels))

    // An editable conditional block must never be labelled read-only, and the
    // inspector header must name the real condition.
    await rows.first().click()
    const rowText = await rows.first().innerText()
    assert.ok(!/lecture seule/.test(rowText),
      'an editable @media block must not advertise itself as read-only: ' + JSON.stringify(rowText))
    const header = await page.locator('.dsh-studio-inspect-detail').first().innerText()
    assert.ok(/@media \(max-width: 600px\)/.test(header),
      'the inspector must name the conditional target: ' + JSON.stringify(header))
    await page.getByLabel('Conditional CSS rule property').selectOption('color')
    await page.getByLabel('Conditional CSS rule value').fill('#abcdef')
    await page.getByRole('button', { name: 'Apply conditional CSS rule style' }).click()

    const edited = await waitForDisk(harness, 'media.css', (content) => content !== MEDIA_CSS,
      { label: 'conditional css edit' })
    const changed = assertSingleDifferingRange(assert, MEDIA_CSS, edited,
      'a conditional edit must rewrite exactly one declaration value')
    // The `#` is common to both values, so the differing range starts after it.
    assert.equal(changed.before, '111111')
    assert.equal(changed.after, 'abcdef')
    assert.ok(edited.includes('color: #222222;'), 'the second identical media block keeps its bytes')
    assert.ok(edited.includes('color: #333333;'), 'the unconditional .card rule is untouched')
    assert.ok(edited.includes('color: #444444;'), 'the unrelated top-level rule is untouched')

    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    const restored = await waitForDisk(harness, 'media.css', (content) => content === MEDIA_CSS,
      { label: 'undo conditional css edit' })
    assert.equal(restored, MEDIA_CSS, 'Undo restores the exact original stylesheet bytes')
  },
}

export const cssMediaExclusiveSpec = {
  name: 'css: a conditional and an unconditional rule never both stay the edit target',
  async run({ page, harness, assert }) {
    await harness.write('exclusive.css', MEDIA_CSS)
    await openWorkspaceFile(page, 'exclusive.css', { expect: 'css' })

    const mediaRow = page.getByRole('button', { name: /^Select conditional CSS rule / }).first()
    await mediaRow.click()
    await page.getByLabel('Conditional CSS rule value').waitFor({ state: 'visible', timeout: 15000 })

    // Selecting an unconditional rule must drop the conditional target entirely.
    await page.getByRole('button', { name: 'Select CSS rule h1' }).click()
    await page.getByLabel('CSS rule value').waitFor({ state: 'visible', timeout: 15000 })
    // `:visible` matters: the compact layout keeps a hidden copy of the panel in
    // the DOM, and only what the user can reach is the real edit target.
    assert.equal(await page.locator('[aria-label="Conditional CSS rule value"]:visible').count(), 0,
      'the conditional editor must disappear once an unconditional rule is selected')
    assert.equal(await page.locator('[aria-label="Apply conditional CSS rule style"]:visible').count(), 0,
      'no conditional apply control may stay reachable from another selection')
    assert.equal(await page.locator('[aria-label="CSS rule value"]:visible').count(), 1,
      'the unconditional editor is the only visible target')

    // And the other way round.
    await mediaRow.click()
    await page.getByLabel('Conditional CSS rule value').waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await page.locator('[aria-label="CSS rule value"]:visible').count(), 0,
      'the unconditional editor must disappear once a conditional rule is selected')
    assert.equal(await page.locator('[aria-label="Conditional CSS rule value"]:visible').count(), 1,
      'only the conditional editor stays visible')
    assert.equal(await harness.read('exclusive.css'), MEDIA_CSS, 'switching selection writes nothing')
  },
}

export const cssMediaDeleteSpec = {
  name: 'css: deleting an open stylesheet with a conditional rule selected returns to a clean landing state',
  async run({ page, harness, assert }) {
    await harness.write('doomed.css', MEDIA_CSS)
    await openWorkspaceFile(page, 'doomed.css', { expect: 'css' })

    const mediaRow = page.getByRole('button', { name: /^Select conditional CSS rule / }).first()
    await mediaRow.click()
    await page.getByLabel('Conditional CSS rule value').waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await page.getByLabel('Conditional CSS rule value').isVisible(), true)

    // Delete the very file that is open, while its conditional rule is selected:
    // per-document state must be dropped together with the document.
    await openFileMenu(page)
    await page.getByRole('button', { name: 'Browse workspace design files' }).click()
    await page.locator('.dsh-studio-file-picker').waitFor({ state: 'visible', timeout: 20000 })
    await page.getByRole('button', { name: 'Delete doomed.css' }).click()
    await page.getByRole('group', { name: 'Confirm file delete' }).waitFor({ state: 'visible', timeout: 20000 })
    const removed = page.waitForResponse((value) => value.url().includes('/design-studio-native/delete'))
    await page.getByRole('button', { name: 'Confirm delete of doomed.css' }).click()
    assert.equal((await removed).status(), 200)

    // The landing state returns and nothing reads the deleted document.
    await page.getByRole('region', { name: 'Open a design file' })
      .waitFor({ state: 'visible', timeout: 20000 })
    assert.equal(await page.getByLabel('Conditional CSS rule value').count(), 0,
      'the conditional editor must be gone with the deleted document')
    const text = await page.locator('#root').innerText()
    assert.match(text, /Design Studio/, 'the workbench is still rendered after the deletion')
    assert.equal(await harness.read('doomed.css').then(() => false, () => true), true,
      'the deleted file is really gone')
  },
}

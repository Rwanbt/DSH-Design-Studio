/**
 * HTML text and attribute editing through the real UI, with the Host allowlist
 * as the security boundary. Every assertion reads the real file on disk.
 */
import { HTML_DOCUMENT, CSS_DOCUMENT, assertSingleDifferingRange, openWorkspaceFile, waitForDisk } from './helpers.mjs'

export const htmlTextSpec = {
  allowConsoleErrors: 'csp-only',
  name: 'html: element text is edited in place and undo restores the exact bytes',
  async run({ page, harness, assert }) {
    await harness.write('page.html', HTML_DOCUMENT)
    await harness.write('styles.css', CSS_DOCUMENT)
    await openWorkspaceFile(page, 'page.html', { expect: 'html' })
    const frame = page.frameLocator('iframe[title="Isolated design preview"]')
    await frame.locator('#lead').click()
    await page.getByRole('textbox', { name: 'HTML element text' }).waitFor({ state: 'visible' })

    assert.equal(await page.getByRole('textbox', { name: 'HTML element text' }).inputValue(), 'Edit this paragraph.',
      'the current source text is offered for editing, not a rendered approximation')
    await page.getByRole('textbox', { name: 'HTML element text' }).fill('Edited paragraph')
    await page.getByRole('button', { name: 'Apply HTML element text' }).click()

    const edited = await waitForDisk(harness, 'page.html', (content) => content !== HTML_DOCUMENT,
      { label: 'html text' })
    const window = assertSingleDifferingRange(assert, HTML_DOCUMENT, edited,
      'a text edit must only rewrite the element content')
    // The diff window is the minimal changed range (shared prefixes/suffixes are
    // excluded), so assert the outcome and the confinement instead of its shape.
    assert.ok(window.before.length > 0 && window.after.length > 0, 'the content really changed')
    assert.ok(edited.includes('>Edited paragraph</p>'), 'the element carries exactly the new text')
    assert.ok(!edited.includes('>Edit this paragraph.</p>'), 'the previous text is gone')

    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    const restored = await waitForDisk(harness, 'page.html', (content) => content === HTML_DOCUMENT,
      { label: 'undo text' })
    assert.equal(restored, HTML_DOCUMENT, 'undo restores the byte-identical original')
  },
}

export const htmlAttributeSpec = {
  allowConsoleErrors: 'csp-only',
  name: 'html: allowlisted attributes are editable and dangerous ones are not offered',
  async run({ page, harness, assert }) {
    await harness.write('page.html', HTML_DOCUMENT)
    await harness.write('styles.css', CSS_DOCUMENT)
    await openWorkspaceFile(page, 'page.html', { expect: 'html' })
    await page.frameLocator('iframe[title="Isolated design preview"]').locator('#lead').click()
    await page.getByRole('combobox', { name: 'HTML attribute name' }).waitFor({ state: 'visible' })

    const options = await page.getByRole('combobox', { name: 'HTML attribute name' }).locator('option')
      .evaluateAll((nodes) => nodes.map((node) => node.value))
    assert.deepEqual(options, ['class', 'title', 'alt', 'hidden', 'lang', 'dir'],
      'the UI only offers the Host allowlist; it never invites a refused attribute')

    await page.getByRole('combobox', { name: 'HTML attribute name' }).selectOption('class')
    await page.getByRole('textbox', { name: 'HTML attribute value' }).fill('lead emphasis')
    await page.getByRole('button', { name: 'Apply HTML attribute' }).click()

    const edited = await waitForDisk(harness, 'page.html', (content) => content.includes('lead emphasis'),
      { label: 'class attribute' })
    assert.ok(edited.includes('class="lead emphasis"'), 'the class attribute was rewritten in place')
    assert.ok(edited.includes('style="color: #333"'), 'the inline style attribute is untouched')
    assert.ok(edited.includes('id="headline"'), 'sibling elements keep every byte')

    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    const restored = await waitForDisk(harness, 'page.html', (content) => content === HTML_DOCUMENT,
      { label: 'undo class' })
    assert.equal(restored, HTML_DOCUMENT, 'undo restores the original attribute bytes')
  },
}

export const htmlTextRefusalSpec = {
  allowConsoleErrors: 'refusals',
  name: 'html: text editing fails closed for mixed markup instead of destroying children',
  async run({ page, harness, assert }) {
    const document = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>mixed</title></head>
<body><div id="mixed">Before <strong id="inner">bold</strong> after</div></body></html>
`
    await harness.write('mixed.html', document)
    await openWorkspaceFile(page, 'mixed.html', { expect: 'html' })
    await page.frameLocator('iframe[title="Isolated design preview"]').locator('#mixed').click()
    await page.getByRole('textbox', { name: 'HTML element text' }).waitFor({ state: 'visible' })
    await page.getByRole('textbox', { name: 'HTML element text' }).fill('Replaced')
    await page.getByRole('button', { name: 'Apply HTML element text' }).click()
    await page.waitForTimeout(800)

    const alert = await page.getByRole('alert').innerText().catch(() => '')
    assert.ok(alert.length > 0, 'a refused text edit must explain itself, got: ' + JSON.stringify(alert.slice(0, 160)))
    assert.equal(await harness.read('mixed.html'), document,
      'a refused text edit must never rewrite the file')
    assert.ok((await harness.read('mixed.html')).includes('<strong id="inner">bold</strong>'),
      'nested markup survives a refused edit')
  },
}

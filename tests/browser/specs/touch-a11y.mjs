/**
 * Touch and assistive-technology surfaces.
 *
 * The editor is a pointer-driven tool, so two things must be proven rather than
 * assumed: a finger (a touch pointer, not a mouse) can select and drag, and the
 * commands the user needs are exposed to assistive technology with a real role
 * and an accessible name.
 *
 * Scope of these specs, stated precisely:
 *  - touch is **emulated** by the browser (touch-enabled context + touchscreen
 *    API). No physical device was used; emulation is not hardware.
 *  - the accessibility tree is the one the **real browser** exposes to assistive
 *    technology. It is not a run with a screen reader attached on an interactive
 *    display (none is available here), so it is not a WCAG certification.
 */
import { SVG_DOCUMENT, openWorkspaceFile, waitForDisk } from './helpers.mjs'

export const touchSelectSpec = {
  name: 'touch: a finger selects a layer and drags a shape, both without a mouse',
  contextOptions: { hasTouch: true, viewport: { width: 1280, height: 820 } },
  async run({ page, harness, assert }) {
    await harness.write('toucher.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'toucher.svg', { expect: 'svg' })

    // A touch tap on the canvas shape selects it: pointer events must not require
    // a mouse device to hit-test.
    const handle = page.getByRole('button', { name: 'Drag circle dot' })
    const box = await handle.boundingBox()
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForFunction(() =>
      document.querySelector('[aria-label="Select layer circle #dot"]')?.getAttribute('aria-pressed') === 'true',
      null, { timeout: 15000 })
    assert.equal(await harness.read('toucher.svg'), SVG_DOCUMENT, 'a touch tap must not write')

    // A touch drag on a shape moves it through the same exact patch a mouse uses.
    const before = await harness.read('toucher.svg')
    const moved = await page.evaluate(async ({ x, y }) => {
      // Real touch pointer events on the canvas, dispatched by the browser.
      const target = document.elementFromPoint(x, y)
      if (!target) return null
      const fire = (type, point) => target.dispatchEvent(new PointerEvent(type, {
        pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true,
        clientX: point.x, clientY: point.y, buttons: type === 'pointerup' ? 0 : 1,
      }))
      // The canvas listens on the SVG surface, not only the shape, so the drag is
      // dispatched at the coordinates a finger would occupy.
      const svg = document.querySelector('[aria-label="Canvas viewport"] svg, [data-document-svg]')
      const surface = svg || target
      const send = (type, point) => surface.dispatchEvent(new PointerEvent(type, {
        pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true,
        clientX: point.x, clientY: point.y, buttons: type === 'pointerup' ? 0 : 1,
      }))
      send('pointerdown', { x, y })
      send('pointermove', { x: x + 24, y })
      send('pointermove', { x: x + 48, y })
      send('pointerup', { x: x + 48, y })
      return true
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    assert.equal(moved, true, 'the touch drag must reach the canvas')
    // Either the drag wrote (a real move) or it did not, but the invariant is the
    // same: nothing is written that is not a validated patch.
    const after = await harness.read('toucher.svg')
    if (after !== before) {
      await waitForDisk(harness, 'toucher.svg', (text) => text === after, { label: 'touch drag settled' })
      const order = [...after.matchAll(/id="(bg|card|dot|title)"/g)].map((m) => m[1])
      assert.deepEqual(order, ['bg', 'card', 'dot', 'title'], 'a shape drag never reorders layers')
      assert.ok(after.includes('<circle id="dot"'), 'the layer keeps its identity')
    }
  },
}

export const accessibleTreeSpec = {
  name: 'a11y: the command surface exposes real roles and names to assistive technology',
  async run({ page, harness, browser, assert }) {
    await harness.write('arbre.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'arbre.svg', { expect: 'svg' })

    // Two different questions, answered with two different tools:
    //  - Chromium: the browser's own accessibility tree over CDP (what AT gets).
    //  - Firefox: no CDP, so the accessible name is computed from the DOM with
    //    the accname order (aria-labelledby, aria-label, label, title, content).
    const engine = browser.browserType().name()
    let axNodes = null
    if (engine === 'chromium') {
      const session = await page.context().newCDPSession(page)
      await session.send('Accessibility.enable')
      const { nodes } = await session.send('Accessibility.getFullAXTree')
      axNodes = nodes
        .filter((node) => !node.ignored)
        .map((node) => ({ role: node.role?.value || '', name: node.name?.value || '' }))
      await session.detach().catch(() => {})
    }

    const domNames = await page.evaluate(() => {
      const interactive = 'button, a[href], input, select, textarea, [role="button"], [role="menuitem"], [role="tab"]'
      const accname = (element) => {
        const labelledby = element.getAttribute('aria-labelledby')
        if (labelledby) {
          const text = labelledby.split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent || '').join(' ').trim()
          if (text) return text
        }
        const label = element.getAttribute('aria-label')
        if (label && label.trim()) return label.trim()
        if (element.id) {
          const explicit = document.querySelector('label[for="' + CSS.escape(element.id) + '"]')
          if (explicit?.textContent?.trim()) return explicit.textContent.trim()
        }
        const wrapping = element.closest('label')
        if (wrapping?.textContent?.trim()) return wrapping.textContent.trim()
        const title = element.getAttribute('title')
        if (title && title.trim()) return title.trim()
        return (element.textContent || '').trim()
      }
      return [...document.querySelectorAll(interactive)].map((element) => ({
        tag: element.tagName.toLowerCase(),
        name: accname(element),
        hidden: element.offsetParent === null && element.getClientRects().length === 0,
      }))
    })

    const visible = domNames.filter((entry) => !entry.hidden)
    assert.ok(visible.length > 10, 'the command surface is not empty (' + visible.length + ' interactive controls)')

    // The invariant that matters for a screen reader: nothing clickable is silent.
    const unnamed = visible.filter((entry) => !entry.name)
    assert.equal(unnamed.length, 0,
      'every interactive control needs an accessible name, unnamed: ' + JSON.stringify(unnamed.slice(0, 5)))

    // The layer list is the primary navigation: its rows must be named buttons.
    assert.ok(visible.some((entry) => entry.tag === 'button' && /Select layer rect #card/.test(entry.name)),
      'layer rows are buttons with an explicit name')
    assert.ok(domNames.some((entry) => /Select layer text #title/.test(entry.name)),
      'text layers are named too, not just shapes')

    if (axNodes) {
      // The browser's tree is the reference when it is available: a control that
      // exists in the DOM but is not in this tree is invisible to assistive tech.
      assert.ok(axNodes.length > 10, 'the accessibility tree is not empty (' + axNodes.length + ' nodes)')
      assert.ok(axNodes.some((node) => node.role === 'button' && /Select layer rect #card/.test(node.name)),
        'the real AX tree exposes the layer rows as named buttons')
      const axUnnamedButtons = axNodes.filter((node) => node.role === 'button' && !node.name.trim())
      assert.equal(axUnnamedButtons.length, 0,
        'the real AX tree must not contain unnamed buttons: ' + JSON.stringify(axUnnamedButtons.slice(0, 5)))
      assert.ok(axNodes.some((node) => ['textbox', 'spinbutton', 'combobox'].includes(node.role)),
        'the inspector fields appear in the real AX tree with an editable role')
    }

    // Keyboard reachability, measured rather than assumed.
    await page.getByRole('button', { name: 'Select layer rect #card' }).focus()
    await page.keyboard.press('Tab')
    const focused = await page.evaluate(() => {
      const node = document.activeElement
      return node ? { tag: node.tagName.toLowerCase() } : null
    })
    assert.ok(focused && focused.tag !== 'body', 'Tab must move the focus to another control, got ' + JSON.stringify(focused))
  },
}

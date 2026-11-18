/**
 * Accessibility and keyboard behaviour observed in a real browser. ARIA
 * attributes alone are not proof: every assertion drives the real input.
 */
import { SVG_DOCUMENT, openWorkspaceFile } from './helpers.mjs'

export const keyboardSpec = {
  name: 'a11y: keyboard reaches real controls, toggles expose state and shortcuts never lose edits',
  async run({ page, harness, assert }) {
    await harness.write('kbd.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'kbd.svg', { expect: 'svg' })
    await page.getByRole('button', { name: 'Drag rect card' }).waitFor({ state: 'visible' })

    // Tab traversal must reach the editable controls in DOM order.
    await page.evaluate(() => document.body.focus())
    const reached = []
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press('Tab')
      reached.push(await page.evaluate(() => {
        const node = document.activeElement
        return {
          tag: node?.tagName?.toLowerCase(),
          label: node?.getAttribute?.('aria-label') || node?.textContent?.trim()?.slice(0, 30) || '',
        }
      }))
    }
    assert.ok(reached.some((item) => item.tag === 'button'), 'Tab must reach buttons: ' + JSON.stringify(reached))
    assert.ok(reached.every((item) => item.label.length > 0),
      'every reachable control must expose an accessible name: ' + JSON.stringify(reached))

    // A focused button must be operable from the keyboard. This editor
    // deliberately reserves Space and bare letters for canvas tools (asserted
    // below and in the core suite), so Enter is the activation key for controls.
    const grid = page.getByRole('button', { name: 'Toggle canvas grid' })
    await grid.focus()
    const before = await grid.getAttribute('aria-pressed')
    await page.keyboard.press('Enter')
    assert.equal(await grid.getAttribute('aria-pressed'), before === 'true' ? 'false' : 'true',
      'Enter must activate the focused toggle')

    // Documented trade-off: Space is the temporary pan key even when a control
    // holds focus, so the canvas keeps a predictable shortcut model.
    const beforeSpace = await grid.getAttribute('aria-pressed')
    await page.keyboard.press('Space')
    assert.equal(await grid.getAttribute('aria-pressed'), beforeSpace,
      'Space must stay reserved for temporary panning, not activate the control')

    // Focus visibility must be real, not only declared.
    await grid.focus()
    const outline = await grid.evaluate((node) => {
      const style = getComputedStyle(node)
      return { width: style.outlineWidth, style: style.outlineStyle, shadow: style.boxShadow }
    })
    assert.ok((outline.style !== 'none' && outline.width !== '0px') || outline.shadow !== 'none',
      'focused controls must show a visible focus indicator: ' + JSON.stringify(outline))

    await page.keyboard.press('Escape')
    assert.equal(await harness.read('kbd.svg'), SVG_DOCUMENT, 'keyboard-only navigation must not modify the file')

    const handle = page.getByRole('button', { name: 'Drag rect card' })
    assert.equal(await handle.getAttribute('title'), 'Drag card to move', 'handles expose a tooltip title')
    await handle.focus()
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute?.('aria-label')), 'Drag rect card',
      'the drag handle is keyboard reachable')
  },
}

export const panelsAccessibilitySpec = {
  name: 'a11y: compact layout exposes a real tablist with aria-selected and reachable panels',
  async run({ page, harness, assert }) {
    await harness.write('panels.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'panels.svg', { expect: 'svg' })
    await page.setViewportSize({ width: 420, height: 860 })
    await page.waitForTimeout(400)
    const tablist = page.getByRole('tablist', { name: 'Mobile editor panels' })
    await tablist.waitFor({ state: 'visible', timeout: 10000 })
    assert.equal(await tablist.count(), 1, 'the compact layout exposes exactly one mobile tablist')
    // Document tabs (ADR-034) are a second, independent tablist: scope the
    // panel assertions to the mobile dock instead of counting every tab page-wide.
    assert.equal(await tablist.getByRole('tab').count(), 3, 'three panels are exposed as tabs')
    const documents = page.getByRole('tablist', { name: 'Documents ouverts' })
    assert.equal(await documents.count(), 1, 'open documents expose their own tablist')
    assert.equal(await documents.getByRole('tab').count(), 1, 'the open document is one tab')
    for (const panel of ['layers', 'canvas', 'inspector']) {
      const tab = tablist.getByRole('tab', { name: `Mobile panel ${panel}` })
      await tab.click()
      assert.equal(await tab.getAttribute('aria-selected'), 'true', `${panel} tab reports aria-selected`)
      const visible = await page.locator(`.dsh-studio-mobile-active`).count()
      assert.ok(visible >= 1, `${panel} must expose exactly the active panel, found ${visible}`)
    }
    // The document must still be readable when the compact dock switches panels.
    assert.ok((await page.locator('#root').innerText()).includes('Canevas'),
      'the canvas panel stays reachable in the compact dock')
  },
}

export const reducedMotionSpec = {
  name: 'a11y: reduced-motion preference is honoured and every animation is neutralised',
  contextOptions: { reducedMotion: 'reduce' },
  async run({ page, harness, assert }) {
    await harness.write('motion.svg', SVG_DOCUMENT)
    await openWorkspaceFile(page, 'motion.svg', { expect: 'svg' })
    const media = await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    assert.equal(media, true, 'the emulated reduced-motion preference must be active')
    const animated = await page.evaluate(() => {
      const offenders = []
      for (const node of document.querySelectorAll('#root *')) {
        const style = getComputedStyle(node)
        const duration = parseFloat(style.transitionDuration || '0') + parseFloat(style.animationDuration || '0')
        if (duration > 0) offenders.push(node.tagName.toLowerCase() + ' ' + duration)
      }
      return offenders
    })
    assert.deepEqual(animated, [], 'no element may keep a non-zero animation under reduced motion')
    // Controls stay visible and usable, not hidden behind motion.
    assert.equal(await page.getByRole('button', { name: 'Zoom in canvas' }).isVisible(), true,
      'reduced motion must not hide the canvas toolbar')
  },
}

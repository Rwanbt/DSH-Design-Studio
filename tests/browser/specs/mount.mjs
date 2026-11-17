/** The client bundle must register the DSH conversation view and mount in a real DOM. */
export const mountSpec = {
  name: 'client registers conversation.view and mounts without AI credentials',
  async run({ page, assert, shell }) {
    assert.ok(shell.injectedSlots.includes('conversation.view'),
      'plugin must inject into the conversation.view slot: ' + JSON.stringify(shell.injectedSlots))
    assert.ok(shell.injectedSlots.includes('main') && shell.injectedSlots.includes('sidebar.panellist'),
      'the sidebar entry and its panel must be registered too: ' + JSON.stringify(shell.injectedSlots))
    assert.equal(shell.conversationRegistration.id, 'dsh-design-studio', 'slot registration id')
    assert.equal(shell.conversationRegistration.name, 'conversation.view', 'slot name')
    assert.equal(shell.conversationRegistration.label, 'Design Studio', 'visible label')
    assert.equal(typeof shell.conversationRegistration.order, 'number', 'slot ordering must be numeric')
    const errors = await page.evaluate(() => window.__DSH_HARNESS__.errors)
    assert.deepEqual(errors, [], 'no client-side errors during mount')
    const text = await page.locator('#root').innerText()
    assert.ok(text.trim().length > 0, 'the Design Studio view must render visible content')
    // Internal-plugin integration: the workbench must paint with resolved theme
    // values (not empty strings) so it inherits DSH's light/dark themes.
    const theme = await page.evaluate(() => {
      const workbench = document.querySelector('.dsh-studio-workbench')
      const header = workbench?.querySelector('header')
      const style = workbench ? getComputedStyle(workbench) : null
      const headerStyle = header ? getComputedStyle(header) : null
      return {
        background: style?.backgroundColor ?? '',
        color: style?.color ?? '',
        font: style?.fontFamily ?? '',
        headerBackground: headerStyle?.backgroundColor ?? '',
        headerBorder: headerStyle?.borderBottomColor ?? '',
      }
    })
    assert.match(theme.background, /^rgba?\(/, 'the workbench background must resolve to a colour')
    assert.match(theme.color, /^rgba?\(/, 'the workbench text colour must resolve')
    assert.match(theme.headerBackground, /^rgba?\(/, 'the header surface must resolve')
    assert.match(theme.font, /\w/, 'the workbench must inherit a font family')
    assert.ok(!/^var\(/.test(theme.background), 'no unresolved var() may leak into computed styles')

    // Manual-first: the editor must be usable without any provider/credential UI.
    assert.ok(!/api key|token|provider|chat with/i.test(text), 'no credential or chat chrome in the editor view')
  },
}

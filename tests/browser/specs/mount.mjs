/** The client bundle must register the DSH conversation view and mount in a real DOM. */
export const mountSpec = {
  name: 'client registers conversation.view and mounts without AI credentials',
  async run({ page, assert, shell }) {
    assert.equal(shell.injected, 'conversation.view', 'plugin must inject into the conversation.view slot')
    assert.equal(shell.registration.id, 'dsh-design-studio', 'slot registration id')
    assert.equal(shell.registration.name, 'conversation.view', 'slot name')
    assert.equal(shell.registration.label, 'Design Studio', 'visible label')
    assert.equal(typeof shell.registration.order, 'number', 'slot ordering must be numeric')
    const errors = await page.evaluate(() => window.__DSH_HARNESS__.errors)
    assert.deepEqual(errors, [], 'no client-side errors during mount')
    const text = await page.locator('#root').innerText()
    assert.ok(text.trim().length > 0, 'the Design Studio view must render visible content')
    // Manual-first: the editor must be usable without any provider/credential UI.
    assert.ok(!/api key|token|provider|chat with/i.test(text), 'no credential or chat chrome in the editor view')
  },
}

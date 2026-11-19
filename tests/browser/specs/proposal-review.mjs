import { openWorkspaceFile, waitForEditorSource } from './helpers.mjs'

export const proposalReviewSpec = {
  name: 'proposals: review before and after, apply once and undo in the conversation editor',
  async run({ page, harness, assert }) {
    const file = 'proposal.html'
    const original = '<h1 id="head">Before</h1>'
    const expected = '<h1 id="head">After</h1>'
    await harness.write(file, original)
    const proposal = await harness.propose({ file, kind: 'html-text', id: 'head', value: 'After' })
    assert.equal(proposal.ok, true)
    await openWorkspaceFile(page, file, { expect: 'html' })
    await page.locator('summary').filter({ hasText: 'Code source natif' }).click()
    const source = page.locator('.dsh-studio-source textarea')
    await source.fill(original + '\n<!-- unsaved -->')
    await page.getByText('Propositions IA', { exact: true }).click()
    await page.getByRole('button', { name: /Proposition 1/ }).click()
    const comparison = page.getByRole('region', { name: 'Comparaison de la proposition' })
    await comparison.getByText('After', { exact: true }).waitFor()
    assert.equal(await comparison.getByText('Before', { exact: true }).count(), 1)
    assert.equal(await harness.read(file), original)
    const apply = comparison.getByRole('button', { name: 'Appliquer la proposition' })
    assert.ok(await apply.isDisabled(), 'an unsaved draft blocks approval')
    const writes = () => harness.requests.filter(request => request.path.endsWith('/apply')).length
    assert.equal(writes(), 0)
    await source.fill(original)
    await apply.click()
    await waitForEditorSource(page, expected)
    assert.equal(await harness.read(file), expected)
    assert.equal(writes(), 1)
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    await waitForEditorSource(page, original)
    assert.equal(await harness.read(file), original)
  },
}

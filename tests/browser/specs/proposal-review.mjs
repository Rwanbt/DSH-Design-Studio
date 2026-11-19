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

export const slideProposalReviewSpec = {
  name: 'proposals: review, apply and undo a presentation structural edit',
  async run({ page, harness, assert }) {
    const file = 'slides.html'
    const deck = '<main id="dsh-deck" data-dsh-deck="1"><section id="slide-first"><h1>First</h1></section></main>'
    await harness.write(file,deck)
    const proposed = await harness.propose({file,kind:'slide-add',id:'slide-next',title:'Proposed slide'})
    assert.equal(proposed.ok,true)
    const [patch] = proposed.proposal.patches
    const expected = deck.slice(0,patch.start)+patch.after+deck.slice(patch.end)
    await openWorkspaceFile(page,file,{expect:'html'})
    await page.getByText('Propositions IA',{exact:true}).click()
    await page.getByRole('button',{name:/Proposition 1.*slide-add/}).click()
    const review = page.getByRole('region',{name:'Comparaison de la proposition'})
    await review.getByText(/Proposed slide/).waitFor()
    assert.equal(await harness.read(file),deck)
    await review.getByRole('button',{name:'Appliquer la proposition'}).click()
    await page.getByRole('button',{name:'Diapositive 2',exact:true}).waitFor()
    assert.equal(await harness.read(file),expected)
    await page.getByRole('button',{name:'Undo saved edit'}).click()
    await page.getByRole('button',{name:'Diapositive 2',exact:true}).waitFor({state:'detached'})
    assert.equal(await harness.read(file),deck)
  },
}

export const htmlStyleProposalReviewSpec = {
  name: 'proposals: apply and undo an inline style with a visible preview',
  async run({ page, harness, assert }) {
    const file = 'styled.html'
    const original = '<h1 id="hero" style="color: #222222">Title</h1>'
    await harness.write(file,original)
    const result = await harness.propose({file,kind:'html-style',id:'hero',property:'color',value:'#123456'})
    assert.equal(result.ok,true)
    await openWorkspaceFile(page,file,{expect:'html'})
    await page.getByText('Propositions IA',{exact:true}).click()
    await page.getByRole('button',{name:/Proposition 1.*html-style/}).click()
    const review = page.getByRole('region',{name:'Comparaison de la proposition'})
    await review.getByText(/#123456/).waitFor()
    assert.equal(await harness.read(file),original)
    await review.getByRole('button',{name:'Appliquer la proposition'}).click()
    const heading=page.frameLocator('iframe[title="Isolated design preview"]').getByText('Title',{exact:true})
    await heading.locator('xpath=self::*[@style="color: #123456"]').waitFor()
    assert.equal(await heading.evaluate(element=>getComputedStyle(element).color),'rgb(18, 52, 86)')
    await page.getByRole('button',{name:'Undo saved edit'}).click()
    await heading.locator('xpath=self::*[@style="color: #222222"]').waitFor()
    assert.equal(await harness.read(file),original)
  },
}

export const cssMediaProposalReviewSpec = {
  name: 'proposals: apply and undo a responsive CSS declaration',
  async run({ page, harness, assert }) {
    const file = 'responsive.css'
    const original = 'h1 { color: #111111; }\n@media (max-width: 600px) { h1 { color: #222222; } }'
    const expected = original.replace('#222222','#abcdef')
    await harness.write(file,original)
    const result = await harness.propose({file,kind:'css-media',selector:'h1',condition:'(max-width: 600px)',
      property:'color',value:'#abcdef'})
    assert.equal(result.ok,true)
    await openWorkspaceFile(page,file,{expect:'css'})
    await page.getByText('Propositions IA',{exact:true}).click()
    await page.getByRole('button',{name:/Proposition 1.*css-media/}).click()
    const review = page.getByRole('region',{name:'Comparaison de la proposition'})
    await review.getByText('#abcdef',{exact:true}).waitFor()
    assert.equal(await harness.read(file),original)
    await review.getByRole('button',{name:'Appliquer la proposition'}).click()
    await waitForEditorSource(page,expected)
    assert.equal(await harness.read(file),expected)
    await page.getByRole('button',{name:'Undo saved edit'}).click()
    await waitForEditorSource(page,original)
    assert.equal(await harness.read(file),original)
  },
}

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
    const discarded = await harness.propose({file,kind:'html-text',id:'head',value:'Discard this'})
    assert.equal(discarded.ok,true)
    const menu=page.locator('details').filter({has:page.getByText('Propositions IA',{exact:true})})
    if(await menu.getAttribute('open')===null) await menu.locator('summary').click()
    else await menu.getByRole('button',{name:'Actualiser les propositions'}).click()
    await menu.getByRole('button',{name:/Proposition 1/}).click()
    await menu.getByRole('button',{name:'Écarter la proposition'}).click()
    await menu.getByText('Proposition écartée.',{exact:true}).waitFor()
    await menu.getByRole('button',{name:'Actualiser les propositions'}).click()
    await menu.getByText('Aucune proposition pour ce fichier.',{exact:true}).waitFor()
    assert.equal(await harness.read(file),original)
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
  name: 'proposals: apply and undo a style and text batch with a visible preview',
  async run({ page, harness, assert }) {
    const file = 'styled.html'
    const original = '<h1 id="hero" style="color: #222222">Title</h1>'
    await harness.write(file,original)
    const result = await harness.propose({file,kind:'batch',edits:[
      {kind:'html-style',id:'hero',property:'color',value:'#123456'},
      {kind:'html-text',id:'hero',value:'Updated title'},
    ]})
    assert.equal(result.ok,true)
    await openWorkspaceFile(page,file,{expect:'html'})
    await page.getByText('Propositions IA',{exact:true}).click()
    await page.getByRole('button',{name:/Proposition 1.*2 modifications/}).click()
    const review = page.getByRole('region',{name:'Comparaison de la proposition'})
    await review.getByText(/#123456/).waitFor()
    await review.getByRole('button',{name:'Afficher l’aperçu comparatif'}).click()
    const before=review.frameLocator('iframe[title="Aperçu avant"]').getByText('Title',{exact:true})
    const after=review.frameLocator('iframe[title="Aperçu après"]').getByText('Updated title',{exact:true})
    assert.equal(await review.locator('iframe[title="Aperçu après"]').getAttribute('sandbox'),'')
    assert.equal(await before.evaluate(element=>getComputedStyle(element).color),'rgb(34, 34, 34)')
    assert.equal(await after.evaluate(element=>getComputedStyle(element).color),'rgb(18, 52, 86)')
    assert.equal(await harness.read(file),original)
    await review.getByRole('button',{name:'Appliquer la proposition'}).click()
    const heading=page.frameLocator('iframe[title="Isolated design preview"]').locator('#hero')
    await heading.locator('xpath=self::*[@style="color: #123456"]').waitFor()
    assert.equal(await heading.evaluate(element=>getComputedStyle(element).color),'rgb(18, 52, 86)')
    assert.equal(await heading.textContent(),'Updated title')
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

export const svgOrderProposalReviewSpec = {
  name: 'proposals: review and undo SVG layer order',
  async run({ page, harness, assert }) {
    const file = 'layers.svg'
    const original = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">'+
      '<rect id="back" width="70" height="70" fill="blue"/><rect id="front" width="60" height="60" fill="red"/></svg>'
    await harness.write(file,original)
    const result=await harness.propose({file,kind:'svg-order',id:'back',direction:'front'})
    assert.equal(result.ok,true)
    await openWorkspaceFile(page,file,{expect:'svg'})
    await page.getByText('Propositions IA',{exact:true}).click()
    await page.getByRole('button',{name:/Proposition 1.*svg-order/}).click()
    assert.equal(await harness.read(file),original)
    await page.getByRole('button',{name:'Appliquer la proposition'}).click()
    const shapes=page.frameLocator('iframe[title="Isolated SVG preview"]').locator('svg > rect')
    await shapes.last().and(page.frameLocator('iframe[title="Isolated SVG preview"]').locator('#back')).waitFor()
    assert.match(await harness.read(file),/id="front".*id="back"/)
    await page.getByRole('button',{name:'Undo saved edit'}).click()
    await shapes.last().and(page.frameLocator('iframe[title="Isolated SVG preview"]').locator('#front')).waitFor()
    assert.equal(await harness.read(file),original)
  },
}

export const svgTransformProposalReviewSpec = {
  name: 'proposals: review and undo an SVG translation',
  async run({ page, harness, assert }) {
    const file='translation.svg'
    const original='<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">'+
      '<rect id="target" width="30" height="30"/></svg>'
    await harness.write(file,original)
    const proposed=await harness.propose({file,kind:'svg-transform',id:'target',operation:{type:'translate',dx:12,dy:5}})
    assert.equal(proposed.ok,true)
    await openWorkspaceFile(page,file,{expect:'svg'})
    await page.getByText('Propositions IA',{exact:true}).click()
    await page.getByRole('button',{name:/Proposition 1.*svg-transform/}).click()
    assert.equal(await harness.read(file),original)
    await page.getByRole('button',{name:'Appliquer la proposition'}).click()
    const frame=page.frameLocator('iframe[title="Isolated SVG preview"]')
    await frame.locator('#target[transform="matrix(1,0,0,1,12,5)"]').waitFor()
    assert.match(await harness.read(file),/matrix\(1,0,0,1,12,5\)/)
    await page.getByRole('button',{name:'Undo saved edit'}).click()
    await frame.locator('#target:not([transform])').waitFor()
    assert.equal(await harness.read(file),original)
  },
}

export const svgShapeProposalReviewSpec = {
  name: 'proposals: add a native SVG shape and undo',
  async run({ page, harness, assert }) {
    const file='shape.svg'
    const original='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'+
      '<defs><linearGradient id="shape-1"/></defs><rect id="base" width="16" height="16"/></svg>'
    await harness.write(file,original)
    assert.equal((await harness.propose({file,kind:'svg-add-shape',shape:'circle',x:31,y:42})).ok,true)
    await openWorkspaceFile(page,file,{expect:'svg'})
    await page.getByText('Propositions IA',{exact:true}).click()
    await page.getByRole('button',{name:/Proposition 1.*svg-add-shape/}).click()
    assert.equal(await harness.read(file),original)
    await page.getByRole('button',{name:'Appliquer la proposition'}).click()
    const shape=page.frameLocator('iframe[title="Isolated SVG preview"]').locator('circle#shape-2')
    await shape.waitFor()
    assert.equal(await shape.getAttribute('cx'),'31')
    assert.equal(await shape.getAttribute('cy'),'42')
    await page.getByRole('button',{name:'Undo saved edit'}).click()
    await shape.waitFor({state:'detached'})
    assert.equal(await harness.read(file),original)
  },
}

export const svgTextInsertionProposalReviewSpec = {
  name: 'proposals: insert editable multiline SVG text',
  async run({ page, harness, assert }) {
    const file='label.svg'
    const original='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>'
    await harness.write(file,original)
    const proposal=await harness.propose({file,kind:'svg-add-shape',shape:'text',x:50,y:20,text:'A & <B>\nLine two'})
    assert.equal(proposal.ok,true)
    await openWorkspaceFile(page,file,{expect:'svg'})
    await page.getByText('Propositions IA',{exact:true}).click()
    await page.getByRole('button',{name:/Proposition 1.*svg-add-shape/}).click()
    await page.getByRole('button',{name:'Appliquer la proposition'}).click()
    const lines=page.frameLocator('iframe[title="Isolated SVG preview"]').locator('text#shape-1 > tspan')
    await lines.nth(1).waitFor()
    assert.deepEqual(await lines.allTextContents(),['A & <B>','Line two'])
    await page.getByRole('button',{name:'Undo saved edit'}).click()
    await lines.first().waitFor({state:'detached'})
    assert.equal(await harness.read(file),original)
  },
}

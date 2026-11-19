import { waitForEditorSource } from './helpers.mjs'

export const presentationSpec = {
  name: 'presentations: create native deck, add, navigate, reorder and undo slides',
  async run({ page, harness, assert }) {
    await page.getByRole('button', { name: '+ Présentation', exact: true }).click()
    const slides = page.getByRole('region', { name: 'Diapositives' })
    const iframe = page.frameLocator('iframe[title="Isolated design preview"]')
    await iframe.getByText('Untitled slide').waitFor()
    const initial = await harness.read('presentation.html')
    assert.match(initial, /data-dsh-deck="1"/)
    await slides.getByRole('textbox', { name: 'Titre de la nouvelle diapositive' }).fill('Second slide')
    await slides.getByRole('button', { name: 'Ajouter une diapositive' }).click()
    await iframe.getByText('Second slide').waitFor()
    assert.equal(await iframe.getByText('Untitled slide').isVisible(), false)
    const added = await harness.read('presentation.html')
    await slides.getByRole('button', { name: 'Déplacer à gauche' }).click()
    await page.waitForFunction(() => {
      const buttons = document.querySelectorAll('[aria-label="Ordre des diapositives"] button')
      return buttons[0]?.getAttribute('aria-pressed') === 'true'
    })
    assert.ok((await harness.read('presentation.html')).indexOf('Second slide') <
      (await harness.read('presentation.html')).indexOf('Untitled slide'))
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    await waitForEditorSource(page, added)
    assert.equal(await harness.read('presentation.html'), added)
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    await waitForEditorSource(page, initial)
    assert.equal(await harness.read('presentation.html'), initial)
  },
}

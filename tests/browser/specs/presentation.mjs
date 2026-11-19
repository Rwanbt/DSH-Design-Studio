import { openWorkspaceFile, waitForEditorSource } from './helpers.mjs'

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
    await slides.getByRole('button', { name: 'Dupliquer la diapositive' }).click()
    await slides.getByRole('button', { name: 'Diapositive 2' }).waitFor()
    const duplicated = await harness.read('presentation.html')
    assert.match(duplicated, /id="slide-page-2-1">Untitled slide/)
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    await waitForEditorSource(page, initial)
    assert.equal(await harness.read('presentation.html'), initial)
  },
}

export const presentationPrintSpec = {
  name: 'presentations: PDF print uses a separate inert copy with all slides',
  async run({ page, browser, harness, assert }) {
    const file = 'presentation.html'
    const original = '<main id="dsh-deck" data-dsh-deck="1">\n' +
      '<section id="slide-first"><h1 id="title-first">First page</h1></section>\n' +
      '<section id="slide-second"><h1 id="title-second">Second page</h1></section>\n</main>'
    await harness.write(file, original)
    await openWorkspaceFile(page, file, { expect: 'html' })
    await page.getByRole('button', { name: 'Export PDF', exact: true }).click()
    const embedded = page.locator('iframe[title="Document imprimable de la présentation"]')
    const printable = page.frameLocator('iframe[title="Document imprimable de la présentation"]')
    const print = page.getByRole('button', { name: 'Imprimer la présentation', exact: true })
    await page.waitForFunction(() => [...document.querySelectorAll('button')]
      .some(button => button.textContent === 'Imprimer la présentation' && !button.disabled))
    assert.equal(await embedded.getAttribute('sandbox'), 'allow-same-origin allow-modals')
    assert.match(await embedded.getAttribute('srcdoc'), /320mm 180mm/)
    const headings = printable.getByRole('heading', { includeHidden: true })
    assert.deepEqual(await headings.allTextContents(), ['First page', 'Second page'])
    const frame = await (await embedded.elementHandle()).contentFrame()
    await frame.evaluate(() => { window.print = () => { document.body.dataset.printInvoked = 'true' } })
    await print.click()
    assert.equal(await frame.locator('body').getAttribute('data-print-invoked'), 'true')
    if (browser.browserType().name() === 'chromium') {
      const printPage = await page.context().newPage()
      try {
        await printPage.setContent(await embedded.getAttribute('srcdoc'))
        const pdf = await printPage.pdf({ preferCSSPageSize: true, printBackground: true })
        assert.match(pdf.toString('latin1'), /^%PDF-/)
        assert.match(pdf.toString('latin1'), /\/Type \/Pages[\s\S]{0,150}\/Count 2\b/)
      } finally {
        await printPage.close()
      }
    }
    assert.equal(await harness.read(file), original)
  },
}

export const pdfOpenSpec = {
  name: 'pdf: conversation picker opens a scoped PDF in the native reader',
  async run({ page, harness, assert }) {
    const file = 'assets/Notes #1.pdf'
    const original = '%PDF-1.4\nTest fixture'
    await harness.write(file, original)
    await page.getByRole('button', { name: 'Refresh workspace design files', exact: true }).click()
    await page.getByRole('button', { name: 'Open file ' + file, exact: true }).click()
    assert.equal(await page.evaluate(() => window.__DSH_HARNESS__.openedResource),
      'dsh-resource://file/session/' + harness.sessionId + '/assets/Notes%20%231.pdf')
    assert.equal(harness.requests.filter(request => request.path.endsWith('/document')).length, 0)
    assert.equal(harness.requests.filter(request => request.method === 'POST').length, 0)
    assert.equal(await harness.read(file), original)
  },
}

export const pdfCopySpec = {
  name: 'pdf: page selection downloads a separate ordered PDF copy',
  async run({ page, harness, assert }) {
    const { pdfFixture } = await import('../../fixtures/pdf-fixture.mjs')
    const { execFileSync, spawnSync } = await import('node:child_process')
    const file = 'source.pdf'
    const original = pdfFixture().toString('utf8')
    await harness.write(file, original)
    await page.getByRole('button', { name: 'Refresh workspace design files' }).click()
    await page.getByRole('button', { name: 'Assembler les pages', exact: true }).click()
    const form = page.getByRole('form', { name: 'Assembler des pages PDF' })
    await form.getByLabel('Pages dans l’ordre souhaité').fill('2, 1, 2')
    const button = form.getByRole('button', { name: 'Télécharger la copie PDF' })
    const hasEngine = ['pdfinfo','pdfseparate','pdfunite'].every(tool =>
      spawnSync(tool,['-v'],{stdio:'ignore'}).status === 0)
    if (hasEngine) {
      const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
      assert.equal(download.suggestedFilename(), 'source-pages.pdf')
      assert.equal(await download.failure(), null)
      if (spawnSync('pdftotext',['-v'],{stdio:'ignore'}).status === 0) {
        const text = execFileSync('pdftotext',[await download.path(),'-'],{encoding:'utf8'})
        assert.deepEqual(text.match(/(?:First|Second) text/g),['Second text','First text','Second text'])
      }
    } else {
      await button.click()
      await form.getByRole('alert').waitFor()
      assert.match(await form.getByRole('alert').textContent(), /unavailable/)
    }
    assert.equal(await harness.read(file), original)
  },
}

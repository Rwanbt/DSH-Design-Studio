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
    const other = pdfFixture(['Third text','Fourth text']).toString('utf8')
    await harness.write('other.pdf', other)
    await page.getByRole('button', { name: 'Refresh workspace design files' }).click()
    await page.getByRole('button', { name: 'Assembler les pages', exact: true }).first().click()
    const form = page.getByRole('form', { name: 'Assembler des pages PDF' })
    const first = form.getByRole('group', { name: 'Sélection 1', exact: true })
    await first.getByLabel('Fichier PDF').selectOption(file)
    await first.getByLabel('Pages dans l’ordre souhaité').fill('2, 1, 2')
    await form.getByRole('button', { name: 'Ajouter une sélection' }).click()
    const second = form.getByRole('group', { name: 'Sélection 2', exact: true })
    await second.getByLabel('Fichier PDF').selectOption('other.pdf')
    await second.getByLabel('Pages dans l’ordre souhaité').fill('1')
    await second.getByRole('button', { name: 'Monter' }).click()
    const button = form.getByRole('button', { name: 'Télécharger la copie PDF' })
    const hasEngine = ['pdfinfo','pdfseparate','pdfunite'].every(tool =>
      spawnSync(tool,['-v'],{stdio:'ignore'}).status === 0)
    if (hasEngine) {
      const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
      assert.equal(download.suggestedFilename(), 'assemblage.pdf')
      assert.equal(await download.failure(), null)
      if (spawnSync('pdftotext',['-v'],{stdio:'ignore'}).status === 0) {
        const text = execFileSync('pdftotext',[await download.path(),'-'],{encoding:'utf8'})
        assert.deepEqual(text.match(/(?:First|Second|Third) text/g),['Third text','Second text','First text','Second text'])
      }
    } else {
      await button.click()
      await form.getByRole('alert').waitFor()
      assert.match(await form.getByRole('alert').textContent(), /unavailable/)
    }
    assert.equal(await harness.read(file), original)
    assert.equal(await harness.read('other.pdf'), other)
  },
}

export const pdfNoteSpec = {
  name: 'pdf: download a text note on the selected page',
  async run({ page, harness, assert }) {
    const { pdfFixture } = await import('../../fixtures/pdf-fixture.mjs')
    const { execFileSync, spawnSync } = await import('node:child_process')
    const python = process.env.DSH_PDF_PYTHON || 'python3'
    const file = 'source.pdf'
    const original = pdfFixture().toString('utf8')
    await harness.write(file, original)
    await page.getByRole('button', { name: 'Refresh workspace design files' }).click()
    await page.getByRole('button', { name: 'Ajouter une note', exact: true }).click()
    const form = page.getByRole('form', { name: 'Ajouter une note PDF' })
    await form.getByRole('spinbutton', { name: 'Page', exact: true }).fill('2')
    if (spawnSync('pdftoppm',['-v'],{stdio:'ignore'}).status===0) {
      await form.getByRole('button', { name: 'Afficher la page' }).click()
      const image = form.getByRole('img', { name: 'Aperçu de la page PDF' })
      await image.waitFor()
      const box = await image.boundingBox()
      await image.click({position:{x:box.width/4,y:box.height/2}})
      const x = Number(await form.getByLabel('Depuis la gauche (%)').inputValue())
      const y = Number(await form.getByLabel('Depuis le haut (%)').inputValue())
      assert.ok(Math.abs(x-25)<1)
      assert.ok(Math.abs(y-50)<1)
    }
    await form.getByLabel('Texte de la note').fill('Note de révision')
    const submit = form.getByRole('button', { name: 'Télécharger la copie annotée' })
    if (spawnSync(python,['-I','-c','from pypdf.annotations import Text'],{stdio:'ignore'}).status===0) {
      const [download] = await Promise.all([page.waitForEvent('download'),submit.click()])
      assert.equal(download.suggestedFilename(),'source-annote.pdf')
      const inspect = 'import json,sys; from pypdf import PdfReader; r=PdfReader(sys.argv[1]); print(json.dumps(str(r.pages[1]["/Annots"][0].get_object()["/Contents"])))'
      assert.equal(JSON.parse(execFileSync(python,['-I','-c',inspect,await download.path()],{encoding:'utf8'})), 'Note de révision')
    } else {
      await submit.click()
      await form.getByRole('alert').waitFor()
      assert.match(await form.getByRole('alert').textContent(), /unavailable/)
    }
    assert.equal(await harness.read(file),original)
  },
}

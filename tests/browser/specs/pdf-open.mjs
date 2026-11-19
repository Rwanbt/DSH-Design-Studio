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

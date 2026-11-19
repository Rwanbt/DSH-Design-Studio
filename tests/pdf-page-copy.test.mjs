import { pdfFixture } from './fixtures/pdf-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createPdfPageCopier } from '../src/pdf-page-copy.mjs'
import { createNativeFileStore } from '../src/native-file-store.mjs'

const hasTools = ['pdfinfo','pdfseparate','pdfunite','pdftotext'].every(tool =>
  spawnSync(tool,['-v'],{stdio:'ignore'}).status === 0)

test('PDF page processing rejects invalid page requests and non-PDF input', async () => {
  const copy = createPdfPageCopier()
  await assert.rejects(copy(pdfFixture(),[0]), { code: 'invalid-pdf-pages' })
  await assert.rejects(copy(Buffer.from('not a PDF'),[1]), { code: 'invalid-pdf' })
})

test('PDF page copy preserves original bytes and selectable text in requested order', { skip: !hasTools }, async context => {
  const root = await mkdtemp(path.join(tmpdir(),'dsh-test-pdf-'))
  context.after(() => rm(root,{recursive:true,force:true}))
  const store = createNativeFileStore(root)
  const source = pdfFixture()
  const original = path.join(root,'source.pdf')
  await writeFile(original,source)
  const snapshot = await store.readPdf('source.pdf')
  assert.deepEqual(snapshot.source,source)
  await assert.rejects(store.read('source.pdf'),{ code:'unsupported-format' })
  await assert.rejects(store.readPdf('../source.pdf'),{ code:'invalid-path' })
  const copy = createPdfPageCopier()
  const output = path.join(root,'result.pdf')
  await writeFile(output,await copy(snapshot.source,[2,1,2]))
  const text = execFileSync('pdftotext',[output,'-'],{encoding:'utf8'})
  assert.deepEqual(text.match(/(?:First|Second) text/g),['Second text','First text','Second text'])
  assert.deepEqual(await readFile(original),source)
  await assert.rejects(copy(snapshot.source,[3]),{ code:'invalid-pdf-pages' })
})

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
  await assert.rejects(copy([{file:'source.pdf',pages:[0]}],()=>pdfFixture()), { code: 'invalid-pdf-pages' })
  await assert.rejects(copy([{file:'source.pdf',pages:[1]}],()=>Buffer.from('not a PDF')), { code: 'invalid-pdf' })
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
  await writeFile(output,await copy([{file:'source.pdf',pages:[2,1,2]}],()=>snapshot.source))
  const text = execFileSync('pdftotext',[output,'-'],{encoding:'utf8'})
  assert.deepEqual(text.match(/(?:First|Second) text/g),['Second text','First text','Second text'])
  assert.deepEqual(await readFile(original),source)
  await assert.rejects(copy([{file:'source.pdf',pages:[3]}],()=>snapshot.source),{ code:'invalid-pdf-pages' })
})

test('ordered selections can interleave sources and reuse one source snapshot', { skip: !hasTools }, async context => {
  const folder = await mkdtemp(path.join(tmpdir(),'dsh-test-pdf-'))
  context.after(() => rm(folder,{recursive:true,force:true}))
  const sources = new Map([['a.pdf',pdfFixture()],['b.pdf',pdfFixture(['Third text','Fourth text'])]])
  const reads = []
  const result = await createPdfPageCopier()([
    {file:'a.pdf',pages:[2]},
    {file:'b.pdf',pages:[1]},
    {file:'a.pdf',pages:[1,2]},
  ],file=>{
    reads.push(file)
    return sources.get(file)
  })
  const output = path.join(folder,'result.pdf')
  await writeFile(output,result)
  assert.deepEqual(reads,['a.pdf','b.pdf'])
  const text = execFileSync('pdftotext',[output,'-'],{encoding:'utf8'})
  assert.deepEqual(text.match(/(?:First|Second|Third) text/g),['Second text','Third text','First text','Second text'])
})

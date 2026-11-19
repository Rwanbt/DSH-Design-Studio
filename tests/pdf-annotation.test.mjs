import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createPdfAnnotator } from '../src/pdf-annotation.mjs'
import { createNativeFileStore } from '../src/native-file-store.mjs'
import { pdfFixture } from './fixtures/pdf-fixture.mjs'

const python = process.env.DSH_PDF_PYTHON || 'python3'
const available = spawnSync(python,['-I','-c','from pypdf.annotations import Text'],{stdio:'ignore'}).status===0
const note = { page:2,x:0.25,y:0.5,text:'Révision – texte conservé' }

test('invalid PDF note parameters fail before reading the source', async () => {
  const annotate = createPdfAnnotator()
  await assert.rejects(annotate({...note,x:1.1},()=>assert.fail('Unexpected read')),{code:'invalid-pdf-note'})
})

test('native PDF note lands on the selected page and preserves source bytes', { skip:!available }, async context => {
  const root = await mkdtemp(path.join(tmpdir(),'dsh-test-note-'))
  context.after(()=>rm(root,{recursive:true,force:true}))
  const file = path.join(root,'original.pdf')
  const bytes = pdfFixture()
  await writeFile(file,bytes)
  const store = createNativeFileStore(root)
  const source = async ()=>(await store.readPdf('original.pdf')).source
  const annotate = createPdfAnnotator(python)
  const output = path.join(root,'result.pdf')
  await writeFile(output,await annotate(note,source))
  const inspect = `import json,sys
from pypdf import PdfReader
r=PdfReader(sys.argv[1])
a=r.pages[1]['/Annots'][0].get_object()
print(json.dumps([len(r.pages),r.pages[0].get('/Annots'),a['/Subtype'],a['/Contents'],list(a['/Rect']),r.pages[1].extract_text()]))`
  const actual = JSON.parse(execFileSync(python,['-I','-c',inspect,output],{encoding:'utf8'}))
  assert.deepEqual(actual,[2,null,'/Text',note.text,[80,72,98,90],'Second text'])
  assert.deepEqual(await readFile(file),bytes)
  await assert.rejects(annotate({...note,page:3},source),{code:'invalid-pdf-pages'})
})

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

test('a visible anchor follows the crop box and a rotated page', { skip:!available }, async context => {
  const root = await mkdtemp(path.join(tmpdir(),'dsh-test-rotated-pdf-'))
  context.after(()=>rm(root,{recursive:true,force:true}))
  const input = path.join(root,'input.pdf'), rotated = path.join(root,'rotated.pdf')
  await writeFile(input,pdfFixture())
  const rotate = `import sys
from pypdf import PdfWriter
w=PdfWriter(clone_from=sys.argv[1])
page=w.pages[1]
page.cropbox.lower_left=(10,20)
page.cropbox.upper_right=(310,160)
page.rotate(90)
w.write(sys.argv[2])`
  execFileSync(python,['-I','-c',rotate,input,rotated])
  const output = path.join(root,'result.pdf')
  await writeFile(output,await createPdfAnnotator(python)(note,()=>readFile(rotated)))
  const inspect = 'import json,sys; from pypdf import PdfReader; print(json.dumps(list(PdfReader(sys.argv[1]).pages[1]["/Annots"][0].get_object()["/Rect"])))'
  assert.deepEqual(JSON.parse(execFileSync(python,['-I','-c',inspect,output],{encoding:'utf8'})),[160,55,178,73])
})

test('highlight writes a PDF text-markup quad and preserves the page text', { skip:!available }, async context => {
  const root = await mkdtemp(path.join(tmpdir(),'dsh-test-highlight-'))
  context.after(()=>rm(root,{recursive:true,force:true}))
  const bytes = pdfFixture()
  const annotate = createPdfAnnotator(python)
  const highlight = {kind:'highlight',page:2,x:0.125,y:0.25,width:0.25,height:0.25,text:''}
  await assert.rejects(annotate({...highlight,width:1},()=>assert.fail('Unexpected read')),{code:'invalid-pdf-note'})
  const output = path.join(root,'result.pdf')
  await writeFile(output,await annotate(highlight,()=>bytes))
  const inspect = `import json,sys
from pypdf import PdfReader
p=PdfReader(sys.argv[1]).pages[1]
a=p["/Annots"][0].get_object()
print(json.dumps([a["/Subtype"],list(a["/Rect"]),list(a["/QuadPoints"]),p.extract_text()]))`
  const actual = JSON.parse(execFileSync(python,['-I','-c',inspect,output],{encoding:'utf8'}))
  assert.deepEqual(actual,['/Highlight',[40,90,120,135],[40,135,120,135,40,90,120,90],'Second text'])
})

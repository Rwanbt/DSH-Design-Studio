import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { appendHtmlSlide, createHtmlPresentation, readHtmlPresentation } from '../src/html-presentation.mjs'
import { createPptxExporter, createPptxImporter } from '../src/presentation-pptx.mjs'

const run = promisify(execFile)
const python = process.env.DSH_PPTX_PYTHON || 'python3'
const available = spawnSync(python,['-I','-c','import pptx'],{stdio:'ignore'}).status===0

test('the PPTX exporter refuses documents without a presentation root',async()=>{
  await assert.rejects(createPptxExporter()('<p>Not a deck</p>'),{code:'unknown-node'})
})

test('PPTX contains ten ordered slides and editable Unicode text',{skip:!available},async context=>{
  const directory=await mkdtemp(path.join(tmpdir(),'dsh-pptx-test-'))
  context.after(()=>rm(directory,{recursive:true,force:true}))
  let source=createHtmlPresentation().replace('</h1>','</h1><p>Texte éditable &amp; lisible</p>')
  for(let index=2;index<=10;index+=1){
    const patch=appendHtmlSlide(source,{id:'slide-page-'+index,title:'Page '+index})
    source=source.slice(0,patch.start)+patch.after+source.slice(patch.end)
  }
  const output=path.join(directory,'deck.pptx')
  await writeFile(output,await createPptxExporter(python)(source))
  const inspect='import sys,json; from pptx import Presentation; p=Presentation(sys.argv[1]); print(json.dumps([p.slide_width,p.slide_height,[[t.text for t in s.shapes[0].text_frame.paragraphs] for s in p.slides]]))'
  const [width,height,pages]=JSON.parse((await run(python,['-I','-c',inspect,output])).stdout)
  assert.equal(width/height,16/9)
  assert.equal(pages.length,10)
  assert.deepEqual(pages[0],['Untitled slide','Texte éditable & lisible'])
  assert.deepEqual(pages[9],['Page 10'])
})

test('PPTX import produces editable escaped text in slide order',{skip:!available},async context=>{
  const directory=await mkdtemp(path.join(tmpdir(),'dsh-pptx-import-test-'))
  context.after(()=>rm(directory,{recursive:true,force:true}))
  const fixture=path.join(directory,'input.pptx')
  const generate=`
import sys
from pptx import Presentation
deck = Presentation()
slide = deck.slides.add_slide(deck.slide_layouts[1])
slide.shapes.title.text = 'Résumé <script>'
slide.placeholders[1].text = 'Une & deux'
table = slide.shapes.add_table(2, 2, 0, 0, 100, 100).table
table.first_row = True
table.cell(0, 0).merge(table.cell(0, 1))
table.cell(0, 0).text = 'En-tête & détail'
table.cell(1, 0).text = '<Valeur>\\nDeux'
slide.shapes.add_group_shape()
slide = deck.slides.add_slide(deck.slide_layouts[1])
slide.shapes.title.text = 'Conclusion'
deck.save(sys.argv[1])
`
  await run(python,['-I','-c',generate,fixture])
  const {source,omitted}=await createPptxImporter(python)(await readFile(fixture))
  assert.deepEqual(readHtmlPresentation(source).slides.map(slide=>slide.id),['slide-page-1','slide-page-2'])
  assert.match(source,/<h1 id="slide-page-1-text-1">Résumé &lt;script&gt;<\/h1>/)
  assert.match(source,/<p id="slide-page-1-text-2">Une &amp; deux<\/p>/)
  assert.match(source,/<th id="slide-page-1-table-1-r1-c1" scope="colgroup" colspan="2">/)
  assert.doesNotMatch(source,/id="slide-page-1-table-1-r1-c2"/)
  assert.match(source,/id="slide-page-1-table-1-r2-c1-p1">&lt;Valeur&gt;/)
  assert.match(source,/id="slide-page-1-table-1-r2-c1-p2">Deux/)
  assert.match(source,/Conclusion/)
  assert.equal(omitted,1)
  await assert.rejects(createPptxImporter(python)(Buffer.from('Invalid input')),{code:'unsupported-presentation'})
})

test('PPTX export rejects overlapping HTML cell spans',{skip:!available},async()=>{
  const table='<table><tr><td>A</td><td rowspan="2">B</td></tr><tr><td colspan="2">C</td></tr></table>'
  const source=createHtmlPresentation().replace('</section>',table+'</section>')
  await assert.rejects(createPptxExporter(python)(source),{code:'unsupported-presentation'})
})

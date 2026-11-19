import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appendHtmlSlide, createHtmlPresentation } from '../src/html-presentation.mjs'
import { createPptxExporter } from '../src/presentation-pptx.mjs'

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
  const [width,height,pages]=JSON.parse(execFileSync(python,['-I','-c',inspect,output],{encoding:'utf8'}))
  assert.equal(width/height,16/9)
  assert.equal(pages.length,10)
  assert.deepEqual(pages[0],['Untitled slide','Texte éditable & lisible'])
  assert.deepEqual(pages[9],['Page 10'])
})

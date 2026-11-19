import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { readHtmlPresentation } from './html-presentation.mjs'

const run = promisify(execFile)
const script = fileURLToPath(new URL('./presentation-pptx.py',import.meta.url))

function fail(code, message) {
  throw Object.assign(new Error(message),{code})
}

export function createPptxExporter(python = process.env.DSH_PPTX_PYTHON || 'python3') {
  let busy = false
  return async source => {
    if (busy) fail('file-busy','Another PPTX export is being processed')
    const { slides } = readHtmlPresentation(source)
    busy = true
    let folder
    try {
      folder = await mkdtemp(path.join(tmpdir(),'dsh-pptx-'))
      await writeFile(path.join(folder,'slides.json'),
        JSON.stringify(slides.map(slide=>source.slice(slide.start,slide.end))),{mode:0o600})
      try {
        await run(python,['-I',script],{cwd:folder,timeout:10000,maxBuffer:64*1024,windowsHide:true,
          env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot}})
      } catch(error) {
        if (error.code==='ENOENT'||error.code===10) fail('pptx-engine-unavailable','Python with python-pptx is unavailable on this host')
        fail('pptx-export-failed','The presentation could not be exported')
      }
      const output = path.join(folder,'output.pptx')
      if ((await stat(output)).size>16*1024*1024) fail('too-large','The PPTX exceeds 16 MiB')
      return await readFile(output)
    } finally {
      try {
        if (folder) await rm(folder,{recursive:true,force:true})
      } finally {
        busy = false
      }
    }
  }
}

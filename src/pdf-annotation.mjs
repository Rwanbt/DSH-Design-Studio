import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const script = fileURLToPath(new URL('./pdf-annotation.py',import.meta.url))
const maxOutputBytes = 16 * 1024 * 1024

function fail(code, message) {
  throw Object.assign(new Error(message), { code })
}

export function createPdfAnnotator(python = process.env.DSH_PDF_PYTHON || 'python3') {
  let busy = false
  return async (note, readSource) => {
    const { page, text, x, y } = note
    if (!Number.isSafeInteger(page) || page<1 || page>10_000 ||
        typeof text!=='string' || !text.trim() || text.length>2000 || text.includes('\0') ||
        ![x,y].every(value=>Number.isFinite(value)&&value>=0&&value<=1)) {
      fail('invalid-pdf-note','Choose a page, a position between 0 and 100%, and a note of up to 2000 characters')
    }
    if (busy) fail('file-busy','Another PDF annotation is being processed')
    busy = true
    let folder
    try {
      const bytes = await readSource()
      if (!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))) fail('invalid-pdf','The source is not a PDF')
      folder = await mkdtemp(path.join(tmpdir(),'dsh-pdf-note-'))
      await writeFile(path.join(folder,'input.pdf'),bytes,{mode:0o600})
      await writeFile(path.join(folder,'annotation.json'),JSON.stringify({page,text,x,y}),{mode:0o600})
      try {
        await run(python,['-I',script],{cwd:folder,timeout:10_000,maxBuffer:64*1024,windowsHide:true,
          env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot}})
      } catch(error) {
        if (error.code==='ENOENT' || error.code===10) fail('pdf-annotation-unavailable','Python with pypdf is unavailable on this host')
        if (error.code===11) fail('pdf-protected','Protected or signed PDFs cannot be annotated')
        if (error.code===12) fail('invalid-pdf-pages','The page does not exist in the source PDF')
        fail('pdf-annotation-failed','The PDF could not be annotated within the processing limit')
      }
      const output = path.join(folder,'output.pdf')
      if ((await stat(output)).size > maxOutputBytes) fail('too-large','The annotated PDF exceeds 16 MiB')
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

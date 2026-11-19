import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

function fail(code,message) {
  throw Object.assign(new Error(message),{code})
}

function escapeHtml(text) {
  return text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
}

export function createPdfTextImporter() {
  let busy = false
  return async readSource => {
    if (busy) fail('file-busy','Another PDF text import is running')
    busy = true
    let folder
    try {
      const bytes = await readSource()
      if (!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))) fail('invalid-pdf','The source is not a PDF')
      folder = await mkdtemp(path.join(tmpdir(),'dsh-pdf-text-'))
      await writeFile(path.join(folder,'input.pdf'),bytes,{mode:0o600})
      const options = {cwd:folder,timeout:5000,maxBuffer:1024*1024,windowsHide:true,
        env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,LC_ALL:'C'}}
      let pageCount, text
      try {
        const info = (await run('pdfinfo',['input.pdf'],options)).stdout
        if (/^Encrypted:\s+yes/m.test(info)) fail('pdf-protected','Protected PDFs cannot be imported')
        pageCount = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1])
        if (!Number.isSafeInteger(pageCount) || pageCount<1 || pageCount>32) {
          fail('invalid-pdf-pages','Text import accepts PDFs with one to 32 pages')
        }
        text = (await run('pdftotext',['-enc','UTF-8','input.pdf','-'],options)).stdout
      } catch (error) {
        if (['pdf-protected','invalid-pdf-pages'].includes(error.code)) throw error
        if (error.code==='ENOENT') fail('pdf-text-unavailable','Poppler text extraction is unavailable')
        fail('pdf-text-failed','The PDF could not be converted within the processing limits')
      }
      const rawPages = text.split('\f')
      if (rawPages.length!==pageCount+1 || rawPages.at(-1)!=='') {
        fail('pdf-text-failed','The extracted page boundaries could not be verified')
      }
      const emptyPages = []
      const sections = rawPages.slice(0,-1).map((raw,index)=>{
        const page = index+1
        const lines = raw.replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/gu,'').split(/\r?\n/u)
          .map(line=>line.trim()).filter(Boolean)
        if (!lines.length) emptyPages.push(page)
        const paragraphs = lines.map((line,lineIndex)=>
          `<p id="pdf-page-${page}-line-${lineIndex+1}">${escapeHtml(line)}</p>`)
        return `<section id="pdf-page-${page}">\n<h2>Page ${page}</h2>\n${paragraphs.join('\n')}\n</section>`
      })
      if (emptyPages.length===pageCount) fail('pdf-text-empty','No selectable text was found. Scanned pages require OCR.')
      const source = '<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><title>Texte du PDF</title></head>\n'+
        '<body><main id="pdf-text">\n'+sections.join('\n')+'\n</main></body></html>\n'
      return {source,emptyPages}
    } finally {
      try {
        if (folder) await rm(folder,{recursive:true,force:true})
      } finally {
        busy = false
      }
    }
  }
}

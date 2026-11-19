import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const runFile = promisify(execFile)
const maxPages = 24
const maxOutputBytes = 16 * 1024 * 1024

function fail(code, message) {
  throw Object.assign(new Error(message), { code })
}

function validatePages(pages) {
  if (!Array.isArray(pages) || pages.length === 0 || pages.length > maxPages ||
      pages.some(page => !Number.isSafeInteger(page) || page < 1 || page > 10_000)) {
    fail('invalid-pdf-pages', 'Choose one to 24 page numbers between 1 and 10000')
  }
}

async function run(binary, args, cwd, signal) {
  try {
    const { stdout } = await runFile(binary,args,{
      cwd,signal,timeout:4000,maxBuffer:64*1024,windowsHide:true,
      env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,LC_ALL:'C'},
    })
    return stdout
  } catch (error) {
    if (error.code === 'ENOENT') fail('pdf-engine-unavailable','Poppler PDF utilities are unavailable on this host')
    fail('pdf-copy-failed','The PDF is protected, unsupported, or could not be assembled within the processing limit')
  }
}

export function createPdfPageCopier() {
  let busy = false
  return async (bytes, pages) => {
    validatePages(pages)
    if (!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))) fail('invalid-pdf','The source is not a PDF')
    if (busy) fail('file-busy','Another PDF copy is being processed')
    busy = true
    let folder
    try {
      folder = await mkdtemp(path.join(tmpdir(),'dsh-pdf-copy-'))
      const input = 'input.pdf'
      const output = 'output.pdf'
      const signal = AbortSignal.timeout(15_000)
      await writeFile(path.join(folder,input),bytes,{mode:0o600})
      const info = await run('pdfinfo',[input],folder,signal)
      const count = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1])
      if (/^Encrypted:\s+yes/m.test(info)) fail('pdf-protected','Protected PDFs cannot be copied')
      if (!Number.isSafeInteger(count) || pages.some(page => page > count)) {
        fail('invalid-pdf-pages','A selected page does not exist in the source PDF')
      }
      const sizes = new Map()
      let extractedBytes = 0
      for (const page of new Set(pages)) {
        await run('pdfseparate',['-f',String(page),'-l',String(page),input,'page-%d.pdf'],folder,signal)
        const size = (await stat(path.join(folder,`page-${page}.pdf`))).size
        sizes.set(page,size)
        extractedBytes += size
        if (extractedBytes > maxOutputBytes) fail('too-large','Extracted PDF pages exceed 16 MiB')
      }
      if (pages.reduce((total,page)=>total+sizes.get(page),0) > maxOutputBytes) {
        fail('too-large','The selected page copies exceed 16 MiB')
      }
      if (pages.length === 1) {
        await copyFile(path.join(folder,`page-${pages[0]}.pdf`),path.join(folder,output))
      } else {
        await run('pdfunite',[...pages.map(page=>`page-${page}.pdf`),output],folder,signal)
      }
      const result = path.join(folder,output)
      if ((await stat(result)).size > maxOutputBytes) fail('too-large','The output PDF exceeds 16 MiB')
      return await readFile(result)
    } finally {
      try {
        if (folder) await rm(folder,{recursive:true,force:true})
      } finally {
        busy = false
      }
    }
  }
}

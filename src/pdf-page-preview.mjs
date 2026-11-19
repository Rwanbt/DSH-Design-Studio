import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const pngSignature = Buffer.from([137,80,78,71,13,10,26,10])

function fail(code, message) {
  throw Object.assign(new Error(message),{code})
}

export function createPdfPagePreview() {
  let busy = false
  return async (page, readSource) => {
    if (!Number.isSafeInteger(page) || page<1 || page>10_000) {
      fail('invalid-pdf-pages','Choose a page between 1 and 10000')
    }
    if (busy) fail('file-busy','Another PDF page is being rendered')
    busy = true
    let folder
    try {
      const {source, hash, identity} = await readSource()
      if (!source.subarray(0,5).equals(Buffer.from('%PDF-'))) fail('invalid-pdf','The source is not a PDF')
      folder = await mkdtemp(path.join(tmpdir(),'dsh-pdf-preview-'))
      await writeFile(path.join(folder,'input.pdf'),source,{mode:0o600})
      let png, pageCount
      try {
        const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,XDG_CACHE_HOME:folder,LC_ALL:'C'}
        const {stdout}=await run('pdfinfo',['input.pdf'],{
          cwd:folder,timeout:3000,maxBuffer:64*1024,windowsHide:true,env,
        })
        pageCount=Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1])
        if (!Number.isSafeInteger(pageCount) || pageCount<1 || page>pageCount) {
          fail('invalid-pdf-pages','This page is outside the PDF')
        }
        const pageNumber=String(page)
        const result=await run('pdftoppm',[
          '-cropbox','-f',pageNumber,'-l',pageNumber,'-scale-to','800','-singlefile','-png','input.pdf',
        ],{cwd:folder,timeout:6000,maxBuffer:3*1024*1024,encoding:'buffer',windowsHide:true,
          env})
        png=result.stdout
      } catch (error) {
        if (error.code==='invalid-pdf-pages') throw error
        if (error.code==='ENOENT') fail('pdf-preview-unavailable','Poppler page rendering is unavailable on this host')
        fail('pdf-preview-failed','The page does not exist, is protected, or could not be rendered')
      }
      if (!png.subarray(0,8).equals(pngSignature)) fail('pdf-preview-failed','No image was returned for this page')
      return {png,hash,identity,pageCount}
    } finally {
      try {
        if (folder) await rm(folder,{recursive:true,force:true})
      } finally {
        busy = false
      }
    }
  }
}

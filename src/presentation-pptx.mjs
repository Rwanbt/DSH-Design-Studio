import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { readHtmlPresentation } from './html-presentation.mjs'

const run = promisify(execFile)
const script = fileURLToPath(new URL('./presentation-pptx.py',import.meta.url))
const defaultPython = () => process.env.DSH_PPTX_PYTHON || 'python3'

function fail(code, message) {
  throw Object.assign(new Error(message),{code})
}

function createConverter(python, mode, inputName, outputName, maxBytes) {
  let busy = false
  return async input => {
    if (busy) fail('file-busy','Another PPTX conversion is being processed')
    busy = true
    let folder
    try {
      folder = await mkdtemp(path.join(tmpdir(),'dsh-pptx-'))
      await writeFile(path.join(folder,inputName),input,{mode:0o600})
      try {
        await run(python,['-I',script,mode],{cwd:folder,timeout:10000,maxBuffer:64*1024,windowsHide:true,
          env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot}})
      } catch(error) {
        if (error.code==='ENOENT'||error.code===10) fail('pptx-engine-unavailable','Python with python-pptx is unavailable on this host')
        if (error.code===11) fail('unsupported-presentation','Expected a valid PPTX with one to 32 slides within the import limits')
        fail('pptx-'+mode+'-failed','The PPTX conversion failed')
      }
      const output = path.join(folder,outputName)
      if ((await stat(output)).size>maxBytes) fail('too-large','The converted presentation exceeds the size limit')
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

export function createPptxExporter(python = defaultPython()) {
  const convert = createConverter(python,'export','slides.json','output.pptx',16*1024*1024)
  return async source => {
    const { slides } = readHtmlPresentation(source)
    return convert(JSON.stringify(slides.map(slide=>source.slice(slide.start,slide.end))))
  }
}

export function createPptxImporter(python = defaultPython()) {
  const convert = createConverter(python,'import','input.pptx','slides.json',8*1024*1024)
  return async bytes => {
    if (!Buffer.isBuffer(bytes) || bytes.length>8*1024*1024) fail('too-large','The PPTX exceeds 8 MiB')
    const {source, omitted} = JSON.parse(await convert(bytes))
    readHtmlPresentation(source)
    return {source, omitted}
  }
}

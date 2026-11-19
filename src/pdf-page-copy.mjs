import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const runFile = promisify(execFile)
const rotationScript = fileURLToPath(new URL('./pdf-page-rotate.py',import.meta.url))
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


function groupSelections(selections) {
  if (!Array.isArray(selections) || selections.length === 0 || selections.length > 8) {
    fail('invalid-pdf-pages','Choose one to eight PDF selections')
  }
  const groups = new Map()
  const order = []
  const rotations = []
  for (const selection of selections) {
    if (!selection || typeof selection.file !== 'string' || !selection.file) {
      fail('invalid-pdf-pages','Choose a PDF for each selection')
    }
    validatePages(selection.pages)
    const rotation = selection.rotation === undefined ? 0 : selection.rotation
    if (![0,90,180,270].includes(rotation)) {
      fail('invalid-pdf-rotation','Choose a rotation of 0, 90, 180 or 270 degrees')
    }
    if (order.length + selection.pages.length > maxPages) {
      fail('invalid-pdf-pages','Choose at most 24 pages across all selections')
    }
    if (!groups.has(selection.file)) {
      groups.set(selection.file,{ index:groups.size, pages:new Set() })
    }
    const group = groups.get(selection.file)
    for (const page of selection.pages) {
      group.pages.add(page)
      rotations.push(rotation)
      order.push(`source-${group.index}-page-${page}.pdf`)
    }
  }
  return { groups, order, rotations }
}

async function extractPages(folder, signal, group, bytes, recordSize) {
  if (!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))) fail('invalid-pdf','The source is not a PDF')
  const prefix = 'source-' + group.index
  const input = prefix + '.pdf'
  await writeFile(path.join(folder,input),bytes,{mode:0o600})
  const info = await run('pdfinfo',[input],folder,signal)
  const count = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1])
  if (/^Encrypted:\s+yes/m.test(info)) fail('pdf-protected','Protected PDFs cannot be copied')
  if (!Number.isSafeInteger(count) || [...group.pages].some(page => page > count)) {
    fail('invalid-pdf-pages','A selected page does not exist in the source PDF')
  }
  for (const page of group.pages) {
    await run('pdfseparate',['-f',String(page),'-l',String(page),input,prefix+'-page-%d.pdf'],folder,signal)
    const name = prefix + '-page-' + page + '.pdf'
    recordSize(name,(await stat(path.join(folder,name))).size)
  }
}

async function rotatePages(python, folder, signal, input, rotations) {
  try {
    await runFile(python,['-I',rotationScript,input,JSON.stringify(rotations)],{
      cwd:folder,signal,timeout:5000,maxBuffer:64*1024,windowsHide:true,
      env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot},
    })
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 10) {
      fail('pdf-rotation-unavailable','Python with pypdf is unavailable on this host')
    }
    fail('pdf-copy-failed','The assembled PDF could not be rotated within the processing limit')
  }
  return path.join(folder,'rotated.pdf')
}

export function createPdfPageCopier(python = process.env.DSH_PDF_PYTHON || 'python3') {
  let busy = false
  return async (selections, readSource) => {
    const { groups, order, rotations } = groupSelections(selections)
    if (busy) fail('file-busy','Another PDF copy is being processed')
    busy = true
    let folder
    try {
      folder = await mkdtemp(path.join(tmpdir(),'dsh-pdf-copy-'))
      const signal = AbortSignal.timeout(15_000)
      const sizes = new Map()
      let extractedBytes = 0
      const recordSize = (file,size) => {
        sizes.set(file,size)
        extractedBytes += size
        if (extractedBytes > maxOutputBytes) fail('too-large','Extracted PDF pages exceed 16 MiB')
      }
      for (const [file,group] of groups) {
        await extractPages(folder,signal,group,await readSource(file),recordSize)
      }
      if (order.reduce((total,file)=>total+sizes.get(file),0) > maxOutputBytes) {
        fail('too-large','The selected page copies exceed 16 MiB')
      }
      const output = 'output.pdf'
      const result = path.join(folder,output)
      if (order.length === 1) {
        await copyFile(path.join(folder,order[0]),result)
      } else {
        await run('pdfunite',[...order,output],folder,signal)
      }
      if ((await stat(result)).size > maxOutputBytes) fail('too-large','The output PDF exceeds 16 MiB')
      const final = rotations.some(Boolean) ? await rotatePages(python,folder,signal,output,rotations) : result
      if (final !== result && (await stat(final)).size > maxOutputBytes) fail('too-large','The rotated PDF exceeds 16 MiB')
      return await readFile(final)
    } finally {
      try {
        if (folder) await rm(folder,{recursive:true,force:true})
      } finally {
        busy = false
      }
    }
  }
}

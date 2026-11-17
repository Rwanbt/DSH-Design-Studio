import { readdir, realpath, lstat } from 'node:fs/promises'
import path from 'node:path'

const FORMATS = new Set(['svg','html','htm','css'])
const EXCLUDED_DIRS = new Set([
  '.git', '.hg', '.svn', '.cache', '.next', '.nuxt', '.venv', '__pycache__',
  'node_modules', 'coverage', '.turbo', '.gradle',
])
const MAX_DEPTH = 7
const MAX_SCAN = 4000
const MAX_FILES = 300
const MAX_BYTES = 8 * 1024 * 1024

function fail(code, message) {
  const err = new Error(message)
  err.code = code
  throw err
}

/**
 * Bounded, read-only file discovery inside a live DSH session workspace.
 *
 * This is a *picker*, not a grant of authority to edit anything. Every file
 * selected still goes through createNativeFileStore.read/apply with path and
 * revision validation. No source bytes or absolute host paths are returned.
 *
 * No recursive traversal of symlinked directories, no hidden files/directories,
 * and no traversal into package-manager caches. A directory changing while
 * scanned is skipped rather than failing the whole picker.
 */
export async function listWorkspaceDocuments(workspace) {
  if (typeof workspace !== 'string' || workspace.length === 0) {
    fail('invalid-path','Workspace root must be a directory')
  }
  const root = await realpath(workspace)
  const rootInfo = await lstat(root)
  if (!rootInfo.isDirectory()) fail('invalid-path','Workspace root is not a directory')
  const files = []
  const pending = [{ absolute:root, relative:'', depth:0 }]
  let scanned=0, truncated=false

  while (pending.length > 0) {
    const current = pending.shift()
    if (current.depth > MAX_DEPTH) {truncated=true;continue}
    let entries
    try {
      entries = await readdir(current.absolute, {withFileTypes:true})
    } catch (err) {
      if (['ENOENT','EACCES','EPERM','ENOTDIR'].includes(err?.code)) continue
      throw err
    }
    entries.sort((a,b)=>a.name.localeCompare(b.name,'en'))
    for (const entry of entries) {
      if (++scanned > MAX_SCAN) {truncated=true;break}
      if (entry.name.startsWith('.') || entry.name.includes('\0') ||
          entry.name.includes('/') || entry.name.includes('\\')) continue
      const relative = current.relative ? current.relative+'/'+entry.name : entry.name
      const absolute = path.join(current.absolute,entry.name)
      let info
      try {info=await lstat(absolute)}
      catch (err) {
        if (['ENOENT','EACCES','EPERM','ENOTDIR'].includes(err?.code)) continue
        throw err
      }
      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue
        if (current.depth < MAX_DEPTH) pending.push({absolute,relative,depth:current.depth+1})
        else truncated=true
        continue
      }
      if (!info.isFile() || info.nlink !== 1 || info.size > MAX_BYTES) continue
      const format=path.extname(entry.name).slice(1).toLowerCase()
      if (!FORMATS.has(format)) continue
      files.push({path:relative,format,size:info.size})
      if (files.length >= MAX_FILES) {truncated=true;break}
    }
    if (truncated && (scanned > MAX_SCAN || files.length >= MAX_FILES)) break
  }

  files.sort((a,b)=>a.path.localeCompare(b.path,'en'))
  return {files,truncated,scanned}
}

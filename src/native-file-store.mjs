import { constants } from 'node:fs'
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { applyNativePatches, sourceHash } from './native-patch.mjs'
import { withNativeWriteLock } from './native-write-lock.mjs'

const MAX_BYTES = 8 * 1024 * 1024
const FORMATS = new Set(['svg', 'html', 'htm', 'css'])
const locks = new Map()

function error(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

function lock(key, action) {
  const previous = locks.get(key) ?? Promise.resolve()
  const current = previous.then(action, action)
  const tail = current.then(() => undefined, () => undefined)
  locks.set(key, tail)
  void tail.then(() => { if (locks.get(key) === tail) locks.delete(key) })
  return current
}

function validateRelativePath(file) {
  if (typeof file !== 'string' || !file || file.includes('\\') || file.includes('\0') ||
      path.posix.isAbsolute(file) || path.win32.isAbsolute(file) || /^[A-Za-z]:/.test(file)) {
    throw error('invalid-path', 'Path must be a relative workspace file path')
  }
  const parts = file.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw error('invalid-path', 'Dot segments and empty path components are forbidden')
  }
  const format = path.posix.extname(file).slice(1).toLowerCase()
  if (!FORMATS.has(format)) throw error('unsupported-format', 'Only SVG, HTML and CSS can be opened')
  return { parts, format }
}

async function ensureSafeFile(workspace, file) {
  const { parts, format } = validateRelativePath(file)
  const root = await realpath(workspace)
  let current = root
  for (let i = 0; i < parts.length; i += 1) {
    current = path.join(current, parts[i])
    const info = await lstat(current)
    if (info.isSymbolicLink()) throw error('symlink-forbidden', 'Symlinks inside the workspace are not editable')
    if (i < parts.length - 1 && !info.isDirectory()) throw error('invalid-path', 'Parent is not a directory')
    if (i === parts.length - 1 && (!info.isFile() || info.nlink !== 1)) {
      throw error('invalid-file', 'Only regular, non-hardlinked files are editable')
    }
  }
  const parent = await realpath(path.dirname(current))
  if (parent !== root && !parent.startsWith(root + path.sep)) {
    throw error('invalid-path', 'File escapes workspace')
  }
  return { absolute: current, format }
}

function decodeUtf8(bytes) {
  if (bytes.includes(0)) throw error('invalid-encoding', 'NUL bytes are not supported')
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { throw error('invalid-encoding', 'File must contain valid UTF-8') }
}

async function readChecked(absolute) {
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.nlink !== 1) throw error('invalid-file', 'File must be regular and not hardlinked')
    if (info.size > MAX_BYTES) throw error('too-large', 'File exceeds 8 MiB')
    const chunks = []
    const buffer = Buffer.alloc(Math.min(64 * 1024, MAX_BYTES + 1))
    let count = 0
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      count += bytesRead
      if (count > MAX_BYTES) throw error('too-large', 'File exceeds 8 MiB')
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
    }
    const bytes = Buffer.concat(chunks)
    return { source: decodeUtf8(bytes), rawHash: createHash('sha256').update(bytes).digest('hex'), mode: info.mode & 0o777 }
  } finally { await handle.close() }
}

async function fsyncDirectory(dir) {
  // Directory fsync is supported on POSIX, but not uniformly on Windows.
  if (process.platform === 'win32') return
  const handle = await open(dir, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

export function createNativeFileStore(workspace) {
  if (typeof workspace !== 'string' || !workspace) throw error('invalid-path', 'Workspace root required')
  return {
    async read(file) {
      const target = await ensureSafeFile(workspace, file)
      const current = await readChecked(target.absolute)
      return { file, format: target.format, source: current.source, hash: current.rawHash }
    },
    async apply(file, { baseHash, patches }) {
      const target = await ensureSafeFile(workspace, file)
      return lock(target.absolute, () => withNativeWriteLock(target.absolute, async () => {
        const checked = await ensureSafeFile(workspace, file)
        if (checked.absolute !== target.absolute) throw error('invalid-path','Workspace target changed while acquiring lock')
        const current = await readChecked(target.absolute)
        if (current.rawHash !== baseHash) throw error('stale-revision', 'On-disk file changed; reload before saving')
        const result = applyNativePatches({source: current.source, format: target.format, baseHash: sourceHash(current.source), patches})
        if (!result.ok) throw error(result.code, result.message)
        if (!result.changed) return { file, hash: current.rawHash, changed: false, inverse: result.inverse }
        const output = Buffer.from(result.source, 'utf8')
        if (output.length > MAX_BYTES) throw error('too-large', 'Edited file exceeds 8 MiB')
        const temp = path.join(path.dirname(target.absolute), '.' + path.basename(target.absolute) + '.' + randomUUID() + '.tmp')
        let created = false
        try {
          const h = await open(temp, 'wx', current.mode)
          created = true
          try { await h.writeFile(output); await h.chmod(current.mode); await h.sync() }
          finally { await h.close() }
          // Check immediately before replacing: cooperating Design Studio processes also hold the lock.
          // NOTE: external editors do not honor it; this is not a universal filesystem CAS.
          await ensureSafeFile(workspace, file)
          const latest = await readChecked(target.absolute)
          if (latest.rawHash !== baseHash) throw error('stale-revision', 'On-disk file changed during edit; save aborted')
          await rename(temp, target.absolute)
          created = false
          await fsyncDirectory(path.dirname(target.absolute))
          return { file, hash: createHash('sha256').update(output).digest('hex'), changed: true, inverse: result.inverse }
        } finally {
          if (created) await unlink(temp).catch(() => {})
        }
      }))
    },
  }
}

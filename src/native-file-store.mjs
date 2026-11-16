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
  // Reject Windows path aliases and NTFS alternate data streams on all OSes,
  // so the same saved workspace path has a stable meaning everywhere.
  if (parts.some(part => /[:*?"<>|\u0000-\u001f\u007f]/u.test(part) ||
      /[. ]$/u.test(part) ||
      /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(part))) {
    throw error('invalid-path', 'Ambiguous or OS-reserved path component')
  }
  const format = path.posix.extname(file).slice(1).toLowerCase()
  if (!FORMATS.has(format)) throw error('unsupported-format', 'Only SVG, HTML and CSS can be opened')
  return { parts, format }
}

function nodeKey(info) {
  return String(info.dev) + ':' + String(info.ino)
}

function sameTree(left, right) {
  return left.root === right.root && left.absolute === right.absolute &&
    left.entries.length === right.entries.length &&
    left.entries.every((entry,index) => entry.path === right.entries[index].path &&
      entry.key === right.entries[index].key)
}

function assertSameTree(before, after) {
  if (!sameTree(before, after)) {
    throw error('stale-revision','Workspace file or directory identity changed; reload before saving')
  }
}

async function ensureSafeFile(workspace, file) {
  const { parts, format } = validateRelativePath(file)
  const root = await realpath(workspace)
  const rootInfo = await lstat(root,{bigint:true})
  if (!rootInfo.isDirectory()) throw error('invalid-path','Workspace root is not a directory')
  const entries = [{path:root,key:nodeKey(rootInfo)}]
  let current = root
  for (let i = 0; i < parts.length; i += 1) {
    current = path.join(current, parts[i])
    const info = await lstat(current,{bigint:true})
    entries.push({path:current,key:nodeKey(info)})
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
  return { absolute: current, format, root, entries }
}
function revisionIdentity(info,rawHash) {
  const fields=[info.dev,info.ino,info.ctimeNs??info.ctimeMs,
    info.mtimeNs??info.mtimeMs,info.size,rawHash]
  return createHash('sha256').update(fields.map(String).join(':')).digest('hex')
}
function sameReadStat(a,b) {
  return nodeKey(a)===nodeKey(b) && a.size===b.size &&
    a.ctimeNs===b.ctimeNs && a.mtimeNs===b.mtimeNs
}

function decodeUtf8(bytes) {
  if (bytes.includes(0)) throw error('invalid-encoding', 'NUL bytes are not supported')
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { throw error('invalid-encoding', 'File must contain valid UTF-8') }
}

async function readChecked(absolute) {
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = await handle.stat({bigint:true})
    if (!info.isFile() || info.nlink !== 1n) throw error('invalid-file', 'File must be regular and not hardlinked')
    if (info.size > BigInt(MAX_BYTES)) throw error('too-large', 'File exceeds 8 MiB')
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
    const finalInfo = await handle.stat({bigint:true})
    if (!sameReadStat(info,finalInfo)) {
      throw error('stale-revision','File was modified while being read; retry')
    }
    const rawHash = createHash('sha256').update(bytes).digest('hex')
    return { source: decodeUtf8(bytes), rawHash,
      identity: revisionIdentity(info,rawHash), key: nodeKey(info),
      mode: Number(info.mode & 0o777n) }
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
      const verified = await ensureSafeFile(workspace,file)
      assertSameTree(target,verified)
      if (current.key !== verified.entries.at(-1).key) {
        throw error('stale-revision','Workspace file changed during read')
      }
      return { file, format: target.format, source: current.source, hash: current.rawHash,
        identity: current.identity }
    },
    async apply(file, { baseHash, baseIdentity, patches }) {
      const target = await ensureSafeFile(workspace, file)
      return lock(target.absolute, () => withNativeWriteLock(target.absolute, async () => {
        const checked = await ensureSafeFile(workspace, file)
        assertSameTree(target,checked)
        const current = await readChecked(target.absolute)
        if (current.key !== checked.entries.at(-1).key ||
            current.rawHash !== baseHash ||
            (baseIdentity !== undefined && current.identity !== baseIdentity)) {
          throw error('stale-revision','On-disk file identity or revision changed; reload before saving')
        }
        const result = applyNativePatches({source: current.source, format: target.format, baseHash: sourceHash(current.source), patches})
        if (!result.ok) throw error(result.code, result.message)
        if (!result.changed) return { file, hash: current.rawHash, identity:current.identity,
          changed: false, inverse: result.inverse }
        const output = Buffer.from(result.source, 'utf8')
        if (output.length > MAX_BYTES) throw error('too-large', 'Edited file exceeds 8 MiB')
        const temp = path.join(path.dirname(target.absolute), '.' + path.basename(target.absolute) + '.' + randomUUID() + '.tmp')
        let created = false
        let tempKey
        try {
          const h = await open(temp, 'wx', current.mode)
          created = true
          try {
            await h.writeFile(output); await h.chmod(current.mode); await h.sync()
            tempKey=nodeKey(await h.stat({bigint:true}))
          } finally { await h.close() }
          // Check immediately before replacing: cooperating Design Studio processes also hold the lock.
          // NOTE: external editors do not honor it; this is not a universal filesystem CAS.
          const checkedAgain = await ensureSafeFile(workspace, file)
          assertSameTree(checked,checkedAgain)
          const latest = await readChecked(target.absolute)
          if (latest.key !== current.key || latest.identity !== current.identity ||
              latest.rawHash !== baseHash) {
            throw error('stale-revision','On-disk file identity or revision changed during edit; save aborted')
          }
          const tempInfo=await lstat(temp,{bigint:true})
          if (!tempInfo.isFile() || tempInfo.nlink!==1n || nodeKey(tempInfo)!==tempKey) {
            throw error('stale-revision','Temporary output file changed before commit')
          }
          await rename(temp, target.absolute)
          created = false
          await fsyncDirectory(path.dirname(target.absolute))
          const written = await readChecked(target.absolute)
          if (written.key !== tempKey ||
              written.rawHash !== createHash('sha256').update(output).digest('hex')) {
            throw error('stale-revision','Post-commit file validation failed; reload document')
          }
          return { file, hash: written.rawHash, identity:written.identity,
            changed: true, inverse: result.inverse }
        } finally {
          if (created) await unlink(temp).catch(() => {})
        }
      }))
    },
  }
}

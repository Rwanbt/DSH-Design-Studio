import { constants } from 'node:fs'
import * as nodeFs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { applyNativePatches, sourceHash } from './native-patch.mjs'
import { withNativeWriteLock } from './native-write-lock.mjs'

const MAX_BYTES = 8 * 1024 * 1024
const FORMATS = new Set(['svg', 'html', 'htm', 'css'])
const locks = new Map()
// New documents are created with ordinary user-file permissions; the process
// umask still applies (Node has no portable way to force an exact mode).
const CREATE_MODE = 0o644
// Hard links are unavailable on some filesystems (exFAT/FAT32, a few network
// mounts). Those codes select the exclusive-create fallback instead of failing.
const CREATE_LINK_UNSUPPORTED = new Set(['EXDEV', 'EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EMLINK'])

/**
 * Exact, revision-checked source storage for real SVG/HTML/CSS files.
 *
 * WRITE PROTOCOL (cooperating Design Studio processes):
 *   1. the caller must present the `hash` and `identity` returned by read();
 *   2. a cross-process advisory lock (`.NAME.dsh-native.lock` directory) is
 *      acquired; the atomic mkdir serializes cooperating writers;
 *   3. the path tree, content SHA-256 and filesystem identity are re-checked
 *      inside the critical section;
 *   4. output is written to a same-directory temporary file, fsynced, and the
 *      target is re-validated immediately before the atomic rename;
 *   5. after rename the directory is fsynced (POSIX) and the committed file is
 *      read back to verify inode key and content SHA-256.
 *
 * In one sentence: a cooperative advisory lock + pre-rename re-validation +
 * post-commit verification. This is NOT a universal filesystem CAS.
 *
 * CREATE PROTOCOL (new documents):
 *   1. the relative path is validated and every existing parent directory is
 *      resolved (no symlink, no escape from the workspace root);
 *   2. the target must be absent; absence is re-checked inside the lock;
 *   3. bytes go to a same-directory temporary file, fsynced, then commit uses
 *      link() — which fails with EEXIST instead of replacing a target — with an
 *      exclusive `wx` create as the fallback for filesystems without links;
 *   4. the committed file is read back and its SHA-256 must match the bytes.
 *   Nothing is ever renamed over a target, so a race can lose the create but
 *   can never destroy an existing file.
 *
 * GUARANTEES for cooperating writers:
 *   - two processes starting from the same revision never both commit;
 *   - stale content, replaced files, moved/replaced parents, symlinks and
 *     hardlinks are refused with a typed `code`;
 *   - every failure before the atomic rename leaves the original file
 *     untouched, unlinks the temporary file and releases the lock;
 *   - a failure after the rename (directory fsync or post-commit read-back)
 *     is surfaced as `commit-failed`/`stale-revision` and forces a reload of
 *     the committed bytes; it is never reported as a silent success.
 *
 * NON-GUARANTEES (do not describe this as a universal filesystem CAS):
 *   - external editors do not honor the lock. Node exposes no portable
 *     atomic compare-and-rename primitive, so an unavoidable TOCTOU window
 *     remains between the final validation and rename(). A non-cooperating
 *     writer that writes inside that window can be overwritten. Hash and
 *     identity re-validation reject stale bases; they cannot eliminate it.
 *   - a crash between lock acquisition and release leaves the lock directory
 *     (and possibly `.NAME.UUID.tmp`) behind. Nothing is auto-evicted or
 *     auto-resumed; recovery is explicit and manual, after checking that no
 *     live writer owns the lock.
 *   - Windows: directory fsync is skipped and an external process holding the
 *     target open can make rename() fail (`commit-failed`) instead of
 *     corrupting it. No Windows CI result is claimed by this module.
 *   - network filesystems (NFS/SMB) may not offer atomic mkdir/rename or
 *     stable inode/ctime identity across clients. On filesystems that report
 *     ino 0 or coarse timestamps (some FAT/exotic mounts), identity is weaker:
 *     an identical-bytes replacement with identical timestamps can only be
 *     caught by re-reading the content, not by the identity token alone.
 *   - create() never creates directories: a missing parent is `missing-directory`
 *     and the user (or the conversation) must create it first;
 *   - create() is exclusive with respect to the *name*, not to meaning: two
 *     processes racing for the same new path get one file and one
 *     `already-exists`, which is the intended outcome.
 *
 * `createNativeFileStore(workspace, { io, lock })` exposes a narrow test seam:
 * `io` may replace open/lstat/realpath/rename/unlink and `lock` forwards
 * waitMs/pollMs/io to the advisory lock. Defaults are the real fs functions,
 * so production callers keep using `createNativeFileStore(workspace)`.
 */
const DEFAULT_IO = Object.freeze({
  open: nodeFs.open,
  lstat: nodeFs.lstat,
  realpath: nodeFs.realpath,
  rename: nodeFs.rename,
  unlink: nodeFs.unlink,
  link: nodeFs.link,
})

function error(code, message, cause) {
  const err = new Error(message)
  err.code = code
  if (cause !== undefined) err.cause = cause
  return err
}

function resolveIo(overrides) {
  if (overrides === undefined) return DEFAULT_IO
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw error('invalid-option', 'io overrides must be an object')
  }
  for (const key of Object.keys(overrides)) {
    if (!Object.hasOwn(DEFAULT_IO, key)) throw error('invalid-option', 'Unsupported io override: ' + key)
    if (typeof overrides[key] !== 'function') throw error('invalid-option', 'io override must be a function: ' + key)
  }
  return Object.freeze({ ...DEFAULT_IO, ...overrides })
}

function pathFailure(err, message) {
  if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
    return error('stale-revision', message, err)
  }
  if (err && err.code === 'ELOOP') {
    return error('symlink-forbidden', 'Symlinked path component is not editable', err)
  }
  return err
}

function tempCreateFailure(err) {
  if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
    return error('stale-revision', 'Parent directory disappeared before temporary output was created; reload before saving', err)
  }
  if (err && err.code === 'EEXIST') {
    return error('stale-revision', 'Temporary output name was taken by another writer; reload before saving', err)
  }
  return error('temp-write-failed', 'Could not create temporary output file; original file preserved', err)
}

function commitFailure(err) {
  if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
    return error('stale-revision', 'File or parent directory disappeared before commit; original file preserved', err)
  }
  if (err && (err.code === 'EBUSY' || err.code === 'ETXTBSY')) {
    return error('file-busy', 'File is busy in another application; close it and retry', err)
  }
  return error('commit-failed', 'Atomic replacement failed; original file preserved', err)
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

async function walkSafe(workspace, file, io, { allowMissingLeaf = false } = {}) {
  const { parts, format } = validateRelativePath(file)
  let root, rootInfo
  try {
    root = await io.realpath(workspace)
    rootInfo = await io.lstat(root,{bigint:true})
  } catch (err) {
    throw pathFailure(err, 'Workspace root disappeared or became unreadable; reload workspace')
  }
  if (!rootInfo.isDirectory()) throw error('invalid-path','Workspace root is not a directory')
  const entries = [{path:root,key:nodeKey(rootInfo)}]
  let current = root
  for (let i = 0; i < parts.length; i += 1) {
    const leaf = i === parts.length - 1
    current = path.join(current, parts[i])
    let info
    try {
      info = await io.lstat(current,{bigint:true})
    } catch (err) {
      // A new document may not exist yet; its parents must, and are still
      // verified below. Only the leaf itself is permitted to be absent.
      if (leaf && allowMissingLeaf && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) break
      if (!leaf && allowMissingLeaf && err.code === 'ENOENT') {
        throw error('missing-directory', 'Parent directory does not exist inside the workspace')
      }
      throw pathFailure(err, allowMissingLeaf
        ? 'Parent directory disappeared; reload before creating'
        : 'File or parent directory disappeared; reload before saving')
    }
    entries.push({path:current,key:nodeKey(info)})
    if (info.isSymbolicLink()) throw error('symlink-forbidden', 'Symlinks inside the workspace are not editable')
    // Creation compares only the parent tree: a leaf that appears between
    // validation and commit belongs to another creator and is refused by
    // assertAbsent inside the critical section (as `already-exists`), not
    // reported as a stale revision.
    if (leaf && allowMissingLeaf) {
      entries.pop()
      continue
    }
    if (!leaf && !info.isDirectory()) throw error('invalid-path', 'Parent is not a directory')
    if (leaf && (!info.isFile() || info.nlink !== 1n)) {
      throw error('invalid-file', 'Only regular, non-hardlinked files are editable')
    }
  }
  const directory = path.dirname(current)
  let parent
  try {
    parent = await io.realpath(directory)
  } catch (err) {
    throw pathFailure(err, allowMissingLeaf
      ? 'Parent directory disappeared; reload before creating'
      : 'File parent directory disappeared; reload before saving')
  }
  if (parent !== root && !parent.startsWith(root + path.sep)) {
    throw error('invalid-path', 'File escapes workspace')
  }
  return { absolute: current, directory, format, root, entries }
}

async function ensureSafeFile(workspace, file, io) {
  return walkSafe(workspace, file, io)
}

async function ensureSafeTarget(workspace, file, io) {
  return walkSafe(workspace, file, io, { allowMissingLeaf: true })
}

/** Refuse to create over anything that already occupies the path. */
async function assertAbsent(absolute, io) {
  try {
    await io.lstat(absolute, { bigint: true })
  } catch (err) {
    if (err && err.code === 'ENOENT') return
    if (err && err.code === 'ENOTDIR') throw error('invalid-path', 'Parent is not a directory', err)
    throw pathFailure(err, 'Could not check whether the path is free')
  }
  throw error('already-exists', 'A file already exists at that path; open it instead of creating it')
}

/**
 * Commit a brand-new file without ever replacing existing bytes.
 * `link()` is the atomic no-overwrite commit (it fails with EEXIST instead of
 * replacing a target, unlike rename()). Filesystems without hard links fall
 * back to an exclusive (`wx`) create, which is also no-overwrite.
 */
async function commitCreated(io, temp, target, bytes) {
  try {
    await io.link(temp, target)
    return 'link'
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      throw error('already-exists', 'A file already exists at that path; open it instead of creating it', err)
    }
    if (!CREATE_LINK_UNSUPPORTED.has(err?.code ?? '')) {
      throw error('commit-failed', 'Could not create the new file; nothing was replaced', err)
    }
  }
  try {
    const handle = await io.open(target, 'wx', CREATE_MODE)
    try {
      await handle.writeFile(bytes)
      await handle.chmod(CREATE_MODE)
      await handle.sync()
    } finally { await handle.close() }
    return 'exclusive-open'
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      throw error('already-exists', 'A file already exists at that path; open it instead of creating it', err)
    }
    throw error('commit-failed', 'Could not create the new file; nothing was replaced', err)
  }
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

async function readChecked(absolute, io) {
  let handle
  try {
    handle = await io.open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch (err) {
    throw pathFailure(err, 'File disappeared while being opened; reload before saving')
  }
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

/** Windows only: bounded retry for a replacement rename refused by a transient lock. */
const WINDOWS_TRANSIENT_RENAME = new Set(['EACCES', 'EBUSY', 'EPERM'])
async function renameWithTransientRetry(io, from, to) {
  if (process.platform !== 'win32') return io.rename(from, to)
  let delay = 20
  for (let attempt = 0; ; attempt += 1) {
    try { return await io.rename(from, to) }
    catch (error) {
      if (!WINDOWS_TRANSIENT_RENAME.has(error?.code) || attempt >= 7) throw error
      await new Promise(resolve => setTimeout(resolve, delay))
      delay = Math.min(200, delay * 2)
    }
  }
}

async function fsyncDirectory(dir, io) {
  // Directory fsync is supported on POSIX, but not uniformly on Windows.
  if (process.platform === 'win32') return
  let handle
  try {
    handle = await io.open(dir, 'r')
  } catch (err) {
    throw error('commit-failed', 'Content committed but the directory could not be synced; reload before continuing', err)
  }
  try {
    await handle.sync()
  } catch (err) {
    throw error('commit-failed', 'Content committed but the directory could not be synced; reload before continuing', err)
  } finally { await handle.close() }
}

export function createNativeFileStore(workspace, options = {}) {
  if (typeof workspace !== 'string' || !workspace) throw error('invalid-path', 'Workspace root required')
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw error('invalid-option', 'Store options must be an object')
  }
  const io = resolveIo(options.io)
  const lockOptions = options.lock
  if (lockOptions !== undefined &&
      (lockOptions === null || typeof lockOptions !== 'object' || Array.isArray(lockOptions))) {
    throw error('invalid-option', 'lock options must be an object')
  }
  function requireRevision(baseHash, baseIdentity) {
    if (typeof baseIdentity !== 'string' || !/^[a-f0-9]{64}$/.test(baseIdentity) ||
        typeof baseHash !== 'string' || !/^[a-f0-9]{64}$/.test(baseHash)) {
      throw error('missing-revision', 'Open the document in this editor before renaming or deleting it')
    }
  }
  return {
    /**
     * Create a brand-new native document inside the workspace.
     *
     * No-overwrite protocol: the path tree is validated (no symlink, no
     * escape), the target must be absent, the advisory lock is taken, absence
     * is re-checked inside the critical section, bytes are written to a
     * same-directory temporary file, fsynced, then committed with link() (or an
     * exclusive wx create on filesystems without hard links) — never with a
     * replacing rename — and the committed file is read back and hashed.
     */
    async create(file, { source } = {}) {
      if (typeof source !== 'string') throw error('invalid-source', 'New file content must be a string')
      const bytes = Buffer.from(source, 'utf8')
      if (bytes.length > MAX_BYTES) throw error('too-large', 'New file exceeds 8 MiB')
      const target = await ensureSafeTarget(workspace, file, io)
      return lock(target.absolute, () => withNativeWriteLock(target.absolute, async () => {
        const checked = await ensureSafeTarget(workspace, file, io)
        assertSameTree(target, checked)
        await assertAbsent(target.absolute, io)
        const temp = path.join(checked.directory, '.' + path.basename(target.absolute) + '.' + randomUUID() + '.tmp')
        let tempExists = false
        try {
          let handle
          try {
            handle = await io.open(temp, 'wx', CREATE_MODE)
          } catch (err) { throw tempCreateFailure(err) }
          tempExists = true
          try {
            try {
              await handle.writeFile(bytes)
              await handle.chmod(CREATE_MODE)
              await handle.sync()
            } catch (err) {
              throw error('temp-write-failed', 'Could not write the new file; nothing was created', err)
            }
          } finally { await handle.close() }
          await commitCreated(io, temp, target.absolute, bytes)
          await io.unlink(temp).catch(() => {})
          tempExists = false
          await fsyncDirectory(checked.directory, io)
          const expected = createHash('sha256').update(bytes).digest('hex')
          let written
          try {
            written = await readChecked(target.absolute, io)
          } catch (err) {
            throw error('stale-revision', 'New file could not be verified after creation; reload before editing', err)
          }
          if (written.rawHash !== expected) {
            throw error('stale-revision', 'New file changed immediately after creation; reload before editing')
          }
          return { file, format: target.format, source: written.source,
            hash: written.rawHash, identity: written.identity, changed: true }
        } finally {
          if (tempExists) await io.unlink(temp).catch(() => {})
        }
      }, lockOptions))
    },
    async read(file) {
      const target = await ensureSafeFile(workspace, file, io)
      const current = await readChecked(target.absolute, io)
      const verified = await ensureSafeFile(workspace,file,io)
      assertSameTree(target,verified)
      if (current.key !== verified.entries.at(-1).key) {
        throw error('stale-revision','Workspace file changed during read')
      }
      return { file, format: target.format, source: current.source, hash: current.rawHash,
        identity: current.identity }
    },
    async apply(file, { baseHash, baseIdentity, patches }) {
      if (typeof baseIdentity !== 'string' || !/^[a-f0-9]{64}$/.test(baseIdentity)) {
        throw error('missing-revision','Open document in the current editor before saving')
      }
      const target = await ensureSafeFile(workspace, file, io)
      return lock(target.absolute, () => withNativeWriteLock(target.absolute, async () => {
        const checked = await ensureSafeFile(workspace, file, io)
        assertSameTree(target,checked)
        const current = await readChecked(target.absolute, io)
        if (current.key !== checked.entries.at(-1).key ||
            current.rawHash !== baseHash ||
            current.identity !== baseIdentity) {
          throw error('stale-revision','On-disk file identity or revision changed; reload before saving')
        }
        const result = applyNativePatches({source: current.source, format: target.format, baseHash: sourceHash(current.source), patches})
        if (!result.ok) throw error(result.code, result.message)
        if (!result.changed) return { file, hash: current.rawHash, identity:current.identity,
          changed: false, inverse: result.inverse }
        const output = Buffer.from(result.source, 'utf8')
        if (output.length > MAX_BYTES) throw error('too-large', 'Edited file exceeds 8 MiB')
        const outputHash = createHash('sha256').update(output).digest('hex')
        const directory = path.dirname(target.absolute)
        const temp = path.join(directory, '.' + path.basename(target.absolute) + '.' + randomUUID() + '.tmp')
        let created = false
        let tempKey
        try {
          let handle
          try {
            handle = await io.open(temp, 'wx', current.mode)
          } catch (err) { throw tempCreateFailure(err) }
          created = true
          try {
            try {
              await handle.writeFile(output)
              await handle.chmod(current.mode)
              await handle.sync()
            } catch (err) {
              throw error('temp-write-failed', 'Could not write temporary output file; original file preserved', err)
            }
            tempKey=nodeKey(await handle.stat({bigint:true}))
          } finally { await handle.close() }
          // Check immediately before replacing: cooperating Design Studio processes also hold the lock.
          // NOTE: external editors do not honor it; this is not a universal filesystem CAS.
          const checkedAgain = await ensureSafeFile(workspace, file, io)
          assertSameTree(checked,checkedAgain)
          const latest = await readChecked(target.absolute, io)
          if (latest.key !== current.key || latest.identity !== current.identity ||
              latest.rawHash !== baseHash) {
            throw error('stale-revision','On-disk file identity or revision changed during edit; save aborted')
          }
          let tempInfo
          try {
            tempInfo = await io.lstat(temp,{bigint:true})
          } catch (err) {
            throw error('stale-revision','Temporary output file disappeared before commit; reload before saving', err)
          }
          if (!tempInfo.isFile() || tempInfo.nlink!==1n || nodeKey(tempInfo)!==tempKey) {
            throw error('stale-revision','Temporary output file changed before commit')
          }
          try {
            await renameWithTransientRetry(io, temp, target.absolute)
          } catch (err) { throw commitFailure(err) }
          created = false
          await fsyncDirectory(directory, io)
          let written
          try {
            written = await readChecked(target.absolute, io)
          } catch (err) {
            throw error('stale-revision','Post-commit file validation failed; reload document', err)
          }
          if (written.key !== tempKey || written.rawHash !== outputHash) {
            throw error('stale-revision','Post-commit file validation failed; reload document')
          }
          return { file, hash: written.rawHash, identity:written.identity,
            changed: true, inverse: result.inverse }
        } finally {
          if (created) await io.unlink(temp).catch(() => {})
        }
      }, lockOptions))
    },
    /**
     * Give an opened document a new workspace path, preserving its bytes.
     *
     * The opened revision is required (hash + identity), the destination must be
     * free, and the commit is link()+unlink(): link() fails with EEXIST instead
     * of replacing a name, so a concurrent creator can lose the rename but can
     * never have its file destroyed. A filesystem without hard links is refused
     * (`rename-unsupported`) rather than falling back to a replacing rename().
     */
    async rename(file, { next, baseHash, baseIdentity } = {}) {
      requireRevision(baseHash, baseIdentity)
      const target = await ensureSafeFile(workspace, file, io)
      const destination = await ensureSafeTarget(workspace, next, io)
      if (destination.absolute === target.absolute) {
        throw error('invalid-target', 'The new path is the path the file already has')
      }
      return lock(target.absolute, () => withNativeWriteLock(target.absolute, async () => {
        const checked = await ensureSafeFile(workspace, file, io)
        assertSameTree(target, checked)
        const current = await readChecked(checked.absolute, io)
        if (current.key !== checked.entries.at(-1).key ||
            current.rawHash !== baseHash || current.identity !== baseIdentity) {
          throw error('stale-revision', 'On-disk file changed since it was opened; reload before renaming it')
        }
        const free = await ensureSafeTarget(workspace, next, io)
        assertSameTree(destination, free)
        await assertAbsent(free.absolute, io)
        try {
          await io.link(checked.absolute, free.absolute)
        } catch (err) {
          if (err && err.code === 'EEXIST') {
            throw error('already-exists', 'A file already exists at the new path', err)
          }
          if (CREATE_LINK_UNSUPPORTED.has(err?.code ?? '')) {
            throw error('rename-unsupported',
              'This filesystem cannot add a second name, so a rename could overwrite; nothing was changed', err)
          }
          throw error('commit-failed', 'Could not create the new name; the original file is untouched', err)
        }
        try {
          await io.unlink(checked.absolute)
        } catch (err) {
          // Node has no conditional unlink: even an identity check before a
          // compensating unlink could delete an external replacement. Preserve
          // both names instead; recovery must inspect the partial rename.
          throw error('commit-failed',
            'Partial rename: could not remove the old name; the new path may also exist. No rollback was attempted; inspect both paths before continuing', err)
        }
        await fsyncDirectory(checked.directory, io)
        if (free.directory !== checked.directory) await fsyncDirectory(free.directory, io)
        let written
        try {
          written = await readChecked(free.absolute, io)
        } catch (err) {
          throw error('stale-revision', 'The renamed file could not be verified; reload the workspace', err)
        }
        if (written.rawHash !== baseHash) {
          throw error('stale-revision', 'The renamed file does not match the opened revision; reload the workspace')
        }
        return { file: next, format: free.format, source: written.source,
          hash: written.rawHash, identity: written.identity, changed: true }
      }, lockOptions))
    },
    /**
     * Delete an opened document after re-checking its exact revision.
     *
     * Only a regular, non-hardlinked SVG/HTML/CSS file inside the workspace can
     * be deleted: directories, symlinks, hardlinks and escapes are refused. A
     * non-cooperating writer inside the final check→unlink window is the same
     * documented limit as the write path; it is not a universal CAS.
     */
    async delete(file, { baseHash, baseIdentity } = {}) {
      requireRevision(baseHash, baseIdentity)
      const target = await ensureSafeFile(workspace, file, io)
      return lock(target.absolute, () => withNativeWriteLock(target.absolute, async () => {
        const checked = await ensureSafeFile(workspace, file, io)
        assertSameTree(target, checked)
        const current = await readChecked(checked.absolute, io)
        if (current.key !== checked.entries.at(-1).key ||
            current.rawHash !== baseHash || current.identity !== baseIdentity) {
          throw error('stale-revision', 'On-disk file changed since it was opened; reload before deleting it')
        }
        try {
          await io.unlink(checked.absolute)
        } catch (err) {
          throw error('commit-failed', 'Could not delete the file; it was left untouched', err)
        }
        await fsyncDirectory(checked.directory, io)
        let occupied = false
        try {
          await io.lstat(checked.absolute)
          occupied = true
        } catch (err) {
          if (err?.code !== 'ENOENT') throw err
        }
        if (occupied) {
          throw error('stale-revision', 'The file was deleted, but another writer already recreated that path')
        }
        return { file, deleted: true, changed: true }
      }, lockOptions))
    },
  }
}

import * as nodeFs from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

const DEFAULT_IO = Object.freeze({
  mkdir: nodeFs.mkdir,
  lstat: nodeFs.lstat,
  rmdir: nodeFs.rmdir,
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

/**
 * Advisory, cross-process writer exclusion for cooperating Design Studio hosts.
 *
 * GUARANTEES (cooperating processes on one machine / one filesystem):
 *   - acquisition is an atomic `mkdir` of `.NAME.dsh-native.lock`, serialized
 *     by the filesystem;
 *   - a holder that exceeds `waitMs` gets `file-busy`; nobody evicts a lock
 *     it does not own;
 *   - release is verified against the inode acquired by this call; a replaced
 *     lock is never deleted blindly and surfaces as `lock-release-failed`
 *     with a `lock-changed` cause (the action result is then discarded);
 *   - a failure inside `action` still releases the lock; a release failure is
 *     reported as `lock-release-failed` after the action result is discarded.
 *     If both fail, the primary action error is preserved and its `releaseError`
 *     exposes the typed cleanup failure and underlying cause. Non-enrichable
 *     errors are wrapped with the primary code/message and original as `cause`;
 *     thrown primitives use `action-failed` with the thrown value as `cause`.
 *
 * NON-GUARANTEES:
 *   - external applications do NOT honor this lock. The store must still
 *     validate content hash and filesystem identity before replacing bytes;
 *   - never automatically evict a stale lock: deleting another process's lock
 *     could permit two writers at once. A SIGKILL/power loss can leave the
 *     empty directory behind; after confirming no Design Studio process
 *     writes that file, the user must remove it manually (`recovery is
 *     explicit`, not automatic). Owner PIDs are intentionally not trusted or
 *     auto-checked: PID reuse and containers make them unreliable;
 *   - `mkdir`/`rmdir` atomicity and inode stability are assumed, but not
 *     guaranteed, on NFS/SMB or across containers with different mounts;
 *   - Windows: atomic mkdir/rmdir are supported; directory modes are ignored.
 *     No Windows CI result is claimed by this module.
 *
 * `{ io }` is a narrow test seam (mkdir/lstat/rmdir, real fs by default);
 * `{ waitMs, pollMs }` keep their documented meaning.
 */
export async function withNativeWriteLock(absolute, action, { waitMs = 3500, pollMs = 30, io: ioOverrides } = {}) {
  if (typeof absolute !== 'string' || !path.isAbsolute(absolute) || typeof action !== 'function') {
    throw error('invalid-path', 'Expected absolute file path and action')
  }
  const io = resolveIo(ioOverrides)
  const lockPath = path.join(path.dirname(absolute), '.' + path.basename(absolute) + '.dsh-native.lock')
  const started = performance.now()
  let acquired = null

  while (true) {
    try {
      await io.mkdir(lockPath, { mode: 0o700 })
      acquired = await io.lstat(lockPath)
      if (!acquired.isDirectory()) {
        throw error('lock-changed', 'Native lock path is not a directory; inspect the path before retrying')
      }
      break
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
        throw error('stale-revision', 'Native file parent directory disappeared while acquiring the lock; reopen before saving', err)
      }
      if (err.code !== 'EEXIST') throw err
      if (performance.now() - started >= waitMs) {
        throw error('file-busy', 'Design file locked by another operation. Check for a running editor before manually removing a stale .dsh-native.lock directory.')
      }
      await new Promise(resolve => setTimeout(resolve, pollMs))
    }
  }

  let result, actionError, actionFailed = false
  try {
    result = await action()
  } catch (err) {
    actionFailed = true
    actionError = err
  }

  let releaseError = null
  try {
    const current = await io.lstat(lockPath)
    if (current.dev !== acquired.dev || current.ino !== acquired.ino || !current.isDirectory()) {
      throw error('lock-changed', 'Native write lock was replaced while held; refusing unsafe cleanup')
    }
    // Windows keeps a handle on a freshly used directory for a few milliseconds
    // and can refuse rmdir with EPERM/EACCES/EBUSY. Retrying the *same* rmdir is
    // safe because the inode identity was verified just above; exhausting the
    // retries still fails loudly instead of leaking the lock silently.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await io.rmdir(lockPath)
        break
      } catch (err) {
        const transient = ['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'].includes(err?.code)
        if (!transient || attempt >= 5) throw err
        await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)))
      }
    }
  } catch (err) {
    releaseError = err
  }

  if (releaseError) {
    const e = error('lock-release-failed', 'Native lock cleanup failed; reload file before continuing', releaseError)
    if (!actionFailed) throw e
    try {
      Object.defineProperty(actionError, 'releaseError', { value: e, configurable: true })
    } catch {
      const wrapped = new Error(actionError?.message ?? 'Native write action failed', { cause: actionError })
      wrapped.code = actionError?.code ?? 'action-failed'
      wrapped.releaseError = e
      throw wrapped
    }
  }
  if (actionFailed) throw actionError
  return result
}

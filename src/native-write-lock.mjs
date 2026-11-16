import { mkdir, lstat, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

/**
 * Advisory, cross-process writer exclusion for cooperating Design Studio hosts.
 *
 * The atomic mkdir is serialized by the filesystem, unlike the former
 * process-local Promise lock. External applications do NOT honor this lock:
 * the store must still check the on-disk SHA before replacing content.
 *
 * Never automatically evict a stale lock: deleting another process's lock
 * could permit two writers at once. A crash can leave the empty directory
 * behind; after confirming no Design Studio process writes that file, the
 * user can remove it manually.
 */
export async function withNativeWriteLock(absolute, action, { waitMs = 3500, pollMs = 30 } = {}) {
  if (typeof absolute !== 'string' || !path.isAbsolute(absolute) || typeof action !== 'function') {
    const e = new Error('Expected absolute file path and action')
    e.code = 'invalid-path'
    throw e
  }
  const lockPath = path.join(path.dirname(absolute), '.' + path.basename(absolute) + '.dsh-native.lock')
  const started = performance.now()
  let acquired = null

  while (true) {
    try {
      await mkdir(lockPath, { mode: 0o700 })
      acquired = await lstat(lockPath)
      if (!acquired.isDirectory()) throw new Error('Native lock is not a directory')
      break
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
      if (performance.now() - started >= waitMs) {
        const busy = new Error('Design file locked by another operation. Check for a running editor before manually removing a stale .dsh-native.lock directory.')
        busy.code = 'file-busy'
        throw busy
      }
      await new Promise(resolve => setTimeout(resolve, pollMs))
    }
  }

  let result, actionError
  try {
    result = await action()
  } catch (err) {
    actionError = err
  }

  let releaseError = null
  try {
    const current = await lstat(lockPath)
    if (current.dev !== acquired.dev || current.ino !== acquired.ino || !current.isDirectory()) {
      const e = new Error('Native write lock was replaced while held; refusing unsafe cleanup')
      e.code = 'lock-changed'
      throw e
    }
    await rmdir(lockPath)
  } catch (err) {
    releaseError = err
  }

  if (actionError) throw actionError
  if (releaseError) {
    const e = new Error('Write completed but native lock cleanup failed; reload file before continuing')
    e.code = 'lock-release-failed'
    e.cause = releaseError
    throw e
  }
  return result
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { lstat, readFile, rmdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createNativeFileStore } from '../src/native-file-store.mjs'
import { killAll, listTempFiles, spawnWorker, waitForPath, withTempRoot } from './fixtures/native-process-harness.mjs'

const LOCK = { waitMs: 15000, pollMs: 10 }
const lockDirFor = (root, name) => path.join(root, '.' + name + '.dsh-native.lock')
const patchFor = (source, before, after) => {
  const start = source.indexOf(before)
  assert.notEqual(start, -1, 'fixture precondition text must exist')
  return [{ start, end: start + before.length, before, after }]
}

test('SIGKILL while holding the lock preserves bytes and leaves a manual-only lock', { timeout: 30000 },
  () => withTempRoot(async (root) => {
    const file = path.join(root, 'crash.html')
    const original = Buffer.from('<p>original</p>\r\n', 'utf8')
    await writeFile(file, original)
    const holdMarker = path.join(root, 'holding')
    const lockDir = lockDirFor(root, 'crash.html')
    const job = spawnWorker({
      mode: 'hold-lock',
      absolute: file,
      holdMarker,
      lock: { waitMs: 5000, pollMs: 10 },
    })
    try {
      await job.ready
      await waitForPath(holdMarker)
      await waitForPath(lockDir)
      assert.equal(job.child.exitCode, null, 'holder is still alive before the crash')
      job.kill('SIGKILL')
      const info = await job.exit
      assert.ok(info.signal === 'SIGKILL' || info.code !== 0, JSON.stringify(info))

      // The original file is byte-identical: a crash before rename must never
      // leave partial or truncated content behind.
      assert.deepEqual(await readFile(file), original)
      assert.equal((await lstat(lockDir)).isDirectory(), true, 'lock left behind by the crash')

      const store = createNativeFileStore(root, { lock: { waitMs: 150, pollMs: 10 } })
      const doc = await store.read('crash.html')
      await assert.rejects(
        store.apply('crash.html', {
          baseHash: doc.hash,
          baseIdentity: doc.identity,
          patches: patchFor(doc.source, 'original', 'recovered'),
        }),
        { code: 'file-busy' },
      )
      assert.deepEqual(await readFile(file), original, 'refused write left bytes untouched')
      assert.equal((await lstat(lockDir)).isDirectory(), true, 'the lock is never auto-evicted')

      // Recovery is explicit/manual: only after removing the stale directory.
      await rmdir(lockDir)
      const saved = await store.apply('crash.html', {
        baseHash: doc.hash,
        baseIdentity: doc.identity,
        patches: patchFor(doc.source, 'original', 'recovered'),
      })
      assert.equal(saved.changed, true)
      assert.equal((await store.read('crash.html')).source, '<p>recovered</p>\r\n')
    } finally {
      killAll([job])
    }
  }))

test('SIGKILL between temp write and rename never renames or corrupts the target', { timeout: 30000 },
  () => withTempRoot(async (root) => {
    const file = path.join(root, 'crash-rename.html')
    const original = '<p>original</p>'
    await writeFile(file, original)
    const store = createNativeFileStore(root)
    const doc = await store.read('crash-rename.html')
    const pauseMarker = path.join(root, 'paused-before-rename')
    const lockDir = lockDirFor(root, 'crash-rename.html')
    const job = spawnWorker({
      mode: 'apply',
      root,
      file: 'crash-rename.html',
      baseHash: doc.hash,
      baseIdentity: doc.identity,
      patches: patchFor(original, 'original', 'edited'),
      pauseOn: 'rename',
      pauseMarker,
      lock: LOCK,
    })
    try {
      await job.ready
      await waitForPath(pauseMarker)
      // At the crash point the fully written temp file exists and the lock is held.
      assert.equal((await lstat(lockDir)).isDirectory(), true)
      const temps = await listTempFiles(root)
      assert.equal(temps.length, 1, JSON.stringify(temps))
      assert.equal(await readFile(file, 'utf8'), original)

      job.kill('SIGKILL')
      await job.exit

      assert.equal(await readFile(file, 'utf8'), original, 'pre-rename crash leaves the target intact')
      assert.deepEqual(await readFile(file), Buffer.from(original, 'utf8'))
      assert.equal((await lstat(lockDir)).isDirectory(), true)

      const storeAfter = createNativeFileStore(root, { lock: { waitMs: 150, pollMs: 10 } })
      const freshDoc = await storeAfter.read('crash-rename.html')
      await assert.rejects(
        storeAfter.apply('crash-rename.html', {
          baseHash: freshDoc.hash,
          baseIdentity: freshDoc.identity,
          patches: patchFor(freshDoc.source, 'original', 'edited'),
        }),
        { code: 'file-busy' },
      )
      assert.equal(await readFile(file, 'utf8'), original)

      // Explicit recovery: remove the orphan lock and temp file, then commit.
      await rmdir(lockDir)
      for (const temp of await listTempFiles(root)) await unlink(path.join(root, temp))
      const saved = await storeAfter.apply('crash-rename.html', {
        baseHash: freshDoc.hash,
        baseIdentity: freshDoc.identity,
        patches: patchFor(freshDoc.source, 'original', 'edited'),
      })
      assert.equal(saved.changed, true)
      assert.equal(await readFile(file, 'utf8'), '<p>edited</p>')
    } finally {
      killAll([job])
    }
  }))

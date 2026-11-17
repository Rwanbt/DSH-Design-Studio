import test from 'node:test'
import assert from 'node:assert/strict'
import { lstat, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createNativeFileStore } from '../src/native-file-store.mjs'
import { sourceHash } from '../src/native-patch.mjs'
import {
  killAll, listTempFiles, runExternalWriter, spawnWorker, waitForPath, withTempRoot,
} from './fixtures/native-process-harness.mjs'

const LOCK = { waitMs: 15000, pollMs: 10 }
const lockDirFor = (root, name) => path.join(root, '.' + name + '.dsh-native.lock')
const patchFor = (source, before, after) => {
  const start = source.indexOf(before)
  assert.notEqual(start, -1, 'fixture precondition text must exist')
  return [{ start, end: start + before.length, before, after }]
}

test('two cooperating processes commit distinct targets in overlapping critical sections', { timeout: 30000 },
  () => withTempRoot(async (root) => {
    const files = ['first.svg', 'second.svg']
    const initial = '<svg><rect fill="red"/></svg>'
    for (const file of files) await writeFile(path.join(root, file), initial)
    const store = createNativeFileStore(root)
    const docs = await Promise.all(files.map((file) => store.read(file)))
    const release = path.join(root, 'release-all')
    const jobs = files.map((file, index) => spawnWorker({
      mode: 'apply',
      root,
      file,
      baseHash: docs[index].hash,
      baseIdentity: docs[index].identity,
      patches: patchFor(docs[index].source, 'red', index === 0 ? 'blue' : 'green'),
      pauseOn: 'temp-open',
      pauseMarker: path.join(root, 'paused-' + index),
      releaseMarker: release,
      lock: LOCK,
    }))
    try {
      await Promise.all(jobs.map((job) => job.ready))
      // Both children are paused after acquiring their own lock and reading
      // their own base revision: the two critical sections truly overlap.
      await Promise.all(jobs.map((_, index) => waitForPath(path.join(root, 'paused-' + index))))
      for (const file of files) {
        assert.equal((await lstat(lockDirFor(root, file))).isDirectory(), true, 'each target own lock')
      }
      await writeFile(release, 'go\n')
      const results = await Promise.all(jobs.map((job) => job.result()))
      assert.deepEqual(results.map((result) => result.ok), [true, true], JSON.stringify(results))
      const first = await readFile(path.join(root, files[0]), 'utf8')
      const second = await readFile(path.join(root, files[1]), 'utf8')
      assert.equal(first, '<svg><rect fill="blue"/></svg>')
      assert.equal(second, '<svg><rect fill="green"/></svg>')
      assert.equal(sourceHash(first), results[0].hash)
      assert.equal(sourceHash(second), results[1].hash)
      for (const file of files) {
        await assert.rejects(lstat(lockDirFor(root, file)), { code: 'ENOENT' })
      }
      assert.deepEqual(await listTempFiles(root), [])
    } finally {
      killAll(jobs)
    }
  }))

test('repeated real-process races on one target never double-commit or corrupt', { timeout: 60000 },
  () => withTempRoot(async (root) => {
    const file = 'race.html'
    const store = createNativeFileStore(root)
    for (let round = 0; round < 3; round += 1) {
      const base = `<p>base-${round}</p>`
      await writeFile(path.join(root, file), base)
      const doc = await store.read(file)
      const gate = path.join(root, `gate-${round}`)
      const jobs = ['one', 'two'].map((word) => spawnWorker({
        mode: 'apply',
        root,
        file,
        baseHash: doc.hash,
        baseIdentity: doc.identity,
        patches: patchFor(base, `base-${round}`, word),
        gate,
        lock: LOCK,
      }))
      try {
        await Promise.all(jobs.map((job) => job.ready))
        // Release both children at once: they now race on one base revision.
        await writeFile(gate, 'go\n')
        const results = await Promise.all(jobs.map((job) => job.result()))
        const succeeded = results.filter((result) => result.ok)
        const refused = results.filter((result) => !result.ok)
        assert.equal(succeeded.length, 1, JSON.stringify(results))
        assert.equal(refused.length, 1, JSON.stringify(results))
        assert.ok(['stale-revision', 'file-busy'].includes(refused[0].code), JSON.stringify(results))
        const onDisk = await readFile(path.join(root, file), 'utf8')
        assert.ok(onDisk === '<p>one</p>' || onDisk === '<p>two</p>', onDisk)
        assert.equal(sourceHash(onDisk), succeeded[0].hash, 'reported hash is the committed content')
        await assert.rejects(lstat(lockDirFor(root, file)), { code: 'ENOENT' })
        assert.deepEqual(await listTempFiles(root), [], 'no orphan temp file after the race')
      } finally {
        killAll(jobs)
      }
    }
  }))

test('a non-cooperating external writer wins the race and the store refuses stale-revision', { timeout: 30000 },
  () => withTempRoot(async (root) => {
    const file = 'external.html'
    const base = '<p>base</p>'
    const external = '<p>written by an external editor</p>'
    await writeFile(path.join(root, file), base)
    const store = createNativeFileStore(root)
    const doc = await store.read(file)
    const pauseMarker = path.join(root, 'paused-external')
    const releaseMarker = path.join(root, 'release-external')
    const externalDone = path.join(root, 'external-done')
    const job = spawnWorker({
      mode: 'apply',
      root,
      file,
      baseHash: doc.hash,
      baseIdentity: doc.identity,
      patches: patchFor(base, 'base', 'design-studio'),
      pauseOn: 'temp-open',
      pauseMarker,
      releaseMarker,
      lock: LOCK,
    })
    try {
      await job.ready
      await waitForPath(pauseMarker)
      // The store holds the lock and has validated the base revision, but has
      // not renamed yet. The plain child ignores the lock and the revision.
      await runExternalWriter(path.join(root, file), external, externalDone)
      await writeFile(releaseMarker, 'go\n')
      const result = await job.result()
      assert.equal(result.ok, false, JSON.stringify(result))
      assert.equal(result.code, 'stale-revision', JSON.stringify(result))
      assert.equal(await readFile(path.join(root, file), 'utf8'), external, 'external bytes survive')
      await assert.rejects(lstat(lockDirFor(root, file)), { code: 'ENOENT' })
      assert.deepEqual(await listTempFiles(root), [], 'stale temp output is cleaned up')
    } finally {
      job.kill('SIGKILL')
    }
  }))

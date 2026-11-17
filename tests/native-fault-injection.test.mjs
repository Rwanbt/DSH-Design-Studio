import test from 'node:test'
import assert from 'node:assert/strict'
import {
  lstat, mkdir, open as realOpen, readFile, rename as realRename,
  rm, rmdir, writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { createNativeFileStore } from '../src/native-file-store.mjs'
import { listTempFiles, withTempRoot } from './fixtures/native-process-harness.mjs'

const LOCK = { waitMs: 2000, pollMs: 10 }
const lockDirFor = (root, name) => path.join(root, '.' + name + '.dsh-native.lock')
const patchFor = (source, before, after) => {
  const start = source.indexOf(before)
  assert.notEqual(start, -1, 'fixture precondition text must exist')
  return [{ start, end: start + before.length, before, after }]
}

test('temporary output creation failure preserves the original, cleans up and releases the lock', { timeout: 20000 },
  () => withTempRoot(async (root) => {
    const file = 'write.css'
    const original = 'body{color:red}'
    await writeFile(path.join(root, file), original)
    const store = createNativeFileStore(root, {
      io: {
        open: async (target, flags, mode) => {
          if (flags === 'wx') {
            const err = new Error('no space left on device')
            err.code = 'ENOSPC'
            throw err
          }
          return realOpen(target, flags, mode)
        },
      },
      lock: LOCK,
    })
    const doc = await store.read(file)
    await assert.rejects(
      store.apply(file, {
        baseHash: doc.hash,
        baseIdentity: doc.identity,
        patches: patchFor(doc.source, 'red', 'blue'),
      }),
      (err) => {
        assert.equal(err.code, 'temp-write-failed')
        assert.equal(err.cause?.code, 'ENOSPC')
        return true
      },
    )
    assert.equal(await readFile(path.join(root, file), 'utf8'), original)
    assert.deepEqual(await listTempFiles(root), [], 'failed temp creation leaves no partial file')
    await assert.rejects(lstat(lockDirFor(root, file)), { code: 'ENOENT' }, 'lock released on failure')

    const saved = await createNativeFileStore(root).apply(file, {
      baseHash: doc.hash,
      baseIdentity: doc.identity,
      patches: patchFor(doc.source, 'red', 'blue'),
    })
    assert.equal(saved.changed, true)
    assert.equal(await readFile(path.join(root, file), 'utf8'), 'body{color:blue}')
  }))

test('atomic rename failure preserves the original, removes the temp file and releases the lock', { timeout: 20000 },
  () => withTempRoot(async (root) => {
    const file = 'commit.svg'
    const original = '<svg><rect id="one"/></svg>'
    await writeFile(path.join(root, file), original)
    const store = createNativeFileStore(root, {
      io: {
        rename: async () => {
          const err = new Error('operation not permitted')
          err.code = 'EACCES'
          throw err
        },
      },
      lock: LOCK,
    })
    const doc = await store.read(file)
    await assert.rejects(
      store.apply(file, {
        baseHash: doc.hash,
        baseIdentity: doc.identity,
        patches: patchFor(doc.source, 'one', 'two'),
      }),
      (err) => {
        assert.equal(err.code, 'commit-failed')
        assert.equal(err.cause?.code, 'EACCES')
        return true
      },
    )
    assert.equal(await readFile(path.join(root, file), 'utf8'), original, 'original untouched')
    assert.deepEqual(await listTempFiles(root), [], 'temp output unlinked after failed rename')
    await assert.rejects(lstat(lockDirFor(root, file)), { code: 'ENOENT' }, 'lock released on failure')

    const saved = await createNativeFileStore(root).apply(file, {
      baseHash: doc.hash,
      baseIdentity: doc.identity,
      patches: patchFor(doc.source, 'one', 'two'),
    })
    assert.equal(saved.changed, true)
    assert.equal(await readFile(path.join(root, file), 'utf8'), '<svg><rect id="two"/></svg>')
  }))

test('a parent directory replaced mid-transaction is refused and never written into', { timeout: 20000 },
  () => withTempRoot(async (root) => {
    const sub = path.join(root, 'pages')
    await mkdir(sub)
    const file = path.join(sub, 'page.html')
    const original = '<p>original</p>'
    const replacement = '<p>replacement directory</p>'
    await writeFile(file, original)
    const moved = path.join(root, 'pages-moved')
    let replaced = false
    const store = createNativeFileStore(root, {
      io: {
        open: async (target, flags, mode) => {
          if (flags === 'wx' && !replaced) {
            replaced = true
            // External actor moves the whole parent away and installs a new
            // directory that happens to contain a same-named file.
            await realRename(sub, moved)
            await mkdir(sub)
            await writeFile(path.join(sub, 'page.html'), replacement)
          }
          return realOpen(target, flags, mode)
        },
      },
      lock: LOCK,
    })
    const doc = await store.read('pages/page.html')
    await assert.rejects(
      store.apply('pages/page.html', {
        baseHash: doc.hash,
        baseIdentity: doc.identity,
        patches: patchFor(doc.source, 'original', 'recovered'),
      }),
      (err) => {
        assert.equal(err.code, 'stale-revision')
        // The replacement re-uses the same relative path, so the refusal can
        // come either from the path-tree identity check (no cause) or from a
        // vanished temp directory (ENOENT cause). Either way the original and
        // the replacement bytes must survive below.
        assert.ok(err.cause === undefined || err.cause?.code === 'ENOENT', String(err.cause?.code))
        return true
      },
    )
    assert.equal(await readFile(path.join(moved, 'page.html'), 'utf8'), original, 'original bytes survive')
    assert.equal(await readFile(path.join(sub, 'page.html'), 'utf8'), replacement, 'replacement never written')
    assert.deepEqual(await listTempFiles(root), [], 'no temp output left anywhere')
    // The lock travelled with the moved original directory; it is not at the
    // replacement path, and it is not auto-evicted.
    assert.equal((await lstat(path.join(moved, '.page.html.dsh-native.lock'))).isDirectory(), true)
    await assert.rejects(lstat(path.join(sub, '.page.html.dsh-native.lock')), { code: 'ENOENT' })

    // Explicit recovery restores the original directory and clears the lock.
    await rm(sub, { recursive: true, force: true })
    await realRename(moved, sub)
    await rmdir(path.join(sub, '.page.html.dsh-native.lock'))
    const saved = await createNativeFileStore(root).apply('pages/page.html', {
      baseHash: doc.hash,
      baseIdentity: doc.identity,
      patches: patchFor(doc.source, 'original', 'recovered'),
    })
    assert.equal(saved.changed, true)
    assert.equal(await readFile(file, 'utf8'), '<p>recovered</p>')
  }))

test('a parent directory that vanishes mid-transaction is refused with stale-revision', { timeout: 20000 },
  () => withTempRoot(async (root) => {
    const sub = path.join(root, 'pages')
    await mkdir(sub)
    const file = path.join(sub, 'page.html')
    const original = '<p>original</p>'
    await writeFile(file, original)
    const moved = path.join(root, 'pages-moved')
    let vanished = false
    const store = createNativeFileStore(root, {
      io: {
        open: async (target, flags, mode) => {
          if (flags === 'wx' && !vanished) {
            vanished = true
            // The whole parent disappears: the temp path can no longer resolve.
            await realRename(sub, moved)
          }
          return realOpen(target, flags, mode)
        },
      },
      lock: LOCK,
    })
    const doc = await store.read('pages/page.html')
    await assert.rejects(
      store.apply('pages/page.html', {
        baseHash: doc.hash,
        baseIdentity: doc.identity,
        patches: patchFor(doc.source, 'original', 'recovered'),
      }),
      (err) => {
        assert.equal(err.code, 'stale-revision')
        assert.equal(err.cause?.code, 'ENOENT', 'temporary output path vanished with its parent')
        return true
      },
    )
    assert.equal(await readFile(path.join(moved, 'page.html'), 'utf8'), original, 'original bytes survive')
    assert.deepEqual(await listTempFiles(root), [], 'no temp output left')
    await assert.rejects(lstat(sub), { code: 'ENOENT' }, 'nothing was created at the vanished path')
    // The lock moved with the directory and is not auto-evicted.
    assert.equal((await lstat(path.join(moved, '.page.html.dsh-native.lock'))).isDirectory(), true)

    // Explicit recovery: move the original directory back and clear the lock.
    await realRename(moved, sub)
    await rmdir(path.join(sub, '.page.html.dsh-native.lock'))
    const saved = await createNativeFileStore(root).apply('pages/page.html', {
      baseHash: doc.hash,
      baseIdentity: doc.identity,
      patches: patchFor(doc.source, 'original', 'recovered'),
    })
    assert.equal(saved.changed, true)
    assert.equal(await readFile(file, 'utf8'), '<p>recovered</p>')
  }))

test('post-commit verification detects an external overwrite and keeps the external bytes', { timeout: 20000 },
  () => withTempRoot(async (root) => {
    const file = 'verify.html'
    const original = '<p>original</p>'
    const external = '<p>external after commit</p>'
    await writeFile(path.join(root, file), original)
    let externalOnce = true
    const store = createNativeFileStore(root, {
      io: {
        rename: async (from, to) => {
          await realRename(from, to)
          if (!externalOnce) return
          externalOnce = false
          // A non-cooperating editor writes immediately after our rename.
          await writeFile(to, external, 'utf8')
        },
      },
      lock: LOCK,
    })
    const doc = await store.read(file)
    await assert.rejects(
      store.apply(file, {
        baseHash: doc.hash,
        baseIdentity: doc.identity,
        patches: patchFor(doc.source, 'original', 'ours'),
      }),
      { code: 'stale-revision' },
    )
    assert.equal(await readFile(path.join(root, file), 'utf8'), external, 'external bytes are not clobbered')
    assert.deepEqual(await listTempFiles(root), [])
    await assert.rejects(lstat(lockDirFor(root, file)), { code: 'ENOENT' })

    // The reported revision is genuinely stale: reload then retry.
    await assert.rejects(
      store.apply(file, {
        baseHash: doc.hash,
        baseIdentity: doc.identity,
        patches: patchFor(doc.source, 'original', 'ours'),
      }),
      { code: 'stale-revision' },
    )
    const fresh = await store.read(file)
    const saved = await store.apply(file, {
      baseHash: fresh.hash,
      baseIdentity: fresh.identity,
      patches: patchFor(fresh.source, 'external after commit', 'recovered'),
    })
    assert.equal(saved.changed, true)
    assert.equal(await readFile(path.join(root, file), 'utf8'), '<p>recovered</p>')
  }))

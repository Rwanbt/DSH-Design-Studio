/**
 * Rename and delete: the two operations that can lose a user's file.
 *
 * The store is the only component allowed to touch the disk, so these tests
 * check the properties that must hold before any UI is wired to them: the
 * opened revision is required, an occupied destination is never replaced, the
 * bytes survive a rename exactly, and nothing outside a regular, non-hardlinked
 * SVG/HTML/CSS file inside the workspace can be removed.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, symlink, readdir, rm, link } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createNativeFileStore } from '../src/native-file-store.mjs'

async function workspace(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-native-admin-'))
  try { return await run(root, createNativeFileStore(root)) }
  finally { await rm(root, { recursive: true, force: true }) }
}

const SVG = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><rect id="a" width="4"/></svg>\n'

test('rename keeps the exact bytes under the new name and leaves no trace of the old one', () => workspace(async (root, store) => {
  await store.create('avant.svg', { source: SVG })
  const opened = await store.read('avant.svg')
  const renamed = await store.rename('avant.svg', {
    next: 'apres.svg', baseHash: opened.hash, baseIdentity: opened.identity,
  })
  assert.equal(renamed.file, 'apres.svg')
  assert.equal(renamed.source, SVG, 'the content must be byte-identical')
  assert.equal(renamed.hash, opened.hash, 'a rename does not change the content hash')
  assert.notEqual(renamed.identity, opened.identity, 'a rename changes the on-disk identity')
  assert.equal(await readFile(path.join(root, 'apres.svg'), 'utf8'), SVG)
  await assert.rejects(readFile(path.join(root, 'avant.svg'), 'utf8'), /ENOENT/,
    'the old path must be gone')
  assert.deepEqual((await readdir(root)).sort(), ['apres.svg'],
    'no temporary file and no lock directory may be left behind')
  assert.equal((await store.read('apres.svg')).identity, renamed.identity,
    'the returned identity is the one the client must use next')
}))

test('rename refuses a destination that already exists and never replaces it', () => workspace(async (root, store) => {
  await store.create('a.svg', { source: SVG })
  await store.create('b.svg', { source: '<svg><!-- keep --></svg>' })
  const opened = await store.read('a.svg')
  await assert.rejects(
    store.rename('a.svg', { next: 'b.svg', baseHash: opened.hash, baseIdentity: opened.identity }),
    (error) => error.code === 'already-exists')
  assert.equal(await readFile(path.join(root, 'b.svg'), 'utf8'), '<svg><!-- keep --></svg>',
    'the occupied destination must be untouched')
  assert.equal(await readFile(path.join(root, 'a.svg'), 'utf8'), SVG,
    'the source must still exist after a refused rename')
}))

test('rename requires the opened revision and refuses a stale one', () => workspace(async (root, store) => {
  await store.create('doc.svg', { source: SVG })
  const opened = await store.read('doc.svg')
  await assert.rejects(store.rename('doc.svg', { next: 'neuf.svg' }),
    (error) => error.code === 'missing-revision')
  // An external writer changes the file between open and rename.
  await writeFile(path.join(root, 'doc.svg'), '<svg><!-- other writer --></svg>')
  await assert.rejects(
    store.rename('doc.svg', { next: 'neuf.svg', baseHash: opened.hash, baseIdentity: opened.identity }),
    (error) => error.code === 'stale-revision')
  assert.equal(await readFile(path.join(root, 'neuf.svg'), 'utf8').catch(() => null), null,
    'a refused rename must not create the destination')
  assert.equal(await readFile(path.join(root, 'doc.svg'), 'utf8'), '<svg><!-- other writer --></svg>',
    'the externally written bytes must survive')
}))

test('rename stays inside the workspace and refuses symlinked parents', () => workspace(async (root, store) => {
  await store.create('ok.svg', { source: SVG })
  const opened = await store.read('ok.svg')
  await assert.rejects(
    store.rename('ok.svg', { next: '../escape.svg', baseHash: opened.hash, baseIdentity: opened.identity }),
    (error) => error.code === 'invalid-path')
  await mkdir(path.join(root, 'real'))
  await symlink(path.join(root, 'real'), path.join(root, 'lien'))
  await assert.rejects(
    store.rename('ok.svg', { next: 'lien/dedans.svg', baseHash: opened.hash, baseIdentity: opened.identity }),
    (error) => error.code === 'symlink-forbidden')
  assert.equal(await readFile(path.join(root, 'ok.svg'), 'utf8'), SVG)
}))

test('rename to the same path is refused instead of silently succeeding', () => workspace(async (root, store) => {
  const created = await store.create('meme.svg', { source: SVG })
  await assert.rejects(
    store.rename('meme.svg', { next: 'meme.svg', baseHash: created.hash, baseIdentity: created.identity }),
    (error) => error.code === 'invalid-target')
}))

test('delete removes exactly one file and confirms the path is empty', () => workspace(async (root, store) => {
  await store.create('jeter.svg', { source: SVG })
  await store.create('garder.svg', { source: SVG })
  const opened = await store.read('jeter.svg')
  const result = await store.delete('jeter.svg', { baseHash: opened.hash, baseIdentity: opened.identity })
  assert.equal(result.deleted, true)
  await assert.rejects(readFile(path.join(root, 'jeter.svg'), 'utf8'), /ENOENT/)
  assert.equal(await readFile(path.join(root, 'garder.svg'), 'utf8'), SVG,
    'deleting one file must not touch its neighbours')
  assert.deepEqual((await readdir(root)).sort(), ['garder.svg'])
  await assert.rejects(store.read('jeter.svg'), (error) => error.code === 'stale-revision',
    'reading a deleted file reports a stale revision, never an empty document')
}))

test('delete refuses a stale revision and keeps the file', () => workspace(async (root, store) => {
  await store.create('protege.svg', { source: SVG })
  const opened = await store.read('protege.svg')
  await writeFile(path.join(root, 'protege.svg'), '<svg><!-- edited elsewhere --></svg>')
  await assert.rejects(
    store.delete('protege.svg', { baseHash: opened.hash, baseIdentity: opened.identity }),
    (error) => error.code === 'stale-revision')
  assert.equal(await readFile(path.join(root, 'protege.svg'), 'utf8'), '<svg><!-- edited elsewhere --></svg>')
}))

test('delete requires a revision and refuses directories, escapes and symlinks', () => workspace(async (root, store) => {
  await store.create('cible.svg', { source: SVG })
  const opened = await store.read('cible.svg')
  await assert.rejects(store.delete('cible.svg', {}), (error) => error.code === 'missing-revision')
  await mkdir(path.join(root, 'dossier'))
  await assert.rejects(
    store.delete('dossier', { baseHash: opened.hash, baseIdentity: opened.identity }),
    (error) => error.code === 'unsupported-format',
    'a directory has no supported extension and is never a deletion target')
  await assert.rejects(
    store.delete('../cible.svg', { baseHash: opened.hash, baseIdentity: opened.identity }),
    (error) => error.code === 'invalid-path')
  // A symlink is refused by the path walk, so deleting a link never reaches the
  // file it points to.
  await writeFile(path.join(root, 'reel.svg'), SVG)
  await symlink(path.join(root, 'reel.svg'), path.join(root, 'lien.svg'))
  await assert.rejects(
    store.delete('lien.svg', { baseHash: opened.hash, baseIdentity: opened.identity }),
    (error) => error.code === 'symlink-forbidden')
  assert.equal(await readFile(path.join(root, 'reel.svg'), 'utf8'), SVG,
    'the symlink target must still exist')
}))

test('delete refuses a hardlinked file so a second name never loses its bytes', () => workspace(async (root, store) => {
  await store.create('dur.svg', { source: SVG })
  await link(path.join(root, 'dur.svg'), path.join(root, 'dur-lien.svg'))
  const opened = await store.read('dur.svg').catch((error) => error)
  assert.equal(opened.code, 'invalid-file', 'a hardlinked file is not editable or deletable')
  await assert.rejects(
    store.delete('dur.svg', { baseHash: 'a'.repeat(64), baseIdentity: 'b'.repeat(64) }),
    (error) => error.code === 'invalid-file')
  assert.equal(await readFile(path.join(root, 'dur.svg'), 'utf8'), SVG)
}))

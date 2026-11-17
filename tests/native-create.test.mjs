import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, symlink, stat, readdir, rm, utimes } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createNativeFileStore } from '../src/native-file-store.mjs'

async function workspace(run, options) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-native-create-'))
  try { return await run(root, createNativeFileStore(root, options)) }
  finally { await rm(root, { recursive: true, force: true }) }
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>\n'

test('creates exact native bytes and the result is immediately readable', () => workspace(async (root, store) => {
  const created = await store.create('nouveau.svg', { source: SVG })
  assert.equal(created.format, 'svg')
  assert.match(created.hash, /^[a-f0-9]{64}$/)
  assert.match(created.identity, /^[a-f0-9]{64}$/)
  assert.equal(created.changed, true)
  assert.equal(await readFile(path.join(root, 'nouveau.svg'), 'utf8'), SVG)
  const reopened = await store.read('nouveau.svg')
  assert.equal(reopened.source, SVG)
  assert.equal(reopened.hash, created.hash)
  assert.equal(reopened.identity, created.identity)
}))

test('an empty CSS document is legitimate and stays empty', () => workspace(async (root, store) => {
  await store.create('vide.css', { source: '' })
  assert.equal(await readFile(path.join(root, 'vide.css'), 'utf8'), '')
}))

test('creates in an existing subdirectory and keeps ordinary file permissions', () => workspace(async (root, store) => {
  await mkdir(path.join(root, 'pages'))
  await store.create('pages/accueil.html', { source: '<p>ok</p>' })
  assert.equal(await readFile(path.join(root, 'pages/accueil.html'), 'utf8'), '<p>ok</p>')
  const mode = (await stat(path.join(root, 'pages/accueil.html'))).mode & 0o777
  assert.equal(mode & 0o600, 0o600, 'owner must be able to read and write the new file: ' + mode.toString(8))
}))

test('refuses to replace an existing file and leaves every byte untouched', () => workspace(async (root, store) => {
  const original = '<svg><rect id="keep" fill="red"/></svg>'
  await writeFile(path.join(root, 'garde.svg'), original)
  const before = await stat(path.join(root, 'garde.svg'))
  await assert.rejects(store.create('garde.svg', { source: '<svg>another</svg>' }), { code: 'already-exists' })
  assert.equal(await readFile(path.join(root, 'garde.svg'), 'utf8'), original)
  const after = await stat(path.join(root, 'garde.svg'))
  assert.equal(after.ino, before.ino, 'the refused create must not swap the inode')
  assert.equal(after.mtimeMs, before.mtimeMs, 'the refused create must not rewrite the file')
}))

test('an existing directory is not a legal target either', () => workspace(async (root, store) => {
  await mkdir(path.join(root, 'dossier.svg'))
  await assert.rejects(store.create('dossier.svg', { source: SVG }), { code: 'already-exists' })
}))

test('a missing parent directory is refused explicitly instead of creating directories', () => workspace(async (root, store) => {
  await assert.rejects(store.create('absent/page.svg', { source: SVG }), { code: 'missing-directory' })
  await assert.rejects(stat(path.join(root, 'absent')), { code: 'ENOENT' })
}))

test('paths that escape the workspace or name unsupported formats are refused', () => workspace(async (root, store) => {
  for (const file of ['../escape.svg', '/etc/escape.svg', 'a/../../escape.svg', 'C:\\escape.svg',
    'back\\slash.svg', 'nul\0byte.svg', './dot.svg', 'double//slash.svg', '']) {
    await assert.rejects(store.create(file, { source: SVG }), { code: 'invalid-path' }, 'expected refusal for ' + JSON.stringify(file))
  }
  await assert.rejects(store.create('note.txt', { source: 'x' }), { code: 'unsupported-format' })
  assert.deepEqual((await readdir(root)).filter((name) => name.includes('escape')), [])
}))

test('a symlinked parent directory is refused (no write outside the workspace)', () => workspace(async (root, store) => {
  const outside = await mkdtemp(path.join(os.tmpdir(), 'dsh-native-create-outside-'))
  try {
    await symlink(outside, path.join(root, 'lien'))
    await assert.rejects(store.create('lien/fuite.svg', { source: SVG }), { code: 'symlink-forbidden' })
    assert.deepEqual(await readdir(outside), [], 'nothing may be written through the symlink')
  } finally { await rm(outside, { recursive: true, force: true }) }
}))

test('content longer than 8 MiB and non-string content are refused before touching the disk', () => workspace(async (root, store) => {
  await assert.rejects(store.create('gros.svg', { source: 'x'.repeat(8 * 1024 * 1024 + 1) }), { code: 'too-large' })
  await assert.rejects(store.create('mine.svg', { source: 42 }), { code: 'invalid-source' })
  await assert.rejects(store.create('mine.svg'), { code: 'invalid-source' })
  assert.deepEqual((await readdir(root)), [])
}))

test('a failed temporary write creates nothing and leaves no temporary file behind', () => workspace(async (root, store) => {
  await assert.rejects(store.create('tentative.svg', { source: SVG }), { code: 'temp-write-failed' })
  assert.deepEqual(await readdir(root), [])
}, { io: { open: async () => { const error = new Error('disk full'); error.code = 'ENOSPC'; throw error } } }))

test('filesystems without hard links fall back to an exclusive create', () => workspace(async (root, store) => {
  const created = await store.create('sans-lien.svg', { source: SVG })
  assert.equal(created.format, 'svg')
  assert.equal(await readFile(path.join(root, 'sans-lien.svg'), 'utf8'), SVG)
  await assert.rejects(store.create('sans-lien.svg', { source: 'other' }), { code: 'already-exists' })
}, { io: { link: async () => { const error = new Error('links unsupported'); error.code = 'EPERM'; throw error } } }))

test('two concurrent creates of the same path produce one file and one refusal', () => workspace(async (root, store) => {
  const first = SVG.replace('10', '111')
  const second = SVG.replace('10', '222')
  const settled = await Promise.allSettled([
    store.create('course.svg', { source: first }),
    store.create('course.svg', { source: second }),
  ])
  const fulfilled = settled.filter((item) => item.status === 'fulfilled')
  const rejected = settled.filter((item) => item.status === 'rejected')
  assert.equal(fulfilled.length, 1, 'exactly one create may win: ' + JSON.stringify(settled.map((s) => s.status)))
  assert.equal(rejected.length, 1)
  assert.equal(rejected[0].reason.code, 'already-exists')
  const onDisk = await readFile(path.join(root, 'course.svg'), 'utf8')
  assert.equal(onDisk, fulfilled[0].value.source, 'the file must contain the winner bytes')
  assert.deepEqual((await readdir(root)).sort(), ['course.svg'], 'no lock or temporary file may survive')
}))

test('the fresh identity is usable: a created document can be edited and undone', () => workspace(async (root, store) => {
  const created = await store.create('editable.svg', { source: SVG })
  const added = await store.apply('editable.svg', {
    baseHash: created.hash, baseIdentity: created.identity,
    patches: [{ start: SVG.indexOf('</svg>'), end: SVG.indexOf('</svg>'), before: '', after: '<rect fill="red"/>' }],
  })
  assert.equal(added.changed, true)
  assert.equal((await store.read('editable.svg')).source, SVG.replace('</svg>', '<rect fill="red"/></svg>'))
  await store.apply('editable.svg', { baseHash: added.hash, baseIdentity: added.identity, patches: added.inverse })
  assert.equal((await store.read('editable.svg')).source, SVG)
}))

test('a concurrent edit that lands between create and apply is still detected', () => workspace(async (root, store) => {
  const created = await store.create('course-edit.svg', { source: SVG })
  const target = path.join(root, 'course-edit.svg')
  await writeFile(target, SVG.replace('10', '99'))
  const later = new Date(Date.now() + 5000)
  await utimes(target, later, later)
  await assert.rejects(store.apply('course-edit.svg', {
    baseHash: created.hash, baseIdentity: created.identity,
    patches: [{ start: 0, end: 0, before: '', after: ' ' }],
  }), { code: 'stale-revision' })
  assert.equal(await readFile(target, 'utf8'), SVG.replace('10', '99'))
}))

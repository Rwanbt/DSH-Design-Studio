import { createHash } from 'node:crypto'

/** Pure source patch core. No disk access, DOM, network, or AI calls. */
export const sourceHash = (text) => {
  if (typeof text !== 'string') throw new TypeError('source must be a string')
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

const SUPPORTED = new Set(['svg', 'html', 'htm', 'css'])
const MAX_OPS = 200

function fail(code, message) {
  return { ok: false, code, message }
}

/**
 * A patch uses UTF-16 offsets (JavaScript String offsets), and an exact
 * `before` precondition, so identical text elsewhere is never guessed.
 * Caller must provide the on-disk SHA-256 as `baseHash` after opening.
 * No parsing or source reconstruction is performed.
 */
export function applyNativePatches({ source, format, baseHash, patches }) {
  if (typeof source !== 'string') return fail('invalid-source', 'source must be a string')
  if (!SUPPORTED.has(format)) return fail('unsupported-format', 'Only svg/html/htm/css are supported')
  if (typeof baseHash !== 'string' || !/^[a-f0-9]{64}$/.test(baseHash)) {
    return fail('invalid-revision', 'baseHash must be a SHA-256 hex digest')
  }
  if (sourceHash(source) !== baseHash) return fail('stale-revision', 'Document changed since opening; reload or resolve conflict')
  if (!Array.isArray(patches) || patches.length > MAX_OPS) return fail('invalid-batch', 'Expected at most 200 patches')
  if (patches.length === 0) return { ok: true, source, hash: baseHash, changed: false, inverse: [] }

  const ordered = []
  for (const [i, patch] of patches.entries()) {
    if (!patch || !Number.isSafeInteger(patch.start) || !Number.isSafeInteger(patch.end) ||
        patch.start < 0 || patch.end < patch.start || patch.end > source.length ||
        typeof patch.before !== 'string' || typeof patch.after !== 'string') {
      return fail('invalid-patch', `Invalid patch at index ${i}`)
    }
    if (source.slice(patch.start, patch.end) !== patch.before) {
      return fail('precondition-failed', `Source range mismatch at index ${i}`)
    }
    ordered.push({ ...patch, index: i })
  }
  ordered.sort((a, b) => a.start - b.start || a.end - b.end)
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i].start < ordered[i - 1].end || ordered[i].start === ordered[i - 1].start) {
      return fail('overlap', 'Patches overlap or share an insertion position')
    }
  }
  let result = ''
  let position = 0
  let outputPosition = 0
  const inverse = []
  for (const patch of ordered) {
    const prefix = source.slice(position, patch.start)
    result += prefix + patch.after
    outputPosition += prefix.length
    inverse.push({ start: outputPosition, end: outputPosition + patch.after.length, before: patch.after, after: patch.before })
    outputPosition += patch.after.length
    position = patch.end
  }
  result += source.slice(position)
  return { ok: true, source: result, hash: sourceHash(result), changed: result !== source, inverse }
}

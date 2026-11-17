import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applySvgMatrix,
  composeSvgTransform,
  formatSvgMatrix,
  invertSvgMatrixLinear,
  multiplySvgMatrices,
  parseSvgTransform,
  svgTransformPatch,
  svgTransformValue,
  transformOperationMatrix,
} from '../src/svg-transform.mjs'
import { applyNativePatches, sourceHash } from '../src/native-patch.mjs'

const apply = (source, patches) => applyNativePatches({ source, format: 'svg', baseHash: sourceHash(source), patches })
const close = (actual, expected, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, actual + ' != ' + expected)

const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n' +
  '  <rect id="a" x="10" y="20" width="30" height="40" fill="#fff"/>\n' +
  '</svg>'

test('parses several space/comma separated functions into one matrix', () => {
  const parsed = parseSvgTransform('translate(10 20) rotate(45) scale(2,3)')
  assert.equal(parsed.operations.length, 3)
  const angle = Math.PI / 4
  const c = Math.cos(angle), s = Math.sin(angle)
  // T(10,20) · R(45) · S(2,3)
  const expected = [2 * c, 2 * s, -3 * s, 3 * c, 10, 20]
  parsed.matrix.forEach((value, index) => close(value, expected[index]))
  assert.equal(parsed.text, formatSvgMatrix(parsed.matrix))
  assert.equal(parseSvgTransform('translate(10,20)').text, 'matrix(1,0,0,1,10,20)')
  assert.equal(parseSvgTransform('translate(10 20) rotate(90)').text, 'matrix(0,1,-1,0,10,20)')
  assert.equal(parseSvgTransform('skewX(45)').text, 'matrix(1,0,1,1,0,0)')
  assert.equal(parseSvgTransform('skewY(45)').text, 'matrix(1,1,0,1,0,0)')
})

test('composing translate on an absent attribute creates one normalised matrix', () => {
  const { patch, text, matrix, created, previous } = svgTransformPatch(source, {
    id: 'a', operation: { type: 'translate', dx: 5, dy: -7 },
  })
  assert.equal(created, true)
  assert.equal(previous, null)
  assert.equal(text, 'matrix(1,0,0,1,5,-7)')
  assert.deepEqual(matrix, [1, 0, 0, 1, 5, -7])
  const result = apply(source, [patch])
  assert.equal(result.ok, true)
  assert.equal(result.source, source.replace('fill="#fff"/>', 'fill="#fff" transform="matrix(1,0,0,1,5,-7)"/>'))
  assert.equal(result.source.replace(' transform="matrix(1,0,0,1,5,-7)"', ''), source)
  assert.equal(apply(result.source, result.inverse).source, source)
})

test('scale about a pivot keeps the pivot point mathematically fixed', () => {
  const { text, matrix } = svgTransformPatch(source, {
    id: 'a', operation: { type: 'scale', sx: 2, sy: 3, pivot: { x: 10, y: 20 } },
  })
  assert.equal(text, 'matrix(2,0,0,3,-10,-40)')
  const fixed = applySvgMatrix(matrix, { x: 10, y: 20 })
  close(fixed.x, 10)
  close(fixed.y, 20)
  // A pivot-free scale stays anchored at the origin.
  assert.equal(svgTransformPatch(source, { id: 'a', operation: { type: 'scale', sx: 2 } }).text, 'matrix(2,0,0,2,0,0)')
})

test('rotate about a pivot normalises 90 degrees to an exact matrix', () => {
  const { text, matrix } = svgTransformPatch(source, {
    id: 'a', operation: { type: 'rotate', angle: 90, pivot: { x: 10, y: 20 } },
  })
  assert.equal(text, 'matrix(0,1,-1,0,30,10)')
  const fixed = applySvgMatrix(matrix, { x: 10, y: 20 })
  close(fixed.x, 10)
  close(fixed.y, 20)
})

test('a new operation acts in the user space, not the local space', () => {
  const scaled = '<svg viewBox="0 0 100 100"><rect id="a" x="1" y="1" width="2" height="2" transform="scale(2)"/></svg>'
  const { matrix } = svgTransformPatch(scaled, { id: 'a', operation: { type: 'translate', dx: 10, dy: 5 } })
  assert.deepEqual(matrix, [2, 0, 0, 2, 10, 5])
  const before = applySvgMatrix(parseSvgTransform('scale(2)').matrix, { x: 1, y: 1 })
  const after = applySvgMatrix(matrix, { x: 1, y: 1 })
  close(after.x - before.x, 10)
  close(after.y - before.y, 5)
})

test('several pre-existing functions are preserved as one normalised matrix', () => {
  const existing = '<svg viewBox="0 0 100 100"><rect id="a" x="1" y="2" width="3" height="4" ' +
    'transform="translate(3 4) scale(2) rotate(15)"/></svg>'
  const value = 'translate(3 4) scale(2) rotate(15)'
  const before = parseSvgTransform(value)
  const operation = { type: 'rotate', angle: 30, pivot: { x: 5, y: 5 } }
  const { patch, matrix, text } = svgTransformPatch(existing, { id: 'a', operation })
  const expected = multiplySvgMatrices(transformOperationMatrix(operation), before.matrix)
  for (const point of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 7, y: -3 }, { x: 100, y: 50 }]) {
    const actual = applySvgMatrix(matrix, point)
    const want = applySvgMatrix(expected, point)
    close(actual.x, want.x)
    close(actual.y, want.y)
  }
  assert.ok(text.startsWith('matrix('))
  assert.equal(text, patch.after)
  const result = apply(existing, [patch])
  assert.equal(result.ok, true)
  assert.equal((result.source.match(/matrix\(/g) || []).length, 1)
  assert.equal(result.source, existing.replace(value, text))
  // Bytes before and after the edited attribute span are untouched.
  assert.equal(result.source.slice(0, patch.start), existing.slice(0, patch.start))
  assert.equal(result.source.slice(patch.start + text.length), existing.slice(patch.end))
  assert.equal(apply(result.source, result.inverse).source, existing)
})

test('the written matrix keeps the previous effective transform', () => {
  const existing = '<svg viewBox="0 0 100 100"><g id="g1" transform="matrix(1,0.5,-0.25,2,10,20)">' +
    '<rect id="a" x="0" y="0" width="1" height="1"/></g></svg>'
  const previous = parseSvgTransform('matrix(1,0.5,-0.25,2,10,20)')
  const { patch } = svgTransformPatch(existing, { id: 'g1', operation: { type: 'translate', dx: 0, dy: 0 } })
  const result = apply(existing, [patch])
  const written = svgTransformValue(result.source, { id: 'g1' })
  for (const point of [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: -2.5, y: 8 }]) {
    const actual = applySvgMatrix(written.matrix, point)
    const want = applySvgMatrix(previous.matrix, point)
    close(actual.x, want.x)
    close(actual.y, want.y)
  }
})

test('matrix operation and composed values format deterministically', () => {
  assert.equal(svgTransformPatch(source, { id: 'a', operation: { type: 'matrix', matrix: [2, 0, 0, 2, 5, 5] } }).text,
    'matrix(2,0,0,2,5,5)')
  assert.equal(formatSvgMatrix([1, 0, 0, 1, 0, 0]), 'matrix(1,0,0,1,0,0)')
  assert.equal(formatSvgMatrix([1, 0, 0, 1, -0, 0]), 'matrix(1,0,0,1,0,0)')
  assert.equal(formatSvgMatrix([1 / 3, 0, 0, 1, 0, 0]), 'matrix(0.333333,0,0,1,0,0)')
  assert.equal(formatSvgMatrix([1e-12, 0, 0, 1, 0, 0]), 'matrix(0,0,0,1,0,0)')
  assert.throws(() => formatSvgMatrix([1, 0, 0, 1, 0]), { code: 'invalid-transform' })
  assert.throws(() => formatSvgMatrix([NaN, 0, 0, 1, 0, 0]), { code: 'invalid-transform' })
  assert.deepEqual(invertSvgMatrixLinear([2, 0, 0, 4, 9, 9]), [0.5, 0, 0, 0.25])
  assert.equal(invertSvgMatrixLinear([0, 0, 0, 0, 0, 0]), null)
  assert.equal(composeSvgTransform('translate(1 2)', { type: 'translate', dx: 1, dy: 1 }).text, 'matrix(1,0,0,1,2,3)')
})

test('unknown functions, units and percentages are refused, never coerced', () => {
  for (const value of ['wobble(2)', 'translate(10px)', 'rotate(45deg)', 'scale(50%)', 'skewX(1rad)',
    'translate(1 2) wobble(1)', 'scale(2em)']) {
    assert.throws(() => parseSvgTransform(value), { code: 'unsupported-transform' }, value)
  }
})

test('malformed transform syntax is refused with a typed code', () => {
  for (const value of ['', '   ', 'translate()', 'translate(1 2 3)', 'scale(2', 'matrix(1 2 3)',
    'translate 10', 'rotate(10,)', 'translate(1 2) ,', 'translate(,1)', 'rotate(1 2)',
    'matrix(1,2,3,4,5,6,7)']) {
    assert.throws(() => parseSvgTransform(value), { code: 'invalid-transform' }, value)
  }
})

test('operation payloads are validated before any matrix is produced', () => {
  assert.throws(() => svgTransformPatch(source, { id: 'a', operation: { type: 'wobble', dx: 1 } }), { code: 'unsupported-transform' })
  assert.throws(() => svgTransformPatch(source, { id: 'a', operation: { type: 'translate', dx: NaN } }), { code: 'invalid-transform' })
  assert.throws(() => svgTransformPatch(source, { id: 'a', operation: { type: 'translate', dx: 1, pivot: { x: 0, y: 0 } } }), { code: 'invalid-transform' })
  assert.throws(() => svgTransformPatch(source, { id: 'a', operation: { type: 'scale', sx: 2, pivot: '5,5' } }), { code: 'invalid-transform' })
  assert.throws(() => svgTransformPatch(source, { id: 'a', operation: { type: 'rotate', angle: '90' } }), { code: 'invalid-transform' })
  assert.throws(() => svgTransformPatch(source, { id: 'a' }), { code: 'invalid-transform' })
})

test('transform targets are guarded like every other source mutation', () => {
  assert.throws(() => svgTransformPatch(source, { id: 'missing', operation: { type: 'translate', dx: 1 } }), { code: 'unknown-node' })
  const rootId = '<svg id="root" viewBox="0 0 10 10"><rect id="a" x="0" y="0" width="1" height="1"/></svg>'
  assert.throws(() => svgTransformPatch(rootId, { id: 'root', operation: { type: 'translate', dx: 1 } }), { code: 'unsafe-selection' })
  const locked = '<svg viewBox="0 0 10 10"><g id="g1" data-locked="true"><rect id="a" x="0" y="0" width="1" height="1"/></g></svg>'
  assert.throws(() => svgTransformPatch(locked, { id: 'a', operation: { type: 'translate', dx: 1 } }), { code: 'locked' })
  const defs = '<svg viewBox="0 0 10 10"><defs><rect id="d" x="0" y="0" width="1" height="1"/></defs></svg>'
  assert.throws(() => svgTransformPatch(defs, { id: 'd', operation: { type: 'translate', dx: 1 } }), { code: 'read-only' })
  const bogus = '<svg viewBox="0 0 10 10"><rect id="a" x="0" y="0" width="1" height="1" transform="wobble(2)"/></svg>'
  assert.throws(() => svgTransformPatch(bogus, { id: 'a', operation: { type: 'translate', dx: 1 } }), { code: 'unsupported-transform' })
})

test('group transforms are written back without touching sibling bytes', () => {
  const groupDoc = '<svg viewBox="0 0 100 100"><g id="g1" transform="translate(1 2)">' +
    '<rect id="a" x="0" y="0" width="1" height="1"/></g>' +
    '<rect id="b" x="0" y="0" width="1" height="1"/></svg>'
  const { patch } = svgTransformPatch(groupDoc, { id: 'g1', operation: { type: 'translate', dx: 10, dy: 20 } })
  const result = apply(groupDoc, [patch])
  assert.equal(result.ok, true)
  assert.equal(result.source, groupDoc.replace('translate(1 2)', 'matrix(1,0,0,1,11,22)'))
  assert.equal(apply(result.source, result.inverse).source, groupDoc)
})

test('commented, unicode and single-quoted sources keep exact spans', () => {
  const tricky = '<svg viewBox="0 0 10 10"><!-- transform="scale(9)" -->' +
    "<text id='t' x='1' y='2' transform='translate(1)'>🚀 héllo</text></svg>"
  const { patch, text } = svgTransformPatch(tricky, { id: 't', operation: { type: 'translate', dx: 2 } })
  assert.equal(text, 'matrix(1,0,0,1,3,0)')
  const result = apply(tricky, [patch])
  assert.equal(result.source, tricky.replace("transform='translate(1)'", "transform='matrix(1,0,0,1,3,0)'"))
  assert.ok(result.source.includes('<!-- transform="scale(9)" -->'))
  assert.ok(result.source.includes('🚀 héllo'))
  assert.equal(apply(result.source, result.inverse).source, tricky)
})

test('svgTransformValue reports identity, raw value and matrix', () => {
  assert.deepEqual(svgTransformValue(source, { id: 'a' }).matrix, [1, 0, 0, 1, 0, 0])
  assert.equal(svgTransformValue(source, { id: 'a' }).value, null)
  const transformed = '<svg viewBox="0 0 10 10"><rect id="a" x="0" y="0" width="1" height="1" transform="translate(4 5)"/></svg>'
  const value = svgTransformValue(transformed, { id: 'a' })
  assert.equal(value.value, 'translate(4 5)')
  assert.deepEqual(value.matrix, [1, 0, 0, 1, 4, 5])
  assert.equal(value.text, 'matrix(1,0,0,1,4,5)')
})

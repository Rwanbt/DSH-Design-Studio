/**
 * Pivot coordinate space: a transform attribute acts in the element's PARENT
 * space, so a pivot derived from the rendered (artboard) position must be mapped
 * back through the ancestor chain. Without that mapping the shape jumps and the
 * jump is written to disk while the UI claims the centre is fixed.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { svgAbsoluteGeometry } from '../src/svg-geometry.mjs'
import { applySvgMatrix, invertSvgMatrix, svgTransformPatch } from '../src/svg-transform.mjs'

const NESTED = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 2000 2000">' +
  '<g transform="translate(1000,0)"><rect id="inner" x="10" y="10" width="20" height="20"/></g></svg>'

const handleFor = (source, id) => {
  const handle = svgAbsoluteGeometry(source).handles.find((entry) => entry.id === id)
  assert.ok(handle, `expected a handle for ${id}`)
  return handle
}

test('every handle exposes a parent-space inverse able to map the rendered centre', () => {
  const handle = handleFor(NESTED, 'inner')
  assert.equal(Array.isArray(handle.pivotInverse), true, 'handles must carry the parent inverse')
  assert.equal(handle.pivotInverse.length, 6)
  const absolute = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  // The rect is at (10,10) size 20x20, so its parent-space centre is (20,20).
  const mapped = applySvgMatrix(handle.pivotInverse, absolute)
  assert.equal(Math.round(mapped.x), 20)
  assert.equal(Math.round(mapped.y), 20)
})

test('a top-level shape keeps an identity parent inverse', () => {
  const source = '<svg viewBox="0 0 100 100"><rect id="only" x="5" y="5" width="10" height="10"/></svg>'
  const handle = handleFor(source, 'only')
  assert.deepEqual(handle.pivotInverse, [1, 0, 0, 1, 0, 0])
})

test('rotating a nested shape about its mapped pivot keeps the centre fixed', () => {
  const handle = handleFor(NESTED, 'inner')
  const pivot = applySvgMatrix(handle.pivotInverse, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 })
  const rounded = (value) => Math.round(value * 1000) / 1000
  const result = svgTransformPatch(NESTED, { id: 'inner',
    operation: { type: 'rotate', angle: 90, pivot: { x: rounded(pivot.x), y: rounded(pivot.y) } } })
  const matrix = result.matrix
  // 90° about (20,20) in parent space: [0,1,-1,0, 40, 0]
  assert.deepEqual(matrix.map(rounded), [0, 1, -1, 0, 40, 0])
  // The parent-space centre must be a fixed point of the composed transform.
  const fixed = applySvgMatrix(matrix, { x: 20, y: 20 })
  assert.ok(Math.abs(fixed.x - 20) < 1e-9 && Math.abs(fixed.y - 20) < 1e-9,
    `the pivot must be fixed, got ${fixed.x},${fixed.y}`)
})

test('using the artboard centre instead of the parent-space pivot is demonstrably wrong', () => {
  // Regression guard for the reported defect: with the raw artboard centre the
  // same rotation displaces the shape by the ancestor translation.
  const handle = handleFor(NESTED, 'inner')
  const naive = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  const rounded = (value) => Math.round(value * 1000) / 1000
  const result = svgTransformPatch(NESTED, { id: 'inner',
    operation: { type: 'rotate', angle: 90, pivot: { x: rounded(naive.x), y: rounded(naive.y) } } })
  const fixed = applySvgMatrix(result.matrix, { x: 20, y: 20 })
  assert.ok(Math.abs(fixed.x - 20) > 1, 'the naive pivot does not keep the centre fixed')
})

test('a singular ancestor chain yields no pivot inverse instead of a wrong one', () => {
  const source = '<svg viewBox="0 0 100 100"><g transform="scale(0)">' +
    '<rect id="dead" x="1" y="1" width="2" height="2"/></g></svg>'
  const geometry = svgAbsoluteGeometry(source)
  const handle = geometry.handles.find((entry) => entry.id === 'dead')
  if (handle) assert.equal(handle.pivotInverse, null, 'a degenerate chain must not produce a pivot inverse')
  assert.ok(geometry.refusals.some((refusal) => /degenerate|transform/.test(refusal.reason)),
    'the degenerate transform is reported, not silently ignored')
})

test('the full affine inverse is exact and refuses singular matrices', () => {
  const inverse = invertSvgMatrix([2, 0, 0, 4, 10, -6])
  assert.deepEqual(inverse.map((value) => Math.round(value * 1e6) / 1e6), [0.5, 0, 0, 0.25, -5, 1.5])
  const point = applySvgMatrix([2, 0, 0, 4, 10, -6], { x: 0, y: 0 })
  const back = applySvgMatrix(inverse, point)
  assert.ok(Math.abs(back.x) < 1e-9 && Math.abs(back.y) < 1e-9, 'inverse(inverse) round-trips')
  assert.equal(invertSvgMatrix([0, 0, 0, 0, 1, 1]), null)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  svgAbsoluteGeometry,
  svgGeometry,
  svgMoveEdits,
} from '../src/svg-geometry.mjs'
import { svgAttributePatch } from '../src/svg-attributes.mjs'
import { formatSvgMatrix } from '../src/svg-transform.mjs'
import { applyNativePatches, sourceHash } from '../src/native-patch.mjs'

const apply = (source, patches) => applyNativePatches({ source, format: 'svg', baseHash: sourceHash(source), patches })
const close = (actual, expected, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, actual + ' != ' + expected)

test('the historical conservative mode is unchanged and the absolute mode is opt-in', () => {
  const nested = '<svg viewBox="0 0 100 100"><g><rect id="r" x="1" y="1" width="2" height="2"/></g></svg>'
  assert.deepEqual(svgGeometry(nested), {
    artboard: null,
    handles: [],
    warning: 'Drag editing requires an untransformed SVG with no groups or foreignObject',
  })
  const absolute = svgGeometry(nested, { transforms: true })
  // One leaf handle plus one group handle: a grouped selection must stay movable.
  assert.equal(absolute.handles.filter(handle => handle.tag !== 'g').length, 1)
  const leaf = absolute.handles.find(handle => handle.id === 'r')
  assert.deepEqual(leaf.matrix, [1, 0, 0, 1, 0, 0])
  assert.deepEqual([leaf.x, leaf.y, leaf.width, leaf.height], [1, 1, 2, 2])
  assert.equal(absolute.mode, 'absolute')
  assert.deepEqual(svgAbsoluteGeometry(nested).handles[0].id, 'r')
})

test('ancestor and self transforms compose for nested groups', () => {
  const doc = '<svg viewBox="0 0 200 200"><g transform="translate(10 20)"><g transform="scale(2)">' +
    '<g transform="rotate(0)"><rect id="r" x="1" y="2" width="3" height="4"/></g></g></g></svg>'
  const handle = svgAbsoluteGeometry(doc).handles[0]
  assert.deepEqual(handle.matrix, [2, 0, 0, 2, 10, 20])
  assert.deepEqual([handle.x, handle.y, handle.width, handle.height], [12, 24, 6, 8])
  assert.deepEqual(handle.local, { x: 1, y: 2, width: 3, height: 4 })
  assert.equal(handle.rotated, false)
})

test('a node transform is applied after its ancestors', () => {
  const doc = '<svg viewBox="0 0 200 200"><g transform="translate(5 5)">' +
    '<rect id="r" transform="scale(2)" x="1" y="1" width="2" height="2"/></g></svg>'
  const handle = svgAbsoluteGeometry(doc).handles[0]
  assert.deepEqual(handle.matrix, [2, 0, 0, 2, 5, 5])
  assert.deepEqual([handle.x, handle.y, handle.width, handle.height], [7, 7, 4, 4])
})

test('rotation about a pivot yields the visible axis-aligned box', () => {
  const doc = '<svg viewBox="0 0 100 100"><rect id="r" x="10" y="10" width="20" height="10" ' +
    'transform="rotate(90 10 10)"/></svg>'
  const handle = svgAbsoluteGeometry(doc).handles[0]
  // Geometry keeps full precision; the writer normalises it to 6 decimals.
  const expected = [0, 1, -1, 0, 20, 0]
  handle.matrix.forEach((value, index) => close(value, expected[index]))
  assert.equal(formatSvgMatrix(handle.matrix), 'matrix(0,1,-1,0,20,0)')
  assert.equal(handle.rotated, true)
  const box = [handle.x, handle.y, handle.width, handle.height]
  box.forEach((value, index) => close(value, [0, 10, 10, 20][index]))
})

test('circles and ellipses are mapped through the transform chain', () => {
  const doc = '<svg viewBox="0 0 100 100"><g transform="translate(50 25)">' +
    '<circle id="c" cx="10" cy="10" r="4"/>' +
    '<ellipse id="e" cx="20" cy="20" rx="6" ry="3" transform="scale(2)"/></g></svg>'
  const handles = svgAbsoluteGeometry(doc).handles.filter(handle => handle.tag !== 'g')
  assert.deepEqual(handles.map(handle => handle.id), ['c', 'e'])
  assert.deepEqual([handles[0].x, handles[0].y, handles[0].width, handles[0].height], [56, 31, 8, 8])
  // ellipse local box (14,17,12,6) scaled by 2 then translated by (50,25)
  assert.deepEqual([handles[1].x, handles[1].y, handles[1].width, handles[1].height], [78, 59, 24, 12])
})

test('a parent-space drag delta is mapped back into local coordinates', () => {
  const doc = '<svg viewBox="0 0 100 100"><g transform="scale(2)">' +
    '<rect id="r" x="10" y="20" width="10" height="10"/></g></svg>'
  const handle = svgAbsoluteGeometry(doc).handles[0]
  assert.deepEqual(handle.matrix, [2, 0, 0, 2, 0, 0])
  assert.equal(handle.resizable, false)
  assert.deepEqual(svgMoveEdits(handle, 10, -8), [
    { id: 'r', attribute: 'x', value: '15' },
    { id: 'r', attribute: 'y', value: '16' },
  ])
  const patches = svgMoveEdits(handle, 10, -8).map(edit => svgAttributePatch(doc, edit))
  const result = apply(doc, patches)
  assert.equal(result.ok, true)
  assert.equal(result.source, doc.replace('x="10"', 'x="15"').replace('y="20"', 'y="16"'))
  assert.equal(apply(result.source, result.inverse).source, doc)
  // Screen delta of 10 units at scale 2 moves the visible box by exactly 10.
  const moved = svgAbsoluteGeometry(result.source).handles[0]
  close(moved.x - handle.x, 10)
  close(moved.y - handle.y, -8)
})

test('svggMoveEdits is unchanged for untransformed handles', () => {
  const doc = '<svg viewBox="0 0 100 100"><rect id="r" x="10" y="20" width="10" height="10"/></svg>'
  const handle = svgGeometry(doc).handles[0]
  assert.equal(handle.move.inverse, undefined)
  assert.deepEqual(svgMoveEdits(handle, 1.5, -2), [
    { id: 'r', attribute: 'x', value: '11.5' },
    { id: 'r', attribute: 'y', value: '18' },
  ])
})

test('defs content is never emitted as a handle', () => {
  const doc = '<svg viewBox="0 0 100 100"><defs><rect id="src" x="0" y="0" width="2" height="2"/></defs>' +
    '<rect id="top" x="10" y="10" width="4" height="4"/></svg>'
  assert.deepEqual(svgAbsoluteGeometry(doc).handles.map(handle => handle.id), ['top'])
})

test('use instances, unknown transforms and bad geometry are refused, not guessed', () => {
  const useDoc = '<svg viewBox="0 0 100 100"><defs><rect id="src" x="0" y="0" width="2" height="2"/></defs>' +
    '<use id="u" href="#src" x="3" y="3"/></svg>'
  const useResult = svgAbsoluteGeometry(useDoc)
  assert.deepEqual(useResult.handles, [])
  assert.deepEqual(useResult.refusals.map(refusal => refusal.reason), ['unsupported-use'])

  const bogus = '<svg viewBox="0 0 10 10"><g transform="wobble(2)">' +
    '<rect id="r" x="1" y="1" width="2" height="2"/></g></svg>'
  const bogusResult = svgAbsoluteGeometry(bogus)
  assert.deepEqual(bogusResult.handles, [])
  assert.deepEqual(bogusResult.refusals.map(refusal => refusal.reason), ['unsupported-transform'])

  const percent = '<svg viewBox="0 0 10 10"><rect id="r" x="50%" y="0" width="5" height="5"/></svg>'
  assert.deepEqual(svgAbsoluteGeometry(percent).refusals.map(refusal => refusal.reason), ['unsupported-geometry'])

  const degenerate = '<svg viewBox="0 0 10 10"><rect id="r" x="1" y="1" width="2" height="2" transform="scale(0)"/></svg>'
  assert.deepEqual(svgAbsoluteGeometry(degenerate).refusals.map(refusal => refusal.reason), ['degenerate-transform'])
})

test('a root transform and an invalid viewBox are explicitly refused', () => {
  const rooted = '<svg viewBox="0 0 10 10" transform="scale(2)"><rect id="r" x="1" y="1" width="2" height="2"/></svg>'
  const result = svgAbsoluteGeometry(rooted)
  assert.equal(result.warning, 'unsupported-transform')
  assert.deepEqual(result.handles, [])
  assert.deepEqual(result.refusals.map(refusal => refusal.reason), ['unsupported-transform'])
  const invalid = svgGeometry('<svg><rect id="r" x="1" y="1" width="2" height="2"/></svg>', { transforms: true })
  assert.equal(invalid.artboard, null)
  assert.equal(invalid.warning, 'SVG drag requires a viewBox and default preserveAspectRatio')
})

test('text estimates are transformed and flagged as approximate', () => {
  const doc = '<svg viewBox="0 0 100 100"><text id="t" x="10" y="20" font-size="10" ' +
    'transform="translate(5 5)">Hi</text></svg>'
  const handle = svgAbsoluteGeometry(doc).handles.find(item => item.id === 't')
  assert.equal(handle.text, true)
  assert.equal(handle.approximate, true)
  assert.deepEqual(handle.local, { x: 10, y: 10, width: 11.6, height: 12 })
  assert.deepEqual([handle.x, handle.y], [15, 15])
  close(handle.width, 11.6)
  close(handle.height, 12)
  assert.equal(handle.resizable, false)
})

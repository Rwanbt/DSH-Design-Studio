import test from 'node:test'
import assert from 'node:assert/strict'
import { svgAbsoluteGeometry, svgMoveEdits } from '../src/svg-geometry.mjs'

const DOC = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">' +
  '<g id="pair"><rect id="a" x="10" y="10" width="30" height="20"/>' +
  '<rect id="b" x="60" y="30" width="30" height="20"/></g></svg>'

test('a group exposes the union box of its addressable children', () => {
  const handles = svgAbsoluteGeometry(DOC).handles
  const group = handles.find((handle) => handle.id === 'pair')
  assert.ok(group, 'the group must be draggable, otherwise grouping is a dead end')
  assert.equal(group.tag, 'g')
  assert.equal(group.group, true)
  assert.equal(group.children, 2)
  // a: (10,10)-(40,30), b: (60,30)-(90,50)
  assert.deepEqual([group.x, group.y, group.width, group.height], [10, 10, 80, 40])
  assert.equal(group.resizable, false, 'a group box is a selection aid, not a resizable frame')
  assert.deepEqual(group.move.kind, 'translate')
})

test('a group inside a transformed parent maps the visible delta back to parent space', () => {
  const doc = '<svg viewBox="0 0 200 200"><g transform="scale(2)"><g id="pair">' +
    '<rect id="a" x="5" y="5" width="10" height="10"/></g></g></svg>'
  const group = svgAbsoluteGeometry(doc).handles.find((handle) => handle.id === 'pair')
  // Visible box is scaled by the parent: (10,10)-(30,30).
  assert.deepEqual([group.x, group.y, group.width, group.height], [10, 10, 20, 20])
  // A 20px visible drag is a 10-unit translate in the parent's coordinate space.
  const [dx, dy] = [group.move.inverse[0] * 20 + group.move.inverse[2] * 0, group.move.inverse[1] * 20 + group.move.inverse[3] * 0]
  assert.equal(dx, 10)
  assert.equal(dy, 0)
})

test('groups without addressable children are not offered as handles', () => {
  const doc = '<svg viewBox="0 0 100 100"><g id="empty"></g><g id="anon"><rect x="1" y="1" width="2" height="2"/></g></svg>'
  const ids = svgAbsoluteGeometry(doc).handles.map((handle) => handle.id)
  assert.ok(!ids.includes('empty'), 'an empty group has no geometry')
  assert.ok(!ids.includes('anon'), 'a group of anonymous nodes has no addressable box')
  assert.deepEqual(svgMoveEdits({ move: { x: 'x', y: 'y', initialX: 0, initialY: 0 } }, 2, 3).length, 2,
    'legacy leaf moves are unchanged')
})

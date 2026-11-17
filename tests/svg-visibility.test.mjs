import test from 'node:test'
import assert from 'node:assert/strict'
import {
  svgElementState,
  svgLockPatch,
  svgToggleVisibility,
  svgVisibilityPatch,
} from '../src/svg-visibility.mjs'
import { applyNativePatches, sourceHash } from '../src/native-patch.mjs'

const apply = (source, patches) => applyNativePatches({ source, format: 'svg', baseHash: sourceHash(source), patches })

const base = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n' +
  '  <g id="layer" opacity="0.5">\n' +
  '    <rect id="card" x="1" y="2" width="3" height="4" fill="#fff"/>\n' +
  '    <circle id="dot" cx="5" cy="6" r="7"/>\n' +
  '  </g>\n' +
  '</svg>'

test('display:none inserts one attribute and its inverse restores every byte', () => {
  const patch = svgVisibilityPatch(base, { id: 'card', property: 'display', value: 'none' })
  assert.equal(patch.before, '')
  assert.equal(patch.after, ' display="none"')
  const result = apply(base, [patch])
  assert.equal(result.ok, true)
  assert.equal(result.source, base.replace('fill="#fff"/>', 'fill="#fff" display="none"/>'))
  // Only the edited element changed; removing the inserted bytes restores base.
  assert.equal(result.source.replace(' display="none"', ''), base)
  assert.equal(apply(result.source, result.inverse).source, base)
})

test('setting an existing display replaces its value span only', () => {
  const visible = base.replace('fill="#fff"/>', 'fill="#fff" display="inline"/>')
  const patch = svgVisibilityPatch(visible, { id: 'card', property: 'display', value: 'none' })
  assert.equal(patch.before, 'inline')
  const result = apply(visible, [patch])
  assert.equal(result.source, visible.replace('display="inline"', 'display="none"'))
  assert.equal(apply(result.source, result.inverse).source, visible)
})

test('removing the attribute restores the exact original bytes', () => {
  const hidden = apply(base, [svgVisibilityPatch(base, { id: 'dot', property: 'display', value: 'none' })]).source
  const removal = svgVisibilityPatch(hidden, { id: 'dot', property: 'display', value: null })
  assert.equal(removal.after, '')
  const restored = apply(hidden, [removal])
  assert.equal(restored.source, base)
  assert.equal(apply(restored.source, restored.inverse).source, hidden)
})

test('toggling hides then removes the override, returning to the original file', () => {
  const hidden = apply(base, [svgToggleVisibility(base, { id: 'card', property: 'display' })])
  assert.equal(hidden.ok, true)
  assert.ok(hidden.source.includes('id="card" x="1" y="2" width="3" height="4" fill="#fff" display="none"'))
  const shown = apply(hidden.source, [svgToggleVisibility(hidden.source, { id: 'card', property: 'display' })])
  assert.equal(shown.source, base)
})

test('visibility property toggles hidden/collapse arithmetic in state', () => {
  const patch = svgVisibilityPatch(base, { id: 'dot', property: 'visibility', value: 'collapse' })
  const applied = apply(base, [patch])
  assert.equal(svgElementState(applied.source, { id: 'dot' }).hidden, true)
  assert.equal(svgElementState(applied.source, { id: 'dot' }).visibility, 'collapse')
  assert.equal(apply(applied.source, applied.inverse).source, base)
  assert.equal(svgElementState(base, { id: 'dot' }).hidden, false)
})

test('state reads display, visibility and lock without mutating source', () => {
  const state = svgElementState(base, { id: 'dot' })
  assert.deepEqual([state.id, state.tag, state.display, state.visibility, state.locked, state.hidden],
    ['dot', 'circle', null, null, false, false])
  assert.equal(base.slice(state.start, state.openEnd), '<circle id="dot" cx="5" cy="6" r="7"/>')
})

test('unsafe or unknown visibility values are refused before any patch exists', () => {
  for (const value of ['expression(alert(1))', 'none; background:url(x)', 'block" onload="x', '']) {
    assert.throws(() => svgVisibilityPatch(base, { id: 'card', property: 'display', value }), { code: 'invalid-value' })
  }
  assert.throws(() => svgVisibilityPatch(base, { id: 'card', property: 'opacity', value: 'none' }), { code: 'invalid-target' })
  assert.throws(() => svgVisibilityPatch(base, { id: 'card', property: 'display', value: null }), { code: 'invalid-target' })
  assert.throws(() => svgVisibilityPatch(base, { id: 'missing', property: 'display', value: 'none' }), { code: 'unknown-node' })
})

test('lock marker is inserted, read back and removed byte for byte', () => {
  const lock = svgLockPatch(base, { id: 'card', locked: true })
  assert.equal(lock.after, ' data-locked="true"')
  const locked = apply(base, [lock])
  assert.equal(locked.ok, true)
  assert.equal(locked.source, base.replace('fill="#fff"/>', 'fill="#fff" data-locked="true"/>'))
  assert.equal(svgElementState(locked.source, { id: 'card' }).locked, true)
  assert.equal(apply(locked.source, locked.inverse).source, base)
  const unlock = svgLockPatch(locked.source, { id: 'card', locked: false })
  assert.equal(apply(locked.source, [unlock]).source, base)
  assert.throws(() => svgLockPatch(base, { id: 'card', locked: false }), { code: 'invalid-target' })
  assert.throws(() => svgLockPatch(locked.source, { id: 'card', locked: true }), { code: 'invalid-target' })
  assert.throws(() => svgLockPatch(base, { id: 'card', locked: 'true' }), { code: 'invalid-target' })
})

test('a lock prevents visibility changes on the element and its descendants', () => {
  const lockedLayer = apply(base, [svgLockPatch(base, { id: 'layer', locked: true })]).source
  assert.throws(() => svgVisibilityPatch(lockedLayer, { id: 'layer', property: 'display', value: 'none' }), { code: 'locked' })
  assert.throws(() => svgVisibilityPatch(lockedLayer, { id: 'dot', property: 'display', value: 'none' }), { code: 'locked' })
  // Unlocking is still possible on the locked element itself.
  const unlocked = apply(lockedLayer, [svgLockPatch(lockedLayer, { id: 'layer', locked: false })])
  assert.equal(unlocked.source, base)
})

test('read-only and root targets are refused', () => {
  const defs = '<svg viewBox="0 0 10 10"><defs><rect id="src" x="0" y="0" width="1" height="1"/></defs></svg>'
  assert.throws(() => svgVisibilityPatch(defs, { id: 'src', property: 'display', value: 'none' }), { code: 'read-only' })
  const rootId = '<svg id="root" viewBox="0 0 10 10"><rect id="a" x="0" y="0" width="1" height="1"/></svg>'
  assert.throws(() => svgLockPatch(rootId, { id: 'root', locked: true }), { code: 'unsafe-selection' })
})

test('unicode text and commented markup stay untouched outside the target span', () => {
  const source = '<svg viewBox="0 0 10 10"><!-- <rect id="ghost" display="none"/> -->' +
    '<text id="label" x="1" y="2">🚀 héllo</text></svg>'
  const patch = svgVisibilityPatch(source, { id: 'label', property: 'display', value: 'none' })
  const result = apply(source, [patch])
  assert.equal(result.source, source.replace('<text id="label" x="1" y="2">',
    '<text id="label" x="1" y="2" display="none">'))
  assert.equal(source.slice(0, patch.start), '<svg viewBox="0 0 10 10"><!-- <rect id="ghost" display="none"/> --><text id="label" x="1" y="2"')
  assert.equal(source.slice(patch.start), '>🚀 héllo</text></svg>')
  assert.equal(apply(result.source, result.inverse).source, source)
})

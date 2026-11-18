/**
 * Artboard resizing — module level.
 *
 * The bytes are the contract: a display resize touches only `width`/`height`
 * and leaves `viewBox` intact; the explicit content resize writes `viewBox`,
 * `width` and `height` in ONE patch set; every refusal produces no patch and a
 * typed code; every successful step has an exact inverse.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ARTBOARD_MAX, ARTBOARD_MIN, inspectSvgArtboard, planSvgArtboard } from '../src/svg-artboard.mjs'
import { svgRootAttributePatch } from '../src/svg-attributes.mjs'
import { applyNativePatches, sourceHash } from '../src/native-patch.mjs'

const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">
  <rect id="one" x="10" y="20" width="30" height="40" fill="#bda991"/>
  <circle id="dot" cx="120" cy="80" r="12"/>
</svg>
`
const SIZED = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">' +
  '<rect id="r" x="1" y="2" width="3" height="4"/></svg>'
const VIEWBOX_ONLY = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">' +
  '<rect id="r" x="1" y="2" width="3" height="4"/></svg>'

function apply(source, patches) {
  return applyNativePatches({ source, format: 'svg', baseHash: sourceHash(source), patches })
}

function applyAndUndo(source, patches) {
  const forward = apply(source, patches)
  assert.equal(forward.ok, true, JSON.stringify(forward))
  const backward = apply(forward.source, forward.inverse)
  assert.equal(backward.ok, true, JSON.stringify(backward))
  return { forward: forward.source, undone: backward.source }
}

test('the inspector reads the size that is actually declared in the file', () => {
  const viewBox = inspectSvgArtboard(SVG)
  assert.equal(viewBox.ok, true)
  assert.equal(viewBox.source, 'viewBox')
  assert.equal(viewBox.width, 240)
  assert.equal(viewBox.height, 160)
  assert.equal(viewBox.viewBox, '0 0 240 160')
  assert.equal(viewBox.widthAttribute, '240')
  assert.equal(viewBox.displayResize, true)

  const sized = inspectSvgArtboard(SIZED)
  assert.equal(sized.ok, true, 'a root with absolute width/height is a resolvable artboard')
  assert.equal(sized.source, 'size')
  assert.equal(sized.width, 120)
  assert.equal(sized.height, 80)
  assert.equal(sized.viewBox, null)
  assert.equal(sized.displayResize, false, 'there is no viewBox to leave intact')
  assert.equal(sized.contentResize, true)

  const empty = inspectSvgArtboard('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  assert.equal(empty.ok, false)
  assert.equal(empty.reason, 'unresolvable-artboard')
})

test('a display resize changes only width/height and leaves viewBox and shapes untouched', () => {
  const plan = planSvgArtboard(SVG, { width: 300, height: 160 })
  assert.equal(plan.scaleContent, false)
  assert.equal(plan.patches.length, 1, 'only width differs: one attribute, one patch')
  const { forward, undone } = applyAndUndo(SVG, plan.patches)
  assert.equal(forward, SVG.replace('width="240"', 'width="300"'),
    'viewBox and every shape keep their exact bytes')
  assert.ok(forward.includes('viewBox="0 0 240 160"'), 'the viewBox is untouched')
  assert.ok(forward.includes('id="one" x="10" y="20" width="30" height="40"'),
    'a shape width is never confused with the root width')
  assert.equal(undone, SVG, 'Undo restores the original bytes exactly')
})

test('the explicit content resize writes viewBox, width and height in one patch set', () => {
  const plan = planSvgArtboard(SVG, { width: 300, height: 200, scaleContent: true })
  assert.equal(plan.scaleContent, true)
  assert.equal(plan.patches.length, 3, 'viewBox + width + height travel together')
  // No two patches may share an insertion position or overlap: the native patch
  // engine would refuse the write instead of applying a partial resize.
  const starts = plan.patches.map((patch) => patch.start).sort((a, b) => a - b)
  for (let index = 1; index < starts.length; index += 1) {
    assert.ok(starts[index] > starts[index - 1], 'patch positions must be distinct')
  }
  const { forward, undone } = applyAndUndo(SVG, plan.patches)
  assert.equal(forward, SVG.replace(
    'width="240" height="160" viewBox="0 0 240 160"',
    'width="300" height="200" viewBox="0 0 300 200"'))
  assert.ok(forward.includes('id="one" x="10" y="20" width="30" height="40" fill="#bda991"'),
    'the content is never rewritten')
  assert.equal(undone, SVG)
})

test('a document without a viewBox refuses a display resize but can add one in content mode', () => {
  assert.throws(() => planSvgArtboard(SIZED, { width: 200, height: 100 }),
    (error) => error.code === 'missing-viewbox')
  const plan = planSvgArtboard(SIZED, { width: 200, height: 100, scaleContent: true })
  assert.equal(plan.patches.length, 3)
  const { forward, undone } = applyAndUndo(SIZED, plan.patches)
  assert.equal(forward,
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">' +
    '<rect id="r" x="1" y="2" width="3" height="4"/></svg>')
  assert.equal(undone, SIZED, 'the inserted viewBox is removed by the exact inverse')
})

test('missing root attributes are inserted together at one exact offset', () => {
  const plan = planSvgArtboard(VIEWBOX_ONLY, { width: 300, height: 150 })
  assert.equal(plan.patches.length, 1,
    'two insertions at the same offset are merged into one reversible insertion')
  const { forward, undone } = applyAndUndo(VIEWBOX_ONLY, plan.patches)
  assert.equal(forward,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="300" height="150">' +
    '<rect id="r" x="1" y="2" width="3" height="4"/></svg>')
  assert.equal(undone, VIEWBOX_ONLY)

  const content = planSvgArtboard(VIEWBOX_ONLY, { width: 300, height: 150, scaleContent: true })
  assert.equal(content.patches.length, 2,
    'the existing viewBox is replaced in place while the two new attributes share one insertion')
  const applied = apply(VIEWBOX_ONLY, content.patches)
  assert.equal(applied.source,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150" width="300" height="150">' +
    '<rect id="r" x="1" y="2" width="3" height="4"/></svg>')
  assert.equal(apply(applied.source, applied.inverse).source, VIEWBOX_ONLY)
})

test('an explicit px unit on the root is preserved when the dimension changes', () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg" width="240px" height="160px" viewBox="0 0 240 160"></svg>'
  const patch = svgRootAttributePatch(source, { attribute: 'width', value: '300px' })
  const result = apply(source, [patch])
  assert.equal(result.source, source.replace('width="240px"', 'width="300px"'))
  const plan = planSvgArtboard(source, { width: 300, height: 160 })
  assert.equal(apply(source, plan.patches).source, source.replace('width="240px"', 'width="300px"'))
})

test('invalid dimensions are refused with typed codes and no patch', () => {
  const refused = [
    [{ width: 'abc', height: 160 }, 'invalid-dimensions'],
    [{ width: 300, height: '12px' }, 'invalid-dimensions'],
    [{ width: '1e3', height: 160 }, 'invalid-dimensions'],
    [{ width: 0, height: 160 }, 'out-of-range'],
    [{ width: -10, height: 160 }, 'out-of-range'],
    [{ width: 300, height: ARTBOARD_MAX + 1 }, 'out-of-range'],
    [{ width: 300, height: 0.5 }, 'out-of-range'],
  ]
  for (const [request, code] of refused) {
    assert.throws(() => planSvgArtboard(SVG, request), (error) => error.code === code,
      JSON.stringify(request) + ' must be refused with ' + code)
  }
  // The exact bounds are accepted.
  assert.equal(planSvgArtboard(SVG, { width: ARTBOARD_MIN, height: ARTBOARD_MIN }).ok ?? true, true)
})

test('malformed artboards and non-standard aspect ratios are refused before any write', () => {
  const cases = [
    ['<svg viewBox="0 0 240"></svg>', 'invalid-viewbox'],
    ['<svg viewBox="0 0 240 abc"></svg>', 'invalid-viewbox'],
    ['<svg viewBox="0 0 0 160"></svg>', 'invalid-viewbox'],
    ['<svg viewBox="0 0 -20 160"></svg>', 'invalid-viewbox'],
    ['<svg viewBox="0 0 240 160" preserveAspectRatio="none"></svg>', 'unsupported-aspect-ratio'],
    ['<svg><rect id="a"/></svg>', 'unresolvable-artboard'],
    ['<html><body>not svg</body></html>', 'unsupported-svg'],
  ]
  for (const [source, code] of cases) {
    assert.throws(() => planSvgArtboard(source, { width: 300, height: 160, scaleContent: true }),
      (error) => error.code === code, source + ' must be refused with ' + code)
  }
  // The display mode alone needs an existing viewBox: the explicit content mode
  // is allowed to add one (covered below), the display mode must refuse.
  assert.throws(() => planSvgArtboard('<svg width="300" height="160"><rect id="a"/></svg>',
    { width: 300, height: 160 }), (error) => error.code === 'missing-viewbox')
  // A percentage root has no absolute size: the artboard cannot be resolved.
  assert.equal(inspectSvgArtboard('<svg width="100%" height="100%"></svg>').reason,
    'unresolvable-artboard')
})

test('an identical size is refused instead of producing an empty transaction', () => {
  assert.throws(() => planSvgArtboard(SVG, { width: 240, height: 160 }),
    (error) => error.code === 'no-change')
  assert.throws(() => planSvgArtboard(SVG, { width: 240, height: 160, scaleContent: true }),
    (error) => error.code === 'no-change')
})

test('the declared size and the viewBox extent stay distinct', () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 200 100">' +
    '<rect id="r" x="10" y="10" width="20" height="20"/></svg>'
  const info = inspectSvgArtboard(source)
  assert.equal(info.width, 600, 'the inspector shows the declared size')
  assert.equal(info.height, 400)
  assert.equal(info.viewBoxWidth, 200, 'the coordinate system remains addressable')
  assert.equal(info.viewBoxHeight, 100)
  const plan = planSvgArtboard(source, { width: 800, height: 400 })
  assert.equal(apply(source, plan.patches).source, source.replace('width="600"', 'width="800"'),
    'a display resize never rewrites the viewBox extent')
})

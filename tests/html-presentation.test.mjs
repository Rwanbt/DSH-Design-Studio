import test from 'node:test'
import assert from 'node:assert/strict'
import { appendHtmlSlide, createHtmlPresentation, duplicateHtmlSlide, readHtmlPresentation, reorderHtmlSlide } from '../src/html-presentation.mjs'
import { applyNativePatches, sourceHash } from '../src/native-patch.mjs'

function apply(source, ...patches) {
  const result = applyNativePatches({ source, format: 'html', baseHash: sourceHash(source), patches })
  assert.equal(result.ok, true)
  return result
}

test('native HTML presentation supports ten slides and exact undo for each operation', () => {
  const original = createHtmlPresentation()
  let source = original
  for (let index = 1; index <= 9; index += 1) {
    const result = apply(source, appendHtmlSlide(source, { id: 'slide-page-' + index, title: 'Title <&>' }))
    assert.equal(apply(result.source, ...result.inverse).source, source)
    source = result.source
  }
  const slides = readHtmlPresentation(source).slides.map(slide => slide.id)
  assert.equal(slides.length, 10)
  assert.match(source, /Title &lt;&amp;&gt;/)
  const reorder = apply(source, reorderHtmlSlide(source, { id: slides[1], direction: 'earlier' }))
  assert.deepEqual(readHtmlPresentation(reorder.source).slides.map(slide => slide.id),
    [slides[1], slides[0], ...slides.slice(2)])
  assert.equal(apply(reorder.source, ...reorder.inverse).source, source)
})

test('presentation structures with unmapped siblings and duplicate IDs are refused', () => {
  const source = createHtmlPresentation()
  assert.throws(() => readHtmlPresentation(source.replace('</main>', '<p>Other content</p></main>')),
    { code: 'unsupported-presentation' })
  assert.throws(() => appendHtmlSlide(source, { id: 'slide-intro', title: 'Duplicate' }), { code: 'duplicate-id' })
  assert.throws(() => reorderHtmlSlide(source, { id: 'slide-intro', direction: 'earlier' }), { code: 'slide-at-boundary' })
})

test('duplication preserves markup and remaps internal references in a single reversible insertion', () => {
  const source = '<main id="dsh-deck" data-dsh-deck="1">\n' +
    '<section id="slide-one" aria-labelledby="label"><h1 id="label">Title</h1>' +
    '<a href="#label" aria-describedby="label shared">Jump</a>' +
    '<svg><defs><linearGradient id="paint"></linearGradient></defs>' +
    '<rect fill="url(#paint)" width="20" height="20" /></svg></section>\n</main>'
  const result = apply(source, duplicateHtmlSlide(source, { id: 'slide-one', newId: 'slide-two' }))
  assert.deepEqual(readHtmlPresentation(result.source).slides.map(item => item.id), ['slide-one', 'slide-two'])
  assert.match(result.source, /id="slide-two" aria-labelledby="slide-two-1"/)
  assert.match(result.source, /href="#slide-two-1" aria-describedby="slide-two-1 shared"/)
  assert.match(result.source, /fill="url\(#slide-two-2\)"/)
  assert.equal(apply(result.source, ...result.inverse).source, source)
  assert.throws(() => duplicateHtmlSlide(source, { id: 'slide-one', newId: 'slide-one' }), { code: 'duplicate-id' })
})

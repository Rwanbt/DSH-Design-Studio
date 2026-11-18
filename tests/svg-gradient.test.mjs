/**
 * Level 1 — edit one existing stop attribute of an SVG gradient.
 *
 * Every accepted edit is applied through the real patch engine
 * (`applyNativePatches`), so the value-only span and its byte-exact inverse are
 * proven, not assumed. Every refusal is typed, returns no patch and never
 * touches a byte; the raw source is compared after each refusal.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyNativePatches, sourceHash } from '../src/native-patch.mjs'
import { listSvgGradients, svgGradientStopPatch } from '../src/svg-gradient.mjs'
import { scanSvgDocument } from '../src/svg-document.mjs'

const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
  <defs>
    <!-- gradients keep comments and unrelated bytes -->
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#102030" stop-opacity="1"/>
      <stop offset="0.55" stop-color="#405060"/>
      <stop offset="100%" stop-color="#8090a0" stop-opacity="0.8"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".9"/>
      <stop offset="1" stop-color="none"/>
    </radialGradient>
    <linearGradient id="inherited" href="#sky" x1="0" y1="0" x2="1" y2="1"/>
    <linearGradient id="styled" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" style="stop-color:#ff0000"/>
      <stop offset="1" stop-color="#00ff00"/>
    </linearGradient>
    <linearGradient id="encoded" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="&#35;ff0000"/>
    </linearGradient>
    <linearGradient x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#123456"/>
    </linearGradient>
  </defs>
  <rect id="panel" x="10" y="10" width="40" height="30" fill="url(#sky)"/>
  <rect id="tile" x="60" y="10" width="40" height="30" fill="url(#sky)"/>
  <circle id="orb" cx="120" cy="30" r="12" fill="url(#glow)"/>
</svg>
`

function apply(source, patches) {
  return applyNativePatches({ source, format: 'svg', baseHash: sourceHash(source), patches })
}

/** Single differing range between two strings, proving no other byte moved. */
function diff(before, after) {
  const limit = Math.min(before.length, after.length)
  let prefix = 0
  while (prefix < limit && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (suffix < limit - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1
  return { prefix, suffix,
    before: before.slice(prefix, before.length - suffix),
    after: after.slice(prefix, after.length - suffix) }
}

function refusal(source, request) {
  try {
    svgGradientStopPatch(source, request)
  } catch (error) {
    return error.code
  }
  assert.fail('expected a typed refusal for ' + JSON.stringify(request))
}

test('lists addressable gradients with their stops, spans, references and refusals', () => {
  const gradients = listSvgGradients(SVG)
  const byId = Object.fromEntries(gradients.map((gradient) => [gradient.id, gradient]))
  assert.deepEqual(gradients.map((gradient) => gradient.id), ['sky', 'glow', 'inherited', 'styled', 'encoded'],
    'only addressable (valid unique id) gradients are listed, in document order')
  assert.equal(byId.sky.type, 'linear')
  assert.equal(byId.glow.type, 'radial')
  assert.equal(byId.sky.usable, true)
  assert.equal(byId.sky.reason, null)
  assert.deepEqual(byId.sky.referencedBy, ['panel', 'tile'])
  assert.deepEqual(byId.glow.referencedBy, ['orb'])
  assert.deepEqual(byId.inherited.referencedBy, [])

  const [first, second, third] = byId.sky.stops
  assert.deepEqual({ index: first.index, offset: first.offset, color: first.color, opacity: first.opacity },
    { index: 0, offset: '0', color: '#102030', opacity: '1' })
  assert.equal(second.opacity, null, 'an absent attribute is reported as null, never invented')
  assert.equal(third.offset, '100%', 'percentages are returned exactly as written')
  assert.deepEqual(first.colorSpan, {
    start: SVG.indexOf('stop-color="#102030"') + 'stop-color="'.length,
    end: SVG.indexOf('stop-color="#102030"') + 'stop-color="#102030'.length,
  })
  assert.equal(first.offsetSpan.start, SVG.indexOf('offset="0"') + 'offset="'.length)
  assert.equal(first.opacitySpan.end - first.opacitySpan.start, 1)

  assert.equal(byId.inherited.usable, false)
  assert.equal(byId.inherited.reason, 'inherited-gradient')
  assert.deepEqual(byId.inherited.stops, [])
  assert.equal(byId.styled.usable, false)
  assert.equal(byId.styled.reason, 'ambiguous-style')
  assert.equal(byId.encoded.usable, false)
  assert.equal(byId.encoded.reason, 'encoded-attribute')

  const empty = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="blank"/></defs></svg>'
  assert.deepEqual(listSvgGradients(empty)[0].reason, 'no-stops')
  assert.equal(listSvgGradients(empty)[0].usable, false)
})

test('one stop-color edit changes only that value and its inverse restores every byte', () => {
  const patch = svgGradientStopPatch(SVG, { gradientId: 'sky', index: 1, attribute: 'stop-color', value: '#aabbcc' })
  assert.deepEqual(patch, {
    start: SVG.indexOf('stop-color="#405060"') + 'stop-color="'.length,
    end: SVG.indexOf('stop-color="#405060"') + 'stop-color="#405060'.length,
    before: '#405060',
    after: '#aabbcc',
  })
  const written = apply(SVG, [patch])
  assert.equal(written.ok, true)
  assert.equal(written.source, SVG.replace('<stop offset="0.55" stop-color="#405060"/>',
    '<stop offset="0.55" stop-color="#aabbcc"/>'))
  const window = diff(SVG, written.source)
  // The shared '#' is outside the differing range: only the six hex digits moved.
  assert.equal(window.before, '405060')
  assert.equal(window.after, 'aabbcc')
  assert.equal(window.prefix + window.suffix + window.before.length, SVG.length)
  assert.equal(window.prefix + window.suffix + window.after.length, written.source.length)
  assert.ok(written.source.includes('<!-- gradients keep comments and unrelated bytes -->'))
  assert.ok(written.source.includes('stop-color="#102030"'), 'the other stops are untouched')

  const undone = apply(written.source, written.inverse)
  assert.equal(undone.ok, true)
  assert.equal(undone.source, SVG, 'the inverse restores the original bytes exactly')
})

test('offset percentages and opacity keep their written form', () => {
  const cases = [
    [{ index: 0, attribute: 'offset', value: '0.25' }, 'offset="0"', 'offset="0.25"'],
    [{ index: 2, attribute: 'offset', value: '75%' }, 'offset="100%"', 'offset="75%"'],
    [{ index: 2, attribute: 'stop-opacity', value: '0.35' }, 'stop-opacity="0.8"', 'stop-opacity="0.35"'],
  ]
  for (const [request, from, to] of cases) {
    const patch = svgGradientStopPatch(SVG, { gradientId: 'sky', ...request })
    assert.equal(patch.before, from.slice(from.indexOf('"') + 1, -1))
    const written = apply(SVG, [patch])
    assert.equal(written.ok, true, JSON.stringify(patch))
    assert.equal(written.source, SVG.replace(from, to), JSON.stringify(request))
    assert.equal(apply(written.source, written.inverse).source, SVG, 'inverse is exact for ' + JSON.stringify(request))
  }
})

test('every refusal is typed, returns no patch and writes nothing', () => {
  const cases = [
    [{ gradientId: 'missing', index: 0, attribute: 'stop-color', value: '#ffffff' }, 'unknown-gradient'],
    [{ gradientId: 'panel', index: 0, attribute: 'stop-color', value: '#ffffff' }, 'unknown-gradient'],
    [{ gradientId: 'inherited', index: 0, attribute: 'stop-color', value: '#ffffff' }, 'inherited-gradient'],
    [{ gradientId: 'styled', index: 1, attribute: 'stop-color', value: '#ffffff' }, 'ambiguous-style'],
    [{ gradientId: 'encoded', index: 0, attribute: 'stop-color', value: '#ffffff' }, 'encoded-attribute'],
    [{ gradientId: 'sky', index: 3, attribute: 'stop-color', value: '#ffffff' }, 'index-out-of-range'],
    [{ gradientId: 'sky', index: -1, attribute: 'stop-color', value: '#ffffff' }, 'invalid-target'],
    [{ gradientId: 'sky', index: 1, attribute: 'stop-opacity', value: '0.5' }, 'missing-attribute'],
    [{ gradientId: 'sky', index: 0, attribute: 'fill', value: '#ffffff' }, 'invalid-target'],
    [{ gradientId: 'sky', index: 0, attribute: 'stop-color', value: '#102030' }, 'unchanged'],
    [{ gradientId: 'sky', index: 0, attribute: 'stop-color', value: 'red' }, 'invalid-value'],
    [{ gradientId: 'sky', index: 0, attribute: 'stop-color', value: '#12345' }, 'invalid-value'],
    [{ gradientId: 'sky', index: 0, attribute: 'stop-opacity', value: '1.2' }, 'invalid-value'],
    [{ gradientId: 'sky', index: 0, attribute: 'stop-opacity', value: '-0.2' }, 'invalid-value'],
    [{ gradientId: 'sky', index: 0, attribute: 'stop-opacity', value: '50%' }, 'invalid-value'],
    [{ gradientId: 'sky', index: 0, attribute: 'offset', value: '1.5' }, 'invalid-value'],
    [{ gradientId: 'sky', index: 0, attribute: 'offset', value: '150%' }, 'invalid-value'],
    [{ gradientId: 'sky', index: 0, attribute: 'offset', value: '-10%' }, 'invalid-value'],
    [{ gradientId: 'bad id', index: 0, attribute: 'stop-color', value: '#ffffff' }, 'invalid-target'],
    [{ gradientId: 'sky', index: 0, attribute: 'stop-color', value: '' }, 'invalid-value'],
  ]
  for (const [request, code] of cases) {
    assert.equal(refusal(SVG, request), code, JSON.stringify(request))
  }
  // The source is a frozen input in every case: a refusal cannot mutate a string.
  assert.equal(SVG.includes('stop-color="#102030"'), true)
})

test('an ambiguous id and an unstructurable document are refused, never guessed', () => {
  const duplicate = `<svg xmlns="http://www.w3.org/2000/svg"><defs>
    <linearGradient id="g"><stop offset="0" stop-color="#111111"/></linearGradient>
    <linearGradient id="g"><stop offset="0" stop-color="#222222"/></linearGradient>
  </defs></svg>`
  assert.throws(() => listSvgGradients(duplicate), (error) => error.code === 'ambiguous-gradient')
  assert.equal(refusal(duplicate, { gradientId: 'g', index: 0, attribute: 'stop-color', value: '#ffffff' }),
    'ambiguous-gradient')

  const unclosed = `<svg xmlns="http://www.w3.org/2000/svg"><defs>
    <linearGradient id="g"><stop offset="0" stop-color="#111111"/></linearGradient>`
  assert.throws(() => listSvgGradients(unclosed), (error) => error.code === 'structure-unavailable')
  assert.equal(refusal(unclosed, { gradientId: 'g', index: 0, attribute: 'stop-color', value: '#ffffff' }),
    'structure-unavailable')

  // A gradient without a valid unique id is not addressable and never listed.
  const anonymous = '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient><stop offset="0" stop-color="#111111"/></linearGradient></defs></svg>'
  assert.deepEqual(listSvgGradients(anonymous), [])
})

test('a shared scan produces the same listing as an internal scan', () => {
  // The Host reuses the layer scan it already performed, so the two entry
  // points must be indistinguishable.
  assert.deepEqual(listSvgGradients(SVG, { scan: scanSvgDocument(SVG) }), listSvgGradients(SVG))
  assert.deepEqual(listSvgGradients(SVG, { scan: null }), listSvgGradients(SVG))
})

test('a document style sheet makes every gradient non-writable instead of silently inert', () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg"><style>#g stop { stop-color: #00ff00 }</style>' +
    '<defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/></linearGradient></defs>' +
    '<rect id="r" width="10" height="10" fill="url(#g)"/></svg>'
  const [gradient] = listSvgGradients(source)
  assert.equal(gradient.usable, false)
  assert.equal(gradient.reason, 'document-styles')
  assert.throws(() => svgGradientStopPatch(source, {
    gradientId: 'g', index: 0, attribute: 'stop-color', value: '#0000ff',
  }), (error) => error.code === 'document-styles' || error.code === 'invalid-gradient')
})

test('an XML-encoded id anywhere in the document refuses every gradient', () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
    '<linearGradient id="sk&#121;"><stop offset="0" stop-color="#111111"/></linearGradient>' +
    '<linearGradient id="sky"><stop offset="0" stop-color="#222222"/></linearGradient>' +
    '</defs><rect id="r" width="10" height="10" fill="url(#sky)"/></svg>'
  const listed = listSvgGradients(source)
  assert.equal(listed.length, 1, 'the literal id is still listed')
  assert.equal(listed[0].usable, false)
  assert.equal(listed[0].reason, 'encoded-id')
})

test('stop-color `none` is refused because both engines render it black', () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
    '<linearGradient id="g"><stop offset="0" stop-color="#ff0000"/></linearGradient></defs></svg>'
  assert.throws(() => svgGradientStopPatch(source, {
    gradientId: 'g', index: 0, attribute: 'stop-color', value: 'none',
  }), (error) => error.code === 'invalid-value')
  for (const value of ['#abc', '#a1b2c3']) {
    const patch = svgGradientStopPatch(source, { gradientId: 'g', index: 0, attribute: 'stop-color', value })
    assert.equal(patch.end - patch.start > 0, true)
  }
})

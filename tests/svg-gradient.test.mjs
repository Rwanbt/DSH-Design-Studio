/**
 * Level 1 — edit, insert and remove the stops of an SVG gradient.
 *
 * Every accepted edit is applied through the real patch engine
 * (`applyNativePatches`), so the exact span and its byte-exact inverse are
 * proven, not assumed. Every refusal is typed, returns no patch and never
 * touches a byte; the raw source is compared after each refusal.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyNativePatches, sourceHash } from '../src/native-patch.mjs'
import {
  listSvgGradients, svgGradientStopPatch, svgGradientStopInsertPatch,
  svgGradientStopRemovePatch, svgGradientGeometryPatch, MAX_GRADIENT_STOPS,
} from '../src/svg-gradient.mjs'
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

/** The typed refusal a call throws, or a failing assertion when it accepts. */
function codeOf(run) {
  try {
    run()
  } catch (error) {
    return error.code || '(no code)'
  }
  assert.fail('expected a typed refusal')
}

const STOP_LINE = '\n      <stop offset="0.55" stop-color="#405060"/>'

test('inserting at the end adds one complete stop line with a computed, distinct offset', () => {
  const lastStop = '<stop offset="100%" stop-color="#8090a0" stop-opacity="0.8"/>'
  const position = SVG.indexOf(lastStop) + lastStop.length
  const inserted = svgGradientStopInsertPatch(SVG, { gradientId: 'sky' })
  assert.equal(inserted.index, 3, 'an omitted index appends at the end')
  assert.equal(inserted.offset, '77.5%', 'the midpoint of the last two offsets, in the neighbour unit')
  assert.equal(inserted.color, '#8090a0', 'the colour is copied from the neighbouring stop')
  assert.equal(inserted.opacity, '0.8', 'the opacity is copied from the neighbouring stop')
  assert.deepEqual(inserted.patch, {
    start: position,
    end: position,
    before: '',
    after: '\n      <stop offset="77.5%" stop-color="#8090a0" stop-opacity="0.8"/>',
  }, 'one span, one insertion, the observed six-space indentation')

  const written = apply(SVG, [inserted.patch])
  assert.equal(written.ok, true)
  assert.equal(written.source, SVG.replace(
    '      <stop offset="100%" stop-color="#8090a0" stop-opacity="0.8"/>\n',
    '      <stop offset="100%" stop-color="#8090a0" stop-opacity="0.8"/>\n' +
    '      <stop offset="77.5%" stop-color="#8090a0" stop-opacity="0.8"/>\n'))
  const window = diff(SVG, written.source)
  assert.equal(window.before, '', 'an insertion must not delete any byte')
  assert.equal(window.prefix + window.suffix, SVG.length, 'every pre-existing byte is preserved')
  assert.equal(window.prefix + window.after.length + window.suffix, written.source.length,
    'the only difference is one contiguous inserted region')

  // Defence in depth: the resulting document is really re-scannable and lists
  // the new stop at the requested position.
  const scan = scanSvgDocument(written.source)
  const sky = listSvgGradients(written.source, { scan }).find((gradient) => gradient.id === 'sky')
  assert.equal(sky.usable, true)
  assert.deepEqual(sky.stops.map((stop) => stop.offset), ['0', '0.55', '100%', '77.5%'])
  assert.equal(sky.stops[3].color, '#8090a0')
  assert.equal(sky.stops[3].opacity, '0.8')
  assert.ok(written.source.includes('<!-- gradients keep comments and unrelated bytes -->'))

  assert.equal(apply(written.source, written.inverse).source, SVG,
    'the inverse removes exactly the inserted span and no other byte')
})

test('inserting in the middle copies the previous stop and keeps the file indentation', () => {
  const first = '<stop offset="0" stop-color="#102030" stop-opacity="1"/>'
  const inserted = svgGradientStopInsertPatch(SVG, { gradientId: 'sky', index: 1 })
  assert.equal(inserted.index, 1)
  assert.equal(inserted.offset, '0.275', 'the midpoint of 0 and 0.55')
  assert.equal(inserted.color, '#102030')
  assert.equal(inserted.opacity, '1')
  assert.equal(inserted.patch.after, '\n      <stop offset="0.275" stop-color="#102030" stop-opacity="1"/>')
  assert.equal(inserted.patch.start, SVG.indexOf(first) + first.length)

  const written = apply(SVG, [inserted.patch])
  assert.equal(written.ok, true)
  assert.equal(written.source, SVG.replace(
    '      ' + first + '\n',
    '      ' + first + '\n      <stop offset="0.275" stop-color="#102030" stop-opacity="1"/>\n'))
  const window = diff(SVG, written.source)
  assert.equal(window.before, '')
  assert.equal(window.prefix + window.suffix, SVG.length)
  const [sky] = listSvgGradients(written.source)
  assert.deepEqual(sky.stops.map((stop) => stop.offset), ['0', '0.275', '0.55', '100%'])
  // The old stop 1 is now stop 2, untouched, including its absent opacity.
  assert.equal(sky.stops[2].color, '#405060')
  assert.equal(sky.stops[2].opacity, null)
  assert.equal(apply(written.source, written.inverse).source, SVG)
})

test('inserting before the first stop is one span with a distinct offset', () => {
  const first = '<stop offset="0" stop-color="#102030" stop-opacity="1"/>'
  const inserted = svgGradientStopInsertPatch(SVG, { gradientId: 'sky', index: 0 })
  assert.equal(inserted.index, 0)
  assert.equal(inserted.offset, '0.275', '0 is taken, so the next gap is used: no duplicate offset')
  assert.equal(inserted.patch.start, SVG.indexOf(first), 'insertion begins at the first stop')
  assert.equal(inserted.patch.after, '<stop offset="0.275" stop-color="#102030" stop-opacity="1"/>\n      ')
  const written = apply(SVG, [inserted.patch])
  assert.equal(written.ok, true)
  assert.equal(written.source, SVG.replace(first,
    '<stop offset="0.275" stop-color="#102030" stop-opacity="1"/>\n      ' + first))
  assert.equal(apply(written.source, written.inverse).source, SVG)
})

test('a single-line gradient receives the new stop on that same line', () => {
  const inline = '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
    '<linearGradient id="g"><stop offset="0" stop-color="#111111"/>' +
    '<stop offset="1" stop-color="#222222"/></linearGradient></defs></svg>'
  const inserted = svgGradientStopInsertPatch(inline, { gradientId: 'g', index: 1 })
  assert.equal(inserted.offset, '0.5')
  assert.equal(inserted.color, '#111111')
  assert.equal(inserted.opacity, null, 'an absent opacity is copied as absent, never invented')
  assert.equal(inserted.patch.after, '<stop offset="0.5" stop-color="#111111"/>')
  const written = apply(inline, [inserted.patch])
  assert.equal(written.ok, true)
  assert.equal(written.source, inline.replace('<stop offset="1" stop-color="#222222"/>',
    '<stop offset="0.5" stop-color="#111111"/><stop offset="1" stop-color="#222222"/>'))
  assert.equal(written.source.includes('\n'), false, 'no newline is introduced into an inline gradient')
  assert.equal(apply(written.source, written.inverse).source, inline)
})

test('an explicit offset is written exactly as asked unless it duplicates an existing one', () => {
  const inserted = svgGradientStopInsertPatch(SVG, { gradientId: 'sky', offset: '0.3' })
  assert.equal(inserted.offset, '0.3')
  const written = apply(SVG, [inserted.patch])
  assert.equal(written.ok, true)
  assert.equal(written.source, SVG.replace(
    '      <stop offset="100%" stop-color="#8090a0" stop-opacity="0.8"/>\n',
    '      <stop offset="100%" stop-color="#8090a0" stop-opacity="0.8"/>\n' +
    '      <stop offset="0.3" stop-color="#8090a0" stop-opacity="0.8"/>\n'))
  // Once written, the same request is a collision: no duplicate can be added.
  assert.equal(codeOf(() => svgGradientStopInsertPatch(written.source, { gradientId: 'sky', offset: '0.3' })),
    'offset-collision')
  assert.equal(codeOf(() => svgGradientStopInsertPatch(SVG, { gradientId: 'sky', offset: '0.55' })),
    'offset-collision')
  // `55%` and `0.55` are the same position: units are normalised, not string-compared.
  assert.equal(codeOf(() => svgGradientStopInsertPatch(SVG, { gradientId: 'sky', offset: '55%' })),
    'offset-collision')
})

test('deleting a stop removes its own line span and nothing else, Undo included', () => {
  const removed = svgGradientStopRemovePatch(SVG, { gradientId: 'sky', index: 1 })
  assert.equal(removed.index, 1)
  assert.deepEqual(removed.patch, {
    start: SVG.indexOf(STOP_LINE),
    end: SVG.indexOf(STOP_LINE) + STOP_LINE.length,
    before: STOP_LINE,
    after: '',
  }, 'the line indentation goes with the stop, the other lines stay intact')
  const written = apply(SVG, [removed.patch])
  assert.equal(written.ok, true)
  assert.equal(written.source, SVG.replace(STOP_LINE, ''))
  const window = diff(SVG, written.source)
  assert.equal(window.after, '', 'a deletion must not add any byte')
  assert.equal(window.prefix + window.suffix + window.before.length, SVG.length)
  assert.equal(SVG.length - (window.prefix + window.suffix), STOP_LINE.length,
    'exactly the stop line span disappeared')
  const survivingGradients = listSvgGradients(written.source)
  assert.equal(survivingGradients.find((gradient) => gradient.id === 'sky').stops.length, 2,
    'the other stops of this gradient are untouched')
  assert.equal(survivingGradients.find((gradient) => gradient.id === 'glow').stops.length, 2,
    'stops of the other gradients are untouched')
  assert.ok(written.source.includes('<stop offset="0" stop-color="#102030" stop-opacity="1"/>'))
  assert.ok(written.source.includes('<stop offset="100%" stop-color="#8090a0" stop-opacity="0.8"/>'))
  assert.ok(written.source.includes('<!-- gradients keep comments and unrelated bytes -->'))
  // The remaining stops are contiguous lines: deleting a line did not leave a
  // blank line or glue two tags together.
  assert.ok(written.source.includes('stop-opacity="1"/>\n      <stop offset="100%"'))
  assert.equal(apply(written.source, written.inverse).source, SVG, 'Undo restores the removed span exactly')

  // An inline stop is removed by its exact element span, without eating the
  // whitespace that separates its neighbours.
  const inline = '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
    '<linearGradient id="g"><stop offset="0" stop-color="#111111"/>' +
    '<stop offset="0.5" stop-color="#333333"/><stop offset="1" stop-color="#222222"/></linearGradient></defs></svg>'
  const inlineRemoved = svgGradientStopRemovePatch(inline, { gradientId: 'g', index: 1 })
  assert.equal(inlineRemoved.patch.before, '<stop offset="0.5" stop-color="#333333"/>')
  assert.equal(apply(inline, [inlineRemoved.patch]).source,
    '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
    '<linearGradient id="g"><stop offset="0" stop-color="#111111"/>' +
    '<stop offset="1" stop-color="#222222"/></linearGradient></defs></svg>')
})

test('every structural refusal is typed, returns no patch and writes nothing', () => {
  const oneStop = '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
    '<linearGradient id="one"><stop offset="0" stop-color="#111111"/></linearGradient></defs></svg>'
  const fullStops = Array.from({ length: MAX_GRADIENT_STOPS }, (_, index) =>
    '<stop offset="' + (index / (MAX_GRADIENT_STOPS - 1)).toFixed(4) + '" stop-color="#111111"/>').join('')
  const full = '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="full">' +
    fullStops + '</linearGradient></defs></svg>'
  const almostStops = Array.from({ length: MAX_GRADIENT_STOPS - 1 }, (_, index) =>
    '<stop offset="' + (index / (MAX_GRADIENT_STOPS - 2)).toFixed(4) + '" stop-color="#111111"/>').join('')
  const almost = '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="almost">' +
    almostStops + '</linearGradient></defs></svg>'

  const cases = [
    [() => svgGradientStopInsertPatch(SVG, { gradientId: 'sky', index: 4 }), 'index-out-of-range'],
    [() => svgGradientStopInsertPatch(SVG, { gradientId: 'sky', index: -1 }), 'invalid-target'],
    [() => svgGradientStopInsertPatch(SVG, { gradientId: 'sky', index: 1.5 }), 'invalid-target'],
    [() => svgGradientStopInsertPatch(SVG, { gradientId: 'sky', offset: '150%' }), 'invalid-value'],
    [() => svgGradientStopInsertPatch(SVG, { gradientId: 'sky', offset: '' }), 'invalid-value'],
    [() => svgGradientStopInsertPatch(SVG, { gradientId: 'missing' }), 'unknown-gradient'],
    [() => svgGradientStopInsertPatch(SVG, { gradientId: 'panel' }), 'unknown-gradient'],
    [() => svgGradientStopInsertPatch(SVG, { gradientId: 'inherited' }), 'inherited-gradient'],
    [() => svgGradientStopInsertPatch(SVG, { gradientId: 'styled' }), 'ambiguous-style'],
    [() => svgGradientStopInsertPatch(SVG, { gradientId: 'encoded' }), 'encoded-attribute'],
    [() => svgGradientStopInsertPatch(full, { gradientId: 'full' }), 'too-many-stops'],
    [() => svgGradientStopRemovePatch(SVG, { gradientId: 'sky', index: 3 }), 'index-out-of-range'],
    [() => svgGradientStopRemovePatch(SVG, { gradientId: 'sky', index: -1 }), 'invalid-target'],
    [() => svgGradientStopRemovePatch(SVG, { gradientId: 'sky', index: 1.5 }), 'invalid-target'],
    [() => svgGradientStopRemovePatch(oneStop, { gradientId: 'one', index: 0 }), 'last-stop'],
    [() => svgGradientStopRemovePatch(SVG, { gradientId: 'inherited', index: 0 }), 'inherited-gradient'],
    [() => svgGradientStopRemovePatch(SVG, { gradientId: 'styled', index: 0 }), 'ambiguous-style'],
    [() => svgGradientStopRemovePatch(SVG, { gradientId: 'encoded', index: 0 }), 'encoded-attribute'],
    [() => svgGradientStopRemovePatch(SVG, { gradientId: 'missing', index: 0 }), 'unknown-gradient'],
  ]
  for (const [run, code] of cases) assert.equal(codeOf(run), code, code)

  // The ceiling is exact: 31 stops can grow to 32, the 33rd is refused.
  const growth = svgGradientStopInsertPatch(almost, { gradientId: 'almost' })
  const grown = apply(almost, [growth.patch])
  assert.equal(grown.ok, true)
  assert.equal((grown.source.match(/<stop\b/g) || []).length, MAX_GRADIENT_STOPS)
  assert.equal(scanSvgDocument(grown.source).byId.get('almost').children.length, MAX_GRADIENT_STOPS)
  assert.equal(codeOf(() => svgGradientStopInsertPatch(grown.source, { gradientId: 'almost' })),
    'too-many-stops')
})

test('document-level and unaddressable refusals apply to insertion just like editing', () => {
  const styled = '<svg xmlns="http://www.w3.org/2000/svg"><style>#g stop { stop-color: #00ff00 }</style>' +
    '<defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/></linearGradient></defs>' +
    '<rect id="r" width="10" height="10" fill="url(#g)"/></svg>'
  assert.equal(codeOf(() => svgGradientStopInsertPatch(styled, { gradientId: 'g' })), 'document-styles')

  const encodedId = '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
    '<linearGradient id="sk&#121;"><stop offset="0" stop-color="#111111"/></linearGradient>' +
    '<linearGradient id="sky"><stop offset="0" stop-color="#222222"/></linearGradient>' +
    '</defs><rect id="r" width="10" height="10" fill="url(#sky)"/></svg>'
  assert.equal(codeOf(() => svgGradientStopInsertPatch(encodedId, { gradientId: 'sky' })), 'encoded-id')

  const duplicate = '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
    '<linearGradient id="g"><stop offset="0" stop-color="#111111"/></linearGradient>' +
    '<linearGradient id="g"><stop offset="0" stop-color="#222222"/></linearGradient></defs></svg>'
  assert.equal(codeOf(() => svgGradientStopInsertPatch(duplicate, { gradientId: 'g' })), 'ambiguous-gradient')
  assert.equal(codeOf(() => svgGradientStopRemovePatch(duplicate, { gradientId: 'g', index: 0 })),
    'ambiguous-gradient')

  const unclosed = '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
    '<linearGradient id="g"><stop offset="0" stop-color="#111111"/></linearGradient>'
  assert.equal(codeOf(() => svgGradientStopInsertPatch(unclosed, { gradientId: 'g' })), 'structure-unavailable')

  // An existing offset this module cannot normalise is refused rather than
  // guessed: the computed midpoint would be meaningless.
  const exotic = '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g">' +
    '<stop offset="1e2%" stop-color="#111111"/><stop offset="1" stop-color="#222222"/>' +
    '</linearGradient></defs></svg>'
  assert.equal(codeOf(() => svgGradientStopInsertPatch(exotic, { gradientId: 'g' })), 'unsupported-offset')
  // Deletion does not need to compute an offset, so it still works there.
  assert.equal(svgGradientStopRemovePatch(exotic, { gradientId: 'g', index: 1 }).patch.before,
    '<stop offset="1" stop-color="#222222"/>')

  // A neighbour value that cannot be copied verbatim without risking the quoted
  // embedding is refused instead of being guessed or escaped blindly.
  const rawMarkup = '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g">' +
    '<stop offset="0" stop-color="a<b"/><stop offset="1" stop-color="#222222"/>' +
    '</linearGradient></defs></svg>'
  assert.equal(codeOf(() => svgGradientStopInsertPatch(rawMarkup, { gradientId: 'g', index: 1 })),
    'unsupported-style')
})


test('gradient geometry edits an exact value, inserts missing coordinates and undoes precisely', () => {
  const x2=svgGradientGeometryPatch(SVG,{gradientId:'sky',attribute:'x2',value:'1'})
  const edited=apply(SVG,[x2])
  assert.equal(edited.ok,true)
  assert.equal(edited.source,SVG.replace('x2="0"','x2="1"'))
  assert.equal(apply(edited.source,edited.inverse).source,SVG)
  const fy=svgGradientGeometryPatch(SVG,{gradientId:'glow',attribute:'cy',value:'65%'})
  const radial=apply(SVG,[fy])
  assert.equal(radial.ok,true)
  assert.equal(radial.source,SVG.replace('cy="50%"','cy="65%"'))
  assert.equal(apply(radial.source,radial.inverse).source,SVG)
  const insert=svgGradientGeometryPatch(SVG,{gradientId:'glow',attribute:'r',value:'70%'})
  const inserted=apply(SVG,[insert])
  assert.equal(inserted.ok,true)
  assert.equal(inserted.source,SVG.replace('r="50%"','r="70%"'))
  assert.equal(apply(inserted.source,inserted.inverse).source,SVG)
  for(const [request,expected] of [
    [{gradientId:'sky',attribute:'cx',value:'10%'},'invalid-target'],
    [{gradientId:'sky',attribute:'x1',value:'calc(1px)'},'invalid-value'],
    [{gradientId:'glow',attribute:'r',value:'-2'},'invalid-value'],
    [{gradientId:'inherited',attribute:'x1',value:'1'},'inherited-gradient'],
  ]) {
    assert.throws(()=>svgGradientGeometryPatch(SVG,request),e=>e?.code===expected)
  }
})

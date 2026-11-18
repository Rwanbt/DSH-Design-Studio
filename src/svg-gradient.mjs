/**
 * Edit the `<stop>` children of a linear or radial SVG gradient.
 *
 * Three gestures share one contract — one exact `{start, end, before, after}`
 * span patch, so `applyNativePatches` builds a byte-identical inverse and Undo
 * restores every quote and every unrelated byte:
 *
 *  - `svgGradientStopPatch`: replace one **existing** attribute value;
 *  - `svgGradientStopInsertPatch`: insert ONE complete `<stop>` element at a
 *    requested index (or at the end), copying the neighbouring stop's colour and
 *    opacity and computing a distinct offset, with the indentation observed in
 *    the gradient's existing content;
 *  - `svgGradientStopRemovePatch`: remove the exact span of ONE stop (plus its
 *    leading line indentation when it sits alone on its line).
 *
 * Attributes are never inserted on an existing stop, the XML tree is never
 * re-serialised, and the result of an insertion/removal is re-scanned: a patch
 * that would no longer parse is refused (`invalid-result`) before any write.
 *
 * The default answer is refusal, typed and without any write:
 *  - the gradient id is unknown, malformed, or does not address a gradient;
 *  - the document cannot be structurally scanned (`structure-unavailable`) or
 *    contains duplicate ids (`ambiguous-gradient`), so the id is not addressable;
 *  - the gradient inherits from another gradient through `href`/`xlink:href`
 *    (any `*:href` local name): its stop attributes are not defined locally and
 *    this editor does not resolve gradient inheritance;
 *  - a stop carries a `style` attribute: the source of truth for a presentation
 *    value would be ambiguous (`ambiguous-style`);
 *  - one of the targeted attributes on a stop uses an XML entity (`&…;`): the
 *    decoded value could differ from the bytes we would compare (`encoded-attribute`);
 *  - the gradient declares no stop at all (`no-stops`);
 *  - the index is out of bounds (`index-out-of-range`) or not a nonnegative
 *    integer (`invalid-target`);
 *  - the attribute is absent on that stop (`missing-attribute`);
 *  - the value is invalid for the attribute (`invalid-value`) or identical to the
 *    current one (`unchanged`: no cosmetic rewrite, no write);
 *  - insertion: the requested offset is already used (`offset-collision`), the
 *    gradient already holds 32 stops (`too-many-stops`), an existing offset
 *    cannot be normalised (`unsupported-offset`), the neighbour's colour/opacity
 *    cannot be copied safely (`unsupported-style`), or the rescan fails
 *    (`invalid-result`);
 *  - removal: this is the last remaining stop (`last-stop`).
 *
 * Known limits, documented in ADR-033 and never silent:
 *  - an id written with an XML entity is not addressable (the scanner keeps raw
 *    ids) and a gradient without a valid unique id is not listed;
 *  - `url(#…)` references inside `<style>` content are not counted in
 *    `referencedBy` (only attribute values are);
 *  - `href`-inherited gradients are refused even when their own stops look
 *    complete, because inheritance semantics are not resolved here;
 *  - insertion does not resolve multicolour interpolation and does not reorder
 *    stops by offset: the new stop is placed at the requested document position;
 *  - removal does not check whether the deleted stop's own `id` is referenced
 *    elsewhere; only the remaining stop count and parseability are verified;
 *  - no attribute insertion, no gradient creation, no stop reorder, no `offset`
 *    unit conversion (a percentage stays a percentage).
 */
import { scanSvgDocument } from './svg-document.mjs'

export const GRADIENT_TAGS = new Set(['linearGradient', 'radialGradient'])
/** The only attributes this module can write, and only when already present. */
export const GRADIENT_STOP_ATTRIBUTES = new Set(['stop-color', 'stop-opacity', 'offset'])
/** Hard ceiling for insertions: the editor never grows a gradient past this. */
export const MAX_GRADIENT_STOPS = 32

/** Two offsets closer than this are the same stop position. */
const OFFSET_EPSILON = 1e-9
/** A copied attribute must stay inert when re-embedded in the source. */
const SAFE_ATTRIBUTE_VALUE = /^[^&<>\r\n\u0000-\u0008\u000B\u000C\u000E-\u001F]*$/
/**
 * Deterministic search grid for a new offset: halves first, then quarters,
 * eighths… so the new stop starts at the middle of its gap and only moves when
 * that exact value already exists. 63 distinct fractions in 0..1.
 */
const OFFSET_FRACTIONS = (() => {
  const fractions = []
  for (let level = 1; level <= 6; level += 1) {
    const step = 2 ** level
    for (let numerator = 1; numerator < step; numerator += 2) fractions.push(numerator / step)
  }
  return fractions
})()

const ID_PATTERN = /^[A-Za-z_][\w.:-]*$/
// `none` is deliberately absent: it is not a valid <color> for stop-color and
// both Chromium and Firefox render it black, which would contradict the panel.
const STOP_COLOR = /^(?:#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})$/
const NUMBER = /^(?:\d+(?:\.\d+)?|\.\d+)$/
const PERCENTAGE = /^(?:\d+(?:\.\d+)?|\.\d+)%$/
const URL_FRAGMENT = /url\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/gi

const REFUSAL_MESSAGES = Object.freeze({
  'inherited-gradient':
    'The gradient inherits stops through href/xlink:href; its stop attributes are not defined locally',
  'ambiguous-style': 'A stop carries a style attribute, so the source of truth for its attributes is ambiguous',
  'encoded-attribute': 'A stop encodes a targeted attribute with an XML entity; its value cannot be edited safely',
  'no-stops': 'The gradient declares no stops, so there is nothing addressable to edit',
  'index-out-of-range': 'The requested stop position does not exist in this gradient',
  'offset-collision': 'The requested offset is already used by another stop of this gradient',
  'too-many-stops': 'The gradient already holds the maximum number of stops this editor inserts',
  'last-stop': 'The only stop of a gradient cannot be removed: a gradient without stops no longer has a meaning',
  'unsupported-offset': 'An existing offset cannot be normalised, so a distinct new offset cannot be computed safely',
  'unsupported-style': 'The neighbouring stop style cannot be copied into a new stop safely',
  'invalid-result': 'The edit would produce an SVG document that no longer parses; nothing is written',
})

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

/** Scan once, or refuse with the reason the pseudonym hides. */
function scanOrFail(source) {
  try {
    return scanSvgDocument(source)
  } catch (error) {
    if (error?.code === 'ambiguous-svg') {
      fail('ambiguous-gradient', 'The document contains duplicate or ambiguous ids, so no gradient can be addressed safely')
    }
    fail('structure-unavailable', 'The SVG structure cannot be scanned, so gradients are not editable')
  }
}

/** Direct `<stop>` children, in document order. */
function stopNodes(node) {
  return node.children.filter((child) => child.tag === 'stop')
}

/** The single reason a gradient is not writable, or null when it is. */
/** Document-level style sources that can override stop attributes. */
function documentCarriesStyles(scan, source) {
  if (/<\?xml-stylesheet\b/i.test(source)) return true
  return scan.nodes.some((entry) => entry.tag === 'style')
}

/** An id written with an entity decodes to a different identity. */
function documentHasEncodedId(scan) {
  return scan.nodes.some((entry) => (entry.attributes.get('id')?.value || '').includes('&'))
}

function gradientReason(node, context = {}) {
  if (context.encodedId) return 'encoded-id'
  if (context.documentStyles) return 'document-styles'
  for (const attribute of node.attributeList) {
    if (attribute.name === 'href' || attribute.name.endsWith(':href')) return 'inherited-gradient'
  }
  const stops = stopNodes(node)
  if (stops.length === 0) return 'no-stops'
  for (const stop of stops) {
    if (stop.attributes.has('style')) return 'ambiguous-style'
    for (const name of GRADIENT_STOP_ATTRIBUTES) {
      const attribute = stop.attributes.get(name)
      if (attribute && attribute.value.includes('&')) return 'encoded-attribute'
    }
  }
  return null
}

/**
 * Resolve one addressable gradient and every reason it may not be written.
 * Shared by the three gestures so no refusal can drift between them.
 */
function resolveGradient(source, gradientId) {
  if (typeof gradientId !== 'string' || !ID_PATTERN.test(gradientId)) {
    fail('invalid-target', 'A valid SVG gradient id is required')
  }
  const scan = scanOrFail(source)
  const node = scan.byId.get(gradientId)
  if (!node) fail('unknown-gradient', 'No SVG element uses the id "' + gradientId + '"')
  if (!GRADIENT_TAGS.has(node.tag)) {
    fail('unknown-gradient', 'The id "' + gradientId + '" does not address a linear or radial gradient')
  }
  // Document-level context matters as much as the gradient itself: a style sheet
  // or an encoded id makes the addressed element ambiguous.
  const reason = gradientReason(node, {
    documentStyles: documentCarriesStyles(scan, source),
    encodedId: documentHasEncodedId(scan),
  })
  if (reason) fail(reason, REFUSAL_MESSAGES[reason] || reason)
  return { scan, node, stops: stopNodes(node) }
}

function valueSpan(attribute) {
  return attribute ? { start: attribute.valueStart, end: attribute.valueEnd } : null
}

/** Normalised value of a written offset, or null when it is not a plain offset. */
function writtenOffsetNumber(text) {
  const value = String(text).trim()
  if (PERCENTAGE.test(value)) return Number(value.slice(0, -1)) / 100
  if (NUMBER.test(value)) return Number(value)
  return null
}

/** Existing offsets as numbers in 0..1; an absent offset is the SVG default 0. */
function existingOffsets(stops) {
  return stops.map((stop) => {
    const attribute = stop.attributes.get('offset')
    if (!attribute) return 0
    const raw = attribute.value.trim()
    const numeric = writtenOffsetNumber(raw)
    if (numeric === null || numeric < 0 || numeric > 1) {
      fail('unsupported-offset',
        'The stop offset "' + raw + '" is not a plain number in 0..1 or a percentage, so a new offset cannot be computed safely')
    }
    return numeric
  })
}

/** Write the new offset in the notation of the stop it sits next to. */
function offsetUnit(stops, reference) {
  const attribute = reference ? reference.attributes.get('offset') : null
  if (attribute) return attribute.value.trim().endsWith('%') ? '%' : 'number'
  const written = stops.map((stop) => stop.attributes.get('offset')?.value.trim()).filter(Boolean)
  return written.some((value) => value.endsWith('%')) ? '%' : 'number'
}

function formatOffset(fraction, unit) {
  const value = unit === '%' ? fraction * 100 : fraction
  const rounded = Math.round(value * 1e4) / 1e4
  return String(rounded) + (unit === '%' ? '%' : '')
}

function offsetCollides(offsets, numeric) {
  return offsets.some((existing) => Math.abs(existing - numeric) < OFFSET_EPSILON)
}

/**
 * Bounds of the gap the new stop belongs to. A degenerate gap (duplicate
 * offsets, or a boundary at 0/1) has no room inside it, so the neighbouring gap
 * is used instead: the new stop still gets a distinct, computed position.
 */
function candidateBounds(offsets, at) {
  const count = offsets.length
  let lo
  let hi
  if (at === 0) { lo = 0; hi = offsets[0] }
  else if (at >= count) { lo = offsets[count - 1]; hi = 1 }
  else { lo = offsets[at - 1]; hi = offsets[at] }
  if (hi - lo < OFFSET_EPSILON) {
    if (at >= count && count >= 2) { lo = offsets[count - 2]; hi = 1 }
    else if (at === 0 && count >= 2) { lo = 0; hi = offsets[1] }
    else if (at > 0 && at < count) {
      lo = at >= 2 ? offsets[at - 2] : 0
      hi = at <= count - 2 ? offsets[at + 1] : 1
    }
  }
  return { lo, hi }
}

/** Deterministic distinct offset, formatted like its neighbour. Never guesses. */
function computeOffset(offsets, at, unit) {
  const { lo, hi } = candidateBounds(offsets, at)
  const candidates = []
  if (hi - lo > OFFSET_EPSILON) {
    for (const fraction of OFFSET_FRACTIONS) candidates.push(lo + (hi - lo) * fraction)
  }
  // Whole-range fallback: distinctness is the hard requirement, order is not
  // silently invented by refusing a legal request.
  for (const fraction of OFFSET_FRACTIONS) candidates.push(fraction)
  for (const candidate of candidates) {
    const text = formatOffset(candidate, unit)
    const numeric = writtenOffsetNumber(text)
    if (numeric === null || numeric < 0 || numeric > 1) continue
    if (offsetCollides(offsets, numeric)) continue
    return text
  }
  fail('offset-collision', 'No distinct offset is available in 0..1 for a new stop of this gradient')
}

/** The neighbour's raw attribute, copied verbatim, or null when it is absent. */
function copiedAttribute(stop, name) {
  const attribute = stop.attributes.get(name)
  if (!attribute) return null
  if (!SAFE_ATTRIBUTE_VALUE.test(attribute.value)) {
    fail('unsupported-style',
      'The neighbouring stop has a ' + name + ' value that cannot be copied into a new stop safely')
  }
  return attribute.value
}

/** Quote with the delimiter the raw value does not contain. */
function attributeText(name, value) {
  return /"/.test(value) ? ' ' + name + "='" + value + "'" : ' ' + name + '="' + value + '"'
}

function buildStopText(offsetText, color, opacity) {
  let text = '<stop' + attributeText('offset', offsetText)
  if (color !== null) text += attributeText('stop-color', color)
  if (opacity !== null) text += attributeText('stop-opacity', opacity)
  return text + '/>'
}

function indentationBefore(source, position) {
  const lineStart = source.lastIndexOf('\n', position - 1) + 1
  const text = source.slice(lineStart, position)
  return /^[ \t]*$/.test(text) ? text : ''
}

/** Indentation of a stop that starts on its own line, or null when inline. */
function stopIndent(source, boundary, stop) {
  const gap = source.slice(boundary, stop.start)
  if (!gap.includes('\n') || !/^[ \t\r\n]*$/.test(gap)) return null
  const tail = gap.slice(gap.lastIndexOf('\n') + 1)
  return /^[ \t]*$/.test(tail) ? tail : null
}

function insertionIndent(source, node, stops, at) {
  const candidates = []
  if (at < stops.length) {
    candidates.push({ boundary: at === 0 ? node.contentStart : stops[at - 1].end, stop: stops[at] })
  } else {
    const last = stops.length - 1
    candidates.push({ boundary: last === 0 ? node.contentStart : stops[last - 1].end, stop: stops[last] })
  }
  // Nearest stops first when the reference itself is inline or preceded by a
  // comment, so the observed indentation of the file wins over a guess.
  const order = stops.map((_, index) => index).sort((a, b) => Math.abs(a - at) - Math.abs(b - at) || a - b)
  for (const index of order) {
    candidates.push({ boundary: index === 0 ? node.contentStart : stops[index - 1].end, stop: stops[index] })
  }
  for (const candidate of candidates) {
    const observed = stopIndent(source, candidate.boundary, candidate.stop)
    if (observed !== null) return observed
  }
  return indentationBefore(source, node.start) + '  '
}

/** One span inserted inside the gradient, on the line style already in use. */
function insertionText(source, node, stops, at, stopText) {
  const content = source.slice(node.contentStart, node.contentEnd)
  const multiline = content.includes('\n')
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const boundary = at === 0 ? node.contentStart : stops[at - 1].end
  if (!multiline) {
    const next = at < stops.length ? stops[at].start : node.contentEnd
    const gap = source.slice(boundary, next)
    const separator = /^[ \t]*$/.test(gap) ? gap : ''
    return at === 0 ? stopText + separator : separator + stopText
  }
  const indent = insertionIndent(source, node, stops, at)
  if (at === 0) {
    const before = source.slice(node.contentStart, stops[0].start)
    if (/^[ \t\r\n]*$/.test(before)) return stopText + newline + indent
    // A comment (or other markup) precedes the first stop: put the new stop on
    // its own line instead of gluing it to that markup.
    return newline + indent + stopText + newline + indent
  }
  return newline + indent + stopText
}

/** Re-scan the patched bytes: an edit that no longer parses is refused. */
function rescanResult(source, patch, message) {
  const after = source.slice(0, patch.start) + patch.after + source.slice(patch.end)
  try {
    return scanSvgDocument(after)
  } catch {
    fail('invalid-result', message)
  }
}

function describeStop(stop, index) {
  const offset = stop.attributes.get('offset') || null
  const color = stop.attributes.get('stop-color') || null
  const opacity = stop.attributes.get('stop-opacity') || null
  return {
    index,
    // Raw source values, exactly as written: null means the attribute is absent
    // (and therefore not editable in this tranche).
    offset: offset ? offset.value : null,
    color: color ? color.value : null,
    opacity: opacity ? opacity.value : null,
    offsetSpan: valueSpan(offset),
    colorSpan: valueSpan(color),
    opacitySpan: valueSpan(opacity),
  }
}

/** gradient id → ids of the elements whose attributes reference `url(#id)`. */
function collectReferences(scan) {
  const references = new Map()
  for (const node of scan.nodes) {
    if (node.id === null) continue
    for (const attribute of node.attributeList) {
      URL_FRAGMENT.lastIndex = 0
      let match
      while ((match = URL_FRAGMENT.exec(attribute.value))) {
        const fragment = String(match[2] ?? match[3] ?? '').trim()
        if (!fragment.startsWith('#')) continue
        const id = fragment.slice(1)
        if (!ID_PATTERN.test(id)) continue
        let list = references.get(id)
        if (!list) references.set(id, (list = []))
        if (!list.includes(node.id)) list.push(node.id)
      }
    }
  }
  return references
}

/**
 * List every addressable linear/radial gradient.
 *
 * `options.scan` lets the Host reuse the scan it already performed for the layer
 * list; when absent (or null) the source is scanned again. A document that
 * cannot be scanned is a typed `structure-unavailable` refusal rather than a
 * silently empty list.
 *
 * @param {string} source
 * @param {{scan?: object|null}} [options]
 * @returns {Array<{id: string, type: 'linear'|'radial', usable: boolean,
 *   reason: string|null, stops: object[], referencedBy: string[]}>}
 */
export function listSvgGradients(source, options = {}) {
  if (typeof source !== 'string') fail('invalid-source', 'Expected SVG source text')
  const scan = options.scan || scanOrFail(source)
  const references = collectReferences(scan)
  // Document-level facts decide usability once, not per gradient.
  const context = {
    documentStyles: documentCarriesStyles(scan, source),
    encodedId: documentHasEncodedId(scan),
  }
  const gradients = []
  for (const node of scan.nodes) {
    if (!GRADIENT_TAGS.has(node.tag)) continue
    // Non-addressable gradients (no id, invalid id, duplicate id) are not
    // listed: nothing could name them in a request.
    if (node.id === null || scan.byId.get(node.id) !== node) continue
    const reason = gradientReason(node, context)
    gradients.push({
      id: node.id,
      type: node.tag === 'linearGradient' ? 'linear' : 'radial',
      usable: reason === null,
      reason,
      stops: stopNodes(node).map(describeStop),
      referencedBy: references.get(node.id) || [],
    })
  }
  return gradients
}

function validateStopValue(attribute, value) {
  if (attribute === 'stop-color') {
    if (!STOP_COLOR.test(value)) fail('invalid-value', 'stop-color must be #rgb or #rrggbb')
    return value
  }
  if (attribute === 'stop-opacity') {
    if (!NUMBER.test(value) || Number(value) < 0 || Number(value) > 1) {
      fail('invalid-value', 'stop-opacity must be a number between 0 and 1')
    }
    return value
  }
  if (PERCENTAGE.test(value)) {
    if (Number(value.slice(0, -1)) > 100) fail('invalid-value', 'offset must be a percentage between 0% and 100%')
    return value
  }
  if (!NUMBER.test(value) || Number(value) < 0 || Number(value) > 1) {
    fail('invalid-value', 'offset must be a number between 0 and 1, or a percentage between 0% and 100%')
  }
  return value
}

/**
 * Build the single exact patch for one stop attribute value.
 *
 * @returns {{start: number, end: number, before: string, after: string}}
 * @throws {Error & {code: string}} typed refusal; nothing is written.
 */
export function svgGradientStopPatch(source, { gradientId, index, attribute, value } = {}) {
  if (typeof source !== 'string') fail('invalid-source', 'Expected SVG source text')
  if (typeof attribute !== 'string' || !GRADIENT_STOP_ATTRIBUTES.has(attribute)) {
    fail('invalid-target', 'Only stop-color, stop-opacity and offset are editable on a stop')
  }
  if (!Number.isSafeInteger(index) || index < 0) fail('invalid-target', 'A nonnegative stop index is required')
  if (typeof value !== 'string') fail('invalid-value', 'A string value is required')
  const next = value.trim()
  if (next.length === 0) fail('invalid-value', 'A non-empty value is required')
  validateStopValue(attribute, next)

  const { stops } = resolveGradient(source, gradientId)
  if (index >= stops.length) {
    fail('index-out-of-range', 'The gradient "' + gradientId + '" has no stop at index ' + index)
  }
  const stop = stops[index]
  const existing = stop.attributes.get(attribute)
  if (!existing) {
    fail('missing-attribute', 'The attribute "' + attribute + '" is absent on this stop; this tranche only edits existing attributes')
  }
  if (existing.value.trim() === next) {
    fail('unchanged', 'The value is identical to the current one; nothing is written')
  }
  return { start: existing.valueStart, end: existing.valueEnd, before: existing.value, after: next }
}

/**
 * Build the one exact span that inserts a complete `<stop>`.
 *
 * `index` is the position the new stop takes in the resulting stop list:
 * `0` inserts before the first stop, `stops.length` (or an omitted index)
 * appends at the end. The new stop copies the colour and opacity of the
 * neighbour it is placed next to, and always receives a computed offset that is
 * numerically distinct from every existing offset.
 *
 * @returns {{patch: {start: number, end: number, before: string, after: string},
 *   index: number, offset: string, color: string|null, opacity: string|null}}
 * @throws {Error & {code: string}} typed refusal; nothing is written.
 */
export function svgGradientStopInsertPatch(source, { gradientId, index, offset } = {}) {
  if (typeof source !== 'string') fail('invalid-source', 'Expected SVG source text')
  if (offset !== undefined && offset !== null && typeof offset !== 'string') {
    fail('invalid-value', 'A string offset is required')
  }
  const { node, stops } = resolveGradient(source, gradientId)
  if (stops.length >= MAX_GRADIENT_STOPS) {
    fail('too-many-stops',
      'A gradient is limited to ' + MAX_GRADIENT_STOPS + ' stops in this editor; this one already has ' + stops.length)
  }
  const count = stops.length
  const at = index === undefined || index === null ? count : index
  if (!Number.isSafeInteger(at) || at < 0) fail('invalid-target', 'A nonnegative integer insertion index is required')
  if (at > count) {
    fail('index-out-of-range',
      'The gradient "' + gradientId + '" has ' + count + ' stop(s); there is no insertion position ' + at)
  }

  const offsets = existingOffsets(stops)
  const reference = at < count ? stops[at] : stops[count - 1]
  const neighbour = at === 0 ? stops[0] : stops[at - 1]
  const color = copiedAttribute(neighbour, 'stop-color')
  const opacity = copiedAttribute(neighbour, 'stop-opacity')

  let offsetText
  if (typeof offset === 'string') {
    // Explicit offset: same grammar as an edited offset, and it must not
    // duplicate an existing position (units are normalised: 50% === 0.5).
    const next = offset.trim()
    if (next.length === 0) fail('invalid-value', 'A non-empty offset is required')
    validateStopValue('offset', next)
    const numeric = writtenOffsetNumber(next)
    if (numeric === null) {
      fail('invalid-value', 'offset must be a number between 0 and 1, or a percentage between 0% and 100%')
    }
    if (offsetCollides(offsets, numeric)) {
      fail('offset-collision', 'The offset "' + next + '" is already used by another stop of this gradient')
    }
    offsetText = next
  } else {
    offsetText = computeOffset(offsets, at, offsetUnit(stops, reference))
  }

  const stopText = buildStopText(offsetText, color, opacity)
  const position = at === 0 ? stops[0].start : stops[at - 1].end
  const text = insertionText(source, node, stops, at, stopText)
  const patch = { start: position, end: position, before: '', after: text }

  // Defence in depth: the patched bytes must still scan, and the new stop must
  // be the one we meant at the position we meant. Otherwise nothing is written.
  const scan = rescanResult(source, patch,
    'Adding the stop would produce an SVG document that no longer parses; nothing is written')
  const patchedGradient = scan.byId.get(gradientId)
  if (!patchedGradient || !GRADIENT_TAGS.has(patchedGradient.tag)) {
    fail('invalid-result', 'The gradient cannot be resolved after insertion; nothing is written')
  }
  const patchedStops = stopNodes(patchedGradient)
  if (patchedStops.length !== count + 1) {
    fail('invalid-result', 'The inserted stop did not land inside the addressed gradient; nothing is written')
  }
  const added = patchedStops[at]
  const addedOffset = added ? added.attributes.get('offset') : null
  if (!added || added.tag !== 'stop' || !addedOffset || addedOffset.value !== offsetText) {
    fail('invalid-result', 'The inserted stop is not addressable at the requested position; nothing is written')
  }
  if (color !== null && added.attributes.get('stop-color')?.value !== color) {
    fail('invalid-result', 'The copied stop colour did not survive re-scanning; nothing is written')
  }
  if (opacity !== null && added.attributes.get('stop-opacity')?.value !== opacity) {
    fail('invalid-result', 'The copied stop opacity did not survive re-scanning; nothing is written')
  }
  return { patch, index: at, offset: offsetText, color, opacity }
}

/**
 * Build the one exact span that removes a stop.
 *
 * When the stop occupies its line alone, the leading newline and indentation are
 * part of the removed span so no blank line is left behind; otherwise the exact
 * element span is removed and neighbouring bytes are untouched.
 *
 * @returns {{patch: {start: number, end: number, before: string, after: string}, index: number}}
 * @throws {Error & {code: string}} typed refusal; nothing is written.
 */
export function svgGradientStopRemovePatch(source, { gradientId, index } = {}) {
  if (typeof source !== 'string') fail('invalid-source', 'Expected SVG source text')
  if (!Number.isSafeInteger(index) || index < 0) fail('invalid-target', 'A nonnegative stop index is required')
  const { node, stops } = resolveGradient(source, gradientId)
  if (index >= stops.length) {
    fail('index-out-of-range', 'The gradient "' + gradientId + '" has no stop at index ' + index)
  }
  if (stops.length === 1) {
    fail('last-stop', 'The only stop of a gradient cannot be removed: a gradient without stops no longer has a meaning')
  }
  const stop = stops[index]
  const boundary = index === 0 ? node.contentStart : stops[index - 1].end
  const nextBoundary = index === stops.length - 1 ? node.contentEnd : stops[index + 1].start
  const gapBefore = source.slice(boundary, stop.start)
  const gapAfter = source.slice(stop.end, nextBoundary)
  // Alone on its line: the indentation before it and the newline after it are
  // whitespace only, so the whole line span can go without eating other stops.
  const line = /(\r?\n)([ \t]*)$/.exec(gapBefore)
  const afterLine = /^[ \t]*\r?\n/.exec(gapAfter)
  const start = line !== null && afterLine !== null ? boundary + line.index : stop.start
  const patch = { start, end: stop.end, before: source.slice(start, stop.end), after: '' }

  const scan = rescanResult(source, patch,
    'Removing the stop would produce an SVG document that no longer parses; nothing is written')
  const patchedGradient = scan.byId.get(gradientId)
  if (!patchedGradient || !GRADIENT_TAGS.has(patchedGradient.tag) ||
      stopNodes(patchedGradient).length !== stops.length - 1) {
    fail('invalid-result', 'The stop was not removed from the addressed gradient cleanly; nothing is written')
  }
  return { patch, index }
}

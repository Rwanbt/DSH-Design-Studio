/**
 * Edit the attributes of one **existing** `<stop>` in a linear or radial SVG
 * gradient, addressed by gradient id, stop index and attribute name.
 *
 * The operation is a single `{start, end, before, after}` patch over the exact
 * value span of one attribute, so `applyNativePatches` builds a byte-identical
 * inverse and Undo restores every quote and every unrelated byte.
 *
 * Scope is deliberately narrow: only `stop-color`, `stop-opacity` and `offset`
 * are writable, and only when the attribute is **already present** on the stop.
 * This tranche never inserts an attribute, never creates a gradient, never adds
 * or removes a stop, and never re-serialises the XML tree.
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
 *  - the index is out of bounds (`index-out-of-range`);
 *  - the attribute is absent on that stop (`missing-attribute`);
 *  - the value is invalid for the attribute (`invalid-value`) or identical to the
 *    current one (`unchanged`: no cosmetic rewrite, no write).
 *
 * Known limits, documented in ADR-033 and never silent:
 *  - an id written with an XML entity is not addressable (the scanner keeps raw
 *    ids) and a gradient without a valid unique id is not listed;
 *  - `url(#…)` references inside `<style>` content are not counted in
 *    `referencedBy` (only attribute values are);
 *  - `href`-inherited gradients are refused even when their own stops look
 *    complete, because inheritance semantics are not resolved here;
 *  - no attribute insertion, no stop insertion/removal/reorder, no gradient
 *    creation, no `offset` unit conversion (a percentage stays a percentage).
 */
import { scanSvgDocument } from './svg-document.mjs'

export const GRADIENT_TAGS = new Set(['linearGradient', 'radialGradient'])
/** The only attributes this module can write, and only when already present. */
export const GRADIENT_STOP_ATTRIBUTES = new Set(['stop-color', 'stop-opacity', 'offset'])

const ID_PATTERN = /^[A-Za-z_][\w.:-]*$/
const STOP_COLOR = /^(?:none|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})$/
const NUMBER = /^(?:\d+(?:\.\d+)?|\.\d+)$/
const PERCENTAGE = /^(?:\d+(?:\.\d+)?|\.\d+)%$/
const URL_FRAGMENT = /url\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/gi

const REFUSAL_MESSAGES = Object.freeze({
  'inherited-gradient':
    'The gradient inherits stops through href/xlink:href; its stop attributes are not defined locally',
  'ambiguous-style': 'A stop carries a style attribute, so the source of truth for its attributes is ambiguous',
  'encoded-attribute': 'A stop encodes a targeted attribute with an XML entity; its value cannot be edited safely',
  'no-stops': 'The gradient declares no stops, so there is nothing addressable to edit',
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
function gradientReason(node) {
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

function valueSpan(attribute) {
  return attribute ? { start: attribute.valueStart, end: attribute.valueEnd } : null
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
  const gradients = []
  for (const node of scan.nodes) {
    if (!GRADIENT_TAGS.has(node.tag)) continue
    // Non-addressable gradients (no id, invalid id, duplicate id) are not
    // listed: nothing could name them in a request.
    if (node.id === null || scan.byId.get(node.id) !== node) continue
    const reason = gradientReason(node)
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
    if (!STOP_COLOR.test(value)) fail('invalid-value', 'stop-color must be #rgb, #rrggbb or none')
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
  if (typeof gradientId !== 'string' || !ID_PATTERN.test(gradientId)) {
    fail('invalid-target', 'A valid SVG gradient id is required')
  }
  if (typeof attribute !== 'string' || !GRADIENT_STOP_ATTRIBUTES.has(attribute)) {
    fail('invalid-target', 'Only stop-color, stop-opacity and offset are editable on a stop')
  }
  if (!Number.isSafeInteger(index) || index < 0) fail('invalid-target', 'A nonnegative stop index is required')
  if (typeof value !== 'string') fail('invalid-value', 'A string value is required')
  const next = value.trim()
  if (next.length === 0) fail('invalid-value', 'A non-empty value is required')
  validateStopValue(attribute, next)

  const scan = scanOrFail(source)
  const node = scan.byId.get(gradientId)
  if (!node) fail('unknown-gradient', 'No SVG element uses the id "' + gradientId + '"')
  if (!GRADIENT_TAGS.has(node.tag)) {
    fail('unknown-gradient', 'The id "' + gradientId + '" does not address a linear or radial gradient')
  }
  const reason = gradientReason(node)
  if (reason) fail(reason, REFUSAL_MESSAGES[reason] || reason)

  const stops = stopNodes(node)
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

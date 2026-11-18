/**
 * Change a layer's paint order inside its parent element.
 *
 * SVG has no z-index: the document order *is* the paint order. Reordering is
 * therefore a pure move of one exact source span among its siblings, expressed
 * as a single contiguous replacement so the editor keeps its byte-exact,
 * revision-checked model and Undo restores the original bytes.
 *
 * Only the span between the two affected positions is rewritten; everything
 * before and after it is copied verbatim.
 */
import { scanSvgDocument, svgLockedAncestor } from './svg-document.mjs'

const DIRECTIONS = new Set(['front', 'back', 'forward', 'backward'])

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

/**
 * Return `{patch, from, to}` for one reorder, or throw a typed error.
 * `front` paints last (on top), `back` paints first (behind its siblings).
 */
export function svgOrderPatch(source, { id, direction }) {
  if (typeof id !== 'string' || !id) fail('invalid-target', 'Select an SVG layer first')
  if (!DIRECTIONS.has(direction)) fail('invalid-target', 'Unsupported reorder direction')
  const scan = scanSvgDocument(source)
  const node = scan.byId.get(id)
  if (!node) fail('unknown-node', 'SVG layer not found')
  if (node === scan.root) fail('invalid-target', 'The SVG root cannot be reordered')
  if (node.readOnly) fail('read-only', 'Referenced SVG content is read-only')
  if (svgLockedAncestor(node)) fail('locked', 'SVG layer is locked; unlock it before reordering')
  const siblings = node.parent?.children ?? []
  if (siblings.length < 2) fail('invalid-target', 'This layer has no sibling to move across')
  const from = siblings.indexOf(node)
  const to = direction === 'front' ? siblings.length - 1
    : direction === 'back' ? 0
      : direction === 'forward' ? Math.min(siblings.length - 1, from + 1)
        : Math.max(0, from - 1)
  if (to === from) {
    fail('invalid-target', direction === 'forward' || direction === 'front'
      ? 'This layer is already the front-most sibling'
      : 'This layer is already the back-most sibling')
  }
  const text = source.slice(node.start, node.end)
  const first = siblings[0]
  const last = siblings[siblings.length - 1]
  // One contiguous edit covering everything that moves, so nothing between the
  // two positions can be lost: the moved span is re-emitted, the rest is copied.
  if (to === siblings.length - 1) {
    // Move to the end: everything after the layer, then the layer itself.
    return {
      patch: { start: node.start, end: last.end,
        before: source.slice(node.start, last.end),
        after: source.slice(node.end, last.end) + text },
      from, to,
    }
  }
  if (to === 0) {
    return {
      patch: { start: first.start, end: node.end,
        before: source.slice(first.start, node.end),
        after: text + source.slice(first.start, node.start) },
      from, to,
    }
  }
  const next = siblings[to]
  if (to === from + 1) {
    // Adjacent swap forwards: node and its next sibling exchange places.
    return {
      patch: { start: node.start, end: next.end,
        before: source.slice(node.start, next.end),
        after: source.slice(next.start, next.end) + source.slice(node.end, next.start) + text },
      from, to,
    }
  }
  const previous = siblings[to]
  // Adjacent swap backwards: the previous sibling and the node exchange places.
  return {
    patch: { start: previous.start, end: node.end,
      before: source.slice(previous.start, node.end),
      after: text + source.slice(previous.end, node.start) + source.slice(previous.start, previous.end) },
    from, to,
  }
}

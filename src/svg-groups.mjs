/**
 * Byte-preserving SVG grouping.
 *
 * Grouping wraps a contiguous run of SIBLING elements by inserting one
 * `<g id="…">` before the first selected element and `</g>` after the last
 * one: no existing byte is rewritten, moved or re-indented. Ungrouping removes
 * exactly the open and close tags of one `<g>`, leaving the children's bytes
 * (and their indentation) untouched.
 *
 * Every refusal is typed, never a silent guess:
 *   non-contiguous-selection  selected elements are not adjacent siblings
 *   different-parents         selected elements do not share one parent
 *   unsafe-selection          SVG root, `<defs>`/referenced content, or a
 *                             non-graphics element
 *   read-only                 content of `<defs>`, `<symbol>`, gradients, …
 *   locked                    a `data-locked="true"` element is involved
 *   unsupported-group         ungroup target is not a `<g>`
 *   unknown-node              id not found
 *   invalid-svg / unsupported-svg  the source could not be mapped exactly
 */
import { scanSvgDocument, svgLockedAncestor } from './svg-document.mjs'

const MAX_SELECTION = 64
const ID_PATTERN = /^[A-Za-z_][\w.:-]*$/
const NOT_GROUPABLE = new Set([
  'svg', 'defs', 'symbol', 'clipPath', 'mask', 'marker', 'pattern',
  'linearGradient', 'radialGradient', 'filter', 'style', 'title', 'desc', 'metadata',
])

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function uniqueGroupId(byId, base) {
  for (let index = 1; index <= 10000; index += 1) {
    const candidate = base + '-' + index
    if (!byId.has(candidate)) return candidate
  }
  fail('too-many-groups', 'Cannot allocate a unique group id')
}

/**
 * Wrap {ids} — a contiguous run of sibling elements — in one new `<g>`.
 * Returns {patches:[openInsertion, closeInsertion], id, open, close}.
 */
export function svgGroupPatch(source, { ids, id } = {}) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_SELECTION) {
    fail('invalid-target', 'Select between 1 and ' + MAX_SELECTION + ' SVG layers to group')
  }
  if (new Set(ids).size !== ids.length) fail('invalid-target', 'Selection contains duplicate ids')
  for (const candidate of ids) {
    if (typeof candidate !== 'string' || !ID_PATTERN.test(candidate)) {
      fail('invalid-target', 'A valid SVG element id is required')
    }
  }
  const scan = scanSvgDocument(source)
  const nodes = ids.map(candidate => {
    const node = scan.byId.get(candidate)
    if (!node) fail('unknown-node', 'SVG layer not found: ' + candidate)
    return node
  })
  for (const node of nodes) {
    if (node === scan.root) fail('unsafe-selection', 'The SVG root cannot be wrapped in a group')
    if (node.readOnly) fail('read-only', 'Referenced SVG content cannot be grouped')
    if (NOT_GROUPABLE.has(node.tag)) fail('unsafe-selection', 'Only editable graphics layers can be grouped')
    if (svgLockedAncestor(node)) fail('locked', 'Layer is locked')
  }
  const parent = nodes[0].parent
  if (!parent) fail('unsafe-selection', 'The SVG root cannot be wrapped in a group')
  if (nodes.some(node => node.parent !== parent)) {
    fail('different-parents', 'Selected layers must share the same parent')
  }
  if (parent.readOnly) fail('read-only', 'Parent container is read-only')
  const ordered = [...nodes].sort((left, right) => left.siblingIndex - right.siblingIndex)
  const first = ordered[0]
  const last = ordered[ordered.length - 1]
  if (last.siblingIndex - first.siblingIndex + 1 !== ordered.length) {
    fail('non-contiguous-selection', 'Selected layers must be adjacent siblings')
  }
  let groupId
  if (id === undefined) {
    groupId = uniqueGroupId(scan.byId, 'group')
  } else {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) fail('invalid-target', 'A valid group id is required')
    if (scan.byId.has(id)) fail('ambiguous-svg', 'Group id already exists: ' + id)
    groupId = id
  }
  const open = '<g id="' + groupId + '">'
  const close = '</g>'
  return {
    patches: [
      { start: first.start, end: first.start, before: '', after: open },
      { start: last.end, end: last.end, before: '', after: close },
    ],
    id: groupId,
    open,
    close,
  }
}

/**
 * Unwrap one `<g>`: its children keep their exact bytes and move to the parent.
 * A self-closing `<g/>` has no children, so unwrapping removes that exact tag.
 */
export function svgUngroupPatch(source, { id } = {}) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) fail('invalid-target', 'A valid group id is required')
  const scan = scanSvgDocument(source)
  const node = scan.byId.get(id)
  if (!node) fail('unknown-node', 'SVG layer not found')
  if (node.tag !== 'g') fail('unsupported-group', 'Only a <g> layer can be ungrouped')
  if (node === scan.root) fail('unsafe-selection', 'The SVG root cannot be ungrouped')
  if (node.readOnly) fail('read-only', 'Referenced SVG content cannot be ungrouped')
  if (svgLockedAncestor(node)) fail('locked', 'Group is locked')
  if (node.end == null) fail('invalid-svg', 'SVG group must be well-formed and closed')
  // Dropping the wrapper also drops its attributes. `transform`, `opacity`,
  // `style`, `filter`, `mask` and `clip-path` change how the children look, so
  // ungrouping them would silently move/restyle the artwork. Refuse instead of
  // pretending the operation is lossless.
  const LOSSY = ['transform', 'opacity', 'style', 'filter', 'mask', 'clip-path']
  const lossy = LOSSY.filter((name) => node.attributes.has(name))
  if (lossy.length > 0) {
    fail('unsupported-group', 'Ungrouping would drop group attributes: ' + lossy.join(', '))
  }
  if (node.selfClosing) {
    const before = source.slice(node.start, node.end)
    return { patches: [{ start: node.start, end: node.end, before, after: '' }], id, empty: true }
  }
  const openTag = source.slice(node.start, node.openEnd)
  const closeTag = source.slice(node.closeStart, node.end)
  return {
    patches: [
      { start: node.start, end: node.openEnd, before: openTag, after: '' },
      { start: node.closeStart, end: node.end, before: closeTag, after: '' },
    ],
    id,
    empty: node.children.length === 0,
  }
}

/** Dispatcher so a UI can send one `{operation:'group'|'ungroup'}` request. */
export function svgGroupingPatch(source, params = {}) {
  if (params.operation === 'group') return svgGroupPatch(source, params)
  if (params.operation === 'ungroup') return svgUngroupPatch(source, { id: params.id })
  fail('invalid-target', 'Expected a group or ungroup operation')
}
